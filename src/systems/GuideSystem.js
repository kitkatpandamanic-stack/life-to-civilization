/**
 * GuideSystem — a way into everything the game has, and something to aim for.
 *
 *   Getting started — chapters of steps (data/guide.js GUIDE), each measured from the world, so
 *                     doing things in another order still counts; the next one shows in the HUD
 *                     with an arrow to where it's done, and each gives a small reward, once.
 *   What next?      — advice from how things stand right now: hungry, workers standing idle, a site
 *                     waiting for materials, wages you can't pay tomorrow, a barrow nobody's using…
 *                     the most pressing first, each with a way straight to where it's dealt with.
 *   Paths           — careers to follow (contractor, transport, landlord, business, founder,
 *                     craftsman): ladders of milestones with bigger rewards. You follow one at a time.
 *
 *   state.guide = { done: { stepId: day }, path: null | id, miles: { 'path.milestone': day }, hidden }
 *
 * Ambitions (AmbitionSystem) stay what they were: goals to tick off in any order. A path is the
 * road to one of them, step by step.
 */
import { GUIDE, PATHS, ADVICE_PRIO as AP } from '../data/guide.js';
import { UNLOCKS } from '../data/unlocks.js';
import { EQUIP } from '../data/transport.js';

export class GuideSystem {
  constructor(sim) {
    this.sim = sim;
    // Steps are ticked off as they happen (every few minutes is plenty). A save from before the guide
    // existed gets its first check quietly — no shower of rewards for what was done long ago.
    const old = !sim.state.guide && (sim.time.day > 0 || sim.state.player.level > 1 || (sim.state.stats.jobsCompleted || 0) > 0);
    sim.state.guide ??= { done: {}, path: null, miles: {}, hidden: false };
    this.quiet = old;
    this.quietMiles = false;
    sim.bus.on('time:minute', (m) => m % 5 === 0 && this.check());
  }

  get S() {
    return this.sim.state.guide;
  }

  // ------------------------------------------------------------------ getting started

  steps() {
    return GUIDE.flatMap((ch) => ch.steps.map((s) => ({ ...s, chapter: ch.chapter })));
  }
  step(id) {
    return this.steps().find((s) => s.id === id) || null;
  }
  isDone(id) {
    return this.S.done[id] !== undefined;
  }
  /** Can it be done yet? (Some steps wait for the level that opens them.) */
  available(step) {
    return !step.need || this.sim.progression.hasUnlock(step.need);
  }
  needLevel(step) {
    return step.need ? UNLOCKS.find((u) => u.key === step.need)?.level || 1 : 1;
  }

  /** The step to do next: the first not done that can be done now — or, if the rest must wait, the next of those. */
  current() {
    const list = this.steps().filter((s) => !this.isDone(s.id));
    if (!list.length) return null;
    const now = list.find((s) => this.available(s));
    if (now) return { step: now, locked: false };
    return { step: list[0], locked: true, level: this.needLevel(list[0]) };
  }

  /** How far through: steps done out of all. */
  progress() {
    const all = this.steps();
    return { done: all.filter((s) => this.isDone(s.id)).length, total: all.length };
  }

  /** Has anything been done? (Measured from the world.) Rewards once for each. */
  check() {
    const quiet = this.quiet;
    const quietMiles = quiet || this.quietMiles;
    this.quiet = false;
    this.quietMiles = false;
    for (const s of this.steps()) {
      if (this.isDone(s.id)) continue;
      let ok = false;
      try {
        ok = s.done(this.sim);
      } catch {
        ok = false;
      }
      if (ok) this.complete(s, quiet);
    }
    const path = this.S.path && PATHS[this.S.path];
    if (path) {
      for (const m of path.milestones) {
        const k = `${this.S.path}.${m.id}`;
        if (this.S.miles[k] !== undefined) continue;
        const [v, target] = m.measure(this.sim);
        if (v >= target) this.reachMilestone(this.S.path, m, quietMiles);
      }
    }
  }

  complete(step, quiet = false) {
    const sim = this.sim;
    this.S.done[step.id] = sim.time.day;
    if (quiet) return; // (done before the guide was there: noted, no fuss)
    const r = step.reward || {};
    if (r.money) sim.state.player.money += r.money;
    if (r.xp) sim.progression.addXp(r.xp);
    sim.toast('toast.guide_step', { step: step.id, money: r.money || 0, n: r.xp || 0 }, 'good');
    sim.bus.emit('guide:changed');
  }

