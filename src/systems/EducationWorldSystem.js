/**
 * EducationWorldSystem — what learning does to the valley as a whole.
 *
 * The rest of the education systems work person by person. This one looks at
 * the settlement: what it knows and what it's known for, what that draws in
 * (families to a good school, trades to a skilled workforce, the learned to a
 * famous institute), what it holds back (a business nobody here can staff),
 * and what it becomes — a town needs people who can read, a city needs more.
 * It keeps the milestones, the places that become landmarks, and the events
 * that simply happen in a world with schools in it (a school closing for want
 * of a teacher, a famous scholar arriving, a town opening a university).
 *
 * Statistics describe the world; they don't replace it: every figure here is
 * counted from real people.
 *
 *   state.education.landmarks = { buildingId: { kind, since } }
 *   state.education.specialty = { field, since }
 *   state.education.milestones = { key: day }
 */
import { Rng } from '../core/rng.js';
import { KNOWLEDGE, EDU_LEVELS, OCC_FIELDS } from '../data/education.js';
import { UNIVERSITIES } from '../data/academia.js';
import { BUSINESS_TYPES } from '../data/businessTypes.js';
import { BALANCE } from '../config/balance.js';

export const EDU_WORLD = {
  skilled: 50, // competence that counts as "skilled" in a field
  specialtyMin: 3, // this many skilled people in a field before the valley is known for it
  literacyMarks: [0.25, 0.5, 0.75],
  oldSchoolYears: 2, // a school this old (and the oldest) is a landmark
  famousInstitute: 2, // discoveries
  historicWorkshop: 3, // journeymen trained there
  schoolClosedWeeks: 8, // no teacher this long: the school is shut
  scholarChance: 0.03, // a week: a scholar from a town moves to a valley with an institute
  settlementLiteracy: { hamlet: 0.2, village: 0.32, town: 0.55, city: 0.72 },
};
const W = EDU_WORLD;

export class EducationWorldSystem {
  constructor(sim) {
    this.sim = sim;
    const E = (sim.state.education ??= {});
    E.landmarks ??= {};
    E.milestones ??= {};
    E.specialty ??= null;
    sim.bus.on('time:day', () => sim.time.weekday === 6 && this.weekly());
    // Newcomers are drawn by what the valley is known for.
    sim.bus.on('settlement:arrived', (ids) => ids.forEach((id) => this.drawnBySpecialty(sim.npcs.byId(id))));
  }

  get E() {
    return this.sim.state.education;
  }
  get Ed() {
    return this.sim.education;
  }

  rng(salt) {
    let h = (this.sim.state.seed | 0) ^ 0x3e11;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    return new Rng((h ^ (h >>> 15)) >>> 0);
  }

  // ------------------------------------------------------------------ figures

  /** The valley's learning, counted from its people. */
  stats() {
    const sim = this.sim;
    const npcs = sim.state.npcs.filter((n) => !n.away);
    const adults = npcs.filter((n) => n.age >= 16);
    const share = (f) => (adults.length ? adults.filter(f).length / adults.length : 0);
    const lvl = (n) => EDU_LEVELS.indexOf(n.edu?.level || 'none');
    const skilledIn = {};
    for (const n of adults) {
      for (const f of Object.keys(KNOWLEDGE)) {
        if (KNOWLEDGE[f].cat === 'basic') continue;
        if (this.Ed.competence(n, f) >= W.skilled) skilledIn[f] = (skilledIn[f] || 0) + 1;
      }
    }
    const base = this.Ed.stats();
    return {
      pop: npcs.length + 1,
      literacy: base.literacy,
      basic: share((n) => lvl(n) >= 1),
      secondary: share((n) => lvl(n) >= 2),
      vocational: share((n) => (n.edu?.quals || []).some((q) => q.how !== 'university') || n.edu?.level === 'vocational'),
      university: share((n) => n.edu?.level === 'university'),
      teachers: npcs.filter((n) => n.teach).length,
      doctors: sim.academia?.holders('doctor').length || 0,
      engineers: adults.filter((n) => this.Ed.know(n, 'engineering') >= W.skilled).length,
      researchers: sim.academia?.researchers().length || 0,
      masters: adults.filter((n) => sim.careers?.tier(n) === 'master').length,
      apprentices: npcs.filter((n) => n.apprentice).length,
      pupils: sim.schools?.summary().pupils || 0,
      students: sim.academia?.students().length || 0,
      skilledPeople: base.skilledPeople,
      skilledIn,
      specialty: this.E.specialty?.field || null,
      discoveries: this.E.discoveries?.length || 0,
      innovation: this.innovation(),
    };
  }

