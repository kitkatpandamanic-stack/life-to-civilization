/**
 * CameraDirector — where the camera looks. Normally it follows you; it can also
 *   • lookAt(x, y): glide over to a spot (a building you picked, a worker in a list) and stay a
 *     moment — it comes back to you when you move, or after a few seconds;
 *   • follow(npcId): ride along with someone (Follow worker — see WorkerSystem), until you move or stop it.
 */
const BACK_AFTER = 5000; // ms a "look" stays before gliding back to you

export class CameraDirector {
  constructor(scene) {
    this.scene = scene;
    this.mode = 'player';
    this.npcId = null;
  }

  get cam() {
    return this.scene.cameras.main;
  }

  /** Glide to a spot in the world and hold there a moment. */
  lookAt(x, y, hold = BACK_AFTER) {
    this.cam.stopFollow();
    this.cam.pan(x, y, 450, 'Sine.easeInOut', true);
    this.mode = 'look';
    this.npcId = null;
    this.until = this.scene.time.now + hold;
    this.from = { x: this.scene.player.x, y: this.scene.player.y };
  }

  /** Ride along with a villager (a worker at their task). */
  follow(npcId) {
    const sprite = this.scene.npcViews?.spriteOf?.(npcId);
    const npc = this.scene.sim.npcs.byId(npcId);
    if (!npc) return false;
    this.cam.stopFollow();
    if (sprite) this.cam.startFollow(sprite, true, 0.12, 0.12);
    else this.cam.pan(npc.x, npc.y, 450, 'Sine.easeInOut', true);
    this.mode = 'follow';
    this.npcId = npcId;
    this.from = { x: this.scene.player.x, y: this.scene.player.y };
    this.scene.sim.bus.emit('camera:follow', { npcId });
    return true;
  }

  following() {
    return this.mode === 'follow' ? this.npcId : null;
  }

  /** Back to you. */
  back() {
    if (this.mode === 'player') return;
    const was = this.npcId;
    this.mode = 'player';
    this.npcId = null;
    this.cam.startFollow(this.scene.player.sprite, true, 0.15, 0.15);
    if (was) this.scene.sim.bus.emit('camera:follow', { npcId: null });
  }

  update() {
    if (this.mode === 'player') return;
    const p = this.scene.player;
    // You walked off: the camera comes with you.
    if (this.from && Math.hypot(p.x - this.from.x, p.y - this.from.y) > 6) return this.back();
    if (this.mode === 'look' && this.scene.time.now > this.until) return this.back();
    if (this.mode === 'follow') {
      const npc = this.scene.sim.npcs.byId(this.npcId);
      if (!npc || npc.away) return this.back();
      // Their sprite may have come into view (or gone indoors): keep riding along with the right thing.
      const sprite = this.scene.npcViews?.spriteOf?.(this.npcId);
      if (sprite && this.cam._follow !== sprite) this.cam.startFollow(sprite, true, 0.12, 0.12);
      if (!sprite) this.cam.centerOn(npc.x, npc.y);
    }
  }
}
