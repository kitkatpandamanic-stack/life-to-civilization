// Headless test for the contractor upgrade: villagers weigh what they need (and ask for the most
// pressing first), more kinds of work (watering, gathering, building for them), sizes and
// requirements, estimates and real costs, asking for more money or time, judging the work,
// your name as a contractor, clients who come back with bigger jobs, the history, several
// contracts at once, late and called-off jobs, and your own contracting company — with the
// twelve scenarios of the spec for the basic loop, and all of it through save / load.
// Usage: node tools/smoke-contractor.mjs
import { Simulation } from '../src/core/Simulation.js';
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
const toHour = (sim, h) => {
  let guard = 0;
  while (Math.floor(sim.time.hourFloat) !== h && guard++ < 60) runOn(sim)(30);
};
function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 5000;
  sim.progression.addXp(8000);
  return sim;
}
function hire(sim, n) {
  const look = sim.state.npcs[0].look;
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 20 });
    w.met = true;
    w.energy = 100;
    w.hunger = 100;
    sim.workers.hire(w, 15);
    out.push(w);
  }
  return out;
}
const farmer = (sim) => sim.npcs.byId(sim.economy.ownerId('farm'));
function workUntil(sim, done, days = 4, each = null) {
  const run = runOn(sim);
  toHour(sim, 8);
  for (let d = 0; d < days && !done(); d++) {
    for (let h = 0; h < 9 && !done(); h++) {
      for (let m = 0; m < 4 && !done(); m++) {
        run(15);
        each?.();
      }
    }
    if (!done()) toHour(sim, 8);
  }
}

// Scenarios 1–10: the farmer's harvest, two workers, paid once, experience once, back to work — now judged.
{
  const sim = setup(3001);
  const K = sim.contracts;
  const f = farmer(sim);
  const needs = K.needs(f);
  check('Scenario 1: the farmer weighs what he needs — the ripe harvest comes first', needs[0]?.kind === 'harvest' && needs.every((o, i) => !i || needs[i - 1].priority >= o.priority) && needs[0].urgency > 0, needs.map((o) => `${o.kind}:${o.priority}`).join(' '));
  const o = K.offerFromTalk(f);
  check('…each job has a kind of work, a size, a priority, and a deadline to match', o.category === 'agriculture' && ['small', 'medium', 'large'].includes(o.size) && o.days >= 1, `${o.category} ${o.size} ${o.days}d`);
  const est = K.estimate(o, 2);
  check('…and an estimate: hours, days, wages, expected profit', est.hours > 0 && est.days > 0 && est.wages > 0 && est.profit < o.pay, JSON.stringify(est));
  check('Scenario 2: you take it on', K.accept(o.id).ok);
  const c = K.S.active.find((x) => x.id === o.id);
  const ws = hire(sim, 2);
  // (You stand by the farm to watch: near you, people walk every step — far off they're only placed.)
  const pc = sim.world.tileCenter(38, 64);
  sim.state.player.x = pc.x;
  sim.state.player.y = pc.y;
  K.assign(c.id, ws.map((w) => w.id));
  check('Scenario 3: two workers on it', c.workers.length === 2);
  let travelled = false;
  let together = false;
  const money0 = sim.state.player.money;
  const lvl0 = sim.state.player.level;
  const xp0 = sim.state.player.xp;
  for (let i = 0; i < 8; i++) {
    runOn(sim)(5);
    if (ws.some((w) => sim.workers.contract(w.id)?.task?.kind === 'charvest' && sim.npcs.byId(w.id).moving)) travelled = true;
  }
  workUntil(sim, () => !K.isActive(c.id), 3, () => {
    const ts = ws.map((w) => sim.workers.contract(w.id)?.task);
    if (ws.some((w) => sim.workers.contract(w.id)?.task?.kind === 'charvest' && (sim.workers.contract(w.id).state === 'moving' || sim.npcs.byId(w.id).moving))) travelled = true;
    if (ts.every((t) => t?.kind === 'charvest')) together = true;
  });
  check('Scenario 4: they walk to the field', travelled);
  check('Scenario 5: they harvest at the same time', together);
  check('Scenario 6: the job is done', c.status === 'completed');
  check('…judged on what happened: speed, skill, deadline → a grade', !!c.result && ['excellent', 'good', 'fair', 'poor'].includes(c.result.grade) && c.result.score > 0, JSON.stringify(c.result));
  check('Scenario 7: the farmer pays you (by the grade)', c.awarded.pay > 0 && sim.state.player.money > money0 - 60, `paid ${c.awarded.pay} of ${c.pay}`);
  check('Scenario 8: you gain experience once', c.awarded.xp > 0 && (sim.state.player.level > lvl0 || sim.state.player.xp > xp0));
  check('Scenario 9: each worker gains experience once', ws.every((w) => c.awarded.workers[w.id]?.xp > 0));
  check('…and what the job really cost you is known (their hours)', c.costs.wages > 0, JSON.stringify(c.costs));
  check('Scenario 10: the workers go back to their usual work', ws.every((w) => sim.workers.contract(w.id).job === undefined));
  check('…your name grew, and the farmer remembers you', K.rep() > 50 && K.trust(f.id) > 0 && K.history()[0].id === c.id && K.history()[0].grade, `rep ${K.rep()}, trust ${K.trust(f.id)}`);

  // Scenarios 11–12: another contract, then several at once, workers shared out.
  const home = sim.npcs.byId('stepan')?.homeId || sim.state.npcs.find((n) => n.homeId && n.homeId.startsWith('house'))?.homeId;
  const owner = sim.npcs.byId(sim.property.rec(home).owner);
  sim.property.rec(home).condition = 25;
  owner.money = Math.max(owner.money, 300);
  const r = K.make_repair(owner);
  K.S.offers.push(K.assess(r));
  check('Scenario 11: you take on another', K.accept(r.id).ok);
  const w2 = K.make_water(f) || null;
  let water = null;
  if (w2) {
    K.S.offers.push(K.assess(w2));
    K.accept(w2.id);
    water = K.S.active.find((x) => x.id === w2.id);
  }
  const rep = K.S.active.find((x) => x.id === r.id);
  const more = hire(sim, 1);
  K.assign(rep.id, [ws[0].id, more[0].id]);
  if (water) K.assign(water.id, [ws[1].id]);
  const ov = K.overview();
  check('Scenario 12: several contracts at once, each with its own crew', ov.active.length >= 2 && rep.workers.length === 2 && (!water || water.workers[0] === ws[1].id), JSON.stringify(ov.active.map((x) => [x.kind, x.workers])));
  workUntil(sim, () => !K.isActive(rep.id) && (!water || !K.isActive(water.id)), 4);
  check('…both get done', rep.status === 'completed' && (!water || water.status === 'completed'), `${rep.status} ${water?.status}`);
  if (water) {
    const plant = K.fieldsOf(water.bizId).map((id) => sim.state.objects[id]).find((o) => o.wateredDay === water.accepted || o.wateredDay >= water.accepted);
    check('Watering: the farmer\'s plants really watered (they grow for certain)', !!plant && water.done >= water.qty);
  }
}

