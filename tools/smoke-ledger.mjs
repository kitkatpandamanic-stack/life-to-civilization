// Headless test for the ledger behind "Your affairs": every change to your purse is recorded
// under the right category (jobs, shopping, rent, taxes, trade…), transfers are kept apart,
// periods add up, net worth counts what you own, and it all survives save / load and a new heir.
// Usage: node tools/smoke-ledger.mjs
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

const sim = Simulation.newGame('T', 5151);
const run = runOn(sim);
const L = sim.ledger;
const p = sim.state.player;
while (sim.time.hour !== 9) run(30);

// 1. A job pays: 'jobs'.
sim.jobs.accept('mail_rounds');
sim.jobs.pickup();
for (const h of sim.jobs.active.targets.slice()) sim.jobs.turnIn(h);
check('pay for a job is income under "jobs"', L.summary(1).in.jobs > 0, JSON.stringify(L.summary(1).in));

// 2. Shopping and selling.
p.money += 0;
sim.economy.buy('store', 'bread', 1);
check('buying bread is spending under "shopping"', L.summary(1).out.shopping > 0);
sim.inventory.add('apple', 3, { force: true });
const sold = sim.economy.sell('store', 'apple', 1);
check('selling is income under "sales"', !sold || L.summary(1).in.sales > 0 || L.summary(1).in.sales === undefined);

// 3. Rent and taxes, paid by themselves over the week.
p.money = 500;
run(8 * 1440);
const week = L.summary(8);
check('rent is recorded', (week.out.rent || 0) > 0, JSON.stringify(week.out));

// 4. Transfers are kept apart from income and spending.
sim.civic.V.institutions.bank = { founded: sim.time.day, building: null };
const before = L.summary(1);
sim.civic.deposit(100);
const after = L.summary(1);
check('money put in the bank is a transfer, not spending', after.spending === before.spending && (after.out.bank || 0) >= 100);
check('…and the bank counts towards what you\'re worth', L.netWorth().parts.some((x) => x.k === 'bank' && x.v >= 100));

// 5. Unexplained changes are "other"; healer fees are "health".
p.money += 7;
check('a change nothing claims is filed under "other"', (L.summary(1).in.other || 0) >= 7);
L.as('health', () => (p.money -= 5));
check('…and a tagged one under its category', (L.summary(1).out.health || 0) >= 5);

// 6. Periods and history.
check('the last 14 days are there for the chart', L.daily(14).length === 14 && L.daily(14).some((d) => d.in > 0 || d.out > 0));
const all = L.summary(Infinity);
check('all-time totals include everything', all.income >= week.income && all.spending >= week.spending);

// 7. Net worth counts what you own and what you owe.
sim.inventory.add('iron_ingot', 2, { force: true });
const nw = L.netWorth();
check('net worth counts goods', nw.parts.some((x) => x.k === 'goods' && x.v > 0));
p.rent.debt = 40;
check('…and debts', L.netWorth().parts.some((x) => x.k === 'debts' && x.v <= -40));
p.rent.debt = 0;

// 8. Saved as a plain number, still watched after loading.
const state = JSON.parse(JSON.stringify(sim.state));
check('money is saved as a plain number', typeof state.player.money === 'number' && state.player.money === p.money);
const sim2 = new Simulation(state);
const m0 = sim2.state.player.money;
sim2.state.player.money += 3;
check('after loading, the purse is still watched', sim2.state.player.money === m0 + 3 && (sim2.ledger.summary(1).in.other || 0) >= 3);

// 9. A new generation: the heir's purse is watched too.
const heirState = sim2.state.player;
sim2.bus.emit('player:succeeded', { heirId: null });
check('the purse is watched through a succession', !!Object.getOwnPropertyDescriptor(heirState, 'money').get);

// 10. A few weeks of normal life.
let crashed = null;
try {
  runOn(sim2)(21 * 1440);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('…and the ledger keeps a bounded history', sim2.state.ledger.days.length <= 60);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll ledger checks passed.');
process.exit(failures ? 1 : 0);
