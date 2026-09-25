/**
 * ContractPlanner — the thinking side of ContractSystem (mixed into it: one system, sim.contracts).
 *
 *   What villagers need   needs(npc): every job they could use outside help with right now, from
 *                         their real situation — ripe fields, dry fields, a worn house, a stalled
 *                         site, a yard short of its own timber, goods their shop is out of — and,
 *                         for clients who know your work, bigger things: improving their building,
 *                         a new barn or shop (proposals). Each is weighed: urgency (how pressing),
 *                         importance (how much it matters) → priority. They ask for the most
 *                         pressing first.
 *   What a job is         category, size (small · medium · large · major), requirements (a skilled
 *                         hand, materials), who brings the materials (the client, you with their
 *                         money, or you on your own account).
 *   What it'll cost you   estimate(): hours, days with so many hands, wages, materials → expected
 *                         profit; and what it really cost, as it happens (c.costs).
 *   Asking for more       negotiate(): more money or more time — they may agree, refuse, or go
 *                         elsewhere, depending on their purse, urgency, your name, how they like
 *                         you, who else could do it, and who they are.
 *   How it went           judge(): speed against the estimate, the skill of the hands that did it,
 *                         the deadline, the job itself (a house left sound, every plant in) → a
 *                         grade that moves the pay, your experience and your name.
 *   Your name             reputation (0–100) from what you actually did; each client remembers you
 *                         (trust); a history of every job; standing (odd jobs → master contractor)
 *                         needs both jobs done and a good name.
 *   Your firm             found a contracting company: a name, a base, its books.
 */
