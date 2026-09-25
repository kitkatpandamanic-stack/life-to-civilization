/**
 * KnowHowSystem — who knows which technique, and how it spreads.
 *
 * TechSystem decides when the valley works something out. This decides how far
 * it has got: each villager has their own familiarity with each technique
 * (heard of it … master), and a technique does its good only as far as it is
 * used by the people whose work it is — a new plough helps the harvest when
 * the farmers have learned to use it, not the day one of them thinks of it.
 *
 * It spreads through people: colleagues at work, masters and apprentices,
 * families, friends talking, the school, books at the library. It travels out
 * of the valley with those who leave and with the caravans, and in with
 * newcomers and students back from the towns — who may bring a technique the
 * valley never worked out for itself. The other settlements have their own
 * know-how (data/knowhow.js), spreading among themselves as they trade, and it
 * changes what they make.
 *
 *   npc.edu.tech = { techId: 0–100 }
 *   state.settlements.list[id].techs = { techId: 0–1 }     (how widely it's used there)
 */
import { Rng } from '../core/rng.js';
import { TECHS } from '../data/tech.js';
import { KNOWHOW as K, SETTLEMENT_TECHS, SETTLEMENT_SPREAD as SS, EFFECT_GOODS } from '../data/knowhow.js';
import { OCC_FIELDS } from '../data/education.js';

const round1 = (v) => Math.round(v * 10) / 10;

export class KnowHowSystem {
  constructor(sim) {
    this.sim = sim;
    this.cache = null;
    this.seedOldSaves();
    this.seedSettlements();
    sim.bus.on('tech:discovered', (id) => this.discovered(id));
    sim.bus.on('time:day', () => sim.time.weekday === 5 && this.weekly());
    sim.bus.on('settlement:arrived', (ids) => ids.forEach((id) => this.newcomer(sim.npcs.byId(id))));
    sim.bus.on('education:returned', ({ id }) => this.graduateBack(sim.npcs.byId(id)));
    sim.bus.on('chronicle', (e) => e.key === 'chronicle.npc_left_to' && this.emigrant(e.params.npc, e.params.settlement));
    if (sim.tech) sim.tech.mods = null; // effects now depend on how far each technique has spread
  }

  get T() {
    return this.sim.state.tech;
  }
  get Ed() {
    return this.sim.education;
  }

  rng(salt) {
    let h = (this.sim.state.seed | 0) ^ 0x4b1d;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    return new Rng((h ^ (h >>> 15)) >>> 0);
  }

  // ------------------------------------------------------------------ familiarity

  fam(n, id) {
    if (!n) return 0;
    if (n === this.sim.state.player) return this.T.known[id] !== undefined ? 60 : 0;
    return n.edu?.tech?.[id] || 0;
  }

  /** Raise someone's familiarity (never lowers it). Returns the new value. */
  teach(n, id, to) {
    if (!n?.edu || !TECHS[id]) return 0;
    n.edu.tech ??= {};
    const was = n.edu.tech[id] || 0;
    if (to > was) {
      n.edu.tech[id] = round1(Math.min(100, to));
      this.cache = null;
    }
    return n.edu.tech[id];
  }

  /** Move someone's familiarity a share of the way towards a source's. */
  towards(n, id, source, share, cap = 100) {
    const have = this.fam(n, id);
    if (source <= have) return have;
    return this.teach(n, id, Math.min(cap, have + (source - have) * share));
  }

  /** "Heard of it" … "master" (the knowledge levels). */
  levelOf(n, id) {
    return this.Ed.levelOf(this.fam(n, id));
  }

  /** The people who put a technique to use (or everyone grown, for general know-how). */
  practitioners(id) {
    const def = TECHS[id];
    const npcs = this.sim.state.npcs.filter((n) => !n.away && n.age >= 14);
    const who = def?.users || def?.from;
    if (who?.length) return npcs.filter((n) => who.includes(n.occupation));
    return npcs.filter((n) => n.age >= 16);
  }

  /** Those who make it (a smith making better tools) — when they aren't the ones who use it. */
  makers(id) {
    const def = TECHS[id];
    if (!def?.users || !def.from?.length) return [];
    return this.sim.state.npcs.filter((n) => !n.away && def.from.includes(n.occupation));
  }

  isTrade(id) {
    return !!(TECHS[id]?.users?.length || TECHS[id]?.from?.length);
  }

  /** How widely it's used by those who'd use it (0–1). */
  adoption(id) {
    this.cache ??= {};
    if (this.cache[id] !== undefined) return this.cache[id];
    const who = this.practitioners(id);
    const need = this.isTrade(id) ? K.practical : K.basic;
    const v = who.length ? who.filter((n) => this.fam(n, id) >= need).length / who.length : 0;
    this.cache[id] = v;
    return v;
  }

