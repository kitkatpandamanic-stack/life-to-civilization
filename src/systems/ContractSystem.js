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
 *   harvest — a farmer whose fields are full of ripe wheat, more than they can bring in alone
 *   repair  — an owner whose house or workshop is badly worn
 *
 * They're posted on the notice board — and the people who need the work ask you
 * themselves when you talk to them (offerFromTalk). Accept one, do the work in the
 * world (deliver at the building's door, work at the site, harvest the real field,
 * repair the real building, collect and carry), and get paid by whoever asked — from
 * their own money. Miss the deadline and people remember.
 *
 * You needn't do it all yourself: harvest, repair, building and haulage contracts can
 * be handed to your hired workers (assign) — they walk there and do the same work
 * with their own hands (WorkerSystem), alone, together, or alongside you. What each
 * of you did is kept (c.crew), so at the end the client pays you, you gain experience
 * as the one who took the job on and ran it, and each worker gains experience for the
 * work they did — each exactly once (c.awarded), however often the game is saved and
 * loaded. The more contracts you see through, the bigger the ones you're trusted with
 * (CONTRACTOR_RANKS).
 *
 * What villagers need and how pressing it is, sizes and requirements, estimates and costs,
 * negotiating, judging the work, your name, clients who come back, your firm: ContractPlanner
 * (mixed into this system).
 *
 *   state.contracts = { offers: [], active: [], nextId, done, failed, log: [], tracked, declined: {},
 *                       rep, clients: { npcId: { done, late, failed, cancelled, q, n, pay } }, company }
 *   a contract: { id, kind, issuer, building, qty | hours, done, pay, deadline, status,
 *                 workers: [npcId], crew: { who: work }, awarded: { pay, xp, workers }, … }
 */
import { rand } from '../core/rng.js';
import { ITEMS } from '../data/items.js';
import { Q, STANDARD } from '../data/quality.js';
import { countAtLeast } from './slots.js';
import { Mod } from './Modifiers.js';
import { JOBS } from '../data/jobs.js';
import { BALANCE } from '../config/balance.js';
import { ContractPlanner } from './ContractPlanner.js';
import { STANDINGS, REPUTATION, QUALITY } from '../data/contracting.js';

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
  // Work villagers ask you for in person (and you can hand to your workers).
  harvestMin: 12, // ripe plants in a farm's fields before the farmer wants help
  harvestSize: 18, // plants in a job (times your contractor rank's size)
  harvestPerPlant: 2.2, // paid per plant brought in
  fieldReach: 26, // a farm's fields: crops this close to the farmhouse
  plantsPerWorker: 16, // hands a harvest wants
  repairBelow: 60, // a building this worn: its owner wants it seen to
  repairTo: 95,
  repairPerPoint: 1.4,
  pointsPerWorker: 20,
  playerRepairPerHour: 10, // condition points an hour of your repairs brings back
  hoursPerWorker: 5,
  // Experience: you, for taking the job on and seeing it through (whoever did the work)…
  xpBase: 12,
  xpPerPay: 0.25,
  leadXp: 24, // Leadership, when your workers did the work
  // …and each worker, for the work they did.
  workerXp: 12,
  workerXpPerPay: 0.08,
  workerPractice: 3,
  waitingAfter: 240, // minutes without any work done: the job is waiting
};
const C = CONTRACTS;

/**
 * Contracts your workers can do for you — all of them: you're the one who took the job on and
 * gets paid; they do the work (and you pay their wages as always). Goods come from your storage,
 * are bought with your money (within the day's limit) or gathered; orders go out from your
 * business; shifts are worked; parcels and letters are carried round.
 */
export const DELEGABLE = ['harvest', 'repair', 'build', 'haul', 'supply', 'craft', 'order', 'job', 'water'];
/** What villagers ask you for to your face (the rest are on the notice board). */
const TALK_KINDS = ['harvest', 'repair', 'build', 'haul', 'water', 'supply'];
/** What each kind of contract work trains, in a worker (education fields). */
export const CONTRACT_FIELDS = { harvest: 'farming', water: 'farming', repair: 'building', build: 'building', haul: 'trade', supply: 'trade', craft: 'trade', order: 'trade' };
/** Your skills → the trades workers learn (for jobs from the notice board). */
const SKILL_FIELDS = { farming: 'farming', construction: 'building', woodcutting: 'forestry', mining: 'mining', crafting: 'carpentry', trading: 'trade', fishing: 'fishing' };
/** Goods workers can go and gather themselves when nobody has them to sell. */
export const GATHERABLE = { wood: 'tree', stone: 'rock', berries: 'bush' };

/** From odd jobs to a name for yourself: more contracts at once, and bigger ones (data/contracting.js). */
export const CONTRACTOR_RANKS = STANDINGS;

