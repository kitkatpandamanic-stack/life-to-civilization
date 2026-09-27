/**
 * PaintedBuildings — the hand-painted finish for buildings (see GroundPainter, PaintedNature).
 *
 * TextureFactory.drawBuilding still lays a building out (walls, door, windows, roof, chimney — and where the
 * night lights and smoke go); these draw the surfaces in the painted style: roof tiles each with its own
 * light and shade, stones rounded and mortared, planks with grain, plaster with a painted texture — and
 * finishBuilding() adds the light over the whole of it: from the top left (as for the trees), shade low down
 * and on the right, and a painterly grain.
 */
import { mulberry32 } from '../core/rng.js';

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The roof's surface (already clipped to the roof's shape by the caller). */
export function roofSurface(ctx, W, top, bottom, def) {
  const rnd = mulberry32(W * 7 + bottom * 3 + (def.roof || '').length);
  const base = def.roofColor;
  if (def.roof === 'thatch') {
    // Layers of straw, each overhanging the one below.
    const layers = Math.max(3, Math.round((bottom - top) / 9));
    for (let i = 0; i < layers; i++) {
      const y0 = top + ((bottom - top) * i) / layers;
      const y1 = top + ((bottom - top) * (i + 1)) / layers;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, shadeHex(base, 18));
      g.addColorStop(0.8, base);
      g.addColorStop(1, shadeHex(base, -38));
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, W, y1 - y0 + 1);
      for (let k = 0; k < W * 0.9; k++) {
        const x = rnd() * W;
        const y = y0 + rnd() * (y1 - y0);
        ctx.strokeStyle = rgba(rnd() < 0.5 ? shadeHex(base, -40) : shadeHex(base, 34), 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 1.5, y + 3 + rnd() * 4);
        ctx.stroke();
      }
    }
    return;
  }
  if (def.roof === 'plank') {
    for (let x = 0; x < W; x += 9) {
      const g = ctx.createLinearGradient(x, 0, x + 9, 0);
      const t = shadeHex(base, Math.round((rnd() - 0.5) * 16));
      g.addColorStop(0, shadeHex(t, 16));
      g.addColorStop(1, shadeHex(t, -14));
      ctx.fillStyle = g;
      ctx.fillRect(x, top, 9, bottom - top);
      ctx.fillStyle = rgba(shadeHex(base, -50), 0.7);
      ctx.fillRect(x, top, 1, bottom - top);
      // grain
      ctx.strokeStyle = rgba(shadeHex(base, -30), 0.35);
      ctx.beginPath();
      ctx.moveTo(x + 3 + rnd() * 3, top);
      ctx.lineTo(x + 3 + rnd() * 3, bottom);
      ctx.stroke();
    }
    return;
  }
  // Clay tiles (rounded, overlapping) or slate (flat slabs).
  const slate = def.roof === 'slate';
  const rowH = slate ? 7 : 6;
  const tileW = slate ? 12 : 8;
  for (let y = bottom - rowH, row = 0; y > top - rowH; y -= rowH, row++) {
    const off = (row % 2) * (tileW / 2);
    for (let x = -tileW + off; x < W + tileW; x += tileW) {
      const t = shadeHex(base, Math.round((rnd() - 0.5) * (slate ? 22 : 18)));
      const g = ctx.createLinearGradient(x, y, x + tileW * 0.3, y + rowH);
      g.addColorStop(0, shadeHex(t, 20));
      g.addColorStop(0.6, t);
      g.addColorStop(1, shadeHex(t, -30));
      ctx.fillStyle = g;
      ctx.beginPath();
      if (slate) {
        ctx.rect(x + 0.5, y, tileW - 1, rowH + 1);
      } else {
        // a rounded bottom edge, like fired clay tiles
        ctx.moveTo(x, y);
        ctx.lineTo(x + tileW, y);
        ctx.lineTo(x + tileW, y + rowH - 2);
        ctx.quadraticCurveTo(x + tileW / 2, y + rowH + 2.5, x, y + rowH - 2);
      }
      ctx.closePath();
      ctx.fill();
      // shadow under the tile's edge
      ctx.fillStyle = rgba(shadeHex(base, -60), 0.45);
      ctx.fillRect(x, y + rowH, tileW, 1);
    }
  }
  // Moss and weathering on old roofs.
  for (let i = 0; i < W / 10; i++) {
    ctx.fillStyle = rgba(slate ? '#6f7f5a' : '#7d7a3e', 0.18 + rnd() * 0.12);
    ctx.beginPath();
    ctx.ellipse(rnd() * W, top + (bottom - top) * (0.3 + rnd() * 0.7), 2 + rnd() * 4, 1 + rnd() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Walls: stone, wood or plaster (with its timber frame) — the caller draws the outline. */
export function wallSurface(ctx, x, y, w, h, def) {
  const rnd = mulberry32(w * 3 + h * 5 + (def.wall || '').length);
  const base = def.wallColor;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  if (def.wall === 'stone') {
    ctx.fillStyle = shadeHex(base, -45); // mortar
    ctx.fillRect(x, y, w, h);
    for (let yy = y, row = 0; yy < y + h; yy += 8, row++) {
      const off = row % 2 ? 7 : 0;
      for (let xx = x - off; xx < x + w; xx += 14) {
        const sw = 12 + Math.round((rnd() - 0.5) * 3);
        const t = shadeHex(base, Math.round((rnd() - 0.5) * 26));
        const g = ctx.createLinearGradient(xx, yy, xx + sw * 0.4, yy + 7);
        g.addColorStop(0, shadeHex(t, 22));
        g.addColorStop(1, shadeHex(t, -18));
        ctx.fillStyle = g;
        ctx.beginPath();
        const sx = Math.max(x, xx + 1);
        const ex = Math.min(x + w, xx + 1 + sw);
        if (ex - sx > 2) {
          ctx.roundRect ? ctx.roundRect(sx, yy + 1, ex - sx, 6.5, 2.5) : ctx.rect(sx, yy + 1, ex - sx, 6.5);
          ctx.fill();
        }
      }
    }
  } else if (def.wall === 'wood') {
    for (let yy = y; yy < y + h; yy += 7) {
      const t = shadeHex(base, Math.round((rnd() - 0.5) * 18));
      const g = ctx.createLinearGradient(0, yy, 0, yy + 7);
      g.addColorStop(0, shadeHex(t, 16));
      g.addColorStop(0.7, t);
      g.addColorStop(1, shadeHex(t, -30));
      ctx.fillStyle = g;
      ctx.fillRect(x, yy, w, 7);
      // grain and knots
      ctx.strokeStyle = rgba(shadeHex(base, -40), 0.35);
      ctx.lineWidth = 0.8;
      for (let k = 0; k < w / 18; k++) {
        const gx = x + rnd() * w;
        ctx.beginPath();
        ctx.moveTo(gx, yy + 2 + rnd() * 3);
        ctx.lineTo(gx + 6 + rnd() * 10, yy + 2 + rnd() * 3);
        ctx.stroke();
      }
      if (rnd() < 0.3) {
        ctx.fillStyle = rgba(shadeHex(base, -50), 0.5);
        ctx.beginPath();
        ctx.ellipse(x + rnd() * w, yy + 3.5, 1.4, 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // Plaster: painted mottling, a little grime low down, and the timber frame.
    for (let i = 0; i < (w * h) / 60; i++) {
      ctx.fillStyle = rgba(rnd() < 0.5 ? shadeHex(base, 14) : shadeHex(base, -16), 0.18);
      ctx.beginPath();
      ctx.ellipse(x + rnd() * w, y + rnd() * h, 2 + rnd() * 5, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const beam = (bx, by, bw, bh) => {
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, '#7e5733');
      g.addColorStop(1, '#4e3219');
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
    };
    beam(x, y, 4, h);
    beam(x + w - 4, y, 4, h);
    beam(x, y + h - 4, w, 4);
    beam(x, y + 8, w, 3);
  }
  // Shade under the eaves, grime at the foot.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(30,18,8,0.35)');
  g.addColorStop(0.18, 'rgba(30,18,8,0)');
  g.addColorStop(0.82, 'rgba(30,18,8,0)');
  g.addColorStop(1, 'rgba(40,30,15,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** A window: painted frame, sill, glass with a reflection — and, on some, a flower box. */
export function paintedWindow(ctx, x, y, w, h, seed = 0) {
  const rnd = mulberry32(seed * 31 + x * 7 + y);
  // frame
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = 'rgba(60,40,20,0.35)';
  ctx.fillRect(x + w + 1, y - 1, 1, h + 3);
  // glass: sky reflected at the top, dark inside below
  const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  g.addColorStop(0, '#bfe0f0');
  g.addColorStop(0.45, '#6f9dbd');
  g.addColorStop(1, '#2f4f66');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(x + 1, y + h * 0.6);
  ctx.lineTo(x + w * 0.45, y + 1);
  ctx.lineTo(x + w * 0.6, y + 1);
  ctx.lineTo(x + 1, y + h * 0.85);
  ctx.closePath();
  ctx.fill();
  // glazing bars
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
  // sill
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x - 3, y + h + 2, w + 6, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 3, y + h + 5, w + 6, 1.5);
  // a flower box on some windows
  if (rnd() < 0.4) {
    ctx.fillStyle = '#6b4526';
    ctx.fillRect(x - 2, y + h + 4, w + 4, 4);
    const cols = ['#e05a6a', '#f2c14e', '#f58fb0', '#ffffff', '#b58af0'];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#4f8a36' : '#6aa845';
      ctx.beginPath();
      ctx.arc(x + 1 + (i * (w + 2)) / 6, y + h + 3.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.beginPath();
      ctx.arc(x + 1 + (i * (w + 2)) / 6 + 0.5, y + h + 2.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A door: planks with light on the left, an iron handle, a stone step. */
export function paintedDoor(ctx, dx, dy, doorW, doorH, wide) {
  ctx.fillStyle = '#3a2414';
  ctx.fillRect(dx - 2, dy - 3, doorW + 4, doorH + 3);
  const g = ctx.createLinearGradient(dx, 0, dx + doorW, 0);
  g.addColorStop(0, '#9a6236');
  g.addColorStop(0.5, '#7a4a2a');
  g.addColorStop(1, '#55321b');
  ctx.fillStyle = g;
  ctx.fillRect(dx, dy, doorW, doorH);
  ctx.fillStyle = 'rgba(40,20,8,0.55)';
  for (let x = dx + 4; x < dx + doorW; x += 5) ctx.fillRect(x, dy, 1, doorH);
  ctx.fillStyle = 'rgba(40,20,8,0.4)';
  ctx.fillRect(dx, dy + 5, doorW, 2);
  ctx.fillRect(dx, dy + doorH - 8, doorW, 2);
  if (wide) {
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(dx + doorW / 2 - 0.5, dy, 1, doorH);
  }
  ctx.fillStyle = '#d9b860';
  ctx.beginPath();
  ctx.arc(dx + doorW - 4, dy + doorH / 2, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // shade under the lintel
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(dx, dy, doorW, 3);
}

/**
 * The finishing pass over a whole building: light from the top left, shade on the right and low down,
 * and a painterly grain — only where the building is (its transparent surroundings stay clear).
 */
export function finishBuilding(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const lx = ctx.createLinearGradient(0, 0, W, 0);
  lx.addColorStop(0, 'rgba(255,236,190,0.16)');
  lx.addColorStop(0.5, 'rgba(255,236,190,0)');
  lx.addColorStop(1, 'rgba(20,12,30,0.16)');
  ctx.fillStyle = lx;
  ctx.fillRect(0, 0, W, H);
  const ly = ctx.createLinearGradient(0, 0, 0, H);
  ly.addColorStop(0, 'rgba(255,240,200,0.10)');
  ly.addColorStop(0.7, 'rgba(0,0,0,0)');
  ly.addColorStop(1, 'rgba(20,14,8,0.22)');
  ctx.fillStyle = ly;
  ctx.fillRect(0, 0, W, H);
  // grain
  const rnd = mulberry32(W * 13 + H);
  for (let i = 0; i < (W * H) / 40; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(rnd() * W, rnd() * H, 2, 1.5);
  }
  ctx.restore();
}
