// Headless test for civilization (Phase 7): headman, council and yearly elections (you can stand
// and win); policies with real effects; institutions saved for, built and opened, with their
// effects; the valley's status growing from village to town; the bank; new technologies;
// your family's deeds and renown, and the goodwill an heir inherits; save / load.
// Usage: node tools/smoke-civic.mjs
import { Simulation } from '../src/core/Simulation.js';
import { INSTITUTIONS } from '../src/data/civic.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
const finish = (sim, c) => {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
};
// Advance at least one day, to the next day with this weekday (when the weekly business happens).
const untilWeekday = (sim, run, wd) => {
  for (let i = 0; i < 8; i++) {
    run(1440);
    if (sim.time.weekday === wd) return;
  }
};

const sim = Simulation.newGame('T', 1717);
const run = runOn(sim);
const C = sim.civic;
const V = C.V;
const p = sim.state.player;
run(30 * 1440); // you've lived here a month

// 1. A village with someone in charge.
check('the village starts with a headman people respect', !!C.headman() && C.headman() !== 'player', V.headman);
check('…normal taxes and relief, no institutions, a village', V.policies.tax === 'normal' && !Object.keys(V.institutions).length && V.status === 'village');
const cands = C.candidates();
check('the most respected villagers are candidates', cands.length >= 2 && cands.every((c) => c.id !== 'player'), cands.map((c) => `${c.id} ${c.s.toFixed(1)}`).join(', '));

// 2. Elections.
const voters = C.voters().length;
const r = C.election();
check('an election is held', !!r && cands.some((c) => c.id === r.winner), r.winner);
check('…everyone grown-up votes once', r.votes.reduce((s, [, n]) => s + n, 0) === voters, `${voters} voters`);
check('…a council is formed, the next election is a year away', V.council.length >= 1 && V.nextElection === sim.time.day + 56);
check('…and it goes into the chronicle', sim.state.chronicle.some((e) => e.key.startsWith('chronicle.headman_')));

// 3. You stand — and win when people think well of you.
p.reputation = 0;
check('you need a good reputation to stand', !C.stand(true).ok);
p.reputation = 40;
check('with one you can put yourself forward', C.stand(true).ok && C.candidates().some((c) => c.id === 'player'));
for (const n of sim.state.npcs) {
  n.rel = 90;
  n.pb = { t: 60, r: 60, c: 0 };
}
const r2 = C.election();
check('liked and respected, you win', r2.winner === 'player' && C.isPlayerHeadman(), JSON.stringify(r2.votes.slice(0, 3)));
check('…which is one of your family\'s deeds', sim.legacy.deeds().some((d) => d.key === 'player_elected') && sim.legacy.renown() >= 10);

// 4. Policies, and what they do.
const someBuilding = Object.keys(sim.property.all).find((id) => sim.finance.propertyTax(id) > 0);
const taxNormal = someBuilding ? sim.finance.propertyTax(someBuilding) : 0;
check('as headman you set the taxes', C.setPolicy('tax', 'high') && V.policies.tax === 'high');
check('…and property taxes go up', !someBuilding || sim.finance.propertyTax(someBuilding) > taxNormal, `${taxNormal} → ${someBuilding && sim.finance.propertyTax(someBuilding)}`);
const owner = sim.state.npcs.find((n) => n.owns);
C.setPolicy('relief', 'normal'); // (you inherit your predecessor's policies — look at taxes alone)
check('…business owners don\'t like high taxes', !owner || C.moodEffect(owner) < 0);
C.setPolicy('relief', 'high');
const poor = sim.state.npcs.find((n) => n.age >= 18 && !n.owns) ;
poor.money = 5;
check('generous poor relief lifts the hard-up', C.moodEffect(poor) > 0);
const greedy = { traits: ['greedy'] };
const generous = { traits: ['generous', 'careful'] };
check('NPC headmen govern by temperament', C.policiesFor(greedy).tax === 'high' && C.policiesFor(greedy).relief === 'low' && C.policiesFor(generous).relief === 'high' && C.policiesFor(generous).tax === 'low');

// 5. Institutions: saved for, built by the villagers, opened.
check('founding costs the building\'s materials plus labour', C.costOf('market') > sim.growth.estimate('market_hall'));
V.project = 'market';
const fund0 = V.fund;
sim.finance.weekly();
check('a share of the week\'s taxes goes into the civic fund', V.fund > fund0, `${fund0} → ${V.fund}`);
V.fund = C.costOf('market');
const full = V.fund;
const site = C.found('market');
check('when the fund is full, the villagers start building', !!site && site.status === 'site' && V.fund === 0 && V.project !== 'market', site?.type);
check('…the whole fund goes to the site', site && site.budget >= full - 1, `${Math.round(site?.budget)} of ${full}`);
check('…and it goes into the chronicle', sim.state.chronicle.some((e) => e.key.startsWith('chronicle.institution_started')));
const exp0 = sim.tech.mod('export_price');
finish(sim, site);
check('when it\'s built, the village has a market', C.has('market') && V.institutions.market.byPlayer);
check('…exports fetch more', sim.tech.mod('export_price') > exp0);
check('…founded on your watch: a deed', sim.legacy.deeds().some((d) => d.key === 'institution_founded_player'));
check('…and the building is never left to decay', (() => {
  run(20 * 1440);
  return !sim.property.rec(site.id).abandoned;
})());
check('…nor can it be bought', !sim.property.canPlayerBuy(site.id).ok);

