/**
 * FieldViews — the player's farm tiles: tilled soil (darker when watered)
 * and crops at their growth stage, or withered plants.
 */
import { BALANCE } from '../config/balance.js';

const TS = BALANCE.tileSize;

export class FieldViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.tiles = new Map();
    this.refreshAll();
    this.unsubs = [
      sim.bus.on('field:changed', ({ tx, ty }) => this.refresh(`${tx},${ty}`)),
      sim.bus.on('fields:changed', () => this.refreshAll()),
    ];
  }

  refreshAll() {
    for (const k of Object.keys(this.sim.state.fields)) this.refresh(k);
  }

  refresh(key) {
    const f = this.sim.state.fields[key];
    let view = this.tiles.get(key);
    if (!f) {
      if (view) {
        view.soil.destroy();
        view.crop?.destroy();
        this.tiles.delete(key);
      }
      return;
    }
    const [tx, ty] = key.split(',').map(Number);
    if (!view) {
      const soil = this.scene.add.image(tx * TS, ty * TS, 'soil').setOrigin(0).setDepth(-4);
      view = { soil, crop: null };
      this.tiles.set(key, view);
    }
    view.soil.setTexture(f.watered ? 'soil_wet' : 'soil');
    const stage = this.sim.farming.stage(f);
    const tex = !f.crop ? null : f.dead ? 'pcrop_dead' : `pcrop_${f.crop}_${stage}`;
    if (!tex) {
      view.crop?.destroy();
      view.crop = null;
      return;
    }
    const y = ty * TS + TS - 1;
    if (!view.crop) view.crop = this.scene.add.image(tx * TS + TS / 2, y, tex).setOrigin(0.5, 1).setDepth(y);
    else view.crop.setTexture(tex);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}
