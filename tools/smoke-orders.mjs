// Headless test for standing orders and the guide.
//   Orders: "move 60 wood a day from my lumberyard to my warehouse" (physically, with a barrow;
//   exactly the day's amount, nothing made or lost), "keep 40 planks in my storage" (bought),
//   "keep 30 stone" (gathered), "keep my site supplied", only the workers you name, pause, cancel,
//   and save / load with a load on the way.
//   Guide: the first steps measured from the world and rewarded once, the next step in the HUD, advice
//   that fits the moment (idle workers, a site waiting for materials, an unused barrow), paths and
//   their milestones, save / load.
// Usage: node tools/smoke-orders.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';

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
  while (Math.floor(sim.time.hourFloat) !== h && guard++ < 60) runOn(sim)(30);
};
function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 20000;
  sim.progression.addXp(20000);
  sim.state.player.skills.construction.level = 6;
  return sim;
}
function hire(sim, n) {
  const look = sim.state.npcs[0].look;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    w.energy = 100;
    w.hunger = 100;
    sim.workers.hire(w, 16);
    sim.workers.setPriority(w.id, 'gathering', 'off');
    sim.workers.setPriority(w.id, 'construction', 'off');
    out.push(w);
  }
  return out;
}
/** A working day (8:00–17:00), checking as it goes. */
function workDay(sim, each = null, until = null) {
  const run = runOn(sim);
  toHour(sim, 8);
  for (let i = 0; i < 9 * 6; i++) {
    run(10);
    each?.();
    if (until?.()) return;
  }
}
const carried = (sim, item) => sim.workers.list().reduce((s, c) => {
  const n = sim.npcs.byId(c.npcId)?.carry;
  return s + (n ? n.items?.[item] ?? (n.item === item ? n.qty : 0) : 0);
}, 0);

// ================================================================== move: lumberyard → warehouse
{
  const sim = setup(7001);
  const tr = transportTools({ sim });
  const W = sim.workers;
  const E = sim.economy;
  tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  const bought = sim.holdings.buy('lumberyard');
  E.biz('lumberyard').stock.wood = 300;
  const [a, b] = hire(sim, 2);
  const barrow = sim.equipment.create('wheelbarrow');
  sim.equipment.lend(barrow.id, a.id);
  const r = W.addOrder({ kind: 'move', item: 'wood', from: 'biz:lumberyard', to: 'store', qty: 60 });
  check('An order: move 60 wood a day from your lumberyard to your warehouse', bought.ok && r.ok, JSON.stringify(r));
  const o = W.orderById(r.id);
  const total0 = E.stock('lumberyard', 'wood') + sim.home.storageCount('wood');
  let conserved = true;
  let over = false;
  let barrowLoad = 0;
  let saved = null;
  workDay(sim, () => {
    // (the lumberyard also makes and sells wood by itself — so count only what the order moved)
    const inStore = sim.home.storageCount('wood');
    if (inStore + carried(sim, 'wood') > 60 + 0) over = over || inStore > 60;
    if (a.carry?.order === o.id) barrowLoad = Math.max(barrowLoad, a.carry.qty);
    if (!saved && a.carry?.order === o.id && a.task?.stage === 'carry_site') saved = JSON.stringify(sim.state);
    if (sim.home.storageCount('wood') !== o.moved) conserved = false;
  });
  check('…your workers carry it over: 60 wood in your storage by evening', sim.home.storageCount('wood') === 60 && o.moved === 60, `store ${sim.home.storageCount('wood')}, moved ${o.moved}`);
  check('…never more than the day\'s amount', !over);
  check('…counted only once it\'s there (storage = what the order moved)', conserved);
  check('…the one with the barrow carries a barrow-load', barrowLoad > 20, `${barrowLoad}`);
  check('…taken from the lumberyard\'s stock (nothing made out of nothing)', E.stock('lumberyard', 'wood') + sim.home.storageCount('wood') <= total0, `${total0} → ${E.stock('lumberyard', 'wood') + sim.home.storageCount('wood')}`);
  const st = W.orderStatus(o);
  check('…and the order says it\'s done for today', st.state === 'done_today', st.state);
  runOn(sim)(15 * 60); // (to the next morning)
  workDay(sim);
  check('The next day: another 60', o.moved === 60 && o.total === 120 && sim.home.storageCount('wood') === 120, `moved ${o.moved} total ${o.total}`);
  // Save / load with a load on the way.
  if (saved) {
    const sim2 = new Simulation(JSON.parse(saved));
    const o2 = sim2.workers.orderById(o.id);
    const a2 = sim2.npcs.byId(a.id);
    check('Save / load: the order and the load on its way — as they were', !!o2 && a2.carry?.order === o.id && o2.qty === 60);
    const moved0 = o2.moved;
    const store0 = sim2.home.storageCount('wood');
    runOn(sim2)(120);
    check('…and the load arrives (counted once)', sim2.home.storageCount('wood') - store0 === sim2.workers.orderById(o.id).moved - moved0 && sim2.workers.orderById(o.id).moved > moved0, `${store0} → ${sim2.home.storageCount('wood')}`);
  } else check('Save / load with a load on the way', false, 'no save taken');
  // Pause and cancel.
  W.setOrder(o.id, { paused: true });
  runOn(sim)(24 * 60);
  const before = o.total;
  workDay(sim);
  check('Paused: nobody works on it', o.total === before && W.orderStatus(o).state === 'paused');
  W.removeOrder(o.id);
  check('Cancelled: gone, nothing left in anyone\'s task', !W.orderById(o.id) && W.list().every((c) => c.task?.order !== o.id));
}

