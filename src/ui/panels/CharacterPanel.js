/**
 * Character — stats, attributes (spend attribute points) and skills (spend skill points).
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { bar, button, portrait } from '../widgets.js';
import { SKILLS, SKILL_CATEGORIES } from '../../data/skills.js';
import { BALANCE } from '../../config/balance.js';
import { Mod } from '../../systems/Modifiers.js';

const ATTRS = ['strength', 'endurance', 'agility', 'intelligence', 'charisma', 'craftsmanship', 'trading', 'leadership'];

export class CharacterPanel extends Panel {
  get id() {
    return 'character';
  }
  title() {
    return `🧑 ${escapeHtml(t('ui.character'))}`;
  }

  render() {
    const sim = this.sim;
    const p = sim.state.player;
    const prog = sim.progression;
    const need = prog.xpForNext();
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;

    const attrs = ATTRS.map(
      (a) => `
      <div class="attr-row" title="${escapeHtml(t(`attr.${a}.desc`))}">
        <span class="attr-name">${escapeHtml(t(`attr.${a}.name`))}</span>
        <span class="attr-val">${p.attributes[a]}</span>
        ${p.attributePoints > 0 ? button('+', 'attr', { attr: a }, { cls: 'plus' }) : ''}
        <span class="attr-desc">${escapeHtml(t(`attr.${a}.desc`))}</span>
      </div>`,
    ).join('');

    const skills = SKILL_CATEGORIES.map((cat) => {
      const ids = Object.keys(SKILLS).filter((s) => SKILLS[s].category === cat);
      if (!ids.length) return '';
      return `<div class="skill-cat"><div class="skill-cat-title">${escapeHtml(t(`skill_cat.${cat}`))}</div>${ids
        .map((id) => {
          const s = p.skills[id];
          const max = s.level >= BALANCE.progression.maxSkillLevel;
          const nxt = prog.skillXpForNext(s.level);
          return `<div class="skill-row" title="${escapeHtml(t(`skill.${id}.desc`))}">
            <span class="skill-ico">${SKILLS[id].icon}</span>
            <span class="skill-name">${escapeHtml(t(`skill.${id}.name`))}</span>
            <span class="skill-lvl">${s.level}/${BALANCE.progression.maxSkillLevel}</span>
            ${bar(max ? 100 : (s.xp / nxt) * 100, 'skill')}
            ${p.skillPoints > 0 && !max ? button('+', 'skill', { skill: id }, { cls: 'plus' }) : '<span class="plus-spacer"></span>'}
            <div class="skill-desc">${escapeHtml(t(`skill.${id}.desc`))}</div>
          </div>`;
        })
        .join('')}</div>`;
    }).join('');

    return `
      <div class="char-top">
        ${portrait('player', p.look, 84)}
        <div class="char-id">
          <div class="char-name">${escapeHtml(p.name)}</div>
          <div class="muted">${escapeHtml(t(`title.${prog.title()}`))} · ${escapeHtml(t('ui.level_n', { level: p.level }))} · ${escapeHtml(t('ui.age_n', { age: p.age }))}</div>
          ${bar((p.xp / need) * 100, 'xp', t('ui.xp_progress', { xp: Math.floor(p.xp), need }))}
        </div>
      </div>
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('ui.stats'))}</h3>
          ${kv(t('stat.health'), Math.round(p.health))}
          ${kv(t('stat.energy'), Math.round(p.energy))}
          ${kv(t('stat.hunger'), Math.round(p.hunger))}
          ${kv(t('stat.comfort'), Math.round(p.comfort))}
          ${kv(t('stat.money'), fmtMoney(p.money))}
          ${kv(t('stat.reputation'), p.reputation)}
          ${kv(t('stat.carry'), `${sim.inventory.weight()} / ${Mod.carryCapacity(p)} ${t('ui.kg')}`)}
          ${kv(t('stat.speed'), Math.round(Mod.moveSpeed(p)))}
          ${kv(t('stat.trade_bonus'), `${Math.round(Mod.tradeBonus(p) * 100)}%`)}
          ${kv(t('stat.jobs_done'), sim.state.stats.jobsCompleted)}
          <h3>${escapeHtml(t('ui.attributes'))} ${p.attributePoints > 0 ? `<span class="badge">${escapeHtml(t('ui.points_left', { n: p.attributePoints }))}</span>` : ''}</h3>
          ${attrs}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.skills'))} ${p.skillPoints > 0 ? `<span class="badge">${escapeHtml(t('ui.points_left', { n: p.skillPoints }))}</span>` : ''}</h3>
          <div class="muted small">${escapeHtml(t('ui.skills_hint'))}</div>
          ${skills}
        </div>
      </div>`;
  }

  onAction(action, data) {
    if (action === 'attr') this.sim.progression.spendAttributePoint(data.attr);
    if (action === 'skill') this.sim.progression.spendSkillPoint(data.skill);
  }
}
