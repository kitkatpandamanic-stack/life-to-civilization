/**
 * Expedition — the waymark at the edge of the valley. Pick a region on the
 * rough map of what lies beyond, take food for the road and companions,
 * and set out. When you come back, the same panel shows what you found.
 */
import { Panel } from '../Panel.js';
import { t, tn, npcName, fmtMoney, itemName } from '../../i18n/i18n.js';
import { escapeHtml, tr } from '../format.js';
import { button, portrait } from '../widgets.js';
import { REGIONS, EXPEDITION as X } from '../../data/regions.js';

export class ExpeditionPanel extends Panel {
  constructor(ui, report = null) {
    super(ui);
    this.report = report;
    const known = this.sim.exploration.known();
    this.region = known.find((id) => this.sim.exploration.region(id).explored < 100) || known[0];
    this.party = new Set();
  }
  get id() {
    return 'expedition';
  }
  title() {
    return `🧭 ${escapeHtml(t(this.report ? 'expedition.report_title' : 'expedition.title'))}`;
  }

  render() {
    return this.report ? this.renderReport() : this.renderPlan();
  }

  renderMap() {
    const X_ = this.sim.exploration;
    const nodes = Object.entries(REGIONS)
      .map(([id, d]) => {
        const r = X_.region(id);
        if (!r.known) {
          // You know something's out there, not what.
          return `<div class="xp-node unknown" style="left:${d.x}%;top:${d.y}%">?</div>`;
        }
        const cls = `xp-node${id === this.region ? ' selected' : ''}${r.partner ? ' partner' : ''}`;
        return `<div class="${cls}" data-action="pick" data-id="${id}" style="left:${d.x}%;top:${d.y}%"><b>${escapeHtml(t(`region_name.${id}`))}</b><small>${escapeHtml(t('expedition.explored_pct', { n: r.explored }))}</small></div>`;
      })
      .join('');
    return `<div class="xp-map"><div class="xp-valley">${escapeHtml(t('expedition.your_valley'))}</div>${nodes}</div>`;
  }

