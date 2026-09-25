/**
 * Items and tools in the UI: tooltips, the tool card (tier, durability, what it does),
 * and a tool's upgrade path (what the next, better one takes to make).
 */
import { ITEMS } from '../data/items.js';
import { RECIPES } from '../data/recipes.js';
import { BUILDABLES } from '../data/buildables.js';
import { FAMILIES, MODULES } from '../data/structures.js';
import { Q } from '../data/quality.js';
import { t, itemName, fmtMoney } from '../i18n/i18n.js';
import { escapeHtml, slotName } from './format.js';
import { icon, condBar, condState, reqList } from './widgets.js';
import { skill } from '../systems/Modifiers.js';

/** Tools of each kind, from worst to best — the upgrade path. */
export const TOOL_ORDER = ['axe', 'pickaxe', 'hammer', 'saw', 'hoe', 'watering_can', 'fishing_rod', 'bow'];
export function toolLine(kind) {
  return Object.keys(ITEMS)
    .filter((id) => ITEMS[id].tool?.kind === kind)
    .sort((a, b) => ITEMS[a].tool.efficiency - ITEMS[b].tool.efficiency || ITEMS[a].tool.durability - ITEMS[b].tool.durability);
}
/** Tier 1 (worn) · 2 (ordinary) · 3 (iron). */
export function toolTier(id) {
  return id.startsWith('worn_') ? 1 : id.startsWith('iron_') ? 3 : 2;
}

/** What an item goes into (recipes, buildings) — "Used for: …". */
function usedFor(id) {
  const out = [];
  for (const [rid, r] of Object.entries(RECIPES)) if (r.inputs?.[id]) out.push(itemName(Object.keys(r.output)[0] || rid));
  const building = Object.values(BUILDABLES).some((b) => b.materials?.[id]) || Object.values(FAMILIES).some((f) => f.levels.some((l) => l?.cost?.materials?.[id])) || Object.values(MODULES).some((m) => m.cost?.materials?.[id]);
  if (building) out.push(t('ui.used_building'));
  return [...new Set(out)].slice(0, 5);
}

/** The tooltip for an item (a slot in your pockets, or just an item id). */
export function itemTip(sim, s) {
  const slot = typeof s === 'string' ? { id: s, qty: 1 } : s;
  const def = ITEMS[slot.id];
  if (!def) return '';
  const rows = [];
  const row = (k, v) => rows.push(`<div class="tip-row"><span>${escapeHtml(k)}</span><b>${v}</b></div>`);
  if (def.tool) {
    const max = sim.inventory.maxDurability(slot);
    const dur = slot.dur ?? max;
    row(t('ui.tier'), String(toolTier(slot.id)));
    row(t('ui.durability'), `${dur} / ${max} · ${escapeHtml(t(`cond.${condState((dur / max) * 100)}`))}`);
    row(t('ui.efficiency'), `×${(Math.round(sim.inventory.toolEfficiency(slot) * 100) / 100).toFixed(2)}`);
  }
  if (def.food) row(t('stat.hunger'), `+${def.food.hunger}`);
  row(t('ui.weight'), `${def.weight} ${t('ui.kg')}`);
  if (def.basePrice) row(t('ui.base_value'), fmtMoney(def.basePrice));
  const uses = def.tool ? [t(`tool_use.${def.tool.kind}`)] : usedFor(slot.id);
  return `<div class="tip-title">${escapeHtml(slotName(slot))}</div>
    <div class="tip-sub">${escapeHtml(t(`item_cat.${def.category}`))}${slot.q !== undefined ? ` · ${escapeHtml(t(`quality.${Q(slot.q).id}`))}` : ''}</div>
    ${rows.join('')}
    ${uses.length ? `<div class="tip-sub" style="margin-top:6px">${escapeHtml(t('ui.used_for'))}</div><ul class="tip-list">${uses.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>` : ''}`;
}

/** The tool card: tier, durability (in words too), what it's for — and what the next one up takes. */
export function toolCard(sim, slot) {
  const def = ITEMS[slot.id];
  const max = sim.inventory.maxDurability(slot);
  const pct = (slot.dur / max) * 100;
  const line = toolLine(def.tool.kind);
  const i = line.indexOf(slot.id);
  const path = line
    .map((id, k) => `<div class="upgrade-step${k === i ? ' current' : k < i ? ' done' : ''}">${icon(id, 24)}<span>${escapeHtml(itemName(id))}</span></div>`)
    .join('<span class="upgrade-arrow">→</span>');
  const next = line[i + 1];
  let upgrade = '';
  if (next) {
    const r = RECIPES[next];
    const p = sim.state.player;
    if (r) {
      const have = (id) => sim.inventory.count(id) + sim.home.storageCount(id);
      const rows = Object.entries(r.inputs).map(([id, n]) => ({ item: id, label: itemName(id), have: have(id), need: n, ok: have(id) >= n }));
      if (r.minSkill) rows.push({ ico: '🎓', label: t('ui.skill_level', { skill: t(`skill.${r.skill}.name`), n: r.minSkill }), ok: skill(p, r.skill) >= r.minSkill });
      if (r.tool) rows.push({ ico: '🔨', label: t('ui.needs_tool', { tool: t(`tool_kind.${r.tool}`) }), ok: !!sim.inventory.bestTool(r.tool) });
      if (r.unlock) rows.push({ ico: '🔓', label: t(`unlock.${r.unlock}.name`), ok: sim.progression.hasUnlock(r.unlock) });
      upgrade = `<h3>⬆ ${escapeHtml(t('ui.next_tool', { item: itemName(next) }))}</h3>
        <div class="small muted">${escapeHtml(t('ui.next_tool_gain', { eff: Math.round((ITEMS[next].tool.efficiency / def.tool.efficiency - 1) * 100), dur: ITEMS[next].tool.durability }))}</div>
        ${reqList(rows)}
        <div class="hint">${escapeHtml(t(`station_where.${r.station}`))}</div>`;
    } else upgrade = `<div class="hint">${escapeHtml(t('ui.next_tool_buy', { item: itemName(next) }))}</div>`;
  } else upgrade = `<div class="hint">✓ ${escapeHtml(t('ui.best_tool'))}</div>`;
  return `<div class="tool-card">
      <div class="tool-tier">${escapeHtml(t('ui.tier_n', { n: toolTier(slot.id) }))} · ${escapeHtml(t(`tool_kind.${def.tool.kind}`))}${slot.held ? ` · ${escapeHtml(t('ui.in_hand'))}` : ''}</div>
      <div class="bar-label"><span>${escapeHtml(t('ui.durability'))}</span><b>${slot.dur} / ${max}</b></div>
      ${condBar(pct)}
      <div class="kv"><span>${escapeHtml(t('ui.efficiency'))}</span><b>×${(Math.round(sim.inventory.toolEfficiency(slot) * 100) / 100).toFixed(2)}</b></div>
      <div class="small">${escapeHtml(t(`tool_use.${def.tool.kind}`))}</div>
      ${pct < 40 ? `<div class="hint">🔧 ${escapeHtml(t('ui.repair_at_smith'))}</div>` : ''}
      <h3>${escapeHtml(t('ui.upgrade_path'))}</h3>
      <div class="upgrade-path">${path}</div>
      ${upgrade}
    </div>`;
}
