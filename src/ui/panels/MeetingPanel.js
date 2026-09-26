/**
 * The town meeting (TownSystem): the proposal, what it costs and does, how the valley leans — and
 * your say (for, against, or nothing). Past meetings and how they went.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, bar, emptyState } from '../widgets.js';
import { PROPOSALS } from '../../systems/TownSystem.js';

export class MeetingPanel extends Panel {
  get id() {
    return 'meeting';
  }
  title() {
    return `🏛️ ${escapeHtml(t('meeting.title'))}`;
  }

  render() {
    const sim = this.sim;
    const T = sim.town;
    const m = T.S.meeting;
    let html = '';
    if (!m) html += emptyState('🏛️', t('meeting.none'), t(T.statusIndex() >= 1 ? 'meeting.none_text' : 'meeting.not_yet'));
    else {
      const p = PROPOSALS[m.proposal];
      const days = m.day - sim.time.day;
      const sup = T.support();
      html += `<h3>${escapeHtml(t(`proposal.${m.proposal}.name`))}</h3><p>${escapeHtml(t(`proposal.${m.proposal}.desc`))}</p>
        <div class="kv"><span>${escapeHtml(t('meeting.cost'))}</span><b>${escapeHtml(fmtMoney(p.cost))} · ${escapeHtml(t('meeting.treasury', { money: fmtMoney(Math.round(sim.state.village.treasury)) }))}</b></div>
        <div class="kv"><span>${escapeHtml(t('meeting.when'))}</span><b>${escapeHtml(days > 0 ? t('meeting.in_days', { n: days }) : t('meeting.tonight'))}</b></div>
        ${bar(sup * 100, sup >= 0.5 ? 'good' : 'warn', t('meeting.support', { n: Math.round(sup * 100) }))}
        <p class="small muted">${escapeHtml(t('meeting.sway', { n: Math.round(T.sway() * 100) }))}</p>
        <div class="btn-row">
          ${button(t('meeting.for'), 'speak', { side: 'for' }, { cls: `sm ${m.spoke === 'for' ? 'selected' : ''}` })}
          ${button(t('meeting.against'), 'speak', { side: 'against' }, { cls: `sm ${m.spoke === 'against' ? 'selected' : ''}` })}
          ${button(t('meeting.nothing'), 'speak', { side: '' }, { cls: `sm ghost ${!m.spoke ? 'selected' : ''}` })}
        </div>`;
    }
    if (T.S.history.length) {
      html += `<h4>${escapeHtml(t('meeting.past'))}</h4>${T.S.history
        .slice(0, 8)
        .map((h) => `<div class="small">${escapeHtml(t('ui.day_n', { n: h.day }))} · <b>${escapeHtml(t(`proposal.${h.proposal}.name`))}</b> — ${escapeHtml(t(h.passed ? 'meeting.passed' : h.poor ? 'meeting.no_money' : 'meeting.failed', { n: h.support }))}</div>`)
        .join('')}`;
    }
    return html;
  }

  onAction(action, data) {
    if (action !== 'speak') return;
    const r = this.sim.town.speak(data.side || null);
    if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
  }
}
