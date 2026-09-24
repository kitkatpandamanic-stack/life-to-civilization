/**
 * FamilySystem — kinship, and the cycle of life.
 *
 *   npc.kin = { spouse, parents: [], children: [], siblings: [] }
 *   npc.surnameIdx — families share a surname (index into the locale list)
 *   npc.family     — everyone this NPC counts as close family (kept in sync,
 *                    used all over for quick "is this family?" checks)
 *   npc.partner    — who they're courting
 *
 * Villagers fall in love with people they're close to, marry and set up a
 * home, have children when there's room and money, grow old, retire, and die.
 * What they leave behind — money, a house, a business — passes to their family,
 * or to a worker, or back to the village. Everyone who ever lived is kept in
 * state.graveyard, so their names live on in family trees and memories.
 */
import { NPC_ROSTER, LOOK_PALETTE } from '../data/npcs.js';
import { OCCUPATIONS } from '../data/occupations.js';
import { TRAITS } from '../data/traits.js';
import { BALANCE } from '../config/balance.js';
import { hashStr, rand } from '../core/rng.js';

export const LIFE = {
  courtFriendship: 50, // both need to like each other this much to start courting…
  courtTrust: 14,
  courtChance: 0.3, // …checked weekly
  marryFriendship: 62,
  marryAfterDays: 14, // courting at least this long
  marryChance: 0.45, // per week once ready
  maxAgeGap: 16,
  fertileFrom: 18,
  fertileTo: 42,
  birthChancePerSeason: 0.22, // for a couple with room at home; each child they already have lowers it
  minHouseholdMoney: 30,
  retireAge: [60, 68],
  deathChanceByAge: [[60, 0.004], [70, 0.03], [80, 0.1], [90, 0.25], [200, 0.5]], // per year
  maxNameTries: 12,
};

