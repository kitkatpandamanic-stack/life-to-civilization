/**
 * GroundPainter — paints the ground in a soft, hand-painted style.
 *
 * The world is still a grid of tiles (WorldGenerator) — that stays the source of truth for walking and
 * building. This only changes how it LOOKS: each kind of ground (grass, dirt, sand, water…) is laid as
 * soft overlapping blobs filled with a painted texture, so neighbouring grounds blend into each other
 * instead of meeting at square edges. Water gets light shallows along its shores, paths a darker worn rim,
 * and the grass big soft patches of light and shade.
 *
 * paintChunk() paints one piece of the world (a few hundred pixels square) onto a canvas. It reads one
 * tile beyond the piece on every side, so neighbouring pieces join without a seam. Everything is
 * deterministic (hashes of the tile position) — the same world always looks the same.
 */
import { T } from '../world/WorldGenerator.js';
import { hash2, mulberry32, valueNoise } from '../core/rng.js';
import { paintTuft } from './PaintedNature.js';

const TS = 32;

/** Ground colours per season: base, darker, lighter. */
const GROUND = {
  spring: {
    grass: ['#7ea447', '#5d8434', '#a3c45e'],
    forest: ['#5f8436', '#44642a', '#7c9f47'],
    dirt: ['#a97c4d', '#7f5836', '#c79a68'],
    road: ['#b38a5c', '#8a6641', '#cfa979'],
    sand: ['#d6bf88', '#b8a06a', '#eadba8'],
    farm: ['#76502f', '#583a21', '#8f6641'],
    rock: ['#8e8676', '#6c6558', '#aaa292'],
    cliff: ['#5f584d', '#433e36', '#7a7366'],
    plaza: ['#9c9588', '#7c766b', '#b8b1a4'],
    water: ['#3f7f93', '#2f6679', '#5d9eac'],
    deep: ['#2c5d73', '#214a5e', '#3b7187'],
    shallow: '#78b9b5',
    flowers: ['#f6e27a', '#ffffff', '#f3a2c4', '#c3afef'],
  },
  summer: {
    grass: ['#739d3b', '#517a2b', '#9bbf50'],
    forest: ['#557b2e', '#3c5a24', '#71953e'],
    dirt: ['#ae7e4c', '#835a36', '#cc9e69'],
    road: ['#b88d5d', '#8d6842', '#d4ad7b'],
    sand: ['#dcc38a', '#bda46b', '#efdfac'],
    farm: ['#7a5230', '#5b3c22', '#936943'],
    rock: ['#918877', '#6e6759', '#ada594'],
    cliff: ['#615a4e', '#453f37', '#7c7567'],
    plaza: ['#a0998b', '#7f796d', '#bcb5a7'],
    water: ['#3b7a8f', '#2c6275', '#5a9aa8'],
    deep: ['#29596f', '#1f465a', '#386d83'],
    shallow: '#79bdb3',
    flowers: ['#ffd447', '#ff8a5c', '#ffffff', '#e8679a'],
  },
  autumn: {
    grass: ['#a6964a', '#7e7035', '#c8b463'],
    forest: ['#8a7438', '#665427', '#a88e49'],
    dirt: ['#a4764a', '#7a5334', '#c29565'],
    road: ['#ad8558', '#84613f', '#c9a475'],
    sand: ['#d2ba84', '#b39b66', '#e6d5a2'],
    farm: ['#704a2c', '#53361f', '#8a613e'],
    rock: ['#8b8373', '#6a6356', '#a79f8f'],
    cliff: ['#5d564b', '#413c35', '#787165'],
    plaza: ['#9a9386', '#7a7469', '#b6afa2'],
    water: ['#3d7486', '#2d5d6e', '#5a93a0'],
    deep: ['#2b5669', '#204455', '#386a7e'],
    shallow: '#7fb2a8',
    flowers: ['#eaa43c', '#cb5f2f', '#f5d560'],
    leaves: ['#d9822b', '#c4491f', '#e8b83a', '#b8621f'],
  },
  winter: {
    grass: ['#e8edf1', '#c9d3dc', '#ffffff'],
    forest: ['#dce3e9', '#bcc7d1', '#f3f6f8'],
    dirt: ['#d8d3ca', '#b9b2a6', '#ece9e3'],
    road: ['#cfc8bc', '#aaa294', '#e4dfd6'],
    sand: ['#ebe7df', '#cfc9bd', '#f7f5f0'],
    farm: ['#d9d2c6', '#b8afa2', '#ece8e1'],
    rock: ['#d6d4cf', '#b1afa9', '#eeedea'],
    cliff: ['#6d675d', '#4d4840', '#8a8479'],
    plaza: ['#cfcac1', '#aaa59b', '#e6e2db'],
    water: ['#7fa9c2', '#6590aa', '#a6c8da'],
    deep: ['#6a93ad', '#557d97', '#86aac0'],
    shallow: '#cfe4ee',
    flowers: ['#ffffff', '#e3ebf0'],
    snow: true,
  },
};

