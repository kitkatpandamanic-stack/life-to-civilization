/**
 * WorldGenerator — builds the terrain, places buildings, roads, decorations
 * and the initial resource objects (trees, rocks, bushes, crops).
 *
 * The result has two parts:
 *   • static data (tiles, buildings, decor) — regenerated from the seed on load
 *   • initialObjects — the starting state of resource objects; these change
 *     during play, so they are stored in the save file (state.objects)
 */
import { BALANCE } from '../config/balance.js';
import { Rng, fbm, hash2 } from '../core/rng.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { VILLAGE_BUILDINGS, AREAS, ROADS, DECOR } from '../data/villageLayout.js';

/** Tile ids — the index into the generated tileset texture. */
export const T = {
  GRASS: 0,
  GRASS2: 1,
  GRASS3: 2,
  FLOWERS: 3,
  FOREST: 4,
  DIRT: 5,
  ROAD: 6,
  SAND: 7,
  WATER: 8,
  DEEP: 9,
  MOUNTAIN: 10,
  CLIFF: 11,
  FARMLAND: 12,
  BRIDGE: 13,
  PLAZA: 14,
};
export const TILE_COUNT = 15;
export const BLOCKING_TILES = [T.WATER, T.DEEP, T.CLIFF];
const ROADLIKE = new Set([T.ROAD, T.PLAZA, T.BRIDGE]);

