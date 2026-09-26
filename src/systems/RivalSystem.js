/**
 * RivalSystem — a business rival: a villager who sets up a company to compete with yours.
 *
 *   state.rival = { npc, since, money, crew, stage: 'rival' | 'partner' | 'bought' | 'bust',
 *                   warUntil, took, plots: [ids], lastPlotDay, lastPoachDay, share, log: [...] }
 *
 * Once you're established (a few workers, a few contracts behind you), the most ambitious villager with
 * money of their own sets up in business against you. From then on:
 *   • jobs on the notice board you leave for a day or more, they may take (their crew does them);
 *   • with a carting business of their own, fewer of the valley's loads come your way (FreightSystem);
 *   • they buy up signposted plots when they can afford them;
 *   • a worker of yours who's unhappy with you may go over to them.
 * What you can do (RivalPanel, or talk to them):
 *   • a price war — a week of cutting your prices (it costs you): they take few jobs and lose money;
 *     if their money runs out they go bust and sell up;
 *   • a partnership (once you're on good terms): they stop competing and pay you a share each week;
 *   • buy them out: their land and their business become yours.
 * Which jobs they take is decided by a hash (no dice).
 */
import { hashStr } from '../core/rng.js';

export const RIVAL = {
  appearLevel: 5, // you: at least this level…
  appearWorkers: 2, // …and this many workers, or this many contracts done
  appearContracts: 2,
  startMoney: 400,
  weeklyIncome: 30, // their company's own trade, a week (+ perCrew for each of their people)
  perCrew: 12,
  maxCrew: 6,
  takeChance: 0.5, // a job on the board a day or more: the share of them they take
  warTakeChance: 0.12,
  takeShare: 0.6, // what a job they take earns them (of its pay)
  warCost: 150, // a week's price war costs you this…
  warDays: 7,
  warDrain: 35, // …and costs them this a day
  freightCut: 0.7, // your share of the valley's loads while they run a carting business
  plotEvery: 14, // days between their land purchases
  maxPlots: 3,
  poachEvery: 21, // days between tries at your workers
  poachBelow: 45, // a worker less satisfied than this may go
  partnerRel: 45, // friendship needed for a partnership
  partnerShare: 0.25, // your share of their weekly income as partners
  buyOutBase: 300,
  buyOutPlot: 1.2, // × what their plots are worth
};

