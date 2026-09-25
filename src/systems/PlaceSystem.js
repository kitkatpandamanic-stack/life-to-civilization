/**
 * PlaceSystem — neighbourhoods and districts: the village as places people know by name.
 *
 * Nobody draws them. Once a week the homes that have grown up close together along a road,
 * with people living in them, are found (a neighbourhood) — and a new one gets a name from
 * what's around it: the river, the mill, the forge, a well, the woods, the fields. It keeps
 * its name and its story as it grows (or dwindles): how many homes and people, what its
 * houses are worth and let for, how well they're kept, what's near (a shop, a school, a well,
 * a tavern…), the businesses among its houses — and its standing, which is what a house
 * there fetches and how villagers rate it when choosing where to live.
 *
 *   state.places = { hoods: [{ id, name: { f, v, n }, kind, homes: [ids], others: [ids],
 *                              tx, ty, x1, y1, x2, y2, founded, peak, miss, stats, hist: [] }],
 *                    next, names: { [id]: name } }       (names outlive faded neighbourhoods, for the chronicle)
 *
 * Districts are the larger stretches of the village with one main use — the grid of cells
 * GrowthSystem used to classify, now kept here with an identity and a history, and a character:
 * the old residential district of the first houses, a new development where most of it has
 * only just gone up, a university quarter.
 *
 *   state.districts = { cells: { 'x,y': type }, list: [{ id, type, cells, tx, ty, name, char, founded, hist }],
 *                       changes, lastChangeDay, next }
 */
import { AREAS } from '../data/villageLayout.js';
import { T } from '../world/WorldGenerator.js';
import { hashStr } from '../core/rng.js';
import { HOODS as H, HOOD_FEATURES, HOOD_NAME_VARIANTS, HOOD_SERVICES, DISTRICTS as D } from '../data/places.js';

const PLAZA_C = { tx: Math.round((AREAS.plaza.x1 + AREAS.plaza.x2) / 2), ty: Math.round((AREAS.plaza.y1 + AREAS.plaza.y2) / 2) };
const TYPE_OF_KIND = { home: 'residential', shop: 'commercial', industry: 'industrial', farm: 'agricultural', public: 'civic', school: 'education', leisure: 'entertainment', trade: 'transport' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const walk = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);

export class PlaceSystem {
  constructor(sim) {
    this.sim = sim;
    const s = sim.state;
    s.districts ??= { cells: {}, list: [], changes: [] };
    s.districts.next ??= 1;
    const fresh = !s.places;
    s.places ??= { hoods: [], next: 1, names: {} };
    this.statCache = new Map();
    this.dstatCache = new Map();
    // The village as it stands (a new game, or a save from before there were neighbourhoods): its places were always there.
    if (!this.DS.list.length) this.updateDistricts();
    if (fresh) this.weekly({ quiet: true });
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('building:changed', () => this.statCache.clear());
    sim.bus.on('property:changed', () => this.statCache.clear());
  }

  get S() {
    return this.sim.state.places;
  }
  get DS() {
    return this.sim.state.districts;
  }
  get world() {
    return this.sim.world;
  }

  onDay() {
    const sim = this.sim;
    this.statCache.clear();
    this.dstatCache.clear();
    if (sim.time.weekday === 5) this.weekly();
    if (sim.time.day % D.every === D.at || !this.DS.list.length) this.updateDistricts();
  }

  // ------------------------------------------------------------------ neighbourhoods

  hoods() {
    return this.S.hoods;
  }
  hood(id) {
    return this.S.hoods.find((h) => h.id === id) || null;
  }
  /** The neighbourhood a tile is in (the smallest one, if they overlap at the edges). */
  hoodAt(tx, ty) {
    let best = null;
    for (const h of this.S.hoods) {
      if (tx < h.x1 || tx > h.x2 || ty < h.y1 || ty > h.y2) continue;
      if (!best || (h.x2 - h.x1) * (h.y2 - h.y1) < (best.x2 - best.x1) * (best.y2 - best.y1)) best = h;
    }
    return best;
  }
  /** The neighbourhood a building belongs to (one of its homes, or among them). */
  hoodOf(buildingId) {
    const h = this.S.hoods.find((o) => o.homes.includes(buildingId) || o.others.includes(buildingId));
    if (h) return h;
    const b = this.world.buildings[buildingId];
    return b ? this.hoodAt(b.door.tx, b.door.ty) : null;
  }

