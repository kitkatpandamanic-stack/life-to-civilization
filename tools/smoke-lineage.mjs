// Headless test for generations: courting and marrying a villager, children,
// retirement / death and playing on as the heir, a new line when there's no heir,
// the village history book, and save / load of all of it.
// Usage: node tools/smoke-lineage.mjs
import { Simulation } from '../src/core/Simulation.js';
import fs from 'fs';

const locales = ['en', 'ru'].map((l) => JSON.parse(fs.readFileSync(new URL(`../src/locales/${l}.json`, import.meta.url), 'utf8')));
const hasKey = (k) => locales.every((d) => k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), d) !== undefined);

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(400);
};
const YEAR = 4 * 7; // days (see BALANCE.time)

/** Make a single adult villager fond of the player. */
function sweetheart(sim) {
  const p = sim.state.player;
  const n = sim.state.npcs.find((x) => x.age >= 18 && Math.abs(x.age - p.age) <= 15 && !x.kin.spouse && !x.partner && (x.attraction === 'any' || x.attraction === p.gender) && x.gender !== p.gender);
  if (!n) return null;
  n.met = true;
  n.rel = 90;
  sim.social.playerBond(n).t = 40;
  return n;
}

// 1. Courtship → marriage → children.
{
  const sim = Simulation.newGame('Ivan', 201, { gender: 'm' });
  const run = runOn(sim);
  const p = sim.state.player;
  check('the player has a gender and a family name', p.gender === 'm' && p.surnameIdx >= 0);
  const n = sweetheart(sim);
  check('there is someone to court', !!n, n?.id);
  let yes = false;
  for (let i = 0; i < 20 && !yes; i++) yes = sim.lineage.court(n);
  check('they agree to walk out with you', yes && p.partner === n.id);
  check('too soon to propose right away', !sim.lineage.canPropose(n).ok);
  run(8 * 1440);
  n.rel = 95;
  check('after a week, you can propose', sim.lineage.canPropose(n).ok, JSON.stringify(sim.lineage.canPropose(n)));
  check('they say yes', sim.lineage.propose(n));
  check('you are married', p.spouse === n.id && n.kin.spouse === 'player');
  check('your spouse moves in with you', n.homeId === p.homeId, `${n.homeId} vs ${p.homeId}`);
  check('the wedding is history', sim.state.history.entries.some((e) => e.key === 'chronicle.player_married'));
  const before = sim.property.rec(p.homeId);
  check('your household pays no separate rent', sim.property.landlord(n) === null, before?.owner);
  // Room for a family.
  p.homeTier = 'house';
  for (let i = 0; i < 12 && p.children.length === 0; i++) sim.lineage.onSeason();
  if (!p.children.length) sim.lineage.birth();
  const kid = sim.npcs.byId(p.children[0]);
  check('a child is born', !!kid && kid.kin.parents.includes('player') && kid.kin.parents.includes(n.id));
  check('the child has the family name', kid.surnameIdx === p.surnameIdx);
  check('the child lives at home', kid.homeId === p.homeId);
  check('the spouse counts the child as family', n.family.includes(kid.id));
  check("the family tree knows you're the child's parent", sim.family.kinship(kid, sim.lineage.person()) === 'parent');
  check('the baby is in the chronicle', sim.state.chronicle.some((e) => e.key === 'chronicle.player_child' && e.params.npc === kid.id));

  // 2. Years pass… the player retires; the eldest takes over.
  kid.age = 20;
  kid.occupation = 'unemployed';
  p.age = 58;
  p.money = 1000;
  const skillBefore = p.skills.woodcutting?.level ?? 0;
  p.skills.woodcutting = { level: 10, xp: 0 };
  const buddy = sim.state.npcs.find((x) => x !== n && x !== kid && x.age >= 30);
  sim.memory.remember(buddy, 'player_helped', { who: 'player' });
  const r = sim.lineage.canRetire();
  check('an old player with a grown child can retire', r.ok && r.heir === kid);
  const kidId = kid.id;
  const kidNameIdx = kid.nameIdx;
  const info = sim.lineage.succeed('retired');
  check('you now play as your child', p.generation === 2 && p.age === 20 && p.nameIdx === kidNameIdx && !p.name && !sim.npcs.byId(kidId), `${p.nameIdx}, ${p.age}`);
  check('the old player lives on as a retired elder', sim.npcs.byId('anc1')?.occupation === 'elder' && sim.npcs.byId('anc1').customName === 'Ivan');
  check('the family keeps its money', p.money >= 800, p.money);
  check('some skill was passed on', p.skills.woodcutting.level === 4, `${skillBefore}→${p.skills.woodcutting.level}`);
  check('your parent is your parent now', p.parents.includes('anc1') && p.parents.includes(n.id));
  check('the elder counts you as their child', sim.family.kinship(sim.npcs.byId('anc1'), sim.lineage.person()) === 'child');
  check("your other parent is no longer 'married to the player'", n.kin.spouse === 'anc1');
  check("what people remember about your parent isn't about you", buddy.memories.some((m) => m.w === 'anc1' && m.k === 'player_helped'));
  const legacy = sim.dialogue.topics(buddy, 'chat').filter((x) => x.key.startsWith('talk.legacy'));
  check('villagers talk about what your parent did', legacy.length >= 1, legacy.map((x) => x.key).join(','));
  check('legacy lines exist in both languages', legacy.every((x) => hasKey(x.key)) && hasKey('kin_your.parent'));
  check('the lineage record', sim.state.lineage.length === 1 && sim.state.lineage[0].how === 'retired');
  check('the new generation is history', sim.state.history.entries.some((e) => e.key === 'chronicle.heir_continues'));
  const dangling = sim.state.chronicle.filter((e) => Object.entries(e.params || {}).some(([k, v]) => k.startsWith('npc') && typeof v === 'string' && !sim.family.person(v) && !sim.state.emigrants?.some((x) => x.id === v)));
  check('every name in the chronicle still resolves', dangling.length === 0, dangling.map((e) => e.key).join(','));
  check('succession info for the UI', info.heir.nameIdx === p.nameIdx && info.generation === 2);

  // 3. Save and load.
  const saved = JSON.parse(JSON.stringify(sim.state));
  const sim2 = new Simulation(saved);
  check('generations survive save / load', sim2.state.player.generation === 2 && sim2.npcs.byId('anc1') && sim2.state.lineage.length === 1 && sim2.state.history.entries.length > 0);
  runOn(sim2)(3 * 1440);
  check('the world runs on after succession', sim2.time.day >= 3);

  // 4. The heir dies with no children: a newcomer starts a new line.
  const p2 = sim2.state.player;
  p2.children = [];
  const res = sim2.lineage.succeed('died');
  check('no heir → a newcomer arrives', res.newcomer && p2.generation === 3 && p2.lineFrom === 3);
  check('the dead heir is in the graveyard', sim2.state.graveyard.some((g) => g.id === 'anc2' && g.wasPlayer));
  check('the newcomer starts poor', p2.money <= 30);
  const who = sim2.state.npcs.find((x) => x.memories?.some((m) => m.w?.startsWith?.('anc')));
  const leg = who ? sim2.dialogue.topics(who, 'chat').filter((x) => x.key.startsWith('talk.legacy')) : [];
  check("strangers' family history isn't 'your father'", leg.length === 0);
}

// 5. Old age: death comes eventually, and the child carries on.
{
  const sim = Simulation.newGame('Olga', 202, { gender: 'f' });
  const p = sim.state.player;
  check('a woman player', p.gender === 'f' && p.look.hairStyle === 'long');
  const n = sweetheart(sim);
  n && (p.partner = n.id, n.partner = 'player', n.courtingSince = -30);
  n && sim.lineage.propose(n);
  p.homeTier = 'house';
  const kid = sim.lineage.birth();
  kid.age = 30;
  p.age = 95;
  let died = false;
  sim.bus.on('player:succeeded', () => (died = true));
  for (let i = 0; i < 30 && !died; i++) sim.lineage.yearPassed();
  check('very old players die', died);
  check('…and the child carries on', p.generation === 2 && p.age === 30);
  check('the old player rests in the graveyard', sim.state.graveyard.some((g) => g.id === 'anc1' && g.customName === 'Olga'));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
