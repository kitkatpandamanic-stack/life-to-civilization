/**
 * Job board — today's work. Opened from the notice board (all jobs),
 * a workplace, or by asking an employer in conversation.
 *
 * Each job shows its pay (your rank in it, what you bargained for), and lets you ask for more before you
 * start, choose your hours (hourly work), or line it up for when your current job's done. The "Best pay" tab
 * compares everything you could earn today by the hour.
 */
import { headlineWeight } from '../../data/headlines.js';
import { paperHtml } from '../paper.js';
import { contractsTab, contractAction, contractCard, openCrew } from '../contracts.js';
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, villageName, rumorText } from '../format.js';
import { button, icon, tabs } from '../widgets.js';
import { JOBS } from '../../data/jobs.js';
import { COMMUNITY } from '../../systems/CommunitySystem.js';

export class JobBoardPanel extends Panel {
  constructor(ui, bizId = null, fromNpc = null) {
    super(ui);
    this.bizId = bizId;
    this.fromNpc = fromNpc;
    this.tab = 'jobs';
    this.hours = {}; // hourly jobs: the hours you've picked
  }

  /** Once the village is big enough, the board carries a proper weekly newspaper. */
  gazette() {
    return !!this.sim.news?.printed();
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
    const owner = sim.jobs.npcOfEmployer(employer);
    const place = employer === 'village' ? 'hall' : sim.economy.biz(employer)?.building;
    const hours = def.hourly ? this.hours[jobId] ?? def.durationHours : null;
    const what =
      def.type === 'shift'
        ? def.hourly
          ? t('ui.job_hourly', { money: fmtMoney(sim.jobs.pay(jobId, { hours: 1 })), from: `${def.hours[0]}:00`, to: `${def.hours[1]}:00` })
          : t('ui.job_shift', { hours: def.durationHours, from: `${def.hours[0]}:00`, to: `${def.hours[1]}:00` })
        : def.type === 'outing'
          ? t(def.yield ? 'ui.job_outing_yield' : 'ui.job_outing', { hours: def.durationHours, place: t(`place_kind.${def.place}`), item: def.yield ? t(`item.${def.yield.item}.name`) : '' })
        : def.type === 'plant'
          ? t('ui.job_plant', { qty: def.qty, money: fmtMoney(Math.round(sim.jobs.pay(jobId) / def.qty)) })
        : def.type === 'courier'
          ? t('ui.job_courier')
          : def.type === 'rounds'
            ? t('ui.job_rounds', { n: def.qty })
            : def.type === 'haul'
              ? t('ui.job_haul', { qty: def.qty, item: t(`item.${def.item}.name`) })
              : t('ui.job_deliver', { qty: def.qty, item: t(`item.${def.item}.name`) });
    const seasonal = def.seasons ? `<span class="chip">${escapeHtml(def.seasons.map((s) => t(`season.${s}`)).join(', '))}</span>` : '';
    // Your rank in this line of work, and what bargaining got you today.
    const rank = sim.jobs.rankOf(jobId);
    const next = sim.jobs.toNextRank(jobId);
    const done = sim.jobs.timesDone(jobId);
    const rankChip = done ? `<span class="chip" title="${escapeHtml(next ? t('ui.job_rank_next', { n: next.left, rank: t(`job_rank.${next.rank}`) }) : '')}">⭐ ${escapeHtml(t(`job_rank.${rank.id}`))} · ${done}</span>` : '';
    const bs = sim.jobs.bargainState(jobId);
    const bargainChip = bs ? `<span class="badge ${bs.result === 'no' ? '' : 'good'}">🤝 ${escapeHtml(t(`ui.bargain_${bs.result}`))}</span>` : '';
    const pay = sim.jobs.pay(jobId, hours ? { hours } : {});
    const q = sim.state.jobs.queued;
    const queued = q?.jobId === jobId;
    // Buttons: take it (or line it up), ask for more, pick your hours.
    const busy = !!sim.jobs.active && !active;
    const canQ = busy ? sim.jobs.canQueue(jobId) : null;
    const hourBtns = def.hourly && !active ? `<div class="btn-row">${[...new Set([def.hourly[0], Math.round((def.hourly[0] + def.hourly[1]) / 2), def.hourly[1]])].map((h) => button(t('ui.n_hours', { n: h }), 'hours', { job: jobId, h }, { cls: h === hours ? 'primary sm' : 'sm' })).join('')}</div>` : '';
    const bargain = !active && !bs ? sim.jobs.canBargain(jobId) : null;
    const mainBtn = busy
      ? queued
        ? button(t('ui.unqueue'), 'unqueue', {}, { cls: 'sm' })
        : button(t('ui.queue_job'), 'queue', { job: jobId }, { disabled: !canQ.ok, cls: 'sm', title: canQ.ok ? t('ui.queue_tip') : tr(sim, `reason.${canQ.reason}`, canQ.params || {}) })
      : button(t('ui.accept'), 'accept', { job: jobId }, { disabled: !check.ok, cls: 'primary', title: check.ok ? '' : tr(sim, `reason.${check.reason}`, check.params || {}) });
    const bargainBtn = bargain ? button(t('ui.bargain'), 'bargain', { job: jobId }, { cls: 'sm', disabled: !bargain.ok, title: t('ui.bargain_tip', { n: Math.round(sim.jobs.bargainChance(jobId) * 100) }) }) : '';
    return `<div class="job-card${active ? ' active' : ''}${check.ok ? '' : ' unavailable'}">
      <div class="job-top">
        <div class="job-name">${(def.yield?.item || def.item) ? icon(def.yield?.item || def.item, 24) : ''} ${escapeHtml(t(`job.${jobId}.name`))} ${seasonal} ${rankChip}</div>
        <div class="job-pay">💰 ${escapeHtml(fmtMoney(pay))}${hours ? ` <span class="muted small">(${escapeHtml(t('ui.n_hours', { n: hours }))})</span>` : ''} · ⭐ ${def.xp} XP${sim.jobs.rushOf(def) ? ` <span class="badge good">🌾 ${escapeHtml(t('ui.harvest_rush'))}</span>` : ''} ${bargainChip}${def.tips ? ` <span class="chip">🪙 ${escapeHtml(t('ui.job_tips'))}</span>` : ''}</div>
      </div>
      <div class="desc">${escapeHtml(t(`job.${jobId}.desc`))}</div>
      <div class="muted small">📍 ${escapeHtml(buildingLabel(sim, place))} · ${escapeHtml(t('ui.employer'))}: ${escapeHtml(employer === 'village' ? t('ui.the_village') : npcName(owner))} · ${escapeHtml(what)}</div>
      ${hourBtns}
      <div class="job-bottom">
        <div class="reqs">${this.describeRequirements(def)} <span class="muted small">${escapeHtml(t('ui.openings', { n: openings }))}</span></div>
        ${active ? `<span class="badge">${escapeHtml(t('ui.in_progress'))}</span>` : `<div class="btn-row">${mainBtn}${bargainBtn}${busy ? '' : this.crewButton(jobId)}</div>`}
      </div>
      ${queued ? `<div class="good small">⏭️ ${escapeHtml(t('ui.queued_note'))}</div>` : ''}
      ${!check.ok && !active && !busy ? `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>` : ''}
    </div>`;
  }

