/**
 * ForestrySystem — looking after the woods the village lives off.
 *
 *   Forest health  grown trees (and, a little, young ones) against the woods the valley started with:
 *                  thick · healthy · thinning · bare. The paper and the map show it.
 *   Felling limit  below the limit (the headman's forestry policy) the lumberyard fells only a few trees a
 *                  day; its woodcutters plant instead — and when there's truly nothing to fell and the yard
 *                  is nearly empty, it sends for timber from outside.
 *   Foresters      once the woods have been cut into, the lumberyard takes on a forester: they plant saplings
 *                  on stumps, cleared ground and the forest's edge, and tend young trees so they grow faster.
 *                  A tree nursery (a trade villagers open) raises saplings and sells them; its foresters plant
 *                  them out, paid by the village's planting fund (forestry policy 'high').
 *   Planting       you can plant saplings too (bought at the store or the nursery): on stumps, open forest
 *                  ground, or your own land — a woodlot of your own.
 *   Orchards       apple trees: farms plant a few each spring and autumn and pick the apples in autumn;
 *                  on your land the apples are yours to pick.
 *
 * Woodcutters and foresters walk out and plant in the world (NPCSystem 'plant' work); growth itself is
 * NatureSystem's. No dice: choices follow the day and the place (hashStr).
 *
 *   state.forestry = { felled: { bizId: { day, n } }, planted, byPlayer, fundPaid, imported, lastImportNews,
 *                      low (lowest health seen since the last news), history: [{ day, h }] }
 */
import { FOREST, SAPLINGS } from '../data/forestry.js';
import { ITEMS } from '../data/items.js';
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';
import { hashStr } from '../core/rng.js';

const key = (tx, ty) => `${tx},${ty}`;

