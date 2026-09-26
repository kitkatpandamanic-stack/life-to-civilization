/**
 * Education and knowledge (see EducationSystem).
 *
 * Every villager carries a knowledge profile:
 *   npc.edu = {
 *     know:     { field: 0–100 }   what they understand (school, books, teachers, masters, practice)
 *     exp:      { field: 0–100 }   what they've actually done (years at the work)
 *     apt:      { aptitude: 1–100 } how they learn — no single "intelligence"
 *     mot:      0–100               how much they want to learn right now
 *     interest: id | null, istr: 0–100   what they're drawn to (grows in adolescence; can change later)
 *     level:    highest schooling finished (EDU_LEVELS)
 *   }
 * Knowledge and experience are kept apart: a graduate may know a great deal
 * and have done little; an old hand the reverse. The best have both.
 *
 * New fields can be added here without touching the systems: give them a
 * category, the aptitudes that help, and (optionally) the player skill they
 * match and the occupations that practise them.
 */

/**
 * Knowledge fields.
 * cat   — basic | practical | advanced | social
 * apt   — aptitudes that make it easier to learn
 * skill — the player's matching skill (its level counts as knowledge)
 * icon  — for the UI
 */
export const KNOWLEDGE = {
  // Basic
  reading: { cat: 'basic', apt: ['memory', 'analytic'], skill: 'learning', icon: '📖' },
  writing: { cat: 'basic', apt: ['memory', 'creative'], icon: '✒️' },
  maths: { cat: 'basic', apt: ['analytic'], icon: '🔢' },
  lore: { cat: 'basic', apt: ['memory'], skill: 'exploration', icon: '🗺️' },
  // Practical
  farming: { cat: 'practical', apt: ['practical'], skill: 'farming', icon: '🌾' },
  forestry: { cat: 'practical', apt: ['practical'], skill: 'woodcutting', icon: '🪓' },
  mining: { cat: 'practical', apt: ['practical'], skill: 'mining', icon: '⛏️' },
  fishing: { cat: 'practical', apt: ['practical'], skill: 'fishing', icon: '🎣' },
  hunting: { cat: 'practical', apt: ['practical'], skill: 'hunting', icon: '🏹' },
  cooking: { cat: 'practical', apt: ['practical', 'creative'], skill: 'cooking', icon: '🍳' },
  carpentry: { cat: 'practical', apt: ['practical', 'creative'], skill: 'carpentry', icon: '🪚' },
  smithing: { cat: 'practical', apt: ['practical'], skill: 'smithing', icon: '⚒️' },
  building: { cat: 'practical', apt: ['practical'], skill: 'construction', icon: '🔨' },
  mechanics: { cat: 'practical', apt: ['practical', 'analytic'], icon: '⚙️' },
  // Advanced
  engineering: { cat: 'advanced', apt: ['analytic', 'practical'], needs: { maths: 30 }, icon: '📐' },
  science: { cat: 'advanced', apt: ['analytic', 'memory'], needs: { reading: 30 }, icon: '🔬' },
  medicine: { cat: 'advanced', apt: ['memory', 'analytic'], needs: { reading: 35 }, icon: '⚕️' },
  architecture: { cat: 'advanced', apt: ['creative', 'analytic'], needs: { maths: 30 }, icon: '🏛️' },
  economics: { cat: 'advanced', apt: ['analytic'], needs: { maths: 25 }, icon: '📊' },
  management: { cat: 'advanced', apt: ['social', 'analytic'], icon: '📋' },
  // Social / professional
  leadership: { cat: 'social', apt: ['social'], skill: 'leadership', icon: '👑' },
  speech: { cat: 'social', apt: ['social', 'memory'], icon: '🗣️' },
  trade: { cat: 'social', apt: ['social', 'analytic'], skill: 'trading', icon: '⚖️' },
  negotiation: { cat: 'social', apt: ['social'], skill: 'negotiation', icon: '🤝' },
};

export const KNOWLEDGE_CATEGORIES = ['basic', 'practical', 'advanced', 'social'];

