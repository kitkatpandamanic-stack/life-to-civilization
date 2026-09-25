// Headless test for buildings, equipment and transport: the spec's final scenario from start to
// finish — your warehouse with 200 wood, a house to build for a villager, three workers, one of
// them with a wheelbarrow: they fetch, load, push it over, unload, build, go back for more, all at
// once without getting in each other's way; the house goes up stage by stage; the contract is paid
// once, you and they get experience once, they go back to their usual work, and the wheelbarrow
// stays theirs until you take it back. Then: nothing duplicated, a site waiting for materials, you
// with a handcart, broken equipment, carts on roads and grass, journeys, depots, the building sheet,
// interaction points — and save / load in the middle of it all.
// Usage: node tools/smoke-transport.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';
import { EQUIPMENT } from '../src/data/transport.js';

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
const woodIn = (c) => (c ? c.items?.wood ?? (c.item === 'wood' ? c.qty : 0) : 0);

// ================================================================== the final scenario
{
  const sim = setup(6001);
  const tr = transportTools({ sim });
  const E = sim.equipment;
  const W = sim.workers;
  const K = sim.contracts;
  const C = sim.construction;

  // 1–2. Your warehouse, with 200 wood in it.
  const wh = tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  sim.home.store('wood', 200, { force: true });
  sim.home.store('stone', 100, { force: true });
  sim.home.store('planks', 40, { force: true });
  check('1. You own a warehouse — and it is where your workers fetch from', !!wh && W.baseBuilding().id === wh, `${wh} base ${W.baseBuilding().id}`);
  check('2. …with 200 wood in it', sim.home.storageCount('wood') === 200 && sim.home.storageCapacity() >= 400, `cap ${sim.home.storageCapacity()}`);

  // 3. A house to build for a villager (you bring the materials, with their advance).
  K.S.rep = 70;
  let offer = null;
  for (const n of sim.state.npcs.filter((x) => x.age >= 20 && x.homeId && !x.owns && !sim.growth.projectOf?.(x))) {
    n.money = 2000;
    K.client(n.id).done = 3;
    offer = K.make_proposal(n);
    if (offer?.proposal?.what === 'new') break;
    offer = null;
  }
  K.S.offers.push(K.assess(offer));
  const acc = K.accept(offer.id, { materials: 'included' });
  const job = K.S.active.find((x) => x.id === offer.id);
  const site = job && C.byId(job.siteId);
  // (A good-sized house: the spec's 150 wood.)
  if (site) site.required = { wood: 150, stone: 60, planks: 30 };
  check('3. You take on a house to build for a villager', acc.ok && site?.status === 'site' && site.supplier === 'player', `${acc.reason || ''} ${offer.proposal.type} ${JSON.stringify(site?.required)}`);

  // 4–5. Three workers; one of them gets a wheelbarrow.
  const [a, b, c] = hire(sim, 3);
  for (const w of [a, b, c]) W.setPriority(w.id, 'gathering', 'off');
  K.assign(job.id, [a.id, b.id, c.id]);
  const barrow = E.create('wheelbarrow');
  const lent = E.lend(barrow.id, a.id);
  check('4. You hire three workers and put them on the job', job.workers.length === 3);
  check('5. You lend one of them a wheelbarrow: it is theirs to use (it stands in your yard)', lent.ok && E.assignedTo(a.id) === barrow && barrow.at.kind === 'ground' && E.status(barrow) === 'assigned_worker', JSON.stringify(barrow.at));
  const count0 = E.list().length;

  // 6–15. Watch the work.
  const W0 = sim.home.storageCount('wood');
  const money0 = sim.state.player.money;
  const xp0 = sim.state.player.xp;
  const obs = { tookBarrow: false, atWarehouse: false, loaded: 0, maxHand: 0, transported: false, unloads: 0, unloadJump: 0, laborAfterUnload: false, returned: false, together: 0, clash: false, stages: new Set(), conserved: true, over: false, phases: new Set(), aLoadPts: new Set() };
  let lastWood = 0;
  let lastA = null;
  let saved = null;
  const run = runOn(sim);
  toHour(sim, 8);
  for (let d = 0; d < 8 && K.isActive(job.id); d++) {
    for (let step = 0; step < 9 * 12 && K.isActive(job.id); step++) {
      run(5);
      const cA = W.contract(a.id);
      if (E.using(a) === barrow) obs.tookBarrow = true;
      if (cA?.phase) obs.phases.add(cA.phase);
      const whB = sim.world.buildings[wh];
      const here = sim.world.toTile(a.x, a.y);
      if (Math.abs(here.tx - whB.door.tx) <= 3 && Math.abs(here.ty - whB.door.ty) <= 3 && E.using(a)) obs.atWarehouse = true;
      if (a.task?.stage === 'loading' && woodIn(a.carry) > 20) obs.loaded = Math.max(obs.loaded, woodIn(a.carry));
      if (a.task?.stage === 'loading' && cA?.task?.spot) obs.aLoadPts.add(`${cA.task.spot.tx},${cA.task.spot.ty}`);
      for (const w of [b, c]) obs.maxHand = Math.max(obs.maxHand, w.carry?.qty || 0);
      // Moving with the load, closer to the site each time.
      if (a.task?.stage === 'carry_site' && E.using(a) && a.carry) {
        const d2 = Math.abs(here.tx - site.tx) + Math.abs(here.ty - site.ty);
        if (lastA !== null && d2 < lastA) obs.transported = true;
        lastA = d2;
      } else lastA = null;
      const dw = site.delivered.wood || 0;
      if (site.status === 'site' && dw > lastWood) {
        if (a.task?.dest === 'carry_site' || a.task?.stage === 'unloading' || (dw - lastWood > 20)) obs.unloads++;
        obs.unloadJump = Math.max(obs.unloadJump, dw - lastWood);
        lastWood = dw;
      }
      if (site.status === 'site' && site.labor > 0 && dw > 0) obs.laborAfterUnload = true;
      if (obs.unloads && cA?.phase === 'return') obs.returned = true;
      if (site.status === 'site') obs.stages.add(C.stage(site));
      // Several at once, and never two on one spot.
      const busy = [a, b, c].map((w) => W.contract(w.id)).filter((x) => x?.task && x.state !== 'waiting');
      if (busy.length >= 2) obs.together++;
      const spots = busy.filter((x) => x.task.spot && x.task.kind !== 'take_eq').map((x) => `${x.task.spot.tx},${x.task.spot.ty}`);
      if (new Set(spots).size < spots.length && busy.filter((x) => x.task.spot).every((x) => !['haul', 'buy', 'cfetch'].includes(x.task.kind))) obs.clash = true;
      // Nothing made out of nothing: the wood is in store, on the site, or on its way.
      const carried = [a, b, c].reduce((s, w) => s + woodIn(w.carry), 0) + woodIn(barrow.cargo);
      const total = sim.home.storageCount('wood') + (site.status === 'site' ? dw : site.required.wood || 0) + carried;
      if (site.status === 'site' && total !== W0) obs.conserved = false;
      if (site.status === 'site' && dw > (site.required.wood || 0)) obs.over = true;
      // Save in the middle of the work (checked below).
      if (!saved && obs.unloads >= 2 && E.using(a)) saved = JSON.stringify(sim.state);
    }
    if (K.isActive(job.id)) toHour(sim, 8);
  }
  check('6. The worker with the barrow fetches it first, then goes to your warehouse', obs.tookBarrow && obs.atWarehouse, `took ${obs.tookBarrow} at warehouse ${obs.atWarehouse}`);
  check('7. …loads wood — far more than an armful (a barrow holds 80, a pair of arms 20)', obs.loaded > 20 && obs.maxHand <= 20, `loaded ${obs.loaded}, by hand at most ${obs.maxHand}`);
  check('8. …pushes it over to the site (moving, getting closer)', obs.transported);
  check('9–10. …reaches the site and unloads (a barrow-load at a time)', obs.unloads >= 2 && obs.unloadJump > 20, `${obs.unloads} unloads, biggest ${obs.unloadJump}`);
  check('11–12. The builders use what is delivered: the work goes on', obs.laborAfterUnload);
  check('13. …and back for more (collect → load → transport → unload → return)', obs.returned && ['load', 'transport', 'unload', 'return'].every((p) => obs.phases.has(p)), [...obs.phases].join(' '));
  check('14. Several work at the same time, never two on the same spot', obs.together > 10 && !obs.clash, `${obs.together} samples with 2+ busy`);
  check('15. The house goes up stage by stage (you can see it)', obs.stages.size >= 3, [...obs.stages].join(','));
  check('No wood made out of nothing (store + site + carried = what there was)', obs.conserved && !obs.over);
  check('No equipment duplicated or lost', E.list().length === count0 && E.list().filter((e) => e.type === 'wheelbarrow').length === 1);
  const built = sim.world.buildings[site.id] || Object.values(sim.world.buildings).find((bb) => bb.constructionId === site.id);
  check('16. The house is finished — it stands in the world', site.status === 'done' && !!built, `${site.status}`);
  check('17. The contract is complete', job.status === 'completed' && !K.isActive(job.id), job.status);
  check('18. You are paid — once', job.awarded?.pay > 0 && K.history().filter((h) => h.id === job.id).length === 1 && sim.state.player.money > money0, JSON.stringify(job.awarded));
  check('19. You get experience — once', job.awarded?.xp > 0 && sim.state.player.xp !== xp0);
  check('20. All three workers get their share of the experience (the carrier too)', [a, b, c].every((w) => job.awarded?.workers?.[w.id]?.xp > 0), Object.keys(job.awarded?.workers || {}).join(','));
  check('The barrow\'s wear is part of what the job cost you', (job.costs?.equipment || 0) > 0 && barrow.condition < 100, `${JSON.stringify(job.costs)} · ${barrow.condition}%`);
  // 21. Back to their usual work.
  run(120);
  const back = [a, b, c].every((w) => W.contract(w.id)?.job === undefined && W.contract(w.id)?.task?.contract === undefined);
  check('21. Your workers go back to their usual work', back, [a, b, c].map((w) => `${W.contract(w.id)?.state}:${W.contract(w.id)?.task?.kind || '-'}`).join(' '));
  check('22. The wheelbarrow stays with its worker until you take it back', E.assignedTo(a.id) === barrow);

  // Taking it back: they take it to your yard and leave it there.
  toHour(sim, 10);
  const r = E.retrieve(barrow.id);
  for (let i = 0; i < 18 && barrow.holder; i++) run(10);
  check('Taken back: they finish what they hold, bring it to the yard and leave it there', r.ok && !barrow.holder && barrow.at.kind === 'ground' && !E.using(a), `${JSON.stringify(r)} ${JSON.stringify(barrow.at)} holder ${JSON.stringify(barrow.holder)}`);
  check('…and without it they carry an armful again', W.carryCap(a) === 20);

  // Save / load in the middle of it all.
  if (saved) {
    const sim2 = new Simulation(JSON.parse(saved));
    const E2 = sim2.equipment;
    const b2 = E2.list().find((e) => e.type === 'wheelbarrow');
    check('Save / load mid-work: the barrow, who has it, its condition — as they were', E2.list().length === count0 && b2?.holder?.id === a.id && b2.at.kind === 'npc' && sim2.npcs.byId(a.id).eq === b2.id && W.carryCap(sim2.npcs.byId(a.id)) >= 20);
    const job2 = sim2.contracts.S.active.find((x) => x.id === job.id);
    let crashed = null;
    try {
      const r2 = runOn(sim2);
      for (let i = 0; i < 40 && sim2.contracts.isActive(job.id); i++) r2(30);
    } catch (e) {
      crashed = e;
    }
    check('…and the work goes on from there', !crashed && !!job2 && (job2.status === 'completed' || (sim2.construction.byId(job2.siteId)?.labor || 0) > 0), crashed?.stack?.split('\n').slice(0, 3).join(' | ') || job2?.status);
  } else check('Save / load mid-work', false, 'no save taken');
}

