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

/** Math.random helpers for runtime (non-deterministic) decisions. */
export const rand = {
  int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()),
  range: (a, b) => a + (b - a) * Math.random(),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,
};
