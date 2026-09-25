/**
 * The founding villagers. Names are indexes into locale name lists
 * (names.male / names.female) so they display naturally in every language.
 *
 * family  — other roster keys this NPC lives with as family (used for stories & dialogue)
 * kin     — exact ties: spouse, parents, children, siblings (see FamilySystem)
 * surname — index into the locale surname list; families share one
 */
export const NPC_ROSTER = [
  { key: 'gregory', gender: 'm', name: 6, age: 52, occupation: 'farmer', home: 'farmhouse', owns: 'farm', money: 120, traits: ['hard_worker', 'careful'], family: ['anna', 'mitya'], kin: { spouse: 'anna', children: ['mitya'] }, surname: 0 },
  { key: 'anna', gender: 'f', name: 1, age: 47, occupation: 'farmhand', home: 'farmhouse', employer: 'farm', money: 60, traits: ['friendly', 'generous'], family: ['gregory', 'mitya'], kin: { spouse: 'gregory', children: ['mitya'] }, surname: 0 },
  { key: 'mitya', gender: 'm', name: 8, age: 10, occupation: 'child', home: 'farmhouse', money: 3, traits: ['friendly', 'risk_taker'], family: ['gregory', 'anna'], kin: { parents: ['gregory', 'anna'] }, surname: 0 },
  { key: 'vera', gender: 'f', name: 2, age: 41, occupation: 'shopkeeper', home: 'house_2', owns: 'store', money: 180, traits: ['greedy', 'careful'], surname: 1 },
  { key: 'boris', gender: 'm', name: 2, age: 48, occupation: 'innkeeper', home: 'tavern', owns: 'tavern', money: 140, traits: ['friendly', 'generous'], surname: 2 },
  { key: 'oleg', gender: 'm', name: 3, age: 44, occupation: 'lumber_foreman', home: 'house_3', owns: 'lumberyard', money: 110, traits: ['hard_worker', 'aggressive'], surname: 3 },
  { key: 'egor', gender: 'm', name: 7, age: 24, occupation: 'woodcutter', home: 'house_4', employer: 'lumberyard', money: 45, traits: ['ambitious', 'hard_worker'], surname: 4 },
  { key: 'polina', gender: 'f', name: 8, age: 28, occupation: 'woodcutter', home: 'house_6', employer: 'lumberyard', money: 50, traits: ['careful', 'loyal'], surname: 5 },
  { key: 'stepan', gender: 'm', name: 9, age: 50, occupation: 'quarry_foreman', home: 'house_5', owns: 'quarry', money: 150, traits: ['greedy', 'natural_leader'], surname: 6 },
  { key: 'yakov', gender: 'm', name: 12, age: 31, occupation: 'miner', home: 'house_6', employer: 'quarry', money: 30, traits: ['lazy', 'friendly'], surname: 7 },
  { key: 'fyodor', gender: 'm', name: 10, age: 39, occupation: 'blacksmith', home: 'house_1', owns: 'smithy', money: 130, traits: ['hard_worker', 'loyal'], family: ['nina', 'sofia'], kin: { spouse: 'nina', children: ['sofia'] }, surname: 8 },
  { key: 'nina', gender: 'f', name: 3, age: 36, occupation: 'farmhand', home: 'house_1', employer: 'farm', money: 40, traits: ['friendly', 'careful'], family: ['fyodor', 'sofia'], kin: { spouse: 'fyodor', children: ['sofia'] }, surname: 8 },
  { key: 'sofia', gender: 'f', name: 6, age: 8, occupation: 'child', home: 'house_1', money: 2, traits: ['scholar', 'friendly'], family: ['fyodor', 'nina'], kin: { parents: ['fyodor', 'nina'] }, surname: 8 },
  { key: 'matvey', gender: 'm', name: 14, age: 68, occupation: 'elder', home: 'hall', money: 200, traits: ['generous', 'natural_leader'], surname: 9 },
  { key: 'nikita', gender: 'm', name: 11, age: 19, occupation: 'unemployed', home: 'house_7', money: 18, traits: ['ambitious', 'risk_taker', 'entrepreneur'], family: ['daria'], kin: { siblings: ['daria'] }, surname: 10 },
  { key: 'daria', gender: 'f', name: 5, age: 22, occupation: 'unemployed', home: 'house_7', money: 25, traits: ['scholar', 'friendly'], family: ['nikita'], kin: { siblings: ['nikita'] }, surname: 10 },
];

/**
 * What each occupation likes to receive as a gift (doubles relationship gain).
 */
export const GIFT_PREFERENCES = {
  farmer: ['cheese', 'pie'],
  farmhand: ['bread', 'pie'],
  child: ['berries', 'apple', 'pie'],
  shopkeeper: ['cheese'],
  store_clerk: ['apple', 'pie'],
  tavern_server: ['berries', 'cheese'],
  innkeeper: ['berries', 'wheat'],
  lumber_foreman: ['stew'],
  woodcutter: ['stew', 'bread'],
  quarry_foreman: ['coal'],
  miner: ['stew', 'pie'],
  blacksmith: ['coal', 'iron_ore'],
  elder: ['apple', 'pie'],
  teacher: ['apple', 'pie'],
  doctor: ['cheese', 'pie'],
  engineer: ['stew', 'roast_meat'],
  researcher: ['apple', 'cheese'],
  unemployed: ['bread', 'stew'],
  baker: ['berries', 'cheese'],
  baker_hand: ['pie', 'apple'],
  carpenter: ['planks', 'stew'],
  carpenter_hand: ['stew', 'bread'],
  smith_hand: ['coal', 'stew'],
  fisherman: ['bread', 'pie'],
  master_builder: ['stew', 'roast_meat'],
  merchant: ['cheese', 'pie'],
  warehouse_hand: ['bread', 'stew'],
  carter_master: ['roast_meat', 'stew'],
  miller: ['pie', 'cheese'],
  hunter: ['roast_meat', 'bow'],
  mill_hand: ['bread', 'stew'],
  carter: ['bread', 'apple'],
  builder: ['stew', 'bread'],
  fisher: ['bread', 'stew'],
};

/** Colour palettes used to generate each villager's unique appearance. */
export const LOOK_PALETTE = {
  skin: ['#f3d2b3', '#e8b98f', '#d19a70', '#a8704a', '#7a4e33'],
  hair: ['#2b1d14', '#4a2f1d', '#7a4a24', '#b07a3a', '#d8b56a', '#1c1c1c', '#8a3b1f'],
  shirt: ['#b5483b', '#3f6fa3', '#4e8a4a', '#8a5aa3', '#c98a2e', '#3d8a88', '#a33f6a', '#6b6b8a', '#9a7b4f', '#577a3a'],
  pants: ['#3d3a4f', '#4f3b2a', '#2f4058', '#5a4a3a', '#3b4a3b'],
  shoes: ['#2a1d14', '#3b2a1f', '#1f1f24'],
};
