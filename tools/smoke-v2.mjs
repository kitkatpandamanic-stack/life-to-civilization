// Headless smoke test for V2 systems: land, construction, farming, workers.
// Runs the real simulation (no graphics) and checks that things actually happen.
// Usage: node tools/smoke-v2.mjs
import { Simulation } from '../src/core/Simulation.js';

const sim = Simulation.newGame('Tester', 4242);
const p = sim.state.player;
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const run = (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(200);
};

// Progress the player to where V2 features unlock.
while (p.level < 10) sim.progression.addXp(sim.progression.xpForNext() - p.xp + 1);
p.money = 3000;
p.attributes.leadership = 6; // enough to manage several workers
p.skills.construction.level = 3; // the workshop needs Construction 2
check('level 10 reached', p.level === 10);
check('can manage 3+ workers', sim.workers.maxWorkers() >= 3, String(sim.workers.maxWorkers()));

// Land
check('buy land', sim.land.buy('riverside', { anywhere: true }));
check('owns tile', sim.land.ownsTile(80, 50));

// Construction: storage shed placed, materials in the chest for workers to haul
const shed = sim.construction.place('storage_shed', 84, 51);
check('storage shed site placed', !!shed, shed ? shed.id : '');
sim.home.store('wood', 40, { force: true });
sim.home.store('planks', 10, { force: true });

// Workers: hire two villagers
const cand = sim.state.npcs.filter((n) => n.age >= 16 && !n.owns && n.occupation !== 'elder').slice(0, 2);
for (const n of cand) {
  n.met = true;
  const r = sim.workers.offer(n, sim.workers.expectedSalary(n) + 5);
  check(`hire ${n.id}`, r.accepted, r.reason || '');
}
const [builder, gatherer] = cand;
sim.workers.assign(builder.id, { type: 'build', siteId: shed.id });
sim.workers.assign(gatherer.id, { type: 'gather_wood' });

// Farming (player) — a few tiles
sim.inventory.add('hoe', 1);
sim.inventory.add('carrot_seeds', 4);
sim.inventory.add('watering_can', 1);
let planted = 0;
for (let x = 80; x < 84; x++) {
  if (sim.farming.perform('till', x, 56) && sim.farming.perform('plant', x, 56, 'carrot_seeds')) planted++;
}
check('planted carrots', planted === 4, `${planted}/4`);

const wood0 = sim.home.storageCount('wood');
run(3 * 1440);

check('shed received materials', sim.construction.materialsFraction(shed) > 0, `${Math.round(sim.construction.materialsFraction(shed) * 100)}%`);
check('shed labor progressed', shed.labor > 0, `${Math.round(shed.labor)}/${shed.laborNeeded}`);
check('shed finished', shed.status === 'done', shed.status);
const woodNow = sim.home.storageCount('wood');
check('gatherer brought wood', sim.state.stats.workerGoods > 0, `delivered ${sim.state.stats.workerGoods || 0}, chest wood ${wood0}→${woodNow}`);
check('workers were paid', builder.money > 0 && sim.workers.contract(gatherer.id)?.daysWorked > 0, `builder $${builder.money}`);
const f = sim.state.fields['80,56'];
check('carrots grew (rain or dry growth)', f.growth > 0 || f.dead, `growth ${f.growth?.toFixed(2)}`);
check('extra storage from shed', sim.home.storageCapacity() > 40, `${sim.home.storageCapacity()} kg`);

// Business: build a workshop (materials in the chest), staff it, feed it wood, let customers come.
sim.home.store('wood', 60, { force: true });
sim.home.store('stone', 30, { force: true });
sim.home.store('planks', 20, { force: true });
check('buy a second plot', sim.land.buy('east_meadow', { anywhere: true }));
const ws = sim.construction.place('workshop', 90, 51);
check('workshop site placed', !!ws, ws ? '' : JSON.stringify(sim.construction.canPlace('workshop', 90, 51)));
if (ws) {
  sim.workers.assign(builder.id, { type: 'build', siteId: ws.id });
  run(5 * 1440);
  check('workshop finished', ws.status === 'done', `${ws.status} labor ${Math.round(ws.labor)}/${ws.laborNeeded}`);
  const biz = sim.businesses.atBuilding(ws.id);
  check('business created', !!biz);
  if (biz) {
    sim.home.store('wood', 80, { force: true });
    sim.workers.assign(builder.id, { type: 'workshop', bizId: biz.id });
    sim.workers.assign(gatherer.id, { type: 'workshop', bizId: biz.id });
    const money0 = p.money;
    run(6 * 1440);
    const made = Object.entries(biz.stock).map(([k, v]) => `${k}:${v}`).join(' ');
    check('workshop produced goods', biz.totalRevenue > 0 || Object.keys(biz.stock).some((k) => k !== 'wood' && biz.stock[k] > 0), made);
    check('business earned revenue', biz.totalRevenue > 0, `revenue $${biz.totalRevenue}, history ${JSON.stringify(biz.history.slice(-3))}`);
    console.log(`  player money ${money0} → ${p.money}`);
  }
}

// Worker satisfaction stays sensible
for (const c of sim.workers.list()) check(`satisfaction of ${c.npcId} in range`, c.satisfaction >= 0 && c.satisfaction <= 100, String(c.satisfaction));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
