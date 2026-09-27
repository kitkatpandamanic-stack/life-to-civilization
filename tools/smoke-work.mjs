// Headless test for more work, the woods and the valley's people:
//   jobs      — the village's own jobs (paid from the treasury), jobs that only exist when there's call for
//               them, piece pay, hourly work, bargaining, tips and speed premiums, ranks, lining up a second
//               job, outings to the woods and meadows, tree planting, counter-offers on favours, "best pay"
//   stall     — renting the market stall, setting out goods, villagers buying, closing time
//   forestry  — forest health, the felling limit, foresters, planting and tending, you planting, winter
//               growth, timber from outside, orchards and apples, the woods growing back
//   people    — life stages and the pyramid, births and deaths following how the valley does, the young going
//               to the towns and coming back, the labour market, the forecast, the new policies
//   and       — saving; old saves; no dice
// Usage: node tools/smoke-work.mjs
import { Simulation } from '../src/core/Simulation.js';
import { JOBS, JOB_PAY } from '../src/data/jobs.js';
import { FOREST } from '../src/data/forestry.js';
import { STALL } from '../src/systems/StallSystem.js';
import { POP } from '../src/systems/PopulationSystem.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 9191);
const p = sim.state.player;
const J = sim.jobs;
const T = sim.time;
const V = sim.state.village;
p.money = 500;
p.level = 6;
p.reputation = 20;
p.energy = 100;
V.treasury = 2000;
const setTime = (season, dayOf, hour) => {
  const idx = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
  sim.state.time.totalMinutes = (Math.floor(T.day / 56) * 56 + idx * 14 + dayOf - 1) * 1440 + hour * 60;
};
const done = [];
sim.bus.on('job:completed', (j) => done.push(j));

// ---------------------------------------------------------------- jobs
check('Many more jobs on the board', Object.keys(JOBS).length >= 50, `${Object.keys(JOBS).length}`);
setTime('summer', 2, 17);
J.refresh();
check("The village hires: the lamplighter's round, paid from the treasury", J.employerOf('lamplighter') === 'village' && (sim.state.jobs.openings.lamplighter || 0) > 0);
check('No gravedigger without a funeral', !J.existsToday('gravedigger'));
sim.state.graveyard.push({ id: 'x_dead', died: T.day, age: 80, gender: 'm', nameIdx: 1, surnameIdx: 1 });
check('…someone has died: a grave to dig', J.existsToday('gravedigger'));
const t0 = V.treasury;
const m0 = p.money;
check('Took the lamplighter job: straight out on the round', J.accept('lamplighter') && J.active.stage === 'deliver' && J.active.targets.length === 4);
for (const b of [...J.active.targets]) J.turnIn(b);
check('Lamps lit, paid by the village', !J.active && p.money > m0 && V.treasury < t0 && V.treasury === t0 - (p.money - m0), `${p.money - m0}`);

// Piece pay: bring more than asked.
setTime('summer', 2, 8);
J.refresh();
const base = J.pay('berry_picking');
J.accept('berry_picking');
sim.inventory.add('berries', JOBS.berry_picking.qty + 5, { force: true });
J.updateStage();
const m1 = p.money;
J.turnIn('store');
const last = done[done.length - 1];
check('Piece pay: the 5 extra berries are paid for too', last.jobId === 'berry_picking' && last.extra === 5 && last.extras.piece > 0 && p.money - m1 >= base + last.extras.piece, JSON.stringify(last.extras));
check('…and a quick delivery earns a premium', (last.extras.speed || 0) > 0);

// Hourly work.
setTime('summer', 2, 8);
J.refresh();
const one = J.pay('road_mending', { hours: 1 });
check('Hourly work: six hours pay six times one', Math.abs(J.pay('road_mending', { hours: 6 }) - one * 6) <= 3, `${one} → ${J.pay('road_mending', { hours: 6 })}`);
J.accept('road_mending', { hours: 2 });
check('…you choose how long', J.active.hours === 2 && J.startShift() === 120);
const m2 = p.money;
J.finishShift();
check('…and are paid for those hours', p.money - m2 >= one * 2 - 2 && p.money - m2 <= one * 2 + 2, `${p.money - m2}`);

