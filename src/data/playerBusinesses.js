/**
 * Businesses the player can run. A business lives in a building the player
 * constructed (see buildables.js → effect.business).
 *
 * products — what it makes: inputs consumed, labor (worker-hours) per unit
 * input    — the raw material it needs; workers haul it from your storage
 *            (or it's bought from the lumberyard if "auto-buy" is on)
 * openHours — when customers can come in
 */
export const PLAYER_BUSINESS_TYPES = {
  carpentry: {
    input: 'wood',
    inputSupplier: 'lumberyard',
    openHours: [9, 20], // open into the evening, when villagers are free to shop
    products: {
      planks: { inputs: { wood: 2 }, labor: 0.5, target: 6 }, // intermediate + sellable
      stool: { inputs: { planks: 2 }, labor: 1.5, target: 3 },
      chair: { inputs: { planks: 3 }, labor: 2, target: 3 },
      table: { inputs: { planks: 5 }, labor: 3, target: 2 },
    },
    sells: ['stool', 'chair', 'table', 'planks'],
  },
};

/** Price levels the player can choose: price multiplier and effect on customer demand. */
export const PRICE_LEVELS = {
  cheap: { price: 0.8, demand: 1.5 },
  normal: { price: 1, demand: 1 },
  premium: { price: 1.3, demand: 0.55 },
};

export const BUSINESS_TUNING = {
  customerChance: 0.22, // daily chance a well-off household decides to visit
  customerMinMoney: 50,
  villageBonus: 1.25, // land feature "village centre"
  surplusSellFactor: 0.7, // store pays this share of its price for surplus
  traderPerDay: 2, // passing traders buy a couple of surplus items a day…
  traderPriceFactor: 0.55, // …at a low price
  historyDays: 7,
};
