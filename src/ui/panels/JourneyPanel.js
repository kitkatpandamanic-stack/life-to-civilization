/**
 * Journey — trade with the world beyond the valley (see SettlementSystem).
 *
 *   plan    at the waymark: pick a settlement you know of, see what you last
 *           heard their prices were, load a cargo (from your pockets and your
 *           storage chest), check your transport, and set out. You can also
 *           buy better transport here, and pay for a better road.
 *   market  you've arrived: sell your cargo and buy theirs. Prices move as you trade.
 *   report  home again: what you sold and bought, and what happened while you were away.
 */
import { Panel } from '../Panel.js';
import { t, tn, fmtMoney, itemName } from '../../i18n/i18n.js';
import { escapeHtml, tr, agoText } from '../format.js';
import { button, icon } from '../widgets.js';
import { SETTLEMENTS, PLAYER_TRANSPORT, TRADE } from '../../data/settlements.js';
import { REGIONS } from '../../data/regions.js';

export class JourneyPanel extends Panel {
  constructor(ui, { mode = 'plan', report = null, to = null } = {}) {
    super(ui);
    this.mode = mode;
    this.report = report;
    const S = this.sim.settlements;
    const known = S.known();
    this.to = to || known.find((id) => S.get(id).contact) || known[0] || null;
    this.cargo = {};
  }
  get id() {
    return 'journey';
  }
  title() {
    const S = this.sim.settlements;
    if (this.mode === 'market') return `🏘️ ${escapeHtml(t(`settlement_name.${S.R.journey?.to}`))}`;
    return `🐎 ${escapeHtml(t(this.mode === 'report' ? 'journey.report_title' : 'journey.title'))}`;
  }

  onClose() {
    // Walking away from the market means heading home.
    const j = this.sim.settlements.R.journey;
    if (this.mode === 'market' && j?.stage === 'there') this.sim.settlements.headHome();
  }

  render() {
    if (this.mode === 'market') return this.renderMarket();
    if (this.mode === 'report') return this.renderReport();
    return this.renderPlan();
  }

  // ------------------------------------------------------------------ plan

  renderMap() {
    const S = this.sim.settlements;
    const nodes = S.known()
      .map((id) => {
        const d = REGIONS[SETTLEMENTS[id].region];
        const s = S.get(id);
        const cls = `xp-node${id === this.to ? ' selected' : ''}${s.contact ? ' partner' : ''}`;
        const road = s.road ? ` ${'═'.repeat(s.road)}` : '';
        return `<div class="${cls}" data-action="pick" data-id="${id}" style="left:${d.x}%;top:${d.y}%"><b>${escapeHtml(t(`settlement_name.${id}`))}</b><small>${escapeHtml(t(`settlement_size.${s.size}`))}${road}</small></div>`;
      })
      .join('');
    return `<div class="xp-map"><div class="xp-valley">${escapeHtml(t('expedition.your_valley'))}</div>${nodes}</div>`;
  }

  priceTable(id, { market = false } = {}) {
    const sim = this.sim;
    const S = sim.settlements;
    const s = S.get(id);
    const def = SETTLEMENTS[id];
    const items = [...new Set([...Object.keys(def.produces), ...Object.keys(def.wants)])];
    const j = S.R.journey;
    const rows = items
      .map((item) => {
        // At the market you see today's prices; elsewhere, what you last heard.
        const buy = market ? S.buyPrice(id, item) : s.known[item]?.buy;
        const sell = market ? S.sellPrice(id, item) : s.known[item]?.sell;
        const makes = def.produces[item] !== undefined;
        const tag = makes ? `<span class="chip">${escapeHtml(t('journey.they_make'))}</span>` : `<span class="chip warn">${escapeHtml(t('journey.they_need'))}</span>`;
        let actions = '';
        if (market) {
          const have = j.cargo[item] || 0;
          actions = `${button(t('journey.sell_n', { n: 1 }), 'sell', { item, n: 1 }, { disabled: !have })}${button(t('journey.sell_all'), 'sell', { item, n: have }, { disabled: !have })}${button(t('journey.buy_n', { n: 1 }), 'buy', { item, n: 1 }, { disabled: !(s.stock[item] > 0) })}${button(t('journey.buy_n', { n: 10 }), 'buy', { item, n: 10 }, { disabled: !(s.stock[item] > 0) })}`;
        }
        const stock = market ? `<span class="muted small">${escapeHtml(t('journey.in_stock', { n: Math.floor(s.stock[item] || 0) }))}</span>` : '';
        const carried = market && j.cargo[item] ? ` <b>×${j.cargo[item]}</b>` : '';
        return `<div class="trade-row">${icon(item, 20)} <span class="trade-item">${escapeHtml(itemName(item))}${carried}</span> ${tag} <span class="trade-price">${escapeHtml(t('journey.they_pay'))} <b>${sell !== undefined ? fmtMoney(sell) : '?'}</b> · ${escapeHtml(t('journey.they_ask'))} <b>${buy !== undefined ? fmtMoney(buy) : '?'}</b></span> ${stock}<span class="trade-actions">${actions}</span></div>`;
      })
      .join('');
    return `<div class="trade-table">${rows}</div>`;
  }

