/**
 * Your workforce: kinds of work, priorities, how many can work at one place, and the
 * time limits that keep workers from ever getting stuck (see WorkerSystem).
 */

/** Kinds of work a hired hand can do. */
export const JOB_CATS = ['construction', 'hauling', 'gathering', 'farming', 'workshop', 'maintenance'];
export const PRIORITIES = ['high', 'medium', 'low', 'off'];
export const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1, off: 0 };

/**
 * What a worker does by default, from the job you gave them (the old single assignment
 * becomes a focus: that work first, and what goes with it when there's none).
 */
export const FOCUS = {
  idle: { construction: 'medium', hauling: 'medium', gathering: 'medium', farming: 'medium', workshop: 'low', maintenance: 'medium' }, // a general hand
  build: { construction: 'high', hauling: 'high', gathering: 'low', farming: 'off', workshop: 'off', maintenance: 'medium' },
  gather_wood: { construction: 'off', hauling: 'low', gathering: 'high', farming: 'off', workshop: 'off', maintenance: 'off' },
  gather_stone: { construction: 'off', hauling: 'low', gathering: 'high', farming: 'off', workshop: 'off', maintenance: 'off' },
  farm: { construction: 'off', hauling: 'low', gathering: 'off', farming: 'high', workshop: 'off', maintenance: 'off' },
  workshop: { construction: 'off', hauling: 'medium', gathering: 'low', farming: 'off', workshop: 'high', maintenance: 'off' },
  haul: { construction: 'low', hauling: 'high', gathering: 'medium', farming: 'off', workshop: 'off', maintenance: 'low' }, // a carrier
  repair: { construction: 'medium', hauling: 'medium', gathering: 'off', farming: 'off', workshop: 'off', maintenance: 'high' }, // a repair hand
};

/** The trade each kind of work trains (education fields — see data/education.js). */
export const WORK_FIELDS = { build: 'building', repair: 'building', gather_wood: 'forestry', gather_stone: 'mining', farm: 'farming', workshop: 'carpentry', haul: null, buy: 'trade', charvest: 'farming', crepair: 'building', chaul: 'trade', cfetch: 'trade', cbuy: 'trade', corder: 'trade', cpost: 'trade', csite: 'trade', cshift: null, gather_berries: 'farming', cwater: 'farming', csaw: 'carpentry' };

/** What a worker is called from what they're best at. */
export const PROFESSIONS = { building: 'builder', forestry: 'woodcutter', mining: 'miner', farming: 'farmer', carpentry: 'carpenter', trade: 'carrier' };

export const WORKFORCE = {
  gatherRadii: [22, 40, 64, 100], // look for trees and rocks close by first, then further out
  gatherMinutes: 70,
  workBlockMinutes: 60, // one stint of building, repairing, crafting
  farmMinutes: 20,
  carryLoad: 20,
  tilesPerWorker: 5, // a site takes one worker per this many tiles of footprint…
  maxPerSite: 6, // …up to this many
  haulersPerSite: 2,
  repairBelow: 75, // buildings of yours below this condition get repaired
  repairPerBlock: 12, // condition points one stint of repair restores
  // Never stuck: how long a state may last before the watchdog steps in (game minutes).
  waitRetry: 20, // no work found: look again after this
  stuckWalking: 150,
  stuckWorking: 60, // this long past the end of a stint
  stuckWaiting: 120,
  blockFor: 120, // a task a worker couldn't reach or do is left alone this long
  // Buying materials the site needs with your money (you can turn it off).
  buyBudgetPerDay: 150,
  // Experience from the work itself (education practice points per stint / trip).
  practice: 1.2,
  xpPerStint: 6,
};

/** Worker states, for the status line and the debugger. */
export const WORKER_STATES = ['idle', 'seeking', 'moving', 'working', 'waiting', 'need_materials', 'resting', 'eating', 'returning_home', 'sleeping', 'unavailable', 'failed'];
