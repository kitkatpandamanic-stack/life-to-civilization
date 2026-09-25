/**
 * NPC-driven development (DevelopmentSystem): villagers buy land to build on later, hold land
 * while it grows dearer, build rows of houses to let; shops go where people live.
 */
export const NPC_DEV = {
  weekday: 3,
  lean: 0.35, // in a given week a villager is minded to act on it (a fixed lean per villager and week, not a dice roll)
  // A lot bought ahead, for the family's own home
  homeMoney: 300, // a family renting (or living with parents) with this much put by …
  homeShare: 0.4, // … buys a lot costing at most this share of it
  homeReserve: 0.8, // … and builds on it once it has this share of the house's cost
  maxBuysPerWeek: 1,
  // Land bought to hold: the well-off buy a plot where land is getting dearer, and sell it on
  holdMoney: 1200,
  holdKeep: 700, // … keeping this much back (money to start a business, to build, to live on) …
  holdShare: 0.45, // … and spending at most this share of the rest
  holdTraits: ['entrepreneur'], // (entrepreneurs keep their money for a business)
  plotMinBuildable: 30,
  plotMaxPlaza: 42, // not out in the wilds
  plotMaxRoad: 3, // near a road
  maxPlotsEach: 2,
  sellGain: 1.25, // put up for sale once it's worth this much more than was paid
  holdDays: 42,
  holdMaxDays: 168, // … or after this long anyway (the money's wanted back)
  // Developers: a villager with capital builds a row of houses to let, one after another
  developerMoney: 380, // (about two small houses' worth: each is paid for as it goes up — the rents help)
  developerHouses: 3,
  developerIdx: 1.1, // … when homes are wanted (the market's level, with no home standing empty)
  developerTraits: ['ambitious', 'greedy', 'risk_taker'], // (entrepreneurs put their money into businesses)
  maxDevelopers: 1, // at a time
  developerNext: 1.1, // the next house once there's this × its cost put by
  developerGiveUp: 0.4, // … below this × the cost for good, the row stops where it is
  developerRest: 84, // days before the same villager takes on another row
  // Where new buildings go (GrowthSystem.tryLot)
  ownLand: 8, // a lot on the builder's own land scores this many tiles closer
  hoodPull: 3, // a home in a neighbourhood: this many tiles closer
  shopHoodHomes: 4, // a neighbourhood this big with no shop draws the next shopfront
  // Redevelopment (Phase 13): ruins cleared, empty houses on a busy street turned into shops
  ruinWeeks: 3, // a ruin left this many weeks: the village clears it (or its owner rebuilds)
  convertEmptyDays: 28, // a house to let that has stood empty this long …
  convertDistricts: ['commercial', 'mixed', 'entertainment'], // … in a busy part of the village: its owner makes it a shop
  keepLog: 24,
};
