/**
 * Farm animals (chickens, sheep, cows — two walking frames each, and a shorn sheep) and the
 * icons for what they give (eggs, milk, wool) and eat (hay). Drawn in code like the rest.
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
function legs(ctx, list, top, bottom, color, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (const [x, dx] of list) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + dx, bottom);
    ctx.stroke();
  }
}

function drawChicken(frame) {
  const c = makeCanvas(18, 18);
  const ctx = c.getContext('2d');
  legs(ctx, frame ? [[7, -1], [10, 1]] : [[7, 1], [10, -1]], 12, 17, '#d98a2a', 1.4);
  ellipse(ctx, 9, 10, 6, 4.5, '#f4efe4'); // body
  ellipse(ctx, 4.5, 8, 2.5, 3, '#e6ddcc'); // tail
  ellipse(ctx, 13, 6, 3, 3, '#f7f3ea'); // head
  ellipse(ctx, 13, 3, 1.4, 1.2, '#d8342a'); // comb
  ctx.fillStyle = '#e9a23a';
  ctx.beginPath();
  ctx.moveTo(15.5, 6);
  ctx.lineTo(18, 7);
  ctx.lineTo(15.5, 7.8);
  ctx.fill();
  ellipse(ctx, 14, 5.5, 0.6, 0.6, '#1a1a1a');
  return c;
}

function drawSheep(frame, shorn = false) {
  const c = makeCanvas(28, 22);
  const ctx = c.getContext('2d');
  legs(ctx, frame ? [[8, 2], [11, -1], [18, -1], [21, 2]] : [[8, -1], [11, 2], [18, 2], [21, -1]], 13, 21, '#3a3230', 2);
  if (shorn) ellipse(ctx, 14, 11, 9, 5, '#e9dccb');
  else {
    // Fleece: a bundle of little puffs.
    for (const [x, y, r] of [[8, 10, 4], [12, 8, 4.5], [17, 8, 4.5], [21, 10, 4], [10, 13, 4], [15, 13, 4.5], [20, 13, 4]]) ellipse(ctx, x, y, r, r * 0.9, '#f3efe6');
    for (const [x, y] of [[10, 9], [16, 7], [19, 12]]) ellipse(ctx, x, y, 1.5, 1.2, '#e0d9cc');
  }
  ellipse(ctx, 24, 9, 3.2, 3.6, '#3a3230'); // head
  ellipse(ctx, 22.5, 6.5, 1.6, 1, '#3a3230'); // ear
  ellipse(ctx, 25, 8.4, 0.6, 0.6, '#f0f0f0');
  return c;
}

function drawCow(frame) {
  const c = makeCanvas(34, 26);
  const ctx = c.getContext('2d');
  legs(ctx, frame ? [[9, 2], [12, -1], [22, -1], [25, 2]] : [[9, -1], [12, 2], [22, 2], [25, -1]], 15, 25, '#5a4a40', 2.6);
  ellipse(ctx, 17, 12, 11, 6.5, '#f2ede4'); // body
  for (const [x, y, rx, ry] of [[12, 10, 4, 3], [20, 13, 3.5, 2.5], [16, 8, 2.5, 1.8]]) ellipse(ctx, x, y, rx, ry, '#3b2f2a'); // patches
  ellipse(ctx, 17, 17.5, 3, 1.6, '#e8a6a6'); // udder
  ellipse(ctx, 29, 9, 4, 4.5, '#f2ede4'); // head
  ellipse(ctx, 31, 11.5, 2.6, 2, '#e8b8a8'); // muzzle
  ellipse(ctx, 28.5, 7.5, 0.8, 0.8, '#1a1a1a');
  ctx.strokeStyle = '#d8ccb0';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(27, 5);
  ctx.lineTo(25.5, 2.5);
  ctx.moveTo(30.5, 5);
  ctx.lineTo(32, 2.5);
  ctx.stroke();
  ctx.strokeStyle = '#3b2f2a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(6, 10);
  ctx.quadraticCurveTo(3, 14, 4, 18); // tail
  ctx.stroke();
  return c;
}

/** Item icons (32×32). */
export const FARM_ICONS = {
  egg(ctx) {
    ellipse(ctx, 13, 18, 6, 8, '#f3e7d2');
    ellipse(ctx, 21, 20, 5.5, 7, '#e8d2b0');
    ellipse(ctx, 11.5, 15, 1.5, 2.5, 'rgba(255,255,255,0.7)');
  },
  milk(ctx) {
    // A pail.
    ctx.fillStyle = '#9aa4ad';
    ctx.beginPath();
    ctx.moveTo(8, 11);
    ctx.lineTo(24, 11);
    ctx.lineTo(22, 28);
    ctx.lineTo(10, 28);
    ctx.closePath();
    ctx.fill();
    ellipse(ctx, 16, 11, 8, 2.5, '#fbfbf6');
    ctx.strokeStyle = '#6d7780';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(16, 11, 9, Math.PI, 0);
    ctx.stroke();
  },
  wool(ctx) {
    for (const [x, y, r] of [[11, 17, 6], [18, 14, 6], [21, 20, 6], [14, 22, 5.5]]) ellipse(ctx, x, y, r, r, '#f2ece0');
    for (const [x, y] of [[12, 16], [19, 15], [20, 21]]) ellipse(ctx, x, y, 2, 1.5, '#ddd4c4');
  },
  omelette(ctx) {
    ellipse(ctx, 16, 19, 12, 7, '#7a7f86'); // the pan
    ellipse(ctx, 16, 18, 9, 5, '#f2cf5a');
    ellipse(ctx, 13, 17, 2.5, 1.5, '#fbe89a');
    ctx.fillStyle = '#5a4030';
    ctx.fillRect(26, 17, 6, 3);
  },
  hay(ctx) {
    // A bale.
    ctx.fillStyle = '#d9b75a';
    ctx.fillRect(5, 11, 22, 15);
    ctx.fillStyle = '#c29d44';
    for (let x = 7; x < 26; x += 3) ctx.fillRect(x, 12, 1, 13);
    ctx.fillStyle = '#8a6a2a';
    ctx.fillRect(10, 11, 2, 15);
    ctx.fillRect(20, 11, 2, 15);
  },
};

export function createFarmTextures(scene, addCanvas) {
  for (const f of [0, 1]) {
    addCanvas(scene, `chicken_${f}`, drawChicken(f));
    addCanvas(scene, `sheep_${f}`, drawSheep(f));
    addCanvas(scene, `sheep_shorn_${f}`, drawSheep(f, true));
    addCanvas(scene, `cow_${f}`, drawCow(f));
  }
}
