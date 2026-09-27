/**
 * PaintedNature — trees, bushes, rocks and stumps in the soft, hand-painted style (see GroundPainter).
 *
 * The light comes from the top left: every leaf clump is lit there and shaded towards the bottom right,
 * with a darker underside where the crown overhangs, dabs of leaf texture, and a few bright highlights.
 * Each tree comes in a few shapes (variants) so a wood doesn't look stamped out. Everything is drawn from
 * a seeded random generator — the same every time.
 *
 * Sizes and feet (the y of the ground contact, for the sprite origin) are in SIZES; WorldObjectViews uses them.
 */
import { mulberry32 } from '../core/rng.js';

export const TREE_VARIANTS = 3;

/** Canvas size and where the feet are, per texture family. */
export const SIZES = {
  tree_oak: { w: 96, h: 112, feet: 104 },
  tree_pine: { w: 64, h: 108, feet: 101 },
  tree_apple: { w: 72, h: 84, feet: 78 },
  stump: { w: 36, h: 30, feet: 24 },
  rock: { w: 40, h: 34, feet: 28 },
  rubble: { w: 34, h: 22, feet: 16 },
  bush: { w: 38, h: 32, feet: 27 },
};

const CROWN = {
  spring: { dark: '#2f5a24', mid: '#4f8a36', light: '#7fb552', hi: '#b9dd7d', rim: '#22421b' },
  summer: { dark: '#244a1e', mid: '#3c7a2e', light: '#65a445', hi: '#9fcf6a', rim: '#1a3716' },
  autumn: { dark: '#7a3313', mid: '#b8561f', light: '#e08a33', hi: '#f6c35c', rim: '#5a240d' },
};
const AUTUMN_MIX = [
  { dark: '#6e5516', mid: '#a88022', light: '#d9ae3c', hi: '#f3d774', rim: '#4d3b0e' },
  { dark: '#7a3313', mid: '#b8561f', light: '#e08a33', hi: '#f6c35c', rim: '#5a240d' },
  { dark: '#5e2a14', mid: '#9a3b1c', light: '#c85a2a', hi: '#ec9a5a', rim: '#44200e' },
];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A soft shadow on the ground, cast down and to the right. */
function groundShadow(ctx, x, y, rx, ry, a = 0.3) {
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = `rgba(20,30,10,${a})`;
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.18, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A trunk: bark with light on the left, a flared foot. */
function trunk(ctx, cx, top, bottom, w, rnd, snow = false) {
  const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, '#8a6440');
  g.addColorStop(0.45, '#6b4a2b');
  g.addColorStop(1, '#3f2a17');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx + w / 2, top);
  ctx.lineTo(cx + w / 2 + 1, bottom - 6);
  ctx.quadraticCurveTo(cx + w / 2 + 5, bottom, cx + w / 2 + 7, bottom);
  ctx.lineTo(cx - w / 2 - 7, bottom);
  ctx.quadraticCurveTo(cx - w / 2 - 5, bottom, cx - w / 2 - 1, bottom - 6);
  ctx.closePath();
  ctx.fill();
  // bark lines
  ctx.strokeStyle = 'rgba(40,24,12,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const x = cx - w / 2 + 2 + rnd() * (w - 4);
    ctx.beginPath();
    ctx.moveTo(x, top + rnd() * 6);
    ctx.lineTo(x + (rnd() - 0.5) * 2, bottom - 4 - rnd() * 6);
    ctx.stroke();
  }
  if (snow) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(cx - w / 2 - 6, bottom - 2, w + 12, 2);
  }
}

