/**
 * RealtySystem — the housing market (building spec, Phase 7).
 *
 * Nothing about rents and prices is fixed. Each week the market takes stock — homes, how many
 * stand empty, how many households are looking (the homeless, those in a spare room or the
 * village hall, crowded families, people unhappy where they are), what's being built, who came
 * and who left — and the level of rents and prices (idx) drifts toward what supply and demand
 * say. It moves a little each week, never all at once:
 *
 *   more people → more looking → fewer empty homes → rents up → building pays → more homes → rents ease
 *
 * Nobody scripts that chain: villagers who invest (PropertySystem.investInHouses) buy or build to
 * let when rents are worth having; the village builds when people have no roof (GrowthSystem);
 * newcomers come when there's work and room.
 *
 * A home's price and rent are made of parts, so you can see why (PropertyPanel):
 *   price: building (type, level, rooms, quality) · condition · location · infrastructure · street
 *          (district) · the land · demand · the rent it brings in
 *   rent:  the same, as a weekly rent — plus work nearby, shops and services nearby, the neighbours
 *
 *   state.realty = { idx, weeks: [{ day, homes, vacant, seekers, idx, avgRent, avgPrice, pop, built, arrived, left }] }
 */
import { PROPERTY_VALUE, HOUSING as H, REALTY as R } from '../data/housing.js';
import { AREAS } from '../data/villageLayout.js';
import { INFRA } from '../data/infra.js';

