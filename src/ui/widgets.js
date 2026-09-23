/**
 * Small HTML building blocks shared by panels.
 */
import { ICON_URLS } from '../render/TextureFactory.js';
import { drawPortrait } from '../render/CharacterArt.js';
import { escapeHtml } from './format.js';

export function icon(itemId, size = 32) {
  const url = ICON_URLS[itemId];
  return url ? `<img class="item-icon" src="${url}" width="${size}" height="${size}" alt="">` : '';
}

export function bar(pct, cls = '', label = '') {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="mini-bar ${cls}"><div class="fill" style="width:${w}%"></div>${label ? `<span>${escapeHtml(label)}</span>` : ''}</div>`;
}

const portraitCache = new Map();

/** Portrait image for an NPC (cached per look). */
export function portrait(key, look, size = 72) {
  const cacheKey = `${key}_${size}`;
  if (!portraitCache.has(cacheKey)) portraitCache.set(cacheKey, drawPortrait(look, size));
  return `<img class="portrait" src="${portraitCache.get(cacheKey)}" width="${size}" height="${size}" alt="">`;
}

export function button(label, action, data = {}, { disabled = false, cls = '', title = '', hotkey = null } = {}) {
  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<button class="btn ${cls}${disabled ? ' disabled' : ''}" data-action="${action}" ${attrs} ${disabled ? 'disabled' : ''} ${title ? `title="${escapeHtml(title)}"` : ''} ${hotkey ? `data-hotkey="${hotkey}"` : ''}>${hotkey ? `<kbd>${hotkey}</kbd>` : ''}${escapeHtml(label)}</button>`;
}

export function tabs(list, active) {
  return `<div class="tabs">${list.map(([id, label]) => `<button class="tab${id === active ? ' active' : ''}" data-action="tab" data-tab="${id}">${escapeHtml(label)}</button>`).join('')}</div>`;
}

export function hearts(rel) {
  const full = Math.round(rel / 20);
  return `<span class="hearts">${'♥'.repeat(full)}<span class="empty">${'♥'.repeat(5 - full)}</span></span>`;
}
