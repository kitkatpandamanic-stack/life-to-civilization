/**
 * Home tiers. The player starts in a rented shack; later they build and upgrade
 * their own home. Better homes give real benefits:
 *
 * comfort   — how well you sleep (energy restored per hour) and your mood
 * storage   — how much the storage chest holds (kg)
 * room      — interior size in tiles [width, height]
 * furniture — which furniture is in the room; each has a tile position (x, y from the
 *             room's top-left) and an interaction (sleep / storage / eat / craft / cook)
 * reputation — villagers respect people with better homes
 */
export const HOME_TIERS = {
  shack: {
    comfort: 40, storage: 40, reputation: 0, room: [7, 5],
    furniture: [
      { type: 'bed', x: 1, y: 1 },
      { type: 'chest', x: 5, y: 1 },
      { type: 'table', x: 3, y: 2 },
      { type: 'workbench', x: 5, y: 3 },
    ],
  },
  small_house: {
    comfort: 55, storage: 90, reputation: 2, room: [9, 6],
    furniture: [
      { type: 'bed', x: 1, y: 1 },
      { type: 'chest', x: 3, y: 1 },
      { type: 'table', x: 5, y: 3 },
      { type: 'workbench', x: 7, y: 1 },
      { type: 'stove', x: 7, y: 4 },
      { type: 'rug', x: 3, y: 3 },
    ],
  },
  house: {
    comfort: 70, storage: 160, reputation: 5, room: [10, 7],
    furniture: [
      { type: 'bed', x: 1, y: 1 },
      { type: 'chest', x: 3, y: 1 },
      { type: 'chest', x: 4, y: 1 },
      { type: 'table', x: 5, y: 4 },
      { type: 'workbench', x: 8, y: 1 },
      { type: 'stove', x: 8, y: 5 },
      { type: 'rug', x: 3, y: 4 },
      { type: 'plant', x: 1, y: 5 },
      { type: 'shelf', x: 6, y: 1 },
      { type: 'fireplace', x: 1, y: 3 },
    ],
  },
  large_house: {
    comfort: 85, storage: 260, reputation: 9, room: [12, 8],
    furniture: [
      { type: 'bed', x: 1, y: 1 },
      { type: 'bed', x: 3, y: 1 },
      { type: 'chest', x: 5, y: 1 },
      { type: 'chest', x: 6, y: 1 },
      { type: 'table', x: 6, y: 5 },
      { type: 'workbench', x: 10, y: 1 },
      { type: 'stove', x: 10, y: 6 },
      { type: 'rug', x: 4, y: 5 },
      { type: 'plant', x: 1, y: 6 },
      { type: 'plant', x: 8, y: 1 },
      { type: 'shelf', x: 8, y: 3 },
      { type: 'fireplace', x: 1, y: 4 },
    ],
  },
  estate: {
    comfort: 100, storage: 420, reputation: 15, room: [14, 9],
    furniture: [
      { type: 'bed', x: 1, y: 1 },
      { type: 'bed', x: 3, y: 1 },
      { type: 'bed', x: 5, y: 1 },
      { type: 'chest', x: 7, y: 1 },
      { type: 'chest', x: 8, y: 1 },
      { type: 'chest', x: 9, y: 1 },
      { type: 'table', x: 6, y: 5 },
      { type: 'workbench', x: 12, y: 1 },
      { type: 'stove', x: 12, y: 6 },
      { type: 'rug', x: 5, y: 5 },
      { type: 'plant', x: 1, y: 7 },
      { type: 'plant', x: 10, y: 1 },
      { type: 'shelf', x: 10, y: 3 },
      { type: 'shelf', x: 11, y: 3 },
      { type: 'fireplace', x: 1, y: 4 },
    ],
  },
};

export const HOME_ORDER = ['shack', 'small_house', 'house', 'large_house', 'estate'];

/** Winter: a home without a fireplace is a cold one (the stove helps a little). */
export const WINTER_COLD = { none: 15, stove: 7 };

/** Comfort added per piece of furniture kept in your home storage (capped). */
export const FURNITURE_COMFORT_CAP = 15;
