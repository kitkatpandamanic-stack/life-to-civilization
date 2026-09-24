/**
 * InventorySystem — what the player carries.
 *
 * Inventory is a list of slots: { id, qty } for stackable items,
 * or { id, qty: 1, dur } for tools (each tool has its own durability).
 * Crafted goods carry a quality (q) — see data/quality.js and systems/slots.js.
 * Total weight is limited by carrying capacity (Strength).
 */
import { ITEMS } from '../data/items.js';
import { Mod } from './Modifiers.js';
import { Q } from '../data/quality.js';
import { addTo, removeFrom, maxDurability } from './slots.js';
import { rand } from '../core/rng.js';

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

  /** Adds up to qty of quality q (limited by capacity unless force). Returns how many were added. */
  add(id, qty = 1, { force = false, q, extra } = {}) {
    const def = ITEMS[id];
    if (!def || qty <= 0) return 0;
    const n = force ? qty : Math.min(qty, this.maxAddable(id));
    if (n <= 0) return 0;
    addTo(this.slots, id, n, q, extra);
    this.changed();
    return n;
  }

  /**
   * Removes up to qty (the worst first, or the best first with prefer: 'high').
   * Returns how many were removed; the qualities taken are in this.lastRemoved.
   */
  remove(id, qty = 1, { prefer = 'low' } = {}) {
    const taken = removeFrom(this.slots, id, qty, prefer);
    this.lastRemoved = taken;
    if (taken.length) this.changed();
    return taken.length;
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
      const eff = this.toolEfficiency(s);
      const bestEff = best ? this.toolEfficiency(best) : 0;
      if (!best || eff > bestEff || (eff === bestEff && s.dur > best.dur)) best = s;
    }
    return best;
  }

  /** Tool efficiency: the kind of tool × how well it was made. */
  toolEfficiency(slot) {
    return (ITEMS[slot.id]?.tool?.efficiency || 1) * Q(slot.q).eff;
  }

  maxDurability(slot) {
    return maxDurability(slot);
  }

  /** Wears the best tool of a kind by one use. Breaks it at zero durability. */
  useTool(kind) {
    const slot = this.bestTool(kind);
    if (!slot) return;
    // Careful hands (perks) sometimes spare the tool.
    if (rand.chance(Mod.perk(this.sim.state.player, `save_wear_${kind}`))) return;
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
    this.sim.needs.applyFood(Mod.meal(this.sim.state.player, def.food, this.lastRemoved[0]));
    this.sim.toast('toast.ate', { item: id }, 'info');
    return true;
  }

  /** Eat from one particular slot (the inventory panel's Eat button). */
  eatSlot(index) {
    const s = this.slots[index];
    const def = ITEMS[s?.id];
    if (!def?.food) return false;
    const q = s.q;
    s.qty--;
    if (s.qty <= 0) this.slots.splice(index, 1);
    this.changed();
    this.sim.needs.applyFood(Mod.meal(this.sim.state.player, def.food, q));
    this.sim.toast('toast.ate', { item: s.id }, 'info');
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
