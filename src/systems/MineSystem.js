/**
 * MineSystem — a mining camp of yours becomes a proper mine: you dig it down level by level, shore the
 * tunnels up with timber, and the deeper it goes the richer the ore — coal, iron, and down in the dark, gems.
 *
 *   levels     — dig down (planks for the shaft, money for the digging): level 1 is the camp's surface work
 *                (its miners pick at the rocks round about, as before); from level 2 the tunnels give ore of
 *                their own each day, for every miner who worked (and for your own shift there)
 *   supports   — timber props, from planks: each level wants MINE.supportsPerLevel of them
 *   cave-ins   — once a week the tunnels may give: likelier the deeper you are and the fewer the supports.
 *                The mine stops for a few days, the miners are hurt, and some supports are lost.
 *
 * Only mines you've dug deeper are touched — villagers' camps go on as before. No dice: what the tunnels
 * give builds up day by day, and whether they hold is decided by a hash of the mine and the week.
 *
 *   state.mines = { [bizId]: { depth, supports, prog: { item: fraction }, haltUntil, collapses, dugDay } }
 */
import { hashStr } from '../core/rng.js';

export const MINE = {
  maxDepth: 5,
  /** Digging the next level down: planks for the shaft's timbering, money for the diggers. */
  digCost: (depth) => ({ planks: 8 + depth * 6, money: 50 + depth * 45 }),
  supportsPerLevel: 4,
  /** Ore from the tunnels, per miner per day, by level. */
  yield: {
    2: { stone: 1.2, coal: 0.6 },
    3: { stone: 1, coal: 0.8, iron_ore: 0.6, gemstone: 0.05 },
    4: { stone: 0.9, coal: 1, iron_ore: 0.9, gemstone: 0.08 },
    5: { stone: 0.8, coal: 1.2, iron_ore: 1.1, gemstone: 0.12 },
  },
  caveInRisk: 0.05, // a week, per level below the first, with no supports at all
  haltDays: 3,
  hurt: 25, // health lost by each miner caught in it
  supportsLost: 0.5,
  weekday: 4,
  evening: 19,
};

