// Headless test for careers: rank from competence (not age), titles in the trade,
// apprenticeships (masters and young people finding each other, learning faster
// beside a master, a smaller wage, finishing as a journeyman, a master's child not
// forced into the trade), the trade school (instructors, courses, passing), grown-ups
// starting over, skilled work and shortages (better pay, sending for someone trained),
// businesses training their people, and save / load.
// Usage: node tools/smoke-careers.mjs
import { Simulation } from '../src/core/Simulation.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
function finish(sim, c) {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
}

const sim = Simulation.newGame('T', 8181);
const run = runOn(sim);
const Ed = sim.education;
const C = sim.careers;
const npcs = sim.state.npcs;
const smith = npcs.find((n) => n.occupation === 'blacksmith');

// 1. Rank comes from what you know and have done, not from your age.
smith.level = 2;
smith.edu.know.smithing = 70;
smith.edu.exp.smithing = 85;
check('a real master blacksmith ranks as a master, whatever their "level"', sim.npcs.rank(smith) === 'master', sim.npcs.rank(smith));
check('…and is a master of the trade', C.tier(smith) === 'master', C.tier(smith));
const green = npcs.find((n) => n.employer === 'farm');
green.level = 12;
green.edu.know.farming = 5;
green.edu.exp.farming = 3;
check('someone who barely knows the work is still a beginner at it', C.tier(green) === 'trainee');

// 2. An apprenticeship: a master and a young person who wants the trade.
const youth = sim.npcs.spawn({ age: 16, occupation: 'unemployed', homeId: npcs.find((n) => n.homeId && n !== smith).homeId, traits: ['hard_worker'], look: smith.look });
youth.edu.interest = 'crafts';
youth.edu.istr = 60;
youth.edu.mot = 75;
youth.edu.apt.practical = 70;
youth.edu.know.smithing = 3;
sim.social.adjust(smith, youth, { f: 30, t: 30 });
let tries = 0;
while (!youth.apprentice && tries++ < 6) {
  C.matchApprentices();
  sim.time.state && 0;
}
check('a master takes on a young person who wants the trade', youth.apprentice?.master === smith.id, JSON.stringify(youth.apprentice));
check('…who now works at the smithy', youth.employer === smith.owns && youth.occupation === 'smith_hand');
check('…and it is news, and remembered', sim.state.chronicle.some((e) => e.key === 'chronicle.npc_apprentice') && youth.memories.some((m) => m.k === 'mentored_by'));
check('an apprentice earns less than a hand', sim.npcs.wageFor(smith.owns, youth) < sim.npcs.wageFor(smith.owns, { ...youth, apprentice: null, level: youth.level }));

// 3. Beside a master, you learn faster than alone.
const alone = sim.npcs.spawn({ age: 16, occupation: 'smith_hand', employer: smith.owns, traits: ['hard_worker'], look: smith.look });
alone.edu = JSON.parse(JSON.stringify(youth.edu));
delete alone.edu.enrol;
smith.workedToday = true;
const k0 = Ed.know(youth, 'smithing');
for (let i = 0; i < 20; i++) {
  Ed.worked(youth);
  Ed.worked(alone);
}
check('an apprentice learns the trade far faster than someone left to it', Ed.know(youth, 'smithing') - k0 > (Ed.know(alone, 'smithing') - k0) * 2, `${(Ed.know(youth, 'smithing') - k0).toFixed(1)} vs ${(Ed.know(alone, 'smithing') - k0).toFixed(1)}`);
sim.npcs.remove(alone);

// 4. Finishing: a journeyman.
youth.edu.know.smithing = 55;
youth.edu.exp.smithing = 40;
youth.apprentice.days = 60;
C.checkApprentice(youth);
check('an apprentice who has learned enough finishes', !youth.apprentice && youth.edu.quals?.some((q) => q.field === 'smithing' && q.how === 'apprentice'));
check('…with a trade qualification', youth.edu.level === 'vocational');
check('…and it is news', sim.state.chronicle.some((e) => e.key === 'chronicle.journeyman'));
check('…they stay on at the smithy', youth.employer === smith.owns);

// 5. A master's child isn't forced into the trade.
const kid = sim.npcs.spawn({ age: 15, occupation: 'unemployed', homeId: smith.homeId, kin: { parents: [smith.id], children: [], siblings: [] }, look: smith.look });
kid.edu.interest = 'science';
kid.edu.istr = 80;
const kidWants = C.wantsTrade(kid, 'smithing', smith);
kid.edu.interest = 'crafts';
const kidWants2 = C.wantsTrade(kid, 'smithing', smith);
check('a master\'s child set on something else doesn\'t want the forge', kidWants < 1, kidWants.toFixed(2));
check('…one drawn to crafts does', kidWants2 >= 1 && kidWants2 > kidWants, kidWants2.toFixed(2));

// 6. A master leaves: the apprenticeship ends.
const second = sim.npcs.spawn({ age: 17, occupation: 'unemployed', look: smith.look });
C.start(second, smith, smith.owns, 'smithing');
check('a second apprentice starts', !!second.apprentice);
C.end(second, 'master_gone');
check('…and ends when the master is gone', !second.apprentice && second.memories.some((m) => m.k === 'apprenticeship_ended'));

