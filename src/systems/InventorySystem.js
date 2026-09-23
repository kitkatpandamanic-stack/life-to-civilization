/**
 * InventorySystem — what the player carries.
 *
 * Inventory is a list of slots: { id, qty } for stackable items,
 * or { id, qty: 1, dur } for tools (each tool has its own durability).
 * Total weight is limited by carrying capacity (Strength).
 */
import { ITEMS } from '../data/items.js';
import { Mod } from './Modifiers.js';

export class InventorySystem {
  constructor(sim) {
    this.sim = sim;
  }

  get slots() {
    return this.sim.state.player.inventory;
  }

  capacity() {
    return Mod.carryCapacity(this.sim.state.player);
  }

  weight() {
    let w = 0;
    for (const s of this.slots) w += (ITEMS[s.id]?.weight || 0) * s.qty;
    return Math.round(w * 10) / 10;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s.id === id) n += s.qty;
    return n;
  }

  /** How many of this item still fit. */
  maxAddable(id) {
    const w = ITEMS[id]?.weight || 0;
    if (w <= 0) return 9999;
    return Math.max(0, Math.floor((this.capacity() - this.weight()) / w + 1e-6));
  }

  canAdd(id, qty = 1) {
    return this.maxAddable(id) >= qty;
  }

  /** Adds up to qty (limited by capacity unless force). Returns how many were added. */
  add(id, qty = 1, { force = false } = {}) {
    const def = ITEMS[id];
    if (!def || qty <= 0) return 0;
    const n = force ? qty : Math.min(qty, this.maxAddable(id));
    if (n <= 0) return 0;
    if (def.tool) {
      for (let i = 0; i < n; i++) this.slots.push({ id, qty: 1, dur: def.tool.durability });
    } else {
      const stack = this.slots.find((s) => s.id === id);
      if (stack) stack.qty += n;
      else this.slots.push({ id, qty: n });
    }
    this.changed();
    return n;
  }

  /** Removes up to qty. Returns how many were removed. */
  remove(id, qty = 1) {
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.qty);
      s.qty -= take;
      left -= take;
      if (s.qty <= 0) this.slots.splice(i, 1);
    }
    if (left !== qty) this.changed();
    return qty - left;
  }

  removeSlot(index) {
    const s = this.slots[index];
    if (!s) return null;
    this.slots.splice(index, 1);
    this.changed();
    return s;
  }

  /** The best tool of a kind (highest efficiency, then durability). */
  bestTool(kind) {
    let best = null;
    for (const s of this.slots) {
      const tool = ITEMS[s.id]?.tool;
      if (!tool || tool.kind !== kind) continue;
      if (!best || tool.efficiency > ITEMS[best.id].tool.efficiency || (tool.efficiency === ITEMS[best.id].tool.efficiency && s.dur > best.dur)) best = s;
    }
    return best;
  }

  /** Wears the best tool of a kind by one use. Breaks it at zero durability. */
  useTool(kind) {
    const slot = this.bestTool(kind);
    if (!slot) return;
    slot.dur -= 1;
    if (slot.dur <= 0) {
      this.slots.splice(this.slots.indexOf(slot), 1);
      this.sim.toast('toast.tool_broke', { item: slot.id }, 'warn');
    }
    this.changed();
  }

  eat(id) {
    const def = ITEMS[id];
    if (!def?.food || this.count(id) <= 0) return false;
    this.remove(id, 1);
    this.sim.needs.applyFood(def.food);
    this.sim.toast('toast.ate', { item: id }, 'info');
    return true;
  }

  /** Picks the food that best fills current hunger without much waste. */
  bestFoodToEat() {
    const missing = 100 - this.sim.state.player.hunger;
    let best = null;
    let bestScore = -Infinity;
    for (const s of this.slots) {
      const food = ITEMS[s.id]?.food;
      if (!food) continue;
      const waste = Math.max(0, food.hunger - missing);
      const score = Math.min(food.hunger, missing) - waste * 0.7 - ITEMS[s.id].basePrice * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = s.id;
      }
    }
    return best;
  }

  changed() {
    this.sim.bus.emit('inventory:changed');
  }
}
