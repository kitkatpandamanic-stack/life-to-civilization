/**
 * LifeMoments — small bits of everyday life on top of what the villagers are doing. Pure decoration: it only
 * moves and poses sprites (and shows a little emote); the simulation never hears of it, and it never rolls
 * the simulation's dice.
 *
 *   waving    — friends wave when you pass (and turn to look at you)
 *   benches   — benches on the square; villagers resting nearby sit down on them
 *   tag       — children playing on the square run round each other
 *   chatting  — two villagers talking turn to face each other
 *   seasons   — children on sleds in the snow; swimmers waist-deep in the lake on hot days; dancing at the
 *               midsummer and harvest festivals
 */
import { BALANCE } from '../config/balance.js';
import { AREAS } from '../data/villageLayout.js';
import { CHAR_COLS } from '../render/CharacterArt.js';
import { idleFrame } from './characters.js';

const TS = BALANCE.tileSize;
/** Benches on the square (view only: they don't block anyone). Each seats two, facing down. */
const BENCHES = [
  { tx: 46, ty: 37 },
  { tx: 42, ty: 41 },
  { tx: 51, ty: 41 },
];
const SIT = 7; // the sitting column of the character sheet
const WAVE_EVERY = 90000;

function inside(npc, r) {
  const tx = npc.x / TS;
  const ty = npc.y / TS;
  return tx >= r.x1 && tx <= r.x2 + 1 && ty >= r.y1 && ty <= r.y2 + 1;
}