// 7. The trade school.
sim.state.village.treasury = 5000;
const site = sim.growth.start('village', 'trade_school', 'public', { tx: 44, ty: 40 });
finish(sim, site);
const ts = sim.schools.list().find((s) => s.kind === 'trade');
check('a trade school opens', !!ts);
const old = npcs.find((n) => n.age >= 40 && !n.owns && n !== smith && !n.teach);
old.occupation = 'elder';
old.employer = null;
old.edu.know.carpentry = 65;
old.edu.exp.carpentry = 80;
sim.schools.staff(ts);
check('an experienced carpenter becomes its instructor', sim.schools.teachersOf(ts).includes(old), sim.schools.teachersOf(ts).map((t) => t.id).join(','));
check('…and it teaches carpentry', sim.schools.courses(ts).includes('carpentry'));
const pupil = sim.npcs.spawn({ age: 15, occupation: 'unemployed', homeId: old.homeId, look: smith.look });
pupil.edu.level = 'primary';
pupil.edu.interest = 'building';
pupil.edu.istr = 70;
pupil.edu.mot = 80;
pupil.edu.apt.practical = 75;
for (let w = 0; w < 4 && !pupil.edu.enrol; w++) sim.schools.enrolments();
check('a youngster drawn to building signs up for the carpentry course', pupil.edu.enrol?.stage === 'vocational' && pupil.edu.enrol.field === 'carpentry', JSON.stringify(pupil.edu.enrol));
const c0 = Ed.know(pupil, 'carpentry');
pupil.inside = ts.id;
old.inside = ts.id;
sim.schools.lessons(ts, 'vocational');
check('a day of the course teaches the trade', Ed.know(pupil, 'carpentry') > c0 + 0.3, `${c0} → ${Ed.know(pupil, 'carpentry')}`);
pupil.edu.know.carpentry = 50;
pupil.edu.enrol.years = 1;
sim.schools.yearEnd();
check('passing the course is a qualification', pupil.edu.quals?.some((q) => q.field === 'carpentry' && q.how === 'course') && pupil.edu.level === 'vocational');

// 8. Grown-ups starting over.
const tired = npcs.find((n) => n.age >= 25 && n.age <= 45 && n.employer && n.employer !== smith.owns && !n.teach && Ed.fieldOf(n) !== 'carpentry');
tired.edu.interest = 'building';
tired.edu.istr = 70;
tired.edu.mot = 70;
tired.jobSat = 30;
tired.edu.know.reading = Math.max(tired.edu.know.reading || 0, 25);
C.retraining();
check('someone unhappy in their work, drawn to another, wants to retrain', !!tired.edu.retrain, tired.edu.retrain);
if (tired.edu.retrain === 'carpentry') {
  sim.schools.enrolments();
  check('…and takes an evening course in it', tired.edu.enrol?.stage === 'trade_evening');
}

// 9. Skilled work: an untrained applicant is a long shot; a vacancy nobody fills makes the business act.
const bizId = smith.owns;
const b = sim.economy.biz(bizId);
const trained = { ...green, edu: { ...green.edu, know: { smithing: 50 }, exp: { smithing: 50 } } };
check('employers would rather have someone who knows the trade', Ed.hireMult(trained, 'smith_hand') > Ed.hireMult(green, 'smith_hand') * 1.4);
for (const n of sim.npcs.staffOf(bizId)) {
  n.employer = null;
  n.occupation = 'unemployed';
}
b.money = 2000;
b.maxWorkers = 1;
sim.state.village.treasury = 2000;
const wage0 = b.wageLevel ?? 1;
b.vacantSince = sim.time.day - 20;
C.shortages();
check('a skilled vacancy left open: better pay', (b.wageLevel ?? 1) > wage0);
check('…and the valley hears it is short of trained people', sim.state.chronicle.some((e) => e.key === 'chronicle.skill_shortage'));
sim.settlements.makeContact('ironford', 'test');
b.shortageStep = 3;
const pop0 = npcs.length;
C.shortages();
const recruited = sim.npcs.staffOf(bizId)[0];
check('in the end, they send for a trained worker from outside', npcs.length > pop0 && recruited && Ed.competenceFor(recruited, 'smith_hand') >= 40, recruited?.id);

// 10. A business trains its people.
const farm = sim.economy.ofType('farm')[0];
const fb = sim.economy.biz(farm);
const owner = sim.economy.owner(farm);
if (!owner.traits.includes('ambitious')) owner.traits.push('ambitious');
fb.money = 800;
const hands = sim.npcs.staffOf(farm);
while (sim.npcs.staffOf(farm).filter((n) => !n.apprentice).length < 2) {
  const n = sim.npcs.spawn({ age: 20, occupation: 'farmhand', employer: farm, look: smith.look });
  n.edu.know.farming = 5;
}
for (const n of sim.npcs.staffOf(farm)) {
  n.edu.know.farming = 10;
  n.edu.exp.farming = 10;
}
C.training();
check('an owner with untrained staff starts training them', !!fb.training, JSON.stringify(fb.training));
const h = sim.npcs.staffOf(farm)[0];
h.edu.know.farming = 60; // at the limit of what practice alone teaches
Ed.worked(h);
check('…and training takes them past what practice alone teaches', Ed.know(h, 'farming') > 60);

// 11. Save / load, and a few weeks of it all.
const snap = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(snap);
check('apprenticeships, qualifications and training survive save / load', sim2.state.education.apprenticeships.length === sim.state.education.apprenticeships.length && sim2.npcs.byId(youth.id).edu.quals?.length === youth.edu.quals.length && !!sim2.economy.biz(farm).training);
let crashed = null;
try {
  runOn(sim2)(21 * 1440);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
const S = sim2.careers.summary();
check('the valley has figures for its trades', typeof S.apprentices === 'number' && typeof S.masters === 'number', JSON.stringify(S));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll career checks passed.');
process.exit(failures ? 1 : 0);
