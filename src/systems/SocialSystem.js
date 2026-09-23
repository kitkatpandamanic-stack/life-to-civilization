/**
 * SocialSystem — relationships between the player and villagers,
 * and between villagers themselves.
 *
 * Player relationship tiers: stranger → acquaintance → friend → trusted.
 * Friends give discounts and pay a little more for your work.
 */
import { BALANCE } from '../config/balance.js';
import { ITEMS } from '../data/items.js';
import { GIFT_PREFERENCES } from '../data/npcs.js';
import { traitValue } from '../data/traits.js';
import { Mod } from './Modifiers.js';

const S = BALANCE.social;
const TIER_ORDER = ['stranger', 'acquaintance', 'friend', 'trusted'];

export class SocialSystem {
  constructor(sim) {
    this.sim = sim;
  }

  tier(npc) {
    if (!npc?.met) return 'stranger';
    if (npc.rel >= S.tiers.trusted) return 'trusted';
    if (npc.rel >= S.tiers.friend) return 'friend';
    return 'acquaintance';
  }

  meet(npc) {
    if (npc.met) return;
    npc.met = true;
    this.sim.bus.emit('social:changed', npc);
  }

  addRel(npc, amount) {
    const before = this.tier(npc);
    npc.rel = Math.max(0, Math.min(100, Math.round((npc.rel + amount) * 10) / 10));
    const after = this.tier(npc);
    if (TIER_ORDER.indexOf(after) > TIER_ORDER.indexOf(before) && (after === 'friend' || after === 'trusted')) {
      this.sim.toast(`toast.rel_${after}`, { npc: npc.id, gender: npc.gender }, 'good');
      this.sim.chronicle(`chronicle.player_${after}`, { npc: npc.id, gender: npc.gender });
    }
    this.sim.bus.emit('social:changed', npc);
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
    this.addRel(npc, this.relGain(npc, S.chatGain));
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
    return { liked, gain };
  }

  /** Extra pay multiplier from the employer relationship. */
  payBonus(npc) {
    const t = this.tier(npc);
    if (t === 'trusted') return 1 + S.trustedPayBonus;
    if (t === 'friend') return 1 + S.friendPayBonus;
    return 1;
  }

  // ---------- NPC ↔ NPC ----------

  npcRel(a, b) {
    return a.relations[b.id] || 0;
  }

  addNpcRel(a, b, amount) {
    const before = this.npcRel(a, b);
    const v = Math.max(0, Math.min(100, before + amount));
    a.relations[b.id] = v;
    b.relations[a.id] = v;
    if (before < S.friendshipThreshold && v >= S.friendshipThreshold && !a.family.includes(b.id)) {
      this.sim.chronicle('chronicle.npc_friends', { npc: a.id, npc2: b.id });
    }
  }

  /** The villager this NPC likes most (for visits and gossip). */
  bestFriend(npc) {
    let best = null;
    let bestV = 0;
    for (const [id, v] of Object.entries(npc.relations)) {
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    return best ? this.sim.npcs.byId(best) : null;
  }
}
