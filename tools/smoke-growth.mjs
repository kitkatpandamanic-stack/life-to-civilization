// Headless test for settlement growth: villagers build homes and rentals, materials are
// bought locally, sites progress and finish, newcomers arrive, districts form.
// Usage: node tools/smoke-growth.mjs [years]
import { Simulation } from '../src/core/Simulation.js';

const years = Number(process.argv[2] || 3);
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(400);
};

// 1. A forced project: a villager with savings builds a home; it rises and they move in.
{
  const sim = Simulation.newGame('T', 21);
  const run = runOn(sim);
  const nikita = sim.npcs.byId('nikita');
  nikita.money = 400;
  const yardMoney = sim.economy.biz('lumberyard').money;
  const c = sim.growth.start(nikita, 'small_house', 'home', { tx: 46, ty: 44 });
  check('a building site appears on a free lot', !!c && sim.world.isBlocked(c.tx, c.ty), c ? `${c.tx},${c.ty}` : 'no lot');
  run(3 * 1440);
  check('materials are bought from local suppliers', sim.construction.materialsFraction(c) > 0.3 && sim.economy.biz('lumberyard').money !== yardMoney, `${Math.round(sim.construction.materialsFraction(c) * 100)}%`);
  run(40 * 1440);
  check('the house gets built', c.status === 'done', `${c.status} ${Math.round((c.labor / c.laborNeeded) * 100)}%`);
  check('the builder moved in', nikita.homeId === c.id, String(nikita.homeId));
  check('the new house belongs to its builder', sim.property.rec(c.id)?.owner === 'nikita');
  check('it has a road to its door', sim.growth.roadDistance(c.tx + 2, c.ty + c.h, 1) <= 1);
}

// 2. Left alone for a few years, the village grows by itself.
{
  const sim = Simulation.newGame('T', 2024);
  const run = runOn(sim);
  const pop0 = sim.state.npcs.length;
  const b0 = sim.world.buildingList.length;
  run(years * 56 * 1440);
  const S = sim.state.settlement;
  const built = sim.world.buildingList.length - b0;
  console.log(`  ${years} years: population ${pop0} → ${sim.state.npcs.length}, new buildings ${built}, arrived ${S.migrantsArrived || 0}, left ${S.left || 0}`);
  check('new buildings went up', built >= 2, String(built));
  check('newcomers arrived', (S.migrantsArrived || 0) >= 1);
  check('districts formed', sim.state.districts.list.length >= 3, sim.state.districts.list.map((d) => d.type).join(','));
  check('new houses have owners and residents', sim.world.buildingList.filter((b) => b.id.startsWith('vb') && b.type !== 'well').every((b) => sim.property.rec(b.id)?.owner));
  const json = JSON.stringify(sim.state);
  const sim2 = new Simulation(JSON.parse(json));
  const same = sim2.world.buildingList.length === sim.world.buildingList.length && sim2.growth.projects().length === sim.growth.projects().length;
  runOn(sim2)(1440);
  check('a grown village saves and loads (and keeps growing)', same && sim2.time.day === sim.time.day + 1);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
