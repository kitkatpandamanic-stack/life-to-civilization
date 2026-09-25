/**
 * SchoolSystem — schools as real places: buildings with classes, pupils who
 * walk there each weekday morning, teachers who are villagers with a post and a
 * wage, seats that run out, and lessons whose worth comes from the conditions
 * in the room.
 *
 * A school runs a class only when it has a teacher who knows enough for it:
 * the village school starts with the little ones' primary class; an upper
 * class needs a teacher with real learning, and grown-ups can come to evening
 * classes to learn their letters. What a pupil takes from a day depends on the
 * teacher (what they know, how well they get it across, how long they've
 * taught), the building's repair, how crowded the room is, whether there are
 * books to go round — and on the pupil (EducationSystem.learn).
 *
 * Families decide: most send their children, but a hard-up household may keep
 * a teenager home to earn, a far walk means missed days, and an unwilling
 * teenager may stop going. At the end of each school year there's an exam:
 * pass and you finish (and may go on); fail and you repeat — or leave, and
 * perhaps come back to it later.
 *
 *   state.education.schools[buildingId] = { id, kind, founded, teachers: [npcId], books, funder, pupilsEver, graduates, turnedAway }
 *   npc.edu.enrol = { school, stage, since, years, fails }
 *   npc.teach = { school, since, days, unpaid }
 */
