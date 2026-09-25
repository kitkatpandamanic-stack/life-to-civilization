/**
 * PropertySystem — who owns every building, what it's worth, who lives where.
 *
 *   state.property[buildingId] = {
 *     owner: npcId | 'player' | 'village' | null,
 *     condition: 0–100, abandoned, emptyDays, forSale, rentLevel,
 *     arrears: weeks of unpaid rent, history: [{ owner, from, how, price }],
 *     ask: the rent you've set (null = the going rent at your rent level), forRent (a villager's house to let),
 *     lease: { tenant, since, rent, paid, missed, next?, notice?: { by, until, why } },   a tenancy
 *     tenancies: [{ tenant, from, to, paid, how }]                                         past tenancies
 *   }
 *
 * A living housing market: tenants pay rent to their landlord (a villager,
 * you, or the village), grown-up children move out, crowded families look
 * for bigger homes, people who save enough buy a house, the poor sell, the
 * evicted end up on the street, and empty houses slowly fall apart.
 *
 * Renting (building spec, Phase 5): a household renting a whole house has a lease — the rent
 * agreed, since when, what they've paid. Landlords (you, villagers who invest in houses, the
 * village) set the rent; tenants who find it too steep give notice; a landlord can give notice
 * too (with cause — rent owing — or after a first fortnight, at some cost to their name). Houses
 * let out cost their landlord upkeep; well-off villagers buy houses to let.
 */
import { HOME_CAPACITY, PROPERTY_VALUE, PUBLIC_BUILDINGS, PUBLIC_TYPES, HOUSING as H, RENTAL as RT, FLATS } from '../data/housing.js';
import { AREAS } from '../data/villageLayout.js';
import { GOALS } from '../data/goals.js';
import { rand } from '../core/rng.js';

/** Initial owners of homes that aren't obvious from who lives there. */
const START_OWNERS = { house_4: 'village', house_6: 'village', house_7: 'daria', shack: 'village', hall: 'village', tavern: 'boris' };
export const RENT_LEVELS = { cheap: 0.75, normal: 1, high: 1.3 };

