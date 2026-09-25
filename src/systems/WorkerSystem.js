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
import { findPath } from '../world/Pathfinder.js';
import { HOUSING } from '../data/housing.js';
import { FOCUS, PRIORITY_WEIGHT, WORK_FIELDS, PROFESSIONS, WORKFORCE as WF } from '../data/workforce.js';

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
      jobs: { ...FOCUS.idle }, // a general hand until you say otherwise
      queue: [],
      blocked: {},
      stats: { done: 0, kinds: {} },
      state: 'idle',
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
    this.release(c); // nothing stays reserved in their name
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
    this.release(c);
    c.assignment = assignment;
    // The job becomes their focus: that work first, and what goes with it when there's none.
    c.jobs = { ...(FOCUS[assignment.type] || FOCUS.idle) };
    c.queue = [assignment.siteId, assignment.bizId].filter(Boolean);
    c.blocked = {};
    // Re-plan right away if they're working.
    if (npc.task?.type === 'work') {
      npc.task = null;
      npc.nextThink = this.sim.time.total;
    }
    this.sim.bus.emit('workers:changed');
  }

  /** How much you want a kind of work done by this worker: high · medium · low · off. */
  setPriority(npcId, cat, level) {
    const c = this.contract(npcId);
    if (!c) return;
    this.settings(c).jobs[cat] = level;
    this.sim.bus.emit('workers:changed');
  }

  /** Put a particular job at the front of a worker's list (a site, a building to repair). */
  enqueue(npcId, targetId) {
    const c = this.contract(npcId);
    if (!c) return;
    const q = this.settings(c).queue;
    if (!q.includes(targetId)) q.push(targetId);
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
        this.release(c);
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
  //
  // A worker never runs out of things to do by accident. The loop:
  //
  //   find work → choose the best task → reserve it (and a spot to stand) → walk there
  //   → work → the world changes → experience → find the next task → …
  //
  // Tasks aren't stored anywhere: they're read from the world each time (a site that
  // needs hands, materials it's waiting for, a tree, a field, a worn building), so they
  // can't go stale. A reservation is simply "which task and which spot" in the worker's
  // contract — fire the worker and the reservation is gone with them. Anything that goes
  // wrong (the target's gone, no way there, no materials, no room) blocks that task for a
  // while and the worker picks another; a watchdog catches anyone who stops moving.

  /** Where workers bring goods: your storage shed if you have one, otherwise your home. */
  baseBuilding() {
    const shed = this.sim.construction.finished().find((c) => c.type === 'storage_shed');
    const id = shed ? shed.id : this.sim.state.player.homeId;
    return this.sim.world.buildings[id] || this.sim.world.buildings.shack;
  }

  /** The contract's work settings, filled in for older saves. */
  settings(c) {
    c.jobs ??= { ...(FOCUS[c.assignment?.type] || FOCUS.idle) };
    c.queue ??= [];
    c.blocked ??= {};
    c.stats ??= { done: 0, kinds: {} };
    c.state ??= 'idle';
    return c;
  }

  setState(c, state, why = null) {
    if (c.state !== state || c.why !== why) {
      c.state = state;
      c.why = why;
      c.stateSince = this.sim.time.total;
    }
  }

  // --- what there is to do

  /** Every task the world offers this worker right now (the best first). */
  candidates(npc, c) {
    const sim = this.sim;
    const cons = sim.construction;
    const S = this.settings(c);
    const now = sim.time.total;
    const pos = sim.world.toTile(npc.x, npc.y);
    const out = [];
    const occupied = this.occupancy(npc.id);
    const add = (task) => {
      const prio = PRIORITY_WEIGHT[S.jobs[task.cat] || 'off'];
      if (!prio) return;
      if ((S.blocked[task.key] || 0) > now) return;
      if ((occupied[task.key] || 0) >= task.cap) return;
      const d = Math.abs(task.tx - pos.tx) + Math.abs(task.ty - pos.ty);
      const queued = S.queue.findIndex((q) => task.target === q || task.forSite === q);
      const field = WORK_FIELDS[task.kind];
      const skilled = field ? (sim.education?.competence(npc, field) || 0) / 6 : 0;
      task.score = prio * 100 - d * 0.7 + skilled + (task.urgent || 0) + (queued >= 0 ? 1000 - queued * 10 : 0);
      out.push(task);
    };
    const storage = (item) => sim.home.storageCount(item);
    const buyLeft = this.buyBudgetLeft();
    for (const site of cons.playerSites()) {
      const mid = { tx: site.tx + Math.floor(site.w / 2), ty: site.ty + site.h };
      const missing = cons.missing(site);
      // Hands on the site — as many as there's room for, while there are materials to work with.
      if (site.labor < cons.maxLabor(site) - 1) add({ key: `build:${site.id}`, kind: 'build', cat: 'construction', target: site.id, ...mid, cap: this.siteCapacity(site) });
      const waiting = site.labor >= cons.maxLabor(site) - 1; // out of materials: fetching them is urgent
      for (const item of Object.keys(missing)) {
        if (storage(item) > 0) add({ key: `haul:${site.id}:${item}`, kind: 'haul', cat: 'hauling', target: site.id, item, ...this.baseDoor(), cap: WF.haulersPerSite, urgent: waiting ? 60 : 0 });
        else {
          const seller = buyLeft > 0 && this.state.buy !== false ? this.seller(item) : null;
          if (seller) add({ key: `buy:${site.id}:${item}`, kind: 'buy', cat: 'hauling', target: site.id, item, seller: seller.id, ...seller.door, cap: 1, urgent: waiting ? 50 : 0 });
          else if (item === 'wood' || item === 'stone') {
            // Nobody sells it and it isn't in store: go and get it.
            const obj = this.findResource(item === 'wood' ? 'tree' : 'rock', npc, pos);
            if (obj) add({ key: `gather:${obj.id}`, kind: item === 'wood' ? 'gather_wood' : 'gather_stone', cat: 'gathering', target: obj.id, forSite: site.id, tx: obj.tx, ty: obj.ty, cap: 1, urgent: waiting ? 40 : 0 });
          }
        }
      }
    }
    // Gathering for your storage (what you told them to fetch; a general hand fetches wood).
    const gatherKinds = c.assignment?.type === 'gather_stone' ? ['rock'] : c.assignment?.type === 'gather_wood' ? ['tree'] : S.jobs.gathering === 'off' ? [] : ['tree'];
    for (const kind of gatherKinds) {
      const obj = this.findResource(kind, npc, pos);
      if (obj) add({ key: `gather:${obj.id}`, kind: kind === 'tree' ? 'gather_wood' : 'gather_stone', cat: 'gathering', target: obj.id, tx: obj.tx, ty: obj.ty, cap: 1 });
    }
    // Your fields.
    const field = S.jobs.farming !== 'off' && this.fieldJob(npc);
    if (field) add({ key: `farm:${field.k}`, kind: 'farm', cat: 'farming', target: field.k, farmJob: field.job, tx: field.tx, ty: field.ty, cap: 1 });
    // Your workshop.
    const B = sim.businesses;
    for (const biz of B.list()) {
      const wb = sim.world.buildings[biz.buildingId];
      if (!wb) continue;
      const input = B.type(biz).input;
      if ((B.stock(biz, input) < 4 || !B.hasWork(biz)) && storage(input) > 0) add({ key: `wsin:${biz.id}`, kind: 'haul_ws', cat: 'hauling', target: biz.id, item: input, ...this.baseDoor(), cap: 1 });
      if (B.hasWork(biz)) add({ key: `ws:${biz.id}`, kind: 'workshop', cat: 'workshop', target: biz.id, tx: wb.door.tx, ty: wb.door.ty, cap: 2 });
    }
    // Upkeep: your buildings that are wearing out (the worse, the sooner).
    for (const [id, r] of Object.entries(sim.property.all)) {
      if (r.owner !== 'player' || r.condition >= WF.repairBelow || !sim.world.buildings[id] || r.ruined) continue;
      if (!this.repairMaterials(id)) continue;
      const b = sim.world.buildings[id];
      add({ key: `repair:${id}`, kind: 'repair', cat: 'maintenance', target: id, tx: b.door.tx, ty: b.door.ty, cap: 2, urgent: r.condition < 30 ? 150 : 0 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** How many workers have reserved each task. */
  occupancy(except = null) {
    const out = {};
    for (const c of this.list()) if (c.npcId !== except && c.task) out[c.task.key] = (out[c.task.key] || 0) + 1;
    return out;
  }

  /** How many can work on a site at once: bigger buildings take more hands (and there must be room to stand). */
  siteCapacity(site) {
    return Math.max(1, Math.min(WF.maxPerSite, Math.round((site.w * site.h) / WF.tilesPerWorker), this.spots(site).length));
  }

  baseDoor() {
    const b = this.baseBuilding();
    return { tx: b.door.tx, ty: b.door.ty };
  }

  /**
   * Places to stand while working on a rectangle (a site, a building): all round it,
   * the front first — never the doorway, never a blocked tile.
   */
  spots(rect) {
    const w = this.sim.world;
    const out = [];
    const door = rect.door || (rect.target && this.sim.world.buildings[rect.target]?.door);
    const ok = (x, y) => w.inBounds(x, y) && !w.isBlocked(x, y) && !(door && door.tx === x && door.ty === y);
    for (let x = rect.tx; x < rect.tx + rect.w; x++) if (ok(x, rect.ty + rect.h)) out.push({ tx: x, ty: rect.ty + rect.h });
    for (let y = rect.ty + rect.h - 1; y >= rect.ty; y--) {
      if (ok(rect.tx - 1, y)) out.push({ tx: rect.tx - 1, ty: y });
      if (ok(rect.tx + rect.w, y)) out.push({ tx: rect.tx + rect.w, ty: y });
    }
    for (let x = rect.tx; x < rect.tx + rect.w; x++) if (ok(x, rect.ty - 1)) out.push({ tx: x, ty: rect.ty - 1 });
    // The middle of the front row first (it looks like working on it).
    const mid = rect.tx + rect.w / 2;
    return out.sort((a, b) => (a.ty === rect.ty + rect.h ? 0 : 1) - (b.ty === rect.ty + rect.h ? 0 : 1) || Math.abs(a.tx - mid) - Math.abs(b.tx - mid));
  }

  /** The nearest tree or rock nobody's working on — close by first, then further out. */
  findResource(kind, npc, pos) {
    const res = this.sim.resources;
    const base = this.baseBuilding();
    const taken = new Set(this.list().filter((c) => c.npcId !== npc.id && c.task).map((c) => c.task.target));
    const blocked = this.contract(npc.id)?.blocked || {};
    const now = this.sim.time.total;
    const ok = (o) => (!o.reservedBy || o.reservedBy === npc.id) && !taken.has(o.id) && !((blocked[`gather:${o.id}`] || 0) > now) && (kind !== 'rock' || o.variant === 'stone' || o.variant === 'coal');
    for (const r of WF.gatherRadii) {
      const o = res.findNearest(kind, base.door.tx, base.door.ty, r, ok);
      if (o) return o;
    }
    return res.findNearest(kind, pos.tx, pos.ty, 60, ok);
  }

  /** A field of yours that needs something doing (and nobody's on it). */
  fieldJob(npc) {
    const farm = this.sim.farming;
    const base = this.baseBuilding();
    let best = null;
    let bestD = Infinity;
    for (const [k, f] of Object.entries(this.sim.state.fields)) {
      if (f.reservedBy && f.reservedBy !== npc.id && this.contract(f.reservedBy)?.task?.target === k) continue;
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
    return best;
  }

  /** Seeds in your storage that can be planted this season. */
  seedFor() {
    const season = this.sim.time.season;
    return this.sim.home.storage.find((s) => ITEMS[s.id].seed && CROPS[ITEMS[s.id].seed].seasons.includes(season))?.id || null;
  }

  /** A business selling this material (the cheapest), for a worker sent to buy it. */
  seller(item) {
    const E = this.sim.economy;
    let best = null;
    for (const id of E.active()) {
      const d = E.def(id);
      if (E.stock(id, item) <= 0 || !(d.kind === 'producer' || d.kind === 'depot' || d.sells?.includes(item) || d.buys?.includes(item))) continue;
      const b = this.sim.world.buildings[E.biz(id).building];
      if (!b) continue;
      const price = this.unitPrice(id, item);
      if (!best || price < best.price) best = { id, price, door: { tx: b.door.tx, ty: b.door.ty } };
    }
    return best;
  }

  unitPrice(id, item) {
    const E = this.sim.economy;
    return Math.max(1, Math.round(E.def(id).kind === 'producer' ? (ITEMS[item]?.basePrice || 3) * E.priceFactor(id, item) * 0.9 : E.unitPrice(id, item)));
  }

  /** Money your workers may still spend today on materials (you set the limit — or turn it off). */
  buyBudgetLeft() {
    const S = this.state;
    if (S.buy === false) return 0;
    if (S.spentDay !== this.sim.time.day) {
      S.spentDay = this.sim.time.day;
      S.spent = 0;
    }
    return Math.max(0, Math.min(this.sim.state.player.money, (S.budget ?? WF.buyBudgetPerDay) - S.spent));
  }

  /** Workforce-wide settings (state.workforce). */
  get state() {
    return (this.sim.state.workforce ??= { buy: true, budget: WF.buyBudgetPerDay, spent: 0, spentDay: -1, log: [] });
  }

  /** Planks and stone from your storage for a stint of repairs (null if there aren't enough). */
  repairMaterials(id) {
    const r = this.sim.property.rec(id);
    const pts = Math.min(WF.repairPerBlock, 100 - r.condition);
    const need = {};
    for (const [item, per] of Object.entries(HOUSING.restorePerCondition)) need[item] = Math.ceil(pts * per);
    for (const [item, q] of Object.entries(need)) if (this.sim.home.storageCount(item) < q) return null;
    return { need, pts };
  }

  // --- the loop

  /** Called by NPCSystem when a worker starts (or resumes) working: always ends with them doing something. */
  startWork(npc) {
    const c = this.contract(npc.id);
    if (!c) return this.npcs().startLeisure(npc);
    this.settings(c);
    c.workedFlag = true;
    npc.workedToday = true;
    // Still carrying something from before (a shift cut short)? Take it where it was going first.
    if (npc.carry) return this.deliverCarry(npc, c);
    // A reservation from before (after lunch, after loading a save): keep it if it still makes sense.
    if (c.task && this.valid(npc, c, c.task)) return this.go(npc, c, c.task);
    this.release(c);
    return this.next(npc);
  }

  /** Choose the best task, reserve it, go. If there's nothing, wait a little and look again. */
  next(npc) {
    const c = this.settings(this.contract(npc.id));
    this.release(c);
    c.queue = c.queue.filter((q) => this.stillQueued(q));
    this.setState(c, 'seeking');
    // (A task that turns out impossible is blocked, and the list is looked at again without it.)
    for (let pass = 0; pass < 3; pass++) {
      const list = this.candidates(npc, c).slice(0, 6);
      if (!list.length) break;
      for (const task of list) if (this.go(npc, c, task)) return true;
    }
    // Nothing to do: out of materials? Say so. Otherwise wait near the storage and look again soon.
    const starved = this.sim.construction.playerSites().some((s) => s.labor >= this.sim.construction.maxLabor(s) - 1);
    this.setState(c, starved ? 'need_materials' : 'waiting');
    const b = this.baseBuilding();
    npc.task.stage = 'to_idle';
    this.npcs().walkTo(npc, b.door.tx + 1, b.door.ty + 1);
    return false;
  }

  /** Reserve a task and a place to stand, and walk there. False if it can't be done (it's blocked for a while). */
  go(npc, c, task) {
    const sim = this.sim;
    let stand = null;
    if (task.kind === 'build' || task.kind === 'repair') {
      const rect = task.kind === 'build' ? sim.construction.byId(task.target) : sim.world.buildings[task.target];
      if (!rect) return this.block(c, task);
      const used = new Set(this.list().filter((o) => o.npcId !== npc.id && o.task?.spot).map((o) => `${o.task.spot.tx},${o.task.spot.ty}`));
      const spots = this.spots(task.kind === 'build' ? rect : { tx: rect.tx, ty: rect.ty, w: rect.w, h: rect.h, door: rect.door }).filter((s) => !used.has(`${s.tx},${s.ty}`));
      stand = spots.find((s) => this.reachable(npc, s));
      if (!stand) return spots.length ? this.block(c, task) : false; // no free spot: someone else's turn (not a failure)
    } else if (task.kind === 'gather_wood' || task.kind === 'gather_stone') {
      const o = sim.resources.get(task.target);
      if (!o || !sim.resources.isHarvestable(o)) return this.block(c, task);
      stand = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dx, dy]) => ({ tx: o.tx + dx, ty: o.ty + dy })).find((s) => !sim.world.isBlocked(s.tx, s.ty) && this.reachable(npc, s));
      if (!stand) return this.block(c, task);
      o.reservedBy = npc.id;
    } else if (task.kind === 'farm') {
      const f = sim.state.fields[task.target];
      if (!f) return this.block(c, task);
      f.reservedBy = npc.id;
      stand = sim.world.nearestWalkable(task.tx, task.ty + 1, 2);
    } else {
      stand = sim.world.nearestWalkable(task.tx, task.ty, 3);
      if (!this.reachable(npc, stand)) return this.block(c, task);
    }
    c.task = { key: task.key, kind: task.kind, target: task.target, item: task.item, seller: task.seller, forSite: task.forSite, farmJob: task.farmJob, spot: stand, since: sim.time.total };
    npc.task.stage = 'to_task';
    npc.task.siteId = task.kind === 'build' ? task.target : npc.task.siteId;
    this.setState(c, 'moving');
    this.npcs().walkTo(npc, stand.tx, stand.ty);
    return true;
  }

  /** Can they get there? (Far from you, villagers skip the walk — so it always counts as reachable.) */
  reachable(npc, spot) {
    if (!spot) return false;
    if (npc.simLevel === 'statistical' || this.sim.time.isSkipping()) return !this.sim.world.isBlocked(spot.tx, spot.ty);
    const s = this.sim.world.toTile(npc.x, npc.y);
    if (s.tx === spot.tx && s.ty === spot.ty) return true;
    return !!findPath(this.sim.world, s.tx, s.ty, spot.tx, spot.ty, 12000);
  }

  /** Leave this task alone for a while (it couldn't be done) — the worker will pick another. */
  block(c, task, minutes = WF.blockFor) {
    c.blocked[task.key] = this.sim.time.total + minutes;
    for (const [k, until] of Object.entries(c.blocked)) if (until < this.sim.time.total) delete c.blocked[k];
    return false;
  }

  /** Drop the reservation (the task, the spot, the tree or field it was holding). */
  release(c) {
    const t = c?.task;
    if (!t) return;
    if (t.kind === 'gather_wood' || t.kind === 'gather_stone') {
      const o = this.sim.resources.get(t.target);
      if (o && o.reservedBy === c.npcId) delete o.reservedBy;
    }
    if (t.kind === 'farm') {
      const f = this.sim.state.fields[t.target];
      if (f && f.reservedBy === c.npcId) delete f.reservedBy;
    }
    c.task = null;
  }

  /** Is this task still worth doing? (The target's still there, there's still work in it.) */
  valid(npc, c, t) {
    const sim = this.sim;
    const cons = sim.construction;
    if ((c.blocked?.[t.key] || 0) > sim.time.total) return false;
    switch (t.kind) {
      case 'build': {
        const s = cons.byId(t.target);
        return !!s && s.status === 'site' && s.labor < cons.maxLabor(s) - 1;
      }
      case 'haul':
      case 'buy': {
        const s = cons.byId(t.target);
        return !!s && s.status === 'site' && (cons.missing(s)[t.item] || 0) > 0;
      }
      case 'gather_wood':
      case 'gather_stone': {
        const o = sim.resources.get(t.target);
        return !!o && sim.resources.isHarvestable(o) && (!o.reservedBy || o.reservedBy === npc.id);
      }
      case 'farm':
        return !!sim.state.fields[t.target];
      case 'workshop':
      case 'haul_ws':
        return !!sim.businesses.get(t.target);
      case 'repair':
        return (sim.property.rec(t.target)?.condition ?? 100) < 100 && !!this.repairMaterials(t.target);
      default:
        return false;
    }
  }

  /** Arrived somewhere (NPCSystem forwards arrivals here). */
  arrive(npc) {
    const sim = this.sim;
    const c = this.contract(npc.id);
    const task = npc.task;
    const now = sim.time.total;
    if (!c) return;
    this.settings(c);
    const prod = this.productivity(npc.id);
    if (task.stage === 'to_idle') {
      task.stage = 'idle_wait';
      task.until = now + WF.waitRetry;
      return;
    }
    if (task.stage === 'carry_home' || task.stage === 'carry_site') return this.unload(npc, c);
    const t = c.task;
    if (!t) return this.next(npc);
    // Check again on arrival: things change while you walk.
    if (!this.valid(npc, c, t)) return this.next(npc);
    this.setState(c, 'working');
    const face = (x, y) => this.npcs().face(npc, x, y);
    switch (t.kind) {
      case 'build': {
        const s = sim.construction.byId(t.target);
        face(s.tx + s.w / 2, s.ty + s.h / 2);
        task.stage = 'working';
        task.until = now + WF.workBlockMinutes;
        return;
      }
      case 'repair': {
        const b = sim.world.buildings[t.target];
        face(b.tx + b.w / 2, b.ty + b.h / 2);
        task.stage = 'working';
        task.until = now + WF.workBlockMinutes;
        return;
      }
      case 'gather_wood':
      case 'gather_stone': {
        const o = sim.resources.get(t.target);
        face(o.tx, o.ty);
        task.stage = 'working';
        task.until = now + Math.round(WF.gatherMinutes / prod);
        return;
      }
      case 'farm':
        task.stage = 'working';
        task.until = now + Math.round(WF.farmMinutes / prod);
        return;
      case 'workshop':
        task.stage = 'working';
        task.until = now + WF.workBlockMinutes;
        npc.facing = 'up';
        return;
      case 'haul': {
        // At your storage: take what the site still needs.
        const site = sim.construction.byId(t.target);
        const load = {};
        let n = 0;
        for (const [item, need] of Object.entries(sim.construction.missing(site))) {
          const got = sim.home.take(item, Math.min(need, WF.carryLoad - n));
          if (got > 0) {
            load[item] = got;
            n += got;
          }
          if (n >= WF.carryLoad) break;
        }
        if (!n) return this.next(npc);
        npc.carry = { item: Object.keys(load)[0], qty: n, items: load, to: site.id };
        return this.carryTo(npc, c, site.id);
      }
      case 'haul_ws': {
        const biz = sim.businesses.get(t.target);
        const got = sim.home.take(t.item, WF.carryLoad);
        if (!got) return this.next(npc);
        npc.carry = { item: t.item, qty: got, items: { [t.item]: got }, to: `biz:${biz.id}` };
        const wb = sim.world.buildings[biz.buildingId];
        task.stage = 'carry_site';
        this.setState(c, 'moving', 'carrying');
        return this.npcs().walkTo(npc, wb.door.tx, wb.door.ty);
      }
      case 'buy': {
        // At the seller's: buy what the site needs, with your money, within today's limit.
        const E = sim.economy;
        const site = sim.construction.byId(t.target);
        const price = this.unitPrice(t.seller, t.item);
        const qty = Math.min(sim.construction.missing(site)[t.item] || 0, WF.carryLoad, E.stock(t.seller, t.item), Math.floor(this.buyBudgetLeft() / price));
        if (qty <= 0) {
          this.block(c, t, 240);
          return this.next(npc);
        }
        const cost = qty * price;
        const p = sim.state.player;
        const pay = () => (p.money -= cost);
        if (sim.ledger?.as) sim.ledger.as('building', pay);
        else pay();
        E.biz(t.seller).stock[t.item] -= qty;
        E.biz(t.seller).money += cost;
        E.ledger(t.seller, 'rev', cost);
        this.state.spent += cost;
        this.state.log.unshift({ day: sim.time.day, npc: npc.id, item: t.item, qty, cost });
        this.state.log.length = Math.min(this.state.log.length, 12);
        npc.carry = { item: t.item, qty, items: { [t.item]: qty }, to: site.id };
        return this.carryTo(npc, c, site.id);
      }
      default:
        return this.next(npc);
    }
  }

  /** Walk a load to a site. */
  carryTo(npc, c, siteId) {
    const site = this.sim.construction.byId(siteId);
    if (!site) return this.deliverCarry(npc, c);
    npc.task.stage = 'carry_site';
    this.setState(c, 'moving', 'carrying');
    const spot = this.spots(site)[0] || { tx: site.tx + Math.floor(site.w / 2), ty: site.ty + site.h };
    return this.npcs().walkTo(npc, spot.tx, spot.ty);
  }

  /** Take whatever they're carrying where it belongs: the site it's for, your workshop, or your storage. */
  deliverCarry(npc, c) {
    const to = npc.carry?.to;
    const site = to && this.sim.construction.byId(to);
    if (site && site.status === 'site') return this.carryTo(npc, c, to);
    if (to && String(to).startsWith('biz:') && this.sim.businesses.get(to.slice(4))) {
      const wb = this.sim.world.buildings[this.sim.businesses.get(to.slice(4)).buildingId];
      npc.task.stage = 'carry_site';
      return this.npcs().walkTo(npc, wb.door.tx, wb.door.ty);
    }
    npc.task.stage = 'carry_home';
    this.setState(c, 'moving', 'carrying');
    const b = this.baseBuilding();
    return this.npcs().walkTo(npc, b.door.tx, b.door.ty);
  }

  /** Put the load down where they've arrived, then on to the next thing. */
  unload(npc, c) {
    const sim = this.sim;
    const load = npc.carry;
    if (load) {
      const items = load.items || { [load.item]: load.qty };
      const site = load.to && sim.construction.byId(load.to);
      const biz = load.to && String(load.to).startsWith('biz:') ? sim.businesses.get(load.to.slice(4)) : null;
      if (npc.task.stage === 'carry_site' && site && site.status === 'site') {
        // What the site can take goes in; anything over goes back to your storage later.
        const missing = sim.construction.missing(site);
        const rest = {};
        for (const [item, qty] of Object.entries(items)) {
          const put = Math.min(qty, missing[item] || 0);
          if (put > 0) sim.construction.receive(site, item, put);
          if (qty - put > 0) rest[item] = qty - put;
        }
        npc.carry = Object.keys(rest).length ? { item: Object.keys(rest)[0], qty: Object.values(rest).reduce((a, b) => a + b, 0), items: rest } : null;
      } else if (npc.task.stage === 'carry_site' && biz) {
        for (const [item, qty] of Object.entries(items)) sim.businesses.receive(biz, item, qty);
        npc.carry = null;
      } else {
        for (const [item, qty] of Object.entries(items)) sim.home.store(item, qty, { force: true });
        sim.state.stats.workerGoods = (sim.state.stats.workerGoods || 0) + load.qty;
        npc.carry = null;
      }
      if (c.task && ['haul', 'buy', 'haul_ws'].includes(c.task.kind)) this.completed(npc, c);
    }
    if (npc.carry) return this.deliverCarry(npc, c);
    return this.next(npc);
  }

  /** NPCSystem forwards periodic checks here while they're working. */
  continueWork(npc) {
    const task = npc.task;
    const now = this.sim.time.total;
    const c = this.contract(npc.id);
    if (!c) return;
    if (task.stage === 'idle_wait') {
      if (now >= task.until) this.next(npc);
      return;
    }
    if (task.stage !== 'working' || !task.until || now < task.until) return;
    this.finishStint(npc, c);
  }

  /** A stint of work done: the world changes, they learn from it, and they move on. */
  finishStint(npc, c) {
    const sim = this.sim;
    const t = c.task;
    if (!t || !this.valid(npc, c, t)) return this.next(npc);
    const skillMult = 1 + (sim.education?.competence(npc, WORK_FIELDS[t.kind]) || 0) / 200; // a practised hand works faster
    const prod = this.productivity(npc.id);
    switch (t.kind) {
      case 'build': {
        const site = sim.construction.byId(t.target);
        sim.construction.addLabor(site, WF.workBlockMinutes * prod * skillMult * (1 + Mod.perk(sim.state.player, 'worker_build')));
        break;
      }
      case 'repair': {
        const m = this.repairMaterials(t.target);
        if (m) {
          for (const [item, q] of Object.entries(m.need)) sim.home.take(item, q);
          const r = sim.property.rec(t.target);
          r.condition = Math.min(100, r.condition + m.pts * Math.min(1.5, skillMult));
          sim.bus.emit('building:changed', t.target);
        }
        break;
      }
      case 'gather_wood':
      case 'gather_stone': {
        const res = sim.resources;
        const o = res.get(t.target);
        let carry = null;
        if (o.kind === 'tree') carry = { item: 'wood', qty: res.fellTree(o.id) };
        else {
          const r = res.mineRock(o.id);
          if (r.item) carry = { item: r.item, qty: r.qty };
        }
        this.completed(npc, c);
        if (!carry) return this.next(npc);
        // Wood for a site that's waiting for it goes straight there (the work chain); the rest to your storage.
        npc.carry = { ...carry, items: { [carry.item]: carry.qty }, to: t.forSite || null };
        return this.deliverCarry(npc, c);
      }
      case 'farm':
        this.finishFarm(npc, { field: t.target, farmJob: t.farmJob });
        break;
      case 'workshop': {
        const biz = sim.businesses.get(t.target);
        if (biz) sim.businesses.addLabor(biz, WF.workBlockMinutes * prod * skillMult);
        break;
      }
    }
    this.completed(npc, c);
    return this.next(npc);
  }

  /** A task done: experience from the work itself, and it's counted. */
  completed(npc, c) {
    const t = c.task;
    if (!t) return;
    const field = WORK_FIELDS[t.kind];
    if (field) this.sim.education?.practise(npc, field, WF.practice);
    npc.xp = (npc.xp || 0) + WF.xpPerStint * (1 + Mod.perk(this.sim.state.player, 'worker_xp'));
    while (npc.xp >= this.npcs().xpForNext(npc.level)) {
      npc.xp -= this.npcs().xpForNext(npc.level);
      npc.level++;
      this.sim.toast('toast.worker_levelled', { npc: npc.id, n: npc.level }, 'good');
    }
    c.stats.done++;
    c.stats.kinds[t.kind] = (c.stats.kinds[t.kind] || 0) + 1;
    // Finished what was queued for them? Take it off the list.
    c.queue = c.queue.filter((q) => this.stillQueued(q));
    this.release(c);
  }

  /** Is there still work in a queued job (a site not finished yet, a building still worn)? */
  stillQueued(id) {
    const s = this.sim.construction.byId(id);
    if (s) return s.status === 'site';
    const r = this.sim.property.rec(id);
    return r ? r.condition < 100 : false;
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

  // --- never stuck

  /**
   * The watchdog (every ten minutes): anyone walking too long, working past the end of a
   * stint, waiting too long, holding a task they can't be doing (at lunch, asleep, ill),
   * or holding a task that's no longer there — is put right and sent on to the next thing.
   */
  watchdog() {
    const sim = this.sim;
    const now = sim.time.total;
    for (const c of this.list()) {
      const npc = this.npcs().byId(c.npcId);
      if (!npc) continue;
      this.settings(c);
      const t = npc.task;
      // Not working now (lunch, home time, ill, a fire): let others have the task.
      if (t?.type !== 'work') {
        if (c.task) this.release(c);
        this.setState(c, this.offState(npc));
        continue;
      }
      const since = now - (c.stateSince ?? now);
      const moving = this.npcs().paths.has(npc.id);
      let stuck = null;
      if (moving && since > WF.stuckWalking) stuck = 'walking';
      else if (!moving && t.stage === 'working' && t.until && now > t.until + WF.stuckWorking) stuck = 'working';
      else if (!moving && t.stage === 'to_task' && since > 30) stuck = 'arrived';
      else if (!moving && (t.stage === 'carry_site' || t.stage === 'carry_home') && since > 30) stuck = 'carrying';
      else if (!moving && t.stage === 'idle_wait' && now > (t.until || 0) + WF.stuckWaiting) stuck = 'waiting';
      else if (c.task && !this.valid(npc, c, c.task) && t.stage !== 'carry_site' && t.stage !== 'carry_home') stuck = 'invalid';
      if (!stuck) continue;
      c.unstuck = (c.unstuck || 0) + 1;
      c.lastStuck = { day: sim.time.day, why: stuck };
      this.npcs().paths.delete(npc.id);
      npc.moving = false;
      if (c.task && stuck !== 'invalid') this.block(c, c.task, 60);
      this.release(c);
      if (npc.carry) this.deliverCarry(npc, c);
      else this.next(npc);
    }
  }

  /** What a worker is doing when they're not at work. */
  offState(npc) {
    const type = npc.task?.type;
    if (type === 'sleep') return 'sleeping';
    if (type === 'eat' || type === 'shop') return 'eating';
    if (type === 'rest' || type === 'home' || type === 'leisure') return npc.moving ? 'returning_home' : 'resting';
    if (type === 'sick') return 'unavailable';
    return 'idle';
  }

  // --- for the UI

  /** What they're called from what they're best at, and how good they are at each kind of work. */
  profile(npc) {
    const E = this.sim.education;
    const skills = ['building', 'forestry', 'mining', 'farming', 'carpentry', 'trade'].map((f) => ({ field: f, v: Math.round(E?.competence(npc, f) || 0) })).sort((a, b) => b.v - a.v);
    const best = skills[0];
    const profession = best && best.v >= 18 ? PROFESSIONS[best.field] : 'general';
    const reliability = Math.round(Math.max(10, Math.min(99, 60 + (npc.traits.includes('hardworking') ? 20 : 0) + (npc.traits.includes('lazy') ? -25 : 0) + (npc.traits.includes('loyal') ? 10 : 0) + (npc.traits.includes('careful') ? 8 : 0))));
    return { profession, level: npc.level, skills: skills.slice(0, 3), reliability, speed: Math.round(this.npcs().productivity(npc) * 100) };
  }

  /** The current task in words (the worker card). */
  taskLabel(c) {
    const t = c.task;
    if (!t) return null;
    return { key: `wtask.${t.kind}`, params: { building: ['build', 'haul', 'buy'].includes(t.kind) ? this.siteBuilding(t.target) : t.kind === 'repair' ? t.target : undefined, item: t.item } };
  }

  siteBuilding(siteId) {
    const s = this.sim.construction.byId(siteId);
    return s?.kind === 'works' ? s.target : undefined;
  }

  /** Activity description for the Inspect panel. */
  activity(npc) {
    const c = this.contract(npc.id);
    const t = npc.task;
    if (!c || !t) return { key: 'idle', params: {} };
    const k = c.task?.kind;
    if (t.stage === 'carry_home') return { key: 'carrying_home', params: { item: npc.carry?.item || 'wood' } };
    if (t.stage === 'carry_site') return { key: 'hauling', params: {} };
    if (t.stage === 'idle_wait' || t.stage === 'to_idle') return { key: c.state === 'need_materials' ? 'waiting_materials' : 'waiting_orders', params: {} };
    if (k === 'build') return { key: npc.moving ? 'going_to_site' : 'building', params: {} };
    if (k === 'repair') return { key: npc.moving ? 'going_to_site' : 'repairing', params: {} };
    if (k === 'haul') return { key: 'fetching_materials', params: {} };
    if (k === 'buy') return { key: 'buying_materials', params: { item: c.task.item } };
    if (k === 'farm') return { key: 'working_your_fields', params: {} };
    if (k === 'workshop') return { key: npc.moving ? 'going_to_workshop' : 'working_workshop', params: {} };
    if (k === 'haul_ws') return { key: 'hauling_wood', params: {} };
    if (k === 'gather_wood') return { key: 'working_chop', params: {} };
    if (k === 'gather_stone') return { key: 'working_mine', params: {} };
    return { key: npc.moving ? 'going_to_work' : 'working_for_you', params: {} };
  }
}

export { W as WORKER_TUNING };
