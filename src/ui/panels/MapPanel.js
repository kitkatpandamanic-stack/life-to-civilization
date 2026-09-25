/**
 * Map — an overview of the land drawn from the tile data, with live markers
 * for you, villagers, buildings and your current objective.
 */
import { FOG } from '../../data/regions.js';
import { Panel } from '../Panel.js';
import { t } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, districtLabel, hamletName, villageName } from '../format.js';
import { button } from '../widgets.js';
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
const DISTRICT_COLORS = { residential: '#f0c060', commercial: '#e0603a', industrial: '#8a8aa0', agricultural: '#9ad050', civic: '#60a0f0', education: '#70d0c0', entertainment: '#f080a0', transport: '#b09060', mixed: '#c080d0' };

export class MapPanel extends Panel {
  get id() {
    return 'map';
  }
  title() {
    return `🗺️ ${escapeHtml(t('ui.map'))}`;
  }

  baseMap() {
    const sim = this.sim;
    // The village changes (new houses, new roads) — redraw when it does.
    const key = `${sim.state.seed}:${sim.world.buildingList.length}:${sim.state.land.roads.length}`;
    if (baseCache && baseCache.key === key) return baseCache.canvas;
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
    baseCache = { key, canvas: c };
    return c;
  }

  render() {
    return `<div class="map-wrap"><canvas class="map-canvas"></canvas></div>
      <div class="map-legend">
        <span><i class="lg you"></i>${escapeHtml(t('ui.map_you'))}</span>
        <span><i class="lg npc"></i>${escapeHtml(t('ui.map_villager'))}</span>
        <span><i class="lg goal"></i>${escapeHtml(t('ui.map_objective'))}</span>
        <span><i class="lg home"></i>${escapeHtml(t('ui.map_home'))}</span>
        ${button(t(this.showDistricts ? 'ui.hide_districts' : 'ui.show_districts'), 'districts')}
      </div>
      ${this.showDistricts ? `<div class="map-legend">${Object.entries(DISTRICT_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`district.kind.${k}`))}</span>`).join('')}</div>` : ''}
      ${this.settlementsHtml()}`;
  }

  /** The valley's village and hamlets, and the places beyond it you know of. */
  settlementsHtml() {
    const sim = this.sim;
    const S = sim.settlements;
    const row = (name, info, extra = '') => `<div class="kv"><span>${escapeHtml(name)}</span><b>${escapeHtml(info)}${extra}</b></div>`;
    const rows = [row(villageName(sim), t('map.village_line', { n: sim.state.npcs.length + 1, b: sim.economy.active().length }))];
    for (const h of sim.state.exploration.hamlets || []) {
      const homes = sim.world.buildingList.filter((b) => sim.property.isHome(b.id) && Math.hypot(b.tx - h.tx, b.ty - h.ty) <= 16);
      const people = homes.reduce((s, b) => s + sim.npcs.residentsOf(b.id).length, 0);
      rows.push(row(hamletName(h.nameIdx), t('map.hamlet_line', { n: people })));
    }
    for (const id of S.known()) {
      const s = S.get(id);
      const info = t('map.settlement_line', { size: t(`settlement_size.${s.size}`), n: s.pop, days: S.days(id) });
      rows.push(row(t(`settlement_name.${id}`), info, s.contact ? ' 🤝' : ''));
      // What the place is known for — its know-how, and its university (Phase: knowledge between settlements).
      const known = sim.knowhow?.knownFor(id) || [];
      const U = sim.academia?.uniDef(id);
      const uni = U ? Object.keys(U.fields).sort((a, b) => U.fields[b] - U.fields[a])[0] : null;
      const es = sim.eduworld?.settlementStats(id);
      if (es) known.unshift(null);
      if (known.length || uni) rows.push(`<div class="muted small map-known">${escapeHtml([es ? t('map.literacy', { n: Math.round(es.literacy * 100) }) : '', known.filter(Boolean).length ? t('map.known_for', { list: known.filter(Boolean).map((x) => t(`tech.${x}.name`)).join(', ') }) : '', uni ? t('map.university', { field: t(`knowledge.${uni}`) }) : ''].filter(Boolean).join(' · '))}</div>`);
    }
    return `<h3>${escapeHtml(t('map.settlements'))}</h3><div class="map-settlements">${rows.join('')}</div><div class="muted small">${escapeHtml(t('map.settlements_hint'))}</div>`;
  }

  onAction(action) {
    if (action === 'districts') this.showDistricts = !this.showDistricts;
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

    // Districts: what each part of the village has become.
    if (this.showDistricts) {
      for (const d of sim.state.districts.list) {
        ctx.fillStyle = DISTRICT_COLORS[d.type] || '#fff';
        ctx.globalAlpha = 0.32;
        for (const cell of d.cells) {
          const [cx, cy] = cell.split(',').map(Number);
          ctx.fillRect(cx * 10 * SCALE, cy * 10 * SCALE, 10 * SCALE, 10 * SCALE);
        }
        ctx.globalAlpha = 1;
      }
    }
    // Harvested trees show up as gaps in the forest.
    ctx.fillStyle = 'rgba(30,70,30,0.9)';
    for (const o of Object.values(sim.state.objects)) {
      if (o.kind === 'tree' && o.state === 'grown') ctx.fillRect(o.tx * SCALE + 1, o.ty * SCALE + 1, SCALE - 2, SCALE - 2);
    }
    // Fog of war: the parts of the valley you haven't walked yet.
    const X = sim.exploration;
    const C = FOG.chunk;
    ctx.fillStyle = 'rgba(14,16,24,0.82)';
    for (let cy = 0; cy * C < sim.world.H; cy++) {
      for (let cx = 0; cx * C < sim.world.W; cx++) {
        if (!X.isSeen(cx * C, cy * C)) ctx.fillRect(cx * C * SCALE, cy * C * SCALE, C * SCALE, C * SCALE);
      }
    }
    ctx.font = 'bold 11px Nunito, sans-serif';
    ctx.textAlign = 'center';
    // What you've found out in the valley: ? discovered · ✓ explored · ★ outpost.
    for (const s of sim.state.exploration.sites) {
      if (s.state === 'unknown') continue;
      const mark = { discovered: '?', explored: '✓', developed: '★' }[s.state];
      const x = (s.tx + 1) * SCALE;
      const y = (s.ty + 0.5) * SCALE;
      ctx.fillStyle = s.state === 'developed' ? '#ffd27a' : s.state === 'explored' ? '#9ad07a' : '#e0e0e0';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1410';
      ctx.fillText(mark, x, y + 4);
    }
    for (const h of sim.state.exploration.hamlets || []) {
      const label = hamletName(h.nameIdx);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,14,8,0.85)';
      ctx.strokeText(label, h.tx * SCALE, (h.ty - 2) * SCALE);
      ctx.fillStyle = '#ffe7a8';
      ctx.fillText(label, h.tx * SCALE, (h.ty - 2) * SCALE);
    }
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
    if (this.showDistricts) {
      ctx.font = 'bold 12px Nunito, sans-serif';
      const placed = [];
      for (const d of sim.state.districts.list) {
        const label = districtLabel(d);
        // Skip a label that would sit on top of another one.
        const w = ctx.measureText(label).width;
        const box = { x: d.tx * SCALE - w / 2, y: d.ty * SCALE + 2, w, h: 14 };
        if (placed.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,14,8,0.9)';
        ctx.strokeText(label, d.tx * SCALE, d.ty * SCALE + 14);
        ctx.fillStyle = DISTRICT_COLORS[d.type];
        ctx.fillText(label, d.tx * SCALE, d.ty * SCALE + 14);
      }
      ctx.font = 'bold 11px Nunito, sans-serif';
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
