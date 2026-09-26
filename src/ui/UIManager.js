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
import { EquipmentPanel } from './panels/EquipmentPanel.js';
import { OrdersPanel } from './panels/OrdersPanel.js';
import { FreightPanel } from './panels/FreightPanel.js';
import { LivestockPanel } from './panels/LivestockPanel.js';
import { StationPanel } from './panels/StationPanel.js';
import { RivalPanel } from './panels/RivalPanel.js';
import { StoryPanel } from './panels/StoryPanel.js';
import { MeetingPanel } from './panels/MeetingPanel.js';
import { ManagementPanel } from './panels/ManagementPanel.js';
import { InventionPanel } from './panels/InventionPanel.js';
import { ColonyPanel } from './panels/ColonyPanel.js';
import { t, fmtMoney, onLanguageChange, npcName, itemName } from '../i18n/i18n.js';
import { tr, escapeHtml, hoodLabel, districtLabel, buildingLabel } from './format.js';
import { WEATHER_ICONS } from '../systems/WeatherSystem.js';
import { BALANCE } from '../config/balance.js';
import { InventoryPanel } from './panels/InventoryPanel.js';
import { CharacterPanel } from './panels/CharacterPanel.js';
import { JournalPanel } from './panels/JournalPanel.js';
import { MapPanel } from './panels/MapPanel.js';
import { PlacePanel } from './panels/PlacePanel.js';
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
import { SchoolPanel } from './panels/SchoolPanel.js';
import { InstitutePanel } from './panels/InstitutePanel.js';
import { AffairsPanel } from './panels/AffairsPanel.js';
import { itemTip } from './items.js';
import { icon, condState } from './widgets.js';
import { landHere } from './land.js';
import { followStrip } from './workerCard.js';
import { applySettings, uiScale, getSetting, setSetting } from './settings.js';
import { play } from '../audio/AudioEngine.js';
import { ITEMS } from '../data/items.js';

/** The dock: the screens you open most, with their keys. */
const DOCK = [
  ['inventory', '🎒', 'I', 'ui.inventory'],
  ['character', '👤', 'C', 'ui.character'],
  ['journal', '📖', 'J', 'ui.journal'],
  ['map', '🗺️', 'M', 'ui.map'],
  ['build', '🔨', 'B', 'ui.key_build'],
  ['workers', '👷', 'K', 'ui.workers'],
  ['affairs', '💼', 'L', 'affairs.title'],
  ['management', '🧭', 'Tab', 'mgmt.title'],
  null,
  ['info', '🏷️', 'V', 'ui.info_mode'],
  ['menu', '⚙️', 'Esc', 'ui.menu'],
];
/** Icons for notifications, by what they're about (the first match wins). */
const TOAST_ICONS = [
  [/rent|dividend|paid|sold|earn|wage|gain|money/, '💰'],
  [/tenant|moved_in|viewing|let_|house|home/, '🏠'],
  [/works|site|built|building|construct|upgrade|restor/, '🏗️'],
  [/level|skill|perk/, '⭐'],
  [/tool|broke/, '🔧'],
  [/ate|food|hungry/, '🍞'],
  [/job|shift|contract|order/, '📋'],
  [/fire|flood|storm|danger/, '🔥'],
  [/save|load/, '💾'],
];

