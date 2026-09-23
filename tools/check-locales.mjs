// Checks that every literal localization key used in src/ exists in every locale,
// and that all locales have the same key structure.
// Usage: node tools/check-locales.mjs
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const locales = Object.fromEntries(['en', 'ru'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, 'src/locales', `${l}.json`), 'utf8'))]));

const get = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const genderForm = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((x) => ['m', 'f'].includes(x));
    if (v && typeof v === 'object' && !Array.isArray(v) && !genderForm) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

let problems = 0;
// 1. Same structure (gendered objects and plain strings count as leaves).
const keysEn = flatten(locales.en);
const keysRu = flatten(locales.ru);
for (const k of keysEn) if (!keysRu.has(k)) (problems++, console.log(`ru missing: ${k}`));
for (const k of keysRu) if (!keysEn.has(k)) (problems++, console.log(`en missing: ${k}`));

// 2. Literal keys used in code.
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(path.join(root, 'src'));

const patterns = [
  /\bt\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\btList\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\btPick\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\btr\(\s*[\w.]+\s*,\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\bsay\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\btoast\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\bchronicle\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
  /\badd\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g,
];
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const re of patterns) for (const m of src.matchAll(re)) used.add(m[1]);
}
for (const key of used) {
  for (const [l, d] of Object.entries(locales)) {
    if (get(d, key) === undefined) (problems++, console.log(`${l}: missing key used in code: ${key}`));
  }
}
console.log(`${used.size} literal keys checked, ${keysEn.size} locale entries. Problems: ${problems}`);
process.exit(problems ? 1 : 0);
