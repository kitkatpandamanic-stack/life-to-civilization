// The long run: a valley left alone for years (nobody playing), printed year by year — people (born, died,
// off to the towns and back), homes, work, money, businesses, the woods — with checks that nothing has gone
// wrong (numbers that aren't numbers, people in homes that don't exist, duplicates, the save growing huge).
// Usage: node tools/report-long.mjs [seeds=2] [years=10]
import { Simulation } from '../src/core/Simulation.js';
import { snapshot, warnings } from '../src/debug/reportTools.js';

const seeds = Number(process.argv[2] || 2);
const years = Number(process.argv[3] || 10);
const YEAR = 56 * 1440;

function problems(sim) {
  const out = [];
  const bad = [];
  const walk = (o, path, depth) => {
    if (bad.length > 3 || depth > 7) return;
    if (typeof o === 'number' && !Number.isFinite(o)) bad.push(path);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, depth + 1);
  };
  walk(sim.state, 'state', 0);
  if (bad.length) out.push(`not a number: ${bad.join(', ')}`);
  const ids = new Set();
  for (const n of sim.state.npcs) {
    if (ids.has(n.id)) out.push(`duplicate villager ${n.id}`);
    ids.add(n.id);
    if (n.homeId && !sim.world.buildings[n.homeId]) out.push(`${n.id} lives in a missing building ${n.homeId}`);
    if (n.money < -1) out.push(`${n.id} owes money (${Math.round(n.money)})`);
  }
  for (const [id, b] of Object.entries(sim.state.businesses)) if (b.owner && b.owner !== 'player' && !b.closed && !ids.has(b.owner)) out.push(`business ${id} owned by someone gone`);
  const P = sim.property;
  for (const id of P.homes()) if (P.occupants(id) > P.capacity(id) + 2) out.push(`${id} overcrowded ${P.occupants(id)}/${P.capacity(id)}`);
  const kb = Math.round(JSON.stringify(sim.state).length / 1024);
  if (kb > 6000) out.push(`save is ${kb} KB`);
  return { out, kb };
}

for (let k = 0; k < seeds; k++) {
  const seed = 4200 + k;
  const sim = Simulation.newGame('T', seed);
  const t0 = Date.now();
  const rows = [snapshot(sim)];
  console.log(`\nValley ${seed}`);
  console.log('yr  pop kids eld born died towns back home- jobl  avg$ poor$ biz treas bread wood forest grown techs  kb status');
  let crashed = null;
  for (let y = 1; y <= years && !crashed; y++) {
    try {
      const end = sim.time.total + YEAR;
      while (sim.time.total < end) sim.update(4000);
    } catch (e) {
      crashed = e;
      break;
    }
    const s = snapshot(sim);
    rows.push(s);
    const rec = sim.state.population?.years?.[sim.time.year - 1] || {};
    const st = sim.population?.stages() || {};
    const f = sim.forestry?.summary() || {};
    const pr = problems(sim);
    const pad = (v, n) => String(v).padStart(n);
    console.log(`${pad(y, 2)} ${pad(s.pop, 4)} ${pad(st.child + st.youth, 4)} ${pad(st.elder, 3)} ${pad(rec.births ?? '-', 4)} ${pad(rec.deaths ?? '-', 4)} ${pad(rec.abroad ?? '-', 5)} ${pad(rec.returned ?? '-', 4)} ${pad(s.homeless, 5)} ${pad(s.jobless, 4)} ${pad(s.avgMoney, 5)} ${pad(s.poorQuarter, 5)} ${pad(s.businesses, 3)} ${pad(s.treasury, 5)} ${pad(s.prices.bread, 5)} ${pad(s.prices.wood, 4)} ${pad(`${Math.round((f.health || 0) * 100)}%`, 6)} ${pad(f.grown ?? '-', 5)} ${pad(s.techs, 5)} ${pad(pr.kb, 4)} ${s.status}`);
    for (const p of pr.out.slice(0, 5)) console.log(`   ⚠ ${p}`);
  }
  if (crashed) console.log(`✗ CRASHED in year ${rows.length}: ${crashed.stack?.split('\n').slice(0, 4).join(' | ')}`);
  const w = warnings(rows);
  console.log(w.length ? `⚠ ${w.join(' · ')}` : '✓ nothing out of balance');
  console.log(`businesses: ${JSON.stringify(rows[rows.length - 1].types)} · ${Math.round((Date.now() - t0) / 1000)} s`);
}
