// Headless test for your hired workers: they keep working task after task, several can
// work on one building (each on their own spot), a full site sends extra hands elsewhere,
// they get unstuck, they fetch or buy missing materials and the work resumes, a worker
// who falls ill or is fired frees their task, it all survives save / load — and they get
// better at it. (The eight scenarios in the workers spec.)
// Usage: node tools/smoke-workers.mjs
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
const toHour = (sim, h) => {
  let guard = 0;
  while (Math.floor(sim.time.hourFloat) !== h && guard++ < 50) runOn(sim)(30);
};

function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 20000;
  sim.progression.addXp(8000);
  sim.state.player.skills.construction.level = 6;
  sim.territory.transfer('village_south', 'player', 'gift');
  return sim;
}
function hire(sim, n, assignment) {
  const look = sim.state.npcs[0].look;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    w.energy = 100;
    w.hunger = 100;
    sim.workers.hire(w, 15);
    sim.workers.assign(w.id, assignment);
    out.push(w);
  }
  return out;
}

// Test 1 — one builder, a project: arrives, works, finishes, carries on by itself.
{
  const sim = setup(1001);
  const run = runOn(sim);
  const pl = sim.land.plot('village_south');
  const site = sim.construction.place('small_house', pl.x1 + 2, pl.y1 + 2);
  for (const [id, q] of Object.entries(site.required)) sim.home.store(id, q, { force: true });
  const [w] = hire(sim, 1, { type: 'build', siteId: site.id });
  toHour(sim, 8);
  const c = sim.workers.contract(w.id);
  let stints = 0;
  let last = 0;
  for (let i = 0; i < 20 && site.status === 'site'; i++) {
    run(60);
    if (c.stats.done > last) stints++;
    last = c.stats.done;
    if (Math.floor(sim.time.hourFloat) >= 16) toHour(sim, 8);
  }
  check('Test 1: one builder works stint after stint until the house is built', site.status === 'done' && c.stats.done >= 5, `${c.stats.done} stints, ${site.status}`);
  toHour(sim, 9);
  run(90);
  check('…then finds something else to do instead of standing idle', !!c.task || ['working', 'moving'].includes(c.state), `${c.state} ${c.task?.kind || ''}`);
}

// Tests 2 & 3 — five builders on one house; each stands on their own spot.
{
  const sim = setup(1002);
  const run = runOn(sim);
  const pl = sim.land.plot('village_south');
  const site = sim.construction.place('rental_house', pl.x1 + 2, pl.y1 + 2);
  for (const [id, q] of Object.entries(site.required)) sim.home.store(id, q, { force: true });
  const ws = hire(sim, 5, { type: 'build', siteId: site.id });
  toHour(sim, 8);
  run(45);
  const cs = ws.map((w) => sim.workers.contract(w.id));
  const onSite = cs.filter((c) => c.task?.kind === 'build');
  const spots = new Set(onSite.map((c) => `${c.task.spot.tx},${c.task.spot.ty}`));
  const cap = sim.workers.siteCapacity(site);
  check('Test 2: several builders work the same house together', onSite.length >= 2 && onSite.length <= cap, `${onSite.length} on site (room for ${cap})`);
  check('Test 3: each has their own spot to stand', spots.size === onSite.length, [...spots].join(' '));
  check('…the ones there is no room for do something else (not stuck)', cs.every((c) => c.task || ['working', 'moving', 'waiting', 'seeking'].includes(c.state)), cs.map((c) => `${c.state}:${c.task?.kind || '-'}`).join(' '));
  for (let i = 0; i < 12 && site.status === 'site'; i++) {
    run(60);
    if (Math.floor(sim.time.hourFloat) >= 16) toHour(sim, 8);
  }
  check('…and the house goes up fast', site.status === 'done', `${Math.round(site.labor)}/${site.laborNeeded}`);
}

