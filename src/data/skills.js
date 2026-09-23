/**
 * Skills improve through practice (skill XP) and through skill points earned on level-up.
 * Every skill listed here has a real gameplay effect — see systems/Modifiers.js.
 *
 * Future categories (construction, crafting, leadership, ...) will be added
 * together with the systems that use them, so no skill is purely decorative.
 */
export const SKILLS = {
  woodcutting: { category: 'gathering', icon: '🪓' },
  mining: { category: 'gathering', icon: '⛏️' },
  foraging: { category: 'gathering', icon: '🫐' },
  farming: { category: 'agriculture', icon: '🌾' },
  trading: { category: 'commerce', icon: '⚖️' },
  negotiation: { category: 'commerce', icon: '🤝' },
  smithing: { category: 'crafting', icon: '⚒️' },
  learning: { category: 'knowledge', icon: '📖' },
};

export const SKILL_CATEGORIES = ['gathering', 'agriculture', 'commerce', 'crafting', 'knowledge'];
