/**
 * Player interface settings (kept in the browser, not in save games): UI scale.
 */
const KEY = 'fromnothing.settings';
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2];

let settings = { uiScale: 1 };
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
}

/** Put the settings into effect (the whole UI layer scales with --ui-scale). */
export function applySettings() {
  const s = UI_SCALES.includes(settings.uiScale) ? settings.uiScale : 1;
  document.documentElement.style.setProperty('--ui-scale', String(s));
}

export function uiScale() {
  return Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
}
