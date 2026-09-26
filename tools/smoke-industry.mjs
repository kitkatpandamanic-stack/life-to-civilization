// Headless test for early industry, a livelier world, stability:
//   industry — clay pits along the river (the same in the same world; old saves get theirs), clay dug
//              from them, a brickworks (clay → bricks, its diggers physically at the pits), a sawmill
//              and a factory making in bulk, the store buying the valley's own bricks, your workers
//              digging clay on a standing order, mud slowing carts in the rain, cobbles speeding them
//   life     — a festival (the village gathers on the square; you join in, give something), bandits on
//              the roads, what you do talked about (and people think better of you), a competitor
//              opening against your successful business
//   stability — save backups and loading a damaged save, the route cache
// Usage: node tools/smoke-industry.mjs
import { Simulation } from '../src/core/Simulation.js';
import { buildTools } from '../src/debug/buildTools.js';
import { transportTools } from '../src/debug/transportTools.js';
import { SaveSystem } from '../src/systems/SaveSystem.js';
import { findPath, pathStats } from '../src/world/Pathfinder.js';
import { FESTIVALS } from '../src/systems/FestivalSystem.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 20000;
  sim.progression.addXp(20000);
  sim.state.player.skills.construction.level = 6;
  return sim;
}
const grant = (sim, ...ids) => ids.forEach((id) => (sim.tech.T.known[id] = sim.time.day));

// ================================================================== clay
{
  const a = setup(8101);
  const b = setup(8101);
  const pa = a.industry.clayPits();
  check('Clay pits along the river (the same in the same world)', pa.length >= 6 && pa.map((o) => `${o.tx},${o.ty}`).join() === b.industry.clayPits().map((o) => `${o.tx},${o.ty}`).join(), `${pa.length} pits`);
  check('…each right beside the water', pa.every((o) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => a.world.isWater(o.tx + dx, o.ty + dy))));
  const r = a.resources.mineRock(pa[0].id);
  check('Digging a pit gives clay', r.item === 'clay' && r.qty >= 3, JSON.stringify(r));
  // An old save without pits gets them.
  const st = JSON.parse(JSON.stringify(a.state));
  for (const [id, o] of Object.entries(st.objects)) if (o.variant === 'clay') delete st.objects[id];
  delete st.industry;
  const c = new Simulation(st);
  check('An older save gets its clay pits when loaded', c.industry.clayPits().length === pa.length);
  // Worked out for good: another found along the bank.
  const pit = a.industry.clayPits()[1];
  const n0 = a.industry.clayPits().length;
  pit.reserve = 2;
  a.resources.mineRock(pit.id);
  check('A pit dug out for good: another is found along the bank', a.industry.clayPits().length === n0 + 1);
}

