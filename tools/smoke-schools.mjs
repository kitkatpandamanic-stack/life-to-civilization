// Headless test for schools: the building, a teacher who is a villager with a post,
// families enrolling their children, pupils walking there on weekday mornings,
// lessons whose worth depends on the teacher, the building, the crowd and the books,
// a limit on seats, an upper class that needs a learned teacher, evening classes for
// grown-ups, exams at the end of the year, pay (and teachers who leave unpaid),
// sending for a teacher from the towns, the schooling policy, and save / load.
// Usage: node tools/smoke-schools.mjs
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
const toTime = (sim, run, weekday, hour) => {
  let guard = 0;
  while ((sim.time.weekday !== weekday || Math.floor(sim.time.hourFloat) !== hour) && guard++ < 24 * 8) run(60);
};
function finish(sim, c) {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
}

const sim = Simulation.newGame('T', 5150);
const run = runOn(sim);
const Sc = sim.schools;
const Ed = sim.education;
sim.state.village.treasury = 5000;

// 1. The village builds a school.
const site = sim.growth.start('village', 'school', 'public', { tx: 44, ty: 40 });
finish(sim, site);
const s = Sc.list()[0];
check('a school opens as a real building with a record', !!s && sim.world.buildings[s.id]?.type === 'school', s?.id);

// Some children of school age (the founders have few).
const kids = sim.state.npcs.filter((n) => n.occupation === 'child');
const extra = [];
for (let i = 0; i < 5; i++) {
  const parent = sim.state.npcs.find((n) => n.age >= 25 && n.homeId && n.kin?.spouse);
  extra.push(sim.npcs.spawn({ age: 6 + i, occupation: 'child', homeId: parent.homeId, kin: { parents: [parent.id, parent.kin.spouse], children: [], siblings: [] }, traits: ['friendly'] }));
}
const children = [...kids, ...extra].filter((n) => n.age >= 6 && n.age <= 12);

// 2. A teacher: a villager who takes the post.
Sc.weekly();
const teacher = Sc.teachersOf(s)[0];
check('a villager becomes the teacher', !!teacher && teacher.teach?.school === s.id, teacher?.id);
check('…it is their work now', teacher && (teacher.occupation === 'teacher' || teacher.occupation === 'elder'));
check('…and the village hears of it', sim.state.chronicle.some((e) => e.key === 'chronicle.new_teacher'));

// 3. Families enrol their children.
check('families send their children', children.filter((n) => n.edu.enrol?.school === s.id).length >= children.length - 1, `${children.filter((n) => n.edu.enrol).length}/${children.length}`);
check('the first pupils are history', sim.state.history.entries.some((e) => e.key === 'chronicle.first_pupils'));

// 4. School is a place: they walk there and sit in class.
toTime(sim, run, 2, 10);
const pupils = Sc.pupils(s, 'primary');
const inClass = pupils.filter((n) => n.task?.type === 'school');
check('on a weekday morning pupils are at school', inClass.length >= Math.ceil(pupils.length * 0.7), `${inClass.length}/${pupils.length}`);
check('…inside the building', pupils.some((n) => n.inside === s.id));
check('…and the teacher is there too', teacher.task?.type === 'school' && teacher.task.data.role === 'teacher');
check('what they are doing says so', sim.npcs.activity(pupils[0]).key === 'at_school' || sim.npcs.activity(pupils[0]).key === 'going_to_school', sim.npcs.activity(pupils[0]).key);

// 5. A day's lessons teach something.
const before = new Map(pupils.map((n) => [n.id, Ed.know(n, 'reading')]));
const tDays = teacher.teach.days;
toTime(sim, run, 2, 14);
check('pupils learn to read', pupils.filter((n) => Ed.know(n, 'reading') > before.get(n.id)).length >= inClass.length - 1);
check('the teacher gains experience', teacher.teach.days > tDays);
check('after school they go home or play', pupils.every((n) => n.task?.type !== 'school'));

// 6. Lessons are only as good as the conditions.
const q0 = Sc.quality(s, 'primary').total;
const rec = sim.property.rec(s.id);
const cond = rec.condition;
rec.condition = 20;
const qRuin = Sc.quality(s, 'primary').total;
rec.condition = cond;
check('a school in poor repair teaches less', qRuin < q0, `${q0.toFixed(2)} → ${qRuin.toFixed(2)}`);
const booksWas = s.books;
s.books = 0;
check('…so does one without books', Sc.quality(s, 'primary').total < q0);
s.books = booksWas;
const t2 = sim.state.npcs.find((n) => n !== teacher && n.age >= 25);
const savedEdu = JSON.parse(JSON.stringify(teacher.edu));
teacher.edu.apt.social = 90;
teacher.edu.know.speech = 80;
teacher.edu.know.reading = 80;
teacher.edu.know.maths = 70;
const qGood = Sc.quality(s, 'primary').total;
teacher.edu = savedEdu;
check('a better teacher gives better lessons', qGood > q0 * 1.15, `${q0.toFixed(2)} → ${qGood.toFixed(2)}`);

