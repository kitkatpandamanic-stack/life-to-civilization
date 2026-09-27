/**
 * Your market stall on the square (StallSystem): rent it for the day, set out what you've got, choose your
 * prices — and watch it sell through the day. What's left at closing time comes back to you.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName, npcName } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, icon, notice } from '../widgets.js';
import { STALL } from '../../systems/StallSystem.js';

export class StallPanel extends Panel {
  get id() {
    return 'stall';
  }
  title() {
    return `🧺 ${escapeHtml(t('stall.title'))}`;
  }

  render() {
    const sim = this.sim;
    const St = sim.stall;
    const S = St.S;
    if (!St.rentedToday()) {
      const chk = St.canOpen();
      return `
        <div class="desc">${escapeHtml(t('stall.intro', { money: fmtMoney(STALL.rent), from: STALL.open, to: STALL.close }))}</div>
        ${S.days ? `<div class="muted small">${escapeHtml(t('stall.so_far', { n: S.days, money: fmtMoney(S.total || 0) }))}</div>` : ''}
        <div class="btn-row">${button(t('stall.rent', { money: fmtMoney(STALL.rent) }), 'rent', {}, { cls: 'primary', ico: '🧺', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>
        ${chk.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}`;
    }
    const open = St.isOpen();
    const h = sim.time.hour;
    const state = open ? t('stall.open_until', { hour: STALL.close }) : h < STALL.open ? t('stall.opens_at', { hour: STALL.open }) : t('stall.closed_today');
    // On the stall.
    const goods = Object.entries(S.goods)
      .map(([item, q]) => `<div class="kv">${icon(item, 20)} <span>${escapeHtml(itemName(item))} ×${q}</span><b>${escapeHtml(fmtMoney(St.price(item)))}</b><span class="muted small">${escapeHtml(t('stall.per_hour', { n: St.demand(item).toFixed(1) }))}</span>${button(t('stall.take_back'), 'take', { item }, { cls: 'sm' })}</div>`)
      .join('');
    // What you could put out.
    const have = [...new Set(sim.inventory.slots.filter(Boolean).map((s) => s.id))].filter((id) => St.sellable(id));
    const put = have
      .map((item) => {
        const n = sim.inventory.count(item);
        return `<div class="kv">${icon(item, 20)} <span>${escapeHtml(itemName(item))} ×${n}</span><b class="muted small">${escapeHtml(t('stall.shops_ask', { money: fmtMoney(Math.round(St.reference(item))) }))}</b>${button('+1', 'put', { item, n: 1 }, { cls: 'sm' })}${n > 1 ? button(t('stall.all'), 'put', { item, n }, { cls: 'sm' }) : ''}</div>`;
      })
      .join('');
    const markups = STALL.markups.map((m) => button(t(`stall.markup_${String(m).replace('.', '_')}`), 'markup', { m }, { cls: m === S.markup ? 'primary sm' : 'sm' })).join(' ');
    const sold = S.sold
      .slice(-8)
      .reverse()
      .map((x) => `<div class="small">${String(x.hour).padStart(2, '0')}:00 · ${escapeHtml(itemName(x.item))} ×${x.qty} · ${escapeHtml(fmtMoney(x.money))}${x.npc ? ` · ${escapeHtml(npcName(sim.npcs.byId(x.npc)))}` : ''}</div>`)
      .join('');
    return `
      ${notice(open ? 'info' : 'warn', escapeHtml(state))}
      <div class="kv"><span>${escapeHtml(t('stall.earned'))}</span><b>${escapeHtml(fmtMoney(S.earned))}</b></div>
      <h3>${escapeHtml(t('stall.prices'))}</h3>
      <div class="btn-row">${markups}</div>
      <div class="muted small">${escapeHtml(t('stall.prices_hint'))}</div>
      <h3>${escapeHtml(t('stall.on_stall'))}</h3>
      ${goods || `<div class="muted small">${escapeHtml(t('stall.empty'))}</div>`}
      <h3>${escapeHtml(t('stall.your_goods'))}</h3>
      ${put || `<div class="muted small">${escapeHtml(t('stall.nothing_to_sell'))}</div>`}
      ${sold ? `<h3>${escapeHtml(t('stall.sold'))}</h3>${sold}` : ''}
      <div class="hint">${escapeHtml(t('stall.hint'))}</div>`;
  }

  onAction(action, data) {
    const St = this.sim.stall;
    let r = null;
    if (action === 'rent') r = St.open();
    else if (action === 'put') r = St.put(data.item, Number(data.n));
    else if (action === 'take') r = St.take(data.item);
    else if (action === 'markup') St.setMarkup(Number(data.m));
    if (r && !r.ok && r.reason) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
  }
}
