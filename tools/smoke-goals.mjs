// Headless test for villager goals (Phase 5): every villager has a goal with reasons; goals
// change what they do (saving, founding businesses, buying homes, moving near work, courting,
// learning, leaving); you can back a founder and talk someone out of leaving; goals are saved.
// Usage: node tools/smoke-goals.mjs
import fs from 'fs';
import { Simulation } from '../src/core/Simulation.js';
import { GOAL_TYPES, GOALS } from '../src/data/goals.js';

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

const sim = Simulation.newGame('T', 4242);
const run = runOn(sim);
const G = sim.goals;
const npcs = sim.state.npcs;
const adults = () => npcs.filter((n) => n.age >= 18 && !n.leaving);

// 1. Everyone has something they're after — and reasons for it.
run(1440);
check('every villager has a goal', npcs.every((n) => n.goal && GOAL_TYPES.includes(n.goal.type)), JSON.stringify(G.summary()));
check('children are growing up', npcs.filter((n) => n.age < 16).every((n) => n.goal.type === 'grow'));
check('most adults can say why', adults().filter((n) => n.goal.why.length).length >= adults().length * 0.7);
const kinds = new Set(npcs.map((n) => n.goal.type));
check('goals differ from person to person', kinds.size >= 4, [...kinds].join(','));

// 2. Needs come first.
const jobless = adults().find((n) => !n.owns && !n.employer && n.occupation !== 'elder') || adults().find((n) => !n.owns && n.employer && n.employer !== 'player');
if (jobless.employer) sim.enterprise.layOff(jobless, jobless.employer, 'laid_off');
G.reconsider(jobless);
check('someone out of work wants a job', jobless.goal.type === 'job' && jobless.goal.why.includes('no_work'), jobless.goal.type);

// 3. Saving changes spending.
const saver = adults().find((n) => n !== jobless && !n.owns && n.employer);
G.set(saver, 'save', { why: ['little_savings'], target: saver.money + 100 });
check('a saver stops eating out and buying luxuries', sim.npcs.isSaving(saver));
saver.money += 200;
check('…until they have enough', !sim.npcs.isSaving(saver) || saver.traits.includes('entrepreneur'));
G.checkDone(saver);
check('…and then the goal is achieved (and remembered)', !saver.goal && saver.memories.some((m) => m.k === 'goal_achieved' && m.p.goal === 'save'));
G.reconsider(saver);

// 4. A would-be founder — without the entrepreneur's temperament — and your backing.
const founder = adults().find((n) => !n.owns && n.employer && n.employer !== 'player' && !n.traits.includes('entrepreneur') && n.age >= 21 && n.age <= 50 && n !== saver);
founder.traits = founder.traits.filter((t) => !['ambitious', 'risk_taker', 'careful'].includes(t));
delete founder.lastStartupTry;
check('without a plan, an ordinary villager is not a startup candidate', !sim.enterprise.candidate(founder));
G.set(founder, 'business', { why: ['knows_trade'], target: 400, biz: 'bakery' });
check('with a plan to open a business, they are', sim.enterprise.candidate(founder));
founder.money = 60;
const p = sim.state.player;
p.money = 2000;
founder.rel = 40;
founder.pb.t = 30;
const help = G.helpOptions(founder).find((h) => h.kind === 'back');
check('you can offer to back them', !!help && help.amount >= GOALS.backMin, JSON.stringify(help));
const b = G.back(founder);
check('backing them hands over the money', b.ok && founder.money >= 60 + help.amount - 1 && p.money === 2000 - help.amount);
check('…and they remember who believed in them', founder.memories.some((m) => m.k === 'player_backed_dream'));
const premises = sim.enterprise.findPremises(founder, 'bakery') || { building: founder.homeId, how: 'home' };
founder.money = Math.max(founder.money, 400);
const bizId = sim.enterprise.open(founder, 'bakery', premises, null);
const stake = (sim.economy.biz(bizId).stakes || []).find((s) => s.who === 'player');
check('when it opens, you own a share of it', !!stake && stake.share > 0 && stake.amount === help.amount, JSON.stringify(stake));
G.checkDone(founder);
check('…and their goal is achieved', founder.goalsDone?.some((g) => g.type === 'business'));

