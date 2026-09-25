// Save / load validation for the building, housing and territory systems (building spec, Phase 15):
// after a busy stretch — land bought, joined and split, buildings built, converted, joined and pulled
// down, flats let, streets paved, a bridge and a lamp, neighbourhoods and districts, villagers developing —
// everything important comes back exactly as it was (the world, the land, owners, tenants, rents,
// values, levels, condition, quality, rooms, neighbourhoods, districts, infrastructure, work in progress,
// history), the game goes on the same way, and a save from before all this still loads.
// Usage: node tools/smoke-saveload.mjs
import { Simulation } from '../src/core/Simulation.js';
import { T } from '../src/world/WorldGenerator.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const days = (s, n) => {
  const end = s.time.total + n * 1440;
  while (s.time.total < end) s.update(2000);
};
const finish = (s, c) => {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  s.construction.tryComplete(c);
};
const hash = (arr) => {
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) h = Math.imul(h ^ arr[i], 16777619);
  return h >>> 0;
};

// A busy stretch of play.
const sim = Simulation.newGame('T', 4242);
const p = sim.state.player;
p.level = 20;
p.money = 50000;
p.skills.construction.level = 9;
const G = sim.growth;
const S = sim.structures;
const P = sim.property;
const T2 = sim.territory;
days(sim, 10);
const house = (tile, type = 'small_house', owner = 'village') => {
  const c = G.start(owner, type, 'rental', tile);
  finish(sim, c);
  return c.id;
};
// Buildings: yours, converted, joined, pulled down; a block of flats with tenants.
const a = house({ tx: 84, ty: 44 });
P.transfer(a, 'player', 'bought');
S.start(a, { type: 'convert', to: 'workshop' }, 'player');
for (const [i, n] of Object.entries(S.works(a)?.required || {})) sim.inventory.add(i, n, { force: true });
finish(sim, S.works(a));
const d = house({ tx: 84, ty: 30 });
P.transfer(d, 'player', 'bought');
finish(sim, S.start(d, { type: 'demolish' }, 'player').site);
sim.state.village.treasury += 3000;
const block = house({ tx: 30, ty: 30 }, 'apartment_house');
for (let i = 0; i < 2; i++) G.arrive({ homeId: block, size: 2 });
const up = house({ tx: 70, ty: 60 }, 'house');
S.start(up, { type: 'module', m: 'bedroom' }, 'village');
// (and one still being worked on)
const building = G.start('village', 'small_house', 'rental', { tx: 60, ty: 25 });
if (building) building.labor = Math.round(building.laborNeeded / 2);
// Land: bought, joined, split; infrastructure: cobbles, a bridge, a lamp.
const land = T2.all().find((q) => q.kind === 'land' && q.n >= 60 && !T2.buildingsOn(q.id).length && T2.owner(q.id) !== 'player');
T2.transfer(land.id, 'player', 'bought');
const half = T2.split(land.id);
T2.join(land.id, half.id);
let road = null;
for (let y = 0; y < sim.world.H && !road; y++) for (let x = 0; x < sim.world.W && !road; x++) if (sim.world.tileAt(x, y) === T.ROAD) road = { tx: x, ty: y };
sim.infra.pave(road.tx, road.ty, 'village');
let wet = null;
for (let y = 0; y < sim.world.H && !wet; y++) for (let x = 0; x < sim.world.W && !wet; x++) if (sim.world.tileAt(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => sim.world.isRoad(x + dx, y + dy))) wet = { tx: x, ty: y };
sim.infra.bridge(wet.tx, wet.ty, 'village');
const ls = sim.infra.lampSpot(sim.world.buildings[block].door.tx, sim.world.buildings[block].door.ty);
if (ls) sim.infra.lamp(ls.tx, ls.ty, 'village');
days(sim, 20);
sim.places.weekly();
sim.places.updateDistricts();
T2.weekly();

// Everything important, as it stands.
const snap = (s) => ({
  buildings: s.world.buildingList.map((b) => `${b.id}:${b.type}:${b.tx},${b.ty},${b.w}x${b.h}`).join('|'),
  tiles: hash(s.world.tiles),
  blocked: hash(s.world.staticBlocked),
  lamps: s.world.decor.filter((x) => x.light).map((x) => `${x.tx},${x.ty}`).join('|'),
  parcels: hash(s.world.parcels.map),
  plots: JSON.stringify(s.state.territory.plots),
  property: JSON.stringify(s.property.all),
  structures: JSON.stringify(s.state.structures),
  construction: JSON.stringify(s.construction.list.map((c) => [c.id, c.kind, c.status, Math.round(c.labor)])),
  hoods: JSON.stringify(s.state.places.hoods.map((h) => [h.id, h.name, h.kind, h.homes])),
  districts: JSON.stringify(s.state.districts.list.map((x) => [x.id, x.type, x.char, x.cells])),
  infra: JSON.stringify({ paved: s.state.infra.paved, bridges: s.state.infra.bridges, lamps: s.state.infra.lamps, fund: s.state.infra.fund }),
  people: JSON.stringify(s.state.npcs.map((n) => [n.id, n.homeId, n.flat ?? null, n.landPlan || null])),
  values: JSON.stringify(s.property.homes().map((id) => [id, s.property.value(id), s.property.weeklyRent(id)])),
});
const before = snap(sim);
const saved = JSON.stringify(sim.state);
const sim2 = new Simulation(JSON.parse(saved));
const after = snap(sim2);
for (const k of Object.keys(before)) check(`after loading: ${k} as they were`, before[k] === after[k], before[k] === after[k] ? '' : `${String(before[k]).slice(0, 90)} ≠ ${String(after[k]).slice(0, 90)}`);

// …and the game goes on the same way.
days(sim, 7);
days(sim2, 7);
const s1 = snap(sim);
const s2 = snap(sim2);
// (Who owns which land, what it's used for and how built-up it is — not its price to the coin, which follows
// the week's trade, and the two games don't roll the same dice: the random numbers are shared between them.)
const shape = (s) => JSON.stringify(Object.entries(s.state.territory.plots).map(([id, r]) => [id, r.owner, r.type, r.dev]));
s1.plots = shape(sim);
s2.plots = shape(sim2);
const same = ['buildings', 'tiles', 'parcels', 'plots', 'hoods', 'districts', 'infra'].filter((k) => s1[k] === s2[k]);
check('a week on, the saved game and the one that went on without saving agree', same.length === 7, `the same: ${same.join(', ')}`);

// A save from before neighbourhoods, infrastructure, NPC development and flats still loads.
const old = JSON.parse(saved);
delete old.places;
delete old.infra;
delete old.development;
delete old.districts.next;
for (const x of old.districts.list) {
  x.id = x.cells[0];
  delete x.char;
  delete x.hist;
  delete x.founded;
}
for (const r of Object.values(old.property)) delete r.flats;
for (const n of old.npcs) {
  delete n.flat;
  delete n.landPlan;
}
for (const r of Object.values(old.territory.plots)) {
  delete r.touched;
}
let crashed = null;
let sim3 = null;
try {
  sim3 = new Simulation(old);
  days(sim3, 14);
} catch (e) {
  crashed = e;
}
check('an older save loads and plays on', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('…and gets its neighbourhoods, districts and public works', !!sim3?.state.places && sim3.state.districts.list.every((x) => x.name) && !!sim3?.state.infra);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll save / load checks passed');
process.exit(failures ? 1 : 0);
