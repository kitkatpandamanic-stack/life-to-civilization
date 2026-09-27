/**
 * Job definitions — the work the player can take on for village businesses.
 *
 * type:
 *   harvest  — harvest ripe crops on the employer's field, then bring them back
 *   deliver  — gather resources anywhere, then deliver them to the employer
 *   courier  — pick up a package at the employer and deliver it to a house
 *   shift    — work a timed shift inside the workplace (time fast-forwards)
 *   rounds   — pick up letters at the employer, then deliver one to each of several houses
 *   haul     — pick up materials at the employer and carry them to a building site in the village
 *   outing   — go out to a place (the woods, a meadow, a pasture…) and work there a few hours; with a
 *              yield, bring what you gathered back to the employer (then it's paid like a delivery)
 *   plant    — take saplings from the employer and plant them out in the woods (paid per tree)
 *
 * employer 'village' — the village itself pays (from its treasury), at the hall
 * when       — the job only exists when there's call for it (a funeral, a newborn, the sick…: JobSystem.condition)
 * hourly     — [min, max] hours: you choose how long to work, paid perHour
 * tips       — customers may tip (a barber, a server)
 * piece      — pay per tree planted (plant jobs); deliveries always pay per extra unit you bring
 * roundsKind — rounds that aren't letters: 'lamps' (light the street lamps), 'chimneys' (sweep them)
 *
 * employer     — a business id ('store', 'farm'…) — or employerType: any business of that
 *                type the village has (a bakery, a carpenter's…); the one that can pay best hires
 *
 * hours      — [earliest accept hour, latest accept/start hour]
 * seasons    — seasons when the job exists (omit = all year)
 * dailySlots — how many times per day the job is offered
 * requires   — { level, reputation, skill: {id, level}, attributes: {id: value}, tool: kind }
 */
