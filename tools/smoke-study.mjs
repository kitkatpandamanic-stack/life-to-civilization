// Headless test for your own education and what you can do for other people's:
// evening classes, a trade course, private lessons, being a master's apprentice,
// reading at the library, a week at a university, giving a lesson, taking an
// apprentice of your own, paying for someone's studies, gifts to a school and the
// institute, founding a school — and that it's all in your books, your renown,
// and survives save / load.
// Usage: node tools/smoke-study.mjs
import { Simulation } from '../src/core/Simulation.js';
import { STUDY_PLAYER as SP } from '../src/data/study.js';

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
function build(sim, type, at) {
  const c = sim.growth.start('village', type, 'public', at);
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c;
}

const sim = Simulation.newGame('T', 7272);
const run = runOn(sim);
const St = sim.study;
const Ed = sim.education;
const p = sim.state.player;
const npcs = sim.state.npcs;
const look = npcs[0].look;
p.money = 5000;
sim.state.village.treasury = 5000;

// 1. The school's evening class.
const school = build(sim, 'school', { tx: 44, ty: 40 });
const s = sim.schools.rec(school.id);
const teacher = npcs.find((n) => n.age >= 25 && !n.owns);
Object.assign(teacher.edu.know, { reading: 60, writing: 50, maths: 50 });
sim.schools.appoint(s, teacher);
const learner = npcs.find((n) => n.age >= 20 && !n.teach && !n.owns && !Ed.literate(n));
learner.edu.mot = 80;
sim.schools.enrolments(); // someone must be at the evening class for it to run
toTime(sim, run, 0, 18);
check('on a Monday evening there is a class you can join', !!St.classNow(s.id), JSON.stringify(St.classNow(s.id)));
const r0 = p.edu.know.reading;
const xp0 = p.skills.learning.xp + p.skills.learning.level * 1000;
St.finishClass(s.id);
check('a class teaches you (knowledge)', p.edu.know.reading > r0, `${r0} → ${p.edu.know.reading}`);
check('…and trains the matching skill', p.skills.learning.xp + p.skills.learning.level * 1000 > xp0);

// 2. A trade course.
const ts = build(sim, 'trade_school', { tx: 50, ty: 40 });
const trade = sim.schools.rec(ts.id);
const joiner = npcs.find((n) => n.age >= 40 && !n.owns && !n.teach);
joiner.occupation = 'elder';
joiner.employer = null;
Object.assign(joiner.edu.know, { carpentry: 70 });
Object.assign(joiner.edu.exp, { carpentry: 80 });
sim.schools.appoint(trade, joiner);
check('you can sign up for the carpentry course (and pay)', St.signUp(trade.id, 'carpentry').ok && p.edu.course?.field === 'carpentry');
toTime(sim, run, 1, 18);
check('on a Tuesday evening your course has a lesson', St.classNow(trade.id)?.field === 'carpentry', JSON.stringify(St.classNow(trade.id)));
let done = false;
for (let i = 0; i < SP.courseLessons + 6 && !done; i++) done = !!St.finishClass(trade.id).finished;
check('after enough lessons you are qualified', p.edu.quals.some((q) => q.field === 'carpentry' && q.how === 'course') && p.edu.level !== 'none', JSON.stringify(p.edu.quals));

// 3. Private lessons.
const tutor = npcs.find((n) => n.age >= 25 && n !== teacher && n !== joiner);
tutor.edu.know.maths = 75;
const tc = St.canTutor(tutor);
check('someone learned can give you lessons (for a fee)', tc.ok && tc.fee > 0, JSON.stringify(tc));
const m0 = p.edu.know[tc.field] || 0;
const money0 = tutor.money;
St.finishTutoring(tutor.id);
check('a private lesson teaches you, and pays them', (p.edu.know[tc.field] || 0) > m0 && tutor.money > money0);
check('…and they remember it', tutor.memories.some((m) => m.k === 'taught_player'));

// 4. Apprenticed to a master.
const smith = npcs.find((n) => n.occupation === 'blacksmith');
smith.edu.know.smithing = 75;
smith.edu.exp.smithing = 85;
smith.pb = { t: 40, r: 20, c: 0 };
const ask = St.askApprentice(smith);
check('a master who trusts you takes you on as an apprentice', ask.ok && p.edu.apprentice?.master === smith.id, JSON.stringify(ask));
smith.task = { type: 'work', data: {} };
const smithy = sim.economy.biz(smith.owns).building;
check('you can work beside them at their forge', St.canWorkBeside(smithy).ok);
const sk0 = p.skills.smithing.level;
for (let i = 0; i < SP.apprenticeSessions + 10 && p.edu.apprentice; i++) St.finishWorkBeside();
check('working beside a master raises your skill fast', p.skills.smithing.level > sk0, `${sk0} → ${p.skills.smithing.level}`);
check('…until they call you a journeyman', !p.edu.apprentice && p.edu.quals.some((q) => q.field === 'smithing' && q.how === 'apprentice'));

// 5. The library.
const lib = build(sim, 'library', { tx: 38, ty: 40 });
check('if you can read, you can study at the library', St.canRead(lib.id).ok);
const lore0 = (p.edu.know.lore || 0) + (p.edu.know.science || 0) + (p.edu.know.reading || 0);
St.finishReading();
check('…and learn from the books', (p.edu.know.lore || 0) + (p.edu.know.science || 0) + (p.edu.know.reading || 0) > lore0);

