// Headless test for the foundation of education: everyone has a knowledge profile
// (knowledge apart from experience, aptitudes, motivation, interests), people learn
// at different speeds, work teaches experience and some theory, children learn at
// home, what people know changes their work, hiring and business plans, newcomers
// bring their schooling, and it all survives save / load.
// Usage: node tools/smoke-education.mjs
import { Simulation } from '../src/core/Simulation.js';
import { KNOWLEDGE, APTITUDES } from '../src/data/education.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

const sim = Simulation.newGame('T', 4711);
const run = runOn(sim);
const Ed = sim.education;
const npcs = sim.state.npcs;

// 1. Profiles.
check('every villager has a knowledge profile', npcs.every((n) => n.edu && n.edu.know && n.edu.exp && n.edu.apt && typeof n.edu.mot === 'number'));
const aptSets = new Set(npcs.map((n) => APTITUDES.map((a) => n.edu.apt[a]).join(',')));
check('nobody is the same (aptitudes differ)', aptSets.size === npcs.length, `${aptSets.size}/${npcs.length}`);
const smith = npcs.find((n) => n.occupation === 'blacksmith');
const farmer = npcs.find((n) => n.occupation === 'farmer');
check('the blacksmith knows smithing, the farmer farming', Ed.know(smith, 'smithing') > Ed.know(farmer, 'smithing') && Ed.know(farmer, 'farming') > Ed.know(smith, 'farming'), `${Ed.know(smith, 'smithing')} / ${Ed.know(farmer, 'farming')}`);
check('…and experience is kept apart from knowledge', Ed.exp(smith, 'smithing') > 0 && Ed.exp(smith, 'smithing') !== Ed.know(smith, 'smithing'));
const shop = npcs.find((n) => n.occupation === 'shopkeeper');
check('a shopkeeper is better at sums than a woodcutter', Ed.know(shop, 'maths') > Ed.know(npcs.find((n) => n.occupation === 'woodcutter'), 'maths'));
const strengths = new Set(npcs.filter((n) => n.age >= 16).map((n) => Ed.strengths(n)[0]).filter(Boolean));
check('different people are good at different things', strengths.size >= 3, [...strengths].join(', '));

// 2. How fast people learn: ability and motivation both matter (the spec's example).
const a = npcs.find((n) => n.age >= 18 && n.occupation !== 'elder');
const b = npcs.find((n) => n.age >= 18 && n !== a && n.occupation !== 'elder');
a.edu.apt.analytic = 90; a.edu.apt.memory = 90; a.edu.mot = 30; a.edu.know.science = 35; a.edu.know.reading = 60;
b.edu.apt.analytic = 70; b.edu.apt.memory = 70; b.edu.mot = 95; b.edu.know.science = 35; b.edu.know.reading = 60;
a.edu.interest = b.edu.interest = null;
const ga = Ed.learn(a, 'science', 5);
const gb = Ed.learn(b, 'science', 5);
check('ability 90 / motivation 30 learns less than ability 70 / motivation 95', gb > ga * 1.4, `${ga.toFixed(2)} vs ${gb.toFixed(2)}`);
const c = npcs.find((n) => n.age >= 18 && n !== a && n !== b);
c.edu.know.reading = 5; c.edu.know.maths = 3; c.edu.know.engineering = 0; c.edu.mot = 60;
const d = { ...b, edu: { ...b.edu, know: { ...b.edu.know, maths: 60, engineering: 0 } } };
check('advanced fields barely sink in without the basics', Ed.rate(c, 'engineering') < Ed.rate(d, 'engineering') * 0.6);

// 3. Work teaches: experience grows, and some of the theory.
const hand = npcs.find((n) => n.employer === 'lumberyard');
const exp0 = Ed.exp(hand, 'forestry');
const know0 = Ed.know(hand, 'forestry');
for (let i = 0; i < 20; i++) Ed.worked(hand);
check('a day\'s work adds experience', Ed.exp(hand, 'forestry') > exp0, `${exp0} → ${Ed.exp(hand, 'forestry')}`);
check('…and a little knowledge', Ed.know(hand, 'forestry') > know0 || know0 >= 60);
hand.edu.know.forestry = 59.9;
for (let i = 0; i < 40; i++) Ed.worked(hand);
check('…but practice alone tops out; beyond that needs teaching', Ed.know(hand, 'forestry') <= 60.01, Ed.know(hand, 'forestry'));

