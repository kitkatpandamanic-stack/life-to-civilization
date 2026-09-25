/**
 * Land and territory: what land is worth, what it becomes, what the valley's parts are called.
 * See TerritorySystem (world/Parcels.js divides the land into plots).
 */

/** Land prices. The price of a plot is its size × this, adjusted for where it is and what's around it. */
export const LAND = {
  perTile: 3, // bare land, far from anything
  lotMargin: 1, // a new building's lot: its footprint and this much around it
  lotPremium: 1.25, // a lot carved out of village land costs a little more than raw land
  minSplit: 12, // a plot splits only if each half would have at least this many tiles
  buyReach: 2, // you must be standing on the land, or this close to it, to buy it
  npcSellFactor: 1.15, // villagers want a bit more than it's worth
  offerAccept: 1.35, // …and will sell land they don't use for this much over its value
  forestDiscount: 0.35, // land covered in trees (it has to be cleared)
  unownedToVillage: true, // unclaimed land is bought from the village (it keeps the register)
};

/**
 * What land becomes (TerritorySystem profiles, Phase 8). A plot's type comes out of what's on it:
 * the kind of buildings there (GrowthSystem.kindOf), or — with none — its fields, rocks and trees.
 */
export const TERRITORY = {
  nearDist: 34, // simulation levels: land this close to the village (or you) is looked at every week …
  midDist: 64, // … this close, every other week — further out, once a month
  infraWeight: 3, // how much new buildings are drawn to well-served spots (InfrastructureSystem coverage 0–1, in tiles of distance)
  kindType: { home: 'residential', shop: 'commercial', trade: 'commercial', industry: 'industrial', farm: 'agricultural', public: 'government', school: 'education', research: 'research', leisure: 'recreation' },
  mixedBelow: 0.55, // several kinds of building, none this dominant: mixed
  fieldShare: 0.25, // this much of it fields: agricultural
  mineRocks: 4, // this much stone (or a cave, a quarry beside it): mining land
  forestShare: 0.1, // trees on this share of it: forest
  keepEvents: 12, // what a plot remembers of its history
  newsTypes: ['residential', 'commercial', 'industrial', 'mixed', 'education', 'research'], // becoming one of these is news
  pressureRadius: 14, // what buildings nearby call for…
  closeRadius: 6, // …and what's right next door
  suitWeight: 4, // how much a well-suited spot counts against a longer walk (GrowthSystem lot choice)
};

/**
 * What land is worth (TerritorySystem.valueTarget, Phase 9): bare land × (1 + these). The worth
 * moves toward its target a step each week, so land values change as the village does.
 */
export const LAND_VALUE = {
  maxStep: 0.06, // a week's change at most
  keepWeeks: 16, // weeks of prices kept for the trend
  min: 0.5, max: 3,
  road: 0.15, noRoad: -0.05, well: 0.08,
  perJob: 0.02, jobsMax: 0.3, // work nearby
  perHome: 0.04, popMax: 0.3, // people nearby
  perService: 0.05, servicesMax: 0.15,
  activityPer: 400, activityMax: 0.2, // trade done nearby (a week)
  school: 0.08, watch: 0.05, perRuin: 0.1, ruinsMax: 0.3,
  demandShare: 0.5, // (the housing market's level − 1) × this
  water: 0.08, trees: 0.03, perNoise: 0.05, noiseMax: 0.15,
  perDev: 0.08, // each level of development
};

/** How built-up land is (TerritorySystem.development): the score from what's there, and where each level begins. */
export const DEV_LEVELS = ['undeveloped', 'developing', 'developed', 'highly_developed'];
export const DEVELOPMENT = {
  perLevel: 0.35, buildingsMax: 2, // each building level on it
  perPerson: 0.12, popMax: 1,
  perJob: 0.15, jobsMax: 1,
  road: 0.3, perRoadTile: 0.03, roadTilesMax: 0.3,
  well: 0.2, perService: 0.15, servicesMax: 0.4,
  activityPer: 150, activityMax: 0.6,
  thresholds: [0.6, 1.6, 3], // developing · developed · highly developed
  slip: 0.8, // to fall back a level, the score must drop below this share of where that level begins
};

/** The types a plot of land can have — emerging from what's actually on it. */
export const TERRITORY_TYPES = ['residential', 'commercial', 'industrial', 'agricultural', 'forest', 'mining', 'education', 'research', 'government', 'recreation', 'mixed', 'developing', 'undeveloped'];

/** Owners land can have. */
export const OWNER_KINDS = ['player', 'npc', 'company', 'village', 'community', 'none'];

/** Names for plots: what kind of land it mostly is. */
export const PARCEL_KINDS = ['meadow', 'woods', 'field', 'hillside', 'shore', 'village', 'rocky'];
