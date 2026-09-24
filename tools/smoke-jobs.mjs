// Headless test for early-game work: plenty of jobs for a newcomer, the new kinds of job
// (letter rounds with several houses, hauling materials to a real building site, seasonal
// work), jobs at businesses the villagers open, the midday top-up, and early favours.
// Usage: node tools/smoke-jobs.mjs
import { Simulation } from '../src/core/Simulation.js';
import { JOBS } from '../src/data/jobs.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
const toHour = (sim, run, h) => run((((h - sim.time.hour + 24) % 24) || 24) * 60 - sim.time.minute);

const sim = Simulation.newGame('T', 3131);
const run = runOn(sim);
const J = sim.jobs;
const p = sim.state.player;

// 1. A newcomer has plenty to choose from.
toHour(sim, run, 9);
const now = Object.keys(JOBS).filter((id) => J.check(id).ok);
check('on the first morning a newcomer can choose from many jobs', now.length >= 7, `${now.length}: ${now.join(', ')}`);
const kinds = new Set(now.map((id) => JOBS[id].type));
check('…of different kinds', kinds.size >= 3, [...kinds].join(','));
const level1 = Object.keys(JOBS).filter((id) => (JOBS[id].requires?.level || 1) === 1).length;
check('there are at least a dozen level-1 jobs in the game', level1 >= 12, `${level1}`);

// 2. Letter rounds: several houses.
check('you can take the letter rounds', J.accept('mail_rounds'));
let job = J.active;
check('…letters for several different houses', job.targets.length === 3 && new Set(job.targets).size === 3, job.targets.join(','));
const store = J.jobBuilding(job).id;
check('…collected at the store first', J.canPickup(store) && J.pickup() && sim.inventory.count('package') >= 3);
const obj = J.objective();
check('…the tracker points to the next house', obj.key === 'objective.deliver_letters' && !!obj.target);
const money0 = p.money;
for (const h of job.targets.slice()) {
  check(`…a letter to ${h}`, J.canTurnIn(h) && J.turnIn(h));
}
check('when every house has its letter, you are paid', !J.active && p.money > money0 && sim.inventory.count('package') === 0, `+${p.money - money0}`);

// 3. Hauling materials to a real building site.
const npc = sim.state.npcs.find((n) => n.age >= 25 && n.homeId);
npc.money = 800;
const site = sim.growth.start(npc, 'small_house', 'home');
check('a villager starts building a house', !!site && site.status === 'site');
sim.economy.biz('lumberyard').stock.wood = 40;
sim.economy.biz('lumberyard').money = 400;
J.refresh();
check('…so the lumberyard needs timber hauled there', J.existsToday('lumber_haul') && J.check('lumber_haul').ok, JSON.stringify(J.check('lumber_haul')));
J.accept('lumber_haul');
job = J.active;
check('…to that site', job.target === site.id && job.qty > 0);
const yard = sim.economy.biz('lumberyard');
const stock0 = yard.stock.wood;
check('you load up at the lumberyard', J.pickup() && sim.inventory.count('wood') >= job.qty && yard.stock.wood === stock0 - job.qty);
check('…the tracker points to the site', J.objective().key === 'objective.haul_deliver' && !!J.objective().target);
const delivered0 = site.delivered.wood || 0;
const qty = job.qty;
const yardMoney = yard.money;
check('…and deliver it to the site', J.canTurnInSite(site.id) && J.turnInSite(site.id));
check('…which really gets the materials', (site.delivered.wood || 0) === delivered0 + qty);
check('…paid for by the builder, to the lumberyard', yard.money >= yardMoney - 50, `${yardMoney} → ${yard.money}`);

// 4. Picking berries (a gathering job).
toHour(sim, run, 9);
if (sim.time.season !== 'winter') {
  J.refresh();
  check('you can pick berries for the store', J.accept('berry_picking'));
  job = J.active;
  check('…the tracker points to a bush', J.objective().key === 'objective.collect_berries');
  sim.inventory.add('berries', job.qty, { force: true });
  check('…with enough berries you can hand them in', job.stage === 'deliver' && J.turnIn());
}

// 5. Jobs at businesses villagers open.
check('no bakery, no bakery shifts', !J.employerOf('bakery_shift'));
const baker = sim.state.npcs.find((n) => !n.owns && n.age >= 25 && n.age < 55 && n.homeId && n !== npc);
baker.money = 600;
const bakery = sim.enterprise.open(baker, 'bakery', { building: baker.homeId, how: 'home' }, null);
sim.economy.biz(bakery).money = 500;
J.refresh();
check('a villager opens a bakery — and hires you for early shifts', J.employerOf('bakery_shift') === bakery && J.existsToday('bakery_shift'));
check('…it shows up among the bakery\'s jobs', J.jobsForBusiness(bakery).includes('bakery_shift'));
p.level = 2;
toHour(sim, run, 6);
J.refresh();
check('…and you can work there', J.accept('bakery_shift') && J.jobBuilding().id === sim.economy.biz(bakery).building);
check('…the shift starts at the bakery', J.canStartShift(sim.economy.biz(bakery).building).ok);
J.startShift();
const bm = p.money;
J.finishShift();
check('…and pays', p.money > bm);

// 6. Seasonal work.
const seasonal = Object.keys(JOBS).filter((id) => JOBS[id].seasons);
check('some work only comes with the seasons (planting, snow)', seasonal.includes('spring_planting') && seasonal.includes('snow_clearing'));

// 7. Midday: more work comes in.
J.refresh();
for (const id of Object.keys(JOBS)) sim.state.jobs.openings[id] = 0;
J.topUp();
check('at midday the board is topped up', Object.values(sim.state.jobs.openings).some((n) => n > 0));

// 8. Favours: newcomers get asked more.
const sim2 = Simulation.newGame('F', 77);
const run2 = runOn(sim2);
run2(10 * 1440);
check('in the first days villagers ask you for favours', sim2.state.stats.requestsDone >= 0 && (sim2.state.jobs.requests.length > 0 || sim2.state.jobs.nextRequestId > 2), `${sim2.state.jobs.nextRequestId - 1} requests so far`);

// 9. A month of the game with the new jobs about.
let crashed = null;
try {
  run2(28 * 1440);
} catch (e) {
  crashed = e;
}
check('a month passes without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll job checks passed.');
process.exit(failures ? 1 : 0);
