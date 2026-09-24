/**
 * NatureArt — procedural art for fishing, hunting and wildlife:
 * item icons (fish, rod, bow, meat, hide…) and animal sprites (deer, rabbit).
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function fishShape(ctx, x, y, s, body, belly) {
  ellipse(ctx, x, y, 9 * s, 4.5 * s, body);
  ellipse(ctx, x + 1 * s, y + 1.5 * s, 6 * s, 2 * s, belly);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - 8 * s, y);
  ctx.lineTo(x - 14 * s, y - 5 * s);
  ctx.lineTo(x - 14 * s, y + 5 * s);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, x + 5.5 * s, y - 1 * s, 1.2 * s, 1.2 * s, '#1a1a1a');
}

export const NATURE_ICONS = {
  fish(ctx) {
    fishShape(ctx, 18, 16, 1, '#5d8fb0', '#cfe3ee');
  },
  grilled_fish(ctx) {
    ellipse(ctx, 16, 22, 13, 5, '#e8e1d0');
    fishShape(ctx, 18, 17, 0.95, '#a8672e', '#d9a060');
    ctx.strokeStyle = '#5a3414';
    ctx.lineWidth = 1.2;
    for (const x of [12, 16, 20]) {
      ctx.beginPath();
      ctx.moveTo(x, 13);
      ctx.lineTo(x + 3, 20);
      ctx.stroke();
    }
  },
  gemstone(ctx) {
    ctx.fillStyle = '#3aa0c8';
    ctx.beginPath();
    ctx.moveTo(16, 6);
    ctx.lineTo(25, 13);
    ctx.lineTo(16, 27);
    ctx.lineTo(7, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9ae0f5';
    ctx.beginPath();
    ctx.moveTo(16, 6);
    ctx.lineTo(20, 13);
    ctx.lineTo(12, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(13, 10, 2, 2);
  },
  iron_ingot(ctx) {
    ctx.fillStyle = '#5d6470';
    ctx.beginPath();
    ctx.moveTo(6, 22);
    ctx.lineTo(26, 22);
    ctx.lineTo(23, 14);
    ctx.lineTo(9, 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a93a2';
    ctx.fillRect(10, 14, 12, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(11, 15, 6, 1);
  },
  cabinet(ctx) {
    ctx.fillStyle = '#7a4f2c';
    ctx.fillRect(7, 5, 18, 23);
    ctx.fillStyle = '#9a6a3e';
    ctx.fillRect(9, 7, 6.5, 19);
    ctx.fillRect(16.5, 7, 6.5, 19);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(14, 15, 1.5, 3);
    ctx.fillRect(17, 15, 1.5, 3);
    ctx.fillStyle = '#5b3a20';
    ctx.fillRect(6, 4, 20, 2);
  },
  relic(ctx) {
    // An old bronze amulet on a chain.
    ctx.strokeStyle = '#8a7a50';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(16, 12, 9, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ellipse(ctx, 16, 20, 8, 8, '#a8753a');
    ellipse(ctx, 16, 20, 5.5, 5.5, '#c99a4e');
    ellipse(ctx, 16, 20, 2.5, 2.5, '#3f8f8a');
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(12, 16, 2, 2);
  },
  meat(ctx) {
    ellipse(ctx, 15, 17, 10, 8, '#b8424a');
    ellipse(ctx, 13, 15, 5, 3.5, '#e8a0a4');
    ctx.fillStyle = '#f0e6d8';
    ctx.fillRect(22, 18, 7, 3);
    ellipse(ctx, 29, 17.5, 2, 2.5, '#f0e6d8');
    ellipse(ctx, 29, 21.5, 2, 2.5, '#f0e6d8');
  },
  roast_meat(ctx) {
    ellipse(ctx, 16, 23, 13, 5, '#e8e1d0');
    ellipse(ctx, 15, 17, 10, 7, '#8a4a1e');
    ellipse(ctx, 12, 15, 4, 2.5, '#c07a3a');
    ctx.fillStyle = '#f0e6d8';
    ctx.fillRect(23, 16, 6, 3);
  },
  hide(ctx) {
    ctx.fillStyle = '#9a6a3e';
    ctx.beginPath();
    ctx.moveTo(6, 8);
    ctx.lineTo(12, 5);
    ctx.lineTo(20, 5);
    ctx.lineTo(26, 8);
    ctx.lineTo(28, 18);
    ctx.lineTo(24, 27);
    ctx.lineTo(8, 27);
    ctx.lineTo(4, 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b8864e';
    ellipse(ctx, 16, 16, 7, 6, '#b8864e');
  },
  fishing_rod(ctx) {
    ctx.strokeStyle = '#7a5230';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(5, 28);
    ctx.lineTo(26, 4);
    ctx.stroke();
    ctx.strokeStyle = '#dcdcdc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(26, 4);
    ctx.lineTo(27, 22);
    ctx.stroke();
    ellipse(ctx, 27, 23, 2, 2, '#d24a3a');
    ellipse(ctx, 9, 23, 3, 3, '#4a4a52');
  },
  bow(ctx) {
    ctx.strokeStyle = '#8a5a2e';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(8, 16, 13, -Math.PI / 2.4, Math.PI / 2.4);
    ctx.stroke();
    ctx.strokeStyle = '#e8e0cc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8 + 13 * Math.cos(-Math.PI / 2.4), 16 + 13 * Math.sin(-Math.PI / 2.4));
    ctx.lineTo(8 + 13 * Math.cos(Math.PI / 2.4), 16 + 13 * Math.sin(Math.PI / 2.4));
    ctx.stroke();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 16);
    ctx.lineTo(29, 16);
    ctx.stroke();
    ctx.fillStyle = '#9aa0a8';
    ctx.beginPath();
    ctx.moveTo(29, 16);
    ctx.lineTo(25, 13);
    ctx.lineTo(25, 19);
    ctx.closePath();
    ctx.fill();
  },
};

/** Deer: 30×26, two leg frames. */
function drawDeer(frame) {
  const c = makeCanvas(30, 26);
  const ctx = c.getContext('2d');
  const body = '#9a6a3e';
  const legs = frame ? [[8, 3], [11, -2], [19, -2], [22, 3]] : [[8, -2], [11, 3], [19, 3], [22, -2]];
  ctx.strokeStyle = '#6b4526';
  ctx.lineWidth = 2;
  for (const [x, dx] of legs) {
    ctx.beginPath();
    ctx.moveTo(x, 15);
    ctx.lineTo(x + dx * 0.4, 24);
    ctx.stroke();
  }
  ellipse(ctx, 15, 13, 10, 5, body);
  ellipse(ctx, 14, 15, 7, 2.5, '#c89a6a');
  ellipse(ctx, 6, 11, 2, 2.5, '#f2ece0'); // white tail
  // Neck and head
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(21, 12);
  ctx.lineTo(24, 4);
  ctx.lineTo(27, 5);
  ctx.lineTo(25, 13);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, 26, 5, 3.2, 2.3, body);
  ellipse(ctx, 28.5, 5.6, 1.2, 1, '#2a1d14');
  ellipse(ctx, 26.4, 4.4, 0.7, 0.7, '#1a1a1a');
  // Antlers
  ctx.strokeStyle = '#d8c8a0';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(25, 3);
  ctx.lineTo(23, 0);
  ctx.moveTo(24, 1.5);
  ctx.lineTo(22, 1.5);
  ctx.moveTo(26, 3);
  ctx.lineTo(27, 0);
  ctx.stroke();
  return c;
}

