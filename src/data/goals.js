/**
 * What villagers want out of life (see GoalSystem).
 *
 * A goal is chosen by weighing everything about the villager's situation —
 * personality, money, needs, relationships, opportunities in the village,
 * what they remember, and how the village is doing. Once chosen, it sticks
 * (people don't change their life plans every day) and it changes what they
 * actually do: what they spend, which jobs they take, where they live, who
 * they court, whether they stay.
 *
 * Goal types:
 *   grow           children
 *   home           find a roof (homeless, or sleeping in the village hall)
 *   job            find work
 *   legacy         the retired: pass on what they know
 *   steady         a quiet, contented life
 *   save           put money aside (the hard-up, the careful, parents)
 *   buy_house      stop renting: own a home
 *   business       open a business of their own
 *   master         become a master of their trade
 *   better_job     move to a better job (pay, the boss, the trade they know)
 *   grow_business  expand the business they own
 *   family         find a partner — or, once married, have children
 *   settle         move closer to work (outposts far out: hamlets grow this way)
 *   leave          give up on the valley and move away
 */
export const GOAL_TYPES = ['grow', 'home', 'job', 'legacy', 'steady', 'save', 'buy_house', 'business', 'master', 'better_job', 'grow_business', 'family', 'settle', 'leave'];

/** Reasons that weigh against a goal (shown apart: "holding them back"). */
export const GOAL_AGAINST = ['friends_here', 'family_here', 'player_friend', 'owns_home_here', 'out_of_reach', 'failed_before'];

export const GOALS = {
  commitment: 1.5, // a goal already being pursued gets this bonus when reconsidered…
  switchMargin: 0.3, // …and a new one must beat it by this much as well
  // Giving up: a goal held this long with no result is dropped (memory, mood).
  giveUpDays: { save: 168, buy_house: 252, business: 252, master: 392, better_job: 98, grow_business: 168, family: 196, settle: 112 },
  saveWeeks: 1.5, // "enough put aside" = this many weeks of pay
  minSaveTarget: 40,
  businessTarget: 400, // what an aspiring founder wants to have saved
  houseBuyReserve: 1.05, // a determined buyer keeps a smaller cushion (normal: HOUSING.buyReserve)
  masterXpMult: 1.2, // practising on purpose
  settleDistance: 28, // tiles from home to work before the walk becomes a reason to move
  settleNear: 16, // a home this close to work is "near"
  familyCourtMult: 2.2, // looking for someone: courtship is likelier…
  familyCourtEase: 10, // …and starts at a lower friendship
  familyBirthMult: 1.7,
  growBusinessExpand: 0.65, // expanding owners take on staff at this share of the usual cash
  leaveHoldDays: 14, // a villager thinking of leaving decides only after this long…
  leavePackDays: 4, // …then packs for a few days (you can still talk them round)
  leaveMinPush: 2.5, // below this much discontent, nobody even thinks of leaving
  stayAskCooldown: 7,
  stayKeepDays: 42, // talked into staying: they give it another go for this long
  poachWageMult: 1.2, // your worker leaves for a job paying this much more than you do
  backMin: 40, // backing a founder: at least this much
  backShareMax: 0.35,
  historyKeep: 6, // goals achieved, remembered on the villager
};
