// Headless test for your workforce manager (contractor spec, phase 13): one of your workers,
// appointed to run the rest — walking round the jobs, putting the best-suited free hands on each
// contract (the most pressing first), taking them off a job that's stuck, giving roles by skill,
// keeping notes; you can override (a crew you chose, a role you set) and dismiss them; and it
// all survives save / load.
// Usage: node tools/smoke-manager.mjs
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
const toHour = (sim, h) => {
  let guard = 0;
  while (Math.floor(sim.time.hourFloat) !== h && guard++ < 60) runOn(sim)(30);
};
function hire(sim, n) {
  const look = sim.state.npcs[0].look;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    w.energy = 100;
    w.hunger = 100;
    w.level = 3;
    sim.workers.hire(w, 15);
    out.push(w);
  }
  return out;
}
const farmer = (sim) => sim.npcs.byId(sim.economy.ownerId('farm'));

const sim = Simulation.newGame('T', 4001);
sim.state.player.money = 5000;
sim.progression.addXp(8000);
const K = sim.contracts;
const W = sim.workers;
const ws = hire(sim, 4);
const [boss, a, b, c] = ws;
// A farmer and a builder among them.
sim.education.practise(a, 'farming', 40);
sim.education.practise(b, 'building', 40);

check('A manager: not before you have a name as a contractor', !W.canAppoint(boss.id).ok && W.canAppoint(boss.id).reason === 'need_standing');
K.S.done = 3;
K.S.rep = 55;
const pay0 = W.contract(boss.id).salary;
check('…then yes: appointed (with a rise)', W.appoint(boss.id).ok && W.isManager(boss.id) && W.contract(boss.id).salary > pay0, `$${pay0} → $${W.contract(boss.id).salary}`);

// Two jobs taken on, nobody put on them.
const h = K.offerFromTalk(farmer(sim));
K.accept(h.id);
const home = 'house_5';
const owner = sim.npcs.byId(sim.property.rec(home).owner);
sim.property.rec(home).condition = 25;
owner.money = Math.max(owner.money, 300);
const r = K.make_repair(owner);
K.S.offers.push(K.assess(r));
K.accept(r.id);
const hc = K.S.active.find((x) => x.id === h.id);
const rc = K.S.active.find((x) => x.id === r.id);
toHour(sim, 9);
runOn(sim)(70);
check('The manager puts workers on both jobs', hc.workers.length > 0 && rc.workers.length > 0, `harvest ${hc.workers}, repair ${rc.workers}`);
check('…the best suited where they fit (the farmer on the harvest, the builder on the repairs)', hc.workers.includes(a.id) && rc.workers.includes(b.id));
check('…never themselves', !hc.workers.includes(boss.id) && !rc.workers.includes(boss.id));
let rounds = false;
for (let i = 0; i < 16 && !rounds; i++) {
  runOn(sim)(15);
  if (W.contract(boss.id).task?.kind === 'minspect') rounds = true;
}
check('The manager walks round the jobs', rounds);
let guard = 0;
while ((K.isActive(h.id) || K.isActive(r.id)) && guard++ < 40) {
  runOn(sim)(60);
  if (Math.floor(sim.time.hourFloat) >= 17) toHour(sim, 8);
}
check('…and both get done', hc.status === 'completed' && rc.status === 'completed', `${hc.status} ${rc.status}`);

// Roles by skill (not the ones you set yourself).
W.assign(c.id, { type: 'workshop' });
W.contract(c.id).roleBy = 'player';
W.state.manager.planned = -1;
toHour(sim, 10);
runOn(sim)(60);
check('Roles by what they\'re good at: the farmer a farmer, the builder a builder', W.contract(a.id).assignment.type === 'farm' && W.contract(b.id).assignment.type === 'build', `${W.contract(a.id).assignment.type} ${W.contract(b.id).assignment.type}`);
check('…but a role you chose stays', W.contract(c.id).assignment.type === 'workshop');

// Your crew stays yours: a contract you crewed yourself isn't touched.
const h2 = K.make_harvest(farmer(sim)) || K.make_water(farmer(sim));
if (h2) {
  K.S.offers.push(K.assess(h2));
  K.accept(h2.id);
  K.assign(h2.id, [c.id]);
  const c2 = K.S.active.find((x) => x.id === h2.id);
  runOn(sim)(120);
  check('A contract you crewed yourself: left as you had it', c2.manual && JSON.stringify(c2.workers) === JSON.stringify([c.id]) || c2.status === 'completed');
  K.automate(h2.id);
  runOn(sim)(60);
  check('…handed back to the manager: they crew it', !c2.manual && (c2.workers.length >= 1 || c2.status === 'completed'));
}

// A job that's stuck: nothing to fetch, buy or gather.
const stuck = K.base('supply', { bizId: 'tavern', issuer: sim.economy.ownerId('tavern'), building: sim.economy.biz('tavern').building, item: 'meat', qty: 10, pay: 60, days: 5 });
K.S.offers.push(K.assess(stuck));
K.accept(stuck.id);
K.assign(stuck.id, [a.id], 'manager');
W.manage();
const sc = K.S.active.find((x) => x.id === stuck.id);
check('A stuck job: the manager takes the workers off it (and notes why)', sc.workers.length === 0 && W.state.managerLog.some((x) => x.key === 'pulled_stuck'), JSON.stringify(W.state.managerLog.slice(0, 3).map((x) => x.key)));
check('The manager keeps notes for you', W.state.managerLog.length >= 3 && W.state.managerLog.some((x) => x.key === 'assigned'));

// Save and load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('After loading: the manager, their duties and notes', sim2.workers.isManager(boss.id) && sim2.workers.state.managerLog.length === W.state.managerLog.length);
let crashed = null;
try {
  runOn(sim2)(24 * 60);
} catch (e) {
  crashed = e;
}
check('…and a day goes by without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 2).join(' | '));

// Dismissed: back to the work.
W.dismissManager();
check('Dismissed: they\'re a worker again', !W.isManager(boss.id) && !!W.contract(boss.id));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll manager checks passed');
process.exit(failures ? 1 : 0);
