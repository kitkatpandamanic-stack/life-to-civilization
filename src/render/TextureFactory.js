/**
 * TextureFactory — every texture in the game is drawn here with Canvas2D.
 * No image files are needed; the look is controlled entirely by code and
 * colour palettes, which makes it easy to add seasonal variants.
 *
 * Call createAllTextures(scene) once at boot.
 */
import { T, TILE_COUNT } from '../world/WorldGenerator.js';
import { BUILDING_TYPES, HOUSE_VARIANTS } from '../data/buildings.js';
import { mulberry32 } from '../core/rng.js';

const TS = 32;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const PALETTE = {
  spring: { grass: ['#78b85a', '#71b053', '#80bf62'], blade: '#5e9a45', light: '#9ed27e', forest: '#5d9444', flowers: ['#f7e26b', '#ffffff', '#f59ac0', '#b9a3f0'] },
  summer: { grass: ['#6aac47', '#63a342', '#71b34c'], blade: '#4f8c37', light: '#8cc76a', forest: '#4d853a', flowers: ['#ffd23f', '#ff7b54', '#ffffff', '#e05a8a'] },
  autumn: { grass: ['#a3a352', '#9a9a4a', '#abaa58'], blade: '#86833c', light: '#c2bd6c', forest: '#8a7c3c', flowers: ['#e9a23b', '#c95d2e', '#f4d35e'], leaf: ['#d9822b', '#c4491f', '#e8b83a'] },
  winter: { grass: ['#e8eef3', '#e1e8ee', '#eef3f7'], blade: '#c9d5de', light: '#ffffff', forest: '#d3dce3', flowers: ['#ffffff', '#dfe8ee'], snow: true },
};

// ---------------------------------------------------------------- helpers

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function addCanvas(scene, key, canvas) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.addCanvas(key, canvas);
}

// ---------------------------------------------------------------- tiles

/** Draws all terrain tiles for a season into one horizontal strip (the tileset). */
export function paintTileset(canvas, season) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < TILE_COUNT; i++) paintTile(ctx, i * TS, i, season);
}

function paintTile(ctx, ox, id, season) {
  const P = PALETTE[season];
  const rnd = mulberry32(id * 7919 + 13);
  const snow = !!P.snow;
  const fill = (c) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox, 0, TS, TS);
  };
  const dots = (colors, n, size = 2) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.fillRect(ox + Math.floor(rnd() * (TS - size)), Math.floor(rnd() * (TS - size)), size, size);
    }
  };
  const blades = (color, n) => {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = ox + 1 + Math.floor(rnd() * (TS - 3));
      const y = 1 + Math.floor(rnd() * (TS - 5));
      ctx.fillRect(x, y, 1, 3);
      ctx.fillRect(x + 1, y + 1, 1, 3);
    }
  };

  switch (id) {
    case T.GRASS:
    case T.GRASS2:
    case T.GRASS3:
      fill(P.grass[id - T.GRASS]);
      dots([P.light, P.blade], 12);
      blades(P.blade, 6);
      if (P.leaf) dots(P.leaf, 3);
      break;
    case T.FLOWERS:
      fill(P.grass[0]);
      dots([P.light, P.blade], 10);
      blades(P.blade, 4);
      for (let i = 0; i < 4; i++) {
        const x = ox + 4 + Math.floor(rnd() * 24);
        const y = 4 + Math.floor(rnd() * 24);
        ctx.fillStyle = P.flowers[Math.floor(rnd() * P.flowers.length)];
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.fillStyle = snow ? '#ffffff' : '#f5c542';
        ctx.fillRect(x, y, 1, 1);
      }
      break;
    case T.FOREST:
      fill(P.forest);
      dots([shade(P.forest, -16), shade(P.forest, 12)], 22);
      if (!snow) dots(['#6b5234', '#7a6040'], 5);
      if (P.leaf) dots(P.leaf, 7);
      break;
    case T.DIRT:
      fill(snow ? '#d9d5cd' : '#a98459');
      dots(snow ? ['#c4beb2', '#ffffff'] : ['#8f6d47', '#bf9a6b'], 16);
      break;
    case T.ROAD:
      fill(snow ? '#d0cabf' : '#b5946a');
      dots(snow ? ['#bdb6aa', '#ffffff', '#a8a298'] : ['#9c7b54', '#c9aa80', '#8f8b85'], 24);
      break;
    case T.SAND:
      fill(snow ? '#ece9e2' : '#dcc88f');
      dots(snow ? ['#ffffff', '#d8d4ca'] : ['#c9b27a', '#eadba8'], 18);
      break;
    case T.WATER:
    case T.DEEP: {
      const deep = id === T.DEEP;
      fill(snow ? (deep ? '#6f9fc4' : '#88b6d6') : deep ? '#2f6fb0' : '#3f86c9');
      ctx.strokeStyle = snow ? '#c3dff0' : deep ? '#4b8fcf' : '#74b3e6';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const x = ox + 4 + rnd() * 20;
        const y = 5 + rnd() * 22;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 3, y - 2, x + 6, y);
        ctx.stroke();
      }
      break;
    }
    case T.MOUNTAIN:
      fill(snow ? '#dddcd8' : '#8f897b');
      dots(snow ? ['#c9c7c1', '#ffffff'] : ['#7a7466', '#a39d8f', '#6e695d'], 26);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = snow ? '#b9b7b0' : '#6f6a5e';
        ctx.fillRect(ox + Math.floor(rnd() * 27), Math.floor(rnd() * 28), 4, 3);
      }
      break;
    case T.CLIFF:
      fill('#5f5a52');
      ctx.fillStyle = snow ? '#f2f4f6' : '#7d776c';
      ctx.fillRect(ox, 0, TS, 5);
      ctx.fillStyle = '#4a463f';
      for (let i = 0; i < 4; i++) ctx.fillRect(ox + 3 + Math.floor(rnd() * 26), 7 + Math.floor(rnd() * 8), 1, 8 + Math.floor(rnd() * 10));
      dots(['#6b665d', '#534f48'], 14);
      break;
    case T.FARMLAND:
      fill(snow ? '#dcd6cc' : '#7b5436');
      for (let y = 3; y < TS; y += 8) {
        ctx.fillStyle = snow ? '#c3bbb0' : '#634228';
        ctx.fillRect(ox, y, TS, 3);
        ctx.fillStyle = snow ? '#ffffff' : '#8f6645';
        ctx.fillRect(ox, y + 3, TS, 1);
      }
      break;
    case T.BRIDGE:
      fill('#9b6b3f');
      ctx.fillStyle = '#6e4a2a';
      for (let x = 0; x < TS; x += 8) ctx.fillRect(ox + x, 0, 1, TS);
      ctx.fillStyle = '#b58250';
      for (let x = 2; x < TS; x += 8) ctx.fillRect(ox + x, 0, 1, TS);
      ctx.fillStyle = '#4a3320';
      for (let x = 4; x < TS; x += 8) {
        ctx.fillRect(ox + x, 3, 1, 1);
        ctx.fillRect(ox + x, 28, 1, 1);
      }
      if (snow) dots(['#ffffff'], 10);
      break;
    case T.PLAZA: {
      fill('#8c867b');
      const stones = ['#b3ada2', '#a9a398', '#bcb6ab', '#a39d91'];
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let x = -off; x < TS; x += 8) {
          ctx.fillStyle = stones[Math.floor(rnd() * stones.length)];
          const sx = Math.max(ox, ox + x + 1);
          const ex = Math.min(ox + TS, ox + x + 8);
          ctx.fillRect(sx, row * 8 + 1, ex - sx - 1, 6);
        }
      }
      if (snow) dots(['#ffffff', '#eef2f5'], 22);
      break;
    }
    default:
      fill('#ff00ff');
  }
}