  /** Clusters of homes close together (by the walk between their doors): the neighbourhoods as they stand now. */
  clusters() {
    const sim = this.sim;
    const P = sim.property;
    const homes = this.world.buildingList.filter((b) => sim.growth.kindOf(b) === 'home' && P.rec(b.id) && !P.rec(b.id).ruined);
    // Closest pairs first; two clusters join only while the whole stays a walkable size (no chaining across the valley).
    const parent = homes.map((_, i) => i);
    const box = homes.map((b) => ({ x1: b.door.tx, y1: b.door.ty, x2: b.door.tx, y2: b.door.ty }));
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const pairs = [];
    for (let i = 0; i < homes.length; i++) {
      for (let j = i + 1; j < homes.length; j++) {
        const d = walk(homes[i].door, homes[j].door);
        if (d <= H.link) pairs.push([d, i, j]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const [, i, j] of pairs) {
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      const A = box[ri];
      const B = box[rj];
      const u = { x1: Math.min(A.x1, B.x1), y1: Math.min(A.y1, B.y1), x2: Math.max(A.x2, B.x2), y2: Math.max(A.y2, B.y2) };
      if (u.x2 - u.x1 > H.maxSpan || u.y2 - u.y1 > H.maxSpan) continue;
      parent[ri] = rj;
      box[rj] = u;
    }
    const groups = new Map();
    homes.forEach((b, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(b);
    });
    const out = [];
    for (const list of groups.values()) {
      if (list.length < H.minHomes - 1) continue;
      const pop = list.reduce((s, b) => s + P.occupants(b.id), 0);
      const onRoad = list.filter((b) => sim.growth.roadDistance(b.door.tx, b.door.ty, H.roadReach) <= H.roadReach).length;
      if (onRoad < list.length * H.roadShare) continue;
      // Enough to be a neighbourhood — or, a little short of it, enough for one to hold on (people come and go).
      const ok = list.length >= H.minHomes && pop >= H.minPop;
      if (!ok && pop < H.minPop - 2) continue;
      const m = H.margin;
      const x1 = Math.min(...list.map((b) => b.tx)) - m;
      const y1 = Math.min(...list.map((b) => b.ty)) - m;
      const x2 = Math.max(...list.map((b) => b.tx + b.w - 1)) + m;
      const y2 = Math.max(...list.map((b) => b.ty + b.h)) + m;
      const ids = new Set(list.map((b) => b.id));
      const others = this.world.buildingList.filter((b) => !ids.has(b.id) && b.door.tx >= x1 && b.door.tx <= x2 && b.door.ty >= y1 && b.door.ty <= y2 && sim.growth.kindOf(b) && sim.growth.kindOf(b) !== 'home');
      out.push({
        ok,
        homes: list.map((b) => b.id).sort(),
        others: others.map((b) => b.id).sort(),
        x1,
        y1,
        x2,
        y2,
        tx: Math.round(list.reduce((s, b) => s + b.door.tx, 0) / list.length),
        ty: Math.round(list.reduce((s, b) => s + b.door.ty, 0) / list.length),
      });
    }
    return out.sort((a, b) => b.homes.length - a.homes.length);
  }

  /**
   * Once a week: which homes hold together as neighbourhoods now. A neighbourhood keeps its
   * name and story as it grows; a new one is named and is news; one that's come apart fades.
   */
  weekly({ quiet = false } = {}) {
    const sim = this.sim;
    const S = this.S;
    this.statCache.clear();
    const now = this.clusters();
    const old = S.hoods.slice();
    const used = new Set();
    const next = [];
    for (const c of now) {
      // The neighbourhood it was: the one it shares most of its homes with.
      let best = null;
      let bestN = 0;
      for (const h of old) {
        if (used.has(h.id)) continue;
        const n = h.homes.filter((id) => c.homes.includes(id)).length;
        if (n > bestN) {
          best = h;
          bestN = n;
        }
      }
      const ok = c.ok;
      delete c.ok;
      if (best && bestN * 2 >= Math.min(best.homes.length, c.homes.length)) {
        used.add(best.id);
        const grewFrom = best.homes.length;
        Object.assign(best, c, { miss: ok ? 0 : (best.miss || 0) + 1 });
        if (best.miss >= H.fadeWeeks * 2 && !quiet) {
          this.fade(best);
          continue;
        }
        this.review(best, grewFrom, quiet);
        next.push(best);
        continue;
      }
      if (!ok) continue;
      // A new neighbourhood: named from what's around it.
      const h = { id: `h${S.next++}`, ...c, founded: quiet ? 0 : sim.time.day, peak: c.homes.length, miss: 0, hist: [] };
      h.name = this.pickName(h, [...old, ...next]);
      S.names[h.id] = h.name;
      h.kind = this.kindOf(h);
      h.stats = this.computeStats(h);
      h.services = h.stats.services;
      this.event(h, 'founded', { old: quiet || undefined });
      if (!quiet) sim.chronicle('chronicle.hood_formed', { hood: h.id, n: h.homes.length });
      next.push(h);
    }
    // Neighbourhoods that no longer hold together: joined to another, or fading away.
    for (const h of old) {
      if (used.has(h.id)) continue;
      const into = next.find((o) => h.homes.filter((id) => o.homes.includes(id)).length * 2 >= h.homes.length);
      if (into) {
        this.event(into, 'joined', { hood: h.id });
        continue;
      }
      h.miss = (h.miss || 0) + 1;
      if (h.miss < H.fadeWeeks) next.push(h);
      else if (!quiet) this.fade(h);
    }
    S.hoods = next;
    // The village's average standing, over all its homes (those in no neighbourhood count as ordinary):
    // a neighbourhood's standing is against that — better or worse than the rest of the village.
    const homes = this.world.buildingList.filter((b) => sim.property.isHome(b.id) && b.id !== 'hall').length;
    S.avgRep = homes ? Math.round((next.reduce((sum, h) => sum + (h.stats?.rep || 0) * h.homes.length, 0) / homes) * 1000) / 1000 : 0;
    sim.bus.emit('places:changed');
  }

  /** What has changed in a neighbourhood this week: it grew, got a shop, went quiet… */
  review(h, grewFrom, quiet) {
    const sim = this.sim;
    const kind = this.kindOf(h);
    if (h.kind && kind !== h.kind) this.event(h, 'kind', { from: h.kind, to: kind });
    h.kind = kind;
    const st = this.computeStats(h);
    for (const s of st.services) if (!(h.services || []).includes(s)) this.event(h, 'service', { s });
    h.services = st.services;
    h.stats = st;
    const n = h.homes.length;
    for (const m of H.milestones) {
      if (n >= m && grewFrom < m && (h.peak || 0) < m) {
        this.event(h, 'grew', { n: m });
        if (!quiet && m >= 8) sim.chronicle('chronicle.hood_grew', { hood: h.id, n: m });
      }
    }
    h.peak = Math.max(h.peak || 0, n);
    // Emptying out: it has lost a good part of its people.
    h.peakPop = Math.max(h.peakPop || 0, st.pop);
    if (!h.declining && h.peakPop >= 8 && st.pop <= h.peakPop * 0.6) {
      h.declining = true;
      this.event(h, 'decline', { n: st.pop });
    } else if (h.declining && st.pop >= h.peakPop * 0.8) h.declining = false;
  }

  fade(h) {
    this.sim.chronicle('chronicle.hood_faded', { hood: h.id });
  }

  /** Residential · mixed (shops and trades among the homes) · a workers' quarter (by the workshops). */
  kindOf(h) {
    const sim = this.sim;
    const kinds = h.others.filter((id) => this.world.buildings[id]).map((id) => sim.growth.kindOf(this.world.buildings[id])).filter(Boolean);
    const industry = kinds.filter((k) => k === 'industry' || k === 'trade').length;
    if (industry >= H.workersIndustry) return 'workers';
    if (kinds.length && kinds.length / (kinds.length + h.homes.length) >= H.mixedShare) return 'mixed';
    return 'residential';
  }

  event(h, k, params = {}) {
    h.hist ??= [];
    h.hist.push({ day: this.sim.time.day, k, ...params });
    if (h.hist.length > H.keepEvents) h.hist.shift();
  }

  // ------------------------------------------------------------------ names

  /** What stands out around a spot: the river, the mill, the plaza, a forge, a well, fields, woods, a hill. */
  featuresAt(tx, ty) {
    const sim = this.sim;
    const w = this.world;
    const f = new Set();
    let water = 0;
    let farm = 0;
    let hill = 0;
    for (let y = ty - 8; y <= ty + 8; y++) {
      for (let x = tx - 8; x <= tx + 8; x++) {
        const t = w.tileAt(x, y);
        if (!w.inBounds(x, y)) continue;
        if ((t === T.WATER || t === T.DEEP) && Math.abs(x - tx) + Math.abs(y - ty) <= 9) water++;
        if (t === T.FARMLAND || sim.state.fields[`${x},${y}`]) farm++;
        if (t === T.MOUNTAIN || t === T.CLIFF) hill++;
      }
    }
    if (water >= 3) f.add('river');
    if (farm >= 8) f.add('fields');
    if (hill >= 6) f.add('hill');
    if (walk({ tx, ty }, PLAZA_C) <= 12) f.add('plaza');
    for (const b of w.buildingList) {
      const d = walk(b.door, { tx, ty });
      if (b.type === 'mill' && d <= 12) f.add('mill');
      if (b.type === 'well' && d <= 8) f.add('well');
      if (d <= 10 && sim.growth.kindOf(b) === 'industry') f.add('forge');
    }
    for (const d of w.decor) if (d.type === 'well' && walk(d, { tx, ty }) <= 8) f.add('well');
    let trees = 0;
    for (const o of Object.values(sim.state.objects)) if (o.kind === 'tree' && o.state === 'grown' && Math.abs(o.tx - tx) <= 8 && Math.abs(o.ty - ty) <= 8) trees++;
    if (trees >= 10) f.add('woods');
    return HOOD_FEATURES.filter((k) => f.has(k));
  }

  /** North / south / east / west of the plaza. */
  side(tx, ty) {
    const dx = tx - PLAZA_C.tx;
    const dy = ty - PLAZA_C.ty;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
  }

  /** A name nobody else in the village has: from what stands out around it, else from the side of the village it's on. */
  pickName(h, others) {
    const taken = new Set([...others.map((o) => o.name && `${o.name.f}.${o.name.v}.${o.name.n || 0}`), ...Object.values(this.S.names).map((n) => `${n.f}.${n.v}.${n.n || 0}`)]);
    const start = Math.floor(hashStr(`${h.homes[0]}`, this.sim.state.seed | 0) * HOOD_NAME_VARIANTS);
    const feats = [...this.featuresAt(h.tx, h.ty), this.side(h.tx, h.ty)];
    for (let n = 0; n < 9; n++) {
      for (const f of feats) {
        for (let i = 0; i < HOOD_NAME_VARIANTS; i++) {
          const v = (start + i) % HOOD_NAME_VARIANTS;
          if (!taken.has(`${f}.${v}.${n}`)) return n ? { f, v, n } : { f, v };
        }
      }
    }
    return { f: feats[0], v: start, n: h.id };
  }

  // ------------------------------------------------------------------ what a neighbourhood is like

  /** Its people, homes, what they're worth and let for, how they're kept, what's near, its businesses, its standing. */
  stats(h) {
    const hit = this.statCache.get(h.id);
    if (hit) return hit;
    const st = this.computeStats(h);
    this.statCache.set(h.id, st);
    return st;
  }

  computeStats(h) {
    const sim = this.sim;
    const P = sim.property;
    const E = sim.economy;
    const homes = h.homes.filter((id) => this.world.buildings[id]);
    const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);
    const pop = homes.reduce((s, id) => s + P.occupants(id), 0);
    const value = Math.round(avg(homes, (id) => P.value(id)));
    const rent = Math.round(avg(homes, (id) => P.marketRent(id)) * 10) / 10;
    const quality = Math.round(avg(homes, (id) => (sim.structures?.rec(id) ? sim.structures.quality(id) : 50)));
    const condition = Math.round(avg(homes, (id) => P.rec(id)?.condition ?? 100));
    const businesses = [...homes, ...h.others].filter((id) => E.businessAtBuilding(id));
    const let_ = homes.filter((id) => P.housingState(id) === 'rented').length;
    // What's near its middle: a well, a shop, a tavern, a school, a clinic, the watch.
    const services = [];
    const mid = { tx: h.tx, ty: h.ty };
    for (const [k, def] of Object.entries(HOOD_SERVICES)) {
      const hit = this.world.buildingList.some((b) => {
        const inside = b.door.tx >= h.x1 && b.door.tx <= h.x2 && b.door.ty >= h.y1 && b.door.ty <= h.y2;
        if (!inside && walk(b.door, mid) > H.serviceRadius) return false;
        if (def.types?.includes(b.type)) return true;
        return def.kinds?.includes(sim.growth.kindOf(b)) && (def.kinds[0] !== 'shop' || !!E.businessAtBuilding(b.id) || ['market_hall'].includes(b.type));
      });
      const decor = k === 'well' && this.world.decor.some((d) => d.type === 'well' && walk(d, mid) <= H.serviceRadius);
      if (hit || decor) services.push(k);
    }
    // The land under it (TerritorySystem): its worth against bare land, and how built-up it is.
    const T2 = sim.territory;
    const lots = [...new Set(homes.map((id) => T2?.lotOf(id)).filter(Boolean))];
    const land = Math.round(avg(lots, (id) => T2.rec(id)?.lv ?? 1) * 100) / 100 || 1;
    const devs = {};
    for (const id of lots) {
      const d = T2.rec(id)?.dev;
      if (d) devs[d] = (devs[d] || 0) + 1;
    }
    const dev = Object.entries(devs).sort((a, b) => b[1] - a[1])[0]?.[0] || 'developing';
    const ruins = this.world.buildingList.filter((b) => b.door.tx >= h.x1 && b.door.tx <= h.x2 && b.door.ty >= h.y1 && b.door.ty <= h.y2 && (P.rec(b.id)?.ruined || P.rec(b.id)?.abandoned)).length;
    const workshops = h.others.filter((id) => this.world.buildings[id] && sim.growth.kindOf(this.world.buildings[id]) === 'industry').length;
    const road = homes.filter((id) => sim.growth.roadDistance(this.world.buildings[id].door.tx, this.world.buildings[id].door.ty, 3) <= 3).length / Math.max(1, homes.length);
    const rep = clamp(((quality - 50) / 100) * H.repQuality + ((condition - 70) / 100) * H.repCondition + services.length * H.repPerService - ruins * H.repPerRuin - workshops * H.repPerWorkshop, -H.repMax, H.repMax);
    return { pop, homes: homes.length, value, rent, quality, condition, businesses, let: let_, services, land, dev, ruins, road, rep: Math.round(rep * 1000) / 1000 };
  }

  /**
   * A neighbourhood's standing against the rest of the village (−0.3…+0.3): what its houses fetch, and how
   * villagers rate living there. (A house in no neighbourhood is ordinary: a little below a sought-after one.)
   */
  standing(buildingId) {
    const h = this.hoodOf(buildingId);
    return (h ? (h.stats?.rep ?? 0) : 0) - (this.S.avgRep || 0);
  }

  // ------------------------------------------------------------------ districts

  /** Classify the village into districts from what's actually built where (the grid of cells), and keep their identity and story. */
  updateDistricts() {
    const sim = this.sim;
    const cells = {};
    const add = (tx, ty, kind) => {
      const k = `${Math.floor(tx / D.cell)},${Math.floor(ty / D.cell)}`;
      cells[k] ??= { home: 0, shop: 0, industry: 0, farm: 0, public: 0, school: 0, leisure: 0, trade: 0 };
      cells[k][kind === 'research' ? 'school' : kind]++;
    };
    for (const b of this.world.buildingList) {
      const kind = sim.growth.kindOf(b);
      if (kind) add(b.door.tx, b.door.ty, kind);
    }
    const types = {};
    for (const [k, c] of Object.entries(cells)) {
      const total = Object.values(c).reduce((a, n) => a + n, 0);
      const [top, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      types[k] = total >= 2 && n / total < 0.55 ? 'mixed' : TYPE_OF_KIND[top];
    }
    const DS = this.DS;
    // Changes over time become part of the village's story.
    for (const [k, type] of Object.entries(types)) {
      const before = DS.cells[k];
      if (before && before !== type && sim.time.day - (DS.lastChangeDay || -99) > 20) {
        DS.lastChangeDay = sim.time.day;
        DS.changes.push({ day: sim.time.day, cell: k, from: before, to: type });
        if (DS.changes.length > 40) DS.changes.shift();
        sim.chronicle('chronicle.district_changed', { district: k, from: before, to: type });
      }
    }
    DS.cells = types;
    // Group neighbouring cells of the same kind into districts.
    const seen = new Set();
    const groups = [];
    for (const k of Object.keys(types)) {
      if (seen.has(k)) continue;
      const type = types[k];
      const group = [];
      const stack = [k];
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur) || types[cur] !== type) continue;
        seen.add(cur);
        group.push(cur);
        const [cx, cy] = cur.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) stack.push(`${cx + dx},${cy + dy}`);
      }
      groups.push({ type, cells: group.sort() });
    }
    // Each district is the one it was (most cells in common) — or a new one.
    const old = DS.list.slice();
    const used = new Set();
    const quiet = !old.length;
    DS.list = [];
    for (const g of groups.sort((a, b) => b.cells.length - a.cells.length)) {
      const cx = g.cells.reduce((s, c) => s + Number(c.split(',')[0]), 0) / g.cells.length;
      const cy = g.cells.reduce((s, c) => s + Number(c.split(',')[1]), 0) / g.cells.length;
      const tx = (cx + 0.5) * D.cell;
      const ty = (cy + 0.5) * D.cell;
      let prev = null;
      let bestN = 0;
      for (const o of old) {
        if (used.has(o.id)) continue;
        const n = o.cells.filter((c) => g.cells.includes(c)).length;
        if (n > bestN || (n === bestN && n && o.type === g.type && prev?.type !== g.type)) {
          prev = o;
          bestN = n;
        }
      }
      if (prev && bestN) used.add(prev.id);
      const id = prev && bestN ? prev.id : `d${DS.next++}`;
      const d = { id, type: g.type, cells: g.cells, tx, ty, founded: prev && bestN ? (prev.founded ?? 0) : quiet ? 0 : sim.time.day, hist: prev && bestN ? prev.hist || [] : [], char: prev && bestN ? (prev.char ?? null) : null };
      // Its name: where it is (kept) and what it is (follows its use).
      const nm = prev && bestN && prev.name ? prev.name : this.districtName(g.type, tx, ty, id);
      d.name = { ...nm, type: g.type };
      if (prev && bestN && prev.type !== g.type) this.devent(d, 'type', { from: prev.type, to: g.type });
      if (!(prev && bestN)) this.devent(d, 'formed', { type: g.type, old: quiet || undefined });
      // Its character: the old residential district, a new development, a university quarter.
      const ch = this.characterOf(d);
      if (ch !== d.char) {
        if (ch) this.devent(d, 'char', { ch });
        if (ch && !quiet && d.cells.length >= 2 && sim.time.day - (DS.lastCharDay || -99) > 20) {
          DS.lastCharDay = sim.time.day;
          sim.chronicle('chronicle.district_character', { district: d.cells[0], dchar: ch });
        }
        d.char = ch;
      }
      DS.list.push(d);
    }
    this.dstatCache.clear();
    sim.bus.emit('places:changed');
  }

  devent(d, k, params = {}) {
    d.hist ??= [];
    d.hist.push({ day: this.sim.time.day, k, ...params });
    if (d.hist.length > D.keepEvents) d.hist.shift();
  }

  /** The buildings of a district (by their doors). */
  districtBuildings(d) {
    const set = new Set(d.cells);
    return this.world.buildingList.filter((b) => set.has(`${Math.floor(b.door.tx / D.cell)},${Math.floor(b.door.ty / D.cell)}`));
  }

  /** Old (the first houses of the valley, or long-standing ones) · new (most of it just built, or going up) · university. */
  characterOf(d) {
    const sim = this.sim;
    const list = this.districtBuildings(d).filter((b) => sim.growth.kindOf(b));
    if (!list.length) return null;
    const day = sim.time.day;
    const age = (b) => {
      const c = sim.construction.byId(b.id);
      const built = sim.structures?.rec(b.id)?.built ?? c?.builtDay ?? 0;
      return c ? day - (c.builtDay ?? built) : day - built + D.foundingAge;
    };
    const set = new Set(d.cells);
    const sites = sim.construction.sites().filter((c) => c.kind === 'building' && set.has(`${Math.floor((c.tx + c.w / 2) / D.cell)},${Math.floor((c.ty + c.h) / D.cell)}`)).length;
    const fresh = list.filter((b) => age(b) <= D.newDays).length;
    if ((fresh + sites) / (list.length + sites) >= D.newShare && fresh + sites >= D.newSites) return 'new';
    if (d.type === 'education' && list.some((b) => b.type === 'institute')) return 'university';
    if (d.type === 'residential' && list.reduce((s, b) => s + age(b), 0) / list.length >= D.oldDays) return 'old';
    return null;
  }

  /** Names come from where the district is: by the river, the plaza, north, south… */
  districtName(type, tx, ty, id) {
    const dx = tx - PLAZA_C.tx;
    const dy = ty - PLAZA_C.ty;
    const near = Math.hypot(dx, dy) < 9 ? 'center' : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
    const river = Math.abs(tx - AREAS.river.baseX) < 10 ? 'river' : null;
    const variant = Math.floor(hashStr(id, this.sim.state.seed) * 3);
    return { type, where: river || near, variant };
  }

  districtAt(tx, ty) {
    const k = `${Math.floor(tx / D.cell)},${Math.floor(ty / D.cell)}`;
    return this.DS.list.find((d) => d.cells.includes(k)) || null;
  }
  district(id) {
    return this.DS.list.find((d) => d.id === id) || null;
  }

  /** A district in numbers: people, buildings, homes, businesses, what homes are worth and let for, the land, the roads and wells. */
  districtStats(d) {
    const hit = this.dstatCache.get(d.id);
    if (hit) return hit;
    const sim = this.sim;
    const P = sim.property;
    const T2 = sim.territory;
    const list = this.districtBuildings(d);
    const homes = list.filter((b) => P.isHome(b.id) && b.id !== 'hall');
    const avg = (xs, f) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);
    const lots = [...new Set(list.map((b) => T2?.lotOf(b.id)).filter(Boolean))];
    const devs = {};
    for (const id of lots) {
      const v = T2.rec(id)?.dev;
      if (v) devs[v] = (devs[v] || 0) + 1;
    }
    const st = {
      buildings: list.length,
      homes: homes.length,
      pop: homes.reduce((s, b) => s + P.occupants(b.id), 0),
      businesses: list.filter((b) => sim.economy.businessAtBuilding(b.id)).length,
      value: Math.round(avg(homes, (b) => P.value(b.id))),
      rent: Math.round(avg(homes, (b) => P.marketRent(b.id)) * 10) / 10,
      land: Math.round(avg(lots, (id) => T2.rec(id)?.lv ?? 1) * 100) / 100 || 1,
      dev: Object.entries(devs).sort((a, b) => b[1] - a[1])[0]?.[0] || 'undeveloped',
      road: list.length ? list.filter((b) => sim.growth.roadDistance(b.door.tx, b.door.ty, 3) <= 3).length / list.length : 0,
      well: list.length ? list.filter((b) => T2?.wellNear(b.door.tx, b.door.ty)).length / list.length : 0,
      hoods: this.S.hoods.filter((h) => d.cells.includes(`${Math.floor(h.tx / D.cell)},${Math.floor(h.ty / D.cell)}`)).map((h) => h.id),
    };
    this.dstatCache.set(d.id, st);
    return st;
  }

  /**
   * The street a building is on, as its worth goes: homes in quiet residential districts, shops in
   * busy ones — and the standing of its neighbourhood.
   */
  valueFactor(buildingId) {
    const b = this.world.buildings[buildingId];
    if (!b) return 1;
    const d = this.districtAt(b.door.tx, b.door.ty);
    const isShop = !!this.sim.economy.businessAtBuilding(buildingId);
    const table = isShop
      ? { commercial: 1.2, mixed: 1.1, civic: 1.1, entertainment: 1.15, transport: 1.05, education: 1.0, residential: 0.95, industrial: 0.9, agricultural: 0.85 }
      : { residential: 1.08, mixed: 1.04, civic: 1.05, education: 1.08, entertainment: 0.98, commercial: 1.0, transport: 0.92, industrial: 0.85, agricultural: 0.95 };
    const f = d ? (table[d.type] ?? 1) : 1;
    return f * (1 + this.standing(buildingId) * H.valueShare);
  }
}
