// Headless test for the economy: the wheat → flour → bread chain, shortages that stop
// production, quality of businesses' goods and customers who weigh it against price,
// wages that respond to the labour market, seasonal farm hands, taxes, loans.
// Usage: node tools/smoke-economy.mjs
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

const sim = Simulation.newGame('T', 701);
const run = runOn(sim);
const E = sim.economy;
const EN = sim.enterprise;

// 1. The mill: only once the village knows how.
check('nobody opens a mill before the village knows milling', EN.opportunity('mill') < -5);
sim.tech.discover('milling');
check('once it does, a mill is an opportunity', EN.opportunity('mill') > -5, EN.opportunity('mill').toFixed(2));
const premises = sim.property.homes().find((id) => sim.property.isVacant(id)) || 'house_4';
for (const n of sim.npcs.residentsOf(premises)) n.homeId = null;
sim.npcs.invalidateHouseholds();
const mill = EN.villageMill(premises);
check('the mill opens with a miller', !!mill && E.owner(mill)?.occupation === 'miller', E.owner(mill)?.id);
const store = E.ofType('general_store')[0];
const farm = E.ofType('farm')[0];
E.biz(farm).stock.wheat = 80;
E.biz(mill).money += 300;
run(4 * 1440);
check('the mill buys wheat from the farm and grinds flour', E.stock(mill, 'flour') > 0 || EN.books(mill, 4).rev > 0, `flour ${E.stock(mill, 'flour')}, sold ${EN.books(mill, 4).rev}`);
check('shops buy the flour', (E.stock(store, 'flour') > 0 || sim.state.logistics.shipments?.some?.((s) => s.item === 'flour')) || EN.books(mill, 4).rev > 0);
// Flour makes twice the bread: compare one day's baking with and without it.
const bakeWith = (flour, wheat) => {
  const b = E.biz(store);
  b.stock.flour = flour;
  b.stock.wheat = wheat;
  b.stock.bread = 0;
  b.progress = {};
  E.produce(store);
  return b.stock.bread;
};
const withFlour = bakeWith(20, 0);
const byHand = bakeWith(0, 20);
check('bread from flour is far more productive than grinding by hand', withFlour > byHand * 1.5, `${withFlour} vs ${byHand}`);

// 2. A shortage stops production — and the village hears of it.
const b = E.biz(store);
b.stock.flour = 0;
b.stock.wheat = 0;
b.stock.bread = 0;
E.noteShortage(store, 'bread', null);
E.produce(store);
E.produce(store);
check('with no flour or wheat, no bread is made', b.stock.bread === 0 && b.short?.bread?.input);
check('the shortage is news', sim.state.chronicle.some((e) => e.key === 'chronicle.business_short'));
b.stock.flour = 10;
E.produce(store);
check('…and it lifts when supplies arrive', b.stock.bread > 0 && !b.short?.bread);

// 3. Quality, and customers who can or can't afford it.
const bakeryA = E.ofType('general_store')[0];
const tavern = E.ofType('tavern')[0];
// Two shops selling bread: make it a contest between a fine, dear one and a plain, cheap one.
const baker = sim.state.npcs.find((n) => !n.owns && n.age >= 22 && n.age < 55 && n.occupation !== 'miller');
const vacant2 = sim.property.homes().find((id) => id !== premises && id !== sim.state.player.homeId && !E.businessAtBuilding(id) && id !== 'hall');
for (const n of sim.npcs.residentsOf(vacant2)) n.homeId = null;
sim.npcs.invalidateHouseholds();
let bakery = null;
if (vacant2) {
  baker.money = 1000;
  bakery = EN.open(baker, 'bakery', { building: vacant2, how: 'rent' }, null);
}
check('a rival bakery opens', !!bakery);
if (bakery) {
  E.biz(bakery).stock.bread = 20;
  E.biz(bakeryA).stock.bread = 20;
  E.biz(bakery).quality = 2.6;
  E.biz(bakery).markup = 1.35;
  E.biz(bakeryA).quality = 0.7;
  E.biz(bakeryA).markup = 0.85;
  const buyer = sim.state.npcs.find((n) => n.age >= 18 && n.homeId && !n.owns);
  buyer.money = 500;
  const richPick = E.chooseShop(buyer, ['bread'], { openNow: false });
  buyer.money = 15;
  const poorPick = E.chooseShop(buyer, ['bread'], { openNow: false });
  check('the well-off pay for better bread', richPick === bakery, `${richPick}`);
  check('the hard-up go for the cheapest', poorPick === bakeryA, `${poorPick}`);
  check('finer goods fetch a little more', E.unitPrice(bakery, 'bread') > E.unitPrice(bakeryA, 'bread'));
}
// Quality follows the people making it.
const q0 = E.biz(tavern).quality ?? 1;
for (const n of sim.state.npcs.filter((x) => x.employer === tavern || x.owns === tavern)) {
  n.level = 9;
  n.workedToday = true;
}
for (let i = 0; i < 20; i++) E.updateQuality(tavern);
check('skilled staff raise a business’s quality', E.biz(tavern).quality > q0, `${q0} → ${E.biz(tavern).quality}`);

// 4. Wages and the labour market.
for (const n of sim.state.npcs) if (n.occupation === 'unemployed') n.occupation = 'elder';
const tb = E.biz(tavern);
tb.money = 800;
tb.maxWorkers = 4;
const w0 = tb.wageLevel ?? 1;
EN.setWages(tavern, E.owner(tavern));
check('short-handed in a tight labour market, a business raises wages', tb.wageLevel > w0, `${w0} → ${tb.wageLevel}`);

// 5. Seasonal farm hands.
const baseFarm = E.def(farm).maxWorkers;
const setSeason = (s) => Object.defineProperty(sim.time, 'season', { get: () => s, configurable: true });
setSeason('summer');
EN.seasonalStaff();
check('farms take on extra hands for summer and harvest', E.biz(farm).maxWorkers >= baseFarm + 2);
setSeason('winter');
EN.seasonalStaff();
check('…and let them go for winter', E.biz(farm).maxWorkers === baseFarm && sim.npcs.staffOf(farm).length <= baseFarm);
delete sim.time.season;

// 6. Taxes fill the village fund.
const p = sim.state.player;
p.money = 2000;
const t0 = sim.state.village.treasury;
sim.property.transfer('house_7', 'player', 'bought', 0);
sim.finance.weekly();
const log = sim.state.village.taxLog.at(-1);
check('businesses and property owners pay taxes into the fund', sim.state.village.treasury > t0 && log.business + log.property > 0, `+${sim.state.village.treasury - t0}`);
check('you pay tax on what you own', log.player > 0, `${log.player}`);

// 7. Borrowing from the fund.
sim.state.village.treasury = 1000;
p.reputation = 10;
const m0 = p.money;
check('you can borrow from the village fund', sim.finance.borrow(400).ok && p.money === m0 + 400 && p.loan.left > 400);
const left = p.loan.left;
sim.finance.repayLoan();
check('it is paid back weekly', p.loan.left < left);
p.money = 0;
const rep = p.reputation;
sim.finance.repayLoan();
check('a missed payment costs your standing', p.loan.missed === 1 && p.reputation < rep);

// 8. Save / load, and the world runs on.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('the chain, loans and taxes survive save / load', sim2.economy.biz(mill) && sim2.state.player.loan && sim2.state.village.taxLog.length);
runOn(sim2)(7 * 1440);
check('the world runs on', sim2.time.day > sim.time.day);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
