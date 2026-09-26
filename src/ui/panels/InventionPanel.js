/**
 * Inventions (at a workbench — yours at home, or your own workshop): the idea you're working on and how
 * the race stands, the ideas you could take on (what each would change, what it takes, what it'd earn),
 * and your patents (royalties so far, weeks left, licences for other towns).
 */
import { Panel } from '../Panel.js';
import { t, fmtMoney, itemName, npcName } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, progress, reqList, status, emptyState, notice } from '../widgets.js';
import { INVENTIONS, INVENT } from '../../data/inventions.js';

/** What an invention's effects mean, in words. */
function effectText(fx) {
  return Object.entries(fx)
    .map(([k, v]) => t(`invention_fx.${k}`, { n: Math.round(Math.abs(v - 1) * 100) }))
    .join(' · ');
}

export class InventionPanel extends Panel {
  get id() {
    return 'inventions';
  }
  title() {
    return `💡 ${escapeHtml(t('invent.title'))}`;
  }

  projectHtml() {
    const sim = this.sim;
    const I = sim.inventions;
    const p = I.S.project;
    if (!p) return `<div class="hint">${escapeHtml(t('invent.no_project'))}</div>`;
    const d = INVENTIONS[p.id];
    const race = I.race();
    const left = Math.max(0, I.need(p.id) - p.done);
    const sittings = Math.ceil(left / (INVENT.sessionMinutes * I.speed()));
    const rival = race.npc && sim.npcs.byId(race.npc);
    const chk = I.canWork();
    return `<div class="card selected">
      <div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`invention.${p.id}.name`))}</div><div class="card-sub">${escapeHtml(t(`invention.${p.id}.desc`))}</div></div></div>
      ${progress(race.you, { label: t('invent.you'), kind: 'gold' })}
      ${rival ? progress(race.rival, { label: t('invent.rival', { name: npcName(rival) }), kind: race.rival > race.you ? 'danger' : 'warn' }) : ''}
      <div class="small muted">${escapeHtml(t('invent.sittings_left', { n: sittings }))}${rival ? ` · ${escapeHtml(t('invent.race_hint'))}` : ''}</div>
      <div class="btn-row">${button(t('invent.work'), 'work', {}, { cls: 'primary', disabled: !chk.ok, ico: '🔨', title: chk.ok ? '' : tr(sim, `reason.${chk.reason}`, chk.params || {}) })}</div>
    </div>`;
  }

