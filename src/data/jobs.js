/**
 * Job definitions — the work the player can take on for village businesses.
 *
 * type:
 *   harvest  — harvest ripe crops on the employer's field, then bring them back
 *   deliver  — gather resources anywhere, then deliver them to the employer
 *   courier  — pick up a package at the employer and deliver it to a house
 *   shift    — work a timed shift inside the workplace (time fast-forwards)
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
};