/** Which paint a tile gets, and the order they're laid in (lowest first). */
const LAYERS = ['deep', 'water', 'sand', 'rock', 'grass', 'forest', 'farm', 'dirt', 'road', 'plaza', 'cliff'];
const MATERIAL = {
  [T.DEEP]: 'deep',
  [T.WATER]: 'water',
  [T.SAND]: 'sand',
  [T.MOUNTAIN]: 'rock',
  [T.GRASS]: 'grass',
  [T.GRASS2]: 'grass',
  [T.GRASS3]: 'grass',
  [T.FLOWERS]: 'grass',
  [T.FOREST]: 'forest',
  [T.FARMLAND]: 'farm',
  [T.DIRT]: 'dirt',
  [T.ROAD]: 'road',
  [T.PLAZA]: 'plaza',
  [T.CLIFF]: 'cliff',
  [T.BRIDGE]: 'water', // the bridge's planks are drawn on top of the river
};
/** How far each paint spreads past its own tile (fraction of a tile), and how soft its edge is (px blur). */
const SPREAD = { deep: 0.85, water: 0.78, sand: 0.8, rock: 0.78, grass: 0.8, forest: 0.82, farm: 0.72, dirt: 0.74, road: 0.72, plaza: 0.7, cliff: 0.72 };
const SOFT = { deep: 6, water: 3, sand: 3, rock: 2, grass: 2.5, forest: 7, farm: 1.2, dirt: 2, road: 1.6, plaza: 0.8, cliff: 1 };
const LAND = new Set(['sand', 'rock', 'grass', 'forest', 'farm', 'dirt', 'road', 'plaza', 'cliff']);

// ------------------------------------------------------------------ textures

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const TEX = 128;
const texCache = new Map();

