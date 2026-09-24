/**
 * Build — choose what to build. Picking a building closes the panel and
 * starts placement mode (a blueprint follows the mouse).
 * Also: the road tool, and upgrading your home.
 */
import { Panel } from '../Panel.js';
import { t, itemName, fmtMoney } from '../../i18n/i18n.js';
import { tr, escapeHtml } from '../format.js';
import { button, icon, tabs } from '../widgets.js';
import { BUILDABLES, BUILD_CATEGORIES, HOME_UPGRADES, ROAD_COST } from '../../data/buildables.js';
import { skill } from '../../systems/Modifiers.js';

export class BuildPanel extends Panel {
  constructor(ui, tab = null) {
    super(ui);
    this.tab = tab || 'residential';
  }
  get id() {
    return 'build';
  }
  title() {
    return `🔨 ${escapeHtml(t('ui.build_title'))}`;
  }

  materials(mats) {
    const sim = this.sim;
    return Object.entries(mats)
      .map(([id, qty]) => {
        const have = sim.inventory.count(id) + sim.home.storageCount(id);
        return `<span class="ingr ${have >= qty ? 'ok' : 'no'}">${icon(id, 18)} ${escapeHtml(itemName(id))} ${have}/${qty}</span>`;
      })
      .join(' ');
  }

  card(type) {
    const sim = this.sim;
    const def = BUILDABLES[type];
    const p = sim.state.player;
    let reason = null;
    if (!sim.progression.hasUnlock(def.unlock)) reason = tr(sim, 'reason.locked', { level: sim.progression.unlockLevel(def.unlock) });
    else if (def.minSkill && skill(p, 'construction') < def.minSkill) reason = tr(sim, 'reason.need_skill', { skill: 'construction', level: def.minSkill });
    else if (p.money < def.money) reason = tr(sim, 'reason.no_money');
    else if (!sim.land.owned.length) reason = tr(sim, 'reason.no_land');
    return `<div class="build-card${reason ? ' unavailable' : ''}">
      <div class="job-top"><div class="job-name">${escapeHtml(t(`buildable.${type}.name`))} <span class="muted small">${def.w}×${def.h}</span></div><div class="job-pay">${fmtMoney(def.money)} · ⏱ ${def.labor} ${escapeHtml(t('ui.hours_short'))}</div></div>
      <div class="desc">${escapeHtml(t(`buildable.${type}.desc`))}</div>
      <div class="craft-in">${this.materials(def.materials)}</div>
      <div class="job-bottom"><span class="warn small">${reason ? escapeHtml(reason) : ''}</span>${button(t('ui.place_blueprint'), 'place', { type }, { disabled: !!reason, cls: 'primary' })}</div>
    </div>`;
  }

  render() {
    const sim = this.sim;
    const list = [...BUILD_CATEGORIES.map((c) => [c, t(`build_cat.${c}`)]), ['roads', t('build_cat.roads')], ['home', t('build_cat.home')]];
    let body = '';
    if (BUILD_CATEGORIES.includes(this.tab)) {
      body = Object.keys(BUILDABLES)
        .filter((k) => BUILDABLES[k].category === this.tab)
        .map((k) => this.card(k))
        .join('');
    } else if (this.tab === 'roads') {
      const unlocked = sim.progression.hasUnlock('construction');
      body = `<div class="build-card">
        <div class="job-name">${escapeHtml(t('buildable.road.name'))}</div>
        <div class="desc">${escapeHtml(t('buildable.road.desc'))}</div>
        <div class="craft-in">${this.materials({ stone: ROAD_COST.stone })} <span class="muted small">${escapeHtml(t('ui.per_tile'))}</span></div>
        <div class="job-bottom"><span class="warn small">${unlocked ? '' : escapeHtml(tr(sim, 'reason.locked', { level: sim.progression.unlockLevel('construction') }))}</span>${button(t('ui.road_tool'), 'road', {}, { disabled: !unlocked, cls: 'primary' })}</div>
      </div>`;
    } else if (this.tab === 'home') {
      const next = sim.home.nextTier();
      const up = next && HOME_UPGRADES[next];
      const chk = sim.construction.canUpgradeHome();
      body = `<div class="kv"><span>${escapeHtml(t('ui.current_home'))}</span><b>${escapeHtml(t(`home_tier.${sim.home.tierId}`))} · ${escapeHtml(t('stat.comfort'))} ${sim.home.comfort()}</b></div>`;
      if (sim.home.tierId === 'shack') body += `<div class="rumor">${escapeHtml(t('ui.home_shack_hint'))}</div>`;
      else if (up) {
        body += `<div class="build-card${chk.ok ? '' : ' unavailable'}">
          <div class="job-top"><div class="job-name">⬆ ${escapeHtml(t(`home_tier.${next}`))}</div><div class="job-pay">${fmtMoney(up.money)} · ⏱ ${up.labor} ${escapeHtml(t('ui.hours_short'))}</div></div>
          <div class="desc">${escapeHtml(t(`home_tier_desc.${next}`))}</div>
          <div class="craft-in">${this.materials(up.materials)}</div>
          <div class="job-bottom"><span class="warn small">${chk.ok ? '' : escapeHtml(tr(sim, `reason.${chk.reason}`, chk.params || {}))}</span>${button(t('ui.start_upgrade'), 'upgrade', {}, { disabled: !chk.ok, cls: 'primary' })}</div>
        </div>`;
      } else body += `<div class="muted">${escapeHtml(t('ui.home_max'))}</div>`;
    }
    return tabs(list, this.tab) + body + `<div class="muted small">${escapeHtml(t('ui.build_hint'))}</div>`;
  }

  onAction(action, data) {
    if (action === 'tab') this.tab = data.tab;
    else if (action === 'place') {
      this.ui.closePanel();
      this.ui.scene.buildMode.start(data.type);
    } else if (action === 'road') {
      this.ui.closePanel();
      this.ui.scene.buildMode.start('road');
    } else if (action === 'upgrade') {
      if (this.sim.construction.startHomeUpgrade()) this.ui.closePanel();
    }
  }
}
