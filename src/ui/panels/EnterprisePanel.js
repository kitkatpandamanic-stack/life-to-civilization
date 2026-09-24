/**
 * Your business — the one you bought or opened among the village's businesses.
 * The books (where the money came from and went), the till, the stock, prices,
 * wages, staff and manager, and orders from other businesses.
 */
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney, itemName } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, npcRole, tr } from '../format.js';
import { button, icon, portrait } from '../widgets.js';
import { contractCard, contractAction } from '../contracts.js';

export class EnterprisePanel extends Panel {
  constructor(ui, bizId) {
    super(ui);
    this.bizId = bizId;
  }
  get id() {
    return 'enterprise';
  }
  title() {
    return `🏪 ${escapeHtml(buildingLabel(this.sim, this.sim.economy.biz(this.bizId)?.building))}`;
  }

  render() {
    const sim = this.sim;
    const E = sim.economy;
    const b = E.biz(this.bizId);
    if (!b || b.closed) return `<div class="muted">${escapeHtml(t('biz.closed'))}</div>`;
    const def = E.def(this.bizId);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const books = sim.enterprise.books(this.bizId, 7);
    const staff = sim.npcs.staffOf(this.bizId);
    const payroll = staff.reduce((s, n) => s + sim.npcs.wageFor(this.bizId, n), 0);
    const presence = sim.holdings.presence(this.bizId);
    const items = [...new Set([...(def.sells || []), ...Object.keys(def.recipes || {}), ...(def.buys || []), ...Object.keys(b.stock || {})])].filter((i) => (b.stock?.[i] || 0) > 0 || def.sells?.includes(i) || def.recipes?.[i]);
    const stock = items
      .map((i) => `<div class="kv"><span>${icon(i, 18)} ${escapeHtml(itemName(i))}</span><b>${Math.floor(E.stock(this.bizId, i))}${def.targets?.[i] ? ` / ${def.targets[i]}` : ''}${def.sells?.includes(i) ? ` · ${fmtMoney(E.unitPrice(this.bizId, i))}` : ''}</b></div>`)
      .join('');
    const people = staff
      .map((n) => {
        const mgr = b.manager === n.id;
        return `<div class="person clickable" data-action="inspect_npc" data-id="${n.id}">${portrait(`npc_${sim.state.seed}_${n.id}`, n.look, 32)}<div><b>${escapeHtml(npcName(n))}</b>${mgr ? ` <span class="chip">${escapeHtml(t('biz.manager'))}</span>` : ''}<div class="muted small">${escapeHtml(npcRole(sim, n))} · ${escapeHtml(t('ui.level_n', { level: n.level }))} · ${fmtMoney(sim.npcs.wageFor(this.bizId, n))}</div></div>${mgr ? '' : button(t('biz.make_manager'), 'manager', { id: n.id })}</div>`;
      })
      .join('');
    const orders = sim.state.contracts.active.filter((c) => c.kind === 'order' && c.supplierBiz === this.bizId).map((c) => contractCard(sim, c, 'active')).join('');
    const offers = sim.state.contracts.offers.filter((c) => c.kind === 'order' && c.supplierBiz === this.bizId).map((c) => contractCard(sim, c, 'offer')).join('');
    const step = (label, val, dec, inc) => `<div class="kv"><span>${escapeHtml(label)}</span><b>${button('−', dec)} ${val} ${button('+', inc)}</b></div>`;
    return `
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('biz.books'))}</h3>
          ${kv(t('biz.till'), fmtMoney(b.money))}
          ${kv(t('biz.revenue_week'), fmtMoney(books.rev))}
          ${kv(t('biz.expenses_week'), fmtMoney(books.exp))}
          ${kv(t('biz.profit_week'), `<span class="${books.profit >= 0 ? 'good' : 'warn'}">${fmtMoney(books.profit)}</span>`)}
          ${kv(t('biz.customers_week'), books.cust)}
          ${kv(t('biz.payroll_day'), fmtMoney(payroll))}
          ${kv(t('biz.reputation'), Math.round(b.reputation ?? 50))}
          ${b.quality !== undefined ? kv(t('biz.quality'), escapeHtml(t(`quality.${['crude', 'standard', 'fine', 'masterwork'][Math.max(0, Math.min(3, Math.round(b.quality)))]}`))) : ''}
          ${Object.entries(b.short || {}).map(([prod, s]) => `<div class="warn small">⚠️ ${escapeHtml(tr(sim, 'biz.short', { item: s.input, item2: prod, n: s.days }))}</div>`).join('')}
          <div class="btn-row">${button(t('biz.withdraw', { money: fmtMoney(50) }), 'withdraw', { n: 50 }, { disabled: b.money < 50 })}${button(t('biz.withdraw_all'), 'withdraw', { n: 999999 }, { disabled: b.money < 1 })}${button(t('biz.deposit', { money: fmtMoney(100) }), 'deposit', { n: 100 }, { disabled: sim.state.player.money < 100 })}</div>
          <h3>${escapeHtml(t('biz.running'))}</h3>
          ${def.kind === 'shop' ? step(t('biz.prices'), `${Math.round((b.markup ?? 1) * 100)}%`, 'price_down', 'price_up') : ''}
          ${def.workerOccupation ? step(t('biz.wages'), `${Math.round((b.wageLevel ?? 1) * 100)}%`, 'wage_down', 'wage_up') : ''}
          ${def.workerOccupation ? step(t('biz.staff_target'), b.maxWorkers ?? def.maxWorkers ?? 0, 'staff_down', 'staff_up') : ''}
          ${kv(t('biz.minded'), escapeHtml(t(presence >= 1 ? 'biz.minded_you' : presence > 0.6 ? 'biz.minded_manager' : 'biz.minded_nobody')))}
          <div class="muted small">${escapeHtml(t('biz.hint'))}</div>
        </div>
        <div class="col">
          <h3>${escapeHtml(t('biz.stock'))}</h3>
          ${stock || `<div class="muted small">${escapeHtml(t('biz.no_stock'))}</div>`}
          <h3>${escapeHtml(t('biz.staff'))} <span class="muted small">${staff.length} / ${b.maxWorkers ?? def.maxWorkers ?? 0}</span></h3>
          ${people ? `<div class="people">${people}</div>` : `<div class="muted small">${escapeHtml(t('biz.no_staff'))}</div>`}
          <h3>${escapeHtml(t('biz.orders'))}</h3>
          ${orders + offers || `<div class="muted small">${escapeHtml(t('biz.no_orders'))}</div>`}
        </div>
      </div>`;
  }

