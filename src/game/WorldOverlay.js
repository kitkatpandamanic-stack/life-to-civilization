/**
 * WorldOverlay — small labels on the world itself, only when they help:
 *
 *   🏗️ Anna's house · 64% · 👷 2          over a building site (or a building under works)
 *   📦 🪵 120 · 🪨 40 · 🧱 12 — 172/300      over your store (where your workers bring things)
 *   📜 Harvest · 45%                        where a job of yours is being done
 *   ⬆ Lv 3 · 82%                           your buildings (in info mode)
 *
 * When: next to you (a couple of screens' worth of steps), for what's picked or followed, or everything
 * in view with info mode on (V). The labels are a small pool of DOM elements (never more than MAX),
 * recomputed a few times a second, moved with the camera every frame.
 */
import { t, itemName } from '../i18n/i18n.js';
import { escapeHtml, buildingLabel } from '../ui/format.js';
import { contractPlace } from '../ui/contracts.js';
import { icon } from '../ui/widgets.js';
import { getSetting, setSetting } from '../ui/settings.js';

const TS = 32;
const NEAR = 260; // px from you: labels show without info mode
const MAX = 24; // labels at once (the nearest win)
const KIND_ICON = { harvest: '🌾', water: '💧', repair: '🛠️', build: '🔨', haul: '🛒', supply: '📦', craft: '🪚', order: '📜', job: '📋' };

export class WorldOverlay {
  constructor(scene) {
    this.scene = scene;
    this.sim = scene.sim;
    this.layer = document.createElement('div');
    this.layer.className = 'overlay-layer';
    scene.ui.root.insertBefore(this.layer, scene.ui.root.firstChild);
    this.pool = new Map(); // key → element
    this.items = [];
    this.timer = 0;
    this.info = !!getSetting('infoMode');
  }

  /** Info mode (V): every label in view, not just the ones near you. */
  toggle() {
    this.info = !this.info;
    setSetting('infoMode', this.info);
    this.timer = 0;
    this.sim.toast(this.info ? 'toast.info_on' : 'toast.info_off', {}, 'info');
    return this.info;
  }

