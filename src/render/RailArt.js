/**
 * The railway: a steam locomotive, a passenger coach and a goods wagon (side views, facing right —
 * flipped to go left), drawn in code like the rest.
 */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function circle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function wheels(ctx, xs, y, r, frame) {
  for (const x of xs) {
    circle(ctx, x, y, r, '#2a2a2e');
    circle(ctx, x, y, r - 2, '#6a6a72');
    ctx.strokeStyle = '#2a2a2e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const a = frame ? Math.PI / 4 : 0;
    ctx.moveTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2));
    ctx.lineTo(x - Math.cos(a) * (r - 2), y - Math.sin(a) * (r - 2));
    ctx.stroke();
  }
}

function drawLoco(frame) {
  const c = makeCanvas(58, 40);
  const ctx = c.getContext('2d');
  // Boiler, smokebox, chimney, cab.
  ctx.fillStyle = '#2f5a3a';
  ctx.fillRect(10, 14, 30, 14);
  ctx.fillStyle = '#244a30';
  ctx.fillRect(10, 24, 30, 4);
  ctx.fillStyle = '#26282c';
  ctx.fillRect(38, 13, 10, 16);
  ctx.fillRect(41, 3, 5, 11); // chimney
  ctx.fillRect(40, 2, 7, 3);
  ctx.fillStyle = '#c9a23a';
  ctx.fillRect(24, 10, 5, 5); // dome
  ctx.fillRect(10, 20, 30, 1.5); // brass band
  ctx.fillStyle = '#7a2a22';
  ctx.fillRect(1, 8, 13, 21); // cab
  ctx.fillStyle = '#5a1e18';
  ctx.fillRect(0, 6, 15, 3); // cab roof
  ctx.fillStyle = '#f2dc8a';
  ctx.fillRect(4, 12, 6, 6); // cab window (lit)
  ctx.fillStyle = '#1e1e22';
  ctx.fillRect(0, 28, 52, 3); // frame
  ctx.fillStyle = '#b01e1e';
  ctx.fillRect(50, 27, 6, 3); // buffer beam
  wheels(ctx, [9, 22, 35], 33, 6, frame);
  wheels(ctx, [47], 35, 4, frame);
  // Coupling rod.
  ctx.strokeStyle = '#b8b8c0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const dy = frame ? 2 : -2;
  ctx.moveTo(9, 33 + dy);
  ctx.lineTo(35, 33 + dy);
  ctx.stroke();
  return c;
}

function drawCoach(frame) {
  const c = makeCanvas(50, 36);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6a2a24';
  ctx.fillRect(1, 8, 48, 20);
  ctx.fillStyle = '#4a1e1a';
  ctx.fillRect(0, 5, 50, 4);
  ctx.fillStyle = '#c9a23a';
  ctx.fillRect(1, 22, 48, 1.5);
  for (let x = 5; x < 45; x += 10) {
    ctx.fillStyle = '#f2dc8a';
    ctx.fillRect(x, 11, 7, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, 11, 7, 2);
  }
  ctx.fillStyle = '#1e1e22';
  ctx.fillRect(0, 28, 50, 2);
  wheels(ctx, [9, 41], 31, 4.5, frame);
  return c;
}

function drawWagon(frame) {
  const c = makeCanvas(46, 34);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(1, 12, 44, 14);
  ctx.fillStyle = '#5a4028';
  for (let x = 1; x < 45; x += 7) ctx.fillRect(x, 12, 1.5, 14);
  // A load under a sheet.
  ctx.fillStyle = '#8a8a6a';
  ctx.beginPath();
  ctx.moveTo(3, 12);
  ctx.quadraticCurveTo(23, 0, 43, 12);
  ctx.fill();
  ctx.fillStyle = '#1e1e22';
  ctx.fillRect(0, 26, 46, 2);
  wheels(ctx, [9, 37], 29, 4.5, frame);
  return c;
}

export function createRailTextures(scene, addCanvas) {
  for (const f of [0, 1]) {
    addCanvas(scene, `train_loco_${f}`, drawLoco(f));
    addCanvas(scene, `train_coach_${f}`, drawCoach(f));
    addCanvas(scene, `train_wagon_${f}`, drawWagon(f));
  }
}
