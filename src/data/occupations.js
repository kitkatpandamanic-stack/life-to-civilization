/**
 * NPC occupations define daily schedules and what "work" physically looks like.
 *
 * workplace — business id (see businesses.js); null = no job
 * start/end — working hours; lunch = takes a lunch break at 12:00
 * wake/sleep — when they get up and go to bed
 * activity  — what they do at work:
 *     inside   — work inside the building (shopkeepers, innkeeper)
 *     farm     — walk between crop plots tending them
 *     chop     — find a tree, chop it down, carry the wood to the lumberyard
 *     mine     — find a rock, mine it, carry the stone to the quarry
 *     spot     — stand at a work spot (foreman, blacksmith at the anvil)
 * wage      — daily wage paid by the employer (owners pay themselves from profit)
 */
export const OCCUPATIONS = {
  elder: { workplace: null, wake: 7, sleep: 21 },
  child: { workplace: null, wake: 7, sleep: 20 },
  unemployed: { workplace: null, wake: 7, sleep: 22, seeksJob: true },

  shopkeeper: { workplace: 'store', start: 8, end: 19, activity: 'inside', wake: 6, sleep: 22 },
  store_clerk: { workplace: 'store', start: 8, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22, wage: 12 },
  innkeeper: { workplace: 'tavern', start: 9, end: 23, activity: 'inside', wake: 8, sleep: 24 },
  tavern_server: { workplace: 'tavern', start: 12, end: 22, activity: 'inside', wake: 8, sleep: 23, wage: 12 },
  // Farm work is seasonal: nothing grows in winter, so there is no field work.
  farmer: { workplace: 'farm', start: 6, end: 17, lunch: true, activity: 'farm', wake: 5, sleep: 21, seasons: ['spring', 'summer', 'autumn'] },
  farmhand: { workplace: 'farm', start: 7, end: 17, lunch: true, activity: 'farm', wake: 6, sleep: 22, wage: 14, seasons: ['spring', 'summer', 'autumn'] },
  lumber_foreman: { workplace: 'lumberyard', start: 7, end: 17, lunch: true, activity: 'spot', wake: 6, sleep: 22 },
  woodcutter: { workplace: 'lumberyard', start: 7, end: 17, lunch: true, activity: 'chop', wake: 6, sleep: 22, wage: 15 },
  quarry_foreman: { workplace: 'quarry', start: 7, end: 17, lunch: true, activity: 'spot', wake: 6, sleep: 22 },
  miner: { workplace: 'quarry', start: 7, end: 17, lunch: true, activity: 'mine', wake: 6, sleep: 22, wage: 16 },
  blacksmith: { workplace: 'smithy', start: 8, end: 18, lunch: true, activity: 'spot', wake: 7, sleep: 22 },
};
