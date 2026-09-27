/**
 * PopulationSystem — the valley's people as a whole: how many are born, die, come and go, and what's likely
 * to happen next.
 *
 *   Births        follow how the valley is doing: money in people's pockets, work, bread they can afford,
 *                 their mood, a grandparent at home to help — and the headman's family policy (an allowance
 *                 for every baby, or none).
 *   Deaths        follow care: a doctor or the clinic, a roof, enough to eat — and the health policy (a free
 *                 clinic for all, or the sick pay their own way). Life expectancy is worked out from it.
 *   The young     18–26, unmarried, with no work or no prospects here, may go off to the towns to seek their
 *                 fortune; a year or three later many come back — with savings and a trade.
 *   Labour        how many positions go unfilled against how many are looking for work: short of hands, pay
 *                 on the notice board goes up; too many looking, it goes down (JobSystem.pay).
 *   Stages        child · youth · adult · elder, for the population screen.
 *   Forecast      the next ten years if things go on as they are.
 *
 * No dice: who goes, when they return, follow hashStr of the person and the season.
 *
 *   state.population = { years: { [year]: { births, deaths, arrived, left, abroad, returned, start } },
 *                        abroad: [{ npc, left, back, trade }], allowances, grants, healthPaid }
 */
import { LIFE } from './FamilySystem.js';
import { POLICIES } from '../data/civic.js';
import { ENTRY_POINT } from './GrowthSystem.js';
import { hashStr } from '../core/rng.js';

export const POP = {
  stages: [['child', 13], ['youth', 18], ['adult', 60], ['elder', 999]],
  birth: { money: 150, min: 0.4, max: 1.8, grandparent: 1.15 },
  death: { min: 0.5, max: 2.2, care: 0.8, homeless: 1.4, hungry: 1.3 },
  youth: { from: 18, to: 26, chance: 0.05, perSeason: 1, awaySeasons: [4, 12], money: [120, 480] },
  trades: ['carpenter_hand', 'store_clerk', 'builder', 'smith_hand', 'factory_hand', 'baker_hand', 'warehouse_hand'],
  returnIfAttractive: -3, // they come home unless the valley is in a bad way (or family's still here)
  allowance: 40, // for each baby, from the treasury (family policy 'high')
  welcomeGrant: 20, // for each grown-up newcomer (welcome policy 'high')
  welcomeAttraction: { low: -0.8, normal: 0, high: 0.8 },
  healthCost: 20, // a week, for the free clinic (health policy 'high')
  reserve: 40, // the treasury never goes below this for these
  wage: { min: 0.85, max: 1.2, k: 0.6 },
  keepYears: 12,
};

