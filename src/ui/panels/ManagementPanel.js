/**
 * Management center (Tab) — for when you own a lot: everything of yours at a glance, section by
 * section, each with the numbers that matter and a searchable list, and a way to go and see.
 *
 *   Workers 24 · 18 working · 3 idle · 2 on the way · 1 waiting        → the Workers screen
 *   Buildings 32 · 24 in use · 4 works · 2 damaged · 2 being built      → each one: show, inspect
 *   Jobs · Equipment · Storage · Money · Land
 *
 * It only reads (WorkerSystem, PropertySystem, ContractSystem, EquipmentSystem, HomeSystem, LedgerSystem,
 * TerritorySystem) and hands you on to the screens and the world — it never replaces them.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, parcelName } from '../format.js';
import { button, iconButton, tabs, stat, statGrid, searchBox, emptyState, status, condBar, icon } from '../widgets.js';
import { statusGroup, GROUPS, GROUP_ICONS } from '../workerCard.js';
import { buildingActivity, buildingIcon } from '../buildingCard.js';
import { contractCard, contractAction } from '../contracts.js';

const SECTIONS = [
  ['overview', '🧭'],
  ['workers', '👷'],
  ['buildings', '🏠'],
  ['jobs', '📜'],
  ['equipment', '🛒'],
  ['storage', '📦'],
  ['economy', '💰'],
  ['territory', '🏞️'],
];

export class ManagementPanel extends Panel {
  constructor(ui, tab = 'overview') {
    super(ui);
    this.tab = tab;
    this.q = '';
  }
  get id() {
    return 'management';
  }
  title() {
    return `🧭 ${escapeHtml(t('mgmt.title'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0 && document.activeElement?.tagName !== 'SELECT') {
      this.timer = 1500;
      this.ui.renderPanel();
    }
  }

  onInput(key, value) {
    if (key === 'search') this.q = value;
  }

  // ------------------------------------------------------------------ the numbers

  workersFacts() {
    const sim = this.sim;
    const list = sim.workers.list();
    const n = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    for (const c of list) n[statusGroup(sim, c)]++;
    return { total: list.length, ...n, payroll: list.reduce((s, c) => s + c.salary, 0) };
  }

  myBuildings() {
    const sim = this.sim;
    return Object.entries(sim.property.all)
      .filter(([id, r]) => r.owner === 'player' && sim.world.buildings[id])
      .map(([id, r]) => ({ id, r }));
  }

  buildingsFacts() {
    const sim = this.sim;
    const list = this.myBuildings();
    const works = list.filter(({ id }) => sim.structures?.works(id)).length;
    const damaged = list.filter(({ r }) => (r.condition ?? 100) < 40 || r.ruined).length;
    const sites = sim.construction.sites().filter((c) => c.status === 'site' && c.kind === 'building' && sim.construction.isPlayers(c)).length;
    return { total: list.length, ok: list.length - works - damaged, works, damaged, sites };
  }

  jobsFacts() {
    const sim = this.sim;
    const act = sim.state.contracts.active;
    return { active: act.length, risk: act.filter((c) => sim.contracts.atRisk?.(c)).length, crewed: act.filter((c) => (c.workers || []).length).length, done: sim.state.contracts.done || 0 };
  }

  storeTotals() {
    const m = new Map();
    for (const s of this.sim.home.storage) m.set(s.id, (m.get(s.id) || 0) + s.qty);
    return [...m].sort((a, b) => b[1] - a[1]);
  }

  // ------------------------------------------------------------------ sections

  /** One tile per section: its headline numbers, and a click through. */
  overviewHtml() {
    const sim = this.sim;
    const w = this.workersFacts();
    const b = this.buildingsFacts();
    const j = this.jobsFacts();
    const E = sim.equipment;
    const eq = E?.mine() || [];
    const store = this.storeTotals();
    const used = store.reduce((s, [, q]) => s + q, 0);
    const week = sim.ledger.summary(7);
    const land = sim.territory ? sim.territory.all().filter((q) => sim.territory.owner(q.id) === 'player') : [];
    const tile = (tab, ico, title, big, lines, warn = false) => `<button class="mg-tile${warn ? ' warn' : ''}" data-action="tab" data-tab="${tab}">
        <div class="mg-top"><span class="mg-ico">${ico}</span><span class="mg-title">${escapeHtml(title)}</span><b class="mg-big">${big}</b></div>
        <div class="mg-lines">${lines.filter(Boolean).map((l) => `<span>${l}</span>`).join('')}</div></button>`;
    return `<div class="mg-grid">
      ${tile('workers', '👷', t('mgmt.workers'), w.total, GROUPS.slice().reverse().filter((g) => w[g]).map((g) => `${GROUP_ICONS[g]} ${w[g]} ${escapeHtml(t(`wf.group_${g}`).toLowerCase())}`), w.stuck > 0)}
      ${tile('buildings', '🏠', t('mgmt.buildings'), b.total, [`✓ ${b.ok} ${escapeHtml(t('mgmt.in_use'))}`, b.works ? `🔨 ${b.works} ${escapeHtml(t('mgmt.upgrading'))}` : '', b.damaged ? `⚠️ ${b.damaged} ${escapeHtml(t('mgmt.damaged'))}` : '', b.sites ? `🏗️ ${b.sites} ${escapeHtml(t('mgmt.being_built'))}` : ''], b.damaged > 0)}
      ${tile('jobs', '📜', t('mgmt.jobs'), j.active, [`👷 ${j.crewed} ${escapeHtml(t('mgmt.with_crew'))}`, j.risk ? `⏰ ${j.risk} ${escapeHtml(t('mgmt.at_risk'))}` : '', `✓ ${j.done} ${escapeHtml(t('mgmt.done_ever'))}`], j.risk > 0)}
      ${tile('equipment', '🛒', t('mgmt.equipment'), eq.length, [`👷 ${eq.filter((e) => e.holder?.kind === 'worker').length} ${escapeHtml(t('mgmt.lent'))}`, `🔧 ${eq.filter((e) => ['damaged', 'broken'].includes(E.status(e))).length} ${escapeHtml(t('mgmt.need_repair'))}`])}
      ${tile('storage', '📦', t('mgmt.storage'), `${used}<small>/${sim.home.storageCapacity()}</small>`, store.slice(0, 3).map(([id, q]) => `${icon(id, 16)} ${q}`), used >= sim.home.storageCapacity() * 0.9)}
      ${tile('economy', '💰', t('mgmt.economy'), fmtMoney(Math.round(sim.state.player.money)), [`${escapeHtml(t('mgmt.week_in'))} <b class="good">+${fmtMoney(Math.round(week.income))}</b>`, `${escapeHtml(t('mgmt.week_out'))} <b class="neg">−${fmtMoney(Math.round(week.spending))}</b>`, `${escapeHtml(t('mgmt.payroll'))} ${fmtMoney(w.payroll)}/${escapeHtml(t('wcard2.day'))}`])}
      ${tile('territory', '🏞️', t('mgmt.territory'), land.length, [land.length ? `${escapeHtml(t('mgmt.land_worth'))} ${fmtMoney(Math.round(land.reduce((s, q) => s + sim.territory.price(q.id), 0)))}` : escapeHtml(t('mgmt.no_land'))])}
    </div>
    <div class="hint">${escapeHtml(t('mgmt.hint'))}</div>`;
  }

  workersHtml() {
    const w = this.workersFacts();
    return `${statGrid([stat(t('mgmt.workers'), String(w.total)), ...GROUPS.slice().reverse().filter((g) => w[g]).map((g) => stat(`${GROUP_ICONS[g]} ${t(`wf.group_${g}`)}`, String(w[g]), g === 'stuck' ? 'neg' : ''))])}
      <div class="btn-row">${button(t('mgmt.open_workers'), 'open_workers', {}, { cls: 'primary', ico: '👷', key: 'K' })}${button(t('map.layer_workers'), 'open_map', { layer: 'workers' }, { ico: '🗺️' })}</div>`;
  }

  buildingsHtml() {
    const sim = this.sim;
    const q = this.q.trim().toLowerCase();
    const rows = this.myBuildings()
      .filter(({ id }) => !q || buildingLabel(sim, id).toLowerCase().includes(q))
      .map(({ id, r }) => {
        const [kind, ico, words] = buildingActivity(sim, id);
        const lvl = sim.structures?.rec(id)?.lvl;
        return `<div class="mg-row">
          <span class="mg-row-ico">${buildingIcon(sim, id)}</span>
          <div class="mg-row-main"><b>${escapeHtml(buildingLabel(sim, id))}</b><span class="muted small">${lvl ? escapeHtml(t('bcard.level', { n: lvl, max: sim.structures.maxLevel(id) })) : ''} · ${fmtMoney(sim.property.value(id))}</span></div>
          ${status(words, kind, ico)}
          <div class="mg-cond">${condBar(r.condition ?? 100, { words: false })}</div>
          <div class="mg-row-btns">${iconButton('🎯', t('bcard.locate'), 'show_building', { id })}${iconButton('🔍', t('bcard.inspect'), 'inspect', { id })}</div>
        </div>`;
      });
    const f = this.buildingsFacts();
    return `${statGrid([stat(t('mgmt.buildings'), String(f.total)), stat(t('mgmt.in_use'), String(f.ok)), stat(t('mgmt.upgrading'), String(f.works)), stat(t('mgmt.damaged'), String(f.damaged), f.damaged ? 'neg' : ''), stat(t('mgmt.being_built'), String(f.sites))])}
      <div class="toolbar-row">${searchBox(this.q, t('mgmt.search_buildings'))}</div>
      ${rows.join('') || emptyState('🏠', t('mgmt.no_buildings'), t('mgmt.no_buildings_hint'))}`;
  }

  jobsHtml() {
    const sim = this.sim;
    const q = this.q.trim().toLowerCase();
    const list = sim.state.contracts.active.filter((c) => !q || t(`contract.kind.${c.kind}`).toLowerCase().includes(q) || String(c.id) === q);
    const j = this.jobsFacts();
    return `${statGrid([stat(t('mgmt.jobs'), String(j.active)), stat(t('mgmt.with_crew'), String(j.crewed)), stat(t('mgmt.at_risk'), String(j.risk), j.risk ? 'neg' : ''), stat(t('mgmt.done_ever'), String(j.done))])}
      <div class="toolbar-row">${searchBox(this.q, t('mgmt.search_jobs'))}${button(t('map.layer_jobs'), 'open_map', { layer: 'jobs' }, { ico: '🗺️', cls: 'sm' })}</div>
      ${list.map((c) => contractCard(sim, c, 'active')).join('') || emptyState('📜', t('mgmt.no_jobs'), t('mgmt.no_jobs_hint'))}`;
  }

  equipmentHtml() {
    const sim = this.sim;
    const E = sim.equipment;
    const eq = E?.mine() || [];
    return `${statGrid([stat(t('mgmt.equipment'), String(eq.length)), stat(t('mgmt.lent'), String(eq.filter((e) => e.holder?.kind === 'worker').length)), stat(t('mgmt.need_repair'), String(eq.filter((e) => ['damaged', 'broken'].includes(E.status(e))).length)), stat(t('equip.wear_cost'), fmtMoney(E?.totalWear() || 0))])}
      <div class="btn-row">${button(t('mgmt.open_equipment'), 'open_equipment', {}, { cls: 'primary', ico: '🛒' })}${button(t('map.layer_transport'), 'open_map', { layer: 'transport' }, { ico: '🗺️' })}</div>`;
  }

  storageHtml() {
    const sim = this.sim;
    const q = this.q.trim().toLowerCase();
    const store = this.storeTotals().filter(([id]) => !q || itemName(id).toLowerCase().includes(q));
    const used = this.storeTotals().reduce((s, [, n]) => s + n, 0);
    const cap = sim.home.storageCapacity();
    const base = sim.workers.baseBuilding();
    return `${statGrid([stat(t('mgmt.storage'), `${used} / ${cap}`, used >= cap * 0.9 ? 'neg' : ''), stat(t('mgmt.kinds'), String(this.storeTotals().length)), stat(t('mgmt.kept_at'), escapeHtml(buildingLabel(sim, base.id)))])}
      <div class="toolbar-row">${searchBox(this.q, t('mgmt.search_items'))}${iconButton('🎯', t('bcard.locate'), 'show_building', { id: base.id })}</div>
      <div class="mg-items">${store.map(([id, n]) => `<div class="mg-item">${icon(id, 22)}<span>${escapeHtml(itemName(id))}</span><b>${n}</b></div>`).join('') || emptyState('📦', t('mgmt.store_empty'))}</div>`;
  }

  economyHtml() {
    const sim = this.sim;
    const week = sim.ledger.summary(7);
    const all = sim.ledger.summary(Infinity);
    const worth = sim.ledger.netWorth();
    const w = this.workersFacts();
    return `${statGrid([stat(t('mgmt.cash'), fmtMoney(Math.round(sim.state.player.money))), stat(t('mgmt.worth'), fmtMoney(worth.total)), stat(t('mgmt.week_in'), `+${fmtMoney(Math.round(week.income))}`, 'pos'), stat(t('mgmt.week_out'), `−${fmtMoney(Math.round(week.spending))}`, 'neg'), stat(t('mgmt.week_net'), fmtMoney(Math.round(week.income - week.spending)), week.income >= week.spending ? 'pos' : 'neg'), stat(t('mgmt.payroll'), `${fmtMoney(w.payroll)}/${t('wcard2.day')}`)])}
      <div class="muted small">${escapeHtml(t('mgmt.all_time', { a: fmtMoney(Math.round(all.income)), b: fmtMoney(Math.round(all.spending)) }))}</div>
      <div class="btn-row">${button(t('mgmt.open_affairs'), 'open_affairs', {}, { cls: 'primary', ico: '💼', key: 'L' })}</div>`;
  }

  territoryHtml() {
    const sim = this.sim;
    const T2 = sim.territory;
    const land = T2 ? T2.all().filter((q) => T2.owner(q.id) === 'player') : [];
    const total = land.reduce((s, q) => s + T2.price(q.id), 0);
    return `${statGrid([stat(t('mgmt.parcels'), String(land.length)), stat(t('mgmt.tiles'), String(land.reduce((s, q) => s + (q.n || 0), 0))), stat(t('mgmt.land_worth'), fmtMoney(Math.round(total)))])}
      ${land.map((q) => `<div class="mg-row"><span class="mg-row-ico">🏞️</span><div class="mg-row-main"><b>${escapeHtml(this.parcelName(q.id))}</b><span class="muted small">${q.n || 0} ${escapeHtml(t('mgmt.tiles').toLowerCase())} · ${fmtMoney(Math.round(T2.price(q.id)))}</span></div><div class="mg-row-btns">${iconButton('🔍', t('bcard.inspect'), 'land', { id: q.id })}</div></div>`).join('') || emptyState('🏞️', t('mgmt.no_land'), t('mgmt.no_land_hint'))}
      <div class="btn-row">${button(t('map.layer_ownership'), 'open_map', { layer: 'ownership' }, { ico: '🗺️' })}</div>`;
  }

  parcelName(id) {
    return parcelName(this.sim, id);
  }

  render() {
    const list = SECTIONS.map(([id, ico]) => [id, `${ico} ${t(`mgmt.tab_${id}`)}`]);
    const body = {
      overview: () => this.overviewHtml(),
      workers: () => this.workersHtml(),
      buildings: () => this.buildingsHtml(),
      jobs: () => this.jobsHtml(),
      equipment: () => this.equipmentHtml(),
      storage: () => this.storageHtml(),
      economy: () => this.economyHtml(),
      territory: () => this.territoryHtml(),
    }[this.tab]();
    return tabs(list, this.tab) + body;
  }

  onAction(action, data) {
    const sim = this.sim;
    const ui = this.ui;
    if (contractAction(sim, action, data)) return;
    if (action === 'tab') {
      this.tab = data.tab;
      this.q = '';
      return;
    }
    if (action === 'open_workers') return ui.openWorkers();
    if (action === 'open_equipment') return ui.openEquipment();
    if (action === 'open_affairs') return ui.togglePanel('affairs');
    if (action === 'open_map') {
      ui.togglePanel('map');
      if (ui.panel?.id === 'map') ui.panel._layer = data.layer;
      return;
    }
    if (action === 'inspect') return ui.openProperty(data.id);
    if (action === 'land') return ui.openLand(data.id);
    if (action === 'show_building') {
      const b = sim.world.buildings[data.id];
      if (b) sim.bus.emit('ui:look', { x: (b.tx + b.w / 2) * 32, y: b.ty * 32 });
    }
  }
}
