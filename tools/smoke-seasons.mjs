// Headless test for the seasons (SeasonSystem):
//   winter — your fire burns firewood from your home storage each evening (none: the fire's out, a cold
//            night); villagers who can't buy firewood are cold, unhappy, and ask for wood; snow lies
//            deeper and slows wheels and walkers until the roads are cleared (a snow-clearing job helps)
//   spring — the thaw's mud; the river rises (the same day in the same world), the clay pits go under
//            and come back full
//   autumn — the harvest rush (more farm openings, better pay); the guide says get your firewood in
//   and    — it all survives a save, and none of it rolls the game's dice
// Usage: node tools/smoke-seasons.mjs
import { Simulation } from '../src/core/Simulation.js';
import { seasonTools } from '../src/debug/seasonTools.js';
import { SEASONS } from '../src/systems/SeasonSystem.js';
import { JOBS } from '../src/data/jobs.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
const toasts = (sim) => {
  const seen = [];
  sim.bus.on('toast', (e) => seen.push(e.key));
  return seen;
};
/** Wind the clock to hour h of today (or tomorrow if it's past). */
const toHour = (sim, h) => {
  let m = (h * 60 - sim.time.minuteOfDay + 1440) % 1440;
  if (m === 0) m = 1440;
  runOn(sim)(m);
};

// ================================================================== winter: your fire
{
  const sim = Simulation.newGame('T', 9101);
  const ss = seasonTools({ sim });
  const seen = toasts(sim);
  const p = sim.state.player;
  check('A shack has no fire to feed (the start of the game is unchanged)', sim.seasons.burnRate() === 0);
  p.homeTier = 'house';
  check('A house has a fireplace: 2 wood an evening', sim.seasons.burnRate() === SEASONS.burn.fireplace);
  ss.go('winter');
  check('Winter comes with a word about your fire', seen.includes('toast.winter_fire'));
  while (sim.home.storageCount('wood')) sim.home.take('wood', sim.home.storageCount('wood'));
  toHour(sim, SEASONS.heatHour + 1);
  check('No firewood at home: the fire is out, you are told', !sim.seasons.heated() && seen.includes('toast.no_firewood'));
  check('…and the house is as cold as having no fire', sim.home.cold() > 0, `cold ${sim.home.cold()}`);
  sim.home.store('wood', 9, { force: true });
  ss.heat();
  check('Wood in store: the fire is lit (2 burned)', sim.seasons.heated() && sim.home.storageCount('wood') === 7);
  check('…and a fireplace keeps the cold out', sim.home.cold() === 0);
  toHour(sim, 10);
  check('Last night\'s fire still warms the morning', sim.seasons.heated() && sim.home.storageCount('wood') === 7);
  toHour(sim, SEASONS.heatHour + 1);
  check('The next evening it burns another 2', sim.home.storageCount('wood') === 5, `${sim.home.storageCount('wood')}`);
  check('The HUD knows how many nights are left', sim.seasons.summary().woodNights === 2);
  check('The guide warns you when the wood is running low', sim.guide.advice(12).some((a) => a.id === 'firewood'));
}

// ================================================================== winter: the villagers
{
  const sim = Simulation.newGame('T', 9102);
  const ss = seasonTools({ sim });
  ss.go('winter');
  sim.economy.cheapestWith = (item) => (item === 'wood' ? null : Object.getPrototypeOf(sim.economy).cheapestWith.call(sim.economy, item)); // (no firewood in any shop)
  // A household with someone able goes out for dead wood; one with only the old and the sick can't.
  const frail = sim.state.npcs.find((n) => n.age >= 16 && n.homeId && n.homeId !== sim.state.player.homeId)?.homeId;
  for (const n of sim.state.npcs) if (n.homeId === frail) n.health = 20;
  runOn(sim)(1440);
  check('No firewood in the shops: households are cold', sim.seasons.S.cold.length > 0, `${sim.seasons.S.cold.length} cold homes`);
  const coldOne = sim.state.npcs.find((n) => sim.seasons.isCold(n));
  const m0 = coldOne?.mood ?? 60;
  sim.seasons.setCold(sim.seasons.S.cold);
  check('…and unhappier for it (every cold day)', coldOne && coldOne.mood === Math.max(0, m0 - SEASONS.coldMood));
  check('A villager in a cold house is someone who\'d ask you for wood', !!coldOne);
}

// ================================================================== snow on the ground
{
  const sim = Simulation.newGame('T', 9103);
  const ss = seasonTools({ sim });
  ss.go('winter');
  sim.seasons.S.snow = 0;
  const cart = sim.equipment.create('handcart', { owner: 'player' });
  const bare = sim.equipment.moveMult(cart, false);
  sim.weather.change('snow');
  runOn(sim)(12 * 60);
  const depth = sim.seasons.snow();
  check('Snow falling piles up', depth > 0.3, `depth ${depth.toFixed(2)}`);
  check('Wheels bog down in deep snow off the road', sim.equipment.moveMult(cart, false) < bare * 0.9);
  check('Walking through it is slower too', sim.seasons.walkMult(false) < 0.95 && sim.seasons.walkMult(true) > sim.seasons.walkMult(false));
  sim.seasons.S.cleared = 0;
  const roadBefore = sim.seasons.wheelMult(true);
  sim.bus.emit('job:completed', { jobId: 'snow_clearing' });
  check('Someone clears snow: the roads are quicker', sim.seasons.S.cleared >= SEASONS.clearPerJob && sim.seasons.wheelMult(true) > roadBefore);
  check('The advice mentions snow on the roads', ss.snow(0.9) && sim.guide.advice(12).some((a) => a.id === 'snow_roads'));
  ss.go('spring');
  check('Spring: the snow thaws into mud', sim.seasons.thaw());
  check('…and wheels off the road are slow in the mud', sim.seasons.wheelMult(false) <= SEASONS.mudWheels + 1e-9);
  runOn(sim)(3 * 1440);
  check('The snow has gone a few days into spring', sim.seasons.snow() === 0);
}

