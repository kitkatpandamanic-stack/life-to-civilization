// Headless test for exploration: expeditions beyond the valley (supplies, companions,
// days passing while the village carries on, finds and dangers, new regions),
// villagers exploring on their own, trading partners, settlers, fog of war, save / load.
// Usage: node tools/smoke-explore.mjs
import { Simulation } from '../src/core/Simulation.js';
import { REGIONS } from '../src/data/regions.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

// 1. Planning and setting out.
const sim = Simulation.newGame('T', 301);
const run = runOn(sim);
const E = sim.exploration;
const p = sim.state.player;
check('two regions are known at the start', E.known().length === 2, E.known().join(','));
check('the waymark exists', sim.world.decor.some((d) => d.interact === 'expedition'));
check('not enough food, no expedition', !E.canSetOut('north_pass').ok && E.canSetOut('north_pass').reason === 'need_food');
sim.inventory.add('bread', 12, { force: true });
p.money = 200;
const friends = sim.state.npcs.filter((n) => n.age >= 18 && n.age < 60 && !n.owns).slice(0, 2);
for (const n of friends) {
  n.met = true;
  n.rel = 60;
}
check('friends can come along', E.candidates().length >= 2);
const ids = friends.map((n) => n.id);
check('ready to set out with companions', E.canSetOut('north_pass', ids).ok, JSON.stringify(E.canSetOut('north_pass', ids)));
let departed = null;
let returned = null;
sim.bus.on('expedition:departed', (t) => (departed = t));
sim.bus.on('expedition:returned', (r) => (returned = r));
const breadBefore = sim.inventory.count('bread');
const day0 = sim.time.day;
const res = E.setOut('north_pass', ids);
check('you set out', res.ok && !!departed && !!p.away, `${res.days} days`);
check('food was packed for the road', sim.inventory.count('bread') === breadBefore - E.foodNeeded('north_pass', 2), `${breadBefore}→${sim.inventory.count('bread')}`);
check('companions left the valley with you', friends.every((n) => n.away && n.inside === 'away'));
const hunger = p.hunger;
run(res.days * 1440 + 30);
check('you come home after the journey', !!returned && !p.away && sim.time.day - day0 >= res.days, `${sim.time.day - day0} days`);
check('you did not starve on the road', p.hunger >= Math.min(45, hunger));
check('companions are back too', friends.every((n) => !n.away && n.inside !== 'away' || !sim.npcs.byId(n.id)));
check('the region got explored', E.region('north_pass').explored > 0, `${E.region('north_pass').explored}%`);
check('the village carried on without you', sim.state.chronicle.some((e) => e.day > day0 && !e.key.includes('exp')));
check('companions remember the trip', friends.some((n) => n.memories?.some((m) => m.k === 'explored_with_player')));
check('a report for the UI', returned && Array.isArray(returned.finds) && returned.region === 'north_pass');

// 2. Many expeditions: finds of every kind, new regions revealed.
const kinds = new Set();
const revealed = new Set();
let partner = false;
for (let i = 0; i < 40; i++) {
  const known = E.known();
  const target = known[i % known.length];
  const r = E.explore(target, { player: true, companions: [] });
  r.finds.forEach((f) => kinds.add(f.kind));
  r.revealed.forEach((x) => revealed.add(x));
  if (r.finds.some((f) => f.kind === 'partner')) partner = true;
  p.health = 100;
}
check('expeditions find many kinds of things', kinds.size >= 5, [...kinds].join(','));
check('exploring reveals new regions', revealed.size >= 3, [...revealed].join(','));
check('all regions can eventually be reached', E.known().length === Object.keys(REGIONS).length, `${E.known().length}/${Object.keys(REGIONS).length}`);
check('ore finds become real outcrops in the valley', Object.values(sim.state.objects).some((o) => o.kind === 'rock' && o.reserve > 0));
check('ruins add to the village\'s knowledge', sim.state.knowledge.points > 0, sim.state.knowledge.points);
if (partner) check('trading partners raise export prices', E.tradeFactor() > 1, E.tradeFactor().toFixed(2));
const pop = sim.state.npcs.length;
E.E.pending.push({ day: sim.time.day, kind: 'settlers', region: 'lake_country' });
E.onDay();
check('settlers who heard of the village arrive', sim.state.npcs.length > pop, `${pop}→${sim.state.npcs.length}`);
check('history records the discoveries', sim.state.history.entries.some((e) => e.key === 'chronicle.region_discovered'));

// 3. Villagers explore on their own.
for (const id of E.known()) E.region(id).explored = 30;
let npcTrips = 0;
for (let i = 0; i < 6; i++) if (E.npcSetsOut()) npcTrips++;
check('adventurous villagers set out', npcTrips >= 1 && E.E.npcTrips.length >= 1);
const explorers = E.E.npcTrips.map((tp) => tp.npc);
run(12 * 1440);
const backs = sim.state.chronicle.filter((e) => /npc_expedition_(back|empty)/.test(e.key)).map((e) => e.params.npc);
check('…and come back', explorers.every((id) => backs.includes(id) || !sim.npcs.byId(id)), backs.join(','));
check('their trips are news', sim.state.chronicle.some((e) => e.key.startsWith('chronicle.npc_expedition_back') || e.key.startsWith('chronicle.npc_expedition_empty')));

// 4. Fog of war.
const before = E.valleyExplored();
check('only part of the valley is mapped at first', before > 0 && before < 0.6, `${Math.round(before * 100)}%`);
E.revealAround(100, 20);
E.revealAround(10, 80);
check('walking reveals the map', E.valleyExplored() > before, `${Math.round(E.valleyExplored() * 100)}%`);

// 5. Save / load, mid-expedition.
sim.inventory.add('bread', 10, { force: true });
p.health = 100;
p.hunger = 100;
const out = E.setOut('old_forest', []);
check('set out again', out.ok, JSON.stringify(out));
const saved = JSON.parse(JSON.stringify(sim.state));
rand.setState(saved.rngState ?? 1);
const sim2 = Simulation.fromState ? Simulation.fromState(saved) : new Simulation(saved);
check('an expedition in progress survives save / load', !!sim2.state.exploration.trip && sim2.state.player.away);
check('the fog of war survives save / load', sim2.exploration.valleyExplored() === E.valleyExplored());
runOn(sim2)(3 * 1440);
check('…and still comes home', !sim2.state.exploration.trip && !sim2.state.player.away);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
