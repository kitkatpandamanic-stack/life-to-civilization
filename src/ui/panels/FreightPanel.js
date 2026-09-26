/**
 * Your carting business (FreightSystem): sign up as a carrier or run a company from your depot;
 * the deliveries you've taken on; and caravans — your cart, a driver and goods from your storage,
 * off to another settlement to sell (and bring something back).
 */
import { Panel } from '../Panel.js';
import { t, npcName, itemName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, status, emptyState, bar, tabs, statGrid, stat, notice, icon } from '../widgets.js';
import { FREIGHT, CARAVAN, RIVER } from '../../data/freight.js';
import { EQUIPMENT } from '../../data/transport.js';

const STEP = 10;

export class FreightPanel extends Panel {
  constructor(ui, opts = {}) {
    super(ui);
    this.tab = opts.tab || (this.sim.freight.company ? 'deliveries' : 'company');
    this.draft = { to: null, eq: null, driver: null, guard: null, cargo: {}, buy: null };
  }
  get id() {
    return 'freight';
  }
  title() {
    return `🛞 ${escapeHtml(t('freight.title'))}`;
  }

  tick(delta) {
    this.timer = (this.timer || 0) - delta;
    if (this.timer <= 0) {
      this.timer = 1000;
      this.ui.renderPanel();
    }
  }

  render() {
    const list = [
      ['company', t('freight.tab_company')],
      ['deliveries', `${t('freight.tab_deliveries')}${this.sim.freight.S.jobs.length ? ` (${this.sim.freight.S.jobs.length})` : ''}`],
      ['caravans', `${t('freight.tab_caravans')}${this.sim.freight.S.caravans.length ? ` (${this.sim.freight.S.caravans.length})` : ''}`],
    ];
    const body = this.tab === 'deliveries' ? this.deliveriesHtml() : this.tab === 'caravans' ? this.caravansHtml() : this.companyHtml();
    return tabs(list, this.tab) + body;
  }

  // ------------------------------------------------------------------ the company

