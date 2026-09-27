/**
 * The valley's people (PopulationSystem): how many, born and died this year and last, who came and who went
 * (and who's off in the towns), how long people live, the labour market — the ages as a pyramid, the life
 * stages — what the next ten years look like if things go on as they are, and the headman's family,
 * health and newcomers policies (yours to set if you're headman).
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { tabs, button, notice } from '../widgets.js';
import { POLICIES } from '../../data/civic.js';

export class PopulationPanel extends Panel {
  constructor(ui, tab = 'overview') {
    super(ui);
    this.tab = tab;
  }
  get id() {
    return 'population';
  }
  title() {
    return `👥 ${escapeHtml(t('pop.title'))}`;
  }

  render() {
    const head = tabs([['overview', t('pop.tab_overview')], ['ages', t('pop.tab_ages')], ['forecast', t('pop.tab_forecast')], ['policies', t('pop.tab_policies')]], this.tab);
    if (this.tab === 'ages') return head + this.ages();
    if (this.tab === 'forecast') return head + this.forecast();
    if (this.tab === 'policies') return head + this.policies();
    return head + this.overview();
  }

  overview() {
    const sim = this.sim;
    const P = sim.population;
    P.yearRec(); // (this year's record, from its first day)
    const s = P.summary();
    const kv = (k, v, cls = '') => `<div class="kv"><span>${escapeHtml(k)}</span><b class="${cls}">${v}</b></div>`;
    const y = sim.time.year;
    const years = [y, y - 1].map((yy) => ({ yy, r: sim.state.population.years[yy] })).filter((x) => x.r);
    const table = years.length
      ? `<table class="mk-table"><tr><th></th>${years.map((x) => `<th>${escapeHtml(t(x.yy === y ? 'pop.this_year' : 'pop.last_year'))}</th>`).join('')}</tr>
        ${['births', 'deaths', 'arrived', 'left', 'abroad', 'returned'].map((k) => `<tr><td>${escapeHtml(t(`pop.${k}`))}</td>${years.map((x) => `<td>${x.r[k]}</td>`).join('')}</tr>`).join('')}</table>`
      : '';
    const pct = (m) => `${m >= 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`;
    const L = s.labour;
    const pr = s.prosperity;
    const abroad = sim.state.population.abroad;
    return `
      ${kv(t('pop.people'), s.pop)}
      ${kv(t('pop.stages'), escapeHtml(['child', 'youth', 'adult', 'elder'].map((k) => `${t(`pop.stage_${k}`)} ${s.stages[k]}`).join(' · ')))}
      ${table}
      <h3>${escapeHtml(t('pop.life'))}</h3>
      ${kv(t('pop.life_birth'), escapeHtml(t('pop.years', { n: s.life.birth })))}
      ${kv(t('pop.life_60'), escapeHtml(t('pop.years', { n: s.life.at60 })))}
      ${kv(t('pop.care'), escapeHtml(t(s.care ? 'pop.care_yes' : 'pop.care_no')))}
      <div class="muted small">${escapeHtml(t('pop.life_hint'))}</div>
      <h3>${escapeHtml(t('pop.births_now'))}</h3>
      ${kv(t('pop.birth_mult'), escapeHtml(pct(s.birthMult)), s.birthMult >= 1 ? 'good' : 'warn')}
      <div class="muted small">${escapeHtml(t('pop.birth_why', { money: fmtMoney(pr.money), jobless: Math.round(pr.jobless * 100), mood: pr.mood }))}</div>
      <h3>${escapeHtml(t('pop.labour'))}</h3>
      ${kv(t('pop.vacancies'), L.vacancies)}
      ${kv(t('pop.seekers'), L.seekers)}
      ${kv(t('pop.wages'), escapeHtml(`${t(`pop.labour_${L.state}`)} · ${pct(L.factor)}`), L.factor >= 1 ? 'good' : 'warn')}
      <div class="muted small">${escapeHtml(t('pop.labour_hint'))}</div>
      ${abroad.length ? `<h3>${escapeHtml(t('pop.in_towns'))}</h3>${abroad.map((a) => `<div class="small">🧳 ${escapeHtml(npcName(a.npc))} · ${escapeHtml(t('pop.back_in', { n: Math.max(0, a.back - sim.time.day) }))}</div>`).join('')}` : ''}`;
  }

  ages() {
    const P = this.sim.population;
    const bands = P.pyramid();
    const max = Math.max(1, ...bands.map((b) => Math.max(b.m, b.f)));
    const bar = (n, side) => `<div class="pyr-bar ${side}" style="width:${Math.round((n / max) * 100)}%"><span>${n || ''}</span></div>`;
    const rows = bands
      .slice()
      .reverse()
      .map((b) => `<div class="pyr-row"><div class="pyr-side left">${bar(b.m, 'm')}</div><div class="pyr-age">${b.from >= 90 ? '90+' : `${b.from}–${b.to}`}</div><div class="pyr-side right">${bar(b.f, 'f')}</div></div>`)
      .join('');
    const st = P.stages();
    const stage = (k) => `<div class="kv"><span>${escapeHtml(t(`pop.stage_${k}`))} <span class="muted small">${escapeHtml(t(`pop.stage_${k}_ages`))}</span></span><b>${st[k]}</b></div><div class="muted small">${escapeHtml(t(`pop.stage_${k}_hint`))}</div>`;
    return `<div class="pyr-legend"><span>♂ ${escapeHtml(t('pop.men'))}</span><span>${escapeHtml(t('pop.women'))} ♀</span></div>
      <div class="pyramid">${rows}</div>
      <h3>${escapeHtml(t('pop.stages'))}</h3>
      ${['child', 'youth', 'adult', 'elder'].map(stage).join('')}`;
  }

  forecast() {
    const P = this.sim.population;
    const f = P.forecast(10);
    const r = f.rates;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const max = Math.max(1, ...f.years.map((y) => y.pop), P.pop());
    const rows = f.years
      .filter((y, i) => i === 0 || i === 2 || i === 4 || i === 9)
      .map((y) => `<div class="kv"><span>${escapeHtml(t('pop.in_years', { n: y.year - this.sim.time.year }))}</span><span class="fc-bar"><i style="width:${Math.round((y.pop / max) * 100)}%"></i></span><b>${y.pop}</b><span class="muted small">${escapeHtml(t('pop.elders_n', { n: y.elders }))}</span></div>`)
      .join('');
    return `
      ${notice(f.trend === 'shrinking' ? 'warn' : 'info', escapeHtml(t(`pop.trend_${f.trend}`)))}
      ${kv(t('pop.births_year'), r.births)}
      ${kv(t('pop.deaths_year'), r.deaths)}
      ${kv(t('pop.migration_year'), `${r.migration >= 0 ? '+' : ''}${r.migration}`)}
      <h3>${escapeHtml(t('pop.next_years'))}</h3>
      ${rows}
      <div class="hint">${escapeHtml(t('pop.forecast_hint'))}</div>`;
  }

  policies() {
    const sim = this.sim;
    const C = sim.civic;
    const V = sim.state.civic;
    const mine = C.isPlayerHeadman();
    const row = (kind) => {
      const cur = V.policies[kind];
      const opts = Object.keys(POLICIES[kind])
        .map((lv) => (mine ? button(t(`hall.level_${lv}`), 'policy', { kind, lv }, { cls: lv === cur ? 'primary sm' : 'sm' }) : lv === cur ? `<b>${escapeHtml(t(`hall.level_${lv}`))}</b>` : ''))
        .join(' ');
      return `<div class="kv"><span>${escapeHtml(t(`hall.policy_${kind}`))}</span><span>${opts}</span></div><div class="muted small">${escapeHtml(t(`pop.policy_${kind}_${cur}`))}</div>`;
    };
    const S = sim.state.population;
    return `
      ${row('family')}
      ${row('health')}
      ${row('welcome')}
      ${row('forestry')}
      <div class="kv"><span>${escapeHtml(t('pop.paid_allowances'))}</span><b>${S.allowances}</b></div>
      <div class="kv"><span>${escapeHtml(t('pop.paid_grants'))}</span><b>${S.grants}</b></div>
      ${V.policies.health === 'high' && !S.healthPaid ? notice('warn', escapeHtml(t('pop.clinic_unpaid'))) : ''}
      <div class="muted small">${escapeHtml(t(mine ? 'pop.policies_yours' : 'pop.policies_headman', { npc: mine ? '' : npcName(C.headman() || null) }))}</div>`;
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'policy') {
      if (!this.sim.civic.setPolicy(data.kind, data.lv)) this.sim.toast('reason.not_headman', {}, 'warn');
    }
  }
}

