// Headless test for carrying goods for other people (FreightSystem):
//   carrier  — sign up; the shops' loads start coming to you (the buyer pays you, not the porters);
//              pick one up at the seller's door, take it to the buyer's, get paid; late is paid less;
//              a load nobody touches goes back to the porters (and your name suffers)
//   company  — needs a transport depot; your workers carry deliveries (physically, door to door)
//   caravans — your cart, a driver and goods from your storage to another settlement: they sell,
//              bring back what you asked for, and come home (or get robbed on the way)
//   and      — none of it rolls the game's dice when you're not a carrier; it all survives a save
// Usage: node tools/smoke-freight.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';
import { FREIGHT, CARAVAN } from '../src/data/freight.js';
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
function setup(seed) {
  const sim = Simulation.newGame('T', seed);
  sim.state.player.money = 20000;
  sim.progression.addXp(20000);
  sim.state.player.skills.construction.level = 6;
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
    sim.workers.hire(w, 16);
    out.push(w);
  }
  return out;
}
/** Run until a load comes to you (or give up). */
const waitForJob = (sim, days = 4) => {
  const end = sim.time.total + days * 1440;
  while (!sim.freight.S.jobs.length && sim.time.total < end) sim.update(2000);
  return sim.freight.S.jobs[0] || null;
};

// ================================================================== not a carrier: nothing changes
{
  const sim = setup(9601);
  let mine = 0;
  sim.bus.on('logistics:shipped', (s) => s.player && mine++);
  runOn(sim)(2 * 1440);
  check('Not signed up: no loads come to you', mine === 0 && sim.freight.S.jobs.length === 0);
  const r0 = rand.getState();
  sim.freight.tick(sim.time.total);
  const fake = { id: 999, qty: 20, fromB: 'store', toB: 'store', depart: 1 };
  sim.freight.offer(fake, { dist: 30, minutes: { porter: 60 } });
  check('…and asking never rolls the dice', rand.getState() === r0);
}

// ================================================================== you, carrying
{
  const sim = setup(9602);
  const F = sim.freight;
  const p = sim.state.player;
  check('Signing up as a carrier', F.signUp().ok && F.company.kind === 'self' && F.capacity() === FREIGHT.selfJobs);
  const job = waitForJob(sim);
  check('A shop\'s load comes to you', !!job, job ? `${job.qty} ${job.item} ${job.fromB} → ${job.toB}, $${job.fee}` : '');
  if (job) {
    const s = F.shipment(job);
    check('…the goods wait for you (they don\'t travel by themselves)', s && s.player === job.id && s.arrive === Infinity);
    check('The HUD tells you where to pick it up', F.objective()?.key === 'objective.freight_pickup');
    check('You can\'t unload what you haven\'t loaded', !F.unloadHere(job.toB).ok);
    const r = F.loadHere(job.fromB);
    check('At the seller\'s door: loaded', r.ok && F.carrying()?.qty === Math.min(job.qty, FREIGHT.handCap));
    check('…and the HUD says where to take it', F.objective()?.key === 'objective.freight_deliver');
    check('The wrong door won\'t take it', job.fromB === job.toB || !F.unloadHere(job.fromB).ok);
    const E = sim.economy;
    const stock0 = E.biz(job.to).stock[job.item] || 0;
    const money0 = p.money;
    let rest = job.qty;
    // (A load bigger than your arms: back and forth.)
    for (let i = 0; i < 10 && F.job(job.id); i++) {
      if (!F.carrying()) F.loadHere(job.fromB);
      rest -= F.carrying().qty;
      F.unloadHere(job.toB);
    }
    check('Unloaded at the buyer\'s: it\'s in their stores', (E.biz(job.to).stock[job.item] || 0) >= stock0 + job.qty);
    check('…and you\'re paid the fee (on time: in full)', p.money === money0 + job.fee, `+$${p.money - money0}`);
    check('Your name as a carrier goes up', F.company.rep === FREIGHT.rep.start + FREIGHT.rep.onTime && F.company.delivered === 1);
    check('The shipment is done with', !sim.state.logistics.shipments.some((x) => x.id === job.ship));
    check('Your ledger has it under carrying', sim.ledger.summary(1).in?.freight >= job.fee || JSON.stringify(sim.state.ledger.days.at(-1)).includes('freight'));
  }
  // Late.
  const j2 = waitForJob(sim);
  if (j2) {
    j2.due = sim.time.total - 1;
    const m0 = p.money;
    const buyer0 = sim.economy.biz(j2.to).money;
    for (let i = 0; i < 10 && F.job(j2.id); i++) {
      F.loadHere(j2.fromB);
      F.unloadHere(j2.toB);
    }
    check('Late: paid less', p.money - m0 === Math.round(j2.fee * FREIGHT.lateFee), `$${p.money - m0} of $${j2.fee}`);
    check('…and the buyer gets the rest back', sim.economy.biz(j2.to).money - buyer0 >= j2.fee - Math.round(j2.fee * FREIGHT.lateFee));
  } else check('A second load comes', false);
  // Never picked up.
  const j3 = waitForJob(sim);
  if (j3) {
    const rep = F.company.rep;
    runOn(sim)(j3.due - sim.time.total + FREIGHT.handOver + 30);
    check('A load nobody touches goes back to the porters', !F.job(j3.id) && F.company.handed === 1);
    check('…and your name suffers', F.company.rep < rep);
    const s = sim.state.logistics.shipments.find((x) => x.id === j3.ship);
    check('…the porters carry it (it arrives as usual)', !s || (!s.player && s.arrive < Infinity));
  } else check('A third load comes', false);
}

