// Headless test for logistics: restocking ships goods by road with travel time and
// a fee; roads make routes faster; carters and warehouses change how goods move.
// Usage: node tools/smoke-logistics.mjs
import { Simulation } from '../src/core/Simulation.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(400);
};

{
  const sim = Simulation.newGame('T', 77);
  const run = runOn(sim);
  const L = sim.logistics;
  // Make the store want wood, then let the morning delivery round happen.
  sim.economy.biz('store').stock.wood = 0;
  sim.economy.biz('lumberyard').stock.wood = 40;
  let shipped = null;
  sim.bus.on('logistics:shipped', (s) => {
    if (!shipped && s.item === 'wood' && s.to === 'store') shipped = { ...s };
  });
  run(26 * 60);
  check('restocking sends goods by road', !!shipped, shipped ? `${shipped.qty} wood by ${shipped.carrier}, ${shipped.arrive - shipped.depart} min, fee $${shipped.fee}` : 'none');
  check('the goods arrive at the shop', sim.economy.stock('store', 'wood') > 0);
  const route = L.route('lumberyard', 'store');
  check('routes follow the roads', route.roadTiles > route.dist * 0.4, `${route.roadTiles}/${route.dist} tiles on road`);
  check('farther suppliers cost more to ship from', L.quote('quarry_hut', 'store', 10) > L.quote('lumberyard', 'store', 10), `${L.quote('quarry_hut', 'store', 10)} vs ${L.quote('lumberyard', 'store', 10)}`);
  // A carters' firm is faster than porters on foot.
  const porterMin = route.minutes.porter;
  check('carts are faster than porters', route.minutes.handcart < porterMin, `${route.minutes.handcart} vs ${porterMin} min`);
}

{
  // A warehouse takes producers' surplus instead of it being dumped on traders.
  const sim = Simulation.newGame('T', 78);
  const run = runOn(sim);
  const vera = sim.npcs.byId('vera');
  vera.money = 2000;
  const c = sim.growth.start(vera, 'warehouse', 'shop', { tx: 20, ty: 44 }, { bizType: 'warehouse' });
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  const id = sim.enterprise.open(sim.npcs.byId('nikita'), 'warehouse', { building: c.id, how: 'rent' }, null);
  sim.economy.biz(id).money = 600;
  sim.economy.biz('lumberyard').stock.wood = 90;
  run(2 * 1440);
  check('a warehouse opened', !!id && !!sim.economy.biz(id));
  check('the warehouse buys producers\' surplus', (sim.economy.stock(id, 'wood') + sim.logistics.incoming(id, 'wood')) > 0, `wood ${sim.economy.stock(id, 'wood')}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
