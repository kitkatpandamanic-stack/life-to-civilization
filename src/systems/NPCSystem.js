/**
 * NPCSystem — villagers living their own lives.
 *
 * Every few game minutes each villager "thinks": based on the time, their
 * schedule, hunger, money, job, the weather and their personality they pick
 * a goal (sleep, work, eat, shop, relax) and then physically walk there using
 * A* pathfinding.
 *
 * Work is physical: woodcutters really fell trees and carry the wood to the
 * lumberyard, miners break rocks, farmhands tend the fields. Wages are paid
 * from the employer's real money; food is bought from the store's real stock.
 *
 * Simulation levels (for scaling to hundreds of villagers later):
 *   full      — near the player: smooth movement + animation (see NPCView)
 *   abstract  — far away: same decisions, no rendering/animation cost
 * A future "statistical" level will simulate distant settlements as numbers.
 */
import { Mod } from './Modifiers.js';
import { BALANCE } from '../config/balance.js';
import { OCCUPATIONS } from '../data/occupations.js';
import { FOOD } from './EconomySystem.js';
import { AREAS } from '../data/villageLayout.js';
import { traitValue } from '../data/traits.js';
import { rand } from '../core/rng.js';
import { findPath } from '../world/Pathfinder.js';

const NB = BALANCE.npc;

export class NPCSystem {
  constructor(sim) {
    this.sim = sim;
    this.paths = new Map(); // runtime only: npc id → remaining path
    this.index = new Map();
    for (const n of this.list) this.register(n);
    this.initRelations();
    sim.bus.on('time:minute', (m) => this.onMinute(m));
    sim.bus.on('time:hour', (h) => this.onHour(h));
    sim.bus.on('time:day', () => this.onDay());
  }

  /** Add an NPC to the index and fill in any fields missing from older saves. */
  register(n) {
    this.index.set(n.id, n);
    // Tasks are re-planned after loading (paths are runtime-only and not saved).
    n.task = null;
    // Stagger decisions so villagers don't all think on the same minute.
    let h = 0;
    for (const c of n.id) h = (h * 31 + c.charCodeAt(0)) % 997;
    n.nextThink = h % NB.thinkEveryMinutes;
    n.energy ??= 90;
    n.health ??= 100;
    n.mood ??= 60;
    n.social ??= 60; // need for company (0 = lonely)
    n.relations ??= {};
    // Older saves stored a single friendship number per villager.
    for (const [id, v] of Object.entries(n.relations)) {
      if (typeof v === 'number') n.relations[id] = { f: v, t: Math.round(v * 0.5), r: 0, c: v < 0 ? Math.round(-v * 0.5) : 0 };
    }
    n.pb ??= { t: Math.round((n.rel || 0) * 0.3), r: 0, c: 0 };
    n.memories ??= [];
    n.family ??= [];
    delete n.moving;
    delete n.talkingToPlayer;
  }

  get list() {
    return this.sim.state.npcs;
  }

  /** A new villager enters the world (born, or arriving from elsewhere). */
  spawn(data) {
    const S = this.sim.state;
    const id = data.id || `n${S.settlement.nextNpcId++}`;
    const home = data.homeId && this.world.buildings[data.homeId];
    const pos = data.x !== undefined ? { x: data.x, y: data.y } : home ? this.world.tileCenter(home.door.tx, home.door.ty) : this.world.tileCenter(45, 44);
    const npc = {
      id,
      nameIdx: 0,
      gender: 'm',
      age: 18,
      homeId: null,
      occupation: 'unemployed',
      employer: null,
      owns: null,
      family: [],
      traits: [],
      money: 0,
      hunger: 80,
      energy: 90,
      pantry: 0,
      level: 1,
      xp: 0,
      skills: {},
      rel: 0,
      met: false,
      lastChatDay: -1,
      lastGiftDay: -1,
      relations: {},
      x: pos.x,
      y: pos.y,
      facing: 'down',
      inside: data.homeId && data.x === undefined ? data.homeId : null,
      task: null,
      nextThink: 0,
      workedToday: false,
      unpaidDays: 0,
      ...data,
    };
    npc.id = id;
    S.npcs.push(npc);
    this.register(npc);
    this.invalidateHouseholds();
    this.sim.family.normalize(npc);
    this.sim.family.syncFamily(npc);
    this.sim.habits.derive(npc, true);
    this.sim.bus.emit('npc:added', npc.id);
    return npc;
  }

  /** A villager leaves the world (died, or moved away). */
  remove(npc) {
    this.clearReservation(npc);
    this.paths.delete(npc.id);
    this.index.delete(npc.id);
    const S = this.sim.state;
    S.npcs.splice(S.npcs.indexOf(npc), 1);
    if (S.workers[npc.id]) {
      delete S.workers[npc.id];
      this.sim.bus.emit('workers:changed');
    }
    S.jobs.requests = S.jobs.requests.filter((r) => r.npcId !== npc.id);
    for (const o of S.npcs) {
      delete o.relations[npc.id];
      if (o.shopTarget === npc.id) o.shopTarget = null;
    }
    this.invalidateHouseholds();
    this.sim.bus.emit('npc:removed', npc.id);
  }

  invalidateHouseholds() {
    this.households = null;
  }
  get world() {
    return this.sim.world;
  }
  get time() {
    return this.sim.time;
  }
  byId(id) {
    return this.index.get(id) || null;
  }
  occ(npc) {
    return OCCUPATIONS[npc.occupation] || OCCUPATIONS.unemployed;
  }

  /** What they physically do at work. A foreman with no crew picks up the axe (or pick) himself. */
  activityOf(npc) {
    const occ = this.occ(npc);
    if (occ.activity === 'spot' && npc.owns && ['lumberyard', 'quarry'].includes(this.sim.economy.def(npc.owns)?.type) && !this.staffOf(npc.owns).length) {
      return this.sim.economy.def(npc.owns).type === 'lumberyard' ? 'chop' : 'mine';
    }
    return occ.activity;
  }
  workBusiness(npc) {
    return npc.owns || npc.employer || null;
  }
  workBuilding(npc) {
    const biz = this.workBusiness(npc);
    if (biz === 'player') return this.sim.workers.baseBuilding(); // hired by the player
    return biz ? this.sim.economy.buildingOf(biz) : null;
  }
  residentsOf(buildingId) {
    if (!buildingId) return [];
    return this.householdMap().get(buildingId) || [];
  }
  insideOf(buildingId) {
    return this.list.filter((n) => n.inside === buildingId);
  }

  /** Families and co-workers start out knowing each other. */
  initRelations() {
    for (const a of this.list) {
      for (const b of this.list) {
        if (a === b || a.relations[b.id] !== undefined) continue;
        if (a.family.includes(b.id)) a.relations[b.id] = { f: 70, t: 60, r: 20, c: 0 };
        else if (this.workBusiness(a) && this.workBusiness(a) === this.workBusiness(b)) a.relations[b.id] = { f: 25, t: 15, r: 10, c: 0 };
        else if (a.homeId === b.homeId) a.relations[b.id] = { f: 30, t: 20, r: 5, c: 0 };
      }
    }
  }

