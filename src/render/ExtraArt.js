/**
 * ExtraArt — procedural art added in Version 2:
 *   • item icons for new items (planks, vegetables, seeds, furniture, tools)
 *   • home interiors (room shells + furniture)
 * Everything is drawn with Canvas2D, like the rest of the game's art.
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

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
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

function toolHandle(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ---------------------------------------------------------------- item icons

function seedPouch(color) {
  return (ctx) => {
    ctx.fillStyle = '#c9a56a';
    rrect(ctx, 8, 9, 16, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#a8844a';
    ctx.fillRect(10, 8, 12, 4);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 12);
    ctx.lineTo(22, 12);
    ctx.stroke();
    circle(ctx, 16, 19, 4, color);
    circle(ctx, 14.5, 17.5, 1.3, 'rgba(255,255,255,0.6)');
  };
}

export const EXTRA_ICONS = {
  planks(ctx) {
    for (const [y, c] of [[20, '#b08050'], [14, '#c99a62'], [8, '#b58858']]) {
      ctx.fillStyle = c;
      ctx.fillRect(4, y, 24, 5);
      ctx.fillStyle = 'rgba(80,50,20,0.4)';
      ctx.fillRect(4, y + 4, 24, 1);
      ctx.fillRect(12, y + 1, 1, 3);
    }
  },
  bricks(ctx) {
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = row % 2 ? '#b5543a' : '#c0603f';
        ctx.fillRect(4 + i * 12 + (row % 2) * 4, 8 + row * 7, 11, 6);
      }
    }
  },
  glass(ctx) {
    // Two panes leaning on each other.
    for (const [x, y] of [[6, 8], [12, 11]]) {
      ctx.fillStyle = 'rgba(160,210,235,0.75)';
      ctx.fillRect(x, y, 14, 16);
      ctx.strokeStyle = '#5e8fb3';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, 13, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x + 3, y + 3, 2, 8);
    }
  },
  clay(ctx) {
    ellipse(ctx, 16, 20, 11, 7, '#b0764a');
    ellipse(ctx, 14, 17, 7, 4, '#c98a5a');
    circle(ctx, 20, 18, 2, '#9a6440');
  },
  carrot(ctx) {
    ctx.fillStyle = '#e8822a';
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(22, 12);
    ctx.lineTo(9, 28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4f9a3f';
    for (const [x, y] of [[13, 4], [17, 5], [20, 7]]) ctx.fillRect(x, y, 2, 7);
  },
  potato(ctx) {
    ellipse(ctx, 16, 18, 10, 7, '#c9a063');
    for (const [x, y] of [[12, 16], [18, 20], [20, 15]]) circle(ctx, x, y, 1.2, '#8a6a3a');
  },
  cabbage(ctx) {
    circle(ctx, 16, 18, 10, '#7cbc58');
    circle(ctx, 16, 18, 6.5, '#a6d88a');
    ctx.strokeStyle = '#5a9a3f';
    ctx.beginPath();
    ctx.arc(16, 18, 8.5, 0.3, 2.6);
    ctx.stroke();
  },
  pumpkin(ctx) {
    ellipse(ctx, 16, 19, 12, 9, '#e0801e');
    for (const x of [11, 16, 21]) ellipse(ctx, x, 19, 2, 8, '#c86a12');
    ctx.fillStyle = '#5a8a2a';
    ctx.fillRect(15, 7, 3, 5);
  },
  vegetable_soup(ctx) {
    ellipse(ctx, 16, 20, 12, 7, '#6a4a2a');
    ellipse(ctx, 16, 17, 11, 4.5, '#d09a3a');
    for (const [x, y, c] of [[11, 17, '#e8822a'], [16, 16, '#7cbc58'], [21, 17, '#c9a063']]) circle(ctx, x, y, 2, c);
  },
  wheat_seeds: seedPouch('#e8c65a'),
  carrot_seeds: seedPouch('#e8822a'),
  potato_seeds: seedPouch('#c9a063'),
  cabbage_seeds: seedPouch('#7cbc58'),
  pumpkin_seeds: seedPouch('#e0801e'),
  stool(ctx) {
    ctx.fillStyle = '#a57846';
    ctx.fillRect(8, 11, 16, 5);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(9, 16, 3, 12);
    ctx.fillRect(20, 16, 3, 12);
  },
  chair(ctx) {
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(9, 4, 3, 24);
    ctx.fillRect(21, 16, 3, 12);
    ctx.fillStyle = '#a57846';
    ctx.fillRect(9, 15, 15, 4);
    ctx.fillRect(9, 5, 3, 10);
    ctx.fillRect(9, 7, 10, 3);
  },
  table(ctx) {
    ctx.fillStyle = '#a57846';
    ctx.fillRect(3, 11, 26, 5);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(5, 16, 3, 12);
    ctx.fillRect(24, 16, 3, 12);
  },
  iron_axe(ctx) {
    toolHandle(ctx, 8, 27, 22, 7);
    ctx.fillStyle = '#d6dde4';
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(28, 5);
    ctx.lineTo(27, 18);
    ctx.lineTo(18, 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7a8a9a';
    ctx.stroke();
  },
  iron_pickaxe(ctx) {
    toolHandle(ctx, 9, 28, 19, 8);
    ctx.strokeStyle = '#d6dde4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(4, 9);
    ctx.quadraticCurveTo(18, 0, 30, 12);
    ctx.stroke();
  },
  hammer(ctx) {
    toolHandle(ctx, 10, 28, 18, 10);
    ctx.fillStyle = '#8a929c';
    ctx.save();
    ctx.translate(19, 8);
    ctx.rotate(0.4);
    ctx.fillRect(-8, -4, 16, 8);
    ctx.restore();
  },
  saw(ctx) {
    ctx.fillStyle = '#c0c8d0';
    ctx.beginPath();
    ctx.moveTo(5, 22);
    ctx.lineTo(24, 8);
    ctx.lineTo(27, 12);
    ctx.lineTo(8, 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a929c';
    for (let i = 0; i < 6; i++) ctx.fillRect(8 + i * 3, 24 - i * 2.2, 2, 2);
    ctx.fillStyle = '#7a5230';
    rrect(ctx, 22, 4, 8, 9, 2);
    ctx.fill();
  },
  hoe(ctx) {
    toolHandle(ctx, 8, 28, 22, 6);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(19, 4, 10, 4);
    ctx.fillRect(25, 4, 4, 8);
  },
  watering_can(ctx) {
    ctx.fillStyle = '#6a9ac0';
    rrect(ctx, 7, 13, 16, 13, 3);
    ctx.fill();
    ctx.strokeStyle = '#4a7aa0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(22, 17);
    ctx.lineTo(29, 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(15, 13, 6, Math.PI, 0);
    ctx.stroke();
  },
};

// ---------------------------------------------------------------- furniture

const FURNITURE_SIZE = { bed: [32, 60], chest: [32, 30], table: [48, 40], workbench: [56, 44], stove: [34, 50], rug: [72, 40], plant: [24, 40], shelf: [32, 48], door_mat: [40, 16], fireplace: [44, 52] };

const FURNITURE_DRAW = {
  bed(ctx) {
    ellipse(ctx, 16, 57, 14, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(2, 2, 28, 12);
    ctx.fillStyle = '#8a5a32';
    ctx.fillRect(2, 12, 28, 44);
    ctx.fillStyle = '#f2eee4';
    rrect(ctx, 5, 14, 22, 10, 3);
    ctx.fill();
    ctx.fillStyle = '#b5483b';
    ctx.fillRect(4, 26, 24, 28);
    ctx.fillStyle = '#9a3a2e';
    for (let y = 30; y < 54; y += 6) ctx.fillRect(4, y, 24, 2);
  },
  chest(ctx) {
    ellipse(ctx, 16, 28, 14, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#8a5a32';
    ctx.fillRect(3, 8, 26, 18);
    ctx.fillStyle = '#a0703f';
    rrect(ctx, 2, 3, 28, 9, 4);
    ctx.fill();
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(3, 11, 26, 2);
    ctx.fillStyle = '#e0c060';
    ctx.fillRect(14, 11, 4, 6);
  },
  table(ctx) {
    ellipse(ctx, 24, 37, 22, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(5, 18, 4, 18);
    ctx.fillRect(39, 18, 4, 18);
    ctx.fillStyle = '#a57846';
    rrect(ctx, 1, 6, 46, 14, 3);
    ctx.fill();
    ellipse(ctx, 18, 11, 6, 3, '#e8e2d4');
    ellipse(ctx, 32, 11, 4, 3, '#d9822b');
  },
  workbench(ctx) {
    ellipse(ctx, 28, 41, 26, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(4, 20, 5, 20);
    ctx.fillRect(47, 20, 5, 20);
    ctx.fillRect(4, 30, 48, 3);
    ctx.fillStyle = '#9a7048';
    ctx.fillRect(1, 12, 54, 10);
    ctx.fillStyle = '#c0c8d0';
    ctx.fillRect(8, 6, 18, 4); // saw blade
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(24, 4, 6, 6);
    ctx.fillStyle = '#c99a62';
    ctx.fillRect(34, 8, 16, 4); // plank
  },
  stove(ctx) {
    ellipse(ctx, 17, 47, 15, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#5a5a60';
    ctx.fillRect(3, 14, 28, 32);
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(12, 0, 10, 16);
    ctx.fillStyle = '#ff8a2a';
    ctx.fillRect(9, 30, 16, 10);
    ctx.fillStyle = '#ffd05a';
    ctx.fillRect(12, 34, 10, 5);
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(3, 14, 28, 4);
  },
  rug(ctx) {
    ellipse(ctx, 36, 20, 34, 18, '#8a3a5a');
    ellipse(ctx, 36, 20, 28, 13, '#b5546a');
    ellipse(ctx, 36, 20, 18, 8, '#e0a856');
  },
  fireplace(ctx) {
    ellipse(ctx, 22, 49, 20, 3, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = '#8a7d6c';
    ctx.fillRect(2, 8, 40, 42);
    ctx.fillStyle = '#6e6356';
    for (let y = 10; y < 48; y += 7) for (let x = (y / 7) % 2 ? 2 : 6; x < 40; x += 9) ctx.fillRect(x, y, 7, 1);
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(0, 6, 44, 5);
    ctx.fillStyle = '#1e1612';
    ctx.fillRect(10, 24, 24, 24);
    ctx.fillStyle = '#ff8a2a';
    ctx.beginPath();
    ctx.moveTo(14, 46);
    ctx.lineTo(18, 32);
    ctx.lineTo(22, 40);
    ctx.lineTo(26, 30);
    ctx.lineTo(30, 46);
    ctx.fill();
    ctx.fillStyle = '#ffd05a';
    ctx.fillRect(18, 40, 8, 6);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(13, 45, 18, 3);
  },
  plant(ctx) {
    ctx.fillStyle = '#a0603a';
    ctx.fillRect(6, 26, 12, 12);
    for (const [x, y, r] of [[12, 16, 8], [7, 20, 5], [17, 19, 5], [12, 9, 5]]) circle(ctx, x, y, r, '#4f8f3f');
  },
  shelf(ctx) {
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(2, 2, 28, 44);
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(5, 5, 22, 38);
    const books = ['#b5483b', '#3f6fa3', '#4e8a4a', '#c98a2e', '#8a5aa3'];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = books[(i + row) % books.length];
        ctx.fillRect(6 + i * 4, 7 + row * 12, 3, 10);
      }
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(5, 17 + row * 12, 22, 2);
    }
  },
  door_mat(ctx) {
    ctx.fillStyle = '#8a6a40';
    rrect(ctx, 2, 2, 36, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#a58450';
    for (let x = 6; x < 36; x += 4) ctx.fillRect(x, 4, 2, 8);
  },
};

/** Draws the room shell (walls, floor, windows) for a home of w×h tiles. */
export function drawRoom(w, h, TS = 32) {
  const WALL_TOP = 56;
  const SIDE = 12;
  const c = makeCanvas(w * TS + SIDE * 2, h * TS + WALL_TOP + 12);
  const ctx = c.getContext('2d');
  // Floor planks (staggered rows, clipped to the floor area)
  ctx.save();
  ctx.beginPath();
  ctx.rect(SIDE, WALL_TOP, w * TS, h * TS);
  ctx.clip();
  for (let y = 0; y < h * 2; y++) {
    for (let x = 0; x <= w; x++) {
      const off = y % 2 ? TS / 2 : 0;
      ctx.fillStyle = (x + y) % 3 === 0 ? '#9a6e44' : (x + y) % 3 === 1 ? '#a4784c' : '#946840';
      ctx.fillRect(SIDE + x * TS - off, WALL_TOP + y * (TS / 2), TS, TS / 2);
      ctx.fillStyle = 'rgba(60,35,15,0.35)';
      ctx.fillRect(SIDE + x * TS - off, WALL_TOP + y * (TS / 2), 1, TS / 2);
    }
    ctx.fillStyle = 'rgba(60,35,15,0.35)';
    ctx.fillRect(SIDE, WALL_TOP + y * (TS / 2), w * TS, 1);
  }
  ctx.restore();
  // Back wall: plaster with a wooden wainscot
  ctx.fillStyle = '#e9dcc0';
  ctx.fillRect(SIDE, 0, w * TS, WALL_TOP);
  ctx.fillStyle = '#8a5a32';
  ctx.fillRect(SIDE, WALL_TOP - 18, w * TS, 18);
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(SIDE, WALL_TOP - 20, w * TS, 3);
  ctx.fillRect(SIDE, WALL_TOP - 3, w * TS, 3);
  // Windows along the back wall
  const windows = [];
  for (let i = 0; i < Math.max(1, Math.floor(w / 4)); i++) {
    const x = SIDE + Math.round(((i + 0.5) * w * TS) / Math.max(1, Math.floor(w / 4))) - 12;
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(x - 3, 6, 30, 26);
    const g = ctx.createLinearGradient(x, 9, x + 24, 29);
    g.addColorStop(0, '#bfe1f4');
    g.addColorStop(1, '#7fb0d2');
    ctx.fillStyle = g;
    ctx.fillRect(x, 9, 24, 20);
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(x + 11, 9, 2, 20);
    ctx.fillRect(x, 18, 24, 2);
    windows.push({ x: x + 12, y: 19 });
  }
  // Side and bottom walls
  ctx.fillStyle = '#5a3a22';
  ctx.fillRect(0, 0, SIDE, c.height);
  ctx.fillRect(c.width - SIDE, 0, SIDE, c.height);
  ctx.fillRect(0, c.height - 12, c.width, 12);
  // Door gap in the bottom wall
  const doorX = SIDE + Math.floor(w / 2) * TS;
  ctx.fillStyle = '#3a2412';
  ctx.fillRect(doorX, c.height - 12, TS, 12);
  return { canvas: c, wallTop: WALL_TOP, side: SIDE, doorX, windows };
}

