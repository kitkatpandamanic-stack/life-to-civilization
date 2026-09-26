/**
 * What villagers can remember.
 *
 * imp   — importance 1–5. It decides how long the memory lasts (see RETENTION_DAYS);
 *         importance 5 memories are part of the villager's life story and never fade.
 * val   — how it felt, −5 (terrible) … +5 (wonderful). Colours mood and dialogue.
 * bond  — how it changes the villager's view of the person involved ("who"):
 *         f = friendship, t = trust, r = respect, c = conflict
 * merge — repeated memories of the same kind about the same person within this many
 *         days are merged into one (with a count) instead of piling up
 * share — the villager may tell friends about it (gossip → reputation)
 *
 * Only notable things are remembered — never every chat or purchase.
 */
export const MEMORY_KINDS = {
  // ---- with the player
  met_player: { imp: 1, val: 0 },
  player_gave_job: { imp: 5, val: 4, bond: { f: 10, t: 25, r: 10 }, share: true }, // hired while out of work
  player_hired: { imp: 3, val: 2, bond: { t: 8, r: 4 } },
  // ---- stories (StorySystem)
  player_took_side: { imp: 4, val: -3, bond: { f: -8, t: -10, c: 12 }, share: true }, // you sided against them in a quarrel
  player_made_peace: { imp: 4, val: 3, bond: { f: 6, t: 8, r: 10 }, share: true },
  became_settler: { imp: 5, val: 3, bond: { t: 8, r: 6 }, share: true }, // went to live in your settlement
  family_alliance: { imp: 5, val: 4, bond: { f: 10, t: 12, r: 6 }, share: true }, // their child married into your family
  match_refused: { imp: 4, val: -3, bond: { f: -8, r: -4, c: 10 }, share: true }, // you turned down their match
  inherited_grudge: { imp: 3, val: -2, bond: { t: -6, c: 8 } }, // they hated your parent, and don't trust you
  player_found_kin: { imp: 5, val: 5, bond: { f: 20, t: 20, r: 10 }, share: true },
  player_helped_stranger: { imp: 5, val: 4, bond: { f: 12, t: 15, r: 5 }, share: true },
  player_fired: { imp: 4, val: -3, bond: { f: -10, t: -20, c: 15 }, share: true },
  player_fired_unfair: { imp: 5, val: -4, bond: { f: -18, t: -35, c: 30 }, share: true },
  player_raise: { imp: 2, val: 2, bond: { t: 5, f: 2 }, merge: 14 },
  player_pay_cut: { imp: 3, val: -2, bond: { t: -8, c: 8 }, merge: 14 },
  player_unpaid: { imp: 3, val: -3, bond: { t: -12, c: 10 }, merge: 14, share: true },
  player_promoted: { imp: 4, val: 3, bond: { t: 10, r: 12 } },
  player_gift: { imp: 1, val: 1, bond: { t: 1 }, merge: 7 },
  player_loved_gift: { imp: 2, val: 2, bond: { t: 2 }, merge: 7 },
  player_helped: { imp: 3, val: 3, bond: { t: 8, r: 5 }, share: true },
  player_let_down: { imp: 3, val: -2, bond: { t: -10 }, share: true },
  player_did_job: { imp: 1, val: 1, bond: { r: 1, t: 1 }, merge: 14 },
  player_failed_job: { imp: 2, val: -2, bond: { t: -4, r: -2 } },
  bought_from_player: { imp: 2, val: 1, bond: { r: 2 }, merge: 28 },
  quit_player: { imp: 3, val: -2, bond: { t: -5 } },
  heard_player_good: { imp: 2, val: 1, bond: { t: 3, r: 2 } },
  heard_player_bad: { imp: 2, val: -1, bond: { t: -5, c: 2 } },
  saw_friend_fired: { imp: 2, val: -2, bond: { t: -5 } },

  // ---- life and work
  got_job: { imp: 4, val: 3, bond: { t: 5, r: 3 } }, // who = the boss
  quit_job: { imp: 4, val: -3, bond: { t: -15, c: 15 } }, // walked out (e.g. unpaid)
  unpaid_wages: { imp: 2, val: -2, bond: { t: -3, c: 3 }, merge: 7 },
  promoted_rank: { imp: 3, val: 3 },
  grew_up: { imp: 5, val: 2 },
  took_up_hobby: { imp: 2, val: 1 },
  was_sick: { imp: 2, val: -2, merge: 14 },
  went_hungry: { imp: 2, val: -3, merge: 14 },
  slept_rough: { imp: 3, val: -3, merge: 14 },
  lived_through: { imp: 3, val: -1 }, // a drought, cold snap... (params.event)

  // ---- family and home
  fell_in_love: { imp: 4, val: 4, bond: { f: 8, t: 8 } },
  broke_up: { imp: 3, val: -3, bond: { f: -15, t: -10, c: 10 } },
  married: { imp: 5, val: 5, bond: { t: 15 } },
  family_wedding: { imp: 3, val: 2 },
  child_born: { imp: 5, val: 5 },
  sibling_born: { imp: 3, val: 2 },
  family_died: { imp: 5, val: -5 },
  friend_died: { imp: 4, val: -3 },
  inherited: { imp: 5, val: 1 },
  took_over_business: { imp: 5, val: 3 },
  retired: { imp: 5, val: 1 },
  went_exploring: { imp: 4, val: 3 }, // params.region_name
  invented: { imp: 5, val: 5 }, // params.tech
  became_teacher: { imp: 4, val: 3 },
  mentored_by: { imp: 4, val: 3, bond: { f: 4, t: 6 } },
  took_apprentice: { imp: 3, val: 2 },
  new_interest: { imp: 3, val: 2 }, // params.interest — took to something new
  finished_school: { imp: 4, val: 4 }, // params.edu_level
  left_school: { imp: 3, val: -1 },
  failed_exam: { imp: 3, val: -3 },
  finished_course: { imp: 4, val: 4 }, // params.field — a trade-school course
  finished_apprenticeship: { imp: 5, val: 5, bond: { r: 8, t: 6, f: 4 } }, // params.field; who = the master
  apprenticeship_ended: { imp: 3, val: -2 },
  wants_retrain: { imp: 2, val: 1 }, // params.field
  rose_in_trade: { imp: 4, val: 4 }, // params.tier, params.field
  went_to_university: { imp: 5, val: 4 }, // params.settlement, params.field
  child_to_university: { imp: 4, val: 3 }, // params.npc, params.settlement
  graduated: { imp: 5, val: 5 }, // params.settlement, params.field
  failed_degree: { imp: 4, val: -4 },
  cant_afford_study: { imp: 3, val: -3 }, // params.settlement
  took_post: { imp: 4, val: 3 }, // params.post
  made_discovery: { imp: 5, val: 5 }, // params.tech
  // You and their learning (StudySystem)
  sponsored_by_player: { imp: 6, val: 6, bond: { t: 20, r: 12, f: 10 } }, // you paid for their studies; params.settlement
  took_player_apprentice: { imp: 4, val: 3, bond: { f: 4, t: 4 } }, // they took you on; params.field
  taught_player: { imp: 2, val: 1, bond: { f: 2, r: 1 } }, // they gave you a lesson; params.field
  player_journeyman: { imp: 4, val: 4, bond: { r: 8, f: 5 } }, // you finished your apprenticeship with them
  explored_with_player: { imp: 4, val: 3, bond: { f: 5, t: 6 } },
  moved_home: { imp: 3, val: 1 },
  moved_out: { imp: 4, val: 2 },
  evicted: { imp: 4, val: -4, bond: { t: -25, f: -10, c: 25 }, share: true },
  bought_home: { imp: 5, val: 4 },
  sold_home_to_player: { imp: 3, val: 0, bond: { r: 3 } },
  rented_from_player: { imp: 3, val: 2, bond: { t: 6, r: 2 } }, // moved into a house you let
  sold_business_to_player: { imp: 5, val: 1, bond: { r: 5 } },

  // ---- business and career
  opened_business: { imp: 5, val: 5 },
  family_business: { imp: 4, val: 2 },
  business_struggling: { imp: 3, val: -3 },
  business_failed: { imp: 5, val: -5 },
  became_manager: { imp: 4, val: 4, bond: { r: 8, t: 6 } },
  laid_off: { imp: 4, val: -4, bond: { t: -10, c: 10 } },
  laid_off_season: { imp: 2, val: -1 }, // seasonal farm work over for the year
  changed_jobs: { imp: 3, val: 1 },
  employee_left: { imp: 2, val: -1, bond: { t: -5, f: -3 } },
  left_player_for_business: { imp: 5, val: 3, bond: { r: 6 } },
  backed_business: { imp: 4, val: 1, bond: { t: 5 } },
  got_backing: { imp: 5, val: 4, bond: { t: 15, f: 10, r: 8 } },

  // ---- goals (see GoalSystem)
  goal_achieved: { imp: 4, val: 4 }, // params.goal
  became_headman: { imp: 5, val: 5 },
  bank_loan: { imp: 3, val: 2 },
  goal_given_up: { imp: 3, val: -2 },
  moved_near_work: { imp: 3, val: 2 },
  decided_to_leave: { imp: 3, val: -1 },
  stayed_for_family: { imp: 3, val: 0, bond: { f: 4, t: 4 } },
  player_backed_dream: { imp: 5, val: 4, bond: { f: 10, t: 18, r: 8 }, share: true },
  player_asked_stay: { imp: 4, val: 2, bond: { f: 8, t: 6 } },
  player_let_down_backer: { imp: 3, val: -2, bond: { t: -6 } }, // couldn't pay you back in full

  // ---- building and moving
  started_building: { imp: 4, val: 3 },
  helped_build: { imp: 3, val: 2, bond: { f: 8, t: 8 } },
  built_home: { imp: 5, val: 5 },
  improved_building: { imp: 3, val: 3 },
  gave_up_building: { imp: 4, val: -4 },
  arrived_village: { imp: 5, val: 2 },
  friend_left: { imp: 3, val: -2 },
  player_helped_build: { imp: 3, val: 3, bond: { f: 6, t: 10, r: 6 }, merge: 14, share: true },
  bought_land: { imp: 4, val: 3 },
  developed_row: { imp: 5, val: 4 },
  // ---- renting
  given_notice: { imp: 5, val: -4, bond: { f: -5, t: -10 } }, // put out of a home they paid for
  notice_for_arrears: { imp: 3, val: -2, bond: { t: -2 } },
  rent_raised: { imp: 2, val: -2, bond: { f: -2 }, merge: 21 },
  rent_lowered: { imp: 2, val: 2, bond: { f: 3, t: 2 }, merge: 21 },
  bought_rental: { imp: 4, val: 3 },
  moved_for: { imp: 4, val: 3 }, // moved to a home that suits them better (and why)
  manages_player_houses: { imp: 3, val: 2, bond: { t: 4 } },
  sold_land_to_player: { imp: 3, val: 1, bond: { t: 3 } },

  // ---- disasters
  home_flood: { imp: 4, val: -3 },
  home_storm: { imp: 3, val: -2 },
  home_fire: { imp: 4, val: -4 },
  home_burnt: { imp: 5, val: -5 },
  mine_accident: { imp: 5, val: -5 },
  took_in: { imp: 4, val: 1, bond: { f: 10, t: 8 } },
  fire_helped: { imp: 4, val: 3, bond: { f: 12, t: 15, r: 8 }, merge: 7 },
  player_fought_fire: { imp: 5, val: 4, bond: { f: 15, t: 20, r: 15 }, share: true },

  // ---- other villagers
  became_friends: { imp: 3, val: 2 },
  fell_out: { imp: 3, val: -2, bond: { t: -5 } },
  argued_with: { imp: 2, val: -1, bond: { c: 6, f: -3 }, merge: 14 },
};

/** How many days a memory of each importance lasts. */
export const RETENTION_DAYS = [0, 10, 28, 84, 224, Infinity];
export const MAX_MEMORIES = 36;
