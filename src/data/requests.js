/**
 * Favour requests villagers can ask of the player.
 * They're generated from the simulation: who the NPC is, the season,
 * and what's actually in short supply in the village.
 *
 * item: 'shortage' — the item the store is shortest of right now.
 */
export const REQUEST_TEMPLATES = [
  { occupations: ['innkeeper'], item: 'berries', qty: [5, 8], seasons: ['spring', 'summer', 'autumn'] },
  { occupations: ['blacksmith'], item: 'coal', qty: [2, 4] },
  { occupations: ['blacksmith'], item: 'iron_ore', qty: [2, 3] },
  { occupations: ['elder'], item: 'wood', qty: [4, 6], seasons: ['autumn', 'winter'] },
  { occupations: ['elder'], item: 'apple', qty: [2, 3] },
  { occupations: ['child'], item: 'berries', qty: [3, 5], seasons: ['spring', 'summer', 'autumn'] },
  { occupations: ['farmer', 'farmhand'], item: 'bread', qty: [2, 3] },
  { occupations: ['woodcutter', 'miner'], item: 'apple', qty: [2, 4] },
  { occupations: ['unemployed'], item: 'bread', qty: [1, 2] },
  { occupations: ['shopkeeper'], item: 'shortage', qty: [4, 6] },
  { occupations: ['lumber_foreman'], item: 'stone', qty: [3, 5] },
  { occupations: ['quarry_foreman'], item: 'wood', qty: [3, 5] },
];
