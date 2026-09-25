/**
 * AcademiaSystem — higher learning, and what it brings home.
 *
 * Universities: the valley is too small for one, so its most promising young
 * people travel to study in the towns — each town known for some fields more
 * than others. Someone has to pay (the family, a scholarship for the gifted,
 * the village fund, a sponsor). Two years later they graduate — or fail — and
 * decide whether to come home: family, friends and work for them here pull
 * one way, the town the other. Those who stay away may still come home later,
 * when a post opens for them.
 *
 * Posts: the learned can serve the valley — a doctor at the clinic, an engineer
 * for the village's building and roads, researchers at an institute — paid
 * from the village fund. What they do depends on how well they know their field.
 *
 * Research: an institute works on one project at a time (data/academia.js
 * PROJECTS). It needs researchers who know enough, equipment, and steady
 * funding; progress comes from the work itself, and the outcome — success,
 * a partial result, or failure — from how good the conditions really were.
 * A discovery becomes village know-how (TechSystem) and can make someone famous.
 *
 *   npc.away = { study: settlementId, degree, since, until }
 *   npc.post = { kind, since, days, unpaid }
 *   npc.fame
 *   state.education.institutes[buildingId] = { id, project, progress, equipment, unfunded, done: [] }
 *   state.education.alumni = [{ npc, degree, uni, day }]      (graduates who stayed away)
 *   state.education.discoveries = [{ tech, day, by, institute }]
 */
