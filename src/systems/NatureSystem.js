/**
 * NatureSystem — the land responds to how people use it.
 *
 *   Forest   felled trees leave stumps; a stump may sprout a sapling (more likely
 *            inside a healthy forest), saplings grow into young trees and then
 *            full trees over about a year. Grown trees slowly seed the ground
 *            around them. Cut faster than it grows and the forest visibly thins —
 *            woodcutters walk further, timber gets dearer.
 *   Mining   every outcrop holds a finite amount. Dig it out and it's gone;
 *            miners sometimes strike a new seam in the mountains.
 *   Fish     the river and the lake each hold a population that breeds back
 *            towards what the water can support. Overfish and catches fall.
 *   Wildlife deer and rabbits live off the forest and meadows; their numbers
 *            follow the forest, and hunting thins them.
 *
 *   state.nature = { fish: { river, lake }, wildlife: { deer, rabbit }, snapshots, … }
 *   each population: { pop, cap }
 */
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';
import { hashStr, rand } from '../core/rng.js';

export const NATURE = {
  sproutDays: [8, 18], // a stump may sprout this many days after felling…
  sproutBase: 0.3, // …with this chance, +0.12 per healthy tree nearby
  rotDays: 45, // stumps that never sprout rot away into grass
  saplingDays: 16, // sapling → young (growing season only)
  youngDays: 26, // young → grown
  seedChance: 0.0012, // chance per grown tree per day to seed a free tile next to it
  maxTreesFactor: 1.05, // forests spread back to about their natural size, not beyond
  fishGrowth: 0.07,
  fishCap: { river: 380, lake: 300 },
  wildGrowth: { deer: 0.05, rabbit: 0.12 },
  wildPerTree: { deer: 0.12, rabbit: 0.25 }, // carrying capacity per grown tree
  rabbitMeadow: 40, // rabbits also live on open meadows
  reserve: { stone: [28, 55], coal: [16, 34], iron: [14, 30] },
  discoveryChance: 0.012, // per rock mined out in the mountains
};

export class NatureSystem {
  constructor(sim) {
    this.sim = sim;
    const s = sim.state;
    const trees = this.treeCount();
    s.nature ??= {
      fish: { river: { pop: NATURE.fishCap.river * 0.9, cap: NATURE.fishCap.river }, lake: { pop: NATURE.fishCap.lake * 0.9, cap: NATURE.fishCap.lake } },
      wildlife: { deer: { pop: trees * NATURE.wildPerTree.deer * 0.8, cap: 0 }, rabbit: { pop: (trees * NATURE.wildPerTree.rabbit + NATURE.rabbitMeadow) * 0.8, cap: 0 } },
      snapshots: [],
      startTrees: trees,
      nextObjId: 1,
      lastNews: {},
    };
    // Older saves: give every outcrop a finite reserve and every tree a growth state.
    for (const o of Object.values(s.objects)) this.normalize(o);
    this.updateCaps();
    sim.bus.on('time:day', () => this.onDay());
  }

  get n() {
    return this.sim.state.nature;
  }

  normalize(o) {
    if (o.kind === 'rock' && o.reserve === undefined) {
      const [a, b] = NATURE.reserve[o.variant] || NATURE.reserve.stone;
      o.reserve = a + Math.floor(hashStr(o.id, this.sim.state.seed) * (b - a + 1));
    }
  }

  treeCount(stateFilter = (s) => s === 'grown') {
    let n = 0;
    for (const o of Object.values(this.sim.state.objects)) if (o.kind === 'tree' && stateFilter(o.state)) n++;
    return n;
  }

  /** Grown trees within r tiles (how healthy the forest is here). */
  forestAround(tx, ty, r = 3) {
    let n = 0;
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind === 'tree' && o.state === 'grown' && Math.abs(o.tx - tx) <= r && Math.abs(o.ty - ty) <= r) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ fish

  /** Which water: the lake, or the river? */
  waterBody(tx, ty) {
    const L = AREAS.lake;
    const dx = (tx - L.cx) / (L.rx + 4);
    const dy = (ty - L.cy) / (L.ry + 4);
    return dx * dx + dy * dy <= 1 ? 'lake' : 'river';
  }

  fishChance(body) {
    const f = this.n.fish[body];
    return 0.12 + 0.63 * Math.max(0, f.pop / f.cap);
  }

  /** Someone fishes (a villager at their spot, a fisher at work, or you). Returns fish caught (0/1). */
  catchFish(tx, ty, skillBonus = 0) {
    const body = this.waterBody(tx, ty);
    const f = this.n.fish[body];
    if (f.pop < 1 || !rand.chance(Math.min(0.95, this.fishChance(body) + skillBonus))) return 0;
    f.pop -= 1;
    return 1;
  }

