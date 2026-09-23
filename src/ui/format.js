/**
 * Formatting helpers shared by the UI.
 *
 * Game events store ids (npc: 'egor', item: 'bread', job: 'courier'), never
 * finished sentences — so when the language changes, old toasts and the whole
 * chronicle re-render correctly. resolveParams() turns ids into display names.
 */
import { t, fmtMoney, itemName, npcName, occupationName } from '../i18n/i18n.js';
import { BALANCE } from '../config/balance.js';

export function buildingLabel(sim, id) {
  if (id && id.startsWith('house_')) {
    const residents = sim.state.npcs.filter((n) => n.homeId === id && n.age >= 16);
    if (residents.length) return t('building.house_of', { name: npcName(residents[0]) });
    return t('building.house');
  }
  return t(`building.${id}`);
}

export function resolveParams(sim, params = {}) {
  const out = { ...params };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('npc')) out[k] = npcName(sim.npcs.byId(v));
    else if (k === 'item') out[k] = itemName(v);
    else if (k === 'job') out[k] = t(`job.${v}.name`);
    else if (k === 'building') out[k] = buildingLabel(sim, v);
    else if (k === 'occ') out[k] = occupationName(v, params.gender);
    else if (k === 'skill') out[k] = t(`skill.${v}.name`);
    else if (k === 'attr') out[k] = t(`attr.${v}.name`);
    else if (k === 'money') out[k] = fmtMoney(v);
    else if (k === 'hour' || k === 'hour2') out[k] = `${String(v).padStart(2, '0')}:00`;
  }
  return out;
}

/** Translate with id-params resolved to names. */
export function tr(sim, key, params = {}) {
  return t(key, resolveParams(sim, params));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** "Day 3 of Spring, Year 1" for any absolute day index. */
export function dateString(day) {
  const { daysPerSeason: dps, seasons } = BALANCE.time;
  const season = seasons[Math.floor(day / dps) % seasons.length];
  const year = Math.floor(day / (dps * seasons.length)) + 1;
  return t('ui.date_short', { day: (day % dps) + 1, season: t(`season.${season}`), year });
}
