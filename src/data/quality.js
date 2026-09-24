/**
 * Item quality. Crafted goods (tools, furniture, cooked food) come out crude,
 * standard, fine or masterwork depending on the maker's skill, tools, perks and luck.
 * Items without a quality are standard.
 *
 * price   — sale value multiplier
 * eff     — tool efficiency multiplier (work speed)
 * dur     — tool durability multiplier
 * food    — how much a meal restores
 * comfort — furniture comfort at home
 */
export const QUALITY = [
  { id: 'crude', price: 0.65, eff: 0.85, dur: 0.7, food: 0.85, comfort: 0.7 },
  { id: 'standard', price: 1, eff: 1, dur: 1, food: 1, comfort: 1 },
  { id: 'fine', price: 1.4, eff: 1.12, dur: 1.3, food: 1.15, comfort: 1.3 },
  { id: 'masterwork', price: 2.1, eff: 1.3, dur: 1.8, food: 1.3, comfort: 1.7 },
];

export const STANDARD = 1;

/** Categories of items that carry a quality. */
export const QUALITY_CATEGORIES = new Set(['tool', 'furniture', 'food']);

export const qualityOf = (slot) => slot?.q ?? STANDARD;
export const Q = (q) => QUALITY[q ?? STANDARD] || QUALITY[STANDARD];

/** Quality roll: score = skill + craftsmanship + tool + perks + luck. Masterwork needs real mastery. */
export const QUALITY_ROLL = {
  perSkill: 0.3,
  perCraftsmanship: 0.1,
  perToolQuality: 0.25, // each step of the tool's quality above standard
  luck: 0.8, // ± random
  crude: 0.5, // below this: crude
  fine: 2.2, // from here: fine
  masterwork: 3.3, // from here: masterwork (needs skill 6+, or a mastery perk)
  masterworkSkill: 6,
};
