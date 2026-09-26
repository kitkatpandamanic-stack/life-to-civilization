/**
 * LogisticsSystem — goods travel through the world.
 *
 * When a shop restocks from a producer (or a warehouse, or another shop), the
 * goods don't teleport: a shipment leaves the supplier's door, travels the
 * roads, and arrives some time later. Who carries it depends on what the
 * village has: porters on foot (people out of work, paid per load) at first;
 * a carters' firm with handcarts, horse carts or wagons later. Distance and
 * roads decide how long it takes and what it costs — so where a business is
 * matters, and a new road really does make trade cheaper.
 *
 *   state.logistics = { shipments: [...], nextId, log: [...] }
 *   shipment = { id, from, to, item, qty, carrier, trips, depart, arrive, fee, dist }
 */
import { CARRIERS, LOGISTICS as L } from '../data/transport.js';
import { findPath } from '../world/Pathfinder.js';

export class LogisticsSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.logistics ??= { shipments: [], nextId: 1, log: [], today: { trips: 0, units: 0, fees: 0 } };
    this.routes = new Map(); // "from→to" → { path, minutes: {carrier: m}, dist } (runtime cache)
    sim.bus.on('time:minute', (m) => this.onMinute(m));
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('road:built', () => this.routes.clear());
    sim.bus.on('building:added', () => this.routes.clear());
  }

  get L() {
    return this.sim.state.logistics;
  }

  /** Can this kind of carrier be used yet? (technology, and a carters' firm to run it) */
  available(carrier) {
    const needs = CARRIERS[carrier].needs;
    if (!needs) return true;
    return !!this.sim.tech?.has(needs);
  }

  /** The best carrier a carters' firm can put on the road (or porters if there's no firm). */
  bestCarrier() {
    const carters = this.sim.economy.ofType('carters');
    if (!carters.length) return { carrier: 'porter', firm: null };
    let best = 'porter';
    for (const c of Object.keys(CARRIERS)) if (this.available(c) && CARRIERS[c].speed > CARRIERS[best].speed) best = c;
    return { carrier: best === 'porter' ? 'handcart' : best, firm: carters[0] };
  }

  /** Route between two buildings' doors (along roads where possible). */
  route(fromBuilding, toBuilding) {
    const key = `${fromBuilding}→${toBuilding}`;
    let r = this.routes.get(key);
    if (r) return r;
    const w = this.sim.world;
    const a = w.buildings[fromBuilding]?.door;
    const b = w.buildings[toBuilding]?.door;
    if (!a || !b) return null;
    const s = w.nearestWalkable(a.tx, a.ty, 3);
    const g = w.nearestWalkable(b.tx, b.ty, 3);
    const path = findPath(w, s.tx, s.ty, g.tx, g.ty) || [];
    let roadTiles = 0;
    for (const p of path) if (w.isRoad(p.tx, p.ty)) roadTiles++;
    const dist = Math.max(1, path.length || Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty));
    const minutes = {};
    for (const [c, def] of Object.entries(CARRIERS)) {
      minutes[c] = Math.round(L.loadMinutes + roadTiles / (def.speed * L.roadBonus) + (dist - roadTiles) / def.speed);
    }
    r = { path: [{ tx: s.tx, ty: s.ty }, ...path], dist, roadTiles, minutes };
    this.routes.set(key, r);
    return r;
  }

  /** Transport fee for qty units between two buildings. */
  quote(fromBuilding, toBuilding, qty) {
    const r = this.route(fromBuilding, toBuilding);
    const { carrier } = this.bestCarrier();
    return r ? Math.max(1, Math.round(qty * r.dist * CARRIERS[carrier].fee)) : 0;
  }

  /**
   * Send goods. The supplier has already been paid and has handed the goods over;
   * the buyer receives them when the shipment arrives. The buyer pays the carriage.
   */
  ship(fromBiz, toBiz, item, qty) {
    const E = this.sim.economy;
    const fromB = E.biz(fromBiz).building;
    const toB = E.biz(toBiz).building;
    const r = this.route(fromB, toB);
    const { carrier, firm } = this.bestCarrier();
    const def = CARRIERS[carrier];
    const minutes = r ? r.minutes[carrier] : 30;
    const weather = this.sim.weather.isBad() ? 1.4 : 1;
    const fee = r ? Math.max(1, Math.round(qty * r.dist * def.fee)) : 0;
    const now = this.sim.time.total;
    const s = {
      id: this.L.nextId++,
      from: fromBiz,
      to: toBiz,
      fromB,
      toB,
      item,
      qty,
      carrier,
      firm,
      trips: Math.ceil(qty / def.cap),
      depart: now,
      arrive: now + Math.round(minutes * weather),
      fee,
      dist: r?.dist || 0,
    };
    // You're a carrier (FreightSystem): some loads come to you. The buyer pays your fee; the goods
    // arrive when you (or your workers) have carried them there — not by themselves.
    const job = r && this.sim.freight?.offer(s, r);
    if (job) {
      s.player = job.id;
      s.carrier = 'porter';
      s.arrive = Infinity;
      s.fee = job.fee;
      E.biz(toBiz).money -= job.fee;
      E.ledger(toBiz, 'exp', job.fee);
      this.L.shipments.push(s);
      this.sim.bus.emit('logistics:shipped', s);
      return s;
    }
    // Carriage is paid now: to the carters' firm, or to porters (people out of work earn a little).
    const buyer = E.biz(toBiz);
    buyer.money -= fee;
    E.ledger(toBiz, 'exp', fee);
    if (firm) {
      E.biz(firm).money += fee;
      E.ledger(firm, 'rev', fee);
    } else this.payPorters(fee, s.trips);
    this.L.shipments.push(s);
    const T = this.L.today;
    T.trips += s.trips;
    T.units += qty;
    T.fees += fee;
    this.sim.bus.emit('logistics:shipped', s);
    return s;
  }

  /** Porters: anyone out of work (or the supplier's own people) carries loads for a fee. */
  payPorters(fee, trips) {
    const idle = this.sim.state.npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 16 && !n.leaving);
    if (!idle.length) return;
    const share = Math.floor((fee * L.porterPayShare) / Math.min(idle.length, trips));
    for (let i = 0; i < Math.min(idle.length, trips); i++) idle[i].money += share;
  }

  onMinute(now) {
    const list = this.L.shipments;
    if (!list.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (now < s.arrive) continue;
      const E = this.sim.economy;
      const to = E.biz(s.to);
      if (to && !to.closed) to.stock[s.item] = (to.stock[s.item] || 0) + s.qty;
      else {
        // The buyer closed while the goods were on the road: they go back.
        const from = E.biz(s.from);
        if (from) from.stock[s.item] = (from.stock[s.item] || 0) + s.qty;
      }
      list.splice(i, 1);
      this.sim.bus.emit('logistics:arrived', s);
    }
  }

  /** Goods on their way to a business (for restock decisions: don't order twice). */
  incoming(bizId, item) {
    let n = 0;
    for (const s of this.L.shipments) if (s.to === bizId && s.item === item) n += s.qty;
    return n;
  }

  /** The way (tiles) from a building's door to a spot {x, y} — for caravans heading out, and the railway line. */
  pathTo(fromBuilding, to) {
    const w = this.sim.world;
    const key = `${fromBuilding}→${Math.round(to.x)},${Math.round(to.y)}`;
    let r = this.routes.get(key);
    if (!r) {
      const a = w.buildings[fromBuilding]?.door;
      if (!a) return null;
      const s = w.nearestWalkable(a.tx, a.ty, 3);
      const g = w.nearestWalkable(Math.floor(to.x / 32), Math.floor(to.y / 32), 3);
      const path = findPath(w, s.tx, s.ty, g.tx, g.ty) || [];
      r = { path: [{ tx: s.tx, ty: s.ty }, ...path] };
      this.routes.set(key, r);
    }
    return r.path;
  }

  /** A point t (0–1) of the way from a building's door to a spot {x, y} (for caravans heading out of the valley). */
  alongRouteTo(fromBuilding, to, t) {
    const w = this.sim.world;
    const path = this.pathTo(fromBuilding, to);
    if (!path) return null;
    const r = { path };
    if (r.path.length < 2) return null;
    const f = Math.max(0, Math.min(1, t)) * (r.path.length - 1);
    const i = Math.floor(f);
    const pa = w.tileCenter(r.path[i].tx, r.path[i].ty);
    const pb = w.tileCenter(r.path[Math.min(r.path.length - 1, i + 1)].tx, r.path[Math.min(r.path.length - 1, i + 1)].ty);
    const k = f - i;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    return { x: pa.x + dx * k, y: pa.y + dy * k, facing: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', moving: t > 0 && t < 1 };
  }

  /** Where a shipment is right now (for drawing carts): { x, y, facing } or null. */
  position(s) {
    if (s.player) return null; // (yours: your workers carry it, and you see them)
    const r = this.route(s.fromB, s.toB);
    if (!r || r.path.length < 2) return null;
    const now = this.sim.time.total + (this.sim.time.acc || 0) / 600;
    const loading = Math.min(L.loadMinutes / 2, (s.arrive - s.depart) / 3);
    const t = Math.max(0, Math.min(1, (now - s.depart - loading) / Math.max(1, s.arrive - s.depart - loading * 2)));
    const f = t * (r.path.length - 1);
    const i = Math.floor(f);
    const a = r.path[i];
    const b = r.path[Math.min(r.path.length - 1, i + 1)];
    const k = f - i;
    const TS = this.sim.world.tileCenter(0, 0);
    const pa = this.sim.world.tileCenter(a.tx, a.ty);
    const pb = this.sim.world.tileCenter(b.tx, b.ty);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    return { x: pa.x + dx * k, y: pa.y + dy * k, facing: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', moving: t > 0 && t < 1, ts: TS };
  }

  onDay() {
    const L2 = this.L;
    L2.log.push({ day: this.sim.time.day - 1, ...L2.today });
    if (L2.log.length > L.historyDays) L2.log.shift();
    L2.today = { trips: 0, units: 0, fees: 0 };
  }
}
