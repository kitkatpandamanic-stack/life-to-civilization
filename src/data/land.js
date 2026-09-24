/**
 * Plots of land for sale. Coordinates are tile rectangles (inclusive).
 * sign — where the "For sale" sign stands (on the side facing a road).
 *
 * Prices are not fixed here: LandSystem computes them from the location
 * (distance to the village centre, water, forest, road access), so different
 * places offer different trade-offs.
 */
export const PLOTS = [
  { id: 'village_south', x1: 49, y1: 56, x2: 58, y2: 64, sign: [49, 58] },
  { id: 'north_glade', x1: 41, y1: 17, x2: 49, y2: 26, sign: [41, 22] },
  { id: 'forest_edge', x1: 18, y1: 51, x2: 27, y2: 59, sign: [22, 51] },
  { id: 'riverside', x1: 78, y1: 49, x2: 87, y2: 57, sign: [82, 49] },
  { id: 'east_meadow', x1: 89, y1: 49, x2: 98, y2: 57, sign: [93, 49] },
  { id: 'far_meadow', x1: 100, y1: 49, x2: 110, y2: 57, sign: [105, 49] },
  { id: 'quarry_road', x1: 78, y1: 34, x2: 89, y2: 43, sign: [84, 43] },
  { id: 'hillside', x1: 96, y1: 34, x2: 106, y2: 43, sign: [99, 43] },
  { id: 'lakeside', x1: 84, y1: 58, x2: 95, y2: 64, sign: [89, 58] },
];

/** Land pricing. Change these to make land cheaper or dearer. */
export const LAND_PRICING = {
  perTile: 3, // base price per buildable tile
  centreBonus: 1.5, // up to +150% right next to the plaza…
  centreRange: 40, // …fading out over this many tiles
  waterBonus: 0.15, // near a river or lake
  roadBonus: 0.15, // within 2 tiles of a road
  forestDiscount: 0.35, // max discount for land covered in trees (you have to clear it)
};

/** Gameplay effects of land features. */
export const LAND_EFFECTS = {
  water: { cropGrowth: 0.25 }, // crops grow faster; refill watering cans nearby
  village: { shopSales: 0.25 }, // businesses here get more customers
  forest: {}, // lots of wood, but you must clear it before building
  road: {}, // faster travel for you and your workers
  remote: {}, // cheap, but far from everything
};
