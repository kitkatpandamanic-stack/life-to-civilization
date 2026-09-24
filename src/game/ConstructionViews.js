/**
 * ConstructionViews — what land and construction look like in the world:
 *   • corner stakes around every plot (gold ones on land you own) and a flag on your signs
 *   • construction sites that visibly progress: foundation → frame → walls → roof
 *   • material piles next to the site as materials are delivered
 *   • a progress bar when you're nearby, and dust when a new stage is reached
 *   • roads appearing in the terrain as they're laid
 */
import { BALANCE } from '../config/balance.js';
import { PLOTS } from '../data/land.js';
import { T } from '../world/WorldGenerator.js';
import { ensureSiteTexture } from '../render/TextureFactory.js';
import { DEPTH } from './depth.js';
import { VILLAGE_BUILDINGS } from '../data/villageBuildings.js';

const TS = BALANCE.tileSize;
const PILE_TEX = { wood: 'pile_wood', stone: 'pile_stone', planks: 'pile_planks' };

export class ConstructionViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.sites = new Map(); // construction id → view
    this.stakes = [];
    this.bars = scene.add.graphics().setDepth(DEPTH.WORLD_UI);
    this.dust = scene.add.particles(0, 0, 'smoke', { speed: { min: 20, max: 60 }, lifespan: 900, scale: { start: 0.6, end: 1.4 }, alpha: { start: 0.5, end: 0 }, emitting: false }).setDepth(DEPTH.WORLD_UI - 2);
    this.drawPlots();
    for (const c of sim.construction.sites()) this.createSite(c);
    this.unsubs = [
      sim.bus.on('land:changed', () => this.drawPlots()),
      sim.bus.on('construction:changed', (c) => this.updateSite(c)),
      sim.bus.on('construction:stage', (c) => this.puff(c)),
      sim.bus.on('construction:removed', (c) => this.removeSite(c.id)),
      sim.bus.on('building:added', (id) => this.removeSite(id)),
      sim.bus.on('road:built', ({ tx, ty }) => this.road(tx, ty)),
    ];
  }

  drawPlots() {
    for (const s of this.stakes) s.destroy();
    this.stakes = [];
    for (const p of PLOTS) {
      const owned = this.sim.land.isOwned(p.id);
      const tex = owned ? 'plot_stake_owned' : 'plot_stake';
      for (const [x, y] of [[p.x1, p.y1], [p.x2 + 1, p.y1], [p.x1, p.y2 + 1], [p.x2 + 1, p.y2 + 1]]) {
        this.stakes.push(this.scene.add.image(x * TS, y * TS, tex).setOrigin(0.5, 1).setDepth(y * TS));
      }
      if (owned) {
        const [sx, sy] = p.sign;
        this.stakes.push(this.scene.add.image(sx * TS + 22, sy * TS + 10, 'owner_flag').setOrigin(0, 1).setDepth(sy * TS + 31));
      }
    }
  }

  // ------------------------------------------------------------------ sites

  /** Villager projects: the site looks like the building it will become. */
  visualOf(c) {
    return VILLAGE_BUILDINGS[c.type]?.visual || c.type;
  }

  siteTexture(c) {
    const type = c.kind === 'upgrade' ? `player_${c.toTier}` : c.kind === 'repair' ? c.type : this.sim.construction.isPlayers(c) ? c.type : this.visualOf(c);
    return ensureSiteTexture(this.scene, type, c.variant || 0, this.sim.construction.stage(c));
  }

  createSite(c) {
    if (this.sites.has(c.id)) return;
    const scene = this.scene;
    const x = c.tx * TS;
    const bottom = (c.ty + c.h) * TS;
    const view = { c, piles: [], stage: -1 };
    if (c.kind === 'upgrade' || c.kind === 'repair') {
      // Scaffolding over the existing house.
      view.sprite = scene.add.image(x, bottom, this.siteTexture(c)).setOrigin(0, 1).setDepth(bottom + 2).setAlpha(0.55);
    } else if (c.w === 1 && c.h === 1) {
      view.sprite = scene.add.image(x + TS / 2, bottom, 'pile_stone').setOrigin(0.5, 1).setDepth(bottom);
    } else {
      view.sprite = scene.add.image(x, bottom, this.siteTexture(c)).setOrigin(0, 1).setDepth(bottom);
    }
    if (c.kind === 'building') {
      view.zone = scene.add.zone(x + (c.w * TS) / 2, c.ty * TS + 10 + (c.h * TS - 10) / 2, c.w * TS, c.h * TS - 10);
      scene.physics.add.existing(view.zone, true);
      scene.solids.add(view.zone);
    }
    this.sites.set(c.id, view);
    this.updateSite(c);
  }

  updateSite(c) {
    if (c.status !== 'site') return;
    let view = this.sites.get(c.id);
    if (!view) {
      this.createSite(c);
      return;
    }
    const stage = this.sim.construction.stage(c);
    if (stage !== view.stage && !(c.w === 1 && c.h === 1)) {
      view.stage = stage;
      view.sprite.setTexture(this.siteTexture(c));
    }
    // Material piles in front of the site, one per delivered material type.
    for (const p of view.piles) p.destroy();
    view.piles = [];
    const bottom = (c.ty + c.h) * TS;
    let i = 0;
    for (const [id, qty] of Object.entries(c.delivered)) {
      const remaining = qty - (this.sim.construction.stage(c) >= 3 ? qty : 0);
      if (!PILE_TEX[id] || remaining <= 0) continue;
      const px = c.tx * TS + 14 + i * 30;
      view.piles.push(this.scene.add.image(px, bottom + 14, PILE_TEX[id]).setOrigin(0.5, 1).setDepth(bottom + 14));
      i++;
    }
  }

  removeSite(id) {
    const view = this.sites.get(id);
    if (!view) return;
    view.sprite.destroy();
    for (const p of view.piles) p.destroy();
    if (view.zone) this.scene.solids.remove(view.zone, true, true);
    this.sites.delete(id);
  }

  puff(c) {
    const x = c.tx * TS + (c.w * TS) / 2;
    const y = (c.ty + c.h) * TS - 20;
    this.dust.explode(14, x, y);
  }

  road(tx, ty) {
    this.scene.terrain.layer.putTileAt(T.ROAD, tx, ty);
    this.dust.explode(6, tx * TS + TS / 2, ty * TS + TS / 2);
  }

  /** Progress bars over sites near the player. */
  update() {
    const g = this.bars;
    g.clear();
    const p = this.sim.state.player;
    for (const view of this.sites.values()) {
      const c = view.c;
      if (c.status !== 'site') continue;
      const cx = c.tx * TS + (c.w * TS) / 2;
      const top = (c.ty + c.h) * TS - (c.h * TS + 40);
      if (Math.hypot(cx - p.x, top + c.h * TS - p.y) > 360) continue;
      const w = Math.max(60, c.w * TS * 0.8);
      const work = c.labor / c.laborNeeded;
      const mat = this.sim.construction.materialsFraction(c);
      g.fillStyle(0x1b140e, 0.85).fillRoundedRect(cx - w / 2 - 3, top - 3, w + 6, 16, 4);
      g.fillStyle(0x6fa0d8, 1).fillRect(cx - w / 2, top, w * mat, 4);
      g.fillStyle(0xffc34d, 1).fillRect(cx - w / 2, top + 6, w * work, 5);
    }
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}
