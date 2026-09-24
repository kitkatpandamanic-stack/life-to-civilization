/**
 * GoalSystem — what each villager is trying to do with their life, and why.
 *
 *   npc.goal = { type, since, why: ['long_walk', 'trait:ambitious', 'opportunity:bakery', …],
 *                target?, biz?, backer?, packDay?, stage? }
 *   npc.goalsDone = [{ type, day }]   (the last few goals they achieved)
 *
 * Once a week (on a day of their own) each villager weighs their options. Every
 * candidate goal gets a score from their personality, money, needs, relationships,
 * the opportunities around them, what they remember, and how the village is doing
 * — and every point of that score comes with a reason, so the choice can be
 * explained in the Inspect panel and in conversation. The goal they're already
 * pursuing gets a bonus: people stick to their plans unless something changes.
 *
 * Goals aren't labels — they change behaviour elsewhere:
 *   save / buy_house / business  → they stop eating out and buying luxuries (NPCSystem.isSaving)
 *   buy_house     → buy with a thinner cushion, and look at any home for sale (PropertySystem.market)
 *   business      → even a villager without the entrepreneur's temperament tries to open one
 *                   (EnterpriseSystem.candidate); you can back them for a share of the profits
 *   master        → they learn faster (NPCSystem.onDay)
 *   better_job    → they switch jobs more readily — including leaving you for better pay
 *   grow_business → they take on staff sooner (EnterpriseSystem.manageStaff)
 *   family        → courtship and children are likelier (FamilySystem)
 *   settle        → they move (or build) near a far-off workplace — this is how hamlets fill up
 *   leave         → after a while, and a few days of packing, the household moves away —
 *                   unless someone (you) talks them round
 */
import { GOALS as G, GOAL_AGAINST } from '../data/goals.js';
import { BUSINESS_TYPES, EXPERIENCE, ENTERPRISE as EN } from '../data/businessTypes.js';
import { HOUSING } from '../data/housing.js';
import { OCCUPATIONS } from '../data/occupations.js';
import { rand } from '../core/rng.js';

export class GoalSystem {
  constructor(sim) {
    this.sim = sim;
    this.ctx = null; // per-day cache of village-wide facts
    sim.bus.on('time:day', () => this.onDay());
    // Newcomers and grown-up children decide what they're after straight away.
    sim.bus.on('npc:added', (id) => {
      const n = sim.npcs.byId(id);
      if (n) this.reconsider(n);
    });
  }

  get S() {
    this.sim.state.settlement.goals ??= { achieved: 0, gaveUp: 0, left: 0, settled: 0, backed: 0 };
    return this.sim.state.settlement.goals;
  }

  // ------------------------------------------------------------------ reading

  /** The goal as the UI shows it: { type, saved, target, why, progress }. */
  view(npc) {
    const g = npc.goal || this.reconsider(npc);
    const out = { type: g.type, why: g.why || [], saved: Math.floor(npc.money), target: g.target || 0, biz: g.biz, packing: !!g.packDay };
    if (g.type === 'business' && g.target && npc.money >= g.target) out.type = 'business_ready';
    if (g.target) out.progress = Math.max(0, Math.min(1, npc.money / g.target));
    return out;
  }

  /** Is this villager putting money aside for something (no meals out, no luxuries)? */
  saving(npc) {
    const g = npc.goal;
    if (!g || !['save', 'buy_house', 'business'].includes(g.type)) return false;
    return npc.money < (g.target || Infinity);
  }

  is(npc, type) {
    return npc.goal?.type === type;
  }

  // ------------------------------------------------------------------ the week's thinking

  onDay() {
    this.ctx = null;
    const day = this.sim.time.day;
    let departures = 0;
    for (const npc of this.sim.state.npcs.slice()) {
      if (npc.leaving || npc.away) continue;
      if (!npc.goal) this.reconsider(npc);
      if (this.checkDone(npc)) this.reconsider(npc);
      else if (!npc.goal.packDay && (this.hash(npc.id) + day) % 7 === 0) this.reconsider(npc); // packing: only you (or family) can change their mind
      const g = npc.goal;
      if (g.type === 'settle' && (this.hash(npc.id) + day) % 7 === 3) this.trySettle(npc);
      if (g.type === 'better_job' && npc.employer === 'player' && (this.hash(npc.id) + day) % 7 === 5) this.maybePoached(npc);
      if (g.type === 'leave' && departures === 0 && this.advanceLeaving(npc)) departures++;
    }
  }

