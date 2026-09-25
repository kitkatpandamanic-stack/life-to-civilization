// Headless test for the living-world NPC systems: habits, memories, relationships,
// word of mouth, dialogue topics (all keys exist in both languages), determinism, save/load.
// Usage: node tools/smoke-living.mjs
import fs from 'fs';
import { Simulation } from '../src/core/Simulation.js';
import { rand } from '../src/core/rng.js';

const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
const ru = JSON.parse(fs.readFileSync(new URL('../src/locales/ru.json', import.meta.url), 'utf8'));
const get = (o, k) => k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o);

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const run = (sim, minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(200);
};

const sim = Simulation.newGame('Tester', 777);
const npcs = sim.state.npcs;

// ---------------------------------------------------------------- habits
check('every villager has habits', npcs.every((n) => n.habits && n.habits.hobby));
const hobbies = new Set(npcs.map((n) => n.habits.hobby));
check('hobbies vary between villagers', hobbies.size >= 4, [...hobbies].join(', '));
check('kinship: Gregory is Anna\'s husband', sim.family.kinship(sim.npcs.byId('anna'), sim.npcs.byId('gregory')) === 'spouse');
check('kinship: Mitya is Gregory\'s son', sim.family.kinship(sim.npcs.byId('gregory'), sim.npcs.byId('mitya')) === 'child');
check('kinship: Nikita and Daria are siblings', sim.family.kinship(sim.npcs.byId('nikita'), sim.npcs.byId('daria')) === 'sibling');

// Track where people spend their free time.
const seen = {};
sim.bus.on('time:hour', () => {
  for (const n of npcs) {
    const t = n.task;
    if (t?.type === 'leisure' && t.stage === 'idle') {
      const k = t.hobby ? `hobby:${t.hobby}` : t.plan || 'leisure';
      seen[k] = (seen[k] || 0) + 1;
    }
  }
});
run(sim, 14 * 1440);
check('villagers pursue different free-time activities', Object.keys(seen).length >= 5, JSON.stringify(seen));
check('favourite places emerge', npcs.some((n) => sim.habits.favouritePlace(n)), npcs.map((n) => `${n.id}:${sim.habits.favouritePlace(n) || '-'}`).join(' '));
check('villagers made memories', npcs.filter((n) => n.memories.length > 0).length >= 3, npcs.map((n) => `${n.id}:${n.memories.length}`).join(' '));
const relCount = npcs.reduce((s, n) => s + Object.keys(n.relations).length, 0);
check('relationships are multi-dimensional', npcs.every((n) => Object.values(n.relations).every((v) => typeof v === 'object' && 'f' in v && 't' in v)), `${relCount} bonds`);
check('company need is simulated', npcs.every((n) => n.social >= 0 && n.social <= 100) && npcs.some((n) => n.social < 60 || n.social > 60));

// ---------------------------------------------------------------- memories of the player
const p = sim.state.player;
while (p.level < 10) sim.progression.addXp(sim.progression.xpForNext() - p.xp + 1);
p.money = 2000;
const nikita = sim.npcs.byId('nikita');
nikita.met = true;
// (He may have found an apprenticeship by now: this is about hiring him yourself.)
if (nikita.apprentice) sim.careers.end(nikita, 'left');
if (nikita.employer) {
  nikita.employer = null;
  nikita.occupation = 'unemployed';
}
const wasUnemployed = nikita.occupation === 'unemployed';
const offer = sim.workers.offer(nikita, sim.workers.expectedSalary(nikita) + 5);
check('hire Nikita', offer.accepted, offer.reason || '');
if (wasUnemployed) check('Nikita remembers you gave them a job', sim.memory.has(nikita, 'player_gave_job', 'player'));
else check('Nikita remembers being hired', sim.memory.has(nikita, 'player_hired', 'player'));
const trustBefore = sim.social.playerBond(nikita).t;
check('being given a job builds trust', trustBefore >= (wasUnemployed ? 20 : 8), String(trustBefore));
run(sim, 4 * 1440);
sim.workers.fire('nikita');
check('firing is remembered', sim.memory.has(nikita, 'player_fired', 'player') || sim.memory.has(nikita, 'player_fired_unfair', 'player'));
check('firing costs trust', sim.social.playerBond(nikita).t < trustBefore, `${trustBefore} → ${sim.social.playerBond(nikita).t}`);
// Word of mouth: after a couple of weeks, others have heard about you.
run(sim, 14 * 1440);
const heard = npcs.filter((n) => n.memories.some((m) => m.k === 'heard_player_good' || m.k === 'heard_player_bad'));
check('word of mouth spreads what you did', heard.length >= 1, heard.map((n) => n.id).join(', '));

// ---------------------------------------------------------------- dialogue topics
let topicsSeen = 0;
const missing = new Set();
for (const n of npcs) {
  n.met = true;
  n.rel = 50;
  for (const mode of ['chat', 'news', 'life']) {
    for (const tpc of sim.dialogue.topics(n, mode)) {
      topicsSeen++;
      for (const [lang, d] of [['en', en], ['ru', ru]]) if (get(d, tpc.key) === undefined) missing.add(`${lang}:${tpc.key}`);
    }
    const pick = sim.dialogue.pick(n, mode);
    for (const [lang, d] of [['en', en], ['ru', ru]]) if (get(d, pick.key) === undefined) missing.add(`${lang}:${pick.key}`);
  }
  for (const m of n.memories) for (const [lang, d] of [['en', en], ['ru', ru]]) if (get(d, `memory.${m.k}`) === undefined) missing.add(`${lang}:memory.${m.k}`);
}
check('all dialogue topic keys exist in EN and RU', missing.size === 0, missing.size ? [...missing].slice(0, 12).join(', ') : `${topicsSeen} topics`);
// Every memory kind has an Inspect description in both languages.
const { MEMORY_KINDS } = await import('../src/data/memories.js');
const noDesc = Object.keys(MEMORY_KINDS).filter((k) => !get(en, `memory.${k}`) || !get(ru, `memory.${k}`));
check('every memory kind is described in both languages', noDesc.length === 0, noDesc.join(', '));

// ---------------------------------------------------------------- save / load round trip
const saved = JSON.parse(JSON.stringify({ ...sim.state, rngState: rand.getState() }));
const sim2 = new Simulation(saved);
run(sim2, 1440);
check('a saved game loads and keeps running', sim2.time.day === sim.time.day + 1 && sim2.state.npcs.every((n) => n.habits && Array.isArray(n.memories)));

// ---------------------------------------------------------------- determinism
function fingerprint(seed, days) {
  const s = Simulation.newGame('Det', seed);
  run(s, days * 1440);
  return JSON.stringify(s.state.npcs.map((n) => [n.id, Math.round(n.money), n.x | 0, n.y | 0, n.memories.length, n.occupation]));
}
const a = fingerprint(4242, 3);
const b = fingerprint(4242, 3);
check('same seed, same inputs → same world (deterministic)', a === b);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
