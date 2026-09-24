/**
 * AnimalViews — deer and rabbits you can actually see in the woods.
 *
 * The simulation keeps wildlife as populations (NatureSystem); this class
 * shows a sample of them around the player — more animals where the forest is
 * healthy and the population is large, fewer as hunting and logging take their
 * toll. Animals wander, graze, and bolt when you come too close (stand still
 * and they calm down). With a bow you can hunt them.
 */
import { BALANCE } from '../config/balance.js';
import { AREAS } from '../data/villageLayout.js';

const TS = BALANCE.tileSize;
const KINDS = {
  deer: { per: 6, max: 6, walk: 38, flee: 150, scare: 120, originY: 0.95 },
  rabbit: { per: 8, max: 8, walk: 26, flee: 170, scare: 85, originY: 0.9 },
};

export class AnimalViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.animals = [];
    this.timer = 0;
    this.nextId = 1;
  }

  inVillage(tx, ty) {
    return AREAS.clearings.some((r) => tx >= r.x1 - 2 && tx <= r.x2 + 2 && ty >= r.y1 - 2 && ty <= r.y2 + 2);
  }

  /** Keep a believable number of animals near the player. */
  maintain() {
    const sim = this.sim;
    const W = sim.state.nature?.wildlife;
    if (!W || this.scene.inside) return;
    const p = sim.state.player;
    const pt = sim.world.toTile(p.x, p.y);
    // Too far away: they wander off (despawn).
    for (const a of this.animals.slice()) {
      if (Math.hypot(a.x - p.x, a.y - p.y) > 34 * TS) this.remove(a);
    }
    for (const [kind, K] of Object.entries(KINDS)) {
      const want = Math.min(K.max, Math.round(W[kind].pop / K.per));
      const have = this.animals.filter((a) => a.kind === kind).length;
      if (have >= want) continue;
      // Find a spot in the woods, out of view, where the forest is healthy.
      for (let tries = 0; tries < 30; tries++) {
        const tx = pt.tx + Math.round((Math.random() - 0.5) * 48);
        const ty = pt.ty + Math.round((Math.random() - 0.5) * 36);
        const d = Math.hypot(tx - pt.tx, ty - pt.ty);
        if (d < 12 || d > 26 || !sim.world.inBounds(tx, ty) || sim.world.isBlocked(tx, ty) || sim.world.isWater(tx, ty) || this.inVillage(tx, ty)) continue;
        if (sim.nature.forestAround(tx, ty, 4) < (kind === 'deer' ? 4 : 1)) continue;
        this.spawn(kind, tx, ty);
        break;
      }
    }
  }

  spawn(kind, tx, ty) {
    const K = KINDS[kind];
    const x = tx * TS + TS / 2;
    const y = ty * TS + TS - 4;
    const sprite = this.scene.add.image(x, y, `${kind}_0`).setOrigin(0.5, K.originY).setDepth(y);
    const a = { id: this.nextId++, kind, x, y, sprite, state: 'idle', until: 0, tx: x, ty: y, frameT: 0, frame: 0, home: { x, y } };
    this.animals.push(a);
    return a;
  }

  remove(a) {
    a.sprite.destroy();
    this.animals = this.animals.filter((o) => o !== a);
  }

  /** A clean hit: the animal is gone. */
  kill(a) {
    this.scene.tweens.add({ targets: a.sprite, alpha: 0, duration: 400, onComplete: () => this.remove(a) });
    a.state = 'dead';
  }

  flee(a, fromX, fromY) {
    const K = KINDS[a.kind];
    const dx = a.x - fromX;
    const dy = a.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    a.state = 'flee';
    a.tx = a.x + (dx / d) * 8 * TS;
    a.ty = a.y + (dy / d) * 8 * TS;
    a.until = this.scene.time.now + 2500;
    a.speed = K.flee;
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.maintain();
    }
    const now = this.scene.time.now;
    const p = this.scene.player;
    const world = this.sim.world;
    const playerMoving = Math.hypot(p.sprite.body?.velocity.x || 0, p.sprite.body?.velocity.y || 0) > 20;
    for (const a of this.animals) {
      if (a.state === 'dead') continue;
      const K = KINDS[a.kind];
      const pd = Math.hypot(a.x - p.x, a.y - p.y);
      // Too close (and moving): bolt.
      if (a.state !== 'flee' && pd < K.scare * (playerMoving ? 1 : 0.55)) this.flee(a, p.x, p.y);
      if (a.state === 'idle' && now > a.until) {
        // Graze a bit, then amble to a nearby spot.
        a.state = 'walk';
        a.tx = a.home.x + (Math.random() - 0.5) * 6 * TS;
        a.ty = a.home.y + (Math.random() - 0.5) * 5 * TS;
        a.speed = K.walk;
      }
      if (a.state === 'walk' || a.state === 'flee') {
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const d = Math.hypot(dx, dy);
        const step = (a.speed * delta) / 1000;
        if (d <= step || (a.state === 'flee' && now > a.until)) {
          a.state = 'idle';
          a.until = now + 1500 + Math.random() * 4000;
          if (a.state === 'idle') a.home = { x: a.x, y: a.y };
        } else {
          const nx = a.x + (dx / d) * step;
          const ny = a.y + (dy / d) * step;
          const t = world.toTile(nx, ny);
          if (world.isBlocked(t.tx, t.ty) || world.isWater(t.tx, t.ty)) {
            a.state = 'idle';
            a.until = now + 800;
          } else {
            a.x = nx;
            a.y = ny;
            a.sprite.setFlipX(dx < 0);
          }
        }
        a.frameT += delta;
        if (a.frameT > (a.state === 'flee' ? 110 : 220)) {
          a.frameT = 0;
          a.frame ^= 1;
          a.sprite.setTexture(`${a.kind}_${a.frame}`);
        }
      }
      a.sprite.setPosition(a.x, a.y).setDepth(a.y).setVisible(!this.scene.inside);
    }
  }

  /** Animals within bow range of a point. */
  near(x, y, range) {
    return this.animals.filter((a) => a.state !== 'dead' && Math.hypot(a.x - x, a.y - y) <= range);
  }

  destroy() {
    for (const a of this.animals) a.sprite.destroy();
    this.animals = [];
  }
}
