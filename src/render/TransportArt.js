/**
 * TransportArt — porters and carts carrying goods along the roads.
 * Two frames each (legs / wheels) so they visibly move.
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

function person(ctx, x, frame, shirt = '#6a5a8a') {
  // legs
  ctx.fillStyle = '#3d3a4f';
  ctx.fillRect(x - 3, 20, 2, 7 - (frame ? 2 : 0));
  ctx.fillRect(x + 1, 20, 2, 7 - (frame ? 0 : 2));
  // body and head
  ctx.fillStyle = shirt;
  ctx.fillRect(x - 4, 12, 8, 9);
  ellipse(ctx, x, 9, 3.5, 3.5, '#e8b98f');
  ctx.fillStyle = '#4a2f1d';
  ctx.fillRect(x - 3.5, 5.5, 7, 2.5);
}

/** A porter with a sack on his back: 18×28. */
function drawPorter(frame) {
  const c = makeCanvas(18, 28);
  const ctx = c.getContext('2d');
  person(ctx, 8, frame, '#8a6a3a');
  ellipse(ctx, 11, 12, 5, 6, '#c9a56a');
  ctx.strokeStyle = '#7a5a30';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 10);
  ctx.lineTo(13, 8);
  ctx.stroke();
  return c;
}

function wheel(ctx, x, y, r, frame) {
  ctx.strokeStyle = '#3b2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  const a = frame ? Math.PI / 4 : 0;
  for (let i = 0; i < 2; i++) {
    const ang = a + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang) * r, y - Math.sin(ang) * r);
    ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
    ctx.stroke();
  }
}

/** A handcart pushed by a carter: 34×28 (cargo drawn separately as a tint block). */
function drawHandcart(frame) {
  const c = makeCanvas(34, 28);
  const ctx = c.getContext('2d');
  person(ctx, 6, frame, '#4e6a8a');
  ctx.fillStyle = '#9a6e3a';
  ctx.fillRect(12, 13, 20, 8);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(12, 20, 20, 2);
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 16);
  ctx.lineTo(8, 15);
  ctx.stroke();
  // cargo
  ctx.fillStyle = '#b8864e';
  ctx.fillRect(14, 8, 7, 6);
  ctx.fillStyle = '#a8763e';
  ctx.fillRect(22, 9, 8, 5);
  wheel(ctx, 24, 23, 4.5, frame);
  return c;
}

/** A horse cart: 48×30. */
function drawHorseCart(frame) {
  const c = makeCanvas(48, 30);
  const ctx = c.getContext('2d');
  // horse
  const legs = frame ? [[31, 2], [34, -2], [41, -2], [44, 2]] : [[31, -2], [34, 2], [41, 2], [44, -2]];
  ctx.strokeStyle = '#4a3020';
  ctx.lineWidth = 2;
  for (const [x, dx] of legs) {
    ctx.beginPath();
    ctx.moveTo(x, 17);
    ctx.lineTo(x + dx * 0.5, 27);
    ctx.stroke();
  }
  ellipse(ctx, 38, 14, 8, 5, '#7a4e2e');
  ctx.fillStyle = '#7a4e2e';
  ctx.beginPath();
  ctx.moveTo(43, 12);
  ctx.lineTo(46, 5);
  ctx.lineTo(48, 7);
  ctx.lineTo(46, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(41, 5, 3, 7);
  // cart
  ctx.fillStyle = '#9a6e3a';
  ctx.fillRect(2, 12, 24, 9);
  ctx.fillStyle = '#b8864e';
  ctx.fillRect(4, 6, 9, 7);
  ctx.fillRect(14, 7, 10, 6);
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(26, 15);
  ctx.lineTo(32, 14);
  ctx.stroke();
  wheel(ctx, 14, 23, 5, frame);
  return c;
}

export function createTransportTextures(scene, addCanvas) {
  for (const f of [0, 1]) {
    addCanvas(scene, `porter_${f}`, drawPorter(f));
    addCanvas(scene, `handcart_${f}`, drawHandcart(f));
    addCanvas(scene, `horse_cart_${f}`, drawHorseCart(f));
    addCanvas(scene, `wagon_${f}`, drawHorseCart(f));
  }
}
