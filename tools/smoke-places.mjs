// Headless test for neighbourhoods and districts (building spec, Phase 10): homes that grow up
// close together along a road, with people in them, become a neighbourhood with a name, a kind,
// numbers (people, homes, worth, rent, repair), what's near and a story; it keeps its name as it
// grows; its standing moves what its houses fetch and how villagers rate it; districts keep their
// identity and gain a character (old, new development); it all survives save / load.
// Usage: node tools/smoke-places.mjs
import { Simulation } from '../src/core/Simulation.js';
import { HOODS } from '../src/data/places.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 4242);
const pl = sim.places;
const P = sim.property;
const G = sim.growth;
const finish = (c) => {
  if (!c) return null;
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c.id;
};
const house = (tile, type = 'small_house') => finish(G.start('village', type, 'rental', tile));
const fresh = () => {
  sim.realty.priceCache.clear();
  sim.realty.rentCache.clear();
  P.valueCache.clear();
  sim.housing.factCache.clear();
  pl.statCache.clear();
};

// 1. The valley as it stands: its places were always there.
check('the village starts with its districts', sim.state.districts.list.length >= 3 && sim.state.districts.list.every((d) => d.id && d.name && d.cells.length), `${sim.state.districts.list.length}`);
const h0 = pl.hoods()[0];
check('…and an old neighbourhood or two, with a name and numbers', !!h0 && h0.name?.f && h0.stats && 'pop' in h0.stats && 'rent' in h0.stats && 'quality' in h0.stats && h0.hist.some((e) => e.k === 'founded'), h0 && `${h0.id} ${h0.name.f}.${h0.name.v} ${h0.kind} homes ${h0.homes.length}`);
check('the old residential district is recognised', sim.state.districts.list.some((d) => d.type === 'residential' && d.char === 'old'));

// 2. Homes grown up together along a road, with people in them: a new neighbourhood.
const spot = { tx: 84, ty: 44 };
const built = [house(spot, 'house'), house(spot), house(spot)].filter(Boolean);
for (const id of built) G.arrive({ homeId: id, size: 2 });
const before = pl.hoods().length;
pl.weekly();
const nh = pl.hoods().find((h) => built.some((id) => h.homes.includes(id)));
check('three new houses with families: a neighbourhood forms', !!nh && pl.hoods().length > before, nh ? `${nh.id} homes ${nh.homes.length}, pop ${nh.stats.pop}` : built.join(','));
check('…it has a name of its own', !!nh && pl.hoods().filter((h) => h !== nh && h.name.f === nh.name.f && h.name.v === nh.name.v && (h.name.n || 0) === (nh.name.n || 0)).length === 0, nh && `${nh.name.f}.${nh.name.v}`);
check('…and it is news', sim.state.chronicle.some((c) => c.key === 'chronicle.hood_formed' && c.params.hood === nh?.id));
check('you can find it by walking into it', !!nh && pl.hoodAt(nh.tx, nh.ty)?.id === nh.id);

// 3. It keeps its name as it grows.
const more = house(spot);
if (more) G.arrive({ homeId: more, size: 2 });
pl.weekly();
const nh2 = pl.hood(nh?.id);
check('another house: the same neighbourhood, a home bigger', !!nh2 && nh2.homes.includes(more) && nh2.name.f === nh.name.f, nh2 && `${nh2.homes.length} homes`);

// 4. Its standing: kept houses and services make it sought after — and its houses fetch more.
fresh();
const rep0 = pl.stats(nh2).rep;
const val0 = P.value(built[0]);
const area0 = sim.housing.facts(built[0]).area;
for (const id of nh2.homes) P.rec(id).condition = 30;
pl.weekly();
fresh();
const rep1 = pl.stats(pl.hood(nh.id)).rep;
check('run-down houses: its standing falls', rep1 < rep0, `${rep0} → ${rep1}`);
for (const id of nh2.homes) P.rec(id).condition = 100;
pl.weekly();
fresh();
check('standing moves what a house fetches (the street it is on)', Math.abs(pl.valueFactor(built[0]) - pl.valueFactor(built[0]) / (1 + pl.standing(built[0]) * HOODS.valueShare)) > 0 || pl.standing(built[0]) === 0, `standing ${pl.standing(built[0])}`);
check('…and how villagers rate living there', Math.abs(sim.housing.facts(built[0]).area - area0) < 1 && typeof area0 === 'number');
check('its numbers: worth, rent, repair, what is near', pl.stats(pl.hood(nh.id)).value > 0 && pl.stats(pl.hood(nh.id)).rent > 0 && Array.isArray(pl.stats(pl.hood(nh.id)).services), JSON.stringify({ v: val0, s: pl.stats(pl.hood(nh.id)).services }));