  /** The share of a technique's good the valley gets now (TechSystem.mod scales its effects by this). */
  share(id) {
    if (this.T.known[id] === undefined) return 0;
    return K.baseEffect + (1 - K.baseEffect) * this.adoption(id);
  }

  // ------------------------------------------------------------------ seeding

  /** Older saves: what the valley already knew, its people already use. */
  seedOldSaves() {
    for (const id of Object.keys(this.T.known)) {
      if (this.sim.state.npcs.some((n) => n.edu?.tech?.[id])) continue;
      for (const n of this.practitioners(id)) this.teach(n, id, 40);
      for (const n of this.sim.state.npcs) if (n.age >= 10) this.teach(n, id, K.heard);
    }
  }

  seedSettlements() {
    const S = this.sim.settlements;
    if (!S) return;
    for (const id of S.ids()) {
      const s = S.get(id);
      if (s.techs) continue;
      s.techs = { ...(SETTLEMENT_TECHS[id] || {}) };
    }
  }

  // ------------------------------------------------------------------ how it starts

  /** Worked out here: the one who did it knows it well; those who helped, a little. */
  discovered(id) {
    const sim = this.sim;
    const def = TECHS[id];
    const credit = [...sim.state.chronicle].reverse().find((e) => e.key.startsWith('chronicle.tech_discovered') && e.params.tech === id);
    const by = credit?.params.npc && sim.npcs.byId(credit.params.npc);
    if (by) this.teach(by, id, K.discoverer);
    for (const n of this.makers(id)) this.teach(n, id, K.workedOnIt);
    for (const n of this.practitioners(id)) this.teach(n, id, def.from?.includes(n.occupation) ? K.workedOnIt : K.heard);
    // Brought in from outside (a newcomer knew it) — see introduce().
    this.cache = null;
  }

  /** A newcomer from a place that uses a technique knows it. */
  newcomer(n) {
    if (!n?.from) return;
    const techs = this.sim.settlements?.get(n.from)?.techs || {};
    const r = this.rng(`${n.id}:came`);
    for (const [id, used] of Object.entries(techs)) {
      if (r.float() > used) continue;
      const trade = TECHS[id]?.from?.length ? TECHS[id].from.includes(n.prevOccupation) || TECHS[id].from.some((o) => OCC_FIELDS[o]?.[0] && this.Ed.know(n, OCC_FIELDS[o][0]) >= 20) : true;
      this.teach(n, id, trade ? K.newcomer * (0.6 + used * 0.4) : K.heard * 3);
    }
    this.introduce(n);
  }

  /** A student back from a town brings some of what it knows. */
  graduateBack(n) {
    const town = n?.edu?.quals?.slice().reverse().find((q) => q.how === 'university')?.where;
    const techs = town && this.sim.settlements?.get(town)?.techs;
    if (!techs) return;
    for (const [id, used] of Object.entries(techs)) this.teach(n, id, K.graduate * used + K.heard);
    this.introduce(n);
  }

  /** Someone here really knows a technique the valley never worked out: now the valley has it. */
  introduce(n) {
    const T = this.sim.tech;
    for (const [id, v] of Object.entries(n?.edu?.tech || {})) {
      if (T.has(id) || v < K.practical || !T.ready(id)) continue;
      T.T.known[id] = this.sim.time.day;
      delete T.T.progress[id];
      T.mods = null;
      this.sim.chronicle(n.from ? 'chronicle.tech_introduced' : 'chronicle.tech_introduced_by', { tech: id, npc: n.id, gender: n.gender, settlement: n.from || undefined });
      this.sim.bus.emit('tech:introduced', id);
    }
  }

  /** Someone who knows the valley's know-how moves away: the place they go learns of it. */
  emigrant(npcId, settlement) {
    const n = this.sim.npcs.byId(npcId) || this.sim.state.emigrants?.find((e) => e.id === npcId);
    const s = settlement && this.sim.settlements?.get(settlement);
    if (!s || !n?.edu?.tech) return;
    s.techs ??= {};
    for (const [id, v] of Object.entries(n.edu.tech)) if (v >= K.practical) s.techs[id] = Math.min(1, (s.techs[id] || 0) + SS.emigrant);
  }

  // ------------------------------------------------------------------ weekly: how it spreads

