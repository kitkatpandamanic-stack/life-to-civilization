/**
 * What the player can build.
 *
 * w, h       — footprint in tiles (the door is centred on the bottom edge)
 * money      — paid up front (permits, nails, hired carts...)
 * materials  — must be delivered to the construction site before it can be finished
 * labor      — work hours needed (players and workers with hammers add labor)
 * unlock     — progression unlock required (data/unlocks.js)
 * minSkill   — construction skill needed
 * effect     — what the finished building does
 *
 * Construction happens in stages you can see: foundation → frame → walls → finished.
 */
export const BUILDABLES = {
  small_house: {
    category: 'residential', w: 4, h: 3, money: 60,
    materials: { wood: 30, stone: 12, planks: 10 }, labor: 12,
    unlock: 'construction', effect: { home: 'small_house' },
  },
  rental_house: {
    category: 'residential', w: 4, h: 3, money: 80,
    materials: { wood: 30, stone: 16, planks: 12 }, labor: 14,
    unlock: 'construction', minSkill: 1, effect: { rental: 3 }, // houses up to 3 villagers who pay rent
  },
  storage_shed: {
    category: 'storage', w: 3, h: 2, money: 25,
    materials: { wood: 20, planks: 6 }, labor: 6,
    unlock: 'construction', effect: { storage: 150 },
  },
  well: {
    category: 'infrastructure', w: 1, h: 1, money: 15,
    materials: { stone: 16 }, labor: 4,
    unlock: 'construction', effect: { water: true },
  },
  forge: {
    category: 'production', w: 3, h: 2, money: 30,
    materials: { stone: 22, wood: 8, planks: 4 }, labor: 7,
    unlock: 'construction', effect: { station: 'forge' }, // smelt ingots and forge tools at home
  },
  shopfront: {
    category: 'production', w: 4, h: 3, money: 60,
    materials: { wood: 24, stone: 12, planks: 12 }, labor: 14,
    unlock: 'start_business', minSkill: 2, effect: { premises: true }, // open any village business in it
  },
  warehouse_bld: {
    category: 'production', w: 6, h: 4, money: 140,
    materials: { wood: 40, stone: 24, planks: 18 }, labor: 22,
    unlock: 'start_business', minSkill: 5, effect: { premises: true }, // a trading depot (Architect: from level 3)
  },
  // Outposts: built beside an explored discovery site (see data/sites.js), not on your land.
  mining_camp: {
    category: 'outpost', w: 3, h: 2, money: 40, outpost: true,
    materials: { wood: 20, planks: 8 }, labor: 8,
    unlock: 'construction', effect: { outpost: 'mining_camp' },
  },
  hunting_cabin: {
    category: 'outpost', w: 3, h: 2, money: 25, outpost: true,
    materials: { wood: 16, planks: 6 }, labor: 6,
    unlock: 'construction', effect: { outpost: 'hunting_cabin' },
  },
  trading_post: {
    category: 'outpost', w: 4, h: 3, money: 80, outpost: true,
    materials: { wood: 24, stone: 10, planks: 12 }, labor: 12,
    unlock: 'construction', effect: { outpost: 'trading_post' },
  },
  workshop: {
    category: 'production', w: 5, h: 4, money: 150,
    materials: { wood: 40, stone: 20, planks: 16 }, labor: 20,
    unlock: 'start_business', minSkill: 2, effect: { business: 'carpentry' },
  },
};

export const BUILD_CATEGORIES = ['residential', 'storage', 'production', 'infrastructure'];

/** Roads are laid tile by tile: each tile costs this much stone and a short bit of work. */
export const ROAD_COST = { stone: 1, ms: 700 };

/** Upgrading your home, tier by tier (built in place, like any construction). */
export const HOME_UPGRADES = {
  house: { from: 'small_house', money: 120, materials: { wood: 40, stone: 30, planks: 20 }, labor: 16, minSkill: 2 },
  large_house: { from: 'house', money: 300, materials: { wood: 60, stone: 50, planks: 35 }, labor: 26, minSkill: 4 },
  estate: { from: 'large_house', money: 750, materials: { wood: 90, stone: 90, planks: 60, iron_ingot: 6 }, labor: 38, minSkill: 6 },
};
