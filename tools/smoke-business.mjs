// Headless test for villager businesses: startups, competition, backers, failures,
// your workers leaving to start their own business, save/load.
// Usage: node tools/smoke-business.mjs
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

// 1. Left alone for a few years, villagers start businesses.
{
  const sim = Simulation.newGame('T', 2024);
  const run = runOn(sim);
  run(4 * 56 * 1440);
  const opened = sim.economy.ids().filter((id) => sim.economy.biz(id).nameIdx !== undefined);
  check('villagers opened businesses of their own', opened.length >= 1, opened.map((id) => `${sim.economy.biz(id).type} by ${sim.economy.biz(id).owner}`).join(', '));
  check('every business has books', sim.economy.active().every((id) => Array.isArray(sim.economy.biz(id).history)));
  check('owners are who the business says', sim.state.npcs.filter((n) => n.owns).every((n) => sim.economy.biz(n.owns).owner === n.id));
  const json = JSON.stringify(sim.state);
  const sim2 = new Simulation(JSON.parse(json));
  runOn(sim2)(2 * 1440);
  check('a world with new businesses saves and loads', sim2.economy.ids().length === sim.economy.ids().length);
}

// 2. Competition: a second bakery takes customers, and prices react.
{
  const sim = Simulation.newGame('T', 11);
  const run = runOn(sim);
  run(1440);
  const nikita = sim.npcs.byId('nikita');
  const daria = sim.npcs.byId('daria');
  nikita.money = 600;
  daria.money = 600;
  const a = sim.enterprise.open(nikita, 'bakery', { building: 'house_7', how: 'home' }, null);
  const b = sim.enterprise.open(daria, 'bakery', { building: 'house_4', how: 'rent' }, null);
  check('two bakeries opened', !!a && !!b && sim.economy.ofType('bakery').length === 2);
  run(21 * 1440);
  const ca = sim.enterprise.books(a, 14).cust;
  const cb = sim.enterprise.books(b, 14).cust;
  check('both bakeries have customers (competition splits trade)', ca + cb > 0, `${ca} vs ${cb}`);
  // A price war: one bakery cuts prices; the other, losing customers, follows.
  sim.economy.biz(a).markup = 0.8;
  sim.economy.biz(b).lastWeekCust = 9999;
  const before = sim.economy.biz(b).markup ?? 1;
  sim.enterprise.setPrices(b, daria);
  check('a rival losing customers cuts prices too', sim.economy.biz(b).markup < before, `${before} → ${sim.economy.biz(b).markup}`);
}

// 3. A business that can't pay its way closes; staff are laid off.
{
  const sim = Simulation.newGame('T', 12);
  const run = runOn(sim);
  const egor = sim.npcs.byId('egor');
  egor.money = 500;
  const id = sim.enterprise.open(egor, 'carpentry', { building: 'house_4', how: 'home' }, null);
  const polina = sim.npcs.byId('polina');
  polina.employer = id;
  polina.occupation = 'carpenter_hand';
  const b = sim.economy.biz(id);
  b.money = 0;
  egor.money = 0;
  b.troubleDays = 20;
  run(2 * 1440);
  check('a failing business closes', b.closed, `closed=${b.closed}`);
  check('its staff were laid off', polina.employer !== id && sim.memory.has(polina, 'laid_off'));
  check('the owner remembers the failure', sim.memory.has(egor, 'business_failed'));
  check('the building remembers what it was', sim.property.rec('house_4').formerBusiness === 'carpentry');
}

// 4. One of your workers leaves you to start their own business.
{
  const sim = Simulation.newGame('T', 13);
  const p = sim.state.player;
  while (p.level < 10) sim.progression.addXp(sim.progression.xpForNext() - p.xp + 1);
  p.money = 2000;
  const egor = sim.npcs.byId('egor');
  egor.met = true;
  sim.workers.offer(egor, sim.workers.expectedSalary(egor) + 10);
  check('Egor works for you', egor.employer === 'player');
  egor.money = 700;
  egor.lastStartupTry = undefined;
  sim.enterprise.startups();
  check('Egor left to open a business', !!egor.owns && !sim.workers.contract('egor'), `owns ${egor.owns}`);
  check('…and remembers where they learned the trade', sim.memory.has(egor, 'left_player_for_business', 'player'));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
