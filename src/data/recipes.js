/**
 * Crafting recipes.
 *
 * station  — where it's made: 'workbench' (in your home), 'stove' (bigger homes),
 *            'forge' (the smithy's forge — for a fee — or a forge you build yourself)
 * inputs   — consumed items
 * output   — produced items (tools, furniture and cooked food come out with a quality)
 * ms       — real-time duration before skill modifiers
 * energy   — how tiring it is
 * skill    — skill trained (and that speeds it up); minSkill — skill level required
 * tool     — tool kind required (it wears a little with each use)
 * unlock   — progression unlock needed (see data/unlocks.js)
 */
export const RECIPES = {
  // Workbench (carpentry)
  planks: { station: 'workbench', inputs: { wood: 2 }, output: { planks: 1 }, ms: 1400, energy: 1, skill: 'carpentry', skillXp: 6, xp: 3, unlock: 'crafting' },
  stool: { station: 'workbench', inputs: { planks: 2 }, output: { stool: 1 }, ms: 2600, energy: 2, skill: 'carpentry', skillXp: 12, xp: 6, tool: 'saw', unlock: 'crafting' },
  chair: { station: 'workbench', inputs: { planks: 3 }, output: { chair: 1 }, ms: 3400, energy: 2, skill: 'carpentry', skillXp: 16, xp: 8, tool: 'saw', minSkill: 2, unlock: 'crafting' },
  table: { station: 'workbench', inputs: { planks: 5 }, output: { table: 1 }, ms: 4600, energy: 3, skill: 'carpentry', skillXp: 24, xp: 12, tool: 'saw', minSkill: 3, unlock: 'crafting' },
  cabinet: { station: 'workbench', inputs: { planks: 8, iron_ingot: 1 }, output: { cabinet: 1 }, ms: 6400, energy: 4, skill: 'carpentry', skillXp: 36, xp: 18, tool: 'saw', minSkill: 5, unlock: 'crafting' },
  fishing_rod: { station: 'workbench', inputs: { planks: 2 }, output: { fishing_rod: 1 }, ms: 2400, energy: 1, skill: 'carpentry', skillXp: 10, xp: 5, minSkill: 1, unlock: 'crafting' },
  // Equipment (a real basket, barrow or cart — see EquipmentSystem), made at the workbench.
  basket_eq: { station: 'workbench', inputs: { wood: 4 }, output: {}, equipment: 'basket', ms: 2400, energy: 2, skill: 'carpentry', skillXp: 10, xp: 5, unlock: 'crafting' },
  crate_eq: { station: 'workbench', inputs: { planks: 5 }, output: {}, equipment: 'crate', ms: 3000, energy: 2, skill: 'carpentry', skillXp: 12, xp: 6, tool: 'saw', minSkill: 1, unlock: 'crafting' },
  wheelbarrow_eq: { station: 'workbench', inputs: { planks: 8, iron_ingot: 1 }, output: {}, equipment: 'wheelbarrow', ms: 5200, energy: 4, skill: 'carpentry', skillXp: 30, xp: 16, tool: 'saw', minSkill: 2, unlock: 'crafting' },
  handcart_eq: { station: 'workbench', inputs: { planks: 14, iron_ingot: 2 }, output: {}, equipment: 'handcart', ms: 7200, energy: 5, skill: 'carpentry', skillXp: 44, xp: 24, tool: 'saw', minSkill: 3, tech: 'handcart', unlock: 'crafting' },
  bow: { station: 'workbench', inputs: { planks: 2, hide: 1 }, output: { bow: 1 }, ms: 3200, energy: 2, skill: 'carpentry', skillXp: 14, xp: 7, tool: 'saw', minSkill: 2, unlock: 'crafting' },

  // Forge (smithing)
  iron_ingot: { station: 'forge', inputs: { iron_ore: 2, coal: 1 }, output: { iron_ingot: 1 }, ms: 2600, energy: 3, skill: 'smithing', skillXp: 8, xp: 4, unlock: 'crafting' },
  hammer: { station: 'forge', inputs: { iron_ingot: 1, planks: 1 }, output: { hammer: 1 }, ms: 3000, energy: 3, skill: 'smithing', skillXp: 14, xp: 8, unlock: 'crafting' }, // your first hammer needs none
  axe: { station: 'forge', inputs: { iron_ingot: 1, planks: 1 }, output: { axe: 1 }, ms: 3200, energy: 3, skill: 'smithing', skillXp: 14, xp: 8, tool: 'hammer', minSkill: 1, unlock: 'crafting' },
  saw: { station: 'forge', inputs: { iron_ingot: 1, planks: 1 }, output: { saw: 1 }, ms: 3200, energy: 3, skill: 'smithing', skillXp: 14, xp: 8, tool: 'hammer', minSkill: 1, unlock: 'crafting' },
  hoe: { station: 'forge', inputs: { iron_ingot: 1, planks: 1 }, output: { hoe: 1 }, ms: 3000, energy: 3, skill: 'smithing', skillXp: 12, xp: 7, tool: 'hammer', minSkill: 1, unlock: 'crafting' },
  pickaxe: { station: 'forge', inputs: { iron_ingot: 2, planks: 1 }, output: { pickaxe: 1 }, ms: 3800, energy: 4, skill: 'smithing', skillXp: 18, xp: 10, tool: 'hammer', minSkill: 2, unlock: 'crafting' },
  iron_axe: { station: 'forge', inputs: { iron_ingot: 3, planks: 1 }, output: { iron_axe: 1 }, ms: 4600, energy: 4, skill: 'smithing', skillXp: 26, xp: 14, tool: 'hammer', minSkill: 4, unlock: 'crafting' },
  iron_pickaxe: { station: 'forge', inputs: { iron_ingot: 4, planks: 1 }, output: { iron_pickaxe: 1 }, ms: 5200, energy: 5, skill: 'smithing', skillXp: 30, xp: 16, tool: 'hammer', minSkill: 5, unlock: 'crafting' },

  // Stove (cooking)
  grilled_fish: { station: 'stove', inputs: { fish: 1 }, output: { grilled_fish: 1 }, ms: 1600, energy: 0.5, skill: 'cooking', skillXp: 5, xp: 3, unlock: 'crafting' },
  roast_meat: { station: 'stove', inputs: { meat: 1 }, output: { roast_meat: 1 }, ms: 2000, energy: 0.5, skill: 'cooking', skillXp: 6, xp: 3, unlock: 'crafting' },
  bread: { station: 'stove', inputs: { wheat: 3 }, output: { bread: 2 }, ms: 2200, energy: 1, skill: 'cooking', skillXp: 6, xp: 3, minSkill: 1, unlock: 'crafting' },
  vegetable_soup: { station: 'stove', inputs: { carrot: 1, potato: 1, cabbage: 1 }, output: { vegetable_soup: 2 }, ms: 2400, energy: 1, skill: 'cooking', skillXp: 8, xp: 4, unlock: 'crafting' },
  stew: { station: 'stove', inputs: { meat: 1, potato: 1, carrot: 1 }, output: { stew: 2 }, ms: 2800, energy: 1, skill: 'cooking', skillXp: 10, xp: 5, minSkill: 2, unlock: 'crafting' },
  pie: { station: 'stove', inputs: { wheat: 2, apple: 2 }, output: { pie: 2 }, ms: 3000, energy: 1, skill: 'cooking', skillXp: 12, xp: 6, minSkill: 3, unlock: 'crafting' },
};
