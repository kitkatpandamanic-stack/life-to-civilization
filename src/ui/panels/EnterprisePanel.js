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
  constructor(ui, bizId, focus = null) {
    super(ui);
    this.bizId = bizId;
    this.focus = focus; // 'workers': your workers to send here, shown first
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
        const yours = n.crew ? ` <span class="chip">👷 ${escapeHtml(t('biz.your_worker'))}</span>` : '';
        const back = n.crew ? button(t('biz.call_back'), 'recall', { id: n.id }, { cls: 'sm ghost', disabled: !sim.holdings.canRecall(n.id).ok, title: sim.holdings.canRecall(n.id).ok ? '' : tr(sim, `reason.${sim.holdings.canRecall(n.id).reason}`, sim.holdings.canRecall(n.id).params || {}) }) : '';
        return `<div class="person clickable" data-action="inspect_npc" data-id="${n.id}">${portrait(`npc_${sim.state.seed}_${n.id}`, n.look, 32)}<div><b>${escapeHtml(npcName(n))}</b>${mgr ? ` <span class="chip">${escapeHtml(t('biz.manager'))}</span>` : ''}${yours}<div class="muted small">${escapeHtml(npcRole(sim, n))} · ${escapeHtml(t('ui.level_n', { level: n.level }))} · ${fmtMoney(sim.npcs.wageFor(this.bizId, n))}</div>${back ? `<div>${back}</div>` : ''}</div>${mgr ? '' : button(t('biz.make_manager'), 'manager', { id: n.id })}</div>`;
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
          ${this.focus === 'workers' ? this.postHtml(def) : ''}
          <h3>${escapeHtml(t('biz.stock'))}</h3>
          ${stock || `<div class="muted small">${escapeHtml(t('biz.no_stock'))}</div>`}
          <h3>${escapeHtml(t('biz.staff'))} <span class="muted small">${staff.length} / ${b.maxWorkers ?? def.maxWorkers ?? 0}</span></h3>
          ${people ? `<div class="people">${people}</div>` : `<div class="muted small">${escapeHtml(t('biz.no_staff'))}</div>`}
          ${this.focus === 'workers' ? '' : this.postHtml(def)}
          <h3>${escapeHtml(t('biz.orders'))}</h3>
          ${orders + offers || `<div class="muted small">${escapeHtml(t('biz.no_orders'))}</div>`}
          ${def.kind === 'depot' ? this.routeHtml(b, def) : ''}
        </div>
      </div>`;
  }

  /** Your own workers, to send here: onto the staff (or to run it). */
  postHtml(def) {
    const sim = this.sim;
    if (!def.workerOccupation) return '';
    const list = sim.workers.list().map((c) => sim.npcs.byId(c.npcId)).filter(Boolean);
    if (!list.length) return '';
    const rows = list.map((n) => {
      const chk = sim.holdings.canPost(this.bizId, n.id);
      const why = chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {});
      return `<div class="setting-row"><div><b>${escapeHtml(npcName(n))}</b> <span class="muted small">${escapeHtml(t('ui.level_n', { level: n.level }))}</span></div>
        <div class="btn-row">${button(t('biz.post_worker'), 'post', { id: n.id }, { cls: 'sm', disabled: !chk.ok, title: why })}${button(t('biz.post_manager'), 'post', { id: n.id, mgr: 1 }, { cls: 'sm ghost', disabled: !chk.ok, title: why })}</div></div>`;
    }).join('');
    return `<h3>${escapeHtml(t('biz.send_workers'))}</h3><div class="muted small">${escapeHtml(t('biz.send_hint'))}</div>${rows}`;
  }

  /** A warehouse or trading post sends caravans to other settlements: where, with what, and what to bring back. */
  routeHtml(b, def) {
    const sim = this.sim;
    const S = sim.settlements;
    const contacts = S.contacts();
    const r = b.route;
    const c = sim.state.region.caravans.find((x) => x.biz === this.bizId);
    const status = c
      ? tr(sim, c.stage === 'out' ? 'biz.caravan_out' : 'biz.caravan_back', { settlement: c.to, n: Math.max(1, Math.ceil(((c.stage === 'out' ? c.arrive : c.back) - sim.time.total) / 1440)) })
      : t('biz.caravan_home');
    let html = `<h3>${escapeHtml(t('biz.trade_route'))}</h3><div class="muted small">${escapeHtml(status)}</div>`;
    if (!contacts.length) return html + `<div class="muted small">${escapeHtml(t('biz.route_no_contacts'))}</div>`;
    const dest = r ? t(`settlement_name.${r.to}`) : t('biz.route_auto');
    html += `<div class="kv"><span>${escapeHtml(t('biz.route_to'))}</span><b>${button(dest, 'route_to')}</b></div>`;
    if (r) {
      const sellable = Object.keys(def.targets || {});
      html += `<div class="kv"><span>${escapeHtml(t('biz.route_sell'))}</span><b class="chips">${sellable.map((i) => `<span class="chip clickable${r.sell.includes(i) ? '' : ' muted'}" data-action="route_sell" data-item="${i}">${escapeHtml(itemName(i))}</span>`).join('')}</b></div>`;
      const buyable = Object.keys(S.def(r.to).produces);
      html += `<div class="kv"><span>${escapeHtml(t('biz.route_buy'))}</span><b>${button(r.buy ? itemName(r.buy) : t('biz.route_nothing'), 'route_buy', { opts: buyable.join(',') })}</b></div>`;
    }
    return html + `<div class="muted small">${escapeHtml(t('biz.route_hint'))}</div>`;
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
      case 'post': {
        const r = H.post(this.bizId, data.id, { manager: !!data.mgr });
        if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        break;
      }
      case 'recall': {
        const r = H.recall(data.id);
        if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        break;
      }
      case 'route_to': {
        // Cycle: automatic → each settlement you trade with → automatic.
        const S = this.sim.settlements;
        const list = [null, ...S.contacts()];
        const next = list[(list.indexOf(b.route?.to ?? null) + 1) % list.length];
        S.setRoute(this.bizId, next ? { to: next, sell: b.route?.sell || [], buy: null } : null);
        break;
      }
      case 'route_sell': {
        const sell = new Set(b.route.sell);
        if (sell.has(data.item)) sell.delete(data.item);
        else sell.add(data.item);
        this.sim.settlements.setRoute(this.bizId, { ...b.route, sell: [...sell] });
        break;
      }
      case 'route_buy': {
        const opts = [null, ...String(data.opts).split(',').filter(Boolean)];
        const next = opts[(opts.indexOf(b.route.buy ?? null) + 1) % opts.length];
        this.sim.settlements.setRoute(this.bizId, { ...b.route, buy: next });
        break;
      }
      case 'inspect_npc':
        this.ui.openInspect(data.id);
        break;
    }
  }
}
