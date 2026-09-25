/**
 * WorkerSystem — villagers the player employs.
 *
 * A worker is a normal NPC (with their own home, needs and life) whose employer
 * is 'player'. During work hours they do what they're assigned — physically:
 *
 *   gather_wood / gather_stone  fell trees / break rocks, carry it to your storage
 *   build                       haul missing materials from your storage to a site, then build
 *   farm                        harvest ripe crops, water dry ones, replant from stored seeds
 *   idle                        wait at your storage for orders
 *
 * Contracts live in state.workers[npcId]:
 *   { npcId, salary, rank, assignment, satisfaction, hiredDay, unpaid, daysWorked }
 *
 * Satisfaction depends on salary vs. what they expect, being paid on time,
 * how they feel, and how they like you. Unhappy workers ask for raises, then quit.
 * Productivity depends on their level, needs, mood, satisfaction and your Leadership.
 */
import { OCCUPATIONS } from '../data/occupations.js';
import { UNLOCKS, WORKER_LIMITS } from '../data/unlocks.js';
import { traitValue } from '../data/traits.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { Mod, skill } from './Modifiers.js';
import { rand } from '../core/rng.js';

export const WORKER_RANKS = ['worker', 'skilled', 'supervisor', 'manager'];
const W = {
  baseSalary: 12,
  salaryPerLevel: 1.2,
  rankSalaryMult: { worker: 1, skilled: 1.25, supervisor: 1.5, manager: 1.9 },
  rankLevel: { skilled: 6, supervisor: 10, manager: 15 },
  rankTeamBonus: { supervisor: 0.08, manager: 0.15 },
  quitBelow: 20,
  gatherMinutes: 70,
  buildBlockMinutes: 60,
  farmTaskMinutes: 20,
  carryLoad: 20,
  searchRadius: 34,
};

