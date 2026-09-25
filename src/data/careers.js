/**
 * Careers (see CareerSystem): how people rise in their trade, and how they
 * learn one — from a master, at a trade school, or on a business's training.
 */

/**
 * Where someone stands in their line of work, from their competence in it
 * (knowledge + experience) and their experience alone: [tier, competence, experience].
 * Shown as "junior carpenter", "master blacksmith"…
 */
export const CAREER_TIERS = [
  ['trainee', 0, 0],
  ['junior', 18, 5],
  ['worker', 32, 15],
  ['experienced', 50, 35],
  ['senior', 62, 50],
  ['master', 76, 60],
];

/** The professional rank that sets wages (NPCSystem.rank), from competence. */
export const COMPETENCE_RANKS = { regular: 30, skilled: 52, master: 74 };

/**
 * Apprenticeships: a young person (or someone starting over) works beside a
 * master of the trade, for a smaller wage, and learns faster than they could alone.
 */
export const APPRENTICE = {
  minAge: 14,
  maxAge: 24,
  retrainAge: 45, // older people starting over can still be taken on
  masterMin: 55, // competence a master needs to take an apprentice
  perDay: 0.5, // knowledge per day worked beside the master (× how good the master is at it and at teaching)
  expBonus: 1.4, // guided practice: experience grows faster
  knowCap: 80, // what a master can teach you (the rest you find out yourself)
  finishCompetence: 42, // then they're a journeyman
  minDays: 42,
  wageShare: 0.55, // of the usual wage
  familyPull: 1.5, // a master's own child is the likeliest apprentice (if they want it)
  minBusinessMoney: 120, // a workshop takes an apprentice only if it can carry the wage
};

/**
 * Trade-school courses: a year of lessons in a trade (days for the young,
 * evenings for grown-ups starting over). A course runs only with an instructor
 * who's competent at the trade.
 */
export const COURSES = {
  building: { extra: { maths: 0.15, architecture: 0.1 }, icon: '🔨' },
  carpentry: { extra: { maths: 0.1, trade: 0.05 }, icon: '🪚' },
  smithing: { extra: { mechanics: 0.15 }, icon: '⚒️' },
  mechanics: { extra: { maths: 0.15, engineering: 0.1 }, icon: '⚙️' },
  farming: { extra: { science: 0.1, trade: 0.05 }, icon: '🌾' },
  cooking: { extra: { trade: 0.1 }, icon: '🍳' },
  trade: { extra: { maths: 0.15, economics: 0.1 }, icon: '⚖️' },
  mining: { extra: { mechanics: 0.1 }, icon: '⛏️' },
};

export const VOCATIONAL = {
  share: 0.6, // of each lesson spent on the trade itself
  instructorMin: 50, // competence an instructor needs
  passCompetence: 40, // knowledge of the trade to pass
  eveningPts: 0.8,
};

/** Businesses training their own people (EnterpriseSystem owners decide; you can too). */
export const TRAINING = {
  minStaff: 2,
  startMoney: 300, // an owner needs this much in the till to start a programme
  costPerWorker: 4, // a week
  perDay: 0.3, // knowledge a day for staff at work
  cap: 70,
  academyStaff: 3, // a bigger business can set up a proper academy…
  academyMoney: 900,
  academyCost: 250, // …once, to fit it out
  academyMult: 1.8, // and its people learn faster
  stopBelow: 120,
};

/**
 * Skilled work: jobs an employer won't give to just anyone. Without qualified
 * people a vacancy stays open; after a while the business responds — better
 * pay, an apprentice, a training course, or sending for someone from the towns.
 */
export const SKILLED = {
  occupations: ['smith_hand', 'carpenter_hand', 'mill_hand', 'builder', 'baker_hand', 'carter'],
  minCompetence: 16, // below this, the applicant is a long shot (unless taken on as an apprentice)
  waitDays: 14,
  wageStep: 0.08,
  recruitMoney: 350, // a business needs this much to send for a trained worker
  recruitCompetence: 48,
  noticeEvery: 56,
};

/** Grown-ups who want a different life (interest, dissatisfaction) look for a way in. */
export const RETRAIN = { minInterest: 45, minMot: 50, maxSat: 55, maxAge: 45 };
