// Headless test for the village's life together, and the things around it:
//   community — wedding feasts and funerals (who comes, what it does), name days (a gift counts double),
//               market day (the crowd, the traders, your stall sells more), public work for the poor (and
//               their pay), charity, a family with children not evicted, youths helping at the family
//               business (a trade by 16)
//   stall     — someone has to mind it; a keeper you pay for the day
//   jobs      — something happens on the job (a choice), no dice
//   orders    — an order from another town: taken, delivered, paid, the bonus; running out of time
//   woods     — your workers pick your apples and replant your woodlot; foresters stop planting once the
//               woods are back; a forester carries the sapling out
//   safety    — nobody walks into a building that's gone
//   and       — saving; old saves; no dice
// Usage: node tools/smoke-community.mjs
import { Simulation } from '../src/core/Simulation.js';
import { COMMUNITY } from '../src/systems/CommunitySystem.js';
import { STALL } from '../src/systems/StallSystem.js';
import { INCIDENTS } from '../src/systems/JobIncidents.js';
import { SETTLEMENTS } from '../src/data/settlements.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 7373);
const p = sim.state.player;
const T = sim.time;
const C = sim.community;
const V = sim.state.village;
V.treasury = 2000;
p.money = 1000;
const setTime = (dayOffset, hour) => {
  sim.state.time.totalMinutes = (T.day + dayOffset) * 1440 + hour * 60;
};
const at = (day, hour) => {
  sim.state.time.totalMinutes = day * 1440 + hour * 60;
};
const npcs = sim.state.npcs;
const adults = npcs.filter((n) => n.age >= 18);

// ---------------------------------------------------------------- weddings and funerals
const [a, b] = adults.filter((n) => !n.kin.spouse);
const friend = adults.find((n) => n !== a && n !== b);
friend.relations[a.id] = { f: 60, t: 40, r: 0, c: 0 };
a.relations[friend.id] = { f: 60, t: 40, r: 0, c: 0 };
const r0 = rand.getState();
sim.chronicle('chronicle.npc_married', { npc: a.id, npc2: b.id });
const wed = C.S.events.find((e) => e.kind === 'wedding');
check('A wedding: tomorrow evening, a feast on the square for family and friends', !!wed && wed.day === T.day + 1 && wed.guests.includes(friend.id));
const day0 = T.day;
at(day0 + 1, 17);
friend.plan = null;
const plan = C.pull(friend) || C.pull(a);
check('…the guests (and the couple) are pulled to the square', !!plan && plan.kind === 'gathering' && plan.why === 'wedding');
friend.plan = { ...C.pull(friend) ?? plan, event: wed.id };
C.arrived(friend);
const moodBefore = friend.mood ?? 60;
at(day0 + 1, 22);
C.onHour(22);
check('…afterwards: everyone who came is happier and closer to the couple', wed.done && (friend.mood ?? 60) >= moodBefore && sim.state.chronicle.some((e) => e.key === 'chronicle.wedding_feast'));
const dead = adults.find((n) => n !== a && n !== b && n !== friend && n.age >= 30);
sim.chronicle('chronicle.npc_died', { npc: dead.id, gender: dead.gender, n: dead.age });
const fun = C.S.events.find((e) => e.kind === 'funeral');
check('A funeral the morning after someone dies, by the hall', !!fun && fun.from === COMMUNITY.funeral.from && fun.at.tx === sim.world.buildings.hall.door.tx);
check('Weddings and funerals roll no dice', rand.getState() === r0);

// ---------------------------------------------------------------- name days
const nd = adults.find((n) => n !== a);
const today = T.day % 56;
at(Math.floor(T.day / 56) * 56 + C.nameDayOf(nd) + 56, 10);
check("It's their name day", C.isNameDay(nd));
sim.inventory.add('bread', 2, { force: true });
nd.lastGiftDay = -1;
const g2 = sim.social.gift(nd, 'bread');
at(T.day + 1, 10);
nd.lastGiftDay = -1;
const g1 = C.isNameDay(nd) ? null : sim.social.gift(nd, 'bread');
check('…a gift on the day counts double', !!g2 && !!g1 && g2.gain >= g1.gain * 1.8, `${g2?.gain} vs ${g1?.gain}`);
void today;

// ---------------------------------------------------------------- market day
const M = COMMUNITY.market;
at(T.day + ((M.weekday - T.weekday + 7) % 7), 10);
check('Market day: the traders are on the square', C.marketDay() && C.marketOpen());
const stock = C.traderStock();
const m0 = p.money;
const buy = C.buyFromTraders('glass', 1);
check('Buy from the traders (rare goods)', buy.ok && p.money === m0 - C.traderPrice('glass') && sim.inventory.count('glass') >= 1 && C.traderStock().glass === stock.glass - 1);
sim.inventory.add('chair', 2, { force: true });
const m1 = p.money;
const sell = C.sellToTraders('chair', 2);
check('…and they pay well for crafts', sell.ok && p.money - m1 === C.traderPays('chair') * 2 && C.traderPays('chair') > 0);
check("…but they don't buy just anything", C.sellToTraders('stone', 1).reason === 'traders_dont_buy');
const d0 = sim.stall.demand('bread');
at(T.day + 1, 10);
check('Your stall sells more on market day', sim.stall.demand('bread') < d0, `${d0.toFixed(2)} vs ${sim.stall.demand('bread').toFixed(2)}`);