  /** How able the valley is to work new things out (0 … ~3): the learned, the skilled, research, books. */
  innovation() {
    const sim = this.sim;
    const adults = sim.state.npcs.filter((n) => n.age >= 16 && !n.away);
    if (!adults.length) return 0;
    const learned = adults.filter((n) => this.Ed.know(n, 'science') + this.Ed.know(n, 'engineering') >= 60).length;
    const skilled = this.Ed.stats().skilledShare;
    return Math.round((skilled * 1.2 + learned * 0.25 + (sim.academia?.researchers().length || 0) * 0.4 + (sim.tech?.civic('library') ? 0.3 : 0) + (sim.tech?.has('printing') ? 0.2 : 0)) * 100) / 100;
  }

  /** A settlement beyond the valley, counted the way it's simulated: from its size, its university and what it knows. */
  settlementStats(id) {
    const S = this.sim.settlements;
    const s = S?.get(id);
    if (!s) return null;
    const size = S.sizeOf(s.pop);
    const uni = this.sim.academia?.uniDef?.(id) || UNIVERSITIES[id] || null;
    const writing = s.techs?.writing || 0;
    const literacy = Math.min(0.95, (W.settlementLiteracy[size] ?? 0.3) + (uni ? 0.1 : 0) + writing * 0.15);
    const graduates = uni ? Math.min(0.2, 0.03 + (size === 'city' ? 0.08 : size === 'town' ? 0.04 : 0)) : 0;
    const best = uni ? Object.entries(uni.fields).sort((a, b) => b[1] - a[1])[0][0] : null;
    return { literacy, graduates, university: !!uni, specialty: best, size };
  }

  // ------------------------------------------------------------------ weekly

  weekly() {
    this.specialty();
    this.milestones();
    this.landmarks();
    this.events();
  }

  /** What the valley is known for: the field with the most skilled people (once there are enough). */
  specialty() {
    const sim = this.sim;
    const st = this.stats();
    const [field, n] = Object.entries(st.skilledIn).sort((a, b) => b[1] - a[1])[0] || [];
    if (!field || n < W.specialtyMin) return;
    if (this.E.specialty?.field === field) return;
    // A name, once made, isn't lost to a close rival: the new trade must clearly lead.
    const cur = this.E.specialty && (st.skilledIn[this.E.specialty.field] || 0);
    if (cur && n < cur + 2) return;
    this.E.specialty = { field, since: sim.time.day };
    sim.chronicle('chronicle.valley_known_for', { field, n });
  }

  /** Newcomers are likelier to come from the trade the valley is known for. */
  drawnBySpecialty(n) {
    const sp = this.E.specialty?.field;
    if (!n || !sp || n.age < 18) return;
    if (!this.rng(`${n.id}:drawn`).chance(0.35)) return;
    const occ = Object.entries(OCC_FIELDS).find(([o, fs]) => fs[0] === sp && !['teacher', 'researcher', 'doctor', 'engineer'].includes(o))?.[0];
    if (occ) n.prevOccupation = occ;
    this.Ed.learn(n, sp, 25, { raw: true });
    this.Ed.practise(n, sp, 25);
  }