// Test 4 — no spot free: waits and tries again, never frozen.
{
  const sim = setup(1003);
  const run = runOn(sim);
  const pl = sim.land.plot('village_south');
  const site = sim.construction.place('storage_shed', pl.x1 + 2, pl.y1 + 2);
  for (const [id, q] of Object.entries(site.required)) sim.home.store(id, q, { force: true });
  const W = sim.workers;
  const ws = hire(sim, 3, { type: 'build', siteId: site.id });
  for (const w of ws) W.setPriority(w.id, 'gathering', 'off'), W.setPriority(w.id, 'maintenance', 'off'), W.setPriority(w.id, 'hauling', 'off');
  toHour(sim, 8);
  run(30);
  const cs = ws.map((w) => W.contract(w.id));
  const waiting = cs.filter((c) => !c.task);
  check('Test 4: with the site full, the extra hands wait nearby', waiting.length >= 1 && waiting.every((c) => c.state === 'waiting' || c.state === 'need_materials'), cs.map((c) => `${c.state}:${c.task?.kind || '-'}`).join(' '));
  run(60 * 3);
  check('…and keep looking (they are not frozen)', ws.every((w) => w.task?.type !== 'work' || ['idle_wait', 'to_idle', 'to_task', 'working', 'carry_site', 'carry_home'].includes(w.task.stage)));
}

// Test 5 — the way is blocked: they give up on that task and do another.
{
  const sim = setup(1004);
  const run = runOn(sim);
  const W = sim.workers;
  const [w] = hire(sim, 1, { type: 'gather_wood' });
  toHour(sim, 8);
  run(10);
  const c = W.contract(w.id);
  const t = c.task;
  check('a woodcutter has a tree to go to', t?.kind === 'gather_wood', t?.kind);
  // Wall the tree in completely.
  const o = sim.resources.get(t.target);
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) sim.world.staticBlocked[sim.world.idx(o.tx + dx, o.ty + dy)] = 1;
  sim.npcs.paths.delete(w.id);
  W.next(w);
  check('Test 5: with no way to the tree, it is left alone and another is chosen', c.task && c.task.target !== t.target && c.blocked[t.key] > sim.time.total, `${c.task?.target} vs ${t.target}`);
  // A worker whose walk takes forever is reset by the watchdog.
  c.stateSince = sim.time.total - 1000;
  sim.npcs.paths.set(w.id, [{ tx: 1, ty: 1 }]);
  const unstuck = c.unstuck || 0;
  W.watchdog();
  check('…and the watchdog resets anyone who walks too long', (c.unstuck || 0) > unstuck && !!c.task, c.lastStuck?.why);
}

// Test 6 — the site runs out of materials: the work pauses, materials are fetched, it resumes.
{
  const sim = setup(1005);
  const run = runOn(sim);
  const W = sim.workers;
  const pl = sim.land.plot('village_south');
  const site = sim.construction.place('small_house', pl.x1 + 2, pl.y1 + 2);
  W.state.buy = false; // nobody may buy: materials must come from your storage
  const ws = hire(sim, 2, { type: 'build', siteId: site.id });
  toHour(sim, 8);
  run(120);
  const stalled = site.labor;
  check('Test 6: without materials the site pauses (not an error)', site.labor <= sim.construction.maxLabor(site) + 1 && site.status === 'site');
  check('…and the builders say they need materials (they are not frozen)', ws.every((w) => ['need_materials', 'waiting', 'working', 'moving'].includes(W.contract(w.id).state)), ws.map((w) => W.contract(w.id).state).join(' '));
  for (const [id, q] of Object.entries(site.required)) sim.home.store(id, q, { force: true });
  run(180);
  check('…materials in store: they carry them over and building resumes', site.labor > stalled + 60, `${Math.round(stalled)} → ${Math.round(site.labor)}`);
  // …or, allowed to spend, they buy what's missing.
  const site2 = sim.construction.place('storage_shed', pl.x1 + 6, pl.y1 + 5);
  W.state.buy = true;
  const money = sim.state.player.money;
  for (let i = 0; i < 16; i++) {
    run(60);
    if (Math.floor(sim.time.hourFloat) >= 16) toHour(sim, 8);
  }
  check('…allowed to spend, they buy what is missing (with your money, within the limit)', sim.construction.materialsFraction(site2) > 0.5 && sim.state.player.money < money, `${Math.round(sim.construction.materialsFraction(site2) * 100)}%, spent ${money - sim.state.player.money}`);
}

