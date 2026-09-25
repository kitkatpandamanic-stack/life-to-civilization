/**
 * LandSystem — the player's side of land: which land is yours, what it's worth, buying it.
 *
 * The valley is divided into plots (TerritorySystem, world/Parcels.js): the signposted
 * plots for sale (data/land.js PLOTS), the lot every building stands on, and the meadows,
 * woods, fields and hillsides in between. Any of them can be yours — you buy land standing
 * on it (or right beside it). The money goes to whoever sells: the village (its own land,
 * and unclaimed land, which it keeps the register of) or a villager.
 *
 * A plot's price and features come from where it is:
 *   village centre → expensive, more customers for businesses
 *   near water     → crops grow faster, water for watering cans
 *   forest         → cheap, full of wood, but must be cleared before building
 *   road access    → faster travel
 *
 * plotAt() still means the signposted plots only (nature and villagers leave those alone).
 */
import { PLOTS } from '../data/land.js';

export class LandSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.village ??= { treasury: 0 };
  }

  get T() {
    return this.sim.territory;
  }

  /** Your land (plot ids) — kept up to date by TerritorySystem. */
  get owned() {
    return this.sim.state.land.owned;
  }

  /** Your land, not counting the lots under your buildings (those go with the building). */
  holdings() {
    return this.owned.filter((id) => this.T?.parcel(id)?.kind !== 'lot' || !this.T.buildingsOn(id).length);
  }

  /** A plot by id: a signposted plot, or any other piece of land (its shape). */
  plot(id) {
    return PLOTS.find((p) => p.id === id) || this.T?.parcel(id) || null;
  }

  isOwned(id) {
    return this.T ? this.T.owner(id) === 'player' : this.owned.includes(id);
  }

  /** Signposted plots still for sale (the village's). */
  forSale() {
    return PLOTS.filter((p) => (this.T ? this.T.owner(p.id) === 'village' : !this.isOwned(p.id)));
  }

  /** The signposted plot containing this tile, or null. */
  plotAt(tx, ty) {
    return PLOTS.find((p) => tx >= p.x1 && tx <= p.x2 && ty >= p.y1 && ty <= p.y2) || null;
  }

  /** The piece of land this tile is part of (any kind), or null (water, roads). */
  parcelAt(tx, ty) {
    return this.T?.parcelAt(tx, ty) || null;
  }

  /** Is this tile on land the player owns? */
  ownsTile(tx, ty) {
    if (this.T) return this.T.ownerAt(tx, ty) === 'player';
    const p = this.plotAt(tx, ty);
    return !!p && this.owned.includes(p.id);
  }

  /** Size, trees, water, road distance, distance to the plaza, features. */
  info(id) {
    return this.T.info(id);
  }

  price(id) {
    return this.T.price(id);
  }

  hasFeature(id, feature) {
    return this.T.hasFeature(id, feature);
  }

  /** Can you buy it? (You must be on it, or right beside it.) */
  check(id, opts) {
    return this.T.canBuy(id, 'player', opts);
  }

  buy(id, opts) {
    const r = this.T.buy(id, 'player', opts);
    if (!r.ok) {
      this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      return false;
    }
    this.sim.toast('toast.land_bought', { plot: id, money: r.price }, 'good');
    return true;
  }

  /** Put land of yours up for sale, or take it off the market. */
  setForSale(id, on) {
    return this.T.setForSale(id, on, 'player');
  }
}
