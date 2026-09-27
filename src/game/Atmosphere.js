/**
 * Atmosphere — day/night lighting and weather effects.
 *
 * A screen-sized overlay is tinted by time of day (dawn orange, night blue);
 * lights (windows, lamps, the player's lantern) are drawn above it with
 * additive blending so they glow in the dark. Rain/snow are particle emitters
 * fixed to the camera; storms add lightning flashes.
 */
import Phaser from 'phaser';
import { DEPTH } from './depth.js';

// [hour, colour, alpha]
const SKY = [
  [0, 0x0a0f2e, 0.62],
  [4.5, 0x0a0f2e, 0.62],
  [5.7, 0x3a2a5a, 0.42],
  [6.6, 0xff9a55, 0.14],
  [7.5, 0x000000, 0],
  [17, 0x000000, 0],
  [18.4, 0xff8a40, 0.16],
  [19.6, 0x2a2060, 0.4],
  [21, 0x0a0f2e, 0.6],
  [24, 0x0a0f2e, 0.62],
];

// Warm sunlight over the painted world (multiplied in): golden in the morning and evening, gentle at noon.
const WARM = [
  [0, 0xffffff, 0],
  [5.5, 0xffffff, 0],
  [6.8, 0xffb878, 0.42],
  [9, 0xffe8c8, 0.34],
  [15.5, 0xffe8c8, 0.34],
  [17.6, 0xffb060, 0.5],
  [19.4, 0xffffff, 0],
  [24, 0xffffff, 0],
];

const GLOOM = { sunny: [0x000000, 0], cloudy: [0x404858, 0.1], rain: [0x2c3444, 0.2], storm: [0x1a1f2c, 0.32], snow: [0xdfe8f0, 0.1], fog: [0xc8ccd0, 0.3] };

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

export class Atmosphere {
  constructor(scene, sim, player) {
    this.scene = scene;
    this.sim = sim;
    this.player = player;
    const { width, height } = scene.scale;
    this.night = scene.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.NIGHT);
    this.gloom = scene.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.GLOOM);
    this.warm = scene.add.rectangle(0, 0, width, height, 0xffffff, 0).setOrigin(0).setScrollFactor(0).setDepth(DEPTH.GLOOM - 2).setBlendMode(Phaser.BlendModes.MULTIPLY);
    // Softly darker corners, like a painting.
    if (!scene.textures.exists('vignette')) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
      g.addColorStop(0, 'rgba(20,12,4,0)');
      g.addColorStop(0.6, 'rgba(20,12,4,0.25)');
      g.addColorStop(1, 'rgba(20,12,4,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      scene.textures.addCanvas('vignette', c);
    }
    this.vignette = scene.add.image(0, 0, 'vignette').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.GLOOM - 1).setDisplaySize(width, height).setAlpha(0.32);
    this.lantern = scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd9a0).setScale(2.4).setDepth(DEPTH.LIGHTS).setAlpha(0);

    this.rain = scene.add
      .particles(0, 0, 'rain', {
        x: { min: -200, max: 2600 },
        y: -20,
        lifespan: 1100,
        speedY: { min: 700, max: 850 },
        speedX: { min: -140, max: -110 },
        rotate: 10,
        quantity: 4,
        frequency: 16,
        alpha: { start: 0.75, end: 0.4 },
        emitting: false,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.WEATHER);
    this.snow = scene.add
      .particles(0, 0, 'snow', {
        x: { min: -100, max: 2600 },
        y: -10,
        lifespan: 6000,
        speedY: { min: 50, max: 110 },
        speedX: { min: -30, max: 30 },
        scale: { min: 0.5, max: 1.2 },
        quantity: 2,
        frequency: 40,
        alpha: 0.9,
        emitting: false,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.WEATHER);
    this.nextLightning = 0;
    this.weather = null;
    scene.scale.on('resize', this.onResize, this);
  }

  /** Indoors: lamps keep it bright, and no rain falls inside. */
  setIndoor(indoor) {
    this.indoor = indoor;
    this.weather = null; // re-evaluate weather effects next frame
  }

  onResize(size) {
    this.night.setSize(size.width, size.height);
    this.gloom.setSize(size.width, size.height);
    this.warm.setSize(size.width, size.height);
    this.vignette.setDisplaySize(size.width, size.height);
  }

  update() {
    const h = this.sim.time.hourFloat;
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
    const [h0, c0, a0] = SKY[i];
    const [h1, c1, a1] = SKY[i + 1];
    const t = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
    const indoorDim = this.indoor ? 0.3 : 1;
    this.night.setFillStyle(this.indoor ? 0x2a1a08 : lerpColor(c0, c1, t), (a0 + (a1 - a0) * t) * indoorDim);

    // Warm light — out of doors, and less of it under cloud.
    let j = 0;
    while (j < WARM.length - 2 && WARM[j + 1][0] <= h) j++;
    const [w0, wc0, wa0] = WARM[j];
    const [w1, wc1, wa1] = WARM[j + 1];
    const wt = Math.max(0, Math.min(1, (h - w0) / (w1 - w0)));
    const cloud = { sunny: 1, cloudy: 0.5, fog: 0.3, rain: 0.25, storm: 0.15, snow: 0.35 }[this.sim.weather.type] ?? 1;
    this.warm.setFillStyle(lerpColor(wc0, wc1, wt), this.indoor ? 0 : (wa0 + (wa1 - wa0) * wt) * cloud);

    const type = this.indoor ? 'sunny' : this.sim.weather.type;
    const [gc, ga] = GLOOM[type] || GLOOM.sunny;
    this.gloom.setFillStyle(gc, ga);
    if (type !== this.weather) {
      this.weather = type;
      const rainy = type === 'rain' || type === 'storm';
      if (rainy) this.rain.start();
      else this.rain.stop();
      this.rain.setQuantity(type === 'storm' ? 7 : 4);
      if (type === 'snow') this.snow.start();
      else this.snow.stop();
    }
    if (type === 'storm' && !this.indoor && this.scene.time.now > this.nextLightning) {
      this.nextLightning = this.scene.time.now + 5000 + Math.random() * 9000;
      this.scene.cameras.main.flash(140, 230, 235, 255);
      this.scene.sfx?.thunder();
    }

    const darkness = this.sim.time.darkness();
    this.lantern.setPosition(this.player.x, this.player.y - 16).setAlpha(this.player.hidden || this.indoor ? 0 : darkness * 0.28);
    return darkness;
  }

  destroy() {
    this.scene.scale.off('resize', this.onResize, this);
  }
}