const inRect = (x, y, r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;

export class World {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.tiles = new Uint8Array(W * H);
    this.staticBlocked = new Uint8Array(W * H); // terrain, buildings, decor
    this.dynBlocked = new Uint8Array(W * H); // trees and rocks (change during play)
    this.buildings = {};
    this.buildingList = [];
    this.decor = [];
    this.spawn = { x: 0, y: 0 };
  }

  idx(x, y) {
    return y * this.W + x;
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }
  tileAt(x, y) {
    return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.CLIFF;
  }
  isBlocked(x, y) {
    if (!this.inBounds(x, y)) return true;
    const i = this.idx(x, y);
    return this.staticBlocked[i] === 1 || this.dynBlocked[i] === 1;
  }
  isRoad(x, y) {
    return ROADLIKE.has(this.tileAt(x, y));
  }
  /** Movement cost for pathfinding — villagers prefer roads. */
  moveCost(x, y) {
    const t = this.tileAt(x, y);
    if (ROADLIKE.has(t)) return 1;
    if (t === T.DIRT) return 1.2;
    if (t === T.FARMLAND) return 1.6;
    return 2;
  }
  tileCenter(tx, ty) {
    const s = BALANCE.tileSize;
    return { x: tx * s + s / 2, y: ty * s + s / 2 };
  }
  toTile(px, py) {
    const s = BALANCE.tileSize;
    return { tx: Math.floor(px / s), ty: Math.floor(py / s) };
  }
  /** Find a walkable tile at or near (tx, ty), searching outward. */
  nearestWalkable(tx, ty, maxR = 6) {
    if (!this.isBlocked(tx, ty)) return { tx, ty };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (!this.isBlocked(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return { tx, ty };
  }
  /** Re-mark dynamic blocking from the current resource objects. */
  rebuildDynamicBlocking(objects) {
    this.dynBlocked.fill(0);
    for (const id in objects) this.updateObjectBlocking(objects[id]);
  }
  updateObjectBlocking(obj) {
    if (obj.kind !== 'tree' && obj.kind !== 'rock') return;
    if (!this.inBounds(obj.tx, obj.ty)) return;
    const solid = obj.kind === 'tree' ? obj.state === 'grown' : obj.state === 'full';
    this.dynBlocked[this.idx(obj.tx, obj.ty)] = solid ? 1 : 0;
  }
}

export function generateWorld(seed) {
  const W = BALANCE.world.width;
  const H = BALANCE.world.height;
  const world = new World(W, H);
  const rng = new Rng(seed);
  const set = (x, y, t) => {
    if (world.inBounds(x, y)) world.tiles[world.idx(x, y)] = t;
  };
  const get = (x, y) => world.tileAt(x, y);

  // 1. Grass base with variants.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(x, y, seed);
      const patch = fbm(x, y, 8, seed + 11);
      let t = T.GRASS;
      if (n < 0.05) t = T.FLOWERS;
      else if (patch > 0.62) t = T.GRASS3;
      else if (n < 0.45) t = T.GRASS2;
      set(x, y, t);
    }
  }

  // 2. Forest floor (west and north).
  const forestMask = (x, y) => {
    const n = fbm(x, y, 14, seed + 7);
    const west = x < 20 + n * 12;
    const north = y < 9 + n * 7 && x < 80;
    return west || north;
  };
  const inClearing = (x, y) => AREAS.clearings.some((r) => inRect(x, y, r));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (forestMask(x, y) && !inClearing(x, y)) set(x, y, T.FOREST);
    }
  }

  // 3. Mountains in the north-east, surrounded by cliffs.
  const M = AREAS.mountains;
  const isMountain = (x, y) => {
    const n1 = fbm(x, y, 9, seed + 3);
    const n2 = fbm(x, y, 11, seed + 5);
    return x > M.xBase + (n1 - 0.5) * 2 * M.xNoise && y < M.yBase + (n2 - 0.5) * 2 * M.yNoise;
  };
  const mountain = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isMountain(x, y)) mountain[world.idx(x, y)] = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mountain[world.idx(x, y)]) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (world.inBounds(nx, ny) && !mountain[world.idx(nx, ny)]) edge = true;
      }
      const inner = fbm(x, y, 5, seed + 17) > 0.72;
      set(x, y, edge || inner ? T.CLIFF : T.MOUNTAIN);
    }
  }

  // 4. River from north to south.
  const riverX = (y) => Math.round(AREAS.river.baseX + 3 * Math.sin(y * 0.12) + 2 * Math.sin(y * 0.047 + 1.3));
  for (let y = 0; y < H; y++) {
    const cx = riverX(y);
    for (let dx = -2; dx <= 1; dx++) set(cx + dx, y, dx === -1 || dx === 0 ? T.DEEP : T.WATER);
    for (const sx of [cx - 3, cx + 2]) if (get(sx, y) !== T.WATER && get(sx, y) !== T.DEEP) set(sx, y, T.SAND);
  }

  // 5. Lake in the south-east.
  const L = AREAS.lake;
  for (let y = L.cy - L.ry - 3; y <= L.cy + L.ry + 3; y++) {
    for (let x = L.cx - L.rx - 3; x <= L.cx + L.rx + 3; x++) {
      if (!world.inBounds(x, y)) continue;
      const d = ((x - L.cx) / L.rx) ** 2 + ((y - L.cy) / L.ry) ** 2 + (fbm(x, y, 4, seed + 23) - 0.5) * 0.35;
      if (d < 0.5) set(x, y, T.DEEP);
      else if (d < 1) set(x, y, T.WATER);
      else if (d < 1.35 && get(x, y) !== T.WATER && get(x, y) !== T.DEEP) set(x, y, T.SAND);
    }
  }

  // 6. Roads (bridges where they cross water).
  for (const [x1, y1, x2, y2] of ROADS) {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const cur = get(x, y);
        set(x, y, cur === T.WATER || cur === T.DEEP ? T.BRIDGE : T.ROAD);
      }
    }
  }

  // 7. Plaza and farm fields.
  const P = AREAS.plaza;
  for (let y = P.y1; y <= P.y2; y++) for (let x = P.x1; x <= P.x2; x++) set(x, y, T.PLAZA);
  const F = AREAS.fields;
  for (let y = F.y1; y <= F.y2; y++) for (let x = F.x1; x <= F.x2; x++) set(x, y, T.FARMLAND);

  // Static blocking from terrain.
  for (let i = 0; i < W * H; i++) world.staticBlocked[i] = BLOCKING_TILES.includes(world.tiles[i]) ? 1 : 0;

  // 8. Buildings.
  for (const b of VILLAGE_BUILDINGS) {
    const def = BUILDING_TYPES[b.type];
    const rec = {
      id: b.id,
      type: b.type,
      variant: b.variant ?? 0,
      tx: b.tx,
      ty: b.ty,
      w: def.w,
      h: def.h,
      door: { tx: b.tx + Math.floor(def.w / 2), ty: b.ty + def.h },
      workSpots: (b.workSpots || []).map(([dx, dy]) => ({ tx: b.tx + dx, ty: b.ty + dy })),
    };
    world.buildings[b.id] = rec;
    world.buildingList.push(rec);
    for (let y = rec.ty; y < rec.ty + rec.h; y++) {
      for (let x = rec.tx; x < rec.tx + rec.w; x++) {
        world.staticBlocked[world.idx(x, y)] = 1;
        if (get(x, y) === T.FOREST) set(x, y, T.GRASS);
      }
    }
  }

  // 9. Decorations (+ generated fences around the fields).
  const decor = DECOR.map((d) => ({ ...d, w: d.w || 1 }));
  for (let x = F.x1 - 1; x <= F.x2 + 1; x++) {
    if (x !== 38) decor.push({ type: 'fence', tx: x, ty: F.y1 - 1, block: true });
    decor.push({ type: 'fence', tx: x, ty: F.y2 + 1, block: true });
  }
  for (let y = F.y1; y <= F.y2; y++) {
    decor.push({ type: 'fence_v', tx: F.x1 - 1, ty: y, block: true });
    if (y !== 70 && y !== 71) decor.push({ type: 'fence_v', tx: F.x2 + 1, ty: y, block: true });
  }
  for (const d of decor) {
    if (!d.block) continue;
    for (let x = d.tx; x < d.tx + d.w; x++) world.staticBlocked[world.idx(x, d.ty)] = 1;
  }
  world.decor = decor;

  // 10. Carve dirt paths from each door to the nearest road.
  for (const b of world.buildingList) carvePath(world, b.door.tx, b.door.ty);

  // 11. Resource objects.
  const objects = {};
  const occupied = new Uint8Array(W * H);
  const nearBlocked = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const t = get(nx, ny);
        if (world.staticBlocked[world.idx(nx, ny)] || ROADLIKE.has(t) || t === T.DIRT) return true;
      }
    }
    return false;
  };
  const canPlaceNature = (x, y) => {
    if (!world.inBounds(x, y) || occupied[world.idx(x, y)]) return false;
    const t = get(x, y);
    if (![T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST].includes(t)) return false;
    if (inClearing(x, y)) return false;
    return !nearBlocked(x, y, 1);
  };
  const add = (obj) => {
    objects[obj.id] = obj;
    occupied[world.idx(obj.tx, obj.ty)] = 1;
  };

  // Trees: dense in forests, scattered elsewhere. Placed on a jittered grid so they don't overlap.
  for (let gy = 1; gy < H - 1; gy += 2) {
    for (let gx = 1; gx < W - 1; gx += 2) {
      const x = gx + (hash2(gx, gy, seed + 31) < 0.5 ? 0 : 1);
      const y = gy + (hash2(gx, gy, seed + 37) < 0.5 ? 0 : 1);
      if (!canPlaceNature(x, y)) continue;
      const forest = get(x, y) === T.FOREST;
      const density = fbm(x, y, 6, seed + 41);
      const p = forest ? 0.45 + density * 0.5 : 0.03;
      if (!rng.chance(p)) continue;
      const variant = y < 16 || (forest && hash2(x, y, seed + 43) < 0.3) ? 'pine' : 'oak';
      add({ id: `tree_${x}_${y}`, kind: 'tree', variant, tx: x, ty: y, state: 'grown', regrowDay: 0 });
    }
  }

  // Berry bushes near forest edges and in meadows.
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      if (!canPlaceNature(x, y)) continue;
      const forestEdge = get(x, y) !== T.FOREST && [[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dy]) => get(x + dx, y + dy) === T.FOREST);
      if (rng.chance(forestEdge ? 0.1 : 0.008)) {
        add({ id: `bush_${x}_${y}`, kind: 'bush', variant: 'berry', tx: x, ty: y, state: 'full', amount: rng.int(...BALANCE.resources.bushBerries), regrowDay: 0 });
      }
    }
  }

  // Rocks and ores in the mountains; a few loose stones elsewhere.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const t = get(x, y);
      if (occupied[world.idx(x, y)] || world.staticBlocked[world.idx(x, y)]) continue;
      if (t === T.MOUNTAIN) {
        if (Math.abs(x - 92.5) < 2 || !rng.chance(0.16)) continue;
        const iron = fbm(x, y, 6, seed + 51) > 0.6 && rng.chance(0.45);
        const coal = !iron && fbm(x, y, 6, seed + 53) > 0.58 && rng.chance(0.45);
        const variant = iron ? 'iron' : coal ? 'coal' : 'stone';
        add({ id: `rock_${x}_${y}`, kind: 'rock', variant, tx: x, ty: y, state: 'full', regrowDay: 0 });
      } else if ([T.GRASS, T.GRASS2, T.GRASS3, T.SAND].includes(t) && !inRect(x, y, AREAS.village) && !nearBlocked(x, y, 1)) {
        if (rng.chance(0.006)) add({ id: `rock_${x}_${y}`, kind: 'rock', variant: 'stone', tx: x, ty: y, state: 'full', regrowDay: 0 });
      }
    }
  }

  // Crops: every other row of the fields. Most are ripe at the start of the game.
  for (let y = F.y1; y <= F.y2; y++) {
    if ((y - F.y1) % 2 !== 0) continue;
    for (let x = F.x1; x <= F.x2; x++) {
      const stage = rng.chance(0.7) ? 3 : rng.int(1, 2);
      add({ id: `crop_${x}_${y}`, kind: 'crop', variant: 'wheat', tx: x, ty: y, stage });
    }
  }

  world.initialObjects = objects;
  world.rebuildDynamicBlocking(objects);

  // Player spawns in front of their rented shack.
  const shack = world.buildings.shack;
  world.spawn = world.tileCenter(shack.door.tx, shack.door.ty + 1);
  return world;
}

/** Breadth-first search from a door to the nearest road; paints the route as a dirt path. */
function carvePath(world, sx, sy) {
  const W = world.W;
  const prev = new Int32Array(W * world.H).fill(-1);
  const start = world.idx(sx, sy);
  prev[start] = start;
  const queue = [start];
  let found = -1;
  for (let qi = 0; qi < queue.length && qi < 3000; qi++) {
    const cur = queue[qi];
    const x = cur % W;
    const y = (cur / W) | 0;
    const t = world.tiles[cur];
    if (cur !== start && (ROADLIKE.has(t) || t === T.DIRT)) {
      found = cur;
      break;
    }
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const ni = world.idx(nx, ny);
      if (prev[ni] !== -1 || world.staticBlocked[ni] || world.tiles[ni] === T.FARMLAND) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (found < 0) return;
  let cur = prev[found];
  while (cur !== start) {
    world.tiles[cur] = T.DIRT;
    cur = prev[cur];
  }
  if (!ROADLIKE.has(world.tiles[start])) world.tiles[start] = T.DIRT;
}
