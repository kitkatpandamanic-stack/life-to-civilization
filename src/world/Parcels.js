/**
 * Parcels — the valley divided into plots of land.
 *
 * Not a grid: the land is split the way land is — along roads, the river and the lake
 * shore, into irregular plots of different sizes. Built from the generated world alone
 * (so it comes out the same after loading), then changed by what happens in play —
 * a lot carved out for a new house, two plots joined, one split — which is saved as a
 * list of operations and replayed on load (TerritorySystem).
 *
 *   world.parcels = { map: Int16Array (tile → index into list, -1 = none: water, roads),
 *                     list: [{ id, kind, n, x1, y1, x2, y2, cx, cy, gone }], byId: Map }
 *
 * kind: 'plot' (the plots with a "for sale" sign — data/land.js), 'lot' (the ground a
 *       building stands on), 'land' (everything else: meadows, woods, fields, hillsides).
 */
import { T } from './WorldGenerator.js';
import { hash2 } from '../core/rng.js';
import { PLOTS } from '../data/land.js';

const SPACING = 9; // roughly how far apart plots of open land are
const MIN_TILES = 14; // smaller scraps are joined to a neighbour
const NO_LAND = new Set([T.WATER, T.DEEP, T.ROAD, T.PLAZA, T.BRIDGE]);

export function buildParcels(world, seed) {
  const { W, H } = world;
  const map = new Int16Array(W * H).fill(-1);
  const list = [];
  const add = (id, kind) => {
    list.push({ id, kind, n: 0 });
    return list.length - 1;
  };
  const idx = (x, y) => y * W + x;
  const free = (x, y) => world.inBounds(x, y) && map[idx(x, y)] === -1 && !NO_LAND.has(world.tileAt(x, y));

  // 1. The plots for sale keep their shapes.
  for (const p of PLOTS) {
    const i = add(p.id, 'plot');
    for (let y = p.y1; y <= p.y2; y++) for (let x = p.x1; x <= p.x2; x++) if (free(x, y)) map[idx(x, y)] = i;
  }
  // 2. Every building stands on its own lot: its footprint and a strip around it (the door step included).
  for (const b of world.buildingList) {
    const i = add(`lot_${b.id}`, 'lot');
    for (let y = b.ty - 1; y <= b.ty + b.h; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) if (free(x, y)) map[idx(x, y)] = i;
  }
  // 3. The rest: plots grown out from scattered points until they meet (roads and water stop them).
  const queue = [];
  const seeds = [];
  for (let gy = 0; gy < H; gy += SPACING) {
    for (let gx = 0; gx < W; gx += SPACING) {
      const x = gx + Math.floor(hash2(gx, gy, seed ^ 0x5eed) * SPACING);
      const y = gy + Math.floor(hash2(gy + 7, gx + 3, seed ^ 0x9a3) * SPACING);
      if (free(x, y)) seeds.push([x, y]);
    }
  }
  seeds.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let n = 1;
  for (const [x, y] of seeds) {
    if (!free(x, y)) continue;
    const i = add(`p${n++}`, 'land');
    map[idx(x, y)] = i;
    queue.push(x, y);
  }
  const grow = (q) => {
    for (let h = 0; h < q.length; h += 2) {
      const x = q[h];
      const y = q[h + 1];
      const i = map[idx(x, y)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!free(nx, ny)) continue;
        map[idx(nx, ny)] = i;
        q.push(nx, ny);
      }
    }
  };
  grow(queue);
  // Pockets nobody reached (cut off by water and roads) become plots of their own.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!free(x, y)) continue;
      const i = add(`p${n++}`, 'land');
      map[idx(x, y)] = i;
      grow([x, y]);
    }
  }
  const parcels = { map, list, byId: new Map(), W, H };
  recount(parcels);
  // 4. Scraps too small to be worth anything are joined to the neighbour they share most border with.
  for (const p of list) {
    if (p.gone || p.kind !== 'land' || p.n >= MIN_TILES) continue;
    const i = list.indexOf(p);
    const border = new Map();
    for (let y = p.y1; y <= p.y2; y++) {
      for (let x = p.x1; x <= p.x2; x++) {
        if (map[idx(x, y)] !== i) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const j = map[idx(nx, ny)];
          if (j >= 0 && j !== i && list[j].kind === 'land') border.set(j, (border.get(j) || 0) + 1);
        }
      }
    }
    const best = [...border.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) mergeInto(parcels, best[0], i);
  }
  recount(parcels);
  return parcels;
}

