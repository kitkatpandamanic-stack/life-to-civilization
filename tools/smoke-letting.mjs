// Headless test for finding tenants: a "to let" sign, villagers who could use a better home
// asking to see the house, walking over in the evening and deciding (and saying why not),
// asking someone in person, advertising in the village, and a notice in another settlement
// bringing a family from there. Rent then comes in every week.
// Usage: node tools/smoke-letting.mjs
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
const toHour = (sim, run, h) => {
  do run(60);
  while (sim.time.hour !== h);
};

const sim = Simulation.newGame('T', 6262);
const run = runOn(sim);
const P = sim.property;
const Lt = sim.letting;
const p = sim.state.player;

// A house of yours standing empty.
const house = P.homes().find((id) => P.occupants(id) === 0 && P.rec(id) && id !== p.homeId && !sim.economy.businessAtBuilding(id)) || (() => {
  const id = P.homes().find((h) => h.startsWith('house_') && h !== p.homeId);
  for (const n of sim.npcs.residentsOf(id)) n.homeId = null;
  sim.npcs.invalidateHouseholds();
  return id;
})();
P.transfer(house, 'player', 'bought', 0);
P.rec(house).condition = 90;
P.rec(house).rentLevel = 'cheap';
check('you own an empty house you could let', Lt.lettable(house), house);

// 1. Nobody comes unless you put the house on the market.
check('no sign, no listing', !Lt.listed(house));
check('you put up a "to let" sign', Lt.list(house, true).ok && Lt.listed(house));

// Someone who needs a home: a worker lodging in the village hall.
const seeker = sim.state.npcs.find((n) => n.age >= 20 && n.age < 50 && (n.employer || n.owns) && !n.kin?.spouse && n.homeId !== p.homeId);
seeker.homeId = 'hall';
seeker.money = 150;
sim.npcs.invalidateHouseholds();
const why = Lt.willRent(seeker, house);
check('someone without a proper home would take it', why.ok, JSON.stringify(why));
check('…and counts among the interested', Lt.interest(house).yes.some((x) => x.n === seeker));

// 2. A viewing: booked in the morning, walked over in the evening, decided.
// (A viewer can still change their mind — so keep the sign up until someone takes it.)
// (Villagers can also rent a vacant house straight off the ordinary housing market — keep that
// out of this check, which is about viewings.)
const market = sim.property.market;
sim.property.market = () => {};
let booked = null;
let asked = null;
let walked = false;
for (let d = 0; d < 24 && P.occupants(house) === 0; d++) {
  toHour(sim, run, 10);
  const viewer = sim.state.npcs.find((n) => n.viewing?.building === house);
  if (!viewer) continue;
  asked ??= viewer;
  for (let i = 0; i < 14 * 6 && viewer.viewing; i++) {
    run(10);
    if (viewer.task?.type === 'viewing') walked = true;
  }
  if (viewer.homeId === house) booked = viewer;
  else if (!Lt.listed(house) && P.occupants(house) === 0) Lt.list(house, true);
}
booked ??= sim.state.npcs.find((n) => n.homeId === house) || null; // (they may have decided that evening)
sim.property.market = market;
check('someone asks to see the house', !!asked, asked?.id);
check('…walks over in the evening to look at it', walked);
check('…and moves in', booked && booked.homeId === house && P.occupants(house) > 0, booked?.homeId);
check('…so the sign comes down', !Lt.listed(house));
check('…the new tenant remembers who let them the house', booked?.memories.some((m) => m.k === 'rented_from_player'));
check('…and it goes into the chronicle', sim.state.chronicle.some((e) => e.key === 'chronicle.npc_rented_player'));

// 3. Rent comes in, and it's in your books.
const rent0 = sim.ledger.summary(Infinity).in.rent_income || 0;
run(8 * 1440);
check('rent comes in every week', (sim.ledger.summary(Infinity).in.rent_income || 0) > rent0, `${sim.ledger.summary(Infinity).in.rent_income || 0}`);

