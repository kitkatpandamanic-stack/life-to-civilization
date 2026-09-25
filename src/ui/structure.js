/**
 * The building side of a property: its level, quality, modules and what could be done to it
 * (StructureSystem). Used by PropertyPanel's "Building" tab and the Build panel's home tab.
 */
import { t, fmtMoney, itemName } from '../i18n/i18n.js';
import { tr, escapeHtml } from './format.js';
import { bar, button, condBar, status, stat, statGrid, reqList, emptyState, notice, tipAttr } from './widgets.js';
import { drawStructure, lookKey } from '../render/TextureFactory.js';
import { MODULES } from '../data/structures.js';

/** "Medium house", "Master workshop"… */
export function levelName(sim, id, lvl = null) {
  const r = sim.structures.rec(id);
  if (!r) return '';
  return t(`structure.level.${r.fam}.${lvl ?? r.lvl}`);
}

/** What a job is called: "Build up to a large house", "Add a cellar", "Renovate"… */
export function jobLabel(sim, id, job) {
  if (job.type === 'level') return t('works.level', { name: levelName(sim, id, job.to) });
  if (job.type === 'module') return t('works.module', { m: t(`module.${job.m}.name`) });
  if (job.type === 'spec') return t('works.spec', { s: t(`spec.${job.s}.name`) });
  return t(`works.${job.type}`);
}

/** What a job would change, worked out from the building's effects before and after. */
export function jobEffects(sim, id, job, asList = false) {
  const S = sim.structures;
  const r = S.rec(id);
  if (!r) return asList ? [] : '';
  const after = { ...r, mods: { ...r.mods } };
  if (job.type === 'level') after.lvl = job.to;
  if (job.type === 'module') after.mods[job.m] = (after.mods[job.m] || 0) + 1;
  if (job.type === 'spec') after.spec = job.s;
  const a = S.computeFx(r);
  const b = S.computeFx(after);
  const out = [];
  const diff = (k, key, fmt = (v) => v) => {
    const d = (b[k] ?? 0) - (a[k] ?? 0);
    if (Math.abs(d) > 0.009) out.push(t(key, { n: fmt(d), sign: d > 0 ? '+' : '' }));
  };
  if (a.cap !== null) diff('cap', 'works_fx.cap');
  diff('floors', 'works_fx.floors');
  diff('staff', 'works_fx.staff');
  diff('output', 'works_fx.output', (d) => Math.round(d * 100));
  diff('stock', 'works_fx.stock', (d) => Math.round(d * 100));
  diff('appeal', 'works_fx.appeal', (d) => d.toFixed(1));
  diff('seats', 'works_fx.seats');
  diff('comfort', 'works_fx.comfort');
  diff('storage', 'works_fx.storage');
  if ((b.rentMult || 1) !== (a.rentMult || 1)) {
    const d = Math.round(((b.rentMult || 1) / (a.rentMult || 1) - 1) * 100);
    out.push(t('works_fx.rent', { n: d, sign: d > 0 ? '+' : '' }));
  }
  if (job.type === 'renovate') out.push(t('works_fx.quality', { n: S.cost(id, job)?.points || 0 }));
  const grow = S.growthOf(id, job);
  if (grow?.cols) out.push(t('works_fx.wider', { n: grow.cols }));
  if (grow?.rows) out.push(t('works_fx.deeper', { n: grow.rows }));
  if (job.type === 'module' && MODULES[job.m]?.health) out.push(t('works_fx.health'));
  if (job.type === 'module' && MODULES[job.m]?.warm) out.push(t('works_fx.warm'));
  return asList ? out : out.join(' · ');
}

const previewCache = new Map();

