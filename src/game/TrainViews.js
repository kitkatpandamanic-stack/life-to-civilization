/**
 * TrainViews — the railway you can see: the line laid from the station to where the road leaves the
 * valley (rails on sleepers), and the trains on it — a locomotive with a coach and a goods wagon,
 * coming in, waiting at the platform, going out — with smoke, the whistle and the chuff of the engine.
 * Where each train is comes from TrainSystem.at() (the clock); this only draws it.
 */
import { DEPTH } from './depth.js';
import { BALANCE } from '../config/balance.js';

const TS = BALANCE.tileSize;
const CONSIST = ['loco', 'coach', 'wagon'];
const GAP = 1.7; // tiles between the cars

export class TrainViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.rails = scene.add.graphics().setDepth(DEPTH.TUFTS + 1);
    this.trains = new Map(); // line → { sprites, smoke, last }
    this.lineKey = '';
    this.frameT = 0;
    this.frame = 0;
    this.chuffT = 0;
    this.unsubs = [
      sim.bus.on('train:arrived', () => this.whistle()),
      sim.bus.on('train:departed', () => this.whistle()),
    ];
  }

  /** The line's tiles, from the station to the edge of the valley (null: no railway yet). */
  path() {
    const T = this.sim.trains;
    const st = T?.station();
    const way = this.sim.exploration?.waymark();
    if (!st || !way || !T.lines().length) return null;
    const p = this.sim.logistics.pathTo(st.id, way);
    return p && p.length > 1 ? p : null;
  }

  /** A point u (0 = station … 1 = the valley's edge) along the line: { x, y, dx }. */
  point(path, u) {
    const f = Math.max(0, Math.min(1, u)) * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    const k = f - i;
    const a = path[i];
    const b = path[i + 1];
    const ax = a.tx * TS + TS / 2;
    const ay = a.ty * TS + TS / 2;
    const bx = b.tx * TS + TS / 2;
    const by = b.ty * TS + TS / 2;
    return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, dx: bx - ax };
  }

  drawRails(path) {
    const g = this.rails;
    g.clear();
    if (!path) return;
    // Sleepers, then the two rails.
    g.fillStyle(0x6a4a2e, 1);
    for (const p of path) {
      const cx = p.tx * TS + TS / 2;
      const cy = p.ty * TS + TS / 2;
      for (const o of [-8, 8]) g.fillRect(cx - 12, cy + o - 2, 24, 4);
    }
    g.lineStyle(3, 0x8a8f96, 1);
    for (const off of [-7, 7]) {
      g.beginPath();
      path.forEach((p, i) => {
        const x = p.tx * TS + TS / 2 + off * 0.6;
        const y = p.ty * TS + TS / 2 + off * 0.6;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.strokePath();
    }
  }

  update(delta) {
    // (The line only changes when a railway opens or the station moves: looked up once a second.)
    this.pathT = (this.pathT || 0) - delta;
    if (this.pathT <= 0) {
      this.pathT = 1000;
      this.cachedPath = this.path();
    }
    const path = this.cachedPath;
    const key = path ? `${path.length}:${path[0].tx},${path[0].ty}:${path[path.length - 1].tx}` : '';
    if (key !== this.lineKey) {
      this.lineKey = key;
      this.drawRails(path);
    }
    this.rails.setVisible(!this.scene.inside);
    this.frameT += delta;
    if (this.frameT > 140) {
      this.frameT = 0;
      this.frame ^= 1;
    }
    const alive = new Set();
    if (path && !this.scene.inside) {
      const n = path.length - 1;
      const du = GAP / Math.max(1, n);
      for (const tr of this.sim.trains.at()) {
        alive.add(tr.line);
        let v = this.trains.get(tr.line);
        if (!v) {
          const sprites = CONSIST.map((c) => this.scene.add.image(0, 0, `train_${c}_0`).setOrigin(0.5, 0.9));
          const smoke = this.scene.add.particles(0, 0, 'smoke', { speedY: { min: -40, max: -20 }, speedX: { min: -8, max: 8 }, lifespan: 1800, scale: { start: 0.5, end: 1.8 }, alpha: { start: 0.55, end: 0 }, frequency: 160 });
          v = { sprites, smoke };
          this.trains.set(tr.line, v);
        }
        // u along the line (0 at the station): coming in, the cars trail behind toward the edge; going
        // out, the engine leads toward the edge and the cars follow.
        const u = 1 - tr.t;
        const outward = tr.stage === 'out';
        const moving = tr.stage !== 'at';
        CONSIST.forEach((c, i) => {
          const pu = outward ? u - i * du : u + i * du;
          const p = this.point(path, pu);
          const ahead = this.point(path, outward ? pu + 0.02 : pu - 0.02);
          const dir = ahead.x - p.x;
          const s = v.sprites[i];
          s.setPosition(p.x, p.y + 10).setDepth(p.y + 10).setFlipX(dir < 0).setTexture(`train_${c}_${moving ? this.frame : 0}`).setVisible(pu >= -0.001 && pu <= 1.001);
        });
        const loco = v.sprites[0];
        v.smoke.setPosition(loco.x + (loco.flipX ? -12 : 12), loco.y - 36).setDepth(loco.depth + 1);
        v.smoke.frequency = moving ? 120 : 600;
        // The engine working.
        if (moving) {
          this.chuffT -= delta;
          if (this.chuffT <= 0) {
            this.chuffT = 320;
            this.scene.sfx?.at('chuff', loco.x, loco.y, 1.2);
          }
        }
        v.at = { x: loco.x, y: loco.y };
      }
    }
    for (const [line, v] of this.trains) {
      if (alive.has(line)) continue;
      v.sprites.forEach((s) => s.destroy());
      v.smoke.destroy();
      this.trains.delete(line);
    }
  }

  whistle() {
    const st = this.sim.trains?.station();
    if (st) this.scene.sfx?.at('whistle', (st.tx + st.w / 2) * TS, (st.ty + st.h) * TS, 1.5);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
    this.rails.destroy();
    for (const v of this.trains.values()) {
      v.sprites.forEach((s) => s.destroy());
      v.smoke.destroy();
    }
    this.trains.clear();
  }
}
