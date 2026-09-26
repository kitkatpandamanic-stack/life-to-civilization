/**
 * Standing orders — carrying you set up once and your workers keep doing (StandingOrders):
 * "move 60 wood a day from the lumberyard to my warehouse", "keep 50 planks in my storage",
 * "keep my building site supplied". Each order: how it's going today, who's on it, pause or
 * cancel it; and a simple form to make a new one (pick what, from where, to where, how much).
 */
import { Panel } from '../Panel.js';
import { t, npcName, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel } from '../format.js';
import { button, status, emptyState, bar } from '../widgets.js';
import { ORDER_KINDS, ORDER_TUNING } from '../../systems/StandingOrders.js';
import { GATHERABLE } from '../../systems/ContractSystem.js';

const COMMON = ['wood', 'stone', 'planks', 'bricks', 'clay', 'iron_ore', 'coal', 'wheat', 'flour', 'berries'];
const STATE_LOOK = { working: ['good', '🚚'], done_today: ['good', '✅'], waiting: ['info', '⏳'], paused: ['neutral', '⏸️'], no_source: ['warn', '📭'], no_money: ['warn', '💸'], no_target: ['danger', '⛔'] };

export class OrdersPanel extends Panel {
  constructor(ui, opts = {}) {
    super(ui);
    this.draft = { kind: 'move', item: 'wood', from: 'auto', to: 'store', qty: 50, workers: [], prio: 'medium', ...(opts.draft || {}) };
    this.form = !this.sim.workers.orderList().length || !!opts.draft;
  }
  get id() {
    return 'orders';
  }
  title() {
    return `🔁 ${escapeHtml(t('orders.title'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  /** "Your storage", "the lumberyard", "the barn site", "buy it", "gather it", "wherever it is". */
  placeName(place) {
    const sim = this.sim;
    if (place === 'store') return t('orders.place_store');
    if (['buy', 'gather', 'auto'].includes(place)) return t(`orders.src_${place}`);
    if (String(place).startsWith('biz:')) return buildingLabel(sim, sim.economy.biz(place.slice(4))?.building);
    if (String(place).startsWith('site:')) {
      const s = sim.construction.byId(place.slice(5));
      return s ? (s.kind === 'works' ? buildingLabel(sim, s.target) : t(sim.construction.isPlayers(s) ? `buildable.${s.type}.name` : `vbuilding.${s.type}`)) : '—';
    }
    return place;
  }

  /** One order in words: "Move 60 wood a day: the lumberyard → your storage". */
  summary(o) {
    if (o.kind === 'supply') return t('orders.sum_supply', { site: this.placeName(o.to), from: this.placeName(o.from) });
    return t(`orders.sum_${o.kind}`, { n: o.qty, item: itemName(o.item).toLowerCase(), from: this.placeName(o.from), to: this.placeName(o.to) });
  }

  orderCard(o) {
    const sim = this.sim;
    const W = sim.workers;
    const st = W.orderStatus(o);
    const [kind, ico] = STATE_LOOK[st.state] || STATE_LOOK.waiting;
    let prog = '';
    if (o.kind === 'move') prog = bar((o.moved / Math.max(1, o.qty)) * 100, 'xp', t('orders.today', { n: o.moved, max: o.qty }));
    else if (o.kind === 'keep') prog = bar((st.level / Math.max(1, o.qty)) * 100, st.level >= o.qty ? 'good' : 'warn', t('orders.level', { n: st.level, max: o.qty }));
    else prog = `<div class="small">${escapeHtml(t('orders.left', { n: st.left ?? 0 }))}</div>`;
    const who = o.workers.length ? o.workers.map((id) => npcName(sim.npcs.byId(id))).join(', ') : t('orders.anyone');
    const busy = st.busy.map((id) => npcName(sim.npcs.byId(id))).join(', ');
    return `<div class="card"><div class="card-head"><div class="card-icon">${o.kind === 'supply' ? '🏗️' : o.kind === 'keep' ? '📦' : '🔁'}</div>
      <div><div class="card-title">${escapeHtml(this.summary(o))}</div><div class="card-sub">${status(t(`orders.state.${st.state}`), kind, ico)} <span class="small muted">${escapeHtml(t(`prio.${o.prio}`))}</span></div></div></div>
      ${prog}
      <div class="small muted">${escapeHtml(t('orders.who', { list: who }))}${busy ? ` · ${escapeHtml(t('orders.busy', { list: busy }))}` : ''} · ${escapeHtml(t('orders.total', { n: o.total || 0 }))}</div>
      <div class="btn-row">
        ${o.kind !== 'supply' ? `${button('−', 'qty', { id: o.id, d: -ORDER_TUNING.step }, { cls: 'sm ghost' })}<b class="num">${o.qty}</b>${button('+', 'qty', { id: o.id, d: ORDER_TUNING.step }, { cls: 'sm ghost' })}` : ''}
        ${button(t(o.paused ? 'orders.resume' : 'orders.pause'), 'pause', { id: o.id }, { cls: 'sm' })}
        ${button(t('orders.cancel'), 'remove', { id: o.id }, { cls: 'sm ghost' })}
      </div></div>`;
  }

  /** The new-order form: each choice a row of buttons. */
  formHtml() {
    const sim = this.sim;
    const W = sim.workers;
    const d = this.draft;
    const chips = (list, key, label) => `<div class="setting-row"><span class="hint">${escapeHtml(label)}</span><div class="btn-row">${list.map(([v, text]) => button(text, 'draft', { k: key, v }, { cls: `sm ${String(d[key]) === String(v) ? 'selected' : 'ghost'}` })).join('')}</div></div>`;
    const mine = (sim.holdings?.mine() || []).map((id) => [`biz:${id}`, buildingLabel(sim, sim.economy.biz(id).building)]);
    let html = `<div class="card"><div class="stat-label">${escapeHtml(t('orders.new'))}</div>`;
    html += chips(ORDER_KINDS.map((k) => [k, t(`orders.kind.${k}`)]), 'kind', t('orders.f_kind'));
    html += `<div class="hint">${escapeHtml(t(`orders.kind_hint.${d.kind}`))}</div>`;
    if (d.kind === 'supply') {
      const C = sim.construction;
      const sites = C.sites().filter((s) => C.isPlayers(s) || s.supplier === 'player').map((s) => [`site:${s.id}`, this.placeName(`site:${s.id}`)]);
      if (!sites.length) html += `<div class="muted small">${escapeHtml(t('orders.no_sites'))}</div>`;
      else {
        if (!String(d.to).startsWith('site:')) d.to = sites[0][0];
        html += chips(sites, 'to', t('orders.f_site'));
        html += chips([['auto', t('orders.src_auto')], ['store', t('orders.place_store')], ['buy', t('orders.src_buy')]], 'from', t('orders.f_from'));
      }
    } else {
      if (String(d.to).startsWith('site:')) d.to = 'store';
      const items = [...new Set([...COMMON, ...sim.home.storage.map((s) => s.id), ...(sim.holdings?.mine() || []).flatMap((id) => Object.keys(sim.economy.biz(id)?.stock || {}))])].filter((i) => !['package'].includes(i)).slice(0, 18);
      html += chips(items.map((i) => [i, itemName(i)]), 'item', t('orders.f_item'));
      const froms = [['auto', t('orders.src_auto')], ['store', t('orders.place_store')], ...mine, ['buy', t('orders.src_buy')]];
      if (GATHERABLE[d.item] || d.item === 'clay') froms.push(['gather', t('orders.src_gather')]);
      html += chips(froms, 'from', t('orders.f_from'));
      html += chips([['store', t('orders.place_store')], ...mine], 'to', t('orders.f_to'));
      html += `<div class="setting-row"><span class="hint">${escapeHtml(t(d.kind === 'keep' ? 'orders.f_keep' : 'orders.f_qty'))}</span><div class="btn-row">${button('−50', 'dqty', { d: -50 }, { cls: 'sm ghost' })}${button('−10', 'dqty', { d: -10 }, { cls: 'sm ghost' })}<b class="num">${d.qty}</b>${button('+10', 'dqty', { d: 10 }, { cls: 'sm ghost' })}${button('+50', 'dqty', { d: 50 }, { cls: 'sm ghost' })}</div></div>`;
    }
    const ws = W.list();
    html += `<div class="setting-row"><span class="hint">${escapeHtml(t('orders.f_workers'))}</span><div class="btn-row">${button(t('orders.anyone'), 'dworker', { id: '' }, { cls: `sm ${d.workers.length ? 'ghost' : 'selected'}` })}${ws.map((c) => button(npcName(sim.npcs.byId(c.npcId)), 'dworker', { id: c.npcId }, { cls: `sm ${d.workers.includes(c.npcId) ? 'selected' : 'ghost'}` })).join('')}</div></div>`;
    html += chips(['high', 'medium', 'low'].map((p) => [p, t(`prio.${p}`)]), 'prio', t('orders.f_prio'));
    const chk = W.canOrder({ ...d, item: d.kind === 'supply' ? null : d.item });
    html += `<div class="btn-row">${button(t('orders.create'), 'create', {}, { cls: 'primary', disabled: !chk.ok || !ws.length, title: !ws.length ? t('orders.need_workers') : chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}${W.orderList().length ? button(t('ui.cancel'), 'form', {}, { cls: 'ghost' }) : ''}</div>`;
    if (!ws.length) html += `<div class="warn small">${escapeHtml(t('orders.need_workers'))}</div>`;
    return html + '</div>';
  }

  render() {
    const W = this.sim.workers;
    const list = W.orderList();
    let html = `<div class="hint">${escapeHtml(t('orders.hint'))}</div>`;
    if (this.form) html += this.formHtml();
    else html += `<div class="btn-row">${button(`➕ ${t('orders.new')}`, 'form', {}, { cls: 'primary' })}</div>`;
    html += list.map((o) => this.orderCard(o)).join('') || (this.form ? '' : emptyState('🔁', t('orders.none'), t('orders.none_hint')));
    return html;
  }

  onAction(action, data) {
    const W = this.sim.workers;
    const d = this.draft;
    if (action === 'form') this.form = !this.form;
    else if (action === 'draft') {
      d[data.k] = data.v;
      if (data.k === 'item' && d.from === 'gather' && !GATHERABLE[d.item] && d.item !== 'clay') d.from = 'auto';
    } else if (action === 'dqty') d.qty = Math.max(ORDER_TUNING.step, Math.min(ORDER_TUNING.maxQty, d.qty + Number(data.d)));
    else if (action === 'dworker') {
      if (!data.id) d.workers = [];
      else d.workers = d.workers.includes(data.id) ? d.workers.filter((x) => x !== data.id) : [...d.workers, data.id];
    } else if (action === 'create') {
      const r = W.addOrder({ ...d });
      if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      else {
        this.form = false;
        this.sim.toast('toast.order_made', {}, 'good');
      }
    } else if (action === 'qty') {
      const o = W.orderById(data.id);
      if (o) W.setOrder(o.id, { qty: Math.max(ORDER_TUNING.step, o.qty + Number(data.d)) });
    } else if (action === 'pause') {
      const o = W.orderById(data.id);
      if (o) W.setOrder(o.id, { paused: !o.paused });
    } else if (action === 'remove') W.removeOrder(data.id);
  }
}
