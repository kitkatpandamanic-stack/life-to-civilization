/**
 * LivestockViews — your chickens, sheep and cows about your barns, and the village farm's herd about
 * the farmhouse. They amble, graze and stand about (never through walls or into the river), and now and
 * then you hear them. What they are and how they are is LivestockSystem's; this only shows them.
 */
import { BALANCE } from '../config/balance.js';
import { LIVESTOCK } from '../data/livestock.js';

const TS = BALANCE.tileSize;
const LOOK = {
  chicken: { walk: 22, origin: 0.95 },
  sheep: { walk: 16, origin: 0.95 },
  cow: { walk: 12, origin: 0.95 },
};

export class LivestockViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.views = new Map(); // key → view
    this.timer = 0;
    this.frameT = 0;
  }

  /** Where each should be: [{ key, kind, barn, shorn }] — yours and the farm's. */
  wanted() {
    const sim = this.sim;
    const out = [];
    const day = sim.time.day;
    for (const a of sim.livestock?.S.animals || []) out.push({ key: `a${a.id}`, kind: a.kind, barn: a.barn, shorn: a.kind === 'sheep' && a.shornDay !== undefined && day - a.shornDay < 4 });
    const v = sim.livestock?.villageHerd();
    if (v) for (const [kind, n] of Object.entries(v.herd)) for (let i = 0; i < n; i++) out.push({ key: `v_${kind}_${i}`, kind, barn: v.building });
    return out;
  }

  /** A spot in the yard around a building: walkable ground beside it (not on a road, not in the river). */
  spotNear(b) {
    const w = this.sim.world;
    for (let tries = 0; tries < 25; tries++) {
      const tx = b.tx - 2 + Math.floor(Math.random() * (b.w + 4));
      const ty = b.ty - 1 + Math.floor(Math.random() * (b.h + 5));
      if (tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h) continue; // (not inside it)
      if (!w.inBounds(tx, ty) || w.isBlocked(tx, ty) || w.isWater(tx, ty) || w.isRoad(tx, ty)) continue;
      return { x: tx * TS + 6 + Math.random() * 20, y: ty * TS + 10 + Math.random() * 18 };
    }
    return { x: (b.tx + b.w / 2) * TS, y: (b.ty + b.h + 1) * TS };
  }

  sync() {
    const sim = this.sim;
    const keep = new Set();
    for (const want of this.wanted()) {
      keep.add(want.key);
      const b = sim.world.buildings[want.barn];
      if (!b) continue;
      let v = this.views.get(want.key);
      if (!v) {
        const at = this.spotNear(b);
        const sprite = this.scene.add.image(at.x, at.y, `${want.kind}_0`).setOrigin(0.5, LOOK[want.kind].origin).setDepth(at.y);
        v = { ...want, x: at.x, y: at.y, tx: at.x, ty: at.y, sprite, state: 'idle', until: 0, frame: 0, b };
        this.views.set(want.key, v);
      }
      v.barn = want.barn;
      v.b = b;
      v.shorn = want.shorn;
    }
    for (const [k, v] of this.views) {
      if (keep.has(k)) continue;
      v.sprite.destroy();
      this.views.delete(k);
    }
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.sync();
      this.sounds();
    }
    const now = this.scene.time.now;
    this.frameT += delta;
    const flip = this.frameT > 260;
    if (flip) this.frameT = 0;
    const inside = !!this.scene.inside;
    const cam = this.scene.cameras.main.worldView;
    for (const v of this.views.values()) {
      const visible = !inside && v.x > cam.x - 64 && v.x < cam.right + 64 && v.y > cam.y - 64 && v.y < cam.bottom + 64;
      v.sprite.setVisible(visible);
      if (!visible) continue;
      if (v.state === 'idle' && now > v.until) {
        const at = this.spotNear(v.b);
        v.tx = at.x;
        v.ty = at.y;
        v.state = 'walk';
      }
      const tex = v.kind === 'sheep' && v.shorn ? 'sheep_shorn' : v.kind;
      if (v.state === 'walk') {
        const dx = v.tx - v.x;
        const dy = v.ty - v.y;
        const d = Math.hypot(dx, dy);
        const step = (LOOK[v.kind].walk * delta) / 1000;
        if (d <= step) {
          v.state = 'idle';
          v.until = now + 2500 + Math.random() * 6000;
        } else {
          v.x += (dx / d) * step;
          v.y += (dy / d) * step;
          v.sprite.setFlipX(dx < 0);
          if (flip) v.frame ^= 1;
        }
      }
      v.sprite.setTexture(`${tex}_${v.state === 'walk' ? v.frame : 0}`).setPosition(v.x, v.y).setDepth(v.y);
    }
  }

  /** Now and then one of them says something (if you're near enough to hear). */
  sounds() {
    const sfx = this.scene.sfx;
    if (!sfx || this.scene.inside) return;
    for (const v of this.views.values()) {
      if (!v.sprite.visible) continue;
      if (Math.random() < (v.kind === 'chicken' ? 0.02 : 0.012)) sfx.at(LIVESTOCK[v.kind].sound, v.x, v.y, 0.8);
    }
  }

  destroy() {
    for (const v of this.views.values()) v.sprite.destroy();
    this.views.clear();
  }
}
