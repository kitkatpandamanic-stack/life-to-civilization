/**
 * Map — an overview of the land drawn from the tile data, with live markers
 * for you, villagers, buildings and your current objective.
 */
import { Panel } from '../Panel.js';
import { t } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel } from '../format.js';
import { T } from '../../world/WorldGenerator.js';
import { BALANCE } from '../../config/balance.js';

const SCALE = 5; // map pixels per tile
const TILE_COLORS = {
  [T.GRASS]: '#79b35a', [T.GRASS2]: '#72ab53', [T.GRASS3]: '#80ba60', [T.FLOWERS]: '#86bf66', [T.FOREST]: '#3f7a35',
  [T.DIRT]: '#b08d5f', [T.ROAD]: '#c8a878', [T.SAND]: '#e0cc92', [T.WATER]: '#4a8fd0', [T.DEEP]: '#3274b5',
  [T.MOUNTAIN]: '#9a9486', [T.CLIFF]: '#5f5a52', [T.FARMLAND]: '#8a6040', [T.BRIDGE]: '#a0703f', [T.PLAZA]: '#b8b2a6',
};
const LABELLED = ['hall', 'store', 'tavern', 'smithy', 'farmhouse', 'lumberyard', 'quarry_hut', 'shack'];
let baseCache = null;

export class MapPanel extends Panel {
  get id() {
    return 'map';
  }
  title() {
    return `🗺️ ${escapeHtml(t('ui.map'))}`;
  }

  baseMap() {
    const sim = this.sim;
    if (baseCache && baseCache.seed === sim.state.seed) return baseCache.canvas;
    const w = sim.world;
    const c = document.createElement('canvas');
    c.width = w.W * SCALE;
    c.height = w.H * SCALE;
    const ctx = c.getContext('2d');
    for (let y = 0; y < w.H; y++) {
      for (let x = 0; x < w.W; x++) {
        ctx.fillStyle = TILE_COLORS[w.tileAt(x, y)] || '#000';
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    for (const b of w.buildingList) {
      ctx.fillStyle = b.id === 'shack' ? '#e0a040' : '#8a4a3a';
      ctx.fillRect(b.tx * SCALE, b.ty * SCALE, b.w * SCALE, b.h * SCALE);
      ctx.strokeStyle = '#2a1a10';
      ctx.strokeRect(b.tx * SCALE + 0.5, b.ty * SCALE + 0.5, b.w * SCALE - 1, b.h * SCALE - 1);
    }
    baseCache = { seed: sim.state.seed, canvas: c };
    return c;
  }

  render() {
    return `<div class="map-wrap"><canvas class="map-canvas"></canvas></div>
      <div class="map-legend">
        <span><i class="lg you"></i>${escapeHtml(t('ui.map_you'))}</span>
        <span><i class="lg npc"></i>${escapeHtml(t('ui.map_villager'))}</span>
        <span><i class="lg goal"></i>${escapeHtml(t('ui.map_objective'))}</span>
        <span><i class="lg home"></i>${escapeHtml(t('ui.map_home'))}</span>
      </div>`;
  }

  afterRender(body) {
    this.canvas = body.querySelector('.map-canvas');
    this.draw();
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 400;
      this.draw();
    }
  }

  draw() {
    const c = this.canvas;
    if (!c || !c.isConnected) return;
    const sim = this.sim;
    const base = this.baseMap();
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const TS = BALANCE.tileSize;
    const k = SCALE / TS;

    // Harvested trees show up as gaps in the forest.
    ctx.fillStyle = 'rgba(30,70,30,0.9)';
    for (const o of Object.values(sim.state.objects)) {
      if (o.kind === 'tree' && o.state === 'grown') ctx.fillRect(o.tx * SCALE + 1, o.ty * SCALE + 1, SCALE - 2, SCALE - 2);
    }
    ctx.font = 'bold 11px Nunito, sans-serif';
    ctx.textAlign = 'center';
    for (const id of LABELLED) {
      const b = sim.world.buildings[id];
      const x = (b.tx + b.w / 2) * SCALE;
      const y = b.ty * SCALE - 3;
      const label = buildingLabel(sim, id);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,14,8,0.85)';
      ctx.strokeText(label, x, y);
      ctx.fillStyle = id === 'shack' ? '#ffd27a' : '#fff4dc';
      ctx.fillText(label, x, y);
    }
    for (const n of sim.state.npcs) {
      if (n.inside) continue;
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(n.x * k, n.y * k, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const obj = sim.jobs.objective();
    if (obj?.target) {
      ctx.fillStyle = '#ffb938';
      ctx.strokeStyle = '#5a2a00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(obj.target.x * k, obj.target.y * k, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const p = sim.state.player;
    const pulse = 4 + Math.sin(performance.now() / 200) * 1.5;
    ctx.fillStyle = '#ff4d4d';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x * k, p.y * k, pulse + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
