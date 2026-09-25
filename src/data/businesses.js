/**
 * The businesses already in the village when you arrive.
 *
 * Each is an instance of a kind from businessTypes.js, with its own building,
 * owner, cash and starting stock. More businesses appear during the game when
 * villagers save up and open their own (see EnterpriseSystem) — every business,
 * old or new, lives in state.businesses with the same shape.
 *
 * Every business has real money and real stock. Wages, player pay, purchases
 * and sales all move money between businesses, NPCs and the player.
 */
import { BUSINESS_TYPES } from './businessTypes.js';

export const FOUNDING_BUSINESSES = {
  store: {
    type: 'general_store', building: 'store', owner: 'vera', money: 600,
    stock: { bread: 16, apple: 12, cheese: 6, potato: 8, carrot: 8, cabbage: 4, wheat_seeds: 20, carrot_seeds: 20, potato_seeds: 20, cabbage_seeds: 12, pumpkin_seeds: 8, watering_can: 2, wood: 12, stone: 10, clay: 4, wheat: 12, berries: 4, pumpkin: 2, planks: 4, bricks: 6, glass: 2, stool: 1, chair: 1, table: 0 },
  },
  tavern: {
    type: 'tavern', building: 'tavern', owner: 'boris', money: 300,
    stock: { stew: 10, pie: 6, berries: 4, wheat: 4 },
  },
  smithy: {
    type: 'smithy', building: 'smithy', owner: 'fyodor', money: 500,
    stock: { axe: 2, pickaxe: 2, hammer: 2, saw: 2, hoe: 2, iron_axe: 1, iron_pickaxe: 1, iron_ore: 4, coal: 4 },
  },
  farm: {
    type: 'farm', building: 'farmhouse', owner: 'gregory', money: 350,
    stock: { wheat: 10 },
  },
  lumberyard: {
    type: 'lumberyard', building: 'lumberyard', owner: 'oleg', money: 350,
    stock: { wood: 10 },
  },
  quarry: {
    type: 'quarry', building: 'quarry_hut', owner: 'stepan', money: 400,
    stock: { stone: 10, coal: 4, iron_ore: 3 },
  },
};

/**
 * Static view of the founding businesses (type template + instance), for code
 * that runs before a Simulation exists. At runtime use sim.economy.def(id),
 * which also knows the businesses villagers opened later.
 */
export const BUSINESSES = Object.fromEntries(
  Object.entries(FOUNDING_BUSINESSES).map(([id, b]) => [id, { ...BUSINESS_TYPES[b.type], ...b, id }]),
);