export class MineSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.mines ??= {};
    // (the day's ore at seven in the evening, when the shifts are done)
    sim.bus.on('time:hour', (h) => h === MINE.evening && this.daily());
    sim.bus.on('time:day', () => sim.time.weekday === MINE.weekday && this.weekly());
  }

  get S() {
    return this.sim.state.mines;
  }

  /** Is this business a mine (a mining camp)? */
  isMine(bizId) {
    return this.sim.economy.def(bizId)?.type === 'mining_camp';
  }

  mine(bizId) {
    return this.S[bizId] || { depth: 1, supports: 0, prog: {}, haltUntil: 0, collapses: 0 };
  }

  maxSupports(bizId) {
    return Math.max(0, (this.mine(bizId).depth - 1) * MINE.supportsPerLevel);
  }

  /** How well shored up the tunnels are: 0…1 (1 with no tunnels to shore). */
  safety(bizId) {
    const max = this.maxSupports(bizId);
    return max ? Math.min(1, this.mine(bizId).supports / max) : 1;
  }

  /** This week's chance the tunnels give. */
  risk(bizId) {
    const m = this.mine(bizId);
    return Math.max(0, MINE.caveInRisk * (m.depth - 1) * (1 - this.safety(bizId)));
  }

  halted(bizId) {
    return this.sim.time.day < (this.mine(bizId).haltUntil || 0);
  }

  /** Planks you have (pockets and storage). */
  have(item) {
    return this.sim.inventory.count(item) + this.sim.home.storageCount(item);
  }

  take(item, n) {
    const fromPocket = Math.min(n, this.sim.inventory.count(item));
    if (fromPocket) this.sim.inventory.remove(item, fromPocket);
    if (n - fromPocket) this.sim.home.take(item, n - fromPocket);
  }

  canDig(bizId) {
    if (!this.isMine(bizId) || !this.sim.holdings.isMine(bizId)) return { ok: false, reason: 'not_your_mine' };
    const m = this.mine(bizId);
    if (m.depth >= MINE.maxDepth) return { ok: false, reason: 'mine_deepest' };
    if (this.halted(bizId)) return { ok: false, reason: 'mine_caved_in' };
    const cost = MINE.digCost(m.depth);
    if (this.have('planks') < cost.planks) return { ok: false, reason: 'need_item', params: { item: 'planks', qty: cost.planks } };
    if (this.sim.state.player.money < cost.money) return { ok: false, reason: 'no_money' };
    return { ok: true, cost };
  }

  /** Dig the next level down. */
  dig(bizId) {
    const chk = this.canDig(bizId);
    if (!chk.ok) return chk;
    const m = (this.S[bizId] ??= this.mine(bizId));
    this.take('planks', chk.cost.planks);
    this.sim.state.player.money -= chk.cost.money;
    m.depth++;
    m.dugDay = this.sim.time.day;
    this.sim.progression.addSkillXp?.('mining', 25);
    this.sim.chronicle('chronicle.mine_deeper', { n: m.depth });
    this.sim.bus.emit('player:changed');
    return { ok: true, depth: m.depth };
  }

  canShore(bizId, n = 1) {
    if (!this.isMine(bizId) || !this.sim.holdings.isMine(bizId)) return { ok: false, reason: 'not_your_mine' };
    const m = this.mine(bizId);
    if (m.supports >= this.maxSupports(bizId)) return { ok: false, reason: 'mine_shored' };
    if (this.have('planks') < n) return { ok: false, reason: 'need_item', params: { item: 'planks', qty: n } };
    return { ok: true };
  }

  /** Put up timber props (a plank each). */
  shore(bizId, n = MINE.supportsPerLevel) {
    const m = this.S[bizId];
    if (!m) return { ok: false, reason: 'mine_shored' };
    n = Math.min(n, this.maxSupports(bizId) - m.supports, this.have('planks'));
    const chk = this.canShore(bizId, Math.max(1, n));
    if (!chk.ok) return chk;
    this.take('planks', n);
    m.supports += n;
    return { ok: true, n };
  }

  /** Ore per miner per day from the tunnels, at this depth. */
  yieldAt(depth) {
    return MINE.yield[Math.min(MINE.maxDepth, depth)] || {};
  }

  /** Each evening: the tunnels give ore for every miner who worked there today (and your own shift). */
  daily() {
    const sim = this.sim;
    const E = sim.economy;
    for (const [id, m] of Object.entries(this.S)) {
      const b = E.biz(id);
      if (!b || b.closed || m.depth < 2 || this.halted(id)) continue;
      const miners = sim.state.npcs.filter((n) => n.employer === id && n.workedToday).length + (b.workedDay === sim.time.day ? 1 : 0);
      if (!miners) continue;
      m.prog ??= {};
      for (const [item, per] of Object.entries(this.yieldAt(m.depth))) {
        m.prog[item] = (m.prog[item] || 0) + per * miners;
        const whole = Math.floor(m.prog[item]);
        if (whole > 0) {
          b.stock[item] = (b.stock[item] || 0) + whole;
          m.prog[item] -= whole;
        }
      }
    }
  }

  /** Once a week: do the tunnels hold? */
  weekly() {
    const sim = this.sim;
    const week = Math.floor(sim.time.day / 7);
    for (const [id, m] of Object.entries(this.S)) {
      if (m.depth < 2 || this.halted(id) || !sim.economy.biz(id)) continue;
      if (hashStr(`cavein:${id}:${week}`, sim.state.seed) >= this.risk(id)) continue;
      this.caveIn(id);
    }
  }

  caveIn(id) {
    const sim = this.sim;
    const m = this.S[id];
    m.haltUntil = sim.time.day + MINE.haltDays;
    m.collapses = (m.collapses || 0) + 1;
    m.supports = Math.floor(m.supports * (1 - MINE.supportsLost));
    const hurt = sim.state.npcs.filter((n) => n.employer === id);
    for (const n of hurt) n.health = Math.max(10, (n.health ?? 100) - MINE.hurt);
    const b = sim.economy.biz(id);
    sim.chronicle('chronicle.mine_cave_in', { building: b?.building, n: hurt.length });
    if (sim.holdings.isMine(id)) sim.toast('toast.mine_cave_in', { n: hurt.length }, 'danger');
    return hurt.length;
  }
}