  renderPlan() {
    const sim = this.sim;
    const E = sim.exploration;
    const id = this.region;
    const def = REGIONS[id];
    const r = E.region(id);
    const party = [...this.party];
    const food = E.foodNeeded(id, party.length);
    const cost = E.cost(id, party.length);
    const chk = E.canSetOut(id, party);
    const danger = def.danger >= 0.15 ? 'high' : def.danger >= 0.08 ? 'medium' : 'low';
    const finds = [...new Set(r.finds)].map((k) => `<span class="chip">${escapeHtml(t(`expedition.find.${k}`))}</span>`).join('') || `<span class="muted small">${escapeHtml(t('expedition.nothing_yet'))}</span>`;
    const hints = Object.keys(def.finds).map((k) => t(`expedition.hint.${k}`));
    const people = E.candidates()
      .sort((a, b) => b.rel - a.rel)
      .slice(0, 8)
      .map((n) => {
        const on = this.party.has(n.id);
        return `<div class="kv clickable${on ? ' selected' : ''}" data-action="toggle" data-id="${n.id}"><span>${on ? '☑' : '☐'} ${portrait(`npc_${sim.state.seed}_${n.id}`, n.look, 22)} ${escapeHtml(npcName(n))}</span><b>${escapeHtml(t('ui.age_n', { age: n.age }))}</b></div>`;
      })
      .join('');
    const away = sim.state.exploration.npcTrips.map((tp) => `<div class="muted small">🧭 ${escapeHtml(tr(sim, 'expedition.npc_away', { npc: tp.npc, region_name: tp.region }))}</div>`).join('');
    return `
      ${this.renderMap()}
      <div class="char-cols">
        <div class="col">
          <h3>${escapeHtml(t(`region_name.${id}`))}</h3>
          <p class="desc">${escapeHtml(t(`region_desc.${id}`))}</p>
          <div class="kv"><span>${escapeHtml(t('expedition.journey'))}</span><b>${escapeHtml(tn('expedition.days', def.days * 2))}</b></div>
          <div class="kv"><span>${escapeHtml(t('expedition.danger'))}</span><b class="danger-${danger}">${escapeHtml(t(`expedition.danger_${danger}`))}</b></div>
          <div class="kv"><span>${escapeHtml(t('expedition.explored'))}</span><b>${r.explored}%</b></div>
          ${r.partner ? `<div class="kv"><span>${escapeHtml(t('expedition.partner'))}</span><b>✓</b></div>` : ''}
          <div class="muted small">${escapeHtml(t('expedition.rumoured'))}: ${escapeHtml(hints.join(', '))}</div>
          <h3>${escapeHtml(t('expedition.found_before'))}</h3>
          <div class="chips">${finds}</div>
          ${away}
        </div>
        <div class="col">
          <h3>${escapeHtml(t('expedition.companions'))} <span class="muted small">(${party.length}/${X.maxCompanions})</span></h3>
          <div class="muted small">${escapeHtml(t('expedition.companions_hint', { money: fmtMoney(X.companionWagePerDay) }))}</div>
          ${people || `<div class="muted small">${escapeHtml(t('expedition.no_companions'))}</div>`}
          <h3>${escapeHtml(t('expedition.supplies'))}</h3>
          <div class="kv"><span>${escapeHtml(t('expedition.food_needed'))}</span><b>${E.foodCarried()} / ${food}</b></div>
          <div class="kv"><span>${escapeHtml(t('expedition.wages'))}</span><b>${fmtMoney(cost)}</b></div>
          <div class="muted small">${escapeHtml(t('expedition.away_hint'))}</div>
          <div class="row">${button(t('expedition.set_out'), 'set_out', {}, { cls: 'primary', disabled: !chk.ok })}</div>
          ${chk.ok ? '' : `<div class="muted small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`}
        </div>
      </div>`;
  }

  renderReport() {
    const sim = this.sim;
    const rep = this.report;
    const finds = rep.finds
      .map((f) => {
        let extra = '';
        if (f.items) extra = f.items.map((x) => `${itemName(x.item)} ×${x.qty}`).join(', ');
        else if (f.money) extra = fmtMoney(f.money);
        else if (f.item) extra = itemName(f.item);
        return `<div class="rumor">✨ ${escapeHtml(t(`expedition.found.${f.kind}`))}${extra ? ` — ${escapeHtml(extra)}` : ''}</div>`;
      })
      .join('');
    const losses = rep.losses.map((l) => `<div class="rumor bad">⚠️ ${escapeHtml(tr(sim, `expedition.loss.${l.kind}`, { npc: l.npc, money: l.money }))}</div>`).join('');
    const revealed = rep.revealed.map((id) => `<div class="rumor">🗺️ ${escapeHtml(t('expedition.revealed', { region: t(`region_name.${id}`) }))}</div>`).join('');
    // The world didn't wait: what happened at home while you were away.
    const news = sim.state.chronicle
      .filter((e) => (e.n !== undefined ? e.n > rep.seq : e.day > rep.departDay) && !e.key.startsWith('chronicle.exp') && !e.key.startsWith('chronicle.expedition') && e.key !== 'chronicle.region_discovered')
      .slice(-8)
      .reverse()
      .map((e) => `<div class="chron">${escapeHtml(tr(sim, e.key, e.params))}</div>`)
      .join('');
    return `
      <p class="desc">${escapeHtml(tr(sim, 'expedition.back', { region_name: rep.region, n: rep.days }))}</p>
      ${finds || `<div class="muted">${escapeHtml(t('expedition.found_nothing'))}</div>`}
      ${losses}${revealed}
      <h3>${escapeHtml(t('expedition.while_away'))}</h3>
      <div class="chronicle">${news || `<div class="muted small">${escapeHtml(t('expedition.quiet'))}</div>`}</div>
      <div class="row">${button(t('expedition.home_again'), 'close', {}, { cls: 'primary' })}</div>`;
  }

  onAction(action, data) {
    const E = this.sim.exploration;
    if (action === 'pick') this.region = data.id;
    if (action === 'toggle') {
      if (this.party.has(data.id)) this.party.delete(data.id);
      else if (this.party.size < X.maxCompanions) this.party.add(data.id);
    }
    if (action === 'set_out') {
      const r = E.setOut(this.region, [...this.party]);
      if (r.ok) this.ui.closePanel();
    }
    if (action === 'close') this.ui.closePanel();
  }
}
