/**
 * PaintFinish — brings older, flat-coloured art into the hand-painted style of the world (see GroundPainter,
 * PaintedNature, CharacterArt): colours toned towards the earthy palette, light from the top left and shade
 * to the bottom right, a painterly grain — and, for things that move about (animals, carts, trains), the same
 * thin ink outline the villagers have.
 *
 * finishFor(key) says which finish a texture gets (by its key); TextureFactory's addCanvas applies it to
 * everything it registers, so art drawn anywhere gets it without each drawing being rewritten.
 */
import { mulberry32 } from '../core/rng.js';

const OUTLINE = [38, 26, 20];

/** Which finish a texture key gets (null: already painted, or not art — glows, particles, markers). */
export function finishFor(key) {
  if (/^(deer|rabbit|chicken|sheep|cow)_/.test(key)) return { mute: 0.2, light: 1, grain: 1, outline: true };
  if (/^(porter|handcart|horse_cart|wagon|train_|eq_)/.test(key)) return { mute: 0.22, light: 1, grain: 1, outline: true };
  if (/^(decor_|furn_|pile_|plot_stake|owner_flag)/.test(key)) return { mute: 0.2, light: 1, grain: 1, outline: false };
  if (/^site_/.test(key)) return { mute: 0.2, light: 1, grain: 1, outline: false };
  if (key === 'pcrop_dead' || key === 'blueprint') return { mute: 0.15, light: 0.7, grain: 1, outline: false };
  return null;
}

/** Apply a finish to a canvas, in place. */
export function paintFinish(canvas, o = {}) {
  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return canvas;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  // 1. colours towards the earthy palette (luminance kept)
  if (o.mute) {
    const k = o.mute;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      d[i] = r * (1 - k) + (lum * 0.7 + 138 * 0.3) * k;
      d[i + 1] = g * (1 - k) + (lum * 0.7 + 122 * 0.3) * k;
      d[i + 2] = b * (1 - k) + (lum * 0.7 + 100 * 0.3) * k;
    }
    ctx.putImageData(img, 0, 0);
  }
  // 2. light from the top left, shade to the bottom right (only on the art itself)
  if (o.light) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `rgba(255,236,190,${0.2 * o.light})`);
    g.addColorStop(0.5, 'rgba(255,236,190,0)');
    g.addColorStop(1, `rgba(24,14,30,${0.22 * o.light})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // 3. a painterly grain
  if (o.grain) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const rnd = mulberry32(W * 31 + H * 7);
    for (let i = 0; i < (W * H) / 30; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(rnd() * W, rnd() * H, 1.5, 1.2);
    }
    ctx.restore();
  }
  // 4. the ink outline, round the solid parts only (not the soft shadow on the ground)
  if (o.outline) {
    const src = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = src[i * 4 + 3] > 150 ? 1 : 0;
    const out = ctx.createImageData(W, H);
    const od = out.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (mask[i]) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask[ny * W + nx]) {
              near = true;
              break;
            }
          }
        }
        if (!near) continue;
        od[i * 4] = OUTLINE[0];
        od[i * 4 + 1] = OUTLINE[1];
        od[i * 4 + 2] = OUTLINE[2];
        od[i * 4 + 3] = 225;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    tmp.getContext('2d').putImageData(out, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }
  return canvas;
}
