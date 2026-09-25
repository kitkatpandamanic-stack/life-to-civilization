/**
 * Contracting: what villagers need done and how much it matters to them, how big a job is,
 * what it takes (hands, skill, materials), what it costs you, how a job is judged when it's
 * done, what that does for your name — and running it all as a business.
 * (Numbers for ContractSystem / ContractPlanner.)
 */

/** Kinds of work, by trade (for the board, the history and your standing). */
export const JOB_CATEGORIES = {
  harvest: 'agriculture',
  water: 'agriculture',
  build: 'construction',
  repair: 'repair',
  haul: 'transport',
  supply: 'business',
  craft: 'business',
  order: 'business',
  gather: 'resources',
  job: 'transport',
};
/** Notice-board jobs by type. */
export const JOB_TYPE_CATEGORY = { shift: 'business', deliver: 'transport', courier: 'transport', rounds: 'transport', haul: 'transport', harvest: 'agriculture' };

/** Small · medium · large · major project — from the hands a job wants and how much there is to do. */
export const SIZES = [
  { id: 'small', hands: 1, work: 0 },
  { id: 'medium', hands: 2, work: 0 },
  { id: 'large', hands: 5, work: 0 },
  { id: 'major', hands: 99, work: 0 }, // (a new building or a big extension)
];

/** How pressing a need is (0–1) and how much it matters (0–1) → priority. */
export const PRIORITY = {
  urgencyWeight: 0.6,
  importanceWeight: 0.4,
  urgentFrom: 0.65, // above this: urgent (a shorter deadline, and they'd pay more to have it now)
  deadlineStretch: 0.6, // days × (1 + stretch × (1 − urgency))
  waterBelow: 0.5, // share of a farm's growing plants still dry before the farmer wants help
  waterMin: 10,
  gatherBelow: 0.4, // a lumberyard or quarry this short of its own stock asks for gatherers
  gatherSize: 16,
  gatherPay: 1.35, // × the goods' price
};

/**
 * Bigger jobs from people who know you: a client you've worked for well wants more of you.
 * trust = successful jobs for them (less for late, much less for failed).
 */
export const PROPOSALS = {
  upgradeTrust: 2, // improving their building (a new level, a room, a renovation)
  buildTrust: 3, // a new building for them (a barn-warehouse for a farmer, a shop, a house to let)
  buildMoney: 1.1, // they must have this × the materials put by (unless you bring the materials)
  laborPay: 4.2, // per hour of building work
  playerMaterialsPremium: 1.25, // you get the materials yourself: paid back with this on top, at the end
  types: { farm: 'warehouse', shop: 'shopfront', producer: 'warehouse', home: 'house' },
};

/** Materials: who gets them. */
export const MATERIAL_MODES = ['client', 'included', 'player'];

/** How long work takes (for estimates): units a worker gets through in an hour. */
export const RATES = {
  harvest: 3, // plants
  water: 6, // plants
  repair: 11, // condition points
  build: 1, // hours
  goods: 12, // items fetched and carried
  post: 2, // parcels / letters
  shift: 1,
  hoursPerDay: 8, // a worker's working day
  wageHours: 8, // a day's wage buys this many hours
};

/** Asking for more: more money, or more time. */
export const NEGOTIATION = {
  payStep: 0.2, // ask for 20% more
  timeStep: 0.5, // or half as long again (at least a day)
  base: 0.45,
  perRep: 0.006, // each point of standing over 50
  perRel: 0.004, // how they like you
  perTrust: 0.08, // each job done well for them
  urgentPay: 0.15, // urgent: they'll pay more to have it now…
  urgentTime: -0.35, // …but can't give you more time
  perIdle: -0.03, // each villager out of work who could do it instead
  greedy: -0.2,
  generous: 0.15,
  walkAway: 0.25, // pushed too far (and not fond of you): they find someone else
};

/** Judging the work: speed, skill, deadline, the job itself. */
export const QUALITY = {
  weights: { speed: 0.3, skill: 0.35, deadline: 0.2, job: 0.15 },
  grades: [
    { id: 'excellent', from: 85, pay: 0.1, xp: 1.3, rep: 5 },
    { id: 'good', from: 68, pay: 0.05, xp: 1.15, rep: 3 },
    { id: 'fair', from: 45, pay: 0, xp: 1, rep: 1 },
    { id: 'poor', from: 0, pay: -0.1, xp: 0.8, rep: -2 },
  ],
  latePerDay: 0.15, // pay docked for each day late
  graceDays: 2, // after the deadline: late (docked), then it falls through
};

/** Your name as a contractor (0–100): built from what you actually did. */
export const REPUTATION = {
  start: 50,
  late: -3,
  failed: -8,
  cancelled: -6,
  clientCancelled: 0,
  lowOffers: 30, // below this, only the urgent come to you
  sizeBonusFrom: 65, // above this, bigger jobs
};

/**
 * Your standing: from what you've done and your name. Not a ladder you climb by numbers alone —
 * both have to be there.
 */
export const STANDINGS = [
  { id: 'odd_jobs', done: 0, rep: 0, maxActive: 3, size: 1 },
  { id: 'handyman', done: 3, rep: 45, maxActive: 4, size: 1.4 },
  { id: 'contractor', done: 8, rep: 55, maxActive: 5, size: 1.9 },
  { id: 'master_contractor', done: 16, rep: 65, maxActive: 6, size: 2.6 },
];

/** From working for yourself to a firm with a name. */
export const COMPANY = {
  needStanding: 'contractor',
  needMoney: 400,
  fee: 150, // registering the firm with the village
  maxActiveBonus: 1,
  productivity: 0.05, // an organised crew works a little better
  businessTrust: 1, // businesses trust a firm: like one more job done for them
};

/** Worker roles: what each is for (and the focus it gives — see data/workforce.js FOCUS). */
export const ROLES = ['idle', 'farm', 'build', 'repair', 'gather_wood', 'gather_stone', 'haul', 'workshop'];
