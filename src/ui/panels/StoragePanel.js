/**
 * Storage — move items between your pockets and the chest in your home.
 * Furniture kept at home adds comfort (better sleep).
 */
import { Panel } from '../Panel.js';
import { t, itemName } from '../../i18n/i18n.js';
import { escapeHtml, slotName, qualityBadge } from '../format.js';
import { icon, bar, button } from '../widgets.js';
import { ITEMS } from '../../data/items.js';

export class StoragePanel extends Panel {
  get id() {
    return 'storage';
  }
  title() {
    return `🧰 ${escapeHtml(t('ui.storage'))}`;
  }

  row(slot, index, side) {
    const def = ITEMS[slot.id];
    const dur = def.tool ? ` <span class="muted small">${slot.dur}/${this.sim.inventory.maxDurability(slot)}</span>` : ` ×${slot.qty}`;
    const one = side === 'inv' ? button('→', 'deposit', { index, n: 1 }, { title: t('ui.store_one') }) : button('←', 'withdraw', { index, n: 1 }, { title: t('ui.take_one') });
    const all = def.tool ? '' : side === 'inv' ? button('⇉', 'deposit', { index, n: slot.qty }, { title: t('ui.store_all') }) : button('⇇', 'withdraw', { index, n: slot.qty }, { title: t('ui.take_all') });
    return `<div class="st-row">${icon(slot.id, 26)}<span class="st-name">${escapeHtml(slotName(slot))}${qualityBadge(slot.q)}${dur}</span>${one}${all}</div>`;
  }

  render() {
    const sim = this.sim;
    const inv = sim.inventory;
    const home = sim.home;
    const invRows = inv.slots.map((s, i) => (ITEMS[s.id].questItem ? '' : this.row(s, i, 'inv'))).join('') || `<div class="muted small">${escapeHtml(t('ui.inventory_empty'))}</div>`;
    const stRows = home.storage.map((s, i) => this.row(s, i, 'st')).join('') || `<div class="muted small">${escapeHtml(t('ui.storage_empty'))}</div>`;
    const cap = home.storageCapacity();
    return `
      <div class="storage-cols">
        <div class="col">
          <h3>${escapeHtml(t('ui.pockets'))}</h3>
          <div class="small">${escapeHtml(t('ui.weight'))}: ${inv.weight()} / ${inv.capacity()} ${escapeHtml(t('ui.kg'))}</div>
          ${bar((inv.weight() / inv.capacity()) * 100)}
          <div class="st-list">${invRows}</div>
          <div class="btn-row">${button(t('ui.store_resources'), 'store_resources', {}, { cls: 'primary' })}</div>
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.chest'))}</h3>
          <div class="small">${escapeHtml(t('ui.weight'))}: ${home.storageWeight()} / ${cap} ${escapeHtml(t('ui.kg'))}</div>
          ${bar((home.storageWeight() / cap) * 100, home.storageWeight() / cap > 0.9 ? 'warn' : '')}
          <div class="st-list">${stRows}</div>
        </div>
      </div>
      <div class="muted small">${escapeHtml(t('ui.storage_hint', { comfort: home.comfort() }))}</div>`;
  }

  onAction(action, data) {
    const home = this.sim.home;
    if (action === 'deposit') {
      if (!home.deposit(Number(data.index), Number(data.n))) this.sim.toast('toast.storage_full', {}, 'warn');
    } else if (action === 'withdraw') {
      if (!home.withdraw(Number(data.index), Number(data.n))) this.sim.toast('reason.too_heavy', {}, 'warn');
    } else if (action === 'store_resources') {
      // Quick action: put all raw resources and materials in the chest.
      const inv = this.sim.inventory;
      for (let i = inv.slots.length - 1; i >= 0; i--) {
        const cat = ITEMS[inv.slots[i].id].category;
        if (cat === 'resource' || cat === 'material' || cat === 'furniture') home.deposit(i, inv.slots[i].qty);
      }
    }
  }
}
