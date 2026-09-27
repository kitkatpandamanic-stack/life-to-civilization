/**
 * Market day's traders (CommunitySystem): what they've brought this week (rare things — glass, iron, gems,
 * saplings) and what they'll pay for your crafts and produce, better than the shops.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { button, icon, notice } from '../widgets.js';
import { COMMUNITY } from '../../systems/CommunitySystem.js';

export class MarketPanel extends Panel {
  get id() {
    return 'market';
  }
  title() {
    return `🧺 ${escapeHtml(t('market.title'))}`;
  }

  render() {
    const sim = this.sim;
    const C = sim.community;
    const M = COMMUNITY.market;
    if (!C.marketOpen()) {
      const d = C.daysToMarket();
      return `${notice('info', escapeHtml(d === 0 ? t('market.today_from', { from: M.from, to: M.to }) : t('market.next_in', { n: d, from: M.from })))}
        <div class="hint">${escapeHtml(t('market.traders_hint'))}</div>`;
    }
    const stock = C.traderStock();
    const sells = Object.entries(stock)
      .map(([item, n]) => `<div class="kv">${icon(item, 20)} <span>${escapeHtml(itemName(item))} <span class="muted small">×${n}</span></span><b>${escapeHtml(fmtMoney(C.traderPrice(item)))}</b>${button(t('market.buy'), 'buy', { item }, { cls: 'sm', disabled: n <= 0 || sim.state.player.money < C.traderPrice(item) })}</div>`)
      .join('');
    const mine = [...new Set(sim.inventory.slots.filter(Boolean).map((s) => s.id))].filter((id) => C.traderPays(id) > 0);
    const buys = mine
      .map((item) => `<div class="kv">${icon(item, 20)} <span>${escapeHtml(itemName(item))} <span class="muted small">×${sim.inventory.count(item)}</span></span><b>${escapeHtml(fmtMoney(C.traderPays(item)))}</b>${button(t('market.sell_one'), 'sell', { item, n: 1 }, { cls: 'sm' })}${button(t('market.sell_all'), 'sell', { item, n: 999 }, { cls: 'sm' })}</div>`)
      .join('');
    const wanted = COMMUNITY.marketBuys.map((i) => itemName(i)).join(', ');
    // Ordering for next market day, and what they've brought you.
    const ready = C.readyOrders();
    const readyHtml = ready
      .map((o) => {
        const chk = C.canCollect(o);
        return `<div class="kv">${icon(o.item, 20)} <span>${escapeHtml(itemName(o.item))} ×${o.qty}</span><b>${escapeHtml(t('market.to_pay', { money: fmtMoney(o.price * o.qty - o.paid) }))}</b>${button(t('market.collect'), 'collect', { id: o.id }, { cls: 'sm primary', disabled: !chk.ok })}</div>`;
      })
      .join('');
    const pending = C.S.traderOrders.filter((o) => !o.collected && !ready.includes(o));
    const pendingHtml = pending.map((o) => `<div class="small">⏳ ${escapeHtml(itemName(o.item))} ×${o.qty} · ${escapeHtml(t('market.next_market'))}</div>`).join('');
    const orderable = COMMUNITY.traderOrder.items
      .map((item) => `<div class="kv">${icon(item, 20)} <span>${escapeHtml(itemName(item))}</span><b>${escapeHtml(fmtMoney(C.traderOrderPrice(item)))}</b>${button('×5', 'order', { item, n: 5 }, { cls: 'sm' })}${button('×10', 'order', { item, n: 10 }, { cls: 'sm' })}</div>`)
      .join('');
    return `${notice('info', escapeHtml(t('market.open_until', { to: M.to })))}
      <h3>${escapeHtml(t('market.they_sell'))}</h3>${sells}
      <h3>${escapeHtml(t('market.they_buy'))}</h3>
      ${buys || `<div class="muted small">${escapeHtml(t('market.nothing_they_want'))}</div>`}
      <div class="muted small">${escapeHtml(t('market.wanted', { list: wanted }))}</div>
      ${readyHtml ? `<h3>${escapeHtml(t('market.brought_for_you'))}</h3>${readyHtml}` : ''}
      <h3>${escapeHtml(t('market.order_title'))}</h3>
      <div class="muted small">${escapeHtml(t('market.order_hint'))}</div>
      ${pendingHtml}
      ${orderable}
      <div class="hint">${escapeHtml(t('market.traders_hint'))}</div>`;
  }

  onAction(action, data) {
    const C = this.sim.community;
    let r = null;
    if (action === 'buy') r = C.buyFromTraders(data.item, 1);
    else if (action === 'sell') r = C.sellToTraders(data.item, Number(data.n));
    else if (action === 'order') {
      r = C.orderFromTraders(data.item, Number(data.n));
      if (r.ok) this.sim.toast('toast.trader_ordered', { item: data.item, qty: Number(data.n) }, 'good');
    } else if (action === 'collect') {
      r = C.collectOrder(Number(data.id));
      if (r.ok) this.sim.toast('toast.trader_collected', {}, 'good');
    }
    if (r && !r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    else if (r?.ok && action === 'sell') this.sim.toast('toast.sold_traders', { qty: r.n, item: data.item, money: r.money }, 'good');
  }
}
