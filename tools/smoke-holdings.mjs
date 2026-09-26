// Headless test for your property and businesses: buying a village business, running
// it (prices, wages, staff, manager, till), opening one in your own premises, orders
// from other businesses, stakes and loans, home comforts, save / load.
// Usage: node tools/smoke-holdings.mjs
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

const sim = Simulation.newGame('T', 601);
const run = runOn(sim);
const p = sim.state.player;
const E = sim.economy;
const H = sim.holdings;
p.money = 20000;
run(3 * 1440);

// 1. Buying a village business.
const tavern = E.ofType('tavern')[0];
const oldOwner = E.owner(tavern);
check('it has a value and an asking price', H.valuation(tavern) > 0 && H.askingPrice(tavern).ok, JSON.stringify(H.askingPrice(tavern)));
check('you need level 10 to run a business', !H.buy(tavern).ok);
p.level = 10;
const r = H.buy(tavern);
check('you can buy it', r.ok && E.biz(tavern).owner === 'player', `$${r.price}`);
check('the premises came with it', sim.property.rec(E.biz(tavern).building).owner === 'player');
check('the old owner stays on as your manager', oldOwner.employer === tavern && E.biz(tavern).manager === oldOwner.id);
check('the sale is remembered', oldOwner.memories.some((m) => m.k === 'sold_business_to_player'));

// 2. Running it: the village keeps coming, the money is real.
const till0 = E.biz(tavern).money;
H.setMarkup(tavern, 0.9);
H.setWageLevel(tavern, 1.1);
H.setStaffTarget(tavern, 2);
check('you set prices, wages and staff', E.biz(tavern).markup === 0.9 && E.biz(tavern).wageLevel === 1.1 && E.biz(tavern).maxWorkers === 2);
run(7 * 1440);
const books = sim.enterprise.books(tavern, 7);
check('customers come and the books fill in', books.cust > 0 && books.rev > 0, `rev ${books.rev}, exp ${books.exp}, ${books.cust} customers`);
check('staff work there', sim.npcs.staffOf(tavern).length >= 1, sim.npcs.staffOf(tavern).map((n) => n.id).join(','));
check('a manager keeps it running while you are away', H.presence(tavern) > 0.6);
const got = H.withdraw(tavern, 50);
check('you can take money out of the till', got === 50 || E.biz(tavern).money < 50);
H.setStaffTarget(tavern, 0);
check('cutting staff lays people off', sim.npcs.staffOf(tavern).length === 0);
H.setStaffTarget(tavern, 1);

// 3. Opening a business in premises you own.
// (an empty house — or any house nobody runs a business from, emptied)
const free = (id) => !E.businessAtBuilding(id) && !sim.businesses.atBuilding(id) && id !== sim.state.player.homeId && id !== 'hall';
const vacant = sim.property.homes().find((id) => sim.property.isVacant(id) && free(id)) || sim.property.homes().find((id) => id.startsWith('house_') && free(id));
for (const n of sim.npcs.residentsOf(vacant)) n.homeId = null;
sim.npcs.invalidateHouseholds();
sim.property.transfer(vacant, 'player', 'bought', 0);
check('your empty premises can take a business', H.canOpenIn(vacant).ok, JSON.stringify(H.canOpenIn(vacant)));
const opened = H.open(vacant, 'bakery');
check('you open a bakery', opened.ok && E.biz(opened.id).owner === 'player' && E.businessAtBuilding(vacant) === opened.id);
H.setStaffTarget(opened.id, 2);
// Everyone may already be working: good wages draw people from other jobs.
H.setWageLevel(opened.id, 1.5);
run(9 * 1440);
check('good wages draw workers to it', sim.npcs.staffOf(opened.id).length >= 1, `${sim.npcs.staffOf(opened.id).length} staff`);

// 4. Orders from other businesses.
let order = null;
for (let i = 0; i < 30 && !order; i++) order = sim.contracts.make_order();
check('other businesses order from yours', !!order, order ? `${order.item} ×${order.qty}` : '');
if (order) {
  sim.state.contracts.offers.push(order);
  sim.contracts.accept(order.id);
  E.biz(order.supplierBiz).stock[order.item] = order.qty + 5;
  const till = E.biz(order.supplierBiz).money;
  const rep = E.biz(order.supplierBiz).reputation;
  sim.contracts.fulfilOrder(order.id);
  check('filling it pays your business and builds its name', E.biz(order.supplierBiz).money > till && E.biz(order.supplierBiz).reputation > rep);
}

// 5. Investing: a stake and a loan.
const target = E.active().find((id) => E.owner(id) && E.biz(id).owner !== 'player');
const owner = E.owner(target);
owner.met = true;
owner.rel = 50;
const offer = H.stakeOffer(target);
check('you can offer to buy into a business', offer.ok, JSON.stringify(offer));
check('…and take a stake', H.invest(target).ok && E.biz(target).stakes.some((s) => s.who === 'player'));
const other = E.active().find((id) => id !== target && E.owner(id) && E.biz(id).owner !== 'player' && !E.biz(id).loan);
check('you can lend a business money', H.lend(other, 200).ok && E.biz(other).loan.lender === 'player');
const m0 = p.money;
for (let w = 0; w < 3; w++) run(7 * 1440);
check('stakes and loans pay you back', p.money > m0, `+${Math.round(p.money - m0)}`);
check('your portfolio lists them', H.portfolio().length >= 2);

// 6. Home: reading, fireplaces and winter.
p.homeTier = 'large_house';
p.energy = 90;
const lvl = p.skills.learning.xp + p.skills.learning.level * 1000;
check('a bookshelf to read at', sim.home.canRead().ok && sim.home.read());
check('reading teaches you', p.skills.learning.xp + p.skills.learning.level * 1000 > lvl);
p.homeTier = 'shack';
const winterCold = (season) => {
  Object.defineProperty(sim.time, 'season', { get: () => season, configurable: true });
  const c = sim.home.comfort();
  delete sim.time.season;
  return c;
};
check('a shack is cold in winter', winterCold('winter') < winterCold('summer'));
p.homeTier = 'large_house';
sim.seasons.S.warmDay = -99;
check('…but a fire with no firewood is no use (SeasonSystem)', winterCold('winter') < winterCold('summer'));
sim.seasons.S.warmDay = sim.time.day;
check('a fireplace (with wood burning) keeps the cold out', winterCold('winter') === winterCold('summer'));

// 7. Save / load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('your businesses survive save / load', sim2.holdings.mine().length === 2 && sim2.holdings.portfolio().length >= 1);
runOn(sim2)(2 * 1440);
check('…and keep trading', sim2.enterprise.books(tavern, 2).rev > 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
