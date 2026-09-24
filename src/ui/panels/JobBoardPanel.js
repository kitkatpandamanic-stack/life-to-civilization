/**
 * Job board — today's work. Opened from the notice board (all jobs),
 * a workplace, or by asking an employer in conversation.
 */
import { contractsTab, contractAction, contractCard } from '../contracts.js';
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, villageName, rumorText } from '../format.js';
import { button, icon, tabs } from '../widgets.js';
import { JOBS } from '../../data/jobs.js';

export class JobBoardPanel extends Panel {
  constructor(ui, bizId = null, fromNpc = null) {
    super(ui);
    this.bizId = bizId;
    this.fromNpc = fromNpc;
    this.tab = 'jobs';
  }

  /** Once the village is big enough, the board carries a proper weekly newspaper. */
  gazette() {
    return this.sim.state.npcs.length + 1 >= 30;
  }
  get id() {
    return 'jobs';
  }
  title() {
    if (this.bizId) return `🛠️ ${escapeHtml(t('ui.work_at', { place: buildingLabel(this.sim, this.sim.economy.biz(this.bizId)?.building) }))}`;
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
    const employer = sim.jobs.employerOf(jobId);
    const owner = sim.economy.owner(employer);
    const what =
      def.type === 'shift'
        ? t('ui.job_shift', { hours: def.durationHours, from: `${def.hours[0]}:00`, to: `${def.hours[1]}:00` })
        : def.type === 'courier'
          ? t('ui.job_courier')
          : def.type === 'rounds'
            ? t('ui.job_rounds', { n: def.qty })
            : def.type === 'haul'
              ? t('ui.job_haul', { qty: def.qty, item: t(`item.${def.item}.name`) })
              : t('ui.job_deliver', { qty: def.qty, item: t(`item.${def.item}.name`) });
    const seasonal = def.seasons ? `<span class="chip">${escapeHtml(def.seasons.map((s) => t(`season.${s}`)).join(', '))}</span>` : '';
    return `<div class="job-card${active ? ' active' : ''}${check.ok ? '' : ' unavailable'}">
      <div class="job-top">
        <div class="job-name">${def.item ? icon(def.item, 24) : ''} ${escapeHtml(t(`job.${jobId}.name`))} ${seasonal}</div>
        <div class="job-pay">💰 ${escapeHtml(fmtMoney(sim.jobs.pay(jobId)))} · ⭐ ${def.xp} XP</div>
      </div>
      <div class="desc">${escapeHtml(t(`job.${jobId}.desc`))}</div>
      <div class="muted small">📍 ${escapeHtml(buildingLabel(sim, sim.economy.biz(employer)?.building))} · ${escapeHtml(t('ui.employer'))}: ${escapeHtml(npcName(owner))} · ${escapeHtml(what)}</div>
      <div class="job-bottom">
        <div class="reqs">${this.describeRequirements(def)} <span class="muted small">${escapeHtml(t('ui.openings', { n: openings }))}</span></div>
        ${active ? `<span class="badge">${escapeHtml(t('ui.in_progress'))}</span>` : button(t('ui.accept'), 'accept', { job: jobId }, { disabled: !check.ok, cls: 'primary', title: check.ok ? '' : tr(sim, `reason.${check.reason}`, check.params || {}) })}
      </div>
      ${!check.ok && !active ? `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>` : ''}
    </div>`;
  }

