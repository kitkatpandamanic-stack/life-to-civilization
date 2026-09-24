/**
 * Seeded random numbers and noise.
 * The world is generated from a seed, so the same seed always produces the
 * same map — which means save files only need to store the seed, not every tile.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  float() {
    return this.next();
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  /** Integer in [a, b] inclusive. */
  int(a, b) {
    return Math.floor(a + (b - a + 1) * this.next());
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
}

/** Deterministic hash of a 2D coordinate → [0, 1). */
export function hash2(x, y, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x, y, scale, seed) {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise: several octaves of value noise layered together. */
export function fbm(x, y, scale, seed, octaves = 3) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let s = scale;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, s, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    s /= 2;
  }
  return sum / norm;
}

/**
 * Seeded random numbers for simulation decisions. The generator state is saved
 * with the game (state.rngState), so the same save + the same inputs replay the
 * same way — bugs can be reproduced. Rendering/UI code uses Math.random instead,
 * so visual effects never disturb the simulation's sequence.
 */
let rs = 0x9e3779b9 | 0;
function nextRand() {
  rs = (rs + 0x6d2b79f5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rand = {
  float: () => nextRand(),
  int: (a, b) => Math.floor(a + (b - a + 1) * nextRand()),
  range: (a, b) => a + (b - a) * nextRand(),
  pick: (arr) => arr[Math.floor(nextRand() * arr.length)],
  chance: (p) => nextRand() < p,
  /** Pick from [[value, weight], ...]. */
  weighted(entries) {
    const total = entries.reduce((s, e) => s + Math.max(0, e[1]), 0);
    if (total <= 0) return entries.length ? entries[0][0] : null;
    let r = nextRand() * total;
    for (const [v, w] of entries) {
      r -= Math.max(0, w);
      if (r < 0) return v;
    }
    return entries[entries.length - 1][0];
  },
  getState: () => rs,
  setState: (v) => {
    rs = v | 0;
  },
};

/** Stable per-entity random number in [0, 1) — e.g. an NPC's personal habits. */
export function hashStr(str, seed = 0) {
  let h = (seed | 0) ^ 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
