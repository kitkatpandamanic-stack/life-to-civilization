/**
 * LineageSystem — your family, across generations.
 *
 * You can court a villager you're close to, marry, and raise children in your
 * home. You grow old. One day you'll retire — or die — and play on as one of
 * your grown children, who inherits the family's money, land, houses and
 * businesses (and its good name, or its bad one). The village remembers what
 * your parents did.
 *
 * Inside the family tree the player is the id 'player'. When the torch passes,
 * the old player gets an ancestor id (anc1, anc2…) — kept as a retired villager
 * or in the graveyard — and the heir becomes 'player'.
 *
 *   state.player: gender, surnameIdx, spouse, partner, children, parents, generation, succeededDay
 *   state.lineage: [{ generation, name, gender, age, died|retired, money, children, level }]
 */
import { PERKS } from '../data/perks.js';
import { rand, hashStr } from '../core/rng.js';
import { LOOK_PALETTE } from '../data/npcs.js';
import { TRAITS } from '../data/traits.js';
import { SKILLS } from '../data/skills.js';
import { HOME_ORDER } from '../data/homes.js';

export const PLAYER_LIFE = {
  courtRel: 50, // friendship needed to ask someone out
  proposeRel: 80,
  proposeTrust: 20,
  courtDays: 7,
  birthChancePerSeason: 0.25,
  deathChanceByAge: [[60, 0], [70, 0.02], [80, 0.08], [90, 0.2], [200, 0.45]],
  retireAge: 55,
  heirMinAge: 14,
  knowledgePassed: 0.4, // share of skills a child learned at home
};

export class LineageSystem {
  constructor(sim) {
    this.sim = sim;
    const p = sim.state.player;
    p.gender ??= 'm';
    p.surnameIdx ??= Math.floor(hashStr('player', sim.state.seed) * 30);
    p.spouse ??= null;
    p.partner ??= null;
    p.children ??= [];
    p.parents ??= [];
    p.generation ??= 1;
    sim.state.lineage ??= [];
    sim.bus.on('time:season', () => this.onSeason());
    sim.bus.on('npc:removed', (id) => this.onRemoved(id));
  }

  /** Someone in your family died or left: they're no longer your spouse / partner / child at home. */
  onRemoved(id) {
    const p = this.p;
    if (p.partner === id) p.partner = null;
    if (p.spouse === id) {
      p.spouse = null;
      p.widowed = id;
    }
  }

  /** How many people your home can hold (your own home grows as you upgrade it). */
  homeRoom() {
    const p = this.p;
    if (!p.homeId) return 0;
    const tier = Math.max(0, HOME_ORDER.indexOf(p.homeTier || 'shack'));
    return Math.max(this.sim.property.capacity(p.homeId), 2 + tier * 2);
  }

  homeFull() {
    return this.sim.property.occupants(this.p.homeId) >= this.homeRoom();
  }

  get p() {
    return this.sim.state.player;
  }

  /** The player as a person in the family tree. */
  person() {
    const p = this.p;
    return { id: 'player', isPlayer: true, name: p.name, nameIdx: p.nameIdx, gender: p.gender, age: p.age, look: p.look, surnameIdx: p.surnameIdx, kin: { spouse: p.spouse, parents: p.parents, children: p.children, siblings: [] } };
  }

  /** A name as data (for chronicle params and records): { name | nameIdx, gender }. */
  who(x = this.p) {
    return x.name ? { name: x.name, gender: x.gender } : { nameIdx: x.nameIdx ?? 0, gender: x.gender };
  }

  spouse() {
    return this.p.spouse ? this.sim.npcs.byId(this.p.spouse) : null;
  }

  children() {
    return this.p.children.map((id) => this.sim.npcs.byId(id)).filter(Boolean);
  }

  // ------------------------------------------------------------------ courtship & marriage