// ================================================================== a company, your workers carrying
{
  const sim = setup(9603);
  const F = sim.freight;
  const tr = transportTools({ sim });
  check('A company needs a transport depot', F.canFound().reason === 'need_depot');
  const depot = tr.build('transport_depot');
  check('With a depot, you can register one', F.canFound().ok, depot);
  const money0 = sim.state.player.money;
  F.found();
  check('Registered (it costs the fee)', F.company.kind === 'firm' && sim.state.player.money === money0 - FREIGHT.foundCost);
  const crew = hire(sim, 2);
  check('More hands, more deliveries at once', F.capacity() === Math.max(FREIGHT.minJobs, 2 * FREIGHT.jobsPerWorker) + FREIGHT.selfJobs);
  let carried = false;
  let loadedAt = null;
  const end = sim.time.total + 5 * 1440;
  while (sim.time.total < end && !(F.company.delivered >= 1)) {
    sim.update(2000);
    for (const w of crew) {
      if (w.carry?.freight !== undefined) {
        carried = true;
        loadedAt ??= { x: w.x, y: w.y, job: F.job(w.carry.freight) };
      }
    }
  }
  check('Your workers pick up deliveries', carried);
  if (loadedAt?.job) {
    const b = sim.world.buildings[loadedAt.job.fromB];
    const d = Math.abs(Math.floor(loadedAt.x / 32) - b.door.tx) + Math.abs(Math.floor(loadedAt.y / 32) - b.door.ty);
    check('…at the seller\'s door (they walked there)', d <= 6, `${d} tiles`);
  }
  check('…and deliver them (you\'re paid)', F.company.delivered >= 1 && F.company.earned > 0, `${F.company.delivered} delivered, $${F.company.earned}`);
}

// ================================================================== caravans
{
  const sim = setup(9604);
  const F = sim.freight;
  const S = sim.settlements;
  const E = sim.equipment;
  const to = S.ids()[0];
  check('No contacts: nowhere to send a caravan', !F.destinations().length);
  S.makeContact(to, 'test');
  const cart = E.create('handcart', { owner: 'player' });
  const t = sim.world.toTile(sim.state.player.x, sim.state.player.y);
  E.park(cart, t.tx, t.ty);
  check('No driver: no caravan', F.canSend({ to, eq: cart.id, driver: 'nobody', cargo: { wood: 30 } }).reason === 'need_driver');
  const [driver] = hire(sim, 1);
  sim.home.store('wood', 60, { force: true });
  check('Too small a load isn\'t worth it', F.canSend({ to, eq: cart.id, driver: driver.id, cargo: { wood: 5 } }).reason === 'cargo_small');
  check('More than the cart holds won\'t fit', F.canSend({ to, eq: cart.id, driver: driver.id, cargo: { wood: E.cap(cart) + 10 } }).reason === 'cargo_big' || E.cap(cart) + 10 > 60);
  S.danger = () => 0; // (a safe road, for this one)
  const buy = Object.keys(S.def(to).produces)[0];
  const spec = { to, eq: cart.id, driver: driver.id, cargo: { wood: 50 }, buy };
  const chk = F.canSend(spec);
  check('A caravan you can send', chk.ok, chk.ok ? `${chk.days} days, worth ~$${chk.worth}` : chk.reason);
  const money0 = sim.state.player.money;
  const r = F.send(spec);
  check('Off it goes: the wood leaves your storage', r.ok && sim.home.storageCount('wood') === 10);
  check('…the cart and the driver leave the valley', E.status(cart) === 'on_the_road' && !!driver.away);
  check('The cart can\'t be lent while it\'s away', !F.caravanEquipment().includes(cart));
  runOn(sim)(chk.days * 1440 + 60);
  const c = F.S.caravans[0];
  check('It arrives and sells', c?.stage === 'back' && c.sold > 0, c ? `$${c.sold}` : '');
  check('…buying what you asked for with the takings', c && (c.got[buy] || 0) > 0, c ? JSON.stringify(c.got) : '');
  runOn(sim)(chk.days * 1440 + CARAVAN.marketHours * 60 + 60);
  check('It comes home', !F.S.caravans.length && !driver.away);
  check('…with the goods', sim.home.storageCount(buy) >= (c?.got[buy] || 1));
  check('…and the money', sim.state.player.money > money0, `+$${sim.state.player.money - money0}`);
  check('The cart is back (worn by the road)', E.status(cart) !== 'on_the_road' && cart.condition < 100);
  // Bandits.
  S.danger = () => 5;
  sim.home.store('wood', 40, { force: true });
  F.send({ to, eq: cart.id, driver: driver.id, cargo: { wood: 40 } });
  runOn(sim)(2 * chk.days * 1440 + CARAVAN.marketHours * 60 + 120);
  check('On a dangerous road: robbed (you\'re told)', F.S.caravanStats.robbed === 1 && F.S.log.some((e) => e.kind === 'caravan' && e.robbed));
}

// ================================================================== saving
{
  const sim = setup(9605);
  sim.freight.signUp();
  const job = waitForJob(sim);
  if (job) sim.freight.loadHere(job.fromB);
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('Your carrying business and loads are saved', copy.freight.company?.kind === 'self' && copy.freight.S.jobs.length === sim.freight.S.jobs.length && (!job || copy.freight.carrying()?.qty === sim.freight.carrying()?.qty));
  const old = JSON.parse(JSON.stringify(sim.state));
  delete old.freight;
  check('An old save (from before) loads', !!new Simulation(old).freight.S);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll freight checks passed');
process.exit(failures ? 1 : 0);