// Test 7 — a worker falls ill (or is fired): their task is freed for another.
{
  const sim = setup(1006);
  const run = runOn(sim);
  const W = sim.workers;
  const [a, b] = hire(sim, 2, { type: 'gather_wood' });
  toHour(sim, 8);
  run(10);
  const ca = W.contract(a.id);
  const tree = ca.task?.target;
  a.health = 5; // ill
  a.task = { type: 'sick', stage: 'start' };
  W.watchdog();
  check('Test 7: an ill worker drops their task', !ca.task && ca.state === 'unavailable', ca.state);
  check('…and their tree is free again', !sim.resources.get(tree)?.reservedBy || sim.resources.get(tree).reservedBy !== a.id);
  const cb = W.contract(b.id);
  const bTarget = cb.task?.target;
  W.fire(b.id);
  check('…a fired worker leaves nothing reserved', !Object.values(sim.state.objects).some((o) => o.reservedBy === b.id) && !W.contract(b.id), bTarget);
}

// Test 8 — save while working: after loading they carry on.
{
  const sim = setup(1007);
  const run = runOn(sim);
  const pl = sim.land.plot('village_south');
  const site = sim.construction.place('small_house', pl.x1 + 2, pl.y1 + 2);
  for (const [id, q] of Object.entries(site.required)) sim.home.store(id, q, { force: true });
  const ws = hire(sim, 2, { type: 'build', siteId: site.id });
  toHour(sim, 8);
  run(90);
  const state = JSON.parse(JSON.stringify(sim.state));
  for (const n of state.npcs) delete n.task; // what SaveSystem strips
  const sim2 = new Simulation(state);
  const run2 = runOn(sim2);
  const l0 = sim2.construction.byId(site.id).labor;
  run2(180);
  const s2 = sim2.construction.byId(site.id);
  check('Test 8: after loading, the workers carry on building', s2.labor > l0 + 60 || s2.status === 'done', `${Math.round(l0)} → ${Math.round(s2.labor)}`);
  check('…their contracts still know what they are doing', ws.every((w) => sim2.workers.contract(w.id).state));
}

// Progression — practice makes them better (and faster).
{
  const sim = setup(1008);
  const run = runOn(sim);
  const W = sim.workers;
  const [w] = hire(sim, 1, { type: 'gather_wood' });
  const skill0 = sim.education.competence(w, 'forestry');
  const lvl0 = w.level;
  for (let d = 0; d < 4; d++) {
    toHour(sim, 8);
    run(8 * 60);
  }
  check('workers learn their trade from the work they do', sim.education.competence(w, 'forestry') > skill0 && (w.level > lvl0 || w.xp > 0), `forestry ${skill0.toFixed(1)} → ${sim.education.competence(w, 'forestry').toFixed(1)}, level ${lvl0} → ${w.level}`);
  const prof = W.profile(w);
  check('…and are known by what they do best', !!prof.profession && prof.skills.length === 3, JSON.stringify(prof));
  check('…with a count of the work done', W.contract(w.id).stats.done >= 8, String(W.contract(w.id).stats.done));
}

// A week of a mixed team with nothing broken.
{
  const sim = setup(1009);
  const run = runOn(sim);
  const pl = sim.land.plot('village_south');
  sim.construction.place('small_house', pl.x1 + 2, pl.y1 + 2);
  hire(sim, 2, { type: 'build' });
  hire(sim, 1, { type: 'gather_wood' });
  hire(sim, 1, { type: 'idle' });
  let crashed = null;
  try {
    run(7 * 1440);
  } catch (e) {
    crashed = e;
  }
  check('a week with a mixed team passes without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
  const done = sim.workers.list().reduce((s, c) => s + (c.stats?.done || 0), 0);
  check('…and a lot gets done', done >= 40, `${done} tasks`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll worker checks passed.');
process.exit(failures ? 1 : 0);
