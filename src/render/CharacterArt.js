/**
 * CharacterArt — draws character sprite sheets procedurally, in the hand-drawn style of the painted world:
 * natural proportions (a smaller head, seen from a little above, so the crown of the head and the shoulders
 * show), layered clothes in muted, earthy colours — a cloak, a hood, a scarf, a fur-trimmed capelet or an
 * apron over the tunic or dress — soft light from the top left, a thin dark outline and a round shadow.
 *
 * What someone wears over their clothes follows from their look (a hash of it — nothing new is stored and
 * no dice are rolled), so everyone keeps the same outfit.
 *
 * Sheet layout: CHAR_COLS columns × 4 rows, each frame 32×48 px (feet at y = 45; room above the head for
 * hats and raised tools).
 *   columns: 0 idle · 1–4 a walking stride (step, passing, step, passing) · 5 tool raised · 6 tool striking · 7 sitting
 *   rows:    0 down, 1 left, 2 right, 3 up
 */
import { hashStr } from '../core/rng.js';

export const CHAR_W = 32;
export const CHAR_H = 48;
export const DIRS = ['down', 'left', 'right', 'up'];
export const CHAR_COLS = 8;
/** Each column's pose: how far the stride has swung (−1…1), the body's bob, and the work pose. */
const POSES = [
  { walk: 0, bob: 0 },
  { walk: 1, bob: 0 },
  { walk: 0.35, bob: -1 },
  { walk: -1, bob: 0 },
  { walk: -0.35, bob: -1 },
  { walk: 0, bob: 0, work: 'raise' },
  { walk: 0, bob: 1, work: 'strike' },
  { walk: 0, bob: 5, sit: true },
];

const OUTLINE = 'rgba(38,26,20,0.92)';
/** Earthy colours for what's worn over the clothes. */
const OUTER_COLOURS = ['#8a4a36', '#5f6f45', '#6f7f86', '#9a8466', '#4f5f6f', '#7a3b3b', '#6a5a44', '#3f6f6a', '#a0673a', '#5a4a5f'];
const SCARF_COLOURS = ['#5fa8a0', '#c9a24a', '#b0503a', '#7f9fbf', '#e0d2b0', '#8a6fa8', '#6a9a5a'];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Tone a bright colour down towards the painted world's earthy palette. */
function mute(hex, k = 0.35) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const grey = r * 0.3 + g * 0.59 + b * 0.11;
  const warm = [138, 122, 102];
  const mix = (c, w) => Math.round(c * (1 - k) + (grey * 0.6 + w * 0.4) * k);
  return `#${((mix(r, warm[0]) << 16) | (mix(g, warm[1]) << 8) | mix(b, warm[2])).toString(16).padStart(6, '0')}`;
}

/**
 * Work clothes by occupation: a hat and something over the clothes, so you can tell the smith from the baker
 * across the square. (Drawn over the person's own outfit; they change when the job does.)
 *   head: straw · knit · miner · baker · cap · oilskin      body: leather_apron · white_apron · waistcoat · toolbelt · coat
 */
export const JOB_GARB = {
  blacksmith: { body: 'leather_apron' },
  smith_hand: { body: 'leather_apron' },
  farmer: { head: 'straw' },
  farmhand: { head: 'straw' },
  lumber_foreman: { head: 'knit', body: 'waistcoat', colour: '#5a3f24' },
  woodcutter: { head: 'knit', body: 'waistcoat', colour: '#5a3f24' },
  forester: { head: 'straw', body: 'waistcoat', colour: '#3f5a2f' },
  nursery_keeper: { head: 'straw', body: 'white_apron' },
  tailor: { body: 'waistcoat', colour: '#5a3a5a' },
  tailor_hand: { body: 'white_apron' },
  cobbler: { body: 'leather_apron' },
  cobbler_hand: { body: 'leather_apron' },
  sawyer: { head: 'knit' },
  sawmill_hand: { head: 'knit' },
  hunter: { head: 'knit', body: 'waistcoat', colour: '#4f5a36' },
  quarry_foreman: { head: 'miner', body: 'toolbelt' },
  miner: { head: 'miner', body: 'toolbelt' },
  clay_digger: { head: 'miner' },
  brickmaker: { head: 'miner', body: 'leather_apron' },
  baker: { head: 'baker', body: 'white_apron' },
  baker_hand: { head: 'baker', body: 'white_apron' },
  miller: { head: 'baker', body: 'white_apron' },
  mill_hand: { head: 'baker' },
  shopkeeper: { body: 'waistcoat', colour: '#3f5a4f' },
  store_clerk: { body: 'waistcoat', colour: '#4f4a6a' },
  merchant: { body: 'waistcoat', colour: '#6a2f2f' },
  innkeeper: { body: 'waistcoat', colour: '#5a3a24' },
  tavern_server: { body: 'white_apron' },
  master_builder: { head: 'cap', body: 'toolbelt' },
  builder: { head: 'cap', body: 'toolbelt' },
  carpenter: { head: 'cap', body: 'toolbelt' },
  carpenter_hand: { head: 'cap', body: 'toolbelt' },
  fisherman: { head: 'oilskin' },
  fisher: { head: 'oilskin' },
  carter_master: { head: 'cap', body: 'waistcoat', colour: '#4a3a2a' },
  carter: { head: 'cap' },
  warehouse_hand: { head: 'cap' },
  factory_master: { head: 'cap', body: 'waistcoat', colour: '#3a3a44' },
  factory_hand: { head: 'cap' },
  teacher: { body: 'coat', colour: '#3a3f52' },
  doctor: { body: 'coat', colour: '#2f2f36' },
  engineer: { body: 'coat', colour: '#4a4236' },
  researcher: { body: 'coat', colour: '#3a4a52' },
};

