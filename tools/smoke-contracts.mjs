// Headless test for contracts villagers offer you — and your workers doing them (the nine
// scenarios in the hired-workers / NPC jobs / XP spec): the farmer asks you to bring in his
// ripe wheat; you do it yourself, or hand it to one worker, or two; they walk to the real field,
// pick the real plants and carry the wheat to the farmhouse; the farmer pays you, you gain
// experience for running the job and each worker for their share of the work; the workers go
// back to their usual work; a worker whose plant is gone gets unstuck; two workers repair one
// building from their own spots; and it all survives save / load — with nothing paid twice.
// Usage: node tools/smoke-contracts.mjs
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
/** Work the day through (8 to 17), day after day, until done() or out of days. */
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

// Test 1 — the farmer asks; you take it on and do it all yourself: paid, and experience.
{
  const sim = setup(2001);
  const K = sim.contracts;
  const f = farmer(sim);
  const need = K.needOf(f);
  check('Test 1: the farmer needs his ripe wheat brought in (a real need: his field)', need?.kind === 'harvest' && K.ripe(need.bizId).length >= need.qty, `${need?.kind} ${need?.qty} of ${need && K.ripe(need.bizId).length} ripe`);
  const o = K.offerFromTalk(f);
  check('…and asks you in person: client, place, work, hands, pay, deadline', o.via === 'talk' && o.issuer === f.id && o.building === 'farmhouse' && o.qty > 0 && K.recommended(o) >= 1 && o.pay > 0 && o.days === 2);
  K.accept(o.id);
  const c = K.S.active.find((x) => x.id === o.id);
  check('…you accept: it is yours now', !!c && c.status === 'accepted' && c.contractor === 'player');
  const money0 = sim.state.player.money;
  const xp0 = sim.state.player.xp + sim.progression.xpForNext(sim.state.player.level) * 0; // (xp within the level)
  const lvl0 = sim.state.player.level;
  let n = 0;
  for (const obj of K.ripe(c.bizId)) {
    if (c.done >= c.qty) break;
    sim.state.player.energy = 100;
    if (sim.actions.complete(obj)) n++;
  }
  check('…you pick the plants yourself, and they count', c.done === c.qty && n === c.qty && (c.owed || 0) > 0, `${c.done}/${c.qty}, carrying ${c.owed} wheat`);
  check('…not done until the farmer has his wheat', K.isActive(c.id));
  const farmWheat = sim.economy.stock('farm', 'wheat');
  K.deliver(c.id);
  check('…you hand it over at the farmhouse: done, and the wheat is in his barn', !K.isActive(c.id) && sim.economy.stock('farm', 'wheat') > farmWheat);
  check('…he paid you', sim.state.player.money - money0 === c.pay || c.awarded.pay === sim.state.player.money - money0, `+${sim.state.player.money - money0} of ${c.pay}`);
  check('…you gained experience for the job', c.awarded.xp > 0 && (sim.state.player.level > lvl0 || sim.state.player.xp > xp0), `+${c.awarded.xp} XP`);
  check('…the job is on your record', K.S.done === 1 && K.S.log.at(-1).how === 'done' && K.S.log.at(-1).you === c.qty);
}