/** Tile counts, bounding boxes and centres (after building, or after an operation). */
export function recount(parcels, only = null) {
  const { map, list, W, H } = parcels;
  const which = only ? new Set(only) : null;
  for (let i = 0; i < list.length; i++) {
    if (which && !which.has(i)) continue;
    Object.assign(list[i], { n: 0, x1: Infinity, y1: Infinity, x2: -1, y2: -1, sx: 0, sy: 0 });
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map[y * W + x];
      if (i < 0 || (which && !which.has(i))) continue;
      const p = list[i];
      p.n++;
      p.sx += x;
      p.sy += y;
      if (x < p.x1) p.x1 = x;
      if (y < p.y1) p.y1 = y;
      if (x > p.x2) p.x2 = x;
      if (y > p.y2) p.y2 = y;
    }
  }
  for (let i = 0; i < list.length; i++) {
    if (which && !which.has(i)) continue;
    const p = list[i];
    p.cx = p.n ? p.sx / p.n : 0;
    p.cy = p.n ? p.sy / p.n : 0;
    delete p.sx;
    delete p.sy;
    if (!p.n) p.gone = true;
  }
  parcels.byId = new Map(list.map((p, i) => [p.id, i]));
}

function mergeInto(parcels, into, from) {
  const { map, list } = parcels;
  const p = list[from];
  for (let y = p.y1; y <= p.y2; y++) for (let x = p.x1; x <= p.x2; x++) if (map[y * parcels.W + x] === from) map[y * parcels.W + x] = into;
  p.gone = true;
  p.n = 0;
}

/**
 * Change the map (and remember how, so it can be done again after loading):
 *   { op: 'carve', id, from, x1, y1, x2, y2 } — part of a plot becomes a new one (a lot for a house)
 *   { op: 'merge', a, b }                       — b becomes part of a
 *   { op: 'split', id, nid, axis, at }          — the part of id at or beyond `at` becomes nid
 * Returns the indexes touched, or null if the operation made no sense.
 */
export function applyOp(parcels, op) {
  const { map, list, W } = parcels;
  const at = (id) => parcels.byId.get(id);
  if (op.op === 'carve') {
    const from = op.from !== undefined ? at(op.from) : null;
    if (at(op.id) !== undefined) return null;
    list.push({ id: op.id, kind: op.kind || 'lot', n: 0 });
    const i = list.length - 1;
    let moved = 0;
    const touched = new Set([i]);
    for (let y = op.y1; y <= op.y2; y++) {
      for (let x = op.x1; x <= op.x2; x++) {
        if (x < 0 || y < 0 || x >= W || y >= parcels.H) continue;
        const k = map[y * W + x];
        if (k < 0 || (from !== null && from !== undefined && k !== from) || (from === null && op.from !== undefined)) continue;
        if (op.only && !op.only.includes(list[k].id)) continue;
        touched.add(k);
        map[y * W + x] = i;
        moved++;
      }
    }
    if (!moved) {
      list.pop();
      return null;
    }
    recount(parcels, [...touched]);
    return [...touched];
  }
  if (op.op === 'merge') {
    const a = at(op.a);
    const b = at(op.b);
    if (a === undefined || b === undefined || a === b) return null;
    mergeInto(parcels, a, b);
    recount(parcels, [a, b]);
    return [a, b];
  }
  if (op.op === 'split') {
    const i = at(op.id);
    if (i === undefined || at(op.nid) !== undefined) return null;
    const p = list[i];
    list.push({ id: op.nid, kind: p.kind === 'plot' ? 'land' : p.kind, n: 0 });
    const j = list.length - 1;
    let moved = 0;
    for (let y = p.y1; y <= p.y2; y++) {
      for (let x = p.x1; x <= p.x2; x++) {
        if (map[y * W + x] !== i) continue;
        if ((op.axis === 'x' ? x : y) >= op.at) {
          map[y * W + x] = j;
          moved++;
        }
      }
    }
    if (!moved || moved === p.n) {
      // Nothing to split off (or all of it): undo.
      if (moved) for (let k = 0; k < map.length; k++) if (map[k] === j) map[k] = i;
      list.pop();
      return null;
    }
    recount(parcels, [i, j]);
    return [i, j];
  }
  return null;
}