  /** What deserves a label now: [{ key, x, y, html, cls }]. */
  collect() {
    const sim = this.sim;
    const P = sim.state.player;
    const cam = this.scene.cameras.main.worldView;
    const inView = (x, y) => x > cam.x - 60 && x < cam.right + 60 && y > cam.y - 60 && y < cam.bottom + 80;
    const near = (x, y) => Math.hypot(x - P.x, y - P.y) < NEAR;
    const picked = this.scene.ui.menu?.sel || null;
    const show = (x, y, id) => inView(x, y) && (this.info || near(x, y) || id === picked);
    const out = [];
    // Building sites and works: how far along, who's on it (waiting for materials says so).
    for (const c of sim.construction.sites()) {
      if (c.status !== 'site') continue;
      const x = (c.tx + c.w / 2) * TS;
      const y = c.ty * TS - (c.kind === 'works' ? 26 : 6);
      if (!show(x, y, c.target || c.id)) continue;
      const pct = Math.min(100, Math.round((c.labor / Math.max(1, c.laborNeeded)) * 100));
      const waiting = sim.construction.siteState(c) === 'waiting_materials';
      const hands = sim.state.npcs.filter((n) => n.task?.site === c.id || n.task?.siteId === c.id || sim.workers.contract(n.id)?.task?.target === c.id).length;
      const name = c.kind === 'works' ? buildingLabel(sim, c.target) : sim.construction.isPlayers(c) ? t(`buildable.${c.type}.name`) : t(`vbuilding.${c.type}`);
      out.push({
        key: `s:${c.id}`,
        x,
        y,
        cls: waiting ? 'warn' : 'site',
        html: `<b>${waiting ? '📦' : '🏗️'} ${escapeHtml(name)}</b><span class="ol-bar"><i style="width:${pct}%"></i></span><span>${pct}%${hands ? ` · 👷 ${hands}` : ''}</span>`,
      });
    }
    // Your store: what's in it (the most first), and the room there is.
    const base = sim.workers.baseBuilding();
    if (base) {
      // (below the building — a site's label sits over its roof)
      const x = (base.tx + base.w / 2) * TS;
      const y = (base.ty + base.h) * TS + 26;
      if (show(x, y, base.id)) {
        const totals = new Map();
        for (const s of sim.home.storage) totals.set(s.id, (totals.get(s.id) || 0) + s.qty);
        const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 3);
        const used = [...totals.values()].reduce((a, b) => a + b, 0);
        const cap = sim.home.storageCapacity();
        if (used) out.push({ key: `st:${base.id}`, x, y, cls: used >= cap * 0.9 ? 'warn' : 'store', html: `<b>📦</b>${top.map(([id, q]) => `<span title="${escapeHtml(itemName(id))}">${icon(id, 16)}${q}</span>`).join('')}<span class="ol-dim">${used}/${cap}</span>` });
      }
    }
    // Where your jobs are being done.
    for (const c of sim.state.contracts.active) {
      const p = contractPlace(sim, c);
      if (!p) continue;
      const tracked = sim.state.contracts.tracked === c.id;
      if (!inView(p.x, p.y) || !(this.info || tracked || near(p.x, p.y))) continue;
      const pct = Math.round(sim.contracts.progress(c) * 100);
      out.push({ key: `c:${c.id}`, x: p.x, y: p.y - 58, cls: 'job', html: `<b>${KIND_ICON[c.kind] || '📜'} ${escapeHtml(t(`contract.kind.${c.kind}`))}</b><span>${pct}%</span>${(c.workers || []).length ? `<span>👷 ${c.workers.length}</span>` : ''}` });
    }
    // Info mode: your buildings' level and condition.
    if (this.info) {
      for (const [id, r] of Object.entries(sim.property.all)) {
        if (r.owner !== 'player') continue;
        const b = sim.world.buildings[id];
        if (!b || sim.structures?.works(id)) continue;
        const x = (b.tx + b.w / 2) * TS;
        const y = b.ty * TS - 8;
        if (!inView(x, y) || out.some((o) => o.key === `st:${id}`)) continue;
        const lvl = sim.structures?.rec(id)?.lvl;
        const cond = Math.round(r.condition ?? 100);
        out.push({ key: `b:${id}`, x, y, cls: cond < 40 ? 'warn' : 'mine', html: `<b>${escapeHtml(buildingLabel(sim, id))}</b>${lvl ? `<span>${escapeHtml(t('bcard.level', { n: lvl, max: sim.structures.maxLevel(id) }))}</span>` : ''}<span>🔧 ${cond}%</span>` });
      }
    }
    // Nearest first; never too many at once.
    out.sort((a, b) => Math.hypot(a.x - P.x, a.y - P.y) - Math.hypot(b.x - P.x, b.y - P.y));
    return out.slice(0, MAX);
  }

  update(delta, hidden) {
    if (hidden) {
      this.layer.classList.add('hidden');
      return;
    }
    this.layer.classList.remove('hidden');
    this.timer -= delta;
    if (this.timer <= 0) {
      this.timer = 300;
      this.items = this.collect();
      const keep = new Set();
      for (const it of this.items) {
        keep.add(it.key);
        let el = this.pool.get(it.key);
        if (!el) {
          el = document.createElement('div');
          this.layer.appendChild(el);
          this.pool.set(it.key, el);
        }
        if (el.dataset.html !== it.html) {
          el.dataset.html = it.html;
          el.innerHTML = it.html;
        }
        el.className = `ol-label ol-${it.cls}`;
      }
      for (const [k, el] of this.pool) {
        if (keep.has(k)) continue;
        el.remove();
        this.pool.delete(k);
      }
    }
    // Follow the camera every frame.
    const ui = this.scene.ui;
    for (const it of this.items) {
      const el = this.pool.get(it.key);
      if (!el) continue;
      const p = ui.worldToScreen(it.x, it.y);
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
  }
}
