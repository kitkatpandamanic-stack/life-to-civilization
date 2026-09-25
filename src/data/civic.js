/**
 * How the village governs itself, what it founds, and what it becomes (see CivicSystem).
 *
 * INSTITUTIONS are founded by the village council when the village needs them
 * (`when`), paid for from the civic fund (its building's materials plus labour) (a share of the taxes, set aside week
 * by week) and housed in a building the villagers raise. Once open they change
 * how the village works (`effects`, multipliers read through TechSystem.mod,
 * plus the special behaviour described next to each).
 *
 * STATUS is what the valley's settlement is — earned from its population and
 * its institutions, never bought with a button.
 */
export const INSTITUTIONS = {
  // Market charter: a market hall and a weekly market. Traders bring news of prices
  // in every settlement the valley trades with, and exports fetch a little more.
  market: { building: 'market_hall', when: { pop: 22, shops: 3 }, effects: { export_price: 1.08 }, icon: '🏷️' },
  // Night watch: fires are caught early; the roads out of the valley are patrolled.
  watch: { building: 'watch_house', when: { pop: 24 }, effects: { fire_risk: 0.55, road_danger: 0.7 }, icon: '🛡️' },
  // Healer's house (needs herbal medicine): less sickness.
  clinic: { building: 'clinic', when: { pop: 22, tech: 'herbal_medicine' }, effects: { sickness: 0.6 }, icon: '⚕️' },
  // Craft guild: masters teach, standards rise — everyone learns their trade faster.
  guild: { building: 'guild_hall', when: { pop: 26, skilled: 4 }, effects: { learning: 1.15 }, icon: '🛠️' },
  // Savings bank (needs bookkeeping): lends to villagers starting businesses, and pays you interest.
  bank: { building: 'bank', when: { pop: 28, businesses: 7, tech: 'bookkeeping' }, effects: {}, icon: '💰' },
};

/** The order a council considers founding them (the headman can change it — or you, if you're headman). */
export const INSTITUTION_ORDER = ['market', 'watch', 'clinic', 'guild', 'bank'];

/** What the valley's settlement is. Each step needs people and institutions. */
export const VILLAGE_STATUS = [
  { id: 'village', pop: 0, institutions: 0 },
  { id: 'large_village', pop: 26, institutions: 1 },
  // A town needs a working school and people who can read; a city, more of them — and some with degrees.
  { id: 'town', pop: 34, institutions: 3, needs: ['market'], school: true, literacy: 0.3 },
  { id: 'city', pop: 55, institutions: 5, needs: ['market', 'bank'], school: true, literacy: 0.45, graduates: 2 },
];

export const CIVIC_TUNING = {
  yearDays: 56, // elections once a year
  firstElectionDay: 50,
  councilSize: 3, // besides the headman
  candidates: 4,
  standReputation: 15, // you can stand for headman once your reputation reaches this…
  standMinDays: 28, // …and you've lived in the valley this long
  headmanStipend: 12, // a week, from the treasury
  fundShare: 0.35, // share of the week's taxes set aside for the next institution
  labourMargin: 1.3, // founding one costs its materials plus this much again for the labour
  statusAttraction: 0.4, // each step up draws newcomers
  bankRate: 0.005, // weekly interest the bank pays on your savings
  bankLoanMax: 250, // the bank lends a founder up to this much
  bankLoanRate: 0.12,
  bankCapital: 300, // what the village puts into its new bank
  moodTax: 3, // mood effect of high or low taxes on business owners and landlords
  moodRelief: 4, // mood effect of generous or mean poor relief on the hard-up
};

/** Policies a headman sets. Multipliers apply to taxes and poor relief. */
export const POLICIES = {
  tax: { low: 0.6, normal: 1, high: 1.4 },
  relief: { low: 0.5, normal: 1, high: 1.6 },
  // Schools: teachers' pay and books (tight: families pay a small fee too).
  schooling: { low: 0.6, normal: 1, high: 1.5 },
};

/** Deeds your family is remembered for, and what each is worth to its renown. */
export const DEEDS = {
  'chronicle.player_built': 2,
  'chronicle.outpost_founded': 6,
  'chronicle.hamlet_founded': 8,
  'chronicle.road_started_player': 8,
  'chronicle.player_backed_opened': 5,
  'chronicle.player_kept_villager': 3,
  'chronicle.player_ambition': 6,
  'chronicle.player_elected': 10,
  'chronicle.player_reelected': 5,
  'chronicle.institution_founded_player': 12,
  'chronicle.village_status_player': 15,
  'chronicle.player_opened_business': 6,
  'chronicle.player_bought_business': 3,
  'chronicle.player_benefactor': 4,
  'chronicle.player_upgraded': 2,
  // Education (StudySystem)
  'chronicle.player_founded_school': 10,
  'chronicle.player_sponsored': 5,
  'chronicle.player_taught': 2,
  'chronicle.player_school_gift': 3,
  'chronicle.player_research_gift': 3,
  'chronicle.player_took_apprentice': 3,
  'chronicle.journeyman_player': 4,
  'chronicle.player_degree': 5,
};

export const LEGACY = {
  goodwillPerRenown: 0.2, // an heir starts with this much trust from each villager per point of family renown…
  goodwillMax: 25, // …up to this
  voteRenown: 0.08, // renown's weight in how people vote for you
};
