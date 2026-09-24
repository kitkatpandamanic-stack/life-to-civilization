/**
 * Construction site — progress, materials delivered vs. needed, who's working on it.
 */
import { Panel } from '../Panel.js';
import { t, itemName, npcName, cap } from '../../i18n/i18n.js';
import { escapeHtml } from '../format.js';
import { bar, button, icon } from '../widgets.js';

export class SitePanel extends Panel {
  constructor(ui, id) {
    super(ui);
    this.siteId = id;
    this.confirmCancel = false;
  }
  get id() {
    return 'site';
  }
  get c() {
    return this.sim.construction.byId(this.siteId);
  }
  title() {
    const c = this.c;
    const theirs = c && !this.sim.construction.isPlayers(c);
    const name = c?.kind === 'upgrade' ? t(`home_tier.${c.toTier}`) : theirs ? t(`vbuilding.${c.type}`) : t(`buildable.${c?.type}.name`);
    return `🏗️ ${escapeHtml(t('ui.site_of', { name }))}`;
  }

  render() {
    const sim = this.sim;
    const c = this.c;
    if (!c || c.status !== 'site') return `<div class="muted">${escapeHtml(t('ui.finished'))}</div>`;
    const cons = sim.construction;
    const stage = cons.stage(c);
    const mats = Object.entries(c.required)
      .map(([id, qty]) => {
        const d = Math.min(qty, c.delivered[id] || 0);
        return `<div class="mat-row">${icon(id, 22)}<span>${escapeHtml(itemName(id))}</span>${bar((d / qty) * 100, d >= qty ? '' : 'warn', `${d}/${qty}`)}<span class="muted small">${escapeHtml(t('ui.you_carry', { n: sim.inventory.count(id) }))}</span></div>`;
      })
      .join('');
    const hoursLeft = ((c.laborNeeded - c.labor) / 60).toFixed(1);
    const workers = Object.values(sim.state.workers).filter((w) => w.assignment?.type === 'build' && w.assignment.siteId === c.id);
    const theirs = !cons.isPlayers(c);
    // Villagers working on a villager's (or the village's) building right now.
    const helpers = theirs ? sim.state.npcs.filter((n) => (n.task?.site === c.id && n.task.stage === 'idle') || (n.task?.siteId === c.id && n.task.stage === 'doing')) : [];
    const owner = theirs && c.owner !== 'village' ? sim.npcs.byId(c.owner) : null;
    const ownerLine = theirs ? `<div class="kv"><span>${escapeHtml(t('ui.owner'))}</span><b>${escapeHtml(owner ? npcName(owner) : t('owner.village'))}</b></div><div class="kv"><span>${escapeHtml(t('ui.purpose'))}</span><b>${escapeHtml(cap(t(`purpose.${c.purpose}`)))}</b></div>` : '';
    const stages = ['foundation', 'frame', 'walls', 'roof'].map((s, i) => `<span class="stage${i < stage ? ' done' : i === stage ? ' now' : ''}">${escapeHtml(t(`site_stage.${s}`))}</span>`).join('<span class="stage-arrow">→</span>');
    return `
      ${ownerLine}
      <div class="stages">${stages}</div>
      <h3>${escapeHtml(t('ui.work_progress'))}</h3>
      ${bar((c.labor / c.laborNeeded) * 100, 'xp', t('ui.hours_left', { h: hoursLeft }))}
      <div class="muted small">${escapeHtml(t('ui.your_rate', { h: (cons.playerLaborPerHour() / 60).toFixed(2) }))}</div>
      <h3>${escapeHtml(t('ui.materials'))}</h3>
      ${mats}
      ${cons.materialsFraction(c) < 1 && c.labor >= cons.maxLabor(c) - 0.5 ? `<div class="warn small">${escapeHtml(t('reason.need_materials'))}</div>` : ''}
      <h3>${escapeHtml(t('ui.builders'))}</h3>
      ${[...workers.map((w) => sim.npcs.byId(w.npcId)), ...helpers].filter(Boolean).map((n) => `<div class="rumor">👷 ${escapeHtml(npcName(n))}</div>`).join('') || `<div class="muted small">${escapeHtml(t('ui.no_builders'))}</div>`}
      <div class="btn-row">
        ${button(t(theirs ? 'ui.give_materials' : 'action.deliver_materials'), 'deliver', {}, { cls: 'primary' })}
        ${theirs ? '' : button(t('ui.deliver_from_chest'), 'deliver_chest', {})}
        ${theirs ? '' : this.confirmCancel ? `${escapeHtml(t('ui.cancel_confirm'))} ${button(t('ui.yes'), 'cancel_yes', {}, { cls: 'danger' })} ${button(t('ui.no'), 'cancel_no')}` : button(t('ui.cancel_site'), 'cancel', {})}
      </div>
      <div class="muted small">${escapeHtml(t(theirs ? 'ui.site_hint_theirs' : 'ui.site_hint'))}</div>`;
  }

  onAction(action) {
    const sim = this.sim;
    const c = this.c;
    if (!c) return;
    if (action === 'deliver') sim.toast('toast.delivered', { qty: sim.construction.deliver(c, 'inventory') }, 'gain');
    else if (action === 'deliver_chest') {
      // The chest is at home — you can only do this if you're there, or a worker hauls it.
      if (!this.ui.scene.inside && !this.nearHome()) sim.toast('reason.chest_far', {}, 'warn');
      else sim.toast('toast.delivered', { qty: sim.construction.deliver(c, 'storage') }, 'gain');
    } else if (action === 'cancel') this.confirmCancel = true;
    else if (action === 'cancel_no') this.confirmCancel = false;
    else if (action === 'cancel_yes') {
      sim.construction.cancel(c);
      this.ui.closePanel();
    }
  }

  /** The site is next to your home (e.g. a shed beside the house) — chest in reach. */
  nearHome() {
    const sim = this.sim;
    const home = sim.world.buildings[sim.state.player.homeId];
    const c = this.c;
    return home && Math.abs(home.tx - c.tx) + Math.abs(home.ty - c.ty) <= 12;
  }
}
