/**
 * Property — inspect any building: who owns it, who lives or works there,
 * its condition and value, and who owned it before. Buy it, restore it,
 * or set the rent if it's yours.
 */
import { FINANCE } from '../../systems/FinanceSystem.js';
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, npcRole, districtLabel } from '../format.js';
import { bar, button, portrait } from '../widgets.js';
import { RENT_LEVELS } from '../../systems/PropertySystem.js';

export class PropertyPanel extends Panel {
  constructor(ui, buildingId) {
    super(ui);
    this.bid = buildingId;
  }
  get id() {
    return 'property';
  }
  title() {
    return `🏠 ${escapeHtml(buildingLabel(this.sim, this.bid))}`;
  }

  ownerLabel(owner) {
    const sim = this.sim;
    if (!owner) return t('owner.nobody');
    if (owner === 'player' || owner === 'village') return t(`owner.${owner}`);
    const n = sim.npcs.byId(owner);
    if (n) return npcName(n);
    const dead = sim.family.person(owner);
    return dead ? t('ui.late', { name: npcName(dead) }) : '?';
  }

  /** The village hall: the village fund, and what the village is saving up to build. */
  villageFundHtml(kv) {
    const sim = this.sim;
    const next = sim.tech.civicWanted();
    const building = sim.construction.list.find((c) => c.owner === 'village' && c.purpose === 'public' && c.status === 'site' && c.type !== 'well');
    let plan = '';
    if (building) plan = `<div class="rumor">🏗️ ${escapeHtml(t('ui.village_building_now', { what: t(`vbuilding.${building.type}`) }))}</div>`;
    else if (next) {
      const need = Math.round(sim.growth.estimate(next) * 0.5);
      plan = `<div class="rumor">💡 ${escapeHtml(t('ui.village_saving_for', { what: t(`vbuilding.${next}`), money: fmtMoney(need) }))}</div>`;
    }
    const F = sim.finance;
    const last = sim.state.village.taxLog.at(-1);
    const loan = sim.state.player.loan;
    const loanHtml = loan
      ? `${kv(t('ui.your_loan'), `${fmtMoney(loan.left)} · ${t('ui.loan_weekly', { money: fmtMoney(loan.weekly) })}`)}<div class="btn-row">${button(t('ui.repay_n', { money: fmtMoney(Math.min(loan.left, 100)) }), 'repay', { n: 100 }, { disabled: sim.state.player.money < 1 })}</div>`
      : `<div class="btn-row">${FINANCE.loanSizes.map((m) => { const c = F.canBorrow(m); return button(t('ui.borrow_n', { money: fmtMoney(m) }), 'borrow', { n: m }, { disabled: !c.ok, title: c.ok ? t('ui.loan_terms', { n: Math.round(FINANCE.loanRate * 100), weeks: FINANCE.loanWeeks }) : tr(sim, `reason.${c.reason}`, c.params || {}) }); }).join('')}</div>`;
    return `<h3>${escapeHtml(t('ui.village_fund'))}</h3>
      ${kv(t('ui.treasury'), fmtMoney(sim.state.village.treasury))}
      ${last ? kv(t('ui.taxes_last_week'), `${fmtMoney(last.business + last.property)} (${t('ui.taxes_you', { money: fmtMoney(last.player) })})`) : ''}
      <div class="muted small">${escapeHtml(t('ui.taxes_hint', { n: Math.round(FINANCE.profitTax * 100) }))}</div>
      ${loanHtml}
      ${plan}
      <div class="muted small">${escapeHtml(t('ui.village_fund_hint'))}</div>
      <div class="btn-row">${[25, 100].map((m) => button(t('ui.donate_n', { money: fmtMoney(m) }), 'donate', { money: m }, { disabled: sim.state.player.money < m })).join(' ')}</div>`;
  }