  // ------------------------------------------------------------------
  // Real-time movement (called every frame)
  // ------------------------------------------------------------------
  update(deltaMs) {
    const skipping = this.time.isSkipping();
    const p = this.sim.state.player;
    const weatherMove = this.sim.weather.mods().move;
    for (const npc of this.list) {
      const dist = Math.hypot(npc.x - p.x, npc.y - p.y);
      npc.simLevel = dist < NB.fullSimRadius ? 'full' : dist < NB.statisticalRadius ? 'abstract' : 'statistical';
      const path = this.paths.get(npc.id);
      if (!path) {
        npc.moving = false;
        continue;
      }
      if (npc.talkingToPlayer) {
        npc.moving = false;
        continue;
      }
      if (skipping) {
        this.teleportToPathEnd(npc);
        continue;
      }
      const ageMult = npc.age < 14 ? 1.15 : npc.age > 60 ? 0.85 : 1;
      const road = this.world.isRoad(path[0].tx, path[0].ty) ? 1 + NB.roadSpeedBonus : 1;
      let step = NB.walkSpeed * weatherMove * ageMult * road * (deltaMs / 1000);
      while (step > 0 && path.length) {
        const c = this.world.tileCenter(path[0].tx, path[0].ty);
        const dx = c.x - npc.x;
        const dy = c.y - npc.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > Math.abs(dy)) npc.facing = dx > 0 ? 'right' : 'left';
        else if (d > 0.01) npc.facing = dy > 0 ? 'down' : 'up';
        if (d <= step) {
          npc.x = c.x;
          npc.y = c.y;
          path.shift();
          step -= d;
        } else {
          npc.x += (dx / d) * step;
          npc.y += (dy / d) * step;
          step = 0;
        }
      }
      npc.moving = path.length > 0;
      if (!path.length) {
        this.paths.delete(npc.id);
        this.arrive(npc);
      }
    }
  }

  teleportToPathEnd(npc) {
    const path = this.paths.get(npc.id);
    if (path?.length) {
      const last = path[path.length - 1];
      const c = this.world.tileCenter(last.tx, last.ty);
      npc.x = c.x;
      npc.y = c.y;
    }
    this.paths.delete(npc.id);
    npc.moving = false;
    this.arrive(npc);
  }

  // ------------------------------------------------------------------
  // Minute tick: needs + decisions
  // ------------------------------------------------------------------
  onMinute(now) {
    this.households = null; // recomputed lazily once per minute
    for (const npc of this.list) {
      if (npc.away) continue; // beyond the valley (see ExplorationSystem)
      this.updateNeeds(npc);
      if (npc.talkingToPlayer) continue;
      if (now >= npc.nextThink && !this.paths.has(npc.id)) {
        npc.nextThink = now + NB.thinkEveryMinutes;
        this.think(npc);
      }
    }
    if (now % 10 === 0) this.socialize();
  }

  /** Hunger, energy and health change every minute depending on what the villager is doing. */
  updateNeeds(npc) {
    const hr = 1 / 60;
    const type = npc.task?.type;
    const asleep = type === 'sleep' && (npc.inside || npc.task?.stage === 'rough');
    const resting = !asleep && npc.inside && (type === 'home' || type === 'rest' || type === 'sick');
    const working = type === 'work' && !npc.moving;
    npc.hunger = Math.max(0, npc.hunger - (asleep ? NB.hungerPerHour * 0.35 : NB.hungerPerHour) * hr);
    if (asleep) npc.energy += NB.energySleepPerHour * (npc.task.stage === 'rough' ? 0.6 : 1) * hr;
    else if (resting) npc.energy += NB.energyRestPerHour * hr;
    else npc.energy -= (working ? NB.energyDrainWorkingPerHour : NB.energyDrainPerHour) * hr;
    if (npc.hunger <= 0) {
      npc.health -= NB.starvingHealthPerHour * hr;
      npc.starved = true;
    }
    else if (npc.energy <= 0) npc.health -= NB.exhaustedHealthPerHour * hr;
    else if (npc.hunger > 40 && npc.energy > 30) npc.health += NB.healthRegenPerHour * (type === 'sick' ? 2 : 1) * hr;
    npc.energy = Math.max(0, Math.min(100, npc.energy));
    npc.health = Math.max(1, Math.min(100, npc.health));
    // Company: family at home and friends keep loneliness away; outgoing people need more of it.
    if (!asleep) {
      const withFamily = npc.inside && npc.inside === npc.homeId && (this.householdMap().get(npc.homeId)?.length || 1) > 1;
      const soc = npc.habits?.sociability ?? 0.5;
      npc.social += withFamily ? NB.socialHomePerHour * hr : -NB.socialDrainPerHour * (0.5 + soc) * hr;
      npc.social = Math.max(0, Math.min(100, npc.social));
    }
  }

  think(npc) {
    const task = npc.task;
    const now = this.time.total;
    const desired = this.decide(npc);
    // Busy with something timed (eating, chopping...)? Finish it unless it's bedtime.
    const busy = task && task.until && now < task.until && ['eat', 'shop', 'work'].includes(task.type);
    if (busy && task.type !== desired.type && desired.type !== 'sleep') return;
    if (task && task.type === desired.type && !task.done) {
      this.continueTask(npc);
      return;
    }
    this.startTask(npc, desired);
  }

  /** The heart of villager behaviour: what should I be doing right now? */
  decide(npc) {
    const occ = this.occ(npc);
    const h = this.time.hourFloat;
    const habits = this.sim.habits;
    const wake = habits.wakeHour(npc, occ) + traitValue(npc.traits, 'lateWake', 0);
    const sleep = habits.sleepHour(npc, occ);
    // Moving away: walk out of the village.
    if (npc.leaving) return { type: 'leave' };
    // Fire! Able-bodied villagers nearby drop everything and come to help.
    const fire = this.nearbyFire(npc);
    if (fire) return { type: 'firefight', building: fire.building };
    // 1. Night: sleep.
    if (h < wake || h >= sleep) return { type: 'sleep' };
    // Babies and toddlers stay at home with the family.
    if (npc.age < 5 && npc.homeId) return npc.hunger < 40 ? { type: 'eat', where: 'home' } : { type: 'home' };
    // 2. Urgent needs override everything else (with some hysteresis so they actually recover).
    const cur = npc.task?.type;
    if (npc.health < NB.sickBelow || (cur === 'sick' && npc.health < NB.sickBelow + 20)) return { type: 'sick' };
    if (cur === 'rest' && npc.energy < 40 && npc.hunger >= 15) return { type: 'rest' };
    if (npc.hunger < 15) return this.eatChoice(npc, false);
    if (npc.energy < NB.exhaustedBelow * traitValue(npc.traits, 'tireMult')) return { type: 'rest' };
    // 3. Breakfast at home right after waking up.
    if (h < wake + 1 && npc.hunger < 85 && npc.homeId && this.householdPantry(npc) > 0) return { type: 'eat', where: 'home' };
    // School: children on weekday mornings (and the teacher), once the village has a school.
    const school = this.sim.tech?.schoolFor(npc) || this.sim.tech?.teaching(npc);
    if (school) return { type: 'school', where: school };
    // 4. Work hours (seasonal jobs have no work in the off-season).
    const inSeason = !occ.seasons || occ.seasons.includes(this.time.season);
    const working = occ.workplace && this.workBusiness(npc) && inSeason && !habits.isRestDay(npc, occ) && h >= occ.start && h < occ.end;
    if (working) {
      if (occ.lunch && h >= 12 && h < 13 && npc.hunger < 75) return this.eatChoice(npc, true);
      return { type: 'work' };
    }
    // 5. No job? Go and look for one (mornings).
    const labouring = npc.dayLabour?.day === this.time.day;
    if (occ.seeksJob && npc.age >= 16 && h >= 8 && h < 13 && npc.searchedDay !== this.time.day && !labouring) return { type: 'job_search' };
    // 6. Evening: food, shopping, socializing — then home.
    if (npc.hunger < NB.eatAt) return this.eatChoice(npc, false);
    // Decided to go furniture shopping at the player's workshop (see BusinessSystem.pickCustomers).
    if (npc.shopTarget) {
      const biz = this.sim.businesses.atBuilding(npc.shopTarget);
      if (biz && this.sim.businesses.isOpen(biz)) return { type: 'shop', where: npc.shopTarget };
      if (!biz || h >= this.sim.businesses.type(biz).openHours[1]) npc.shopTarget = null;
    }
    const household = this.residentsOf(npc.homeId).length || 1;
    // Market day: the weekly big shop.
    const marketDay = npc.habits?.marketDay === this.time.weekday;
    const stockUpTo = (marketDay ? 4 : 2) * household;
    if (npc.homeId && this.householdPantry(npc) < stockUpTo && npc.money >= 12 && npc.shoppedDay !== this.time.day) {
      const shop = this.groceryShop(npc);
      if (shop) return shop;
    }
    if (this.sim.weather.isBad()) return { type: 'home' };
    if (npc.energy < 30) return { type: 'rest' };
    const homeBy = sleep - (npc.habits?.chronotype === 'late' || npc.traits.includes('friendly') ? 1 : 2);
    if (h >= homeBy && !this.isTavern(npc.task?.enter)) return { type: 'home' };
    // Free time follows personal habits (and sticks for a while).
    const plan = habits.currentPlan(npc);
    if (plan.kind === 'home' && npc.homeId) return { type: 'home' };
    return { type: 'leisure' };
  }

  /** A fire close enough to come running (for awake, healthy adults). */
  nearbyFire(npc) {
    const fires = this.sim.state.fires;
    if (!fires?.length || npc.age < 14 || npc.health < 40) return null;
    if (npc.task?.type === 'sleep' && npc.inside) return null;
    for (const f of fires) {
      const b = this.world.buildings[f.building];
      if (b && Math.hypot(b.door.tx * 32 - npc.x, b.door.ty * 32 - npc.y) < 32 * 32) return f;
    }
    return null;
  }

  /** A shopping trip to whichever food shop this villager prefers (price, habit, friendship with the owner…). */
  groceryShop(npc) {
    if (npc.age < 16 || npc.money < 6) return null;
    const id = this.sim.economy.chooseShop(npc, FOOD);
    return id ? { type: 'shop', where: this.sim.economy.biz(id).building, biz: id } : null;
  }

  canShop(npc) {
    return !!this.groceryShop(npc);
  }

  /** Is this building a tavern (any tavern, not just the old one)? */
  isTavern(buildingId) {
    if (!buildingId) return false;
    const id = this.sim.economy.businessAtBuilding(buildingId);
    return !!id && this.sim.economy.def(id).type === 'tavern';
  }

  /** The tavern this villager would go to (open now), if any. */
  pickTavern(npc, needStew = false) {
    const E = this.sim.economy;
    if (needStew) return E.chooseShop(npc, ['stew'], { type: 'tavern' });
    return E.chooseShop(npc, ['stew', 'pie'], { type: 'tavern' }) || E.ofType('tavern').find((id) => E.isOpen(id)) || null;
  }

  /** Saving up to open a business: no meals out, few drinks. */
  isSaving(npc) {
    const t = npc.traits;
    return !npc.owns && npc.age >= 18 && (t.includes('entrepreneur') || (t.includes('ambitious') && t.includes('risk_taker'))) && npc.money < 450;
  }

  eatChoice(npc, lunch) {
    const tavern = npc.money >= BALANCE.economy.npcMealPrice && !(this.isSaving(npc) && !this.householdPantry(npc) === 0) ? this.pickTavern(npc, true) : null;
    const noFood = this.householdPantry(npc) <= 0;
    const chance = BALANCE.economy.tavernLunchChance * (lunch ? 1 : 0.5) * (0.4 + (npc.habits?.lunchOut ?? 0.5) * 1.4) * (this.isSaving(npc) ? 0.15 : 1);
    if (tavern && (noFood || rand.chance(chance))) return { type: 'eat', where: this.sim.economy.biz(tavern).building, biz: tavern };
    // Empty pantry at home? Go buy food first.
    if (noFood) {
      const shop = this.groceryShop(npc);
      if (shop) return shop;
    }
    return { type: 'eat', where: 'home' };
  }

  startTask(npc, desired) {
    this.clearReservation(npc);
    npc.task = { type: desired.type, stage: 'start', data: desired, until: 0 };
    switch (desired.type) {
      case 'sleep':
      case 'home':
      case 'rest':
      case 'sick':
        return npc.homeId ? this.goInto(npc, npc.homeId) : this.goShelter(npc);
      case 'job_search':
        return this.startJobSearch(npc);
      case 'eat': {
        if (desired.biz) return this.goInto(npc, desired.where);
        if (npc.homeId) return this.goInto(npc, npc.homeId);
        const tavern = this.pickTavern(npc, true);
        if (tavern) {
          desired.biz = tavern;
          return this.goInto(npc, this.sim.economy.biz(tavern).building);
        }
        // No home and nowhere open to eat: whatever scraps they can find.
        this.eatNow(npc, null);
        npc.task.done = true;
        return;
      }
      case 'shop': {
        if (desired.where) return this.goInto(npc, desired.where);
        const shop = this.groceryShop(npc);
        if (!shop) {
          npc.task.done = true;
          return;
        }
        npc.task.data = shop;
        return this.goInto(npc, shop.where);
      }
      case 'work':
        return this.startWork(npc);
      case 'school':
        return this.goInto(npc, desired.where);
      case 'leisure':
        return this.startLeisure(npc);
      case 'firefight': {
        const b = this.world.buildings[desired.building];
        npc.task.target = { building: desired.building };
        this.leaveBuilding(npc);
        npc.task.stage = 'running';
        return this.walkTo(npc, b.door.tx + rand.int(-2, 2), b.door.ty + rand.int(0, 1));
      }
      case 'leave': {
        const to = npc.leaveTo || { tx: 6, ty: 46 };
        npc.task.stage = 'walking';
        return this.walkTo(npc, to.tx, to.ty);
      }
    }
  }

  continueTask(npc) {
    const task = npc.task;
    const now = this.time.total;
    if (task.type === 'work') {
      npc.workedToday = true;
      if (npc.employer === 'player') return this.sim.workers.continueWork(npc);
      const act = this.activityOf(npc);
      if (task.stage === 'doing' && now >= task.until) {
        if (act === 'farm') this.nextFarmPlot(npc);
        else if (act === 'chop' || act === 'mine') this.finishGather(npc);
        else if (act === 'fish') this.finishFishing(npc);
        else if (act === 'build') {
          const c = this.sim.construction.byId(task.siteId);
          if (c && c.status === 'site') this.sim.growth.builderWorked(npc, c, (now - (task.until - 110)) * this.productivity(npc));
          // Finishing a building can change their life (the village's new mill may need a miller).
          if (npc.task === task) this.nextBuild(npc);
        }
      } else if (task.stage === 'idle_wait' && now >= task.until) {
        this.startWork(npc);
      }
    } else if (task.type === 'leisure') {
      if (task.stage === 'idle' && now >= task.until) {
        this.finishLeisure(npc);
        // Plan still running? Keep doing it (wanderers pick a new spot); otherwise decide afresh.
        if (npc.plan && now < npc.plan.until) this.startLeisure(npc);
        else task.done = true;
      }
    } else if ((task.type === 'eat' || task.type === 'shop') && task.stage === 'inside' && now >= task.until) {
      task.done = true;
    }
  }

  // ------------------------------------------------------------------
  // Movement helpers
  // ------------------------------------------------------------------
  goInto(npc, buildingId) {
    const task = npc.task;
    task.target = { building: buildingId };
    if (npc.inside === buildingId) {
      this.arrive(npc);
      return;
    }
    const b = this.world.buildings[buildingId];
    this.walkTo(npc, b.door.tx, b.door.ty);
  }

  walkTo(npc, tx, ty) {
    this.leaveBuilding(npc);
    npc.task.stage = npc.task.stage === 'start' ? 'walking' : npc.task.stage;
    const s = this.world.toTile(npc.x, npc.y);
    const goal = this.world.nearestWalkable(tx, ty, 4);
    const place = () => {
      const c = this.world.tileCenter(goal.tx, goal.ty);
      npc.x = c.x;
      npc.y = c.y;
      this.arrive(npc);
    };
    // Fast-forwarding, or far away from the player ("statistical" level): skip the walk entirely.
    if (this.time.isSkipping() || npc.simLevel === 'statistical') return place();
    const path = findPath(this.world, s.tx, s.ty, goal.tx, goal.ty);
    if (!path) return place(); // unreachable: fall back to arriving directly
    if (!path.length) return this.arrive(npc);
    this.paths.set(npc.id, path);
    npc.moving = true;
  }

  leaveBuilding(npc) {
    if (!npc.inside) return;
    const b = this.world.buildings[npc.inside];
    const c = this.world.tileCenter(b.door.tx, b.door.ty);
    npc.x = c.x;
    npc.y = c.y;
    npc.facing = 'down';
    npc.inside = null;
  }

  enter(npc, buildingId) {
    npc.inside = buildingId;
    this.paths.delete(npc.id);
  }

  // ------------------------------------------------------------------
  // Arriving at a destination
  // ------------------------------------------------------------------
  arrive(npc) {
    const task = npc.task;
    if (!task) return;
    const now = this.time.total;
    switch (task.type) {
      case 'sleep':
      case 'home':
      case 'rest':
      case 'sick':
        if (task.stage === 'to_rough') {
          task.stage = 'rough'; // no home: dozing on a bench by the well
          if (task.type === 'sleep') npc.sleptRough = true;
        } else {
          this.enter(npc, task.target.building);
          task.stage = 'inside';
          if (!npc.homeId && this.isTavern(task.target.building)) this.payInn(npc, this.sim.economy.businessAtBuilding(task.target.building));
        }
        break;
      case 'job_search':
        this.arriveJobSearch(npc);
        break;
      case 'eat':
        this.enter(npc, task.target.building);
        task.stage = 'inside';
        task.until = now + 35;
        this.eatNow(npc, task.data?.biz && task.target.building !== npc.homeId ? task.data.biz : null);
        break;
      case 'shop': {
        const where = task.target?.building;
        this.enter(npc, where);
        task.stage = 'inside';
        task.until = now + 15;
        this.sim.habits.visited(npc, where);
        const bizId = this.sim.economy.businessAtBuilding(where);
        if (bizId) this.buyGroceries(npc, bizId);
        else this.sim.businesses.sellToNpc(npc, where);
        break;
      }
      case 'work':
        this.arriveWork(npc);
        break;
      case 'school':
        this.enter(npc, task.target.building);
        task.stage = 'inside';
        break;
      case 'leisure':
        this.arriveLeisure(npc);
        break;
      case 'leave':
        this.departed(npc);
        break;
      case 'firefight':
        task.stage = 'fighting';
        this.face(npc, this.world.buildings[task.target.building].door.tx, this.world.buildings[task.target.building].ty + 1);
        break;
    }
  }

  /** Someone decided to leave the village: they walk away (see GrowthSystem.leave). */
  sendAway(npc, to) {
    npc.leaving = true;
    npc.leaveTo = to;
    npc.task = null;
    npc.nextThink = this.time.total;
    if (npc.simLevel === 'statistical' || this.time.isSkipping()) this.departed(npc);
  }

  /** Gone: they live on elsewhere (remembered by name, for memories and family trees). */
  departed(npc) {
    if (!this.index.has(npc.id)) return;
    const S = this.sim.state;
    S.emigrants ??= [];
    S.emigrants.push({ id: npc.id, nameIdx: npc.nameIdx, surnameIdx: npc.surnameIdx, gender: npc.gender, look: npc.look, kin: npc.kin, left: this.time.day, age: npc.age });
    if (S.emigrants.length > 200) S.emigrants.shift();
    this.remove(npc);
  }

  // ------------------------------------------------------------------
  // Homeless villagers and job seekers
  // ------------------------------------------------------------------
  /** No home: rent a tavern bed if affordable, otherwise sleep rough on the plaza. */
  goShelter(npc) {
    const inn = npc.money >= NB.homelessInnPrice ? this.pickTavern(npc) : null;
    if (inn) return this.goInto(npc, this.sim.economy.biz(inn).building);
    const P = AREAS.plaza;
    npc.task.stage = 'to_rough';
    this.walkTo(npc, P.x1 + 3, P.y1 + 2);
  }

  payInn(npc, bizId) {
    const price = NB.homelessInnPrice;
    if (!bizId || npc.money < price) return;
    npc.money -= price;
    this.sim.economy.biz(bizId).money += price;
    this.sim.economy.ledger(bizId, 'rev', price);
  }

  /** Walk to the notice board, read it, then go and ask at a workplace that is hiring. */
  startJobSearch(npc) {
    const board = this.sim.world.decor.find((d) => d.interact === 'notice_board');
    npc.task.stage = 'to_board';
    this.walkTo(npc, board.tx, board.ty + 1);
  }

  arriveJobSearch(npc) {
    const task = npc.task;
    const now = this.time.total;
    if (task.stage === 'to_board') {
      const options = this.vacancies();
      if (!options.length) {
        npc.searchedDay = this.time.day; // nothing today — try again tomorrow
        task.done = true;
        return;
      }
      // Not just any job: pay, the place's reputation, and how they get on with the boss all count.
      const [bizId, def] = options.map((o) => [o, this.jobAppeal(npc, o[0]) + rand.float() * 2]).sort((a, b) => b[1] - a[1])[0][0];
      task.bizId = bizId;
      task.stage = 'to_employer';
      const b = this.world.buildings[def.building];
      this.walkTo(npc, b.door.tx, b.door.ty);
    } else if (task.stage === 'to_employer') {
      const hired = this.tryHire(npc, task.bizId);
      npc.searchedDay = this.time.day;
      task.done = true;
      task.until = now;
      if (!hired) this.sim.bus.emit('npc:rejected', npc.id);
    }
  }

  /** How many staff a business may have (it grows when business is good). */
  maxStaff(bizId) {
    const E = this.sim.economy;
    return E.biz(bizId)?.maxWorkers ?? E.def(bizId)?.maxWorkers ?? 0;
  }

  staffOf(bizId) {
    return this.list.filter((n) => n.employer === bizId);
  }

  /** Businesses with a free position and enough money to pay a new worker. Returns [[id, def], …]. */
  vacancies() {
    const E = this.sim.economy;
    const out = [];
    for (const id of E.active()) {
      const def = E.def(id);
      if (!def.workerOccupation) continue;
      const workers = this.staffOf(id).length;
      if (workers < this.maxStaff(id) && E.biz(id).money >= this.wageFor(id) * NB.hireMinBusinessMoney) out.push([id, def]);
    }
    return out;
  }

  /**
   * Daily wage at a business: the trade's usual pay × the owner's pay policy,
   * more for experience, and more again for the manager.
   */
  wageFor(bizId, npc = null) {
    const E = this.sim.economy;
    const def = E.def(bizId);
    const base = OCCUPATIONS[def?.workerOccupation]?.wage || 12;
    const rank = npc ? this.rank(npc) : 'apprentice';
    const rankMult = { apprentice: 0.9, regular: 1, skilled: 1.15, master: 1.3 }[rank] || 1;
    const manager = npc && E.biz(bizId)?.manager === npc.id ? 1.35 : 1;
    return Math.round(base * (E.biz(bizId)?.wageLevel ?? 1) * rankMult * manager);
  }

  /** How attractive a job at this business looks to this villager (pay, reputation, the boss). */
  jobAppeal(npc, bizId) {
    const E = this.sim.economy;
    const b = E.biz(bizId);
    let s = this.wageFor(bizId, npc) / 3 + (b.reputation ?? 50) / 20 + (b.staffMorale ?? 60) / 25 - (b.longHours ? 2 : 0);
    const owner = E.owner(bizId);
    const bond = owner && this.sim.social.bond(npc, owner);
    if (bond) s += bond.f / 20 - bond.c / 12;
    if (owner && npc.family.includes(owner.id)) s += 4;
    if (this.sim.memory.has(npc, 'quit_job', owner?.id)) s -= 8;
    // Heard they're hiring? Worth a try.
    s += (this.sim.rumors?.bias(npc, 'hiring', bizId) || 0) * 3;
    return s;
  }

  tryHire(npc, bizId) {
    const E = this.sim.economy;
    const def = E.def(bizId);
    if (!this.vacancies().some(([id]) => id === bizId)) return false;
    // Employers prefer hard workers, people they like, family, and people with experience;
    // lazy or short-tempered applicants — or someone they've fallen out with — may be turned away.
    const owner = E.owner(bizId);
    let chance = 0.75 * (npc.traits.includes('hard_worker') ? 1.3 : 1) * (npc.traits.includes('lazy') ? 0.6 : 1) * (npc.traits.includes('aggressive') ? 0.7 : 1);
    if (owner) {
      const view = this.sim.social.bond(owner, npc);
      if (view) chance *= Math.max(0.1, 1 + view.t / 100 - view.c / 60);
      if (owner.family.includes(npc.id)) chance *= 1.5;
    }
    if (npc.occupation === def.workerOccupation || npc.prevOccupation === def.workerOccupation) chance *= 1.3;
    if (!rand.chance(Math.min(0.97, chance))) return false;
    if (npc.occupation !== 'unemployed' && npc.occupation !== def.workerOccupation) npc.prevOccupation = npc.occupation;
    npc.occupation = def.workerOccupation;
    npc.employer = bizId;
    npc.unpaidDays = 0;
    npc.nextThink = this.time.total;
    npc.hiredDay = this.time.day;
    if (owner) this.sim.social.addNpcRel(npc, owner, 10);
    this.sim.memory.remember(npc, 'got_job', { who: owner?.id || null, params: { building: def.building, occ: npc.occupation } });
    this.sim.chronicle('chronicle.npc_hired', { npc: npc.id, gender: npc.gender, occ: npc.occupation, building: def.building });
    return true;
  }

  // ------------------------------------------------------------------
  // Work
  // ------------------------------------------------------------------
  startWork(npc) {
    if (npc.employer === 'player') return this.sim.workers.startWork(npc);
    const bld = this.workBuilding(npc);
    if (!bld) return this.startLeisure(npc);
    npc.workedToday = true;
    switch (this.activityOf(npc)) {
      case 'inside':
        return this.goInto(npc, bld.id);
      case 'spot': {
        const spot = bld.workSpots[0] || bld.door;
        npc.task.stage = 'to_spot';
        return this.walkTo(npc, spot.tx, spot.ty);
      }
      case 'farm':
        return this.nextFarmPlot(npc);
      case 'chop':
        return this.nextGather(npc, 'tree');
      case 'mine':
        return this.nextGather(npc, 'rock');
      case 'fish':
        return this.nextFishing(npc);
      case 'build':
        return this.nextBuild(npc);
      default:
        return this.goInto(npc, bld.id);
    }
  }

  arriveWork(npc) {
    if (npc.employer === 'player') return this.sim.workers.arrive(npc);
    const task = npc.task;
    const now = this.time.total;
    const act = this.activityOf(npc);
    npc.workedToday = true;
    if (act === 'inside') {
      this.enter(npc, this.workBuilding(npc).id);
      task.stage = 'inside';
    } else if (act === 'spot') {
      task.stage = 'working';
      npc.facing = 'down';
    } else if (act === 'farm') {
      task.stage = 'doing';
      task.until = now + rand.int(NB.tendMinutes[0], NB.tendMinutes[1]);
    } else if (act === 'chop' || act === 'mine') {
      if (task.stage === 'to_target') {
        task.stage = 'doing';
        task.until = now + Math.round((act === 'chop' ? NB.chopMinutes : NB.mineMinutes) / this.productivity(npc));
        const obj = this.sim.resources.get(task.targetId);
        if (obj) this.face(npc, obj.tx, obj.ty);
      } else if (task.stage === 'deliver') {
        const biz = this.sim.economy.biz(this.workBusiness(npc));
        if (npc.carry) {
          biz.stock[npc.carry.item] = (biz.stock[npc.carry.item] || 0) + npc.carry.qty;
          npc.carry = null;
        }
        this.nextGather(npc, act === 'chop' ? 'tree' : 'rock');
      } else if (task.stage === 'idle_go') {
        task.stage = 'idle_wait';
        task.until = now + 60;
      }
    } else if (act === 'build') {
      if (task.stage === 'to_target') {
        task.stage = 'doing';
        task.until = now + rand.int(80, 140);
        const c = this.sim.construction.byId(task.siteId);
        if (c) this.face(npc, c.tx + Math.floor(c.w / 2), c.ty + c.h - 1);
      } else if (task.stage === 'idle_go') {
        task.stage = 'idle_wait';
        task.until = now + 60;
      }
    } else if (act === 'fish') {
      if (task.stage === 'to_target') {
        task.stage = 'doing';
        task.until = now + Math.round(NB.fishMinutes / this.productivity(npc));
        this.faceWater(npc);
      } else if (task.stage === 'deliver') {
        const biz = this.sim.economy.biz(this.workBusiness(npc));
        if (npc.carry) {
          biz.stock[npc.carry.item] = (biz.stock[npc.carry.item] || 0) + npc.carry.qty;
          npc.carry = null;
        }
        this.nextFishing(npc);
      } else if (task.stage === 'idle_go') {
        task.stage = 'idle_wait';
        task.until = now + 60;
      }
    }
  }

  /** A builder goes to the site that needs hands (paid by whoever is building). */
  nextBuild(npc) {
    if (!npc.task) return;
    const c = this.sim.growth.siteForBuilder();
    const bld = this.workBuilding(npc);
    if (!c) {
      npc.task.stage = 'idle_go';
      return this.walkTo(npc, bld.door.tx, bld.door.ty + 1);
    }
    npc.task.siteId = c.id;
    npc.task.stage = 'to_target';
    this.walkTo(npc, c.tx + rand.int(0, c.w - 1), c.ty + c.h);
  }

  /** A fisher heads for the water nearest their fishery (if the fishery can sell more fish). */
  nextFishing(npc) {
    const bld = this.workBuilding(npc);
    const biz = this.workBusiness(npc);
    const water = bld && this.sim.habits.nearestWater({ tx: bld.door.tx, ty: bld.door.ty }, 60);
    if (!water || !this.sim.economy.wantsMore(biz, 'fish')) {
      npc.task.stage = 'idle_go';
      return this.walkTo(npc, bld.door.tx, bld.door.ty + 1);
    }
    npc.task.stage = 'to_target';
    // Fishers spread out along the bank.
    const spots = this.sim.habits.getWaterSpots().filter((s) => Math.abs(s.tx - water.spot.tx) + Math.abs(s.ty - water.spot.ty) <= 8);
    const spot = spots.length ? rand.pick(spots) : water.spot;
    this.walkTo(npc, spot.tx, spot.ty);
  }

  /** A few hours at the water: the catch depends on how many fish are left. */
  finishFishing(npc) {
    const t = this.world.toTile(npc.x, npc.y);
    let caught = 0;
    for (let i = 0; i < NB.fishAttempts; i++) caught += this.sim.nature.catchFish(t.tx, t.ty, this.rank(npc) === 'master' ? 0.1 : 0);
    if (!caught) return this.nextFishing(npc);
    npc.carry = { item: 'fish', qty: caught };
    npc.task.stage = 'deliver';
    const bld = this.workBuilding(npc);
    this.walkTo(npc, bld.door.tx, bld.door.ty);
  }

  face(npc, tx, ty) {
    const t = this.world.toTile(npc.x, npc.y);
    const dx = tx - t.tx;
    const dy = ty - t.ty;
    if (Math.abs(dx) > Math.abs(dy)) npc.facing = dx > 0 ? 'right' : 'left';
    else npc.facing = dy > 0 ? 'down' : 'up';
  }

  nextFarmPlot(npc) {
    const F = AREAS.fields;
    npc.task.stage = 'to_plot';
    this.walkTo(npc, rand.int(F.x1, F.x2), rand.int(F.y1, F.y2));
  }

  nextGather(npc, kind) {
    this.clearReservation(npc);
    const bld = this.workBuilding(npc);
    // No point felling trees nobody will buy: when the yard is overflowing, wait at the yard.
    const biz = this.workBusiness(npc);
    const mainItem = kind === 'tree' ? 'wood' : 'stone';
    const wants = this.sim.economy.wantsMore(biz, mainItem);
    // Woodcutters only fell full-grown trees (young ones are left to grow).
    const usable = (o) => (kind !== 'tree' || o.state === 'grown') && (!o.reservedBy || o.reservedBy === npc.id);
    // Nothing left near the yard? Go deeper into the woods (a longer walk, but there's work).
    const target = wants ? this.sim.resources.findNearest(kind, bld.door.tx, bld.door.ty, NB.searchRadius, usable) || this.sim.resources.findNearest(kind, bld.door.tx, bld.door.ty, NB.searchRadius * 2.2, usable) : null;
    if (!target) {
      // Nothing left to fell nearby? Plant the stumps instead, so there's timber in years to come.
      if (kind === 'tree' && wants) this.replant(npc, bld);
      npc.task.stage = 'idle_go';
      const spot = bld.workSpots[0] || bld.door;
      return this.walkTo(npc, spot.tx, spot.ty);
    }
    target.reservedBy = npc.id;
    npc.task.targetId = target.id;
    npc.task.stage = 'to_target';
    // Stand next to the object (prefer below it so we face up at it).
    let stand = null;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [1, 1], [-1, 1]]) {
      if (!this.world.isBlocked(target.tx + dx, target.ty + dy)) {
        stand = { tx: target.tx + dx, ty: target.ty + dy };
        break;
      }
    }
    stand = stand || this.world.nearestWalkable(target.tx, target.ty + 1, 3);
    this.walkTo(npc, stand.tx, stand.ty);
  }

  /** A woodcutter with no trees left in reach plants saplings where stumps stand. */
  replant(npc, bld) {
    const res = this.sim.resources;
    let stump = null;
    let bestD = Infinity;
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind !== 'tree' || (o.state !== 'stump' && o.state !== 'cleared') || this.sim.land.plotAt(o.tx, o.ty)) continue;
      const d = Math.abs(o.tx - bld.door.tx) + Math.abs(o.ty - bld.door.ty);
      if (d < bestD && d <= NB.searchRadius) {
        bestD = d;
        stump = o;
      }
    }
    if (!stump) return;
    stump.state = 'sapling';
    stump.stageDay = this.time.day;
    stump.planted = true;
    res.changed(stump);
    const S = this.sim.state.settlement;
    if (!S.replantingStarted) {
      S.replantingStarted = true;
      this.sim.chronicle('chronicle.replanting', { npc: npc.id, gender: npc.gender, building: bld.id });
    }
  }

  finishGather(npc) {
    const act = this.activityOf(npc);
    const res = this.sim.resources;
    const obj = res.get(npc.task.targetId);
    let carry = null;
    if (obj && res.isHarvestable(obj)) {
      if (act === 'chop') carry = { item: 'wood', qty: res.fellTree(obj.id) };
      else {
        const r = res.mineRock(obj.id);
        if (r.item) carry = { item: r.item, qty: r.qty };
      }
    }
    if (!carry) return this.nextGather(npc, act === 'chop' ? 'tree' : 'rock');
    // Better tools: more from every tree and rock.
    carry.qty = Math.max(1, Math.round(carry.qty * (this.sim.tech?.mod('gather_output') ?? 1)));
    npc.carry = carry;
    npc.task.stage = 'deliver';
    const bld = this.workBuilding(npc);
    this.walkTo(npc, bld.door.tx, bld.door.ty);
  }

  clearReservation(npc) {
    const id = npc.task?.targetId;
    if (!id) return;
    const obj = this.sim.resources.get(id);
    if (obj && obj.reservedBy === npc.id) delete obj.reservedBy;
  }

  // ------------------------------------------------------------------
  // Food and shopping
  // ------------------------------------------------------------------
  /** Eat: a meal at a tavern (bizId), or from the household pantry. */
  eatNow(npc, bizId) {
    const e = this.sim.economy;
    if (bizId) {
      const tav = e.biz(bizId);
      const price = BALANCE.economy.npcMealPrice;
      if (tav && !tav.closed && (tav.stock.stew || 0) > 0 && npc.money >= price) {
        this.sim.habits.visited(npc, tav.building);
        tav.stock.stew--;
        npc.money -= price;
        tav.money += price;
        e.ledger(bizId, 'rev', price);
        tav.customers = (tav.customers || 0) + 1;
        npc.hunger = 100;
        return;
      }
    }
    // Households share food: children eat what their parents bought.
    const pantryOwner = npc.pantry > 0 ? npc : this.list.find((n) => n.homeId === npc.homeId && n.pantry > 0);
    if (pantryOwner) {
      pantryOwner.pantry--;
      npc.hunger = Math.min(100, npc.hunger + 60);
    } else {
      npc.hunger = Math.min(100, npc.hunger + 12); // scraps — someone needs to shop soon
    }
  }

  /** homeId → residents (cached for the current minute; villagers can be many). */
  householdMap() {
    if (!this.households) {
      this.households = new Map();
      for (const o of this.list) {
        if (!o.homeId) continue;
        let arr = this.households.get(o.homeId);
        if (!arr) this.households.set(o.homeId, (arr = []));
        arr.push(o);
      }
    }
    return this.households;
  }

  /** Food available to this NPC's whole household. */
  householdPantry(npc) {
    if (!npc.homeId) return npc.pantry;
    let n = 0;
    for (const o of this.householdMap().get(npc.homeId) || [npc]) n += o.pantry;
    return n;
  }

  buyGroceries(npc, bizId) {
    // Villagers buy whatever food is in stock — a shortage of bread shifts demand to vegetables.
    const marketDay = npc.habits?.marketDay === this.time.weekday;
    const qty = BALANCE.economy.npcGroceryItems + (npc.pantry <= 0 ? 1 : 0) + (marketDay ? 2 : 0);
    const bought = this.sim.economy.npcBuy(npc, bizId, FOOD, qty);
    npc.pantry += bought;
    npc.shoppedDay = this.time.day;
    // Nothing on the shelves? That shop loses a little goodwill (being broke isn't the shop's fault).
    if (!bought && FOOD.every((i) => this.sim.economy.stock(bizId, i) === 0)) {
      const b = this.sim.economy.biz(bizId);
      if (b) b.reputation = Math.max(0, (b.reputation ?? 50) - 0.5);
    }
  }

  buyDrink(npc, bizId) {
    const price = BALANCE.economy.npcDrinkPrice;
    const b = bizId && this.sim.economy.biz(bizId);
    if (b && npc.money >= price) {
      npc.money -= price;
      b.money += price;
      this.sim.economy.ledger(bizId, 'rev', price);
    }
  }

  // ------------------------------------------------------------------
  // Free time
  // ------------------------------------------------------------------
  /**
   * Free time, following the villager's plan (see HabitSystem): their hobby at
   * their favourite spot, the tavern, a friend's or relative's home, the plaza, the market.
   */
  startLeisure(npc) {
    const task = npc.task;
    task.stage = 'walking';
    task.enter = null;
    const plan = this.sim.habits.currentPlan(npc);
    task.plan = plan.kind;
    const P = AREAS.plaza;
    const plaza = () => this.walkTo(npc, rand.int(P.x1, P.x2), rand.int(P.y1, P.y2));
    const door = (id) => this.world.buildings[id]?.door;
    switch (plan.kind) {
      case 'tavern': {
        const tav = this.pickTavern(npc);
        if (!tav) return plaza();
        task.enter = this.sim.economy.biz(tav).building;
        const d = door(task.enter);
        return this.walkTo(npc, d.tx, d.ty);
      }
      case 'friends':
      case 'family': {
        const host = this.byId(plan.who);
        const d = host && door(host.homeId);
        if (!d) return plaza();
        task.visit = host.id;
        // Go in if they're home; otherwise chat on the doorstep and see.
        if (host.inside === host.homeId) task.enter = host.homeId;
        return this.walkTo(npc, d.tx + rand.int(-1, 1), d.ty + (task.enter ? 0 : 1));
      }
      case 'market':
        return this.walkTo(npc, rand.int(P.x1 + 1, P.x2 - 1), P.y2 - 2);
      case 'build': {
        const c = this.sim.construction.byId(plan.site);
        if (!c || c.status !== 'site') return plaza();
        task.site = c.id;
        task.arrived = 0;
        return this.walkTo(npc, c.tx + rand.int(0, c.w - 1), c.ty + c.h);
      }
      case 'hobby': {
        const h = npc.habits || {};
        task.hobby = h.hobby;
        if (h.hobby === 'reading') {
          task.enter = 'hall';
          const d = door('hall');
          return this.walkTo(npc, d.tx, d.ty);
        }
        if (h.hobby === 'cards') {
          const tav = npc.age >= 18 && npc.money >= BALANCE.economy.npcDrinkPrice ? this.pickTavern(npc) : null;
          if (!tav) return plaza();
          task.enter = this.sim.economy.biz(tav).building;
          const d = door(task.enter);
          return this.walkTo(npc, d.tx, d.ty);
        }
        const spot = h.spot || { tx: rand.int(P.x1, P.x2), ty: rand.int(P.y1, P.y2) };
        if (h.hobby === 'gossip' || h.hobby === 'playing') return this.walkTo(npc, spot.tx + rand.int(-2, 2), spot.ty + rand.int(-2, 2));
        return this.walkTo(npc, spot.tx, spot.ty);
      }
      default:
        return plaza();
    }
  }

  arriveLeisure(npc) {
    const task = npc.task;
    const now = this.time.total;
    const plan = npc.plan;
    task.stage = 'idle';
    // Stay until the plan runs out (wanderers move on sooner).
    const wander = task.plan === 'plaza' || task.plan === 'market' || task.hobby === 'gossip' || task.hobby === 'playing';
    if (task.site) {
      task.arrived = now;
      const c = this.sim.construction.byId(task.site);
      if (c) this.face(npc, c.tx + Math.floor(c.w / 2), c.ty + c.h - 1);
    }
    task.until = wander ? now + rand.int(25, 50) : Math.max(now + 20, plan?.until || now + 60);
    if (task.enter) {
      this.enter(npc, task.enter);
      this.sim.habits.visited(npc, task.enter);
      if (this.isTavern(task.enter)) this.buyDrink(npc, this.sim.economy.businessAtBuilding(task.enter));
    }
    if (task.hobby === 'fishing') this.faceWater(npc);
  }

  /** Stand facing the nearest water (fishing). */
  faceWater(npc) {
    const t = this.world.toTile(npc.x, npc.y);
    for (const [dx, dy, f] of [[0, 1, 'down'], [1, 0, 'right'], [-1, 0, 'left'], [0, -1, 'up']]) {
      if (this.world.isWater(t.tx + dx, t.ty + dy)) {
        npc.facing = f;
        return;
      }
    }
  }

  /** A hobby session ended: sometimes it brings something home. */
  finishLeisure(npc) {
    const task = npc.task;
    if (task.site && task.arrived) {
      this.sim.growth?.eveningWork(npc, this.sim.construction.byId(task.site), this.time.total - task.arrived);
      task.arrived = this.time.total;
    }
    if (task.hobby === 'fishing' && task.stage === 'idle') {
      if (this.sim.nature ? this.sim.nature.fish(npc) : rand.chance(0.3)) {
        npc.pantry++;
        npc.caughtFish = (npc.caughtFish || 0) + 1;
      }
    } else if (task.hobby === 'hunting' && task.stage === 'idle') {
      // A hunt in the woods: success depends on how much game is left.
      const W = this.sim.state.nature?.wildlife;
      const kind = rand.chance(0.7) ? 'rabbit' : 'deer';
      if (W && rand.chance(0.25 + 0.4 * Math.min(1, W[kind].pop / Math.max(1, W[kind].cap))) && this.sim.nature.hunted(kind)) {
        npc.pantry += kind === 'deer' ? 3 : 1;
        npc.hunted = (npc.hunted || 0) + 1;
      }
    } else if (task.hobby === 'gardening' && this.time.season !== 'winter' && rand.chance(0.15)) {
      npc.pantry++;
    } else if (task.hobby === 'reading') {
      npc.xp += 3; // self-education
      npc.knowledge = (npc.knowledge || 0) + 1;
    }
    npc.lastHobbyDay = this.time.day;
  }

  /**
   * Villagers spending free time near each other talk: friendships grow,
   * news about the player spreads, and sometimes tempers flare.
   */
  socialize() {
    const idle = this.list.filter(
      (n) => n.task && !n.talkingToPlayer && (((n.task.type === 'leisure' || n.task.type === 'eat') && (n.task.stage === 'idle' || n.task.stage === 'inside')) || (n.task.type === 'home' && n.task.stage === 'inside')),
    );
    for (let i = 0; i < idle.length; i++) {
      for (let j = i + 1; j < idle.length; j++) {
        const a = idle[i];
        const b = idle[j];
        let together;
        if (a.inside || b.inside) {
          // Same building, and not simply two members of the same household at home.
          together = a.inside === b.inside && !(a.inside === a.homeId && b.inside === b.homeId);
        } else together = Math.hypot(a.x - b.x, a.y - b.y) < 96;
        if (!together) continue;
        const social = (traitValue(a.traits, 'social') + traitValue(b.traits, 'social')) / 2;
        if (!rand.chance(0.45 * social)) continue;
        this.chatBetween(a, b, social);
      }
    }
  }

  chatBetween(a, b, social = 1) {
    const S = this.sim.social;
    a.social = Math.min(100, (a.social ?? 60) + NB.socialPerChat);
    b.social = Math.min(100, (b.social ?? 60) + NB.socialPerChat);
    // Short tempers, old grudges and greed make arguments more likely.
    const hot = (n) => (n.traits.includes('aggressive') ? 2 : 1) * (n.traits.includes('greedy') ? 1.3 : 1) * (n.mood < 35 ? 1.6 : 1);
    const grudge = Math.max(S.bond(a, b)?.c || 0, S.bond(b, a)?.c || 0);
    const argueChance = NB.argueChance * hot(a) * hot(b) * (1 + grudge / 25);
    if (rand.chance(Math.min(0.5, argueChance))) {
      this.sim.memory.remember(a, 'argued_with', { who: b.id, params: { npc: b.id } });
      this.sim.memory.remember(b, 'argued_with', { who: a.id, params: { npc: a.id } });
      if (!a.inside) this.sim.bus.emit('npc:argue', { a: a.id, b: b.id });
      return;
    }
    S.addNpcRel(a, b, BALANCE.social.npcChatGain * social);
    // Word of mouth: what one knows about the player, the other soon knows too.
    if (rand.chance(NB.gossipChance)) this.sim.memory.gossip(a, b);
    if (rand.chance(NB.gossipChance)) this.sim.memory.gossip(b, a);
    this.sim.rumors?.exchange(a, b);
    if (!a.inside) this.sim.bus.emit('npc:chat', { a: a.id, b: b.id });
  }

  // ------------------------------------------------------------------
  // Hourly / daily life events
  // ------------------------------------------------------------------
  onHour() {}

  /**
   * Mood (0–100): how content the villager is. Affects work productivity now,
   * and (later) whether they stay in the village.
   */
  computeMood(npc) {
    let m = 50;
    m += npc.hunger > 50 ? 8 : npc.hunger < 20 ? -15 : 0;
    m += npc.energy > 50 ? 5 : npc.energy < 20 ? -10 : 0;
    m += npc.health > 70 ? 5 : npc.health < 40 ? -15 : 0;
    m += npc.money > 100 ? 10 : npc.money < 10 ? -10 : 0;
    m += npc.homeId ? 5 : -20;
    const hasJob = npc.employer || npc.owns || ['child', 'elder'].includes(npc.occupation);
    m += hasJob ? 8 : -12;
    m -= npc.unpaidDays * 6;
    m += Math.min(15, this.sim.social.friendCount(npc) * 4);
    m += npc.social < 25 ? -10 : npc.social > 70 ? 4 : 0;
    // Recent experiences colour how they feel (a new job, a fight, a gift…).
    m += Math.max(-15, Math.min(15, this.sim.memory.recentFeeling(npc) * 1.5));
    if (npc.lastHobbyDay !== undefined && this.time.day - npc.lastHobbyDay <= 2) m += 3;
    if (npc.traits.includes('friendly')) m += 3;
    if (npc.traits.includes('greedy') && npc.money < 50) m -= 5;
    return Math.max(0, Math.min(100, Math.round(m)));
  }

  /** Work speed multiplier: experience, energy, health and mood all matter. */
  productivity(npc) {
    let p = 0.85 + npc.level * 0.02;
    if (npc.energy < 30) p *= 0.75;
    if (npc.health < 50) p *= 0.8;
    if (npc.hunger < 20) p *= 0.8;
    p *= 0.85 + (npc.mood ?? 60) / 400;
    p *= traitValue(npc.traits, 'workSpeed');
    return Math.max(0.3, Math.min(1.8, p));
  }

  xpForNext(level) {
    return Math.round(NB.xpBase * Math.pow(level, NB.xpExponent));
  }

  onDay() {
    const E = this.sim.economy;
    const mem = this.sim.memory;
    const yesterday = (this.time.day - 1) % BALANCE.time.daysPerWeek;
    for (const npc of this.list) {
      const occ = this.occ(npc);
      const dayOff = occ.restDay === yesterday && (!occ.seasons || occ.seasons.includes(this.time.season));
      // Wages: employees are paid by their employer's real money (the weekly day off is paid too).
      // (The player pays their own workers — see WorkerSystem.)
      if (npc.employer && npc.employer !== 'player' && (npc.workedToday || dayOff)) {
        const wage = this.wageFor(npc.employer, npc);
        const biz = E.biz(npc.employer);
        const building = biz.building;
        if (biz.money >= wage) {
          biz.money -= wage;
          npc.money += wage;
          npc.unpaidDays = 0;
          E.ledger(npc.employer, 'exp', wage);
        } else {
          npc.unpaidDays++;
          mem.remember(npc, 'unpaid_wages', { who: E.ownerId(npc.employer), params: { building } });
          // Family doesn't walk out on the family business.
          const ownerIsFamily = npc.family.includes(E.ownerId(npc.employer));
          if (!ownerIsFamily && npc.unpaidDays >= NB.quitAfterUnpaidDays && rand.chance(0.5 * traitValue(npc.traits, 'quitChance'))) {
            mem.remember(npc, 'quit_job', { who: E.ownerId(npc.employer), params: { building } });
            npc.occupation = 'unemployed';
            npc.employer = null;
            npc.task = null;
            this.sim.chronicle('chronicle.npc_quit', { npc: npc.id, gender: npc.gender, building });
          }
        }
      }
      // Experience from a day's work.
      if (npc.workedToday) {
        const mentor = npc.employer === 'player' ? 1 + Mod.perk(this.sim.state.player, 'worker_xp') : 1; // you teach your own people
        npc.xp += NB.xpPerWorkDay * traitValue(npc.traits, 'workXp') * (this.sim.tech?.mod('learning') ?? 1) * mentor;
        const rankBefore = this.rank(npc);
        while (npc.xp >= this.xpForNext(npc.level)) {
          npc.xp -= this.xpForNext(npc.level);
          npc.level++;
        }
        const rankAfter = this.rank(npc);
        if (rankAfter && rankAfter !== rankBefore && (rankAfter === 'skilled' || rankAfter === 'master')) {
          this.sim.chronicle(`chronicle.npc_rank_${rankAfter}`, { npc: npc.id, gender: npc.gender, occ: npc.occupation });
          mem.remember(npc, 'promoted_rank', { params: { rank: rankAfter, occ: npc.occupation } });
        }
      }
      npc.workedToday = false;
      // Hard days are remembered.
      if (npc.health < NB.sickBelow) mem.remember(npc, 'was_sick');
      if (npc.starved) mem.remember(npc, 'went_hungry');
      if (npc.sleptRough) mem.remember(npc, 'slept_rough');
      npc.starved = false;
      npc.sleptRough = false;
      // Mood moves gradually toward current conditions.
      npc.mood = Math.round(npc.mood * 0.6 + this.computeMood(npc) * 0.4);

      // The retired elder lives on a small pension.
      if (npc.occupation === 'elder') this.sim.property.payPension(npc, BALANCE.economy.elderPension);
      // Wealthy villagers spend more: nicer food for the household (money flows back to the shops)…
      const EB = BALANCE.economy;
      if (npc.money > EB.wealthySpendAbove && this.householdPantry(npc) < 6) {
        const grocer = E.chooseShop(npc, ['cheese', 'apple', 'bread'], { openNow: false });
        if (grocer) npc.pantry += E.npcBuy(npc, grocer, ['cheese', 'apple', 'bread'], 2);
        const pies = E.chooseShop(npc, ['pie'], { openNow: false });
        if (pies) npc.pantry += E.npcBuy(npc, pies, ['pie'], 1);
      }
      // Comfortable households occasionally buy furniture — demand for carpenters (including you).
      if (npc.age >= 18 && npc.money > EB.furnitureBuyAbove && rand.chance(EB.furnitureBuyChance)) {
        const seller = E.chooseShop(npc, ['table', 'chair', 'stool'], { openNow: false });
        if (seller) E.npcBuy(npc, seller, ['table', 'chair', 'stool'], 1);
      }
      // …and the truly rich buy goods from travelling merchants (money leaves the village).
      if (npc.money > EB.luxuryAbove) npc.money -= Math.round((npc.money - EB.luxuryAbove) * EB.luxuryShare);
    }
    // Birthdays: everyone ages once a year.
    const T = BALANCE.time;
    if (this.time.day % (T.daysPerSeason * T.seasons.length) === 0) {
      for (const npc of this.list) {
        npc.age++;
        if (npc.occupation === 'child' && npc.age >= 16) {
          npc.occupation = 'unemployed';
          mem.remember(npc, 'grew_up');
          this.sim.tech?.grewUp(npc);
          this.sim.chronicle('chronicle.npc_grew_up', { npc: npc.id, gender: npc.gender });
        }
      }
      this.sim.state.player.age++;
      this.sim.family.yearPassed();
      this.sim.lineage?.yearPassed();
    }
  }

  // ------------------------------------------------------------------
  // Describing villagers (for the Inspect panel, prompts and thought icons)
  // ------------------------------------------------------------------

  /** What is this villager doing right now? Returns { key, params } for localization. */
  activity(npc) {
    const t = npc.task;
    if (!t) return { key: 'idle', params: {} };
    if (npc.employer === 'player' && t.type === 'work') return this.sim.workers.activity(npc);
    const moving = npc.moving || this.paths.has(npc.id);
    const bld = t.target?.building;
    switch (t.type) {
      case 'sleep':
        return { key: t.stage === 'rough' ? 'sleeping_rough' : moving ? 'going_to_bed' : 'sleeping', params: {} };
      case 'home':
        return { key: moving ? 'going_home' : 'at_home', params: {} };
      case 'rest':
        return { key: moving ? 'going_home_tired' : 'resting', params: {} };
      case 'sick':
        return { key: 'sick', params: {} };
      case 'eat':
        return { key: moving ? 'going_to_eat' : 'eating', params: { building: bld || npc.homeId } };
      case 'shop':
        return { key: moving ? 'going_shopping' : 'shopping', params: { building: bld || t.data?.where } };
      case 'job_search':
        return { key: t.stage === 'to_employer' ? 'asking_for_work' : 'reading_board', params: { building: t.bizId ? this.sim.economy.biz(t.bizId)?.building : null } };
      case 'work': {
        const wb = this.workBuilding(npc)?.id;
        if (t.stage === 'deliver') return { key: 'carrying', params: { item: npc.carry?.item || 'wood', building: wb } };
        if (moving) return { key: 'going_to_work', params: { building: wb } };
        return { key: `working_${this.activityOf(npc) || 'inside'}`, params: { building: wb } };
      }
      case 'firefight':
        return { key: moving ? 'running_to_fire' : 'fighting_fire', params: { building: t.target?.building } };
      case 'school':
        return { key: npc.occupation === 'child' ? (moving ? 'going_to_school' : 'at_school') : 'teaching', params: { building: t.data?.where } };
      case 'leisure':
        if (t.plan === 'friends' || t.plan === 'family') return { key: moving ? 'going_to_visit' : 'visiting', params: { npc: t.visit } };
        if (t.plan === 'build') {
          const c = this.sim.construction.byId(t.site);
          const own = c?.owner === npc.id;
          return { key: moving ? 'going_to_build' : own ? 'building_own' : 'helping_build', params: { npc: c && !own ? c.owner : undefined } };
        }
        if (t.hobby === 'cards' && this.isTavern(t.enter)) return { key: moving ? 'going_to_tavern' : 'playing_cards', params: {} };
        if (this.isTavern(t.enter)) return { key: moving ? 'going_to_tavern' : 'at_tavern', params: {} };
        if (t.plan === 'market') return { key: moving ? 'strolling' : 'at_market', params: {} };
        if (t.hobby) return { key: moving ? 'going_hobby' : `hobby_${t.hobby}`, params: { hobby: t.hobby } };
        return { key: moving ? 'strolling' : 'relaxing', params: {} };
      default:
        return { key: 'idle', params: {} };
    }
  }

  /** A little emoji above the head when something is wrong (or notable). */
  thought(npc) {
    if (npc.task?.type === 'sleep' && npc.task.stage === 'rough') return '💤';
    if (npc.health < NB.sickBelow) return '🤒';
    if (npc.hunger < 25) return '🍞';
    if (npc.energy < 20) return '😩';
    if (npc.task?.type === 'job_search') return '🔎';
    if (npc.task?.type === 'leave') return '🧳';
    if (npc.task?.type === 'firefight') return '🪣';
    if (npc.task?.type === 'leisure' && npc.task.plan === 'build' && npc.task.stage === 'idle') return '🔨';
    if (npc.unpaidDays > 0) return '💸';
    if (npc.carry) return npc.carry.item === 'wood' ? '🪵' : npc.carry.item === 'fish' ? '🐟' : '🪨';
    if (npc.task?.type === 'work' && npc.task.stage === 'doing' && this.activityOf(npc) === 'fish') return '🎣';
    const t = npc.task;
    if (t?.type === 'leisure' && t.stage === 'idle') {
      if (t.hobby === 'fishing') return '🎣';
      if (t.hobby === 'gardening') return '🌱';
      if (t.hobby === 'whittling') return '🪵';
    }
    if (npc.social < 20 && npc.age >= 12) return '😔';
    return null;
  }

  /** Professional rank from level: apprentice → (regular) → skilled → master. */
  rank(npc) {
    if (['child', 'unemployed', 'elder'].includes(npc.occupation)) return null;
    const R = BALANCE.npc.ranks;
    if (npc.level >= R.master) return 'master';
    if (npc.level >= R.skilled) return 'skilled';
    if (npc.level >= R.regular) return 'regular';
    return 'apprentice';
  }

  /** The villager's routine for today as a list of { hour, key } entries. */
  schedule(npc) {
    const occ = this.occ(npc);
    const habits = this.sim.habits;
    const h = npc.habits || {};
    const wd = this.time.weekday;
    const wake = habits.wakeHour(npc, occ) + traitValue(npc.traits, 'lateWake', 0);
    const sleep = habits.sleepHour(npc, occ);
    const out = [{ hour: wake, key: 'wake' }, { hour: wake, key: 'breakfast' }];
    const inSeason = !occ.seasons || occ.seasons.includes(this.time.season);
    const evening = wd === h.tavernNight ? 'tavern_night' : wd === h.familyDay ? 'family_visit' : 'free_time';
    if (occ.workplace && this.workBusiness(npc) && inSeason && !habits.isRestDay(npc, occ)) {
      out.push({ hour: occ.start, key: 'work' });
      if (occ.lunch) out.push({ hour: 12, key: 'lunch' }, { hour: 13, key: 'work' });
      out.push({ hour: occ.end, key: evening });
    } else if (occ.seeksJob && npc.age >= 16) {
      out.push({ hour: 8, key: 'job_hunting' }, { hour: 13, key: evening });
    } else {
      out.push({ hour: Math.ceil(wake + 1), key: habits.isRestDay(npc, occ) ? 'day_off' : evening });
    }
    if (wd === h.marketDay) out.push({ hour: 17, key: 'market' });
    out.sort((a, b) => a.hour - b.hour);
    out.push({ hour: sleep - (h.chronotype === 'late' || npc.traits.includes('friendly') ? 1 : 2), key: 'home' });
    out.push({ hour: sleep % 24, key: 'sleep' });
    return out;
  }

  /** The player started a conversation: stop walking and face them. */
  setTalking(npc, talking) {
    npc.talkingToPlayer = talking;
    if (talking) {
      const p = this.sim.state.player;
      const dx = p.x - npc.x;
      const dy = p.y - npc.y;
      if (!npc.inside) {
        if (Math.abs(dx) > Math.abs(dy)) npc.facing = dx > 0 ? 'right' : 'left';
        else npc.facing = dy > 0 ? 'down' : 'up';
      }
    }
  }
}
