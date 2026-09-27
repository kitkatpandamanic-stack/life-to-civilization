// Headless test for a growing town's needs and the little things around them:
//   granary   — the harvest tithe, buying up the farms' surplus, selling wheat when bread gets dear
//   trades    — clothes and boots wear out; villagers buy new at a tailor's / cobbler's; the trades open
//               where people go without; busy shops in a bigger town take on more hands
//   meetings  — new proposals (a bigger grain store, a free clinic…), who argues for and against
//   traders   — order something for next market day, collect it (a quarter down, the rest then)
//   family    — a child of yours grows up and chooses a way in life; what became of them
//   seasons   — the lake freezes; swimmers on a hot day
//   guide     — the "Village life" chapter measured from the world
//   speed     — counting the trees round a spot with the grid gives the same answer as counting them all
//   and       — saving; old saves; no dice
// Usage: node tools/smoke-town.mjs
import { Simulation } from '../src/core/Simulation.js';
import { GRANARY } from '../src/systems/GranarySystem.js';
import { TRADES } from '../src/systems/TradesSystem.js';
import { COMMUNITY } from '../src/systems/CommunitySystem.js';
import { PROPOSALS } from '../src/systems/TownSystem.js';
import { GUIDE } from '../src/data/guide.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 8484);
const T = sim.time;
const p = sim.state.player;
const E = sim.economy;
const V = sim.state.village;
V.treasury = 1500;
p.money = 1000;
const at = (day, hour) => (sim.state.time.totalMinutes = day * 1440 + hour * 60);

// ---------------------------------------------------------------- granary
const G = sim.granary;
const farm = E.ofType('farm')[0];
E.biz(farm).stock.wheat = 200;
const r0 = rand.getState();
const got = G.tithe();
check('The harvest tithe: a share of the farm\'s wheat into the grain store', got === Math.floor(200 * GRANARY.tithe) && G.S.wheat === got);
E.biz(farm).stock.wheat = E.target(farm, 'wheat') + 50;
const tv = V.treasury;
const bought = G.buySurplus();
check('A week of plenty: the farm\'s surplus bought up cheaply', bought > 0 && V.treasury < tv && G.S.wheat === got + bought);
const store = E.ofType('general_store')[0];
E.biz(store).stock.wheat = 0;
E.biz(store).money = 500;
const tv2 = V.treasury;
const sold = G.release();
check('Bread dear: wheat sold to the shops, the money back to the treasury', sold > 0 && V.treasury > tv2 && (E.biz(store).stock.wheat || 0) > 0);
G.enlarge();
check('A bigger grain store (a town meeting)', G.S.cap === GRANARY.bigCap);
check('The grain store rolls no dice', rand.getState() === r0);

// ---------------------------------------------------------------- trades
const Tr = sim.trades;
const adult = sim.state.npcs.find((n) => n.age >= 20 && n.age < 60);
adult.clothesDay = T.day - TRADES.wear.clothes - 1;
check('Worn-out clothes: they want new ones', Tr.wants(adult, 'clothes'));
// A tailor's in the valley.
const id = 'tl1';
sim.state.businesses[id] = { id, type: 'tailor', building: 'store', owner: sim.state.npcs.find((n) => n.age >= 25 && !n.owns)?.id, money: 200, stock: { clothes: 6 }, daysUnpaid: 0, markup: 1, wageLevel: 1, reputation: 50, maxWorkers: 2, history: [], today: { rev: 0, exp: 0 }, opened: T.day, nameIdx: 0 };
adult.money = 200;
const m0 = adult.money;
for (let d = 0; d < 7; d++) {
  at(T.day + 1, 10);
  Tr.shop();
}
check('…and buy them at the tailor\'s (a little happier)', adult.clothesDay >= T.day - 7 && adult.money < m0 && sim.state.trades.sold.clothes >= 1, `${sim.state.trades.sold.clothes} sold`);
sim.state.civic.status = 'town';
const b = E.biz(store);
b.money = 1000;
const mw = b.maxWorkers ?? E.def(store).maxWorkers;
Tr.growBusinesses();
check('A town\'s busy shops take on another hand', (b.maxWorkers ?? 0) > mw);
// Villagers open a tailor's where the town's big enough and people go without (EnterpriseSystem.opportunity).
delete sim.state.businesses[id];
const small = sim.enterprise.opportunity('tailor');
sim.state.trades.wanting.clothes = 40;
for (let i = 0; i < 20; i++) sim.state.npcs.push({ ...sim.state.npcs[0], id: `x${i}` });
const big = sim.enterprise.opportunity('tailor');
sim.state.npcs.splice(-20);
check("A tailor's is wanted in a bigger town where people go without", big > small && big > 0, `${small.toFixed(1)} → ${big.toFixed(1)}`);

// ---------------------------------------------------------------- meetings
check('New proposals a meeting can decide', ['granary', 'new_well', 'bridge', 'planting_fund', 'free_clinic'].every((k) => PROPOSALS[k]));
sim.state.town.meeting = { id: 99, proposal: 'free_clinic', day: T.day + 2, spoke: null };
const v = sim.town.voices(2);
check('Who argues for it and who against', v.for.length + v.against.length > 0, JSON.stringify(v));
const old = sim.state.npcs.find((n) => n.age >= 55);
if (old) check('…the old are for a free clinic', sim.town.lean(old, 'free_clinic') > sim.town.lean(old, 'pave_square') - 0.5);
sim.state.town.meeting = null;

