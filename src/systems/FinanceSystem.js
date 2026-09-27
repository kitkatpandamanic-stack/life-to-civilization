/**
 * FinanceSystem — the village's taxes, and borrowing from the village fund.
 *
 * Taxes: each week businesses pay a share of their profit, and property owners
 * a small levy on what their buildings are worth. You pay too, on what you
 * own. It all goes into the village fund — which pays pensions, poor relief,
 * the teacher, and saves up for wells, schools, libraries and mills. So a
 * busy, prosperous village builds more for itself.
 *
 * Loans: you can borrow from the village fund (if it has the money) and pay it
 * back weekly with interest. Miss payments and your standing suffers.
 *
 * Big loans: for bigger projects, the bank lends (once the village has one — CivicSystem; before that, the
 * moneylender in town, dearer). The rate follows your credit record: paying on time raises it, missing a
 * payment lowers it. Miss three payments and the lender takes what's owed — your bank savings first, then
 * your buildings (never the home you live in, nor where your own business runs), sold to the village. If
 * that still doesn't cover it, you're bankrupt: the rest is written off, and your name suffers for it.
 *
 *   state.village.taxLog = [{ day, business, property, player }]
 *   player.loan = { amount, left, weekly, missed }
 *   player.bankLoan = { lender, amount, left, weekly, weeks, missed, day }
 *   player.credit = 0…100 (50 to start) · player.bankrupt = day (the last time)
 */
export const FINANCE = {
  profitTax: 0.08, // of a business's weekly profit
  propertyTax: 0.004, // of a building's value, weekly
  exemptHomeValue: 260, // modest homes pay nothing
  loanRate: 0.15, // total interest
  loanWeeks: 8,
  loanSizes: [150, 400],
  loanNeedsReputation: 5,
};
/** Big loans: from the bank, or before there is one, the moneylender in town. */
export const BANK_LOANS = {
  sizes: [500, 1200, 3000],
  weeks: { 500: 12, 1200: 16, 3000: 24 },
  rate: { bank: 0.12, moneylender: 0.22 }, // total interest at a middling credit record…
  creditSwing: 0.1, // …up to this much less (the best record) or more (the worst)
  startCredit: 50,
  onTime: 2,
  missed: -8,
  cleared: 5,
  defaultAfter: 3, // missed payments
  seizeShare: 0.7, // a building taken for debt fetches this much of its worth
  bankruptCredit: 0,
  bankruptRep: -15,
  refuseAfterBankruptDays: 56, // no one lends to you for a year after
  baseLimit: 400, // what anyone may borrow…
  creditLimit: 25, // …plus this per point of credit…
  propertyShare: 0.5, // …plus this share of what your buildings are worth
};
const F = FINANCE;
const BL = BANK_LOANS;

