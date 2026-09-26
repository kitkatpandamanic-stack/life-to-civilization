/**
 * Equipment — your baskets, barrows, carts, wagons and horses: where each is, who has it, how
 * worn it is, what it holds; lend one to a worker or take it back, repair it, make it better,
 * choose where it's kept. Opened from a worker (lend them something), from a piece standing in
 * the world, from your transport depot (what's parked there, what's out, what needs repair) —
 * or at a shop that sells them.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, condBar, emptyState, filters, stat, statGrid, status, notice } from '../widgets.js';
import { EQUIPMENT, EQUIP } from '../../data/transport.js';
import { BUILDABLES } from '../../data/buildables.js';
import { WORKFORCE } from '../../data/workforce.js';

const STATUS_LOOK = {
  available: ['good', '✅'],
  assigned_player: ['info', '🙋'],
  assigned_worker: ['info', '👷'],
  assigned_building: ['neutral', '🏠'],
  in_use: ['info', '🚶'],
  damaged: ['warn', '⚠️'],
  broken: ['danger', '⛔'],
  under_repair: ['warn', '🔧'],
};

export class EquipmentPanel extends Panel {
  /** opts: { focus: eqId } · { lend: eqId } · { lendTo: npcId } · { depot: buildingId } · { shop: bizId } */
  constructor(ui, opts = {}) {
    super(ui);
    this.opts = opts;
    this.filter = 'all';
    this.lendOpen = opts.lend || null; // the piece whose "lend to…" list is open
  }
  get id() {
    return 'equipment';
  }
  title() {
    const o = this.opts;
    if (o.shop) return `🛒 ${escapeHtml(t('equip.shop_title', { building: buildingLabel(this.sim, this.sim.economy.biz(o.shop)?.building) }))}`;
    if (o.depot) return `🛞 ${escapeHtml(buildingLabel(this.sim, o.depot))}`;
    if (o.lendTo) return `🛒 ${escapeHtml(t('equip.lend_to_title', { name: npcName(this.sim.npcs.byId(o.lendTo)) }))}`;
    return `🛒 ${escapeHtml(t('equip.title'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  /** Where it is, in words: "with Ivan", "with you", "at the warehouse", "by Olga's house site". */
  whereText(eq) {
    const sim = this.sim;
    if (eq.at.kind === 'npc') return tr(sim, 'equip.where_npc', { npc: eq.at.id });
    if (eq.at.kind === 'player') return t('equip.where_you');
    if (eq.at.kind === 'away') return t('equip.where_away');
    const w = sim.equipment.whereName(eq);
    if (!w) return t('equip.where_ground');
    if (String(w).startsWith('site:')) return t('equip.where_site');
    return tr(sim, 'equip.where_at', { building: w });
  }

  /** "Given to": a worker, you, a building — or nobody (free to use). */
  holderText(eq) {
    const sim = this.sim;
    if (eq.holder?.kind === 'worker') return tr(sim, 'equip.holder_worker', { npc: eq.holder.id });
    if (eq.holder?.kind === 'building') return tr(sim, 'equip.holder_building', { building: eq.holder.id });
    if (eq.at.kind === 'player') return t('equip.holder_you');
    return t('equip.holder_none');
  }

  card(eq) {
    const sim = this.sim;
    const E = sim.equipment;
    const d = EQUIPMENT[eq.type];
    const st = E.status(eq);
    const [kind, ico] = STATUS_LOOK[st] || STATUS_LOOK.available;
    const info = E.info(eq);
    const cargo = eq.at.kind === 'npc' ? sim.npcs.byId(eq.at.id)?.carry : eq.cargo;
    const cargoN = cargo ? Object.values(cargo.items || { [cargo.item]: cargo.qty }).reduce((a, b) => a + b, 0) : 0;
    const cargoText = cargo ? Object.entries(cargo.items || { [cargo.item]: cargo.qty }).map(([id, q]) => `${q} ${t(`item.${id}.name`)}`).join(', ') : t('equip.empty');
    const rep = E.canRepair(eq.id);
    const up = E.canUpgrade(eq.id);
    const upCost = E.upgradeCost(eq);
    const repCost = E.repairCost(eq);
    const W = sim.workers;
    const lendList = this.lendOpen === eq.id
      ? `<div class="btn-row" style="margin-top:6px"><span class="hint">${escapeHtml(t('equip.lend_pick'))}</span>${W.list().map((c) => {
          const chk = E.canLend(eq.id, c.npcId);
          return button(npcName(sim.npcs.byId(c.npcId)), 'lend', { id: eq.id, npc: c.npcId }, { cls: 'sm', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) });
        }).join('') || `<span class="muted small">${escapeHtml(t('equip.no_workers'))}</span>`}</div>`
      : '';
    const keepOpts = [null, ...E.depots(), ...sim.construction.finished().filter((c) => BUILDABLES[c.type]?.effect?.storage && !BUILDABLES[c.type]?.effect?.depot).map((c) => c.id)];
    const keep = keepOpts.length > 1 ? `<div class="btn-row"><span class="hint">${escapeHtml(t('equip.keep_at'))}</span>${keepOpts.map((id) => button(id ? buildingLabel(sim, id) : t('equip.keep_default'), 'keep', { id: eq.id, b: id || '' }, { cls: `sm ${(eq.home || null) === id ? 'selected' : 'ghost'}` })).join('')}</div>` : '';
    const focus = this.opts.focus === eq.id ? ' selected' : '';
    return `<div class="card${focus}">
      <div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`equip.${eq.type}`))} ${escapeHtml(t('equip.lv', { n: eq.level || 1 }))}</div>
        <div class="card-sub">${status(t(`equip_status.${st}`), kind, ico)} ${eq.recall ? `<span class="small muted">${escapeHtml(t('equip.coming_back'))}</span>` : ''}</div></div>
        <div class="card-end small muted">${escapeHtml(t(`equip_tier.${d.tier}`))}</div></div>
      <div class="aff-row"><span>${escapeHtml(t('equip.condition'))}</span>${condBar(eq.condition)}</div>
      <div class="kv-grid small">
        <div>${escapeHtml(t('equip.owner'))}</div><div><b>${escapeHtml(t('equip.owner_you'))}</b></div>
        <div>${escapeHtml(t('equip.assigned'))}</div><div><b>${escapeHtml(this.holderText(eq))}</b></div>
        <div>${escapeHtml(t('equip.where'))}</div><div>${escapeHtml(this.whereText(eq))}</div>
        <div>${escapeHtml(t('equip.capacity'))}</div><div><b>${info.cap}</b> <span class="muted">${escapeHtml(t('equip.vs_hand', { n: WORKFORCE.carryLoad, x: Math.round((info.cap / WORKFORCE.carryLoad) * 10) / 10 }))}</span></div>
        <div>${escapeHtml(t('equip.speed'))}</div><div>${escapeHtml(t('equip.speed_line', { road: Math.round(d.road * 100), off: Math.round(d.offroad * 100) }))}</div>
        <div>${escapeHtml(t('equip.cargo'))}</div><div>${cargoN ? `<b>${cargoN} / ${info.cap}</b> · ` : ''}${escapeHtml(cargoText)}</div>
        <div>${escapeHtml(t('equip.used'))}</div><div>${escapeHtml(t('equip.used_line', { trips: info.trips, n: info.units }))}</div>
        ${d.minLevel ? `<div>${escapeHtml(t('equip.needs_level'))}</div><div>${d.minLevel}</div>` : ''}
      </div>
      <div class="btn-row" style="margin-top:6px">
        ${eq.holder?.kind === 'worker'
          ? button(t('equip.retrieve'), 'retrieve', { id: eq.id }, { cls: 'sm', disabled: !!eq.recall, title: t('equip.retrieve_tip') })
          : button(t('equip.lend'), 'lend_open', { id: eq.id }, { cls: `sm ${this.lendOpen === eq.id ? 'selected' : ''}`, disabled: !E.usable(eq) || !W.list().length })}
        ${eq.condition < 99 ? button(t('equip.repair', { money: fmtMoney(repCost.money), n: repCost.planks }), 'repair', { id: eq.id }, { cls: 'sm ghost', disabled: !rep.ok, title: rep.ok ? t('equip.repair_tip', { hours: repCost.hours }) : tr(sim, `reason.${rep.reason}`, rep.params || {}) }) : ''}
        ${(eq.level || 1) < EQUIP.maxLevel ? button(t('equip.upgrade', { money: fmtMoney(upCost.money), n: upCost.planks }), 'upgrade', { id: eq.id }, { cls: 'sm ghost', disabled: !up.ok, title: up.ok ? t('equip.upgrade_tip') : tr(sim, `reason.${up.reason}`, up.params || {}) }) : ''}
      </div>
      ${lendList}${keep}
    </div>`;
  }

  shopHtml(bizId) {
    const sim = this.sim;
    const E = sim.equipment;
    return E.forSale(bizId).map((o) => {
      const d = EQUIPMENT[o.type];
      const chk = E.canBuy(o.type, bizId);
      return `<div class="card"><div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`equip.${o.type}`))}</div>
        <div class="card-sub">${escapeHtml(t(`equip.desc_${d.kind}`))}</div></div><div class="card-end"><b>${fmtMoney(o.price)}</b></div></div>
        <div class="small">${escapeHtml(t('equip.shop_line', { cap: d.cap, x: Math.round((d.cap / WORKFORCE.carryLoad) * 10) / 10, road: Math.round(d.road * 100), off: Math.round(d.offroad * 100) }))}${d.minLevel ? ` · ${escapeHtml(t('equip.needs_level_n', { n: d.minLevel }))}` : ''}${d.upkeep ? ` · ${escapeHtml(t('equip.upkeep', { money: fmtMoney(d.upkeep) }))}` : ''}</div>
        <div class="btn-row">${button(t('equip.buy'), 'buy', { type: o.type }, { cls: 'sm primary', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div></div>`;
    }).join('') + `<div class="hint">${escapeHtml(t('equip.shop_hint'))}</div>`;
  }

  depotHtml(id) {
    const sim = this.sim;
    const E = sim.equipment;
    const y = E.atYard(id);
    const r = sim.structures?.rec(id);
    const bay = !!(r && r.lvl >= 2);
    const bad = y.here.filter((e) => E.damaged(e) || E.broken(e) || E.underRepair(e));
    return statGrid([
      stat(t('equip.parking'), `${y.here.length} / ${y.parking}`),
      stat(t('equip.out'), String(y.out.length)),
      stat(t('equip.needs_repair'), String(bad.length)),
      stat(t('equip.repair_bay'), t(bay ? 'ui.yes' : 'ui.no')),
    ]) + `<div class="hint">${escapeHtml(t(bay ? 'equip.bay_hint' : 'equip.no_bay_hint'))}</div>`;
  }

  render() {
    const sim = this.sim;
    const E = sim.equipment;
    const o = this.opts;
    if (o.shop) return this.shopHtml(o.shop);
    let html = '';
    if (o.depot) html += this.depotHtml(o.depot);
    let list = E.mine();
    if (o.lendTo) {
      const npc = sim.npcs.byId(o.lendTo);
      const cur = E.assignedTo(o.lendTo);
      html += `<div class="hint">${escapeHtml(t('equip.lend_to_hint', { name: npcName(npc) }))}</div>`;
      if (cur) html += notice('info', escapeHtml(tr(sim, 'equip.has_already', { eq: cur.type, npc: o.lendTo })));
      list = list.filter((e) => e.holder?.kind !== 'worker');
      if (!list.length) return html + emptyState('🛒', t('equip.none_free'), t('equip.none_hint'));
      return html + list.map((e) => {
        const chk = E.canLend(e.id, o.lendTo);
        return `<div class="setting-row"><div>${EQUIPMENT[e.type].icon} <b>${escapeHtml(t(`equip.${e.type}`))} ${escapeHtml(t('equip.lv', { n: e.level || 1 }))}</b> <span class="muted small">${Math.round(e.condition)}% · ${escapeHtml(t('equip.cap_n', { n: E.cap(e) }))} · ${escapeHtml(this.whereText(e))}</span></div>
          ${button(t('equip.lend'), 'lend', { id: e.id, npc: o.lendTo }, { cls: 'sm primary', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>`;
      }).join('');
    }
    if (!list.length) return html + emptyState('🛒', t('equip.none'), t('equip.none_hint'));
    const counts = {
      all: list.length,
      free: list.filter((e) => E.status(e) === 'available').length,
      out: list.filter((e) => e.holder?.kind === 'worker' || e.at.kind !== 'ground').length,
      damaged: list.filter((e) => ['damaged', 'broken', 'under_repair'].includes(E.status(e))).length,
    };
    if (!o.depot) {
      html += statGrid([stat(t('equip.owned'), String(counts.all)), stat(t('equip.lent_out'), String(list.filter((e) => e.holder?.kind === 'worker').length)), stat(t('equip.needs_repair'), String(counts.damaged)), stat(t('equip.wear_cost'), fmtMoney(E.totalWear()))]);
    }
    html += filters([['all', `${t('equip.f_all')} (${counts.all})`], ['free', `${t('equip.f_free')} (${counts.free})`], ['out', `${t('equip.f_out')} (${counts.out})`], ['damaged', `${t('equip.f_damaged')} (${counts.damaged})`]], this.filter);
    const shown = list.filter((e) => this.filter === 'all' || (this.filter === 'free' && E.status(e) === 'available') || (this.filter === 'out' && (e.holder?.kind === 'worker' || e.at.kind !== 'ground')) || (this.filter === 'damaged' && ['damaged', 'broken', 'under_repair'].includes(E.status(e))));
    // The piece asked about first.
    shown.sort((a, b) => (b.id === o.focus || b.id === o.lend ? 1 : 0) - (a.id === o.focus || a.id === o.lend ? 1 : 0));
    html += shown.map((e) => this.card(e)).join('') || `<div class="muted small">${escapeHtml(t('equip.none_filter'))}</div>`;
    html += `<div class="hint">${escapeHtml(t('equip.hint'))}</div>`;
    return html;
  }

  onAction(action, data) {
    const sim = this.sim;
    const E = sim.equipment;
    const say = (r, okKey, params) => sim.toast(r.ok ? okKey : `reason.${r.reason}`, r.ok ? params : r.params || {}, r.ok ? 'good' : 'warn');
    if (action === 'filter') this.filter = data.f;
    else if (action === 'lend_open') this.lendOpen = this.lendOpen === data.id ? null : data.id;
    else if (action === 'lend') {
      const r = E.lend(data.id, data.npc);
      say(r, 'toast.eq_lent', { eq: E.byId(data.id)?.type, npc: data.npc });
      if (r.ok) this.lendOpen = null;
      if (r.ok && this.opts.lendTo) this.ui.closePanel();
    } else if (action === 'retrieve') {
      const eq = E.byId(data.id);
      const npc = eq?.holder?.id;
      const r = E.retrieve(data.id);
      sim.toast(r.ok ? (r.returning ? 'toast.eq_returning' : 'toast.eq_back') : `reason.${r.reason}`, { npc, eq: eq?.type }, r.ok ? 'info' : 'warn');
    } else if (action === 'repair') {
      const r = E.repair(data.id);
      say(r, 'toast.eq_repairing', { eq: E.byId(data.id)?.type, hours: r.hours });
    } else if (action === 'upgrade') {
      const r = E.upgrade(data.id);
      say(r, 'toast.eq_upgraded', { eq: E.byId(data.id)?.type, n: E.byId(data.id)?.level });
    } else if (action === 'keep') E.keepAt(data.id, data.b || null);
    else if (action === 'buy') {
      const r = E.buy(data.type, this.opts.shop);
      say(r, 'toast.eq_bought', { eq: data.type, money: r.price });
    }
  }
}