// Asking for more.
{
  const sim = setup(3002);
  const K = sim.contracts;
  rand.setState(12345);
  let yes = 0;
  let no = 0;
  let twice = true;
  for (let i = 0; i < 12; i++) {
    const o = K.make_harvest(farmer(sim)) || K.make_supply();
    if (!o) continue;
    K.S.offers.push(K.assess(o));
    const pay0 = o.pay;
    const r = K.negotiate(o.id, 'pay');
    if (r.ok && o.pay > pay0) yes++;
    else no++;
    if (K.S.offers.includes(o) && K.canNegotiate(o, 'pay')) twice = false;
    K.S.offers = K.S.offers.filter((x) => x !== o);
    delete K.S.declined[o.issuer];
  }
  check('Asking for more money: sometimes yes, sometimes no — never guaranteed', yes > 0 && no > 0, `${yes} yes, ${no} no`);
  check('…and you can only ask once', twice);
  const o = K.make_harvest(farmer(sim));
  K.S.offers.push(K.assess(o));
  const d0 = o.days;
  let got = false;
  for (let i = 0; i < 1; i++) got = K.negotiate(o.id, 'time').ok;
  check('Asking for more time: an answer either way', got ? o.days > d0 : o.days === d0);
}

// Bigger jobs for a client who knows you: a new building, with you bringing the materials.
{
  const sim = setup(3003);
  const K = sim.contracts;
  const f = farmer(sim);
  f.money = 3000;
  sim.economy.biz('farm').money = 3000;
  K.client(f.id).done = 3;
  const needs = K.needs(f);
  const prop = needs.find((o) => o.proposal);
  check('A client who trusts you proposes something bigger: a new building (a major project)', prop?.proposal.what === 'new' && prop.size === 'major', `${prop?.proposal.type} ${prop?.size}`);
  const req = K.requirements(prop);
  check('…it needs a skilled builder (required)', req.required && req.field === 'building' && req.level >= 3);
  K.S.offers.push(prop);
  const noSkill = K.canAccept(prop.id);
  sim.state.player.skills.construction.level = 5;
  check('…you can\'t take it on without one; with the skill you can', !noSkill.ok && noSkill.reason === 'need_skilled_hand' && K.canAccept(prop.id).ok, noSkill.reason);
  const pay0 = prop.pay;
  const r = K.accept(prop.id, { materials: 'player' });
  const c = K.S.active.find((x) => x.id === prop.id);
  const site = c && sim.construction.byId(c.siteId);
  check('…taken on, you bringing the materials: the site is up, and yours to supply', r.ok && site?.supplier === 'player' && site.contractor === 'player' && c.pay > pay0, `${r.reason || ''} pay ${pay0} → ${c?.pay}`);
  const ws = hire(sim, 4);
  sim.state.player.money = 5000;
  sim.workers.state.budget = 2000;
  K.assign(c.id, ws.map((w) => w.id));
  let hauled = false;
  workUntil(sim, () => !K.isActive(c.id), 8, () => {
    if (ws.some((w) => ['haul', 'buy', 'gather_wood', 'gather_stone'].includes(sim.workers.contract(w.id)?.task?.kind))) hauled = true;
  });
  check('…your workers fetch the materials and build it', hauled && c.status === 'completed' && sim.construction.byId(c.siteId)?.status === 'done', `${c.status} site ${sim.construction.byId(c.siteId)?.status}`);
  check('…and you know what it cost you (materials and wages)', c.costs.materials > 0 && c.costs.wages > 0, JSON.stringify(c.costs));
}

