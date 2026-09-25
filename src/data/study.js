/**
 * Your own education, and what you can do for other people's (see StudySystem).
 */

/** The player skill a field of knowledge trains (studying it makes the skill come faster). */
export const FIELD_SKILL = {
  reading: 'learning', writing: 'learning', maths: 'trading', lore: 'exploration', science: 'learning',
  farming: 'farming', forestry: 'woodcutting', mining: 'mining', fishing: 'fishing', hunting: 'hunting',
  cooking: 'cooking', carpentry: 'carpentry', smithing: 'smithing', building: 'construction', mechanics: 'carpentry',
  engineering: 'construction', architecture: 'construction', medicine: 'learning', economics: 'trading', management: 'leadership',
  leadership: 'leadership', speech: 'negotiation', trade: 'trading', negotiation: 'negotiation',
};

export const STUDY_PLAYER = {
  // Classes (evening classes at the school, evening courses at the trade school): 2 hours.
  classMinutes: 120,
  classPts: 3.5, // what a lesson offers you (× the lesson's quality) — you came to learn, and it shows
  xpPerPoint: 9, // skill XP for each point of knowledge you gain
  courseFee: 20, // a trade course, paid when you sign up
  courseLessons: 12, // lessons to finish a course (and know enough of the trade)
  coursePass: 30,
  // Private lessons with someone learned: an hour.
  tutorMinutes: 60,
  tutorPts: 2.2,
  tutorFeeBase: 6,
  tutorMinKnow: 40,
  // Apprenticed to a master: half a working day beside them.
  apprenticeMinutes: 240,
  apprenticePts: 1.6,
  apprenticeXp: 30,
  apprenticeWage: 5,
  apprenticeSessions: 12, // then you're a journeyman
  masterAccepts: 25, // the master's trust in you (and their competence) must be at least this
  // You as a teacher.
  teachMinutes: 120,
  teachSkill: 5, // a skill level this high, or knowledge 50, to give a lesson
  teachReputation: 1,
  masterSkill: 6, // to take an apprentice yourself
  // Reading at the library.
  readMinutes: 60,
  readPts: 0.9,
  // A week at a university (while you're in the town — JourneyPanel).
  uniWeekFee: 25,
  uniWeeks: 8, // to take a degree (and knowledge 45 of it)
  uniPts: 9,
  // Giving.
  booksGift: 30, // money → books for a school
  booksPerGift: 10,
  endowWeeks: 4, // a gift of this many weeks of teachers' pay
  researchGift: 100,
  // Studying makes the skill come faster: skill XP × (1 + studied knowledge / this).
  studyXpBonus: 250,
};

/** Institutions you can found (you pay to build; the village runs them). */
export const FOUNDABLE = {
  school: { needs: null },
  trade_school: { needs: { civic: 'school' } },
  grammar_school: { needs: { civic: 'school' } },
  institute: { needs: { civic: 'library' } },
};