// ---------------------------------------------------------------- traders
const C = sim.community;
const M = COMMUNITY.market;
at(T.day + ((M.weekday - T.weekday + 7) % 7 || 7), 10);
const pm = p.money;
const ord = C.orderFromTraders('iron_ingot', 5);
check('Order from the traders (a quarter down)', ord.ok && p.money === pm - Math.ceil(C.traderOrderPrice('iron_ingot') * 5 * COMMUNITY.traderOrder.deposit));
check('…not ready till next market day', C.canCollect(ord.order).reason === 'not_yet_brought');
at(T.day + 7, 10);
const pm2 = p.money;
const col = C.collectOrder(ord.order.id);
check('…next market day: pay the rest and it\'s yours', col.ok && sim.inventory.count('iron_ingot') + sim.home.storageCount('iron_ingot') >= 5 && p.money === pm2 - (C.traderOrderPrice('iron_ingot') * 5 - ord.order.paid + (ord.order.paid - Math.ceil(C.traderOrderPrice('iron_ingot') * 5 * COMMUNITY.traderOrder.deposit))));

// ---------------------------------------------------------------- family
const D = sim.dynasty;
const kid = sim.npcs.spawn({ gender: 'm', age: 16, occupation: 'unemployed', homeId: p.homeId, money: 0, kin: { spouse: null, parents: ['player'], children: [], siblings: [] }, traits: ['hard_worker'] });
p.children.push(kid.id);
D.up(kid.id).pts.carpentry = 40;
let grown = null;
sim.bus.on('dynasty:grown', (g) => (grown = g));
sim.chronicle('chronicle.npc_grew_up', { npc: kid.id, gender: 'm' });
check('Your child grows up: a way in life to choose', !!grown && grown.trade === 'carpenter_hand');
const pk = p.money;
check('…help them into the trade they learned at your side', D.chooseCareer(kid.id, 'trade').ok && kid.prevOccupation === 'carpenter_hand' && p.money < pk);
check('…once', !D.chooseCareer(kid.id, 'free').ok);
const fut = D.futures();
check('What became of your children (for the succession screen)', fut.some((f) => f.id === kid.id && f.kind === 'grown'), JSON.stringify(fut.find((f) => f.id === kid.id)));

// ---------------------------------------------------------------- seasons
at(Math.floor(T.day / 56) * 56 + 56 + 42 + 4, 12);
check('Winter: the lake freezes over', T.season === 'winter' && C.lakeFrozen());
at(Math.floor(T.day / 56) * 56 + 56 + 14 + 5, 14);
sim.seasons.temperature = () => 26;
let swimmer = null;
for (const n of sim.state.npcs) {
  if (n.age < 8 || n.age > 45) continue;
  n.plan = null;
  const pl = C.pull(n);
  if (pl?.why === 'swim') {
    swimmer = { n, pl };
    break;
  }
}
check('A hot summer afternoon: some go down to the lake to swim', !!swimmer && sim.world.inBounds(swimmer.pl.at.tx, swimmer.pl.at.ty) && !sim.world.isWater(swimmer.pl.at.tx, swimmer.pl.at.ty));
delete sim.seasons.temperature;

// ---------------------------------------------------------------- guide
const life = GUIDE.find((c) => c.chapter === 'life');
check('The "Village life" chapter', !!life && life.steps.length >= 5);
sim.state.townOrders.done = 1;
check('…its steps are measured from the world', life.steps.find((s) => s.id === 'town_order').done(sim) && !life.steps.find((s) => s.id === 'stall_day').done(sim));

// ---------------------------------------------------------------- speed: the grid
const N = sim.nature;
const brute = (tx, ty, r) => Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'grown' && o.variant !== 'apple' && Math.abs(o.tx - tx) <= r && Math.abs(o.ty - ty) <= r).length;
const spots = Object.values(sim.state.objects).filter((o) => o.kind === 'tree').slice(0, 30);
check('Counting the trees round a spot: the fast way gives the same answer', spots.every((o) => N.forestAround(o.tx, o.ty, 3) === brute(o.tx, o.ty, 3)));
const tree = Object.values(sim.state.objects).find((o) => o.kind === 'tree' && o.state === 'grown' && o.variant !== 'apple');
const before = N.forestAround(tree.tx, tree.ty, 2);
sim.resources.fellTree(tree.id);
check('…and it notices a tree felled', N.forestAround(tree.tx, tree.ty, 2) === before - 1);

// ---------------------------------------------------------------- saved
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Saved: the grain store, the wardrobe, the grown child\'s choice', copy.granary.S.wheat === G.S.wheat && copy.state.trades.sold.clothes === sim.state.trades.sold.clothes && copy.dynasty.D.grown[kid.id]?.choice === 'trade');
const o = JSON.parse(JSON.stringify(sim.state));
delete o.granary;
delete o.trades;
delete o.dynasty.grown;
const s2 = new Simulation(o);
const end = s2.time.total + 2 * 1440;
while (s2.time.total < end) s2.update(4000);
check('An old save loads and plays on', s2.granary.S.cap === GRANARY.cap && s2.time.total >= end);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll town checks passed');
process.exit(failures ? 1 : 0);
