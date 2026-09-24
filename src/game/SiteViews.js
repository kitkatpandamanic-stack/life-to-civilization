/**
 * SiteViews — the discovery sites out in the valley (caves, ruins, an abandoned
 * cabin…). They're drawn from the start: they're just there, waiting to be
 * found. Once explored they look a little trodden (a lantern left at a cave mouth).
 */
import { BALANCE } from '../config/balance.js';

const TS = BALANCE.tileSize;

export class SiteViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.sprites = new Map();
    for (const s of sim.state.exploration.sites) this.add(s);
    this.unsub = sim.bus.on('site:changed', (id) => this.refresh(id));
  }

  add(s) {
    const x = (s.tx + 1) * TS;
    const y = (s.ty + 1) * TS;
    const img = this.scene.add.image(x, y, `site_${s.kind}`).setOrigin(0.5, 1).setDepth(y);
    this.sprites.set(s.id, img);
    this.refresh(s.id);
  }

  refresh(id) {
    const s = this.sim.exploration.site(id);
    const img = this.sprites.get(id);
    if (!s || !img) return;
    // Explored and developed sites look visited; unknown ones are a touch wilder.
    img.setTint(s.state === 'unknown' || s.state === 'discovered' ? 0xe8e4dc : 0xffffff);
  }

  destroy() {
    this.unsub?.();
    for (const img of this.sprites.values()) img.destroy();
  }
}
