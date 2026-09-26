/**
 * Map — an overview of the land drawn from the tile data, with live markers
 * for you, villagers, buildings and your current objective.
 */
import { FOG } from '../../data/regions.js';
import { Panel } from '../Panel.js';
import { t, npcName } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, districtLabel, hoodLabel, hamletName, villageName } from '../format.js';
import { button, filters } from '../widgets.js';
import { stateBadge, taskText, jobText } from '../transport.js';
import { statusGroup, placeText } from '../workerCard.js';
import { buildingActivity, buildingIcon } from '../buildingCard.js';
import { contractPlace } from '../contracts.js';
import { PUBLIC_TYPES } from '../../data/housing.js';
import { PLOTS } from '../../data/land.js';

/** Map layers — one at a time, only when you ask for it. */
const LAYERS = ['normal', 'buildings', 'workers', 'jobs', 'resources', 'transport', 'infrastructure', 'ownership', 'land_use', 'value', 'places', 'population'];
/** Buildings by what they are (the Buildings layer). */
const BCAT_COLORS = { home: '#f0c060', farm: '#9ad050', shop: '#e0603a', industry: '#a0a0b8', storage: '#c890ff', public: '#60a0f0', site: '#60d0a0' };
/** Your workers by what they're doing (the Workers layer) — the same groups as the Workers screen. */
const GROUP_COLORS = { working: '#8fd08f', traveling: '#8fc3e8', waiting: '#ffb04a', resting: '#b0a080', idle: '#d8d0c0', stuck: '#ff7b68' };
/** What grows and lies about (the Resources layer). */
const RES_COLORS = { tree: '#2f9a3a', rock: '#b8b2a6', clay: '#c0703a', bush: '#e05a70', crop: '#e8d060' };
const OWNER_COLORS = { player: '#ffcf5a', village: '#60a0f0', npc: '#9ad07a', nobody: '#e06a5a' };
import { T } from '../../world/WorldGenerator.js';
import { BUILDABLES } from '../../data/buildables.js';
import { BALANCE } from '../../config/balance.js';

const SCALE = 5; // map pixels per tile
const TILE_COLORS = {
  [T.GRASS]: '#79b35a', [T.GRASS2]: '#72ab53', [T.GRASS3]: '#80ba60', [T.FLOWERS]: '#86bf66', [T.FOREST]: '#3f7a35',
  [T.DIRT]: '#b08d5f', [T.ROAD]: '#c8a878', [T.SAND]: '#e0cc92', [T.WATER]: '#4a8fd0', [T.DEEP]: '#3274b5',
  [T.MOUNTAIN]: '#9a9486', [T.CLIFF]: '#5f5a52', [T.FARMLAND]: '#8a6040', [T.BRIDGE]: '#a0703f', [T.PLAZA]: '#b8b2a6',
};
const LABELLED = ['hall', 'store', 'tavern', 'smithy', 'farmhouse', 'lumberyard', 'quarry_hut', 'shack'];
let baseCache = null;
/** What each piece of land has become (TerritorySystem) — undeveloped land is left bare. */
const TERRITORY_COLORS = { residential: '#f0c060', commercial: '#e0603a', industrial: '#8a8aa0', agricultural: '#9ad050', forest: '#2f8a3a', mining: '#b8a890', education: '#70d0c0', research: '#a0e0ff', government: '#60a0f0', recreation: '#f080a0', mixed: '#c080d0', developing: '#f4f0a0' };
const DISTRICT_COLORS = { residential: '#f0c060', commercial: '#e0603a', industrial: '#8a8aa0', agricultural: '#9ad050', civic: '#60a0f0', education: '#70d0c0', entertainment: '#f080a0', transport: '#b09060', mixed: '#c080d0' };

export class MapPanel extends Panel {
  get id() {
    return 'map';
  }

