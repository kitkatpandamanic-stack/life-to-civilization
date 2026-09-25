/**
 * HoldingsSystem — your stake in the village economy.
 *
 * You can own real village businesses: the same bakeries, shops, smithies,
 * farms and warehouses the villagers run (EconomySystem / EnterpriseSystem),
 * not a separate kind of "player business". Buy one from its owner, or open one
 * in premises you own. Then it's yours to run: set prices and wages, decide how
 * many people to employ, appoint a manager, move money in and out of the till,
 * and work shifts there yourself. Its money, stock, staff, customers and books
 * are the real ones — the village shops there, and its workers live on its wages.
 *
 * You can also put money into other people's businesses: a stake (a share of
 * each week's profit) or a loan (paid back with interest).
 *
 * Business orders: once you own a business, other businesses place bulk orders
 * with it (see ContractSystem kind 'order'), filled from its stock.
 *
 * Your own workers can be posted to a business of yours: they join its staff and do its
 * work (the baker's, the farmhand's, the woodcutter's — like anyone employed there), on its
 * wages, from its till. Your terms with them are kept (npc.crew), so you can call them back
 * to your crew — and if the business ever lets them go, they come back to you.
 *
 *   business.owner === 'player'    business.stakes = [{ who: 'player', share, paid }]
 *   business.loan = { lender: 'player', amount, left, rate }
 */
import { BUSINESS_TYPES, BUSINESS_NAME_COUNT, ENTERPRISE as EN } from '../data/businessTypes.js';
import { ITEMS } from '../data/items.js';
import { rand } from '../core/rng.js';

export const HOLDINGS = {
  goodwillWeeks: 6, // a business is worth its assets plus this many weeks of profit
  minGoodwill: 120,
  attachment: 1.15, // owners want a bit more than it's worth…
  stakeShareMax: 0.4,
  loanRate: 0.12, // total interest on a loan to a business
  shiftHours: 3,
  managerBonus: 0.25, // production when a manager runs it in your absence (vs. 0.6 unattended)
  workedBonus: 1, // when you worked there today
};
const H = HOLDINGS;

