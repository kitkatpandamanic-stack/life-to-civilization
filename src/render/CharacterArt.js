/**
 * CharacterArt — draws character sprite sheets procedurally.
 *
 * Sheet layout: 4 columns × 4 rows, each frame 32×48 px
 * (4 px of headroom above the head for hats and raised tools).
 *   columns: 0 idle, 1 step A, 2 step B, 3 working (tool raised)
 *   rows:    0 down, 1 left, 2 right, 3 up
 */
export const CHAR_W = 32;
export const CHAR_H = 48;
export const DIRS = ['down', 'left', 'right', 'up'];

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

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCharacterSheet(look) {
  const canvas = makeCanvas(CHAR_W * 4, CHAR_H * 4);
  const ctx = canvas.getContext('2d');
  DIRS.forEach((dir, row) => {
    for (let col = 0; col < 4; col++) drawCharacter(ctx, col * CHAR_W, row * CHAR_H, dir, col, look);
  });
  return canvas;
}

function drawCharacter(ctx, ox, oy0, dir, frame, look) {
  const oy = oy0 + 4; // headroom
  const cx = ox + 16;
  const walk = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const working = frame === 3;
  const bob = walk !== 0 ? -1 : 0;
  const top = oy + bob;
  const outline = 'rgba(30,20,15,0.55)';
  const side = dir === 'left' || dir === 'right';
  const flip = dir === 'left' ? -1 : 1;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, oy + 41, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const legY = top + 30;
  const legH = 10;
  const shoe = look.shoes;
  if (!side) {
    const lh = legH - (walk > 0 ? 2 : 0);
    const rh = legH - (walk < 0 ? 2 : 0);
    ctx.fillStyle = look.pants;
    ctx.fillRect(cx - 6, legY, 5, lh);
    ctx.fillRect(cx + 1, legY, 5, rh);
    ctx.fillStyle = shoe;
    ctx.fillRect(cx - 6, legY + lh - 2, 5, 3);
    ctx.fillRect(cx + 1, legY + rh - 2, 5, 3);
  } else {
    const s = walk * 3;
    ctx.fillStyle = shade(look.pants, -18);
    ctx.fillRect(cx - 3 - s, legY, 5, legH);
    ctx.fillStyle = look.pants;
    ctx.fillRect(cx - 3 + s, legY, 5, legH);
    ctx.fillStyle = shoe;
    ctx.fillRect(cx - 3 - s + (flip > 0 ? 1 : -1), legY + legH - 2, 6, 3);
    ctx.fillRect(cx - 3 + s + (flip > 0 ? 1 : -1), legY + legH - 2, 6, 3);
  }

  // Torso (shirt or dress)
  const torsoBottom = look.dress ? top + 36 : top + 32;
  ctx.fillStyle = look.shirt;
  rrect(ctx, cx - 8, top + 19, 16, torsoBottom - (top + 19), 4);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Shading on the torso
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(side ? cx - 8 + (flip > 0 ? 0 : 11) : cx + 3, top + 20, 5, torsoBottom - top - 21);
  if (!look.dress) {
    ctx.fillStyle = shade(look.pants, -25);
    ctx.fillRect(cx - 8, top + 29, 16, 2); // belt
  }

  // Arms
  const skin = look.skin;
  if (working) {
    // Arms raised holding a tool over the head.
    ctx.fillStyle = look.shirt;
    ctx.fillRect(cx - 9, top + 12, 4, 10);
    ctx.fillRect(cx + 5, top + 12, 4, 10);
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 9, top + 9, 4, 4);
    ctx.fillRect(cx + 5, top + 9, 4, 4);
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 2, top + 11);
    ctx.lineTo(cx + 10, top + 1);
    ctx.stroke();
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(cx + 7, top - 3, 8, 5);
  } else if (!side) {
    ctx.fillStyle = shade(look.shirt, -10);
    ctx.fillRect(cx - 11, top + 20 + walk, 3, 10);
    ctx.fillRect(cx + 8, top + 20 - walk, 3, 10);
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 11, top + 29 + walk, 3, 3);
    ctx.fillRect(cx + 8, top + 29 - walk, 3, 3);
  } else {
    ctx.fillStyle = shade(look.shirt, -12);
    ctx.fillRect(cx - 2 + walk * 3 * flip, top + 20, 4, 10);
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 2 + walk * 3 * flip, top + 29, 4, 3);
  }

  // Head
  const hx = cx + (side ? flip : 0);
  const hy = top + 11;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(hx, hy, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.stroke();

  // Hair
  drawHair(ctx, hx, hy, dir, look);

  // Face
  if (dir !== 'up') {
    ctx.fillStyle = '#2a1d17';
    if (dir === 'down') {
      ctx.fillRect(hx - 4, hy + 1, 2, 2);
      ctx.fillRect(hx + 2, hy + 1, 2, 2);
      ctx.fillStyle = 'rgba(220,110,100,0.35)';
      ctx.fillRect(hx - 6, hy + 3, 2, 2);
      ctx.fillRect(hx + 4, hy + 3, 2, 2);
    } else {
      ctx.fillRect(hx + 3 * flip - 1, hy + 1, 2, 2);
    }
    if (look.beard) {
      ctx.fillStyle = look.hair;
      if (dir === 'down') ctx.fillRect(hx - 4, hy + 4, 8, 3);
      else ctx.fillRect(hx + (flip > 0 ? 0 : -5), hy + 4, 5, 3);
    }
  }

  // Hat (player)
  if (look.hat) {
    ctx.fillStyle = '#d9b45a';
    ctx.beginPath();
    ctx.ellipse(hx, hy - 5, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a045';
    rrect(ctx, hx - 6, hy - 12, 12, 7, 3);
    ctx.fill();
    ctx.fillStyle = '#8a4a2a';
    ctx.fillRect(hx - 6, hy - 7, 12, 2);
  }
}

function drawHair(ctx, hx, hy, dir, look) {
  const style = look.hairStyle || 'short';
  if (style === 'bald') {
    ctx.fillStyle = look.hair;
    if (dir !== 'down') ctx.fillRect(hx - 7, hy - 1, 14, 3);
    return;
  }
  ctx.fillStyle = look.hair;
  if (dir === 'up') {
    ctx.beginPath();
    ctx.arc(hx, hy, 7.8, 0, Math.PI * 2);
    ctx.fill();
    if (style === 'long') ctx.fillRect(hx - 7, hy, 14, 10);
    if (style === 'bun') {
      ctx.beginPath();
      ctx.arc(hx, hy - 7, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // Top of the head
  ctx.beginPath();
  ctx.arc(hx, hy - 1, 7.8, Math.PI, Math.PI * 2);
  ctx.fill();
  if (dir === 'down') {
    ctx.fillRect(hx - 7, hy - 2, 14, 3);
    if (style === 'messy') {
      ctx.fillRect(hx - 5, hy + 1, 3, 2);
      ctx.fillRect(hx + 2, hy + 1, 3, 2);
    }
    if (style === 'long') {
      ctx.fillRect(hx - 8, hy - 1, 3, 12);
      ctx.fillRect(hx + 5, hy - 1, 3, 12);
    }
    if (style === 'bun') {
      ctx.beginPath();
      ctx.arc(hx, hy - 8, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const back = dir === 'right' ? -1 : 1;
    ctx.fillRect(hx - 7, hy - 2, 14, 3);
    ctx.fillRect(back > 0 ? hx + 2 : hx - 7, hy - 2, 5, style === 'long' ? 13 : 6);
    if (style === 'bun') {
      ctx.beginPath();
      ctx.arc(hx + back * 6, hy - 5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Head-and-shoulders portrait (for dialogue) as a data URL. */
export function drawPortrait(look, size = 72) {
  const sheet = drawCharacterSheet(look);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // Crop the idle-down frame (head + torso) and scale it up.
  ctx.drawImage(sheet, 4, 2, 24, 30, 0, 2, size, size * 1.25);
  return c.toDataURL();
}
