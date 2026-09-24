/**
 * Homes and property.
 *
 * capacity  — how many people can live there comfortably
 * value     — base market value in good condition (location and demand adjust it)
 *
 * Buildings that are not in HOME_CAPACITY (shops, the smithy, the lumberyard…)
 * are still property — owned, valued, and able to fall into ruin — but nobody lives in them.
 */
export const HOME_CAPACITY = {
  house: 4,
  farmhouse: 6,
  small_house: 3,
  rental_house: 4,
  player_house: 4,
  player_large_house: 6,
  player_estate: 8,
  shack: 2,
  tavern: 3, // rooms upstairs
  hall: 2, // the caretaker's quarters
};

export const PROPERTY_VALUE = {
  house: 320,
  farmhouse: 480,
  small_house: 220,
  rental_house: 300,
  player_house: 380,
  player_large_house: 620,
  player_estate: 1100,
  forge: 180,
  mining_camp: 220,
  hunting_cabin: 160,
  trading_post: 420,
  shack: 90,
  store: 700,
  tavern: 800,
  smithy: 600,
  lumberyard: 450,
  quarry_hut: 380,
  workshop: 520,
  shopfront: 420,
  warehouse_bld: 560,
  storage_shed: 120,
  hall: 0, // public
  well: 0,
};

/** Buildings that belong to the whole village and are never sold. */
export const PUBLIC_BUILDINGS = ['hall'];

export const HOUSING = {
  rentPerWeekShare: 0.045, // weekly rent ≈ 4.5% of the home's value
  villageEvictWeeks: 4, // the village is patient with tenants who can't pay…
  landlordEvictWeeks: 2, // …private landlords less so
  moveOutAge: 20, // grown-up children want a place of their own…
  moveOutMoney: 45, // …once they can afford it
  moveOutChance: 0.35, // per week
  buyReserve: 1.2, // buyers keep a cushion: they need price × this in savings
  sellBelowMoney: 15, // owners this poor sell their home and rent instead
  abandonAfterDays: 14, // empty with no one looking after it → abandoned
  wearPerDay: 0.12, // normal wear (maintained homes are repaired by their owners)
  abandonedDecayPerDay: 1.1, // abandoned buildings fall apart
  ownerRepairPerDay: 0.35,
  repairCostPerDay: 1, // what keeping a building in repair costs its owner (paid to the lumberyard)
  ruinBelow: 8, // below this condition, a building is a ruin
  restorePerCondition: { planks: 0.2, stone: 0.15 }, // materials to restore 1 condition point
  restoreMoneyPerCondition: 0.8,
  supportBelowMoney: 6, // family members help relatives who are this broke…
  supportAbove: 60, // …if they have at least this much
  supportAmount: 10,
  reliefAmount: 6, // the village's poor relief per day for those with no family to help
};