// Bargaining.
J.refresh();
const r0 = rand.getState();
const before = J.pay('tavern_cellar');
const bg = J.bargain('tavern_cellar');
check('Ask for more: an answer, and no dice', bg.ok && ['yes', 'half', 'no'].includes(bg.result) && rand.getState() === r0, bg.result);
check('…a yes means more pay', bg.result === 'no' ? J.pay('tavern_cellar') === before : J.pay('tavern_cellar') > before, `${before} → ${J.pay('tavern_cellar')}`);
check('…once a day', J.bargain('tavern_cellar').reason === 'already_bargained');

// Ranks.
p.jobStats.courier = JOB_PAY.ranks[2].from - 1;
const rankBefore = J.rankOf('courier').id;
setTime('summer', 2, 9);
J.refresh();
J.accept('courier');
J.pickup();
J.turnIn(J.active.target);
check('Ranks: the twelfth time you do a job, you are Skilled at it — and paid more', rankBefore === 'hand' && J.rankOf('courier').id === 'skilled' && J.rankMult('courier') > 1.1);

// Two jobs: line one up.
J.refresh();
J.accept('courier');
check('Line up a second job', J.queue('market_porter') && sim.state.jobs.queued?.jobId === 'market_porter');
J.pickup();
J.turnIn(J.active.target);
check('…it starts when the first is done', J.active?.jobId === 'market_porter');
J.abandon();

// Outings.
setTime('autumn', 3, 7);
J.refresh();
check('Mushroom gathering: out in the woods', J.accept('mushroom_foraging') && J.active.stage === 'go' && !!J.active.place);
const pl = J.active.place;
check('…the place is found, and you can start there', J.atOutingPlace(pl.tx, pl.ty) && J.canStartOuting().ok);
J.startOuting();
J.finishOuting();
check('…mushrooms gathered, to take to the tavern', J.active?.stage === 'deliver' && sim.inventory.count('mushroom') >= 3);
const m3 = p.money;
J.turnIn('tavern');
check('…delivered and paid', !J.active && p.money > m3 && (sim.economy.biz('tavern').stock.mushroom || 0) >= 3);

// Tree planting.
setTime('autumn', 3, 8);
J.refresh();
check('Tree planting: take the saplings at the lumberyard', J.accept('tree_planting') && J.pickup() && J.active.stage === 'planting' && sim.inventory.count('sapling') === JOBS.tree_planting.qty);
const yard = sim.world.buildings.lumberyard.door;
const F = sim.forestry;
const m4 = p.money;
let planted = 0;
for (const s of F.spotsNear(yard.tx, yard.ty, 40, 20)) {
  if (!J.active) break;
  p.energy = 100;
  if (F.playerPlant(s.tx, s.ty, 'sapling').ok) planted++;
}
check('…each tree you plant counts, and the last one finishes it (paid per tree)', !J.active && planted === JOBS.tree_planting.qty && p.money - m4 >= JOBS.tree_planting.piece * planted, `${planted} planted, ${p.money - m4}`);

// Favours: a counter-offer.
const npc = sim.state.npcs.find((n) => n.age >= 20);
npc.money = 500;
sim.state.jobs.requests.push({ id: 900, npcId: npc.id, item: 'wood', qty: 3, reward: 20, expiresDay: T.day + 3, accepted: false });
const r1 = rand.getState();
const co = J.counterOffer(900);
check('Counter-offer on a favour: an answer, and no dice', co.ok && ['yes', 'half', 'no'].includes(co.result) && rand.getState() === r1, `${co.result} ${co.reward}`);
check('…only once', J.counterOffer(900).reason === 'already_bargained');
sim.state.jobs.requests = sim.state.jobs.requests.filter((r) => r.id !== 900);

// What pays best.
setTime('summer', 4, 9);
J.refresh();
const adv = J.advice();
check('What pays best today: listed by the hour, best first', adv.length > 3 && adv.every((a, i) => i === 0 || adv[i - 1].perHour >= a.perHour), `${adv.length} options, top ${adv[0]?.id || adv[0]?.kind}`);

