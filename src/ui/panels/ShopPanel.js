/**
 * Shop — buy and sell at live, supply-and-demand prices. The smithy also repairs tools.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney, npcName } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, slotName, qualityBadge } from '../format.js';
import { bestQuality } from '../../systems/slots.js';
import { Mod } from '../../systems/Modifiers.js';
import { icon, button, tabs, bar, portrait } from '../widgets.js';
import { ITEMS } from '../../data/items.js';

export class ShopPanel extends Panel {
  constructor(ui, bizId, tab = 'buy') {
    super(ui);
    this.bizId = bizId;
    this.tab = tab;
  }
  get id() {
    return 'shop';
  }
  title() {
    return `🛒 ${escapeHtml(buildingLabel(this.sim, this.sim.economy.biz(this.bizId)?.building))}`;
  }

  trend(item) {
    const f = this.sim.economy.priceFactor(this.bizId, item);
    if (f > 1.25) return `<span class="trend up" title="${escapeHtml(t('ui.price_high'))}">▲</span>`;
    if (f < 0.8) return `<span class="trend down" title="${escapeHtml(t('ui.price_low'))}">▼</span>`;
    return '';
  }

  render() {
    const sim = this.sim;
    const econ = sim.economy;
    const def = econ.def(this.bizId);
    // A trade fair: the merchant's wanted goods can be sold here too.
    const fair = sim.state.events.active.find((e) => e.data?.item)?.data.item;
    const owner = econ.owner(this.bizId);
    const p = sim.state.player;
    const tabList = [['buy', t('ui.buy')], ['sell', t('ui.sell')]];
    if (def.repairs) tabList.push(['repair', t('ui.repair')]);
    const disc = econ.relationshipDiscount(this.bizId);
    const head = `
      <div class="shop-head">
        ${owner ? portrait(`npc_${sim.state.seed}_${owner.id}`, owner.look, 56) : ''}
        <div>
          <div><b>${owner ? escapeHtml(npcName(owner)) : ''}</b></div>
          <div class="muted small">${escapeHtml(t('ui.shop_cash', { money: fmtMoney(econ.biz(this.bizId).money) }))}${disc > 0 ? ` · ${escapeHtml(t('ui.friend_discount', { pct: Math.round(disc * 100) }))}` : disc < 0 ? ` · ${escapeHtml(t('ui.distrust_markup', { pct: Math.round(-disc * 100) }))}` : ''}</div>
        </div>
        <div class="shop-wallet">💰 ${fmtMoney(p.money)}<div class="muted small">${escapeHtml(t('ui.weight'))}: ${sim.inventory.weight()} / ${sim.inventory.capacity()}</div></div>
      </div>
      ${tabs(tabList, this.tab)}`;

    let body = '';
    if (this.tab === 'buy') {
      body = def.sells
        .map((item) => {
          const stock = econ.stock(this.bizId, item);
          const price = econ.playerBuyPrice(this.bizId, item);
          const can = stock > 0 && p.money >= price && sim.inventory.canAdd(item, 1);
          return `<div class="shop-row">
            ${icon(item, 32)}
            <div class="shop-item"><b>${escapeHtml(itemName(item))}</b><div class="muted small">${escapeHtml(t(`item.${item}.desc`))}</div></div>
            <div class="shop-stock muted small">${escapeHtml(t('ui.in_stock', { n: stock }))}</div>
            <div class="shop-price">${fmtMoney(price)} ${this.trend(item)}</div>
            ${button(t('ui.buy_n', { n: 1 }), 'buy', { item, n: 1 }, { disabled: !can, cls: 'primary' })}
            ${ITEMS[item].tool ? '' : button(t('ui.buy_n', { n: 5 }), 'buy', { item, n: 5 }, { disabled: !can })}
          </div>`;
        })
        .join('');
    } else if (this.tab === 'sell') {
      const rows = [...new Set([...def.buys, ...(fair && def.kind === 'shop' ? [fair] : [])])]
        .filter((item) => sim.inventory.count(item) > 0)
        .map((item) => {
          const have = sim.inventory.count(item);
          // You sell your best pieces first: the price shown is for the finest you carry.
          const q = bestQuality(sim.inventory.slots, item) ?? 1;
          const price = econ.playerSellPrice(this.bizId, item, q);
          const block = econ.sellBlockReason(this.bizId, item);
          // Market analyst: where would it fetch the most?
          let tip = '';
          if (Mod.perk(sim.state.player, 'market_info')) {
            const best = econ.active().filter((id) => id !== this.bizId && econ.buysItem(id, item)).map((id) => [id, econ.playerSellPrice(id, item, q)]).sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] > price) tip = `<div class="muted small">📈 ${escapeHtml(t('ui.better_price_at', { building: buildingLabel(sim, econ.biz(best[0]).building), money: fmtMoney(best[1]) }))}</div>`;
          }
          return `<div class="shop-row">
            ${icon(item, 32)}
            <div class="shop-item"><b>${escapeHtml(itemName(item))}</b>${qualityBadge(q)} ×${have}${block ? `<div class="warn small">${escapeHtml(t(`reason.${block}`))}</div>` : ''}${tip}</div>
            <div class="shop-price">${fmtMoney(price)} ${this.trend(item)}</div>
            ${button(t('ui.sell_n', { n: 1 }), 'sell', { item, n: 1 }, { disabled: !!block, cls: 'primary' })}
            ${button(t('ui.sell_all'), 'sell', { item, n: have }, { disabled: !!block })}
          </div>`;
        })
        .join('');
      const wants = def.buys.map((i) => itemName(i)).join(', ');
      body = (rows || `<div class="muted">${escapeHtml(t('ui.nothing_to_sell'))}</div>`) + `<div class="muted small shop-wants">${escapeHtml(t('ui.shop_buys', { items: wants }))}</div>`;
    } else if (this.tab === 'repair') {
      const tools = sim.inventory.slots.map((s, i) => ({ s, i })).filter(({ s }) => ITEMS[s.id].tool);
      body =
        tools
          .map(({ s, i }) => {
            const max = sim.inventory.maxDurability(s);
            const cost = econ.repairCost(s);
            return `<div class="shop-row">
              ${icon(s.id, 32)}
              <div class="shop-item"><b>${escapeHtml(slotName(s))}</b>${bar((s.dur / max) * 100, 'dur', `${s.dur}/${max}`)}</div>
              <div class="shop-price">${cost ? fmtMoney(cost) : '—'}</div>
              ${button(t('ui.repair'), 'repair', { index: i }, { disabled: !cost || p.money < cost, cls: 'primary' })}
            </div>`;
          })
          .join('') || `<div class="muted">${escapeHtml(t('ui.no_tools'))}</div>`;
    }
    return head + `<div class="shop-list">${body}</div><div class="muted small">${escapeHtml(t('ui.shop_hint'))}</div>`;
  }

  onAction(action, data) {
    const econ = this.sim.economy;
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'buy') {
      const r = econ.buy(this.bizId, data.item, Number(data.n));
      if (r.bought) this.sim.toast('toast.bought', { qty: r.bought, item: data.item, money: r.spent }, 'gain');
      if (r.reason && r.bought < Number(data.n)) this.sim.toast(`reason.${r.reason}`, {}, 'warn');
    } else if (action === 'sell') {
      const r = econ.sell(this.bizId, data.item, Number(data.n));
      if (r.sold) this.sim.toast('toast.sold', { qty: r.sold, item: data.item, money: r.earned }, 'gain');
      if (r.reason && r.sold < Number(data.n)) this.sim.toast(`reason.${r.reason}`, {}, 'warn');
    } else if (action === 'repair') {
      const slot = this.sim.inventory.slots[Number(data.index)];
      if (slot && econ.repair(slot, this.bizId)) this.sim.toast('toast.repaired', { item: slot.id }, 'good');
    }
  }
}
