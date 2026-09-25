// Headless test for rental housing (building spec, Phase 5): each home has a clear housing
// state; a household renting a house has a lease (rent agreed, since when, what's been paid);
// you set the rent to the coin and sitting tenants react; you (or they) give notice and they
// move out; houses you let cost upkeep; a property manager looks after them for a share of the
// rent; well-off villagers buy houses to let and become landlords; and it all survives save / load.
// Usage: node tools/smoke-rental.mjs
import { Simulation } from '../src/core/Simulation.js';
import { RENTAL } from '../src/data/housing.js';

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
/** A new house, built by the village and standing empty. */
function newHouse() {
  const c = sim.growth.start('village', 'small_house', 'rental');
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c.id;
}
const P = sim.property;
const Lt = sim.letting;
const p = sim.state.player;
p.money = 5000;

// 1. Housing states.
check('your home: lived in by its owner', P.housingState(p.homeId) === 'owner_occupied', p.homeId);
const npcHome = P.homes().find((id) => !sim.economy.businessAtBuilding(id) && P.rec(id).owner !== 'player' && P.rec(id).owner !== 'village' && sim.npcs.residentsOf(id).some((n) => n.id === P.rec(id).owner));
check("a villager's own home: owner-occupied", npcHome && P.housingState(npcHome) === 'owner_occupied', npcHome);
check('a shop: a business', P.housingState('store') === 'business');
const site = sim.growth.start('village', 'small_house', 'rental');
check('a house being built: under construction', P.housingState(site.id) === 'under_construction');
site.delivered = { ...site.required };
site.labor = site.laborNeeded;
sim.construction.tryComplete(site);
const vacant = site.id;
check('built, the village offers it for rent', P.housingState(vacant) === 'for_rent', P.housingState(vacant));
check('there is an empty house', !!vacant, vacant);

// 2. Letting it: a lease at the rent asked.
P.transfer(vacant, 'player', 'gift');
check('an empty house of yours: vacant', P.housingState(vacant) === 'vacant');
Lt.list(vacant, true);
check('with the sign up: for rent', P.housingState(vacant) === 'for_rent');
const tenant = sim.state.npcs.find((n) => n.age >= 20 && n.age < 60 && n.homeId && P.rec(n.homeId)?.owner !== n.id && !P.lease(n.homeId) && Lt.household(n).length <= P.capacity(vacant));
tenant.money = 400;
const ask = P.weeklyRent(vacant);
Lt.moveIn(tenant, vacant, 'test');
const L = P.lease(vacant);
check('a household moves in: rented', P.housingState(vacant) === 'rented');
check('…with a lease: tenant, since, the rent agreed', L && L.tenant === tenant.id && L.since === sim.time.day && L.rent === ask, JSON.stringify(L));

// 3. Rent day.
let before = p.money;
P.collectRent();
check('rent day: you are paid', p.money - before === ask, `${p.money - before} / ${ask}`);
check('…and the lease keeps count', L.paid === ask);

// 4. Setting the rent to the coin: the tenant pays it from the next rent day.
const b = P.rentBounds(vacant);
P.setRent(vacant, ask + 2);
check('you set the rent to the coin', P.weeklyRent(vacant) === ask + 2);
check('…the sitting tenant pays it from next rent day', L.rent === ask && L.next === ask + 2);
before = p.money;
P.collectRent();
check('…and does', L.rent === ask + 2 && p.money - before === ask + 2);
P.setRent(vacant, 99999);
check("rent can't go past what the market bears", P.weeklyRent(vacant) === b.max, `${P.weeklyRent(vacant)} / ${b.max}`);
check('a big rise: the tenant gives notice', L.notice?.by === 'tenant', JSON.stringify(L.notice));
check("…talking them round fails while it's that dear", !P.withdrawNotice(vacant));
P.setRentLevel(vacant, 'normal');
check('…bring it back down and they stay', P.withdrawNotice(vacant) && !L.notice);

// 5. You give notice: not in the first fortnight (unless they owe rent) — then they have a week.
P.lease(vacant).since = sim.time.day - 3;
check("can't give notice to new tenants without cause", P.canGiveNotice(vacant).reason === 'too_soon');
P.lease(vacant).since = sim.time.day - 20;
const rep = p.reputation;
check('notice given after the first fortnight', P.giveNotice(vacant).ok && P.lease(vacant).notice?.by === 'landlord');
check('…it costs you some standing', p.reputation < rep);
check('…and the tenant remembers', tenant.memories.some((m) => m.k === 'given_notice' && m.w === 'player'));
days(sim, RENTAL.noticeDays + 1);
check('a week later they have gone', P.occupants(vacant) === 0 && !P.lease(vacant) && tenant.homeId !== vacant, `occupants ${P.occupants(vacant)}`);
check('…the tenancy is on record', P.rec(vacant).tenancies?.at(-1)?.how === 'notice' && P.rec(vacant).tenancies.at(-1).tenant === tenant.id);
check('…and they found a roof', !!tenant.homeId && tenant.homeId !== vacant, tenant.homeId);