// 4. It changes their work: productivity, hiring, experience, business plans.
const w = npcs.find((n) => n.employer === 'quarry' || n.occupation === 'miner');
const save = JSON.parse(JSON.stringify(w.edu));
w.edu.know.mining = 5; w.edu.exp.mining = 3;
const pLow = sim.npcs.productivity(w);
const hLow = Ed.hireMult(w, 'miner');
w.edu.know.mining = 80; w.edu.exp.mining = 90;
const pHigh = sim.npcs.productivity(w);
const hHigh = Ed.hireMult(w, 'miner');
check('someone who knows the work works faster', pHigh > pLow * 1.15, `${pLow.toFixed(2)} → ${pHigh.toFixed(2)}`);
check('…and employers would rather hire them', hHigh > hLow * 1.5, `${hLow.toFixed(2)} → ${hHigh.toFixed(2)}`);
check('…and theory makes practice pay (more work XP)', Ed.xpMult(w) > 1.1);
w.edu = save;
const nobody = npcs.find((n) => n.occupation === 'unemployed') || npcs.find((n) => n.age >= 18);
const f0 = Ed.founderFit(nobody, 'baker');
nobody.edu.know.cooking = 70; nobody.edu.exp.cooking = 70;
check('a would-be baker who knows the trade is a likelier founder', Ed.founderFit(nobody, 'baker') > f0 + 0.8);

// 5. Children at home: speech, and reading if a parent reads.
const kid = npcs.find((n) => n.age >= 6 && n.age < 12 && n.kin?.parents?.length);
const mum = sim.npcs.byId(kid.kin.parents[0]);
for (const id of kid.kin.parents) {
  const p = sim.npcs.byId(id);
  if (p) {
    p.edu.know.reading = 70;
    p.homeId = kid.homeId;
  }
}
kid.edu.know.reading = 2;
for (let i = 0; i < 8; i++) Ed.homeLearning(kid);
check('a child whose parents read learns to read at home', Ed.know(kid, 'reading') > 5, Ed.know(kid, 'reading'));
const trade = Ed.fieldOf(mum) || 'farming';
check('…and picks up something of a parent\'s trade', Ed.know(kid, trade) > 0, `${trade} ${Ed.know(kid, trade)}`);

// 6. Interests grow in adolescence — out of home, talents, hobbies — and aren't forced.
const teens = npcs.filter((n) => n.age >= 10 && n.age < 16);
for (const t of teens) {
  t.edu.interest = null;
  t.edu.istr = 0;
}
run(4 * 7 * 1440);
check('teenagers take an interest in something', teens.length === 0 || teens.some((t) => t.edu.interest), teens.map((t) => `${t.id}:${t.edu.interest}/${t.edu.istr}`).join(' '));
check('interests grow stronger week by week', teens.length === 0 || teens.some((t) => t.edu.istr > 10));
// Across many children: some follow a parent's trade, some don't.
let follow = 0;
let differ = 0;
for (let s = 0; s < 6; s++) {
  const x = Simulation.newGame('T', 900 + s);
  for (const k of x.state.npcs.filter((n) => n.age >= 6 && n.age < 16)) {
    k.age = 13;
    k.edu.interest = null;
    for (let wk = 0; wk < 8; wk++) x.education.updateInterest(k);
    const pf = (k.kin?.parents || []).map((id) => x.npcs.byId(id)).map((p) => p && x.education.fieldOf(p)).filter(Boolean);
    if (!k.edu.interest) continue;
    const fields = (await import('../src/data/education.js')).INTERESTS[k.edu.interest].fields;
    if (pf.some((f) => fields.includes(f))) follow++;
    else differ++;
  }
}
check('children don\'t all follow their parents', differ > 0, `follow ${follow}, differ ${differ}`);