/** Named levels of understanding: [threshold, id]. */
export const KNOW_LEVELS = [
  [0, 'unknown'],
  [1, 'heard'],
  [10, 'basic'],
  [25, 'practical'],
  [45, 'advanced'],
  [65, 'expert'],
  [85, 'master'],
];

/** How people learn. Aptitudes are fixed-ish (born with, shaped in childhood); temperament too. */
export const APTITUDES = ['analytic', 'practical', 'social', 'creative', 'memory'];
export const TEMPERAMENT = ['curiosity', 'discipline'];

/** Traits nudge aptitudes and temperament (a scholar reads more; a hard worker sticks at it). */
export const TRAIT_APTITUDE = {
  scholar: { analytic: 12, memory: 8, curiosity: 12 },
  hard_worker: { discipline: 15, practical: 5 },
  lazy: { discipline: -18, curiosity: -5 },
  friendly: { social: 12 },
  natural_leader: { social: 10, discipline: 5 },
  entrepreneur: { creative: 8, analytic: 4 },
  risk_taker: { curiosity: 8, discipline: -6 },
  careful: { discipline: 8, memory: 4 },
  aggressive: { social: -10 },
  ambitious: { discipline: 6 },
  generous: { social: 5 },
  greedy: { analytic: 3, social: -3 },
  loyal: { discipline: 4 },
};

/** Schooling finished, lowest first. */
export const EDU_LEVELS = ['none', 'primary', 'secondary', 'vocational', 'university'];

/**
 * What each occupation practises: [main field, secondary fields…].
 * Working a day adds experience (and a little knowledge) in these.
 */
export const OCC_FIELDS = {
  farmer: ['farming', 'management', 'trade'],
  farmhand: ['farming'],
  woodcutter: ['forestry'],
  lumber_foreman: ['forestry', 'management'],
  miner: ['mining'],
  quarry_foreman: ['mining', 'management'],
  blacksmith: ['smithing', 'mechanics', 'trade'],
  smith_hand: ['smithing'],
  carpenter: ['carpentry', 'trade'],
  carpenter_hand: ['carpentry'],
  baker: ['cooking', 'trade'],
  baker_hand: ['cooking'],
  innkeeper: ['cooking', 'speech', 'trade'],
  tavern_server: ['speech', 'cooking'],
  shopkeeper: ['trade', 'maths', 'negotiation'],
  store_clerk: ['trade', 'maths'],
  merchant: ['trade', 'negotiation', 'economics'],
  warehouse_hand: ['trade'],
  miller: ['mechanics', 'farming', 'trade'],
  brickmaker: ['building', 'management', 'trade'],
  clay_digger: ['mining'],
  sawyer: ['carpentry', 'management', 'trade'],
  sawmill_hand: ['carpentry'],
  factory_master: ['mechanics', 'management', 'trade'],
  factory_hand: ['mechanics'],
  mill_hand: ['mechanics'],
  fisherman: ['fishing', 'trade'],
  fisher: ['fishing'],
  hunter: ['hunting'],
  carter_master: ['mechanics', 'management', 'trade'],
  carter: ['mechanics'],
  master_builder: ['building', 'architecture', 'management'],
  builder: ['building'],
  teacher: ['speech', 'reading'],
  researcher: ['science', 'maths'],
  doctor: ['medicine', 'science', 'speech'],
  engineer: ['engineering', 'maths', 'building'],
  elder: [],
  child: [],
  unemployed: [],
};

/** What you do for your employer (WorkerSystem assignments) → the field it practises. */
export const ASSIGNMENT_FIELDS = { gather_wood: 'forestry', gather_stone: 'mining', farm: 'farming', build: 'building', workshop: 'carpentry' };

/** Hobbies teach a little too. */
export const HOBBY_FIELDS = { reading: 'reading', gardening: 'farming', whittling: 'carpentry', fishing: 'fishing', hunting: 'hunting', cards: 'maths', gossip: 'speech' };

/**
 * Interests: what a young villager is drawn to. They grow out of what the
 * child sees at home, what they're good at, their hobbies, their teachers,
 * and what the village offers — and they sway later choices without forcing them.
 */