  /** A villager's evening of fishing (see NPCSystem.finishLeisure). */
  fish(npc) {
    const t = this.sim.world.toTile(npc.x, npc.y);
    return this.catchFish(t.tx, t.ty) > 0;
  }

  // ------------------------------------------------------------------ wildlife

  updateCaps() {
    const trees = this.treeCount();
    const w = this.n.wildlife;
    w.deer.cap = Math.max(4, trees * NATURE.wildPerTree.deer);
    w.rabbit.cap = Math.max(8, trees * NATURE.wildPerTree.rabbit + NATURE.rabbitMeadow);
  }

  /** A hunter takes an animal. */
  hunted(kind) {
    const w = this.n.wildlife[kind];
    if (!w || w.pop < 1) return false;
    w.pop -= 1;
    return true;
  }

  // ------------------------------------------------------------------ mining

  /** An outcrop gave up some of its stone/ore. Returns true if it's now worked out. */
  extracted(obj, qty) {
    this.normalize(obj);
    obj.reserve = Math.max(0, obj.reserve - qty);
    if (obj.reserve > 0) return false;
    obj.state = 'depleted';
    // Working the mountains sometimes turns up a new seam.
    if (obj.variant !== 'stone' || rand.chance(0.5)) {
      if (rand.chance(NATURE.discoveryChance * 10)) this.discoverVein(obj.variant === 'stone' ? rand.pick(['coal', 'iron', 'stone']) : obj.variant);
    }
    return true;
  }

  /** A new outcrop appears somewhere in the mountains (a discovery). */
  discoverVein(variant, near = null) {
    const w = this.sim.world;
    const M = AREAS.mountains;
    for (let tries = 0; tries < 200; tries++) {
      const tx = near ? near.tx + rand.int(-8, 8) : rand.int(M.xBase - 4, w.W - 3);
      const ty = near ? near.ty + rand.int(-8, 8) : rand.int(3, M.yBase + 18);
      if (!w.inBounds(tx, ty) || w.isBlocked(tx, ty) || w.isWater(tx, ty) || w.isRoad(tx, ty)) continue;
      if (this.sim.land.plotAt(tx, ty)) continue;
      if (Object.values(this.sim.state.objects).some((o) => o.tx === tx && o.ty === ty)) continue;
      const obj = this.addObject({ kind: 'rock', variant, tx, ty, state: 'full' });
      this.normalize(obj);
      obj.reserve = Math.round(obj.reserve * 1.6); // a fresh, rich seam
      const region = tx > 90 ? 'east_mountains' : ty < 30 ? 'north_mountains' : 'mountains';
      this.sim.chronicle('chronicle.deposit_found', { item: variant === 'iron' ? 'iron_ore' : variant === 'coal' ? 'coal' : 'stone', region });
      this.sim.rumors?.seed('deposit', { item: variant === 'iron' ? 'iron_ore' : variant, region, obj: obj.id });
      this.sim.bus.emit('nature:discovery', obj);
      return obj;
    }
    return null;
  }

  // ------------------------------------------------------------------ objects

  addObject(o) {
    const id = `nat_${this.n.nextObjId++}`;
    const obj = { id, ...o };
    this.sim.state.objects[id] = obj;
    this.sim.world.updateObjectBlocking(obj);
    this.sim.bus.emit('object:added', obj);
    return obj;
  }

  canGrowAt(tx, ty) {
    const w = this.sim.world;
    if (!w.inBounds(tx, ty) || w.staticBlocked[w.idx(tx, ty)] || w.isWater(tx, ty) || w.isRoad(tx, ty)) return false;
    const tile = w.tileAt(tx, ty);
    if (![T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST].includes(tile)) return false; // trees grow on grass and forest floor
    for (const r of AREAS.clearings) if (tx >= r.x1 && tx <= r.x2 && ty >= r.y1 && ty <= r.y2) return false;
    if (this.sim.land.plotAt(tx, ty)) return false;
    return true;
  }

