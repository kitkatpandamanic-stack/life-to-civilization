/**
 * How goods travel. Carriers become available as the village develops
 * (see TechSystem — a carpenter makes handcarts possible, stables bring horses…).
 *
 * speed   — tiles per game minute on open ground (roads are faster, see roadBonus)
 * cap     — units per trip (bigger orders need several trips)
 * fee     — cost per unit per tile (paid by whoever ordered the goods)
 * needs   — technology required
 */
export const CARRIERS = {
  porter: { speed: 1.1, cap: 8, fee: 0.02, needs: null, sprite: 'porter' },
  handcart: { speed: 1.5, cap: 20, fee: 0.012, needs: 'handcart', sprite: 'handcart' },
  horse_cart: { speed: 2.8, cap: 40, fee: 0.009, needs: 'draft_animals', sprite: 'horse_cart' },
  wagon: { speed: 3.2, cap: 80, fee: 0.007, needs: 'wagons', sprite: 'wagon' },
};

export const LOGISTICS = {
  roadBonus: 1.6, // carts move this much faster on a road
  loadMinutes: 20, // loading and unloading
  porterPayShare: 0.8, // porters (people out of work) get most of the fee
  maxVisible: 18, // carts drawn at once
  historyDays: 14,
};
