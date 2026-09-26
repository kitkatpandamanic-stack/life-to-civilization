/**
 * Your business rival (RivalSystem): who they are, what they've been up to, and what you can do —
 * a price war, a partnership, or buying them out.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, emptyState, statGrid, stat, notice } from '../widgets.js';
import { RIVAL } from '../../systems/RivalSystem.js';

export class RivalPanel extends Panel {
  get id() {
    return 'rival';
  }
  title() {
    return `⚔️ ${escapeHtml(t('rival.title'))}`;
  }

  render() {
    const sim = this.sim;
    const V = sim.rival;
    const R = V.R;
    if (!R) return emptyState('⚔️', t('rival.none'), t('rival.none_text', { level: RIVAL.appearLevel }));
    const n = V.npc();
    const s = V.summary();
    let html = `<p>${escapeHtml(tr(sim, `rival.stage_${R.stage}`, { npc: R.npc }))}</p>`;
    html += statGrid([
      stat(t('rival.money'), fmtMoney(s.money)),
      stat(t('rival.crew'), String(s.crew)),
      stat(t('rival.took'), String(s.took)),
      stat(t('rival.plots'), String(s.plots)),
      stat(t('rival.friendship'), `${Math.round(n?.rel || 0)}/100`),
    ]);
    if (V.atWar()) html += notice('warn', escapeHtml(t('rival.war_on', { n: R.warUntil - sim.time.day })), '⚔️');
    if (R.stage === 'rival' || R.stage === 'partner') {
      const card = (ico, title, text, action, chk, label) => `<div class="card"><div class="card-title">${ico} ${escapeHtml(title)}</div><div class="small">${escapeHtml(text)}</div>
        ${chk.ok ? '' : `<div class="small warn">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}
        <div class="btn-row">${button(label, action, {}, { cls: 'sm', disabled: !chk.ok })}</div></div>`;
      if (R.stage === 'rival') {
        html += card('📉', t('rival.war_title'), t('rival.war_text', { money: fmtMoney(RIVAL.warCost), n: RIVAL.warDays }), 'war', V.canWar(), t('rival.war_do', { money: fmtMoney(RIVAL.warCost) }));
        html += card('🤝', t('rival.partner_title'), t('rival.partner_text', { n: Math.round(RIVAL.partnerShare * 100), rel: RIVAL.partnerRel }), 'partner', V.canPartner(), t('rival.partner_do'));
      } else html += `<div class="btn-row">${button(t('rival.split'), 'split', {}, { cls: 'sm ghost' })}</div>`;
      html += card('💰', t('rival.buy_title'), t('rival.buy_text'), 'buy', V.canBuyOut(), t('rival.buy_do', { money: fmtMoney(V.buyOutPrice()) }));
    }
    if (R.log.length) {
      html += `<h4>${escapeHtml(t('rival.log'))}</h4>${R.log
        .slice(0, 10)
        .map((e) => `<div class="small">${escapeHtml(t('ui.day_n', { n: e.day }))} · ${escapeHtml(tr(sim, `rival.log_${e.kind}`, { ckind: e.ckind, money: fmtMoney(e.money || 0), plot: e.plot, npc: e.npc, rival: npcName(n) }))}</div>`)
        .join('')}`;
    }
    return html;
  }

  onAction(action) {
    const V = this.sim.rival;
    const r = action === 'war' ? V.priceWar() : action === 'partner' ? V.partner() : action === 'split' ? V.endPartnership() : action === 'buy' ? V.buyOut() : null;
    if (r && !r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
  }
}