export class FamilySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.graveyard ??= [];
    for (const npc of sim.state.npcs) this.normalize(npc);
    for (const npc of sim.state.npcs) this.syncFamily(npc);
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:season', () => this.onSeason());
  }

  /** Fill in kin links and life data for villagers from older saves. */
  normalize(npc) {
    if (!npc.kin) {
      const r = NPC_ROSTER.find((x) => x.key === npc.id);
      npc.kin = { spouse: null, parents: [], children: [], siblings: [], ...(r?.kin ? JSON.parse(JSON.stringify(r.kin)) : {}) };
      if (npc.surnameIdx === undefined) npc.surnameIdx = r?.surname ?? 0;
    }
    npc.kin.spouse ??= null;
    npc.kin.parents ??= [];
    npc.kin.children ??= [];
    npc.kin.siblings ??= [];
    npc.surnameIdx ??= 0;
    const h = hashStr(`${npc.id}:life`, this.sim.state.seed);
    npc.retireAge ??= LIFE.retireAge[0] + Math.floor(h * (LIFE.retireAge[1] - LIFE.retireAge[0] + 1));
    // Most people are drawn to the opposite sex; some to anyone.
    npc.attraction ??= hashStr(`${npc.id}:attr`, this.sim.state.seed) < 0.9 ? (npc.gender === 'm' ? 'f' : 'm') : 'any';
  }

  byId(id) {
    return this.sim.npcs.byId(id);
  }

  /** A person, living or dead (dead ones come from the graveyard). */
  person(id) {
    if (id === 'player') return this.sim.lineage?.person() || null;
    return this.byId(id) || this.sim.state.graveyard.find((g) => g.id === id) || this.sim.state.emigrants?.find((g) => g.id === id) || null;
  }

  /** How B is related to A, from A's point of view — or null. */
  kinship(a, b) {
    if (!a?.kin || !b) return null;
    const k = a.kin;
    if (k.spouse === b.id) return 'spouse';
    if (k.parents.includes(b.id)) return 'parent';
    if (k.children.includes(b.id)) return 'child';
    if (k.siblings.includes(b.id) || (b.kin && k.parents.some((p) => b.kin.parents.includes(p)))) return 'sibling';
    for (const pid of k.parents) {
      const par = this.person(pid);
      if (par?.kin?.parents.includes(b.id)) return 'grandparent';
    }
    for (const cid of k.children) {
      const ch = this.person(cid);
      if (ch?.kin?.children.includes(b.id)) return 'grandchild';
    }
    if (a.family?.includes(b.id)) return 'relative';
    return null;
  }

  /** Close family, living. */
  relatives(npc) {
    const k = npc.kin;
    if (!k) return [];
    const ids = new Set([k.spouse, ...k.parents, ...k.children, ...k.siblings].filter(Boolean));
    for (const pid of k.parents) for (const sib of this.person(pid)?.kin?.children || []) if (sib !== npc.id) ids.add(sib);
    for (const cid of k.children) for (const gc of this.person(cid)?.kin?.children || []) ids.add(gc);
    for (const pid of k.parents) for (const gp of this.person(pid)?.kin?.parents || []) ids.add(gp);
    ids.delete(npc.id);
    return [...ids].map((id) => this.byId(id)).filter(Boolean);
  }

  /** Keep npc.family in sync with the kin links. */
  syncFamily(npc) {
    const ids = new Set();
    for (const r of this.relatives(npc)) ids.add(r.id);
    // Founding families listed without exact links (older saves) stay family.
    for (const id of npc.family || []) if (this.byId(id)) ids.add(id);
    npc.family = [...ids];
  }

  spouse(npc) {
    return npc.kin?.spouse ? this.byId(npc.kin.spouse) : null;
  }

  children(npc) {
    return (npc.kin?.children || []).map((id) => this.byId(id)).filter(Boolean);
  }

  household(npc) {
    return npc.homeId ? this.sim.npcs.residentsOf(npc.homeId) : [npc];
  }

  // ------------------------------------------------------------------ love & marriage

  compatible(a, b) {
    if (a === b || a.age < 18 || b.age < 18) return false;
    if (a.kin.spouse || b.kin.spouse) return false;
    if (this.kinship(a, b)) return false;
    if (Math.abs(a.age - b.age) > LIFE.maxAgeGap) return false;
    const likes = (x, y) => x.attraction === 'any' || x.attraction === y.gender;
    return likes(a, b) && likes(b, a);
  }

  /** Weekly: friendships can turn into courtship, and courtship into marriage. */
  weeklyLove() {
    const sim = this.sim;
    const S = sim.social;
    const day = sim.time.day;
    for (const a of sim.state.npcs) {
      if (a.age < 18 || a.kin.spouse) continue;
      if (a.partner === 'player') continue; // courting you — that's up to you
      if (a.partner) {
        const b = this.byId(a.partner);
        if (!b || b.kin.spouse || b.partner !== a.id) {
          a.partner = null;
          continue;
        }
        if (a.id > b.id) continue; // handle each couple once
        const ready = day - (a.courtingSince || day) >= LIFE.marryAfterDays && S.npcRel(a, b) >= LIFE.marryFriendship && S.npcRel(b, a) >= LIFE.marryFriendship;
        if (ready && rand.chance(LIFE.marryChance)) this.marry(a, b);
        // Feuds end romances.
        else if (S.feeling(S.bond(a, b)) === 'rival' || S.feeling(S.bond(b, a)) === 'rival') this.breakUp(a, b);
        continue;
      }
      for (const [bid, v] of Object.entries(a.relations)) {
        if (v.f < LIFE.courtFriendship || v.t < LIFE.courtTrust) continue;
        const b = this.byId(bid);
        if (!b || b.partner || !this.compatible(a, b)) continue;
        const back = S.bond(b, a);
        if (!back || back.f < LIFE.courtFriendship) continue;
        if (!rand.chance(LIFE.courtChance)) continue;
        a.partner = b.id;
        b.partner = a.id;
        a.courtingSince = b.courtingSince = day;
        sim.memory.remember(a, 'fell_in_love', { who: b.id, params: { npc: b.id } });
        sim.memory.remember(b, 'fell_in_love', { who: a.id, params: { npc: a.id } });
        sim.chronicle('chronicle.npc_courting', { npc: a.id, npc2: b.id });
        break;
      }
    }
  }

  breakUp(a, b) {
    a.partner = b.partner = null;
    this.sim.memory.remember(a, 'broke_up', { who: b.id, params: { npc: b.id } });
    this.sim.memory.remember(b, 'broke_up', { who: a.id, params: { npc: a.id } });
  }

  marry(a, b) {
    const sim = this.sim;
    a.partner = b.partner = null;
    a.kin.spouse = b.id;
    b.kin.spouse = a.id;
    // Tradition: the wife takes the husband's name (same-sex couples keep their own).
    if (a.gender !== b.gender) {
      const [husband, wife] = a.gender === 'm' ? [a, b] : [b, a];
      wife.maidenIdx = wife.surnameIdx;
      wife.surnameIdx = husband.surnameIdx;
    }
    sim.memory.remember(a, 'married', { who: b.id, params: { npc: b.id } });
    sim.memory.remember(b, 'married', { who: a.id, params: { npc: a.id } });
    for (const r of new Set([...this.relatives(a), ...this.relatives(b)])) if (r !== a && r !== b) sim.memory.remember(r, 'family_wedding', { params: { npc: a.id, npc2: b.id } });
    sim.chronicle('chronicle.npc_married', { npc: a.id, npc2: b.id });
    for (const n of [a, b, ...this.relatives(a), ...this.relatives(b)]) this.syncFamily(n);
    sim.social.addNpcRel(a, b, 10);
    this.setUpHome(a, b);
    sim.bus.emit('family:changed', a.id);
  }

  /** Newlyweds move in together — into the home one of them owns, or the roomier one, or a new one. */
  setUpHome(a, b) {
    const P = this.sim.property;
    const owns = (n) => n.homeId && P.rec(n.homeId)?.owner === n.id;
    const room = (n) => (n.homeId ? P.capacity(n.homeId) - P.occupants(n.homeId) : -99);
    let target = null;
    if (owns(a)) target = a.homeId;
    else if (owns(b)) target = b.homeId;
    else if (a.homeId && room(a) >= 1 && !this.sim.economy.businessAtBuilding(a.homeId)) target = a.homeId;
    else if (b.homeId && room(b) >= 1 && !this.sim.economy.businessAtBuilding(b.homeId)) target = b.homeId;
    if (!target) {
      const budget = P.rentBudget(a) + P.rentBudget(b);
      const opt = P.options(2, budget, (a.money + b.money) / 1.2)[0];
      if (opt) {
        const head = a.money >= b.money ? a : b;
        if (opt.buy) {
          const other = head === a ? b : a;
          const fromOther = Math.min(other.money, Math.max(0, opt.price - head.money));
          other.money -= fromOther;
          head.money += fromOther;
        }
        P.settle([a, b], opt, head, 'moved');
        return;
      }
      target = a.homeId || b.homeId;
    }
    if (target) P.moveIn([a, b].filter((n) => n.homeId !== target), target, 'moved');
  }

  // ------------------------------------------------------------------ children

  /** Each season, couples with room at home and enough to live on may have a baby. */
  onSeason() {
    const sim = this.sim;
    for (const mother of sim.state.npcs.slice()) {
      if (mother.gender !== 'f' || mother.age < LIFE.fertileFrom || mother.age > LIFE.fertileTo) continue;
      const father = this.spouse(mother);
      if (!father || father.gender !== 'm') continue;
      const home = mother.homeId;
      if (!home) continue;
      const P = sim.property;
      if (P.occupants(home) >= P.capacity(home)) continue; // no room for a baby
      const householdMoney = this.household(mother).reduce((s, n) => s + n.money, 0);
      if (householdMoney < LIFE.minHouseholdMoney) continue;
      const kids = mother.kin.children.filter((id) => this.byId(id)).length;
      const chance = LIFE.birthChancePerSeason * Math.pow(0.6, kids) * (mother.age > 35 ? 0.6 : 1);
      if (rand.chance(chance)) this.birth(mother, father);
    }
  }

  /** Pick a first name no one in the family is using. */
  pickName(gender, family) {
    const count = gender === 'f' ? 35 : 35;
    for (let i = 0; i < LIFE.maxNameTries; i++) {
      const idx = rand.int(0, count - 1);
      if (!family.some((f) => f.gender === gender && f.nameIdx === idx)) return idx;
    }
    return rand.int(0, count - 1);
  }

  birth(mother, father) {
    const sim = this.sim;
    const gender = rand.chance(0.5) ? 'm' : 'f';
    const family = [mother, father, ...this.children(mother)];
    const traits = [];
    for (const parent of [mother, father]) if (rand.chance(0.5)) traits.push(rand.pick(parent.traits));
    const all = Object.keys(TRAITS);
    while (traits.length < 2) traits.push(rand.pick(all));
    const P = LOOK_PALETTE;
    const baby = sim.npcs.spawn({
      gender,
      nameIdx: this.pickName(gender, family),
      surnameIdx: father.surnameIdx,
      age: 0,
      occupation: 'child',
      homeId: mother.homeId,
      traits: [...new Set(traits)].slice(0, 2),
      money: 0,
      look: {
        skin: rand.pick([mother.look.skin, father.look.skin]),
        hair: rand.pick([mother.look.hair, father.look.hair, rand.pick(P.hair)]),
        hairStyle: gender === 'f' ? rand.pick(['long', 'bun']) : rand.pick(['short', 'messy']),
        shirt: rand.pick(P.shirt),
        pants: rand.pick(P.pants),
        shoes: rand.pick(P.shoes),
        dress: gender === 'f' && rand.chance(0.6),
        beard: false,
      },
      kin: { spouse: null, parents: [mother.id, father.id], children: [], siblings: [] },
      born: sim.time.day,
    });
    mother.kin.children.push(baby.id);
    father.kin.children.push(baby.id);
    for (const n of [baby, mother, father, ...this.relatives(baby)]) this.syncFamily(n);
    for (const p of [mother, father]) {
      sim.memory.remember(p, 'child_born', { who: baby.id, params: { npc: baby.id } });
      sim.social.adjust(p, baby, { f: 80, t: 60 });
      sim.social.adjust(baby, p, { f: 80, t: 60 });
    }
    for (const sib of this.children(mother)) if (sib !== baby) sim.memory.remember(sib, 'sibling_born', { who: baby.id, params: { npc: baby.id } });
    sim.chronicle('chronicle.npc_baby', { npc: mother.id, npc2: father.id, npc3: baby.id, gender: baby.gender });
    sim.bus.emit('family:changed', baby.id);
    return baby;
  }

  // ------------------------------------------------------------------ aging, retirement, death

  /** Called on the village's yearly birthday (see NPCSystem). */
  yearPassed() {
    const sim = this.sim;
    for (const npc of sim.state.npcs.slice()) {
      if (npc.age >= npc.retireAge && !['elder', 'child'].includes(npc.occupation)) this.retire(npc);
      let chance = 0;
      for (const [age, p] of LIFE.deathChanceByAge) {
        if (npc.age < age) {
          chance = p;
          break;
        }
      }
      if (npc.age < 60) chance = 0.002;
      chance *= npc.health < 40 ? 3 : 1;
      if (rand.chance(chance)) this.die(npc, 'age');
    }
  }

  /** Daily: very sick, starving people can die. */
  onDay() {
    const sim = this.sim;
    if (sim.time.weekday === 0) this.weeklyLove();
    for (const npc of sim.state.npcs.slice()) {
      if (npc.health <= 3 && rand.chance(npc.age > 60 ? 0.05 : 0.01)) this.die(npc, 'illness');
    }
  }

  retire(npc) {
    const sim = this.sim;
    if (npc.owns) {
      const heir = this.heirFor(npc, { forBusiness: true });
      if (!heir) return; // nobody to take over: keep going
      this.handOverBusiness(npc, heir, 'retired');
    }
    if (npc.employer === 'player') {
      delete sim.state.workers[npc.id];
      sim.bus.emit('workers:changed');
    }
    npc.employer = null;
    npc.occupation = 'elder';
    npc.task = null;
    sim.memory.remember(npc, 'retired');
    sim.chronicle('chronicle.npc_retired', { npc: npc.id, gender: npc.gender });
    sim.habits.derive(npc);
  }

  /** Who inherits? Spouse, then grown children (eldest first), then siblings. */
  heirFor(npc, { forBusiness = false } = {}) {
    const minAge = forBusiness ? 16 : 0;
    const spouse = this.spouse(npc);
    const kids = this.children(npc).sort((a, b) => b.age - a.age);
    const siblings = (npc.kin.siblings || []).map((id) => this.byId(id)).filter(Boolean);
    const candidates = [spouse, ...kids, ...siblings].filter((n) => n && n.age >= minAge);
    if (forBusiness) {
      // Someone already working there, or not tied to another business.
      return candidates.find((n) => n.employer === npc.owns) || candidates.find((n) => !n.owns) || null;
    }
    return candidates[0] || null;
  }

  handOverBusiness(from, heir, why) {
    const sim = this.sim;
    const bizId = from.owns;
    const def = sim.economy.def(bizId);
    if (heir.employer === 'player') {
      delete sim.state.workers[heir.id];
      sim.bus.emit('workers:changed');
    }
    from.owns = null;
    heir.owns = bizId;
    heir.employer = null;
    heir.occupation = def.ownerOccupation || heir.occupation;
    heir.task = null;
    sim.economy.biz(bizId).owner = heir.id;
    // The business building changes hands too.
    const P = sim.property;
    if (P.rec(def.building)?.owner === from.id) P.transfer(def.building, heir.id, 'inherited');
    sim.memory.remember(heir, 'took_over_business', { who: from.id, params: { building: def.building, npc: from.id } });
    const key = why === 'retired' ? 'handed_over' : why === 'worker' ? 'taken_over' : 'inherited';
    sim.chronicle(`chronicle.business_${key}`, { npc: from.id, gender: from.gender, npc2: heir.id, building: def.building });
    sim.habits.derive(heir);
  }

  /** No family to take over: the most experienced worker does — or the business closes. */
  businessWithoutHeir(npc) {
    const sim = this.sim;
    const bizId = npc.owns;
    if (sim.enterprise) return sim.enterprise.ownerLost(bizId, npc);
    const worker = sim.state.npcs.filter((n) => n.employer === bizId).sort((a, b) => b.level - a.level)[0];
    if (worker) return this.handOverBusiness(npc, worker, 'worker');
    npc.owns = null;
    sim.economy.biz(bizId).owner = null;
    sim.economy.biz(bizId).closed = true;
    sim.chronicle('chronicle.business_closed', { building: sim.economy.biz(bizId).building });
    sim.bus.emit('business:closed', bizId);
  }

  die(npc, cause) {
    const sim = this.sim;
    const age = npc.age;
    // What they leave behind.
    const heir = this.heirFor(npc);
    if (npc.owns) {
      const bizHeir = this.heirFor(npc, { forBusiness: true });
      if (bizHeir) this.handOverBusiness(npc, bizHeir, 'died');
      else this.businessWithoutHeir(npc);
    }
    if (heir) {
      heir.money += Math.max(0, Math.floor(npc.money));
      sim.memory.remember(heir, 'inherited', { who: npc.id, params: { npc: npc.id, money: Math.floor(npc.money) } });
    } else sim.state.village.treasury += Math.max(0, Math.floor(npc.money));
    for (const [id, r] of Object.entries(sim.property.all)) {
      if (r.owner !== npc.id) continue;
      if (heir && heir.age >= 16) sim.property.transfer(id, heir.id, 'inherited');
      else if (heir) sim.property.transfer(id, heir.id, 'inherited'); // held for a child
      else sim.property.transfer(id, 'village', 'escheat');
    }
    // Grief.
    for (const r of this.relatives(npc)) sim.memory.remember(r, 'family_died', { who: npc.id, params: { npc: npc.id, kin: `${this.kinship(r, npc) || 'relative'}:${npc.gender}` } });
    for (const [id, v] of Object.entries(npc.relations)) {
      const friend = this.byId(id);
      if (friend && v.f >= 40 && !npc.family.includes(id)) sim.memory.remember(friend, 'friend_died', { who: npc.id, params: { npc: npc.id } });
    }
    const spouse = this.spouse(npc);
    if (spouse) {
      spouse.kin.spouse = null;
      spouse.widowOf = npc.id;
    }
    if (npc.partner) {
      const p = this.byId(npc.partner);
      if (p) p.partner = null;
    }
    // Remember them.
    sim.state.graveyard.push({
      id: npc.id, nameIdx: npc.nameIdx, surnameIdx: npc.surnameIdx, gender: npc.gender, look: npc.look,
      born: sim.time.day - age * BALANCE.time.daysPerSeason * BALANCE.time.seasons.length, died: sim.time.day, age, cause,
      occupation: npc.occupation, kin: npc.kin, owned: npc.owns || null, level: npc.level,
    });
    sim.chronicle('chronicle.npc_died', { npc: npc.id, gender: npc.gender, n: age });
    sim.npcs.remove(npc);
    for (const r of this.relatives(npc)) this.syncFamily(r);
    sim.bus.emit('family:changed', npc.id);
  }
}
