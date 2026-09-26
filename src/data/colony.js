/**
 * Your own settlement (ColonySystem): founded with a founding stone on open land well away from the
 * village, peopled with settlers you invite, laid out to a plan, run with its own purse.
 */
export const COLONY = {
  minDistance: 28, // tiles from the village plaza
  radius: 12, // what counts as the settlement
  charterMoney: 250, // the headman's charter (paid when you place the founding stone)
  charterRep: 20, // …granted to someone of this standing (or a friend of the headman, or the headman)
  charterRel: 35,
  settlerRel: 50, // someone settled in the village moves only for a friend
  houseType: 'small_house', // what a settler builds first
  houseSubsidy: 0.6, // the settlement's purse pays up to this share of a settler's house
  newcomerShare: 0.35, // newcomers to the valley who go to your settlement instead (more as it grows)
  foodPerSettler: 1, // food a winter's day, each (from the settlement's store)
  woodPerHome: 1, // firewood a winter's day, each home
  hungryDaysToLeave: 6, // a household gives up after this many hungry winter days
  tax: { low: 1, normal: 2, high: 4 }, // a week, each grown settler
  taxPull: { low: 0.1, normal: 0, high: -0.15 }, // how it changes the draw on newcomers
  stages: [
    { id: 'camp', settlers: 0, homes: 0 },
    { id: 'hamlet', settlers: 5, homes: 2 },
    { id: 'village', settlers: 12, homes: 5, landmarks: ['well', 'market'] },
  ],
  roadPerTile: 2, // what a street costs the settlement's purse, a tile
};

/** What the settlement can build for itself, from its purse (in the plan's places). */
export const LANDMARKS = {
  well: { type: 'well', cost: 90, icon: '⛲' },
  market: { type: 'shopfront', cost: 220, icon: '🏪', purpose: 'shop', bizType: 'general_store' },
};

/**
 * Layouts: where the homes, the well and the market go, relative to the founding stone.
 * street — a main street east–west, homes on both sides · green — homes round a village green.
 */
export const LAYOUTS = {
  street: {
    street: [[-10, 3], [10, 3]], // (a straight street: from, to — tile offsets)
    homes: [[-8, -1], [-3, -1], [2, -1], [7, -1], [-8, 5], [-3, 5], [2, 5], [7, 5], [-13, -1], [12, -1], [-13, 5], [12, 5]],
    well: [0, 1],
    market: [4, 1],
  },
  green: {
    street: [[-7, -6], [7, -6], [7, 6], [-7, 6], [-7, -6]], // (round the green)
    homes: [[-6, -10], [-1, -10], [4, -10], [8, -3], [8, 2], [4, 7], [-1, 7], [-6, 7], [-12, 2], [-12, -3]],
    well: [0, 0],
    market: [-4, -3],
  },
};

/** Names a settlement can be given (or your own). */
export const COLONY_NAMES = 12;