export class FinanceSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.village.taxLog ??= [];
    sim.bus.on('time:day', () => sim.time.weekday === 2 && this.weekly());
  }

  get V() {
    return this.sim.state.village;
  }
  get p() {
    return this.sim.state.player;
  }

  /** What a property owner pays for a building this week. */
  propertyTax(id) {
    const P = this.sim.property;
    const r = P.rec(id);
    if (!r || r.ruined || r.owner === 'village') return 0;
    const value = P.value(id);
    if (P.isHome(id) && value <= F.exemptHomeValue) return 0;
    return Math.round(value * F.propertyTax * (this.sim.civic?.mult('tax') ?? 1));
  }

  weekly() {
    const sim = this.sim;
    const E = sim.economy;
    let business = 0;
    let property = 0;
    let player = 0;
    // Businesses: a share of the week's profit, from the till.
    for (const id of E.active()) {
      const b = E.biz(id);
      const profit = sim.enterprise.books(id, 7).profit;
      // The headman's tax policy (CivicSystem) raises or lowers every rate.
      const tax = Math.min(Math.max(0, Math.floor(b.money)), Math.round(Math.max(0, profit) * F.profitTax * (sim.civic?.mult('tax') ?? 1)));
      if (tax <= 0) continue;
      b.money -= tax;
      E.ledger(id, 'exp', tax);
      business += tax;
      if (b.owner === 'player') player += tax;
    }
    // Property: the owners pay (villagers from their savings, you from your purse).
    for (const id of Object.keys(sim.property.all)) {
      const r = sim.property.rec(id);
      const tax = this.propertyTax(id);
      if (!tax) continue;
      if (r.owner === 'player') {
        const paid = Math.min(tax, Math.max(0, Math.floor(this.p.money)));
        this.p.money -= paid;
        player += paid;
        property += paid;
      } else {
        const n = sim.npcs.byId(r.owner);
        if (!n) continue;
        const paid = Math.min(tax, Math.max(0, Math.floor(n.money)));
        n.money -= paid;
        property += paid;
      }
    }
    // Part of it is set aside for the next institution (the civic fund); the rest runs the village.
    const fund = sim.civic?.divert(business + property) || 0;
    this.V.treasury += business + property - fund;
    sim.schools?.reserve(); // the teachers' (and doctor's…) pay is set aside first
    sim.growth?.putAside(business + property - fund); // …and some saved for the school (or library, mill) the village wants
    sim.infra?.levy(business + property - fund); // …and a little for roads, lamps and the like (public works)
    this.V.taxLog.push({ day: sim.time.day, business, property, player });
    if (this.V.taxLog.length > 12) this.V.taxLog.shift();
    if (player > 0) sim.toast('toast.taxes_paid', { money: player }, 'info');
    this.repayLoan();
    this.repayBankLoan();
  }

  // ------------------------------------------------------------------ your loan

  canBorrow(amount) {
    if (this.p.loan) return { ok: false, reason: 'loan_outstanding' };
    if (this.p.reputation < F.loanNeedsReputation) return { ok: false, reason: 'need_reputation', params: { value: F.loanNeedsReputation } };
    if (this.V.treasury < amount + 50) return { ok: false, reason: 'fund_too_small' };
    return { ok: true };
  }

  borrow(amount) {
    const chk = this.canBorrow(amount);
    if (!chk.ok) return chk;
    const total = Math.round(amount * (1 + F.loanRate));
    this.V.treasury -= amount;
    this.p.money += amount;
    this.p.loan = { amount, left: total, weekly: Math.ceil(total / F.loanWeeks), missed: 0, day: this.sim.time.day };
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** Pay off early (or a chunk of it). */
  repay(amount) {
    const L = this.p.loan;
    if (!L) return 0;
    const pay = Math.min(L.left, amount, Math.max(0, Math.floor(this.p.money)));
    this.p.money -= pay;
    L.left -= pay;
    this.V.treasury += pay;
    if (L.left <= 0) {
      delete this.p.loan;
      this.sim.toast('toast.loan_cleared', {}, 'good');
    }
    this.sim.bus.emit('player:changed');
    return pay;
  }

  // ------------------------------------------------------------------ big loans

  /** Who'd lend you a big sum: the bank if the village has one, else the moneylender in town. */
  lender() {
    return this.sim.civic?.has('bank') ? 'bank' : 'moneylender';
  }

  credit() {
    return this.p.credit ?? BL.startCredit;
  }

  addCredit(n) {
    this.p.credit = Math.max(0, Math.min(100, this.credit() + n));
  }

  /** What your buildings are worth (not counting the home you live in) — what a lender would look at. */
  collateral() {
    const P = this.sim.property;
    let v = 0;
    for (const id of Object.keys(P.all)) {
      const r = P.rec(id);
      if (r?.owner === 'player' && !r.ruined && id !== this.p.homeId) v += P.value(id);
    }
    return v;
  }

  /** The most you could borrow now. */
  bankLimit() {
    return Math.round(BL.baseLimit + this.credit() * BL.creditLimit + this.collateral() * BL.propertyShare);
  }

  /** The terms for a sum: interest (by your credit record), weeks, the weekly payment. */
  bankTerms(amount, lender = this.lender()) {
    const rate = Math.max(0.03, BL.rate[lender] + ((50 - this.credit()) / 50) * BL.creditSwing);
    const weeks = BL.weeks[amount] || 16;
    const total = Math.round(amount * (1 + rate));
    return { lender, rate, weeks, total, weekly: Math.ceil(total / weeks) };
  }

  canBankBorrow(amount) {
    const p = this.p;
    if (p.bankLoan) return { ok: false, reason: 'loan_outstanding' };
    if (p.bankrupt !== undefined && this.sim.time.day - p.bankrupt < BL.refuseAfterBankruptDays) return { ok: false, reason: 'recently_bankrupt' };
    if (amount > this.bankLimit()) return { ok: false, reason: 'over_limit', params: { money: this.bankLimit() } };
    if (this.lender() === 'bank' && (this.sim.civic.V.vault || 0) - p.bank * 0.5 < amount) return { ok: false, reason: 'bank_short' };
    return { ok: true };
  }

  bankBorrow(amount) {
    const chk = this.canBankBorrow(amount);
    if (!chk.ok) return chk;
    const T = this.bankTerms(amount);
    if (T.lender === 'bank') this.sim.civic.V.vault -= amount; // (the moneylender's money comes from outside the valley)
    this.p.money += amount;
    this.p.bankLoan = { lender: T.lender, amount, left: T.total, weekly: T.weekly, weeks: T.weeks, missed: 0, day: this.sim.time.day };
    this.sim.bus.emit('player:changed');
    return { ok: true, terms: T };
  }

  /** Pay some (or all) of a big loan back. */
  bankRepay(amount) {
    const L = this.p.bankLoan;
    if (!L) return 0;
    const pay = Math.min(L.left, amount, Math.max(0, Math.floor(this.p.money)));
    if (pay <= 0) return 0;
    this.p.money -= pay;
    L.left -= pay;
    if (L.lender === 'bank' && this.sim.civic) this.sim.civic.V.vault = (this.sim.civic.V.vault || 0) + pay;
    if (L.left <= 0) {
      delete this.p.bankLoan;
      this.addCredit(BL.cleared);
      this.sim.toast('toast.bank_loan_cleared', {}, 'good');
    }
    this.sim.bus.emit('player:changed');
    return pay;
  }

  /** The week's payment on a big loan — or a missed one, and after three, the lender takes what's owed. */
  repayBankLoan() {
    const L = this.p.bankLoan;
    if (!L) return;
    const due = Math.min(L.weekly, L.left);
    if (this.p.money >= due) {
      this.bankRepay(due);
      this.addCredit(BL.onTime);
      L.missed = 0;
      if (this.p.bankLoan) this.sim.toast('toast.bank_loan_payment', { money: due, left: this.p.bankLoan.left }, 'info');
      return;
    }
    L.missed++;
    this.addCredit(BL.missed);
    this.sim.progression.addReputation(-2);
    if (L.missed >= BL.defaultAfter) return this.seize();
    this.sim.toast('toast.bank_loan_missed', { money: due, n: BL.defaultAfter - L.missed }, 'danger');
  }

  /**
   * Three payments missed: the lender takes what's owed. Your bank savings, then your buildings (the cheapest
   * first; never the home you live in, nor where your own business runs) — sold to the village for part of
   * their worth. Whatever's still owed after that is written off: you're bankrupt.
   */
  seize() {
    const sim = this.sim;
    const p = this.p;
    const L = p.bankLoan;
    if (!L) return null;
    const taken = [];
    let fromSavings = 0;
    if (p.bank > 0 && sim.civic) {
      fromSavings = Math.min(p.bank, L.left);
      p.bank -= fromSavings;
      sim.civic.V.vault = Math.max(0, (sim.civic.V.vault || 0) - fromSavings);
      if (L.lender === 'bank') sim.civic.V.vault += fromSavings;
      L.left -= fromSavings;
    }
    const P = sim.property;
    const yours = Object.keys(P.all)
      .filter((id) => {
        const r = P.rec(id);
        return r?.owner === 'player' && !r.ruined && id !== p.homeId && !sim.businesses?.atBuilding(id);
      })
      .sort((a, b) => P.value(a) - P.value(b));
    for (const id of yours) {
      if (L.left <= 0) break;
      const worth = Math.round(P.value(id) * BL.seizeShare);
      P.transfer(id, 'village', 'seized', worth);
      L.left -= worth;
      taken.push(id);
    }
    const bankrupt = L.left > 0;
    delete p.bankLoan;
    if (bankrupt) {
      p.bankrupt = sim.time.day;
      p.credit = BL.bankruptCredit;
      sim.progression.addReputation(BL.bankruptRep);
      sim.chronicle('chronicle.player_bankrupt', {});
      sim.toast('toast.bankrupt', {}, 'danger');
    } else {
      p.credit = Math.max(0, this.credit() - 15);
      sim.chronicle('chronicle.player_seized', { n: taken.length });
      sim.toast('toast.loan_seized', { n: taken.length, money: fromSavings }, 'danger');
    }
    sim.bus.emit('player:changed');
    return { taken, fromSavings, bankrupt };
  }

  repayLoan() {
    const L = this.p.loan;
    if (!L) return;
    const due = Math.min(L.weekly, L.left);
    if (this.p.money >= due) {
      this.repay(due);
      if (this.p.loan) this.sim.toast('toast.loan_payment', { money: due, left: this.p.loan.left }, 'info');
    } else {
      L.missed++;
      this.sim.progression.addReputation(-3);
      this.sim.toast('toast.loan_missed', { money: due }, 'danger');
    }
  }
}
