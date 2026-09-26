/**
 * Journal — current tasks, the people you know, village news (the chronicle
 * of emergent stories) and the state of the world.
 */
import { AMBITIONS, MAX_TRACKED } from '../../systems/AmbitionSystem.js';
import { contractCard, contractAction, openCrew } from '../contracts.js';
import { BALANCE } from '../../config/balance.js';
import { Panel } from '../Panel.js';
import { t, npcName, occupationName, fmtMoney, itemName, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, rumorText } from '../format.js';
import { button, tabs, portrait, hearts, bar, filters } from '../widgets.js';
import { WEATHER_ICONS } from '../../systems/WeatherSystem.js';
import { guidePageHtml, guideAction } from '../guide.js';
import { storiesHtml } from '../stories.js';
import { lineChart } from '../charts.js';

/** What the history charts can show (HistorySystem.samples). */
const CHARTS = ['pop', 'money', 'worth', 'biz', 'treasury', 'bread', 'workers'];

export class JournalPanel extends Panel {
  constructor(ui, tab = 'tasks') {
    super(ui);
    this.tab = tab;
    this.confirmAbandon = false;
  }
  get id() {
    return 'journal';
  }
  title() {
    return `📖 ${escapeHtml(t('ui.journal'))}`;
  }

  render() {
    const list = [
      ['tasks', t('ui.tab_tasks')],
      ['guide', t('guide.tab')],
      ['stories', `${t('story_ui.tab')}${this.sim.stories?.waiting().length ? ` (${this.sim.stories.waiting().length})` : ''}`],
      ['people', t('ui.tab_people')],
      ['news', t('ui.tab_news')],
      ['world', t('ui.tab_world')],
      ['history', t('ui.tab_history')],
    ];
    const body = { guide: () => guidePageHtml(this.sim, { showPaths: this.showPaths }), stories: () => storiesHtml(this.sim), tasks: () => this.renderTasks(), people: () => this.renderPeople(), news: () => this.renderNews(), world: () => this.renderWorld(), history: () => this.renderHistory() }[this.tab]();
    return tabs(list, this.tab) + body;
  }