export const JOBS = {
  farm_harvest: {
    employer: 'farm', type: 'harvest', item: 'wheat', qty: 8,
    pay: 20, xp: 28, skill: 'farming', skillXp: 20, rep: 1,
    hours: [6, 17], seasons: ['spring', 'summer', 'autumn'], dailySlots: 2,
    rush: { season: 'autumn', slots: 3, pay: 1.35 }, // the harvest rush: more openings, better pay
    requires: { level: 1 },
  },
  lumber_delivery: {
    employer: 'lumberyard', type: 'deliver', item: 'wood', qty: 6,
    pay: 26, xp: 30, skill: 'woodcutting', skillXp: 15, rep: 1,
    hours: [6, 18], dailySlots: 2,
    requires: { level: 1 },
  },
  courier: {
    employer: 'store', type: 'courier', item: 'package',
    pay: 12, xp: 18, skill: null, rep: 1,
    hours: [8, 17], dailySlots: 3,
    requires: { level: 1 },
  },
  dishwasher: {
    employer: 'tavern', type: 'shift', durationHours: 3, energy: 12,
    pay: 15, xp: 20, skill: null, rep: 1,
    hours: [16, 21], dailySlots: 1,
    requires: { level: 1 },
  },
  store_assistant: {
    employer: 'store', type: 'shift', durationHours: 4, energy: 14,
    pay: 24, xp: 32, skill: 'trading', skillXp: 30, rep: 1,
    hours: [8, 14], dailySlots: 1,
    requires: { level: 2, reputation: 3 },
  },
  quarry_miner: {
    employer: 'quarry', type: 'deliver', item: 'stone', qty: 8,
    pay: 42, xp: 45, skill: 'mining', skillXp: 15, rep: 1,
    hours: [6, 18], dailySlots: 2,
    requires: { level: 3, tool: 'pickaxe' },
  },
  smith_apprentice: {
    employer: 'smithy', type: 'shift', durationHours: 5, energy: 22,
    pay: 40, xp: 55, skill: 'smithing', skillXp: 40, rep: 1,
    hours: [8, 13], dailySlots: 1,
    requires: { level: 4, attributes: { strength: 4 } },
  },

  // ---- Odd jobs for a newcomer (level 1): plenty to do from the first morning.
  farm_chores: {
    employer: 'farm', type: 'shift', durationHours: 2, energy: 10,
    pay: 12, xp: 16, skill: 'farming', skillXp: 10, rep: 1,
    hours: [6, 10], dailySlots: 1,
    requires: { level: 1 },
  },
  spring_planting: {
    employer: 'farm', type: 'shift', durationHours: 3, energy: 14,
    pay: 18, xp: 24, skill: 'farming', skillXp: 20, rep: 1,
    hours: [6, 12], seasons: ['spring'], dailySlots: 2,
    requires: { level: 1 },
  },
  firewood: {
    employer: 'tavern', type: 'deliver', item: 'wood', qty: 4,
    pay: 16, xp: 20, skill: 'woodcutting', skillXp: 10, rep: 1,
    hours: [7, 18], dailySlots: 1,
    requires: { level: 1 },
  },
  tavern_cellar: {
    employer: 'tavern', type: 'shift', durationHours: 2, energy: 10,
    pay: 12, xp: 16, skill: null, rep: 1,
    hours: [12, 17], dailySlots: 1,
    requires: { level: 1 },
  },
  berry_picking: {
    employer: 'store', type: 'deliver', item: 'berries', qty: 8,
    pay: 14, xp: 18, skill: 'foraging', skillXp: 15, rep: 1,
    hours: [7, 17], seasons: ['spring', 'summer', 'autumn'], dailySlots: 2,
    requires: { level: 1 },
  },
  market_porter: {
    employer: 'store', type: 'shift', durationHours: 2, energy: 12,
    pay: 12, xp: 16, skill: 'trading', skillXp: 8, rep: 1,
    hours: [7, 12], dailySlots: 1,
    requires: { level: 1 },
  },
  mail_rounds: {
    employer: 'store', type: 'rounds', item: 'package', qty: 3,
    pay: 18, xp: 24, skill: null, rep: 1,
    hours: [8, 16], dailySlots: 2,
    requires: { level: 1 },
  },
  snow_clearing: {
    employer: 'store', type: 'shift', durationHours: 2, energy: 14,
    pay: 14, xp: 18, skill: null, rep: 1,
    hours: [7, 12], seasons: ['winter'], dailySlots: 2,
    requires: { level: 1 },
  },
  lumber_haul: {
    employer: 'lumberyard', type: 'haul', item: 'wood', qty: 10,
    pay: 18, xp: 22, skill: 'construction', skillXp: 10, rep: 1,
    hours: [7, 17], dailySlots: 2,
    requires: { level: 1 },
  },
  fish_catch: {
    employer: 'tavern', type: 'deliver', item: 'fish', qty: 3,
    pay: 20, xp: 22, skill: 'fishing', skillXp: 15, rep: 1,
    hours: [6, 18], dailySlots: 1,
    requires: { level: 1, tool: 'fishing_rod' },
  },

  // ---- A step up (levels 2–3): better pay, and work at the businesses villagers open.
  tavern_server: {
    employer: 'tavern', type: 'shift', durationHours: 4, energy: 16,
    pay: 24, xp: 30, skill: 'trading', skillXp: 15, rep: 1,
    hours: [18, 22], dailySlots: 1,
    requires: { level: 2, reputation: 3 },
  },
  stone_haul: {
    employer: 'quarry', type: 'haul', item: 'stone', qty: 8,
    pay: 22, xp: 26, skill: 'construction', skillXp: 12, rep: 1,
    hours: [7, 17], dailySlots: 2,
    requires: { level: 2 },
  },
  bakery_shift: {
    employerType: 'bakery', type: 'shift', durationHours: 3, energy: 14,
    pay: 20, xp: 26, skill: 'cooking', skillXp: 20, rep: 1,
    hours: [5, 9], dailySlots: 1,
    requires: { level: 2 },
  },
  carpenter_helper: {
    employerType: 'carpentry', type: 'shift', durationHours: 4, energy: 18,
    pay: 26, xp: 34, skill: 'carpentry', skillXp: 25, rep: 1,
    hours: [8, 13], dailySlots: 1,
    requires: { level: 2 },
  },
  warehouse_loader: {
    employerType: 'warehouse', type: 'shift', durationHours: 3, energy: 16,
    pay: 20, xp: 24, skill: 'trading', skillXp: 10, rep: 1,
    hours: [7, 14], dailySlots: 1,
    requires: { level: 2 },
  },
  fishery_crew: {
    employerType: 'fishery', type: 'deliver', item: 'fish', qty: 4,
    pay: 26, xp: 28, skill: 'fishing', skillXp: 20, rep: 1,
    hours: [5, 17], dailySlots: 1,
    requires: { level: 2, tool: 'fishing_rod' },
  },
  hunt_meat: {
    employer: 'tavern', type: 'deliver', item: 'meat', qty: 3,
    pay: 34, xp: 36, skill: 'hunting', skillXp: 15, rep: 1,
    hours: [6, 17], dailySlots: 1,
    requires: { level: 3, tool: 'bow' },
  },
  mill_hand: {
    employerType: 'mill', type: 'shift', durationHours: 4, energy: 20,
    pay: 30, xp: 38, skill: 'farming', skillXp: 15, rep: 1,
    hours: [7, 12], dailySlots: 1,
    requires: { level: 3, attributes: { strength: 3 } },
  },
};

