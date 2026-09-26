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
 */
import { BALANCE } from '../config/balance.js';
import { JOBS, JOB_REFRESH } from '../data/jobs.js';
import { ITEMS } from '../data/items.js';
import { REQUEST_TEMPLATES } from '../data/requests.js';
import { traitValue } from '../data/traits.js';
import { rand } from '../core/rng.js';
import { Mod, skill, attr } from './Modifiers.js';

/** What you gather for each kind of delivery (for the objective arrow). */
const RESOURCE_OF = { wood: 'tree', stone: 'rock', berries: 'bush' };

export class JobSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.jobs.employers ??= {};
    sim.bus.on('time:hour', (h) => {
      if (h === BALANCE.jobs.refreshHour) this.refresh();
      if (h === JOB_REFRESH.middayHour) this.topUp();
      if (h === 7) this.generateRequests();
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

  /** Who's hiring for this job today: a fixed business, or one of its type the village has. */
  employerOf(jobId) {
    const d = JOBS[jobId];
    const E = this.sim.economy;
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
    const id = this.employerOf(jobId);
    return id ? this.sim.economy.buildingOf(id) : null;
  }
  employerNpc(jobId) {
    const id = this.employerOf(jobId);
    return id ? this.sim.economy.owner(id) : null;
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
    if (E.biz(emp).money < d.pay) return false;
    if (d.type === 'harvest' && this.sim.resources.countRipeCrops() < d.qty) return false;
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

  pay(jobId) {
    const d = JOBS[jobId];
    const owner = this.employerNpc(jobId);
    return Math.round(d.pay * (this.rushOf(d)?.pay || 1) * Mod.payMult(this.sim.state.player, d) * (owner ? this.sim.social.payBonus(owner) : 1));
  }

  /** Can the player accept this job right now? Returns { ok, reason, params }. */
  check(jobId) {
    const d = JOBS[jobId];
    const p = this.sim.state.player;
    const r = d.requires || {};
    const h = this.sim.time.hour;
    if (this.active?.jobId === jobId) return { ok: false, reason: 'job_is_active' };
    if (this.active) return { ok: false, reason: 'job_active' };
    if (!this.employerOf(jobId)) return { ok: false, reason: 'no_employer', params: { biz_type: d.employerType } };
    if (d.seasons && !d.seasons.includes(this.sim.time.season)) return { ok: false, reason: 'wrong_season' };
    if ((this.js.openings[jobId] || 0) <= 0) return { ok: false, reason: 'no_openings' };
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

  accept(jobId) {
    const c = this.check(jobId);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const d = JOBS[jobId];
    const job = { jobId, type: d.type, item: d.item || null, qty: d.qty || 0, harvested: 0, acceptedDay: this.sim.time.day, stage: 'collect', target: null, employer: this.employerOf(jobId) };
    if (d.type === 'courier' || d.type === 'rounds' || d.type === 'haul') job.stage = 'pickup';
    if (d.type === 'shift') job.stage = 'go';
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
    this.js.openings[jobId]--;
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
    const id = this.jobEmployer(job);
    return id ? this.sim.economy.buildingOf(id) : null;
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

  onPlayerAction({ kind, qty }) {
    const job = this.active;
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
    return !!job && ['courier', 'rounds', 'haul'].includes(job.type) && job.stage === 'pickup' && this.jobBuilding(job)?.id === buildingId;
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
      this.sim.inventory.remove('package', 1);
      job.targets = job.targets.filter((h) => h !== at);
      const resident = this.sim.npcs.residentsOf(at)[0];
      if (resident) this.sim.social.addRel(resident, 1);
      if (job.targets.length) {
        this.sim.toast('toast.letter_delivered', { n: job.targets.length }, 'info');
        this.sim.bus.emit('jobs:changed');
        return true;
      }
    } else if (job.type === 'courier') {
      this.sim.inventory.remove('package', 1);
    } else {
      if (this.sim.inventory.count(job.item) < job.qty) return false;
      this.sim.inventory.remove(job.item, job.qty);
      const b = this.sim.economy.biz(this.jobEmployer(job) || d.employer);
      if (b) b.stock[job.item] = (b.stock[job.item] || 0) + job.qty;
    }
    this.complete();
    return true;
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
    return JOBS[job.jobId].durationHours * 60;
  }

  finishShift() {
    const d = JOBS[this.active.jobId];
    this.sim.needs.spendEnergy(d.energy || 0);
    this.complete();
  }

  complete() {
    const job = this.active;
    const d = JOBS[job.jobId];
    const p = this.sim.state.player;
    const b = this.sim.economy.biz(this.jobEmployer(job));
    const pay = Math.min(this.pay(job.jobId), Math.max(0, b?.money || 0));
    if (b) b.money -= pay;
    p.money += pay;
    this.sim.state.stats.moneyEarned += pay;
    this.sim.state.stats.jobsCompleted++;
    const xp = this.sim.progression.addXp(d.xp);
    if (d.skill) this.sim.progression.addSkillXp(d.skill, d.skillXp || 0);
    this.sim.progression.addReputation(d.rep || BALANCE.reputation.jobComplete);
    const owner = b ? this.sim.economy.owner(this.jobEmployer(job)) : null;
    if (owner) {
      this.sim.social.addRel(owner, this.sim.social.relGain(owner, 4));
      this.sim.memory.remember(owner, 'player_did_job', { who: 'player', params: { job: job.jobId } });
    }
    if (!p.firstJobDone) {
      p.firstJobDone = true;
      this.sim.chronicle('chronicle.player_first_job', { job: job.jobId });
    }
    this.js.active = null;
    this.sim.toast('toast.job_done', { job: job.jobId, money: pay, xp }, 'good');
    this.sim.bus.emit('job:completed', job);
    this.sim.bus.emit('jobs:changed');
    this.sim.bus.emit('player:changed');
  }

  fail(reasonKey = 'expired') {
    const job = this.active;
    if (!job) return;
    const inv = this.sim.inventory;
    if (job.type === 'courier') inv.remove('package', 1);
    if (job.type === 'rounds' && job.stage === 'deliver') inv.remove('package', job.targets.length);
    // Hauled materials go back to the supplier.
    if (job.type === 'haul' && job.stage === 'deliver') {
      const n = Math.min(job.qty, inv.count(job.item));
      inv.remove(job.item, n);
      const b = this.sim.economy.biz(this.jobEmployer(job));
      if (b) b.stock[job.item] = (b.stock[job.item] || 0) + n;
    }
    this.sim.progression.addReputation(BALANCE.reputation.jobFail);
    const owner = this.sim.economy.owner(this.jobEmployer(job));
    if (owner) {
      this.sim.social.addRel(owner, -5);
      this.sim.memory.remember(owner, 'player_failed_job', { who: 'player', params: { job: job.jobId } });
    }
    this.js.active = null;
    this.sim.toast(`toast.job_failed_${reasonKey === 'site_gone' ? 'expired' : reasonKey}`, { job: job.jobId }, 'danger');
    this.sim.bus.emit('jobs:changed');
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
          // The nearest house still waiting for its letter.
          const next = job.targets.map((id) => world.buildings[id]).filter(Boolean).sort((a, b) => Math.abs(a.door.tx - ptile.tx) + Math.abs(a.door.ty - ptile.ty) - (Math.abs(b.door.tx - ptile.tx) + Math.abs(b.door.ty - ptile.ty)))[0];
          return { key: 'objective.deliver_letters', params: { n: job.targets.length, building: next?.id }, target: next ? doorPos(next) : null };
        }
        const b = job.type === 'courier' ? world.buildings[job.target] : this.jobBuilding(job);
        if (!b) return null;
        return { key: job.type === 'courier' ? 'objective.deliver_package' : 'objective.deliver', params: { qty: job.qty, item: job.item, building: b.id }, target: doorPos(b) };
      }
      case 'pickup': {
        const b = this.jobBuilding(job);
        if (!b) return null;
        const key = job.type === 'haul' ? 'objective.haul_pickup' : job.type === 'rounds' ? 'objective.pickup_letters' : 'objective.pickup';
        return { key, params: { building: b.id, qty: job.qty, item: job.item }, target: doorPos(b) };
      }
      case 'go': {
        const b = this.jobBuilding(job);
        if (!b) return null;
        return { key: 'objective.shift', params: { building: b.id, hour: d.hours[0], hour2: d.hours[1] }, target: doorPos(b) };
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