export class RealtySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.realty ??= { idx: null, weeks: [] };
    this.priceCache = new Map();
    this.rentCache = new Map();
    this.lastPop = sim.state.npcs.length;
    sim.property.valueCache?.clear(); // (prices worked out before the market opened)
    sim.bus.on('time:day', () => {
      this.priceCache.clear();
      this.rentCache.clear();
      if (sim.time.weekday === 0) this.weekly();
    });
    // A building changed (upgraded, repaired, sold, let): its price and rent are worked out afresh.
    const forget = (id) => {
      if (typeof id === 'string') {
        this.priceCache.delete(id);
        this.rentCache.delete(id);
      } else {
        this.priceCache.clear();
        this.rentCache.clear();
      }
    };
    sim.bus.on('building:changed', forget);
    // The land's worth moved (TerritorySystem's week), or the neighbourhoods were counted afresh: prices with it.
    const all = () => {
      forget(null);
      sim.property?.valueCache?.clear();
    };
    sim.bus.on('territory:week', all);
    sim.bus.on('places:changed', all);
    sim.bus.on('property:changed', forget);
    sim.bus.on('construction:changed', (c) => c.status === 'done' && c.kind === 'building' && this.sim.property.isHome(c.id) && (this.built = (this.built || 0) + 1));
  }

  get S() {
    return this.sim.state.realty;
  }

  // ------------------------------------------------------------------ supply and demand

  /** The level of rents and prices: 1 = ordinary; above when homes are short, below when they stand empty. */
  get idx() {
    this.S.idx ??= this.target().v;
    return this.S.idx;
  }

  /** Who's looking for a home, and what's free — what the market would settle at. */
  target() {
    const sim = this.sim;
    const P = sim.property;
    const homes = P.homes().filter((id) => !P.rec(id)?.abandoned && id !== 'hall');
    const cap = homes.reduce((s, id) => s + P.capacity(id), 0) || 1;
    const people = sim.state.npcs.length + 1;
    const vacant = homes.filter((id) => P.isVacant(id)).length;
    const npcs = sim.state.npcs;
    const homeless = npcs.filter((n) => (!n.homeId || n.homeId === 'hall') && n.age >= 16).length;
    const lodgers = npcs.filter((n) => n.lodger && n.age >= 16).length;
    const crowded = homes.filter((id) => P.occupants(id) > P.capacity(id)).length;
    const unhappy = npcs.filter((n) => n.housing && n.housing.sat < 35 && sim.housing?.isHead(n)).length;
    const building = sim.construction.sites().filter((c) => c.kind === 'building' && ['home', 'rental'].includes(c.purpose)).length;
    const seekers = homeless + lodgers * 0.6 + crowded + unhappy * 0.3;
    // How full the valley's homes are, and how many are looking against how many are free.
    const v = Math.max(R.minIdx, Math.min(R.maxIdx, 0.7 + (people / cap) * 0.5 + (seekers - vacant - building * 0.5) / Math.max(4, homes.length) * R.pressure));
    return { v, homes: homes.length, vacant, seekers: Math.round(seekers * 10) / 10, homeless, building };
  }

  /** The week's stock-take: the level drifts toward supply and demand, and the figures are kept. */
  weekly() {
    const sim = this.sim;
    const P = sim.property;
    const t = this.target();
    const before = this.idx;
    this.S.idx = before + Math.max(-R.maxStep, Math.min(R.maxStep, t.v - before));
    this.priceCache.clear();
    this.rentCache.clear();
    P.valueCache?.clear();
    const homes = P.homes().filter((id) => !P.rec(id)?.abandoned && id !== 'hall');
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const pop = sim.state.npcs.length;
    const row = {
      day: sim.time.day,
      homes: t.homes,
      vacant: t.vacant,
      seekers: t.seekers,
      idx: Math.round(this.S.idx * 100) / 100,
      avgRent: avg(homes.map((id) => P.marketRent(id))),
      avgPrice: avg(homes.map((id) => P.value(id))),
      pop,
      built: this.built || 0,
      moved: pop - this.lastPop,
    };
    this.built = 0;
    this.lastPop = pop;
    this.S.weeks.push(row);
    if (this.S.weeks.length > R.keepWeeks) this.S.weeks.shift();
    // A big swing over a month is news (once a season at most).
    const past = this.S.weeks[this.S.weeks.length - 5];
    if (past?.avgRent > 0 && sim.time.day - (this.S.newsDay ?? -999) > 56) {
      const k = row.avgRent >= past.avgRent * 1.2 ? 'rents_rising' : row.avgRent <= past.avgRent * 0.82 ? 'rents_falling' : null;
      if (k) {
        this.S.newsDay = sim.time.day;
        sim.chronicle(`chronicle.${k}`, { money: row.avgRent });
      }
    }
    sim.bus.emit('realty:week', row);
    return row;
  }

  /** How the market's doing: 'high' · 'normal' · 'low', and the trend over the last month. */
  mood() {
    const w = this.S.weeks;
    const i = this.idx;
    const past = w[Math.max(0, w.length - 5)];
    const now = w[w.length - 1];
    const trend = past && now && past.avgRent ? (now.avgRent - past.avgRent) / past.avgRent : 0;
    return { demand: i >= 1.2 ? 'high' : i <= 0.9 ? 'low' : 'normal', trend: trend > 0.04 ? 'up' : trend < -0.04 ? 'down' : 'flat', idx: i };
  }

  // ------------------------------------------------------------------ what a home is worth

  /**
   * The price of a building, part by part: [{ k, v }] and the total.
   * (Built from what it is, what state it's in, where it stands, the land, the market — and, for a
   * house let out, the rent it brings in: a buyer pays for that too.)
   */
  priceParts(id) {
    const hit = this.priceCache.get(id);
    if (hit) return hit;
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(id);
    const b = P.building(id);
    const base = PROPERTY_VALUE[P.type(id)] ?? 200;
    const parts = [];
    const add = (k, v) => v && parts.push({ k, v });
    // What it is: its type, level, rooms and quality (StructureSystem).
    const building = base * (sim.structures?.valueFactor(id) ?? 1);
    add('building', building);
    // Its repair.
    const cond = building * (0.25 + 0.75 * ((r?.condition ?? 100) / 100) - 1);
    add('condition', cond);
    let sub = building + cond;
    // Where it is: near the plaza is worth more; a road at the door, a well near.
    const Pz = AREAS.plaza;
    const d = b ? Math.hypot(b.door.tx - (Pz.x1 + Pz.x2) / 2, b.door.ty - (Pz.y1 + Pz.y2) / 2) : 30;
    const loc = sub * (0.2 - Math.min(0.45, d / 90));
    add('location', loc);
    // …and a paved street, a lamp by the door (InfrastructureSystem).
    const cov = b && sim.infra?.coverage(b.door.tx, b.door.ty);
    const infra = b ? sub * ((P.nearRoad(b) ? R.roadBonus : 0) + (this.wellNear(b) ? R.wellBonus : 0) + (cov?.paved ? INFRA.price.paved : 0) + (cov?.light ? INFRA.price.lamps : 0)) : 0;
    add('infrastructure', infra);
    sub += loc + infra;
    // The street it's on (GrowthSystem districts: homes in quiet streets, shops in busy ones).
    const district = sub * ((sim.growth?.valueFactor(id) ?? 1) - 1);
    add('district', district);
    sub += district;
    // The land under it (TerritorySystem): its lot at today's land value.
    const land = this.landUnder(id) * R.landShare;
    add('land', land);
    sub += land;
    // Supply and demand.
    const demand = sub * (P.demand() - 1);
    add('demand', demand);
    sub += demand;
    // A house let out brings rent: a buyer pays for the income too.
    const L = r?.lease;
    const rentIn = sim.flats?.isBlock(id) ? sim.flats.income(id) : L?.rent;
    if (rentIn) add('income', Math.max(0, rentIn * R.incomeWeeks - sub) * R.incomeShare);
    for (const p of parts) p.v = Math.round(p.v);
    const out = { parts, total: Math.max(0, parts.reduce((s, p) => s + p.v, 0)) };
    this.priceCache.set(id, out);
    return out;
  }

  /** The going rent a week, part by part — the price's parts as rent, and what's near the door. */
  rentParts(id) {
    const hit = this.rentCache.get(id);
    if (hit) return hit;
    const sim = this.sim;
    const pp = this.priceParts(id);
    const parts = pp.parts.filter((p) => p.k !== 'income').map((p) => ({ k: p.k === 'building' ? 'base' : p.k, v: p.v * H.rentPerWeekShare }));
    const base = parts.find((p) => p.k === 'base')?.v || 0;
    // Tenants pay for what's around them: work, shops, a decent street.
    const f = sim.housing?.facts(id);
    const jobs = this.jobsNear(id);
    parts.push({ k: 'jobs', v: base * Math.min(R.jobsMax, jobs * R.perJob) });
    if (f) {
      parts.push({ k: 'services', v: base * Math.min(R.servicesMax, Math.max(0, f.services ?? 0) * R.perService) });
      parts.push({ k: 'neighbourhood', v: base * f.area * R.areaShare });
    }
    for (const p of parts) p.v = Math.round(p.v * 10) / 10;
    const out = { parts: parts.filter((p) => Math.abs(p.v) >= 0.1), total: Math.max(3, Math.round(parts.reduce((s, p) => s + p.v, 0))) };
    this.rentCache.set(id, out);
    return out;
  }

  /** The value of the land a building stands on (its footprint and a strip around). */
  landUnder(id) {
    const T2 = this.sim.territory;
    const b = this.sim.property.building(id);
    if (!T2 || !b) return 0;
    let v = 0;
    for (let y = b.ty - 1; y <= b.ty + b.h; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) if (T2.idAt(x, y)) v += T2.tileValue(x, y);
    return v;
  }

  wellNear(b) {
    const w = this.sim.world;
    for (const d of w.decor) if (d.type === 'well' && Math.abs(d.tx - b.door.tx) + Math.abs(d.ty - b.door.ty) <= 14) return true;
    for (const o of w.buildingList) if (o.type === 'well' && Math.abs(o.door.tx - b.door.tx) + Math.abs(o.door.ty - b.door.ty) <= 14) return true;
    return false;
  }

  /** People employed within walking distance of this building. */
  jobsNear(id) {
    const sim = this.sim;
    const b = sim.property.building(id);
    if (!b) return 0;
    let n = 0;
    for (const bizId of sim.economy.active()) {
      const w = sim.economy.buildingOf(bizId);
      if (!w || Math.abs(w.door.tx - b.door.tx) + Math.abs(w.door.ty - b.door.ty) > R.jobsRadius) continue;
      n += sim.npcs.staffOf(bizId).length;
    }
    return n;
  }
}
