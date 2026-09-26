/**
 * The guide in the UI (GuideSystem): "What next?" advice with a button to where it's dealt with,
 * the "Getting started" checklist chapter by chapter, and your path — a career to follow, milestone
 * by milestone. Shown on the Journal's Guide tab; the next step also sits in the HUD.
 */
import { t, fmtMoney } from '../i18n/i18n.js';
import { tr, escapeHtml } from './format.js';
import { bar, button } from './widgets.js';
import { GUIDE, PATHS } from '../data/guide.js';

/** Take the player to where a piece of advice is dealt with. */
export function goTo(ui, go) {
  const sim = ui.sim;
  if (!go) return;
  if (typeof go === 'object') {
    if (go.site) return ui.openSite(go.site);
    if (go.property) return ui.openProperty(go.property);
    if (go.equipment) return ui.openEquipment(go.equipment);
    if (go.story) return ui.openStory(go.story);
    return;
  }
  switch (go) {
    case 'jobboard':
      return ui.openJobBoard();
    case 'workers':
      return ui.openWorkers();
    case 'contracts':
      return ui.openJournal('tasks');
    case 'map':
      return ui.togglePanel('map');
    case 'build':
      return sim.progression.hasUnlock('construction') ? ui.openBuild() : ui.openJournal('guide');
    case 'equipment':
    case 'equipment_shop':
      return ui.openEquipment();
    case 'meeting':
      return ui.openMeeting();
    case 'rival':
      return ui.openRival();
    case 'freight':
      return ui.openFreight({ tab: 'deliveries' });
    case 'journey':
      return ui.openJourney();
    case 'orders':
      return ui.openOrders();
    case 'inventory':
      return ui.togglePanel('inventory');
    case 'paths':
    case 'guide':
      return ui.openJournal('guide');
  }
}

/** The whole Guide tab. */
export function guidePageHtml(sim, { showPaths = false } = {}) {
  const G = sim.guide;
  const advice = G.advice(5);
  let html = `<h3>💡 ${escapeHtml(t('guide.next_title'))}</h3>`;
  html += advice.length
    ? advice.map((a, i) => `<div class="setting-row"><div>${a.icon} ${escapeHtml(tr(sim, `advice.${a.id}`, a.params))}</div>${a.go ? button(t('guide.go'), 'guide_go', { i }, { cls: 'sm' }) : ''}</div>`).join('')
    : `<div class="muted small">${escapeHtml(t('guide.all_good'))}</div>`;
  // Your path.
  const pp = G.S.path && G.pathProgress();
  html += `<h3>🧭 ${escapeHtml(t('guide.path_title'))}</h3>`;
  if (pp) {
    html += `<div class="card"><div class="card-head"><div class="card-icon">${pp.icon}</div><div><div class="card-title">${escapeHtml(t(`path.${pp.id}.name`))}</div><div class="card-sub">${escapeHtml(t(`path.${pp.id}.desc`))}</div></div><div class="card-end">${pp.done} / ${pp.list.length}</div></div>
      ${pp.list.map((m) => `<div class="aff-row${m.done ? ' done' : ''}"><span>${m.done ? '✅' : m === pp.next ? '▶️' : '▫️'} ${escapeHtml(t(`path.${pp.id}.m.${m.id}`))}</span>${m.done ? '' : bar((m.value / m.target) * 100, 'xp', `${m.value} / ${m.target}`)}<span class="muted small">${escapeHtml(rewardText(m.reward))}</span></div>`).join('')}
      <div class="btn-row">${button(t('guide.change_path'), 'guide_paths', {}, { cls: 'sm ghost' })}</div></div>`;
  }
  if (!pp || showPaths) {
    html += `<div class="muted small">${escapeHtml(t('guide.paths_hint'))}</div>`;
    html += Object.entries(PATHS).map(([id, P]) => {
      const pr = G.pathProgress(id);
      const cur = G.S.path === id;
      return `<div class="setting-row"><div>${P.icon} <b>${escapeHtml(t(`path.${id}.name`))}</b><div class="hint">${escapeHtml(t(`path.${id}.desc`))} · ${pr.done}/${pr.list.length}</div></div>${cur ? `<span class="chip">${escapeHtml(t('guide.following'))}</span>` : button(t('guide.follow'), 'guide_path', { id }, { cls: 'sm' })}</div>`;
    }).join('');
    if (pp) html += `<div class="btn-row">${button(t('guide.stop_path'), 'guide_path', { id: '' }, { cls: 'sm ghost' })}</div>`;
  }
  // Getting started.
  const pg = G.progress();
  html += `<h3>📘 ${escapeHtml(t('guide.start_title'))} <span class="muted small">${pg.done} / ${pg.total}</span></h3>`;
  const cur = G.current();
  for (const ch of GUIDE) {
    const rows = ch.steps.map((s) => {
      const done = G.isDone(s.id);
      const locked = !done && !G.available(s);
      const now = cur && !cur.locked && cur.step.id === s.id;
      const mark = done ? '✅' : now ? '▶️' : locked ? '🔒' : '▫️';
      const why = locked ? ` <span class="muted small">(${escapeHtml(t('guide.at_level', { n: G.needLevel(s) }))})</span>` : '';
      const hint = now ? `<div class="hint">${escapeHtml(t(`guide.step.${s.id}.hint`))}</div>` : '';
      return `<div class="guide-step${done ? ' done' : ''}${now ? ' now' : ''}"><div>${mark} ${s.icon} ${escapeHtml(t(`guide.step.${s.id}.name`))}${why}${hint}</div>${now && s.open ? button(t('guide.go'), 'guide_open', { id: s.id }, { cls: 'sm' }) : `<span class="muted small">${escapeHtml(rewardText(s.reward))}</span>`}</div>`;
    }).join('');
    html += `<div class="card"><div class="stat-label">${escapeHtml(t(`guide.chapter.${ch.chapter}`))}</div>${rows}</div>`;
  }
  html += `<div class="btn-row">${button(t(G.S.hidden ? 'guide.show_hud' : 'guide.hide_hud'), 'guide_hide', {}, { cls: 'sm ghost' })}</div>`;
  return html;
}

function rewardText(r = {}) {
  return [r.money ? fmtMoney(r.money) : null, r.xp ? `+${r.xp} XP` : null, r.rep ? `+${r.rep} ⭐` : null].filter(Boolean).join(' · ');
}

/** The Guide tab's buttons. Returns true if it was one of them. */
export function guideAction(panel, action, data) {
  const ui = panel.ui;
  const G = ui.sim.guide;
  if (action === 'guide_go') {
    const a = G.advice(5)[Number(data.i)];
    if (a) goTo(ui, a.go);
    return true;
  }
  if (action === 'guide_open') {
    goTo(ui, G.step(data.id)?.open);
    return true;
  }
  if (action === 'guide_path') {
    G.choosePath(data.id || null);
    panel.showPaths = false;
    return true;
  }
  if (action === 'guide_paths') {
    panel.showPaths = !panel.showPaths;
    return true;
  }
  if (action === 'guide_hide') {
    G.hide();
    return true;
  }
  return false;
}
