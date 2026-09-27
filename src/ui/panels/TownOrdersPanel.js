/**
 * Orders from the towns you know (TownOrderSystem): what's wanted, how much, what it pays, by when — take one
 * on, and hand over what you're carrying here at the hall (each load is paid as you bring it; finishing in
 * time earns the bonus).
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, dateString } from '../format.js';
import { button, icon, progress } from '../widgets.js';

export class TownOrdersPanel extends Panel {
  constructor(ui, atHall = false) {
    super(ui);
    this.atHall = atHall;
  }
  get id() {
    return 'town_orders';
  }
  title() {
    return `📜 ${escapeHtml(t('orders_town.title'))}`;
  }

  render() {
    const sim = this.sim;
    const O = sim.townOrders;
    const list = O.S.list.slice().reverse();
    if (!list.length) return `<div class="muted">${escapeHtml(t('orders_town.none'))}</div><div class="hint">${escapeHtml(t('orders_town.hint'))}</div>`;
    const card = (o) => {
      const town = t(`settlement_name.${o.town}`);
      const state = o.done ? t('orders_town.done') : o.failed ? t('orders_town.failed') : o.taken ? t('orders_town.taken') : t('orders_town.open');
      const daysLeft = o.deadline - sim.time.day;
      const take = !o.taken && !o.done && !o.failed ? button(t('orders_town.take'), 'take', { id: o.id }, { cls: 'primary sm' }) : '';
      const chk = O.canDeliver(o);
      const deliver = o.taken && !o.done && !o.failed && this.atHall ? button(t('orders_town.deliver', { n: Math.min(O.left(o), sim.inventory.count(o.item)) }), 'deliver', { id: o.id }, { cls: 'primary sm', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) }) : '';
      return `<div class="job-card${o.done || o.failed ? ' unavailable' : ''}">
        <div class="job-top"><div class="job-name">${icon(o.item, 24)} ${escapeHtml(t('orders_town.line', { town, qty: o.qty, item: itemName(o.item) }))}</div>
        <div class="job-pay">💰 ${escapeHtml(fmtMoney(o.perUnit))} ${escapeHtml(t('orders_town.each'))} · +${escapeHtml(fmtMoney(o.bonus))} ${escapeHtml(t('orders_town.bonus'))}</div></div>
        ${progress((o.delivered / o.qty) * 100, { label: state, value: `${o.delivered}/${o.qty}`, kind: o.failed ? 'danger' : o.done ? '' : 'info' })}
        <div class="muted small">${escapeHtml(t('orders_town.by', { date: dateString(o.deadline), n: Math.max(0, daysLeft) }))}</div>
        <div class="btn-row">${take}${deliver}</div>
      </div>`;
    };
    return `${list.map(card).join('')}
      ${this.atHall ? '' : `<div class="muted small">${escapeHtml(t('orders_town.bring_to_hall'))}</div>`}
      <div class="hint">${escapeHtml(t('orders_town.hint'))}</div>`;
  }

  onAction(action, data) {
    const O = this.sim.townOrders;
    let r = null;
    if (action === 'take') r = O.take(Number(data.id));
    else if (action === 'deliver') {
      r = O.deliver(Number(data.id));
      if (r.ok) this.sim.toast(r.finished ? 'toast.town_order_done' : 'toast.town_order_part', { qty: r.n, money: r.pay }, 'good');
    }
    if (r && !r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
  }
}