  // ------------------------------------------------------------------ daily

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    const growing = sim.time.season !== 'winter';
    const objs = sim.state.objects;
    const occupied = new Set();
    for (const o of Object.values(objs)) occupied.add(`${o.tx},${o.ty}`);
    let grown = 0;
    for (const o of Object.values(objs)) {
      if (o.kind !== 'tree') continue;
      let changed = false;
      if (o.state === 'stump') {
        o.felledDay ??= day;
        if (o.sproutDay === undefined) o.sproutDay = o.felledDay + rand.int(NATURE.sproutDays[0], NATURE.sproutDays[1]);
        if (growing && day >= o.sproutDay && !o.triedSprout) {
          o.triedSprout = true;
          const chance = Math.min(0.9, NATURE.sproutBase + this.forestAround(o.tx, o.ty) * 0.12);
          if (rand.chance(chance)) {
            o.state = 'sapling';
            o.stageDay = day;
            changed = true;
          }
        }
        if (o.state === 'stump' && day - o.felledDay >= NATURE.rotDays) {
          o.state = 'cleared';
          changed = true;
        }
      } else if (o.state === 'sapling' && growing && day - (o.stageDay ?? day) >= NATURE.saplingDays) {
        o.state = 'young';
        o.stageDay = day;
        changed = true;
      } else if (o.state === 'young' && growing && day - (o.stageDay ?? day) >= NATURE.youngDays) {
        o.state = 'grown';
        delete o.felledDay;
        delete o.sproutDay;
        delete o.triedSprout;
        changed = true;
      } else if (o.state === 'cleared' && !this.sim.land.ownsTile(o.tx, o.ty) && growing && rand.chance(0.004 * (1 + this.forestAround(o.tx, o.ty, 2)))) {
        // Open ground inside a forest fills in again.
        o.state = 'sapling';
        o.stageDay = day;
        changed = true;
      }
      if (o.state === 'grown') grown++;
      if (changed) sim.resources.changed(o);
    }
    // Healthy forests spread (a little).
    if (growing && grown < this.n.startTrees * NATURE.maxTreesFactor) {
      const seeders = Object.values(objs).filter((o) => o.kind === 'tree' && o.state === 'grown');
      for (const t of seeders) {
        if (!rand.chance(NATURE.seedChance)) continue;
        const tx = t.tx + rand.int(-2, 2);
        const ty = t.ty + rand.int(-2, 2);
        if (occupied.has(`${tx},${ty}`) || !this.canGrowAt(tx, ty)) continue;
        occupied.add(`${tx},${ty}`);
        this.addObject({ kind: 'tree', variant: t.variant, tx, ty, state: 'sapling', stageDay: day });
      }
    }
    this.updateCaps();
    // Populations breed back towards what the land and water can support.
    for (const [body, f] of Object.entries(this.n.fish)) {
      f.cap = NATURE.fishCap[body];
      f.pop = Math.min(f.cap, f.pop + NATURE.fishGrowth * sim.events.modifier('fish_growth') * f.pop * (1 - f.pop / f.cap) + 0.5);
    }
    for (const [kind, w] of Object.entries(this.n.wildlife)) {
      // Too many animals for the forest: they starve or move away.
      if (w.pop > w.cap) w.pop = Math.max(w.cap, w.pop - (w.pop - w.cap) * 0.15);
      else w.pop = Math.min(w.cap, w.pop + NATURE.wildGrowth[kind] * w.pop * (1 - w.pop / w.cap) + 0.1);
    }
    if (sim.time.weekday === 0) this.weekly();
  }

  /** Weekly: record how nature is doing, and let the village notice big changes. */
  weekly() {
    const n = this.n;
    const trees = this.treeCount();
    const snap = {
      day: this.sim.time.day,
      trees,
      young: this.treeCount((s) => s === 'sapling' || s === 'young'),
      fish: Math.round(n.fish.river.pop + n.fish.lake.pop),
      deer: Math.round(n.wildlife.deer.pop),
      rabbit: Math.round(n.wildlife.rabbit.pop),
      ore: this.reserveLeft(),
    };
    n.snapshots.push(snap);
    if (n.snapshots.length > 120) n.snapshots.shift();
    const day = this.sim.time.day;
    const news = (key, params = {}) => {
      if (day - (n.lastNews[key] || -999) < 56) return;
      n.lastNews[key] = day;
      this.sim.chronicle(`chronicle.${key}`, params);
    };
    if (trees < n.startTrees * 0.7) news('forest_thinning', { n: Math.round((1 - trees / n.startTrees) * 100) });
    if (trees > n.startTrees * 1.1) news('forest_growing');
    const fishShare = (n.fish.river.pop + n.fish.lake.pop) / (n.fish.river.cap + n.fish.lake.cap);
    if (fishShare < 0.35) news('fish_scarce');
    if (n.wildlife.deer.pop < n.wildlife.deer.cap * 0.3 || n.wildlife.deer.pop < 5) news('deer_scarce');
    const ore = this.reserveLeft();
    if (ore.iron < 20) news('iron_running_out');
  }

  /** What's left underground. */
  reserveLeft() {
    const out = { stone: 0, coal: 0, iron: 0 };
    for (const o of Object.values(this.sim.state.objects)) if (o.kind === 'rock' && o.state !== 'depleted') out[o.variant] = (out[o.variant] || 0) + (o.reserve ?? 0);
    return out;
  }

  /** For dialogue: how's the forest near this place? 'thick' | 'thin' | 'bare'. */
  forestState(tx, ty) {
    const n = this.forestAround(tx, ty, 14);
    return n >= 25 ? 'thick' : n >= 8 ? 'thin' : 'bare';
  }
}

