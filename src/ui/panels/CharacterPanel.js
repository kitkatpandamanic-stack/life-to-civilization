/**
 * Character — stats, attributes (spend attribute points) and skills (spend skill points).
 */
import { PERKS } from '../../data/perks.js';
import { Panel } from '../Panel.js';
import { t, tn, fmtMoney, npcName } from '../../i18n/i18n.js';
import { escapeHtml, tr } from '../format.js';
import { bar, button, portrait, tabs } from '../widgets.js';
import { learningHtml } from '../education.js';
import { SKILLS, SKILL_CATEGORIES } from '../../data/skills.js';
import { BALANCE } from '../../config/balance.js';
import { Mod } from '../../systems/Modifiers.js';
import { UNLOCKS } from '../../data/unlocks.js';

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
    const tabBar = tabs([['main', t('ui.character')], ['learning', t('inspect.tab_learning')]], this.tab || 'main');
    if (this.tab === 'learning') return tabBar + this.learningPage();
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
          const pending = sim.progression.pendingPerks().filter((x) => x.skill === id);
          const chosen = (p.perks || []).filter((k) => PERKS[k].skill === id);
          const perkHtml =
            pending.map((x) => `<div class="perk-pick">${x.options.map((k) => button(`${t(`perk.${k}.name`)} — ${t(`perk.${k}.desc`)}`, 'perk', { perk: k }, { cls: 'primary' })).join('')}</div>`).join('') +
            chosen.map((k) => `<span class="chip perk-chip" title="${escapeHtml(t(`perk.${k}.desc`))}">✦ ${escapeHtml(t(`perk.${k}.name`))}</span>`).join('');
          return `<div class="skill-row" title="${escapeHtml(t(`skill.${id}.desc`))}">
            <span class="skill-ico">${SKILLS[id].icon}</span>
            <span class="skill-name">${escapeHtml(t(`skill.${id}.name`))}</span>
            <span class="skill-lvl">${s.level}/${BALANCE.progression.maxSkillLevel}</span>
            ${bar(max ? 100 : (s.xp / nxt) * 100, 'skill')}
            ${p.skillPoints > 0 && !max ? button('+', 'skill', { skill: id }, { cls: 'plus' }) : '<span class="plus-spacer"></span>'}
            <div class="skill-desc">${escapeHtml(t(`skill.${id}.desc`))}</div>
          </div>${perkHtml}`;
        })
        .join('')}</div>`;
    }).join('');

    return `${tabBar}
      <div class="char-top">
        ${portrait(`player_g${p.generation || 1}`, p.look, 84)}
        <div class="char-id">
          <div class="char-name">${escapeHtml(npcName(p))}</div>
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
          ${this.renderFamily()}
          <h3>${escapeHtml(t('ui.attributes'))} ${p.attributePoints > 0 ? `<span class="badge">${escapeHtml(t('ui.points_left', { n: p.attributePoints }))}</span>` : ''}</h3>
          ${attrs}
          <h3>${escapeHtml(t('ui.unlocks'))}</h3>
          ${this.renderUnlocks()}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.skills'))} ${p.skillPoints > 0 ? `<span class="badge">${escapeHtml(t('ui.points_left', { n: p.skillPoints }))}</span>` : ''}</h3>
          <div class="muted small">${escapeHtml(t('ui.skills_hint'))} ${escapeHtml(t('ui.perks_hint'))}</div>
          ${sim.progression.pendingPerks().length ? `<div class="warn small">✦ ${escapeHtml(t('ui.perks_waiting', { n: sim.progression.pendingPerks().length }))}</div>` : ''}
          ${skills}
        </div>
      </div>`;
  }

  /** Your spouse, children, your family line — and handing over when you're old. */
  renderFamily() {
    const sim = this.sim;
    const L = sim.lineage;
    const p = sim.state.player;
    const kv = (k, v, id = null) => `<div class="kv${id ? ' clickable' : ''}" ${id ? `data-action="inspect" data-id="${escapeHtml(id)}"` : ''}><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;
    let html = `<h3>${escapeHtml(t('lineage.your_family'))}</h3>`;
    if ((p.generation || 1) > 1) html += kv(t('lineage.generation'), p.generation);
    const spouse = L.spouse();
    const partner = p.partner && sim.npcs.byId(p.partner);
    if (spouse) html += kv(t('kin_my.spouse', { gender: spouse.gender }), npcName(spouse), spouse.id);
    else if (partner) html += kv(t('lineage.courting'), npcName(partner), partner.id);
    else html += `<div class="muted small">${escapeHtml(t('lineage.single_hint'))}</div>`;
    for (const c of L.children()) html += kv(t('kin_my.child', { gender: c.gender }), `${npcName(c)} · ${t('ui.age_n', { age: c.age })}`, c.id);
    for (const id of p.parents || []) {
      const par = sim.family.person(id);
      if (par) html += kv(t('kin_my.parent', { gender: par.gender }), `${npcName(par)}${sim.npcs.byId(id) ? '' : ' †'}`, sim.npcs.byId(id) ? id : null);
    }
    const r = L.canRetire();
    if (this.confirmRetire && r.ok) {
      html += `<p class="desc">${escapeHtml(t('lineage.retire_confirm', { name: npcName(r.heir), gender: r.heir.gender }))}</p>
        <div class="row">${button(t('lineage.retire_yes'), 'retire_yes', {}, { cls: 'primary' })}${button(t('ui.cancel'), 'retire_no')}</div>`;
    } else if (r.ok) html += `<div class="row">${button(t('lineage.retire'), 'retire')}</div>`;
    else if (p.age >= 50) html += `<div class="muted small">${escapeHtml(t(L.heirs().length ? 'lineage.retire_later' : 'lineage.no_heir', { n: 55 }))}</div>`;
    return html;
  }

  /** Progression path: what you've unlocked and what comes next. */
  renderUnlocks() {
    const lvl = this.sim.state.player.level;
    let nextShown = false;
    return UNLOCKS.map((u) => {
      const done = lvl >= u.level;
      const next = !done && !nextShown;
      if (next) nextShown = true;
      return `<div class="unlock-row${done ? ' done' : next ? ' next' : ''}" title="${escapeHtml(t(`unlock.${u.key}.desc`))}"><span>${done ? '✓' : '🔒'} ${escapeHtml(t(`unlock.${u.key}.name`))}</span><span>${escapeHtml(t('ui.level_n', { level: u.level }))}</span></div>`;
    }).join('');
  }

  /** Your schooling, what you're studying now, what you're qualified in, and what you know. */
  learningPage() {
    const sim = this.sim;
    const St = sim.study;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;
    const now = St.status().map((s) => kv(t('learn.now'), tr(sim, `learn.player.${s.key}`, s.params))).join('');
    const quals = (St.e.quals || []).map((q) => t(`learn.qual.${q.how}`, { field: t(`knowledge.${q.field}`) })).join(', ');
    return `<div class="learn-page">${now}${quals ? kv(t('learn.quals'), quals) : ''}${learningHtml(sim, sim.state.player, { isPlayer: true })}<div class="muted small">${escapeHtml(t('learn.player_hint'))}</div></div>`;
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    if (action === 'attr') this.sim.progression.spendAttributePoint(data.attr);
    if (action === 'skill') this.sim.progression.spendSkillPoint(data.skill);
    if (action === 'perk') this.sim.progression.choosePerk(data.perk);
    if (action === 'inspect' && data.id) return this.ui.openInspect(data.id);
    if (action === 'retire') this.confirmRetire = true;
    if (action === 'retire_no') this.confirmRetire = false;
    if (action === 'retire_yes') {
      this.confirmRetire = false;
      this.ui.closePanel();
      this.sim.lineage.succeed('retired');
    }
  }
}
