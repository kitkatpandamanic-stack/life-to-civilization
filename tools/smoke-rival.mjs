// Headless test for the business rival (RivalSystem):
//   appears  — only once you're established; the most ambitious villager with money
//   competes — takes jobs left on the board a day or more; cuts your share of the carting; buys land;
//              an unhappy worker of yours may go over to them
//   you      — a price war (it costs you; they take few jobs, lose money, can go bust and sell up),
//              a partnership (on good terms: no competing, a weekly share), buying them out (their
//              land becomes yours)
//   and      — no dice; saved
// Usage: node tools/smoke-rival.mjs
import { Simulation } from '../src/core/Simulation.js';
import { RIVAL } from '../src/systems/RivalSystem.js';
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
function hire(sim, n) {
  const look = sim.state.npcs[0].look;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    sim.workers.hire(w, 16);
    out.push(w);
  }
  return out;
}
function established(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 20000;
  sim.progression.addXp(20000);
  hire(sim, 2);
  return sim;
}

// ================================================================== a rival appears
{
  const sim = Simulation.newGame('T', 9951);
  runOn(sim)(8 * 1440);
  check('A beginner has no rival', !sim.rival.R);
  const s2 = established(9952);
  const V = s2.rival;
  check('Established (level, workers): someone wants a share', V.ready());
  runOn(s2)(8 * 1440);
  check('A rival sets up in business (you\'re told)', V.active() && !!V.npc(), V.npc()?.id);
  check('…someone who isn\'t one of yours or running a business', V.npc().employer !== 'player' && !V.npc().owns);
  check('The village knows them as your rival', s2.state.chronicle.some((e) => e.key === 'chronicle.rival_appears'));
}

// ================================================================== they compete
{
  const sim = established(9953);
  const V = sim.rival;
  V.appear();
  const K = sim.contracts;
  // Jobs on the board, a day old.
  K.daily();
  for (const o of K.S.offers) o.posted = sim.time.day - 2;
  const n0 = K.S.offers.length;
  const r0 = rand.getState();
  V.midday();
  check('Jobs left on the board a day or more: they take some', K.S.offers.length < n0 && V.R.took > 0, `${n0} → ${K.S.offers.length}`);
  check('…without rolling the dice', rand.getState() === r0);
  sim.freight.signUp();
  const withRival = sim.freight.share();
  V.R.stage = 'partner';
  const without = sim.freight.share();
  V.R.stage = 'rival';
  check('Their carting business cuts your share of the loads', withRival < without, `${Math.round(without * 100)}% → ${Math.round(withRival * 100)}%`);
  V.R.money = 5000;
  V.R.lastPlotDay = -99;
  const plots0 = sim.land.forSale().length;
  V.daily();
  check('They buy land that\'s for sale', V.R.plots.length === 1 && sim.land.forSale().length === plots0 - 1 && sim.territory.owner(V.R.plots[0]) === V.R.npc);
  const [w] = sim.workers.list();
  w.satisfaction = 20;
  V.R.lastPoachDay = -99;
  const crew0 = V.R.crew;
  V.daily();
  check('An unhappy worker of yours goes over to them', !sim.workers.contract(w.npcId) && V.R.crew === crew0 + 1 && sim.npcs.byId(w.npcId).rivalCrew);
}

// ================================================================== a price war
{
  const sim = established(9954);
  const V = sim.rival;
  V.appear();
  const m0 = sim.state.player.money;
  const rel0 = V.npc().rel || 0;
  check('A price war costs you', V.priceWar().ok && sim.state.player.money === m0 - RIVAL.warCost && V.atWar());
  check('…and sours things between you', (V.npc().rel || 0) < rel0 || rel0 === 0);
  const K = sim.contracts;
  for (const o of K.S.offers) o.posted = sim.time.day - 2;
  const took0 = V.R.took;
  V.midday();
  check('During it they take few jobs', V.R.took - took0 <= 1);
  V.R.money = 60;
  runOn(sim)(3 * 1440);
  check('Their money runs out: they go bust (you\'re told)', V.R.stage === 'bust' && !V.active() && sim.state.chronicle.some((e) => e.key === 'chronicle.rival_bust'));
}

// ================================================================== partnership, buying out
{
  const sim = established(9955);
  const V = sim.rival;
  V.appear();
  V.npc().rel = 10;
  check('No partnership with someone you\'re not on good terms with', V.canPartner().reason === 'not_friends');
  V.npc().rel = RIVAL.partnerRel + 5;
  check('On good terms: partners', V.partner().ok && V.R.stage === 'partner' && !V.active());
  const K = sim.contracts;
  K.daily();
  for (const o of K.S.offers) o.posted = sim.time.day - 2;
  const n0 = K.S.offers.length;
  V.midday();
  check('Partners don\'t take your jobs', n0 > 0 && K.S.offers.length === n0);
  const m0 = sim.state.player.money;
  runOn(sim)(8 * 1440);
  check('…and a share of their takings comes to you each week', V.R.log.some((e) => e.kind === 'share') && sim.state.player.money !== m0);
  // Buy out.
  V.R.money = 2000;
  V.R.lastPlotDay = -99;
  V.R.stage = 'rival';
  V.daily();
  const plot = V.R.plots[0];
  const price = V.buyOutPrice();
  const m1 = sim.state.player.money;
  check('Buying them out', V.buyOut().ok && sim.state.player.money === m1 - price && V.R.stage === 'bought');
  check('…their land is yours', !plot || sim.territory.owner(plot) === 'player');
  // Saved.
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('The rivalry is saved', copy.rival.R?.stage === 'bought' && copy.rival.R.npc === V.R.npc);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll rival checks passed');
process.exit(failures ? 1 : 0);