// 5. Changed plans: they give back what they can.
const dreamer = adults().find((n) => !n.owns && n !== founder && n !== saver && n !== jobless && n.age >= 21);
G.set(dreamer, 'business', { why: [], target: 400 });
dreamer.rel = 40;
const before = p.money;
G.back(dreamer);
G.set(dreamer, 'steady', { why: [] });
check('a founder who changes course pays back your money', p.money === before && !dreamer.goal.backer);

// 6. A home of their own: a determined buyer buys with a thinner cushion.
const P = sim.property;
const renter = adults().find((n) => n.homeId && P.landlord(n) && !n.owns && n !== founder);
if (renter) {
  const price = P.value(renter.homeId);
  const rec = P.rec(renter.homeId);
  rec.forSale = true;
  renter.money = Math.ceil(price * 1.1); // below the usual 1.2 × price cushion
  const r2 = { ...renter };
  P.market();
  const boughtWithout = P.rec(r2.homeId).owner === renter.id;
  if (!boughtWithout) {
    G.set(renter, 'buy_house', { why: ['rent_high'], target: price });
    P.market();
  }
  check('someone set on owning a home buys it', P.rec(renter.homeId)?.owner === renter.id || npcs.some((o) => o === renter && P.rec(o.homeId)?.owner === o.id), boughtWithout ? '(bought anyway)' : '');
} else check('someone set on owning a home buys it', false, 'no renter');

// 7. Moving close to far-off work: a mining camp out in the country gets neighbours.
const X = sim.exploration;
const cave = sim.state.exploration.sites.find((s) => s.kind === 'cave' || s.kind === 'mine_shaft');
X.revealAround(cave.tx, cave.ty + 3);
p.energy = 100;
p.health = 100;
X.exploreSite(cave.id);
p.level = 8;
p.money = 5000;
const f = X.foundOutpost(cave.id);
finish(sim, f.site);
const camp = sim.economy.businessAtBuilding(f.site.id);
sim.holdings.setStaffTarget(camp, 3);
sim.holdings.deposit(camp, 800);
const miner = adults().find((n) => !n.owns && n.homeId && n.homeId !== 'hall' && n !== founder && n !== renter && !sim.workers.contract(n.id));
miner.employer && sim.enterprise.layOff(miner, miner.employer, 'changed_jobs');
check('a villager takes a job at the camp', sim.npcs.tryHire(miner, camp) || sim.npcs.tryHire(miner, camp) || sim.npcs.tryHire(miner, camp));
G.ctx = null;
const c = G.candidates(miner);
check('the long walk makes them think of moving', !!c.settle && c.settle.why.includes('long_walk'), JSON.stringify(c.settle));
G.set(miner, 'settle', c.settle);
miner.money = 2000;
const moved = G.trySettle(miner);
check('they find a home out there, or start building one', moved);
if (miner.goal.startedHome) {
  const site = sim.construction.byId(miner.goal.startedHome);
  const d = Math.hypot(site.tx - cave.tx, site.ty - cave.ty);
  check('…the new house goes up by the camp', d <= 22, `${Math.round(d)} tiles`);
  finish(sim, site);
}
G.checkDone(miner);
check('…and when they live there, the goal is done', miner.goalsDone?.some((g) => g.type === 'settle'), miner.goal?.type);
check('…which the village hears about', sim.state.settlement.goals.settled >= 1);

// 8. Looking for love: courtship comes easier.
const singles = adults().filter((n) => !n.kin.spouse && !n.partner && n.age <= 40);
const pair = (() => {
  for (const a of singles) for (const o of singles) if (sim.family.compatible(a, o)) return [a, o];
  return null;
})();
if (pair) {
  const [a, o] = pair;
  sim.social.ensureBond(a, o);
  sim.social.ensureBond(o, a);
  Object.assign(a.relations[o.id], { f: 42, t: 8, c: 0 });
  Object.assign(o.relations[a.id], { f: 52, t: 8, c: 0 }); // they like them back — but haven't the trust to start it
  for (let i = 0; i < 12 && !a.partner; i++) sim.family.weeklyLove();
  check('friends who are not quite close enough do not court on their own', !a.partner);
  G.set(a, 'family', { why: ['lonely'], stage: 'partner' });
  for (let i = 0; i < 30 && !a.partner; i++) sim.family.weeklyLove();
  check('someone looking for a partner starts courting', a.partner === o.id || !!a.partner);
} else check('someone looking for a partner starts courting', false, 'no compatible singles');

