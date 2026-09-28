/**
 * AnimalArt — the valley's animals in a friendly storybook-cartoon style: a dark ink line round every
 * part, big heads and kind eyes with a glint, flat colour with a darker side away from the light, and a
 * soft shadow on the ground. Chickens (white and brown hens, a rooster), sheep (grey- or dark-faced, and
 * shorn), cows (black-and-white or brown, with a bell), deer (a stag and a doe), rabbits, and the horses
 * that carry packs and pull carts.
 *
 * Each is drawn four times bigger and brought down, so the lines stay smooth at game size.
 * Frames: 0 and 1 walk (legs swap), 2 grazes or pecks (head down).
 */
const S = 4;
const INK = '#2e2018';
const LW = 1.05;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw at S× and bring it down in halves (smooth edges, clean lines). */
function sheet(w, h, draw) {
  const big = makeCanvas(w * S, h * S);
  const ctx = big.getContext('2d');
  ctx.scale(S, S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  let src = big;
  for (let k = S / 2; k >= 1; k /= 2) {
    const c = makeCanvas(w * k, h * k);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c;
  }
  return src;
}

// ---------------------------------------------------------------- shapes (path builders)
const E = (x, y, rx, ry, rot = 0) => (ctx) => ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
const P = (...pts) => (ctx) => {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
};
/** A leg: a rounded bar from (x, top), swung by dx at the foot. */
const LEG = (x, top, len, w, dx = 0) => (ctx) => {
  const a = Math.atan2(-dx, len);
  ctx.save();
  ctx.translate(x, top);
  ctx.rotate(a);
  ctx.roundRect(-w / 2, -w / 2, w, len + w / 2, w / 2);
  ctx.restore();
};

/**
 * One part of an animal: the shapes filled as one (overlaps merge), a darker side to the bottom right,
 * and the ink line round the outside.
 */
function blob(ctx, paths, base, shade, { off = 1.1, lw = LW } = {}) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 2;
  for (const p of paths) {
    ctx.beginPath();
    p(ctx);
    ctx.stroke();
  }
  ctx.fillStyle = base;
  for (const p of paths) {
    ctx.beginPath();
    p(ctx);
    ctx.fill();
  }
  if (!shade) return;
  ctx.save();
  ctx.beginPath();
  for (const p of paths) p(ctx);
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.fillRect(-50, -50, 200, 200);
  ctx.translate(-off, -off * 0.9);
  ctx.fillStyle = base;
  for (const p of paths) {
    ctx.beginPath();
    p(ctx);
    ctx.fill();
  }
  ctx.restore();
}

/** Flat fill inside a part (patches, bellies) — no line of its own. */
function inside(ctx, clip, paths, color) {
  ctx.save();
  ctx.beginPath();
  for (const p of clip) p(ctx);
  ctx.clip();
  ctx.fillStyle = color;
  for (const p of paths) {
    ctx.beginPath();
    p(ctx);
    ctx.fill();
  }
  ctx.restore();
}

