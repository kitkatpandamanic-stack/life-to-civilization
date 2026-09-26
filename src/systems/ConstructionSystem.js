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
import { TYPE_FAMILY, levelDef } from '../data/structures.js';
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
    if (c.kind === 'works') return this.sim.structures?.cost(c.target, c.job);
    return this.isPlayers(c) ? BUILDABLES[c.type] : VILLAGE_BUILDINGS[c.type];
  }

  /** Re-apply saved construction to the freshly generated world (after loading). */
  restore() {
    const world = this.sim.world;
    for (const key of this.sim.state.land.roads) {
      const [x, y] = key.split(',').map(Number);
      world.setRoad(x, y);
    }
    const done = [];
    for (const c of this.list) {
      // Work on a building that's growing: the ground it's growing onto is taken.
      if (c.kind === 'works' && c.status === 'site' && c.fp) this.blockExtra(c, 1);
      if (c.kind !== 'building') continue;
      if (c.status === 'done') done.push(c);
      else world.blockRect(c.tx, c.ty, c.w, c.h, 1);
    }
    // In the order they were finished — as they stood before saving (so the game goes on exactly as it would have).
    done.sort((a, b) => (a.builtSeq ?? 0) - (b.builtSeq ?? 0) || (a.builtDay ?? 0) - (b.builtDay ?? 0));
    for (const c of done) world.addBuilding(this.buildingRecord(c));
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
   * Work on an existing building (StructureSystem): a new level, a module, a renovation…
   * The site sits over the building; if it grows, the new ground is taken at once.
   */
  startWorks({ owner, target, job, required, laborNeeded, budget = 0, fp = null }) {
    const b = this.sim.world.buildings[target];
    const box = fp || { tx: b.tx, ty: b.ty, w: b.w, h: b.h };
    const c = {
      id: `wk${this.sim.state.settlement.nextBuildId++}`,
      kind: 'works',
      type: b.type,
      target,
      job,
      tx: box.tx,
      ty: box.ty,
      w: box.w,
      h: box.h,
      fp,
      status: 'site',
      labor: 0,
      laborNeeded: Math.max(60, laborNeeded),
      required: { ...required },
      delivered: {},
      owner,
      purpose: 'works',
      budget,
      createdDay: this.sim.time.day,
      lastProgressDay: this.sim.time.day,
      variant: b.variant || 0,
    };
    this.list.push(c);
    if (fp) this.blockExtra(c, 1);
    this.sim.bus.emit('construction:changed', c);
    return c;
  }

  /** The ground a works site takes beyond the building it's working on. */
  extraTiles(c) {
    const b = this.sim.world.buildings[c.target];
    const out = [];
    if (!c.fp) return out;
    const o = c.job?.with ? this.sim.world.buildings[c.job.with] : null; // (two joined into one: the other one's ground is its own)
    for (let y = c.fp.ty; y < c.fp.ty + c.fp.h; y++) {
      for (let x = c.fp.tx; x < c.fp.tx + c.fp.w; x++) {
        if (b && x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
        if (o && x >= o.tx && x < o.tx + o.w && y >= o.ty && y < o.ty + o.h) continue;
        out.push([x, y]);
      }
    }
    return out;
  }

  blockExtra(c, v) {
    const w = this.sim.world;
    for (const [x, y] of this.extraTiles(c)) if (w.inBounds(x, y)) w.staticBlocked[w.idx(x, y)] = v;
  }

  /** Take a site off the ground (cancelled, abandoned): whatever it had taken is free again. */
  release(c) {
    if (c.kind === 'building') this.sim.world.blockRect(c.tx, c.ty, c.w, c.h, 0);
    else if (c.kind === 'works') {
      if (c.fp) this.blockExtra(c, 0);
      this.sim.structures?.ended(c);
    }
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
    if (def.tech && !this.sim.tech?.has(def.tech)) return { ok: false, reason: 'needs_tech', params: { tech: def.tech } }; // (a station needs the know-how of railways)
    // The Architect perk opens larger designs two levels early.
    const needSkill = Math.max(0, (def.minSkill || 0) - (Mod.perk(p, 'architect') ? 2 : 0));
    if (needSkill && skill(p, 'construction') < needSkill) return { ok: false, reason: 'need_skill', params: { skill: 'construction', level: needSkill } };
    if (p.money < def.money) return { ok: false, reason: 'no_money' };
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        if (def.founding) {
          const f = this.sim.colony.canFound(x, y);
          if (!f.ok) return f;
        } else if (def.outpost ? !this.sim.exploration.outpostAllowed(type, x, y) : !this.sim.land.ownsTile(x, y)) return { ok: false, reason: def.outpost ? 'need_explored_site' : 'not_your_land' };
        if (world.isWater(x, y) || world.tileAt(x, y) === T.CLIFF) return { ok: false, reason: 'bad_ground' };
        if (world.isBlocked(x, y)) return { ok: false, reason: 'obstructed' };
        if (this.sim.state.fields[`${x},${y}`]) return { ok: false, reason: 'obstructed' };
      }
    }
    const door = { tx: tx + Math.floor(def.w / 2), ty: ty + def.h };
    if (def.w > 1 && world.isBlocked(door.tx, door.ty)) return { ok: false, reason: 'door_blocked' };
    // (a dock on the riverbank: the water within a jetty's reach — two tiles, across the sand)
    if (def.waterside) {
      let wet = false;
      for (let yy = ty - 2; yy <= ty + def.h + 1 && !wet; yy++) for (let xx = tx - 2; xx <= tx + def.w + 1 && !wet; xx++) if (world.isWater(xx, yy)) wet = true;
      if (!wet) return { ok: false, reason: 'need_waterside' };
    }
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
    // A house of yours grows level by level (StructureSystem) — the same as any building.
    const S = this.sim.structures;
    const r = p.homeId && S?.rec(p.homeId);
    if (r) {
      if (r.lvl >= S.maxLevel(p.homeId)) return { ok: false, reason: 'cant_upgrade' };
      const chk = S.check(p.homeId, { type: 'level', to: r.lvl + 1 }, 'player');
      return chk.ok ? { ...chk, structure: true, next: r.lvl + 1 } : chk;
    }
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
    if (chk.structure) return this.sim.structures.start(this.sim.state.player.homeId, { type: 'level', to: chk.next }, 'player').site || null;
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
      this.refreshState(c);
      this.sim.bus.emit('construction:changed', c);
      this.tryComplete(c);
    }
    return total;
  }

  /** Accept materials carried by a worker. */
  receive(c, id, qty) {
    c.delivered[id] = (c.delivered[id] || 0) + qty;
    this.sim.bus.emit('construction:changed', c);
    this.refreshState(c);
    this.tryComplete(c);
  }

  /**
   * Where a site stands: ACTIVE (work can go on), WAITING_FOR_MATERIALS (the work has caught up
   * with what's been delivered — nobody can go on until more arrives), READY (everything's here,
   * only the work is left) or DONE.
   */
  siteState(c) {
    if (!c || c.status !== 'site') return 'done';
    if (this.materialsFraction(c) >= 1) return 'ready';
    return c.labor >= this.maxLabor(c) - 0.5 ? 'waiting_materials' : 'active';
  }
  /** Keep the site's state up to date — and say so when a waiting site can go on again. */
  refreshState(c) {
    const s = this.siteState(c);
    if (c.siteState === s) return;
    const was = c.siteState;
    c.siteState = s;
    if (was === 'waiting_materials' && s !== 'done') this.sim.bus.emit('construction:resumed', c);
    if (s === 'waiting_materials') this.sim.bus.emit('construction:waiting', c);
  }
  /** Materials on their way to a site right now (in your workers' arms and barrows). */
  onTheWay(c) {
    const out = {};
    for (const w of this.sim.workers.list()) {
      const n = this.sim.npcs.byId(w.npcId);
      if (n?.carry?.to !== c.id) continue;
      for (const [id, q] of Object.entries(n.carry.items || { [n.carry.item]: n.carry.qty })) out[id] = (out[id] || 0) + q;
    }
    return out;
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
    this.refreshState(c);
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
    c.builtSeq = this.sim.state.settlement.builtSeq = (this.sim.state.settlement.builtSeq || 0) + 1;
    const sim = this.sim;
    this.refund(c);
    if (c.kind === 'repair') {
      sim.disasters?.repaired(c);
      sim.bus.emit('construction:changed', c);
      return;
    }
    if (c.kind === 'works') {
      // The building changes (StructureSystem): a new level, a room, a wing, a renovation.
      sim.structures?.finish(c);
      if (this.isPlayers(c)) {
        sim.progression.addXp(25 + Math.round(c.laborNeeded / 30));
        sim.progression.addSkillXp('construction', 20);
      }
      this.list.splice(this.list.indexOf(c), 1); // the building's own history keeps the record
      sim.bus.emit('construction:changed', c);
      sim.bus.emit('construction:removed', c);
      sim.bus.emit('building:changed', c.target);
      return;
    }
    if (c.kind === 'upgrade') {
      const target = this.byId(c.target);
      if (target) target.visual = `player_${c.toTier}`;
      if (sim.state.player.homeId === c.target) sim.state.player.homeTier = c.toTier;
      const rec = sim.world.buildings[c.target];
      if (rec) rec.type = target.visual;
      // (An upgrade started before buildings had levels: the building is now drawn as its new type, at that level.)
      const sr = sim.structures?.rec(c.target);
      if (sr) {
        sr.lvl = sr.base = { house: 3, large_house: 4, estate: 5 }[c.toTier] ?? sr.lvl;
        sim.structures.changed(c.target);
        sim.structures.refreshLook(c.target, false);
      }
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

  /**
   * Pay builders to work on your site: money put down for them (and for day labourers) —
   * and, if you like, for them to buy the materials too. What's left comes back when it's done.
   */
  hire(c, amount, { buyMaterials = false } = {}) {
    const p = this.sim.state.player;
    if (!c || c.status !== 'site' || !this.isPlayers(c)) return { ok: false, reason: 'nothing_here' };
    if (p.money < amount) return { ok: false, reason: 'no_money', params: { money: amount } };
    p.money -= amount;
    c.budget = (c.budget || 0) + amount;
    c.hired = true;
    if (buyMaterials) c.buyMats = true;
    this.sim.bus.emit('construction:changed', c);
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** Money left over on a site of yours comes back to you. */
  refund(c) {
    if (!this.isPlayers(c) || !(c.budget > 0)) return;
    this.sim.state.player.money += Math.floor(c.budget);
    c.budget = 0;
    this.sim.bus.emit('player:changed');
  }

  /** Stop a construction; delivered materials go back to your chest. */
  cancel(c) {
    if (c.status !== 'site') return;
    this.refund(c);
    for (const [id, qty] of Object.entries(c.delivered)) this.sim.home.store(id, qty, { force: true });
    this.list.splice(this.list.indexOf(c), 1);
    this.release(c);
    this.sim.toast('toast.site_cancelled', {}, 'info');
    this.sim.bus.emit('construction:removed', c);
  }

  // ------------------------------------------------------------------ what finished buildings do

  /** Move into a house of yours — one you built, bought or inherited that nobody lives in (you stop paying rent). */
  canMoveIn(id) {
    const p = this.sim.state.player;
    if (p.homeId === id) return false;
    const c = this.byId(id);
    if (c && c.status === 'done' && c.type === 'small_house') return true;
    const P = this.sim.property;
    const r = P.rec(id);
    // (A block of flats of yours: a free flat is enough.)
    const room = this.sim.flats?.isBlock(id) ? this.sim.flats.free(id) > 0 : P.occupants(id) === 0;
    return !!r && r.owner === 'player' && P.isHome(id) && !r.ruined && id !== 'hall' && !this.sim.economy.businessAtBuilding(id) && room;
  }

  moveIn(id) {
    if (!this.canMoveIn(id)) return false;
    const p = this.sim.state.player;
    const c = this.byId(id);
    const old = p.homeId;
    if (this.sim.flats?.isBlock(id)) this.sim.flats.playerMoveIn(id); // a flat of your own in it
    p.homeId = id;
    p.homeTier = c?.visual ? c.visual.replace('player_', '') : c ? 'small_house' : p.homeTier;
    p.rent.amount = 0;
    // Your family comes with you.
    const family = [p.spouse, ...(p.children || [])].map((x) => this.sim.npcs.byId(x)).filter((n) => n && old && n.homeId === old);
    if (family.length) this.sim.property.moveIn(family, id, 'moved');
    this.sim.structures?.syncHome();
    this.sim.progression.addReputation(3);
    this.sim.toast('toast.moved_in', {}, 'good');
    this.sim.chronicle('chronicle.player_moved_in', {});
    this.sim.bus.emit('player:changed');
    this.sim.bus.emit('home:changed');
    return true;
  }

  extraStorage() {
    return this.finished().reduce((s, c) => s + this.storageOf(c.id), 0);
  }

  /** What a storage building of yours holds: more as it's built up (a level's stock against the first). */
  storageOf(id) {
    const c = this.byId(id);
    const base = c && BUILDABLES[c.type]?.effect?.storage;
    if (!base) return 0;
    const r = this.sim.structures?.rec(id);
    const f = TYPE_FAMILY[c.type];
    const mult = r && f ? (levelDef(r.fam, r.lvl)?.stock || 1) / (levelDef(f[0], f[1])?.stock || 1) : 1;
    return Math.round(base * mult);
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
    // Roads go on your land, the village's, or land nobody owns — not across a neighbour's.
    const T2 = this.sim.territory;
    const owner = T2 ? T2.ownerAt(tx, ty) : undefined;
    const plot = this.sim.land.plotAt(tx, ty);
    if (T2 ? owner !== undefined && owner !== null && owner !== 'player' && owner !== 'village' : plot && !this.sim.land.isOwned(plot.id)) return { ok: false, reason: 'not_your_land' };
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