// 9. Mastering the trade: they learn faster.
const w1 = adults().find((n) => n.employer && n.employer !== 'player' && n.employer !== camp && !n.owns);
const xpDay = (goal) => {
  G.set(w1, goal, { why: [] });
  w1.workedToday = true;
  const lv = w1.level;
  const xp = w1.xp;
  w1.level = 1;
  w1.xp = 0;
  sim.npcs.onDay();
  const gained = w1.xp + (w1.level - 1) * 1000;
  w1.level = lv;
  w1.xp = xp;
  return gained;
};
const plain = xpDay('steady');
const practising = xpDay('master');
check('someone set on mastery learns faster', practising > plain, `${plain.toFixed(1)} → ${practising.toFixed(1)}`);

// 10. Leaving — and being talked round.
const unhappy = adults().find((n) => !n.owns && !n.kin.spouse && n !== founder && n !== miner && n !== saver && n.age >= 20 && n.age <= 55 && !n.leaving);
if (unhappy.employer === 'player') delete sim.state.workers[unhappy.id];
if (unhappy.employer && unhappy.employer !== 'player') sim.enterprise.layOff(unhappy, unhappy.employer, 'laid_off');
unhappy.employer = null;
unhappy.occupation = 'unemployed';
sim.state.settlement.joblessSince[unhappy.id] = sim.time.day - 60;
unhappy.mood = 20;
for (const v of Object.values(unhappy.relations)) v.f = Math.min(v.f, 10);
unhappy.relations[founder.id] = { f: -40, t: -20, r: 0, c: 80 };
sim.events.state?.active?.push?.({ id: 'recession', day: sim.time.day, until: sim.time.day + 30 });
G.ctx = null;
const lc = G.candidates(unhappy).leave;
check('weeks without work, unhappy, a feud: leaving is on their mind', !!lc && lc.s > 0, JSON.stringify(lc));
G.set(unhappy, 'leave', lc);
unhappy.goal.since -= GOALS.leaveHoldDays + 1;
G.advanceLeaving(unhappy);
check('after a while they start packing', !!unhappy.goal.packDay);
check('…which you can see (🧳)', sim.npcs.thought(unhappy) === '🧳' || unhappy.hunger < 25 || unhappy.health < 35 || unhappy.energy < 20);
check('…and they tell you about it', G.helpOptions(unhappy).some((h) => h.kind === 'stay'));
unhappy.rel = 90;
unhappy.pb.t = 80;
unhappy.pb.c = 0;
let res = G.askToStay(unhappy);
for (let i = 0; i < 6 && !res.stays; i++) {
  unhappy.stayAskedDay = -99;
  unhappy.goal = { ...unhappy.goal, type: 'leave' };
  res = G.askToStay(unhappy);
}
check('a friend who trusts you can be talked into staying', res.stays && unhappy.goal?.type !== 'leave' && unhappy.stayUntil > sim.time.day);
check('…and remembers it', unhappy.memories.some((m) => m.k === 'player_asked_stay'));
// Someone else goes through with it.
const goer = adults().find((n) => !n.owns && !n.kin.spouse && n !== unhappy && n !== founder && n !== miner && n.age >= 20 && n.age <= 55 && !n.leaving && n.employer !== 'player');
const pop0 = npcs.filter((n) => !n.leaving).length;
G.set(goer, 'leave', { why: ['unhappy'] });
goer.goal.packDay = sim.time.day;
G.advanceLeaving(goer);
check('someone who has packed and is not talked round leaves', goer.leaving && npcs.filter((n) => !n.leaving).length < pop0);
check('…and the chronicle says why', sim.state.chronicle.some((e) => e.key === 'chronicle.npc_left_reason'));