/** Rabbit: 16×14, hopping frames. */
function drawRabbit(frame) {
  const c = makeCanvas(16, 14);
  const ctx = c.getContext('2d');
  const fur = '#a89078';
  const y = frame ? 7 : 8;
  ellipse(ctx, 7, y + 1, 5, 3.5, fur);
  ellipse(ctx, 11.5, y - 1.5, 2.8, 2.4, fur);
  ellipse(ctx, 11, y - 5.5, 0.9, 2.6, fur);
  ellipse(ctx, 12.6, y - 5.3, 0.9, 2.6, '#9a8068');
  ellipse(ctx, 2.3, y, 1.6, 1.6, '#f2ece0');
  ellipse(ctx, 12.8, y - 2, 0.6, 0.6, '#1a1a1a');
  ctx.fillStyle = '#8a745e';
  ctx.fillRect(4, y + 3.5, 3, frame ? 1.5 : 2.5);
  ctx.fillRect(9, y + 3.5, 2, frame ? 2.5 : 1.5);
  return c;
}

/** A soft flame blob for fire particles. */
function drawFlame() {
  const c = makeCanvas(16, 16);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8, 9, 1, 8, 9, 8);
  g.addColorStop(0, 'rgba(255,245,180,1)');
  g.addColorStop(0.35, 'rgba(255,170,40,0.95)');
  g.addColorStop(0.7, 'rgba(230,70,20,0.6)');
  g.addColorStop(1, 'rgba(200,40,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(8, 9, 8, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function createNatureTextures(scene, addCanvas) {
  addCanvas(scene, 'flame', drawFlame());
  for (const f of [0, 1]) {
    addCanvas(scene, `deer_${f}`, drawDeer(f));
    addCanvas(scene, `rabbit_${f}`, drawRabbit(f));
  }
}