  /** "Send my workers": you take the job, they do it (you're paid; they're on their wages). */
  crewButton(jobId) {
    const sim = this.sim;
    if (!sim.workers.list().length) return '';
    if (sim.contracts.canTakeJob(jobId).reason === 'job_yours_only') return '';
    const chk = sim.contracts.canTakeJob(jobId);
    return button(t('contract.send_workers'), 'job_crew', { job: jobId }, { disabled: !chk.ok, title: chk.ok ? t('contract.send_workers_tip') : tr(sim, `reason.${chk.reason}`, chk.params || {}) });
  }

  /** Headlines: the most important things that really happened. */
  renderNews() {
    const sim = this.sim;
    const day = sim.time.day;
    const items = sim.state.chronicle
      .filter((e) => day - e.day <= 21)
      .map((e) => ({ e, w: headlineWeight(e.key) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.e.day - a.e.day || b.w - a.w);
    const lead = items.filter((x) => x.w >= 3).slice(0, 3);
    const rest = items.filter((x) => !lead.includes(x)).slice(0, 10);
    const line = (x, big) => `<div class="chron${big ? ' lead' : ''}"><span class="chron-date">${escapeHtml(dateString(x.e.day))}</span>${escapeHtml(tr(sim, x.e.key, x.e.params))}</div>`;
    // The week's paper (NewsSystem), then what's happened since it came out.
    let html = paperHtml(sim);
    const since = sim.news?.latest()?.day ?? -1;
    const fresh = [...lead, ...rest].filter((x) => x.e.day > since).slice(0, 8);
    if (fresh.length) html += `<h3>${escapeHtml(t('ui.news_since'))}</h3><div class="chronicle">${fresh.map((x) => line(x, x.w >= 3)).join('')}</div>`;
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
      const head = tabs([['jobs', t('ui.tab_jobs')], ['best', t('ui.tab_best_pay')], ['contracts', t('contract.tab', { n: this.sim.state.contracts.offers.length })], ['news', this.gazette() ? t('ui.tab_gazette') : t('ui.tab_village_news')]], this.tab);
      if (this.tab === 'news') return head + this.renderNews();
      if (this.tab === 'best') return head + this.renderBest();
      if (this.tab === 'contracts') return head + contractsTab(this.sim);
      return head + this.renderJobs();
    }
    return this.renderJobs();
  }

  /** Everything you could earn today, best paid by the hour first (JobSystem.advice). */
  renderBest() {
    const sim = this.sim;
    const list = sim.jobs.advice().slice(0, 12);
    const L = sim.population?.labour();
    const rows = list
      .map((a, i) => {
        const name = a.kind === 'job' ? t(`job.${a.id}.name`) : a.kind === 'request' ? tr(sim, 'ui.advice_request', { npc: a.npc, qty: a.qty, item: a.item }) : t('ui.advice_stall');
        const when = a.now ? t('ui.advice_now') : a.reason ? tr(sim, `reason.${a.reason}`, a.params || {}) : '';
        const act = a.kind === 'job' ? button(t('ui.show'), 'show_job', { job: a.id }, { cls: 'sm' }) : a.kind === 'stall' ? button(t('ui.show'), 'open_stall', {}, { cls: 'sm' }) : '';
        return `<div class="kv ${i === 0 ? 'good' : ''}"><span>${i === 0 ? '🏆 ' : ''}${escapeHtml(name)} <span class="muted small">${escapeHtml(when)}</span></span><b>${escapeHtml(t('ui.per_hour', { money: fmtMoney(Math.round(a.perHour)) }))}</b><span class="muted small">${escapeHtml(fmtMoney(a.pay))} · ~${escapeHtml(t('ui.n_hours', { n: a.hours.toFixed(1) }))}</span>${act}</div>`;
      })
      .join('');
    const q = sim.state.jobs.queued;
    return `${L ? `<div class="muted small">${escapeHtml(t(`pop.labour_${L.state}`))} · ${escapeHtml(t('ui.advice_labour', { n: `${L.factor >= 1 ? '+' : ''}${Math.round((L.factor - 1) * 100)}` }))}</div>` : ''}
      ${q ? `<div class="good small">⏭️ ${escapeHtml(t('ui.queued_line', { job: t(`job.${q.jobId}.name`) }))}</div>` : ''}
      ${rows || `<div class="muted">${escapeHtml(t('ui.advice_none'))}</div>`}
      <div class="hint">${escapeHtml(t('ui.advice_hint'))}</div>`;
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
      // Carrying goods for the shops (FreightSystem): sign up as a carrier, or see your deliveries.
      const fr = sim.freight;
      const waiting = fr.S.jobs.length;
      html += `<div class="card"><div class="card-head"><div class="card-icon">🛞</div><div><div class="card-title">${escapeHtml(t('freight.board_title'))}</div>
        <div class="card-sub">${escapeHtml(fr.company ? t('freight.board_on', { n: waiting, share: fr.summary().share }) : t('freight.board_off'))}</div></div></div>
        <div class="btn-row">${fr.company ? button(t('freight.board_open'), 'freight_open', {}, { cls: 'sm' }) : button(t('freight.sign_up'), 'freight_signup', {}, { cls: 'sm primary' })}</div></div>`;
      // Orders from other towns (TownOrderSystem), and market day (CommunitySystem).
      const orders = sim.townOrders?.open() || [];
      if (orders.length) html += `<div class="card"><div class="card-head"><div class="card-icon">📜</div><div><div class="card-title">${escapeHtml(t('orders_town.board_title', { n: orders.length }))}</div><div class="card-sub">${escapeHtml(orders.map((o) => t('orders_town.line', { town: t(`settlement_name.${o.town}`), qty: o.qty, item: t(`item.${o.item}.name`) })).join(' · '))}</div></div></div><div class="btn-row">${button(t('orders_town.open_list'), 'town_orders', {}, { cls: 'sm' })}</div></div>`;
      const md = sim.community?.daysToMarket();
      if (md !== undefined) html += `<div class="muted small">🧺 ${escapeHtml(md === 0 ? t('market.today_from', { from: COMMUNITY.market.from, to: COMMUNITY.market.to }) : t('market.next_in', { n: md, from: COMMUNITY.market.from }))}</div>`;
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
    else if (action === 'freight_open') return this.ui.openFreight({ tab: 'deliveries' });
    else if (action === 'town_orders') return this.ui.openTownOrders(false);
    else if (action === 'freight_signup') {
      const r = this.sim.freight.signUp();
      if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    } else if (action === 'property') this.ui.openProperty(data.id);
    else if (action === 'job_crew') {
      // The job's yours to manage: pick who does it.
      const r = this.sim.contracts.takeJob(data.job);
      if (!r.ok) return this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      openCrew(this.sim, r.id);
      if (!this.bizId && !this.fromNpc) this.tab = 'contracts';
      else this.ui.togglePanel('journal');
    } else if (action === 'accept') {
      const d = JOBS[data.job];
      if (this.sim.jobs.accept(data.job, d.hourly ? { hours: this.hours[data.job] ?? d.durationHours } : {})) this.ui.closePanel();
    } else if (action === 'hours') {
      this.hours[data.job] = Number(data.h);
    } else if (action === 'bargain') {
      const r = this.sim.jobs.bargain(data.job);
      if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    } else if (action === 'queue') {
      const d = JOBS[data.job];
      this.sim.jobs.queue(data.job, d.hourly ? { hours: this.hours[data.job] ?? d.durationHours } : {});
    } else if (action === 'unqueue') {
      this.sim.jobs.unqueue();
    } else if (action === 'show_job') {
      this.tab = 'jobs';
    } else if (action === 'open_stall') {
      return this.ui.openStall();
    } else if (action === 'back_dialogue') {
      this.ui.openDialogue(this.fromNpc);
    }
  }
}

/** How newsworthy a chronicle entry is (0 = not for the paper). */
// (the headline weights live in data/headlines.js — NewsSystem ranks the weekly paper with them too)
export { headlineWeight };
