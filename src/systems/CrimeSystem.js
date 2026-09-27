/**
 * CrimeSystem — theft in the valley, and the law.
 *
 *   thieves    — now and then, in the small hours, a villager at the end of their rope (next to no money,
 *                miserable) steals: from a shop's till or shelves, or from your storage. The generous, the
 *                loyal and the careful never do; the greedy, the reckless and the aggressive are likelier to.
 *   locks      — a lock on your storage turns most of them away (CRIME.lockStops).
 *   the watch  — once the village has its watch house (CivicSystem), fewer try, and it solves some cases itself.
 *   constable  — you can take the job (at the hall): a weekly wage from the village fund; your patrols put
 *                thieves off, and you can look into a case (two hours) and fine the thief — the victim is
 *                paid back, the rest goes to the village. Caught three times, a thief leaves the valley.
 *
 * No dice: who tries, whether they're put off and whether a case is solved all follow from a hash of who,
 * where and which day.
 *
 *   state.crime = { cases: [{ id, day, thief, target, kind, item, qty, value, solved, fined }], nextId }
 *   player.lock (your storage has one) · player.constable = { since }
 */
import { hashStr } from '../core/rng.js';
import { ITEMS } from '../data/items.js';

export const CRIME = {
  hour: 2, // when thieves are about
  poorBelow: 12, // money
  unhappyBelow: 40, // mood
  base: 0.06, // chance a night, for someone that desperate
  traits: { greedy: 1.8, risk_taker: 1.5, aggressive: 1.4, lazy: 1.2, generous: 0, loyal: 0, careful: 0 },
  watchDeters: 0.5, // the watch house: this many fewer try
  constableDeters: 0.5, // your patrols: and this many fewer again
  lockStops: 0.8,
  yourStorageShare: 0.25, // how often it's your storage they go for (if you're worth robbing)
  takeMoney: [5, 25],
  takeGoods: [1, 4],
  watchSolves: 0.5,
  fineTimes: 1.5, // the fine: what was taken, times this
  banishAfter: 3,
  constablePay: 25, // a week, from the village fund
  constableRep: 10,
  lockCost: 40,
  investigateMinutes: 120,
  keepCases: 40,
};

