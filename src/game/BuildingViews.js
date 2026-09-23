/**
 * BuildingViews — building sprites, decorations, chimney smoke and night lights.
 * Windows light up at night only when someone is actually inside
 * (or the business is open) — so the village's rhythm is visible.
 */
import Phaser from 'phaser';
import { BALANCE } from '../config/balance.js';
import { ensureBuildingTexture, BUILDING_META } from '../render/TextureFactory.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;

export class BuildingViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.windows = []; // { building, img, glow }
    this.lamps = []; // glow images
    this.smoke = [];

    for (const b of sim.world.buildingList) this.createBuilding(b);
    for (const d of sim.world.decor) this.createDecor(d);
  }

  createBuilding(b) {
    const scene = this.scene;
    const key = ensureBuildingTexture(scene, b);
    const meta = BUILDING_META[key];
    const x = b.tx * TS;
    const bottom = (b.ty + b.h) * TS;
    scene.add.image(x, bottom, key).setOrigin(0, 1).setDepth(bottom);

    // Collision: the footprint minus a strip at the back, so you can walk "behind" the roof edge.
    const zone = scene.add.zone(x + (b.w * TS) / 2, b.ty * TS + 10 + (b.h * TS - 10) / 2, b.w * TS, b.h * TS - 10);
    scene.physics.add.existing(zone, true);
    scene.solids.add(zone);

    const top = bottom - meta.height;
    for (const w of meta.windows) {
      const img = scene.add.image(x + w.x, top + w.y, 'window_lit').setOrigin(0).setDepth(DEPTH.LIGHTS).setAlpha(0);
      const glow = scene.add
        .image(x + w.x + w.w / 2, top + w.y + w.h / 2 + 8, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffb050)
        .setScale(0.7)
        .setDepth(DEPTH.LIGHTS)
        .setAlpha(0);
      this.windows.push({ building: b, img, glow });
    }
    if (meta.chimney) {
      const emitter = scene.add.particles(x + meta.chimney.x, top + meta.chimney.y, 'smoke', {
        speedY: { min: -24, max: -12 },
        speedX: { min: -3, max: 9 },
        lifespan: 2600,
        scale: { start: 0.45, end: 1.5 },
        alpha: { start: 0.4, end: 0 },
        frequency: 650,
      });
      emitter.setDepth(bottom + 1);
      this.smoke.push({ building: b, emitter });
    }
  }

  createDecor(d) {
    const scene = this.scene;
    const tex = d.type === 'stall' ? `decor_stall_${d.variant || 0}` : `decor_${d.type}`;
    const x = d.tx * TS + (d.w * TS) / 2;
    const bottom = d.ty * TS + TS;
    const img = scene.add.image(x, bottom - 2, tex).setOrigin(0.5, 1).setDepth(bottom - 2);
    d.sprite = img;
    if (d.block) {
      const zone = scene.add.zone(x, d.ty * TS + TS / 2 + 4, d.w * TS - 4, TS - 8);
      scene.physics.add.existing(zone, true);
      scene.solids.add(zone);
    }
    if (d.light) {
      const glow = scene.add
        .image(x, bottom - 44, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffc870)
        .setScale(1.3)
        .setDepth(DEPTH.LIGHTS)
        .setAlpha(0);
      this.lamps.push(glow);
    }
  }

  /** Is anyone home / is the business open? Decides whether windows glow. */
  isOccupied(b) {
    if (this.sim.state.npcs.some((n) => n.inside === b.id)) return true;
    if (b.id === this.sim.state.player.homeId && this.sim.state.player.sleeping) return true;
    const biz = this.sim.economy.businessAtBuilding(b.id);
    return !!biz && this.sim.economy.isOpen(biz) && this.sim.economy.def(biz).kind === 'shop';
  }

  update(darkness) {
    const flicker = 0.93 + Math.sin(this.scene.time.now / 180) * 0.04;
    for (const w of this.windows) {
      const lit = darkness > 0.05 && this.isOccupied(w.building) ? darkness : 0;
      w.img.setAlpha(lit * 0.95);
      w.glow.setAlpha(lit * 0.5 * flicker);
    }
    for (const g of this.lamps) g.setAlpha(darkness * 0.75 * flicker);
    // Chimneys smoke when someone is home or the business is running.
    for (const s of this.smoke) {
      const on = this.isOccupied(s.building);
      if (on && !s.emitter.emitting) s.emitter.start();
      else if (!on && s.emitter.emitting) s.emitter.stop();
    }
  }
}
