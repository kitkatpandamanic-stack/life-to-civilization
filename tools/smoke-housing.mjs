// Headless test for villagers' housing decisions (building spec, Phase 6): each household weighs
// a home by the rent against their means, room, the walk to work and school, the house, the street,
// safety, the road and family nearby — each by how much they care; they don't all take the cheapest;
// now and then they look around and move when somewhere is clearly better, and remember why; owners
// need a much better reason; and it's the same after loading.
// Usage: node tools/smoke-housing.mjs
import { Simulation } from '../src/core/Simulation.js';
import { HOUSING_CHOICE as HC } from '../src/data/housing.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 4242);
const H = sim.housing;
const P = sim.property;
const dist = (a, b) => Math.abs(a.door.tx - b.door.tx) + Math.abs(a.door.ty - b.door.ty);
/** A new house near a spot, built by the village and standing empty, at this rent. */
function houseNear(tile, rent) {
  const c = sim.growth.start('village', 'small_house', 'rental', tile);
  if (!c) return null;
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  P.rec(c.id).ask = rent;
  return c.id;
}

// 1. Everyone weighs things differently.
const heads = sim.state.npcs.filter((n) => H.isHead(n));
check('households have heads who decide', heads.length >= 6, String(heads.length));
const wa = H.prefs(heads[0]);
const wb = H.prefs(heads[1]);
check('two villagers care about different things', JSON.stringify(wa) !== JSON.stringify(wb));
const someone = heads.find((n) => !n.traits.includes('careful'));
const before = H.prefs(someone).afford;
someone.traits.push('careful');
check('a careful villager minds the rent more', H.prefs(someone).afford > before);
someone.traits.pop();
const parent = heads.find((n) => sim.family.children(n).some((k) => k.age >= 6 && k.age < 16 && k.homeId === n.homeId));
check('parents of schoolchildren care about the walk to school', !parent || H.prefs(parent).school > 0);
const single = heads.find((n) => !H.household(n).some((m) => m.age >= 6 && m.age < 17));
check('…others don\'t', !single || H.prefs(single).school === 0);

// 2. The walk to work counts: a house by their workplace beats one across the valley (all else near enough equal).
// (The tenant with the longest walk to work — one who doesn't mind living away from the centre.)
const worker = heads
  .filter((n) => sim.npcs.workBuilding(n) && P.landlord(n) && H.household(n).length <= 3 && H.prefs(n).centre <= 0.2)
  .sort((a, b) => H.evaluate(a, a.homeId, { current: true }).parts.commute - H.evaluate(b, b.homeId, { current: true }).parts.commute)[0];
check('found a working tenant', !!worker, worker?.id);
const work = sim.npcs.workBuilding(worker);
const near = houseNear(work.door, 6);
const far = houseNear({ tx: work.door.tx > 60 ? 12 : 105, ty: work.door.ty > 45 ? 10 : 80 }, 6);
check('two empty houses: one by their work, one far off', near && far && dist(sim.world.buildings[near], work) < dist(sim.world.buildings[far], work), `${near} ${far}`);
const eN = H.evaluate(worker, near);
const eF = H.evaluate(worker, far);
check('the walk counts against the far one', eN.parts.commute > eF.parts.commute, `${eN.parts.commute.toFixed(2)} vs ${eF.parts.commute.toFixed(2)}`);

// 3. Not everyone takes the cheapest.
P.rec(far).ask = 3;
P.rec(near).ask = 7;
let pricier = 0;
let cheaper = 0;
for (const n of heads.filter((x) => P.landlord(x) && H.household(x).length <= 3)) {
  const opts = P.options(H.household(n).length, 50, 0, n).filter((o) => o.id === near || o.id === far);
  if (!opts.length) continue;
  if (opts[0].id === near) pricier++;
  else cheaper++;
}
check('some choose the dearer house near their work', pricier > 0, `dearer ${pricier} · cheaper ${cheaper}`);
check('…and some the cheaper one', cheaper > 0);