export class PopulationSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.population ??= { years: {}, abroad: [], allowances: 0, grants: 0, healthPaid: true };
    this.cache = {};
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:season', () => this.youthMoves());
    sim.bus.on('settlement:arrived', (ids) => this.arrived(ids));
  }

  get S() {
    return this.sim.state.population;
  }

  pop() {
    return this.sim.state.npcs.length + 1;
  }

  policy(kind) {
    return this.sim.state.civic?.policies?.[kind] || 'normal';
  }

  treasury() {
    return this.sim.state.village;
  }

  /** Take from the treasury (never below the reserve). Returns what could be paid. */
  spend(n) {
    const V = this.treasury();
    const pay = Math.max(0, Math.min(n, (V.treasury || 0) - POP.reserve));
    V.treasury -= pay;
    return pay;
  }

  // ------------------------------------------------------------------ the record

  yearRec(y = this.sim.time.year) {
    const Y = this.S.years;
    if (!Y[y]) {
      Y[y] = { births: 0, deaths: 0, arrived: 0, left: 0, abroad: 0, returned: 0, start: this.pop() };
      const ys = Object.keys(Y).map(Number).sort((a, b) => a - b);
      while (ys.length > POP.keepYears) delete Y[ys.shift()];
    }
    return Y[y];
  }

  record(kind, n = 1) {
    this.yearRec()[kind] += n;
  }

  /** A baby was born (FamilySystem): counted, and under a generous family policy, an allowance. */
  born(baby, mother) {
    this.record('births');
    if (this.policy('family') === 'high' && mother) {
      const pay = this.spend(POP.allowance);
      if (pay > 0) {
        mother.money += pay;
        this.S.allowances += pay;
      }
    }
  }

  died() {
    this.record('deaths');
  }

  arrived(ids) {
    const people = (ids || []).map((id) => this.sim.npcs.byId(id)).filter(Boolean);
    const back = people.filter((n) => n.returnedDay === this.sim.time.day);
    this.record('arrived', people.length - back.length);
    if (this.policy('welcome') !== 'high') return;
    for (const n of people) {
      if (n.age < 18 || back.includes(n)) continue;
      const pay = this.spend(POP.welcomeGrant);
      if (pay <= 0) break;
      n.money += pay;
      this.S.grants += pay;
    }
  }

  /** Someone has walked out of the valley (NPCSystem.departed): gone for good — or off to the towns for a while. */
  departed(npc) {
    if (!npc.abroad) return this.record('left');
    this.record('abroad');
    const day = this.sim.time.day;
    const h = hashStr(`abroad:${npc.id}:${day}`, this.sim.state.seed);
    const [a, b] = POP.youth.awaySeasons;
    const seasons = a + Math.floor(h * (b - a + 1));
    const snap = JSON.parse(JSON.stringify(npc));
    for (const k of ['task', 'path', 'leaving', 'leaveTo', 'abroad', 'inside', 'employer', 'owns', 'goal']) delete snap[k];
    this.S.abroad.push({ npc: snap, left: day, back: day + seasons * 14, trade: POP.trades[Math.floor(((h * 97) % 1) * POP.trades.length)] });
  }

  // ------------------------------------------------------------------ life stages

  stage(npc) {
    if (npc.occupation === 'elder') return 'elder';
    return POP.stages.find(([, to]) => npc.age < to)[0];
  }

  stages() {
    const out = { child: 0, youth: 0, adult: 0, elder: 0 };
    for (const n of this.sim.state.npcs) out[this.stage(n)]++;
    out.adult++; // (you)
    return out;
  }

  /** Ten-year age bands by sex, for the population pyramid. */
  pyramid() {
    const bands = [];
    for (let a = 0; a < 90; a += 10) bands.push({ from: a, to: a + 9, m: 0, f: 0 });
    bands.push({ from: 90, to: 120, m: 0, f: 0 });
    const add = (age, g) => {
      const b = bands[Math.min(bands.length - 1, Math.floor(age / 10))];
      b[g === 'f' ? 'f' : 'm']++;
    };
    for (const n of this.sim.state.npcs) add(n.age, n.gender);
    const p = this.sim.state.player;
    add(p.age ?? 25, p.gender);
    return bands;
  }

  // ------------------------------------------------------------------ how the valley is doing

  prosperity() {
    const hour = Math.floor(this.sim.time.total / 60);
    if (this.cache.prosperity?.hour === hour) return this.cache.prosperity.v;
    const sim = this.sim;
    const adults = sim.state.npcs.filter((n) => n.age >= 18 && n.occupation !== 'elder');
    const money = adults.length ? adults.reduce((s, n) => s + Math.max(0, n.money), 0) / adults.length : 0;
    const jobless = adults.length ? adults.filter((n) => n.occupation === 'unemployed').length / adults.length : 0;
    const E = sim.economy;
    const bread = E.sellersOf('bread');
    const food = bread.length ? bread.reduce((s, id) => s + E.priceFactor(id, 'bread'), 0) / bread.length : 1.4;
    const mood = sim.state.npcs.length ? sim.state.npcs.reduce((s, n) => s + (n.mood ?? 60), 0) / sim.state.npcs.length : 60;
    const homeless = sim.state.npcs.filter((n) => !n.homeId && n.age >= 16).length;
    const v = { money: Math.round(money), jobless, food, mood: Math.round(mood), homeless };
    this.cache.prosperity = { hour, v };
    return v;
  }

  /** How much likelier (or less likely) a couple is to have a baby, the way things are. */
  birthMult(mother = null) {
    const P = this.prosperity();
    const B = POP.birth;
    let m = 1;
    m *= Math.max(0.75, Math.min(1.25, 0.75 + P.money / (B.money * 2)));
    m *= 1 - P.jobless * 0.5;
    if (P.food > 1.4) m *= 0.8;
    m *= 0.8 + (mother?.mood ?? P.mood) / 250;
    if (mother && this.sim.family.household(mother).some((n) => this.stage(n) === 'elder')) m *= B.grandparent;
    m *= POLICIES.family[this.policy('family')] ?? 1;
    return Math.max(B.min, Math.min(B.max, m));
  }

  /** Is there a doctor or the clinic? */
  care() {
    return this.sim.state.npcs.some((n) => n.occupation === 'doctor') || !!this.sim.civic?.has('clinic');
  }

  healthPolicyMult() {
    const lvl = this.policy('health');
    // A free clinic only if the village could pay for it this week.
    if (lvl === 'high' && !this.S.healthPaid) return 1;
    return POLICIES.health[lvl] ?? 1;
  }

  /** How much likelier this villager is to die this year than the old tables say. */
  deathMult(npc = null) {
    const D = POP.death;
    let m = 1;
    if (this.care()) m *= D.care;
    if (npc && !npc.homeId && npc.age >= 16) m *= D.homeless;
    if (npc && (npc.hunger ?? 80) < 20) m *= D.hungry;
    m *= this.healthPolicyMult();
    return Math.max(D.min, Math.min(D.max, m));
  }

  /** The chance a person of this age dies within the year (FamilySystem's table, before care). */
  baseDeath(age) {
    if (age < 60) return 0.002;
    for (const [a, p] of LIFE.deathChanceByAge) if (age < a) return p;
    return 0.5;
  }

  /** Years a newborn can expect to live, and a 60-year-old, the way things are. */
  lifeExpectancy() {
    const mult = this.deathMult();
    const from = (start) => {
      let alive = 1;
      let years = 0;
      for (let age = start; age < 110 && alive > 0.001; age++) {
        alive *= 1 - Math.min(0.95, this.baseDeath(age) * mult);
        years += alive;
      }
      return Math.round(start + years);
    };
    return { birth: from(0), at60: from(60) };
  }

  // ------------------------------------------------------------------ labour

  /** Positions going unfilled against people looking for work. */
  labour() {
    const hour = Math.floor(this.sim.time.total / 60);
    if (this.cache.labour?.hour === hour) return this.cache.labour.v;
    const sim = this.sim;
    const vacancies = sim.npcs.vacancies().reduce((s, [id]) => s + Math.max(0, sim.npcs.maxStaff(id) - sim.npcs.staffOf(id).length), 0);
    const seekers = sim.state.npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 16 && n.age < 60 && !n.leaving).length;
    const adults = Math.max(6, sim.state.npcs.filter((n) => n.age >= 16 && n.age < 60).length);
    const W = POP.wage;
    const factor = Math.round(Math.max(W.min, Math.min(W.max, 1 + ((vacancies - seekers) / adults) * W.k)) * 100) / 100;
    const v = { vacancies, seekers, factor, state: factor >= 1.05 ? 'short' : factor <= 0.95 ? 'surplus' : 'balanced' };
    this.cache.labour = { hour, v };
    return v;
  }

  wageFactor() {
    return this.labour().factor;
  }

  // ------------------------------------------------------------------ the young go to the towns (and come back)

  /** Would this young person go? No work, or no future here — and nothing (a spouse, a business) holding them. */
  mightGo(n) {
    const Y = POP.youth;
    if (n.age < Y.from || n.age > Y.to || n.kin?.spouse || n.owns || n.leaving || n.away || n.employer === 'player') return false;
    if (n.partner || this.sim.goals?.saving?.(n)) return false;
    const noWork = n.occupation === 'unemployed';
    const noFuture = (this.sim.state.settlement?.lastAttractiveness ?? 0) < 0 && !this.sim.npcs.vacancies().length;
    return noWork || noFuture;
  }

  /** Each season: one or two of the young may set off for the towns. */
  youthMoves() {
    const sim = this.sim;
    const Y = POP.youth;
    const key = `${sim.time.year}:${sim.time.season}`;
    let gone = 0;
    const policy = this.policy('welcome') === 'high' ? 0.7 : 1; // a valley that welcomes people holds on to its own too
    for (const n of sim.state.npcs.slice()) {
      if (gone >= Y.perSeason || !this.mightGo(n)) continue;
      const chance = Y.chance * (n.occupation === 'unemployed' ? 2 : 1) * policy * (n.traits?.includes('ambitious') || n.traits?.includes('adventurous') ? 1.5 : 1);
      if (hashStr(`youth:${n.id}:${key}`, sim.state.seed) >= chance) continue;
      this.goAbroad(n);
      gone++;
    }
  }

  goAbroad(n) {
    const sim = this.sim;
    n.abroad = true;
    for (const [id, v] of Object.entries(n.relations || {})) {
      const friend = sim.npcs.byId(id);
      if (friend && v.f >= 40) sim.memory.remember(friend, 'friend_left', { who: n.id, params: { npc: n.id } });
    }
    if (n.employer === 'player') delete sim.state.workers[n.id];
    n.employer = null;
    n.task = null;
    sim.chronicle('chronicle.youth_to_town', { npc: n.id, gender: n.gender });
    sim.npcs.sendAway(n, ENTRY_POINT);
  }

  /** Home again: older, with savings and a trade learned in the towns. */
  comeBack(a) {
    const sim = this.sim;
    const snap = a.npc;
    if (sim.npcs.byId(snap.id)) return null;
    const years = Math.floor((sim.time.day - a.left) / 56);
    const h = hashStr(`back:${snap.id}:${a.back}`, sim.state.seed);
    const [lo, hi] = POP.youth.money;
    const at = sim.world.tileCenter(ENTRY_POINT.tx, ENTRY_POINT.ty);
    const parents = (snap.kin?.parents || []).map((id) => sim.npcs.byId(id)).filter(Boolean);
    const home = parents.find((p) => p.homeId && sim.property.occupants(p.homeId) < sim.property.capacity(p.homeId))?.homeId || null;
    const n = sim.npcs.spawn({
      ...snap,
      x: at.x,
      y: at.y,
      homeId: home,
      inside: null,
      task: null,
      employer: null,
      owns: null,
      leaving: false,
      occupation: 'unemployed',
      prevOccupation: a.trade,
      age: snap.age + years,
      money: Math.max(0, snap.money || 0) + lo + Math.floor(h * (hi - lo)),
      level: (snap.level || 1) + 1,
      returnedDay: sim.time.day,
      relations: snap.relations || {},
    });
    sim.state.emigrants = (sim.state.emigrants || []).filter((e) => e.id !== n.id);
    for (const p of parents) sim.memory.remember(p, 'child_returned', { who: n.id, params: { npc: n.id } });
    this.record('returned');
    sim.chronicle('chronicle.youth_returned', { npc: n.id, gender: n.gender, occ: a.trade });
    sim.bus.emit('settlement:arrived', [n.id]);
    return n;
  }

  returns() {
    const sim = this.sim;
    const day = sim.time.day;
    const due = this.S.abroad.filter((a) => day >= a.back);
    for (const a of due) {
      this.S.abroad.splice(this.S.abroad.indexOf(a), 1);
      const family = (a.npc.kin?.parents || []).some((id) => sim.npcs.byId(id)) || (a.npc.kin?.siblings || []).some((id) => sim.npcs.byId(id));
      const draw = sim.state.settlement?.lastAttractiveness ?? 0;
      if (family || draw >= POP.returnIfAttractive) this.comeBack(a);
      else sim.chronicle('chronicle.youth_stayed_away', { npc: a.npc.id, gender: a.npc.gender });
    }
  }

  // ------------------------------------------------------------------ the forecast

  /** Births, deaths and people moving in a year, the way things are (the model, steadied by the record). */
  rates() {
    const sim = this.sim;
    let births = 0;
    for (const m of sim.state.npcs) {
      if (m.gender !== 'f' || m.age < LIFE.fertileFrom || m.age > LIFE.fertileTo) continue;
      const f = sim.family.spouse(m);
      if (!f || f.gender !== 'm') continue;
      const kids = m.kin.children.filter((id) => sim.npcs.byId(id)).length;
      births += 4 * LIFE.birthChancePerSeason * Math.pow(0.6, kids) * (m.age > 35 ? 0.6 : 1) * this.birthMult(m);
    }
    let deaths = 0;
    for (const n of sim.state.npcs) deaths += Math.min(0.95, this.baseDeath(n.age) * (n.health < 40 ? 3 : 1) * this.deathMult(n));
    const ys = Object.keys(this.S.years).map(Number).sort((a, b) => b - a).slice(0, 2);
    const net = ys.length ? ys.reduce((s, y) => { const r = this.S.years[y]; return s + r.arrived + r.returned - r.left - r.abroad; }, 0) / ys.length : 0;
    const Y = this.yearRec();
    return { births: Math.round(births * 10) / 10, deaths: Math.round(deaths * 10) / 10, migration: Math.round(net * 10) / 10, thisYear: Y };
  }

  /** The next years if things go on as they are: [{ year, pop, elders }]. */
  forecast(years = 10) {
    const r = this.rates();
    const out = [];
    let pop = this.pop();
    const ages = this.sim.state.npcs.map((n) => n.age);
    const perHead = pop > 0 ? (r.births - r.deaths + r.migration) / pop : 0;
    for (let y = 1; y <= years; y++) {
      pop = Math.max(1, pop * (1 + perHead));
      const elders = ages.filter((a) => a + y >= 60).length;
      out.push({ year: this.sim.time.year + y, pop: Math.round(pop), elders });
    }
    return { rates: r, years: out, trend: perHead > 0.01 ? 'growing' : perHead < -0.01 ? 'shrinking' : 'steady' };
  }

  // ------------------------------------------------------------------ daily

  onDay() {
    this.yearRec();
    this.returns();
    if (this.sim.time.weekday === 3 && this.policy('health') === 'high') {
      this.S.healthPaid = this.spend(POP.healthCost) >= POP.healthCost;
    } else if (this.policy('health') !== 'high') this.S.healthPaid = true;
  }

  /** The welcome policy's pull on newcomers (GrowthSystem.attractiveness). */
  welcomeBonus() {
    return POP.welcomeAttraction[this.policy('welcome')] ?? 0;
  }

  summary() {
    return { pop: this.pop(), stages: this.stages(), life: this.lifeExpectancy(), labour: this.labour(), prosperity: this.prosperity(), birthMult: this.birthMult(), deathMult: this.deathMult(), care: this.care(), abroad: this.S.abroad.length };
  }
}