export const INTERESTS = {
  land: { fields: ['farming', 'forestry', 'hunting', 'fishing'], apt: ['practical'], hobbies: ['gardening', 'fishing', 'hunting', 'walking'], icon: '🌱' },
  crafts: { fields: ['carpentry', 'smithing', 'cooking'], apt: ['practical', 'creative'], hobbies: ['whittling'], icon: '🛠️' },
  building: { fields: ['building', 'architecture', 'carpentry'], apt: ['practical', 'creative'], hobbies: ['whittling'], icon: '🏗️' },
  machines: { fields: ['mechanics', 'engineering', 'smithing'], apt: ['analytic', 'practical'], hobbies: [], icon: '⚙️' },
  trade: { fields: ['trade', 'negotiation', 'economics', 'management'], apt: ['social', 'analytic'], hobbies: ['cards'], icon: '⚖️' },
  science: { fields: ['science', 'medicine', 'maths', 'reading'], apt: ['analytic', 'memory'], hobbies: ['reading'], icon: '🔬' },
  people: { fields: ['speech', 'leadership', 'medicine'], apt: ['social'], hobbies: ['gossip', 'cards'], icon: '🗣️' },
};

export const EDU = {
  // Learning speed: aptitude 50 and motivation 50 learn at 1×.
  aptBase: 0.55, // + aptitude/100 × aptSpan  (50 → 1.0, 90 → 1.36, 20 → 0.73)
  aptSpan: 0.9,
  motBase: 0.45, // + motivation/100 × motSpan (50 → 1.0, 30 → 0.78, 95 → 1.5)
  motSpan: 1.1,
  interestBonus: 1.2, // learning what you're interested in
  roomFloor: 0.06, // even near the top you still inch forward

  // Practice: a day's work.
  expPerDay: 0.5, // experience per worked day in the main field (×room)
  expSecondary: 0.25,
  practiceKnowPerDay: 0.12, // what practice teaches you of the theory…
  practiceKnowCap: 60, // …up to about here; beyond that you need teaching or books
  xpKnowBonus: 250, // work XP × (0.85 + knowledge/xpKnowBonus): theory makes practice pay
  competenceKnowWeight: { basic: 0.6, practical: 0.4, advanced: 0.65, social: 0.45 },

  // Competence at work → productivity: 0.88 … 1.16
  prodBase: 0.88,
  prodSpan: 0.0028,
  // Hiring: an employer's view of the applicant's competence in the trade.
  hireBase: 0.7,
  hireSpan: 0.8, // × (hireBase + competence/100 × hireSpan)

  // Childhood at home (weekly).
  homeSpeech: 0.9, // talking with the family
  homeReading: 0.35, // being read to, from age 4, if a parent reads (× parent's reading/50)
  homeTrade: 0.4, // watching a parent at their trade (age 6+), up to homeTradeCap
  homeTradeCap: 22,
  homeCuriosity: 0.4,

  // Hobbies (weekly, if practised).
  hobbyKnow: 0.5,
  hobbyCap: 45,

  // Motivation (weekly): moves this share of the way toward what their life suggests.
  motEase: 0.25,
  // Interests (weekly, from age 10).
  interestFrom: 10,
  interestGain: 5, // strength per week the same interest leads
  interestSwitchMargin: 2.5,
  adultInterestChance: 0.04, // grown-ups sometimes take to something new

  // Knowledge fades a little without use (weekly, above this).
  fadeAbove: 30,
  fade: 0.05,
};

// ------------------------------------------------------------------ schools (see SchoolSystem)

/**
 * Kinds of school. Each is a real building the village (or you) puts up.
 *   building   — the building type (buildings.js / villageBuildings.js)
 *   stages     — the classes it can run (STAGES); a class runs only with a teacher who knows enough
 *   seats      — pupils it holds comfortably (more squeeze in, and everyone learns less)
 *   perTeacher — pupils one teacher can really teach
 *   evening    — runs evening classes for grown-ups
 */