  hide(v = !this.S.hidden) {
    this.S.hidden = !!v;
    this.sim.bus.emit('guide:changed');
  }

  // ------------------------------------------------------------------ paths

  choosePath(id) {
    if (id && !PATHS[id]) return false;
    this.S.path = id || null;
    this.quietMiles = true; // (milestones already reached count, quietly)
    this.check();
    this.sim.bus.emit('guide:changed');
    return true;
  }

  /** A path's milestones: done, the next one (with progress), and the ones after. */
  pathProgress(id = this.S.path) {
    const P = PATHS[id];
    if (!P) return null;
    let next = null;
    const list = P.milestones.map((m) => {
      const [v, target] = m.measure(this.sim);
      const done = this.S.miles[`${id}.${m.id}`] !== undefined;
      const row = { id: m.id, value: Math.min(v, target), target, done, reward: m.reward };
      if (!done && !next) next = row;
      return row;
    });
    return { id, icon: P.icon, list, next, done: list.filter((x) => x.done).length };
  }

  reachMilestone(pathId, m, quiet = false) {
    const sim = this.sim;
    this.S.miles[`${pathId}.${m.id}`] = sim.time.day;
    if (quiet) return;
    const r = m.reward || {};
    if (r.money) sim.state.player.money += r.money;
    if (r.xp) sim.progression.addXp(r.xp);
    if (r.rep) sim.progression.addReputation(r.rep);
    sim.chronicle('chronicle.path_milestone', { path: pathId, milestone: `${pathId}.${m.id}` });
    sim.toast('toast.path_milestone', { path: pathId, milestone: `${pathId}.${m.id}`, n: r.xp || 0 }, 'good');
    sim.bus.emit('guide:changed');
  }

  // ------------------------------------------------------------------ the HUD and the arrow

  /** What the HUD shows when there's no job or contract to follow: the next step, or the best advice. */
  objective() {
    const cur = !this.S.hidden && this.current();
    if (cur && !cur.locked) {
      let where = null;
      try {
        where = cur.step.where?.(this.sim) || null;
      } catch {
        where = null;
      }
      const TS = 32;
      return { kind: 'step', step: cur.step, key: `guide.step.${cur.step.id}.hint`, params: {}, target: where ? { x: where.tx * TS + TS / 2, y: where.ty * TS + TS / 2 } : null, open: cur.step.open };
    }
    const a = this.advice(1)[0];
    if (a && a.prio >= AP.materials) return { kind: 'advice', advice: a, key: `advice.${a.id}`, params: a.params, target: null, open: a.go };
    const pp = this.S.path && this.pathProgress();
    if (pp?.next) return { kind: 'path', key: `path.${pp.id}.m.${pp.next.id}`, params: {}, progress: pp.next, target: null, open: 'paths' };
    return null;
  }

  // ------------------------------------------------------------------ what next?

