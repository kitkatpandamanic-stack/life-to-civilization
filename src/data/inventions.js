/**
 * Inventions — things YOU can work out at a workbench (the village's own technologies are in tech.js).
 *
 * skill/min  — your skill, and the level you need to try
 * hours      — work it takes (in two-hour sessions)
 * materials  — used up when you start (for the model and the trials)
 * needs      — technologies the valley must already know
 * effects    — once it exists, everyone benefits (TechSystem.mod): the same keys as tech.js
 * payers     — business types that pay you a royalty each week while your patent lasts
 * royalty    — $ a week from each of them
 * rivals     — trades whose villagers might be working on the same idea
 */
export const INVENTIONS = {
  seed_drill: { icon: '🌱', skill: 'farming', min: 4, hours: 16, materials: { planks: 4, iron_ingot: 1 }, needs: ['crop_rotation'], effects: { farm_output: 1.08 }, payers: ['farm'], royalty: 6, rivals: ['farmer', 'farmhand'] },
  steel_axe: { icon: '🪓', skill: 'smithing', min: 4, hours: 14, materials: { iron_ingot: 3, planks: 1 }, needs: ['better_tools'], effects: { gather_output: 1.08 }, payers: ['lumberyard', 'quarry'], royalty: 4, rivals: ['blacksmith', 'smith_hand'] },
  timber_crane: { icon: '🏗️', skill: 'construction', min: 4, hours: 20, materials: { planks: 8, iron_ingot: 2 }, needs: ['masonry'], effects: { build_labor: 0.92 }, payers: ['builders'], royalty: 6, rivals: ['master_builder', 'builder'] },
  kiln_flue: { icon: '🧱', skill: 'construction', min: 3, hours: 12, materials: { bricks: 8, stone: 6 }, needs: ['brickmaking'], effects: { build_labor: 0.96 }, payers: ['brickworks'], royalty: 6, rivals: ['brickmaker', 'clay_digger'] },
  treadle_saw: { icon: '🪚', skill: 'carpentry', min: 4, hours: 14, materials: { planks: 6, iron_ingot: 1 }, needs: ['sawing'], effects: { gather_output: 1.04 }, payers: ['sawmill', 'carpentry'], royalty: 5, rivals: ['carpenter', 'carpenter_hand', 'sawyer'] },
  preserving_jars: { icon: '🫙', skill: 'cooking', min: 4, hours: 10, materials: { glass: 3 }, needs: [], effects: { sickness: 0.95 }, payers: ['bakery', 'tavern', 'general_store'], royalty: 3, rivals: ['baker', 'baker_hand', 'innkeeper'] },
  mine_pump: { icon: '⛽', skill: 'smithing', min: 5, hours: 24, materials: { iron_ingot: 5, planks: 4 }, needs: ['steam_engine'], effects: { gather_output: 1.08 }, payers: ['quarry', 'mining_camp'], royalty: 8, rivals: ['blacksmith', 'factory_master'] },
  counting_frame: { icon: '🧮', skill: 'trading', min: 5, hours: 12, materials: { planks: 2 }, needs: ['bookkeeping'], effects: { learning: 1.05 }, payers: ['general_store', 'warehouse', 'trading_post'], royalty: 5, rivals: ['merchant', 'shopkeeper'] },
};

export const INVENT = {
  sessionMinutes: 120, // one sitting at the bench
  sessionEnergy: 12,
  skillSpeed: 0.25, // each level above the minimum: a quarter faster
  setbackBase: 0.14, // a sitting that goes wrong (less likely the better you are)
  setbackPerLevel: 0.03,
  setbackLoss: 60, // minutes of work lost to a setback
  patentDays: 3 * 56, // how long a patent lasts (three years)
  royaltyWeekday: 2,
  rivalChance: 0.55, // someone's working on the same idea (by a fixed hash)
  rivalPerDay: 50, // a rival's minutes of progress a day (more for the skilled)
  rivalSlower: 1.6, // they need this much more work than you (no bench, no notes)
  licenceBase: 40, // a licence for another town: this…
  licencePerPop: 0.6, // …plus this per person there
  knowledge: 3, // what an invention adds to the valley's knowledge
};
