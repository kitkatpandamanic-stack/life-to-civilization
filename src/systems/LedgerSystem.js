/**
 * LedgerSystem — where your money comes from and where it goes.
 *
 *   state.ledger = { days: [{ day, in: { category: amount }, out: { category: amount } }], total: { in, out } }
 *
 * Your money changes in dozens of places (a job paid, bread bought, rent due,
 * taxes, a caravan's profit…). Rather than touching each one, the ledger
 * watches the purse itself: player.money becomes an accessor, and every change
 * to it is recorded under the category of whatever was happening at the time.
 * The category comes from the system method doing it (jobs.complete → 'jobs',
 * finance.weekly → 'taxes', economy.buy → 'shopping'…), set by wrapping those
 * methods when the game starts. Anything else is 'other'.
 *
 * Some movements aren't really income or spending — money put in the bank,
 * taken out of your business's till, borrowed or repaid, or passed down the
 * family. Those are TRANSFERS and are shown apart.
 */
import { ITEMS } from '../data/items.js';

const KEEP_DAYS = 60;

/** Money moved rather than earned or spent. */
export const TRANSFERS = ['bank', 'business_till', 'loans', 'family'];

/** [system, method, category] — what each piece of the game is doing with your money. */
const SOURCES = [
  ['jobs', 'complete', 'jobs'],
  ['jobs', 'fulfill', 'favours'],
  ['contracts', 'complete', 'contracts'],
  ['contracts', 'fail', 'contracts'],
  ['economy', 'buy', 'shopping'],
  ['economy', 'sell', 'sales'],
  ['economy', 'repair', 'repairs'],
  ['economy', 'depotBuy', 'business'],
  ['businesses', 'sellToNpc', 'sales'],
  ['businesses', 'onDay', 'business'],
  ['workers', 'onDay', 'staff'],
  ['finance', 'weekly', 'taxes'],
  ['finance', 'borrow', 'loans'],
  ['finance', 'repay', 'loans'],
  ['property', 'collectRent', 'rent_income'],
  ['property', 'onDay', 'upkeep'],
  ['letting', 'onDay', 'management'],
  ['property', 'market', 'property'],
  ['property', 'playerBuy', 'property'],
  ['property', 'restore', 'property'],
  ['land', 'buy', 'property'],
  ['construction', 'place', 'building'],
  ['construction', 'startHomeUpgrade', 'building'],
  ['construction', 'hire', 'building'],
  ['structures', 'start', 'building'],
  ['crafting', 'rentForge', 'crafting'],
  ['actions', 'eatAtTavern', 'food'],
  ['actions', 'payTavernBed', 'lodging'],
  ['settlements', 'sell', 'trade'],
  ['settlements', 'buy', 'trade'],
  ['settlements', 'arrive', 'losses'],
  ['settlements', 'buyTransport', 'transport'],
  ['equipment', 'buy', 'transport'],
  ['freight', 'delivered', 'freight'],
  ['livestock', 'buy', 'livestock'],
  ['trains', 'takings', 'trade'],
  ['rival', 'warSpend', 'business'],
  ['stories', 'storyMoney', 'stories'],
  ['rival', 'buyOutPaid', 'business'],
  ['rival', 'partnerShare', 'dividends'],
  ['trains', 'purchase', 'trade'],
  ['trains', 'carriage', 'transport'],
  ['livestock', 'sell', 'livestock'],
  ['freight', 'found', 'business'],
  ['freight', 'caravanPaid', 'trade'],
  ['freight', 'driverPaid', 'staff'],
  ['guide', 'complete', 'rewards'],
  ['inventions', 'royaltiesIn', 'royalties'],
  ['colony', 'donated', 'colony'],
  ['inventions', 'licenceSold', 'royalties'],
  ['festivals', 'donate', 'donations'],
  ['guide', 'reachMilestone', 'rewards'],
  ['equipment', 'repair', 'repairs'],
  ['equipment', 'upgrade', 'transport'],
  ['settlements', 'upkeep', 'transport'],
  ['settlements', 'fundRoad', 'donations'],
  ['exploration', 'setOut', 'travel'],
  ['exploration', 'applyFind', 'finds'],
  ['exploration', 'exploreSite', 'finds'],
  ['exploration', 'misfortune', 'losses'],
  ['holdings', 'buy', 'businesses'],
  ['holdings', 'open', 'businesses'],
  ['holdings', 'withdraw', 'business_till'],
  ['holdings', 'deposit', 'business_till'],
  ['holdings', 'invest', 'investments'],
  ['holdings', 'lend', 'investments'],
  ['holdings', 'payStakes', 'dividends'],
  ['enterprise', 'repayLoans', 'investments'],
  ['enterprise', 'close', 'business_till'],
  ['goals', 'back', 'investments'],
  ['goals', 'returnBacking', 'investments'],
  ['civic', 'onDay', 'headman'],
  ['letting', 'advertise', 'advertising'],
  ['letting', 'advertiseAway', 'advertising'],
  ['civic', 'deposit', 'bank'],
  ['civic', 'withdraw', 'bank'],
  ['lineage', 'succeed', 'family'],
  ['lineage', 'newcomer', 'family'],
  // Your education, and what you give to other people's (StudySystem).
  ['study', 'signUp', 'education'],
  ['study', 'finishTutoring', 'education'],
  ['study', 'finishStudyWeek', 'education'],
  ['study', 'finishWorkBeside', 'wages_apprentice'],
  ['study', 'sponsor', 'scholarships'],
  ['study', 'giveBooks', 'donations'],
  ['study', 'endowTeachers', 'donations'],
  ['study', 'fundResearch', 'donations'],
  ['study', 'found', 'donations'],
];