/** A picture of the building — as it is, or as it will be (drawn the same way as in the world). */
export function buildingPreview(sim, id, look = undefined) {
  const b = sim.world.buildings[id];
  if (!b) return '';
  const lk = look === undefined ? b.look || null : look;
  const key = `${id}:${b.type}:${lookKey(lk)}`;
  if (!previewCache.has(key)) {
    try {
      previewCache.set(key, drawStructure(b.type, b.variant || 0, lk).canvas.toDataURL());
    } catch {
      previewCache.set(key, '');
    }
    if (previewCache.size > 40) previewCache.delete(previewCache.keys().next().value);
  }
  const url = previewCache.get(key);
  return url ? `<img src="${url}" alt="">` : '';
}

/** What the building will look like after this job (for the before/after preview). */
function lookAfterJob(sim, id, job) {
  const S = sim.structures;
  const grow = S.growthOf(id, job);
  const fp = grow ? S.newFootprint(id, grow, 'player') : null;
  const b = sim.world.buildings[id];
  return S.lookAfter({ target: id, job, fp: fp || null, w: fp?.w ?? b.w, h: fp?.h ?? b.h });
}

/** Everything a job takes, each with ✓ or ✗ (money, materials you have to hand, skill, know-how, ground). */
function jobReqs(sim, id, o) {
  const p = sim.state.player;
  const cost = o.cost;
  const rows = [];
  if (cost.money) rows.push({ ico: '💰', label: t('ui.money'), have: fmtMoney(Math.floor(p.money)), need: fmtMoney(cost.money), ok: p.money >= cost.money });
  // It grows onto ground that isn't yours yet: that strip is bought from the village too.
  if (cost.land) rows.push({ ico: '🏞️', label: t('structure.land_needed', { money: fmtMoney(cost.land) }), ok: p.money >= (cost.money || 0) + cost.land });
  const have = (item) => sim.inventory.count(item) + sim.home.storageCount(item);
  for (const [item, n] of Object.entries(cost.materials || {})) rows.push({ item, label: itemName(item), have: have(item), need: n, ok: have(item) >= n });
  if (cost.minSkill) rows.push({ ico: '🎓', label: t('ui.skill_level', { skill: t('skill.construction.name'), n: cost.minSkill }), ok: o.check.reason !== 'need_skill' });
  for (const tech of cost.tech || []) rows.push({ ico: '💡', label: t(`tech.${tech}.name`), ok: !!sim.tech?.has(tech) });
  const grow = sim.structures.growthOf(id, o.job);
  if (grow) rows.push({ ico: '📐', label: t('works_req.room', { n: grow.cols || grow.rows }), ok: o.check.reason !== 'no_room' });
  return rows;
}

/** Hours of work, told plainly: "≈ 26 h of work (about 3 days for one builder)". */
function laborText(hours) {
  return t('works_req.time', { n: hours, d: Math.max(1, Math.ceil(hours / 8)) });
}

/** A work in progress: how far along, what's still missing, who's on it. */
function worksProgress(sim, id, works) {
  const pct = Math.round((works.labor / works.laborNeeded) * 100);
  const mat = sim.construction.materialsFraction(works);
  const missing = sim.construction.missing(works);
  const left = Math.max(0, Math.round((works.laborNeeded - works.labor) / 60));
  const hands = sim.state.npcs.filter((n) => (n.task?.site === works.id && n.task.stage === 'idle') || (n.task?.siteId === works.id && n.task.stage === 'doing')).length + Object.values(sim.state.workers).filter((w) => w.assignment?.siteId === works.id).length;
  const mats = Object.entries(works.required).map(([item, n]) => ({ item, label: itemName(item), have: Math.min(n, works.delivered[item] || 0), need: n, ok: (works.delivered[item] || 0) >= n }));
  return `<div class="works-progress">
    <div class="uc-head"><div class="uc-title">🏗️ ${escapeHtml(jobLabel(sim, id, works.job))}</div>${status(`${pct}%`, 'info')}</div>
    ${bar(pct, 'xp', `${pct}%`)}
    <div class="bar-label"><span>${escapeHtml(t('works_req.left', { n: left }))}</span><b>${escapeHtml(t('works_req.hands', { n: hands }))}</b></div>
    ${Object.keys(missing).length ? `<div class="stat-label" style="margin-top:8px">${escapeHtml(t('ui.materials'))} · ${Math.round(mat * 100)}%</div>${reqList(mats)}` : `<div class="hint">✓ ${escapeHtml(t('works_req.all_delivered'))}</div>`}
    <div class="btn-row">${button(t('action.inspect_site'), 'open_site', { site: works.id }, { cls: 'sm' })}</div>
  </div>`;
}