  hash(id) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997;
    return h;
  }

  /** Village-wide facts every villager weighs (computed once a day). */
  context() {
    if (this.ctx) return this.ctx;
    const sim = this.sim;
    const E = sim.economy;
    const vac = sim.npcs.vacancies();
    const opp = {};
    for (const type of Object.keys(BUSINESS_TYPES)) if (BUSINESS_TYPES[type].openable) opp[type] = sim.enterprise.opportunity(type);
    const bread = E.sellersOf('bread');
    const food = bread.length ? bread.reduce((s, id) => s + E.priceFactor(id, 'bread'), 0) / bread.length : 1.3;
    const P = sim.property;
    const forSale = P.homes().filter((id) => P.isVacant(id) && (P.rec(id)?.forSale || P.rec(id)?.owner === 'village' || !P.rec(id)?.owner) && !E.businessAtBuilding(id));
    this.ctx = {
      vacancies: vac,
      opp,
      foodDear: food > 1.6,
      slump: sim.events.modifier('migration') < 1,
      cheapest: forSale.map((id) => P.value(id)).sort((a, b) => a - b)[0] || 0,
    };
    return this.ctx;
  }

  /** Weekly pay they can count on (for targets and budgets). */
  weeklyPay(npc) {
    if (npc.employer === 'player') return (this.sim.workers.contract(npc.id)?.salary || 10) * 6;
    if (npc.employer) return this.sim.npcs.wageFor(npc.employer, npc) * 6;
    if (npc.owns) return Math.max(40, this.sim.enterprise.books(npc.owns, 7).profit);
    return (OCCUPATIONS[npc.occupation]?.wage || 0) * 6;
  }

  /** Score every goal that makes sense for this villager right now. Returns { type: { s, why[] } }. */
  candidates(npc) {
    const sim = this.sim;
    const out = {};
    const add = (type, s, why) => (out[type] = { s, why: why.filter(Boolean) });
    const T = (t) => npc.traits.includes(t);
    const day = sim.time.day;
    const recent = (kind, days = 112) => (npc.memories || []).some((m) => m.k === kind && day - m.d <= days);

    if (npc.age < 16) return { grow: { s: 1, why: [] } };
    if (npc.occupation === 'elder') return { legacy: { s: 1, why: [] } };

    const ctx = this.context();
    const P = sim.property;
    const E = sim.economy;
    const homeless = !npc.homeId || npc.homeId === 'hall';
    const jobless = npc.occupation === 'unemployed';
    const pay = this.weeklyPay(npc);
    const spouse = sim.family.spouse(npc);
    const kidsHome = sim.family.children(npc).filter((k) => k.homeId === npc.homeId && k.age < 16).length;
    const ownsHome = npc.homeId && P.rec(npc.homeId)?.owner === npc.id;
    const rent = P.landlord(npc);

    const joblessDays = sim.state.settlement.joblessSince?.[npc.id] !== undefined ? day - sim.state.settlement.joblessSince[npc.id] : 0;
    if (homeless) add('home', 9, ['no_home']);
    // Hope fades: weeks without work make other plans (like leaving) look better.
    if (jobless) add('job', Math.max(2.5, 8 - Math.max(0, joblessDays - 14) / 5), ['no_work']);

    // Contentment: the default for people with what they need.
    {
      const why = [];
      let s = 1;
      if ((npc.mood ?? 60) >= 62) (s += 0.8), why.push('content');
      if (T('careful')) (s += 0.5), why.push('trait:careful');
      if (T('lazy')) (s += 1), why.push('trait:lazy');
      if (npc.age >= 45) (s += 0.7), why.push('settled_age');
      if (homeless || jobless) s -= 3;
      add('steady', s, why);
    }

    // Putting money aside.
    {
      const target = Math.max(G.minSaveTarget, Math.round(pay * G.saveWeeks));
      const why = [];
      let s = 0.3;
      if (npc.money < pay * 1.5 || npc.money < 25) (s += 1.4), why.push('little_savings');
      if (T('careful')) (s += 1.5), why.push('trait:careful');
      if (kidsHome) (s += 0.7), why.push('children');
      if (recent('went_hungry') || recent('slept_rough') || recent('business_failed', 224) || recent('laid_off')) (s += 1.5), why.push('hard_times');
      if (ctx.foodDear) (s += 0.8), why.push('prices_high');
      if (npc.money >= target) s -= 4;
      if (jobless) s -= 1; // nothing coming in to save
      add('save', s, why);
      out.save.target = target;
    }

    // A home of their own.
    if (!ownsHome && npc.age >= 21 && !homeless) {
      const why = [];
      let s = 0.5;
      const price = rent ? P.value(npc.homeId) : ctx.cheapest || P.value(npc.homeId || 'hall');
      if (spouse || kidsHome) (s += 1.8), why.push('family_needs_home');
      if (recent('evicted', 224)) (s += 1.5), why.push('was_evicted');
      if (T('careful')) (s += 0.7), why.push('trait:careful');
      if (rent && P.weeklyRent(npc.homeId) > pay * 0.3) (s += 1), why.push('rent_high');
      if (ctx.cheapest && ctx.cheapest <= npc.money * 1.5 + pay * 8) (s += 1.5), why.push('house_for_sale');
      if (!rent && !npc.lodger) s -= 2; // living rent-free with family
      if (price && npc.money + pay * 16 < price) (s -= 2), why.push('out_of_reach'); // not in this lifetime, at this pay
      if (jobless || !price) s -= 3;
      add('buy_house', s, why);
      out.buy_house.target = Math.round((price || 300) * G.houseBuyReserve);
    }

    // A business of their own.
    if (!npc.owns && npc.age >= EN.minAge && npc.age <= EN.maxAge - 3) {
      const why = [];
      let s = -1.5;
      if (T('entrepreneur')) (s += 3), why.push('trait:entrepreneur');
      if (T('ambitious')) (s += 1.3), why.push('trait:ambitious');
      if (T('risk_taker')) (s += 0.8), why.push('trait:risk_taker');
      if (T('natural_leader')) (s += 0.5), why.push('trait:natural_leader');
      if (T('careful')) s -= 1;
      const rank = sim.npcs.rank(npc);
      const trade = Object.keys(EXPERIENCE).find((ty) => BUSINESS_TYPES[ty]?.openable && (EXPERIENCE[ty].includes(npc.occupation) || EXPERIENCE[ty].includes(npc.prevOccupation)));
      if (trade && (rank === 'skilled' || rank === 'master')) (s += 1.5), why.push('knows_trade');
      let best = null;
      for (const [ty, v] of Object.entries(ctx.opp)) if (v > 0.4 && (!best || v + (ty === trade ? 1 : 0) > best.v)) best = { ty, v: v + (ty === trade ? 1 : 0) };
      if (best) (s += Math.min(2, best.v)), why.push(`opportunity:${best.ty}`);
      if (recent('business_failed', 336)) (s -= 3), why.push('failed_before');
      if ((npc.jobSat ?? 60) < 40 && npc.employer) (s += 0.5), why.push('unhappy_at_work');
      if (npc.money >= G.businessTarget) s += 1;
      add('business', s, why);
      out.business.target = G.businessTarget;
      out.business.biz = best?.ty || trade || null;
    }

    // Mastering the trade.
    const rank = sim.npcs.rank(npc);
    if (rank && rank !== 'master' && !jobless) {
      const why = [];
      let s = 0;
      if (T('ambitious')) (s += 2), why.push('trait:ambitious');
      if (T('scholar')) (s += 1.5), why.push('trait:scholar');
      if (T('hard_worker')) (s += 1), why.push('trait:hard_worker');
      if (rank === 'skilled') (s += 1), why.push('close_to_mastery');
      if (npc.age < 30) (s += 0.5), why.push('young');
      if (T('lazy')) s -= 2;
      add('master', s, why);
    }

    // A better job.
    if (npc.employer && !npc.owns) {
      const owner = npc.employer === 'player' ? null : E.owner(npc.employer);
      const family = owner && npc.family.includes(owner.id);
      if (!family) {
        const why = [];
        let s = -0.5;
        const sat = npc.employer === 'player' ? sim.workers.contract(npc.id)?.satisfaction ?? 60 : npc.jobSat ?? 60;
        if (sat < 45) (s += (45 - sat) / 8), why.push('unhappy_at_work');
        if (npc.unpaidDays > 0 || (npc.employer === 'player' && sim.workers.contract(npc.id)?.unpaid > 0)) (s += 2), why.push('wages_unpaid');
        const bond = npc.employer === 'player' ? sim.social.playerBond(npc) : owner && sim.social.bond(npc, owner);
        if (bond && bond.c >= 30) (s += 2), why.push('boss_conflict');
        const here = npc.employer === 'player' ? (sim.workers.contract(npc.id)?.salary || 10) / 3 + 3 : sim.npcs.jobAppeal(npc, npc.employer);
        const better = ctx.vacancies.some(([id]) => id !== npc.employer && sim.npcs.jobAppeal(npc, id) > here + 2);
        if (better) (s += 1.5), why.push('better_offer');
        const trained = npc.prevOccupation && npc.prevOccupation !== npc.occupation && ctx.vacancies.some(([, d]) => d.workerOccupation === npc.prevOccupation);
        if (trained) (s += 1), why.push('wrong_trade');
        if (T('ambitious')) (s += 0.5), why.push('trait:ambitious');
        if (T('loyal')) s -= 1.5;
        add('better_job', s, why);
      }
    }

    // Growing the business they own.
    if (npc.owns && E.biz(npc.owns) && !E.biz(npc.owns).closed) {
      const b = E.biz(npc.owns);
      const books = sim.enterprise.books(npc.owns, 14);
      const why = [];
      let s = -0.5;
      if (books.profit > 0 && b.money > EN.expandAbove * 0.5) (s += 2), why.push('business_doing_well');
      if (T('ambitious')) (s += 1), why.push('trait:ambitious');
      if (T('entrepreneur')) (s += 1), why.push('trait:entrepreneur');
      if (T('careful')) s -= 0.5;
      if ((b.troubleDays || 0) > 0 || books.profit <= 0) s -= 3;
      add('grow_business', s, why);
    }

    // Love and children.
    if (npc.age >= 18 && npc.age <= 45) {
      const why = [];
      let s = -0.5;
      if (!spouse) {
        if (npc.partner) (s += 1.8), why.push('courting');
        if ((npc.social ?? 60) < 35) (s += 1), why.push('lonely');
        if (T('friendly')) (s += 0.8), why.push('trait:friendly');
        if (npc.age >= 22 && npc.age <= 36) (s += 1.6), why.push('age');
        if (npc.age > 40) s -= 1;
        if (recent('broke_up', 84) || recent('family_died', 168)) s -= 1.5;
      } else {
        const wife = npc.gender === 'f' ? npc : spouse;
        const kids = (npc.kin?.children || []).filter((id) => sim.npcs.byId(id)).length;
        if (wife.age <= 38 && kids < 3) {
          (s += 2.8 - kids * 0.9), why.push('wants_children');
          if (npc.homeId && P.occupants(npc.homeId) < P.capacity(npc.homeId)) (s += 0.4), why.push('room_at_home');
        } else s -= 3;
      }
      add('family', s, why);
      out.family.stage = spouse ? 'children' : 'partner';
    }

    // Moving closer to work.
    const work = this.workplace(npc);
    if (work && npc.homeId && !jobless) {
      const home = sim.world.buildings[npc.homeId];
      const dist = home ? Math.hypot(home.door.tx - work.door.tx, home.door.ty - work.door.ty) : 0;
      if (dist > G.settleDistance) {
        const why = ['long_walk'];
        let s = 1 + (dist - G.settleDistance) / 12;
        if (sim.exploration?.hamletNear?.(work.door.tx, work.door.ty)) (s += 1), why.push('hamlet');
        if (ownsHome) (s -= 1.5), why.push('owns_home_here');
        if (kidsHome && sim.tech?.schoolFor) s -= 0.3;
        add('settle', s, why);
      }
    }

    // Giving up on the valley.
    if (npc.age >= 18 && npc.age <= 62) {
      const why = [];
      let push = 0;
      if (jobless && joblessDays >= 21) (push += 2), why.push('no_prospects');
      if (homeless) (push += 1), why.push('no_home');
      if ((npc.mood ?? 60) < 35) (push += 1.5), why.push('unhappy');
      const enemy = sim.social.worstEnemy(npc);
      if (enemy && (npc.relations[enemy.id]?.c ?? 0) >= 55) (push += 1), why.push('feud');
      if (recent('evicted') || recent('player_fired_unfair') || recent('laid_off', 56)) (push += 1), why.push('treated_badly');
      if ((npc.memories || []).some((m) => m.k === 'family_died' && day - m.d <= 112 && String(m.p?.kin || '').startsWith('spouse')) || (npc.widowOf && !spouse)) (push += 0.8), why.push('grief');
      if (recent('home_burnt', 112)) (push += 1), why.push('lost_home');
      if (ctx.slump) (push += 1), why.push('village_slump');
      if (T('risk_taker')) (push += 0.4), why.push('trait:risk_taker');
      if (push >= G.leaveMinPush && !(npc.stayUntil > day)) {
        let roots = 0;
        const friends = Math.min(3, sim.social.friendCount(npc));
        if (friends) (roots += friends * 0.6), why.push('friends_here');
        const relatives = sim.family.relatives(npc).filter((r) => r !== spouse && !r.leaving).length;
        if (relatives) (roots += 1.2), why.push('family_here');
        if (ownsHome) roots += 2;
        if (npc.owns) roots += 3;
        if (!jobless) roots += 2;
        if (['friend', 'trusted'].includes(sim.social.tier(npc))) (roots += 1), why.push('player_friend');
        if (spouse && spouse.occupation !== 'unemployed' && (spouse.mood ?? 60) >= 50) roots += 1.5;
        add('leave', push * 1.4 - roots, why);
      }
    }
    return out;
  }

  /** Choose (or keep) a goal. Returns npc.goal. */
  reconsider(npc) {
    const c = this.candidates(npc);
    const cur = npc.goal?.type;
    const stick = G.commitment * (npc.traits.includes('careful') || npc.traits.includes('loyal') ? 1.3 : npc.traits.includes('risk_taker') ? 0.7 : 1);
    let best = null;
    for (const [type, v] of Object.entries(c)) {
      const s = v.s + (type === cur ? stick : 0) + rand.float() * 0.3;
      if (!best || s > best.s) best = { type, s };
    }
    if (!best) best = { type: 'steady' };
    const pick = c[best.type] || { why: [] };
    // Stay with the current plan unless the new one is clearly better.
    if (cur && best.type !== cur && c[cur] && c[cur].s + stick + G.switchMargin > c[best.type].s + 0.3) {
      npc.goal.why = c[cur].why;
      if (c[cur].target) npc.goal.target = c[cur].target;
      return npc.goal;
    }
    if (best.type === cur && npc.goal) {
      npc.goal.why = pick.why;
      if (pick.target) npc.goal.target = pick.target;
      if (pick.biz) npc.goal.biz = pick.biz;
      return npc.goal;
    }
    return this.set(npc, best.type, pick);
  }

  set(npc, type, pick = {}) {
    const old = npc.goal;
    // A founder who changes course hands back what you put in.
    if (old?.backer && type !== 'business') this.returnBacking(npc, 'changed_plans');
    npc.goal = { type, since: this.sim.time.day, why: pick.why || [] };
    if (pick.target) npc.goal.target = pick.target;
    if (pick.biz) npc.goal.biz = pick.biz;
    if (pick.stage) npc.goal.stage = pick.stage;
    if (type === 'better_job') npc.goal.from = npc.employer;
    if (type === 'grow_business') npc.goal.base = this.sim.npcs.maxStaff(npc.owns);
    if (type === 'family') npc.goal.kids = (npc.kin?.children || []).length;
    return npc.goal;
  }

  // ------------------------------------------------------------------ progress

  /** Has the goal been reached (→ memory) or given up (→ memory)? Returns true if it ended. */
  checkDone(npc) {
    const g = npc.goal;
    if (!g) return false;
    const sim = this.sim;
    const P = sim.property;
    let done = false;
    switch (g.type) {
      case 'grow':
        done = npc.age >= 16;
        break;
      case 'home':
        done = !!npc.homeId && npc.homeId !== 'hall';
        break;
      case 'job':
        done = npc.occupation !== 'unemployed' && (!!npc.employer || !!npc.owns);
        break;
      case 'save':
        done = npc.money >= (g.target || G.minSaveTarget);
        break;
      case 'buy_house':
        done = !!npc.homeId && P.rec(npc.homeId)?.owner === npc.id;
        break;
      case 'business':
        done = !!npc.owns;
        break;
      case 'master':
        done = sim.npcs.rank(npc) === 'master';
        break;
      case 'better_job':
        done = !!npc.employer && npc.employer !== g.from;
        break;
      case 'grow_business':
        done = !!npc.owns && sim.npcs.maxStaff(npc.owns) > (g.base ?? 99);
        break;
      case 'family':
        done = g.stage === 'partner' ? !!npc.kin?.spouse : (npc.kin?.children || []).length > (g.kids ?? 0);
        break;
      case 'settle': {
        const work = this.workplace(npc);
        const home = npc.homeId && sim.world.buildings[npc.homeId];
        done = !!work && !!home && Math.hypot(home.door.tx - work.door.tx, home.door.ty - work.door.ty) <= G.settleNear;
        break;
      }
    }
    if (done) {
      this.achieved(npc, g);
      return true;
    }
    const limit = G.giveUpDays[g.type];
    const building = g.startedHome && sim.construction.byId(g.startedHome)?.status !== 'done' && !!sim.construction.byId(g.startedHome); // still going up
    if (limit && sim.time.day - g.since > limit && !building) {
      if (g.backer) this.returnBacking(npc, 'gave_up');
      sim.memory.remember(npc, 'goal_given_up', { params: { goal: g.type } });
      this.S.gaveUp++;
      npc.goal = null;
      return true;
    }
    return false;
  }

  achieved(npc, g) {
    const sim = this.sim;
    npc.goalsDone ??= [];
    npc.goalsDone.push({ type: g.type, day: sim.time.day });
    if (npc.goalsDone.length > G.historyKeep) npc.goalsDone.shift();
    // Everyday things (a job found, grown up) are their own memories already.
    if (!['grow', 'job', 'home'].includes(g.type)) {
      sim.memory.remember(npc, 'goal_achieved', { params: { goal: g.type } });
      this.S.achieved++;
    }
    if (g.type === 'settle') {
      this.S.settled++;
      sim.memory.remember(npc, 'moved_near_work', { params: { building: npc.homeId } });
      if (!g.startedHome) sim.chronicle('chronicle.npc_moved_near_work', { npc: npc.id, gender: npc.gender, building: sim.economy.biz(npc.employer || npc.owns)?.building || npc.homeId });
    }
    if (g.backer && g.type !== 'business') this.returnBacking(npc, 'changed_plans');
    npc.goal = null;
  }

  workplace(npc) {
    if (npc.employer === 'player' || (!npc.employer && !npc.owns)) return null;
    return this.sim.npcs.workBuilding(npc);
  }

  // ------------------------------------------------------------------ acting on goals

  /** Settling near a far-off workplace: rent or buy a free home there — or build one. */
  trySettle(npc) {
    const sim = this.sim;
    const P = sim.property;
    const work = this.workplace(npc);
    if (!work || npc.goal.startedHome) return false;
    const fam = [npc, sim.family.spouse(npc), ...sim.family.children(npc).filter((k) => k.homeId === npc.homeId && k.age < 18)].filter(Boolean);
    const budget = P.rentBudget(npc) * (fam.length > 1 ? 1.3 : 1);
    const near = P.options(fam.length, budget, npc.money / HOUSING.buyReserve, npc).filter((o) => {
      const b = sim.world.buildings[o.id];
      return b && Math.hypot(b.door.tx - work.door.tx, b.door.ty - work.door.ty) <= G.settleNear;
    });
    if (near.length) {
      const from = npc.homeId;
      P.settle(fam, near[0], npc, 'moved');
      this.movedNearWork(npc, near[0].id, from);
      return true;
    }
    // Nothing free out there: build a house by the workplace (the lot is found near it).
    const g = sim.growth;
    const cost = g.estimate('small_house');
    const funds = npc.money + (sim.family.spouse(npc)?.money || 0) * 0.5;
    if (funds >= cost * 0.7 && !g.projectOf(npc)) {
      const c = g.start(npc, 'small_house', 'home', work.door);
      if (c) {
        npc.goal.startedHome = c.id;
        return true;
      }
    }
    return false;
  }

  movedNearWork(npc, buildingId, from) {
    const sim = this.sim;
    // (The memory and the news come when the goal is checked off — see achieved().)
    // Owners let the old place (PropertySystem puts empty homes on the market).
    if (from && sim.property.rec(from)?.owner === npc.id) sim.property.rec(from).emptyDays = 22;
  }

  /** One of your workers set on a better job takes a clearly better-paid opening elsewhere. */
  maybePoached(npc) {
    const sim = this.sim;
    const c = sim.workers.contract(npc.id);
    if (!c || npc.traits.includes('loyal') || !rand.chance(0.5)) return false;
    const offer = this.context().vacancies
      .filter(([id]) => sim.economy.biz(id).owner !== 'player' && sim.npcs.wageFor(id, npc) >= c.salary * G.poachWageMult)
      .sort((a, b) => sim.npcs.wageFor(b[0], npc) - sim.npcs.wageFor(a[0], npc))[0];
    if (!offer) return false;
    const [bizId] = offer;
    const wage = sim.npcs.wageFor(bizId, npc);
    delete sim.state.workers[npc.id];
    sim.npcs.clearReservation(npc);
    npc.employer = null;
    npc.occupation = 'unemployed';
    if (!sim.npcs.tryHire(npc, bizId)) {
      // Turned down after all: they come back if you still have room.
      sim.state.workers[npc.id] = c;
      npc.employer = 'player';
      npc.occupation = 'hired_hand';
      return false;
    }
    sim.memory.remember(npc, 'quit_player', { who: 'player', params: { days: c.daysWorked } });
    sim.toast('toast.worker_poached', { npc: npc.id, gender: npc.gender, building: sim.economy.biz(bizId).building, money: wage }, 'danger');
    sim.chronicle('chronicle.worker_poached', { npc: npc.id, gender: npc.gender, building: sim.economy.biz(bizId).building });
    sim.bus.emit('workers:changed');
    return true;
  }

  /** Thinking of leaving → packing → gone (unless something changed their mind). Returns true if they left. */
  advanceLeaving(npc) {
    const sim = this.sim;
    const g = npc.goal;
    const day = sim.time.day;
    if (!g.packDay) {
      if (day - g.since < G.leaveHoldDays) return false;
      // Still set on it? Check the reasons again before packing.
      const c = this.candidates(npc).leave;
      if (!c || c.s < 0) {
        this.reconsider(npc);
        return false;
      }
      g.packDay = day + G.leavePackDays;
      sim.memory.remember(npc, 'decided_to_leave');
      return false;
    }
    if (day < g.packDay) return false;
    // The household goes together — unless a working, contented spouse won't go.
    const spouse = sim.family.spouse(npc);
    if (spouse && spouse.occupation !== 'unemployed' && (spouse.mood ?? 60) >= 50 && !spouse.leaving) {
      npc.stayUntil = day + G.stayKeepDays;
      sim.memory.remember(npc, 'stayed_for_family', { who: spouse.id, params: { npc: spouse.id } });
      this.set(npc, 'job', { why: [] });
      this.reconsider(npc);
      return false;
    }
    const group = [npc, spouse, ...sim.family.children(npc).filter((k) => k.age < 18 && k.homeId === npc.homeId)].filter(Boolean);
    if (g.backer) this.returnBacking(npc, 'left');
    this.S.left += group.length;
    // They go somewhere real: a known town that's doing well (its population grows).
    const dest = sim.settlements?.destinationFor(group);
    const reason = (g.why || []).find((w) => !w.includes(':') && !GOAL_AGAINST.includes(w)) || 'unhappy';
    sim.chronicle(dest ? 'chronicle.npc_left_to' : 'chronicle.npc_left_reason', { npc: npc.id, gender: npc.gender, reason, settlement: dest || undefined });
    sim.growth.leave(group);
    return true;
  }

  // ------------------------------------------------------------------ the player's part

  /** What you could do for this villager's plans (for the dialogue). */
  helpOptions(npc) {
    const sim = this.sim;
    const g = npc.goal;
    const out = [];
    if (!g) return out;
    if (g.type === 'business' && !g.backer && npc.money < (g.target || G.businessTarget)) {
      const amount = Math.max(G.backMin, Math.ceil(((g.target || G.businessTarget) - npc.money) / 10) * 10);
      const share = Math.min(G.backShareMax, Math.round((amount / ((g.target || G.businessTarget) + amount)) * 100 * 0.9) / 100);
      out.push({ kind: 'back', amount, share, ok: sim.state.player.money >= amount });
    }
    if (g.type === 'leave') {
      const asked = npc.stayAskedDay !== undefined && sim.time.day - npc.stayAskedDay < G.stayAskCooldown;
      out.push({ kind: 'stay', ok: !asked });
    }
    return out;
  }

  /** Put money behind a villager's business plans. When it opens, you own a share of it. */
  back(npc) {
    const sim = this.sim;
    const o = this.helpOptions(npc).find((x) => x.kind === 'back');
    if (!o) return { ok: false, reason: 'not_now' };
    if (sim.state.player.money < o.amount) return { ok: false, reason: 'no_money', params: { money: o.amount } };
    const tier = sim.social.tier(npc);
    if (['hostile', 'wary'].includes(tier)) return { ok: false, reason: 'owner_refuses' };
    sim.state.player.money -= o.amount;
    npc.money += o.amount;
    npc.goal.backer = { amount: o.amount, share: o.share, day: sim.time.day };
    this.S.backed++;
    sim.memory.remember(npc, 'player_backed_dream', { who: 'player', params: { money: o.amount } });
    sim.bus.emit('player:changed');
    return { ok: true, amount: o.amount, share: o.share };
  }

  /** The business opened (EnterpriseSystem.open): your backing becomes a stake in it. */
  opened(npc, bizId) {
    const sim = this.sim;
    const bk = npc.goal?.type === 'business' ? npc.goal.backer : null;
    if (!bk) return;
    const b = sim.economy.biz(bizId);
    b.stakes ??= [];
    b.stakes.push({ who: 'player', share: bk.share, paid: 0, since: sim.time.day, amount: bk.amount });
    delete npc.goal.backer;
    sim.toast('toast.backed_business_opened', { npc: npc.id, gender: npc.gender, building: b.building, n: Math.round(bk.share * 100) }, 'good');
    sim.chronicle('chronicle.player_backed_opened', { npc: npc.id, gender: npc.gender, building: b.building });
  }

  /** Plans changed: they pay back what they can of your money. */
  returnBacking(npc, why) {
    const sim = this.sim;
    const bk = npc.goal?.backer;
    if (!bk) return;
    const back = Math.max(0, Math.min(bk.amount, Math.floor(npc.money)));
    npc.money -= back;
    sim.state.player.money += back;
    delete npc.goal.backer;
    sim.toast(back >= bk.amount ? 'toast.backing_returned' : 'toast.backing_part_returned', { npc: npc.id, gender: npc.gender, money: back, why }, back >= bk.amount ? 'info' : 'danger');
    if (back < bk.amount) sim.memory.remember(npc, 'player_let_down_backer', { who: 'player' });
    sim.bus.emit('player:changed');
  }

  /**
   * Ask someone who wants to leave to stay. It works if they trust you and like you —
   * and better if what's driving them away is something you're already fixing.
   */
  askToStay(npc) {
    const sim = this.sim;
    const g = npc.goal;
    if (!g || g.type !== 'leave') return { ok: false };
    npc.stayAskedDay = sim.time.day;
    const pb = sim.social.playerBond(npc);
    let chance = 0.15 + npc.rel / 150 + pb.t / 200 - pb.c / 100;
    if (npc.employer === 'player') chance += 0.2;
    if (!g.packDay) chance += 0.1; // easier before they've started packing
    if ((g.why || []).includes('no_prospects') && npc.occupation === 'unemployed') chance -= 0.15;
    if (!rand.chance(Math.max(0.05, Math.min(0.9, chance)))) {
      sim.social.adjustPlayer(npc, { f: 1 });
      return { ok: true, stays: false };
    }
    npc.stayUntil = sim.time.day + G.stayKeepDays;
    sim.memory.remember(npc, 'player_asked_stay', { who: 'player' });
    npc.goal = null;
    this.reconsider(npc);
    sim.chronicle('chronicle.player_kept_villager', { npc: npc.id, gender: npc.gender });
    return { ok: true, stays: true };
  }

  // ------------------------------------------------------------------ for the debug panel

  summary() {
    const counts = {};
    for (const n of this.sim.state.npcs) {
      const t = n.goal?.type || '—';
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }
}
