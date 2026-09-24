/**
 * World events. An event doesn't just print a message: it changes the numbers
 * the other systems run on, and some of them (floods, storms, fires, sickness,
 * collapses) physically damage the world — which then has to be repaired.
 *
 * seasons  — when it can happen (omit = any time)
 * weight   — how likely it is, relative to the others
 * days     — how long it lasts [min, max]
 * mods     — multipliers other systems read through events.modifier(key):
 *            farm_output, wood_demand, hunger, berries, fish_growth, fire_risk,
 *            export_price, migration, sickness, halt_quarry
 * weather  — forces this weather while it lasts
 * disaster — physical effect when it starts (see DisasterSystem)
 * needs    — a condition on the world (a function name in EventSystem)
 * cooldown — minimum days before it can happen again
 */
export const EVENT_DEFS = {
  good_harvest: { seasons: ['summer', 'autumn'], weight: 1, days: [3, 4], mods: { farm_output: 1.6 } },
  drought: { seasons: ['summer'], weight: 1, days: [5, 9], mods: { farm_output: 0.4, fish_growth: 0.4, fire_risk: 3 }, weather: 'sunny', cooldown: 30 },
  heavy_rain: { seasons: ['spring', 'autumn'], weight: 1, days: [1, 2], mods: { farm_output: 1.2 }, weather: 'rain', follow: { flood: 0.35 } },
  flood: { seasons: ['spring', 'autumn'], weight: 0.25, days: [2, 3], mods: { farm_output: 0.7 }, weather: 'rain', disaster: 'flood', cooldown: 60 },
  storm_front: { seasons: ['summer', 'autumn'], weight: 1, days: [1, 1], weather: 'storm', disaster: 'storm' },
  cold_snap: { seasons: ['winter'], weight: 1, days: [2, 4], mods: { wood_demand: 2, hunger: 1.15, sickness: 1.8 }, weather: 'snow' },
  berry_year: { seasons: ['spring', 'summer'], weight: 0.8, days: [3, 5], mods: { berries: 1.8 } },
  blight: { seasons: ['summer', 'autumn'], weight: 0.4, days: [5, 8], mods: { farm_output: 0.5 }, disaster: 'blight', cooldown: 60 },
  poor_harvest: { seasons: ['autumn'], weight: 0.5, days: [6, 9], mods: { farm_output: 0.6 }, cooldown: 50 },
  sickness: { seasons: ['autumn', 'winter', 'spring'], weight: 0.45, days: [6, 12], mods: { sickness: 4 }, cooldown: 50 },
  mine_collapse: { weight: 0.25, days: [5, 8], mods: { halt_quarry: 0 }, disaster: 'mine_collapse', needs: 'quarryWorking', cooldown: 90 },
  boom: { weight: 0.35, days: [10, 16], mods: { export_price: 1.45, migration: 1.6 }, cooldown: 80 },
  slump: { weight: 0.3, days: [8, 14], mods: { export_price: 0.65, migration: 0.6 }, cooldown: 80 },
  migration_wave: { weight: 0.25, days: [1, 1], disaster: 'migrants', needs: 'roomForMore', cooldown: 70 },
  trade_fair: { seasons: ['summer', 'autumn'], weight: 0.5, days: [3, 5], disaster: 'trade_fair', cooldown: 40 },
};

export const DISASTER = {
  fireBaseRisk: 0.00035, // per building per day…
  fireRiskByType: { tavern: 3, smithy: 3, bakery: 3, farmhouse: 1.5, lumberyard: 2, workshop: 2, shack: 1.5 },
  fireGrowth: 7, // intensity added per 10 minutes when nobody fights it
  fireFightPerHelper: 9, // intensity removed per helper per 10 minutes
  fireDamagePerTick: 0.9, // condition lost per 10 minutes at full intensity (×intensity/100)
  fireSpreadChance: 0.03, // per 10 minutes to a building within reach, when blazing
  fireSpreadReach: 3,
  firefightRadius: 32, // villagers this close come running
  floodReach: 3, // buildings this many tiles from the river or lake are flooded
  floodDamage: [20, 45],
  stormBuildings: [2, 5],
  stormDamage: [8, 22],
  stormTrees: 0.02, // share of grown trees near the village blown down
  repairBelow: 75, // owners start repairs when condition falls below this after a disaster
  repairMaterialsPerPoint: { wood: 0.25, planks: 0.12, stone: 0.12 },
  repairLaborPerPoint: 9, // minutes of work per condition point
  emergencyShare: 0.4, // the village's emergency fund covers up to this share of disaster repairs
  sickChance: 0.012, // per person per day while a sickness is going round (× crowding, age)
  tradeFairBoost: 1.8,
};
