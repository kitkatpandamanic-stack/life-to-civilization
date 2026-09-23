/**
 * A* pathfinding on the tile grid (8 directions, no corner cutting).
 * Roads are cheaper to walk on, so villagers naturally use them — which
 * means building roads later will actually change how people move.
 */

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node, priority) {
    const a = this.items;
    a.push({ node, priority });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.node;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

let gScore = null;
let cameFrom = null;
let visitStamp = null;
let stamp = 0;

/**
 * Returns an array of {tx, ty} steps from (after) start to goal, or null.
 * The start tile may be blocked (e.g. an NPC standing next to a tree).
 */
export function findPath(world, sx, sy, gx, gy, maxIterations = 40000) {
  const W = world.W;
  const N = W * world.H;
  if (!world.inBounds(gx, gy) || world.isBlocked(gx, gy)) return null;
  if (sx === gx && sy === gy) return [];
  if (!gScore || gScore.length !== N) {
    gScore = new Float32Array(N);
    cameFrom = new Int32Array(N);
    visitStamp = new Uint32Array(N);
  }
  stamp++;
  const start = sy * W + sx;
  const goal = gy * W + gx;
  const heap = new MinHeap();
  const h = (x, y) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  visitStamp[start] = stamp;
  gScore[start] = 0;
  cameFrom[start] = -1;
  heap.push(start, h(sx, sy));

  let iterations = 0;
  while (heap.size && iterations++ < maxIterations) {
    const cur = heap.pop();
    if (cur === goal) break;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const g = gScore[cur];
    for (const [dx, dy, dist] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (world.isBlocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (world.isBlocked(cx + dx, cy) || world.isBlocked(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      const ng = g + dist * world.moveCost(nx, ny);
      if (visitStamp[ni] === stamp && ng >= gScore[ni]) continue;
      visitStamp[ni] = stamp;
      gScore[ni] = ng;
      cameFrom[ni] = cur;
      heap.push(ni, ng + h(nx, ny));
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
