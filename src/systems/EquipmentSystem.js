/**
 * EquipmentSystem — baskets, barrows, carts, wagons and horses: things that help move goods.
 *
 * Each piece is a real thing in the world with its own id — never a stack in a pocket:
 *
 *   state.equipment = { nextId, items: [eq…], log: [] }
 *   eq = { id, type, owner: 'player', level, condition, trips, units,
 *          holder: null | { kind: 'player' } | { kind: 'worker', id } | { kind: 'building', id },   ← who it's given to
 *          at: { kind: 'ground', tx, ty } | { kind: 'npc', id } | { kind: 'player' },               ← where it physically is
 *          home?, cargo?: { item, qty, items, …}, recall?, repairUntil? }
 *
 * Where it is and who it's given to are separate: a wheelbarrow you lent Ivan stands where he
 * left it last night; in the morning he walks over, takes it, loads it at your warehouse, pushes
 * it to the site, unloads, and back. It never teleports — it's on the ground, in someone's hands,
 * or with you. Its load stays in it when it's left (a parked cart keeps what's in it).
 *
 * What it does is real: a worker carries its capacity instead of an armful (20), and moves at its
 * speed — faster on roads, slower over grass for anything with wheels. It wears with every load,
 * and the wear is part of what a job cost you. Worn out, it holds less and goes slower; broken,
 * it's no use until it's repaired.
 */
import { EQUIPMENT, EQUIP, conditionBand } from '../data/transport.js';
import { ITEMS } from '../data/items.js';
import { BUILDABLES } from '../data/buildables.js';
import { INDUSTRY } from './IndustrySystem.js';

export const EQUIP_STATUS = ['available', 'assigned_player', 'assigned_worker', 'assigned_building', 'in_use', 'damaged', 'broken', 'under_repair'];