import { Rng } from '../core/rng.js';
import { UNIVERSITIES, DEGREES, INTEREST_DEGREES, STUDY, POSTS, PROJECTS, RESEARCH } from '../data/academia.js';
import { EDU_LEVELS } from '../data/education.js';
import { BALANCE } from '../config/balance.js';
import { ENTRY_POINT as ENTRY } from './GrowthSystem.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AcademiaSystem {
  constructor(sim) {
    this.sim = sim;
    const E = (sim.state.education ??= {});
    E.institutes ??= {};
    E.alumni ??= [];
    E.discoveries ??= [];
    E.firsts ??= {};
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:hour', (h) => h === 17 && this.researchDay());
    sim.bus.on('npc:removed', () => this.invalidate());
  }

  get E() {
    return this.sim.state.education;
  }
  get Ed() {
    return this.sim.education;
  }
  get time() {
    return this.sim.time;
  }

  rng(salt) {
    let h = (this.sim.state.seed | 0) ^ 0x7a3c5e1;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    return new Rng((h ^ (h >>> 15)) >>> 0);
  }

  invalidate() {
    if (this.sim.tech) this.sim.tech.mods = null;
  }

  onDay() {
    if (this.time.weekday === 3) this.weekly();
  }

  weekly() {
    this.studyWeek();
    this.applications();
    this.staffPosts();
    this.payPosts();
    this.institutesWeek();
    this.invalidate();
  }

  // ------------------------------------------------------------------ universities

  /** Universities the valley knows of (a settlement it has heard of, that has one). */
  universities() {
    const S = this.sim.settlements;
    if (!S) return [];
    const known = new Set(S.known());
    return S.ids().filter((id) => this.uniDef(id) && (known.has(id) || S.get(id)?.contact));
  }

  /** A settlement's university (the old ones in data/academia.js, or one a growing town has founded). */
  uniDef(id) {
    return UNIVERSITIES[id] || this.sim.settlements?.get(id)?.university || null;
  }

  /** The degree (and university) that would suit this person — if they could get in. */
  degreeFor(n) {
    const e = this.Ed.profile(n);
    const list = INTEREST_DEGREES[e.interest] || ['science', 'economics'];
    for (const degree of list) {
      const d = DEGREES[degree];
      if (!Object.entries(d.entry).every(([f, min]) => this.Ed.know(n, f) >= min)) continue;
      const unis = this.universities().filter((u) => this.uniDef(u).fields[degree]).sort((a, b) => this.uniDef(b).fields[degree] - this.uniDef(a).fields[degree]);
      if (unis.length) return { degree, uni: unis[0] };
    }
    return null;
  }

  /** What two years away cost. */
  cost(uni) {
    const U = this.uniDef(uni);
    return Math.round(U.tuition * STUDY.years + U.living * (STUDY.years * BALANCE.time.daysPerSeason * BALANCE.time.seasons.length) / 7);
  }

  /** Who could pay: the family, a scholarship (the gifted), the village fund, or a sponsor already arranged. */
  funding(n, uni) {
    const cost = this.cost(uni);
    if (n.edu?.sponsor) return { by: n.edu.sponsor, cost };
    const family = [n, ...this.Ed.parentsOf(n)];
    const purse = n.money + this.Ed.parentsOf(n).reduce((s, p) => s + p.money * 0.5, 0);
    if (purse >= cost) return { by: 'family', cost, family };
    const e = this.Ed.profile(n);
    const gift = Math.max(e.apt.analytic ?? 50, e.apt.memory ?? 50, e.apt.creative ?? 50);
    if (gift >= STUDY.scholarshipTalent && (e.talented || e.mot >= 75)) return { by: 'scholarship', cost };
    const V = this.sim.state.village;
    if (e.talented && V.treasury >= STUDY.villageBursaryTreasury && this.sim.civic?.V?.policies?.schooling === 'high') return { by: 'village', cost };
    return null;
  }

  /** Would they go? (And can they?) */
  wantsToStudy(n) {
    const e = this.Ed.profile(n);
    if (n.age < STUDY.minAge || n.age > STUDY.maxAge || n.away || n.leaving || n.owns || n.teach || n.post || n.apprentice) return null;
    if (EDU_LEVELS.indexOf(e.level) < EDU_LEVELS.indexOf('primary') || e.mot < STUDY.minMot) return null;
    if (e.enrol && !['evening', 'trade_evening'].includes(e.enrol.stage)) return null;
    if (e.degree) return null;
    const pick = this.degreeFor(n);
    if (!pick) return null;
    let w = e.mot / 100 + (e.talented ? 0.3 : 0) + (EDU_LEVELS.indexOf(e.level) >= EDU_LEVELS.indexOf('secondary') ? 0.2 : 0) + (e.istr || 0) / 200;
    if (n.kin?.spouse) w -= 0.4;
    if ((n.kin?.children || []).length) w -= 0.5;
    if (e.sponsor) w += 0.5;
    return { ...pick, w };
  }

  /** Weekly: the promising and the keen decide whether to go and study. */
  applications() {
    if (!this.universities().length) return;
    for (const n of this.sim.state.npcs.slice()) {
      const want = this.wantsToStudy(n);
      if (!want) continue;
      const r = this.rng(`${n.id}:uni:${this.time.day}`);
      if (want.w < 0.9 + r.float() * 0.5) continue;
      const pay = this.funding(n, want.uni);
      if (!pay) {
        if (!n.edu.cantAfford) {
          n.edu.cantAfford = this.time.day;
          this.sim.memory.remember(n, 'cant_afford_study', { params: { settlement: want.uni } });
          this.sim.bus.emit('education:event', { kind: 'cant_afford', id: n.id, degree: want.degree, uni: want.uni });
        }
        continue;
      }
      this.go(n, want.degree, want.uni, pay);
    }
  }

  /** Off to university: paid for, packed, gone (for two years). */
  go(n, degree, uni, pay) {
    const sim = this.sim;
    if (pay.by === 'family') {
      let due = pay.cost;
      const take = Math.min(n.money, due);
      n.money -= take;
      due -= take;
      for (const p of this.Ed.parentsOf(n)) {
        if (due <= 0) break;
        const t2 = Math.min(p.money * 0.5, due);
        p.money -= t2;
        due -= t2;
      }
    } else if (pay.by === 'village') sim.state.village.treasury -= pay.cost;
    // (A scholarship costs nobody here; a sponsor paid when they agreed to — see sponsor().)
    if (n.edu.enrol) sim.schools?.leave(n, 'finished');
    if (n.employer && n.employer !== 'player') {
      sim.memory.remember(n, 'changed_jobs', { params: { building: sim.economy.biz(n.employer)?.building } });
      n.prevOccupation = n.occupation;
      n.employer = null;
    }
    if (n.employer === 'player') {
      delete sim.state.workers[n.id];
      n.employer = null;
      sim.bus.emit('workers:changed');
    }
    if (n.occupation === 'child') n.occupation = 'unemployed';
    const yearDays = BALANCE.time.daysPerSeason * BALANCE.time.seasons.length;
    n.away = { study: uni, degree, since: this.time.day, until: this.time.day + STUDY.years * yearDays, by: pay.by };
    n.task = null;
    n.plan = null;
    n.inside = 'away';
    sim.npcs.paths.delete(n.id);
    sim.npcs.clearReservation(n);
    sim.memory.remember(n, 'went_to_university', { params: { settlement: uni, field: degree } });
    for (const p of this.Ed.parentsOf(n)) sim.memory.remember(p, 'child_to_university', { who: n.id, params: { npc: n.id, settlement: uni } });
    sim.chronicle(pay.by === 'scholarship' ? 'chronicle.went_to_university_scholarship' : 'chronicle.went_to_university', { npc: n.id, gender: n.gender, settlement: uni, field: degree });
    if (!this.E.firsts.student) {
      this.E.firsts.student = this.time.day;
      sim.chronicle('chronicle.first_student', { npc: n.id, gender: n.gender, settlement: uni, field: degree });
    }
    sim.bus.emit('education:university', { id: n.id, uni, degree });
  }

  students() {
    return this.sim.state.npcs.filter((n) => n.away?.study);
  }

  /** Weekly: the lessons of a university week — and, when the two years are up, the final exam. */
  studyWeek() {
    for (const n of this.students()) {
      const a = n.away;
      const d = DEGREES[a.degree];
      const q = this.uniDef(a.study)?.fields[a.degree] || 1;
      for (const [f, share] of Object.entries(d.subjects)) this.Ed.learn(n, f, STUDY.weeklyPts * share * q * 3);
      this.Ed.practise(n, a.degree, 0.4);
      if (this.time.day >= a.until) this.finishStudies(n);
    }
  }

  finishStudies(n) {
    const sim = this.sim;
    const a = n.away;
    const passed = this.Ed.know(n, a.degree) >= STUDY.mainPass * STUDY.passShare;
    if (passed) {
      n.edu.level = 'university';
      n.edu.degree = a.degree;
      n.edu.quals ??= [];
      n.edu.quals.push({ field: a.degree, how: 'university', day: this.time.day, where: a.study });
      sim.memory.remember(n, 'graduated', { params: { settlement: a.study, field: a.degree } });
      if (!this.E.firsts.graduate) {
        this.E.firsts.graduate = this.time.day;
        sim.chronicle('chronicle.first_university_graduate', { npc: n.id, gender: n.gender, settlement: a.study, field: a.degree });
      }
    } else sim.memory.remember(n, 'failed_degree', { params: { settlement: a.study, field: a.degree } });
    // Home — or not?
    const stay = passed && this.stayAway(n);
    if (stay) return this.settleAway(n);
    this.comeHome(n, passed);
  }

  /** The pull of home against the pull of the town. */
  homePull(n) {
    const sim = this.sim;
    let s = STUDY.returnBase;
    if (n.kin?.spouse && sim.npcs.byId(n.kin.spouse)) s += 0.5;
    s += Math.min(0.5, this.Ed.parentsOf(n).length * 0.2);
    s += Math.min(0.3, Object.values(n.relations || {}).filter((v) => v.f >= 40).length * 0.05);
    if (n.homeId) s += 0.1;
    const prof = DEGREES[n.away?.degree || n.edu?.degree]?.profession;
    if (prof && this.postOpen(prof)) s += 0.5;
    if (n.away?.by === 'village' || n.away?.by === 'player') s += 0.4; // they owe it to the ones who paid
    if (['economics', 'management'].includes(n.away?.degree)) s -= 0.2; // the town has the work for them
    return s;
  }

  stayAway(n) {
    const r = this.rng(`${n.id}:stay`);
    return r.float() * 1.4 > this.homePull(n);
  }

  comeHome(n, passed) {
    const sim = this.sim;
    const a = n.away;
    const at = sim.world.tileCenter(ENTRY.tx, ENTRY.ty);
    delete n.away;
    n.inside = null;
    n.x = at.x;
    n.y = at.y;
    n.task = null;
    n.nextThink = this.time.total;
    n.hunger = Math.max(n.hunger, 50);
    if (n.occupation === 'child') n.occupation = 'unemployed';
    sim.chronicle(passed ? 'chronicle.graduate_returned' : 'chronicle.student_returned', { npc: n.id, gender: n.gender, settlement: a.study, field: a.degree });
    sim.bus.emit('education:returned', { id: n.id, passed, degree: a.degree });
  }

  /** They make their life in the town (remembered — and perhaps called home one day). */
  settleAway(n) {
    const sim = this.sim;
    const a = n.away;
    const snapshot = JSON.parse(JSON.stringify(n));
    delete snapshot.away;
    this.E.alumni.push({ npc: snapshot, degree: a.degree, uni: a.study, day: this.time.day });
    if (this.E.alumni.length > STUDY.alumniKeep) this.E.alumni.shift();
    for (const p of this.Ed.parentsOf(n)) sim.memory.remember(p, 'friend_left', { who: n.id, params: { npc: n.id } });
    sim.chronicle('chronicle.graduate_stayed', { npc: n.id, gender: n.gender, settlement: a.study, field: a.degree });
    const S = sim.settlements?.get(a.study);
    if (S) S.pop += 1;
    delete n.away;
    sim.npcs.departed(n);
  }

  /** A post has opened: a graduate who stayed away may come home for it. */
  recall(kind) {
    const sim = this.sim;
    const i = this.E.alumni.findIndex((x) => DEGREES[x.degree]?.profession === kind);
    if (i < 0) return null;
    const r = this.rng(`recall:${kind}:${this.time.day}`);
    if (!r.chance(STUDY.recallChance)) return null;
    const { npc: snap, uni } = this.E.alumni.splice(i, 1)[0];
    if (sim.npcs.byId(snap.id)) return null;
    const at = sim.world.tileCenter(ENTRY.tx, ENTRY.ty);
    const n = sim.npcs.spawn({ ...snap, x: at.x, y: at.y, homeId: null, inside: null, task: null, employer: null, owns: null, leaving: false, occupation: 'unemployed', relations: snap.relations || {} });
    sim.state.emigrants = (sim.state.emigrants || []).filter((e) => e.id !== n.id);
    const S = sim.settlements?.get(uni);
    if (S) S.pop = Math.max(10, S.pop - 1);
    sim.chronicle('chronicle.graduate_came_home', { npc: n.id, gender: n.gender, settlement: uni });
    return n;
  }

  /** A sponsor pays for someone's studies (you — see PlayerEducation; or a business). */
  sponsor(n, by) {
    this.Ed.profile(n).sponsor = by;
  }

  // ------------------------------------------------------------------ posts

  holders(kind) {
    return this.sim.state.npcs.filter((n) => n.post?.kind === kind && !n.away);
  }

  /** Where a post is held (the building), if the valley has it. */
  postBuilding(kind) {
    const b = POSTS[kind].building;
    if (b === 'hall') return this.sim.world.buildings.hall ? 'hall' : null;
    if (b === 'institute') return this.institutes()[0]?.id || null;
    return this.sim.world.buildingList.find((x) => x.type === b && this.sim.property.rec(x.id))?.id || null;
  }

  /** How many of this post the valley would fill. */
  wanted(kind) {
    if (!this.postBuilding(kind)) return 0;
    const pop = this.sim.state.npcs.length + 1;
    if (kind === 'researcher') return Math.min(3, this.institutes().length * 2 + 1);
    if (kind === 'engineer') return pop >= 26 ? 1 : 0;
    return 1;
  }

  postOpen(kind) {
    return this.holders(kind).length < this.wanted(kind);
  }

  salary(kind) {
    return Math.round(POSTS[kind].salary * (this.sim.civic?.mult('schooling') ?? 1));
  }

  /** Can the village afford another salary (what comes in each week, not just what's in the chest)? */
  affordable(kind) {
    const V = this.sim.state.village;
    const log = V.taxLog?.slice(-4) || [];
    const income = log.length ? log.reduce((s, x) => s + (x.business || 0) + (x.property || 0) + (x.player || 0), 0) / log.length : 0;
    const payroll = ['doctor', 'engineer', 'researcher'].reduce((s, k) => s + this.holders(k).length * this.salary(k), 0) + (this.sim.schools?.list() || []).reduce((s, sc) => s + this.sim.schools.teachersOf(sc).reduce((t, x) => t + this.sim.schools.salary(x), 0), 0);
    return V.treasury >= this.salary(kind) * 4 || income >= payroll + this.salary(kind) * 0.8;
  }

  candidatesFor(kind) {
    const P = POSTS[kind];
    return this.sim.state.npcs
      .filter((n) => n.age >= 20 && n.age < 70 && !n.owns && !n.teach && !n.post && !n.away && !n.leaving && !n.apprentice && n.employer !== 'player')
      .filter((n) => this.Ed.know(n, P.field) >= P.min)
      .filter((n) => ['unemployed', 'elder'].includes(n.occupation) || DEGREES[n.edu?.degree]?.profession === kind || this.salary(kind) >= (n.employer ? this.sim.npcs.wageFor(n.employer, n) * 6 * 0.8 : 0))
      .sort((a, b) => this.Ed.know(b, P.field) - this.Ed.know(a, P.field));
  }

  appoint(n, kind) {
    const sim = this.sim;
    if (n.employer && n.employer !== 'player') {
      sim.memory.remember(n, 'changed_jobs', { params: { building: sim.economy.biz(n.employer)?.building } });
      n.prevOccupation = n.occupation;
      n.employer = null;
    }
    if (n.occupation !== 'elder') n.occupation = kind;
    n.post = { kind, since: this.time.day, days: 0, unpaid: 0 };
    n.task = null;
    sim.memory.remember(n, 'took_post', { params: { post: kind } });
    sim.chronicle(`chronicle.post_${kind}`, { npc: n.id, gender: n.gender, building: this.postBuilding(kind) });
    this.invalidate();
  }

  release(n, why = 'quit') {
    const kind = n.post?.kind;
    delete n.post;
    if (['doctor', 'engineer', 'researcher'].includes(n.occupation)) n.occupation = 'unemployed';
    if (why === 'unpaid') this.sim.chronicle('chronicle.post_quit_unpaid', { npc: n.id, gender: n.gender, post: kind });
    this.invalidate();
  }

  /** Weekly: fill the posts the valley has (a local who knows enough — or a graduate called home). */
  staffPosts() {
    for (const kind of Object.keys(POSTS)) {
      for (const n of this.holders(kind)) if (!this.postBuilding(kind)) this.release(n, 'closed');
      if (!this.postOpen(kind) || !this.affordable(kind)) continue;
      const cand = this.candidatesFor(kind)[0] || this.recall(kind);
      if (cand && this.Ed.know(cand, POSTS[kind].field) >= POSTS[kind].min) this.appoint(cand, kind);
    }
  }

  payPosts() {
    const V = this.sim.state.village;
    for (const kind of Object.keys(POSTS)) {
      for (const n of this.holders(kind)) {
        const due = this.salary(kind);
        const fromReserve = Math.min(due, Math.max(0, V.schoolFund || 0)); // set aside when the taxes came in
        V.schoolFund = (V.schoolFund || 0) - fromReserve;
        const paid = fromReserve + Math.min(due - fromReserve, Math.max(0, V.treasury));
        V.treasury -= paid - fromReserve;
        n.money += paid;
        if (paid < due * 0.6) {
          n.post.unpaid = (n.post.unpaid || 0) + 1;
          if (n.post.unpaid >= 3) this.release(n, 'unpaid');
        } else n.post.unpaid = 0;
      }
    }
  }

  /** Where someone with a post should be right now: { where, role } or null (NPCSystem asks). */
  postFor(n) {
    const p = n.post;
    if (!p || this.time.weekday === 6) return null;
    const def = POSTS[p.kind];
    const h = this.time.hourFloat;
    if (h < def.hours[0] || h >= def.hours[1]) return null;
    const where = this.postBuilding(p.kind);
    return where ? { where, role: p.kind } : null;
  }

  /** How much a post-holder is worth (0…1): how far past the minimum they know their field. */
  strength(n) {
    const def = POSTS[n.post.kind];
    return clamp(0.5 + (this.Ed.know(n, def.field) - def.min) / 60, 0.3, 1.2);
  }

  /** What the valley's doctors and engineers do for it (TechSystem.mod multiplies these in). */
  effects() {
    const out = [];
    for (const kind of ['doctor', 'engineer']) {
      const best = this.holders(kind).sort((a, b) => this.strength(b) - this.strength(a))[0];
      if (!best) continue;
      const s = this.strength(best);
      const eff = {};
      for (const [k, v] of Object.entries(POSTS[kind].effects || {})) eff[k] = 1 - (1 - v) * s;
      out.push(eff);
    }
    return out;
  }

  // ------------------------------------------------------------------ research

  institutes() {
    const out = [];
    for (const b of this.sim.world.buildingList) {
      if (b.type !== 'institute' || !this.sim.property.rec(b.id)) continue;
      this.E.institutes[b.id] ??= { id: b.id, project: null, progress: 0, equipment: 0, unfunded: 0, done: [], founded: this.time.day };
      out.push(this.E.institutes[b.id]);
    }
    return out;
  }

  researchers() {
    return this.holders('researcher');
  }

  /** How well the team fits a project (per field: the best they have against what it needs). */
  fit(team, id) {
    const P = PROJECTS[id];
    const parts = Object.entries(P.fields).map(([f, need]) => Math.min(1.5, Math.max(0, ...team.map((n) => this.Ed.know(n, f))) / need));
    const knowledge = parts.reduce((a, b) => a + b, 0) / parts.length;
    const size = Math.min(1, Math.pow(team.length / P.researchers, 1.5));
    return { knowledge, size };
  }

  /** Projects the institute could take on now (the know-how isn't known yet, and its groundwork is). */
  possible() {
    const T = this.sim.tech;
    return Object.keys(PROJECTS).filter((id) => !T.has(id) && T.ready(id));
  }

  choose(inst) {
    const team = this.researchers();
    if (!team.length) return null;
    const opts = this.possible().map((id) => ({ id, f: this.fit(team, id) })).sort((a, b) => b.f.knowledge * b.f.size - a.f.knowledge * a.f.size);
    return opts[0]?.id || null;
  }

  /** How good the conditions are for the current project (0 … ~1.5): the team, the instruments, steady money, books. */
  quality(inst) {
    if (!inst.project) return { total: 0 };
    const team = this.researchers();
    const f = this.fit(team, inst.project);
    const equipment = 0.6 + 0.4 * Math.min(1, inst.equipment);
    const funding = Math.max(0.4, 1 - (inst.unfunded || 0) * 0.15);
    const library = this.sim.tech?.civic('library') ? 1.08 : 1;
    const printing = this.sim.tech?.has('printing') ? 1.05 : 1;
    return { total: f.knowledge * f.size * equipment * funding * library * printing, knowledge: f.knowledge, team: f.size, equipment, funding, library: library * printing };
  }

  /** Weekly: pick a project (and buy its instruments), pay for the running costs. */
  institutesWeek() {
    const V = this.sim.state.village;
    for (const inst of this.institutes()) {
      inst.equipment = Math.max(0, (inst.equipment || 0) - RESEARCH.equipmentWear);
      if (!inst.project) {
        // A benefactor may have said what to work on next (StudySystem.chooseProject).
        const id = inst.nextChoice && this.possible().includes(inst.nextChoice) ? inst.nextChoice : this.choose(inst);
        delete inst.nextChoice;
        if (!id) continue;
        const P = PROJECTS[id];
        if (!this.pay(inst, P.equipment)) continue;
        inst.project = id;
        inst.progress = this.sim.state.tech.progress[id] || 0;
        inst.equipment = 1;
        inst.unfunded = 0;
        this.sim.chronicle('chronicle.research_started', { building: inst.id, tech: id });
        continue;
      }
      const P = PROJECTS[inst.project];
      if (this.pay(inst, P.funding)) inst.unfunded = Math.max(0, (inst.unfunded || 0) - 1);
      else inst.unfunded = (inst.unfunded || 0) + 1;
    }
  }

  /** Pay for the institute's work: from a benefactor's gift first, then the village fund. */
  pay(inst, amount) {
    const V = this.sim.state.village;
    const gift = Math.min(inst.endowment || 0, amount);
    if (gift + Math.max(0, V.treasury) < amount) return false;
    inst.endowment = (inst.endowment || 0) - gift;
    V.treasury -= amount - gift;
    return true;
  }

  /** End of a working day at the institute: the researchers who were there move the project on. */
  researchDay() {
    if (this.time.weekday === 6) return;
    for (const inst of this.institutes()) {
      if (!inst.project) continue;
      const P = PROJECTS[inst.project];
      const team = this.researchers();
      const present = team.filter((n) => n.inside === inst.id || (n.task?.type === 'school' && n.task.data?.where === inst.id));
      for (const n of present) {
        n.post.days++;
        n.workedToday = true;
        for (const f of Object.keys(P.fields)) this.Ed.learn(n, f, 0.08, { cap: 95 });
        this.Ed.practise(n, 'science', 0.3);
      }
      if (!present.length || (inst.unfunded || 0) >= 3) continue;
      const q = this.quality(inst);
      const pts = present.reduce((s, n) => s + RESEARCH.perResearcherDay * Math.min(1.5, Object.entries(P.fields).reduce((a, [f, need]) => a + this.Ed.know(n, f) / need, 0) / Object.keys(P.fields).length), 0) * q.equipment * q.library;
      inst.progress += pts;
      this.sim.state.tech.progress[inst.project] = Math.min(P.cost * 0.99, inst.progress);
      if (inst.progress >= P.cost) this.outcome(inst);
    }
  }

  /** The work is done: did it work? (It depends on how good the conditions really were.) */
  outcome(inst) {
    const sim = this.sim;
    const id = inst.project;
    const P = PROJECTS[id];
    const q = this.quality(inst).total / RESEARCH.successAt;
    const r = this.rng(`${inst.id}:${id}:${this.time.day}`);
    const pSuccess = clamp(0.1 + 0.75 * q * q, 0.08, 0.95);
    const pPartial = clamp(0.5 * (1 - pSuccess) + 0.1, 0, 1 - pSuccess);
    const roll = r.float();
    const team = this.researchers();
    const lead = team.slice().sort((a, b) => this.Ed.know(b, Object.keys(P.fields)[0]) - this.Ed.know(a, Object.keys(P.fields)[0]))[0] || null;
    if (roll < pSuccess) {
      inst.done.push({ tech: id, day: this.time.day, result: 'success', by: lead?.id });
      this.E.discoveries.push({ tech: id, day: this.time.day, by: lead?.id, institute: inst.id });
      inst.project = null;
      inst.progress = 0;
      sim.tech.discover(id, lead);
      if (lead) this.fame(lead, id);
      sim.chronicle('chronicle.research_success', { building: inst.id, tech: id, npc: lead?.id, gender: lead?.gender });
      if (!this.E.firsts.breakthrough) {
        this.E.firsts.breakthrough = this.time.day;
        sim.chronicle('chronicle.first_breakthrough', { tech: id, npc: lead?.id, gender: lead?.gender });
      }
    } else if (roll < pSuccess + pPartial) {
      inst.done.push({ tech: id, day: this.time.day, result: 'partial' });
      inst.progress = P.cost * RESEARCH.partialKeep;
      for (const n of team) for (const f of Object.keys(P.fields)) this.Ed.learn(n, f, 3, { raw: true });
      sim.tech.addKnowledge(1, 'research');
      sim.chronicle('chronicle.research_partial', { building: inst.id, tech: id });
    } else {
      inst.done.push({ tech: id, day: this.time.day, result: 'failed' });
      inst.progress = P.cost * RESEARCH.failKeep;
      for (const n of team) n.edu.mot = Math.max(10, n.edu.mot - 10);
      sim.chronicle('chronicle.research_failed', { building: inst.id, tech: id });
    }
    sim.state.tech.progress[id] = inst.progress;
    sim.bus.emit('research:outcome', { institute: inst.id, tech: id });
  }

  /** A discovery makes a name (and a famous name draws students, and offers). */
  fame(n, tech) {
    const before = n.fame || 0;
    n.fame = Math.min(100, before + RESEARCH.fameOnDiscovery);
    this.sim.memory.remember(n, 'made_discovery', { params: { tech } });
    if (before < RESEARCH.famousAt && n.fame >= RESEARCH.famousAt) this.sim.chronicle('chronicle.famous_researcher', { npc: n.id, gender: n.gender, tech });
  }

  famous() {
    return this.sim.state.npcs.filter((n) => (n.fame || 0) >= RESEARCH.famousAt);
  }

  /** Should the village build an institute? (A library, a big enough village, and someone who could do research.) */
  wantedBuilding() {
    const sim = this.sim;
    if (this.institutes().length || sim.construction.list.some((c) => c.type === 'institute' && c.status === 'site')) return null;
    if (!sim.tech?.civic('library') || sim.state.npcs.length + 1 < 28) return null;
    const scientist = this.candidatesFor('researcher').length || this.E.alumni.some((a) => DEGREES[a.degree]?.profession === 'researcher');
    return scientist && this.possible().length ? 'institute' : null;
  }

  /** What someone is doing in higher learning, for the UI. */
  statusOf(n) {
    if (n.away?.study) return { key: 'studying_at', params: { settlement: n.away.study, field: n.away.degree, n: Math.floor((this.time.day - n.away.since) / (BALANCE.time.daysPerSeason * BALANCE.time.seasons.length)) + 1 } };
    if (n.post) return { key: `post_${n.post.kind}`, params: { building: this.postBuilding(n.post.kind) } };
    return null;
  }

  summary() {
    const npcs = this.sim.state.npcs;
    return {
      students: this.students().length,
      graduates: npcs.filter((n) => n.edu?.level === 'university').length,
      doctors: this.holders('doctor').length,
      engineers: this.holders('engineer').length,
      researchers: this.researchers().length,
      discoveries: this.E.discoveries.length,
      alumniAway: this.E.alumni.length,
    };
  }
}
