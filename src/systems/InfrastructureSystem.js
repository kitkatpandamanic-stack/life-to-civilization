/**
 * InfrastructureSystem — what connects the village: roads and how they link up, paved streets,
 * bridges, wells and the river, street lamps, carting.
 *
 * Nothing here is a bonus on a menu. A road is tiles in the world you walk on (faster); a paved
 * street is cobbles (faster still); a bridge is planks over the water you can now cross; a lamp
 * stands by the street and lights it at night. What reaches a spot — a road, and whether that road
 * links up to the plaza; paving; water; light; a carter to move goods — is its coverage, and
 * coverage is what the land's value (TerritorySystem), how built-up it counts as, what a house
 * fetches (RealtySystem), how villagers rate a street (HousingSystem) and where new buildings go
 * (GrowthSystem) all read:
 *
 *   road built → easier to get there → the land is worth more → buildings go up → people come
 *
 * The village puts its money into it too (public works, once a week): a lane to a house cut off
 * from the roads, cobbles on the busiest street (walked most — villagers' steps are counted), a
 * lamp for a neighbourhood left in the dark. You can lay roads, pave them, bridge the stream and
 * put up lamps yourself.
 *
 *   state.infra = { paved: ['x,y'], bridges: ['x,y'], lamps: [{ tx, ty, by }], traffic: { 'x,y': n },
 *                   log: [{ day, k, tx, ty, n, by }], fund }   (fund: a share of the taxes, put by for public works)
 */
import { T } from '../world/WorldGenerator.js';
import { AREAS } from '../data/villageLayout.js';
import { INFRA as I } from '../data/infra.js';
import { VILLAGE_STATUS } from '../data/civic.js';

const ROADLIKE = new Set([T.ROAD, T.PLAZA, T.BRIDGE]);
const key = (x, y) => `${x},${y}`;

