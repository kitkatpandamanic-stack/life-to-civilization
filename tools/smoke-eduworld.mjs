// Headless test for what education does to the valley as a whole: figures counted from
// real people, what the valley becomes known for (and who it draws), the labour pool
// behind new businesses, how learning draws newcomers, what a town and a city need,
// milestones, landmarks, events (a school shut for want of a teacher, a scholarship,
// a scholar arriving, a town founding a university), the developer tools — and a
// long run of the whole valley, to see the chain happen by itself.
// Usage: node tools/smoke-eduworld.mjs [years]
import { Simulation } from '../src/core/Simulation.js';
import { BALANCE } from '../src/config/balance.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
function build(sim, type, at) {
  const c = sim.growth.start('village', type, 'public', at);
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c;
}

const sim = Simulation.newGame('T', 9191);
const W = sim.eduworld;
const Ed = sim.education;
const npcs = sim.state.npcs;
const look = npcs[0].look;

// 1. Figures, counted from people.
const st = W.stats();
check('the valley has education figures', st.pop > 10 && st.literacy > 0 && st.literacy < 1 && typeof st.innovation === 'number', JSON.stringify({ literacy: st.literacy, skilled: st.skilledPeople, innovation: st.innovation }));
const reader = npcs.find((n) => n.age >= 16 && !Ed.literate(n));
Object.assign(reader.edu.know, { reading: 60, writing: 50 });
check('…and they follow the people (one more reader, more literacy)', W.stats().literacy > st.literacy);
const other = W.settlementStats('market_town');
const small = W.settlementStats('pass_hold');
check('a big town with a university reads better than a hamlet', other.literacy > small.literacy && other.university && !small.university, `${other.literacy.toFixed(2)} vs ${small.literacy.toFixed(2)}`);

// 2. What the valley is known for.
for (let i = 0; i < 4; i++) {
  const n = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look });
  n.edu.know.carpentry = 70;
  n.edu.exp.carpentry = 70;
}
W.specialty();
check('with several skilled carpenters, the valley becomes known for carpentry', sim.state.education.specialty?.field === 'carpentry' && sim.state.chronicle.some((e) => e.key === 'chronicle.valley_known_for'));
const drawn = [];
for (let i = 0; i < 10; i++) {
  const n = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look });
  n.id = `drawn${i}`;
  W.drawnBySpecialty(n);
  drawn.push(Ed.know(n, 'carpentry'));
  sim.npcs.remove(n);
}
check('…and some newcomers come for it', drawn.some((v) => v >= 20), drawn.join(','));

// 3. The labour pool behind a new business.
const before = W.laborFactor('carpentry');
check('a business that can find trained hands here looks a better prospect', before > 1 && W.laborFactor('carpentry') > W.laborFactor('mill') - 0.001, `carpentry ${before.toFixed(2)} · mill ${W.laborFactor('mill').toFixed(2)}`);

// 4. Learning draws newcomers.
const a0 = W.attraction();
sim.state.village.treasury = 5000;
const school = build(sim, 'school', { tx: 44, ty: 40 });
sim.schools.weekly();
check('a working school draws families', W.attraction() > a0, `${a0} → ${W.attraction()}`);

// 5. What a town and a city need.
const town = BALANCE && sim.civic ? (await import('../src/data/civic.js')).VILLAGE_STATUS.find((s) => s.id === 'town') : null;
const needs0 = W.statusNeeds({ ...town, literacy: 0.99 });
check('a town needs people who can read (and a school)', needs0.some((m) => m.k === 'literacy'), JSON.stringify(needs0));
check('…this village has its school', !W.statusNeeds({ school: true }).length);

// 6. Milestones and landmarks.
sim.state.education.milestones.baseLiteracy = 0.2;
for (const n of npcs.filter((x) => x.age >= 8)) Object.assign(n.edu.know, { reading: Math.max(n.edu.know.reading || 0, 40), writing: Math.max(n.edu.know.writing || 0, 30) });
W.milestones();
check('when most can read, it is a milestone', sim.state.chronicle.some((e) => e.key === 'chronicle.literacy_milestone'));
const s = sim.schools.rec(school.id);
s.founded = sim.time.day - 3 * 56;
s.pupilsEver = 12;
W.landmarks();
check('the oldest school becomes a landmark', W.landmark(s.id)?.kind === 'old_school');
check('…people talk about it', (() => {
  const lines = [];
  sim.dialogue.newsTopics(npcs[0], (k) => lines.push(k), true);
  return lines.includes('talk.landmark.old_school');
})());
const smith = npcs.find((n) => n.occupation === 'blacksmith');
for (let i = 0; i < 3; i++) sim.state.education.apprenticeships.push({ apprentice: `x${i}`, master: smith.id, field: 'smithing', biz: smith.owns, since: 0, days: 60, done: 'finished' });
W.landmarks();
check('a workshop that has trained many journeymen becomes a name in its trade', Object.values(sim.state.education.landmarks).some((l) => l.kind === 'historic_workshop'));

