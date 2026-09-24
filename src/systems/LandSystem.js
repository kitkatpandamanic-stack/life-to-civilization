/**
 * LandSystem — plots of land, their value and who owns them.
 *
 * A plot's price and features come from where it is:
 *   village centre → expensive, more customers for businesses
 *   near water     → crops grow faster, water for watering cans
 *   forest         → cheap, full of wood, but must be cleared before building
 *   road access    → faster travel
 * Land is bought from the village (the money goes to the village treasury).
 */
import { PLOTS, LAND_PRICING } from '../data/land.js';
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';

const L = LAND_PRICING;

export class LandSystem {
  constructor(sim) {
    this.sim = sim;
    this.cache = new Map();
    sim.state.village ??= { treasury: 0 };
  }

  get owned() {
    return this.sim.state.land.owned;
  }

  plot(id) {
    return PLOTS.find((p) => p.id === id);
  }

  isOwned(id) {
    return this.owned.includes(id);
  }

  /** Plots nobody has bought yet. */
  forSale() {
    return PLOTS.filter((p) => !this.isOwned(p.id) && !this.sim.state.land.npcOwned?.[p.id]);
  }

  /** The plot containing this tile, or null. */
  plotAt(tx, ty) {
    return PLOTS.find((p) => tx >= p.x1 && tx <= p.x2 && ty >= p.y1 && ty <= p.y2) || null;
  }

  /** Is this tile on land the player owns? */
  ownsTile(tx, ty) {
    const p = this.plotAt(tx, ty);
    return !!p && this.isOwned(p.id);
  }

  /** Location analysis (cached for the current day — it scans the world). */
  info(id) {
    const cached = this.cache.get(id);
    if (cached && cached.day === this.sim.time.day && cached.total > this.sim.time.total - 30) return cached.info;
    const info = this.analyze(id);
    this.cache.set(id, { day: this.sim.time.day, total: this.sim.time.total, info });
    return info;
  }

  /** Size, trees, water, road distance, distance to the plaza. */
  analyze(id) {
    const plot = this.plot(id);
    const world = this.sim.world;
    let buildable = 0;
    let water = false;
    let roadDist = Infinity;
    for (let y = plot.y1 - 2; y <= plot.y2 + 2; y++) {
      for (let x = plot.x1 - 2; x <= plot.x2 + 2; x++) {
        const t = world.tileAt(x, y);
        if (t === T.WATER || t === T.DEEP) water = true;
        const inside = x >= plot.x1 && x <= plot.x2 && y >= plot.y1 && y <= plot.y2;
        if (inside && t !== T.WATER && t !== T.DEEP && t !== T.CLIFF) buildable++;
        if (world.isRoad(x, y)) {
          const d = Math.max(0, plot.x1 - x, x - plot.x2) + Math.max(0, plot.y1 - y, y - plot.y2);
          roadDist = Math.min(roadDist, d);
        }
      }
    }
    let trees = 0;
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind === 'tree' && o.state === 'grown' && o.tx >= plot.x1 && o.tx <= plot.x2 && o.ty >= plot.y1 && o.ty <= plot.y2) trees++;
    }
    const P = AREAS.plaza;
    const cx = (plot.x1 + plot.x2) / 2;
    const cy = (plot.y1 + plot.y2) / 2;
    const plazaDist = Math.abs(cx - (P.x1 + P.x2) / 2) + Math.abs(cy - (P.y1 + P.y2) / 2);
    const features = [];
    if (plazaDist < 26) features.push('village');
    if (water) features.push('water');
    if (trees >= 6) features.push('forest');
    if (roadDist <= 2) features.push('road');
    if (plazaDist > 55) features.push('remote');
    const w = plot.x2 - plot.x1 + 1;
    const h = plot.y2 - plot.y1 + 1;
    return { plot, w, h, buildable, trees, water, roadDist, plazaDist, features };
  }

  price(id) {
    const i = this.info(id);
    let p = i.buildable * L.perTile;
    p *= 1 + Math.max(0, (L.centreRange - i.plazaDist) / L.centreRange) * L.centreBonus;
    if (i.water) p *= 1 + L.waterBonus;
    if (i.roadDist <= 2) p *= 1 + L.roadBonus;
    p *= 1 - Math.min(L.forestDiscount, (i.trees / Math.max(1, i.buildable)) * 1.5);
    return Math.round(p / 5) * 5;
  }

  hasFeature(id, feature) {
    return this.info(id).features.includes(feature);
  }

  check(id) {
    if (this.isOwned(id)) return { ok: false, reason: 'already_owned' };
    if (!this.sim.progression.hasUnlock('buy_land')) return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel('buy_land') } };
    if (this.sim.state.player.money < this.price(id)) return { ok: false, reason: 'no_money' };
    return { ok: true };
  }

  buy(id) {
    const c = this.check(id);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const price = this.price(id);
    this.sim.state.player.money -= price;
    this.sim.state.village.treasury += price;
    this.owned.push(id);
    this.sim.progression.addXp(40);
    this.sim.progression.addReputation(2);
    this.sim.toast('toast.land_bought', { plot: id, money: price }, 'good');
    this.sim.chronicle('chronicle.player_land', { plot: id });
    this.sim.bus.emit('land:changed', id);
    this.sim.bus.emit('player:changed');
    return true;
  }
}