/** A thin ink line (a wing's edge, a mouth, a curl of fleece). */
function line(ctx, pts, { w = 0.6, color = INK, curve = false } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (curve && pts.length === 3) ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

/** A cartoon eye: dark and round, with a glint. */
function eye(ctx, x, y, r = 1) {
  ctx.fillStyle = '#1c1410';
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + r * 0.28, y - r * 0.38, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function groundShadow(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(30,20,12,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Turn the head about the neck (grazing: down and forward). */
function headDown(ctx, px, py, angle, dy) {
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.translate(-px, -py + dy);
}

/** Leg swing for a frame: [back-far, back-near, front-far, front-near]. */
const swing = (frame, a = 1.6) => (frame === 1 ? [a, -a, -a, a] : frame === 0 ? [-a, a, a, -a] : [0, 0, 0, 0]);

// ---------------------------------------------------------------- chickens
const CHICKEN = {
  w: { body: '#f7f1e3', shade: '#d9ccb2', tail: '#efe6d2', tailShade: '#cfc0a2', comb: 1 },
  b: { body: '#c98a4e', shade: '#9e6436', tail: '#8a4f2a', tailShade: '#6a3a20', comb: 1 },
  r: { body: '#b8552e', shade: '#8a3a20', head: '#e0a040', headShade: '#b87a2a', tail: '#2f3d38', tailShade: '#1f2a26', comb: 1.4 },
};

function drawChicken(frame, v = 'w') {
  const C = CHICKEN[v];
  return sheet(20, 20, (ctx) => {
    groundShadow(ctx, 10, 18.7, 6, 1.3);
    const peck = frame === 2;
    const s = swing(frame, 1.2);
    // legs and feet
    for (const [x, dx] of [[8.2, s[0]], [11.2, s[3]]]) {
      line(ctx, [[x, 14], [x + dx, 18.3]], { w: 2.2 });
      line(ctx, [[x, 14], [x + dx, 18.3]], { w: 1.1, color: '#e89a30' });
      line(ctx, [[x + dx - 1, 18.5], [x + dx + 1.4, 18.5]], { w: 1, color: '#e89a30' });
    }
    // tail feathers
    const tail = v === 'r' ? [E(4.4, 7.4, 3.6, 1.5, -1.1), E(3.4, 9.6, 3.4, 1.4, -0.7), E(5.4, 6, 3, 1.2, -1.4)] : [E(4.6, 8.4, 3, 1.5, -0.9), E(3.8, 10.2, 2.8, 1.4, -0.6)];
    blob(ctx, tail, C.tail, C.tailShade);
    const k = C.comb;
    const head = () => {
      ctx.save();
      if (peck) headDown(ctx, 12, 10, 0.55, 1.2);
    };
    // comb (behind the head), then the body; standing, a hen's head and body are one shape
    head();
    blob(ctx, [E(12.4, 4, 1.1 * k, 1.1 * k), E(13.7, 3.3 - (k - 1), 1.2 * k, 1.2 * k), E(15, 4, 1.05 * k, 1.05 * k)], '#dc3a2c', '#b02820');
    ctx.restore();
    if (!C.head && !peck) blob(ctx, [E(10, 12, 6, 5), E(13.6, 7.2, 3.4, 3.3)], C.body, C.shade);
    else {
      blob(ctx, [E(10, 12, 6, 5)], C.body, C.shade);
      head();
      blob(ctx, [E(13.6, 7.2, 3.4, 3.3), E(12.4, 10, 2.4, 2.4)], C.head || C.body, C.headShade || C.shade);
      ctx.restore();
    }
    // wing
    blob(ctx, [E(9, 12.4, 3.8, 2.5, -0.2)], C.shade, null, { lw: 0.5 });
    line(ctx, [[6.6, 12.6], [8.6, 13.6], [11, 13.2]], { w: 0.45, curve: true });
    head();
    // wattle, beak, eye
    blob(ctx, [E(15.6, 9.6, 0.9 * k, 1.3 * k)], '#dc3a2c', null, { lw: 0.5 });
    blob(ctx, [P([16.6, 6.5], [19.1, 7.5], [16.6, 8.5])], '#f2b43c', '#d08a24', { lw: 0.5 });
    eye(ctx, 14.8, 6.5, 1.15);
    ctx.restore();
  });
}

// ---------------------------------------------------------------- sheep
const SHEEP = {
  g: { face: '#8290ad', faceShade: '#636f8c', leg: '#6f7b98', legShade: '#566079' },
  d: { face: '#4a3f3c', faceShade: '#352c2a', leg: '#3f3533', legShade: '#2e2624' },
};
const FLEECE = '#f1e6cc';
const FLEECE_SHADE = '#d3c09a';

function drawSheep(frame, shorn = false, v = 'g') {
  const C = SHEEP[v];
  return sheet(30, 24, (ctx) => {
    groundShadow(ctx, 15, 22.6, 10, 1.7);
    const s = swing(frame);
    const top = shorn ? 14.5 : 15.5;
    const len = 22 - top;
    // far legs, then near legs (hooves dark)
    for (const [x, dx, near] of [[9.5, s[0], 0], [20, s[2], 0], [11.8, s[1], 1], [22.3, s[3], 1]]) {
      blob(ctx, [LEG(x, top, len, 2.5, dx)], near ? C.leg : C.legShade, null, { lw: 0.8 });
      dot(ctx, x + dx, 22, 1.05, '#241a16');
    }
    if (shorn) {
      blob(ctx, [E(5.6, 12, 1.6, 1.6)], '#efdcc6', '#cdb49a');
      blob(ctx, [E(15, 13, 9, 5.2)], '#efdcc6', '#cdb49a');
      for (const [x, y] of [[10, 11], [14, 10], [18, 12], [12, 15], [17, 15.4]]) dot(ctx, x, y, 0.35, '#c9ae90');
    } else {
      blob(ctx, [E(4.4, 11.4, 2.3, 2.3)], FLEECE, FLEECE_SHADE); // tail puff
      const puffs = [[7.4, 12, 4.2], [10.6, 9, 4.6], [15, 8, 4.8], [19.4, 9, 4.6], [21.6, 12.6, 4], [9.2, 15, 4], [14, 15.6, 4.4], [18.8, 15.2, 4.2]];
      blob(ctx, puffs.map(([x, y, r]) => E(x, y, r, r * 0.92)), FLEECE, FLEECE_SHADE, { off: 1.4 });
      for (const [x, y] of [[9.5, 10.5], [14.5, 9], [18, 11.5], [11.5, 14.5], [16.5, 14], [7.5, 13.5]]) {
        ctx.strokeStyle = '#c4ae86';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, 1.1, Math.PI * 0.9, Math.PI * 2.1);
        ctx.stroke();
      }
    }
    ctx.save();
    if (frame === 2) headDown(ctx, 22, 12, 0.6, 3.2);
    // ear, head, the tuft on top
    blob(ctx, [E(21.6, 11.4, 2.7, 1.2, 0.55)], C.face, C.faceShade, { lw: 0.8 });
    blob(ctx, [E(24.6, 11.6, 3.6, 4.2, 0.4)], C.face, C.faceShade);
    blob(ctx, shorn ? [E(23.6, 8, 1.8, 1.4)] : [E(23, 8.2, 2.4, 2.1), E(25.2, 7.6, 2.2, 1.9)], FLEECE, FLEECE_SHADE, { lw: 0.8 });
    eye(ctx, 25.7, 10.9, 1.3);
    dot(ctx, 27.4, 13.8, 0.4, '#241a16');
    line(ctx, [[26.2, 14.9], [26.9, 15.3], [27.6, 15]], { w: 0.4, curve: true });
    ctx.restore();
  });
}

// ---------------------------------------------------------------- cows
const COW = {
  h: { body: '#f5f0e6', shade: '#d6ccbb', patch: '#4f5a4a', muzzle: '#f0a6a0', muzzleShade: '#d48480', horn: '#efe2c2' },
  b: { body: '#a86a3e', shade: '#83502e', patch: '#f1e2c4', muzzle: '#e8b49a', muzzleShade: '#c8927a', horn: '#efe2c2' },
};

function drawCow(frame, v = 'h') {
  const C = COW[v];
  return sheet(38, 30, (ctx) => {
    groundShadow(ctx, 19, 28.4, 13, 2);
    const s = swing(frame, 1.8);
    for (const [x, dx, near] of [[9.6, s[0], 0], [23, s[2], 0], [12.6, s[1], 1], [26, s[3], 1]]) {
      blob(ctx, [LEG(x, 19, 8.6, 3.3, dx)], near ? C.body : C.shade, null, { lw: 0.9 });
      blob(ctx, [LEG(x + dx * 0.95, 26.6, 1.3, 3.3, 0)], '#3a2e28', null, { lw: 0.7 });
    }
    // tail
    line(ctx, [[6.4, 12], [3.4, 16], [4.4, 22]], { w: 1.9, curve: true });
    line(ctx, [[6.4, 12], [3.4, 16], [4.4, 22]], { w: 0.9, color: C.shade, curve: true });
    blob(ctx, [E(4.4, 22.6, 1.3, 1.8)], '#3b2f2a', null, { lw: 0.6 });
    // body with patches
    const body = [(c) => c.roundRect(5, 9, 24, 13.5, 6.5)];
    blob(ctx, body, C.body, C.shade, { off: 1.5 });
    const patches = v === 'h' ? [E(11, 12.4, 4.2, 3.4, 0.3), E(20, 17.4, 4.6, 3.1, -0.2), E(24.4, 11, 2.8, 2.1), E(7, 18, 2, 1.8)] : [E(15, 19.5, 6, 2.6), E(22, 12, 2.2, 1.6)];
    inside(ctx, body, patches, C.patch);
    // udder
    blob(ctx, [E(15, 22.4, 2.9, 1.8)], '#f2b0ac', '#d88e8a', { lw: 0.7 });
    ctx.save();
    if (frame === 2) headDown(ctx, 27, 13, 0.5, 4.2);
    // ear, horns, head, muzzle, bell
    blob(ctx, [E(25.4, 9.8, 2.8, 1.3, -0.35)], C.body, C.shade, { lw: 0.8 });
    for (const pts of [[[28.2, 7.4], [27, 4.4], [25.8, 4]], [[32.2, 7.2], [33.4, 4.4], [34.8, 4.2]]]) {
      line(ctx, pts, { w: 2.1, curve: true });
      line(ctx, pts, { w: 1.1, color: C.horn, curve: true });
    }
    blob(ctx, [E(30.2, 11.6, 4.8, 5.1)], C.body, C.shade);
    if (v === 'h') inside(ctx, [E(30.2, 11.6, 4.8, 5.1)], [E(27.8, 8.6, 2, 1.6)], C.patch);
    blob(ctx, [E(33.2, 15, 3.5, 2.7)], C.muzzle, C.muzzleShade);
    dot(ctx, 32.4, 14.8, 0.45, '#5a2a24');
    dot(ctx, 34.9, 15, 0.45, '#5a2a24');
    eye(ctx, 31.4, 11.2, 1.4);
    line(ctx, [[27.2, 13.4], [27.6, 16.4], [28.6, 18.2]], { w: 1.4, color: '#8a3b2a', curve: true });
    blob(ctx, [E(28.7, 19.2, 1.35, 1.5)], '#e2b64a', '#b88a2a', { lw: 0.6 });
    ctx.restore();
  });
}

// ---------------------------------------------------------------- deer and rabbits
function drawDeer(frame, stag = true) {
  const body = '#b0703e';
  const shade = '#8a5230';
  return sheet(32, 28, (ctx) => {
    groundShadow(ctx, 16, 26.8, 9, 1.4);
    const s = swing(frame, 2.4);
    for (const [x, dx, near] of [[8.6, s[0], 0], [19.4, s[2], 0], [11, s[1], 1], [21.8, s[3], 1]]) {
      blob(ctx, [LEG(x, 16, 9.6, 1.8, dx)], near ? body : shade, null, { lw: 0.7 });
      dot(ctx, x + dx, 26, 0.9, '#2a1d14');
    }
    blob(ctx, [E(6.4, 11.4, 1.7, 2.3, 0.3)], '#f7f0e2', '#d8ccb6', { lw: 0.8 }); // white tail
    const parts = [E(15, 14, 9, 5.2), P([19.6, 12.6], [22.6, 5], [26.4, 6.2], [24.4, 15])];
    blob(ctx, parts, body, shade, { off: 1.2 });
    inside(ctx, parts, [E(14, 18, 7.4, 2.6)], '#ecd2a8');
    blob(ctx, [E(23.6, 3.8, 2.3, 1.05, -0.7)], body, shade, { lw: 0.8 }); // ear
    blob(ctx, [E(26, 6, 3.4, 2.8, 0.3), E(28.4, 7.4, 2.2, 1.6, 0.2)], body, shade);
    inside(ctx, [E(28.4, 7.4, 2.2, 1.6, 0.2)], [E(29, 8.2, 1.6, 0.9)], '#ecd2a8');
    dot(ctx, 30.3, 7.2, 0.75, '#1c1410');
    eye(ctx, 26.3, 5.3, 1.15);
    if (stag) {
      for (const pts of [[[25, 3.4], [24.2, 1], [22.4, 0.4]], [[24.4, 1.8], [25.6, 0.4]], [[26.6, 3.4], [27.8, 1.1], [29.4, 0.6]]]) {
        line(ctx, pts, { w: 1.7 });
        line(ctx, pts, { w: 0.8, color: '#eadbb4' });
      }
    }
  });
}

function drawRabbit(frame) {
  const fur = '#a8927a';
  const shade = '#86705c';
  return sheet(18, 16, (ctx) => {
    groundShadow(ctx, 8.5, 15, 5.5, 1);
    const y = frame ? -1.2 : 0;
    blob(ctx, [E(6.2, 13.4 + y * 0.5, 2.8, 1.1)], shade, null, { lw: 0.6 }); // back foot
    blob(ctx, [E(11.6, 3.2 + y, 1.05, 3.2, -0.25)], shade, null, { lw: 0.7 });
    blob(ctx, [E(8, 10 + y, 5, 3.8), E(12.6, 7.6 + y, 3, 2.8)], fur, shade);
    blob(ctx, [E(13.4, 3.4 + y, 1.05, 3.1, 0.2)], fur, shade, { lw: 0.7 });
    inside(ctx, [E(13.4, 3.4 + y, 1.05, 3.1, 0.2)], [E(13.5, 3.6 + y, 0.45, 2.2, 0.2)], '#e8a8a0');
    blob(ctx, [E(3, 9 + y, 1.8, 1.8)], '#f7f0e2', null, { lw: 0.6 }); // cotton tail
    blob(ctx, [E(12, 13.1 + y * 0.5, 1.1, 0.9)], fur, null, { lw: 0.5 }); // front paw
    eye(ctx, 13.7, 7.1 + y, 1);
    dot(ctx, 15.4, 8.3 + y, 0.45, '#d8847a');
  });
}

// ---------------------------------------------------------------- horses (pack horse, carts)
export const HORSE = {
  bay: { body: '#9a5a32', shade: '#76422a', mane: '#3a2418', maneShade: '#241510', sock: '#e8dcc0' },
  chestnut: { body: '#b87440', shade: '#8e542c', mane: '#ecd08e', maneShade: '#c8a868', sock: '#f0e6cc' },
  grey: { body: '#7a7484', shade: '#5c5666', mane: '#e9d49a', maneShade: '#c4ae74', sock: '#efe6d0' },
};

/** A horse in its own 32×26 frame (ground at y 25), facing right — drawn onto ctx where it stands. */
export function drawHorse(ctx, frame, colors = HORSE.bay) {
  const C = colors;
  groundShadow(ctx, 15, 25, 10, 1.6);
  const s = swing(frame, 2);
  for (const [x, dx, near] of [[9, s[0], 0], [19.2, s[2], 0], [11.6, s[1], 1], [21.8, s[3], 1]]) {
    blob(ctx, [LEG(x, 15, 8.6, 2.3, dx)], near ? C.body : C.shade, null, { lw: 0.8 });
    blob(ctx, [E(x + dx * 0.95, 23.4, 1.7, 1.3)], C.sock, null, { lw: 0.6 }); // feathered fetlock
    dot(ctx, x + dx, 24.6, 1, '#241a16');
  }
  blob(ctx, [E(5.4, 15, 2.1, 5.2, 0.3)], C.mane, C.maneShade); // tail
  blob(ctx, [E(15, 13, 8.6, 5.4), P([19.2, 11.2], [22.4, 3.8], [26.8, 4.8], [24.4, 14.4])], C.body, C.shade, { off: 1.2 });
  blob(ctx, [E(24.2, 2.4, 0.95, 1.7, 0.2)], C.body, C.shade, { lw: 0.7 }); // ear
  blob(ctx, [E(25.6, 6, 3.6, 3.1, 0.5), E(28, 8.6, 2.5, 2.1, 0.3)], C.body, C.shade);
  inside(ctx, [E(28, 8.6, 2.5, 2.1, 0.3)], [E(28.8, 9.2, 1.9, 1.5)], C.shade);
  blob(ctx, [E(21.8, 6.4, 1.9, 4.4, 0.5), E(20.6, 9.4, 1.5, 3, 0.4), E(25, 3, 1.6, 1.2, 0.3)], C.mane, C.maneShade, { lw: 0.8 }); // mane and forelock
  eye(ctx, 26, 5.7, 1.2);
  dot(ctx, 29.4, 8.6, 0.4, '#1c1410');
}

/** A horse drawn smooth onto a flat 1× canvas at (x, y) (its frame's top left), scaled by k. */
export function paintHorseOnto(ctx, x, y, frame, colors, k = 1) {
  const c = sheet(32, 26, (g) => drawHorse(g, frame, colors));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, x, y, 32 * k, 26 * k);
  ctx.restore();
}

// ---------------------------------------------------------------- textures
/** Which look each kept animal wears (by a steady hash of who it is). */
export const ANIMAL_VARIANTS = { chicken: ['', 'b', '', 'r', 'b'], sheep: ['', '', 'd'], cow: ['', 'b', ''] };

export function createAnimalTextures(scene, addCanvas) {
  for (const f of [0, 1, 2]) {
    addCanvas(scene, `chicken_${f}`, drawChicken(f, 'w'));
    addCanvas(scene, `chicken_b_${f}`, drawChicken(f, 'b'));
    addCanvas(scene, `chicken_r_${f}`, drawChicken(f, 'r'));
    addCanvas(scene, `sheep_${f}`, drawSheep(f, false, 'g'));
    addCanvas(scene, `sheep_d_${f}`, drawSheep(f, false, 'd'));
    addCanvas(scene, `sheep_shorn_${f}`, drawSheep(f, true, 'g'));
    addCanvas(scene, `sheep_shorn_d_${f}`, drawSheep(f, true, 'd'));
    addCanvas(scene, `cow_${f}`, drawCow(f, 'h'));
    addCanvas(scene, `cow_b_${f}`, drawCow(f, 'b'));
  }
  for (const f of [0, 1]) {
    addCanvas(scene, `deer_${f}`, drawDeer(f, true));
    addCanvas(scene, `deer_doe_${f}`, drawDeer(f, false));
    addCanvas(scene, `rabbit_${f}`, drawRabbit(f));
  }
}