// 7. Seats run out.
const crowd = [];
for (let i = 0; i < 20; i++) {
  const p = sim.state.npcs.find((n) => n.age >= 25 && n.homeId);
  const k = sim.npcs.spawn({ age: 7, occupation: 'child', homeId: p.homeId, kin: { parents: [p.id], children: [], siblings: [] } });
  if (Sc.hasRoom(s)) Sc.enrol(k, s, 'primary');
  crowd.push(k);
}
check('a school holds only so many', !Sc.hasRoom(s) && Sc.dayPupils(s).length <= Math.floor(Sc.seats(s) * 1.3) + 1, `${Sc.dayPupils(s).length} / ${Sc.seats(s)}`);
const qCrowd = Sc.quality(s, 'primary');
check('an overcrowded room teaches everyone less', qCrowd.crowd < 1 && qCrowd.total < q0, `crowd ${qCrowd.crowd.toFixed(2)}`);
const late = crowd[crowd.length - 1];
if (!late.edu.enrol) {
  Sc.enrolments();
  check('a child who comes too late is turned away', !late.edu.enrol && s.turnedAway > 0);
}
for (const k of crowd) sim.npcs.remove(k);

// 8. The upper class needs a teacher who knows enough.
check('no upper class without a learned teacher', !Sc.stagesRunning(s).includes('upper') || Sc.qualified(teacher, 'upper'));
const learned = sim.state.npcs.find((n) => n !== teacher && n.age >= 22 && !n.owns && !n.teach);
learned.edu.know.maths = 60;
learned.edu.know.reading = 60;
Sc.appoint(s, learned);
check('…with one, it runs', Sc.stagesRunning(s).includes('upper'));

// 9. The school year ends: exams.
const good = pupils[0];
const weak = pupils[1];
Object.assign(good.edu.know, { reading: 60, writing: 50, maths: 55 });
good.edu.enrol.years = 3;
Object.assign(weak.edu.know, { reading: 10, writing: 5, maths: 8 });
weak.edu.enrol.years = 3;
weak.age = 9;
Sc.yearEnd();
check('a pupil who knows enough passes and finishes primary school', good.edu.level === 'primary', good.edu.level);
check('…which is history the first time', sim.state.chronicle.some((e) => e.key === 'chronicle.first_graduate_primary'));
check('a pupil who doesn\'t repeats the year', weak.edu.enrol?.fails === 1 && weak.memories.some((m) => m.k === 'failed_exam'));
Sc.yearEnd();
check('…and after failing again, leaves (and can come back later)', !weak.edu.enrol && weak.edu.left?.why === 'failed');

// 10. Evening classes for grown-ups who want to read.
const adult = sim.state.npcs.find((n) => n.age >= 20 && !Ed.literate(n) && !n.teach && !n.owns);
adult.edu.mot = 80;
Sc.enrolments();
check('a grown-up who can\'t read goes to evening classes', adult.edu.enrol?.stage === 'evening');
toTime(sim, run, 3, 19);
check('…on Thursday evenings, at the school', adult.task?.type === 'school' && adult.task.data.role === 'evening', adult.task?.type);

// 11. Pay: unpaid teachers leave.
sim.state.village.treasury = 0;
sim.state.village.schoolFund = 0; // (and nothing set aside for the teachers either)
const payTeacher = Sc.teachersOf(s)[0];
for (let i = 0; i < 3; i++) Sc.pay(s);
check('a teacher left unpaid for weeks gives up the post', !payTeacher.teach && sim.state.chronicle.some((e) => e.key === 'chronicle.teacher_quit_unpaid'));

// 12. No one to teach: in time the village sends for a teacher from the towns.
for (const t of Sc.teachersOf(s)) Sc.release(t);
for (const n of sim.state.npcs) if (n.age >= 18) Object.assign(n.edu.know, { reading: Math.min(n.edu.know.reading || 0, 12) });
sim.state.village.treasury = 2000;
const popBefore = sim.state.npcs.length;
Sc.staff(s);
check('nobody local can teach: a shortage', Sc.teachersOf(s).length === 0 && sim.state.chronicle.some((e) => e.key === 'chronicle.teacher_shortage'));
sim.state.education.schools[s.id].shortSince = sim.time.day - 20;
Sc.staff(s);
const newcomer = Sc.teachersOf(s)[0];
check('…so a teacher comes from outside', !!newcomer && sim.state.npcs.length > popBefore && Sc.qualified(newcomer, 'primary'), newcomer?.id);

// 13. The schooling policy.
const sal = Sc.salary(newcomer);
sim.civic.V.policies.schooling = 'high';
check('a generous schooling policy pays teachers more', Sc.salary(newcomer) > sal);
sim.civic.V.policies.schooling = 'low';
check('a tight one makes families pay a fee', Sc.fee(s) > 0);
sim.civic.V.policies.schooling = 'normal';

// 14. Save / load.
const snap = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(snap);
check('schools, teachers and pupils survive save / load', sim2.schools.list().length === 1 && sim2.schools.teachersOf(sim2.schools.list()[0]).length === Sc.teachersOf(s).length && sim2.schools.pupils(sim2.schools.list()[0]).length === Sc.pupils(s).length);

// 15. Older saves: the old single teacher is kept on.
const old = JSON.parse(JSON.stringify(sim.state));
const oldTeacher = old.npcs.find((n) => n.teach);
delete oldTeacher.teach;
old.education.schools[s.id].teachers = [];
old.tech.teacher = oldTeacher.id;
const sim3 = new Simulation(old);
check('an old save\'s teacher is still the teacher', sim3.schools.teachersOf(sim3.schools.list()[0]).some((t) => t.id === oldTeacher.id));

// 16. A few weeks of school life.
let crashed = null;
try {
  runOn(sim2)(21 * 1440);
} catch (e) {
  crashed = e;
}
check('three weeks of school pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
const yearLen = BALANCE.time.daysPerSeason * BALANCE.time.seasons.length;
check('the school year is a real year', yearLen > 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll school checks passed.');
process.exit(failures ? 1 : 0);
