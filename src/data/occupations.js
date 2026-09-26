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
 * restDay   — weekday off (0 = Monday … 6 = Sunday); shops stay open, run by the owner
 */
export const OCCUPATIONS = {
  elder: { workplace: null, wake: 7, sleep: 21 },
  child: { workplace: null, wake: 7, sleep: 20 },
  unemployed: { workplace: null, wake: 7, sleep: 22, seeksJob: true },

  shopkeeper: { workplace: 'store', start: 8, end: 19, activity: 'inside', wake: 6, sleep: 22 },
  store_clerk: { workplace: 'store', restDay: 2, start: 8, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22, wage: 12 },
  innkeeper: { workplace: 'tavern', start: 9, end: 23, activity: 'inside', wake: 8, sleep: 24 },
  tavern_server: { workplace: 'tavern', restDay: 0, start: 12, end: 22, activity: 'inside', wake: 8, sleep: 23, wage: 12 },
  // Farm work is seasonal: nothing grows in winter, so there is no field work.
  farmer: { workplace: 'farm', restDay: 6, start: 6, end: 17, lunch: true, activity: 'farm', wake: 5, sleep: 21, seasons: ['spring', 'summer', 'autumn'] },
  farmhand: { workplace: 'farm', restDay: 6, start: 7, end: 17, lunch: true, activity: 'farm', wake: 6, sleep: 22, wage: 14, seasons: ['spring', 'summer', 'autumn'] },
  lumber_foreman: { workplace: 'lumberyard', restDay: 6, start: 7, end: 17, lunch: true, activity: 'spot', wake: 6, sleep: 22 },
  woodcutter: { workplace: 'lumberyard', restDay: 6, start: 7, end: 17, lunch: true, activity: 'chop', wake: 6, sleep: 22, wage: 15 },
  quarry_foreman: { workplace: 'quarry', restDay: 6, start: 7, end: 17, lunch: true, activity: 'spot', wake: 6, sleep: 22 },
  miner: { workplace: 'quarry', restDay: 6, start: 7, end: 17, lunch: true, activity: 'mine', wake: 6, sleep: 22, wage: 16 },
  blacksmith: { workplace: 'smithy', restDay: 6, start: 8, end: 18, lunch: true, activity: 'spot', wake: 7, sleep: 22 },
  // Trades villagers can open businesses in (see businessTypes.js).
  hunter: { workplace: 'business', restDay: 0, start: 5, end: 13, activity: 'inside', wake: 4, sleep: 21, wage: 13 },
  // Early industry (see businessTypes.js brickworks / sawmill / factory).
  brickmaker: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22 },
  clay_digger: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'mine', wake: 6, sleep: 22, wage: 14 },
  sawyer: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22 },
  sawmill_hand: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22, wage: 14 },
  factory_master: { workplace: 'business', restDay: 6, start: 7, end: 18, lunch: true, activity: 'inside', wake: 6, sleep: 22 },
  factory_hand: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'inside', wake: 6, sleep: 22, wage: 15 },
  miller: { workplace: 'business', start: 6, end: 17, lunch: true, activity: 'inside', wake: 5, sleep: 21, restDay: 6 },
  mill_hand: { workplace: 'business', restDay: 6, start: 6, end: 16, lunch: true, activity: 'inside', wake: 5, sleep: 22, wage: 13 },
  baker: { workplace: 'business', start: 5, end: 14, activity: 'inside', wake: 4, sleep: 21 },
  baker_hand: { workplace: 'business', restDay: 0, start: 5, end: 14, lunch: true, activity: 'inside', wake: 4, sleep: 21, wage: 12 },
  carpenter: { workplace: 'business', restDay: 6, start: 8, end: 18, lunch: true, activity: 'inside', wake: 7, sleep: 22 },
  carpenter_hand: { workplace: 'business', restDay: 6, start: 8, end: 17, lunch: true, activity: 'inside', wake: 7, sleep: 22, wage: 13 },
  fisherman: { workplace: 'business', restDay: 6, start: 5, end: 14, lunch: true, activity: 'fish', wake: 4, sleep: 21 },
  fisher: { workplace: 'business', restDay: 6, start: 5, end: 14, lunch: true, activity: 'fish', wake: 4, sleep: 21, wage: 12 },
  merchant: { workplace: 'business', restDay: 6, start: 7, end: 18, activity: 'inside', wake: 6, sleep: 22 },
  warehouse_hand: { workplace: 'business', restDay: 6, start: 6, end: 16, lunch: true, activity: 'inside', wake: 5, sleep: 21, wage: 13 },
  carter_master: { workplace: 'business', restDay: 6, start: 6, end: 17, lunch: true, activity: 'inside', wake: 5, sleep: 21 },
  carter: { workplace: 'business', restDay: 6, start: 6, end: 17, lunch: true, activity: 'inside', wake: 5, sleep: 21, wage: 13 },
  master_builder: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'build', wake: 6, sleep: 22 },
  builder: { workplace: 'business', restDay: 6, start: 7, end: 17, lunch: true, activity: 'build', wake: 6, sleep: 22, wage: 14 },
  smith_hand: { workplace: 'business', restDay: 6, start: 8, end: 18, lunch: true, activity: 'inside', wake: 7, sleep: 22, wage: 13 },
  // A post at a school (SchoolSystem): lessons are their work; paid weekly by whoever runs the school.
  teacher: { workplace: null, wake: 6, sleep: 22 },
  // Posts for the learned (AcademiaSystem), paid from the village fund: the clinic, the village's works, the institute.
  doctor: { workplace: null, wake: 6, sleep: 22 },
  engineer: { workplace: null, wake: 6, sleep: 22 },
  researcher: { workplace: null, wake: 7, sleep: 23 },
  // Hired by the player: what they do comes from their assignment (see WorkerSystem).
  hired_hand: { workplace: 'player', start: 7, end: 17, lunch: true, activity: 'assigned', wake: 6, sleep: 22 },
};