/** A villager as they'd look today: their own look plus the clothes of their trade (none for children). */
export function dressedLook(npc) {
  const garb = npc.age >= 14 ? JOB_GARB[npc.occupation] : null;
  return garb ? { ...npc.look, garb } : npc.look;
}

/** A short id for someone's work clothes (part of their texture's key, so a new job means new clothes). */
export function garbKey(npc) {
  const g = npc.age >= 14 ? JOB_GARB[npc.occupation] : null;
  return g ? `${g.head || '-'}.${g.body || '-'}` : '';
}

/** What someone wears over their clothes (from their look — the same every time). */
export function outfitOf(look) {
  const key = `${look.shirt}|${look.pants}|${look.hair}|${look.skin}|${look.hairStyle}|${look.dress ? 1 : 0}`;
  const h = hashStr(key, 17);
  let outer = h < 0.24 ? 'cloak' : h < 0.4 ? 'hood' : h < 0.58 ? 'scarf' : h < 0.7 ? 'fur' : h < 0.82 ? 'apron' : 'none';
  if ((look.hat || look.garb?.head) && outer === 'hood') outer = 'cloak'; // the hat stays on show
  if (look.garb?.body && outer === 'apron') outer = 'none'; // work clothes instead
  return {
    outer,
    outerColour: OUTER_COLOURS[Math.floor(hashStr(key, 29) * OUTER_COLOURS.length)],
    scarfColour: SCARF_COLOURS[Math.floor(hashStr(key, 41) * SCARF_COLOURS.length)],
    tunic: mute(look.shirt),
    pants: mute(look.pants, 0.45),
    boots: shade(mute(look.shoes, 0.3), -10),
  };
}

export function drawCharacterSheet(look) {
  const canvas = makeCanvas(CHAR_W * CHAR_COLS, CHAR_H * 4);
  const ctx = canvas.getContext('2d');
  const fit = outfitOf(look);
  DIRS.forEach((dir, row) => {
    for (let col = 0; col < CHAR_COLS; col++) drawFrame(ctx, col * CHAR_W, row * CHAR_H, dir, POSES[col], look, fit);
  });
  return canvas;
}

let frameCanvas = null;
let outlineCanvas = null;

/** One frame: the figure drawn on its own, a thin dark outline round it, and a round shadow under it. */
function drawFrame(ctx, ox, oy, dir, pose, look, fit) {
  frameCanvas ??= makeCanvas(CHAR_W, CHAR_H);
  outlineCanvas ??= makeCanvas(CHAR_W, CHAR_H);
  const f = frameCanvas.getContext('2d');
  f.clearRect(0, 0, CHAR_W, CHAR_H);
  f.save();
  if (dir === 'left') {
    // left is right, mirrored
    f.translate(CHAR_W, 0);
    f.scale(-1, 1);
  }
  drawFigure(f, dir === 'left' ? 'right' : dir, pose, look, fit);
  f.restore();
  // the outline: the figure's shape, one pixel bigger all round, in dark ink
  const o = outlineCanvas.getContext('2d');
  o.clearRect(0, 0, CHAR_W, CHAR_H);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) o.drawImage(frameCanvas, dx, dy);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = OUTLINE;
  o.fillRect(0, 0, CHAR_W, CHAR_H);
  o.globalCompositeOperation = 'source-over';
  // shadow, outline, figure
  ctx.fillStyle = 'rgba(40,38,50,0.3)';
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 44.5, 9, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(outlineCanvas, ox, oy);
  ctx.drawImage(frameCanvas, ox, oy);
}

// ------------------------------------------------------------------ painting helpers

/** Fill the current path lit from the top left. */
function lit(ctx, base, x0, y0, x1, y1, light = 22, dark = -30) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, shade(base, light));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, dark));
  ctx.fillStyle = g;
  ctx.fill();
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

function blob(ctx, x, y, rx, ry, base, light = 22, dark = -30) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  lit(ctx, base, x - rx, y - ry, x + rx, y + ry, light, dark);
}

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// ------------------------------------------------------------------ the figure

/**
 * Draws one figure facing down, up or right (left is mirrored), in a 32×48 frame with the feet at y = 45.
 */