export class PropertySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.property ??= {};
    sim.state.village ??= { treasury: 0 };
    this.valueCache = new Map();
    for (const b of sim.world.buildingList) this.ensure(b.id);
    sim.bus.on('building:added', (id) => this.onBuilt(id));
    sim.bus.on('time:day', () => this.onDay());
  }

  get all() {
    return this.sim.state.property;
  }
  rec(id) {
    return this.all[id] || null;
  }
  building(id) {
    return this.sim.world.buildings[id];
  }
  type(id) {
    const b = this.building(id);
    if (!b) return null;
    // Converted into something else (StructureSystem): that's what it is now.
    const v = this.sim.structures?.all?.[id]?.visual;
    if (v && !this.sim.structures.all[id].gone) return v;
    if (b.player) return this.sim.construction.byId(id)?.type || b.type;
    return b.type;
  }

  /** Create the property record for a building (first run or older saves). */
  ensure(id) {
    if (this.all[id]) return this.all[id];
    const b = this.building(id);
    if (!b) return null;
    let owner;
    if (b.player) owner = 'player';
    else if (START_OWNERS[id]) owner = START_OWNERS[id];
    else if (PUBLIC_BUILDINGS.includes(id)) owner = 'village';
    else {
      const biz = this.sim.economy.businessAtBuilding(id);
      if (biz) owner = this.sim.economy.ownerId(biz);
      else {
        // A family home belongs to its oldest adult resident.
        const adults = this.sim.npcs.residentsOf(id).filter((n) => n.age >= 18).sort((a, c) => c.age - a.age);
        owner = adults[0]?.id || 'village';
      }
    }
    this.all[id] = { owner, condition: 100, abandoned: false, emptyDays: 0, forSale: false, rentLevel: 'normal', arrears: 0, history: [{ owner, from: 0, how: 'founded' }] };
    return this.all[id];
  }

  onBuilt(id) {
    const c = this.sim.construction.byId(id);
    const owner = c && c.owner && c.owner !== 'player' ? c.owner : 'player';
    const r = this.ensure(id);
    if (r && r.owner !== owner) this.transfer(id, owner, 'built', 0);
    if (r) r.history[r.history.length - 1].how = 'built';
  }

  // ------------------------------------------------------------------ homes

  isHome(id) {
    const type = this.type(id);
    return HOME_CAPACITY[type] !== undefined;
  }

  capacity(id) {
    // A house that's been built up or given more bedrooms holds more (StructureSystem).
    return this.sim.structures?.capacity(id) ?? HOME_CAPACITY[this.type(id)] ?? 0;
  }

  /** People one household can have here: a house holds one household; a block of flats, a flat's worth each (FlatSystem). */
  homeCap(id) {
    return this.sim.flats?.isBlock(id) ? this.sim.flats.flatCap(id) : this.capacity(id);
  }

  occupants(id) {
    return this.sim.npcs.residentsOf(id).length + (this.sim.state.player.homeId === id ? 1 : 0);
  }

  /** A home nobody lives in, fit to live in, that could be rented or bought. */
  isVacant(id) {
    const r = this.rec(id);
    if (!r || !this.isHome(id) || r.abandoned || r.condition < 35) return false;
    if (id === this.sim.state.player.homeId || PUBLIC_BUILDINGS.includes(id)) return false;
    if (this.sim.economy.businessAtBuilding(id)) return false; // the tavern's rooms belong to the innkeeper
    if (this.sim.flats?.isBlock(id)) return this.sim.flats.free(id) > 0; // a block of flats: a flat free
    return this.occupants(id) === 0;
  }

  homes() {
    return Object.keys(this.all).filter((id) => this.isHome(id));
  }

  /** Market value: base × condition × location × demand. Cached for the day. */
  value(id) {
    const day = this.sim.time.day;
    const c = this.valueCache.get(id);
    if (c && c.day === day) return c.v;
    const r = this.rec(id);
    const base = PROPERTY_VALUE[this.type(id)] ?? 200;
    const b = this.building(id);
    const P = AREAS.plaza;
    const d = b ? Math.hypot(b.door.tx - (P.x1 + P.x2) / 2, b.door.ty - (P.y1 + P.y2) / 2) : 30;
    const location = 1.2 - Math.min(0.45, d / 90) + (b && this.nearRoad(b) ? 0.08 : 0);
    const cond = 0.25 + 0.75 * ((r?.condition ?? 100) / 100);
    // Its level, rooms and quality (StructureSystem) — a fine Level 4 house is worth more than a shoddy one.
    const build = this.sim.structures?.valueFactor(id) ?? 1;
    // The housing market takes it apart and puts it together (RealtySystem: land, demand, rent it brings…).
    const v = this.sim.realty ? this.sim.realty.priceParts(id).total : Math.round(base * build * cond * location * this.demand() * (this.sim.growth?.valueFactor(id) ?? 1));
    this.valueCache.set(id, { day, v });
    return v;
  }

  nearRoad(b) {
    const w = this.sim.world;
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) if (w.isRoad(b.door.tx + dx, b.door.ty + dy)) return true;
    return false;
  }

  /** Housing demand: when homes are full, prices rise; when many stand empty, they fall. */
  demand() {
    // The market's level, as supply and demand have moved it week by week (RealtySystem).
    if (this.sim.realty) return this.sim.realty.idx;
    const day = this.sim.time.day;
    if (this.demandCache?.day === day) return this.demandCache.v;
    const homes = this.homes().filter((id) => !this.rec(id).abandoned);
    const cap = homes.reduce((s, id) => s + this.capacity(id), 0) || 1;
    const people = this.sim.state.npcs.length + 1;
    const homeless = this.sim.state.npcs.filter((n) => !n.homeId && n.age >= 16).length;
    const v = Math.max(0.6, Math.min(1.8, 0.7 + (people / cap) * 0.5 + homeless * 0.04));
    this.demandCache = { day, v };
    return v;
  }

  /** The going rent for a home like this, where it is, as things are (before the landlord's own pricing). */
  marketRent(id) {
    // (A block of flats: the rent of one flat — the building's, shared out.)
    if (this.sim.flats?.isBlock(id)) return this.sim.flats.flatRent(this.sim.realty ? this.sim.realty.rentParts(id).total : Math.round(this.value(id) * H.rentPerWeekShare), id);
    if (this.sim.realty) return this.sim.realty.rentParts(id).total;
    return Math.max(3, Math.round(this.value(id) * H.rentPerWeekShare));
  }

  /** What the landlord asks a week: the rent they've set, or the going rent at their level (cheap / normal / high). */
  weeklyRent(id) {
    const r = this.rec(id);
    if (r?.ask) return r.ask;
    return Math.max(3, Math.round(this.marketRent(id) * (RENT_LEVELS[r?.rentLevel] || 1)));
  }

  /** The range of rents a landlord may ask for this home. */
  rentBounds(id) {
    const m = this.marketRent(id);
    return { min: Math.max(2, Math.round(m * RT.minAsk)), max: Math.round(m * RT.maxAsk), market: m };
  }

  /**
   * What state a building is in, as a place to live: owner_occupied · rented · for_rent · vacant ·
   * under_construction · under_renovation · abandoned — or business / public / other for the rest.
   */
  housingState(id) {
    const sim = this.sim;
    const c = sim.construction.byId(id);
    if (c && c.status === 'site' && c.kind === 'building') return 'under_construction';
    const r = this.rec(id);
    if (!r) return null;
    if (r.ruined || r.abandoned) return 'abandoned';
    if (sim.structures?.works(id)) return 'under_renovation';
    if (PUBLIC_BUILDINGS.includes(id) || PUBLIC_TYPES.includes(this.type(id))) return 'public';
    if (sim.economy.businessAtBuilding(id)) return 'business';
    if (!this.isHome(id)) return 'other';
    if (id === sim.state.player.homeId) return 'owner_occupied';
    if (this.occupants(id) > 0) return sim.npcs.residentsOf(id).some((n) => this.landlord(n)) ? 'rented' : 'owner_occupied';
    if (r.owner === 'player' ? sim.letting?.listed(id) : r.forRent || (r.owner === 'village' && r.condition >= 35)) return 'for_rent';
    return 'vacant';
  }

  /** A house let out to tenants (its owner lives elsewhere). */
  rentedOut(id) {
    return this.housingState(id) === 'rented';
  }

  ownerName(id) {
    return this.rec(id)?.owner;
  }

  /** Does this villager pay rent where they live (and to whom)? */
  landlord(npc) {
    if (!npc.homeId) return null;
    if (npc.homeId === this.sim.state.player.homeId) return null; // your household: you pay
    const r = this.rec(npc.homeId);
    if (!r || !r.owner) return null;
    if (r.owner === npc.id) return null;
    if (r.owner !== 'player' && r.owner !== 'village') {
      const owner = this.sim.npcs.byId(r.owner);
      if (!owner || npc.family.includes(owner.id)) return null; // family doesn't charge family
      // Living with the owner as a guest (in a block of flats: only if it's the owner's own flat).
      if (owner.homeId === npc.homeId && !npc.lodger && !(this.sim.flats?.isBlock(npc.homeId) && owner.flat !== npc.flat)) return null;
    }
    if (PUBLIC_BUILDINGS.includes(npc.homeId)) return null;
    return r.owner;
  }

  // ------------------------------------------------------------------ ownership

  transfer(id, owner, how, price = 0) {
    const r = this.ensure(id);
    if (!r) return;
    const last = r.history[r.history.length - 1];
    if (last && last.to === undefined) last.to = this.sim.time.day;
    r.history.push({ owner, from: this.sim.time.day, how, price: price || undefined });
    if (r.history.length > 12) r.history.splice(1, 1); // keep the founder and the recent owners
    const from = r.owner;
    r.owner = owner;
    r.forSale = false;
    r.forRent = false;
    r.ask = null;
    r.arrears = 0;
    // The tenants bought it: no more rent.
    if (r.lease && this.sim.npcs.residentsOf(id).some((n) => n.id === owner || n.family.includes(owner))) this.endLease(id, 'bought');
    // The ground it stands on goes with it.
    if (from !== owner) this.sim.territory?.buildingSold(id, from, owner);
    this.sim.bus.emit('property:changed', id);
  }

  /** Pay the seller (a villager, you, or the village). */
  payTo(owner, amount) {
    if (!owner || amount <= 0) return;
    if (owner === 'player') this.sim.state.player.money += amount;
    else if (owner === 'village') this.sim.state.village.treasury += amount;
    else {
      const n = this.sim.npcs.byId(owner);
      if (n) n.money += amount;
      else this.sim.state.village.treasury += amount;
    }
  }

  /** Move villagers into a home (a household moving together, or one person). */
  moveIn(npcs, id, reason = 'moved') {
    const wasEmpty = this.occupants(id) === 0 && id !== this.sim.state.player.homeId;
    for (const n of npcs) {
      const from = n.homeId;
      if (from === id) continue;
      n.homeId = id;
      n.homeSince = this.sim.time.day;
      n.lodger = false;
      n.flat = null;
      n.plan = null;
      if (n.task && ['home', 'sleep', 'rest', 'sick'].includes(n.task.type)) n.task = null;
      if (from) this.sim.memory.remember(n, reason === 'evicted' ? 'evicted' : 'moved_home', { params: { building: id } });
    }
    const r = this.rec(id);
    if (r) {
      r.emptyDays = 0;
      r.arrears = 0;
    }
    this.sim.npcs.invalidateHouseholds();
    for (const n of npcs) this.sim.habits.derive(n);
    // Taking a whole house from a landlord: a lease, at the rent asked.
    const head = npcs.filter((n) => n.age >= 18).sort((a, b) => b.money - a.money)[0];
    if (this.sim.flats?.isBlock(id)) this.sim.flats.moveIn(id, npcs); // a flat of their own (and its tenancy)
    else if (wasEmpty && head && this.landlord(head)) this.startLease(id, head);
    this.sim.structures?.movedIn(id, npcs);
    this.sim.bus.emit('property:changed', id);
  }

  // ------------------------------------------------------------------ the player

  canPlayerBuy(id) {
    const r = this.rec(id);
    if (!r || r.owner === 'player' || PUBLIC_BUILDINGS.includes(id) || PUBLIC_TYPES.includes(this.type(id))) return { ok: false, reason: 'not_for_sale' };
    if (this.sim.economy.businessAtBuilding(id) && !r.abandoned) return { ok: false, reason: 'not_for_sale' };
    const empty = this.occupants(id) === 0;
    const sellable = r.forSale || r.abandoned || (empty && (r.owner === 'village' || !r.owner));
    if (!sellable) return { ok: false, reason: 'not_for_sale' };
    const price = this.value(id);
    if (this.sim.state.player.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    return { ok: true, price };
  }

  playerBuy(id) {
    const chk = this.canPlayerBuy(id);
    if (!chk.ok) return chk;
    const r = this.rec(id);
    this.sim.state.player.money -= chk.price;
    this.payTo(r.owner, chk.price);
    const seller = r.owner;
    this.transfer(id, 'player', 'bought', chk.price);
    const sellerNpc = this.sim.npcs.byId(seller);
    if (sellerNpc) this.sim.memory.remember(sellerNpc, 'sold_home_to_player', { who: 'player', params: { building: id, money: chk.price } });
    this.sim.chronicle('chronicle.player_bought_property', { building: id, money: chk.price });
    this.sim.progression.addXp(20);
    return { ok: true, price: chk.price };
  }

  playerSell(id) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player' || id === this.sim.state.player.homeId) return false;
    r.forSale = true;
    this.sim.bus.emit('property:changed', id);
    return true;
  }

  setRentLevel(id, level) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player' || !RENT_LEVELS[level]) return;
    const before = this.weeklyRent(id);
    r.rentLevel = level;
    r.ask = null;
    this.rentChanged(id, before);
    this.sim.bus.emit('property:changed', id);
  }

  /** Set the rent for a house of yours (a week), within what the market will bear. */
  setRent(id, amount) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player') return { ok: false, reason: 'not_yours' };
    const b = this.rentBounds(id);
    const before = this.weeklyRent(id);
    r.ask = Math.max(b.min, Math.min(b.max, Math.round(amount)));
    this.rentChanged(id, before);
    this.sim.bus.emit('property:changed', id);
    return { ok: true, rent: r.ask };
  }

  /**
   * The rent went up or down. A sitting tenant pays the new rent from next rent day — or, if it's
   * now beyond them (or far above the going rent), gives notice. A cut is noticed, and liked.
   */
  rentChanged(id, before) {
    const sim = this.sim;
    const L = this.rec(id)?.lease;
    const now = this.weeklyRent(id);
    if (!L || now === before) return;
    L.next = now;
    const tenant = sim.npcs.byId(L.tenant);
    if (!tenant || L.notice) return;
    const landlord = this.rec(id).owner;
    const who = landlord === 'player' ? 'player' : sim.npcs.byId(landlord) ? landlord : null;
    if (now > before) {
      const budget = this.householdBudget(tenant);
      if (now > budget * 1.15 || now > this.marketRent(id) * RT.raiseTolerance) {
        this.giveNotice(id, { by: 'tenant', why: now > budget * 1.15 ? 'rent_beyond_means' : 'rent_too_high' });
      } else if (who) sim.memory.remember(tenant, 'rent_raised', { who, params: { building: id, money: now } });
    } else if (who) sim.memory.remember(tenant, 'rent_lowered', { who, params: { building: id, money: now } });
  }

  /** What a household can pay a week: the head's means and most of their partner's. */
  householdBudget(npc) {
    const spouse = this.sim.family.spouse(npc);
    return this.rentBudget(npc) + (spouse && spouse.homeId === npc.homeId ? this.rentBudget(spouse) * 0.6 : 0);
  }

  // ------------------------------------------------------------------ tenancies

  lease(id) {
    return this.rec(id)?.lease || null;
  }

  /** A household has taken the whole house: the rent is agreed. */
  startLease(id, head) {
    const r = this.rec(id);
    if (!r || !head) return null;
    r.lease = { tenant: head.id, since: this.sim.time.day, rent: this.weeklyRent(id), paid: 0, missed: 0 };
    return r.lease;
  }

  /** The tenancy is over (they left, were put out, or bought the house). */
  endLease(id, how) {
    const r = this.rec(id);
    const L = r?.lease;
    if (!L) return;
    r.tenancies ??= [];
    r.tenancies.push({ tenant: L.tenant, from: L.since, to: this.sim.time.day, paid: L.paid, how });
    if (r.tenancies.length > RT.pastTenants) r.tenancies.shift();
    r.lease = null;
    this.sim.bus.emit('property:changed', id);
  }

  /** Can this landlord end the tenancy? With cause (rent owing) at once; otherwise not in the first fortnight. */
  canGiveNotice(id, by = 'player') {
    const r = this.rec(id);
    const L = r?.lease;
    if (!r || r.owner !== by) return { ok: false, reason: 'not_yours' };
    if (!L) return { ok: false, reason: 'no_tenant' };
    if (L.notice) return { ok: false, reason: 'notice_given' };
    const cause = r.arrears > 0;
    const left = RT.minStayDays - (this.sim.time.day - L.since);
    if (!cause && left > 0) return { ok: false, reason: 'too_soon', params: { n: left } };
    return { ok: true, cause };
  }

  /**
   * Notice to quit: the household has a week to find somewhere else, then goes.
   * by: 'landlord' (you or a villager landlord) or 'tenant' (they're leaving of their own accord).
   */
  giveNotice(id, { by = 'landlord', why = null } = {}) {
    const sim = this.sim;
    const r = this.rec(id);
    const L = r?.lease;
    if (!L || L.notice) return { ok: false, reason: L ? 'notice_given' : 'no_tenant' };
    let cause = r.arrears > 0;
    if (by === 'landlord' && r.owner === 'player') {
      const chk = this.canGiveNotice(id);
      if (!chk.ok) return chk;
      cause = chk.cause;
    }
    L.notice = { by, until: sim.time.day + RT.noticeDays, why: why || (by === 'landlord' ? (cause ? 'arrears' : 'landlord') : 'moving') };
    const tenant = sim.npcs.byId(L.tenant);
    if (by === 'landlord' && tenant) {
      const who = r.owner === 'player' ? 'player' : sim.npcs.byId(r.owner) ? r.owner : null;
      sim.memory.remember(tenant, cause ? 'notice_for_arrears' : 'given_notice', { who, params: { building: id } });
      if (r.owner === 'player') {
        if (!cause) sim.progression.addReputation(-RT.noticeRep);
        sim.toast('toast.notice_given', { npc: tenant.id, gender: tenant.gender, building: id, n: RT.noticeDays }, 'info');
      }
      sim.chronicle('chronicle.notice_given', { npc: tenant.id, gender: tenant.gender, building: id });
    } else if (tenant && r.owner === 'player') {
      sim.toast('toast.tenant_notice', { npc: tenant.id, gender: tenant.gender, building: id, n: RT.noticeDays, letting: L.notice.why }, 'warn');
    }
    sim.bus.emit('property:changed', id);
    return { ok: true };
  }

  /** Withdraw notice you gave — or, if they gave it, talk them round (they stay if the rent now suits them). */
  withdrawNotice(id) {
    const L = this.lease(id);
    if (!L?.notice) return false;
    if (L.notice.by === 'tenant') {
      const tn = this.sim.npcs.byId(L.tenant);
      if (!tn || this.weeklyRent(id) > this.householdBudget(tn) * 1.15 || this.weeklyRent(id) > this.marketRent(id) * RT.raiseTolerance) return false;
    }
    delete L.notice;
    this.sim.bus.emit('property:changed', id);
    return true;
  }

  /** The notice is up: the household moves out — to another home if they can find one. */
  vacate(id) {
    const sim = this.sim;
    const L = this.lease(id);
    const how = L?.notice?.by === 'tenant' ? 'moved_out' : 'notice';
    const members = sim.npcs.residentsOf(id).slice();
    for (const n of members) {
      n.homeId = null;
      n.plan = null;
      if (n.task && ['home', 'sleep', 'rest', 'sick'].includes(n.task.type)) n.task = null;
      n.evictedFrom ??= {};
      n.evictedFrom[id] = sim.time.day; // they won't be back for a while
    }
    sim.npcs.invalidateHouseholds();
    this.endLease(id, how);
    const head = members.find((m) => m.id === L?.tenant) || members.find((m) => m.age >= 18) || members[0];
    if (head) {
      const opt = this.options(members.length, this.householdBudget(head) * 1.1, head.money / H.buyReserve, head)[0];
      if (opt) this.settle(members, opt, head, 'moved');
      else for (const n of members) this.findRoof(n);
      sim.chronicle('chronicle.tenants_left', { npc: head.id, gender: head.gender, building: id, n: members.length });
      if (this.rec(id)?.owner === 'player') sim.toast('toast.tenants_left', { npc: head.id, gender: head.gender, building: id }, 'info');
    }
    sim.bus.emit('building:changed', id);
  }

  /** Materials and money needed to bring a building back to full condition. */
  restoreCost(id) {
    const r = this.rec(id);
    const missing = Math.max(0, 100 - (r?.condition ?? 100));
    const mats = {};
    for (const [item, per] of Object.entries(H.restorePerCondition)) {
      const q = Math.ceil(missing * per);
      if (q > 0) mats[item] = q;
    }
    return { materials: mats, money: Math.ceil(missing * H.restoreMoneyPerCondition), points: missing };
  }

  canRestore(id) {
    const r = this.rec(id);
    if (!r || r.owner !== 'player') return { ok: false, reason: 'not_yours' };
    const cost = this.restoreCost(id);
    if (!cost.points) return { ok: false, reason: 'no_repair_needed' };
    const inv = this.sim.inventory;
    const home = this.sim.home;
    for (const [item, q] of Object.entries(cost.materials)) {
      if (inv.count(item) + home.storageCount(item) < q) return { ok: false, reason: 'need_item', params: { item, qty: q } };
    }
    if (this.sim.state.player.money < cost.money) return { ok: false, reason: 'no_money', params: { money: cost.money } };
    return { ok: true, cost };
  }

  restore(id) {
    const chk = this.canRestore(id);
    if (!chk.ok) return chk;
    for (const [item, q] of Object.entries(chk.cost.materials)) {
      const fromPockets = this.sim.inventory.remove(item, q);
      if (fromPockets < q) this.sim.home.take(item, q - fromPockets);
    }
    this.sim.state.player.money -= chk.cost.money;
    const r = this.rec(id);
    r.condition = 100;
    r.abandoned = false;
    r.emptyDays = 0;
    this.sim.progression.addXp(30);
    this.sim.progression.addSkillXp('construction', 30);
    this.sim.chronicle('chronicle.building_restored', { building: id });
    this.sim.bus.emit('property:changed', id);
    this.sim.bus.emit('building:changed', id);
    return { ok: true };
  }

  // ------------------------------------------------------------------ daily & weekly

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    for (const [id, r] of Object.entries(this.all)) {
      if (!this.building(id)) continue;
      const biz = sim.economy.businessAtBuilding(id);
      // (Public buildings — school, library, market hall, watch house… — are always in use.)
      const inUse = this.occupants(id) > 0 || (biz && !sim.economy.biz(biz)?.closed) || sim.businesses.atBuilding(id) || PUBLIC_BUILDINGS.includes(id) || PUBLIC_TYPES.includes(this.type(id));
      const wasAbandoned = r.abandoned;
      const ownerAlive = r.owner === 'player' || r.owner === 'village' || !!sim.npcs.byId(r.owner);
      if (inUse) {
        r.emptyDays = 0;
        // Owners keep their buildings in repair — it costs money (timber from the lumberyard).
        const owner = sim.npcs.byId(r.owner);
        let repaired = false;
        if (r.condition < 100) {
          if (r.owner === 'village' && sim.state.village.treasury >= H.repairCostPerDay) {
            sim.state.village.treasury -= H.repairCostPerDay;
            repaired = true;
          } else if (owner && owner.money >= H.repairCostPerDay + 5) {
            owner.money -= H.repairCostPerDay;
            repaired = true;
          } else if (r.owner === 'player') {
            // You keep your own buildings up; a house you let out costs you its upkeep.
            // (A block of flats: for each flat let.)
            const upkeep = this.sim.flats?.isBlock(id) ? RT.upkeepPerDay * Math.max(1, this.sim.flats.leases(id).length) * FLATS.upkeepShare : RT.upkeepPerDay;
            if (!this.rentedOut(id)) repaired = true;
            else if (sim.state.player.money >= upkeep) {
              sim.state.player.money -= upkeep;
              repaired = true;
            }
          }
          if (repaired && (r.owner !== 'player' || this.rentedOut(id))) {
            const yard = sim.economy.biz('lumberyard');
            if (yard) yard.money += H.repairCostPerDay;
          }
        }
        r.condition = Math.max(0, Math.min(100, r.condition + (repaired ? H.ownerRepairPerDay - H.wearPerDay : -H.wearPerDay)));
      } else {
        r.emptyDays++;
        // Empty homes of living owners are looked after (they're for rent); ownerless ones are left to rot.
        if (r.owner === 'player' || (ownerAlive && r.owner !== 'village' && this.isHome(id))) r.condition = Math.max(0, r.condition - H.wearPerDay);
        else if (r.emptyDays >= H.abandonAfterDays) r.abandoned = true;
        if (r.abandoned) r.condition = Math.max(0, r.condition - H.abandonedDecayPerDay);
      }
      // Tenancies: notice running out; a household gone of its own accord.
      if (r.lease) {
        if (r.lease.notice && day >= r.lease.notice.until) this.vacate(id);
        else if (this.occupants(id) === 0) this.endLease(id, 'left');
        else if (!sim.npcs.byId(r.lease.tenant)) {
          // The tenant died or left the valley: whoever's left of the household carries on.
          const next = sim.npcs.residentsOf(id).filter((n) => n.age >= 18)[0];
          if (next) r.lease.tenant = next.id;
        }
      }
      if (!ownerAlive && r.owner) {
        // Nobody left to claim it: the village takes it over.
        this.transfer(id, 'village', 'escheat');
      }
      if (r.abandoned && !wasAbandoned) {
        sim.chronicle('chronicle.building_abandoned', { building: id });
        sim.bus.emit('building:changed', id);
      }
      if (r.condition < H.ruinBelow && !r.ruined) {
        r.ruined = true;
        sim.chronicle('chronicle.building_ruined', { building: id });
        sim.bus.emit('building:changed', id);
      } else if (r.ruined && r.condition >= H.ruinBelow) r.ruined = false;
    }
    if (sim.time.weekday === 0) {
      this.collectRent();
      this.market();
    }
    this.familySupport();
    if (day % 7 === 3) this.valueCache.clear();
  }

  /** Rent day: tenants pay their landlord. Those who can't fall behind — and eventually out. */
  collectRent() {
    const sim = this.sim;
    const byHome = new Map();
    for (const n of sim.state.npcs) {
      if (!n.homeId || n.age < 16) continue;
      const landlord = this.landlord(n);
      if (!landlord) continue;
      if (!byHome.has(n.homeId)) byHome.set(n.homeId, { landlord, payers: [] });
      byHome.get(n.homeId).payers.push(n);
    }
    let toPlayer = 0;
    // Businesses in rented premises (that nobody lives in) pay commercial rent from the till.
    const E = sim.economy;
    for (const bizId of E.active()) {
      const b = E.biz(bizId);
      const r = this.rec(b.building);
      if (!r || !r.owner || r.owner === b.owner || byHome.has(b.building) || PUBLIC_BUILDINGS.includes(b.building)) continue;
      if (sim.npcs.residentsOf(b.building).length) continue;
      const rent = this.weeklyRent(b.building);
      const paid = Math.min(rent, Math.max(0, Math.floor(b.money)));
      b.money -= paid;
      E.ledger(bizId, 'exp', paid);
      this.payTo(r.owner, paid);
      if (r.owner === 'player' && paid > 0) sim.toast('toast.rent_received', { money: paid, building: b.building }, 'gain');
    }
    for (const [id, { landlord, payers }] of byHome) {
      const r = this.rec(id);
      // A block of flats: each flat pays its own rent (FlatSystem).
      if (this.sim.flats?.isBlock(id)) {
        const paid = this.sim.flats.collect(id, payers, landlord);
        if (landlord === 'player') {
          toPlayer += paid;
          if (paid > 0) sim.toast('toast.rent_received', { money: paid, building: id }, 'gain');
        }
        continue;
      }
      const lodgers = payers.every((p) => p.lodger);
      // A household renting the whole house pays what was agreed (a new rent from the week after it's set).
      if (!lodgers && !r.lease) this.startLease(id, payers.filter((p) => p.age >= 18).sort((a, b) => b.money - a.money)[0] || payers[0]);
      const L = lodgers ? null : r.lease;
      if (L?.next !== undefined) {
        L.rent = L.next;
        delete L.next;
      }
      // The village and villager landlords keep their rents in line with the going rate; you set yours by hand.
      if (L && landlord !== 'player') L.rent = this.weeklyRent(id);
      // Lodgers rent a room, not the whole house.
      const rent = L ? L.rent : Math.ceil(this.weeklyRent(id) * 0.5);
      const share = Math.ceil(rent / payers.length);
      let paid = 0;
      for (const n of payers) {
        const x = Math.min(share, rent - paid, Math.max(0, Math.floor(n.money))); // (split between them — never more than the rent)
        n.money -= x;
        paid += x;
      }
      this.payTo(landlord, paid);
      if (landlord === 'player') toPlayer += paid;
      if (L) L.paid += paid;
      if (landlord === 'player' && paid > 0) sim.toast('toast.rent_received', { money: paid, building: id }, 'gain');
      if (paid < rent * 0.7) {
        r.arrears++;
        if (L) L.missed++;
        const limit = landlord === 'village' ? H.villageEvictWeeks : H.landlordEvictWeeks;
        if (r.arrears >= limit) this.evict(id, payers, landlord);
      } else r.arrears = 0;
    }
    // What this week's rent brought you (the property manager takes a share of it).
    sim.state.letting && (sim.state.letting.lastRent = { day: sim.time.day, money: toPlayer });
  }

  evict(id, payers, landlord) {
    const household = this.sim.npcs.residentsOf(id).slice();
    for (const n of household) {
      n.homeId = null;
      n.plan = null;
      n.task = null;
      n.evictedFrom ??= {};
      n.evictedFrom[id] = this.sim.time.day;
      this.sim.memory.remember(n, 'evicted', { who: landlord === 'player' ? 'player' : this.sim.npcs.byId(landlord) ? landlord : null, params: { building: id } });
    }
    this.sim.npcs.invalidateHouseholds();
    this.endLease(id, 'evicted');
    this.rec(id).arrears = 0;
    this.sim.chronicle('chronicle.npc_evicted', { npc: payers[0].id, gender: payers[0].gender, building: id });
    if (landlord === 'player') this.sim.progression.addReputation(-2);
  }

  /**
   * Family looks after its own: relatives with savings help those who are broke.
   * The village (funded by rent from the homes it owns) pays the elders' pensions
   * and gives poor relief to those with no one — so its income flows back into the village.
   */
  familySupport() {
    const village = this.sim.state.village;
    for (const n of this.sim.state.npcs) {
      if (n.age < 16 || n.money >= H.supportBelowMoney) continue;
      const helper = this.sim.family.relatives(n).find((r) => r.money >= H.supportAbove && r.age >= 18);
      if (helper) {
        helper.money -= H.supportAmount;
        n.money += H.supportAmount;
      } else {
        // Poor relief from the village fund — as generous as the headman decides (CivicSystem).
        const relief = Math.round(H.reliefAmount * (this.sim.civic?.mult('relief') ?? 1));
        if (village.treasury >= relief && n.age >= 18) {
          village.treasury -= relief;
          n.money += relief;
        }
      }
    }
  }

  /** Elders' pension comes out of the village treasury (a little extra from outside if it's empty). */
  payPension(npc, amount) {
    const village = this.sim.state.village;
    const fromVillage = Math.min(amount, Math.max(0, village.treasury));
    village.treasury -= fromVillage;
    npc.money += fromVillage + (amount - fromVillage) * 0.5;
  }

  // ------------------------------------------------------------------ the housing market

  /** Homes available to move into, best first for this household. */
  options(size, maxRent, buyBudget = 0, npc = null) {
    const ownRentals = npc ? this.rentalsOf(npc.id).length : 0;
    const out = [];
    const day = this.sim.time.day;
    for (const id of this.homes()) {
      if (!this.isVacant(id) || this.homeCap(id) < size || (npc && id === npc.homeId)) continue;
      // Your houses are taken only when you're letting them (the sign up, or a manager seeing to it).
      if (this.rec(id).owner === 'player' && !this.sim.letting?.listed(id)) continue;
      // A landlord won't take back a tenant they evicted (for a good while).
      if (npc?.evictedFrom?.[id] !== undefined && day - npc.evictedFrom[id] < 84) continue;
      const r = this.rec(id);
      const price = this.value(id);
      // (A villager doesn't move out of their own home into one they let out.)
      if (ownRentals && r.owner === npc.id) continue;
      const buyable = buyBudget > 0 && (r.forSale || r.owner === 'village' || !r.owner) && buyBudget >= price;
      const rent = this.weeklyRent(id);
      if (!buyable && rent > maxRent) continue;
      // Best first — for this household, as they see it (HousingSystem); otherwise simply the better deal.
      const H6 = npc && this.sim.housing;
      out.push({ id, buy: buyable, price, rent, score: H6 ? H6.evaluate(npc, id, { buy: buyable }).score : (buyable ? 50 : 0) - rent + this.capacity(id) * 2 + r.condition / 20 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** A spare room in someone else's house (a lodger pays a share of the rent). */
  lodging(n) {
    const budget = this.rentBudget(n);
    let best = null;
    for (const id of this.homes()) {
      const r = this.rec(id);
      if (!r || r.abandoned || r.condition < 40 || id === 'hall' || id === this.sim.state.player.homeId || this.sim.flats?.isBlock(id)) continue;
      if (this.sim.economy.businessAtBuilding(id) || this.occupants(id) === 0 || this.occupants(id) >= this.capacity(id)) continue;
      if (n.evictedFrom?.[id] !== undefined) continue;
      const share = Math.ceil(this.weeklyRent(id) / 2);
      if (share > budget) continue;
      const host = this.sim.npcs.residentsOf(id)[0];
      const bond = host && this.sim.social.bond(host, n);
      if (bond && bond.c >= 30) continue; // not with someone who can't stand them
      const score = (bond?.f || 0) - share;
      if (!best || score > best.score) best = { id, score };
    }
    return best?.id || null;
  }

  /** What can this person afford per week? (Roughly a third of what they earn, or their savings.) */
  rentBudget(npc) {
    const occ = this.sim.npcs.occ(npc);
    // A teacher's or a doctor's pay comes by the week (SchoolSystem, AcademiaSystem).
    const salaried = npc.teach ? this.sim.schools?.salary(npc) || 0 : npc.post ? this.sim.academia?.salary(npc.post.kind) || 0 : 0;
    const weekly = salaried || (occ.wage || (npc.owns ? 20 : npc.employer === 'player' ? this.sim.workers.contract(npc.id)?.salary || 10 : 0)) * 6;
    return Math.max(weekly * 0.35, npc.money / 6);
  }

  /** Complete a move: buy or rent `opt` for `members`. */
  settle(members, opt, head, reason) {
    const id = opt.id;
    if (opt.buy) {
      const r = this.rec(id);
      head.money -= opt.price;
      this.payTo(r.owner, opt.price);
      this.transfer(id, head.id, 'bought', opt.price);
      this.sim.memory.remember(head, 'bought_home', { params: { building: id, money: opt.price } });
      this.sim.chronicle('chronicle.npc_bought_home', { npc: head.id, gender: head.gender, building: id });
    }
    this.moveIn(members, id, reason);
  }

  /** Someone without a home finds a roof: family first, then anything they can afford, a spare room, the hall. */
  findRoof(n) {
    if (n.age < 16) {
      const kin = this.sim.family.relatives(n).find((r) => r.homeId);
      this.moveIn([n], kin ? kin.homeId : 'hall', 'moved');
      return;
    }
    const kinHome = this.sim.family.relatives(n).map((r) => r.homeId).find((h) => h && this.isHome(h) && this.occupants(h) < this.capacity(h) + 1 && !this.sim.economy.businessAtBuilding(h));
    if (kinHome) {
      this.moveIn([n], kinHome, 'moved');
      return;
    }
    const opt = this.options(1, this.rentBudget(n), n.money / H.buyReserve, n)[0];
    if (opt) this.settle([n], opt, n, 'moved');
    else {
      // No house free? Lodge in a spare room (paying the householder), or the village hall takes them in.
      const room = this.lodging(n);
      if (room) {
        this.moveIn([n], room, 'moved');
        n.lodger = true;
      } else if (this.occupants('hall') < this.capacity('hall')) this.moveIn([n], 'hall', 'moved');
    }
  }

  /** The houses this villager lets out (owned, not lived in by them). */
  rentalsOf(npcId) {
    return Object.entries(this.all)
      .filter(([id, r]) => r.owner === npcId && this.isHome(id) && this.sim.npcs.byId(npcId)?.homeId !== id)
      .map(([id]) => id);
  }

  /**
   * Villagers as landlords: someone well off buys a house that's on the market to let it —
   * the rent pays for the next one. Greedy landlords ask more, generous ones less.
   */
  investInHouses() {
    const sim = this.sim;
    // Only when people need homes (rents are worth having) — and the village keeps its own houses for
    // newcomers and the needy (their rent pays for the school), selling only a surplus.
    if (!RT.investChance || this.demand() < RT.investDemand) return;
    let villageSpare = this.homes().filter((id) => this.rec(id)?.owner === 'village' && this.isVacant(id)).length;
    for (const n of sim.state.npcs) {
      if (n.age < 25 || n.age > 68 || !n.homeId || n.leaving || n.money < RT.investExtra) continue;
      if (this.rec(n.homeId)?.owner !== n.id && !n.owns) continue; // they see to their own roof first
      const have = this.rentalsOf(n.id).length;
      if (have >= RT.maxRentals || !rand.chance(RT.investChance * (n.traits.includes('entrepreneur') || n.traits.includes('ambitious') ? 1.6 : 1) * (n.traits.includes('careful') ? 0.6 : 1))) continue;
      const buy = this.homes()
        .filter((id) => {
          const r = this.rec(id);
          if (!r || r.owner === n.id || r.owner === 'player' || PUBLIC_BUILDINGS.includes(id) || r.abandoned || r.condition < 45) return false;
          if (!(r.forSale || (!r.owner && this.isVacant(id)) || (r.owner === 'village' && villageSpare >= 2 && this.isVacant(id)))) return false;
          if (this.occupants(id) > 0 && !r.forSale) return false;
          return n.money >= this.value(id) * RT.investReserve + RT.investExtra;
        })
        .sort((a, b) => this.marketRent(b) / this.value(b) - this.marketRent(a) / this.value(a))[0];
      if (!buy) continue;
      const price = this.value(buy);
      const r = this.rec(buy);
      if (r.owner === 'village') villageSpare = Math.max(0, villageSpare - 1);
      n.money -= price;
      this.payTo(r.owner, price);
      this.transfer(buy, n.id, 'bought', price);
      r.forRent = true;
      r.rentLevel = n.traits.includes('greedy') ? 'high' : n.traits.includes('generous') ? 'cheap' : 'normal';
      sim.memory.remember(n, 'bought_rental', { params: { building: buy, money: price } });
      sim.chronicle(have ? 'chronicle.npc_more_rentals' : 'chronicle.npc_became_landlord', { npc: n.id, gender: n.gender, building: buy, n: have + 1 });
    }
  }

  /**
   * Villager landlords watch the market: a house standing empty for weeks gets a lower rent;
   * when homes are short and theirs is let, the rent goes up (the greedy sooner).
   */
  landlordsReview() {
    const sim = this.sim;
    const levels = ['cheap', 'normal', 'high'];
    const d = this.demand();
    for (const [id, r] of Object.entries(this.all)) {
      const owner = sim.npcs.byId(r.owner);
      if (!owner || !this.isHome(id) || owner.homeId === id) continue;
      const i = levels.indexOf(r.rentLevel || 'normal');
      if (this.occupants(id) === 0 && r.forRent && r.emptyDays >= 14 && i > 0) r.rentLevel = levels[i - 1];
      else if (this.occupants(id) > 0 && d >= (owner.traits.includes('greedy') ? 1.15 : 1.3) && i < 2 && !owner.traits.includes('generous')) r.rentLevel = levels[i + 1];
      else if (this.occupants(id) > 0 && d <= 0.9 && i > 0) r.rentLevel = levels[i - 1];
    }
  }

  market() {
    const sim = this.sim;
    const npcs = sim.state.npcs;
    // 1. Homeless people look for a roof: family first, then anything they can afford.
    for (const n of npcs.filter((x) => !x.homeId && x.age >= 16)) this.findRoof(n);
    // Minors without a home go with a relative (or the village hall looks after them).
    for (const n of npcs.filter((x) => !x.homeId && x.age < 16)) this.findRoof(n);
    // 2. Grown-up children move out of their parents' home.
    for (const n of npcs) {
      if (n.age < H.moveOutAge || n.kin?.spouse || n.money < H.moveOutMoney || !n.homeId) continue;
      if (!(n.employer || n.owns || n.teach || n.post)) continue;
      const withParents = n.kin?.parents.some((pid) => sim.npcs.byId(pid)?.homeId === n.homeId);
      if (!withParents || !rand.chance(H.moveOutChance)) continue;
      const opt = this.options(1, this.rentBudget(n), n.money / H.buyReserve)[0];
      if (!opt) continue;
      this.settle([n], opt, n, 'moved');
      sim.memory.remember(n, 'moved_out', { params: { building: opt.id } });
      sim.chronicle('chronicle.npc_moved_out', { npc: n.id, gender: n.gender, building: opt.id });
    }
    // 3. Crowded households — or those whose home is falling apart — look for something better (buying if they can).
    const seen = new Set();
    for (const n of npcs) {
      if (!n.homeId || seen.has(n.homeId) || n.age < 18) continue;
      seen.add(n.homeId);
      const home = n.homeId;
      const household = sim.npcs.residentsOf(home);
      const crumbling = (this.rec(home)?.condition ?? 100) < 20;
      if ((household.length <= this.capacity(home) && !crumbling) || sim.economy.businessAtBuilding(home)) continue;
      // The family (this person, spouse, children living here) moves together.
      const fam = household.filter((m) => m === n || n.family.includes(m.id));
      const head = fam.filter((m) => m.age >= 18).sort((a, b) => b.money - a.money)[0] || n;
      const opt = this.options(fam.length, this.rentBudget(head) * 1.3, head.money / H.buyReserve)[0];
      if (opt) this.settle(fam, opt, head, 'moved');
    }
    // 4. Tenants who have saved enough buy their home (or another one) — and stop paying rent.
    for (const n of npcs) {
      if (!n.homeId || n.age < 21 || !this.landlord(n)) continue;
      const r = this.rec(n.homeId);
      const price = this.value(n.homeId);
      const sellerOk = r.owner === 'village' || r.forSale || (sim.npcs.byId(r.owner)?.money ?? 999) < 40;
      // Set on owning a home (GoalSystem)? They'll manage with a thinner cushion — and look further.
      const determined = n.goal?.type === 'buy_house';
      const reserve = determined ? GOALS.houseBuyReserve : H.buyReserve;
      if (determined && !(sellerOk && r.owner !== 'player' && n.money >= price * reserve)) {
        const fam = sim.npcs.residentsOf(n.homeId).filter((m) => m === n || n.family.includes(m.id));
        const opt = this.options(fam.length, 0, n.money / reserve, n).find((o) => o.buy);
        if (opt) {
          this.settle(fam, opt, n, 'moved');
          continue;
        }
      }
      if (sellerOk && r.owner !== 'player' && n.money >= price * reserve) {
        n.money -= price;
        this.payTo(r.owner, price);
        this.transfer(n.homeId, n.id, 'bought', price);
        sim.memory.remember(n, 'bought_home', { params: { building: n.homeId, money: price } });
        sim.chronicle('chronicle.npc_bought_home', { npc: n.id, gender: n.gender, building: n.homeId });
      }
    }
    // 5. Owners who stay broke week after week put their home up for sale; if things improve, they take it off.
    for (const n of npcs) n.brokeWeeks = n.money < H.sellBelowMoney ? (n.brokeWeeks || 0) + 1 : 0;
    for (const [id, r] of Object.entries(this.all)) {
      const owner = sim.npcs.byId(r.owner);
      if (owner && this.isHome(id) && owner.brokeWeeks >= 4 && !r.forSale && owner.age >= 18) r.forSale = true;
      else if (owner && r.forSale && owner.homeId === id && owner.money > 80) r.forSale = false;
      // Owners who don't live in a second home let it — if they can keep it up; otherwise it goes on sale.
      if (owner && this.isHome(id) && owner.homeId !== id && this.occupants(id) === 0) {
        if (!r.forSale && !r.forRent && owner.money >= 60) r.forRent = true;
        if (r.emptyDays > (r.forRent ? 42 : 21) || (r.forRent && owner.money < 20)) {
          r.forSale = true;
          r.forRent = false;
        }
      }
    }
    // 6. Villagers with money put it into houses to let (or build them); landlords set their rents by the market.
    this.investInHouses();
    this.landlordsReview();
  }
}
