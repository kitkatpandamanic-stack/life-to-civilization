/**
 * CareerSystem — how people get into a trade and rise in it.
 *
 * Rank and title come from competence (what they know and what they've done),
 * not from how long they've been alive: a trained newcomer can outrank an old
 * hand who never learned properly, and a farmer who takes up the forge starts
 * again at the bottom of that ladder.
 *
 * Ways in:
 *   - apprenticeship: a master of the trade (competent enough, and willing) takes
 *     on a young person — or someone starting over — who works beside them for a
 *     smaller wage and learns far faster than alone; a master's own child is the
 *     likeliest apprentice, but only if they want it;
 *   - a trade-school course (SchoolSystem, 'vocational' / 'trade_evening');
 *   - a business's own training programme, or a proper academy in a bigger one.
 *
 * Skilled work: some jobs an employer won't give to just anyone. A vacancy that
 * stays open for want of trained people makes the business respond: better
 * pay, an apprentice, training, or sending to the towns for someone trained.
 *
 *   state.education.apprenticeships = [{ apprentice, master, field, biz, since, days, done }]
 *   npc.apprentice = { master, field, biz, since, days }
 *   npc.edu.quals = [{ field, how, day }]      (trade qualifications)
 *   business.training = { since, academy }
 */
import { Rng } from '../core/rng.js';
import { OCC_FIELDS, KNOWLEDGE, INTERESTS, EDU, EDU_LEVELS } from '../data/education.js';
import { CAREER_TIERS, COMPETENCE_RANKS, APPRENTICE as AP, TRAINING as TR, SKILLED, RETRAIN } from '../data/careers.js';

const RANK_ORDER = ['apprentice', 'regular', 'skilled', 'master'];

