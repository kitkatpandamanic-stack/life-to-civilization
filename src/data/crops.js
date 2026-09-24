/**
 * Crops the player can grow on their own land.
 *
 * days    — days of good growth (watered or rained on) until ripe
 * seasons — seasons it grows in; out of season it withers
 * yield   — [min, max] produce at harvest (Farming skill adds more)
 * item    — what you harvest
 *
 * An unwatered crop still grows, but slowly (see FARMING.dryGrowth).
 */
export const CROPS = {
  wheat: { seed: 'wheat_seeds', item: 'wheat', days: 6, seasons: ['spring', 'summer'], yield: [3, 5] },
  carrot: { seed: 'carrot_seeds', item: 'carrot', days: 4, seasons: ['spring', 'summer', 'autumn'], yield: [2, 4] },
  potato: { seed: 'potato_seeds', item: 'potato', days: 5, seasons: ['spring', 'summer', 'autumn'], yield: [3, 5] },
  cabbage: { seed: 'cabbage_seeds', item: 'cabbage', days: 7, seasons: ['spring', 'autumn'], yield: [2, 3] },
  pumpkin: { seed: 'pumpkin_seeds', item: 'pumpkin', days: 8, seasons: ['summer', 'autumn'], yield: [1, 2] },
};

export const FARMING = {
  dryGrowth: 0.35, // growth per day when not watered (rain waters everything)
  waterBonus: 0.25, // plots near water grow faster (matches the land feature)
  actionMs: { till: 900, plant: 500, water: 450, harvest: 700, clear: 500 },
  energy: { till: 2, plant: 0.5, water: 0.5, harvest: 1, clear: 0.5 },
  xp: { till: 1, plant: 1, water: 1, harvest: 3 },
  skillXp: { till: 3, plant: 2, water: 2, harvest: 6 },
};