// ================================================================== brickworks, sawmill, factory
{
  const sim = setup(8102);
  const bt = buildTools({ sim, scene: null });
  const E = sim.economy;
  grant(sim, 'brickmaking', 'better_tools', 'sawing', 'manufacture');
  check('Once the village knows how, villagers could open a brickworks, a sawmill, a factory', ['brickworks', 'sawmill', 'factory'].every((t) => sim.enterprise.opportunity(t) > -9));
  // Open them (in warehouses of their own), and let a week go by.
  const owners = sim.state.npcs.filter((n) => n.age >= 20 && n.age < 60 && !n.owns).slice(0, 3);
  const ids = {};
  for (const [i, type] of ['brickworks', 'sawmill', 'factory'].entries()) {
    const n = owners[i];
    n.money += 3000;
    const w = bt.building('warehouse', n.id, 'shop');
    ids[type] = sim.enterprise.open(n, type, { building: w, how: 'own' }, null);
  }
  check('A brickworks, a sawmill and a factory open', Object.values(ids).every((id) => id && E.biz(id)), JSON.stringify(ids));
  // Diggers for the brickworks.
  const look = sim.state.npcs[0].look;
  for (let i = 0; i < 2; i++) {
    const d = sim.npcs.spawn({ age: 28, occupation: 'unemployed', look, money: 20 });
    sim.npcs.employ?.(d, ids.brickworks) ?? Object.assign(d, { employer: ids.brickworks, occupation: 'clay_digger' });
  }
  E.biz(ids.sawmill).stock.wood = 60;
  E.biz(ids.factory).stock.planks = 30;
  E.biz(ids.factory).stock.iron_ore = 10;
  E.biz(ids.factory).stock.coal = 10;
  const pits0 = sim.industry.clayPits().filter((o) => o.state === 'full').length;
  runOn(sim)(5 * 24 * 60);
  const pits1 = sim.industry.clayPits().filter((o) => o.state === 'full').length;
  const B = E.biz(ids.brickworks);
  check('The brickworks\' diggers dig clay at the river pits', pits1 < pits0 || (B.stock.clay || 0) > 0, `${pits0} → ${pits1} full pits, clay ${B.stock.clay || 0}`);
  const bricksMade = (B.stock.bricks || 0) + (E.stock(E.ofType('general_store')[0], 'bricks') || 0);
  check('…and fire it into bricks', bricksMade > 6 || (B.history || []).some((d) => d.rev > 0), `bricks ${B.stock.bricks || 0}`);
  check('The sawmill saws planks in bulk', (E.stock(ids.sawmill, 'planks') || 0) + (E.biz(ids.sawmill).history || []).reduce((s, d) => s + (d.rev || 0), 0) > 10, `planks ${E.stock(ids.sawmill, 'planks')}`);
  const F = E.biz(ids.factory);
  check('The factory makes tools and furniture', ['hammer', 'axe', 'saw', 'chair', 'table'].some((i) => (F.stock[i] || 0) > 0) || (F.history || []).some((d) => d.rev > 0), JSON.stringify(F.stock));
}

// ================================================================== your workers dig clay; mud and cobbles
{
  const sim = setup(8103);
  const tr = transportTools({ sim });
  tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  const look = sim.state.npcs[0].look;
  for (let i = 0; i < 2; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    sim.workers.hire(w, 16);
  }
  const r = sim.workers.addOrder({ kind: 'keep', item: 'clay', from: 'gather', to: 'store', qty: 12 });
  const run = runOn(sim);
  for (let d = 0; d < 3 && sim.home.storageCount('clay') < 12; d++) run(24 * 60);
  check('Your workers dig clay at the river on a standing order', r.ok && sim.home.storageCount('clay') >= 12, `${sim.home.storageCount('clay')} clay`);
  const E = sim.equipment;
  const cart = E.create('handcart');
  sim.weather.change('sunny');
  const dry = E.moveMult(cart, false);
  sim.weather.change('rain');
  const wet = E.moveMult(cart, false);
  const road = E.moveMult(cart, true);
  const cobbles = E.moveMult(cart, true, true);
  check('Rain turns grass and dirt to mud: carts slow down off the road', wet < dry, `grass ×${dry} → ×${wet} in the rain`);
  check('…roads are fine in the rain, cobbles quicker still', road > wet && cobbles > road, `road ×${road}, cobbles ×${cobbles}`);
  const basket = E.create('basket');
  check('…(a basket carried by hand doesn\'t get stuck)', E.moveMult(basket, false) === E.moveMult(basket, true));
}

