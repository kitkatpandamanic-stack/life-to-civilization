/**
 * Perks: at skill level 3 and 7 you choose ONE of two perks for that skill.
 * The other is gone for good, so two players with the same skills can play
 * very differently. Names and descriptions: locales perk.<id>.name / .desc.
 *
 * effects — keys read by Modifiers.perk(p, key) and the systems that use them:
 *   <action>_speed / <action>_yield    chop, mine, harvest, fish (faster; extra items)
 *   save_wear_<tool>                   chance a use doesn't wear the tool
 *   quality_<skill> / masterwork_<skill>  better crafted goods; masterwork without full mastery
 *   craft_speed_<skill>, save_material_<skill>, tool_durability, double_ingot, repair_discount
 *   seed_save, crop_growth, can_capacity, fish_extra, hunt_success, hide_bonus
 *   build_speed, build_materials, worker_build, worker_slots, worker_mood, team_bonus, worker_xp
 *   buy_discount, sell_bonus, sell_<item|category>, carry, market_info
 *   food_restore, expedition_danger, expedition_food, expedition_explore, expedition_finds, vein_find
 */
export const PERK_TIERS = [3, 7];

export const PERKS = {
  // Woodcutting
  lumberjack: { skill: 'woodcutting', tier: 3, effects: { chop_speed: 0.25 } },
  forester: { skill: 'woodcutting', tier: 3, effects: { chop_yield: 1 } },
  axe_care: { skill: 'woodcutting', tier: 7, effects: { save_wear_axe: 0.5, chop_speed: 0.1 } },
  timber_merchant: { skill: 'woodcutting', tier: 7, effects: { sell_wood: 0.25, sell_planks: 0.15 } },
  // Mining
  prospector: { skill: 'mining', tier: 3, effects: { mine_yield: 1 } },
  tunneler: { skill: 'mining', tier: 3, effects: { mine_speed: 0.25 } },
  geologist: { skill: 'mining', tier: 7, effects: { vein_find: 0.04 } },
  pick_care: { skill: 'mining', tier: 7, effects: { save_wear_pickaxe: 0.5, mine_speed: 0.1 } },
  // Farming
  efficient_farmer: { skill: 'farming', tier: 3, effects: { seed_save: 0.3 } },
  master_harvester: { skill: 'farming', tier: 3, effects: { harvest_yield: 1 } },
  water_saver: { skill: 'farming', tier: 7, effects: { can_capacity: 1 } },
  agri_planner: { skill: 'farming', tier: 7, effects: { crop_growth: 0.25 } },
  // Fishing & hunting
  patient_angler: { skill: 'fishing', tier: 3, effects: { fish_speed: 0.3 } },
  net_caster: { skill: 'fishing', tier: 3, effects: { fish_extra: 0.35 } },
  tracker: { skill: 'hunting', tier: 3, effects: { hunt_success: 0.2 } },
  skinner: { skill: 'hunting', tier: 3, effects: { hide_bonus: 1 } },
  // Carpentry
  fine_joinery: { skill: 'carpentry', tier: 3, effects: { quality_carpentry: 0.6 } },
  quick_hands: { skill: 'carpentry', tier: 3, effects: { craft_speed_carpentry: 0.35 } },
  thrifty_carpenter: { skill: 'carpentry', tier: 7, effects: { save_material_carpentry: 0.25 } },
  master_carpenter: { skill: 'carpentry', tier: 7, effects: { masterwork_carpentry: 1, quality_carpentry: 0.3 } },
  // Smithing
  toolsmith: { skill: 'smithing', tier: 3, effects: { quality_smithing: 0.6 } },
  repairman: { skill: 'smithing', tier: 3, effects: { repair_discount: 0.4 } },
  tempering: { skill: 'smithing', tier: 7, effects: { tool_durability: 0.5 } },
  smelter: { skill: 'smithing', tier: 7, effects: { double_ingot: 0.35 } },
  // Cooking
  home_cook: { skill: 'cooking', tier: 3, effects: { food_restore: 0.25 } },
  quick_cook: { skill: 'cooking', tier: 3, effects: { craft_speed_cooking: 0.4 } },
  chef: { skill: 'cooking', tier: 7, effects: { quality_cooking: 0.8, masterwork_cooking: 1 } },
  caterer: { skill: 'cooking', tier: 7, effects: { sell_food: 0.25 } },
  // Construction
  builder: { skill: 'construction', tier: 3, effects: { build_speed: 0.25 } },
  frugal_builder: { skill: 'construction', tier: 3, effects: { build_materials: 0.15 } },
  foreman: { skill: 'construction', tier: 7, effects: { worker_build: 0.3 } },
  architect: { skill: 'construction', tier: 7, effects: { build_speed: 0.1, build_materials: 0.1, architect: 1 } },
  // Trading
  negotiator: { skill: 'trading', tier: 3, effects: { buy_discount: 0.08 } },
  merchant: { skill: 'trading', tier: 3, effects: { sell_bonus: 0.08 } },
  hauler: { skill: 'trading', tier: 7, effects: { carry: 15 } },
  market_analyst: { skill: 'trading', tier: 7, effects: { market_info: 1, sell_bonus: 0.03 } },
  // Leadership
  manager: { skill: 'leadership', tier: 3, effects: { worker_slots: 1 } },
  motivator: { skill: 'leadership', tier: 3, effects: { worker_mood: 10 } },
  delegator: { skill: 'leadership', tier: 7, effects: { team_bonus: 0.15 } },
  mentor: { skill: 'leadership', tier: 7, effects: { worker_xp: 0.5 } },
  // Exploration
  pathfinder: { skill: 'exploration', tier: 3, effects: { expedition_danger: 0.5 } },
  provisioner: { skill: 'exploration', tier: 3, effects: { expedition_food: 0.5 } },
  cartographer: { skill: 'exploration', tier: 7, effects: { expedition_explore: 0.5 } },
  treasure_hunter: { skill: 'exploration', tier: 7, effects: { expedition_finds: 1 } },
};

/** The two perks you choose between at a skill's tier. */
export function perkChoices(skill, tier) {
  return Object.keys(PERKS).filter((id) => PERKS[id].skill === skill && PERKS[id].tier === tier);
}
