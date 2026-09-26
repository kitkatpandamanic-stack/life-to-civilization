// Performance check: how long the simulation takes to run, per game day (headless, no drawing).
// A small valley (as it starts) and a busy one (hired crews, orders, a grown village).
// Usage: node tools/bench.mjs            (add --prof and run with node --cpu-prof for a profile)
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';

const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

function bench(label, sim, days) {
  const run = runOn(sim);
  const t0 = performance.now();
  run(days * 24 * 60);
  const ms = performance.now() - t0;
  console.log(`${label}: ${(ms / days).toFixed(0)} ms per game day (${days} days, ${sim.state.npcs.length} villagers, ${sim.workers.list().length} workers)`);
  return ms / days;
}

const small = Simulation.newGame('T', 9001);
bench('A new valley', small, 5);

const busy = Simulation.newGame('T', 9002);
busy.state.player.money = 50000;
busy.progression.addXp(30000);
busy.state.player.skills.construction.level = 8;
const tr = transportTools({ sim: busy });
tr.build('warehouse_bld');
busy.home.store('wood', 300, { force: true });
busy.home.store('stone', 200, { force: true });
busy.home.store('planks', 100, { force: true });
const look = busy.state.npcs[0].look;
for (let i = 0; i < 8; i++) {
  const n = busy.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
  n.met = true;
  busy.workers.hire(n, 16);
}
for (let i = 0; i < 12; i++) busy.npcs.spawn({ age: 20 + i * 3, occupation: 'unemployed', look, money: 60 });
for (let i = 0; i < 3; i++) busy.equipment.lend(busy.equipment.create('wheelbarrow').id, busy.workers.list()[i].npcId);
busy.workers.addOrder({ kind: 'keep', item: 'wood', from: 'gather', to: 'store', qty: 400 });
busy.workers.addOrder({ kind: 'keep', item: 'stone', from: 'gather', to: 'store', qty: 300 });
bench('A busy valley', busy, 5);