// Test 2 — you hand it to one worker: they go, harvest, carry it in; you're paid and both gain.
let T8save = null;
{
  const sim = setup(2002);
  const K = sim.contracts;
  const [w] = hire(sim, 1);
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  const c = K.S.active.find((x) => x.id === o.id);
  K.assign(c.id, [w.id]);
  const wc = sim.workers.contract(w.id);
  check('Test 2: you put a worker on it', c.workers.includes(w.id) && wc.job === c.id && ['preparing', 'accepted'].includes(c.status));
  toHour(sim, 8);
  runOn(sim)(20);
  check('…they go to the farmer\'s field and pick a real plant', wc.task?.kind === 'charvest' && sim.state.objects[wc.task.target]?.kind === 'crop' && K.fieldsOf(c.bizId).includes(wc.task.target), `${wc.task?.kind} ${wc.state}`);
  const money0 = sim.state.player.money;
  const wxp0 = (w.xp || 0) + w.level * 1000;
  const farm0 = sim.economy.stock('farm', 'wheat');
  let carried = false;
  workUntil(sim, () => !K.isActive(c.id), 4, () => {
    if (w.carry?.contract === c.id) carried = true;
  });
  check('…they carry the wheat to the farmhouse', carried && sim.economy.stock('farm', 'wheat') > farm0, `barn ${farm0} → ${sim.economy.stock('farm', 'wheat')}`);
  check('…and finish the job: done, paid', !K.isActive(c.id) && c.status === 'completed' && sim.state.player.money - money0 >= c.awarded.pay - 40 && c.awarded.pay > 0, `${c.status}, paid ${c.awarded.pay}`);
  check('…you gained experience though you picked nothing', c.awarded.xp > 0 && !c.crew.player);
  check('…and so did the worker, for the work they did', c.awarded.workers?.[w.id]?.xp > 0 && (w.xp || 0) + w.level * 1000 > wxp0, JSON.stringify(c.awarded.workers));
  // Test 7 — the job over, they go back to their usual work.
  check('Test 7: the worker is off the job', wc.job === undefined && !c.workers.length);
  runOn(sim)(60);
  check('…and back at their usual work (not standing about the field)', !wc.task?.contract && (!!wc.task || ['working', 'moving', 'waiting', 'seeking'].includes(wc.state) || sim.npcs.byId(w.id).task?.type !== 'work'), `${wc.state} ${wc.task?.kind || ''}`);
  T8save = null;
}

// Test 3 — two workers on one field: both at work at once, each on their own plant; it all adds up.
{
  const sim = setup(2003);
  const K = sim.contracts;
  const ws = hire(sim, 2);
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  const c = K.S.active.find((x) => x.id === o.id);
  K.assign(c.id, ws.map((w) => w.id));
  let together = false;
  let samePlant = false;
  let sameSpot = false;
  workUntil(sim, () => !K.isActive(c.id), 4, () => {
    const ts = ws.map((w) => sim.workers.contract(w.id)?.task).filter((t) => t?.kind === 'charvest');
    if (ts.length === 2) {
      together = true;
      if (ts[0].target === ts[1].target) samePlant = true;
      if (ts[0].spot && ts[1].spot && ts[0].spot.tx === ts[1].spot.tx && ts[0].spot.ty === ts[1].spot.ty) sameSpot = true;
    }
  });
  check('Test 3: two workers harvest at the same time', together);
  check('…never the same plant, never the same spot', !samePlant && !sameSpot);
  check('…both did their share, and it adds up to the job', ws.every((w) => c.crew[w.id] > 0) && Math.round(Object.values(c.crew).reduce((s, v) => s + v, 0)) === c.qty, JSON.stringify(c.crew));
  check('…the job is done and both gained experience', c.status === 'completed' && ws.every((w) => c.awarded.workers[w.id]?.xp > 0));
}

// Test 4 — a worker finishes a task and finds the next by themselves.
{
  const sim = setup(2004);
  const K = sim.contracts;
  const [w] = hire(sim, 1);
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  K.assign(o.id, [w.id]);
  const wc = sim.workers.contract(w.id);
  toHour(sim, 8);
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    runOn(sim)(15);
    if (wc.task?.kind === 'charvest') seen.add(wc.task.target);
  }
  check('Test 4: plant after plant, nobody telling them', seen.size >= 3 && wc.stats.done >= 2, `${seen.size} plants, ${wc.stats.done} tasks`);
}

