/**
 * Workers — your employees: what each is doing and what's next, how good they are at
 * what, their needs, pay and mood; their focus and work priorities; what's queued for
 * them; promotion and firing. And the team's rules (may they buy materials, and how much).
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, npcRole, buildingLabel, districtLabel } from '../format.js';
import { bar, button, portrait, emptyState, status, stat, statGrid } from '../widgets.js';
import { JOB_CATS, PRIORITIES, WORKFORCE } from '../../data/workforce.js';

const ASSIGNMENTS = ['idle', 'gather_wood', 'gather_stone', 'build', 'farm', 'workshop'];
/** How each state looks: a word, a colour and an icon (never colour alone). */
const STATE_LOOK = {
  working: ['good', '🔨'],
  moving: ['info', '🚶'],
  seeking: ['info', '🔎'],
  waiting: ['warn', '⏳'],
  need_materials: ['warn', '📦'],
  resting: ['neutral', '🛋️'],
  eating: ['neutral', '🍲'],
  returning_home: ['neutral', '🏠'],
  sleeping: ['neutral', '💤'],
  unavailable: ['danger', '🤒'],
  failed: ['danger', '⚠️'],
  idle: ['neutral', '•'],
};

export class WorkersPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.confirmFire = null;
    this.open = null; // the worker whose priorities are shown
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

  /** "Building: Stepan's house", "Buying planks", "Chopping wood"… */
  taskText(c) {
    const sim = this.sim;
    const t0 = c.task;
    if (!t0) return null;
    const siteName = (id) => {
      const s = sim.construction.byId(id);
      if (!s) return '';
      return s.kind === 'works' ? buildingLabel(sim, s.target) : t(`buildable.${s.type}.name`);
    };
    const params = { what: t0.kind === 'build' || t0.kind === 'haul' || t0.kind === 'buy' ? siteName(t0.target) : '', building: ['repair', 'crepair', 'chaul'].includes(t0.kind) ? t0.target : undefined, item: t0.item };
    return tr(sim, `wtask.${t0.kind}`, params);
  }

  /** What they'd do next: the best of what's on offer after this. */
  nextText(npc, c) {
    const list = this.sim.workers.candidates(npc, c).filter((x) => x.key !== c.task?.key).slice(0, 2);
    return [...new Set(list.map((x) => this.taskText({ task: { kind: x.kind, target: x.target, item: x.item } })))].join(' · ');
  }

  render() {
    const sim = this.sim;
    const W = sim.workers;
    const list = W.list();
    const payroll = list.reduce((s, c) => s + c.salary, 0);
    const S = W.state;
    const working = list.filter((c) => c.state === 'working' || c.state === 'moving').length;
    let html = statGrid([
      stat(t('ui.team'), `${list.length} / ${W.maxWorkers()}`),
      stat(t('workers.at_work'), String(working)),
      stat(t('ui.payroll'), `${fmtMoney(payroll)}<span class="muted small"> ${escapeHtml(t('ui.per_day'))}</span>`),
      stat(t('ui.team_bonus'), `+${Math.round((W.teamBonus() - 1) * 100)}%`),
    ]);
    // The team's rules: may they buy missing materials with your money, and up to how much a day.
    html += `<div class="setting-row"><div><b>${escapeHtml(t('workers.buy_title'))}</b><div class="hint">${escapeHtml(t('workers.buy_hint', { money: fmtMoney(W.buyBudgetLeft()) }))}</div></div>
      <div class="btn-row">${button(t(S.buy !== false ? 'workers.buy_on' : 'workers.buy_off'), 'buy_toggle', {}, { cls: S.buy !== false ? 'selected sm' : 'ghost sm' })}
      ${button('−', 'budget', { d: -50 }, { cls: 'sm ghost' })}<b class="num">${fmtMoney(S.budget ?? WORKFORCE.buyBudgetPerDay)}</b>${button('+', 'budget', { d: 50 }, { cls: 'sm ghost' })}</div></div>`;
    if (!list.length) {
      html += emptyState('👷', t('ui.no_workers_title'), t(sim.progression.hasUnlock('hire_worker') ? 'ui.no_workers' : 'ui.workers_locked', { level: sim.progression.unlockLevel('hire_worker') }));
    }
    for (const c of list) {
      const npc = sim.npcs.byId(c.npcId);
      if (!npc) continue;
      W.settings(c);
      const prof = W.profile(npc);
      const [kind, ico] = STATE_LOOK[c.state] || STATE_LOOK.idle;
      const task = this.taskText(c);
      const next = c.state === 'working' || c.state === 'moving' ? this.nextText(npc, c) : '';
      const where = sim.growth.districtAt(Math.floor(npc.x / 32), Math.floor(npc.y / 32));
      const job = sim.contracts.jobOf(c.npcId);
      const prod = Math.round(W.productivity(c.npcId) * 100);
      const expected = W.expectedSalary(npc, c.rank);
      const promo = W.canPromote(c.npcId);
      const sites = sim.construction.playerSites();
      const assignBtns = ASSIGNMENTS.map((a) => {
        const disabled = (a === 'build' && !sites.length) || (a === 'farm' && !Object.keys(sim.state.fields).length) || (a === 'workshop' && !sim.businesses.list().length);
        return button(t(`assignment.${a}`), 'assign', { npc: c.npcId, a }, { cls: `sm ${c.assignment.type === a ? 'selected' : 'ghost'}`, disabled });
      }).join('');
      const skills = prof.skills.map((s) => `<div class="aff-row"><span>${escapeHtml(cap(t(`knowledge.${s.field}`)))}</span>${bar(s.v, 'skill')}<b>${s.v}</b></div>`).join('');
      const queue = c.queue.map((id) => (sim.construction.byId(id) ? (sim.construction.byId(id).kind === 'works' ? buildingLabel(sim, sim.construction.byId(id).target) : t(`buildable.${sim.construction.byId(id).type}.name`)) : buildingLabel(sim, id))).join(' → ');
      const prios = this.open === c.npcId
        ? `<div class="card" style="margin-top:8px"><div class="stat-label">${escapeHtml(t('workers.priorities'))}</div>${JOB_CATS.map((cat) => `<div class="setting-row"><span>${escapeHtml(t(`jobcat.${cat}`))}</span><div class="btn-row">${PRIORITIES.map((p) => button(t(`prio.${p}`), 'prio', { npc: c.npcId, cat, p }, { cls: `sm ${c.jobs[cat] === p ? 'selected' : 'ghost'}` })).join('')}</div></div>`).join('')}
           ${sites.length ? `<div class="btn-row"><span class="hint">${escapeHtml(t('workers.queue_add'))}</span>${sites.map((s) => button(s.kind === 'works' ? buildingLabel(sim, s.target) : t(`buildable.${s.type}.name`), 'enqueue', { npc: c.npcId, id: s.id }, { cls: 'sm ghost', disabled: c.queue.includes(s.id) })).join('')}</div>` : ''}</div>`
        : '';
      html += `<div class="worker-card">
        <div class="worker-head">
          ${portrait(`npc_${sim.state.seed}_${npc.id}`, npc.look, 56)}
          <div class="worker-id">
            <b>${escapeHtml(npcName(npc))}</b> <span class="muted small">${escapeHtml(t(`profession.${prof.profession}`))} · ${escapeHtml(t('ui.level_n', { level: npc.level }))}</span>
            <div style="margin:3px 0">${status(t(`wstate.${c.state}`), kind, ico)}${task ? ` <span class="small">${escapeHtml(task)}</span>` : ''}</div>
            ${next ? `<div class="hint">${escapeHtml(t('workers.next', { list: next }))}</div>` : ''}
            ${job ? `<div class="hint">📜 ${escapeHtml(tr(sim, 'workers.on_contract', { kind: t(`contract.kind.${job.kind}`), npc: job.issuer !== 'village' ? job.issuer : undefined, building: job.building }))} ${button(t('workers.off_contract'), 'off_contract', { npc: c.npcId, id: job.id }, { cls: 'sm ghost' })}</div>` : ''}
            ${where ? `<div class="hint">📍 ${escapeHtml(districtLabel(where))}</div>` : ''}
            <div class="worker-stats small muted">${escapeHtml(t('stat.energy'))} ${Math.round(npc.energy)} · ${escapeHtml(t('stat.hunger'))} ${Math.round(npc.hunger)} · ${escapeHtml(t('stat.health'))} ${Math.round(npc.health)} · ${escapeHtml(t('workers.done_n', { n: c.stats.done }))}</div>
          </div>
          <div class="worker-pay">
            <div><b>${fmtMoney(c.salary)}</b> ${escapeHtml(t('ui.per_day'))}</div>
            <div class="muted small">${escapeHtml(t('ui.expects', { money: fmtMoney(expected) }))}</div>
            <div class="btn-row">${button('−', 'salary', { npc: c.npcId, d: -1 }, { cls: 'sm ghost' })}${button('+', 'salary', { npc: c.npcId, d: 1 }, { cls: 'sm ghost' })}</div>
          </div>
        </div>
        <div class="char-cols" style="margin-top:6px">
          <div class="col">${skills}</div>
          <div class="col">
            <div class="aff-row"><span>${escapeHtml(t('ui.productivity'))}</span>${bar(Math.min(100, prod / 1.5), prod < 70 ? 'warn' : 'good')}<b>${prod}%</b></div>
            <div class="aff-row"><span>${escapeHtml(t('ui.satisfaction'))}</span>${bar(c.satisfaction, c.satisfaction < 35 ? 'warn' : 'good')}<b>${c.satisfaction}</b></div>
            <div class="aff-row"><span>${escapeHtml(t('workers.reliability'))}</span>${bar(prof.reliability, 'xp')}<b>${prof.reliability}</b></div>
          </div>
        </div>
        <div class="assign-row"><span class="muted small">${escapeHtml(t('ui.assignment'))}:</span> ${assignBtns} ${button(this.open === c.npcId ? t('workers.less') : t('workers.more'), 'toggle', { npc: c.npcId }, { cls: 'sm ghost' })}</div>
        ${queue ? `<div class="hint">📋 ${escapeHtml(t('workers.queue', { list: queue }))}</div>` : ''}
        ${prios}
        <div class="btn-row">
          ${button(promo.ok ? t('ui.promote_to', { rank: t(`worker_rank.${promo.next}`, { gender: npc.gender }) }) : t('ui.promote'), 'promote', { npc: c.npcId }, { cls: 'sm', disabled: !promo.ok, title: promo.ok ? '' : tr(sim, `reason.${promo.reason || 'max_rank'}`, promo.params || {}) })}
          ${this.confirmFire === c.npcId ? `${escapeHtml(t('ui.fire_confirm'))} ${button(t('ui.yes'), 'fire_yes', { npc: c.npcId }, { cls: 'danger sm' })} ${button(t('ui.no'), 'fire_no', {}, { cls: 'sm ghost' })}` : button(t('ui.fire'), 'fire', { npc: c.npcId }, { cls: 'sm ghost' })}
        </div>
      </div>`;
    }
    html += `<div class="hint">${escapeHtml(t('ui.workers_hint'))}</div>`;
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
    } else if (action === 'prio') W.setPriority(data.npc, data.cat, data.p);
    else if (action === 'enqueue') W.enqueue(data.npc, data.id);
    else if (action === 'off_contract') {
      const job = this.sim.contracts.jobOf(data.npc);
      if (job) this.sim.contracts.assign(job.id, job.workers.filter((x) => x !== data.npc));
    }
    else if (action === 'toggle') this.open = this.open === data.npc ? null : data.npc;
    else if (action === 'buy_toggle') W.state.buy = W.state.buy === false;
    else if (action === 'budget') W.state.budget = Math.max(0, (W.state.budget ?? WORKFORCE.buyBudgetPerDay) + Number(data.d));
    else if (action === 'promote') W.promote(data.npc);
    else if (action === 'fire') this.confirmFire = data.npc;
    else if (action === 'fire_no') this.confirmFire = null;
    else if (action === 'fire_yes') {
      this.confirmFire = null;
      W.fire(data.npc);
    }
  }
}
