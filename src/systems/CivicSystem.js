/**
 * CivicSystem — how the village governs itself, and what it becomes.
 *
 *   state.civic = {
 *     headman, council: [ids], nextElection, lastElection: { day, votes: [{ id, n }] },
 *     standing (you've put yourself forward), policies: { tax, relief },
 *     project (the institution being saved for), fund (money set aside for it),
 *     institutions: { id: { founded, building, byPlayer } }, status, statusDay,
 *   }
 *   player.bank = savings at the village bank
 *
 * Headman and council. Once a year the grown-ups of the valley choose a headman.
 * Candidates are the most respected villagers (by the people who know them:
 * friendship, respect, trust, their standing in the trade, their temperament)
 * — and you, once you've earned enough reputation and put yourself forward.
 * Everyone votes for whoever they think best of, and for what they'd do: the
 * hard-up vote for a generous headman, business owners for a careful one.
 *
 * The headman sets the policies — taxes (low / normal / high) and poor relief —
 * and chooses which institution the village saves for next. An NPC headman does
 * it by temperament; if you're headman, it's up to you (in the village hall).
 * High taxes fill the fund faster but business owners grumble; mean relief
 * saves money but the poor go without — and people remember at the next election.
 *
 * Institutions — a market, a night watch, a healer's house, a craft guild, a
 * bank — are founded when the village needs them, paid for from the civic fund
 * (a share of every week's taxes), built by the villagers like any other
 * building, and then change how things work (see data/civic.js).
 *
 * Status. The valley's settlement grows from a village into a large village,
 * a town and a city — as its population and institutions grow. Nobody presses
 * "upgrade": it happens, it goes into the history book, and it draws newcomers.
 */
import { INSTITUTIONS, INSTITUTION_ORDER, VILLAGE_STATUS, CIVIC_TUNING as C, POLICIES } from '../data/civic.js';
import { rand } from '../core/rng.js';

export class CivicSystem {
  constructor(sim) {
    this.sim = sim;
    const S = sim.state;
    S.civic ??= {};
    const V = S.civic;
    V.council ??= [];
    V.policies ??= { tax: 'normal', relief: 'normal' };
    V.policies.schooling ??= 'normal';
    V.institutions ??= {};
    V.fund ??= 0;
    V.project ??= null;
    V.status ??= 'village';
    V.nextElection ??= C.firstElectionDay;
    V.standing ??= false;
    S.player.bank ??= 0;
    // A village always has someone people listen to: the most respected grown-up, until the first election.
    if (V.headman === undefined) {
      const first = this.candidates().filter((c) => c.id !== 'player')[0];
      V.headman = first?.id || null;
    }
    this.effectsCache = null;
    sim.bus.on('time:day', () => this.onDay());
  }

  get V() {
    return this.sim.state.civic;
  }
  get p() {
    return this.sim.state.player;
  }

  // ------------------------------------------------------------------ reading

  has(id) {
    return !!this.V.institutions[id];
  }

  /** Effects of the institutions the village has (for TechSystem.mod). */
  effects() {
    return Object.keys(this.V.institutions).map((id) => INSTITUTIONS[id]?.effects || {});
  }

  headman() {
    const id = this.V.headman;
    if (id === 'player') return 'player';
    return (id && this.sim.npcs.byId(id)) || null;
  }

  isPlayerHeadman() {
    return this.V.headman === 'player';
  }

  mult(kind) {
    return POLICIES[kind]?.[this.V.policies[kind]] ?? 1;
  }

  pop() {
    return this.sim.state.npcs.length + 1;
  }

  statusIndex(id = this.V.status) {
    return Math.max(0, VILLAGE_STATUS.findIndex((s) => s.id === id));
  }

  /** Newcomers are drawn to a place that's going up in the world. */
  attractiveness() {
    return this.statusIndex() * C.statusAttraction;
  }

  // ------------------------------------------------------------------ standing and elections

  voters() {
    return this.sim.state.npcs.filter((n) => n.age >= 18 && !n.leaving && !n.away);
  }

