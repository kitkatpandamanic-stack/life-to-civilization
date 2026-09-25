// Headless test for higher learning: universities in the towns (who goes, who pays,
// two years away, the final exam), graduates coming home or staying away (and being
// called home later), posts for the learned (doctor, engineer, researcher) with real
// effects, the research institute (projects, progress from real work, outcomes that
// depend on the conditions), discoveries becoming know-how, fame, and save / load.
// Usage: node tools/smoke-academia.mjs
import { Simulation } from '../src/core/Simulation.js';
import { PROJECTS } from '../src/data/academia.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
const toTime = (sim, run, weekday, hour) => {
  let guard = 0;
  while ((sim.time.weekday !== weekday || Math.floor(sim.time.hourFloat) !== hour) && guard++ < 24 * 8) run(60);
};
function finish(sim, c) {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
}

const sim = Simulation.newGame('T', 3030);
const run = runOn(sim);
const A = sim.academia;
const Ed = sim.education;
const npcs = sim.state.npcs;
const look = npcs[0].look;

// 1. Nobody can go to a university the valley hasn't heard of.
check('a town the valley has not heard of is not an option', !A.universities().includes('saltmere'));
sim.exploration.region('far_coast').known = true;
sim.exploration.region('market_town').known = true;
sim.exploration.region('iron_hills').known = true;
check('once Saltmere is known, its university is too', A.universities().includes('saltmere'));

// 2. A bright, keen youngster goes to study.
const parent = npcs.find((n) => n.age >= 35 && n.homeId && !n.owns);
parent.money = 2000;
const bright = sim.npcs.spawn({ age: 18, occupation: 'unemployed', homeId: parent.homeId, kin: { parents: [parent.id], children: [], siblings: [] }, look, traits: ['scholar'] });
Object.assign(bright.edu, { level: 'secondary', interest: 'machines', istr: 70, mot: 85 });
Object.assign(bright.edu.know, { maths: 58, reading: 55, science: 30 });
const want = A.wantsToStudy(bright);
check('they want to study engineering, at the best known place for it', want?.degree === 'engineering' && want.uni === (A.universities().includes('ironford') ? 'ironford' : 'market_town'), JSON.stringify(want));
for (let i = 0; i < 6 && !bright.away; i++) A.applications();
check('they go off to university (the family pays)', bright.away?.study === want.uni && bright.away.by === 'family', JSON.stringify(bright.away));
check('…the family is poorer for it', parent.money < 2000);
check('…they are gone from the valley for now', bright.inside === 'away' && A.students().includes(bright));
check('…and it is history (the first)', sim.state.history.entries.some((e) => e.key === 'chronicle.first_student'));

// 3. No money: the gifted may get a scholarship; others can't go.
const poorP = npcs.find((n) => n.age >= 35 && n !== parent && !n.owns && n.homeId);
poorP.money = 0;
const poor = sim.npcs.spawn({ age: 17, occupation: 'unemployed', homeId: poorP.homeId, money: 0, kin: { parents: [poorP.id], children: [], siblings: [] }, look });
Object.assign(poor.edu, { level: 'primary', interest: 'science', istr: 60, mot: 80 });
Object.assign(poor.edu.know, { reading: 55, maths: 45, science: 25 });
poor.edu.apt.analytic = 50;
poor.edu.apt.memory = 50;
poor.edu.apt.creative = 50;
check('without money or a gift, there is no way to pay', A.funding(poor, 'market_town') === null);
poor.edu.apt.analytic = 90;
poor.edu.talented = sim.time.day;
check('a gifted pupil wins a scholarship', A.funding(poor, 'market_town')?.by === 'scholarship');

// 4. Two years of study: they learn; then the final exam.
const e0 = Ed.know(bright, 'engineering');
for (let w = 0; w < 10; w++) A.studyWeek();
check('a university week teaches a great deal', Ed.know(bright, 'engineering') > e0 + 15, `${e0} → ${Ed.know(bright, 'engineering')}`);
bright.edu.know.engineering = 70;
bright.away.until = sim.time.day;
parent.money = 50;
A.studyWeek();
check('they graduate', bright.edu.level === 'university' && bright.edu.degree === 'engineering');
check('…and (with family here) come home', !bright.away && bright.inside !== 'away' && npcs.includes(bright), bright.inside);
check('…which is news', sim.state.chronicle.some((e) => e.key === 'chronicle.graduate_returned' || e.key === 'chronicle.first_university_graduate'));

