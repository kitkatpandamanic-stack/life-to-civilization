/**
 * GranarySystem — the village grain store, so a bad year doesn't mean dear bread.
 *
 *   Filling   at the harvest the farms give a share of their wheat (a tithe), and in weeks of plenty the
 *             village buys up the farms' surplus cheaply (if the treasury has the money).
 *   Releasing when bread gets dear, the grain store sells wheat to the bakers and the store at its usual
 *             price — the money goes back to the treasury (so it pays for itself).
 *   Bigger    a town meeting can vote to build it bigger (TownSystem 'granary').
 *
 * No dice. Weekly (and at the harvest).
 *
 *   state.granary = { wheat, cap, tithed, bought, sold, released, lastNews }
 */
import { ITEMS } from '../data/items.js';

export const GRANARY = {
  cap: 120, // to start (the hall's loft)
  bigCap: 400, // built bigger (a town meeting)
  tithe: 0.15, // of the farms' wheat at the harvest
  titheDay: 10, // of autumn
  cheapBelow: 1.0, // bread this cheap (price factor): buy up the farms' surplus
  buyPrice: 0.6, // …at this share of the usual price
  dearAbove: 1.3, // bread this dear: release wheat
  sellPrice: 1.0,
  releaseMax: 40, // a week
  reserve: 60, // the treasury keeps this back when buying
  newsDays: 56,
};

export class GranarySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.granary ??= { wheat: 0, cap: GRANARY.cap, tithed: 0, bought: 0, sold: 0, released: 0, lastNews: -999 };
    sim.bus.on('time:day', () => this.onDay());
  }

  get S() {
    return this.sim.state.granary;
  }

  room() {
    return Math.max(0, this.S.cap - this.S.wheat);
  }

  /** How dear bread is (the average price factor where it's sold). */
  breadFactor() {
    const E = this.sim.economy;
    const sellers = E.sellersOf('bread').filter((id) => !E.biz(id)?.closed);
    if (!sellers.length) return 1;
    return sellers.reduce((s, id) => s + E.priceFactor(id, 'bread'), 0) / sellers.length;
  }

  farms() {
    const E = this.sim.economy;
    return E.ofType('farm').filter((id) => !E.biz(id)?.closed);
  }

  /** The harvest tithe: a share of every farm's wheat into the grain store. */
  tithe() {
    const E = this.sim.economy;
    let got = 0;
    for (const id of this.farms()) {
      const b = E.biz(id);
      const n = Math.min(this.room(), Math.floor((b.stock.wheat || 0) * GRANARY.tithe));
      if (n <= 0) continue;
      b.stock.wheat -= n;
      this.S.wheat += n;
      got += n;
    }
    this.S.tithed += got;
    if (got) this.sim.chronicle('chronicle.granary_filled', { n: got });
    return got;
  }

  /** A week of plenty: buy up the farms' surplus, cheaply. */
  buySurplus() {
    const sim = this.sim;
    const E = sim.economy;
    const V = sim.state.village;
    const price = Math.max(1, Math.round((ITEMS.wheat.basePrice || 3) * GRANARY.buyPrice));
    let got = 0;
    for (const id of this.farms()) {
      const b = E.biz(id);
      const surplus = Math.floor((b.stock.wheat || 0) - E.target(id, 'wheat'));
      const afford = Math.floor(Math.max(0, V.treasury - GRANARY.reserve) / price);
      const n = Math.min(surplus, this.room(), afford);
      if (n <= 0) continue;
      b.stock.wheat -= n;
      b.money += n * price;
      E.ledger(id, 'rev', n * price);
      V.treasury -= n * price;
      this.S.wheat += n;
      got += n;
    }
    this.S.bought += got;
    return got;
  }

  /** Bread's dear: sell wheat to the bakers and the store (at its usual price; the money to the treasury). */
  release() {
    const sim = this.sim;
    const E = sim.economy;
    const price = Math.max(1, Math.round((ITEMS.wheat.basePrice || 3) * GRANARY.sellPrice));
    let left = Math.min(GRANARY.releaseMax, this.S.wheat);
    let sold = 0;
    const buyers = E.active().filter((id) => (E.def(id).buys || []).includes('wheat') && E.def(id).kind === 'shop');
    for (const id of buyers) {
      if (left <= 0) break;
      const b = E.biz(id);
      const want = Math.max(0, Math.round(E.target(id, 'wheat') * 1.2) - (b.stock.wheat || 0));
      const n = Math.min(want, left, Math.floor(b.money / price));
      if (n <= 0) continue;
      b.stock.wheat = (b.stock.wheat || 0) + n;
      b.money -= n * price;
      E.ledger(id, 'exp', n * price);
      sim.state.village.treasury += n * price;
      left -= n;
      sold += n;
    }
    this.S.wheat -= sold;
    this.S.sold += sold;
    if (sold) {
      this.S.released++;
      if (sim.time.day - this.S.lastNews >= GRANARY.newsDays) {
        this.S.lastNews = sim.time.day;
        sim.chronicle('chronicle.granary_released', { n: sold });
      }
    }
    return sold;
  }

  /** A town meeting voted to build it bigger. */
  enlarge() {
    this.S.cap = Math.max(this.S.cap, GRANARY.bigCap);
    this.sim.chronicle('chronicle.granary_built', { n: this.S.cap });
  }

  onDay() {
    const T = this.sim.time;
    if (T.season === 'autumn' && T.dayOfSeason === GRANARY.titheDay) this.tithe();
    if (T.weekday !== 2) return;
    const f = this.breadFactor();
    if (f > GRANARY.dearAbove) this.release();
    else if (f < GRANARY.cheapBelow) this.buySurplus();
  }
}