  weekly() {
    const sim = this.sim;
    const known = Object.keys(this.T.known);
    const npcs = sim.state.npcs.filter((n) => !n.away && n.edu);
    for (const id of known) {
      // At work: colleagues learn from the one who uses it best.
      for (const bizId of sim.economy.active()) {
        const team = npcs.filter((n) => n.employer === bizId || n.owns === bizId);
        if (team.length < 2) continue;
        const best = Math.max(...team.map((n) => this.fam(n, id)));
        if (best < K.basic) continue;
        for (const n of team) this.towards(n, id, best, K.coworker);
      }
      // What the makers make, the users take up (better tools on sale, a wheelwright's carts on the road).
      const makers = this.makers(id);
      if (makers.length) {
        const best = Math.max(...makers.map((n) => this.fam(n, id)));
        if (best >= K.practical) for (const n of this.practitioners(id)) this.towards(n, id, best * 0.8, K.market);
      }
      // Masters and apprentices.
      for (const n of npcs.filter((x) => x.apprentice)) {
        const m = sim.careers?.masterOf(n);
        this.towards(n, id, this.fam(m, id), K.apprentice);
      }
      // Families and friends.
      for (const n of npcs) {
        for (const pid of n.kin?.parents || []) this.towards(n, id, this.fam(sim.npcs.byId(pid), id), K.family, 40);
        const friendKnows = Object.entries(n.relations || {}).some(([oid, v]) => v.f >= 40 && this.fam(sim.npcs.byId(oid), id) >= K.practical);
        if (friendKnows) this.teach(n, id, Math.min(K.friendCap, this.fam(n, id) + K.friend));
      }
      // General know-how: the school and the library.
      if (!this.isTrade(id)) {
        for (const s of sim.schools?.list() || []) {
          const t = sim.schools.head(s);
          const src = this.fam(t, id);
          if (src < K.basic) continue;
          for (const p of sim.schools.pupils(s)) this.teach(p, id, Math.min(K.schoolCap, src, this.fam(p, id) + K.school));
        }
      }
      if (sim.tech.civic('library')) {
        const gain = K.books * (sim.tech.has('printing') ? 2 : 1);
        for (const n of npcs) if (this.Ed.literate(n) && n.habits?.hobby === 'reading') this.teach(n, id, Math.min(K.booksCap, this.fam(n, id) + gain));
      }
    }
    this.cache = null;
    sim.tech.mods = null;
    this.settlementsWeek();
    // Newly literate readers may bring in techniques from the towns' books.
    for (const n of npcs) if (n.from) this.introduce(n);
  }

  /** The other settlements: know-how spreads through them, and between them and the valley. */
  settlementsWeek() {
    const S = this.sim.settlements;
    if (!S) return;
    const ids = S.ids();
    for (const id of ids) {
      const s = S.get(id);
      s.techs ??= {};
      for (const t of Object.keys(s.techs)) s.techs[t] = Math.min(1, s.techs[t] + SS.grow * s.techs[t] * (1 - s.techs[t]) * 4);
    }
    // Trading neighbours learn from each other (the bigger the place, the more it's heard of).
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const A = S.get(a).techs;
        for (const [t, v] of Object.entries(S.get(b).techs)) if (v > (A[t] || 0) + 0.2) A[t] = Math.min(v, (A[t] || 0) + SS.neighbour * v);
      }
    }
    // The valley and the places it trades with.
    for (const id of S.contacts()) {
      const s = S.get(id);
      for (const t of Object.keys(this.T.known)) {
        const here = this.adoption(t);
        if (here > (s.techs[t] || 0)) s.techs[t] = Math.min(here, (s.techs[t] || 0) + SS.valley * here);
      }
      // Carters, merchants and innkeepers hear what's done out there.
      for (const n of this.sim.state.npcs.filter((x) => ['merchant', 'carter', 'carter_master', 'innkeeper'].includes(x.occupation))) {
        for (const [t, v] of Object.entries(s.techs)) if (v >= 0.3) this.teach(n, t, Math.min(K.basic, this.fam(n, t) + K.heard * v));
      }
    }
  }

  /** How much faster the valley works something out when it knows it's been done (TechSystem). */
  imitation(id) {
    const S = this.sim.settlements;
    if (!S) return 1;
    const best = Math.max(0, ...S.contacts().map((s) => S.get(s).techs?.[id] || 0));
    const heard = this.sim.state.npcs.some((n) => this.fam(n, id) >= K.heard);
    return 1 + K.imitation * best + (heard ? 0.15 : 0);
  }

  /** A settlement's output of a good, from what it knows (SettlementSystem). */
  settlementOutput(settlement, item) {
    const techs = this.sim.settlements?.get(settlement)?.techs;
    if (!techs) return 1;
    let m = 1;
    for (const [t, used] of Object.entries(techs)) {
      for (const [key, v] of Object.entries(TECHS[t]?.effects || {})) {
        if (EFFECT_GOODS[key]?.includes(item)) m *= 1 + (v - 1) * used;
      }
    }
    return m;
  }

  /** What a settlement is known for (its most widely used know-how). */
  knownFor(settlement, n = 3) {
    const techs = this.sim.settlements?.get(settlement)?.techs || {};
    return Object.entries(techs).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  }

  /** A person's know-how, best first: [{ id, fam, level }]. */
  of(n, limit = 8) {
    return Object.entries(n?.edu?.tech || {})
      .filter(([id, v]) => v >= 1 && TECHS[id])
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, v]) => ({ id, fam: v, level: this.Ed.levelOf(v) }));
  }
}