import { Rng } from '../core/rng.js';
import { BALANCE } from '../config/balance.js';
import { SCHOOL_TYPES, SCHOOL_BUILDINGS, STAGES, SCHOOL, EDU_LEVELS, INTERESTS, OCC_FIELDS } from '../data/education.js';
import { COURSES, VOCATIONAL } from '../data/careers.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SchoolSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.education ??= {};
    sim.state.education.schools ??= {};
    sim.state.education.firsts ??= {};
    this.attendCache = { day: -1, map: new Map() };
    this.migrateOldTeacher();
    sim.bus.on('time:hour', (h) => this.onHour(h));
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('npc:removed', (id) => this.forget(id));
  }

  get S() {
    return this.sim.state.education.schools;
  }
  get Ed() {
    return this.sim.education;
  }
  get time() {
    return this.sim.time;
  }

  rng(salt) {
    let h = (this.sim.state.seed | 0) ^ 0x51ed27;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    return new Rng((h ^ (h >>> 15)) >>> 0);
  }

  /** Older saves: the village's one teacher (TechSystem) becomes a teacher at the school. */
  migrateOldTeacher() {
    const T = this.sim.state.tech;
    if (!T?.teacher) return;
    const n = this.sim.state.npcs.find((x) => x.id === T.teacher);
    const school = this.list()[0];
    if (n && school && !n.teach) this.appoint(school, n, { quiet: true });
    T.teacher = null;
  }

  // ------------------------------------------------------------------ the schools

  /** Every finished school building, with its record (made on first sight). */
  list() {
    const out = [];
    for (const b of this.sim.world.buildingList) {
      const kind = SCHOOL_BUILDINGS[b.type];
      if (!kind || !this.sim.property.rec(b.id) || this.sim.property.rec(b.id).ruined) continue;
      // A new school opens with a first set of primers and slates.
      this.S[b.id] ??= { id: b.id, kind, founded: this.time.day, teachers: [], books: SCHOOL_TYPES[kind].seats, funder: 'village', pupilsEver: 0, graduates: 0, turnedAway: 0 };
      out.push(this.S[b.id]);
    }
    return out;
  }

  rec(id) {
    return this.list().find((s) => s.id === id) || null;
  }

  def(s) {
    return SCHOOL_TYPES[s.kind];
  }

  teachersOf(s) {
    return s.teachers.map((id) => this.sim.npcs.byId(id)).filter((n) => n && !n.away);
  }

  /** Can this teacher take this class? (A trade course: are they competent at the trade?) */
  qualified(n, stage, field = null) {
    const st = STAGES[stage];
    if (st.course) return (field ? [field] : Object.keys(COURSES)).some((f) => this.Ed.competence(n, f) >= VOCATIONAL.instructorMin);
    return Object.entries(st.teacher || {}).every(([f, min]) => this.Ed.know(n, f) >= min);
  }

  /** The trades a trade school can teach right now (someone there is competent at them). */
  courses(s) {
    const teachers = this.teachersOf(s);
    return Object.keys(COURSES).filter((f) => teachers.some((t) => this.qualified(t, 'vocational', f)));
  }

  /** A class's lessons and pass mark (a trade course takes them from its trade). */
  stageDef(stage, field = null) {
    const st = STAGES[stage];
    if (!st.course || !field || !COURSES[field]) return st;
    const subjects = { [field]: VOCATIONAL.share, ...COURSES[field].extra };
    const rest = 1 - Object.values(subjects).reduce((a, b) => a + b, 0);
    if (rest > 0.001) subjects.reading = (subjects.reading || 0) + rest;
    return { ...st, subjects, pass: { [field]: VOCATIONAL.passCompetence } };
  }

  /** Evening classes (grown-ups, two evenings a week) don't take a seat by day. */
  isEvening(stage) {
    return !!STAGES[stage]?.days;
  }

  /** The classes this school can run right now (it needs a teacher who knows enough). */
  stagesRunning(s) {
    const teachers = this.teachersOf(s);
    const def = this.def(s);
    const stages = def.stages.filter((st) => (STAGES[st].course ? this.courses(s).length > 0 : teachers.some((t) => this.qualified(t, st))));
    if (def.evening && teachers.some((t) => this.qualified(t, 'evening'))) stages.push('evening');
    return stages;
  }

  pupils(s, stage = null) {
    return this.sim.state.npcs.filter((n) => n.edu?.enrol?.school === s.id && (!stage || n.edu.enrol.stage === stage) && !n.away);
  }

  /** Day pupils (evening classes don't take a seat in the morning). */
  dayPupils(s) {
    return this.pupils(s).filter((n) => !this.isEvening(n.edu.enrol.stage));
  }

  seats(s) {
    // A school that's been enlarged (a classroom, a new level — StructureSystem) seats more.
    return this.def(s).seats + (s.extraSeats || 0) + (this.sim.structures?.seatBonus(s.id) || 0);
  }

  /** How full it is: pupils per seat, and pupils per teacher's worth of teaching. */
  crowding(s) {
    const n = this.dayPupils(s).length;
    const teachers = this.teachersOf(s).length;
    return { pupils: n, seats: this.seats(s), teachers, perSeat: n / Math.max(1, this.seats(s)), perTeacher: teachers ? n / (teachers * this.def(s).perTeacher) : Infinity };
  }

  hasRoom(s) {
    return this.dayPupils(s).length < Math.floor(this.seats(s) * SCHOOL.crowdCap);
  }

  // ------------------------------------------------------------------ teachers

  /** How well someone gets it across (≈0.7 … 1.6): their way with people, their speech, their patience, and years at it. */
  ability(n) {
    const e = this.Ed.profile(n);
    const days = n.teach?.days || 0;
    return 0.55 + (e.apt.social ?? 50) / 250 + this.Ed.know(n, 'speech') / 250 + (e.apt.discipline ?? 50) / 500 + Math.min(0.35, days / 400);
  }

  rankOf(n) {
    const days = n.teach?.days || 0;
    let rank = 'junior';
    for (const [id, min] of SCHOOL.ranks) if (days >= min) rank = id;
    // A master teacher is also deeply learned.
    if (rank === 'master' && Math.max(this.Ed.know(n, 'reading'), this.Ed.know(n, 'maths'), this.Ed.know(n, 'science')) < SCHOOL.masterKnow) rank = 'senior';
    return rank;
  }

  salary(n) {
    return Math.round(SCHOOL.salary[this.rankOf(n)] * (this.sim.civic?.mult('schooling') ?? 1));
  }

  /** The head: the most experienced (and best) teacher. */
  head(s) {
    return this.teachersOf(s).sort((a, b) => (b.teach?.days || 0) * this.ability(b) - (a.teach?.days || 0) * this.ability(a))[0] || null;
  }

  teacherScore(n, stage = 'primary') {
    const need = STAGES[stage].teacher || {};
    let s = this.Ed.teachingScore(n) + this.ability(n) * 10;
    for (const [f, min] of Object.entries(need)) s += Math.min(20, (this.Ed.know(n, f) - min) / 2);
    const i = n.edu?.interest;
    if (i === 'people' || i === 'science') s += 4;
    return s;
  }

  /** Who would take a teaching post (and teach this class)? Best first. */
  candidates(stage = 'primary') {
    return this.sim.state.npcs
      .filter((n) => n.age >= 18 && n.age < 72 && !n.owns && !n.away && !n.leaving && !n.teach && n.health > 35 && n.occupation !== 'child')
      .filter((n) => n.edu?.enrol?.stage !== 'upper')
      .filter((n) => this.qualified(n, stage) && this.Ed.teachingScore(n) >= SCHOOL.minTeachingScore)
      .filter((n) => this.wouldTeach(n))
      .sort((a, b) => this.teacherScore(b, stage) - this.teacherScore(a, stage));
  }

  /** Would they give up what they do now for a teacher's pay? */
  wouldTeach(n) {
    if (['unemployed', 'elder'].includes(n.occupation)) return true;
    if (n.employer === 'player') return false;
    const wage = n.employer ? this.sim.npcs.wageFor(n.employer, n) * 6 : 0;
    // A calling counts for more than the pay: the learned, the scholarly, those drawn to people or ideas.
    const drawn = 1 + (['people', 'science'].includes(n.edu?.interest) ? 0.35 : 0) + (n.traits.includes('scholar') ? 0.5 : 0) + (this.Ed.know(n, 'reading') >= 40 ? 0.3 : 0) + (n.jobSat !== undefined && n.jobSat < 40 ? 0.3 : 0);
    return SCHOOL.salary.junior * (this.sim.civic?.mult('schooling') ?? 1) * drawn >= wage * 0.8;
  }

  /** Give someone the post. */
  appoint(s, n, { quiet = false } = {}) {
    const sim = this.sim;
    if (n.employer && n.employer !== 'player') {
      sim.memory.remember(n, 'changed_jobs', { params: { building: sim.economy.biz(n.employer)?.building } });
      n.prevOccupation = n.occupation;
      n.employer = null;
    }
    if (n.occupation !== 'elder') n.occupation = 'teacher';
    n.teach = { school: s.id, since: this.time.day, days: n.teach?.days || 0, unpaid: 0 };
    n.task = null;
    if (!s.teachers.includes(n.id)) s.teachers.push(n.id);
    sim.memory.remember(n, 'became_teacher');
    if (!quiet) sim.chronicle('chronicle.new_teacher', { npc: n.id, gender: n.gender, building: s.id });
    sim.bus.emit('school:changed', s.id);
    return n;
  }

  /** They stop teaching (quit, retired, moved on). */
  release(n, why = 'quit') {
    const s = n.teach && this.S[n.teach.school];
    if (s) s.teachers = s.teachers.filter((id) => id !== n.id);
    delete n.teach;
    if (n.occupation === 'teacher') n.occupation = why === 'retired' ? 'elder' : 'unemployed';
    if (s && why === 'unpaid') this.sim.chronicle('chronicle.teacher_quit_unpaid', { npc: n.id, gender: n.gender, building: s.id });
    this.sim.bus.emit('school:changed', s?.id);
  }

  forget(id) {
    for (const s of Object.values(this.S)) s.teachers = s.teachers.filter((t) => t !== id);
  }

  /** Weekly: enough teachers for the pupils (and someone for each class that's wanted), if the fund can pay. */
  staff(s) {
    const sim = this.sim;
    const def = this.def(s);
    const teachers = this.teachersOf(s);
    s.teachers = teachers.map((t) => t.id); // drop the dead and departed
    const pupils = this.dayPupils(s).length + this.pupils(s, 'evening').length * 0.3;
    const wanted = Math.max(1, Math.ceil(pupils / def.perTeacher));
    const budget = this.budgetFor(s);
    const payroll = teachers.reduce((sum, t) => sum + this.salary(t), 0);
    const afford = (extra) => budget >= (payroll + extra) * 2;
    // Is there a class that can't run for want of a qualified teacher (and pupils waiting for it)?
    const missing = def.stages.find((st) => !teachers.some((t) => this.qualified(t, st)) && this.waitingFor(s, st) > 0);
    if (teachers.length < wanted || missing) {
      const stage = missing || def.stages.find((st) => teachers.some((t) => this.qualified(t, st))) || def.stages[0];
      const cand = this.candidates(stage)[0] || null;
      if (cand && (teachers.length === 0 || afford(SCHOOL.salary.junior))) {
        this.appoint(s, cand);
        delete s.shortSince;
      }
      else if (!teachers.length || missing) this.shortage(s, stage);
    }
  }

  /** Children waiting for a class this school can't run yet. */
  waitingFor(s, stage) {
    const st = STAGES[stage];
    return this.sim.state.npcs.filter((n) => n.age >= st.ages[0] && n.age <= st.ages[1] && (n.occupation === 'child' || (st.course && n.occupation === 'unemployed')) && this.eligible(n, stage) && !n.edu?.enrol && !n.apprentice).length;
  }

  /** Nobody here can teach: it's felt, talked about — and in time the village sends word to the towns. */
  shortage(s, stage) {
    s.shortSince ??= this.time.day;
    if (this.time.day - s.shortSince >= SCHOOL.recruitAfter && this.budgetFor(s) >= SCHOOL.salary.teacher * 3) {
      if (this.recruit(s, stage)) return;
    }
    if (this.time.day - (s.shortageDay ?? -99) < 28) return;
    s.shortageDay = this.time.day;
    this.sim.chronicle('chronicle.teacher_shortage', { building: s.id, stage });
    this.sim.bus.emit('education:event', { kind: 'teacher_shortage', school: s.id, stage });
  }

  /** A teacher answers the village's call: they come from a town (with its schooling) and take the post. */
  recruit(s, stage) {
    const sim = this.sim;
    const towns = (sim.settlements?.contacts?.() || []).filter((id) => ['town', 'city'].includes(sim.settlements.sizeOf(sim.settlements.get(id).pop)));
    const from = towns[0] || null;
    const people = sim.growth?.arrive({ size: 1, from: from || undefined }) || [];
    const n = people[0];
    if (!n) return false;
    const e = this.Ed.profile(n);
    const need = STAGES[stage].teacher || {};
    for (const [f, min] of Object.entries(need)) e.know[f] = Math.max(e.know[f] || 0, min + 8 + (n.id.length % 7));
    if (STAGES[stage].course) {
      // An instructor in the trade the valley most needs.
      const f = this.neededCourse();
      e.know[f] = Math.max(e.know[f] || 0, 62);
      e.exp[f] = Math.max(e.exp[f] || 0, 65);
    }
    for (const f of ['reading', 'writing', 'maths', 'lore', 'speech']) e.know[f] = Math.max(e.know[f] || 0, 35);
    if (EDU_LEVELS.indexOf(e.level) < EDU_LEVELS.indexOf(stage === 'upper' ? 'secondary' : 'primary')) e.level = stage === 'upper' ? 'secondary' : 'primary';
    e.interest = 'people';
    e.istr = Math.max(e.istr || 0, 40);
    delete s.shortSince;
    this.appoint(s, n, { quiet: true });
    sim.chronicle(from ? 'chronicle.teacher_recruited' : 'chronicle.teacher_recruited_far', { npc: n.id, gender: n.gender, building: s.id, settlement: from || undefined });
    return true;
  }

  // ------------------------------------------------------------------ money

  /** What's there to pay the school with. */
  budgetFor(s) {
    if (s.funder === 'player') return this.sim.state.player.money;
    if (s.funder && s.funder !== 'village') return this.sim.economy.biz(s.funder)?.money || 0;
    return this.sim.state.village.treasury + (this.sim.state.village.schoolFund || 0) + (s.endowment || 0);
  }

  spend(s, amount) {
    // A gift for the teachers' pay (StudySystem.endowTeachers) is spent first.
    if (s.endowment > 0) {
      const fromGift = Math.min(amount, s.endowment);
      s.endowment -= fromGift;
      if (fromGift >= amount) return amount;
      return fromGift + this.spend({ ...s, endowment: 0 }, amount - fromGift);
    }
    if (s.funder === 'player') {
      const p = this.sim.state.player;
      const paid = Math.min(amount, Math.max(0, p.money));
      p.money -= paid;
      return paid;
    }
    if (s.funder && s.funder !== 'village') {
      const b = this.sim.economy.biz(s.funder);
      const paid = Math.min(amount, Math.max(0, b?.money || 0));
      if (b) {
        b.money -= paid;
        this.sim.economy.ledger(s.funder, 'exp', paid);
      }
      return paid;
    }
    // The village's school money: what it set aside when the taxes came in (reserve), then the fund.
    const V = this.sim.state.village;
    const fromReserve = Math.min(amount, Math.max(0, V.schoolFund || 0));
    V.schoolFund = (V.schoolFund || 0) - fromReserve;
    const paid = Math.min(amount - fromReserve, Math.max(0, V.treasury));
    V.treasury -= paid;
    return fromReserve + paid;
  }

  /** What the village's schools (and its learned posts) cost a week. */
  payroll() {
    let sum = 0;
    for (const s of this.list()) if (s.funder === 'village' || !s.funder) sum += this.teachersOf(s).reduce((a, t) => a + this.salary(t), 0);
    for (const kind of ['doctor', 'engineer', 'researcher']) sum += (this.sim.academia?.holders(kind).length || 0) * (this.sim.academia?.salary(kind) || 0);
    return sum;
  }

  /** Taxes have come in (FinanceSystem): the village sets its teachers' pay aside first (up to a month ahead). */
  reserve() {
    const V = this.sim.state.village;
    const want = this.payroll() * 4 - (V.schoolFund || 0);
    if (want <= 0) return 0;
    const put = Math.min(want, this.payroll() * 1.2, Math.max(0, V.treasury));
    V.treasury -= put;
    V.schoolFund = (V.schoolFund || 0) + put;
    return put;
  }

  /** Weekly: teachers' pay and books. Unpaid teachers don't stay for long. */
  pay(s) {
    for (const t of this.teachersOf(s)) {
      const due = this.salary(t);
      const paid = this.spend(s, due);
      t.money += paid;
      if (paid < due * 0.6) {
        t.teach.unpaid = (t.teach.unpaid || 0) + 1;
        this.sim.memory.remember(t, 'unpaid_wages', { params: { building: s.id } });
        if (t.teach.unpaid >= SCHOOL.quitUnpaidWeeks) this.release(t, 'unpaid');
      } else t.teach.unpaid = 0;
    }
    // Books and slates wear out; the budget buys more.
    const n = this.pupils(s).length;
    s.books = Math.max(0, (s.books || 0) - n * SCHOOL.booksWear);
    const want = n * SCHOOL.booksPerPupil - s.books;
    if (want > 0) {
      const price = SCHOOL.bookPrice * (this.sim.tech?.has('printing') ? 0.5 : 1);
      const budget = n * SCHOOL.budgetPerPupil * (this.sim.civic?.mult('schooling') ?? 1);
      const buy = Math.min(want, Math.floor(budget / price));
      s.books += buy > 0 ? this.spend(s, buy * price) / price : 0;
    }
  }

  // ------------------------------------------------------------------ how good the lessons are

  /**
   * What a day in this class is worth, from the real conditions — each factor
   * is kept so the school can show why.
   */
  quality(s, stage, field = null) {
    const teachers = this.teachersOf(s).filter((t) => this.qualified(t, stage, field));
    const st = this.stageDef(stage, field);
    const subjects = Object.keys(st.subjects || { reading: 1 });
    // The teacher: how well they know what they teach, and how well they teach it.
    let teacher = 0;
    for (const t of teachers) {
      const knows = subjects.reduce((sum, f) => sum + Math.min(1.3, this.Ed.know(t, f) / Math.max(30, (st.pass?.[f] || 30) * 1.2)), 0) / subjects.length;
      teacher = Math.max(teacher, (0.45 + 0.55 * knows) * this.ability(t));
    }
    // A senior colleague who mentors the others lifts everyone a little.
    const mentor = teachers.length > 1 && teachers.some((t) => ['senior', 'master'].includes(this.rankOf(t))) ? 1.05 : 1;
    const cond = this.sim.property.rec(s.id)?.condition ?? 80;
    const building = 0.75 + cond / 400;
    const c = this.crowding(s);
    const crowd = this.isEvening(stage) ? 1 : Math.min(1, Math.pow(1 / Math.max(0.01, c.perSeat), 0.6));
    const ratio = this.isEvening(stage) ? 1 : Math.min(1, Math.pow(1 / Math.max(0.01, c.perTeacher), 0.5));
    const pupils = Math.max(1, this.pupils(s).length);
    const books = 0.85 + 0.3 * Math.min(1, (s.books || 0) / (pupils * SCHOOL.booksPerPupil));
    const library = this.sim.tech?.civic('library') ? 1.05 : 1;
    const total = teacher * mentor * building * crowd * ratio * books * library;
    return { total, teacher, mentor, building, crowd, ratio, books, library };
  }

  // ------------------------------------------------------------------ pupils

  /** Is this pupil ready for this class (and not already past it)? */
  eligible(n, stage, field = null) {
    const st = STAGES[stage];
    const lvl = EDU_LEVELS.indexOf(n.edu?.level || 'none');
    if (st.course) {
      if (st.after && lvl < EDU_LEVELS.indexOf(st.after)) return false;
      if (st.adult && this.Ed.know(n, 'reading') < 15) return false;
      return !field || !(n.edu?.quals || []).some((q) => q.field === field);
    }
    if (st.level && lvl >= EDU_LEVELS.indexOf(st.level)) return false;
    if (st.after && lvl < EDU_LEVELS.indexOf(st.after)) return false;
    if (stage === 'evening') return !this.Ed.literate(n);
    return true;
  }

  /** How much the family (and the pupil) want this schooling — against what it costs them. */
  wantScore(n, stage, s, field = null) {
    const sim = this.sim;
    const e = this.Ed.profile(n);
    const parents = this.Ed.parentsOf(n);
    const pr = parents.length ? parents.reduce((sum, p) => sum + this.Ed.know(p, 'reading'), 0) / parents.length : 20;
    const money = parents.reduce((sum, p) => sum + p.money, 0);
    let w = 0.7 + pr / 120 + e.mot / 250;
    if (stage === 'upper') w = 0.2 + pr / 150 + e.mot / 110 + ((e.apt.analytic ?? 50) + (e.apt.memory ?? 50)) / 400 + (['science', 'trade', 'machines'].includes(e.interest) ? 0.15 : 0);
    // A trade course: for those the trade draws, with the hands for it.
    if (stage === 'vocational') w = 0.25 + e.mot / 150 + ((e.apt.practical ?? 50) - 50) / 150 + (INTERESTS[e.interest]?.fields.includes(field) ? 0.35 + (e.istr || 0) / 200 : 0) + pr / 300;
    // A hard-up home needs a teenager's hands (or wages).
    if (n.age >= SCHOOL.workAge && money < SCHOOL.poorHousehold) w -= 0.35;
    // Fees, when the village charges them.
    if (this.fee(s) > 0 && money < 60) w -= 0.2;
    // A long walk.
    if (this.distance(n, s) > SCHOOL.farWalk) w -= 0.15;
    // Friends go too.
    const friends = Object.entries(n.relations || {}).filter(([id, v]) => v.f >= 30 && sim.npcs.byId(id)?.edu?.enrol?.school === s.id).length;
    w += Math.min(0.2, friends * 0.07);
    return w;
  }

  /** Weekly fee a family pays (only when the schooling policy is tight). */
  fee(s) {
    return this.sim.civic?.V?.policies?.schooling === 'low' && s.funder === 'village' ? 2 : 0;
  }

  distance(n, s) {
    const home = n.homeId && this.sim.world.buildings[n.homeId];
    const b = this.sim.world.buildings[s.id];
    if (!home || !b) return 0;
    return Math.abs(home.door.tx - b.door.tx) + Math.abs(home.door.ty - b.door.ty);
  }

  /** The nearest school running this class (and course) with room to spare. */
  schoolWith(n, stage, field = null) {
    return this.list()
      .filter((s) => this.stagesRunning(s).includes(stage) && (!field || this.courses(s).includes(field)) && (this.isEvening(stage) || this.hasRoom(s)))
      .sort((a, b) => this.distance(n, a) - this.distance(n, b))[0] || null;
  }

  enrol(n, s, stage, how = 'family', field = null) {
    const e = this.Ed.profile(n);
    e.enrol = { school: s.id, stage, since: this.time.day, years: 0, fails: 0, how };
    if (field) e.enrol.field = field;
    s.pupilsEver = (s.pupilsEver || 0) + 1;
    if (field && !this.sim.state.education.firsts.course) {
      this.sim.state.education.firsts.course = this.time.day;
      this.sim.chronicle('chronicle.first_course', { building: s.id, npc: n.id, gender: n.gender, field });
    }
    if (!this.isEvening(stage) && !STAGES[stage].course && !this.sim.state.education.firsts.pupil) {
      this.sim.state.education.firsts.pupil = this.time.day;
      this.sim.chronicle('chronicle.first_pupils', { building: s.id, npc: n.id, gender: n.gender });
    }
    this.sim.bus.emit('school:enrolled', { id: n.id, school: s.id, stage });
  }

  leave(n, why) {
    const e = n.edu;
    if (!e?.enrol) return;
    const stage = e.enrol.stage;
    e.left = { stage, day: this.time.day, why };
    delete e.enrol;
    if (why === 'dropped' || why === 'failed' || why === 'work') this.sim.memory.remember(n, why === 'failed' ? 'failed_exam' : 'left_school', { params: { edu_level: STAGES[stage].level || 'primary' } });
  }

  /** Families decide about school (weekly, and whenever a school opens its doors). */
  enrolments() {
    const schools = this.list();
    if (!schools.length) return;
    for (const n of this.sim.state.npcs) {
      if (n.away || n.leaving || n.edu?.enrol || n.teach) continue;
      const e = this.Ed.profile(n);
      // Children and teenagers: day classes.
      if (n.occupation === 'child' || (n.age <= 17 && e.level !== 'secondary' && n.occupation === 'unemployed')) {
        // Dropped out not long ago? Not yet (people can come back to it later).
        if (e.left && this.time.day - e.left.day < 56) continue;
        // What's on offer for them — the next class, or a trade course — and which they'd rather.
        const options = [];
        for (const stage of ['primary', 'upper']) {
          const st = STAGES[stage];
          if (n.age < st.ages[0] || n.age > st.ages[1] || !this.eligible(n, stage)) continue;
          const s = this.schoolWith(n, stage);
          if (s) options.push({ stage, s, w: this.wantScore(n, stage, s) });
          else {
            const full = this.list().find((x) => this.stagesRunning(x).includes(stage));
            if (full && !this.hasRoom(full)) full.turnedAway = (full.turnedAway || 0) + 1;
          }
        }
        if (n.age >= STAGES.vocational.ages[0] && !n.apprentice) {
          const field = this.courseFor(n);
          const s = field && this.schoolWith(n, 'vocational', field);
          if (s && this.eligible(n, 'vocational', field)) options.push({ stage: 'vocational', s, field, w: this.wantScore(n, 'vocational', s, field) });
        }
        const best = options.sort((a, b) => b.w - a.w)[0];
        if (best) {
          const r = this.rng(`${n.id}:${best.stage}:${Math.floor(this.time.day / 7)}`);
          if (best.w >= 0.55 + r.float() * 0.4) this.enrol(n, best.s, best.stage, best.field ? 'self' : 'family', best.field || null);
        }
        continue;
      }
      // Young people past school age: a trade course, if the trade draws them.
      if (n.age > 17 && n.age >= STAGES.vocational.ages[0] && n.age <= STAGES.vocational.ages[1] && !n.apprentice && (n.occupation === 'child' || n.occupation === 'unemployed')) {
        const field = this.courseFor(n);
        const s = field && this.schoolWith(n, 'vocational', field);
        if (s && this.eligible(n, 'vocational', field)) {
          const r = this.rng(`${n.id}:voc:${Math.floor(this.time.day / 7)}`);
          if (this.wantScore(n, 'vocational', s, field) >= 0.55 + r.float() * 0.4) {
            this.enrol(n, s, 'vocational', 'self', field);
            continue;
          }
        }
      }
      // Grown-ups starting over: an evening course in the trade they want.
      if (e.retrain && n.age >= 18 && n.age <= 50 && !n.apprentice) {
        const s = this.schoolWith(n, 'trade_evening', e.retrain);
        if (s && this.eligible(n, 'trade_evening', e.retrain)) {
          this.enrol(n, s, 'trade_evening', 'self', e.retrain);
          continue;
        }
      }
      // Grown-ups: evening classes to learn their letters, if they want to.
      if (n.age >= 16 && n.age <= 70 && this.eligible(n, 'evening') && (e.mot >= SCHOOL.eveningMot || (e.interest === 'science' && e.mot >= 40))) {
        const s = this.schoolWith(n, 'evening');
        if (s) this.enrol(n, s, 'evening', 'self');
      }
    }
  }

  /** Does this pupil make it to school today? (Asked once a day.) */
  attends(n) {
    const day = this.time.day;
    if (this.attendCache.day !== day) this.attendCache = { day, map: new Map() };
    const hit = this.attendCache.map.get(n.id);
    if (hit !== undefined) return hit;
    const s = this.S[n.edu.enrol.school];
    const r = this.rng(`${n.id}:att:${day}`);
    let p = 0.97;
    const far = s && this.distance(n, s) > SCHOOL.farWalk;
    if (far) p -= this.time.season === 'winter' ? 0.35 : 0.12;
    if (this.sim.weather?.type === 'storm' || this.sim.weather?.type === 'snow') p -= 0.1;
    if (n.age >= 12 && n.edu.mot < 35) p -= (35 - n.edu.mot) / 60; // skipping
    const ok = r.float() < p;
    this.attendCache.map.set(n.id, ok);
    return ok;
  }

  /** The class someone should be in right now: { where, role } or null (NPCSystem asks). */
  schoolFor(n) {
    const wd = this.time.weekday;
    if (wd === 6) return null;
    const h = this.time.hourFloat;
    if (n.teach) {
      const s = this.S[n.teach.school];
      if (!s) return null;
      for (const stage of this.stagesRunning(s)) {
        const st = STAGES[stage];
        if (st.days && !st.days.includes(wd)) continue;
        if (h >= st.hours[0] && h < st.hours[1] && this.qualified(n, stage) && (!this.isEvening(stage) || this.pupils(s, stage).length)) {
          if (this.isEvening(stage) && this.eveningTeacher(s, stage) !== n) continue;
          return { where: s.id, role: 'teacher', stage };
        }
      }
      return null;
    }
    const en = n.edu?.enrol;
    if (!en) return null;
    const st = STAGES[en.stage];
    if (st.days && !st.days.includes(wd)) return null;
    if (h < st.hours[0] || h >= st.hours[1]) return null;
    const s = this.S[en.school];
    if (!s || !this.stagesRunning(s).includes(en.stage)) return null;
    if (!this.attends(n)) return null;
    return { where: s.id, role: this.isEvening(en.stage) ? 'evening' : 'pupil', stage: en.stage };
  }

  /** Who takes an evening class (the best teacher who can take it). */
  eveningTeacher(s, stage = 'evening') {
    return this.teachersOf(s).filter((t) => this.qualified(t, stage)).sort((a, b) => this.ability(b) - this.ability(a))[0] || null;
  }

  /** The trade course that would suit this youngster (interest first, then the family trade), if one's taught. */
  courseFor(n) {
    const offered = new Set(this.list().flatMap((s) => this.courses(s)));
    if (!offered.size) return null;
    const e = this.Ed.profile(n);
    const fromInterest = (INTERESTS[e.interest]?.fields || []).find((f) => offered.has(f));
    if (fromInterest) return fromInterest;
    const fromHome = this.Ed.parentsOf(n).map((p) => OCC_FIELDS[p.occupation]?.[0]).find((f) => offered.has(f));
    return fromHome || null;
  }

  /** The trade the valley is shortest of (for an instructor sent for from the towns). */
  neededCourse() {
    const E = this.sim.economy;
    const short = E.active().filter((id) => E.biz(id).shortageStep).map((id) => this.sim.careers?.bizField(id)).find((f) => COURSES[f]);
    return short || 'building';
  }

  // ------------------------------------------------------------------ the school day

  onHour(h) {
    if (this.time.weekday === 6) return;
    for (const s of this.list()) {
      for (const stage of this.stagesRunning(s)) {
        const st = STAGES[stage];
        if (st.days && !st.days.includes(this.time.weekday)) continue;
        if (h === Math.ceil(st.hours[1])) this.lessons(s, stage);
      }
    }
  }

  present(n, s) {
    return n.inside === s.id || (n.task?.type === 'school' && n.task.data?.where === s.id && n.task.stage === 'inside');
  }

  /** The end of a school day: whoever was in class learned something. */
  lessons(s, stage) {
    const sim = this.sim;
    const st = STAGES[stage];
    const pupils = this.pupils(s, stage).filter((n) => this.present(n, s));
    const pts = stage === 'evening' ? SCHOOL.eveningPts : stage === 'trade_evening' ? VOCATIONAL.eveningPts : SCHOOL.dayPts;
    const qCache = {};
    for (const n of pupils) {
      const field = n.edu.enrol.field || null;
      const q = (qCache[field] ??= this.quality(s, stage, field));
      const def = this.stageDef(stage, field);
      let gained = 0;
      for (const [f, share] of Object.entries(def.subjects || {})) gained += this.Ed.learn(n, f, pts * share * q.total);
      if (field) this.Ed.practise(n, field, 0.15); // workshop practice
      n.edu.recentGain = (n.edu.recentGain || 0) + gained;
      n.edu.schoolDays = (n.edu.schoolDays || 0) + 1;
    }
    // Classmates get to know each other; pupils and their teacher too.
    for (let i = 0; i + 1 < pupils.length; i++) {
      const a = pupils[i];
      const b = pupils[(i + 1 + (this.time.day % Math.max(1, pupils.length - 1))) % pupils.length];
      if (a !== b) sim.social.adjust(a, b, { f: 0.6, t: 0.3 });
    }
    // The teachers: a day's teaching (experience, and they keep their own learning fresh).
    const teachers = this.teachersOf(s).filter((t) => this.present(t, s) && this.qualified(t, stage));
    for (const t of teachers) {
      t.teach.days = (t.teach.days || 0) + (this.isEvening(stage) ? 0.5 : 1);
      t.workedToday = true;
      this.Ed.practise(t, 'speech', 0.3);
      for (const f of Object.keys(st.subjects || {})) this.Ed.learn(t, f, 0.05, { cap: 90 });
      for (const p of pupils.slice(0, 4)) sim.social.adjust(p, t, { r: 0.4, t: 0.2 });
    }
    if (pupils.length) sim.tech?.addKnowledge(0.02 * pupils.length);
  }

  onDay() {
    if (this.time.weekday === 1) this.weekly();
    const T = BALANCE.time;
    if (this.time.day > 0 && this.time.day % (T.daysPerSeason * T.seasons.length) === 0) this.yearEnd();
  }

  weekly() {
    for (const s of this.list()) {
      this.staff(s);
      this.pay(s);
      this.fees(s);
      // Too many pupils for the room: people notice (and the village thinks of building more).
      const c = this.crowding(s);
      if (c.perSeat > 1.1 || (c.teachers && c.perTeacher > 1.25)) {
        s.crowdedWeeks = (s.crowdedWeeks || 0) + 1;
        if (s.crowdedWeeks === 2) sim_chronicle(this.sim, 'chronicle.school_overcrowded', { building: s.id, n: c.pupils, n2: c.seats });
      } else s.crowdedWeeks = 0;
    }
    this.enrolments();
    this.dropouts();
  }

  /** Fees (a tight schooling policy): families pay — or take the child out. */
  fees(s) {
    const fee = this.fee(s);
    if (!fee) return;
    for (const n of this.dayPupils(s)) {
      const payer = this.Ed.parentsOf(n).sort((a, b) => b.money - a.money)[0];
      if (payer && payer.money >= fee) {
        payer.money -= fee;
        this.sim.state.village.treasury += fee;
      } else this.leave(n, 'work');
    }
  }

  /** Teenagers who've lost heart, or whose family needs their hands, stop going. */
  dropouts() {
    for (const n of this.sim.state.npcs) {
      const en = n.edu?.enrol;
      if (!en) continue;
      if (en.stage === 'evening') {
        if (this.Ed.literate(n) || n.edu.mot < 30) this.leave(n, this.Ed.literate(n) ? 'finished' : 'dropped');
        continue;
      }
      if (en.stage === 'trade_evening') {
        if (n.edu.mot < 30 || n.apprentice) this.leave(n, 'dropped');
        continue;
      }
      if (n.age < SCHOOL.workAge) continue;
      const r = this.rng(`${n.id}:drop:${this.time.day}`);
      const money = this.Ed.parentsOf(n).reduce((s, p) => s + p.money, 0);
      if (n.edu.mot < SCHOOL.dropoutMot && r.chance(0.25)) this.leave(n, 'dropped');
      else if (money < SCHOOL.poorHousehold * 0.5 && n.age >= 14 && r.chance(0.12)) this.leave(n, 'work');
    }
  }

  // ------------------------------------------------------------------ the school year

  /** Did they learn what the class set out to teach? */
  passes(n, stage) {
    return Object.entries(this.stageDef(stage, n.edu?.enrol?.field).pass || {}).every(([f, min]) => this.Ed.know(n, f) >= min);
  }

  /** How close they are to passing (0–1), for the UI. */
  progress(n, stage) {
    const pass = this.stageDef(stage, n.edu?.enrol?.field).pass || {};
    const parts = Object.entries(pass).map(([f, min]) => Math.min(1, this.Ed.know(n, f) / min));
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  }

  /** End of the school year: exams, graduations, repeats. */
  yearEnd() {
    const sim = this.sim;
    const firsts = sim.state.education.firsts;
    for (const n of sim.state.npcs.slice()) {
      const en = n.edu?.enrol;
      if (!en || en.stage === 'evening') continue;
      const st = this.stageDef(en.stage, en.field);
      en.years++;
      if (en.years < st.minYears && n.age <= st.ages[1]) continue;
      if (this.passes(n, en.stage)) {
        const s = this.S[en.school];
        if (EDU_LEVELS.indexOf(st.level) > EDU_LEVELS.indexOf(n.edu.level)) n.edu.level = st.level;
        if (en.field) {
          n.edu.quals ??= [];
          n.edu.quals.push({ field: en.field, how: 'course', day: this.time.day });
        }
        if (s) s.graduates = (s.graduates || 0) + 1;
        sim.memory.remember(n, en.field ? 'finished_course' : 'finished_school', { params: { edu_level: st.level, field: en.field || undefined } });
        sim.bus.emit('education:graduated', { id: n.id, level: st.level, school: en.school, field: en.field || null });
        const key = `grad_${st.level}`;
        if (!firsts[key]) {
          firsts[key] = this.time.day;
          sim.chronicle(`chronicle.first_graduate_${st.level}`, { npc: n.id, gender: n.gender, building: en.school });
        }
        delete n.edu.enrol;
        // Straight on to the upper class, if they want to and there's one.
        if (st.level === 'primary' && n.age <= STAGES.upper.ages[1]) {
          const next = this.schoolWith(n, 'upper');
          if (next && this.wantScore(n, 'upper', next) >= 0.8) this.enrol(n, next, 'upper');
        }
      } else if (en.fails + 1 >= SCHOOL.failLimit || n.age > st.ages[1]) {
        this.leave(n, 'failed');
      } else {
        en.fails++;
        n.edu.mot = Math.max(5, n.edu.mot - 8);
        sim.memory.remember(n, 'failed_exam', { params: { edu_level: st.level } });
      }
    }
    this.talent();
  }

  /** Now and then a teacher notices a pupil with a real gift. */
  talent() {
    const sim = this.sim;
    for (const n of sim.state.npcs) {
      const en = n.edu?.enrol;
      if (!en || this.isEvening(en.stage) || n.edu.talented) continue;
      const e = n.edu;
      const best = Math.max(e.apt.analytic, e.apt.memory, e.apt.creative);
      if (best >= 78 && e.mot >= 60 && this.progress(n, en.stage) >= 0.6) {
        e.talented = this.time.day;
        const teacher = this.head(this.S[en.school]);
        sim.chronicle('chronicle.talented_pupil', { npc: n.id, gender: n.gender, npc2: teacher?.id, building: en.school });
        sim.bus.emit('education:event', { kind: 'talented', id: n.id });
      }
    }
  }

  // ------------------------------------------------------------------ influence on pupils (EducationSystem asks)

  /** A good teacher lifts a pupil's wish to learn (a poor one dampens it). */
  motivationFrom(n) {
    const en = n.edu?.enrol;
    if (!en) return 0;
    const s = this.S[en.school];
    const t = s && this.head(s);
    if (!t) return -2;
    const q = this.quality(s, en.stage);
    const tradition = this.sim.eduworld?.landmark(s.id)?.kind === 'old_school' ? 2 : 0; // the old school's name to live up to
    return clamp((this.ability(t) - 1) * 12 + (q.crowd < 0.8 ? -3 : 0) + (q.books < 0.95 ? -1 : 0) + tradition, -6, 9);
  }

  /** Pupils take after a teacher they like. */
  interestFrom(n, interest) {
    const en = n.edu?.enrol;
    if (!en) return 0;
    const t = this.head(this.S[en.school] || { teachers: [] });
    if (!t || t.edu?.interest !== interest) return 0;
    const bond = n.relations?.[t.id];
    return 1 + Math.min(1.5, (bond?.r || 0) / 20);
  }

  // ------------------------------------------------------------------ the village

  /** Should the village build (another) school? Returns a building type or null. */
  wanted() {
    const sim = this.sim;
    const schools = this.list();
    if (!schools.length) return null;
    const pop = sim.state.npcs.length + 1;
    // Overcrowded for a month: another school.
    if (schools.every((s) => (s.crowdedWeeks || 0) >= 4) && !sim.construction.list.some((c) => c.type === 'school' && c.status === 'site')) return 'school';
    // A proper upper school once enough youngsters finish primary and the village is big enough.
    const upperKids = sim.state.npcs.filter((n) => n.age >= 11 && n.age <= 17 && ['primary', 'secondary'].includes(n.edu?.level)).length;
    if (pop >= 34 && upperKids >= 4 && !schools.some((s) => s.kind === 'grammar') && !sim.construction.list.some((c) => c.type === 'grammar_school' && c.status === 'site')) return 'grammar_school';
    // A trade school when businesses can't find trained hands (or youngsters want a trade) — and someone could teach one.
    const short = sim.economy.active().filter((id) => (sim.economy.biz(id).shortageStep || 0) >= 1).length;
    const youths = sim.state.npcs.filter((n) => n.age >= 14 && n.age <= 20 && !n.apprentice && ['primary', 'secondary'].includes(n.edu?.level) && (n.occupation === 'unemployed' || n.occupation === 'child')).length;
    const instructor = sim.state.npcs.some((n) => n.age >= 30 && !n.owns && this.qualified(n, 'vocational'));
    if (pop >= 30 && (short >= 1 || youths >= 3) && instructor && !schools.some((s) => s.kind === 'trade') && !sim.construction.list.some((c) => c.type === 'trade_school' && c.status === 'site')) return 'trade_school';
    return null;
  }

  /** What someone is doing about school, for the UI. */
  statusOf(n) {
    const en = n.edu?.enrol;
    if (n.teach) return { key: 'teaching_at', params: { building: n.teach.school, trank: this.rankOf(n) } };
    if (!en) return null;
    if (en.field) return { key: 'on_course', params: { building: en.school, field: en.field, stage: en.stage, n: en.years + 1 } };
    return { key: en.stage === 'evening' ? 'at_evening_class' : 'pupil_at', params: { building: en.school, stage: en.stage, n: en.years + 1 } };
  }

  /** Figures for the whole valley. */
  summary() {
    const schools = this.list();
    return {
      schools: schools.length,
      teachers: schools.reduce((s, x) => s + this.teachersOf(x).length, 0),
      pupils: schools.reduce((s, x) => s + this.dayPupils(x).length, 0),
      evening: schools.reduce((s, x) => s + this.pupils(x, 'evening').length, 0),
      seats: schools.reduce((s, x) => s + this.seats(x), 0),
    };
  }
}

function sim_chronicle(sim, key, params) {
  sim.chronicle(key, params);
  sim.bus.emit('education:event', { kind: key.split('.').pop(), ...params });
}
