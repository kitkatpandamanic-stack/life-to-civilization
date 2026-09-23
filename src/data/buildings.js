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
