/**
 * FlatSystem — blocks of flats: several households under one roof, each in a flat of its own.
 *
 * A block of flats is a building of the 'apartment' family (StructureSystem): its level says how
 * many flats it has (3, 4, 6, 8) and how many people it holds; rooms can be added for everyone —
 * a courtyard, a washroom, a cellar, a lift once the village has the know-how, a shop on the
 * ground floor (let to a trader: the owner gets its rent too). A household moving in takes a
 * free flat; each flat has its own tenancy — rent agreed, paid week by week, notice, arrears —
 * and its own past tenants. Everyone living there has the block as their home (npc.homeId) and
 * their flat as npc.flat.
 *
 * Blocks come from building one (you, or villagers building to let once the village is big
 * enough — and the village itself, for people with nowhere to live), or from turning a large
 * house into flats (StructureSystem conversions). A flat lets for less than a house: that's
 * who they're for.
 *
 *   property rec: flats: { [n]: { tenant, since, rent, paid, missed, notice?, next? } }, flatPast: [ … ]
 */
import { FLATS as F, RENTAL as RT, HOUSING as H } from '../data/housing.js';

export class FlatSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  get P() {
    return this.sim.property;
  }

  isBlock(id) {
    return this.sim.structures?.rec(id)?.fam === 'apartment';
  }
  units(id) {
    return this.sim.structures?.units(id) || 1;
  }
  /** People a flat holds. */
  flatCap(id) {
    return Math.max(F.minCap, Math.floor(this.P.capacity(id) / this.units(id)));
  }
  blocks() {
    return this.P.homes().filter((id) => this.isBlock(id));
  }

  /** Which flats are lived in (by villagers — and yours, if you live there). */
  taken(id) {
    const set = new Set();
    for (const n of this.sim.npcs.residentsOf(id)) if (n.flat !== undefined && n.flat !== null) set.add(n.flat);
    const r = this.P.rec(id);
    if (this.sim.state.player.homeId === id && r) set.add(r.playerFlat ?? 0);
    return set;
  }
  free(id) {
    return Math.max(0, this.units(id) - this.taken(id).size);
  }
  freeFlat(id) {
    const t = this.taken(id);
    for (let n = 0; n < this.units(id); n++) if (!t.has(n)) return n;
    return null;
  }
  lease(id, n) {
    return this.P.rec(id)?.flats?.[n] || null;
  }
  /** Tenancies now: [{ n, lease, people }]. */
  leases(id) {
    const r = this.P.rec(id);
    return Object.entries(r?.flats || {}).map(([n, L]) => ({ n: Number(n), lease: L, people: this.sim.npcs.residentsOf(id).filter((x) => x.flat === Number(n)) }));
  }
  /** What the flats let bring in, a week (a buyer pays for that). */
  income(id) {
    return Object.values(this.P.rec(id)?.flats || {}).reduce((s, L) => s + (L.rent || 0), 0) + (this.hasShopFloor(id) ? F.shopFloorRent : 0);
  }
  hasShopFloor(id) {
    return !!this.sim.structures?.rec(id)?.mods?.shop_floor;
  }
  /** The going rent of one flat: the building's, shared out (a flat lets for less than a house). */
  flatRent(buildingRent, id) {
    return Math.max(3, Math.round((buildingRent * F.rentShare) / this.units(id)));
  }

  /** A household moves into a free flat (PropertySystem.moveIn): it's theirs — with a tenancy, if they rent. */
  moveIn(id, npcs) {
    const P = this.P;
    const r = P.rec(id);
    // Your family lives in your flat.
    const p = this.sim.state.player;
    const yours = p.homeId === id && npcs.some((x) => x.id === p.spouse || (p.children || []).includes(x.id));
    const n = yours ? (r?.playerFlat ?? 0) : this.freeFlat(id);
    if (n === null || !r) return null;
    for (const x of npcs) x.flat = n;
    const head = npcs.filter((x) => x.age >= 18).sort((a, b) => b.money - a.money)[0] || npcs[0];
    if (head && P.landlord(head)) {
      r.flats ??= {};
      r.flats[n] = { tenant: head.id, since: this.sim.time.day, rent: P.weeklyRent(id), paid: 0, missed: 0 };
    }
    return n;
  }

  /** A flat's tenancy is over: kept in the block's past tenants. */
  endLease(id, n, how) {
    const r = this.P.rec(id);
    const L = r?.flats?.[n];
    if (!L) return;
    r.tenancies ??= [];
    r.tenancies.push({ tenant: L.tenant, from: L.since, to: this.sim.time.day, paid: L.paid, how, flat: n });
    if (r.tenancies.length > RT.pastTenants * 2) r.tenancies.shift();
    delete r.flats[n];
    this.sim.bus.emit('property:changed', id);
  }

  /**
   * Rent day for a block (PropertySystem.collectRent): each flat pays its own rent, split among the
   * household; a flat that doesn't pay falls behind — and in the end is put out. Returns what was paid.
   */
  collect(id, payers, landlord) {
    const sim = this.sim;
    const P = this.P;
    const r = P.rec(id);
    let total = 0;
    const byFlat = new Map();
    for (const x of payers) {
      const n = x.flat ?? this.moveIn(id, [x]) ?? 0;
      if (!byFlat.has(n)) byFlat.set(n, []);
      byFlat.get(n).push(x);
    }
    for (const [n, people] of byFlat) {
      r.flats ??= {};
      let L = r.flats[n];
      if (!L) {
        const head = people.filter((x) => x.age >= 18).sort((a, b) => b.money - a.money)[0] || people[0];
        L = r.flats[n] = { tenant: head.id, since: sim.time.day, rent: P.weeklyRent(id), paid: 0, missed: 0 };
      }
      if (L.next !== undefined) {
        L.rent = L.next;
        delete L.next;
      }
      if (landlord !== 'player') L.rent = P.weeklyRent(id);
      const share = Math.ceil(L.rent / people.length);
      let paid = 0;
      for (const x of people) {
        const v = Math.min(share, L.rent - paid, Math.max(0, Math.floor(x.money)));
        x.money -= v;
        paid += v;
      }
      L.paid += paid;
      total += paid;
      if (paid < L.rent * 0.7) {
        L.missed++;
        const limit = landlord === 'village' ? H.villageEvictWeeks : H.landlordEvictWeeks;
        if (L.missed >= limit) this.vacateFlat(id, n, 'evicted');
      } else L.missed = 0;
    }
    // The shop on the ground floor pays its rent too.
    if (this.hasShopFloor(id) && byFlat.size && !r.ruined) total += F.shopFloorRent;
    P.payTo(landlord, total);
    return total;
  }

  /** Notice on one flat (you, as landlord — or they're leaving of their own accord). */
  canGiveNotice(id, n, by = 'player') {
    const r = this.P.rec(id);
    const L = r?.flats?.[n];
    if (!r || r.owner !== by) return { ok: false, reason: 'not_yours' };
    if (!L) return { ok: false, reason: 'no_tenant' };
    if (L.notice) return { ok: false, reason: 'notice_given' };
    const cause = L.missed > 0;
    const left = RT.minStayDays - (this.sim.time.day - L.since);
    if (!cause && left > 0) return { ok: false, reason: 'too_soon', params: { n: left } };
    return { ok: true, cause };
  }
  giveNotice(id, n, { by = 'landlord', why = null } = {}) {
    const sim = this.sim;
    const r = this.P.rec(id);
    const L = r?.flats?.[n];
    if (!L || L.notice) return { ok: false, reason: L ? 'notice_given' : 'no_tenant' };
    let cause = L.missed > 0;
    if (by === 'landlord' && r.owner === 'player') {
      const chk = this.canGiveNotice(id, n);
      if (!chk.ok) return chk;
      cause = chk.cause;
      if (!cause) sim.progression.addReputation(-RT.noticeRep);
    }
    L.notice = { by, until: sim.time.day + RT.noticeDays, why: why || (by === 'landlord' ? (cause ? 'arrears' : 'landlord') : 'moving') };
    const tenant = sim.npcs.byId(L.tenant);
    if (tenant && by === 'landlord') sim.memory.remember(tenant, cause ? 'notice_for_arrears' : 'given_notice', { who: r.owner === 'player' ? 'player' : null, params: { building: id } });
    sim.bus.emit('property:changed', id);
    return { ok: true };
  }

  /** A flat emptied: the household goes — to another home if they can find one. */
  vacateFlat(id, n, how = 'notice') {
    const sim = this.sim;
    const P = this.P;
    const L = this.lease(id, n);
    const members = sim.npcs.residentsOf(id).filter((x) => x.flat === n);
    for (const x of members) {
      x.homeId = null;
      x.flat = null;
      if (x.task && ['home', 'sleep', 'rest', 'sick'].includes(x.task.type)) x.task = null;
      x.evictedFrom ??= {};
      x.evictedFrom[id] = sim.time.day;
    }
    sim.npcs.invalidateHouseholds();
    this.endLease(id, n, how);
    const head = members.find((m) => m.id === L?.tenant) || members.find((m) => m.age >= 18) || members[0];
    if (head) {
      const opt = P.options(members.length, P.householdBudget(head) * 1.1, head.money / H.buyReserve, head)[0];
      if (opt) P.settle(members, opt, head, 'moved');
      else for (const x of members) P.findRoof(x);
      sim.chronicle('chronicle.tenants_left', { npc: head.id, gender: head.gender, building: id, n: members.length });
    }
    sim.bus.emit('building:changed', id);
  }

  /** Every day: notices running out, households gone of their own accord, tenants who died or left. */
  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    for (const id of this.blocks()) {
      const r = this.P.rec(id);
      for (const { n, lease: L, people } of this.leases(id)) {
        if (L.notice && day >= L.notice.until) this.vacateFlat(id, n, L.notice.by === 'tenant' ? 'moved_out' : 'notice');
        else if (!people.length) this.endLease(id, n, 'left');
        else if (!sim.npcs.byId(L.tenant)) L.tenant = people.find((x) => x.age >= 18)?.id || people[0].id;
      }
      // People living there without a flat (moved in before it was a block, or with a relative): they share one.
      for (const x of sim.npcs.residentsOf(id)) if (x.flat === undefined || x.flat === null) x.flat = this.flatOfKin(id, x) ?? this.freeFlat(id) ?? 0;
      if (r && sim.state.player.homeId !== id) delete r.playerFlat;
    }
  }

  /** The flat of someone in their family living in the same block. */
  flatOfKin(id, x) {
    const kin = this.sim.npcs.residentsOf(id).find((o) => o !== x && o.flat !== undefined && o.flat !== null && (x.family || []).includes(o.id));
    return kin ? kin.flat : null;
  }

  /** You move into a flat of a block of yours. */
  playerMoveIn(id) {
    const r = this.P.rec(id);
    const n = this.freeFlat(id);
    if (n === null || !r) return false;
    r.playerFlat = n;
    return true;
  }
}
