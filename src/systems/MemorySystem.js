/**
 * MemorySystem — villagers remember what happened to them.
 *
 * A memory is small plain data stored on the NPC:
 *   { k: kind, d: day, w: who ('player' | npc id | null), i: importance, n: count, p: params, told: day }
 *
 * Creating a memory changes how the villager sees the person involved
 * (trust, friendship, respect, conflict — see SocialSystem), nudges their mood,
 * and gives them something to talk about. Unimportant memories fade after a
 * while; life-defining ones (importance 5) stay forever.
 *
 * Villagers also pass on what they remember about the player to their friends,
 * so the way you treat one person slowly becomes your reputation.
 */
import { MEMORY_KINDS, RETENTION_DAYS, MAX_MEMORIES } from '../data/memories.js';
import { rand } from '../core/rng.js';

export class MemorySystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  def(kind) {
    return MEMORY_KINDS[kind] || { imp: 1, val: 0 };
  }

  /** Record a memory for this villager. Returns the memory entry. */
  remember(npc, kind, { who = null, params = null, imp = null } = {}) {
    if (!npc) return null;
    npc.memories ??= [];
    const def = this.def(kind);
    const day = this.sim.time.day;
    let m = def.merge ? npc.memories.find((x) => x.k === kind && x.w === who && day - x.d <= def.merge) : null;
    if (m) {
      m.n = (m.n || 1) + 1;
      m.d = day;
      if (params) m.p = params;
    } else {
      m = { k: kind, d: day, w: who, i: imp ?? def.imp };
      if (params && Object.keys(params).length) m.p = params;
      npc.memories.push(m);
      this.prune(npc);
    }
    // The feeling of the moment.
    if (def.bond && who) {
      if (who === 'player') this.sim.social.adjustPlayer(npc, def.bond);
      else {
        const other = this.sim.npcs.byId(who);
        if (other) this.sim.social.adjust(npc, other, def.bond);
      }
    }
    if (def.val) npc.mood = Math.max(0, Math.min(100, (npc.mood ?? 60) + def.val * 2));
    this.sim.bus.emit('memory:added', { npc: npc.id, kind, who });
    return m;
  }

  /** Is this memory still remembered? */
  alive(m, day = this.sim.time.day) {
    return day - m.d <= RETENTION_DAYS[Math.max(1, Math.min(5, m.i))];
  }

  /** How vivid a memory is right now (importance, fading with age). */
  weight(m, day = this.sim.time.day) {
    const keep = RETENTION_DAYS[Math.max(1, Math.min(5, m.i))];
    const fade = keep === Infinity ? 1 : Math.max(0, 1 - (day - m.d) / keep);
    return m.i * (0.4 + 0.6 * fade) * (1 + Math.min(3, (m.n || 1) - 1) * 0.15);
  }

  /** Drop the faintest memories when there are too many. */
  prune(npc) {
    if (npc.memories.length <= MAX_MEMORIES) return;
    const day = this.sim.time.day;
    npc.memories.sort((a, b) => (b.i >= 5) - (a.i >= 5) || this.weight(b, day) - this.weight(a, day));
    npc.memories.length = MAX_MEMORIES;
    npc.memories.sort((a, b) => a.d - b.d);
  }

  /** Memories involving someone, most vivid first. */
  about(npc, who) {
    const day = this.sim.time.day;
    return (npc.memories || []).filter((m) => m.w === who && this.alive(m, day)).sort((a, b) => this.weight(b, day) - this.weight(a, day));
  }

  has(npc, kind, who = undefined) {
    return (npc.memories || []).some((m) => m.k === kind && (who === undefined || m.w === who) && this.alive(m));
  }

  /** The most vivid memories, for the Inspect panel. */
  strongest(npc, n = 6) {
    const day = this.sim.time.day;
    return (npc.memories || [])
      .filter((m) => this.alive(m, day))
      .sort((a, b) => this.weight(b, day) - this.weight(a, day))
      .slice(0, n);
  }

  /** Net feeling from memories made recently (for mood). */
  recentFeeling(npc, days = 7) {
    const day = this.sim.time.day;
    let s = 0;
    for (const m of npc.memories || []) if (day - m.d <= days) s += this.def(m.k).val * Math.min(3, m.n || 1);
    return s;
  }

  /** How the villager feels about the player based on everything they remember (−∞…+∞, ~±20). */
  opinionOfPlayer(npc) {
    const day = this.sim.time.day;
    let s = 0;
    for (const m of npc.memories || []) if (m.w === 'player' && this.alive(m, day)) s += this.def(m.k).val * this.weight(m, day) * 0.5;
    return s;
  }

  // ------------------------------------------------------------------ word of mouth

  /**
   * Two villagers chatting: the speaker may pass on a strong memory about the player.
   * The listener forms a second-hand memory (and opinion) of their own.
   */
  gossip(speaker, listener) {
    const day = this.sim.time.day;
    const candidates = (speaker.memories || []).filter((m) => m.w === 'player' && this.def(m.k).share && this.alive(m, day));
    if (!candidates.length) return false;
    const m = rand.pick(candidates);
    const already = (listener.memories || []).some((x) => (x.k === 'heard_player_good' || x.k === 'heard_player_bad') && x.p?.src === speaker.id && x.p?.about === m.k);
    if (already || listener.memories?.some((x) => x.w === 'player' && x.k === m.k)) return false;
    const good = this.def(m.k).val > 0;
    // You believe friends more than people you barely know.
    const trustInSpeaker = this.sim.social.bond(listener, speaker);
    if (trustInSpeaker && trustInSpeaker.t < -20) return false;
    this.remember(listener, good ? 'heard_player_good' : 'heard_player_bad', { who: 'player', params: { src: speaker.id, about: m.k, npc: speaker.id } });
    return true;
  }

  // ------------------------------------------------------------------ daily upkeep

  onDay() {
    const day = this.sim.time.day;
    for (const npc of this.sim.state.npcs) {
      if (!npc.memories?.length) continue;
      npc.memories = npc.memories.filter((m) => this.alive(m, day));
    }
  }
}