  /** Could you ask this villager out? */
  canCourt(npc) {
    const p = this.p;
    if (p.spouse || p.partner || npc.age < 18 || p.age < 18) return { ok: false };
    if (npc.kin?.spouse || npc.partner) return { ok: false, reason: 'already_taken' };
    if (p.children.includes(npc.id) || p.parents.includes(npc.id) || npc.family.includes('player')) return { ok: false };
    if (Math.abs(npc.age - p.age) > 20) return { ok: false, reason: 'age_gap' };
    if (!(npc.attraction === 'any' || npc.attraction === p.gender)) return { ok: false, reason: 'not_interested' };
    const tier = this.sim.social.tier(npc);
    if ((tier !== 'friend' && tier !== 'trusted') || npc.rel < PLAYER_LIFE.courtRel) return { ok: false, reason: 'not_close_enough' };
    return { ok: true };
  }

  /** Ask them out. Returns true if they said yes. */
  court(npc) {
    if (!this.canCourt(npc).ok) return false;
    const opinion = this.sim.memory.opinionOfPlayer(npc);
    const chance = Math.min(0.95, 0.35 + (npc.rel - PLAYER_LIFE.courtRel) / 60 + opinion / 40 + this.sim.social.playerBond(npc).t / 150);
    if (!rand.chance(chance)) {
      this.sim.social.addRel(npc, -2);
      return false;
    }
    this.p.partner = npc.id;
    npc.partner = 'player';
    npc.courtingSince = this.sim.time.day;
    this.sim.memory.remember(npc, 'courting_player', { who: 'player' });
    this.sim.chronicle('chronicle.player_courting', { npc: npc.id, gender: npc.gender });
    return true;
  }

  canPropose(npc) {
    const p = this.p;
    if (p.partner !== npc.id || p.spouse) return { ok: false };
    if (this.sim.time.day - (npc.courtingSince ?? this.sim.time.day) < PLAYER_LIFE.courtDays) return { ok: false, reason: 'too_soon' };
    if (npc.rel < PLAYER_LIFE.proposeRel || this.sim.social.playerBond(npc).t < PLAYER_LIFE.proposeTrust) return { ok: false, reason: 'not_ready' };
    return { ok: true };
  }

  propose(npc) {
    if (!this.canPropose(npc).ok) return false;
    const sim = this.sim;
    const p = this.p;
    p.partner = null;
    npc.partner = null;
    p.spouse = npc.id;
    npc.kin.spouse = 'player';
    // The bride takes the family name (a same-sex couple keeps their own).
    if (npc.gender === 'f' && p.gender === 'm') {
      npc.maidenIdx = npc.surnameIdx;
      npc.surnameIdx = p.surnameIdx;
    }
    // Your spouse moves in with you (if you have a home of your own), bringing their young children.
    if (p.homeId && !sim.economy.businessAtBuilding(p.homeId)) {
      const room = this.homeRoom() - sim.property.occupants(p.homeId);
      const kids = sim.family.children(npc).filter((k) => k.homeId === npc.homeId && k.age < 16);
      if (npc.owns && sim.economy.biz(npc.owns)?.building === npc.homeId) {
        // They live above their business: they keep running it from there, and visit.
      } else if (room >= 1) sim.property.moveIn([npc, ...kids.slice(0, room - 1)], p.homeId, 'moved');
    }
    sim.memory.remember(npc, 'married', { who: 'player', params: { npc: 'player' } });
    for (const r of sim.family.relatives(npc)) sim.memory.remember(r, 'family_wedding', { params: { npc: npc.id, npc2: 'player' } });
    sim.family.syncFamily(npc);
    sim.social.addRel(npc, 10);
    sim.progression.addReputation(3);
    sim.chronicle('chronicle.player_married', { npc: npc.id, gender: npc.gender });
    sim.bus.emit('family:changed', npc.id);
    return true;
  }

  // ------------------------------------------------------------------ children

  onSeason() {
    const sim = this.sim;
    const p = this.p;
    const spouse = this.spouse();
    if (!spouse || spouse.gender === p.gender) return;
    const mother = p.gender === 'f' ? { age: p.age } : spouse;
    if (mother.age < 18 || mother.age > 42) return;
    if (!p.homeId || this.homeFull()) return; // no room for a baby
    const chance = PLAYER_LIFE.birthChancePerSeason * Math.pow(0.6, p.children.length);
    if (rand.chance(chance)) this.birth();
  }

