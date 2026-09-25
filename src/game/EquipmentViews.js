/**
 * EquipmentViews — barrows, carts, wagons and baskets where they really are (EquipmentSystem):
 * standing where they were left, pushed along in front of the worker using them, or with you.
 * What's in them shows on top (logs, stones, goods), so a full barrow looks full. A worker
 * carrying by hand has a sack on their shoulder — you can see who's carrying and how.
 */
import { EQUIPMENT } from '../data/transport.js';

const OFFSET = { push: 15, pull: 20, animal: 18, vehicle: 22, hand: 7 };
const LOAD_Y = { wheelbarrow: 9, handcart: 9, wooden_wagon: 10, pack_horse: 14, horse_cart: 16, wagon: 16, basket: 8, sack: 9, crate: 8 };

export class EquipmentViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.views = new Map(); // equipment id → { spr, load }
    this.bundles = new Map(); // npc id → sprite (carrying by hand)
    this.frameT = 0;
    this.frame = 0;
  }

  loadKind(items) {
    const keys = Object.keys(items || {});
    if (keys.includes('wood') || keys.includes('planks')) return 'wood';
    if (keys.includes('stone') || keys.includes('bricks')) return 'stone';
    return keys.length ? 'misc' : null;
  }

  update(delta) {
    const sim = this.sim;
    const E = sim.equipment;
    if (!E) return;
    const cam = this.scene.cameras.main.worldView;
    const inside = this.scene.inside;
    this.frameT += delta;
    if (this.frameT > 160) {
      this.frameT = 0;
      this.frame ^= 1;
    }
    const alive = new Set();
    const p = sim.state.player;
    const TS = 32;
    for (const eq of E.list()) {
      if (inside || !EQUIPMENT[eq.type]) continue;
      const d = EQUIPMENT[eq.type];
      let x;
      let y;
      let facing = 'right';
      let moving = false;
      let cargo = eq.cargo?.items || null;
      if (eq.at.kind === 'ground') {
        x = eq.at.tx * TS + TS / 2;
        y = eq.at.ty * TS + TS - 4;
      } else if (eq.at.kind === 'npc') {
        const n = sim.npcs.byId(eq.at.id);
        if (!n || n.inside || n.simLevel === 'abstract') continue;
        facing = n.facing;
        moving = n.moving;
        cargo = n.carry ? n.carry.items || { [n.carry.item]: n.carry.qty } : cargo;
        ({ x, y } = this.beside(n.x, n.y, facing, OFFSET[d.kind] || 12, d.kind));
      } else {
        const pl = this.scene.player;
        if (!pl || pl.hidden) continue;
        facing = pl.facing || 'down';
        moving = !!pl.sprite?.body?.velocity && (Math.abs(pl.sprite.body.velocity.x) + Math.abs(pl.sprite.body.velocity.y) > 1);
        ({ x, y } = this.beside(pl.x ?? p.x, pl.y ?? p.y, facing, OFFSET[d.kind] || 12, d.kind));
      }
      if (x < cam.x - 80 || x > cam.right + 80 || y < cam.y - 80 || y > cam.bottom + 80) continue;
      alive.add(eq.id);
      let v = this.views.get(eq.id);
      const tex = this.scene.textures.exists(`eq_${eq.type}_0`) ? `eq_${eq.type}` : 'eq_crate';
      if (!v) {
        v = { spr: this.scene.add.image(x, y, `${tex}_0`).setOrigin(0.5, 1), load: this.scene.add.image(x, y, 'eq_load_misc').setOrigin(0.5, 1).setVisible(false) };
        this.views.set(eq.id, v);
      }
      const flip = facing === 'left';
      const f = moving ? this.frame : 0;
      // Worn out: it looks it (greyer); broken: tipped over.
      const tint = E.broken(eq) ? 0x777777 : E.damaged(eq) ? 0xbbaa99 : 0xffffff;
      v.spr.setPosition(x, y).setTexture(`${tex}_${f}`).setFlipX(flip).setDepth(y + (facing === 'up' ? -2 : 2)).setTint(tint).setAngle(E.broken(eq) ? 12 : 0).setVisible(true);
      const kind = this.loadKind(cargo);
      if (kind && d.kind !== 'hand') {
        const fill = Math.min(1, Object.values(cargo).reduce((a, b) => a + b, 0) / Math.max(1, E.cap(eq) || d.cap));
        v.load.setTexture(`eq_load_${kind}`).setPosition(x + (flip ? 2 : -2), y - (LOAD_Y[eq.type] || 9)).setScale(0.7 + fill * 0.5, 0.6 + fill * 0.8).setFlipX(flip).setDepth(y + 3).setVisible(true);
      } else v.load.setVisible(false);
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      v.spr.destroy();
      v.load.destroy();
      this.views.delete(id);
    }
    // Your workers carrying by hand: a sack on the shoulder.
    const hands = new Set();
    if (!inside) {
      for (const c of sim.workers.list()) {
        const n = sim.npcs.byId(c.npcId);
        if (!n || !n.carry || n.eq || n.inside || n.simLevel === 'abstract') continue;
        if (n.x < cam.x - 40 || n.x > cam.right + 40 || n.y < cam.y - 40 || n.y > cam.bottom + 40) continue;
        hands.add(n.id);
        let s = this.bundles.get(n.id);
        if (!s) {
          s = this.scene.add.image(n.x, n.y, 'eq_bundle').setOrigin(0.5, 1);
          this.bundles.set(n.id, s);
        }
        const back = n.facing === 'left' ? 6 : n.facing === 'right' ? -6 : 0;
        s.setPosition(n.x + back, n.y - 20).setDepth(n.y + (n.facing === 'down' ? -1 : 1)).setVisible(true);
      }
    }
    for (const [id, s] of this.bundles) {
      if (hands.has(id)) continue;
      s.destroy();
      this.bundles.delete(id);
    }
  }

  /** In front of whoever's using it (a basket held at the side). */
  beside(x, y, facing, off, kind) {
    if (kind === 'hand') return { x: x + (facing === 'left' ? -off : off), y: y - 4 };
    if (facing === 'left') return { x: x - off, y: y + 1 };
    if (facing === 'right') return { x: x + off, y: y + 1 };
    if (facing === 'up') return { x: x + 8, y: y - 12 }; // (a little to the side, so it isn't hidden behind them)
    return { x, y: y + 12 };
  }

  destroy() {
    for (const v of this.views.values()) {
      v.spr.destroy();
      v.load.destroy();
    }
    for (const s of this.bundles.values()) s.destroy();
    this.views.clear();
    this.bundles.clear();
  }
}
