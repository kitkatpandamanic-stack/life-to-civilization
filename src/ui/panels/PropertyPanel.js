/**
 * Property — inspect any building: who owns it, who lives or works there,
 * its condition and value, and who owned it before. Buy it, restore it,
 * or set the rent if it's yours.
 */
import { FINANCE } from '../../systems/FinanceSystem.js';
import { Panel } from '../Panel.js';
import { t, npcName, fmtMoney, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, buildingLabel, dateString, npcRole, districtLabel, agoText } from '../format.js';
import { bar, button, portrait, tabs, stat, statGrid, status, condBar, emptyState, notice } from '../widgets.js';
import { propBadges, rentMarket } from '../property.js';
import { structureHtml, structureParts, structureAction, jobLabel, levelName } from '../structure.js';
import { RENT_LEVELS } from '../../systems/PropertySystem.js';
import { LETTING } from '../../systems/LettingSystem.js';

export class PropertyPanel extends Panel {
  constructor(ui, buildingId, tab = 'overview') {
    super(ui);
    this.bid = buildingId;
    this.tab = tab;
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
    const r = this.sim.property.rec(this.bid);
    if (!r) return `<div class="muted">—</div>`;
    const pages = [['overview', t('property.tab_overview')]];
    if (this.sim.structures.rec(this.bid)) pages.push(['building', t('property.tab_building')]);
    pages.push(['history', t('property.tab_history')]);
    if (!pages.some(([p]) => p === this.tab)) this.tab = 'overview';
    const parts = this.tab === 'building' ? structureParts(this.sim, this.bid) : null;
    const body = parts ? `<div class="char-cols"><div class="col">${parts.info}</div><div class="col">${parts.actions}</div></div>` : this.tab === 'history' ? this.historyHtml() : this.overview();
    return tabs(pages, this.tab) + body;
  }