// ================================================================== keep stocked: bought, gathered; only named workers
{
  const sim = setup(7002);
  const tr = transportTools({ sim });
  const W = sim.workers;
  tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  const [a, b] = hire(sim, 2);
  const money0 = sim.state.player.money;
  const r1 = W.addOrder({ kind: 'keep', item: 'wood', from: 'buy', to: 'store', qty: 40, workers: [a.id] });
  let bWorked = false;
  workDay(sim, () => {
    if (W.contract(b.id)?.task?.order === r1.id) bWorked = true;
  }, () => sim.home.storageCount('wood') >= 40);
  if (sim.home.storageCount('wood') < 40) workDay(sim, null, () => sim.home.storageCount('wood') >= 40);
  check('Keep 40 wood in store (bought): your worker buys it and brings it', sim.home.storageCount('wood') >= 40 && sim.home.storageCount('wood') <= 40 + 20 && sim.state.player.money < money0, `${sim.home.storageCount('wood')} wood, spent ${money0 - sim.state.player.money}`);
  check('…only the worker you named works on it', !bWorked);
  // Use some: they top it up again.
  sim.home.take('wood', 25);
  workDay(sim, null, () => sim.home.storageCount('wood') >= 40);
  check('…use some and they top it up again', sim.home.storageCount('wood') >= 40, `${sim.home.storageCount('wood')}`);
  // Gathered.
  const r2 = W.addOrder({ kind: 'keep', item: 'stone', from: 'gather', to: 'store', qty: 20 });
  workDay(sim, null, () => sim.home.storageCount('stone') >= 20);
  if (sim.home.storageCount('stone') < 20) workDay(sim, null, () => sim.home.storageCount('stone') >= 20);
  check('Keep 20 stone (gathered): they break rocks and bring the stone', r2.ok && sim.home.storageCount('stone') >= 20, `${sim.home.storageCount('stone')} stone`);
  check('Orders you can\'t carry out are refused with a reason (gathering planks)', W.canOrder({ kind: 'keep', item: 'planks', from: 'gather', to: 'store', qty: 10 }).reason === 'order_cant_gather');
}