  milestones() {
    const sim = this.sim;
    const M = this.E.milestones;
    const st = this.stats();
    M.baseLiteracy ??= st.literacy; // only progress counts: what the valley could already do isn't news
    for (const mark of W.literacyMarks) {
      const key = `literacy_${Math.round(mark * 100)}`;
      if (!M[key] && mark > M.baseLiteracy && st.literacy >= mark && st.pop >= 10) {
        M[key] = sim.time.day;
        sim.chronicle('chronicle.literacy_milestone', { n: Math.round(mark * 100) });
      }
    }
    const kinds = new Set((sim.schools?.list() || []).map((s) => s.kind));
    if (!M.centre && kinds.has('school') && kinds.has('trade') && (sim.academia?.institutes().length || 0) > 0) {
      M.centre = sim.time.day;
      sim.chronicle('chronicle.education_centre', {});
    }
  }

  /** Places that have become part of the valley's story. */
  landmarks() {
    const sim = this.sim;
    const L = this.E.landmarks;
    const yearDays = BALANCE.time.daysPerSeason * BALANCE.time.seasons.length;
    const mark = (id, kind, params = {}) => {
      if (L[id]) return;
      L[id] = { kind, since: sim.time.day };
      sim.chronicle(`chronicle.landmark_${kind}`, { building: id, ...params });
    };
    const schools = (sim.schools?.list() || []).filter((s) => s.kind === 'school').sort((a, b) => a.founded - b.founded);
    const oldest = schools[0];
    if (oldest && sim.time.day - oldest.founded >= W.oldSchoolYears * yearDays && (oldest.pupilsEver || 0) >= 5) mark(oldest.id, 'old_school');
    for (const inst of sim.academia?.institutes() || []) {
      const wins = (inst.done || []).filter((d) => d.result === 'success').length;
      if (wins >= W.famousInstitute) mark(inst.id, 'famous_institute', { n: wins });
    }
    const trained = {};
    for (const a of this.E.apprenticeships || []) if (a.done === 'finished' && a.biz !== 'player') trained[a.biz] = (trained[a.biz] || 0) + 1;
    for (const [biz, n] of Object.entries(trained)) {
      const b = sim.economy.biz(biz);
      if (b && !b.closed && n >= W.historicWorkshop) mark(b.building, 'historic_workshop', { n });
    }
  }

  landmark(buildingId) {
    return this.E.landmarks[buildingId] || null;
  }

  /** A landmark's pull: the old school's pupils keep up its name; a historic workshop's apprentices learn faster. */
  landmarkBonus(kind, buildingId) {
    const l = this.landmark(buildingId);
    return l?.kind === kind ? 1.1 : 1;
  }