export class ContractSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.contracts ??= { offers: [], active: [], nextId: 1, done: 0, failed: 0, log: [] };
    this.S.declined ??= {};
    this.S.rep ??= REPUTATION.start;
    this.S.clients ??= {};
    for (const c of this.S.active) this.normalize(c);
    sim.bus.on('time:hour', (h) => {
      if (h === 6) this.daily();
      this.hourly();
    });
    sim.bus.on('construction:player_worked', ({ site, minutes }) => this.onBuildWork(site, minutes));
    sim.bus.on('player:action', (e) => {
      if (e.kind === 'harvest') this.onPlayerHarvest(e);
      if (e.kind === 'water_crop') this.onPlayerWater(e);
    });
  }

  /** A contract taken on, filled in (older saves too). */
  normalize(c) {
    c.workers ??= [];
    c.crew ??= {};
    c.awarded ??= {};
    c.done ??= 0;
    c.status ??= 'accepted';
    c.costs ??= { materials: 0, wages: 0 };
    return c;
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
    for (const c of this.S.active.slice()) {
      // Past the deadline: late (docked pay) for a couple of days — then it's fallen through.
      if (day > c.deadline + QUALITY.graceDays) this.fail(c);
      else if (day > c.deadline && !c.late) {
        c.late = true;
        this.addRep(REPUTATION.late);
        this.sim.progression.addReputation(-1); // (the village hears of it too)
        this.sim.toast('toast.contract_late', { npc: c.issuer !== 'village' ? c.issuer : undefined }, 'danger');
      }
    }
    // What people need most, first (each of them once).
    for (const o of this.boardNeeds(Math.max(1, Math.floor(C.maxOffers / 2)))) if (this.S.offers.length < C.maxOffers && !this.duplicate(o)) this.S.offers.push(o);
    let tries = 0;
    while (this.S.offers.length < C.maxOffers && tries++ < 12) {
      const kind = rand.weighted([['supply', 3], ['craft', 2], ['build', 2], ['haul', 2], ['harvest', 2], ['repair', 2], ['order', this.sim.holdings?.mine().length ? 3 : 0]]);
      const o = this[`make_${kind}`]?.();
      if (o && !this.duplicate(o)) this.S.offers.push(this.assess(o));
    }
    this.S.offers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const [id, d] of Object.entries(this.S.declined)) if (d < day) delete this.S.declined[id];
  }

  /** Every hour: how each job you've taken on stands (working, waiting…). */
  hourly() {
    for (const c of this.S.active) {
      this.normalize(c);
      c.status = this.statusOf(c);
      // Workers who've left your service are off the job.
      c.workers = c.workers.filter((id) => this.sim.workers.contract(id));
    }
    // (All the work in? Settled first.) The need is gone (winter took the fields, the building's gone): the client calls it off.
    for (const c of this.S.active.slice()) if (!this.checkDone(c) && !this.stillNeeded(c)) this.clientCancel(c);
    // (All the work in, and somehow not settled? Settle it.)
    for (const c of this.S.active.slice()) this.checkDone(c);
  }

  duplicate(o) {
    return [...this.S.offers, ...this.S.active].some((x) => x.kind === o.kind && x.item === o.item && x.building === o.building && x.siteId === o.siteId);
  }

  /** Is the need behind an offer still there? */
  stillWanted(o) {
    if (o.kind === 'build' && o.proposal) return !!this.sim.npcs.byId(o.issuer) && !this.sim.growth.projectOf?.(this.sim.npcs.byId(o.issuer));
    if (o.kind === 'build') return this.sim.construction.byId(o.siteId)?.status === 'site';
    if (o.kind === 'water') return this.dryPlants(o.bizId).length >= Math.min(o.qty, 6) && this.sim.weather.type !== 'rain';
    if (o.kind === 'harvest' && this.ripe(o.bizId).length < Math.min(o.qty, C.harvestMin)) return false;
    if (o.kind === 'repair') {
      const r = this.sim.property.rec(o.building);
      if (!r || r.ruined || r.condition >= C.repairTo - 5 || !this.sim.world.buildings[o.building]) return false;
    }
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

  /** Building work on a villager's (or the village's) site. `who`: only their own site, and no dice. */
  make_build(who = null) {
    const sites = this.sim.construction.list.filter((c) => c.status === 'site' && (c.kind === 'building' || c.kind === 'works') && c.owner !== 'player' && !c.contractor && c.laborNeeded - c.labor > 180 && (!who || c.owner === who.id));
    if (!sites.length) return null;
    const c = who ? sites[0] : rand.pick(sites);
    const hours = Math.min(Math.round(8 * this.rank().size), Math.floor((c.laborNeeded - c.labor) / 60) - 1);
    if (hours < 3) return null;
    const pay = Math.round(hours * C.buildPayPerHour * 1.5 + 5);
    const payer = c.owner === 'village' ? this.sim.state.village.treasury : this.sim.npcs.byId(c.owner)?.money || 0;
    if (payer < pay) return null;
    return this.base('build', { siteId: c.id, siteKind: c.kind, issuer: c.owner, building: c.kind === 'works' ? c.target : c.id, hours, done: 0, pay, days: who ? 6 : rand.int(5, 9) });
  }

  // --- the harvest: a farmer's own fields, full of ripe wheat

  /** The crops of a farm: the planted rows near its farmhouse (worked out once — the rows don't move). */
  fieldsOf(bizId) {
    this.fieldCache ??= {};
    if (this.fieldCache[bizId]) return this.fieldCache[bizId];
    const b = this.sim.world.buildings[this.sim.economy.biz(bizId)?.building];
    if (!b) return [];
    const out = [];
    for (const id in this.sim.state.objects) {
      const o = this.sim.state.objects[id];
      if (o.kind === 'crop' && Math.abs(o.tx - b.door.tx) + Math.abs(o.ty - b.door.ty) <= C.fieldReach) out.push(id);
    }
    return (this.fieldCache[bizId] = out);
  }
  /** Ripe plants in a farm's fields. */
  ripe(bizId) {
    const objs = this.sim.state.objects;
    return this.fieldsOf(bizId).map((id) => objs[id]).filter((o) => o && o.stage >= 3);
  }
  /** The farm whose fields a crop is in. */
  farmOf(obj) {
    return this.sim.economy.ofType('farm').find((id) => this.fieldsOf(id).includes(obj.id)) || null;
  }

  /** A farmer with more ripe wheat than they can bring in alone. `who`: only theirs. */
  make_harvest(who = null) {
    const E = this.sim.economy;
    if (this.sim.time.season === 'winter') return null;
    const farms = E.ofType('farm').filter((id) => E.biz(id) && !E.biz(id).closed && E.ownerId(id) && (!who || E.ownerId(id) === who.id));
    const options = farms.map((id) => [id, this.ripe(id).length]).filter(([, n]) => n >= C.harvestMin);
    if (!options.length) return null;
    const [bizId, ripe] = who ? options[0] : rand.pick(options);
    const qty = Math.min(ripe, Math.round(C.harvestSize * this.rank().size));
    const pay = Math.round(qty * C.harvestPerPlant);
    if (E.biz(bizId).money < pay * 0.6) return null;
    return this.base('harvest', { bizId, issuer: E.ownerId(bizId), building: E.biz(bizId).building, item: 'wheat', qty, done: 0, owed: 0, pay, days: 2 });
  }

  // --- repairs: a real building, badly worn

  /** Someone's house or workshop in poor repair (not yours, not a ruin). `who`: only theirs. */
  make_repair(who = null) {
    const sim = this.sim;
    const options = [];
    for (const [id, r] of Object.entries(sim.property.all)) {
      if (r.ruined || r.condition >= C.repairBelow || !sim.world.buildings[id] || sim.construction.byId(id)?.status === 'site') continue;
      const owner = r.owner === 'village' ? 'village' : sim.npcs.byId(r.owner)?.id;
      if (!owner || (who && owner !== who.id)) continue;
      if (sim.structures?.works(id)) continue; // being worked on already
      options.push([id, owner, r.condition]);
    }
    if (!options.length) return null;
    const [building, issuer, cond] = who ? options.sort((a, b) => a[2] - b[2])[0] : rand.pick(options);
    const qty = Math.round(C.repairTo - cond);
    const pay = Math.round(qty * C.repairPerPoint);
    // A workshop's repairs are paid by the business; a home's by its owner.
    const E = sim.economy;
    const biz = E.businessAtBuilding(building);
    const viaBiz = biz && E.ownerId(biz) === issuer && !E.biz(biz)?.closed ? biz : null;
    const money = issuer === 'village' ? sim.state.village.treasury : viaBiz ? E.biz(viaBiz).money : sim.npcs.byId(issuer).money;
    if (money < pay * 0.8) return null;
    return this.base('repair', { issuer, building, qty, done: 0, pay, days: 4, ...(viaBiz ? { bizId: viaBiz } : {}) });
  }

  make_haul(who = null) {
    const E = this.sim.economy;
    const producers = { wood: 'lumberyard', stone: 'quarry', wheat: 'farm', coal: 'quarry', iron_ore: 'quarry' };
    const options = [];
    for (const [item, type] of Object.entries(producers)) {
      for (const from of E.ofType(type)) {
        if (E.stock(from, item) < 15) continue;
        for (const to of E.active()) {
          if (to === from || !E.def(to).buys?.includes(item) || (who && E.ownerId(to) !== who.id)) continue;
          if (E.stock(to, item) < E.target(to, item) * 0.6) options.push([from, to, item]);
        }
      }
    }
    if (!options.length) return null;
    const [from, to, item] = who ? options[0] : rand.pick(options);
    const qty = Math.min(E.stock(from, item) - 5, who ? 14 : rand.int(8, 20));
    const route = this.sim.logistics.route(E.biz(from).building, E.biz(to).building);
    const dist = route?.dist || 30;
    const pay = Math.max(6, Math.round(qty * dist * C.haulFeePerUnitTile * ITEMS[item].weight));
    const goods = Math.round(qty * E.unitPrice(from, item));
    if (E.biz(to).money < goods + pay) return null;
    return this.base('haul', { bizId: to, fromBiz: from, issuer: E.ownerId(to), from: E.biz(from).building, building: E.biz(to).building, item, qty, pay, goods, collected: 0, days: who ? 3 : rand.int(2, 4) });
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
    if (this.S.active.length >= this.maxActive()) return { ok: false, reason: 'too_many_contracts', params: { n: this.maxActive() } };
    // Big building work needs a skilled hand: you, or a worker of yours.
    const req = this.requirements(o);
    if (req.required && !this.meets(o)) return { ok: false, reason: 'need_skilled_hand', params: { field: req.field, n: req.level } };
    return { ok: true };
  }

  /** Take it on. opts.materials (for new buildings and improvements): 'client' · 'included' · 'player'. */
  accept(id, opts = {}) {
    const chk = this.canAccept(id);
    if (!chk.ok) return chk;
    const o = this.S.offers.find((x) => x.id === id);
    this.assess(o);
    if (o.proposal && !o.siteId) {
      const r = this.startProposal(o, opts.materials || 'client');
      if (!r.ok) {
        this.S.offers = this.S.offers.filter((x) => x !== o);
        this.sim.bus.emit('contracts:changed');
        return r;
      }
    }
    this.S.offers.splice(this.S.offers.indexOf(o), 1);
    o.deadline = this.sim.time.day + o.days;
    o.accepted = this.sim.time.day;
    o.acceptedAt = this.sim.time.total;
    // What it should take (with the hands it wants) — the yardstick for how fast it was done.
    o.expectHours = Math.max(4, this.estimate(o, this.recommended(o)).days * 24);
    o.contractor = 'player';
    this.normalize(o).status = 'accepted';
    this.S.active.push(o);
    this.sim.bus.emit('contracts:changed');
    this.sim.workers.mgr?.() && this.sim.workers.manage(); // your manager (if you have one) sees to it straight away
    return { ok: true };
  }

  decline(id) {
    const o = this.S.offers.find((x) => x.id === id);
    // Turned down to their face: they won't ask again today.
    if (o?.via === 'talk' && o.issuer) this.S.declined[o.issuer] = this.sim.time.day;
    this.S.offers = this.S.offers.filter((x) => x.id !== id);
    this.sim.bus.emit('contracts:changed');
  }

  // ------------------------------------------------------------------ asked in person

  /**
   * The work this villager needs done and would ask you for — from their real situation:
   * a farmer's ripe fields, their worn house or workshop, their building site, goods their
   * business is short of. Null if they need nothing (or you've a job of theirs on already).
   */
  needOf(npc) {
    if (!npc || npc.age < 18 || this.S.active.some((c) => c.issuer === npc.id)) return null;
    const offered = this.S.offers.find((o) => o.issuer === npc.id && (o.via === 'talk' || TALK_KINDS.includes(o.kind) || o.proposal));
    if (offered) return this.assess(offered);
    if (this.S.declined[npc.id] >= this.sim.time.day) return null;
    return this.needs(npc)[0] || null;
  }

  /** They ask you: the offer goes on the table (and stays on the board for a day or two). */
  offerFromTalk(npc) {
    const o = this.needOf(npc);
    if (!o) return null;
    if (!this.S.offers.includes(o)) {
      o.via = 'talk';
      this.S.offers.push(o);
      this.sim.bus.emit('contracts:changed');
    }
    return o;
  }

  /** Hands a job wants: a farmer's field goes quicker with more pickers. */
  recommended(c) {
    if (c.kind === 'harvest') return Math.max(1, Math.ceil(c.qty / C.plantsPerWorker));
    if (c.kind === 'repair') return Math.max(1, Math.min(3, Math.ceil(c.qty / C.pointsPerWorker)));
    if (c.kind === 'build') return Math.max(1, Math.min(4, Math.ceil(c.hours / C.hoursPerWorker)));
    if (c.kind === 'haul' || c.kind === 'supply' || c.kind === 'craft') return Math.max(1, Math.ceil(c.qty / 20));
    if (c.kind === 'job' && (c.type === 'deliver' || c.type === 'haul')) return Math.max(1, Math.ceil(c.qty / 20));
    return 1;
  }
  /** The trade a contract's work trains, in a worker. */
  fieldOf(c) {
    if (c.kind === 'job') return SKILL_FIELDS[JOBS[c.jobId]?.skill] || 'trade';
    return CONTRACT_FIELDS[c.kind] || null;
  }
  /** Experience the job brings you (for taking it on and seeing it through) and the crew. */
  playerXp(c) {
    return Math.round((C.xpBase + c.pay * C.xpPerPay) * (1 + 0.1 * CONTRACTOR_RANKS.indexOf(this.rank())));
  }
  workerXp(c) {
    return Math.round(C.workerXp + c.pay * C.workerXpPerPay);
  }
  /** How much work the job is: plants, condition points, hours, goods. */
  required(c) {
    return c.kind === 'build' || (c.kind === 'job' && c.type === 'shift') ? c.hours : c.qty;
  }
  /** Goods on their way: things workers carry for a job that aren't handed over yet. */
  carriedQty(c) {
    let n = 0;
    for (const x of this.sim.state.npcs) if (x.carry?.contract === c.id && x.carry.item === c.item) n += x.carry.qty;
    return n;
  }
  /** Goods still to be brought (none counted twice: not what's handed over, not what's on the way). */
  goodsLeft(c) {
    return Math.max(0, c.qty - (c.delivered || 0) - this.carriedQty(c));
  }
  /** Where a job's goods go: the business that wants them, or the person (their home, the hall). */
  destOf(c) {
    return c.bizId && this.sim.economy.biz(c.bizId) ? `ebiz:${c.bizId}` : `bld:${c.building}`;
  }
  /** Is it a job of bringing goods (from your storage, the market or the woods)? */
  isGoods(c) {
    return c.kind === 'supply' || c.kind === 'craft' || (c.kind === 'job' && c.type === 'deliver');
  }
  /** What's holding your workers up, in words (for the card): nothing to fetch, buy or gather; nothing in stock. */
  blocker(c) {
    if (!c.workers?.length) return null;
    if (this.isGoods(c) && this.goodsLeft(c) > 0) {
      const W = this.sim.workers;
      const inStore = W.storeCount(c.item, c.minQ) > 0;
      const buy = (c.minQ === undefined || c.minQ <= STANDARD) && W.buyBudgetLeft() > 0 && W.state.buy !== false && W.seller(c.item, c.bizId);
      if (!inStore && !buy && !GATHERABLE[c.item]) return { key: 'contract.need_goods', params: { item: c.item } };
    }
    if (c.kind === 'order' && this.sim.economy.stock(c.supplierBiz, c.item) < 1) return { key: 'contract.need_stock', params: { item: c.item, building: this.sim.economy.biz(c.supplierBiz)?.building } };
    return null;
  }

  // ------------------------------------------------------------------ jobs from the notice board, for your workers

  /**
   * Take a job from the notice board for your workers to do (you're paid, as if you'd done it;
   * they do the work — a shift, a delivery, a parcel, letters, materials to a site, the harvest).
   */
  canTakeJob(jobId) {
    const J = this.sim.jobs;
    const d = JOBS[jobId];
    if (!d) return { ok: false, reason: 'contract_gone' };
    if (!this.sim.workers.list().length) return { ok: false, reason: 'no_workers' };
    if (this.S.active.length >= this.maxActive()) return { ok: false, reason: 'too_many_contracts', params: { n: this.maxActive() } };
    if (!J.employerOf(jobId)) return { ok: false, reason: 'no_employer', params: { biz_type: d.employerType } };
    if ((J.js.openings[jobId] || 0) <= 0) return { ok: false, reason: 'no_openings' };
    if (d.seasons && !d.seasons.includes(this.sim.time.season)) return { ok: false, reason: 'wrong_season' };
    const p = this.sim.state.player;
    // They take your word for your workers: the standing it needs is yours.
    if (d.requires?.level && p.level < d.requires.level) return { ok: false, reason: 'need_level', params: { level: d.requires.level } };
    if (d.requires?.reputation && p.reputation < d.requires.reputation) return { ok: false, reason: 'need_reputation', params: { value: d.requires.reputation } };
    return { ok: true };
  }

  takeJob(jobId) {
    const chk = this.canTakeJob(jobId);
    if (!chk.ok) return chk;
    const c = this.fromJob({ jobId, type: JOBS[jobId].type, item: JOBS[jobId].item || null, qty: JOBS[jobId].qty || 0, employer: this.sim.jobs.employerOf(jobId) });
    if (!c.ok) return c;
    this.sim.jobs.js.openings[jobId]--;
    this.sim.bus.emit('jobs:changed');
    return c;
  }

  /** The job you took yourself, handed to your workers (before you've started on it). */
  canHandOver() {
    const job = this.sim.jobs.active;
    if (!job) return { ok: false, reason: 'contract_gone' };
    if (!this.sim.workers.list().length) return { ok: false, reason: 'no_workers' };
    if (this.S.active.length >= this.maxActive()) return { ok: false, reason: 'too_many_contracts', params: { n: this.maxActive() } };
    const started = (job.type === 'harvest' && job.harvested > 0) || job.stage === 'working' || (['courier', 'rounds', 'haul'].includes(job.type) && job.stage !== 'pickup');
    if (started) return { ok: false, reason: 'job_started' };
    return { ok: true };
  }

  handOver() {
    const chk = this.canHandOver();
    if (!chk.ok) return chk;
    const job = this.sim.jobs.active;
    const r = this.fromJob(job);
    if (!r.ok) return r;
    this.sim.jobs.js.active = null;
    this.sim.bus.emit('jobs:changed');
    return r;
  }

  /** A notice-board job as a contract of yours (the harvest becomes a farmer's harvest, in plants). */
  fromJob(job) {
    const sim = this.sim;
    const d = JOBS[job.jobId];
    const bizId = job.employer;
    const E = sim.economy;
    const building = E.biz(bizId)?.building;
    const issuer = E.ownerId(bizId) || 'village';
    const pay = sim.jobs.pay(job.jobId);
    const day = sim.time.day;
    let c;
    if (d.type === 'harvest') {
      c = this.base('harvest', { bizId, issuer, building, item: d.item, qty: Math.max(1, Math.ceil(job.qty / (BALANCE.resources.cropYield || 2))), done: 0, owed: 0, pay, days: 1, jobId: job.jobId });
    } else {
      c = this.base('job', { jobId: job.jobId, type: d.type, bizId, issuer, building, item: job.item, qty: job.qty || 1, pay, days: 1, done: 0 });
      if (d.type === 'shift') c.hours = d.durationHours;
      if (d.type === 'courier') {
        c.targets = [job.target || rand.pick(sim.jobs.homes())];
        c.qty = 1;
      }
      if (d.type === 'rounds') {
        c.targets = job.targets?.length ? [...job.targets] : sim.jobs.homes().filter((h) => h !== building).slice(0, d.qty);
        c.qty = c.targets.length;
      }
      if (d.type === 'haul') {
        const site = job.target ? sim.construction.byId(job.target) : sim.jobs.siteNeeding(d.item);
        if (!site) return { ok: false, reason: 'no_openings' };
        c.siteId = site.id;
        c.qty = Math.min(job.qty || d.qty, sim.construction.missing(site)[d.item] || d.qty);
      }
    }
    c.deadline = day + c.days;
    c.accepted = day;
    c.contractor = 'player';
    c.via = 'board';
    this.normalize(c).status = 'accepted';
    this.S.active.push(c);
    sim.bus.emit('contracts:changed');
    sim.workers.mgr?.() && sim.workers.manage();
    return { ok: true, id: c.id };
  }
  /** Where the work is (for the map arrow and "Go to job"). */
  location(c) {
    return c.kind === 'haul' && (c.collected || 0) < c.qty ? c.from : c.building;
  }

  // ------------------------------------------------------------------ your workers on the job

  canDelegate(c) {
    return !!c && DELEGABLE.includes(c.kind);
  }
  isActive(id) {
    return this.S.active.some((c) => c.id === id);
  }

  /**
   * Put these workers of yours on the job (the others come off it). They go straight there.
   * by: 'player' (you chose the crew — your manager leaves it be) or 'manager'.
   */
  assign(id, npcIds, by = 'player') {
    const c = this.S.active.find((x) => x.id === id);
    if (!c || !this.canDelegate(c)) return { ok: false, reason: 'contract_gone' };
    this.normalize(c);
    const W = this.sim.workers;
    const want = [...new Set(npcIds)].filter((n) => W.contract(n) && !W.isManager?.(n));
    const was = c.workers;
    if (by === 'player') c.manual = true;
    else c.managedBy = W.mgr?.()?.npc;
    if (want.some((n) => !was.includes(n))) c.crewSince = this.sim.time.total;
    c.workers = want;
    for (const n of was) if (!want.includes(n)) W.offContract(n);
    for (const n of want) {
      // A worker is on one job at a time.
      for (const other of this.S.active) if (other !== c && other.workers?.includes(n)) other.workers = other.workers.filter((x) => x !== n);
      if (!was.includes(n)) W.toContract(n, c.id);
    }
    if (want.length && c.status === 'accepted') c.status = 'preparing';
    this.sim.bus.emit('contracts:changed');
    this.sim.bus.emit('workers:changed');
    return { ok: true, n: want.length };
  }

  /** Hand a contract (back) to your manager: they choose its crew from now on. */
  automate(id) {
    const c = this.S.active.find((x) => x.id === id);
    if (!c) return;
    c.manual = false;
    this.sim.workers.manage?.();
    this.sim.bus.emit('contracts:changed');
  }

  /** The contract a worker of yours is on. */
  jobOf(npcId) {
    return this.S.active.find((c) => c.workers?.includes(npcId)) || null;
  }

  /** Work done on a contract — by you ('player') or a worker (their id). Units: plants, points, hours, goods. */
  addWork(c, who, units) {
    if (!c || !this.S.active.includes(c) || units <= 0) return;
    this.normalize(c);
    c.done = Math.round((c.done + units) * 10) / 10;
    c.crew[who] = Math.round(((c.crew[who] || 0) + units) * 10) / 10;
    c.lastWork = this.sim.time.total;
    c.status = 'working';
    this.sim.bus.emit('contracts:changed');
    this.checkDone(c);
  }

  /** Is all the work in? Then the client looks it over, and it's settled. */
  checkDone(c) {
    if (!this.S.active.includes(c)) return false;
    let done = false;
    if (c.kind === 'harvest') done = c.done >= c.qty && (c.owed || 0) <= 0 && !this.carried(c);
    else if (c.kind === 'repair') done = c.done >= c.qty || (this.sim.property.rec(c.building)?.condition ?? 0) >= C.repairTo;
    else if (c.kind === 'build') {
      // (Works on a building are cleared away when they're finished: gone means done.)
      const s = this.sim.construction.byId(c.siteId);
      const finished = s ? s.status === 'done' : c.siteKind === 'works';
      done = c.proposal ? finished : c.done >= c.hours || finished;
    }
    else if (c.kind === 'water') done = c.done >= c.qty;
    else if (c.kind === 'haul') done = c.delivered >= c.qty;
    else if (c.kind === 'supply' || c.kind === 'craft' || c.kind === 'order') done = c.delivered >= c.qty;
    else if (c.kind === 'job') done = c.done >= this.required(c) && !this.carried(c);
    if (done) this.complete(c);
    return done;
  }

  /** Goods for this job still on a worker's back. */
  carried(c) {
    return this.sim.state.npcs.some((n) => n.carry?.contract === c.id && n.carry.qty > 0);
  }

  /** How the job stands: accepted · preparing (workers on their way) · working · waiting (nothing done for a while). */
  statusOf(c) {
    if (c.status === 'completed' || c.status === 'failed' || c.status === 'cancelled') return c.status;
    if (this.sim.time.day > c.deadline) return 'late';
    if (c.lastWork === undefined) return c.workers?.length ? 'preparing' : 'accepted';
    return this.sim.time.total - c.lastWork > C.waitingAfter ? 'waiting' : 'working';
  }

  // --- the harvest

  /** A harvest contract of yours on the field this crop is in, with plants still to bring in. */
  harvestAt(obj) {
    if (obj?.kind !== 'crop') return null;
    return this.S.active.find((c) => c.kind === 'harvest' && c.done < c.qty && this.fieldsOf(c.bizId).includes(obj.id)) || null;
  }

  /** You harvested a plant of the farmer's (PlayerActionSystem): it counts — and the wheat is theirs to have. */
  onPlayerHarvest({ obj, qty }) {
    if (this.sim.jobs.active?.type === 'harvest') return; // that's for your job at the farm
    const c = this.harvestAt(obj);
    if (!c) return;
    c.owed = (c.owed || 0) + qty;
    this.addWork(c, 'player', 1);
  }

  /** You watered one of the farmer's plants (PlayerActionSystem). */
  onPlayerWater({ obj }) {
    const c = this.waterAt(obj) || this.S.active.find((x) => x.kind === 'water' && this.fieldsOf(x.bizId).includes(obj.id));
    if (c) this.watered(c, 'player', obj);
  }

  /**
   * A worker hands over goods for a job — at the business that wanted them (the farmer's wheat, a
   * haul, a supply), or to the person (a commission, at their home). Returns how many were taken
   * (what's over the order goes back with them).
   */
  crewDelivered(npc, load) {
    const E = this.sim.economy;
    const c = this.S.active.find((x) => x.id === load.contract);
    const counted = c && (this.isGoods(c) || c.kind === 'haul') ? Math.min(load.qty, Math.max(0, c.qty - (c.delivered || 0))) : load.qty;
    // (The harvest's wheat is the farmer's, all of it; a supply takes what was ordered.)
    const used = c && this.isGoods(c) ? counted : load.qty;
    if (String(load.to).startsWith('ebiz:')) {
      const bizId = String(load.to).slice(5);
      if (E.biz(bizId)) E.biz(bizId).stock[load.item] = E.stock(bizId, load.item) + used;
    }
    if (!c) return used;
    c.delivered = (c.delivered || 0) + (c.kind === 'harvest' ? load.qty : counted);
    if (c.kind === 'harvest') {
      this.sim.bus.emit('contracts:changed');
      this.checkDone(c);
    } else this.addWork(c, npc.id, counted);
    return used;
  }

  /** A worker's materials arrive at the building site of a haulage job (the site's owner pays the supplier, as when you do it). */
  crewSiteDelivered(npc, load, n) {
    const c = this.S.active.find((x) => x.id === load.contract);
    if (!c || n <= 0) return;
    const sim = this.sim;
    const E = sim.economy;
    const site = sim.construction.byId(c.siteId);
    const cost = Math.round(n * (ITEMS[c.item]?.basePrice || 1) * 0.9);
    const purse = site && sim.growth?.purse(site);
    if (purse && E.biz(c.bizId)) {
      const fromBudget = Math.min(site.budget || 0, cost);
      site.budget -= fromBudget;
      const rest = Math.min(cost - fromBudget, Math.max(0, purse.get()));
      purse.pay(rest);
      E.biz(c.bizId).money += fromBudget + rest;
      E.ledger(c.bizId, 'rev', fromBudget + rest);
    }
    if (site) site.lastProgressDay = sim.time.day;
    c.delivered = (c.delivered || 0) + n;
    this.addWork(c, npc.id, n);
  }

  /** A worker at your business sends a customer's order off by cart. Returns how many went. */
  crewShipOrder(c, npc) {
    const n = Math.min(Math.floor(this.sim.economy.stock(c.supplierBiz, c.item)), c.qty - c.delivered);
    if (n <= 0) return 0;
    // (Credited before it's shipped: the last cart settles the order.)
    c.crew[npc.id] = Math.round(((c.crew[npc.id] || 0) + n) * 10) / 10;
    c.done = (c.done || 0) + n;
    c.lastWork = this.sim.time.total;
    return this.fulfilOrder(c.id);
  }

  /** A worker delivered a parcel or a letter at a house on the round. */
  crewPosted(c, npc, building) {
    c.targets = (c.targets || []).filter((h) => h !== building);
    const resident = this.sim.npcs.residentsOf(building)[0];
    if (resident) this.sim.social.addRel(resident, 1);
    this.addWork(c, npc.id, 1);
  }

  /** A worker picks up goods to haul: the buyer pays the producer now, as when you collect them. */
  crewCollect(c, max) {
    const E = this.sim.economy;
    const n = Math.min(c.qty - c.collected, E.stock(c.fromBiz, c.item), max);
    if (n <= 0) return 0;
    const unit = c.goods / c.qty;
    E.biz(c.fromBiz).stock[c.item] -= n;
    E.biz(c.fromBiz).money += unit * n;
    E.ledger(c.fromBiz, 'rev', unit * n);
    if (E.biz(c.bizId)) {
      E.biz(c.bizId).money -= unit * n;
      E.ledger(c.bizId, 'exp', unit * n);
    }
    c.collected += n;
    this.sim.bus.emit('contracts:changed');
    return n;
  }

  // --- repairs, by your own hands

  canRepair(c) {
    if (!c || c.kind !== 'repair' || !this.S.active.includes(c)) return { ok: false, reason: 'contract_gone' };
    if (this.sim.state.player.energy < 8) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  /** An hour of repairs on the client's building (the owner has the timber and stone ready). */
  playerRepair(id) {
    const sim = this.sim;
    const c = this.S.active.find((x) => x.id === id);
    if (!this.canRepair(c).ok) return 0;
    const r = sim.property.rec(c.building);
    const tool = sim.inventory.bestTool('hammer');
    const pts = Math.max(0, Math.min(100 - r.condition, C.playerRepairPerHour * Mod.buildSpeed(sim.state.player) * (tool ? sim.inventory.toolEfficiency(tool) : 1) * sim.needs.productivity()));
    r.condition = Math.min(100, r.condition + pts);
    if (tool) sim.inventory.useTool('hammer');
    sim.needs.spendEnergy(8);
    sim.progression.addXp(6);
    sim.progression.addSkillXp('construction', 10);
    sim.bus.emit('building:changed', c.building);
    this.addWork(c, 'player', Math.max(0.1, Math.round(pts * 10) / 10));
    return pts;
  }

  // --- where to go next (the objective arrow)

  /** Point the arrow at this job (or at nothing). */
  track(id) {
    this.S.tracked = this.S.tracked === id ? null : id;
    this.sim.bus.emit('contracts:changed');
  }

  /** The tracked job: what to do next and where. */
  objective() {
    const c = this.S.active.find((x) => x.id === this.S.tracked);
    if (!c) return null;
    const world = this.sim.world;
    const door = (id) => {
      const b = world.buildings[id];
      return b ? world.tileCenter(b.door.tx, b.door.ty) : null;
    };
    const base = { contract: c };
    if (c.kind === 'harvest') {
      if (c.done < c.qty) {
        const p = this.sim.state.player;
        const pt = world.toTile(p.x, p.y);
        const crop = this.ripe(c.bizId).sort((a, b) => Math.abs(a.tx - pt.tx) + Math.abs(a.ty - pt.ty) - (Math.abs(b.tx - pt.tx) + Math.abs(b.ty - pt.ty)))[0];
        return { ...base, key: 'objective.c_harvest', params: { have: c.done, qty: c.qty, npc: c.issuer }, target: crop ? world.tileCenter(crop.tx, crop.ty) : door(c.building) };
      }
      return { ...base, key: 'objective.c_handover', params: { qty: c.owed || 0, item: c.item, building: c.building }, target: door(c.building) };
    }
    if (c.kind === 'repair') return { ...base, key: 'objective.c_repair', params: { building: c.building, have: Math.floor(c.done), qty: c.qty }, target: door(c.building) };
    if (c.kind === 'build') {
      const s = this.sim.construction.byId(c.siteId);
      return { ...base, key: 'objective.c_build', params: { have: c.done, qty: c.hours, npc: c.issuer !== 'village' ? c.issuer : undefined }, target: s ? world.tileCenter(s.tx + Math.floor(s.w / 2), s.ty + s.h) : null };
    }
    if (c.kind === 'haul') {
      const pick = c.collected < c.qty;
      return { ...base, key: pick ? 'objective.c_haul_pick' : 'objective.c_haul_drop', params: { qty: c.qty, item: c.item, building: pick ? c.from : c.building }, target: door(pick ? c.from : c.building) };
    }
    return { ...base, key: 'objective.c_deliver', params: { qty: c.qty - c.delivered, item: c.item, building: c.building }, target: door(c.building) };
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
    if (c.kind === 'haul') return Math.max(0, Math.min(c.collected - c.delivered - this.carriedQty(c), this.sim.inventory.count(c.item)));
    if (c.kind === 'job') return 0;
    if (c.kind === 'harvest') return Math.min(c.owed || 0, this.sim.inventory.count(c.item));
    if (c.kind === 'repair' || c.kind === 'build') return 0;
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
    c.delivered = (c.delivered || 0) + n;
    if (c.kind === 'harvest') c.owed = Math.max(0, (c.owed || 0) - n);
    // Goods go where they were needed.
    const E = this.sim.economy;
    if (c.bizId && E.biz(c.bizId)) E.biz(c.bizId).stock[c.item] = E.stock(c.bizId, c.item) + n;
    if (c.kind === 'harvest') this.sim.toast('toast.contract_handed', { qty: n, item: c.item, npc: c.issuer }, 'gain');
    else this.sim.toast('toast.contract_delivered', { qty: n, item: c.item, left: c.qty - c.delivered }, 'gain');
    if (c.kind === 'haul') this.addWork(c, 'player', n);
    else if (c.kind === 'harvest') this.checkDone(c);
    else if (c.delivered >= c.qty) this.complete(c);
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
    for (const c of this.S.active.slice()) if (c.kind === 'build' && c.siteId === site.id) this.addWork(c, 'player', minutes / 60);
  }

  /** Progress 0–1. */
  progress(c) {
    if (c.kind === 'build') return Math.min(1, c.done / c.hours);
    if (c.kind === 'build' && c.proposal) {
      const s = this.sim.construction.byId(c.siteId);
      return s ? Math.min(1, s.labor / Math.max(1, s.laborNeeded)) : 0;
    }
    if (c.kind === 'harvest' || c.kind === 'repair' || c.kind === 'job' || c.kind === 'water') return Math.min(1, (c.done || 0) / this.required(c));
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

  /**
   * The work is in: the client looks it over and pays you; you gain experience for taking the
   * job on and seeing it through, each worker for the work they did; the workers go back to
   * their usual work. Every award is made once and marked as made (c.awarded) — and the
   * contract leaves your list in the same step, so no save or load can pay it out twice.
   */
  complete(c) {
    const sim = this.sim;
    if (!this.S.active.includes(c) || c.status === 'completed') return;
    this.normalize(c);
    this.S.active = this.S.active.filter((x) => x !== c);
    c.status = 'completed';
    const A = c.awarded;
    // How it went: speed, skill, deadline, the job itself.
    c.result ??= this.judge(c);
    const R = c.result;
    const due = Math.max(0, Math.round(c.pay * R.payMult));
    let paid = A.pay ?? 0;
    if (A.pay === undefined) {
      const payer = this.payer(c);
      paid = Math.max(0, Math.min(due, Math.floor(payer.get())));
      payer.take(paid);
      if (c.kind === 'order' && sim.economy.biz(c.supplierBiz)) {
        // Orders are your business's revenue — and its good name.
        const sup = sim.economy.biz(c.supplierBiz);
        sup.money += paid;
        sim.economy.ledger(c.supplierBiz, 'rev', paid);
        sup.reputation = Math.min(100, (sup.reputation ?? 50) + 3);
      } else sim.state.player.money += paid;
      sim.state.stats.moneyEarned += paid;
      A.pay = paid;
    }
    // Who did the work: you, your workers (what share of it each).
    const total = Object.values(c.crew).reduce((s, v) => s + v, 0);
    const crewShare = total > 0 ? Object.entries(c.crew).filter(([who]) => who !== 'player').reduce((s, [, v]) => s + v, 0) / total : 0;
    if (A.xp === undefined) {
      A.xp = Math.round(this.playerXp(c) * R.xpMult);
      sim.progression.addReputation(C.repOnTime);
      sim.progression.addXp(A.xp);
      if (c.kind === 'build') sim.progression.addSkillXp('construction', 5);
      if (c.kind === 'supply' || c.kind === 'haul') sim.progression.addSkillXp('trading', 6);
      // Running a crew teaches you to lead one.
      if (crewShare > 0) sim.progression.addSkillXp('leadership', Math.round(C.leadXp * (0.5 + crewShare)));
    }
    if (A.workers === undefined) A.workers = this.awardCrew(c, total);
    this.release(c);
    const issuer = sim.npcs.byId(c.issuer);
    if (issuer) sim.memory.remember(issuer, 'player_helped', { who: 'player', params: { item: c.item } });
    const rankBefore = this.rank();
    this.S.done++;
    const how = paid < due ? 'short' : 'done';
    this.recordOutcome(c, how, R);
    this.log(c, how, paid);
    if (this.S.tracked === c.id) this.S.tracked = null;
    const params = { money: paid, money2: due, n: A.xp, npc: c.issuer !== 'village' && issuer ? c.issuer : undefined };
    sim.toast(paid < due ? 'toast.contract_short' : c.kind === 'order' || !params.npc ? 'toast.contract_done_xp' : 'toast.contract_paid', params, paid < due ? 'warn' : 'good');
    sim.toast('toast.contract_graded', { grade: R.grade, speed: R.speed, dl: R.deadline }, R.grade === 'poor' ? 'warn' : 'info');
    for (const [id, x] of Object.entries(A.workers)) sim.toast('toast.crew_xp', { npc: id, n: x.xp, field: x.field }, 'good');
    if (this.rank() !== rankBefore) {
      sim.toast('toast.contractor_rank', { crank: this.rank().id }, 'good');
      sim.chronicle('chronicle.contractor_rank', { crank: this.rank().id });
    }
    sim.bus.emit('contracts:changed');
    sim.bus.emit('player:changed');
  }

  /**
   * Each worker's experience for the work they did: a fair share of the job earns the full
   * amount (more for more, less for less), and practice in the trade it was (farming for a
   * harvest, building for repairs and building work). Returns { npcId: { xp, field } }.
   */
  awardCrew(c, total) {
    const sim = this.sim;
    const out = {};
    const fair = this.required(c) / this.recommended(c);
    const field = this.fieldOf(c);
    for (const [who, work] of Object.entries(c.crew)) {
      const npc = who === 'player' ? null : sim.npcs.byId(who);
      if (!npc || work <= 0) continue;
      const w = Math.min(1.5, work / Math.max(1, fair));
      const xp = Math.max(1, Math.round(this.workerXp(c) * w));
      npc.xp = (npc.xp || 0) + xp;
      while (npc.xp >= sim.npcs.xpForNext(npc.level)) {
        npc.xp -= sim.npcs.xpForNext(npc.level);
        npc.level++;
        sim.toast('toast.worker_levelled', { npc: npc.id, n: npc.level }, 'good');
      }
      if (field) sim.education?.practise(npc, field, C.workerPractice * w);
      const wc = sim.workers.contract(npc.id);
      if (wc) {
        wc.stats ??= { done: 0, kinds: {} };
        wc.stats.contracts = (wc.stats.contracts || 0) + 1;
      }
      out[npc.id] = { xp, field, work, share: total ? Math.round((work / total) * 100) : 0 };
    }
    return out;
  }

  /** The job's over: your workers go back to their usual work. */
  release(c) {
    const ids = c.workers || [];
    c.workers = [];
    // A site you were building and supplying goes back to its owner's care.
    const s = c.proposal && c.siteId && this.sim.construction.byId(c.siteId);
    if (s && s.status === 'site') {
      delete s.contractor;
      delete s.supplier;
    }
    for (const id of ids) this.sim.workers.offContract(id);
  }

  fail(c, abandoned = false) {
    const sim = this.sim;
    this.S.active = this.S.active.filter((x) => x !== c);
    c.status = abandoned ? 'cancelled' : 'failed';
    this.release(c);
    if (this.S.tracked === c.id) this.S.tracked = null;
    this.recordOutcome(c, abandoned ? 'abandoned' : 'failed');
    // Money they gave you up front for materials: what you haven't spent goes back.
    if (c.advance > 0) {
      const back = Math.max(0, Math.min(Math.floor(sim.state.player.money), c.advance - (c.costs?.materials || 0)));
      sim.state.player.money -= back;
      this.payer(c).take(-back);
      c.refunded = back;
    }
    sim.progression.addReputation(C.repFail);
    if (c.kind === 'order' && sim.economy.biz(c.supplierBiz)) sim.economy.biz(c.supplierBiz).reputation = Math.max(0, (sim.economy.biz(c.supplierBiz).reputation ?? 50) - 6);
    const issuer = sim.npcs.byId(c.issuer);
    if (issuer) sim.memory.remember(issuer, 'player_let_down', { who: 'player' });
    // Hauled goods you never delivered: you owe the buyer what they paid.
    if (c.kind === 'haul' && c.collected - c.delivered - this.carriedQty(c) > 0) {
      const owed = Math.round((c.goods / c.qty) * (c.collected - c.delivered - this.carriedQty(c)));
      const take = Math.min(owed, Math.max(0, Math.floor(sim.state.player.money)));
      sim.state.player.money -= take;
      if (sim.economy.biz(c.bizId)) sim.economy.biz(c.bizId).money += take;
    }
    // The farmer's wheat still in your pockets goes back to the farm.
    if (c.kind === 'harvest' && c.owed > 0) {
      const back = sim.inventory.remove(c.item, Math.min(c.owed, sim.inventory.count(c.item)));
      if (back > 0 && sim.economy.biz(c.bizId)) sim.economy.biz(c.bizId).stock[c.item] = sim.economy.stock(c.bizId, c.item) + back;
    }
    this.S.failed++;
    this.log(c, abandoned ? 'abandoned' : 'failed', 0);
    sim.toast('toast.contract_failed', {}, 'danger');
    sim.bus.emit('contracts:changed');
  }

  log(c, how, paid) {
    const cost = Math.round((c.costs?.materials || 0) + (c.costs?.wages || 0));
    this.S.log.push({ id: c.id, kind: c.kind, type: c.type, jobId: c.jobId, item: c.item, how, paid: paid + (c.advance || 0) - (c.refunded || 0), day: this.sim.time.day, issuer: c.issuer, building: c.building, xp: c.awarded?.xp, crew: c.awarded?.workers ? Object.fromEntries(Object.entries(c.awarded.workers).map(([id, x]) => [id, x.xp])) : undefined, you: c.crew?.player, grade: c.result?.grade, score: c.result?.score, late: c.result?.daysLate || (c.late ? 1 : 0), cost, size: c.size, proposal: c.proposal ? c.proposal.type || c.proposal.what : undefined });
    if (this.S.log.length > 80) this.S.log.shift();
  }
}

// What villagers need, sizes and requirements, estimates, negotiating, judging the work, your name, your firm.
Object.assign(ContractSystem.prototype, ContractPlanner);
