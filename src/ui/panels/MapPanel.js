/**
 * Map — an overview of the land drawn from the tile data, with live markers
 * for you, villagers, buildings and your current objective.
 */
import { FOG } from '../../data/regions.js';
import { Panel } from '../Panel.js';
import { t } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, districtLabel, hamletName, villageName } from '../format.js';
import { button, filters } from '../widgets.js';
import { PLOTS } from '../../data/land.js';

/** Map layers — one at a time, only when you ask for it. */
const LAYERS = ['normal', 'ownership', 'value', 'land_use', 'infrastructure', 'population'];
const OWNER_COLORS = { player: '#ffcf5a', village: '#60a0f0', npc: '#9ad07a', nobody: '#e06a5a' };
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

  get layer() {
    return this._layer || 'normal';
  }
  get showDistricts() {
    return this.layer === 'land_use';
  }

  render() {
    const L = this.layer;
    let legend = '';
    if (L === 'land_use') legend = Object.entries(DISTRICT_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`district.kind.${k}`))}</span>`).join('');
    else if (L === 'ownership') legend = Object.entries(OWNER_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c};border-radius:2px"></i>${escapeHtml(t(`map.owner_${k}`))}</span>`).join('') + `<span><i class="lg" style="border:1px dashed #fff;border-radius:2px"></i>${escapeHtml(t('map.for_sale'))}</span>`;
    else if (L === 'value') legend = `<span><i class="lg" style="background:#4a90d0;border-radius:2px"></i>${escapeHtml(t('map.value_low'))}</span><span><i class="lg" style="background:#f0c040;border-radius:2px"></i>${escapeHtml(t('map.value_high'))}</span>`;
    else if (L === 'infrastructure') legend = `<span><i class="lg" style="background:#e8d4a8;border-radius:2px"></i>${escapeHtml(t('map.roads'))}</span><span><i class="lg" style="background:#60c0ff"></i>${escapeHtml(t('map.wells'))}</span><span><i class="lg" style="background:#ffd070"></i>${escapeHtml(t('map.lamps'))}</span>`;
    else if (L === 'population') legend = `<span><i class="lg" style="background:#ff9a6a"></i>${escapeHtml(t('map.people_hint'))}</span>`;
    return `${filters(LAYERS.map((l) => [l, t(`map.layer_${l}`)]), L, 'layer')}
      <div class="map-wrap"><canvas class="map-canvas clickable" title="${escapeHtml(t('map.click_hint'))}"></canvas></div>
      <div class="map-legend">
        <span><i class="lg you"></i>${escapeHtml(t('ui.map_you'))}</span>
        <span><i class="lg npc"></i>${escapeHtml(t('ui.map_villager'))}</span>
        <span><i class="lg goal"></i>${escapeHtml(t('ui.map_objective'))}</span>
        <span><i class="lg home"></i>${escapeHtml(t('ui.map_home'))}</span>
      </div>
      ${legend ? `<div class="map-legend">${legend}</div>` : ''}
      <div class="hint">${escapeHtml(t(L === 'ownership' ? 'map.click_hint_land' : 'map.click_hint'))}</div>
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

  onAction(action, data) {
    if (action === 'layer') this._layer = data.f;
  }

  afterRender(body) {
    this.canvas = body.querySelector('.map-canvas');
    // Click a building on the map to see it.
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const tx = ((e.clientX - r.left) / r.width) * this.sim.world.W;
      const ty = ((e.clientY - r.top) / r.height) * this.sim.world.H;
      const b = this.sim.world.buildingList.find((o) => tx >= o.tx && tx < o.tx + o.w && ty >= o.ty - 0.5 && ty < o.ty + o.h + 0.5);
      if (b && this.sim.property.rec(b.id)) this.ui.openProperty(b.id);
      // …or a piece of land, on the ownership map.
      else if (this.layer === 'ownership') {
        const id = this.sim.territory?.idAt(Math.floor(tx), Math.floor(ty));
        if (id) this.ui.openLand(id);
      }
    });
    this.draw();
  }

  /** The chosen layer, drawn over the buildings (and land). */
  drawLayer(ctx) {
    const sim = this.sim;
    const P = sim.property;
    const L = this.layer;
    const rect = (b, color, alpha = 0.85) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(b.tx * SCALE, b.ty * SCALE, b.w * SCALE, b.h * SCALE);
      ctx.globalAlpha = 1;
    };
    if (L === 'ownership') {
      // Every piece of land, tinted by who owns it (nobody's land left bare), with the lines between them.
      const T2 = sim.territory;
      if (T2) {
        const tint = { player: [OWNER_COLORS.player, 0.5], village: [OWNER_COLORS.village, 0.22], npc: [OWNER_COLORS.npc, 0.32] };
        const W = sim.world.W;
        for (let y = 0; y < sim.world.H; y++) {
          for (let x = 0; x < W; x++) {
            const id = T2.idAt(x, y);
            if (!id) continue;
            const o = T2.owner(id);
            const k = o === 'player' || o === 'village' ? o : o ? 'npc' : null;
            if (k) {
              ctx.globalAlpha = tint[k][1];
              ctx.fillStyle = tint[k][0];
              ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
            }
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#1a120a';
            if (T2.idAt(x + 1, y) !== id) ctx.fillRect((x + 1) * SCALE - 1, y * SCALE, 1, SCALE);
            if (T2.idAt(x, y + 1) !== id) ctx.fillRect(x * SCALE, (y + 1) * SCALE - 1, SCALE, 1);
          }
        }
        ctx.globalAlpha = 1;
      }
      for (const pl of PLOTS) {
        const mine = sim.land.isOwned(pl.id);
        ctx.strokeStyle = mine ? OWNER_COLORS.player : '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash(mine ? [] : [4, 3]);
        ctx.strokeRect(pl.x1 * SCALE + 1, pl.y1 * SCALE + 1, (pl.x2 - pl.x1 + 1) * SCALE - 2, (pl.y2 - pl.y1 + 1) * SCALE - 2);
      }
      ctx.setLineDash([]);
      for (const b of sim.world.buildingList) {
        const o = P.rec(b.id)?.owner;
        rect(b, OWNER_COLORS[o === 'player' ? 'player' : o === 'village' ? 'village' : o ? 'npc' : 'nobody']);
      }
    } else if (L === 'value') {
      const vals = sim.world.buildingList.map((b) => P.value(b.id) || 0).filter((v) => v > 0);
      const max = Math.max(1, ...vals);
      for (const b of sim.world.buildingList) {
        const v = P.value(b.id) || 0;
        if (!v) continue;
        const f = Math.min(1, v / max);
        const c = (a, z) => Math.round(a + (z - a) * f);
        rect(b, `rgb(${c(74, 240)},${c(144, 192)},${c(208, 64)})`);
      }
    } else if (L === 'infrastructure') {
      ctx.fillStyle = 'rgba(10,8,5,0.55)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      ctx.fillStyle = '#e8d4a8';
      for (let y = 0; y < sim.world.H; y++) for (let x = 0; x < sim.world.W; x++) if (sim.world.isRoad(x, y)) ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      const dot = (x, y, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      };
      for (const d of sim.world.decor) if (d.type === 'well') dot((d.tx + 0.5) * SCALE, (d.ty + 0.5) * SCALE, '#60c0ff');
      for (const b of sim.world.buildingList) if (b.type === 'well') dot((b.tx + 0.5) * SCALE, (b.ty + 0.5) * SCALE, '#60c0ff');
      for (const d of sim.world.decor) if (d.light) dot((d.tx + 0.5) * SCALE, (d.ty + 0.5) * SCALE, '#ffd070');
    } else if (L === 'population') {
      for (const b of sim.world.buildingList) {
        const n = sim.npcs.residentsOf(b.id).length;
        if (!n) continue;
        ctx.fillStyle = 'rgba(255,154,106,0.85)';
        ctx.beginPath();
        ctx.arc((b.tx + b.w / 2) * SCALE, (b.ty + b.h / 2) * SCALE, 3 + n * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1410';
        ctx.fillText(String(n), (b.tx + b.w / 2) * SCALE, (b.ty + b.h / 2) * SCALE + 4);
      }
    }
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
    if (this.layer !== 'normal' && this.layer !== 'land_use') {
      ctx.font = 'bold 10px Nunito, sans-serif';
      ctx.textAlign = 'center';
      this.drawLayer(ctx);
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
