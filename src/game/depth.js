/**
 * Render depth layers. World sprites use their bottom Y coordinate as depth
 * (so things lower on screen draw in front). Everything else sits above.
 */
export const DEPTH = {
  TERRAIN: -10,
  TUFTS: -5,
  // 0 … world height: y-sorted world sprites
  WORLD_UI: 50000, // name tags, action bars, markers
  WEATHER: 99990,
  GLOOM: 99995,
  NIGHT: 100000,
  LIGHTS: 100001,
  PROMPT: 100020,
};
