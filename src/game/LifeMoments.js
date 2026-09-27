/**
 * LifeMoments — small bits of everyday life on top of what the villagers are doing. Pure decoration: it only
 * moves and poses sprites (and shows a little emote); the simulation never hears of it, and it never rolls
 * the simulation's dice.
 *
 *   waving    — friends wave when you pass (and turn to look at you)
 *   benches   — benches on the square; villagers resting nearby sit down on them
 *   tag       — children playing on the square run round each other
 *   chatting  — two villagers talking turn to face each other
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
  }

  /**
   * Called for each visible villager after their normal pose is set. May move or pose the sprite, and returns
   * an emote to show over their head (or null).
   */
  apply(v, npc, now, idle) {
    const p = this.sim.state.player;
    const sprite = v.sprite;
    const task = npc.task;
    const resting = idle && task?.type === 'leisure' && task.stage === 'idle';

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
      const anim = `${v.tex}_walk_${facing}`;
      if (v.anim !== anim) sprite.anims.play(anim, true);
      v.anim = anim;
      return Math.floor(now / 2600 + npc.id.length) % 5 === 0 ? '😄' : null;
    }

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