// ---------------------------------------------------------------- the poor
const poor = adults.filter((n) => n.age < 60).slice(0, 3);
for (const n of poor) {
  n.occupation = 'unemployed';
  n.employer = null;
  n.money = 5;
  n.owns = null;
}
at(T.day + ((1 - T.weekday + 7) % 7 || 7), 12);
C.hirePublicWork();
const workers = poor.filter((n) => n.publicWork?.day === T.day);
check('Noon: the village takes the poorest on for an afternoon of public work', workers.length >= 1);
check("…they don't go looking for work that day", workers.every((n) => C.busyToday(n)));
at(T.day, 14);
const w0 = workers[0];
w0.plan = null;
const wp = C.pull(w0);
check('…off to mend the lanes', wp?.kind === 'publicwork' && !!wp.at);
w0.plan = wp;
C.arrived(w0);
const tv = V.treasury;
const pm = w0.money;
C.payPublicWork();
check('…and paid in the evening (what they gathered is sold; the village tops it up)', w0.money === pm + COMMUNITY.poor.wage && V.treasury === tv - (COMMUNITY.poor.wage - COMMUNITY.poor.yield));
const tv0 = V.treasury;
V.treasury = 0;
w0.publicWork = { day: T.day, at: wp.at, worked: true, paid: false };
const pm2 = w0.money;
C.payPublicWork();
check('…even when the treasury is empty, the afternoon pays something', w0.money === pm2 + COMMUNITY.poor.yield && V.treasury === 0);
V.treasury = tv0;
const rich = adults.find((n) => !poor.includes(n));
rich.traits = ['generous'];
rich.money = 500;
const poorest = poor[1];
poorest.money = 0;
check('The generous give to the poorest', C.charity() >= 1 && rich.money === 500 - COMMUNITY.charity.gift);
const family = Object.keys(sim.property.all).find((id) => sim.property.rec(id)?.owner === 'village' && sim.npcs.residentsOf(id).some((n) => n.age < 16));
if (family) check("A village landlord doesn't turn out a family with children", C.spareFamily(family, 'village'));

// ---------------------------------------------------------------- youths
const youth = npcs.find((n) => n.age >= 13 && n.age <= 17 && (n.kin?.parents || []).length) || npcs.find((n) => n.age < 16 && (n.kin?.parents || []).length);
if (youth) {
  youth.age = 15;
  const par = sim.npcs.byId(youth.kin.parents[0]);
  if (par && !par.owns && !par.employer) {
    par.employer = 'store';
    par.occupation = 'store_clerk';
  }
  at(T.day + ((0 - T.weekday + 7) % 7 || 7), 15);
  let hp = null;
  for (let k = 0; k < 10 && !hp; k++) {
    youth.plan = null;
    hp = C.pull(youth);
    if (!hp) at(T.day + 1 + ((0 - ((T.weekday + 1) % 7) + 7) % 7), 15);
  }
  check('A youth lends a hand at the family business after lessons', hp?.kind === 'help' && !!hp.building);
  if (hp) {
    youth.plan = hp;
    const mm = youth.money;
    C.arrived(youth);
    check('…pocket money, a hand for the business, a trade learnt', youth.money >= mm && C.helpPower(hp.biz) > 0 && youth.youthTrade?.days === 1);
    youth.youthTrade.days = COMMUNITY.youth.knowsAfter;
    C.cameOfAge(youth);
    check('…and at 16 they know it (employers take them on more readily)', youth.prevOccupation === youth.youthTrade.occ);
  }
}

// ---------------------------------------------------------------- stall keeper
const St = sim.stall;
at(T.day + 1 + ((0 - ((T.weekday + 1) % 7) + 7) % 7), 8);
p.x = 5 * 32;
p.y = 46 * 32;
St.open();
sim.inventory.add('apple', 10, { force: true });
St.put('apple', 10);
check("Nobody minding the stall: it doesn't sell", !St.minded());
St.onHour(9);
check('…nothing sold', St.S.earned === 0);
const kh = St.hireKeeper();
const keeper = sim.npcs.byId(kh.npc);
check('Pay someone to keep it for the day', kh.ok && St.minded() && keeper.stallKeeper === T.day && C.busyToday(keeper));
keeper.plan = null;
check('…they stand at your stall', C.pull(keeper)?.why === 'stall');
for (let h = 10; h < STALL.close; h++) St.onHour(h);
const km = keeper.money;
St.onHour(STALL.close);
check('…it sells, and they are paid at closing', St.S.earned > 0 && keeper.money === km + STALL.keeperWage && !St.S.keeper, `${St.S.earned}`);