  /** How highly the village thinks of a villager (0…). */
  standing(npc) {
    const T = (t) => npc.traits.includes(t);
    let s = (npc.level || 1) * 0.4 + (npc.owns ? 3 : 0) + Math.min(4, this.sim.social.friendCount(npc) * 0.8);
    let respect = 0;
    let n = 0;
    for (const o of this.voters()) {
      const b = o.relations?.[npc.id];
      if (!b) continue;
      respect += b.r + b.t * 0.5 - b.c;
      n++;
    }
    if (n) s += respect / n / 8;
    if (T('natural_leader')) s += 3;
    if (T('ambitious')) s += 1;
    if (T('aggressive')) s -= 2;
    if (npc.age >= 30 && npc.age <= 65) s += 1;
    if (npc.id === this.V.headman) s += 1; // people know the incumbent
    return s;
  }

  playerStanding() {
    return (this.p.reputation || 0) / 5 + (this.sim.legacy?.renown() || 0) * 0.08 + (this.p.level || 1) * 0.3 + (this.V.headman === 'player' ? 1 : 0);
  }

  canStand() {
    const p = this.p;
    if (p.away) return { ok: false, reason: 'already_away' };
    if ((p.reputation || 0) < C.standReputation) return { ok: false, reason: 'need_reputation', params: { value: C.standReputation } };
    if (this.sim.time.day - (p.succeededDay || 0) < C.standMinDays && this.sim.time.day < C.standMinDays) return { ok: false, reason: 'too_new' };
    return { ok: true };
  }

  /** Put yourself forward at the next election (or withdraw). */
  stand(on = true) {
    if (on && !this.canStand().ok) return this.canStand();
    this.V.standing = !!on;
    return { ok: true };
  }

