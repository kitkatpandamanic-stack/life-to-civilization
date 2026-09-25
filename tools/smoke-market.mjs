// Headless test for the housing market (building spec, Phase 7): prices and rents are made of
// parts (the building, its repair, location, road and well, district, land, demand, the rent it
// brings in; for rent also work, services and the street nearby); the market level follows supply
// and demand week by week; upgrades raise value but demand still rules; villager landlords follow
// the market and build to let when it pays; and it all survives save / load.
// Usage: node tools/smoke-market.mjs
import { Simulation } from '../src/core/Simulation.js';
import { REALTY, RENTAL } from '../src/data/housing.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const days = (sim, n) => {
  const end = sim.time.total + n * 1440;
  while (sim.time.total < end) sim.update(2000);
};

const sim = Simulation.newGame('T', 4242);
const P = sim.property;
const R = sim.realty;
const fresh = () => {
  R.priceCache.clear();
  R.rentCache.clear();
  P.valueCache.clear();
};
function newHouse(tile) {
  const c = sim.growth.start('village', 'small_house', 'rental', tile);
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c.id;
}

// 1. A price and a rent made of parts.
const pp = R.priceParts('house_1');
check('a price is made of parts', pp.parts.length >= 3 && pp.parts.some((p) => p.k === 'building') && pp.parts.some((p) => p.k === 'land'), pp.parts.map((p) => `${p.k}:${p.v}`).join(' '));
check('…that add up to its value', P.value('house_1') === pp.total, `${P.value('house_1')} / ${pp.total}`);
const rp = R.rentParts('house_1');
check('a rent is made of parts too', rp.parts.some((p) => p.k === 'base') && P.marketRent('house_1') === rp.total, rp.parts.map((p) => `${p.k}:${p.v}`).join(' '));

// 2. Location: the same house near the plaza is worth more than far out.
const central = newHouse({ tx: 55, ty: 44 });
const remote = newHouse({ tx: 104, ty: 12 });
fresh();
check('near the centre it is worth more', P.value(central) > P.value(remote), `${P.value(central)} vs ${P.value(remote)}`);

// 3. Repair counts.
const v0 = P.value(central);
P.rec(central).condition = 40;
fresh();
check('a run-down house is worth less', P.value(central) < v0 && R.priceParts(central).parts.find((p) => p.k === 'condition')?.v < 0);
P.rec(central).condition = 100;
fresh();

// 4. Supply and demand: with many looking and nothing free, the level climbs week by week.
for (const id of [central, remote]) sim.property.moveIn([sim.state.npcs.find((n) => n.age >= 20 && !P.lease(n.homeId) && P.rec(n.homeId)?.owner !== n.id && n.homeId !== central && n.homeId !== remote)], id);
const idx0 = R.idx;
for (let i = 0; i < 8; i++) sim.growth.arrive();
for (const n of sim.state.npcs.filter((x) => x.homeId === 'hall')) n.homeId = null;
const t = R.target();
check('newcomers without a roof: the market would be tighter', t.seekers > 0 && t.v > idx0, `seekers ${t.seekers}, target ${t.v.toFixed(2)} vs ${idx0.toFixed(2)}`);
const w1 = R.weekly();
check('…it moves a step, not all at once', R.idx > idx0 && R.idx - idx0 <= REALTY.maxStep + 1e-9, `${idx0.toFixed(2)} → ${R.idx.toFixed(2)}`);
R.weekly();
R.weekly();
fresh();
const rentHigh = P.marketRent('house_1');
check('…and rents follow', rentHigh > rp.total, `${rp.total} → ${rentHigh}`);
check('the week is on record', R.S.weeks.length >= 3 && R.S.weeks.at(-1).homes > 0 && w1.avgRent > 0);

// 5. …and when homes stand empty, it eases.
sim.state.realty.idx = 1.5;
for (let i = 0; i < 5; i++) newHouse();
for (const n of sim.state.npcs) if (!n.homeId) n.homeId = 'hall';
const tl = R.target();
R.weekly();
check('with homes standing empty, the market eases', tl.v < 1.5 && R.idx < 1.5, `target ${tl.v.toFixed(2)}, now ${R.idx.toFixed(2)}`);

