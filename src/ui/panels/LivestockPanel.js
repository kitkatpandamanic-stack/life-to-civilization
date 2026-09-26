/**
 * Your farm animals (LivestockSystem): the barns and who lives in each, how they are, what's waiting
 * to be collected; buying (at the village farm) and selling.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, emptyState, bar, notice, icon, statGrid, stat } from '../widgets.js';
import { LIVESTOCK, FARM } from '../../data/livestock.js';

export class LivestockPanel extends Panel {
  constructor(ui, opts = {}) {
    super(ui);
    this.shop = !!opts.shop;
    this.barn = opts.barn || null;
  }
  get id() {
    return 'livestock';
  }
  title() {
    return `🐄 ${escapeHtml(t(this.shop ? 'livestock.shop_title' : 'livestock.title'))}`;
  }

  render() {
    const sim = this.sim;
    const L = sim.livestock;
    const s = L.summary();
    let html = `<p class="muted">${escapeHtml(t('livestock.intro'))}</p>`;
    html += statGrid([
      stat(t('livestock.animals'), String(s.animals)),
      stat(t('livestock.barns'), String(s.barns)),
      stat(t('livestock.waiting'), String(s.waiting)),
      stat(t('livestock.eggs'), String(s.stats.egg || 0)),
      stat(t('livestock.milk'), String(s.stats.milk || 0)),
      stat(t('livestock.wool'), String(s.stats.wool || 0)),
    ]);
    // Buying (at the farm).
    if (this.shop) {
      html += `<h4>${escapeHtml(t('livestock.for_sale'))}</h4>`;
      for (const [kind, d] of Object.entries(LIVESTOCK)) {
        const chk = L.canBuy(kind);
        const g = d.gives;
        html += `<div class="card"><div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`animal.${kind}`))} · ${escapeHtml(fmtMoney(d.price))}</div>
          <div class="card-sub">${escapeHtml(t(g.every === 1 ? 'livestock.gives_day' : g.every === 7 ? 'livestock.gives_week' : 'livestock.gives', { n: g.n, item: itemName(g.item).toLowerCase(), every: g.every }))} · ${escapeHtml(t('livestock.eats', { n: d.feed }))} · ${escapeHtml(t('livestock.room', { n: d.space }))}</div></div></div>
          ${chk.ok ? '' : `<div class="small warn">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}
          <div class="btn-row">${button(t('livestock.buy'), 'buy', { kind }, { cls: 'primary sm', disabled: !chk.ok })}</div></div>`;
      }
    }
    const barns = L.barns();
    if (!barns.length) return html + emptyState('🏚️', t('livestock.no_barn'), t('livestock.no_barn_text'));
    // Winter: fodder.
    const need = L.feedPerDay();
    if (need && (sim.time.season === 'winter' || sim.time.season === 'autumn')) {
      const days = Math.floor(L.fodderStock() / need);
      html += notice(days < 7 ? 'warn' : 'info', escapeHtml(t('livestock.fodder', { n: L.fodderStock(), days })), '🌾');
    }
    for (const b of barns) {
      if (this.barn && b !== this.barn && !this.shop) continue;
      const animals = L.mine(b);
      const w = L.waiting(b);
      const waiting = Object.entries(w).map(([i, n]) => `${icon(i, 18)} ${n}`).join(' ');
      html += `<div class="card"><div class="card-head"><div class="card-icon">🏚️</div><div><div class="card-title">${escapeHtml(buildingLabel(sim, b))}</div>
        <div class="card-sub">${escapeHtml(t('livestock.room_used', { n: L.used(b), max: L.space(b) }))}${waiting ? ` · ${escapeHtml(t('livestock.to_collect'))} ${waiting}` : ''}</div></div></div>`;
      if (!animals.length) html += `<div class="muted small">${escapeHtml(t('livestock.empty_barn'))}</div>`;
      for (const a of animals) {
        const d = LIVESTOCK[a.kind];
        html += `<div class="kv"><span>${d.icon} ${escapeHtml(t(`animal.${a.kind}`))} <span class="muted small">${escapeHtml(t('livestock.days_old', { n: sim.time.day - a.bornDay }))}</span></span>
          <span class="btn-row">${bar(a.health, a.health >= FARM.producesAbove ? 'good' : 'warn', `${Math.round(a.health)}%`)}${button(t('livestock.sell', { money: fmtMoney(L.sellPrice(a)) }), 'sell', { id: a.id }, { cls: 'sm ghost' })}</span></div>`;
      }
      html += '</div>';
    }
    return html;
  }

  onAction(action, data) {
    const L = this.sim.livestock;
    const warn = (r) => !r.ok && this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    if (action === 'buy') warn(L.buy(data.kind));
    else if (action === 'sell') warn(L.sell(data.id));
  }
}
