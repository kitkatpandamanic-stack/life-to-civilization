/**
 * Law and order (CrimeSystem): your storage's lock, the constable's post (you, if you take it), and the
 * thefts in the valley — open cases you can look into as constable, and those closed.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName, npcName } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, agoText } from '../format.js';
import { button, notice, emptyState } from '../widgets.js';
import { CRIME } from '../../systems/CrimeSystem.js';

export class LawPanel extends Panel {
  get id() {
    return 'law';
  }
  title() {
    return `⚖️ ${escapeHtml(t('law.title'))}`;
  }

  caseLine(c, open) {
    const sim = this.sim;
    const where = c.target === 'player' ? t('law.your_storage') : buildingLabel(sim, sim.economy.biz(c.target)?.building || '');
    const what = c.kind === 'money' ? fmtMoney(c.qty) : `${c.qty} × ${itemName(c.item)}`;
    const thief = sim.npcs.byId(c.thief);
    const status = c.solved ? t('law.solved', { name: thief ? npcName(thief) : '—', money: fmtMoney(c.fined || 0) }) : c.cold ? t('law.cold') : t('law.open');
    const chk = open ? sim.crime.canInvestigate(c.id) : null;
    return `<div class="card"><div class="card-head"><div class="card-icon">${c.solved ? '✅' : '🕵️'}</div><div><div class="card-title">${escapeHtml(t('law.case', { what, where }))}</div><div class="card-sub">${escapeHtml(agoText(sim.time.day - c.day))} · ${escapeHtml(status)}</div></div>
      ${open && !c.cold ? `<div class="card-end">${button(t('law.investigate'), 'investigate', { id: c.id }, { cls: 'sm', ico: '🔎', disabled: !chk.ok, title: chk.ok ? t('law.investigate_hint') : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>` : ''}</div></div>`;
  }

  render() {
    const sim = this.sim;
    const C = sim.crime;
    const p = sim.state.player;
    const open = C.open().filter((c) => !c.cold);
    const closed = C.S.cases.filter((c) => c.solved || c.cold).slice(-8).reverse();
    const lock = C.canLock();
    const post = C.canBeConstable();
    return `
      ${sim.civic?.has('watch') ? notice('info', escapeHtml(t('law.watch_on'))) : ''}
      <h3>🔒 ${escapeHtml(t('law.lock'))}</h3>
      <div class="desc">${escapeHtml(t(p.lock ? 'law.lock_on' : 'law.lock_off'))}</div>
      ${p.lock ? '' : `<div class="btn-row">${button(t('law.fit_lock', { money: fmtMoney(CRIME.lockCost) }), 'lock', {}, { disabled: !lock.ok, title: lock.ok ? '' : tr(sim, `reason.${lock.reason}`, lock.params || {}) })}</div>`}
      <h3>🛡️ ${escapeHtml(t('law.constable'))}</h3>
      <div class="desc">${escapeHtml(t(C.isConstable() ? 'law.you_constable' : 'law.constable_hint', { money: fmtMoney(CRIME.constablePay) }))}</div>
      <div class="btn-row">${C.isConstable() ? button(t('law.resign'), 'resign', {}, { cls: 'ghost sm' }) : button(t('law.take_post'), 'constable', {}, { cls: 'primary', disabled: !post.ok, title: post.ok ? '' : tr(sim, `reason.${post.reason}`, post.params || {}) })}</div>
      <h3>🕵️ ${escapeHtml(t('law.open_cases'))} (${open.length})</h3>
      ${open.length ? open.map((c) => this.caseLine(c, true)).join('') : emptyState('🌙', t('law.no_cases'))}
      ${closed.length ? `<h3>${escapeHtml(t('law.closed_cases'))}</h3>${closed.map((c) => this.caseLine(c, false)).join('')}` : ''}`;
  }

  onAction(action, data) {
    const sim = this.sim;
    const C = sim.crime;
    let r = null;
    if (action === 'lock') r = C.fitLock();
    if (action === 'constable') r = C.becomeConstable();
    if (action === 'resign') r = C.resign();
    if (action === 'investigate') return this.ui.scene.investigate(Number(data.id));
    if (r && !r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    else if (action === 'lock') sim.toast('toast.lock_fitted', {}, 'good');
    else if (action === 'constable') sim.toast('toast.now_constable', {}, 'good');
  }
}