export class ForestrySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.forestry ??= { felled: {}, planted: 0, byPlayer: 0, fundPaid: 0, imported: 0, lastImportNews: -999, low: 1, history: [] };
    this.claims = new Map(); // tile → villager planting there (runtime only: rebuilt from their tasks on loading)
    for (const n of sim.state.npcs) if (n.task?.plant) this.claims.set(key(n.task.plant.tx, n.task.plant.ty), n.id);
    this.cache = null;
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:season', (s) => this.onSeason(s));
    sim.bus.on('object:changed', () => (this.cache = null));
    sim.bus.on('object:added', () => (this.cache = null));
  }

  get S() {
    return this.sim.state.forestry;
  }

  // ------------------------------------------------------------------ health

  isForest(o) {
    return o.kind === 'tree' && o.variant !== 'apple';
  }

  /** Trees of the woods by state (apple trees are orchards, not forest). */
  counts() {
    const hour = Math.floor(this.sim.time.total / 60);
    if (this.cache?.hour === hour) return this.cache.c;
    const c = { grown: 0, young: 0, sapling: 0, stump: 0, cleared: 0, apple: 0, planted: 0 };
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind !== 'tree') continue;
      if (o.variant === 'apple') {
        if (o.state === 'grown' || o.state === 'young' || o.state === 'sapling') c.apple++;
        continue;
      }
      if (c[o.state] !== undefined) c[o.state]++;
      if (o.planted && (o.state === 'sapling' || o.state === 'young')) c.planted++;
    }
    this.cache = { hour, c };
    return c;
  }

  /** 0…1.5: the woods today against the woods the valley started with. */
  health() {
    const c = this.counts();
    const start = this.sim.state.nature?.startTrees || 1;
    return Math.min(1.5, (c.grown + (c.young + c.sapling) * FOREST.youngWeight) / start);
  }

  status(h = this.health()) {
    return FOREST.status.find(([at]) => h >= at)[1];
  }

  policy() {
    return this.sim.state.civic?.policies?.forestry || 'normal';
  }

  /** Below this health the lumberyard only fells a few trees a day. */
  limit() {
    return FOREST.protectBelow[this.policy()] ?? FOREST.protectBelow.normal;
  }

  felledToday(bizId) {
    const f = this.S.felled[bizId];
    return f && f.day === this.sim.time.day ? f.n : 0;
  }

  /** May this lumberyard's people fell another tree today? */
  mayFell(bizId) {
    if (this.health() >= this.limit()) return true;
    return this.felledToday(bizId) < FOREST.thinQuota;
  }

  /** A tree came down for this business. */
  felled(bizId) {
    const day = this.sim.time.day;
    const f = this.S.felled[bizId];
    this.S.felled[bizId] = f && f.day === day ? { day, n: f.n + 1 } : { day, n: 1 };
  }

  // ------------------------------------------------------------------ where to plant

  /** Every object by its tile (built once per search). */
  byTile() {
    const m = new Map();
    for (const o of Object.values(this.sim.state.objects)) m.set(key(o.tx, o.ty), o);
    return m;
  }

  treeAt(tx, ty, tiles = null) {
    if (tiles) return tiles.get(key(tx, ty)) || null;
    for (const o of Object.values(this.sim.state.objects)) if (o.tx === tx && o.ty === ty) return o;
    return null;
  }

  /** Common ground for the woods: not a plot, not someone's land, not the village square. */
  commonGround(tx, ty) {
    const sim = this.sim;
    if (sim.land.plotAt(tx, ty) || sim.land.ownsTile(tx, ty)) return false;
    const owner = sim.territory?.ownerAt?.(tx, ty);
    if (owner && owner !== 'village') return false;
    const P = AREAS.plaza;
    if (P && Math.abs(tx - (P.x1 + P.x2) / 2) + Math.abs(ty - (P.y1 + P.y2) / 2) < 16) return false;
    return true;
  }

  /** Can a sapling go in here? (stump, cleared ground, or free ground at the forest's edge.) */
  canPlantAt(tx, ty, { player = false, apple = false } = {}, tiles = null) {
    const sim = this.sim;
    const w = sim.world;
    if (!w.inBounds(tx, ty)) return false;
    const o = this.treeAt(tx, ty, tiles);
    const own = player && sim.land.ownsTile(tx, ty);
    if (o) {
      if (o.kind !== 'tree' || !['stump', 'cleared'].includes(o.state)) return false;
      return own || this.commonGround(tx, ty);
    }
    if (w.staticBlocked[w.idx(tx, ty)] || w.isBlocked(tx, ty) || w.isWater(tx, ty) || w.isRoad(tx, ty)) return false;
    const tile = w.tileAt(tx, ty);
    if (![T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST].includes(tile)) return false;
    if (sim.farming?.field?.(tx, ty)) return false;
    // Your own land: a woodlot or an orchard wherever you like (not on a field or in a building).
    if (own) return true;
    if (!sim.nature.canGrowAt(tx, ty) || !this.commonGround(tx, ty)) return false;
    // Out in the valley: apple trees anywhere open, forest trees where a forest is (or was).
    return apple || tile === T.FOREST || (tiles ? this.grownNear(tx, ty, 2, tiles) : sim.nature.forestAround(tx, ty, 2)) >= 2;
  }

  grownNear(tx, ty, r, tiles) {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const o = tiles.get(key(tx + dx, ty + dy));
        if (o && this.isForest(o) && o.state === 'grown') n++;
      }
    }
    return n;
  }

  /** Places to plant near here, nearest first: stumps and cleared ground, then the forest's edge. */
  spotsNear(tx, ty, radius = FOREST.plantRadius, limit = 10, skip = null) {
    const sim = this.sim;
    const out = [];
    const d = (o) => Math.abs(o.tx - tx) + Math.abs(o.ty - ty);
    const free = [];
    for (const o of Object.values(sim.state.objects)) {
      if (!this.isForest(o) || (o.state !== 'stump' && o.state !== 'cleared')) continue;
      if (d(o) > radius || (skip && skip(o.tx, o.ty)) || !this.commonGround(o.tx, o.ty)) continue;
      free.push({ tx: o.tx, ty: o.ty, d: d(o), obj: o.id });
    }
    free.sort((a, b) => a.d - b.d || a.tx - b.tx || a.ty - b.ty);
    out.push(...free.slice(0, limit));
    if (out.length >= limit) return out;
    // The forest's edge: open ground two steps from a grown tree.
    const tiles = this.byTile();
    const seen = new Set();
    const edge = [];
    for (const o of Object.values(sim.state.objects)) {
      if (!this.isForest(o) || o.state !== 'grown' || d(o) > radius) continue;
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2]]) {
        const x = o.tx + dx;
        const y = o.ty + dy;
        const k = key(x, y);
        if (seen.has(k) || tiles.has(k)) continue;
        seen.add(k);
        if (skip && skip(x, y)) continue;
        if (!this.canPlantAt(x, y, {}, tiles)) continue;
        edge.push({ tx: x, ty: y, d: Math.abs(x - tx) + Math.abs(y - ty) });
      }
    }
    edge.sort((a, b) => a.d - b.d || a.tx - b.tx || a.ty - b.ty);
    out.push(...edge.slice(0, limit - out.length));
    return out;
  }

  /** Young trees near here that would do with tending. */
  toTend(tx, ty, radius = FOREST.plantRadius) {
    const day = this.sim.time.day;
    let best = null;
    let bestD = Infinity;
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind !== 'tree' || (o.state !== 'sapling' && o.state !== 'young')) continue;
      if (day - (o.tendedDay ?? -99) < FOREST.tendEvery || this.claims.has(key(o.tx, o.ty))) continue;
      const dd = Math.abs(o.tx - tx) + Math.abs(o.ty - ty);
      if (dd <= radius && dd < bestD) (bestD = dd), (best = o);
    }
    return best;
  }

  // ------------------------------------------------------------------ planting

  /** The kind of tree the woods here are made of. */
  variantAt(tx, ty) {
    let oak = 0;
    let pine = 0;
    for (const o of Object.values(this.sim.state.objects)) {
      if (!this.isForest(o) || Math.abs(o.tx - tx) > 4 || Math.abs(o.ty - ty) > 4) continue;
      if (o.variant === 'pine') pine++;
      else oak++;
    }
    if (oak === pine) return hashStr(`tree:${tx},${ty}`, this.sim.state.seed) < 0.5 ? 'oak' : 'pine';
    return pine > oak ? 'pine' : 'oak';
  }

  /** A sapling goes in. Returns the tree. */
  plant(tx, ty, { variant = null, by = 'village', owner = null } = {}) {
    const sim = this.sim;
    const day = sim.time.day;
    const v = variant || this.variantAt(tx, ty);
    let o = this.treeAt(tx, ty);
    if (o && o.kind === 'tree' && ['stump', 'cleared'].includes(o.state)) {
      o.state = 'sapling';
      o.variant = v;
      o.stageDay = day;
      o.planted = true;
      delete o.felledDay;
      delete o.sproutDay;
      delete o.triedSprout;
      delete o.fruit;
      if (owner) o.owner = owner;
      sim.resources.changed(o);
    } else {
      o = sim.nature.addObject({ kind: 'tree', variant: v, tx, ty, state: 'sapling', stageDay: day, planted: true, ...(owner ? { owner } : {}) });
    }
    this.S.planted++;
    if (by === 'player') this.S.byPlayer++;
    this.cache = null;
    sim.bus.emit('forest:planted', { tx, ty, by, variant: v });
    return o;
  }

  /** Tending: weeding, staking, watering — the tree comes on a few days sooner. */
  tend(o) {
    if (!o || o.kind !== 'tree' || (o.state !== 'sapling' && o.state !== 'young')) return false;
    const day = this.sim.time.day;
    if (day - (o.tendedDay ?? -99) < FOREST.tendEvery) return false;
    o.tendedDay = day;
    o.stageDay = (o.stageDay ?? day) - FOREST.tendDays;
    return true;
  }

  /**
   * A forester or woodcutter wants something to do: the nearest free place to plant, else a young tree to
   * tend. Returns { kind: 'plant'|'tend', tx, ty, obj? } (claimed for them) or null.
   */
  nextTask(npc, base) {
    const claimedByOther = (tx, ty) => {
      const c = this.claims.get(key(tx, ty));
      return !!c && c !== npc.id;
    };
    const nursery = this.nurseryOf(npc);
    const spot = !nursery || (this.sim.economy.biz(nursery)?.stock.sapling || 0) >= 1 ? this.spotsNear(base.tx, base.ty, FOREST.plantRadius, 1, claimedByOther)[0] : null;
    if (spot) {
      this.claims.set(key(spot.tx, spot.ty), npc.id);
      return { kind: 'plant', tx: spot.tx, ty: spot.ty };
    }
    const young = this.toTend(base.tx, base.ty);
    if (young) {
      this.claims.set(key(young.tx, young.ty), npc.id);
      return { kind: 'tend', tx: young.tx, ty: young.ty, obj: young.id };
    }
    return null;
  }

  release(job) {
    if (job) this.claims.delete(key(job.tx, job.ty));
  }

  /** The villager has done it (NPCSystem). Returns true if it happened. */
  doTask(npc, job) {
    if (!job) return false;
    this.release(job);
    if (job.kind === 'tend') return this.tend(this.sim.state.objects[job.obj]);
    if (!this.canPlantAt(job.tx, job.ty)) return false;
    // A nursery's forester plants the nursery's own saplings (the planting fund pays for them).
    const nursery = this.nurseryOf(npc);
    if (nursery) {
      const b = this.sim.economy.biz(nursery);
      if ((b.stock.sapling || 0) < 1) return false;
      b.stock.sapling -= 1;
      this.payFund(nursery);
    }
    this.plant(job.tx, job.ty, { by: npc.id });
    if (!this.S.firstForester && npc.occupation === 'forester') {
      this.S.firstForester = true;
      this.sim.chronicle('chronicle.forester_planting', { npc: npc.id, gender: npc.gender });
    }
    return true;
  }

  /** The tree nursery this villager works at, if they're a nursery's forester. */
  nurseryOf(npc) {
    const id = npc.owns || npc.employer;
    return id && this.sim.economy.def(id)?.type === 'tree_nursery' ? id : null;
  }

  /** The planting fund (forestry policy 'high') pays the nursery for a tree planted in the common woods. */
  payFund(bizId) {
    if (this.policy() !== 'high') return 0;
    const V = this.sim.state.village;
    const pay = Math.min(FOREST.fundPerTree, Math.max(0, V.treasury - FOREST.fundReserve));
    if (pay <= 0) return 0;
    V.treasury -= pay;
    const b = this.sim.economy.biz(bizId);
    b.money += pay;
    this.sim.economy.ledger(bizId, 'rev', pay);
    this.S.fundPaid += pay;
    return pay;
  }

  // ------------------------------------------------------------------ you plant

  saplingsCarried() {
    return Object.keys(SAPLINGS).filter((id) => this.sim.inventory.count(id) > 0);
  }

  canPlayerPlant(tx, ty, item) {
    const sim = this.sim;
    if (!(item in SAPLINGS)) return { ok: false, reason: 'nothing_here' };
    if (sim.inventory.count(item) < 1) return { ok: false, reason: 'need_item', params: { item, qty: 1 } };
    if (sim.state.player.energy < FOREST.plantEnergy) return { ok: false, reason: 'too_tired' };
    if (!this.canPlantAt(tx, ty, { player: true, apple: item === 'apple_sapling' })) return { ok: false, reason: 'cant_plant_here' };
    return { ok: true };
  }

  playerPlant(tx, ty, item) {
    const chk = this.canPlayerPlant(tx, ty, item);
    if (!chk.ok) {
      this.sim.toast(`reason.${chk.reason}`, chk.params || {}, 'warn');
      return chk;
    }
    const sim = this.sim;
    sim.inventory.remove(item, 1);
    sim.needs.spendEnergy(FOREST.plantEnergy);
    const own = sim.land.ownsTile(tx, ty);
    const o = this.plant(tx, ty, { variant: SAPLINGS[item], by: 'player', owner: own || item === 'apple_sapling' ? 'player' : null });
    sim.progression.addXp(FOREST.plantXp);
    sim.progression.addSkillXp('foraging', 4);
    // Planting the common woods: people notice.
    if (!own && item === 'sapling') sim.progression.addReputation(this.S.byPlayer % 5 === 0 ? 1 : 0);
    if (this.S.byPlayer === 1) sim.chronicle('chronicle.player_planted', {});
    sim.bus.emit('player:action', { kind: 'plant_tree', qty: 1, item, own });
    sim.toast(item === 'apple_sapling' ? 'toast.planted_apple' : 'toast.planted_tree', {}, 'good');
    return { ok: true, obj: o };
  }

  // ------------------------------------------------------------------ orchards

  isApple(o) {
    return o?.kind === 'tree' && o.variant === 'apple';
  }

  /** Can you pick this tree's apples? (Yours, or a wild one nobody tends — not a farm's.) */
  canPick(o) {
    if (!this.isApple(o) || o.state !== 'grown' || !(o.fruit > 0)) return { ok: false, reason: 'no_apples' };
    if (o.owner && o.owner !== 'player') return { ok: false, reason: 'orchard_not_yours' };
    if (this.sim.state.player.energy < 3) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  pick(o) {
    const chk = this.canPick(o);
    if (!chk.ok) {
      this.sim.toast(`reason.${chk.reason}`, chk.params || {}, 'warn');
      return chk;
    }
    const sim = this.sim;
    const got = sim.inventory.add('apple', o.fruit);
    if (got <= 0) {
      sim.toast('reason.too_heavy', {}, 'warn');
      return { ok: false, reason: 'too_heavy' };
    }
    o.fruit -= got;
    sim.needs.spendEnergy(3);
    sim.progression.addSkillXp('foraging', 3);
    sim.resources.changed(o);
    sim.toast('toast.picked_apples', { qty: got }, 'good');
    return { ok: true, qty: got };
  }

  /** A farm's apple trees. */
  orchardOf(bizId) {
    return Object.values(this.sim.state.objects).filter((o) => this.isApple(o) && o.owner === bizId);
  }

  /** Spring and autumn: farms with money to spare plant a couple more apple trees near the farmhouse. */
  plantOrchards() {
    const sim = this.sim;
    const E = sim.economy;
    for (const id of E.ofType('farm')) {
      const b = E.biz(id);
      if (!b || b.closed || b.owner === 'player' || b.money < 60) continue;
      const have = this.orchardOf(id).length;
      if (have >= FOREST.orchardMax) continue;
      const bld = sim.world.buildings[b.building];
      if (!bld) continue;
      let n = Math.min(FOREST.orchardPerSeason, FOREST.orchardMax - have);
      const spots = [];
      const cx = bld.door.tx;
      const cy = bld.door.ty;
      for (let r = 3; r <= FOREST.orchardRadius && spots.length < n; r++) {
        for (let dx = -r; dx <= r && spots.length < n; dx += 2) {
          for (const dy of [-r, r]) {
            const x = cx + dx;
            const y = cy + dy;
            if (spots.length < n && !this.treeAt(x, y) && this.canPlantAt(x, y, { apple: true }) && !this.nearBuilding(x, y)) spots.push([x, y]);
          }
        }
      }
      for (const [x, y] of spots) {
        this.plant(x, y, { variant: 'apple', by: id, owner: id });
        b.money -= ITEMS.apple_sapling?.basePrice || 8;
        E.ledger(id, 'exp', ITEMS.apple_sapling?.basePrice || 8);
        n--;
      }
      if (spots.length && !have) sim.chronicle('chronicle.orchard_planted', { building: b.building, npc: E.ownerId?.(id) || undefined });
    }
  }

  nearBuilding(tx, ty) {
    for (const b of this.sim.world.buildingList) if (tx >= b.tx - 1 && tx <= b.tx + b.w && ty >= b.ty - 1 && ty <= b.ty + b.h + 1) return true;
    return false;
  }

  /** Autumn: apples on every grown apple tree (once a year). Winter: what's left falls. */
  ripen() {
    const sim = this.sim;
    const year = sim.time.year;
    for (const o of Object.values(sim.state.objects)) {
      if (!this.isApple(o) || o.state !== 'grown' || o.fruitYear === year) continue;
      const [a, b] = FOREST.applesPerTree;
      o.fruit = a + Math.floor(hashStr(`apples:${o.id}:${year}`, sim.state.seed) * (b - a + 1));
      o.fruitYear = year;
      sim.resources.changed(o);
    }
  }

  /** Farms pick their orchards through the autumn; the apples go into their stock (and on to the store). */
  farmPick() {
    const sim = this.sim;
    const E = sim.economy;
    for (const id of E.ofType('farm')) {
      const b = E.biz(id);
      if (!b || b.closed) continue;
      let left = FOREST.farmPicksPerDay;
      for (const o of this.orchardOf(id)) {
        if (left <= 0) break;
        if (!(o.fruit > 0)) continue;
        b.stock.apple = (b.stock.apple || 0) + o.fruit;
        o.fruit = 0;
        left--;
        sim.resources.changed(o);
      }
    }
  }

  // ------------------------------------------------------------------ the lumberyard's people

  /** Weekly: a lumberyard whose woods have been cut into takes on a forester. */
  appointForesters() {
    const sim = this.sim;
    const E = sim.economy;
    if (this.health() >= FOREST.foresterBelow) return;
    for (const id of E.ofType('lumberyard')) {
      const b = E.biz(id);
      if (!b || b.closed || b.owner === 'player') continue;
      const staff = sim.npcs.staffOf(id);
      if (staff.some((n) => n.occupation === 'forester')) continue;
      let who = null;
      if (staff.length >= 2) {
        // The one who has planted most already (or the youngest hand) takes it on.
        who = staff.slice().sort((a, c) => (a.level || 1) - (c.level || 1) || (a.id < c.id ? -1 : 1))[0];
      } else if (b.money >= FOREST.foresterWage * 6) {
        who = sim.state.npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 18 && n.age < 60 && !n.leaving && !n.away).sort((a, c) => (a.id < c.id ? -1 : 1))[0] || null;
        if (who) {
          b.maxWorkers = Math.max(b.maxWorkers ?? 0, staff.length + 1);
          who.employer = id;
          who.hiredDay = sim.time.day;
          who.unpaidDays = 0;
        }
      }
      if (!who) continue;
      if (who.occupation !== 'unemployed') who.prevOccupation = who.occupation;
      who.occupation = 'forester';
      who.task = null;
      who.nextThink = sim.time.total;
      sim.habits?.derive(who);
      // (News the first time — and again only after a good while: a forester leaving and another starting isn't.)
      this.S.foresterNews ??= {};
      if (sim.time.day - (this.S.foresterNews[id] ?? -999) >= 56) sim.chronicle('chronicle.forester_taken_on', { npc: who.id, gender: who.gender, building: b.building });
      this.S.foresterNews[id] = sim.time.day;
      sim.bus.emit('npc:job_changed', who.id);
    }
  }

  /** A lumberyard with nothing it may fell and an empty yard sends for timber from outside. */
  importTimber() {
    const sim = this.sim;
    const E = sim.economy;
    const day = sim.time.day;
    for (const id of E.ofType('lumberyard')) {
      const b = E.biz(id);
      if (!b || b.closed || b.owner === 'player') continue;
      if ((b.noTreesDay ?? -99) < day - 1) continue;
      const target = E.target(id, 'wood');
      const have = b.stock.wood || 0;
      if (have >= target * FOREST.importBelow) continue;
      const price = Math.round((ITEMS.wood.basePrice || 3) * FOREST.importMarkup);
      const qty = Math.min(FOREST.importQty, Math.floor(b.money / price));
      if (qty <= 0) continue;
      b.money -= qty * price;
      E.ledger(id, 'exp', qty * price);
      b.stock.wood = have + qty;
      this.S.imported += qty;
      if (day - this.S.lastImportNews >= FOREST.importNewsDays) {
        this.S.lastImportNews = day;
        sim.chronicle('chronicle.timber_imported', { building: b.building, n: qty });
      }
    }
  }

  // ------------------------------------------------------------------ daily

  onDay() {
    const sim = this.sim;
    const s = sim.time.season;
    this.cache = null;
    this.importTimber();
    if (s === 'autumn' && sim.time.dayOfSeason >= FOREST.fruitFromDay) {
      this.ripen();
      this.farmPick();
    }
    if (sim.time.weekday === 1) this.weekly();
  }

  onSeason(s) {
    if (s === 'spring' || s === 'autumn') this.plantOrchards();
    if (s === 'winter') {
      // What nobody picked falls.
      for (const o of Object.values(this.sim.state.objects)) {
        if (this.isApple(o) && o.fruit > 0) {
          o.fruit = 0;
          this.sim.resources.changed(o);
        }
      }
    }
  }

  weekly() {
    const sim = this.sim;
    const h = this.health();
    const S = this.S;
    S.history.push({ day: sim.time.day, h: Math.round(h * 100) / 100 });
    if (S.history.length > 60) S.history.shift();
    this.appointForesters();
    // The woods grew back: news.
    S.low = Math.min(S.low ?? 1, h);
    if (h >= FOREST.regrownAt && S.low < FOREST.regrownFrom) {
      S.low = h;
      sim.chronicle('chronicle.forest_regrown', { n: Math.round(h * 100) });
    }
  }

  /** For the forest screen: everything in one go. */
  summary() {
    const c = this.counts();
    const h = this.health();
    return { ...c, health: h, status: this.status(h), limit: this.limit(), policy: this.policy(), planted: this.S.planted, byPlayer: this.S.byPlayer, imported: this.S.imported, fundPaid: this.S.fundPaid, foresters: this.sim.state.npcs.filter((n) => n.occupation === 'forester').length, history: this.S.history };
  }
}
