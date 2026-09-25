/**
 * WorkforceManager — one of your workers, appointed to run the rest (mixed into WorkerSystem).
 *
 * A manager is still a person in the world: they spend their working day walking round your
 * jobs — each contract's field, building or site in turn — and back to your base to plan
 * (tasks 'minspect' and 'mplan'). While they're at work, every hour (and at every visit) they:
 *
 *   schedule   look at the contracts you've taken on, the most pressing first (at risk of missing
 *              the deadline, then the soonest due, then the most important), and put the
 *              best-suited free workers on each until it has the hands it wants — one extra
 *              where it's at risk
 *   organize   take workers off a job that's stuck (nothing to fetch, nothing in stock, nothing
 *              done for hours) so they're not standing about, and move a hand from a job that's
 *              going well to one that's in trouble
 *   workforce  once a day: give workers a role that fits what they're good at, and note who's
 *              unhappy, unpaid or ill, and which jobs are late — in the manager's notes
 *
 * You're still the boss: a contract whose crew you chose yourself (c.manual) and a worker whose
 * role you set (roleBy 'player') are left as you had them. You can hand a contract back to the
 * manager, switch either of their duties off, or dismiss them.
 *
 *   state.workforce.manager = { npc, since, assign, roles, planned }   state.workforce.managerLog = [ … ]
 */
import { skillLevels } from './ContractPlanner.js';
import { STANDINGS } from '../data/contracting.js';

export const MANAGER = {
  minWorkers: 3, // the manager and at least two to manage
  minLevel: 2,
  minStanding: 'handyman', // you've a name as a contractor (or a company)
  payRise: 1.3, // a manager is paid more
  teamBonus: 0.05,
  inspectMinutes: 30,
  planMinutes: 45,
  pauseAfterPull: 180, // a job they pulled everyone off is left alone this long
  logSize: 24,
};

/** What each trade makes a worker (their role). */
const ROLE_OF = { farming: 'farm', building: 'build', forestry: 'gather_wood', mining: 'gather_stone', trade: 'haul', carpentry: 'workshop' };

