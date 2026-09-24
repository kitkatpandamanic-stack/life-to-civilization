/**
 * Business — manage one of your businesses: the production chain, stock,
 * what to make, prices, supply options, the workers on it, and the books.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney, npcName } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { icon, button, tabs } from '../widgets.js';
import { PRICE_LEVELS } from '../../data/playerBusinesses.js';

export class BusinessPanel extends Panel {
  constructor(ui, bizId) {
    super(ui);
    this.bizId = bizId;
    this.tab = 'overview';
  }
  get id() {
    return 'business';
  }
  get biz() {
    return this.sim.businesses.get(this.bizId);
  }
  title() {
    return `🪚 ${escapeHtml(t(`business.${this.biz?.type}.name`))}`;
  }

  render() {
    const sim = this.sim;
    const B = sim.businesses;
    const biz = this.biz;
    if (!biz) return '';
    const type = B.type(biz);
    const list = [['overview', t('ui.biz_overview')], ['production', t('ui.biz_production')], ['books', t('ui.biz_books')]];
    let body = '';
    if (this.tab === 'overview') {
      const chain = [type.input, 'planks', 'chair', 'money'].map((i) => (i === 'money' ? `<span class="chain-step">💰 ${escapeHtml(t('stat.money'))}</span>` : `<span class="chain-step">${icon(i, 22)} ${escapeHtml(itemName(i))}</span>`)).join('<span class="chain-arrow">→</span>');
      const stock = [type.input, ...Object.keys(type.products)].map((i) => `<div class="stock-cell">${icon(i, 28)}<b>${B.stock(biz, i)}</b><span class="muted small">${escapeHtml(itemName(i))}</span></div>`).join('');
      const workers = sim.workers.list().filter((c) => c.assignment.type === 'workshop' && c.assignment.bizId === biz.id);
      body = `
        <div class="chain">${chain}</div>
        <div class="kv"><span>${escapeHtml(t('ui.status'))}</span><b>${escapeHtml(B.isOpen(biz) ? t('ui.biz_open') : t('ui.biz_closed'))}</b></div>
        <div class="kv"><span>${escapeHtml(t('ui.biz_reputation'))}</span><b>${biz.reputation}</b></div>
        <div class="kv"><span>${escapeHtml(t('ui.biz_today'))}</span><b>+${fmtMoney(biz.today.revenue)} / −${fmtMoney(biz.today.expenses)}</b></div>
        <h3>${escapeHtml(t('ui.biz_stock'))}</h3>
        <div class="stock-grid">${stock}</div>
        <h3>${escapeHtml(t('ui.biz_workers'))}</h3>
        ${workers.length ? workers.map((c) => `<div class="rumor">👷 ${escapeHtml(npcName(sim.npcs.byId(c.npcId)))} · ${Math.round(sim.workers.productivity(c.npcId) * 100)}%</div>`).join('') : `<div class="muted small">${escapeHtml(t('ui.biz_no_workers'))}</div>`}
        <div class="btn-row">
          ${button(t('ui.biz_deliver', { item: itemName(type.input), n: sim.inventory.count(type.input) }), 'deliver', {}, { disabled: !sim.inventory.count(type.input) })}
          ${button(t('ui.biz_take'), 'take', {})}
          ${button(t('ui.workers'), 'workers', {})}
        </div>`;
    } else if (this.tab === 'production') {
      body =
        `<div class="muted small">${escapeHtml(t('ui.biz_plan_hint'))}</div>` +
        Object.entries(type.products)
          .map(([id, def]) => {
            const plan = biz.plan[id];
            const inputs = Object.entries(def.inputs).map(([i, q]) => `${q} ${itemName(i)}`).join(', ');
            return `<div class="plan-row">
              ${icon(id, 28)}
              <div><b>${escapeHtml(itemName(id))}</b><div class="muted small">${escapeHtml(inputs)} · ${def.labor} ${escapeHtml(t('ui.hours_short'))} · ${escapeHtml(t('ui.biz_price', { money: fmtMoney(B.price(biz, id)) }))}</div></div>
              <div class="plan-ctrl">${escapeHtml(t('ui.biz_keep'))} <b>${plan.target}</b> ${button('−', 'target', { id, d: -1 })}${button('+', 'target', { id, d: 1 })}</div>
              ${button(plan.on ? t('ui.on') : t('ui.off'), 'toggle', { id }, { cls: plan.on ? 'primary' : '' })}
            </div>`;
          })
          .join('') +
        `<h3>${escapeHtml(t('ui.biz_pricing'))}</h3><div class="btn-row">${Object.keys(PRICE_LEVELS)
          .map((lv) => button(t(`price_level.${lv}`), 'price', { lv }, { cls: biz.priceLevel === lv ? 'primary' : '' }))
          .join('')}</div>
        <div class="muted small">${escapeHtml(t(`price_level_desc.${biz.priceLevel}`))}</div>
        <h3>${escapeHtml(t('ui.biz_options'))}</h3>
        <div class="btn-row">
          ${button(`${biz.autoBuy ? '☑' : '☐'} ${t('ui.biz_autobuy', { item: itemName(type.input) })}`, 'autobuy')}
          ${button(`${biz.sellSurplus ? '☑' : '☐'} ${t('ui.biz_surplus')}`, 'surplus')}
        </div>`;
    } else {
      const rows = [...biz.history].reverse();
      const total = rows.reduce((s, r) => s + r.revenue - r.expenses, 0);
      body = `<table class="books"><tr><th>${escapeHtml(t('ui.day'))}</th><th>${escapeHtml(t('ui.revenue'))}</th><th>${escapeHtml(t('ui.expenses'))}</th><th>${escapeHtml(t('ui.profit'))}</th></tr>
        <tr class="today"><td>${escapeHtml(t('ui.biz_today'))}</td><td>${fmtMoney(biz.today.revenue)}</td><td>${fmtMoney(biz.today.expenses)}</td><td>${fmtMoney(biz.today.revenue - biz.today.expenses)}</td></tr>
        ${rows.map((r) => `<tr><td>${escapeHtml(t('ui.day_n', { day: r.day + 1 }))}</td><td>${fmtMoney(r.revenue)}</td><td>${fmtMoney(r.expenses)}</td><td class="${r.revenue - r.expenses >= 0 ? 'pos' : 'neg'}">${fmtMoney(r.revenue - r.expenses)}</td></tr>`).join('')}
      </table>
      <div class="kv"><span>${escapeHtml(t('ui.biz_week_profit'))}</span><b class="${total >= 0 ? 'pos' : 'neg'}">${fmtMoney(total)}</b></div>
      <div class="kv"><span>${escapeHtml(t('ui.biz_total_revenue'))}</span><b>${fmtMoney(biz.totalRevenue)}</b></div>`;
    }
    return tabs(list, this.tab) + body;
  }

  onAction(action, data) {
    const B = this.sim.businesses;
    const biz = this.biz;
    if (!biz) return;
    switch (action) {
      case 'tab':
        this.tab = data.tab;
        break;
      case 'deliver':
        this.sim.toast('toast.delivered', { qty: B.deliverFromPockets(biz) }, 'gain');
        break;
      case 'take':
        this.sim.toast('toast.took_products', { qty: B.takeProducts(biz) }, 'gain');
        break;
      case 'workers':
        this.ui.openWorkers();
        break;
      case 'target':
        biz.plan[data.id].target = Math.max(0, Math.min(30, biz.plan[data.id].target + Number(data.d)));
        break;
      case 'toggle':
        biz.plan[data.id].on = !biz.plan[data.id].on;
        break;
      case 'price':
        biz.priceLevel = data.lv;
        break;
      case 'autobuy':
        biz.autoBuy = !biz.autoBuy;
        break;
      case 'surplus':
        biz.sellSurplus = !biz.sellSurplus;
        break;
    }
  }
}
