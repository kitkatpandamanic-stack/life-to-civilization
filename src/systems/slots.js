/**
 * Slot-list helpers shared by the player's pockets and home storage.
 *
 * A slot is { id, qty } for stackable goods, { id, qty, q } when the goods have a
 * quality (see data/quality.js), or { id, qty: 1, dur, q } for a tool (every tool
 * is its own slot with its own wear). Goods stack only with the same quality.
 */
import { ITEMS } from '../data/items.js';
import { Q, STANDARD, QUALITY_CATEGORIES } from '../data/quality.js';

export const hasQuality = (id) => QUALITY_CATEGORIES.has(ITEMS[id]?.category);

/** Durability of a brand-new tool of this quality. */
export function maxDurability(slot) {
  const tool = ITEMS[slot.id]?.tool;
  if (!tool) return 0;
  return slot.maxDur ?? Math.round(tool.durability * Q(slot.q).dur);
}

/** Put qty items of quality q into a slot list. */
export function addTo(list, id, qty, q = STANDARD, extra = {}) {
  const def = ITEMS[id];
  const quality = hasQuality(id) ? q ?? STANDARD : undefined;
  if (def.tool) {
    for (let i = 0; i < qty; i++) {
      const slot = { id, qty: 1, dur: 0, ...extra };
      if (quality !== undefined && quality !== STANDARD) slot.q = quality;
      slot.dur = extra.dur ?? maxDurability(slot);
      if (def.tool.water !== undefined) slot.water ??= def.tool.water;
      list.push(slot);
    }
    return;
  }
  const norm = quality === STANDARD ? undefined : quality;
  const stack = list.find((s) => s.id === id && s.q === norm);
  if (stack) stack.qty += qty;
  else list.push(norm === undefined ? { id, qty } : { id, qty, q: norm });
}

/**
 * Take up to qty items out of a slot list. prefer: 'low' (use up the worst first —
 * eating, crafting, building) or 'high' (sell the best first).
 * Returns the qualities removed, one entry per item.
 */
export function removeFrom(list, id, qty, prefer = 'low') {
  const out = [];
  const order = list
    .map((s, i) => [s, i])
    .filter(([s]) => s.id === id)
    .sort((a, b) => (prefer === 'high' ? (b[0].q ?? STANDARD) - (a[0].q ?? STANDARD) : (a[0].q ?? STANDARD) - (b[0].q ?? STANDARD)));
  for (const [s] of order) {
    while (s.qty > 0 && out.length < qty) {
      s.qty--;
      out.push(s.q ?? STANDARD);
    }
    if (out.length >= qty) break;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].qty <= 0) list.splice(i, 1);
  return out;
}

/** Best quality of an item available in a list (or null). */
export function bestQuality(list, id) {
  let best = null;
  for (const s of list) if (s.id === id && s.qty > 0) best = Math.max(best ?? -1, s.q ?? STANDARD);
  return best;
}

export function countAtLeast(list, id, minQ = 0) {
  let n = 0;
  for (const s of list) if (s.id === id && (s.q ?? STANDARD) >= minQ) n += s.qty;
  return n;
}