  renderPlan() {
    const sim = this.sim;
    const S = sim.settlements;
    const id = this.to;
    if (!id) return `<p class="desc">${escapeHtml(t('journey.none_known'))}</p>`;
    const s = S.get(id);
    const def = SETTLEMENTS[id];
    const plan = S.journeyPlan(id);
    const chk = S.canSetOut(id, this.cargo);
    const cap = S.cargoCap();
    const loaded = Object.values(this.cargo).reduce((a, c) => a + c, 0);
    const danger = plan.danger >= 0.15 ? 'high' : plan.danger >= 0.08 ? 'medium' : 'low';
    const heard = s.knownDay !== null && s.knownDay !== undefined ? t('journey.prices_from', { ago: agoText(sim.time.day - s.knownDay) }) : t('journey.prices_unknown');
    const old = s.knownDay !== null && s.knownDay !== undefined && sim.time.day - s.knownDay > TRADE.priceMemoryDays;
    // What you have to take along — goods they deal in first.
    const have = S.goodsOnHand();
    const goods = Object.entries(have)
      .sort((a, b) => S.deals(id, b[0]) - S.deals(id, a[0]) || b[1] - a[1])
      .slice(0, 14)
      .map(([item, n]) => {
        const on = this.cargo[item] || 0;
        const dealt = S.deals(id, item);
        return `<div class="trade-row${dealt ? '' : ' muted'}">${icon(item, 20)} <span class="trade-item">${escapeHtml(itemName(item))}</span><span class="muted small">${on} / ${n}</span><span class="trade-actions">${button('−', 'unload', { item }, { disabled: !on })}${button('+1', 'load', { item, n: 1 }, { disabled: on >= n || loaded >= cap })}${button('+10', 'load', { item, n: 10 }, { disabled: on >= n || loaded >= cap })}</span></div>`;
      })
      .join('');
    // Transport you could get.
    const mine = sim.state.player.transport;
    const transports = Object.keys(PLAYER_TRANSPORT)
      .filter((k) => k !== 'foot')
      .map((k) => {
        const c = S.canBuyTransport(k);
        const tdef = PLAYER_TRANSPORT[k];
        const label = k === mine ? `✓ ${t(`transport.${k}.name`)}` : t('journey.buy_transport', { transport: t(`transport.${k}.name`), money: fmtMoney(S.transportPrice(k)) });
        const note = c.ok || k === mine ? t('journey.transport_stats', { n: tdef.cargo, speed: Math.round(tdef.speed * 100), money: fmtMoney(tdef.upkeep) }) : tr(sim, `reason.${c.reason}`, c.params || {});
        return `<div class="kv"><span>${k === mine ? escapeHtml(label) : button(label, 'buy_transport', { kind: k }, { disabled: !c.ok })}</span><b class="muted small">${escapeHtml(note)}</b></div>`;
      })
      .join('');
    const road = S.canFundRoad(id);
    const roadLine = s.roadWork
      ? `<div class="muted small">🛠️ ${escapeHtml(t('journey.road_underway', { ago: agoText(0) }))}</div>`
      : s.road >= TRADE.roadMaxLevel
        ? `<div class="muted small">${escapeHtml(t('journey.road_best'))}</div>`
        : `<div class="row">${button(t('journey.fund_road', { money: fmtMoney(S.roadCost(id)) }), 'fund_road', {}, { disabled: !road.ok, title: road.ok ? '' : tr(sim, `reason.${road.reason}`, road.params || {}) })}</div><div class="muted small">${escapeHtml(t('journey.road_hint'))}</div>`;
    return `
      ${this.renderMap()}
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t(`settlement_name.${id}`))} <span class="muted small">${escapeHtml(t(`settlement_size.${s.size}`))} · ${escapeHtml(t(`settlement_character.${def.character}`))}</span></h3>
          <p class="desc">${escapeHtml(t(`settlement_desc.${id}`))}</p>
          <div class="kv"><span>${escapeHtml(t('journey.people'))}</span><b>${s.pop}</b></div>
          <div class="kv"><span>${escapeHtml(t('journey.relations'))}</span><b>${escapeHtml(t(s.contact ? 'journey.trading' : 'journey.no_contact'))}</b></div>
          <div class="kv"><span>${escapeHtml(t('journey.road'))}</span><b>${escapeHtml(t(`journey.road_${s.road}`))}</b></div>
          <div class="kv"><span>${escapeHtml(t('journey.distance'))}</span><b>${escapeHtml(tn('journey.days_each_way', plan.days))}</b></div>
          <div class="kv"><span>${escapeHtml(t('expedition.danger'))}</span><b class="danger-${danger}">${escapeHtml(t(`expedition.danger_${danger}`))}</b></div>
          ${roadLine}
          <h3>${escapeHtml(t('journey.prices'))} <span class="muted small${old ? ' warn' : ''}">${escapeHtml(heard)}</span></h3>
          ${this.priceTable(id)}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('journey.cargo'))} <span class="muted small">(${loaded}/${cap})</span></h3>
          ${goods || `<div class="muted small">${escapeHtml(t('journey.nothing_to_take'))}</div>`}
          <h3>${escapeHtml(t('journey.transport'))}</h3>
          <div class="kv"><span>${escapeHtml(t(`transport.${mine}.name`))}</span><b>${escapeHtml(t('journey.transport_stats', { n: PLAYER_TRANSPORT[mine].cargo, speed: Math.round(PLAYER_TRANSPORT[mine].speed * 100), money: fmtMoney(PLAYER_TRANSPORT[mine].upkeep) }))}</b></div>
          ${transports}
          <h3>${escapeHtml(t('expedition.supplies'))}</h3>
          <div class="kv"><span>${escapeHtml(t('expedition.food_needed'))}</span><b>${sim.exploration.foodCarried()} / ${plan.food}</b></div>
          <div class="muted small">${escapeHtml(t('journey.away_hint'))}</div>
          <div class="row">${button(t('journey.set_out'), 'set_out', {}, { cls: 'primary', disabled: !chk.ok })}</div>
          ${chk.ok ? '' : `<div class="muted small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ market

  renderMarket() {
    const sim = this.sim;
    const S = sim.settlements;
    const j = S.R.journey;
    if (!j) return '';
    const s = S.get(j.to);
    const robbed = j.robbed ? `<div class="rumor bad">⚠️ ${escapeHtml(j.robbed.item ? t('journey.robbed_goods', { item: itemName(j.robbed.item), n: j.robbed.qty }) : t('journey.robbed_money', { money: fmtMoney(j.robbed.money) }))}</div>` : '';
    const shocks = s.shocks.map((x) => `<div class="rumor">${escapeHtml(tr(sim, `journey.shock_${x.kind}`, { item: x.item }))}</div>`).join('');
    return `
      <p class="desc">${escapeHtml(t(`settlement_desc.${j.to}`))}</p>
      ${robbed}${shocks}
      <div class="kv"><span>${escapeHtml(t('journey.your_money'))}</span><b>${fmtMoney(sim.state.player.money)}</b></div>
      <div class="kv"><span>${escapeHtml(t('journey.cargo'))}</span><b>${S.cargoUnits()} / ${S.cargoCap()}</b></div>
      <div class="kv"><span>${escapeHtml(t('journey.so_far'))}</span><b>${fmtMoney(j.earned - j.spent)}</b></div>
      ${this.priceTable(j.to, { market: true })}
      <div class="muted small">${escapeHtml(t('journey.market_hint'))}</div>
      <div class="row">${button(t('journey.head_home', { n: j.days }), 'head_home', {}, { cls: 'primary' })}</div>`;
  }

  // ------------------------------------------------------------------ report

  renderReport() {
    const sim = this.sim;
    const rep = this.report;
    const list = (o) => Object.entries(o).filter(([, n]) => n > 0).map(([item, n]) => `${itemName(item)} ×${n}`).join(', ') || '—';
    const profit = rep.earned - rep.spent;
    const news = sim.state.chronicle
      .filter((e) => (e.n !== undefined ? e.n > rep.seq : e.day > rep.departDay) && !e.key.startsWith('chronicle.journey') && !e.key.startsWith('chronicle.settlement_contact'))
      .slice(-8)
      .reverse()
      .map((e) => `<div class="chron">${escapeHtml(tr(sim, e.key, e.params))}</div>`)
      .join('');
    return `
      <p class="desc">${escapeHtml(tr(sim, 'journey.back', { settlement: rep.settlement, n: rep.days }))}</p>
      ${rep.robbed ? `<div class="rumor bad">⚠️ ${escapeHtml(rep.robbed.item ? t('journey.robbed_goods', { item: itemName(rep.robbed.item), n: rep.robbed.qty }) : t('journey.robbed_money', { money: fmtMoney(rep.robbed.money) }))}</div>` : ''}
      <div class="kv"><span>${escapeHtml(t('journey.sold'))}</span><b>${escapeHtml(list(rep.sold))} · ${fmtMoney(rep.earned)}</b></div>
      <div class="kv"><span>${escapeHtml(t('journey.bought'))}</span><b>${escapeHtml(list(rep.bought))} · ${fmtMoney(rep.spent)}</b></div>
      <div class="kv"><span>${escapeHtml(t('journey.brought_home'))}</span><b>${escapeHtml(list(rep.cargo))}</b></div>
      <div class="kv"><span>${escapeHtml(t('journey.balance'))}</span><b class="${profit >= 0 ? '' : 'warn'}">${fmtMoney(profit)}</b></div>
      <div class="muted small">${escapeHtml(t('journey.stored_hint'))}</div>
      <h3>${escapeHtml(t('expedition.while_away'))}</h3>
      <div class="chronicle">${news || `<div class="muted small">${escapeHtml(t('expedition.quiet'))}</div>`}</div>
      <div class="row">${button(t('expedition.home_again'), 'close', {}, { cls: 'primary' })}</div>`;
  }

  // ------------------------------------------------------------------ actions

  onAction(action, data) {
    const sim = this.sim;
    const S = sim.settlements;
    const n = Number(data.n) || 1;
    switch (action) {
      case 'pick':
        this.to = data.id;
        break;
      case 'load': {
        const have = S.goodsOnHand()[data.item] || 0;
        const room = S.cargoCap() - Object.values(this.cargo).reduce((a, c) => a + c, 0);
        this.cargo[data.item] = Math.min(have, (this.cargo[data.item] || 0) + Math.min(n, room));
        break;
      }
      case 'unload':
        delete this.cargo[data.item];
        break;
      case 'buy_transport':
        S.buyTransport(data.kind);
        break;
      case 'fund_road':
        S.fundRoad(this.to);
        break;
      case 'set_out': {
        const r = S.setOut(this.to, this.cargo);
        if (r.ok) this.ui.closePanel();
        break;
      }
      case 'sell':
        S.sell(data.item, n);
        break;
      case 'buy':
        S.buy(data.item, n);
        break;
      case 'head_home':
        // Close first (a panel pauses the world), then the days on the road pass.
        this.mode = 'leaving';
        this.ui.closePanel();
        S.headHome();
        break;
      case 'close':
        this.ui.closePanel();
        break;
    }
  }
}
