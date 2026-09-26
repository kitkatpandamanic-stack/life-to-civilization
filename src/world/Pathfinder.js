/**
 * A* pathfinding on the tile grid (8 directions, no corner cutting).
 * Roads are cheaper to walk on, so villagers naturally use them — which
 * means building roads later will actually change how people move.
 *
 * Performance (the busiest thing the simulation does): the open list is a binary heap in typed
 * arrays (no objects made per step), and routes are remembered — the same route asked for again
 * while nothing in the world has changed (world.rev: a building, a road, a tree felled or grown)
 * is handed back at once. (A worker checks a spot can be reached and then walks there: one search.)
 */

// The heap: node indices and their priorities, in parallel typed arrays (grown when needed).
let hNode = new Int32Array(4096);
let hPrio = new Float64Array(4096);
let hSize = 0;

function hPush(node, priority) {
  if (hSize === hNode.length) {
    const n = new Int32Array(hSize * 2);
    n.set(hNode);
    hNode = n;
    const p = new Float64Array(hSize * 2);
    p.set(hPrio);
    hPrio = p;
  }
  let i = hSize++;
  hNode[i] = node;
  hPrio[i] = priority;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hPrio[p] <= hPrio[i]) break;
    const tn = hNode[p];
    hNode[p] = hNode[i];
    hNode[i] = tn;
    const tp = hPrio[p];
    hPrio[p] = hPrio[i];
    hPrio[i] = tp;
    i = p;
  }
}

function hPop() {
  const top = hNode[0];
  hSize--;
  if (hSize > 0) {
    hNode[0] = hNode[hSize];
    hPrio[0] = hPrio[hSize];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < hSize && hPrio[l] < hPrio[m]) m = l;
      if (r < hSize && hPrio[r] < hPrio[m]) m = r;
      if (m === i) break;
      const tn = hNode[m];
      hNode[m] = hNode[i];
      hNode[i] = tn;
      const tp = hPrio[m];
      hPrio[m] = hPrio[i];
      hPrio[i] = tp;
      i = m;
    }
  }
  return top;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

let gScore = null;
let cameFrom = null;
let visitStamp = null;
let stamp = 0;

// Remembered routes: "sx,sy,gx,gy" → { rev, world, path | null, limit }.
const CACHE_SIZE = 800;
const cache = new Map();
export const pathStats = { searches: 0, cached: 0 };

/**
 * Returns an array of {tx, ty} steps from (after) start to goal, or null.
 * The start tile may be blocked (e.g. an NPC standing next to a tree).
 */
export function findPath(world, sx, sy, gx, gy, maxIterations = 40000) {
  if (!world.inBounds(gx, gy) || world.isBlocked(gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  const key = `${sx},${sy},${gx},${gy}`;
  const rev = world.rev || 0;
  const hit = cache.get(key);
  // (A route found is the same whatever the search limit; "no route" only holds for as long a search.)
  if (hit && hit.world === world && hit.rev === rev && (hit.path || hit.limit >= maxIterations)) {
    pathStats.cached++;
    cache.delete(key);
    cache.set(key, hit); // (most recently used)
    return hit.path ? hit.path.map((s) => ({ tx: s.tx, ty: s.ty })) : null;
  }
  pathStats.searches++;
  const path = search(world, sx, sy, gx, gy, maxIterations);
  cache.set(key, { world, rev, path: path ? path.map((s) => ({ tx: s.tx, ty: s.ty })) : null, limit: maxIterations });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return path;
}

function search(world, sx, sy, gx, gy, maxIterations) {
  const W = world.W;
  const H = world.H;
  const N = W * H;
  if (!gScore || gScore.length !== N) {
    gScore = new Float32Array(N);
    cameFrom = new Int32Array(N);
    visitStamp = new Uint32Array(N);
  }
  stamp++;
  const sb = world.staticBlocked;
  const db = world.dynBlocked;
  const blocked = (x, y) => x < 0 || y < 0 || x >= W || y >= H || sb[y * W + x] === 1 || db[y * W + x] === 1;
  const start = sy * W + sx;
  const goal = gy * W + gx;
  hSize = 0;
  const h = (x, y) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  visitStamp[start] = stamp;
  gScore[start] = 0;
  cameFrom[start] = -1;
  hPush(start, h(sx, sy));

  let iterations = 0;
  while (hSize && iterations++ < maxIterations) {
    const cur = hPop();
    if (cur === goal) break;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const g = gScore[cur];
    for (let d = 0; d < 8; d++) {
      const dx = DX[d];
      const dy = DY[d];
      const nx = cx + dx;
      const ny = cy + dy;
      if (blocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      const ng = g + DD[d] * world.moveCost(nx, ny);
      if (visitStamp[ni] === stamp && ng >= gScore[ni]) continue;
      visitStamp[ni] = stamp;
      gScore[ni] = ng;
      cameFrom[ni] = cur;
      hPush(ni, ng + h(nx, ny));
    }
  }
  if (visitStamp[goal] !== stamp) return null;

  const path = [];
  let cur = goal;
  while (cur !== start && cur !== -1) {
    path.push({ tx: cur % W, ty: (cur / W) | 0 });
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}
