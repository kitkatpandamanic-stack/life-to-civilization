/**
 * Your mine (MineSystem): how deep it goes and what each level gives, the timber supports and how safe the
 * tunnels are, what came up today — and digging the next level, shoring the tunnels up.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, progress, notice, icon } from '../widgets.js';
import { MINE } from '../../systems/MineSystem.js';

export class MinePanel extends Panel {
  constructor(ui, bizId) {
    super(ui);
    this.bizId = bizId;
  }
  get id() {
    return 'mine';
  }
  title() {
    const b = this.sim.economy.biz(this.bizId);
    return `⛏️ ${escapeHtml(t('mine.title'))}${b ? ` — ${escapeHtml(buildingLabel(this.sim, b.building))}` : ''}`;
  }

  render() {
    const sim = this.sim;
    const M = sim.mines;
    const id = this.bizId;
    const m = M.mine(id);
    const b = sim.economy.biz(id);
    if (!b) return `<div class="muted">—</div>`;
    const miners = sim.state.npcs.filter((n) => n.employer === id).length;
    const levels = [];
    for (let d = 1; d <= MINE.maxDepth; d++) {
      const y = d === 1 ? null : M.yieldAt(d);
      const ores = d === 1 ? escapeHtml(t('mine.surface')) : Object.entries(y).map(([item, n]) => `${icon(item, 16)} ${escapeHtml(itemName(item))} ${n < 0.2 ? '·' : `×${n}`}`).join(' ');
      levels.push(`<div class="kv ${d <= m.depth ? '' : 'muted'}"><span>${d <= m.depth ? '⬇️' : '🔒'} ${escapeHtml(t('mine.level_n', { n: d }))}</span><b class="small">${ores}</b></div>`);
    }
    const safety = M.safety(id);
    const risk = M.risk(id);
    const dig = M.canDig(id);
    const cost = MINE.digCost(m.depth);
    const shore = M.canShore(id, 1);
    const stock = ['stone', 'coal', 'iron_ore', 'gemstone'].filter((i) => b.stock[i] > 0).map((i) => `${icon(i, 16)} ${escapeHtml(itemName(i))} ${b.stock[i]}`).join(' · ');
    return `
      ${M.halted(id) ? notice('danger', escapeHtml(t('mine.caved_in', { n: m.haltUntil - sim.time.day }))) : ''}
      <div class="kv"><span>${escapeHtml(t('mine.depth'))}</span><b>${escapeHtml(t('mine.level_n', { n: m.depth }))} / ${MINE.maxDepth}</b></div>
      <div class="kv"><span>${escapeHtml(t('mine.miners'))}</span><b>${miners}</b></div>
      <div class="kv"><span>${escapeHtml(t('mine.in_store'))}</span><b class="small">${stock || '—'}</b></div>
      <h3>${escapeHtml(t('mine.levels'))}</h3>
      ${levels.join('')}
      <div class="btn-row">${button(t('mine.dig', { n: m.depth + 1, planks: cost.planks, money: fmtMoney(cost.money) }), 'dig', {}, { cls: 'primary', ico: '⛏️', disabled: !dig.ok, title: dig.ok ? '' : tr(sim, `reason.${dig.reason}`, dig.params || {}) })}</div>
      ${m.depth > 1 ? `<h3>${escapeHtml(t('mine.supports'))}</h3>
      ${progress(safety * 100, { label: t('mine.shored', { n: m.supports, of: M.maxSupports(id) }), kind: safety >= 0.75 ? 'good' : safety >= 0.4 ? 'warn' : 'danger' })}
      <div class="small ${risk > 0.1 ? 'warn' : 'muted'}">${escapeHtml(t('mine.risk', { n: Math.round(risk * 100) }))}</div>
      <div class="btn-row">${button(t('mine.shore', { n: MINE.supportsPerLevel }), 'shore', {}, { ico: '🪵', disabled: !shore.ok, title: shore.ok ? '' : tr(sim, `reason.${shore.reason}`, shore.params || {}) })}</div>` : ''}
      <div class="hint">${escapeHtml(t('mine.hint'))}</div>`;
  }

  onAction(action) {
    const sim = this.sim;
    if (action === 'dig') {
      const r = sim.mines.dig(this.bizId);
      if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      else sim.toast('toast.mine_dug', { n: r.depth }, 'good');
    }
    if (action === 'shore') {
      const r = sim.mines.shore(this.bizId);
      if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    }
  }
}
