/**
 * Places to discover in the valley itself (see ExplorationSystem).
 *
 * They're in the world from the start — you find them by walking out into the
 * unknown parts of the map. Stages: unknown → discovered (you've seen it) →
 * explored (you went in) → developed (you built an outpost there).
 *
 * place  — where they can be: 'cliff' (walkable ground at the foot of the rocks),
 *          'wild' (open land far from the village), 'forest' (among trees),
 *          'road_end' (beside the old road near the valley's edge)
 * count  — how many there are in a valley
 * loot   — what exploring it can turn up: [item, min, max, chance]
 * outpost — what you can build there once it's explored
 * minutes / energy — how long exploring takes, and how tiring it is
 */
export const SITE_KINDS = {
  cave: { place: 'cliff', count: 3, minutes: 90, energy: 12, danger: 0.12, knowledge: 0.5, vein: 0.5, outpost: 'mining_camp',
    loot: [['gemstone', 1, 2, 0.6], ['coal', 2, 5, 0.6], ['iron_ore', 1, 4, 0.5]] },
  mineshaft: { place: 'cliff', count: 1, minutes: 120, energy: 14, danger: 0.18, knowledge: 1, vein: 0.9, outpost: 'mining_camp',
    loot: [['iron_ore', 3, 6, 0.9], ['coal', 2, 6, 0.8], ['pickaxe', 1, 1, 0.3]] },
  ruin: { place: 'wild', count: 3, minutes: 60, energy: 8, danger: 0.03, knowledge: 2, money: [10, 45], outpost: null,
    loot: [['relic', 1, 1, 0.3], ['stone', 4, 8, 0.7], ['iron_ingot', 1, 2, 0.25]] },
  cabin: { place: 'forest', count: 2, minutes: 45, energy: 6, danger: 0.02, knowledge: 0.3, outpost: 'hunting_cabin',
    loot: [['bow', 1, 1, 0.4], ['hide', 1, 3, 0.7], ['worn_axe', 1, 1, 0.4], ['planks', 2, 5, 0.6]] },
  stones: { place: 'wild', count: 1, minutes: 30, energy: 4, danger: 0, knowledge: 3, outpost: null, loot: [] },
  waystation: { place: 'road_end', count: 1, minutes: 45, energy: 6, danger: 0.02, knowledge: 0.5, money: [15, 40], outpost: 'trading_post',
    loot: [['planks', 3, 6, 0.6], ['bread', 1, 3, 0.4]] },
};

/** Outposts you can build at an explored site (player buildables — see data/buildables.js). */
export const OUTPOSTS = {
  mining_camp: { business: 'mining_camp' },
  hunting_cabin: { business: 'hunting_lodge' },
  trading_post: { business: 'trading_post' },
};

/** When an outpost has this many homes around it, it's a hamlet with a name of its own. */
export const HAMLET = { radius: 16, homes: 3 };

export const SITE_TUNING = {
  minDistanceFromPlaza: 26, // tiles — discoveries lie out in the country
  spacing: 10, // tiles between sites
  lodgeGamePerHunter: 0.45, // chance per hunter-day of bringing down game (scaled by the population)
  campGemChance: 0.08, // chance per miner-day at a cave camp of a gemstone
};
