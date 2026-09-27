/**
 * TradesSystem — the trades a growing town needs, and the everyday wants that keep them busy:
 *
 *   Clothes and shoes  every grown-up wears out their clothes (about a year) and their boots (a year and a
 *                      half). With money to spare they buy new at a tailor's or a cobbler's — a little
 *                      happier for it. No tailor in the valley? They make do (and someone may open one:
 *                      EnterpriseSystem scores the trade by the town's size and by who's gone without).
 *   Bigger businesses  in a large village and a town the busiest shops take on another hand (more work).
 *
 * No dice: when someone goes shopping follows the week and who they are (hashStr).
 *
 *   npc.clothesDay / npc.shoesDay — when they last bought; state.trades = { wanting: { clothes, shoes }, sold: {…} }
 */
import { hashStr } from '../core/rng.js';

export const TRADES = {
  wear: { clothes: 56, shoes: 84 }, // days
  keepBack: 20, // money they keep for food
  mood: 3,
  // Bigger premises for a bigger town: extra hands for businesses doing well (by the village's standing).
  extraHands: { village: 0, large_village: 1, town: 2, city: 3 },
  busyAbove: 400, // money in the till that counts as doing well
};

export class TradesSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.trades ??= { wanting: { clothes: 0, shoes: 0 }, sold: { clothes: 0, shoes: 0 } };
    sim.bus.on('time:day', () => this.onDay());
  }

  get S() {
    return this.sim.state.trades;
  }

  /** Wanting new clothes (or shoes)? Worn out, with money to spare. */
  wants(n, item) {
    const day = this.sim.time.day;
    const last = n[`${item}Day`] ?? -Math.floor(hashStr(`${item}:${n.id}`, this.sim.state.seed) * TRADES.wear[item]);
    return day - last >= TRADES.wear[item];
  }

  /** Each day a seventh of the grown-ups look to their wardrobe. */
  shop() {
    const sim = this.sim;
    const E = sim.economy;
    const day = sim.time.day;
    const wanting = { clothes: 0, shoes: 0 };
    for (const n of sim.state.npcs) {
      if (n.age < 16 || n.leaving || n.away) continue;
      if (Math.floor(hashStr(`wardrobe:${n.id}`, sim.state.seed) * 7) !== day % 7) continue;
      for (const item of ['clothes', 'shoes']) {
        if (!this.wants(n, item)) continue;
        const shop = E.chooseShop(n, [item], { openNow: false });
        if (!shop || n.money < Math.round(E.unitPrice(shop, item)) + TRADES.keepBack) {
          wanting[item]++;
          continue;
        }
        if (E.npcBuy(n, shop, [item], 1)) {
          n[`${item}Day`] = day;
          n.mood = Math.min(100, (n.mood ?? 60) + TRADES.mood);
          this.S.sold[item]++;
        } else wanting[item]++;
      }
    }
    // (A running count of who went without, for EnterpriseSystem: a trade the town is missing.)
    for (const k of ['clothes', 'shoes']) this.S.wanting[k] = Math.round(this.S.wanting[k] * 0.9 + wanting[k]);
  }

  /** A town's busy shops take on more hands (EnterpriseSystem hires them). */
  growBusinesses() {
    const sim = this.sim;
    const E = sim.economy;
    const extra = TRADES.extraHands[sim.state.civic?.status || 'village'] || 0;
    if (!extra) return;
    for (const id of E.active()) {
      const b = E.biz(id);
      const def = E.def(id);
      if (!def.workerOccupation || b.owner === 'player' || b.money < TRADES.busyAbove) continue;
      const base = def.maxWorkers || 0;
      if ((b.maxWorkers ?? base) < base + extra) b.maxWorkers = (b.maxWorkers ?? base) + 1;
    }
  }

  onDay() {
    this.shop();
    if (this.sim.time.weekday === 3) this.growBusinesses();
  }
}
