/**
 * Workers — your employees: what they're doing, how productive and satisfied
 * they are, their pay, their assignment, promotion and firing.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, npcRole } from '../format.js';
import { bar, button, portrait } from '../widgets.js';

const ASSIGNMENTS = ['idle', 'gather_wood', 'gather_stone', 'build', 'farm', 'workshop'];

export class WorkersPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.confirmFire = null;
  }
  get id() {
    return 'workers';
  }
  title() {
    return `👷 ${escapeHtml(t('ui.workers'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  render() {
    const sim = this.sim;
    const W = sim.workers;
    const list = W.list();
    const payroll = list.reduce((s, c) => s + c.salary, 0);
    let html = `<div class="kv"><span>${escapeHtml(t('ui.team'))}</span><b>${list.length} / ${W.maxWorkers()}</b></div>
      <div class="kv"><span>${escapeHtml(t('ui.payroll'))}</span><b>${fmtMoney(payroll)} ${escapeHtml(t('ui.per_day'))}</b></div>
      <div class="kv"><span>${escapeHtml(t('ui.team_bonus'))}</span><b>+${Math.round((W.teamBonus() - 1) * 100)}%</b></div>`;
    if (!list.length) {
      html += `<div class="rumor">${escapeHtml(t(sim.progression.hasUnlock('hire_worker') ? 'ui.no_workers' : 'ui.workers_locked', { level: sim.progression.unlockLevel('hire_worker') }))}</div>`;
    }
    for (const c of list) {
      const npc = sim.npcs.byId(c.npcId);
      if (!npc) continue;
      const act = sim.npcs.activity(npc);
      const prod = Math.round(W.productivity(c.npcId) * 100);
      const expected = W.expectedSalary(npc, c.rank);
      const promo = W.canPromote(c.npcId);
      const sites = sim.construction.playerSites();
      const assignBtns = ASSIGNMENTS.map((a) => {
        const disabled = (a === 'build' && !sites.length) || (a === 'farm' && !Object.keys(sim.state.fields).length) || (a === 'workshop' && !sim.businesses.list().length);
        return button(t(`assignment.${a}`), 'assign', { npc: c.npcId, a }, { cls: c.assignment.type === a ? 'primary' : '', disabled });
      }).join('');
      const siteLine = c.assignment.type === 'build' && c.assignment.siteId ? ` · ${escapeHtml(t(`buildable.${sim.construction.byId(c.assignment.siteId)?.type || 'small_house'}.name`))}` : '';
      html += `<div class="worker-card">
        <div class="worker-head">
          ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 56)}
          <div class="worker-id">
            <b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(npcRole(sim, npc))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))}</span>
            <div class="small">▶ ${escapeHtml(tr(sim, `activity.${act.key}`, { gender: npc.gender, ...act.params }))}${siteLine}</div>
            <div class="worker-stats">
              <span>${escapeHtml(t('ui.productivity'))} <b>${prod}%</b></span>
              <span>${escapeHtml(t('ui.satisfaction'))}</span>${bar(c.satisfaction, c.satisfaction < 35 ? 'warn' : '', String(c.satisfaction))}
            </div>
            <div class="worker-stats small muted">${escapeHtml(t('stat.hunger'))} ${Math.round(npc.hunger)} · ${escapeHtml(t('stat.energy'))} ${Math.round(npc.energy)} · ${escapeHtml(t('stat.health'))} ${Math.round(npc.health)} · ${escapeHtml(t('ui.days_worked', { n: c.daysWorked }))}</div>
          </div>
          <div class="worker-pay">
            <div><b>${fmtMoney(c.salary)}</b> ${escapeHtml(t('ui.per_day'))}</div>
            <div class="muted small">${escapeHtml(t('ui.expects', { money: fmtMoney(expected) }))}</div>
            <div class="btn-row">${button('−', 'salary', { npc: c.npcId, d: -1 })}${button('+', 'salary', { npc: c.npcId, d: 1 })}</div>
          </div>
        </div>
        <div class="assign-row"><span class="muted small">${escapeHtml(t('ui.assignment'))}:</span> ${assignBtns}</div>
        <div class="btn-row">
          ${button(promo.ok ? t('ui.promote_to', { rank: t(`worker_rank.${promo.next}`, { gender: npc.gender }) }) : t('ui.promote'), 'promote', { npc: c.npcId }, { disabled: !promo.ok, title: promo.ok ? '' : tr(sim, `reason.${promo.reason || 'max_rank'}`, promo.params || {}) })}
          ${this.confirmFire === c.npcId ? `${escapeHtml(t('ui.fire_confirm'))} ${button(t('ui.yes'), 'fire_yes', { npc: c.npcId }, { cls: 'danger' })} ${button(t('ui.no'), 'fire_no')}` : button(t('ui.fire'), 'fire', { npc: c.npcId })}
        </div>
      </div>`;
    }
    html += `<div class="muted small">${escapeHtml(t('ui.workers_hint'))}</div>`;
    return html;
  }

  onAction(action, data) {
    const W = this.sim.workers;
    if (action === 'assign') {
      const a = { type: data.a };
      if (data.a === 'build') a.siteId = this.sim.construction.playerSites()[0]?.id;
      if (data.a === 'workshop') a.bizId = this.sim.businesses.list()[0]?.id;
      W.assign(data.npc, a);
    } else if (action === 'salary') {
      const c = W.contract(data.npc);
      if (c) W.setSalary(data.npc, c.salary + Number(data.d));
    } else if (action === 'promote') W.promote(data.npc);
    else if (action === 'fire') this.confirmFire = data.npc;
    else if (action === 'fire_no') this.confirmFire = null;
    else if (action === 'fire_yes') {
      this.confirmFire = null;
      W.fire(data.npc);
    }
  }
}
