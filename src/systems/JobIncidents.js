/**
 * Jobs with a story (mixed into JobSystem): now and then a job ends with something happening — the night
 * watch spots a thief, a ferry passenger can't pay, the chimney sweep finds coins hidden up a chimney…
 * You choose what to do; what comes of it follows the day (hashStr — no dice).
 *
 *   state.jobs.incident = { id, kind, jobId, day, npc?, building? }   (one at a time, until you choose)
 *
 * Each choice: its outcome(s) — money, reputation, energy, how someone feels about you — and, for a gamble,
 * the chance it goes well (win) and what happens if not (lose).
 */
import { hashStr } from '../core/rng.js';

export const INCIDENTS = {
  thief: {
    jobs: ['night_watch'], chance: 0.3,
    choices: {
      chase: { energy: 10, win: 0.6, good: { rep: 2, money: 10, caught: true }, bad: { rep: 0 } },
      alarm: { rep: 1 },
    },
  },
  no_fare: {
    jobs: ['ferry_rowing'], chance: 0.3, npc: true,
    choices: {
      free: { rel: 5, rep: 1 },
      insist: { money: 4, rel: -3 },
    },
  },
  hidden_coins: {
    jobs: ['chimney_sweep'], chance: 0.25, building: true,
    choices: {
      return: { rel: 8, rep: 2 },
      keep: { money: 25, win: 0.6, good: {}, bad: { rep: -3, rel: -10 } },
    },
  },
  truffle: {
    jobs: ['mushroom_foraging'], chance: 0.25,
    choices: {
      sell: { money: 18 },
      tavern: { relOwner: 6, rep: 1, item: { mushroom: 3 } },
    },
  },
  poachers: {
    jobs: ['gamekeeping'], chance: 0.3,
    choices: {
      confront: { energy: 8, win: 0.5, good: { rep: 2 }, bad: { health: 10 } },
      report: { rep: 1 },
    },
  },
  lost_child: {
    jobs: ['lamplighter'], chance: 0.2, npc: true, child: true,
    choices: {
      walk_home: { energy: 4, relParent: 10, rep: 1 },
      point: {},
    },
  },
  lost_lamb: {
    jobs: ['shepherding'], chance: 0.3,
    choices: {
      search: { energy: 6, win: 0.7, good: { relOwner: 8, money: 6 }, bad: {} },
      leave: { relOwner: -4 },
    },
  },
};

export const JobIncidents = {
  /** After a job: does something happen? (Once in a while, by the job and the day.) */
  maybeIncident(job) {
    const sim = this.sim;
    if (this.js.incident && this.js.incident.day === sim.time.day) return null;
    const entry = Object.entries(INCIDENTS).find(([, d]) => d.jobs.includes(job.jobId));
    if (!entry) return null;
    const [kind, def] = entry;
    if (hashStr(`incident:${job.jobId}:${job.acceptedAt}`, sim.state.seed) >= def.chance) return null;
    const inc = { id: (this.js.incidentSeq = (this.js.incidentSeq || 0) + 1), kind, jobId: job.jobId, day: sim.time.day, employer: job.employer };
    if (def.npc) {
      const pool = sim.state.npcs.filter((n) => (def.child ? n.age < 12 && n.kin?.parents?.length : n.age >= 16));
      if (pool.length) inc.npc = pool[Math.floor(hashStr(`incnpc:${inc.id}:${sim.time.day}`, sim.state.seed) * pool.length)].id;
    }
    if (def.building) inc.building = job.lastHouse || this.homes()[0] || null;
    this.js.incident = inc;
    sim.bus.emit('job:incident', inc);
    return inc;
  },

  /** You choose. Returns { ok, outcome: { money, rep, … }, won } */
  resolveIncident(choice) {
    const sim = this.sim;
    const inc = this.js.incident;
    if (!inc) return { ok: false, reason: 'contract_gone' };
    const def = INCIDENTS[inc.kind];
    const c = def.choices[choice];
    if (!c) return { ok: false, reason: 'contract_gone' };
    const p = sim.state.player;
    let out = { ...c };
    let won = null;
    if (c.win !== undefined) {
      won = hashStr(`incwin:${inc.id}:${choice}:${inc.day}`, sim.state.seed) < c.win;
      out = { ...c, ...(won ? c.good : c.bad) };
    }
    if (out.energy) sim.needs.spendEnergy(out.energy);
    if (out.health) p.health = Math.max(5, (p.health ?? 100) - out.health);
    if (out.money) {
      if (out.money > 0) p.money += out.money;
      else p.money = Math.max(0, p.money + out.money);
    }
    if (out.rep) sim.progression.addReputation(out.rep);
    if (out.item) for (const [item, q] of Object.entries(out.item)) {
      const emp = sim.economy.biz(inc.employer);
      if (emp) emp.stock[item] = (emp.stock[item] || 0) + q;
    }
    const npc = inc.npc && sim.npcs.byId(inc.npc);
    if (out.rel && npc) sim.social.addRel(npc, out.rel);
    if (out.rel && inc.building) for (const r of sim.npcs.residentsOf(inc.building)) sim.social.addRel(r, out.rel);
    if (out.relParent && npc) for (const pid of npc.kin?.parents || []) {
      const par = sim.npcs.byId(pid);
      if (par) sim.social.addRel(par, out.relParent);
    }
    const owner = this.npcOfEmployer(inc.employer);
    if (out.relOwner && owner) sim.social.addRel(owner, out.relOwner);
    if (out.caught) sim.chronicle('chronicle.player_caught_thief', {});
    this.js.incident = null;
    sim.bus.emit('player:changed');
    sim.bus.emit('jobs:changed');
    return { ok: true, outcome: out, won, kind: inc.kind, choice };
  },

  dismissIncident() {
    this.js.incident = null;
  },
};
