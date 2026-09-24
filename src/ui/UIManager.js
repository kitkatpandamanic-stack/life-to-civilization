/**
 * UIManager — the DOM layer on top of the game canvas.
 *
 *   • HUD: level, XP, money, health / energy / hunger, clock, date, weather
 *   • objective tracker, toasts, level-up banner, status overlay (sleeping, working)
 *   • contextual menu for objects with several actions
 *   • modal panels: inventory, character, journal, map, dialogue, shop, job board, menu
 *   • keyboard shortcuts
 *
 * The world stays the main screen; panels only open on request.
 * All text comes from the locale files and re-renders when the language changes.
 */
import { EnterprisePanel } from './panels/EnterprisePanel.js';
import { t, fmtMoney, onLanguageChange, npcName } from '../i18n/i18n.js';
import { tr, escapeHtml } from './format.js';
import { WEATHER_ICONS } from '../systems/WeatherSystem.js';
import { BALANCE } from '../config/balance.js';
import { InventoryPanel } from './panels/InventoryPanel.js';
import { CharacterPanel } from './panels/CharacterPanel.js';
import { JournalPanel } from './panels/JournalPanel.js';
import { MapPanel } from './panels/MapPanel.js';
import { DialoguePanel } from './panels/DialoguePanel.js';
import { ShopPanel } from './panels/ShopPanel.js';
import { JobBoardPanel } from './panels/JobBoardPanel.js';
import { MenuPanel } from './panels/MenuPanel.js';
import { InspectPanel } from './panels/InspectPanel.js';
import { StoragePanel } from './panels/StoragePanel.js';
import { CraftPanel } from './panels/CraftPanel.js';
import { LandPanel } from './panels/LandPanel.js';
import { BuildPanel } from './panels/BuildPanel.js';
import { SitePanel } from './panels/SitePanel.js';
import { WorkersPanel } from './panels/WorkersPanel.js';
import { BusinessPanel } from './panels/BusinessPanel.js';
import { PropertyPanel } from './panels/PropertyPanel.js';
import { ExpeditionPanel } from './panels/ExpeditionPanel.js';
import { JourneyPanel } from './panels/JourneyPanel.js';
import { HallPanel } from './panels/HallPanel.js';

const REFRESH_EVENTS = ['inventory:changed', 'storage:changed', 'construction:changed', 'land:changed', 'workers:changed', 'business:changed', 'player:changed', 'jobs:changed', 'economy:changed', 'social:changed', 'player:levelup', 'player:skillup', 'chronicle'];

export class UIManager {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.root = document.getElementById('ui');
    this.root.innerHTML = '';
    this.panel = null;
    this.menu = null; // context menu
    this.status = null;
    this.hudTimer = 0;
    this.objectiveCache = null;
    this.refreshQueued = false;
    this.build();

