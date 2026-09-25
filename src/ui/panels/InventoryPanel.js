/**
 * Inventory — what you carry: filter by kind, sort, hover for details; pick one to see
 * everything about it (a tool's durability, tier and what the next one up takes).
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml, slotName, qualityBadge } from '../format.js';
import { Q } from '../../data/quality.js';
import { Mod } from '../../systems/Modifiers.js';
import { icon, bar, button, filters, emptyState, condState } from '../widgets.js';
import { ITEMS, ITEM_CATEGORY_ORDER } from '../../data/items.js';
import { itemTip, toolCard } from '../items.js';

const FILTERS = ['all', 'tool', 'food', 'material', 'resource', 'seed', 'furniture'];
const SORTS = ['kind', 'name', 'value', 'weight'];

export class InventoryPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.selected = 0;
    this.filter = 'all';
    this.sort = 'kind';
  }
  get id() {
    return 'inventory';
  }
  title() {
    return `🎒 ${escapeHtml(t('ui.inventory'))}`;
  }

  sortedSlots() {
    const inv = this.sim.inventory;
    const cat = (s) => ITEMS[s.id].category;
    const list = inv.slots.map((s, index) => ({ s, index })).filter(({ s }) => this.filter === 'all' || cat(s) === this.filter || (this.filter === 'material' && cat(s) === 'quest'));
    const by = {
      kind: (a, b) => ITEM_CATEGORY_ORDER.indexOf(cat(a.s)) - ITEM_CATEGORY_ORDER.indexOf(cat(b.s)) || itemName(a.s.id).localeCompare(itemName(b.s.id)),
      name: (a, b) => itemName(a.s.id).localeCompare(itemName(b.s.id)),
      value: (a, b) => (ITEMS[b.s.id].basePrice || 0) * b.s.qty - (ITEMS[a.s.id].basePrice || 0) * a.s.qty,
      weight: (a, b) => ITEMS[b.s.id].weight * b.s.qty - ITEMS[a.s.id].weight * a.s.qty,
    }[this.sort];
    return list.sort(by);
  }

  render() {
    const inv = this.sim.inventory;
    const w = inv.weight();
    const cap = inv.capacity();
    const slots = this.sortedSlots();
    if (!inv.slots[this.selected]) this.selected = slots[0]?.index ?? 0;
    const counts = {};
    for (const s of inv.slots) counts[ITEMS[s.id].category] = (counts[ITEMS[s.id].category] || 0) + 1;
    const pills = FILTERS.filter((f) => f === 'all' || counts[f]).map((f) => [f, `${t(f === 'all' ? 'ui.filter_all' : `item_cat.${f}`)}${f === 'all' ? '' : ` ${counts[f]}`}`]);
    const grid = slots
      .map(({ s, index }) => {
        const def = ITEMS[s.id];
        let dur = '';
        if (def.tool) {
          const pct = (s.dur / inv.maxDurability(s)) * 100;
          const st = condState(pct);
          dur = bar(pct, st === 'healthy' ? 'good' : `st-${st}`);
        }
        return `<div class="slot${index === this.selected ? ' selected' : ''}" data-action="select" data-index="${index}" data-tip="${escapeHtml(itemTip(this.sim, s))}">${icon(s.id, 36)}${qualityBadge(s.q)}${def.tool ? (s.held ? '<span class="qty">✋</span>' : '') : `<span class="qty">${s.qty}</span>`}${dur}</div>`;
      })
      .join('');
    const empty = '<div class="slot empty"></div>'.repeat(Math.max(0, 18 - slots.length));
    const full = w / cap;
    const body = inv.slots.length
      ? `<div class="inv-layout">
          <div><div class="inv-grid">${grid}${empty}</div></div>
          <div class="inv-detail">${this.renderDetail()}</div>
        </div>`
      : emptyState('🎒', t('ui.inventory_empty_title'), t('ui.inventory_empty_text'));
    return `
      ${filters(pills, this.filter)}
      ${body}
      <div class="inv-foot">
        <div style="flex:1;max-width:320px"><div class="bar-label"><span>⚖️ ${escapeHtml(t('ui.weight'))}</span><b>${w} / ${cap} ${escapeHtml(t('ui.kg'))}</b></div>${bar(full * 100, full > 0.9 ? 'st-critical' : full > 0.75 ? 'st-worn' : 'good')}</div>
        <div class="btn-row" style="margin:0"><span class="hint">${escapeHtml(t('ui.sort_by'))}</span>${SORTS.map((s) => button(t(`ui.sort_${s}`), 'sort', { s }, { cls: `sm ${this.sort === s ? 'selected' : 'ghost'}` })).join('')}</div>
      </div>
      <div class="hint" style="margin-top:6px">${escapeHtml(t('ui.inventory_hint'))}</div>`;
  }

  renderDetail() {
    const sim = this.sim;
    const s = sim.inventory.slots[this.selected];
    if (!s) return `<div class="muted">${escapeHtml(t('ui.inventory_empty'))}</div>`;
    const def = ITEMS[s.id];
    const lines = [];
    const kv = (k, v) => lines.push(`<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`);
    if (!def.tool) {
      kv(t('ui.weight'), `${def.weight} ${escapeHtml(t('ui.kg'))}${s.qty > 1 ? ` <span class="muted">(${Math.round(def.weight * s.qty * 10) / 10})</span>` : ''}`);
      if (def.basePrice) kv(t('ui.base_value'), `${fmtMoney(def.basePrice)}${s.qty > 1 ? ` <span class="muted">(${fmtMoney(def.basePrice * s.qty)})</span>` : ''}`);
      if (s.q !== undefined) kv(t('ui.quality'), escapeHtml(t(`quality.${Q(s.q).id}`)));
    }
    if (def.food) {
      const food = Mod.meal(sim.state.player, def.food, s.q);
      const parts = [];
      if (food.hunger) parts.push(`🍞 +${Math.round(food.hunger)}`);
      if (food.energy) parts.push(`⚡ +${Math.round(food.energy)}`);
      if (food.health) parts.push(`❤️ +${Math.round(food.health)}`);
      kv(t('ui.restores'), parts.join(' '));
    }
    if (def.tool?.water !== undefined) kv(t('ui.water_level'), `${s.water ?? 0} / ${def.tool.water}`);
    const actions = [];
    if (def.food) actions.push(button(t('ui.eat'), 'eat', { index: this.selected }, { cls: 'primary' }));
    if (def.tool) actions.push(button(s.held ? t('ui.in_hand_now') : t('ui.take_in_hand'), 'hold', { index: this.selected }, { cls: s.held ? 'selected' : 'primary', disabled: !!s.held }));
    if (!def.questItem) {
      actions.push(button(t('ui.drop_one'), 'drop', { index: this.selected, n: 1 }, { cls: 'ghost' }));
      if (s.qty > 1) actions.push(button(t('ui.drop_all'), 'drop', { index: this.selected, n: s.qty }, { cls: 'ghost' }));
    }
    return `
      <div class="detail-head">${icon(s.id, 48)}<div><div class="detail-name">${escapeHtml(slotName(s))}${def.tool ? '' : ` <span class="muted">×${s.qty}</span>`}</div><div class="muted small">${escapeHtml(t(`item_cat.${def.category}`))}</div></div></div>
      <p class="desc">${escapeHtml(t(`item.${s.id}.desc`))}</p>
      ${lines.join('')}
      ${def.tool ? toolCard(sim, s) : ''}
      <div class="btn-row">${actions.join('')}</div>`;
  }

  onAction(action, data) {
    const inv = this.sim.inventory;
    const index = Number(data.index);
    if (action === 'select') this.selected = index;
    else if (action === 'filter') {
      this.filter = data.f;
      this.selected = this.sortedSlots()[0]?.index ?? 0;
    } else if (action === 'sort') this.sort = data.s;
    else if (action === 'hold') inv.hold(inv.slots[index]);
    else if (action === 'eat') {
      const s = inv.slots[index];
      if (s) inv.eatSlot(index);
    } else if (action === 'drop') {
      const s = inv.slots[index];
      if (!s) return;
      const n = Math.min(Number(data.n), s.qty);
      if (ITEMS[s.id].tool) inv.removeSlot(index);
      else {
        s.qty -= n;
        if (s.qty <= 0) inv.slots.splice(index, 1);
        inv.changed();
        this.sim.bus.emit('inventory:delta', { id: s.id, qty: -n });
      }
      this.sim.toast('toast.dropped', { qty: n, item: s.id }, 'info');
    }
  }
}
