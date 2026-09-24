/**
 * Item definitions. Names and descriptions live in the locale files (item.<id>.name / .desc).
 *
 * weight     — kilograms, counts against carrying capacity
 * basePrice  — reference price; real shop prices move with supply and demand
 * food       — what eating it restores
 * tool       — kind, starting durability and efficiency (speed multiplier)
 * seed       — planting it grows this crop (see data/crops.js)
 * comfort    — furniture: comfort added to your home when placed there
 */
export const ITEMS = {
  // Raw resources
  wood: { category: 'resource', weight: 2, basePrice: 3 },
  stone: { category: 'resource', weight: 3, basePrice: 4 },
  clay: { category: 'resource', weight: 2, basePrice: 3 },
  iron_ore: { category: 'resource', weight: 4, basePrice: 11 },
  coal: { category: 'resource', weight: 2, basePrice: 7 },
  wheat: { category: 'resource', weight: 1, basePrice: 3 },
  flour: { category: 'material', weight: 1, basePrice: 5 },

  // Processed materials
  planks: { category: 'material', weight: 1.5, basePrice: 8 },
  bricks: { category: 'material', weight: 2.5, basePrice: 9 },
  hide: { category: 'material', weight: 1.5, basePrice: 9 },
  iron_ingot: { category: 'material', weight: 1.5, basePrice: 26 },

  // Food
  berries: { category: 'food', weight: 0.2, basePrice: 1, food: { hunger: 5 } },
  apple: { category: 'food', weight: 0.4, basePrice: 3, food: { hunger: 12 } },
  carrot: { category: 'food', weight: 0.3, basePrice: 3, food: { hunger: 8 } },
  potato: { category: 'food', weight: 0.5, basePrice: 3, food: { hunger: 10 } },
  cabbage: { category: 'food', weight: 1, basePrice: 5, food: { hunger: 14 } },
  pumpkin: { category: 'food', weight: 3, basePrice: 9, food: { hunger: 22 } },
  bread: { category: 'food', weight: 0.5, basePrice: 5, food: { hunger: 28 } },
  cheese: { category: 'food', weight: 0.5, basePrice: 8, food: { hunger: 22, health: 3 } },
  pie: { category: 'food', weight: 0.6, basePrice: 9, food: { hunger: 35, energy: 4, health: 2 } },
  stew: { category: 'food', weight: 1, basePrice: 10, food: { hunger: 55, energy: 8 } },
  vegetable_soup: { category: 'food', weight: 1, basePrice: 12, food: { hunger: 50, energy: 10, health: 4 } },
  fish: { category: 'food', weight: 0.6, basePrice: 5, food: { hunger: 14 } },
  grilled_fish: { category: 'food', weight: 0.5, basePrice: 12, food: { hunger: 42, health: 3 } },
  meat: { category: 'food', weight: 1, basePrice: 7, food: { hunger: 16 } },
  roast_meat: { category: 'food', weight: 0.8, basePrice: 15, food: { hunger: 55, energy: 6 } },

  // Seeds (sold at the store)
  wheat_seeds: { category: 'seed', weight: 0.1, basePrice: 2, seed: 'wheat' },
  carrot_seeds: { category: 'seed', weight: 0.1, basePrice: 2, seed: 'carrot' },
  potato_seeds: { category: 'seed', weight: 0.1, basePrice: 2, seed: 'potato' },
  cabbage_seeds: { category: 'seed', weight: 0.1, basePrice: 3, seed: 'cabbage' },
  pumpkin_seeds: { category: 'seed', weight: 0.1, basePrice: 4, seed: 'pumpkin' },

  // Furniture (crafted; sold to villagers or used to make your home comfortable)
  stool: { category: 'furniture', weight: 3, basePrice: 22, comfort: 3 },
  chair: { category: 'furniture', weight: 4, basePrice: 34, comfort: 4 },
  table: { category: 'furniture', weight: 8, basePrice: 55, comfort: 6 },
  cabinet: { category: 'furniture', weight: 14, basePrice: 115, comfort: 9 },

  // Tools
  worn_axe: { category: 'tool', weight: 3, basePrice: 12, tool: { kind: 'axe', durability: 30, efficiency: 0.8 } },
  axe: { category: 'tool', weight: 3, basePrice: 35, tool: { kind: 'axe', durability: 80, efficiency: 1.15 } },
  iron_axe: { category: 'tool', weight: 3.5, basePrice: 70, tool: { kind: 'axe', durability: 140, efficiency: 1.35 } },
  pickaxe: { category: 'tool', weight: 4, basePrice: 45, tool: { kind: 'pickaxe', durability: 80, efficiency: 1 } },
  iron_pickaxe: { category: 'tool', weight: 4.5, basePrice: 85, tool: { kind: 'pickaxe', durability: 140, efficiency: 1.35 } },
  hammer: { category: 'tool', weight: 2, basePrice: 28, tool: { kind: 'hammer', durability: 100, efficiency: 1.2 } },
  saw: { category: 'tool', weight: 2, basePrice: 30, tool: { kind: 'saw', durability: 100, efficiency: 1.25 } },
  hoe: { category: 'tool', weight: 2.5, basePrice: 25, tool: { kind: 'hoe', durability: 100, efficiency: 1.1 } },
  watering_can: { category: 'tool', weight: 2, basePrice: 18, tool: { kind: 'watering_can', durability: 200, efficiency: 1, water: 12 } },
  fishing_rod: { category: 'tool', weight: 1.5, basePrice: 20, tool: { kind: 'fishing_rod', durability: 60, efficiency: 1 } },
  bow: { category: 'tool', weight: 1.5, basePrice: 38, tool: { kind: 'bow', durability: 50, efficiency: 1 } },

  relic: { category: 'material', weight: 1, basePrice: 60 },
  gemstone: { category: 'material', weight: 0.3, basePrice: 40 },
  package: { category: 'quest', weight: 3, basePrice: 0, questItem: true },
};

export const ITEM_CATEGORY_ORDER = ['tool', 'food', 'seed', 'material', 'resource', 'furniture', 'quest'];

export function isFood(id) {
  return !!ITEMS[id]?.food;
}

export function isTool(id) {
  return !!ITEMS[id]?.tool;
}
