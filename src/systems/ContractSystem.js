/**
 * ContractSystem — work you take on by agreement: requirements, a deadline,
 * payment, and your reputation on the line.
 *
 * Contracts come from real needs in the world (nothing here is invented to fill
 * a quota):
 *   supply — a business is running low on something it buys (the baker needs wheat)
 *   craft  — a well-off villager wants furniture made; a lumberyard needs new axes
 *   build  — a villager's (or the village's) building site needs hands
 *   haul   — goods waiting at a producer, needed at a business that's short of them
 *   order  — once you own a business: another business orders a batch of what yours makes
 *            (filled from your business's stock and sent by cart)
 *
 * They're posted on the notice board. Accept one, do the work in the world
 * (deliver at the building's door, work at the site, collect and carry), and
 * get paid by whoever asked — from their own money. Miss the deadline and
 * people remember.
 *
 *   state.contracts = { offers: [], active: [], nextId, done, failed, log: [] }
 */
import { rand } from '../core/rng.js';
import { ITEMS } from '../data/items.js';
import { Q, STANDARD } from '../data/quality.js';
import { countAtLeast } from './slots.js';

export const CONTRACTS = {
  maxOffers: 6,
  maxActive: 3,
  offerDays: 3, // an offer stays on the board this long
  supplyPremium: 1.3, // paid over the base price for bulk, on time
  craftPremium: 1.45,
  buildPayPerHour: 3.2,
  haulFeePerUnitTile: 0.03,
  repOnTime: 2,
  repFail: -3,
};
const C = CONTRACTS;