// ---------------------------------------------------------------- jobs with a story
const J = sim.jobs;
const r1 = rand.getState();
let inc = null;
for (let k = 0; k < 40 && !inc; k++) inc = J.maybeIncident({ jobId: 'night_watch', acceptedAt: 1000 + k * 7, employer: 'village' });
check('Now and then something happens on the job', !!inc && inc.kind === 'thief' && !!INCIDENTS.thief);
const repBefore = p.reputation;
const res = J.resolveIncident('alarm');
check('…you choose, and it counts', res.ok && p.reputation > repBefore && !J.js.incident);
check('…no dice', rand.getState() === r1);

// ---------------------------------------------------------------- town orders
const O = sim.townOrders;
const town = Object.keys(SETTLEMENTS)[0];
sim.settlements.known = () => [town];
at(T.day + ((3 - T.weekday + 7) % 7 || 7), 8);
const order = O.offer();
check('A town you know sends an order', !!order && order.town === town && order.qty > 0 && order.perUnit > 0);
check('…take it on', O.take(order.id).ok && order.taken);
sim.inventory.add(order.item, order.qty, { force: true });
const om = p.money;
const half = Math.max(1, Math.floor(order.qty / 2));
sim.inventory.remove(order.item, order.qty - half);
const d1 = O.deliver(order.id);
check('…hand over part: paid for what you brought', d1.ok && !d1.finished && p.money === om + half * order.perUnit);
sim.inventory.add(order.item, order.qty, { force: true });
const d2 = O.deliver(order.id);
check('…and the rest: done, with the bonus', d2.ok && d2.finished && order.done && d2.pay === (order.qty - half) * order.perUnit + order.bonus);
at(T.day + 7, 8);
const o2 = O.offer();
if (o2) {
  O.take(o2.id);
  const rep0 = p.reputation;
  at(o2.deadline + 1, 8);
  O.onDay();
  check("An order taken on and not finished in time: they remember", o2.failed && p.reputation < rep0);
}

// ---------------------------------------------------------------- your woodlot and orchard
const F = sim.forestry;
const plot = sim.state.territory && Object.entries(sim.state.territory.plots).find(([, r]) => r.owner === 'village');
const land = plot ? sim.territory.all().find((q) => q.id === plot[0]) : null;
let spot = null;
if (land) {
  sim.territory.transfer(land.id, 'player', 'bought');
  for (let y = 0; y < sim.world.H && !spot; y++) for (let x = 0; x < sim.world.W && !spot; x++) if (sim.land.ownsTile(x, y) && F.canPlantAt(x, y, { player: true, apple: true })) spot = { x, y };
}
if (spot) {
  const apple = F.plant(spot.x, spot.y, { variant: 'apple', by: 'player', owner: 'player' });
  apple.state = 'grown';
  apple.fruit = 6;
  const W = sim.workers;
  const hand = adults.find((n) => !n.owns && n.age < 55 && !poor.includes(n));
  const hired = W.hire(hand, 15);
  const c = W.contract(hand.id);
  if (c) {
    const tasks = [];
    W.orchardTasks(hand, c, { tx: spot.x, ty: spot.y }, (t) => tasks.push(t));
    check('Your worker sees your apples to pick', tasks.some((t) => t.kind === 'opick'));
    apple.state = 'cleared';
    apple.fruit = 0;
    sim.home.store('apple_sapling', 1, { force: true });
    const t2 = [];
    W.orchardTasks(hand, c, { tx: spot.x, ty: spot.y }, (t) => t2.push(t));
    check('…and replants where your tree was felled (from the saplings in store)', t2.some((t) => t.kind === 'oplant'));
  } else check('Hire a hand for the woodlot', !!hired, 'could not hire');
}
check('The woods back to their old size: foresters tend, and stop planting', (() => {
  F.health = () => 1.1;
  const job = F.nextTask(adults[0], sim.world.buildings.lumberyard.door);
  delete F.health;
  return !job || job.kind === 'tend';
})());

// ---------------------------------------------------------------- safety
const walker = adults[1];
walker.task = { type: 'school', stage: 'start', data: {}, until: 0 };
sim.npcs.goInto(walker, 'nowhere_building');
check('Nobody walks into a building that has gone', walker.task.done === true);

// ---------------------------------------------------------------- saved
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Saved: the gatherings, the orders, the stall', copy.community.S.events.length === C.S.events.length && copy.townOrders.S.done === O.S.done && copy.stall.S.total === St.S.total);
const old = JSON.parse(JSON.stringify(sim.state));
delete old.community;
delete old.townOrders;
const o = new Simulation(old);
const end = o.time.total + 2 * 1440;
while (o.time.total < end) o.update(4000);
check('An old save (from before) loads and plays on', o.community.S.events.length >= 0 && o.townOrders.S.list.length >= 0 && o.time.total >= end);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll community checks passed');
process.exit(failures ? 1 : 0);