  /** Who owned it, what's been done to it, what it's been used for, who has lived there. */
  historyHtml() {
    const sim = this.sim;
    const r = sim.property.rec(this.bid);
    const S = sim.structures;
    const s = S.rec(this.bid);
    const kv = (k, v) => `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
    const owners = r.history
      .slice()
      .reverse()
      .map((h) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(h.from))}</span>${escapeHtml(this.ownerLabel(h.owner))} — ${escapeHtml(t(`acquired.${h.how}`))}${h.price ? ` (${fmtMoney(h.price)})` : ''}</div>`)
      .join('');
    let left = '';
    if (s) {
      const first = r.history[0];
      left += kv(t('bhist.built'), escapeHtml(s.built ? dateString(s.built) : t('bhist.long_ago')));
      if (first) left += kv(t('bhist.first_owner'), escapeHtml(this.ownerLabel(first.owner)));
      left += kv(t('bhist.upgrades'), String(s.ups || 0));
      left += kv(t('bhist.renovations'), String(s.ren || 0));
      left += kv(t('bhist.households'), String(s.hh || 0));
      if (s.uses.length) left += kv(t('bhist.uses'), escapeHtml(s.uses.map((u) => t(`use.${u.u}`)).filter((x, i, a) => a.indexOf(x) === i).join(' → ')));
      const events = s.hist
        .slice()
        .reverse()
        .map((h) => `<div class="chron"><span class="chron-date">${escapeHtml(dateString(h.d))}</span>${escapeHtml(this.histLine(h))}</div>`)
        .join('');
      left += `<h3>${escapeHtml(t('bhist.works'))}</h3><div class="chronicle">${events || `<div class="muted small">${escapeHtml(t('bhist.no_works'))}</div>`}</div>`;
    }
    return `<div class="char-cols"><div class="col">${left}</div><div class="col"><h3>${escapeHtml(t('ui.ownership_history'))}</h3><div class="chronicle">${owners}</div></div></div>`;
  }

  histLine(h) {
    const job = this.jobOf(h.p?.job);
    const who = h.p?.who ? this.ownerLabel(h.p.who) : '';
    if (h.k === 'built') return t('bhist.line_built', { who });
    if (!job) return t(`bhist.line_${h.k}`, { who, job: '' });
    return t(`bhist.line_${h.k}`, { who, job: jobLabel(this.sim, this.bid, job) });
  }

  jobOf(key) {
    if (!key) return null;
    if (key.startsWith('level_')) return { type: 'level', to: Number(key.slice(6)) };
    if (key.startsWith('module_')) return { type: 'module', m: key.slice(7) };
    if (key.startsWith('spec_')) return { type: 'spec', s: key.slice(5) };
    return { type: key };
  }

  overview() {
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(this.bid);
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
      .slice(-4) // the full story is on the History tab
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
      if (sim.structures.rec(this.bid)) btns.push(button(`⬆ ${t('ui.improve')}`, 'tab', { tab: 'building' }));
      if (isHome && this.bid !== sim.state.player.homeId && !r.forSale) {
        // Selling is a big step: ask first.
        if (this.confirmSell) btns.push(`<span class="warn small">${escapeHtml(t('ui.sell_confirm', { money: fmtMoney(P.value(this.bid)) }))}</span>`, button(t('ui.yes'), 'sell', {}, { cls: 'danger' }), button(t('ui.no'), 'sell_no', {}, { cls: 'ghost' }));
        else btns.push(button(t('ui.put_on_market'), 'sell_ask', {}, { cls: 'ghost' }));
      }
    }

    const S = sim.structures;
    const value = P.value(this.bid);
    const tiles = [];
    tiles.push(stat(t('ui.condition'), `${Math.round(r.condition)}%`, r.condition < 40 ? 'neg' : ''));
    if (S.rec(this.bid)) tiles.push(stat(t('structure.quality'), `${S.quality(this.bid)}%`));
    if (isHome) tiles.push(stat(t('ui.residents'), `${P.occupants(this.bid)} / ${P.capacity(this.bid)}`));
    if (value) tiles.push(stat(t('ui.market_value'), fmtMoney(value)));
    if (isHome && !bizId && this.bid !== 'hall') tiles.push(stat(t('ui.weekly_rent'), fmtMoney(P.weeklyRent(this.bid))));
    return `
      <div class="chips" style="gap:6px">${propBadges(sim, this.bid)}</div>
      ${statGrid(tiles)}
      <div class="char-cols">
        <div class="col">
          ${kv(t('ui.owner'), escapeHtml(this.ownerLabel(r.owner)))}
          ${sim.structures.rec(this.bid) ? kv(t('structure.what'), `<span class="clickable" data-action="tab" data-tab="building">${escapeHtml(levelName(sim, this.bid))} · ${escapeHtml(t('structure.level_short', { n: sim.structures.level(this.bid) }))} · ${escapeHtml(t('structure.quality'))} ${sim.structures.quality(this.bid)}%</span>`) : ''}
          ${this.districtRow(kv)}
          <div class="bar-label"><span>${escapeHtml(t('ui.condition'))}</span></div>${condBar(r.condition)}
          ${isHome ? `<h3>${escapeHtml(t('ui.residents'))} <span class="muted small">${escapeHtml(t('ui.capacity_n', { n: P.occupants(this.bid), cap: P.capacity(this.bid) }))}</span></h3>
          ${people ? `<div class="people">${people}</div>` : `<div class="muted small">${escapeHtml(t('ui.nobody_lives_here'))}</div>`}` : ''}
          ${business}
          ${dealings}
          ${this.bid === 'hall' ? this.villageFundHtml(kv) : ''}
        </div>
        <div class="col">
          ${r.owner === 'player' && isHome && this.bid !== sim.state.player.homeId && !bizId ? this.rentHtml(kv) + this.lettingHtml(kv) : r.lease ? this.tenancyHtml(kv) : ''}
          ${isHome && r.tenancies?.length ? this.pastTenantsHtml() : ''}
          ${sim.structures.works(this.bid) ? structureHtml(sim, this.bid, { compact: true }) : ''}
          <h3>${escapeHtml(t('ui.ownership_history'))}</h3>
          <div class="chronicle">${history}</div>
        </div>
      </div>
      <div class="btn-row">${btns.join(' ')}</div>`;
  }

  /** Your rent: what you ask, what the market suggests, the going range, demand — and the level you set. */
  rentHtml(kv) {
    const sim = this.sim;
    const P = sim.property;
    const r = P.rec(this.bid);
    const m = rentMarket(sim, this.bid);
    const ask = P.weeklyRent(this.bid);
    const bounds = P.rentBounds(this.bid);
    const step = Math.max(1, Math.round(bounds.market * 0.1));
    const L = r.lease;
    const demand = status(t(`demand.${m.demand}`), m.demand === 'high' ? 'good' : m.demand === 'low' ? 'warn' : 'neutral', m.demand === 'high' ? '📈' : m.demand === 'low' ? '📉' : '➖');
    return `<h3>💰 ${escapeHtml(t('rent_ui.title'))}</h3>
      <div class="rent-set">${button('−', 'rent_step', { d: -step }, { cls: 'sm', disabled: ask <= bounds.min })}<b class="rent-ask">${escapeHtml(fmtMoney(ask))}</b><span class="muted small">${escapeHtml(t('rent_ui.per_week'))}</span>${button('+', 'rent_step', { d: step }, { cls: 'sm', disabled: ask >= bounds.max })}</div>
      ${L && L.rent !== ask ? `<div class="muted small">${escapeHtml(t('rent_ui.from_next_week', { money: fmtMoney(L.rent) }))}</div>` : ''}
      ${kv(t('rent_ui.suggested'), fmtMoney(m.suggested))}
      ${kv(t('rent_ui.range'), m.range)}
      ${kv(t('rent_ui.demand'), demand)}
      <div class="btn-row"><span class="hint">${escapeHtml(t('ui.set_rent'))}</span>${Object.keys(RENT_LEVELS).map((lvl) => button(t(`rent_level.${lvl}`), 'rent_level', { level: lvl }, { cls: `sm ${!r.ask && r.rentLevel === lvl ? 'selected' : 'ghost'}` })).join('')}</div>
      <div class="muted small">${escapeHtml(t('rent_ui.hint'))}</div>
      ${r.arrears > 0 ? notice('danger', escapeHtml(t('ui.rent_arrears', { n: r.arrears }))) : ''}`;
  }

  /** Finding tenants for a house of yours: the sign, who might be interested, viewings, advertisements. */
  lettingHtml(kv) {
    const sim = this.sim;
    const Lt = sim.letting;
    const P = sim.property;
    const id = this.bid;
    const p = sim.state.player;
    let html = `<h3>🔑 ${escapeHtml(t('letting.title'))}</h3>`;
    const occupants = P.occupants(id);
    const mgr = Lt.manager;
    if (mgr) html += `<div class="muted small">🧑‍💼 ${escapeHtml(tr(sim, 'manager.looks_after', { npc: mgr.npc }))}</div>`;
    if (occupants > 0) return html + (P.lease(id) ? this.tenancyHtml(kv, true) : kv(t('letting.tenants'), escapeHtml(t('letting.tenants_line', { n: occupants, money: fmtMoney(P.weeklyRent(id)) }))));
    if (!Lt.lettable(id)) return html + `<div class="muted small">${escapeHtml(t('letting.not_fit'))}</div>`;
    const listed = Lt.listed(id);
    const it = Lt.interest(id);
    const viewer = sim.state.npcs.find((n) => n.viewing?.building === id);
    html += kv(t('letting.sign'), escapeHtml(t(listed ? 'letting.sign_up' : 'letting.sign_down')));
    html += kv(t('letting.interested'), escapeHtml(t('letting.interested_n', { n: it.yes.length })));
    if (it.yes.length) html += `<div class="muted small">${escapeHtml(it.yes.slice(0, 3).map((x) => `${npcName(x.n)} (${t(`letting_why.${x.r.reason}`)})`).join(', '))}</div>`;
    if (it.main) html += `<div class="muted small">${escapeHtml(t('letting.put_off', { reason: t(`reason.letting_${it.main}`) }))}</div>`;
    if (viewer) html += `<div class="rumor">👀 ${escapeHtml(tr(sim, 'letting.viewing_today', { npc: viewer.id }))}</div>`;
    if (Lt.advertised(id)) html += `<div class="muted small">📣 ${escapeHtml(t('letting.advertised_until', { n: Lt.S.listings[id].advertisedUntil - sim.time.day }))}</div>`;
    for (const ad of Lt.S.ads.filter((a) => a.building === id)) html += `<div class="muted small">📜 ${escapeHtml(tr(sim, 'letting.ad_out', { settlement: ad.settlement, n: Math.max(0, ad.arrive - sim.time.day) }))}</div>`;
    const btns = [button(t(listed ? 'letting.take_down' : 'letting.put_up'), 'let_sign', { on: listed ? 0 : 1 }, { cls: listed ? '' : 'primary' })];
    btns.push(button(t('letting.advertise', { money: fmtMoney(LETTING.adCost) }), 'let_ad', {}, { disabled: p.money < LETTING.adCost || Lt.advertised(id) }));
    const away = (sim.settlements?.contacts() || []).filter(() => !Lt.S.ads.some((a) => a.building === id));
    for (const s of away) {
      const cost = Lt.awayAdCost(s);
      btns.push(button(tr(sim, 'letting.advertise_in', { settlement: s, money: cost }), 'let_away', { s }, { disabled: p.money < cost }));
    }
    html += `<div class="btn-row">${btns.join(' ')}</div>`;
    html += `<div class="muted small">${escapeHtml(t(away.length || Lt.S.ads.some((a) => a.building === id) ? 'letting.hint' : 'letting.hint_no_contacts'))}</div>`;
    return html;
  }

  /** The tenancy: who rents it, since when, the rent agreed, what they've paid — and notice, given or received. */
  tenancyHtml(kv, mine = false) {
    const sim = this.sim;
    const P = sim.property;
    const id = this.bid;
    const r = P.rec(id);
    const L = r.lease;
    const tenant = sim.npcs.byId(L.tenant);
    const who = tenant ? `<span class="clickable" data-action="inspect_npc" data-id="${tenant.id}">${escapeHtml(npcName(tenant))}</span>` : '—';
    const n = P.occupants(id);
    let html = mine ? '' : `<h3>🔑 ${escapeHtml(t('lease.title'))}</h3>${kv(t('lease.landlord'), escapeHtml(this.ownerLabel(r.owner)))}`;
    html += kv(t('lease.tenant'), `${who}${n > 1 ? ` <span class="muted small">${escapeHtml(t('lease.household', { n }))}</span>` : ''}`);
    html += kv(t('lease.since'), escapeHtml(`${dateString(L.since)} · ${agoText(sim.time.day - L.since)}`));
    html += kv(t('lease.rent'), `${escapeHtml(fmtMoney(L.rent))} ${escapeHtml(t('rent_ui.per_week'))}`);
    html += kv(t('lease.paid'), escapeHtml(fmtMoney(L.paid)));
    if (L.missed) html += kv(t('lease.missed'), escapeHtml(t('lease.missed_n', { n: L.missed })));
    if (r.arrears > 0) html += notice('danger', escapeHtml(t('ui.rent_arrears', { n: r.arrears })));
    if (L.notice) {
      const days = Math.max(0, L.notice.until - sim.time.day);
      html += notice('warn', escapeHtml(tr(sim, L.notice.by === 'tenant' ? 'lease.leaving' : 'lease.notice_out', { npc: L.tenant, gender: tenant?.gender, n: days, letting: L.notice.why })));
    }
    if (!mine) return html;
    // Ending it: you give notice (with cause, or after the first fortnight) — or take it back.
    const btns = [];
    if (L.notice) btns.push(button(t(L.notice.by === 'tenant' ? 'lease.talk_round' : 'lease.withdraw'), 'notice_withdraw', {}, { cls: 'ghost' }));
    else {
      const chk = P.canGiveNotice(id);
      if (this.confirmNotice && chk.ok) btns.push(`<span class="warn small">${escapeHtml(t(chk.cause ? 'lease.confirm_cause' : 'lease.confirm', { n: 7 }))}</span>`, button(t('ui.yes'), 'notice', {}, { cls: 'danger' }), button(t('ui.no'), 'notice_no', {}, { cls: 'ghost' }));
      else btns.push(button(t('lease.give_notice'), 'notice_ask', {}, { cls: 'ghost', disabled: !chk.ok, title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) }));
    }
    html += `<div class="btn-row">${btns.join(' ')}</div>`;
    return html;
  }

  /** Who rented it before, for how long, and how it ended. */
  pastTenantsHtml() {
    const sim = this.sim;
    const rows = [...(sim.property.rec(this.bid).tenancies || [])].reverse().map((x) => {
      const n = sim.npcs.byId(x.tenant) || sim.family?.person(x.tenant);
      return `<div class="small">${escapeHtml(n ? npcName(n) : '—')} <span class="muted">· ${escapeHtml(t('lease.stayed', { n: Math.max(1, x.to - x.from) }))} · ${escapeHtml(fmtMoney(x.paid))} · ${escapeHtml(t(`lease_end.${x.how}`))}</span></div>`;
    });
    return `<h3>${escapeHtml(t('lease.past'))}</h3>${rows.join('')}`;
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
    if (action === 'tab') {
      this.tab = data.tab;
      return;
    }
    if (structureAction(this.ui, this.bid, action, data)) return;
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
      case 'let_sign':
        this.sim.letting.list(this.bid, data.on === '1');
        break;
      case 'let_ad':
        this.sim.letting.advertise(this.bid);
        break;
      case 'let_away':
        this.sim.letting.advertiseAway(this.bid, data.s);
        break;
      case 'rent_level':
        P.setRentLevel(this.bid, data.level);
        break;
      case 'rent_step':
        P.setRent(this.bid, P.weeklyRent(this.bid) + Number(data.d));
        break;
      case 'notice_ask':
        this.confirmNotice = true;
        break;
      case 'notice_no':
        this.confirmNotice = false;
        break;
      case 'notice': {
        this.confirmNotice = false;
        const r = P.giveNotice(this.bid);
        if (!r.ok) this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
        break;
      }
      case 'notice_withdraw':
        if (!P.withdrawNotice(this.bid)) this.sim.toast('reason.wont_stay', {}, 'warn');
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
          this.sim.ledger ? this.sim.ledger.as('donations', () => (p.money -= m)) : (p.money -= m);
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
      case 'sell_ask':
        this.confirmSell = true;
        break;
      case 'sell_no':
        this.confirmSell = false;
        break;
      case 'sell':
        this.confirmSell = false;
        P.playerSell(this.bid);
        break;
      case 'inspect_npc':
        this.ui.openInspect(data.id);
        return;
    }
  }
}