  companyHtml() {
    const sim = this.sim;
    const F = sim.freight;
    const c = F.company;
    let html = `<p class="muted">${escapeHtml(t('freight.intro'))}</p>`;
    if (!c) {
      html += `<div class="card"><div class="card-title">🧍 ${escapeHtml(t('freight.self_title'))}</div><div class="small">${escapeHtml(t('freight.self_text'))}</div>
        <div class="btn-row">${button(t('freight.sign_up'), 'sign_up', {}, { cls: 'primary' })}</div></div>`;
    } else {
      const s = F.summary();
      html += statGrid([
        stat(t('freight.kind'), escapeHtml(t(`freight.kind_${c.kind}`))),
        stat(t('freight.rep'), `${Math.round(c.rep)}/100`),
        stat(t('freight.share'), `${s.share}%`),
        stat(t('freight.open'), `${s.open}/${s.capacity}`),
        stat(t('freight.delivered'), String(c.delivered)),
        stat(t('freight.earned'), fmtMoney(c.earned)),
      ]);
      html += `<div class="setting-row"><div><b>${escapeHtml(t('freight.rate'))}</b><div class="hint">${escapeHtml(t('freight.rate_hint'))}</div></div><div class="btn-row">${Object.keys(FREIGHT.rates)
        .map((r) => button(t(`freight.rate_${r}`), 'rate', { r }, { cls: `sm ${c.rate === r ? 'selected' : 'ghost'}` }))
        .join('')}</div></div>`;
      if (c.late || c.handed) html += `<div class="small muted">${escapeHtml(t('freight.record', { late: c.late, handed: c.handed }))}</div>`;
    }
    // The company: a depot, your workers.
    if (c?.kind !== 'firm') {
      const chk = F.canFound();
      html += `<div class="card"><div class="card-title">🏢 ${escapeHtml(t('freight.firm_title'))}</div><div class="small">${escapeHtml(t('freight.firm_text', { money: fmtMoney(FREIGHT.foundCost) }))}</div>
        ${chk.ok ? '' : `<div class="small warn">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}
        <div class="btn-row">${button(t('freight.found', { money: fmtMoney(FREIGHT.foundCost) }), 'found', {}, { cls: 'primary', disabled: !chk.ok })}</div></div>`;
    } else html += notice('good', escapeHtml(tr(sim, 'freight.firm_running', { building: c.depot, n: sim.workers.list().length })), '🏢');
    if (c) html += `<div class="btn-row" style="margin-top:10px">${button(t('freight.stop'), 'close_co', {}, { cls: 'sm ghost' })}</div>`;
    // The log.
    if (F.S.log.length) {
      html += `<h4>${escapeHtml(t('freight.log'))}</h4><div class="small">${F.S.log
        .slice(0, 8)
        .map((e) => `<div>${escapeHtml(t('ui.day_n', { n: e.day }))} · ${escapeHtml(tr(sim, `freight.log_${e.kind}`, { qty: e.qty, item: e.item, building: e.to, money: e.pay ?? e.money, settlement: e.to }))}${e.late ? ` <span class="warn">${escapeHtml(t('freight.late'))}</span>` : ''}${e.robbed ? ` <span class="danger">${escapeHtml(t('freight.robbed'))}</span>` : ''}</div>`)
        .join('')}</div>`;
    }
    return html;
  }

  // ------------------------------------------------------------------ deliveries

  deliveriesHtml() {
    const sim = this.sim;
    const F = sim.freight;
    if (!F.company) return emptyState('🛞', t('freight.none_title'), t('freight.none_text'), button(t('freight.sign_up'), 'sign_up', {}, { cls: 'primary' }));
    if (!F.S.jobs.length) return emptyState('📭', t('freight.no_jobs'), t('freight.no_jobs_text', { share: F.summary().share }));
    const now = sim.time.total;
    const mine = F.carrying();
    return F.S.jobs
      .map((j) => {
        const left = j.due - now;
        const late = left < 0;
        const when = late ? t('freight.overdue', { h: Math.ceil(-left / 60) }) : t('freight.due_in', { h: Math.max(0, Math.floor(left / 60)), m: Math.max(0, Math.round(left % 60)) });
        const carriers = sim.workers
          .list()
          .filter((c) => sim.npcs.byId(c.npcId)?.carry?.freight === j.id || c.task?.freight === j.id)
          .map((c) => npcName(sim.npcs.byId(c.npcId)));
        if (mine?.job === j.id) carriers.unshift(t('freight.you'));
        return `<div class="card"><div class="card-head"><div class="card-icon">${icon(j.item, 28)}</div>
          <div><div class="card-title">${escapeHtml(tr(sim, 'freight.job_line', { qty: j.qty, item: j.item, building: j.fromB, to: j.toB }))}</div>
          <div class="card-sub">${status(when, late ? 'danger' : left < 90 ? 'warn' : 'info', late ? '⏰' : '🕒')} · ${escapeHtml(fmtMoney(j.fee))}</div></div></div>
          ${bar((j.carried / j.qty) * 100, 'good', t('freight.progress', { n: j.carried, max: j.qty, picked: j.picked - j.carried }))}
          <div class="small muted">${escapeHtml(carriers.length ? t('freight.carried_by', { list: carriers.join(', ') }) : F.company.kind === 'self' ? t('freight.go_yourself') : t('freight.waiting_hands'))}</div></div>`;
      })
      .join('');
  }

  // ------------------------------------------------------------------ caravans

  caravansHtml() {
    const sim = this.sim;
    const F = sim.freight;
    let html = '';
    // On the road.
    for (const c of F.S.caravans) {
      const now = sim.time.total;
      const eta = c.stage === 'out' ? c.arrive : c.back;
      const days = Math.max(0, (eta - now) / 1440);
      html += `<div class="card"><div class="card-head"><div class="card-icon">${EQUIPMENT[c.eqType]?.icon || '🛞'}</div>
        <div><div class="card-title">${escapeHtml(tr(sim, c.stage === 'out' ? 'freight.caravan_out' : 'freight.caravan_back', { settlement: c.to, npc: c.driver }))}</div>
        <div class="card-sub">${escapeHtml(t('freight.eta', { n: days.toFixed(1) }))}${c.stage === 'back' ? ` · ${escapeHtml(t('freight.sold_for', { money: fmtMoney(Math.round(c.sold - c.spent)) }))}` : ''}${c.robbed ? ` · <span class="danger">${escapeHtml(t('freight.robbed'))}</span>` : ''}</div></div></div>
        <div class="small muted">${Object.entries(c.cargo).map(([i, n]) => `${n} ${escapeHtml(itemName(i))}`).join(', ')}</div></div>`;
    }
    // Your dock: order a boat (a rowboat, a barge).
    if (F.docks().length) {
      html += `<div class="setting-row"><div><b>⚓ ${escapeHtml(t('freight.boats_title'))}</b><div class="hint">${escapeHtml(t('freight.boats_hint'))}</div></div><div class="btn-row">${['rowboat', 'barge']
        .map((type) => {
          const c = F.canOrderBoat(type);
          return button(`${EQUIPMENT[type].icon} ${t(`equip.${type}`)} ${fmtMoney(EQUIPMENT[type].price)} (${EQUIPMENT[type].cap})`, 'order_boat', { type }, { cls: 'sm', disabled: !c.ok, title: c.ok ? '' : tr(sim, `reason.${c.reason}`, c.params || {}) });
        })
        .join('')}</div></div>`;
    }
    const dests = F.destinations();
    if (!dests.length) return html + emptyState('🗺️', t('freight.no_contacts'), t('freight.no_contacts_text'));
    const eqs = F.caravanEquipment();
    const drivers = F.drivers();
    if (!eqs.length || !drivers.length) return html + notice('info', escapeHtml(t(!eqs.length ? 'freight.need_cart' : 'freight.need_driver')), '🛞');
    // The form.
    const d = this.draft;
    if (!dests.includes(d.to)) d.to = dests[0];
    if (!eqs.some((e) => e.id === d.eq)) d.eq = eqs[0].id;
    if (!drivers.some((n) => n.id === d.driver)) d.driver = drivers[0].id;
    if (d.guard === d.driver || (d.guard && !drivers.some((n) => n.id === d.guard))) d.guard = null;
    const S = sim.settlements;
    const eq = sim.equipment.byId(d.eq);
    const cap = F.caravanCap(eq);
    const boat = F.isBoat(eq);
    if (boat && !S.def(d.to).water) d.to = dests.find((id) => S.def(id).water) || d.to;
    const units = Object.values(d.cargo).reduce((a, b) => a + b, 0);
    const row = (label, inner) => `<div class="setting-row"><div><b>${escapeHtml(label)}</b></div><div class="btn-row wrap">${inner}</div></div>`;
    html += `<h4>${escapeHtml(t('freight.new_caravan'))}</h4>`;
    html += row(
      t('freight.to'),
      dests.map((id) => button(`${S.def(id).water ? '🌊 ' : ''}${t(`settlement_name.${id}`)} · ${t('freight.days', { n: F.caravanDays(id, eq.type) })}${!boat && S.danger(id) > 0.1 ? ' ⚠️' : ''}`, 'd_to', { v: id }, { cls: `sm ${d.to === id ? 'selected' : 'ghost'}`, disabled: boat && !S.def(id).water })).join(''),
    );
    // By boat: the river's mood today.
    if (boat) html += notice(sim.seasons?.flooding() ? 'danger' : F.lowWater() ? 'warn' : 'info', escapeHtml(t(sim.seasons?.flooding() ? 'freight.river_flood' : F.lowWater() ? 'freight.river_low' : 'freight.river_ok', { n: Math.round(RIVER.pirates * 100) })), '🌊');
    html += row(t('freight.cart'), eqs.map((e) => button(`${EQUIPMENT[e.type]?.icon || ''} ${t(`equip.${e.type}`)} (${F.caravanCap(e)})`, 'd_eq', { v: e.id }, { cls: `sm ${d.eq === e.id ? 'selected' : 'ghost'}` })).join(''));
    html += row(t('freight.driver'), drivers.map((n) => button(npcName(n), 'd_driver', { v: n.id }, { cls: `sm ${d.driver === n.id ? 'selected' : 'ghost'}` })).join(''));
    html += row(
      t('freight.guard'),
      button(t('freight.no_guard'), 'd_guard', { v: '' }, { cls: `sm ${!d.guard ? 'selected' : 'ghost'}` }) +
        drivers.filter((n) => n.id !== d.driver).map((n) => button(npcName(n), 'd_guard', { v: n.id }, { cls: `sm ${d.guard === n.id ? 'selected' : 'ghost'}` })).join(''),
    );
    // The cargo: what's in your storage, and what it fetches there.
    const stored = [...new Set(sim.home.storage.map((s) => s.id))].filter((i) => sim.home.storageCount(i) > 0);
    html += `<div class="small muted">${escapeHtml(t('freight.cargo_hint', { n: units, max: cap }))}</div><div class="caravan-cargo">`;
    html += stored.length
      ? stored
          .map((i) => {
            const n = d.cargo[i] || 0;
            const price = S.sellPrice(d.to, i, { player: false });
            return `<div class="kv"><span>${icon(i, 20)} ${escapeHtml(itemName(i))} <span class="muted small">(${sim.home.storageCount(i)} · ${escapeHtml(fmtMoney(price))}/1 ${escapeHtml(t('freight.there'))})</span></span>
              <span class="btn-row">${button('−', 'cargo', { i, d: -STEP }, { cls: 'sm ghost', disabled: !n })}<b class="num">${n}</b>${button('+', 'cargo', { i, d: STEP }, { cls: 'sm ghost', disabled: units >= cap || n >= sim.home.storageCount(i) })}</span></div>`;
          })
          .join('')
      : `<div class="muted small">${escapeHtml(t('freight.storage_empty'))}</div>`;
    html += '</div>';
    const buys = Object.keys(S.def(d.to).produces);
    html += row(t('freight.bring_back'), button(t('freight.nothing'), 'd_buy', { v: '' }, { cls: `sm ${!d.buy ? 'selected' : 'ghost'}` }) + buys.map((i) => button(`${itemName(i)} ${fmtMoney(S.buyPrice(d.to, i, { player: false }))}`, 'd_buy', { v: i }, { cls: `sm ${d.buy === i ? 'selected' : 'ghost'}` })).join(''));
    const chk = F.canSend(d);
    const danger = Math.round(F.risk(d.to, eq, d.guard) * 100);
    html += `<div class="small">${escapeHtml(t('freight.estimate', { money: fmtMoney(F.estimate(d.to, d.cargo)), n: F.caravanDays(d.to, eq.type) * 2, risk: danger }))}</div>`;
    if (!chk.ok && units) html += `<div class="small warn">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`;
    html += `<div class="btn-row">${button(t('freight.send'), 'send', {}, { cls: 'primary', disabled: !chk.ok })}</div>`;
    return html;
  }

  onAction(action, data) {
    const sim = this.sim;
    const F = sim.freight;
    const d = this.draft;
    const warn = (r) => !r.ok && sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'sign_up') warn(F.signUp());
    else if (action === 'found') warn(F.found());
    else if (action === 'close_co') F.close();
    else if (action === 'rate') F.setRate(data.r);
    else if (action === 'order_boat') {
      const r = F.orderBoat(data.type);
      sim.toast(r.ok ? 'toast.boat_ordered' : `reason.${r.reason}`, r.ok ? { eq: data.type, money: r.price } : r.params || {}, r.ok ? 'good' : 'warn');
    } else if (action === 'd_to') d.to = data.v;
    else if (action === 'd_eq') d.eq = data.v;
    else if (action === 'd_driver') d.driver = data.v;
    else if (action === 'd_guard') d.guard = data.v || null;
    else if (action === 'd_buy') d.buy = data.v || null;
    else if (action === 'cargo') {
      const n = Math.max(0, Math.min(sim.home.storageCount(data.i), (d.cargo[data.i] || 0) + Number(data.d)));
      if (n) d.cargo[data.i] = n;
      else delete d.cargo[data.i];
    } else if (action === 'send') {
      const r = F.send(d);
      warn(r);
      if (r.ok) this.draft = { to: d.to, eq: null, driver: null, guard: null, cargo: {}, buy: null };
    }
  }
}
