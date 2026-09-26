// Headless test for farm animals (LivestockSystem):
//   buying  — at the village farm, only with a barn of your own and room in it (paid to the farm)
//   giving  — eggs and milk each morning, wool once a week, waiting at the barn; you collect it, or
//             your workers carry it to your storage
//   winter  — they eat fodder from your storage (hay first); with none they sicken, stop giving, die
//   spring  — hens raise chicks (with room); the farm cuts hay in summer, the store sells it
//   and     — selling back, cheese from milk, the store buys eggs/milk/wool, saving, no dice
// Usage: node tools/smoke-livestock.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';
import { seasonTools } from '../src/debug/seasonTools.js';
import { LIVESTOCK, FARM } from '../src/data/livestock.js';
import { RECIPES } from '../src/data/recipes.js';
import { rand } from '../src/core/rng.js';

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
  sim.state.player.money = 5000;
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
    out.push(w);
  }
  return out;
}

{
  const sim = setup(9801);
  const L = sim.livestock;
  const tr = transportTools({ sim });
  check('No barn: no animals', L.canBuy('chicken').reason === 'need_barn');
  const barn = tr.build('barn');
  check('With a barn of your own, the farm sells you animals', !!barn && L.canBuy('chicken').ok, barn);
  const farm = sim.economy.biz(L.farm());
  const f0 = farm.money;
  const m0 = sim.state.player.money;
  L.buy('chicken');
  L.buy('chicken');
  L.buy('cow');
  L.buy('sheep');
  const cost = 2 * LIVESTOCK.chicken.price + LIVESTOCK.cow.price + LIVESTOCK.sheep.price;
  check('Bought two hens, a cow and a sheep (paid to the farm)', L.count() === 4 && sim.state.player.money === m0 - cost && farm.money === f0 + cost);
  check('They take room in the barn', L.used(barn) === 2 + 3 + 2);
  while (L.canBuy('cow').ok) L.buy('cow');
  check('A full barn takes no more', L.canBuy('cow').reason === 'barn_full' && L.used(barn) <= L.space(barn), `${L.used(barn)}/${L.space(barn)}`);
  // Sell the extra cows back.
  for (const a of L.mine().filter((x) => x.kind === 'cow').slice(1)) L.sell(a.id);
  check('Selling one back to the farm (for less than you paid)', L.count('cow') === 1 && L.sellPrice(L.mine().find((a) => a.kind === 'cow')) < LIVESTOCK.cow.price);

  // Each morning.
  const r0 = rand.getState();
  L.daily();
  L.daily();
  check('Nothing about them rolls the dice', rand.getState() === r0);
  runOn(sim)(1440);
  const w = L.waiting(barn);
  check('Eggs and milk waiting at the barn in the morning', (w.egg || 0) >= 2 && (w.milk || 0) >= 2, JSON.stringify(w));
  runOn(sim)(7 * 1440);
  check('A week on: the sheep has been shorn (wool)', (L.S.stats.wool || 0) >= LIVESTOCK.sheep.gives.n);
  check('…the barn never holds more than it can keep', L.waitingTotal(barn) <= FARM.produceCap);
  const eggs0 = sim.inventory.count('egg');
  L.collect(barn);
  check('You collect it into your pockets', sim.inventory.count('egg') > eggs0);
  // Your workers collect.
  hire(sim, 1);
  const store0 = sim.home.storageCount('milk') + sim.home.storageCount('egg');
  runOn(sim)(2 * 1440);
  check('Your workers carry it to your storage', sim.home.storageCount('milk') + sim.home.storageCount('egg') > store0, `${store0} → ${sim.home.storageCount('milk') + sim.home.storageCount('egg')}`);
  check('The store buys eggs, milk and wool from you', ['egg', 'milk', 'wool'].every((i) => sim.economy.buysItem('store', i)));
  check('…but never orders them itself (no farm animals in the valley but yours)', ['egg', 'milk', 'wool'].every((i) => !sim.economy.def('store').buys.includes(i)));
  const shop = sim.economy.biz('store');
  shop.stock.egg = 40;
  sim.economy.outsideTrade(0.5);
  check('…and sells the surplus on to traders', shop.stock.egg < 40 && shop.stock.egg >= sim.economy.target('store', 'egg') * 0.5 - 1, `40 → ${shop.stock.egg}`);
  check('Milk makes cheese at the stove, eggs an omelette', RECIPES.cheese?.inputs.milk === 3 && RECIPES.omelette?.inputs.egg === 3);

  // Winter.
  const ss = seasonTools({ sim });
  for (const i of FARM.fodder) while (sim.home.storageCount(i)) sim.home.take(i, sim.home.storageCount(i));
  sim.home.store('hay', 10, { force: true });
  ss.go('winter');
  const hay0 = sim.home.storageCount('hay');
  L.daily();
  check('Winter: they eat fodder from your storage (hay first)', sim.home.storageCount('hay') < hay0 && L.mine().every((a) => a.health > 50), `${hay0} → ${sim.home.storageCount('hay')}`);
  check('The guide knows how long it will last', sim.guide.advice(12).some((a) => a.id === 'livestock_fodder'));
  while (sim.home.storageCount('hay')) L.daily();
  const seen = [];
  sim.bus.on('toast', (e) => seen.push(e.key));
  L.daily();
  check('Nothing left to eat: they sicken (you\'re told)', seen.includes('toast.livestock_hungry') && L.mine().some((a) => a.health < 100));
  for (let i = 0; i < 10; i++) L.daily();
  check('…and in the end they die', L.count() === 0 && (L.S.stats.died || 0) >= 1);

  // Spring: chicks.
  ss.go('spring');
  L.buy('chicken');
  L.buy('chicken');
  const c0 = L.count('chicken');
  for (let i = 0; i < FARM.hatchEvery + 1; i++) {
    sim.state.time.totalMinutes += 1440;
    L.daily();
  }
  check('Spring: two hens raise chicks (there\'s room)', L.count('chicken') > c0, `${c0} → ${L.count('chicken')}`);

  // Hay at the farm and the store.
  check('The store sells hay (winter fodder)', sim.economy.def('store').sells.includes('hay'));
  ss.go('summer');
  const hay1 = farm.stock.hay || 0;
  runOn(sim)(2 * 1440);
  check('The farm cuts hay in summer', (farm.stock.hay || 0) > hay1 || hay1 >= sim.economy.target(L.farm(), 'hay'), `${hay1} → ${farm.stock.hay}`);

  // Saved.
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Your animals are saved', copy.livestock.count() === L.count() && copy.livestock.used(barn) === L.used(barn));
  const old = JSON.parse(JSON.stringify(sim.state));
  delete old.livestock;
  check('An old save (from before) loads', new Simulation(old).livestock.count() === 0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll livestock checks passed');
process.exit(failures ? 1 : 0);
