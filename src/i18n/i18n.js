/**
 * Localization. Every visible string comes from src/locales/<lang>.json.
 *
 *   t('stat.money')                       → "Money" / "Деньги"
 *   t('toast.gained', { qty: 3, item })   → interpolates {qty} and {item}
 *   t('chronicle.npc_hired', { gender })  → picks the gendered form when the
 *                                            locale value is { "m": "...", "f": "..." }
 *   tList('dialog.greet.friend')          → array of variants
 *
 * The language can be switched at any time; listeners re-render their text.
 */
import en from '../locales/en.json';
import ru from '../locales/ru.json';

const DICTS = { en, ru };
export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];

const STORAGE_KEY = 'fromnothing.lang';
const listeners = new Set();
let current = detectLanguage();

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function resolve(key) {
  let v = lookup(DICTS[current], key);
  if (v === undefined) v = lookup(DICTS.en, key);
  return v;
}

function interpolate(str, params) {
  return str.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined ? String(params[p]) : m));
}

/** Plural category for n in the current language. */
function pluralForm(n) {
  if (current !== 'ru') return n === 1 ? 'one' : 'other';
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'one';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'few';
  return 'many';
}

function pickForm(v, params) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Plural forms { one, few, many } / { one, other } when a count is given.
    if (v.one !== undefined && typeof params.n === 'number') return v[pluralForm(params.n)] ?? v.other ?? v.many ?? v.one;
    return v[params.gender] ?? v.m ?? v.other ?? Object.values(v)[0];
  }
  return v;
}

/** Translate a key. Returns the key itself if missing (easy to spot). */
export function t(key, params = {}) {
  let v = pickForm(resolve(key), params);
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string') return key;
  return interpolate(v, params);
}

/** Does this key exist? */
export function has(key) {
  return resolve(key) !== undefined;
}

/** Returns the array stored at key (or [] if missing), each entry interpolated. */
export function tList(key, params = {}) {
  const v = resolve(key);
  if (!Array.isArray(v)) return [];
  return v.map((s) => interpolate(String(pickForm(s, params)), params));
}

/** Random entry from an array key. */
export function tPick(key, params = {}) {
  const list = tList(key, params);
  if (!list.length) return t(key, params);
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Plural helper. Locale entry must be { one, few, many } (ru) or { one, other } (en).
 */
export function tn(key, n, params = {}) {
  const v = resolve(key);
  if (!v || typeof v !== 'object') return t(key, { n, ...params });
  let form;
  if (current === 'ru') {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) form = 'one';
    else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) form = 'few';
    else form = 'many';
  } else {
    form = n === 1 ? 'one' : 'other';
  }
  const s = v[form] ?? v.other ?? v.many ?? v.one;
  return interpolate(String(s), { n, ...params });
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!DICTS[code] || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  for (const fn of [...listeners]) fn(code);
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Common formatting helpers ----------

export function fmtMoney(v) {
  return t('fmt.money', { v: Math.round(v) });
}

export function itemName(id) {
  return t(`item.${id}.name`);
}

export function npcName(npc) {
  if (!npc) return '?';
  if (npc.customName) return npc.customName;
  if (typeof npc.name === 'string' && npc.name) return npc.name; // the player (first generation)
  const list = resolve(npc.gender === 'f' ? 'names.female' : 'names.male');
  return Array.isArray(list) ? list[npc.nameIdx % list.length] : '?';
}

/** Family name (gendered in Russian: Кузнецов / Кузнецова). */
export function surname(npc) {
  if (!npc) return '';
  const list = resolve('names.surnames');
  if (!Array.isArray(list) || !list.length) return '';
  return pickForm(list[(npc.surnameIdx || 0) % list.length], { gender: npc.gender }) || '';
}

export function npcFullName(npc) {
  const s = surname(npc);
  return s ? `${npcName(npc)} ${s}` : npcName(npc);
}

export function occupationName(occupation, gender = 'm') {
  return t(`occupation.${occupation}`, { gender });
}

/** Capitalize the first letter (for labels; mid-sentence text keeps locale casing). */
export function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function buildingName(id) {
  return t(`building.${id}`);
}
