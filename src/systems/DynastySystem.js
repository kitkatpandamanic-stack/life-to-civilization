/**
 * DynastySystem — your family as a dynasty: raising the children, choosing and training the heir,
 * marrying your children into the valley's powerful families, and what the next generation inherits
 * (skills taught at home, friends, enemies). It builds on LineageSystem (marriage, births, succession)
 * and FamilySystem (villagers' marriages and homes) — the family itself lives there.
 *
 *   state.dynasty = {
 *     up:        { childId: { pts: { skill: n }, lessons, work, play, lastDay } }   what each child learned at home
 *     heir:      npcId | null                                                   the child you named heir
 *     roles:     { childId: { role: 'shadow' | 'manage', biz, since, days } }   training for grown children
 *     alliances: [{ head, child, spouse, day }]                                  your children married into families
 *     offers:    [{ id, head, their, child, day, until }]                        matches families have proposed
 *     snubbed:   { headId: day }                                                 families you turned down
 *     feuds:     [npcId]                                                        grudges your heir inherited
 *   }
 *
 * No dice: who says yes is worked out from how things stand (and a fixed hash), so the valley's other
 * systems see the same random numbers they always did.
 */
import { hashStr } from '../core/rng.js';
import { SKILLS } from '../data/skills.js';

export const DYNASTY = {
  childMin: 4, // a child can be taught from this age…
  childMax: 17, // …until they're grown
  workMin: 8, // old enough to come along to work
  lessonMinutes: 60, // an hour together
  lessonEnergy: 8,
  lessonPts: 10, // what a lesson teaches (more if you're good at it)
  teachSkill: 2, // you need this level in a skill to teach it
  levelPerPts: 40, // 40 points in a skill = one extra level for your heir
  maxBonusLevels: 4,
  workTraitAt: 6, // days at work with you → a hard worker
  playRel: 3,
  roleMin: 16, // grown enough for a role
  roleXpPerDay: 6, // a trainee's experience a day
  rolePtsPerDay: 3, // and what they pick up of the trade
  matchMin: 18,
  matchRel: 40, // how well you must get on with a family's head to propose
  giftShare: 0.05, // a wedding gift to the other family: this share of their wealth…
  giftMin: 50, // …at least this
  refuseDays: 21, // a family that said no won't hear of it again this soon
  snubRel: -25, // turning a family down
  snubDays: 56,
  offerEvery: 7, // a family may propose (weekly look)
  offerDays: 7, // an offer stands this long
  allyDiscount: 0.08, // allied families' shops
  allyVote: 3, // allied families at elections
  grudgeAt: -30, // someone who hated your parent…
  grudgeKeep: 0.9, // …keeps most of it for your heir
  allyKeep: 0.9, // allies keep most of their goodwill too
  powerMoney: 300, // a family counts as powerful with this much…
};

/** Which knowledge (EducationSystem) a lesson in each of your skills builds. */
const SKILL_FIELD = { woodcutting: 'forestry', mining: 'mining', fishing: 'fishing', hunting: 'hunting', farming: 'farming', construction: 'building', carpentry: 'carpentry', smithing: 'smithing', cooking: 'cooking', trading: 'trade', negotiation: 'negotiation', leadership: 'leadership', learning: 'reading', exploration: 'lore', foraging: 'farming' };

