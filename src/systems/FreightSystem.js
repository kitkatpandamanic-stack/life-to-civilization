/**
 * FreightSystem — carrying goods for other people: your carting business, and your own caravans.
 *
 *   state.freight = {
 *     company: null | { kind: 'self' | 'firm', since, rate, rep, depot, delivered, earned, late, handed },
 *     jobs: [{ id, ship, from, to, fromB, toB, item, qty, left, carried, fee, due, posted, picked }],
 *     caravans: [{ id, to, eq, driver, guard, cargo, buy, depart, arrive, back, stage, sold, spent, got, robbed }],
 *     nextId, log: [...]
 *   }
 *
 * Freight: every day the valley's shops and workshops send goods to each other (LogisticsSystem.ship).
 * Once you've signed up as a carrier (on the notice board) — or founded a company at a transport depot —
 * some of those loads come to you instead of the porters or the village carters: a delivery job
 * "40 wood from the lumberyard to the carpentry, by 15:00". Nothing moves by itself: you (or your
 * workers, with their barrows and carts — WorkerSystem, FreightTasks below) walk to the supplier's door,
 * load up, and carry it to the buyer's. You're paid when the last of it arrives (less if it's late).
 * A job nobody picks up in time goes back to the porters, and your name suffers.
 *
 * Caravans: your cart or wagon, one of your workers to drive it (and another to guard it, if you
 * like), goods from your storage, to one of the settlements you trade with. They sell there, buy what
 * you asked for with the takings, and come home days later — unless bandits get them on the road.
 *
 * Which loads come to you is decided by a hash of the shipment (no dice), so signing up never changes
 * anything else that happens in the game.
 */
import { FREIGHT as F, CARAVAN as CV } from '../data/freight.js';
import { EQUIPMENT } from '../data/transport.js';
import { TRADE } from '../data/settlements.js';
import { ITEMS } from '../data/items.js';
import { hashStr, rand } from '../core/rng.js';

