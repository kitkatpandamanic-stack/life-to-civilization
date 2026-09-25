/**
 * StudySystem — your own education, and what you can do for other people's.
 *
 * Learning: sit in on the evening class at the school; sign up for a course at
 * the trade school; pay someone learned for private lessons; ask a master to
 * take you on as an apprentice and work beside them; read at the library; and,
 * when your travels take you to a university town, study there for a while.
 * What you study makes the matching skill come faster (and counts as your
 * knowledge for everything that asks: teaching, masters, the institute…).
 *
 * Teaching and giving: give a lesson at the school, take on an apprentice of
 * your own, pay for a gifted young person's studies, give books or teachers'
 * pay to a school, fund the institute's research, found a school, a trade
 * school or an institute. None of it makes people yours: an engineer you paid
 * for may come home to work for you — or stay in the town.
 *
 * Timed activities: the scene passes the time (GameScene.study), then calls
 * the matching finish method here.
 *
 *   player.edu = { know, exp, level, course, apprentice, quals, degree, uniWeeks, taughtDay }
 */
import { STAGES, SCHOOL_TYPES } from '../data/education.js';
import { COURSES } from '../data/careers.js';
import { DEGREES, PROJECTS } from '../data/academia.js';
import { FIELD_SKILL, STUDY_PLAYER as SP, FOUNDABLE } from '../data/study.js';
import { EDU_LEVELS } from '../data/education.js';

const OK = { ok: true };
const no = (reason, params) => ({ ok: false, reason, params });

export class StudySystem {
  constructor(sim) {
    this.sim = sim;
    const e = sim.education.ensurePlayer();
    e.quals ??= [];
    e.uniWeeks ??= {};
    sim.state.education.founded ??= [];
    sim.bus.on('construction:changed', (c) => this.foundedDone(c));
  }

  get p() {
    return this.sim.state.player;
  }
  get e() {
    return this.sim.education.ensurePlayer();
  }
  get Ed() {
    return this.sim.education;
  }
  get S() {
    return this.sim.schools;
  }

  /** You learn: knowledge (as for anyone), and skill XP for the skill it trains. */
  learn(field, pts) {
    const gain = this.Ed.learn(this.p, field, pts);
    const skill = FIELD_SKILL[field];
    if (skill && gain > 0) this.sim.progression.addSkillXp(skill, Math.round(gain * SP.xpPerPoint));
    return gain;
  }

  /** Studying a field makes its skill come faster (ProgressionSystem.addSkillXp). */
  xpBonus(skill) {
    let best = 0;
    for (const [f, s] of Object.entries(FIELD_SKILL)) if (s === skill) best = Math.max(best, this.e.know[f] || 0);
    return 1 + best / SP.studyXpBonus;
  }

  qualify(field, how, extra = {}) {
    this.e.quals.push({ field, how, day: this.sim.time.day, ...extra });
    const lvl = how === 'university' ? 'university' : 'vocational';
    if (EDU_LEVELS.indexOf(lvl) > EDU_LEVELS.indexOf(this.e.level)) this.e.level = lvl;
  }

  // ------------------------------------------------------------------ classes

  /** A class you can sit in on at this school right now: { stage, field } or null. */
  classNow(schoolId) {
    const s = this.S.rec(schoolId);
    if (!s || this.sim.time.weekday === 6) return null;
    const h = this.sim.time.hourFloat;
    const wd = this.sim.time.weekday;
    for (const stage of this.S.stagesRunning(s)) {
      const st = STAGES[stage];
      if (!st.adult) continue;
      if (st.days && !st.days.includes(wd)) continue;
      if (h < st.hours[0] - 0.5 || h >= st.hours[1] - 0.5) continue;
      if (st.course) {
        const c = this.e.course;
        if (c?.school === s.id && this.S.courses(s).includes(c.field)) return { stage, field: c.field };
        continue;
      }
      return { stage, field: null };
    }
    return null;
  }

