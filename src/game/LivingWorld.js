/**
 * LivingWorld — small movements that make the painted valley feel alive. Pure decoration: it reads the world
 * and never changes it, and it uses Math.random (never the simulation's dice).
 *
 *   water   — glints of light drift down the river and over the ponds
 *   wind    — trees and bushes sway from their foot, harder in a storm
 *   blowing — leaves in autumn, blossom petals in spring, carried across the screen
 *   puddles — on paths and roads when it rains; they dry out over a few hours afterwards
 *
 * Only what's in view is touched each frame, so it costs next to nothing.
 */
import Phaser from 'phaser';
import { BALANCE } from '../config/balance.js';
import { T } from '../world/WorldGenerator.js';
import { hash2 } from '../core/rng.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;
const GLINTS = 40;
const WIND = { sunny: 0.018, cloudy: 0.03, fog: 0.012, rain: 0.045, storm: 0.09, snow: 0.02 };

function texture(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  scene.textures.addCanvas(key, c);
}

export class LivingWorld {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.t = 0;
    this.wet = 0;
    this.lastMinute = sim.time.total;
    texture(scene, 'glint', 12, 5, (ctx) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(1, 3.5);
      ctx.quadraticCurveTo(6, 0.5, 11, 3.5);
      ctx.stroke();
    });
    texture(scene, 'leaf', 6, 4, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(3, 2, 2.8, 1.6, 0.4, 0, Math.PI * 2);
      ctx.fill();
    });
    texture(scene, 'puddle', 30, 14, (ctx) => {
      const g = ctx.createRadialGradient(13, 6, 1, 15, 7, 15);
      g.addColorStop(0, 'rgba(170,205,230,0.8)');
      g.addColorStop(0.65, 'rgba(105,140,170,0.7)');
      g.addColorStop(0.9, 'rgba(70,58,40,0.45)'); // the wet rim
      g.addColorStop(1, 'rgba(70,58,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(15, 7, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 5);
      ctx.quadraticCurveTo(13, 3, 18, 4.5);
      ctx.stroke();
    });

    // Water glints: a pool of sprites, each living a couple of seconds somewhere on the water in view.
    this.glints = [];
    for (let i = 0; i < GLINTS; i++) {
      const g = scene.add.image(0, 0, 'glint').setDepth(DEPTH.TUFTS + 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      g.life = 0;
      g.age = 0;
      this.glints.push(g);
    }
    this.waterRev = -1;
    this.water = [];

    // Leaves (autumn) and petals (spring) blowing across the screen — one emitter each.
    const blow = (tint, frequency) =>
      scene.add
        .particles(0, 0, 'leaf', {
          x: { min: -60, max: 2600 },
          y: { min: -20, max: 1100 },
          lifespan: 6000,
          speedX: { min: 30, max: 70 },
          speedY: { min: 12, max: 34 },
          rotate: { min: 0, max: 360 },
          scale: { min: 0.8, max: 1.4 },
          alpha: { start: 0.95, end: 0 },
          tint,
          frequency,
          quantity: 1,
          emitting: false,
        })
        .setScrollFactor(0)
        .setDepth(DEPTH.WEATHER - 1);
    this.leaves = blow([0xd9822b, 0xc4491f, 0xe8b83a, 0xa0521d], 260);
    this.petals = blow([0xf7c6d9, 0xffffff, 0xf3a2c4], 520);
    this.blowing = null;

    this.puddles = new Map(); // "tx,ty" → image
  }

  /** Where the water is (recomputed when the world's tiles change — a bridge built, say). */
  waterTiles() {
    const w = this.sim.world;
    if (this.waterRev === (w.rev || 0)) return this.water;
    this.waterRev = w.rev || 0;
    this.water = [];
    for (let y = 0; y < w.H; y++) {
      for (let x = 0; x < w.W; x++) {
        const t = w.tiles[w.idx(x, y)];
        if (t === T.WATER || t === T.DEEP) this.water.push(x, y);
      }
    }
    return this.water;
  }

  update(delta, hidden) {
    const sim = this.sim;
    const scene = this.scene;
    this.t += delta / 1000;
    const view = scene.cameras.main.worldView;
    const indoors = !!scene.inside;
    const weather = sim.weather.type;
    const season = sim.time.season;

    // --- wetness: rain wets the ground within half an hour; it dries over some six hours
    const now = sim.time.total;
    const dm = Math.max(0, Math.min(120, now - this.lastMinute));
    this.lastMinute = now;
    const raining = weather === 'rain' || weather === 'storm';
    if (raining && season !== 'winter') this.wet = Math.min(1, this.wet + dm / 30);
    else this.wet = Math.max(0, this.wet - dm / 360);

    // --- water glints
    const water = this.waterTiles();
    for (const g of this.glints) {
      g.age += delta;
      if (g.age >= g.life) {
        g.setAlpha(0);
        if (hidden || indoors || !water.length) continue;
        // a new glint on some water in view (a few tries)
        for (let k = 0; k < 6; k++) {
          const i = Math.floor(Math.random() * (water.length / 2)) * 2;
          const x = water[i] * TS + Math.random() * TS;
          const y = water[i + 1] * TS + Math.random() * TS;
          if (x < view.x || x > view.right || y < view.y || y > view.bottom) continue;
          g.setPosition(x, y);
          g.age = 0;
          g.life = 1400 + Math.random() * 1800;
          g.vx = (Math.random() - 0.5) * 4;
          g.vy = 6 + Math.random() * 8; // drifting with the current
          g.setScale(0.7 + Math.random() * 0.7);
          break;
        }
        continue;
      }
      const p = g.age / g.life;
      const sun = weather === 'sunny' ? 1 : weather === 'cloudy' || weather === 'fog' ? 0.55 : 0.4;
      g.setAlpha(Math.sin(p * Math.PI) * 0.75 * sun * (1 - sim.time.darkness() * 0.8));
      g.x += (g.vx * delta) / 1000;
      g.y += (g.vy * delta) / 1000;
    }

    // --- wind in the trees and bushes (only those in view)
    const amp = (WIND[weather] ?? 0.02) * (indoors ? 0 : 1);
    const views = scene.objects;
    if (views?.sprites) {
      const margin = 96;
      for (const obj of Object.values(sim.state.objects)) {
        if (obj.kind !== 'tree' && obj.kind !== 'bush') continue;
        const x = obj.tx * TS;
        const y = obj.ty * TS;
        if (x < view.x - margin || x > view.right + margin || y < view.y - margin || y > view.bottom + margin * 2) continue;
        const spr = views.sprites.get(obj.id);
        if (!spr || !spr.visible) continue;
        const phase = hash2(obj.tx, obj.ty, 91) * Math.PI * 2;
        const a = obj.kind === 'bush' ? amp * 0.6 : amp;
        spr.rotation = Math.sin(this.t * 1.3 + phase) * a + Math.sin(this.t * 2.9 + phase * 1.7) * a * 0.35;
      }
    }

    // --- leaves in autumn, petals in spring
    const blowing = !hidden && !indoors && !raining ? (season === 'autumn' ? 'leaves' : season === 'spring' ? 'petals' : null) : null;
    if (blowing !== this.blowing) {
      this.blowing = blowing;
      if (blowing === 'leaves') this.leaves.start();
      else this.leaves.stop();
      if (blowing === 'petals') this.petals.start();
      else this.petals.stop();
    }

    // --- puddles on paths and roads while the ground is wet
    this.updatePuddles(view);
  }

  updatePuddles(view) {
    const scene = this.scene;
    const w = this.sim.world;
    const alpha = Math.min(1, this.wet * 1.2) * 0.85;
    if (alpha <= 0.02) {
      if (this.puddles.size) {
        for (const img of this.puddles.values()) img.destroy();
        this.puddles.clear();
      }
      return;
    }
    const x0 = Math.max(0, Math.floor(view.x / TS) - 1);
    const y0 = Math.max(0, Math.floor(view.y / TS) - 1);
    const x1 = Math.min(w.W - 1, Math.ceil(view.right / TS) + 1);
    const y1 = Math.min(w.H - 1, Math.ceil(view.bottom / TS) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = w.tiles[w.idx(x, y)];
        if (t !== T.DIRT && t !== T.ROAD && t !== T.FARMLAND) continue;
        if (hash2(x, y, 555) > 0.16) continue;
        const k = `${x},${y}`;
        if (this.puddles.has(k)) continue;
        const img = scene.add
          .image(x * TS + 6 + hash2(x, y, 556) * 20, y * TS + 8 + hash2(x, y, 557) * 18, 'puddle')
          .setDepth(DEPTH.TUFTS + 0.4)
          .setScale(0.7 + hash2(x, y, 558) * 0.6, 0.7 + hash2(x, y, 559) * 0.4);
        this.puddles.set(k, img);
      }
    }
    for (const [k, img] of this.puddles) {
      if (img.x < view.x - TS * 4 || img.x > view.right + TS * 4 || img.y < view.y - TS * 4 || img.y > view.bottom + TS * 4) {
        img.destroy();
        this.puddles.delete(k);
      } else img.setAlpha(alpha);
    }
  }

  destroy() {
    for (const img of this.puddles.values()) img.destroy();
    this.puddles.clear();
  }
}
