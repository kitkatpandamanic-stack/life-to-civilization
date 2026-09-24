/**
 * The wider world beyond the valley.
 *
 * The valley map is where you live; these regions lie past its edges, days
 * away on foot. You (or an adventurous villager) can mount an expedition to
 * one: take food for the road, perhaps hire companions, and come back days
 * later with what you found — a new seam of ore, ruins with old coin and old
 * knowledge, a trading partner, settlers who've heard of your village — or
 * with injuries and nothing to show for it. Exploring a region reveals the
 * ones beyond it.
 *
 * x/y place the region on the expedition map (the valley is at 50,50).
 * finds: weights of what an expedition there can turn up.
 * deposit: the ore a find there leads to (a new outcrop in the valley's mountains).
 */
export const REGIONS = {
  old_forest: { x: 14, y: 50, days: 1, danger: 0.05, known: true, finds: { game: 3, timber: 3, herbs: 2, ruins: 0.6 } },
  north_pass: { x: 50, y: 12, days: 2, danger: 0.12, known: true, deposit: 'iron', finds: { deposit: 3, game: 1.5, ruins: 1 } },
  iron_hills: { x: 86, y: 32, days: 2, danger: 0.1, deposit: 'coal', finds: { deposit: 4, ruins: 0.8, game: 1 }, requires: ['north_pass', 'lake_country'] },
  lake_country: { x: 52, y: 86, days: 2, danger: 0.06, finds: { fish: 3, settlers: 2, partner: 1, herbs: 1 }, requires: ['old_forest'] },
  old_fort: { x: 20, y: 14, days: 3, danger: 0.18, finds: { ruins: 4, relic: 2, game: 1 }, requires: ['north_pass', 'old_forest'] },
  market_town: { x: 86, y: 82, days: 3, danger: 0.05, finds: { partner: 5, settlers: 1.5 }, requires: ['lake_country'] },
  far_coast: { x: 90, y: 58, days: 5, danger: 0.22, deposit: 'stone', finds: { partner: 3, settlers: 1, relic: 1, fish: 2 }, requires: ['iron_hills', 'market_town'] },
};

export const EXPEDITION = {
  foodPerPersonDay: 1, // food items (any) per traveller per day on the road
  companionWagePerDay: 8,
  maxCompanions: 3,
  companionMinRel: 30,
  exploredPerTrip: [25, 40], // % of a region mapped per expedition
  npcTripChance: 0.3, // weekly chance an adventurous villager sets out
  travelRealMsPerDay: 1100, // how long a day on the road takes on screen
  tradeBonusPerPartner: 0.08, // better export prices per trading partner
  knowledgePerRuins: 2,
};

/** Loot per kind of find: [item, min, max]. */
export const FIND_LOOT = {
  game: [['meat', 2, 5], ['hide', 1, 3]],
  timber: [['wood', 6, 12]],
  herbs: [['berries', 4, 9]],
  fish: [['fish', 3, 7]],
};

/** Fog of war on the valley map: explored in chunks of CHUNK×CHUNK tiles. */
export const FOG = { chunk: 6, radiusTiles: 11, startRadiusTiles: 16 };
