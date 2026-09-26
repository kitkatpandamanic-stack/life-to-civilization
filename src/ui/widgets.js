/**
 * The UI's building blocks. Every panel is made of these, so the whole game looks and
 * behaves the same way: buttons, cards, status badges, progress bars with readable states,
 * headline numbers, requirement lists (✓ / ✗), empty and error states, tooltips, filters.
 * (Their look lives in styles.css, sections 3–4.)
 */
import { ICON_URLS } from '../render/TextureFactory.js';
import { drawPortrait } from '../render/CharacterArt.js';
import { escapeHtml } from './format.js';
import { t } from '../i18n/i18n.js';

export function icon(itemId, size = 32) {
  const url = ICON_URLS[itemId];
  return url ? `<img class="item-icon" src="${url}" width="${size}" height="${size}" alt="">` : '';
}

export function bar(pct, cls = '', label = '') {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="mini-bar ${cls}"><div class="fill" style="width:${w}%"></div>${label ? `<span>${escapeHtml(label)}</span>` : ''}</div>`;
}

/** Healthy · worn · damaged · critical — for condition and durability (shown in words and stripes, not only colour). */
export function condState(pct) {
  return pct >= 70 ? 'healthy' : pct >= 40 ? 'worn' : pct >= 15 ? 'damaged' : 'critical';
}

/** A condition / durability bar: "72% · Worn". */
export function condBar(pct, { label = null, words = true } = {}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const st = condState(p);
  const text = label ?? (words ? `${p}% · ${t(`cond.${st}`)}` : `${p}%`);
  return bar(p, st === 'healthy' ? 'good' : `st-${st}`, text);
}

const portraitCache = new Map();

/** Portrait image for an NPC (cached per look). */
export function portrait(key, look, size = 72) {
  const cacheKey = `${key}_${size}`;
  if (!portraitCache.has(cacheKey)) portraitCache.set(cacheKey, drawPortrait(look, size));
  return `<img class="portrait" src="${portraitCache.get(cacheKey)}" width="${size}" height="${size}" alt="">`;
}

/**
 * A button. cls: '' (normal) · 'primary' · 'success' · 'danger' · 'ghost' · 'sm' · 'big' · 'selected' · 'locked'.
 * A disabled button can say why (title), and a locked one shows a padlock.
 */
export function button(label, action, data = {}, { disabled = false, cls = '', title = '', hotkey = null, tip = null, ico = '', key = null } = {}) {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  // A keyboard shortcut (key) goes in its tooltip, so it's learnt by hovering.
  const tipHtml = tip ?? (key ? `<div class='tip-title'>${escapeHtml(label)}</div><div class='tip-sub'>${escapeHtml(t('ui.key_n', { key }))}</div>` : null);
  return `<button class="btn ${cls}${disabled ? ' disabled' : ''}" data-action="${action}" ${attrs} ${disabled ? 'disabled' : ''} ${title ? `title="${escapeHtml(title)}"` : ''} ${tipHtml ? tipAttr(tipHtml) : ''} ${hotkey ? `data-hotkey="${hotkey}"` : ''}>${hotkey ? `<kbd>${hotkey}</kbd>` : ''}${ico ? `<span class="b-ico">${ico}</span>` : ''}${escapeHtml(label)}</button>`;
}

/** A square button with just an icon (its name in the tooltip). */
export function iconButton(ico, label, action, data = {}, opts = {}) {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  const tip = `<div class='tip-title'>${escapeHtml(label)}</div>${opts.key ? `<div class='tip-sub'>${escapeHtml(t('ui.key_n', { key: opts.key }))}</div>` : ''}`;
  return `<button class="btn icon ${opts.cls || ''}${opts.disabled ? ' disabled' : ''}" data-action="${action}" ${attrs} ${opts.disabled ? 'disabled' : ''} aria-label="${escapeHtml(label)}" ${tipAttr(tip)}>${ico}</button>`;
}

/**
 * A progress bar with its words: progress(62, { label: 'Building', kind: 'warn' }).
 * kind: '' (green) · warn (striped amber: waiting) · danger (striped red: stuck) · gold (XP) · info.
 */
export function progress(pct, { label = '', value = null, kind = '' } = {}) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="progress ${kind}"><div class="progress-head"><span>${escapeHtml(label)}</span><b>${escapeHtml(value ?? `${Math.round(w)}%`)}</b></div><div class="progress-track"><div class="progress-fill" style="width:${w}%"></div></div></div>`;
}