  birth() {
    const sim = this.sim;
    const p = this.p;
    const spouse = this.spouse();
    const gender = rand.chance(0.5) ? 'm' : 'f';
    const allTraits = Object.keys(TRAITS);
    const traits = [...new Set([rand.pick(spouse?.traits || allTraits), rand.pick(allTraits)])];
    const baby = sim.npcs.spawn({
      gender,
      nameIdx: sim.family.pickName(gender, [spouse, ...this.children()].filter(Boolean)),
      surnameIdx: p.surnameIdx,
      age: 0,
      occupation: 'child',
      homeId: p.homeId,
      traits,
      money: 0,
      look: {
        skin: rand.pick([p.look.skin, spouse?.look.skin || p.look.skin]),
        hair: rand.pick([p.look.hair, spouse?.look.hair || p.look.hair]),
        hairStyle: gender === 'f' ? rand.pick(['long', 'bun']) : rand.pick(['short', 'messy']),
        shirt: rand.pick(LOOK_PALETTE.shirt),
        pants: rand.pick(LOOK_PALETTE.pants),
        shoes: rand.pick(LOOK_PALETTE.shoes),
        dress: gender === 'f' && rand.chance(0.6),
        beard: false,
      },
      kin: { spouse: null, parents: ['player', ...(spouse ? [spouse.id] : [])], children: [], siblings: [] },
      born: sim.time.day,
      met: true,
      rel: 90,
    });
    p.children.push(baby.id);
    if (spouse) {
      spouse.kin.children.push(baby.id);
      sim.memory.remember(spouse, 'child_born', { who: baby.id, params: { npc: baby.id } });
      sim.family.syncFamily(spouse);
    }
    sim.family.syncFamily(baby);
    sim.chronicle('chronicle.player_child', { npc: baby.id, gender: baby.gender });
    sim.bus.emit('family:changed', baby.id);
    sim.toast('toast.player_child', { npc: baby.id, gender: baby.gender }, 'good');
    return baby;
  }

  // ------------------------------------------------------------------ age, death, succession

  /** The player's birthday (called with the village's yearly birthday). */
  yearPassed() {
    const p = this.p;
    let chance = 0;
    for (const [age, c] of PLAYER_LIFE.deathChanceByAge) {
      if (p.age < age) {
        chance = c;
        break;
      }
    }
    if (p.health < 40) chance *= 2;
    if (chance && rand.chance(chance)) this.succeed('died');
  }

  /** Children old enough to carry on. */
  heirs() {
    return this.children()
      .filter((c) => c.age >= PLAYER_LIFE.heirMinAge)
      .sort((a, b) => b.age - a.age);
  }

  canRetire() {
    const heir = this.heirs()[0];
    return this.p.age >= PLAYER_LIFE.retireAge && !!heir && heir.age >= 16 ? { ok: true, heir } : { ok: false };
  }