// ================================================================== supply a site
{
  const sim = setup(7003);
  const tr = transportTools({ sim });
  const W = sim.workers;
  const C = sim.construction;
  tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  sim.home.store('wood', 60, { force: true });
  sim.home.store('planks', 30, { force: true });
  let site = null;
  for (const pid of sim.land.owned) for (const [x, y] of sim.territory.tiles(pid)) if (!site && C.canPlace('barn', x, y).ok) site = C.place('barn', x, y);
  hire(sim, 2);
  const r = W.addOrder({ kind: 'supply', to: `site:${site.id}`, from: 'store' });
  workDay(sim, null, () => Object.keys(C.missing(site)).length === 0);
  check('Keep my building site supplied: everything it needs is carried over', r.ok && Object.keys(C.missing(site)).length === 0, JSON.stringify(C.missing(site)));
  check('…and the order says so', W.orderStatus(W.orderById(r.id)).state === 'done_today' || W.orderStatus(W.orderById(r.id)).left === 0);
}

// ================================================================== the guide
{
  const sim = Simulation.newGame('T', 7004);
  const G = sim.guide;
  const cur = G.current();
  check('A new game: the first step is to find a job (on the notice board)', cur?.step.id === 'first_job' && !cur.locked);
  const obj = G.objective();
  check('…shown in the HUD, with an arrow to the notice board', obj?.kind === 'step' && !!obj.target);
  const money0 = sim.state.player.money;
  sim.state.stats.jobsCompleted = 1;
  G.check();
  check('Done (measured from the world): ticked off and rewarded', G.isDone('first_job') && sim.state.player.money === money0 + 10);
  G.check();
  check('…rewarded once', sim.state.player.money === money0 + 10);
  check('…and on to the next step', G.current()?.step.id === 'chop_wood');
  // Steps that wait for a level.
  sim.state.stats.treesChopped = 3;
  sim.state.stats.moneyEarned = 100;
  G.check();
  const locked = G.current();
  sim.state.stats.itemsCrafted = 1;
  G.check();
  const next = G.current();
  check('A step that waits for a level says which (hiring: level 5)', next?.step.id === 'hire' && next.locked && next.level === 5, `${next?.step.id} ${next?.locked} lvl ${next?.level}`);
  // Advice.
  sim.progression.addXp(20000);
  check('What next: once you can, it suggests hiring someone', G.advice().some((a) => a.id === 'can_hire'));
  sim.state.player.hunger = 10;
  check('…and something pressing comes first (you\'re hungry)', G.advice()[0].id === 'eat');
  sim.state.player.hunger = 90;
  const look = sim.state.npcs[0].look;
  const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
  w.met = true;
  sim.workers.hire(w, 15);
  const eq = sim.equipment.create('wheelbarrow');
  check('…a barrow nobody is using: lend it', G.advice().some((a) => a.id === 'lend' && a.go?.equipment?.lend === eq.id));
  const c = sim.workers.contract(w.id);
  c.state = 'waiting';
  c.stateSince = sim.time.total - 200;
  check('…a worker standing idle: give them something to do', G.advice().some((a) => a.id === 'idle_workers'));
  // Paths.
  check('Paths: follow one, see its milestones', G.choosePath('transport') && G.pathProgress().list.length >= 5 && G.pathProgress().list[0].done, JSON.stringify(G.pathProgress().list[0]));
  const xp0 = sim.state.player.xp + sim.state.player.level * 1e6;
  sim.equipment.lend(eq.id, w.id);
  const w2 = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
  w2.met = true;
  sim.workers.hire(w2, 15);
  sim.equipment.lend(sim.equipment.create('basket').id, w2.id);
  G.check();
  check('…a milestone reached: rewarded, and the next one shows', G.pathProgress().list[1].done && sim.state.player.xp + sim.state.player.level * 1e6 > xp0 && G.pathProgress().next?.id === 'depot');
  check('The "choose a path" step is done', G.isDone('path'));
  // Save / load.
  const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Save / load: steps done, the path and its milestones — as they were', sim2.guide.isDone('first_job') && sim2.guide.S.path === 'transport' && sim2.guide.pathProgress().list[1].done);
  const m2 = sim2.state.player.money;
  sim2.guide.check();
  check('…and nothing is rewarded twice after loading', sim2.state.player.money === m2);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll order and guide checks passed');
process.exit(failures ? 1 : 0);