// 6. A week at a university (on a journey to a university town).
p.away = { settlement: 'market_town' };
p.edu.know.maths = Math.max(p.edu.know.maths || 0, 50);
p.edu.know.reading = Math.max(p.edu.know.reading, 50);
const degrees = St.degreesAt('market_town');
check('in a university town you can study', degrees.includes('economics'), degrees.join(','));
let deg = false;
for (let w = 0; w < SP.uniWeeks + 4 && !deg; w++) deg = !!St.finishStudyWeek('market_town', 'economics').finished;
check('after enough weeks you take a degree', p.edu.degree === 'economics' && p.edu.level === 'university');
delete p.away;

// 7. Giving a lesson.
const kid = npcs.find((n) => n.occupation === 'child' && n.age >= 6);
if (kid && !kid.edu.enrol) sim.schools.enrol(kid, s, 'primary');
Object.assign(p.edu.know, { reading: 70, maths: 70 });
toTime(sim, run, 2, 10);
check('you know enough to give a lesson at the school', St.canGiveLesson(s.id).ok, JSON.stringify(St.lessonToGive(s.id)));
const k0 = kid ? Ed.know(kid, 'reading') : 0;
St.finishLesson(s.id);
check('your lesson teaches the pupils', !kid || Ed.know(kid, 'reading') > k0);
check('…and it is remembered', sim.state.chronicle.some((e) => e.key === 'chronicle.player_taught'));

// 8. An apprentice of your own (you need to be able to hire people).
p.skills.carpentry.level = 7;
while (p.level < 6) sim.progression.addXp(sim.progression.xpForNext() - p.xp + 1);
const youth = sim.npcs.spawn({ age: 17, occupation: 'unemployed', look });
youth.edu.interest = 'crafts';
youth.edu.istr = 60;
youth.edu.mot = 70;
youth.met = true; // you have to know someone to take them on
youth.rel = 20;
const take = St.takeApprentice(youth);
check('a master of a trade can take on an apprentice', take.ok && youth.employer === 'player' && youth.apprentice?.master === 'player', JSON.stringify(take));
const c0 = Ed.know(youth, 'carpentry');
for (let i = 0; i < 10; i++) sim.careers.onWorked(youth);
check('…who learns from you', Ed.know(youth, 'carpentry') > c0 + 2, `${c0} → ${Ed.know(youth, 'carpentry')}`);

// 9. Paying for someone's studies.
sim.exploration.region('market_town').known = true;
const bright = sim.npcs.spawn({ age: 18, occupation: 'unemployed', money: 0, look });
Object.assign(bright.edu, { level: 'secondary', interest: 'trade', istr: 70, mot: 85 });
Object.assign(bright.edu.know, { maths: 55, reading: 55 });
Object.assign(bright.edu.apt, { analytic: 50, memory: 50, creative: 50 }); // not gifted enough for a free place
const sp = St.canSponsor(bright);
check('a keen youngster who can\'t afford university can be sponsored', sp.ok, JSON.stringify(sp));
const pm = p.money;
St.sponsor(bright);
check('you pay, and they go', p.money < pm && bright.away?.study && bright.away.by === 'player');
check('…and they won\'t forget it', bright.memories.some((m) => m.k === 'sponsored_by_player' && m.w === 'player'));

// 10. Gifts.
const books0 = s.books;
check('you can give books to a school', St.giveBooks(s.id).ok && s.books >= books0 + SP.booksPerGift);
check('…or a month of the teachers\' pay', St.endowTeachers(s.id).ok && s.endowment > 0);
const tr0 = sim.state.village.treasury;
sim.schools.pay(s);
check('the gift is spent before the village fund', sim.state.village.treasury === tr0, `${tr0} → ${sim.state.village.treasury}`);
sim.state.knowledge.points = 20;
const inst = build(sim, 'institute', { tx: 48, ty: 34 });
check('you can fund the institute', St.fundResearch(inst.id).ok && sim.academia.institutes()[0].endowment > 0);

// 11. Founding.
const renown0 = sim.legacy.renown();
const f = St.found('grammar_school');
check('you can pay to found an upper school', f.ok && f.site?.type === 'grammar_school', JSON.stringify(f.ok ? { cost: f.cost } : f));
check('…which adds to your family\'s renown', sim.legacy.renown() > renown0, `${renown0} → ${sim.legacy.renown()}`);

// 12. It's in your books.
const L = sim.ledger.summary(Infinity);
check('your education and gifts are in your affairs', (L.out.education || 0) > 0 && (L.out.donations || 0) > 0 && (L.out.scholarships || 0) > 0, JSON.stringify({ edu: L.out.education, don: L.out.donations, sch: L.out.scholarships }));

// 13. Studying makes the skill come faster.
check('what you study makes its skill come faster', St.xpBonus('trading') > 1, St.xpBonus('trading').toFixed(2));

// 14. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('your education survives save / load', sim2.state.player.edu.degree === 'economics' && sim2.state.player.edu.quals.length === p.edu.quals.length);
let crashed = null;
try {
  runOn(sim2)(14 * 1440);
} catch (e) {
  crashed = e;
}
check('two weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll study checks passed.');
process.exit(failures ? 1 : 0);
