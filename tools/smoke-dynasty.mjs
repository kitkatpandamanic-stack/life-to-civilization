// Headless test for the dynasty (DynastySystem, on top of LineageSystem):
//   raising   — an hour a day with each child: teach a skill you know, take them to work (→ a hard worker), play
//   the heir  — name one (they come first at succession); grown children train (at your side, or running a shop)
//   alliances — marry a grown child into a family that likes you (a gift, a wedding, an alliance: cheaper
//               shops, votes); families propose matches too — turning one down makes an enemy
//   inherits  — skills taught at home, your allies' goodwill, and your enemies' grudges
//   and       — saving, old saves, no dice
// Usage: node tools/smoke-dynasty.mjs
import { Simulation } from '../src/core/Simulation.js';
import { DYNASTY } from '../src/systems/DynastySystem.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 7301);
const D = sim.dynasty;
const L = sim.lineage;
const p = sim.state.player;
p.money = 5000;
p.skills.construction.level = 3;
p.skills.trading.level = 4;
const nextDay = () => (sim.state.time.totalMinutes += 1440);

// Two children: one young, one grown.
const kid = L.birth();
const elder = L.birth();
kid.age = 10;
elder.age = 19;
check('Your children are yours', !!D.mine(kid.id) && !!D.mine(elder.id));

// ---- raising
const r0 = rand.getState();
const a = D.spend(kid.id, 'teach', 'construction');
check('An hour teaching a skill you know', a.ok && D.up(kid.id).pts.construction > 0, JSON.stringify(a));
check('…once a day', D.canSpend(kid.id, 'play').reason === 'child_done_today');
check("…and only a skill you know well enough", D.canSpend(kid.id, 'teach', 'fishing').reason === 'child_done_today' || D.canSpend(kid.id, 'teach', 'fishing').reason === 'cant_teach_skill');
nextDay();
check("You can't teach what you don't know", D.canSpend(kid.id, 'teach', 'fishing').reason === 'cant_teach_skill');
for (let i = 0; i < DYNASTY.workTraitAt; i++) {
  nextDay();
  p.energy = 100;
  D.spend(kid.id, 'work');
}
check('Days at work with you: a hard worker', kid.traits.includes('hard_worker'));
for (let i = 0; i < 12; i++) {
  nextDay();
  p.energy = 100;
  D.spend(kid.id, 'teach', 'construction');
}
const bonus = D.bonusLevels(kid.id);
check('What they learned becomes skill levels for later', (bonus.construction || 0) >= 1, JSON.stringify(bonus));
check('Nothing about it rolls the dice', rand.getState() === r0);

// ---- the heir, and training
kid.age = 15;
check('The eldest would carry on…', L.heirs()[0] === elder);
D.setHeir(kid.id);
check('…unless you name another heir', L.heirs()[0] === kid);
check('A child too young for a role', D.canSetRole(kid.id, 'shadow').reason === 'child_too_young');
D.setRole(elder.id, 'shadow');
const lvl0 = elder.level;
const ready0 = D.readiness(elder.id);
for (let i = 0; i < 30; i++) D.trainDay();
check('Training at your side: experience and your trade', elder.level > lvl0 && (D.up(elder.id).pts[D.bestSkill()] || 0) > 0, `lv ${lvl0} → ${elder.level}`);
check('…and they get readier to take over', D.readiness(elder.id) > ready0, `${ready0} → ${D.readiness(elder.id)}`);

// ---- alliances
const matches = D.matchesFor(elder.id);
check('Grown children have matches in the valley', matches.length > 0, `${matches.length}`);
const m = matches[0];
m.head.rel = 20;
check("A family that doesn't know you well won't hear of it", D.canArrange(elder.id, m.npc.id).reason === 'family_not_close');
m.head.rel = 95;
const money0 = p.money;
const res = D.arrange(elder.id, m.npc.id);
check('They say yes: a wedding (with a gift to their family)', res.ok && res.accepted && elder.kin.spouse === m.npc.id && p.money < money0, JSON.stringify(res));
check('…and the families are allied', D.allied(m.head) && D.allied(m.npc));
check("Allied families' shops are cheaper, and they vote for you", D.allyDiscount(m.head) > 0 && D.allyVote(m.head) > 0);

// A family proposes a match for your other grown child.
const third = L.birth();
third.age = 20;
for (const { head } of D.matchesFor(third.id)) head.rel = Math.max(head.rel || 0, 40);
let offer = null;
for (let w = 0; w < 30 && !offer; w++) {
  for (let d = 0; d < 7; d++) nextDay();
  D.proposals();
  offer = sim.state.dynasty.offers[0];
}
check('A family proposes a match', !!offer, offer ? `${offer.head} for ${offer.child}` : '');
if (offer) {
  const head = sim.npcs.byId(offer.head);
  const rel0 = head.rel;
  D.answer(offer.id, false);
  check('Turning them down makes them cooler to you (and they remember)', head.rel < rel0 && sim.state.dynasty.snubbed[head.id] !== undefined, `${rel0} → ${head.rel}`);
}

// ---- succession: what the heir inherits
const enemy = sim.state.npcs.find((n) => n.age >= 20 && !D.allied(n) && !p.children.includes(n.id));
enemy.rel = -70;
const ally = m.head;
ally.rel = 90;
const plainNpc = sim.state.npcs.find((n) => n !== enemy && !D.allied(n) && !p.children.includes(n.id) && n.age >= 20);
plainNpc.rel = 60;
const heirBonus = D.bonusLevels(kid.id);
const skill0 = Math.floor(p.skills.construction.level * 0.4);
p.age = 60;
kid.age = 17;
const out = L.succeed('retired', kid);
check('Your named heir carries on', out.inherited && p.generation === 2);
check('…with the skill you taught them at home', p.skills.construction.level >= skill0 + (heirBonus.construction || 0), `construction ${p.skills.construction.level}`);
check('Your enemies stay enemies', enemy.rel <= -50 && sim.state.dynasty.feuds.includes(enemy.id), `rel ${enemy.rel}`);
check('Your allies stay close', ally.rel >= 75, `rel ${ally.rel}`);
check('Everyone else starts cooler (as before)', plainNpc.rel < 60, `rel ${plainNpc.rel}`);

// ---- saved
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('The dynasty is saved', copy.state.dynasty.alliances.length === sim.state.dynasty.alliances.length && copy.dynasty.allied(copy.npcs.byId(ally.id)));
const old = JSON.parse(JSON.stringify(sim.state));
delete old.dynasty;
check('An old save (from before) loads', new Simulation(old).dynasty.D.alliances.length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll dynasty checks passed');
process.exit(failures ? 1 : 0);
