/**
 * Kinds of business — templates every business in the world is made from,
 * whether it was here when you arrived or a villager opened it later.
 *
 * kind:  'shop'     — sells to customers (villagers and you): sells / buys lists
 *        'producer' — produces raw goods and sells them to shops (wholesale)
 *        'service'  — sells work, not goods (builders are paid by the hour on building sites)
 * sector       — line of trade; businesses in the same sector compete for customers
 * owner/workerOccupation — what the owner and the staff are called (occupations.js)
 * maxWorkers   — staff it can take on (it grows when business is good)
 * targets      — normal stock levels; prices follow supply and demand around them
 * recipes      — what it makes each day. perDay = the owner's own output,
 *                perWorker = added by each worker who came in. Several input options
 *                (alts) may be listed: the first one with enough stock is used.
 * output: 'farm' — output depends on workers, season and weather (see EconomySystem)
 * import       — the item is also brought in by traders (founding shops were always stocked this way)
 * startCost    — savings a villager needs to open one (equipment, first stock, premises deposit)
 * openable     — villagers may open new businesses of this kind
 * icon         — sign hung over the door
 * premises     — 'warehouse' / 'shop': needs proper premises (can't be run from a front room)
 * needsTech    — the village must know how (TechSystem) before anyone can open one
 * alt.cost     — a slower way of making it (hand-grinding wheat instead of using flour) uses up more work
 */
