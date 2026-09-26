/**
 * Player interface settings (kept in the browser, not in save games): UI scale, sound volumes.
 */
const KEY = 'fromnothing.settings';
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2];

export const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1];
const changed = new Set();

let settings = { uiScale: 1, volMaster: 0.75, volMusic: 0.5, volSfx: 0.75, volAmbience: 0.75, mute: false };
try {
  settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {
  /* private window, blocked storage: defaults */
}

export function getSetting(k) {
  return settings[k];
}

export function setSetting(k, v) {
  settings[k] = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applySettings();
  for (const fn of changed) fn(k, v);
}

/** Be told when a setting changes (the sound engine follows the volume settings). */
export function onSettingChange(fn) {
  changed.add(fn);
  return () => changed.delete(fn);
}

/** Put the settings into effect (the whole UI layer scales with --ui-scale). */
export function applySettings() {
  const s = UI_SCALES.includes(settings.uiScale) ? settings.uiScale : 1;
  document.documentElement.style.setProperty('--ui-scale', String(s));
}

export function uiScale() {
  return Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
}