// ---------------------------------------------------------------- stall
const St = sim.stall;
setTime('summer', 5, 8);
const t1 = V.treasury;
check('Rent the market stall for the day (the rent goes to the village)', St.open().ok && V.treasury === t1 + STALL.rent);
sim.inventory.add('apple', 12, { force: true });
check('Set out your apples', St.put('apple', 12).ok && St.S.goods.apple === 12 && sim.inventory.count('apple') === 0);
St.setMarkup(0.8);
// (someone has to mind it: you, standing by it)
const at = sim.world.tileCenter(STALL.spot.tx, STALL.spot.ty);
p.x = at.x;
p.y = at.y;
const r2 = rand.getState();
const m5 = p.money;
for (let h = STALL.open; h <= STALL.close; h++) St.onHour(h);
check('Villagers buy through the day (from their own purses)', St.S.earned > 0 && p.money - m5 === St.S.earned, `${St.S.earned}`);
check("…what's left comes back at closing time", !Object.keys(St.S.goods).length && sim.inventory.count('apple') + St.S.sold.reduce((s, x) => s + (x.item === 'apple' ? x.qty : 0), 0) === 12);
check('…and the stall rolls no dice', rand.getState() === r2);

// ---------------------------------------------------------------- forestry
const S0 = F.summary();
check('The woods start thick and healthy', S0.health >= 0.9 && S0.status === 'thick' && F.mayFell('lumberyard'));
// Cut most of them down.
const grown = Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'grown' && o.variant !== 'apple');
for (const o of grown.slice(0, Math.floor(grown.length * 0.6))) {
  o.state = 'stump';
  o.felledDay = T.day;
}
F.cache = null;
check('Cut down: thinning — below the felling limit', F.health() < F.limit(), `${Math.round(F.health() * 100)}%`);
F.felled('lumberyard');
F.felled('lumberyard');
check('…only a couple of trees a day may be felled', !F.mayFell('lumberyard'));
const r3 = rand.getState();
F.appointForesters();
const forester = sim.state.npcs.find((n) => n.occupation === 'forester');
check('The lumberyard takes on a forester', !!forester && forester.employer === 'lumberyard');
const task = F.nextTask(forester, yard);
const saps = F.counts().sapling;
check('…who finds somewhere to plant and plants it', task?.kind === 'plant' && F.doTask(forester, task) && F.counts().sapling === saps + 1);
F.onDay();
F.weekly();
check('Forestry rolls no dice', rand.getState() === r3);
// Tending.
const sap = Object.values(sim.state.objects).find((o) => o.kind === 'tree' && o.state === 'sapling');
const sd = sap.stageDay;
check('Tending a young tree brings it on', F.tend(sap) && sap.stageDay === sd - FOREST.tendDays && !F.tend(sap));
// Winter: saplings still grow, slowly.
setTime('winter', 5, 6);
sap.stageDay = T.day - 20;
sim.nature.onDay();
check('In winter a sapling still grows into a young tree', sap.state === 'young');
// Timber from outside when there's nothing to fell.
const ly = sim.economy.biz('lumberyard');
ly.stock.wood = 0;
ly.money = 400;
ly.noTreesDay = T.day;
F.importTimber();
check('Nothing to fell and the yard empty: timber sent for from outside', ly.stock.wood > 0 && F.S.imported > 0);
// You plant: an apple tree on your own land? (no land) — a sapling on a stump in the common woods.
const stump = Object.values(sim.state.objects).find((o) => o.kind === 'tree' && o.state === 'stump' && F.canPlantAt(o.tx, o.ty, { player: true }));
sim.inventory.add('apple_sapling', 1, { force: true });
p.energy = 100;
const ap = F.playerPlant(stump.tx, stump.ty, 'apple_sapling');
check('You plant an apple tree', ap.ok && ap.obj.variant === 'apple' && ap.obj.owner === 'player');
// Orchards.
setTime('spring', 1, 8);
sim.economy.biz('farm').money = 500;
F.plantOrchards();
const orchard = F.orchardOf('farm');
check('Farms plant orchards in spring', orchard.length >= 1);
for (const o of [...orchard, ap.obj]) o.state = 'grown';
setTime('autumn', 4, 8);
F.ripen();
check('Autumn: apples on the trees', orchard.every((o) => o.fruit > 0) && ap.obj.fruit > 0);
check("…the farm's are not yours to pick", F.canPick(orchard[0]).reason === 'orchard_not_yours');
const before2 = sim.inventory.count('apple');
check('…yours are', F.pick(ap.obj).ok && sim.inventory.count('apple') > before2);
const fa = sim.economy.biz('farm').stock.apple || 0;
F.farmPick();
check('The farm picks its orchard (the apples go to its stock)', (sim.economy.biz('farm').stock.apple || 0) > fa);
check("Woodcutters don't fell apple trees", !Object.values(sim.state.objects).some((o) => o.variant === 'apple' && o.reservedBy));
// The woods grow back: news.
for (const o of grown) {
  o.state = 'grown';
  delete o.felledDay;
}
F.cache = null;
F.S.low = 0.5;
F.weekly();
check('The woods grew back: in the chronicle', sim.state.chronicle.some((e) => e.key === 'chronicle.forest_regrown'));

