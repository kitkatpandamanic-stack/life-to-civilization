/**
 * TerritorySystem — the land itself.
 *
 * The whole valley is divided into plots of land (world/Parcels.js): the signposted plots
 * for sale, the lot every building stands on, and irregular stretches of meadow, wood,
 * field and hillside in between. Every plot has an owner:
 *
 *   'player' · a villager's id · a business id (company land) · 'village' (the village's —
 *   its commons and the land it administers) · null (nobody's: wild land, bought from the village)
 *
 *   state.territory = {
 *     plots: { [id]: { owner, since, how, price, forSale, hist: [{ owner, from, how, price }] } },
 *     ops:   [ … ]   how the map has been changed (lots carved out, plots joined or split) — replayed on load
 *     next:  n       for new plot ids
 *   }
 *
 * Who owns the land decides who may build on it: you build on your own land; villagers
 * buy a lot from the village (or a neighbour) before they build; the village builds on its own.
 * A building's lot goes with it when it's sold. Land has a price that depends on where it is.
 *
 * What each stretch of land has become (Phase 8): its profile — the buildings on it, the people
 * living there, the jobs, the trade done, its trees, stone, fields and water, the road and well —
 * and its type, which comes out of all that rather than being painted on: houses make it
 * residential, shops commercial, workshops industrial, fields agricultural; untouched woods are
 * forest; rocky ground mining land; several kinds together make it mixed; nothing yet, undeveloped.
 * Types change as the land changes, and the land remembers (plots[id].events).
 *
 * Buildings shape the land around them (land-use pressure): workplaces want worker housing near,
 * homes want shops, workshops want their materials and room from houses. New buildings prefer the
 * places that suit them (suitability) — a preference, never a rule.
 *
 * Land value and development (Phase 9): each week every plot's worth moves toward what it's now
 * worth — the road at its edge, a well, work and people nearby, shops and trade around, a school,
 * safety, the demand for homes, water and quiet — a step at a time (plots[id].lv, with a record
 * of its price week by week in plots[id].lvh). Its development — undeveloped, developing,
 * developed, highly developed — is worked out from what's really there: buildings, people, work,
 * roads, a well, services, trade. A plot by the centre grows dearer as the village grows.
 */
import { buildParcels, applyOp } from '../world/Parcels.js';
import { LAND } from '../data/territory.js';
import { LAND_PRICING } from '../data/land.js';
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';
import { TERRITORY as TT, LAND_VALUE as LV, DEVELOPMENT as DV, DEV_LEVELS } from '../data/territory.js';