export class CrimeSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.crime ??= { cases: [], nextId: 1 };
    sim.bus.on('time:hour', (h) => h === CRIME.hour && this.night());
    sim.bus.on('time:day', () => sim.time.weekday === 5 && this.weekly());
  }

  get S() {
    return this.sim.state.crime;
  }
  get p() {
    return this.sim.state.player;
  }

  isConstable() {
    return !!this.p.constable;
  }

  /** How likely this villager is to steal tonight (0 if they wouldn't). */
  temptation(npc) {
    if (npc.age < 16 || npc.inside === 'jail' || npc.leaving) return 0;
    if ((npc.money || 0) >= CRIME.poorBelow || (npc.mood ?? 60) >= CRIME.unhappyBelow) return 0;
    let k = CRIME.base;
    for (const tr of npc.traits || []) if (CRIME.traits[tr] !== undefined) k *= CRIME.traits[tr];
    if (this.sim.civic?.has('watch')) k *= 1 - CRIME.watchDeters;
    if (this.isConstable()) k *= 1 - CRIME.constableDeters;
    return k;
  }

  night() {
    const sim = this.sim;
    const day = sim.time.day;
    for (const npc of sim.state.npcs) {
      const k = this.temptation(npc);
      if (!k || hashStr(`theft:${npc.id}:${day}`, sim.state.seed) >= k) continue;
      this.steal(npc);
    }
  }

  /** Someone steals: from your storage (if you've things worth taking), or a shop. */
  steal(npc) {
    const sim = this.sim;
    const day = sim.time.day;
    const h = (k) => hashStr(`theft:${k}:${npc.id}:${day}`, sim.state.seed);
    const E = sim.economy;
    const yours = sim.home?.storageCount && (sim.state.player.storage || []).some((s) => s && s.qty > 0 && !ITEMS[s.id]?.tool);
    let c = null;
    if (yours && h('target') < CRIME.yourStorageShare) {
      if (this.p.lock && h('lock') < CRIME.lockStops) return null; // the lock held
      const slots = sim.state.player.storage.filter((s) => s && s.qty > 0 && !ITEMS[s.id]?.tool);
      const s = slots[Math.floor(h('slot') * slots.length)];
      const qty = Math.min(s.qty, CRIME.takeGoods[0] + Math.floor(h('qty') * (CRIME.takeGoods[1] - CRIME.takeGoods[0] + 1)));
      sim.home.take(s.id, qty);
      npc.pantry = (npc.pantry || 0) + (ITEMS[s.id]?.food ? qty : 0);
      c = { target: 'player', kind: 'goods', item: s.id, qty, value: Math.round(qty * (ITEMS[s.id]?.basePrice || 3)) };
      sim.toast('toast.theft_yours', { item: s.id, qty }, 'danger');
    } else {
      const shops = E.active().filter((id) => E.def(id).kind === 'shop' && !E.biz(id).closed && E.owner(id) !== npc && E.biz(id).money > 10);
      if (!shops.length) return null;
      const id = shops[Math.floor(h('shop') * shops.length)];
      const b = E.biz(id);
      if (b.owner === 'player' && b.lock && h('lock') < CRIME.lockStops) return null;
      const take = Math.min(Math.floor(b.money), CRIME.takeMoney[0] + Math.floor(h('amt') * (CRIME.takeMoney[1] - CRIME.takeMoney[0])));
      b.money -= take;
      E.ledger(id, 'exp', take);
      npc.money = (npc.money || 0) + take;
      c = { target: id, kind: 'money', qty: take, value: take };
      if (b.owner === 'player') sim.toast('toast.theft_till', { money: take, building: b.building }, 'danger');
    }
    c = { id: this.S.nextId++, day, thief: npc.id, solved: false, ...c };
    this.S.cases.push(c);
    if (this.S.cases.length > CRIME.keepCases) this.S.cases.shift();
    if (c.target === 'player') sim.chronicle('chronicle.theft_player', { item: c.item });
    else sim.chronicle('chronicle.theft', { building: E.biz(c.target)?.building });
    return c;
  }

  /** Weekly: the watch looks into last week's cases; you're paid as constable. */
  weekly() {
    const sim = this.sim;
    if (sim.civic?.has('watch')) {
      for (const c of this.open()) {
        if (hashStr(`watch:${c.id}`, sim.state.seed) < CRIME.watchSolves) this.fine(c, false);
      }
    }
    if (this.isConstable()) {
      const V = sim.state.village;
      const pay = Math.min(CRIME.constablePay, Math.max(0, Math.floor(V.treasury)));
      if (pay > 0) {
        V.treasury -= pay;
        this.p.money += pay;
        sim.toast('toast.constable_paid', { money: pay }, 'info');
      }
    }
  }

  open() {
    return this.S.cases.filter((c) => !c.solved && this.sim.npcs.byId(c.thief));
  }

  canBeConstable() {
    if (this.isConstable()) return { ok: false, reason: 'already_constable' };
    if (this.p.reputation < CRIME.constableRep) return { ok: false, reason: 'need_reputation', params: { value: CRIME.constableRep } };
    return { ok: true };
  }

  becomeConstable() {
    const chk = this.canBeConstable();
    if (!chk.ok) return chk;
    this.p.constable = { since: this.sim.time.day };
    this.sim.chronicle('chronicle.player_constable', {});
    return { ok: true };
  }

  resign() {
    delete this.p.constable;
    return { ok: true };
  }

  canLock() {
    if (this.p.lock) return { ok: false, reason: 'has_lock' };
    if (this.p.money < CRIME.lockCost) return { ok: false, reason: 'no_money' };
    return { ok: true };
  }

  fitLock() {
    const chk = this.canLock();
    if (!chk.ok) return chk;
    this.p.money -= CRIME.lockCost;
    this.p.lock = true;
    this.sim.bus.emit('player:changed');
    return { ok: true };
  }

  canInvestigate(caseId) {
    if (!this.isConstable()) return { ok: false, reason: 'not_constable' };
    const c = this.S.cases.find((x) => x.id === caseId);
    if (!c || c.solved) return { ok: false, reason: 'case_closed' };
    if (this.p.energy < 15) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  /** You've looked into it (two hours — GameScene): cases a week old or less are solved; older ones have gone cold. */
  investigate(caseId) {
    const chk = this.canInvestigate(caseId);
    if (!chk.ok) return chk;
    const c = this.S.cases.find((x) => x.id === caseId);
    this.sim.progression.addSkillXp?.('negotiation', 10);
    if (this.sim.time.day - c.day > 7) {
      c.cold = true;
      return { ok: true, solved: false };
    }
    const fined = this.fine(c, true);
    return { ok: true, solved: true, thief: c.thief, fined };
  }

  /** The thief is found out: fined, the victim paid back; the third time, they leave the valley. */
  fine(c, byYou) {
    const sim = this.sim;
    const n = sim.npcs.byId(c.thief);
    c.solved = true;
    if (!n) return 0;
    const fine = Math.min(Math.max(0, Math.floor(n.money || 0)), Math.round(c.value * CRIME.fineTimes));
    n.money -= fine;
    const back = Math.min(fine, c.value);
    if (c.target === 'player') this.p.money += back;
    else {
      const b = sim.economy.biz(c.target);
      if (b) b.money += back;
    }
    sim.state.village.treasury += fine - back;
    c.fined = fine;
    n.convictions = (n.convictions || 0) + 1;
    sim.memory?.remember(n, 'caught_stealing', { who: byYou ? 'player' : null });
    if (byYou) {
      n.rel = Math.max(-100, (n.rel ?? 0) - 20);
      sim.progression.addReputation(2);
    }
    sim.chronicle('chronicle.thief_caught', { npc: n.id, gender: n.gender, money: fine });
    if (n.convictions >= CRIME.banishAfter && !n.leaving) {
      sim.chronicle('chronicle.thief_banished', { npc: n.id, gender: n.gender });
      sim.growth.leave([n]); // they pack up and go down the west road
    }
    return fine;
  }
}
