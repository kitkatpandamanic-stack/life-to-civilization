/**
 * Other settlements in the wider world (see SettlementSystem).
 *
 * The valley is where you live and walk; these places lie in the regions beyond
 * it, days away. They're simulated at the "statistical" level — no villagers
 * walking about, but real numbers: how many people live there, what they make
 * and need each week, what's in their stores, and the prices that follow from
 * that. Their stores fill and empty as they produce, eat and trade — with the
 * valley's caravans, with you, and with each other — so prices move, and a good
 * deal doesn't last forever.
 *
 * region    — where it is (REGIONS); you hear of it when the region becomes known
 * character — what kind of place it is (its economy)
 * pop       — people living there at the start
 * produces  — units per week (at the starting population)
 * wants     — units per week they use up and will pay well for
 * water     — reachable by boat (much faster once the valley knows how to build boats)
 */
export const SETTLEMENTS = {
  woodhollow: {
    region: 'old_forest', character: 'forest', pop: 45,
    produces: { wood: 40, planks: 12, meat: 8, hide: 5, berries: 12 },
    wants: { bread: 14, cheese: 5, flour: 6, iron_ingot: 2, axe: 1 },
  },
  pass_hold: {
    region: 'north_pass', character: 'herding', pop: 32,
    produces: { cheese: 14, hide: 8, meat: 10 },
    wants: { wheat: 10, flour: 8, bread: 8, planks: 6, hoe: 1 },
  },
  lakeside: {
    region: 'lake_country', character: 'fishing', pop: 70, water: true,
    produces: { fish: 40, cabbage: 12, potato: 14 },
    wants: { wood: 20, planks: 12, bread: 14, fishing_rod: 2, iron_ingot: 2 },
  },
  ironford: {
    region: 'iron_hills', character: 'mining', pop: 110,
    produces: { iron_ore: 30, coal: 30, iron_ingot: 8, stone: 20 },
    wants: { bread: 30, meat: 14, wheat: 16, planks: 12, pickaxe: 3, cheese: 6 },
  },
  market_town: {
    region: 'market_town', character: 'market', pop: 420,
    produces: { bricks: 20, glass: 10, pie: 10, saw: 2, hammer: 2, iron_axe: 1 },
    wants: { wheat: 40, flour: 20, wood: 30, fish: 20, meat: 16, hide: 10, table: 3, chair: 4, gemstone: 2 },
  },
  saltmere: {
    region: 'far_coast', character: 'port', pop: 260, water: true,
    produces: { fish: 50, bricks: 8, glass: 6 },
    wants: { planks: 24, iron_ingot: 8, wood: 20, bread: 20, gemstone: 3, cabinet: 1 },
  },
};

/** Size of a place, from its population (it grows or shrinks with its fortunes). */
export const SETTLEMENT_SIZES = [
  ['hamlet', 0],
  ['village', 50],
  ['town', 200],
  ['city', 800],
];

/** What you can travel and carry goods with (bought at the carters' yard — or from a dealer). */
export const PLAYER_TRANSPORT = {
  foot: { cargo: 20, speed: 1, price: 0, upkeep: 0, needs: null },
  handcart: { cargo: 45, speed: 1, price: 60, upkeep: 0, needs: 'handcart' },
  pack_horse: { cargo: 60, speed: 1.6, price: 220, upkeep: 3, needs: 'draft_animals' },
  horse_cart: { cargo: 140, speed: 1.3, price: 380, upkeep: 4, needs: 'draft_animals' },
  wagon: { cargo: 300, speed: 1.15, price: 650, upkeep: 6, needs: 'wagons' },
};

/**
 * The road to a place, level by level. cut: the share of the journey it saves; safe: the share of the
 * danger it takes away. The village builds up to a good road itself (TRADE.roadMaxLevel); a paved
 * highway needs the know-how of stone bridges, and a railway the know-how of railways and a station in
 * the valley — those you pay for. By rail the journey takes the train's time, whatever you'd have
 * travelled with, and a goods wagon carries far more than any cart.
 */
export const ROAD_LEVELS = [
  { cut: 0, safe: 0 }, // a track
  { cut: 0.25, safe: 0.4 }, // a road
  { cut: 0.5, safe: 0.8 }, // a good road
  { cut: 0.6, safe: 0.85, tech: 'stone_bridges', cost: 1.5 }, // a paved highway
  { cut: 0.8, safe: 0.95, tech: 'railways', station: true, cost: 3, weeks: 1.2, rail: true }, // a railway
];
export const RAIL = { cargo: 400, stationType: 'rail_station' };

/** Trains in the valley (TrainSystem). */
export const TRAIN = {
  hours: [9, 13, 17], // when a train reaches the station (each line TRAIN.stagger minutes after the last)
  stagger: 30,
  approach: 40, // minutes from the valley's edge to the station (and back out)
  dwell: 30, // minutes at the platform
  travellerSpend: 5, // what the travellers leave at the tavern and the store, a train
  feePerUnit: 0.4, // rail carriage (fetched from your storage)
  minFee: 3,
};

export const TRADE = {
  stockWeeks: 2, // a settlement keeps about this many weeks of goods on hand…
  priceHigh: 1.9, // …and pays up to this × the base price when it has none…
  priceSlope: 0.9, // …less this much for each "full store" it holds
  priceMin: 0.45,
  priceMax: 2.3,
  spread: 0.12, // they sell a little dearer than they buy
  growthBase: 0.004, // weekly population change: a little growth…
  growthFed: 0.006, // …more when their needs are met…
  shrinkHungry: 0.012, // …a decline when they aren't
  tradeGrowth: 0.002, // trade with the valley brings people
  localUse: 0.3, // share of their own produce they use up each week
  outsideSupply: 0.6,
  exportShare: 0.4, // of the valley's surplus sold to passing traders, this share reaches the known settlement that needs it most // share of their needs the wider world's pedlars bring each week (trade makes up the rest)
  shockChance: 0.07, // weekly: a boom or a shortage somewhere
  shockWeeks: [3, 7],
  neighbourShare: 0.1, // settlements trade with each other: this share of the price gap closes each week
  foodPerDay: 1, // food for the road, per traveller per day
  robberyBase: 0.5, // × the region's danger: chance of being robbed on a journey
  roadCostPerDay: 160, // improving the road there: per day of travel, per level
  roadWeeksPerDay: 2, // …and it takes this long
  roadMaxLevel: 2,
  boatDays: 0.6, // by boat, journeys to places on the water take this share of the time
  roadDaysCut: 0.25, // each road level cuts the journey by this share…
  roadDangerCut: 0.4, // …and the danger by this share
  villageRoadTrade: 300, // the village pays for a road itself once this much trade has gone that way
  caravanMinProfit: 15, // a caravan only goes if it's worth it
  caravanLoad: 60, // units a caravan carries per carrier-load (more with better carts)
  priceMemoryDays: 28, // prices you learned are "old news" after this long
  upkeepMissedWeeks: 3, // an animal you can't feed for this long is sold off
};