export class LedgerSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.ledger ??= { days: [], total: { in: {}, out: {} } };
    this.category = null;
    for (const [sys, method, cat] of SOURCES) this.wrap(sim[sys], method, cat);
    // Rent for the shack is collected by the Simulation itself.
    this.wrap(sim, 'onNewDay', 'rent');
    this.watch();
    // A new generation: the purse to watch is the heir's.
    sim.bus.on('player:succeeded', () => this.watch());
    sim.bus.on('time:day', () => this.watch());
  }

  get L() {
    return this.sim.state.ledger;
  }

  /** Run fn with money changes filed under `cat` (for the few changes made outside the systems). */
  as(cat, fn) {
    const prev = this.category;
    this.category = cat;
    try {
      return fn();
    } finally {
      this.category = prev;
    }
  }

  /** Run a system method with its category set (nested calls take the innermost category). */
  wrap(obj, method, cat) {
    if (!obj || typeof obj[method] !== 'function') return;
    const orig = obj[method].bind(obj);
    obj[method] = (...args) => {
      const prev = this.category;
      this.category = cat;
      try {
        return orig(...args);
      } finally {
        this.category = prev;
      }
    };
  }

  /** Make player.money an accessor that reports every change (saved as a plain number). */
  watch() {
    const p = this.sim.state.player;
    const d = Object.getOwnPropertyDescriptor(p, 'money');
    if (d?.get) return;
    let value = p.money || 0;
    Object.defineProperty(p, 'money', {
      enumerable: true,
      configurable: true,
      get: () => value,
      set: (v) => {
        const delta = v - value;
        value = v;
        if (delta) this.record(delta, this.category || 'other');
      },
    });
  }

  today() {
    const day = this.sim.time.day;
    let t = this.L.days[this.L.days.length - 1];
    if (!t || t.day !== day) {
      t = { day, in: {}, out: {} };
      this.L.days.push(t);
      if (this.L.days.length > KEEP_DAYS) this.L.days.shift();
    }
    return t;
  }

  record(delta, cat) {
    const t = this.today();
    const side = delta > 0 ? 'in' : 'out';
    const n = Math.abs(delta);
    t[side][cat] = Math.round(((t[side][cat] || 0) + n) * 100) / 100;
    this.L.total[side][cat] = Math.round(((this.L.total[side][cat] || 0) + n) * 100) / 100;
  }

  // ------------------------------------------------------------------ reading

  /** Income and spending by category over the last `days` days (or ever). Transfers apart. */
  summary(days = 7, offset = 0) {
    let source;
    if (days === Infinity) source = [this.L.total];
    else {
      const until = this.sim.time.day - offset;
      source = this.L.days.filter((d) => d.day > until - days && d.day <= until);
    }
    const inc = {};
    const out = {};
    for (const d of source) {
      for (const [k, v] of Object.entries(d.in)) inc[k] = (inc[k] || 0) + v;
      for (const [k, v] of Object.entries(d.out)) out[k] = (out[k] || 0) + v;
    }
    const sum = (o, transfers) => Object.entries(o).filter(([k]) => TRANSFERS.includes(k) === transfers).reduce((s, [, v]) => s + v, 0);
    return { in: inc, out, income: sum(inc, false), spending: sum(out, false), transfersIn: sum(inc, true), transfersOut: sum(out, true) };
  }

  /** Net change of your purse per day, for the last `n` days (oldest first). */
  daily(n = 14) {
    const out = [];
    const today = this.sim.time.day;
    for (let day = today - n + 1; day <= today; day++) {
      const d = this.L.days.find((x) => x.day === day);
      const inc = d ? Object.entries(d.in).filter(([k]) => !TRANSFERS.includes(k)).reduce((s, [, v]) => s + v, 0) : 0;
      const spent = d ? Object.entries(d.out).filter(([k]) => !TRANSFERS.includes(k)).reduce((s, [, v]) => s + v, 0) : 0;
      out.push({ day, in: inc, out: spent });
    }
    return out;
  }

  /** Everything you own, less what you owe: { total, parts: [{ k, v }] }. */
  netWorth() {
    const sim = this.sim;
    const p = sim.state.player;
    const parts = [];
    const add = (k, v) => v && parts.push({ k, v: Math.round(v) });
    add('cash', p.money);
    add('bank', p.bank || 0);
    const goods = [...(p.inventory || []), ...(p.storage || [])].reduce((s, x) => s + (ITEMS[x.id]?.basePrice || 0) * x.qty, 0);
    add('goods', goods);
    let buildings = 0;
    for (const [id, r] of Object.entries(sim.property.all)) if (r.owner === 'player' && !r.ruined) buildings += sim.property.value(id);
    add('buildings', buildings);
    add('land', sim.land.holdings().reduce((s, id) => s + (sim.land.price(id) || 0), 0));
    // A business's worth (its premises are already counted with your buildings).
    add('businesses', sim.holdings.mine().reduce((s, id) => {
      const b = sim.economy.biz(id);
      const premises = sim.property.rec(b.building)?.owner === 'player' ? sim.property.value(b.building) : 0;
      return s + Math.max(0, sim.holdings.valuation(id) - premises);
    }, 0));
    add('investments', sim.holdings.portfolio().filter((x) => !x.closed).reduce((s, x) => s + (x.kind === 'loan' ? x.left : x.amount || 0), 0));
    add('debts', -((p.loan?.left || 0) + (p.rent?.debt || 0)));
    return { total: parts.reduce((s, x) => s + x.v, 0), parts };
  }
}