// ---------------------------------------------------------------- land & construction props

const PROPS = {
  decor_land_sign: [30, 46, (ctx) => {
    ellipse(ctx, 15, 44, 8, 2, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(13, 14, 4, 30);
    ctx.fillStyle = '#e8d9b0';
    rrect(ctx, 2, 4, 26, 16, 3);
    ctx.fill();
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3f7a3a';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', 15, 16);
  }],
  plot_stake: [8, 18, (ctx) => {
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(3, 2, 3, 16);
    ctx.fillStyle = '#e8e2d0';
    ctx.fillRect(2, 2, 5, 3);
  }],
  plot_stake_owned: [8, 18, (ctx) => {
    ctx.fillStyle = '#8a6440';
    ctx.fillRect(3, 2, 3, 16);
    ctx.fillStyle = '#ffb938';
    ctx.fillRect(2, 2, 5, 3);
  }],
  owner_flag: [22, 30, (ctx) => {
    ctx.fillStyle = '#5b3f25';
    ctx.fillRect(2, 0, 2, 30);
    ctx.fillStyle = '#ffb938';
    ctx.beginPath();
    ctx.moveTo(4, 1);
    ctx.lineTo(21, 6);
    ctx.lineTo(4, 12);
    ctx.fill();
  }],
  pile_wood: [30, 20, (ctx) => {
    for (const [x, y] of [[8, 14], [18, 14], [13, 8]]) {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x - 6, y - 3, 12, 6);
      circle(ctx, x + 6, y, 3, '#c99a62');
    }
  }],
  pile_stone: [30, 20, (ctx) => {
    for (const [x, y, r] of [[8, 14, 5], [17, 14, 5], [12, 8, 4], [23, 15, 4]]) circle(ctx, x, y, r, '#8e8e8a');
  }],
  pile_planks: [30, 20, (ctx) => {
    for (const [y, c] of [[14, '#b08050'], [10, '#c99a62'], [6, '#b58858']]) {
      ctx.fillStyle = c;
      ctx.fillRect(3, y, 24, 4);
    }
  }],
  blueprint: [32, 32, (ctx) => {
    ctx.fillStyle = 'rgba(80,160,255,0.35)';
    ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = 'rgba(200,230,255,0.9)';
    ctx.strokeRect(0.5, 0.5, 31, 31);
  }],
};

