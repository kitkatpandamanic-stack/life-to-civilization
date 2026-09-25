/**
 * Know-how travels (see KnowHowSystem). A technique isn't simply "unlocked":
 * someone works it out, and it spreads — to the people they work beside, their
 * apprentices, their children and friends, through the school and through
 * books, and out of the valley with those who leave, the caravans and the
 * students who went to the towns (and back in with newcomers). Its good is done
 * only as far as it has spread among the people whose work it is.
 *
 * Familiarity with a technique uses the same levels as knowledge (data/education.js
 * KNOW_LEVELS): heard of it → basics → working knowledge → … → master.
 */
export const KNOWHOW = {
  discoverer: 70, // the one who worked it out
  workedOnIt: 12, // everyone in the trade who helped get there
  heard: 5, // "I heard they've worked out…"
  practical: 25, // a practitioner who can really use it (counts towards adoption)
  basic: 10, // for general know-how (writing, medicine…): enough to make use of it
  baseEffect: 0.3, // a discovery known to one person does this share of its good straight away
  // Weekly spread, towards the source's own familiarity (× how far apart they are).
  coworker: 0.12, // working beside someone who uses it
  apprentice: 0.3, // a master teaching an apprentice
  market: 0.15, // users taking up what the makers make and sell
  family: 0.06, // at home
  friend: 3, // talk among friends: news of it (only up to "heard of it"… or basics)
  friendCap: 12,
  school: 2.5, // know-how the teacher passes on to pupils (general techs only)
  schoolCap: 30,
  books: 1.2, // the literate reading at the library (twice as much with printing)
  booksCap: 32,
  newcomer: 45, // a newcomer from a place that uses it (× how widely it's used there)
  graduate: 20, // a student back from a town that uses it
  imitation: 0.6, // working something out is faster when you know it's been done (× adoption in a settlement you trade with)
};

/**
 * What the other settlements know at the start, and how widely it's used there (0–1).
 * It grows as they trade with each other and with the valley, and with people who move.
 */
export const SETTLEMENT_TECHS = {
  woodhollow: { handcart: 0.7 },
  pass_hold: { draft_animals: 0.7, crop_rotation: 0.4 },
  lakeside: { boats: 0.9, handcart: 0.5 },
  ironford: { better_tools: 0.9, masonry: 0.7, blast_furnace: 0.35 },
  market_town: { writing: 0.9, bookkeeping: 0.8, printing: 0.4, masonry: 0.8, handcart: 0.9, wagons: 0.6, milling: 0.7, crop_rotation: 0.5, herbal_medicine: 0.6 },
  saltmere: { boats: 0.9, writing: 0.7, bookkeeping: 0.6, herbal_medicine: 0.5, field_medicine: 0.3 },
};

export const SETTLEMENT_SPREAD = {
  grow: 0.03, // a week: what a place knows spreads through it
  neighbour: 0.02, // a week: from a trading neighbour that uses it more
  valley: 0.03, // a week: from the valley, if they trade (caravans, you)
  emigrant: 0.08, // someone from the valley who knows it moves there
};

/** Which goods each kind of know-how helps a settlement make. */
export const EFFECT_GOODS = {
  farm_output: ['wheat', 'flour', 'cabbage', 'potato', 'carrot', 'bread', 'cheese'],
  gather_output: ['wood', 'planks', 'stone', 'iron_ore', 'coal', 'iron_ingot', 'bricks'],
};