const REFRESH_EVENTS = ['inventory:changed', 'storage:changed', 'construction:changed', 'land:changed', 'workers:changed', 'business:changed', 'player:changed', 'jobs:changed', 'economy:changed', 'social:changed', 'player:levelup', 'player:skillup', 'chronicle', 'building:changed', 'property:changed'];

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
      // The big moments get a card of their own (and the line-by-line toasts that come with them are left out).
      sim.bus.on('contract:completed', (d) => this.notifyContract(d)),
      sim.bus.on('works:completed', (d) => this.notifyWorks(d)),
      sim.bus.on('worker:stuck', (d) => this.notifyStuck(d)),
      sim.bus.on('construction:waiting', (c) => this.notifyMaterials(c)),
      sim.bus.on('dynasty:offer', (o) => this.notifyOffer(o)),
      sim.bus.on('player:levelup', (d) => this.showLevelUp(d)),
      onLanguageChange(() => this.onLanguage()),
      sim.bus.on('land:changed', () => (this.landKey = null)),
      sim.bus.on('places:changed', () => (this.landKey = null)),
      // "Show me" / "Follow them" from a screen: it closes, and the camera goes there.
      sim.bus.on('ui:look', ({ x, y }) => {
        this.closePanel();
        this.scene.camDir?.lookAt(x, y);
      }),
      sim.bus.on('ui:follow', ({ npc }) => {
        this.closePanel();
        this.scene.camDir?.follow(npc);
      }),
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
    // Top left: you (level, needs) and what to do next. Top right: the time and your money.
    this.leftCol = el('hud-col');
    this.hudLeft = el('hud hud-player', this.leftCol);
    this.objectiveEl = el('hud objective hidden', this.leftCol);
    // The guide's step (or advice) in the HUD: click it for the Guide (what next, your path) — or fold it away.
    this.objectiveEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-fold]')) {
        e.stopPropagation();
        setSetting('objectiveFolded', !getSetting('objectiveFolded'));
        this.objectiveEl.classList.toggle('folded', !!getSetting('objectiveFolded'));
        return;
      }
      if (this.objectiveEl.dataset.guide) this.openJournal('guide');
    });
    this.objectiveEl.classList.toggle('folded', !!getSetting('objectiveFolded'));
    this.rightCol = el('hud-col hud-col-right');
    const topRow = el('hud-row', this.rightCol);
    this.hudRight = el('hud hud-world', topRow);
    this.moneyEl = el('hud hud-money', topRow, 'button');
    this.moneyEl.addEventListener('click', () => this.togglePanel('affairs'));
    this.landEl = el('land-chip hidden', this.rightCol, 'button');
    this.floatEl = el('float-layer');
    this.promptEl = el('world-prompt hidden');
    this.bottomEl = el('hud-bottom');
    this.hotbarEl = el('hotbar', this.bottomEl);
    this.dockEl = el('dock', this.bottomEl);
    this.hotkeysEl = el('hotkeys');
    this.toastsEl = el('toasts', this.rightCol);
    this.levelUpEl = el('levelup hidden');
    this.placeEl = el('place-banner hidden');
    this.statusEl = el('status-overlay hidden');
    this.contextEl = el('context-menu hidden');
    this.buildHintEl = el('build-hint hidden');
    // Following a worker: who, what they're doing, and Stop.
    this.followEl = el('follow-strip hidden');
    this.followEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop-follow]')) this.scene.camDir?.back();
    });
    this.buildHintEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel-build]')) this.scene.buildMode.cancel();
    });
    this.modalEl = el('modal-root hidden');
    this.tipEl = el('tooltip');
    applySettings();

    this.hudLeft.innerHTML = `
      <button class="lvl-ring" data-open="character"><span class="lvl"></span></button>
      <div class="hud-main">
        <div class="hud-name"><span class="pname"></span><span class="ptitle"></span><span class="points hidden" data-open="character"></span></div>
        <div class="needs">
          <div class="need health"><span class="ico">❤️</span><div class="bar"><div class="fill"></div></div><span class="val"></span></div>
          <div class="need energy"><span class="ico">⚡</span><div class="bar"><div class="fill"></div></div><span class="val"></span></div>
          <div class="need hunger"><span class="ico">🍗</span><div class="bar"><div class="fill"></div></div><span class="val"></span></div>
        </div>
      </div>`;
    this.hudRight.innerHTML = `
      <span class="w-icon"></span>
      <div class="w-main">
        <div class="clock"></div>
        <div class="date"></div>
      </div>
      <div class="w-side"><span class="temp"></span><span class="weather"></span></div>
      <div class="w-extra hidden"></div>`;
    this.moneyEl.innerHTML = `<span class="m-ico">💰</span><span class="money"></span>`;
    this.q = {
      lvl: this.hudLeft.querySelector('.lvl'),
      ring: this.hudLeft.querySelector('.lvl-ring'),
      name: this.hudLeft.querySelector('.pname'),
      title: this.hudLeft.querySelector('.ptitle'),
      money: this.moneyEl.querySelector('.money'),
      points: this.hudLeft.querySelector('.points'),
      health: this.hudLeft.querySelector('.health .fill'),
      energy: this.hudLeft.querySelector('.energy .fill'),
      hunger: this.hudLeft.querySelector('.hunger .fill'),
      healthRow: this.hudLeft.querySelector('.need.health'),
      energyRow: this.hudLeft.querySelector('.need.energy'),
      hungerRow: this.hudLeft.querySelector('.need.hunger'),
      clock: this.hudRight.querySelector('.clock'),
      date: this.hudRight.querySelector('.date'),
      wicon: this.hudRight.querySelector('.w-icon'),
      temp: this.hudRight.querySelector('.temp'),
      weather: this.hudRight.querySelector('.weather'),
      wextra: this.hudRight.querySelector('.w-extra'),
      land: this.landEl,
    };
    // Whose land you're standing on — click for the land panel (and to buy it).
    this.q.land.addEventListener('click', () => this.landId && this.openLand(this.landId));
    this.hudLeft.addEventListener('click', (e) => {
      if (e.target.closest('[data-open]')) this.togglePanel('character');
    });
    this.q.healthVal = this.hudLeft.querySelector('.health .val');
    this.q.energyVal = this.hudLeft.querySelector('.energy .val');
    this.q.hungerVal = this.hudLeft.querySelector('.hunger .val');

    this.dockEl.addEventListener('click', (e) => {
      const k = e.target.closest('[data-open]');
      if (k?.dataset.open === 'info') return this.toggleInfo();
      if (k) this.togglePanel(k.dataset.open);
    });
    this.hotbarEl.addEventListener('click', (e) => {
      const k = e.target.closest('[data-slot]');
      if (k) this.holdTool(Number(k.dataset.slot));
    });
    // Tooltips: anything with data-tip, shown after a moment's hover.
    this.root.addEventListener('mouseover', (e) => this.onTipOver(e));
    this.root.addEventListener('mouseout', (e) => {
      if (this.tipAnchor && !this.tipAnchor.contains(e.relatedTarget)) this.hideTip();
    });
    this.root.addEventListener('mousemove', (e) => this.moveTip(e));
    this.modalEl.addEventListener('click', (e) => this.onModalClick(e));
    // Search boxes and dropdowns (widgets searchBox/select): the panel hears what's typed or picked.
    const onInput = (e) => {
      const el = e.target.closest?.('[data-input]');
      if (!el || !this.panel?.onInput) return;
      this.panel.onInput(el.dataset.input, el.value, el);
      this.renderPanel();
    };
    this.modalEl.addEventListener('input', (e) => e.target.tagName === 'INPUT' && onInput(e));
    this.modalEl.addEventListener('change', (e) => e.target.tagName === 'SELECT' && onInput(e));
    this.contextEl.addEventListener('click', (e) => {
      const cmd = e.target.closest('[data-cmd]');
      if (cmd && this.menu?.onCmd) {
        const fn = this.menu.onCmd;
        this.closeContextMenu();
        fn(cmd.dataset.cmd, cmd.dataset);
        return;
      }
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
      ['L', 'affairs.title', 'affairs'],
      ['Q', 'ui.key_eat', null],
      ['Esc', 'ui.menu', 'menu'],
    ];
    this.hotkeysEl.innerHTML = keys
      .map(([k, label, open]) => `<span class="hk${open ? ' clickable' : ''}"${open ? ` data-open="${open}"` : ''}><kbd>${k}</kbd>${escapeHtml(t(label))}</span>`)
      .join('');
    this.dockEl.innerHTML = DOCK.map((d) =>
      d ? `<button class="dock-btn" data-open="${d[0]}" data-tip="${escapeHtml(`<div class='tip-title'>${escapeHtml(t(d[3]))}</div><div class='tip-sub'>${escapeHtml(t('ui.key_n', { key: d[2] }))}</div>`)}">${d[1]}<span class="key">${d[2] === 'Esc' ? '' : d[2] === 'Tab' ? '⇥' : d[2]}</span></button>` : '<span class="dock-sep"></span>',
    ).join('');
    this.hotbarKey = null;
    this.renderHotbar();
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

  /** The land chip: the piece of land under your feet, whose it is, and whether it's for sale. */
  updateLandChip() {
    const sim = this.sim;
    const me = sim.world.toTile(sim.state.player.x, sim.state.player.y);
    const id = sim.territory?.idAt(me.tx, me.ty) ?? null;
    // The neighbourhood you're in (PlaceSystem) — walking into one, its name comes up.
    const hood = sim.places?.hoodAt(me.tx, me.ty) || null;
    this.enterPlace(hood);
    const key = `${id}|${id && sim.territory.owner(id)}|${hood?.id}`;
    if (key === this.landKey) return;
    this.landKey = key;
    this.landId = id;
    const here = id ? landHere(sim, me.tx, me.ty) : null;
    this.q.land.classList.toggle('hidden', !here);
    if (!here) return;
    this.q.land.classList.toggle('mine', here.owner === 'player');
    this.q.land.classList.toggle('sale', here.forSale);
    this.q.land.innerHTML = `<span class="lc-name">🏞️ ${escapeHtml(here.name)}</span><span class="lc-owner">${escapeHtml(here.text)}${here.forSale ? ` · ${escapeHtml(t('land_ui.for_sale_short'))}` : ''}</span>${hood ? `<span class="lc-place">🏘️ ${escapeHtml(hoodLabel(sim, hood))}</span>` : ''}`;
    this.q.land.dataset.tip = `<div class='tip-title'>${escapeHtml(here.name)}</div><div class='tip-sub'>${escapeHtml(t('land_ui.chip_tip'))}</div>`;
  }

  /** Walking into a neighbourhood: its name comes up on the screen for a moment (not again for the one you just left). */
  enterPlace(hood) {
    const id = hood?.id || null;
    if (id === this.placeHere) return;
    this.placeHere = id;
    if (!hood || id === this.placeShown) return;
    this.placeShown = id;
    const sim = this.sim;
    const b = sim.world.buildings[hood.homes[0]];
    const d = b ? sim.places.districtAt(b.door.tx, b.door.ty) : null;
    this.placeEl.innerHTML = `<div class="pb-name">${escapeHtml(hoodLabel(sim, hood))}</div><div class="pb-sub">${escapeHtml(t(`hood_kind.${hood.kind}`))}${d ? ` · ${escapeHtml(districtLabel(d))}` : ''}</div>`;
    this.placeEl.classList.remove('hidden', 'show');
    void this.placeEl.offsetWidth;
    this.placeEl.classList.add('show');
    clearTimeout(this.placeTimer);
    this.placeTimer = setTimeout(() => this.placeEl.classList.add('hidden'), 3200);
  }

  /** The strip while the camera follows a worker (refreshed with the HUD). */
  updateFollow() {
    const id = this.scene.camDir?.following();
    this.followEl.classList.toggle('hidden', !id);
    if (!id) return;
    const html = followStrip(this.sim, id);
    if (html !== this.followHtml) {
      this.followHtml = html;
      this.followEl.innerHTML = html;
    }
  }

  /** The objective card: a heading, the text, and (for the guide) a hint; ▾ folds it down to the heading. */
  setObjective(head, text, more = '') {
    const html = `<div class="obj-head"><span class="obj-title">${head}</span><button class="obj-fold" data-fold="1" aria-label="${escapeHtml(t('ui.fold'))}">▾</button></div><div class="obj-text">${text}</div>${more ? `<div class="obj-more">${more}</div>` : ''}`;
    if (this.objectiveHtml !== html) {
      this.objectiveHtml = html;
      this.objectiveEl.innerHTML = html;
    }
    this.objectiveEl.classList.remove('hidden');
  }

  updateHud() {
    const sim = this.sim;
    const p = sim.state.player;
    const time = sim.time;
    const q = this.q;
    const need = sim.progression.xpForNext();
    q.lvl.textContent = p.level;
    q.name.textContent = npcName(p);
    q.title.textContent = t(`title.${sim.progression.title()}`);
    // XP fills the ring around your level (hover: how much, and to what).
    const xpPct = Math.min(100, (p.xp / need) * 100);
    q.ring.style.setProperty('--xp', `${xpPct}%`);
    const xpTip = `<div class='tip-title'>${escapeHtml(t('ui.level_n', { level: p.level }))}</div><div class='tip-row'><span>XP</span><b>${Math.floor(p.xp)} / ${need}</b></div><div class='tip-sub'>${escapeHtml(t('ui.character'))} · C</div>`;
    if (q.ring.dataset.tip !== xpTip) q.ring.dataset.tip = xpTip;
    // Money: the total moves, and the change floats up beside it.
    const money = Math.round(p.money);
    if (this.lastMoney !== undefined && money !== this.lastMoney) {
      const d = money - this.lastMoney;
      q.money.classList.remove('bump-up', 'bump-down');
      void q.money.offsetWidth;
      q.money.classList.add(d > 0 ? 'bump-up' : 'bump-down');
      if (Math.abs(d) >= 1) this.floatAtElement(q.money, `${d > 0 ? '+' : '−'}${fmtMoney(Math.abs(d))}`, 'money');
    }
    this.lastMoney = money;
    q.money.textContent = fmtMoney(p.money);
    const pts = p.attributePoints + p.skillPoints;
    q.points.classList.toggle('hidden', pts <= 0);
    q.points.textContent = t('ui.points_available', { n: pts });
    q.health.style.width = `${p.health}%`;
    q.energy.style.width = `${p.energy}%`;
    q.hunger.style.width = `${p.hunger}%`;
    q.healthRow.classList.toggle('low', p.health < 30);
    q.energyRow.classList.toggle('low', p.energy < BALANCE.needs.lowThreshold);
    q.hungerRow.classList.toggle('low', p.hunger < BALANCE.needs.lowThreshold);
    q.healthVal.textContent = Math.round(p.health);
    q.energyVal.textContent = Math.round(p.energy);
    q.hungerVal.textContent = Math.round(p.hunger);
    // The dock shows which screen is open.
    const open = this.panel?.id;
    const info = !!this.scene.overlay?.info;
    if (this.dockOpen !== open || this.dockInfo !== info) {
      this.dockOpen = open;
      this.dockInfo = info;
      for (const b of this.dockEl.querySelectorAll('.dock-btn')) b.classList.toggle('active', b.dataset.open === open || (b.dataset.open === 'info' && info));
    }
    this.renderHotbar();

    q.clock.textContent = time.clockString();
    const date = t('ui.date_hud', { day: time.dayOfSeason, season: t(`season.${time.season}`), weekday: t(`weekday.${time.weekday}`) });
    if (q.date.textContent !== date) {
      q.date.textContent = date;
      this.hudRight.dataset.tip = `<div class='tip-title'>${escapeHtml(t('ui.date_long', { day: time.dayOfSeason, season: t(`season.${time.season}`), weekday: t(`weekday.${time.weekday}`), year: time.year }))}</div>`;
    }
    // The weather, and what the season's doing: snow lying, the fire at home, the river up, the thaw.
    const ss = sim.seasons?.summary();
    const extra = [];
    if (ss?.snow >= 10) extra.push(t('ui.snow_depth', { n: ss.snow }));
    if (ss?.flooding) extra.push(t('ui.river_up'));
    else if (ss?.thaw) extra.push(t('ui.thaw'));
    if (ss?.season === 'winter' && ss.woodNights !== Infinity) extra.push(ss.heated ? t('ui.fire_lit', { n: ss.woodNights }) : t('ui.fire_out'));
    // Night swaps the sun for the moon.
    const night = time.hour >= 21 || time.hour < 5;
    const wico = sim.weather.type === 'sunny' && night ? '🌙' : WEATHER_ICONS[sim.weather.type] || '';
    if (q.wicon.textContent !== wico) q.wicon.textContent = wico;
    const wname = t(`weather.${sim.weather.type}`);
    if (q.weather.textContent !== wname) q.weather.textContent = wname;
    const deg = sim.seasons ? sim.seasons.temperature() : null;
    const temp = deg === null ? '' : t('ui.temp_c', { n: deg });
    if (q.temp.textContent !== temp) q.temp.textContent = temp;
    this.hudRight.classList.toggle('cold', deg !== null && deg <= 0);
    const xtext = extra.join(' · ');
    if (q.wextra.textContent !== xtext) q.wextra.textContent = xtext;
    q.wextra.classList.toggle('hidden', !xtext);
    this.updateLandChip();
    this.updateFollow();

    const obj = sim.jobs.objective();
    delete this.objectiveEl.dataset.guide;
    if (obj) {
      const job = sim.jobs.active;
      this.setObjective(`📋 ${escapeHtml(t(`job.${job.jobId}.name`))}`, `${escapeHtml(tr(sim, obj.key, obj.params))}`);
    } else {
      const req = sim.state.jobs.requests.find((r) => r.accepted);
      if (req) {
        const have = sim.inventory.count(req.item);
        this.setObjective(`🤝 ${escapeHtml(t('ui.favour'))}`, `${escapeHtml(tr(sim, 'objective.request', { npc: req.npcId, item: req.item, qty: req.qty, have }))}`);
      } else if (sim.freight?.objective()) {
        // A delivery you're carrying (or one waiting for you to pick up).
        const fo = sim.freight.objective();
        this.setObjective(`🛞 ${escapeHtml(t('freight.hud'))}`, `${escapeHtml(tr(sim, fo.key, fo.params))}`);
      } else if (sim.contracts.objective()) {
        // A contract you're following ("Go to job"): what to do next, and where.
        const co = sim.contracts.objective();
        this.setObjective(`📜 ${escapeHtml(t(`contract.kind.${co.contract.kind}`))}`, `${escapeHtml(tr(sim, co.key, co.params))}`);
      } else if (sim.guide?.objective()) {
        // The guide: the next step of "Getting started", something pressing, or your path's next milestone.
        const g = sim.guide.objective();
        const head = g.kind === 'step' ? `${g.step.icon} ${t('guide.hud_step', { n: sim.guide.progress().done, total: sim.guide.progress().total })} · ${t(`guide.step.${g.step.id}.name`)}` : g.kind === 'path' ? `🧭 ${t(`path.${sim.guide.S.path}.name`)}` : `${g.advice.icon} ${t('guide.next_title')}`;
        const extra = g.kind === 'path' ? ` (${g.progress.value}/${g.progress.target})` : '';
        this.objectiveEl.dataset.guide = '1';
        this.setObjective(`${escapeHtml(head)}`, `${escapeHtml(tr(sim, g.key, g.params))}${escapeHtml(extra)}`, `${escapeHtml(t('guide.hud_more'))}`);
      } else if (p.level === 1 && sim.state.stats.jobsCompleted === 0) {
        this.setObjective(`💡 ${escapeHtml(t('ui.tip'))}`, `${escapeHtml(t('objective.first_tip'))}`);
      } else {
        this.objectiveEl.classList.add('hidden');
      }
    }
  }

  // ------------------------------------------------------------------ toasts

  toast({ key, params, type, text }) {
    if (key && this.muted?.has(key)) return;
    this.toastText(text ?? tr(this.sim, key, params), type, key || '');
  }

  /** Leave these toasts out for the rest of this moment (a card says it all). */
  mute(keys) {
    this.muted = new Set(keys);
    queueMicrotask(() => (this.muted = null));
  }

  /**
   * A notification card: an icon and a title, a few short lines, and buttons to go and see.
   * kind: good · warn · danger · info. actions: [{ label, ico, run }]. sticky: stays until closed.
   */
  notify({ kind = 'info', ico = '', title, lines = [], actions = [], sticky = false, ms = 7000 }) {
    const el = document.createElement('div');
    el.className = `toast toast-card toast-${kind}${sticky ? ' sticky' : ''}`;
    el.innerHTML = `<span class="t-ico">${ico}</span><div class="tc-body"><div class="tc-title">${escapeHtml(title)}</div>${lines.map((l) => `<div class="tc-line">${l}</div>`).join('')}${actions.length ? `<div class="tc-actions">${actions.map((a, i) => `<button class="btn sm" data-n="${i}">${a.ico ? `<span class="b-ico">${a.ico}</span>` : ''}${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    el.style.pointerEvents = 'auto';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (b) actions[Number(b.dataset.n)]?.run();
      el.remove();
    });
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
    play(kind === 'danger' || kind === 'warn' ? 'warn' : 'good');
    if (!sticky) {
      el.fadeTimer = setTimeout(() => {
        el.classList.add('fade');
        setTimeout(() => el.remove(), 450);
      }, ms);
    }
    return el;
  }

  notifyContract(d) {
    const sim = this.sim;
    this.mute(['toast.contract_paid', 'toast.contract_done_xp', 'toast.contract_short', 'toast.contract_graded', 'toast.crew_xp']);
    const who = d.issuer ? npcName(sim.npcs.byId(d.issuer)) : t('bcard.owner_village');
    const crew = Object.entries(d.workers || {}).map(([id, x]) => `${escapeHtml(npcName(sim.npcs.byId(id)))} <b>+${x.xp}</b>`);
    this.notify({
      kind: d.paid < d.due ? 'warn' : 'good',
      ico: '✅',
      title: t('note.contract_done'),
      lines: [
        `${escapeHtml(who)} · ${escapeHtml(t(`contract.kind.${d.kind}`))} · ${escapeHtml(t(`contract.grade.${d.grade}`))}`,
        `${escapeHtml(t('note.payment'))} <b class="money-text">+${fmtMoney(d.paid)}</b>${d.paid < d.due ? ` <span class="warn">(${escapeHtml(t('note.of', { money: fmtMoney(d.due) }))})</span>` : ''}`,
        `${escapeHtml(t('note.your_xp'))} <b class="xp-text">+${d.xp}</b>`,
        crew.length ? `${escapeHtml(t('note.worker_xp'))} ${crew.join(', ')}` : '',
      ].filter(Boolean),
      ms: 9000,
    });
  }

  notifyWorks(d) {
    const sim = this.sim;
    this.mute(['toast.works_done']);
    const b = sim.world.buildings[d.id];
    const level = d.job?.type === 'level';
    this.notify({
      kind: 'good',
      ico: level ? '⬆️' : '🏗️',
      title: t(level ? 'note.upgraded' : 'note.works_done'),
      lines: [`<b>${escapeHtml(buildingLabel(sim, d.id))}</b>`, level ? escapeHtml(t('note.level_from_to', { a: d.from, b: d.to })) : escapeHtml(tr(sim, `works.${d.job?.type}`, {}))].filter(Boolean),
      actions: b ? [{ label: t('bcard.locate'), ico: '🎯', run: () => this.scene.camDir?.lookAt(b.door.tx * 32 + 16, b.door.ty * 32 - 20) }] : [],
    });
  }

  /** A worker the watchdog had to put right — once an hour each, at most. */
  notifyStuck(d) {
    const sim = this.sim;
    // (a task that simply went away — the tree felled by someone else — is routine, not stuck)
    if (d.why === 'invalid') return;
    this.stuckSeen ??= {};
    if (sim.time.total - (this.stuckSeen[d.npcId] ?? -1e9) < 60) return;
    this.stuckSeen[d.npcId] = sim.time.total;
    const npc = sim.npcs.byId(d.npcId);
    if (!npc) return;
    this.notify({
      kind: 'warn',
      ico: '⚠️',
      title: t('note.stuck'),
      lines: [escapeHtml(t(`note.stuck_${d.why}`, { name: npcName(npc), gender: npc.gender }))],
      actions: [{ label: t('note.view_worker'), ico: '👁', run: () => this.scene.camDir?.follow(npc.id) }],
    });
  }

  openInventions() {
    this.openPanel(new InventionPanel(this));
  }
  openColony() {
    this.openPanel(new ColonyPanel(this));
  }

  /** A family proposes a match for one of your children. */
  notifyOffer(o) {
    const sim = this.sim;
    const head = sim.npcs.byId(o.head);
    const their = sim.npcs.byId(o.their);
    const child = sim.npcs.byId(o.child);
    if (!head || !their || !child) return;
    this.notify({
      kind: 'info',
      ico: '💌',
      title: t('fam.offer_title'),
      lines: [escapeHtml(t(head === their ? 'fam.offer_self' : 'fam.offer', { head: npcName(head), their: npcName(their), child: npcName(child) }))],
      actions: [
        { label: t('fam.accept'), ico: '💍', run: () => sim.dynasty.answer(o.id, true) },
        { label: t('fam.decline'), ico: '✖', run: () => sim.dynasty.answer(o.id, false) },
        { label: t('fam.tab'), ico: '🌳', run: () => this.openCharacter('family') },
      ],
      sticky: true,
    });
  }

  openCharacter(tab = 'main') {
    this.openPanel(new CharacterPanel(this));
    if (this.panel) {
      this.panel.tab = tab;
      this.renderPanel();
    }
  }

  /** A site of yours waiting for materials: what it's short of, and where it is. */
  notifyMaterials(c) {
    const sim = this.sim;
    if (!c || !sim.construction.isPlayers(c)) return;
    this.materialsSeen ??= {};
    if (sim.time.total - (this.materialsSeen[c.id] ?? -1e9) < 240) return;
    this.materialsSeen[c.id] = sim.time.total;
    const missing = Object.entries(sim.construction.missing(c)).map(([item, n]) => `${n} ${itemName(item)}`);
    if (!missing.length) return;
    const name = c.kind === 'works' ? buildingLabel(sim, c.target) : t(`buildable.${c.type}.name`);
    this.notify({
      kind: 'warn',
      ico: '📦',
      title: t('note.materials'),
      lines: [escapeHtml(t('note.materials_line', { name, list: missing.slice(0, 4).join(', ') }))],
      actions: [
        { label: t('note.locate'), ico: '🎯', run: () => this.scene.camDir?.lookAt((c.tx + c.w / 2) * 32, (c.ty + c.h / 2) * 32) },
        { label: t('bcard.view_missing'), ico: '📋', run: () => this.openSite(c.id) },
      ],
      ms: 10000,
    });
  }

  /**
   * A notification: an icon, a short line, gone after a few seconds — except danger,
   * which stays until you click it. The same message twice in a row just counts up.
   */
  toastText(text, type = 'info', key = '') {
    const last = this.toastsEl.lastElementChild;
    if (last && last.dataset.text === text && !last.classList.contains('fade')) {
      last.dataset.n = String(Number(last.dataset.n || 1) + 1);
      last.querySelector('.t-text').textContent = `${text} ×${last.dataset.n}`;
      clearTimeout(last.fadeTimer);
      if (!last.classList.contains('sticky')) this.scheduleFade(last);
      return;
    }
    const el = document.createElement('div');
    const sticky = type === 'danger';
    el.className = `toast toast-${type}${sticky ? ' sticky' : ''}`;
    el.dataset.text = text;
    const TYPE_ICONS = { good: '✓', warn: '⚠️', danger: '⛔', event: '📣', gain: '💰', info: 'ℹ️' };
    const byKey = TOAST_ICONS.find(([re]) => re.test(key))?.[1];
    const ico = type === 'danger' || type === 'warn' ? TYPE_ICONS[type] : byKey || TYPE_ICONS[type] || 'ℹ️';
    el.innerHTML = `<span class="t-ico">${ico}</span><span class="t-text"></span>`;
    el.querySelector('.t-text').textContent = text;
    if (sticky) el.addEventListener('click', () => el.remove());
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 5) {
      const old = [...this.toastsEl.children].find((c) => !c.classList.contains('sticky')) || this.toastsEl.firstChild;
      old.remove();
    }
    if (!sticky) this.scheduleFade(el);
  }

  scheduleFade(el) {
    el.fadeTimer = setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 450);
    }, 3600);
  }

  // ------------------------------------------------------------------ tool hotbar

  /** Your tools, 1–9: the one in your hand is highlighted; durability shown as a bar (and ⚠ when nearly broken). */
  renderHotbar() {
    const inv = this.sim.inventory;
    const tools = inv.tools().slice(0, 9);
    const want = this.wantedTool || '';
    const key = tools.map((s) => `${s.id}:${s.dur}:${s.held ? 1 : 0}`).join('|') + want;
    if (key === this.hotbarKey) return;
    this.hotbarKey = key;
    this.hotbarTools = tools;
    this.hotbarEl.innerHTML = tools
      .map((s, i) => {
        const pct = (s.dur / inv.maxDurability(s)) * 100;
        const st = condState(pct);
        const wanted = want && ITEMS[s.id].tool.kind === want && !s.held;
        return `<div class="tool-slot${s.held ? ' selected' : ''}${wanted ? ' wanted' : ''}" data-slot="${i}" data-name="${escapeHtml(itemName(s.id))}" data-tip="${escapeHtml(itemTip(this.sim, s))}"><span class="key">${i + 1}</span>${icon(s.id, 30)}<span class="dur st-${st}"><i style="width:${Math.max(4, pct)}%"></i></span>${st === 'critical' ? '<span class="warn-mark">⚠️</span>' : ''}</div>`;
      })
      .join('');
  }

  /** Take the i-th tool of the hotbar in hand. */
  holdTool(i) {
    const s = this.hotbarTools?.[i];
    if (!s) return;
    this.sim.inventory.hold(s);
    this.renderHotbar();
    const el = this.hotbarEl.querySelector(`[data-slot="${i}"]`);
    el?.classList.add('flash');
    const p = this.scene.player;
    if (p) this.floatWorld(p.x, p.y - 56, `${icon(s.id, 18)}${escapeHtml(itemName(s.id))}`, 'xp', true);
  }

  /** The tool the thing in front of you would need (the hotbar hints at it). */
  setWantedTool(kind) {
    if (this.wantedTool === kind) return;
    this.wantedTool = kind;
    this.renderHotbar();
  }

  // ------------------------------------------------------------------ tooltips

  onTipOver(e) {
    const a = e.target.closest?.('[data-tip]');
    if (!a || a === this.tipAnchor) return;
    this.tipAnchor = a;
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => {
      if (this.tipAnchor !== a || !a.isConnected) return;
      this.tipEl.innerHTML = a.dataset.tip;
      this.tipEl.classList.add('show');
      this.placeTip();
    }, 220);
  }

  moveTip(e) {
    const s = uiScale();
    this.tipPos = { x: e.clientX / s, y: e.clientY / s };
    if (this.tipEl.classList.contains('show')) {
      if (this.tipAnchor && !this.tipAnchor.isConnected) this.hideTip();
      else this.placeTip();
    }
  }

  placeTip() {
    const s = uiScale();
    const { x, y } = this.tipPos || { x: 0, y: 0 };
    const w = this.tipEl.offsetWidth;
    const h = this.tipEl.offsetHeight;
    const W = window.innerWidth / s;
    const H = window.innerHeight / s;
    // Always on screen: flipped left / above the pointer near the edges.
    const left = x + 14 + w > W - 8 ? x - w - 10 : x + 14;
    const top = y + 18 + h > H - 8 ? y - h - 10 : y + 18;
    this.tipEl.style.left = `${Math.max(8, Math.min(W - w - 8, left))}px`;
    this.tipEl.style.top = `${Math.max(8, Math.min(H - h - 8, top))}px`;
  }

  hideTip() {
    clearTimeout(this.tipTimer);
    this.tipAnchor = null;
    this.tipEl.classList.remove('show');
  }

  // ------------------------------------------------------------------ floating feedback

  /** Screen position (in UI pixels) of a point in the world. */
  worldToScreen(x, y) {
    const cam = this.scene.cameras.main;
    const s = uiScale();
    return { x: ((x - cam.worldView.x) * cam.zoom) / s, y: ((y - cam.worldView.y) * cam.zoom) / s };
  }

  /** "+3 Wood", "+25 XP": floats up from a spot in the world and fades. */
  floatWorld(x, y, html, cls = 'gain', isHtml = false) {
    const p = this.worldToScreen(x, y);
    this.floatAt(p.x, p.y, html, cls, isHtml);
  }

  floatAtElement(el, text, cls) {
    const r = el.getBoundingClientRect();
    const s = uiScale();
    // Just under it (the money sits at the screen's top edge), drifting up towards it.
    this.floatAt((r.left + r.width / 2) / s, r.bottom / s + 34, escapeHtml(text), cls, true);
  }

  floatAt(x, y, html, cls, isHtml) {
    // Several at once stack instead of piling up on each other.
    const now = performance.now();
    this.floatStack = now - (this.floatTime || 0) < 350 ? (this.floatStack || 0) + 1 : 0;
    this.floatTime = now;
    const el = document.createElement('div');
    el.className = `float-num ${cls}`;
    if (isHtml) el.innerHTML = html;
    else el.textContent = html;
    el.style.left = `${x}px`;
    el.style.top = `${y - this.floatStack * 18}px`;
    this.floatEl.appendChild(el);
    setTimeout(() => el.remove(), 1350);
    while (this.floatEl.children.length > 14) this.floatEl.firstChild.remove();
  }

  showLevelUp({ level, newJobs, newUnlocks = [], newTitle }) {
    const lines = [`<span class="lu-from">${escapeHtml(t('levelup.from_to', { a: level - 1, b: level }))}</span>`, escapeHtml(t('levelup.points', { a: BALANCE.progression.attributePointsPerLevel, s: BALANCE.progression.skillPointsPerLevel }))];
    if (newTitle) lines.push(escapeHtml(t('levelup.title', { title: t(`title.${newTitle}`) })));
    for (const u of newUnlocks) lines.push(escapeHtml(`🔓 ${t(`unlock.${u}.name`)}`));
    for (const j of newJobs) lines.push(escapeHtml(t('levelup.job', { job: t(`job.${j}.name`) })));
    this.levelUpEl.innerHTML = `<div class="lu-star">★</div><div class="lu-title">${escapeHtml(t('levelup.heading', { level }))}</div>${lines.map((l) => `<div class="lu-line">${l}</div>`).join('')}<div class="lu-hint">${escapeHtml(t('levelup.hint'))}</div>`;
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
    const icons = { sleep: '🌙', work: '🛠️', passout: '💫', collapse: '🩹', travel: '🧭', own_shift: '🏪', exploring: '🔦', journey: '🐎', study_class: '📚', study_tutor: '📖', study_beside: '⚒️', study_teach: '🧑‍🏫', study_read: '📖', study_university: '🎓', family_teach: '🧑‍🏫', family_work: '🔨', family_play: '🪁', inventing: '💡' };
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
    if (s.kind === 'inventing') {
      const r = this.sim.inventions.race();
      this.statusEl.innerHTML = `<div class="st-card"><div class="st-icon">💡</div><div class="st-title">${escapeHtml(tr(this.sim, 'status.inventing', { invention: s.data.invention }))}</div><div class="st-clock">${this.sim.time.clockString()}</div>${r ? `<div class="st-bar"><div class="fill" style="width:${r.you}%"></div></div>` : ''}</div>`;
      return;
    }
    if (s.kind.startsWith('family_')) {
      this.statusEl.innerHTML = `<div class="st-card"><div class="st-icon">${icons[s.kind] || ''}</div><div class="st-title">${escapeHtml(tr(this.sim, `status.${s.kind}`, { npc: s.data.npc, skill: s.data.skill || undefined }))}</div><div class="st-clock">${this.sim.time.clockString()}</div></div>`;
      return;
    }
    const title = s.kind === 'exploring' ? tr(this.sim, 'status.exploring', { site: s.data.site }) : s.kind === 'own_shift' ? tr(this.sim, 'status.own_shift', { building: s.data.building }) : s.kind === 'work' ? tr(this.sim, 'status.work', { job: s.data.job }) : s.kind === 'travel' ? tr(this.sim, 'status.travel', { region_name: s.data.region }) : s.kind.startsWith('study_') ? tr(this.sim, `status.${s.kind}`, s.data) : t(`status.${s.kind}`);
    this.statusEl.innerHTML = `<div class="st-card"><div class="st-icon">${icons[s.kind] || ''}</div><div class="st-title">${escapeHtml(title)}</div><div class="st-clock">${this.sim.time.clockString()}</div>${pct}</div>`;
  }

  // ------------------------------------------------------------------ context menu

  /**
   * The menu of things to do at something (1–9, E for the first). With a card ({ head, body, foot },
   * e.g. ui/buildingCard.js) it's the building card: what it is and what's going on, then the actions,
   * then buttons for the bigger screens (data-cmd → onCmd).
   */
  openContextMenu({ title, actions, x, y, card = null, onCmd = null }) {
    this.menu = { actions, onCmd };
    this.contextEl.classList.toggle('bcard', !!card);
    this.contextEl.innerHTML =
      (card ? `${card.head}<div class="bc-body">${card.body}</div>${actions.length ? `<div class="bc-sub bc-do">${escapeHtml(t('bcard.do_here'))}</div>` : ''}` : `<div class="cm-title">${escapeHtml(title)}</div>`) +
      actions
        .map(
          (a, i) =>
            `<div class="cm-opt${a.disabled ? ' disabled' : ''}" data-index="${i}"><kbd>${i + 1}</kbd><span class="cm-label">${escapeHtml(a.label)}</span>${a.disabled ? `<span class="cm-reason">${escapeHtml(a.reason)}</span>` : ''}</div>`,
        )
        .join('') +
      (card?.foot ? `<div class="bc-foot">${card.foot}</div>` : '') +
      `<div class="cm-hint">${escapeHtml(t(card ? 'bcard.hint' : 'ui.context_hint'))}</div>`;
    this.contextEl.classList.remove('hidden');
    const w = this.contextEl.offsetWidth;
    const h = this.contextEl.offsetHeight;
    const s = uiScale();
    const W = window.innerWidth / s;
    const H = window.innerHeight / s;
    let left = x / s - w / 2;
    let top = y / s - h - 6;
    // A card sits beside the building (not over it): to its right, or its left if there's no room.
    if (card) {
      left = x / s + 70 + w < W - 8 ? x / s + 70 : x / s - 70 - w;
      top = y / s - h / 3;
    }
    left = Math.max(8, Math.min(W - w - 8, left));
    // (a card never covers the clock and your money)
    const minTop = card ? this.rightCol.querySelector('.hud-row').getBoundingClientRect().bottom / s + 8 : 8;
    top = Math.max(minTop, Math.min(H - h - 8, top));
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
    this.endClosing();
    if (this.panel) this.closePanel(true);
    play('open');
    this.panel = panel;
    this.panelSeq = (this.panelSeq || 0) + 1;
    this.scene.player?.cancelAction();
    panel.onOpen();
    this.modalEl.classList.remove('hidden');
    this.renderPanel();
  }

  closePanel(quiet = false) {
    if (!this.panel) return;
    if (!quiet) play('close');
    const p = this.panel;
    this.panel = null;
    p.onClose();
    if (quiet) {
      this.endClosing();
      this.modalEl.classList.add('hidden');
      this.modalEl.innerHTML = '';
      return;
    }
    // A short fade (another panel opening meanwhile cuts it short).
    this.modalEl.classList.add('closing');
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.endClosing(true), 120);
  }

  /** Finish a closing fade now (and clear the screen if nothing opened since). */
  endClosing(clear = false) {
    clearTimeout(this.closeTimer);
    if (!this.modalEl.classList.contains('closing')) return;
    this.modalEl.classList.remove('closing');
    if (clear || !this.panel) {
      this.modalEl.classList.add('hidden');
      this.modalEl.innerHTML = '';
    }
  }

  renderPanel() {
    const p = this.panel;
    if (!p) return;
    this.hideTip();
    const old = this.modalEl.querySelector(`.panel.panel-${p.id}`);
    if (old && old.dataset.for === String(this.panelSeq)) {
      // The same screen, refreshed: only its contents change (no re-opening animation, scroll kept).
      const body = old.querySelector('.panel-body');
      const scroll = body.scrollTop;
      // Typing in a search box: it keeps its focus and caret through the refresh.
      const typing = document.activeElement?.dataset?.input && body.contains(document.activeElement) ? { key: document.activeElement.dataset.input, at: document.activeElement.selectionStart } : null;
      old.querySelector('.panel-title').innerHTML = p.title();
      body.innerHTML = p.render();
      body.scrollTop = scroll;
      if (typing) {
        const el = body.querySelector(`[data-input="${typing.key}"]`);
        if (el) {
          el.focus();
          if (el.setSelectionRange && typing.at !== null) el.setSelectionRange(typing.at, typing.at);
        }
      }
      p.afterRender?.(body);
      return;
    }
    this.modalEl.innerHTML = `
      <div class="panel panel-${p.id}" data-for="${this.panelSeq}">
        <div class="panel-head"><div class="panel-title">${p.title()}</div><button class="panel-close" data-action="close" title="${escapeHtml(t('ui.close'))} (Esc)">✕</button></div>
        <div class="panel-body">${p.render()}</div>
      </div>`;
    const body = this.modalEl.querySelector('.panel-body');
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
      affairs: () => new AffairsPanel(this),
      management: () => new ManagementPanel(this),
    };
    if (factories[id]) this.openPanel(factories[id]());
  }

  openDialogue(npcId) {
    this.openPanel(new DialoguePanel(this, npcId));
  }
  openInspect(npcId, tab = 'life') {
    this.openPanel(new InspectPanel(this, npcId, tab));
  }
  openSchool(buildingId, tab = 'overview') {
    this.openPanel(new SchoolPanel(this, buildingId, tab));
  }
  openInstitute(buildingId) {
    this.openPanel(new InstitutePanel(this, buildingId));
  }
  openStorage() {
    this.openPanel(new StoragePanel(this));
  }
  openLand(plotId) {
    this.openPanel(new LandPanel(this, plotId));
  }
  /** A neighbourhood ({ hood }) or a district ({ district }). */
  openPlace(place) {
    this.openPanel(new PlacePanel(this, place));
  }
  openBuild(tab = null) {
    this.openPanel(new BuildPanel(this, tab));
  }
  openSite(id) {
    this.openPanel(new SitePanel(this, id));
  }
  /** Workers: { focus: npcId } opens on that worker; { priorities: true } with their priorities showing. */
  openWorkers(opts = {}) {
    this.openPanel(new WorkersPanel(this, opts));
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
  openProperty(buildingId, tab = 'overview') {
    this.openPanel(new PropertyPanel(this, buildingId, tab));
  }
  openBusiness(id) {
    this.openPanel(new BusinessPanel(this, id));
  }
  openEnterprise(id, focus = null) {
    this.openPanel(new EnterprisePanel(this, id, focus));
  }
  /** Your equipment: { focus: eqId } · { lend: eqId } · { lendTo: npcId } · { depot: buildingId } · { shop: bizId }. */
  openEquipment(opts = {}) {
    this.openPanel(new EquipmentPanel(this, opts));
  }
  openJournal(tab = 'tasks') {
    this.openPanel(new JournalPanel(this, tab));
  }
  openOrders(opts = {}) {
    this.openPanel(new OrdersPanel(this, opts));
  }
  /** Your carting business: { tab: 'company' | 'deliveries' | 'caravans' }. */
  openFreight(opts = {}) {
    this.openPanel(new FreightPanel(this, opts));
  }
  /** Your farm animals: { shop: true } (at the farm) · { barn: buildingId }. */
  openLivestock(opts = {}) {
    this.openPanel(new LivestockPanel(this, opts));
  }
  /** The railway station: timetable, sending and ordering goods by rail, the goods yard. */
  openStation(opts = {}) {
    this.openPanel(new StationPanel(this, opts));
  }
  /** Your business rival: what they're up to, and what you can do about it. */
  openRival() {
    this.openPanel(new RivalPanel(this));
  }
  /** A story scene (StorySystem): what's happening, and your choice. */
  openStory(id) {
    this.openPanel(new StoryPanel(this, id));
  }
  /** The town meeting: the proposal, how the valley leans, your say. */
  openMeeting() {
    this.openPanel(new MeetingPanel(this));
  }

  /** Translate with id-params resolved (used by world-space text like build hints). */
  tr(key, params = {}) {
    return tr(this.sim, key, params);
  }

  showBuildHint(type) {
    const tile = ['road', 'pave', 'bridge', 'lamp'].includes(type);
    const name = t(`buildable.${type}.name`);
    this.buildHintEl.innerHTML = `🔨 ${escapeHtml(t('ui.placing', { name }))} <span class="muted">${escapeHtml(t(type === 'road' ? 'ui.road_hint' : tile ? 'ui.tile_tool_hint' : 'ui.place_hint'))}</span> <button class="btn" data-cancel-build>${escapeHtml(t('ui.cancel'))}</button>`;
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
      else if (!this.panel && this.scene.camDir?.mode !== 'player') this.scene.camDir.back();
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
      // Out in the world: 1–9 take a tool in hand.
      if (!this.scene.inside) this.holdTool(i);
      return;
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
    const panelKeys = { KeyI: 'inventory', KeyC: 'character', KeyJ: 'journal', KeyM: 'map', KeyK: 'workers', KeyL: 'affairs', Tab: 'management' };
    // (Tab would otherwise move the browser's focus)
    if (code === 'Tab') e.preventDefault();
    if (panelKeys[code]) {
      this.closeContextMenu();
      this.togglePanel(panelKeys[code]);
      return;
    }
    if (code === 'KeyQ' && !this.panel && !this.menu) this.quickEat();
    // V: info mode — labels over every site, store, job and worker in view.
    if (code === 'KeyV' && !this.panel && !this.menu) this.toggleInfo();
    if (code === 'KeyB' && !this.menu) {
      if (this.panel?.id === 'build') this.closePanel();
      else if (!this.scene.inside) this.openBuild();
    }
  }

  toggleInfo() {
    const on = this.scene.overlay?.toggle();
    this.dockEl.querySelector('[data-open="info"]')?.classList.toggle('active', !!on);
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
    this.landKey = null;
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
