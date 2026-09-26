/**
 * SettlementSystem — the other places in the world, and trade between them.
 *
 *   state.region = {
 *     list: { id: { pop, stock: {item: qty}, contact, road, roadWork, trade, known: {item: {buy, sell}},
 *                   knownDay, size, shocks: [{ item, mult, until, kind }], fed } },
 *     caravans: [{ id, biz, to, goods, imports, depart, arrive, back, stage, earned, spent }],
 *     journey: { to, stage: 'out' | 'there' | 'back', depart, arrive, until, cargo, sold, bought, … },
 *     nextId,
 *   }
 *
 * The valley is simulated in full; the settlements beyond it are simulated as
 * numbers (the "statistical" level). Each week they make what they make, use
 * what they need, grow when they're fed and trading and shrink when they're not,
 * and now and then have a boom or a shortage. Their prices come from what's in
 * their stores — so selling them a cartload of bread lowers what bread fetches
 * there, and a shortage in Ironford is an opportunity for whoever gets there first.
 *
 * Trade with the valley happens three ways:
 *   • the valley's surplus goes out with passing traders, and fetches more where
 *     a known settlement needs it (EconomySystem.exportSurplus → exportFactor);
 *   • the valley's warehouses and trading posts send caravans along the roads —
 *     to wherever the goods fetch most, bringing back what's cheap there;
 *   • you travel there yourself with a cargo (on foot, with a handcart, a pack
 *     horse, a horse cart or a wagon), sell, buy, and come home days later.
 * Better roads make every journey shorter and safer; the village builds them
 * where trade is busy, and you can pay for one yourself.
 */
import { SETTLEMENTS, SETTLEMENT_SIZES, PLAYER_TRANSPORT, TRADE as T, ROAD_LEVELS, RAIL } from '../data/settlements.js';
import { REGIONS } from '../data/regions.js';
import { ITEMS } from '../data/items.js';
import { CARRIERS, EQUIPMENT } from '../data/transport.js';
import { Mod } from './Modifiers.js';
import { rand } from '../core/rng.js';

const CARAVAN_LOAD = { porter: 0.5, handcart: 1, horse_cart: 2, wagon: 4 };

export class SettlementSystem {
  constructor(sim) {
    this.sim = sim;
    const S = sim.state;
    S.region ??= { list: {}, caravans: [], nextId: 1, journey: null };
    const R = S.region;
    for (const [id, def] of Object.entries(SETTLEMENTS)) {
      R.list[id] ??= { id, pop: def.pop, stock: this.initialStock(def), contact: false, road: 0, roadWork: null, trade: 0, known: {}, knownDay: null, shocks: [], fed: 1 };
      R.list[id].size ??= this.sizeOf(R.list[id].pop);
    }
    S.player.transport ??= 'foot';
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:minute', (now) => this.onMinute(now));
  }

  get R() {
    return this.sim.state.region;
  }
  get p() {
    return this.sim.state.player;
  }

  initialStock(def) {
    const stock = {};
    for (const [item, n] of Object.entries(def.produces)) stock[item] = Math.round(n * T.stockWeeks);
    for (const [item, n] of Object.entries(def.wants)) stock[item] = Math.round(n * 0.5);
    return stock;
  }

  // ------------------------------------------------------------------ reading

  def(id) {
    return SETTLEMENTS[id];
  }
  get(id) {
    return this.R.list[id];
  }
  ids() {
    return Object.keys(SETTLEMENTS);
  }
  /** Places you've heard of (their region is known). */
  known() {
    return this.ids().filter((id) => this.sim.exploration?.region(this.def(id).region)?.known);
  }
  /** Places the valley trades with. */
  contacts() {
    return this.ids().filter((id) => this.get(id).contact);
  }

  sizeOf(pop) {
    let size = SETTLEMENT_SIZES[0][0];
    for (const [s, min] of SETTLEMENT_SIZES) if (pop >= min) size = s;
    return size;
  }

  scale(id) {
    return this.get(id).pop / this.def(id).pop;
  }

  deals(id, item) {
    const d = this.def(id);
    return d.produces[item] !== undefined || d.wants[item] !== undefined;
  }

  /** Units of this item they'd like to hold. */
  target(id, item) {
    const d = this.def(id);
    return Math.max(1, (d.produces[item] || 0) + (d.wants[item] || 0)) * this.scale(id) * T.stockWeeks;
  }

  /** Their going rate for an item (× base price), from how full their stores are. */
  priceFactor(id, item, extra = 0) {
    const s = this.get(id);
    const fill = ((s.stock[item] || 0) + extra) / this.target(id, item);
    return Math.max(T.priceMin, Math.min(T.priceMax, T.priceHigh - T.priceSlope * fill));
  }

  /** What they charge for one (to you, with your Negotiator discount). */
  buyPrice(id, item, { player = true, extra = 0 } = {}) {
    const f = this.priceFactor(id, item, extra) * (1 + T.spread) * (player ? 1 - Mod.buyBonus(this.p) : 1);
    return Math.max(1, Math.round((ITEMS[item]?.basePrice || 1) * f));
  }