  candidates() {
    const list = this.sim.state.npcs
      .filter((n) => n.age >= 25 && !n.leaving && !n.away && n.occupation !== 'child')
      .map((n) => ({ id: n.id, s: this.standing(n) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, C.candidates);
    if (this.V.standing && this.canStand().ok) list.push({ id: 'player', s: this.playerStanding() });
    return list;
  }

  /** How much a voter likes a candidate — the person, and what they'd likely do. */
  voteScore(voter, cand) {
    const poor = voter.money < 30;
    const owner = !!voter.owns || Object.values(this.sim.property.all).some((r) => r.owner === voter.id);
    let s = cand.s * 0.5;
    if (cand.id === 'player') {
      const pb = voter.pb || { t: 0, r: 0, c: 0 };
      s += (voter.rel || 0) / 10 + pb.r / 10 + pb.t / 20 - pb.c / 8;
      s += this.sim.dynasty?.allyVote(voter) || 0; // families married into yours
      if (this.V.headman === 'player') s += this.policyFit(voter, this.V.policies, poor, owner);
    } else {
      const c = this.sim.npcs.byId(cand.id);
      if (voter.id === cand.id) return 99; // everyone votes for themselves
      const b = voter.relations?.[cand.id];
      if (b) s += b.f / 10 + b.r / 10 + b.t / 20 - b.c / 8;
      if (voter.family.includes(cand.id)) s += 4;
      s += this.policyFit(voter, this.policiesFor(c), poor, owner);
    }
    return s + rand.float() * 1.5;
  }

  policyFit(voter, policies, poor, owner) {
    let s = 0;
    if (poor) s += { low: -1.5, normal: 0, high: 1.5 }[policies.relief] ?? 0;
    if (owner) s += { low: 1.2, normal: 0, high: -1.2 }[policies.tax] ?? 0;
    // Parents want a good school; those who read value one more.
    const kids = this.sim.family.children(voter).filter((k) => k.age >= 5 && k.age <= 16).length;
    const reads = this.sim.education?.know(voter, 'reading') || 0;
    if (kids || reads >= 50) s += ({ low: -1, normal: 0, high: 1 }[policies.schooling] ?? 0) * (kids ? 1 : 0.5);
    return s;
  }

  /** What an NPC headman would do, from their temperament. */
  policiesFor(npc) {
    const T = (t) => npc?.traits.includes(t);
    return {
      tax: T('greedy') || T('ambitious') ? 'high' : T('careful') ? 'low' : 'normal',
      relief: T('generous') ? 'high' : T('greedy') ? 'low' : 'normal',
      schooling: T('scholar') || (npc && (this.sim.education?.know(npc, 'reading') || 0) >= 55) ? 'high' : T('greedy') ? 'low' : 'normal',
    };
  }

  /** The yearly election. */
  election() {
    const sim = this.sim;
    const cands = this.candidates();
    if (!cands.length) return null;
    const votes = Object.fromEntries(cands.map((c) => [c.id, 0]));
    for (const v of this.voters()) {
      let best = null;
      let bestS = -Infinity;
      for (const c of cands) {
        const s = this.voteScore(v, c);
        if (s > bestS) (bestS = s), (best = c.id);
      }
      if (best) votes[best]++;
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const before = this.V.headman;
    const winner = ranked[0][0];
    this.V.headman = winner;
    this.V.council = ranked.slice(1, 1 + C.councilSize).map(([id]) => id);
    this.V.lastElection = { day: sim.time.day, votes: ranked.map(([id, n]) => ({ id, n })) };
    this.V.nextElection = sim.time.day + C.yearDays;
    if (winner === 'player') {
      sim.chronicle(before === 'player' ? 'chronicle.player_reelected' : 'chronicle.player_elected', { n: votes.player });
      sim.toast('toast.you_elected', { n: votes.player }, 'good');
      sim.progression.addReputation(5);
    } else {
      const npc = sim.npcs.byId(winner);
      this.V.policies = this.policiesFor(npc);
      sim.chronicle(before === winner ? 'chronicle.headman_reelected' : 'chronicle.headman_elected', { npc: winner, gender: npc?.gender, n: votes[winner] });
      if (npc && before !== winner) sim.memory.remember(npc, 'became_headman');
      if (cands.some((c) => c.id === 'player')) sim.toast('toast.you_lost_election', { npc: winner, n: votes.player || 0 }, 'info');
    }
    if (before === 'player' && winner !== 'player') this.V.standing = true; // you'll be on the ballot again
    this.V.project = null; // a new headman looks at the village's needs afresh
    sim.bus.emit('civic:changed');
    return { winner, votes: ranked };
  }

  /** Share of the village that would vote for the headman right now (for the hall). */
  approval() {
    const cands = this.candidates();
    if (!cands.some((c) => c.id === this.V.headman)) cands.push({ id: this.V.headman, s: this.V.headman === 'player' ? this.playerStanding() : this.standing(this.sim.npcs.byId(this.V.headman) || { traits: [], level: 1 }) });
    const voters = this.voters();
    if (!voters.length) return 0;
    let n = 0;
    for (const v of voters) {
      let best = null;
      let bestS = -Infinity;
      for (const c of cands) {
        const s = this.voteScore(v, c) - (v.id === c.id ? 90 : 0);
        if (s > bestS) (bestS = s), (best = c.id);
      }
      if (best === this.V.headman) n++;
    }
    return Math.round((n / voters.length) * 100);
  }

  /** Your policies, if you're headman. */
  setPolicy(kind, level) {
    if (!this.isPlayerHeadman() || !POLICIES[kind]?.[level]) return false;
    this.V.policies[kind] = level;
    this.sim.chronicle(`chronicle.policy_${kind}_${level}`, {});
    this.sim.bus.emit('civic:changed');
    return true;
  }

  /** How the headman's policies feel to this villager (added to their mood). */
  moodEffect(npc) {
    let m = 0;
    const tax = this.V.policies.tax;
    const relief = this.V.policies.relief;
    if (npc.owns) m += tax === 'high' ? -C.moodTax : tax === 'low' ? C.moodTax : 0;
    if (npc.money < 20 && npc.age >= 18) m += relief === 'high' ? C.moodRelief : relief === 'low' ? -C.moodRelief : 0;
    return m;
  }

  // ------------------------------------------------------------------ institutions

  /** Can the village found this now? Returns { ok, missing: [{ k, v }] }. */
  conditions(id) {
    const sim = this.sim;
    const w = INSTITUTIONS[id].when;
    const E = sim.economy;
    const missing = [];
    if (w.pop && this.pop() < w.pop) missing.push({ k: 'pop', v: w.pop });
    if (w.shops && E.active().filter((b) => E.def(b).kind === 'shop').length < w.shops) missing.push({ k: 'shops', v: w.shops });
    if (w.businesses && E.active().length < w.businesses) missing.push({ k: 'businesses', v: w.businesses });
    if (w.skilled && sim.state.npcs.filter((n) => ['skilled', 'master'].includes(sim.npcs.rank(n))).length < w.skilled) missing.push({ k: 'skilled', v: w.skilled });
    if (w.tech && !sim.tech?.has(w.tech)) missing.push({ k: 'tech', v: w.tech });
    return { ok: !missing.length, missing };
  }

  underway(id) {
    return this.sim.construction.list.find((c) => c.institution === id && c.status === 'site') || null;
  }

  /** Institutions the village could found now (in the order the council considers them). */
  wanted() {
    return INSTITUTION_ORDER.filter((id) => !this.has(id) && !this.underway(id) && this.conditions(id).ok);
  }

  /** Choose what to save for (you, as headman). */
  setProject(id) {
    if (!this.isPlayerHeadman() || (id && !this.wanted().includes(id))) return false;
    this.V.project = id;
    this.sim.bus.emit('civic:changed');
    return true;
  }

  /** What founding it will take: the building's materials at today's prices, and the labour. */
  costOf(id) {
    return Math.round(this.sim.growth.estimate(INSTITUTIONS[id].building) * C.labourMargin);
  }

  /**
   * Taxes come in (FinanceSystem): a share goes into the fund for the next institution —
   * or, while one is being built, straight to the building site.
   */
  divert(taxes) {
    if (taxes <= 0) return 0;
    const site = this.sim.construction.list.find((c) => c.institution && c.status === 'site');
    if (!this.V.project && !site) return 0;
    const share = Math.floor(taxes * C.fundShare * (this.V.policies.tax === 'high' ? 1.3 : 1));
    if (site) site.budget += share;
    else this.V.fund += share;
    return share;
  }

  /** The fund is full: the villagers start building. */
  found(id) {
    const sim = this.sim;
    const def = INSTITUTIONS[id];
    const village = sim.state.village;
    // The fund goes into the treasury, which pays for the site (GrowthSystem.start).
    const fund = this.V.fund;
    village.treasury += fund;
    this.V.fund = 0;
    const c = sim.growth.start('village', def.building, 'public', undefined, { institution: id });
    if (!c) {
      // Nowhere to build it yet: the money stays set aside.
      village.treasury -= fund;
      this.V.fund = fund;
      return null;
    }
    // The whole fund goes to the site (materials and the labourers' pay), not just the materials.
    const extra = Math.max(0, Math.min(fund - c.budget, village.treasury));
    village.treasury -= extra;
    c.budget += extra;
    this.V.project = null;
    sim.chronicle(this.isPlayerHeadman() ? 'chronicle.institution_started_player' : 'chronicle.institution_started', { institution: id, npc: this.isPlayerHeadman() ? undefined : this.V.headman });
    return c;
  }

  /** Its building is finished (GrowthSystem.completed): the institution opens. */
  opened(c) {
    const sim = this.sim;
    const id = c.institution;
    const byPlayer = this.isPlayerHeadman();
    this.V.institutions[id] = { founded: sim.time.day, building: c.id, byPlayer, headman: this.V.headman };
    // A new bank starts with some capital from the village.
    if (id === 'bank') this.V.vault = (this.V.vault || 0) + C.bankCapital;
    if (sim.tech) sim.tech.mods = null;
    sim.chronicle(byPlayer ? 'chronicle.institution_founded_player' : 'chronicle.institution_founded', { institution: id, building: c.id });
    if (byPlayer) sim.toast('toast.institution_founded', { institution: id }, 'good');
    this.checkStatus();
    sim.bus.emit('civic:changed');
  }

  // ------------------------------------------------------------------ status

  nextStatus() {
    return VILLAGE_STATUS[this.statusIndex() + 1] || null;
  }

  /** What's still missing for the next step up: [{ k, v }]. */
  statusMissing(step = this.nextStatus()) {
    if (!step) return [];
    const out = [];
    if (this.pop() < step.pop) out.push({ k: 'pop', v: step.pop });
    const n = Object.keys(this.V.institutions).length;
    if (n < step.institutions) out.push({ k: 'institutions', v: step.institutions });
    for (const id of step.needs || []) if (!this.has(id)) out.push({ k: 'institution', v: id });
    out.push(...(this.sim.eduworld?.statusNeeds(step) || [])); // learning: a school, literacy, graduates
    return out;
  }

  checkStatus() {
    const step = this.nextStatus();
    if (!step || this.statusMissing(step).length) return false;
    const sim = this.sim;
    this.V.status = step.id;
    this.V.statusDay = sim.time.day;
    const player = this.isPlayerHeadman();
    sim.chronicle(player ? 'chronicle.village_status_player' : 'chronicle.village_status', { status: step.id });
    sim.toast('toast.village_status', { status: step.id }, 'good');
    sim.progression.addReputation(player ? 6 : 2);
    return true;
  }

  // ------------------------------------------------------------------ the bank

  /**
   * The bank keeps its own vault (not the village fund): your savings, its capital
   * (the village puts some in when it's founded), and loans coming back with interest.
   */
  deposit(amount) {
    if (!this.has('bank')) return { ok: false, reason: 'no_bank' };
    const n = Math.min(Math.floor(this.p.money), amount);
    if (n <= 0) return { ok: false, reason: 'no_money' };
    this.p.money -= n;
    this.p.bank += n;
    this.V.vault = (this.V.vault || 0) + n;
    this.sim.bus.emit('player:changed');
    return { ok: true, n };
  }

  withdraw(amount) {
    const n = Math.min(this.p.bank, amount, Math.max(0, Math.floor(this.V.vault || 0)));
    if (n <= 0) return { ok: false, reason: 'bank_short' };
    this.p.bank -= n;
    this.V.vault -= n;
    this.p.money += n;
    this.sim.bus.emit('player:changed');
    return { ok: true, n };
  }

  /** What the bank would lend someone starting a business (it keeps half your savings in reserve). */
  bankOffer(n) {
    if (!this.has('bank') || (n.lastBankLoan && this.sim.time.day - n.lastBankLoan < 112)) return 0;
    const spare = (this.V.vault || 0) - this.p.bank * 0.5;
    return Math.max(0, Math.min(C.bankLoanMax, Math.floor(spare)));
  }

  /** The bank lends from its vault; the business pays it back with interest from its profits. */
  bankLend(n, amount) {
    amount = Math.min(amount, this.bankOffer(n));
    if (amount <= 0) return null;
    this.V.vault -= amount;
    n.money += amount;
    n.lastBankLoan = this.sim.time.day;
    this.sim.memory.remember(n, 'bank_loan', { params: { money: amount } });
    return { lender: 'bank', amount, left: Math.round(amount * (1 + C.bankLoanRate)) };
  }

  // ------------------------------------------------------------------ the year

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    const V = this.V;
    // The headman is gone (died, left): the council's senior member steps in until the election.
    if (V.headman && V.headman !== 'player' && !sim.npcs.byId(V.headman)) {
      V.headman = V.council.find((id) => id === 'player' || sim.npcs.byId(id)) || this.candidates()[0]?.id || null;
      if (V.headman && V.headman !== 'player') V.policies = this.policiesFor(sim.npcs.byId(V.headman));
    }
    if (day >= V.nextElection) this.election();
    if (sim.time.weekday !== 3) return;
    // Weekly: the headman's stipend, the next project, the fund, the market's news, the bank's interest.
    const village = sim.state.village;
    if (V.headman && village.treasury >= C.headmanStipend) {
      village.treasury -= C.headmanStipend;
      if (V.headman === 'player') {
        this.p.money += C.headmanStipend;
        sim.progression.addReputation(0.5);
      } else {
        const h = sim.npcs.byId(V.headman);
        if (h) h.money += C.headmanStipend;
      }
    }
    // An NPC headman picks what the village needs most; you pick for yourself (or it's picked for you).
    if (!V.project || this.has(V.project) || this.underway(V.project)) V.project = V.headman === 'player' && V.project && !this.has(V.project) ? V.project : this.wanted()[0] || null;
    if (V.project && V.fund >= this.costOf(V.project)) this.found(V.project);
    if (this.has('market')) for (const id of sim.settlements?.contacts() || []) sim.settlements.learnPrices(id);
    // Interest on your savings, paid out of what the bank earns on its loans.
    if (this.has('bank') && this.p.bank > 0) {
      const interest = Math.max(1, Math.floor(this.p.bank * C.bankRate));
      if ((V.vault || 0) - this.p.bank >= interest) this.p.bank += interest; // from the bank's own earnings
      else if (village.treasury >= interest) {
        village.treasury -= interest; // the village makes it good
        V.vault = (V.vault || 0) + interest;
        this.p.bank += interest;
      }
    }
    this.checkStatus();
  }
}
