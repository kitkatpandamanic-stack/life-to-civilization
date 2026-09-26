// Headless test for the trains (TrainSystem):
//   timetable — no railway, no trains; with one, trains come in from the valley's edge, wait at the
//               platform and go out again, three times a day (where one is comes from the clock)
//   arrivals  — travellers spend at the tavern and store; newcomers step off at the station
//   freight   — goods sent from your storage go with the train, are sold there, and the money comes
//               back on a later train; goods ordered arrive in the goods yard; you (or your workers)
//               collect them to your storage
//   and       — no dice; saved
// Usage: node tools/smoke-trains.mjs
import { Simulation } from '../src/core/Simulation.js';
import { reportTools } from '../src/debug/reportTools.js';
import { transportTools } from '../src/debug/transportTools.js';
import { TRAIN } from '../src/data/settlements.js';
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
/** Wind the clock to minute m of the day (today, or tomorrow if it's past). */
const toMinute = (sim, m) => {
  let d = (m - (sim.time.total % 1440) + 1440) % 1440;
  if (d === 0) d = 1440;
  runOn(sim)(d);
};

{
  const sim = Simulation.newGame('T', 9901);
  sim.state.player.money = 50000;
  sim.progression.addXp(20000);
  const T = sim.trains;
  check('No railway: no trains', !T.lines().length && !T.at().length);
  const dev = { sim };
  dev.tr = transportTools(dev);
  const eco = reportTools(dev);
  eco.railway();
  const line = T.lines()[0];
  check('A railway: a line with trains on it', !!line && T.times(line).length === TRAIN.hours.length, line);
  const [first] = T.times(line);
  const seen = [];
  sim.bus.on('toast', (e) => seen.push(e.key));
  const tavern = sim.economy.biz(sim.economy.ofType('tavern')[0]);
  const arrivals0 = T.S.arrivals;
  toMinute(sim, first - 20);
  const coming = T.at();
  check('Twenty minutes before: a train is on its way in', coming.length === 1 && coming[0].stage === 'in' && coming[0].t > 0 && coming[0].t < 1, JSON.stringify(coming));
  toMinute(sim, first + 5);
  check('It pulls in and waits at the platform', T.at()[0]?.stage === 'at' && T.S.arrivals === arrivals0 + 1);
  const tm = tavern.money;
  T.arrived(line, sim.time.total);
  check('Travellers spend at the tavern', tavern.money === tm + TRAIN.travellerSpend);
  toMinute(sim, first + TRAIN.dwell + 10);
  check('Then it goes back out', T.at()[0]?.stage === 'out');
  toMinute(sim, first + TRAIN.dwell + TRAIN.approach + 5);
  check('…and it\'s gone', !T.at().length);

  // Sending goods.
  sim.home.store('wood', 40, { force: true });
  const m0 = sim.state.player.money;
  const r = T.send(line, { wood: 30 });
  check('Goods sent by rail leave your storage (carriage paid)', r.ok && sim.home.storageCount('wood') === 10 && sim.state.player.money === m0 - T.fee(30));
  toMinute(sim, T.times(line)[1] + TRAIN.dwell + 1);
  check('The train takes them; they\'re sold there', T.S.sends[0]?.stage === 'sold' && T.S.sends[0].earned > 0, `$${T.S.sends[0]?.earned}`);
  const m1 = sim.state.player.money;
  runOn(sim)(3 * 1440);
  check('…and the money comes back on a later train', !T.S.sends.length && sim.state.player.money > m1 && seen.includes('toast.rail_takings'));

  // Ordering.
  const item = Object.keys(sim.settlements.def(line).produces)[0];
  sim.settlements.get(line).stock[item] = 200;
  const chk = T.canOrder(line, item, 20);
  check('Goods can be ordered from a town on the line', chk.ok, `${item}: $${chk.cost}`);
  T.order(line, item, 20);
  runOn(sim)((sim.settlements.days(line) + 1) * 1440);
  check('They arrive in the goods yard', (T.S.yard[item] || 0) === 20 && seen.includes('toast.rail_goods_in'));
  const inv0 = sim.inventory.count(item);
  T.collect();
  check('You collect them (as much as you can carry)', sim.inventory.count(item) > inv0);
  // Your workers fetch the rest.
  T.S.yard[item] = (T.S.yard[item] || 0) + 30;
  const look = sim.state.npcs[0].look;
  const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
  w.met = true;
  sim.workers.hire(w, 16);
  const s0 = sim.home.storageCount(item);
  runOn(sim)(2 * 1440);
  check('Your workers fetch what\'s in the yard to your storage', sim.home.storageCount(item) > s0 && T.yardTotal() < 30, `yard ${T.yardTotal()}`);

  // Newcomers by train.
  const people = sim.growth.arrive({ size: 1 });
  const st = T.station();
  const at = sim.world.toTile(people[0].x, people[0].y);
  check('Newcomers step off at the station', Math.abs(at.tx - st.door.tx) <= 2 && Math.abs(at.ty - st.door.ty) <= 2);

  // No dice; saved.
  const r0 = rand.getState();
  T.at();
  T.arrived(line, sim.time.total);
  T.departed(line, sim.time.total);
  check('The trains roll no dice', rand.getState() === r0);
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('The railway, the yard and what\'s on the way are saved', copy.trains.lines().length === 1 && copy.trains.S.arrivals === T.S.arrivals);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll train checks passed');
process.exit(failures ? 1 : 0);
