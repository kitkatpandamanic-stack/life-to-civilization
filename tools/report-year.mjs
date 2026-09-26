// Balance report: runs a year (56 days) in a few valleys (different seeds) with nobody interfering,
// and prints the village week by week — people, money, homes, work, businesses, prices — then
// warnings for anything that looks out of balance.
// Usage: node tools/report-year.mjs [seeds=3] [days=56]
import { Simulation } from '../src/core/Simulation.js';
import { snapshot, warnings } from '../src/debug/reportTools.js';

const seeds = Number(process.argv[2] || 3);
const days = Number(process.argv[3] || 56);
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(4000);
};
const all = [];
for (let k = 0; k < seeds; k++) {
  const sim = Simulation.newGame('T', 4200 + k);
  const run = runOn(sim);
  const rows = [snapshot(sim)];
  for (let d = 7; d <= days; d += 7) {
    run(7 * 24 * 60);
    rows.push(snapshot(sim));
  }
  console.log(`\nValley ${4200 + k}`);
  console.log('day  pop adult homeless jobless avg$  poor$  biz closed treasury bread wood planks bricks techs status');
  for (const r of rows) console.log(`${String(r.day).padStart(3)} ${String(r.pop).padStart(4)} ${String(r.adults).padStart(5)} ${String(r.homeless).padStart(8)} ${String(r.jobless).padStart(7)} ${String(r.avgMoney).padStart(5)} ${String(r.poorQuarter).padStart(6)} ${String(r.businesses).padStart(4)} ${String(r.closed).padStart(6)} ${String(r.treasury).padStart(8)} ${String(r.prices.bread).padStart(5)} ${String(r.prices.wood).padStart(4)} ${String(r.prices.planks).padStart(6)} ${String(r.prices.bricks).padStart(6)} ${String(r.techs).padStart(5)} ${r.status}`);
  const last = rows[rows.length - 1];
  console.log(`businesses: ${JSON.stringify(last.types)} · events ${last.events} · festivals ${last.festivals} · clay pits ${last.clayPits} · cold homes (worst week) ${Math.max(...rows.map((r) => r.cold || 0))}`);
  const w = warnings(rows);
  console.log(w.length ? `⚠ ${w.join(' · ')}` : '✓ nothing out of balance');
  all.push({ seed: 4200 + k, last, w });
}
const avg = (f) => Math.round(all.reduce((s, x) => s + f(x.last), 0) / all.length);
console.log(`\nAverage after ${days} days: pop ${avg((l) => l.pop)} · homeless ${avg((l) => l.homeless)} · jobless ${avg((l) => l.jobless)} · avg money $${avg((l) => l.avgMoney)} · businesses ${avg((l) => l.businesses)} · techs ${avg((l) => l.techs)}`);