// ================================================================== spring: the river rises
{
  let seed = 9200;
  let a;
  for (; seed < 9260; seed++) {
    a = Simulation.newGame('T', seed);
    if (a.seasons.floodPlan(1)) break;
  }
  const b = Simulation.newGame('T', seed);
  const plan = a.seasons.floodPlan(1);
  check('The river rises the same day in the same world', JSON.stringify(plan) === JSON.stringify(b.seasons.floodPlan(1)), JSON.stringify(plan));
  const seen = toasts(a);
  const pits = a.industry.clayPits();
  const dug = pits[0];
  dug.state = 'rubble';
  dug.regrowDay = 9999;
  runOn(a)(plan.day * 1440);
  check('On the day, the river floods (you are told)', a.seasons.flooding() && seen.includes('toast.river_up'));
  const full = pits.find((o) => o !== dug);
  check('The clay pits are underwater: nobody can dig them', pits.every((o) => a.seasons.underWater(o)) && !a.resources.isHarvestable(full));
  check('The chronicle remembers', a.state.chronicle.some((e) => e.key === 'chronicle.river_up'));
  runOn(a)((plan.days + 1) * 1440);
  check('The water goes down', !a.seasons.flooding() && seen.includes('toast.river_down'));
  check('…and every pit is full of fresh clay (even one dug out)', dug.state === 'full' && a.resources.isHarvestable(dug) && pits.every((o) => !a.seasons.underWater(o)));
  runOn(a)(3 * 1440);
  check('Only once a year', a.seasons.S.stats.floods === 1);
}

// ================================================================== autumn: the harvest rush
{
  const sim = Simulation.newGame('T', 9301);
  const ss = seasonTools({ sim });
  const seen = toasts(sim);
  const d = JOBS.farm_harvest;
  ss.go('summer');
  const summerPay = sim.jobs.pay('farm_harvest');
  const summerSlots = sim.jobs.slots(d);
  ss.go('autumn');
  check('Autumn: you hear it\'s harvest time', seen.includes('toast.harvest_rush'));
  check('The farms take on more hands', sim.jobs.slots(d) === summerSlots + d.rush.slots, `${summerSlots} → ${sim.jobs.slots(d)}`);
  check('…and pay more', sim.jobs.pay('farm_harvest') > summerPay, `$${summerPay} → $${sim.jobs.pay('farm_harvest')}`);
  sim.jobs.refresh();
  check('The notice board has the extra openings (when there\'s a crop to bring in)', !sim.jobs.existsToday('farm_harvest') || sim.state.jobs.openings.farm_harvest === sim.jobs.slots(d));
  // Late autumn, a house with a fireplace and no wood: get it in.
  sim.state.player.homeTier = 'house';
  sim.state.time.totalMinutes += (13 - (sim.time.dayOfSeason - 1)) * 1440;
  while (sim.home.storageCount('wood')) sim.home.take('wood', sim.home.storageCount('wood'));
  check('Late autumn: the guide says get your firewood in', sim.guide.advice(12).some((a) => a.id === 'firewood'));
}

// ================================================================== winter: the horses
{
  const sim = Simulation.newGame('T', 9105);
  const ss = seasonTools({ sim });
  const E = sim.equipment;
  const horse = E.create('pack_horse', { owner: 'player' });
  const t = sim.world.toTile(sim.state.player.x, sim.state.player.y);
  E.park(horse, t.tx, t.ty);
  for (const i of SEASONS.fodder) while (sim.home.storageCount(i)) sim.home.take(i, sim.home.storageCount(i));
  sim.home.store('wheat', 3, { force: true });
  ss.go('winter');
  const c0 = horse.condition;
  const w0 = sim.home.storageCount('wheat');
  sim.seasons.daily();
  check('A winter morning: your horse eats a day\'s fodder from your storage', w0 > 0 && sim.home.storageCount('wheat') === w0 - 1 && horse.condition === c0);
  while (sim.home.storageCount('wheat')) sim.seasons.daily();
  const seen = toasts(sim);
  sim.seasons.daily();
  check('No fodder left: it goes hungry and weakens (you\'re told)', horse.condition === c0 - SEASONS.hungryWear && seen.includes('toast.animals_hungry'));
  check('The guide says get fodder in', sim.guide.advice(12).some((a) => a.id === 'fodder'));
  ss.go('spring');
  const c1 = horse.condition;
  sim.seasons.daily();
  check('In spring they graze again (nothing from your storage)', horse.condition === c1);
}

// ================================================================== saving, and the dice
{
  const sim = Simulation.newGame('T', 9401);
  const ss = seasonTools({ sim });
  ss.go('winter');
  ss.snow(0.6);
  sim.seasons.S.warmDay = sim.time.day;
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Snow, the fire and the rest are saved', copy.seasons.snow() === 0.6 && copy.seasons.S.warmDay === sim.time.day);
  const old = new Simulation(Object.assign(JSON.parse(JSON.stringify(sim.state)), { seasons: undefined }));
  check('An old save (from before seasons) loads', old.seasons.snow() === 0 && Array.isArray(old.seasons.S.cold));
  const r0 = rand.getState();
  for (let h = 0; h < 48; h++) sim.seasons.hourly(h % 24);
  sim.seasons.daily();
  sim.seasons.flood(2);
  sim.seasons.recede();
  check('The seasons never roll the game\'s dice', rand.getState() === r0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll season checks passed');
process.exit(failures ? 1 : 0);
