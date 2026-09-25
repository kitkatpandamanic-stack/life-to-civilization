// Headless test for posting your own workers to a business of yours: they join its staff and do
// its work (physically, like anyone employed there), on its wages; you can make them run it; you
// can call them back on the terms you had; if the business lets them go they come back to you;
// and it all survives save / load.
// Usage: node tools/smoke-posting.mjs
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

const sim = Simulation.newGame('T', 5001);
sim.state.player.money = 20000;
sim.progression.addXp(8000);
const H = sim.holdings;
const W = sim.workers;
const biz = 'lumberyard';
const bought = H.buy(biz);
check('You own a business (the lumberyard, bought)', bought.ok && H.isMine(biz), JSON.stringify(bought));
const look = sim.state.npcs[0].look;
const ws = [];
for (let i = 0; i < 3; i++) {
  const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
  w.met = true;
  sim.workers.hire(w, 17);
  ws.push(w);
}
const [a, b, c] = ws;
check('One of your workers can be sent there', H.canPost(biz, a.id).ok);
const r = H.post(biz, a.id);
check('…sent: on its staff, off your crew — your terms kept', r.ok && a.employer === biz && sim.npcs.staffOf(biz).includes(a) && !W.contract(a.id) && a.crew?.salary === 17 && a.occupation === sim.economy.def(biz).workerOccupation);
check('…listed among your workers at your businesses', H.posted().includes(a));

toHour(sim, 9);
let atWork = false;
for (let i = 0; i < 12; i++) {
  runOn(sim)(30);
  if (a.task?.type === 'work') atWork = true;
}
check('…they go and do its work, like anyone employed there', atWork, `${a.task?.type}:${a.task?.stage}`);
runOn(sim)(24 * 60);
check('…paid from the business\'s till (never unpaid)', !a.unpaidDays && !sim.memory.has(a, 'unpaid_wages') && sim.npcs.wageFor(biz, a) > 0, `$${sim.npcs.wageFor(biz, a)} a day`);

// To run it.
const p2 = H.post(biz, b.id, { manager: true });
check('Sent to run it: the business\'s manager', p2.ok && sim.economy.biz(biz).manager === b.id);

// Called back.
check('Called back: in your crew again, on the terms you had', H.recall(a.id).ok && W.contract(a.id)?.salary === 17 && a.employer === 'player' && !a.crew);
toHour(sim, 10);
runOn(sim)(60);
check('…and back at your work', W.contract(a.id).state !== 'idle' || a.task?.type === 'work');

// The business lets staff go: yours come back to you, not out of work.
H.post(biz, c.id);
H.setStaffTarget(biz, 0);
check('The business lets its staff go: your workers come back to your crew', !!W.contract(c.id) && c.employer === 'player' && !!W.contract(b.id) && c.occupation === 'hired_hand');

// Save and load.
H.post(biz, a.id, { manager: true });
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const a2 = sim2.npcs.byId(a.id);
check('After loading: still posted, still running it, your terms kept', a2.employer === biz && a2.crew?.salary === 17 && sim2.economy.biz(biz).manager === a.id && sim2.holdings.posted().some((n) => n.id === a.id));
check('…and can still be called back', sim2.holdings.recall(a.id).ok && !!sim2.workers.contract(a.id));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll posting checks passed');
process.exit(failures ? 1 : 0);
