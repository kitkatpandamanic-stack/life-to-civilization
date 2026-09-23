/**
 * ProgressionSystem — XP, levels, attributes and skills.
 *
 * Levels are not cosmetic: each level grants attribute and skill points,
 * and higher-level jobs require a minimum level (see data/jobs.js).
 */
import { BALANCE } from '../config/balance.js';
import { JOBS } from '../data/jobs.js';
import { SKILLS } from '../data/skills.js';
import { Mod } from './Modifiers.js';

const PR = BALANCE.progression;

export class ProgressionSystem {
  constructor(sim) {
    this.sim = sim;
  }

  get p() {
    return this.sim.state.player;
  }

  xpForNext(level = this.p.level) {
    return Math.round(PR.xpBase * Math.pow(level, PR.xpExponent));
  }

  skillXpForNext(level) {
    return Math.round(PR.skillXpBase * Math.pow(level + 1, PR.skillXpExponent));
  }

  title(level = this.p.level) {
    let key = PR.titles[0].key;
    for (const tt of PR.titles) if (level >= tt.level) key = tt.key;
    return key;
  }

  addXp(amount) {
    const p = this.p;
    const gained = Math.max(1, Math.round(amount * Mod.xpMult(p)));
    p.xp += gained;
    this.sim.bus.emit('player:xp', gained);
    while (p.xp >= this.xpForNext(p.level)) {
      p.xp -= this.xpForNext(p.level);
      p.level++;
      p.attributePoints += PR.attributePointsPerLevel;
      p.skillPoints += PR.skillPointsPerLevel;
      p.energy = Math.min(100, p.energy + PR.levelUpEnergy);
      const newJobs = Object.entries(JOBS)
        .filter(([, d]) => (d.requires?.level || 1) === p.level)
        .map(([id]) => id);
      const oldTitle = this.title(p.level - 1);
      const newTitle = this.title(p.level);
      this.sim.bus.emit('player:levelup', { level: p.level, newJobs, newTitle: newTitle !== oldTitle ? newTitle : null });
      this.sim.chronicle('chronicle.player_level', { level: p.level });
    }
    return gained;
  }

  addSkillXp(skillId, amount) {
    const s = this.p.skills[skillId];
    if (!s || s.level >= PR.maxSkillLevel) return;
    s.xp += Math.max(1, Math.round(amount * Mod.skillXpMult(this.p)));
    while (s.level < PR.maxSkillLevel && s.xp >= this.skillXpForNext(s.level)) {
      s.xp -= this.skillXpForNext(s.level);
      s.level++;
      this.sim.bus.emit('player:skillup', { skill: skillId, level: s.level });
      this.sim.toast('toast.skill_up', { skill: skillId, level: s.level }, 'good');
    }
    if (s.level >= PR.maxSkillLevel) s.xp = 0;
  }

  spendAttributePoint(attrName) {
    const p = this.p;
    if (p.attributePoints <= 0 || !(attrName in p.attributes)) return false;
    if (p.attributes[attrName] >= BALANCE.player.maxAttribute) return false;
    p.attributes[attrName]++;
    p.attributePoints--;
    this.sim.bus.emit('player:changed');
    return true;
  }

  spendSkillPoint(skillId) {
    const p = this.p;
    const s = p.skills[skillId];
    if (p.skillPoints <= 0 || !s || !SKILLS[skillId] || s.level >= PR.maxSkillLevel) return false;
    s.level++;
    s.xp = 0;
    p.skillPoints--;
    this.sim.bus.emit('player:skillup', { skill: skillId, level: s.level });
    this.sim.bus.emit('player:changed');
    return true;
  }

  addReputation(amount) {
    const p = this.p;
    const v = amount > 0 ? amount * Mod.repMult(p) : amount;
    p.reputation = Math.round((p.reputation + v) * 10) / 10;
    this.sim.bus.emit('player:changed');
  }
}
