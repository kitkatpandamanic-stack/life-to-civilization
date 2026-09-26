/**
 * StructureSystem — every building as a structure that can grow and change.
 *
 *   state.structures[buildingId] = {
 *     fam, lvl, base,        family (house, workshop, farm, shop…), its level now and the level it was designed at
 *     q,                     quality 0–100 (how well it was made and has been kept — separate from condition)
 *     mods: { bedroom: 2 },  modules it has been fitted out with
 *     annex: [{ m, side, cols }], parts built out beside it (a garden, a cart shed, a barn…)
 *     spec,                  specialization (a boarding house, a fine workshop…)
 *     fp: { tx, ty, w, h, dx }, its footprint, if it has grown since it was built (dx = where the door is)
 *     visual,                what it's drawn as, if converted (Phase 13)
 *     built, by, ups, ren,   when it went up, who built it, how many upgrades and renovations
 *     uses: [{ u, d }], hh, heads: [], hist: [{ d, k, p }]   what it's been used for, households, history
 *     work,                  the construction site working on it now, if any
 *   }
 *
 * The owner of a building (PropertySystem) decides what's done to it; the work is a real
 * construction site over the building (ConstructionSystem kind 'works') — materials
 * delivered, hours put in, scaffolding you can see — and when it's done the building
 * really is different: more room, more staff, more stock, a wider footprint, a second floor,
 * new walls and roof. Villagers improve their own homes and premises when they need to
 * and can afford it; you do the same to yours.
 *
 * The single place where a building's level, modules and quality turn into effects:
 *   capacity (PropertySystem) · staff, output, stock, customers (NPCSystem, EconomySystem)
 *   seats (SchoolSystem) · comfort, storage, home tier (HomeSystem) · value (PropertySystem)
 */
import { TYPE_FAMILY, FAMILIES, MODULES, SPECS, QUALITY as QL, WORKS, HOME_TIER_OF_LEVEL, LOOK_COLORS, CONVERSIONS, REBUILD, levelDef, maxLevel } from '../data/structures.js';
import { PUBLIC_BUILDINGS } from '../data/housing.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { ITEMS } from '../data/items.js';
import { HOME_TIERS } from '../data/homes.js';
import { T } from '../world/WorldGenerator.js';
import { hashStr } from '../core/rng.js';
import { BUILDABLES, catalogCategory } from '../data/buildables.js';
import { conditionBand } from '../data/transport.js';
import { Mod, skill } from './Modifiers.js';

const NOT_ON = [T.WATER, T.DEEP, T.CLIFF, T.MOUNTAIN, T.FARMLAND, T.ROAD, T.PLAZA, T.BRIDGE];

/** Move a building's footprint in the world (grown, or restored after loading). */
export function moveFootprint(world, b, fp) {
  world.blockRect(b.tx, b.ty, b.w, b.h, 0);
  b.tx = fp.tx;
  b.ty = fp.ty;
  b.w = fp.w;
  b.h = fp.h;
  b.door = { tx: fp.tx + (fp.dx ?? Math.floor(fp.w / 2)), ty: fp.ty + fp.h };
  world.blockRect(b.tx, b.ty, b.w, b.h, 1);
}

/**
 * Re-apply what's been done to buildings — grown footprints, conversions, demolitions —
 * to a freshly generated world (called by Simulation right after loading, before anything
 * else looks at the buildings).
 */
export function restoreStructures(sim) {
  const world = sim.world;
  for (const [id, r] of Object.entries(sim.state.structures || {})) {
    const b = world.buildings[id];
    if (!b) continue;
    if (r.gone) {
      world.removeBuilding(id);
      continue;
    }
    if (r.fp) moveFootprint(world, b, r.fp);
    if (r.visual) b.type = r.visual;
  }
}