  /** What they pay for one. */
  sellPrice(id, item, { player = true, extra = 0 } = {}) {
    const f = this.priceFactor(id, item, extra) * (1 - T.spread) * (player ? 1 + Mod.sellBonus(this.p, item) : 1);
    return Math.max(1, Math.floor((ITEMS[item]?.basePrice || 1) * f));
  }

  /** Days on the road, one way. Better roads and faster animals shorten it. */
  days(id, speed = 1) {
    const water = this.def(id).water && this.sim.tech?.has('boats') ? T.boatDays : 1; // by boat, once the valley builds them
    const base = REGIONS[this.def(id).region].days * water;
    const lvl = this.roadLevel(id);
    return Math.max(1, Math.round((base * (1 - lvl.cut)) / (lvl.rail ? 1 : speed))); // (by train: the train's pace)
  }

  /** The road there now (ROAD_LEVELS). */
  roadLevel(id) {
    return ROAD_LEVELS[Math.min(ROAD_LEVELS.length - 1, this.get(id).road || 0)];
  }

  /** Is there a railway to this place? */
  byRail(id) {
    return !!this.roadLevel(id).rail;
  }

  /** The valley's railway station (someone has to build one before the first line). */
  station() {
    return Object.values(this.sim.world.buildings).find((b) => b.type === RAIL.stationType) || null;
  }

  danger(id) {
    // A night watch patrols the roads out of the valley (see CivicSystem).
    // Bandits about (EventSystem 'bandits'): the roads are much less safe until they've moved on.
    return REGIONS[this.def(id).region].danger * (1 - this.roadLevel(id).safe) * (this.sim.tech?.mod('road_danger') ?? 1) * (this.sim.events?.modifier('road_danger') ?? 1);
  }

  // ------------------------------------------------------------------ the week out there

  onDay() {
    const sim = this.sim;
    // A trading partner found on an expedition is a settlement the valley now trades with.
    for (const id of this.ids()) {
      const s = this.get(id);
      if (!s.contact && sim.exploration?.region(this.def(id).region)?.partner) this.makeContact(id, 'expedition');
    }
    if (sim.time.weekday === 4) this.weekly();
    if (sim.time.weekday === 0) this.upkeep();
    this.roadWorks();
  }

  weekly() {
    for (const id of this.ids()) this.lifeOf(id);
    this.neighbourTrade();
    this.dispatchCaravans();
    this.villageRoads();
  }

  /** One week in a settlement: make, use, grow or shrink. */
  lifeOf(id) {
    const sim = this.sim;
    const s = this.get(id);
    const d = this.def(id);
    const k = this.scale(id);
    const week = sim.time.day;
    s.shocks = s.shocks.filter((x) => x.until > week);
    const mult = (item) => s.shocks.filter((x) => x.item === item).reduce((m, x) => m * x.mult, 1);
    for (const [item, n] of Object.entries(d.produces)) {
      // What they know how to do (KnowHowSystem) makes them more productive.
      s.stock[item] = Math.min(Math.round(this.target(id, item) * 2.5), (s.stock[item] || 0) + Math.round(n * k * mult(item) * (sim.knowhow?.settlementOutput(id, item) ?? 1)));
    }
    let need = 0;
    let got = 0;
    for (const [item, n] of Object.entries(d.wants)) {
      const want = Math.round(n * k * (s.shocks.some((x) => x.item === item && x.kind === 'shortage') ? 1.6 : 1));
      // Pedlars from the wider world bring some of what they need; the rest has to come from trade.
      s.stock[item] = (s.stock[item] || 0) + Math.round(n * k * T.outsideSupply);
      const used = Math.min(s.stock[item] || 0, want);
      s.stock[item] = (s.stock[item] || 0) - used;
      const food = ITEMS[item]?.food || ['wheat', 'flour'].includes(item);
      need += want * (food ? 2 : 1);
      got += used * (food ? 2 : 1);
    }
    // Some of what they make, they use themselves.
    for (const item of Object.keys(d.produces)) s.stock[item] = Math.max(0, Math.round((s.stock[item] || 0) * (1 - T.localUse)));
    s.fed = need ? got / need : 1;
    // Fortunes: fed and trading → growth; short of what they need → people leave.
    const trading = s.contact ? T.tradeGrowth * (1 + s.road) : 0;
    const change = s.fed >= 0.75 ? T.growthBase + T.growthFed * (s.fed - 0.75) * 4 + trading : s.fed < 0.4 ? -T.shrinkHungry : T.growthBase * 0.5;
    s.pop = Math.max(10, Math.floor(s.pop * (1 + change) + rand.float()));
    const size = this.sizeOf(s.pop);
    if (size !== s.size) {
      const grew = SETTLEMENT_SIZES.findIndex(([x]) => x === size) > SETTLEMENT_SIZES.findIndex(([x]) => x === s.size);
      s.size = size;
      if (s.contact) sim.chronicle(grew ? 'chronicle.settlement_grew' : 'chronicle.settlement_shrank', { settlement: id, size });
    }
    // Now and then: a boom (a rich seam, a great catch) or a shortage (a bad harvest, a fire).
    if (rand.chance(T.shockChance)) {
      const boom = rand.chance(0.5);
      const pool = Object.keys(boom ? d.produces : d.wants);
      const item = rand.pick(pool);
      const until = week + 7 * rand.int(...T.shockWeeks);
      s.shocks.push({ item, kind: boom ? 'boom' : 'shortage', mult: boom ? 1.8 : 1, until });
      if (!boom) s.stock[item] = Math.floor((s.stock[item] || 0) * 0.3);
      if (s.contact) {
        sim.chronicle(boom ? 'chronicle.settlement_boom' : 'chronicle.settlement_shortage', { settlement: id, item });
        sim.rumors?.seed?.(boom ? 'settlement_boom' : 'settlement_shortage', { settlement: id, item });
      }
    }
  }