  /** Things that simply happen in a world with schools in it. */
  events() {
    const sim = this.sim;
    const day = sim.time.day;
    // A school with no teacher for weeks closes its doors (and opens them again when one comes).
    for (const s of sim.schools?.list() || []) {
      const staffed = sim.schools.teachersOf(s).length > 0;
      if (!staffed) s.noTeacherWeeks = (s.noTeacherWeeks || 0) + 1;
      if (!staffed && s.noTeacherWeeks === W.schoolClosedWeeks) {
        s.closed = { day };
        sim.chronicle('chronicle.school_closed', { building: s.id });
      } else if (staffed) {
        if (s.closed) {
          delete s.closed;
          sim.chronicle('chronicle.school_reopened', { building: s.id });
        }
        s.noTeacherWeeks = 0;
      }
    }
    // The village offers to pay for a gifted pupil's studies (when the fund is full and schooling is valued).
    const V = sim.state.village;
    if (sim.civic?.V?.policies?.schooling !== 'low' && V.treasury >= 600) {
      const gifted = sim.state.npcs.find((n) => n.edu?.talented && !n.edu.villageBursary && sim.academia?.wantsToStudy(n) && !sim.academia.funding(n, sim.academia.wantsToStudy(n).uni));
      if (gifted) {
        gifted.edu.villageBursary = day;
        gifted.edu.sponsor = 'village';
        V.treasury -= sim.academia.cost(sim.academia.wantsToStudy(gifted).uni);
        sim.chronicle('chronicle.scholarship_offered', { npc: gifted.id, gender: gifted.gender });
      }
    }
    // A scholar from a town settles in a valley with an institute (and room for them).
    const inst = sim.academia?.institutes()[0];
    if (inst && sim.academia.postOpen('researcher') && this.rng(`scholar:${day}`).chance(W.scholarChance)) {
      const town = (sim.settlements?.contacts() || []).find((id) => (sim.academia.uniDef?.(id) || UNIVERSITIES[id])) || undefined;
      const n = sim.growth?.arrive({ size: 1, from: town })?.[0];
      if (n) {
        Object.assign(n.edu.know, { science: 72, maths: 65, reading: 70 });
        n.edu.level = 'university';
        n.edu.degree = 'science';
        n.fame = 55;
        sim.chronicle(town ? 'chronicle.scholar_arrives' : 'chronicle.scholar_arrives_far', { npc: n.id, gender: n.gender, settlement: town });
      }
    }
    // A town that has grown big enough founds a university of its own.
    for (const id of sim.settlements?.ids() || []) {
      const s = sim.settlements.get(id);
      if (UNIVERSITIES[id] || s.university) continue;
      if (!['town', 'city'].includes(sim.settlements.sizeOf(s.pop))) continue;
      const field = { forest: 'architecture', herding: 'science', fishing: 'science', mining: 'engineering', market: 'economics', port: 'medicine' }[sim.settlements.def(id).character] || 'science';
      s.university = { fields: { [field]: 1.1, science: 0.9 }, tuition: 70, living: 7, founded: day };
      if (s.contact || sim.settlements.known().includes(id)) sim.chronicle('chronicle.new_university', { settlement: id, field });
    }
  }

  // ------------------------------------------------------------------ what it changes

  /** How easily a business of this type could find trained hands here (EnterpriseSystem.opportunity). */
  laborFactor(type) {
    const def = BUSINESS_TYPES[type];
    const field = OCC_FIELDS[def?.workerOccupation]?.[0] || OCC_FIELDS[def?.ownerOccupation]?.[0];
    if (!field) return 1;
    const skilled = this.sim.state.npcs.filter((n) => n.age >= 16 && !n.away && this.Ed.competence(n, field) >= 35).length;
    return 0.8 + 0.2 * Math.min(1, skilled / 2) + (skilled >= 3 ? 0.1 : 0);
  }

  /** How much learning draws people to the valley (GrowthSystem.attractiveness). */
  attraction() {
    const sim = this.sim;
    let a = 0;
    const schools = sim.schools?.list() || [];
    if (schools.some((s) => sim.schools.stagesRunning(s).length)) a += 0.3; // families come where there's a school
    if (schools.some((s) => s.kind === 'trade')) a += 0.15;
    if ((sim.academia?.institutes().length || 0) > 0) a += 0.15;
    if (sim.academia?.famous().length) a += 0.2;
    if (sim.academia?.holders('doctor').length) a += 0.2;
    if (this.E.specialty) a += 0.15;
    return a;
  }

  /** What the next status step asks of the valley's learning (CivicSystem.statusMissing). */
  statusNeeds(step) {
    const out = [];
    if (step.literacy && this.Ed.stats().literacy < step.literacy) out.push({ k: 'literacy', v: Math.round(step.literacy * 100) });
    if (step.school && !(this.sim.schools?.list() || []).some((s) => this.sim.schools.teachersOf(s).length)) out.push({ k: 'school', v: 1 });
    if (step.graduates && this.sim.state.npcs.filter((n) => n.edu?.level === 'university').length < step.graduates) out.push({ k: 'graduates', v: step.graduates });
    return out;
  }
}
