// Headless simulation test: runs the game world without graphics for N days
// and prints what happened. Useful for balancing and catching logic errors.
// Usage: node tools/simulate.mjs [days]
import { Simulation } from '../src/core/Simulation.js';

const days = Number(process.argv[2] || 20);
const sim = Simulation.newGame('Tester', 12345);
const errors = [];
sim.bus.on('toast', () => {});

const start = Date.now();
const FRAME = 50; // ms per simulated frame
let frames = 0;
const targetMinutes = sim.time.total + days * 1440;
try {
  while (sim.time.total < targetMinutes) {
    sim.update(FRAME * 4); // 4× speed per step keeps NPC walking realistic
    frames++;
  }
} catch (e) {
  errors.push(e);
}

const B = sim.state.businesses;
console.log(`Simulated ${days} days in ${((Date.now() - start) / 1000).toFixed(1)}s (${frames} frames). Day ${sim.time.day}, ${sim.time.season}, weather ${sim.weather.type}`);
console.log('\nBusinesses:');
for (const [id, b] of Object.entries(B)) console.log(`  ${id.padEnd(11)} $${String(Math.round(b.money)).padStart(5)}  ${JSON.stringify(b.stock)}`);
console.log('\nVillagers:');
for (const n of sim.state.npcs) {
  const tile = sim.world.toTile(n.x, n.y);
  const stuck = !n.inside && sim.world.isBlocked(tile.tx, tile.ty) ? ' [ON BLOCKED TILE]' : '';
  console.log(`  ${n.id.padEnd(8)} ${n.occupation.padEnd(15)} lvl ${n.level} $${Math.round(n.money).toString().padStart(4)} hun ${Math.round(n.hunger).toString().padStart(3)} en ${Math.round(n.energy).toString().padStart(3)} hp ${Math.round(n.health).toString().padStart(3)} mood ${String(n.mood).padStart(3)} pantry ${n.pantry} task ${n.task?.type}/${n.task?.stage} ${n.inside ? `inside ${n.inside}` : 'outside'}${stuck}`);
}
const stumps = Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'stump').length;
const rubble = Object.values(sim.state.objects).filter((o) => o.kind === 'rock' && o.state === 'rubble').length;
console.log(`\nTrees felled (currently stumps): ${stumps}, rocks mined (rubble): ${rubble}, ripe crops: ${sim.resources.countRipeCrops()}`);
console.log(`Store prices: bread x${sim.economy.priceFactor('store', 'bread').toFixed(2)}, wood x${sim.economy.priceFactor('store', 'wood').toFixed(2)}`);
console.log(`Job openings today: ${JSON.stringify(sim.state.jobs.openings)}`);
console.log(`Requests: ${JSON.stringify(sim.state.jobs.requests)}`);
console.log('\nChronicle:');
for (const e of sim.state.chronicle) console.log(`  day ${e.day}: ${e.key} ${JSON.stringify(e.params)}`);
if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(e);
  process.exit(1);
}