export class HoldingsSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  get E() {
    return this.sim.economy;
  }
  get p() {
    return this.sim.state.player;
  }

  mine() {
    return this.E.active().filter((id) => this.E.biz(id).owner === 'player');
  }

  isMine(id) {
    return this.E.biz(id)?.owner === 'player';
  }

  // ------------------------------------------------------------------ what's it worth?

  /** Stock at base price + the premises (if the owner owns them) + goodwill. */
  valuation(id) {
    const E = this.E;
    const b = E.biz(id);
    let stock = 0;
    for (const [item, n] of Object.entries(b.stock || {})) stock += (ITEMS[item]?.basePrice || 0) * Math.max(0, n);
    const r = this.sim.property.rec(b.building);
    const premises = r && r.owner === b.owner ? this.sim.property.value(b.building) : 0;
    const profit = Math.max(0, this.sim.enterprise.books(id, 7).profit);
    const goodwill = Math.max(H.minGoodwill, profit * H.goodwillWeeks);
    return Math.round(Math.max(0, b.money) + stock * 0.6 + premises + goodwill);
  }

  /** What the owner would take for it — or why they won't sell. */
  askingPrice(id) {
    const E = this.E;
    const owner = E.owner(id);
    const b = E.biz(id);
    if (!owner || b.owner === 'player') return { ok: false, reason: 'not_for_sale' };
    const value = this.valuation(id);
    const tier = this.sim.social.tier(owner);
    if (tier === 'hostile' || tier === 'wary') return { ok: false, reason: 'owner_refuses' };
    // Some are ready to let go: the old, the struggling, the ones who've had enough.
    let factor = H.attachment;
    if (owner.age >= owner.retireAge - 5) factor -= 0.15;
    if ((b.troubleDays || 0) > 5) factor -= 0.2;
    if (owner.traits.includes('greedy')) factor += 0.25;
    if (tier === 'trusted') factor -= 0.1;
    // The village's founding businesses are someone's life's work.
    if (b.founder === undefined && owner.age < 55 && (b.troubleDays || 0) < 3) factor += 0.35;
    return { ok: true, price: Math.round(value * factor), value };
  }

  buy(id) {
    if (!this.sim.progression.hasUnlock('start_business')) return { ok: false, reason: 'business_locked' };
    const ask = this.askingPrice(id);
    if (!ask.ok) return ask;
    if (this.p.money < ask.price) return { ok: false, reason: 'no_money' };
    const sim = this.sim;
    const E = this.E;
    const b = E.biz(id);
    const owner = E.owner(id);
    this.p.money -= ask.price;
    owner.money += ask.price;
    // The premises come with it if they were the owner's.
    const r = sim.property.rec(b.building);
    if (r && r.owner === owner.id) sim.property.transfer(b.building, 'player', 'bought', ask.price);
    b.owner = 'player';
    b.boughtDay = sim.time.day;
    owner.owns = null;
    // The old owner stays on to run it for you — or retires on the proceeds.
    if (owner.age < 58 && E.def(id).workerOccupation) {
      owner.employer = id;
      owner.occupation = E.def(id).workerOccupation;
      owner.hiredDay = sim.time.day;
      b.manager = owner.id;
    } else {
      owner.occupation = owner.age >= 55 ? 'elder' : 'unemployed';
      owner.employer = null;
    }
    owner.task = null;
    // Keep the team as it is (the old owner now counts among them).
    b.maxWorkers = Math.max(b.maxWorkers ?? E.def(id).maxWorkers ?? 0, sim.npcs.staffOf(id).length);
    sim.memory.remember(owner, 'sold_business_to_player', { who: 'player', params: { building: b.building } });
    sim.chronicle('chronicle.player_bought_business', { building: b.building, npc: owner.id });
    sim.progression.addReputation(3);
    E.invalidate();
    sim.bus.emit('business:changed', id);
    sim.bus.emit('player:changed');
    return { ok: true, price: ask.price };
  }

  /** Premises you could open a business in: yours, not your home, not already trading. */
  canOpenIn(buildingId) {
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(buildingId);
    if (!r || r.owner !== 'player' || r.ruined) return { ok: false, reason: 'not_your_premises' };
    if (buildingId === this.p.homeId || this.E.businessAtBuilding(buildingId) || sim.businesses.atBuilding(buildingId)) return { ok: false, reason: 'premises_in_use' };
    if (P.isHome(buildingId) && P.occupants(buildingId) > 0) return { ok: false, reason: 'premises_occupied' };
    return { ok: true };
  }

  /** Business types that can be run from these premises. */
  typesFor(buildingId) {
    const t = this.sim.property.type(buildingId);
    return Object.entries(BUSINESS_TYPES)
      .filter(([, d]) => d.openable && (!d.needsTech || this.sim.tech?.has(d.needsTech)))
      .filter(([, d]) => (d.premises === 'warehouse' ? t === 'warehouse_bld' : true))
      .map(([id]) => id);
  }

  startCost(type) {
    return this.sim.enterprise.startCost(type, false);
  }

  open(buildingId, type, { outpost = false } = {}) {
    if (!outpost && !this.sim.progression.hasUnlock('start_business')) return { ok: false, reason: 'business_locked' };
    const chk = this.canOpenIn(buildingId);
    if (!chk.ok) return chk;
    if (!outpost && !this.typesFor(buildingId).includes(type)) return { ok: false, reason: 'premises_unsuitable' };
    // An outpost's fitting-out came with building it.
    const cost = outpost ? 0 : this.startCost(type);
    if (this.p.money < cost) return { ok: false, reason: 'no_money' };
    const sim = this.sim;
    const E = this.E;
    const T = BUSINESS_TYPES[type];
    this.p.money -= cost;
    // Fitting out: the local carpenters and smiths get the work.
    const fitOut = Math.round(cost * EN.premisesDeposit);
    const yard = E.ofType('carpentry')[0] || 'lumberyard';
    const smith = E.ofType('smithy')[0];
    if (E.biz(yard) && !E.biz(yard).closed) E.biz(yard).money += Math.round(fitOut * 0.6);
    if (smith) E.biz(smith).money += fitOut - Math.round(fitOut * 0.6);
    const id = `b${sim.state.settlement.nextBizId++}`;
    const used = new Set(E.ofType(type).map((x) => E.biz(x).nameIdx));
    let nameIdx = rand.int(0, BUSINESS_NAME_COUNT - 1);
    for (let i = 0; i < BUSINESS_NAME_COUNT && used.has(nameIdx); i++) nameIdx = (nameIdx + 1) % BUSINESS_NAME_COUNT;
    sim.state.businesses[id] = {
      id, type, building: buildingId, owner: 'player', money: outpost ? 150 : cost - fitOut,
      stock: {}, daysUnpaid: 0, markup: 1, wageLevel: 1, reputation: 50 + Math.min(20, this.p.reputation / 2), maxWorkers: T.maxWorkers ? 1 : 0,
      history: [], today: { rev: 0, exp: 0 }, opened: sim.time.day, nameIdx, founder: 'player',
    };
    const pr = sim.property.rec(buildingId);
    pr.formerBusiness = type;
    pr.abandoned = false;
    pr.emptyDays = 0;
    E.invalidate();
    sim.chronicle('chronicle.player_opened_business', { biz_type: type, building: buildingId });
    sim.bus.emit('business:opened', id);
    sim.bus.emit('building:changed', buildingId);
    sim.bus.emit('player:changed');
    return { ok: true, id };
  }

  // ------------------------------------------------------------------ running it

  setMarkup(id, m) {
    if (!this.isMine(id)) return;
    const [lo, hi] = EN.markup;
    this.E.biz(id).markup = Math.round(Math.max(lo, Math.min(hi + 0.2, m)) * 100) / 100;
    this.sim.bus.emit('business:changed', id);
  }

  setWageLevel(id, w) {
    if (!this.isMine(id)) return;
    const [lo, hi] = EN.wageLevel;
    this.E.biz(id).wageLevel = Math.round(Math.max(lo, Math.min(hi + 0.2, w)) * 100) / 100;
    this.sim.bus.emit('business:changed', id);
  }

  /** How many people you want working there (fewer than now: the newest are let go). */
  setStaffTarget(id, n) {
    if (!this.isMine(id)) return;
    const E = this.E;
    const b = E.biz(id);
    const def = E.def(id);
    b.maxWorkers = Math.max(0, Math.min((def.maxWorkers || 0) + 3, n));
    const staff = this.sim.npcs.staffOf(id).sort((a, c) => (c.hiredDay || 0) - (a.hiredDay || 0));
    while (staff.length > b.maxWorkers) this.sim.enterprise.layOff(staff.shift(), id, 'laid_off');
    this.sim.bus.emit('business:changed', id);
  }

  appointManager(id, npcId) {
    if (!this.isMine(id)) return;
    const b = this.E.biz(id);
    const n = this.sim.npcs.byId(npcId);
    if (!n || n.employer !== id) return;
    b.manager = n.id;
    this.sim.memory.remember(n, 'became_manager', { who: 'player', params: { building: b.building } });
    this.sim.bus.emit('business:changed', id);
  }

  // ------------------------------------------------------------------ your workers at your business

  /** Can this worker of yours be posted to this business of yours? */
  canPost(id, npcId) {
    const sim = this.sim;
    if (!this.isMine(id)) return { ok: false, reason: 'not_yours' };
    const def = this.E.def(id);
    if (!def.workerOccupation) return { ok: false, reason: 'no_staff_here' };
    if (!sim.workers.contract(npcId)) return { ok: false, reason: 'not_your_worker' };
    const room = (def.maxWorkers || 0) + 3;
    if (sim.npcs.staffOf(id).length >= room) return { ok: false, reason: 'staff_full', params: { n: room } };
    return { ok: true };
  }

  /**
   * Post a worker of yours to a business of yours: off whatever they were doing (a contract, your
   * manager's job), onto its staff — its work, its wages. manager: and put them in charge there.
   */
  post(id, npcId, { manager = false } = {}) {
    const chk = this.canPost(id, npcId);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const W = sim.workers;
    const K = sim.contracts;
    const npc = sim.npcs.byId(npcId);
    const wc = W.contract(npcId);
    const job = K.jobOf(npcId);
    if (job) K.assign(job.id, job.workers.filter((x) => x !== npcId), 'manager');
    if (W.isManager(npcId)) W.dismissManager();
    W.release(wc);
    sim.equipment?.releaseWorker(npcId); // (your barrow stays with you, not with the business)
    sim.npcs.clearReservation(npc);
    // Your terms with them, kept for when they come back.
    npc.crew = { ...wc, task: null, job: undefined, since: sim.time.day };
    delete W.contracts[npcId];
    const def = this.E.def(id);
    const b = this.E.biz(id);
    npc.employer = id;
    npc.occupation = def.workerOccupation;
    npc.hiredDay = sim.time.day;
    npc.unpaidDays = 0;
    npc.carry = null;
    npc.task = null;
    npc.nextThink = sim.time.total;
    b.maxWorkers = Math.max(b.maxWorkers ?? def.maxWorkers ?? 0, sim.npcs.staffOf(id).length);
    if (manager) this.appointManager(id, npcId);
    sim.toast('toast.posted_to_business', { npc: npcId, building: b.building }, 'good');
    sim.bus.emit('workers:changed');
    sim.bus.emit('business:changed', id);
    return { ok: true };
  }

  /** Your workers working at your businesses now. */
  posted(id = null) {
    return this.sim.state.npcs.filter((n) => n.crew && this.isMine(n.employer) && (!id || n.employer === id));
  }

  /** Call a posted worker back to your crew (on the terms you had). */
  canRecall(npcId) {
    const npc = this.sim.npcs.byId(npcId);
    // (They're still yours — they count among your workers while they're away — so there's always room.)
    if (!npc?.crew || !this.isMine(npc.employer)) return { ok: false, reason: 'not_your_worker' };
    return { ok: true };
  }

  recall(npcId) {
    const chk = this.canRecall(npcId);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const npc = sim.npcs.byId(npcId);
    const b = this.E.biz(npc.employer);
    if (b?.manager === npcId) b.manager = null;
    const from = b?.building;
    const back = { ...npc.crew, task: null, state: 'idle', stateSince: sim.time.total };
    delete back.since;
    delete npc.crew;
    sim.workers.contracts[npcId] = back;
    npc.employer = 'player';
    npc.occupation = 'hired_hand';
    npc.task = null;
    npc.nextThink = sim.time.total;
    sim.toast('toast.back_to_crew', { npc: npcId, building: from }, 'info');
    sim.bus.emit('workers:changed');
    if (b) sim.bus.emit('business:changed', npc.employer);
    return { ok: true };
  }

  withdraw(id, amount) {
    const b = this.E.biz(id);
    if (!this.isMine(id)) return 0;
    const m = Math.max(0, Math.min(amount, Math.floor(b.money)));
    b.money -= m;
    this.p.money += m;
    this.sim.bus.emit('player:changed');
    return m;
  }

  deposit(id, amount) {
    const b = this.E.biz(id);
    if (!b) return 0;
    const m = Math.max(0, Math.min(amount, Math.floor(this.p.money)));
    this.p.money -= m;
    b.money += m;
    this.sim.bus.emit('player:changed');
    return m;
  }

  /** How hard the business runs today (see EconomySystem.produce): you, a manager, or nobody minding it. */
  presence(id) {
    const b = this.E.biz(id);
    if (b.workedDay === this.sim.time.day) return H.workedBonus;
    const mgr = b.manager && this.sim.npcs.byId(b.manager);
    if (mgr && mgr.employer === id) return 0.6 + H.managerBonus + Math.min(0.15, mgr.level * 0.015);
    return 0.6;
  }

  /** Work a shift at your own business: it runs at full strength today, and you learn the trade. */
  workShift(id) {
    if (!this.isMine(id)) return false;
    const b = this.E.biz(id);
    b.workedDay = this.sim.time.day;
    const skill = { bakery: 'cooking', tavern: 'cooking', smithy: 'smithing', carpentry: 'carpentry', farm: 'farming', lumberyard: 'woodcutting', quarry: 'mining', fishery: 'fishing', builders: 'construction' }[b.type] || 'trading';
    this.sim.progression.addSkillXp(skill, 20);
    this.sim.progression.addSkillXp('leadership', 6);
    this.sim.progression.addXp(15);
    this.sim.needs.spendEnergy(12);
    return true;
  }

  // ------------------------------------------------------------------ other people's businesses

  /** Offer to buy into someone's business: a share of profits for money in the till. */
  stakeOffer(id) {
    const E = this.E;
    const b = E.biz(id);
    const owner = E.owner(id);
    if (!owner || b.owner === 'player') return { ok: false, reason: 'not_for_sale' };
    if ((b.stakes || []).some((s) => s.who === 'player')) return { ok: false, reason: 'already_invested' };
    const tier = this.sim.social.tier(owner);
    if (tier === 'hostile' || tier === 'wary' || tier === 'stranger') return { ok: false, reason: 'owner_refuses' };
    const value = this.valuation(id);
    const amount = Math.round(value * 0.25);
    const share = Math.min(H.stakeShareMax, Math.round((amount / (value + amount)) * 100) / 100);
    return { ok: true, amount, share };
  }

  invest(id) {
    const o = this.stakeOffer(id);
    if (!o.ok) return o;
    if (this.p.money < o.amount) return { ok: false, reason: 'no_money' };
    const b = this.E.biz(id);
    this.p.money -= o.amount;
    b.money += o.amount;
    b.stakes ??= [];
    b.stakes.push({ who: 'player', share: o.share, paid: 0, since: this.sim.time.day, amount: o.amount });
    const owner = this.E.owner(id);
    this.sim.memory.remember(owner, 'got_backing', { who: 'player', params: { building: b.building } });
    this.sim.social.adjustPlayer(owner, { t: 8, r: 6 });
    this.sim.chronicle('chronicle.player_invested', { building: b.building, npc: owner.id });
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** Lend a business money (paid back weekly from profits, with interest). */
  lend(id, amount) {
    const b = this.E.biz(id);
    const owner = this.E.owner(id);
    if (!b || !owner || b.loan || this.p.money < amount || amount <= 0) return { ok: false, reason: b?.loan ? 'already_has_loan' : 'no_money' };
    this.p.money -= amount;
    b.money += amount;
    b.loan = { lender: 'player', amount, left: Math.round(amount * (1 + H.loanRate)), day: this.sim.time.day };
    this.sim.memory.remember(owner, 'got_backing', { who: 'player', params: { building: b.building } });
    this.sim.social.adjustPlayer(owner, { t: 6 });
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  /** Your stakes and loans across the village (for the UI). */
  portfolio() {
    const E = this.E;
    const out = [];
    for (const id of E.ids()) {
      const b = E.biz(id);
      for (const s of b.stakes || []) if (s.who === 'player') out.push({ id, kind: 'stake', share: s.share, paid: s.paid, amount: s.amount, closed: !!b.closed });
      if (b.loan?.lender === 'player') out.push({ id, kind: 'loan', left: b.loan.left, amount: b.loan.amount, closed: !!b.closed });
    }
    return out;
  }

  /** Weekly: your share of the profits in the businesses you've invested in. */
  payStakes() {
    const E = this.E;
    for (const id of E.active()) {
      const b = E.biz(id);
      for (const s of b.stakes || []) {
        if (s.who !== 'player') continue;
        const profit = this.sim.enterprise.books(id, 7).profit;
        const pay = Math.min(Math.floor(b.money - 60), Math.round(profit * s.share));
        if (pay <= 0) continue;
        b.money -= pay;
        E.ledger(id, 'exp', pay);
        this.p.money += pay;
        s.paid += pay;
        this.sim.toast('toast.dividend', { money: pay, building: b.building }, 'gain');
      }
    }
  }

  onDay() {
    const sim = this.sim;
    if (sim.time.weekday === 1) this.payStakes();
    // Your own businesses in trouble: you hear about it.
    for (const id of this.mine()) {
      const b = this.E.biz(id);
      if ((b.troubleDays || 0) === 3 || (b.troubleDays || 0) === 8) sim.toast('toast.your_business_trouble', { building: b.building }, 'danger');
    }
  }
}