  /** Settlements trade with each other too: some of every price gap closes each week. */
  neighbourTrade() {
    const ids = this.ids();
    const items = new Set(ids.flatMap((id) => Object.keys(this.def(id).produces)));
    for (const item of items) {
      const dealers = ids.filter((id) => this.deals(id, item));
      if (dealers.length < 2) continue;
      dealers.sort((a, b) => this.priceFactor(a, item) - this.priceFactor(b, item));
      const cheap = dealers[0];
      const dear = dealers[dealers.length - 1];
      const gap = this.priceFactor(dear, item) - this.priceFactor(cheap, item);
      if (gap < 0.3) continue;
      const qty = Math.floor(Math.min(this.get(cheap).stock[item] || 0, this.target(dear, item)) * T.neighbourShare * gap);
      if (qty <= 0) continue;
      this.get(cheap).stock[item] -= qty;
      this.get(dear).stock[item] = (this.get(dear).stock[item] || 0) + qty;
    }
  }

  makeContact(id, how) {
    const s = this.get(id);
    if (s.contact) return;
    s.contact = true;
    s.contactDay = this.sim.time.day;
    this.learnPrices(id, false);
    this.sim.chronicle('chronicle.settlement_contact', { settlement: id, how });
    this.sim.bus.emit('settlement:contact', id);
  }

  /** What the prices are there (you learn them when you go, or from traders' talk). */
  learnPrices(id, player = true) {
    const s = this.get(id);
    s.known = {};
    for (const item of Object.keys({ ...this.def(id).produces, ...this.def(id).wants })) {
      s.known[item] = { buy: this.buyPrice(id, item, { player }), sell: this.sellPrice(id, item, { player }) };
    }
    s.knownDay = this.sim.time.day;
  }

  // ------------------------------------------------------------------ the valley's trade

  /**
   * Passing traders pay more for goods a known settlement is short of.
   * Returns a multiplier for export earnings (1 = no known buyer beyond the usual).
   */
  exportFactor(item) {
    let best = 1;
    for (const id of this.contacts()) {
      if (!this.def(id).wants[item]) continue;
      best = Math.max(best, 0.7 + this.priceFactor(id, item) * 0.4);
    }
    return best;
  }

  /** The surplus reaches whoever pays most for it: their stores fill (and their price falls). */
  absorbExport(item, qty) {
    let to = null;
    let best = 0;
    for (const id of this.contacts()) {
      if (!this.def(id).wants[item]) continue;
      const f = this.priceFactor(id, item);
      if (f > best) (best = f), (to = id);
    }
    if (!to) return;
    // Passing traders sell on to many places: only part of it ends up there.
    const n = Math.round(qty * T.exportShare);
    const s = this.get(to);
    s.stock[item] = (s.stock[item] || 0) + n;
    s.trade += n * (ITEMS[item]?.basePrice || 1);
  }

  /** Goods the valley imports come cheaper from a settlement that makes them (and leave its stores). */
  importFactor(item) {
    let best = 1;
    for (const id of this.contacts()) {
      if (!this.def(id).produces[item] || (this.get(id).stock[item] || 0) <= 0) continue;
      best = Math.min(best, Math.max(0.7, this.priceFactor(id, item) * 1.05));
    }
    return best;
  }

  drawImport(item, qty) {
    for (const id of this.contacts()) {
      const s = this.get(id);
      if (!this.def(id).produces[item] || (s.stock[item] || 0) <= 0) continue;
      const n = Math.min(qty, s.stock[item]);
      s.stock[item] -= n;
      s.trade += n * (ITEMS[item]?.basePrice || 1);
      qty -= n;
      if (qty <= 0) return;
    }
  }

  // ------------------------------------------------------------------ caravans

