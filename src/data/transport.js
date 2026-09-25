/**
 * How goods travel. Carriers become available as the village develops
 * (see TechSystem — a carpenter makes handcarts possible, stables bring horses…).
 *
 * speed   — tiles per game minute on open ground (roads are faster, see roadBonus)
 * cap     — units per trip (bigger orders need several trips)
 * fee     — cost per unit per tile (paid by whoever ordered the goods)
 * needs   — technology required
 */
export const CARRIERS = {
  porter: { speed: 1.1, cap: 8, fee: 0.02, needs: null, sprite: 'porter' },
  handcart: { speed: 1.5, cap: 20, fee: 0.012, needs: 'handcart', sprite: 'handcart' },
  horse_cart: { speed: 2.8, cap: 40, fee: 0.009, needs: 'draft_animals', sprite: 'horse_cart' },
  wagon: { speed: 3.2, cap: 80, fee: 0.007, needs: 'wagons', sprite: 'wagon' },
};

export const LOGISTICS = {
  roadBonus: 1.6, // carts move this much faster on a road
  loadMinutes: 20, // loading and unloading
  porterPayShare: 0.8, // porters (people out of work) get most of the fee
  maxVisible: 18, // carts drawn at once
  historyDays: 14,
};

/**
 * Equipment — things that help people move goods, owned one by one (each has its own id,
 * condition and whereabouts — see EquipmentSystem). They're physical: a wheelbarrow stands
 * where it was left, a worker walks over to it, loads it, pushes it to the site and back.
 *
 *   tier      — hand (carried) · early · mid · late · advanced (late and advanced: future, not yet made)
 *   kind      — hand (held) · push (barrow, handcart) · pull (a wagon someone draws) · animal · vehicle
 *   cap       — units a trip (by hand a worker carries WORKFORCE.carryLoad = 20)
 *   road      — movement on roads, bridges and the plaza (× walking speed)
 *   offroad   — movement over grass and fields
 *   durability — how long it lasts: condition points lost per full load carried = wear
 *   minLevel  — the level a worker (or you) needs to handle it
 *   needs     — know-how the village must have (TechSystem)
 *   price     — to buy (the business that sells it gets the money) · soldBy — business types
 *   recipe    — to make it yourself (CraftingSystem) · journey — what it counts as for trade journeys
 *   parkTiles — room it takes when parked (a wagon needs more)
 */
export const EQUIPMENT = {
  basket: { tier: 'hand', kind: 'hand', cap: 30, road: 1, offroad: 1, wear: 1.2, minLevel: 0, needs: null, price: 12, soldBy: ['general_store', 'farm'], icon: '🧺' },
  sack: { tier: 'hand', kind: 'hand', cap: 35, road: 0.98, offroad: 0.98, wear: 1, minLevel: 0, needs: null, price: 14, soldBy: ['general_store', 'mill'], icon: '🛍️' },
  crate: { tier: 'hand', kind: 'hand', cap: 40, road: 0.92, offroad: 0.92, wear: 0.7, minLevel: 0, needs: null, price: 20, soldBy: ['general_store', 'carpentry'], icon: '📦' },
  wheelbarrow: { tier: 'early', kind: 'push', cap: 80, road: 1.1, offroad: 0.9, wear: 0.8, minLevel: 0, needs: null, price: 60, soldBy: ['carpentry', 'smithy'], icon: '🛒' },
  handcart: { tier: 'early', kind: 'push', cap: 150, road: 1.15, offroad: 0.75, wear: 0.7, minLevel: 1, needs: 'handcart', price: 140, soldBy: ['carpentry', 'carters'], journey: 'handcart', icon: '🛒' },
  wooden_wagon: { tier: 'early', kind: 'pull', cap: 300, road: 0.95, offroad: 0.55, wear: 0.6, minLevel: 2, needs: 'handcart', price: 320, soldBy: ['carpentry', 'carters'], parkTiles: 2, icon: '🛞' },
  pack_horse: { tier: 'mid', kind: 'animal', cap: 60, road: 1.6, offroad: 1.4, wear: 0.4, minLevel: 2, needs: 'draft_animals', price: 220, soldBy: ['farm', 'carters'], journey: 'pack_horse', upkeep: 3, icon: '🐴' },
  horse_cart: { tier: 'mid', kind: 'animal', cap: 200, road: 1.7, offroad: 1, wear: 0.5, minLevel: 3, needs: 'draft_animals', price: 380, soldBy: ['carters'], journey: 'horse_cart', upkeep: 4, parkTiles: 2, icon: '🐎' },
  wagon: { tier: 'mid', kind: 'animal', cap: 400, road: 1.5, offroad: 0.8, wear: 0.4, minLevel: 4, needs: 'wagons', price: 650, soldBy: ['carters'], journey: 'wagon', upkeep: 6, parkTiles: 2, icon: '🛞' },
  // Later on (the architecture is ready for them; nothing makes them yet).
  truck: { tier: 'late', kind: 'vehicle', cap: 1200, road: 4, offroad: 1.5, wear: 0.3, minLevel: 5, needs: 'engines', price: 4000, soldBy: [], future: true, fuel: true, icon: '🚚' },
  tractor: { tier: 'late', kind: 'vehicle', cap: 500, road: 2, offroad: 1.6, wear: 0.3, minLevel: 5, needs: 'engines', price: 3000, soldBy: [], future: true, fuel: true, icon: '🚜' },
  trailer: { tier: 'late', kind: 'vehicle', cap: 800, road: 1, offroad: 1, wear: 0.3, minLevel: 4, needs: 'engines', price: 900, soldBy: [], future: true, icon: '🚛' },
};

/** Transport by stage of the game (what exists now and what's planned). */
export const TRANSPORT_TIERS = {
  hand: ['basket', 'sack', 'crate'],
  early: ['wheelbarrow', 'handcart', 'wooden_wagon'],
  mid: ['pack_horse', 'horse_cart', 'wagon'],
  late: ['truck', 'tractor', 'trailer'],
  advanced: ['railway', 'cargo_station'], // (future: rails and stations)
};

export const EQUIP = {
  damagedBelow: 35, // condition under this: damaged — it holds less and goes slower…
  damagedCap: 0.7,
  damagedSpeed: 0.85,
  repairHours: 6, // in the depot's repair bay (or your storage yard) — faster with a depot of level 2+
  repairMoneyShare: 0.45, // × price × the share of condition missing
  repairPlanksPer: 20, // a plank for every this many condition points
  upkeepShare: 0.6, // wear costs this share of the price (per 100 condition) — booked to the job it was worn on
  maxLevel: 3, // better-made equipment: each level holds more and lasts longer
  levelCap: 0.2,
  levelWear: 0.15,
  upgradeShare: 0.5, // an upgrade costs this × price × the level
  loadBase: 2, // minutes to load or unload…
  loadPerUnit: 0.1, // …plus this per unit (a barrow of 80: 10 minutes)
  returnTimeout: 180, // a worker taking equipment back gets this long, then leaves it where they are
  parkNear: 6, // a worker finishing the day within this many tiles of the yard parks it there
};

/** Condition bands — for buildings and equipment alike. */
export const CONDITION_BANDS = [
  { band: 'new', min: 95 },
  { band: 'good', min: 75 },
  { band: 'worn', min: 50 },
  { band: 'damaged', min: 25 },
  { band: 'critical', min: 0 },
];
export function conditionBand(condition, abandoned = false) {
  if (abandoned) return 'abandoned';
  return CONDITION_BANDS.find((b) => (condition ?? 100) >= b.min)?.band || 'critical';
}
