/**
 * TownSystem — a village becoming a town, and a town a city: how it looks and how it decides.
 *
 *   state.town = { meeting: { id, proposal, day, spoke, support } | null, nextMeeting, history: [...] }
 *
 * How it looks, as the valley's status rises (CivicSystem):
 *   • the village hall grows — the village pays to raise it a level (a real building job): a second
 *     storey and a clock at a town, a grand stone hall at a city;
 *   • villagers build up: well-off owners improve their homes sooner (StructureSystem — boom()), so
 *     houses gain storeys and rooms;
 *   • the street lamps are gas lamps in a town (brighter — BuildingViews), and the busy streets are
 *     cobbled (InfrastructureSystem already paves them once the valley is big enough).
 *
 * How it decides: town meetings. Once it's a large village, every couple of weeks a proposal is put to
 * the valley — cobble the square, gas lamps, a green, a market day, money for the school, a better road
 * to a town you trade with — announced a few days ahead. You can speak for it or against it at the
 * hall; how much you sway people depends on your name (and being on the council, or headman). On the
 * evening of the meeting everyone votes; if it passes (and the treasury can pay), it's done.
 * Nobody's vote is rolled: each leans by who they are (a hash, their traits, their means).
 */
import { hashStr } from '../core/rng.js';

export const TOWN = {
  hallLevel: { village: 2, large_village: 2, town: 3, city: 5 }, // the hall the village wants at each status
  hallReserve: 250, // the treasury keeps this much back
  boom: { village: 1, large_village: 0.8, town: 0.6, city: 0.45 }, // how much money villagers want before building up
  meetingEvery: 14,
  announceDays: 3,
  meetingHour: 18,
  fromStatus: 'large_village',
  sway: { base: 0.04, perRep: 0.002, maxRep: 0.16, council: 0.08, headman: 0.15 },
  marketWeeks: 8,
  marketIncome: 12,
};

/** What a town meeting can be asked to do. cost from the treasury; run(sim) does it. */
export const PROPOSALS = {
  pave_square: { cost: 180, lean: 0.05, run: (sim) => (sim.state.infra.fund = (sim.state.infra.fund || 0) + 180) },
  gas_lamps: {
    cost: 150,
    lean: 0.1,
    run: (sim) => {
      // The neighbourhoods first; then the square and the streets by people's homes.
      const at = [...(sim.places?.hoods() || []).map((h) => ({ tx: h.tx, ty: h.ty })), sim.festivals.centre(), ...sim.world.buildingList.filter((b) => sim.property.isHome?.(b.id)).map((b) => b.door)];
      let n = 0;
      for (const p of at) {
        if (n >= 3) break;
        if (sim.infra.lampNear(p.tx, p.ty)) continue;
        const spot = sim.infra.lampSpot(p.tx, p.ty);
        if (spot && sim.infra.lamp(spot.tx, spot.ty, 'village').ok) n++;
      }
      return n;
    },
  },
  green: {
    cost: 200,
    lean: 0,
    run: (sim) => {
      for (const n of sim.state.npcs) n.mood = Math.min(100, (n.mood ?? 60) + 6);
    },
  },
  market_day: { cost: 80, lean: 0.12, run: (sim) => (sim.state.town.marketUntil = sim.time.day + TOWN.marketWeeks * 7) },
  school_fund: { cost: 150, lean: -0.02, run: (sim) => (sim.state.village.schoolFund = (sim.state.village.schoolFund || 0) + 150) },
  better_road: {
    cost: 300,
    lean: 0.02,
    when: (sim) => sim.settlements.contacts().some((id) => sim.settlements.get(id).road < 2 && !sim.settlements.get(id).roadWork),
    run: (sim) => {
      const S = sim.settlements;
      const id = S.contacts().filter((x) => S.get(x).road < 2 && !S.get(x).roadWork).sort((a, b) => S.get(b).trade - S.get(a).trade)[0];
      if (id) S.startRoad(id, 'village');
    },
  },
};

