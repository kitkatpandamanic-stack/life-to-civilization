// Headless test for the wider world (Phase 6): other settlements with their own economies,
// prices that move with supply and demand, contact through exploration, your trade journeys
// (cargo, transport, the market at the other end, coming home), roads between settlements,
// caravans from the valley's warehouses, people moving between places, districts, save / load.
// Usage: node tools/smoke-regions.mjs
import { Simulation } from '../src/core/Simulation.js';
import { SETTLEMENTS, PLAYER_TRANSPORT } from '../src/data/settlements.js';
import { ITEMS } from '../src/data/items.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

const sim = Simulation.newGame('T', 606);
const run = runOn(sim);
const S = sim.settlements;
const p = sim.state.player;

// 1. Places beyond the valley.
check('there are settlements beyond the valley', S.ids().length >= 5, S.ids().join(','));
check('you know of the ones in regions you know', S.known().every((id) => sim.exploration.region(SETTLEMENTS[id].region).known) && S.known().length >= 1, S.known().join(','));
check('…but trade with none of them yet', S.contacts().length === 0);
const rel = (id, item) => S.priceFactor(id, item);
check('what they make is cheap there, what they need is dear', rel('woodhollow', 'wood') < rel('woodhollow', 'bread') && rel('ironford', 'iron_ore') < rel('ironford', 'bread'), `wood ${rel('woodhollow', 'wood').toFixed(2)} vs bread ${rel('woodhollow', 'bread').toFixed(2)}`);
check('settlements differ in size', new Set(S.ids().map((id) => S.get(id).size)).size >= 2);

// 2. A week out there: they make, use, grow or shrink.
const pops0 = Object.fromEntries(S.ids().map((id) => [id, S.get(id).pop]));
for (let w = 0; w < 26; w++) S.weekly();
const stable = S.ids().every((id) => S.get(id).pop > pops0[id] * 0.6 && S.get(id).pop < pops0[id] * 1.6);
check('half a year on, they are still going (no collapse, no explosion)', stable, S.ids().map((id) => `${id} ${pops0[id]}→${S.get(id).pop}`).join(', '));
check('their stores follow production and needs', S.ids().every((id) => Object.values(S.get(id).stock).every((n) => n >= 0 && Number.isFinite(n))));

// 3. Contact through an expedition: a trading partner out there.
const lake = S.get('lakeside');
sim.exploration.region('lake_country').known = true;
sim.exploration.region('lake_country').partner = true;
run(1440);
check('a trading partner found on an expedition means trade with the settlement there', lake.contact && S.contacts().includes('lakeside'));
check('…which goes into the chronicle', sim.state.chronicle.some((e) => e.key === 'chronicle.settlement_contact'));
check('…and their prices become known', Object.keys(lake.known).length > 0);

// 4. The valley's surplus fetches more where it's needed.
const wood = S.exportFactor('wood');
check('known buyers raise what exported goods fetch', wood >= 1, wood.toFixed(2));
const woodStock = lake.stock.wood || 0;
S.absorbExport('wood', 10);
check('…and some of the goods end up in their stores', (lake.stock.wood || 0) > woodStock);