  /** What kind of building this is, for the Buildings layer. */
  category(b) {
    const sim = this.sim;
    if (sim.construction.sites().some((s) => s.id === b.id && s.status === 'site')) return 'site';
    const biz = sim.economy.businessAtBuilding(b.id);
    const def = biz && sim.economy.def(biz);
    if (def) return def.sector === 'farming' ? 'farm' : def.kind === 'shop' || def.kind === 'service' ? 'shop' : def.kind === 'depot' ? 'storage' : 'industry';
    const type = sim.property.type?.(b.id) || b.type;
    if (BUILDABLES[b.type]?.effect?.storage || ['warehouse_bld', 'storage_shed', 'barn', 'transport_depot'].includes(b.type)) return 'storage';
    if (PUBLIC_TYPES.includes(type) || ['hall', 'school', 'clinic', 'library', 'institute', 'market_hall', 'watch_house', 'rail_station'].includes(type)) return 'public';
    if (sim.property.isHome(b.id)) return 'home';
    return 'industry';
  }

  /** The thing picked on the map: a line about it and what you can do. */
  selectionHtml() {
    const sim = this.sim;
    const s = this.sel;
    if (!s) return '';
    const b2 = (label, action, data, cls = 'sm', ico = '') => button(label, action, data, { cls, ico });
    if (s.kind === 'worker') {
      const npc = sim.npcs.byId(s.id);
      const c = sim.workers.contract(s.id);
      if (!npc || !c) return '';
      return `<div class="map-sel"><div class="map-sel-head"><b>👷 ${escapeHtml(npcName(npc))}</b>${stateBadge(c.state || 'idle')}</div>
        <div class="small">${escapeHtml(taskText(sim, npc))} · 📍 ${escapeHtml(placeText(sim, npc))}</div>
        <div class="btn-row">${b2(t('wcard2.follow'), 'sel_follow', { npc: s.id }, 'sm primary', '👁')}${b2(t('bcard.locate'), 'sel_show', { x: npc.x, y: npc.y - 20 }, 'sm', '🎯')}${b2(t('wcard2.manage'), 'sel_manage', { npc: s.id }, 'sm', '👷')}</div></div>`;
    }
    if (s.kind === 'building') {
      const b = sim.world.buildings[s.id];
      if (!b) return '';
      const [kind, ico, words] = buildingActivity(sim, s.id);
      return `<div class="map-sel"><div class="map-sel-head"><b>${buildingIcon(sim, s.id)} ${escapeHtml(buildingLabel(sim, s.id))}</b><span class="status s-${kind}">${ico} ${escapeHtml(words)}</span></div>
        <div class="btn-row">${b2(t('bcard.locate'), 'sel_show', { x: (b.tx + b.w / 2) * 32, y: b.ty * 32 }, 'sm primary', '🎯')}${sim.property.rec(s.id) ? b2(t('bcard.inspect'), 'sel_inspect', { id: s.id }, 'sm', '🔍') : ''}</div></div>`;
    }
    if (s.kind === 'job') {
      const c = sim.state.contracts.active.find((x) => x.id === s.id);
      if (!c) return '';
      const p = contractPlace(sim, c);
      return `<div class="map-sel"><div class="map-sel-head"><b>📜 ${escapeHtml(t(`contract.kind.${c.kind}`))} #${c.id}</b><span class="small">${Math.round(sim.contracts.progress(c) * 100)}% · 👷 ${(c.workers || []).length}</span></div>
        <div class="small">${p ? `📍 ${escapeHtml(p.label)}` : ''}</div>
        <div class="btn-row">${p ? b2(t('contract.view_place'), 'sel_show', { x: p.x, y: p.y }, 'sm primary', '🎯') : ''}${(c.workers || []).length ? b2(t('contract.follow_worker'), 'sel_follow', { npc: c.workers[0] }, 'sm', '👁') : ''}${b2(t('contract.manage_workers'), 'sel_contract', {}, 'sm', '📋')}</div></div>`;
    }
    return '';
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
    if (L === 'land_use' && this.sim.territory) {
      const present = new Set(this.sim.territory.all().map((q) => this.sim.territory.profile(q.id)?.type));
      legend = Object.entries(TERRITORY_COLORS).filter(([k]) => present.has(k)).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`territory_type.${k}`))}</span>`).join('');
    } else if (L === 'land_use') legend = Object.entries(DISTRICT_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`district.kind.${k}`))}</span>`).join('');
    else if (L === 'ownership') legend = Object.entries(OWNER_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c};border-radius:2px"></i>${escapeHtml(t(`map.owner_${k}`))}</span>`).join('') + `<span><i class="lg" style="border:1px dashed #fff;border-radius:2px"></i>${escapeHtml(t('map.for_sale'))}</span>`;
    else if (L === 'value') legend = `<span><i class="lg" style="background:#4a90d0;border-radius:2px"></i>${escapeHtml(t('map.value_low'))}</span><span><i class="lg" style="background:#f0c040;border-radius:2px"></i>${escapeHtml(t('map.value_high'))}</span>`;
    else if (L === 'infrastructure') legend = `<span><i class="lg" style="background:#e8d4a8;border-radius:2px"></i>${escapeHtml(t('map.roads'))}</span><span><i class="lg" style="background:#b8b2a6;border-radius:2px"></i>${escapeHtml(t('map.paved'))}</span><span><i class="lg" style="background:#c08050;border-radius:2px"></i>${escapeHtml(t('map.bridges'))}</span><span><i class="lg" style="background:#e07050;border-radius:2px"></i>${escapeHtml(t('map.unlinked'))}</span><span><i class="lg" style="background:#60c0ff"></i>${escapeHtml(t('map.wells'))}</span><span><i class="lg" style="background:#ffd070"></i>${escapeHtml(t('map.lamps'))}</span>`;
    else if (L === 'places') legend = Object.entries(DISTRICT_COLORS).filter(([k]) => this.sim.state.districts.list.some((d) => d.type === k)).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`district.kind.${k}`))}</span>`).join('') + `<span><i class="lg" style="border:2px dashed #ffe7a8;border-radius:2px"></i>${escapeHtml(t('map.hoods'))}</span>`;
    else if (L === 'transport') legend = [['#e8d4a8', 'map.roads'], ['#ffcf5a', 'map.t_stores'], ['#c890ff', 'map.t_depots'], ['#60d0a0', 'map.t_sites'], ['#e07050', 'map.t_waiting'], ['#ffffff', 'map.t_equipment'], ['#ff9a6a', 'map.t_carrying']].map(([c, k]) => `<span><i class="lg" style="background:${c};border-radius:2px"></i>${escapeHtml(t(k))}</span>`).join('');
    else if (L === 'population') legend = `<span><i class="lg" style="background:#ff9a6a"></i>${escapeHtml(t('map.people_hint'))}</span>`;
    else if (L === 'buildings') legend = Object.entries(BCAT_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c};border-radius:2px"></i>${escapeHtml(t(`map.bcat_${k}`))}</span>`).join('') + `<span><i class="lg" style="border:2px solid #ffcf5a;border-radius:2px"></i>${escapeHtml(t('map.yours'))}</span>`;
    else if (L === 'workers') legend = Object.entries(GROUP_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c}"></i>${escapeHtml(t(`wf.group_${k}`))}</span>`).join('');
    else if (L === 'jobs') legend = `<span><i class="lg" style="background:#ffcf5a"></i>${escapeHtml(t('map.jobs_contracts'))}</span><span><i class="lg" style="background:#60d0a0;border-radius:2px"></i>${escapeHtml(t('map.jobs_sites'))}</span>`;
    else if (L === 'resources') legend = Object.entries(RES_COLORS).map(([k, c]) => `<span><i class="lg" style="background:${c};border-radius:2px"></i>${escapeHtml(t(`map.res_${k}`))}</span>`).join('');
    return `${filters(LAYERS.map((l) => [l, t(`map.layer_${l}`)]), L, 'layer')}
      <div class="map-wrap"><canvas class="map-canvas clickable" title="${escapeHtml(t('map.click_hint'))}"></canvas></div>
      <div class="map-legend">
        <span><i class="lg you"></i>${escapeHtml(t('ui.map_you'))}</span>
        <span><i class="lg npc"></i>${escapeHtml(t('ui.map_villager'))}</span>
        <span><i class="lg goal"></i>${escapeHtml(t('ui.map_objective'))}</span>
        <span><i class="lg home"></i>${escapeHtml(t('ui.map_home'))}</span>
      </div>
      ${legend ? `<div class="map-legend">${legend}</div>` : ''}
      ${this.selectionHtml()}
      <div class="hint">${escapeHtml(t(L === 'places' ? 'map.click_hint_places' : ['ownership', 'land_use', 'value'].includes(L) ? 'map.click_hint_land' : ['workers', 'jobs', 'buildings'].includes(L) ? 'map.click_hint_pick' : 'map.click_hint'))}</div>
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
    if (action === 'layer') {
      this._layer = data.f;
      this.sel = null;
    }
    // The picked thing: go and see it (the map closes, the camera goes there).
    if (action === 'sel_follow') this.sim.bus.emit('ui:follow', { npc: data.npc });
    if (action === 'sel_show') this.sim.bus.emit('ui:look', { x: Number(data.x), y: Number(data.y) });
    if (action === 'sel_manage') this.ui.openWorkers({ focus: data.npc });
    if (action === 'sel_inspect') this.ui.openProperty(data.id);
    if (action === 'sel_contract') this.ui.openJournal('tasks');
  }

  afterRender(body) {
    this.canvas = body.querySelector('.map-canvas');
    // Click a building on the map to see it.
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const tx = ((e.clientX - r.left) / r.width) * this.sim.world.W;
      const ty = ((e.clientY - r.top) / r.height) * this.sim.world.H;
      // A marker (a worker, a job) under the pointer: pick it.
      const mx = tx * SCALE;
      const my = ty * SCALE;
      const hit = (this.markers || []).filter((m) => Math.hypot(m.x - mx, m.y - my) <= m.r + 4).sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))[0];
      if (hit) {
        this.sel = { kind: hit.kind, id: hit.id };
        this.ui.renderPanel();
        return;
      }
      if (this.layer === 'buildings') {
        const bb = this.sim.world.buildingList.find((o) => tx >= o.tx && tx < o.tx + o.w && ty >= o.ty - 0.5 && ty < o.ty + o.h + 0.5);
        this.sel = bb ? { kind: 'building', id: bb.id } : null;
        this.ui.renderPanel();
        return;
      }
      // On the places map: the neighbourhood (or district) there.
      if (this.layer === 'places' && this.sim.places) {
        const h = this.sim.places.hoodAt(Math.floor(tx), Math.floor(ty));
        const d = this.sim.places.districtAt(Math.floor(tx), Math.floor(ty));
        if (h || d) this.ui.openPlace(h ? { hood: h.id } : { district: d.id });
        return;
      }
      const b = this.sim.world.buildingList.find((o) => tx >= o.tx && tx < o.tx + o.w && ty >= o.ty - 0.5 && ty < o.ty + o.h + 0.5);
      if (b && this.sim.property.rec(b.id)) this.ui.openProperty(b.id);
      // …or a piece of land, on the ownership map.
      else if (this.layer === 'ownership' || this.layer === 'land_use' || this.layer === 'value') {
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
      // Land: dearer land glows warmer (TerritorySystem: its worth per tile, as the village has made it).
      const T2 = sim.territory;
      if (T2) {
        const per = new Map(T2.all().map((q) => [q.id, T2.price(q.id) / Math.max(1, q.n)]));
        const top = Math.max(...per.values(), 1);
        for (let y = 0; y < sim.world.H; y++) {
          for (let x = 0; x < sim.world.W; x++) {
            const id = T2.idAt(x, y);
            if (!id) continue;
            const f = Math.min(1, per.get(id) / top);
            const c = (a, z) => Math.round(a + (z - a) * f);
            ctx.globalAlpha = 0.18 + f * 0.3;
            ctx.fillStyle = `rgb(${c(74, 240)},${c(144, 192)},${c(208, 64)})`;
            ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
          }
        }
        ctx.globalAlpha = 1;
      }
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
      // Roads (cobbles grey, bridges brown) — and roads that don't link up to the plaza, in red.
      const steps = sim.infra?.field();
      for (let y = 0; y < sim.world.H; y++) {
        for (let x = 0; x < sim.world.W; x++) {
          if (!sim.world.isRoad(x, y)) continue;
          const tile = sim.world.tileAt(x, y);
          ctx.fillStyle = steps && steps[sim.world.idx(x, y)] < 0 ? '#e07050' : tile === T.PLAZA ? '#b8b2a6' : tile === T.BRIDGE ? '#c08050' : '#e8d4a8';
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
      const dot = (x, y, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      };
      for (const d of sim.world.decor) if (d.type === 'well') dot((d.tx + 0.5) * SCALE, (d.ty + 0.5) * SCALE, '#60c0ff');
      for (const b of sim.world.buildingList) if (b.type === 'well') dot((b.tx + 0.5) * SCALE, (b.ty + 0.5) * SCALE, '#60c0ff');
      for (const d of sim.world.decor) if (d.light) dot((d.tx + 0.5) * SCALE, (d.ty + 0.5) * SCALE, '#ffd070');
    } else if (L === 'places') {
      // Districts as tinted blocks; neighbourhoods as dashed outlines with their names.
      for (const d of sim.state.districts.list) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = DISTRICT_COLORS[d.type] || '#fff';
        for (const cell of d.cells) {
          const [cx, cy] = cell.split(',').map(Number);
          ctx.fillRect(cx * 10 * SCALE, cy * 10 * SCALE, 10 * SCALE, 10 * SCALE);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = 'bold 11px Nunito, sans-serif';
      const placed = [];
      for (const d of sim.state.districts.list) {
        const label = districtLabel(d);
        // (Skip a label that would sit on top of another one.)
        const lw = ctx.measureText(label).width;
        const box = { x: d.tx * SCALE - lw / 2, y: d.ty * SCALE + 6, w: lw, h: 14 };
        if (placed.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h)) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,14,8,0.85)';
        ctx.strokeText(label, d.tx * SCALE, d.ty * SCALE + 18);
        ctx.fillStyle = DISTRICT_COLORS[d.type] || '#fff';
        ctx.fillText(label, d.tx * SCALE, d.ty * SCALE + 18);
      }
      ctx.font = 'bold 12px Nunito, sans-serif';
      for (const h of sim.places?.hoods() || []) {
        ctx.strokeStyle = '#ffe7a8';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(h.x1 * SCALE, h.y1 * SCALE, (h.x2 - h.x1 + 1) * SCALE, (h.y2 - h.y1 + 1) * SCALE);
        ctx.setLineDash([]);
        const label = hoodLabel(sim, h);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,14,8,0.9)';
        ctx.strokeText(label, ((h.x1 + h.x2) / 2) * SCALE, h.y1 * SCALE - 3);
        ctx.fillStyle = '#ffe7a8';
        ctx.fillText(label, ((h.x1 + h.x2) / 2) * SCALE, h.y1 * SCALE - 3);
      }
      ctx.font = 'bold 10px Nunito, sans-serif';
    } else if (L === 'transport') {
      // How goods move: roads, your stores and depots, sites (waiting ones in red), equipment where it
      // stands, and your workers with a load.
      ctx.fillStyle = 'rgba(10,8,5,0.5)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      for (let y = 0; y < sim.world.H; y++) {
        for (let x = 0; x < sim.world.W; x++) {
          if (!sim.world.isRoad(x, y)) continue;
          ctx.fillStyle = '#e8d4a8';
          ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
      const C = sim.construction;
      for (const c of C.finished()) {
        const fx = BUILDABLES[c.type]?.effect || {};
        const b = sim.world.buildings[c.id];
        if (b && (fx.storage || fx.depot)) rect(b, fx.depot ? '#c890ff' : '#ffcf5a');
      }
      const home = sim.world.buildings[sim.state.player.homeId];
      if (home) rect(home, '#ffcf5a', 0.6);
      for (const c of C.sites()) {
        if (!C.isPlayers(c) && c.supplier !== 'player' && c.contractor !== 'player') continue;
        rect(c, C.siteState(c) === 'waiting_materials' ? '#e07050' : '#60d0a0');
      }
      for (const e of sim.equipment?.mine() || []) {
        const tl = sim.equipment.tile(e);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(tl.tx * SCALE - 1, tl.ty * SCALE - 1, SCALE + 2, SCALE + 2);
      }
      for (const w of sim.workers.list()) {
        const n = sim.npcs.byId(w.npcId);
        if (!n?.carry) continue;
        ctx.fillStyle = '#ff9a6a';
        ctx.beginPath();
        ctx.arc(n.x / 32 * SCALE, n.y / 32 * SCALE, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (L === 'buildings') {
      // Every building by what it is; yours outlined in gold.
      ctx.fillStyle = 'rgba(10,8,5,0.35)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      for (const b of sim.world.buildingList) {
        rect(b, BCAT_COLORS[this.category(b)] || '#fff', 0.9);
        if (P.rec(b.id)?.owner === 'player') {
          ctx.strokeStyle = '#ffcf5a';
          ctx.lineWidth = 2;
          ctx.strokeRect(b.tx * SCALE - 1, b.ty * SCALE - 1, b.w * SCALE + 2, b.h * SCALE + 2);
        }
        if (this.sel?.kind === 'building' && this.sel.id === b.id) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.strokeRect(b.tx * SCALE - 3, b.ty * SCALE - 3, b.w * SCALE + 6, b.h * SCALE + 6);
        }
      }
    } else if (L === 'workers') {
      // Your workers where they are, coloured by what they're doing (click one).
      ctx.fillStyle = 'rgba(10,8,5,0.45)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      for (const c of sim.workers.list()) {
        const n = sim.npcs.byId(c.npcId);
        if (!n || n.away) continue;
        const x = (n.x / 32) * SCALE;
        const y = (n.y / 32) * SCALE;
        const g = statusGroup(sim, c);
        ctx.fillStyle = GROUP_COLORS[g];
        ctx.strokeStyle = this.sel?.id === c.npcId ? '#ffffff' : '#1a120a';
        ctx.lineWidth = this.sel?.id === c.npcId ? 3 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.markers.push({ kind: 'worker', id: c.npcId, x, y, r: 6 });
      }
    } else if (L === 'jobs') {
      // Your contracts where the work is (with how far along), and your building sites.
      ctx.fillStyle = 'rgba(10,8,5,0.45)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      const C = sim.construction;
      for (const c of C.sites()) if (C.isPlayers(c) || c.contractor === 'player') rect(c, '#60d0a0');
      for (const c of sim.state.contracts.active) {
        const p = contractPlace(sim, c);
        if (!p) continue;
        const x = (p.x / 32) * SCALE;
        const y = (p.y / 32) * SCALE;
        ctx.fillStyle = '#ffcf5a';
        ctx.strokeStyle = this.sel?.kind === 'job' && this.sel.id === c.id ? '#ffffff' : '#5a2a00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1a1410';
        ctx.fillText(`${Math.round(sim.contracts.progress(c) * 100)}`, x, y + 3.5);
        this.markers.push({ kind: 'job', id: c.id, x, y, r: 8 });
      }
    } else if (L === 'resources') {
      // What there is to gather: trees, stone, clay, berry bushes, crops.
      ctx.fillStyle = 'rgba(10,8,5,0.45)';
      ctx.fillRect(0, 0, sim.world.W * SCALE, sim.world.H * SCALE);
      for (const o of Object.values(sim.state.objects)) {
        if (!sim.resources.isHarvestable(o)) continue;
        const k2 = o.kind === 'rock' && o.variant === 'clay' ? 'clay' : o.kind;
        const col = RES_COLORS[k2];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(o.tx * SCALE, o.ty * SCALE, SCALE, SCALE);
      }
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

    // What each piece of land has become (its own shape, not a grid), and the lines between them.
    if (this.showDistricts && sim.territory) {
      const T2 = sim.territory;
      const color = new Map(T2.all().map((q) => [q.id, TERRITORY_COLORS[T2.profile(q.id)?.type]]));
      for (let y = 0; y < sim.world.H; y++) {
        for (let x = 0; x < sim.world.W; x++) {
          const id = T2.idAt(x, y);
          const col = id && color.get(id);
          if (col) {
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = col;
            ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
          }
          if (id) {
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#1a120a';
            if (T2.idAt(x + 1, y) !== id) ctx.fillRect((x + 1) * SCALE - 1, y * SCALE, 1, SCALE);
            if (T2.idAt(x, y + 1) !== id) ctx.fillRect(x * SCALE, (y + 1) * SCALE - 1, SCALE, 1);
          }
        }
      }
      ctx.globalAlpha = 1;
    } else if (this.showDistricts) {
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
    this.markers = [];
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
    for (const id of this.layer === 'places' ? [] : LABELLED) {
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
      if (n.inside || this.layer === 'workers') continue;
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
