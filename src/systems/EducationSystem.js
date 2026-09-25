/**
 * EducationSystem — what people know, how they learn, and what they're drawn to.
 *
 * Every villager has a knowledge profile (data/education.js): knowledge in many
 * fields, kept apart from practical experience; aptitudes (no single
 * "intelligence"); motivation that rises and falls with their life; and, from
 * adolescence, interests that sway (never force) what they go on to do.
 *
 * Where learning comes from:
 *   - home: small children pick up speech from the family and reading if a
 *     parent reads; older ones watch a parent at their trade;
 *   - work: every day at the job adds experience, and a little of the theory;
 *   - hobbies: reading, whittling, gardening, cards… (see NPCSystem.finishLeisure);
 *   - school, apprenticeships, study away and books (see the rest of the system).
 *
 * What it changes: how productive people are at work, how fast they gain
 * experience, whom employers hire, what the village can work out (TechSystem).
 *
 *   npc.edu = { know, exp, apt, mot, interest, istr, level }
 *   state.player.edu = { know, level }
 */
import { Rng } from '../core/rng.js';
import { KNOWLEDGE, KNOW_LEVELS, APTITUDES, TEMPERAMENT, TRAIT_APTITUDE, EDU_LEVELS, OCC_FIELDS, ASSIGNMENT_FIELDS, HOBBY_FIELDS, INTERESTS, EDU } from '../data/education.js';
import { SKILLS } from '../data/skills.js';

const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Stable string hash (profiles are seeded from the npc id so they don't disturb the world's dice). */
function hashStr(s, seed = 0) {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return (h ^ (h >>> 15)) >>> 0;
}