  /** How much a caravan carries: better carts from the carters' yard, bigger loads. */
  caravanCapacity() {
    const { carrier, firm } = this.sim.logistics?.bestCarrier() || { carrier: 'porter' };
    return { cap: Math.round(T.caravanLoad * (CARAVAN_LOAD[carrier] ?? 1)), carrier, firm, speed: carrier === 'porter' ? 1 : Math.max(1, CARRIERS[carrier].speed / 1.5) };
  }

  /** Where a depot's goods would fetch most (or its owner's chosen route): a plan, or null. */
  planCaravan(bizId) {
    const E = this.sim.economy;
    const b = E.biz(bizId);
    const def = E.def(bizId);
    const { cap, speed } = this.caravanCapacity();
    const route = b.route && this.get(b.route.to)?.contact ? b.route : null;
    const places = route ? [route.to] : this.contacts();
    let best = null;
    for (const id of places) {
      const days = this.days(id, speed);
      const perUnitCost = days * 2 * 0.15;
      const goods = {};
      let room = cap;
      let gain = 0;
      const items = route?.sell?.length ? route.sell : Object.keys(def.targets);
      for (const item of items) {
        if (!this.def(id).wants[item] && !route) continue;
        const keep = route ? 0 : Math.round(E.target(bizId, item) * 0.3);
        const have = Math.max(0, (b.stock[item] || 0) - keep);
        let n = 0;
        while (n < Math.min(have, room)) {
          const price = this.sellPrice(id, item, { player: false, extra: n });
          const local = (ITEMS[item]?.basePrice || 1) * 0.7;
          if (!route && price - local - perUnitCost <= 0) break;
          gain += price - local - perUnitCost;
          n++;
        }
        if (n > 0) {
          goods[item] = n;
          room -= n;
        }
      }
      if (!Object.keys(goods).length) continue;
      if (!best || gain > best.gain) best = { to: id, goods, gain, days };
    }
    if (!best || (!route && best.gain < T.caravanMinProfit)) return null;
    return best;
  }

  /** Weekly: the valley's warehouses and trading posts send out caravans. */
  dispatchCaravans() {
    const sim = this.sim;
    const E = sim.economy;
    if (!this.contacts().length) return;
    for (const bizId of E.active()) {
      if (E.def(bizId).kind !== 'depot') continue;
      if (this.R.caravans.some((c) => c.biz === bizId)) continue; // one at a time
      const plan = this.planCaravan(bizId);
      if (!plan) continue;
      const b = E.biz(bizId);
      for (const [item, n] of Object.entries(plan.goods)) b.stock[item] -= n;
      const { carrier, firm } = this.caravanCapacity();
      const units = Object.values(plan.goods).reduce((a, c) => a + c, 0);
      // The carters are paid for the journey (or porters, if there's no carters' yard).
      const fee = Math.round(units * plan.days * 0.3);
      b.money -= fee;
      E.ledger(bizId, 'exp', fee);
      if (firm) {
        E.biz(firm).money += fee;
        E.ledger(firm, 'rev', fee);
      } else sim.logistics?.payPorters(fee, Math.ceil(units / 8));
      const now = sim.time.total;
      const c = { id: this.R.nextId++, biz: bizId, to: plan.to, goods: plan.goods, imports: {}, carrier, depart: now, arrive: now + plan.days * 1440, back: now + plan.days * 2 * 1440, stage: 'out', earned: 0, spent: 0, fee };
      this.R.caravans.push(c);
      sim.bus.emit('caravan:departed', c);
    }
  }

  onMinute(now) {
    for (const c of this.R.caravans.slice()) {
      if (c.stage === 'out' && now >= c.arrive) this.caravanArrives(c);
      else if (c.stage === 'back' && now >= c.back) this.caravanReturns(c);
    }
    const j = this.R.journey;
    if (j?.stage === 'out' && now >= j.arrive) this.arrive();
    else if (j?.stage === 'back' && now >= j.until) this.returnHome();
  }

  caravanArrives(c) {
    const E = this.sim.economy;
    const s = this.get(c.to);
    // Bandits on the road.
    if (rand.chance(this.danger(c.to) * T.robberyBase * 0.5)) {
      c.robbed = true;
      c.goods = {};
    }
    for (const [item, n] of Object.entries(c.goods)) {
      for (let i = 0; i < n; i++) {
        c.earned += this.sellPrice(c.to, item, { player: false });
        s.stock[item] = (s.stock[item] || 0) + 1;
      }
      s.trade += n * (ITEMS[item]?.basePrice || 1);
    }
    // Bring back what's cheap here and wanted at home (the owner's choice on a set route).
    const b = E.biz(c.biz);
    const def = E.def(c.biz);
    const { cap } = this.caravanCapacity();
    let room = cap;
    const wanted = b?.route?.buy ? [b.route.buy] : Object.keys(def?.targets || {});
    for (const item of wanted) {
      if (!this.def(c.to).produces[item]) continue;
      const home = ITEMS[item]?.basePrice || 1; // worth bringing home if it's no dearer than usual
      let n = 0;
      while (room > 0 && (s.stock[item] || 0) > 0 && (b.route?.buy === item || (b.stock[item] || 0) + n < E.target(c.biz, item))) {
        const price = this.buyPrice(c.to, item, { player: false });
        if ((price > home && b.route?.buy !== item) || c.spent + price > c.earned + Math.max(0, b.money - 60)) break;
        c.spent += price;
        s.stock[item]--;
        room--;
        n++;
      }
      if (n) c.imports[item] = n;
      s.trade += n * (ITEMS[item]?.basePrice || 1);
    }
    c.stage = 'back';
  }

