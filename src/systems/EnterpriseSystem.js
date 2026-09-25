/**
 * EnterpriseSystem — villagers who run businesses, and villagers who start them.
 *
 * Every day each business closes its books (revenue, expenses, profit) and
 * every week its owner makes decisions, the way a real shopkeeper would:
 *
 *   prices     — undercut a competitor, raise prices when there's no competition
 *                and customers keep coming, cut them when shelves are overflowing
 *   wages      — generous owners pay more; if nobody applies, pay goes up;
 *                when money is tight, it goes down
 *   staff      — a thriving business takes on more people; the best worker in a
 *                bigger business becomes manager
 *   trouble    — owners dip into their savings to keep going; a business that
 *                can't pay its way for too long closes (staff laid off, building empty)
 *
 * And every week, villagers with savings and ambition look for an opportunity —
 * a shortage, high prices, a trade nobody practises — and open their own
 * business: in their own home, or in an empty building they buy or rent.
 * Your workers can leave you to do exactly that.
 *
 * Employees also weigh their jobs against the alternatives (pay, how the place is
 * run, the boss, long hours) and move when something clearly better comes up.
 */
import { BUSINESS_TYPES, ENTERPRISE as EN, EXPERIENCE, BUSINESS_NAME_COUNT } from '../data/businessTypes.js';
import { OCCUPATIONS } from '../data/occupations.js';
import { traitValue } from '../data/traits.js';
import { GOALS } from '../data/goals.js';
import { rand } from '../core/rng.js';
import { FOOD } from './EconomySystem.js';