// 5. Your own trade journey to Woodhollow.
const wh = 'woodhollow';
sim.inventory.add('bread', 30, { force: true });
p.money = 100;
p.health = 100;
const cap = S.cargoCap();
check('on foot you can carry a small cargo', cap === PLAYER_TRANSPORT.foot.cargo, `${cap}`);
check('you cannot take more than you can carry', !S.canSetOut(wh, { bread: cap + 5 }).ok);
check('you cannot take goods you do not have', S.canSetOut(wh, { planks: 3 }).reason === 'not_enough');
const plan = S.canSetOut(wh, { bread: 18 });
check('you can set out with a cargo of bread (and food for the road)', plan.ok, JSON.stringify(plan));
const breadBefore = sim.inventory.count('bread');
const r = S.setOut(wh, { bread: 18 });
check('setting out takes the cargo and the food', r.ok && sim.inventory.count('bread') <= breadBefore - 18 - plan.food + 0 && S.R.journey.stage === 'out');
check('…and you are away', !!p.away);
check('you cannot go on an expedition at the same time', !sim.exploration.canSetOut('old_forest').ok);
run(r.days * 1440 + 5);
const j = S.R.journey;
check('days later you arrive', j?.stage === 'there');
check('…and Woodhollow now trades with the valley', S.get(wh).contact);
const price1 = S.sellPrice(wh, 'bread');
const cargoBread = j.cargo.bread || 0;
const sold = S.sell(wh === j.to ? 'bread' : 'bread', 5);
const price2 = S.sellPrice(wh, 'bread');
check('you sell bread at their price', sold.ok && p.money > 100, `+${sold.money}`);
check('…and every sale lowers the price', price2 <= price1, `${price1} → ${price2}`);
S.sell('bread', cargoBread);
check('selling everything empties that part of the cargo', !j.cargo.bread);
const woodPrice = S.buyPrice(wh, 'wood');
const bought = S.buy('wood', 12);
check('you buy their timber into your cargo', bought.ok && j.cargo.wood === 12);
check('…and buying raises the price', S.buyPrice(wh, 'wood') >= woodPrice);
check('you cannot buy more than you can carry', (S.buy('wood', 999), S.cargoUnits() <= S.cargoCap()));
const storageWood = sim.home.storageCount('wood');
S.headHome();
run(j.days * 1440 + 5);
check('you come home', !S.R.journey && !p.away);
check('…and the goods you bought are in your storage chest', sim.home.storageCount('wood') >= storageWood + 12);
check('…trading taught you something', (p.skills.trading?.xp || 0) > 0 || (p.skills.trading?.level || 0) > 0);

// 6. Better transport: carries more, travels faster.
check('a pack horse needs the village to know draft animals', !S.canBuyTransport('pack_horse').ok);
sim.tech.discover('handcart');
sim.tech.discover('draft_animals');
p.money = 1000;
const daysOnFoot = S.journeyPlan('lakeside').days;
const bh = S.buyTransport('pack_horse');
check('you can buy a pack horse once they do', bh.ok && p.transport === 'pack_horse');
check('…which carries more', S.cargoCap() > PLAYER_TRANSPORT.foot.cargo);
check('…and is faster on long journeys', S.journeyPlan('ironford').days <= Math.max(1, S.days('ironford')), `${S.journeyPlan('ironford').days} vs ${S.days('ironford')}`);
const m0 = p.money;
S.upkeep();
check('a horse has to be fed every week', p.money === m0 - PLAYER_TRANSPORT.pack_horse.upkeep);
check('horses shorten expeditions too', sim.exploration.tripDays('market_town') < 6, `${sim.exploration.tripDays('market_town')}`);
void daysOnFoot;

// 7. A better road.
const days0 = S.days('lakeside');
p.money = 5000;
const fr = S.fundRoad('lakeside');
check('you can pay for a better road to a settlement you trade with', fr.ok && !!lake.roadWork);
check('…and not twice at once', !S.canFundRoad('lakeside').ok);
run((lake.roadWork.done - sim.time.day + 1) * 1440);
check('weeks later the road is finished', lake.road === 1 && !lake.roadWork);
check('…and the journey is shorter or the road safer', S.days('lakeside') <= days0 && S.danger('lakeside') < 0.06, `${days0} → ${S.days('lakeside')} days`);