// 11. Your worker, set on a better job, leaves you for better pay elsewhere.
const hand = adults().find((n) => !n.owns && !n.leaving && n !== unhappy && n !== miner && n !== founder && !n.traits.includes('loyal') && n.employer !== camp);
if (hand.employer && hand.employer !== 'player') sim.enterprise.layOff(hand, hand.employer, 'changed_jobs');
sim.workers.hire(hand, 3);
G.set(hand, 'better_job', { why: ['better_offer'] });
G.ctx = null;
let poached = false;
for (let i = 0; i < 20 && !poached; i++) poached = G.maybePoached(hand);
check('your badly paid worker leaves you for a better-paid job', poached && hand.employer !== 'player' && !sim.workers.contract(hand.id), hand.employer);

// 12. Dialogue: they talk about their goal, and why.
const talker = adults().find((n) => n.goal && !['grow', 'legacy'].includes(n.goal.type) && !n.leaving);
talker.rel = 60;
talker.pb.t = 40;
const topics = sim.dialogue.topics(talker, 'life');
check('villagers talk about their plans', topics.some((t) => t.key.startsWith('talk.goal.')));

// 13. Every goal and reason can be put into words, in both languages.
const locales = Object.fromEntries(['en', 'ru'].map((l) => [l, JSON.parse(fs.readFileSync(new URL(`../src/locales/${l}.json`, import.meta.url), 'utf8'))]));
const get = (o, k) => k.split('.').reduce((x, y) => (x ? x[y] : undefined), o);
const src = fs.readFileSync(new URL('../src/systems/GoalSystem.js', import.meta.url), 'utf8');
const reasons = new Set([...src.matchAll(/why\.push\('([a-z_]+)'\)/g)].map((m) => m[1]).concat([...src.matchAll(/add\('[a-z_]+', [^,]+, \['([a-z_]+)'\]\)/g)].map((m) => m[1])));
reasons.add('long_walk');
const missing = [];
for (const [l, d] of Object.entries(locales)) {
  for (const g of GOAL_TYPES) {
    for (const k of [`goal_label.${g}`, `goal_short.${g}`]) if (get(d, k) === undefined) missing.push(`${l}:${k}`);
    if (!['grow', 'legacy'].includes(g) && get(d, `talk.goal.${g}`) === undefined) missing.push(`${l}:talk.goal.${g}`);
  }
  for (const r of reasons) {
    if (get(d, `goal_why.${r}`) === undefined) missing.push(`${l}:goal_why.${r}`);
    if (!['friends_here', 'family_here', 'player_friend'].includes(r) && get(d, `talk.goal_why.${r}`) === undefined) missing.push(`${l}:talk.goal_why.${r}`);
  }
}
check('every goal and reason has words in English and Russian', !missing.length, missing.slice(0, 6).join(', '));

// 14. Saved and loaded.
const state = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(state);
const t1 = sim.state.npcs.find((n) => n.goal)?.id;
check('goals survive save / load', sim2.npcs.byId(t1).goal?.type === sim.npcs.byId(t1).goal?.type && sim2.state.settlement.goals.settled === sim.state.settlement.goals.settled);

// 15. A year of village life with goals driving people.
const sim3 = Simulation.newGame('Y', 777);
const run3 = runOn(sim3);
let crashed = null;
try {
  run3(112 * 1440);
} catch (e) {
  crashed = e;
}
check('a year passes without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
const S3 = sim3.state.settlement.goals;
const done3 = sim3.state.npcs.reduce((s, n) => s + (n.goalsDone || []).length, 0);
check('villagers achieve their goals over the year', S3.achieved >= 3 || done3 >= 10, `${S3.achieved} notable, ${done3} total, gave up ${S3.gaveUp}`);
check('the village is still there', sim3.state.npcs.length >= 12, `${sim3.state.npcs.length} villagers`);
const kinds3 = new Set(sim3.state.npcs.map((n) => n.goal?.type));
check('people still want different things', kinds3.size >= 5, [...kinds3].join(','));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll goal checks passed.');
process.exit(failures ? 1 : 0);