export class EnterpriseSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  get econ() {
    return this.sim.economy;
  }

  // ------------------------------------------------------------------ daily books

  onDay() {
    const E = this.econ;
    for (const id of E.active()) {
      const b = E.biz(id);
      b.today ??= { rev: 0, exp: 0 };
      b.history ??= [];
      b.history.push({ day: this.sim.time.day - 1, rev: Math.round(b.today.rev), exp: Math.round(b.today.exp), cust: b.customers || 0 });
      if (b.history.length > EN.historyDays) b.history.shift();
      b.today = { rev: 0, exp: 0 };
      b.customers = 0;
      this.health(id);
    }
    if (this.sim.time.weekday === 1) this.weekly();
  }

  /** Revenue and expenses over the last `days` days. */
  books(id, days = 7) {
    const h = (this.econ.biz(id)?.history || []).slice(-days);
    const rev = h.reduce((s, x) => s + x.rev, 0);
    const exp = h.reduce((s, x) => s + x.exp, 0);
    const cust = h.reduce((s, x) => s + (x.cust || 0), 0);
    return { rev, exp, profit: rev - exp, cust, days: h.length };
  }

  /** A business that can't cover its wages: the owner steps in, or it slowly goes under. */
  health(id) {
    const E = this.econ;
    const b = E.biz(id);
    const staff = this.sim.npcs.staffOf(id);
    const payroll = staff.reduce((s, n) => s + this.sim.npcs.wageFor(id, n), 0);
    const owner = E.owner(id);
    if (b.money < Math.max(15, payroll)) {
      // The owner puts their own savings in.
      if (owner && owner.money > 40) {
        const put = Math.round(owner.money * EN.ownerBailout);
        owner.money -= put;
        b.money += put;
        if (!b.bailedOut) this.sim.memory.remember(owner, 'business_struggling', { params: { building: b.building } });
        b.bailedOut = true;
      }
    }
    if (b.money < Math.max(10, payroll * 0.5) && this.books(id, 7).profit <= 0) b.troubleDays = (b.troubleDays || 0) + 1;
    else b.troubleDays = Math.max(0, (b.troubleDays || 0) - 1);
    // The founding producers (farm, lumberyard, quarry) are the village's backbone — they
    // don't vanish; everything else can fail.
    const essential = ['farm', 'lumberyard', 'quarry', 'store'].includes(id);
    if (!essential && b.troubleDays >= EN.troubleDaysToClose) this.close(id, 'failed');
  }

  // ------------------------------------------------------------------ weekly decisions

  /** Farms take on extra hands for the growing and harvest seasons, and let them go for winter. */
  seasonalStaff() {
    const E = this.econ;
    const season = this.sim.time.season;
    for (const id of E.ofType('farm')) {
      const b = E.biz(id);
      const base = E.def(id).maxWorkers || 0;
      if (season === 'summer' || season === 'autumn') b.maxWorkers = Math.max(b.maxWorkers ?? base, base + 2);
      else if (season === 'winter' && (b.maxWorkers ?? base) > base) {
        b.maxWorkers = base;
        const staff = this.sim.npcs.staffOf(id).sort((a, c) => (c.hiredDay || 0) - (a.hiredDay || 0));
        while (staff.length > base) this.layOff(staff.shift(), id, 'laid_off_season');
      }
    }
  }

  weekly() {
    const E = this.econ;
    this.seasonalStaff();
    this.sim.state.exportsWeekLast = this.sim.state.exportsWeek || 0;
    this.sim.state.exportsWeek = 0;
    for (const id of E.active()) {
      const owner = E.owner(id);
      if (!owner) continue;
      this.setPrices(id, owner);
      this.setWages(id, owner);
      this.manageStaff(id, owner);
    }
    this.moraleAndTurnover();
    this.repayLoans();
    this.payPartners();
    this.jobHopping();
    this.startups();
  }

  /** Owners set their prices against the competition. */
  setPrices(id, owner) {
    const E = this.econ;
    const def = E.def(id);
    if (def.kind !== 'shop') return;
    const b = E.biz(id);
    const rivals = E.ofSector(def.sector).filter((x) => x !== id);
    const greedy = owner.traits.includes('greedy');
    const [lo, hi] = EN.markup;
    const books = this.books(id, 7);
    const prevCust = (b.lastWeekCust ?? books.cust) || 1;
    let m = b.markup ?? 1;
    // What customers can bear: when villagers are hard up, prices can't keep rising.
    const adults = this.sim.state.npcs.filter((n) => n.age >= 16);
    const hardUp = adults.filter((n) => n.money < 20).length / Math.max(1, adults.length) > 0.4;
    const ceiling = rivals.length ? hi : greedy ? 1.3 : 1.2;
    if (rivals.length) {
      const cheapest = Math.min(...rivals.map((r) => E.biz(r).markup ?? 1));
      // Losing customers to a cheaper rival: follow them down.
      if (cheapest < m && books.cust < prevCust * 0.9) m -= 0.05;
      else if (cheapest >= m && books.cust >= prevCust && greedy && !hardUp) m += 0.03;
    } else if (books.cust >= prevCust && !hardUp) {
      // No competition and steady trade: prices creep up (more for the greedy).
      m += greedy ? 0.03 : 0.015;
    } else if (hardUp && m > 1) m -= 0.02;
    // Shelves overflowing? Clear stock.
    const sold = def.sells || [];
    const overflow = sold.filter((i) => E.stock(id, i) > E.target(id, i) * 1.6).length > sold.length / 2;
    if (overflow) m -= 0.04;
    if (books.profit < 0 && !overflow) m += 0.02;
    b.markup = Math.round(Math.max(lo, Math.min(ceiling, m)) * 100) / 100;
    b.lastWeekCust = books.cust;
  }

  /** Pay policy: personality, how hard it is to find staff, and what the business can afford. */
  setWages(id, owner) {
    const E = this.econ;
    const b = E.biz(id);
    const def = E.def(id);
    if (!def.workerOccupation) return;
    const [lo, hi] = EN.wageLevel;
    let w = b.wageLevel ?? 1;
    const staff = this.sim.npcs.staffOf(id).length;
    const max = this.sim.npcs.maxStaff(id);
    if (b.firstWageSet === undefined) {
      // A new owner's instincts: generous people pay more, greedy ones less.
      w = traitValue(owner.traits, 'relGain') > 1.1 || owner.traits.includes('generous') ? 1.15 : owner.traits.includes('greedy') ? 0.88 : 1;
      b.firstWageSet = true;
    }
    // Can't find staff while people are looking for work, or they keep leaving? Pay more.
    const seekers = this.sim.state.npcs.some((n) => n.occupation === 'unemployed' && n.age >= 16);
    if (staff < max && b.money > 200 && (seekers || (b.turnover || 0) > 0)) w += 0.05;
    else if (staff >= max && w > 1.05 && (b.turnover || 0) === 0) w -= 0.02;
    // A tight labour market: nobody's looking for work and we're short-handed — outbid the others.
    if (!seekers && staff < max && b.money > 150) w += 0.04;
    // Good years are shared; bad ones are too.
    const profit = this.books(id, 7).profit;
    if (profit > 150 && staff >= max) w += 0.02;
    else if (profit < -60) w -= 0.03;
    b.turnover = 0;
    if (b.money < 80) w -= 0.05;
    b.wageLevel = Math.round(Math.max(lo, Math.min(hi, w)) * 100) / 100;
    // Long hours: driven owners push their people.
    b.longHours = owner.traits.includes('greedy') && owner.traits.includes('hard_worker') ? true : owner.traits.includes('aggressive') && b.money < 150;
  }

  /** Grow the team when business is good; appoint a manager in a bigger business. */
  manageStaff(id, owner) {
    const E = this.econ;
    const b = E.biz(id);
    const def = E.def(id);
    if (!def.workerOccupation) return;
    const base = def.maxWorkers || 0;
    const cur = b.maxWorkers ?? base;
    const books = this.books(id, 7);
    // An owner set on growing (GoalSystem) takes people on sooner, and further.
    const growing = owner.goal?.type === 'grow_business';
    if (b.money > EN.expandAbove * (growing ? GOALS.growBusinessExpand : 1) && books.profit > 0 && cur < base + (growing ? 3 : 2)) {
      b.maxWorkers = cur + 1;
      this.sim.chronicle('chronicle.business_expanding', { building: b.building, npc: owner.id });
    } else if (b.money < 60 && cur > Math.max(1, base - 1) && books.profit < 0) b.maxWorkers = cur - 1;
    const staff = this.sim.npcs.staffOf(id);
    // Too many people for the money coming in: the newest goes.
    if (staff.length > (b.maxWorkers ?? base) && staff.length) {
      const leaver = staff.sort((a, c) => (c.hiredDay || 0) - (a.hiredDay || 0))[0];
      this.layOff(leaver, id, 'laid_off');
    }
    if (staff.length >= EN.managerAtWorkers && !staff.some((n) => n.id === b.manager)) {
      // The one who knows the work best — and how to run things.
      const Ed = this.sim.education;
      const score = (n) => n.level + (Ed ? Ed.competenceFor(n, def.workerOccupation) / 6 + Ed.know(n, 'management') / 8 : 0);
      const best = staff.slice().sort((a, c) => score(c) - score(a))[0];
      b.manager = best.id;
      this.sim.memory.remember(best, 'became_manager', { who: owner.id, params: { building: b.building } });
      this.sim.chronicle('chronicle.npc_manager', { npc: best.id, gender: best.gender, building: b.building });
    } else if (staff.length < EN.managerAtWorkers - 1) b.manager = null;
  }

  layOff(npc, id, why) {
    const b = this.econ.biz(id);
    if (b.manager === npc.id) b.manager = null;
    npc.prevOccupation = npc.occupation;
    npc.employer = null;
    npc.occupation = 'unemployed';
    npc.task = null;
    npc.nextThink = this.sim.time.total;
    this.sim.memory.remember(npc, why, { who: b.owner, params: { building: b.building } });
  }

  /** How staff feel about where they work — and whether they stay. */
  moraleAndTurnover() {
    const E = this.econ;
    for (const id of E.active()) {
      const b = E.biz(id);
      const staff = this.sim.npcs.staffOf(id);
      if (!staff.length) {
        b.staffMorale = 60;
        continue;
      }
      let sum = 0;
      for (const n of staff) sum += this.jobSatisfaction(n);
      b.staffMorale = Math.round(sum / staff.length);
      // A happy workplace earns a name for itself (and so does a bad one).
      b.reputation = Math.round(Math.max(0, Math.min(100, (b.reputation ?? 50) * 0.9 + (b.staffMorale * 0.4 + this.customerScore(id) * 0.6) * 0.1)));
    }
  }

  /** How well a shop serves its customers: stock on the shelves and fair prices. */
  customerScore(id) {
    const E = this.econ;
    const def = E.def(id);
    if (def.kind !== 'shop') return 60;
    const sold = def.sells || [];
    const inStock = sold.filter((i) => E.stock(id, i) > 0).length / Math.max(1, sold.length);
    return Math.max(0, Math.min(100, inStock * 70 + (1.2 - (E.biz(id).markup ?? 1)) * 100));
  }

  /** 0–100: pay vs. what's usual, being paid on time, hours, the boss, friends at work. */
  jobSatisfaction(npc) {
    const E = this.econ;
    const id = npc.employer;
    const b = E.biz(id);
    if (!b) return 50;
    const usual = OCCUPATIONS[npc.occupation]?.wage || 12;
    let s = 55 + (this.sim.npcs.wageFor(id, npc) / usual - 1) * 80;
    s -= npc.unpaidDays * 12;
    if (b.longHours) s -= 10;
    const owner = E.owner(id);
    const bond = owner && this.sim.social.bond(npc, owner);
    if (bond) s += bond.f / 5 - bond.c / 3;
    if (this.sim.npcs.staffOf(id).some((o) => o !== npc && this.sim.social.npcRel(npc, o) >= 40)) s += 6;
    if (b.manager === npc.id) s += 10;
    npc.jobSat = Math.round(Math.max(0, Math.min(100, s)));
    return npc.jobSat;
  }

  /** Employees move to clearly better jobs (loyal people less readily). */
  jobHopping() {
    const npcs = this.sim.npcs;
    const vacancies = npcs.vacancies();
    if (!vacancies.length) return;
    for (const n of this.sim.state.npcs.slice()) {
      if (!n.employer || n.employer === 'player' || n.owns || n.age < 16) continue;
      if (this.sim.time.day - (n.hiredDay || 0) < 14) continue;
      const owner = this.econ.owner(n.employer);
      if (owner && n.family.includes(owner.id)) continue; // family business
      const here = npcs.jobAppeal(n, n.employer) + (n.jobSat ?? 50) / 20;
      const factor = EN.switchJobFactor * (n.traits.includes('loyal') ? 1.4 : 1) * (n.traits.includes('ambitious') ? 0.85 : 1) * (n.goal?.type === 'better_job' ? 0.8 : 1);
      let best = null;
      let bestScore = here * factor;
      for (const [id] of vacancies) {
        if (id === n.employer) continue;
        const s = npcs.jobAppeal(n, id);
        if (s > bestScore) {
          bestScore = s;
          best = id;
        }
      }
      if (!best || !rand.chance(0.5)) continue;
      const oldId = n.employer;
      const oldBuilding = this.econ.biz(oldId).building;
      this.layOff(n, oldId, 'changed_jobs');
      if (npcs.tryHire(n, best)) {
        const ob = this.econ.biz(oldId);
        ob.turnover = (ob.turnover || 0) + 1;
        if (owner) this.sim.memory.remember(owner, 'employee_left', { who: n.id, params: { npc: n.id } });
        this.sim.chronicle('chronicle.npc_changed_jobs', { npc: n.id, gender: n.gender, building: oldBuilding, building2: this.econ.biz(best).building });
        return; // one move a week keeps things readable
      }
    }
  }

  // ------------------------------------------------------------------ new businesses

  /** Is there room in the village for another business of this kind? Higher = more demand. */
  opportunity(type) {
    const E = this.econ;
    const pop = this.sim.state.npcs.length + 1;
    const same = E.ofType(type).length + (type === 'carpentry' ? this.sim.businesses.list().length : 0);
    const T = BUSINESS_TYPES[type];
    const priceSignal = (items) => {
      const shops = items.flatMap((i) => E.sellersOf(i).map((s) => E.priceFactor(s, i) * (E.biz(s).markup ?? 1)));
      return shops.length ? shops.reduce((a, c) => a + c, 0) / shops.length : 1.6;
    };
    let score = 0;
    switch (type) {
      case 'bakery':
        score = (priceSignal(['bread']) - 1) * 2 + pop / 20 - same * 1.2;
        break;
      case 'general_store':
        score = (priceSignal(FOOD) - 1) * 1.5 + pop / 16 - same * 1.1;
        break;
      case 'tavern':
        score = pop / 22 - same * 1.1 + (priceSignal(['stew']) - 1);
        break;
      case 'carpentry': {
        const furniture = ['stool', 'chair', 'table'];
        score = (priceSignal(furniture) - 1) * 1.5 + pop / 22 - same * 1.3 + 0.4;
        break;
      }
      case 'smithy':
        score = pop / 26 - same * 1.2 + (priceSignal(['axe', 'pickaxe', 'hoe']) - 1);
        break;
      case 'warehouse': {
        // Producers dumping surplus on passing traders: a merchant could do better.
        const exported = this.sim.state.exportsWeekLast || 0;
        score = exported / 60 - same * 2 + pop / 50;
        break;
      }
      case 'carters': {
        const trips = (this.sim.state.logistics?.log || []).slice(-7).reduce((s, d) => s + d.trips, 0) / 7;
        score = trips / 6 - same * 2 + pop / 60;
        break;
      }
      case 'builders': {
        // Houses waiting for hands: somebody should go into the building trade.
        const waiting = this.sim.growth ? this.sim.growth.projects().length : 0;
        score = waiting * 0.9 - same * 1.5 + pop / 40;
        break;
      }
      case 'mill': {
        // Once the village knows how: bakeries grinding wheat by hand and a farm with grain to spare.
        const bakers = E.ofType('bakery').length + E.ofType('general_store').length;
        const wheat = E.ofType('farm').reduce((s, id) => s + E.stock(id, 'wheat'), 0);
        score = bakers * 0.5 + wheat / 60 - same * 2.5 + pop / 60;
        break;
      }
      case 'fishery': {
        // Only worth it while there are fish to catch.
        const f = this.sim.state.nature?.fish;
        const share = f ? (f.river.pop + f.lake.pop) / (f.river.cap + f.lake.cap) : 0.5;
        score = (share - 0.45) * 3 + pop / 28 - same * 1.3 + (priceSignal(['fish']) - 1) + 0.3;
        break;
      }
      default:
        score = -1;
    }
    if (T.needsTech && !this.sim.tech?.has(T.needsTech)) return -9;
    // Can trained hands be found here? (A skilled workforce draws trades; its lack holds them back.)
    score += ((this.sim.eduworld?.laborFactor(type) ?? 1) - 1) * 3;
    return T.openable ? score : -9;
  }

  /** Starting from your own home is cheaper (no premises to fit out). */
  startCost(type, homeBased) {
    return Math.round(BUSINESS_TYPES[type].startCost * (homeBased ? 0.6 : 1));
  }

  /** Could this villager start a business now? */
  candidate(n) {
    if (n.owns || n.age < EN.minAge || n.age > EN.maxAge || n.occupation === 'child' || n.occupation === 'elder') return false;
    const t = n.traits;
    // Temperament — or a settled plan to open a business (GoalSystem), which counts for as much.
    const drive = (t.includes('entrepreneur') ? 2 : 0) + (t.includes('ambitious') ? 1 : 0) + (t.includes('risk_taker') ? 0.7 : 0) + (t.includes('careful') ? -0.5 : 0) + (n.goal?.type === 'business' ? 1.5 : 0);
    // Once bitten: a business that went under recently makes people wary — unless they've
    // thought it over and set their heart on trying again.
    const day = this.sim.time.day;
    const burnt = (n.memories || []).some((m) => m.k === 'business_failed' && day - m.d < EN.retryAfterFailDays);
    if (burnt && n.goal?.type !== 'business') return false;
    return drive >= 1 && (!n.lastStartupTry || day - n.lastStartupTry >= 21);
  }

  startups() {
    const E = this.econ;
    const types = Object.keys(BUSINESS_TYPES).filter((t) => BUSINESS_TYPES[t].openable);
    for (const n of this.sim.state.npcs.slice()) {
      if (!this.candidate(n)) continue;
      // Family pools their savings for a family business…
      const spouse = this.sim.family.spouse(n);
      let funds = n.money + (spouse ? spouse.money * 0.5 : 0);
      // …and a well-off relative or friend who believes in them may back them.
      const backer = this.findBacker(n);
      if (backer) funds += backer.offer;
      // No one to back them? The village bank may lend (CivicSystem).
      const bank = backer ? 0 : this.sim.civic?.bankOffer(n) || 0;
      funds += bank;
      let best = null;
      let bestScore = EN.startupScoreNeeded;
      const homeBased = n.homeId && this.findPremises(n, 'bakery')?.how === 'home';
      for (const type of types) {
        const T = BUSINESS_TYPES[type];
        if (funds < this.startCost(type, homeBased)) continue;
        let exp = EXPERIENCE[type]?.includes(n.occupation) || EXPERIENCE[type]?.includes(n.prevOccupation) ? 1.2 : 0;
        // Knowing the trade (from school, a master, or years at it) — and wanting to do it.
        if (this.sim.education) exp = Math.max(exp, this.sim.education.founderFit(n, T.ownerOccupation)) + this.sim.education.interestFit(n, T.ownerOccupation);
        const planned = n.goal?.type === 'business' && n.goal.biz === type ? 0.5 : 0; // the trade they've been planning for
        const s = this.opportunity(type) + exp + planned + rand.float() * 0.5;
        if (s > bestScore) {
          bestScore = s;
          best = type;
        }
      }
      n.lastStartupTry = this.sim.time.day;
      if (!best) continue;
      const premises = this.findPremises(n, best);
      if (!premises) {
        // Nowhere to open? Put up premises of your own (the business opens when they're finished).
        const g = this.sim.growth;
        const kind = BUSINESS_TYPES[best].premises === 'warehouse' ? 'warehouse' : 'shopfront';
        const need = BUSINESS_TYPES[best].startCost * 0.6 + g.estimate(kind) * 0.5;
        if (g && n.money < need && backer && n.money + backer.offer >= need) {
          // A backer puts up the money for the building too.
          const amount = Math.ceil(need - n.money);
          backer.npc.money -= amount;
          n.money += amount;
          this.sim.memory.remember(backer.npc, 'backed_business', { who: n.id, params: { npc: n.id, money: amount } });
          this.sim.memory.remember(n, 'got_backing', { who: backer.npc.id, params: { npc: backer.npc.id, money: amount } });
          if (backer.kind === 'partner') n.pendingPartner = backer.npc.id;
          else n.pendingLoan = { lender: backer.npc.id, amount, left: amount };
        }
        if (g && n.money >= need) g.buildPremises(n, best, kind);
        continue;
      }
      // Borrow what's missing.
      const need = this.startCost(best, premises.how === 'home') + (premises.how === 'buy' ? premises.price : 0) - (n.money + (spouse ? spouse.money * 0.5 : 0));
      let loan = null;
      let partner = null;
      if (need > 0 && backer) {
        const amount = Math.ceil(Math.min(need, backer.offer));
        backer.npc.money -= amount;
        n.money += amount;
        if (backer.kind === 'loan') loan = { lender: backer.npc.id, amount, left: amount };
        else partner = backer.npc;
        this.sim.memory.remember(backer.npc, 'backed_business', { who: n.id, params: { npc: n.id, money: amount } });
        this.sim.memory.remember(n, 'got_backing', { who: backer.npc.id, params: { npc: backer.npc.id, money: amount } });
      } else if (need > 0 && bank) loan = this.sim.civic.bankLend(n, Math.ceil(need));
      const id = this.open(n, best, premises, spouse);
      // Backing arranged earlier, when the premises were being built.
      if (!loan && n.pendingLoan) loan = n.pendingLoan;
      if (!partner && n.pendingPartner) partner = this.sim.npcs.byId(n.pendingPartner);
      delete n.pendingLoan;
      delete n.pendingPartner;
      if (loan) this.econ.biz(id).loan = loan;
      if (partner) {
        this.econ.biz(id).partner = partner.id;
        n.partners = [...new Set([...(n.partners || []), partner.id])];
        partner.partners = [...new Set([...(partner.partners || []), n.id])];
        this.sim.chronicle('chronicle.business_partners', { npc: n.id, npc2: partner.id, biz_type: best });
      }
      return; // one new business a week at most — the village notices each one
    }
  }

  /**
   * Someone to put up the money: a relative or close friend lends it; a well-off
   * villager who knows them may become a business partner instead (a share of the profits).
   */
  findBacker(n) {
    let best = null;
    for (const o of this.sim.state.npcs) {
      if (o === n || o.age < 25 || o.money < 350) continue;
      const fam = n.family.includes(o.id);
      const view = this.sim.social.bond(o, n);
      if (view && (view.c >= 25 || view.f < -10)) continue;
      const close = fam || (view && view.f >= 40 && view.t >= 20);
      const willing = fam || o.traits.includes('generous') || o.traits.includes('entrepreneur') || (view && view.t >= 40);
      if (close && willing && !(o.traits.includes('careful') && !fam && o.money < 800)) {
        const offer = Math.floor((o.money - 200) * (fam ? 0.6 : 0.4));
        if (offer > 0 && (!best || offer > best.offer)) best = { npc: o, offer, kind: 'loan' };
        continue;
      }
      // An investor: wealthy, knows them at least a little, and sees a hard worker or someone who knows the trade.
      const wealthy = o.money >= (o.traits.includes('careful') ? 1000 : 600);
      const knows = view || o.employer === n.employer || this.econ.ownerId(n.employer) === o.id;
      const promising = n.traits.includes('hard_worker') || n.traits.includes('entrepreneur') || n.level >= 5;
      if (wealthy && knows && promising) {
        const offer = Math.floor((o.money - 400) * 0.5);
        if (offer > 0 && (!best || (best.kind !== 'loan' && offer > best.offer))) best = { npc: o, offer, kind: 'partner' };
      }
    }
    return best;
  }

  /** Partners take a share of each week's profit. */
  payPartners() {
    const E = this.econ;
    for (const id of E.active()) {
      const b = E.biz(id);
      if (!b.partner) continue;
      const partner = this.sim.npcs.byId(b.partner);
      if (!partner) {
        b.partner = null;
        continue;
      }
      const profit = this.books(id, 7).profit;
      const share = Math.min(Math.floor(b.money - 60), Math.round(profit * 0.25));
      if (share > 0) {
        b.money -= share;
        partner.money += share;
        E.ledger(id, 'exp', share);
      }
    }
  }

  /** Loans are paid back from profits, a little each week. */
  repayLoans() {
    const E = this.econ;
    for (const id of E.active()) {
      const b = E.biz(id);
      if (!b.loan || b.loan.left <= 0) continue;
      const lender = this.sim.npcs.byId(b.loan.lender);
      const pay = Math.min(b.loan.left, Math.max(5, Math.round(b.loan.amount * 0.08)), Math.max(0, Math.floor(b.money - 60)));
      if (pay <= 0) continue;
      b.money -= pay;
      b.loan.left -= pay;
      E.ledger(id, 'exp', pay);
      if (lender) lender.money += pay;
      else if (b.loan.lender === 'bank' && this.sim.civic) this.sim.civic.V.vault = (this.sim.civic.V.vault || 0) + pay; // back to the bank's vault
      else if (b.loan.lender === 'player') {
        this.sim.state.player.money += pay;
        this.sim.toast('toast.loan_repaid', { money: pay, building: b.building }, 'gain');
      }
      if (b.loan.left <= 0) {
        const owner = E.owner(id);
        if (owner && lender) this.sim.social.adjust(lender, owner, { t: 12, r: 8 });
        delete b.loan;
      }
    }
  }

  /**
   * Where to open: their own home (a front-room shop or a workshop in the yard),
   * or an empty building they can buy or rent.
   */
  findPremises(n, type) {
    const P = this.sim.property;
    const E = this.econ;
    // Premises they already own (a shopfront they built, an old shop they bought).
    for (const [id, r] of Object.entries(P.all)) {
      if (r.owner !== n.id || id === n.homeId || E.businessAtBuilding(id) || r.ruined) continue;
      if (P.type(id) === 'shopfront' || P.type(id) === 'workshop' || r.formerBusiness) return { building: id, how: 'own' };
    }
    const needs = BUSINESS_TYPES[type].premises;
    if (needs) {
      // Proper premises only: a warehouse, or a vacant former shop.
      for (const [id, r] of Object.entries(P.all)) {
        if (E.businessAtBuilding(id) || this.sim.businesses.atBuilding(id) || P.occupants(id) > 0 || r.ruined || r.owner === 'player') continue;
        const t = P.type(id);
        const fits = needs === 'warehouse' ? t === 'warehouse_bld' : !P.isHome(id) && (t === 'shopfront' || t === 'workshop' || r.formerBusiness);
        if (!fits) continue;
        const price = P.value(id);
        if ((r.forSale || r.abandoned || r.owner === 'village' || r.owner === n.id) && n.money >= price * (r.owner === n.id ? 0 : 1)) return { building: id, how: r.owner === n.id ? 'own' : 'buy', price };
      }
      return null;
    }
    const home = n.homeId;
    const homeRec = home && P.rec(home);
    if (home && !E.businessAtBuilding(home) && homeRec && (homeRec.owner === n.id || n.family.includes(homeRec.owner) || homeRec.owner === 'village') && P.isHome(home) && home !== 'hall') {
      return { building: home, how: 'home' };
    }
    // An empty building: a vacant house, or old business premises.
    const cost = BUSINESS_TYPES[type].startCost;
    let best = null;
    for (const [id, r] of Object.entries(P.all)) {
      if (E.businessAtBuilding(id) || this.sim.businesses.atBuilding(id) || id === 'hall' || id === this.sim.state.player.homeId) continue;
      if (P.occupants(id) > 0 || r.ruined || r.owner === 'player') continue;
      if (!P.isHome(id) && !r.formerBusiness) continue;
      const price = P.value(id);
      const buyable = (r.forSale || r.abandoned || r.owner === 'village' || !r.owner) && n.money >= cost * 0.6 + price;
      const s = (buyable ? 2 : 0) - price / 300 + r.condition / 50;
      if (!best || s > best.s) best = { building: id, how: buyable ? 'buy' : 'rent', price, s };
    }
    return best;
  }

  open(n, type, premises, spouse) {
    const sim = this.sim;
    const E = this.econ;
    const T = BUSINESS_TYPES[type];
    const cost = this.startCost(type, premises.how === 'home');
    // Buying premises.
    if (premises.how === 'buy') {
      const r = sim.property.rec(premises.building);
      n.money -= premises.price;
      sim.property.payTo(r.owner, premises.price);
      sim.property.transfer(premises.building, n.id, 'bought', premises.price);
    }
    // Savings (and the spouse's help) pay for tools, fittings and first stock —
    // money that goes to the local carpenters, smiths and shops.
    const fromSpouse = spouse ? Math.min(spouse.money * 0.5, Math.max(0, cost - n.money)) : 0;
    if (spouse) spouse.money -= fromSpouse;
    const own = Math.min(n.money, cost - fromSpouse);
    n.money -= own;
    const capital = own + fromSpouse;
    const fitOut = Math.round(capital * EN.premisesDeposit);
    const yard = E.biz('lumberyard');
    const smith = E.biz('smithy');
    if (yard && !yard.closed) yard.money += Math.round(fitOut * 0.6);
    if (smith && !smith.closed) smith.money += fitOut - Math.round(fitOut * 0.6);
    // Leave the old job.
    const oldEmployer = n.employer;
    if (oldEmployer === 'player') {
      sim.workers.fireQuietly?.(n.id);
      delete sim.state.workers[n.id];
      sim.memory.remember(n, 'left_player_for_business', { who: 'player', params: { biz_type: type } });
      sim.toast('toast.worker_left_business', { npc: n.id, gender: n.gender, biz_type: type }, 'info');
      sim.bus.emit('workers:changed');
    } else if (oldEmployer) {
      const boss = E.owner(oldEmployer);
      if (boss) sim.memory.remember(boss, 'employee_left', { who: n.id, params: { npc: n.id } });
    }
    const id = `b${sim.state.settlement.nextBizId++}`;
    const used = new Set(E.ofType(type).map((x) => E.biz(x).nameIdx));
    let nameIdx = rand.int(0, BUSINESS_NAME_COUNT - 1);
    for (let i = 0; i < BUSINESS_NAME_COUNT && used.has(nameIdx); i++) nameIdx = (nameIdx + 1) % BUSINESS_NAME_COUNT;
    sim.state.businesses[id] = {
      id, type, building: premises.building, owner: n.id, money: capital - fitOut,
      stock: {}, daysUnpaid: 0, markup: 0.95, wageLevel: 1, reputation: 45, maxWorkers: T.maxWorkers ? 1 : 0,
      history: [], today: { rev: 0, exp: 0 }, opened: sim.time.day, nameIdx, founder: n.id,
    };
    const pr = sim.property.rec(premises.building);
    if (pr) {
      pr.formerBusiness = type;
      pr.abandoned = false;
      pr.emptyDays = 0;
    }
    n.owns = id;
    n.employer = null;
    n.occupation = T.ownerOccupation;
    n.task = null;
    n.nextThink = sim.time.total;
    E.invalidate();
    sim.memory.remember(n, 'opened_business', { params: { building: premises.building, biz_type: type } });
    if (spouse) sim.memory.remember(spouse, 'family_business', { who: n.id, params: { npc: n.id, building: premises.building } });
    sim.chronicle('chronicle.business_opened_npc', { npc: n.id, gender: n.gender, biz_type: type, building: premises.building });
    sim.goals?.opened(n, id); // if you backed them, you now own a share
    sim.bus.emit('business:opened', id);
    sim.bus.emit('building:changed', premises.building);
    sim.habits.derive(n);
    return id;
  }

  /** The village built a mill: someone with the know-how (or the savings) rents it and runs it. */
  villageMill(building) {
    const cands = this.sim.state.npcs.filter((n) => !n.owns && n.age >= 21 && n.age <= 58 && n.occupation !== 'child');
    const exp = EXPERIENCE.mill;
    const score = (n) => (exp.includes(n.occupation) ? 5 : 0) + n.level + n.money / 100 + (n.traits.includes('entrepreneur') ? 3 : 0) + (this.sim.education?.competenceFor(n, 'miller') || 0) / 12;
    const miller = cands.sort((a, b) => score(b) - score(a))[0];
    const r = this.sim.property.rec(building);
    if (r) r.formerBusiness = 'mill';
    if (!miller) return null;
    miller.money += BUSINESS_TYPES.mill.startCost; // the village fits it out; the miller pays rent
    return this.open(miller, 'mill', { building, how: 'rent' }, null);
  }

  /** A business shuts: staff laid off, the building empties (and may be taken over later). */
  close(id, why) {
    const sim = this.sim;
    const E = this.econ;
    const b = E.biz(id);
    if (!b || b.closed) return;
    const owner = E.owner(id);
    for (const n of this.sim.npcs.staffOf(id)) this.layOff(n, id, 'laid_off');
    if (owner) {
      owner.owns = null;
      owner.prevOccupation = owner.occupation;
      owner.occupation = 'unemployed';
      owner.task = null;
      owner.money += Math.max(0, Math.floor(b.money)); // whatever is left
      sim.memory.remember(owner, 'business_failed', { params: { building: b.building } });
    }
    // Your own business: whatever's left in the till comes back to you.
    if (b.owner === 'player') {
      sim.state.player.money += Math.max(0, Math.floor(b.money));
      sim.toast('toast.your_business_closed', { building: b.building }, 'danger');
    }
    b.money = 0;
    b.closed = true;
    b.closedDay = sim.time.day;
    b.closeReason = why;
    const r = sim.property.rec(b.building);
    if (r) r.formerBusiness = b.type;
    E.invalidate();
    const years = Math.max(0, Math.floor((sim.time.day - (b.opened || 0)) / 56));
    sim.chronicle('chronicle.business_failed', { building: b.building, npc: owner?.id, n: years });
    sim.bus.emit('business:closed', id);
    sim.bus.emit('building:changed', b.building);
  }

  /** The owner died with nobody to take over (called by FamilySystem). */
  ownerLost(id, npc) {
    const E = this.econ;
    const staff = this.sim.npcs.staffOf(id).sort((a, b) => b.level - a.level);
    // A worker with savings (or long service) takes it over; otherwise it closes.
    const successor = staff.find((n) => n.money >= 40 || n.level >= 8) || staff[0];
    if (successor) return this.sim.family.handOverBusiness(npc, successor, 'worker');
    npc.owns = null;
    E.biz(id).owner = null;
    this.close(id, 'no_heir');
  }
}
