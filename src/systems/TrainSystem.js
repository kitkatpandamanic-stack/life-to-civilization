/**
 * TrainSystem — the railway in the valley: trains that come and go on a timetable, goods sent and
 * ordered by rail, and the goods yard at the station.
 *
 *   state.trains = { arrivals, yard: { item: n }, sends: [...], orders: [...], nextId, log: [...] }
 *
 * A railway line (SettlementSystem: a road of level 4, laid from your station) has a train in each
 * direction a few times a day (TRAIN.hours; each line half an hour after the last). A train comes in
 * from the edge of the valley along the line, waits at the station, and goes out again — where it is
 * is worked out from the clock alone (at()), so nothing needs keeping and saves stay small.
 *
 * With every train:
 *   • travellers spend a little at the tavern and the store;
 *   • goods you've ordered from that town arrive in the goods yard (you, or your workers — TrainTasks —
 *     collect them to your storage);
 *   • goods you've sent go out with it; they're sold there, and the takings come back with a later train.
 * Newcomers to the valley step off at the station (GrowthSystem.arrive).
 * No dice are rolled.
 */
import { TRAIN } from '../data/settlements.js';
import { ITEMS } from '../data/items.js';

export class TrainSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.trains ??= { arrivals: 0, yard: {}, sends: [], orders: [], nextId: 1, log: [] };
    const S = this.S;
    S.yard ??= {};
    S.sends ??= [];
    S.orders ??= [];
    S.log ??= [];
    sim.bus.on('time:minute', (now) => this.onMinute(now));
  }

  get S() {
    return this.sim.state.trains;
  }

  /** Railway lines: the settlements joined to the valley by rail (in a fixed order). */
  lines() {
    const ST = this.sim.settlements;
    if (!ST?.station()) return [];
    return ST.ids().filter((id) => ST.byRail(id));
  }

  station() {
    return this.sim.settlements?.station() || null;
  }

  /** This line's trains today: minutes (from midnight) when each reaches the station. */
  times(line) {
    const i = Math.max(0, this.lines().indexOf(line));
    return TRAIN.hours.map((h) => h * 60 + i * TRAIN.stagger);
  }

  /**
   * The trains in the valley right now: [{ line, t (0 at the valley's edge … 1 at the station), stage
   * ('in' | 'at' | 'out'), arrive }] — from the clock alone.
   */
  at(now = this.sim.time.total + (this.sim.time.acc || 0) / 600) {
    const out = [];
    const day = Math.floor(now / 1440);
    for (const line of this.lines()) {
      for (const m of this.times(line)) {
        const arrive = day * 1440 + m;
        const d = now - arrive;
        if (d >= -TRAIN.approach && d < 0) out.push({ line, stage: 'in', t: 1 + d / TRAIN.approach, arrive });
        else if (d >= 0 && d < TRAIN.dwell) out.push({ line, stage: 'at', t: 1, arrive });
        else if (d >= TRAIN.dwell && d < TRAIN.dwell + TRAIN.approach) out.push({ line, stage: 'out', t: 1 - (d - TRAIN.dwell) / TRAIN.approach, arrive });
      }
    }
    return out;
  }

  /** The next train on a line: minutes until it reaches the station. */
  nextIn(line) {
    const now = this.sim.time.total;
    const day = Math.floor(now / 1440);
    for (const d of [0, 1]) for (const m of this.times(line)) {
      const at = (day + d) * 1440 + m;
      if (at >= now) return at - now;
    }
    return null;
  }

  // ------------------------------------------------------------------ the clock

  onMinute(now) {
    const lines = this.lines();
    if (!lines.length) return;
    const m = now % 1440;
    for (const line of lines) {
      for (const t of this.times(line)) {
        if (m === t) this.arrived(line, now);
        else if (m === t + TRAIN.dwell) this.departed(line, now);
      }
    }
  }

  /** A train from `line` pulls in. */
  arrived(line, now) {
    const sim = this.sim;
    this.S.arrivals++;
    // Travellers spend a little.
    for (const type of ['tavern', 'general_store']) {
      const id = sim.economy.ofType(type)[0];
      if (!id) continue;
      sim.economy.biz(id).money += TRAIN.travellerSpend;
      sim.economy.ledger(id, 'rev', TRAIN.travellerSpend);
    }
    // Your orders from there.
    for (const o of this.S.orders.slice()) {
      if (o.from !== line || now < o.due) continue;
      this.S.yard[o.item] = (this.S.yard[o.item] || 0) + o.qty;
      this.S.orders.splice(this.S.orders.indexOf(o), 1);
      this.log({ kind: 'order_in', item: o.item, qty: o.qty, settlement: line });
      sim.toast('toast.rail_goods_in', { qty: o.qty, item: o.item, settlement: line }, 'good');
    }
    // The takings for goods you sent there.
    for (const s of this.S.sends.slice()) {
      if (s.to !== line || s.stage !== 'sold' || now < s.payAt) continue;
      this.S.sends.splice(this.S.sends.indexOf(s), 1);
      this.takings(s.earned);
      this.log({ kind: 'sold', settlement: line, money: s.earned });
      sim.toast('toast.rail_takings', { settlement: line, money: s.earned }, 'gain');
    }
    sim.bus.emit('train:arrived', { line });
  }

  /** It leaves: your goods for that town go with it (sold there, the money comes back with a later train). */
  departed(line, now) {
    const sim = this.sim;
    const ST = sim.settlements;
    for (const s of this.S.sends) {
      if (s.to !== line || s.stage !== 'waiting') continue;
      const there = ST.get(line);
      let earned = 0;
      for (const [item, n] of Object.entries(s.cargo)) {
        for (let i = 0; i < n; i++) {
          earned += ST.sellPrice(line, item, { player: false });
          there.stock[item] = (there.stock[item] || 0) + 1;
        }
        there.trade += n * (ITEMS[item]?.basePrice || 1);
      }
      s.earned = earned;
      s.stage = 'sold';
      s.payAt = now + 2 * ST.days(line) * 1440;
    }
    sim.bus.emit('train:departed', { line });
  }

  takings(n) {
    this.sim.state.player.money += n;
  }

  log(e) {
    this.S.log.unshift({ day: this.sim.time.day, ...e });
    if (this.S.log.length > 30) this.S.log.pop();
  }

  // ------------------------------------------------------------------ sending and ordering

  /** Carriage for n units (the railway's carters fetch it from your storage). */
  fee(units) {
    return Math.max(TRAIN.minFee, Math.round(units * TRAIN.feePerUnit));
  }

  canSend(to, cargo) {
    if (!this.lines().includes(to)) return { ok: false, reason: 'no_railway' };
    const units = Object.values(cargo).reduce((a, b) => a + b, 0);
    if (units <= 0) return { ok: false, reason: 'cargo_small', params: { n: 1 } };
    for (const [item, n] of Object.entries(cargo)) if (this.sim.home.storageCount(item) < n) return { ok: false, reason: 'not_in_storage', params: { item } };
    const fee = this.fee(units);
    if (this.sim.state.player.money < fee) return { ok: false, reason: 'no_money', params: { money: fee } };
    return { ok: true, fee, units };
  }

  send(to, cargo) {
    const chk = this.canSend(to, cargo);
    if (!chk.ok) return chk;
    const sim = this.sim;
    for (const [item, n] of Object.entries(cargo)) sim.home.take(item, n);
    this.carriage(chk.fee);
    this.S.sends.push({ id: this.S.nextId++, to, cargo: { ...cargo }, stage: 'waiting', earned: 0, payAt: null, day: sim.time.day });
    sim.toast('toast.rail_sent', { n: chk.units, settlement: to }, 'info');
    sim.bus.emit('trains:changed');
    return { ok: true };
  }

  /** What an order would cost (their price + carriage). */
  quote(from, item, qty) {
    return this.sim.settlements.buyPrice(from, item, { player: false }) * qty + this.fee(qty);
  }

  canOrder(from, item, qty) {
    const ST = this.sim.settlements;
    if (!this.lines().includes(from)) return { ok: false, reason: 'no_railway' };
    if (!ST.def(from).produces[item]) return { ok: false, reason: 'not_sold_there' };
    if ((ST.get(from).stock[item] || 0) < qty) return { ok: false, reason: 'not_enough_there' };
    const cost = this.quote(from, item, qty);
    if (this.sim.state.player.money < cost) return { ok: false, reason: 'no_money', params: { money: cost } };
    return { ok: true, cost };
  }

  order(from, item, qty) {
    const chk = this.canOrder(from, item, qty);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const ST = sim.settlements;
    this.purchase(chk.cost);
    ST.get(from).stock[item] -= qty;
    ST.get(from).trade += qty * (ITEMS[item]?.basePrice || 1);
    this.S.orders.push({ id: this.S.nextId++, from, item, qty, due: sim.time.total + ST.days(from) * 1440 });
    sim.toast('toast.rail_ordered', { qty, item, settlement: from }, 'info');
    sim.bus.emit('trains:changed');
    return { ok: true };
  }

  carriage(n) {
    this.sim.state.player.money -= n;
  }
  purchase(n) {
    this.sim.state.player.money -= n;
  }

  // ------------------------------------------------------------------ the goods yard

  yardTotal() {
    return Object.values(this.S.yard).reduce((a, b) => a + b, 0);
  }

  takeYard(n = Infinity) {
    const out = {};
    for (const item of Object.keys(this.S.yard)) {
      const k = Math.min(this.S.yard[item], n);
      if (k <= 0) continue;
      out[item] = k;
      this.S.yard[item] -= k;
      n -= k;
      if (!this.S.yard[item]) delete this.S.yard[item];
      if (n <= 0) break;
    }
    return out;
  }

  /** You, at the station: into your pockets (as much as you can carry). */
  collect() {
    const sim = this.sim;
    let got = 0;
    for (const [item, n] of Object.entries(this.S.yard)) {
      const added = sim.inventory.add(item, n) || 0;
      if (added) {
        this.S.yard[item] -= added;
        if (!this.S.yard[item]) delete this.S.yard[item];
        got += added;
      }
    }
    sim.toast(got ? 'toast.yard_collected' : 'toast.produce_none', { n: got }, got ? 'gain' : 'info');
    sim.bus.emit('trains:changed');
    return got;
  }

  summary() {
    return { lines: this.lines(), arrivals: this.S.arrivals, yard: this.yardTotal(), sends: this.S.sends.length, orders: this.S.orders.length };
  }
}

/** Your workers fetch what's waiting in the goods yard to your storage (mixed into WorkerSystem). */
export const TrainTasks = {
  trainTasks(npc, c, pos, add) {
    const T = this.sim.trains;
    const st = T?.station();
    if (!st || T.yardTotal() < 1) return;
    add({ key: `yard:${st.id}`, kind: 'tcollect', cat: 'hauling', target: st.id, tx: st.door.tx, ty: st.door.ty, urgent: 30, cap: 2 });
  },

  trainFetch(npc, c, t) {
    const items = this.sim.trains.takeYard(this.carryCap(npc));
    const qty = Object.values(items).reduce((a, b) => a + b, 0);
    if (!qty) {
      this.block(c, t, 60);
      return this.next(npc);
    }
    npc.carry = { item: Object.keys(items)[0], qty, items, to: null };
    this.sim.bus.emit('trains:changed');
    return this.loaded(npc, c);
  },
};
