/**
 * GrowthSystem — the settlement grows (and shrinks) by itself.
 *
 * Nobody presses "upgrade village". Instead:
 *   • families who need a home and can't find one build their own house —
 *     in the evenings, with relatives and friends lending a hand;
 *   • well-off villagers see the demand and build houses to rent out;
 *   • the village spends its rent income on wells and roads for new streets;
 *   • entrepreneurs without premises put up a shopfront;
 *   • newcomers arrive when there's work and room; people leave when there isn't.
 *
 * Every project is a real construction site: materials are bought from the
 * lumberyard, the quarry and the carpenters (so building booms drive up timber
 * prices and logging), and it rises stage by stage as people work on it.
 * Where the buildings end up — homes here, shops there, workshops by the river —
 * shapes the village's districts, which in turn shape property values.
 */
import { VILLAGE_BUILDINGS, GROWTH as G } from '../data/villageBuildings.js';
import { AREAS } from '../data/villageLayout.js';
import { ITEMS } from '../data/items.js';
import { T } from '../world/WorldGenerator.js';
import { rand, hashStr } from '../core/rng.js';
import { TRAITS } from '../data/traits.js';
import { randomLook } from '../core/GameState.js';

const PLAZA_C = { tx: Math.round((AREAS.plaza.x1 + AREAS.plaza.x2) / 2), ty: Math.round((AREAS.plaza.y1 + AREAS.plaza.y2) / 2) };
const DISTRICT_CELL = 10;
export const ENTRY_POINT = { tx: 6, ty: 46 }; // newcomers walk in along the west road

export class GrowthSystem {
  constructor(sim) {
    this.sim = sim;
    const s = sim.state;
    s.districts ??= { cells: {}, list: [], changes: [] };
    s.settlement.joblessSince ??= {};
    sim.bus.on('time:day', () => this.onDay());
  }

  get cons() {
    return this.sim.construction;
  }

  /** Villager and village projects still being built. */
  projects() {
    return this.cons.sites().filter((c) => !this.cons.isPlayers(c));
  }

  projectOf(npc) {
    return this.projects().find((c) => c.owner === npc.id) || null;
  }

  // ------------------------------------------------------------------ lots

