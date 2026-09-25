/**
 * Land and territory: what land is worth, what it becomes, what the valley's parts are called.
 * See TerritorySystem (world/Parcels.js divides the land into plots).
 */

/** Land prices. The price of a plot is its size × this, adjusted for where it is and what's around it. */
export const LAND = {
  perTile: 3, // bare land, far from anything
  lotMargin: 1, // a new building's lot: its footprint and this much around it
  lotPremium: 1.25, // a lot carved out of village land costs a little more than raw land
  buyReach: 2, // you must be standing on the land, or this close to it, to buy it
  npcSellFactor: 1.15, // villagers want a bit more than it's worth
  offerAccept: 1.35, // …and will sell land they don't use for this much over its value
  forestDiscount: 0.35, // land covered in trees (it has to be cleared)
  unownedToVillage: true, // unclaimed land is bought from the village (it keeps the register)
};

/** Owners land can have. */
export const OWNER_KINDS = ['player', 'npc', 'company', 'village', 'community', 'none'];

/** Names for plots: what kind of land it mostly is. */
export const PARCEL_KINDS = ['meadow', 'woods', 'field', 'hillside', 'shore', 'village', 'rocky'];
