// Headless test for exploration in the valley: discovery sites (unknown → discovered →
// explored → developed), outposts that become real businesses with a track to the roads,
// hunters and miners at work, a hamlet growing round an outpost, save / load.
// Usage: node tools/smoke-sites.mjs
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
const finish = (sim, c) => {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
};

const sim = Simulation.newGame('T', 801);
const run = runOn(sim);
const X = sim.exploration;
const p = sim.state.player;
const sites = sim.state.exploration.sites;

// 1. The valley has places to find.
check('the valley holds discovery sites', sites.length >= 8, sites.map((s) => s.kind).join(','));
check('they are the same for the same world', JSON.stringify(Simulation.newGame('U', 801).state.exploration.sites) === JSON.stringify(sites));
check('all unknown at first', sites.every((s) => s.state === 'unknown'));
check('they stand on solid ground (you walk round them)', sites.every((s) => sim.world.isBlocked(s.tx, s.ty)));

// 2. Walking out there discovers them.
const cave = sites.find((s) => s.kind === 'cave');
X.revealAround(cave.tx, cave.ty + 3);
check('walking near a site discovers it', cave.state === 'discovered');

// 3. Exploring it.
p.energy = 100;
p.health = 100;
const k0 = sim.state.knowledge.points;
const r = X.exploreSite(cave.id);
check('exploring a cave finds things', r.ok && cave.state === 'explored', JSON.stringify(r.found));
check('…adds to what the village knows', sim.state.knowledge.points > k0);
check('…and trains exploration', p.skills.exploration.xp > 0 || p.skills.exploration.level > 0);
check('you cannot explore it twice', !X.exploreSite(cave.id).ok);

// 4. An outpost: a mining camp by the cave.
p.money = 3000;
check('outposts need construction know-how', !X.canFoundOutpost(cave).ok);
p.level = 8;
const f = X.foundOutpost(cave.id);
check('you can found a mining camp there', f.ok && f.site?.type === 'mining_camp', JSON.stringify(f.ok ? f.site.type : f));
check('only beside the site, not on any old ground', !sim.construction.canPlace('mining_camp', 10, 60).ok);
const roads0 = sim.state.land.roads.length;
finish(sim, f.site);
check('when built, it is developed', cave.state === 'developed');
const camp = sim.economy.businessAtBuilding(f.site.id);
check('it opens as your business', !!camp && sim.economy.biz(camp).owner === 'player' && sim.economy.def(camp).type === 'mining_camp');
check('a track links it to the roads', sim.state.land.roads.length > roads0, `+${sim.state.land.roads.length - roads0} tiles`);
sim.holdings.setWageLevel(camp, 1.6);
sim.holdings.setStaffTarget(camp, 3);
sim.holdings.deposit(camp, 600); // wages need money in the till
run(16 * 1440);
check('miners come to work there', sim.npcs.staffOf(camp).length >= 1, `${sim.npcs.staffOf(camp).length}`);
const got = ['stone', 'coal', 'iron_ore', 'gemstone'].reduce((s, i) => s + sim.economy.stock(camp, i), 0) + sim.enterprise.books(camp, 7).rev;
check('…and bring in stone and ore', got > 0, `${got}`);

// 5. A hunting cabin in the woods.
const cabin = sites.find((s) => s.kind === 'cabin');
X.revealAround(cabin.tx, cabin.ty + 3);
p.energy = 100;
X.exploreSite(cabin.id);
const h = X.foundOutpost(cabin.id);
check('an abandoned cabin can become a hunting cabin', h.ok);
if (h.ok) {
  finish(sim, h.site);
  const lodge = sim.economy.businessAtBuilding(h.site.id);
  sim.holdings.setWageLevel(lodge, 1.6);
  sim.holdings.deposit(lodge, 500);
  run(16 * 1440);
  const meat = sim.economy.stock(lodge, 'meat') + sim.enterprise.books(lodge, 7).rev;
  check('hunters bring in game', sim.npcs.staffOf(lodge).length >= 1 && meat > 0, `${sim.npcs.staffOf(lodge).length} hunters, ${meat}`);
}

// 6. A hamlet grows round an outpost.
// Three households (not one family moving house three times).
const builders = [];
for (const n of sim.state.npcs) if (n.age >= 20 && !n.owns && !builders.some((b) => b.homeId === n.homeId || b.family.includes(n.id))) builders.push(n);
builders.length = Math.min(3, builders.length);
let built = 0;
for (const n of builders) {
  n.money += 1500;
  const c = sim.growth.start(n, 'small_house', 'home', { tx: cave.tx, ty: cave.ty + 4 });
  if (c) {
    finish(sim, c);
    built++;
  }
}
X.hamlets();
check('homes round an outpost make a hamlet', built >= 3 && sim.state.exploration.hamlets.length >= 1, `${built} homes`);
check('…remembered in history', sim.state.history.entries.some((e) => e.key === 'chronicle.hamlet_founded'));

// 7. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('sites and outposts survive save / load', sim2.state.exploration.sites.find((s) => s.id === cave.id).state === 'developed' && sim2.world.isBlocked(cave.tx, cave.ty));
runOn(sim2)(2 * 1440);
check('the world runs on', sim2.time.day > sim.time.day);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