// 7. Events that just happen.
for (const t of sim.schools.teachersOf(s)) sim.schools.release(t);
s.noTeacherWeeks = 7;
W.events();
check('a school without a teacher for weeks shuts', !!s.closed && sim.state.chronicle.some((e) => e.key === 'chronicle.school_closed'));
const lucky = sim.npcs.spawn({ age: 17, occupation: 'unemployed', money: 0, look });
Object.assign(lucky.edu, { level: 'secondary', interest: 'science', istr: 70, mot: 70, talented: 1 });
Object.assign(lucky.edu.know, { reading: 60, maths: 55 });
Object.assign(lucky.edu.apt, { analytic: 60, memory: 60, creative: 60 });
sim.exploration.region('market_town').known = true;
sim.state.village.treasury = 5000;
W.events();
check('a gifted youngster who can\'t pay is offered the village\'s scholarship', lucky.edu.sponsor === 'village' && sim.state.chronicle.some((e) => e.key === 'chronicle.scholarship_offered'));
const lake = sim.settlements.get('lakeside');
lake.pop = 240;
W.events();
check('a town that has grown founds a university', !!lake.university && !!sim.academia.uniDef('lakeside'));

// 8. Developer tools (the same code the debug panel uses).
const { eduTools } = await import('../src/debug/eduTools.js');
const dev = { sim };
const tools = eduTools(dev);
check('dev tools: education figures', typeof tools.stats().literacy === 'number');
check('dev tools: set knowledge', tools.setKnow(npcs[0].id, 'science', 77).science === 77);
check('dev tools: labour skill distribution', Object.keys(tools.skills()).length > 0);
check('dev tools: build a school', !!tools.school('trade_school'));

// 9. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('specialty, milestones and landmarks survive save / load', sim2.state.education.specialty?.field === 'carpentry' && Object.keys(sim2.state.education.landmarks).length === Object.keys(sim.state.education.landmarks).length);

// 10. The long run: a new valley, left to itself.
const years = Number(process.argv[2] || 5);
const long = Simulation.newGame('Long', 4242);
const runL = runOn(long);
const t0 = Date.now();
let crashed = null;
try {
  runL(years * 56 * 1440);
} catch (e) {
  crashed = e;
}
const secs = (Date.now() - t0) / 1000;
check(`${years} years of the whole valley pass without trouble`, !crashed, crashed?.stack?.split('\n').slice(0, 4).join(' | '));
const L = long.eduworld.stats();
const keys = new Set(long.state.chronicle.map((e) => e.key));
console.log(`   ${years}y in ${secs.toFixed(0)}s: pop ${L.pop}, literacy ${(L.literacy * 100).toFixed(0)}%, pupils ${L.pupils}, teachers ${L.teachers}, apprentices ${L.apprentices}, masters ${L.masters}, students away ${L.students}, schools ${long.schools.list().length}, known for ${L.specialty || '—'}`);
console.log(`   education news: ${[...keys].filter((k) => /school|teacher|pupil|graduate|apprentice|journeyman|course|university|research|literacy|landmark|known_for|talent/.test(k)).join(', ')}`);
check('in time the village builds itself a school', long.schools.list().length > 0 || long.construction.list.some((c) => c.type === 'school'));
check('…children go to it', long.state.npcs.some((n) => n.edu?.enrol) || long.state.chronicle.some((e) => e.key === 'chronicle.first_pupils'));
check('…and young people learn trades from masters', long.state.education.apprenticeships.length > 0);
check('the simulation keeps up (less than 2 minutes a game year headless)', secs / years < 120, `${(secs / years).toFixed(0)}s a year`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll education-world checks passed.');
process.exit(failures ? 1 : 0);
