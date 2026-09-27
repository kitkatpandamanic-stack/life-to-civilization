/**
 * TownOrderSystem — orders from the towns you know: "200 planks by the end of the month". A town you've made
 * contact with (SettlementSystem) sends word of something it's short of — from what it always wants — with a
 * price and a deadline. Take it on at the hall, bring the goods there (as many at a time as you like: each
 * load is paid as it's handed over, the carriers take it on), and finishing it in time earns a bonus and
 * your name in that town. Taken on and not finished: they remember that too.
 *
 * No dice: what's wanted, how much and for how long follow the week and the town (hashStr).
 *
 *   state.townOrders = { list: [{ id, town, item, qty, delivered, perUnit, bonus, day, deadline, taken, done, failed }], nextId, done, failed }
 */
import { SETTLEMENTS } from '../data/settlements.js';
import { ITEMS } from '../data/items.js';
import { hashStr } from '../core/rng.js';

export const TOWN_ORDERS = {
  weekday: 3,
  maxOpen: 2,
  weeks: [3, 7], // how many weeks of the town's wants
  priceMult: 1.7, // a unit, against its usual price
  bonus: 0.25, // on top, for finishing in time (a share of the whole order)
  days: [21, 35],
  rep: 3,
  failRep: -2,
  keep: 12,
};

export class TownOrderSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.townOrders ??= { list: [], nextId: 1, done: 0, failed: 0 };
    sim.bus.on('time:day', () => this.onDay());
  }

  get S() {
    return this.sim.state.townOrders;
  }

  open() {
    return this.S.list.filter((o) => !o.done && !o.failed);
  }

  byId(id) {
    return this.S.list.find((o) => o.id === id) || null;
  }

  left(o) {
    return Math.max(0, o.qty - o.delivered);
  }

  /** A town you know sends an order (weekly, while there's room for one). */
  offer() {
    const sim = this.sim;
    const towns = (sim.settlements?.known() || []).filter((id) => SETTLEMENTS[id]?.wants);
    if (!towns.length || this.open().length >= TOWN_ORDERS.maxOpen) return null;
    const week = Math.floor(sim.time.day / 7);
    const seed = sim.state.seed;
    const town = towns[Math.floor(hashStr(`order_town:${week}`, seed) * towns.length)];
    if (this.open().some((o) => o.town === town)) return null;
    const wants = Object.entries(SETTLEMENTS[town].wants).filter(([item]) => ITEMS[item]);
    if (!wants.length) return null;
    const [item, perWeek] = wants[Math.floor(hashStr(`order_item:${week}`, seed) * wants.length)];
    const [w0, w1] = TOWN_ORDERS.weeks;
    const qty = Math.max(3, Math.round(perWeek * (w0 + hashStr(`order_qty:${week}`, seed) * (w1 - w0))));
    const perUnit = Math.max(1, Math.round((ITEMS[item].basePrice || 1) * TOWN_ORDERS.priceMult));
    const [d0, d1] = TOWN_ORDERS.days;
    const o = {
      id: this.S.nextId++, town, item, qty, delivered: 0, perUnit,
      bonus: Math.round(qty * perUnit * TOWN_ORDERS.bonus),
      day: sim.time.day, deadline: sim.time.day + d0 + Math.floor(hashStr(`order_days:${week}`, seed) * (d1 - d0)),
      taken: false, done: false, failed: false,
    };
    this.S.list.push(o);
    while (this.S.list.length > TOWN_ORDERS.keep) this.S.list.shift();
    sim.chronicle('chronicle.town_order', { settlement: town, item, n: qty });
    sim.bus.emit('orders:changed');
    return o;
  }

  canTake(o) {
    if (!o || o.done || o.failed) return { ok: false, reason: 'contract_gone' };
    if (o.taken) return { ok: false, reason: 'order_taken' };
    return { ok: true };
  }

  take(id) {
    const o = this.byId(id);
    const chk = this.canTake(o);
    if (!chk.ok) return chk;
    o.taken = true;
    this.sim.bus.emit('orders:changed');
    return { ok: true };
  }

  canDeliver(o) {
    if (!o || o.done || o.failed) return { ok: false, reason: 'contract_gone' };
    if (!o.taken) return { ok: false, reason: 'order_not_taken' };
    if (this.sim.inventory.count(o.item) <= 0) return { ok: false, reason: 'need_item', params: { item: o.item, qty: 1 } };
    return { ok: true };
  }

  /** Hand over what you're carrying (at the hall): paid for as it's handed over. */
  deliver(id) {
    const sim = this.sim;
    const o = this.byId(id);
    const chk = this.canDeliver(o);
    if (!chk.ok) return chk;
    const n = Math.min(this.left(o), sim.inventory.count(o.item));
    sim.inventory.remove(o.item, n);
    o.delivered += n;
    let pay = n * o.perUnit;
    const finished = o.delivered >= o.qty;
    if (finished) {
      o.done = true;
      pay += o.bonus;
      this.S.done++;
      sim.progression.addReputation(TOWN_ORDERS.rep);
      sim.chronicle('chronicle.town_order_done', { settlement: o.town, item: o.item, n: o.qty });
    }
    sim.state.player.money += pay;
    sim.state.stats.moneyEarned = (sim.state.stats.moneyEarned || 0) + pay;
    sim.bus.emit('player:changed');
    sim.bus.emit('orders:changed');
    return { ok: true, n, pay, finished };
  }

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    for (const o of this.open()) {
      if (day <= o.deadline) continue;
      o.failed = true;
      if (o.taken) {
        this.S.failed++;
        sim.progression.addReputation(TOWN_ORDERS.failRep);
        sim.toast('toast.town_order_failed', { settlement: o.town, item: o.item }, 'danger');
      }
    }
    if (sim.time.weekday === TOWN_ORDERS.weekday) this.offer();
  }
}
