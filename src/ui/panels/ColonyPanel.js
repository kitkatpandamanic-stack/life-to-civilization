/**
 * Your settlement (at its founding stone, or from the Management center): its name and how far it's
 * grown; the plan; the settlers; the store for the winter; the purse, the taxes and the landmarks.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, npcName, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, progress, status, stat, statGrid, emptyState, notice, icon } from '../widgets.js';
import { COLONY, LANDMARKS, LAYOUTS } from '../../data/colony.js';

export function colonyName(sim) {
  const C = sim.state.colony;
  return C ? C.name || t(`colony_name.${C.nameIdx}`) : '';
}

export class ColonyPanel extends Panel {
  constructor(ui) {
    super(ui);
    this.draftName = null;
  }
  get id() {
    return 'colony';
  }
  title() {
    return `🏕️ ${escapeHtml(colonyName(this.sim) || t('colony.title'))}`;
  }

  onInput(key, value) {
    if (key === 'colony_name') this.draftName = value;
  }

  render() {
    const sim = this.sim;
    const K = sim.colony;
    const C = sim.state.colony;
    if (!C) return emptyState('🪨', t('colony.none'), t('colony.none_hint', { n: COLONY.minDistance, money: fmtMoney(COLONY.charterMoney) }));
    const order = COLONY.stages.map((s) => s.id);
    const next = COLONY.stages[order.indexOf(C.stage) + 1];
    const settlers = K.settlers();
    const homes = K.homes();
    let html = statGrid([
      stat(t('colony.stage'), `${escapeHtml(t(`colony_stage.${C.stage}`))}`),
      stat(t('colony.settlers'), String(settlers.length)),
      stat(t('colony.homes'), String(homes.length)),
      stat(t('colony.purse'), fmtMoney(Math.round(C.treasury))),
    ]);
    if (next) html += `<div class="hint">${escapeHtml(t('colony.next_stage', { stage: t(`colony_stage.${next.id}`), n: next.settlers, h: next.homes }))}${next.landmarks ? ` · ${escapeHtml(t('colony.needs_landmarks'))}` : ''}</div>`;
    // Its name.
    html += `<h3>✏️ ${escapeHtml(t('colony.name'))}</h3><div class="toolbar-row"><input class="input" data-input="colony_name" maxlength="24" value="${escapeHtml(this.draftName ?? colonyName(sim))}">${button(t('colony.rename'), 'rename', {}, { cls: 'sm' })}</div>`;
    // The plan.
    html += `<h3>📐 ${escapeHtml(t('colony.plan'))}</h3>`;
    if (!C.layout) html += `<div class="hint">${escapeHtml(t('colony.plan_hint'))}</div><div class="btn-row">${Object.keys(LAYOUTS).map((id) => button(t(`colony_layout.${id}`), 'layout', { id }, { cls: 'sm primary', ico: id === 'street' ? '🛣️' : '🌳' })).join('')}</div>`;
    else {
      const plots = C.plan.filter((p) => p.kind === 'home');
      html += `<div class="small">${escapeHtml(t('colony.plan_done', { layout: t(`colony_layout.${C.layout}`), n: plots.filter((p) => p.site).length, of: plots.length }))}</div>`;
    }
    // Settlers.
    html += `<h3>👪 ${escapeHtml(t('colony.settlers'))}</h3>`;
    html += settlers.length ? `<div class="chips">${settlers.map((n) => `<span class="chip" data-action="inspect" data-id="${n.id}">${escapeHtml(npcName(n))}${n.colonyWaiting ? ' ⏳' : ''}</span>`).join('')}</div>` : '';
    html += `<div class="hint">${escapeHtml(t('colony.settlers_hint'))}</div>`;
    // The store, for the winter.
    const need = K.winterNeed();
    const days = K.daysOfWinter();
    html += `<h3>🧺 ${escapeHtml(t('colony.store'))}</h3>`;
    const stock = Object.entries(C.stock).filter(([, n]) => n > 0);
    html += stock.length ? `<div class="bc-stock">${stock.map(([id, n]) => `<span class="bc-item" title="${escapeHtml(itemName(id))}">${icon(id, 18)}${n}</span>`).join('')}</div>` : `<div class="muted small">${escapeHtml(t('colony.store_empty'))}</div>`;
    if (settlers.length) {
      const winter = 14;
      html += progress(Math.min(100, (days / winter) * 100), { label: t('colony.winter_days', { food: need.food, wood: need.wood }), value: days === Infinity ? '∞' : t('colony.days_n', { n: days }), kind: days < winter ? 'warn' : '' });
      if (C.hungry) html += notice('danger', escapeHtml(t('colony.hungry', { n: C.hungry, max: COLONY.hungryDaysToLeave })));
    }
    html += `<div class="hint">${escapeHtml(t('colony.store_hint'))}</div>`;
    // Purse, taxes, landmarks.
    html += `<h3>💰 ${escapeHtml(t('colony.purse'))}</h3>`;
    html += `<div class="setting-row"><div><b>${escapeHtml(t('colony.tax'))}</b><div class="hint">${escapeHtml(t(`colony.tax_${C.tax}`, { n: COLONY.tax[C.tax] }))}</div></div><div class="btn-row">${Object.keys(COLONY.tax).map((r) => button(t(`prio.${r === 'normal' ? 'medium' : r}`), 'tax', { r }, { cls: `sm ${C.tax === r ? 'selected' : 'ghost'}` })).join('')}</div></div>`;
    html += `<div class="setting-row"><div><b>${escapeHtml(t('colony.donate'))}</b><div class="hint">${escapeHtml(t('colony.donate_hint'))}</div></div><div class="btn-row">${[50, 200].map((m) => button(`+${fmtMoney(m)}`, 'donate', { m }, { cls: 'sm', disabled: sim.state.player.money < m })).join('')}</div></div>`;
    for (const [key, L] of Object.entries(LANDMARKS)) {
      const chk = K.canBuild(key);
      const state = K.built(key) ? status(t('colony.built'), 'good', '✓') : C.plan.find((p) => p.kind === key)?.site ? status(t('colony.building'), 'info', '🏗️') : '';
      html += `<div class="setting-row"><div><b>${L.icon} ${escapeHtml(t(`colony_landmark.${key}`))}</b> ${state}<div class="hint">${escapeHtml(t(`colony_landmark.${key}_desc`, { money: fmtMoney(L.cost) }))}</div></div>${state ? '' : button(t('colony.build', { money: fmtMoney(L.cost) }), 'build', { key }, { cls: 'sm', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>`;
    }
    const log = C.log.slice(0, 6).map((e) => `<div class="rumor small">${escapeHtml(tr(sim, `colony_log.${e.key}`, { ...e.params, layout: e.params.layout ? t(`colony_layout.${e.params.layout}`) : undefined, landmark: e.params.landmark ? t(`colony_landmark.${e.params.landmark}`) : undefined }))}</div>`).join('');
    if (log) html += `<h3>${escapeHtml(t('colony.log'))}</h3>${log}`;
    return html;
  }

  onAction(action, data) {
    const sim = this.sim;
    const K = sim.colony;
    const warn = (r) => !r.ok && sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    if (action === 'rename') {
      warn(K.rename(this.draftName ?? ''));
      this.draftName = null;
    } else if (action === 'layout') warn(K.setLayout(data.id));
    else if (action === 'tax') K.setTax(data.r);
    else if (action === 'donate') warn(K.donate(Number(data.m)));
    else if (action === 'build') {
      const r = K.build(data.key);
      warn(r);
    } else if (action === 'inspect') this.ui.openInspect(data.id);
  }
}
