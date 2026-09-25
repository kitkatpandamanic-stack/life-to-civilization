/**
 * Higher learning (see AcademiaSystem): universities in the towns beyond the
 * valley, degrees, the posts graduates can fill at home, and research.
 */

/**
 * Universities: the bigger settlements have them (the valley is too small —
 * its young people travel to study). Each teaches some fields better than
 * others: that's what the place is known for.
 *   fields  — degrees it offers, with how good it is at each (× the lessons)
 *   tuition — a year's fees; living — a week's keep while there
 */
export const UNIVERSITIES = {
  market_town: { fields: { economics: 1.2, management: 1.15, architecture: 1.05, science: 1.0, medicine: 0.95, engineering: 0.95 }, tuition: 90, living: 9 },
  saltmere: { fields: { medicine: 1.2, science: 1.1, economics: 0.95 }, tuition: 80, living: 8 },
  ironford: { fields: { engineering: 1.25, science: 0.95 }, tuition: 70, living: 7, college: true },
};

/**
 * Degrees: what you need to get in, what you study, and what it makes you.
 *   entry      — knowledge needed to be admitted
 *   subjects   — what the lessons cover (field → share)
 *   profession — the post it fits you for at home (POSTS), if any
 */
export const DEGREES = {
  engineering: { entry: { maths: 45, reading: 35 }, subjects: { engineering: 0.5, maths: 0.2, science: 0.15, mechanics: 0.15 }, profession: 'engineer' },
  medicine: { entry: { reading: 50, science: 20 }, subjects: { medicine: 0.55, science: 0.3, reading: 0.15 }, profession: 'doctor' },
  science: { entry: { reading: 45, maths: 40 }, subjects: { science: 0.55, maths: 0.25, reading: 0.2 }, profession: 'researcher' },
  architecture: { entry: { maths: 40, reading: 35 }, subjects: { architecture: 0.5, engineering: 0.2, maths: 0.15, building: 0.15 }, profession: 'engineer' },
  economics: { entry: { maths: 40, reading: 40 }, subjects: { economics: 0.5, maths: 0.2, trade: 0.15, management: 0.15 }, profession: null },
  management: { entry: { reading: 40, maths: 30 }, subjects: { management: 0.5, economics: 0.2, leadership: 0.15, speech: 0.15 }, profession: null },
};

/** Which degree an interest leads to (first that the student can get into and a university offers). */
export const INTEREST_DEGREES = {
  machines: ['engineering', 'science'],
  building: ['architecture', 'engineering'],
  science: ['science', 'medicine', 'engineering'],
  people: ['medicine', 'management'],
  trade: ['economics', 'management'],
  land: ['science'],
  crafts: ['engineering', 'architecture'],
};

export const STUDY = {
  minAge: 16,
  maxAge: 28,
  minMot: 55,
  weeklyPts: 1.4, // lessons a week (× the university's standing in the field × the student)
  years: 2, // a degree takes two years
  passShare: 0.75, // the final exam: knowledge of the degree's main field ≥ this × 60
  mainPass: 60,
  scholarshipTalent: 72, // a gifted student (best aptitude) with little money may get a place for free
  villageBursaryTreasury: 500, // a village fund this full (and a generous schooling policy) pays for a gifted pupil
  returnBase: 0.5, // coming home: family, friends, and work for them here pull; the town pulls the other way
  alumniKeep: 20,
  recallChance: 0.35, // a graduate who stayed away may come home when a post opens for them
};

/**
 * Posts graduates (and the learned) can fill at home, paid from the village fund.
 *   building   — where they work (a finished building of this type; 'hall' for the village)
 *   field      — what they must know, and how well
 *   salary     — a week (× the schooling policy)
 *   effects    — what the post does for the valley at full strength (scaled by how good the holder is)
 */
export const POSTS = {
  doctor: { building: 'clinic', field: 'medicine', min: 50, salary: 55, hours: [8, 16], effects: { sickness: 0.7 } },
  engineer: { building: 'hall', field: 'engineering', min: 50, salary: 50, hours: [8, 16], effects: { build_labor: 0.85, road_cost: 0.8 } },
  researcher: { building: 'institute', field: 'science', min: 50, salary: 45, hours: [9, 17] },
};

/**
 * Research projects (worked on at a research institute). Each ends in a new
 * technology (data/tech.js, research: true) — if it works.
 *   fields      — what the researchers must know, and how well (the project's difficulty)
 *   researchers — how many it really needs
 *   cost        — research points to finish
 *   equipment   — instruments and materials to buy before it starts
 *   funding     — a week, while it runs
 */
export const PROJECTS = {
  improved_plough: { fields: { engineering: 45, farming: 35 }, researchers: 1, cost: 40, equipment: 60, funding: 15 },
  seed_selection: { fields: { science: 45, farming: 35 }, researchers: 1, cost: 45, equipment: 50, funding: 15 },
  lime_mortar: { fields: { architecture: 45, science: 35 }, researchers: 1, cost: 45, equipment: 60, funding: 15 },
  field_medicine: { fields: { medicine: 55, science: 40 }, researchers: 1, cost: 55, equipment: 80, funding: 20 },
  surveying: { fields: { maths: 55, engineering: 40 }, researchers: 1, cost: 40, equipment: 50, funding: 12 },
  water_wheel: { fields: { engineering: 55, mechanics: 40 }, researchers: 2, cost: 70, equipment: 120, funding: 25 },
  blast_furnace: { fields: { science: 55, smithing: 45 }, researchers: 2, cost: 80, equipment: 140, funding: 30 },
};

export const RESEARCH = {
  perResearcherDay: 0.9, // points a day from a researcher who knows exactly enough (more if they know more)
  equipmentWear: 0.05, // a week
  successAt: 1.0, // research quality (knowledge vs difficulty, equipment, funding, team) at which success is very likely
  partialKeep: 0.55, // a partial result keeps this much progress (and teaches the team)
  failKeep: 0.2,
  fameOnDiscovery: 40,
  famousAt: 50,
};
