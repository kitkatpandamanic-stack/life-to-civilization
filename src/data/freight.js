/**
 * Carrying goods for other people (FreightSystem): your carting business and your caravans.
 *
 * The valley's shops and workshops send goods to each other every day (LogisticsSystem). Without
 * you, porters (people out of work) or the village's carters' firm carry them. Sign up as a carrier
 * and some of that work comes to you; found a company at a transport depot and your workers carry
 * it too, with your barrows, carts and wagons.
 */
export const FREIGHT = {
  // Signing up (just you) and founding a company (a depot, your workers).
  foundCost: 150, // registering a carting company
  selfJobs: 1, // on your own: one delivery at a time
  jobsPerWorker: 2, // a company: open deliveries it can take on, per worker (at least minJobs)
  minJobs: 2,
  // How much of the valley's carrying comes your way (decided per shipment, without dice).
  share: { porters: 0.8, firm: 0.45 }, // …against porters on foot, against the village's carters' firm
  minQty: 4, // loads smaller than this aren't worth a carrier
  // Your rates: cheaper wins more work, dearer earns more per load.
  rates: {
    cheap: { fee: 0.8, share: 1.3 },
    fair: { fee: 1, share: 1 },
    dear: { fee: 1.25, share: 0.65 },
  },
  feeFloor: 6, // the least a delivery pays
  feeMult: 1.6, // what you're paid, × the porters' fee (a carrier who turns up is worth more)
  // Time: the buyer expects the goods within porters' time × this (+ a margin).
  dueMult: 2.2,
  dueMargin: 120,
  lateFee: 0.6, // late: this share of the fee
  handOver: 360, // minutes past due with nothing picked up: it goes to the porters instead
  // Reputation (0–100): on time up, late or handed over down. Better reputation, more work.
  rep: { start: 50, onTime: 2, late: -4, handedOver: -6 },
  // Carrying it yourself.
  handCap: 20, // what you carry in your arms
};

/** Your own caravans: your cart, a worker driving it, goods from your storage, to another settlement. */
/** The river (boats from your dock to the towns on the water — FreightSystem caravans with a boat). */
export const RIVER = {
  speed: { rowboat: 1.5, barge: 1.2 }, // × the road caravan's pace (on top of the water being quicker anyway)
  wearPerDay: 2, // condition lost a day afloat
  pirates: 0.16, // chance a boat is robbed on the way (the river pirates)…
  guardCut: 0.35, // …with a guard aboard, this share of it
  robbedKeep: 0.4,
  lowWaterChance: 0.4, // some summers the river runs low…
  lowWaterCap: 0.5, // …and a barge can take only this share of its load (a rowboat floats anyway)
  dockExport: 1.05, // a dock in the valley: the village's shops get this much more for what they sell away
};

export const CARAVAN = {
  kinds: ['push', 'pull', 'animal'], // barrows no, carts and wagons yes (not baskets)
  minCargo: 10,
  speed: { handcart: 1, wooden_wagon: 0.9, pack_horse: 1.6, horse_cart: 1.3, wagon: 1.15 },
  marketHours: 12, // time spent selling and buying there
  driverPerDay: 4, // extra pay for the driver, a day on the road
  wearPerDay: 6, // condition lost a day on the road
  robbery: 0.5, // × the road's danger (SettlementSystem.danger): chance the caravan's robbed
  robbedKeep: 0.3, // …they leave the driver this share of the goods
  guardCut: 0.5, // two on the road (a second worker): the danger halves
  maxBuyShare: 1, // what they bring back: up to this × what they sold for
};
