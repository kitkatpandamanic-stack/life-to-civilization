/**
 * The latest issue of the valley's paper (NewsSystem), as a page: the masthead (a hand-written news sheet,
 * or once the valley prints, its Gazette), the headlines, prices, the week's thefts, the season to come and
 * the advertisements. Shown on the notice board's news tab and in the Journal.
 */
import { t, fmtMoney, itemName } from '../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, villageName } from './format.js';

export function paperHtml(sim) {
  const is = sim.news?.latest();
  const mast = (printed) => escapeHtml(printed ? t('ui.gazette_title', { name: villageName(sim) }) : t('ui.village_notices', { name: villageName(sim) }));
  if (!is) return `<div class="paper"><div class="paper-mast">${mast(sim.news?.printed())}</div><div class="muted small">${escapeHtml(t('news.none_yet'))}</div></div>`;
  const heads = is.headlines.map((h, i) => `<div class="paper-head ${i === 0 ? 'lead' : ''} ${h.you ? 'you' : ''}">${escapeHtml(tr(sim, h.key, h.params))}</div>`).join('') || `<div class="muted small">${escapeHtml(t('news.quiet_week'))}</div>`;
  const prices = Object.entries(is.prices)
    .map(([item, v]) => {
      const arrow = v.was === null ? '' : v.p > v.was * 1.03 ? ' ▲' : v.p < v.was * 0.97 ? ' ▼' : '';
      return `<span class="paper-price">${escapeHtml(itemName(item))} ${escapeHtml(fmtMoney(v.p))}${arrow}</span>`;
    })
    .join(' · ');
  const ads = is.ads.map((id) => `<div class="paper-ad">📣 ${escapeHtml(t('news.ad_line', { building: buildingLabel(sim, sim.economy.biz(id)?.building || '') }))}</div>`).join('');
  return `<div class="paper">
    <div class="paper-mast">${mast(is.printed)}</div>
    <div class="paper-date">${escapeHtml(t('ui.gazette_issue', { n: is.no, date: dateString(is.day) }))}</div>
    ${heads}
    ${prices ? `<div class="paper-sec">${escapeHtml(t('news.prices'))}</div><div class="small">${prices}</div>` : ''}
    <div class="paper-sec">${escapeHtml(t('news.law'))}</div><div class="small">${escapeHtml(is.thefts ? t('news.thefts', { n: is.thefts }) : t('news.no_thefts'))}</div>
    ${is.woods ? `<div class="paper-sec">${escapeHtml(t('news.woods'))}</div><div class="small">🌲 ${escapeHtml(t(`news.woods_${is.woods.status}`, { n: is.woods.h }))}</div>` : ''}
    <div class="paper-sec">${escapeHtml(t('news.outlook'))}</div><div class="small">${escapeHtml(t(`news.outlook_${sim.time.season}`))}</div>
    ${ads ? `<div class="paper-sec">${escapeHtml(t('news.ads'))}</div>${ads}` : ''}
  </div>`;
}
