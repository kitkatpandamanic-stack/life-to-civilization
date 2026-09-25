/**
 * Education developer tools (development builds only — see devTools.js / DebugPanel.js).
 * In the browser console: dev.edu.stats(), dev.edu.npc('daria'), dev.edu.setKnow('daria', 'maths', 60),
 * dev.edu.enrol('mitya', 'primary'), dev.edu.graduate('mitya'), dev.edu.teacher('daria'), dev.edu.school('trade_school'),
 * dev.edu.year(), dev.edu.research(20), dev.edu.unlock('crop_rotation'), dev.edu.event('scholar'), dev.edu.skills().
 */
export function eduTools(dev) {
  const sim = () => dev.sim;
  const npc = (id) => sim().npcs.byId(id);
  const tools = {
    /** The valley's education figures. */
    stats: () => sim().eduworld.stats(),
    /** Everything about one person's learning. */
    npc: (id) => {
      const n = npc(id);
      return n && { edu: n.edu, apprentice: n.apprentice, teach: n.teach, post: n.post, away: n.away, fame: n.fame, competence: sim().education.fieldOf(n) && sim().education.competence(n, sim().education.fieldOf(n)) };
    },
    setKnow: (id, field, v, exp = null) => {
      const n = npc(id);
      n.edu.know[field] = v;
      if (exp !== null) n.edu.exp[field] = exp;
      return n.edu.know;
    },
    /** Put someone in a class at the first school that runs it. */
    enrol: (id, stage = 'primary', field = null) => {
      const S = sim().schools;
      const s = S.list().find((x) => S.stagesRunning(x).includes(stage));
      if (!s) return 'no school runs that class';
      S.enrol(npc(id), s, stage, 'debug', field);
      return npc(id).edu.enrol;
    },
    /** Pass their exam now. */
    graduate: (id) => {
      const n = npc(id);
      const en = n.edu.enrol;
      if (!en) return 'not enrolled';
      const def = sim().schools.stageDef(en.stage, en.field);
      for (const [f, v] of Object.entries(def.pass || {})) n.edu.know[f] = Math.max(n.edu.know[f] || 0, v + 1);
      en.years = Math.max(en.years, def.minYears);
      sim().schools.yearEnd();
      return n.edu.level;
    },
    /** Make someone a teacher at the first school (giving them the learning for it). */
    teacher: (id) => {
      const n = npc(id);
      const s = sim().schools.list()[0];
      if (!s) return 'no school';
      Object.assign(n.edu.know, { reading: Math.max(n.edu.know.reading || 0, 60), writing: Math.max(n.edu.know.writing || 0, 50), maths: Math.max(n.edu.know.maths || 0, 55) });
      sim().schools.appoint(s, n);
      return s.teachers;
    },
    /** Put up a school / trade_school / grammar_school / institute / library at once. */
    school: (type = 'school') => {
      sim().state.village.treasury += 2000;
      const c = sim().growth.start('village', type, 'public', { tx: 44, ty: 38 });
      if (!c) return 'no room';
      c.delivered = { ...c.required };
      c.labor = c.laborNeeded;
      sim().construction.tryComplete(c);
      sim().schools.weekly();
      sim().academia.weekly();
      return c.id;
    },
    /** The end of a school year (exams, graduations), and two university terms. */
    year: () => {
      sim().schools.yearEnd();
      for (let i = 0; i < 8; i++) sim().academia.studyWeek();
      return sim().eduworld.stats();
    },
    /** Push the institute's project along. */
    research: (pts = 20) => {
      const inst = sim().academia.institutes()[0];
      if (!inst) return 'no institute';
      if (!inst.project) sim().academia.institutesWeek();
      if (!inst.project) return 'nothing to work on (researchers? money? groundwork?)';
      inst.progress += pts;
      sim().state.tech.progress[inst.project] = inst.progress;
      return `${inst.project} ${Math.round(inst.progress)}`;
    },
    /** Know a technique — and everyone who'd use it has learned it. */
    unlock: (tech) => {
      sim().tech.discover(tech);
      for (const n of sim().knowhow.practitioners(tech)) sim().knowhow.teach(n, tech, 50);
      sim().tech.mods = null;
      return sim().knowhow.adoption(tech);
    },
    /** Make something happen: talent | shortage | scholar | closed | university. */
    event: (kind) => {
      const s = sim();
      if (kind === 'talent') {
        const n = s.state.npcs.find((x) => x.edu?.enrol && !x.edu.talented);
        if (!n) return 'no pupil';
        Object.assign(n.edu.apt, { analytic: 90, memory: 85 });
        n.edu.mot = 85;
        s.schools.talent();
        return n.id;
      }
      if (kind === 'shortage') {
        for (const sc of s.schools.list()) for (const t of s.schools.teachersOf(sc)) s.schools.release(t);
        return 'teachers gone';
      }
      if (kind === 'scholar') {
        const orig = s.eduworld.rng.bind(s.eduworld);
        s.eduworld.rng = () => ({ chance: () => true, float: () => 0 });
        s.eduworld.events();
        s.eduworld.rng = orig;
        return 'done';
      }
      if (kind === 'closed') {
        for (const sc of s.schools.list()) sc.noTeacherWeeks = 7;
        tools.event('shortage');
        s.eduworld.events();
        return 'closed';
      }
      if (kind === 'university') {
        for (const id of s.settlements.ids()) s.settlements.get(id).pop = Math.max(s.settlements.get(id).pop, 220);
        s.eduworld.events();
        return 'towns grown';
      }
      return 'talent | shortage | scholar | closed | university';
    },
    /** How the valley's workers are spread across trades (competence ≥ 35 / ≥ 50). */
    skills: () => {
      const s = sim();
      const out = {};
      for (const n of s.state.npcs.filter((x) => x.age >= 16)) {
        for (const f of Object.keys(n.edu?.know || {})) {
          const c = s.education.competence(n, f);
          if (c < 35) continue;
          out[f] ??= { able: 0, skilled: 0 };
          out[f].able++;
          if (c >= 50) out[f].skilled++;
        }
      }
      return out;
    },
  };
  return tools;
}
