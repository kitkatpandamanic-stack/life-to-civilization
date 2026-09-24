/**
 * Hand-designed starting village. Coordinates are in tiles (1 tile = 32px).
 * The surrounding world (forests, river, mountains, lake) is generated procedurally
 * around this layout by world/WorldGenerator.js.
 *
 * Buildings: tx/ty = top-left tile of the footprint. The door is always centred
 * on the bottom edge; the walkable "door tile" is directly below it.
 */
export const VILLAGE_BUILDINGS = [
  { id: 'hall', type: 'hall', tx: 43, ty: 31 },
  { id: 'store', type: 'store', tx: 33, ty: 38 },
  { id: 'tavern', type: 'tavern', tx: 56, ty: 37 },
  { id: 'smithy', type: 'smithy', tx: 63, ty: 38, workSpots: [[3, 5]] },
  { id: 'house_1', type: 'house', tx: 57, ty: 30, variant: 0 },
  { id: 'house_2', type: 'house', tx: 33, ty: 31, variant: 1 },
  { id: 'house_3', type: 'house', tx: 27, ty: 39, variant: 2 },
  { id: 'house_4', type: 'house', tx: 31, ty: 49, variant: 3 },
  { id: 'house_5', type: 'house', tx: 51, ty: 50, variant: 4 },
  { id: 'house_6', type: 'house', tx: 57, ty: 50, variant: 5 },
  { id: 'house_7', type: 'house', tx: 39, ty: 50, variant: 6 },
  { id: 'shack', type: 'shack', tx: 62, ty: 55 },
  { id: 'farmhouse', type: 'farmhouse', tx: 36, ty: 59, workSpots: [[-1, 5]] },
  { id: 'lumberyard', type: 'lumberyard', tx: 9, ty: 41, workSpots: [[0, 5], [5, 5]] },
  { id: 'quarry_hut', type: 'quarry_hut', tx: 95, ty: 28, workSpots: [[-2, 4]] },
];

/** Areas used by the world generator. Rects are inclusive tile ranges. */
export const AREAS = {
  plaza: { x1: 40, y1: 36, x2: 53, y2: 45 },
  fields: { x1: 30, y1: 66, x2: 44, y2: 76 },
  // No wild trees are placed inside these rectangles.
  clearings: [
    { x1: 25, y1: 27, x2: 68, y2: 64 }, // village
    { x1: 28, y1: 63, x2: 48, y2: 79 }, // farm
    { x1: 5, y1: 38, x2: 18, y2: 50 }, // lumberyard yard
    { x1: 88, y1: 26, x2: 100, y2: 33 }, // quarry hut
  ],
  village: { x1: 25, y1: 27, x2: 68, y2: 64 },
  mountains: { xBase: 80, xNoise: 6, yBase: 20, yNoise: 6 },
  river: { baseX: 74 },
  lake: { cx: 101, cy: 70, rx: 12, ry: 7 },
};

/** Roads as straight strips. [x1, y1, x2, y2] inclusive. */
export const ROADS = [
  [5, 46, 117, 47], // main east–west road (crosses the river on a bridge)
  [46, 46, 47, 79], // south road to the farm
  [38, 14, 39, 37], // north road to the northern forest
  [92, 12, 93, 45], // quarry road into the mountains
];

/**
 * Decorations. block = solid for movement. interact = interaction handler id.
 * Fences around the fields are generated in WorldGenerator.
 */
export const DECOR = [
  { type: 'well', tx: 44, ty: 39, block: true, interact: 'well' },
  { type: 'notice_board', tx: 50, ty: 37, block: true, interact: 'notice_board' },
  // Waymarks where the road leaves the valley: expeditions set out from here.
  { type: 'signpost', tx: 7, ty: 44, block: true, interact: 'expedition' },
  { type: 'signpost', tx: 113, ty: 44, block: true, interact: 'expedition' },
  { type: 'stall', tx: 41, ty: 43, w: 2, block: true, variant: 0 },
  { type: 'stall', tx: 51, ty: 43, w: 2, block: true, variant: 1 },
  { type: 'lamp', tx: 40, ty: 36, block: true, light: true },
  { type: 'lamp', tx: 53, ty: 36, block: true, light: true },
  { type: 'lamp', tx: 40, ty: 45, block: true, light: true },
  { type: 'lamp', tx: 53, ty: 45, block: true, light: true },
  { type: 'lamp', tx: 30, ty: 45, block: true, light: true },
  { type: 'lamp', tx: 61, ty: 45, block: true, light: true },
  { type: 'lamp', tx: 45, ty: 57, block: true, light: true },
  { type: 'lamp', tx: 66, ty: 48, block: true, light: true },
  { type: 'barrel', tx: 62, ty: 40, block: true },
  { type: 'barrel', tx: 62, ty: 41, block: true },
  { type: 'crate', tx: 39, ty: 40, block: true },
  { type: 'crate', tx: 39, ty: 41, block: true },
  { type: 'anvil', tx: 67, ty: 43, block: true },
  { type: 'logpile', tx: 15, ty: 42, w: 2, block: true },
  { type: 'logpile', tx: 6, ty: 43, w: 2, block: true },
  { type: 'hay', tx: 42, ty: 60, block: true },
  { type: 'hay', tx: 42, ty: 61, block: true },
  { type: 'signpost', tx: 48, ty: 49, block: true },
  { type: 'signpost', tx: 90, ty: 44, block: true },
];
