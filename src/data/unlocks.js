/**
 * What each level unlocks. Change the numbers here to rebalance progression.
 * Systems check sim.progression.hasUnlock(key) before allowing an action.
 */
export const UNLOCKS = [
  { key: 'basic_jobs', level: 1 },
  { key: 'crafting', level: 2 }, // craft at the workbench in your home
  { key: 'advanced_gathering', level: 3 }, // mine ore, quarry work
  { key: 'hire_worker', level: 5 }, // hire your first worker
  { key: 'buy_land', level: 6 }, // buy a plot of land
  { key: 'construction', level: 7 }, // build on your land
  { key: 'farming', level: 7 }, // fields on your land
  { key: 'start_business', level: 10 }, // open your own workshop
  { key: 'more_workers', level: 12 },
  { key: 'advanced_workshop', level: 15 },
  { key: 'multiple_businesses', level: 20 },
  { key: 'settlement', level: 30 },
];

/** How many workers you can employ: base, +1 per this many Leadership points/levels. */
export const WORKER_LIMITS = { base: 1, perLeadership: 3, moreWorkersBonus: 2 };
