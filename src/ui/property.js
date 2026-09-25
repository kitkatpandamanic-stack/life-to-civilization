/**
 * Property in the UI: what state a building is in (as badges — icon and word, not only colour)
 * and what the rental market says about it (suggested rent, the going range, demand).
 */
import { t, fmtMoney } from '../i18n/i18n.js';
import { status } from './widgets.js';
import { escapeHtml } from './format.js';

/** The states a building is in: [{ key, kind, ico }] — the first is the main one. */
export function propStates(sim, id) {
  const P = sim.property;
  const r = P.rec(id);
  if (!r) return [];
  const out = [];
  const add = (key, kind, ico) => out.push({ key, kind, ico });
  if (sim.structures?.works(id)) add('works', 'info', '🏗️');
  if (r.ruined) add('ruin', 'danger', '🏚️');
  else if (r.abandoned) add('abandoned', 'danger', '🏚️');
  if (id === sim.state.player.homeId) add('your_home', 'good', '🏠');
  else {
    // The one housing state (PropertySystem.housingState): rented, lived in by its owner, to let, empty.
    const hs = P.housingState(id);
    if (hs === 'business') add('business', 'info', '🏪');
    else if (hs === 'rented') add('rented', 'good', '🔑');
    else if (hs === 'owner_occupied') add('owner_occupied', 'neutral', '🏠');
    else if (hs === 'for_rent') add('for_rent', 'warn', '📋');
    else if (hs === 'vacant') add('vacant', 'warn', '🚪');
  }
  if (r.lease?.notice) add('notice', 'warn', '📤');
  if (r.forSale) add('for_sale', 'info', '🏷️');
  if (r.arrears > 0) add('arrears', 'danger', '⚠️');
  if (!r.ruined && r.condition < 40) add('needs_repair', 'danger', '🔧');
  return out;
}

export function propBadges(sim, id) {
  return propStates(sim, id)
    .map((s) => status(t(`prop_state.${s.key}`), s.kind, s.ico))
    .join(' ');
}

/**
 * Why a building costs what it does, and why its rent is what it is: the parts, each with its
 * sign (RealtySystem). Two small lists, side by side.
 */
export function worthBreakdown(sim, id, { rent = true } = {}) {
  const R = sim.realty;
  if (!R) return '';
  const row = (p, fmt) => `<div class="wb-row"><span>${escapeHtml(t(`worth.${p.k}`))}</span><b class="${p.v < 0 ? 'neg' : ''}">${p.v < 0 ? '−' : p.k === 'building' || p.k === 'base' ? '' : '+'}${escapeHtml(fmt(Math.abs(p.v)))}</b></div>`;
  const price = R.priceParts(id);
  const money = (v) => fmtMoney(Math.round(v));
  let html = `<div class="wb"><div><div class="wb-head">${escapeHtml(t('worth.price'))}</div>${price.parts.map((p) => row(p, money)).join('')}<div class="wb-row wb-total"><span>${escapeHtml(t('worth.total'))}</span><b>${escapeHtml(money(price.total))}</b></div></div>`;
  if (rent) {
    const r = R.rentParts(id);
    const coins = (v) => fmtMoney(Math.round(v * 10) / 10);
    html += `<div><div class="wb-head">${escapeHtml(t('worth.rent'))}</div>${r.parts.map((p) => row(p, coins)).join('')}<div class="wb-row wb-total"><span>${escapeHtml(t('worth.total_week'))}</span><b>${escapeHtml(fmtMoney(r.total))}</b></div></div>`;
  }
  return html + '</div>';
}

/** The valley's housing market: homes, how many free, who's looking, rents and prices — and the trend. */
export function marketHtml(sim) {
  const R = sim.realty;
  const w = R?.S.weeks || [];
  const now = w.at(-1);
  if (!now) return `<div class="muted small">${escapeHtml(t('market_ui.no_data'))}</div>`;
  const m = R.mood();
  const arrow = { up: '📈', down: '📉', flat: '➖' }[m.trend];
  const spark = w.slice(-12).map((x) => x.avgRent);
  const max = Math.max(...spark, 1);
  const bars = spark.map((v) => `<i style="height:${Math.max(8, Math.round((v / max) * 100))}%"></i>`).join('');
  return `<div class="stat-grid">
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.homes'))}</div><div class="stat-value">${now.homes}</div></div>
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.vacant'))}</div><div class="stat-value">${now.vacant}</div></div>
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.looking'))}</div><div class="stat-value">${Math.round(now.seekers)}</div></div>
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.avg_rent'))}</div><div class="stat-value">${escapeHtml(fmtMoney(now.avgRent))}</div></div>
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.avg_price'))}</div><div class="stat-value">${escapeHtml(fmtMoney(now.avgPrice))}</div></div>
      <div class="stat"><div class="stat-label">${escapeHtml(t('market_ui.demand'))}</div><div class="stat-value">${arrow} ${escapeHtml(t(`demand.${m.demand}`))}</div></div>
    </div>
    <div class="spark" title="${escapeHtml(t('market_ui.rent_trend'))}">${bars}</div>
    <div class="muted small">${escapeHtml(t('market_ui.hint'))}</div>`;
}

/** What the market says: the rent at the normal level, the going range for homes this size, and demand. */
export function rentMarket(sim, id) {
  const P = sim.property;
  const cap = P.capacity(id);
  const r = P.rec(id);
  const base = P.marketRent(id);
  const like = P.homes().filter((h) => h !== id && !P.rec(h)?.ruined && Math.abs(P.capacity(h) - cap) <= 1 && h !== 'hall');
  const rents = like.map((h) => P.marketRent(h));
  // The middle half of what similar homes go for (the odd bargain or palace aside).
  const sorted = [...rents, base].sort((a, b) => a - b);
  const lo = rents.length >= 3 ? Math.min(base, sorted[Math.floor(sorted.length * 0.25)]) : Math.round(base * 0.8);
  const hi = rents.length >= 3 ? Math.max(base, sorted[Math.ceil(sorted.length * 0.75) - 1]) : Math.round(base * 1.2);
  const demand = sim.realty ? sim.realty.mood().demand : P.demand() >= 1.2 ? 'high' : P.demand() <= 0.9 ? 'low' : 'normal';
  return { suggested: base, lo, hi, demand, range: `${fmtMoney(lo)}–${fmtMoney(hi)}` };
}