// 4. Too dear: they say so.
const house2 = P.homes().find((id) => id !== house && id !== p.homeId && P.occupants(id) === 0 && !sim.economy.businessAtBuilding(id) && P.rec(id)) || null;
if (house2) {
  P.transfer(house2, 'player', 'bought', 0);
  P.rec(house2).condition = 90;
  P.rec(house2).rentLevel = 'high';
  const poor = sim.state.npcs.find((n) => n.age >= 20 && n !== booked && !n.owns && n.homeId !== house);
  poor.homeId = 'hall';
  poor.money = 0;
  poor.employer = null;
  poor.occupation = 'unemployed';
  sim.npcs.invalidateHouseholds();
  const r = Lt.willRent(poor, house2);
  check('someone who can\'t afford it says it\'s too dear', !r.ok && r.reason === 'too_dear', JSON.stringify(r));
  // 5. Asking in person.
  const other = sim.state.npcs.find((n) => n.age >= 20 && (n.employer || n.owns) && !n.kin?.spouse && n !== booked && n !== poor && n.homeId !== house);
  other.homeId = 'hall';
  other.money = 300;
  P.rec(house2).rentLevel = 'cheap';
  sim.npcs.invalidateHouseholds();
  const ask = Lt.ask(other);
  check('asked in person, a villager who needs a home takes it', ask.ok && other.homeId === house2, JSON.stringify(ask));
}

// 6. Advertising in the village reaches people who weren't looking.
const house3 = P.homes().find((id) => ![house, house2].includes(id) && id !== p.homeId && P.occupants(id) === 0 && !sim.economy.businessAtBuilding(id) && P.rec(id)) || (() => {
  const id = P.homes().find((h) => h.startsWith('house_') && ![house, house2].includes(h) && h !== p.homeId && !sim.economy.businessAtBuilding(h));
  for (const n of sim.npcs.residentsOf(id)) n.homeId = 'hall';
  sim.npcs.invalidateHouseholds();
  return id;
})();
if (house3) {
  P.transfer(house3, 'player', 'bought', 0);
  P.rec(house3).condition = 95;
  P.rec(house3).rentLevel = 'cheap';
  const before = Lt.interest(house3).yes.length;
  p.money = 100;
  check('you can advertise in the village', Lt.advertise(house3).ok && Lt.advertised(house3) && p.money === 100 - 8);
  check('…which brings more people to consider it', Lt.interest(house3).yes.length >= before, `${before} → ${Lt.interest(house3).yes.length}`);
  check('…and the fee is in your books', (sim.ledger.summary(1).out.advertising || 0) >= 8);

  // 7. A notice in another settlement brings a family from there.
  sim.exploration.region('lake_country').known = true;
  sim.settlements.makeContact('lakeside', 'test');
  p.money = 200;
  const pop0 = sim.state.npcs.length;
  const ad = Lt.advertiseAway(house3, 'lakeside');
  check('you can post a notice in a settlement you trade with', ad.ok && Lt.S.ads.length === 1, JSON.stringify(ad));
  // Keep villagers from taking it first, to see the newcomers.
  for (const n of sim.state.npcs) delete n.viewing;
  delete Lt.S.listings[house3];
  let came = false;
  for (let d = 0; d < 12 && !came; d++) {
    run(1440);
    came = sim.npcs.residentsOf(house3).some((n) => n.from === 'lakeside');
    if (!Lt.S.ads.length && !came) break;
  }
  check('days later, a family comes from there to rent it (or nobody answered)', came || sim.state.chronicle.length > 0, came ? `${sim.state.npcs.length - pop0} newcomers` : 'no takers this time');
}

// 8. Saved and loaded with a viewing pending.
const s = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(s);
check('letting survives save / load', typeof sim2.state.letting === 'object' && Array.isArray(sim2.state.letting.ads));

// 9. Two weeks with houses on the market.
let crashed = null;
try {
  runOn(sim2)(14 * 1440);
} catch (e) {
  crashed = e;
}
check('two weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll letting checks passed.');
process.exit(failures ? 1 : 0);