/** The big one: building up a level, with a before/after picture, what changes and what it takes. */
function upgradeCard(sim, id, o) {
  const r = sim.structures.rec(id);
  const changes = jobEffects(sim, id, o.job, true);
  const why = o.check.ok ? '' : tr(sim, `reason.${o.check.reason}`, o.check.params || {});
  const after = lookAfterJob(sim, id, o.job);
  return `<div class="upgrade-card${o.check.ok ? ' ready' : ''}">
    <div class="uc-head"><div class="uc-title">⬆ ${escapeHtml(jobLabel(sim, id, o.job))}</div>${o.check.ok ? status(t('works_req.ready'), 'good', '✓') : status(t('works_req.not_yet'), 'warn', '✗')}</div>
    <div class="preview-pair">
      <figure>${buildingPreview(sim, id)}<figcaption>${escapeHtml(t('works_req.now', { n: r.lvl }))}</figcaption></figure>
      <span class="preview-arrow">➜</span>
      <figure>${buildingPreview(sim, id, after)}<figcaption>${escapeHtml(t('works_req.after', { n: o.job.to }))}</figcaption></figure>
    </div>
    <div class="uc-cols">
      <div><div class="stat-label">${escapeHtml(t('works_req.changes'))}</div><div class="uc-changes">${changes.map((c) => `<div>${escapeHtml(c)}</div>`).join('') || `<div>${escapeHtml(t('works_req.better'))}</div>`}</div></div>
      <div><div class="stat-label">${escapeHtml(t('works_req.needs'))}</div>${reqList(jobReqs(sim, id, o))}</div>
    </div>
    ${why ? notice('warn', escapeHtml(why)) : ''}
    <div class="uc-foot"><span class="hint">⏱ ${escapeHtml(laborText(o.cost.labor))}</span>${button(t('structure.start'), 'start_works', { job: JSON.stringify(o.job) }, { cls: o.check.ok ? 'primary' : '', disabled: !o.check.ok })}</div>
  </div>`;
}

/** A smaller job (a room, a garden, a renovation): one line, with the details on hover. */
function worksRow(sim, id, o) {
  const fx = jobEffects(sim, id, o.job);
  const why = o.check.ok ? '' : tr(sim, `reason.${o.check.reason}`, o.check.params || {});
  const tipHtml = `<div class="tip-title">${escapeHtml(jobLabel(sim, id, o.job))}</div>${o.job.type === 'module' ? `<div class="tip-sub">${escapeHtml(t(`module.${o.job.m}.desc`))}</div>` : ''}${reqList(jobReqs(sim, id, o))}<div class="tip-row"><span>⏱</span><b>${escapeHtml(t('ui.hours_n', { n: o.cost.labor }))}</b></div>`;
  return `<div class="works-row" ${tipAttr(tipHtml)}>
    <div><b>${escapeHtml(jobLabel(sim, id, o.job))}</b>${fx ? `<div class="small">${escapeHtml(fx)}</div>` : ''}<div class="hint">${o.cost.money ? `${fmtMoney(o.cost.money)} · ` : ''}${escapeHtml(t('ui.hours_n', { n: o.cost.labor }))}</div>${why ? `<div class="warn small">✗ ${escapeHtml(why)}</div>` : ''}</div>
    ${button(t('structure.start'), 'start_works', { job: JSON.stringify(o.job) }, { cls: o.check.ok ? 'primary sm' : 'sm', disabled: !o.check.ok })}
  </div>`;
}

/** The whole "Building" section: what it is, how good, what's being done, what could be done. */
export function structureHtml(sim, id, opts = {}) {
  const { info, actions } = structureParts(sim, id, opts);
  return info + actions;
}