// 5. Some stay away — and can be called home when a post opens.
const doc = sim.npcs.spawn({ age: 24, occupation: 'unemployed', look });
Object.assign(doc.edu, { level: 'university', degree: 'medicine' });
doc.edu.know.medicine = 65;
doc.away = { study: 'market_town', degree: 'medicine', since: 0, until: sim.time.day, by: 'family' };
doc.inside = 'away';
const pop0 = npcs.length;
A.settleAway(doc);
check('a graduate who stays in the town leaves the valley', !sim.npcs.byId(doc.id) && npcs.length === pop0 - 1 && sim.state.education.alumni.length === 1);
check('…the brain drain is remembered', sim.state.chronicle.some((e) => e.key === 'chronicle.graduate_stayed'));
sim.state.village.treasury = 5000;
const cl = sim.growth.start('village', 'clinic', 'public', { tx: 44, ty: 40 });
finish(sim, cl);
check('the valley has a clinic, and wants a doctor', A.postOpen('doctor'));
let back = null;
for (let i = 0; i < 20 && !back; i++) {
  sim.time.state && 0;
  back = A.recall('doctor');
  if (!back) sim.state.education.alumni.length || sim.state.education.alumni.push({ npc: JSON.parse(JSON.stringify({ ...doc, away: undefined })), degree: 'medicine', uni: 'market_town', day: 0 });
}
check('…so the graduate who stayed away comes home for it', !!back && Ed.know(back, 'medicine') >= 60, back?.id);

// 6. The post: a doctor at the clinic, who really does keep people well.
const sick0 = sim.tech.mod('sickness');
A.staffPosts();
check('the graduate becomes the valley\'s doctor', back?.post?.kind === 'doctor' && back.occupation === 'doctor', JSON.stringify(back?.post));
sim.tech.mods = null;
check('with a doctor, fewer fall sick', sim.tech.mod('sickness') < sick0, `${sick0} → ${sim.tech.mod('sickness')}`);
toTime(sim, run, 2, 10);
check('the doctor goes to the clinic in the morning', back.task?.type === 'school' && back.task.data.role === 'doctor', back.task?.type);
check('…seeing patients', sim.npcs.activity(back).key === 'at_post_doctor' || sim.npcs.activity(back).key === 'going_to_post');

// 7. The research institute.
sim.state.village.treasury = 5000;
sim.state.knowledge.points = 20;
const lib = sim.growth.start('village', 'library', 'public', { tx: 40, ty: 40 });
finish(sim, lib);
const site = sim.growth.start('village', 'institute', 'public', { tx: 48, ty: 36 });
finish(sim, site);
const inst = A.institutes()[0];
check('an institute opens', !!inst);
const sci = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look });
Object.assign(sci.edu.know, { science: 75, maths: 75, engineering: 70, farming: 50, architecture: 60 });
sci.edu.level = 'university';
A.staffPosts();
check('a scientist takes a post there', sci.post?.kind === 'researcher');
A.institutesWeek();
check('it chooses a project it can do, and buys the instruments', !!inst.project && inst.equipment > 0, inst.project);
const proj = inst.project;
check('research know-how doesn\'t come from ordinary work', sim.tech.dailyProgress(proj) === 0);
const p0 = inst.progress;
sci.inside = inst.id;
A.researchDay();
check('a day\'s research moves the project on', inst.progress > p0, `${p0} → ${inst.progress}`);

// 8. Outcomes depend on the conditions.
const trial = (know) => {
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    for (const f of Object.keys(PROJECTS[proj].fields)) sci.edu.know[f] = know;
    inst.project = proj;
    inst.progress = PROJECTS[proj].cost;
    inst.equipment = know > 60 ? 1 : 0.2;
    delete sim.state.tech.known[proj];
    const clock = sim.time.state?.day;
    sim.state.tech.progress[proj] = 0;
    const d0 = sim.state.education.discoveries.length;
    // vary the day so each trial rolls its own dice
    A.rng = ((orig) => (salt) => orig.call(A, `${salt}:${i}:${know}`))(Object.getPrototypeOf(A).rng);
    A.outcome(inst);
    if (sim.state.education.discoveries.length > d0) wins++;
    void clock;
  }
  return wins;
};
const good = trial(90);
const poorRes = trial(20);
check('well-trained researchers with good instruments usually succeed', good >= 28, `${good}/40`);
check('…ill-prepared ones mostly fail', poorRes <= 12 && poorRes < good, `${poorRes}/40`);

// 9. A discovery is know-how, with real effects — and makes a name.
sim.state.tech.known[proj] = sim.time.day;
sim.tech.mods = null;
const d = sim.state.education.discoveries[0];
check('discoveries are recorded (who, when)', d && d.tech === proj && d.by === sci.id);
check('the one who led it is known for it', (sci.fame || 0) >= 40 && sci.memories.some((m) => m.k === 'made_discovery'));
check('…and the first breakthrough is history', sim.state.history.entries.some((e) => e.key === 'chronicle.first_breakthrough'));

// 10. Save / load, and a few weeks.
const snap = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(snap);
check('posts, institutes, discoveries and alumni survive save / load', sim2.academia.holders('doctor').length === 1 && sim2.academia.institutes().length === 1 && sim2.state.education.discoveries.length === sim.state.education.discoveries.length);
let crashed = null;
try {
  runOn(sim2)(21 * 1440);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('the valley has figures for its learned', typeof sim2.academia.summary().graduates === 'number', JSON.stringify(sim2.academia.summary()));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll academia checks passed.');
process.exit(failures ? 1 : 0);