  /**
   * Hand the family on. `how` = 'died' | 'retired'. The chosen heir becomes the player.
   * Returns a summary for the succession screen.
   */
  succeed(how, heir = this.heirs()[0]) {
    const sim = this.sim;
    const p = this.p;
    const gen = p.generation;
    const ancestorId = `anc${gen}`;
    const old = { generation: gen, name: p.name, nameIdx: p.nameIdx, gender: p.gender, age: p.age, how, day: sim.time.day, money: Math.round(p.money), level: p.level, children: p.children.length, id: ancestorId };
    sim.state.lineage.push(old);

    // The old player becomes a person in the family tree: a retired villager, or a name on a grave.
    const oldKin = { spouse: p.spouse, parents: p.parents.slice(), children: p.children.slice(), siblings: [] };
    if (how === 'retired') {
      const pension = Math.round(p.money * 0.15);
      p.money -= pension;
      const elder = sim.npcs.spawn({
        id: ancestorId,
        customName: p.name || undefined,
        nameIdx: p.nameIdx ?? 0,
        gender: p.gender,
        age: p.age,
        occupation: 'elder',
        homeId: p.homeId,
        traits: ['generous', 'natural_leader'],
        money: pension,
        look: { ...p.look },
        kin: oldKin,
        surnameIdx: p.surnameIdx,
        met: true,
        rel: 95,
        x: p.x,
        y: p.y,
      });
      elder.retiredPlayer = true;
    } else {
      sim.state.graveyard.push({ id: ancestorId, customName: p.name || undefined, nameIdx: p.nameIdx ?? 0, gender: p.gender, age: p.age, look: p.look, kin: oldKin, died: sim.time.day, cause: 'age', surnameIdx: p.surnameIdx, wasPlayer: true });
    }
    // Everyone's family links to the old player now point at the ancestor.
    const people = () => [...sim.state.npcs, ...sim.state.graveyard, ...(sim.state.emigrants || [])];
    const remap = (from, to) => {
      const f = (id) => (id === from ? to : id);
      for (const n of people()) {
        if (!n.kin || n.id === to) continue;
        n.kin.spouse = f(n.kin.spouse);
        n.kin.parents = n.kin.parents.map(f);
        n.kin.children = n.kin.children.map(f);
        if (n.family) n.family = n.family.map(f);
      }
    };
    // Names in the chronicle, the history book, memories and rumors point at people by id.
    const remapParams = (from, to) => {
      const fix = (params) => {
        if (params) for (const k in params) if (params[k] === from && (k.startsWith('npc') || k === 'who')) params[k] = to;
      };
      for (const e of sim.state.chronicle) fix(e.params);
      for (const e of sim.state.history?.entries || []) fix(e.params);
      for (const r of sim.state.rumors?.list || []) fix(r.params);
      for (const n of sim.state.npcs) for (const m of n.memories || []) fix(m.p);
    };
    const swap = (id) => (id === 'player' ? ancestorId : id);
    remap('player', ancestorId);
    remapParams('player', ancestorId);
    for (const n of sim.state.npcs) {
      if (n.partner === 'player') n.partner = null;
      // What people remember about you is now about your parent.
      for (const m of n.memories || []) if (m.w === 'player') m.w = ancestorId;
    }
    const widow = sim.npcs.byId(p.spouse);
    if (widow && how === 'died') {
      widow.kin.spouse = null;
      widow.widowOf = ancestorId;
      sim.memory.remember(widow, 'family_died', { who: ancestorId, params: { npc: ancestorId, kin: `spouse:${p.gender}` } });
    }

    if (!heir) return this.newcomer(old);

    // The heir takes over: name, face, age — and everything the family owns stays with 'player'.
    const hk = heir.kin;
    // Names are kept as data (an index into the name list), shown in the player's language.
    p.name = heir.customName || null;
    p.nameIdx = heir.nameIdx;
    p.gender = heir.gender;
    p.age = heir.age;
    p.look = { ...heir.look };
    p.surnameIdx = heir.surnameIdx;
    p.spouse = hk.spouse && hk.spouse !== ancestorId ? hk.spouse : null;
    p.partner = null;
    p.children = hk.children.slice();
    p.parents = hk.parents.map(swap);
    const home = sim.world.buildings[p.homeId];
    const at = home ? sim.world.tileCenter(home.door.tx, home.door.ty + 1) : { x: heir.x, y: heir.y };
    p.x = at.x;
    p.y = at.y;
    p.sleeping = false;
    p.generation = gen + 1;
    p.succeededDay = sim.time.day;
    p.health = Math.max(70, heir.health);
    p.energy = 90;
    // What was learned at home: part of the parent's skill, plus the heir's own experience.
    const parentLevel = old.level;
    p.level = Math.max(1, Math.round(parentLevel * 0.3 + (heir.level || 1) * 0.5));
    p.xp = 0;
    p.attributePoints = 0;
    p.skillPoints = 2;
    for (const id of Object.keys(SKILLS)) {
      const s = p.skills[id];
      p.skills[id] = { level: Math.floor((s?.level || 0) * PLAYER_LIFE.knowledgePassed), xp: 0 };
    }
    p.reputation = Math.round(p.reputation * 0.6);
    p.perks = (p.perks || []).filter((id) => (p.skills[PERKS[id]?.skill]?.level || 0) >= (PERKS[id]?.tier || 99));
    // The heir's own ties: their spouse is now married to 'player', their children are the player's.
    remap(heir.id, 'player');
    remapParams(heir.id, 'player');
    for (const n of sim.state.npcs) {
      if (n.partner === heir.id) n.partner = null;
      for (const m of n.memories || []) if (m.w === heir.id) m.w = 'player';
    }
    // Their savings join the family's.
    p.money += Math.max(0, Math.floor(heir.money));
    // People knew your parent — you start with part of that goodwill (or grudge).
    for (const n of sim.state.npcs) {
      if (n === heir) continue;
      n.rel = Math.round((n.rel || 0) * 0.6);
      const pb = sim.social.playerBond(n);
      pb.t = Math.round(pb.t * 0.6);
      pb.c = Math.round(pb.c * 0.5);
      // The heir's own friendships carry over.
      const b = n.relations?.[heir.id];
      if (b) {
        n.rel = Math.max(n.rel, Math.max(0, b.f));
        pb.t = Math.max(pb.t, b.t);
        n.met = true;
      }
    }
    // The heir leaves the villager roll — they're you now (their own business stays in the family).
    const heirId = heir.id;
    if (heir.owns) {
      const next = sim.family.heirFor(heir, { forBusiness: true });
      if (next) sim.family.handOverBusiness(heir, next, 'retired');
      else sim.family.businessWithoutHeir(heir);
    }
    for (const [id, r] of Object.entries(sim.property.all)) if (r.owner === heir.id) sim.property.transfer(id, 'player', 'inherited');
    sim.npcs.remove(heir);
    for (const n of sim.state.npcs) sim.family.syncFamily(n);
    sim.chronicle(how === 'died' ? 'chronicle.player_died' : 'chronicle.player_retired', { name: this.who(old), n: old.age, gender: old.gender });
    sim.chronicle('chronicle.heir_continues', { name: this.who(), n: p.generation, gender: p.gender });
    sim.bus.emit('player:succeeded', { old, heirId });
    return { old, heir: { ...this.who(), age: p.age }, generation: p.generation };
  }