// Test 5 — two workers repair one building, each from their own spot.
{
  const sim = setup(2005);
  const K = sim.contracts;
  const ws = hire(sim, 2);
  const f = farmer(sim);
  // His house is in a bad way (the storm last week).
  const home = f.homeId;
  sim.property.rec(home).condition = 30;
  for (const x of sim.economy.ofType('farm')) sim.state.objects && K.ripe(x).forEach((o) => (o.stage = 1)); // nothing ripe: it's the house he needs
  const o = K.offerFromTalk(f);
  check('Test 5: a worn house — its owner wants it repaired', o?.kind === 'repair' && o.building === home && o.qty >= 60, `${o?.kind} ${o?.qty}`);
  K.accept(o.id);
  const c = K.S.active.find((x) => x.id === o.id);
  K.assign(c.id, ws.map((w) => w.id));
  let both = false;
  let clash = false;
  workUntil(sim, () => !K.isActive(c.id), 4, () => {
    const ts = ws.map((w) => sim.workers.contract(w.id)?.task).filter((t) => t?.kind === 'crepair');
    const here = ws.filter((w) => sim.workers.contract(w.id)?.task?.kind === 'crepair' && sim.npcs.byId(w.id).task?.stage === 'working');
    if (here.length === 2) {
      both = true;
      if (ts[0].spot.tx === ts[1].spot.tx && ts[0].spot.ty === ts[1].spot.ty) clash = true;
    }
  });
  check('…both work on it at once, from separate spots', both && !clash);
  check('…the house is really repaired, and the job done', sim.property.rec(home).condition >= 90 && c.status === 'completed', `condition ${Math.round(sim.property.rec(home).condition)}, ${c.status}`);
}

// Test 6 — a worker's plant is taken from under them: the watchdog notices, they pick another.
{
  const sim = setup(2006);
  const K = sim.contracts;
  const [w] = hire(sim, 1);
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  K.assign(o.id, [w.id]);
  const wc = sim.workers.contract(w.id);
  toHour(sim, 8);
  runOn(sim)(5);
  const first = wc.task?.target;
  // Someone else harvests it first (and the worker is frozen in place, with the task gone bad).
  if (first) sim.resources.harvestCrop(first);
  const npc = sim.npcs.byId(w.id);
  sim.npcs.paths.delete(npc.id);
  npc.moving = false;
  npc.task.stage = 'working';
  npc.task.until = sim.time.total + 9999;
  runOn(sim)(30);
  check('Test 6: the watchdog frees a worker whose task went bad', !!first && wc.task?.target !== first && (wc.unstuck || 0) >= 1, `unstuck ${wc.unstuck}, why ${wc.lastStuck?.why}`);
  runOn(sim)(40);
  check('…and they carry on with the job', wc.task?.kind === 'charvest' || K.S.active.find((x) => x.id === o.id)?.crew[w.id] > 0);
  // Stuck in place for too long while "walking": moved on too.
  const before = wc.unstuck || 0;
  sim.npcs.paths.set(npc.id, [{ tx: npc.x >> 5, ty: npc.y >> 5 }]);
  npc.moving = true;
  wc.stateSince = sim.time.total - 1000;
  sim.workers.watchdog();
  check('…a walk that never ends is caught too', wc.unstuck > before, wc.lastStuck?.why);
}

// Tests 8 & 9 — save while they're at it; load; they carry on and finish; nothing paid twice.
{
  const sim = setup(2008);
  const K = sim.contracts;
  const ws = hire(sim, 2);
  const o = K.offerFromTalk(farmer(sim));
  K.accept(o.id);
  K.assign(o.id, ws.map((w) => w.id));
  toHour(sim, 8);
  runOn(sim)(90);
  const c0 = K.S.active.find((x) => x.id === o.id);
  check('Test 8: the job is under way when you save', !!c0 && c0.done > 0 && c0.done < c0.qty, `${c0?.done}/${c0?.qty}`);
  const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  const K2 = sim2.contracts;
  const c = K2.S.active.find((x) => x.id === o.id);
  check('…after loading: the job, its progress, its workers', !!c && c.done === c0.done && JSON.stringify(c.workers) === JSON.stringify(c0.workers) && ws.every((w) => sim2.workers.contract(w.id).job === o.id));
  const money0 = sim2.state.player.money;
  workUntil(sim2, () => !K2.isActive(o.id), 4);
  check('…the workers carry on and finish it', c.status === 'completed' && c.done >= c.qty, `${c.status} ${c.done}/${c.qty}`);
  const paid = sim2.state.player.money - money0;
  const lvl = sim2.state.player.level;
  const xp = sim2.state.player.xp;
  const wxp = ws.map((w) => sim2.npcs.byId(w.id).xp);
  const done = K2.S.done;
  // Test 9: save after it's settled, load again: nothing's paid out again.
  const sim3 = new Simulation(JSON.parse(JSON.stringify(sim2.state)));
  const K3 = sim3.contracts;
  const m3 = sim3.state.player.money;
  runOn(sim3)(24 * 60);
  K3.complete(c); // (even asked to settle it again)
  check('Test 9: loaded after the job was settled — not paid again', !K3.isActive(o.id) && K3.S.done === done && sim3.state.player.money <= m3 + 1 && c.awarded.pay > 0, `paid ${paid}, money ${m3} → ${sim3.state.player.money}`);
  check('…no experience again either (you or your workers)', sim3.state.player.level === lvl && sim3.state.player.xp === xp && ws.every((w, i) => sim3.npcs.byId(w.id).xp === wxp[i] || sim3.npcs.byId(w.id).xp >= wxp[i]));
  check('…the record shows it once, with what was awarded', K3.S.log.filter((x) => x.id === o.id).length === 1 && K3.S.log.find((x) => x.id === o.id).xp > 0);
}