import { ITEMS } from '../data/items.js';
import { STANDARD } from '../data/quality.js';
import { JOBS } from '../data/jobs.js';
import { rand } from '../core/rng.js';
import { JOB_CATEGORIES, JOB_TYPE_CATEGORY, PRIORITY as PR, PROPOSALS as PP, RATES, NEGOTIATION as NG, QUALITY as QY, REPUTATION as RP, STANDINGS, COMPANY as CO } from '../data/contracting.js';
import { VILLAGE_BUILDINGS } from '../data/villageBuildings.js';
import { BALANCE } from '../config/balance.js';
import { GATHERABLE } from './ContractSystem.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const ContractPlanner = {
  // ================================================================== standing & name

  /** Your name as a contractor, 0–100. */
  rep() {
    return this.S.rep ?? RP.start;
  },
  addRep(d) {
    this.S.rep = Math.max(0, Math.min(100, Math.round((this.rep() + d) * 10) / 10));
  },
  /** Your standing: jobs seen through AND a name to match. */
  rank() {
    let r = STANDINGS[0];
    for (const x of STANDINGS) if (this.S.done >= x.done && this.rep() >= x.rep) r = x;
    return r;
  },
  nextRank() {
    return STANDINGS[STANDINGS.indexOf(this.rank()) + 1] || null;
  },
  maxActive() {
    return this.rank().maxActive + (this.S.company ? CO.maxActiveBonus : 0);
  },

  /** What a client remembers of working with you. */
  client(id) {
    this.S.clients ??= {};
    return (this.S.clients[id] ??= { done: 0, late: 0, failed: 0, cancelled: 0, q: 0, n: 0, pay: 0 });
  },
  /** How much they trust you: jobs done well for them (a late one counts half; a failure costs two). */
  trust(id) {
    if (!id || id === 'village') return 0;
    const k = this.S.clients?.[id];
    let t = k ? k.done - k.late * 0.5 - k.failed * 2 - k.cancelled * 1.5 + (k.n ? (k.q / k.n - 60) / 40 : 0) : 0;
    // A firm with a name is trusted by businesses a little more.
    if (this.S.company && this.sim.npcs.byId(id)?.owns) t += CO.businessTrust;
    return Math.round(t * 10) / 10;
  },

  /** Where you are: working for yourself → with hands of your own → a contractor → a company. */
  stage() {
    if (this.S.company) return 'company';
    if (STANDINGS.indexOf(this.rank()) >= 2) return 'contractor';
    if (this.sim.workers.list().length || this.S.done > 0) return 'freelancer';
    return 'individual';
  },

  // ================================================================== what a job is

  category(c) {
    if (c.kind === 'job') return JOB_TYPE_CATEGORY[c.type] || 'transport';
    if (c.kind === 'supply' && c.gather) return 'resources';
    return JOB_CATEGORIES[c.kind] || 'business';
  },

  /** Small (one pair of hands) · medium (2–4) · large (5+) · major (a new building, a big extension). */
  sizeOf(c) {
    if (c.proposal) return c.proposal.what === 'new' ? 'major' : this.recommended(c) >= 3 ? 'large' : 'medium';
    const n = this.recommended(c);
    return n >= 5 ? 'large' : n >= 2 ? 'medium' : 'small';
  },

  /**
   * What a job asks of you: a hand skilled enough (required for big building work; recommended
   * for the rest), and — if you're bringing them — the materials.
   */
  requirements(c) {
    const field = this.fieldOf(c);
    const req = { field, level: 0, required: false, materials: null };
    if (c.kind === 'build') {
      req.level = c.proposal?.what === 'new' ? 3 : 2;
      req.required = !!c.proposal;
    } else if (c.kind === 'repair') req.level = 2;
    else if (c.kind === 'harvest' || c.kind === 'water') req.level = 1;
    else if (c.kind === 'craft') req.level = 0;
    if (c.materialsMode && c.materialsMode !== 'client') req.materials = this.materialsNeeded(c);
    return req;
  },
  /** A skill level 0–10 from a competence 0–100. */
  level(comp) {
    return Math.floor((comp || 0) / 10);
  },
  /** Your own level at the work (your skills: construction, farming, trading…). */
  playerLevel(field) {
    const P = { building: 'construction', farming: 'farming', trade: 'trading', forestry: 'woodcutting', mining: 'mining', carpentry: 'crafting' }[field];
    return P ? this.sim.state.player.skills[P]?.level || 0 : 0;
  },
  workerLevel(npcId, field) {
    const n = this.sim.npcs.byId(npcId);
    return n && field ? this.level(this.sim.education?.competence(n, field)) : 0;
  },
  /** Is there someone good enough for it — you, or one of the workers on it (or any of yours, before you've chosen)? */
  meets(c, pool = null) {
    const req = this.requirements(c);
    if (!req.level) return true;
    if (this.playerLevel(req.field) >= req.level) return true;
    const ids = pool || (c.workers?.length ? c.workers : this.sim.workers.list().map((w) => w.npcId));
    return ids.some((id) => this.workerLevel(id, req.field) >= req.level);
  },

  // ================================================================== urgency, importance, priority

  /** Weigh a job: how pressing, how much it matters — and so how soon it's wanted. */
  assess(o) {
    if (o.priority !== undefined) return o;
    const sim = this.sim;
    let u = 0.4;
    let i = 0.4;
    switch (o.kind) {
      case 'harvest': {
        const all = this.fieldsOf(o.bizId).length || 1;
        const ripe = this.ripe(o.bizId).length;
        const left = Math.max(0, (BALANCE.time?.daysPerSeason || 14) - (sim.time.dayOfSeason || 0));
        u = clamp01(ripe / all + (left <= 3 ? 0.4 : 0));
        i = clamp01(0.4 + ripe / all);
        break;
      }
      case 'water':
        u = sim.weather.type === 'sunny' || sim.weather.type === 'clear' ? 0.7 : 0.45;
        i = 0.35;
        break;
      case 'repair': {
        const cond = sim.property.rec(o.building)?.condition ?? 60;
        u = clamp01((60 - cond) / 60 + 0.3);
        i = clamp01(0.3 + (sim.property.value?.(o.building) || 300) / 1500);
        break;
      }
      case 'build': {
        if (o.proposal) {
          u = 0.2;
          i = 0.7;
        } else {
          const s = sim.construction.byId(o.siteId);
          const stalled = s ? sim.time.day - (s.lastProgressDay ?? s.createdDay ?? sim.time.day) : 0;
          u = clamp01(0.3 + stalled * 0.12);
          i = clamp01(0.4 + (s ? s.laborNeeded / 3000 : 0));
        }
        break;
      }
      case 'supply':
      case 'haul': {
        const E = sim.economy;
        const t = o.bizId ? E.target(o.bizId, o.item) : 0;
        const st = o.bizId ? E.stock(o.bizId, o.item) : 0;
        u = t > 0 ? clamp01(1 - st / t) : 0.5;
        i = clamp01(0.3 + (o.pay || 0) / 200);
        break;
      }
      case 'craft':
        u = 0.25;
        i = 0.35;
        break;
      case 'order':
        u = 0.45;
        i = 0.5;
        break;
      case 'job':
        u = 0.6;
        i = 0.3;
        break;
    }
    o.urgency = Math.round(u * 100) / 100;
    o.importance = Math.round(i * 100) / 100;
    o.priority = Math.round((u * PR.urgencyWeight + i * PR.importanceWeight) * 100) / 100;
    o.category = this.category(o);
    o.size = this.sizeOf(o);
    // What's pressing is wanted sooner; what isn't, can wait.
    if (o.days && !o.shaped && o.kind !== 'job') o.days = Math.max(1, Math.round(o.days * (1 + PR.deadlineStretch * (0.5 - u))));
    o.shaped = true;
    return o;
  },
  isUrgent(c) {
    return (c.urgency || 0) >= PR.urgentFrom;
  },

  /**
   * Everything this villager could use a hand with right now — the most pressing first. A poor
   * name as a contractor: only the urgent come to you. A good name, and a client who knows your
   * work: bigger jobs.
   */
  needs(npc) {
    if (!npc || npc.age < 18) return [];
    const list = [this.make_harvest(npc), this.make_water(npc), this.make_repair(npc), this.make_build(npc), this.make_gather(npc), this.make_haul(npc), this.make_proposal(npc)].filter(Boolean).map((o) => this.assess(o));
    const low = this.rep() < RP.lowOffers;
    return list.filter((o) => !low || this.isUrgent(o)).sort((a, b) => b.priority - a.priority);
  },

  /** For the board: the most pressing needs across the valley (business owners, farmers, owners of worn houses, builders). */
  boardNeeds(max = 3) {
    const owners = this.sim.state.npcs.filter((n) => n.age >= 18 && (n.owns || Object.values(this.sim.property.all).some((r) => r.owner === n.id)));
    const out = [];
    for (const n of owners) {
      if (this.S.active.some((c) => c.issuer === n.id)) continue;
      const top = this.needs(n)[0];
      if (top && !this.duplicate(top)) out.push(top);
    }
    return out.sort((a, b) => b.priority - a.priority).slice(0, max);
  },

  // ================================================================== more kinds of work

  /** The farmer's growing wheat, dry in the sun: water it. */
  make_water(who = null) {
    const sim = this.sim;
    const E = sim.economy;
    if (sim.time.season === 'winter' || sim.weather.type === 'rain' || sim.weather.type === 'storm') return null;
    const day = sim.time.day;
    for (const bizId of E.ofType('farm')) {
      if (!E.biz(bizId) || E.biz(bizId).closed || !E.ownerId(bizId) || (who && E.ownerId(bizId) !== who.id)) continue;
      const growing = this.fieldsOf(bizId).map((id) => sim.state.objects[id]).filter((o) => o && o.stage < 3);
      const dry = growing.filter((o) => o.wateredDay !== day);
      if (dry.length < PR.waterMin || dry.length / Math.max(1, growing.length) < PR.waterBelow) continue;
      const qty = Math.min(dry.length, Math.round(20 * this.rank().size));
      const pay = Math.round(qty * 1.1);
      if (E.biz(bizId).money < pay) continue;
      return this.base('water', { bizId, issuer: E.ownerId(bizId), building: E.biz(bizId).building, qty, done: 0, pay, days: 1 });
    }
    return null;
  },
  /** Unripe plants in a farm's fields not yet watered today. */
  dryPlants(bizId) {
    const day = this.sim.time.day;
    return this.fieldsOf(bizId).map((id) => this.sim.state.objects[id]).filter((o) => o && o.stage < 3 && o.wateredDay !== day);
  },
  /** A water contract of yours on this plant's field. */
  waterAt(obj) {
    if (obj?.kind !== 'crop' || obj.stage >= 3 || obj.wateredDay === this.sim.time.day) return null;
    return this.S.active.find((c) => c.kind === 'water' && c.done < c.qty && this.fieldsOf(c.bizId).includes(obj.id)) || null;
  },
  /** A plant watered (by you or a worker): it grows for certain tomorrow. */
  watered(c, who, obj) {
    obj.wateredDay = this.sim.time.day;
    this.sim.bus.emit('object:changed', obj);
    this.addWork(c, who, 1);
  },

  /** A lumberyard or quarry short of its own timber or stone: gatherers wanted. */
  make_gather(who = null) {
    const E = this.sim.economy;
    const makes = { lumberyard: 'wood', quarry: 'stone' };
    for (const [type, item] of Object.entries(makes)) {
      for (const bizId of E.ofType(type)) {
        const b = E.biz(bizId);
        if (!b || b.closed || !E.ownerId(bizId) || (who && E.ownerId(bizId) !== who.id)) continue;
        const target = Math.max(20, E.target?.(bizId, item) || 40);
        if (E.stock(bizId, item) >= target * PR.gatherBelow) continue;
        const qty = Math.round(PR.gatherSize * this.rank().size);
        const pay = Math.round(qty * (ITEMS[item]?.basePrice || 3) * PR.gatherPay);
        if (b.money < pay) continue;
        return this.base('supply', { bizId, issuer: E.ownerId(bizId), building: b.building, item, qty, pay, days: 3, gather: true });
      }
    }
    return null;
  },

  /**
   * Something bigger, for a client who knows your work: improve their building (trust ≥ 2), or
   * put up a new one (trust ≥ 3) — a barn-warehouse for a farmer, a shop for a shopkeeper, a
   * house to let for anyone with the money.
   */
  make_proposal(who) {
    if (!who) return null;
    const sim = this.sim;
    const trust = this.trust(who.id);
    if (trust < PP.upgradeTrust || this.rep() < RP.lowOffers) return null;
    if (sim.growth.projectOf?.(who)) return null; // building something already
    const E = sim.economy;
    const biz = who.owns && E.biz(who.owns) ? who.owns : null;
    // A new building.
    if (trust >= PP.buildTrust) {
      const kind = biz ? (E.def(biz).type === 'farm' ? 'farm' : E.def(biz).kind === 'producer' ? 'producer' : 'shop') : 'home';
      const type = PP.types[kind];
      const def = VILLAGE_BUILDINGS[type];
      const mat = this.valueOf(def.materials);
      const hours = Math.round(def.labor * 1.2);
      const labour = Math.round(hours * PP.laborPay);
      const purse = biz ? E.biz(biz).money + who.money : who.money;
      if (purse >= labour + mat * 0.6) {
        return this.base('build', { issuer: who.id, building: biz ? E.biz(biz).building : who.homeId, bizId: biz || undefined, hours, done: 0, pay: labour, days: Math.max(4, Math.ceil(hours / 8) + 3), proposal: { what: 'new', type, purpose: kind === 'home' ? 'rental' : kind === 'farm' || kind === 'producer' ? 'storage' : 'shop', materials: { ...def.materials }, value: mat } });
      }
    }
    // Improving their building.
    const S = sim.structures;
    const home = biz ? E.biz(biz).building : who.homeId;
    if (!S?.rec(home) || S.works(home) || sim.property.rec(home)?.owner !== who.id) return null;
    const opt = S.options(home, who.id).filter((x) => x.check.ok && ['level', 'module', 'renovate'].includes(x.job.type)).sort((a, b) => S.estimate(a.cost) - S.estimate(b.cost))[0];
    if (!opt) return null;
    const mat = this.valueOf(opt.cost.materials);
    const hours = Math.max(3, Math.round(opt.cost.labor * 1.2));
    const labour = Math.round(hours * PP.laborPay);
    const purse = biz ? E.biz(biz).money : who.money;
    if (purse < labour + (opt.cost.money || 0) + mat * 0.6) return null;
    return this.base('build', { issuer: who.id, building: home, bizId: biz || undefined, hours, done: 0, pay: labour, days: Math.max(3, Math.ceil(hours / 8) + 2), proposal: { what: 'works', target: home, job: opt.job, materials: { ...opt.cost.materials }, value: mat } });
  },

  valueOf(materials) {
    let v = 0;
    for (const [item, q] of Object.entries(materials || {})) v += q * (ITEMS[item]?.basePrice || 3);
    return Math.round(v);
  },

  /**
   * Accepting a proposal: the site goes up (or the works start) — and whoever brings the materials:
   *   client   — they buy them, as they would anyway
   *   included — you get them, with the money they give you now (an advance)
   *   player   — you get them on your own account, and are paid back with something on top at the end
   */
  startProposal(o, mode = 'client') {
    const sim = this.sim;
    const P = o.proposal;
    const owner = sim.npcs.byId(o.issuer);
    if (!owner) return { ok: false, reason: 'contract_gone' };
    let site = null;
    if (P.what === 'new') {
      site = sim.growth.start(owner, P.type, P.purpose, sim.world.buildings[o.building]?.door ? { tx: sim.world.buildings[o.building].door.tx, ty: sim.world.buildings[o.building].door.ty } : undefined);
    } else {
      const r = sim.structures.start(P.target, P.job, owner.id);
      site = r.ok ? r.site : null;
    }
    if (!site) return { ok: false, reason: 'no_lot' };
    site.contractor = 'player'; // your crew builds it (the owner doesn't hire hands for it)
    o.siteId = site.id;
    o.siteKind = site.kind;
    o.hours = Math.max(o.hours, Math.ceil(site.laborNeeded / 60));
    o.materialsMode = mode;
    if (mode !== 'client') {
      // You bring the materials: the money they'd put by for them comes back to them.
      site.supplier = 'player';
      const refund = site.budget || 0;
      site.budget = 0;
      const purse = sim.growth.purse(site);
      if (purse && refund) purse.pay(-refund);
      if (mode === 'included') {
        const adv = Math.min(P.value, Math.max(0, Math.floor(purse?.get() ?? 0)));
        purse?.pay(adv);
        sim.state.player.money += adv;
        o.advance = adv;
        this.addCost(o, 'advance', 0);
      } else o.pay += Math.round(P.value * PP.playerMaterialsPremium);
    }
    return { ok: true, site };
  },
  /** Materials still wanted at the site you're supplying. */
  materialsNeeded(c) {
    const s = c.siteId && this.sim.construction.byId(c.siteId);
    if (s) return this.sim.construction.missing(s);
    return c.proposal ? { ...c.proposal.materials } : null;
  },

  // ================================================================== what it'll cost you

  addCost(c, what, amount) {
    c.costs ??= { materials: 0, wages: 0 };
    if (what !== 'advance') c.costs[what] = Math.round(((c.costs[what] || 0) + amount) * 100) / 100;
  },

  /** An average day's wage in your crew (or what a new hand would cost). */
  dayWage(ids = null) {
    const list = (ids?.length ? ids.map((id) => this.sim.workers.contract(id)) : this.sim.workers.list()).filter(Boolean);
    return list.length ? list.reduce((s, w) => s + w.salary, 0) / list.length : 15;
  },

  /**
   * What the job should take: hours of work left, days with n hands, wages for those hours, the
   * materials you'd have to pay for → what you'd make. (An estimate — what really happens decides.)
   */
  estimate(c, n = null) {
    const hands = Math.max(1, n ?? (c.workers?.length || this.recommended(c)));
    const left = Math.max(0, this.required(c) - (c.done || 0));
    let rate = RATES.goods;
    if (c.kind === 'harvest') rate = RATES.harvest;
    else if (c.kind === 'water') rate = RATES.water;
    else if (c.kind === 'repair') rate = RATES.repair;
    else if (c.kind === 'build' || (c.kind === 'job' && c.type === 'shift')) rate = RATES.build;
    else if (c.kind === 'job' && (c.type === 'courier' || c.type === 'rounds')) rate = RATES.post;
    else if (c.kind === 'order') rate = RATES.goods * 3;
    const hours = left / rate;
    const days = hours / (hands * RATES.hoursPerDay);
    const wages = hours * (this.dayWage(c.workers) / RATES.wageHours);
    let materials = 0;
    let noSource = false;
    const W = this.sim.workers;
    if (this.isGoods?.(c)) {
      // What's not in your storage has to be bought (or gathered — or it can't be had at all).
      const short = Math.max(0, this.goodsLeft(c) - W.storeCount(c.item, c.minQ));
      const seller = (c.minQ === undefined || c.minQ <= STANDARD) && W.seller(c.item, c.bizId);
      materials = seller ? short * W.unitPrice(seller.id, c.item) : 0;
      noSource = short > 0 && !seller && !GATHERABLE[c.item];
    } else if (c.materialsMode && c.materialsMode !== 'client') materials = this.valueOf(this.materialsNeeded(c));
    const spent = (c.costs?.materials || 0) + (c.costs?.wages || 0);
    const income = c.pay + (c.advance || 0);
    return { hours: Math.round(hours * 10) / 10, days: Math.round(days * 10) / 10, hands, wages: Math.round(wages), materials: Math.round(materials), spent: Math.round(spent), profit: Math.round(income - wages - materials - spent), noSource };
  },

  /** Can the hands on it finish in time? (Hours of work left against hours of working time before the deadline.) */
  atRisk(c) {
    if (!this.S.active.includes(c)) return false;
    const e = this.estimate(c);
    const daysLeft = c.deadline - this.sim.time.day + 1 - this.sim.time.hourFloat / 24;
    const hands = (c.workers?.length || 0) + (this.S.tracked === c.id ? 1 : 0);
    if (!hands) return e.hours > 0 && daysLeft < 1.5;
    return e.hours > hands * RATES.hoursPerDay * Math.max(0, daysLeft);
  },

  // ================================================================== asking for more

  canNegotiate(o, what) {
    if (!this.S.offers.includes(o)) return false;
    return !(o.asked || {})[what];
  },

  /**
   * Ask for more money ('pay') or more time ('time'). They weigh it up — their purse, how badly
   * they need it done, your name, how they like you, how often you've helped them, who else is
   * out of work and could do it, their nature — and say yes, no, or find someone else.
   */
  negotiate(id, what) {
    const sim = this.sim;
    const o = this.S.offers.find((x) => x.id === id);
    if (!o || !this.canNegotiate(o, what)) return { ok: false, reason: 'contract_gone' };
    this.assess(o);
    o.asked ??= {};
    o.asked[what] = true;
    const npc = sim.npcs.byId(o.issuer);
    const idle = sim.state.npcs.filter((n) => n.occupation === 'unemployed' && n.age >= 16).length;
    let p = NG.base + (this.rep() - 50) * NG.perRep + (npc?.rel || 0) * NG.perRel + this.trust(o.issuer) * NG.perTrust + Math.min(6, idle) * NG.perIdle;
    if (npc?.traits.includes('greedy')) p += NG.greedy;
    if (npc?.traits.includes('generous')) p += NG.generous;
    const urgent = this.isUrgent(o);
    let newPay = o.pay;
    let newDays = o.days;
    if (what === 'pay') {
      newPay = Math.round(o.pay * (1 + NG.payStep));
      if (urgent) p += NG.urgentPay;
      const money = this.payer(o).get();
      if (money < newPay * 1.05) p = 0; // they simply haven't got it
    } else {
      newDays = o.days + Math.max(1, Math.round(o.days * NG.timeStep));
      if (urgent) p += NG.urgentTime;
    }
    const yes = rand.chance(Math.max(0, Math.min(0.95, p)));
    if (yes) {
      o.pay = newPay;
      o.days = newDays;
      sim.bus.emit('contracts:changed');
      return { ok: true, pay: newPay, days: newDays };
    }
    // Pushed too far by someone they're not fond of: they'll find someone else.
    const walk = (npc?.rel || 0) < 20 && rand.chance(NG.walkAway + (npc?.traits.includes('greedy') ? 0.15 : 0));
    if (walk) {
      this.S.offers = this.S.offers.filter((x) => x !== o);
      if (npc) this.S.declined[npc.id] = sim.time.day;
      sim.bus.emit('contracts:changed');
    }
    return { ok: false, refused: true, walked: walk };
  },

  // ================================================================== how it went

  /**
   * The job judged on what really happened: how fast (against the estimate when it was taken on),
   * how skilled the hands that did the work, the deadline, and the job itself.
   */
  judge(c) {
    const sim = this.sim;
    const now = sim.time.total;
    // Speed: the time it took against the time it should have taken with the hands it had.
    const took = Math.max(1, (now - (c.acceptedAt ?? now - 60)) / 60); // hours, round the clock
    const expect = Math.max(1, c.expectHours ?? 8);
    const ratio = expect / took;
    const speed = clamp01(ratio / 1.2);
    // Skill: of whoever did the work, weighted by how much each did.
    const field = this.fieldOf(c);
    let tot = 0;
    let sk = 0;
    for (const [who, w] of Object.entries(c.crew || {})) {
      const lvl = who === 'player' ? this.playerLevel(field) : this.workerLevel(who, field);
      sk += w * Math.min(1, 0.35 + lvl / 8);
      tot += w;
    }
    const skill = tot ? sk / tot : 0.5;
    // Deadline: early, on the day, late.
    const daysLate = Math.max(0, sim.time.day - c.deadline);
    const daysEarly = Math.max(0, c.deadline - sim.time.day);
    const deadline = daysLate ? clamp01(0.4 - daysLate * 0.2) : clamp01(0.75 + daysEarly * 0.12);
    // The job itself: a building left sound; every plant in; what was asked for, handed over.
    let job = 0.8;
    if (c.kind === 'repair') job = clamp01((sim.property.rec(c.building)?.condition ?? 0) / 100);
    else if (c.kind === 'build' && c.siteId) job = clamp01((sim.construction.byId(c.siteId)?.quality ?? 60) / 90 + 0.2);
    else if (c.kind === 'craft' && c.minQ !== undefined) job = c.minQ > STANDARD ? 1 : 0.8;
    else if (c.kind === 'harvest' || c.kind === 'water') job = clamp01((c.done || 0) / c.qty);
    const W = QY.weights;
    const score = Math.round((speed * W.speed + skill * W.skill + deadline * W.deadline + job * W.job) * 100);
    const grade = QY.grades.find((g) => score >= g.from);
    const word = (x) => (x >= 0.85 ? 'excellent' : x >= 0.65 ? 'good' : x >= 0.4 ? 'fair' : 'poor');
    return { score, grade: grade.id, speed: word(speed), skill: word(skill), deadline: daysLate ? 'late' : daysEarly ? 'early' : 'on_time', daysLate, payMult: 1 + grade.pay - daysLate * QY.latePerDay, xpMult: grade.xp, rep: grade.rep - (daysLate ? -RP.late : 0) };
  },

  /** What the job did for your name, for the client's memory of you — and the history. */
  recordOutcome(c, how, result = null) {
    const k = c.issuer && c.issuer !== 'village' ? this.client(c.issuer) : null;
    if (how === 'done' || how === 'short') {
      this.addRep(result?.rep ?? 1);
      if (k) {
        k.done++;
        if (result?.daysLate) k.late++;
        k.q += result?.score ?? 60;
        k.n++;
        k.pay += c.awarded?.pay || 0;
      }
    } else if (how === 'failed') {
      this.addRep(RP.failed);
      if (k) k.failed++;
    } else if (how === 'abandoned') {
      this.addRep(RP.cancelled);
      if (k) k.cancelled++;
    }
    // (Called off by the client: no one's fault — nothing changes.)
  },

  /** Every contract you've had, the latest first: who for, what, how it ended, the pay, the grade. */
  history() {
    return this.S.log.slice().reverse();
  },

  // ================================================================== the client calls it off

  /** Is the work still wanted? (Fields gone to winter, the building gone, the site finished by others…) */
  stillNeeded(c) {
    const sim = this.sim;
    if (c.issuer && c.issuer !== 'village' && !sim.npcs.byId(c.issuer)) return false;
    if (c.kind === 'harvest') return sim.time.season !== 'winter';
    if (c.kind === 'water') return sim.time.season !== 'winter';
    if (c.kind === 'repair') return !!sim.world.buildings[c.building] && !sim.property.rec(c.building)?.ruined;
    if (c.kind === 'build') return !!sim.construction.byId(c.siteId) || c.siteKind === 'works';
    return true;
  },

  /** The client calls it off: they pay for the work done so far; nobody's name suffers. */
  clientCancel(c) {
    const sim = this.sim;
    if (!this.S.active.includes(c)) return;
    const share = Math.min(1, (c.done || 0) / Math.max(1, this.required(c)));
    const owed = Math.round(c.pay * share);
    const payer = this.payer(c);
    const paid = Math.max(0, Math.min(owed, Math.floor(payer.get())));
    payer.take(paid);
    sim.state.player.money += paid;
    this.S.active = this.S.active.filter((x) => x !== c);
    c.status = 'cancelled';
    c.awarded.pay = paid;
    this.release(c);
    if (this.S.tracked === c.id) this.S.tracked = null;
    this.recordOutcome(c, 'client_cancelled');
    this.log(c, 'client_cancelled', paid);
    sim.toast('toast.contract_called_off', { npc: c.issuer !== 'village' ? c.issuer : undefined, money: paid }, 'info');
    sim.bus.emit('contracts:changed');
  },

  // ================================================================== your firm

  canFound() {
    const sim = this.sim;
    if (this.S.company) return { ok: false, reason: 'have_company' };
    const need = STANDINGS.findIndex((x) => x.id === CO.needStanding);
    if (STANDINGS.indexOf(this.rank()) < need) return { ok: false, reason: 'need_standing', params: { crank: CO.needStanding } };
    if (!sim.workers.list().length) return { ok: false, reason: 'no_workers' };
    if (sim.state.player.money < CO.needMoney) return { ok: false, reason: 'no_money', params: { money: CO.needMoney } };
    return { ok: true };
  },

  /** Register a contracting company: a name, a base (your storage), its own books from today. */
  found(name = null) {
    const chk = this.canFound();
    if (!chk.ok) return chk;
    const sim = this.sim;
    sim.state.player.money -= CO.fee;
    sim.state.village.treasury += CO.fee;
    this.S.company = { name: name || null, founded: sim.time.day, base: sim.workers.baseBuilding()?.id || null, revenue: 0, costs: 0, jobs: 0 };
    sim.chronicle('chronicle.company_founded', { name: sim.state.player.name });
    sim.toast('toast.company_founded', {}, 'good');
    sim.bus.emit('contracts:changed');
    return { ok: true };
  },

  /** The firm's books: what came in and went out for contracts (since you founded it — or ever). */
  books() {
    const log = this.S.log.filter((x) => !this.S.company || x.day >= this.S.company.founded);
    const revenue = log.reduce((s, x) => s + (x.paid || 0), 0);
    const costs = log.reduce((s, x) => s + (x.cost || 0), 0);
    return { revenue: Math.round(revenue), costs: Math.round(costs), profit: Math.round(revenue - costs), jobs: log.filter((x) => x.how === 'done' || x.how === 'short').length };
  },

  /** Hands, the contracts they're on, and what's still to do — for the overview. */
  overview() {
    const W = this.sim.workers;
    const busy = new Set(this.S.active.flatMap((c) => c.workers || []));
    return {
      active: this.S.active.map((c) => ({ id: c.id, kind: c.kind, issuer: c.issuer, progress: this.progress(c), workers: (c.workers || []).length, want: this.recommended(c), risk: this.atRisk(c) })),
      free: W.list().filter((w) => !busy.has(w.npcId)).map((w) => w.npcId),
    };
  },
};

/** For the Workers panel and the crew picker: a worker's levels in each trade (0–10). */
export function skillLevels(sim, npc) {
  const E = sim.education;
  return ['farming', 'building', 'forestry', 'mining', 'trade', 'carpentry'].map((f) => ({ field: f, level: Math.floor((E?.competence(npc, f) || 0) / 10), comp: E?.competence(npc, f) || 0 }));
}

export { JOBS };