  /** No child to carry on: the story continues with someone new arriving in the village. */
  newcomer(old) {
    const sim = this.sim;
    const p = this.p;
    const gender = rand.chance(0.5) ? 'm' : 'f';
    p.gender = gender;
    p.age = rand.int(18, 26);
    p.name = null;
    p.nameIdx = rand.int(0, 34);
    p.surnameIdx = rand.int(0, 29);
    p.spouse = null;
    p.partner = null;
    p.children = [];
    p.parents = [];
    p.generation = old.generation + 1;
    p.succeededDay = sim.time.day;
    p.newLine = true;
    p.lineFrom = p.generation;
    p.level = 1;
    p.xp = 0;
    for (const id of Object.keys(SKILLS)) p.skills[id] = { level: 0, xp: 0 };
    p.reputation = 0;
    // The family's businesses close; the estate passes to the village; the newcomer starts with a little.
    for (const id of sim.holdings.mine()) sim.enterprise.close(id, 'no_heir');
    sim.state.village.treasury += Math.max(0, p.money - 30);
    p.money = 30;
    for (const [id, r] of Object.entries(sim.property.all)) if (r.owner === 'player' && id !== p.homeId) sim.property.transfer(id, 'village', 'escheat');
    for (const n of sim.state.npcs) {
      n.rel = 0;
      n.met = false;
      n.pb = { t: 0, r: 0, c: 0 };
    }
    sim.chronicle('chronicle.line_ended', { name: this.who(old), gender: old.gender });
    sim.chronicle('chronicle.newcomer_arrives', { name: this.who(), gender: p.gender });
    sim.bus.emit('player:succeeded', { old, heirId: null });
    return { old, heir: { ...this.who(), age: p.age }, generation: p.generation, newcomer: true };
  }
}