  ideaHtml(id) {
    const sim = this.sim;
    const I = sim.inventions;
    const d = INVENTIONS[id];
    const chk = I.canStart(id);
    const lvl = sim.state.player.skills[d.skill]?.level || 0;
    const rows = [
      { ico: '🎓', label: t('ui.skill_level', { skill: t(`skill.${d.skill}.name`), n: d.min }), ok: lvl >= d.min, have: lvl, need: d.min },
      ...d.needs.map((x) => ({ ico: '💡', label: t(`tech.${x}.name`), ok: sim.tech.has(x) })),
      ...Object.entries(d.materials).map(([item, n]) => ({ item, label: itemName(item), have: I.have(item), need: n, ok: I.have(item) >= n })),
    ];
    const payers = sim.economy.active().filter((b) => d.payers.includes(sim.economy.def(b)?.type)).length;
    return `<div class="card">
      <div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`invention.${id}.name`))}</div><div class="card-sub">${escapeHtml(t(`invention.${id}.desc`))}</div></div>
        <div class="card-end small">${escapeHtml(t('invent.hours', { n: d.hours }))}</div></div>
      <div class="small good">▲ ${escapeHtml(effectText(d.effects))}</div>
      <div class="small">💰 ${escapeHtml(t('invent.royalty_line', { money: fmtMoney(d.royalty), n: payers, types: d.payers.map((x) => t(`biz_type.${x}`)).join(', ') }))}</div>
      ${reqList(rows)}
      <div class="btn-row">${button(t('invent.start'), 'start', { id }, { cls: chk.ok ? 'primary sm' : 'sm', disabled: !chk.ok, ico: '💡' })}${chk.ok || chk.reason === 'project_underway' ? '' : `<span class="warn small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</span>`}</div>
    </div>`;
  }

  patentHtml(id, P) {
    const sim = this.sim;
    const I = sim.inventions;
    const d = INVENTIONS[id];
    const mine = P.owner === 'player';
    const owner = mine ? t('bcard.owner_you') : npcName(sim.npcs.byId(P.owner)) || '—';
    const weeks = Math.max(0, Math.ceil((P.until - sim.time.day) / 7));
    const live = weeks > 0;
    const towns = mine && live ? sim.settlements.known().filter((s) => sim.settlements.get(s)?.contact) : [];
    return `<div class="card">
      <div class="card-head"><div class="card-icon">${d.icon}</div><div><div class="card-title">${escapeHtml(t(`invention.${id}.name`))}</div><div class="card-sub">${escapeHtml(t('invent.patent_of', { name: owner }))}</div></div>
        <div class="card-end">${live ? status(t('invent.weeks_left', { n: weeks }), mine ? 'good' : 'neutral', '📜') : status(t('invent.expired'), 'neutral', '⌛')}</div></div>
      <div class="small good">▲ ${escapeHtml(effectText(d.effects))}</div>
      ${mine ? `<div class="small">💰 ${escapeHtml(t('invent.earned', { money: fmtMoney(P.earned), n: I.payers(id).length, r: fmtMoney(d.royalty) }))}</div>` : ''}
      ${towns.length ? `<div class="btn-row"><span class="hint">${escapeHtml(t('invent.licence_hint'))}</span>${towns.map((s) => {
        const c = I.canLicence(id, s);
        return button(c.ok ? t('invent.licence', { settlement: t(`settlement_name.${s}`), money: fmtMoney(c.price) }) : `${t(`settlement_name.${s}`)} ✓`, 'licence', { id, s }, { cls: 'sm', disabled: !c.ok });
      }).join('')}</div>` : ''}
    </div>`;
  }

  render() {
    const sim = this.sim;
    const I = sim.inventions;
    let html = `<div class="hint">${escapeHtml(t('invent.hint'))}</div>`;
    html += `<h3>🔬 ${escapeHtml(t('invent.now'))}</h3>${this.projectHtml()}`;
    const patents = Object.entries(I.S.patents);
    if (patents.length) html += `<h3>📜 ${escapeHtml(t('invent.patents'))}</h3>${patents.map(([id, P]) => this.patentHtml(id, P)).join('')}`;
    const ideas = Object.keys(INVENTIONS).filter((id) => !I.S.patents[id] && I.S.project?.id !== id);
    // What you could try soonest first.
    ideas.sort((a, b) => (I.canStart(b).ok ? 1 : 0) - (I.canStart(a).ok ? 1 : 0) || INVENTIONS[a].min - INVENTIONS[b].min);
    html += `<h3>💡 ${escapeHtml(t('invent.ideas'))}</h3>${ideas.map((id) => this.ideaHtml(id)).join('') || emptyState('✨', t('invent.all_done'))}`;
    const log = I.S.log.slice(0, 6).map((e) => `<div class="rumor small">${escapeHtml(tr(sim, `invent_log.${e.key}`, e.params))}</div>`).join('');
    if (log) html += `<h3>${escapeHtml(t('invent.log'))}</h3>${log}`;
    return html;
  }

  onAction(action, data) {
    const sim = this.sim;
    const I = sim.inventions;
    if (action === 'start') {
      const r = I.start(data.id);
      if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
      else sim.toast(r.rival ? 'toast.invent_rival' : 'toast.invent_started', { invention: data.id, npc: r.rival || undefined }, r.rival ? 'warn' : 'good');
    } else if (action === 'work') {
      this.ui.closePanel();
      this.ui.scene.inventTime();
    } else if (action === 'licence') {
      const r = I.licenceSold(data.id, data.s);
      sim.toast(r.ok ? 'toast.licence_sold' : `reason.${r.reason}`, r.ok ? { invention: data.id, settlement: data.s, money: r.price } : r.params || {}, r.ok ? 'gain' : 'warn');
    }
  }
}
