/**
 * SocialSystem — relationships between the player and villagers,
 * and between villagers themselves.
 *
 * A relationship has several sides, all in −100…100:
 *   f  friendship — do they like each other?
 *   t  trust      — do they rely on each other's word?
 *   r  respect    — do they think highly of each other's work and standing?
 *   c  conflict   — unresolved tension (fades slowly)
 *
 * These change through real events (see MemorySystem) — a job given, a friend
 * fired, wages unpaid, an argument over a drink — not through menus.
 *
 * Villager ↔ villager: npc.relations[otherId] = { f, t, r, c }
 *   (each side has its own view: B can trust A more than A trusts B)
 * Player ↔ villager:  npc.rel (friendship 0–100) + npc.pb = { t, r, c }
 *
 * What kind of relationship it is (family, employer, rival, close friend…) is
 * worked out from these numbers plus kinship, work and business ownership.
 */
import { BALANCE } from '../config/balance.js';
import { ITEMS } from '../data/items.js';
import { GIFT_PREFERENCES } from '../data/npcs.js';
import { traitValue } from '../data/traits.js';
import { Mod } from './Modifiers.js';

const S = BALANCE.social;
const TIER_ORDER = ['hostile', 'wary', 'stranger', 'acquaintance', 'friend', 'trusted'];
const clamp = (v) => Math.max(-100, Math.min(100, Math.round(v * 10) / 10));