/** A resource line: icon, name, "have / need" (red when short, green when enough) or just a count. */
export function resRow(item, label, have, need = null) {
  const cls = need === null ? '' : have >= need ? ' full' : ' short';
  return `<div class="res-row${cls}"><span>${icon(item, 20)}</span><span>${escapeHtml(label)}</span><span class="res-n">${need === null ? have : `${have} / ${need}`}</span></div>`;
}

/** A search box (its text is sent with data-action on input — see UIManager). */
export function searchBox(value, placeholder, action = 'search') {
  return `<label class="search"><input class="input" type="search" data-input="${action}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}"></label>`;
}

/** A dropdown: options [[value, label], …]. */
export function select(options, value, action) {
  return `<select class="select" data-input="${action}">${options.map(([v, l]) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
}

export function tabs(list, active) {
  return `<div class="tabs">${list.map(([id, label]) => `<button class="tab${id === active ? ' active' : ''}" data-action="tab" data-tab="${id}">${escapeHtml(label)}</button>`).join('')}</div>`;
}

/** Filter pills (categories): [[id, label], …]. */
export function filters(list, active, action = 'filter') {
  return `<div class="filters">${list.map(([id, label]) => `<button class="filter${id === active ? ' active' : ''}" data-action="${action}" data-f="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div>`;
}

export function hearts(rel) {
  const full = Math.round(rel / 20);
  return `<span class="hearts">${'♥'.repeat(full)}<span class="empty">${'♥'.repeat(5 - full)}</span></span>`;
}

/** A status badge — always an icon and a word as well as a colour. kind: good · warn · danger · info · neutral. */
export function status(text, kind = 'neutral', ico = '') {
  return `<span class="status s-${kind}">${ico ? `${ico} ` : ''}${escapeHtml(text)}</span>`;
}

/** A headline number: LABEL / 12,450. */
export function stat(label, value, cls = '') {
  return `<div class="stat"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value ${cls}">${value}</div></div>`;
}
export function statGrid(items) {
  return `<div class="stat-grid">${items.join('')}</div>`;
}

/** A card: icon, title, subtitle, something on the right, and a body. */
export function card({ ico = '', title = '', sub = '', end = '', body = '', cls = '', action = null, data = {} } = {}) {
  const attrs = action ? ` data-action="${action}" ${Object.entries(data).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ')}` : '';
  return `<div class="card${action ? ' interactive clickable' : ''} ${cls}"${attrs}>
    ${title || ico ? `<div class="card-head">${ico ? `<div class="card-icon">${ico}</div>` : ''}<div><div class="card-title">${title}</div>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div>${end ? `<div class="card-end">${end}</div>` : ''}</div>` : ''}
    ${body}
  </div>`;
}

/**
 * Requirements, each with ✓ or ✗ — and how many you have against how many it takes.
 * rows: [{ item?, ico?, label, have?, need?, ok }]
 */
export function reqList(rows) {
  return `<div class="reqs">${rows
    .map((r) => {
      const pic = r.item ? icon(r.item, 18) : r.ico || '';
      const count = r.need !== undefined ? `<span class="req-have">${r.have ?? 0} / ${r.need}</span>` : '';
      return `<div class="req-row ${r.ok ? 'ok' : 'no'}"><span class="mark">${r.ok ? '✓' : '✗'}</span><span>${pic}</span><span>${escapeHtml(r.label)}</span>${count}</div>`;
    })
    .join('')}</div>`;
}

/** Nothing here yet: an icon, what this place is for, and how to get started. */
export function emptyState(ico, title, text = '', extra = '') {
  return `<div class="empty-state"><div class="es-icon">${ico}</div><div class="es-title">${escapeHtml(title)}</div>${text ? `<div class="es-text">${escapeHtml(text)}</div>` : ''}${extra}</div>`;
}

/** Something to fix, said plainly: kind warn · danger · info. */
export function notice(kind, html, ico = null) {
  const i = ico ?? { warn: '⚠️', danger: '⛔', info: 'ℹ️' }[kind] ?? '';
  return `<div class="notice n-${kind}"><span>${i}</span><div>${html}</div></div>`;
}

/** A tooltip for any element: returns the attribute to put on it (the HTML is shown by UIManager). */
export function tipAttr(html) {
  return `data-tip="${escapeHtml(html)}"`;
}
