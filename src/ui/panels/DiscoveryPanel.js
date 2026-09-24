/**
 * A discovery site: what it is, what you found there, and what could be built.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { escapeHtml, tr, buildingLabel } from '../format.js';
import { button, icon } from '../widgets.js';
import { SITE_KINDS } from '../../data/sites.js';
import { BUILDABLES } from '../../data/buildables.js';

export class DiscoveryPanel extends Panel {
  constructor(ui, siteId, report) {
    super(ui);
    this.siteId = siteId;
    this.report = report;
  }
  get id() {
    return 'discovery';
  }
  title() {
    const s = this.sim.exploration.site(this.siteId);
    return `🔦 ${escapeHtml(t(`site.${s.kind}.name`))}`;
  }

  render() {
    const sim = this.sim;
    const s = sim.exploration.site(this.siteId);
    const def = SITE_KINDS[s.kind];
    let html = `<p class="desc">${escapeHtml(t(`site.${s.kind}.desc`))}</p>`;
    const r = this.report;
    if (r) {
      html += `<h3>${escapeHtml(t('site_ui.found'))}</h3>`;
      html += r.found.map((f) => `<div class="rumor">${icon(f.item, 20)} ${escapeHtml(itemName(f.item))} ×${f.qty}</div>`).join('');
      if (r.money) html += `<div class="rumor">💰 ${escapeHtml(fmtMoney(r.money))}</div>`;
      if (r.vein) html += `<div class="rumor">⛏️ ${escapeHtml(t('site_ui.vein'))}</div>`;
      if (def.knowledge) html += `<div class="rumor">📜 ${escapeHtml(t('site_ui.knowledge'))}</div>`;
      if (r.hurt) html += `<div class="rumor bad">⚠️ ${escapeHtml(t('site_ui.hurt'))}</div>`;
      if (!r.found.length && !r.money && !r.vein) html += `<div class="muted">${escapeHtml(t('site_ui.nothing'))}</div>`;
    } else html += `<div class="kv"><span>${escapeHtml(t('site_ui.state'))}</span><b>${escapeHtml(t(`site_state.${s.state}`))}</b></div>`;
    if (def.outpost) {
      const type = def.outpost;
      html += `<h3>${escapeHtml(t('site_ui.outpost'))}</h3><p class="desc">${escapeHtml(t(`buildable.${type}.desc`))}</p>`;
      if (s.state === 'developed') html += `<div class="rumor">★ ${escapeHtml(buildingLabel(sim, s.outpost))}</div>`;
      else if (s.outpostSite) html += `<div class="muted small">${escapeHtml(t('site_ui.building'))}</div>`;
      else if (s.state === 'explored') {
        const chk = sim.exploration.canFoundOutpost(s);
        html += `<div class="btn-row">${button(t('action.found_outpost', { building_type: t(`buildable.${type}.name`), money: fmtMoney(BUILDABLES[type].money) }), 'found', {}, { cls: 'primary', disabled: !chk.ok })}</div>`;
        if (!chk.ok) html += `<div class="muted small">${escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</div>`;
      }
    }
    return html;
  }

  onAction(action) {
    if (action === 'found') {
      const r = this.sim.exploration.foundOutpost(this.siteId);
      if (r.ok) this.ui.openSite(r.site.id);
      else this.sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    }
  }
}
