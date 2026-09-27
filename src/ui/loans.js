/**
 * Big loans (FinanceSystem): who'd lend to you, on what terms, your credit record — and the loan you have.
 * Shown in Your affairs (money) and at the village hall.
 */
import { t, fmtMoney } from '../i18n/i18n.js';
import { escapeHtml, tr } from './format.js';
import { button, bar } from './widgets.js';
import { BANK_LOANS } from '../systems/FinanceSystem.js';

const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;

export function bigLoansHtml(sim) {
  const F = sim.finance;
  const p = sim.state.player;
  const lender = F.lender();
  const credit = F.credit();
  const creditWord = credit >= 75 ? 'good' : credit >= 45 ? 'fair' : credit >= 20 ? 'poor' : 'bad';
  const L = p.bankLoan;
  let body;
  if (L) {
    const paid = Math.max(0, 1 - L.left / Math.round(L.amount * (1 + F.bankTerms(L.amount, L.lender).rate)));
    body = `${kv(t(`loans.from_${L.lender}`), `${escapeHtml(fmtMoney(L.left))} ${escapeHtml(t('loans.left'))}`)}
      ${bar(paid * 100, 'gold')}
      ${kv(t('loans.weekly'), escapeHtml(fmtMoney(L.weekly)))}
      ${L.missed ? `<div class="notice warn">⚠️ ${escapeHtml(t('loans.missed', { n: L.missed, of: BANK_LOANS.defaultAfter }))}</div>` : ''}
      <div class="btn-row">${[100, 500].map((m) => button(t('loans.repay_n', { money: fmtMoney(Math.min(m, L.left)) }), 'bank_repay', { n: m }, { cls: 'sm', disabled: p.money < 1 })).join('')}${button(t('loans.repay_all', { money: fmtMoney(L.left) }), 'bank_repay', { n: L.left }, { cls: 'sm', disabled: p.money < L.left })}</div>`;
  } else {
    body = `<div class="btn-row">${BANK_LOANS.sizes
      .map((m) => {
        const c = F.canBankBorrow(m);
        const T = F.bankTerms(m);
        const title = c.ok ? t('loans.terms', { rate: Math.round(T.rate * 100), weeks: T.weeks, money: fmtMoney(T.weekly) }) : tr(sim, `reason.${c.reason}`, c.params || {});
        return button(t('ui.borrow_n', { money: fmtMoney(m) }), 'bank_borrow', { n: m }, { cls: 'sm', disabled: !c.ok, title });
      })
      .join('')}</div>
      <div class="muted small">${escapeHtml(t('loans.hint', { n: BANK_LOANS.defaultAfter }))}</div>`;
  }
  return `<h3>🏦 ${escapeHtml(t('loans.title'))}</h3>
    ${kv(t('loans.lender'), escapeHtml(t(`loans.lender_${lender}`)))}
    ${kv(t('loans.credit'), `${credit}/100 · ${escapeHtml(t(`loans.credit_${creditWord}`))}`)}
    ${L ? '' : kv(t('loans.limit'), escapeHtml(fmtMoney(F.bankLimit())))}
    ${body}`;
}

/** Handle the loan buttons; true if it was one of them. */
export function bigLoansAction(sim, action, data) {
  if (action === 'bank_borrow') {
    const r = sim.finance.bankBorrow(Number(data.n));
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    else sim.toast('toast.bank_loan_taken', { money: Number(data.n), lender: r.terms.lender }, 'good');
    return true;
  }
  if (action === 'bank_repay') {
    sim.finance.bankRepay(Number(data.n));
    return true;
  }
  return false;
}
