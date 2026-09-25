/**
 * Infrastructure (InfrastructureSystem): roads and how they link up, paved streets, bridges,
 * wells and water, street lamps, carting — what each is worth to the land around it, what
 * it costs, and when the village puts money into it.
 */
export const INFRA = {
  // What reaches a spot
  roadNear: 2, // a road this close to a door (tiles): the place is on a road
  pavedNear: 2,
  lampNear: 7, // a street lamp this close lights the street
  wellNear: 14, // a well this close (as for washrooms and the land's value)
  riverNear: 4, // …or the river / the lake this close
  accessReach: 3, // how far from a road a spot still counts as reached by the road network
  // Moving about: paved streets are quicker still (on top of the road bonus)
  pavedSpeedBonus: 0.1,
  // What it's worth to the land (TerritorySystem.valueTarget / development, RealtySystem, HousingSystem)
  value: { paved: 0.06, lamps: 0.04, unlinked: -0.08, transport: 0.04 },
  dev: { paved: 0.25, lamps: 0.15, water: 0.25 },
  price: { paved: 0.04, lamps: 0.03 }, // share of a building's worth
  safety: { lamps: 0.25 }, // a lit street feels safer (HousingSystem)
  area: { paved: 0.08 },
  // What the village and you pay
  cost: {
    pave: { stone: 2, money: 4 }, // per tile
    bridge: { planks: 6, wood: 2, money: 6 },
    lamp: { iron_ingot: 1, planks: 2, money: 20 },
    lane: { money: 5 }, // per tile of a new village lane (stone from the quarry, paid for)
  },
  playerReach: 6, // you lay a tile within this many tiles of where you stand
  // The village's public works (weekly: at most one project a week)
  works: {
    weekday: 6,
    levy: 0.08, // this share of the week's taxes goes into the public works fund
    reserve: 150, // what the treasury keeps back (beyond the fund, the works dip into it only above this)
    laneMaxTiles: 14, // a lane to a house cut off from the roads, at most this long
    laneFrom: 4, // a home this far from any road gets a lane
    paveTraffic: 40, // a road tile walked this much in a week (counted hourly) is busy
    paveTiles: 10, // tiles paved at a time (the busiest stretch)
    paveFromStatus: 'large_village', // the village paves its streets once it's this big (or knows masonry)
    lampHomes: 4, // a neighbourhood this big with no lamp gets one
    trafficDecay: 0.5, // each week the count halves (the busy streets stay busy)
    keepLog: 30,
  },
};