// ---------------------------------------------------------------- people
const P = sim.population;
const st = P.stages();
check('Life stages add up to everyone', st.child + st.youth + st.adult + st.elder === P.pop(), JSON.stringify(st));
check('…and so does the pyramid', P.pyramid().reduce((s, b) => s + b.m + b.f, 0) === P.pop());
const bm = P.birthMult();
check('Births follow how the valley is doing', bm >= POP.birth.min && bm <= POP.birth.max, `×${bm.toFixed(2)}`);
sim.state.civic.headman = 'player';
check('As headman you set the family policy…', sim.civic.setPolicy('family', 'high'));
check('…an allowance makes babies likelier', P.birthMult() > bm);
const dm = P.deathMult();
sim.civic.setPolicy('health', 'high');
P.S.healthPaid = true;
check('A free clinic: people live longer', P.deathMult() < dm && P.lifeExpectancy().birth > 60, `${P.lifeExpectancy().birth} years`);
const mother = sim.state.npcs.find((n) => n.gender === 'f' && n.age >= 18);
const mm = mother.money;
const tv = V.treasury;
P.born({ id: 'baby' }, mother);
check('…and a baby brings its allowance (from the treasury)', mother.money === mm + POP.allowance && V.treasury === tv - POP.allowance);
const L = P.labour();
check('The labour market: vacancies against people looking', typeof L.factor === 'number' && L.factor >= POP.wage.min && L.factor <= POP.wage.max, JSON.stringify(L));
// The young go to the towns — and come back.
const young = sim.state.npcs.find((n) => n.age >= 18 && n.age <= 26 && !n.kin.spouse && !n.owns) || sim.state.npcs.find((n) => n.age >= 18 && !n.owns);
young.age = 20;
young.kin.spouse = null;
young.occupation = 'unemployed';
young.employer = null;
const money0 = young.money;
const r4 = rand.getState();
P.goAbroad(young);
sim.npcs.departed(young);
P.youthMoves();
check('Who goes to the towns (and when) follows no dice', rand.getState() === r4);
check('A young one sets off for the towns', !sim.npcs.byId(young.id) && P.S.abroad.some((a) => a.npc.id === young.id) && P.yearRec().abroad >= 1);
const a = P.S.abroad.find((x) => x.npc.id === young.id);
a.back = T.day;
a.left = T.day - 112;
P.returns();
const back = sim.npcs.byId(young.id);
check('…and comes home with savings and a trade', !!back && back.money > money0 && back.prevOccupation === a.trade && back.age === 22 && P.yearRec().returned >= 1);
const f = P.forecast(10);
check('A forecast for the next ten years', f.years.length === 10 && ['growing', 'shrinking', 'steady'].includes(f.trend), `${f.trend}: ${f.years[9].pop}`);
sim.state.civic.headman = null;
check('Only the headman sets the policies', !sim.civic.setPolicy('welcome', 'high'));

// ---------------------------------------------------------------- saved
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Saved: your ranks, the stall, the woods, the people', copy.jobs.timesDone('courier') === J.timesDone('courier') && copy.stall.S.total === St.S.total && copy.forestry.S.planted === F.S.planted && copy.population.S.allowances === P.S.allowances && Object.keys(copy.population.S.years).length >= 1);
const old = JSON.parse(JSON.stringify(sim.state));
delete old.forestry;
delete old.population;
delete old.stall;
delete old.player.jobStats;
delete old.jobs.bargains;
delete old.jobs.queued;
for (const k of ['forestry', 'family', 'health', 'welcome']) delete old.civic.policies[k];
const o = new Simulation(old);
check('An old save (from before) loads', o.forestry.S.planted === 0 && o.population.S.abroad.length === 0 && o.stall.S.day === -1 && o.jobs.timesDone('courier') === 0 && o.state.civic.policies.forestry === 'normal');
const end = o.time.total + 3 * 1440;
while (o.time.total < end) o.update(4000);
check('…and plays on', o.time.total >= end);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll work, woods and people checks passed');
process.exit(failures ? 1 : 0);
