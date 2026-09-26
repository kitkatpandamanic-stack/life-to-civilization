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

/** Openings are posted at dawn; at midday the board is topped up with this share of them again. */
export const JOB_REFRESH = { middayHour: 12, middayShare: 0.5 };
