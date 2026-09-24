/**
 * AmbitionSystem — long-term goals you choose for yourself.
 *
 * Nothing forces a path: pick up to three ambitions to keep an eye on (they
 * show in your Journal), and achieve them — or others you weren't tracking —
 * in whatever order your life takes you. Progress is measured from the actual
 * world (what you own, make, know, have built and discovered), never from a
 * separate counter. Achieving one is remembered in the village's history.
 *
 *   player.ambitions = [ids]   (tracked)     player.achieved = { id: day }
 */
import { SKILLS } from '../data/skills.js';

const count = (xs, f) => xs.filter(f).length;

/** Each ambition: measure(sim) → [current, target]. */
export const AMBITIONS = {
  master_craftsman: { icon: '🪚', measure: (s) => [Math.max(...['carpentry', 'smithing', 'cooking'].map((k) => s.state.player.skills[k]?.level || 0)), 10] },
  masterworks: { icon: '✨', measure: (s) => [s.state.stats.masterworks || 0, 5] },
  landowner: { icon: '🏘️', measure: (s) => [count(Object.values(s.property.all), (r) => r.owner === 'player') + s.state.land.owned.length, 10] },
  big_farm: { icon: '🌾', measure: (s) => [Object.keys(s.state.fields).length, 40] },
  builder: { icon: '🏗️', measure: (s) => [count(s.construction.list, (c) => c.owner === 'player' && c.status === 'done'), 8] },
  employer: { icon: '👷', measure: (s) => [Object.keys(s.state.workers).length, 5] },
  contractor: { icon: '📜', measure: (s) => [s.state.contracts?.done || 0, 20] },
  merchant: { icon: '💰', measure: (s) => [Math.round(s.state.stats.moneyEarned || 0), 5000] },
  wealthy: { icon: '👑', measure: (s) => [Math.round(s.state.player.money), 10000] },
  explorer: { icon: '🧭', measure: (s) => [s.exploration.known().length, 7] },
  cartographer: { icon: '🗺️', measure: (s) => [Math.round(s.exploration.valleyExplored() * 100), 90] },
  family: { icon: '👪', measure: (s) => [s.state.player.children?.length || 0, 3] },
  benefactor: { icon: '🤲', measure: (s) => [s.state.player.donated || 0, 1000] },
  polymath: { icon: '📚', measure: (s) => [count(Object.keys(SKILLS), (k) => (s.state.player.skills[k]?.level || 0) >= 5), 6] },
  beloved: { icon: '❤️', measure: (s) => [count(s.state.npcs, (n) => s.social.tier(n) === 'trusted'), 8] },
};

export const MAX_TRACKED = 3;

export class AmbitionSystem {
  constructor(sim) {
    this.sim = sim;
    const p = sim.state.player;
    p.ambitions ??= [];
    p.achieved ??= {};
    sim.bus.on('time:hour', () => this.check());
  }

  get p() {
    return this.sim.state.player;
  }

  progress(id) {
    const [v, target] = AMBITIONS[id].measure(this.sim);
    return { value: v, target, done: this.p.achieved[id] !== undefined, pct: Math.min(1, v / target) };
  }

  track(id) {
    const p = this.p;
    if (!AMBITIONS[id]) return false;
    if (p.ambitions.includes(id)) p.ambitions = p.ambitions.filter((x) => x !== id);
    else if (p.ambitions.length < MAX_TRACKED) p.ambitions.push(id);
    else return false;
    this.sim.bus.emit('player:changed');
    return true;
  }

  /** Hourly: has anything been achieved? */
  check() {
    const p = this.p;
    for (const id of Object.keys(AMBITIONS)) {
      if (p.achieved[id] !== undefined) continue;
      const { value, target } = this.progress(id);
      if (value >= target) this.achieve(id);
    }
  }

  achieve(id) {
    const sim = this.sim;
    this.p.achieved[id] = sim.time.day;
    this.p.ambitions = this.p.ambitions.filter((x) => x !== id);
    sim.progression.addReputation(5);
    sim.progression.addXp(120);
    sim.chronicle('chronicle.player_ambition', { ambition: id });
    sim.toast('toast.ambition', { ambition: id }, 'good');
  }
}
