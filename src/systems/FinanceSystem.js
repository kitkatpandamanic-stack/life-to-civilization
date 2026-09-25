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
 *   state.village.taxLog = [{ day, business, property, player }]
 *   player.loan = { amount, left, weekly, missed }
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
const F = FINANCE;

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
    this.V.taxLog.push({ day: sim.time.day, business, property, player });
    if (this.V.taxLog.length > 12) this.V.taxLog.shift();
    if (player > 0) sim.toast('toast.taxes_paid', { money: player }, 'info');
    this.repayLoan();
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
