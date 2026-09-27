/**
 * PaintedFields — fields and gardens in the hand-painted style (see PaintedNature): tilled soil, your crops
 * at each stage (sprouts → the plant → ripe), and the village farms' grain.
 */
import { mulberry32 } from '../core/rng.js';
import { paintLeaves } from './PaintedNature.js';
import { shadeHex } from './PaintedBuildings.js';

const CROP_LOOK = {
  wheat: { leaf: '#6aa84f', ripe: '#e0bd55' },
  carrot: { leaf: '#4f9a3f', ripe: '#e8822a' },
  potato: { leaf: '#5f9e3f', ripe: '#c9a063' },
  cabbage: { leaf: '#7cbc58', ripe: '#a6d88a' },
  pumpkin: { leaf: '#4f8a3a', ripe: '#e0801e' },
};

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

function softShadow(ctx, x, y, rx, ry, a) {
  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.fillStyle = `rgba(20,30,10,${a})`;
  ctx.beginPath();
  ctx.ellipse(x + 1.5, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Tilled soil for your fields (32×32): dark, crumbly furrows — darker still when watered. */
export function paintSoil(wet) {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(wet ? 7100 : 7000);
  const base = wet ? '#4a321f' : '#76502f';
  ctx.fillStyle = base;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(1, 1, 30, 30, 6);
  else ctx.rect(1, 1, 30, 30);
  ctx.fill();
  for (let y = 4; y < 30; y += 7) {
    const g = ctx.createLinearGradient(0, y, 0, y + 5);
    g.addColorStop(0, shadeHex(base, 26));
    g.addColorStop(0.5, shadeHex(base, 6));
    g.addColorStop(1, shadeHex(base, -30));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(16, y + 2.5, 13.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rgba(rnd() < 0.5 ? shadeHex(base, 30) : shadeHex(base, -30), 0.6);
    ctx.fillRect(3 + rnd() * 26, 3 + rnd() * 26, 1.3, 1.3);
  }
  if (wet) {
    ctx.fillStyle = 'rgba(160,200,230,0.25)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(6 + rnd() * 20, 6 + rnd() * 20, 2.5, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function sprouts(ctx, xs, y, col) {
  for (const x of xs) {
    ctx.fillStyle = shadeHex(col, -20);
    ctx.fillRect(x, y - 3, 1.4, 4);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x - 1.5, y - 3.5, 2, 1.1, -0.5, 0, Math.PI * 2);
    ctx.ellipse(x + 2.5, y - 4, 2, 1.1, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function wheatStalks(ctx, xs, foot, h, stage, rnd, ripe = '#e0bd55', leaf = '#6aa84f') {
  for (const x0 of xs) {
    const x = x0 + (rnd() - 0.5) * 1.5;
    const hh = h * (0.85 + rnd() * 0.25);
    const lean = (rnd() - 0.5) * 3;
    ctx.strokeStyle = stage === 3 ? '#b8912e' : shadeHex(leaf, -10);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, foot);
    ctx.quadraticCurveTo(x + lean * 0.3, foot - hh * 0.5, x + lean, foot - hh);
    ctx.stroke();
    // a leaf halfway up
    ctx.strokeStyle = stage === 3 ? '#c9a23a' : leaf;
    ctx.beginPath();
    ctx.moveTo(x, foot - hh * 0.4);
    ctx.quadraticCurveTo(x + 3, foot - hh * 0.5, x + 5, foot - hh * 0.35);
    ctx.stroke();
    if (stage >= 2) {
      const head = stage === 3 ? ripe : '#9cc56a';
      const g = ctx.createLinearGradient(x + lean - 2, 0, x + lean + 2, 0);
      g.addColorStop(0, shadeHex(head, 30));
      g.addColorStop(1, shadeHex(head, -30));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x + lean, foot - hh - 3.5, 1.9, 4.2, lean * 0.08, 0, Math.PI * 2);
      ctx.fill();
      if (stage === 3) {
        ctx.strokeStyle = 'rgba(240,215,130,0.8)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x + lean, foot - hh - 7);
        ctx.lineTo(x + lean + 1.5, foot - hh - 11);
        ctx.stroke();
      }
    }
  }
}

/** Your crops (32×36, feet at the bottom): sprouts, then the plant, then ripe. */
export function paintPlayerCrop(crop, stage) {
  const c = canvas(32, 36);
  const ctx = c.getContext('2d');
  const L = CROP_LOOK[crop] || CROP_LOOK.wheat;
  const rnd = mulberry32(8000 + crop.length * 17 + stage);
  if (stage === 0) {
    sprouts(ctx, [9, 16, 23], 33, L.leaf);
    return c;
  }
  softShadow(ctx, 16, 32, 11, 3, 0.25);
  if (crop === 'wheat') {
    wheatStalks(ctx, [6, 9, 12, 15, 18, 21, 24, 27], 34, stage === 1 ? 10 : stage === 2 ? 18 : 23, stage, rnd, L.ripe, L.leaf);
    return c;
  }
  if (crop === 'cabbage' || crop === 'pumpkin') {
    const r = stage === 1 ? 5 : stage === 2 ? 7.5 : 9;
    const C = { dark: shadeHex(L.leaf, -45), mid: L.leaf, light: shadeHex(L.leaf, 30), hi: shadeHex(L.leaf, 60), rim: shadeHex(L.leaf, -70) };
    paintLeaves(ctx, [[16 - r * 0.8, 29 - r * 0.4, r * 0.75], [16 + r * 0.8, 29 - r * 0.4, r * 0.75], [16, 27 - r * 0.6, r * 0.85]], C, rnd);
    if (stage === 3 && crop === 'pumpkin') {
      const g = ctx.createRadialGradient(13, 23, 1, 16, 26, 10);
      g.addColorStop(0, '#ffb04a');
      g.addColorStop(1, '#b85a0e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(16, 26, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,50,5,0.6)';
      for (const x of [12, 16, 20]) {
        ctx.beginPath();
        ctx.ellipse(x, 26, 1.5, 6.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#4f6a2a';
      ctx.fillRect(15, 17, 2, 4);
    } else if (stage === 3) {
      const g = ctx.createRadialGradient(13, 22, 1, 16, 25, 8);
      g.addColorStop(0, '#e2f6c8');
      g.addColorStop(1, '#7fb95a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(16, 25, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,110,40,0.5)';
      ctx.beginPath();
      ctx.moveTo(16, 19);
      ctx.quadraticCurveTo(13, 25, 16, 31);
      ctx.stroke();
    }
    return c;
  }
  // carrot, potato: feathery leaves; the crop showing at the foot when ripe
  const h = stage === 1 ? 8 : stage === 2 ? 12 : 14;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.22;
    const len = h * (0.75 + rnd() * 0.35);
    ctx.strokeStyle = i % 2 ? L.leaf : shadeHex(L.leaf, 25);
    ctx.lineWidth = crop === 'potato' ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(16, 31);
    ctx.quadraticCurveTo(16 + Math.cos(a) * len * 0.6, 31 + Math.sin(a) * len * 0.5, 16 + Math.cos(a) * len, 31 + Math.sin(a) * len);
    ctx.stroke();
  }
  if (stage === 3) {
    const g = ctx.createLinearGradient(12, 29, 20, 34);
    g.addColorStop(0, shadeHex(L.ripe, 30));
    g.addColorStop(1, shadeHex(L.ripe, -30));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(16, 32, 5, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** The village farms' grain (32×40, feet at 34), by stage and season. */
export function paintFieldCrop(stage, season) {
  const c = canvas(32, 40);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(9000 + stage * 7 + season.length);
  if (season === 'winter' || stage === 0) {
    ctx.fillStyle = season === 'winter' ? 'rgba(255,255,255,0.8)' : 'rgba(60,38,20,0.6)';
    for (const x of [7, 13, 19, 25]) {
      ctx.beginPath();
      ctx.ellipse(x, 33, 2.5, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }
  if (stage === 1) {
    sprouts(ctx, [6, 12, 18, 24], 35, '#6fae4c');
    return c;
  }
  softShadow(ctx, 16, 33, 13, 3, 0.22);
  wheatStalks(ctx, [4, 7, 10, 13, 16, 19, 22, 25, 28], 35, stage === 2 ? 18 : 24, stage, rnd);
  return c;
}
