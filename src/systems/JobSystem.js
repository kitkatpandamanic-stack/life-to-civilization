/**
 * JobSystem — work the player takes on for village businesses, plus
 * favour requests from villagers.
 *
 * Openings are posted every morning (and topped up at midday) and depend on the simulation:
 *   • the employer must exist and be able to afford your pay — the starting
 *     businesses, and (employerType) whichever bakery, carpenter's, warehouse…
 *     the villagers have opened
 *   • farm harvesting needs ripe crops (none in winter)
 *   • seasonal jobs only exist in their season
 *   • hauling needs a building site in the village that's short of the material
 *
 * Active job stages:
 *   harvest:  collect (harvest crops on the farm) → deliver (to the farmhouse)
 *   deliver:  collect (gather anywhere)            → deliver (to the employer)
 *   courier:  pickup (at the employer)             → deliver (to a house)
 *   rounds:   pickup (letters at the employer)     → deliver (one to each of several houses)
 *   haul:     pickup (materials at the employer)   → deliver (to a building site)
 *   shift:    go (to the workplace)                → working (time fast-forwards)
 *   outing:   go (to a place in the woods/fields)  → working → deliver (what you gathered, if anything)
 *   plant:    pickup (saplings at the employer)    → planting (each one counts; done when all are in)
 *
 * Pay (JOB_PAY): the rate × a seasonal rush × your charm and negotiation × your rank in the job (how often
 * you've done it) × what you bargained for × the labour market (short of hands: more — PopulationSystem).
 * Bring more than asked for a delivery and each extra unit is paid too (piece pay); finish a delivery quickly
 * for a premium; customers tip at the barber's and the tavern. Hourly jobs: you choose how long.
 * One more job can be lined up for when this one's done (two jobs a day). The village itself hires too
 * (lamps, the night watch, graves, wells…), paid from its treasury.
 */
import { BALANCE } from '../config/balance.js';
import { JOBS, JOB_REFRESH, JOB_PAY } from '../data/jobs.js';
import { ITEMS } from '../data/items.js';
import { REQUEST_TEMPLATES } from '../data/requests.js';
import { traitValue } from '../data/traits.js';
import { rand, hashStr } from '../core/rng.js';
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';
import { Mod, skill, attr } from './Modifiers.js';

/** What you gather for each kind of delivery (for the objective arrow). */
const RESOURCE_OF = { wood: 'tree', stone: 'rock', berries: 'bush' };