// 4. Thinking it over: a tenant with a long walk moves when a house by their work is free.
P.rec(near).ask = 3; // cheap, and a short walk from work
P.rec(far).ask = 40; // out of reach
const cmp = H.compare(worker, near);
check('the house by work is clearly better for them', cmp.gain >= HC.moveGain, `gain ${cmp.gain.toFixed(2)} (${cmp.why})`);
const home0 = worker.homeId;
const moved = H.weekly({ all: true, only: [worker.id] }); // (just them: another household might otherwise take it first)
const mine = moved.find((m) => m.npc === worker.id);
check('they move', worker.homeId === near && !!mine, `${home0} → ${worker.homeId}`);
check('…the whole household with them', H.household(worker).every((m) => m.homeId === near));
check('…and remember why', worker.memories.some((m) => m.k === 'moved_for' && m.p?.hwhy));
check('…which the chronicle records', sim.state.chronicle.some((e) => e.key === 'chronicle.npc_moved_for' && e.params.npc === worker.id));
check('…a new lease at the rent asked', P.lease(near)?.tenant === worker.id);
const all = H.weekly();
check('not the whole valley moves at once', all.length <= HC.maxMovesPerWeek, String(all.length));

// 5. Owners need a much better reason.
const owner = heads.find((n) => P.rec(n.homeId)?.owner === n.id && !sim.economy.businessAtBuilding(n.homeId) && sim.npcs.workBuilding(n));
if (owner) {
  const spot = houseNear(sim.npcs.workBuilding(owner).door, 3);
  const g = H.compare(owner, spot).gain;
  const was = owner.homeId;
  H.weekly({ all: true });
  check('an owner only moves for a big gain', g >= HC.ownerMoveGain ? owner.homeId !== was : owner.homeId === was, `gain ${g.toFixed(2)}`);
} else check('found an owner-occupier', false);

// 6. How content they are, and what they'd want.
const s = H.satisfaction(worker);
check('contentment is 0–100', s.sat >= 0 && s.sat <= 100, String(s.sat));
const crowd = heads.find((n) => P.occupants(n.homeId) > P.capacity(n.homeId)) || null;
if (crowd) check('a crowded household wants more room', H.satisfaction(crowd).wants.includes('crowded'));
check('attachment grows with the years', (() => {
  const since = worker.homeSince;
  worker.homeSince = sim.time.day;
  const a = H.evaluate(worker, worker.homeId, { current: true }).score;
  worker.homeSince = sim.time.day - 56 * 2;
  const b = H.evaluate(worker, worker.homeId, { current: true }).score;
  worker.homeSince = since;
  return b > a;
})());

// 7. Your houses: a house that suits them better draws them even if they weren't looking.
const yours = houseNear(sim.npcs.workBuilding(heads.find((n) => n !== worker && sim.npcs.workBuilding(n) && P.landlord(n)) || worker).door, 4);
P.transfer(yours, 'player', 'gift');
P.rec(yours).ask = 4;
sim.letting.list(yours, true);
const it = sim.letting.interest(yours);
check('villagers consider a house of yours on its merits', it.yes.length > 0 || it.main, JSON.stringify(it.yes.slice(0, 3).map((x) => [x.n.id, x.r.reason])));

// 8. Save and load: the same people, the same view of things.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const w2 = sim2.npcs.byId(worker.id);
check('after loading: when they moved in', w2.homeSince === worker.homeSince);
check('after loading: the same judgement of their home', Math.abs(sim2.housing.evaluate(w2, w2.homeId, { current: true }).score - H.evaluate(worker, worker.homeId, { current: true }).score) < 1e-9);

// 9. A season of the valley with households choosing for themselves.
let crashed = null;
try {
  const end = sim.time.total + 28 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('four weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll housing checks passed');
process.exit(failures ? 1 : 0);