// ================================================================== a site waiting for materials
{
  const sim = setup(6002);
  const tr = transportTools({ sim });
  const C = sim.construction;
  const W = sim.workers;
  tr.build('storage_shed');
  sim.home.storage.length = 0;
  sim.home.store('wood', 60, { force: true });
  sim.home.store('planks', 30, { force: true });
  W.state.buy = false;
  // A shed site of yours that needs stone you don't have.
  const id = tr.build('barn'); // (somewhere to build next to)
  const land = sim.land.owned;
  let site = null;
  for (const pid of land) {
    for (const [x, y] of sim.territory.tiles(pid)) {
      if (C.canPlace('well', x, y).ok) {
        site = C.place('well', x, y);
        break;
      }
    }
    if (site) break;
  }
  const [w] = hire(sim, 1);
  W.assign(w.id, { type: 'build', siteId: site.id });
  let waited = false;
  let resumed = false;
  sim.bus.on('construction:resumed', () => (resumed = true));
  const run = runOn(sim);
  toHour(sim, 8);
  for (let i = 0; i < 36; i++) {
    run(10);
    if (C.siteState(site) === 'waiting_materials') waited = true;
  }
  check('Out of materials: the site is WAITING_FOR_MATERIALS — the work doesn\'t go on without them', !!id && waited && site.status === 'site' && (site.delivered.stone || 0) < site.required.stone, `${JSON.stringify(site.delivered)} ${C.siteState(site)} labor ${Math.round(site.labor)}/${Math.round(C.maxLabor(site))}`);
  check('…and the worker isn\'t stuck: waiting, or at something else', ['waiting', 'need_materials', 'working', 'moving', 'seeking'].includes(W.contract(w.id).state), W.contract(w.id).state);
  sim.home.store('stone', 20, { force: true });
  for (let d = 0; d < 3 && site.status === 'site'; d++) {
    for (let i = 0; i < 60 && site.status === 'site'; i++) run(10);
    if (site.status === 'site') toHour(sim, 8);
  }
  check('Materials arrive: WAITING → ACTIVE, and it\'s finished', resumed && site.status === 'done', `${site.status} ${C.siteState(site)}`);
}

