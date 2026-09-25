/**
 * The research institute (AcademiaSystem): what it's working on, how it's
 * going and why, who works there, and what it has found so far.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, agoText } from '../format.js';
import { bar, button } from '../widgets.js';
import { PROJECTS, POSTS } from '../../data/academia.js';
import { TECHS } from '../../data/tech.js';
import { STUDY_PLAYER } from '../../data/study.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export class InstitutePanel extends Panel {
  constructor(ui, buildingId) {
    super(ui);
    this.buildingId = buildingId;
  }
  get id() {
    return 'institute';
  }
  get inst() {
    return this.sim.academia.institutes().find((i) => i.id === this.buildingId) || null;
  }
  title() {
    return `🔬 ${escapeHtml(buildingLabel(this.sim, this.buildingId))}`;
  }

  render() {
    const sim = this.sim;
    const A = sim.academia;
    const inst = this.inst;
    if (!inst) return `<div class="muted">${escapeHtml(t('institute.not_open'))}</div>`;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const lines = [`<div class="muted small">${escapeHtml(t('institute.desc'))}</div>`];
    lines.push(kv(t('school.founded'), escapeHtml(agoText(sim.time.day - (inst.founded ?? sim.time.day)))));
    // The work in hand.
    lines.push(`<h3>${escapeHtml(t('institute.project'))}</h3>`);
    if (inst.project) {
      const P = PROJECTS[inst.project];
      lines.push(kv(t('institute.working_on'), `${TECHS[inst.project]?.icon || ''} ${escapeHtml(t(`tech.${inst.project}.name`))}`));
      lines.push(`<div class="muted small">${escapeHtml(t(`tech.${inst.project}.desc`))}</div>`);
      lines.push(`<div class="need-row"><span>${escapeHtml(t('institute.progress'))}</span>${bar((inst.progress / P.cost) * 100, 'xp', `${Math.floor(inst.progress)} / ${P.cost}`)}</div>`);
      lines.push(kv(t('institute.needs'), escapeHtml(Object.entries(P.fields).map(([f, v]) => `${t(`knowledge.${f}`)} ${v}`).join(', ') + ` · ${t('institute.team_of', { n: P.researchers })}`)));
      const q = A.quality(inst);
      lines.push(`<h3>${escapeHtml(t('institute.chances'))} — ${pct(Math.min(1.5, q.total))}</h3>`);
      const f = (key, v) => `<div class="need-row"><span>${escapeHtml(t(`institute.q.${key}`))}</span>${bar(Math.min(100, v * 70), v < 0.9 ? 'warn' : 'good', pct(v))}</div>`;
      lines.push(f('knowledge', q.knowledge));
      lines.push(f('team', q.team));
      lines.push(f('equipment', q.equipment));
      lines.push(f('funding', q.funding));
      lines.push(kv(t('institute.running_cost'), escapeHtml(t('institute.per_week', { money: fmtMoney(P.funding) }))));
      if (inst.unfunded) lines.push(`<div class="warn small">${escapeHtml(t('institute.unfunded', { n: inst.unfunded }))}</div>`);
    } else {
      const next = A.possible();
      lines.push(`<div class="muted small">${escapeHtml(A.researchers().length ? (next.length ? t('institute.choosing', { list: next.map((id) => t(`tech.${id}.name`)).join(', ') }) : t('institute.nothing_to_do')) : t('institute.no_researchers'))}</div>`);
    }
    // The people.
    lines.push(`<h3>${escapeHtml(t('institute.researchers'))}</h3>`);
    const team = A.researchers();
    if (!team.length) lines.push(`<div class="muted small">${escapeHtml(t('institute.none', { n: POSTS.researcher.min }))}</div>`);
    for (const n of team) {
      const fields = ['science', 'engineering', 'medicine', 'architecture', 'maths'].map((fl) => [fl, sim.education.know(n, fl)]).filter(([, v]) => v >= 20).map(([fl, v]) => `${t(`knowledge.${fl}`)} ${Math.round(v)}`).join(' · ');
      lines.push(`<div class="teacher-card"><b><span class="clickable" data-action="inspect" data-id="${n.id}">${escapeHtml(npcName(n))}</span></b>${(n.fame || 0) >= 50 ? ' ⭐' : ''} <span class="muted small">${escapeHtml(t('institute.days', { n: n.post.days }))}</span><div class="muted small">${escapeHtml(fields)}</div><div class="btn-row">${button(t('dialog.opt.talk_instead'), 'talk', { id: n.id })}</div></div>`);
    }
    // What it has found.
    if (inst.done?.length) {
      lines.push(`<h3>${escapeHtml(t('institute.record'))}</h3>`);
      for (const d of inst.done.slice(-8).reverse()) {
        lines.push(kv(`${escapeHtml(t(`tech.${d.tech}.name`))}`, escapeHtml(`${t(`institute.result.${d.result}`)} · ${agoText(sim.time.day - d.day)}`)));
      }
    }
    // You: fund the work; having given, you may say what comes next.
    lines.push(`<h3>${escapeHtml(t('school.you'))}</h3>`);
    const p = sim.state.player;
    lines.push(`<div class="btn-row">${button(t('institute.fund', { money: fmtMoney(STUDY_PLAYER.researchGift) }), 'fund', {}, { disabled: p.money < STUDY_PLAYER.researchGift })}</div>`);
    if (inst.endowment > 0) lines.push(`<div class="muted small">${escapeHtml(t('institute.endowment_left', { money: fmtMoney(Math.floor(inst.endowment)) }))}</div>`);
    if (inst.gifts > 0 && !inst.project) {
      const opts = A.possible().map((id) => button(t(`tech.${id}.name`), 'choose', { id }, { cls: inst.nextChoice === id ? 'primary' : '' })).join('');
      if (opts) lines.push(`<div class="muted small">${escapeHtml(t('institute.you_choose'))}</div><div class="btn-row">${opts}</div>`);
    }
    lines.push(`<div class="muted small">${escapeHtml(t('institute.hint'))}</div>`);
    return lines.join('');
  }

  onAction(action, data) {
    if (action === 'fund') this.sim.study.fundResearch(this.buildingId);
    if (action === 'choose' && data.id) this.sim.study.chooseProject(this.buildingId, data.id);
    if (action === 'inspect' && data.id) this.ui.openInspect(data.id, 'learning');
    if (action === 'talk' && data.id) this.ui.openDialogue(data.id);
  }
}
