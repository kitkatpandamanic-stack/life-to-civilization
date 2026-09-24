// Headless test for natural resources: forests thin and regrow, deposits run out,
// fish and game populations respond to use, discoveries appear.
// Usage: node tools/smoke-nature.mjs [years]
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

// 1. The forest over several years of logging.
{
  const sim = Simulation.newGame('T', 31337);
  const N = sim.nature;
  const start = N.treeCount();
  const woodBefore = sim.state.stats.treesChopped;
  let felled = 0;
  sim.bus.on('nature:felled', () => felled++);
  const t0 = Date.now();
  const yard = sim.economy.buildingOf('lumberyard');
  const nearYard = () => Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'grown' && Math.abs(o.tx - yard.door.tx) + Math.abs(o.ty - yard.door.ty) <= 32).length;
  const yardStart = nearYard();
  let yardMin = yardStart;
  let yardRev = 0;
  sim.bus.on('time:day', () => {
    yardMin = Math.min(yardMin, nearYard());
    yardRev += sim.economy.biz('lumberyard').history.at(-1)?.rev || 0;
  });
  runOn(sim)(years * 56 * 1440);
  const snaps = sim.state.nature.snapshots;
  const trees = N.treeCount();
  const growing = N.treeCount((s) => s === 'sapling' || s === 'young');
  console.log(`  ${years} years in ${((Date.now() - t0) / 1000).toFixed(1)}s; trees ${start} → ${trees}, growing ${growing}, felled ${felled}`);
  console.log('  snapshots:', snaps.filter((_, i) => i % 8 === 0).map((s) => `d${s.day}:${s.trees}t/${s.young}y/${s.fish}f/${Math.round(s.deer)}d`).join(' '));
  check('woodcutters felled trees', felled > 50, String(felled));
  check('the woods near the lumberyard thinned under the axe', yardMin < yardStart * 0.7, `${yardStart} → low of ${yardMin}, now ${nearYard()}`);
  check('the forest stays near its natural size overall', trees <= start * 1.1, `${start} → ${trees}`);
  check('the forest is regrowing (saplings and young trees)', growing > 10, String(growing));
  check('the forest is not wiped out', trees > start * 0.2, String(trees));
  check('wildlife follows the forest', Math.abs(sim.state.nature.wildlife.deer.cap - Math.max(4, trees * 0.12)) < 1);
  const ore = N.reserveLeft();
  check('ore reserves are finite and being used', ore.stone < 102 * 55, JSON.stringify(ore));
  check('the lumberyard kept trading through the years', yardRev > 500 && sim.enterprise.books('lumberyard', 14).rev > 0, `total ${yardRev}, last 14 days ${sim.enterprise.books('lumberyard', 14).rev}`);
}

// 2. Overfishing and recovery.
{
  const sim = Simulation.newGame('T', 7);
  const N = sim.nature;
  const f = sim.state.nature.fish.river;
  const before = N.fishChance('river');
  let caught = 0;
  for (let i = 0; i < 2000 && f.pop > 40; i++) caught += N.catchFish(74, 30);
  const after = N.fishChance('river');
  check('overfishing empties the river', f.pop <= 40 && after < before, `caught ${caught}, chance ${before.toFixed(2)} → ${after.toFixed(2)}`);
  const low = f.pop;
  runOn(sim)(40 * 1440);
  check('fish breed back when left alone', f.pop > low + 20, `${Math.round(low)} → ${Math.round(f.pop)}`);
}

// 3. Mining out a deposit, and a discovery.
{
  const sim = Simulation.newGame('T', 9);
  const rock = Object.values(sim.state.objects).find((o) => o.kind === 'rock' && o.variant === 'iron');
  let got = 0;
  for (let i = 0; i < 100 && rock.state !== 'depleted'; i++) {
    rock.state = 'full';
    got += sim.resources.mineRock(rock.id).qty;
  }
  check('a seam runs dry', rock.state === 'depleted', `yielded ${got}`);
  sim.resources.dailyTick();
  check('a worked-out seam never comes back', rock.state === 'depleted');
  const found = sim.nature.discoverVein('iron');
  check('new deposits can be discovered', !!found && sim.state.chronicle.some((e) => e.key === 'chronicle.deposit_found'));
}

// 4. Hunting thins the herds.
{
  const sim = Simulation.newGame('T', 5);
  const W = sim.state.nature.wildlife.deer;
  const before = W.pop;
  for (let i = 0; i < 10; i++) sim.nature.hunted('deer');
  check('hunting reduces the deer population', W.pop <= before - 10 + 0.001);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
