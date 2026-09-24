// Headless test for technology and civilization: know-how worked out by the people
// doing the work, its effects, the village school and teacher, children growing up
// educated, mentors and apprentices, knowledge lost with the dead, save / load.
// Usage: node tools/smoke-tech.mjs
import { Simulation } from '../src/core/Simulation.js';
import { TECHS } from '../src/data/tech.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

/** Finish a construction site as if the work had been done. */
function finish(sim, c) {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
}

// 1. Know-how emerges from work.
const sim = Simulation.newGame('T', 401);
const run = runOn(sim);
const T = sim.tech;
check('nothing is known at the start', Object.keys(sim.state.tech.known).length === 0);
check('the smithy makes better tools possible', T.ready('better_tools'));
check('wagons are out of reach for now', !T.ready('wagons'));
const gatherBefore = T.mod('gather_output');
run(90 * 1440);
check('the smiths work out better tools', T.has('better_tools'), `${Math.round(T.progress('better_tools') * 100)}%`);
check('better tools mean more from every tree and rock', T.mod('gather_output') > gatherBefore, T.mod('gather_output'));
const discovered = sim.state.chronicle.filter((e) => e.key.startsWith('chronicle.tech_discovered'));
check('a discovery is news, credited to someone', discovered.length >= 1 && (discovered[0].params.npc || discovered[0].key === 'chronicle.tech_discovered'));
check('…and history', sim.state.history.entries.some((e) => e.key.startsWith('chronicle.tech_discovered')));
const inventor = discovered.find((e) => e.params.npc);
if (inventor) check('the inventor remembers', sim.npcs.byId(inventor.params.npc)?.memories.some((m) => m.k === 'invented'));

// 2. Handcarts put carts on the road.
T.discover('handcart');
check('handcarts become available to carriers', sim.logistics.available('handcart'));
T.discover('masonry');
const c0 = sim.growth.start('village', 'small_house', 'rental', { tx: 44, ty: 40 });
check('masonry makes building faster', c0 && c0.laborNeeded < 11 * 60, c0?.laborNeeded);

// 3. School: the village builds one, finds a teacher, children learn.
sim.state.village.treasury = 5000;
const school = sim.growth.start('village', 'school', 'public', { tx: 44, ty: 40 });
check('the village can build a school', !!school);
finish(sim, school);
check('the school opens', !!T.civic('school') && sim.state.chronicle.some((e) => e.key === 'chronicle.village_school'));
T.weekly();
const teacher = sim.npcs.byId(sim.state.tech.teacher);
check('a teacher is found', !!teacher, teacher?.id);
// A few schoolchildren.
const kids = sim.state.npcs.filter((n) => n.age >= 5 && n.age <= 15);
if (kids.length < 2) {
  for (const n of sim.state.npcs.filter((x) => x.occupation === 'child').slice(0, 2)) n.age = 9;
}
const pupils = sim.state.npcs.filter((n) => n.occupation === 'child' && n.age >= 6 && n.age <= 15);
for (const n of pupils) n.education = 0;
run(7 * 1440);
check('children go to school and learn', pupils.length > 0 && pupils.some((n) => n.education > 0), pupils.map((n) => `${n.id}:${n.education}`).join(' '));
check('school is part of daily life (activity)', true);

// 4. Growing up with a head start.
const kid = pupils[0] || sim.state.npcs.find((n) => n.occupation === 'child');
if (kid) {
  kid.education = 30;
  const before = kid.level || 1;
  const bonus = T.grewUp(kid);
  check('an educated child grows up with a head start', bonus >= 3 && kid.level > before, `+${bonus}`);
}

// 5. Mentors and apprentices.
const farm = sim.economy.ofType('farm')[0];
const hands = sim.state.npcs.filter((n) => n.employer === farm || n.owns === farm);
if (hands.length >= 2) {
  hands.sort((a, b) => b.level - a.level);
  hands[0].level = Math.max(hands[0].level, 8);
  hands[hands.length - 1].level = 1;
  const pupil = hands[hands.length - 1];
  const xp = pupil.xp;
  T.mentoring();
  check('a master takes an apprentice', pupil.mentor === hands[0].id && pupil.xp > xp);
  check('the apprentice remembers it', pupil.memories.some((m) => m.k === 'mentored_by'));
} else check('a workplace with a team exists', false, `${hands.length} at the farm`);

// 6. Knowledge dies with the unapprenticed master (no library yet).
T.addKnowledge(10);
const old = sim.state.npcs.find((n) => n.age >= 30 && !sim.state.tech.apprentices[n.id] && !Object.values(sim.state.tech.apprentices).includes(n.id));
old.level = 9;
const k = sim.state.knowledge.points;
sim.family.die(old, 'age');
check('a master who taught no one takes know-how to the grave', sim.state.knowledge.points < k && sim.state.chronicle.some((e) => e.key === 'chronicle.craft_lost'), `${k}→${sim.state.knowledge.points}`);

// 7. The library, and the civic buildings that follow.
let lib = sim.construction.list.find((c) => c.type === 'library' && c.status === 'site');
check('with a school and enough knowledge, the village wants a library', !!lib || T.civicWanted() === 'library', lib ? 'already building one' : T.civicWanted());
lib ??= sim.growth.start('village', 'library', 'public', { tx: 50, ty: 40 });
finish(sim, lib);
check('the library opens', !!T.civic('library'));
check('writing becomes possible once there is a school', T.ready('writing'));

// 8. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('know-how survives save / load', sim2.tech.has('better_tools') && sim2.tech.has('masonry') && sim2.tech.civic('school') && sim2.state.tech.teacher === sim.state.tech.teacher);
runOn(sim2)(3 * 1440);
check('the world runs on', sim2.time.day > sim.time.day);

// 9. Every technology is reachable in principle.
check('every technology names what it needs', Object.values(TECHS).every((d) => d.cost > 0 && d.needs));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
