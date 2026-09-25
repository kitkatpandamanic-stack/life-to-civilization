/**
 * Your affairs — everything about you in one place, on several pages:
 *
 *   summary      who you are, what you're worth, this week at a glance
 *   finances     income and spending by category (this week, last week, 4 weeks, ever),
 *                the last 14 days, transfers, and what's coming due
 *   possessions  every material, food, tool and good you have — in your pockets and your chest
 *   property     your home, buildings, land, businesses, investments, outposts, workers
 *   records      lifetime records, skills, attributes, perks and ambitions
 *
 * Money figures come from LedgerSystem, which records every change to your purse.
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, npcName, itemName } from '../../i18n/i18n.js';
import { escapeHtml, buildingLabel, villageName, parcelName } from '../format.js';
import { bar, icon, tabs, portrait, stat, statGrid, emptyState } from '../widgets.js';
import { propBadges } from '../property.js';
import { ITEMS } from '../../data/items.js';
import { SKILLS } from '../../data/skills.js';
import { PLAYER_TRANSPORT } from '../../data/settlements.js';
import { TRANSFERS } from '../../systems/LedgerSystem.js';
import { maxDurability } from '../../systems/slots.js';

const ATTRS = ['strength', 'endurance', 'agility', 'intelligence', 'charisma', 'craftsmanship', 'trading', 'leadership'];
const GOODS_ORDER = ['resource', 'material', 'food', 'seed', 'furniture', 'tool', 'quest'];
const PERIODS = { week: [7, 0], last: [7, 7], month: [28, 0], all: [Infinity, 0] };

export class AffairsPanel extends Panel {
  constructor(ui, tab = 'summary') {
    super(ui);
    this.tab = tab;
    this.period = 'week';
  }
  get id() {
    return 'affairs';
  }
  title() {
    return `📒 ${escapeHtml(t('affairs.title'))}`;
  }

  render() {
    const pages = [
      ['summary', t('affairs.tab_summary')],
      ['finances', t('affairs.tab_finances')],
      ['possessions', t('affairs.tab_possessions')],
      ['property', t('affairs.tab_property')],
      ['records', t('affairs.tab_records')],
    ];
    const body = { summary: () => this.renderSummary(), finances: () => this.renderFinances(), possessions: () => this.renderPossessions(), property: () => this.renderProperty(), records: () => this.renderRecords() }[this.tab]();
    return tabs(pages, this.tab) + body;
  }

  kv(k, v) {
    return `<div class="kv"><span>${escapeHtml(k)}</span><b>${v}</b></div>`;
  }

  money(n) {
    const v = Math.round(n);
    return `<span class="${v < 0 ? 'warn' : ''}">${v < 0 ? '−' : ''}${escapeHtml(fmtMoney(Math.abs(v)))}</span>`;
  }

  // ------------------------------------------------------------------ summary

  renderSummary() {
    const sim = this.sim;
    const p = sim.state.player;
    const L = sim.ledger;
    const nw = L.netWorth();
    const week = L.summary(7);
    const maxPart = Math.max(1, ...nw.parts.map((x) => Math.abs(x.v)));
    const parts = nw.parts
      .sort((a, b) => b.v - a.v)
      .map((x) => `<div class="aff-row"><span>${escapeHtml(t(`affairs.worth_${x.k}`))}</span>${bar((Math.abs(x.v) / maxPart) * 100, x.v < 0 ? 'warn' : 'xp')}<b>${this.money(x.v)}</b></div>`)
      .join('');
    const role = sim.civic?.isPlayerHeadman() ? t('affairs.role_headman') : null;
    const days = sim.time.day - (p.succeededDay || 0);
    return `
      <div class="dlg-head">
        ${portrait('player', p.look, 72)}
        <div>
          <div class="dlg-name">${escapeHtml(npcName(p))}</div>
          <div class="muted">${escapeHtml(t('ui.level_n', { level: p.level }))} · ${escapeHtml(t('ui.age_n', { age: p.age }))} · ${escapeHtml(t(`title.${sim.progression.title()}`))}${role ? ` · ${escapeHtml(role)}` : ''}</div>
          <div class="muted small">${escapeHtml(t('affairs.generation', { n: p.generation || 1 }))} · ${escapeHtml(t('affairs.days_in', { n: days, place: villageName(sim) }))}</div>
        </div>
      </div>
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('affairs.net_worth'))} — ${this.money(nw.total)}</h3>
          ${parts || `<div class="muted small">${escapeHtml(t('affairs.nothing_yet'))}</div>`}
          <h3>${escapeHtml(t('affairs.this_week'))}</h3>
          ${this.kv(t('affairs.income'), this.money(week.income))}
          ${this.kv(t('affairs.spending'), this.money(-week.spending))}
          ${this.kv(t('affairs.net'), this.money(week.income - week.spending))}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('affairs.standing'))}</h3>
          ${this.kv(t('affairs.money_now'), this.money(p.money))}
          ${p.bank ? this.kv(t('affairs.worth_bank'), this.money(p.bank)) : ''}
          ${this.kv(t('affairs.reputation'), escapeHtml(String(Math.round(p.reputation || 0))))}
          ${sim.legacy ? this.kv(t('hall.renown'), `${escapeHtml(t(`renown.${sim.legacy.tier()}`))} (${sim.legacy.renown()})`) : ''}
          ${this.kv(t('affairs.home'), escapeHtml(t(`home_tier.${sim.home.tierId}`)))}
          ${this.kv(t('journey.transport'), escapeHtml(t(`transport.${p.transport || 'foot'}.name`)))}
          ${this.kv(t('affairs.workers'), sim.workers.list().length)}
          ${this.kv(t('affairs.businesses'), sim.holdings.mine().length)}
          ${this.kv(t('affairs.jobs_done'), sim.state.stats.jobsCompleted)}
          ${sim.jobs.active ? this.kv(t('affairs.current_job'), escapeHtml(t(`job.${sim.jobs.active.jobId}.name`))) : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ finances

  renderFinances() {
    const sim = this.sim;
    const p = sim.state.player;
    const L = sim.ledger;
    const [days, offset] = PERIODS[this.period];
    const s = L.summary(days, offset);
    const periodBtns = Object.keys(PERIODS)
      .map((k) => `<button class="btn${k === this.period ? ' primary' : ''}" data-action="period" data-p="${k}">${escapeHtml(t(`affairs.period_${k}`))}</button>`)
      .join(' ');
    const table = (obj, sign) => {
      const rows = Object.entries(obj).filter(([k]) => !TRANSFERS.includes(k)).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...rows.map(([, v]) => v));
      return rows.map(([k, v]) => `<div class="aff-row"><span>${escapeHtml(t(`ledger.${k}`))}</span>${bar((v / max) * 100, sign < 0 ? 'warn' : 'xp')}<b>${this.money(sign * v)}</b></div>`).join('') || `<div class="muted small">${escapeHtml(t('affairs.none'))}</div>`;
    };
    const transfers = [...new Set([...Object.keys(s.in), ...Object.keys(s.out)])]
      .filter((k) => TRANSFERS.includes(k))
      .map((k) => this.kv(t(`ledger.${k}`), `${s.in[k] ? `+${escapeHtml(fmtMoney(Math.round(s.in[k])))}` : ''} ${s.out[k] ? `−${escapeHtml(fmtMoney(Math.round(s.out[k])))}` : ''}`))
      .join('');
    // The last 14 days: income up, spending down.
    const d14 = L.daily(14);
    const peak = Math.max(1, ...d14.map((d) => Math.max(d.in, d.out)));
    const chart = d14
      .map((d) => `<div class="aff-day" title="${escapeHtml(t('affairs.day_tip', { in: fmtMoney(Math.round(d.in)), out: fmtMoney(Math.round(d.out)) }))}"><div class="aff-in" style="height:${(d.in / peak) * 40}px"></div><div class="aff-out" style="height:${(d.out / peak) * 40}px"></div></div>`)
      .join('');
    // What's coming due.
    const due = [];
    const rentDays = Math.max(0, (p.rent?.nextDueDay ?? 0) - sim.time.day);
    if (p.rent?.amount) due.push(this.kv(t('affairs.rent_due', { n: rentDays }), this.money(-(p.rent.amount + (p.rent.debt || 0)))));
    if (p.loan) due.push(this.kv(t('affairs.loan_due', { left: fmtMoney(p.loan.left) }), this.money(-Math.min(p.loan.weekly, p.loan.left))));
    const wages = sim.workers.list().reduce((a, c) => a + c.salary, 0);
    if (wages) due.push(this.kv(t('affairs.wages_day'), this.money(-wages)));
    const upkeep = PLAYER_TRANSPORT[p.transport || 'foot']?.upkeep || 0;
    if (upkeep) due.push(this.kv(t('affairs.upkeep_week'), this.money(-upkeep)));
    const tax = sim.state.village.taxLog?.slice(-1)[0]?.player;
    if (tax) due.push(this.kv(t('affairs.last_taxes'), this.money(-tax)));
    return `
      <div class="row">${periodBtns}</div>
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('affairs.income'))} — ${this.money(s.income)}</h3>
          ${table(s.in, 1)}
          <h3>${escapeHtml(t('affairs.spending'))} — ${this.money(-s.spending)}</h3>
          ${table(s.out, -1)}
          <div class="aff-total">${escapeHtml(t('affairs.net'))}: <b>${this.money(s.income - s.spending)}</b></div>
        </div>
        <div class="col">
          <h3>${escapeHtml(t('affairs.last_14'))}</h3>
          <div class="aff-chart">${chart}</div>
          <div class="muted small"><span class="aff-key in"></span> ${escapeHtml(t('affairs.income'))} · <span class="aff-key out"></span> ${escapeHtml(t('affairs.spending'))}</div>
          <h3>${escapeHtml(t('affairs.transfers'))}</h3>
          ${transfers || `<div class="muted small">${escapeHtml(t('affairs.none'))}</div>`}
          <div class="muted small">${escapeHtml(t('affairs.transfers_hint'))}</div>
          <h3>${escapeHtml(t('affairs.coming_due'))}</h3>
          ${due.join('') || `<div class="muted small">${escapeHtml(t('affairs.none'))}</div>`}
          ${p.bank ? this.kv(t('affairs.worth_bank'), this.money(p.bank)) : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ possessions

  renderPossessions() {
    const sim = this.sim;
    const p = sim.state.player;
    const goods = {};
    const count = (slots, where) => {
      for (const s of slots || []) {
        const g = (goods[s.id] ??= { pockets: 0, chest: 0 });
        g[where] += s.qty;
      }
    };
    count(p.inventory, 'pockets');
    count(p.storage, 'chest');
    const byCat = {};
    for (const [id, g] of Object.entries(goods)) (byCat[ITEMS[id]?.category || 'quest'] ??= []).push([id, g]);
    let total = 0;
    const sections = GOODS_ORDER.filter((c) => byCat[c]?.length)
      .map((c) => {
        let sum = 0;
        const rows = byCat[c]
          .sort((a, b) => b[1].pockets + b[1].chest - (a[1].pockets + a[1].chest))
          .map(([id, g]) => {
            const n = g.pockets + g.chest;
            const value = (ITEMS[id]?.basePrice || 0) * n;
            sum += value;
            return `<div class="aff-good">${icon(id, 20)} <span class="aff-good-name">${escapeHtml(itemName(id))}</span><span class="muted small">${escapeHtml(t('affairs.pockets_chest', { a: g.pockets, b: g.chest }))}</span><b>×${n}</b><span class="muted small">${escapeHtml(fmtMoney(value))}</span></div>`;
          })
          .join('');
        total += sum;
        return `<h3>${escapeHtml(t(`affairs.cat_${c}`))} <span class="muted small">${escapeHtml(fmtMoney(sum))}</span></h3>${rows}`;
      })
      .join('');
    // Tools: how worn they are.
    const tools = [...(p.inventory || []), ...(p.storage || [])]
      .filter((s) => ITEMS[s.id]?.tool)
      .map((s) => {
        const max = maxDurability(s) || 1;
        return `<div class="aff-row"><span>${icon(s.id, 18)} ${escapeHtml(itemName(s.id))}</span>${bar(((s.dur ?? max) / max) * 100, (s.dur ?? max) / max < 0.25 ? 'warn' : 'energy')}<b>${Math.round(s.dur ?? max)}/${max}</b></div>`;
      })
      .join('');
    const carry = sim.inventory.weight ? `${Math.round(sim.inventory.weight() * 10) / 10} / ${sim.inventory.capacity()}` : '';
    const chest = `${sim.home.storageWeight()} / ${sim.home.storageCapacity()}`;
    return `
      <div class="char-cols">
        <div class="col">
          ${sections || `<div class="muted">${escapeHtml(t('affairs.no_goods'))}</div>`}
          <div class="aff-total">${escapeHtml(t('affairs.goods_value'))}: <b>${escapeHtml(fmtMoney(total))}</b></div>
        </div>
        <div class="col">
          <h3>${escapeHtml(t('affairs.carrying'))}</h3>
          ${carry ? this.kv(t('affairs.pockets'), escapeHtml(carry)) : ''}
          ${this.kv(t('affairs.chest'), escapeHtml(chest))}
          ${this.kv(t('journey.transport'), escapeHtml(`${t(`transport.${p.transport || 'foot'}.name`)} · ${t('journey.transport_stats', { n: PLAYER_TRANSPORT[p.transport || 'foot'].cargo, speed: Math.round(PLAYER_TRANSPORT[p.transport || 'foot'].speed * 100), money: fmtMoney(PLAYER_TRANSPORT[p.transport || 'foot'].upkeep) })}`))}
          <h3>${escapeHtml(t('affairs.tools'))}</h3>
          ${tools || `<div class="muted small">${escapeHtml(t('affairs.no_tools'))}</div>`}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ property

  renderProperty() {
    const sim = this.sim;
    const P = sim.property;
    const E = sim.economy;
    const H = sim.holdings;
    // Your properties: what they bring in, what they cost, and each one's state at a glance.
    const mine = Object.entries(P.all).filter(([, r]) => r.owner === 'player').map(([id]) => id);
    const rented = mine.filter((id) => id !== sim.state.player.homeId && P.isHome(id) && sim.npcs.residentsOf(id).some((n) => P.landlord(n) === 'player'));
    const income = rented.reduce((s, id) => s + P.weeklyRent(id), 0);
    const upkeep = mine.reduce((s, id) => s + (sim.finance?.propertyTax?.(id) || 0), 0);
    const summary = mine.length ? statGrid([stat(t('affairs.props_n'), String(mine.length)), stat(t('affairs.rent_week'), fmtMoney(income), 'pos'), stat(t('affairs.tax_week'), fmtMoney(upkeep), upkeep ? 'neg' : ''), stat(t('affairs.net'), this.money(income - upkeep))]) : '';
    const buildings = mine
      .map((id) => {
        const lvl = sim.structures?.rec(id) ? ` · ${t('structure.level_short', { n: sim.structures.level(id) })}` : '';
        const rent = rented.includes(id) ? `${fmtMoney(P.weeklyRent(id))} ${t('rent_ui.per_week')}` : '';
        return `<div class="prop-row" data-action="building" data-id="${id}"><div><div class="prop-name">${escapeHtml(buildingLabel(sim, id))}<span class="muted small">${escapeHtml(lvl)}</span></div><div>${propBadges(sim, id)}</div></div><span class="muted small">${escapeHtml(rent)}</span><b>${escapeHtml(fmtMoney(P.value(id)))}</b></div>`;
      })
      .join('');
    const land = sim.land.holdings().map((id) => `<div class="prop-row" data-action="land" data-id="${id}"><div><div class="prop-name">🏞️ ${escapeHtml(parcelName(sim, id))}</div><div class="muted small">${escapeHtml(t(`land_kind.${sim.land.info(id)?.kind || 'meadow'}`))} · ${escapeHtml(t('ui.tiles_n', { n: sim.land.plot(id)?.n || 0 }))}</div></div><span></span><b>${escapeHtml(fmtMoney(sim.land.price(id)))}</b></div>`).join('');
    const businesses = H.mine()
      .map((id) => {
        const b = E.biz(id);
        const books = sim.enterprise.books(id, 7);
        return `<div class="aff-row clickable" data-action="business" data-id="${id}"><span>${escapeHtml(buildingLabel(sim, b.building))}</span><span class="muted small">${escapeHtml(t('affairs.biz_line', { money: fmtMoney(Math.round(b.money)), n: sim.npcs.staffOf(id).length }))}</span><b>${this.money(books.profit)}</b></div>`;
      })
      .join('');
    const invest = H.portfolio()
      .map((x) => this.kv(buildingLabel(sim, E.biz(x.id).building), escapeHtml(x.kind === 'stake' ? t('affairs.stake', { n: Math.round(x.share * 100), money: fmtMoney(x.paid) }) : t('affairs.loan_out', { money: fmtMoney(x.left) })) + (x.closed ? ` <span class="warn small">${escapeHtml(t('affairs.closed'))}</span>` : '')))
      .join('');
    const outposts = (sim.state.exploration?.sites || []).filter((s) => s.outpost).map((s) => this.kv(buildingLabel(sim, s.outpost), escapeHtml(t(`site.${s.kind}.name`)))).join('');
    const workers = sim.workers
      .list()
      .map((c) => {
        const n = sim.npcs.byId(c.npcId);
        return n ? `<div class="aff-row"><span>${escapeHtml(npcName(n))}</span><span class="muted small">${escapeHtml(t(`worker_rank.${c.rank}`, { gender: n.gender }))} · ${escapeHtml(t('ui.job_satisfaction'))} ${c.satisfaction}</span><b>${escapeHtml(fmtMoney(c.salary))}/${escapeHtml(t('affairs.day'))}</b></div>` : '';
      })
      .join('');
    const none = `<div class="muted small">${escapeHtml(t('affairs.none'))}</div>`;
    return `
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('affairs.buildings'))}</h3>${summary}${buildings || emptyState('🏠', t('affairs.no_props_title'), t('affairs.no_props_text'))}
          <h3>${escapeHtml(t('affairs.land'))}</h3>${land || none}
          <h3>${escapeHtml(t('affairs.outposts'))}</h3>${outposts || none}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('affairs.businesses'))} <span class="muted small">${escapeHtml(t('affairs.profit_week'))}</span></h3>${businesses || none}
          <h3>${escapeHtml(t('affairs.investments'))}</h3>${invest || none}
          <h3>${escapeHtml(t('affairs.workers'))}</h3>${workers || none}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ records

  renderRecords() {
    const sim = this.sim;
    const p = sim.state.player;
    const st = sim.state.stats;
    const rec = [
      ['jobs_done', st.jobsCompleted],
      ['favours', st.requestsDone],
      ['contracts', sim.state.contracts?.done || 0],
      ['earned', fmtMoney(Math.round(sim.ledger.summary(Infinity).income))],
      ['spent', fmtMoney(Math.round(sim.ledger.summary(Infinity).spending))],
      ['trees', st.treesChopped],
      ['rocks', st.rocksMined],
      ['crops', st.cropsHarvested],
      ['crafted', st.itemsCrafted || 0],
      ['masterworks', st.masterworks || 0],
      ['expeditions', Object.values(sim.state.exploration?.regions || {}).reduce((s, r) => s + (r.visits || 0), 0)],
      ['journeys', Object.values(sim.state.region?.list || {}).reduce((s, x) => s + (x.visits || 0), 0)],
      ['sites', (sim.state.exploration?.sites || []).filter((s) => s.state === 'explored' || s.state === 'developed').length],
      ['deeds', sim.legacy?.deeds().length || 0],
    ]
      .map(([k, v]) => this.kv(t(`affairs.rec_${k}`), escapeHtml(String(v ?? 0))))
      .join('');
    const skills = Object.keys(SKILLS)
      .map((id) => ({ id, s: p.skills[id] || { level: 0, xp: 0 } }))
      .sort((a, b) => b.s.level - a.s.level || b.s.xp - a.s.xp)
      .map(({ id, s }) => `<div class="aff-row"><span>${SKILLS[id].icon} ${escapeHtml(t(`skill.${id}.name`))}</span>${bar(Math.min(100, (s.xp / Math.max(1, sim.progression.skillXpForNext(s.level))) * 100), 'skill')}<b>${s.level}</b></div>`)
      .join('');
    const attrs = ATTRS.map((a) => this.kv(t(`attr.${a}.name`), p.attributes[a])).join('');
    const perks = (p.perks || []).map((k) => `<span class="chip" title="${escapeHtml(t(`perk.${k}.desc`))}">✦ ${escapeHtml(t(`perk.${k}.name`))}</span>`).join('');
    const ambitions = Object.keys(p.achieved || {}).map((id) => `<span class="chip">🏆 ${escapeHtml(t(`ambition.${id}.name`))}</span>`).join('');
    return `
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t('affairs.lifetime'))}</h3>${rec}
          <h3>${escapeHtml(t('ui.attributes'))}</h3>${attrs}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('ui.skills'))}</h3>${skills}
          <h3>${escapeHtml(t('affairs.perks'))}</h3><div class="chips">${perks || `<span class="muted small">${escapeHtml(t('affairs.none'))}</span>`}</div>
          <h3>${escapeHtml(t('affairs.ambitions'))}</h3><div class="chips">${ambitions || `<span class="muted small">${escapeHtml(t('affairs.none'))}</span>`}</div>
        </div>
      </div>`;
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    if (action === 'period') this.period = data.p;
    if (action === 'building') this.ui.openProperty(data.id);
    if (action === 'land') this.ui.openLand(data.id);
    if (action === 'business') this.ui.openEnterprise(data.id);
  }
}