// 6. An upgrade raises what a house is worth — but what it lets for still depends on demand.
const up = P.homes().find((id) => sim.structures.rec(id) && sim.structures.level(id) < 3 && !sim.economy.businessAtBuilding(id) && id !== 'hall');
fresh();
const before = P.value(up);
sim.structures.rec(up).lvl++;
sim.structures.changed(up);
fresh();
check('an upgraded house is worth more', P.value(up) > before, `${before} → ${P.value(up)}`);
const rentUp = P.marketRent(up);
sim.state.realty.idx = 0.7;
fresh();
check('…but in a slack market its rent falls anyway', P.marketRent(up) < rentUp, `${rentUp} → ${P.marketRent(up)}`);
sim.state.realty.idx = 1.1;
fresh();

// 7. A house let out: a buyer pays for the rent it brings in.
const letH = central;
P.transfer(letH, 'player', 'gift');
if (!P.lease(letH)) P.startLease(letH, sim.npcs.residentsOf(letH)[0]);
P.lease(letH).rent = 40;
fresh();
check("a let house's price counts its rent", R.priceParts(letH).parts.some((p) => p.k === 'income' && p.v > 0));

// 8. Villager landlords follow the market.
const landlord = sim.state.npcs.find((n) => n.age >= 25 && !n.traits.includes('generous') && !n.traits.includes('greedy'));
const own = newHouse();
P.transfer(own, landlord.id, 'bought');
P.rec(own).forRent = true;
P.rec(own).rentLevel = 'normal';
P.rec(own).emptyDays = 20;
P.landlordsReview();
check('an empty house to let: the landlord asks less', P.rec(own).rentLevel === 'cheap');
const tenant = sim.state.npcs.find((n) => n.age >= 18 && n.id !== landlord.id && !landlord.family.includes(n.id) && n.homeId !== own);
P.moveIn([tenant], own);
sim.state.realty.idx = 1.5;
P.landlordsReview();
check('let, with homes short: the rent goes up', P.rec(own).rentLevel === 'normal');

// 9. Building pays: with homes short and rents high, a villager with money builds to let.
const builder = sim.state.npcs.find((n) => n.age >= 25 && n.age < 60 && !sim.growth.projectOf(n) && n.id !== landlord.id);
builder.money = 5000;
sim.state.realty.idx = 1.6;
sim.state.realty.weeks.push({ ...R.S.weeks.at(-1), avgRent: 30 });
check('homes short, rents high: a villager builds a house to let', sim.growth.buildToLet(builder) && sim.growth.projectOf(builder)?.purpose === 'rental');
const site = sim.growth.projectOf(builder);
site.delivered = { ...site.required };
site.labor = site.laborNeeded;
sim.construction.tryComplete(site);
check('…and when it is finished, it is to let', P.rec(site.id)?.owner === builder.id && P.housingState(site.id) === 'for_rent', P.housingState(site.id));
const poor = sim.state.npcs.find((n) => n.age >= 25 && !sim.growth.projectOf(n) && n !== builder);
poor.money = 50;
check("…but not someone who can't afford it", !sim.growth.buildToLet(poor));
sim.state.realty.idx = 0.9;
builder.money = 5000;
check("…and nobody builds to let when homes stand empty", !sim.growth.buildToLet(sim.state.npcs.find((n) => n.age >= 25 && !sim.growth.projectOf(n) && n !== builder && (n.money = 5000))));

// 10. Save and load: the market's level and its record.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('after loading: the market level', sim2.realty.idx === R.idx);
check('after loading: the weeks on record', sim2.realty.S.weeks.length === R.S.weeks.length);

// 11. A few weeks of it all.
let crashed = null;
try {
  days(sim, 21);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll market checks passed');
process.exit(failures ? 1 : 0);