export class TerritorySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.territory ??= { plots: {}, ops: [], next: 1 };
    // The plots as the world was made, then everything that's happened to them since.
    this.P = sim.world.parcels || (sim.world.parcels = buildParcels(sim.world, sim.state.seed | 0));
    for (const op of this.S.ops) applyOp(this.P, op);
    this.cache = new Map();
    this.seedOwners();
    this.syncPlayerLand();
    this.profiles = new Map();
    this.rev = 0;
    sim.bus.on('building:added', () => this.rev++);
    sim.bus.on('time:day', () => sim.time.weekday === 4 && this.weekly());
  }

  get S() {
    return this.sim.state.territory;
  }
  get world() {
    return this.sim.world;
  }

  // ------------------------------------------------------------------ the map

  /** The plot (shape) by id: { id, kind, n, x1, y1, x2, y2, cx, cy }. */
  parcel(id) {
    const i = this.P.byId.get(id);
    const p = i === undefined ? null : this.P.list[i];
    return p && !p.gone ? p : null;
  }
  indexAt(x, y) {
    if (!this.world.inBounds(x, y)) return -1;
    return this.P.map[y * this.P.W + x];
  }
  /** The id of the plot this tile is part of (null for water and roads). */
  idAt(x, y) {
    const i = this.indexAt(x, y);
    return i >= 0 ? this.P.list[i].id : null;
  }
  parcelAt(x, y) {
    const i = this.indexAt(x, y);
    return i >= 0 ? this.P.list[i] : null;
  }
  all() {
    return this.P.list.filter((p) => !p.gone);
  }
  /** Every tile of a plot. */
  tiles(id) {
    const p = this.parcel(id);
    if (!p) return [];
    const i = this.P.byId.get(id);
    const out = [];
    for (let y = p.y1; y <= p.y2; y++) for (let x = p.x1; x <= p.x2; x++) if (this.P.map[y * this.P.W + x] === i) out.push([x, y]);
    return out;
  }
  contains(id, x, y) {
    return this.idAt(x, y) === id;
  }
  /** Buildings standing on a plot (by the middle of their footprint). */
  buildingsOn(id) {
    return this.world.buildingList.filter((b) => this.idAt(b.tx + Math.floor(b.w / 2), b.ty + Math.floor(b.h / 2)) === id);
  }
  /** The plot a building stands on. */
  lotOf(buildingId) {
    const b = this.world.buildings[buildingId];
    return b ? this.idAt(b.tx + Math.floor(b.w / 2), b.ty + Math.floor(b.h / 2)) : null;
  }
  /** Plots that touch this one. */
  neighbours(id) {
    const out = new Set();
    for (const [x, y] of this.tiles(id)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = this.idAt(x + dx, y + dy);
        if (o && o !== id) out.add(o);
      }
    }
    return [...out];
  }

  // ------------------------------------------------------------------ owners

  rec(id) {
    return this.S.plots[id] || null;
  }
  owner(id) {
    return this.S.plots[id]?.owner ?? null;
  }
  ownerAt(x, y) {
    const id = this.idAt(x, y);
    return id ? this.owner(id) : undefined;
  }

  /** Who owns what at the start (and for plots that appear later, e.g. after loading an older save). */
  seedOwners() {
    const sim = this.sim;
    const V = AREAS.village;
    for (const p of this.all()) {
      if (this.S.plots[p.id]) continue;
      let owner = null;
      let forSale = false;
      if (p.kind === 'plot') {
        owner = sim.state.land.owned.includes(p.id) ? 'player' : 'village';
        forSale = owner === 'village';
      } else if (p.kind === 'lot') {
        owner = sim.property?.rec(p.id.slice(4))?.owner ?? 'village';
      } else {
        // Fields belong to the farm; the village's own ground is the village's; the rest is nobody's.
        let farm = 0;
        for (const [x, y] of this.tiles(p.id)) if (this.world.tileAt(x, y) === T.FARMLAND) farm++;
        const farmOwner = sim.economy?.ownerId?.('farm');
        if (farm > p.n / 3 && farmOwner) owner = farmOwner;
        else if (p.cx >= V.x1 - 4 && p.cx <= V.x2 + 4 && p.cy >= V.y1 - 4 && p.cy <= V.y2 + 4) owner = 'village';
      }
      this.S.plots[p.id] = { owner, since: 0, how: 'old', forSale, hist: [] };
    }
  }

  /** The list of your land (state.land.owned) — other systems count on it. */
  syncPlayerLand() {
    const owned = this.all().filter((p) => this.owner(p.id) === 'player').map((p) => p.id);
    this.sim.state.land.owned.splice(0, this.sim.state.land.owned.length, ...owned);
  }

  transfer(id, owner, how, price = 0) {
    const r = this.rec(id);
    if (!r) return;
    r.hist.push({ owner: r.owner, from: r.since, how: r.how, price: r.price || undefined });
    if (r.hist.length > 10) r.hist.shift();
    r.owner = owner;
    r.since = this.sim.time.day;
    r.how = how;
    r.price = price || undefined;
    r.forSale = false;
    this.cache.delete(id);
    if (owner === 'player' || r.hist.at(-1)?.owner === 'player') this.syncPlayerLand();
    this.sim.bus.emit('land:changed', id);
  }

  /** Pay whoever sells: a villager, you, the village (for its own land and for unclaimed land), a business. */
  payTo(owner, amount) {
    if (amount <= 0) return;
    if (!owner || owner === 'village') this.sim.state.village.treasury += amount;
    else this.sim.property.payTo(owner, amount);
  }

  // ------------------------------------------------------------------ building on it

  /** May this owner build on this tile, as things stand? */
  mayBuild(by, x, y) {
    const i = this.indexAt(x, y);
    if (i < 0) return false;
    const owner = this.owner(this.P.list[i].id);
    if (owner === by) return true;
    if (by === 'village' && (owner === 'village' || owner === null)) return true;
    return false;
  }

  /** Could this owner get this tile — ground the village would sell them as a lot? */
  mayAcquire(by, x, y) {
    if (this.mayBuild(by, x, y)) return true;
    const p = this.parcelAt(x, y);
    if (!p || p.kind === 'plot') return false; // the signposted plots are sold whole
    const owner = this.owner(p.id);
    return owner === 'village' || owner === null;
  }

  /**
   * A lot for a new building (or for a building to grow onto): the part of this rectangle
   * the owner doesn't already own is carved out of the village's land and made theirs.
   * Returns the price paid (0 if it was all theirs already), or -1 if it can't be had.
   */
  acquireLot(by, x1, y1, x2, y2, { pay = true, price: paid, how = 'lot', whole = false } = {}) {
    const take = this.lotTake(by, x1, y1, x2, y2);
    const price = paid ?? this.lotPrice(by, x1, y1, x2, y2, take);
    // A new building's lot is its own piece of land — cut from the owner's own land too (not from a signposted plot).
    if (whole) for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
      const q = this.parcelAt(x, y);
      if (q && q.kind !== 'plot' && this.owner(q.id) === by) take.add(q.id);
    }
    if (!take.size) return 0;
    if (pay && by !== 'village' && price > 0) {
      const purse = by === 'player' ? { get: () => this.sim.state.player.money, pay: (v) => (this.sim.state.player.money -= v) } : this.sim.structures?.purseOf(null, by) || null;
      const n = this.sim.npcs.byId(by);
      const wallet = by === 'player' ? purse : n ? { get: () => n.money, pay: (v) => (n.money -= v) } : purse;
      if (!wallet || wallet.get() < price) return -1;
      wallet.pay(price);
      this.payTo('village', price);
    }
    const id = `l${this.S.next++}`;
    const op = { op: 'carve', id, x1, y1, x2, y2, only: [...take] };
    if (!applyOp(this.P, op)) return 0;
    this.S.ops.push(op);
    this.S.plots[id] = { owner: by, since: this.sim.time.day, how, price: price || undefined, forSale: false, hist: [] };
    for (const t of take) this.cache.delete(t);
    if (by === 'player') this.syncPlayerLand();
    this.sim.bus.emit('land:changed', id);
    return price;
  }

  /** The plots a lot over this rectangle would be cut from (the parts that aren't the owner's already). */
  lotTake(by, x1, y1, x2, y2) {
    const take = new Set();
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const p = this.parcelAt(x, y);
        if (!p || this.owner(p.id) === by) continue;
        if (!this.mayAcquire(by, x, y)) continue;
        take.add(p.id);
      }
    }
    return take;
  }

  /** What the land for a lot over this rectangle costs (only the part not already the owner's; the village pays nothing). */
  lotPrice(by, x1, y1, x2, y2, take = this.lotTake(by, x1, y1, x2, y2)) {
    if (by === 'village' || !take.size) return 0;
    let v = 0;
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (take.has(this.idAt(x, y))) v += this.tileValue(x, y);
    return Math.round(v * LAND.lotPremium);
  }

  /**
   * A building changed hands: its lot goes with it (if it was the seller's). On a big stretch
   * of land — or one with more of the seller's buildings — only the building's own lot is cut
   * out and goes with it; the seller keeps the rest.
   */
  buildingSold(buildingId, from, to) {
    const lot = this.lotOf(buildingId);
    if (!lot || this.owner(lot) !== from) return;
    const b = this.world.buildings[buildingId];
    const p = this.parcel(lot);
    const m = LAND.lotMargin;
    const others = this.buildingsOn(lot).some((o) => o.id !== buildingId && this.sim.property.rec(o.id)?.owner === from);
    if (!others && p.n <= (b.w + 2 * m) * (b.h + 2 * m) * 2) {
      this.transfer(lot, to, 'with_building');
      return;
    }
    const id = `l${this.S.next++}`;
    const op = { op: 'carve', id, x1: b.tx - m, y1: b.ty - m, x2: b.tx + b.w - 1 + m, y2: b.ty + b.h - 1 + m, only: [lot] };
    if (!applyOp(this.P, op)) return;
    this.S.ops.push(op);
    this.S.plots[id] = { owner: to, since: this.sim.time.day, how: 'with_building', forSale: false, hist: [{ owner: from, from: this.rec(lot)?.since ?? 0, how: 'split' }] };
    this.cache.delete(lot);
    if (from === 'player' || to === 'player') this.syncPlayerLand();
    this.sim.bus.emit('land:changed', id);
  }

  // ------------------------------------------------------------------ what it's worth

  /** What a single tile of land is worth, from where it is (Phase 9 makes this a living value). */
  tileValue(x, y) {
    const P = AREAS.plaza;
    const L = LAND_PRICING;
    const d = Math.abs(x - (P.x1 + P.x2) / 2) + Math.abs(y - (P.y1 + P.y2) / 2);
    let v = LAND.perTile * (1 + Math.max(0, (L.centreRange - d) / L.centreRange) * L.centreBonus);
    // What the land has come to be worth (the week's review, Phase 9).
    const i = this.indexAt(x, y);
    if (i >= 0) v *= this.S.plots[this.P.list[i].id]?.lv ?? 1;
    return v;
  }

  /** Size, trees, water, road, distance to the plaza — and what kind of land it mostly is. */
  info(id) {
    const hit = this.cache.get(id);
    if (hit && hit.day === this.sim.time.day) return hit.info;
    const p = this.parcel(id);
    if (!p) return null;
    const world = this.world;
    const i = this.P.byId.get(id);
    let buildable = 0;
    let water = false;
    let roadDist = Infinity;
    let farm = 0;
    let rock = 0;
    let mountain = 0;
    let sand = 0;
    for (let y = p.y1 - 2; y <= p.y2 + 2; y++) {
      for (let x = p.x1 - 2; x <= p.x2 + 2; x++) {
        const t = world.tileAt(x, y);
        const near = this.nearParcel(i, x, y, 2);
        if (!near) continue;
        if (t === T.WATER || t === T.DEEP) water = true;
        if (world.isRoad(x, y)) {
          const inside = this.P.map[y * this.P.W + x] === i;
          roadDist = Math.min(roadDist, inside ? 0 : this.distTo(i, x, y));
        }
        if (this.P.map[y * this.P.W + x] !== i) continue;
        if (t === T.FARMLAND) farm++;
        if (t === T.MOUNTAIN || t === T.CLIFF) mountain++;
        if (t === T.SAND) sand++;
        if (t !== T.WATER && t !== T.DEEP && t !== T.CLIFF && t !== T.MOUNTAIN) buildable++;
      }
    }
    let trees = 0;
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.tx < p.x1 || o.tx > p.x2 || o.ty < p.y1 || o.ty > p.y2 || this.P.map[o.ty * this.P.W + o.tx] !== i) continue;
      if (o.kind === 'tree' && o.state === 'grown') trees++;
      if (o.kind === 'rock' && o.state !== 'depleted') rock++;
    }
    const P = AREAS.plaza;
    const plazaDist = Math.abs(p.cx - (P.x1 + P.x2) / 2) + Math.abs(p.cy - (P.y1 + P.y2) / 2);
    const features = [];
    if (plazaDist < 26) features.push('village');
    if (water) features.push('water');
    if (trees >= Math.max(6, p.n / 12)) features.push('forest');
    if (roadDist <= 2) features.push('road');
    if (plazaDist > 55) features.push('remote');
    const kind = p.kind === 'lot' ? 'village' : farm > p.n / 3 ? 'field' : mountain > p.n / 3 ? 'hillside' : sand > p.n / 5 && water ? 'shore' : trees >= p.n / 8 ? 'woods' : rock >= 3 ? 'rocky' : plazaDist < 22 ? 'village' : 'meadow';
    const info = { plot: p, w: p.x2 - p.x1 + 1, h: p.y2 - p.y1 + 1, area: p.n, buildable, trees, rocks: rock, water, roadDist, plazaDist, features, kind };
    this.cache.set(id, { day: this.sim.time.day, info });
    return info;
  }

  nearParcel(i, x, y, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.indexAt(x + dx, y + dy) === i) return true;
    return false;
  }
  distTo(i, x, y) {
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (this.indexAt(x + dx, y + dy) === i) best = Math.min(best, Math.abs(dx) + Math.abs(dy));
    return best;
  }

  hasFeature(id, f) {
    return !!this.info(id)?.features.includes(f);
  }

  /** The price of a plot of land today. */
  price(id) {
    const i = this.info(id);
    if (!i) return 0;
    const L = LAND_PRICING;
    let v = 0;
    for (const [x, y] of this.tiles(id)) {
      const t = this.world.tileAt(x, y);
      if (t === T.CLIFF) continue;
      v += this.tileValue(x, y) * (t === T.MOUNTAIN ? 0.4 : 1);
    }
    if (i.water) v *= 1 + L.waterBonus;
    if (i.roadDist <= 2) v *= 1 + L.roadBonus;
    v *= 1 - Math.min(LAND.forestDiscount, (i.trees / Math.max(1, i.buildable)) * 1.5);
    return Math.max(5, Math.round(v / 5) * 5);
  }

  /** What to call a plot: a signposted one has a name; the rest are described. */
  nameParts(id) {
    const p = this.parcel(id);
    if (!p) return null;
    if (p.kind === 'plot') return { plot: id };
    if (p.kind === 'lot' && id.startsWith('lot_')) return { lot: id.slice(4) };
    const b = this.buildingsOn(id)[0];
    if (b) return { lot: b.id };
    return { kind: this.info(id)?.kind || 'meadow', n: Number(String(id).replace(/\D/g, '')) || 0 };
  }

  // ------------------------------------------------------------------ what the land has become

  /**
   * A plot's profile, from what's on it and around it (cached until the week's review, or until
   * something is built): { buildings, kinds, population, jobs, activity, resources, roads, infra, type }.
   */
  profile(id) {
    const hit = this.profiles.get(id);
    if (hit && hit.day >= this.sim.time.day - 7 && hit.rev === this.rev) return hit.p;
    const p = this.computeProfile(id);
    if (p) this.profiles.set(id, { day: this.sim.time.day, rev: this.rev, p });
    return p;
  }

  computeProfile(id) {
    const sim = this.sim;
    const q = this.parcel(id);
    if (!q) return null;
    const info = this.info(id);
    const buildings = this.buildingsOn(id);
    const kinds = {};
    let population = 0;
    let jobs = 0;
    let activity = 0;
    for (const b of buildings) {
      const k = sim.growth?.kindOf(b);
      if (k) kinds[k] = (kinds[k] || 0) + 1;
      population += sim.npcs.residentsOf(b.id).length;
      const biz = sim.economy.businessAtBuilding(b.id);
      if (biz) {
        jobs += sim.npcs.staffOf(biz).length;
        activity += sim.enterprise?.books(biz, 7).rev || 0;
      }
    }
    // Building going on here counts too.
    const sites = sim.construction.sites().filter((c) => c.kind === 'building' && this.idAt(c.tx + Math.floor(c.w / 2), c.ty + Math.floor(c.h / 2)) === id).length;
    let farmland = 0;
    for (const [x, y] of this.tiles(id)) if (this.world.tileAt(x, y) === T.FARMLAND || sim.state.fields[`${x},${y}`]) farmland++;
    const resources = { trees: info.trees, rocks: info.rocks, farmland, water: info.water };
    const infra = { road: info.roadDist <= 2, well: this.wellNear(q.cx, q.cy) };
    const roads = this.roadTiles(id);
    const p = { id, n: q.n, buildings: buildings.map((b) => b.id), kinds, population, jobs, activity: Math.round(activity), sites, resources, roads, infra };
    p.type = this.typeOf(p);
    return p;
  }

  /** The kind of land this has become, from what's actually there. */
  typeOf(p) {
    const entries = Object.entries(p.kinds);
    const total = entries.reduce((s, [, n]) => s + n, 0);
    if (total) {
      const [top, n] = entries.sort((a, b) => b[1] - a[1])[0];
      if (entries.length >= 2 && n / total < TT.mixedBelow) return 'mixed';
      return TT.kindType[top] || 'mixed';
    }
    if (p.sites) return 'developing';
    const r = p.resources;
    if (r.farmland > p.n * TT.fieldShare) return 'agricultural';
    if (r.rocks >= TT.mineRocks || this.nearSite(p.id, ['cave', 'mine_shaft', 'quarry'])) return 'mining';
    if (r.trees >= Math.max(6, p.n * TT.forestShare)) return 'forest';
    return 'undeveloped';
  }

  /** Road tiles along the plot's edge (roads aren't part of any plot — they run between them). */
  roadTiles(id) {
    let n = 0;
    const seen = new Set();
    for (const [x, y] of this.tiles(id)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (y + dy) * this.P.W + (x + dx);
        if (!seen.has(k) && this.world.isRoad(x + dx, y + dy)) {
          seen.add(k);
          n++;
        }
      }
    }
    return n;
  }

  wellNear(tx, ty, r = 14) {
    for (const d of this.world.decor) if (d.type === 'well' && Math.abs(d.tx - tx) + Math.abs(d.ty - ty) <= r) return true;
    for (const o of this.world.buildingList) if (o.type === 'well' && Math.abs(o.door.tx - tx) + Math.abs(o.door.ty - ty) <= r) return true;
    return false;
  }

  /** An exploration site of these kinds on or beside the plot (a cave, a quarry…). */
  nearSite(id, kinds) {
    const q = this.parcel(id);
    return (this.sim.state.exploration?.sites || []).some((s) => kinds.includes(s.kind) && s.tx >= q.x1 - 3 && s.tx <= q.x2 + 3 && s.ty >= q.y1 - 3 && s.ty <= q.y2 + 3);
  }

  /** Once a week: every plot's profile afresh, its worth and development — and what has changed is remembered. */
  weekly() {
    const sim = this.sim;
    this.rev = (this.rev || 0) + 1;
    let told = 0;
    let toldDev = 0;
    for (const q of this.all()) {
      const p = this.profile(q.id);
      const r = this.rec(q.id);
      if (!p || !r) continue;
      // Its worth moves a step toward what it's now worth; its price is kept week by week.
      const tv = this.valueTarget(q.id).mult;
      r.lv = r.lv === undefined ? tv : r.lv + Math.max(-LV.maxStep, Math.min(LV.maxStep, tv - r.lv));
      r.lv = Math.round(r.lv * 1000) / 1000;
      this.cache.delete(q.id);
      r.lvh ??= [];
      r.lvh.push(this.price(q.id));
      if (r.lvh.length > LV.keepWeeks) r.lvh.shift();
      // Development, from what's really there.
      const dev = this.development(q.id).level;
      if (r.dev && r.dev !== dev) {
        this.event(q.id, 'dev', { from: r.dev, to: dev });
        const di = DEV_LEVELS.indexOf(dev);
        if (toldDev < 1 && di > DEV_LEVELS.indexOf(r.dev) && di >= 2 && di > (r.devMax ?? 0)) {
          toldDev++;
          sim.chronicle('chronicle.land_developed', { plot: q.id, dev });
        }
        r.devMax = Math.max(r.devMax ?? 0, di);
      }
      r.dev = dev;
      if (r.type && r.type !== p.type) {
        this.event(q.id, 'type', { from: r.type, to: p.type });
        // Land built up for the first time, or turned to something new, is news (a little at a time).
        if (told < 2 && TT.newsTypes.includes(p.type) && r.type !== 'developing') {
          told++;
          sim.chronicle('chronicle.land_became', { plot: q.id, tfrom: r.type, ttype: p.type });
        }
      }
      r.type = p.type;
    }
    sim.bus.emit('territory:week');
  }

  /**
   * How built-up a plot is, from what's really there: { score, level, parts }.
   * (Not a number to push: buildings, people, work, roads, a well, services and trade make it.)
   */
  development(id, prev = this.rec(id)?.dev) {
    const p = this.profile(id);
    if (!p) return { score: 0, level: 'undeveloped', parts: {} };
    const sim = this.sim;
    const q = this.parcel(id);
    const pr = this.pressure(Math.round(q.cx), Math.round(q.cy));
    const levels = p.buildings.reduce((s, b) => s + (sim.structures?.rec(b) ? sim.structures.level(b) : 1), 0);
    const parts = {
      buildings: Math.min(DV.buildingsMax, levels * DV.perLevel),
      population: Math.min(DV.popMax, p.population * DV.perPerson),
      jobs: Math.min(DV.jobsMax, p.jobs * DV.perJob),
      roads: (p.infra.road ? DV.road : 0) + Math.min(DV.roadTilesMax, p.roads * DV.perRoadTile),
      infrastructure: p.infra.well ? DV.well : 0,
      services: Math.min(DV.servicesMax, pr.shops * DV.perService),
      activity: Math.min(DV.activityMax, p.activity / DV.activityPer),
    };
    const score = Object.values(parts).reduce((a, b) => a + b, 0);
    let level = DEV_LEVELS[0];
    for (let i = 0; i < DV.thresholds.length; i++) if (score >= DV.thresholds[i]) level = DEV_LEVELS[i + 1];
    // A place doesn't lose its standing over one quiet week: it slips back only on a real decline.
    const was = DEV_LEVELS.indexOf(prev);
    if (was > DEV_LEVELS.indexOf(level) && score >= DV.thresholds[was - 1] * DV.slip) level = prev;
    if (level === 'undeveloped' && p.sites) level = 'developing';
    return { score: Math.round(score * 100) / 100, level, parts };
  }

  /**
   * What the land ought to be worth now, against bare land: { mult, parts }. Road access,
   * a well, work and people nearby, shops and trade around, a school, safety, the demand for
   * homes, water and quiet — and how developed it already is.
   */
  valueTarget(id) {
    const sim = this.sim;
    const q = this.parcel(id);
    const p = this.profile(id);
    if (!q || !p) return { mult: 1, parts: {} };
    const pr = this.pressure(Math.round(q.cx), Math.round(q.cy));
    const ruins = this.world.buildingList.filter((b) => Math.abs(b.door.tx - q.cx) + Math.abs(b.door.ty - q.cy) <= 10 && (sim.property.rec(b.id)?.ruined || sim.property.rec(b.id)?.abandoned)).length;
    const dev = DEV_LEVELS.indexOf(this.development(id).level);
    const parts = {
      road: p.infra.road ? LV.road : LV.noRoad,
      infrastructure: p.infra.well ? LV.well : 0,
      jobs: Math.min(LV.jobsMax, pr.jobs * LV.perJob),
      population: Math.min(LV.popMax, pr.homes * LV.perHome),
      services: Math.min(LV.servicesMax, pr.shops * LV.perService),
      activity: Math.min(LV.activityMax, pr.activity / LV.activityPer),
      education: pr.schools ? LV.school : 0,
      safety: (sim.civic?.has('watch') ? LV.watch : 0) - Math.min(LV.ruinsMax, ruins * LV.perRuin),
      demand: ((sim.realty?.idx ?? 1) - 1) * LV.demandShare,
      environment: (p.resources.water ? LV.water : 0) + (p.resources.trees >= 4 ? LV.trees : 0) - Math.min(LV.noiseMax, pr.industry * LV.perNoise),
      development: dev * LV.perDev,
    };
    for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 1000) / 1000;
    const mult = Math.max(LV.min, Math.min(LV.max, 1 + Object.values(parts).reduce((a, b) => a + b, 0)));
    return { mult, parts };
  }

  /** Something that happened to a plot, kept with it (its history). */
  event(id, k, params = {}) {
    const r = this.rec(id);
    if (!r) return;
    r.events ??= [];
    r.events.push({ day: this.sim.time.day, k, ...params });
    if (r.events.length > TT.keepEvents) r.events.shift();
  }

  /**
   * Land-use pressure around a spot: what nearby buildings call for.
   *   housing — work nearby with few homes (worker housing)
   *   shops   — homes nearby with no shop
   *   room    — how crowded with homes it is (workshops want distance from dense housing)
   */
  pressure(tx, ty) {
    const sim = this.sim;
    const near = (b, r) => Math.abs(b.door.tx - tx) + Math.abs(b.door.ty - ty) <= r;
    let homes = 0;
    let homesClose = 0;
    let shops = 0;
    let jobs = 0;
    let industry = 0;
    let farms = 0;
    let schools = 0;
    let activity = 0;
    for (const b of this.world.buildingList) {
      const k = sim.growth?.kindOf(b);
      if (!k) continue;
      if (near(b, TT.pressureRadius)) {
        if (k === 'home') homes++;
        if (k === 'shop' || k === 'leisure') shops++;
        if (k === 'industry') industry++;
        if (k === 'farm') farms++;
        if (k === 'school' || k === 'research') schools++;
        const biz = sim.economy.businessAtBuilding(b.id);
        if (biz) {
          jobs += sim.npcs.staffOf(biz).length;
          activity += sim.enterprise?.books(biz, 7).rev || 0;
        }
      }
      if (k === 'home' && near(b, TT.closeRadius)) homesClose++;
    }
    return { homes, homesClose, shops, jobs, industry, farms, schools, activity, housing: Math.max(0, jobs - homes * 2), wantsShop: homes >= 3 && !shops };
  }

  /**
   * How well a spot suits a new building of this kind (−1 … 1): homes like homes, shops, a school
   * and work nearby without enough houses for it; shops like people and no rival next door;
   * workshops like the road, their materials, and distance from dense housing; farms like open
   * fields and water. A preference, never a rule.
   */
  suitability(kind, tx, ty) {
    const pr = this.pressure(tx, ty);
    const q = this.parcelAt(tx, ty);
    const p = q ? this.profile(q.id) : null;
    const type = p?.type || 'undeveloped';
    let s = 0;
    if (kind === 'home') {
      s += ['residential', 'mixed'].includes(type) ? 0.3 : ['industrial', 'mining'].includes(type) ? -0.3 : 0;
      s += Math.min(0.3, pr.housing * 0.06) + (pr.shops ? 0.15 : 0) + (pr.schools ? 0.1 : 0) - Math.min(0.4, pr.industry * 0.15);
    } else if (kind === 'shop' || kind === 'leisure') {
      s += Math.min(0.5, pr.homes * 0.08) + (pr.wantsShop ? 0.3 : 0) - Math.min(0.4, pr.shops * 0.2) + (['commercial', 'mixed'].includes(type) ? 0.2 : 0);
    } else if (kind === 'industry') {
      s += (p?.infra.road ? 0.2 : 0) + Math.min(0.3, ((p?.resources.trees || 0) + (p?.resources.rocks || 0)) * 0.03) + Math.min(0.2, pr.industry * 0.1) - Math.min(0.6, pr.homesClose * 0.2);
    } else if (kind === 'farm') {
      s += (type === 'agricultural' ? 0.4 : 0) + (p?.resources.water ? 0.2 : 0) - Math.min(0.5, pr.homesClose * 0.15);
    } else if (kind === 'school' || kind === 'public' || kind === 'research') {
      s += Math.min(0.6, pr.homes * 0.06) + (pr.schools ? -0.2 : 0);
    }
    return Math.max(-1, Math.min(1, s));
  }

  // ------------------------------------------------------------------ buying and selling

  /** Is the player standing on this land, or close to it? (Land is bought on the spot.) */
  playerNear(id, reach = LAND.buyReach) {
    const p = this.sim.state.player;
    const t = this.world.toTile(p.x, p.y);
    const i = this.P.byId.get(id);
    return i !== undefined && this.nearParcel(i, t.tx, t.ty, reach);
  }

  /** Can this buyer have this plot, and for how much? */
  canBuy(id, by = 'player', { anywhere = false } = {}) {
    const sim = this.sim;
    const p = this.parcel(id);
    const r = this.rec(id);
    if (!p || !r) return { ok: false, reason: 'not_for_sale' };
    if (r.owner === by) return { ok: false, reason: 'already_owned' };
    if (p.kind === 'lot' && this.buildingsOn(id).length) return { ok: false, reason: 'sold_with_building' };
    let price = this.price(id);
    if (r.owner && r.owner !== 'village') {
      if (!r.forSale) return { ok: false, reason: 'not_for_sale' };
      price = Math.round(price * LAND.npcSellFactor);
    }
    // The village doesn't sell the ground its public buildings stand on.
    if (this.buildingsOn(id).some((b) => sim.property.rec(b.id)?.owner === 'village')) return { ok: false, reason: 'not_for_sale' };
    if (by === 'player') {
      if (!sim.progression.hasUnlock('buy_land')) return { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('buy_land') } };
      if (!anywhere && !this.playerNear(id)) return { ok: false, reason: 'go_to_land' };
      if (sim.state.player.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    } else {
      const n = sim.npcs.byId(by);
      if (!n || n.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    }
    return { ok: true, price, seller: r.owner };
  }

  buy(id, by = 'player', opts = {}) {
    const chk = this.canBuy(id, by, opts);
    if (!chk.ok) return chk;
    const sim = this.sim;
    if (by === 'player') sim.state.player.money -= chk.price;
    else sim.npcs.byId(by).money -= chk.price;
    this.payTo(chk.seller, chk.price);
    this.transfer(id, by, 'bought', chk.price);
    const seller = sim.npcs.byId(chk.seller);
    if (by === 'player') {
      sim.progression.addXp(40);
      sim.progression.addReputation(2);
      sim.chronicle('chronicle.player_land', { plot: id });
      sim.bus.emit('player:changed');
      if (seller) sim.memory.remember(seller, 'sold_land_to_player', { who: 'player', params: { plot: id } });
    } else {
      const n = sim.npcs.byId(by);
      sim.memory.remember(n, 'bought_land', { params: { plot: id } });
      sim.chronicle('chronicle.npc_bought_land', { npc: n.id, gender: n.gender, plot: id });
    }
    return { ok: true, price: chk.price };
  }

  /** Put land of yours up for sale (villagers with money may buy it) — or take it off. */
  setForSale(id, on, by = 'player') {
    const r = this.rec(id);
    if (!r || r.owner !== by) return false;
    r.forSale = !!on;
    this.sim.bus.emit('land:changed', id);
    return true;
  }
}
