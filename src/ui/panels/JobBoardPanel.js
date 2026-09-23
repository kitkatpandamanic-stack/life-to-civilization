/**
 * Job board — today's work. Opened from the notice board (all jobs),
 * a workplace, or by asking an employer in conversation.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, icon } from '../widgets.js';
import { JOBS } from '../../data/jobs.js';
import { BUSINESSES } from '../../data/businesses.js';

export class JobBoardPanel extends Panel {
  constructor(ui, bizId = null, fromNpc = null) {
    super(ui);
    this.bizId = bizId;
    this.fromNpc = fromNpc;
  }
  get id() {
    return 'jobs';
  }
  title() {
    if (this.bizId) return `🛠️ ${escapeHtml(t('ui.work_at', { place: buildingLabel(this.sim, BUSINESSES[this.bizId].building) }))}`;
    return `📜 ${escapeHtml(t('ui.job_board'))}`;
  }

  describeRequirements(def) {
    const r = def.requires || {};
    const p = this.sim.state.player;
    const out = [];
    const mark = (ok, text) => out.push(`<span class="req ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${escapeHtml(text)}</span>`);
    if (r.level > 1) mark(p.level >= r.level, t('ui.req_level', { level: r.level }));
    if (r.reputation) mark(p.reputation >= r.reputation, t('ui.req_reputation', { value: r.reputation }));
    for (const [a, v] of Object.entries(r.attributes || {})) mark(p.attributes[a] >= v, `${t(`attr.${a}.name`)} ${v}`);
    if (r.tool) mark(!!this.sim.inventory.bestTool(r.tool), t(`ui.req_tool_${r.tool}`));
    return out.join(' ');
  }

  renderJob(jobId) {
    const sim = this.sim;
    const def = JOBS[jobId];
    const check = sim.jobs.check(jobId);
    const active = sim.jobs.active?.jobId === jobId;
    const openings = sim.state.jobs.openings[jobId] || 0;
    const owner = sim.npcs.byId(BUSINESSES[def.employer].owner);
    const what =
      def.type === 'shift'
        ? t('ui.job_shift', { hours: def.durationHours, from: `${def.hours[0]}:00`, to: `${def.hours[1]}:00` })
        : def.type === 'courier'
          ? t('ui.job_courier')
          : t('ui.job_deliver', { qty: def.qty, item: t(`item.${def.item}.name`) });
    const seasonal = def.seasons ? `<span class="chip">${escapeHtml(def.seasons.map((s) => t(`season.${s}`)).join(', '))}</span>` : '';
    return `<div class="job-card${active ? ' active' : ''}${check.ok ? '' : ' unavailable'}">
      <div class="job-top">
        <div class="job-name">${def.item ? icon(def.item, 24) : ''} ${escapeHtml(t(`job.${jobId}.name`))} ${seasonal}</div>
        <div class="job-pay">💰 ${escapeHtml(fmtMoney(sim.jobs.pay(jobId)))} · ⭐ ${def.xp} XP</div>
      </div>
      <div class="desc">${escapeHtml(t(`job.${jobId}.desc`))}</div>
      <div class="muted small">📍 ${escapeHtml(buildingLabel(sim, BUSINESSES[def.employer].building))} · ${escapeHtml(t('ui.employer'))}: ${escapeHtml(npcName(owner))} · ${escapeHtml(what)}</div>
      <div class="job-bottom">
        <div class="reqs">${this.describeRequirements(def)} <span class="muted small">${escapeHtml(t('ui.openings', { n: openings }))}</span></div>
        ${active ? `<span class="badge">${escapeHtml(t('ui.in_progress'))}</span>` : button(t('ui.accept'), 'accept', { job: jobId }, { disabled: !check.ok, cls: 'primary', title: check.ok ? '' : tr(sim, `reason.${check.reason}`, check.params || {}) })}
      </div>
      ${!check.ok && !active ? `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>` : ''}
    </div>`;
  }

  render() {
    const sim = this.sim;
    const ids = Object.keys(JOBS).filter((id) => !this.bizId || JOBS[id].employer === this.bizId);
    let html = ids.map((id) => this.renderJob(id)).join('');
    if (!this.bizId) {
      const reqs = sim.state.jobs.requests.filter((r) => !r.accepted);
      if (reqs.length) {
        html += `<h3>${escapeHtml(t('ui.villagers_need'))}</h3>`;
        html += reqs.map((r) => `<div class="rumor">🗣️ ${escapeHtml(tr(sim, 'ui.request_rumor', { npc: r.npcId, qty: r.qty, item: r.item }))}</div>`).join('');
      }
    }
    html += `<div class="muted small">${escapeHtml(t('ui.jobs_hint'))}</div>`;
    if (this.fromNpc) html += `<div class="btn-row">${button(t('dialog.opt.back'), 'back_dialogue')}</div>`;
    return html;
  }

  onAction(action, data) {
    if (action === 'accept') {
      if (this.sim.jobs.accept(data.job)) this.ui.closePanel();
    } else if (action === 'back_dialogue') {
      this.ui.openDialogue(this.fromNpc);
    }
  }
}