export const BUSINESS_TYPES = {
  general_store: {
    kind: 'shop', sector: 'grocery', icon: '🧺', openHours: [8, 19],
    ownerOccupation: 'shopkeeper', workerOccupation: 'store_clerk', maxWorkers: 1,
    sells: ['bread', 'apple', 'cheese', 'potato', 'carrot', 'cabbage', 'fish', 'hay', 'wheat_seeds', 'carrot_seeds', 'potato_seeds', 'cabbage_seeds', 'pumpkin_seeds', 'watering_can', 'fishing_rod', 'bow', 'bricks', 'glass'],
    buys: ['wood', 'stone', 'clay', 'wheat', 'berries', 'apple', 'carrot', 'potato', 'cabbage', 'pumpkin', 'planks', 'stool', 'chair', 'table', 'fish', 'meat', 'hide', 'bricks'],
    // From you only (your farm animals — LivestockSystem): not restocked, not ordered; the surplus goes to traders.
    buysFromYou: ['egg', 'milk', 'wool'],
    targets: { bread: 20, apple: 14, cheese: 8, potato: 12, carrot: 12, cabbage: 8, fish: 6, wheat_seeds: 20, carrot_seeds: 20, potato_seeds: 20, cabbage_seeds: 12, pumpkin_seeds: 8, watering_can: 2, fishing_rod: 2, bow: 1, bricks: 14, glass: 6, hay: 12, wood: 20, stone: 16, clay: 10, wheat: 20, berries: 10, pumpkin: 4, planks: 12, stool: 3, chair: 3, table: 2 },
    // Bread from the mill's flour; without flour, grinding wheat by hand is slow work.
    recipes: { bread: { alts: [{ in: { flour: 1 }, out: 2 }, { in: { wheat: 1 }, out: 1, cost: 1.5 }], perDay: 9, perWorker: 3, import: true } },
    startCost: 360, openable: true,
  },
  tavern: {
    kind: 'shop', sector: 'tavern', icon: '🍺', openHours: [9, 23],
    ownerOccupation: 'innkeeper', workerOccupation: 'tavern_server', maxWorkers: 1,
    sells: ['stew', 'pie'],
    buys: ['berries', 'wheat', 'bread', 'fish', 'meat'],
    targets: { stew: 12, pie: 8, berries: 12, wheat: 8, bread: 4 },
    recipes: {
      stew: { alts: [{ in: { meat: 1 }, out: 3 }, { in: { fish: 1 }, out: 2 }, { in: { bread: 1 }, out: 3 }, { in: { wheat: 1 }, out: 2 }], perDay: 12, perWorker: 4, cap: 2, import: true },
      pie: { alts: [{ in: { berries: 3 }, out: 1 }], perDay: 6, perWorker: 2, cap: 2, import: true },
    },
    startCost: 420, openable: true,
  },
  smithy: {
    kind: 'shop', sector: 'smithing', icon: '⚒️', openHours: [8, 18], repairs: true,
    ownerOccupation: 'blacksmith', workerOccupation: 'smith_hand', maxWorkers: 1,
    sells: ['axe', 'pickaxe', 'hammer', 'saw', 'hoe', 'iron_axe', 'iron_pickaxe'],
    buys: ['iron_ore', 'coal'],
    targets: { axe: 3, pickaxe: 3, hammer: 2, saw: 2, hoe: 2, iron_axe: 1, iron_pickaxe: 1, iron_ore: 10, coal: 10 },
    // One of each tool per day at most, if there's ore and coal (a smith's hand doubles that).
    recipes: {
      axe: { alts: [{ in: { iron_ore: 2, coal: 1 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      pickaxe: { alts: [{ in: { iron_ore: 2, coal: 1 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      hammer: { alts: [{ in: { iron_ore: 1, coal: 1 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      saw: { alts: [{ in: { iron_ore: 1, coal: 1 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      hoe: { alts: [{ in: { iron_ore: 1, coal: 1 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      iron_axe: { alts: [{ in: { iron_ore: 3, coal: 2 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
      iron_pickaxe: { alts: [{ in: { iron_ore: 3, coal: 2 }, out: 1 }], perDay: 1, perWorker: 1, cap: 1, import: true },
    },
    startCost: 400, openable: true,
  },
  bakery: {
    kind: 'shop', sector: 'bakery', icon: '🥖', openHours: [6, 16],
    ownerOccupation: 'baker', workerOccupation: 'baker_hand', maxWorkers: 2,
    sells: ['bread', 'pie'],
    buys: ['flour', 'wheat', 'berries'],
    targets: { bread: 16, pie: 6, flour: 12, wheat: 10, berries: 9 },
    recipes: {
      bread: { alts: [{ in: { flour: 1 }, out: 2 }, { in: { wheat: 1 }, out: 1, cost: 1.5 }], perDay: 6, perWorker: 5 },
      pie: { alts: [{ in: { berries: 3 }, out: 1 }], perDay: 2, perWorker: 2 },
    },
    startCost: 260, openable: true,
  },
  carpentry: {
    kind: 'shop', sector: 'carpentry', icon: '🪚', openHours: [9, 19],
    ownerOccupation: 'carpenter', workerOccupation: 'carpenter_hand', maxWorkers: 2,
    sells: ['planks', 'stool', 'chair', 'table'],
    buys: ['wood'],
    targets: { wood: 20, planks: 8, stool: 3, chair: 3, table: 2 },
    recipes: {
      planks: { alts: [{ in: { wood: 2 }, out: 1 }], perDay: 3, perWorker: 4 },
      stool: { alts: [{ in: { planks: 2 }, out: 1 }], perDay: 0.7, perWorker: 0.8 },
      chair: { alts: [{ in: { planks: 3 }, out: 1 }], perDay: 0.5, perWorker: 0.6 },
      table: { alts: [{ in: { planks: 5 }, out: 1 }], perDay: 0.3, perWorker: 0.4 },
    },
    startCost: 280, openable: true,
  },
  mill: {
    kind: 'producer', sector: 'milling', icon: '⚙️', needsTech: 'milling',
    ownerOccupation: 'miller', workerOccupation: 'mill_hand', maxWorkers: 2,
    buys: ['wheat'],
    targets: { wheat: 30, flour: 30 },
    recipes: { flour: { alts: [{ in: { wheat: 2 }, out: 3 }], perDay: 8, perWorker: 10, cap: 2 } },
    startCost: 380, openable: true,
  },
  // Early industry: making in bulk what used to be made by hand (see TechSystem — the village has to learn how first).
  brickworks: {
    kind: 'producer', sector: 'bricks', icon: '🧱', needsTech: 'brickmaking', premises: 'warehouse',
    ownerOccupation: 'brickmaker', workerOccupation: 'clay_digger', maxWorkers: 2,
    buys: ['clay', 'coal', 'wood'],
    targets: { clay: 24, coal: 10, wood: 12, bricks: 30 },
    // Clay dug from the riverbank pits, fired in the kiln (coal burns hotter than wood).
    recipes: { bricks: { alts: [{ in: { clay: 2, coal: 1 }, out: 5 }, { in: { clay: 2, wood: 1 }, out: 3, cost: 1.3 }], perDay: 6, perWorker: 6, cap: 2 } },
    startCost: 340, openable: true,
  },
  sawmill: {
    kind: 'producer', sector: 'sawing', icon: '🪚', needsTech: 'sawing', premises: 'warehouse',
    ownerOccupation: 'sawyer', workerOccupation: 'sawmill_hand', maxWorkers: 2,
    buys: ['wood'],
    targets: { wood: 40, planks: 36 },
    recipes: { planks: { alts: [{ in: { wood: 2 }, out: 1 }], perDay: 10, perWorker: 12, cap: 2 } },
    startCost: 360, openable: true,
  },
  factory: {
    kind: 'producer', sector: 'manufacture', icon: '🏭', needsTech: 'manufacture', premises: 'warehouse',
    ownerOccupation: 'factory_master', workerOccupation: 'factory_hand', maxWorkers: 4,
    buys: ['planks', 'iron_ore', 'coal'],
    targets: { planks: 30, iron_ore: 16, coal: 16, hammer: 4, axe: 4, saw: 3, chair: 5, table: 3 },
    // The first factory: tools and furniture made many at a time, by hands that each do one part.
    recipes: {
      hammer: { alts: [{ in: { iron_ore: 1, coal: 1, planks: 1 }, out: 2 }], perDay: 1, perWorker: 1, cap: 2 },
      axe: { alts: [{ in: { iron_ore: 1, coal: 1, planks: 1 }, out: 2 }], perDay: 1, perWorker: 1, cap: 2 },
      saw: { alts: [{ in: { iron_ore: 1, coal: 1, planks: 1 }, out: 2 }], perDay: 0.6, perWorker: 0.8, cap: 2 },
      chair: { alts: [{ in: { planks: 3 }, out: 2 }], perDay: 1.5, perWorker: 1.5, cap: 2 },
      table: { alts: [{ in: { planks: 5 }, out: 2 }], perDay: 0.8, perWorker: 1, cap: 2 },
    },
    startCost: 600, openable: true,
  },
  // Outposts (built at discovery sites — see data/sites.js; villagers don't open these themselves)
  mining_camp: {
    kind: 'producer', sector: 'quarry', icon: '⛏️', outpost: true,
    ownerOccupation: 'quarry_foreman', workerOccupation: 'miner', maxWorkers: 3, toolUsed: 'pickaxe',
    targets: { stone: 30, coal: 15, iron_ore: 15, gemstone: 6 },
  },
  hunting_lodge: {
    kind: 'producer', sector: 'hunting', icon: '🦌', outpost: true,
    ownerOccupation: 'hunter', workerOccupation: 'hunter', maxWorkers: 2, toolUsed: 'bow',
    targets: { meat: 15, hide: 8 },
  },
  trading_post: {
    kind: 'depot', sector: 'trade', icon: '🏪', outpost: true,
    ownerOccupation: 'merchant', workerOccupation: 'warehouse_hand', maxWorkers: 1,
    targets: { wood: 30, stone: 30, wheat: 30, flour: 20, fish: 15, meat: 12, hide: 10, coal: 15, iron_ore: 15, gemstone: 8 },
  },
  fishery: {
    kind: 'producer', sector: 'fishing', icon: '🐟',
    ownerOccupation: 'fisherman', workerOccupation: 'fisher', maxWorkers: 2, toolUsed: 'fishing_rod',
    targets: { fish: 20 },
    startCost: 170, openable: true,
  },
  warehouse: {
    kind: 'depot', sector: 'trade', icon: '📦', premises: 'warehouse',
    ownerOccupation: 'merchant', workerOccupation: 'warehouse_hand', maxWorkers: 2,
    targets: { wood: 50, stone: 50, wheat: 50, fish: 25, coal: 20, iron_ore: 20 },
    startCost: 320, openable: true,
  },
  carters: {
    kind: 'service', sector: 'transport', icon: '🛒', premises: 'shop',
    ownerOccupation: 'carter_master', workerOccupation: 'carter', maxWorkers: 2,
    targets: {},
    startCost: 240, openable: true,
  },
  builders: {
    kind: 'service', sector: 'construction', icon: '🔨',
    ownerOccupation: 'master_builder', workerOccupation: 'builder', maxWorkers: 2,
    targets: {},
    startCost: 200, openable: true,
  },
  farm: {
    kind: 'producer', sector: 'farming', icon: '🌾', output: 'farm',
    ownerOccupation: 'farmer', workerOccupation: 'farmhand', maxWorkers: 3,
    targets: { wheat: 30, hay: 24 }, // (hay: cut in summer and autumn, winter fodder)
  },
  lumberyard: {
    kind: 'producer', sector: 'lumber', icon: '🪵',
    ownerOccupation: 'lumber_foreman', workerOccupation: 'woodcutter', maxWorkers: 2, toolUsed: 'axe',
    targets: { wood: 30 },
  },
  quarry: {
    kind: 'producer', sector: 'quarry', icon: '⛏️',
    ownerOccupation: 'quarry_foreman', workerOccupation: 'miner', maxWorkers: 2, toolUsed: 'pickaxe',
    targets: { stone: 30, coal: 10, iron_ore: 10 },
  },
};

/**
 * Names for businesses villagers open (so a village can have several bakeries).
 * Indexes into locale lists biz_name.<type>.
 */
export const BUSINESS_NAME_COUNT = 8;

/** Which occupations give useful experience for which kind of business. */
export const EXPERIENCE = {
  general_store: ['store_clerk', 'shopkeeper'],
  tavern: ['tavern_server', 'innkeeper'],
  smithy: ['smith_hand', 'blacksmith', 'miner'],
  bakery: ['baker_hand', 'farmhand', 'farmer', 'tavern_server'],
  carpentry: ['carpenter_hand', 'woodcutter', 'lumber_foreman'],
  fishery: ['fisher', 'fisherman'],
  mill: ['mill_hand', 'miller', 'farmhand', 'baker_hand', 'farmer'],
  builders: ['builder', 'carpenter_hand', 'woodcutter', 'master_builder'],
  warehouse: ['warehouse_hand', 'store_clerk', 'shopkeeper', 'merchant'],
  carters: ['carter', 'woodcutter', 'farmhand'],
};

/** Tuning for villager-run businesses (see EnterpriseSystem). */
export const ENTERPRISE = {
  minAge: 21,
  maxAge: 58,
  startupScoreNeeded: 1,
  premisesDeposit: 0.35, // share of the start cost that goes on premises/equipment (paid to local businesses)
  wageLevel: [0.8, 1.4],
  markup: [0.8, 1.4],
  troubleDaysToClose: 14, // this long unable to pay its way → closes
  ownerBailout: 0.5, // owners put in up to half their savings to keep a business afloat
  switchJobFactor: 1.3, // a job must be this much better to leave for it
  managerAtWorkers: 3,
  expandAbove: 700, // money that lets a business take on more staff
  historyDays: 14,
  copyProfit: 60, // your business of a kind made this much in a week: villagers take notice (and a competitor may open)
  copyMax: 2,
  retryAfterFailDays: 112, // after a business fails, its owner waits this long before trying again (unless set on it)
};