export const WorkforceManager = {
  /** The manager's record (null if you have none). */
  mgr() {
    const M = this.state.manager;
    if (M && !this.contract(M.npc)) this.state.manager = null; // left your service
    return this.state.manager || null;
  },
  isManager(npcId) {
    return this.mgr()?.npc === npcId;
  },

  canAppoint(npcId) {
    const sim = this.sim;
    const c = this.contract(npcId);
    const npc = sim.npcs.byId(npcId);
    if (!c || !npc) return { ok: false, reason: 'not_your_worker' };
    if (this.isManager(npcId)) return { ok: false, reason: 'is_workforce_manager' };
    if (this.list().length < MANAGER.minWorkers) return { ok: false, reason: 'need_workers', params: { n: MANAGER.minWorkers } };
    const K = sim.contracts;
    const need = STANDINGS.findIndex((x) => x.id === MANAGER.minStanding);
    if (!K.S.company && STANDINGS.indexOf(K.rank()) < need) return { ok: false, reason: 'need_standing', params: { crank: MANAGER.minStanding } };
    if (npc.level < MANAGER.minLevel) return { ok: false, reason: 'need_npc_level', params: { level: MANAGER.minLevel } };
    return { ok: true };
  },

  /** Make this worker your manager (the one before goes back to the work). A rise goes with it. */
  appoint(npcId) {
    const chk = this.canAppoint(npcId);
    if (!chk.ok) return chk;
    const sim = this.sim;
    if (this.mgr()) this.dismissManager();
    const c = this.contract(npcId);
    const npc = sim.npcs.byId(npcId);
    sim.contracts.jobOf(npcId) && sim.contracts.assign(sim.contracts.jobOf(npcId).id, sim.contracts.jobOf(npcId).workers.filter((x) => x !== npcId), 'manager');
    this.state.manager = { npc: npcId, since: sim.time.day, assign: true, roles: true, planned: -1 };
    c.salary = Math.max(c.salary, Math.round(this.expectedSalary(npc, c.rank) * MANAGER.payRise));
    c.satisfaction = Math.min(100, c.satisfaction + 15);
    this.release(c);
    if (npc.task?.type === 'work') this.interrupt(npc, c);
    sim.memory.remember(npc, 'player_promoted', { who: 'player', params: { worker_rank: 'manager', gender: npc.gender } });
    sim.chronicle('chronicle.workforce_manager', { npc: npc.id, gender: npc.gender });
    this.note('appointed', { npc: npc.id });
    sim.toast('toast.manager_appointed', { npc: npc.id, money: c.salary }, 'good');
    sim.bus.emit('workers:changed');
    return { ok: true };
  },

  dismissManager() {
    const M = this.state.manager;
    if (!M) return;
    this.state.manager = null;
    const c = this.contract(M.npc);
    const npc = this.sim.npcs.byId(M.npc);
    if (c && npc) {
      this.release(c);
      if (npc.task?.type === 'work') this.interrupt(npc, c);
    }
    this.sim.bus.emit('workers:changed');
  },

  /** Switch a duty on or off: 'assign' (contracts) or 'roles'. */
  setDuty(duty, on) {
    const M = this.mgr();
    if (M) M[duty] = !!on;
    this.sim.bus.emit('workers:changed');
  },

  note(key, params = {}) {
    const log = (this.state.managerLog ??= []);
    const day = this.sim.time.day;
    // (The same note twice in a day is once.)
    if (log.some((x) => x.day === day && x.key === key && JSON.stringify(x.params) === JSON.stringify(params))) return;
    log.unshift({ day, hour: this.sim.time.hour, key, params });
    log.length = Math.min(log.length, MANAGER.logSize);
  },

  // ------------------------------------------------------------------ in the world: rounds and planning

  /** The manager's day: round the jobs (the least lately seen first), then back to base to plan. */
  managerTasks(npc, c, pos, add) {
    const sim = this.sim;
    const M = this.mgr();
    M.seen ??= {};
    const now = sim.time.total;
    const jobs = sim.contracts.S.active.filter((j) => sim.contracts.canDelegate(j));
    const next = jobs.map((j) => ({ j, at: M.seen[j.id] ?? -1 })).sort((a, b) => a.at - b.at)[0];
    if (next && now - next.at > 120) {
      const where = this.jobSpot(next.j);
      if (where) {
        add({ key: `minspect:${next.j.id}`, kind: 'minspect', cat: 'maintenance', target: next.j.id, contract: undefined, managed: true, tx: where.tx, ty: where.ty, cap: 1, urgent: 3000 });
        return;
      }
    }
    const b = this.baseDoor();
    add({ key: 'mplan', kind: 'mplan', cat: 'maintenance', target: 'base', managed: true, tx: b.tx, ty: b.ty, cap: 1, urgent: 3000 });
  },

  /** Where a job is, for the manager to go and look. */
  jobSpot(j) {
    const sim = this.sim;
    if (j.siteId && sim.construction.byId(j.siteId)) {
      const s = sim.construction.byId(j.siteId);
      return { tx: s.tx + Math.floor(s.w / 2), ty: s.ty + s.h + 1 };
    }
    const id = sim.contracts.location?.(j) || j.building;
    const b = sim.world.buildings[id];
    return b ? { tx: b.door.tx, ty: b.door.ty + 1 } : null;
  },

  // ------------------------------------------------------------------ the thinking

  /**
   * An hour's management (or a visit to a job): schedule, organize, and — once a day — roles and
   * notes. Only in working hours, while the manager's about: asleep, ill or away, nothing gets decided.
   */
  manage() {
    const sim = this.sim;
    const M = this.mgr();
    if (!M) return;
    const npc = sim.npcs.byId(M.npc);
    const hr = sim.time.hour;
    if (!npc || npc.away || hr < 6 || hr >= 19 || ['sleep', 'sick'].includes(npc.task?.type)) return; // (in working hours, when they're about)
    const K = sim.contracts;
    const now = sim.time.total;
    if (M.assign) {
      this.organize(M, K, now);
      this.schedule(M, K, now);
    }
    if (M.planned !== sim.time.day) {
      M.planned = sim.time.day;
      if (M.roles) this.giveRoles(M);
      this.notes(M, K);
    }
  },

  /** Workers free for a job: yours, not the manager, not on a job, not ill. */
  freeHands(K) {
    const busy = new Set(K.S.active.flatMap((j) => j.workers || []));
    return this.list().filter((w) => !this.isManager(w.npcId) && !busy.has(w.npcId) && w.state !== 'unavailable' && this.sim.npcs.byId(w.npcId)?.task?.type !== 'sick');
  },

  /** Jobs the manager may touch: not ones you crewed yourself. */
  managed(K) {
    return K.S.active.filter((j) => !j.manual && K.canDelegate(j));
  },

  /** Nobody standing about: off a job that's stuck; a hand from a job going well to one in trouble. */
  organize(M, K, now) {
    for (const j of this.managed(K)) {
      if (!j.workers?.length) continue;
      const stuck = K.blocker(j);
      // (Idle: hours into the working day with the crew on it, and nothing done.)
      const h = this.sim.time.hour;
      const idle = h >= 11 && h < 17 && now - (j.lastWork ?? j.acceptedAt ?? now) > 240 && now - (j.crewSince ?? now) > 240;
      if (stuck || idle) {
        K.assign(j.id, [], 'manager');
        j.pausedAt = now;
        this.note(stuck ? 'pulled_stuck' : 'pulled_idle', { ckind: j.kind, npc: j.issuer !== 'village' ? j.issuer : undefined });
      }
    }
  },

  /** The most pressing jobs first; the best-suited free hands on each (one more where it's at risk). */
  schedule(M, K, now) {
    const jobs = this.managed(K)
      .filter((j) => now - (j.pausedAt ?? -1e9) > MANAGER.pauseAfterPull && !K.blocker({ ...j, workers: ['?'] }))
      .map((j) => ({ j, risk: K.atRisk(j) }))
      .sort((a, b) => b.risk - a.risk || a.j.deadline - b.j.deadline || (b.j.priority ?? 0) - (a.j.priority ?? 0));
    for (const { j, risk } of jobs) {
      let want = K.recommended(j) + (risk ? 1 : 0) - (j.workers?.length || 0);
      if (want <= 0) continue;
      const field = K.fieldOf(j);
      // The best at this work first; then hands with no trade of their own; a specialist in some
      // other trade last (they're kept for work of their own kind).
      const fit = (w) => {
        const lvl = K.workerLevel(w.npcId, field);
        const npc = this.sim.npcs.byId(w.npcId);
        const best = npc ? skillLevels(this.sim, npc).sort((x, y) => y.comp - x.comp)[0] : null;
        const elsewhere = best && best.field !== field && best.level >= 1 && best.level > lvl;
        return lvl * 10 + (elsewhere ? -8 : 0);
      };
      const pool = this.freeHands(K).sort((a, b) => fit(b) - fit(a));
      const picks = pool.slice(0, want).map((w) => w.npcId);
      want -= picks.length;
      // Still short on a job at risk: a hand from one that's going well (it keeps at least one).
      if (want > 0 && risk) {
        const donor = K.S.active.filter((d) => d !== j && !d.manual && (d.workers?.length || 0) > 1 && !K.atRisk(d)).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
        if (donor) {
          const moved = donor.workers.slice().sort((a, b) => K.workerLevel(b, field) - K.workerLevel(a, field))[0];
          K.assign(donor.id, donor.workers.filter((x) => x !== moved), 'manager');
          picks.push(moved);
          this.note('moved', { npc: moved, ckind: j.kind });
        }
      }
      if (!picks.length) continue;
      K.assign(j.id, [...(j.workers || []), ...picks], 'manager');
      for (const id of picks) this.note('assigned', { npc: id, ckind: j.kind, building: this.sim.contracts.location?.(j) || j.building });
    }
  },

  /** A role for each worker that fits what they're good at (not the ones whose role you chose). */
  giveRoles(M) {
    for (const w of this.list()) {
      if (this.isManager(w.npcId) || w.roleBy === 'player') continue;
      const npc = this.sim.npcs.byId(w.npcId);
      if (!npc) continue;
      const best = skillLevels(this.sim, npc).sort((a, b) => b.comp - a.comp)[0];
      const role = best && best.level >= 1 ? ROLE_OF[best.field] || 'idle' : 'idle';
      if (role === 'workshop' && !this.sim.businesses.list().length) continue;
      if ((w.assignment?.type || 'idle') === role) continue;
      this.assign(w.npcId, { type: role }, 'manager');
      this.note('role', { npc: w.npcId, role });
    }
  },

  /** What the boss should know: unhappy, unpaid, ill — and jobs running late. */
  notes(M, K) {
    for (const w of this.list()) {
      if (w.satisfaction < 35) this.note('unhappy', { npc: w.npcId });
      if (w.unpaid > 0) this.note('unpaid', { npc: w.npcId });
      if (w.state === 'unavailable') this.note('ill', { npc: w.npcId });
    }
    for (const j of K.S.active) if (j.late) this.note('late', { ckind: j.kind, npc: j.issuer !== 'village' ? j.issuer : undefined });
  },
};