  /** Headlines: the most important things that really happened. */
  renderNews() {
    const sim = this.sim;
    const day = sim.time.day;
    const week = Math.floor(day / 7);
    const items = sim.state.chronicle
      .filter((e) => day - e.day <= 21)
      .map((e) => ({ e, w: headlineWeight(e.key) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.e.day - a.e.day || b.w - a.w);
    const lead = items.filter((x) => x.w >= 3).slice(0, 3);
    const rest = items.filter((x) => !lead.includes(x)).slice(0, 10);
    const line = (x, big) => `<div class="chron${big ? ' lead' : ''}"><span class="chron-date">${escapeHtml(dateString(x.e.day))}</span>${escapeHtml(tr(sim, x.e.key, x.e.params))}</div>`;
    let html = '';
    if (this.gazette()) {
      const pop = sim.state.npcs.length + 1;
      const bread = sim.economy.sellersOf('bread')[0];
      html += `<div class="gazette-head"><div class="gazette-title">${escapeHtml(t('ui.gazette_title', { name: villageName(sim) }))}</div><div class="muted small">${escapeHtml(t('ui.gazette_issue', { n: week + 1, date: dateString(day) }))} · ${escapeHtml(t('ui.population'))}: ${pop}${bread ? ` · ${escapeHtml(t('ui.bread_price'))}: ${fmtMoney(sim.economy.unitPrice(bread, 'bread'))}` : ''}</div></div>`;
    } else html += `<div class="muted small">${escapeHtml(t('ui.village_notices', { name: villageName(sim) }))}</div>`;
    html += lead.map((x) => line(x, true)).join('');
    html += `<div class="chronicle">${rest.map((x) => line(x, false)).join('') || `<div class="muted">${escapeHtml(t('ui.no_news'))}</div>`}</div>`;
    // Public notices: houses for sale, businesses hiring.
    const P = sim.property;
    const sale = P.homes().filter((id) => P.isVacant(id)).slice(0, 4);
    const hiring = sim.npcs.vacancies().slice(0, 4);
    if (sale.length || hiring.length) {
      html += `<h3>${escapeHtml(t('ui.notices'))}</h3>`;
      html += sale.map((id) => `<div class="rumor clickable" data-action="property" data-id="${id}">🏠 ${escapeHtml(t('ui.notice_home', { building: buildingLabel(sim, id), money: fmtMoney(P.weeklyRent(id)) }))}</div>`).join('');
      html += hiring.map(([id, def]) => `<div class="rumor">🛠️ ${escapeHtml(tr(sim, 'ui.notice_hiring', { building: def.building, occ: def.workerOccupation }))}</div>`).join('');
    }
    return html;
  }

  render() {
    const sim = this.sim;
    if (!this.bizId && !this.fromNpc) {
      const head = tabs([['jobs', t('ui.tab_jobs')], ['contracts', t('contract.tab', { n: this.sim.state.contracts.offers.length })], ['news', this.gazette() ? t('ui.tab_gazette') : t('ui.tab_village_news')]], this.tab);
      if (this.tab === 'news') return head + this.renderNews();
      if (this.tab === 'contracts') return head + contractsTab(this.sim);
      return head + this.renderJobs();
    }
    return this.renderJobs();
  }

  renderJobs() {
    const sim = this.sim;
    // Only work the village actually has (a bakery shift needs a bakery); what you can take now comes first.
    const ids = Object.keys(JOBS)
      .filter((id) => sim.jobs.employerOf(id) && (!this.bizId || sim.jobs.employerOf(id) === this.bizId))
      .filter((id) => !JOBS[id].seasons || JOBS[id].seasons.includes(sim.time.season) || sim.jobs.active?.jobId === id)
      .map((id) => ({ id, rank: sim.jobs.active?.jobId === id ? 0 : sim.jobs.check(id).ok ? 1 : (sim.state.jobs.openings[id] || 0) > 0 ? 2 : 3, level: JOBS[id].requires?.level || 1 }))
      .sort((a, b) => a.rank - b.rank || a.level - b.level)
      .map((x) => x.id);
    const open = ids.filter((id) => sim.jobs.check(id).ok).length;
    let html = `<div class="muted small">${escapeHtml(t('ui.jobs_available', { n: open, total: ids.length }))}</div>`;
    html += ids.map((id) => this.renderJob(id)).join('');
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
    if (contractAction(this.sim, action, data)) return;
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'property') this.ui.openProperty(data.id);
    else if (action === 'accept') {
      if (this.sim.jobs.accept(data.job)) this.ui.closePanel();
    } else if (action === 'back_dialogue') {
      this.ui.openDialogue(this.fromNpc);
    }
  }
}

/** How newsworthy a chronicle entry is (0 = not for the paper). */
const HEADLINES = {
  npc_died: 3, npc_baby: 3, npc_married: 3, business_opened_npc: 3, business_failed: 3, fire_destroyed: 3, deposit_found: 3,
  population_milestone: 3, migrants_arrived: 2, npc_left_village: 2, fire_started: 2, fire_out: 2, npc_built_home: 2,
  district_changed: 2, shortage: 2, forest_thinning: 2, fish_scarce: 2, deer_scarce: 2, npc_retired: 2, business_inherited: 2,
  business_taken_over: 2, business_handed_over: 2, npc_building: 1, village_building: 2, new_rental: 1, building_repaired: 1,
  building_abandoned: 2, building_ruined: 2, npc_evicted: 1, business_partners: 1, npc_manager: 1, business_expanding: 1,
  village_well: 1, replanting: 2, iron_running_out: 2, player_built: 2, player_land: 1, business_opened: 2,
};
export function headlineWeight(key) {
  const k = key.replace('chronicle.', '');
  if (k.startsWith('event.')) return 2;
  return HEADLINES[k] || 0;
}
