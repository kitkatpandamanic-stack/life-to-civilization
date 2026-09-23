/**
 * Village businesses at the start of the game.
 *
 * Every business has real money and real stock. Wages, player pay, purchases
 * and sales all move money between businesses, NPCs and the player.
 *
 * kind: 'shop'     — the player can buy/sell here (sells / buys lists)
 *       'producer' — produces goods with workers and sells them to shops
 *
 * targets — the "normal" stock level. Prices rise when stock is below target
 *           and fall when there is a surplus (see EconomySystem).
 */
export const BUSINESSES = {
  store: {
    building: 'store', owner: 'vera', kind: 'shop', openHours: [8, 19], money: 600,
    workerOccupation: 'store_clerk', maxWorkers: 1,
    sells: ['bread', 'apple', 'cheese'],
    buys: ['wood', 'stone', 'wheat', 'berries', 'apple'],
    stock: { bread: 16, apple: 12, cheese: 6, wood: 12, stone: 10, wheat: 12, berries: 4 },
    targets: { bread: 20, apple: 14, cheese: 8, wood: 20, stone: 16, wheat: 20, berries: 10 },
  },
  tavern: {
    building: 'tavern', owner: 'boris', kind: 'shop', openHours: [9, 23], money: 300,
    workerOccupation: 'tavern_server', maxWorkers: 1,
    sells: ['stew', 'pie'],
    buys: ['berries', 'wheat'],
    stock: { stew: 10, pie: 6, berries: 4, wheat: 4 },
    targets: { stew: 12, pie: 8, berries: 12, wheat: 8 },
  },
  smithy: {
    building: 'smithy', owner: 'fyodor', kind: 'shop', openHours: [8, 18], money: 500, repairs: true,
    sells: ['axe', 'pickaxe'],
    buys: ['iron_ore', 'coal'],
    stock: { axe: 2, pickaxe: 2, iron_ore: 4, coal: 4 },
    targets: { axe: 3, pickaxe: 3, iron_ore: 10, coal: 10 },
  },
  farm: {
    building: 'farmhouse', owner: 'gregory', kind: 'producer', money: 350,
    workerOccupation: 'farmhand', maxWorkers: 3,
    stock: { wheat: 10 }, targets: { wheat: 30 },
  },
  lumberyard: {
    building: 'lumberyard', owner: 'oleg', kind: 'producer', money: 350,
    workerOccupation: 'woodcutter', maxWorkers: 2, toolUsed: 'axe',
    stock: { wood: 10 }, targets: { wood: 30 },
  },
  quarry: {
    building: 'quarry_hut', owner: 'stepan', kind: 'producer', money: 400,
    workerOccupation: 'miner', maxWorkers: 2, toolUsed: 'pickaxe',
    stock: { stone: 10, coal: 4, iron_ore: 3 }, targets: { stone: 30, coal: 10, iron_ore: 10 },
  },
};
