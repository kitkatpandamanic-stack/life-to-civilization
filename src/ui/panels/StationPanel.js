/**
 * The railway station (TrainSystem): when the next trains come, what's in the goods yard, and goods
 * by rail — send some from your storage to be sold in a town on the line, or order some from there.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, emptyState, tabs, icon, notice } from '../widgets.js';

const STEP = 10;

export class StationPanel extends Panel {
  constructor(ui, opts = {}) {
    super(ui);
    this.tab = opts.tab || 'timetable';
    this.to = null;
    this.cargo = {};
    this.qty = 10;
  }
  get id() {
    return 'station';
  }
  title() {
    return `🚉 ${escapeHtml(t('station.title'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  render() {
    const T = this.sim.trains;
    const lines = T.lines();
    if (!lines.length) return emptyState('🚉', t('station.no_lines'), t('station.no_lines_text'));
    if (!lines.includes(this.to)) this.to = lines[0];
    const list = [
      ['timetable', t('station.tab_timetable')],
      ['send', t('station.tab_send')],
      ['order', t('station.tab_order')],
    ];
    const pick = `<div class="btn-row wrap">${lines.map((id) => button(t(`settlement_name.${id}`), 'to', { v: id }, { cls: `sm ${this.to === id ? 'selected' : 'ghost'}` })).join('')}</div>`;
    const body = this.tab === 'send' ? pick + this.sendHtml() : this.tab === 'order' ? pick + this.orderHtml() : this.timetableHtml();
    return tabs(list, this.tab) + body;
  }

  timetableHtml() {
    const sim = this.sim;
    const T = sim.trains;
    const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    let html = `<p class="muted">${escapeHtml(t('station.intro'))}</p>`;
    for (const id of T.lines()) {
      const next = T.nextIn(id);
      html += `<div class="kv"><span>🚂 ${escapeHtml(t(`settlement_name.${id}`))} <span class="muted small">${T.times(id).map(hm).join(' · ')}</span></span><b>${escapeHtml(next === 0 ? t('station.now') : t('station.next_in', { h: Math.floor(next / 60), m: next % 60 }))}</b></div>`;
    }
    const yard = Object.entries(T.S.yard);
    html += `<h4>${escapeHtml(t('station.yard'))}</h4>`;
    html += yard.length ? `<div>${yard.map(([i, n]) => `${icon(i, 20)} ${escapeHtml(itemName(i))} ×${n}`).join(' · ')}</div><div class="btn-row">${button(t('station.collect'), 'collect', {}, { cls: 'sm' })}</div><div class="small muted">${escapeHtml(t('station.yard_hint'))}</div>` : `<div class="muted small">${escapeHtml(t('station.yard_empty'))}</div>`;
    const pending = [...T.S.orders.map((o) => tr(sim, 'station.order_line', { qty: o.qty, item: o.item, settlement: o.from })), ...T.S.sends.map((s) => tr(sim, s.stage === 'sold' ? 'station.send_sold' : 'station.send_line', { n: Object.values(s.cargo).reduce((a, b) => a + b, 0), settlement: s.to, money: fmtMoney(s.earned) }))];
    if (pending.length) html += `<h4>${escapeHtml(t('station.on_the_way'))}</h4>${pending.map((p) => `<div class="small">${escapeHtml(p)}</div>`).join('')}`;
    html += `<div class="small muted" style="margin-top:8px">${escapeHtml(t('station.arrivals', { n: T.S.arrivals }))}</div>`;
    return html;
  }

  sendHtml() {
    const sim = this.sim;
    const T = sim.trains;
    const S = sim.settlements;
    const stored = [...new Set(sim.home.storage.map((s) => s.id))].filter((i) => sim.home.storageCount(i) > 0);
    if (!stored.length) return emptyState('📦', t('station.nothing_to_send'), t('freight.storage_empty'));
    const units = Object.values(this.cargo).reduce((a, b) => a + b, 0);
    let worth = 0;
    let html = `<div class="small muted">${escapeHtml(t('station.send_hint'))}</div>`;
    for (const i of stored) {
      const n = this.cargo[i] || 0;
      const price = S.sellPrice(this.to, i, { player: false });
      worth += n * price;
      html += `<div class="kv"><span>${icon(i, 20)} ${escapeHtml(itemName(i))} <span class="muted small">(${sim.home.storageCount(i)} · ${escapeHtml(fmtMoney(price))}/1)</span></span>
        <span class="btn-row">${button('−', 'cargo', { i, d: -STEP }, { cls: 'sm ghost', disabled: !n })}<b class="num">${n}</b>${button('+', 'cargo', { i, d: STEP }, { cls: 'sm ghost', disabled: n >= sim.home.storageCount(i) })}</span></div>`;
    }
    const chk = T.canSend(this.to, this.cargo);
    html += `<div class="small">${escapeHtml(t('station.send_estimate', { money: fmtMoney(worth), fee: fmtMoney(T.fee(units)), n: S.days(this.to) * 2 }))}</div>`;
    if (!chk.ok && units) html += `<div class="small warn">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`;
    html += `<div class="btn-row">${button(t('station.send'), 'send', {}, { cls: 'primary', disabled: !chk.ok })}</div>`;
    return html;
  }

  orderHtml() {
    const sim = this.sim;
    const T = sim.trains;
    const S = sim.settlements;
    let html = `<div class="small muted">${escapeHtml(t('station.order_hint', { n: S.days(this.to) }))}</div>`;
    html += `<div class="btn-row">${[10, 25, 50, 100].map((q) => button(`×${q}`, 'qty', { q }, { cls: `sm ${this.qty === q ? 'selected' : 'ghost'}` })).join('')}</div>`;
    for (const item of Object.keys(S.def(this.to).produces)) {
      const chk = T.canOrder(this.to, item, this.qty);
      html += `<div class="kv"><span>${icon(item, 20)} ${escapeHtml(itemName(item))} <span class="muted small">${escapeHtml(t('station.in_stock', { n: Math.floor(S.get(this.to).stock[item] || 0) }))}</span></span>
        <span class="btn-row">${button(t('station.order', { money: fmtMoney(T.quote(this.to, item, this.qty)) }), 'order', { item }, { cls: 'sm', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</span></div>`;
    }
    return html + notice('info', escapeHtml(t('station.order_note')), '🚉');
  }

  onAction(action, data) {
    const sim = this.sim;
    const T = sim.trains;
    const warn = (r) => !r.ok && sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'to') {
      this.to = data.v;
      this.cargo = {};
    } else if (action === 'collect') T.collect();
    else if (action === 'qty') this.qty = Number(data.q);
    else if (action === 'cargo') {
      const n = Math.max(0, Math.min(sim.home.storageCount(data.i), (this.cargo[data.i] || 0) + Number(data.d)));
      if (n) this.cargo[data.i] = n;
      else delete this.cargo[data.i];
    } else if (action === 'send') {
      const r = T.send(this.to, this.cargo);
      warn(r);
      if (r.ok) this.cargo = {};
    } else if (action === 'order') warn(T.order(this.to, data.item, this.qty));
  }
}