export const SCHOOL_TYPES = {
  school: { building: 'school', stages: ['primary', 'upper'], seats: 16, perTeacher: 12, evening: true, icon: '📚' },
  grammar: { building: 'grammar_school', stages: ['upper'], seats: 24, perTeacher: 10, evening: true, icon: '🎓' },
  // A trade school: a year's course in a trade (see data/careers.js COURSES) — days for the young, evenings for grown-ups starting over.
  trade: { building: 'trade_school', stages: ['vocational', 'trade_evening'], seats: 12, perTeacher: 8, evening: false, icon: '🛠️' },
};

/** Building type → school kind. */
export const SCHOOL_BUILDINGS = Object.fromEntries(Object.entries(SCHOOL_TYPES).map(([k, d]) => [d.building, k]));

/**
 * What a class teaches.
 *   ages      — who it's for (a pupil may stay on a little longer to finish)
 *   hours     — when lessons run (weekdays; Sunday off). Evening classes: two evenings a week.
 *   subjects  — the day's lessons: field → share of the day
 *   pass      — what a pupil must know to finish (the exam at the end of the school year)
 *   minYears  — the least time it takes
 *   teacher   — what the teacher must know to run the class at all
 *   level     — schooling finished (EDU_LEVELS)
 */
export const STAGES = {
  primary: {
    ages: [6, 12], hours: [8.5, 13], minYears: 3, level: 'primary',
    subjects: { reading: 0.3, writing: 0.22, maths: 0.25, lore: 0.12, science: 0.05, speech: 0.1 },
    pass: { reading: 40, writing: 28, maths: 32 },
    teacher: { reading: 28, maths: 22 },
  },
  upper: {
    ages: [11, 17], hours: [8.5, 14], minYears: 2, level: 'secondary', after: 'primary',
    subjects: { maths: 0.26, science: 0.2, lore: 0.14, reading: 0.1, writing: 0.1, economics: 0.08, speech: 0.06, building: 0.06 },
    pass: { maths: 50, science: 30, reading: 55, lore: 35 },
    teacher: { maths: 45, reading: 45 },
  },
  // Trade courses: what they teach comes from the course's trade (data/careers.js); the instructor must be competent at it.
  vocational: {
    ages: [14, 20], hours: [8.5, 13], minYears: 1, level: 'vocational', after: 'primary', course: true,
  },
  trade_evening: {
    ages: [18, 50], hours: [18, 20], days: [1, 3], minYears: 1, level: 'vocational', course: true, adult: true, // Tuesdays and Thursdays
  },
  evening: {
    ages: [16, 70], hours: [18, 20], days: [0, 3], minYears: 0, adult: true, // Mondays and Thursdays (0 = Monday)
    subjects: { reading: 0.4, writing: 0.3, maths: 0.3 },
    teacher: { reading: 30 },
  },
};

export const SCHOOL = {
  dayPts: 1.0, // learning on offer in a full school day (× subject share × quality)
  eveningPts: 1.2, // an evening class (shorter, but grown-ups came on purpose)
  crowdCap: 1.3, // more pupils than seats × this: no room for newcomers
  booksPerPupil: 2, // books and slates a pupil needs
  booksWear: 0.25, // per pupil per week
  bookPrice: 3,
  budgetPerPupil: 2, // what the village spends on books a week, per pupil (× schooling policy)
  // Teachers: pay a week from the village fund (× schooling policy), by rank.
  salary: { junior: 40, teacher: 48, senior: 56, master: 66 },
  ranks: [['junior', 0], ['teacher', 40], ['senior', 150], ['master', 330]], // days taught
  masterKnow: 60, // a master teacher also knows their subjects deeply
  quitUnpaidWeeks: 3,
  minTeachingScore: 18,
  farWalk: 55, // tiles from home: a long walk to school — they miss days (more in winter)
  // Families and school: teenagers from hard-up homes may be kept home to work.
  poorHousehold: 25,
  workAge: 12,
  dropoutMot: 22, // a teenager this unwilling may stop going
  failLimit: 2, // failed the year this often: they leave (they can come back to it later)
  eveningMot: 55, // grown-ups this keen (and not yet literate) go to evening classes
  recruitAfter: 14, // days without a teacher before the village sends word to the towns for one
};
