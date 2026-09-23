/**
 * Item definitions. Names and descriptions live in the locale files (item.<id>.name / .desc).
 *
 * weight     — kilograms, counts against carrying capacity
 * basePrice  — reference price; real shop prices move with supply and demand
 * food       — what eating it restores
 * tool       — kind, starting durability and efficiency (speed multiplier)
 */
export const ITEMS = {
  wood: { category: 'resource', weight: 2, basePrice: 3 },
  stone: { category: 'resource', weight: 3, basePrice: 4 },
  iron_ore: { category: 'resource', weight: 4, basePrice: 11 },
  coal: { category: 'resource', weight: 2, basePrice: 7 },
  wheat: { category: 'resource', weight: 1, basePrice: 3 },

  berries: { category: 'food', weight: 0.2, basePrice: 1, food: { hunger: 5 } },
  apple: { category: 'food', weight: 0.4, basePrice: 3, food: { hunger: 12 } },
  bread: { category: 'food', weight: 0.5, basePrice: 5, food: { hunger: 28 } },
  cheese: { category: 'food', weight: 0.5, basePrice: 8, food: { hunger: 22, health: 3 } },
  pie: { category: 'food', weight: 0.6, basePrice: 9, food: { hunger: 35, energy: 4, health: 2 } },
  stew: { category: 'food', weight: 1, basePrice: 10, food: { hunger: 55, energy: 8 } },

  worn_axe: { category: 'tool', weight: 3, basePrice: 12, tool: { kind: 'axe', durability: 30, efficiency: 0.8 } },
  axe: { category: 'tool', weight: 3, basePrice: 35, tool: { kind: 'axe', durability: 80, efficiency: 1.15 } },
  pickaxe: { category: 'tool', weight: 4, basePrice: 45, tool: { kind: 'pickaxe', durability: 80, efficiency: 1 } },

  package: { category: 'quest', weight: 3, basePrice: 0, questItem: true },
};

export const ITEM_CATEGORY_ORDER = ['tool', 'food', 'resource', 'quest'];

export function isFood(id) {
  return !!ITEMS[id]?.food;
}

export function isTool(id) {
  return !!ITEMS[id]?.tool;
}