// ---------------------------------------------------------------- player farming

function drawSoil(wet) {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = wet ? '#4f3622' : '#7b5436';
  rrect(ctx, 1, 1, 30, 30, 4);
  ctx.fill();
  for (let y = 5; y < 30; y += 7) {
    ctx.fillStyle = wet ? '#3e2a1a' : '#634228';
    ctx.fillRect(3, y, 26, 2);
    ctx.fillStyle = wet ? '#6a4a30' : '#8f6645';
    ctx.fillRect(3, y + 2, 26, 1);
  }
  return c;
}

const CROP_COLORS = {
  wheat: { leaf: '#6aa84f', ripe: '#e0bd55' },
  carrot: { leaf: '#4f9a3f', ripe: '#e8822a' },
  potato: { leaf: '#5f9e3f', ripe: '#c9a063' },
  cabbage: { leaf: '#7cbc58', ripe: '#a6d88a' },
  pumpkin: { leaf: '#4f8a3a', ripe: '#e0801e' },
};

function drawPlayerCrop(crop, stage) {
  const c = makeCanvas(32, 36);
  const ctx = c.getContext('2d');
  const col = CROP_COLORS[crop];
  if (stage === 0) {
    for (const x of [10, 16, 22]) {
      ctx.fillStyle = col.leaf;
      ctx.fillRect(x, 28, 2, 4);
      ctx.fillRect(x - 2, 27, 2, 2);
    }
    return c;
  }
  if (crop === 'wheat') {
    const h = stage === 1 ? 12 : stage === 2 ? 20 : 26;
    for (const x of [7, 11, 15, 19, 23]) {
      ctx.strokeStyle = stage === 3 ? '#c9a23a' : col.leaf;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 33);
      ctx.lineTo(x + 1, 33 - h);
      ctx.stroke();
      if (stage === 3) {
        ctx.fillStyle = col.ripe;
        rrect(ctx, x - 1, 33 - h - 6, 3, 7, 1.5);
        ctx.fill();
      }
    }
    return c;
  }
  if (crop === 'cabbage' || crop === 'pumpkin') {
    const r = stage === 1 ? 5 : stage === 2 ? 8 : 10;
    ellipse(ctx, 16, 30, r + 3, 4, 'rgba(0,0,0,0.2)');
    for (const [dx, dy] of [[-7, -3], [7, -3], [0, -8]]) ellipse(ctx, 16 + dx * (r / 10), 26 + dy * (r / 10), r * 0.7, r * 0.45, col.leaf);
    if (stage === 3) {
      if (crop === 'pumpkin') {
        ellipse(ctx, 16, 27, 10, 7, col.ripe);
        ctx.fillStyle = '#c86a12';
        ctx.fillRect(11, 21, 2, 12);
        ctx.fillRect(19, 21, 2, 12);
      } else {
        circle(ctx, 16, 25, 8, col.ripe);
        circle(ctx, 16, 25, 5, '#c8ecb0');
      }
    }
    return c;
  }
  // carrot, potato: leafy tops, root showing when ripe
  const leaves = stage === 1 ? 7 : stage === 2 ? 11 : 13;
  for (const dx of [-4, 0, 4]) {
    ctx.strokeStyle = col.leaf;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 31);
    ctx.lineTo(16 + dx, 31 - leaves);
    ctx.stroke();
  }
  if (stage === 3) ellipse(ctx, 16, 31, 5, 3, col.ripe);
  return c;
}

function drawDeadCrop() {
  const c = makeCanvas(32, 36);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#7a6a4a';
  ctx.lineWidth = 1.5;
  for (const [x, lean] of [[10, -3], [16, 2], [22, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + lean, 22);
    ctx.stroke();
  }
  return c;
}

export function createExtraTextures(scene, addCanvas) {
  addCanvas(scene, 'soil', drawSoil(false));
  addCanvas(scene, 'soil_wet', drawSoil(true));
  addCanvas(scene, 'pcrop_dead', drawDeadCrop());
  for (const crop of Object.keys(CROP_COLORS)) for (let s = 0; s <= 3; s++) addCanvas(scene, `pcrop_${crop}_${s}`, drawPlayerCrop(crop, s));
  for (const [type, fn] of Object.entries(FURNITURE_DRAW)) {
    const [w, h] = FURNITURE_SIZE[type];
    const c = makeCanvas(w, h);
    fn(c.getContext('2d'));
    addCanvas(scene, `furn_${type}`, c);
  }
  for (const [key, [w, h, fn]] of Object.entries(PROPS)) {
    const c = makeCanvas(w, h);
    fn(c.getContext('2d'));
    addCanvas(scene, key, c);
  }
}

export { FURNITURE_SIZE };