export class TownSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.town ??= { meeting: null, nextMeeting: null, history: [] };
    sim.bus.on('time:day', () => this.daily());
    sim.bus.on('time:hour', (h) => h === TOWN.meetingHour && this.meetingHour());
  }

  get S() {
    return this.sim.state.town;
  }
  status() {
    return this.sim.civic?.V.status || 'village';
  }
  statusIndex(id = this.status()) {
    return ['village', 'large_village', 'town', 'city'].indexOf(id);
  }

  /** How readily villagers build up (StructureSystem multiplies the money they want by this). */
  boom() {
    return TOWN.boom[this.status()] ?? 1;
  }

  /** Gas lamps (a town or a city). */
  gasLamps() {
    return this.statusIndex() >= 2;
  }

  // ------------------------------------------------------------------ the hall

  hallWanted() {
    return TOWN.hallLevel[this.status()] ?? 2;
  }

  growHall() {
    const sim = this.sim;
    const S = sim.structures;
    const r = S?.rec('hall');
    if (!r || S.works('hall') || r.lvl >= this.hallWanted()) return false;
    const job = { type: 'level', to: r.lvl + 1 };
    const cost = S.cost('hall', job);
    if (!cost || sim.state.village.treasury - TOWN.hallReserve < S.estimate(cost)) return false;
    const res = S.start('hall', job, 'village');
    if (res.ok) sim.chronicle('chronicle.hall_grows', { n: r.lvl + 1 });
    return !!res.ok;
  }

  // ------------------------------------------------------------------ town meetings

  daily() {
    const sim = this.sim;
    const day = sim.time.day;
    if (sim.time.weekday === 2) this.growHall();
    // Market day (a proposal that passed): once a week the square fills.
    if ((this.S.marketUntil ?? -1) > day && sim.time.weekday === 5) {
      for (const type of ['general_store', 'tavern']) {
        const id = sim.economy.ofType(type)[0];
        if (id) sim.economy.biz(id).money += TOWN.marketIncome;
      }
      for (const n of sim.state.npcs) n.mood = Math.min(100, (n.mood ?? 60) + 2);
    }
    if (this.statusIndex() < this.statusIndex(TOWN.fromStatus)) return;
    this.S.nextMeeting ??= day + TOWN.announceDays;
    // A few days ahead: the proposal is announced.
    if (!this.S.meeting && day >= this.S.nextMeeting - TOWN.announceDays) this.call(this.S.nextMeeting);
  }

  /** The proposals that could be put now (the treasury could pay, the thing makes sense). */
  feasible() {
    const sim = this.sim;
    const done = new Set(this.S.history.filter((h) => h.passed && sim.time.day - h.day < 40).map((h) => h.proposal));
    return Object.entries(PROPOSALS)
      .filter(([id, p]) => !done.has(id) && (!p.when || p.when(sim)) && sim.state.village.treasury >= p.cost * 0.8)
      .map(([id]) => id);
  }

  call(day) {
    const sim = this.sim;
    const list = this.feasible();
    if (!list.length) {
      this.S.nextMeeting = day + TOWN.meetingEvery;
      return null;
    }
    const n = this.S.history.length;
    const proposal = list[Math.floor(hashStr(`meeting_${n}`, sim.state.seed | 0) * list.length)];
    this.S.meeting = { id: n + 1, proposal, day, spoke: null };
    sim.toast('toast.meeting_called', { proposal, n: day - sim.time.day }, 'info');
    sim.bus.emit('town:changed');
    return this.S.meeting;
  }

  /** How a villager leans on a proposal (−1 … 1), by who they are — no dice. */
  lean(n, proposal) {
    const p = PROPOSALS[proposal];
    let v = (hashStr(`${n.id}_${proposal}`, 7) - 0.5) * 0.8 + (p.lean || 0);
    const tr = n.traits || [];
    if (tr.includes('thrifty') || tr.includes('greedy')) v -= 0.25; // it's the village's money
    if (tr.includes('generous') || tr.includes('kind')) v += 0.15;
    if (tr.includes('ambitious')) v += 0.1;
    if ((n.money || 0) < 20) v += proposal === 'market_day' || proposal === 'green' ? 0.1 : -0.05;
    return Math.max(-1, Math.min(1, v));
  }

  /** How much your word counts: your name, and being on the council (or headman). */
  sway() {
    const sim = this.sim;
    const W = TOWN.sway;
    const V = sim.civic?.V;
    let s = W.base + Math.min(W.maxRep, Math.max(0, sim.state.player.reputation || 0) * W.perRep);
    if (V?.headman === 'player') s += W.headman;
    else if (V?.council?.includes('player')) s += W.council;
    return s;
  }

  /** The share for it right now (and what your word would do). */
  support(spoke = this.S.meeting?.spoke) {
    const sim = this.sim;
    const m = this.S.meeting;
    if (!m) return 0;
    const voters = sim.civic?.voters() || sim.state.npcs.filter((n) => n.age >= 18);
    if (!voters.length) return 0.5;
    const s = this.sway() * (spoke === 'for' ? 1 : spoke === 'against' ? -1 : 0);
    const yes = voters.filter((n) => this.lean(n, m.proposal) + s > 0).length;
    return yes / voters.length;
  }

  canSpeak(side) {
    const m = this.S.meeting;
    if (!m) return { ok: false, reason: 'no_meeting' };
    if (!['for', 'against', null].includes(side)) return { ok: false, reason: 'nothing_here' };
    return { ok: true };
  }

  speak(side) {
    const chk = this.canSpeak(side);
    if (!chk.ok) return chk;
    this.S.meeting.spoke = side;
    this.sim.bus.emit('town:changed');
    return { ok: true };
  }

  meetingHour() {
    const m = this.S.meeting;
    if (!m || this.sim.time.day < m.day) return;
    this.hold();
  }

  /** The meeting: everyone votes; if it passes and the treasury can pay, it's done. */
  hold() {
    const sim = this.sim;
    const m = this.S.meeting;
    const p = PROPOSALS[m.proposal];
    const support = this.support();
    const afford = sim.state.village.treasury >= p.cost;
    const passed = support >= 0.5 && afford;
    if (passed) {
      sim.state.village.treasury -= p.cost;
      p.run(sim);
    }
    // You spoke and it went your way: people remember you had their ear.
    if (m.spoke) sim.progression.addReputation((m.spoke === 'for') === passed ? 1.5 : -0.5);
    this.S.history.unshift({ id: m.id, proposal: m.proposal, day: sim.time.day, support: Math.round(support * 100), passed, spoke: m.spoke, poor: !afford });
    if (this.S.history.length > 20) this.S.history.pop();
    this.S.meeting = null;
    this.S.nextMeeting = sim.time.day + TOWN.meetingEvery;
    sim.toast(passed ? 'toast.meeting_passed' : 'toast.meeting_failed', { proposal: m.proposal, n: Math.round(support * 100) }, passed ? 'good' : 'info');
    sim.chronicle(passed ? 'chronicle.meeting_passed' : 'chronicle.meeting_failed', { proposal: m.proposal });
    sim.bus.emit('town:changed');
    return passed;
  }

  advice(AP) {
    const m = this.S.meeting;
    if (!m || m.spoke) return [];
    return [{ id: 'town_meeting', prio: AP.opportunity + 2, icon: '🏛️', params: { proposal: m.proposal, n: Math.max(0, m.day - this.sim.time.day) }, go: 'meeting' }];
  }
}