/** A seamless painted texture for one kind of ground in one season. */
function texture(kind, season) {
  const key = `${kind}:${season}`;
  if (texCache.has(key)) return texCache.get(key);
  const P = GROUND[season];
  const [base, dark, light] = P[kind];
  const c = canvas(TEX, TEX);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(kind.length * 977 + season.length * 131 + kind.charCodeAt(0));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX, TEX);
  // Draw every mark nine times (wrapped) so the texture tiles without a seam.
  const wrap = (fn) => {
    for (const ox of [-TEX, 0, TEX]) for (const oy of [-TEX, 0, TEX]) {
      ctx.save();
      ctx.translate(ox, oy);
      fn();
      ctx.restore();
    }
  };
  const blotches = (n, colors, rMin, rMax, alpha) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * TEX;
      const y = rnd() * TEX;
      const r = rMin + rnd() * (rMax - rMin);
      const col = colors[Math.floor(rnd() * colors.length)];
      const a = alpha * (0.5 + rnd() * 0.5);
      wrap(() => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hexA(col, a));
        g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
  };
  const strokes = (n, colors, len, width, alpha, angle = null) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * TEX;
      const y = rnd() * TEX;
      const a = angle ?? rnd() * Math.PI;
      const l = len * (0.6 + rnd() * 0.8);
      const col = colors[Math.floor(rnd() * colors.length)];
      const al = alpha * (0.6 + rnd() * 0.4);
      wrap(() => {
        ctx.strokeStyle = hexA(col, al);
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      });
    }
  };
  const specks = (n, colors, size, alpha) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * TEX;
      const y = rnd() * TEX;
      const s = size * (0.6 + rnd() * 0.8);
      const col = colors[Math.floor(rnd() * colors.length)];
      wrap(() => {
        ctx.fillStyle = hexA(col, alpha);
        ctx.beginPath();
        ctx.ellipse(x, y, s, s * 0.8, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

  switch (kind) {
    case 'grass':
    case 'forest':
      blotches(26, [dark, light], 10, 26, 0.35);
      // blades: short upward strokes, dark and light
      strokes(420, [dark, shadeHex(base, -18)], 4, 1.2, 0.55, -Math.PI / 2 - 0.25);
      strokes(260, [light, shadeHex(light, 14)], 3.5, 1, 0.5, -Math.PI / 2 + 0.2);
      if (kind === 'forest') {
        specks(40, ['#5b4630', '#6e5638', dark], 1.6, 0.55); // leaf litter
        if (P.leaves) specks(40, P.leaves, 1.5, 0.8);
      } else if (P.leaves) specks(26, P.leaves, 1.3, 0.75);
      break;
    case 'dirt':
    case 'road':
      blotches(22, [dark, light], 8, 22, 0.35);
      specks(kind === 'road' ? 180 : 120, [dark, light, '#8d877e'], 1.3, 0.55); // grit and pebbles
      strokes(60, [dark], 7, 1.4, 0.18); // cart ruts, footfalls
      if (kind === 'road') specks(26, ['#a8a298', '#c4bfb5', '#8d887f'], 2.2, 0.8);
      break;
    case 'sand':
      blotches(20, [dark, light], 10, 24, 0.3);
      strokes(90, [light, dark], 9, 1, 0.22, 0.15);
      specks(80, [dark, '#fff4d6'], 0.9, 0.6);
      break;
    case 'farm':
      blotches(14, [dark, light], 10, 20, 0.3);
      specks(120, [dark, light], 1.2, 0.5);
      break;
    case 'rock':
    case 'cliff':
      blotches(26, [dark, light], 8, 20, 0.45);
      strokes(70, [dark], 8, 1.6, 0.4);
      strokes(40, [light], 6, 1.2, 0.35);
      specks(60, [dark, light], 1.8, 0.6);
      break;
    case 'plaza':
      blotches(10, [dark, light], 12, 26, 0.25);
      break;
    case 'water':
    case 'deep':
      blotches(24, [dark, light], 12, 30, 0.35);
      strokes(70, [light, shadeHex(light, 20)], 8, 1.3, 0.35, 0.05); // ripples
      break;
    default:
      break;
  }
  if (P.snow && kind !== 'water' && kind !== 'deep' && kind !== 'cliff') specks(60, ['#ffffff'], 1.4, 0.8);
  texCache.set(key, c);
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ------------------------------------------------------------------ painting

const GRASSY = new Set([T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST]);
const tufts = new Map();
function tuftCanvas(season, v) {
  const k = `${season}:${v}`;
  if (!tufts.has(k)) tufts.set(k, paintTuft(season, v));
  return tufts.get(k);
}

let scratch = null;
let scratch2 = null;
let scratch3 = null;

/**
 * Paint the tiles [tx0, tx0+tw) × [ty0, ty0+th) onto ctx (whose origin is the top-left of tx0,ty0).
 * @param world  the World (tiles)
 * @param seed   the world seed (for the soft patches)
 */
export function paintChunk(ctx, world, tx0, ty0, tw, th, season, seed = 0) {
  const P = GROUND[season] || GROUND.spring;
  // Painted with a margin all round (then cropped), so soft edges don't fade out at the piece's border.
  const PAD = TS * 2;
  const W = tw * TS + PAD * 2;
  const H = th * TS + PAD * 2;
  if (!scratch || scratch.width !== W || scratch.height !== H) {
    scratch = canvas(W, H);
    scratch2 = canvas(W, H);
    scratch3 = canvas(W, H);
  }
  const out = ctx;
  ctx = scratch3.getContext('2d');
  const m = scratch.getContext('2d');
  const m2 = scratch2.getContext('2d');
  const px0 = tx0 * TS - PAD;
  const py0 = ty0 * TS - PAD;
  const M = 3; // tiles read beyond the piece (the margin plus the neighbours' spread)
  const tileAt = (x, y) => (world.inBounds(x, y) ? world.tiles[world.idx(x, y)] : T.GRASS);
  const matAt = (x, y) => MATERIAL[tileAt(x, y)] || 'grass';

  // Which paints this piece needs (with a tile's margin for the neighbours' spread).
  const present = new Set();
  for (let y = ty0 - M; y < ty0 + th + M; y++) for (let x = tx0 - M; x < tx0 + tw + M; x++) present.add(matAt(x, y));

  ctx.clearRect(0, 0, W, H);

  /** The mask of one paint: soft blobs over each of its tiles. */
  const drawMask = (target, kind, grow = 0, blur = SOFT[kind]) => {
    target.clearRect(0, 0, W, H);
    target.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    target.fillStyle = '#fff';
    target.beginPath();
    for (let y = ty0 - M; y < ty0 + th + M; y++) {
      for (let x = tx0 - M; x < tx0 + tw + M; x++) {
        if (matAt(x, y) !== kind) continue;
        const cx = (x - tx0) * TS + TS / 2 + PAD;
        const cy = (y - ty0) * TS + TS / 2 + PAD;
        const h = hash2(x, y, 911);
        const r = TS * SPREAD[kind] + grow + (h - 0.5) * 4;
        // two slightly offset blobs make a less regular edge
        target.moveTo(cx + r, cy);
        target.arc(cx, cy, r, 0, Math.PI * 2);
        const ox = (hash2(x, y, 37) - 0.5) * 8;
        const oy = (hash2(x, y, 53) - 0.5) * 8;
        target.moveTo(cx + ox + r * 0.8, cy + oy);
        target.arc(cx + ox, cy + oy, r * 0.8, 0, Math.PI * 2);
      }
    }
    target.fill();
    target.filter = 'none';
  };

  /** Fill the mask with a paint's texture (anchored to the world, so pieces join seamlessly). */
  const fillMask = (target, kind) => {
    target.globalCompositeOperation = 'source-in';
    const pat = target.createPattern(texture(kind, season), 'repeat');
    pat.setTransform(new DOMMatrix().translate(-(((px0 % TEX) + TEX) % TEX), -(((py0 % TEX) + TEX) % TEX)));
    target.fillStyle = pat;
    target.fillRect(0, 0, W, H);
    target.globalCompositeOperation = 'source-over';
  };

  const tint = (target, color, alpha) => {
    target.globalCompositeOperation = 'source-in';
    target.fillStyle = hexA(color, alpha);
    target.fillRect(0, 0, W, H);
    target.globalCompositeOperation = 'source-over';
  };

  for (const kind of LAYERS) {
    if (!present.has(kind)) continue;
    // Water shores: the land's edge shows as light shallows over the water (drawn before the land).
    if (kind === 'sand' || kind === 'grass') {
      if (present.has('water') || present.has('deep')) {
        drawLandMask(m2);
        tint(m2, P.shallow, 0.42);
        ctx.drawImage(scratch2, 0, 0);
      }
    }
    // Paths and fields: a darker, worn rim just outside the paint.
    if (kind === 'dirt' || kind === 'road' || kind === 'farm' || kind === 'plaza') {
      drawMask(m2, kind, 4, SOFT[kind] + 3);
      tint(m2, P[kind][1], kind === 'plaza' ? 0.45 : 0.35);
      ctx.drawImage(scratch2, 0, 0);
    }
    // The forest floor sits in the shade of the trees.
    drawMask(m, kind);
    fillMask(m, kind);
    ctx.drawImage(scratch, 0, 0);
  }

  function drawLandMask(target) {
    target.clearRect(0, 0, W, H);
    target.filter = 'blur(5px)';
    target.fillStyle = '#fff';
    target.beginPath();
    for (let y = ty0 - M; y < ty0 + th + M; y++) {
      for (let x = tx0 - M; x < tx0 + tw + M; x++) {
        if (!LAND.has(matAt(x, y))) continue;
        const cx = (x - tx0) * TS + TS / 2 + PAD;
        const cy = (y - ty0) * TS + TS / 2 + PAD;
        const r = TS * 0.95;
        target.moveTo(cx + r, cy);
        target.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
    target.fill();
    target.filter = 'none';
  }

  // Big soft patches of light and shade over the land (sunlight through clouds, richer and poorer soil).
  const low = canvas(Math.ceil(W / 16), Math.ceil(H / 16));
  const lc = low.getContext('2d');
  const img = lc.createImageData(low.width, low.height);
  for (let y = 0; y < low.height; y++) {
    for (let x = 0; x < low.width; x++) {
      const wx = px0 / TS + x / 2;
      const wy = py0 / TS + y / 2;
      const n = valueNoise(wx, wy, 7, seed + 5) * 0.6 + valueNoise(wx, wy, 2.5, seed + 9) * 0.4;
      const i = (y * low.width + x) * 4;
      const v = n - 0.5;
      img.data[i] = v > 0 ? 255 : 30;
      img.data[i + 1] = v > 0 ? 240 : 40;
      img.data[i + 2] = v > 0 ? 190 : 20;
      img.data[i + 3] = Math.round(Math.min(1, Math.abs(v) * 2.4) * (P.snow ? 36 : 95));
    }
  }
  lc.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(low, 0, 0, W, H);
  ctx.restore();

  // Details on top: cobbles on the square, planks on bridges, flowers in the meadows, cliff cracks.
  for (let y = ty0; y < ty0 + th; y++) {
    for (let x = tx0; x < tx0 + tw; x++) {
      const t = tileAt(x, y);
      const ox = (x - tx0) * TS + PAD;
      const oy = (y - ty0) * TS + PAD;
      if (t === T.PLAZA) cobbles(ctx, ox, oy, x, y, P);
      else if (t === T.BRIDGE) planks(ctx, ox, oy, x, y, P, tileAt);
      else if (t === T.FLOWERS) flowers(ctx, ox, oy, x, y, P);
      else if (t === T.FARMLAND) furrows(ctx, ox, oy, P);
      else if (t === T.CLIFF) cracks(ctx, ox, oy, x, y);
      else if (t === T.WATER || t === T.DEEP) glints(ctx, ox, oy, x, y, P);
    }
  }
  // Undergrowth: grass clumps, ferns and small flowers — thicker in the woods and by the water.
  for (let y = ty0; y < ty0 + th; y++) {
    for (let x = tx0; x < tx0 + tw; x++) {
      const t = tileAt(x, y);
      if (!GRASSY.has(t) || world.staticBlocked?.[world.idx(x, y)]) continue;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = tileAt(x + dx, y + dy); return n === T.WATER || n === T.SAND; });
      const dense = t === T.FOREST ? 0.6 : wet ? 0.45 : 0.24;
      const h = hash2(x, y, seed + 77);
      if (h > dense) continue;
      const n = h < dense * 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const r = hash2(x, y, 13 + k);
        const v = t === T.FOREST ? (r < 0.5 ? 1 : r < 0.75 ? 4 : 0) : r < 0.25 ? 2 : r < 0.35 ? 5 : r < 0.45 ? 1 : r < 0.7 ? 3 : 0;
        const img = tuftCanvas(season, v);
        const px = (x - tx0) * TS + PAD + 4 + hash2(x, y, 5 + k * 17) * 24;
        const py = (y - ty0) * TS + PAD + 8 + hash2(x, y, 9 + k * 17) * 22;
        ctx.drawImage(img, Math.round(px - img.width / 2), Math.round(py - img.height));
      }
    }
  }
  out.clearRect(0, 0, tw * TS, th * TS);
  out.drawImage(scratch3, PAD, PAD, tw * TS, th * TS, 0, 0, tw * TS, th * TS);
}

function cobbles(ctx, ox, oy, x, y, P) {
  const [base, dark, light] = P.plaza;
  for (let row = 0; row < 4; row++) {
    const off = (row + y) % 2 ? 4 : 0;
    for (let cx = -off; cx < TS; cx += 8) {
      const h = hash2(x * 8 + cx, y * 4 + row, 71);
      const sx = ox + cx + 1;
      const sy = oy + row * 8 + 1;
      ctx.fillStyle = hexA(dark, 0.55);
      ctx.beginPath();
      ctx.ellipse(sx + 3.5, sy + 3.8, 3.8, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = h < 0.33 ? base : h < 0.66 ? shadeHex(base, 8) : shadeHex(base, -6);
      ctx.beginPath();
      ctx.ellipse(sx + 3.5, sy + 3.1, 3.4, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexA(light, 0.7);
      ctx.beginPath();
      ctx.ellipse(sx + 2.6, sy + 2.2, 1.6, 1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function planks(ctx, ox, oy, x, y, P, tileAt) {
  // Planks run across the river: along x if the water is to the north and south.
  const acrossX = tileAt(x, y - 1) === T.WATER || tileAt(x, y - 1) === T.DEEP || tileAt(x, y + 1) === T.WATER || tileAt(x, y + 1) === T.DEEP;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(ox, oy + 3, TS, TS);
  const wood = P.snow ? ['#9a8a78', '#b3a492'] : ['#9b6b3f', '#a8774a', '#8e6138'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = wood[Math.floor(hash2(x, y * 4 + i, 3) * wood.length)];
    if (acrossX) ctx.fillRect(ox + i * 8, oy, 7, TS);
    else ctx.fillRect(ox, oy + i * 8, TS, 7);
  }
  ctx.fillStyle = 'rgba(40,24,12,0.55)';
  for (let i = 0; i < 4; i++) {
    if (acrossX) ctx.fillRect(ox + i * 8 + 7, oy, 1, TS);
    else ctx.fillRect(ox, oy + i * 8 + 7, TS, 1);
  }
  if (P.snow) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 8; i++) ctx.fillRect(ox + hash2(x, y, i) * 30, oy + hash2(y, x, i) * 30, 2, 2);
  }
  ctx.restore();
}

function flowers(ctx, ox, oy, x, y, P) {
  for (let i = 0; i < 5; i++) {
    const fx = ox + 4 + hash2(x, y, 100 + i) * 24;
    const fy = oy + 4 + hash2(x, y, 200 + i) * 24;
    const col = P.flowers[Math.floor(hash2(x, y, 300 + i) * P.flowers.length)];
    ctx.fillStyle = 'rgba(40,60,20,0.35)';
    ctx.beginPath();
    ctx.ellipse(fx + 0.5, fy + 1.5, 2.6, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + hash2(x, y, i) * 2;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * 1.4, fy + Math.sin(a) * 1.4, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = P.snow ? '#ffffff' : '#f5c542';
    ctx.beginPath();
    ctx.arc(fx, fy, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function furrows(ctx, ox, oy, P) {
  const [, dark, light] = P.farm;
  for (let y = 3; y < TS; y += 8) {
    ctx.fillStyle = hexA(dark, 0.75);
    ctx.fillRect(ox, oy + y, TS, 3);
    ctx.fillStyle = hexA(light, 0.55);
    ctx.fillRect(ox, oy + y + 3, TS, 1.5);
  }
}

function cracks(ctx, ox, oy, x, y) {
  ctx.strokeStyle = 'rgba(30,26,22,0.6)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const sx = ox + 4 + hash2(x, y, 40 + i) * 24;
    ctx.beginPath();
    ctx.moveTo(sx, oy + 6);
    ctx.lineTo(sx + (hash2(x, y, 50 + i) - 0.5) * 6, oy + 16);
    ctx.lineTo(sx + (hash2(x, y, 60 + i) - 0.5) * 8, oy + 28);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(ox, oy, TS, 4);
}

function glints(ctx, ox, oy, x, y, P) {
  if (hash2(x, y, 808) > 0.35) return;
  const gx = ox + 4 + hash2(x, y, 809) * 22;
  const gy = oy + 4 + hash2(x, y, 810) * 22;
  ctx.strokeStyle = hexA(P.water[2], 0.6);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.quadraticCurveTo(gx + 4, gy - 2, gx + 8, gy);
  ctx.stroke();
}
