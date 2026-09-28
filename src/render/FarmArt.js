/**
 * The icons for what farm animals give (eggs, milk, wool) and eat (hay). Drawn in code like the rest.
 * (The animals themselves are in AnimalArt.)
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