// ---- More work: the village's own jobs, trades' helpers, and work in the woods and fields.
// (Added to JOBS below, kept apart so the older list stays easy to read.)
const MORE_JOBS = {
  // The village pays (from its treasury) — ask at the hall.
  lamplighter: {
    employer: 'village', type: 'rounds', roundsKind: 'lamps', qty: 4,
    pay: 14, xp: 16, skill: null, rep: 1,
    hours: [17, 21], dailySlots: 1,
    requires: { level: 1 },
  },
  night_watch: {
    employer: 'village', type: 'shift', durationHours: 4, energy: 16,
    pay: 22, xp: 26, skill: null, rep: 2,
    hours: [20, 23], dailySlots: 1,
    requires: { level: 2, reputation: 2 },
  },
  chimney_sweep: {
    employer: 'village', type: 'rounds', roundsKind: 'chimneys', qty: 3,
    pay: 21, xp: 22, skill: null, rep: 1,
    hours: [8, 15], seasons: ['autumn', 'winter'], dailySlots: 1,
    requires: { level: 1 },
  },
  road_mending: {
    employer: 'village', type: 'shift', durationHours: 3, hourly: [1, 6], perHour: 5, energy: 15,
    pay: 15, xp: 20, skill: 'construction', skillXp: 12, rep: 1,
    hours: [7, 15], dailySlots: 2,
    requires: { level: 1 },
  },
  well_digging: {
    employer: 'village', type: 'shift', durationHours: 5, energy: 26, when: 'well_needed',
    pay: 38, xp: 44, skill: 'mining', skillXp: 15, rep: 2,
    hours: [7, 12], dailySlots: 1,
    requires: { level: 3, tool: 'pickaxe', attributes: { strength: 3 } },
  },
  gravedigger: {
    employer: 'village', type: 'shift', durationHours: 3, energy: 16, when: 'funeral',
    pay: 20, xp: 20, skill: null, rep: 1,
    hours: [7, 16], dailySlots: 1,
    requires: { level: 1 },
  },
  messenger: {
    employer: 'village', type: 'courier', item: 'package',
    pay: 12, xp: 16, skill: null, rep: 1,
    hours: [8, 17], dailySlots: 2,
    requires: { level: 1 },
  },
  hall_clerk: {
    employer: 'village', type: 'shift', durationHours: 3, energy: 8,
    pay: 22, xp: 30, skill: 'learning', skillXp: 20, rep: 1,
    hours: [9, 14], dailySlots: 1,
    requires: { level: 2, reputation: 4 },
  },
  tutor: {
    employer: 'village', type: 'shift', durationHours: 2, energy: 8, when: 'children',
    pay: 18, xp: 26, skill: 'learning', skillXp: 20, rep: 2,
    hours: [14, 18], dailySlots: 1,
    requires: { level: 3, reputation: 5 },
  },
  nurse_helper: {
    employer: 'village', type: 'shift', durationHours: 3, energy: 12, when: 'sick',
    pay: 20, xp: 26, skill: null, rep: 2,
    hours: [8, 18], dailySlots: 1,
    requires: { level: 2 },
  },
  midwife_helper: {
    employer: 'village', type: 'shift', durationHours: 2, energy: 10, when: 'newborn',
    pay: 26, xp: 24, skill: null, rep: 2,
    hours: [6, 20], dailySlots: 1,
    requires: { level: 2 },
  },
  expedition_guide: {
    employer: 'village', type: 'outing', place: 'far', durationHours: 6, energy: 26, when: 'settlements',
    pay: 48, xp: 60, skill: 'exploration', skillXp: 30, rep: 2,
    hours: [6, 11], dailySlots: 1,
    requires: { level: 4 },
  },

  // Helping the trades.
  tailoring: {
    employer: 'store', type: 'shift', durationHours: 3, energy: 8,
    pay: 18, xp: 22, skill: null, rep: 1,
    hours: [9, 15], dailySlots: 1,
    requires: { level: 1 },
  },
  cobbling: {
    employer: 'store', type: 'shift', durationHours: 3, energy: 10,
    pay: 18, xp: 22, skill: null, rep: 1,
    hours: [9, 15], dailySlots: 1,
    requires: { level: 2 },
  },
  barber: {
    employer: 'tavern', type: 'shift', durationHours: 2, energy: 6, tips: true,
    pay: 12, xp: 16, skill: null, rep: 1,
    hours: [10, 16], dailySlots: 1,
    requires: { level: 1 },
  },
  woodcarving: {
    employerType: 'carpentry', type: 'shift', durationHours: 3, energy: 10,
    pay: 22, xp: 28, skill: 'carpentry', skillXp: 20, rep: 1,
    hours: [9, 15], dailySlots: 1,
    requires: { level: 2 },
  },
  cartwright_helper: {
    employerType: 'carters', type: 'shift', durationHours: 4, energy: 18,
    pay: 28, xp: 34, skill: 'carpentry', skillXp: 20, rep: 1,
    hours: [8, 13], dailySlots: 1,
    requires: { level: 2 },
  },
  bricklaying: {
    employerType: 'builders', type: 'shift', durationHours: 4, hourly: [2, 8], perHour: 7, energy: 20, when: 'sites',
    pay: 28, xp: 34, skill: 'construction', skillXp: 25, rep: 1,
    hours: [7, 13], dailySlots: 1,
    requires: { level: 2 },
  },
  bookkeeping: {
    employerType: 'warehouse', type: 'shift', durationHours: 3, energy: 6,
    pay: 30, xp: 36, skill: 'trading', skillXp: 20, rep: 1,
    hours: [9, 14], dailySlots: 1,
    requires: { level: 3, reputation: 4 },
  },
  ferry_rowing: {
    employerType: 'fishery', type: 'shift', durationHours: 2, hourly: [1, 4], perHour: 6, energy: 14, tips: true,
    pay: 12, xp: 16, skill: 'fishing', skillXp: 8, rep: 1,
    hours: [7, 18], dailySlots: 1,
    requires: { level: 1 },
  },

  // Out in the fields and woods.
  shepherding: {
    employer: 'farm', type: 'outing', place: 'pasture', durationHours: 4, energy: 10,
    pay: 18, xp: 22, skill: 'farming', skillXp: 12, rep: 1,
    hours: [6, 12], seasons: ['spring', 'summer', 'autumn'], dailySlots: 1,
    requires: { level: 1 },
  },
  beekeeping: {
    employer: 'store', type: 'outing', place: 'meadow', durationHours: 3, energy: 10, yield: { item: 'honey', qty: [2, 4] },
    pay: 16, xp: 22, skill: 'foraging', skillXp: 15, rep: 1,
    hours: [8, 15], seasons: ['spring', 'summer'], dailySlots: 1,
    requires: { level: 1 },
  },
  gamekeeping: {
    employer: 'lumberyard', type: 'outing', place: 'forest', durationHours: 3, energy: 12,
    pay: 20, xp: 26, skill: 'hunting', skillXp: 15, rep: 1,
    hours: [6, 14], dailySlots: 1,
    requires: { level: 2 },
  },
  tree_planting: {
    employer: 'lumberyard', type: 'plant', item: 'sapling', qty: 6, piece: 4,
    pay: 24, xp: 26, skill: 'foraging', skillXp: 12, rep: 1,
    hours: [6, 16], dailySlots: 2,
    requires: { level: 1 },
  },
  mushroom_foraging: {
    employer: 'tavern', type: 'outing', place: 'forest', durationHours: 2, energy: 10, yield: { item: 'mushroom', qty: [3, 6] },
    pay: 12, xp: 18, skill: 'foraging', skillXp: 15, rep: 1,
    hours: [6, 16], seasons: ['summer', 'autumn'], dailySlots: 2,
    requires: { level: 1 },
  },
  resin_tapping: {
    employerType: 'warehouse', type: 'outing', place: 'pines', durationHours: 3, energy: 12, yield: { item: 'resin', qty: [2, 4] },
    pay: 18, xp: 24, skill: 'woodcutting', skillXp: 12, rep: 1,
    hours: [7, 15], seasons: ['spring', 'summer', 'autumn'], dailySlots: 1,
    requires: { level: 2, tool: 'axe' },
  },
  charcoal_burning: {
    employer: 'smithy', type: 'outing', place: 'clearing', durationHours: 5, energy: 20, yield: { item: 'coal', qty: [3, 5] },
    pay: 30, xp: 36, skill: 'woodcutting', skillXp: 15, rep: 1,
    hours: [6, 12], dailySlots: 1,
    requires: { level: 2, tool: 'axe' },
  },
};
Object.assign(JOBS, MORE_JOBS);

