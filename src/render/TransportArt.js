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

// ------------------------------------------------------------------ equipment (EquipmentSystem)
// Drawn facing right, without a person (the villager pushing it is drawn beside it).

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawBasket() {
  const c = makeCanvas(12, 10);
  const ctx = c.getContext('2d');
  rect(ctx, 1, 3, 10, 6, '#c9a05a');
  ctx.strokeStyle = '#8a6a34';
  ctx.lineWidth = 1;
  for (let x = 2; x < 11; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, 3);
    ctx.lineTo(x, 9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(6, 3, 4, Math.PI, 0);
  ctx.stroke();
  return c;
}

function drawSack() {
  const c = makeCanvas(10, 12);
  const ctx = c.getContext('2d');
  ellipse(ctx, 5, 7.5, 4.5, 4.5, '#c8b48a');
  rect(ctx, 3, 1, 4, 3, '#b8a47a');
  rect(ctx, 3, 3, 4, 1, '#7a6a4a');
  return c;
}

function drawCrate() {
  const c = makeCanvas(12, 10);
  const ctx = c.getContext('2d');
  rect(ctx, 0, 1, 12, 9, '#a8763e');
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 1.5, 11, 8);
  ctx.beginPath();
  ctx.moveTo(0, 5.5);
  ctx.lineTo(12, 5.5);
  ctx.stroke();
  return c;
}

/** A wheelbarrow: 26×16 — the handles to the left (towards whoever pushes it). */
function drawWheelbarrow(frame) {
  const c = makeCanvas(26, 16);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.lineTo(20, 10);
  ctx.stroke();
  ctx.fillStyle = '#8a8f96';
  ctx.beginPath();
  ctx.moveTo(6, 4);
  ctx.lineTo(20, 4);
  ctx.lineTo(17, 11);
  ctx.lineTo(8, 11);
  ctx.closePath();
  ctx.fill();
  rect(ctx, 6, 4, 14, 1, '#b5b9be');
  rect(ctx, 9, 11, 2, 4, '#5a3c22');
  wheel(ctx, 21, 12, 3.5, frame);
  return c;
}

/** A handcart: 30×18. */
function drawHandcartOnly(frame) {
  const c = makeCanvas(30, 18);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 9);
  ctx.stroke();
  rect(ctx, 7, 5, 22, 7, '#9a6e3a');
  rect(ctx, 7, 11, 22, 2, '#7a5230');
  rect(ctx, 7, 4, 22, 1, '#b8864e');
  wheel(ctx, 18, 13, 4.5, frame);
  return c;
}

/** A wooden wagon (drawn by hand, or later a horse): 40×22. */
function drawWoodenWagon(frame) {
  const c = makeCanvas(40, 22);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#5a3c22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(8, 12);
  ctx.stroke();
  rect(ctx, 7, 6, 32, 9, '#8f6436');
  rect(ctx, 7, 5, 32, 2, '#b08050');
  rect(ctx, 7, 14, 32, 2, '#6b4a2b');
  wheel(ctx, 13, 17, 4.5, frame);
  wheel(ctx, 33, 17, 4.5, frame);
  return c;
}

/** A pack horse: 30×26. */
function drawPackHorse(frame) {
  const c = makeCanvas(30, 26);
  const ctx = c.getContext('2d');
  const legs = frame ? [[8, 2], [11, -2], [18, -2], [21, 2]] : [[8, -2], [11, 2], [18, 2], [21, -2]];
  ctx.strokeStyle = '#4a3020';
  ctx.lineWidth = 2;
  for (const [x, dx] of legs) {
    ctx.beginPath();
    ctx.moveTo(x, 15);
    ctx.lineTo(x + dx * 0.5, 25);
    ctx.stroke();
  }
  ellipse(ctx, 15, 12, 9, 5, '#8a5a34');
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath();
  ctx.moveTo(21, 10);
  ctx.lineTo(25, 2);
  ctx.lineTo(28, 4);
  ctx.lineTo(25, 12);
  ctx.closePath();
  ctx.fill();
  rect(ctx, 23, 2, 3, 7, '#2a1a10');
  rect(ctx, 9, 6, 5, 8, '#c8b48a');
  rect(ctx, 15, 6, 5, 8, '#b8a47a');
  return c;
}

/** A load on top (wood, stone or goods): 16×7. */
function drawLoad(kind) {
  const c = makeCanvas(16, 7);
  const ctx = c.getContext('2d');
  if (kind === 'wood') {
    for (let i = 0; i < 3; i++) {
      rect(ctx, 1 + i, 4 - i * 2, 14 - i * 2, 2, i % 2 ? '#a0703c' : '#8a5a30');
      ellipse(ctx, 1.5 + i, 5 - i * 2, 1, 1, '#d8b07a');
    }
  } else if (kind === 'stone') {
    ellipse(ctx, 4, 5, 3.5, 2, '#9a958b');
    ellipse(ctx, 9, 4, 4, 2.5, '#aaa59b');
    ellipse(ctx, 13, 5, 3, 2, '#8a857b');
  } else {
    rect(ctx, 1, 2, 6, 5, '#b8864e');
    rect(ctx, 8, 1, 7, 6, '#c8b48a');
  }
  return c;
}

export function createEquipmentTextures(scene, addCanvas) {
  for (const f of [0, 1]) {
    addCanvas(scene, `eq_basket_${f}`, drawBasket());
    addCanvas(scene, `eq_sack_${f}`, drawSack());
    addCanvas(scene, `eq_crate_${f}`, drawCrate());
    addCanvas(scene, `eq_wheelbarrow_${f}`, drawWheelbarrow(f));
    addCanvas(scene, `eq_handcart_${f}`, drawHandcartOnly(f));
    addCanvas(scene, `eq_wooden_wagon_${f}`, drawWoodenWagon(f));
    addCanvas(scene, `eq_pack_horse_${f}`, drawPackHorse(f));
    addCanvas(scene, `eq_horse_cart_${f}`, drawHorseCart(f));
    addCanvas(scene, `eq_wagon_${f}`, drawHorseCart(f));
  }
  for (const k of ['wood', 'stone', 'misc']) addCanvas(scene, `eq_load_${k}`, drawLoad(k));
  addCanvas(scene, 'eq_bundle', drawSack());
}

export function createTransportTextures(scene, addCanvas) {
  createEquipmentTextures(scene, addCanvas);
  for (const f of [0, 1]) {
    addCanvas(scene, `porter_${f}`, drawPorter(f));
    addCanvas(scene, `handcart_${f}`, drawHandcart(f));
    addCanvas(scene, `horse_cart_${f}`, drawHorseCart(f));
    addCanvas(scene, `wagon_${f}`, drawHorseCart(f));
  }
}