function drawFigure(ctx, dir, pose, look, fit) {
  const cx = 16;
  const walk = pose.walk;
  const working = !!pose.work;
  const strike = pose.work === 'strike';
  const bob = pose.bob;
  const t = bob; // everything above the legs moves with the step
  const skin = look.skin;
  const side = dir === 'right';
  const back = dir === 'up';
  const { outer, outerColour } = fit;
  const long = look.dress;

  // --- the cloak or hood hangs behind the body (seen whole from behind)
  if ((outer === 'cloak' || outer === 'hood') && !back) {
    const sway = walk * 1.2 - bob * 0.6; // the hem swings a moment behind the stride
    if (side) poly(ctx, [[cx - 2, 18 + t], [cx + 3, 18 + t], [cx + 1, 38 + t], [cx - 8 - sway, 40 + t], [cx - 6, 24 + t]]);
    else poly(ctx, [[cx - 8, 18 + t], [cx + 8, 18 + t], [cx + 10 + sway, 39 + t], [cx - 10 + sway, 39 + t]]);
    lit(ctx, shade(outerColour, -18), cx - 10, 18, cx + 10, 40);
  }

  // --- legs and boots
  const legTop = 32 + t;
  if (pose.sit) {
    // sitting: knees forward, the boots together below
    rrect(ctx, cx - 5, legTop, 4.5, 5, 2);
    lit(ctx, fit.pants, cx - 5, legTop, cx, legTop + 5);
    rrect(ctx, cx + 0.5, legTop, 4.5, 5, 2);
    lit(ctx, shade(fit.pants, -8), cx, legTop, cx + 5, legTop + 5);
    rrect(ctx, cx - 5.5, 40.5, 5.5, 4, 2);
    lit(ctx, fit.boots, cx - 6, 40, cx, 45, 18, -18);
    rrect(ctx, cx, 40.5, 5.5, 4, 2);
    lit(ctx, fit.boots, cx, 40, cx + 6, 45, 18, -18);
  } else if (!long) {
    if (side) {
      const s = walk * 3;
      for (const [dx, far] of [[-s, true], [s, false]]) {
        rrect(ctx, cx - 2.5 + dx, legTop, 5, 10 - t, 2);
        lit(ctx, far ? shade(fit.pants, -16) : fit.pants, cx - 3, legTop, cx + 3, 44);
        rrect(ctx, cx - 2.5 + dx, 40, 6.5, 4.5, 2);
        lit(ctx, far ? shade(fit.boots, -14) : fit.boots, cx - 3, 40, cx + 4, 45, 18, -18);
      }
    } else {
      const lh = 10 - (walk > 0.5 ? 2 : 0);
      const rh = 10 - (walk < -0.5 ? 2 : 0);
      rrect(ctx, cx - 5, legTop, 4.5, lh - t, 2);
      lit(ctx, fit.pants, cx - 5, legTop, cx, 44);
      rrect(ctx, cx + 0.5, legTop, 4.5, rh - t, 2);
      lit(ctx, shade(fit.pants, -8), cx, legTop, cx + 5, 44);
      rrect(ctx, cx - 5.5, legTop + lh - t - 4, 5.5, 4.5, 2);
      lit(ctx, fit.boots, cx - 6, 38, cx, 45, 18, -18);
      rrect(ctx, cx, legTop + rh - t - 4, 5.5, 4.5, 2);
      lit(ctx, fit.boots, cx, 38, cx + 6, 45, 18, -18);
    }
  } else {
    // under a long dress: just the boots showing
    const s = side ? walk * 2 : 0;
    rrect(ctx, cx - 5 + s, 40, 4.5, 4.5, 2);
    lit(ctx, fit.boots, cx - 5, 40, cx, 45, 18, -18);
    rrect(ctx, cx + 0.5 - s, 40, 4.5, 4.5, 2);
    lit(ctx, fit.boots, cx, 40, cx + 5, 45, 18, -18);
  }

  // --- the far arm (side view: behind the body)
  const armSwing = walk * 2.5;
  if (side && !working) {
    rrect(ctx, cx - 1 - armSwing, 19 + t, 4, 11, 2);
    lit(ctx, shade(fit.tunic, -22), cx - 2, 19, cx + 3, 31);
  }

  // --- body: tunic (with a belt) or a dress
  const shoulderW = side ? 5 : 7.5;
  if (long) {
    const hemW = side ? 7 : 9.5;
    const sway = side ? -walk : 0;
    poly(ctx, [[cx - shoulderW, 19 + t], [cx + shoulderW, 19 + t], [cx + shoulderW - 1, 27 + t], [cx + hemW + sway, 41], [cx - hemW + sway, 41], [cx - shoulderW + 1, 27 + t]]);
    lit(ctx, fit.tunic, cx - hemW, 19, cx + hemW, 41);
    // a sash at the waist
    ctx.fillStyle = shade(fit.tunic, -34);
    ctx.fillRect(cx - shoulderW + 1, 26 + t, (shoulderW - 1) * 2, 2);
  } else {
    poly(ctx, [[cx - shoulderW, 18.5 + t], [cx + shoulderW, 18.5 + t], [cx + shoulderW - 0.5, 30 + t], [cx + shoulderW - 1.5, 34 + t], [cx - shoulderW + 1.5, 34 + t], [cx - shoulderW + 0.5, 30 + t]]);
    lit(ctx, fit.tunic, cx - shoulderW, 18, cx + shoulderW, 34);
    // belt and buckle
    ctx.fillStyle = shade(fit.pants, -38);
    ctx.fillRect(cx - shoulderW + 0.5, 29 + t, shoulderW * 2 - 1, 2);
    if (!back) {
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(side ? cx + 2 : cx - 1, 29 + t, 2, 2);
    }
  }
  // a fold of shadow down the far side of the body
  ctx.fillStyle = 'rgba(20,12,6,0.14)';
  ctx.fillRect(side ? cx - shoulderW : cx + shoulderW - 3, 20 + t, 3, long ? 18 : 12);

  // --- an apron over the front
  if (outer === 'apron' && !back) {
    if (side) poly(ctx, [[cx + 2, 22 + t], [cx + 5, 22 + t], [cx + 6, 39], [cx + 2, 39]]);
    else poly(ctx, [[cx - 4.5, 22 + t], [cx + 4.5, 22 + t], [cx + 5.5, 39], [cx - 5.5, 39]]);
    lit(ctx, '#d8ccb0', cx - 5, 22, cx + 5, 39, 10, -24);
    ctx.fillStyle = 'rgba(90,70,40,0.5)';
    if (!side) ctx.fillRect(cx - 4.5, 22 + t, 9, 1);
  }

  // --- work clothes over the body
  if (look.garb?.body) drawGarbBody(ctx, look.garb, cx, t, side, back, shoulderW, long);

  // --- arms (and hands), or raised with a tool when working
  if (strike) {
    // the tool brought down in front: arms forward, the head of the tool low
    const hx = side ? cx + 5 : cx;
    rrect(ctx, hx - 5, 20 + t, 3.5, 8, 1.6);
    lit(ctx, shade(fit.tunic, -8), hx - 5, 20, hx - 1, 28);
    rrect(ctx, hx + 1.5, 20 + t, 3.5, 8, 1.6);
    lit(ctx, shade(fit.tunic, -14), hx + 1, 20, hx + 5, 28);
    blob(ctx, hx - 2, 28 + t, 1.9, 1.9, skin, 16, -16);
    blob(ctx, hx + 2.5, 28 + t, 1.9, 1.9, skin, 16, -16);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, 27 + t);
    ctx.lineTo(hx + (side ? 9 : 3), 37);
    ctx.stroke();
    rrect(ctx, hx + (side ? 6 : -1), 36, 8, 4.5, 1);
    lit(ctx, '#9aa3ad', hx, 36, hx + 12, 41, 30, -30);
  } else if (working) {
    const hx = side ? cx + 4 : cx;
    rrect(ctx, hx - 5, 11 + t, 3.5, 10, 1.6);
    lit(ctx, shade(fit.tunic, -8), hx - 5, 11, hx - 1, 21);
    rrect(ctx, hx + 1.5, 11 + t, 3.5, 10, 1.6);
    lit(ctx, shade(fit.tunic, -14), hx + 1, 11, hx + 5, 21);
    blob(ctx, hx - 3, 10 + t, 1.9, 1.9, skin, 16, -16);
    blob(ctx, hx + 3, 10 + t, 1.9, 1.9, skin, 16, -16);
    // the tool: handle and head
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - 2, 11 + t);
    ctx.lineTo(hx + 9, 1 + t);
    ctx.stroke();
    rrect(ctx, hx + 6, -2 + t, 8, 4.5, 1);
    lit(ctx, '#9aa3ad', hx + 6, -2, hx + 14, 3, 30, -30);
  } else if (side) {
    rrect(ctx, cx - 1 + armSwing, 19 + t, 4, 11, 2);
    lit(ctx, shade(fit.tunic, -6), cx - 1, 19, cx + 3, 31);
    blob(ctx, cx + 1 + armSwing, 30.5 + t, 1.9, 1.9, skin, 16, -16);
  } else {
    rrect(ctx, cx - shoulderW - 3, 19 + t + walk, 3.5, 11, 1.8);
    lit(ctx, shade(fit.tunic, -6), cx - 11, 19, cx - 7, 31);
    rrect(ctx, cx + shoulderW - 0.5, 19 + t - walk, 3.5, 11, 1.8);
    lit(ctx, shade(fit.tunic, -16), cx + 7, 19, cx + 11, 31);
    if (!back) {
      blob(ctx, cx - shoulderW - 1.2, 30.5 + t + walk, 1.9, 1.9, skin, 16, -16);
      blob(ctx, cx + shoulderW + 1.2, 30.5 + t - walk, 1.9, 1.9, skin, 16, -16);
    }
  }

  // --- over the shoulders: a cloak's capelet, a hood's cowl, a fur-trimmed capelet — or a scarf
  if (outer === 'cloak' || outer === 'hood' || outer === 'fur') {
    const col = outer === 'fur' ? outerColour : outerColour;
    if (back) {
      // from behind: the cloak covers the back down to the calves
      poly(ctx, [[cx - 8.5, 18 + t], [cx + 8.5, 18 + t], [cx + 10 + walk, outer === 'fur' ? 28 + t : 39 + t], [cx - 10 + walk, outer === 'fur' ? 28 + t : 39 + t]]);
      lit(ctx, col, cx - 10, 18, cx + 10, 39);
      ctx.strokeStyle = 'rgba(20,12,6,0.25)';
      ctx.lineWidth = 1;
      for (const x of [-4, 0, 4]) {
        ctx.beginPath();
        ctx.moveTo(cx + x, 22 + t);
        ctx.lineTo(cx + x * 1.2 + walk, outer === 'fur' ? 27 + t : 37 + t);
        ctx.stroke();
      }
    } else if (side) {
      poly(ctx, [[cx - 5, 17.5 + t], [cx + 4, 17.5 + t], [cx + 5, 24 + t], [cx - 6, 25 + t]]);
      lit(ctx, col, cx - 6, 17, cx + 5, 25);
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, 20.5 + t, 10, 5, 0, 0, Math.PI * 2);
      lit(ctx, col, cx - 10, 16, cx + 10, 26);
      // the front opening and a clasp
      ctx.fillStyle = 'rgba(20,12,6,0.3)';
      ctx.fillRect(cx - 0.5, 21 + t, 1, 4.5);
      ctx.fillStyle = '#c9a24a';
      ctx.beginPath();
      ctx.arc(cx, 21 + t, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (outer === 'fur') {
      // a fluffy fur collar
      ctx.fillStyle = '#e8dcc2';
      for (let i = -4; i <= 4; i++) {
        const x = cx + i * (side ? 1.1 : 2.1);
        const y = (side ? 17.8 : 17.5) + t + Math.abs(i) * 0.25;
        ctx.beginPath();
        ctx.arc(x, y, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(120,100,70,0.35)';
      for (let i = -3; i <= 3; i += 2) ctx.fillRect(cx + i * (side ? 1.1 : 2.1), 18.5 + t, 1, 1);
    }
  } else if (outer === 'scarf') {
    const sc = fit.scarfColour;
    rrect(ctx, cx - (side ? 4 : 5.5), 16.5 + t, side ? 8 : 11, 4, 2);
    lit(ctx, sc, cx - 6, 16, cx + 6, 21, 20, -26);
    if (!back) {
      // the loose end hanging down the front
      rrect(ctx, side ? cx + 1.5 : cx + 1, 19 + t, 3, 7, 1.2);
      lit(ctx, shade(sc, -10), cx + 1, 19, cx + 4, 26, 16, -22);
    }
  }

  // --- the hood's back (behind the head)
  if (outer === 'hood') {
    blob(ctx, side ? cx - 1.5 : cx, 11.5 + t, 7, 7, shade(outerColour, -12));
  }

  // --- head
  const hx = side ? cx + 1 : cx;
  const hy = 11.5 + t;
  ctx.fillStyle = shade(skin, -24); // neck
  ctx.fillRect(hx - 1.5, hy + 4, 3, 3);
  blob(ctx, hx, hy, 5.2, 5.4, skin, 18, -20);

  // hair (seen from a little above: it covers the crown), or the hood over it
  if (outer === 'hood') {
    drawHood(ctx, hx, hy, dir, outerColour);
  } else {
    drawHair(ctx, hx, hy, dir, look);
  }

  // face
  if (!back) {
    ctx.fillStyle = '#2a1d17';
    if (side) {
      ctx.fillRect(hx + 2.5, hy + 0.8, 1.3, 1.5);
      ctx.fillStyle = shade(skin, -26);
      ctx.fillRect(hx + 4.6, hy + 1.8, 1, 1.4); // nose
    } else {
      ctx.fillRect(hx - 2.6, hy + 0.8, 1.4, 1.6);
      ctx.fillRect(hx + 1.2, hy + 0.8, 1.4, 1.6);
      ctx.fillStyle = 'rgba(210,110,95,0.3)';
      ctx.fillRect(hx - 4, hy + 2.6, 1.6, 1.2);
      ctx.fillRect(hx + 2.4, hy + 2.6, 1.6, 1.2);
    }
    if (look.beard && outer !== 'hood') {
      ctx.beginPath();
      if (side) ctx.ellipse(hx + 1.8, hy + 4, 2.6, 1.8, 0, 0, Math.PI * 2);
      else ctx.ellipse(hx, hy + 4.3, 3.2, 1.9, 0, 0, Math.PI * 2);
      lit(ctx, look.hair, hx - 4, hy + 2, hx + 4, hy + 6, 14, -20);
    }
  }

  // a work hat
  const head = look.garb?.head;
  if (head && head !== 'straw' && outer !== 'hood') drawGarbHead(ctx, head, hx, hy, dir);
  // the player's straw hat (and the farmers')
  if ((look.hat || head === 'straw') && outer !== 'hood') {
    ctx.beginPath();
    ctx.ellipse(hx, hy - 3.5, 9.5, 3.4, 0, 0, Math.PI * 2);
    lit(ctx, '#d9b45a', hx - 9, hy - 7, hx + 9, hy, 20, -26);
    rrect(ctx, hx - 5, hy - 9.5, 10, 6, 3);
    lit(ctx, '#c9a045', hx - 5, hy - 10, hx + 5, hy - 3, 18, -22);
    ctx.fillStyle = '#8a4a2a';
    ctx.fillRect(hx - 5, hy - 5, 10, 1.6);
  }
}

/** Aprons, waistcoats, tool belts and long coats, over the tunic. */
function drawGarbBody(ctx, garb, cx, t, side, back, shoulderW, long) {
  const kind = garb.body;
  if (kind === 'leather_apron' || kind === 'white_apron') {
    if (back) {
      // from behind: just the ties
      ctx.fillStyle = kind === 'leather_apron' ? '#3a2616' : '#d8d2c4';
      ctx.fillRect(cx - shoulderW + 1, 27.5 + t, (shoulderW - 1) * 2, 1.5);
      return;
    }
    const col = kind === 'leather_apron' ? '#5a3a22' : '#ece6d8';
    const top = kind === 'leather_apron' ? 19.5 : 22;
    if (side) poly(ctx, [[cx + 1, top + t], [cx + 5, top + t], [cx + 6.5, 40], [cx + 1.5, 40]]);
    else poly(ctx, [[cx - 4, top + t], [cx + 4, top + t], [cx + 4.5, 26 + t], [cx + 6, 40], [cx - 6, 40], [cx - 4.5, 26 + t]]);
    lit(ctx, col, cx - 6, top, cx + 6, 40, 14, -26);
    // neck strap and pocket
    ctx.fillStyle = kind === 'leather_apron' ? '#2f1d10' : '#bdb6a6';
    if (!side) {
      ctx.fillRect(cx - 3.5, 18 + t, 1, 3);
      ctx.fillRect(cx + 2.5, 18 + t, 1, 3);
      ctx.fillRect(cx - 2.5, 30 + t, 5, 3);
    }
    if (kind === 'white_apron') {
      // a dusting of flour
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(cx - 3, 33 + t, 2, 1);
      ctx.fillRect(cx + 1, 35 + t, 2, 1);
    }
    return;
  }
  if (kind === 'waistcoat') {
    const col = garb.colour || '#4a3a2a';
    if (side) poly(ctx, [[cx - shoulderW + 0.5, 19 + t], [cx + shoulderW - 0.5, 19 + t], [cx + shoulderW - 1, 30 + t], [cx - shoulderW + 1, 30 + t]]);
    else if (back) poly(ctx, [[cx - shoulderW + 0.5, 19 + t], [cx + shoulderW - 0.5, 19 + t], [cx + shoulderW - 1, 30 + t], [cx - shoulderW + 1, 30 + t]]);
    else {
      // two fronts, the shirt showing down the middle
      poly(ctx, [[cx - shoulderW + 0.5, 19 + t], [cx - 1, 19 + t], [cx - 0.5, 30 + t], [cx - shoulderW + 1, 30 + t]]);
      lit(ctx, col, cx - shoulderW, 19, cx, 30, 16, -24);
      poly(ctx, [[cx + 1, 19 + t], [cx + shoulderW - 0.5, 19 + t], [cx + shoulderW - 1, 30 + t], [cx + 0.5, 30 + t]]);
      lit(ctx, shade(col, -8), cx, 19, cx + shoulderW, 30, 16, -24);
      ctx.fillStyle = '#d9b860';
      for (const y of [22, 25, 28]) ctx.fillRect(cx - 1.8, y + t, 1, 1);
      return;
    }
    lit(ctx, col, cx - shoulderW, 19, cx + shoulderW, 30, 16, -24);
    return;
  }
  if (kind === 'toolbelt') {
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(cx - shoulderW + 0.5, 29 + t, shoulderW * 2 - 1, 2.2);
    if (back) return;
    // a pouch and a hammer at the hip
    rrect(ctx, side ? cx - 3 : cx + 2.5, 30 + t, 3.5, 3.5, 1);
    lit(ctx, '#7a5230', cx, 30, cx + 6, 34, 14, -20);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(side ? cx + 3 : cx - 5, 30 + t, 1.2, 5);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(side ? cx + 2 : cx - 6, 29.5 + t, 3.2, 1.6);
    return;
  }
  if (kind === 'coat') {
    const col = garb.colour || '#3a3f52';
    if (side) poly(ctx, [[cx - shoulderW, 18.5 + t], [cx + shoulderW, 18.5 + t], [cx + shoulderW + 0.5, 39], [cx - shoulderW - 1.5, 39]]);
    else poly(ctx, [[cx - shoulderW - 0.5, 18.5 + t], [cx + shoulderW + 0.5, 18.5 + t], [cx + shoulderW + 1.5, 39], [cx - shoulderW - 1.5, 39]]);
    lit(ctx, col, cx - 9, 18, cx + 9, 39, 16, -26);
    if (!back && !side) {
      // lapels, buttons, and the parting at the front
      ctx.fillStyle = shade(col, -26);
      ctx.fillRect(cx - 0.5, 24 + t, 1, 15 - t);
      ctx.fillStyle = shade(col, 22);
      poly(ctx, [[cx - 3, 18.5 + t], [cx, 23 + t], [cx - 1, 18.5 + t]]);
      ctx.fill();
      poly(ctx, [[cx + 3, 18.5 + t], [cx, 23 + t], [cx + 1, 18.5 + t]]);
      ctx.fill();
      ctx.fillStyle = '#c9a24a';
      for (const y of [26, 30]) ctx.fillRect(cx - 2, y + t, 1, 1);
    }
  }
}

/** Work hats: a flat cap, a knitted cap, a miner's leather cap, a baker's cap, a fisher's oilskin hat. */
function drawGarbHead(ctx, head, hx, hy, dir) {
  const side = dir === 'right';
  const back = dir === 'up';
  if (head === 'cap') {
    ctx.beginPath();
    ctx.ellipse(hx - (side ? 0.5 : 0), hy - 3.2, 5.8, 3.4, 0, Math.PI * 0.95, Math.PI * 2.05);
    ctx.closePath();
    lit(ctx, '#6a5a44', hx - 6, hy - 7, hx + 6, hy - 1, 18, -24);
    if (!back) {
      // the peak
      ctx.beginPath();
      if (side) ctx.ellipse(hx + 4.5, hy - 2.3, 3, 1.1, 0.1, 0, Math.PI * 2);
      else ctx.ellipse(hx, hy - 1.6, 4.6, 1.3, 0, 0, Math.PI);
      lit(ctx, '#4a3e30', hx - 5, hy - 3, hx + 5, hy, 12, -18);
    }
    return;
  }
  if (head === 'knit') {
    ctx.beginPath();
    ctx.ellipse(hx - (side ? 0.5 : 0), hy - 3, 5.6, 4.2, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    lit(ctx, '#8a3a2a', hx - 6, hy - 8, hx + 6, hy - 2, 18, -24);
    ctx.fillStyle = '#6a2a1e'; // the turned-up rib
    ctx.fillRect(hx - 5.6, hy - 3.6, 11.2, 1.8);
    blob(ctx, hx, hy - 7.4, 1.6, 1.4, '#c9b89a', 16, -16); // bobble
    return;
  }
  if (head === 'miner') {
    ctx.beginPath();
    ctx.ellipse(hx, hy - 3, 5.8, 4.4, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    lit(ctx, '#5a4632', hx - 6, hy - 8, hx + 6, hy - 2, 20, -26);
    ctx.beginPath();
    ctx.ellipse(hx + (side ? 1 : 0), hy - 2.6, 6.8, 1.6, 0, 0, Math.PI * 2);
    lit(ctx, '#46362a', hx - 7, hy - 4, hx + 7, hy - 1, 12, -18);
    if (!back) {
      // a stub of candle on the front
      ctx.fillStyle = '#efe6c8';
      ctx.fillRect(side ? hx + 2.5 : hx - 0.8, hy - 7.2, 1.6, 2.4);
      ctx.fillStyle = '#ffcf5a';
      ctx.fillRect(side ? hx + 2.8 : hx - 0.5, hy - 8.4, 1, 1.2);
    }
    return;
  }
  if (head === 'baker') {
    blob(ctx, hx, hy - 6, 5, 3.4, '#f4f0e6', 10, -22);
    ctx.fillStyle = '#e2dccf';
    ctx.fillRect(hx - 5, hy - 4.2, 10, 1.8);
    return;
  }
  if (head === 'oilskin') {
    ctx.beginPath();
    ctx.ellipse(hx, hy - 2.6, 8, 2.8, 0, 0, Math.PI * 2);
    lit(ctx, '#c9a23a', hx - 8, hy - 5, hx + 8, hy, 16, -26);
    ctx.beginPath();
    ctx.ellipse(hx, hy - 4.6, 5, 3.4, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    lit(ctx, '#d9b24a', hx - 5, hy - 8, hx + 5, hy - 3, 16, -24);
  }
}

function drawHood(ctx, hx, hy, dir, colour) {
  const back = dir === 'up';
  const side = dir === 'right';
  if (back) {
    blob(ctx, hx, hy - 0.5, 6.4, 6.6, colour);
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy + 3);
    ctx.lineTo(hx, hy + 9);
    ctx.lineTo(hx + 3, hy + 3);
    lit(ctx, shade(colour, -12), hx - 3, hy, hx + 3, hy + 9);
    return;
  }
  // the hood's rim round the face: a crown over the top, sides down past the cheeks
  ctx.beginPath();
  if (side) {
    ctx.moveTo(hx + 3.5, hy - 6);
    ctx.quadraticCurveTo(hx - 7, hy - 8, hx - 6.5, hy + 5);
    ctx.lineTo(hx - 1, hy + 5.5);
    ctx.quadraticCurveTo(hx - 1, hy - 2, hx + 4.5, hy - 2.5);
  } else {
    ctx.moveTo(hx - 6.6, hy + 5);
    ctx.quadraticCurveTo(hx - 7.5, hy - 7.5, hx, hy - 7.2);
    ctx.quadraticCurveTo(hx + 7.5, hy - 7.5, hx + 6.6, hy + 5);
    ctx.lineTo(hx + 4.2, hy + 4.5);
    ctx.quadraticCurveTo(hx + 4.5, hy - 3.5, hx, hy - 3.4);
    ctx.quadraticCurveTo(hx - 4.5, hy - 3.5, hx - 4.2, hy + 4.5);
  }
  ctx.closePath();
  lit(ctx, colour, hx - 7, hy - 8, hx + 7, hy + 5);
}

function drawHair(ctx, hx, hy, dir, look) {
  const style = look.hairStyle || 'short';
  const hair = look.hair;
  const back = dir === 'up';
  const side = dir === 'right';
  if (style === 'bald') {
    // a fringe round the back and sides only
    ctx.fillStyle = shade(hair, -6);
    if (back) {
      ctx.beginPath();
      ctx.ellipse(hx, hy + 1.5, 5.2, 2.6, 0, 0, Math.PI);
      ctx.fill();
    } else ctx.fillRect(side ? hx - 5 : hx - 5.4, hy - 0.5, side ? 4 : 10.8, 2.2);
    return;
  }
  // long hair falls behind the shoulders (drawn first, under the crown)
  if (style === 'long') {
    if (back) {
      rrect(ctx, hx - 5.6, hy - 1, 11.2, 14, 4);
      lit(ctx, hair, hx - 6, hy, hx + 6, hy + 13, 16, -26);
    } else if (side) {
      rrect(ctx, hx - 6, hy - 2, 5.5, 13, 3);
      lit(ctx, shade(hair, -10), hx - 6, hy, hx, hy + 12, 14, -24);
    } else {
      rrect(ctx, hx - 6.4, hy - 1, 2.8, 11, 1.4);
      lit(ctx, hair, hx - 7, hy, hx - 3, hy + 10, 14, -22);
      rrect(ctx, hx + 3.6, hy - 1, 2.8, 11, 1.4);
      lit(ctx, shade(hair, -10), hx + 3, hy, hx + 7, hy + 10, 14, -22);
    }
  }
  // the crown: from a little above, the hair covers the top of the head
  ctx.beginPath();
  if (back) ctx.ellipse(hx, hy - 0.2, 5.6, 5.8, 0, 0, Math.PI * 2);
  else if (side) {
    ctx.ellipse(hx - 0.8, hy - 1.6, 5.5, 4.4, -0.15, Math.PI * 0.85, Math.PI * 2.05);
    ctx.lineTo(hx - 5.6, hy + 2.6);
  } else ctx.ellipse(hx, hy - 1.8, 5.7, 4.2, 0, Math.PI * 0.92, Math.PI * 2.08);
  ctx.closePath();
  lit(ctx, hair, hx - 6, hy - 7, hx + 6, hy + 2, 20, -24);
  // a few strands of light
  ctx.strokeStyle = shade(hair, 30);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(hx - 3, hy - 4.2);
  ctx.quadraticCurveTo(hx - 1, hy - 5.4, hx + 1.5, hy - 4.8);
  ctx.stroke();
  if (style === 'messy' && !back) {
    ctx.fillStyle = hair;
    for (const dx of [-3.5, -1, 1.8]) {
      ctx.beginPath();
      ctx.moveTo(hx + dx, hy - 2.5);
      ctx.lineTo(hx + dx + 1, hy + 0.3);
      ctx.lineTo(hx + dx + 2.2, hy - 2.5);
      ctx.fill();
    }
  }
  if (style === 'bun') {
    const bx = side ? hx - 4.5 : hx;
    const by = side ? hy - 4 : hy - 6;
    blob(ctx, bx, by, 2.6, 2.4, hair, 20, -24);
  }
}

/** Head-and-shoulders portrait (for dialogue) as a data URL. */
export function drawPortrait(look, size = 72) {
  const sheet = drawCharacterSheet(look);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Crop the idle-down frame round the head and shoulders, and scale it up.
  ctx.drawImage(sheet, 6, 3, 20, 25, 0, 2, size, size * 1.25);
  return c.toDataURL();
}
