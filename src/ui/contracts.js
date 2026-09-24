/**
 * How contracts read on the notice board and in the Journal.
 */
import { t, fmtMoney } from '../i18n/i18n.js';
import { tr, escapeHtml, dateString } from './format.js';
import { button, icon, bar } from './widgets.js';
import { QUALITY } from '../data/quality.js';

/** One sentence describing what's asked. */
export function contractText(sim, c) {
  const who = c.issuer === 'village' ? t('owner.village') : null;
  const params = { qty: c.qty, item: c.item, building: c.building, building2: c.from, hours: c.hours, npc: c.issuer !== 'village' ? c.issuer : undefined };
  if (c.minQ !== undefined) params.quality = QUALITY[c.minQ].id;
  if (c.kind === 'build') {
    const site = sim.construction.byId(c.siteId);
    params.vbuilding = site?.type || 'house';
    return tr(sim, c.issuer === 'village' ? 'contract.build_village' : 'contract.build', params);
  }
  if (c.kind === 'haul') return tr(sim, 'contract.haul', { ...params, building: c.from, building2: c.building });
  if (c.kind === 'order') return tr(sim, c.feast ? (c.issuer === 'village' ? 'contract.order_feast_village' : 'contract.order_feast') : 'contract.order', { ...params, building2: sim.economy.biz(c.supplierBiz)?.building });
  if (c.kind === 'craft') return tr(sim, c.bizId ? 'contract.craft_biz' : 'contract.craft', params);
  return tr(sim, 'contract.supply', params) + (who ? '' : '');
}

export function contractCard(sim, c, mode) {
  const C = sim.contracts;
  const head = `<div class="job-top"><div class="job-name">${c.item ? icon(c.item, 24) : '🔨'} ${escapeHtml(t(`contract.kind.${c.kind}`))}</div><div class="job-pay">💰 ${escapeHtml(fmtMoney(c.pay))}</div></div>`;
  const body = `<div class="job-desc">${escapeHtml(contractText(sim, c))}</div>`;
  if (mode === 'offer') {
    const chk = C.canAccept(c.id);
    return `<div class="job-card">${head}${body}
      <div class="muted small">${escapeHtml(t('contract.time_allowed', { n: c.days }))}</div>
      <div class="btn-row">${button(t('contract.accept'), 'contract_accept', { id: c.id }, { cls: 'primary', disabled: !chk.ok })}${button(t('contract.decline'), 'contract_decline', { id: c.id })}</div>
      ${chk.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}</div>`;
  }
  const done = C.progress(c);
  const label = c.kind === 'build' ? t('contract.hours_done', { n: c.done, of: c.hours }) : c.kind === 'haul' ? t('contract.hauled', { n: c.delivered, got: c.collected, of: c.qty }) : t('contract.delivered_n', { n: c.delivered, of: c.qty });
  const late = c.deadline - sim.time.day;
  return `<div class="job-card active">${head}${body}
    ${bar(done * 100, 'xp', label)}
    <div class="muted small ${late <= 1 ? 'warn' : ''}">${escapeHtml(t('contract.deadline', { date: dateString(c.deadline) }))}</div>
    <div class="btn-row">${c.kind === 'order' ? button(t('contract.ship', { n: Math.floor(sim.economy.stock(c.supplierBiz, c.item)) }), 'contract_ship', { id: c.id }, { cls: 'primary', disabled: sim.economy.stock(c.supplierBiz, c.item) < 1 }) : ''}${button(t('contract.abandon'), 'contract_abandon', { id: c.id })}</div></div>`;
}

export function contractsTab(sim) {
  const S = sim.state.contracts;
  let html = `<div class="muted small">${escapeHtml(t('contract.hint'))}</div>`;
  if (S.active.length) html += `<h3>${escapeHtml(t('contract.yours'))}</h3>` + S.active.map((c) => contractCard(sim, c, 'active')).join('');
  html += `<h3>${escapeHtml(t('contract.offered'))}</h3>`;
  html += S.offers.map((c) => contractCard(sim, c, 'offer')).join('') || `<div class="muted">${escapeHtml(t('contract.none'))}</div>`;
  html += `<div class="muted small">${escapeHtml(t('contract.record', { done: S.done, failed: S.failed }))}</div>`;
  return html;
}

/** Handle contract buttons (shared by panels). Returns true if handled. */
export function contractAction(sim, action, data) {
  const id = Number(data.id);
  if (action === 'contract_accept') {
    const r = sim.contracts.accept(id);
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    return true;
  }
  if (action === 'contract_decline') return sim.contracts.decline(id), true;
  if (action === 'contract_abandon') return sim.contracts.abandon(id), true;
  if (action === 'contract_ship') return sim.contracts.fulfilOrder(id), true;
  return false;
}
