/**
 * Building types: size (in tiles) and visual style.
 * Buildings are drawn procedurally by render/TextureFactory.js from these styles.
 *
 * wall:  'wood' | 'plaster' | 'stone'
 * roof:  'thatch' | 'tile' | 'slate' | 'plank'
 * sign:  emoji painted on the sign board above the door
 */
export const BUILDING_TYPES = {
  shack: { w: 3, h: 3, wall: 'wood', wallColor: '#9c7a52', roof: 'plank', roofColor: '#6d4c33', chimney: false },
  house: { w: 4, h: 3, wall: 'plaster', wallColor: '#e8dcc0', roof: 'tile', roofColor: '#b0503a', chimney: true },
  store: { w: 6, h: 4, wall: 'plaster', wallColor: '#efe2c2', roof: 'slate', roofColor: '#3f6a94', sign: '🍞', chimney: false, wideDoor: true },
  tavern: { w: 6, h: 5, wall: 'wood', wallColor: '#a8784a', roof: 'tile', roofColor: '#8f3b2e', sign: '🍲', chimney: true, wideDoor: true },
  smithy: { w: 5, h: 4, wall: 'stone', wallColor: '#8e8a82', roof: 'slate', roofColor: '#4b4f57', sign: '⚒️', chimney: true },
  farmhouse: { w: 5, h: 4, wall: 'wood', wallColor: '#b88b58', roof: 'thatch', roofColor: '#c9a45a', sign: '🌾', chimney: true },
  lumberyard: { w: 6, h: 4, wall: 'open', wallColor: '#8a6440', roof: 'plank', roofColor: '#7a5536', sign: '🪵', chimney: false },
  quarry_hut: { w: 4, h: 3, wall: 'stone', wallColor: '#9a958b', roof: 'plank', roofColor: '#6a5a48', sign: '⛏️', chimney: false },
  hall: { w: 7, h: 4, wall: 'stone', wallColor: '#b7b0a0', roof: 'slate', roofColor: '#56657a', sign: '📜', chimney: true, wideDoor: true, flag: true },

  // Buildings the player can construct (V2)
  small_house: { w: 4, h: 3, wall: 'wood', wallColor: '#b58a5a', roof: 'thatch', roofColor: '#c9a45a', chimney: true },
  player_house: { w: 4, h: 3, wall: 'plaster', wallColor: '#f0e6cc', roof: 'tile', roofColor: '#a8483a', chimney: true, flag: true },
  player_estate: { w: 4, h: 3, wall: 'stone', wallColor: '#ddd2bb', roof: 'slate', roofColor: '#6a2f2f', chimney: true, flag: true, wideDoor: true, sign: '🏛️' },
  player_large_house: { w: 4, h: 3, wall: 'stone', wallColor: '#c9bfa8', roof: 'slate', roofColor: '#3f5a7a', chimney: true, flag: true, wideDoor: true },
  rental_house: { w: 4, h: 3, wall: 'plaster', wallColor: '#e3d7bf', roof: 'tile', roofColor: '#7a5a3a', chimney: true, sign: '🔑' },
  storage_shed: { w: 3, h: 2, wall: 'wood', wallColor: '#8f6a44', roof: 'plank', roofColor: '#6d4c33', chimney: false, wideDoor: true },
  workshop: { w: 5, h: 4, wall: 'wood', wallColor: '#a57a4c', roof: 'tile', roofColor: '#6f4a8a', sign: '🪚', chimney: true, wideDoor: true },
  well: { w: 1, h: 1, decorTexture: 'decor_well' },

  // Built by villagers as the settlement grows (V3)
  shopfront: { w: 4, h: 3, wall: 'plaster', wallColor: '#ede0c4', roof: 'slate', roofColor: '#4a7a6e', chimney: false, wideDoor: true },
  mining_camp: { w: 3, h: 2, wall: 'wood', wallColor: '#8a6a44', roof: 'plank', roofColor: '#5a4a3a', sign: '⛏️' },
  hunting_cabin: { w: 3, h: 2, wall: 'wood', wallColor: '#7a5434', roof: 'thatch', roofColor: '#8a7a4a', sign: '🦌', chimney: true },
  trading_post: { w: 4, h: 3, wall: 'wood', wallColor: '#a88457', roof: 'tile', roofColor: '#8a3a2a', sign: '🏪', flag: true },
  forge: { w: 3, h: 2, wall: 'stone', wallColor: '#8f877a', roof: 'slate', roofColor: '#4a4f5a', sign: '🔥', chimney: true },
  school: { w: 5, h: 3, wall: 'wood', wallColor: '#c8a070', roof: 'tile', roofColor: '#a0463a', sign: '📚', chimney: true, bell: true },
  library: { w: 4, h: 3, wall: 'stone', wallColor: '#a8a295', roof: 'slate', roofColor: '#4d5a70', sign: '📖' },
  institute: { w: 5, h: 4, wall: 'stone', wallColor: '#c9c1ae', roof: 'slate', roofColor: '#3f4a5e', sign: '🔬', chimney: true, flag: true },
  trade_school: { w: 5, h: 3, wall: 'wood', wallColor: '#9a7a52', roof: 'plank', roofColor: '#6a4a32', sign: '🛠️', chimney: true, wideDoor: true },
  grammar_school: { w: 6, h: 3, wall: 'stone', wallColor: '#b8a98c', roof: 'tile', roofColor: '#8a3a32', sign: '🎓', chimney: true, bell: true },
  mill: { w: 5, h: 4, wall: 'stone', wallColor: '#b9ae98', roof: 'thatch', roofColor: '#b8964e', sign: '⚙️', chimney: false },
  warehouse_bld: { w: 6, h: 4, wall: 'wood', wallColor: '#9c7a52', roof: 'plank', roofColor: '#5a4a3a', chimney: false, wideDoor: true },

  // The village's institutions (V5 — see CivicSystem)
  market_hall: { w: 6, h: 3, wall: 'wood', wallColor: '#b58c5c', roof: 'tile', roofColor: '#b8643a', sign: '🏷️', chimney: false, wideDoor: true, flag: true },
  watch_house: { w: 3, h: 3, wall: 'stone', wallColor: '#9a948a', roof: 'slate', roofColor: '#46505e', sign: '🛡️', chimney: true, bell: true },
  clinic: { w: 4, h: 3, wall: 'plaster', wallColor: '#f2eee2', roof: 'tile', roofColor: '#5a8a6a', sign: '⚕️', chimney: true },
  guild_hall: { w: 5, h: 4, wall: 'stone', wallColor: '#b3a68f', roof: 'slate', roofColor: '#6a4a3a', sign: '🛠️', chimney: true, wideDoor: true, flag: true },
  bank: { w: 4, h: 3, wall: 'stone', wallColor: '#d2c9b3', roof: 'slate', roofColor: '#3a4a5c', sign: '💰', chimney: false, wideDoor: true },
};

/** Colour variations so ordinary houses don't all look identical. */
export const HOUSE_VARIANTS = [
  { wallColor: '#e8dcc0', roofColor: '#b0503a' },
  { wallColor: '#dfe6d2', roofColor: '#5b7f4a' },
  { wallColor: '#efd9c4', roofColor: '#8a4f7a' },
  { wallColor: '#d9cfc0', roofColor: '#4f6a8f' },
  { wallColor: '#f0e4c8', roofColor: '#9c6b2e' },
  { wallColor: '#e3d5c5', roofColor: '#a0453e' },
  { wallColor: '#e6e0cf', roofColor: '#6a5a8a' },
];
