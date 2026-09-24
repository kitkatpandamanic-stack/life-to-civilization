/**
 * JobSystem — work the player takes on for village businesses, plus
 * favour requests from villagers.
 *
 * Openings refresh every morning and depend on the simulation:
 *   • the employer must be able to afford your pay
 *   • farm harvesting needs ripe crops (none in winter)
 *   • seasonal jobs only exist in their season
 *
 * Active job stages:
 *   harvest:  collect (harvest crops on the farm) → deliver (to the farmhouse)
 *   deliver:  collect (gather anywhere)            → deliver (to the employer)
 *   courier:  pickup (at the employer)             → deliver (to a house)
 *   shift:    go (to the workplace)                → working (time fast-forwards)
 */
import { BALANCE } from '../config/balance.js';
import { JOBS } from '../data/jobs.js';
import { ITEMS } from '../data/items.js';
import { REQUEST_TEMPLATES } from '../data/requests.js';
import { traitValue } from '../data/traits.js';
import { rand } from '../core/rng.js';
import { Mod, skill, attr } from './Modifiers.js';

export class JobSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:hour', (h) => {
      if (h === BALANCE.jobs.refreshHour) this.refresh();
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

  employerBuilding(jobId) {
    return this.sim.economy.buildingOf(JOBS[jobId].employer);
  }
  employerNpc(jobId) {
    return this.sim.economy.owner(JOBS[jobId].employer);
  }

  ensureOpenings() {
    if (this.js.lastRefreshDay !== this.sim.time.day) this.refresh();
  }

  /** Does this job exist today, according to the simulation? */
  existsToday(jobId) {
    const d = JOBS[jobId];
    if (d.seasons && !d.seasons.includes(this.sim.time.season)) return false;
    if (this.sim.economy.biz(d.employer).money < d.pay) return false;
    if (d.type === 'harvest' && this.sim.resources.countRipeCrops() < d.qty) return false;
    return true;
  }

  refresh() {
    for (const [id, d] of Object.entries(JOBS)) this.js.openings[id] = this.existsToday(id) ? d.dailySlots : 0;
    this.js.lastRefreshDay = this.sim.time.day;
    this.sim.bus.emit('jobs:changed');
  }

  jobsForBusiness(bizId) {
    return Object.keys(JOBS).filter((id) => JOBS[id].employer === bizId);
  }

  pay(jobId) {
    const d = JOBS[jobId];
    const owner = this.employerNpc(jobId);
    return Math.round(d.pay * Mod.payMult(this.sim.state.player, d) * (owner ? this.sim.social.payBonus(owner) : 1));
  }

  /** Can the player accept this job right now? Returns { ok, reason, params }. */
  check(jobId) {
    const d = JOBS[jobId];
    const p = this.sim.state.player;
    const r = d.requires || {};
    const h = this.sim.time.hour;
    if (this.active?.jobId === jobId) return { ok: false, reason: 'job_is_active' };
    if (this.active) return { ok: false, reason: 'job_active' };
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

  accept(jobId) {
    const c = this.check(jobId);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const d = JOBS[jobId];
    this.js.openings[jobId]--;
    const job = { jobId, type: d.type, item: d.item || null, qty: d.qty || 0, harvested: 0, acceptedDay: this.sim.time.day, stage: 'collect', target: null };
    if (d.type === 'courier') job.stage = 'pickup';
    if (d.type === 'shift') job.stage = 'go';
    if (d.type === 'courier') {
      // Deliver to a real villager's home (not the employer).
      const homes = [...new Set(this.sim.state.npcs.map((n) => n.homeId))].filter((h) => h.startsWith('house_') || h === 'farmhouse' || h === 'hall');
      job.target = rand.pick(homes);
    }
    this.js.active = job;
    const owner = this.employerNpc(jobId);
    if (owner) this.sim.social.meet(owner);
    this.updateStage();
    this.sim.toast('toast.job_accepted', { job: jobId }, 'good');
    this.sim.bus.emit('jobs:changed');
    return true;
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
    return this.employerBuilding(job.jobId).id === buildingId;
  }

  canPickup(buildingId) {
    const job = this.active;
    return !!job && job.type === 'courier' && job.stage === 'pickup' && this.employerBuilding(job.jobId).id === buildingId;
  }

  canStartShift(buildingId) {
    const job = this.active;
    if (!job || job.type !== 'shift' || job.stage !== 'go') return { ok: false };
    if (this.employerBuilding(job.jobId).id !== buildingId) return { ok: false };
    const d = JOBS[job.jobId];
    const h = this.sim.time.hour;
    if (h < d.hours[0]) return { ok: false, reason: 'too_early', params: { hour: d.hours[0] } };
    if (h >= d.hours[1]) return { ok: false, reason: 'too_late', params: { hour: d.hours[1] } };
    return { ok: true };
  }

  pickup() {
    const job = this.active;
    if (!job) return false;
    if (!this.sim.inventory.canAdd('package', 1)) {
      this.sim.toast('reason.too_heavy', {}, 'warn');
      return false;
    }
    this.sim.inventory.add('package', 1);
    job.stage = 'deliver';
    this.sim.toast('toast.package_picked', { building: job.target }, 'info');
    this.sim.bus.emit('jobs:changed');
    return true;
  }

  turnIn() {
    const job = this.active;
    if (!job || job.stage !== 'deliver') return false;
    const d = JOBS[job.jobId];
    if (job.type === 'courier') {
      this.sim.inventory.remove('package', 1);
    } else {
      if (this.sim.inventory.count(job.item) < job.qty) return false;
      this.sim.inventory.remove(job.item, job.qty);
      const b = this.sim.economy.biz(d.employer);
      b.stock[job.item] = (b.stock[job.item] || 0) + job.qty;
    }
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
    const b = this.sim.economy.biz(d.employer);
    const pay = Math.min(this.pay(job.jobId), Math.max(0, b.money));
    b.money -= pay;
    p.money += pay;
    this.sim.state.stats.moneyEarned += pay;
    this.sim.state.stats.jobsCompleted++;
    const xp = this.sim.progression.addXp(d.xp);
    if (d.skill) this.sim.progression.addSkillXp(d.skill, d.skillXp || 0);
    this.sim.progression.addReputation(d.rep || BALANCE.reputation.jobComplete);
    const owner = this.employerNpc(job.jobId);
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
    if (job.type === 'courier') this.sim.inventory.remove('package', 1);
    this.sim.progression.addReputation(BALANCE.reputation.jobFail);
    const owner = this.employerNpc(job.jobId);
    if (owner) {
      this.sim.social.addRel(owner, -5);
      this.sim.memory.remember(owner, 'player_failed_job', { who: 'player', params: { job: job.jobId } });
    }
    this.js.active = null;
    this.sim.toast(`toast.job_failed_${reasonKey}`, { job: job.jobId }, 'danger');
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
        const kind = job.item === 'wood' ? 'tree' : 'rock';
        const obj = this.sim.resources.findNearest(kind, ptile.tx, ptile.ty, 40, (o) => kind !== 'rock' || o.variant === 'stone');
        return { key: `objective.collect_${job.item}`, params: { have: this.sim.inventory.count(job.item), qty: job.qty, item: job.item }, target: obj ? world.tileCenter(obj.tx, obj.ty) : null };
      }
      case 'deliver': {
        const b = job.type === 'courier' ? world.buildings[job.target] : this.employerBuilding(job.jobId);
        return { key: job.type === 'courier' ? 'objective.deliver_package' : 'objective.deliver', params: { qty: job.qty, item: job.item, building: b.id }, target: doorPos(b) };
      }
      case 'pickup': {
        const b = this.employerBuilding(job.jobId);
        return { key: 'objective.pickup', params: { building: b.id }, target: doorPos(b) };
      }
      case 'go': {
        const b = this.employerBuilding(job.jobId);
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
    if (js.requests.length >= R.maxActive || !rand.chance(R.dailyChance * 2)) return;
    const season = this.sim.time.season;
    const candidates = [];
    for (const npc of this.sim.state.npcs) {
      if (js.requests.some((r) => r.npcId === npc.id)) continue;
      for (const tpl of REQUEST_TEMPLATES) {
        if (!tpl.occupations.includes(npc.occupation)) continue;
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