export class CareerSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.education ??= {};
    sim.state.education.apprenticeships ??= [];
    sim.bus.on('time:day', () => sim.time.weekday === 2 && this.weekly());
    sim.bus.on('npc:removed', (id) => this.gone(id));
  }

  get A() {
    return this.sim.state.education.apprenticeships;
  }
  get Ed() {
    return this.sim.education;
  }

  rng(salt) {
    let h = (this.sim.state.seed | 0) ^ 0x2c1b3c6d;
    for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    return new Rng((h ^ (h >>> 15)) >>> 0);
  }

  // ------------------------------------------------------------------ rank and title

  /** Rank from competence in their line of work (NPCSystem.rank takes the better of this and the old level rank). */
  competenceRank(npc) {
    const f = this.Ed.fieldOf(npc);
    if (!f) return null;
    const c = this.Ed.competence(npc, f);
    const x = this.Ed.exp(npc, f);
    if (c >= COMPETENCE_RANKS.master && x >= 50) return 'master';
    if (c >= COMPETENCE_RANKS.skilled) return 'skilled';
    if (c >= COMPETENCE_RANKS.regular) return 'regular';
    return 'apprentice';
  }

  better(a, b) {
    return RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b;
  }

  /** "trainee" … "master" in their trade. */
  tier(npc, field = this.Ed.fieldOf(npc)) {
    if (!field) return null;
    const c = this.Ed.competence(npc, field);
    const x = this.Ed.exp(npc, field);
    let out = 'trainee';
    for (const [id, minC, minX] of CAREER_TIERS) if (c >= minC && x >= minX) out = id;
    return out;
  }

  // ------------------------------------------------------------------ apprenticeships

  bizField(bizId) {
    const def = this.sim.economy.def(bizId);
    return OCC_FIELDS[def?.ownerOccupation]?.[0] || OCC_FIELDS[def?.workerOccupation]?.[0] || null;
  }

  /** Masters with room for an apprentice: [{ master, biz, field }]. */
  masters() {
    const sim = this.sim;
    const E = sim.economy;
    const out = [];
    for (const bizId of E.active()) {
      const def = E.def(bizId);
      if (!def.workerOccupation) continue;
      const field = this.bizField(bizId);
      if (!field) continue;
      // One apprentice to a workshop, and only where the till can carry their wage.
      if (sim.state.npcs.some((n) => n.apprentice?.biz === bizId) || E.biz(bizId).money < AP.minBusinessMoney) continue;
      const team = sim.state.npcs.filter((n) => (n.owns === bizId || n.employer === bizId) && !n.away && !n.leaving && n.age >= 20);
      for (const m of team) {
        if (m.apprentice || this.A.some((a) => !a.done && a.master === m.id)) continue;
        if (this.Ed.competence(m, field) < AP.masterMin) continue;
        out.push({ master: m, biz: bizId, field });
      }
    }
    return out;
  }

  /** Who's looking for a way into a trade: young people not in school, and grown-ups starting over. */
  seekers() {
    return this.sim.state.npcs.filter((n) => {
      if (n.away || n.leaving || n.teach || n.owns || n.apprentice || n.employer === 'player') return false;
      const en = n.edu?.enrol;
      if (en && !['evening', 'trade_evening'].includes(en.stage)) return false;
      if (n.age < AP.minAge) return false;
      const young = n.age <= AP.maxAge && (n.occupation === 'unemployed' || n.occupation === 'child' || this.Ed.competenceFor(n, n.occupation) < 25);
      const retraining = n.edu?.retrain && n.age <= AP.retrainAge;
      return young || retraining;
    });
  }

  /** How much this person wants to learn this trade (interest, family, talents — never forced). */
  wantsTrade(n, field, master) {
    const e = this.Ed.profile(n);
    let s = 0.5;
    const it = INTERESTS[e.interest];
    if (it?.fields.includes(field)) s += 0.4 + (e.istr || 0) / 60;
    else if (e.interest && (e.istr || 0) >= 50) s -= 0.5; // their heart is set on something else
    if (e.retrain === field) s += 1;
    const kin = n.kin?.parents?.includes(master.id);
    if (kin) s += AP.familyPull * (it?.fields.includes(field) || !e.interest || (e.istr || 0) < 40 ? 0.6 : 0.2);
    s += ((e.apt[KNOWLEDGE[field]?.apt?.[0]] ?? 50) - 50) / 80;
    s += this.Ed.know(n, field) / 60; // they already know a little of it (home, a parent)
    if (n.occupation === 'unemployed') s += 0.3;
    return s;
  }

  /** Would the master take them on? */
  masterTakes(master, n) {
    const e = this.Ed.profile(n);
    const bond = master.relations?.[n.id];
    let p = 0.35 + (e.mot - 50) / 150 + ((e.apt.practical ?? 50) - 50) / 150 + ((e.apt.discipline ?? 50) - 50) / 200;
    if (bond) p += bond.t / 150 + bond.f / 200 - bond.c / 60;
    if (master.kin?.children?.includes(n.id)) p += 0.4;
    if (n.traits.includes('lazy')) p -= 0.2;
    if (master.traits.includes('generous') || master.traits.includes('friendly')) p += 0.1;
    return Math.max(0.05, Math.min(0.95, p));
  }

  /** Weekly: masters with room and people looking for a way in find each other. */
  matchApprentices() {
    const sim = this.sim;
    const masters = this.masters();
    if (!masters.length) return;
    const seekers = this.seekers();
    // Every pairing, best first: each young person goes to the trade (and master) they want most.
    const pairs = [];
    for (const m of masters) {
      for (const n of seekers) {
        if (n === m.master) continue;
        const s = this.wantsTrade(n, m.field, m.master);
        if (s >= 1) pairs.push({ m, n, s });
      }
    }
    pairs.sort((a, b) => b.s - a.s);
    const taken = new Set();
    const busy = new Set();
    for (const { m, n } of pairs) {
      if (taken.has(n.id) || busy.has(m.master.id)) continue;
      const r = this.rng(`${m.master.id}:${n.id}:${sim.time.day}`);
      if (!r.chance(this.masterTakes(m.master, n))) continue;
      taken.add(n.id);
      busy.add(m.master.id);
      this.start(n, m.master, m.biz, m.field);
    }
  }

  /** Take someone on as an apprentice at this business (NPC masters, or you — see the player's side). */
  start(n, master, biz, field) {
    const sim = this.sim;
    const E = sim.economy;
    const def = E.def(biz);
    if (n.edu?.enrol && ['evening', 'trade_evening'].includes(n.edu.enrol.stage)) sim.schools?.leave(n, 'work');
    if (n.employer && n.employer !== biz && n.employer !== 'player') {
      sim.memory.remember(n, 'changed_jobs', { params: { building: E.biz(n.employer)?.building } });
      n.prevOccupation = n.occupation;
    }
    if (n.occupation === 'child') n.occupation = 'unemployed';
    if (biz !== 'player') {
      n.employer = biz;
      n.occupation = def.workerOccupation;
      const b = E.biz(biz);
      // An apprentice's place: the business makes room for them.
      b.maxWorkers = Math.max(b.maxWorkers ?? def.maxWorkers ?? 0, sim.npcs.staffOf(biz).length);
    }
    n.hiredDay = sim.time.day;
    n.unpaidDays = 0;
    n.task = null;
    const byPlayer = master === sim.state.player || master.id === 'player';
    n.apprentice = { master: byPlayer ? 'player' : master.id, field, biz, since: sim.time.day, days: 0 };
    delete n.edu.retrain;
    this.A.push({ apprentice: n.id, master: n.apprentice.master, field, biz, since: sim.time.day, days: 0 });
    if (this.A.length > 60) this.A.splice(0, this.A.length - 60);
    if (!byPlayer) {
      n.mentor = master.id;
      sim.state.tech.apprentices[n.id] = master.id;
      sim.memory.remember(n, 'mentored_by', { who: master.id, params: { npc: master.id } });
      sim.memory.remember(master, 'took_apprentice', { who: n.id, params: { npc: n.id } });
      sim.social.adjust(n, master, { f: 6, t: 8, r: 10 });
      sim.social.adjust(master, n, { f: 4, t: 4 });
      sim.chronicle('chronicle.npc_apprentice', { npc: n.id, gender: n.gender, npc2: master.id, field });
    }
    sim.bus.emit('career:apprentice', { id: n.id, master: n.apprentice.master, field });
    return n.apprentice;
  }

  record(n) {
    return this.A.slice().reverse().find((a) => a.apprentice === n.id && !a.done) || null;
  }

  masterOf(n) {
    const id = n.apprentice?.master;
    if (!id) return null;
    return id === 'player' ? this.sim.state.player : this.sim.npcs.byId(id);
  }

  /** How much a master passes on in a day: what they know, and how well they explain it. */
  masterFactor(master, field) {
    if (master === this.sim.state.player) return Math.min(1.4, this.Ed.competence(master, field) / 60) * (0.8 + (this.sim.state.player.skills.leadership?.level || 0) * 0.04);
    const e = this.Ed.profile(master);
    // A workshop famous for the journeymen it has trained teaches a little better still.
    const shop = this.sim.economy.biz(master.owns || master.employer)?.building;
    return Math.min(1.4, this.Ed.competence(master, field) / 65) * (0.6 + (e.apt.social ?? 50) / 200 + this.Ed.know(master, 'speech') / 300) * (this.sim.eduworld?.landmarkBonus('historic_workshop', shop) ?? 1);
  }

  /** The apprenticeship ends — finished, or cut short. */
  end(n, why) {
    const sim = this.sim;
    const a = n.apprentice;
    if (!a) return;
    const rec = this.record(n);
    if (rec) {
      rec.done = why;
      rec.days = a.days;
    }
    delete n.apprentice;
    if (why === 'finished') {
      const e = this.Ed.profile(n);
      e.quals ??= [];
      e.quals.push({ field: a.field, how: 'apprentice', day: sim.time.day });
      if (EDU_LEVELS.indexOf(e.level) < EDU_LEVELS.indexOf('vocational')) e.level = 'vocational';
      sim.memory.remember(n, 'finished_apprenticeship', { who: a.master === 'player' ? 'player' : a.master, params: { field: a.field } });
      sim.chronicle(a.master === 'player' ? 'chronicle.journeyman_player' : 'chronicle.journeyman', { npc: n.id, gender: n.gender, npc2: a.master === 'player' ? undefined : a.master, field: a.field });
      if (a.master === 'player') sim.bus.emit('career:player_apprentice_done', { id: n.id, field: a.field });
    } else if (why !== 'gone') {
      sim.memory.remember(n, 'apprenticeship_ended', { params: { field: a.field } });
    }
    sim.bus.emit('career:apprentice_end', { id: n.id, why });
  }

  /** Someone left the world: an apprenticeship with them as master ends. */
  gone(id) {
    for (const n of this.sim.state.npcs) if (n.apprentice?.master === id) this.end(n, 'master_gone');
  }

  // ------------------------------------------------------------------ a day's work (NPCSystem → EducationSystem.worked)

  /** Called for everyone who worked today: apprentices learn from their master, trainees from the programme. */
  onWorked(n) {
    const a = n.apprentice;
    if (a) {
      const master = this.masterOf(n);
      const beside = master && (master === this.sim.state.player ? true : master.workedToday || master.owns === a.biz);
      if (beside) {
        this.Ed.learn(n, a.field, AP.perDay * this.masterFactor(master, a.field), { cap: AP.knowCap });
        this.Ed.practise(n, a.field, EDU.expPerDay * (AP.expBonus - 1));
        if (master !== this.sim.state.player) this.Ed.practise(master, 'leadership', 0.05);
      }
      a.days++;
    }
    // A business training its people.
    const b = n.employer && n.employer !== 'player' ? this.sim.economy.biz(n.employer) : null;
    if (b?.training) {
      const f = this.Ed.fieldOf(n);
      if (f) this.Ed.learn(n, f, TR.perDay * (b.training.academy ? TR.academyMult : 1), { cap: TR.cap });
    }
  }

  /** An apprentice's wage (a share of the usual). */
  wageMult(n) {
    return n.apprentice ? AP.wageShare : 1;
  }

  // ------------------------------------------------------------------ weekly

  weekly() {
    for (const n of this.sim.state.npcs.slice()) {
      if (n.apprentice) this.checkApprentice(n);
    }
    this.retraining();
    this.matchApprentices();
    this.training();
    this.shortages();
    this.promotions();
  }

  checkApprentice(n) {
    const a = n.apprentice;
    const master = this.masterOf(n);
    if (!master) return this.end(n, 'master_gone');
    if (a.biz !== 'player' && n.employer !== a.biz) return this.end(n, 'left');
    if (a.days >= AP.minDays && this.Ed.competence(n, a.field) >= AP.finishCompetence) this.end(n, 'finished');
  }

  /** Grown-ups who want a different working life look for a way in (an apprenticeship, a course). */
  retraining() {
    for (const n of this.sim.state.npcs) {
      const e = n.edu;
      if (!e || n.age < 20 || n.age > RETRAIN.maxAge || n.owns || n.teach || n.apprentice || n.away) continue;
      if (e.retrain) {
        if (this.Ed.competence(n, e.retrain) >= 40 || e.mot < RETRAIN.minMot - 15) delete e.retrain;
        continue;
      }
      const it = INTERESTS[e.interest];
      if (!it || (e.istr || 0) < RETRAIN.minInterest || e.mot < RETRAIN.minMot) continue;
      const mine = this.Ed.fieldOf(n);
      if (mine && it.fields.includes(mine)) continue; // already doing what they love
      const sat = n.jobSat ?? (n.occupation === 'unemployed' ? 0 : 60);
      if (sat > RETRAIN.maxSat) continue;
      // The trade they'd go for: one practised here, or taught at a trade school.
      const taught = new Set((this.sim.schools?.list() || []).flatMap((s) => (s.kind === 'trade' ? this.sim.schools.courses(s) : [])));
      const field = it.fields.find((f) => taught.has(f) || this.sim.economy.active().some((id) => this.bizField(id) === f)) || null;
      if (!field) continue;
      e.retrain = field;
      this.sim.memory.remember(n, 'wants_retrain', { params: { field } });
      this.sim.bus.emit('career:retrain', { id: n.id, field });
    }
  }

  /** Owners decide whether to train their people (and, in a bigger business, set up an academy). */
  training() {
    const sim = this.sim;
    const E = sim.economy;
    for (const id of E.active()) {
      const b = E.biz(id);
      const owner = E.owner(id);
      if (!owner || b.owner === 'player') continue;
      const staff = sim.npcs.staffOf(id).filter((n) => !n.apprentice);
      const field = this.bizField(id);
      if (!field) continue;
      if (b.training) {
        const cost = staff.length * TR.costPerWorker;
        if (b.money < TR.stopBelow || !staff.length) {
          delete b.training;
          continue;
        }
        b.money -= cost;
        E.ledger(id, 'exp', cost);
        continue;
      }
      if (staff.length < TR.minStaff || b.money < TR.startMoney) continue;
      const avg = staff.reduce((s, n) => s + this.Ed.competence(n, field), 0) / staff.length;
      const keen = owner.traits.includes('ambitious') || owner.traits.includes('entrepreneur') || owner.traits.includes('careful') || (b.shortageStep || 0) >= 2;
      if (avg < 45 && keen && !owner.traits.includes('greedy')) {
        const academy = staff.length >= TR.academyStaff && b.money >= TR.academyMoney;
        if (academy) {
          b.money -= TR.academyCost;
          E.ledger(id, 'exp', TR.academyCost);
        }
        b.training = { since: sim.time.day, academy };
        sim.chronicle(academy ? 'chronicle.business_academy' : 'chronicle.business_training', { npc: owner.id, gender: owner.gender, building: b.building, field });
      }
    }
  }

  /** Skilled vacancies nobody's fit for: the business responds, step by step. */
  shortages() {
    const sim = this.sim;
    const E = sim.economy;
    const open = new Set(sim.npcs.vacancies().map(([id]) => id));
    for (const id of E.active()) {
      const b = E.biz(id);
      const def = E.def(id);
      if (!open.has(id) || !SKILLED.occupations.includes(def.workerOccupation)) {
        delete b.vacantSince;
        b.shortageStep = 0;
        continue;
      }
      b.vacantSince ??= sim.time.day;
      if (sim.time.day - b.vacantSince < SKILLED.waitDays) continue;
      const step = b.shortageStep || 0;
      const owner = E.owner(id);
      if (step === 0) b.wageLevel = Math.min(1.5, (b.wageLevel ?? 1) + SKILLED.wageStep); // 1. better pay
      else if (step === 1 && owner && b.owner !== 'player') {
        // 2. take on a youngster and teach them (the owner must be good enough to teach).
        const field = this.bizField(id);
        if (this.Ed.competence(owner, field) >= AP.masterMin - 10) {
          const n = this.seekers().filter((x) => x.age <= AP.maxAge).sort((a, c) => this.wantsTrade(c, field, owner) - this.wantsTrade(a, field, owner))[0];
          if (n && this.wantsTrade(n, field, owner) >= 0.6) this.start(n, owner, id, field);
        }
      } else if (step === 3 && b.money >= SKILLED.recruitMoney) this.recruit(id); // 4. send for someone trained
      b.shortageStep = step + 1;
      if (step === 0 && sim.time.day - (b.shortageNotice ?? -999) >= SKILLED.noticeEvery) {
        b.shortageNotice = sim.time.day;
        sim.chronicle('chronicle.skill_shortage', { building: b.building, occ: def.workerOccupation, npc: owner?.id });
        sim.bus.emit('education:event', { kind: 'skill_shortage', biz: id });
      }
    }
  }

  /** A trained worker comes from a town that knows the trade, and is taken on. */
  recruit(bizId) {
    const sim = this.sim;
    const E = sim.economy;
    const b = E.biz(bizId);
    const def = E.def(bizId);
    const field = OCC_FIELDS[def.workerOccupation]?.[0];
    const fromChar = { forestry: 'forest', mining: 'mining', fishing: 'fishing', farming: 'herding', trade: 'market' }[field];
    const towns = sim.settlements?.contacts?.() || [];
    const from = towns.find((id) => sim.settlements.def(id)?.character === fromChar) || towns.find((id) => ['town', 'city'].includes(sim.settlements.sizeOf(sim.settlements.get(id).pop))) || undefined;
    const n = sim.growth?.arrive({ size: 1, from })?.[0];
    if (!n) return null;
    const e = this.Ed.profile(n);
    e.know[field] = Math.max(e.know[field] || 0, SKILLED.recruitCompetence);
    e.exp[field] = Math.max(e.exp[field] || 0, SKILLED.recruitCompetence);
    b.money -= 60; // their journey and the first week's keep
    E.ledger(bizId, 'exp', 60);
    n.occupation = def.workerOccupation;
    n.employer = bizId;
    n.hiredDay = sim.time.day;
    sim.chronicle('chronicle.skilled_recruited', { npc: n.id, gender: n.gender, building: b.building, occ: def.workerOccupation, settlement: from });
    return n;
  }

  /** Rising in the trade is news (and a memory). */
  promotions() {
    const sim = this.sim;
    for (const n of sim.state.npcs) {
      const t = this.tier(n);
      if (!t) continue;
      const before = n.careerTier;
      n.careerTier = t;
      if (!before || before === t) continue;
      const order = CAREER_TIERS.map(([id]) => id);
      if (order.indexOf(t) > order.indexOf(before) && ['senior', 'master'].includes(t)) {
        sim.memory.remember(n, 'rose_in_trade', { params: { tier: t, field: this.Ed.fieldOf(n) } });
        if (t === 'master') sim.chronicle('chronicle.npc_became_master', { npc: n.id, gender: n.gender, occ: n.occupation });
      }
    }
  }

  // ------------------------------------------------------------------ figures

  summary() {
    const npcs = this.sim.state.npcs;
    return {
      apprentices: npcs.filter((n) => n.apprentice).length,
      journeymen: npcs.filter((n) => n.edu?.quals?.some((q) => q.how === 'apprentice')).length,
      masters: npcs.filter((n) => this.tier(n) === 'master').length,
      training: this.sim.economy.active().filter((id) => this.sim.economy.biz(id).training).length,
    };
  }
}
