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
  shopfront: { visual: 'shopfront', w: 4, h: 3, materials: { wood: 24, stone: 12, planks: 12 }, labor: 14, purposes: ['shop'] },
  well: { visual: 'well', w: 1, h: 1, materials: { stone: 16 }, labor: 5, purposes: ['public'] },
  warehouse: { visual: 'warehouse_bld', w: 6, h: 4, materials: { wood: 40, stone: 20, planks: 16 }, labor: 20, purposes: ['shop'] },
  // Civic buildings (see TechSystem / data/tech.js CIVIC)
  school: { visual: 'school', w: 5, h: 3, materials: { wood: 34, stone: 16, planks: 18 }, labor: 22, purposes: ['public'] },
  library: { visual: 'library', w: 4, h: 3, materials: { wood: 24, stone: 26, planks: 16 }, labor: 20, purposes: ['public'] },
  mill: { visual: 'mill', w: 5, h: 4, materials: { wood: 36, stone: 40, planks: 20 }, labor: 28, purposes: ['public'] },
};

export const GROWTH = {
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