// 8. Caravans: a warehouse sends goods where they fetch most.
const merchant = sim.state.npcs.find((n) => !n.owns && n.age >= 25 && n.age < 55 && n.homeId && n.homeId !== 'hall');
merchant.money = 800;
const wid = sim.enterprise.open(merchant, 'warehouse', { building: merchant.homeId, how: 'home' }, null);
const wb = sim.economy.biz(wid);
wb.stock.wood = 60;
wb.money = 300;
lake.stock.wood = 0; // Lakeside is short of timber
S.dispatchCaravans();
const car = S.R.caravans.find((c) => c.biz === wid);
check('a warehouse sends a caravan with its goods', !!car && (car.goods.wood || 0) > 0, JSON.stringify(car?.goods));
const money0 = wb.money;
const lakeWood = lake.stock.wood || 0;
run((car.back - sim.time.total) + 30);
check('the caravan comes back', !S.R.caravans.includes(car));
check('…having sold its goods there (or been robbed)', car.earned > 0 || car.robbed, `sold for ${Math.round(car.earned)}, till ${money0} → ${Math.round(wb.money)}`);
check('…and bringing back what is cheap there', Object.keys(car.imports).length > 0 || car.robbed, JSON.stringify(car.imports));
check('…and the goods reached the other settlement', (lake.stock.wood || 0) > lakeWood || car.robbed);
// Your own warehouse: set a route.
wb.owner = 'player';
check('you can set a trade route for a warehouse you own', S.setRoute(wid, { to: 'lakeside', sell: ['wood'], buy: 'fish' }) && wb.route.to === 'lakeside');
wb.stock.wood = 40;
const planned = S.planCaravan(wid);
check('…and its caravans follow it', planned?.to === 'lakeside' && planned.goods.wood > 0);

// 9. People move between places.
const popL = lake.pop;
const dest = S.destinationFor([{}, {}]);
check('people who leave the valley go to a real place', !!dest && (dest !== 'lakeside' || lake.pop === popL + 2));
const origin = S.originFor(1);
check('newcomers come from somewhere you know', !!origin && S.known().includes(origin));

// 10. Districts: new kinds from what's built where.
sim.growth.updateDistricts();
const kinds = new Set(sim.state.districts.list.map((d) => d.type));
const valid = ['residential', 'commercial', 'industrial', 'agricultural', 'civic', 'education', 'entertainment', 'transport', 'mixed'];
check('districts are classified', [...kinds].every((k) => valid.includes(k)), [...kinds].join(','));

// 11. Saved and loaded in the middle of a journey.
sim.inventory.add('bread', 30, { force: true });
p.health = 100;
const r2 = S.setOut('lakeside', {});
check('another journey (empty-handed, to buy)', r2.ok);
run(r2.days * 1440 + 5);
const state = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(state);
check('a game saved at the market loads at the market', sim2.state.region.journey?.stage === 'there' && sim2.state.player.away);
const b2 = sim2.settlements.buy('fish', 5);
check('…and you can still trade there', b2.ok);
sim2.settlements.headHome();
runOn(sim2)(sim2.state.region.journey.days * 1440 + 5);
check('…and come home', !sim2.state.region.journey && sim2.home.storageCount('fish') >= 5);

// 12. A year of the wider world, with trade.
const sim3 = Simulation.newGame('Y', 909);
for (const id of sim3.settlements.ids()) {
  sim3.exploration.region(SETTLEMENTS[id].region).known = true;
  sim3.settlements.makeContact(id, 'test');
}
let crashed = null;
try {
  runOn(sim3)(112 * 1440);
} catch (e) {
  crashed = e;
}
check('a year with trade passes without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
const traded = sim3.settlements.ids().reduce((s, id) => s + sim3.settlements.get(id).trade, 0);
check('the valley trades with the other settlements', traded > 0, `${Math.round(traded)} worth`);
check('the valley is still there', sim3.state.npcs.length >= 12, `${sim3.state.npcs.length} villagers`);
check('prices out there are sane', sim3.settlements.ids().every((id) => Object.keys(sim3.settlements.get(id).stock).every((i) => { const f = sim3.settlements.priceFactor(id, i); return f >= 0.4 && f <= 2.4 && ITEMS[i]; })));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll regional checks passed.');
process.exit(failures ? 1 : 0);