/**
 * Pay and progress in a line of work (JobSystem):
 *   ranks   — the more often you've done a job, the better you're paid (newcomer → hand → skilled → master)
 *   bargain — ask for more before you start (once a day): the better they know and trust you, the likelier
 *   speed   — deliveries finished within this many hours of taking them earn a premium
 *   tips    — a share of the pay, more with charm
 */
export const JOB_PAY = {
  ranks: [
    { id: 'newcomer', from: 0, mult: 1 },
    { id: 'hand', from: 4, mult: 1.08 },
    { id: 'skilled', from: 12, mult: 1.18 },
    { id: 'master', from: 30, mult: 1.3 },
  ],
  bargainUp: 0.15, // they agree: this much more
  bargainHalf: 0.07, // they meet you halfway
  bargainBase: 0.3,
  speedHours: 3,
  speedPremium: 0.1,
  tipBase: 0.06,
  tipPerCharisma: 0.02,
  tipLuck: 0.15,
  pieceShare: 0.9, // each unit you bring beyond what was asked is paid at this share of the rate
  pieceMax: 1, // …up to this many times the amount asked for again
  villageReserve: 30, // the village won't pay out its last coins for odd jobs
  counterUp: 0.3, // a counter-offer on a villager's request asks this much more
  stallRent: 5,
};

/** Openings are posted at dawn; at midday the board is topped up with this share of them again. */
export const JOB_REFRESH = { middayHour: 12, middayShare: 0.5 };