// ================================================================== you with a handcart
{
  const sim = setup(6003);
  const tr = transportTools({ sim });
  const E = sim.equipment;
  const C = sim.construction;
  tr.build('warehouse_bld');
  sim.home.storage.length = 0;
  sim.home.store('wood', 150, { force: true });
  sim.home.store('planks', 40, { force: true });
  // A shed to build (placed, not yet supplied).
  let site = null;
  for (const pid of sim.land.owned) {
    for (const [x, y] of sim.territory.tiles(pid)) if (!site && C.canPlace('storage_shed', x, y).ok) site = C.place('storage_shed', x, y);
  }
  const p = sim.state.player;
  const whB = sim.world.buildings[sim.workers.baseBuilding().id];
  const at = (tx, ty) => {
    p.x = tx * 32 + 16;
    p.y = ty * 32 + 16;
  };
  at(whB.door.tx, whB.door.ty + 1);
  const cart = E.create('handcart', { at: { kind: 'ground', tx: whB.door.tx + 1, ty: whB.door.ty + 1 } });
  const took = E.take(cart.id);
  check('You take a handcart (it was standing by the warehouse)', took.ok && E.playerHeld() === cart && E.status(cart) === 'in_use', JSON.stringify(took));
  const n = E.loadFromStorage();
  check('…load it at your warehouse with what your site needs (far more than you could carry)', n >= site.required.wood && E.load(cart) === n && n > 20, `${n} loaded`);
  at(site.tx + 1, site.ty + site.h);
  const u = E.unloadAt(site);
  check('…push it over and unload: the site has it, the cart is lighter', u > 0 && site.delivered.wood === site.required.wood && E.load(cart) === n - u, `${u} unloaded, ${JSON.stringify(site.delivered)}`);
  check('…it wore a little', cart.condition < 100 && cart.trips === 1);
  const off = E.moveMult(cart, false);
  const on = E.moveMult(cart, true);
  check('A cart is quick on a road and slow on grass', on > 1 && off < 1, `road ×${on}, grass ×${off}`);
  E.putDown();
  check('Left where you stand (it stays in the world)', cart.at.kind === 'ground' && !E.playerHeld());
  // A worker with a broken barrow leaves it and carries by hand.
  const [w] = hire(sim, 1);
  const bb = E.create('wheelbarrow');
  E.lend(bb.id, w.id);
  bb.condition = 0;
  check('Broken equipment can\'t be used — it holds nothing', E.cap(bb) === 0 && !E.usable(bb) && E.status(bb) === 'broken');
  const rep = E.canRepair(bb.id);
  const r2 = E.retrieve(bb.id);
  sim.home.store('planks', 10, { force: true });
  const rp = E.repair(bb.id);
  check('Repaired (planks and money, a few hours out of use)', r2.ok && rep.ok && rp.ok && E.status(bb) === 'under_repair', JSON.stringify(rp));
  runOn(sim)(rp.hours * 60 + 70);
  check('…and as good as new', bb.condition === 100 && E.status(bb) === 'available', `${bb.condition} ${E.status(bb)}`);
  // Damaged: less, slower.
  bb.condition = 20;
  check('Worn out (damaged): it holds less and goes slower', E.cap(bb) < EQUIPMENT.wheelbarrow.cap && E.moveMult(bb, true) < EQUIPMENT.wheelbarrow.road);
}