/** The same, in two parts: what the building is (info) and what could be done to it (actions). */
export function structureParts(sim, id, { compact = false } = {}) {
  const S = sim.structures;
  const r = S.rec(id);
  if (!r) return { info: emptyState('🏚️', t('structure.none')), actions: '' };
  const v = S.view(id);
  const mods = Object.entries(r.mods)
    .filter(([, n]) => n)
    .map(([m, n]) => `<span class="chip" ${tipAttr(`<div class="tip-title">${escapeHtml(t(`module.${m}.name`))}</div>${escapeHtml(t(`module.${m}.desc`))}`)}>${escapeHtml(t(`module.${m}.name`))}${n > 1 ? ` ×${n}` : ''}</span>`)
    .join('');
  let html = `<h3>${escapeHtml(levelName(sim, id))} <span class="muted small">${escapeHtml(t('structure.level_n', { n: r.lvl, max: v.maxLevel }))}</span></h3>
    ${compact ? '' : `<div class="preview-pair"><figure>${buildingPreview(sim, id)}</figure></div>`}
    <div class="bar-label"><span>${escapeHtml(t('structure.quality'))}</span><b>${v.quality}%</b></div>${bar(v.quality, v.quality < 40 ? 'st-damaged' : 'good')}
    <div class="bar-label"><span>${escapeHtml(t('ui.condition'))}</span><b>${v.condition}%</b></div>${condBar(v.condition)}
    ${statGrid([stat(t('structure.size'), escapeHtml(`${v.size.w}×${v.size.h}`)), stat(t('structure.floors'), String(v.floors)), ...(v.capacity ? [stat(t('ui.residents'), `${v.occupants} / ${v.capacity}`)] : []), ...(v.value ? [stat(t('ui.market_value'), fmtMoney(v.value))] : [])])}
    ${r.spec ? `<div class="kv"><span>${escapeHtml(t('structure.spec'))}</span><b>${escapeHtml(t(`spec.${r.spec}.name`))}</b></div>` : ''}
    ${mods ? `<div class="chips">${mods}</div>` : ''}
    <div class="hint">${escapeHtml(t('structure.quality_hint', { n: S.qualityCap(id) }))}</div>`;
  const works = S.works(id);
  if (works) html += worksProgress(sim, id, works);
  if (compact) return { info: html, actions: '' };
  const owner = S.owner(id);
  if (owner !== 'player') return { info: html, actions: notice('info', escapeHtml(t('structure.owner_decides'))) };
  if (works) return { info: html, actions: '' };
  const opts = S.options(id, 'player').filter((o) => o.cost);
  if (!opts.length) return { info: html, actions: emptyState('✨', t('structure.nothing_more')) };
  const level = opts.find((o) => o.job.type === 'level');
  const info = html;
  html = `<h3>${escapeHtml(t('structure.could_do'))}</h3>`;
  if (level) html += upgradeCard(sim, id, level);
  const rest = opts.filter((o) => o !== level).sort((a, b) => (b.check.ok ? 1 : 0) - (a.check.ok ? 1 : 0));
  if (rest.length) html += `<div class="stat-label" style="margin-top:10px">${escapeHtml(t('works_req.smaller'))}</div>${rest.map((o) => worksRow(sim, id, o)).join('')}`;
  html += `<div class="hint" style="margin-top:8px">${escapeHtml(t('structure.works_hint'))}</div>`;
  return { info, actions: html };
}


/** A "Building" tab action. Returns true if handled. */
export function structureAction(ui, id, action, data) {
  const sim = ui.sim;
  if (action === 'open_site') {
    ui.openSite(data.site);
    return true;
  }
  if (action === 'start_works') {
    const r = sim.structures.start(id, JSON.parse(data.job), 'player');
    if (!r.ok) sim.toast(`reason.${r.reason}`, r.params || {}, 'warn');
    return true;
  }
  return false;
}