  /** Can a w×h building (plus margin and a free door tile) go here? */
  lotFree(tx, ty, w, h) {
    const world = this.sim.world;
    const m = G.lotMargin;
    for (let y = ty - m; y < ty + h + m; y++) {
      for (let x = tx - m; x < tx + w + m; x++) {
        if (!world.inBounds(x, y)) return false;
        const tile = world.tileAt(x, y);
        const inside = x >= tx && x < tx + w && y >= ty && y < ty + h;
        if (world.staticBlocked[world.idx(x, y)]) return false;
        if (inside && [T.WATER, T.DEEP, T.CLIFF, T.MOUNTAIN, T.FARMLAND, T.ROAD, T.PLAZA, T.BRIDGE].includes(tile)) return false;
        if (!inside && [T.WATER, T.DEEP, T.CLIFF].includes(tile)) return false;
        if (this.sim.land.plotAt(x, y)) return false; // plots are for sale to you
        if (this.sim.state.fields[`${x},${y}`]) return false;
      }
    }
    const f = AREAS.fields;
    if (tx + w >= f.x1 - 1 && tx <= f.x2 + 1 && ty + h >= f.y1 - 1 && ty <= f.y2 + 1) return false;
    // No rocks in the way (trees are felled when work starts).
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind === 'rock' && o.state !== 'depleted' && o.tx >= tx && o.tx < tx + w && o.ty >= ty && o.ty < ty + h) return false;
      if (o.kind === 'crop' && o.tx >= tx - 1 && o.tx <= tx + w && o.ty >= ty - 1 && o.ty <= ty + h) return false;
    }
    return true;
  }

  /** Distance from the door to the nearest road (Manhattan), or Infinity. */
  roadDistance(tx, ty, reach = G.roadReach) {
    const world = this.sim.world;
    let best = Infinity;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d >= best || d > reach) continue;
        if (world.isRoad(tx + dx, ty + dy)) best = d;
      }
    }
    return best;
  }

  /** The best free lot for a building of this type, near a point. */
  findLot(type, near = PLAZA_C) {
    const def = VILLAGE_BUILDINGS[type];
    const reach = G.maxLotDistance + Math.floor(this.sim.state.npcs.length / 6);
    let best = null;
    for (let r = 3; r <= reach; r += 1) {
      for (let dy = -r; dy <= r; dy++) {
        for (const dx of [-r, r]) this.tryLot(def, near.tx + dx, near.ty + dy, near, (lot) => (best = !best || lot.score < best.score ? lot : best));
      }
      for (let dx = -r + 1; dx < r; dx++) {
        for (const dy of [-r, r]) this.tryLot(def, near.tx + dx, near.ty + dy, near, (lot) => (best = !best || lot.score < best.score ? lot : best));
      }
      if (best && r > Math.hypot(best.tx - near.tx, best.ty - near.ty) + 4) break;
    }
    return best;
  }

  tryLot(def, tx, ty, near, take) {
    if (!this.lotFree(tx, ty, def.w, def.h)) return;
    const door = { tx: tx + Math.floor(def.w / 2), ty: ty + def.h };
    const road = this.roadDistance(door.tx, door.ty);
    if (road === Infinity) return;
    // Near the centre, near a road; buildings line streets rather than scatter.
    take({ tx, ty, score: Math.hypot(tx - near.tx, ty - near.ty) + road * 1.5 });
  }

  // ------------------------------------------------------------------ materials & money

  /** Estimated cost of the materials at today's prices. */
  estimate(type) {
    let cost = 0;
    for (const [item, qty] of Object.entries(VILLAGE_BUILDINGS[type].materials)) cost += qty * (ITEMS[item]?.basePrice || 3);
    return Math.round(cost * G.materialMarkup);
  }

  /** Who pays: the owner's purse (or the village treasury). */
  purse(c) {
    if (c.owner === 'village') return { get: () => this.sim.state.village.treasury, pay: (x) => (this.sim.state.village.treasury -= x) };
    // Repairs to business premises come out of the business's till.
    if (c.kind === 'repair') {
      const E = this.sim.economy;
      const biz = E.businessAtBuilding(c.target);
      if (biz && E.ownerId(biz) === c.owner) {
        const b = E.biz(biz);
        return { get: () => b.money, pay: (x) => ((b.money -= x), E.ledger(biz, 'exp', x)) };
      }
    }
    const n = this.sim.npcs.byId(c.owner);
    return n ? { get: () => n.money, pay: (x) => (n.money -= x) } : null;
  }

  /** Buy what the site still needs from local suppliers, as far as money and stock allow. */
  buyMaterials(c) {
    const E = this.sim.economy;
    const purse = this.purse(c);
    if (!purse) return;
    for (const [item, need] of Object.entries(this.cons.missing(c))) {
      let left = Math.min(need, 12); // a cartload a day
      const sellers = E.active()
        .filter((id) => E.stock(id, item) > 0 && (E.def(id).kind === 'producer' || E.def(id).sells?.includes(item) || E.def(id).buys?.includes(item)))
        .map((id) => ({ id, price: Math.max(1, Math.round((E.def(id).kind === 'producer' ? (ITEMS[item].basePrice || 3) * E.priceFactor(id, item) * 0.9 : E.unitPrice(id, item)))) }))
        .sort((a, b) => a.price - b.price);
      for (const s of sellers) {
        if (left <= 0) break;
        const qty = Math.min(left, E.stock(s.id, item), Math.floor((c.budget + Math.max(0, purse.get() - 20)) / s.price));
        if (qty <= 0) continue;
        const cost = qty * s.price;
        const fromBudget = Math.min(c.budget, cost);
        c.budget -= fromBudget;
        purse.pay(cost - fromBudget);
        E.biz(s.id).stock[item] -= qty;
        E.biz(s.id).money += cost;
        E.ledger(s.id, 'rev', cost);
        c.delivered[item] = (c.delivered[item] || 0) + qty;
        left -= qty;
      }
      // No planks anywhere? The builders saw their own from timber (two logs a plank).
      if (item === 'planks' && left > 0) {
        const woodSeller = sellers.length ? null : E.active().find((id) => E.stock(id, 'wood') >= 2);
        if (woodSeller && purse.get() > 20) {
          const qty = Math.min(left, Math.floor(E.stock(woodSeller, 'wood') / 2));
          const cost = qty * 2 * (ITEMS.wood.basePrice || 3);
          if (qty > 0 && purse.get() >= cost) {
            purse.pay(cost);
            E.biz(woodSeller).stock.wood -= qty * 2;
            E.biz(woodSeller).money += cost;
            c.delivered.planks = (c.delivered.planks || 0) + qty;
          }
        }
      }
    }
    this.sim.bus.emit('construction:changed', c);
  }

  // ------------------------------------------------------------------ starting projects

  /** Fell any trees standing on the lot (the timber goes to the build). */
  clearLot(c) {
    for (const o of Object.values(this.sim.state.objects)) {
      if (o.kind !== 'tree' || o.tx < c.tx || o.tx >= c.tx + c.w || o.ty < c.ty || o.ty >= c.ty + c.h) continue;
      if (o.state === 'grown' || o.state === 'young') c.delivered.wood = (c.delivered.wood || 0) + 3;
      o.state = 'cleared';
      this.sim.world.updateObjectBlocking(o);
      this.sim.resources.changed(o);
    }
  }

  start(owner, type, purpose, near, extra = {}) {
    const lot = this.findLot(type, near);
    if (!lot) return null;
    const cost = this.estimate(type);
    let budget = 0;
    if (owner === 'village') {
      budget = Math.min(this.sim.state.village.treasury, cost);
      this.sim.state.village.treasury -= budget;
    } else {
      budget = Math.min(owner.money, cost);
      owner.money -= budget;
    }
    const c = this.cons.startProject({ owner: owner === 'village' ? 'village' : owner.id, type, tx: lot.tx, ty: lot.ty, purpose, budget, ...extra });
    this.clearLot(c);
    if (owner !== 'village') {
      this.sim.memory.remember(owner, 'started_building', { params: { vbuilding: type } });
      this.sim.chronicle('chronicle.npc_building', { npc: owner.id, gender: owner.gender, vbuilding: type, purpose });
    } else {
      this.sim.chronicle('chronicle.village_building', { vbuilding: type });
    }
    return c;
  }

  /** Weekly: who needs to build, and who can? */
  considerProjects() {
    const sim = this.sim;
    const P = sim.property;
    const npcs = sim.state.npcs;
    const vacant = P.homes().filter((id) => P.isVacant(id)).length;
    const homeless = npcs.filter((n) => !n.homeId && n.age >= 16);
    const crowded = new Set();
    for (const id of P.homes()) if (P.occupants(id) > P.capacity(id) && !sim.economy.businessAtBuilding(id)) crowded.add(id);
    const busy = new Set(this.projects().map((c) => c.owner));
    const homeCost = this.estimate('small_house');
    const pressure = homeless.length + crowded.size * 1.5 + (this.sim.state.settlement.turnedAway || 0) * 0.5;
    let started = 0;
    // 1. Families build their own home.
    for (const n of npcs) {
      if (started >= 2 || busy.has(n.id) || n.age < 20) continue;
      const needsHome = !n.homeId || n.homeId === 'hall' || crowded.has(n.homeId) || (n.kin?.parents.some((pid) => sim.npcs.byId(pid)?.homeId === n.homeId) && n.age >= 22) || (n.kin?.spouse && P.landlord(n));
      if (!needsHome || vacant > 1) continue;
      const funds = n.money + (sim.family.spouse(n)?.money || 0) * 0.5;
      // With a wage coming in you can build as you go; without one you need the money up front.
      const earning = (n.employer || n.owns) && n.occupation !== 'unemployed';
      if (funds < homeCost * (earning ? 0.7 : 1)) continue;
      const fam = (n.kin?.children || []).filter((id) => sim.npcs.byId(id)?.homeId === n.homeId).length + (n.kin?.spouse ? 2 : 1);
      const type = funds >= this.estimate('house') * 0.7 && fam >= 3 ? 'house' : 'small_house';
      const near = n.employer ? sim.economy.buildingOf(n.employer)?.door : null;
      if (this.start(n, type, 'home', near || PLAZA_C)) {
        started++;
        busy.add(n.id);
      }
    }
    // 2. Landlords: well-off villagers build houses to let when people need homes.
    if (pressure >= 1 && vacant === 0 && started < 2) {
      const investor = npcs
        .filter((n) => n.age >= 25 && n.money >= 650 && !busy.has(n.id) && !n.traits.includes('generous'))
        .sort((a, b) => b.money - a.money)[0];
      if (investor && this.start(investor, 'house', 'rental', PLAZA_C)) started++;
    }
    // 3. The village builds with its rent income: homes when people sleep in the hall, wells for new streets.
    const V = sim.state.village;
    if (pressure >= 2 && vacant === 0 && V.treasury >= this.estimate('small_house') * 0.6 && !this.projects().some((c) => c.owner === 'village' && c.type !== 'well')) {
      this.start('village', 'small_house', 'rental', PLAZA_C);
    }
    const street = this.streetWithoutWell();
    if (street && V.treasury >= this.estimate('well') + 30 && !this.projects().some((c) => c.type === 'well')) this.start('village', 'well', 'public', street);
    // 4. Civic buildings as the village grows: a school, a library, a mill (see TechSystem.civicWanted).
    const civic = sim.tech?.civicWanted();
    if (civic && V.treasury >= this.estimate(civic) * 0.5 && !this.projects().some((c) => c.owner === 'village' && c.purpose === 'public' && c.type !== 'well')) {
      this.start('village', civic, 'public', PLAZA_C);
    }
  }

  /** A cluster of homes built during the game that has no well nearby. */
  streetWithoutWell() {
    const world = this.sim.world;
    const wells = world.decor.filter((d) => d.type === 'well').map((d) => ({ tx: d.tx, ty: d.ty }));
    for (const b of world.buildingList) if (b.type === 'well') wells.push({ tx: b.tx, ty: b.ty });
    const newHomes = world.buildingList.filter((b) => b.id.startsWith('vb') && b.type !== 'well' && b.type !== 'shopfront');
    for (const h of newHomes) {
      const near = newHomes.filter((o) => Math.abs(o.tx - h.tx) + Math.abs(o.ty - h.ty) <= 12).length;
      const hasWell = wells.some((w) => Math.abs(w.tx - h.tx) + Math.abs(w.ty - h.ty) <= 12);
      if (near >= 3 && !hasWell) return { tx: h.door.tx, ty: h.door.ty + 2 };
    }
    return null;
  }

  /** An entrepreneur with no premises puts up a shopfront (the business opens when it's done). */
  buildPremises(n, bizType, kind = 'shopfront') {
    if (this.projectOf(n)) return null;
    // Warehouses go near the producers (by the main road); shops near the plaza.
    const near = kind === 'warehouse' ? { tx: 20, ty: 44 } : PLAZA_C;
    return this.start(n, kind, 'shop', near, { bizType });
  }

  // ------------------------------------------------------------------ work on sites

  /**
   * Day labour: owners (and the village) hire people who are out of work to
   * help on their sites — paid for the day, which keeps them afloat.
   */
  hireLabour() {
    const sim = this.sim;
    const day = sim.time.day;
    const pool = sim.state.npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 16 && n.age < 62 && !n.leaving && n.dayLabour?.day !== day);
    for (const c of this.projects()) {
      if (c.labor >= this.cons.maxLabor(c) - 1 || !pool.length) continue;
      const purse = this.purse(c);
      if (!purse || c.budget + purse.get() < G.dayWage * 2 + 20) continue;
      const hires = Math.min(2, pool.length);
      for (let i = 0; i < hires; i++) {
        const n = pool.shift();
        n.dayLabour = { site: c.id, day };
        n.plan = null;
        if (n.task?.type === 'leisure' || n.task?.type === 'job_search') n.task = null;
      }
    }
  }

  /** Yesterday's day labourers get their pay. */
  payLabour() {
    const day = this.sim.time.day;
    for (const n of this.sim.state.npcs) {
      const d = n.dayLabour;
      if (!d || d.day !== day - 1 || d.paid) continue;
      d.paid = true;
      const c = this.cons.byId(d.site);
      const purse = c && this.purse(c);
      if (!purse || !d.worked) continue;
      const fromBudget = Math.min(c.budget, G.dayWage);
      c.budget -= fromBudget;
      const rest = Math.min(G.dayWage - fromBudget, Math.max(0, purse.get()));
      purse.pay(rest);
      n.money += fromBudget + rest;
    }
  }

  /** Villagers who'd help raise this owner's house: family and good friends (or anyone, for the village). */
  helpable(npc) {
    if (npc.dayLabour?.day === this.sim.time.day) return this.cons.byId(npc.dayLabour.site);
    for (const c of this.projects()) {
      if (c.owner === npc.id) continue;
      if (c.owner === 'village') {
        if ((npc.habits?.sociability ?? 0) > 0.6 && npc.age >= 18) return c;
        continue;
      }
      const owner = this.sim.npcs.byId(c.owner);
      if (!owner) continue;
      if (npc.family.includes(owner.id) || this.sim.social.npcRel(npc, owner) >= 45) return c;
    }
    return null;
  }

  /** Called when a villager finishes an evening's work at a site. */
  eveningWork(npc, c, minutes) {
    if (!c || c.status !== 'site') return;
    const own = c.owner === npc.id;
    const hired = npc.dayLabour?.site === c.id && npc.dayLabour.day === this.sim.time.day;
    if (hired) npc.dayLabour.worked = true;
    this.cons.addLabor(c, minutes * (own ? G.ownLaborRate : hired ? G.labourRate : G.helperLaborRate) * this.sim.npcs.productivity(npc));
    if (!own && !hired) {
      const owner = this.sim.npcs.byId(c.owner);
      if (owner) {
        this.sim.social.addNpcRel(npc, owner, 2);
        if (!this.sim.memory.has(owner, 'helped_build', npc.id)) this.sim.memory.remember(owner, 'helped_build', { who: npc.id, params: { npc: npc.id } });
      }
    }
  }

  /** The site a builder should work on next (with materials to work with). */
  siteForBuilder() {
    return this.projects()
      .filter((c) => c.labor < this.cons.maxLabor(c) - 0.5)
      .sort((a, b) => a.createdDay - b.createdDay)[0];
  }

  /** A builders' firm worked on a site: the project pays for the hours. */
  builderWorked(npc, c, minutes) {
    this.cons.addLabor(c, minutes);
    const bizId = npc.employer || npc.owns;
    const b = this.sim.economy.biz(bizId);
    const purse = this.purse(c);
    if (!b || !purse) return;
    const fee = Math.round((minutes / 60) * G.builderPayPerHour * (b.markup ?? 1));
    const fromBudget = Math.min(c.budget, fee);
    c.budget -= fromBudget;
    const rest = Math.min(fee - fromBudget, Math.max(0, purse.get()));
    purse.pay(rest);
    b.money += fromBudget + rest;
    this.sim.economy.ledger(bizId, 'rev', fromBudget + rest);
  }

  // ------------------------------------------------------------------ finishing

  /** You put in an hour on a villager's house (or brought them materials). */
  playerHelped(c) {
    const owner = this.sim.npcs.byId(c.owner);
    if (!owner) return;
    this.sim.social.addRel(owner, this.sim.social.relGain(owner, 3));
    this.sim.memory.remember(owner, 'player_helped_build', { who: 'player', params: { vbuilding: c.type } });
  }

  /** A villager's or the village's building is finished (called by ConstructionSystem). */
  completed(c) {
    const sim = this.sim;
    const owner = sim.npcs.byId(c.owner);
    sim.property.onBuilt(c.id);
    this.connectRoad(c);
    if (c.purpose === 'home' && owner) {
      const household = [owner, sim.family.spouse(owner), ...sim.family.children(owner).filter((k) => k.homeId === owner.homeId && k.age < 20)].filter(Boolean);
      sim.property.moveIn(household, c.id, 'moved');
      sim.memory.remember(owner, 'built_home', { params: { building: c.id } });
      sim.chronicle('chronicle.npc_built_home', { npc: owner.id, gender: owner.gender, building: c.id });
    } else if (c.purpose === 'rental') {
      sim.chronicle('chronicle.new_rental', { building: c.id, npc: owner?.id, owner: c.owner });
    } else if (c.purpose === 'shop' && owner) {
      if (c.bizType && !owner.owns && owner.money >= sim.enterprise.startCost(c.bizType, true)) sim.enterprise.open(owner, c.bizType, { building: c.id, how: 'own' }, sim.family.spouse(owner));
      else sim.property.rec(c.id).formerBusiness = c.bizType || 'general_store';
    } else if (c.purpose === 'public') {
      sim.chronicle(`chronicle.village_${c.type}`, { building: c.id });
      if (c.type === 'mill') sim.enterprise.villageMill?.(c.id);
      sim.tech && (sim.tech.mods = null);
    }
    sim.state.settlement.built = (sim.state.settlement.built || 0) + 1;
  }

  /** Lay a short road from the new door to the nearest road (paid by the village). */
  connectRoad(c) {
    const world = this.sim.world;
    const door = { tx: c.tx + Math.floor(c.w / 2), ty: c.ty + c.h };
    if (c.w === 1) return;
    // Breadth-first search over free ground to the nearest road tile.
    const key = (x, y) => y * world.W + x;
    const prev = new Map([[key(door.tx, door.ty), null]]);
    const q = [door];
    let end = null;
    while (q.length && !end) {
      const cur = q.shift();
      if (Math.abs(cur.tx - door.tx) + Math.abs(cur.ty - door.ty) > G.roadReach + 2) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        const k = key(nx, ny);
        if (!world.inBounds(nx, ny) || prev.has(k)) continue;
        prev.set(k, cur);
        if (world.isRoad(nx, ny)) {
          end = cur;
          break;
        }
        if (world.isBlocked(nx, ny) || world.isWater(nx, ny) || this.sim.state.fields[`${nx},${ny}`] || world.tileAt(nx, ny) === T.FARMLAND) continue;
        q.push({ tx: nx, ty: ny });
      }
    }
    if (!end) return;
    let cur = end;
    while (cur) {
      if (!world.isRoad(cur.tx, cur.ty)) {
        world.setRoad(cur.tx, cur.ty);
        this.sim.state.land.roads.push(`${cur.tx},${cur.ty}`);
        this.sim.bus.emit('road:built', { tx: cur.tx, ty: cur.ty });
      }
      cur = prev.get(key(cur.tx, cur.ty));
    }
  }

  // ------------------------------------------------------------------ migration

  /** How attractive the village looks to outsiders right now. */
  attractiveness() {
    const sim = this.sim;
    const npcs = sim.state.npcs;
    const jobs = sim.npcs.vacancies().reduce((s, [id]) => s + Math.max(0, sim.npcs.maxStaff(id) - sim.npcs.staffOf(id).length), 0);
    const P = sim.property;
    const homes = P.homes().filter((id) => P.isVacant(id)).length + Math.max(0, P.capacity('hall') - P.occupants('hall'));
    const unemployed = npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 16).length;
    const homeless = npcs.filter((n) => !n.homeId && n.age >= 16).length;
    const bread = sim.economy.sellersOf('bread');
    const food = bread.length ? bread.reduce((s, id) => s + sim.economy.priceFactor(id, 'bread'), 0) / bread.length : 1.5;
    const economy = (sim.events.modifier('migration') - 1) * 2; // a boom draws people in, a slump drives them off
    return jobs * 1.0 + Math.min(homes, 3) * 0.7 - unemployed * 0.8 - homeless * 1.5 - (food > 1.5 ? 1 : 0) + (this.projects().length ? 0.3 : 0) + economy;
  }

  migration() {
    const sim = this.sim;
    const S = sim.state.settlement;
    const a = this.attractiveness();
    S.lastAttractiveness = Math.round(a * 10) / 10;
    // Word gets around: a place with work and room draws people in.
    if (a > 0.8 && rand.chance(Math.min(0.8, a * 0.25))) this.arrive();
    else if (a > 0.8) S.turnedAway = (S.turnedAway || 0) + 1;
    // People with no work (or no roof) for too long give up and move on.
    const day = sim.time.day;
    for (const n of sim.state.npcs.slice()) {
      if (n.age < 18 || n.leaving) continue;
      if (n.occupation === 'unemployed') S.joblessSince[n.id] ??= day;
      else delete S.joblessSince[n.id];
      const jobless = S.joblessSince[n.id] !== undefined ? day - S.joblessSince[n.id] : 0;
      const desperate = (jobless >= G.leaveAfterJoblessDays && n.money < 40) || (!n.homeId && jobless >= 14);
      if (!desperate || n.mood > 55 || rand.chance(0.6)) continue;
      // Family leaves together.
      const spouse = sim.family.spouse(n);
      if (spouse && spouse.occupation !== 'unemployed' && spouse.occupation !== 'elder') continue;
      const group = [n, spouse, ...sim.family.children(n).filter((k) => k.age < 18 && k.homeId === n.homeId)].filter(Boolean);
      this.leave(group);
      return;
    }
  }

  /** Newcomers walk in along the west road. */
  arrive() {
    const sim = this.sim;
    const r = rand.float();
    const count = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    const surnameIdx = rand.int(11, 29);
    const allTraits = Object.keys(TRAITS);
    const trades = ['farmhand', 'woodcutter', 'miner', 'store_clerk', 'tavern_server', 'baker_hand', 'carpenter_hand', 'fisher', null, null];
    const pos = sim.world.tileCenter(ENTRY_POINT.tx, ENTRY_POINT.ty);
    const people = [];
    const make = (gender, age, extra = {}) => {
      const traits = [...new Set([rand.pick(allTraits), rand.pick(allTraits)])];
      const npc = sim.npcs.spawn({
        gender,
        nameIdx: rand.int(0, 34),
        surnameIdx,
        age,
        occupation: age < 16 ? 'child' : 'unemployed',
        prevOccupation: age >= 16 ? rand.pick(trades) : null,
        traits,
        money: age < 16 ? 0 : rand.int(50, 240),
        look: randomLook(rand, gender, age),
        x: pos.x + people.length * 10,
        y: pos.y,
        homeId: null,
        pantry: 2,
        arrivedDay: sim.time.day,
        ...extra,
      });
      people.push(npc);
      return npc;
    };
    const first = make(rand.chance(0.5) ? 'm' : 'f', rand.int(18, 44));
    if (count >= 2) {
      const partner = make(first.gender === 'm' ? 'f' : 'm', Math.max(18, first.age + rand.int(-5, 5)));
      first.kin.spouse = partner.id;
      partner.kin.spouse = first.id;
      if (partner.gender === 'f' && first.gender === 'm') partner.surnameIdx = first.surnameIdx;
      if (count >= 3) {
        const [mother, father] = first.gender === 'f' ? [first, partner] : [partner, first];
        const child = make(rand.chance(0.5) ? 'm' : 'f', rand.int(2, 12), { kin: { spouse: null, parents: [mother.id, father.id], children: [], siblings: [] } });
        mother.kin.children.push(child.id);
        father.kin.children.push(child.id);
      }
    }
    for (const n of people) {
      sim.family.syncFamily(n);
      for (const o of people) if (o !== n) sim.social.adjust(n, o, { f: 70, t: 60 });
      sim.memory.remember(n, 'arrived_village');
    }
    sim.state.settlement.migrantsArrived = (sim.state.settlement.migrantsArrived || 0) + people.length;
    sim.state.settlement.turnedAway = 0;
    sim.chronicle('chronicle.migrants_arrived', { npc: first.id, gender: first.gender, n: people.length });
    sim.bus.emit('settlement:arrived', people.map((p) => p.id));
    return people;
  }

  /** A household packs up and walks away down the west road. */
  leave(group) {
    const sim = this.sim;
    for (const n of group) {
      n.leaving = true;
      for (const [id, v] of Object.entries(n.relations)) {
        const friend = sim.npcs.byId(id);
        if (friend && v.f >= 40 && !group.includes(friend)) sim.memory.remember(friend, 'friend_left', { who: n.id, params: { npc: n.id } });
      }
      // Tidy up: jobs, contracts, businesses, property stay behind (the village/heirs take over).
      if (n.owns) sim.family.businessWithoutHeir(n);
      if (n.employer === 'player') delete sim.state.workers[n.id];
      n.employer = null;
      n.task = null;
    }
    sim.state.settlement.left = (sim.state.settlement.left || 0) + group.length;
    sim.chronicle('chronicle.npc_left_village', { npc: group[0].id, gender: group[0].gender, n: group.length });
    // They walk out (the NPC system removes them at the edge — or at once if nobody's watching).
    for (const n of group) sim.npcs.sendAway(n, ENTRY_POINT);
  }

  // ------------------------------------------------------------------ districts

  /** Classify the village into districts from what's actually built where. */
  updateDistricts() {
    const sim = this.sim;
    const E = sim.economy;
    const P = sim.property;
    const cells = {};
    const add = (tx, ty, kind) => {
      const k = `${Math.floor(tx / DISTRICT_CELL)},${Math.floor(ty / DISTRICT_CELL)}`;
      cells[k] ??= { home: 0, shop: 0, industry: 0, farm: 0, public: 0 };
      cells[k][kind]++;
    };
    for (const b of sim.world.buildingList) {
      const biz = E.businessAtBuilding(b.id);
      const d = biz && E.def(biz);
      let kind;
      if (b.id === 'hall' || ['well', 'school', 'library', 'mill'].includes(b.type)) kind = 'public';
      else if (d?.output === 'farm' || b.type === 'farmhouse') kind = 'farm';
      else if (d?.kind === 'producer' || ['smithy', 'carpentry', 'workshop'].includes(d?.type || b.type) || b.type === 'lumberyard' || b.type === 'quarry_hut' || b.type === 'workshop' || b.type === 'storage_shed') kind = 'industry';
      else if (d?.kind === 'shop') kind = 'shop';
      else if (P.isHome(b.id)) kind = 'home';
      else continue;
      add(b.door.tx, b.door.ty, kind);
    }
    const types = {};
    for (const [k, c] of Object.entries(cells)) {
      const total = c.home + c.shop + c.industry + c.farm + c.public;
      const [top, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
      const type = { home: 'residential', shop: 'commercial', industry: 'industrial', farm: 'agricultural', public: 'civic' }[top];
      types[k] = total >= 2 && n / total < 0.55 ? 'mixed' : type;
    }
    const D = sim.state.districts;
    // Changes over time become part of the village's story.
    for (const [k, type] of Object.entries(types)) {
      const before = D.cells[k];
      if (before && before !== type && sim.time.day - (D.lastChangeDay || -99) > 20) {
        D.lastChangeDay = sim.time.day;
        D.changes.push({ day: sim.time.day, cell: k, from: before, to: type });
        sim.chronicle('chronicle.district_changed', { district: k, from: before, to: type });
      }
    }
    D.cells = types;
    // Group neighbouring cells of the same kind into named districts.
    const seen = new Set();
    D.list = [];
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
      const cx = group.reduce((s, g) => s + Number(g.split(',')[0]), 0) / group.length;
      const cy = group.reduce((s, g) => s + Number(g.split(',')[1]), 0) / group.length;
      const tx = (cx + 0.5) * DISTRICT_CELL;
      const ty = (cy + 0.5) * DISTRICT_CELL;
      D.list.push({ id: group.sort()[0], type, cells: group, tx, ty, name: this.districtName(type, tx, ty, group.sort()[0]) });
    }
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
    const k = `${Math.floor(tx / DISTRICT_CELL)},${Math.floor(ty / DISTRICT_CELL)}`;
    return this.sim.state.districts.list.find((d) => d.cells.includes(k)) || null;
  }

  /** District effect on a building's value: homes in quiet streets, shops in busy ones. */
  valueFactor(buildingId) {
    const b = this.sim.world.buildings[buildingId];
    if (!b) return 1;
    const d = this.districtAt(b.door.tx, b.door.ty);
    if (!d) return 1;
    const isShop = !!this.sim.economy.businessAtBuilding(buildingId);
    const table = isShop
      ? { commercial: 1.2, mixed: 1.1, civic: 1.1, residential: 0.95, industrial: 0.9, agricultural: 0.85 }
      : { residential: 1.08, mixed: 1.04, civic: 1.05, commercial: 1.0, industrial: 0.85, agricultural: 0.95 };
    return table[d.type] ?? 1;
  }

  // ------------------------------------------------------------------ daily

  onDay() {
    const sim = this.sim;
    this.payLabour();
    this.hireLabour();
    for (const c of this.projects()) {
      this.buyMaterials(c);
      // A project nobody works on (and nobody can pay for) is eventually given up.
      if (sim.time.day - (c.lastProgressDay ?? c.createdDay) > G.stallDaysToAbandon && this.cons.materialsFraction(c) < 1) this.abandonProject(c);
    }
    if (sim.time.weekday === 2) {
      this.considerProjects();
      this.migration();
    }
    // Milestones the village remembers.
    const pop = sim.state.npcs.length + 1;
    const S = sim.state.settlement;
    for (const m of [20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500]) {
      if (pop >= m && !S.milestones.includes(m)) {
        S.milestones.push(m);
        sim.chronicle('chronicle.population_milestone', { n: m });
      }
    }
    if (sim.time.day % 14 === 5 || !sim.state.districts.list.length) this.updateDistricts();
  }

  abandonProject(c) {
    const sim = this.sim;
    const owner = sim.npcs.byId(c.owner);
    if (owner) {
      owner.money += Math.max(0, c.budget);
      sim.memory.remember(owner, 'gave_up_building');
    } else if (c.owner === 'village') sim.state.village.treasury += Math.max(0, c.budget);
    this.cons.list.splice(this.cons.list.indexOf(c), 1);
    if (c.kind === 'building') sim.world.blockRect(c.tx, c.ty, c.w, c.h, 0);
    sim.chronicle('chronicle.building_abandoned_site', { npc: c.owner !== 'village' ? c.owner : undefined, vbuilding: c.type });
    sim.bus.emit('construction:removed', c);
  }
}