  /** Your ambitions: the ones you track, then (on request) all the others. */
  /** The valley's learning, counted from its people (EducationWorldSystem). */
  learningHtml(kv) {
    const sim = this.sim;
    const st = sim.eduworld?.stats();
    if (!st) return '';
    const pct = (v) => `${Math.round(v * 100)}%`;
    const skilled = Object.entries(st.skilledIn).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `${t(`knowledge.${f}`)} ${n}`).join(' · ');
    return `<h3>${escapeHtml(t('edu_stats.title'))}</h3>
      ${kv(t('edu_stats.literacy'), pct(st.literacy))}
      ${kv(t('edu_stats.schooling'), `${pct(st.basic)} · ${pct(st.secondary)} · ${pct(st.vocational)} · ${pct(st.university)}`)}
      ${kv(t('edu_stats.at_school'), `${st.pupils} · ${t('edu_stats.away', { n: st.students })}`)}
      ${kv(t('edu_stats.people'), t('edu_stats.people_line', { teachers: st.teachers, doctors: st.doctors, engineers: st.engineers, researchers: st.researchers }))}
      ${kv(t('edu_stats.trades'), t('edu_stats.trades_line', { masters: st.masters, apprentices: st.apprentices }))}
      ${skilled ? kv(t('edu_stats.skilled'), skilled) : ''}
      ${st.specialty ? kv(t('edu_stats.known_for'), t(`knowledge.${st.specialty}`)) : ''}
      ${kv(t('edu_stats.innovation'), `${st.innovation} · ${t('edu_stats.discoveries', { n: st.discoveries })}`)}
      <div class="muted small">${escapeHtml(t('edu_stats.hint'))}</div>`;
  }

  renderAmbitions() {
    const sim = this.sim;
    const A = sim.ambitions;
    const p = sim.state.player;
    const row = (id, clickable) => {
      const pr = A.progress(id);
      const tracked = p.ambitions.includes(id);
      const mark = pr.done ? '✓' : tracked ? '★' : '☆';
      return `<div class="ambition${pr.done ? ' done' : ''}${clickable ? ' clickable' : ''}" ${clickable && !pr.done ? `data-action="track" data-id="${id}"` : ''} title="${escapeHtml(t(`ambition.${id}.desc`))}">
        <span>${mark} ${AMBITIONS[id].icon} ${escapeHtml(t(`ambition.${id}.name`))}</span>${bar(pr.pct * 100, 'xp', `${Math.min(pr.value, pr.target)} / ${pr.target}`)}</div>`;
    };
    let html = `<h3>${escapeHtml(t('ambition.title'))} <span class="muted small">(${p.ambitions.length}/${MAX_TRACKED})</span></h3>`;
    html += p.ambitions.map((id) => row(id, true)).join('') || `<div class="muted small">${escapeHtml(t('ambition.none'))}</div>`;
    if (this.showAmbitions) {
      html += Object.keys(AMBITIONS).filter((id) => !p.ambitions.includes(id)).map((id) => row(id, true)).join('');
      html += `<div class="btn-row">${button(t('ambition.hide'), 'ambitions_toggle')}</div>`;
    } else html += `<div class="btn-row">${button(t('ambition.choose'), 'ambitions_toggle')}</div>`;
    return html;
  }

  renderTasks() {
    const sim = this.sim;
    const job = sim.jobs.active;
    let html = '';
    if (job) {
      const obj = sim.jobs.objective();
      html += `<div class="job-card active">
        <div class="job-top"><div class="job-name">${escapeHtml(t(`job.${job.jobId}.name`))}</div><div class="job-pay">💰 ${fmtMoney(sim.jobs.pay(job.jobId))}</div></div>
        <div class="desc">${escapeHtml(t(`job.${job.jobId}.desc`))}</div>
        ${obj ? `<div class="obj-text">➜ ${escapeHtml(tr(sim, obj.key, obj.params))}</div>` : ''}
        <div class="muted small">${escapeHtml(t('ui.deadline_today'))}</div>
        <div class="btn-row">${sim.workers.list().length ? button(t('contract.hand_over'), 'job_hand_over', {}, { disabled: !sim.contracts.canHandOver().ok, title: sim.contracts.canHandOver().ok ? t('contract.send_workers_tip') : tr(sim, `reason.${sim.contracts.canHandOver().reason}`) }) : ''}${this.confirmAbandon ? `${escapeHtml(t('ui.abandon_confirm'))} ${button(t('ui.yes'), 'abandon_yes', {}, { cls: 'danger' })} ${button(t('ui.no'), 'abandon_no')}` : button(t('ui.abandon'), 'abandon')}</div>
      </div>`;
    } else {
      html += `<div class="muted">${escapeHtml(t('ui.no_job'))}</div>`;
    }
    // Contracts you've taken on.
    const contracts = sim.state.contracts.active;
    if (contracts.length) html += `<h3>${escapeHtml(t('contract.yours'))}</h3>` + contracts.map((c) => contractCard(sim, c, 'active')).join('');
    html += this.renderAmbitions();
    const reqs = sim.state.jobs.requests.filter((r) => r.accepted);
    if (reqs.length) {
      html += `<h3>${escapeHtml(t('ui.favours'))}</h3>`;
      html += reqs
        .map((r) => `<div class="rumor">🤝 ${escapeHtml(tr(sim, 'objective.request', { npc: r.npcId, qty: r.qty, item: r.item, have: sim.inventory.count(r.item) }))} · ${fmtMoney(r.reward)} · ${escapeHtml(t('ui.until', { date: dateString(r.expiresDay) }))}</div>`)
        .join('');
    }
    const p = sim.state.player;
    html += `<h3>${escapeHtml(t('ui.home_title'))}</h3><div class="rumor">🏠 ${escapeHtml(tr(sim, p.rent.debt > 0 ? 'toast.rent_info_debt' : 'toast.rent_info', { money: p.rent.amount, days: Math.max(0, p.rent.nextDueDay - sim.time.day), debt: p.rent.debt }))}</div>`;
    html += `<h3>${escapeHtml(t('ui.tips'))}</h3><ul class="tips">${['tip1', 'tip2', 'tip3', 'tip4', 'tip5'].map((k) => `<li>${escapeHtml(t(`tips.${k}`))}</li>`).join('')}</ul>`;
    return html;
  }

  renderPeople() {
    const sim = this.sim;
    const known = sim.state.npcs.filter((n) => n.met).sort((a, b) => b.rel - a.rel);
    const unknown = sim.state.npcs.length - known.length;
    let html = known
      .map(
        (n) => `<div class="person" data-action="noop">
        ${portrait(`npc_${sim.state.seed}_${n.id}`, n.look, 44)}
        <div class="person-info"><b>${escapeHtml(npcName(n))}</b> <span class="muted small">${escapeHtml(cap(occupationName(n.occupation, n.gender)))} · ${escapeHtml(t('ui.level_n', { level: n.level }))}</span>
        <div class="small">${escapeHtml(t(`rel_tier.${sim.social.tier(n)}`))} ${hearts(n.rel)}</div></div>
      </div>`,
      )
      .join('');
    if (!known.length) html += `<div class="muted">${escapeHtml(t('ui.no_people'))}</div>`;
    if (unknown > 0) html += `<div class="muted small">${escapeHtml(t('ui.unknown_people', { n: unknown }))}</div>`;
    return `<div class="people">${html}</div>`;
  }

  renderNews() {
    const sim = this.sim;
    const heard = (sim.state.rumors?.heardByPlayer || []).map((id) => sim.rumors.get(id)).filter(Boolean).slice(-8).reverse();
    const rumors = heard.length
      ? `<h3>${escapeHtml(t('ui.rumors_heard'))}</h3>${heard.map((r) => `<div class="rumor">🗣️ ${escapeHtml(rumorText(sim, r))} <span class="muted small">(${escapeHtml(dateString(r.born))})</span></div>`).join('')}`
      : '';
    return rumors + this.renderChronicle();
  }

  renderChronicle() {
    const sim = this.sim;
    const entries = [...sim.state.chronicle].reverse();
    if (!entries.length) return `<div class="muted">${escapeHtml(t('ui.no_news'))}</div>`;
    return `<div class="muted small">${escapeHtml(t('ui.news_hint'))}</div><div class="chronicle">${entries
      .map((e) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(e.day))}</span> ${escapeHtml(tr(sim, e.key, e.params))}</div>`)
      .join('')}</div>`;
  }

  /** The village's history book: firsts, milestones, disasters, your family's generations. */
  /** The valley in numbers, week by week: a chart to choose, with the big moments marked. */
  chartsHtml() {
    const sim = this.sim;
    const { daysPerSeason, seasons } = BALANCE.time;
    const k = this.chart || 'pop';
    const samples = sim.history.samples();
    const points = samples.map((s) => ({ x: s.d, y: s[k] ?? 0 }));
    const money = ['money', 'worth', 'treasury', 'bread'].includes(k);
    const marks = sim.history.H.entries
      .filter((e) => e.key.startsWith('chronicle.village_status') || e.key === 'chronicle.railway_opened' || e.key === 'chronicle.player_arrived')
      .map((e) => ({ x: e.day, label: `${dateString(e.day)} · ${tr(sim, e.key, e.params)}` }));
    const first = samples[0];
    const last = samples[samples.length - 1];
    const change = first && last && samples.length > 1 ? last[k] - first[k] : 0;
    return `<h3>📈 ${escapeHtml(t('history_ui.title'))}</h3>
      ${filters(CHARTS.map((c) => [c, t(`history_ui.${c}`)]), k, 'chart')}
      <div class="chart-box">${lineChart(points, { fmt: (v) => (money ? fmtMoney(Math.round(v)) : String(Math.round(v))), marks, yearDays: daysPerSeason * seasons.length, label: t('history_ui.too_soon') })}</div>
      <div class="muted small">${escapeHtml(samples.length > 1 ? t('history_ui.since', { n: samples.length, change: `${change >= 0 ? '+' : '−'}${money ? fmtMoney(Math.abs(Math.round(change))) : Math.abs(Math.round(change))}` }) : t('history_ui.too_soon'))}</div>`;
  }

  renderHistory() {
    const sim = this.sim;
    const { daysPerSeason, seasons } = BALANCE.time;
    const years = sim.history.byYear((d) => Math.floor(d / (daysPerSeason * seasons.length)) + 1);
    if (!years.length) return this.chartsHtml() + `<div class="muted">${escapeHtml(t('ui.no_history'))}</div>`;
    return `${this.chartsHtml()}<h3>📜 ${escapeHtml(t('history_ui.timeline'))}</h3><div class="muted small">${escapeHtml(t('ui.history_hint'))}</div><div class="chronicle">${years
      .map(
        ([y, list]) =>
          `<h3>${escapeHtml(t('ui.year_n', { n: y }))}</h3>` +
          list
            .slice()
            .reverse()
            .map((e) => `<div class="chron">${e.first ? `<span class="chip">${escapeHtml(t('ui.history_first'))}</span> ` : ''}<span class="chron-date">${escapeHtml(dateString(e.day))}</span> ${escapeHtml(tr(sim, e.key, e.params))}</div>`)
            .join(''),
      )
      .join('')}</div>`;
  }

  renderWorld() {
    const sim = this.sim;
    const econ = sim.economy;
    const time = sim.time;
    const npcs = sim.state.npcs;
    const adults = npcs.filter((n) => n.age >= 16);
    const employed = adults.filter((n) => n.employer || n.owns).length;
    const events = sim.state.events.active;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`;
    let html = `<div class="char-cols"><div class="col">
      <h3>${escapeHtml(t('ui.village'))}</h3>
      ${kv(t('ui.population'), npcs.length + 1)}
      ${kv(t('ui.employed'), `${employed} / ${adults.length}`)}
      ${kv(t('ui.season'), `${t(`season.${time.season}`)} · ${t('ui.day_n', { day: time.dayOfSeason })}`)}
      ${kv(t('ui.weather'), `${WEATHER_ICONS[sim.weather.type]} ${t(`weather.${sim.weather.type}`)}`)}
      <h3>${escapeHtml(t('expedition.beyond'))}</h3>
      ${kv(t('expedition.valley_mapped'), `${Math.round(sim.exploration.valleyExplored() * 100)}%`)}
      ${sim.exploration.known().map((id) => kv(t(`region_name.${id}`), `${sim.exploration.region(id).explored}%${sim.exploration.region(id).partner ? ' · 🤝' : ''}`)).join('')}
      ${sim.state.knowledge.points ? kv(t('expedition.knowledge'), sim.state.knowledge.points) : ''}
      <h3>${escapeHtml(t('tech.know_how'))}</h3>
      ${sim.tech.overview().filter((x) => x.known || x.ready).map((x) => `<div class="kv" title="${escapeHtml(t(`tech.${x.id}.desc`))}"><span>${x.icon} ${escapeHtml(t(`tech.${x.id}.name`))}</span><b>${x.known ? `✓ ${escapeHtml(t('tech.adoption', { n: Math.round((sim.knowhow?.adoption(x.id) ?? 1) * 100) }))}` : escapeHtml(t('tech.working_on', { n: Math.round(x.progress * 100) }))}</b></div>`).join('') || `<div class="muted small">${escapeHtml(t('tech.none_yet'))}</div>`}
      <div class="muted small">${escapeHtml(t('tech.hint'))}</div>
      ${this.learningHtml(kv)}
      <h3>${escapeHtml(t('ui.events'))}</h3>
      ${events.length ? events.map((e) => `<div class="rumor">⚡ <b>${escapeHtml(t(`event.${e.id}.name`))}</b> — ${escapeHtml(t(`event.${e.id}.desc`))}</div>`).join('') : `<div class="muted">${escapeHtml(t('ui.no_events'))}</div>`}
    </div><div class="col">
      <h3>${escapeHtml(t('ui.businesses'))}</h3>`;
    for (const id of econ.active()) {
      const money = econ.biz(id).money;
      const state = money > 400 ? 'thriving' : money > 120 ? 'steady' : 'struggling';
      html += `<div class="kv clickable" data-action="property" data-id="${econ.biz(id).building}"><span>${escapeHtml(buildingLabel(sim, econ.biz(id).building))}</span><b class="biz-${state}">${escapeHtml(t(`biz_state.${state}`))}</b></div>`;
    }
    html += `<h3>${escapeHtml(t('ui.store_prices'))}</h3>`;
    for (const item of ['bread', 'apple', 'wood', 'stone', 'wheat']) {
      const price = econ.playerBuyPrice('store', item);
      const f = econ.priceFactor('store', item);
      html += `<div class="kv"><span>${escapeHtml(itemName(item))}</span><b>${fmtMoney(price)} ${f > 1.25 ? '<span class="trend up">▲</span>' : f < 0.8 ? '<span class="trend down">▼</span>' : ''}</b></div>`;
    }
    html += `<div class="muted small">${escapeHtml(t('ui.prices_hint'))}</div></div></div>`;
    return html;
  }

  onAction(action, data) {
    if (action === 'story_open') return this.ui.openStory(data.id);
    if (action === 'chart') return (this.chart = data.f);
    if (guideAction(this, action, data)) return;
    if (contractAction(this.sim, action, data)) return;
    if (action === 'job_hand_over') {
      const r = this.sim.contracts.handOver();
      if (!r.ok) return this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      openCrew(this.sim, r.id);
      return;
    }
    if (action === 'track') return void this.sim.ambitions.track(data.id);
    if (action === 'ambitions_toggle') return void (this.showAmbitions = !this.showAmbitions);
    if (action === 'tab') {
      this.tab = data.tab;
      this.confirmAbandon = false;
    } else if (action === 'abandon') this.confirmAbandon = true;
    else if (action === 'abandon_no') this.confirmAbandon = false;
    else if (action === 'abandon_yes') {
      this.confirmAbandon = false;
      this.sim.jobs.abandon();
    } else if (action === 'property') this.ui.openProperty(data.id);
  }
}