// Late, called off, given up.
{
  const sim = setup(3004);
  const K = sim.contracts;
  const f = farmer(sim);
  const o = K.offerFromTalk(f);
  K.accept(o.id);
  const c = K.S.active.find((x) => x.id === o.id);
  c.deadline = sim.time.day - 1;
  const rep0 = K.rep();
  K.daily();
  check('Late: past the deadline the job goes on — marked late, your name suffers', K.isActive(c.id) && c.late && K.rep() < rep0 && K.statusOf(c) === 'late');
  const ws = hire(sim, 2);
  K.assign(c.id, ws.map((w) => w.id));
  workUntil(sim, () => !K.isActive(c.id), 2);
  check('…finished late: docked pay, judged late', c.status === 'completed' && c.result.deadline === 'late' && c.result.payMult < 1, JSON.stringify(c.result));
  // The client calls it off: paid for what was done.
  const o2 = K.make_repair(sim.npcs.byId(sim.property.rec('house_5')?.owner) || f) || K.make_harvest(f);
  if (o2) {
    K.S.offers.push(K.assess(o2));
    K.accept(o2.id);
    const c2 = K.S.active.find((x) => x.id === o2.id);
    c2.done = Math.floor(K.required(c2) / 2);
    const m0 = sim.state.player.money;
    const rep1 = K.rep();
    K.clientCancel(c2);
    check('Called off by the client: paid for the work done, no harm to your name', c2.status === 'cancelled' && sim.state.player.money > m0 && K.rep() === rep1, `+${sim.state.player.money - m0}`);
  }
  // You give one up: it costs you.
  const o3 = K.make_water(f) || K.make_harvest(f);
  if (o3) {
    K.S.offers.push(K.assess(o3));
    K.accept(o3.id);
    const rep2 = K.rep();
    K.abandon(o3.id);
    check('Given up by you: your name and the client\'s trust suffer', K.rep() < rep2 && K.client(o3.issuer).cancelled >= 1);
  }
}

// Your company.
{
  const sim = setup(3005);
  const K = sim.contracts;
  check('A company: not before you\'re a contractor', !K.canFound().ok && K.stage() === 'individual');
  hire(sim, 1);
  K.S.done = 9;
  K.S.rep = 60;
  const max0 = K.maxActive();
  check('…a contractor with a crew and the money: you can', K.stage() === 'contractor' && K.canFound().ok);
  K.found();
  check('…founded: a firm with its books, one more contract at once, a crew that works a little better', !!K.S.company && K.stage() === 'company' && K.maxActive() === max0 + 1 && sim.workers.teamBonus() > 1, JSON.stringify(K.books()));
  // Standing needs a good name as well as jobs done.
  K.S.rep = 30;
  check('Standing needs a good name too: with a poor one, you\'re not a contractor', K.rank().id !== 'contractor' && K.rank().id !== 'master_contractor', K.rank().id);
}

// Save and load: your name, your clients, your firm, a contract under way.
{
  const sim = setup(3006);
  const K = sim.contracts;
  K.S.rep = 63;
  K.client('gregory').done = 2;
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  const ws = hire(sim, 1);
  K.assign(o.id, [ws[0].id]);
  toHour(sim, 8);
  runOn(sim)(90);
  const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  const K2 = sim2.contracts;
  const c = K2.S.active.find((x) => x.id === o.id);
  check('After loading: your name, the client\'s trust, the contract and its costs', K2.rep() === 63 && K2.trust('gregory') >= 2 && !!c && c.costs.wages >= 0 && c.workers[0] === ws[0].id);
  workUntil(sim2, () => !K2.isActive(o.id), 3);
  check('…and it carries on to the end', c.status === 'completed' && K2.history()[0].id === o.id);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll contractor checks passed');
process.exit(failures ? 1 : 0);