  caravanReturns(c) {
    const sim = this.sim;
    const E = sim.economy;
    this.R.caravans.splice(this.R.caravans.indexOf(c), 1);
    const b = E.biz(c.biz);
    if (!b) return;
    const net = c.earned - c.spent;
    b.money += net;
    E.ledger(c.biz, net >= 0 ? 'rev' : 'exp', Math.abs(net));
    for (const [item, n] of Object.entries(c.imports)) b.stock[item] = (b.stock[item] || 0) + n;
    const S = sim.state.settlement;
    S.caravans = (S.caravans || 0) + 1;
    if (c.robbed) sim.chronicle('chronicle.caravan_robbed', { building: b.building, settlement: c.to });
    else if (S.caravans === 1 || net >= 250) sim.chronicle('chronicle.caravan_back', { building: b.building, settlement: c.to, money: Math.round(c.earned) });
    if (b.owner === 'player') sim.toast(c.robbed ? 'toast.caravan_robbed' : 'toast.caravan_back', { building: b.building, settlement: c.to, money: Math.round(net) }, c.robbed || net < 0 ? 'danger' : 'gain');
    sim.bus.emit('caravan:returned', c);
  }

  /** Set a standing trade route for a depot you own: what to take, what to bring back. */
  setRoute(bizId, route) {
    const b = this.sim.economy.biz(bizId);
    if (!b || b.owner !== 'player') return false;
    if (!route || !route.to) delete b.route;
    else b.route = { to: route.to, sell: route.sell || [], buy: route.buy || null };
    return true;
  }

  /** Where caravans are on the valley's roads (for drawing): near the start and the end of a journey. */
  caravanPosition(c) {
    const L = this.sim.logistics;
    const E = this.sim.economy;
    const building = E.biz(c.biz)?.building;
    const way = this.sim.exploration?.waymark();
    if (!L || !building || !way) return null;
    const now = this.sim.time.total + (this.sim.time.acc || 0) / 600;
    const leg = 240; // minutes spent on the valley's roads each way
    let t;
    if (c.stage === 'out' && now - c.depart < leg) t = (now - c.depart) / leg;
    else if (c.stage === 'back' && c.back - now < leg) t = 1 - (c.back - now) / leg;
    else return null;
    const pos = L.alongRouteTo(building, way, t);
    if (!pos) return null;
    if (c.stage === 'back') pos.facing = { left: 'right', right: 'left', up: 'down', down: 'up' }[pos.facing] || pos.facing;
    return pos;
  }

  // ------------------------------------------------------------------ roads to other places

  roadCost(id) {
    const next = ROAD_LEVELS[this.get(id).road + 1];
    return Math.round(T.roadCostPerDay * REGIONS[this.def(id).region].days * (this.get(id).road + 1) * (next?.cost || 1) * (this.sim.tech?.mod('road_cost') ?? 1));
  }

  /** The next thing the road could become (a highway, a railway) — or null when it's the best there is. */
  nextRoad(id) {
    return ROAD_LEVELS[this.get(id).road + 1] || null;
  }

  canFundRoad(id) {
    const s = this.get(id);
    if (!s?.contact) return { ok: false, reason: 'no_contact' };
    const next = this.nextRoad(id);
    if (!next) return { ok: false, reason: 'road_best' };
    if (s.roadWork) return { ok: false, reason: 'road_underway' };
    if (next.tech && !this.sim.tech?.has(next.tech)) return { ok: false, reason: 'needs_tech', params: { tech: next.tech } };
    if (next.station && !this.station()) return { ok: false, reason: 'need_station' };
    const cost = this.roadCost(id);
    if (this.p.money < cost) return { ok: false, reason: 'no_money', params: { money: cost } };
    return { ok: true, cost };
  }