// ================================================================== buying, making, journeys, the depot, the sheet, points
{
  const sim = setup(6004);
  const tr = transportTools({ sim });
  const E = sim.equipment;
  const sellers = E.sellers();
  check('Shops sell equipment (a basket at the store, a barrow at the smithy…)', sellers.length > 0, sellers.join(','));
  const shop = sellers[0];
  const type = E.forSale(shop).find((o) => o.ok).type;
  const money0 = sim.state.player.money;
  const bought = E.buy(type, shop);
  check('…bought: paid for, and it\'s yours — a real one in the world', bought.ok && sim.state.player.money === money0 - bought.price && !!E.byId(bought.id), JSON.stringify(bought));
  // Journeys: the handcart you buy for trade is a real cart too (not a second, separate one).
  if (!sim.tech.has('handcart')) sim.tech.T.known.handcart = sim.time.day;
  const before = E.list().length;
  const jb = sim.settlements.buyTransport('handcart');
  check('Buying a handcart for journeys gives you a real handcart (one, not two)', !jb.ok || (E.list().length === before + 1 && E.mine().some((e) => e.type === 'handcart') && sim.settlements.transport().cargo === 45), JSON.stringify(jb));
  // The depot.
  const dep = tr.build('transport_depot');
  const y = dep && E.atYard(dep);
  check('A transport depot: parking for your carts (and they\'re kept there)', !!dep && y.parking >= 6 && E.depots().includes(dep), `${dep} parking ${y?.parking}`);
  const nb = E.create('wheelbarrow');
  check('…new equipment is parked at the depot', E.atYard(dep).here.includes(nb), JSON.stringify(nb.at));
  // The building sheet.
  const sh = sim.structures.sheet(dep);
  const need = ['id', 'type', 'owner', 'level', 'quality', 'condition', 'constructionState', 'upgradeState', 'capacity', 'workers', 'equipment', 'storage', 'production', 'consumption', 'maintenance', 'operatingCost', 'location', 'land', 'roads', 'infrastructure', 'upgrade', 'visual'];
  check('Every building has its sheet (id, owner, level, quality, condition, capacity, equipment, costs, roads…)', !!sh && need.every((k) => k in sh) && sh.equipment.here.includes(nb.id), need.filter((k) => !(k in (sh || {}))).join(','));
  // Interaction points: named, and never two workers on one.
  const pts = sim.points.of(dep);
  const roles = new Set(pts.map((p) => p.role));
  check('Buildings have interaction points (door, loading, parking, work)', ['door', 'load', 'park', 'work'].every((r) => roles.has(r)), [...roles].join(','));
  const ws = hire(sim, 2);
  const W = sim.workers;
  const s1 = sim.points.standAt(dep, ws[0].id);
  W.contract(ws[0].id).task = { key: 'x', kind: 'haul', spot: { tx: s1.tx, ty: s1.ty } };
  const s2 = sim.points.standAt(dep, ws[1].id);
  check('…a point taken by one worker isn\'t given to another', s1 && s2 && `${s1.tx},${s1.ty}` !== `${s2.tx},${s2.ty}`, `${s1?.tx},${s1?.ty} vs ${s2?.tx},${s2?.ty}`);
  W.contract(ws[0].id).task = null;
  // Condition bands, buildings and equipment alike.
  sim.property.rec(dep).condition = 30;
  check('Condition in words: new · good · worn · damaged · critical · abandoned', sim.structures.sheet(dep).conditionBand === 'damaged');
  // A construction office: one more job at a time.
  const m0 = sim.contracts.maxActive();
  tr.build('construction_office');
  check('A construction office: one more contract at a time', sim.contracts.maxActive() === m0 + 1, `${m0} → ${sim.contracts.maxActive()}`);
  // Made at your workbench.
  const made = E.made('crate', 2);
  check('Made at the workbench: a real crate, standing by you (a fine one: better made)', made.type === 'crate' && made.at.kind === 'ground' && made.level === 2);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll transport checks passed');
process.exit(failures ? 1 : 0);