// Market news: prices from settlements you trade with.
sim.settlements.makeContact('woodhollow', 'test');
sim.settlements.get('woodhollow').knownDay = -99;
untilWeekday(sim, run, 3);
check('the market brings news of prices in other settlements', sim.settlements.get('woodhollow').knownDay >= sim.time.day - 2);

// A watch: fewer fires, safer roads.
const fire0 = sim.tech.mod('fire_risk');
const danger0 = sim.settlements.danger('woodhollow');
V.institutions.watch = { founded: sim.time.day, building: null, byPlayer: false };
sim.tech.mods = null;
check('a night watch makes fires rarer', sim.tech.mod('fire_risk') < fire0);
check('…and the roads safer', sim.settlements.danger('woodhollow') < danger0);

// 6. Status: the valley's settlement grows up.
V.institutions.clinic = { founded: sim.time.day, building: null, byPlayer: true };
sim.tech.mods = null;
const status0 = V.status;
for (let i = 0; i < 12 && sim.state.npcs.length + 1 < 36; i++) sim.growth.arrive();
C.checkStatus();
C.checkStatus();
check('with people and institutions, the village becomes something more', V.status !== status0 && ['large_village', 'town'].includes(V.status), `${status0} → ${V.status}`);
check('…which goes into the history book', sim.state.history.entries.some((e) => e.key.startsWith('chronicle.village_status')));
check('…and draws newcomers', C.attractiveness() > 0);

// 7. The bank.
V.institutions.bank = { founded: sim.time.day, building: null, byPlayer: true };
V.vault = 300; // the village's capital
p.money = 500;
sim.state.village.treasury = 400;
check('you can put savings in the bank', C.deposit(200).ok && p.bank === 200 && p.money === 300);
const bank0 = p.bank;
untilWeekday(sim, run, 3);
check('…which earn interest', p.bank > bank0 || sim.state.village.treasury < 1, `${bank0} → ${p.bank}`);
const cash = p.money;
check('…and you can take them out', C.withdraw(50).ok && p.money === cash + 50);
const founder = sim.state.npcs.find((n) => !n.owns && n.age >= 25 && n.age < 50);
const loan = C.bankLend(founder, 200);
check('the bank lends to villagers starting out', !!loan && loan.lender === 'bank' && loan.left > loan.amount);

// 8. New technologies.
const days0 = sim.settlements.days('lakeside');
sim.tech.discover('boats');
check('boats make journeys to places on the water shorter', sim.settlements.days('lakeside') <= days0 && sim.settlements.days('saltmere') < 5, `${days0} → ${sim.settlements.days('lakeside')}`);
const road0 = sim.settlements.roadCost('woodhollow');
sim.tech.discover('stone_bridges');
check('stone bridges make roads to other places cheaper', sim.settlements.roadCost('woodhollow') < road0);
const farm0 = sim.tech.mod('farm_output');
sim.tech.discover('irrigation');
check('irrigation grows bigger harvests', sim.tech.mod('farm_output') > farm0);

// 9. Legacy: an heir inherits the family's good name.
const n0 = sim.state.npcs.find((n) => n.age >= 18);
n0.pb = { t: 0, r: 0, c: 0 };
n0.rel = 10;
sim.legacy.onSucceeded({ heirId: 'x' });
check('your heir starts out trusted, thanks to the family\'s renown', n0.pb.t > 0 && n0.rel > 10, `trust ${n0.pb.t.toFixed(1)}`);
const topics = sim.dialogue.topics(n0, 'chat').map((t) => t.key);
check('villagers talk about your family\'s deeds', topics.some((k) => k.startsWith('talk.legacy.deed')));
check('…and about the village\'s affairs', topics.some((k) => k.startsWith('talk.civic.')));
const renown = sim.legacy.renown();
sim.legacy.onSucceeded({ heirId: null });
check('a newcomer doesn\'t inherit your family\'s renown', sim.legacy.renown() === 0 && renown > 0);

// 10. Saved and loaded.
const state = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(state);
check('the village\'s government survives save / load', sim2.civic.V.headman === V.headman && sim2.civic.has('market') && sim2.civic.V.status === V.status && sim2.state.player.bank === p.bank);

// 11. Years of village politics.
const sim3 = Simulation.newGame('Y', 2323);
const elections = [];
sim3.bus.on('chronicle', (e) => e.key.startsWith('chronicle.headman_') && elections.push(e.day));
let crashed = null;
try {
  runOn(sim3)(4 * 56 * 1440);
} catch (e) {
  crashed = e;
}
check('four years pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('…with a yearly election', elections.length >= 3, `${elections.length} elections`);
check('…and always someone in charge', !!sim3.civic.headman());
check('…the village saves for (or builds) institutions', sim3.civic.V.fund > 0 || Object.keys(sim3.civic.V.institutions).length > 0 || sim3.construction.list.some((c) => c.institution), `fund ${sim3.civic.V.fund}, ${Object.keys(sim3.civic.V.institutions).join(',')}`);
check('…and the village is still there', sim3.state.npcs.length >= 12, `${sim3.state.npcs.length}`);
void INSTITUTIONS;

console.log(failures ? `\n${failures} check(s) failed` : '\nAll civic checks passed.');
process.exit(failures ? 1 : 0);
