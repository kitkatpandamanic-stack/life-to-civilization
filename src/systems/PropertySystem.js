/**
 * PropertySystem — who owns every building, what it's worth, who lives where.
 *
 *   state.property[buildingId] = {
 *     owner: npcId | 'player' | 'village' | null,
 *     condition: 0–100, abandoned, emptyDays, forSale, rentLevel,
 *     arrears: weeks of unpaid rent, history: [{ owner, from, how, price }]
 *   }
 *
 * A living housing market: tenants pay rent to their landlord (a villager,
 * you, or the village), grown-up children move out, crowded families look
 * for bigger homes, people who save enough buy a house, the poor sell, the
 * evicted end up on the street, and empty houses slowly fall apart.
 */
import { HOME_CAPACITY, PROPERTY_VALUE, PUBLIC_BUILDINGS, HOUSING as H } from '../data/housing.js';
import { AREAS } from '../data/villageLayout.js';
import { rand } from '../core/rng.js';

/** Initial owners of homes that aren't obvious from who lives there. */
const START_OWNERS = { house_4: 'village', house_6: 'village', house_7: 'daria', shack: 'village', hall: 'village', tavern: 'boris' };
export const RENT_LEVELS = { cheap: 0.75, normal: 1, high: 1.3 };

export class PropertySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.property ??= {};
    sim.state.village ??= { treasury: 0 };
    this.valueCache = new Map();
    for (const b of sim.world.buildingList) this.ensure(b.id);
    sim.bus.on('building:added', (id) => this.onBuilt(id));
    sim.bus.on('time:day', () => this.onDay());
  }

  get all() {
    return this.sim.state.property;
  }
  rec(id) {
    return this.all[id] || null;
  }
  building(id) {
    return this.sim.world.buildings[id];
  }
  type(id) {
    const b = this.building(id);
    if (!b) return null;
    if (b.player) return this.sim.construction.byId(id)?.type || b.type;
    return b.type;
  }

  /** Create the property record for a building (first run or older saves). */
  ensure(id) {
    if (this.all[id]) return this.all[id];
    const b = this.building(id);
    if (!b) return null;
    let owner;
    if (b.player) owner = 'player';
    else if (START_OWNERS[id]) owner = START_OWNERS[id];
    else if (PUBLIC_BUILDINGS.includes(id)) owner = 'village';
    else {
      const biz = this.sim.economy.businessAtBuilding(id);
      if (biz) owner = this.sim.economy.ownerId(biz);
      else {
        // A family home belongs to its oldest adult resident.
        const adults = this.sim.npcs.residentsOf(id).filter((n) => n.age >= 18).sort((a, c) => c.age - a.age);
        owner = adults[0]?.id || 'village';
      }
    }
    this.all[id] = { owner, condition: 100, abandoned: false, emptyDays: 0, forSale: false, rentLevel: 'normal', arrears: 0, history: [{ owner, from: 0, how: 'founded' }] };
    return this.all[id];
  }

  onBuilt(id) {
    const c = this.sim.construction.byId(id);
    const owner = c && c.owner && c.owner !== 'player' ? c.owner : 'player';
    const r = this.ensure(id);
    if (r && r.owner !== owner) this.transfer(id, owner, 'built', 0);
    if (r) r.history[r.history.length - 1].how = 'built';
  }

  // ------------------------------------------------------------------ homes

  isHome(id) {
    const type = this.type(id);
    return HOME_CAPACITY[type] !== undefined;
  }

  capacity(id) {
    return HOME_CAPACITY[this.type(id)] || 0;
  }

  occupants(id) {
    return this.sim.npcs.residentsOf(id).length + (this.sim.state.player.homeId === id ? 1 : 0);
  }

  /** A home nobody lives in, fit to live in, that could be rented or bought. */
  isVacant(id) {
    const r = this.rec(id);
    if (!r || !this.isHome(id) || r.abandoned || r.condition < 35) return false;
    if (id === this.sim.state.player.homeId || PUBLIC_BUILDINGS.includes(id)) return false;
    if (this.sim.economy.businessAtBuilding(id)) return false; // the tavern's rooms belong to the innkeeper
    return this.occupants(id) === 0;
  }

  homes() {
    return Object.keys(this.all).filter((id) => this.isHome(id));
  }

  /** Market value: base × condition × location × demand. Cached for the day. */
  value(id) {
    const day = this.sim.time.day;
    const c = this.valueCache.get(id);
    if (c && c.day === day) return c.v;
    const r = this.rec(id);
    const base = PROPERTY_VALUE[this.type(id)] ?? 200;
    const b = this.building(id);
    const P = AREAS.plaza;
    const d = b ? Math.hypot(b.door.tx - (P.x1 + P.x2) / 2, b.door.ty - (P.y1 + P.y2) / 2) : 30;
    const location = 1.2 - Math.min(0.45, d / 90) + (b && this.nearRoad(b) ? 0.08 : 0);
    const cond = 0.25 + 0.75 * ((r?.condition ?? 100) / 100);
    const v = Math.round(base * cond * location * this.demand() * (this.sim.growth?.valueFactor(id) ?? 1));
    this.valueCache.set(id, { day, v });
    return v;
  }

  nearRoad(b) {
    const w = this.sim.world;
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) if (w.isRoad(b.door.tx + dx, b.door.ty + dy)) return true;
    return false;
  }

  /** Housing demand: when homes are full, prices rise; when many stand empty, they fall. */
  demand() {
    const day = this.sim.time.day;
    if (this.demandCache?.day === day) return this.demandCache.v;
    const homes = this.homes().filter((id) => !this.rec(id).abandoned);
    const cap = homes.reduce((s, id) => s + this.capacity(id), 0) || 1;
    const people = this.sim.state.npcs.length + 1;
    const homeless = this.sim.state.npcs.filter((n) => !n.homeId && n.age >= 16).length;
    const v = Math.max(0.6, Math.min(1.8, 0.7 + (people / cap) * 0.5 + homeless * 0.04));
    this.demandCache = { day, v };
    return v;
  }

  weeklyRent(id) {
    const r = this.rec(id);
    return Math.max(3, Math.round(this.value(id) * H.rentPerWeekShare * (RENT_LEVELS[r?.rentLevel] || 1)));
  }

  ownerName(id) {
    return this.rec(id)?.owner;
  }

  /** Does this villager pay rent where they live (and to whom)? */
  landlord(npc) {
    if (!npc.homeId) return null;
    if (npc.homeId === this.sim.state.player.homeId) return null; // your household: you pay
    const r = this.rec(npc.homeId);
    if (!r || !r.owner) return null;
    if (r.owner === npc.id) return null;
    if (r.owner !== 'player' && r.owner !== 'village') {
      const owner = this.sim.npcs.byId(r.owner);
      if (!owner || npc.family.includes(owner.id)) return null; // family doesn't charge family
      if (owner.homeId === npc.homeId && !npc.lodger) return null; // living with the owner as a guest
    }
    if (PUBLIC_BUILDINGS.includes(npc.homeId)) return null;
    return r.owner;
  }

  // ------------------------------------------------------------------ ownership

  transfer(id, owner, how, price = 0) {
    const r = this.ensure(id);
    if (!r) return;
    const last = r.history[r.history.length - 1];
    if (last && last.to === undefined) last.to = this.sim.time.day;
    r.history.push({ owner, from: this.sim.time.day, how, price: price || undefined });
    if (r.history.length > 12) r.history.splice(1, 1); // keep the founder and the recent owners
    r.owner = owner;
    r.forSale = false;
    r.arrears = 0;
    this.sim.bus.emit('property:changed', id);
  }

  /** Pay the seller (a villager, you, or the village). */
  payTo(owner, amount) {
    if (!owner || amount <= 0) return;
    if (owner === 'player') this.sim.state.player.money += amount;
    else if (owner === 'village') this.sim.state.village.treasury += amount;
    else {
      const n = this.sim.npcs.byId(owner);
      if (n) n.money += amount;
      else this.sim.state.village.treasury += amount;
    }
  }

  /** Move villagers into a home (a household moving together, or one person). */
  moveIn(npcs, id, reason = 'moved') {
    for (const n of npcs) {
      const from = n.homeId;
      if (from === id) continue;
      n.homeId = id;
      n.lodger = false;
      n.plan = null;
      if (n.task && ['home', 'sleep', 'rest', 'sick'].includes(n.task.type)) n.task = null;
      if (from) this.sim.memory.remember(n, reason === 'evicted' ? 'evicted' : 'moved_home', { params: { building: id } });
    }
    const r = this.rec(id);
    if (r) {
      r.emptyDays = 0;
      r.arrears = 0;
    }
    this.sim.npcs.invalidateHouseholds();
    for (const n of npcs) this.sim.habits.derive(n);
    this.sim.bus.emit('property:changed', id);
  }

  // ------------------------------------------------------------------ the player

  canPlayerBuy(id) {
    const r = this.rec(id);
    if (!r || r.owner === 'player' || PUBLIC_BUILDINGS.includes(id)) return { ok: false, reason: 'not_for_sale' };
    if (this.sim.economy.businessAtBuilding(id) && !r.abandoned) return { ok: false, reason: 'not_for_sale' };
    const empty = this.occupants(id) === 0;
    const sellable = r.forSale || r.abandoned || (empty && (r.owner === 'village' || !r.owner));
    if (!sellable) return { ok: false, reason: 'not_for_sale' };
    const price = this.value(id);
    if (this.sim.state.player.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    return { ok: true, price };
  }

  playerBuy(id) {
    const chk = this.canPlayerBuy(id);
    if (!chk.ok) return chk;
    const r = this.rec(id);
    this.sim.state.player.money -= chk.price;
    this.payTo(r.owner, chk.price);
    const seller = r.owner;
    this.transfer(id, 'player', 'bought', chk.price);
    const sellerNpc = this.sim.npcs.byId(seller);
    if (sellerNpc) this.sim.memory.remember(sellerNpc, 'sold_home_to_player', { who: 'player', params: { building: id, money: chk.price } });
    this.sim.chronicle('chronicle.player_bought_property', { building: id, money: chk.price });
    this.sim.progression.addXp(20);
    return { ok: true, price: chk.price };
  }

  playerSell(id) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player' || id === this.sim.state.player.homeId) return false;
    r.forSale = true;
    this.sim.bus.emit('property:changed', id);
    return true;
  }

  setRentLevel(id, level) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player' || !RENT_LEVELS[level]) return;
    r.rentLevel = level;
    this.sim.bus.emit('property:changed', id);
  }

  /** Materials and money needed to bring a building back to full condition. */
  restoreCost(id) {
    const r = this.rec(id);
    const missing = Math.max(0, 100 - (r?.condition ?? 100));
    const mats = {};
    for (const [item, per] of Object.entries(H.restorePerCondition)) {
      const q = Math.ceil(missing * per);
      if (q > 0) mats[item] = q;
    }
    return { materials: mats, money: Math.ceil(missing * H.restoreMoneyPerCondition), points: missing };
  }

  canRestore(id) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player') return { ok: false, reason: 'not_yours' };
    const cost = this.restoreCost(id);
    if (!cost.points) return { ok: false, reason: 'no_repair_needed' };
    const inv = this.sim.inventory;
    const home = this.sim.home;
    for (const [item, q] of Object.entries(cost.materials)) {
      if (inv.count(item) + home.storageCount(item) < q) return { ok: false, reason: 'need_item', params: { item, qty: q } };
    }
    if (this.sim.state.player.money < cost.money) return { ok: false, reason: 'no_money', params: { money: cost.money } };
    return { ok: true, cost };
  }

  restore(id) {
    const chk = this.canRestore(id);
    if (!chk.ok) return chk;
    for (const [item, q] of Object.entries(chk.cost.materials)) {
      const fromPockets = this.sim.inventory.remove(item, q);
      if (fromPockets < q) this.sim.home.take(item, q - fromPockets);
    }
    this.sim.state.player.money -= chk.cost.money;
    const r = this.rec(id);
    r.condition = 100;
    r.abandoned = false;
    r.emptyDays = 0;
    this.sim.progression.addXp(30);
    this.sim.progression.addSkillXp('construction', 30);
    this.sim.chronicle('chronicle.building_restored', { building: id });
    this.sim.bus.emit('property:changed', id);
    this.sim.bus.emit('building:changed', id);
    return { ok: true };
  }

  // ------------------------------------------------------------------ daily & weekly

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    for (const [id, r] of Object.entries(this.all)) {
      if (!this.building(id)) continue;
      const biz = sim.economy.businessAtBuilding(id);
      const inUse = this.occupants(id) > 0 || (biz && !sim.economy.biz(biz)?.closed) || sim.businesses.atBuilding(id) || PUBLIC_BUILDINGS.includes(id) || this.type(id) === 'well' || this.type(id) === 'storage_shed';
      const wasAbandoned = r.abandoned;
      const ownerAlive = r.owner === 'player' || r.owner === 'village' || !!sim.npcs.byId(r.owner);
      if (inUse) {
        r.emptyDays = 0;
        // Owners keep their buildings in repair — it costs money (timber from the lumberyard).
        const owner = sim.npcs.byId(r.owner);
        let repaired = false;
        if (r.condition < 100) {
          if (r.owner === 'village' && sim.state.village.treasury >= H.repairCostPerDay) {
            sim.state.village.treasury -= H.repairCostPerDay;
            repaired = true;
          } else if (owner && owner.money >= H.repairCostPerDay + 5) {
            owner.money -= H.repairCostPerDay;
            repaired = true;
          } else if (r.owner === 'player') repaired = true; // you maintain your own buildings
          if (repaired && r.owner !== 'player') {
            const yard = sim.economy.biz('lumberyard');
            if (yard) yard.money += H.repairCostPerDay;
          }
        }
        r.condition = Math.max(0, Math.min(100, r.condition + (repaired ? H.ownerRepairPerDay - H.wearPerDay : -H.wearPerDay)));
      } else {
        r.emptyDays++;
        // Empty homes of living owners are looked after (they're for rent); ownerless ones are left to rot.
        if (r.owner === 'player' || (ownerAlive && r.owner !== 'village' && this.isHome(id))) r.condition = Math.max(0, r.condition - H.wearPerDay);
        else if (r.emptyDays >= H.abandonAfterDays) r.abandoned = true;
        if (r.abandoned) r.condition = Math.max(0, r.condition - H.abandonedDecayPerDay);
      }
      if (!ownerAlive && r.owner) {
        // Nobody left to claim it: the village takes it over.
        this.transfer(id, 'village', 'escheat');
      }
      if (r.abandoned && !wasAbandoned) {
        sim.chronicle('chronicle.building_abandoned', { building: id });
        sim.bus.emit('building:changed', id);
      }
      if (r.condition < H.ruinBelow && !r.ruined) {
        r.ruined = true;
        sim.chronicle('chronicle.building_ruined', { building: id });
        sim.bus.emit('building:changed', id);
      } else if (r.ruined && r.condition >= H.ruinBelow) r.ruined = false;
    }
    if (sim.time.weekday === 0) {
      this.collectRent();
      this.market();
    }
    this.familySupport();
    if (day % 7 === 3) this.valueCache.clear();
  }

  /** Rent day: tenants pay their landlord. Those who can't fall behind — and eventually out. */
  collectRent() {
    const sim = this.sim;
    const byHome = new Map();
    for (const n of sim.state.npcs) {
      if (!n.homeId || n.age < 16) continue;
      const landlord = this.landlord(n);
      if (!landlord) continue;
      if (!byHome.has(n.homeId)) byHome.set(n.homeId, { landlord, payers: [] });
      byHome.get(n.homeId).payers.push(n);
    }
    // Businesses in rented premises (that nobody lives in) pay commercial rent from the till.
    const E = sim.economy;
    for (const bizId of E.active()) {
      const b = E.biz(bizId);
      const r = this.rec(b.building);
      if (!r || !r.owner || r.owner === b.owner || byHome.has(b.building) || PUBLIC_BUILDINGS.includes(b.building)) continue;
      if (sim.npcs.residentsOf(b.building).length) continue;
      const rent = this.weeklyRent(b.building);
      const paid = Math.min(rent, Math.max(0, Math.floor(b.money)));
      b.money -= paid;
      E.ledger(bizId, 'exp', paid);
      this.payTo(r.owner, paid);
      if (r.owner === 'player' && paid > 0) sim.toast('toast.rent_received', { money: paid, building: b.building }, 'gain');
    }
    for (const [id, { landlord, payers }] of byHome) {
      const r = this.rec(id);
      // Lodgers rent a room, not the whole house.
      const rent = Math.ceil(this.weeklyRent(id) * (payers.every((p) => p.lodger) ? 0.5 : 1));
      const share = Math.ceil(rent / payers.length);
      let paid = 0;
      for (const n of payers) {
        const x = Math.min(share, Math.max(0, Math.floor(n.money)));
        n.money -= x;
        paid += x;
      }
      this.payTo(landlord, paid);
      if (landlord === 'player' && paid > 0) sim.toast('toast.rent_received', { money: paid, building: id }, 'gain');
      if (paid < rent * 0.7) {
        r.arrears++;
        const limit = landlord === 'village' ? H.villageEvictWeeks : H.landlordEvictWeeks;
        if (r.arrears >= limit) this.evict(id, payers, landlord);
      } else r.arrears = 0;
    }
  }

  evict(id, payers, landlord) {
    const household = this.sim.npcs.residentsOf(id).slice();
    for (const n of household) {
      n.homeId = null;
      n.plan = null;
      n.task = null;
      n.evictedFrom ??= {};
      n.evictedFrom[id] = this.sim.time.day;
      this.sim.memory.remember(n, 'evicted', { who: landlord === 'player' ? 'player' : this.sim.npcs.byId(landlord) ? landlord : null, params: { building: id } });
    }
    this.sim.npcs.invalidateHouseholds();
    this.rec(id).arrears = 0;
    this.sim.chronicle('chronicle.npc_evicted', { npc: payers[0].id, gender: payers[0].gender, building: id });
    if (landlord === 'player') this.sim.progression.addReputation(-2);
  }

  /**
   * Family looks after its own: relatives with savings help those who are broke.
   * The village (funded by rent from the homes it owns) pays the elders' pensions
   * and gives poor relief to those with no one — so its income flows back into the village.
   */
  familySupport() {
    const village = this.sim.state.village;
    for (const n of this.sim.state.npcs) {
      if (n.age < 16 || n.money >= H.supportBelowMoney) continue;
      const helper = this.sim.family.relatives(n).find((r) => r.money >= H.supportAbove && r.age >= 18);
      if (helper) {
        helper.money -= H.supportAmount;
        n.money += H.supportAmount;
      } else if (village.treasury >= H.reliefAmount && n.age >= 18) {
        village.treasury -= H.reliefAmount;
        n.money += H.reliefAmount;
      }
    }
  }

  /** Elders' pension comes out of the village treasury (a little extra from outside if it's empty). */
  payPension(npc, amount) {
    const village = this.sim.state.village;
    const fromVillage = Math.min(amount, Math.max(0, village.treasury));
    village.treasury -= fromVillage;
    npc.money += fromVillage + (amount - fromVillage) * 0.5;
  }

  // ------------------------------------------------------------------ the housing market

  /** Homes available to move into, best first for this household. */
  options(size, maxRent, buyBudget = 0, npc = null) {
    const out = [];
    const day = this.sim.time.day;
    for (const id of this.homes()) {
      if (!this.isVacant(id) || this.capacity(id) < size) continue;
      // A landlord won't take back a tenant they evicted (for a good while).
      if (npc?.evictedFrom?.[id] !== undefined && day - npc.evictedFrom[id] < 84) continue;
      const r = this.rec(id);
      const price = this.value(id);
      const buyable = buyBudget > 0 && (r.forSale || r.owner === 'village' || !r.owner) && buyBudget >= price;
      const rent = this.weeklyRent(id);
      if (!buyable && rent > maxRent) continue;
      out.push({ id, buy: buyable, price, rent, score: (buyable ? 50 : 0) - rent + this.capacity(id) * 2 + r.condition / 20 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** A spare room in someone else's house (a lodger pays a share of the rent). */
  lodging(n) {
    const budget = this.rentBudget(n);
    let best = null;
    for (const id of this.homes()) {
      const r = this.rec(id);
      if (!r || r.abandoned || r.condition < 40 || id === 'hall' || id === this.sim.state.player.homeId) continue;
      if (this.sim.economy.businessAtBuilding(id) || this.occupants(id) === 0 || this.occupants(id) >= this.capacity(id)) continue;
      if (n.evictedFrom?.[id] !== undefined) continue;
      const share = Math.ceil(this.weeklyRent(id) / 2);
      if (share > budget) continue;
      const host = this.sim.npcs.residentsOf(id)[0];
      const bond = host && this.sim.social.bond(host, n);
      if (bond && bond.c >= 30) continue; // not with someone who can't stand them
      const score = (bond?.f || 0) - share;
      if (!best || score > best.score) best = { id, score };
    }
    return best?.id || null;
  }

  /** What can this person afford per week? (Roughly a third of what they earn, or their savings.) */
  rentBudget(npc) {
    const occ = this.sim.npcs.occ(npc);
    const weekly = (occ.wage || (npc.owns ? 20 : npc.employer === 'player' ? this.sim.workers.contract(npc.id)?.salary || 10 : 0)) * 6;
    return Math.max(weekly * 0.35, npc.money / 6);
  }

  /** Complete a move: buy or rent `opt` for `members`. */
  settle(members, opt, head, reason) {
    const id = opt.id;
    if (opt.buy) {
      const r = this.rec(id);
      head.money -= opt.price;
      this.payTo(r.owner, opt.price);
      this.transfer(id, head.id, 'bought', opt.price);
      this.sim.memory.remember(head, 'bought_home', { params: { building: id, money: opt.price } });
      this.sim.chronicle('chronicle.npc_bought_home', { npc: head.id, gender: head.gender, building: id });
    }
    this.moveIn(members, id, reason);
  }

  market() {
    const sim = this.sim;
    const npcs = sim.state.npcs;
    // 1. Homeless people look for a roof: family first, then anything they can afford.
    for (const n of npcs.filter((x) => !x.homeId && x.age >= 16)) {
      const kinHome = sim.family.relatives(n).map((r) => r.homeId).find((h) => h && this.isHome(h) && this.occupants(h) < this.capacity(h) + 1 && !this.sim.economy.businessAtBuilding(h));
      if (kinHome) {
        this.moveIn([n], kinHome, 'moved');
        continue;
      }
      const opt = this.options(1, this.rentBudget(n), n.money / H.buyReserve, n)[0];
      if (opt) this.settle([n], opt, n, 'moved');
      else {
        // No house free? Lodge in a spare room (paying the householder), or the village hall takes them in.
        const room = this.lodging(n);
        if (room) {
          this.moveIn([n], room, 'moved');
          n.lodger = true;
        } else if (this.occupants('hall') < this.capacity('hall')) this.moveIn([n], 'hall', 'moved');
      }
    }
    // Minors without a home go with a relative (or the village hall looks after them).
    for (const n of npcs.filter((x) => !x.homeId && x.age < 16)) {
      const kin = sim.family.relatives(n).find((r) => r.homeId);
      this.moveIn([n], kin ? kin.homeId : 'hall', 'moved');
    }
    // 2. Grown-up children move out of their parents' home.
    for (const n of npcs) {
      if (n.age < H.moveOutAge || n.kin?.spouse || n.money < H.moveOutMoney || !n.homeId) continue;
      if (!(n.employer || n.owns)) continue;
      const withParents = n.kin?.parents.some((pid) => sim.npcs.byId(pid)?.homeId === n.homeId);
      if (!withParents || !rand.chance(H.moveOutChance)) continue;
      const opt = this.options(1, this.rentBudget(n), n.money / H.buyReserve)[0];
      if (!opt) continue;
      this.settle([n], opt, n, 'moved');
      sim.memory.remember(n, 'moved_out', { params: { building: opt.id } });
      sim.chronicle('chronicle.npc_moved_out', { npc: n.id, gender: n.gender, building: opt.id });
    }
    // 3. Crowded households — or those whose home is falling apart — look for something better (buying if they can).
    const seen = new Set();
    for (const n of npcs) {
      if (!n.homeId || seen.has(n.homeId) || n.age < 18) continue;
      seen.add(n.homeId);
      const home = n.homeId;
      const household = sim.npcs.residentsOf(home);
      const crumbling = (this.rec(home)?.condition ?? 100) < 20;
      if ((household.length <= this.capacity(home) && !crumbling) || sim.economy.businessAtBuilding(home)) continue;
      // The family (this person, spouse, children living here) moves together.
      const fam = household.filter((m) => m === n || n.family.includes(m.id));
      const head = fam.filter((m) => m.age >= 18).sort((a, b) => b.money - a.money)[0] || n;
      const opt = this.options(fam.length, this.rentBudget(head) * 1.3, head.money / H.buyReserve)[0];
      if (opt) this.settle(fam, opt, head, 'moved');
    }
    // 4. Tenants who have saved enough buy their home (or another one) — and stop paying rent.
    for (const n of npcs) {
      if (!n.homeId || n.age < 21 || !this.landlord(n)) continue;
      const r = this.rec(n.homeId);
      const price = this.value(n.homeId);
      const sellerOk = r.owner === 'village' || r.forSale || (sim.npcs.byId(r.owner)?.money ?? 999) < 40;
      if (sellerOk && r.owner !== 'player' && n.money >= price * H.buyReserve) {
        n.money -= price;
        this.payTo(r.owner, price);
        this.transfer(n.homeId, n.id, 'bought', price);
        sim.memory.remember(n, 'bought_home', { params: { building: n.homeId, money: price } });
        sim.chronicle('chronicle.npc_bought_home', { npc: n.id, gender: n.gender, building: n.homeId });
      }
    }
    // 5. Owners who stay broke week after week put their home up for sale; if things improve, they take it off.
    for (const n of npcs) n.brokeWeeks = n.money < H.sellBelowMoney ? (n.brokeWeeks || 0) + 1 : 0;
    for (const [id, r] of Object.entries(this.all)) {
      const owner = sim.npcs.byId(r.owner);
      if (owner && this.isHome(id) && owner.brokeWeeks >= 4 && !r.forSale && owner.age >= 18) r.forSale = true;
      else if (owner && r.forSale && owner.homeId === id && owner.money > 80) r.forSale = false;
      // Owners who don't live in a second home rent it out; an empty inherited house goes on sale.
      if (owner && this.isHome(id) && owner.homeId !== id && this.occupants(id) === 0 && r.emptyDays > 21) r.forSale = true;
    }
  }
}