  canAttend(schoolId) {
    if (!this.S.rec(schoolId)) return no('no_school');
    return this.classNow(schoolId) ? OK : no('no_class_now');
  }

  /** Sign up for a trade course (paid now). */
  signUp(schoolId, field) {
    const s = this.S.rec(schoolId);
    if (!s || !this.S.courses(s).includes(field)) return no('no_course');
    if (this.e.course) return no('on_a_course');
    if (this.e.quals.some((q) => q.field === field)) return no('already_qualified');
    if (this.p.money < SP.courseFee) return no('no_money', { money: SP.courseFee });
    this.p.money -= SP.courseFee;
    this.sim.state.village.treasury += SP.courseFee;
    this.e.course = { school: s.id, field, lessons: 0, since: this.sim.time.day };
    this.sim.toast('toast.course_signed', { field, building: s.id }, 'good');
    return OK;
  }

  /** After a class: what you took from it. */
  finishClass(schoolId) {
    const c = this.classNow(schoolId) || (this.e.course?.school === schoolId ? { stage: 'trade_evening', field: this.e.course.field } : { stage: 'evening', field: null });
    const s = this.S.rec(schoolId);
    const q = this.S.quality(s, c.stage, c.field).total || 0.7;
    const def = this.S.stageDef(c.stage, c.field);
    let gained = 0;
    for (const [f, share] of Object.entries(def.subjects || {})) gained += this.learn(f, SP.classPts * share * q);
    const out = { gained, field: c.field };
    if (c.field && this.e.course) {
      this.e.course.lessons++;
      if (this.e.course.lessons >= SP.courseLessons && this.Ed.know(this.p, c.field) >= SP.coursePass) {
        this.qualify(c.field, 'course', { where: schoolId });
        this.sim.chronicle('chronicle.player_course_done', { field: c.field, building: schoolId });
        this.e.course = null;
        out.finished = true;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ private lessons

  /** What this person could teach you (their best field where they know much more than you), and the fee. */
  tutoring(npc) {
    let best = null;
    for (const f of Object.keys(FIELD_SKILL)) {
      const theirs = this.Ed.know(npc, f);
      const mine = this.e.know[f] || 0;
      if (theirs < SP.tutorMinKnow || theirs < mine + 10) continue;
      const score = theirs - mine;
      if (!best || score > best.score) best = { field: f, score, fee: Math.round(SP.tutorFeeBase + theirs / 10) };
    }
    return best;
  }

  canTutor(npc) {
    if (npc.age < 18 || npc.task?.type === 'sleep') return no('busy');
    if (npc.tutoredDay === this.sim.time.day) return no('asked_already');
    const t = this.tutoring(npc);
    if (!t) return no('nothing_to_teach');
    if (this.p.money < t.fee) return no('no_money', { money: t.fee });
    return { ok: true, ...t };
  }

  finishTutoring(npcId) {
    const npc = this.sim.npcs.byId(npcId);
    const t = npc && this.tutoring(npc);
    if (!t) return null;
    npc.tutoredDay = this.sim.time.day;
    this.p.money -= t.fee;
    npc.money += t.fee;
    const skill = 0.7 + this.S.ability(npc) * 0.4;
    const gained = this.learn(t.field, SP.tutorPts * skill);
    this.sim.social.addRel(npc, 1);
    this.sim.memory.remember(npc, 'taught_player', { who: 'player', params: { field: t.field } });
    return { field: t.field, gained, fee: t.fee };
  }

  // ------------------------------------------------------------------ you as an apprentice

  /** The trade a master could teach you (their workplace's trade). */
  masterTrade(npc) {
    const biz = npc.owns || (npc.employer !== 'player' && npc.employer);
    const field = biz && this.sim.careers.bizField(biz);
    return field && this.Ed.competence(npc, field) >= 55 ? { field, biz } : null;
  }

  canAskApprentice(npc) {
    if (this.e.apprentice) return no('already_apprentice');
    const m = this.masterTrade(npc);
    if (!m) return no('not_a_master');
    if (this.e.quals.some((q) => q.field === m.field)) return no('already_qualified');
    const pb = this.sim.social.playerBond(npc);
    if (pb.t + (npc.rel || 0) / 4 < SP.masterAccepts) return no('master_refuses');
    return { ok: true, ...m };
  }

  askApprentice(npc) {
    const c = this.canAskApprentice(npc);
    if (!c.ok) return c;
    this.e.apprentice = { master: npc.id, field: c.field, biz: c.biz, sessions: 0, since: this.sim.time.day };
    this.sim.memory.remember(npc, 'took_player_apprentice', { who: 'player', params: { field: c.field } });
    this.sim.chronicle('chronicle.player_apprenticed', { npc: npc.id, gender: npc.gender, field: c.field });
    return c;
  }

  /** Can you work beside your master now? (At their workplace, while they're at work.) */
  canWorkBeside(buildingId) {
    const a = this.e.apprentice;
    if (!a) return no('not_apprentice');
    const master = this.sim.npcs.byId(a.master);
    if (!master) return no('master_gone');
    const b = this.sim.economy.biz(a.biz);
    if (!b || b.building !== buildingId) return no('wrong_place');
    const working = master.task?.type === 'work' || master.inside === buildingId;
    return working ? { ok: true, master } : no('master_not_working', { npc: master.id });
  }

  finishWorkBeside() {
    const a = this.e.apprentice;
    const master = a && this.sim.npcs.byId(a.master);
    if (!master) return null;
    const factor = this.sim.careers.masterFactor(master, a.field);
    const gained = this.learn(a.field, SP.apprenticePts * factor);
    const skill = FIELD_SKILL[a.field];
    if (skill) this.sim.progression.addSkillXp(skill, SP.apprenticeXp);
    this.Ed.practise(this.p, a.field, 1.2);
    this.p.money += SP.apprenticeWage;
    this.sim.social.addRel(master, 0.5);
    a.sessions++;
    const out = { gained, field: a.field };
    const lvl = skill ? this.p.skills[skill]?.level || 0 : 0;
    if (a.sessions >= SP.apprenticeSessions && (lvl >= 4 || this.Ed.know(this.p, a.field) >= 40)) {
      this.qualify(a.field, 'apprentice', { master: master.id });
      this.sim.memory.remember(master, 'player_journeyman', { who: 'player', params: { field: a.field } });
      this.sim.chronicle('chronicle.player_journeyman', { npc: master.id, gender: master.gender, field: a.field });
      this.e.apprentice = null;
      out.finished = true;
    }
    return out;
  }

  // ------------------------------------------------------------------ you as a teacher

  /** A day class running now that you could teach in: { stage, field } or null. */
  lessonToGive(schoolId) {
    const s = this.S.rec(schoolId);
    if (!s || this.sim.time.weekday === 6) return null;
    const h = this.sim.time.hourFloat;
    for (const stage of this.S.stagesRunning(s)) {
      const st = STAGES[stage];
      if (st.adult || h < st.hours[0] || h >= st.hours[1] - 1) continue;
      if (st.course) {
        const field = Object.keys(COURSES).find((f) => (this.p.skills[FIELD_SKILL[f]]?.level || 0) >= SP.teachSkill && this.S.pupils(s, stage).some((n) => n.edu.enrol.field === f));
        if (field) return { stage, field };
        continue;
      }
      const need = st.teacher || {};
      if (Object.entries(need).every(([f, v]) => this.Ed.know(this.p, f) >= v + 10)) return { stage, field: null };
    }
    return null;
  }

  canGiveLesson(schoolId) {
    if (this.e.taughtDay === this.sim.time.day) return no('taught_today');
    return this.lessonToGive(schoolId) ? OK : no('no_lesson_for_you');
  }

  finishLesson(schoolId) {
    const s = this.S.rec(schoolId);
    const l = this.lessonToGive(schoolId) || { stage: 'primary', field: null };
    this.e.taughtDay = this.sim.time.day;
    const def = this.S.stageDef(l.stage, l.field);
    const skill = 0.6 + (this.p.skills.leadership?.level || 0) * 0.05 + (this.p.attributes?.charisma || 0) * 0.03;
    const pupils = this.S.pupils(s, l.stage).filter((n) => !l.field || n.edu.enrol.field === l.field);
    for (const n of pupils) {
      for (const [f, share] of Object.entries(def.subjects || {})) this.Ed.learn(n, f, 0.6 * share * skill);
      this.sim.social.addRel(n, 1);
    }
    this.sim.progression.addSkillXp('leadership', 12);
    this.p.reputation = (this.p.reputation || 0) + SP.teachReputation;
    if (!this.sim.state.education.firsts.playerTaught) {
      this.sim.state.education.firsts.playerTaught = this.sim.time.day;
      this.sim.chronicle('chronicle.player_taught', { building: schoolId });
    }
    return { pupils: pupils.length };
  }

  /** Your workshop's trade, if you're master enough to take on an apprentice. */
  yourTrade() {
    const shops = this.sim.businesses?.list?.() || [];
    for (const b of shops) {
      const field = { carpentry: 'carpentry', smithy: 'smithing', smithing: 'smithing', bakery: 'cooking', kitchen: 'cooking' }[b.type] || 'carpentry';
      const skill = FIELD_SKILL[field];
      if ((this.p.skills[skill]?.level || 0) >= SP.masterSkill) return { field };
    }
    for (const [f, skill] of [['carpentry', 'carpentry'], ['smithing', 'smithing'], ['building', 'construction'], ['farming', 'farming']]) {
      if ((this.p.skills[skill]?.level || 0) >= SP.masterSkill) return { field: f };
    }
    return null;
  }

  canTakeApprentice(npc) {
    const mine = this.yourTrade();
    if (!mine) return no('not_master_enough', { n: SP.masterSkill });
    if (!this.sim.careers.seekers().includes(npc)) return no('not_looking_for_trade');
    const hire = this.sim.workers.canHire(npc);
    if (!hire.ok) return hire;
    if (this.sim.careers.wantsTrade(npc, mine.field, this.p) < 0.9) return no('wants_other_trade');
    return { ok: true, ...mine };
  }

  takeApprentice(npc) {
    const c = this.canTakeApprentice(npc);
    if (!c.ok) return c;
    const salary = Math.max(4, Math.round(this.sim.workers.expectedSalary(npc) * 0.55));
    this.sim.workers.hire(npc, salary);
    this.sim.careers.start(npc, this.p, 'player', c.field);
    this.sim.memory.remember(npc, 'mentored_by', { who: 'player', params: { npc: 'player' } });
    this.sim.chronicle('chronicle.player_took_apprentice', { npc: npc.id, gender: npc.gender, field: c.field });
    return { ok: true, field: c.field, salary };
  }

  // ------------------------------------------------------------------ sponsoring

  /** A young person who'd go to university if someone paid: { degree, uni, cost } or null. */
  sponsorable(npc) {
    const A = this.sim.academia;
    const want = A.wantsToStudy(npc);
    if (!want || A.funding(npc, want.uni)) return null;
    return { ...want, cost: A.cost(want.uni) };
  }

  canSponsor(npc) {
    const s = this.sponsorable(npc);
    if (!s) return no('no_need');
    if (this.p.money < s.cost) return no('no_money', { money: s.cost });
    return { ok: true, ...s };
  }

  sponsor(npc) {
    const c = this.canSponsor(npc);
    if (!c.ok) return c;
    this.p.money -= c.cost;
    this.sim.memory.remember(npc, 'sponsored_by_player', { who: 'player', params: { settlement: c.uni } });
    for (const par of this.Ed.parentsOf(npc)) this.sim.social.addRel(par, 4);
    this.sim.chronicle('chronicle.player_sponsored', { npc: npc.id, gender: npc.gender, settlement: c.uni, field: c.degree });
    this.sim.academia.go(npc, c.degree, c.uni, { by: 'player', cost: c.cost });
    return c;
  }

  // ------------------------------------------------------------------ giving

  giveBooks(schoolId) {
    const s = this.S.rec(schoolId);
    if (!s) return no('no_school');
    if (this.p.money < SP.booksGift) return no('no_money', { money: SP.booksGift });
    this.p.money -= SP.booksGift;
    s.books = (s.books || 0) + SP.booksPerGift;
    s.gifts = (s.gifts || 0) + SP.booksGift;
    this.gift('chronicle.player_school_gift', { building: s.id });
    return OK;
  }

  /** A month of teachers' pay (it's spent before the village fund's). */
  endowCost(schoolId) {
    const s = this.S.rec(schoolId);
    const weekly = s ? this.S.teachersOf(s).reduce((sum, t) => sum + this.S.salary(t), 0) || 40 : 40;
    return weekly * SP.endowWeeks;
  }

  endowTeachers(schoolId) {
    const s = this.S.rec(schoolId);
    if (!s) return no('no_school');
    const cost = this.endowCost(schoolId);
    if (this.p.money < cost) return no('no_money', { money: cost });
    this.p.money -= cost;
    s.endowment = (s.endowment || 0) + cost;
    s.gifts = (s.gifts || 0) + cost;
    this.gift('chronicle.player_school_gift', { building: s.id });
    return OK;
  }

  fundResearch(instId) {
    const inst = this.sim.academia.institutes().find((i) => i.id === instId);
    if (!inst) return no('no_institute');
    if (this.p.money < SP.researchGift) return no('no_money', { money: SP.researchGift });
    this.p.money -= SP.researchGift;
    inst.endowment = (inst.endowment || 0) + SP.researchGift;
    inst.gifts = (inst.gifts || 0) + SP.researchGift;
    this.gift('chronicle.player_research_gift', { building: instId });
    return OK;
  }

  /** Having given, you may say what the institute works on next. */
  chooseProject(instId, id) {
    const inst = this.sim.academia.institutes().find((i) => i.id === instId);
    if (!inst || !(inst.gifts > 0) || !PROJECTS[id] || !this.sim.academia.possible().includes(id)) return no('cant_choose');
    inst.nextChoice = id;
    return OK;
  }

  /** A gift is remembered (as a deed — at most one a season, per kind). */
  gift(key, params) {
    const season = Math.floor(this.sim.time.day / 14);
    const S = this.sim.state.education;
    S.giftSeason ??= {};
    if (S.giftSeason[key] === season) return;
    S.giftSeason[key] = season;
    this.sim.chronicle(key, params);
  }

  // ------------------------------------------------------------------ founding

  foundCost(type) {
    return Math.round(this.sim.growth.estimate(type) * 1.3);
  }

  canFound(type) {
    const def = FOUNDABLE[type];
    if (!def) return no('cant_found');
    const T = this.sim.tech;
    if (def.needs?.civic && !T.civic(def.needs.civic)) return no('needs_civic', { vbuilding: def.needs.civic });
    const has = this.sim.world.buildingList.some((b) => b.type === type && this.sim.property.rec(b.id));
    const building = this.sim.construction.list.some((c) => c.type === type && c.status === 'site');
    if (building) return no('underway');
    if (has && type !== 'school') return no('have_one');
    const cost = this.foundCost(type);
    if (this.p.money < cost) return no('no_money', { money: cost });
    return { ok: true, cost };
  }

  found(type) {
    const c = this.canFound(type);
    if (!c.ok) return c;
    this.p.money -= c.cost;
    this.sim.state.village.treasury += c.cost; // your money, set aside for it
    const site = this.sim.growth.start('village', type, 'public', { tx: 44, ty: 38 });
    if (!site) {
      this.sim.state.village.treasury -= c.cost;
      this.p.money += c.cost;
      return no('no_lot');
    }
    site.founder = 'player';
    this.sim.state.education.founded.push({ type, site: site.id, day: this.sim.time.day });
    this.sim.chronicle('chronicle.player_founded_school', { vbuilding: type });
    return { ok: true, cost: c.cost, site };
  }

  /** A school you founded, finished: it's known as yours. */
  foundedDone(c) {
    if (c?.founder !== 'player' || c.status === 'site') return;
    const rec = this.S.rec(c.id);
    if (rec) rec.founder = 'player';
  }

  // ------------------------------------------------------------------ reading and the university

  canRead(buildingId) {
    if (this.sim.world.buildings[buildingId]?.type !== 'library' || !this.sim.property.rec(buildingId)) return no('no_library');
    if (!this.Ed.literate(this.p)) return no('cant_read');
    return OK;
  }

  finishReading() {
    const pick = ['lore', 'science', 'reading'][this.sim.time.day % 3];
    const gained = this.learn(pick, SP.readPts) + this.learn('reading', SP.readPts * 0.3);
    this.sim.tech.addKnowledge(0.05);
    return { field: pick, gained };
  }

  /** Degrees you could study for, here in this town (on a journey). */
  degreesAt(settlement) {
    const U = this.sim.academia.uniDef(settlement);
    if (!U || this.p.away?.settlement !== settlement) return [];
    return Object.keys(U.fields).filter((d) => Object.entries(DEGREES[d].entry).every(([f, v]) => this.Ed.know(this.p, f) >= v * 0.8));
  }

  canStudyWeek(settlement, degree) {
    if (!this.degreesAt(settlement).includes(degree)) return no('cant_study_here');
    if (this.e.degree === degree) return no('already_qualified');
    if (this.p.money < SP.uniWeekFee) return no('no_money', { money: SP.uniWeekFee });
    return OK;
  }

  /** A week of lectures (the scene passes the days). */
  finishStudyWeek(settlement, degree) {
    this.p.money -= SP.uniWeekFee;
    const q = this.sim.academia.uniDef(settlement)?.fields[degree] || 1;
    let gained = 0;
    for (const [f, share] of Object.entries(DEGREES[degree].subjects)) gained += this.learn(f, SP.uniPts * share * q);
    this.e.uniWeeks[degree] = (this.e.uniWeeks[degree] || 0) + 1;
    const out = { gained, weeks: this.e.uniWeeks[degree] };
    if (this.e.uniWeeks[degree] >= SP.uniWeeks && this.Ed.know(this.p, degree) >= 45) {
      this.e.degree = degree;
      this.qualify(degree, 'university', { where: settlement });
      this.sim.chronicle('chronicle.player_degree', { field: degree, settlement });
      out.finished = true;
    }
    return out;
  }

  /** What you're doing about your own education, for your character sheet. */
  status() {
    const out = [];
    if (this.e.course) out.push({ key: 'on_course', params: { field: this.e.course.field, building: this.e.course.school, n: this.e.course.lessons, n2: SP.courseLessons } });
    if (this.e.apprentice) out.push({ key: 'apprenticed', params: { npc: this.e.apprentice.master, field: this.e.apprentice.field, n: this.e.apprentice.sessions, n2: SP.apprenticeSessions } });
    for (const [d, w] of Object.entries(this.e.uniWeeks || {})) if (this.e.degree !== d) out.push({ key: 'uni_weeks', params: { field: d, n: w, n2: SP.uniWeeks } });
    return out;
  }

  schoolTypes() {
    return Object.keys(SCHOOL_TYPES);
  }
}
