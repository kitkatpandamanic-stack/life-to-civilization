/**
 * TechSystem — what the village knows how to do, and how that knowledge
 * grows, is passed on, and can be lost.
 *
 * Technologies (data/tech.js) are worked out by the people doing the work;
 * each one changes how the world runs (handcarts on the roads, richer
 * harvests, faster building, fewer sick, news that stays truer).
 *
 * Education: once the village has built a school and found a teacher,
 * children spend weekday mornings there; what they learn gives them a head
 * start when they grow up. A library keeps what people know from dying with
 * them. At work, masters teach apprentices; a skilled villager who dies
 * without passing their craft on takes some of the village's know-how with them.
 *
 *   state.tech = { known: { id: day }, progress: { id: n }, teacher: npcId|null, apprentices: { npcId: mentorId } }
 *   state.knowledge = { points, sources }   (shared with ExplorationSystem)
 *   npc.education, npc.mentor
 */
import { rand } from '../core/rng.js';
import { TECHS, TECH_TUNING as TT, CIVIC, EDUCATION as ED } from '../data/tech.js';

export class TechSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.tech ??= {};
    const T = sim.state.tech;
    T.known ??= {};
    T.progress ??= {};
    T.teacher ??= null;
    T.apprentices ??= {};
    sim.state.knowledge ??= { points: 0, sources: [] };
    this.mods = null;
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:hour', (h) => {
      if (h === 12) this.schoolDay();
      if (h === 20) this.workDone(); // after the working day (before 'worked today' resets at midnight)
    });
    sim.bus.on('chronicle', (e) => e.key === 'chronicle.npc_died' && this.onDeath(e.params.npc));
  }

  get T() {
    return this.sim.state.tech;
  }
  get K() {
    return this.sim.state.knowledge;
  }

  has(id) {
    return this.T.known[id] !== undefined;
  }

  /** Combined multiplier for an effect (1 when nothing applies). */
  mod(key) {
    if (!this.mods) {
      this.mods = {};
      const apply = (effects) => {
        for (const [k, v] of Object.entries(effects || {})) this.mods[k] = (this.mods[k] ?? 1) * v;
      };
      for (const id of Object.keys(this.T.known)) apply(TECHS[id]?.effects);
      for (const [type, def] of Object.entries(CIVIC)) if (this.civic(type)) apply(def.effects);
      // The village's institutions (market, watch, clinic, guild…) — see CivicSystem.
      for (const effects of this.sim.civic?.effects() || []) apply(effects);
    }
    return this.mods[key] ?? 1;
  }

  /** Output multiplier for a business type (farms, lumberyards, quarries). */
  outputMod(bizType) {
    if (bizType === 'farm') return this.mod('farm_output');
    if (bizType === 'lumberyard' || bizType === 'quarry') return this.mod('gather_output');
    return 1;
  }

  /** A finished civic building of this type, if the village has one. */
  civic(type) {
    return this.sim.world.buildingList.find((b) => b.type === type && this.sim.property.rec(b.id)) || null;
  }

  addKnowledge(n, source = null) {
    this.K.points = Math.round((this.K.points + n) * 100) / 100;
    if (source) {
      this.K.sources.push({ day: this.sim.time.day, source, n });
      if (this.K.sources.length > 30) this.K.sources.shift();
    }
  }

  // ------------------------------------------------------------------ discovery

  /** Are the prerequisites for this technology in place? */
  ready(id) {
    const n = TECHS[id].needs || {};
    const sim = this.sim;
    if (n.biz && !sim.economy.ofType(n.biz).length) return false;
    if (n.tech && !n.tech.every((x) => this.has(x))) return false;
    if (n.pop && sim.state.npcs.length + 1 < n.pop) return false;
    if (n.knowledge && this.K.points < n.knowledge) return false;
    if (n.built && (sim.state.settlement.built || 0) < n.built) return false;
    if (n.civic && !this.civic(n.civic)) return false;
    return true;
  }

  /** Who's working on it today, and how fast it's coming along. */
  dailyProgress(id) {
    const def = TECHS[id];
    const sim = this.sim;
    let p = 0;
    for (const n of sim.state.npcs) {
      if (def.from.includes(n.occupation) && n.workedToday) p += TT.perWorker * (1 + (n.level || 1) / 6);
      else if (def.hobby && n.habits?.hobby === def.hobby && n.age >= 16) p += TT.hobbyist * 0.2;
    }
    p += Math.min(TT.knowledgeCap, this.K.points * TT.perKnowledge);
    if (def.school && this.civic('school') && this.T.teacher) p += TT.school;
    const skill = def.skill && sim.state.player.skills[def.skill]?.level;
    if (skill >= 3) p += skill * TT.perPlayerSkill;
    return p * this.mod('learning');
  }

  discover(id, by = null) {
    const sim = this.sim;
    this.T.known[id] = sim.time.day;
    delete this.T.progress[id];
    this.mods = null;
    sim.chronicle(by ? 'chronicle.tech_discovered_by' : 'chronicle.tech_discovered', { tech: id, npc: by?.id, gender: by?.gender });
    sim.toast('toast.tech_discovered', { tech: id }, 'good');
    if (by) sim.memory.remember(by, 'invented', { params: { tech: id } });
    if (id === 'handcart' || id === 'draft_animals' || id === 'wagons') sim.logistics?.routes.clear();
    sim.bus.emit('tech:discovered', id);
  }

  onDay() {
    if (this.sim.time.weekday === 1) this.weekly();
  }

  /** Evening: a day's work (and reading, and schooling) moves every reachable technology along. */
  workDone() {
    const sim = this.sim;
    for (const id of Object.keys(TECHS)) {
      if (this.has(id) || !this.ready(id)) continue;
      this.T.progress[id] = (this.T.progress[id] || 0) + this.dailyProgress(id);
      if (this.T.progress[id] >= TECHS[id].cost) {
        // Credit the most experienced person in the trade (if any).
        const by = sim.state.npcs.filter((n) => TECHS[id].from.includes(n.occupation)).sort((a, b) => b.level - a.level)[0] || null;
        this.discover(id, by);
      }
    }
  }

  /** How far along a technology is (0–1), for the UI. */
  progress(id) {
    return this.has(id) ? 1 : Math.min(0.99, (this.T.progress[id] || 0) / TECHS[id].cost);
  }

  // ------------------------------------------------------------------ school

  /** The school a child should be at right now (or null). */
  schoolFor(npc) {
    const h = this.sim.time.hourFloat;
    if (npc.age < 6 || npc.age > 15 || npc.occupation !== 'child') return null;
    if (h < ED.schoolHours[0] || h >= ED.schoolHours[1]) return null;
    if (this.sim.time.weekday === 6 || !this.T.teacher) return null;
    return this.civic('school')?.id || null;
  }

  /** The teacher heads to school in school hours too. */
  teaching(npc) {
    if (npc.id !== this.T.teacher) return null;
    const h = this.sim.time.hourFloat;
    if (h < ED.schoolHours[0] || h >= ED.schoolHours[1] || this.sim.time.weekday === 6) return null;
    return this.civic('school')?.id || null;
  }

  /** End of the school day: whoever was in class learned something. */
  schoolDay() {
    const school = this.civic('school');
    if (!school || !this.T.teacher) return;
    const teacher = this.sim.npcs.byId(this.T.teacher);
    const quality = teacher ? 0.6 + Math.min(1, ((teacher.knowledge || 0) + teacher.level) / 20) : 0;
    let pupils = 0;
    for (const n of this.sim.state.npcs) {
      if (n.occupation !== 'child' || n.age < 6) continue;
      if (n.inside !== school.id && n.task?.type !== 'school') continue;
      n.education = Math.round(((n.education || 0) + ED.perDay * quality * this.mod('learning')) * 10) / 10;
      pupils++;
    }
    if (pupils) this.addKnowledge(0.05 * pupils);
  }

  /** Find a teacher: someone who reads and knows things, ideally not busy running a business. */
  findTeacher() {
    const cands = this.sim.state.npcs.filter((n) => n.age >= 20 && !n.owns && !n.away && n.health > 40);
    const score = (n) => (n.knowledge || 0) * 2 + n.level + (n.habits?.hobby === 'reading' ? 8 : 0) + (n.occupation === 'elder' ? 6 : 0) + (n.education || 0) * 0.5 - (n.employer ? 4 : 0);
    const best = cands.sort((a, b) => score(b) - score(a))[0];
    if (!best) return null;
    this.T.teacher = best.id;
    this.sim.memory.remember(best, 'became_teacher');
    this.sim.chronicle('chronicle.new_teacher', { npc: best.id, gender: best.gender });
    return best;
  }

  // ------------------------------------------------------------------ weekly: teachers, mentors, the library

  weekly() {
    const sim = this.sim;
    const V = sim.state.village;
    // The school needs a teacher (paid by the village).
    if (this.civic('school')) {
      const teacher = this.T.teacher && sim.npcs.byId(this.T.teacher);
      if (!teacher) this.findTeacher();
      else {
        const pay = Math.min(ED.teacherStipend, Math.max(0, V.treasury));
        V.treasury -= pay;
        teacher.money += pay;
      }
    }
    // The library: readers there add to what the village knows.
    if (this.civic('library')) {
      const readers = sim.state.npcs.filter((n) => n.habits?.hobby === 'reading').length;
      this.addKnowledge(0.3 + readers * 0.2);
    }
    this.mentoring();
  }

  /** At every workplace, the most experienced hand teaches the greenest one. */
  mentoring() {
    const sim = this.sim;
    const E = sim.economy;
    for (const bizId of E.active()) {
      const team = sim.state.npcs.filter((n) => n.employer === bizId || n.owns === bizId).filter((n) => n.age >= 14 && !n.away);
      if (team.length < 2) continue;
      team.sort((a, b) => b.level - a.level);
      const master = team[0];
      const pupil = team[team.length - 1];
      if (master.level - pupil.level < ED.mentorGap) continue;
      pupil.xp += ED.mentorXp * this.mod('learning');
      if (pupil.mentor !== master.id) {
        pupil.mentor = master.id;
        this.T.apprentices[pupil.id] = master.id;
        sim.memory.remember(pupil, 'mentored_by', { who: master.id, params: { npc: master.id } });
        sim.memory.remember(master, 'took_apprentice', { who: pupil.id, params: { npc: pupil.id } });
        sim.social.adjust(pupil, master, { f: 6, t: 8, r: 10 });
        sim.social.adjust(master, pupil, { f: 4, t: 4 });
        if (rand.chance(0.5)) sim.chronicle('chronicle.npc_apprentice', { npc: pupil.id, gender: pupil.gender, npc2: master.id });
      }
    }
  }

  // ------------------------------------------------------------------ generations

  /** A child grows up: school and a parent's trade give them a head start. */
  grewUp(npc) {
    const sim = this.sim;
    const parents = (npc.kin?.parents || []).map((id) => sim.family.person(id)).filter(Boolean);
    const parentLevel = Math.max(0, ...parents.map((p) => p.level || 0));
    const bonus = Math.floor((npc.education || 0) * ED.levelPerEducation + parentLevel * ED.inheritedLevel);
    if (bonus > 0) npc.level = (npc.level || 1) + bonus;
    if ((npc.education || 0) >= 10) this.addKnowledge(0.5);
    return bonus;
  }

  /** Someone skilled died: did anyone learn their craft? */
  onDeath(id) {
    const sim = this.sim;
    const dead = sim.state.graveyard.find((g) => g.id === id);
    if (!dead) return;
    if (id === this.T.teacher) this.T.teacher = null;
    const lvl = dead.level || 0;
    if (lvl < ED.skilledLevel) return;
    const apprentice = Object.entries(this.T.apprentices).find(([, m]) => m === id)?.[0];
    const heir = apprentice && sim.npcs.byId(apprentice);
    if (heir) sim.chronicle('chronicle.craft_passed_on', { npc: id, npc2: heir.id });
    else if (this.civic('library')) sim.chronicle('chronicle.craft_recorded', { npc: id });
    else {
      this.K.points = Math.max(0, this.K.points - ED.lostKnowledge);
      sim.chronicle('chronicle.craft_lost', { npc: id });
    }
    for (const [a, m] of Object.entries(this.T.apprentices)) if (m === id || a === id) delete this.T.apprentices[a];
  }

  /** Civic buildings the village should build next (see GrowthSystem). */
  civicWanted() {
    const sim = this.sim;
    const pop = sim.state.npcs.length + 1;
    const children = sim.state.npcs.filter((n) => n.age >= 5 && n.age <= 15).length;
    for (const [type, def] of Object.entries(CIVIC)) {
      if (this.civic(type) || sim.construction.list.some((c) => c.type === type && c.status === 'site')) continue;
      const w = def.when;
      if (w.pop && pop < w.pop) continue;
      if (w.children && children < w.children) continue;
      if (w.civic && !this.civic(w.civic)) continue;
      if (w.knowledge && this.K.points < w.knowledge) continue;
      if (w.tech && !this.has(w.tech)) continue;
      return type;
    }
    return null;
  }

  /** Village know-how for the UI: known, being worked out, not yet within reach. */
  overview() {
    return Object.keys(TECHS).map((id) => ({ id, known: this.has(id), ready: this.ready(id), progress: this.progress(id), icon: TECHS[id].icon }));
  }
}
