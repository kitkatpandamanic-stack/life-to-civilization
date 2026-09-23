/**
 * PlayerController — the player's sprite, WASD/arrow movement, collisions,
 * animations and timed actions (chopping, mining, harvesting...).
 */
import { BALANCE } from '../config/balance.js';
import { Mod } from '../systems/Modifiers.js';
import { ensureCharacter, idleFrame, CHAR_ORIGIN_Y } from './characters.js';
import { DEPTH } from './depth.js';

export class PlayerController {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    const p = sim.state.player;
    this.tex = ensureCharacter(scene, 'player', p.look);
    this.sprite = scene.physics.add.sprite(p.x, p.y, this.tex, idleFrame(p.facing)).setOrigin(0.5, CHAR_ORIGIN_Y);
    this.sprite.body.setSize(14, 8).setOffset(9, 39);
    this.sprite.setCollideWorldBounds(true);
    this.facing = p.facing || 'down';
    this.keys = scene.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT');
    this.action = null;
    this.hidden = false;
    this.bar = scene.add.graphics().setDepth(DEPTH.WORLD_UI);
    // One emitter per particle texture (wood chips, stone dust, leaves...).
    this.fx = {};
    for (const tex of ['chip', 'dot', 'spark']) {
      this.fx[tex] = scene.add
        .particles(0, 0, tex, { speed: { min: 40, max: 110 }, angle: { min: 200, max: 340 }, gravityY: 260, lifespan: 600, scale: { start: 1, end: 0.4 }, emitting: false })
        .setDepth(DEPTH.WORLD_UI - 1);
    }
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.sprite.setVisible(!hidden);
    this.sprite.body.enable = !hidden;
    if (hidden) this.sprite.setVelocity(0, 0);
  }

  teleport(x, y) {
    this.sprite.setPosition(x, y);
    this.sprite.body.reset(x, y);
    this.sim.state.player.x = x;
    this.sim.state.player.y = y;
  }

  /** Start a timed action. Moving cancels it. */
  startAction({ duration, onComplete, particles = null, target = null }) {
    this.cancelAction();
    if (target) this.faceTowards(target.x, target.y);
    this.action = { elapsed: 0, duration, onComplete, particles, target, nextFx: 250 };
    this.sprite.setVelocity(0, 0);
  }

  cancelAction() {
    if (!this.action) return;
    this.action = null;
    this.bar.clear();
  }

  isBusy() {
    return !!this.action;
  }

  faceTowards(x, y) {
    const dx = x - this.sprite.x;
    const dy = y - this.sprite.y;
    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
    else this.facing = dy > 0 ? 'down' : 'up';
  }

  update(delta, blocked) {
    const p = this.sim.state.player;
    if (this.hidden) return;
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (!blocked) {
      if (k.A.isDown || k.LEFT.isDown) vx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) vx += 1;
      if (k.W.isDown || k.UP.isDown) vy -= 1;
      if (k.S.isDown || k.DOWN.isDown) vy += 1;
    }
    if ((vx || vy) && this.action) this.cancelAction();

    if (this.action) {
      this.updateAction(delta, blocked);
    } else if (vx || vy) {
      const len = Math.hypot(vx, vy);
      const tile = this.sim.world.toTile(this.sprite.x, this.sprite.y);
      let speed = Mod.moveSpeed(p) * this.sim.weather.mods().move;
      if (this.sim.world.isRoad(tile.tx, tile.ty)) speed *= 1 + BALANCE.player.roadSpeedBonus;
      if (p.energy < BALANCE.needs.lowThreshold) speed *= 0.8;
      this.sprite.setVelocity((vx / len) * speed, (vy / len) * speed);
      if (Math.abs(vx) >= Math.abs(vy) && vx !== 0) this.facing = vx > 0 ? 'right' : 'left';
      else this.facing = vy > 0 ? 'down' : 'up';
      this.sprite.anims.play(`${this.tex}_walk_${this.facing}`, true);
    } else {
      this.sprite.setVelocity(0, 0);
      this.sprite.anims.stop();
      this.sprite.setFrame(idleFrame(this.facing));
    }
    this.sprite.setDepth(this.sprite.y);
    p.x = this.sprite.x;
    p.y = this.sprite.y;
    p.facing = this.facing;
  }

  updateAction(delta, blocked) {
    const a = this.action;
    this.sprite.setVelocity(0, 0);
    if (blocked) return; // paused while a menu is open
    a.elapsed += delta;
    this.sprite.anims.play(`${this.tex}_work_${this.facing}`, true);
    a.nextFx -= delta;
    if (a.nextFx <= 0 && a.particles && a.target) {
      a.nextFx = 420;
      this.fx[a.particles]?.explode(4, a.target.x, a.target.y - 14);
    }
    this.drawBar(Math.min(1, a.elapsed / a.duration));
    if (a.elapsed >= a.duration) {
      this.action = null;
      this.bar.clear();
      this.sprite.anims.stop();
      this.sprite.setFrame(idleFrame(this.facing));
      a.onComplete?.();
    }
  }

  drawBar(pct) {
    const g = this.bar;
    const x = this.sprite.x - 20;
    const y = this.sprite.y - 56;
    g.clear();
    g.fillStyle(0x1b140e, 0.85);
    g.fillRoundedRect(x - 2, y - 2, 44, 10, 4);
    g.fillStyle(0xffc34d, 1);
    g.fillRoundedRect(x, y, 40 * pct, 6, 3);
  }
}