export class EducationSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.education ??= {};
    for (const n of sim.state.npcs) this.ensure(n);
    this.ensurePlayer();
    sim.bus.on('npc:added', (id) => {
      const n = sim.npcs.byId(id);
      if (n) this.ensure(n);
    });
    // Newcomers bring what they learned where they come from.
    sim.bus.on('settlement:arrived', (ids) => {
      for (const id of ids) {
        const n = sim.npcs.byId(id);
        if (n) this.seedNewcomer(n);
      }
    });
    sim.bus.on('time:day', () => {
      if (sim.time.weekday === 1) this.weekly();
    });
  }

  get E() {
    return this.sim.state.education;
  }

  /** A little private randomness per villager (and per week), so profiles don't shift the world's dice. */
  rng(npc, salt = '') {
    return new Rng(hashStr(`${npc.id}:${salt}`, this.sim.state.seed));
  }

  // ------------------------------------------------------------------ profiles

  /** Make sure a villager has a knowledge profile (older saves, newborns, newcomers). */
  ensure(npc) {
    if (npc.edu) {
      const e = npc.edu;
      e.know ??= {};
      e.exp ??= {};
      e.apt ??= {};
      e.mot ??= 50;
      e.interest ??= null;
      e.istr ??= 0;
      e.level ??= 'none';
      return e;
    }
    const r = this.rng(npc, 'born');
    const e = (npc.edu = { know: {}, exp: {}, apt: {}, mot: 50, interest: null, istr: 0, level: 'none' });
    this.rollAptitudes(npc, r);
    this.seedKnowledge(npc, r);
    return e;
  }

  /** Aptitudes: part inherited (if we know the parents), part their own, nudged by temperament. */
  rollAptitudes(npc, r) {
    const e = npc.edu;
    const parents = (npc.kin?.parents || []).map((id) => this.sim.family?.person(id) || this.sim.npcs.byId(id)).filter((p) => p?.edu?.apt);
    const gauss = () => (r.float() + r.float() + r.float() - 1.5) * 2; // ~N(0, 1)
    for (const k of [...APTITUDES, ...TEMPERAMENT]) {
      let v = 50 + gauss() * 14;
      if (parents.length) {
        const pa = parents.reduce((s, p) => s + (p.edu.apt[k] ?? 50), 0) / parents.length;
        v = 50 + (pa - 50) * 0.5 + gauss() * 13; // children regress towards the middle
      }
      for (const t of npc.traits || []) v += TRAIT_APTITUDE[t]?.[k] || 0;
      e.apt[k] = Math.round(clamp(v, 5, 98));
    }
    let mot = 50 + (e.apt.curiosity - 50) * 0.3 + (e.apt.discipline - 50) * 0.2;
    if (npc.traits?.includes('ambitious')) mot += 10;
    if (npc.traits?.includes('scholar')) mot += 10;
    if (npc.traits?.includes('lazy')) mot -= 12;
    e.mot = Math.round(clamp(mot, 10, 95));
  }

  /** What a villager already knows when we first meet them (from their age, work and life so far). */
  seedKnowledge(npc, r, { literacy = 1 } = {}) {
    const e = npc.edu;
    const set = (f, v) => {
      if (v >= 1) e.know[f] = round1(Math.max(e.know[f] || 0, clamp(v, 0, 95)));
    };
    const setExp = (f, v) => {
      if (v >= 1) e.exp[f] = round1(Math.max(e.exp[f] || 0, clamp(v, 0, 98)));
    };
    const age = npc.age || 0;
    // Small children: speech from the family, perhaps the first letters.
    if (age < 16) {
      set('speech', Math.min(40, age * 4 + r.range(-3, 5)));
      const schooled = npc.education || 0; // older saves: points from the old village school
      set('reading', schooled * 1.6 + (age >= 6 ? r.range(0, 8) : 0));
      set('writing', schooled * 1.3);
      set('maths', schooled * 1.2 + (age >= 8 ? r.range(0, 6) : 0));
      set('lore', schooled * 0.8 + age * 0.6);
      if (schooled >= 12) e.level = 'primary';
      return;
    }
    // Grown-ups in a village without a school: some read, most a little; trade teaches sums.
    const occ = npc.occupation === 'elder' ? npc.prevOccupation || 'elder' : npc.occupation;
    const trading = ['shopkeeper', 'merchant', 'store_clerk', 'innkeeper', 'carter_master', 'miller'].includes(occ);
    const elder = npc.occupation === 'elder';
    let reading = r.range(2, 30) * literacy + (trading ? 18 : 0) + (npc.traits?.includes('scholar') ? 25 : 0) + (elder ? 18 : 0);
    reading += (npc.education || 0) * 1.2 + (npc.knowledge || 0) * 1.5;
    set('reading', reading);
    set('writing', reading * r.range(0.6, 0.9));
    set('maths', r.range(5, 25) * literacy + (trading ? 22 : 0) + (npc.traits?.includes('scholar') ? 18 : 0) + (elder ? 12 : 0));
    set('lore', Math.min(55, age * 0.5 + r.range(0, 12)));
    set('speech', 20 + (e.apt.social - 50) * 0.4 + r.range(0, 15));
    if ((npc.education || 0) >= 12) e.level = 'primary';
    if (reading >= 30 && e.level === 'none' && r.chance(0.4)) e.level = 'primary';
    // Their trade: years at it (experience) and what they picked up (knowledge).
    const years = Math.max(0, age - 17) * r.range(0.55, 0.9);
    const fields = OCC_FIELDS[occ] || [];
    fields.forEach((f, i) => {
      const share = i === 0 ? 1 : 0.45;
      setExp(f, share * 100 * (1 - Math.exp(-years / 9)));
      set(f, share * Math.min(EDU.practiceKnowCap + 8, 10 + (npc.level || 1) * 2.5 + years * 1.2 + (e.apt[this.mainApt(f)] - 50) * 0.2));
    });
    // A trade they used to have.
    for (const f of OCC_FIELDS[npc.prevOccupation] || []) {
      setExp(f, 25 + r.range(0, 20));
      set(f, 18 + r.range(0, 15));
    }
    // The grown-up has usually found what they like — often (not always) the work they chose.
    if (fields[0] && r.chance(0.6)) this.setInterest(npc, this.interestOfField(fields[0]), 35 + r.range(0, 30));
    else this.setInterest(npc, this.bestInterest(npc, r), 20 + r.range(0, 20));
  }

  /** A newcomer's schooling depends on where they grew up (the bigger towns have schools). */
  seedNewcomer(npc) {
    const S = this.sim.settlements;
    const from = npc.from && S?.get(npc.from);
    const size = from ? S.sizeOf(from.pop) : 'village';
    const literacy = { hamlet: 0.8, village: 1, town: 1.5, city: 1.9 }[size] || 1;
    const r = this.rng(npc, 'arrived');
    const e = npc.edu;
    e.know = {};
    e.exp = {};
    this.seedKnowledge(npc, r, { literacy });
    if (npc.age >= 16 && (size === 'town' || size === 'city')) {
      e.level = r.chance(0.35) ? 'secondary' : 'primary';
      if (npc.age >= 20 && r.chance(0.12)) e.level = 'vocational';
    }
    // What the place is known for, they're likelier to know.
    const cfield = { forest: 'forestry', herding: 'farming', fishing: 'fishing', mining: 'mining', market: 'trade', port: 'trade' }[from && S.def(npc.from)?.character];
    if (cfield && npc.age >= 12) this.learn(npc, cfield, 10 + r.range(0, 15), { raw: true });
  }

  /** The player: some letters and sums; their skills count as knowledge too. */
  ensurePlayer() {
    const p = this.sim.state.player;
    p.edu ??= { know: { reading: 45, writing: 35, maths: 30, lore: 15, speech: 25 }, exp: {}, level: 'primary' };
    p.edu.exp ??= {};
    return p.edu;
  }

  // ------------------------------------------------------------------ reading a profile

  profile(who) {
    if (who === this.sim.state.player || who?.id === 'player') return this.ensurePlayer();
    return this.ensure(who);
  }

  /** Knowledge in a field (the player's skills count). */
  know(who, field) {
    const e = this.profile(who);
    let v = e.know[field] || 0;
    const skill = KNOWLEDGE[field]?.skill;
    if (who === this.sim.state.player && skill) v = Math.max(v, (who.skills?.[skill]?.level || 0) * 9);
    return v;
  }

  exp(who, field) {
    const e = this.profile(who);
    let v = e.exp[field] || 0;
    const skill = KNOWLEDGE[field]?.skill;
    if (who === this.sim.state.player && skill) v = Math.max(v, (who.skills?.[skill]?.level || 0) * 8);
    return v;
  }

  /** "unknown" … "master". */
  levelOf(value) {
    let out = 'unknown';
    for (const [min, id] of KNOW_LEVELS) if (value >= min) out = id;
    return out;
  }

  levelIndex(value) {
    return KNOW_LEVELS.findLastIndex(([min]) => value >= min);
  }

  mainApt(field) {
    return KNOWLEDGE[field]?.apt?.[0] || 'memory';
  }

  /** The field a villager's work practises (their main one), or null. */
  fieldOf(npc) {
    if (npc.employer === 'player') {
      const c = this.sim.state.workers?.[npc.id];
      return ASSIGNMENT_FIELDS[c?.assignment?.type] || null;
    }
    return OCC_FIELDS[npc.occupation]?.[0] || null;
  }

  fieldsOf(occupation) {
    return OCC_FIELDS[occupation] || [];
  }

  /**
   * How good someone is at a line of work, 0–100: knowledge and experience
   * together (practical trades lean on experience; the learned professions on knowledge).
   */
  competence(who, field) {
    if (!field) return 0;
    const w = EDU.competenceKnowWeight[KNOWLEDGE[field]?.cat] ?? 0.5;
    return this.know(who, field) * w + this.exp(who, field) * (1 - w);
  }

  /** Competence in the trade an occupation calls for. */
  competenceFor(npc, occupation) {
    return this.competence(npc, OCC_FIELDS[occupation]?.[0]);
  }

  /** How well someone could run a business in this trade (0 … 1.4), for would-be founders. */
  founderFit(npc, ownerOccupation) {
    const c = this.competenceFor(npc, ownerOccupation);
    const manage = this.competence(npc, 'management') * 0.3 + this.know(npc, 'maths') * 0.15;
    return Math.min(1.4, c / 45 + manage / 100);
  }

  /** Wanting to do it: their interest points at this trade. */
  interestFit(npc, occupation) {
    const e = this.profile(npc);
    const f = OCC_FIELDS[occupation]?.[0];
    return f && e.interest && INTERESTS[e.interest]?.fields.includes(f) ? 0.5 * Math.min(1, e.istr / 60) : 0;
  }

  /**
   * How much a worker adds to working out new know-how (TechSystem): knowing
   * the trade, a head for figures and letters, and a creative streak (≈0.6 … 1.6).
   */
  inventiveness(npc) {
    const e = this.profile(npc);
    const f = this.fieldOf(npc);
    const c = f ? this.competence(npc, f) : 0;
    return Math.max(0.5, 0.6 + c / 160 + ((e.apt.creative ?? 50) - 50) / 150 + (this.know(npc, 'maths') + this.know(npc, 'reading') + this.know(npc, 'science') * 2) / 500);
  }

  /** How good a teacher someone would make: what they know, and how they get it across. */
  teachingScore(npc) {
    const e = this.profile(npc);
    const basics = (this.know(npc, 'reading') + this.know(npc, 'writing') + this.know(npc, 'maths')) / 3;
    return basics * 0.5 + this.know(npc, 'speech') * 0.2 + ((e.apt.social ?? 50) - 50) * 0.15 + (npc.level || 1) * 0.5;
  }

  /** A morning at the old village school (until the school system takes over). */
  lesson(npc, quality) {
    for (const [f, w] of [['reading', 0.3], ['writing', 0.25], ['maths', 0.25], ['lore', 0.15], ['speech', 0.1]]) this.learn(npc, f, w * quality);
  }

  /** Work speed from competence at the job (0.88 … 1.16). */
  productivityMult(npc) {
    const f = this.fieldOf(npc);
    if (!f) return 1;
    return EDU.prodBase + this.competence(npc, f) * EDU.prodSpan;
  }

  /** How an employer rates an applicant for this trade (multiplies the hiring chance). */
  hireMult(npc, occupation) {
    if (!OCC_FIELDS[occupation]?.[0]) return 1;
    return EDU.hireBase + (this.competenceFor(npc, occupation) / 100) * EDU.hireSpan;
  }

  /** Work XP multiplier: understanding the theory makes practice pay. */
  xpMult(npc) {
    const f = this.fieldOf(npc);
    return f ? 0.85 + this.know(npc, f) / EDU.xpKnowBonus : 1;
  }

  /** Literate: can read and write well enough to use it. */
  literate(who) {
    return this.know(who, 'reading') >= 25 && this.know(who, 'writing') >= 15;
  }

  // ------------------------------------------------------------------ learning

  /** How quickly this person learns this field right now (aptitude × motivation × interest). */
  rate(npc, field) {
    const e = this.profile(npc);
    const def = KNOWLEDGE[field];
    if (!def) return 0;
    const apts = def.apt || ['memory'];
    const apt = apts.reduce((s, a) => s + (e.apt?.[a] ?? 50), 0) / apts.length;
    let r = EDU.aptBase + (apt / 100) * EDU.aptSpan;
    r *= EDU.motBase + ((e.mot ?? 50) / 100) * EDU.motSpan;
    if (e.interest && INTERESTS[e.interest]?.fields.includes(field)) r *= 1 + (EDU.interestBonus - 1) * Math.min(1, (e.istr || 0) / 60);
    // Advanced fields need their groundwork: without the basics it barely sinks in.
    for (const [need, min] of Object.entries(def.needs || {})) {
      const have = this.know(npc, need);
      if (have < min) r *= 0.3 + 0.7 * (have / min);
    }
    return r * (this.sim.tech?.mod('learning') ?? 1);
  }

  /**
   * Someone learns: `pts` is what the lesson offers; how much sticks depends on
   * them. Returns the gain. opts.raw skips aptitude and motivation (seeding);
   * opts.cap stops at that level (practice, home teaching).
   */
  learn(npc, field, pts, { raw = false, cap = 100 } = {}) {
    if (!KNOWLEDGE[field] || pts <= 0) return 0;
    const e = this.profile(npc);
    const have = e.know[field] || 0;
    if (have >= cap) return 0;
    const room = Math.max(EDU.roomFloor, (100 - have) / 100);
    const gain = Math.min(cap - have, pts * room * (raw ? 1 : this.rate(npc, field)));
    const before = this.levelIndex(have);
    e.know[field] = round1(have + gain);
    if (this.levelIndex(e.know[field]) > before) this.sim.bus.emit('education:level', { id: npc.id, field, level: this.levelOf(e.know[field]) });
    return gain;
  }

  /** Experience from doing the work. */
  practise(npc, field, pts) {
    if (!KNOWLEDGE[field]) return 0;
    const e = this.profile(npc);
    const have = e.exp[field] || 0;
    const gain = pts * Math.max(EDU.roomFloor, (100 - have) / 100);
    e.exp[field] = round1(have + gain);
    return gain;
  }

  /** A day's work (called by NPCSystem for everyone who worked). */
  worked(npc, mult = 1) {
    const f = this.fieldOf(npc);
    if (!f) return;
    const fields = npc.employer === 'player' ? [f] : this.fieldsOf(npc.occupation);
    fields.forEach((field, i) => {
      const k = (i === 0 ? 1 : EDU.expSecondary / EDU.expPerDay) * mult;
      this.practise(npc, field, EDU.expPerDay * k);
      this.learn(npc, field, EDU.practiceKnowPerDay * k, { cap: EDU.practiceKnowCap });
    });
    this.sim.careers?.onWorked(npc); // a master beside them, or the business's training
  }

  /** A hobby session (called by NPCSystem when one ends). */
  practisedHobby(npc, hobby) {
    const f = HOBBY_FIELDS[hobby];
    if (!f) return;
    this.learn(npc, f, EDU.hobbyKnow, { cap: hobby === 'reading' ? 100 : EDU.hobbyCap });
    if (hobby === 'reading') {
      this.learn(npc, 'lore', EDU.hobbyKnow * 0.6);
      this.learn(npc, 'writing', EDU.hobbyKnow * 0.3);
      // A reader picks up bits of whatever interests them.
      const i = INTERESTS[npc.edu.interest];
      if (i) this.learn(npc, i.fields[0], EDU.hobbyKnow * 0.4, { cap: 40 });
    }
  }

  // ------------------------------------------------------------------ weekly: home, motivation, interests

  weekly() {
    for (const n of this.sim.state.npcs) {
      if (n.away) continue;
      this.ensure(n);
      if (n.age < 16) this.homeLearning(n);
      this.updateMotivation(n);
      if (n.age >= EDU.interestFrom) this.updateInterest(n);
      this.fade(n);
    }
  }

  parentsOf(npc) {
    return (npc.kin?.parents || []).map((id) => this.sim.npcs.byId(id)).filter((p) => p && !p.away);
  }

  /** At home: the family talks, reads to the little ones, and the older ones watch a parent at work. */
  homeLearning(npc) {
    const parents = this.parentsOf(npc).filter((p) => p.homeId && p.homeId === npc.homeId);
    const sibs = (npc.kin?.siblings || []).map((id) => this.sim.npcs.byId(id)).filter((s) => s && s.homeId === npc.homeId && s.age > npc.age);
    const talk = parents.length + sibs.length * 0.4 || 0.3;
    if (npc.age >= 1) this.learn(npc, 'speech', EDU.homeSpeech * Math.min(1.6, talk), { cap: 55 });
    const reader = Math.max(0, ...parents.map((p) => this.know(p, 'reading')), ...sibs.map((s) => this.know(s, 'reading') * 0.6));
    if (npc.age >= 4 && reader >= 20) {
      this.learn(npc, 'reading', EDU.homeReading * (reader / 50), { cap: Math.min(45, reader * 0.7) });
      this.learn(npc, 'maths', EDU.homeReading * 0.5 * (reader / 50), { cap: 25 });
    }
    // Curiosity grows with a curious home (and fades in a dull one), in the early years.
    if (npc.age <= 8) {
      const cur = parents.length ? parents.reduce((s, p) => s + (p.edu?.apt?.curiosity ?? 50), 0) / parents.length : 50;
      npc.edu.apt.curiosity = Math.round(clamp(npc.edu.apt.curiosity + (cur - npc.edu.apt.curiosity) * 0.02 + EDU.homeCuriosity * (reader >= 30 ? 1 : 0), 5, 98));
    }
    // Watching a parent at their trade (never forced on them — it's just familiar).
    if (npc.age >= 6) {
      for (const p of parents) {
        const f = OCC_FIELDS[p.occupation === 'elder' ? p.prevOccupation : p.occupation]?.[0];
        if (!f) continue;
        const skill = this.competence(p, f) / 60;
        this.learn(npc, f, EDU.homeTrade * Math.min(1.3, skill), { cap: EDU.homeTradeCap });
      }
    }
  }

  /**
   * Motivation follows life: temperament, the family (parents who read, a
   * hard-up household), friends, success and failure, and whether learning
   * pays off in this village (skilled jobs, a library).
   */
  motivationTarget(npc) {
    const sim = this.sim;
    const e = npc.edu;
    let m = 50 + (e.apt.curiosity - 50) * 0.35 + (e.apt.discipline - 50) * 0.25;
    if (npc.traits.includes('ambitious')) m += 10;
    if (npc.traits.includes('scholar')) m += 10;
    if (npc.traits.includes('lazy')) m -= 12;
    if (npc.traits.includes('hard_worker')) m += 5;
    // Family: parents who value learning — and the pressure of an empty purse.
    const parents = this.parentsOf(npc);
    if (parents.length) {
      const pr = parents.reduce((s, p) => s + this.know(p, 'reading'), 0) / parents.length;
      m += (pr - 30) * 0.15;
      if (npc.age < 18 && parents.reduce((s, p) => s + p.money, 0) < 30) m -= 6;
    }
    // Friends of their age pull them along (or down).
    const peers = Object.entries(npc.relations || {})
      .filter(([, v]) => v.f >= 30)
      .map(([id]) => sim.npcs.byId(id))
      .filter((o) => o?.edu && Math.abs(o.age - npc.age) <= 6);
    if (peers.length) m += ((peers.reduce((s, o) => s + o.edu.mot, 0) / peers.length) - 50) * 0.2;
    // Success and failure.
    const recent = e.recentGain ?? 0;
    m += Math.min(6, recent * 2);
    if (sim.memory?.has(npc, 'failed_exam')) m -= 8;
    // Does learning pay here? A library, skilled work, a well-read village.
    if (sim.tech?.civic('library')) m += 3;
    m += Math.min(6, (this.E.stats?.skilledShare || 0) * 20);
    // Mood: a miserable life leaves little room for books.
    if ((npc.mood ?? 60) < 30) m -= 6;
    if (npc.age >= 45) m -= (npc.age - 45) * 0.4;
    m += this.extraMotivation(npc); // school, teachers, sponsors, masters
    return clamp(m, 5, 98);
  }

  updateMotivation(npc) {
    const e = npc.edu;
    const target = this.motivationTarget(npc);
    e.mot = Math.round(clamp(e.mot + (target - e.mot) * EDU.motEase, 5, 98));
    e.recentGain = 0;
  }

  interestOfField(field) {
    for (const [id, def] of Object.entries(INTERESTS)) if (def.fields[0] === field) return id;
    for (const [id, def] of Object.entries(INTERESTS)) if (def.fields.includes(field)) return id;
    return null;
  }

  /** How strongly each interest pulls on this person this week. */
  interestScores(npc, r = null) {
    const sim = this.sim;
    const e = npc.edu;
    const h = npc.habits || {};
    const out = {};
    const parents = this.parentsOf(npc);
    const village = this.villageExposure();
    for (const [id, def] of Object.entries(INTERESTS)) {
      let s = 0;
      // What they're good at.
      s += def.apt.reduce((a, k) => a + ((e.apt[k] ?? 50) - 50), 0) / def.apt.length / 8;
      // What they know already.
      s += Math.max(0, ...def.fields.map((f) => this.know(npc, f))) / 12;
      // Hobbies.
      if (def.hobbies.includes(h.hobby)) s += 3;
      // Home: a parent's trade is familiar (it's a pull, not a rule).
      for (const p of parents) {
        const f = OCC_FIELDS[p.occupation]?.[0];
        if (f && def.fields.includes(f)) s += 1.5 + this.competence(p, f) / 50;
      }
      // Their own work (grown-ups).
      const mine = this.fieldOf(npc);
      if (mine && def.fields.includes(mine)) s += 1.5;
      // What the village shows them: mills and wagons, a busy market, builders at work.
      s += village[id] || 0;
      // The people they admire (a teacher, a master) — see the school and apprenticeships.
      s += this.extraInterest(npc, id);
      if (r) s += r.range(-1.5, 1.5);
      out[id] = s;
    }
    return out;
  }

  /** What there is to see in the valley right now, by interest. */
  villageExposure() {
    const day = this.sim.time.day;
    if (this._expDay === day) return this._exp;
    const E = this.sim.economy;
    const count = (types) => types.reduce((s, t) => s + (E.ofType?.(t)?.length || 0), 0);
    this._exp = {
      machines: Math.min(2, count(['mill', 'carters']) * 0.8 + (this.sim.tech?.has('wagons') ? 0.6 : 0)),
      trade: Math.min(2, count(['general_store', 'trading_post', 'warehouse']) * 0.4),
      building: Math.min(2, (this.sim.construction?.list.filter((c) => c.status === 'site').length || 0) * 0.5),
      land: Math.min(2, count(['farm', 'fishery', 'hunting_lodge']) * 0.4),
      crafts: Math.min(2, count(['smithy', 'carpentry', 'bakery']) * 0.4),
      science: this.sim.tech?.civic('library') ? 1 : 0,
      people: 0.4,
    };
    this._expDay = day;
    return this._exp;
  }

  bestInterest(npc, r = null) {
    const s = this.interestScores(npc, r);
    return Object.entries(s).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  setInterest(npc, id, strength) {
    const e = npc.edu;
    const changed = e.interest !== id;
    e.interest = id;
    e.istr = Math.round(clamp(strength, 0, 100));
    return changed;
  }

  /** Adolescents find what they love; grown-ups now and then take to something new. */
  updateInterest(npc) {
    const e = npc.edu;
    const r = this.rng(npc, `i${this.sim.time.day}`);
    if (npc.age >= 18 && e.istr >= 40 && !r.chance(EDU.adultInterestChance)) return;
    const scores = this.interestScores(npc, r);
    const [top, topScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const grow = npc.age < 18 ? EDU.interestGain : EDU.interestGain * 0.5;
    if (!e.interest) {
      if (topScore > 1) {
        this.setInterest(npc, top, 10);
        this.sim.bus.emit('education:interest', { id: npc.id, interest: top });
      }
      return;
    }
    if (top === e.interest) e.istr = Math.min(100, e.istr + grow);
    else if (topScore - scores[e.interest] > EDU.interestSwitchMargin * (1 + e.istr / 40)) {
      this.setInterest(npc, top, 12);
      this.sim.memory?.remember(npc, 'new_interest', { params: { interest: top } });
      this.sim.bus.emit('education:interest', { id: npc.id, interest: top });
    } else e.istr = Math.max(0, e.istr - 1);
  }

  /** Unused knowledge slowly fades (never below what practice keeps fresh). */
  fade(npc) {
    const e = npc.edu;
    const used = new Set(this.fieldsOf(npc.occupation));
    const hobby = HOBBY_FIELDS[npc.habits?.hobby];
    if (hobby) used.add(hobby);
    for (const b of ['reading', 'speech']) used.add(b);
    for (const [f, v] of Object.entries(e.know)) {
      if (v > EDU.fadeAbove && !used.has(f)) e.know[f] = round1(v - EDU.fade);
    }
  }

  /** Hooks for the parts of education that live outside the home (school, masters). */
  extraMotivation(npc) {
    let m = this.sim.schools?.motivationFrom(npc) || 0;
    // Someone from here made a name in science; someone's away at university: it can be done.
    if (npc.age < 30 && this.sim.academia) {
      if (npc.edu?.interest === 'science' && this.sim.academia.famous().length) m += 4;
      if (this.sim.academia.students().length || this.sim.state.npcs.some((n) => n.edu?.level === 'university')) m += 2;
    }
    return m;
  }

  extraInterest(npc, interest) {
    return this.sim.schools?.interestFrom(npc, interest) || 0;
  }

  // ------------------------------------------------------------------ growing up

  /** A child comes of age: what they learned gives them a head start at work. */
  grewUp(npc) {
    const e = this.ensure(npc);
    const basics = ((e.know.reading || 0) + (e.know.maths || 0) + (e.know.writing || 0)) / 3;
    const best = Math.max(0, ...Object.entries(e.know).filter(([f]) => KNOWLEDGE[f]?.cat === 'practical').map(([, v]) => v));
    const bonus = Math.floor(basics / 20 + best / 15);
    if (bonus > 0) npc.level = (npc.level || 1) + bonus;
    if (basics >= 35) this.sim.tech?.addKnowledge(0.5);
    return bonus;
  }

  // ------------------------------------------------------------------ the village as a whole

  /** Education statistics for the valley (describes the world; recomputed on demand). */
  stats() {
    const npcs = this.sim.state.npcs.filter((n) => !n.away);
    const adults = npcs.filter((n) => n.age >= 16);
    const kids = npcs.filter((n) => n.age >= 6 && n.age < 16);
    const byLevel = Object.fromEntries(EDU_LEVELS.map((l) => [l, 0]));
    for (const n of adults) byLevel[this.ensure(n).level]++;
    const literate = npcs.filter((n) => n.age >= 8 && this.literate(n)).length;
    const olderThan8 = npcs.filter((n) => n.age >= 8).length || 1;
    const skilled = {};
    for (const n of adults) {
      for (const f of Object.keys(KNOWLEDGE)) {
        if (this.competence(n, f) >= 50) skilled[f] = (skilled[f] || 0) + 1;
      }
    }
    const skilledPeople = adults.filter((n) => Object.keys(KNOWLEDGE).some((f) => KNOWLEDGE[f].cat !== 'basic' && this.competence(n, f) >= 50)).length;
    const out = {
      pop: npcs.length,
      adults: adults.length,
      children: kids.length,
      literacy: literate / olderThan8,
      byLevel,
      skilled,
      skilledPeople,
      skilledShare: adults.length ? skilledPeople / adults.length : 0,
      avg: Object.fromEntries(Object.keys(KNOWLEDGE).map((f) => [f, adults.length ? round1(adults.reduce((s, n) => s + this.know(n, f), 0) / adults.length) : 0])),
    };
    this.E.stats = { skilledShare: out.skilledShare, literacy: out.literacy, day: this.sim.time.day };
    return out;
  }

  /** The strongest fields of a person: [{ field, know, exp, level }] best first. */
  topFields(who, n = 6) {
    const e = this.profile(who);
    const fields = new Set([...Object.keys(e.know), ...Object.keys(e.exp)]);
    if (who === this.sim.state.player) for (const [f, d] of Object.entries(KNOWLEDGE)) if (d.skill) fields.add(f);
    return [...fields]
      .filter((f) => KNOWLEDGE[f])
      .map((f) => ({ field: f, know: this.know(who, f), exp: this.exp(who, f), level: this.levelOf(this.know(who, f)) }))
      .filter((x) => x.know >= 1 || x.exp >= 1)
      .sort((a, b) => b.know + b.exp - (a.know + a.exp))
      .slice(0, n);
  }

  /** Aptitudes a person stands out in (for "good with their hands", "quick with numbers"). */
  strengths(npc) {
    const e = this.profile(npc);
    return APTITUDES.filter((a) => (e.apt?.[a] ?? 50) >= 65).sort((a, b) => e.apt[b] - e.apt[a]);
  }

  skillOfField(field) {
    const s = KNOWLEDGE[field]?.skill;
    return s && SKILLS[s] ? s : null;
  }
}
