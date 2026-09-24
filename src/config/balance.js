/**
 * BALANCE — every tunable number in the game lives here.
 *
 * Want the game easier, harder, faster or slower? Change values in this file.
 * Gameplay code reads from BALANCE instead of hardcoding numbers.
 */
export const BALANCE = {
  tileSize: 32,
  world: { width: 120, height: 90 },

  time: {
    realMsPerGameMinute: 600, // 1 in-game day ≈ 14 real minutes
    startDayMinute: 7 * 60, // a new game starts at 07:00 on day 1
    daysPerWeek: 7,
    daysPerSeason: 14,
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    maxMinutesPerFrame: 240, // safety cap while fast-forwarding (sleep, shifts)
  },

  player: {
    startMoney: 25,
    startAge: 20,
    baseMoveSpeed: 125, // pixels per second
    moveSpeedPerAgility: 5,
    roadSpeedBonus: 0.15, // roads matter: +15% speed on roads, bridges and the plaza
    baseCarry: 25,
    carryPerStrength: 5,
    interactRadius: 48,
    startAttributes: {
      strength: 3, endurance: 3, agility: 3, intelligence: 3,
      charisma: 3, craftsmanship: 2, trading: 2, leadership: 1,
    },
    maxAttribute: 20,
    startInventory: [
      { id: 'worn_axe', qty: 1 },
      { id: 'bread', qty: 2 },
    ],
    shackComfort: 40,
    tavernComfort: 65,
    outdoorComfort: 10,
  },

  needs: {
    hungerDrainPerHour: 4.2, // satiety lost per hour awake
    hungerDrainSleepingPerHour: 1.4,
    energyDrainPerHour: 2.2,
    energyDrainReductionPerEndurance: 0.05,
    sleepEnergyPerHour: 13,
    healthRegenPerHour: 1.5,
    starvingHealthLossPerHour: 5,
    exhaustedHealthLossPerHour: 2,
    lowThreshold: 25,
    lowProductivity: 0.7,
    passOutHours: 5,
    collapseHours: 8,
    collapseFee: 20,
    wellEnergy: 4,
    wellCooldownMinutes: 120,
    napHours: 2,
    wakeHour: 6,
    winterHungerMult: 1.2,
  },

  // Real-time duration (ms) of physical actions before modifiers, plus costs and rewards.
  actions: {
    chop: { ms: 2600, energy: 5, xp: 6, skill: 'woodcutting', skillXp: 8 },
    mine: { ms: 3000, energy: 6, xp: 7, skill: 'mining', skillXp: 9 },
    harvest: { ms: 900, energy: 1.5, xp: 2, skill: 'farming', skillXp: 4 },
    forage: { ms: 1200, energy: 1, xp: 2, skill: 'foraging', skillXp: 5 },
    fish: { ms: 3800, energy: 2, xp: 4, skill: 'fishing', skillXp: 8 },
    hunt: { ms: 900, energy: 4, xp: 6, skill: 'hunting', skillXp: 10 },
  },

  resources: {
    treeWood: [3, 5],
    treeRegrowDays: [5, 8],
    rockStone: [3, 4],
    oreAmount: [2, 3],
    rockRegrowDays: [4, 7],
    bushBerries: [3, 5],
    bushRegrowDays: 3,
    cropYield: 1,
    oreSkillRequired: { coal: 1, iron: 2 }, // mining skill needed for ore rocks
  },

  progression: {
    xpBase: 60,
    xpExponent: 1.5,
    attributePointsPerLevel: 1,
    skillPointsPerLevel: 1,
    maxSkillLevel: 10,
    skillXpBase: 40,
    skillXpExponent: 1.35,
    levelUpEnergy: 20,
    // Titles unlock by level. Later phases will add titles earned by ownership (Business Owner, Founder...).
    titles: [
      { level: 1, key: 'nobody' },
      { level: 2, key: 'citizen' },
      { level: 3, key: 'worker' },
      { level: 5, key: 'skilled_worker' },
      { level: 8, key: 'craftsman' },
    ],
  },

  economy: {
    shopMargin: 0.15, // player buys at price × (1 + margin)
    sellDiscount: 0.3, // player sells at price × (1 − discount)
    priceElasticity: 0.8,
    minPriceFactor: 0.5,
    maxPriceFactor: 2.5,
    tradingPerPoint: 0.015,
    tradingSkillPerLevel: 0.02,
    greedyOwnerMarkup: 0.05,
    friendDiscount: 0.05,
    trustedDiscount: 0.1,
    wariMarkup: 0.05, // owners who distrust you charge more…
    hostileMarkup: 0.12, // …and much more if they can't stand you
    maxStockMultiplier: 3, // shops stop buying above target × this
    outsideTradeDrift: 0.12, // daily import/export pulls stock toward targets
    caravanDrift: 0.5,
    caravanEveryDays: 7,
    npcMealPrice: 8,
    npcDrinkPrice: 3,
    npcGroceryItems: 2,
    winterWoodPerHousehold: 2,
    farmOutputPerWorker: 5,
    seasonFarmMult: { spring: 0.8, summer: 1.2, autumn: 1.4, winter: 0 },
    breadPerDay: 9,
    stewPerDay: 12,
    ownerDrawPerDay: 10,
    ownerWageAbove: 150, // owners pay themselves a basic wage only once the business has this cushion
    ownerDrawAbove: 250, // owners take a share of profit only when the business has more than this
    ownerDrawShare: 0.1, // …and then 10% of the excess per day
    exportPerDay: 24, // units of surplus traders take from each producer per day (the more they buy, the less they pay)
    exportPriceFactor: 0.6, // at 60% of the base price
    depotBuyFactor: 0.66, // a warehouse pays producers this share of the base price…
    depotExportFactor: 0.78, // …and gets a better price than they would from traders, dealing in bulk
    toolWearPerWorkerDay: 0.12, // producers buy a new tool from the smithy as crews wear them out
    wealthySpendAbove: 200, // villagers richer than this buy extra (nicer) food
    elderPension: 6, // the retired elder's small daily income
    luxuryAbove: 600, // very rich villagers spend part of their wealth on imported goods…
    luxuryShare: 0.05, // …5% of the excess per day
    furnitureBuyAbove: 120, // villagers with this much money sometimes buy furniture…
    furnitureBuyChance: 0.12, // …with this chance per day
    tavernLunchChance: 0.35, // chance a villager with food at home still eats lunch at the tavern
    producerStockLimit: 3, // workers stop gathering when stock exceeds target × this
    repairCostPerPoint: 0.4,
  },

  rent: { amount: 30, periodDays: 7, lateReputation: -3 },
  tavernBedPrice: 10,

  social: {
    chatGain: 3,
    chatGainPerCharisma: 0.1,
    giftBase: 2,
    giftValueFactor: 0.6,
    likedGiftMult: 2,
    tiers: { acquaintance: 0, friend: 40, trusted: 75 },
    friendPayBonus: 0.05,
    trustedPayBonus: 0.1,
    npcChatGain: 1,
    friendshipThreshold: 40,
  },

  reputation: { jobComplete: 1, jobFail: -2, requestComplete: 2, leadershipBonusPerPoint: 0.1 },

  jobs: {
    refreshHour: 5,
    negotiationPerLevel: 0.04,
    charismaPerPoint: 0.02,
    craftsmanshipShiftPerPoint: 0.03,
    shiftRealMs: 4000, // how long a shift fast-forward takes in real time
  },

  requests: { maxActive: 3, dailyChance: 0.35, rewardMult: 1.7, rewardFlat: 3, xp: 20, relationship: 8, expireDays: 3 },

  npc: {
    walkSpeed: 72,
    roadSpeedBonus: 0.25, // villagers walk faster on roads, bridges and the plaza
    thinkEveryMinutes: 5,
    // Simulation levels by distance from the player (pixels):
    fullSimRadius: 1100, // full: smooth movement, animation, thought icons
    statisticalRadius: 2600, // beyond this: no pathfinding — arrive instantly (cheap)
    // Needs (per game hour)
    energyDrainPerHour: 4.5,
    energyDrainWorkingPerHour: 6,
    energySleepPerHour: 12,
    energyRestPerHour: 8,
    starvingHealthPerHour: 3,
    exhaustedHealthPerHour: 1,
    healthRegenPerHour: 1,
    sickBelow: 35, // health below this → stay home and recover
    exhaustedBelow: 12, // energy below this → go home and rest, even from work
    thoughtRadius: 520, // show thought icons (hungry, tired...) within this distance
    homelessInnPrice: 5,
    hungerPerHour: 4,
    eatAt: 40,
    xpPerWorkDay: 12,
    ranks: { regular: 5, skilled: 10, master: 20 }, // NPC level needed for each professional rank
    xpBase: 50,
    xpExponent: 1.3,
    quitAfterUnpaidDays: 3,
    hireMinBusinessMoney: 5, // business needs wage × this to hire
    chopMinutes: 80,
    mineMinutes: 90,
    tendMinutes: [20, 40],
    searchRadius: 32,
    // Company (loneliness)
    socialDrainPerHour: 2.5, // lost per waking hour alone (more for outgoing people)
    socialHomePerHour: 3, // gained at home with family
    socialPerChat: 8,
    gossipChance: 0.15, // chance per chat to pass on news about the player
    argueChance: 0.025, // base chance a chat turns into an argument
    fishMinutes: 110, // a fisher's session at the water…
    fishAttempts: 4, // …and how many catches they try for
  },

  events: {
    dailyChance: 0.18,
  },
};