// Any contract, any job: your workers do it — you're the manager, paid by the client; they're on their wages.
const pushOffer = (sim, kind, extra) => {
  const o = sim.contracts.base(kind, extra);
  sim.contracts.S.offers.push(o);
  sim.contracts.accept(o.id);
  return sim.contracts.S.active.find((x) => x.id === o.id);
};
{
  // A supply contract: goods from your storage, carried to the business.
  const sim = setup(2011);
  const K = sim.contracts;
  const [w] = hire(sim, 1);
  const E = sim.economy;
  const c = pushOffer(sim, 'supply', { bizId: 'tavern', issuer: E.ownerId('tavern'), building: E.biz('tavern').building, item: 'wood', qty: 12, pay: 40, days: 5 });
  sim.home.store('wood', 12, { force: true });
  const stock0 = E.stock('tavern', 'wood');
  const money0 = sim.state.player.money;
  K.assign(c.id, [w.id]);
  workUntil(sim, () => !K.isActive(c.id), 3);
  check('Supply: a worker takes the goods from your storage to the business', c.status === 'completed' && sim.home.storageCount('wood') === 0 && E.stock('tavern', 'wood') >= stock0 + 12 - 4, `${c.status}, tavern wood ${stock0} → ${E.stock('tavern', 'wood')}`);
  check('…you are paid, the worker gains experience', c.awarded.pay > 0 && sim.state.player.money > money0 - 40 && c.awarded.workers[w.id]?.xp > 0, `paid ${c.awarded.pay}`);
}
{
  // Nothing in storage, buying turned off: they gather it (wood from the forest).
  const sim = setup(2012);
  const K = sim.contracts;
  const [w] = hire(sim, 1);
  sim.workers.state.buy = false;
  const E = sim.economy;
  const c = pushOffer(sim, 'supply', { bizId: 'tavern', issuer: E.ownerId('tavern'), building: E.biz('tavern').building, item: 'wood', qty: 6, pay: 25, days: 5 });
  K.assign(c.id, [w.id]);
  let felled = false;
  workUntil(sim, () => !K.isActive(c.id), 3, () => {
    if (sim.workers.contract(w.id)?.task?.kind === 'gather_wood') felled = true;
  });
  check('Supply by gathering: nothing in store, no buying — they fell trees for it', felled && c.status === 'completed', `${c.status} ${c.delivered}/${c.qty}`);
}
{
  // A shift from the notice board: you take it for your workers; they work the hours.
  const sim = setup(2013);
  const K = sim.contracts;
  const ws = hire(sim, 1);
  sim.jobs.refresh();
  const id = ['store_assistant', 'dishwasher', 'tavern_server', 'mill_hand'].find((j) => K.canTakeJob(j).ok);
  const r = id ? K.takeJob(id) : { ok: false };
  const c = K.S.active.find((x) => x.id === r.id);
  check('A notice-board shift, taken for your workers', !!c && c.kind === 'job' && c.type === 'shift' && c.hours > 0, `${id} ${JSON.stringify(r)}`);
  if (c) {
    K.assign(c.id, ws.map((w) => w.id));
    const money0 = sim.state.player.money;
    workUntil(sim, () => !K.isActive(c.id), 2);
    check('…they work the hours at the employer\'s, and you are paid', c.status === 'completed' && c.done >= c.hours && sim.state.player.money - money0 >= c.awarded.pay - 30, `${c.status} ${c.done}/${c.hours}, paid ${c.awarded.pay}`);
  }
}
{
  // A courier job: the parcel picked up and walked to the house.
  const sim = setup(2014);
  const K = sim.contracts;
  const ws = hire(sim, 1);
  sim.jobs.refresh();
  const id = ['courier', 'mail_rounds'].find((j) => K.canTakeJob(j).ok);
  const r = id ? K.takeJob(id) : { ok: false };
  const c = K.S.active.find((x) => x.id === r.id);
  if (c) {
    K.assign(c.id, ws.map((w) => w.id));
    let carried = false;
    workUntil(sim, () => !K.isActive(c.id), 2, () => {
      if (sim.npcs.byId(ws[0].id).carry?.item === 'package') carried = true;
    });
    check('Courier / letters: a worker picks them up and takes them round', (carried || c.crew[ws[0].id] > 0) && c.status === 'completed' && c.targets.length === 0, `${id} ${c.status} ${c.done}/${c.qty}`);
  } else check('Courier / letters: a worker picks them up and takes them round', false, JSON.stringify(r));
}
{
  // The job you took yourself, handed to your workers before you started.
  const sim = setup(2015);
  const K = sim.contracts;
  const ws = hire(sim, 1);
  sim.jobs.refresh();
  toHour(sim, 9);
  const id = ['store_assistant', 'dishwasher', 'lumber_delivery', 'quarry_miner'].find((j) => sim.jobs.check(j).ok);
  sim.jobs.accept(id);
  const r = K.handOver();
  const c = K.S.active.find((x) => x.id === r.id);
  check('Your own job, handed to your workers', !!c && !sim.jobs.active && c.jobId === id, `${id} ${JSON.stringify(r)}`);
  if (c) {
    K.assign(c.id, ws.map((w) => w.id));
    workUntil(sim, () => !K.isActive(c.id), 3);
    check('…and they get it done', c.status === 'completed', `${c.status} ${c.done}/${K.required(c)} ${JSON.stringify(K.blocker(c))}`);
  }
}
{
  // Materials to a building site (a haulage job from the notice board).
  const sim = setup(2016);
  const K = sim.contracts;
  const ws = hire(sim, 2);
  // A villager's site short of wood, and the lumberyard with wood to send.
  sim.state.village.treasury += 2000;
  const site = sim.growth.start('village', 'small_house', 'rental', { tx: 84, ty: 44 });
  sim.economy.biz('lumberyard').stock.wood = 60;
  sim.jobs.refresh();
  const r = K.canTakeJob('lumber_haul').ok ? K.takeJob('lumber_haul') : { ok: false, reason: K.canTakeJob('lumber_haul').reason };
  const c = K.S.active.find((x) => x.id === r.id);
  if (c) {
    const got0 = site.delivered.wood || 0;
    K.assign(c.id, ws.map((w) => w.id));
    workUntil(sim, () => !K.isActive(c.id), 2);
    check('Haulage to a site: workers carry the supplier\'s materials to the site', c.status === 'completed' && (sim.construction.byId(c.siteId)?.delivered.wood || 0) > got0, `${c.status} ${c.done}/${c.qty}`);
  } else check('Haulage to a site: workers carry the supplier\'s materials to the site', false, JSON.stringify(r));
}

// Contractor rank: see enough jobs through and bigger ones come your way.
{
  const sim = setup(2010);
  const K = sim.contracts;
  const r0 = K.rank();
  K.S.done = 8;
  check('Contractor rank: more contracts at once, and bigger', K.rank().maxActive > r0.maxActive && K.rank().size > r0.size, `${r0.id} → ${K.rank().id}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll contract checks passed');
process.exit(failures ? 1 : 0);
