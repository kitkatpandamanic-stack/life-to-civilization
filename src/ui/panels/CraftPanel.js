/**
 * Crafting — recipes available at a station (workbench, stove...).
 * Shows what's needed, what you have (pockets + home storage) and why a recipe is locked.
 */
import { Panel } from '../Panel.js';
import { t, itemName } from '../../i18n/i18n.js';
import { tr, escapeHtml, qualityBadge } from '../format.js';
import { icon, button } from '../widgets.js';
import { RECIPES } from '../../data/recipes.js';
import { EQUIPMENT } from '../../data/transport.js';

export class CraftPanel extends Panel {
  constructor(ui, station) {
    super(ui);
    this.station = station;
    this.sim.crafting.openStation(station);
  }
  get id() {
    return 'craft';
  }
  title() {
    return `🪚 ${escapeHtml(t(`furniture.${this.station}`))}`;
  }

  render() {
    const sim = this.sim;
    const rows = sim.crafting.recipesFor(this.station).map((id) => {
      const r = RECIPES[id];
      const check = sim.crafting.check(id);
      const inputs = Object.entries(r.inputs)
        .map(([item, qty]) => {
          const have = sim.crafting.available(item, true);
          return `<span class="ingr ${have >= qty ? 'ok' : 'no'}">${icon(item, 20)} ${escapeHtml(itemName(item))} ${have}/${qty}</span>`;
        })
        .join(' ');
      const [outId, outQty] = r.equipment ? [null, 1] : Object.entries(r.output)[0];
      const secs = (sim.crafting.duration(id) / 1000).toFixed(1);
      const extras = [r.tool ? t(`ui.req_tool_${r.tool}`) : null, r.minSkill ? `${t(`skill.${r.skill}.name`)} ${r.minSkill}` : null, r.energy ? `⚡ ${r.energy}` : null].filter(Boolean).join(' · ');
      return `<div class="craft-row${check.ok ? '' : ' unavailable'}">
        <div class="craft-out">${r.equipment ? `<span class="eq-icon">${EQUIPMENT[r.equipment].icon}</span><div><b>${escapeHtml(t(`equip.${r.equipment}`))}</b><div class="muted small">${escapeHtml(t('equip.made_desc', { n: EQUIPMENT[r.equipment].cap }))}</div></div>` : `${icon(outId, 36)}<div><b>${escapeHtml(itemName(outId))}</b>${outQty > 1 ? ` ×${outQty}` : ''}<div class="muted small">${escapeHtml(t(`item.${outId}.desc`))}</div></div>`}</div>
        <div class="craft-in">${inputs}${extras ? `<div class="muted small">${escapeHtml(extras)}</div>` : ''}</div>
        <div class="craft-act">
          <div class="muted small">⏱ ${secs}s</div>
          ${button(t('ui.craft'), 'craft', { id, n: 1 }, { disabled: !check.ok, cls: 'primary' })}
          ${button(t('ui.craft_n', { n: 5 }), 'craft', { id, n: 5 }, { disabled: !check.ok })}
          ${check.ok ? '' : `<div class="warn small">${escapeHtml(tr(sim, `reason.${check.reason}`, check.params || {}))}</div>`}
        </div>
      </div>`;
    });
    const hint = this.station === 'forge' ? 'ui.craft_hint_forge' : 'ui.craft_hint';
    return rows.join('') + `<div class="muted small">${escapeHtml(t(hint))} ${escapeHtml(t('ui.quality_hint'))}</div>`;
  }

  onAction(action, data) {
    if (action === 'craft') {
      this.ui.closePanel();
      this.ui.scene.craft(data.id, Number(data.n));
    }
  }
}