export class InfrastructureSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.infra ??= { paved: [], bridges: [], lamps: [], traffic: {}, log: [], fund: 0 };
    sim.state.infra.fund ??= 0;
    this.restore();
    this.ver = 0;
    this.fieldVer = -1;
    this.covCache = new Map();
    sim.bus.on('road:built', () => this.touched());
    sim.bus.on('time:hour', () => this.countTraffic());
    sim.bus.on('time:day', () => {
      this.covCache.clear();
      if (sim.time.weekday === I.works.weekday) this.publicWorks();
    });
    sim.bus.on('building:added', () => this.covCache.clear());
  }

  get S() {
    return this.sim.state.infra;
  }
  get world() {
    return this.sim.world;
  }

  /** Put what's been built back into a freshly generated world (after loading). */
  restore() {
    const w = this.world;
    for (const k of this.S.bridges) {
      const [x, y] = k.split(',').map(Number);
      w.tiles[w.idx(x, y)] = T.BRIDGE; w.rev = (w.rev || 0) + 1;
      w.staticBlocked[w.idx(x, y)] = 0;
    }
    for (const k of this.S.paved) {
      const [x, y] = k.split(',').map(Number);
      w.tiles[w.idx(x, y)] = T.PLAZA; w.rev = (w.rev || 0) + 1;
    }
    for (const l of this.S.lamps) this.addLampDecor(l);
  }

  addLampDecor(l) {
    const d = { type: 'lamp', tx: l.tx, ty: l.ty, w: 1, block: true, light: true, built: true };
    this.world.decor.push(d);
    this.world.blockRect(l.tx, l.ty, 1, 1, 1);
    return d;
  }

  /** The road network changed: links and coverage are worked out afresh. */
  touched() {
    this.ver++;
    this.covCache.clear();
    this.sim.territory && (this.sim.territory.rev = (this.sim.territory.rev || 0) + 1);
  }

  // ------------------------------------------------------------------ the network

  /** Steps along the roads from the plaza to every road tile (−1: a road that doesn't link up). */
  field() {
    if (this.fieldVer === this.ver && this.steps) return this.steps;
    const w = this.world;
    const steps = new Int32Array(w.W * w.H).fill(-1);
    const q = [];
    const P = AREAS.plaza;
    for (let y = P.y1; y <= P.y2; y++) {
      for (let x = P.x1; x <= P.x2; x++) {
        if (!ROADLIKE.has(w.tileAt(x, y))) continue;
        steps[w.idx(x, y)] = 0;
        q.push(x, y);
      }
    }
    for (let h = 0; h < q.length; h += 2) {
      const x = q[h];
      const y = q[h + 1];
      const s = steps[w.idx(x, y)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!w.inBounds(nx, ny) || steps[w.idx(nx, ny)] !== -1 || !ROADLIKE.has(w.tileAt(nx, ny))) continue;
        steps[w.idx(nx, ny)] = s + 1;
        q.push(nx, ny);
      }
    }
    this.steps = steps;
    this.fieldVer = this.ver;
    return steps;
  }

  /**
   * What reaches a spot: { road (tiles to the nearest road), linked (that road links up to the plaza),
   * steps (along the roads to the plaza), paved, water, light, transport, score (0–1) }.
   */
  coverage(tx, ty) {
    const k = key(tx, ty);
    const hit = this.covCache.get(k);
    if (hit) return hit;
    const w = this.world;
    const steps = this.field();
    let road = Infinity;
    let best = -1;
    let paved = false;
    const R = I.accessReach;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > R) continue;
        const x = tx + dx;
        const y = ty + dy;
        const t = w.tileAt(x, y);
        if (!ROADLIKE.has(t)) continue;
        road = Math.min(road, d);
        const s = steps[w.idx(x, y)];
        if (s >= 0 && (best < 0 || s + d < best)) best = s + d;
        if (t === T.PLAZA && d <= I.pavedNear) paved = true;
      }
    }
    const water = this.wellNear(tx, ty) || this.riverNear(tx, ty);
    const light = this.lampNear(tx, ty);
    const transport = best >= 0 && this.carting();
    const score = (road <= I.roadNear ? 0.3 : road <= R ? 0.15 : 0) + (best >= 0 ? 0.15 : 0) + (paved ? 0.15 : 0) + (water ? 0.2 : 0) + (light ? 0.1 : 0) + (transport ? 0.1 : 0);
    const c = { road, linked: best >= 0, steps: best, paved, water, light, transport, score: Math.round(score * 100) / 100 };
    this.covCache.set(k, c);
    return c;
  }

  wellNear(tx, ty, r = I.wellNear) {
    for (const d of this.world.decor) if (d.type === 'well' && Math.abs(d.tx - tx) + Math.abs(d.ty - ty) <= r) return true;
    for (const o of this.world.buildingList) if (o.type === 'well' && Math.abs(o.door.tx - tx) + Math.abs(o.door.ty - ty) <= r) return true;
    return false;
  }
  riverNear(tx, ty, r = I.riverNear) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r && this.world.isWater(tx + dx, ty + dy)) return true;
    return false;
  }
  lampNear(tx, ty, r = I.lampNear) {
    for (const d of this.world.decor) if (d.light && Math.abs(d.tx - tx) + Math.abs(d.ty - ty) <= r) return true;
    return false;
  }
  /** A carter (or a coaching inn) in the village: goods move along the roads. */
  carting() {
    const E = this.sim.economy;
    return (E.ofType?.('carters') || []).some((id) => E.isOpen?.(id) ?? true) || this.sim.world.buildingList.some((b) => this.sim.structures?.rec(b.id)?.spec === 'coaching');
  }

  // ------------------------------------------------------------------ traffic

  /** Every hour: where villagers are walking on the roads (the busy streets get paved). */
  countTraffic() {
    const T2 = this.S.traffic;
    for (const n of this.sim.state.npcs) {
      if (n.inside || n.x === undefined) continue;
      const t = this.world.toTile(n.x, n.y);
      if (this.world.tileAt(t.tx, t.ty) !== T.ROAD) continue;
      const k = key(t.tx, t.ty);
      T2[k] = (T2[k] || 0) + 1;
    }
  }

  // ------------------------------------------------------------------ building it

  /** Lay a tile and tell everyone (the terrain is redrawn, links are worked out afresh). */
  setTile(x, y, tile) {
    const w = this.world;
    w.tiles[w.idx(x, y)] = tile; w.rev = (w.rev || 0) + 1;
    if (tile === T.BRIDGE) w.staticBlocked[w.idx(x, y)] = 0;
    this.sim.bus.emit('road:built', { tx: x, ty: y, tile });
  }

  note(k, tx, ty, by, n = 1) {
    this.S.log.push({ day: this.sim.time.day, k, tx, ty, n, by });
    if (this.S.log.length > I.works.keepLog) this.S.log.shift();
  }

  /** You pay in materials (pockets, then your storage) and money. */
  playerHas(cost) {
    const sim = this.sim;
    if ((cost.money || 0) > sim.state.player.money) return { ok: false, reason: 'no_money', params: { money: cost.money } };
    for (const [item, qty] of Object.entries(cost)) {
      if (item === 'money') continue;
      if (sim.inventory.count(item) + sim.home.storageCount(item) < qty) return { ok: false, reason: 'missing_materials', params: { item, qty } };
    }
    return { ok: true };
  }
  playerPay(cost) {
    const sim = this.sim;
    for (const [item, qty] of Object.entries(cost)) {
      if (item === 'money') {
        sim.state.player.money -= qty;
        continue;
      }
      const got = sim.inventory.remove(item, qty);
      if (got < qty) sim.home.take(item, qty - got);
    }
  }

  /** Common rules for your tools: unlocked, close enough, your land (or the village's, or nobody's). */
  playerSpot(tx, ty) {
    const sim = this.sim;
    if (!sim.progression.hasUnlock('construction')) return { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('construction') } };
    const p = sim.world.toTile(sim.state.player.x, sim.state.player.y);
    if (Math.abs(p.tx - tx) + Math.abs(p.ty - ty) > I.playerReach) return { ok: false, reason: 'too_far' };
    const owner = sim.territory?.ownerAt(tx, ty);
    if (owner !== undefined && owner !== null && owner !== 'player' && owner !== 'village') return { ok: false, reason: 'not_your_land' };
    return { ok: true };
  }

  /** Cobbles on a road tile: quicker to walk, and the street is worth more. */
  canPave(tx, ty, by = 'player') {
    if (this.world.tileAt(tx, ty) !== T.ROAD) return { ok: false, reason: this.world.tileAt(tx, ty) === T.PLAZA ? 'already_paved' : 'pave_road_only' };
    if (by !== 'player') return { ok: true };
    const spot = this.playerSpot(tx, ty);
    if (!spot.ok) return spot;
    return this.playerHas(I.cost.pave);
  }
  pave(tx, ty, by = 'player') {
    const c = this.canPave(tx, ty, by);
    if (!c.ok) return c;
    if (by === 'player') {
      this.playerPay(I.cost.pave);
      this.sim.progression.addSkillXp('construction', 2);
    }
    this.S.paved.push(key(tx, ty));
    delete this.S.traffic[key(tx, ty)];
    this.setTile(tx, ty, T.PLAZA);
    if (by === 'player') this.note('pave', tx, ty, by);
    return { ok: true };
  }

  /** Planks over shallow water, from a road or bridge on the bank. */
  canBridge(tx, ty, by = 'player') {
    const w = this.world;
    if (w.tileAt(tx, ty) !== T.WATER) return { ok: false, reason: 'bridge_water_only' };
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ROADLIKE.has(w.tileAt(tx + dx, ty + dy)));
    if (!touches) return { ok: false, reason: 'road_must_connect' };
    if (by !== 'player') return { ok: true };
    const spot = this.playerSpot(tx, ty);
    if (!spot.ok) return spot;
    return this.playerHas(I.cost.bridge);
  }
  bridge(tx, ty, by = 'player') {
    const c = this.canBridge(tx, ty, by);
    if (!c.ok) return c;
    if (by === 'player') {
      this.playerPay(I.cost.bridge);
      this.sim.progression.addSkillXp('construction', 3);
    }
    this.S.bridges.push(key(tx, ty));
    this.setTile(tx, ty, T.BRIDGE);
    this.note('bridge', tx, ty, by);
    // Reaching the far bank for the first time is something the village remembers.
    const far = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !this.world.isWater(tx + dx, ty + dy) && !this.world.isRoad(tx + dx, ty + dy));
    if (far) this.sim.chronicle(by === 'player' ? 'chronicle.player_bridge' : 'chronicle.village_bridge', {});
    return { ok: true };
  }

  /** A street lamp beside a road (it lights the street at night). */
  canLamp(tx, ty, by = 'player') {
    const w = this.world;
    if (!w.inBounds(tx, ty) || w.isBlocked(tx, ty) || w.isRoad(tx, ty) || w.isWater(tx, ty) || this.sim.state.fields[key(tx, ty)]) return { ok: false, reason: 'obstructed' };
    for (const o of w.buildingList) if (o.door.tx === tx && o.door.ty === ty) return { ok: false, reason: 'obstructed' };
    const byRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.isRoad(tx + dx, ty + dy));
    if (!byRoad) return { ok: false, reason: 'lamp_by_road' };
    if (this.world.decor.some((d) => d.light && Math.abs(d.tx - tx) + Math.abs(d.ty - ty) < 4)) return { ok: false, reason: 'lamp_too_close' };
    if (by !== 'player') return { ok: true };
    const spot = this.playerSpot(tx, ty);
    if (!spot.ok) return spot;
    return this.playerHas(I.cost.lamp);
  }
  lamp(tx, ty, by = 'player') {
    const c = this.canLamp(tx, ty, by);
    if (!c.ok) return c;
    if (by === 'player') this.playerPay(I.cost.lamp);
    const l = { tx, ty, by };
    this.S.lamps.push(l);
    const d = this.addLampDecor(l);
    this.covCache.clear();
    this.sim.bus.emit('decor:added', d);
    this.note('lamp', tx, ty, by);
    return { ok: true };
  }

  // ------------------------------------------------------------------ the village's public works

  /** Taxes came in (FinanceSystem): a share goes into the public works fund. */
  levy(taxes) {
    const V = this.sim.state.village;
    const put = Math.min(Math.max(0, V.treasury), Math.round(taxes * I.works.levy));
    if (put <= 0) return 0;
    V.treasury -= put;
    this.S.fund += put;
    return put;
  }

  /** The village pays for public works: from the fund first, then the treasury. */
  spend(amount) {
    const f = Math.min(this.S.fund, amount);
    this.S.fund -= f;
    this.sim.state.village.treasury -= amount - f;
  }

  /** Once a week the village puts money into what's most needed (one project at a time). */
  publicWorks() {
    const sim = this.sim;
    const V = sim.state.village;
    const W = I.works;
    // The busy streets stay busy; the count halves each week.
    const T2 = this.S.traffic;
    const busy = Object.entries(T2).filter(([, n]) => n >= W.paveTraffic).sort((a, b) => b[1] - a[1]);
    for (const k of Object.keys(T2)) {
      T2[k] = Math.floor(T2[k] * W.trafficDecay);
      if (!T2[k]) delete T2[k];
    }
    const spare = this.S.fund + Math.max(0, V.treasury - W.reserve - (sim.tech?.civicWanted?.() ? 150 : 0));
    if (spare <= 0) return null;
    // 1. A lane to a house cut off from the roads.
    const lane = this.planLane(spare);
    if (lane) return lane;
    // 2. Cobbles on the busiest street, once the village is big enough (or knows masonry).
    const status = VILLAGE_STATUS.findIndex((s) => s.id === (sim.civic?.V.status || 'village'));
    const may = status >= VILLAGE_STATUS.findIndex((s) => s.id === W.paveFromStatus) || sim.tech?.has('masonry');
    if (may && busy.length) {
      const stretch = this.stretch(busy.map(([k]) => k), W.paveTiles);
      const cost = stretch.length * (I.cost.pave.money + I.cost.pave.stone * 3);
      if (stretch.length && spare >= cost) {
        this.spend(cost);
        for (const k of stretch) {
          const [x, y] = k.split(',').map(Number);
          this.pave(x, y, 'village');
        }
        const [x, y] = stretch[0].split(',').map(Number);
        this.note('pave', x, y, 'village', stretch.length);
        sim.chronicle('chronicle.village_paved', { n: stretch.length });
        return { k: 'pave', n: stretch.length };
      }
    }
    // 3. A lamp for a neighbourhood left in the dark.
    for (const h of sim.places?.hoods() || []) {
      if (h.homes.length < W.lampHomes || this.lampNear(h.tx, h.ty) || spare < I.cost.lamp.money * 2) continue;
      const spot = this.lampSpot(h.tx, h.ty);
      if (!spot) continue;
      this.spend(I.cost.lamp.money * 2);
      this.lamp(spot.tx, spot.ty, 'village');
      sim.chronicle('chronicle.village_lamp', { hood: h.id });
      return { k: 'lamp', hood: h.id };
    }
    return null;
  }

  /** A home far from any road: the village lays a lane to it (the shortest way to the road over open ground). */
  planLane(spare) {
    const sim = this.sim;
    const W = I.works;
    for (const b of this.world.buildingList) {
      if (!sim.property.isHome(b.id) || !sim.property.occupants(b.id) || b.id === 'hall') continue;
      if (sim.growth.roadDistance(b.door.tx, b.door.ty, W.laneFrom) <= W.laneFrom - 1 && this.coverage(b.door.tx, b.door.ty).linked) continue;
      const path = this.pathToRoad(b.door, W.laneMaxTiles);
      if (!path || !path.length) continue;
      const cost = path.length * I.cost.lane.money;
      if (cost > spare) continue;
      this.spend(cost);
      for (const t of path) {
        this.world.setRoad(t.tx, t.ty);
        sim.state.land.roads.push(key(t.tx, t.ty));
        sim.bus.emit('road:built', { tx: t.tx, ty: t.ty });
      }
      this.note('lane', b.door.tx, b.door.ty, 'village', path.length);
      sim.chronicle('chronicle.village_lane', { building: b.id, n: path.length });
      return { k: 'lane', building: b.id, n: path.length };
    }
    return null;
  }

  /**
   * Breadth-first over open ground (the village's, nobody's or the owner's) from a door to the nearest road
   * that links up to the plaza (along any road on the way): the tiles that need laying.
   */
  pathToRoad(door, max) {
    const w = this.world;
    const sim = this.sim;
    const steps = this.field();
    const prev = new Map([[key(door.tx, door.ty), null]]);
    const q = [door];
    let end = null;
    while (q.length && !end) {
      const cur = q.shift();
      if (Math.abs(cur.tx - door.tx) + Math.abs(cur.ty - door.ty) > max) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        const k = key(nx, ny);
        if (!w.inBounds(nx, ny) || prev.has(k)) continue;
        prev.set(k, cur);
        if (w.isRoad(nx, ny) && steps[w.idx(nx, ny)] >= 0) {
          end = cur;
          break;
        }
        if (w.isRoad(nx, ny)) {
          q.push({ tx: nx, ty: ny }); // a road that doesn't link up yet: along it
          continue;
        }
        if (w.isBlocked(nx, ny) || w.isWater(nx, ny) || sim.state.fields[k] || w.tileAt(nx, ny) === T.FARMLAND || w.tileAt(nx, ny) === T.MOUNTAIN) continue;
        const owner = sim.territory?.ownerAt(nx, ny);
        if (owner === 'player') continue; // not across your land
        q.push({ tx: nx, ty: ny });
      }
    }
    if (!end) return null;
    const out = [];
    for (let cur = end; cur; cur = prev.get(key(cur.tx, cur.ty))) if (!w.isRoad(cur.tx, cur.ty)) out.push(cur);
    return out;
  }

  /** A connected stretch of the busiest road tiles (up to n), starting from the busiest. */
  stretch(busy, n) {
    const set = new Set(busy);
    const out = [];
    const q = [busy[0]];
    const seen = new Set(q);
    while (q.length && out.length < n) {
      const k = q.shift();
      out.push(k);
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(x + dx, y + dy);
        if (seen.has(nk) || this.world.tileAt(x + dx, y + dy) !== T.ROAD) continue;
        // Along the busy stretch first; the road it's part of after.
        if (!set.has(nk) && out.length + q.length >= n) continue;
        seen.add(nk);
        if (set.has(nk)) q.unshift(nk);
        else q.push(nk);
      }
    }
    return out;
  }

  /** A free tile beside a road near a spot, for a lamp. */
  lampSpot(tx, ty) {
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (this.canLamp(x, y, 'village').ok && this.sim.territory?.ownerAt(x, y) !== 'player') return { tx: x, ty: y };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ for the land and the UI

  /** A plot's infrastructure, from the middle of it and its best-served edge. */
  plotCoverage(id) {
    const q = this.sim.territory?.parcel(id);
    if (!q) return null;
    return this.coverage(Math.round(q.cx), Math.round(q.cy));
  }

  /** The village's infrastructure in numbers: road tiles, paved, bridges, lamps, wells, homes linked to the plaza. */
  stats() {
    const w = this.world;
    let roads = 0;
    let paved = 0;
    for (let i = 0; i < w.tiles.length; i++) {
      if (w.tiles[i] === T.ROAD) roads++;
      else if (w.tiles[i] === T.PLAZA) paved++;
    }
    const homes = this.world.buildingList.filter((b) => this.sim.property.isHome(b.id));
    const linked = homes.filter((b) => this.coverage(b.door.tx, b.door.ty).linked).length;
    const wells = w.decor.filter((d) => d.type === 'well').length + w.buildingList.filter((b) => b.type === 'well').length;
    return { roads, paved, bridges: w.tiles.filter((t) => t === T.BRIDGE).length, lamps: w.decor.filter((d) => d.light).length, wells, homes: homes.length, linked, carting: this.carting() };
  }
}