export class ContractSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.contracts ??= { offers: [], active: [], nextId: 1, done: 0, failed: 0, log: [] };
    sim.bus.on('time:hour', (h) => h === 6 && this.daily());
    sim.bus.on('construction:player_worked', ({ site, minutes }) => this.onBuildWork(site, minutes));
  }

  get S() {
    return this.sim.state.contracts;
  }

  get(id) {
    return this.S.active.find((c) => c.id === id) || this.S.offers.find((c) => c.id === id) || null;
  }

  // ------------------------------------------------------------------ the board

  daily() {
    const day = this.sim.time.day;
    this.S.offers = this.S.offers.filter((o) => day - o.posted < C.offerDays && this.stillWanted(o));
    for (const c of this.S.active.slice()) if (day > c.deadline) this.fail(c);
    let tries = 0;
    while (this.S.offers.length < C.maxOffers && tries++ < 12) {
      const kind = rand.weighted([['supply', 3], ['craft', 2], ['build', 2], ['haul', 2], ['order', this.sim.holdings?.mine().length ? 3 : 0]]);
      const o = this[`make_${kind}`]?.();
      if (o && !this.duplicate(o)) this.S.offers.push(o);
    }
  }

  duplicate(o) {
    return [...this.S.offers, ...this.S.active].some((x) => x.kind === o.kind && x.item === o.item && x.building === o.building && x.siteId === o.siteId);
  }

  /** Is the need behind an offer still there? */
  stillWanted(o) {
    if (o.kind === 'build') return this.sim.construction.byId(o.siteId)?.status === 'site';
    if (o.kind === 'order' && !this.sim.holdings.isMine(o.supplierBiz)) return false;
    if (o.bizId) return !!this.sim.economy.biz(o.bizId) && !this.sim.economy.biz(o.bizId).closed;
    if (o.issuer && o.issuer !== 'village') return !!this.sim.npcs.byId(o.issuer);
    return true;
  }

  base(kind, extra) {
    return { id: this.S.nextId++, kind, posted: this.sim.time.day, delivered: 0, ...extra };
  }

  make_supply() {
    const E = this.sim.economy;
    const wants = [];
    for (const id of E.active()) {
      const def = E.def(id);
      for (const item of def.buys || []) {
        if (!ITEMS[item] || ITEMS[item].category === 'furniture' || ITEMS[item].tool) continue;
        const target = E.target(id, item);
        const stock = E.stock(id, item);
        if (target > 0 && stock < target * 0.5) wants.push([id, item, target - stock]);
      }
    }
    if (!wants.length) return null;
    const [bizId, item, short] = rand.pick(wants);
    const qty = Math.max(5, Math.min(40, Math.round(short)));
    const pay = Math.round(qty * ITEMS[item].basePrice * C.supplyPremium);
    if (E.biz(bizId).money < pay * 0.6) return null; // they can't afford a big order
    return this.base('supply', { bizId, issuer: E.ownerId(bizId), building: E.biz(bizId).building, item, qty, pay, days: rand.int(4, 7) });
  }

  make_craft() {
    const sim = this.sim;
    const E = sim.economy;
    // Workshops that wear out tools order new ones…
    if (rand.chance(0.4)) {
      const users = [...E.ofType('lumberyard').map((id) => [id, 'axe']), ...E.ofType('quarry').map((id) => [id, 'pickaxe']), ...E.ofType('farm').map((id) => [id, 'hoe'])];
      const pick = users.length && rand.pick(users);
      if (!pick) return null;
      const [bizId, item] = pick;
      const qty = rand.int(2, 4);
      const minQ = rand.chance(0.3) ? 2 : STANDARD;
      const pay = Math.round(qty * ITEMS[item].basePrice * Q(minQ).price * C.craftPremium);
      if (E.biz(bizId).money < pay) return null;
      return this.base('craft', { bizId, issuer: E.ownerId(bizId), building: E.biz(bizId).building, item, qty, minQ, pay, days: rand.int(7, 12) });
    }
    // …and villagers with money to spare want furniture for their homes.
    const buyers = sim.state.npcs.filter((n) => n.age >= 20 && n.money >= 160 && n.homeId && !n.away);
    if (!buyers.length) return null;
    const n = rand.pick(buyers);
    const item = rand.weighted([['stool', 3], ['chair', 3], ['table', 2], ['cabinet', 1]]);
    const qty = item === 'cabinet' || item === 'table' ? 1 : rand.int(1, 3);
    const minQ = n.money > 400 && rand.chance(0.5) ? 2 : STANDARD;
    const pay = Math.round(qty * ITEMS[item].basePrice * Q(minQ).price * C.craftPremium);
    if (n.money < pay) return null;
    return this.base('craft', { issuer: n.id, building: n.homeId, item, qty, minQ, pay, days: rand.int(6, 10) });
  }

  make_build() {
    const sites = this.sim.construction.list.filter((c) => c.status === 'site' && c.kind === 'building' && c.owner !== 'player' && c.laborNeeded - c.labor > 180);
    if (!sites.length) return null;
    const c = rand.pick(sites);
    const hours = Math.min(8, Math.floor((c.laborNeeded - c.labor) / 60) - 1);
    if (hours < 3) return null;
    const pay = Math.round(hours * C.buildPayPerHour * 1.5 + 5);
    const payer = c.owner === 'village' ? this.sim.state.village.treasury : this.sim.npcs.byId(c.owner)?.money || 0;
    if (payer < pay) return null;
    return this.base('build', { siteId: c.id, issuer: c.owner, building: c.id, hours, done: 0, pay, days: rand.int(5, 9) });
  }

  make_haul() {
    const E = this.sim.economy;
    const producers = { wood: 'lumberyard', stone: 'quarry', wheat: 'farm', coal: 'quarry', iron_ore: 'quarry' };
    const options = [];
    for (const [item, type] of Object.entries(producers)) {
      for (const from of E.ofType(type)) {
        if (E.stock(from, item) < 15) continue;
        for (const to of E.active()) {
          if (to === from || !E.def(to).buys?.includes(item)) continue;
          if (E.stock(to, item) < E.target(to, item) * 0.6) options.push([from, to, item]);
        }
      }
    }
    if (!options.length) return null;
    const [from, to, item] = rand.pick(options);
    const qty = Math.min(E.stock(from, item) - 5, rand.int(8, 20));
    const route = this.sim.logistics.route(E.biz(from).building, E.biz(to).building);
    const dist = route?.dist || 30;
    const pay = Math.max(6, Math.round(qty * dist * C.haulFeePerUnitTile * ITEMS[item].weight));
    const goods = Math.round(qty * E.unitPrice(from, item));
    if (E.biz(to).money < goods + pay) return null;
    return this.base('haul', { bizId: to, fromBiz: from, issuer: E.ownerId(to), from: E.biz(from).building, building: E.biz(to).building, item, qty, pay, goods, collected: 0, days: rand.int(2, 4) });
  }

  /** A business orders a batch from one of yours (something yours sells or makes, that they use). */
  make_order() {
    const E = this.sim.economy;
    const mine = this.sim.holdings?.mine() || [];
    const options = [];
    for (const sup of mine) {
      const d = E.def(sup);
      const makes = [...new Set([...(d.sells || []), ...Object.keys(d.recipes || {})])];
      for (const cust of E.active()) {
        if (cust === sup || E.biz(cust).owner === 'player') continue;
        for (const item of makes) if (E.def(cust).buys?.includes(item)) options.push([sup, cust, item]);
      }
    }
    // Villagers order for celebrations too, and the village for its feasts.
    for (const sup of mine) {
      const d = E.def(sup);
      for (const item of d.sells || []) if (ITEMS[item]?.food || ITEMS[item]?.category === 'furniture') options.push([sup, null, item]);
    }
    if (!options.length) return null;
    const [supplierBiz, bizId, item] = rand.pick(options);
    const qty = bizId ? rand.int(8, 24) : rand.int(6, 15);
    const pay = Math.round(qty * ITEMS[item].basePrice * 1.2);
    if (bizId) {
      if (E.biz(bizId).money < pay) return null;
      return this.base('order', { bizId, supplierBiz, issuer: E.ownerId(bizId), building: E.biz(bizId).building, item, qty, pay, days: rand.int(7, 14) });
    }
    if (rand.chance(0.4) && this.sim.state.village.treasury >= pay) return this.base('order', { supplierBiz, issuer: 'village', building: 'hall', item, qty, pay, days: rand.int(5, 10), feast: true });
    const host = this.sim.state.npcs.filter((n) => n.age >= 25 && n.money >= pay * 1.5 && n.homeId).sort(() => rand.float() - 0.5)[0];
    if (!host) return null;
    return this.base('order', { supplierBiz, issuer: host.id, building: host.homeId, item, qty, pay, days: rand.int(5, 10), feast: true });
  }

  /** Fill an order from your business's stock: the goods go out by cart, the money into your business's till. */
  fulfilOrder(id) {
    const c = this.S.active.find((x) => x.id === id && x.kind === 'order');
    if (!c) return 0;
    const E = this.sim.economy;
    const have = Math.floor(E.stock(c.supplierBiz, c.item));
    const n = Math.min(have, c.qty - c.delivered);
    if (n <= 0) return 0;
    E.biz(c.supplierBiz).stock[c.item] -= n;
    if (this.sim.logistics && E.biz(c.bizId)) this.sim.logistics.ship(c.supplierBiz, c.bizId, c.item, n);
    else if (E.biz(c.bizId)) E.biz(c.bizId).stock[c.item] = E.stock(c.bizId, c.item) + n;
    c.delivered += n;
    this.sim.toast('toast.order_shipped', { qty: n, item: c.item, left: c.qty - c.delivered }, 'gain');
    if (c.delivered >= c.qty) this.complete(c);
    this.sim.bus.emit('contracts:changed');
    return n;
  }

  // ------------------------------------------------------------------ taking them on

  canAccept(id) {
    const o = this.S.offers.find((x) => x.id === id);
    if (!o) return { ok: false, reason: 'contract_gone' };
    if (this.S.active.length >= C.maxActive) return { ok: false, reason: 'too_many_contracts', params: { n: C.maxActive } };
    return { ok: true };
  }

  accept(id) {
    const chk = this.canAccept(id);
    if (!chk.ok) return chk;
    const o = this.S.offers.find((x) => x.id === id);
    this.S.offers.splice(this.S.offers.indexOf(o), 1);
    o.deadline = this.sim.time.day + o.days;
    o.accepted = this.sim.time.day;
    this.S.active.push(o);
    this.sim.bus.emit('contracts:changed');
    return { ok: true };
  }

  decline(id) {
    this.S.offers = this.S.offers.filter((x) => x.id !== id);
    this.sim.bus.emit('contracts:changed');
  }

  abandon(id) {
    const c = this.S.active.find((x) => x.id === id);
    if (c) this.fail(c, true);
  }

  // ------------------------------------------------------------------ doing the work

  /** Active contracts with something to do at this building (for the interaction menu). */
  at(buildingId) {
    return this.S.active.filter((c) => c.kind !== 'order' && (c.building === buildingId || (c.kind === 'haul' && c.from === buildingId && c.collected < c.qty)));
  }

  /** How many units you could hand over now (only goods of the required quality count). */
  deliverable(c) {
    if (c.kind === 'haul') return Math.min(c.collected - c.delivered, this.sim.inventory.count(c.item));
    const have = c.minQ !== undefined ? countAtLeast(this.sim.inventory.slots, c.item, c.minQ) : this.sim.inventory.count(c.item);
    return Math.min(have, c.qty - c.delivered);
  }

  deliver(id) {
    const c = this.S.active.find((x) => x.id === id);
    if (!c) return 0;
    const n = this.deliverable(c);
    if (n <= 0) return 0;
    const inv = this.sim.inventory;
    if (c.minQ !== undefined) {
      // Hand over pieces that meet the standard — the least fine that still qualify.
      let left = n;
      const slots = inv.slots.filter((s) => s.id === c.item && (s.q ?? STANDARD) >= c.minQ).sort((a, b) => (a.q ?? STANDARD) - (b.q ?? STANDARD));
      for (const s of slots) {
        const take = Math.min(left, s.qty);
        s.qty -= take;
        left -= take;
        if (left <= 0) break;
      }
      for (let i = inv.slots.length - 1; i >= 0; i--) if (inv.slots[i].qty <= 0) inv.slots.splice(i, 1);
      inv.changed();
    } else inv.remove(c.item, n);
    c.delivered += n;
    // Goods go where they were needed.
    const E = this.sim.economy;
    if (c.bizId && E.biz(c.bizId)) E.biz(c.bizId).stock[c.item] = E.stock(c.bizId, c.item) + n;
    this.sim.toast('toast.contract_delivered', { qty: n, item: c.item, left: c.qty - c.delivered }, 'gain');
    if (c.delivered >= c.qty) this.complete(c);
    this.sim.bus.emit('contracts:changed');
    return n;
  }

  /** Haul: pick up the goods at the producer (the buyer pays the producer now). */
  collect(id) {
    const c = this.S.active.find((x) => x.id === id);
    if (!c || c.kind !== 'haul') return 0;
    const E = this.sim.economy;
    const n = Math.min(c.qty - c.collected, E.stock(c.fromBiz, c.item), this.sim.inventory.maxAddable(c.item));
    if (n <= 0) {
      this.sim.toast('reason.too_heavy', {}, 'warn');
      return 0;
    }
    const unit = c.goods / c.qty;
    E.biz(c.fromBiz).stock[c.item] -= n;
    E.biz(c.fromBiz).money += unit * n;
    E.ledger(c.fromBiz, 'rev', unit * n);
    if (E.biz(c.bizId)) {
      E.biz(c.bizId).money -= unit * n;
      E.ledger(c.bizId, 'exp', unit * n);
    }
    this.sim.inventory.add(c.item, n, { force: true });
    c.collected += n;
    this.sim.toast('toast.contract_collected', { qty: n, item: c.item }, 'info');
    this.sim.bus.emit('contracts:changed');
    return n;
  }

  /** Your hours at a building site count towards a build contract there. */
  onBuildWork(site, minutes) {
    for (const c of this.S.active) {
      if (c.kind !== 'build' || c.siteId !== site.id) continue;
      c.done = Math.round((c.done + minutes / 60) * 10) / 10;
      if (c.done >= c.hours) this.complete(c);
      this.sim.bus.emit('contracts:changed');
    }
  }

  /** Progress 0–1. */
  progress(c) {
    if (c.kind === 'build') return Math.min(1, c.done / c.hours);
    return Math.min(1, c.delivered / c.qty);
  }

  // ------------------------------------------------------------------ settling up

  payer(c) {
    if (c.issuer === 'village') return { get: () => this.sim.state.village.treasury, take: (m) => (this.sim.state.village.treasury -= m) };
    if (c.bizId && this.sim.economy.biz(c.bizId)) {
      const b = this.sim.economy.biz(c.bizId);
      return { get: () => b.money, take: (m) => { b.money -= m; this.sim.economy.ledger(c.bizId, 'exp', m); } };
    }
    const n = this.sim.npcs.byId(c.issuer);
    return n ? { get: () => n.money, take: (m) => (n.money -= m) } : { get: () => 0, take: () => {} };
  }

  complete(c) {
    const sim = this.sim;
    this.S.active = this.S.active.filter((x) => x !== c);
    const payer = this.payer(c);
    const paid = Math.max(0, Math.min(c.pay, Math.floor(payer.get())));
    payer.take(paid);
    if (c.kind === 'order' && sim.economy.biz(c.supplierBiz)) {
      // Orders are your business's revenue — and its good name.
      const sup = sim.economy.biz(c.supplierBiz);
      sup.money += paid;
      sim.economy.ledger(c.supplierBiz, 'rev', paid);
      sup.reputation = Math.min(100, (sup.reputation ?? 50) + 3);
    } else sim.state.player.money += paid;
    sim.state.stats.moneyEarned += paid;
    sim.progression.addReputation(C.repOnTime);
    sim.progression.addXp(10 + Math.round(c.pay / 10));
    if (c.kind === 'build') sim.progression.addSkillXp('construction', 5);
    if (c.kind === 'supply' || c.kind === 'haul') sim.progression.addSkillXp('trading', 6);
    const issuer = sim.npcs.byId(c.issuer);
    if (issuer) sim.memory.remember(issuer, 'player_helped', { who: 'player', params: { item: c.item } });
    this.S.done++;
    this.log(c, paid < c.pay ? 'short' : 'done', paid);
    sim.toast(paid < c.pay ? 'toast.contract_short' : 'toast.contract_done', { money: paid, money2: c.pay }, paid < c.pay ? 'warn' : 'good');
    sim.bus.emit('contracts:changed');
    sim.bus.emit('player:changed');
  }

  fail(c, abandoned = false) {
    const sim = this.sim;
    this.S.active = this.S.active.filter((x) => x !== c);
    sim.progression.addReputation(C.repFail);
    if (c.kind === 'order' && sim.economy.biz(c.supplierBiz)) sim.economy.biz(c.supplierBiz).reputation = Math.max(0, (sim.economy.biz(c.supplierBiz).reputation ?? 50) - 6);
    const issuer = sim.npcs.byId(c.issuer);
    if (issuer) sim.memory.remember(issuer, 'player_let_down', { who: 'player' });
    // Hauled goods you never delivered: you owe the buyer what they paid.
    if (c.kind === 'haul' && c.collected > c.delivered) {
      const owed = Math.round((c.goods / c.qty) * (c.collected - c.delivered));
      const take = Math.min(owed, Math.max(0, Math.floor(sim.state.player.money)));
      sim.state.player.money -= take;
      if (sim.economy.biz(c.bizId)) sim.economy.biz(c.bizId).money += take;
    }
    this.S.failed++;
    this.log(c, abandoned ? 'abandoned' : 'failed', 0);
    sim.toast('toast.contract_failed', {}, 'danger');
    sim.bus.emit('contracts:changed');
  }

  log(c, how, paid) {
    this.S.log.push({ id: c.id, kind: c.kind, item: c.item, how, paid, day: this.sim.time.day });
    if (this.S.log.length > 30) this.S.log.shift();
  }
}
