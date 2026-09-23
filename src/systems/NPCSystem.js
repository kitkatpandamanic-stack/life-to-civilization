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
import { BALANCE } from '../config/balance.js';
import { OCCUPATIONS } from '../data/occupations.js';
import { BUSINESSES } from '../data/businesses.js';
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
    for (const n of this.list) {
      this.index.set(n.id, n);
      // Tasks are re-planned after loading (paths are runtime-only and not saved).
      n.task = null;
      n.nextThink = 0;
      delete n.moving;
      delete n.talkingToPlayer;
    }
    this.initRelations();
    sim.bus.on('time:minute', (m) => this.onMinute(m));
    sim.bus.on('time:hour', (h) => this.onHour(h));
    sim.bus.on('time:day', () => this.onDay());
  }

  get list() {
    return this.sim.state.npcs;
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
  workBusiness(npc) {
    return npc.owns || npc.employer || null;
  }
  workBuilding(npc) {
    const biz = this.workBusiness(npc);
    return biz ? this.world.buildings[BUSINESSES[biz].building] : null;
  }
  residentsOf(buildingId) {
    return this.list.filter((n) => n.homeId === buildingId);
  }
  insideOf(buildingId) {
    return this.list.filter((n) => n.inside === buildingId);
  }

  /** Families and co-workers start out knowing each other. */
  initRelations() {
    for (const a of this.list) {
      for (const b of this.list) {
        if (a === b || a.relations[b.id] !== undefined) continue;
        if (a.family.includes(b.id)) a.relations[b.id] = 70;
        else if (this.workBusiness(a) && this.workBusiness(a) === this.workBusiness(b)) a.relations[b.id] = 25;
        else if (a.homeId === b.homeId) a.relations[b.id] = 30;
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
      npc.simLevel = Math.hypot(npc.x - p.x, npc.y - p.y) < NB.fullSimRadius ? 'full' : 'abstract';
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
      let step = NB.walkSpeed * weatherMove * ageMult * (deltaMs / 1000);
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
    for (const npc of this.list) {
      const sleeping = npc.task?.type === 'sleep' && npc.inside;
      npc.hunger = Math.max(0, npc.hunger - (sleeping ? NB.hungerPerHour * 0.35 : NB.hungerPerHour) / 60);
      if (npc.talkingToPlayer) continue;
      if (now >= npc.nextThink && !this.paths.has(npc.id)) {
        npc.nextThink = now + NB.thinkEveryMinutes;
        this.think(npc);
      }
    }
    if (now % 10 === 0) this.socialize();
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
    const wake = occ.wake + traitValue(npc.traits, 'lateWake', 0);
    const sleep = occ.sleep;
    if (h < wake || h >= sleep) return { type: 'sleep' };
    if (npc.hunger < 15) return this.eatChoice(npc, false);
    const inSeason = !occ.seasons || occ.seasons.includes(this.time.season);
    const working = occ.workplace && this.workBusiness(npc) && inSeason && h >= occ.start && h < occ.end;
    if (working) {
      if (occ.lunch && h >= 12 && h < 13 && npc.hunger < 75) return this.eatChoice(npc, true);
      return { type: 'work' };
    }
    if (npc.hunger < NB.eatAt) return this.eatChoice(npc, false);
    const household = this.list.filter((n) => n.homeId === npc.homeId).length;
    if (this.householdPantry(npc) < 2 * household && npc.money >= 12 && this.canShop(npc)) return { type: 'shop' };
    if (this.sim.weather.isBad()) return { type: 'home' };
    return { type: 'leisure' };
  }

  canShop(npc) {
    const e = this.sim.economy;
    const food = e.stock('store', 'bread') + e.stock('store', 'apple') + e.stock('store', 'cheese');
    return npc.age >= 16 && npc.money >= 6 && e.isOpen('store') && food > 0;
  }

  eatChoice(npc, lunch) {
    const e = this.sim.economy;
    const canTavern = e.isOpen('tavern') && npc.money >= BALANCE.economy.npcMealPrice && e.stock('tavern', 'stew') > 0;
    const noFood = this.householdPantry(npc) <= 0;
    const chance = BALANCE.economy.tavernLunchChance * (lunch ? 1 : 0.5) * (npc.traits.includes('friendly') ? 1.5 : 1);
    if (canTavern && (noFood || rand.chance(chance))) return { type: 'eat', where: 'tavern' };
    // Empty pantry at home? Go buy food first.
    if (this.householdPantry(npc) <= 0 && this.canShop(npc)) return { type: 'shop' };
    return { type: 'eat', where: 'home' };
  }

  startTask(npc, desired) {
    this.clearReservation(npc);
    npc.task = { type: desired.type, stage: 'start', data: desired, until: 0 };
    switch (desired.type) {
      case 'sleep':
      case 'home':
        return this.goInto(npc, npc.homeId);
      case 'eat':
        return this.goInto(npc, desired.where === 'tavern' ? 'tavern' : npc.homeId);
      case 'shop':
        return this.goInto(npc, 'store');
      case 'work':
        return this.startWork(npc);
      case 'leisure':
        return this.startLeisure(npc);
    }
  }

  continueTask(npc) {
    const task = npc.task;
    const now = this.time.total;
    if (task.type === 'work') {
      npc.workedToday = true;
      const act = this.occ(npc).activity;
      if (task.stage === 'doing' && now >= task.until) {
        if (act === 'farm') this.nextFarmPlot(npc);
        else if (act === 'chop' || act === 'mine') this.finishGather(npc);
      } else if (task.stage === 'idle_wait' && now >= task.until) {
        this.startWork(npc);
      }
    } else if (task.type === 'leisure') {
      if (task.stage === 'idle' && now >= task.until) this.startLeisure(npc);
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
    if (this.time.isSkipping()) return place();
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
        this.enter(npc, npc.homeId);
        task.stage = 'inside';
        break;
      case 'eat':
        this.enter(npc, task.target.building);
        task.stage = 'inside';
        task.until = now + 35;
        this.eatNow(npc, task.target.building === 'tavern' ? 'tavern' : 'home');
        break;
      case 'shop':
        this.enter(npc, 'store');
        task.stage = 'inside';
        task.until = now + 15;
        this.buyGroceries(npc);
        break;
      case 'work':
        this.arriveWork(npc);
        break;
      case 'leisure':
        task.stage = 'idle';
        task.until = now + rand.int(30, 70);
        if (task.enter) {
          this.enter(npc, task.enter);
          if (task.enter === 'tavern') this.buyDrink(npc);
        }
        break;
    }
  }

  // ------------------------------------------------------------------
  // Work
  // ------------------------------------------------------------------
  startWork(npc) {
    const occ = this.occ(npc);
    const bld = this.workBuilding(npc);
    if (!bld) return this.startLeisure(npc);
    npc.workedToday = true;
    switch (occ.activity) {
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
      default:
        return this.goInto(npc, bld.id);
    }
  }

  arriveWork(npc) {
    const task = npc.task;
    const now = this.time.total;
    const act = this.occ(npc).activity;
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
        task.until = now + (act === 'chop' ? NB.chopMinutes : NB.mineMinutes);
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
    }
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
    const target = this.sim.economy.wantsMore(biz, mainItem)
      ? this.sim.resources.findNearest(kind, bld.door.tx, bld.door.ty, NB.searchRadius, (o) => !o.reservedBy || o.reservedBy === npc.id)
      : null;
    if (!target) {
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

  finishGather(npc) {
    const act = this.occ(npc).activity;
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
  eatNow(npc, where) {
    const e = this.sim.economy;
    if (where === 'tavern') {
      const tav = e.biz('tavern');
      const price = BALANCE.economy.npcMealPrice;
      if ((tav.stock.stew || 0) > 0 && npc.money >= price) {
        tav.stock.stew--;
        npc.money -= price;
        tav.money += price;
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

  /** Food available to this NPC's whole household. */
  householdPantry(npc) {
    let n = 0;
    for (const o of this.list) if (o.homeId === npc.homeId) n += o.pantry;
    return n;
  }

  buyGroceries(npc) {
    const bought = this.sim.economy.npcBuy(npc, 'store', ['bread', 'apple', 'cheese'], BALANCE.economy.npcGroceryItems + (npc.pantry <= 0 ? 1 : 0));
    npc.pantry += bought;
  }

  buyDrink(npc) {
    const price = BALANCE.economy.npcDrinkPrice;
    if (npc.money >= price) {
      npc.money -= price;
      this.sim.economy.biz('tavern').money += price;
    }
  }

  // ------------------------------------------------------------------
  // Free time
  // ------------------------------------------------------------------
  startLeisure(npc) {
    const task = npc.task;
    task.stage = 'walking';
    task.enter = null;
    const h = this.time.hourFloat;
    const r = Math.random();
    const P = AREAS.plaza;
    if (npc.age >= 18 && h >= 18 && npc.money >= BALANCE.economy.npcDrinkPrice && this.sim.economy.isOpen('tavern') && r < 0.3) {
      task.enter = 'tavern';
      const b = this.world.buildings.tavern;
      return this.walkTo(npc, b.door.tx, b.door.ty);
    }
    if (r < 0.55 || npc.occupation === 'child') {
      return this.walkTo(npc, rand.int(P.x1, P.x2), rand.int(P.y1, P.y2));
    }
    const friend = this.sim.social.bestFriend(npc);
    if (r < 0.78 && friend && friend.homeId !== npc.homeId) {
      const b = this.world.buildings[friend.homeId];
      return this.walkTo(npc, b.door.tx + rand.int(-1, 1), b.door.ty + 1);
    }
    const home = this.world.buildings[npc.homeId];
    return this.walkTo(npc, home.door.tx + rand.int(-4, 4), home.door.ty + rand.int(1, 4));
  }

  /** Villagers relaxing near each other chat and grow closer. */
  socialize() {
    const idle = this.list.filter((n) => n.task && (n.task.type === 'leisure' || n.task.type === 'eat') && (n.task.stage === 'idle' || n.task.stage === 'inside') && !n.talkingToPlayer);
    for (let i = 0; i < idle.length; i++) {
      for (let j = i + 1; j < idle.length; j++) {
        const a = idle[i];
        const b = idle[j];
        const together = a.inside ? a.inside === b.inside && a.inside !== a.homeId : !b.inside && Math.hypot(a.x - b.x, a.y - b.y) < 96;
        if (!together) continue;
        const social = (traitValue(a.traits, 'social') + traitValue(b.traits, 'social')) / 2;
        if (!rand.chance(0.45 * social)) continue;
        this.sim.social.addNpcRel(a, b, BALANCE.social.npcChatGain * social);
        if (!a.inside) this.sim.bus.emit('npc:chat', { a: a.id, b: b.id });
      }
    }
  }

  // ------------------------------------------------------------------
  // Hourly / daily life events
  // ------------------------------------------------------------------
  onHour(h) {
    if (h === 8) this.jobSearch();
  }

  /** Unemployed adults look for work at businesses with vacancies and money to pay. */
  jobSearch() {
    for (const npc of this.list) {
      if (npc.occupation !== 'unemployed' || npc.age < 16) continue;
      const options = Object.entries(BUSINESSES).filter(([id, def]) => {
        if (!def.workerOccupation) return false;
        const workers = this.list.filter((n) => n.employer === id).length;
        const wage = OCCUPATIONS[def.workerOccupation].wage || 10;
        return workers < def.maxWorkers && this.sim.economy.biz(id).money >= wage * NB.hireMinBusinessMoney;
      });
      if (!options.length || !rand.chance(0.6)) continue;
      const [bizId, def] = rand.pick(options);
      npc.occupation = def.workerOccupation;
      npc.employer = bizId;
      npc.unpaidDays = 0;
      npc.nextThink = 0;
      const owner = this.byId(def.owner);
      if (owner) this.sim.social.addNpcRel(npc, owner, 10);
      this.sim.chronicle('chronicle.npc_hired', { npc: npc.id, gender: npc.gender, occ: npc.occupation, building: def.building });
    }
  }

  xpForNext(level) {
    return Math.round(NB.xpBase * Math.pow(level, NB.xpExponent));
  }

  onDay() {
    const E = this.sim.economy;
    for (const npc of this.list) {
      // Wages: employees are paid by their employer's real money.
      if (npc.employer && npc.workedToday) {
        const wage = this.occ(npc).wage || 10;
        const biz = E.biz(npc.employer);
        if (biz.money >= wage) {
          biz.money -= wage;
          npc.money += wage;
          npc.unpaidDays = 0;
        } else {
          npc.unpaidDays++;
          // Family doesn't walk out on the family business.
          const ownerIsFamily = npc.family.includes(BUSINESSES[npc.employer].owner);
          if (!ownerIsFamily && npc.unpaidDays >= NB.quitAfterUnpaidDays && rand.chance(0.5 * traitValue(npc.traits, 'quitChance'))) {
            const building = BUSINESSES[npc.employer].building;
            npc.occupation = 'unemployed';
            npc.employer = null;
            npc.task = null;
            this.sim.chronicle('chronicle.npc_quit', { npc: npc.id, gender: npc.gender, building });
          }
        }
      }
      // Experience from a day's work.
      if (npc.workedToday) {
        npc.xp += NB.xpPerWorkDay * traitValue(npc.traits, 'workXp');
        while (npc.xp >= this.xpForNext(npc.level)) {
          npc.xp -= this.xpForNext(npc.level);
          npc.level++;
          if (npc.level % 5 === 0) this.sim.chronicle('chronicle.npc_level', { npc: npc.id, gender: npc.gender, level: npc.level, occ: npc.occupation });
        }
      }
      npc.workedToday = false;

      // The retired elder lives on a small pension.
      if (npc.occupation === 'elder') npc.money += BALANCE.economy.elderPension;
      // Wealthy villagers spend more: nicer food for the household (money flows back to the shops)…
      const EB = BALANCE.economy;
      if (npc.money > EB.wealthySpendAbove && this.householdPantry(npc) < 6) {
        npc.pantry += E.npcBuy(npc, 'store', ['cheese', 'apple', 'bread'], 2);
        const tav = E.biz('tavern');
        if ((tav.stock.pie || 0) > 0) {
          const price = Math.round(E.unitPrice('tavern', 'pie'));
          npc.money -= price;
          tav.money += price;
          tav.stock.pie--;
          npc.pantry++;
        }
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
          this.sim.chronicle('chronicle.npc_grew_up', { npc: npc.id, gender: npc.gender });
        }
      }
      this.sim.state.player.age++;
    }
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
