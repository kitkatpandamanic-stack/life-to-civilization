// Headless test for the knowledge network: a technique worked out by one person does
// only part of its good until it spreads — through colleagues, masters and apprentices,
// families and friends, the school and the library; newcomers bring techniques in (even
// ones the valley never worked out), emigrants carry them out, settlements learn from
// each other and it changes what they make; knowing something has been done elsewhere
// speeds working it out; older saves keep what they knew; save / load.
// Usage: node tools/smoke-knowhow.mjs
import { Simulation } from '../src/core/Simulation.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 6060);
const K = sim.knowhow;
const T = sim.tech;
const npcs = sim.state.npcs;
const look = npcs[0].look;

// 1. One person works it out: it only does part of its good.
const smith = npcs.find((n) => n.occupation === 'blacksmith');
const before = T.mod('gather_output');
T.discover('better_tools', smith);
check('the one who worked it out knows it well', K.fam(smith, 'better_tools') >= 60);
const hands = K.practitioners('better_tools');
const early = K.adoption('better_tools');
check('…but few use it yet', early < 1, `${Math.round(early * 100)}% of ${hands.length}`);
T.mods = null;
const m1 = T.mod('gather_output');
check('so it does only part of its good', m1 > before && m1 < 1.15, `${before} → ${m1.toFixed(3)} (full: 1.15)`);

// 2. It spreads through the people who work together.
const helper = sim.npcs.spawn({ age: 25, occupation: 'smith_hand', employer: smith.owns, look });
const h0 = K.fam(helper, 'better_tools');
for (let w = 0; w < 6; w++) K.weekly();
check('a colleague picks it up at work', K.fam(helper, 'better_tools') > h0 + 10, `${h0} → ${K.fam(helper, 'better_tools')}`);
T.mods = null;
check('as it spreads, it does more good', T.mod('gather_output') >= m1, `${m1.toFixed(3)} → ${T.mod('gather_output').toFixed(3)}`);

// 3. Apprentices, families, friends.
const app = sim.npcs.spawn({ age: 16, occupation: 'unemployed', look });
sim.careers.start(app, smith, smith.owns, 'smithing');
K.weekly();
check('an apprentice learns it from the master', K.fam(app, 'better_tools') >= 15, K.fam(app, 'better_tools'));
const kid = sim.npcs.spawn({ age: 12, occupation: 'child', homeId: smith.homeId, kin: { parents: [smith.id], children: [], siblings: [] }, look });
K.weekly();
check('a child picks some up at home', K.fam(kid, 'better_tools') > 0);
const pal = npcs.find((n) => n.occupation === 'farmer');
sim.social.adjust(pal, smith, { f: 60 });
K.weekly();
check('a friend hears about it (but only hears)', K.fam(pal, 'better_tools') > 0 && K.fam(pal, 'better_tools') <= 12, K.fam(pal, 'better_tools'));

// 4. The school passes on general know-how.
T.discover('writing');
sim.state.village.treasury = 5000;
const site = sim.growth.start('village', 'school', 'public', { tx: 44, ty: 40 });
site.delivered = { ...site.required };
site.labor = site.laborNeeded;
sim.construction.tryComplete(site);
sim.schools.weekly();
const teacher = sim.schools.teachersOf(sim.schools.list()[0])[0];
K.teach(teacher, 'writing', 60);
const pupil = sim.schools.pupils(sim.schools.list()[0])[0] || kid;
if (!pupil.edu.enrol) sim.schools.enrol(pupil, sim.schools.list()[0], 'primary');
const w0 = K.fam(pupil, 'writing');
K.weekly();
check('the teacher passes on what they know to the pupils', K.fam(pupil, 'writing') > w0, `${w0} → ${K.fam(pupil, 'writing')}`);

// 5. A newcomer brings a technique the valley never worked out.
sim.state.settlement.built = 3;
check('the valley does not know masonry', !T.has('masonry'));
const miner = sim.npcs.spawn({ age: 30, occupation: 'unemployed', prevOccupation: 'miner', look });
miner.from = 'ironford';
miner.edu.know.mining = 40;
K.teach(miner, 'masonry', 45);
K.introduce(miner);
check('…until someone from Ironford who knows it arrives', T.has('masonry') && sim.state.chronicle.some((e) => e.key === 'chronicle.tech_introduced'));
const arrivals = [];
for (let i = 0; i < 6; i++) {
  const n = sim.npcs.spawn({ age: 30, occupation: 'unemployed', prevOccupation: 'fisher', look });
  n.from = 'lakeside';
  K.newcomer(n);
  arrivals.push(n);
}
check('newcomers bring what their town knows', arrivals.some((n) => K.fam(n, 'boats') >= 25), arrivals.map((n) => K.fam(n, 'boats')).join(','));

// 6. Emigrants carry know-how out; settlements learn from each other; it changes what they make.
const S = sim.settlements;
const wh = S.get('woodhollow');
const w1 = wh.techs.better_tools || 0;
K.teach(helper, 'better_tools', 60);
K.emigrant(helper.id, 'woodhollow');
check('someone who moves away takes the valley\'s know-how with them', (wh.techs.better_tools || 0) > w1, `${w1} → ${wh.techs.better_tools}`);
const lk = S.get('lakeside');
const lk0 = lk.techs.masonry || 0;
for (let w = 0; w < 8; w++) K.settlementsWeek();
check('settlements learn from each other', (lk.techs.masonry || 0) > lk0, `${lk0} → ${(lk.techs.masonry || 0).toFixed(2)}`);
check('a place that knows better tools makes more', K.settlementOutput('ironford', 'iron_ore') > 1.05 && K.settlementOutput('ironford', 'fish') === 1, K.settlementOutput('ironford', 'iron_ore').toFixed(3));
const ids = S.ids();
const profiles = new Set(ids.map((id) => K.knownFor(id).join(',')));
check('different places are known for different things', profiles.size >= 3, [...profiles].join(' | '));

// 7. Knowing it's been done elsewhere makes it quicker to work out.
S.makeContact('market_town', 'test');
check('a technique a trading partner uses is quicker to work out', K.imitation('printing') > 1.1, K.imitation('printing').toFixed(2));

// 8. Older saves keep what they knew.
const old = JSON.parse(JSON.stringify(sim.state));
for (const n of old.npcs) delete n.edu.tech;
const sim3 = new Simulation(old);
check('an old save\'s know-how is still used by its people', sim3.knowhow.adoption('better_tools') > 0.5, sim3.knowhow.adoption('better_tools'));

// 9. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('who knows what, and what the towns know, survive save / load', sim2.knowhow.fam(sim2.npcs.byId(smith.id), 'better_tools') === K.fam(smith, 'better_tools') && sim2.settlements.get('woodhollow').techs.better_tools === wh.techs.better_tools);
let crashed = null;
try {
  const end = sim2.time.total + 21 * 1440;
  while (sim2.time.total < end) sim2.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll know-how checks passed.');
process.exit(failures ? 1 : 0);