// ================================================================== festivals, bandits, talk, competitors
{
  const sim = setup(8104);
  const run = runOn(sim);
  const F = sim.festivals;
  const f = FESTIVALS.spring_fair;
  while (sim.time.dayOfSeason < f.day || sim.time.season !== f.season) run(6 * 60);
  while (sim.time.hourFloat < f.hours[0] + 1) run(30);
  check('The spring fair: on today, on the square', F.active() && F.S.current.id === 'spring_fair');
  // You go.
  const p = sim.state.player;
  const c = F.centre();
  p.x = c.tx * 32 + 16;
  p.y = c.ty * 32 + 16;
  const rep0 = p.reputation;
  const tres0 = sim.state.village.treasury;
  run(60);
  const gift = F.donate(100);
  let crowd = 0;
  for (let i = 0; i < 12 && F.active(); i++) {
    run(20);
    const onSquare = sim.state.npcs.filter((n) => !n.inside && Math.abs(Math.floor(n.x / 32) - c.tx) + Math.abs(Math.floor(n.y / 32) - c.ty) <= 10).length;
    crowd = Math.max(crowd, onSquare);
  }
  check('…villagers gather on the square', crowd >= Math.min(6, sim.state.npcs.length / 3), `${crowd} there at once`);
  check('…you joined in, and gave something (it goes to the village)', F.S.current?.attended !== false && gift.ok && sim.state.village.treasury >= tres0 + 100);
  while (F.S.current) run(60);
  const h = F.S.history[0];
  check('…afterwards: remembered, your name a little better', h?.attended && h.donated === 100 && p.reputation > rep0, `rep ${rep0} → ${p.reputation}, crowd ${h?.crowd}`);
  check('The next festival is known', !!F.next() && F.next().id === 'midsummer');
  // Bandits.
  const S = sim.settlements;
  const id = S.ids()[0];
  const d0 = S.danger(id);
  sim.events.start('bandits');
  check('Bandits on the roads: journeys and caravans are far riskier', S.danger(id) > d0 * 2, `${d0.toFixed(3)} → ${S.danger(id).toFixed(3)}`);
  // What you do gets talked about.
  const n0 = sim.state.rumors.list.length;
  sim.chronicle('chronicle.player_built', { building_type: 'barn' });
  const rumor = sim.state.rumors.list.slice(n0).find((r) => r.kind === 'you_built');
  const listener = sim.state.npcs.find((n) => !(n.rumors || []).includes(rumor?.id) && n.age >= 16);
  const rel0 = listener.rel;
  sim.rumors.learn(listener, rumor.id);
  check('What you do gets talked about — and people think better of you for it', !!rumor && listener.rel > rel0, `${rel0} → ${listener.rel}`);
  // A competitor against your successful business.
  const bought = sim.holdings.buy('tavern');
  const tav = sim.economy.biz('tavern');
  tav.history = Array.from({ length: 7 }, (_, i) => ({ day: i, rev: 60, exp: 20 }));
  check('Your business doing well draws a competitor into the trade', bought.ok && sim.enterprise.copyDraw('tavern') > 0 && sim.enterprise.playerRuns('tavern'));
}

// ================================================================== saves and routes
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const sim = setup(8105);
  const ok1 = SaveSystem.save('2', sim);
  sim.state.player.money = 12345;
  const ok2 = SaveSystem.save('2', sim);
  check('Saving keeps the save before as a backup', ok1 && ok2 && SaveSystem.hasBackup('2'));
  store.set('fromnothing.save.2', '{"meta":{},"state":{"player":'); // damaged
  const g = SaveSystem.loadGame('2', (st) => new Simulation(st));
  check('A damaged save: the backup is loaded instead (and you\'re told)', !!g && SaveSystem.lastLoad === 'backup' && g.state.player.money !== 12345);
  store.set('fromnothing.save.2', JSON.stringify({ meta: {}, state: { player: {}, npcs: 'broken' } }));
  const g2 = SaveSystem.loadGame('2', (st) => new Simulation(st));
  check('…also when it reads but won\'t start', !!g2 && SaveSystem.lastLoad === 'backup');
  // The route cache.
  const w = sim.world;
  const s0 = pathStats.searches;
  const p1 = findPath(w, 40, 40, 60, 45);
  const p2 = findPath(w, 40, 40, 60, 45);
  check('A route asked for twice is worked out once (and is the same)', pathStats.searches === s0 + 1 && JSON.stringify(p1) === JSON.stringify(p2) && p2 !== p1);
  p2.shift();
  const p3 = findPath(w, 40, 40, 60, 45);
  check('…(and the one handed out can\'t be spoilt by whoever uses it)', p3.length === p1.length);
  w.blockRect(50, 42, 1, 1, 1);
  findPath(w, 40, 40, 60, 45);
  check('…but anything built on the way means it\'s worked out again', pathStats.searches === s0 + 2);
  w.blockRect(50, 42, 1, 1, 0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll industry, festival and stability checks passed');
process.exit(failures ? 1 : 0);
