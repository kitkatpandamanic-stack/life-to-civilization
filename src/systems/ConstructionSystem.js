/**
 * ConstructionSystem — building things in the world.
 *
 *   choose a building → place a blueprint on your land → a construction site appears
 *   → deliver materials → work on it (you or your workers, with a hammer)
 *   → foundation → frame → walls → roof → finished building
 *
 * Work can only get ahead of the materials a little (site preparation), so
 * materials really matter. Finished buildings are added to the world: they block
 * movement, have doors, light up at night and do something useful.
 *
 * Roads are laid tile by tile and immediately change how fast people move.
 */
import { BUILDABLES, ROAD_COST, HOME_UPGRADES } from '../data/buildables.js';
import { HOME_TIERS } from '../data/homes.js';
import { VILLAGE_BUILDINGS } from '../data/villageBuildings.js';
import { Mod, skill } from './Modifiers.js';
import { T } from '../world/WorldGenerator.js';
import { rand } from '../core/rng.js';

const PREP_FRACTION = 0.15; // share of the work possible before any materials arrive

export class ConstructionSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.land.roads ??= [];
    this.restore();
  }

  get list() {
    return this.sim.state.constructions;
  }
  byId(id) {
    return this.list.find((c) => c.id === id) || null;
  }
  sites() {
    return this.list.filter((c) => c.status === 'site');
  }
  /** Your finished buildings (villagers' and the village's are separate — see npcBuilt()). */
  finished() {
    return this.list.filter((c) => c.status === 'done' && c.kind === 'building' && this.isPlayers(c));
  }
  isPlayers(c) {
    return !c.owner || c.owner === 'player';
  }
  /** Your construction sites (for your workers). */
  playerSites() {
    return this.sites().filter((c) => this.isPlayers(c));
  }
  def(c) {
    if (c.kind === 'upgrade') return HOME_UPGRADES[c.toTier];
    return this.isPlayers(c) ? BUILDABLES[c.type] : VILLAGE_BUILDINGS[c.type];
  }

  /** Re-apply saved construction to the freshly generated world (after loading). */
  restore() {
    const world = this.sim.world;
    for (const key of this.sim.state.land.roads) {
      const [x, y] = key.split(',').map(Number);
      world.setRoad(x, y);
    }
    for (const c of this.list) {
      if (c.kind !== 'building') continue;
      if (c.status === 'done') world.addBuilding(this.buildingRecord(c));
      else world.blockRect(c.tx, c.ty, c.w, c.h, 1);
    }
  }

  buildingRecord(c) {
    const visual = c.visual || (this.isPlayers(c) ? c.type : VILLAGE_BUILDINGS[c.type]?.visual || c.type);
    return { id: c.id, type: visual, variant: c.variant || 0, tx: c.tx, ty: c.ty, w: c.w, h: c.h, player: this.isPlayers(c), constructionId: c.id };
  }

  /** Repairs after a disaster: scaffolding over the damaged building, materials and work like any site. */
  startRepair({ owner, target, materials, labor }) {
    const b = this.sim.world.buildings[target];
    const c = {
      id: `rp${this.sim.state.settlement.nextBuildId++}`,
      kind: 'repair',
      type: b.type,
      target,
      tx: b.tx,
      ty: b.ty,
      w: b.w,
      h: b.h,
      status: 'site',
      labor: 0,
      laborNeeded: Math.max(60, labor),
      required: { ...materials },
      delivered: {},
      owner,
      purpose: 'repair',
      budget: 0,
      createdDay: this.sim.time.day,
      lastProgressDay: this.sim.time.day,
      variant: b.variant || 0,
    };
    this.list.push(c);
    this.sim.bus.emit('construction:changed', c);
    return c;
  }

  /**
   * A villager (or the village) starts building. Used by GrowthSystem.
   * The site appears in the world right away and fills in as work is done.
   */
  startProject({ owner, type, tx, ty, purpose, budget = 0, bizType = null, institution = null }) {
    const def = VILLAGE_BUILDINGS[type];
    const c = {
      id: `vb${this.sim.state.settlement.nextBuildId++}`,
      kind: 'building',
      type,
      tx,
      ty,
      w: def.w,
      h: def.h,
      status: 'site',
      labor: 0,
      laborNeeded: Math.round(def.labor * 60 * (this.sim.tech?.mod('build_labor') ?? 1)),
      required: { ...def.materials },
      delivered: {},
      owner,
      purpose,
      budget,
      bizType,
      ...(institution ? { institution } : {}), // the village's market hall, watch house… (CivicSystem)
      createdDay: this.sim.time.day,
      lastProgressDay: this.sim.time.day,
      variant: rand.int(0, 6),
    };
    this.list.push(c);
    this.sim.world.blockRect(tx, ty, def.w, def.h, 1);
    this.sim.bus.emit('construction:changed', c);
    return c;
  }

  // ------------------------------------------------------------------ placement

  /** Can the player start building `type` with its top-left corner at (tx, ty)? */
  canPlace(type, tx, ty) {
    const def = BUILDABLES[type];
    const p = this.sim.state.player;
    const world = this.sim.world;
    if (!this.sim.progression.hasUnlock(def.unlock)) return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel(def.unlock) } };
    // The Architect perk opens larger designs two levels early.
    const needSkill = Math.max(0, (def.minSkill || 0) - (Mod.perk(p, 'architect') ? 2 : 0));
    if (needSkill && skill(p, 'construction') < needSkill) return { ok: false, reason: 'need_skill', params: { skill: 'construction', level: needSkill } };
    if (p.money < def.money) return { ok: false, reason: 'no_money' };
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (def.outpost ? !this.sim.exploration.outpostAllowed(type, x, y) : !this.sim.land.ownsTile(x, y)) return { ok: false, reason: def.outpost ? 'need_explored_site' : 'not_your_land' };
        if (world.isWater(x, y) || world.tileAt(x, y) === T.CLIFF) return { ok: false, reason: 'bad_ground' };
        if (world.isBlocked(x, y)) return { ok: false, reason: 'obstructed' };
        if (this.sim.state.fields[`${x},${y}`]) return { ok: false, reason: 'obstructed' };
      }
    }
    const door = { tx: tx + Math.floor(def.w / 2), ty: ty + def.h };
    if (def.w > 1 && world.isBlocked(door.tx, door.ty)) return { ok: false, reason: 'door_blocked' };
    return { ok: true };
  }

  place(type, tx, ty) {
    const c0 = this.canPlace(type, tx, ty);
    if (!c0.ok) {
      this.sim.toast(`reason.${c0.reason}`, c0.params || {}, 'warn');
      return null;
    }
    const def = BUILDABLES[type];
    this.sim.state.player.money -= def.money;
    const c = {
      id: `pb${this.sim.state.settlement.nextNpcId++}_${this.sim.time.day}`,
      kind: 'building',
      type,
      tx,
      ty,
      w: def.w,
      h: def.h,
      status: 'site',
      labor: 0,
      laborNeeded: Math.round(def.labor * 60 * (this.sim.tech?.mod('build_labor') ?? 1)),
      required: this.playerMaterials(def.materials),
      delivered: {},
      owner: 'player',
      createdDay: this.sim.time.day,
      variant: rand.int(0, 6),
    };
    this.list.push(c);
    this.sim.world.blockRect(tx, ty, def.w, def.h, 1);
    this.sim.toast('toast.site_placed', { building_type: type }, 'good');
    this.sim.bus.emit('construction:changed', c);
    this.sim.bus.emit('player:changed');
    return c;
  }

  /** Start upgrading the player's own home to the next tier (built in place). */
  canUpgradeHome() {
    const p = this.sim.state.player;
    const next = this.sim.home.nextTier();
    const home = this.list.find((c) => c.id === p.homeId && c.status === 'done');
    if (!home || !next || !HOME_UPGRADES[next]) return { ok: false, reason: 'cant_upgrade' };
    if (this.list.some((c) => c.kind === 'upgrade' && c.status === 'site')) return { ok: false, reason: 'upgrade_in_progress' };
    const up = HOME_UPGRADES[next];
    const upSkill = Math.max(0, up.minSkill - (Mod.perk(p, 'architect') ? 2 : 0));
    if (skill(p, 'construction') < upSkill) return { ok: false, reason: 'need_skill', params: { skill: 'construction', level: upSkill } };
    if (p.money < up.money) return { ok: false, reason: 'no_money' };
    return { ok: true, next, home };
  }

  startHomeUpgrade() {
    const chk = this.canUpgradeHome();
    if (!chk.ok) {
      this.sim.toast(`reason.${chk.reason}`, chk.params || {}, 'warn');
      return null;
    }
    const up = HOME_UPGRADES[chk.next];
    this.sim.state.player.money -= up.money;
    const c = {
      id: `up_${chk.home.id}_${this.sim.time.total}`,
      kind: 'upgrade',
      type: chk.home.type,
      target: chk.home.id,
      toTier: chk.next,
      tx: chk.home.tx,
      ty: chk.home.ty,
      w: chk.home.w,
      h: chk.home.h,
      status: 'site',
      labor: 0,
      laborNeeded: up.labor * 60,
      required: this.playerMaterials(up.materials),
      delivered: {},
      owner: 'player',
      createdDay: this.sim.time.day,
    };
    this.list.push(c);
    this.sim.toast('toast.upgrade_started', { tier: chk.next }, 'good');
    this.sim.bus.emit('construction:changed', c);
    return c;
  }

  // ------------------------------------------------------------------ materials & work

  /** 0…1: how much of the required materials has been delivered. */
  materialsFraction(c) {
    const req = Object.entries(c.required);
    if (!req.length) return 1;
    let have = 0;
    let need = 0;
    for (const [id, qty] of req) {
      have += Math.min(qty, c.delivered[id] || 0);
      need += qty;
    }
    return have / need;
  }

  missing(c) {
    const out = {};
    for (const [id, qty] of Object.entries(c.required)) {
      const m = qty - (c.delivered[id] || 0);
      if (m > 0) out[id] = m;
    }
    return out;
  }

  /** Work is capped by delivered materials (plus a little site preparation). */
  maxLabor(c) {
    return c.laborNeeded * (PREP_FRACTION + (1 - PREP_FRACTION) * this.materialsFraction(c));
  }

  /** Deliver whatever the site still needs from a list of slots (pockets or chest). */
  deliver(c, source = 'inventory') {
    let total = 0;
    for (const [id, need] of Object.entries(this.missing(c))) {
      const n = source === 'storage' ? this.sim.home.take(id, need) : this.sim.inventory.remove(id, need);
      if (n > 0) {
        c.delivered[id] = (c.delivered[id] || 0) + n;
        total += n;
      }
    }
    if (total > 0) {
      if (!this.isPlayers(c)) this.sim.growth?.playerHelped(c);
      this.sim.bus.emit('construction:changed', c);
      this.tryComplete(c);
    }
    return total;
  }

  /** Accept materials carried by a worker. */
  receive(c, id, qty) {
    c.delivered[id] = (c.delivered[id] || 0) + qty;
    this.sim.bus.emit('construction:changed', c);
    this.tryComplete(c);
  }

  canWork(c) {
    if (!c || c.status !== 'site') return { ok: false, reason: 'nothing_here' };
    if (!this.sim.inventory.bestTool('hammer')) return { ok: false, reason: 'need_hammer' };
    if (this.sim.state.player.energy < 8) return { ok: false, reason: 'too_tired' };
    if (c.labor >= this.maxLabor(c) - 0.5) return { ok: false, reason: 'need_materials' };
    return { ok: true };
  }

  /** Materials for your own projects (Frugal Builder / Architect need less). */
  playerMaterials(materials) {
    const f = Mod.materialFactor(this.sim.state.player);
    const out = {};
    for (const [id, n] of Object.entries(materials)) out[id] = Math.max(1, Math.round(n * f));
    return out;
  }

  /** How much labor (minutes) one hour of the player's work adds. */
  playerLaborPerHour() {
    const p = this.sim.state.player;
    const tool = this.sim.inventory.bestTool('hammer');
    const eff = tool ? this.sim.inventory.toolEfficiency(tool) : 1;
    return 60 * Mod.buildSpeed(p) * eff * this.sim.needs.productivity() * this.sim.weather.mods().action;
  }

  /** Add labor to a site (from the player or a worker). */
  addLabor(c, minutes) {
    if (c.status !== 'site') return;
    const before = this.stage(c);
    const was = c.labor;
    c.labor = Math.min(this.maxLabor(c), c.labor + minutes);
    if (c.labor > was) c.lastProgressDay = this.sim.time.day;
    if (this.stage(c) !== before) this.sim.bus.emit('construction:stage', c);
    this.sim.bus.emit('construction:changed', c);
    this.tryComplete(c);
  }

  /** Player finished an hour of building work. */
  playerWorked(c) {
    const added = this.playerLaborPerHour();
    this.addLabor(c, added);
    this.sim.bus.emit('construction:player_worked', { site: c, minutes: 60 });
    if (!this.isPlayers(c)) this.sim.growth?.playerHelped(c);
    this.sim.inventory.useTool('hammer');
    this.sim.needs.spendEnergy(8);
    this.sim.progression.addXp(10);
    this.sim.progression.addSkillXp('construction', 14);
    return added;
  }

  /** Visual stage: 0 foundation, 1 frame, 2 walls, 3 roof. */
  stage(c) {
    const f = c.labor / c.laborNeeded;
    if (f < 0.25) return 0;
    if (f < 0.55) return 1;
    if (f < 0.85) return 2;
    return 3;
  }

  tryComplete(c) {
    if (c.status !== 'site') return;
    // (Within a minute of done counts as done — rounding shouldn't leave a house unfinished.)
    if (c.labor < c.laborNeeded - 1 || this.materialsFraction(c) < 1) return;
    this.complete(c);
  }

  complete(c) {
    c.status = 'done';
    c.builtDay = this.sim.time.day;
    const sim = this.sim;
    if (c.kind === 'repair') {
      sim.disasters?.repaired(c);
      sim.bus.emit('construction:changed', c);
      return;
    }
    if (c.kind === 'upgrade') {
      const target = this.byId(c.target);
      if (target) target.visual = `player_${c.toTier}`;
      if (sim.state.player.homeId === c.target) sim.state.player.homeTier = c.toTier;
      const rec = sim.world.buildings[c.target];
      if (rec) rec.type = target.visual;
      sim.progression.addReputation(HOME_TIERS[c.toTier].reputation);
      sim.toast('toast.upgrade_done', { tier: c.toTier }, 'good');
      sim.chronicle('chronicle.player_upgraded', { tier: c.toTier });
      sim.bus.emit('building:changed', c.target);
    } else if (!this.isPlayers(c)) {
      // Built by a villager or the village: GrowthSystem decides who moves in / what opens.
      sim.world.addBuilding(this.buildingRecord(c));
      sim.bus.emit('building:added', c.id);
      sim.bus.emit('construction:changed', c);
      sim.growth?.completed(c);
      return;
    } else {
      sim.world.addBuilding(this.buildingRecord(c));
      sim.toast('toast.building_done', { building_type: c.type }, 'good');
      sim.chronicle('chronicle.player_built', { building_type: c.type });
      sim.bus.emit('building:added', c.id);
    }
    sim.progression.addXp(40 + Math.round(c.laborNeeded / 20));
    sim.progression.addReputation(1);
    sim.state.stats.buildingsBuilt = (sim.state.stats.buildingsBuilt || 0) + 1;
    sim.bus.emit('construction:changed', c);
  }

  /** Stop a construction; delivered materials go back to your chest. */
  cancel(c) {
    if (c.status !== 'site') return;
    for (const [id, qty] of Object.entries(c.delivered)) this.sim.home.store(id, qty, { force: true });
    this.list.splice(this.list.indexOf(c), 1);
    if (c.kind === 'building') this.sim.world.blockRect(c.tx, c.ty, c.w, c.h, 0);
    this.sim.toast('toast.site_cancelled', {}, 'info');
    this.sim.bus.emit('construction:removed', c);
  }

  // ------------------------------------------------------------------ what finished buildings do

  /** Move into a house you built (you stop paying rent). */
  canMoveIn(id) {
    const c = this.byId(id);
    return !!c && c.status === 'done' && c.type === 'small_house' && this.sim.state.player.homeId !== id;
  }

  moveIn(id) {
    if (!this.canMoveIn(id)) return false;
    const p = this.sim.state.player;
    const c = this.byId(id);
    p.homeId = id;
    p.homeTier = c.visual ? c.visual.replace('player_', '') : 'small_house';
    p.rent.amount = 0;
    this.sim.progression.addReputation(3);
    this.sim.toast('toast.moved_in', {}, 'good');
    this.sim.chronicle('chronicle.player_moved_in', {});
    this.sim.bus.emit('player:changed');
    this.sim.bus.emit('home:changed');
    return true;
  }

  extraStorage() {
    return this.finished().reduce((s, c) => s + (BUILDABLES[c.type]?.effect?.storage || 0), 0);
  }

  /** Wells you built (and the village well) are water sources. */
  isWaterSource(tx, ty) {
    return this.finished().some((c) => BUILDABLES[c.type]?.effect?.water && Math.abs(c.tx - tx) <= 1 && Math.abs(c.ty - ty) <= 1);
  }

  // ------------------------------------------------------------------ roads

  /** Roads extend existing road networks, one tile at a time. */
  canRoad(tx, ty) {
    const world = this.sim.world;
    const p = this.sim.state.player;
    if (!this.sim.progression.hasUnlock('construction')) return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel('construction') } };
    if (!world.inBounds(tx, ty) || world.isRoad(tx, ty)) return { ok: false, reason: 'bad_ground' };
    if (world.isWater(tx, ty) || world.tileAt(tx, ty) === T.CLIFF || world.tileAt(tx, ty) === T.FARMLAND) return { ok: false, reason: 'bad_ground' };
    if (world.isBlocked(tx, ty) || this.sim.state.fields[`${tx},${ty}`]) return { ok: false, reason: 'obstructed' };
    const plot = this.sim.land.plotAt(tx, ty);
    if (plot && !this.sim.land.isOwned(plot.id)) return { ok: false, reason: 'not_your_land' };
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => world.isRoad(tx + dx, ty + dy) || world.tileAt(tx + dx, ty + dy) === T.DIRT);
    if (!touches) return { ok: false, reason: 'road_must_connect' };
    const ptile = world.toTile(p.x, p.y);
    if (Math.abs(ptile.tx - tx) + Math.abs(ptile.ty - ty) > 6) return { ok: false, reason: 'too_far' };
    if (this.sim.inventory.count('stone') + this.sim.home.storageCount('stone') < ROAD_COST.stone) return { ok: false, reason: 'missing_materials', params: { item: 'stone', qty: ROAD_COST.stone } };
    return { ok: true };
  }

  buildRoad(tx, ty) {
    const c = this.canRoad(tx, ty);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const fromPockets = this.sim.inventory.remove('stone', ROAD_COST.stone);
    if (fromPockets < ROAD_COST.stone) this.sim.home.take('stone', ROAD_COST.stone - fromPockets);
    this.sim.world.setRoad(tx, ty);
    this.sim.state.land.roads.push(`${tx},${ty}`);
    this.sim.progression.addXp(1);
    this.sim.progression.addSkillXp('construction', 2);
    this.sim.state.stats.roadsBuilt = (this.sim.state.stats.roadsBuilt || 0) + 1;
    this.sim.bus.emit('road:built', { tx, ty });
    return true;
  }
}