export class StructureSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.structures ??= {};
    this.fxCache = new Map();
    for (const b of sim.world.buildingList) this.ensure(b.id);
    for (const id of Object.keys(this.all)) this.refreshLook(id, false);
    sim.bus.on('building:added', (id) => this.onBuilt(id));
    sim.bus.on('time:day', () => this.onDay());
    this.syncHome();
  }

  get all() {
    return this.sim.state.structures;
  }
  get world() {
    return this.sim.world;
  }
  /** The structure record of a standing building (null for wells, demolished buildings…). */
  rec(id) {
    const r = this.all[id];
    return r && !r.gone ? r : null;
  }

  // ------------------------------------------------------------------ records

  ensure(id) {
    if (this.all[id]) return this.rec(id);
    const b = this.world.buildings[id];
    if (!b) return null;
    const c = this.sim.construction?.byId(id);
    const f = TYPE_FAMILY[b.type] || TYPE_FAMILY[c?.type];
    if (!f) return null;
    const r = {
      fam: f[0],
      lvl: f[1],
      base: f[1],
      q: this.seedQuality(id, b.type),
      mods: {},
      annex: [],
      spec: null,
      built: c?.builtDay ?? 0,
      by: c ? c.owner || 'player' : null,
      ups: 0,
      ren: 0,
      uses: [],
      hh: 0,
      heads: [],
      hist: [],
    };
    this.all[id] = r;
    return r;
  }

  seedQuality(id, type) {
    if (QL.byType[type] !== undefined) return QL.byType[type];
    const h = hashStr(id, this.sim.state.seed | 0);
    return Math.round(Math.max(18, Math.min(88, QL.seedBase + (h - 0.5) * 2 * QL.seedSpread)));
  }

  /** A newly finished building: its quality comes from who built it and with what. */
  onBuilt(id) {
    const r = this.ensure(id);
    if (!r) return;
    const c = this.sim.construction.byId(id);
    if (!c) return;
    r.built = this.sim.time.day;
    r.by = c.owner || 'player';
    r.q = Math.round(Math.min(this.qualityCap(id), this.workQuality(c)));
    this.changed(id);
    this.note(id, 'built', { who: r.by });
    this.refreshLook(id);
  }

  note(id, k, p = {}) {
    const r = this.rec(id);
    if (!r) return;
    r.hist.push({ d: this.sim.time.day, k, p });
    if (r.hist.length > QL.maxHistory) r.hist.splice(1, 1); // keep the first entry (when it went up)
  }

  /** New people moved in: another household in the building's story. */
  movedIn(id, people) {
    const r = this.rec(id);
    if (!r || !people.length) return;
    const head = people.find((n) => n.age >= 18) || people[0];
    const key = head.id;
    if (r.heads.includes(key) || people.some((n) => r.heads.includes(n.id))) return;
    r.heads.push(key);
    if (r.heads.length > 12) r.heads.shift();
    r.hh = (r.hh || 0) + 1;
  }

  // ------------------------------------------------------------------ what it is

  family(id) {
    const r = this.rec(id);
    return r ? FAMILIES[r.fam] : null;
  }
  level(id) {
    return this.rec(id)?.lvl ?? 0;
  }
  maxLevel(id) {
    const r = this.rec(id);
    return r ? maxLevel(r.fam) : 0;
  }
  quality(id) {
    const r = this.rec(id);
    if (!r) return 50;
    return Math.max(0, Math.min(100, Math.round(r.q + (this.fx(id).quality || 0))));
  }

  /** The best this building can be: better levels and more rooms raise the ceiling. */
  qualityCap(id) {
    const r = this.rec(id);
    if (!r) return 100;
    const mods = Object.values(r.mods).reduce((s, n) => s + n, 0);
    return Math.min(100, Math.round(QL.capBase + r.lvl * QL.capPerLevel + mods * QL.capPerModule));
  }

  /**
   * Everything the building's level, modules, specialization and quality add up to.
   * Business effects (staff, output, stock, appeal, seats, service) are relative to the
   * level the building was designed at — so the valley's founding buildings work as they always did.
   */
  fx(id) {
    const r = this.rec(id);
    if (!r) return null;
    const hit = this.fxCache.get(id);
    if (hit && hit.r === r && hit.day === this.sim.time.day) return hit.fx;
    const fx = this.computeFx(r);
    this.fxCache.set(id, { r, day: this.sim.time.day, fx });
    return fx;
  }

  /** Something about the building changed: work its effects out afresh. */
  changed(id) {
    this.fxCache.delete(id);
    this.sim.property?.valueCache?.delete(id);
  }

  computeFx(r) {
    const L = levelDef(r.fam, r.lvl) || {};
    const B = levelDef(r.fam, r.base) || L;
    const fx = {
      cap: L.cap ?? null,
      units: L.units || 1,
      floors: L.floors || 1,
      staff: (L.staff || 0) - (B.staff || 0),
      output: (L.output || 1) / (B.output || 1),
      stock: (L.stock || 1) / (B.stock || 1),
      appeal: (L.appeal || 0) - (B.appeal || 0),
      seats: (L.seats || 0) - (B.seats || 0),
      service: (L.service || 1) / (B.service || 1),
      comfort: 0,
      storage: 0,
      value: (L.value || 1) / (B.value || 1),
      quality: 0,
      rentMult: 1,
      food: 0,
      warm: false,
      health: false,
      shopFloor: false,
      travellers: !!L.travellers,
      apprentices: L.apprentices || 0,
    };
    for (const [m, n] of Object.entries(r.mods)) {
      const d = MODULES[m];
      if (!d || !n) continue;
      if (fx.cap !== null) fx.cap += (d.cap || 0) * n;
      fx.floors += (d.floors || 0) * n;
      fx.staff += (d.staff || 0) * n;
      fx.output *= 1 + (d.output || 0) * n;
      fx.stock += (d.stock || 0) * n;
      fx.appeal += (d.appeal || 0) * n;
      fx.seats += (d.seats || 0) * n;
      fx.service += (d.service || 0) * n;
      fx.comfort += (d.comfort || 0) * n;
      fx.storage += (d.storage || 0) * n;
      fx.value *= (d.value || 1) ** n;
      fx.quality += (d.quality || 0) * n;
      fx.food += (d.food || 0) * n;
      if (d.warm) fx.warm = true;
      if (d.health) fx.health = true;
      if (d.shop) fx.shopFloor = true;
    }
    const s = r.spec && SPECS[r.spec];
    if (s) {
      if (fx.cap !== null) fx.cap += s.cap || 0;
      fx.output *= 1 + (s.output || 0);
      fx.appeal += s.appeal || 0;
      fx.comfort += s.comfort || 0;
      fx.rentMult *= s.rentMult || 1;
      fx.quality += s.quality || 0;
      fx.food += s.food || 0;
      if (s.travellers) fx.travellers = true;
    }
    // A well-made building works a little better, and draws people a little more.
    const q = Math.max(0, Math.min(100, r.q + fx.quality));
    fx.output *= 0.95 + (q / 100) * 0.1;
    fx.appeal += (q - 50) / 50;
    return fx;
  }

  /** How many people can live here (null: not a family with homes — PropertySystem falls back to its table). */
  capacity(id) {
    return this.fx(id)?.cap ?? null;
  }
  units(id) {
    return this.fx(id)?.units || 1;
  }
  staffBonus(id) {
    return Math.max(-3, this.fx(id)?.staff || 0);
  }
  outputMult(id) {
    return this.fx(id)?.output || 1;
  }
  stockMult(id) {
    return this.fx(id)?.stock || 1;
  }
  appeal(id) {
    return this.fx(id)?.appeal || 0;
  }
  seatBonus(id) {
    return Math.max(0, this.fx(id)?.seats || 0);
  }
  service(id) {
    return this.fx(id)?.service || 1;
  }
  /** Worth relative to the building as it was designed (level, rooms, quality). */
  valueFactor(id) {
    const fx = this.fx(id);
    if (!fx) return 1;
    return fx.value * (0.8 + (this.quality(id) / 100) * 0.4);
  }

  /** What to call it: "Medium house", "Master workshop"… */
  levelKey(id) {
    const r = this.rec(id);
    return r ? `structure.level.${r.fam}.${r.lvl}` : null;
  }

  /** Is anything being done to it right now? */
  works(id) {
    const r = this.rec(id);
    const c = r?.work && this.sim.construction.byId(r.work);
    return c && c.status === 'site' ? c : null;
  }

  // ------------------------------------------------------------------ what can be done to it

  /** Everything that could be done to this building now (with the cost and whether it's possible). */
  options(id, by = 'player') {
    const r = this.rec(id);
    if (!r) return [];
    const F = FAMILIES[r.fam];
    const out = [];
    const add = (job) => {
      const check = this.check(id, job, by);
      out.push({ job, cost: check.cost || this.cost(id, job), check }); // check.cost includes land it would grow onto
    };
    if (r.lvl < maxLevel(r.fam)) add({ type: 'level', to: r.lvl + 1 });
    for (const m of F.modules) {
      const d = MODULES[m];
      if (!d || !d.fams.includes(r.fam)) continue;
      if ((r.mods[m] || 0) >= (d.max || 1)) continue;
      add({ type: 'module', m });
    }
    if (F.specs?.length && r.lvl >= (F.specFrom ?? 99)) for (const s of F.specs) if (r.spec !== s) add({ type: 'spec', s });
    if (this.quality(id) < this.qualityCap(id) - 3) add({ type: 'renovate' });
    // Changing what it is (Phase 13): turn it into something else, join it with a neighbour, pull it down.
    for (const to of this.conversions(id)) add({ type: 'convert', to });
    for (const other of this.mergeable(id, by)) add({ type: 'merge', with: other });
    add({ type: 'demolish' });
    return out;
  }

  /** Money (paid up front), materials, work (hours), and what else it takes. */
  cost(id, job) {
    const r = this.rec(id);
    if (!r) return null;
    if (job.type === 'level') {
      const L = levelDef(r.fam, job.to);
      return L?.cost ? { money: L.cost.money, materials: { ...L.cost.materials }, labor: L.cost.labor, minSkill: L.cost.minSkill || 0, tech: L.cost.tech || [], anyTech: L.cost.anyTech || null } : null;
    }
    if (job.type === 'module') {
      const d = MODULES[job.m];
      return { money: d.cost.money, materials: { ...d.cost.materials }, labor: d.cost.labor, minSkill: 0, tech: d.needs?.tech ? [d.needs.tech] : [] };
    }
    if (job.type === 'spec') return { money: 40, materials: { planks: 8, wood: 6 }, labor: 4, minSkill: 1, tech: [] };
    if (job.type === 'convert' || job.type === 'demolish' || job.type === 'merge') return this.rebuildCost(id, job);
    if (job.type === 'renovate') {
      const R = WORKS.renovate;
      const pts = Math.max(1, Math.min(QL.renovateGain, this.qualityCap(id) - r.q));
      const materials = {};
      for (const [item, per] of Object.entries(R.perQualityPoint)) {
        const q = Math.ceil(pts * per * (1 + r.lvl * 0.25));
        if (q > 0) materials[item] = q;
      }
      return { money: Math.round(pts * R.moneyPerPoint * (1 + r.lvl * 0.2)), materials, labor: Math.max(R.minLabor, Math.round(pts * R.laborPerPoint)), minSkill: 1, tech: [], points: pts };
    }
    return null;
  }

  /** Materials at today's prices (what a villager needs to have put by). */
  estimate(cost) {
    let v = cost.money || 0;
    for (const [item, qty] of Object.entries(cost.materials || {})) v += qty * (ITEMS[item]?.basePrice || 4);
    return Math.round(v);
  }

  /** Who owns it — only they can have work done on it. */
  owner(id) {
    return this.sim.property.rec(id)?.owner ?? null;
  }

  check(id, job, by = 'player') {
    const sim = this.sim;
    const r = this.rec(id);
    if (!r) return { ok: false, reason: 'cant_improve' };
    if (this.owner(id) !== by) return { ok: false, reason: 'not_yours' };
    if (this.works(id)) return { ok: false, reason: 'works_underway' };
    const pr = sim.property.rec(id);
    // Converting, joining and pulling down have rules of their own (and ruins can only be pulled down).
    if (REBUILD[job.type]) {
      const why = this.rebuildBlock(id, job, by);
      if (why) return why;
    } else if (pr?.ruined) return { ok: false, reason: 'restore_first' };
    let cost = this.cost(id, job);
    if (!cost) return { ok: false, reason: 'cant_improve' };
    for (const tech of cost.tech || []) if (!sim.tech?.has(tech)) return { ok: false, reason: 'need_tech', params: { tech } };
    if (cost.anyTech && !cost.anyTech.some((t) => sim.tech?.has(t))) return { ok: false, reason: 'need_tech', params: { tech: cost.anyTech[0] } };
    if (job.type === 'level') {
      const L = levelDef(r.fam, job.to);
      if (job.to !== r.lvl + 1 || !L) return { ok: false, reason: 'cant_improve' };
      if (L.minQuality && this.quality(id) < L.minQuality) return { ok: false, reason: 'need_quality', params: { n: L.minQuality } };
    }
    if (job.type === 'module') {
      const d = MODULES[job.m];
      if (!d || !d.fams.includes(r.fam)) return { ok: false, reason: 'cant_improve' };
      if (r.lvl < d.from) return { ok: false, reason: 'need_blevel', params: { n: d.from } };
      if ((r.mods[job.m] || 0) >= (d.max || 1)) return { ok: false, reason: 'have_module' };
      const slots = levelDef(r.fam, r.lvl)?.slots || 1;
      const used = Object.entries(r.mods).reduce((s, [m, n]) => s + (MODULES[m]?.space ? 0 : n), 0);
      if (!d.space && used >= slots) return { ok: false, reason: 'no_slots', params: { n: slots } };
      if (job.m === 'upper_floor' && (levelDef(r.fam, r.lvl)?.floors || 1) >= 2) return { ok: false, reason: 'have_module' };
      if (d.needs?.water && !this.nearWater(id)) return { ok: false, reason: 'need_water' };
      if (d.needs?.road && !sim.property.nearRoad(this.world.buildings[id])) return { ok: false, reason: 'need_road' };
    }
    if (job.type === 'spec') {
      const s = SPECS[job.s];
      if (!s) return { ok: false, reason: 'cant_improve' };
      if (s.minQuality && this.quality(id) < s.minQuality) return { ok: false, reason: 'need_quality', params: { n: s.minQuality } };
    }
    if (job.type === 'renovate' && this.quality(id) >= this.qualityCap(id) - 3) return { ok: false, reason: 'no_renovation_needed' };
    // Room to grow: the new footprint must fit on free ground its owner may use (two joined: the ground between them too).
    const grow = this.growthOf(id, job);
    const fp = this.jobFootprint(id, job, by);
    if (grow && !fp) return { ok: false, reason: 'no_room', params: { n: grow.cols || grow.rows } };
    if (job.type === 'merge' && !fp) return { ok: false, reason: 'merge_no_room' };
    // Growing onto ground that isn't yours yet: the strip is bought from the village with the work.
    const land = fp ? this.landPrice(fp, by) : 0;
    if (land) cost = { ...cost, land };
    if (by === 'player') {
      const p = sim.state.player;
      const need = Math.max(0, (cost.minSkill || 0) - (Mod.perk(p, 'architect') ? 2 : 0));
      if (need && skill(p, 'construction') < need) return { ok: false, reason: 'need_skill', params: { skill: 'construction', level: need } };
      if (!sim.progression.hasUnlock('construction')) return { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('construction') } };
      if (p.money < cost.money + land) return { ok: false, reason: 'no_money', params: { money: cost.money + land } };
    } else {
      const purse = this.purseOf(id, by);
      if (!purse || purse.get() < this.estimate(cost) * WORKS.npcMoneyCushion + land) return { ok: false, reason: 'no_money', params: { money: this.estimate(cost) + land } };
    }
    return { ok: true, cost };
  }

  /** The price of the land a new footprint needs that its owner doesn't have yet. */
  landPrice(fp, by) {
    const T2 = this.sim.territory;
    return T2 ? T2.lotPrice(by, fp.tx, fp.ty, fp.tx + fp.w - 1, fp.ty + fp.h - 1) : 0;
  }

  /** A well, a pump or the river close enough for a washroom. */
  nearWater(id) {
    const b = this.world.buildings[id];
    if (!b) return false;
    for (const o of this.world.buildingList) if (o.type === 'well' && Math.abs(o.tx - b.door.tx) + Math.abs(o.ty - b.door.ty) <= 14) return true;
    for (const d of this.world.decor) if (d.type === 'well' && Math.abs(d.tx - b.door.tx) + Math.abs(d.ty - b.door.ty) <= 14) return true;
    for (let y = b.ty - 5; y <= b.ty + b.h + 5; y++) for (let x = b.tx - 5; x <= b.tx + b.w + 5; x++) if (this.world.isWater(x, y)) return true;
    return false;
  }

  /** Who pays for work on this building: its owner — or, for business premises, the business's till. */
  purseOf(id, by) {
    const sim = this.sim;
    if (by === 'village') return { get: () => sim.state.village.treasury, pay: (x) => (sim.state.village.treasury -= x) };
    const E = sim.economy;
    const biz = E.businessAtBuilding(id);
    if (biz && E.ownerId(biz) === by) {
      const b = E.biz(biz);
      return { get: () => b.money, pay: (x) => ((b.money -= x), E.ledger(biz, 'exp', x)) };
    }
    const n = sim.npcs.byId(by);
    return n ? { get: () => n.money, pay: (x) => (n.money -= x) } : null;
  }

  // ------------------------------------------------------------------ growing on the ground

  /** Does this job make the building physically bigger? { cols, rows, annex } */
  growthOf(id, job) {
    const r = this.rec(id);
    const b = this.world.buildings[id];
    if (!r || !b) return null;
    if (job.type === 'level') {
      const L = levelDef(r.fam, job.to);
      const annexCols = r.annex.reduce((s, a) => s + a.cols, 0);
      const mainW = b.w - annexCols;
      const cols = Math.max(L.grow || 0, (L.minW || 0) - mainW);
      const rows = Math.max(0, (L.minH || 0) - b.h);
      return cols > 0 || rows > 0 ? { cols: Math.max(0, cols), rows } : null;
    }
    if (job.type === 'module' && MODULES[job.m]?.space) return { cols: MODULES[job.m].space, rows: 0, annex: job.m };
    return null;
  }

  /** Can this tile be built on by this owner? (Land rules: TerritorySystem.) */
  groundOk(x, y, by) {
    const world = this.world;
    if (!world.inBounds(x, y)) return false;
    if (world.staticBlocked[world.idx(x, y)]) return false;
    if (NOT_ON.includes(world.tileAt(x, y))) return false;
    if (this.sim.state.fields[`${x},${y}`]) return false;
    for (const o of world.buildingList) if (o.door.tx === x && o.door.ty === y) return false;
    return this.landOk(x, y, by);
  }

  /** May this owner build on this tile — their land, or land the village will sell them with the work? */
  landOk(x, y, by) {
    const T2 = this.sim.territory;
    if (T2) return T2.mayAcquire(by, x, y);
    const plot = this.sim.land.plotAt(x, y);
    if (!plot) return true;
    if (by === 'player') return this.sim.land.isOwned(plot.id);
    return this.sim.state.land.npcOwned?.[plot.id] === by;
  }

  /** Rocks in the way can't be built over (trees are felled when the work starts). */
  rockAt(x, y) {
    for (const o of Object.values(this.sim.state.objects)) if (o.kind === 'rock' && o.state !== 'depleted' && o.tx === x && o.ty === y) return true;
    return false;
  }

  /** The footprint after growing (to the right, else the left; deeper at the back), or null if there's no room. */
  newFootprint(id, grow, by) {
    const b = this.world.buildings[id];
    const r = this.rec(id);
    if (!b || !r) return null;
    const okCols = (x0, x1, y0, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!this.groundOk(x, y, by) || this.rockAt(x, y)) return false;
      return true;
    };
    let tx = b.tx;
    let ty = b.ty;
    let w = b.w;
    let h = b.h;
    let side = null;
    if (grow.rows > 0) {
      if (!okCols(b.tx, b.tx + b.w - 1, b.ty - grow.rows, b.ty - 1)) return null;
      ty -= grow.rows;
      h += grow.rows;
    }
    if (grow.cols > 0) {
      const prefer = hashStr(id, 7) < 0.5 ? ['right', 'left'] : ['left', 'right'];
      for (const s of prefer) {
        const x0 = s === 'right' ? tx + w : tx - grow.cols;
        if (okCols(x0, x0 + grow.cols - 1, ty, ty + h - 1)) {
          side = s;
          break;
        }
      }
      if (!side) return null;
      if (side === 'left') tx -= grow.cols;
      w += grow.cols;
    }
    // The door stays under the main building.
    const annex = [...r.annex, ...(grow.annex ? [{ m: grow.annex, side, cols: grow.cols }] : [])];
    const left = annex.filter((a) => a.side === 'left').reduce((s, a) => s + a.cols, 0);
    const right = annex.filter((a) => a.side === 'right').reduce((s, a) => s + a.cols, 0);
    const mainW = w - left - right;
    const dx = left + Math.floor(mainW / 2);
    const door = { tx: tx + dx, ty: ty + h };
    if (this.world.isBlocked(door.tx, door.ty) && !(door.tx === b.door.tx && door.ty === b.door.ty)) return null;
    return { tx, ty, w, h, dx, side };
  }

  // ------------------------------------------------------------------ doing the work

  /** Start work on a building: a construction site over it (materials, hours — and the money up front). */
  start(id, job, by = 'player') {
    const sim = this.sim;
    const chk = this.check(id, job, by);
    if (!chk.ok) return chk;
    const cost = chk.cost;
    const fp = this.jobFootprint(id, job, by);
    // The ground it grows onto becomes the owner's (paid to the village).
    if (fp && sim.territory && cost.land && sim.territory.acquireLot(by === 'village' ? 'village' : by, fp.tx, fp.ty, fp.tx + fp.w - 1, fp.ty + fp.h - 1, { pay: false }) >= 0) {
      if (by === 'player') sim.state.player.money -= cost.land;
      else this.purseOf(id, by)?.pay(cost.land);
      sim.territory.payTo('village', cost.land);
    }
    let budget = 0;
    let required = { ...cost.materials };
    if (by === 'player') {
      sim.state.player.money -= cost.money;
      required = sim.construction.playerMaterials(cost.materials);
    } else {
      const purse = this.purseOf(id, by);
      budget = Math.min(purse.get(), this.estimate(cost));
      purse.pay(budget);
    }
    const laborNeeded = Math.round(cost.labor * WORKS.laborPerLevelHour * (sim.tech?.mod('build_labor') ?? 1));
    const c = sim.construction.startWorks({ owner: by, target: id, job, required, laborNeeded, budget, fp });
    const r = this.rec(id);
    r.work = c.id;
    if (job.type === 'merge' && this.rec(job.with)) this.rec(job.with).work = c.id; // (both buildings are under the one site)
    // Trees where it's growing are felled (the timber goes into the work).
    if (fp) this.clearTrees(c, fp);
    this.note(id, 'works_started', { job: this.jobKey(job), who: by });
    if (by === 'player') sim.toast('toast.works_started', { building: id, works: this.jobKey(job) }, 'good');
    sim.bus.emit('building:changed', id);
    return { ok: true, site: c };
  }

  clearTrees(c, fp) {
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind !== 'tree' || o.tx < fp.tx || o.tx >= fp.tx + fp.w || o.ty < fp.ty || o.ty >= fp.ty + fp.h) continue;
      if (o.state === 'grown' || o.state === 'young') c.delivered.wood = (c.delivered.wood || 0) + 3;
      o.state = 'cleared';
      this.world.updateObjectBlocking(o);
      this.sim.resources.changed(o);
    }
  }

  /** 'level_4', 'module_bedroom', 'spec_boarding', 'renovate' — resolved to words by the UI ('works' param). */
  jobKey(job) {
    return job.type === 'level' ? `level_${job.to}` : job.type === 'module' ? `module_${job.m}` : job.type === 'spec' ? `spec_${job.s}` : job.type === 'convert' ? `convert_${job.to}` : job.type;
  }
  /** How good the work is: the builder's skill and the materials that went into it. */
  workQuality(c) {
    const sim = this.sim;
    let skillPts = 0;
    if (!c.owner || c.owner === 'player') skillPts = skill(sim.state.player, 'construction') + (Mod.perk(sim.state.player, 'architect') ? 2 : 0);
    else {
      // The best builder in the valley (or the owner, if they built it themselves).
      const E = sim.economy;
      let best = 0;
      for (const id of E.ofType?.('builders') || []) for (const n of [E.owner(id), ...sim.npcs.staffOf(id)].filter(Boolean)) best = Math.max(best, sim.education?.competence(n, 'building') || 0);
      const owner = sim.npcs.byId(c.owner);
      if (owner) best = Math.max(best, (sim.education?.competence(owner, 'building') || 0) * 0.7);
      skillPts = best / 10;
    }
    const m = { ...(c.required || {}) };
    let q = QL.builtBase + skillPts * QL.perBuilderSkill;
    if (m.stone) q += QL.stoneBonus;
    if (m.bricks) q += QL.brickBonus;
    if (m.glass) q += QL.glassBonus;
    if (m.iron_ingot) q += QL.ironBonus;
    // Knowing how to draw a plan helps (architecture).
    if (c.owner && c.owner !== 'player') q += (sim.tech?.has('surveying') ? 3 : 0);
    return Math.max(15, Math.min(100, q));
  }

  /** The work is done (ConstructionSystem.complete): the building really changes. */
  finish(c) {
    const sim = this.sim;
    const id = c.target;
    const r = this.rec(id);
    if (!r) return;
    const job = c.job;
    r.work = null;
    const wq = this.workQuality(c);
    // What's left of the money put by for the work goes back where it came from.
    if (c.owner !== 'player' && c.budget > 0) {
      this.purseOf(id, c.owner)?.pay(-Math.floor(c.budget));
      c.budget = 0;
    }
    if (job.type === 'level') {
      r.lvl = job.to;
      r.ups = (r.ups || 0) + 1;
      r.q = Math.round(r.q * 0.6 + wq * 0.4);
    } else if (job.type === 'module') {
      r.mods[job.m] = (r.mods[job.m] || 0) + 1;
      r.ups = (r.ups || 0) + 1;
      if (c.fp && MODULES[job.m]?.space) r.annex.push({ m: job.m, side: c.fp.side, cols: MODULES[job.m].space });
    } else if (job.type === 'spec') {
      r.spec = job.s;
    } else if (job.type === 'convert') {
      this.convert(id, job.to);
    } else if (job.type === 'demolish') {
      this.demolish(id, c);
      return; // (nothing left standing to update)
    } else if (job.type === 'merge') {
      this.mergeIn(id, job.with);
    } else if (job.type === 'renovate') {
      const pts = this.cost(id, job)?.points || QL.renovateGain;
      r.q = Math.round(Math.max(r.q, Math.min(this.qualityCap(id), r.q + pts * (0.6 + wq / 250))));
      r.ren = (r.ren || 0) + 1;
      const pr = sim.property.rec(id);
      if (pr) {
        pr.condition = 100;
        pr.abandoned = false;
      }
    }
    this.changed(id);
    r.q = Math.min(this.qualityCap(id), r.q);
    if (c.fp) this.setFootprint(id, c.fp);
    this.note(id, 'works_done', { job: this.jobKey(job), who: c.owner });
    sim.property.valueCache?.delete(id);
    this.refreshLook(id);
    this.syncHome();
    sim.bus.emit('property:changed', id);
    const owner = sim.npcs.byId(c.owner);
    if (c.owner === 'player') {
      sim.toast('toast.works_done', { building: id, works: this.jobKey(job) }, 'good');
      sim.chronicle('chronicle.player_improved', { building: id, works: this.jobKey(job) });
      if (id === sim.state.player.homeId && job.type === 'level') sim.progression.addReputation(HOME_TIERS[HOME_TIER_OF_LEVEL[r.lvl]]?.reputation ? 2 : 1);
    } else if (job.type === 'level' && r.lvl >= 3) {
      sim.chronicle(owner ? 'chronicle.building_improved' : 'chronicle.village_improved', { building: id, npc: owner?.id, gender: owner?.gender, slevel: `${r.fam}.${r.lvl}` });
    }
    if (owner) sim.memory?.remember(owner, 'improved_building', { params: { building: id } });
  }

  /** The work was given up or cancelled. */
  ended(c) {
    const r = this.rec(c.target);
    if (r && r.work === c.id) r.work = null;
    const o = c.job?.with && this.rec(c.job.with);
    if (o && o.work === c.id) o.work = null;
    this.sim.bus.emit('building:changed', c.target);
  }

  setFootprint(id, fp) {
    const r = this.rec(id);
    const b = this.world.buildings[id];
    if (!r || !b) return;
    r.fp = { tx: fp.tx, ty: fp.ty, w: fp.w, h: fp.h, dx: fp.dx };
    moveFootprint(this.world, b, r.fp);
    // Buildings you or villagers put up keep their construction record in step (it's what's re-added on load).
    const c = this.sim.construction.byId(id);
    if (c) Object.assign(c, { tx: fp.tx, ty: fp.ty, w: fp.w, h: fp.h });
  }

  // ------------------------------------------------------------------ changing what it is (Phase 13)

  /** What this building could be turned into (building by building — not everything into everything). */
  conversions(id) {
    const b = this.world.buildings[id];
    const r = this.rec(id);
    if (!b || !r) return [];
    const out = [...(CONVERSIONS[b.type] || [])];
    // A big house can become a block of flats (Phase 14).
    if (r.fam === 'house' && r.lvl >= 4 && BUILDING_TYPES.apartment_house) out.push('apartment_house');
    return out.filter((to) => to !== b.type && BUILDING_TYPES[to] && TYPE_FAMILY[to]);
  }

  /** Neighbouring buildings of the same owner and kind that this one could be joined with. */
  mergeable(id, by = this.owner(id)) {
    const b = this.world.buildings[id];
    const r = this.rec(id);
    if (!b || !r || !by) return [];
    const P = this.sim.property;
    const out = [];
    for (const o of this.world.buildingList) {
      if (o.id === id || Math.abs(o.tx - b.tx) + Math.abs(o.ty - b.ty) > REBUILD.merge.maxW + 2) continue;
      if (P.rec(o.id)?.owner !== by || this.rec(o.id)?.fam !== r.fam) continue;
      if (this.mergeBox(id, o.id, by)) out.push(o.id);
    }
    return out;
  }

  /**
   * The footprint two buildings joined into one would have: the box around both — close enough
   * (at most a few tiles apart), not too big, the ground between them free and theirs to build on,
   * the door where the first one's is. Null when it can't be done.
   */
  mergeBox(id, other, by = this.owner(id)) {
    const a = this.world.buildings[id];
    const b = this.world.buildings[other];
    const M = REBUILD.merge;
    if (!a || !b) return null;
    const x1 = Math.min(a.tx, b.tx);
    const y1 = Math.min(a.ty, b.ty);
    const x2 = Math.max(a.tx + a.w, b.tx + b.w) - 1;
    const y2 = Math.max(a.ty + a.h, b.ty + b.h) - 1;
    const w = x2 - x1 + 1;
    const h = y2 - y1 + 1;
    if (w > M.maxW || h > M.maxH) return null;
    const gapX = Math.max(0, Math.max(a.tx, b.tx) - Math.min(a.tx + a.w, b.tx + b.w));
    const gapY = Math.max(0, Math.max(a.ty, b.ty) - Math.min(a.ty + a.h, b.ty + b.h));
    if (gapX > M.maxGap || gapY > M.maxGap) return null;
    const inside = (o, x, y) => x >= o.tx && x < o.tx + o.w && y >= o.ty && y < o.ty + o.h;
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (inside(a, x, y) || inside(b, x, y)) continue;
        if (!this.groundOk(x, y, by) || this.rockAt(x, y)) return null;
      }
    }
    const door = { tx: a.door.tx, ty: y2 + 1 };
    if (this.world.isBlocked(door.tx, door.ty) && !(door.tx === a.door.tx && door.ty === a.door.ty)) return null;
    return { tx: x1, ty: y1, w, h, dx: a.door.tx - x1, side: null };
  }

  /** The footprint a job leaves the building with (null: it stays as it is). */
  jobFootprint(id, job, by) {
    if (job.type === 'merge') return this.mergeBox(id, job.with, by);
    const grow = this.growthOf(id, job);
    return grow ? this.newFootprint(id, grow, by) : null;
  }

  /** Money, materials and hours to convert, pull down or join (by size; a pull-down also says what it salvages). */
  rebuildCost(id, job) {
    const b = this.world.buildings[id];
    const R = REBUILD[job.type];
    if (!b || !R) return null;
    let tiles = b.w * b.h;
    if (job.type === 'merge') {
      const o = this.world.buildings[job.with];
      if (!o) return null;
      const box = this.mergeBox(id, job.with) || { w: b.w + o.w, h: Math.max(b.h, o.h) };
      tiles = box.w * box.h;
    }
    const materials = {};
    if (job.type !== 'demolish') {
      for (const [item, per] of Object.entries(R.perTile)) materials[item] = Math.ceil(tiles * per);
      for (const [item, n] of Object.entries(R.extra || {})) materials[item] = (materials[item] || 0) + n;
    }
    return { money: R.money + Math.round(tiles * R.moneyPerTile), materials, labor: Math.round(R.labor + tiles * R.laborPerTile), minSkill: R.minSkill || 0, tech: [], salvage: job.type === 'demolish' ? this.salvage(id) : undefined };
  }

  /** What pulling it down gives back: some of the timber, planks and stone that went into it. */
  salvage(id) {
    const b = this.world.buildings[id];
    const r = this.rec(id);
    if (!b) return {};
    const D = REBUILD.demolish;
    const k = D.salvage * (0.6 + 0.2 * (r?.lvl || 1)) * (this.sim.property.rec(id)?.ruined ? 0.4 : 1);
    const out = {};
    for (const [item, per] of Object.entries(D.perTile)) {
      const n = Math.floor(b.w * b.h * per * k);
      if (n > 0) out[item] = n;
    }
    return out;
  }

  /** Why a building can't be converted, joined or pulled down right now (null if it can). */
  rebuildBlock(id, job, by) {
    const sim = this.sim;
    const P = sim.property;
    const E = sim.economy;
    const pr = P.rec(id);
    const publicB = PUBLIC_BUILDINGS.includes(id) || !!sim.schools?.rec?.(id) || P.housingState(id) === 'public';
    if (publicB && !(job.type === 'demolish' && pr?.ruined)) return { ok: false, reason: 'cant_improve' };
    if (E.businessAtBuilding(id) || sim.businesses?.atBuilding(id)) return { ok: false, reason: 'premises_in_use' };
    if (job.type !== 'merge' && id === sim.state.player.homeId) return { ok: false, reason: 'your_home_first' };
    if (job.type !== 'merge' && P.occupants(id) > 0) return { ok: false, reason: P.lease(id) ? 'tenants_first' : 'people_live_here' };
    if (job.type === 'convert' && !this.conversions(id).includes(job.to)) return { ok: false, reason: 'cant_improve' };
    if (job.type === 'merge') {
      const o = job.with;
      if (!this.world.buildings[o] || P.rec(o)?.owner !== by || this.rec(o)?.fam !== this.rec(id)?.fam) return { ok: false, reason: 'cant_improve' };
      if (this.works(o)) return { ok: false, reason: 'works_underway' };
      if (P.occupants(o) > 0 || o === sim.state.player.homeId) return { ok: false, reason: 'merge_empty_first' };
      if (E.businessAtBuilding(o) || sim.businesses?.atBuilding(o) || PUBLIC_BUILDINGS.includes(o)) return { ok: false, reason: 'premises_in_use' };
      if (pr?.ruined || P.rec(o)?.ruined) return { ok: false, reason: 'restore_first' };
    }
    return null;
  }

  /** Turn the building into something else: same walls and ground, a new use (and a new look). */
  convert(id, to) {
    const sim = this.sim;
    const b = this.world.buildings[id];
    const r = this.rec(id);
    const [fam, base] = TYPE_FAMILY[to];
    const above = Math.max(0, r.lvl - r.base);
    r.was = [...(r.was || []), b.type].slice(-6);
    r.fam = fam;
    r.base = base;
    r.lvl = Math.max(1, Math.min(maxLevel(fam), base + above));
    for (const m of Object.keys(r.mods)) if (!MODULES[m]?.fams.includes(fam)) delete r.mods[m];
    r.annex = r.annex.filter((a) => r.mods[a.m]);
    r.spec = null;
    r.visual = to;
    r.conv = (r.conv || 0) + 1;
    b.type = to;
    const pr = sim.property.rec(id);
    if (pr) {
      pr.forRent = false;
      if (sim.property.isHome(id)) pr.formerBusiness = null;
      else if (to === 'shopfront') pr.formerBusiness ??= 'general_store';
      if (!sim.property.isHome(id)) sim.letting?.list?.(id, false);
    }
    this.fxCache.delete(id);
    sim.bus.emit('building:converted', id);
  }

  /** Pull it down: what can be saved goes to the owner, the ground is free — ready to build on again. */
  demolish(id, c) {
    const sim = this.sim;
    const by = c?.owner || this.owner(id);
    const sal = this.salvage(id);
    const b = this.world.buildings[id];
    const was = b?.type;
    let worth = 0;
    for (const [item, n] of Object.entries(sal)) worth += n * (ITEMS[item]?.basePrice || 2);
    if (by === 'player') {
      for (const [item, n] of Object.entries(sal)) {
        const got = sim.inventory.add(item, n);
        if (got < n) sim.home.store?.(item, n - got, { force: true });
      }
      sim.toast('toast.demolished', { btype: was }, 'good');
      sim.chronicle('chronicle.player_demolished', { btype: was });
    } else {
      // A villager (or the village) sells what's salvaged.
      const n = sim.npcs.byId(by);
      if (n) n.money += Math.round(worth * 0.6);
      else if (by === 'village') sim.state.village.treasury += Math.round(worth * 0.6);
      if (n) sim.chronicle('chronicle.building_demolished', { npc: n.id, gender: n.gender, btype: was });
      else sim.chronicle('chronicle.village_demolished', { btype: was });
    }
    this.pullDown(id, 'demolished');
  }

  /** Two become one: the other building is taken into this one (its rooms come with it; one level up). */
  mergeIn(id, other) {
    const r = this.rec(id);
    const o = this.rec(other);
    if (!r) return;
    if (o) {
      // The other's rooms come with it (a home: its bedrooms — the people it held can live here now).
      const capB = this.sim.property.capacity(other) || 0;
      for (const [m, n] of Object.entries(o.mods)) r.mods[m] = Math.min(MODULES[m]?.max || 1, (r.mods[m] || 0) + n);
      if (MODULES.bedroom.fams.includes(r.fam)) r.mods.bedroom = Math.min(MODULES.bedroom.max, (r.mods.bedroom || 0) + Math.ceil(capB / 2));
      const aw = this.world.buildings[id].w * this.world.buildings[id].h;
      const bw = (this.world.buildings[other]?.w || 1) * (this.world.buildings[other]?.h || 1);
      r.q = Math.round((r.q * aw + o.q * bw) / (aw + bw));
      r.hh = (r.hh || 0) + (o.hh || 0);
      r.joined = [...(r.joined || []), other];
    }
    r.lvl = Math.min(maxLevel(r.fam), Math.max(r.lvl, o?.lvl || 0) + 1);
    r.ups = (r.ups || 0) + 1;
    r.annex = [];
    this.pullDown(other, 'merged', id);
  }

  /** Take a building off the ground for good (pulled down, or joined into another). Its story is kept. */
  pullDown(id, how, into = null) {
    const sim = this.sim;
    const r = this.all[id];
    const pr = sim.property.rec(id);
    if (r) {
      r.gone = true;
      r.goneDay = sim.time.day;
      r.goneHow = how;
      r.into = into || undefined;
      r.work = null;
      r.lastOwner = pr?.owner ?? null;
      r.hist.push({ d: sim.time.day, k: how, p: into ? { building: into } : {} });
    }
    if (pr?.lease) sim.property.endLease?.(id, 'gone');
    sim.letting?.list?.(id, false);
    this.world.removeBuilding(id);
    // A building put up in play isn't put back when the game is loaded.
    const c = sim.construction.byId(id);
    if (c) sim.construction.list.splice(sim.construction.list.indexOf(c), 1);
    delete sim.property.all[id];
    sim.property.valueCache?.delete(id);
    this.fxCache.delete(id);
    sim.npcs.invalidateHouseholds?.();
    if (sim.territory) sim.territory.rev = (sim.territory.rev || 0) + 1;
    sim.bus.emit('building:removed', id);
    sim.bus.emit('building:changed', id);
  }

  // ------------------------------------------------------------------ what it looks like

  /** How to draw it now — null when it's still as it was designed. */
  look(id, { lvl = null, annex = null, fp = null, mods = null } = {}) {
    const r = this.rec(id);
    const b = this.world.buildings[id];
    if (!r || !b) return null;
    const base = BUILDING_TYPES[b.type];
    if (!base || base.decorTexture) return null;
    const level = lvl ?? r.lvl;
    const an = annex ?? r.annex;
    const md = mods ?? r.mods;
    const box = fp ?? { w: b.w, h: b.h };
    const upper = md.upper_floor ? 1 : 0;
    if (level === r.base && !an.length && !upper && box.w === BUILDING_TYPES[b.type].w && box.h === BUILDING_TYPES[b.type].h && !r.spec) return null;
    const L = levelDef(r.fam, level) || {};
    const h = hashStr(id, 3);
    const pick = (list) => (Array.isArray(list) ? list[Math.floor(h * list.length) % list.length] : list);
    const wall = base.wall === 'open' ? 'open' : L.look?.wall || base.wall;
    const roof = L.look?.roof || base.roof;
    const wallColor = wall === base.wall ? null : pick(LOOK_COLORS[wall]);
    const roofColor = roof === base.roof ? null : pick(LOOK_COLORS.roof[roof]);
    const left = an.filter((a) => a.side === 'left').map((a) => ({ m: a.m, cols: a.cols }));
    const right = an.filter((a) => a.side === 'right').map((a) => ({ m: a.m, cols: a.cols }));
    return {
      w: box.w,
      h: box.h,
      wall,
      roof,
      wallColor,
      roofColor,
      floors: (L.floors || 1) + upper,
      flag: !!L.look?.flag || undefined,
      clock: !!L.look?.clock || undefined,
      balcony: !!L.look?.balcony || r.spec === 'luxury' || undefined,
      left: left.length ? left : undefined,
      right: right.length ? right : undefined,
    };
  }

  /** What it'll look like when the current work is finished (the scaffolding shows it). */
  lookAfter(c) {
    const r = this.rec(c.target);
    if (!r) return null;
    const job = c.job;
    const mods = job.type === 'module' ? { ...r.mods, [job.m]: (r.mods[job.m] || 0) + 1 } : r.mods;
    const annex = job.type === 'module' && c.fp && MODULES[job.m]?.space ? [...r.annex, { m: job.m, side: c.fp.side, cols: MODULES[job.m].space }] : r.annex;
    return this.look(c.target, { lvl: job.type === 'level' ? job.to : r.lvl, annex, mods, fp: c.fp || null }) || { w: c.w, h: c.h };
  }

  refreshLook(id, emit = true) {
    const b = this.world.buildings[id];
    if (!b) return;
    const look = this.look(id);
    b.look = look || undefined;
    if (emit) this.sim.bus.emit('building:changed', id);
  }

  // ------------------------------------------------------------------ your home

  /** Your home's tier (interior, comfort, storage) follows its level. */
  homeTier() {
    const p = this.sim.state.player;
    const r = p.homeId && this.rec(p.homeId);
    // Only a house of your own: a room you rent is what it is.
    if (!r || r.fam !== 'house' || this.sim.property.rec(p.homeId)?.owner !== 'player') return null;
    return HOME_TIER_OF_LEVEL[r.lvl] || null;
  }

  syncHome() {
    const tier = this.homeTier();
    const p = this.sim.state.player;
    if (tier && p.homeTier !== tier) {
      p.homeTier = tier;
      this.sim.bus.emit('home:changed');
    }
  }

  // ------------------------------------------------------------------ over time

  onDay() {
    const sim = this.sim;
    if (sim.time.weekday !== 3) return;
    this.fxCache.clear();
    const P = sim.property;
    for (const [id, r] of Object.entries(this.all)) {
      if (r.gone || !this.world.buildings[id]) continue;
      // A building let run down loses more than its paint.
      const cond = P.rec(id)?.condition ?? 100;
      if (cond < QL.neglectBelow) r.q = Math.max(5, r.q - QL.neglectPerWeek);
      // What it's used for, over the years.
      const use = this.useOf(id);
      if (use && r.uses.at(-1)?.u !== use) {
        r.uses.push({ u: use, d: sim.time.day });
        if (r.uses.length > 10) r.uses.shift();
      }
    }
    this.villagersImprove();
  }

  /** Home, rented home, shop, workshop, public building, empty… */
  useOf(id) {
    const sim = this.sim;
    const P = sim.property;
    const pr = P.rec(id);
    if (!pr) return null;
    const biz = sim.economy.businessAtBuilding(id);
    if (biz) return sim.economy.def(biz)?.kind === 'shop' ? 'shop' : 'workshop';
    if (sim.businesses?.atBuilding(id)) return 'workshop';
    if (sim.schools?.rec(id)) return 'school';
    if (pr.owner === 'village' && !P.isHome(id)) return 'public';
    if (P.isHome(id)) {
      if (P.occupants(id) === 0) return 'empty';
      const people = sim.npcs.residentsOf(id);
      return people.some((n) => P.landlord(n)) ? 'rented' : 'home';
    }
    return pr.abandoned ? 'empty' : null;
  }

  /**
   * Villagers improve their homes and premises when they need to and can afford it:
   * a family grown too big for the house adds a bedroom (or builds up); a busy workshop
   * whose owner has money put by takes on a bench and a bigger yard; the well-off make
   * their homes grander; the village enlarges a crowded school. A few a week at most.
   */
  villagersImprove() {
    const sim = this.sim;
    const P = sim.property;
    const E = sim.economy;
    let started = 0;
    const max = WORKS.npcUpgradeMaxPerWeek;
    const tryJob = (id, by, jobs) => {
      for (const job of jobs) {
        if (started >= max) return true;
        if (!this.check(id, job, by).ok) continue;
        if (this.start(id, job, by).ok) {
          started++;
          return true;
        }
      }
      return false;
    };
    const ids = Object.keys(this.all).filter((id) => this.rec(id) && !this.works(id) && this.world.buildings[id]);
    for (const id of ids) {
      if (started >= max) break;
      const r = this.rec(id);
      const owner = P.rec(id)?.owner;
      if (!owner || owner === 'player') continue;
      const n = sim.npcs.byId(owner);
      // Homes: too many people for the house, or money enough to live better.
      if (r.fam === 'house' && n) {
        const people = P.occupants(id);
        const cap = P.capacity(id);
        const lives = n.homeId === id;
        if (people > cap) {
          if (tryJob(id, owner, [{ type: 'module', m: 'bedroom' }, { type: 'level', to: r.lvl + 1 }, { type: 'module', m: 'upper_floor' }])) continue;
        }
        // (In a town, or a city, people build up sooner — TownSystem.boom().)
        const boom = sim.town?.boom() ?? 1;
        if (lives && n.money > 500 * boom && (n.traits.includes('ambitious') || n.traits.includes('proud') || n.money > 900 * boom) && r.lvl < 5) {
          if (tryJob(id, owner, [{ type: 'level', to: r.lvl + 1 }, { type: 'module', m: 'kitchen' }, { type: 'module', m: 'parlour' }])) continue;
        }
        if (this.quality(id) < 35 && n.money > 250) tryJob(id, owner, [{ type: 'renovate' }]);
        continue;
      }
      // Business premises: a business doing well, short of room.
      const biz = E.businessAtBuilding(id);
      if (biz && n && E.ownerId(biz) === owner) {
        const b = E.biz(biz);
        const staff = sim.npcs.staffOf(biz).length;
        const books = sim.enterprise.books(biz, 7);
        if (books.profit > 0 && b.money > 400 && staff >= sim.npcs.maxStaff(biz)) {
          const jobs = [{ type: 'level', to: r.lvl + 1 }];
          if (['workshop', 'yard'].includes(r.fam)) jobs.push({ type: 'module', m: 'extra_bench' });
          if (r.fam === 'shop') jobs.push({ type: 'module', m: 'display' });
          tryJob(id, owner, jobs);
        }
        continue;
      }
      // The village: a crowded school gets bigger.
      if (owner === 'village' && r.fam === 'school') {
        const s = sim.schools?.rec(id);
        if (s && (s.crowdedWeeks || 0) >= 2 && sim.state.village.treasury > 400) tryJob(id, 'village', [{ type: 'module', m: 'classroom' }, { type: 'level', to: r.lvl + 1 }]);
      }
    }
    return started;
  }

  // ------------------------------------------------------------------ for the UI

  /** The universal building view: type, level, quality, condition, size, owner, occupants, value, rent… */
  /**
   * Everything about a building in one place (the building's details sheet): what it is and what
   * it's for, who owns it, level / quality / condition, whether it's being built or improved, how
   * many it holds and employs, who works there, what's kept there (goods, equipment), what it
   * makes and uses, what it costs to keep and run, where it stands (land, roads, services), where
   * people stand to use it, and what the next level takes. Read from the systems that own each
   * part — nothing is stored twice.
   */
  sheet(id) {
    const sim = this.sim;
    const v = this.view(id);
    if (!v) return null;
    const b = this.world.buildings[id];
    const r = this.rec(id);
    const E = sim.economy;
    const biz = E.businessAtBuilding(id);
    const def = biz ? E.def(biz) : null;
    const own = sim.construction.byId(id);
    const fx = own ? BUILDABLES[own.type]?.effect || {} : {};
    const L = r ? levelDef(r.fam, r.lvl) || {} : {};
    const nextL = r ? levelDef(r.fam, r.lvl + 1) : null;
    const pr = sim.property.rec(id);
    // Who works there: staff of the business, your workers sent there, your workers busy there now.
    const staff = biz ? sim.npcs.staffOf(biz).map((n) => n.id) : [];
    const yours = sim.workers.list().filter((c) => c.task?.target === id || sim.points?.atDoor(c.task?.spot?.tx, c.task?.spot?.ty) === id).map((c) => c.npcId);
    // What's kept there.
    const base = sim.workers.baseBuilding().id === id || id === sim.state.player.homeId;
    const stock = biz ? Object.fromEntries(Object.entries(E.biz(biz).stock || {}).filter(([, q]) => q >= 1).map(([k, q]) => [k, Math.floor(q)])) : base ? Object.fromEntries(sim.home.storage.reduce((m, s) => m.set(s.id, (m.get(s.id) || 0) + s.qty), new Map())) : {};
    const eq = sim.equipment ? sim.equipment.atYard(id) : { here: [], out: [] };
    // What it makes and uses.
    const makes = def?.recipes ? Object.keys(def.recipes) : def?.produces ? [].concat(def.produces) : [];
    const uses = def?.recipes ? [...new Set(Object.values(def.recipes).flatMap((x) => (x.alts || []).flatMap((a) => Object.keys(a.in || {}))))] : def?.input ? [def.input] : [];
    // Its keep: wages (a business), upkeep (a house you let), wear (condition lost a week, roughly).
    const wages = biz ? staff.reduce((s, n) => s + (sim.npcs.wageFor(biz, sim.npcs.byId(n)) || 0), 0) : 0;
    const upkeep = pr?.owner === 'player' && sim.property.isHome(id) && pr.tenant ? 1 : 0;
    const cov = sim.infra?.coverage(b.door.tx, b.door.ty) || null;
    const parcel = sim.territory?.parcelAt(b.door.tx, b.door.ty - 1) || null;
    const pts = sim.points ? sim.points.of(id).reduce((m, p) => ((m[p.role] = (m[p.role] || 0) + 1), m), {}) : {};
    const next = r && nextL ? this.cost(id, { type: 'level', to: r.lvl + 1 }) : null;
    return {
      ...v,
      category: catalogCategory(own?.type || b.type) || catalogCategory(b.type),
      constructionState: sim.construction.sites().some((s) => s.id === id) ? 'site' : 'built',
      upgradeState: v.works ? { job: v.works.job?.type || v.works.kind, siteId: v.works.id, state: sim.construction.siteState(v.works) } : null,
      conditionBand: conditionBand(v.condition, !!pr?.ruined || !!pr?.abandoned),
      staffCap: (def?.maxWorkers || 0) + (L.staff || 0),
      workers: [...new Set([...staff, ...yours])],
      storage: { cap: fx.storage ? sim.construction.storageOf(id) : null, stock },
      equipment: { here: eq.here.map((e) => e.id), out: eq.out.map((e) => e.id), parking: pts.park || 0 },
      production: makes,
      consumption: uses,
      maintenance: { band: conditionBand(v.condition), perDay: upkeep },
      operatingCost: Math.round(wages + upkeep),
      location: { tx: b.tx, ty: b.ty, w: b.w, h: b.h, door: { ...b.door } },
      land: parcel ? { id: parcel.id, owner: sim.territory.owner?.(parcel.id) ?? null } : null,
      roads: cov ? { distance: cov.road === Infinity ? null : cov.road, linked: !!cov.linked, paved: !!cov.paved } : null,
      infrastructure: cov ? { water: !!cov.water, light: !!cov.light, transport: !!cov.transport, score: Math.round((cov.score || 0) * 100) } : null,
      points: pts,
      upgrade: next ? { to: r.lvl + 1, money: next.money || 0, materials: { ...(next.materials || {}) }, labor: next.labor || 0, check: this.check(id, { type: 'level', to: r.lvl + 1 }) } : null,
      visual: { look: this.look(id), floors: v.floors, stage: sim.construction.sites().find((s) => s.target === id) ? 'works' : 'standing' },
    };
  }

  view(id) {
    const sim = this.sim;
    const b = this.world.buildings[id];
    const r = this.rec(id);
    const P = sim.property;
    const pr = P.rec(id);
    if (!b) return null;
    const biz = sim.economy.businessAtBuilding(id);
    return {
      id,
      type: b.type,
      family: r?.fam || null,
      level: r?.lvl || null,
      maxLevel: r ? maxLevel(r.fam) : null,
      quality: r ? this.quality(id) : null,
      qualityCap: r ? this.qualityCap(id) : null,
      condition: Math.round(pr?.condition ?? 100),
      size: { w: b.w, h: b.h },
      floors: this.fx(id)?.floors || 1,
      owner: pr?.owner ?? null,
      occupants: P.isHome(id) ? P.occupants(id) : 0,
      capacity: P.isHome(id) ? P.capacity(id) : 0,
      employees: biz ? sim.npcs.staffOf(biz).length : 0,
      modules: r ? { ...r.mods } : {},
      spec: r?.spec || null,
      value: P.value(id),
      rent: P.isHome(id) ? P.weeklyRent(id) : 0,
      works: this.works(id),
      history: r?.hist || [],
    };
  }
}