/** A leafy crown made of clumps [x, y, r]. */
export function paintLeaves(ctx, clumps, C, rnd, { blossom = null, fruit = null } = {}) {
  // 1. the dark mass under everything (the shade inside the crown)
  ctx.fillStyle = C.rim;
  for (const [x, y, r] of clumps) {
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 2, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 2. each clump, lit from the top left
  const sorted = [...clumps].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y, r] of sorted.reverse()) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, C.light);
    g.addColorStop(0.55, C.mid);
    g.addColorStop(1, C.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 3. leaf dabs: small ellipses, lighter towards the light
  const inside = (px, py) => clumps.some(([x, y, r]) => (px - x) ** 2 + (py - y) ** 2 < (r - 1) ** 2);
  const minX = Math.min(...clumps.map(([x, , r]) => x - r));
  const maxX = Math.max(...clumps.map(([x, , r]) => x + r));
  const minY = Math.min(...clumps.map(([, y, r]) => y - r));
  const maxY = Math.max(...clumps.map(([, y, r]) => y + r));
  for (let i = 0; i < 260; i++) {
    const px = minX + rnd() * (maxX - minX);
    const py = minY + rnd() * (maxY - minY);
    if (!inside(px, py)) continue;
    const t = (px - minX) / (maxX - minX) * 0.4 + (py - minY) / (maxY - minY) * 0.6; // 0 = lit, 1 = shade
    const col = t < 0.35 ? C.hi : t < 0.6 ? C.light : t < 0.8 ? C.mid : C.dark;
    ctx.fillStyle = rgba(col, 0.55 + rnd() * 0.35);
    ctx.beginPath();
    ctx.ellipse(px, py, 1.6 + rnd() * 1.6, 1 + rnd() * 1.1, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 4. a few bright highlights on the lit side of the top clumps
  for (const [x, y, r] of clumps.filter(([, y]) => y < (minY + maxY) / 2)) {
    ctx.fillStyle = rgba(C.hi, 0.55);
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (blossom) {
    for (let i = 0; i < 30; i++) {
      const px = minX + rnd() * (maxX - minX);
      const py = minY + rnd() * (maxY - minY) * 0.8;
      if (!inside(px, py)) continue;
      ctx.fillStyle = rnd() < 0.6 ? blossom : '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 1.3 + rnd() * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (fruit) {
    for (let i = 0; i < 12; i++) {
      const px = minX + rnd() * (maxX - minX);
      const py = minY + (maxY - minY) * (0.3 + rnd() * 0.6);
      if (!inside(px, py)) continue;
      ctx.fillStyle = fruit;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(px - 0.7, py - 0.7, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Bare winter branches, with snow along the tops. */
function bareBranches(ctx, cx, base, spread, height, rnd) {
  const branches = [];
  const grow = (x, y, ang, len, w, depth) => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    branches.push([x, y, x2, y2, w]);
    if (depth <= 0) return;
    const n = depth > 1 ? 2 : 3;
    for (let i = 0; i < n; i++) grow(x2, y2, ang + (rnd() - 0.5) * 1.3 + (i - (n - 1) / 2) * 0.5, len * (0.6 + rnd() * 0.15), Math.max(1, w * 0.6), depth - 1);
  };
  grow(cx, base, -Math.PI / 2, height * 0.38, 7, 3);
  ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2, w] of branches) {
    ctx.strokeStyle = '#5b3f25';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (const [x1, y1, x2, y2, w] of branches) {
    if (w < 1.5) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, w * 0.45);
    ctx.beginPath();
    ctx.moveTo(x1 + (x2 - x1) * 0.2, y1 + (y2 - y1) * 0.2 - w * 0.4);
    ctx.lineTo(x2, y2 - w * 0.4);
    ctx.stroke();
  }
}

export function paintOak(season, variant = 0) {
  const S = SIZES.tree_oak;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(1000 + variant * 97 + season.length * 7);
  const cx = S.w / 2 + (variant - 1) * 2;
  groundShadow(ctx, cx, S.feet - 1, 30, 8, season === 'winter' ? 0.18 : 0.32);
  if (season === 'winter') {
    trunk(ctx, cx, 58, S.feet, 11, rnd, true);
    bareBranches(ctx, cx, 62, 40, 110, rnd);
    return c;
  }
  trunk(ctx, cx, 58, S.feet, 11, rnd);
  // The crown: a big round mass of clumps, a different shape for each variant.
  const shapes = [
    [[0, -30, 24], [-19, -20, 16], [19, -20, 16], [-11, -44, 15], [12, -44, 15], [0, -52, 13], [-24, -34, 12], [24, -34, 12], [-8, -12, 14], [10, -12, 14]],
    [[0, -28, 22], [-20, -24, 17], [20, -18, 15], [-6, -46, 17], [14, -42, 13], [-26, -38, 11], [28, -30, 11], [2, -12, 15], [-14, -10, 11]],
    [[0, -34, 25], [-18, -18, 15], [18, -22, 17], [-12, -50, 14], [10, -52, 14], [-26, -30, 12], [25, -38, 11], [0, -12, 13], [16, -8, 10]],
  ][variant % 3];
  const clumps = shapes.map(([x, y, r]) => [cx + x + (rnd() - 0.5) * 2, 70 + y + (rnd() - 0.5) * 2, r + (rnd() - 0.5) * 2]);
  const C = season === 'autumn' ? AUTUMN_MIX[variant % 3] : CROWN[season];
  paintLeaves(ctx, clumps, C, rnd, { blossom: season === 'spring' ? '#f5bfd3' : null, fruit: season === 'summer' && variant === 2 ? '#c8392e' : null });
  if (season === 'autumn') {
    // fallen leaves round the foot
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = ['#d9822b', '#c4491f', '#e8b83a'][Math.floor(rnd() * 3)];
      ctx.beginPath();
      ctx.ellipse(cx - 24 + rnd() * 48, S.feet - 4 + rnd() * 7, 1.8, 1.1, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

/** An apple tree (an orchard's — ForestrySystem): low and round, blossom in spring, red apples in autumn while they hang. */
export function paintApple(season, variant = 0, fruit = false) {
  const S = SIZES.tree_apple;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(3000 + variant * 71 + season.length * 13);
  const cx = S.w / 2 + (variant - 1);
  groundShadow(ctx, cx, S.feet - 1, 22, 6, season === 'winter' ? 0.16 : 0.3);
  if (season === 'winter') {
    trunk(ctx, cx, 46, S.feet, 8, rnd, true);
    bareBranches(ctx, cx, 48, 30, 90, rnd);
    return c;
  }
  trunk(ctx, cx, 46, S.feet, 8, rnd);
  const shapes = [
    [[0, -22, 17], [-14, -14, 12], [14, -14, 12], [-8, -32, 11], [9, -32, 11], [0, -8, 11]],
    [[0, -20, 16], [-15, -18, 13], [15, -12, 11], [-4, -34, 12], [11, -30, 10], [-8, -6, 10]],
    [[0, -24, 18], [-13, -12, 11], [13, -16, 12], [-9, -36, 10], [8, -36, 11], [4, -6, 10]],
  ][variant % 3];
  const clumps = shapes.map(([x, y, r]) => [cx + x + (rnd() - 0.5) * 2, 56 + y + (rnd() - 0.5) * 2, r + (rnd() - 0.5) * 2]);
  const C = season === 'autumn' ? AUTUMN_MIX[0] : CROWN[season];
  paintLeaves(ctx, clumps, season === 'autumn' ? { ...CROWN.summer, hi: C.hi } : C, rnd, { blossom: season === 'spring' ? '#fbe3ec' : null, fruit: fruit || season === 'summer' ? (season === 'summer' ? '#9cc24a' : '#d23a2c') : null });
  return c;
}

export function paintPine(season, variant = 0) {
  const S = SIZES.tree_pine;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(2000 + variant * 53 + season.length * 11);
  const cx = S.w / 2;
  groundShadow(ctx, cx, S.feet - 1, 20, 6, 0.3);
  trunk(ctx, cx, 78, S.feet, 7, rnd, season === 'winter');
  const dark = season === 'autumn' ? '#244a30' : '#1f4a2c';
  const mid = season === 'autumn' ? '#35664a' : '#2f6b40';
  const light = season === 'autumn' ? '#4f8a62' : '#4a9258';
  const hi = '#7cbf82';
  const tiers = 4 + (variant % 2);
  const top = 6 + variant * 3;
  const bottom = 84;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const ty = top + t * (bottom - top - 22);
    const by = ty + 26 + t * 4;
    const half = 9 + t * 18 + (rnd() - 0.5) * 3;
    // the tier: a drooping skirt of needles, lit on the left
    const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    g.addColorStop(0, light);
    g.addColorStop(0.45, mid);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, ty);
    ctx.quadraticCurveTo(cx - half * 0.5, ty + (by - ty) * 0.6, cx - half, by);
    // a ragged lower edge
    const teeth = 6;
    for (let k = 1; k <= teeth; k++) {
      const x = cx - half + (2 * half * k) / teeth;
      ctx.lineTo(x - half / teeth, by - 3 - rnd() * 3);
      ctx.lineTo(x, by + rnd() * 2);
    }
    ctx.quadraticCurveTo(cx + half * 0.5, ty + (by - ty) * 0.6, cx, ty);
    ctx.fill();
    // needle strokes
    ctx.strokeStyle = rgba(hi, 0.45);
    ctx.lineWidth = 1;
    for (let k = 0; k < 14; k++) {
      const x = cx - half * 0.8 + rnd() * half * 0.9;
      const y = ty + 6 + rnd() * (by - ty - 8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 4);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(10,25,12,0.3)';
    ctx.fillRect(cx - half * 0.6, by - 1, half * 1.4, 2);
    if (season === 'winter') {
      ctx.fillStyle = 'rgba(248,251,253,0.95)';
      ctx.beginPath();
      ctx.moveTo(cx, ty);
      ctx.quadraticCurveTo(cx - half * 0.45, ty + (by - ty) * 0.5, cx - half * 0.85, by - 4);
      ctx.quadraticCurveTo(cx, by - 9, cx + half * 0.6, by - 6);
      ctx.quadraticCurveTo(cx + half * 0.35, ty + (by - ty) * 0.5, cx, ty);
      ctx.fill();
    }
  }
  return c;
}

export function paintBush(full, season) {
  const S = SIZES.bush;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(3000 + (full ? 1 : 0) + season.length);
  groundShadow(ctx, S.w / 2, S.feet - 1, 15, 4.5, 0.28);
  if (season === 'winter') {
    bareBranches(ctx, S.w / 2, S.feet - 2, 14, 44, rnd);
    return c;
  }
  const C = season === 'autumn'
    ? { dark: '#5b5a1f', mid: '#86832e', light: '#b2aa4a', hi: '#d9cf78', rim: '#3e3d14' }
    : { dark: '#23491f', mid: '#3d7a31', light: '#62a246', hi: '#9bd06c', rim: '#1a3517' };
  const cx = S.w / 2;
  const clumps = [[cx - 9, 19, 8], [cx + 9, 19, 8], [cx, 13, 10], [cx - 4, 21, 7], [cx + 5, 22, 7]];
  paintLeaves(ctx, clumps, C, rnd, { fruit: full ? '#c8323a' : null });
  return c;
}

export function paintStump(season) {
  const S = SIZES.stump;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(4000);
  groundShadow(ctx, S.w / 2, S.feet - 1, 12, 4, 0.28);
  trunk(ctx, S.w / 2, 12, S.feet, 13, rnd, season === 'winter');
  ctx.fillStyle = season === 'winter' ? '#f2f5f8' : '#caa06a';
  ctx.beginPath();
  ctx.ellipse(S.w / 2, 12, 7.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (season !== 'winter') {
    ctx.strokeStyle = '#a07649';
    ctx.lineWidth = 0.8;
    for (const r of [2, 4, 6]) {
      ctx.beginPath();
      ctx.ellipse(S.w / 2, 12, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return c;
}

const ROCK_BASE = { stone: '#8f8b82', iron: '#8d8177', coal: '#5f5f63', clay: '#a8704a' };

export function paintRock(variant, season) {
  const S = SIZES.rock;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(5000 + variant.length * 13);
  groundShadow(ctx, S.w / 2, S.feet - 1, 17, 5, 0.3);
  const base = ROCK_BASE[variant] || ROCK_BASE.stone;
  const pts = [[5, 26], [3, 18], [9, 9], [18, 4], [29, 7], [36, 15], [35, 25], [21, 30]];
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(8, 5, 32, 30);
  g.addColorStop(0, shadeHex(base, 40));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shadeHex(base, -45));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  ctx.strokeStyle = rgba(shadeHex(base, -70), 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  // facets and cracks
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = rgba(shadeHex(base, -40), 0.5);
  ctx.beginPath();
  ctx.moveTo(4, 22);
  ctx.lineTo(20, 26);
  ctx.lineTo(36, 20);
  ctx.lineTo(36, 32);
  ctx.lineTo(4, 32);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.22);
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(18, 6);
  ctx.lineTo(24, 8);
  ctx.lineTo(14, 14);
  ctx.fill();
  ctx.strokeStyle = rgba(shadeHex(base, -60), 0.55);
  ctx.beginPath();
  ctx.moveTo(18, 6);
  ctx.lineTo(20, 16);
  ctx.lineTo(28, 22);
  ctx.stroke();
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rgba(rnd() < 0.5 ? shadeHex(base, 25) : shadeHex(base, -30), 0.5);
    ctx.fillRect(4 + rnd() * 32, 5 + rnd() * 24, 1.2, 1.2);
  }
  if (variant === 'iron') for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#c0703d' : '#d9955a';
    ctx.beginPath();
    ctx.arc(8 + rnd() * 24, 9 + rnd() * 15, 1.6 + rnd(), 0, Math.PI * 2);
    ctx.fill();
  }
  if (variant === 'coal') for (let i = 0; i < 8; i++) {
    ctx.fillStyle = '#1b1b1d';
    ctx.fillRect(7 + rnd() * 24, 8 + rnd() * 15, 4, 3);
    ctx.fillStyle = 'rgba(150,150,170,0.7)';
    ctx.fillRect(8 + rnd() * 22, 9 + rnd() * 13, 1, 1);
  }
  if (variant === 'clay') for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#8a5436' : '#c9956a';
    ctx.fillRect(7 + rnd() * 24, 11 + rnd() * 12, 6, 2);
  }
  // moss on the shaded side (not on a clay bank)
  if (variant !== 'clay' && season !== 'winter') {
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = rgba(season === 'autumn' ? '#8a8a3a' : '#5d8a3a', 0.6);
      ctx.beginPath();
      ctx.arc(20 + rnd() * 15, 20 + rnd() * 9, 1.4 + rnd(), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  if (season === 'winter') {
    ctx.fillStyle = 'rgba(248,251,253,0.95)';
    ctx.beginPath();
    ctx.moveTo(7, 11);
    ctx.quadraticCurveTo(18, 1, 30, 7);
    ctx.quadraticCurveTo(33, 11, 27, 12);
    ctx.quadraticCurveTo(17, 10, 7, 11);
    ctx.fill();
  }
  return c;
}

export function paintRubble(season) {
  const S = SIZES.rubble;
  const c = canvas(S.w, S.h);
  const ctx = c.getContext('2d');
  groundShadow(ctx, S.w / 2, S.feet, 13, 3.5, 0.22);
  for (const [x, y, r] of [[9, 13, 4.5], [18, 10, 5.5], [26, 14, 4], [15, 15, 3.5]]) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0.5, x, y, r);
    g.addColorStop(0, season === 'winter' ? '#ffffff' : '#b8b4aa');
    g.addColorStop(1, season === 'winter' ? '#c9cdd1' : '#6f6c66');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Undergrowth for the painted ground: grass clumps, ferns, small flowers (variants 0..5). */
export function paintTuft(season, variant) {
  const c = canvas(22, 18);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(6000 + variant * 31 + season.length);
  const P = {
    spring: ['#3f7a2c', '#5f9a3c', '#8cc05a'],
    summer: ['#35692a', '#528c36', '#7fb34f'],
    autumn: ['#7a6b2a', '#9a8a3a', '#c2ad58'],
    winter: ['#b8c4cc', '#d8e0e6', '#ffffff'],
  }[season];
  const kind = variant % 3; // 0 grass clump, 1 fern, 2 flowering clump
  ctx.lineCap = 'round';
  if (kind === 1 && season !== 'winter') {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      const len = 8 + rnd() * 4;
      ctx.strokeStyle = P[i % 2 ? 1 : 0];
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(11, 17);
      ctx.quadraticCurveTo(11 + Math.cos(a) * len * 0.5, 17 + Math.sin(a) * len * 0.7, 11 + Math.cos(a) * len, 17 + Math.sin(a) * len);
      ctx.stroke();
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        const x = 11 + Math.cos(a) * len * t;
        const y = 17 + Math.sin(a) * len * t;
        ctx.strokeStyle = P[2];
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a - 1.2) * 3, y + Math.sin(a - 1.2) * 3);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a + 1.2) * 3, y + Math.sin(a + 1.2) * 3);
        ctx.stroke();
      }
    }
    return c;
  }
  for (let i = 0; i < 9; i++) {
    const x = 5 + rnd() * 12;
    const h = 5 + rnd() * 8;
    ctx.strokeStyle = P[Math.floor(rnd() * 3)];
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 17);
    ctx.quadraticCurveTo(x + (rnd() - 0.5) * 3, 17 - h * 0.6, x + (rnd() - 0.5) * 6, 17 - h);
    ctx.stroke();
  }
  if (kind === 2 && season !== 'winter') {
    const cols = season === 'autumn' ? ['#e9a23b', '#c95d2e'] : ['#f7e26b', '#ffffff', '#f59ac0', '#b9a3f0'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.beginPath();
      ctx.arc(6 + rnd() * 10, 4 + rnd() * 6, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
