/**
 * Modifiers — the single place where attributes and skills turn into numbers.
 * If you want to know "what does Strength actually do?", look here.
 */
import { BALANCE } from '../config/balance.js';

export const attr = (p, name) => p.attributes[name] || 0;
export const skill = (p, id) => p.skills[id]?.level || 0;

export const Mod = {
  /** Strength → carrying capacity. */
  carryCapacity(p) {
    return BALANCE.player.baseCarry + attr(p, 'strength') * BALANCE.player.carryPerStrength;
  },

  /** Agility → walking speed. */
  moveSpeed(p) {
    return BALANCE.player.baseMoveSpeed + attr(p, 'agility') * BALANCE.player.moveSpeedPerAgility;
  },

  /** Endurance → slower energy drain. */
  energyDrainMult(p) {
    return Math.max(0.5, 1 - attr(p, 'endurance') * BALANCE.needs.energyDrainReductionPerEndurance);
  },

  /** Intelligence + Learning → more XP from everything. */
  xpMult(p) {
    return 1 + attr(p, 'intelligence') * 0.02 + skill(p, 'learning') * 0.05;
  },

  /** Intelligence + Learning → skills improve faster. */
  skillXpMult(p) {
    return 1 + attr(p, 'intelligence') * 0.06 + skill(p, 'learning') * 0.05;
  },

  /** Physical action speed multiplier (before tool, needs and weather). */
  actionSpeed(p, kind) {
    const str = attr(p, 'strength');
    const agi = attr(p, 'agility');
    switch (kind) {
      case 'chop':
        return 1 + str * 0.04 + skill(p, 'woodcutting') * 0.08 + agi * 0.01;
      case 'mine':
        return 1 + str * 0.04 + skill(p, 'mining') * 0.08 + agi * 0.01;
      case 'harvest':
        return 1 + skill(p, 'farming') * 0.1 + agi * 0.02;
      case 'forage':
        return 1 + skill(p, 'foraging') * 0.1 + agi * 0.02;
      default:
        return 1;
    }
  },

  /** Extra resources from skill. */
  extraYield(p, kind) {
    switch (kind) {
      case 'chop':
        return Math.floor(skill(p, 'woodcutting') / 3);
      case 'mine':
        return Math.floor(skill(p, 'mining') / 4);
      case 'forage':
        return Math.floor(skill(p, 'foraging') / 2);
      case 'harvest':
        return Math.random() < skill(p, 'farming') * 0.05 + attr(p, 'craftsmanship') * 0.01 ? 1 : 0;
      default:
        return 0;
    }
  },

  /** Trading attribute + Trading skill → better buy and sell prices (capped). */
  tradeBonus(p) {
    const e = BALANCE.economy;
    return Math.min(0.35, attr(p, 'trading') * e.tradingPerPoint + skill(p, 'trading') * e.tradingSkillPerLevel);
  },

  /** Negotiation + Charisma (+ Craftsmanship for shift work) → higher pay. */
  payMult(p, jobDef) {
    const j = BALANCE.jobs;
    let m = 1 + skill(p, 'negotiation') * j.negotiationPerLevel + attr(p, 'charisma') * j.charismaPerPoint;
    if (jobDef?.type === 'shift') m += attr(p, 'craftsmanship') * j.craftsmanshipShiftPerPoint;
    return m;
  },

  /** Charisma → relationships grow faster. */
  relGainMult(p) {
    return 1 + attr(p, 'charisma') * BALANCE.social.chatGainPerCharisma;
  },

  /** Leadership → reputation grows faster (people notice reliable leaders). */
  repMult(p) {
    return 1 + attr(p, 'leadership') * BALANCE.reputation.leadershipBonusPerPoint;
  },

  /** Smithing → cheaper tool repairs. */
  repairDiscount(p) {
    return Math.min(0.6, skill(p, 'smithing') * 0.08);
  },
};
