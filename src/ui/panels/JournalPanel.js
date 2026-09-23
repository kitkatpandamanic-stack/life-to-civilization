/**
 * Journal — current tasks, the people you know, village news (the chronicle
 * of emergent stories) and the state of the world.
 */
import { Panel } from '../Panel.js';
import { t, npcName, occupationName, fmtMoney, itemName, cap } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString } from '../format.js';
import { button, tabs, portrait, hearts } from '../widgets.js';
import { BUSINESSES } from '../../data/businesses.js';
import { WEATHER_ICONS } from '../../systems/WeatherSystem.js';

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
      ['people', t('ui.tab_people')],
      ['news', t('ui.tab_news')],
      ['world', t('ui.tab_world')],
    ];
    const body = { tasks: () => this.renderTasks(), people: () => this.renderPeople(), news: () => this.renderNews(), world: () => this.renderWorld() }[this.tab]();
    return tabs(list, this.tab) + body;
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
        <div class="btn-row">${this.confirmAbandon ? `${escapeHtml(t('ui.abandon_confirm'))} ${button(t('ui.yes'), 'abandon_yes', {}, { cls: 'danger' })} ${button(t('ui.no'), 'abandon_no')}` : button(t('ui.abandon'), 'abandon')}</div>
      </div>`;
    } else {
      html += `<div class="muted">${escapeHtml(t('ui.no_job'))}</div>`;
    }
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
    const entries = [...sim.state.chronicle].reverse();
    if (!entries.length) return `<div class="muted">${escapeHtml(t('ui.no_news'))}</div>`;
    return `<div class="muted small">${escapeHtml(t('ui.news_hint'))}</div><div class="chronicle">${entries
      .map((e) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(e.day))}</span> ${escapeHtml(tr(sim, e.key, e.params))}</div>`)
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
      <h3>${escapeHtml(t('ui.events'))}</h3>
      ${events.length ? events.map((e) => `<div class="rumor">⚡ <b>${escapeHtml(t(`event.${e.id}.name`))}</b> — ${escapeHtml(t(`event.${e.id}.desc`))}</div>`).join('') : `<div class="muted">${escapeHtml(t('ui.no_events'))}</div>`}
    </div><div class="col">
      <h3>${escapeHtml(t('ui.businesses'))}</h3>`;
    for (const [id, def] of Object.entries(BUSINESSES)) {
      const money = econ.biz(id).money;
      const state = money > 400 ? 'thriving' : money > 120 ? 'steady' : 'struggling';
      html += `<div class="kv"><span>${escapeHtml(buildingLabel(sim, def.building))}</span><b class="biz-${state}">${escapeHtml(t(`biz_state.${state}`))}</b></div>`;
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
    if (action === 'tab') {
      this.tab = data.tab;
      this.confirmAbandon = false;
    } else if (action === 'abandon') this.confirmAbandon = true;
    else if (action === 'abandon_no') this.confirmAbandon = false;
    else if (action === 'abandon_yes') {
      this.confirmAbandon = false;
      this.sim.jobs.abandon();
    }
  }
}
