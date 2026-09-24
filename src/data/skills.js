/**
 * Skills improve through practice (skill XP) and through skill points earned on level-up.
 * Every skill listed here has a real gameplay effect — see systems/Modifiers.js.
 */
export const SKILLS = {
  woodcutting: { category: 'gathering', icon: '🪓' },
  mining: { category: 'gathering', icon: '⛏️' },
  foraging: { category: 'gathering', icon: '🫐' },
  fishing: { category: 'gathering', icon: '🎣' },
  hunting: { category: 'gathering', icon: '🏹' },
  farming: { category: 'agriculture', icon: '🌾' },
  construction: { category: 'construction', icon: '🔨' },
  carpentry: { category: 'crafting', icon: '🪚' },
  smithing: { category: 'crafting', icon: '⚒️' },
  cooking: { category: 'crafting', icon: '🍳' },
  trading: { category: 'commerce', icon: '⚖️' },
  negotiation: { category: 'commerce', icon: '🤝' },
  leadership: { category: 'leadership', icon: '👑' },
  learning: { category: 'knowledge', icon: '📖' },
  exploration: { category: 'knowledge', icon: '🧭' },
};

export const SKILL_CATEGORIES = ['gathering', 'agriculture', 'construction', 'crafting', 'commerce', 'leadership', 'knowledge'];
