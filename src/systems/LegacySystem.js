/**
 * LegacySystem — what your family is remembered for.
 *
 *   state.legacy = { renown, line, deeds: [{ day, key, params, name, gender, generation }] }
 *
 * The things you do that change the valley — a building raised, an outpost and
 * the hamlet that grew round it, a road to another settlement, a business
 * founded or backed, a year as headman, an institution founded on your watch,
 * the village becoming a town — are deeds. Each adds to your family's renown,
 * and the deeds are kept, with the name of whoever did them.
 *
 * Renown outlives you. When you retire or die and your heir carries on, the
 * village gives them the benefit of the doubt: everyone starts out trusting
 * them a little, in proportion to what the family has done. People bring up
 * the family's deeds in conversation, and renown counts at elections. If the
 * line ends and a newcomer takes over, the deeds stay in the village's history
 * — but the renown was your family's, not theirs.
 */
import { DEEDS, LEGACY as L } from '../data/civic.js';
import { rand } from '../core/rng.js';

const MAX_DEEDS = 80;

export class LegacySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.legacy ??= { renown: 0, line: 1, deeds: [] };
    sim.bus.on('chronicle', (e) => this.onChronicle(e));
    sim.bus.on('player:succeeded', (info) => this.onSucceeded(info));
  }

  get L() {
    return this.sim.state.legacy;
  }

  renown() {
    return Math.round(this.L.renown);
  }

  /** Renown in words: unknown → known → respected → renowned → legendary. */
  tier() {
    const r = this.renown();
    return r >= 120 ? 'legendary' : r >= 60 ? 'renowned' : r >= 25 ? 'respected' : r >= 8 ? 'known' : 'unknown';
  }

  deeds() {
    return this.L.deeds;
  }

  onChronicle(e) {
    const w = DEEDS[e.key];
    if (!w) return;
    const p = this.sim.state.player;
    this.L.renown += w;
    this.L.deeds.push({ day: e.day, key: e.key.replace('chronicle.', ''), params: { ...(e.params || {}) }, name: p.name, gender: p.gender, generation: p.generation || 1, line: this.L.line });
    if (this.L.deeds.length > MAX_DEEDS) this.L.deeds.shift();
  }

  /** The torch passes: an heir inherits the family's good name; a newcomer starts from nothing. */
  onSucceeded({ heirId }) {
    const sim = this.sim;
    if (!heirId) {
      this.L.renown = 0;
      this.L.line++;
      return;
    }
    const goodwill = Math.min(L.goodwillMax, this.L.renown * L.goodwillPerRenown);
    if (goodwill <= 0) return;
    for (const n of sim.state.npcs) {
      n.pb ??= { t: 0, r: 0, c: 0 };
      n.pb.t = Math.min(100, n.pb.t + goodwill);
      n.pb.r = Math.min(100, n.pb.r + goodwill * 0.5);
      n.rel = Math.min(100, (n.rel || 0) + goodwill * 0.4);
    }
    sim.chronicle('chronicle.legacy_goodwill', { name: sim.state.player.name, gender: sim.state.player.gender, renown: this.tier() });
  }

  /** A deed of this family someone might bring up in conversation (for DialogueSystem). */
  deedToTalkAbout() {
    const mine = this.L.deeds.filter((d) => d.line === this.L.line);
    if (!mine.length) return null;
    // Bigger deeds and recent ones come up more.
    const d = mine[mine.length - 1 - Math.floor(rand.float() ** 2 * mine.length)];
    return d;
  }
}