/** Which way to face to look from a to b. */
function faceTowards(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

export class LifeMoments {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.benches = BENCHES.map((b) => {
      const img = scene.add.image(b.tx * TS + TS, b.ty * TS + TS - 2, 'decor_bench').setOrigin(0.5, 1).setDepth(b.ty * TS + TS - 6);
      return { ...b, img, seats: [null, null] };
    });
    this.lastWave = new Map();
  }

  /** Free the seats of villagers no longer sitting. */
  beginFrame() {
    for (const b of this.benches) b.seats = b.seats.map((id) => (id && this.sitters?.has(id) ? id : null));
    this.sitters = new Set();
    // Who's standing about (at leisure, outdoors): neighbours turn to talk to each other.
    this.idlers = this.sim.state.npcs.filter((n) => !n.inside && !n.moving && n.task?.type === 'leisure' && n.task.stage === 'idle' && n.age >= 6);
  }

  /** The nearest villager standing about within a couple of steps (to talk to). */
  neighbour(npc) {
    let best = null;
    let bd = 52;
    for (const o of this.idlers || []) {
      if (o === npc) continue;
      const d = Math.hypot(o.x - npc.x, o.y - npc.y);
      if (d < bd) (bd = d), (best = o);
    }
    return best;
  }

  /**
   * Called for each visible villager after their normal pose is set. May move or pose the sprite, and returns
   * an emote to show over their head (or null).
   */
  /** A little sled (made once, the first time there's snow). */
  sledTexture() {
    if (this.scene.textures.exists('life_sled')) return 'life_sled';
    const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x7a4a2a, 1).fillRoundedRect(1, 3, 20, 5, 2);
    g.fillStyle(0x3a2412, 1).fillRect(2, 8, 18, 1.5).fillRect(0, 6, 2, 3);
    g.generateTexture('life_sled', 22, 10);
    g.destroy();
    return 'life_sled';
  }

  apply(v, npc, now, idle) {
    const p = this.sim.state.player;
    const sprite = v.sprite;
    const task = npc.task;
    const resting = idle && task?.type === 'leisure' && task.stage === 'idle';
    const why = resting ? npc.plan?.why : null;

    // Swimming on a hot day: waist-deep in the lake, bobbing.
    if (why === 'swim') {
      const bob = Math.sin(now / 400 + npc.id.length) * 1.5;
      sprite.setPosition(npc.x, npc.y + 12 + bob).setDepth(npc.y + 12);
      sprite.setCrop(0, 0, 32, 30);
      v.swimming = true;
      return Math.floor(now / 3000 + npc.id.length) % 6 === 0 ? '🏊' : null;
    }
    if (v.swimming) {
      sprite.setCrop();
      v.swimming = false;
    }
    // Dancing at the midsummer and harvest festivals (and the spring fair).
    if (resting && task.plan === 'festival' && npc.age >= 6) {
      const fest = this.sim.state.festivals?.current?.id;
      if (fest === 'midsummer' || fest === 'harvest' || fest === 'spring_fair') {
        const step = Math.floor(now / 380 + npc.id.length);
        const dirs = ['left', 'down', 'right', 'down'];
        sprite.setFrame(idleFrame(dirs[step % 4]));
        sprite.setPosition(npc.x + Math.sin(now / 380 + npc.id.length) * 5, npc.y - Math.abs(Math.sin(now / 190)) * 3);
        return step % 9 === 0 ? '🎶' : null;
      }
    }

    // Children at play on the square: round and round each other.
    if (resting && npc.age >= 5 && npc.age < 14 && inside(npc, AREAS.plaza)) {
      const dir = npc.id.charCodeAt(npc.id.length - 1) % 2 ? 1 : -1;
      const r = 14 + (npc.id.length % 3) * 4;
      const a = (now / 700) * dir + npc.id.length;
      const x = npc.x + Math.cos(a) * r;
      const y = npc.y + Math.sin(a) * r * 0.6;
      sprite.setPosition(x, y).setDepth(y);
      const vx = -Math.sin(a) * dir;
      const vy = Math.cos(a) * dir * 0.6;
      const facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      // Snow on the ground: they're on sleds, sliding round (no running).
      const snow = this.sim.time.season === 'winter' && (this.sim.seasons?.snow?.() || 0) > 0.1;
      if (snow) {
        if (!v.sled) v.sled = this.scene.add.image(x, y, this.sledTexture()).setOrigin(0.5, 0.5);
        v.sled.setVisible(true).setPosition(x, y - 2).setDepth(y - 1);
        sprite.anims.stop();
        v.anim = '';
        sprite.setFrame(0 * CHAR_COLS + SIT + (facing === 'down' ? 0 : 0)).setPosition(x, y - 4);
        return Math.floor(now / 2600 + npc.id.length) % 5 === 0 ? '⛄' : null;
      }
      const anim = `${v.tex}_walk_${facing}`;
      if (v.anim !== anim) sprite.anims.play(anim, true);
      v.anim = anim;
      return Math.floor(now / 2600 + npc.id.length) % 5 === 0 ? '😄' : null;
    }

    if (v.sled?.visible) v.sled.setVisible(false);
    // Resting near a bench: sit on it.
    if (resting && npc.age >= 14) {
      for (const b of this.benches) {
        if (Math.abs(npc.x / TS - (b.tx + 1)) > 2.5 || Math.abs(npc.y / TS - b.ty) > 2.5) continue;
        let seat = b.seats.indexOf(npc.id);
        if (seat < 0) seat = b.seats.indexOf(null);
        if (seat < 0) break;
        b.seats[seat] = npc.id;
        this.sitters.add(npc.id);
        const x = b.tx * TS + TS + (seat ? 9 : -9);
        const y = b.ty * TS + TS - 1;
        sprite.anims.stop();
        v.anim = '';
        sprite.setPosition(x, y).setDepth(y + 1).setFrame(0 * CHAR_COLS + SIT);
        return null;
      }
    }

    // Talking with someone: face them.
    if (idle && v.faceTo && now < v.bubbleUntil) {
      const o = this.sim.npcs.byId(v.faceTo);
      if (o) sprite.setFrame(idleFrame(faceTowards(npc.x, npc.y, o.x, o.y)));
    } else if (resting && npc.age >= 6) {
      // Standing about next to someone: turn to them and pass the time of day (now and then a word).
      const o = this.neighbour(npc);
      if (o) {
        sprite.setFrame(idleFrame(faceTowards(npc.x, npc.y, o.x, o.y)));
        const turn = Math.floor(now / 2200 + (npc.id < o.id ? 0 : 1)) % 4;
        if (turn === 0 && Math.floor(now / 8800 + npc.id.length) % 2 === 0) return '💬';
      }
    }

    // A friend waves as you pass, and turns to look at you.
    const dist = Math.hypot(npc.x - p.x, npc.y - p.y);
    if (idle && npc.age >= 6 && dist < 90 && (npc.rel ?? 0) >= 25 && !p.away) {
      const last = this.lastWave.get(npc.id) || -Infinity;
      if (now - last > WAVE_EVERY) this.lastWave.set(npc.id, now);
      if (now - (this.lastWave.get(npc.id) || 0) < 1800) {
        sprite.setFrame(idleFrame(faceTowards(npc.x, npc.y, p.x, p.y)));
        return '👋';
      }
    }
    return null;
  }

  destroy() {
    for (const b of this.benches) b.img.destroy();
  }
}

