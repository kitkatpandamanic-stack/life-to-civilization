// Headless test for the village growing into a town (TownSystem):
//   meetings — none in a small village; a large village calls one every couple of weeks, announced
//              ahead; your word sways the vote (for or against); passed, it's paid from the treasury
//              and done (gas lamps go up, a market day fills the store's till…)
//   growing  — a town wants a bigger hall (the village pays for the work); villagers build up sooner;
//              the street lamps burn gas
//   and      — no dice; saved
// Usage: node tools/smoke-town.mjs
import { Simulation } from '../src/core/Simulation.js';
import { TOWN, PROPOSALS } from '../src/systems/TownSystem.js';
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

{
  const sim = Simulation.newGame('T', 9981);
  const T = sim.town;
  runOn(sim)(5 * 1440);
  check('A small village holds no town meetings', !T.S.meeting && !T.S.history.length);
  sim.civic.V.status = 'large_village';
  sim.state.village.treasury = 3000;
  const seen = [];
  sim.bus.on('toast', (e) => seen.push(e.key));
  runOn(sim)(1440);
  const m = T.S.meeting;
  check('A large village calls a meeting (announced a few days ahead)', !!m && m.day > sim.time.day && seen.includes('toast.meeting_called'), m?.proposal);
  const r0 = rand.getState();
  const none = T.support(null);
  const yes = T.support('for');
  const no = T.support('against');
  check('Your word sways the valley (for helps, against hurts)', yes >= none && none >= no && yes > no, `${Math.round(no * 100)}% · ${Math.round(none * 100)}% · ${Math.round(yes * 100)}%`);
  check('…and nobody\'s vote is rolled', rand.getState() === r0);
  sim.state.player.reputation = 80;
  sim.civic.V.headman = 'player';
  check('A good name, and being headman, count for more', T.sway() > TOWN.sway.base + TOWN.sway.headman);
  // Gas lamps, passed.
  m.proposal = 'gas_lamps';
  T.speak('for');
  const lean = T.lean.bind(T);
  T.lean = () => 0.3;
  const lamps0 = sim.state.infra.lamps.length;
  const tr0 = sim.state.village.treasury;
  runOn(sim)((m.day - sim.time.day) * 1440 + 17 * 60 - sim.time.minuteOfDay);
  const rep0 = sim.state.player.reputation;
  runOn(sim)(3 * 60);
  T.lean = lean;
  const h = T.S.history[0];
  check('On the evening, the valley votes: passed', h?.passed && h.proposal === 'gas_lamps');
  check('…paid from the treasury', sim.state.village.treasury <= tr0 - PROPOSALS.gas_lamps.cost + 200);
  check('…and done: gas lamps go up', sim.state.infra.lamps.length > lamps0, `${lamps0} → ${sim.state.infra.lamps.length}`);
  check('You spoke for what passed: people remember', sim.state.player.reputation > rep0);
  check('The chronicle remembers', sim.state.chronicle.some((e) => e.key === 'chronicle.meeting_passed'));
  check('The next one is a couple of weeks away', !T.S.meeting && T.S.nextMeeting >= sim.time.day + TOWN.meetingEvery - 1);
  // Market day.
  PROPOSALS.market_day.run(sim);
  const store = sim.economy.biz(sim.economy.ofType('general_store')[0]);
  while (sim.time.weekday !== 5) {
    sim.state.time.totalMinutes += 1440;
  }
  const s0 = store.money;
  T.daily();
  check('A market day: the store does well', store.money === s0 + TOWN.marketIncome);
}

// ================================================================== growing
{
  const sim = Simulation.newGame('T', 9982);
  const T = sim.town;
  check('In a village, people build up only when they\'re well off', T.boom() === 1 && !T.gasLamps());
  sim.civic.V.status = 'town';
  check('In a town, sooner — and the lamps burn gas', T.boom() < 1 && T.gasLamps());
  sim.state.village.treasury = 5000;
  const lvl = sim.structures.rec('hall').lvl;
  check('A town wants a bigger hall', T.hallWanted() > lvl);
  check('…the village pays for the work', T.growHall() && !!sim.structures.works('hall'));
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Town business is saved', !!copy.town.S && copy.structures.works('hall')?.id === sim.structures.works('hall')?.id);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll town checks passed');
process.exit(failures ? 1 : 0);
