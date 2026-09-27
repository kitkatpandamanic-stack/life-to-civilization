/**
 * StallSystem — your own market stall on the village square.
 *
 * Rent one of the square's stalls for the day (the rent goes to the village), set out what you have — your
 * crops, apples, fish, honey, furniture you've made — and choose your prices: cheaper than the shops and the
 * villagers passing by snap it up; dearer and they walk on. Each hour of market time some of them stop and buy
 * (more of them in a bigger village, fewer in the rain; food sells best). At closing time what's left comes
 * back to you. The money comes out of the buyers' own purses.
 *
 * No dice: who stops and what they buy follow the day, the hour and the goods (hashStr).
 *
 *   state.stall = { day, goods: { item: qty }, markup, sold: [{ item, qty, money, hour, npc }], earned, days, total }
 */
import { ITEMS } from '../data/items.js';
import { FOOD } from './EconomySystem.js';
import { hashStr } from '../core/rng.js';

export const STALL = {
  rent: 5,
  open: 8,
  close: 18,
  markups: [0.8, 1, 1.2, 1.5],
  perHour: 0.55, // units of each thing a village of popRef buys an hour at the usual price
  popRef: 20,
  foodBoost: 1.4,
  rain: 0.6,
  maxKinds: 8,
};

export class StallSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.stall ??= { day: -1, goods: {}, markup: 1, sold: [], earned: 0, days: 0, total: 0 };
    sim.bus.on('time:hour', (h) => this.onHour(h));
  }

  get S() {
    return this.sim.state.stall;
  }

  isOpen() {
    const h = this.sim.time.hour;
    return this.S.day === this.sim.time.day && h >= STALL.open && h < STALL.close;
  }

  rentedToday() {
    return this.S.day === this.sim.time.day;
  }

  canOpen() {
    const h = this.sim.time.hour;
    if (this.rentedToday()) return { ok: false, reason: 'stall_rented' };
    if (h >= STALL.close - 1) return { ok: false, reason: 'too_late', params: { hour: STALL.close - 1 } };
    if (this.sim.state.player.money < STALL.rent) return { ok: false, reason: 'no_money' };
    return { ok: true };
  }

  /** Rent the stall for today. */
  open() {
    const chk = this.canOpen();
    if (!chk.ok) return chk;
    const sim = this.sim;
    sim.state.player.money -= STALL.rent;
    sim.state.village.treasury += STALL.rent;
    this.S.day = sim.time.day;
    this.S.goods = {};
    this.S.sold = [];
    this.S.earned = 0;
    this.S.days = (this.S.days || 0) + 1;
    if (this.S.days === 1) sim.chronicle('chronicle.player_stall', {});
    sim.bus.emit('player:changed');
    sim.bus.emit('stall:changed');
    return { ok: true };
  }

  /** Can this be sold at a stall? (Not tools, not what you're carrying for someone.) */
  sellable(item) {
    const d = ITEMS[item];
    return !!d && !d.tool && !d.questItem && item !== 'package' && (d.basePrice || 0) > 0;
  }

  put(item, qty) {
    if (!this.rentedToday()) return { ok: false, reason: 'stall_not_rented' };
    if (!this.sellable(item)) return { ok: false, reason: 'cant_sell_that' };
    if (!this.S.goods[item] && Object.keys(this.S.goods).length >= STALL.maxKinds) return { ok: false, reason: 'stall_full' };
    const n = Math.min(qty, this.sim.inventory.count(item));
    if (n <= 0) return { ok: false, reason: 'need_item', params: { item, qty: 1 } };
    this.sim.inventory.remove(item, n);
    this.S.goods[item] = (this.S.goods[item] || 0) + n;
    this.sim.bus.emit('stall:changed');
    return { ok: true, n };
  }

  take(item, qty = Infinity) {
    const have = this.S.goods[item] || 0;
    const n = Math.min(qty, have);
    if (n <= 0) return { ok: false };
    this.sim.inventory.add(item, n, { force: true });
    this.S.goods[item] = have - n;
    if (!this.S.goods[item]) delete this.S.goods[item];
    this.sim.bus.emit('stall:changed');
    return { ok: true, n };
  }

  setMarkup(m) {
    if (!STALL.markups.includes(m)) return false;
    this.S.markup = m;
    this.sim.bus.emit('stall:changed');
    return true;
  }

  /** What the shops ask for it (or its usual price, if nobody sells it). */
  reference(item) {
    const E = this.sim.economy;
    const sellers = E.sellersOf(item).filter((id) => (E.stock(id, item) || 0) > 0);
    if (!sellers.length) return ITEMS[item]?.basePrice || 1;
    return sellers.reduce((s, id) => s + E.unitPrice(id, item), 0) / sellers.length;
  }

  price(item) {
    return Math.max(1, Math.round(this.reference(item) * this.S.markup));
  }

  /** How many a passing crowd would buy in an hour at this price (before the hour's luck). */
  demand(item) {
    const pop = this.sim.state.npcs.filter((n) => n.age >= 14).length;
    const appeal = Math.max(0.08, 2.1 - this.S.markup * 1.15); // 0.8 → 1.18, 1 → 0.95, 1.2 → 0.72, 1.5 → 0.38
    const rain = ['rain', 'storm'].includes(this.sim.state.weather?.type) ? STALL.rain : 1;
    const food = FOOD.includes(item) || ITEMS[item]?.food ? STALL.foodBoost : 1;
    return STALL.perHour * (pop / STALL.popRef) * appeal * rain * food;
  }

  onHour(h) {
    const S = this.S;
    if (S.day !== this.sim.time.day) return;
    if (h >= STALL.open && h < STALL.close) this.sellHour(h);
    if (h === STALL.close) this.close();
  }

  sellHour(h) {
    const sim = this.sim;
    const S = this.S;
    const seed = sim.state.seed;
    const buyers = sim.state.npcs.filter((n) => n.age >= 14 && !n.away && !n.leaving);
    if (!buyers.length) return;
    for (const item of Object.keys(S.goods).sort()) {
      const d = this.demand(item);
      const units = Math.floor(d + hashStr(`stall:${sim.time.day}:${h}:${item}`, seed));
      for (let k = 0; k < units && (S.goods[item] || 0) > 0; k++) {
        const price = this.price(item);
        // A passer-by who can afford it.
        const start = Math.floor(hashStr(`stallbuyer:${sim.time.day}:${h}:${item}:${k}`, seed) * buyers.length);
        let npc = null;
        for (let i = 0; i < buyers.length && !npc; i++) {
          const b = buyers[(start + i) % buyers.length];
          if (b.money >= price + 5) npc = b;
        }
        if (!npc) break;
        npc.money -= price;
        if (ITEMS[item]?.food) npc.pantry = (npc.pantry || 0) + 1;
        sim.state.player.money += price;
        sim.state.stats.moneyEarned = (sim.state.stats.moneyEarned || 0) + price;
        S.goods[item]--;
        if (!S.goods[item]) delete S.goods[item];
        S.earned += price;
        S.total = (S.total || 0) + price;
        const last = S.sold[S.sold.length - 1];
        if (last && last.item === item && last.hour === h) {
          last.qty++;
          last.money += price;
        } else S.sold.push({ item, qty: 1, money: price, hour: h, npc: npc.id });
      }
    }
    if (S.sold.length > 40) S.sold.splice(0, S.sold.length - 40);
    sim.bus.emit('stall:changed');
    sim.bus.emit('player:changed');
  }

  /** Closing time: what's left comes home with you. */
  close() {
    const S = this.S;
    for (const item of Object.keys(S.goods)) this.take(item);
    this.sim.toast('toast.stall_closed', { money: S.earned }, S.earned > 0 ? 'good' : 'info');
    this.sim.progression.addSkillXp('trading', Math.min(20, Math.round(S.earned / 5)));
    this.sim.bus.emit('stall:changed');
  }

  /** For "what pays best": a day at the stall with what you're carrying. */
  estimate() {
    const items = [...new Set(this.sim.inventory.slots.filter(Boolean).map((s) => s.id))].filter((id) => this.sellable(id));
    if (!items.length && !Object.keys(this.S.goods).length) return null;
    const h = this.sim.time.hour;
    const hours = Math.max(1, STALL.close - Math.max(h, STALL.open));
    let pay = -((this.rentedToday() ? 0 : STALL.rent));
    for (const item of items) pay += Math.min(this.sim.inventory.count(item), this.demand(item) * hours) * this.price(item);
    for (const [item, q] of Object.entries(this.S.goods)) pay += Math.min(q, this.demand(item) * hours) * this.price(item);
    const chk = this.rentedToday() ? { ok: this.isOpen() || h < STALL.open } : this.canOpen();
    return { pay: Math.max(0, Math.round(pay)), hours, ok: chk.ok, reason: chk.reason };
  }
}