  /**
   * Advice from how things stand: [{ id, icon, prio, params, go }] — the most pressing first.
   * go: where the button takes you ('workers', 'contracts', 'orders', { site }, { equipment }…).
   */
  advice(max = 6) {
    const sim = this.sim;
    const p = sim.state.player;
    const W = sim.workers;
    const C = sim.construction;
    const E = sim.equipment;
    const K = sim.contracts;
    const out = [];
    const add = (id, prio, icon, params = {}, go = null) => out.push({ id, prio, icon, params, go });
    // You.
    if (p.hunger < 25) add('eat', AP.danger, '🍞', {}, 'inventory');
    if (p.energy < 15) add('sleep', AP.danger - 2, '😴');
    if (p.health < 35) add('health', AP.danger - 1, '❤️');
    if ((p.rent?.debt || 0) > 0) add('rent', AP.money + 5, '🏠', { money: p.rent.debt });
    // Your people.
    const list = W.list();
    const payroll = list.reduce((s, c) => s + c.salary, 0);
    if (list.length && p.money < payroll) add('payroll', AP.money, '💸', { money: payroll }, 'workers');
    const now = sim.time.total;
    const idle = list.filter((c) => (c.state === 'waiting' || c.state === 'need_materials') && now - (c.stateSince ?? now) >= 90);
    if (idle.length) add('idle_workers', AP.workers, '⏳', { n: idle.length }, 'workers');
    // Sites waiting for materials nobody has.
    for (const s of C.sites().filter((x) => C.isPlayers(x) || x.supplier === 'player')) {
      if (C.siteState(s) !== 'waiting_materials') continue;
      const short = Object.keys(C.missing(s)).filter((i) => sim.home.storageCount(i) <= 0);
      if (short.length) add('site_waiting', AP.materials, '📦', { item: short[0], n: short.length }, { site: s.id });
    }
    // Contracts.
    for (const c of K.S.active || []) if (K.atRisk?.(c)) add('contract_risk', AP.contract, '⚠️', { ckind: c.kind }, 'contracts');
    if ((K.S.offers || []).length && (K.S.active || []).length < K.maxActive()) add('offers', AP.opportunity + 5, '📜', { n: K.S.offers.length }, 'contracts');
    // Equipment.
    if (E) {
      const free = E.mine().filter((e) => !e.holder && E.usable(e) && e.at.kind === 'ground');
      const handless = list.filter((c) => !E.assignedTo(c.npcId));
      if (free.length && handless.length) add('lend', AP.equipment, '🛒', { eq: free[0].type }, { equipment: { lend: free[0].id } });
      const worn = E.mine().filter((e) => e.condition < EQUIP.damagedBelow && !E.underRepair(e));
      if (worn.length) add('repair_eq', AP.equipment - 2, '🔧', { eq: worn[0].type }, { equipment: { focus: worn[0].id } });
      if (list.length >= 2 && !E.mine().length) add('get_equipment', AP.opportunity, '🛒', {}, 'equipment');
    }
    // Your buildings falling apart.
    const bad = Object.entries(sim.property.all).find(([id, r]) => r.owner === 'player' && !r.ruined && (r.condition ?? 100) < 40 && sim.world.buildings[id]);
    if (bad) add('repair_building', AP.materials - 5, '🏚️', { building: bad[0] }, { property: bad[0] });
    // What you could do now that you couldn't before.
    const has = (k) => sim.progression.hasUnlock(k);
    if (has('hire_worker') && !list.length) add('can_hire', AP.opportunity, '👷', {}, 'workers');
    if (has('buy_land') && !(sim.land.owned?.length || 0)) add('can_buy_land', AP.opportunity - 2, '🗺️', {}, 'map');
    if (has('construction') && (sim.land.owned?.length || 0) && !C.list.some((c) => C.isPlayers(c) && c.kind === 'building')) add('can_build', AP.opportunity - 1, '🏗️', {}, 'build');
    if (list.length >= 2 && !(W.state.orders || []).length && sim.home.storage.length) add('try_orders', AP.opportunity - 6, '🔁', {}, 'orders');
    if (list.length >= 3 && !W.mgr?.() && W.canAppoint?.(list[0].npcId)?.ok) add('manager', AP.opportunity - 8, '🧑‍💼', {}, 'workers');
    // A festival on the square (or tomorrow): join in.
    const F = sim.festivals;
    if (F?.active() && !F.S.current.attended) add('festival_now', AP.opportunity + 12, '🎉', { festival: F.S.current.id });
    else if (F && !F.active()) {
      const nx = F.next();
      if (nx && nx.days === 1) add('festival_soon', AP.opportunity - 4, '🎉', { festival: nx.id });
    }
    // The guide and your path.
    const cur = this.current();
    if (cur && !cur.locked && !this.S.hidden) add('guide', AP.guide, cur.step.icon, { step: cur.step.id }, cur.step.open || 'guide');
    else if (cur?.locked && !this.S.hidden) add('guide_locked', AP.guide - 5, '🔒', { step: cur.step.id, level: cur.level }, 'guide');
    const pp = this.S.path && this.pathProgress();
    if (pp?.next) add('path', AP.guide - 1, pp.icon, { path: pp.id, milestone: `${pp.id}.${pp.next.id}`, n: pp.next.value, max: pp.next.target }, 'paths');
    else if (!this.S.path && this.isDone('hire')) add('choose_path', AP.guide - 2, '🧭', {}, 'paths');
    return out.sort((a, b) => b.prio - a.prio).slice(0, max);
  }
}