export class EquipmentSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.equipment ??= { nextId: 1, items: [], log: [] };
    sim.bus.on('time:hour', () => this.hourly());
    sim.bus.on('npc:removed', (id) => this.releaseWorker(id));
    this.migrate();
  }

  get S() {
    return this.sim.state.equipment;
  }
  list() {
    return this.S.items;
  }
  byId(id) {
    return this.S.items.find((e) => e.id === id) || null;
  }
  def(eq) {
    return EQUIPMENT[typeof eq === 'string' ? eq : eq?.type] || null;
  }
  mine() {
    return this.S.items.filter((e) => e.owner === 'player');
  }

  /** Old saves: a handcart or horse bought for journeys (before equipment existed) becomes a real one, in your yard. */
  migrate() {
    const p = this.sim.state.player;
    const kind = p.transport;
    if (!kind || kind === 'foot' || this.S.migrated) return;
    this.S.migrated = true;
    const type = Object.keys(EQUIPMENT).find((k) => EQUIPMENT[k].journey === kind);
    if (type && !this.mine().some((e) => e.type === type)) this.create(type, { at: this.yardSpot(null) });
  }

  // ------------------------------------------------------------------ making one

  /** A new piece (bought, made, found): parked where it's given, or in your hands. */
  create(type, { owner = 'player', at = null, level = 1, condition = 100 } = {}) {
    if (!EQUIPMENT[type]) return null;
    const spot = at || this.yardSpot(null);
    const eq = { id: `eq${this.S.nextId++}`, type, owner, level, condition, trips: 0, units: 0, holder: null, at: spot.kind ? spot : { kind: 'ground', tx: spot.tx, ty: spot.ty }, since: this.sim.time.day };
    this.S.items.push(eq);
    this.changed();
    return eq;
  }

  remove(id) {
    const eq = this.byId(id);
    if (!eq) return;
    if (eq.at.kind === 'npc') this.clearHands(eq.at.id);
    if (eq.at.kind === 'player') delete this.sim.state.player.eq;
    this.S.items.splice(this.S.items.indexOf(eq), 1);
    this.changed();
  }

  changed() {
    this.sim.bus.emit('equipment:changed');
  }

  // ------------------------------------------------------------------ what it can do

  /** Holds this much (units a trip): more for a better-made one, less when it's worn out; nothing broken. */
  cap(eq) {
    const d = this.def(eq);
    if (!d || this.broken(eq)) return 0;
    let c = d.cap * (1 + EQUIP.levelCap * ((eq.level || 1) - 1));
    if (this.damaged(eq)) c *= EQUIP.damagedCap;
    return Math.floor(c);
  }
  damaged(eq) {
    return eq.condition < EQUIP.damagedBelow;
  }
  broken(eq) {
    return eq.condition <= 0;
  }
  underRepair(eq) {
    return (eq.repairUntil || 0) > this.sim.time.total;
  }
  usable(eq) {
    return !!eq && !this.broken(eq) && !this.underRepair(eq);
  }

  /**
   * Movement with it (× walking speed): wheels are quick on a road (quicker on cobbles) and slow
   * over grass — and in the rain the grass and dirt turn to mud (IndustrySystem INDUSTRY.mudOffroad).
   */
  moveMult(eq, onRoad, paved = false) {
    const d = this.def(eq);
    if (!d) return 1;
    let m = (onRoad ? d.road : d.offroad) * (this.damaged(eq) ? EQUIP.damagedSpeed : 1);
    if (d.kind === 'hand') return m;
    if (onRoad && paved) m *= INDUSTRY.pavedWheels;
    if (!onRoad && this.muddy()) m *= INDUSTRY.mudOffroad;
    return m;
  }
  /** Rain, storm or snow: the ground off the roads is mud. */
  muddy() {
    return ['rain', 'storm', 'snow'].includes(this.sim.weather?.type);
  }
  /** For the movement code (every frame): what this villager is pushing, if anything. */
  moveMultFor(npc, onRoad, paved = false) {
    const eq = npc.eq && this.byId(npc.eq);
    return eq ? this.moveMult(eq, onRoad, paved) : 1;
  }
  playerMoveMult(onRoad, paved = false) {
    const eq = this.playerHeld();
    return eq ? this.moveMult(eq, onRoad, paved) : 1;
  }

  /** How much more a trip moves than carrying by hand (the "transport efficiency" shown). */
  efficiency(eq, byHand = 20) {
    const d = this.def(eq);
    return Math.round(((this.cap(eq) / byHand) * ((d.road + d.offroad) / 2)) * 100) / 100;
  }

  /** Its state, in one word: under repair · broken · damaged · in use · with a worker · with you · kept at a building · available. */
  status(eq) {
    if (this.underRepair(eq)) return 'under_repair';
    if (this.broken(eq)) return 'broken';
    if (this.damaged(eq)) return 'damaged';
    if (eq.at.kind === 'npc' || eq.at.kind === 'player') return 'in_use';
    if (eq.holder?.kind === 'worker') return 'assigned_worker';
    if (eq.holder?.kind === 'player') return 'assigned_player';
    if (eq.holder?.kind === 'building') return 'assigned_building';
    return 'available';
  }
  band(eq) {
    return conditionBand(eq.condition);
  }

  // ------------------------------------------------------------------ where it is

  /** Its tile (on the ground, or under whoever has it). */
  tile(eq) {
    if (eq.at.kind === 'ground') return { tx: eq.at.tx, ty: eq.at.ty };
    if (eq.at.kind === 'npc') {
      const n = this.sim.npcs.byId(eq.at.id);
      if (n) return this.sim.world.toTile(n.x, n.y);
    }
    const p = this.sim.state.player;
    return this.sim.world.toTile(p.x, p.y);
  }

  /** Parked on the ground near a tile. */
  parkedNear(tx, ty, r = 2) {
    return this.S.items.filter((e) => e.at.kind === 'ground' && Math.abs(e.at.tx - tx) <= r && Math.abs(e.at.ty - ty) <= r);
  }

  /** What you're pushing or carrying right now. */
  playerHeld() {
    const id = this.sim.state.player.eq;
    const eq = id && this.byId(id);
    return eq && eq.at.kind === 'player' ? eq : null;
  }
  /** What this villager has in their hands right now. */
  using(npc) {
    const eq = npc?.eq && this.byId(npc.eq);
    return eq && eq.at.kind === 'npc' && eq.at.id === npc.id ? eq : null;
  }
  /** What's been given to this worker (in their hands or not). */
  assignedTo(npcId) {
    return this.S.items.find((e) => e.holder?.kind === 'worker' && e.holder.id === npcId) || null;
  }

  /** Your transport depots (finished). */
  depots() {
    return this.sim.construction.finished().filter((c) => BUILDABLES[c.type]?.effect?.depot).map((c) => c.id);
  }

  /** Where a piece is kept: its home (a depot, a building you keep it at), your depot, or your storage yard. */
  yard(eq) {
    const home = eq?.holder?.kind === 'building' ? eq.holder.id : eq?.home;
    if (home && this.sim.world.buildings[home]) return home;
    return this.depots()[0] || this.sim.workers.baseBuilding().id;
  }
  /** A free parking place at the yard. */
  yardSpot(eq, near = null) {
    const id = this.yard(eq);
    const s = this.sim.points?.parkAt(id, near) || this.sim.world.nearestWalkable(this.sim.world.buildings[id].door.tx, this.sim.world.buildings[id].door.ty + 1, 4);
    return { kind: 'ground', tx: s.tx, ty: s.ty };
  }

  /** Put it down on this tile (it stays there — with whatever's in it). */
  park(eq, tx, ty) {
    if (eq.at.kind === 'npc') this.clearHands(eq.at.id);
    if (eq.at.kind === 'player') delete this.sim.state.player.eq;
    const s = this.sim.world.nearestWalkable(tx, ty, 3);
    eq.at = { kind: 'ground', tx: s.tx, ty: s.ty };
    this.changed();
  }
  clearHands(npcId) {
    const n = this.sim.npcs.byId(npcId);
    if (n) delete n.eq;
  }

  /** A worker takes it in hand (it's where they're standing). A load left in it goes on with them. */
  pickUp(eq, npc) {
    const here = this.sim.world.toTile(npc.x, npc.y);
    if (eq.at.kind !== 'ground' || Math.abs(eq.at.tx - here.tx) > 2 || Math.abs(eq.at.ty - here.ty) > 2) return false;
    eq.at = { kind: 'npc', id: npc.id };
    npc.eq = eq.id;
    if (eq.cargo && !npc.carry) {
      npc.carry = eq.cargo;
      delete eq.cargo;
    }
    this.changed();
    return true;
  }

  /**
   * A worker's day is over (or they're leaving): they leave it where they stand — with what's in it.
   * (Tomorrow they walk over and take it again.)
   */
  leaveWith(npc) {
    const eq = this.using(npc);
    if (!eq) return null;
    if (npc.carry) {
      eq.cargo = npc.carry;
      npc.carry = null;
    }
    const t = this.sim.world.toTile(npc.x, npc.y);
    this.park(eq, t.tx, t.ty);
    return eq;
  }

  /** A worker leaves you (fired, quit, gone): what you'd lent them stays where it is, back in your hands to give. */
  releaseWorker(npcId) {
    for (const eq of this.S.items) {
      if (eq.at.kind === 'npc' && eq.at.id === npcId) {
        const n = this.sim.npcs.byId(npcId);
        if (n) this.leaveWith(n);
        else eq.at = this.yardSpot(eq); // (gone from the world: it's found in your yard)
      }
      if (eq.holder?.kind === 'worker' && eq.holder.id === npcId) {
        eq.holder = null;
        delete eq.recall;
      }
    }
    this.changed();
  }

  // ------------------------------------------------------------------ you, with it

  canTake(id) {
    const eq = this.byId(id);
    if (!eq) return { ok: false, reason: 'nothing_here' };
    if (eq.owner !== 'player') return { ok: false, reason: 'not_yours' };
    if (eq.at.kind !== 'ground') return { ok: false, reason: 'eq_in_use' };
    if (!this.usable(eq)) return { ok: false, reason: this.underRepair(eq) ? 'eq_under_repair' : 'eq_broken' };
    if (this.playerHeld()) return { ok: false, reason: 'eq_hands_full' };
    const lvl = this.def(eq).minLevel || 0;
    if (this.sim.state.player.level < lvl) return { ok: false, reason: 'need_level', params: { level: lvl } };
    const p = this.sim.world.toTile(this.sim.state.player.x, this.sim.state.player.y);
    if (Math.abs(p.tx - eq.at.tx) > 2 || Math.abs(p.ty - eq.at.ty) > 2) return { ok: false, reason: 'too_far' };
    return { ok: true };
  }

  /** You take it (a barrow to push, a wagon to drive). If it was lent out, it's yours to use again. */
  take(id) {
    const chk = this.canTake(id);
    if (!chk.ok) return chk;
    const eq = this.byId(id);
    eq.at = { kind: 'player' };
    if (eq.holder?.kind === 'worker') eq.holder = null;
    delete eq.recall;
    this.sim.state.player.eq = eq.id;
    this.changed();
    return { ok: true };
  }

  /** You leave it here (in front of you). */
  putDown() {
    const eq = this.playerHeld();
    if (!eq) return { ok: false };
    const p = this.sim.state.player;
    const t = this.sim.world.toTile(p.x, p.y);
    this.park(eq, t.tx, t.ty);
    return { ok: true };
  }

  /** What's in it (your cargo while you push it). */
  load(eq) {
    const c = eq.cargo;
    if (!c) return 0;
    return Object.values(c.items || { [c.item]: c.qty }).reduce((a, b) => a + b, 0);
  }
  room(eq) {
    return Math.max(0, this.cap(eq) - this.load(eq));
  }
  addCargo(eq, item, qty) {
    const items = { ...(eq.cargo?.items || (eq.cargo ? { [eq.cargo.item]: eq.cargo.qty } : {})) };
    items[item] = (items[item] || 0) + qty;
    const total = Object.values(items).reduce((a, b) => a + b, 0);
    eq.cargo = { item: Object.keys(items)[0], qty: total, items };
  }
  takeCargo(eq, item, qty) {
    if (!eq.cargo) return 0;
    const items = { ...(eq.cargo.items || { [eq.cargo.item]: eq.cargo.qty }) };
    const n = Math.min(qty, items[item] || 0);
    items[item] -= n;
    if (items[item] <= 0) delete items[item];
    const total = Object.values(items).reduce((a, b) => a + b, 0);
    eq.cargo = total ? { item: Object.keys(items)[0], qty: total, items } : null;
    if (!eq.cargo) delete eq.cargo;
    return n;
  }

  /**
   * At your storage: load what your building sites (and the jobs you're supplying) still need,
   * up to what it holds. Or name an item and an amount. Returns units loaded.
   */
  loadFromStorage(item = null, qty = Infinity) {
    const eq = this.playerHeld();
    if (!eq) return 0;
    const home = this.sim.home;
    let loaded = 0;
    const put = (id, want) => {
      const n = home.take(id, Math.min(want, this.room(eq)));
      if (n > 0) {
        this.addCargo(eq, id, n);
        loaded += n;
      }
    };
    if (item) put(item, qty);
    else {
      for (const site of this.sitesToSupply()) {
        for (const [id, need] of Object.entries(this.sim.construction.missing(site))) {
          const already = eq.cargo?.items?.[id] || 0;
          if (need > already) put(id, need - already);
          if (this.room(eq) <= 0) break;
        }
        if (this.room(eq) <= 0) break;
      }
    }
    if (loaded) this.changed();
    return loaded;
  }

  /** Sites you're responsible for supplying: your own, and those you're supplying for a client. */
  sitesToSupply() {
    const C = this.sim.construction;
    return C.sites().filter((s) => C.isPlayers(s) || s.supplier === 'player');
  }

  /** Can you unload into this site? (You're pushing something with what it needs.) */
  canUnloadAt(site) {
    const eq = this.playerHeld();
    if (!eq || !eq.cargo || !site || site.status !== 'site') return false;
    const missing = this.sim.construction.missing(site);
    return Object.keys(eq.cargo.items || {}).some((id) => (missing[id] || 0) > 0);
  }

  /** Unload into a site: what it needs goes in; the rest stays in the barrow. Returns units unloaded. */
  unloadAt(site) {
    const eq = this.playerHeld();
    if (!eq || !eq.cargo) return 0;
    const C = this.sim.construction;
    let total = 0;
    for (const [id, need] of Object.entries(C.missing(site))) {
      const n = this.takeCargo(eq, id, need);
      if (n > 0) {
        C.receive(site, id, n);
        total += n;
      }
    }
    if (total) {
      if (!C.isPlayers(site)) this.sim.growth?.playerHelped?.(site);
      this.wear(eq, total / Math.max(1, this.cap(eq)), this.sim.contracts?.S.active.find((c) => c.siteId === site.id) || null);
      this.changed();
    }
    return total;
  }

  /** Unload everything into your storage. */
  unloadToStorage() {
    const eq = this.playerHeld();
    if (!eq?.cargo) return 0;
    let total = 0;
    for (const [id, q] of Object.entries(eq.cargo.items || {})) {
      const n = this.sim.home.store(id, q, { force: true });
      this.takeCargo(eq, id, n);
      total += n;
    }
    this.changed();
    return total;
  }

  // ------------------------------------------------------------------ lending to your workers

  canLend(id, npcId) {
    const eq = this.byId(id);
    const W = this.sim.workers;
    const npc = this.sim.npcs.byId(npcId);
    if (!eq || !npc) return { ok: false, reason: 'nothing_here' };
    if (!W.contract(npcId)) return { ok: false, reason: 'not_your_worker' };
    if (eq.owner !== 'player') return { ok: false, reason: 'not_yours' };
    if (eq.holder?.kind === 'worker' && eq.holder.id === npcId) return { ok: false, reason: 'eq_has_it' };
    if (eq.holder?.kind === 'worker') return { ok: false, reason: 'eq_lent', params: { npc: eq.holder.id } };
    if (!this.usable(eq)) return { ok: false, reason: this.underRepair(eq) ? 'eq_under_repair' : 'eq_broken' };
    const lvl = this.def(eq).minLevel || 0;
    if (npc.level < lvl) return { ok: false, reason: 'eq_worker_level', params: { level: lvl } };
    return { ok: true };
  }

  /**
   * Lend it to a worker: it's theirs to use until you take it back. Handed over there and then
   * if you're pushing it and they're beside you; otherwise they fetch it from where it stands.
   * (Anything they had before goes back to where it's kept.)
   */
  lend(id, npcId) {
    const chk = this.canLend(id, npcId);
    if (!chk.ok) return chk;
    const eq = this.byId(id);
    const npc = this.sim.npcs.byId(npcId);
    const before = this.assignedTo(npcId);
    if (before && before !== eq) this.retrieve(before.id);
    eq.holder = { kind: 'worker', id: npcId };
    delete eq.recall;
    if (eq.at.kind === 'player') {
      const p = this.sim.state.player;
      const near = Math.hypot(p.x - npc.x, p.y - npc.y) < 96 && !npc.inside;
      if (near && !this.using(npc)) {
        eq.at = { kind: 'npc', id: npc.id };
        npc.eq = eq.id;
        delete p.eq;
        if (eq.cargo && !npc.carry) {
          npc.carry = eq.cargo;
          delete eq.cargo;
        }
      } else this.putDown();
    }
    this.log('lent', eq, npcId);
    this.sim.workers.equipmentChanged?.(npcId);
    this.changed();
    return { ok: true };
  }

  /**
   * Take it back. A worker using it finishes what's in hand, takes it back to its yard and leaves
   * it there (RETURN_EQUIPMENT); if they're not using it, it's simply yours again where it stands.
   */
  retrieve(id) {
    const eq = this.byId(id);
    if (!eq || eq.holder?.kind !== 'worker') return { ok: false, reason: 'eq_not_lent' };
    const npcId = eq.holder.id;
    const npc = this.sim.npcs.byId(npcId);
    if (eq.at.kind === 'npc' && npc?.task?.type === 'work') {
      eq.recall = this.sim.time.total;
      this.sim.workers.equipmentChanged?.(npcId);
      this.changed();
      return { ok: true, returning: true };
    }
    if (eq.at.kind === 'npc' && npc) this.leaveWith(npc);
    eq.holder = null;
    delete eq.recall;
    this.log('back', eq, npcId);
    this.changed();
    return { ok: true, returning: false };
  }

  /** The worker brought it back to the yard. */
  returned(eq, npc) {
    const t = this.sim.world.toTile(npc.x, npc.y);
    this.leaveWith(npc);
    if (eq.at.kind !== 'ground') this.park(eq, t.tx, t.ty);
    eq.holder = null;
    delete eq.recall;
    this.log('back', eq, npc.id);
    this.sim.toast('toast.eq_returned', { npc: npc.id, eq: eq.type }, 'info');
    this.changed();
  }

  /** Keep it at a building of yours (a depot, a warehouse): that's where it's parked and where it's returned. */
  keepAt(id, buildingId) {
    const eq = this.byId(id);
    if (!eq) return;
    if (buildingId) eq.home = buildingId;
    else delete eq.home;
    if (eq.holder?.kind === 'building') eq.holder = buildingId ? { kind: 'building', id: buildingId } : null;
    this.changed();
  }

  // ------------------------------------------------------------------ wear, repairs, better ones

  /**
   * A load carried: it wears (the more it carried, the more). The wear is money — booked to the
   * job it was carried for.
   */
  wear(eq, fraction = 1, job = null) {
    const d = this.def(eq);
    if (!d) return;
    const pts = d.wear * Math.max(0.2, Math.min(1, fraction)) * (1 - EQUIP.levelWear * ((eq.level || 1) - 1));
    const was = eq.condition;
    eq.condition = Math.max(0, Math.round((eq.condition - pts) * 100) / 100);
    eq.trips = (eq.trips || 0) + 1;
    eq.units = (eq.units || 0) + Math.round(fraction * this.cap({ ...eq, condition: was }));
    const cost = (pts / 100) * d.price * EQUIP.upkeepShare;
    if (job) this.sim.contracts.addCost(job, 'equipment', cost);
    this.S.wearCost = Math.round(((this.S.wearCost || 0) + cost) * 100) / 100;
    if (was >= EQUIP.damagedBelow && eq.condition < EQUIP.damagedBelow) this.sim.toast('toast.eq_damaged', { eq: eq.type }, 'warn');
    if (was > 0 && eq.condition <= 0) this.sim.toast('toast.eq_broken', { eq: eq.type }, 'danger');
  }

  /** Cost to repair: money, and planks from your storage. Hours: faster with a depot's repair bay. */
  repairCost(eq) {
    const d = this.def(eq);
    const missing = 100 - eq.condition;
    const depot = this.depots()[0];
    const lvl = depot ? this.sim.structures?.rec(depot)?.lvl || 1 : 0;
    return { money: Math.ceil(d.price * EQUIP.repairMoneyShare * (missing / 100)), planks: Math.ceil(missing / EQUIP.repairPlanksPer), hours: Math.max(1, Math.round(EQUIP.repairHours * (missing / 100) * (lvl >= 2 ? 0.5 : lvl ? 0.75 : 1))) };
  }
  canRepair(id) {
    const eq = this.byId(id);
    if (!eq) return { ok: false, reason: 'nothing_here' };
    if (eq.condition >= 99) return { ok: false, reason: 'eq_fine' };
    if (this.underRepair(eq)) return { ok: false, reason: 'eq_under_repair' };
    if (eq.at.kind !== 'ground') return { ok: false, reason: 'eq_in_use' };
    const cost = this.repairCost(eq);
    if (this.sim.state.player.money < cost.money) return { ok: false, reason: 'no_money', params: { money: cost.money } };
    if (this.sim.home.storageCount('planks') < cost.planks) return { ok: false, reason: 'eq_need_planks', params: { n: cost.planks } };
    return { ok: true, cost };
  }
  /** Repair it: it's out of use for a few hours, then as good as new. */
  repair(id) {
    const chk = this.canRepair(id);
    if (!chk.ok) return chk;
    const eq = this.byId(id);
    this.sim.state.player.money -= chk.cost.money;
    this.sim.home.take('planks', chk.cost.planks);
    eq.repairUntil = this.sim.time.total + chk.cost.hours * 60;
    eq.repairTo = 100;
    this.log('repair', eq);
    this.changed();
    return { ok: true, ...chk.cost };
  }

  upgradeCost(eq) {
    return { money: Math.round(this.def(eq).price * EQUIP.upgradeShare * (eq.level || 1)), planks: 4 * (eq.level || 1), iron_ingot: eq.level >= 2 ? 1 : 0 };
  }
  canUpgrade(id) {
    const eq = this.byId(id);
    if (!eq) return { ok: false, reason: 'nothing_here' };
    if ((eq.level || 1) >= EQUIP.maxLevel) return { ok: false, reason: 'max_level' };
    if (eq.at.kind !== 'ground' || this.underRepair(eq)) return { ok: false, reason: 'eq_in_use' };
    const c = this.upgradeCost(eq);
    if (this.sim.state.player.money < c.money) return { ok: false, reason: 'no_money', params: { money: c.money } };
    if (this.sim.home.storageCount('planks') < c.planks) return { ok: false, reason: 'eq_need_planks', params: { n: c.planks } };
    if (c.iron_ingot && this.sim.home.storageCount('iron_ingot') < c.iron_ingot) return { ok: false, reason: 'eq_need_iron' };
    return { ok: true, cost: c };
  }
  /** Better made: holds more, lasts longer (a few hours in the workshop — it's out of use meanwhile). */
  upgrade(id) {
    const chk = this.canUpgrade(id);
    if (!chk.ok) return chk;
    const eq = this.byId(id);
    this.sim.state.player.money -= chk.cost.money;
    this.sim.home.take('planks', chk.cost.planks);
    if (chk.cost.iron_ingot) this.sim.home.take('iron_ingot', chk.cost.iron_ingot);
    eq.level = (eq.level || 1) + 1;
    eq.repairUntil = this.sim.time.total + 3 * 60;
    eq.repairTo = 100;
    this.log('upgrade', eq);
    this.changed();
    return { ok: true };
  }

  hourly() {
    const now = this.sim.time.total;
    for (const eq of this.S.items) {
      // Repairs finished.
      if (eq.repairTo && (eq.repairUntil || 0) <= now) {
        eq.condition = eq.repairTo;
        delete eq.repairTo;
        delete eq.repairUntil;
        this.sim.toast('toast.eq_repaired', { eq: eq.type }, 'good');
        this.changed();
      }
      // Asked back, and too long about it: they leave it where they are (and it's yours again).
      if (eq.recall && now - eq.recall > EQUIP.returnTimeout) {
        const n = eq.at.kind === 'npc' && this.sim.npcs.byId(eq.at.id);
        if (n) this.leaveWith(n);
        eq.holder = null;
        delete eq.recall;
        this.changed();
      }
    }
  }

  // ------------------------------------------------------------------ buying and making

  /** What this business sells (and you could have now). */
  forSale(bizId) {
    const E = this.sim.economy;
    const type = E.def(bizId)?.type;
    return Object.entries(EQUIPMENT)
      .filter(([, d]) => !d.future && d.soldBy.includes(type))
      .map(([k, d]) => ({ type: k, price: this.price(k, bizId), ok: !d.needs || !!this.sim.tech?.has(d.needs), needs: d.needs }));
  }
  sellers() {
    const E = this.sim.economy;
    return E.active().filter((id) => this.forSale(id).length);
  }
  price(type, bizId = null) {
    const d = EQUIPMENT[type];
    const f = bizId ? this.sim.economy.priceFactor?.(bizId, 'planks') || 1 : 1;
    return Math.round(d.price * Math.max(0.8, Math.min(1.3, f)));
  }
  canBuy(type, bizId) {
    const d = EQUIPMENT[type];
    if (!d || d.future) return { ok: false, reason: 'nothing_here' };
    if (!d.soldBy.includes(this.sim.economy.def(bizId)?.type)) return { ok: false, reason: 'not_sold_here' };
    if (d.needs && !this.sim.tech?.has(d.needs)) return { ok: false, reason: 'needs_tech', params: { tech: d.needs } };
    const price = this.price(type, bizId);
    if (this.sim.state.player.money < price) return { ok: false, reason: 'no_money', params: { money: price } };
    return { ok: true, price };
  }
  /**
   * Buy one: the seller gets the money, and it's yours — a basket in your hands (if they're free),
   * anything bigger left for you in front of the shop.
   */
  buy(type, bizId) {
    const chk = this.canBuy(type, bizId);
    if (!chk.ok) return chk;
    const E = this.sim.economy;
    this.sim.state.player.money -= chk.price;
    E.biz(bizId).money += chk.price;
    E.ledger(bizId, 'rev', chk.price);
    const b = this.sim.world.buildings[E.biz(bizId).building];
    let eq;
    if (EQUIPMENT[type].kind === 'hand' && !this.playerHeld()) {
      eq = this.create(type, { at: { kind: 'player' } });
      this.sim.state.player.eq = eq.id;
    } else {
      const s = (b && this.sim.points?.parkAt(b.id)) || this.yardSpot(null);
      eq = this.create(type, { at: { kind: 'ground', tx: s.tx, ty: s.ty } });
    }
    this.log('bought', eq);
    this.syncJourney();
    this.sim.chronicle('chronicle.eq_bought', { eq: type });
    return { ok: true, id: eq.id, price: chk.price };
  }

  /** Made at your workbench (CraftingSystem): it stands outside your door. */
  made(type, q = null) {
    const p = this.sim.state.player;
    const t = this.sim.world.toTile(p.x, p.y);
    const eq = this.create(type, { at: { kind: 'ground', ...this.sim.world.nearestWalkable(t.tx, t.ty + 1, 3) }, level: q >= 3 ? 3 : q >= 2 ? 2 : 1 });
    this.log('made', eq);
    this.syncJourney();
    return eq;
  }

  // ------------------------------------------------------------------ trade journeys (SettlementSystem)

  /** The best of yours that can go on a journey (not lent out, not broken). */
  journeyKind() {
    const order = ['foot', 'handcart', 'pack_horse', 'horse_cart', 'wagon'];
    let best = 'foot';
    for (const eq of this.mine()) {
      const j = this.def(eq)?.journey;
      if (!j || !this.usable(eq) || eq.holder?.kind === 'worker') continue;
      if (order.indexOf(j) > order.indexOf(best)) best = j;
    }
    return best;
  }
  /** Keep the old journey-transport field in step with what you really own. */
  syncJourney() {
    this.sim.state.player.transport = this.journeyKind();
  }

  // ------------------------------------------------------------------ the depot

  /** What's at a depot (or any yard): parked there, and what belongs there but is out. */
  atYard(buildingId) {
    const pts = this.sim.points?.list(buildingId, 'park') || [];
    const b = this.sim.world.buildings[buildingId];
    const near = (e) => e.at.kind === 'ground' && (pts.some((p) => p.tx === e.at.tx && p.ty === e.at.ty) || (b && e.at.tx >= b.tx - 2 && e.at.tx <= b.tx + b.w + 1 && e.at.ty >= b.ty - 1 && e.at.ty <= b.ty + b.h + 4));
    const here = this.mine().filter(near);
    const out = this.mine().filter((e) => !near(e) && this.yard(e) === buildingId);
    return { here, out, parking: pts.length, free: pts.filter((p) => !this.S.items.some((e) => e.at.kind === 'ground' && e.at.tx === p.tx && e.at.ty === p.ty)).length };
  }

  /** Money your equipment has cost in wear so far. */
  totalWear() {
    return Math.round(this.S.wearCost || 0);
  }

  /** Everything about one piece, for the card. */
  info(eq) {
    const d = this.def(eq);
    const W = this.sim.workers;
    const holder = eq.holder?.kind === 'worker' ? eq.holder.id : null;
    const user = eq.at.kind === 'npc' ? eq.at.id : eq.at.kind === 'player' ? 'player' : null;
    return {
      id: eq.id, type: eq.type, level: eq.level || 1, owner: eq.owner, status: this.status(eq), band: this.band(eq),
      condition: Math.round(eq.condition), cap: this.cap(eq), road: d.road, offroad: d.offroad, efficiency: this.efficiency(eq, W ? 20 : 20),
      holder, user, where: eq.at.kind === 'ground' ? this.whereName(eq) : null, cargo: eq.cargo ? { ...eq.cargo.items } : null,
      recall: !!eq.recall, trips: eq.trips || 0, units: eq.units || 0, minLevel: d.minLevel || 0, kind: d.kind, tier: d.tier,
    };
  }
  /** The nearest building to where it stands (for "at the warehouse"). */
  whereName(eq) {
    let best = null;
    let bd = 8;
    for (const b of this.sim.world.buildingList) {
      const d = Math.abs(b.door.tx - eq.at.tx) + Math.abs(b.door.ty - eq.at.ty);
      if (d < bd) {
        bd = d;
        best = b.id;
      }
    }
    if (best) return best;
    const s = this.sim.construction.sites().find((c) => eq.at.tx >= c.tx - 2 && eq.at.tx <= c.tx + c.w + 1 && eq.at.ty >= c.ty - 2 && eq.at.ty <= c.ty + c.h + 2);
    return s ? `site:${s.id}` : null;
  }

  log(what, eq, npc = null) {
    this.S.log.unshift({ day: this.sim.time.day, what, eq: eq.id, type: eq.type, npc });
    this.S.log.length = Math.min(this.S.log.length, 30);
  }
}

/** Value of goods (for the load line). */
export function cargoValue(items) {
  let v = 0;
  for (const [id, q] of Object.entries(items || {})) v += q * (ITEMS[id]?.basePrice || 3);
  return v;
}