  onAction(action, data) {
    const H = this.sim.holdings;
    const b = this.sim.economy.biz(this.bizId);
    if (contractAction(this.sim, action, data)) return;
    switch (action) {
      case 'withdraw':
        H.withdraw(this.bizId, Number(data.n));
        break;
      case 'deposit':
        H.deposit(this.bizId, Number(data.n));
        break;
      case 'price_down':
        H.setMarkup(this.bizId, (b.markup ?? 1) - 0.05);
        break;
      case 'price_up':
        H.setMarkup(this.bizId, (b.markup ?? 1) + 0.05);
        break;
      case 'wage_down':
        H.setWageLevel(this.bizId, (b.wageLevel ?? 1) - 0.05);
        break;
      case 'wage_up':
        H.setWageLevel(this.bizId, (b.wageLevel ?? 1) + 0.05);
        break;
      case 'staff_down':
        H.setStaffTarget(this.bizId, (b.maxWorkers ?? this.sim.economy.def(this.bizId).maxWorkers ?? 0) - 1);
        break;
      case 'staff_up':
        H.setStaffTarget(this.bizId, (b.maxWorkers ?? this.sim.economy.def(this.bizId).maxWorkers ?? 0) + 1);
        break;
      case 'manager':
        H.appointManager(this.bizId, data.id);
        break;
      case 'inspect_npc':
        this.ui.openInspect(data.id);
        break;
    }
  }
}
