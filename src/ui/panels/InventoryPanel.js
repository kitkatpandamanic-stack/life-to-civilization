/**
 * Inventory — what you carry, its weight, and what you can do with each item.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { icon, bar, button } from '../widgets.js';
import { ITEMS, ITEM_CATEGORY_ORDER } from '../../data/items.js';

export class InventoryPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.selected = 0;
  }
  get id() {
    return 'inventory';
  }
  title() {
    return `🎒 ${escapeHtml(t('ui.inventory'))}`;
  }

  sortedSlots() {
    return this.sim.inventory.slots
      .map((s, index) => ({ s, index }))
      .sort((a, b) => ITEM_CATEGORY_ORDER.indexOf(ITEMS[a.s.id].category) - ITEM_CATEGORY_ORDER.indexOf(ITEMS[b.s.id].category));
  }

  render() {
    const inv = this.sim.inventory;
    const w = inv.weight();
    const cap = inv.capacity();
    const slots = this.sortedSlots();
    if (this.selected >= inv.slots.length) this.selected = 0;
    const grid = slots
      .map(({ s, index }) => {
        const def = ITEMS[s.id];
        const dur = def.tool ? bar((s.dur / def.tool.durability) * 100, 'dur') : '';
        return `<div class="slot${index === this.selected ? ' selected' : ''}" data-action="select" data-index="${index}" title="${escapeHtml(itemName(s.id))}">${icon(s.id, 36)}${def.tool ? '' : `<span class="qty">${s.qty}</span>`}${dur}</div>`;
      })
      .join('');
    const empty = Math.max(0, 18 - slots.length);
    const emptySlots = '<div class="slot empty"></div>'.repeat(empty);
    return `
      <div class="inv-weight">${escapeHtml(t('ui.weight'))}: <b>${w} / ${cap}</b> ${escapeHtml(t('ui.kg'))}${bar((w / cap) * 100, w / cap > 0.9 ? 'warn' : '')}</div>
      <div class="inv-layout">
        <div class="inv-grid">${grid}${emptySlots}</div>
        <div class="inv-detail">${this.renderDetail()}</div>
      </div>
      <div class="muted small">${escapeHtml(t('ui.inventory_hint'))}</div>`;
  }

  renderDetail() {
    const s = this.sim.inventory.slots[this.selected];
    if (!s) return `<div class="muted">${escapeHtml(t('ui.inventory_empty'))}</div>`;
    const def = ITEMS[s.id];
    const lines = [];
    lines.push(`<div class="kv"><span>${escapeHtml(t('ui.weight'))}</span><b>${def.weight} ${escapeHtml(t('ui.kg'))}</b></div>`);
    if (def.basePrice) lines.push(`<div class="kv"><span>${escapeHtml(t('ui.base_value'))}</span><b>${fmtMoney(def.basePrice)}</b></div>`);
    if (def.food) {
      const parts = [];
      if (def.food.hunger) parts.push(`🍞 +${def.food.hunger}`);
      if (def.food.energy) parts.push(`⚡ +${def.food.energy}`);
      if (def.food.health) parts.push(`❤️ +${def.food.health}`);
      lines.push(`<div class="kv"><span>${escapeHtml(t('ui.restores'))}</span><b>${parts.join(' ')}</b></div>`);
    }
    if (def.tool) {
      lines.push(`<div class="kv"><span>${escapeHtml(t('ui.durability'))}</span><b>${s.dur} / ${def.tool.durability}</b></div>`);
      lines.push(`<div class="kv"><span>${escapeHtml(t('ui.efficiency'))}</span><b>×${def.tool.efficiency}</b></div>`);
    }
    const actions = [];
    if (def.food) actions.push(button(t('ui.eat'), 'eat', { index: this.selected }, { cls: 'primary' }));
    if (!def.questItem) {
      actions.push(button(t('ui.drop_one'), 'drop', { index: this.selected, n: 1 }));
      if (s.qty > 1) actions.push(button(t('ui.drop_all'), 'drop', { index: this.selected, n: s.qty }));
    }
    return `
      <div class="detail-head">${icon(s.id, 48)}<div><div class="detail-name">${escapeHtml(itemName(s.id))}${def.tool ? '' : ` ×${s.qty}`}</div><div class="muted">${escapeHtml(t(`item_cat.${def.category}`))}</div></div></div>
      <p class="desc">${escapeHtml(t(`item.${s.id}.desc`))}</p>
      ${lines.join('')}
      <div class="btn-row">${actions.join('')}</div>`;
  }

  onAction(action, data) {
    const inv = this.sim.inventory;
    const index = Number(data.index);
    if (action === 'select') this.selected = index;
    else if (action === 'eat') {
      const s = inv.slots[index];
      if (s) inv.eat(s.id);
    } else if (action === 'drop') {
      const s = inv.slots[index];
      if (!s) return;
      const n = Math.min(Number(data.n), s.qty);
      if (ITEMS[s.id].tool) inv.removeSlot(index);
      else inv.remove(s.id, n);
      this.sim.toast('toast.dropped', { qty: n, item: s.id }, 'info');
    }
  }
}