// ---------------------------------------------------------------- nature

function drawOak(season) {
  const c = makeCanvas(64, 80);
  const ctx = c.getContext('2d');
  ellipse(ctx, 32, 74, 20, 6, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(27, 44, 10, 31);
  ctx.fillStyle = '#553a22';
  ctx.fillRect(33, 44, 4, 31);
  ctx.fillStyle = '#6b4a2b';
  ctx.beginPath();
  ctx.moveTo(22, 76);
  ctx.lineTo(27, 66);
  ctx.lineTo(37, 66);
  ctx.lineTo(42, 76);
  ctx.fill();

  if (season === 'winter') {
    ctx.strokeStyle = '#5b3f25';
    ctx.lineCap = 'round';
    const branches = [[32, 48, 14, 22, 4], [32, 46, 50, 20, 4], [32, 44, 32, 8, 4], [24, 32, 12, 14, 2], [42, 30, 54, 12, 2], [32, 26, 22, 10, 2], [32, 24, 42, 8, 2]];
    for (const [x1, y1, x2, y2, w] of branches) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    for (const [x1, y1, x2, y2] of branches) {
      ctx.beginPath();
      ctx.moveTo(x1 + (x2 - x1) * 0.4, y1 + (y2 - y1) * 0.4 - 1);
      ctx.lineTo(x2, y2 - 1);
      ctx.stroke();
    }
    return c;
  }
  const cols = {
    spring: ['#5a9c40', '#6fb552', '#94d272'],
    summer: ['#2f6d2a', '#3f8a37', '#5aa84a'],
    autumn: ['#b5541d', '#d9822b', '#f0b24a'],
  }[season];
  for (const [x, y, r] of [[32, 36, 22], [15, 42, 13], [49, 42, 13]]) circle(ctx, x, y, r, cols[0]);
  for (const [x, y, r] of [[32, 30, 20], [18, 34, 12], [46, 34, 12], [25, 18, 12], [40, 18, 12]]) circle(ctx, x, y, r, cols[1]);
  for (const [x, y, r] of [[24, 20, 7], [37, 13, 5], [15, 32, 5], [45, 27, 4]]) circle(ctx, x, y, r, cols[2]);
  const rnd = mulberry32(season.length * 31);
  if (season === 'spring') {
    for (let i = 0; i < 14; i++) circle(ctx, 12 + rnd() * 40, 10 + rnd() * 36, 1.6, i % 3 ? '#f7c6d9' : '#ffffff');
  }
  if (season === 'autumn') {
    for (let i = 0; i < 6; i++) circle(ctx, 14 + rnd() * 36, 70 + rnd() * 8, 1.5, rnd() < 0.5 ? '#d9822b' : '#c4491f');
  }
  return c;
}

function drawPine(season) {
  const c = makeCanvas(48, 84);
  const ctx = c.getContext('2d');
  ellipse(ctx, 24, 79, 15, 5, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = '#5b3f25';
  ctx.fillRect(21, 62, 6, 18);
  const dark = season === 'autumn' ? '#2e5f3a' : '#2f6b3f';
  const light = season === 'autumn' ? '#437a4c' : '#3f8a52';
  const tiers = [[24, 4, 7, 34], [24, 17, 4, 50], [24, 31, 1, 67]];
  for (const [tx, ty, lx, by] of tiers) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(lx, by);
    ctx.lineTo(48 - lx, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(lx, by);
    ctx.lineTo(tx, by - 3);
    ctx.closePath();
    ctx.fill();
    if (season === 'winter') {
      ctx.fillStyle = '#f4f8fb';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - (tx - lx) * 0.45, ty + (by - ty) * 0.45);
      ctx.lineTo(tx + (tx - lx) * 0.45, ty + (by - ty) * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }
  return c;
}

function drawStump(season) {
  const c = makeCanvas(32, 28);
  const ctx = c.getContext('2d');
  ellipse(ctx, 16, 23, 11, 4, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(9, 12, 14, 11);
  ellipse(ctx, 16, 23, 7, 2.5, '#6b4a2b');
  ellipse(ctx, 16, 12, 7, 3, season === 'winter' ? '#f2f5f8' : '#c9a06a');
  if (season !== 'winter') {
    ctx.strokeStyle = '#a67c4c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(16, 12, 4, 1.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  return c;
}

const ROCK_POLY = [[4, 24], [2, 16], [8, 7], [17, 3], [27, 6], [33, 14], [32, 24], [20, 28]];

function drawRock(variant, season) {
  const c = makeCanvas(36, 32);
  const ctx = c.getContext('2d');
  ellipse(ctx, 18, 27, 16, 4, 'rgba(0,0,0,0.22)');
  const base = variant === 'coal' ? '#6a6a6a' : variant === 'iron' ? '#8d847c' : '#8e8e8a';
  ctx.fillStyle = base;
  ctx.beginPath();
  ROCK_POLY.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,30,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = shade(base, -28);
  ctx.beginPath();
  ctx.moveTo(4, 24);
  ctx.lineTo(20, 28);
  ctx.lineTo(32, 24);
  ctx.lineTo(33, 17);
  ctx.lineTo(18, 21);
  ctx.lineTo(3, 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(base, 30);
  ctx.beginPath();
  ctx.moveTo(9, 9);
  ctx.lineTo(17, 5);
  ctx.lineTo(22, 7);
  ctx.lineTo(13, 13);
  ctx.closePath();
  ctx.fill();
  const rnd = mulberry32(variant.length * 17);
  if (variant === 'iron') {
    for (let i = 0; i < 7; i++) circle(ctx, 7 + rnd() * 22, 8 + rnd() * 14, 1.8 + rnd(), i % 2 ? '#c0703d' : '#d9955a');
  } else if (variant === 'coal') {
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(6 + rnd() * 22, 7 + rnd() * 14, 4, 3);
      ctx.fillStyle = '#5a5a66';
      ctx.fillRect(7 + rnd() * 20, 8 + rnd() * 12, 1, 1);
    }
  }
  if (season === 'winter') {
    ctx.fillStyle = '#f4f8fb';
    ctx.beginPath();
    ctx.moveTo(6, 10);
    ctx.lineTo(17, 4);
    ctx.lineTo(28, 7);
    ctx.lineTo(24, 11);
    ctx.lineTo(12, 12);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function drawRubble(season) {
  const c = makeCanvas(32, 20);
  const ctx = c.getContext('2d');
  for (const [x, y, r] of [[8, 13, 4], [17, 10, 5], [25, 14, 4], [14, 15, 3]]) {
    ellipse(ctx, x, y + 2, r, r * 0.5, 'rgba(0,0,0,0.15)');
    circle(ctx, x, y, r, season === 'winter' ? '#d9dadb' : '#8a8a86');
    circle(ctx, x - 1, y - 1, r * 0.45, season === 'winter' ? '#ffffff' : '#a9a9a4');
  }
  return c;
}

function drawBush(full, season) {
  const c = makeCanvas(32, 28);
  const ctx = c.getContext('2d');
  ellipse(ctx, 16, 24, 13, 4, 'rgba(0,0,0,0.2)');
  if (season === 'winter') {
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 1.5;
    for (const [x, y] of [[6, 8], [12, 4], [20, 5], [26, 9], [16, 3]]) {
      ctx.beginPath();
      ctx.moveTo(16, 23);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ellipse(ctx, 16, 8, 8, 2, '#f4f8fb');
    return c;
  }
  const g = season === 'autumn' ? ['#7a7a30', '#95903c', '#b0a950'] : ['#3d7a33', '#4f8f3f', '#6aaa55'];
  for (const [x, y, r] of [[10, 16, 8], [22, 16, 8], [16, 11, 9]]) circle(ctx, x, y, r, g[0]);
  for (const [x, y, r] of [[11, 14, 6], [21, 14, 6], [16, 9, 7]]) circle(ctx, x, y, r, g[1]);
  circle(ctx, 13, 7, 3, g[2]);
  if (full) {
    for (const [x, y] of [[8, 13], [14, 17], [20, 10], [24, 16], [12, 8], [18, 15], [22, 20]]) {
      circle(ctx, x, y, 2.2, '#c93a3a');
      circle(ctx, x - 0.7, y - 0.7, 0.8, '#ff9a9a');
    }
  }
  return c;
}

function drawCrop(stage, season) {
  const c = makeCanvas(32, 40);
  const ctx = c.getContext('2d');
  ellipse(ctx, 16, 34, 12, 4, season === 'winter' ? '#e6e2da' : '#6a472c');
  if (season === 'winter' || stage === 0) {
    ctx.fillStyle = season === 'winter' ? '#ffffff' : '#5a3b22';
    for (const x of [8, 14, 20, 25]) ctx.fillRect(x, 32, 2, 2);
    return c;
  }
  const stalk = stage === 3 ? '#c9a23a' : '#5f9e3f';
  const tip = stage === 3 ? '#e8c65a' : '#7cbc58';
  const height = stage === 1 ? 7 : stage === 2 ? 18 : 24;
  for (const x of [7, 11, 15, 19, 23, 26]) {
    const h = height - ((x * 7) % 5);
    ctx.strokeStyle = stalk;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 34);
    ctx.lineTo(x + (x % 3) - 1, 34 - h);
    ctx.stroke();
    if (stage === 3) {
      ctx.fillStyle = tip;
      rrect(ctx, x + (x % 3) - 2.5, 34 - h - 6, 3, 7, 1.5);
      ctx.fill();
    } else if (stage === 2) {
      ctx.fillStyle = tip;
      ctx.fillRect(x + (x % 3) - 2, 34 - h + 4, 3, 2);
    }
  }
  return c;
}

// ---------------------------------------------------------------- buildings

/**
 * Draws a building. Returns the canvas plus positions (relative to the
 * top-left of the sprite) of windows (for night lights) and the chimney (smoke).
 */
export function drawBuilding(type, variant = 0) {
  const def = { ...BUILDING_TYPES[type] };
  if (type === 'house') Object.assign(def, HOUSE_VARIANTS[variant % HOUSE_VARIANTS.length]);
  const W = def.w * TS;
  const extra = 30;
  const H = def.h * TS + extra;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const windows = [];
  let chimney = null;

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(6, H - 7, W - 6, 7);

  if (def.wall === 'open') {
    drawOpenShed(ctx, W, H, def);
    return { canvas: c, windows, chimney };
  }

  const wallH = Math.min(62, Math.max(40, Math.round(def.h * TS * 0.48)));
  const wallTop = H - wallH - 6;
  const roofBottom = wallTop + 8;

  drawWall(ctx, 3, wallTop, W - 6, wallH, def);
  // Foundation
  ctx.fillStyle = '#6f6a62';
  ctx.fillRect(1, H - 7, W - 2, 7);
  ctx.fillStyle = '#5c5750';
  for (let x = 4; x < W; x += 12) ctx.fillRect(x, H - 7, 1, 7);

  // Door
  const doorW = def.wideDoor ? 22 : 16;
  const doorH = Math.min(30, wallH - 10);
  const dx = Math.round(W / 2 - doorW / 2);
  const dy = H - 7 - doorH;
  ctx.fillStyle = '#3e2716';
  ctx.fillRect(dx - 2, dy - 3, doorW + 4, doorH + 3);
  ctx.fillStyle = '#7a4a2a';
  ctx.fillRect(dx, dy, doorW, doorH);
  ctx.fillStyle = '#6a3f23';
  for (let x = dx + 4; x < dx + doorW; x += 5) ctx.fillRect(x, dy, 1, doorH);
  if (def.wideDoor) {
    ctx.fillStyle = '#3e2716';
    ctx.fillRect(dx + doorW / 2 - 0.5, dy, 1, doorH);
  }
  circle(ctx, dx + doorW - 4, dy + doorH / 2, 1.5, '#e0c060');

  // Windows (evenly spaced either side of the door)
  const winW = 16;
  const winH = 13;
  const wy = wallTop + 14;
  const leftSpan = [10, dx - 8];
  const rightSpan = [dx + doorW + 8, W - 10];
  for (const [a, b] of [leftSpan, rightSpan]) {
    const span = b - a;
    const n = span >= 72 ? 2 : span >= winW + 4 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(a + (span * (i + 0.5)) / n - winW / 2);
      drawWindow(ctx, x, wy, winW, winH);
      windows.push({ x, y: wy, w: winW, h: winH });
    }
  }

  // Sign
  if (def.sign) {
    let sx = W / 2 - 14;
    let sy = dy - 21;
    if (sy < wallTop + 9) {
      sx = dx + doorW + 4;
      sy = dy + 2;
    }
    ctx.fillStyle = '#5a3a20';
    rrect(ctx, sx - 1, sy - 1, 30, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#a57846';
    rrect(ctx, sx, sy, 28, 16, 3);
    ctx.fill();
    ctx.font = `12px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.sign, sx + 14, sy + 9);
  }

  // Roof
  drawRoof(ctx, W, roofBottom, def);

  if (def.chimney) {
    const cx = Math.round(W * 0.72);
    ctx.fillStyle = '#8a4b3a';
    ctx.fillRect(cx, 6, 11, 22);
    ctx.fillStyle = '#6e3a2d';
    ctx.fillRect(cx + 7, 6, 4, 22);
    ctx.fillStyle = '#4a3029';
    ctx.fillRect(cx - 1, 3, 13, 5);
    chimney = { x: cx + 5, y: 2 };
  }
  if (def.flag) {
    const fx = Math.round(W * 0.3);
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(fx, 0, 2, 26);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(fx + 2, 1);
    ctx.lineTo(fx + 18, 5);
    ctx.lineTo(fx + 2, 10);
    ctx.fill();
  }
  return { canvas: c, windows, chimney };
}

function drawWall(ctx, x, y, w, h, def) {
  ctx.fillStyle = def.wallColor;
  ctx.fillRect(x, y, w, h);
  if (def.wall === 'wood') {
    for (let yy = y + 4; yy < y + h; yy += 7) {
      ctx.fillStyle = shade(def.wallColor, -22);
      ctx.fillRect(x, yy, w, 1);
      ctx.fillStyle = shade(def.wallColor, 14);
      ctx.fillRect(x, yy + 1, w, 1);
    }
  } else if (def.wall === 'stone') {
    const rnd = mulberry32(w * 3 + h);
    for (let yy = y; yy < y + h; yy += 8) {
      const off = ((yy - y) / 8) % 2 ? 7 : 0;
      for (let xx = x - off; xx < x + w; xx += 14) {
        ctx.fillStyle = shade(def.wallColor, Math.round(rnd() * 24 - 12));
        const sx = Math.max(x, xx + 1);
        const ex = Math.min(x + w, xx + 14);
        if (ex > sx) ctx.fillRect(sx, yy + 1, ex - sx - 1, 6);
      }
    }
  } else {
    // Plaster with a timber frame.
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x, y, 4, h);
    ctx.fillRect(x + w - 4, y, 4, h);
    ctx.fillRect(x, y + h - 4, w, 4);
    ctx.fillRect(x, y + 8, w, 3);
  }
  ctx.strokeStyle = 'rgba(40,25,15,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawWindow(ctx, x, y, w, h) {
  ctx.fillStyle = '#f1e6cf';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#a9d3ec');
  g.addColorStop(1, '#5e8fb3');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f1e6cf';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x - 3, y + h + 2, w + 6, 3);
}

function drawRoof(ctx, W, bottom, def) {
  const top = 4;
  const inset = 5;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, shade(def.roofColor, 26));
  g.addColorStop(1, shade(def.roofColor, -18));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(inset, top);
  ctx.lineTo(W - inset, top);
  ctx.lineTo(W, bottom);
  ctx.lineTo(0, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  const rnd = mulberry32(W + bottom);
  if (def.roof === 'thatch') {
    for (let i = 0; i < W * 2.2; i++) {
      const x = rnd() * W;
      const y = top + rnd() * (bottom - top);
      ctx.strokeStyle = rnd() < 0.5 ? shade(def.roofColor, -30) : shade(def.roofColor, 25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1, y + 5);
      ctx.stroke();
    }
  } else if (def.roof === 'plank') {
    for (let x = 0; x < W; x += 9) {
      ctx.fillStyle = shade(def.roofColor, -30);
      ctx.fillRect(x, top, 1, bottom - top);
    }
  } else {
    const rowH = def.roof === 'slate' ? 7 : 6;
    const tileW = def.roof === 'slate' ? 12 : 8;
    for (let y = top + 4, row = 0; y < bottom; y += rowH, row++) {
      ctx.fillStyle = shade(def.roofColor, -34);
      ctx.fillRect(0, y, W, 1);
      for (let x = (row % 2) * (tileW / 2); x < W; x += tileW) ctx.fillRect(x, y - rowH + 1, 1, rowH - 1);
    }
  }
  ctx.restore();
  // Ridge and eave
  ctx.fillStyle = shade(def.roofColor, 40);
  ctx.fillRect(inset, top, W - inset * 2, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(2, bottom, W - 4, 4);
  ctx.strokeStyle = 'rgba(30,20,15,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(inset, top);
  ctx.lineTo(W - inset, top);
  ctx.lineTo(W, bottom);
  ctx.lineTo(0, bottom);
  ctx.closePath();
  ctx.stroke();
}

function drawOpenShed(ctx, W, H, def) {
  const roofBottom = H - 56;
  ctx.fillStyle = '#4b3a2a';
  ctx.fillRect(6, roofBottom, W - 12, H - roofBottom - 8);
  // Stacked logs inside
  for (let row = 0; row < 3; row++) {
    for (let x = 16 + (row % 2) * 6; x < W - 16; x += 12) {
      const y = H - 16 - row * 10;
      circle(ctx, x, y, 5.5, '#8a5f3a');
      circle(ctx, x, y, 4, '#c99a62');
      ctx.strokeStyle = '#a07040';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#5a3f28';
  for (const x of [5, W / 2 - 3, W - 11]) ctx.fillRect(x, roofBottom, 6, H - roofBottom - 4);
  drawRoof(ctx, W, roofBottom, def);
  if (def.sign) {
    const sx = W / 2 - 14;
    const sy = roofBottom - 4;
    ctx.fillStyle = '#5a3a20';
    rrect(ctx, sx - 1, sy - 1, 30, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#a57846';
    rrect(ctx, sx, sy, 28, 16, 3);
    ctx.fill();
    ctx.font = `12px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.sign, sx + 14, sy + 9);
  }
}

// ---------------------------------------------------------------- decorations

const DECOR_DRAW = {
  well(ctx) {
    ellipse(ctx, 20, 44, 17, 4, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#8d8a84';
    ctx.fillRect(5, 26, 30, 17);
    ctx.fillStyle = '#76736d';
    for (let x = 5; x < 35; x += 8) ctx.fillRect(x, 26, 1, 17);
    ctx.fillRect(5, 34, 30, 1);
    ellipse(ctx, 20, 26, 15, 5, '#a3a09a');
    ellipse(ctx, 20, 26, 11, 3.5, '#2d4a63');
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(6, 6, 3, 22);
    ctx.fillRect(31, 6, 3, 22);
    ctx.fillRect(6, 11, 28, 2);
    ctx.fillStyle = '#8f3b2e';
    ctx.beginPath();
    ctx.moveTo(2, 8);
    ctx.lineTo(20, 0);
    ctx.lineTo(38, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(18, 13, 5, 6);
  },
  notice_board(ctx) {
    ellipse(ctx, 20, 45, 15, 3, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#5b3f25';
    ctx.fillRect(7, 14, 3, 32);
    ctx.fillRect(30, 14, 3, 32);
    ctx.fillStyle = '#9a7048';
    ctx.fillRect(3, 10, 34, 24);
    ctx.strokeStyle = '#5b3f25';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 10, 34, 24);
    for (const [x, y, w, h, col] of [[6, 13, 9, 11, '#f4efe2'], [17, 12, 8, 9, '#f7e6a8'], [27, 14, 7, 12, '#f4efe2'], [10, 25, 11, 7, '#e8f0f4'], [23, 24, 10, 8, '#f4efe2']]) {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(x + w / 2 - 1, y, 2, 2);
    }
    ctx.fillStyle = '#6e3a2d';
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(20, 3);
    ctx.lineTo(40, 11);
    ctx.closePath();
    ctx.fill();
  },
  stall(ctx, variant) {
    const stripe = variant ? '#3f6fa3' : '#b5483b';
    ellipse(ctx, 32, 53, 30, 3, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(4, 14, 3, 40);
    ctx.fillRect(57, 14, 3, 40);
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(2, 34, 60, 14);
    ctx.fillStyle = '#6e4e30';
    ctx.fillRect(2, 44, 60, 4);
    const goods = variant ? ['#d94f3a', '#e8c65a', '#6aaa55', '#d94f3a'] : ['#e0a050', '#c97a3a', '#f0d27a', '#8fbf5a'];
    for (let i = 0; i < 9; i++) circle(ctx, 8 + i * 6, 32, 3.2, goods[i % goods.length]);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#f4efe2' : stripe;
      ctx.beginPath();
      ctx.moveTo(i * 8, 6);
      ctx.lineTo(i * 8 + 8, 6);
      ctx.lineTo(i * 8 + 8, 20);
      ctx.lineTo(i * 8, 20);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(i * 8 + 4, 20, 4, 0, Math.PI);
      ctx.fill();
    }
  },
  lamp(ctx) {
    ellipse(ctx, 8, 50, 6, 2, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(7, 12, 3, 38);
    ctx.fillRect(4, 48, 9, 3);
    ctx.fillStyle = '#2e2e33';
    ctx.fillRect(3, 3, 11, 11);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(5, 5, 7, 7);
    ctx.fillStyle = '#2e2e33';
    ctx.fillRect(2, 1, 13, 3);
  },
  fence(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 21, 32, 3);
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(0, 8, 32, 3);
    ctx.fillRect(0, 15, 32, 3);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(2, 4, 4, 18);
    ctx.fillRect(26, 4, 4, 18);
  },
  fence_v(ctx) {
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(13, 0, 3, 32);
    ctx.fillRect(18, 0, 3, 32);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(12, 12, 10, 10);
  },
  barrel(ctx) {
    ellipse(ctx, 12, 26, 10, 3, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#8a5a32';
    rrect(ctx, 3, 4, 18, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(3, 9, 18, 2);
    ctx.fillRect(3, 19, 18, 2);
    ellipse(ctx, 12, 5, 8, 2.5, '#a57040');
  },
  crate(ctx) {
    ellipse(ctx, 13, 25, 12, 3, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#a07845';
    ctx.fillRect(2, 4, 22, 20);
    ctx.strokeStyle = '#6e4e2a';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 4, 22, 20);
    ctx.beginPath();
    ctx.moveTo(2, 4);
    ctx.lineTo(24, 24);
    ctx.stroke();
  },
  anvil(ctx) {
    ellipse(ctx, 15, 22, 13, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#5b3f25';
    ctx.fillRect(9, 12, 12, 10);
    ctx.fillStyle = '#3d3f45';
    ctx.fillRect(3, 5, 22, 6);
    ctx.beginPath();
    ctx.moveTo(25, 5);
    ctx.lineTo(30, 7);
    ctx.lineTo(25, 10);
    ctx.fill();
    ctx.fillStyle = '#6a6d75';
    ctx.fillRect(4, 5, 20, 2);
  },
  logpile(ctx) {
    ellipse(ctx, 32, 33, 30, 3, 'rgba(0,0,0,0.2)');
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        const x = 10 + row * 5 + i * 11;
        const y = 26 - row * 9;
        circle(ctx, x, y, 5.5, '#7a5230');
        circle(ctx, x, y, 4, '#c99a62');
      }
    }
  },
  hay(ctx) {
    ellipse(ctx, 15, 24, 13, 3, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#d9b45a';
    rrect(ctx, 2, 5, 26, 18, 4);
    ctx.fill();
    ctx.strokeStyle = '#b08a3a';
    for (let x = 5; x < 28; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x - 1, 22);
      ctx.stroke();
    }
    ctx.fillStyle = '#8a6a2a';
    ctx.fillRect(2, 11, 26, 2);
  },
  signpost(ctx) {
    ellipse(ctx, 14, 42, 8, 2, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(12, 6, 4, 36);
    ctx.fillStyle = '#a57846';
    ctx.beginPath();
    ctx.moveTo(2, 8);
    ctx.lineTo(22, 8);
    ctx.lineTo(27, 12);
    ctx.lineTo(22, 16);
    ctx.lineTo(2, 16);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(26, 20);
    ctx.lineTo(6, 20);
    ctx.lineTo(1, 24);
    ctx.lineTo(6, 28);
    ctx.lineTo(26, 28);
    ctx.fill();
  },
};

const DECOR_SIZE = {
  well: [40, 48], notice_board: [40, 48], stall: [64, 56], lamp: [16, 52], fence: [32, 24], fence_v: [32, 32],
  barrel: [24, 28], crate: [26, 26], anvil: [32, 24], logpile: [64, 36], hay: [30, 26], signpost: [28, 44],
};

function drawTuft(season) {
  const c = makeCanvas(12, 10);
  const ctx = c.getContext('2d');
  const col = { spring: '#5e9a45', summer: '#4a8a36', autumn: '#8a8238', winter: '#b8c8d4' }[season];
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.2;
  for (const [x, lean] of [[3, -2], [6, 0], [9, 2], [5, -1], [7, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x + lean, 2 + Math.abs(lean));
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------- effects & UI

function radial(size, inner, outer) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function simple(w, h, fn) {
  const c = makeCanvas(w, h);
  fn(c.getContext('2d'));
  return c;
}

// ---------------------------------------------------------------- item icons

const ICON_DRAW = {
  wood(ctx) {
    for (const [x, y] of [[7, 20], [17, 20], [12, 12]]) {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x - 6, y - 4, 16, 8);
      circle(ctx, x + 10, y, 4.5, '#c99a62');
      circle(ctx, x + 10, y, 2, '#a07040');
    }
  },
  stone(ctx) {
    circle(ctx, 12, 19, 8, '#8e8e8a');
    circle(ctx, 21, 20, 7, '#7a7a76');
    circle(ctx, 16, 12, 6, '#a3a39e');
    circle(ctx, 14, 10, 2, '#c6c6c0');
  },
  iron_ore(ctx) {
    circle(ctx, 16, 17, 10, '#8d847c');
    for (const [x, y] of [[11, 13], [19, 15], [14, 21], [21, 21], [16, 10]]) circle(ctx, x, y, 2.2, '#c9763f');
  },
  coal(ctx) {
    circle(ctx, 12, 19, 7, '#2a2a2a');
    circle(ctx, 20, 18, 7, '#1e1e1e');
    circle(ctx, 16, 11, 6, '#333');
    ctx.fillStyle = '#7a7a8a';
    ctx.fillRect(14, 9, 2, 2);
    ctx.fillRect(19, 16, 2, 2);
  },
  wheat(ctx) {
    ctx.strokeStyle = '#b08a2a';
    ctx.lineWidth = 1.5;
    for (const dx of [-5, 0, 5]) {
      ctx.beginPath();
      ctx.moveTo(16, 28);
      ctx.lineTo(16 + dx, 8);
      ctx.stroke();
      ctx.fillStyle = '#e8c65a';
      rrect(ctx, 14 + dx, 4, 4, 10, 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(12, 20, 8, 3);
  },
  berries(ctx) {
    circle(ctx, 16, 17, 9, '#4f8f3f');
    for (const [x, y] of [[11, 14], [17, 12], [21, 17], [14, 20], [19, 22], [12, 24]]) {
      circle(ctx, x, y, 3, '#c93a3a');
      circle(ctx, x - 1, y - 1, 1, '#ff9a9a');
    }
  },
  apple(ctx) {
    circle(ctx, 16, 18, 9, '#d23b3b');
    circle(ctx, 12, 15, 3, '#f07070');
    ctx.fillStyle = '#5b3f25';
    ctx.fillRect(15, 6, 2, 5);
    ctx.fillStyle = '#4f8f3f';
    ctx.beginPath();
    ctx.ellipse(20, 8, 4, 2, -0.5, 0, Math.PI * 2);
    ctx.fill();
  },
  bread(ctx) {
    ctx.fillStyle = '#c98a3e';
    rrect(ctx, 5, 11, 22, 13, 6);
    ctx.fill();
    ctx.fillStyle = '#e0a856';
    rrect(ctx, 6, 11, 20, 7, 5);
    ctx.fill();
    ctx.strokeStyle = '#a06a2a';
    ctx.lineWidth = 1.5;
    for (const x of [11, 16, 21]) {
      ctx.beginPath();
      ctx.moveTo(x - 2, 13);
      ctx.lineTo(x + 1, 17);
      ctx.stroke();
    }
  },
  cheese(ctx) {
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.moveTo(4, 24);
    ctx.lineTo(28, 24);
    ctx.lineTo(28, 14);
    ctx.lineTo(8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e0b030';
    ctx.fillRect(4, 22, 24, 2);
    for (const [x, y] of [[12, 17], [20, 19], [24, 15]]) circle(ctx, x, y, 1.8, '#d9a520');
  },
  pie(ctx) {
    ellipse(ctx, 16, 19, 12, 7, '#b5783a');
    ellipse(ctx, 16, 17, 11, 6, '#e0a856');
    ctx.strokeStyle = '#8a3a5a';
    ctx.lineWidth = 2;
    for (const x of [10, 16, 22]) {
      ctx.beginPath();
      ctx.moveTo(x, 13);
      ctx.lineTo(x, 21);
      ctx.stroke();
    }
  },
  stew(ctx) {
    ellipse(ctx, 16, 20, 12, 7, '#7a5a3a');
    ellipse(ctx, 16, 17, 11, 4.5, '#b5642a');
    for (const [x, y, c] of [[12, 17, '#e8a040'], [18, 16, '#6aaa55'], [20, 18, '#e8a040']]) circle(ctx, x, y, 1.8, c);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2;
    for (const x of [12, 17, 22]) {
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.quadraticCurveTo(x + 2, 7, x, 4);
      ctx.stroke();
    }
  },
  axe(ctx, worn) {
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(8, 27);
    ctx.lineTo(22, 7);
    ctx.stroke();
    ctx.fillStyle = worn ? '#8a8078' : '#b8c0c8';
    ctx.beginPath();
    ctx.moveTo(17, 5);
    ctx.lineTo(27, 7);
    ctx.lineTo(26, 17);
    ctx.lineTo(19, 11);
    ctx.closePath();
    ctx.fill();
    if (worn) {
      ctx.fillStyle = '#a0603a';
      ctx.fillRect(22, 9, 2, 2);
      ctx.fillRect(24, 13, 2, 1);
    }
  },
  pickaxe(ctx) {
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(9, 28);
    ctx.lineTo(19, 8);
    ctx.stroke();
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(5, 9);
    ctx.quadraticCurveTo(18, 1, 29, 12);
    ctx.stroke();
  },
  package(ctx) {
    ctx.fillStyle = '#b8894e';
    ctx.fillRect(5, 9, 22, 17);
    ctx.fillStyle = '#9a6e3a';
    ctx.fillRect(5, 9, 22, 4);
    ctx.fillStyle = '#e8d8a8';
    ctx.fillRect(14, 9, 4, 17);
    ctx.fillRect(5, 16, 22, 3);
  },
};

export const ICON_URLS = {};

function buildItemIcons() {
  for (const id of ['wood', 'stone', 'iron_ore', 'coal', 'wheat', 'berries', 'apple', 'bread', 'cheese', 'pie', 'stew', 'worn_axe', 'axe', 'pickaxe', 'package']) {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    if (id === 'worn_axe') ICON_DRAW.axe(ctx, true);
    else ICON_DRAW[id](ctx);
    ICON_URLS[id] = c.toDataURL();
  }
}

// ---------------------------------------------------------------- entry point

/** Records window & chimney positions for each generated building texture. */
export const BUILDING_META = {};

export function createAllTextures(scene) {
  // Terrain tileset (repainted when the season changes).
  const tiles = makeCanvas(TS * TILE_COUNT, TS);
  paintTileset(tiles, 'spring');
  addCanvas(scene, 'tiles', tiles);

  for (const s of SEASONS) {
    addCanvas(scene, `tree_oak_${s}`, drawOak(s));
    addCanvas(scene, `tree_pine_${s}`, drawPine(s));
    addCanvas(scene, `stump_${s}`, drawStump(s));
    addCanvas(scene, `rubble_${s}`, drawRubble(s));
    for (const v of ['stone', 'iron', 'coal']) addCanvas(scene, `rock_${v}_${s}`, drawRock(v, s));
    addCanvas(scene, `bush_full_${s}`, drawBush(true, s));
    addCanvas(scene, `bush_empty_${s}`, drawBush(false, s));
    for (let st = 0; st <= 3; st++) addCanvas(scene, `crop_${st}_${s}`, drawCrop(st, s));
    addCanvas(scene, `tuft_${s}`, drawTuft(s));
  }

  for (const [type, fn] of Object.entries(DECOR_DRAW)) {
    const [w, h] = DECOR_SIZE[type];
    const variants = type === 'stall' ? [0, 1] : [0];
    for (const v of variants) {
      const c = makeCanvas(w, h);
      fn(c.getContext('2d'), v);
      addCanvas(scene, type === 'stall' ? `decor_stall_${v}` : `decor_${type}`, c);
    }
  }

  addCanvas(scene, 'glow', radial(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
  addCanvas(scene, 'smoke', radial(24, 'rgba(210,210,210,0.8)', 'rgba(210,210,210,0)'));
  addCanvas(scene, 'snow', radial(8, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'));
  addCanvas(scene, 'dot', simple(6, 6, (ctx) => circle(ctx, 3, 3, 3, '#ffffff')));
  addCanvas(scene, 'rain', simple(2, 14, (ctx) => {
    ctx.fillStyle = 'rgba(200,225,255,0.85)';
    ctx.fillRect(0, 0, 2, 14);
  }));
  addCanvas(scene, 'chip', simple(6, 4, (ctx) => {
    ctx.fillStyle = '#c99a62';
    ctx.fillRect(0, 0, 6, 4);
  }));
  addCanvas(scene, 'spark', simple(4, 4, (ctx) => {
    ctx.fillStyle = '#ffd65a';
    ctx.fillRect(0, 0, 4, 4);
  }));
  addCanvas(scene, 'window_lit', simple(16, 13, (ctx) => {
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(0, 0, 16, 13);
    ctx.fillStyle = '#b58a4a';
    ctx.fillRect(7, 0, 2, 13);
    ctx.fillRect(0, 5, 16, 2);
  }));
  addCanvas(scene, 'marker', simple(18, 14, (ctx) => {
    ctx.fillStyle = '#ffd65a';
    ctx.strokeStyle = '#5a3a10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.lineTo(16, 2);
    ctx.lineTo(9, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }));
  addCanvas(scene, 'objective_marker', simple(24, 30, (ctx) => {
    ctx.fillStyle = '#ffb938';
    ctx.strokeStyle = '#5a2a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(12, 11, 9, Math.PI, 0);
    ctx.lineTo(12, 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff6d8';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 12, 16);
  }));
  addCanvas(scene, 'arrow', simple(30, 30, (ctx) => {
    ctx.fillStyle = '#ffb938';
    ctx.strokeStyle = '#5a2a00';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(28, 15);
    ctx.lineTo(4, 3);
    ctx.lineTo(10, 15);
    ctx.lineTo(4, 27);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }));
  addCanvas(scene, 'bubble', simple(26, 22, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1.5;
    rrect(ctx, 1, 1, 24, 15, 6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(8, 15);
    ctx.lineTo(7, 21);
    ctx.lineTo(13, 15);
    ctx.fill();
    for (const x of [7, 13, 19]) circle(ctx, x, 8.5, 1.7, '#555');
  }));

  buildItemIcons();
}

/** Builds (or reuses) the texture for a specific building instance. */
export function ensureBuildingTexture(scene, building) {
  const key = `bld_${building.id}`;
  if (!scene.textures.exists(key)) {
    const { canvas, windows, chimney } = drawBuilding(building.type, building.variant);
    addCanvas(scene, key, canvas);
    BUILDING_META[key] = { windows, chimney, width: canvas.width, height: canvas.height };
  }
  return key;
}