export class FreightSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.freight ??= { company: null, jobs: [], caravans: [], nextId: 1, log: [] };
    this.S.log ??= [];
    sim.bus.on('time:minute', (now) => now % 10 === 0 && this.tick(now));
  }

  get S() {
    return this.sim.state.freight;
  }
  get company() {
    return this.S.company;
  }

  // ------------------------------------------------------------------ the business

  /** A transport depot of yours (a company needs one). */
  depot() {
    const sim = this.sim;
    for (const b of Object.values(sim.world.buildings)) if (b.type === 'transport_depot' && sim.property.rec(b.id)?.owner === 'player') return b.id;
    return null;
  }

  canSignUp() {
    if (this.company) return { ok: false, reason: 'already_carrier' };
    return { ok: true };
  }

  /** Put your name down as a carrier: loads come to you (just you, one at a time). */
  signUp() {
    const chk = this.canSignUp();
    if (!chk.ok) return chk;
    this.S.company = { kind: 'self', since: this.sim.time.day, rate: 'fair', rep: F.rep.start, depot: null, delivered: 0, earned: 0, late: 0, handed: 0 };
    this.sim.toast('toast.carrier_signed', {}, 'good');
    this.sim.bus.emit('freight:changed');
    return { ok: true };
  }

  canFound() {
    if (this.company?.kind === 'firm') return { ok: false, reason: 'already_company' };
    if (!this.depot()) return { ok: false, reason: 'need_depot' };
    if (this.sim.state.player.money < F.foundCost) return { ok: false, reason: 'no_money', params: { money: F.foundCost } };
    return { ok: true, cost: F.foundCost };
  }

  /** A carting company: your workers carry too (as many jobs as you have hands for). */
  found() {
    const chk = this.canFound();
    if (!chk.ok) return chk;
    const sim = this.sim;
    sim.state.player.money -= F.foundCost;
    const c = this.company || { rate: 'fair', rep: F.rep.start, delivered: 0, earned: 0, late: 0, handed: 0 };
    this.S.company = { ...c, kind: 'firm', since: sim.time.day, depot: this.depot() };
    sim.progression.addReputation(3);
    sim.toast('toast.carting_founded', { building: this.S.company.depot }, 'good');
    sim.chronicle('chronicle.carting_company', { building: this.S.company.depot });
    sim.bus.emit('freight:changed');
    sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** Stop taking work (what's already taken is handed back to the porters). */
  close() {
    if (!this.company) return false;
    for (const j of this.S.jobs.slice()) this.handOver(j, false);
    this.S.company = null;
    this.sim.bus.emit('freight:changed');
    return true;
  }

  setRate(rate) {
    if (!this.company || !F.rates[rate]) return false;
    this.company.rate = rate;
    this.sim.bus.emit('freight:changed');
    return true;
  }

  /** Open jobs you can have at once. */
  capacity() {
    const c = this.company;
    if (!c) return 0;
    const hands = this.sim.workers.list().length;
    if (c.kind === 'self' || !hands) return F.selfJobs; // (a company with nobody to carry: just what you can)
    return Math.max(F.minJobs, hands * F.jobsPerWorker) + F.selfJobs;
  }

  /** Share of the valley's loads that come your way (against porters, or the village's carters). */
  share() {
    const c = this.company;
    if (!c) return 0;
    const firm = this.sim.economy.ofType('carters').length > 0;
    const base = firm ? F.share.firm : F.share.porters;
    // (A rival with a carting business of their own takes some of the work — RivalSystem.)
    return Math.min(0.95, base * F.rates[c.rate].share * (0.6 + c.rep / 125) * (this.sim.rival?.freightFactor() ?? 1));
  }

  // ------------------------------------------------------------------ loads offered

  /**
   * LogisticsSystem is sending goods: do we take them? (The buyer pays us instead of the porters.)
   * Returns the job, or null.
   */
  offer(s, route) {
    const c = this.company;
    if (!c || !route || s.qty < F.minQty || !this.sim.world.buildings[s.fromB] || !this.sim.world.buildings[s.toB]) return null;
    if (this.S.jobs.length >= this.capacity()) return null;
    // Just you: not while you're asleep or out of the valley.
    const p = this.sim.state.player;
    if (c.kind === 'self' && (p.sleeping || p.away || this.sim.state.region?.journey)) return null;
    if (hashStr(`freight_${s.id}_${s.depart}`, this.sim.state.seed | 0) >= this.share()) return null;
    const now = this.sim.time.total;
    const base = Math.round(s.qty * route.dist * 0.02); // the porters' fee
    const fee = Math.max(F.feeFloor, Math.round(base * F.feeMult * F.rates[c.rate].fee));
    const job = {
      id: this.S.nextId++,
      ship: s.id,
      from: s.from,
      to: s.to,
      fromB: s.fromB,
      toB: s.toB,
      item: s.item,
      qty: s.qty,
      left: s.qty,
      carried: 0,
      fee,
      due: now + Math.round((route.minutes.porter || 60) * F.dueMult + F.dueMargin),
      posted: now,
      picked: 0,
    };
    this.S.jobs.push(job);
    this.sim.bus.emit('freight:changed');
    if (c.kind === 'self') {
      this.sim.toast(this.S.toldFirst ? 'toast.freight_new' : 'toast.freight_first', { item: s.item, qty: s.qty, building: s.fromB, to: s.toB, money: fee }, 'info');
      this.S.toldFirst = true;
    }
    return job;
  }

  job(id) {
    return this.S.jobs.find((j) => j.id === Number(id)) || null;
  }

  shipment(job) {
    return this.sim.state.logistics.shipments.find((x) => x.id === job.ship) || null;
  }

  // ------------------------------------------------------------------ carrying

  /** Loaded at the supplier's door: n more on their way. */
  pickUp(job, n) {
    const got = Math.max(0, Math.min(n, job.left));
    job.left -= got;
    job.picked = (job.picked || 0) + got;
    return got;
  }

  /** Unloaded at the buyer's door. The last of it: you're paid. */
  deliver(job, n) {
    const sim = this.sim;
    const E = sim.economy;
    const to = E.biz(job.to);
    if (to && !to.closed) to.stock[job.item] = (to.stock[job.item] || 0) + n;
    else {
      const from = E.biz(job.from);
      if (from) from.stock[job.item] = (from.stock[job.item] || 0) + n;
    }
    job.carried += n;
    if (job.carried >= job.qty) this.finish(job);
    else sim.bus.emit('freight:changed');
  }

  /** Is any of it still being carried (by you, or a worker)? */
  inHands(job) {
    if (this.sim.state.player.freight?.job === job.id) return true;
    return this.sim.state.npcs.some((n) => n.carry?.freight === job.id) || this.sim.equipment?.mine().some((e) => e.cargo?.freight === job.id);
  }

  /** Done (or, short = true, given up on with only part of it there: paid for that part, late). */
  finish(job, short = false) {
    const sim = this.sim;
    const c = this.company;
    const late = short || sim.time.total > job.due;
    const pay = Math.round((late ? job.fee * F.lateFee : job.fee) * (short ? job.carried / job.qty : 1));
    this.delivered(pay, job);
    // (A late load: the buyer gets back what you didn't earn.)
    if (late && sim.economy.biz(job.to)) sim.economy.biz(job.to).money += job.fee - pay;
    if (c) {
      c.delivered++;
      c.earned += pay;
      if (late) c.late++;
      c.rep = Math.max(0, Math.min(100, c.rep + (late ? F.rep.late : F.rep.onTime)));
    }
    this.S.jobs.splice(this.S.jobs.indexOf(job), 1);
    const L = sim.state.logistics;
    const s = this.shipment(job);
    if (s) L.shipments.splice(L.shipments.indexOf(s), 1);
    this.log({ kind: 'delivered', item: job.item, qty: job.qty, to: job.toB, pay, late });
    sim.progression.addXp(Math.max(4, Math.round(pay / 3)));
    sim.progression.addSkillXp?.('trading', 6);
    sim.toast(late ? 'toast.freight_late' : 'toast.freight_done', { qty: job.qty, item: job.item, building: job.toB, money: pay }, late ? 'warn' : 'gain');
    sim.bus.emit('logistics:arrived', s || { item: job.item, qty: job.qty, to: job.to });
    sim.bus.emit('freight:changed');
  }

  /** Paid for a delivery (its own method so the ledger files it under 'freight'). */
  delivered(pay) {
    this.sim.state.player.money += pay;
  }

  /** Nobody picked it up in time (or you've closed): the porters carry it after all. */
  handOver(job, blame = true) {
    const sim = this.sim;
    const L = sim.logistics;
    const s = this.shipment(job);
    const rest = job.qty - job.carried;
    // (What you have on you goes back on the porters' load.)
    const mine = sim.state.player.freight?.job === job.id ? sim.state.player.freight.qty : 0;
    if (mine) delete sim.state.player.freight;
    if (s) {
      s.qty = Math.max(0, job.left + mine);
      delete s.player;
      s.arrive = sim.time.total + 30;
      L.payPorters(Math.round(job.fee * 0.6), Math.ceil(s.qty / 8));
      if (s.qty <= 0) sim.state.logistics.shipments.splice(sim.state.logistics.shipments.indexOf(s), 1);
    }
    this.S.jobs.splice(this.S.jobs.indexOf(job), 1);
    if (blame && this.company) {
      this.company.rep = Math.max(0, this.company.rep + F.rep.handedOver);
      this.company.handed++;
      sim.toast('toast.freight_handed', { item: job.item, qty: rest, building: job.toB }, 'warn');
    }
    this.log({ kind: 'handed', item: job.item, qty: job.qty, to: job.toB });
    sim.bus.emit('freight:changed');
  }

  log(e) {
    this.S.log.unshift({ day: this.sim.time.day, ...e });
    if (this.S.log.length > 40) this.S.log.pop();
  }

  tick(now) {
    // A load nobody's touched long after it was due: back to the porters. One all picked up but never
    // all delivered (a worker let go with part of it, say) — a day late: settled for what arrived.
    for (const j of this.S.jobs.slice()) {
      if (j.picked === 0 && now > j.due + F.handOver) this.handOver(j);
      else if (j.left <= 0 && j.carried < j.qty && now > j.due + 1440 && !this.inHands(j)) this.finish(j, true);
    }
    for (const c of this.S.caravans.slice()) {
      if (c.stage === 'out' && now >= c.arrive) this.caravanArrives(c);
      else if (c.stage === 'back' && now >= c.back) this.caravanHome(c);
    }
  }

  // ------------------------------------------------------------------ you, carrying it yourself

  /** What you can carry (your arms, or what you're pushing). */
  playerCap() {
    const eq = this.sim.equipment?.playerHeld();
    return eq ? this.sim.equipment.cap(eq) : F.handCap;
  }

  /** The load you have on you (state.player.freight = { job, qty }). */
  carrying() {
    const f = this.sim.state.player.freight;
    if (f && !this.job(f.job)) delete this.sim.state.player.freight;
    return this.sim.state.player.freight || null;
  }

  /** Jobs waiting at this building's door. */
  waitingAt(buildingId) {
    return this.S.jobs.filter((j) => j.fromB === buildingId && j.left > 0);
  }

  canLoadHere(buildingId) {
    if (this.carrying()) return { ok: false, reason: 'already_loaded' };
    const job = this.waitingAt(buildingId)[0];
    if (!job) return { ok: false, reason: 'no_freight_here' };
    return { ok: true, job };
  }

  loadHere(buildingId) {
    const chk = this.canLoadHere(buildingId);
    if (!chk.ok) return chk;
    const n = this.pickUp(chk.job, this.playerCap());
    this.sim.state.player.freight = { job: chk.job.id, qty: n };
    this.sim.toast('toast.freight_loaded', { qty: n, item: chk.job.item, building: chk.job.toB }, 'info');
    this.sim.bus.emit('freight:changed');
    this.sim.bus.emit('player:changed');
    return { ok: true, n };
  }

  canUnloadHere(buildingId) {
    const f = this.carrying();
    if (!f) return { ok: false, reason: 'nothing_loaded' };
    if (this.job(f.job).toB !== buildingId) return { ok: false, reason: 'wrong_door', params: { building: this.job(f.job).toB } };
    return { ok: true };
  }

  unloadHere(buildingId) {
    const chk = this.canUnloadHere(buildingId);
    if (!chk.ok) return chk;
    const f = this.carrying();
    delete this.sim.state.player.freight;
    this.deliver(this.job(f.job), f.qty);
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** For the HUD: what to do next with your load (and where). */
  objective() {
    const sim = this.sim;
    const f = this.carrying();
    if (f) {
      const j = this.job(f.job);
      const b = sim.world.buildings[j.toB];
      return { key: 'objective.freight_deliver', params: { qty: f.qty, item: j.item, building: j.toB }, target: b ? sim.world.tileCenter(b.door.tx, b.door.ty) : null };
    }
    if (!this.company || (this.company.kind !== 'self' && this.sim.workers.list().length)) return null; // (your workers see to it)
    const j = this.S.jobs.find((x) => x.left > 0);
    if (!j) return null;
    const b = sim.world.buildings[j.fromB];
    return { key: 'objective.freight_pickup', params: { qty: j.left, item: j.item, building: j.fromB, to: j.toB }, target: b ? sim.world.tileCenter(b.door.tx, b.door.ty) : null };
  }

  // ------------------------------------------------------------------ caravans

  /** Carts and wagons of yours that could go on the road now. */
  caravanEquipment() {
    const E = this.sim.equipment;
    return E.mine().filter((e) => CV.kinds.includes(EQUIPMENT[e.type]?.kind) && E.usable(e) && e.at.kind === 'ground' && !e.holder);
  }

  /** Your workers who could drive (not away, not posted elsewhere). */
  drivers() {
    return this.sim.workers
      .list()
      .map((c) => this.sim.npcs.byId(c.npcId))
      .filter((n) => n && !n.away && !n.leaving);
  }

  /** Settlements you can send a caravan to (you've made contact). */
  destinations() {
    return this.sim.settlements.contacts();
  }

  /** Days there (one way) with this equipment. */
  caravanDays(to, eqType) {
    return this.sim.settlements.days(to, CV.speed[eqType] || 1);
  }

  /** What the cargo would fetch there (at their prices now). */
  estimate(to, cargo) {
    const S = this.sim.settlements;
    let sum = 0;
    let extra = {};
    for (const [item, n] of Object.entries(cargo)) {
      for (let i = 0; i < n; i++) {
        sum += S.sellPrice(to, item, { player: false, extra: extra[item] || 0 });
        extra[item] = (extra[item] || 0) + 1;
      }
    }
    return sum;
  }

  canSend({ to, eq, driver, guard = null, cargo = {} }) {
    const sim = this.sim;
    const E = sim.equipment;
    if (!this.destinations().includes(to)) return { ok: false, reason: 'no_contact' };
    const e = E.byId(eq);
    if (!e || !this.caravanEquipment().includes(e)) return { ok: false, reason: 'need_cart' };
    const d = this.drivers().find((n) => n.id === driver);
    if (!d) return { ok: false, reason: 'need_driver' };
    if (guard && (guard === driver || !this.drivers().some((n) => n.id === guard))) return { ok: false, reason: 'need_driver' };
    const units = Object.values(cargo).reduce((a, b) => a + b, 0);
    if (units < CV.minCargo) return { ok: false, reason: 'cargo_small', params: { n: CV.minCargo } };
    if (units > E.cap(e)) return { ok: false, reason: 'cargo_big', params: { n: E.cap(e) } };
    for (const [item, n] of Object.entries(cargo)) if (sim.home.storageCount(item) < n) return { ok: false, reason: 'not_in_storage', params: { item } };
    return { ok: true, days: this.caravanDays(to, e.type), units, worth: this.estimate(to, cargo) };
  }

  /** Off they go: the goods out of your storage, the cart and the driver out of the valley. */
  send(spec) {
    const chk = this.canSend(spec);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const now = sim.time.total;
    for (const [item, n] of Object.entries(spec.cargo)) sim.home.take(item, n);
    const e = sim.equipment.byId(spec.eq);
    const c = {
      id: this.S.nextId++,
      to: spec.to,
      eq: e.id,
      eqType: e.type,
      driver: spec.driver,
      guard: spec.guard || null,
      cargo: { ...spec.cargo },
      buy: spec.buy || null,
      depart: now,
      arrive: now + chk.days * 1440,
      back: null,
      stage: 'out',
      sold: 0,
      spent: 0,
      got: {},
      robbed: false,
      days: chk.days,
    };
    e.at = { kind: 'away', caravan: c.id };
    delete e.cargo;
    for (const id of [c.driver, c.guard].filter(Boolean)) {
      const n = sim.npcs.byId(id);
      sim.equipment.clearHands?.(id);
      sim.exploration.leave(n, sim.settlements.def(c.to).region);
      n.away.caravan = c.id;
    }
    this.S.caravans.push(c);
    sim.toast('toast.caravan_sent', { settlement: c.to, npc: c.driver, n: chk.days }, 'info');
    sim.bus.emit('freight:changed');
    sim.bus.emit('equipment:changed');
    return { ok: true, caravan: c };
  }

  caravanArrives(c) {
    const sim = this.sim;
    const S = sim.settlements;
    const s = S.get(c.to);
    // Bandits on the road (half the danger with a guard along).
    const risk = S.danger(c.to) * CV.robbery * (c.guard ? CV.guardCut : 1);
    if (rand.chance(risk)) {
      c.robbed = true;
      for (const item of Object.keys(c.cargo)) c.cargo[item] = Math.floor(c.cargo[item] * CV.robbedKeep);
    }
    for (const [item, n] of Object.entries(c.cargo)) {
      for (let i = 0; i < n; i++) {
        c.sold += S.sellPrice(c.to, item, { player: false });
        s.stock[item] = (s.stock[item] || 0) + 1;
      }
      s.trade += n * (ITEMS[item]?.basePrice || 1);
    }
    // Bring back what you asked for, with the takings.
    if (c.buy && S.def(c.to).produces[c.buy]) {
      const cap = sim.equipment.cap(sim.equipment.byId(c.eq)) || 0;
      let budget = c.sold * CV.maxBuyShare;
      let n = 0;
      while (n < cap && (s.stock[c.buy] || 0) > 0) {
        const price = S.buyPrice(c.to, c.buy, { player: false });
        if (price > budget) break;
        budget -= price;
        c.spent += price;
        s.stock[c.buy]--;
        n++;
      }
      if (n) c.got[c.buy] = n;
    }
    if (!s.contact) S.makeContact?.(c.to, 'caravan');
    S.learnPrices?.(c.to, true); // your driver brings back the news of their prices
    c.stage = 'back';
    c.back = sim.time.total + CV.marketHours * 60 + c.days * 1440;
  }

  caravanHome(c) {
    const sim = this.sim;
    const E = sim.equipment;
    this.S.caravans.splice(this.S.caravans.indexOf(c), 1);
    const at = sim.exploration.waymark();
    for (const id of [c.driver, c.guard].filter(Boolean)) {
      const n = sim.npcs.byId(id);
      if (n) {
        sim.exploration.comeBack(n, at);
        const k = sim.workers.contract(id);
        if (k) this.driverPaid(Math.round(CV.driverPerDay * c.days * 2));
      }
    }
    // The cart: back at the waymark, worn by the road (your workers bring it to the yard).
    const e = E.byId(c.eq);
    if (e) {
      const t = sim.world.toTile(at.x, at.y);
      E.park(e, t.tx, t.ty);
      e.condition = Math.max(5, e.condition - CV.wearPerDay * c.days * 2);
    }
    for (const [item, n] of Object.entries(c.got)) sim.home.store(item, n, { force: true });
    const net = c.sold - c.spent;
    this.caravanPaid(net);
    const stats = (this.S.caravanStats ??= { trips: 0, earned: 0, robbed: 0 });
    stats.trips++;
    stats.earned += net;
    if (c.robbed) stats.robbed++;
    this.log({ kind: 'caravan', to: c.to, money: net, robbed: c.robbed, got: c.got });
    sim.progression.addXp(15 + Math.round(Math.max(0, net) / 10));
    sim.progression.addSkillXp?.('trading', 20);
    sim.toast(c.robbed ? 'toast.my_caravan_robbed' : 'toast.my_caravan_back', { settlement: c.to, money: Math.round(net), npc: c.driver }, c.robbed ? 'danger' : 'gain');
    if (c.robbed) sim.chronicle('chronicle.my_caravan_robbed', { settlement: c.to });
    else if (stats.trips === 1) sim.chronicle('chronicle.my_first_caravan', { settlement: c.to, money: Math.round(net) });
    sim.bus.emit('freight:changed');
    sim.bus.emit('equipment:changed');
  }

  /** The takings (their own methods, so the ledger files them as trade and wages). */
  caravanPaid(net) {
    this.sim.state.player.money += net;
  }
  driverPaid(n) {
    this.sim.state.player.money -= n;
  }

  /** Where a caravan is, on the valley's roads (the first and last few hours): for drawing it. */
  caravanPosition(c) {
    const L = this.sim.logistics;
    const way = this.sim.exploration?.waymark();
    const base = this.sim.workers.baseBuilding()?.id;
    if (!L || !way || !base) return null;
    const now = this.sim.time.total + (this.sim.time.acc || 0) / 600;
    const leg = 180;
    let t;
    if (c.stage === 'out' && now - c.depart < leg) t = (now - c.depart) / leg;
    else if (c.stage === 'back' && c.back - now < leg) t = 1 - (c.back - now) / leg;
    else return null;
    const pos = L.alongRouteTo(base, way, t);
    if (!pos) return null;
    if (c.stage === 'back') pos.facing = { left: 'right', right: 'left', up: 'down', down: 'up' }[pos.facing] || pos.facing;
    return pos;
  }

  /** In a line or two, for the panels. */
  summary() {
    const c = this.company;
    return {
      kind: c?.kind || null,
      rep: c?.rep ?? null,
      rate: c?.rate || null,
      open: this.S.jobs.length,
      capacity: this.capacity(),
      share: Math.round(this.share() * 100),
      delivered: c?.delivered || 0,
      earned: c?.earned || 0,
      caravans: this.S.caravans.length,
      danger: null,
      robberyBase: TRADE.robberyBase,
    };
  }
}

// ==================================================================== your workers carrying it

/**
 * Freight for your workers (mixed into WorkerSystem, like StandingOrders): pick up at the supplier's
 * door, carry it to the buyer's, unload. Counted only when it's there.
 */
export const FreightTasks = {
  freightTasks(npc, c, pos, add) {
    const F2 = this.sim.freight;
    if (F2?.company?.kind !== 'firm') return;
    const now = this.sim.time.total;
    for (const j of F2.S.jobs) {
      if (j.left <= 0) continue;
      const b = this.sim.world.buildings[j.fromB];
      if (!b) continue;
      // Sooner due, more urgent (a late load costs you money and name).
      const urgent = Math.max(0, 260 - Math.max(0, j.due - now) / 3);
      add({ key: `frt:${j.id}`, kind: 'ffetch', cat: 'hauling', freight: j.id, item: j.item, target: b.id, tx: b.door.tx, ty: b.door.ty, urgent, cap: Math.max(1, Math.ceil(j.left / Math.max(20, this.carryCap(npc)))) });
    }
  },

  freightValid(t) {
    const j = this.sim.freight?.job(t.freight);
    return !!j && j.left > 0;
  },

  /** At the supplier's door: load what's left (as much as they can carry). */
  freightFetch(npc, c, t) {
    const F2 = this.sim.freight;
    const j = F2?.job(t.freight);
    if (!j || j.left <= 0) {
      this.block(c, t, 30);
      return this.next(npc);
    }
    const got = F2.pickUp(j, this.carryCap(npc));
    if (got <= 0) {
      this.block(c, t, 60);
      return this.next(npc);
    }
    npc.carry = { item: j.item, qty: got, items: { [j.item]: got }, to: `frt:${j.id}`, freight: j.id };
    return this.loaded(npc, c);
  },

  /** On the way: to the buyer's door. */
  freightDeliver(npc, c) {
    const j = this.sim.freight?.job(npc.carry.freight);
    const b = j && this.sim.world.buildings[j.toB];
    if (!b) {
      // The job's gone (handed over, or you closed): the goods go back where they came from.
      const E = this.sim.economy;
      const from = j ? E.biz(j.from) : null;
      if (from) from.stock[npc.carry.item] = (from.stock[npc.carry.item] || 0) + npc.carry.qty;
      npc.carry = null;
      this.next(npc);
      return true;
    }
    this.carryToBuilding(npc, c, b);
    return true;
  },

  /** Arrived: unloaded into the buyer's stores. */
  freightUnload(npc, c, load) {
    const j = this.sim.freight?.job(load.freight);
    npc.carry = null;
    if (j) this.sim.freight.deliver(j, load.qty);
    if (c.task?.freight === load.freight) this.completed(npc, c);
  },
};
