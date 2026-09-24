/**
 * FireViews — flames and smoke on burning buildings (bigger as the fire grows),
 * so a fire is something you see from across the village and run towards.
 */
import Phaser from 'phaser';
import { BALANCE } from '../config/balance.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;

export class FireViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.views = new Map(); // building id → { flames, smoke, glow }
  }

  create(f) {
    const b = this.sim.world.buildings[f.building];
    if (!b) return null;
    const cx = (b.tx + b.w / 2) * TS;
    const top = b.ty * TS + 6;
    const flames = this.scene.add.particles(cx, top + b.h * TS * 0.4, 'flame', {
      x: { min: -b.w * TS * 0.4, max: b.w * TS * 0.4 },
      y: { min: -10, max: b.h * TS * 0.3 },
      speedY: { min: -70, max: -30 },
      speedX: { min: -12, max: 12 },
      lifespan: 700,
      scale: { start: 1.1, end: 0.2 },
      alpha: { start: 0.95, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      frequency: 40,
    });
    flames.setDepth((b.ty + b.h) * TS + 3);
    const smoke = this.scene.add.particles(cx, top, 'smoke', {
      x: { min: -b.w * TS * 0.3, max: b.w * TS * 0.3 },
      speedY: { min: -50, max: -25 },
      speedX: { min: 5, max: 25 },
      lifespan: 3000,
      scale: { start: 0.8, end: 2.6 },
      alpha: { start: 0.55, end: 0 },
      tint: 0x3a3430,
      frequency: 120,
    });
    smoke.setDepth(DEPTH.WORLD_UI - 3);
    const glow = this.scene.add.image(cx, top + b.h * TS * 0.5, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff7020).setScale(b.w * 0.9).setDepth(DEPTH.LIGHTS);
    const v = { flames, smoke, glow };
    this.views.set(f.building, v);
    return v;
  }

  update() {
    const fires = this.sim.state.fires || [];
    const live = new Set();
    for (const f of fires) {
      live.add(f.building);
      const v = this.views.get(f.building) || this.create(f);
      if (!v) continue;
      // Bigger blaze → more flames, thicker smoke, brighter glow.
      const k = Math.max(0.15, f.intensity / 100);
      v.flames.frequency = Math.round(120 - 100 * k);
      v.smoke.frequency = Math.round(260 - 180 * k);
      v.glow.setAlpha(0.25 + 0.5 * k + Math.sin(this.scene.time.now / 90) * 0.06);
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      v.flames.destroy();
      v.smoke.stop();
      this.scene.time.delayedCall(3000, () => v.smoke.destroy());
      v.glow.destroy();
      this.views.delete(id);
    }
  }
}
