/**
 * CartViews — goods on the move. Every shipment in LogisticsSystem is drawn as
 * a porter (or a line of porters for a big load) or a cart travelling along its
 * route, so busy trade means busy roads.
 */
import { CARRIERS, LOGISTICS as L } from '../data/transport.js';

export class CartViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.views = new Map(); // shipment id → [sprites]
    this.frameT = 0;
    this.frame = 0;
  }

  update(delta) {
    const sim = this.sim;
    const ships = sim.state.logistics?.shipments || [];
    const cam = this.scene.cameras.main.worldView;
    this.frameT += delta;
    if (this.frameT > 180) {
      this.frameT = 0;
      this.frame ^= 1;
    }
    const alive = new Set();
    let shown = 0;
    for (const s of ships) {
      if (shown >= L.maxVisible) break;
      const pos = sim.logistics.position(s);
      if (!pos || !pos.moving || this.scene.inside) continue;
      if (pos.x < cam.x - 200 || pos.x > cam.right + 200 || pos.y < cam.y - 200 || pos.y > cam.bottom + 200) continue;
      alive.add(s.id);
      shown++;
      const sprite = CARRIERS[s.carrier]?.sprite || 'porter';
      // A big load on foot means several porters in a line.
      const count = s.carrier === 'porter' ? Math.min(3, s.trips) : 1;
      let list = this.views.get(s.id);
      if (!list) {
        list = [];
        for (let i = 0; i < count; i++) list.push(this.scene.add.image(pos.x, pos.y, `${sprite}_0`).setOrigin(0.5, 0.95));
        this.views.set(s.id, list);
      }
      const dx = pos.facing === 'left' ? 1 : pos.facing === 'right' ? -1 : 0;
      const dy = pos.facing === 'up' ? 1 : pos.facing === 'down' ? -1 : 0;
      list.forEach((spr, i) => {
        const x = pos.x + dx * i * 16;
        const y = pos.y + dy * i * 16 + 6;
        spr.setPosition(x, y).setDepth(y).setFlipX(pos.facing === 'left').setTexture(`${sprite}_${(this.frame + i) % 2}`).setVisible(true);
      });
    }
    for (const [id, list] of this.views) {
      if (alive.has(id)) continue;
      for (const spr of list) spr.destroy();
      this.views.delete(id);
    }
  }

  destroy() {
    for (const list of this.views.values()) for (const s of list) s.destroy();
    this.views.clear();
  }
}