  /** You pay for the road to be improved (the work takes a few weeks). */
  fundRoad(id) {
    const chk = this.canFundRoad(id);
    if (!chk.ok) return chk;
    this.p.money -= chk.cost;
    this.startRoad(id, 'player');
    this.sim.progression.addReputation(4);
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  startRoad(id, by) {
    const s = this.get(id);
    const weeks = REGIONS[this.def(id).region].days * T.roadWeeksPerDay * (ROAD_LEVELS[s.road + 1]?.weeks || 1);
    s.roadWork = { level: s.road + 1, by, done: this.sim.time.day + weeks * 7 };
    // Road gangs are paid: the work gives the valley's labourers a few weeks' wages.
    this.sim.logistics?.payPorters(Math.round(this.roadCost(id) * 0.3), 4);
    this.sim.chronicle(by === 'player' ? 'chronicle.road_started_player' : 'chronicle.road_started_village', { settlement: id });
  }

  roadWorks() {
    for (const id of this.ids()) {
      const s = this.get(id);
      if (!s.roadWork || this.sim.time.day < s.roadWork.done) continue;
      s.road = s.roadWork.level;
      const by = s.roadWork.by;
      s.roadWork = null;
      if (this.byRail(id)) {
        // The first train: the valley is joined to the wider world.
        this.sim.chronicle('chronicle.railway_opened', { settlement: id, n: this.days(id) });
        this.sim.toast('toast.railway_opened', { settlement: id, n: this.days(id) }, 'good');
        this.sim.bus.emit('railway:opened', id);
        continue;
      }
      this.sim.chronicle('chronicle.road_finished', { settlement: id, n: this.days(id) });
      if (by === 'player') this.sim.toast('toast.road_finished', { settlement: id, n: this.days(id) }, 'good');
    }
  }

  /** The village pays for a better road where trade is busy (and it can afford it). */
  villageRoads() {
    const V = this.sim.state.village;
    for (const id of this.contacts()) {
      const s = this.get(id);
      if (s.roadWork || s.road >= T.roadMaxLevel || s.trade < T.villageRoadTrade * (s.road + 1)) continue;
      const cost = this.roadCost(id);
      if ((V?.treasury || 0) < cost * 1.5) continue;
      V.treasury -= cost;
      this.startRoad(id, 'village');
      return;
    }
  }

  // ------------------------------------------------------------------ your transport

  /** Your best transport for a journey: the best cart or horse you own (EquipmentSystem) that isn't lent out. */
  transport() {
    const kind = this.sim.equipment ? this.sim.equipment.journeyKind() : this.p.transport;
    return PLAYER_TRANSPORT[kind] || PLAYER_TRANSPORT.foot;
  }

  /** What you can take along (to a place with a railway: a goods wagon's worth). */
  cargoCap(id = null) {
    const cap = this.transport().cargo + Mod.perk(this.p, 'carry');
    return id && this.byRail(id) ? Math.max(cap, RAIL.cargo) : cap;
  }

  canBuyTransport(kind) {
    const t = PLAYER_TRANSPORT[kind];
    if (!t || kind === this.p.transport) return { ok: false, reason: 'have_it' };
    if (t.needs && !this.sim.tech?.has(t.needs)) return { ok: false, reason: 'needs_tech', params: { tech: t.needs } };
    const price = this.transportPrice(kind);
    if (this.p.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    return { ok: true, price };
  }

  /** What it costs after trading in what you have (half its price). */
  transportPrice(kind) {
    return Math.max(0, PLAYER_TRANSPORT[kind].price - Math.floor(this.transport().price / 2));
  }

  /** The piece of equipment that's your journey transport now (the one traded in for a better one). */
  transportPiece() {
    const E = this.sim.equipment;
    const kind = E?.journeyKind();
    return kind && kind !== 'foot' ? E.mine().find((e) => E.def(e).journey === kind && E.usable(e) && e.holder?.kind !== 'worker') : null;
  }

  buyTransport(kind) {
    const chk = this.canBuyTransport(kind);
    if (!chk.ok) return chk;
    const E = this.sim.economy;
    this.p.money -= chk.price;
    // The carters' yard (or the carpenter, for a handcart) gets the money.
    const seller = E.ofType('carters')[0] || (kind === 'handcart' ? E.ofType('carpentry')[0] : null);
    if (seller) {
      E.biz(seller).money += chk.price;
      E.ledger(seller, 'rev', chk.price);
    }
    // It's a real cart (or horse) now: it stands in your yard. What you traded in goes to the seller.
    const EQ = this.sim.equipment;
    if (EQ) {
      const old = this.transportPiece();
      if (old) EQ.remove(old.id);
      const type = Object.keys(EQUIPMENT).find((k) => EQUIPMENT[k].journey === kind);
      if (type) EQ.create(type);
      EQ.syncJourney();
    } else this.p.transport = kind;
    this.p.transportUnfed = 0;
    this.sim.chronicle('chronicle.player_transport', { transport: kind });
    this.sim.bus.emit('player:changed');
    return { ok: true, price: chk.price };
  }

  /** Weekly feed for animals. Go without for too long, and the animal is sold. */
  upkeep() {
    const t = this.transport();
    if (!t.upkeep) return;
    const p = this.p;
    if (p.money >= t.upkeep) {
      p.money -= t.upkeep;
      p.transportUnfed = 0;
      const farm = this.sim.economy.ofType('farm')[0];
      if (farm) this.sim.economy.biz(farm).money += t.upkeep; // hay and oats from the farm
      return;
    }
    p.transportUnfed = (p.transportUnfed || 0) + 1;
    this.sim.toast('toast.transport_unfed', { transport: p.transport }, 'danger');
    if (p.transportUnfed >= T.upkeepMissedWeeks) {
      const old = this.sim.equipment?.journeyKind() || p.transport;
      const piece = this.transportPiece();
      if (piece) {
        this.sim.equipment.remove(piece.id);
        this.sim.equipment.syncJourney();
      } else p.transport = old === 'wagon' || old === 'horse_cart' ? 'handcart' : 'foot';
      p.money += Math.floor(PLAYER_TRANSPORT[old].price * 0.3);
      this.sim.toast('toast.transport_sold', { transport: old }, 'danger');
    }
  }

  // ------------------------------------------------------------------ your journeys

  /** What you have to take along (inventory + home storage), for the cargo list. */
  goodsOnHand() {
    const out = {};
    const add = (slots) => {
      for (const s of slots || []) if (ITEMS[s.id] && !ITEMS[s.id].tool && !ITEMS[s.id].questItem && s.id !== 'package') out[s.id] = (out[s.id] || 0) + s.qty;
    };
    add(this.p.inventory);
    add(this.p.storage);
    return out;
  }

  journeyPlan(id) {
    const days = this.days(id, this.transport().speed);
    return { days, food: days * 2 * T.foodPerDay, danger: this.danger(id) };
  }

  canSetOut(id, cargo = {}) {
    const s = this.get(id);
    if (!s || !this.known().includes(id)) return { ok: false, reason: 'region_unknown' };
    if (this.R.journey || this.sim.exploration?.E.trip) return { ok: false, reason: 'already_away' };
    const units = Object.values(cargo).reduce((a, c) => a + c, 0);
    if (units > this.cargoCap(id)) return { ok: false, reason: 'cargo_full', params: { n: this.cargoCap(id) } };
    const have = this.goodsOnHand();
    for (const [item, n] of Object.entries(cargo)) if ((have[item] || 0) < n) return { ok: false, reason: 'not_enough', params: { item } };
    const plan = this.journeyPlan(id);
    const food = (this.sim.exploration?.foodCarried() ?? 0) - (Object.entries(cargo).filter(([i]) => ITEMS[i]?.food).reduce((a, [, n]) => a + n, 0));
    if (food < plan.food) return { ok: false, reason: 'need_food', params: { n: plan.food } };
    if (this.p.health < 35) return { ok: false, reason: 'too_weak' };
    return { ok: true, ...plan };
  }

  /** Take goods from your pockets first, then from your storage chest. */
  takeGoods(item, n) {
    const inv = Math.min(n, this.sim.inventory.count(item));
    if (inv) this.sim.inventory.remove(item, inv);
    if (n - inv > 0) this.sim.home.take(item, n - inv);
  }

  setOut(id, cargo = {}) {
    const chk = this.canSetOut(id, cargo);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const p = this.p;
    for (const [item, n] of Object.entries(cargo)) if (n > 0) this.takeGoods(item, n);
    // Food for the road, cheapest first.
    let need = chk.food;
    const packs = p.inventory.filter((s) => ITEMS[s.id]?.food).sort((a, b) => ITEMS[a.id].basePrice - ITEMS[b.id].basePrice);
    for (const s of packs) {
      if (need <= 0) break;
      const take = Math.min(need, s.qty);
      sim.inventory.remove(s.id, take);
      need -= take;
    }
    const now = sim.time.total;
    this.R.journey = {
      to: id, stage: 'out', depart: now, departDay: sim.time.day, arrive: now + chk.days * 1440, days: chk.days,
      cargo: Object.fromEntries(Object.entries(cargo).filter(([, n]) => n > 0)), sold: {}, bought: {}, earned: 0, spent: 0,
      money0: p.money, seq: sim.state.chronicleSeq || 0,
    };
    p.away = { settlement: id };
    sim.chronicle('chronicle.journey_left', { settlement: id });
    sim.bus.emit('journey:departed', this.R.journey);
    return { ok: true, days: chk.days };
  }

  /** You reach the settlement: the market opens (bandits permitting). */
  arrive() {
    const sim = this.sim;
    const j = this.R.journey;
    j.stage = 'there';
    const s = this.get(j.to);
    if (rand.chance(this.danger(j.to) * T.robberyBase)) {
      // Robbed on the road: part of the cargo, or of your purse.
      const items = Object.keys(j.cargo);
      if (items.length && rand.chance(0.6)) {
        const item = rand.pick(items);
        const lost = Math.ceil(j.cargo[item] * rand.range(0.3, 0.7));
        j.cargo[item] -= lost;
        if (j.cargo[item] <= 0) delete j.cargo[item];
        j.robbed = { item, qty: lost };
      } else {
        const lost = Math.floor(this.p.money * rand.range(0.1, 0.2));
        this.p.money -= lost;
        j.robbed = { money: lost };
      }
    }
    const first = !s.contact;
    this.makeContact(j.to, 'player');
    s.visits = (s.visits || 0) + 1;
    this.learnPrices(j.to);
    sim.progression.addSkillXp('trading', 10);
    if (first) sim.progression.addXp(25);
    sim.bus.emit('journey:arrived', j);
  }

  cargoUnits() {
    return Object.values(this.R.journey?.cargo || {}).reduce((a, c) => a + c, 0);
  }

  /** Sell from your cargo at their market. Each one sold lowers their price a little. */
  sell(item, qty = 1) {
    const j = this.R.journey;
    if (j?.stage !== 'there') return { ok: false };
    const s = this.get(j.to);
    if (!this.deals(j.to, item)) return { ok: false, reason: 'no_buyer' };
    let n = 0;
    let got = 0;
    while (n < qty && (j.cargo[item] || 0) > 0) {
      const price = this.sellPrice(j.to, item);
      got += price;
      j.cargo[item]--;
      s.stock[item] = (s.stock[item] || 0) + 1;
      n++;
    }
    if (!j.cargo[item]) delete j.cargo[item];
    this.p.money += got;
    j.earned += got;
    j.sold[item] = (j.sold[item] || 0) + n;
    s.trade += n * (ITEMS[item]?.basePrice || 1);
    this.sim.progression.addSkillXp('trading', Math.ceil(n / 2));
    this.learnPrices(j.to);
    this.sim.bus.emit('player:changed');
    return { ok: n > 0, n, money: got };
  }

  /** Buy their goods into your cargo (as far as room and money allow). */
  buy(item, qty = 1) {
    const j = this.R.journey;
    if (j?.stage !== 'there') return { ok: false };
    const s = this.get(j.to);
    let n = 0;
    let paid = 0;
    while (n < qty && (s.stock[item] || 0) > 0 && this.cargoUnits() < this.cargoCap()) {
      const price = this.buyPrice(j.to, item);
      if (this.p.money < price) break;
      this.p.money -= price;
      paid += price;
      s.stock[item]--;
      j.cargo[item] = (j.cargo[item] || 0) + 1;
      n++;
    }
    j.spent += paid;
    j.bought[item] = (j.bought[item] || 0) + n;
    s.trade += n * (ITEMS[item]?.basePrice || 1);
    this.learnPrices(j.to);
    this.sim.bus.emit('player:changed');
    return { ok: n > 0, n, money: paid };
  }

  headHome() {
    const j = this.R.journey;
    if (j?.stage !== 'there') return { ok: false };
    j.stage = 'back';
    j.until = this.sim.time.total + j.days * 1440;
    this.sim.bus.emit('journey:homeward', j);
    return { ok: true, days: j.days };
  }

  /** Home at the waymark: the cargo goes into your storage chest; a report of how it went. */
  returnHome() {
    const sim = this.sim;
    const j = this.R.journey;
    this.R.journey = null;
    const p = this.p;
    delete p.away;
    const at = sim.exploration.waymark();
    p.x = at.x;
    p.y = at.y;
    p.hunger = Math.max(p.hunger, 45);
    p.energy = Math.max(20, p.energy - 20);
    for (const [item, n] of Object.entries(j.cargo)) sim.home.store(item, n, { force: true });
    const report = { journey: true, settlement: j.to, sold: j.sold, bought: j.bought, earned: j.earned, spent: j.spent, cargo: j.cargo, robbed: j.robbed || null, days: sim.time.day - j.departDay, departDay: j.departDay, seq: j.seq };
    const profit = j.earned - j.spent;
    sim.progression.addXp(10 + Math.max(0, Math.round(profit / 20)));
    sim.progression.addSkillXp('trading', 5 + j.days * 3);
    sim.chronicle('chronicle.journey_back', { settlement: j.to, money: Math.round(j.earned) });
    sim.bus.emit('journey:returned', report);
    sim.bus.emit('player:changed');
    return report;
  }

  // ------------------------------------------------------------------ people moving between places

  /** Somewhere a household leaving the valley might go (the biggest, best-fed known place). */
  destinationFor(group) {
    const options = this.contacts().filter((id) => this.get(id).fed >= 0.6);
    if (!options.length) return null;
    const id = options.sort((a, b) => this.get(b).pop * this.get(b).fed - this.get(a).pop * this.get(a).fed)[0];
    this.get(id).pop += group.length;
    return id;
  }

  /** A known place newcomers might come from. */
  originFor(n) {
    const options = this.known();
    if (!options.length) return null;
    const id = rand.pick(options);
    this.get(id).pop = Math.max(10, this.get(id).pop - n);
    return id;
  }

  // ------------------------------------------------------------------ for the UI and the debug panel

  summary() {
    return this.ids().map((id) => {
      const s = this.get(id);
      return { id, pop: s.pop, size: s.size, contact: s.contact, road: s.road, fed: Math.round(s.fed * 100), trade: Math.round(s.trade) };
    });
  }
}
