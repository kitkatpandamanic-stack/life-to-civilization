/**
 * SiteArt — places to discover in the valley: a cave mouth in the rocks, the
 * ruins of an old homestead, an abandoned cabin in the woods, an old mine shaft,
 * a ring of standing stones, a derelict waystation on the old road.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

function cave() {
  const c = makeCanvas(56, 44);
  const ctx = c.getContext('2d');
  ellipse(ctx, 28, 41, 26, 3, 'rgba(0,0,0,0.25)');
  poly(ctx, [[2, 42], [8, 14], [20, 4], [36, 3], [50, 12], [54, 42]], '#7d7a74');
  poly(ctx, [[8, 14], [20, 4], [30, 8], [16, 20]], '#99958d');
  poly(ctx, [[16, 42], [18, 24], [28, 18], [38, 24], [40, 42]], '#1a1714');
  poly(ctx, [[20, 42], [22, 30], [28, 26], [34, 30], [36, 42]], '#0d0b09');
  ctx.fillStyle = '#5d5a54';
  ctx.fillRect(6, 30, 6, 3);
  ctx.fillRect(44, 26, 5, 3);
  return c;
}

function ruin() {
  const c = makeCanvas(56, 40);
  const ctx = c.getContext('2d');
  ellipse(ctx, 28, 37, 26, 3, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = '#9a9384';
  ctx.fillRect(4, 18, 6, 20);
  ctx.fillRect(4, 32, 22, 6);
  ctx.fillRect(34, 10, 6, 28);
  ctx.fillRect(34, 32, 18, 6);
  ctx.fillRect(18, 26, 5, 12);
  ctx.fillStyle = '#b2ab9b';
  for (const [x, y] of [[4, 18], [34, 10], [18, 26]]) ctx.fillRect(x, y, 6, 2);
  ctx.fillStyle = '#6e8f4a';
  for (const [x, y] of [[12, 34], [28, 35], [45, 30], [8, 24]]) ellipse(ctx, x, y, 3, 2, '#6e8f4a');
  return c;
}

function cabin() {
  const c = makeCanvas(52, 48);
  const ctx = c.getContext('2d');
  ellipse(ctx, 26, 45, 24, 3, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = '#6b4c30';
  ctx.fillRect(6, 20, 40, 24);
  ctx.fillStyle = '#58391f';
  for (let y = 22; y < 44; y += 5) ctx.fillRect(6, y, 40, 1);
  poly(ctx, [[2, 22], [26, 6], [50, 22]], '#5a4a3a');
  poly(ctx, [[20, 12], [30, 8], [34, 16], [24, 18]], '#2a2420'); // hole in the roof
  ctx.fillStyle = '#2a1d14';
  ctx.fillRect(21, 30, 10, 14);
  ctx.strokeStyle = '#8a6a4a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(22, 30);
  ctx.lineTo(30, 44);
  ctx.stroke(); // a board nailed across the door
  ctx.fillStyle = '#1a1612';
  ctx.fillRect(36, 26, 6, 5);
  return c;
}

function mineshaft() {
  const c = makeCanvas(48, 44);
  const ctx = c.getContext('2d');
  ellipse(ctx, 24, 40, 20, 4, '#1a1612');
  ellipse(ctx, 24, 40, 14, 3, '#0a0806');
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(8, 10, 4, 30);
  ctx.fillRect(36, 10, 4, 30);
  ctx.fillRect(6, 8, 36, 4);
  ctx.strokeStyle = '#5a4a3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 12);
  ctx.lineTo(24, 34);
  ctx.stroke();
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(21, 32, 6, 4);
  return c;
}

function stones() {
  const c = makeCanvas(56, 44);
  const ctx = c.getContext('2d');
  ellipse(ctx, 28, 40, 26, 4, 'rgba(0,0,0,0.2)');
  for (const [x, h] of [[8, 26], [22, 34], [36, 30], [48, 22]]) {
    poly(ctx, [[x - 5, 40], [x - 4, 40 - h], [x + 1, 40 - h - 3], [x + 5, 40 - h + 1], [x + 5, 40]], '#8f8a82');
    ctx.fillStyle = '#6f8a58';
    ctx.fillRect(x - 5, 38, 10, 2);
  }
  return c;
}

function waystation() {
  const c = makeCanvas(56, 48);
  const ctx = c.getContext('2d');
  ellipse(ctx, 28, 45, 26, 3, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = '#a89a80';
  ctx.fillRect(4, 18, 48, 26);
  ctx.fillStyle = '#8f826a';
  for (let y = 22; y < 44; y += 6) for (let x = (y / 6) % 2 ? 4 : 10; x < 52; x += 12) ctx.fillRect(x, y, 10, 1);
  poly(ctx, [[0, 20], [14, 6], [30, 10], [22, 20]], '#6a4a3a'); // what's left of the roof
  ctx.fillStyle = '#2a2420';
  ctx.fillRect(22, 30, 12, 14);
  ctx.fillStyle = '#3a3028';
  ctx.fillRect(8, 26, 8, 7);
  ctx.fillRect(40, 26, 8, 7);
  // An old sign
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(46, 4, 2, 14);
  ctx.fillStyle = '#9a7048';
  ctx.fillRect(40, 4, 14, 6);
  return c;
}

export const SITE_TEXTURES = { cave, ruin, cabin, mineshaft, stones, waystation };

export function createSiteTextures(scene, addCanvas) {
  for (const [kind, draw] of Object.entries(SITE_TEXTURES)) addCanvas(scene, `site_${kind}`, draw());
}