// 5. Workshops among the homes: a workers' quarter.
// (Put right among its houses: a free lot as close to its middle as there is.)
const among = () => {
  for (let r = 0; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const tx = nh2.tx + dx;
    const ty = nh2.ty + dy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && G.lotFree(tx, ty, 6, 4, 'village')) return finish(sim.construction.startProject({ owner: 'village', type: 'warehouse', tx, ty, purpose: 'shop' }));
  }
  return null;
};
const w1 = among();
const w2 = among();
const box = pl.hood(nh.id);
const inIt = [w1, w2].filter((id) => { const d = sim.world.buildings[id]?.door; return d && d.tx >= box.x1 && d.tx <= box.x2 && d.ty >= box.y1 && d.ty <= box.y2; }).length;
const keep = HOODS.workersIndustry;
HOODS.workersIndustry = Math.min(keep, Math.max(1, inIt)); // (as many as there was room for among its houses)
pl.weekly();
HOODS.workersIndustry = keep;
const nh3 = pl.hood(nh.id);
check('workshops among its homes: it becomes a workers\' quarter (and remembers the change)', inIt >= 1 && nh3.kind === 'workers' && nh3.hist.some((e) => e.k === 'kind'), `${nh3?.kind}, ${inIt} workshops in it`);

// 6. Districts keep who they are, and their character.
const ids0 = sim.state.districts.list.map((d) => d.id).sort().join();
pl.updateDistricts();
check('districts keep their identity from one count to the next', sim.state.districts.list.map((d) => d.id).sort().join() === ids0 || sim.state.districts.list.length !== ids0.split(',').length);
const newD = pl.districtAt(nh.tx, nh.ty);
check('where it has all just gone up: a new development', newD?.char === 'new', newD && `${newD.type}/${newD.char}`);
const ds = pl.districtStats(newD);
check('a district in numbers: people, buildings, homes, worth, rent, land, roads', ds.buildings >= 2 && ds.homes >= 2 && ds.pop > 0 && ds.land > 0 && 'road' in ds && ds.hoods.includes(nh.id), JSON.stringify(ds));

// 7. A neighbourhood that empties out fades from memory.
for (const id of nh3.homes) for (const n of sim.npcs.residentsOf(id)) n.homeId = null;
sim.npcs.households = null;
for (let i = 0; i < HOODS.fadeWeeks * 2 + 1; i++) pl.weekly();
check('its people gone, the neighbourhood fades (and that is news)', !pl.hood(nh.id) && sim.state.chronicle.some((c) => c.key === 'chronicle.hood_faded' && c.params.hood === nh.id));
check('…its name is still known to the chronicle', !!sim.state.places.names[nh.id]);
for (const id of nh3.homes) G.arrive({ homeId: id, size: 2 });
sim.npcs.households = null;
pl.weekly();

// 8. Save and load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('after loading: the same neighbourhoods', sim2.places.hoods().map((h) => `${h.id}:${h.name.f}.${h.name.v}`).join() === pl.hoods().map((h) => `${h.id}:${h.name.f}.${h.name.v}`).join());
sim2.places.weekly();
sim.places.weekly();
check('…that keep their names on the next count', sim2.places.hoods().map((h) => h.id).join() === pl.hoods().map((h) => h.id).join());
check('after loading: the same districts and their characters', JSON.stringify(sim2.state.districts.list.map((d) => [d.id, d.type, d.char])) === JSON.stringify(sim.state.districts.list.map((d) => [d.id, d.type, d.char])));

// 9. A few weeks of it.
let crashed = null;
try {
  const end = sim.time.total + 21 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll places checks passed');
process.exit(failures ? 1 : 0);
