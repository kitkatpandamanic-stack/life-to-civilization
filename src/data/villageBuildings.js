/**
 * What villagers and the village itself build as the settlement grows
 * (see GrowthSystem). Like the player's buildables, they need real materials —
 * bought from the lumberyard, quarry and carpenters — and real work.
 *
 * visual  — building style (data/buildings.js)
 * purpose — home: the builder's family moves in · rental: let to tenants
 *           shop: premises for the owner's business · public: the village's
 */
export const VILLAGE_BUILDINGS = {
  house: { visual: 'house', w: 4, h: 3, materials: { wood: 28, stone: 14, planks: 10 }, labor: 16, purposes: ['home', 'rental'] },
  small_house: { visual: 'small_house', w: 4, h: 3, materials: { wood: 22, stone: 6, planks: 8 }, labor: 11, purposes: ['home', 'rental'] },
  apartment_house: { visual: 'apartment_house', w: 5, h: 4, materials: { wood: 40, stone: 44, planks: 30, bricks: 16 }, labor: 30, purposes: ['rental'] },
  shopfront: { visual: 'shopfront', w: 4, h: 3, materials: { wood: 24, stone: 12, planks: 12 }, labor: 14, purposes: ['shop'] },
  well: { visual: 'well', w: 1, h: 1, materials: { stone: 16 }, labor: 5, purposes: ['public'] },
  warehouse: { visual: 'warehouse_bld', w: 6, h: 4, materials: { wood: 40, stone: 20, planks: 16 }, labor: 20, purposes: ['shop'] },
  // Civic buildings (see TechSystem / data/tech.js CIVIC)
  school: { visual: 'school', w: 5, h: 3, materials: { wood: 34, stone: 16, planks: 18 }, labor: 22, purposes: ['public'] },
  library: { visual: 'library', w: 4, h: 3, materials: { wood: 24, stone: 26, planks: 16 }, labor: 20, purposes: ['public'] },
  institute: { visual: 'institute', w: 5, h: 4, materials: { wood: 24, stone: 44, planks: 20 }, labor: 28, purposes: ['public'] },
  trade_school: { visual: 'trade_school', w: 5, h: 3, materials: { wood: 32, stone: 18, planks: 20 }, labor: 22, purposes: ['public'] },
  grammar_school: { visual: 'grammar_school', w: 6, h: 3, materials: { wood: 30, stone: 34, planks: 22 }, labor: 26, purposes: ['public'] },
  mill: { visual: 'mill', w: 5, h: 4, materials: { wood: 36, stone: 40, planks: 20 }, labor: 28, purposes: ['public'] },
  // Institutions (CivicSystem): paid for from the civic fund, built like everything else.
  market_hall: { visual: 'market_hall', w: 6, h: 3, materials: { wood: 30, stone: 14, planks: 18 }, labor: 20, purposes: ['public'] },
  watch_house: { visual: 'watch_house', w: 3, h: 3, materials: { wood: 12, stone: 26, planks: 8 }, labor: 14, purposes: ['public'] },
  clinic: { visual: 'clinic', w: 4, h: 3, materials: { wood: 22, stone: 14, planks: 14 }, labor: 16, purposes: ['public'] },
  guild_hall: { visual: 'guild_hall', w: 5, h: 4, materials: { wood: 26, stone: 34, planks: 18 }, labor: 24, purposes: ['public'] },
  bank: { visual: 'bank', w: 4, h: 3, materials: { wood: 14, stone: 40, planks: 12 }, labor: 22, purposes: ['public'] },
};

export const GROWTH = {
  civicSaveShare: 0.4, // of each week's taxes the village puts aside for the school (or library, mill…) it wants next
  lotMargin: 1, // free tiles kept around a new building
  maxLotDistance: 30, // tiles from the plaza a new building may go (grows with the village)
  roadReach: 8, // a new building gets a road to the nearest road within this distance
  ownLaborRate: 0.8, // how much an evening of building by the owner counts (vs. a builder's hour)
  helperLaborRate: 0.6,
  labourRate: 0.8, // a hired day labourer
  dayWage: 11,
  builderPayPerHour: 3, // what a project pays a builders' firm per worker-hour
  stallDaysToAbandon: 40, // a project with no progress this long is abandoned
  materialMarkup: 1.05,
  migrationCheckEveryDays: 7,
  maxMigrantsPerWeek: 2,
  leaveAfterJoblessDays: 28,
};