// 6. Rent owing: notice with cause, at once, at no cost to your name.
const t2 = sim.state.npcs.find((n) => n.age >= 20 && n.id !== tenant.id && n.homeId && P.rec(n.homeId)?.owner !== n.id && !P.lease(n.homeId) && Lt.household(n).length <= P.capacity(vacant));
Lt.moveIn(t2, vacant, 'test');
for (const m of Lt.household(t2)) m.money = 0;
const spouse = sim.family.spouse(t2);
if (spouse) spouse.money = 0;
P.collectRent();
check('they could not pay: rent owing', P.rec(vacant).arrears === 1 && P.lease(vacant).missed === 1);
const rep2 = p.reputation;
const chk = P.canGiveNotice(vacant);
check('notice for rent owed is allowed at once', chk.ok && chk.cause);
P.giveNotice(vacant);
check('…without costing you standing', p.reputation === rep2);

// 7. Upkeep: a house you let costs you its repairs.
P.withdrawNotice(vacant);
for (const m of Lt.household(t2)) m.money = 500;
P.rec(vacant).condition = 80;
before = p.money;
const cond = P.rec(vacant).condition;
P.onDay();
check('a house you let: you pay its upkeep', before - p.money >= RENTAL.upkeepPerDay && P.rec(vacant).condition > cond, `${before - p.money}`);

// 8. A property manager.
const mgr = sim.state.npcs.find((n) => n.age >= 25 && n.id !== t2.id && !Lt.household(t2).includes(n));
mgr.rel = 5;
check('a stranger won\'t manage your houses', Lt.canHireManager(mgr).reason === 'need_rel');
mgr.rel = 40;
check('someone who knows you will', Lt.hireManager(mgr).ok && Lt.manager?.npc === mgr.id);
const second = newHouse();
if (second) {
  P.transfer(second, 'player', 'gift');
  P.rec(second).condition = 50;
  Lt.managerDay();
  check('the manager puts a sign up on an empty house', Lt.listed(second));
  check('…and has a run-down one repaired', P.rec(second).condition === 100);
} else check('a second empty house', false);
const mMoney = mgr.money;
Lt.S.lastRent = { day: sim.time.day, money: 100 };
const wd = sim.time.weekday;
Object.defineProperty(sim.time, 'weekday', { get: () => 0, configurable: true });
Lt.managerDay();
check('rent day: the manager takes their share', mgr.money - mMoney === Math.max(RENTAL.managerMinFee, Math.round(100 * RENTAL.managerFee)), `${mgr.money - mMoney}`);
const cash = p.money;
p.money = 0;
Lt.managerDay();
check("…and quits when you can't pay", !Lt.manager);
p.money = cash;
delete sim.time.weekday;
check('(time restored)', sim.time.weekday === wd);

// 9. Villagers as landlords.
const investor = sim.state.npcs.find((n) => n.age >= 30 && n.age < 60 && P.rec(n.homeId)?.owner === n.id);
investor.money = 5000;
for (const n of sim.state.npcs) if (n !== investor) n.money = Math.min(n.money, 100); // (the only one who can afford it)
P.rec(newHouse()).forSale = true; // a house on the market…
sim.state.realty.idx = 1.3; // …while people are looking for homes (the housing market's level)
P.valueCache.clear();
const chance = RENTAL.investChance;
RENTAL.investChance = 1;
P.investInHouses();
RENTAL.investChance = chance;
const bought = P.rentalsOf(investor.id);
check('a well-off villager buys a house to let', bought.length === 1, `${investor.id} ${bought}`);
check('…and offers it for rent', bought[0] && P.housingState(bought[0]) === 'for_rent');
if (bought[0]) {
  const renter = sim.state.npcs.find((n) => n.age >= 18 && n.id !== investor.id && !investor.family.includes(n.id) && n.homeId && P.rec(n.homeId)?.owner !== n.id && !P.lease(n.homeId));
  renter.money = 500;
  const hh = [renter];
  P.moveIn(hh, bought[0], 'moved');
  check('a household rents it from the villager', P.lease(bought[0])?.tenant === renter.id && P.landlord(renter) === investor.id);
  const iMoney = investor.money;
  P.collectRent();
  check('…and the villager landlord is paid', investor.money > iMoney, `+${investor.money - iMoney}`);
}

// 10. Save and load.
P.setRent(vacant, P.weeklyRent(vacant) + 1);
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('after loading: leases and past tenancies', JSON.stringify(sim2.property.rec(vacant).lease) === JSON.stringify(P.rec(vacant).lease) && sim2.property.rec(vacant).tenancies.length === P.rec(vacant).tenancies.length);
check('after loading: the rent you set', sim2.property.weeklyRent(vacant) === P.weeklyRent(vacant));

// 11. A few weeks of the valley with all this going on.
let crashed = null;
try {
  days(sim, 28);
} catch (e) {
  crashed = e;
}
check('four weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll rental checks passed');
process.exit(failures ? 1 : 0);
