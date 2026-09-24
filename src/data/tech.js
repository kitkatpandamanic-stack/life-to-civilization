/**
 * Know-how the village can discover.
 *
 * Nobody picks technologies from a menu: they're worked out by the people
 * doing the work. Carpenters who build every day eventually come up with a
 * handcart; farmers who've read a little try rotating their crops; a village
 * with a school learns to write things down. Each technology gathers
 * progress daily from:
 *   - villagers in the listed occupations who worked that day (more for skilled ones),
 *   - the village's accumulated knowledge (reading, schooling, ruins, relics),
 *   - you, if you have the related skill (you share what you know).
 * When progress reaches `cost`, the village has it — for good.
 *
 * needs: prerequisites (biz: a business of that type exists; tech: techs known;
 *        pop: villagers; knowledge: village knowledge points; built: buildings
 *        villagers have built; civic: a civic building exists)
 * effects: multipliers used by other systems (see TechSystem.mod)
 */
export const TECHS = {
  handcart: { cost: 14, needs: { biz: 'carpentry' }, from: ['carpenter', 'carpenter_hand'], skill: 'carpentry', icon: '🛒' },
  better_tools: { cost: 16, needs: { biz: 'smithy' }, from: ['blacksmith', 'smith_hand'], skill: 'smithing', icon: '⚒️', effects: { gather_output: 1.15 } },
  crop_rotation: { cost: 22, needs: { biz: 'farm', knowledge: 3 }, from: ['farmer', 'farmhand'], skill: 'farming', icon: '🌾', effects: { farm_output: 1.2 } },
  masonry: { cost: 24, needs: { biz: 'quarry', built: 2 }, from: ['quarry_foreman', 'miner', 'master_builder', 'builder'], skill: 'construction', icon: '🧱', effects: { build_labor: 0.8 } },
  herbal_medicine: { cost: 18, needs: { knowledge: 6 }, from: [], hobby: 'gardening', icon: '🌿', effects: { sickness: 0.6 } },
  draft_animals: { cost: 30, needs: { tech: ['handcart'], biz: 'farm', pop: 24 }, from: ['farmer', 'carter_master', 'carter'], icon: '🐴', effects: { farm_output: 1.1 } },
  writing: { cost: 20, needs: { civic: 'school', knowledge: 8 }, from: [], school: true, icon: '✒️', effects: { learning: 1.25 } },
  wagons: { cost: 38, needs: { tech: ['draft_animals', 'better_tools'], biz: 'carpentry' }, from: ['carpenter', 'blacksmith', 'carter_master'], skill: 'carpentry', icon: '🛞' },
  milling: { cost: 30, needs: { tech: ['masonry'], biz: 'farm', pop: 28 }, from: ['baker', 'farmer', 'master_builder', 'miller'], icon: '⚙️' },
  printing: { cost: 45, needs: { tech: ['writing'], civic: 'library', pop: 32 }, from: [], school: true, icon: '📰', effects: { rumor_distort: 0.4, learning: 1.15 } },
  // Towards civilization: travel by water, watered fields, stone bridges and proper accounts.
  boats: { cost: 32, needs: { tech: ['handcart'], biz: 'fishery' }, from: ['fisher', 'fisherman', 'carpenter', 'carpenter_hand'], skill: 'carpentry', icon: '⛵' },
  irrigation: { cost: 34, needs: { tech: ['crop_rotation'], biz: 'farm', pop: 30 }, from: ['farmer', 'farmhand'], skill: 'farming', icon: '💧', effects: { farm_output: 1.15 } },
  stone_bridges: { cost: 36, needs: { tech: ['masonry'], pop: 30 }, from: ['master_builder', 'builder', 'quarry_foreman', 'miner'], skill: 'construction', icon: '🌉', effects: { build_labor: 0.9, road_cost: 0.7 } },
  bookkeeping: { cost: 28, needs: { tech: ['writing'], pop: 28 }, from: ['shopkeeper', 'store_clerk', 'merchant', 'innkeeper'], school: true, icon: '📒', effects: { export_price: 1.04 } },
};

export const TECH_TUNING = {
  perWorker: 0.18, // progress per day per worker in a related trade (×(1 + level/6))
  perKnowledge: 0.04, // progress per day per village knowledge point (capped)
  knowledgeCap: 1.2,
  perPlayerSkill: 0.12, // progress per day per level of your related skill (from level 3)
  hobbyist: 0.25, // e.g. gardeners working out herbal medicine
  school: 0.6, // a school with a teacher, per day
};

/**
 * Civic buildings the village raises for itself (see GrowthSystem.considerProjects):
 * a school for the children, a library to keep what people know, a mill.
 * when: conditions for the village to start one.
 */
export const CIVIC = {
  school: { when: { pop: 20, children: 3 } },
  library: { when: { civic: 'school', knowledge: 6, pop: 24 } },
  mill: { when: { tech: 'milling' }, effects: { farm_output: 1.1 } },
};

export const EDUCATION = {
  schoolHours: [8.5, 13],
  perDay: 1, // education points per school day (× teacher quality)
  teacherStipend: 20, // per week, from the village treasury
  levelPerEducation: 0.12, // a grown child's head start
  mentorXp: 6, // weekly bonus XP for an apprentice working beside a master
  mentorGap: 2,
  inheritedLevel: 0.25, // share of a parent's level a child picks up at home
  skilledLevel: 6, // villagers this experienced carry know-how worth passing on
  lostKnowledge: 2, // points lost when such a person dies with no apprentice (and no library)
};
