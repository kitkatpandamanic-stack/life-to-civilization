/**
 * InventionSystem — ideas you work out yourself, at a workbench (yours at home, or your own workshop):
 *
 *   start  — pick an idea you're skilled enough for (and the valley knows enough for); the materials for
 *            the model and the trials are used up
 *   work   — two-hour sittings: faster the better you are at it; now and then one goes wrong (a setback)
 *   race   — word gets round that someone in the trade is working on the same thing: they get there
 *            on their own, slower — whoever finishes first holds the patent
 *   patent — once it exists, the whole valley benefits (TechSystem.mod); for three years every business
 *            of the kind that uses it pays the holder a royalty each week, and other towns can buy a licence
 *
 *   state.inventions = {
 *     project: { id, done (minutes), started, rival: { npc, done } | null } | null,
 *     patents: { id: { owner: 'player' | npcId, day, until, earned, licences: [settlementId] } },
 *     log: [{ day, key, params }]
 *   }
 * Heirs inherit your patents (they're the family's). No dice: setbacks and rivals come from a fixed hash.
 */
import { hashStr } from '../core/rng.js';
import { INVENTIONS, INVENT } from '../data/inventions.js';

export class InventionSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.inventions ??= { project: null, patents: {}, log: [] };
    this.S.patents ??= {};
    this.S.log ??= [];
    sim.bus.on('time:day', () => this.daily());
  }

  get S() {
    return this.sim.state.inventions;
  }

  have(item) {
    return this.sim.inventory.count(item) + this.sim.home.storageCount(item);
  }

  /** Could you take this idea on? */
  canStart(id) {
    const sim = this.sim;
    const d = INVENTIONS[id];
    if (!d) return { ok: false, reason: 'unknown' };
    if (this.S.patents[id]) return { ok: false, reason: 'invented_already' };
    if (this.S.project) return { ok: false, reason: 'project_underway' };
    if ((sim.state.player.skills[d.skill]?.level || 0) < d.min) return { ok: false, reason: 'need_skill_level', params: { skill: d.skill, n: d.min } };
    const tech = d.needs.find((x) => !sim.tech.has(x));
    if (tech) return { ok: false, reason: 'need_tech', params: { tech } };
    for (const [item, n] of Object.entries(d.materials)) if (this.have(item) < n) return { ok: false, reason: 'need_items', params: { item, n, have: this.have(item) } };
    return { ok: true };
  }

  /** Take the idea on: the materials go into it — and maybe someone else is at it too. */
  start(id) {
    const chk = this.canStart(id);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const d = INVENTIONS[id];
    for (const [item, n] of Object.entries(d.materials)) {
      const fromPocket = Math.min(n, sim.inventory.count(item));
      if (fromPocket) sim.inventory.remove(item, fromPocket);
      if (n - fromPocket) sim.home.take(item, n - fromPocket);
    }
    const rival = this.findRival(id);
    this.S.project = { id, done: 0, started: sim.time.day, sittings: 0, rival: rival ? { npc: rival.id, done: 0 } : null };
    this.note('started', { invention: id });
    if (rival) this.note('rival', { invention: id, npc: rival.id });
    sim.bus.emit('inventions:changed');
    return { ok: true, rival: rival?.id || null };
  }

  /** Someone in the trade working on the same thing (by a fixed hash — the same idea, the same rival). */
  findRival(id) {
    const sim = this.sim;
    const d = INVENTIONS[id];
    if (hashStr(`rival:${id}`, sim.state.seed) > INVENT.rivalChance) return null;
    const pool = sim.state.npcs.filter((n) => d.rivals.includes(n.occupation) && n.age >= 18 && !n.away).sort((a, b) => (b.level || 1) - (a.level || 1));
    return pool[0] || null;
  }

  /** How much of it a sitting gets done (the better you are, the faster). */
  speed() {
    const sim = this.sim;
    const p = this.S.project;
    const d = p && INVENTIONS[p.id];
    if (!d) return 1;
    const lvl = sim.state.player.skills[d.skill]?.level || 0;
    return 1 + Math.max(0, lvl - d.min) * INVENT.skillSpeed + (sim.state.player.skills.learning?.level || 0) * 0.05;
  }

  need(id) {
    return INVENTIONS[id].hours * 60;
  }

  canWork() {
    if (!this.S.project) return { ok: false, reason: 'no_project' };
    if (this.sim.state.player.energy < INVENT.sessionEnergy) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  /** A sitting's over (GameScene runs the two hours): progress — or a setback. */
  work() {
    const chk = this.canWork();
    if (!chk.ok) return chk;
    const sim = this.sim;
    const p = this.S.project;
    const d = INVENTIONS[p.id];
    sim.state.player.energy = Math.max(0, sim.state.player.energy - INVENT.sessionEnergy);
    p.sittings = (p.sittings || 0) + 1;
    const lvl = sim.state.player.skills[d.skill]?.level || 0;
    const risk = Math.max(0.02, INVENT.setbackBase - (lvl - d.min) * INVENT.setbackPerLevel);
    const setback = p.sittings > 1 && hashStr(`sit:${p.id}:${p.sittings}`, sim.state.seed) < risk;
    const gained = setback ? -Math.min(p.done, INVENT.setbackLoss) : Math.round(INVENT.sessionMinutes * this.speed());
    p.done = Math.max(0, p.done + gained);
    sim.progression.addSkillXp(d.skill, 6);
    sim.progression.addSkillXp('learning', 3);
    if (p.done >= this.need(p.id)) return { ok: true, finished: this.patent(p.id, 'player'), gained };
    sim.bus.emit('inventions:changed');
    return { ok: true, setback, gained, pct: Math.round((p.done / this.need(p.id)) * 100) };
  }

  /** It exists: the patent to whoever got there first; the valley's better for it. */
  patent(id, owner) {
    const sim = this.sim;
    const d = INVENTIONS[id];
    this.S.patents[id] = { owner, day: sim.time.day, until: sim.time.day + INVENT.patentDays, earned: 0, licences: [] };
    if (this.S.project?.id === id) this.S.project = null;
    sim.tech.mods = null; // (TechSystem folds the effects in)
    sim.tech.addKnowledge(INVENT.knowledge, `invention:${id}`);
    const by = owner === 'player' ? null : sim.npcs.byId(owner);
    sim.chronicle(owner === 'player' ? 'chronicle.player_invented' : 'chronicle.npc_invented', { invention: id, npc: by?.id, gender: by?.gender });
    if (by) sim.memory.remember(by, 'invented', { params: { tech: id } });
    this.note(owner === 'player' ? 'patented' : 'beaten', { invention: id, npc: by?.id });
    sim.bus.emit('inventions:patent', { id, owner });
    sim.bus.emit('inventions:changed');
    return { id, owner, effects: d.effects };
  }

  /** Everyone gets the good of what's been invented (TechSystem.mod). */
  effects() {
    return Object.keys(this.S.patents).map((id) => INVENTIONS[id]?.effects).filter(Boolean);
  }

  /** Businesses that owe the holder of this patent a royalty (not the holder's own). */
  payers(id) {
    const sim = this.sim;
    const d = INVENTIONS[id];
    const P = this.S.patents[id];
    return sim.economy.active().filter((b) => d.payers.includes(sim.economy.def(b)?.type || b) && !(P?.owner === 'player' && sim.holdings.isMine(b)) && sim.economy.owner(b)?.id !== P?.owner);
  }

  /** Weekly: royalties from every business that uses it, while the patent lasts. */
  royalties() {
    const sim = this.sim;
    for (const [id, P] of Object.entries(this.S.patents)) {
      if (sim.time.day > P.until) continue;
      const d = INVENTIONS[id];
      let got = 0;
      for (const b of this.payers(id)) {
        const biz = sim.economy.biz(b);
        const pay = Math.min(d.royalty, Math.max(0, Math.floor(biz.money || 0)));
        if (!pay) continue;
        biz.money -= pay;
        sim.economy.ledger?.(b, 'exp', pay);
        got += pay;
      }
      if (!got) continue;
      P.earned += got;
      this.pay(P.owner, got, id);
    }
  }

  /** Money to a patent's holder (you: through the books as royalties). */
  pay(owner, money, id) {
    const sim = this.sim;
    if (owner === 'player') {
      this.royaltiesIn(money);
      sim.toast('toast.royalties', { invention: id, money }, 'gain');
    } else {
      const npc = sim.npcs.byId(owner);
      if (npc) npc.money = (npc.money || 0) + money;
    }
  }

  /** (LedgerSystem books this as 'royalties'.) */
  royaltiesIn(money) {
    this.sim.state.player.money += money;
  }

  /** Another town would pay for the right to use it: what they'd pay. */
  licencePrice(id, settlementId) {
    const s = this.sim.settlements.get(settlementId);
    return Math.round(INVENT.licenceBase + (s?.pop || 0) * INVENT.licencePerPop);
  }

  canLicence(id, settlementId) {
    const P = this.S.patents[id];
    if (!P || P.owner !== 'player') return { ok: false, reason: 'not_your_patent' };
    if (this.sim.time.day > P.until) return { ok: false, reason: 'patent_expired' };
    if (P.licences.includes(settlementId)) return { ok: false, reason: 'licence_sold' };
    const s = this.sim.settlements.get(settlementId);
    if (!s || !s.contact) return { ok: false, reason: 'no_contact' };
    return { ok: true, price: this.licencePrice(id, settlementId) };
  }

  /** Sell another town the right to use it (once). */
  licenceSold(id, settlementId) {
    const chk = this.canLicence(id, settlementId);
    if (!chk.ok) return chk;
    const P = this.S.patents[id];
    P.licences.push(settlementId);
    P.earned += chk.price;
    this.sim.state.player.money += chk.price;
    this.note('licence', { invention: id, settlement: settlementId, money: chk.price });
    this.sim.bus.emit('inventions:changed');
    return { ok: true, price: chk.price };
  }

  /** Daily: the rival's progress (they may beat you to it); weekly royalties. */
  daily() {
    const sim = this.sim;
    const p = this.S.project;
    if (p?.rival) {
      const n = sim.npcs.byId(p.rival.npc);
      if (!n || n.away) p.rival = null;
      else {
        p.rival.done += INVENT.rivalPerDay * (1 + (n.level || 1) / 6);
        if (p.rival.done >= this.need(p.id) * INVENT.rivalSlower) {
          const id = p.id;
          this.S.project = null;
          this.patent(id, n.id);
          sim.toast('toast.invention_beaten', { invention: id, npc: n.id }, 'danger');
        }
      }
    }
    if (sim.time.weekday === INVENT.royaltyWeekday) this.royalties();
  }

  /** Where the rival is, against you (0–100 each), for the panel. */
  race() {
    const p = this.S.project;
    if (!p) return null;
    const need = this.need(p.id);
    return { you: Math.min(100, Math.round((p.done / need) * 100)), rival: p.rival ? Math.min(100, Math.round((p.rival.done / (need * INVENT.rivalSlower)) * 100)) : null, npc: p.rival?.npc || null };
  }

  note(key, params) {
    this.S.log.unshift({ day: this.sim.time.day, key, params });
    if (this.S.log.length > 30) this.S.log.pop();
  }
}