export class JobSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.jobs.employers ??= {};
    sim.state.jobs.bargains ??= {};
    sim.state.jobs.queued ??= null;
    sim.state.player.jobStats ??= {};
    sim.bus.on('time:hour', (h) => {
      if (h === BALANCE.jobs.refreshHour) this.refresh();
      if (h === JOB_REFRESH.middayHour) this.topUp();
      if (h === 7) this.generateRequests();
      this.tryQueued();
    });
    sim.bus.on('time:day', () => this.onNewDay());
    sim.bus.on('inventory:changed', () => this.updateStage());
    sim.bus.on('player:action', (a) => this.onPlayerAction(a));
  }

  get js() {
    return this.sim.state.jobs;
  }
  get active() {
    return this.js.active;
  }
  def(jobId) {
    return JOBS[jobId];
  }

  /** Who's hiring for this job today: a fixed business, the village itself, or one of its type the village has. */
  employerOf(jobId) {
    const d = JOBS[jobId];
    const E = this.sim.economy;
    if (d.employer === 'village') return this.sim.world.buildings.hall ? 'village' : null;
    if (d.employer) return E.biz(d.employer) && !E.biz(d.employer).closed ? d.employer : null;
    const chosen = this.js.employers[jobId];
    if (chosen && E.biz(chosen) && !E.biz(chosen).closed) return chosen;
    return this.pickEmployer(jobId);
  }

  /** Of the businesses of this type, the one best able to pay. */
  pickEmployer(jobId) {
    const E = this.sim.economy;
    const list = E.ofType(JOBS[jobId].employerType || '').filter((id) => !E.biz(id).closed && E.biz(id).owner !== 'player');
    return list.sort((a, b) => E.biz(b).money - E.biz(a).money)[0] || null;
  }

  employerBuilding(jobId) {
    return this.buildingOfEmployer(this.employerOf(jobId));
  }
  employerNpc(jobId) {
    return this.npcOfEmployer(this.employerOf(jobId));
  }
  buildingOfEmployer(id) {
    if (id === 'village') return this.sim.world.buildings.hall || null;
    return id ? this.sim.economy.buildingOf(id) : null;
  }
  /** Who you answer to: the business's owner — or, for the village's work, the headman. */
  npcOfEmployer(id) {
    if (id === 'village') {
      const h = this.sim.civic?.headman();
      return h && h !== 'player' ? h : null;
    }
    return id ? this.sim.economy.owner(id) : null;
  }

  /** What the employer can pay out: a business's till, or the village treasury (less a little it keeps back). */
  funds(emp) {
    if (emp === 'village') return Math.max(0, (this.sim.state.village?.treasury || 0) - JOB_PAY.villageReserve);
    return Math.max(0, this.sim.economy.biz(emp)?.money || 0);
  }
  payOut(emp, n) {
    if (n <= 0) return;
    if (emp === 'village') this.sim.state.village.treasury -= n;
    else {
      const b = this.sim.economy.biz(emp);
      if (b) b.money -= n;
    }
  }

  /** Is there call for this job today? (A gravedigger when someone has died, a midwife's help after a birth…) */
  condition(key) {
    const sim = this.sim;
    const day = sim.time.day;
    switch (key) {
      case 'funeral':
        return sim.state.graveyard.some((g) => day - g.died <= 2);
      case 'newborn':
        return sim.state.npcs.some((n) => n.born !== undefined && day - n.born <= 2);
      case 'sick':
        return sim.state.npcs.some((n) => (n.health ?? 100) < 50);
      case 'children':
        return sim.state.npcs.filter((n) => n.age >= 6 && n.age < 16).length >= 2;
      case 'well_needed':
        return !!sim.growth?.streetWithoutWell();
      case 'sites':
        return sim.construction.sites().some((c) => c.kind === 'building' && !sim.construction.isPlayers(c));
      case 'settlements':
        return (sim.settlements?.known().length || 0) > 0;
      default:
        return true;
    }
  }

  ensureOpenings() {
    if (this.js.lastRefreshDay !== this.sim.time.day) this.refresh();
  }

  /** A building site in the village that needs this material (for hauling jobs). */
  siteNeeding(item) {
    const C = this.sim.construction;
    return C.sites()
      .filter((c) => c.kind === 'building' && !C.isPlayers(c) && (C.missing(c)[item] || 0) >= 3)
      .sort((a, b) => (C.missing(b)[item] || 0) - (C.missing(a)[item] || 0))[0] || null;
  }

  /** Does this job exist today, according to the simulation? */
  existsToday(jobId) {
    const d = JOBS[jobId];
    const E = this.sim.economy;
    const emp = this.employerOf(jobId);
    if (!emp) return false;
    if (d.seasons && !d.seasons.includes(this.sim.time.season)) return false;
    if (this.funds(emp) < (d.hourly ? d.perHour * d.hourly[0] : d.pay)) return false;
    if (d.when && !this.condition(d.when)) return false;
    if (d.type === 'harvest' && this.sim.resources.countRipeCrops() < d.qty) return false;
    if (d.type === 'plant') {
      const b = this.employerBuilding(jobId);
      if (!b || !this.sim.forestry?.spotsNear(b.door.tx, b.door.ty, 40, 1).length) return false;
    }
    if (d.type === 'haul' && (!this.siteNeeding(d.item) || E.stock(emp, d.item) < 3)) return false;
    return true;
  }

  refresh() {
    for (const id of Object.keys(JOBS)) if (JOBS[id].employerType) this.js.employers[id] = this.pickEmployer(id);
    for (const [id, d] of Object.entries(JOBS)) this.js.openings[id] = this.existsToday(id) ? this.slots(d) : 0;
    this.js.lastRefreshDay = this.sim.time.day;
    this.sim.bus.emit('jobs:changed');
  }

  /** Midday: more work comes in (half of the morning's openings again, where they've been taken). */
  topUp() {
    for (const [id, d] of Object.entries(JOBS)) {
      if (!this.existsToday(id)) continue;
      const extra = Math.max(1, Math.round(this.slots(d) * JOB_REFRESH.middayShare));
      this.js.openings[id] = Math.min(this.slots(d), (this.js.openings[id] || 0) + extra);
    }
    this.sim.bus.emit('jobs:changed');
  }

  jobsForBusiness(bizId) {
    return Object.keys(JOBS).filter((id) => this.employerOf(id) === bizId);
  }

  /** A seasonal rush (the autumn harvest): { slots, pay } in force now, or null. */
  rushOf(d) {
    return d.rush && d.rush.season === this.sim.time.season ? d.rush : null;
  }

  /** Is any rush on today (with work open)? */
  rushOn() {
    return Object.entries(JOBS).some(([id, d]) => this.rushOf(d) && (this.js.openings[id] || 0) > 0);
  }

  /** Openings a day (more in a rush). */
  slots(d) {
    return d.dailySlots + (this.rushOf(d)?.slots || 0);
  }

  /**
   * What this job pays: the rate (per hour for hourly work, per tree for planting) × the rush × your charm
   * and negotiation × your rank in it × what you bargained for × the labour market.
   * opts.hours (hourly work), opts.job (the one you're doing: its bargain and hours are fixed).
   */
  pay(jobId, opts = {}) {
    const d = JOBS[jobId];
    const job = opts.job || (this.active?.jobId === jobId ? this.active : null);
    const owner = this.npcOfEmployer(job?.employer || this.employerOf(jobId));
    const base = d.hourly ? d.perHour * (opts.hours ?? job?.hours ?? d.durationHours) : d.type === 'plant' ? d.piece * (opts.trees ?? d.qty) : d.pay;
    const bargain = job ? job.bargain || 1 : this.bargainMult(jobId);
    return Math.round(base * (this.rushOf(d)?.pay || 1) * Mod.payMult(this.sim.state.player, d) * (owner ? this.sim.social.payBonus(owner) : 1) * this.rankMult(jobId) * bargain * (this.sim.population?.wageFactor() ?? 1));
  }

  // ---------- Ranks: the more you've done a job, the better you're paid at it ----------

  timesDone(jobId) {
    return this.sim.state.player.jobStats?.[jobId] || 0;
  }
  rankOf(jobId) {
    const n = this.timesDone(jobId);
    return [...JOB_PAY.ranks].reverse().find((r) => n >= r.from);
  }
  rankMult(jobId) {
    return this.rankOf(jobId).mult;
  }
  /** Jobs to go until the next rank (null at the top). */
  toNextRank(jobId) {
    const n = this.timesDone(jobId);
    const next = JOB_PAY.ranks.find((r) => r.from > n);
    return next ? { rank: next.id, left: next.from - n } : null;
  }

  // ---------- Bargaining: ask for more before you start (once a day for each job) ----------

  bargainState(jobId) {
    const b = this.js.bargains?.[jobId];
    return b && b.day === this.sim.time.day ? b : null;
  }
  bargainMult(jobId) {
    return this.bargainState(jobId)?.mult || 1;
  }
  /** How likely they are to agree: how well they know and like you, your standing and your way with words. */
  bargainChance(jobId) {
    const p = this.sim.state.player;
    const owner = this.employerNpc(jobId);
    const rankIdx = JOB_PAY.ranks.indexOf(this.rankOf(jobId));
    let c = JOB_PAY.bargainBase + skill(p, 'negotiation') * 0.04 + attr(p, 'charisma') * 0.02 + Math.min(0.2, (p.reputation || 0) / 100) + rankIdx * 0.06;
    if (owner) {
      c += (owner.rel || 0) / 250;
      if (owner.traits?.includes('greedy')) c -= 0.15;
      if (owner.traits?.includes('generous')) c += 0.1;
    }
    // Short of hands in the valley: they can't afford to lose you.
    c += ((this.sim.population?.wageFactor() ?? 1) - 1) * 1.5;
    return Math.max(0.05, Math.min(0.9, c));
  }
  canBargain(jobId) {
    if (this.bargainState(jobId)) return { ok: false, reason: 'already_bargained' };
    if (this.active?.jobId === jobId) return { ok: false, reason: 'job_is_active' };
    if (!this.employerOf(jobId)) return { ok: false, reason: 'no_employer', params: { biz_type: JOBS[jobId].employerType } };
    if ((this.js.openings[jobId] || 0) <= 0) return { ok: false, reason: 'no_openings' };
    return { ok: true };
  }
  /** Returns { ok, result: 'yes' | 'half' | 'no', pay }. No dice: it follows the day and the job. */
  bargain(jobId) {
    const chk = this.canBargain(jobId);
    if (!chk.ok) return chk;
    const day = this.sim.time.day;
    const r = hashStr(`bargain:${jobId}:${day}`, this.sim.state.seed);
    const c = this.bargainChance(jobId);
    const result = r < c ? 'yes' : r < c + 0.2 ? 'half' : 'no';
    const mult = result === 'yes' ? 1 + JOB_PAY.bargainUp : result === 'half' ? 1 + JOB_PAY.bargainHalf : 1;
    this.js.bargains[jobId] = { day, mult, result };
    this.sim.progression.addSkillXp('negotiation', 6);
    const owner = this.employerNpc(jobId);
    if (result === 'no' && owner) this.sim.social.addRel(owner, -1);
    const pay = this.pay(jobId);
    this.sim.toast(`toast.bargain_${result}`, { job: jobId, money: pay }, result === 'no' ? 'warn' : 'good');
    this.sim.bus.emit('jobs:changed');
    return { ok: true, result, pay };
  }

  /** Can the player accept this job right now? Returns { ok, reason, params }. */
  check(jobId, { ignoreActive = false, ignoreOpenings = false } = {}) {
    const d = JOBS[jobId];
    const p = this.sim.state.player;
    const r = d.requires || {};
    const h = this.sim.time.hour;
    if (this.active?.jobId === jobId) return { ok: false, reason: 'job_is_active' };
    if (this.active && !ignoreActive) return { ok: false, reason: 'job_active' };
    if (!this.employerOf(jobId)) return { ok: false, reason: 'no_employer', params: { biz_type: d.employerType } };
    if (d.seasons && !d.seasons.includes(this.sim.time.season)) return { ok: false, reason: 'wrong_season' };
    if (!ignoreOpenings && (this.js.openings[jobId] || 0) <= 0) return { ok: false, reason: 'no_openings' };
    if (r.level && p.level < r.level) return { ok: false, reason: 'need_level', params: { level: r.level } };
    if (r.reputation && p.reputation < r.reputation) return { ok: false, reason: 'need_reputation', params: { value: r.reputation } };
    if (r.skill && skill(p, r.skill.id) < r.skill.level) return { ok: false, reason: 'need_skill', params: { skill: r.skill.id, level: r.skill.level } };
    for (const [a, v] of Object.entries(r.attributes || {})) {
      if (attr(p, a) < v) return { ok: false, reason: 'need_attribute', params: { attr: a, value: v } };
    }
    if (r.tool && !this.sim.inventory.bestTool(r.tool)) return { ok: false, reason: `need_${r.tool}` };
    if (h < d.hours[0]) return { ok: false, reason: 'too_early', params: { hour: d.hours[0] } };
    if (h >= d.hours[1]) return { ok: false, reason: 'too_late', params: { hour: d.hours[1] } };
    return { ok: true };
  }

  /** Homes of real villagers (for couriers and letters). */
  homes() {
    return [...new Set(this.sim.state.npcs.map((n) => n.homeId))].filter((h) => h && (h.startsWith('house_') || h.startsWith('vb') || h === 'farmhouse' || h === 'hall') && this.sim.world.buildings[h]);
  }

  /** opts.hours: how long (hourly work). opts.reserved: the opening was already set aside (a lined-up job). */
  accept(jobId, opts = {}) {
    const c = this.check(jobId, { ignoreOpenings: !!opts.reserved });
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const d = JOBS[jobId];
    const job = { jobId, type: d.type, item: d.item || null, qty: d.qty || 0, harvested: 0, acceptedDay: this.sim.time.day, acceptedAt: this.sim.time.total, stage: 'collect', target: null, employer: this.employerOf(jobId), bargain: this.bargainMult(jobId) };
    if (d.type === 'courier' || d.type === 'rounds' || d.type === 'haul' || d.type === 'plant') job.stage = 'pickup';
    if (d.type === 'shift' || d.type === 'outing') job.stage = 'go';
    if (d.hourly) job.hours = Math.max(d.hourly[0], Math.min(d.hourly[1], Math.round(opts.hours ?? d.durationHours)));
    // Lamps to light, chimneys to sweep: nothing to pick up first.
    if (d.type === 'rounds' && d.roundsKind) job.stage = 'deliver';
    if (d.type === 'plant') job.planted = 0;
    if (d.type === 'outing') {
      job.place = this.placeFor(jobId);
      if (!job.place) {
        this.sim.toast('reason.no_openings', {}, 'warn');
        return false;
      }
    }
    if (d.type === 'courier') {
      // Deliver to a real villager's home (not the employer).
      job.target = rand.pick(this.homes());
    }
    if (d.type === 'rounds') {
      // Letters for several different houses: a walk round the village.
      const homes = this.homes().filter((h) => h !== this.employerBuilding(jobId)?.id);
      job.targets = [];
      while (job.targets.length < d.qty && homes.length) job.targets.push(homes.splice(rand.int(0, homes.length - 1), 1)[0]);
      job.qty = job.targets.length;
    }
    if (d.type === 'haul') {
      const site = this.siteNeeding(d.item);
      if (!site) {
        this.sim.toast('reason.no_openings', {}, 'warn');
        return false;
      }
      job.target = site.id;
      job.qty = Math.min(d.qty, this.sim.construction.missing(site)[d.item]);
    }
    if (!opts.reserved) this.js.openings[jobId]--;
    this.js.active = job;
    const owner = this.employerNpc(jobId);
    if (owner) this.sim.social.meet(owner);
    this.updateStage();
    this.sim.toast('toast.job_accepted', { job: jobId }, 'good');
    this.sim.bus.emit('jobs:changed');
    return true;
  }

  /** The business this active job is for (fixed when you took it). */
  jobEmployer(job = this.active) {
    return job?.employer || (job && this.employerOf(job.jobId));
  }
  jobBuilding(job = this.active) {
    return this.buildingOfEmployer(this.jobEmployer(job));
  }

  // ---------- Two jobs: line one up for when this one's done ----------

  canQueue(jobId) {
    if (!this.active) return { ok: false, reason: 'no_active_job' };
    if (this.js.queued) return { ok: false, reason: 'queue_full' };
    const c = this.check(jobId, { ignoreActive: true });
    // Its hours may not have come yet: that's the point of lining it up.
    if (!c.ok && c.reason !== 'too_early') return c;
    return { ok: true };
  }
  queue(jobId, opts = {}) {
    const chk = this.canQueue(jobId);
    if (!chk.ok) {
      this.sim.toast(`reason.${chk.reason}`, chk.params || {}, 'warn');
      return false;
    }
    this.js.openings[jobId]--;
    this.js.queued = { jobId, hours: opts.hours ?? null, day: this.sim.time.day };
    this.sim.toast('toast.job_queued', { job: jobId }, 'good');
    this.sim.bus.emit('jobs:changed');
    return true;
  }
  unqueue() {
    const q = this.js.queued;
    if (!q) return;
    if (q.day === this.sim.time.day) this.js.openings[q.jobId] = (this.js.openings[q.jobId] || 0) + 1;
    this.js.queued = null;
    this.sim.bus.emit('jobs:changed');
  }
  /** The job you lined up starts once you're free (and its hours have come). */
  tryQueued() {
    const q = this.js.queued;
    if (!q || this.active) return;
    if (q.day !== this.sim.time.day) {
      this.js.queued = null;
      this.sim.bus.emit('jobs:changed');
      return;
    }
    const c = this.check(q.jobId, { ignoreOpenings: true });
    if (!c.ok && c.reason === 'too_early') return;
    this.js.queued = null;
    if (!c.ok) {
      this.sim.toast('toast.queued_dropped', { job: q.jobId }, 'warn');
      this.sim.bus.emit('jobs:changed');
      return;
    }
    this.accept(q.jobId, { hours: q.hours ?? undefined, reserved: true });
  }

  // ---------- Outings: work out in the woods and fields ----------

  /** Where an outing is: somewhere of its kind near the employer, chosen by the day (no dice). */
  placeFor(jobId) {
    const sim = this.sim;
    const w = sim.world;
    const d = JOBS[jobId];
    const base = this.employerBuilding(jobId)?.door || { tx: 46, ty: 40 };
    const h = hashStr(`place:${jobId}:${sim.time.day}`, sim.state.seed);
    const pick = (list) => (list.length ? list[Math.floor(h * list.length)] : null);
    const near = (list, n = 10) => list.sort((a, b) => Math.abs(a.tx - base.tx) + Math.abs(a.ty - base.ty) - (Math.abs(b.tx - base.tx) + Math.abs(b.ty - base.ty)) || a.tx - b.tx || a.ty - b.ty).slice(0, n);
    let spot = null;
    if (d.place === 'forest' || d.place === 'pines') {
      const trees = Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'grown' && o.variant !== 'apple' && (d.place !== 'pines' || o.variant === 'pine') && sim.nature.forestAround(o.tx, o.ty, 3) >= 4);
      spot = pick(near(trees.map((o) => ({ tx: o.tx, ty: o.ty + 1 })), 12));
    } else if (d.place === 'clearing') {
      const c = pick(AREAS.clearings || []);
      spot = c ? { tx: Math.round((c.x1 + c.x2) / 2), ty: Math.round((c.y1 + c.y2) / 2) } : null;
    } else {
      // Meadows (flowers), pasture (open grass by the farm), far off (a day's walk out, for the guide).
      const want = d.place === 'meadow' ? [T.FLOWERS] : [T.GRASS, T.GRASS2, T.GRASS3];
      const cands = [];
      for (let ty = 2; ty < w.H - 2; ty += 3) {
        for (let tx = 2; tx < w.W - 2; tx += 3) {
          if (!want.includes(w.tileAt(tx, ty)) || w.isBlocked(tx, ty)) continue;
          const dd = Math.abs(tx - base.tx) + Math.abs(ty - base.ty);
          if (d.place === 'far' ? dd >= 45 : d.place === 'pasture' ? dd <= 16 && dd >= 4 : true) cands.push({ tx, ty });
        }
      }
      spot = pick(d.place === 'far' ? cands : near(cands, 12));
    }
    if (!spot) return null;
    const ok = w.isBlocked(spot.tx, spot.ty) ? w.nearestWalkable(spot.tx, spot.ty, 4) : spot;
    return ok ? { tx: ok.tx, ty: ok.ty } : null;
  }

  /** Close enough to the place to start work there? */
  atOutingPlace(tx, ty) {
    const job = this.active;
    return !!job && job.type === 'outing' && job.stage === 'go' && !!job.place && Math.abs(job.place.tx - tx) <= 2 && Math.abs(job.place.ty - ty) <= 2;
  }
  canStartOuting() {
    const job = this.active;
    if (!job || job.type !== 'outing' || job.stage !== 'go') return { ok: false, reason: 'nothing_here' };
    const d = JOBS[job.jobId];
    if (this.sim.state.player.energy < (d.energy || 0) * 0.5) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }
  /** Returns minutes (the scene fast-forwards the clock). */
  startOuting() {
    const job = this.active;
    job.stage = 'working';
    this.sim.bus.emit('jobs:changed');
    return JOBS[job.jobId].durationHours * 60;
  }
  /** What the hours out there gave: honey, mushrooms, resin, charcoal — then carry it back. */
  finishOuting() {
    const job = this.active;
    if (!job) return;
    const d = JOBS[job.jobId];
    this.sim.needs.spendEnergy(d.energy || 0);
    if (!d.yield) return this.complete();
    const [a, b] = d.yield.qty;
    const p = this.sim.state.player;
    const bonus = Math.floor(skill(p, d.skill || 'foraging') / 3);
    const got = a + Math.floor(hashStr(`yield:${job.jobId}:${job.acceptedAt}`, this.sim.state.seed) * (b - a + 1)) + bonus;
    this.sim.inventory.add(d.yield.item, got, { force: true });
    job.item = d.yield.item;
    job.qty = a;
    job.stage = 'deliver';
    this.sim.toast('toast.outing_gathered', { qty: got, item: d.yield.item }, 'good');
    this.sim.bus.emit('jobs:changed');
  }

  // ---------- Tree planting ----------

  /** You planted a tree (ForestrySystem): on the common woods it counts for the planting job. */
  plantedOne({ item, own }) {
    const job = this.active;
    if (!job || job.type !== 'plant' || job.stage !== 'planting' || item !== job.item || own) return;
    job.planted++;
    if (job.planted >= job.qty) return this.complete();
    this.sim.toast('toast.tree_planted_job', { n: job.planted, qty: job.qty }, 'info');
    this.sim.bus.emit('jobs:changed');
  }

  updateStage() {
    const job = this.active;
    if (!job || (job.type !== 'deliver' && job.type !== 'harvest')) return;
    const have = this.sim.inventory.count(job.item);
    const ready = job.type === 'harvest' ? job.harvested >= job.qty && have >= job.qty : have >= job.qty;
    const next = ready ? 'deliver' : 'collect';
    if (next !== job.stage) {
      job.stage = next;
      if (next === 'deliver') this.sim.toast('toast.job_ready', { job: job.jobId }, 'info');
      this.sim.bus.emit('jobs:changed');
    }
  }

  onPlayerAction({ kind, qty, item, own }) {
    const job = this.active;
    if (kind === 'plant_tree') return this.plantedOne({ item, own });
    if (job?.type === 'harvest' && kind === 'harvest') {
      job.harvested += qty;
      this.updateStage();
      this.sim.bus.emit('jobs:changed');
    }
  }

  // ---------- Interaction checks used by buildings ----------

  canTurnIn(buildingId) {
    const job = this.active;
    if (!job || job.stage !== 'deliver') return false;
    if (job.type === 'courier') return job.target === buildingId;
    if (job.type === 'rounds') return job.targets.includes(buildingId);
    if (job.type === 'haul') return false; // at the building site (see canTurnInSite)
    return this.jobBuilding(job)?.id === buildingId;
  }

  canPickup(buildingId) {
    const job = this.active;
    return !!job && ['courier', 'rounds', 'haul', 'plant'].includes(job.type) && job.stage === 'pickup' && this.jobBuilding(job)?.id === buildingId;
  }

  canTurnInSite(siteId) {
    const job = this.active;
    return !!job && job.type === 'haul' && job.stage === 'deliver' && job.target === siteId;
  }

  canStartShift(buildingId) {
    const job = this.active;
    if (!job || job.type !== 'shift' || job.stage !== 'go') return { ok: false };
    if (this.jobBuilding(job)?.id !== buildingId) return { ok: false };
    const d = JOBS[job.jobId];
    const h = this.sim.time.hour;
    if (h < d.hours[0]) return { ok: false, reason: 'too_early', params: { hour: d.hours[0] } };
    if (h >= d.hours[1]) return { ok: false, reason: 'too_late', params: { hour: d.hours[1] } };
    return { ok: true };
  }

  pickup() {
    const job = this.active;
    if (!job) return false;
    const inv = this.sim.inventory;
    if (job.type === 'plant') {
      // Saplings from the yard's beds, to plant out in the woods.
      inv.add(job.item, job.qty, { force: true });
      job.stage = 'planting';
      this.sim.toast('toast.saplings_picked', { qty: job.qty }, 'info');
      this.sim.bus.emit('jobs:changed');
      return true;
    }
    if (job.type === 'haul') {
      // The materials come out of the employer's stock.
      const b = this.sim.economy.biz(this.jobEmployer(job));
      const n = Math.min(job.qty, Math.floor(b?.stock[job.item] || 0));
      if (n <= 0) {
        this.sim.toast('reason.employer_out_of_stock', { item: job.item }, 'warn');
        return false;
      }
      b.stock[job.item] -= n;
      inv.add(job.item, n, { force: true });
      job.qty = n;
      job.stage = 'deliver';
      this.sim.toast('toast.haul_picked', { qty: n, item: job.item }, 'info');
      this.sim.bus.emit('jobs:changed');
      return true;
    }
    const n = job.type === 'rounds' ? job.targets.length : 1;
    if (!inv.canAdd('package', n)) {
      this.sim.toast('reason.too_heavy', {}, 'warn');
      return false;
    }
    inv.add('package', n);
    job.stage = 'deliver';
    this.sim.toast(job.type === 'rounds' ? 'toast.letters_picked' : 'toast.package_picked', { building: job.target, n }, 'info');
    this.sim.bus.emit('jobs:changed');
    return true;
  }

  turnIn(buildingId = null) {
    const job = this.active;
    if (!job || job.stage !== 'deliver') return false;
    const d = JOBS[job.jobId];
    if (job.type === 'rounds') {
      // One letter here; the round goes on until every house has had theirs.
      const at = buildingId && job.targets.includes(buildingId) ? buildingId : job.targets[0];
      if (!d.roundsKind) this.sim.inventory.remove('package', 1);
      if (d.roundsKind === 'chimneys') this.sim.needs.spendEnergy(4);
      job.targets = job.targets.filter((h) => h !== at);
      const resident = this.sim.npcs.residentsOf(at)[0];
      if (resident) this.sim.social.addRel(resident, 1);
      if (job.targets.length) {
        this.sim.toast(d.roundsKind ? `toast.rounds_${d.roundsKind}` : 'toast.letter_delivered', { n: job.targets.length }, 'info');
        this.sim.bus.emit('jobs:changed');
        return true;
      }
    } else if (job.type === 'courier') {
      this.sim.inventory.remove('package', 1);
    } else {
      const have = this.sim.inventory.count(job.item);
      if (have < job.qty) return false;
      // Piece pay: bring more than asked and each extra is paid too (as long as they can pay for it).
      let extra = 0;
      if (job.type !== 'harvest') {
        const emp = this.jobEmployer(job);
        const rate = this.pieceRate(job);
        const afford = rate > 0 ? Math.floor(Math.max(0, this.funds(emp) - this.pay(job.jobId, { job })) / rate) : 0;
        extra = Math.max(0, Math.min(have - job.qty, Math.floor(job.qty * JOB_PAY.pieceMax), afford));
      }
      job.extra = extra;
      this.sim.inventory.remove(job.item, job.qty + extra);
      const b = this.sim.economy.biz(this.jobEmployer(job) || d.employer);
      if (b) b.stock[job.item] = (b.stock[job.item] || 0) + job.qty + extra;
    }
    this.complete();
    return true;
  }

  /** What each unit beyond what was asked is paid. */
  pieceRate(job) {
    return job.qty > 0 ? (this.pay(job.jobId, { job }) / job.qty) * JOB_PAY.pieceShare : 0;
  }

  /** Hauling: the materials arrive at the building site (and the site's owner pays the supplier). */
  turnInSite(siteId) {
    const job = this.active;
    if (!this.canTurnInSite(siteId)) return false;
    const C = this.sim.construction;
    const c = C.byId(siteId);
    if (!c || c.status !== 'site') {
      this.fail('site_gone');
      return false;
    }
    const n = Math.min(job.qty, this.sim.inventory.count(job.item), C.missing(c)[job.item] || 0);
    if (n <= 0) return false;
    this.sim.inventory.remove(job.item, n);
    // Whatever's left over (the site needed less by now) goes back to the supplier.
    const extra = Math.min(job.qty - n, this.sim.inventory.count(job.item));
    const E = this.sim.economy;
    const emp = this.jobEmployer(job);
    if (extra > 0) {
      this.sim.inventory.remove(job.item, extra);
      if (E.biz(emp)) E.biz(emp).stock[job.item] = (E.biz(emp).stock[job.item] || 0) + extra;
    }
    const cost = Math.round(n * (ITEMS[job.item]?.basePrice || 1) * 0.9);
    const purse = this.sim.growth?.purse(c);
    if (purse && E.biz(emp)) {
      const fromBudget = Math.min(c.budget || 0, cost);
      c.budget -= fromBudget;
      const rest = Math.min(cost - fromBudget, Math.max(0, purse.get()));
      purse.pay(rest);
      E.biz(emp).money += fromBudget + rest;
      E.ledger(emp, 'rev', fromBudget + rest);
    }
    c.lastProgressDay = this.sim.time.day;
    C.receive(c, job.item, n);
    this.complete();
    return true;
  }

  /** Returns shift length in minutes (the scene fast-forwards the clock). */
  startShift() {
    const job = this.active;
    job.stage = 'working';
    this.sim.bus.emit('jobs:changed');
    return (job.hours || JOBS[job.jobId].durationHours) * 60;
  }

  finishShift() {
    const job = this.active;
    const d = JOBS[job.jobId];
    // Hourly work: tired in proportion to the hours you put in.
    this.sim.needs.spendEnergy(Math.round((d.energy || 0) * (job.hours ? job.hours / d.durationHours : 1)));
    this.complete();
  }

  complete() {
    const job = this.active;
    const d = JOBS[job.jobId];
    const p = this.sim.state.player;
    const emp = this.jobEmployer(job);
    const b = this.sim.economy.biz(emp);
    const base = this.pay(job.jobId, { job, trees: job.planted });
    // On top: extra units brought (piece pay), a quick delivery, tips from customers.
    const extras = {};
    if (job.extra > 0) extras.piece = Math.round(job.extra * this.pieceRate(job));
    if (['deliver', 'courier', 'rounds', 'haul', 'plant', 'outing'].includes(job.type) && this.sim.time.total - (job.acceptedAt ?? this.sim.time.total) <= JOB_PAY.speedHours * 60) extras.speed = Math.round(base * JOB_PAY.speedPremium);
    if (d.tips) extras.tips = Math.round(base * (JOB_PAY.tipBase + attr(p, 'charisma') * JOB_PAY.tipPerCharisma + hashStr(`tips:${job.jobId}:${job.acceptedAt}`, this.sim.state.seed) * JOB_PAY.tipLuck));
    const bonus = Object.values(extras).reduce((s, v) => s + v, 0);
    const pay = Math.min(base + bonus, this.funds(emp));
    this.payOut(emp, pay);
    p.money += pay;
    this.sim.state.stats.moneyEarned += pay;
    this.sim.state.stats.jobsCompleted++;
    // Your rank in this line of work.
    const before = this.rankOf(job.jobId);
    p.jobStats[job.jobId] = (p.jobStats[job.jobId] || 0) + 1;
    const after = this.rankOf(job.jobId);
    if (after !== before) {
      this.sim.toast('toast.job_rank_up', { job: job.jobId, jrank: after.id }, 'good');
      if (after.id === 'master') this.sim.chronicle('chronicle.player_job_master', { job: job.jobId });
    }
    const xp = this.sim.progression.addXp(d.xp);
    if (d.skill) this.sim.progression.addSkillXp(d.skill, d.skillXp || 0);
    this.sim.progression.addReputation(d.rep || BALANCE.reputation.jobComplete);
    const owner = b ? this.sim.economy.owner(this.jobEmployer(job)) : null;
    const boss = this.npcOfEmployer(emp);
    if (owner || boss) {
      this.sim.social.addRel(owner || boss, this.sim.social.relGain(owner || boss, 4));
      this.sim.memory.remember(owner || boss, 'player_did_job', { who: 'player', params: { job: job.jobId } });
    }
    if (!p.firstJobDone) {
      p.firstJobDone = true;
      this.sim.chronicle('chronicle.player_first_job', { job: job.jobId });
    }
    this.js.active = null;
    job.paid = pay;
    job.extras = extras;
    this.sim.toast(bonus > 0 ? 'toast.job_done_bonus' : 'toast.job_done', { job: job.jobId, money: pay, xp, bonus }, 'good');
    this.sim.bus.emit('job:completed', job);
    this.sim.bus.emit('jobs:changed');
    this.sim.bus.emit('player:changed');
    this.tryQueued();
  }

  fail(reasonKey = 'expired') {
    const job = this.active;
    if (!job) return;
    const inv = this.sim.inventory;
    const d = JOBS[job.jobId];
    if (job.type === 'courier') inv.remove('package', 1);
    if (job.type === 'rounds' && job.stage === 'deliver' && !d.roundsKind) inv.remove('package', job.targets.length);
    // Tree planting: what you planted is paid for (by the tree); the saplings left go back.
    if (job.type === 'plant' && job.stage === 'planting') {
      inv.remove(job.item, Math.max(0, job.qty - (job.planted || 0)));
      if (job.planted > 0) {
        const emp = this.jobEmployer(job);
        const pay = Math.min(this.pay(job.jobId, { job, trees: job.planted }), this.funds(emp));
        this.payOut(emp, pay);
        this.sim.state.player.money += pay;
        this.sim.toast('toast.planting_part_paid', { n: job.planted, money: pay }, 'info');
      }
    }
    // Hauled materials go back to the supplier.
    if (job.type === 'haul' && job.stage === 'deliver') {
      const n = Math.min(job.qty, inv.count(job.item));
      inv.remove(job.item, n);
      const b = this.sim.economy.biz(this.jobEmployer(job));
      if (b) b.stock[job.item] = (b.stock[job.item] || 0) + n;
    }
    this.sim.progression.addReputation(BALANCE.reputation.jobFail);
    const owner = this.npcOfEmployer(this.jobEmployer(job));
    if (owner) {
      this.sim.social.addRel(owner, -5);
      this.sim.memory.remember(owner, 'player_failed_job', { who: 'player', params: { job: job.jobId } });
    }
    this.js.active = null;
    this.sim.toast(`toast.job_failed_${reasonKey === 'site_gone' ? 'expired' : reasonKey}`, { job: job.jobId }, 'danger');
    this.sim.bus.emit('jobs:changed');
    this.tryQueued();
  }

  abandon() {
    this.fail('abandoned');
  }

  onNewDay() {
    const job = this.active;
    if (job && job.acceptedDay < this.sim.time.day && job.stage !== 'working') this.fail('expired');
    const day = this.sim.time.day;
    const before = this.js.requests.length;
    // A favour you promised and never delivered is remembered.
    for (const r of this.js.requests) {
      if (r.expiresDay <= day && r.accepted) this.sim.memory.remember(this.sim.npcs.byId(r.npcId), 'player_let_down', { who: 'player', params: { item: r.item } });
    }
    this.js.requests = this.js.requests.filter((r) => r.expiresDay > day);
    if (before !== this.js.requests.length) this.sim.bus.emit('jobs:changed');
  }

  /** Where should the player go next, and what should they do? For the HUD tracker and arrow. */
  objective() {
    const job = this.active;
    if (!job) return null;
    const world = this.sim.world;
    const doorPos = (b) => world.tileCenter(b.door.tx, b.door.ty);
    const p = this.sim.state.player;
    const ptile = world.toTile(p.x, p.y);
    const d = JOBS[job.jobId];
    switch (job.stage) {
      case 'collect': {
        if (job.type === 'harvest') {
          const crop = this.sim.resources.findNearest('crop', ptile.tx, ptile.ty, 200);
          return { key: 'objective.harvest', params: { have: job.harvested, qty: job.qty, item: job.item }, target: crop ? world.tileCenter(crop.tx, crop.ty) : null };
        }
        if (job.type === 'plant') return null;
        const kind = RESOURCE_OF[job.item];
        const obj = kind ? this.sim.resources.findNearest(kind, ptile.tx, ptile.ty, 60, (o) => kind !== 'rock' || o.variant === 'stone') : null;
        return { key: `objective.collect_${job.item}`, params: { have: this.sim.inventory.count(job.item), qty: job.qty, item: job.item }, target: obj ? world.tileCenter(obj.tx, obj.ty) : null };
      }
      case 'deliver': {
        if (job.type === 'haul') {
          const c = this.sim.construction.byId(job.target);
          return { key: 'objective.haul_deliver', params: { qty: job.qty, item: job.item }, target: c ? world.tileCenter(c.tx + Math.floor(c.w / 2), c.ty + c.h) : null };
        }
        if (job.type === 'rounds') {
          // The nearest house still waiting for its letter (or its lamp lit, its chimney swept).
          const next = job.targets.map((id) => world.buildings[id]).filter(Boolean).sort((a, b) => Math.abs(a.door.tx - ptile.tx) + Math.abs(a.door.ty - ptile.ty) - (Math.abs(b.door.tx - ptile.tx) + Math.abs(b.door.ty - ptile.ty)))[0];
          return { key: d.roundsKind ? `objective.rounds_${d.roundsKind}` : 'objective.deliver_letters', params: { n: job.targets.length, building: next?.id }, target: next ? doorPos(next) : null };
        }
        const b = job.type === 'courier' ? world.buildings[job.target] : this.jobBuilding(job);
        if (!b) return null;
        return { key: job.type === 'courier' ? 'objective.deliver_package' : 'objective.deliver', params: { qty: job.qty, item: job.item, building: b.id }, target: doorPos(b) };
      }
      case 'pickup': {
        const b = this.jobBuilding(job);
        if (!b) return null;
        const key = job.type === 'haul' ? 'objective.haul_pickup' : job.type === 'rounds' ? 'objective.pickup_letters' : job.type === 'plant' ? 'objective.pickup_saplings' : 'objective.pickup';
        return { key, params: { building: b.id, qty: job.qty, item: job.item }, target: doorPos(b) };
      }
      case 'go': {
        if (job.type === 'outing') return { key: 'objective.outing', params: { job: job.jobId, pkind: d.place }, target: job.place ? world.tileCenter(job.place.tx, job.place.ty) : null };
        const b = this.jobBuilding(job);
        if (!b) return null;
        return { key: 'objective.shift', params: { building: b.id, hour: d.hours[0], hour2: d.hours[1] }, target: doorPos(b) };
      }
      case 'planting': {
        // The nearest stump, cleared ground or forest edge from where you stand.
        const spot = this.sim.forestry?.spotsNear(ptile.tx, ptile.ty, 40, 1)[0];
        return { key: 'objective.plant_trees', params: { n: job.planted || 0, qty: job.qty }, target: spot ? world.tileCenter(spot.tx, spot.ty) : null };
      }
      default:
        return null;
    }
  }

  // ---------- Favour requests ----------

  generateRequests() {
    const R = BALANCE.requests;
    const js = this.js;
    // A newcomer gets asked for more small favours (it's how people get to know you).
    const newcomer = this.sim.state.player.level <= 4;
    const max = R.maxActive + (newcomer ? 1 : 0);
    if (js.requests.length >= max || !rand.chance(Math.min(0.95, R.dailyChance * (newcomer ? 2.6 : 2)))) return;
    const season = this.sim.time.season;
    const candidates = [];
    for (const npc of this.sim.state.npcs) {
      if (js.requests.some((r) => r.npcId === npc.id)) continue;
      for (const tpl of REQUEST_TEMPLATES) {
        // (A household with no firewood in winter asks anyone for wood — SeasonSystem.)
        if (tpl.cold ? !this.sim.seasons?.isCold(npc) : !tpl.occupations.includes(npc.occupation)) continue;
        if (tpl.seasons && !tpl.seasons.includes(season)) continue;
        candidates.push({ npc, tpl });
      }
    }
    if (!candidates.length) return;
    const { npc, tpl } = rand.pick(candidates);
    let item = tpl.item;
    if (item === 'shortage') {
      const store = this.sim.economy;
      const buys = store.def('store').buys;
      item = buys.reduce((best, it) => (store.stock('store', it) / store.target('store', it) < store.stock('store', best) / store.target('store', best) ? it : best), buys[0]);
    }
    const qty = rand.int(tpl.qty[0], tpl.qty[1]);
    const ideal = Math.round(qty * ITEMS[item].basePrice * R.rewardMult * traitValue(npc.traits, 'requestMult') + R.rewardFlat);
    const reward = Math.max(0, Math.min(ideal, Math.floor(npc.money)));
    js.requests.push({ id: js.nextRequestId++, npcId: npc.id, item, qty, reward, expiresDay: this.sim.time.day + R.expireDays, accepted: false });
    this.sim.bus.emit('jobs:changed');
  }

  requestFor(npcId) {
    return this.js.requests.find((r) => r.npcId === npcId) || null;
  }

  /** Ask a villager for more for their favour (once). Returns { ok, result: 'yes' | 'half' | 'no' | 'cant_afford' }. */
  canCounter(r) {
    if (!r || r.accepted) return { ok: false, reason: 'contract_gone' };
    if (r.countered) return { ok: false, reason: 'already_bargained' };
    return { ok: true };
  }
  counterOffer(id) {
    const r = this.js.requests.find((q) => q.id === id);
    const chk = this.canCounter(r);
    if (!chk.ok) return chk;
    const npc = this.sim.npcs.byId(r.npcId);
    const p = this.sim.state.player;
    const want = Math.round(r.reward * (1 + JOB_PAY.counterUp) + 2);
    let c = 0.3 + (npc.rel || 0) / 150 + skill(p, 'negotiation') * 0.04 + attr(p, 'charisma') * 0.02;
    if (npc.traits.includes('generous')) c += 0.2;
    if (npc.traits.includes('greedy')) c -= 0.2;
    const h = hashStr(`counter:${r.id}:${r.npcId}`, this.sim.state.seed);
    let result;
    if (npc.money < want) result = 'cant_afford';
    else if (h < c) result = 'yes';
    else if (h < c + 0.25) result = 'half';
    else result = 'no';
    if (result === 'yes') r.reward = want;
    if (result === 'half') r.reward = Math.round((r.reward + want) / 2);
    if (result === 'no') this.sim.social.addRel(npc, -1);
    r.countered = result;
    this.sim.progression.addSkillXp('negotiation', 4);
    this.sim.bus.emit('jobs:changed');
    return { ok: true, result, reward: r.reward };
  }

  // ---------- What pays best today? ----------

  /** Rough hours a job takes, walking included (for comparing pay). */
  estHours(jobId) {
    const d = JOBS[jobId];
    switch (d.type) {
      case 'shift':
        return d.durationHours + 0.3;
      case 'outing':
        return d.durationHours + 1;
      case 'deliver':
        return 0.8 + (d.qty || 4) * 0.3;
      case 'harvest':
        return 1 + (d.qty || 8) * 0.12;
      case 'rounds':
        return 0.5 + (d.qty || 3) * 0.35;
      case 'plant':
        return 0.8 + (d.qty || 6) * 0.25;
      case 'haul':
        return 1.2;
      default:
        return 1;
    }
  }

  /**
   * Everything you could earn by today, best paid by the hour first: board jobs (open now, or later today),
   * villagers' favours, and your market stall. [{ kind, id, pay, hours, perHour, now, reason }]
   */
  advice() {
    const out = [];
    for (const id of Object.keys(JOBS)) {
      if (!this.employerOf(id) || (this.js.openings[id] || 0) <= 0 || this.active?.jobId === id) continue;
      const c = this.check(id, { ignoreActive: true });
      if (!c.ok && c.reason !== 'too_early') continue;
      const hours = this.estHours(id);
      const pay = this.pay(id);
      out.push({ kind: 'job', id, pay, hours, perHour: pay / hours, now: c.ok, reason: c.ok ? null : c.reason, params: c.params });
    }
    for (const r of this.js.requests) {
      if (r.reward <= 0) continue;
      const have = this.sim.inventory.count(r.item) >= r.qty;
      const hours = have ? 0.4 : 1.5;
      out.push({ kind: 'request', id: r.id, npc: r.npcId, item: r.item, qty: r.qty, pay: r.reward, hours, perHour: r.reward / hours, now: true });
    }
    const st = this.sim.stall?.estimate();
    if (st) out.push({ kind: 'stall', pay: st.pay, hours: st.hours, perHour: st.pay / st.hours, now: st.ok, reason: st.reason });
    return out.sort((a, b) => b.perHour - a.perHour);
  }

  acceptRequest(id) {
    const r = this.js.requests.find((q) => q.id === id);
    if (!r) return false;
    r.accepted = true;
    this.sim.toast('toast.request_accepted', { npc: r.npcId, item: r.item, qty: r.qty }, 'good');
    this.sim.bus.emit('jobs:changed');
    return true;
  }

  canFulfill(r) {
    return !!r && r.accepted && this.sim.inventory.count(r.item) >= r.qty;
  }

  fulfill(id) {
    const r = this.js.requests.find((q) => q.id === id);
    if (!this.canFulfill(r)) return false;
    const npc = this.sim.npcs.byId(r.npcId);
    const R = BALANCE.requests;
    this.sim.inventory.remove(r.item, r.qty);
    const pay = Math.min(r.reward, Math.floor(npc.money));
    npc.money -= pay;
    this.sim.state.player.money += pay;
    npc.pantry += ITEMS[r.item]?.food ? r.qty : 0;
    this.sim.progression.addXp(R.xp);
    this.sim.progression.addReputation(BALANCE.reputation.requestComplete);
    this.sim.social.addRel(npc, this.sim.social.relGain(npc, R.relationship));
    this.sim.memory.remember(npc, 'player_helped', { who: 'player', params: { item: r.item, qty: r.qty } });
    this.sim.state.stats.requestsDone++;
    this.js.requests = this.js.requests.filter((q) => q.id !== id);
    this.sim.toast('toast.request_done', { npc: npc.id, money: pay }, 'good');
    this.sim.chronicle('chronicle.player_helped', { npc: npc.id, gender: npc.gender });
    this.sim.bus.emit('jobs:changed');
    this.sim.bus.emit('player:changed');
    return true;
  }
}
