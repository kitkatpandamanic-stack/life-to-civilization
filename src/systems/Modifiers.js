/**
 * Modifiers — the single place where attributes and skills turn into numbers.
 * If you want to know "what does Strength actually do?", look here.
 */
import { BALANCE } from '../config/balance.js';
import { rand } from '../core/rng.js';
import { PERKS } from '../data/perks.js';
import { ITEMS } from '../data/items.js';
import { Q } from '../data/quality.js';

export const attr = (p, name) => p.attributes[name] || 0;
export const skill = (p, id) => p.skills[id]?.level || 0;

/** Sum of a perk effect over the perks the player has chosen (0 if none). */
export function perk(p, key) {
  let v = 0;
  for (const id of p.perks || []) v += PERKS[id]?.effects[key] || 0;
  return v;
}

export const Mod = {
  perk,

  /** Strength (and the Hauler perk) → carrying capacity. */
  carryCapacity(p) {
    return BALANCE.player.baseCarry + attr(p, 'strength') * BALANCE.player.carryPerStrength + perk(p, 'carry');
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
    const bonus = 1 + perk(p, `${kind}_speed`);
    switch (kind) {
      case 'chop':
        return (1 + str * 0.04 + skill(p, 'woodcutting') * 0.08 + agi * 0.01) * bonus;
      case 'mine':
        return (1 + str * 0.04 + skill(p, 'mining') * 0.08 + agi * 0.01) * bonus;
      case 'harvest':
        return (1 + skill(p, 'farming') * 0.1 + agi * 0.02) * bonus;
      case 'forage':
        return 1 + skill(p, 'foraging') * 0.1 + agi * 0.02;
      default:
        return 1;
    }
  },

  /** Extra resources from skill (and perks). */
  extraYield(p, kind) {
    return this.skillYield(p, kind) + perk(p, `${kind}_yield`);
  },

  skillYield(p, kind) {
    switch (kind) {
      case 'chop':
        return Math.floor(skill(p, 'woodcutting') / 3);
      case 'mine':
        return Math.floor(skill(p, 'mining') / 4);
      case 'forage':
        return Math.floor(skill(p, 'foraging') / 2);
      case 'harvest':
        return rand.float() < skill(p, 'farming') * 0.05 + attr(p, 'craftsmanship') * 0.01 ? 1 : 0;
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

  /** Carpentry (or the recipe's skill) + Craftsmanship + Intelligence → faster crafting. */
  craftSpeed(p, skillId = 'carpentry') {
    return (1 + skill(p, skillId) * 0.08 + attr(p, 'craftsmanship') * 0.04 + attr(p, 'intelligence') * 0.01) * (1 + perk(p, `craft_speed_${skillId}`));
  },

  /** Construction + Craftsmanship + Strength → faster building. */
  buildSpeed(p) {
    return (1 + skill(p, 'construction') * 0.08 + attr(p, 'craftsmanship') * 0.04 + attr(p, 'strength') * 0.02) * (1 + perk(p, 'build_speed'));
  },

  /** Farming speed (tilling, planting, watering). */
  farmSpeed(p) {
    return 1 + skill(p, 'farming') * 0.08 + attr(p, 'agility') * 0.02 + attr(p, 'endurance') * 0.01;
  },

  /** Leadership (attribute + skill) → how many workers you can manage. */
  maxWorkers(p, extraSlots = 0) {
    return 1 + Math.floor((attr(p, 'leadership') + skill(p, 'leadership')) / 3) + extraSlots + perk(p, 'worker_slots');
  },

  /** Leadership → your whole team works a bit better. */
  teamBonus(p) {
    return 1 + skill(p, 'leadership') * 0.03 + attr(p, 'leadership') * 0.01 + perk(p, 'team_bonus');
  },

  /** Charisma + Negotiation → workers accept lower salaries. */
  wageDiscount(p) {
    return Math.min(0.3, attr(p, 'charisma') * 0.015 + skill(p, 'negotiation') * 0.02);
  },

  /** Smithing → cheaper tool repairs. */
  repairDiscount(p) {
    return Math.min(0.75, skill(p, 'smithing') * 0.08 + perk(p, 'repair_discount'));
  },

  /** Extra discount when buying (Negotiator). */
  buyBonus(p) {
    return perk(p, 'buy_discount');
  },

  /** Extra when selling: Merchant for everything, plus perks for particular goods or kinds of goods. */
  sellBonus(p, item) {
    return perk(p, 'sell_bonus') + perk(p, `sell_${item}`) + perk(p, `sell_${ITEMS[item]?.category}`);
  },

  /** What a meal restores: better cooking, more nourishment (and Home Cook). */
  meal(p, food, q) {
    const m = Q(q).food * (1 + perk(p, 'food_restore'));
    const out = {};
    for (const [k, v] of Object.entries(food)) out[k] = k === 'hunger' || k === 'energy' || k === 'health' ? v * m : v;
    return out;
  },

  /** Construction materials needed for your own buildings (Frugal Builder, Architect). */
  materialFactor(p) {
    return Math.max(0.5, 1 - perk(p, 'build_materials'));
  },
};
