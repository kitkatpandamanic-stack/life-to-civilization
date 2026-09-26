// Headless test for the valley's history in numbers (HistorySystem samples → the journal's charts):
//   a line in the record each week (people, your money and worth, businesses, treasury, bread, workers);
//   an old save starts its record when loaded; the big moments of the new upgrades (a story's ending,
//   the railway, a rival) go in the history book; the chart draws; saved.
// Usage: node tools/smoke-history.mjs
import { Simulation } from '../src/core/Simulation.js';
import { lineChart } from '../src/ui/charts.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(4000);
};

const sim = Simulation.newGame('T', 9991);
runOn(sim)(22 * 1440);
const S = sim.history.samples();
check('A line in the record each week', S.length >= 3 && S.length <= 5, `${S.length} weeks`);
const row = S[S.length - 1];
check('…people, your money and worth, businesses, the treasury, bread, your workers', ['pop', 'money', 'worth', 'biz', 'treasury', 'bread', 'workers', 'status'].every((k) => typeof row[k] === 'number'));
const r0 = rand.getState();
sim.history.sample(true);
check('Keeping the record rolls no dice', rand.getState() === r0);
const old = JSON.parse(JSON.stringify(sim.state));
delete old.history.samples;
const oldSim = new Simulation(old);
check('An old save starts its record when loaded', oldSim.history.samples().length === 1);
sim.chronicle('story.feud.end.peace', { npc_a: sim.state.npcs[0].id, npc_b: sim.state.npcs[1].id });
sim.chronicle('chronicle.railway_opened', { settlement: 'woodhollow', n: 1 });
check('A story\'s ending and the railway go in the history book', sim.history.H.entries.some((e) => e.key === 'story.feud.end.peace') && sim.history.H.entries.some((e) => e.key === 'chronicle.railway_opened'));
const svg = lineChart(S.map((s) => ({ x: s.d, y: s.pop })), { marks: [{ x: S[1].d, label: 'x' }] });
check('The chart draws (a line, the moments marked)', svg.startsWith('<svg') && svg.includes('chart-line') && svg.includes('chart-mark'));
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('The record is saved', copy.history.samples().length === sim.history.samples().length);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll history checks passed');
process.exit(failures ? 1 : 0);