// 7. Motivation follows life.
const lazy = npcs.find((n) => n.age >= 16 && n.traits.includes('lazy')) || npcs.find((n) => n.age >= 16);
const keen = npcs.find((n) => n.age >= 16 && n.traits.includes('scholar')) || npcs.find((n) => n.age >= 16 && n !== lazy);
if (!lazy.traits.includes('lazy')) lazy.traits.push('lazy');
if (!keen.traits.includes('scholar')) keen.traits.push('scholar');
check('a scholar wants to learn more than a lazybones', Ed.motivationTarget(keen) > Ed.motivationTarget(lazy));

// 8. Babies inherit some of their parents' gifts.
const [m, f] = [npcs.find((n) => n.gender === 'f' && n.kin?.spouse), null];
const dad = sim.npcs.byId(m.kin.spouse);
for (const p of [m, dad]) for (const k of APTITUDES) p.edu.apt[k] = 90;
let sum = 0;
for (let i = 0; i < 6; i++) {
  const baby = sim.npcs.spawn({ age: 0, occupation: 'child', kin: { parents: [m.id, dad.id], children: [], siblings: [] }, homeId: m.homeId });
  sum += APTITUDES.reduce((s, k) => s + baby.edu.apt[k], 0) / APTITUDES.length;
  sim.npcs.remove(baby);
}
check('children of gifted parents tend to be gifted (but less so)', sum / 6 > 55 && sum / 6 < 90, (sum / 6).toFixed(1));

// 9. Newcomers bring what they learned where they grew up.
const lit = (from) => {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    const n = sim.npcs.spawn({ age: 30, occupation: 'unemployed', traits: [] });
    n.id = `test_${from}_${i}`;
    n.from = from;
    Ed.seedNewcomer(n);
    r += Ed.know(n, 'reading');
    sim.npcs.remove(n);
  }
  return r / 8;
};
check('people from a big town read better than from a hamlet', lit('market_town') > lit('pass_hold'), `${lit('market_town').toFixed(1)} vs ${lit('pass_hold').toFixed(1)}`);

// 10. Growing up: what they learned is a head start.
const grown = npcs.find((n) => n.age >= 12 && n.age < 16) || npcs.find((n) => n.age < 16);
grown.edu.know.reading = 60; grown.edu.know.maths = 55; grown.edu.know.writing = 50; grown.edu.know.carpentry = 30;
const lvl = grown.level;
Ed.grewUp(grown);
check('a well-schooled youngster starts working life ahead', grown.level > lvl + 2, `${lvl} → ${grown.level}`);

// 11. The player: skills count as knowledge.
const P = sim.state.player;
P.skills.smithing.level = 6;
check('your smithing skill counts as smithing knowledge', Ed.know(P, 'smithing') >= 50);
check('you can read', Ed.literate(P));

// 12. Statistics describe the village.
const st = Ed.stats();
check('the village has education statistics', st.literacy > 0 && st.literacy < 1 && st.adults > 0, `literacy ${(st.literacy * 100).toFixed(0)}%, skilled ${st.skilledPeople}`);

// 13. Save / load, and old saves without profiles.
const s = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(s);
check('profiles survive save / load', sim2.state.npcs.every((n) => n.edu) && sim2.education.know(sim2.npcs.byId(smith.id), 'smithing') === Ed.know(smith, 'smithing'));
const old = JSON.parse(JSON.stringify(sim.state));
for (const n of old.npcs) delete n.edu;
delete old.player.edu;
const sim3 = new Simulation(old);
check('an old save gets profiles on load', sim3.state.npcs.every((n) => n.edu?.apt?.analytic) && sim3.state.player.edu);

// 14. A season passes.
let crashed = null;
try {
  runOn(sim2)(14 * 1440);
} catch (e) {
  crashed = e;
}
check('two weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('every knowledge field is known to the data', sim2.state.npcs.every((n) => Object.keys(n.edu.know).every((k) => KNOWLEDGE[k])));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll education checks passed.');
process.exit(failures ? 1 : 0);