export class RivalSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.rival ??= null;
    sim.bus.on('time:day', () => this.daily());
    sim.bus.on('time:hour', (h) => h === 12 && this.midday());
  }

  get R() {
    return this.sim.state.rival;
  }
  npc() {
    return this.R ? this.sim.npcs.byId(this.R.npc) : null;
  }
  /** Competing with you right now? */
  active() {
    return this.R?.stage === 'rival' && !!this.npc();
  }
  atWar() {
    return this.active() && this.sim.time.day < (this.R.warUntil ?? -1);
  }

  // ------------------------------------------------------------------ a rival appears

  ready() {
    const sim = this.sim;
    const p = sim.state.player;
    if (this.R || p.level < RIVAL.appearLevel) return false;
    return sim.workers.list().length >= RIVAL.appearWorkers || (sim.state.contracts?.done || 0) >= RIVAL.appearContracts;
  }

  /** The most ambitious villager with money of their own (not one of yours, not a business owner). */
  candidate() {
    const sim = this.sim;
    let best = null;
    let score = -Infinity;
    for (const n of sim.state.npcs) {
      if (n.age < 22 || n.age > 55 || n.owns || n.employer === 'player' || n.away || n.leaving || n.teach || n.post) continue;
      const s = (n.money || 0) + (n.traits?.includes('ambitious') ? 200 : 0) + (n.traits?.includes('greedy') ? 120 : 0) - (n.rel || 0) * 2;
      if (s > score) (score = s), (best = n);
    }
    return best;
  }

  appear() {
    const sim = this.sim;
    const n = this.candidate();
    if (!n) return null;
    sim.state.rival = { npc: n.id, since: sim.time.day, money: RIVAL.startMoney + Math.round((n.money || 0) / 2), crew: 1, stage: 'rival', warUntil: -1, took: 0, plots: [], lastPlotDay: sim.time.day, lastPoachDay: sim.time.day, earned: 0, log: [] };
    n.rival = true;
    sim.toast('toast.rival_appears', { npc: n.id }, 'warn');
    sim.chronicle('chronicle.rival_appears', { npc: n.id, gender: n.gender });
    sim.bus.emit('rival:changed');
    return this.R;
  }

  log(e) {
    this.R.log.unshift({ day: this.sim.time.day, ...e });
    if (this.R.log.length > 30) this.R.log.pop();
  }

  // ------------------------------------------------------------------ every day

  daily() {
    const sim = this.sim;
    if (!this.R) {
      if (sim.time.weekday === 1 && this.ready()) this.appear();
      return;
    }
    const R = this.R;
    const n = this.npc();
    if (!n) return this.end('bust'); // (gone from the valley)
    // Their trade: a little each day (a week's worth over the week).
    if (R.stage === 'rival' || R.stage === 'partner') {
      const income = (RIVAL.weeklyIncome + RIVAL.perCrew * R.crew) / 7;
      R.money += income;
      R.earned += income;
      if (R.stage === 'partner' && sim.time.weekday === 0) this.partnerShare(Math.round((RIVAL.weeklyIncome + RIVAL.perCrew * R.crew) * RIVAL.partnerShare));
    }
    if (!this.active()) return;
    if (this.atWar()) R.money -= RIVAL.warDrain;
    if (R.money < 0) return this.end('bust');
    // Growing: a new hand every other week.
    if (sim.time.weekday === 3 && R.crew < RIVAL.maxCrew && (sim.time.day - R.since) % 14 < 7) R.crew++;
    // Land: a signposted plot now and then.
    if (sim.time.day - R.lastPlotDay >= RIVAL.plotEvery && R.plots.length < RIVAL.maxPlots) this.buyPlot();
    // One of your workers who isn't happy with you.
    if (sim.time.day - R.lastPoachDay >= RIVAL.poachEvery) this.poach();
  }

  /** Midday: jobs left on the board a day or more — they take some. */
  midday() {
    if (!this.active()) return;
    const sim = this.sim;
    const K = sim.contracts;
    const day = sim.time.day;
    const chance = this.atWar() ? RIVAL.warTakeChance : RIVAL.takeChance;
    const old = K.S.offers.filter((o) => day - o.posted >= 1).sort((a, b) => (b.pay || 0) - (a.pay || 0));
    let taken = 0;
    for (const o of old) {
      if (taken >= Math.max(1, Math.floor(this.R.crew / 2))) break;
      if (hashStr(`rival_${o.id}_${day}`, sim.state.seed | 0) >= chance) continue;
      K.S.offers.splice(K.S.offers.indexOf(o), 1);
      const earned = Math.round((o.pay || 20) * RIVAL.takeShare);
      this.R.money += earned;
      this.R.took++;
      this.log({ kind: 'took', ckind: o.kind, money: o.pay || 0 });
      sim.toast('toast.rival_took', { npc: this.R.npc, ckind: o.kind }, 'warn');
      taken++;
    }
    if (taken) sim.bus.emit('contracts:changed');
  }

  buyPlot() {
    const sim = this.sim;
    const R = this.R;
    R.lastPlotDay = sim.time.day;
    const T = sim.territory;
    const plots = sim.land.forSale().map((p) => ({ p, price: sim.land.price?.(p.id) ?? 200 })).sort((a, b) => a.price - b.price);
    const pick = plots.find((x) => x.price <= R.money * 0.6);
    if (!pick || !T) return;
    R.money -= pick.price;
    T.payTo('village', pick.price);
    T.transfer(pick.p.id, R.npc, 'bought', pick.price);
    R.plots.push(pick.p.id);
    this.log({ kind: 'plot', plot: pick.p.id, money: pick.price });
    sim.toast('toast.rival_bought_land', { npc: R.npc, plot: pick.p.id }, 'warn');
  }

  poach() {
    const sim = this.sim;
    const R = this.R;
    R.lastPoachDay = sim.time.day;
    if (R.crew >= RIVAL.maxCrew) return;
    const W = sim.workers;
    const c = W.list()
      .filter((x) => (x.satisfaction ?? 60) < RIVAL.poachBelow && !W.isManager?.(x.npcId))
      .sort((a, b) => (a.satisfaction ?? 60) - (b.satisfaction ?? 60))[0];
    if (!c) return;
    const npc = sim.npcs.byId(c.npcId);
    if (!npc) return;
    // They go over to the rival (not fired by you: they left).
    W.release(c);
    sim.equipment?.releaseWorker(c.npcId);
    delete W.contracts[c.npcId];
    sim.npcs.clearReservation(npc);
    npc.employer = null;
    npc.occupation = 'carter';
    npc.carry = null;
    npc.task = null;
    npc.nextThink = sim.time.total;
    npc.rivalCrew = true;
    R.crew++;
    this.log({ kind: 'poached', npc: npc.id });
    sim.toast('toast.rival_poached', { npc: npc.id, rival: R.npc }, 'danger');
    sim.bus.emit('workers:changed');
  }

  // ------------------------------------------------------------------ what you can do

  canWar() {
    if (!this.active()) return { ok: false, reason: 'no_rival' };
    if (this.atWar()) return { ok: false, reason: 'already_war' };
    if (this.sim.state.player.money < RIVAL.warCost) return { ok: false, reason: 'no_money', params: { money: RIVAL.warCost } };
    return { ok: true, cost: RIVAL.warCost };
  }

  /** A week of cutting your prices: it costs you, it costs them more. */
  priceWar() {
    const chk = this.canWar();
    if (!chk.ok) return chk;
    const sim = this.sim;
    this.warSpend(RIVAL.warCost);
    this.R.warUntil = sim.time.day + RIVAL.warDays;
    const n = this.npc();
    sim.social.addRel(n, -12);
    this.log({ kind: 'war' });
    sim.toast('toast.price_war', { npc: n.id, n: RIVAL.warDays }, 'info');
    sim.chronicle('chronicle.price_war', { npc: n.id });
    sim.bus.emit('rival:changed');
    return { ok: true };
  }

  canPartner() {
    if (!this.active()) return { ok: false, reason: 'no_rival' };
    if (this.atWar()) return { ok: false, reason: 'at_war' };
    if ((this.npc().rel || 0) < RIVAL.partnerRel) return { ok: false, reason: 'not_friends', params: { n: RIVAL.partnerRel } };
    return { ok: true };
  }

  partner() {
    const chk = this.canPartner();
    if (!chk.ok) return chk;
    this.R.stage = 'partner';
    this.log({ kind: 'partner' });
    this.sim.toast('toast.rival_partner', { npc: this.R.npc }, 'good');
    this.sim.chronicle('chronicle.rival_partner', { npc: this.R.npc });
    this.sim.bus.emit('rival:changed');
    return { ok: true };
  }

  endPartnership() {
    if (this.R?.stage !== 'partner') return { ok: false, reason: 'no_rival' };
    this.R.stage = 'rival';
    this.log({ kind: 'split' });
    this.sim.bus.emit('rival:changed');
    return { ok: true };
  }

  /** What buying them out costs: their money, their land, and something for the business. */
  buyOutPrice() {
    if (!this.R) return 0;
    const land = this.R.plots.reduce((s, id) => s + (this.sim.land.price?.(id) ?? 150), 0);
    return Math.round(RIVAL.buyOutBase + Math.max(0, this.R.money) + land * RIVAL.buyOutPlot + this.R.crew * 40);
  }

  canBuyOut() {
    if (!this.R || (this.R.stage !== 'rival' && this.R.stage !== 'partner')) return { ok: false, reason: 'no_rival' };
    const price = this.buyOutPrice();
    if (this.sim.state.player.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    return { ok: true, price };
  }

  buyOut() {
    const chk = this.canBuyOut();
    if (!chk.ok) return chk;
    const sim = this.sim;
    const n = this.npc();
    this.buyOutPaid(chk.price);
    n.money = (n.money || 0) + chk.price;
    for (const id of this.R.plots) sim.territory.transfer(id, 'player', 'bought', 0);
    this.log({ kind: 'bought', money: chk.price });
    sim.progression.addReputation(5);
    sim.toast('toast.rival_bought_out', { npc: n.id, money: chk.price }, 'good');
    sim.chronicle('chronicle.rival_bought_out', { npc: n.id, money: chk.price });
    this.end('bought', true);
    return { ok: true };
  }

  /** Their business is over (bust, bought out, or they've left). */
  end(stage, quiet = false) {
    const sim = this.sim;
    const R = this.R;
    R.stage = stage;
    const n = this.npc();
    if (n) delete n.rival;
    for (const w of sim.state.npcs) if (w.rivalCrew) delete w.rivalCrew;
    if (stage === 'bust') {
      // They sell up: their land goes back on the market.
      for (const id of R.plots) {
        sim.territory.transfer(id, 'village', 'sold', 0);
        const rec = sim.territory.rec(id);
        if (rec) rec.forSale = true;
      }
      if (!quiet && n) {
        sim.toast('toast.rival_bust', { npc: n.id }, 'good');
        sim.chronicle('chronicle.rival_bust', { npc: n.id });
      }
    }
    R.plots = [];
    sim.bus.emit('rival:changed');
  }

  // (Their own methods, so the ledger knows what the money was for.)
  warSpend(n) {
    this.sim.state.player.money -= n;
  }
  buyOutPaid(n) {
    this.sim.state.player.money -= n;
  }
  partnerShare(n) {
    this.sim.state.player.money += n;
    this.log({ kind: 'share', money: n });
  }

  // ------------------------------------------------------------------ for the others

  /** Your share of the valley's loads, while they run a carting business (FreightSystem). */
  freightFactor() {
    return this.active() ? RIVAL.freightCut : 1;
  }

  advice(AP) {
    const out = [];
    if (!this.active()) return out;
    const week = (this.R.log || []).filter((e) => e.kind === 'took' && this.sim.time.day - e.day < 7).length;
    if (week >= 2) out.push({ id: 'rival_busy', prio: AP.opportunity + 8, icon: '⚔️', params: { npc: this.R.npc, n: week }, go: 'rival' });
    return out;
  }

  summary() {
    const R = this.R;
    return R ? { npc: R.npc, stage: R.stage, money: Math.round(R.money), crew: R.crew, took: R.took, plots: R.plots.length, war: this.atWar() } : null;
  }
}