  render() {
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(this.bid);
    if (!r) return `<div class="muted">—</div>`;
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const tags = [];
    if (r.ruined) tags.push(`<span class="chip neg">${escapeHtml(t('ui.ruin_tag'))}</span>`);
    else if (r.abandoned) tags.push(`<span class="chip neg">${escapeHtml(t('ui.abandoned_tag'))}</span>`);
    if (r.forSale) tags.push(`<span class="chip">${escapeHtml(t('ui.for_sale_tag'))}</span>`);
    const isHome = P.isHome(this.bid);
    const residents = sim.npcs.residentsOf(this.bid);
    const people = residents
      .map((n) => `<div class="person clickable" data-action="inspect_npc" data-id="${n.id}">${portrait(`npc_${sim.state.seed}_${n.id}`, n.look, 36)}<div><b>${escapeHtml(npcName(n))}</b><div class="muted small">${escapeHtml(npcRole(sim, n))} · ${escapeHtml(t('ui.age_n', { age: n.age }))}</div></div></div>`)
      .join('');
    const bizId = sim.economy.businessAtBuilding(this.bid);
    const business = bizId ? this.businessHtml(bizId, kv) : '';
    const history = r.history
      .slice()
      .reverse()
      .map((h) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(h.from))}</span>${escapeHtml(this.ownerLabel(h.owner))} — ${escapeHtml(t(`acquired.${h.how}`))}${h.price ? ` (${fmtMoney(h.price)})` : ''}</div>`)
      .join('');

    // Actions
    const btns = [];
    const H = sim.holdings;
    const p = sim.state.player;
    let dealings = '';
    if (bizId && H.isMine(bizId)) btns.push(button(t('biz.manage'), 'manage_biz', {}, { cls: 'primary' }));
    else if (bizId && sim.economy.owner(bizId)) {
      // Buying the business, a stake in it, or a loan to it.
      const ask = H.askingPrice(bizId);
      const stake = H.stakeOffer(bizId);
      const loan = sim.economy.biz(bizId).loan;
      dealings = `<h3>${escapeHtml(t('biz.dealings'))}</h3>
        ${kv(t('biz.valuation'), fmtMoney(H.valuation(bizId)))}
        ${ask.ok ? kv(t('biz.asking'), fmtMoney(ask.price)) : `<div class="muted small">${escapeHtml(t(`reason.${ask.reason}`))}</div>`}
        <div class="btn-row">
          ${ask.ok ? button(t('biz.buy_it', { money: fmtMoney(ask.price) }), 'buy_biz', {}, { cls: 'primary', disabled: p.money < ask.price }) : ''}
          ${stake.ok ? button(t('biz.invest', { money: fmtMoney(stake.amount), n: Math.round(stake.share * 100) }), 'invest', {}, { disabled: p.money < stake.amount }) : ''}
          ${!loan ? [100, 300].map((m) => button(t('biz.lend', { money: fmtMoney(m) }), 'lend', { n: m }, { disabled: p.money < m })).join('') : ''}
        </div>
        ${stake.ok ? '' : stake.reason === 'already_invested' ? `<div class="muted small">${escapeHtml(t('biz.you_have_stake'))}</div>` : ''}
        ${loan?.lender === 'player' ? `<div class="muted small">${escapeHtml(t('biz.you_lent', { money: fmtMoney(loan.left) }))}</div>` : ''}
        <div class="muted small">${escapeHtml(t('biz.dealings_hint'))}</div>`;
    } else if (!bizId && H.canOpenIn(this.bid).ok) {
      dealings = `<h3>${escapeHtml(t('biz.open_here'))}</h3><div class="btn-row">${H.typesFor(this.bid)
        .map((type) => button(`${t(`biz_type.${type}`)} · ${fmtMoney(H.startCost(type))}`, 'open_biz', { type }, { disabled: p.money < H.startCost(type) }))
        .join('')}</div><div class="muted small">${escapeHtml(t('biz.open_hint'))}</div>`;
    }
    // Relics from your expeditions belong in the library (or the school, until there is one).
    const learned = ['library', 'school'].includes(sim.world.buildings[this.bid]?.type);
    if (learned && sim.inventory.count('relic') > 0) btns.push(button(t('tech.donate_relic'), 'donate_relic', {}, { cls: 'primary' }));
    const buy = P.canPlayerBuy(this.bid);
    if (buy.ok || buy.reason === 'no_money') {
      const price = buy.price ?? P.value(this.bid);
      btns.push(button(t('ui.buy_for', { money: fmtMoney(price) }), 'buy', {}, { cls: 'primary', disabled: !buy.ok, title: buy.ok ? '' : tr(sim, `reason.${buy.reason}`, buy.params || {}) }));
    }
    if (r.owner === 'player') {
      const cost = P.restoreCost(this.bid);
      if (cost.points > 0) {
        const chk = P.canRestore(this.bid);
        const needs = Object.entries(cost.materials).map(([i, q]) => `${itemName(i)} ×${q}`).join(', ');
        btns.push(button(t('ui.restore_for', { money: fmtMoney(cost.money) }), 'restore', {}, { disabled: !chk.ok, title: `${t('ui.restore_needs', { list: needs })}${chk.ok ? '' : ` — ${tr(sim, `reason.${chk.reason}`, chk.params || {})}`}` }));
      }
      if (isHome && this.bid !== sim.state.player.homeId) {
        btns.push(`<span class="muted small">${escapeHtml(t('ui.set_rent'))}:</span>`);
        for (const lvl of Object.keys(RENT_LEVELS)) btns.push(button(t(`rent_level.${lvl}`), 'rent_level', { level: lvl }, { cls: r.rentLevel === lvl ? 'primary' : '' }));
        if (!r.forSale) btns.push(button(t('ui.put_on_market'), 'sell'));
      }
    }

    return `
      <div class="chips">${tags.join('')}</div>
      <div class="char-cols">
        <div class="col">
          ${kv(t('ui.owner'), escapeHtml(this.ownerLabel(r.owner)))}
          ${this.districtRow(kv)}
          <div class="need-row"><span>${escapeHtml(t('ui.condition'))}</span>${bar(r.condition, r.condition < 40 ? 'warn' : 'health', `${Math.round(r.condition)}%`)}</div>
          ${P.value(this.bid) ? kv(t('ui.market_value'), fmtMoney(P.value(this.bid))) : ''}
          ${isHome && !bizId ? kv(t('ui.weekly_rent'), fmtMoney(P.weeklyRent(this.bid))) : ''}
          ${r.arrears > 0 ? `<div class="warn small">${escapeHtml(t('ui.rent_arrears', { n: r.arrears }))}</div>` : ''}
          ${isHome ? `<h3>${escapeHtml(t('ui.residents'))} <span class="muted small">${escapeHtml(t('ui.capacity_n', { n: P.occupants(this.bid), cap: P.capacity(this.bid) }))}</span></h3>
          ${people ? `<div class="people">${people}</div>` : `<div class="muted small">${escapeHtml(t('ui.nobody_lives_here'))}</div>`}` : ''}
          ${business}
          ${dealings}
          ${this.bid === 'hall' ? this.villageFundHtml(kv) : ''}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.ownership_history'))}</h3>
          <div class="chronicle">${history}</div>
        </div>
      </div>
      <div class="btn-row">${btns.join(' ')}</div>`;
  }

  /** Owner, staff, pay and prices, reputation, the week's books, what's on the shelves. */
  businessHtml(bizId, kv) {
    const sim = this.sim;
    const E = sim.economy;
    const b = E.biz(bizId);
    const def = E.def(bizId);
    const staff = sim.npcs.staffOf(bizId);
    const books = sim.enterprise.books(bizId, 7);
    const pct = (v) => `${Math.round((v ?? 1) * 100)}%`;
    const person = (id) => {
      const n = sim.npcs.byId(id);
      return n ? `<span class="clickable" data-action="inspect_npc" data-id="${id}">${escapeHtml(npcName(n))}</span>` : '—';
    };
    const shelves = (def.sells || [])
      .filter((i) => E.stock(bizId, i) > 0)
      .slice(0, 8)
      .map((i) => `<span class="chip">${escapeHtml(itemName(i))} ×${E.stock(bizId, i)}</span>`)
      .join('');
    const staffRows = staff
      .map((n) => `<div class="rumor clickable" data-action="inspect_npc" data-id="${n.id}">${escapeHtml(npcName(n))} — ${escapeHtml(b.manager === n.id ? t('career.manager') : npcRole(sim, n))}${n.jobSat !== undefined ? ` <span class="muted small">· ${escapeHtml(t('ui.job_satisfaction'))} ${n.jobSat}</span>` : ''}</div>`)
      .join('');
    const lender = b.loan && sim.npcs.byId(b.loan.lender);
    return `<h3>${escapeHtml(t('ui.business'))} · ${escapeHtml(t(`biz_type.${def.type}`))}</h3>
      ${kv(t('ui.owner'), person(b.owner))}
      ${b.partner ? kv(t('ui.partner_label'), person(b.partner)) : ''}
      ${b.opened ? kv(t('ui.opened_on'), escapeHtml(dateString(b.opened))) : ''}
      ${kv(t('ui.cash'), fmtMoney(b.money))}
      ${def.workerOccupation ? kv(t('ui.pay_level'), escapeHtml(t('ui.pct_of_usual', { pct: Math.round((b.wageLevel ?? 1) * 100) })) + (b.longHours ? ` · ${escapeHtml(t('ui.long_hours'))}` : '')) : ''}
      ${def.kind === 'shop' ? kv(t('ui.price_level_label'), pct(b.markup)) : ''}
      <div class="need-row"><span>${escapeHtml(t('ui.reputation_label'))}</span>${bar(b.reputation ?? 50, (b.reputation ?? 50) < 30 ? 'warn' : '', String(Math.round(b.reputation ?? 50)))}</div>
      ${staff.length ? `<div class="need-row"><span>${escapeHtml(t('ui.morale_label'))}</span>${bar(b.staffMorale ?? 60, (b.staffMorale ?? 60) < 40 ? 'warn' : '', String(b.staffMorale ?? 60))}</div>` : ''}
      <h3>${escapeHtml(t('ui.week_books'))}</h3>
      ${kv(t('ui.revenue_label'), fmtMoney(books.rev))}
      ${kv(t('ui.expenses_label'), fmtMoney(books.exp))}
      ${kv(t('ui.profit_label'), `<span class="${books.profit >= 0 ? 'pos' : 'neg'}">${fmtMoney(books.profit)}</span>`)}
      ${def.kind === 'shop' ? kv(t('ui.customers_label'), books.cust) : ''}
      ${lender ? `<div class="muted small">${escapeHtml(t('ui.loan_left', { money: fmtMoney(b.loan.left), npc: npcName(lender) }))}</div>` : ''}
      ${shelves ? `<h3>${escapeHtml(t('ui.on_shelves'))}</h3><div class="chips">${shelves}</div>` : ''}
      <h3>${escapeHtml(t('ui.employees'))} <span class="muted small">${staff.length} / ${sim.npcs.maxStaff(bizId)}</span></h3>
      ${staffRows || '<div class="muted small">—</div>'}`;
  }

  districtRow(kv) {
    const b = this.sim.world.buildings[this.bid];
    const d = b && this.sim.growth.districtAt(b.door.tx, b.door.ty);
    return d ? kv(t('ui.district'), `${escapeHtml(districtLabel(d))} <span class="muted small">(${escapeHtml(t(`district.kind.${d.type}`))})</span>`) : '';
  }

  onAction(action, data) {
    const P = this.sim.property;
    switch (action) {
      case 'buy': {
        const r = P.playerBuy(this.bid);
        if (r.ok) this.sim.toast('toast.property_bought', { building: this.bid }, 'good');
        break;
      }
      case 'restore': {
        const r = P.restore(this.bid);
        if (r.ok) this.sim.toast('toast.property_restored', { building: this.bid }, 'good');
        else this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        break;
      }
      case 'rent_level':
        P.setRentLevel(this.bid, data.level);
        break;
      case 'borrow': {
        const r = this.sim.finance.borrow(Number(data.n));
        if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        break;
      }
      case 'repay':
        this.sim.finance.repay(Number(data.n));
        break;
      case 'donate': {
        const m = Number(data.money);
        const p = this.sim.state.player;
        if (p.money >= m) {
          p.money -= m;
          this.sim.state.village.treasury += m;
          p.donated = (p.donated || 0) + m;
          this.sim.progression.addReputation(m / 50);
          this.sim.toast('toast.donated', { money: m }, 'good');
          // Word gets around when someone gives generously.
          if (p.donated >= 200 && !p.donorNoted) {
            p.donorNoted = true;
            this.sim.chronicle('chronicle.player_benefactor', {});
          }
          this.sim.bus.emit('player:changed');
        }
        break;
      }
      case 'manage_biz':
        return this.ui.openEnterprise(this.sim.economy.businessAtBuilding(this.bid));
      case 'buy_biz': {
        const r = this.sim.holdings.buy(this.sim.economy.businessAtBuilding(this.bid));
        if (r.ok) this.sim.toast('toast.bought_business', { building: this.bid }, 'good');
        else this.sim.toast(`reason.${r.reason}`, {}, 'warn');
        break;
      }
      case 'invest': {
        const r = this.sim.holdings.invest(this.sim.economy.businessAtBuilding(this.bid));
        if (!r.ok) this.sim.toast(`reason.${r.reason}`, {}, 'warn');
        break;
      }
      case 'lend':
        this.sim.holdings.lend(this.sim.economy.businessAtBuilding(this.bid), Number(data.n));
        break;
      case 'open_biz': {
        const r = this.sim.holdings.open(this.bid, data.type);
        if (r.ok) return this.ui.openEnterprise(r.id);
        this.sim.toast(`reason.${r.reason}`, {}, 'warn');
        break;
      }
      case 'donate_relic':
        if (this.sim.inventory.remove('relic', 1)) {
          this.sim.tech.addKnowledge(3, 'relic_donated');
          this.sim.progression.addReputation(2);
          this.sim.chronicle('chronicle.relic_donated', { building: this.bid });
        }
        break;
      case 'sell':
        P.playerSell(this.bid);
        break;
      case 'inspect_npc':
        this.ui.openInspect(data.id);
        return;
    }
  }
}