    this.onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this.onKey);
    this.unsubs = [
      sim.bus.on('toast', (d) => this.toast(d)),
      sim.bus.on('player:levelup', (d) => this.showLevelUp(d)),
      onLanguageChange(() => this.onLanguage()),
      ...REFRESH_EVENTS.map((ev) => sim.bus.on(ev, () => this.queueRefresh())),
    ];
    this.updateHud();
  }

  // ------------------------------------------------------------------ DOM

  build() {
    const el = (cls, parent = this.root, tag = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.leftCol = el('hud-col');
    this.hudLeft = el('hud hud-left', this.leftCol);
    this.objectiveEl = el('hud objective hidden', this.leftCol);
    this.hudRight = el('hud hud-right');
    this.hotkeysEl = el('hotkeys');
    this.toastsEl = el('toasts');
    this.levelUpEl = el('levelup hidden');
    this.statusEl = el('status-overlay hidden');
    this.contextEl = el('context-menu hidden');
    this.buildHintEl = el('build-hint hidden');
    this.buildHintEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel-build]')) this.scene.buildMode.cancel();
    });
    this.modalEl = el('modal-root hidden');

    this.hudLeft.innerHTML = `
      <div class="portrait-ring"><span class="lvl"></span></div>
      <div class="hud-main">
        <div class="hud-name"><span class="pname"></span> <span class="ptitle"></span></div>
        <div class="xpbar"><div class="fill"></div><span class="label"></span></div>
        <div class="money-row"><span class="money"></span><span class="points hidden" data-open="character"></span></div>
        <div class="needs">
          <div class="need health"><span class="ico">❤️</span><div class="bar"><div class="fill"></div></div></div>
          <div class="need energy"><span class="ico">⚡</span><div class="bar"><div class="fill"></div></div></div>
          <div class="need hunger"><span class="ico">🍞</span><div class="bar"><div class="fill"></div></div></div>
        </div>
      </div>`;
    this.hudRight.innerHTML = `
      <div class="clock"></div>
      <div class="date"></div>
      <div class="weather"></div>`;
    this.q = {
      lvl: this.hudLeft.querySelector('.lvl'),
      name: this.hudLeft.querySelector('.pname'),
      title: this.hudLeft.querySelector('.ptitle'),
      xpFill: this.hudLeft.querySelector('.xpbar .fill'),
      xpLabel: this.hudLeft.querySelector('.xpbar .label'),
      money: this.hudLeft.querySelector('.money'),
      points: this.hudLeft.querySelector('.points'),
      health: this.hudLeft.querySelector('.health .fill'),
      energy: this.hudLeft.querySelector('.energy .fill'),
      hunger: this.hudLeft.querySelector('.hunger .fill'),
      healthRow: this.hudLeft.querySelector('.need.health'),
      energyRow: this.hudLeft.querySelector('.need.energy'),
      hungerRow: this.hudLeft.querySelector('.need.hunger'),
      clock: this.hudRight.querySelector('.clock'),
      date: this.hudRight.querySelector('.date'),
      weather: this.hudRight.querySelector('.weather'),
    };
    this.q.points.addEventListener('click', () => this.togglePanel('character'));

    this.hotkeysEl.addEventListener('click', (e) => {
      const k = e.target.closest('[data-open]');
      if (k) this.togglePanel(k.dataset.open);
    });
    this.modalEl.addEventListener('click', (e) => this.onModalClick(e));
    this.contextEl.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-index]');
      if (opt) this.chooseContext(Number(opt.dataset.index));
    });
    this.renderStatic();
  }

  renderStatic() {
    const keys = [
      ['E', 'ui.key_interact', null],
      ['F', 'ui.key_inspect', null],
      ['I', 'ui.inventory', 'inventory'],
      ['C', 'ui.character', 'character'],
      ['J', 'ui.journal', 'journal'],
      ['M', 'ui.map', 'map'],
      ['B', 'ui.key_build', 'build'],
      ['K', 'ui.workers', 'workers'],
      ['Q', 'ui.key_eat', null],
      ['Esc', 'ui.menu', 'menu'],
    ];
    this.hotkeysEl.innerHTML = keys
      .map(([k, label, open]) => `<span class="hk${open ? ' clickable' : ''}"${open ? ` data-open="${open}"` : ''}><kbd>${k}</kbd>${escapeHtml(t(label))}</span>`)
      .join('');
    this.q.healthRow.title = t('stat.health');
    this.q.energyRow.title = t('stat.energy');
    this.q.hungerRow.title = t('stat.hunger');
  }

  // ------------------------------------------------------------------ HUD

  update(delta) {
    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 200;
      this.updateHud();
    }
    if (this.status) this.updateStatus();
    if (this.panel?.tick) this.panel.tick(delta);
  }

  updateHud() {
    const sim = this.sim;
    const p = sim.state.player;
    const time = sim.time;
    const q = this.q;
    const need = sim.progression.xpForNext();
    q.lvl.textContent = p.level;
    q.name.textContent = npcName(p);
    q.title.textContent = `· ${t(`title.${sim.progression.title()}`)}`;
    q.xpFill.style.width = `${Math.min(100, (p.xp / need) * 100)}%`;
    q.xpLabel.textContent = t('ui.xp_progress', { xp: Math.floor(p.xp), need });
    q.money.textContent = `💰 ${fmtMoney(p.money)}`;
    const pts = p.attributePoints + p.skillPoints;
    q.points.classList.toggle('hidden', pts <= 0);
    q.points.textContent = t('ui.points_available', { n: pts });
    q.health.style.width = `${p.health}%`;
    q.energy.style.width = `${p.energy}%`;
    q.hunger.style.width = `${p.hunger}%`;
    q.healthRow.classList.toggle('low', p.health < 30);
    q.energyRow.classList.toggle('low', p.energy < BALANCE.needs.lowThreshold);
    q.hungerRow.classList.toggle('low', p.hunger < BALANCE.needs.lowThreshold);
    q.healthRow.dataset.value = Math.round(p.health);
    q.energyRow.dataset.value = Math.round(p.energy);
    q.hungerRow.dataset.value = Math.round(p.hunger);

    q.clock.textContent = time.clockString();
    q.date.textContent = t('ui.date_long', {
      day: time.dayOfSeason,
      season: t(`season.${time.season}`),
      weekday: t(`weekday.${time.weekday}`),
      year: time.year,
    });
    q.weather.textContent = `${WEATHER_ICONS[sim.weather.type] || ''} ${t(`weather.${sim.weather.type}`)}`;

    const obj = sim.jobs.objective();
    if (obj) {
      const job = sim.jobs.active;
      this.objectiveEl.classList.remove('hidden');
      this.objectiveEl.innerHTML = `<div class="obj-head">📋 ${escapeHtml(t(`job.${job.jobId}.name`))}</div><div class="obj-text">${escapeHtml(tr(sim, obj.key, obj.params))}</div>`;
    } else {
      const req = sim.state.jobs.requests.find((r) => r.accepted);
      if (req) {
        this.objectiveEl.classList.remove('hidden');
        const have = sim.inventory.count(req.item);
        this.objectiveEl.innerHTML = `<div class="obj-head">🤝 ${escapeHtml(t('ui.favour'))}</div><div class="obj-text">${escapeHtml(tr(sim, 'objective.request', { npc: req.npcId, item: req.item, qty: req.qty, have }))}</div>`;
      } else if (p.level === 1 && sim.state.stats.jobsCompleted === 0) {
        this.objectiveEl.classList.remove('hidden');
        this.objectiveEl.innerHTML = `<div class="obj-head">💡 ${escapeHtml(t('ui.tip'))}</div><div class="obj-text">${escapeHtml(t('objective.first_tip'))}</div>`;
      } else {
        this.objectiveEl.classList.add('hidden');
      }
    }
  }

  // ------------------------------------------------------------------ toasts

  toast({ key, params, type, text }) {
    this.toastText(text ?? tr(this.sim, key, params), type);
  }

  toastText(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 6) this.toastsEl.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 3600);
    setTimeout(() => el.remove(), 4200);
  }

  showLevelUp({ level, newJobs, newUnlocks = [], newTitle }) {
    const lines = [t('levelup.points', { a: BALANCE.progression.attributePointsPerLevel, s: BALANCE.progression.skillPointsPerLevel })];
    if (newTitle) lines.push(t('levelup.title', { title: t(`title.${newTitle}`) }));
    for (const u of newUnlocks) lines.push(`🔓 ${t(`unlock.${u}.name`)}`);
    for (const j of newJobs) lines.push(t('levelup.job', { job: t(`job.${j}.name`) }));
    this.levelUpEl.innerHTML = `<div class="lu-star">★</div><div class="lu-title">${escapeHtml(t('levelup.heading', { level }))}</div>${lines.map((l) => `<div class="lu-line">${escapeHtml(l)}</div>`).join('')}<div class="lu-hint">${escapeHtml(t('levelup.hint'))}</div>`;
    this.levelUpEl.classList.remove('hidden');
    this.levelUpEl.classList.remove('show');
    void this.levelUpEl.offsetWidth;
    this.levelUpEl.classList.add('show');
    clearTimeout(this.levelUpTimer);
    this.levelUpTimer = setTimeout(() => this.levelUpEl.classList.add('hidden'), 5000);
  }

  // ------------------------------------------------------------------ status overlay (sleep / shift)

  showStatus(kind, data = {}) {
    this.status = { kind, data, startTotal: this.sim.time.total };
    this.statusEl.classList.remove('hidden');
    this.statusEl.className = `status-overlay status-${kind}`;
    this.updateStatus();
  }

  hideStatus() {
    this.status = null;
    this.statusEl.classList.add('hidden');
  }

  updateStatus() {
    const s = this.status;
    const icons = { sleep: '🌙', work: '🛠️', passout: '💫', collapse: '🩹', travel: '🧭', own_shift: '🏪', exploring: '🔦', journey: '🐎' };
    let pct = '';
    if (s.kind === 'work') {
      const done = Math.min(1, (this.sim.time.total - s.startTotal) / s.data.minutes);
      pct = `<div class="st-bar"><div class="fill" style="width:${done * 100}%"></div></div>`;
    }
    const trip = this.sim.state.exploration?.trip;
    if (s.kind === 'travel' && trip) {
      const done = Math.min(1, (this.sim.time.total - trip.depart) / (trip.until - trip.depart));
      pct = `<div class="st-bar"><div class="fill" style="width:${done * 100}%"></div></div>`;
    }
    const j = this.sim.state.region?.journey;
    if (s.kind === 'journey' && j) {
      const [from, to] = j.stage === 'back' ? [j.until - j.days * 1440, j.until] : [j.depart, j.arrive];
      const done = Math.min(1, (this.sim.time.total - from) / Math.max(1, to - from));
      pct = `<div class="st-bar"><div class="fill" style="width:${done * 100}%"></div></div>`;
    }
    if (s.kind === 'journey') {
      this.statusEl.innerHTML = `<div class="st-card"><div class="st-icon">${icons.journey}</div><div class="st-title">${escapeHtml(tr(this.sim, j?.stage === 'back' ? 'status.journey_home' : 'status.journey', { settlement: s.data.settlement }))}</div><div class="st-clock">${this.sim.time.clockString()}</div>${pct}</div>`;
      return;
    }
    const title = s.kind === 'exploring' ? tr(this.sim, 'status.exploring', { site: s.data.site }) : s.kind === 'own_shift' ? tr(this.sim, 'status.own_shift', { building: s.data.building }) : s.kind === 'work' ? tr(this.sim, 'status.work', { job: s.data.job }) : s.kind === 'travel' ? tr(this.sim, 'status.travel', { region_name: s.data.region }) : t(`status.${s.kind}`);
    this.statusEl.innerHTML = `<div class="st-card"><div class="st-icon">${icons[s.kind] || ''}</div><div class="st-title">${escapeHtml(title)}</div><div class="st-clock">${this.sim.time.clockString()}</div>${pct}</div>`;
  }

  // ------------------------------------------------------------------ context menu

  openContextMenu({ title, actions, x, y }) {
    this.menu = { actions };
    this.contextEl.innerHTML =
      `<div class="cm-title">${escapeHtml(title)}</div>` +
      actions
        .map(
          (a, i) =>
            `<div class="cm-opt${a.disabled ? ' disabled' : ''}" data-index="${i}"><kbd>${i + 1}</kbd><span class="cm-label">${escapeHtml(a.label)}</span>${a.disabled ? `<span class="cm-reason">${escapeHtml(a.reason)}</span>` : ''}</div>`,
        )
        .join('') +
      `<div class="cm-hint">${escapeHtml(t('ui.context_hint'))}</div>`;
    this.contextEl.classList.remove('hidden');
    const w = this.contextEl.offsetWidth;
    const h = this.contextEl.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, y - h - 6));
    this.contextEl.style.left = `${left}px`;
    this.contextEl.style.top = `${top}px`;
  }

  chooseContext(index) {
    const a = this.menu?.actions[index];
    if (!a) return;
    if (a.disabled) {
      this.toastText(a.reason, 'warn');
      return;
    }
    this.closeContextMenu();
    a.run();
  }

  closeContextMenu() {
    this.menu = null;
    this.contextEl.classList.add('hidden');
  }

  // ------------------------------------------------------------------ panels

  isPaused() {
    return !!this.panel || !!this.menu;
  }

  isBlocking() {
    return this.isPaused() || !!this.status;
  }

  openPanel(panel) {
    this.closeContextMenu();
    if (this.panel) this.closePanel();
    this.panel = panel;
    this.scene.player?.cancelAction();
    panel.onOpen();
    this.modalEl.classList.remove('hidden');
    this.renderPanel();
  }

  closePanel() {
    if (!this.panel) return;
    const p = this.panel;
    this.panel = null;
    p.onClose();
    this.modalEl.classList.add('hidden');
    this.modalEl.innerHTML = '';
  }

  renderPanel() {
    const p = this.panel;
    if (!p) return;
    const oldBody = this.modalEl.querySelector('.panel-body');
    const scroll = oldBody ? oldBody.scrollTop : 0;
    this.modalEl.innerHTML = `
      <div class="panel panel-${p.id}">
        <div class="panel-head"><div class="panel-title">${p.title()}</div><button class="panel-close" data-action="close" title="${escapeHtml(t('ui.close'))}">✕</button></div>
        <div class="panel-body">${p.render()}</div>
      </div>`;
    const body = this.modalEl.querySelector('.panel-body');
    body.scrollTop = scroll;
    p.afterRender?.(body);
  }

  queueRefresh() {
    if (!this.panel || this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.renderPanel();
    });
  }

  onModalClick(e) {
    if (e.target === this.modalEl) {
      this.closePanel();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || !this.panel) return;
    if (el.classList.contains('disabled') || el.disabled) return;
    if (el.dataset.action === 'close') {
      this.closePanel();
      return;
    }
    const panel = this.panel;
    panel.onAction(el.dataset.action, el.dataset, el);
    if (this.panel === panel) this.renderPanel();
  }

  togglePanel(id) {
    if (this.panel?.id === id) {
      this.closePanel();
      return;
    }
    if (this.status) return;
    const factories = {
      inventory: () => new InventoryPanel(this),
      character: () => new CharacterPanel(this),
      journal: () => new JournalPanel(this),
      map: () => new MapPanel(this),
      menu: () => new MenuPanel(this),
      build: () => new BuildPanel(this),
      workers: () => new WorkersPanel(this),
    };
    if (factories[id]) this.openPanel(factories[id]());
  }

  openDialogue(npcId) {
    this.openPanel(new DialoguePanel(this, npcId));
  }
  openInspect(npcId) {
    this.openPanel(new InspectPanel(this, npcId));
  }
  openStorage() {
    this.openPanel(new StoragePanel(this));
  }
  openLand(plotId) {
    this.openPanel(new LandPanel(this, plotId));
  }
  openBuild(tab = null) {
    this.openPanel(new BuildPanel(this, tab));
  }
  openSite(id) {
    this.openPanel(new SitePanel(this, id));
  }
  openWorkers() {
    this.openPanel(new WorkersPanel(this));
  }
  openExpedition() {
    this.openPanel(new ExpeditionPanel(this));
  }
  openHall() {
    this.openPanel(new HallPanel(this));
  }
  openJourney(opts = {}) {
    this.openPanel(new JourneyPanel(this, { mode: 'plan', ...opts }));
  }
  openProperty(buildingId) {
    this.openPanel(new PropertyPanel(this, buildingId));
  }
  openBusiness(id) {
    this.openPanel(new BusinessPanel(this, id));
  }
  openEnterprise(id) {
    this.openPanel(new EnterprisePanel(this, id));
  }

  /** Translate with id-params resolved (used by world-space text like build hints). */
  tr(key, params = {}) {
    return tr(this.sim, key, params);
  }

  showBuildHint(type) {
    const name = type === 'road' ? t('buildable.road.name') : t(`buildable.${type}.name`);
    this.buildHintEl.innerHTML = `🔨 ${escapeHtml(t('ui.placing', { name }))} <span class="muted">${escapeHtml(t(type === 'road' ? 'ui.road_hint' : 'ui.place_hint'))}</span> <button class="btn" data-cancel-build>${escapeHtml(t('ui.cancel'))}</button>`;
    this.buildHintEl.classList.remove('hidden');
  }

  hideBuildHint() {
    this.buildHintEl.classList.add('hidden');
  }
  openCraft(station) {
    this.openPanel(new CraftPanel(this, station));
  }
  openShop(bizId, tab = 'buy') {
    this.openPanel(new ShopPanel(this, bizId, tab));
  }
  openJobBoard(bizId = null) {
    this.openPanel(new JobBoardPanel(this, bizId));
  }

  // ------------------------------------------------------------------ keyboard

  handleKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    // Physical key codes make shortcuts work on any keyboard layout (e.g. Russian ЙЦУКЕН).
    const code = e.code;

    if (key === 'Escape') {
      e.preventDefault();
      if (this.scene.buildMode?.active && !this.panel) this.scene.buildMode.cancel();
      else if (this.menu) this.closeContextMenu();
      else if (this.panel) this.closePanel();
      else if (this.scene.player?.isBusy()) this.scene.player.cancelAction();
      else if (!this.status) this.togglePanel('menu');
      return;
    }
    if (this.status) return;

    const digit = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
    if (digit) {
      const i = Number(digit[1]) - 1;
      if (this.menu) {
        this.chooseContext(i);
        return;
      }
      if (this.panel) {
        const opts = this.modalEl.querySelectorAll('[data-hotkey]');
        const el = [...opts].find((o) => Number(o.dataset.hotkey) === i + 1);
        if (el && !el.classList.contains('disabled') && !el.disabled) el.click();
        return;
      }
    }

    if (code === 'KeyE' || lower === 'e' || key === ' ') {
      if (key === ' ') e.preventDefault();
      if (this.menu) {
        const first = this.menu.actions.findIndex((a) => !a.disabled);
        if (first >= 0) this.chooseContext(first);
        return;
      }
      if (!this.panel) this.scene.interaction.interact('E');
      return;
    }
    if (code === 'KeyF' && !this.panel && !this.menu) {
      this.scene.interaction.interact('F');
      return;
    }
    const panelKeys = { KeyI: 'inventory', KeyC: 'character', KeyJ: 'journal', KeyM: 'map', KeyK: 'workers' };
    if (panelKeys[code]) {
      this.closeContextMenu();
      this.togglePanel(panelKeys[code]);
      return;
    }
    if (code === 'KeyQ' && !this.panel && !this.menu) this.quickEat();
    if (code === 'KeyB' && !this.menu) {
      if (this.panel?.id === 'build') this.closePanel();
      else if (!this.scene.inside) this.openBuild();
    }
  }

  quickEat() {
    const food = this.sim.inventory.bestFoodToEat();
    if (!food) {
      this.sim.toast('toast.no_food', {}, 'warn');
      return;
    }
    if (this.sim.state.player.hunger >= 98) {
      this.sim.toast('toast.not_hungry', {}, 'info');
      return;
    }
    this.sim.inventory.eat(food);
  }

  onLanguage() {
    this.renderStatic();
    this.updateHud();
    if (this.panel) this.renderPanel();
    if (this.status) this.updateStatus();
    this.closeContextMenu();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.unsubs.forEach((u) => u());
    clearTimeout(this.levelUpTimer);
    this.root.innerHTML = '';
  }
}
