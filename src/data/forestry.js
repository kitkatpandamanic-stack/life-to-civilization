/**
 * Forestry — keeping the valley's woods alive while the village lives off them (see ForestrySystem).
 *
 * Forest health is the share of the valley's first woods standing today (grown trees; young ones count
 * a little). The lumberyard fells less when the woods are thin, a forester plants and tends, a tree
 * nursery raises saplings, farmers plant orchards, and the headman can set a felling limit and a
 * planting fund (the 'forestry' policy).
 */
export const FOREST = {
  youngWeight: 0.35, // a young tree counts this much towards the forest's health
  status: [[0.9, 'thick'], [0.7, 'healthy'], [0.45, 'thinning'], [0, 'bare']],
  // Felling limit, by the headman's forestry policy: below this health the lumberyard only fells a few trees a day.
  protectBelow: { low: 0.3, normal: 0.5, high: 0.7 },
  thinQuota: 2, // trees a lumberyard may fell a day when the woods are below the limit
  // A forester: the lumberyard takes one on once the woods have been cut into.
  foresterBelow: 0.97,
  foresterWage: 14,
  plantMinutes: 45, // planting a sapling (or tending a young tree)
  plantUpTo: 1, // the woods back to their old size (with what's growing): no more planting, only tending
  plantRadius: 34, // how far from the yard a forester goes to plant
  tendDays: 3, // tending a sapling or young tree brings it on this many days
  tendEvery: 4, // …at most once in this many days
  replantPerIdle: 3, // a woodcutter with nothing to fell plants this many at a time
  // Winter: saplings and young trees still grow, at this pace.
  winterGrowth: 0.5,
  youngSeedShare: 0.35, // young trees seed the ground too, at this share of a grown tree's rate
  // Nothing left to fell and the yard nearly empty: timber is sent for from outside.
  importBelow: 0.3, // of the yard's target stock
  importQty: 10,
  importMarkup: 1.4,
  importNewsDays: 56,
  // The planting fund (forestry policy 'high'): the village pays for each tree the foresters plant.
  fundPerTree: 3,
  fundReserve: 60, // the treasury never goes below this for it
  // Orchards: apple trees, planted by farms (and you) — apples each autumn.
  orchardMax: 10, // apple trees a farm keeps
  orchardPlantEvery: 'spring', // (and autumn) a farm with money plants a couple more
  orchardPerSeason: 2,
  orchardRadius: 12,
  applesPerTree: [5, 9],
  fruitFromDay: 3, // of autumn
  farmPicksPerDay: 3, // apple trees a farm picks each day in autumn
  // Players planting
  plantEnergy: 4,
  plantXp: 4,
  // News: the woods grew back
  regrownAt: 0.9,
  regrownFrom: 0.7,
};

/** Saplings you can plant (items) and the tree each becomes. */
export const SAPLINGS = { sapling: null, apple_sapling: 'apple' };