export class WorkerSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  get contracts() {
    return this.sim.state.workers;
  }
  contract(npcId) {
    return this.contracts[npcId] || null;
  }
  list() {
    return Object.values(this.contracts);
  }
  npcs() {
    return this.sim.npcs;
  }

  // ------------------------------------------------------------------ limits & wages

  maxWorkers() {
    const p = this.sim.state.player;
    const extra = this.sim.progression.hasUnlock('more_workers') ? WORKER_LIMITS.moreWorkersBonus : 0;
    return Mod.maxWorkers(p, extra);
  }

  /** What this villager would want to be paid per day. */
  expectedSalary(npc, rank = 'worker') {
    const p = this.sim.state.player;
    let s = W.baseSalary + npc.level * W.salaryPerLevel;
    s *= W.rankSalaryMult[rank];
    if (npc.traits.includes('greedy')) s *= 1.25;
    if (npc.traits.includes('generous') || npc.traits.includes('loyal')) s *= 0.95;
    // Someone out of work is happy with less — and stays content with it for their first week.
    const contract = this.contract(npc.id);
    if (npc.occupation === 'unemployed' || (contract?.hiredUnemployed && contract.daysWorked < 7)) s *= 0.85;
    s *= 1 - Mod.wageDiscount(p);
    if (this.sim.social.tier(npc) === 'friend' || this.sim.social.tier(npc) === 'trusted') s *= 0.93;
    return Math.max(6, Math.round(s));
  }

  /** Can the player hire this villager? */
  canHire(npc) {
    const sim = this.sim;
    if (!sim.progression.hasUnlock('hire_worker')) return { ok: false, reason: 'locked', params: { level: UNLOCKS.find((u) => u.key === 'hire_worker').level } };
    if (npc.age < 16 || npc.occupation === 'child' || npc.occupation === 'elder') return { ok: false, reason: 'cant_hire_person' };
    if (npc.owns) return { ok: false, reason: 'owns_business' };
    if (this.contract(npc.id)) return { ok: false, reason: 'already_yours' };
    if (this.list().length >= this.maxWorkers()) return { ok: false, reason: 'too_many_workers', params: { n: this.maxWorkers() } };
    if (!npc.met) return { ok: false, reason: 'dont_know_you' };
    return { ok: true };
  }

  /**
   * Offer a job at a salary. Unemployed villagers accept a fair offer; employed ones
   * need a real raise over their current wage, and loyal ones may still say no.
   * Returns { accepted, reason }.
   */
  offer(npc, salary) {
    const chk = this.canHire(npc);
    if (!chk.ok) return { accepted: false, reason: chk.reason, params: chk.params };
    const expected = this.expectedSalary(npc);
    let chance;
    if (salary >= expected) chance = 1;
    else chance = Math.max(0, 1 - ((expected - salary) / expected) * 3.5); // 85% of expectations ≈ 50% chance
    chance += skill(this.sim.state.player, 'negotiation') * 0.03;
    if (npc.employer) {
      const current = OCCUPATIONS[npc.occupation]?.wage || 12;
      if (salary < current * 1.2) chance *= 0.2;
      chance *= npc.traits.includes('loyal') ? 0.4 : npc.traits.includes('ambitious') ? 1.2 : 0.8;
      if (npc.apprentice) chance *= 0.5; // an apprentice doesn't lightly leave their master
    }
    if (npc.lastOfferDay === this.sim.time.day && salary < expected) chance *= 0.3; // already haggled today
    // What they remember about you matters: trust helps, a past firing or unpaid wages hurt.
    const mem = this.sim.memory;
    if (mem.has(npc, 'player_fired_unfair', 'player')) chance = 0;
    else if (mem.has(npc, 'player_fired', 'player') || mem.has(npc, 'player_unpaid', 'player')) chance *= 0.35;
    chance *= Math.max(0.3, Math.min(1.4, 1 + this.sim.social.playerBond(npc).t / 100));
    if (mem.has(npc, 'player_gave_job', 'player')) chance = Math.max(chance, 0.8);
    npc.lastOfferDay = this.sim.time.day;
    const accepted = rand.chance(Math.min(1, chance));
    if (!accepted) {
      this.sim.social.addRel(npc, -0.5);
      if (this.sim.memory.has(npc, 'player_fired_unfair', 'player')) return { accepted: false, reason: 'offer_refused_grudge' };
      return { accepted: false, reason: 'offer_refused' };
    }
    this.hire(npc, salary);
    return { accepted: true };
  }

  hire(npc, salary) {
    const sim = this.sim;
    const oldBiz = npc.employer;
    const wasUnemployed = npc.occupation === 'unemployed';
    npc.employer = 'player';
    npc.occupation = 'hired_hand';
    npc.unpaidDays = 0;
    npc.task = null;
    npc.nextThink = sim.time.total;
    this.contracts[npc.id] = {
      npcId: npc.id,
      salary,
      rank: 'worker',
      assignment: { type: 'idle' },
      satisfaction: 70,
      hiredDay: sim.time.day,
      unpaid: 0,
      daysWorked: 0,
      hiredUnemployed: wasUnemployed,
    };
    sim.progression.addXp(25);
    sim.progression.addSkillXp('leadership', 20);
    const oldBuilding = oldBiz ? sim.economy.biz(oldBiz)?.building : undefined;
    sim.memory.remember(npc, wasUnemployed ? 'player_gave_job' : 'player_hired', { who: 'player', params: oldBuilding ? { building: oldBuilding } : null });
    sim.chronicle('chronicle.player_hired', { npc: npc.id, gender: npc.gender, building: oldBuilding });
    sim.toast('toast.hired', { npc: npc.id, money: salary }, 'good');
    sim.bus.emit('workers:changed');
  }

  fire(npcId) {
    const sim = this.sim;
    const c = this.contract(npcId);
    const npc = this.npcs().byId(npcId);
    if (!c || !npc) return;
    delete this.contracts[npcId];
    this.npcs().clearReservation(npc);
    npc.employer = null;
    npc.occupation = 'unemployed';
    npc.carry = null;
    npc.task = null;
    npc.nextThink = sim.time.total;
    // Firing someone who was doing fine (happy, not sick, not new) feels unfair — and people talk.
    const unfair = c.satisfaction >= 50 && c.daysWorked >= 3 && npc.health >= 50;
    sim.memory.remember(npc, unfair ? 'player_fired_unfair' : 'player_fired', { who: 'player', params: { days: c.daysWorked } });
    if (unfair) sim.progression.addReputation(-2);
    // Their friends among your other workers noticed.
    for (const other of this.list()) {
      const o = this.npcs().byId(other.npcId);
      if (o && sim.social.npcRel(o, npc) >= 30) sim.memory.remember(o, 'saw_friend_fired', { who: 'player', params: { npc: npc.id } });
    }
    sim.chronicle('chronicle.player_fired', { npc: npcId, gender: npc.gender });
    sim.toast('toast.fired', { npc: npcId }, 'info');
    sim.bus.emit('workers:changed');
  }

  setSalary(npcId, salary) {
    const c = this.contract(npcId);
    if (!c) return;
    const delta = salary - c.salary;
    c.salary = Math.max(1, Math.round(salary));
    // A raise cheers them up right away; a pay cut hurts more than a raise helps.
    c.satisfaction = Math.max(0, Math.min(100, c.satisfaction + (delta > 0 ? 4 : delta < 0 ? -8 : 0)));
    const npc = this.npcs().byId(npcId);
    if (npc && Math.abs(delta) >= 2) this.sim.memory.remember(npc, delta > 0 ? 'player_raise' : 'player_pay_cut', { who: 'player', params: { money: c.salary } });
    this.sim.bus.emit('workers:changed');
  }

  canPromote(npcId) {
    const c = this.contract(npcId);
    const npc = this.npcs().byId(npcId);
    if (!c || !npc) return { ok: false };
    const next = WORKER_RANKS[WORKER_RANKS.indexOf(c.rank) + 1];
    if (!next) return { ok: false, reason: 'max_rank' };
    if (npc.level < W.rankLevel[next]) return { ok: false, reason: 'need_npc_level', params: { level: W.rankLevel[next] } };
    return { ok: true, next };
  }

  /** Promotion: a new title, a raise in expectations — and a much happier worker. */
  promote(npcId) {
    const chk = this.canPromote(npcId);
    if (!chk.ok) return false;
    const c = this.contract(npcId);
    const npc = this.npcs().byId(npcId);
    c.rank = chk.next;
    c.satisfaction = Math.min(100, c.satisfaction + 20);
    c.salary = Math.max(c.salary, Math.round(c.salary * 1.15));
    this.sim.progression.addSkillXp('leadership', 25);
    this.sim.memory.remember(npc, 'player_promoted', { who: 'player', params: { worker_rank: chk.next, gender: npc.gender } });
    this.sim.chronicle('chronicle.worker_promoted', { npc: npcId, gender: npc.gender, worker_rank: chk.next });
    this.sim.toast('toast.promoted', { npc: npcId, worker_rank: chk.next }, 'good');
    this.sim.bus.emit('workers:changed');
    return true;
  }

  assign(npcId, assignment) {
    const c = this.contract(npcId);
    const npc = this.npcs().byId(npcId);
    if (!c || !npc) return;
    this.npcs().clearReservation(npc);
    c.assignment = assignment;
    npc.carry = null;
    // Re-plan right away if they're working.
    if (npc.task?.type === 'work') {
      npc.task = null;
      npc.nextThink = this.sim.time.total;
    }
    this.sim.bus.emit('workers:changed');
  }

  /** Team bonus from Leadership and from supervisors/managers on the payroll. */
  teamBonus() {
    let b = Mod.teamBonus(this.sim.state.player);
    for (const c of this.list()) b += W.rankTeamBonus[c.rank] || 0;
    return b;
  }

  /** How effective this worker is right now (1.0 = normal). */
  productivity(npcId) {
    const c = this.contract(npcId);
    const npc = this.npcs().byId(npcId);
    if (!c || !npc) return 0;
    const satisfaction = 0.7 + (c.satisfaction / 100) * 0.5;
    return Math.max(0.2, this.npcs().productivity(npc) * satisfaction * this.teamBonus());
  }

  // ------------------------------------------------------------------ daily payroll

  onDay() {
    const sim = this.sim;
    const p = sim.state.player;
    for (const c of this.list()) {
      const npc = this.npcs().byId(c.npcId);
      if (!npc) {
        delete this.contracts[c.npcId];
        continue;
      }
      if (npc.workedToday || c.workedFlag) {
        c.daysWorked++;
        if (p.money >= c.salary) {
          p.money -= c.salary;
          npc.money += c.salary;
          c.unpaid = 0;
          sim.progression.addSkillXp('leadership', 4);
        } else {
          c.unpaid++;
          sim.memory.remember(npc, 'player_unpaid', { who: 'player' });
          sim.toast('toast.worker_unpaid', { npc: npc.id }, 'danger');
        }
      }
      c.workedFlag = false;
      // Satisfaction: salary vs. expectations, being paid, their mood, how they like you.
      const expected = this.expectedSalary(npc, c.rank);
      let s = 55 + Math.max(-40, Math.min(35, (c.salary / expected - 1) * 100));
      s -= c.unpaid * 25;
      s += ((npc.mood ?? 60) - 60) / 3;
      if (sim.social.tier(npc) === 'friend') s += 6;
      if (sim.social.tier(npc) === 'trusted') s += 12;
      if (npc.traits.includes('loyal')) s += 8;
      s += Mod.perk(sim.state.player, 'worker_mood'); // a motivating boss
      c.satisfaction = Math.round(Math.max(0, Math.min(100, c.satisfaction * 0.5 + s * 0.5)));
      if (c.satisfaction < W.quitBelow && rand.chance(0.45 * traitValue(npc.traits, 'quitChance'))) {
        delete this.contracts[c.npcId];
        this.npcs().clearReservation(npc);
        npc.employer = null;
        npc.occupation = 'unemployed';
        npc.task = null;
        sim.memory.remember(npc, 'quit_player', { who: 'player', params: { days: c.daysWorked } });
        sim.chronicle('chronicle.worker_quit', { npc: npc.id, gender: npc.gender });
        sim.toast('toast.worker_quit', { npc: npc.id }, 'danger');
      }
    }
    sim.bus.emit('workers:changed');
  }

  // ------------------------------------------------------------------ the work itself

  /** Where workers bring goods: your storage shed if you have one, otherwise your home. */
  baseBuilding() {
    const shed = this.sim.construction.finished().find((c) => c.type === 'storage_shed');
    const id = shed ? shed.id : this.sim.state.player.homeId;
    return this.sim.world.buildings[id];
  }

  /** Called by NPCSystem when a worker starts (or resumes) working. */
  startWork(npc) {
    const c = this.contract(npc.id);
    if (!c) return this.npcs().startLeisure(npc);
    c.workedFlag = true;
    npc.workedToday = true;
    switch (c.assignment.type) {
      case 'gather_wood':
        return this.nextGather(npc, 'tree');
      case 'gather_stone':
        return this.nextGather(npc, 'rock');
      case 'build':
        return this.nextBuild(npc);
      case 'farm':
        return this.nextFarm(npc);
      case 'workshop':
        return this.nextWorkshop(npc);
      default:
        return this.goIdle(npc);
    }
  }

  // --- workshop: fetch raw material from your storage, then craft
  nextWorkshop(npc) {
    const c = this.contract(npc.id);
    const B = this.sim.businesses;
    const biz = B.get(c.assignment.bizId) || B.list()[0];
    if (!biz) return this.goIdle(npc);
    c.assignment.bizId = biz.id;
    npc.task.bizId = biz.id;
    const input = B.type(biz).input;
    const lowInput = B.stock(biz, input) < 4 || !B.hasWork(biz);
    if (lowInput && this.sim.home.storageCount(input) > 0) {
      npc.task.stage = 'to_storage_ws';
      const b = this.baseBuilding();
      return this.npcs().walkTo(npc, b.door.tx, b.door.ty);
    }
    if (!B.hasWork(biz)) return this.goIdle(npc);
    npc.task.stage = 'to_workshop';
    const wb = this.sim.world.buildings[biz.buildingId];
    this.npcs().walkTo(npc, wb.door.tx, wb.door.ty);
  }

  goIdle(npc) {
    const b = this.baseBuilding();
    npc.task.stage = 'to_idle';
    this.npcs().walkTo(npc, b.door.tx + 1, b.door.ty + 1);
  }

  // --- gathering
  nextGather(npc, kind) {
    const npcs = this.npcs();
    npcs.clearReservation(npc);
    const base = this.baseBuilding();
    const target = this.sim.resources.findNearest(kind, base.door.tx, base.door.ty, W.searchRadius, (o) => (!o.reservedBy || o.reservedBy === npc.id) && (kind !== 'rock' || o.variant === 'stone' || o.variant === 'coal'));
    if (!target) return this.goIdle(npc);
    target.reservedBy = npc.id;
    npc.task.targetId = target.id;
    npc.task.stage = 'to_target';
    let stand = null;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      if (!this.sim.world.isBlocked(target.tx + dx, target.ty + dy)) {
        stand = { tx: target.tx + dx, ty: target.ty + dy };
        break;
      }
    }
    stand = stand || this.sim.world.nearestWalkable(target.tx, target.ty + 1, 3);
    npcs.walkTo(npc, stand.tx, stand.ty);
  }

  // --- building
  nextBuild(npc) {
    const c = this.contract(npc.id);
    const cons = this.sim.construction;
    let site = cons.byId(c.assignment.siteId);
    if (!site || site.status !== 'site') site = cons.playerSites()[0];
    if (!site) return this.goIdle(npc);
    c.assignment.siteId = site.id;
    npc.task.siteId = site.id;
    // Haul materials first if the site is waiting for them and your storage has some.
    const missing = cons.missing(site);
    const haulable = Object.entries(missing).filter(([id]) => this.sim.home.storageCount(id) > 0);
    if (site.labor >= cons.maxLabor(site) - 1 && haulable.length) {
      npc.task.stage = 'to_storage';
      const b = this.baseBuilding();
      return this.npcs().walkTo(npc, b.door.tx, b.door.ty);
    }
    if (site.labor >= cons.maxLabor(site) - 1) return this.goIdle(npc); // nothing to do without materials
    npc.task.stage = 'to_site';
    this.npcs().walkTo(npc, site.tx + Math.floor(site.w / 2), site.ty + site.h);
  }

  // --- farming
  nextFarm(npc) {
    const farm = this.sim.farming;
    const base = this.baseBuilding();
    let best = null;
    let bestD = Infinity;
    for (const [k, f] of Object.entries(this.sim.state.fields)) {
      if (f.reservedBy && f.reservedBy !== npc.id) continue;
      let job = null;
      if (f.dead) job = 'clear';
      else if (farm.isRipe(f)) job = 'harvest';
      else if (f.crop && !f.watered) job = 'water';
      else if (!f.crop && this.seedFor(f)) job = 'plant';
      if (!job) continue;
      const [tx, ty] = k.split(',').map(Number);
      const d = Math.abs(tx - base.door.tx) + Math.abs(ty - base.door.ty);
      if (d < bestD) {
        bestD = d;
        best = { k, tx, ty, job };
      }
    }
    if (!best) return this.goIdle(npc);
    this.sim.state.fields[best.k].reservedBy = npc.id;
    Object.assign(npc.task, { stage: 'to_field', field: best.k, farmJob: best.job });
    const stand = this.sim.world.nearestWalkable(best.tx, best.ty + 1, 2);
    this.npcs().walkTo(npc, stand.tx, stand.ty);
  }

  /** Seeds in your storage that can be planted this season. */
  seedFor() {
    const season = this.sim.time.season;
    return this.sim.home.storage.find((s) => ITEMS[s.id].seed && CROPS[ITEMS[s.id].seed].seasons.includes(season))?.id || null;
  }

  /** NPCSystem forwards arrivals here. */
  arrive(npc) {
    const task = npc.task;
    const now = this.sim.time.total;
    const npcs = this.npcs();
    const prod = this.productivity(npc.id);
    switch (task.stage) {
      case 'to_idle':
        task.stage = 'idle_wait';
        task.until = now + 45;
        break;
      case 'to_target': {
        task.stage = 'doing';
        task.until = now + Math.round(W.gatherMinutes / prod);
        const obj = this.sim.resources.get(task.targetId);
        if (obj) npcs.face(npc, obj.tx, obj.ty);
        break;
      }
      case 'deliver': {
        if (npc.carry) {
          this.sim.home.store(npc.carry.item, npc.carry.qty, { force: true });
          this.sim.state.stats.workerGoods = (this.sim.state.stats.workerGoods || 0) + npc.carry.qty;
          npc.carry = null;
        }
        this.startWork(npc);
        break;
      }
      case 'to_storage': {
        const site = this.sim.construction.byId(task.siteId);
        if (!site) return this.startWork(npc);
        let load = 0;
        const carried = {};
        for (const [id, need] of Object.entries(this.sim.construction.missing(site))) {
          const n = this.sim.home.take(id, Math.min(need, W.carryLoad - load));
          if (n > 0) {
            carried[id] = n;
            load += n;
          }
          if (load >= W.carryLoad) break;
        }
        npc.carry = load ? { item: Object.keys(carried)[0], qty: load, items: carried } : null;
        task.stage = 'haul_to_site';
        npcs.walkTo(npc, site.tx + Math.floor(site.w / 2), site.ty + site.h);
        break;
      }
      case 'haul_to_site': {
        const site = this.sim.construction.byId(task.siteId);
        if (site && npc.carry?.items) for (const [id, qty] of Object.entries(npc.carry.items)) this.sim.construction.receive(site, id, qty);
        npc.carry = null;
        this.startWork(npc);
        break;
      }
      case 'to_site': {
        task.stage = 'building';
        task.until = now + W.buildBlockMinutes;
        const site = this.sim.construction.byId(task.siteId);
        if (site) npcs.face(npc, site.tx + site.w / 2, site.ty);
        break;
      }
      case 'to_field':
        task.stage = 'farming';
        task.until = now + Math.round(W.farmTaskMinutes / prod);
        break;
      case 'to_storage_ws': {
        const biz = this.sim.businesses.get(task.bizId);
        if (!biz) return this.startWork(npc);
        const input = this.sim.businesses.type(biz).input;
        const n = this.sim.home.take(input, W.carryLoad);
        npc.carry = n ? { item: input, qty: n } : null;
        task.stage = 'haul_to_ws';
        const wb = this.sim.world.buildings[biz.buildingId];
        npcs.walkTo(npc, wb.door.tx, wb.door.ty);
        break;
      }
      case 'haul_to_ws': {
        const biz = this.sim.businesses.get(task.bizId);
        if (biz && npc.carry) this.sim.businesses.receive(biz, npc.carry.item, npc.carry.qty);
        npc.carry = null;
        this.startWork(npc);
        break;
      }
      case 'to_workshop':
        task.stage = 'crafting';
        task.until = now + 60;
        npc.facing = 'up';
        break;
    }
  }

  /** NPCSystem forwards periodic checks here (every few minutes while working). */
  continueWork(npc) {
    const task = npc.task;
    const now = this.sim.time.total;
    if (!task.until || now < task.until) return;
    switch (task.stage) {
      case 'idle_wait':
        return this.startWork(npc);
      case 'doing':
        return this.finishGather(npc);
      case 'building': {
        const site = this.sim.construction.byId(task.siteId);
        if (site && site.status === 'site') this.sim.construction.addLabor(site, W.buildBlockMinutes * this.productivity(npc.id) * (1 + Mod.perk(this.sim.state.player, 'worker_build')));
        return this.startWork(npc);
      }
      case 'farming':
        this.finishFarm(npc, task);
        return this.startWork(npc);
      case 'crafting': {
        const biz = this.sim.businesses.get(task.bizId);
        if (biz) this.sim.businesses.addLabor(biz, 60 * this.productivity(npc.id));
        return this.startWork(npc);
      }
    }
  }

  finishGather(npc) {
    const res = this.sim.resources;
    const obj = res.get(npc.task.targetId);
    let carry = null;
    if (obj && res.isHarvestable(obj)) {
      if (obj.kind === 'tree') carry = { item: 'wood', qty: res.fellTree(obj.id) };
      else {
        const r = res.mineRock(obj.id);
        if (r.item) carry = { item: r.item, qty: r.qty };
      }
    }
    if (!carry) return this.startWork(npc);
    npc.carry = carry;
    npc.task.stage = 'deliver';
    const b = this.baseBuilding();
    this.npcs().walkTo(npc, b.door.tx, b.door.ty);
  }

  finishFarm(npc, task) {
    const f = this.sim.state.fields[task.field];
    if (!f) return;
    delete f.reservedBy;
    const farm = this.sim.farming;
    const [tx, ty] = task.field.split(',').map(Number);
    switch (task.farmJob) {
      case 'clear':
        Object.assign(f, { crop: null, growth: 0, dead: false, watered: false });
        break;
      case 'water':
        if (f.crop && !f.dead) f.watered = true;
        break;
      case 'harvest':
        if (farm.isRipe(f)) {
          const crop = CROPS[f.crop];
          this.sim.home.store(crop.item, rand.int(crop.yield[0], crop.yield[1]), { force: true });
          Object.assign(f, { crop: null, growth: 0, watered: false });
        }
        break;
      case 'plant': {
        const seed = this.seedFor();
        if (!f.crop && seed && this.sim.home.take(seed, 1)) Object.assign(f, { crop: ITEMS[seed].seed, growth: 0, dead: false, plantedDay: this.sim.time.day });
        break;
      }
    }
    this.sim.bus.emit('field:changed', { tx, ty });
  }

  /** Activity description for the Inspect panel. */
  activity(npc) {
    const c = this.contract(npc.id);
    const t = npc.task;
    const moving = npc.moving;
    if (!c || !t) return { key: 'idle', params: {} };
    if (t.stage === 'deliver') return { key: 'carrying_home', params: { item: npc.carry?.item || 'wood' } };
    if (t.stage === 'haul_to_site') return { key: 'hauling', params: {} };
    if (t.stage === 'to_storage') return { key: 'fetching_materials', params: {} };
    if (t.stage === 'building' || t.stage === 'to_site') return { key: moving ? 'going_to_site' : 'building', params: {} };
    if (t.stage === 'farming' || t.stage === 'to_field') return { key: 'working_your_fields', params: {} };
    if (t.stage === 'crafting' || t.stage === 'to_workshop') return { key: moving ? 'going_to_workshop' : 'working_workshop', params: {} };
    if (t.stage === 'haul_to_ws' || t.stage === 'to_storage_ws') return { key: 'hauling_wood', params: {} };
    if (t.stage === 'doing') return { key: c.assignment.type === 'gather_stone' ? 'working_mine' : 'working_chop', params: {} };
    if (t.stage === 'idle_wait' || t.stage === 'to_idle') return { key: 'waiting_orders', params: {} };
    return { key: moving ? 'going_to_work' : 'working_for_you', params: {} };
  }
}

export { W as WORKER_TUNING };