export class DynastySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.dynasty ??= { up: {}, heir: null, roles: {}, alliances: [], offers: [], snubbed: {}, feuds: [] };
    const D = this.D;
    D.up ??= {};
    D.roles ??= {};
    D.alliances ??= [];
    D.offers ??= [];
    D.snubbed ??= {};
    D.feuds ??= [];
    D.refused ??= {};
    sim.bus.on('time:day', () => this.daily());
  }

  get D() {
    return this.sim.state.dynasty;
  }
  get p() {
    return this.sim.state.player;
  }

  /** One of your children (alive, in the valley)? */
  mine(id) {
    return this.p.children.includes(id) ? this.sim.npcs.byId(id) : null;
  }

  up(id) {
    return (this.D.up[id] ??= { pts: {}, lessons: 0, work: 0, play: 0, lastDay: -1 });
  }

  // ------------------------------------------------------------------ 9.1 raising the children

  /** Skills you could teach (you know them well enough). */
  teachable() {
    return Object.keys(SKILLS).filter((s) => (this.p.skills[s]?.level || 0) >= DYNASTY.teachSkill);
  }

  /** Could you spend time with this child now? kind: 'teach' (a skill) · 'work' (come along) · 'play'. */
  canSpend(id, kind, skill = null) {
    const c = this.mine(id);
    if (!c) return { ok: false, reason: 'not_your_child' };
    if (c.age < DYNASTY.childMin || c.age > DYNASTY.childMax) return { ok: false, reason: c.age < DYNASTY.childMin ? 'child_too_young' : 'child_grown' };
    if (this.up(id).lastDay === this.sim.time.day) return { ok: false, reason: 'child_done_today' };
    if (this.p.energy < DYNASTY.lessonEnergy) return { ok: false, reason: 'too_tired' };
    if (kind === 'teach' && !(this.p.skills[skill]?.level >= DYNASTY.teachSkill)) return { ok: false, reason: 'cant_teach_skill', params: { n: DYNASTY.teachSkill } };
    if (kind === 'work' && c.age < DYNASTY.workMin) return { ok: false, reason: 'child_too_young' };
    return { ok: true };
  }

  /** The hour's over: what they took from it. Returns { kind, skill, pts, trait } or a { ok:false } check. */
  spend(id, kind, skill = null) {
    const chk = this.canSpend(id, kind, skill);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const c = this.mine(id);
    const u = this.up(id);
    u.lastDay = sim.time.day;
    this.p.energy = Math.max(0, this.p.energy - DYNASTY.lessonEnergy);
    let pts = 0;
    let trait = null;
    if (kind === 'teach') {
      pts = Math.round(DYNASTY.lessonPts * (1 + (this.p.skills[skill]?.level || 0) / 10));
      u.pts[skill] = (u.pts[skill] || 0) + pts;
      u.lessons++;
      const field = SKILL_FIELD[skill];
      if (field) sim.education?.practise(c, field, 2);
    } else if (kind === 'work') {
      // Along with you at work: the work itself, and the habit of it.
      skill = this.bestSkill();
      pts = Math.round(DYNASTY.lessonPts * 0.6);
      u.pts[skill] = (u.pts[skill] || 0) + pts;
      u.work++;
      if (u.work >= DYNASTY.workTraitAt && !c.traits.includes('hard_worker') && !c.traits.includes('lazy')) {
        c.traits.push('hard_worker');
        trait = 'hard_worker';
      }
    } else {
      u.play++;
      sim.social.addRel(c, DYNASTY.playRel);
      if (sim.education) sim.education.practise(c, 'reading', 1);
    }
    sim.bus.emit('family:changed', id);
    return { ok: true, kind, skill, pts, trait };
  }

  /** Your best skill (what a child picks up at your side). */
  bestSkill() {
    return Object.keys(SKILLS).sort((a, b) => (this.p.skills[b]?.level || 0) - (this.p.skills[a]?.level || 0))[0];
  }

  /** The extra skill levels this child would carry into your place: { skill: levels }. */
  bonusLevels(id) {
    const out = {};
    for (const [s, pts] of Object.entries(this.up(id).pts)) {
      const n = Math.min(DYNASTY.maxBonusLevels, Math.floor(pts / DYNASTY.levelPerPts));
      if (n > 0) out[s] = n;
    }
    return out;
  }

  // ------------------------------------------------------------------ 9.2 the heir

  /** Name your heir (a child of yours). null clears it (the eldest, as before). */
  setHeir(id) {
    if (id !== null && !this.mine(id)) return { ok: false, reason: 'not_your_child' };
    this.D.heir = id;
    this.sim.bus.emit('family:changed', id);
    return { ok: true };
  }

  heir() {
    const h = this.D.heir && this.mine(this.D.heir);
    if (this.D.heir && !h) this.D.heir = null; // (gone: married away, left, died)
    return h || null;
  }

  /** How ready a child is to take over, 0–100: grown up, experienced, taught at home, trained in a role. */
  readiness(id) {
    const c = this.mine(id);
    if (!c) return 0;
    const u = this.up(id);
    const taught = Object.values(u.pts).reduce((a, b) => a + b, 0);
    const role = this.D.roles[id];
    const r = Math.min(1, c.age / 20) * 30 + Math.min(1, (c.level || 1) / 8) * 25 + Math.min(1, taught / 200) * 25 + Math.min(1, (role?.days || 0) / 28) * 20;
    return Math.round(r);
  }

  /** A role for a grown child: 'shadow' (learn your trade at your side) · 'manage' (run a business of yours) · null. */
  canSetRole(id, role, biz = null) {
    const c = this.mine(id);
    if (!c) return { ok: false, reason: 'not_your_child' };
    if (role && c.age < DYNASTY.roleMin) return { ok: false, reason: 'child_too_young' };
    if (role === 'manage') {
      if (!biz || !this.sim.holdings.isMine(biz)) return { ok: false, reason: 'not_your_business' };
      if (Object.entries(this.D.roles).some(([k, r]) => k !== id && r.role === 'manage' && r.biz === biz)) return { ok: false, reason: 'business_has_manager' };
    }
    return { ok: true };
  }

  setRole(id, role, biz = null) {
    const chk = this.canSetRole(id, role, biz);
    if (!chk.ok) return chk;
    if (!role) delete this.D.roles[id];
    else this.D.roles[id] = { role, biz: role === 'manage' ? biz : null, since: this.sim.time.day, days: this.D.roles[id]?.role === role ? this.D.roles[id].days : 0 };
    this.sim.bus.emit('family:changed', id);
    return { ok: true };
  }

  /** A day of training: experience, and what they pick up of the trade. */
  trainDay() {
    const sim = this.sim;
    for (const [id, r] of Object.entries(this.D.roles)) {
      const c = this.mine(id);
      if (!c || (r.role === 'manage' && !sim.holdings.isMine(r.biz))) {
        delete this.D.roles[id];
        continue;
      }
      r.days = (r.days || 0) + 1;
      c.xp = (c.xp || 0) + DYNASTY.roleXpPerDay;
      while (c.xp >= sim.npcs.xpForNext(c.level)) {
        c.xp -= sim.npcs.xpForNext(c.level);
        c.level++;
      }
      const skill = r.role === 'manage' ? 'trading' : this.bestSkill();
      const u = this.up(id);
      u.pts[skill] = (u.pts[skill] || 0) + DYNASTY.rolePtsPerDay;
      if (r.role === 'manage') {
        const b = sim.economy.biz(r.biz);
        if (b) b.reputation = Math.min(100, (b.reputation ?? 50) + 0.1);
      }
    }
  }

  // ------------------------------------------------------------------ 9.3 marriage alliances

  /** The head of a villager's family: the eldest adult among them and their parents (or themselves). */
  headOf(npc) {
    const par = (npc.kin?.parents || []).map((id) => this.sim.npcs.byId(id)).filter((n) => n && n.age >= 30);
    return par.sort((a, b) => (b.money || 0) - (a.money || 0))[0] || npc;
  }

  /** Does a family count for something: a business, the headman's chair, money? */
  powerful(head) {
    const sim = this.sim;
    return !!head.owns || sim.state.civic?.headman === head.id || (head.money || 0) >= DYNASTY.powerMoney || Object.values(sim.property.all).filter((r) => r.owner === head.id).length >= 2;
  }

  /** Who could marry this child of yours: grown, unmarried, not kin, suited — from a family with a head. */
  matchesFor(childId) {
    const sim = this.sim;
    const c = this.mine(childId);
    if (!c || c.age < DYNASTY.matchMin || c.kin.spouse) return [];
    return sim.state.npcs
      .filter((n) => n !== c && !n.away && !this.p.children.includes(n.id) && sim.family.compatible(c, n))
      .map((n) => ({ npc: n, head: this.headOf(n) }))
      .sort((a, b) => (this.powerful(b.head) ? 1 : 0) - (this.powerful(a.head) ? 1 : 0) || (b.head.money || 0) - (a.head.money || 0));
  }

  /** The gift your family brings to theirs. */
  gift(head) {
    return Math.max(DYNASTY.giftMin, Math.round((head.money || 0) * DYNASTY.giftShare));
  }

  canArrange(childId, theirId) {
    const sim = this.sim;
    const c = this.mine(childId);
    const n = sim.npcs.byId(theirId);
    if (!c || !n) return { ok: false, reason: 'not_your_child' };
    if (c.age < DYNASTY.matchMin) return { ok: false, reason: 'child_too_young' };
    if (c.kin.spouse || n.kin.spouse) return { ok: false, reason: 'already_taken' };
    if (!sim.family.compatible(c, n)) return { ok: false, reason: 'not_a_match' };
    const head = this.headOf(n);
    if ((head.rel || 0) < DYNASTY.matchRel) return { ok: false, reason: 'family_not_close', params: { npc: head.id, n: DYNASTY.matchRel } };
    if (sim.time.day - (this.D.refused[head.id] ?? -999) < DYNASTY.refuseDays) return { ok: false, reason: 'family_said_no', params: { npc: head.id } };
    if (this.p.money < this.gift(head)) return { ok: false, reason: 'no_money' };
    return { ok: true, head, gift: this.gift(head) };
  }

  /**
   * Propose the match to their family. They weigh how well they know you, your family's name, your
   * child, and what you bring. Yes: a wedding, and an alliance. No: not again for a while.
   */
  arrange(childId, theirId) {
    const chk = this.canArrange(childId, theirId);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const c = this.mine(childId);
    const n = sim.npcs.byId(theirId);
    const head = chk.head;
    const renown = sim.legacy?.renown?.() || 0;
    const score = (head.rel || 0) / 100 + renown / 60 + (c.level || 1) / 12 + (this.powerful(head) ? -0.1 : 0.1) + hashStr(`match:${childId}:${theirId}`, sim.state.seed) * 0.35;
    if (score < 0.75) {
      this.D.refused[head.id] = sim.time.day;
      sim.social.addRel(head, -2);
      return { ok: true, accepted: false, head: head.id };
    }
    this.p.money -= chk.gift;
    head.money = (head.money || 0) + chk.gift;
    this.wed(c, n, head, 'arranged');
    return { ok: true, accepted: true, head: head.id, gift: chk.gift };
  }

  /** The wedding: they marry (and set up home), the families are allied. */
  wed(child, their, head, how) {
    const sim = this.sim;
    sim.family.marry(child, their);
    this.D.alliances.push({ head: head.id, child: child.id, spouse: their.id, day: sim.time.day, how });
    for (const x of new Set([head, their, ...sim.family.relatives(their)])) if (x && x !== child) sim.social.addRel(x, 10);
    sim.memory.remember(head, 'family_alliance', { who: 'player', params: { npc: child.id, npc2: their.id } });
    sim.chronicle('chronicle.alliance', { npc: child.id, npc2: their.id, npc3: head.id });
    sim.bus.emit('family:changed', child.id);
    sim.bus.emit('dynasty:alliance', { child: child.id, spouse: their.id, head: head.id });
  }

  /** Is this villager of a family yours is allied with (by marriage)? */
  allied(npc) {
    if (!npc) return false;
    for (const a of this.D.alliances) {
      if (a.head === npc.id || a.spouse === npc.id) return true;
      const head = this.sim.npcs.byId(a.head);
      if (head && (head.family || []).includes(npc.id)) return true;
    }
    return false;
  }

  /** Allied families sell to you for less… */
  allyDiscount(owner) {
    return this.allied(owner) ? DYNASTY.allyDiscount : 0;
  }
  /** …and vote for you. */
  allyVote(voter) {
    return this.allied(voter) ? DYNASTY.allyVote : 0;
  }

  /**
   * Weekly: a family that likes you may propose a match for one of your grown children. The offer
   * stands a week. (Chosen by a fixed hash of the week — no dice.)
   */
  proposals() {
    const sim = this.sim;
    const D = this.D;
    D.offers = D.offers.filter((o) => o.until >= sim.time.day && this.mine(o.child) && !this.mine(o.child).kin.spouse);
    if (D.offers.length) return;
    const kids = this.p.children.map((id) => this.mine(id)).filter((c) => c && c.age >= DYNASTY.matchMin && !c.kin.spouse);
    for (const c of kids) {
      const cands = this.matchesFor(c.id).filter(({ head }) => (head.rel || 0) >= 20 && sim.time.day - (D.snubbed[head.id] ?? -999) >= DYNASTY.snubDays);
      if (!cands.length) continue;
      const week = Math.floor(sim.time.day / 7);
      if (hashStr(`offer:${c.id}:${week}`, sim.state.seed) > 0.35) continue;
      const pick = cands[Math.floor(hashStr(`offerpick:${c.id}:${week}`, sim.state.seed) * Math.min(3, cands.length))];
      const o = { id: `mo${sim.time.day}_${c.id}`, head: pick.head.id, their: pick.npc.id, child: c.id, day: sim.time.day, until: sim.time.day + DYNASTY.offerDays };
      D.offers.push(o);
      sim.bus.emit('dynasty:offer', o);
      return;
    }
  }

  /** Say yes to a family's offer (they proposed: no gift needed) — or no (they'll remember). */
  answer(offerId, yes) {
    const sim = this.sim;
    const o = this.D.offers.find((x) => x.id === offerId);
    if (!o) return { ok: false, reason: 'offer_gone' };
    this.D.offers = this.D.offers.filter((x) => x !== o);
    const c = this.mine(o.child);
    const n = sim.npcs.byId(o.their);
    const head = sim.npcs.byId(o.head);
    if (!c || !n || !head) return { ok: false, reason: 'offer_gone' };
    if (!yes) {
      this.D.snubbed[head.id] = sim.time.day;
      sim.social.addRel(head, DYNASTY.snubRel);
      sim.memory.remember(head, 'match_refused', { who: 'player', params: { npc: c.id } });
      return { ok: true, accepted: false };
    }
    if (c.kin.spouse || n.kin.spouse || !sim.family.compatible(c, n)) return { ok: false, reason: 'already_taken' };
    this.wed(c, n, head, 'offered');
    return { ok: true, accepted: true };
  }

  // ------------------------------------------------------------------ 9.4 what the next generation inherits

  /** Just before the torch passes (LineageSystem.succeed): how everyone felt about you. */
  beforeSucceed() {
    this.snap = new Map(this.sim.state.npcs.map((n) => [n.id, n.rel || 0]));
  }

  /**
   * The heir takes over: what they learned at home becomes skill; your allies stay close and your
   * enemies stay enemies (LineageSystem cools everyone's feelings by half otherwise).
   */
  afterSucceed(heirId) {
    const sim = this.sim;
    const p = this.p;
    // Skills taught at home, on top of what's passed down anyway.
    const bonus = heirId ? this.bonusLevels(heirId) : {};
    for (const [s, n] of Object.entries(bonus)) if (p.skills[s]) p.skills[s].level = Math.min(10, p.skills[s].level + n);
    let friends = 0;
    let enemies = 0;
    for (const n of sim.state.npcs) {
      const was = this.snap?.get(n.id);
      if (was === undefined) continue;
      if (this.allied(n)) {
        n.rel = Math.max(n.rel || 0, Math.round(was * DYNASTY.allyKeep));
        friends++;
      } else if (was <= DYNASTY.grudgeAt) {
        n.rel = Math.min(n.rel || 0, Math.round(was * DYNASTY.grudgeKeep));
        if (!this.D.feuds.includes(n.id)) this.D.feuds.push(n.id);
        sim.memory.remember(n, 'inherited_grudge', { who: 'player', params: {} });
        enemies++;
      }
    }
    this.snap = null;
    // The new generation starts afresh: their own children, their own heir.
    for (const id of Object.keys(this.D.up)) if (!p.children.includes(id)) delete this.D.up[id];
    for (const id of Object.keys(this.D.roles)) if (!p.children.includes(id)) delete this.D.roles[id];
    this.D.heir = null;
    this.D.offers = [];
    sim.bus.emit('dynasty:inherited', { friends, enemies, bonus });
    return { friends, enemies, bonus };
  }

  daily() {
    this.trainDay();
    if (this.sim.time.weekday === 5) this.proposals();
  }

  /** For the family screen: everyone in the line, generation by generation. */
  tree() {
    const sim = this.sim;
    const p = this.p;
    const past = sim.state.lineage.map((g) => ({ ...g, past: true }));
    const kids = this.p.children.map((id) => sim.npcs.byId(id) || sim.family.person(id)).filter(Boolean);
    const grandkids = kids.flatMap((k) => (k.kin?.children || []).map((id) => sim.npcs.byId(id)).filter(Boolean));
    return { past, you: { gen: p.generation || 1, spouse: sim.lineage.spouse() }, kids, grandkids };
  }
}