export class SocialSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.onDay());
  }

  // ------------------------------------------------------------------ player ↔ villager

  playerBond(npc) {
    npc.pb ??= { t: 0, r: 0, c: 0 };
    return npc.pb;
  }

  tier(npc) {
    if (!npc?.met) return 'stranger';
    const pb = this.playerBond(npc);
    if (pb.c >= 50 || pb.t <= -40) return 'hostile';
    if (pb.c >= 25 || pb.t <= -15) return 'wary';
    if (npc.rel >= S.tiers.trusted && pb.t >= 0) return 'trusted';
    if (npc.rel >= S.tiers.friend) return 'friend';
    return 'acquaintance';
  }

  meet(npc) {
    if (npc.met) return;
    npc.met = true;
    this.sim.memory.remember(npc, 'met_player', { who: 'player' });
    this.sim.bus.emit('social:changed', npc);
  }

  /** Change how this villager sees the player: { f, t, r, c }. */
  adjustPlayer(npc, d) {
    const before = this.tier(npc);
    const pb = this.playerBond(npc);
    if (d.t) pb.t = clamp(pb.t + d.t);
    if (d.r) pb.r = clamp(pb.r + d.r);
    if (d.c) pb.c = Math.max(0, clamp(pb.c + d.c));
    if (d.f) npc.rel = Math.max(0, Math.min(100, Math.round((npc.rel + d.f) * 10) / 10));
    this.announceTier(npc, before);
    this.sim.bus.emit('social:changed', npc);
  }

  addRel(npc, amount) {
    const before = this.tier(npc);
    npc.rel = Math.max(0, Math.min(100, Math.round((npc.rel + amount) * 10) / 10));
    this.announceTier(npc, before);
    this.sim.bus.emit('social:changed', npc);
  }

  announceTier(npc, before) {
    const after = this.tier(npc);
    if (after === before) return;
    const up = TIER_ORDER.indexOf(after) > TIER_ORDER.indexOf(before);
    if (up && (after === 'friend' || after === 'trusted')) {
      this.sim.toast(`toast.rel_${after}`, { npc: npc.id, gender: npc.gender }, 'good');
      this.sim.chronicle(`chronicle.player_${after}`, { npc: npc.id, gender: npc.gender });
    } else if (!up && (after === 'wary' || after === 'hostile')) {
      this.sim.toast(`toast.rel_${after}`, { npc: npc.id, gender: npc.gender }, 'danger');
    }
  }

  relGain(npc, base) {
    return base * Mod.relGainMult(this.sim.state.player) * traitValue(npc.traits, 'relGain');
  }

  canChat(npc) {
    return npc.lastChatDay !== this.sim.time.day;
  }

  chat(npc) {
    if (!this.canChat(npc)) return false;
    npc.lastChatDay = this.sim.time.day;
    npc.social = Math.min(100, (npc.social ?? 60) + 10);
    this.addRel(npc, this.relGain(npc, S.chatGain));
    // Regular, friendly contact slowly builds trust and eases old tension.
    const pb = this.playerBond(npc);
    pb.t = clamp(pb.t + 0.4);
    if (pb.c > 0) pb.c = Math.max(0, pb.c - 1);
    return true;
  }

  canGift(npc) {
    return npc.lastGiftDay !== this.sim.time.day;
  }

  likesItem(npc, itemId) {
    return (GIFT_PREFERENCES[npc.occupation] || []).includes(itemId);
  }

  gift(npc, itemId) {
    if (!this.canGift(npc) || this.sim.inventory.count(itemId) <= 0) return null;
    this.sim.inventory.remove(itemId, 1);
    const liked = this.likesItem(npc, itemId);
    const value = S.giftBase + (ITEMS[itemId]?.basePrice || 0) * S.giftValueFactor;
    const gain = this.relGain(npc, value * (liked ? S.likedGiftMult : 1));
    npc.lastGiftDay = this.sim.time.day;
    this.addRel(npc, gain);
    this.sim.memory.remember(npc, liked ? 'player_loved_gift' : 'player_gift', { who: 'player', params: { item: itemId } });
    return { liked, gain };
  }

  /** Extra pay multiplier from the employer relationship. */
  payBonus(npc) {
    const t = this.tier(npc);
    if (t === 'trusted') return 1 + S.trustedPayBonus;
    if (t === 'friend') return 1 + S.friendPayBonus;
    if (t === 'hostile') return 0.9;
    return 1;
  }

  // ------------------------------------------------------------------ villager ↔ villager

  /** A's view of B, or null if they don't know each other. */
  bond(a, b) {
    const v = a?.relations?.[b?.id];
    return v && typeof v === 'object' ? v : null;
  }

  ensureBond(a, b) {
    let v = this.bond(a, b);
    if (!v) {
      v = { f: 0, t: 0, r: 0, c: 0 };
      a.relations[b.id] = v;
    }
    return v;
  }

  /** Friendship value (−100…100), 0 for strangers. */
  npcRel(a, b) {
    return this.bond(a, b)?.f || 0;
  }

  /** Change A's view of B by { f, t, r, c }. */
  adjust(a, b, d) {
    if (!a || !b || a === b) return;
    const v = this.ensureBond(a, b);
    const beforeF = v.f;
    const beforeType = this.feeling(v);
    if (d.f) v.f = clamp(v.f + d.f);
    if (d.t) v.t = clamp(v.t + d.t);
    if (d.r) v.r = clamp(v.r + d.r);
    if (d.c) v.c = Math.max(0, clamp(v.c + d.c));
    this.checkMilestones(a, b, beforeF, beforeType);
  }

  /** Symmetric friendship change — chatting, working side by side. */
  addNpcRel(a, b, amount) {
    this.adjust(a, b, { f: amount, t: amount * 0.3 });
    this.adjust(b, a, { f: amount, t: amount * 0.3 });
  }

  /** How A feels about B from the numbers alone. */
  feeling(v) {
    if (!v) return 'stranger';
    if (v.f <= -60 || v.c >= 70) return 'enemy';
    if (v.f <= -25 || v.c >= 40) return 'rival';
    if (v.f >= 70) return 'close_friend';
    if (v.f >= S.friendshipThreshold) return 'friend';
    if (v.f < 0) return 'dislike';
    return 'acquaintance';
  }

  /** Friendships and feuds that form become part of village life (and memory). */
  checkMilestones(a, b, beforeF, beforeType) {
    const v = this.bond(a, b);
    const after = this.feeling(v);
    if (after === beforeType) return;
    const kin = this.sim.family.kinship(a, b);
    if (beforeF < S.friendshipThreshold && v.f >= S.friendshipThreshold && !kin) {
      // Only announce once per pair (when the second one crosses over, both are friends).
      if (this.npcRel(b, a) >= S.friendshipThreshold) {
        this.sim.chronicle('chronicle.npc_friends', { npc: a.id, npc2: b.id });
        this.sim.memory.remember(a, 'became_friends', { who: b.id, params: { npc: b.id } });
        this.sim.memory.remember(b, 'became_friends', { who: a.id, params: { npc: a.id } });
      }
    }
    if ((after === 'rival' || after === 'enemy') && beforeType !== 'rival' && beforeType !== 'enemy') {
      this.sim.memory.remember(a, 'fell_out', { who: b.id, params: { npc: b.id } });
      if (after === 'enemy' || this.feeling(this.bond(b, a)) === 'rival') this.sim.chronicle('chronicle.npc_feud', { npc: a.id, npc2: b.id });
    }
  }

  /**
   * Every facet of the relationship, most important first:
   * family ties, work ties (employer, employee, co-worker, competitor), then feelings.
   */
  relTags(a, b) {
    const tags = [];
    const kin = this.sim.family.kinship(a, b);
    if (kin) tags.push(kin);
    const v = this.bond(a, b);
    const feel = this.feeling(v);
    if (feel === 'enemy' || feel === 'rival') tags.push(feel);
    const econ = this.sim.economy;
    const aBiz = a.employer && a.employer !== 'player' ? a.employer : null;
    const bBiz = b.employer && b.employer !== 'player' ? b.employer : null;
    if (aBiz && econ.owner(aBiz)?.id === b.id) tags.push('employer');
    else if (bBiz && econ.owner(bBiz)?.id === a.id) tags.push('employee');
    else if ((a.employer && a.employer === b.employer) || (a.owns && a.owns === b.employer) || (b.owns && b.owns === a.employer)) tags.push('coworker');
    if (a.partners?.includes(b.id)) tags.push('partner');
    if (a.owns && b.owns && econ.sector(a.owns) === econ.sector(b.owns)) tags.push('competitor');
    if (feel === 'close_friend' || feel === 'friend') tags.push(feel);
    if (!tags.length) tags.push(feel);
    return tags;
  }

  relType(a, b) {
    return this.relTags(a, b)[0];
  }

  /** Villager-to-villager relationship label for a friendship value (legacy helper). */
  npcTier(v) {
    return this.feeling(typeof v === 'object' ? v : { f: v, t: 0, r: 0, c: 0 });
  }

  /** The villager this NPC likes most (for visits and gossip). */
  bestFriend(npc) {
    let best = null;
    let bestV = 0;
    for (const [id, v] of Object.entries(npc.relations)) {
      if (v.f > bestV) {
        bestV = v.f;
        best = id;
      }
    }
    return best ? this.sim.npcs.byId(best) : null;
  }

  /** The person this NPC can least stand, if anyone. */
  worstEnemy(npc) {
    let worst = null;
    let worstV = 0;
    for (const [id, v] of Object.entries(npc.relations)) {
      const score = v.c - v.f;
      if ((v.f <= -25 || v.c >= 40) && score > worstV) {
        worstV = score;
        worst = id;
      }
    }
    return worst ? this.sim.npcs.byId(worst) : null;
  }

  /** How many people this villager counts as friends. */
  friendCount(npc) {
    let n = 0;
    for (const v of Object.values(npc.relations)) if (v.f >= S.friendshipThreshold) n++;
    return n;
  }

  // ------------------------------------------------------------------ daily upkeep

  /** Tension fades with time; strangers who never met again are forgotten. */
  onDay() {
    for (const npc of this.sim.state.npcs) {
      for (const [id, v] of Object.entries(npc.relations)) {
        if (v.c > 0) v.c = Math.max(0, Math.round((v.c - 0.8) * 10) / 10);
        if (Math.abs(v.f) < 1 && Math.abs(v.t) < 1 && Math.abs(v.r) < 1 && v.c < 1) delete npc.relations[id];
        else if (!this.sim.npcs.byId(id)) delete npc.relations[id];
      }
      if (npc.pb?.c > 0) npc.pb.c = Math.max(0, Math.round((npc.pb.c - 0.5) * 10) / 10);
    }
  }
}
