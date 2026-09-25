// Headless test for infrastructure (building spec, Phase 11): what reaches a spot (a road, and
// whether it links up to the plaza; cobbles; water; a lamp; a carter); paving, bridges and lamps —
// by you and by the village's public works (a lane to a house cut off from the roads, cobbles on the
// busiest street, a lamp for a dark neighbourhood); how it moves the land's value, a house's price,
// how villagers rate a street and how fast people walk; and that it all survives save / load.
// Usage: node tools/smoke-infra.mjs
import { Simulation } from '../src/core/Simulation.js';
import { T } from '../src/world/WorldGenerator.js';
import { INFRA } from '../src/data/infra.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 4242);
const I = sim.infra;
const w = sim.world;
const p = sim.state.player;
p.level = 20;
p.money = 5000;
const put = (x, y) => {
  const t = w.toTile(0, 0);
  p.x = x * 32 + 16;
  p.y = y * 32 + 16;
  return t;
};
const give = (item, n) => sim.inventory.add(item, n, { force: true });

// 1. What reaches a spot.
const hall = w.buildings.hall.door;
const ch = I.coverage(hall.tx, hall.ty);
check('at the hall: a road that links up, cobbles, water, a lamp', ch.road <= 1 && ch.linked && ch.paved && ch.water && ch.light && ch.score >= 0.8, JSON.stringify(ch));
const far = w.buildings.house_1.door;
const cf = I.coverage(far.tx, far.ty);
check('a house far from the roads: none of it', cf.road === Infinity && !cf.linked && cf.score < ch.score, JSON.stringify(cf));
check('the village in numbers', I.stats().roads > 50 && I.stats().homes > 5, JSON.stringify(I.stats()));

// 2. Paving: you cobble a road tile.
let road = null;
for (let y = 0; y < w.H && !road; y++) for (let x = 0; x < w.W && !road; x++) if (w.tileAt(x, y) === T.ROAD && Math.abs(x - 46) + Math.abs(y - 40) > 14 && Math.abs(x - 46) + Math.abs(y - 40) < 26 && sim.territory.ownerAt(x, y + 1) !== undefined) road = { tx: x, ty: y };
put(road.tx, road.ty);
check('without stone you cannot', !I.canPave(road.tx, road.ty).ok && I.canPave(road.tx, road.ty).reason === 'missing_materials');
give('stone', 20);
const lotBy = sim.territory.idAt(road.tx, road.ty + 1) || sim.territory.idAt(road.tx + 1, road.ty) || sim.territory.idAt(road.tx, road.ty - 1) || sim.territory.idAt(road.tx - 1, road.ty);
const inf0 = sim.territory.valueTarget(lotBy).parts.infrastructure;
const res = I.pave(road.tx, road.ty);
check('with stone and money: cobbles', res.ok && w.tileAt(road.tx, road.ty) === T.PLAZA && w.isRoad(road.tx, road.ty) && I.S.paved.length === 1, JSON.stringify(res));
check('cobbles are quicker to walk on than a dirt road', INFRA.pavedSpeedBonus > 0);
sim.territory.rev++;
const inf1 = sim.territory.valueTarget(lotBy).parts.infrastructure;
check('the land by a paved street is worth more', inf1 > inf0, `${lotBy}: ${inf0} → ${inf1}`);
check('a road tile can be paved only once', I.canPave(road.tx, road.ty).reason === 'already_paved');

// 3. Links: a road that doesn't reach the village, then does.
let spot = null;
for (let y = 10; y < w.H - 10 && !spot; y++) {
  for (let x = 10; x < w.W - 10 && !spot; x++) {
    if (w.isBlocked(x, y) || w.isRoad(x, y) || w.isWater(x, y)) continue;
    if (I.coverage(x, y).road <= 6) continue;
    let ok = true;
    for (let k = 0; k < 3; k++) if (w.isBlocked(x + k, y) || w.isWater(x + k, y) || w.tileAt(x + k, y) === T.FARMLAND) ok = false;
    if (ok) spot = { tx: x, ty: y };
  }
}
for (let k = 0; k < 3; k++) w.setRoad(spot.tx + k, spot.ty);
I.touched();
const cu = I.coverage(spot.tx + 1, spot.ty + 1);
check('a stretch of road on its own: on a road, but it does not link up', cu.road <= 1 && !cu.linked, JSON.stringify(cu));
const lane = I.pathToRoad({ tx: spot.tx, ty: spot.ty }, 80);
for (const t of lane || []) w.setRoad(t.tx, t.ty);
I.touched();
check('…a lane to the road network: now it does', lane && I.coverage(spot.tx + 1, spot.ty + 1).linked, `${lane?.length} tiles`);

// 4. Bridges: over shallow water from a road on the bank.
let wet = null;
for (let y = 0; y < w.H && !wet; y++) for (let x = 0; x < w.W && !wet; x++) if (w.tileAt(x, y) === T.WATER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.isRoad(x + dx, y + dy))) wet = { tx: x, ty: y };
check('found shallow water by a road', !!wet);
put(wet.tx, wet.ty - 1);
give('planks', 20);
give('wood', 10);
check('a bridge goes only over water', I.canBridge(road.tx, road.ty).reason === 'bridge_water_only');
const br = I.bridge(wet.tx, wet.ty);
check('a bridge tile over the water: you can walk across', br.ok && w.tileAt(wet.tx, wet.ty) === T.BRIDGE && !w.isBlocked(wet.tx, wet.ty) && w.isRoad(wet.tx, wet.ty), JSON.stringify(br));

// 5. A street lamp: the street is lit, and feels safer.
// (a new house: the village lays the road to its door when it's finished)
const built = sim.growth.start('village', 'small_house', 'rental', { tx: 86, ty: 46 });
built.delivered = { ...built.required };
built.labor = built.laborNeeded;
sim.construction.tryComplete(built);
const home = w.buildings[built.id];
sim.housing.factCache.clear();
const safe0 = sim.housing.facts(home.id).safety;
const ls = I.lampSpot(home.door.tx, home.door.ty);
put(ls.tx, ls.ty);
give('iron_ingot', 2);
const lr = I.lamp(ls.tx, ls.ty);
sim.housing.factCache.clear();
check('a lamp by the road', lr.ok && w.decor.some((d) => d.light && d.tx === ls.tx && d.ty === ls.ty) && w.isBlocked(ls.tx, ls.ty), JSON.stringify(lr));
check('…lights the street, and people feel safer there', I.coverage(home.door.tx, home.door.ty).light && sim.housing.facts(home.id).safety > safe0, `${safe0} → ${sim.housing.facts(home.id).safety}`);
check('…and not a second one right beside it', I.canLamp(ls.tx + 1, ls.ty).reason === 'lamp_too_close' || I.canLamp(ls.tx + 1, ls.ty).reason === 'obstructed' || I.canLamp(ls.tx + 1, ls.ty).reason === 'lamp_by_road');

// 6. The village's public works.
const tre = sim.state.village.treasury;
sim.infra.levy(100);
check('a share of the taxes goes into the works fund', I.S.fund > 0 || tre <= 0, `fund ${I.S.fund}`);
I.S.fund = 400;
const cut = w.buildingList.find((b) => sim.property.isHome(b.id) && sim.property.occupants(b.id) && sim.growth.roadDistance(b.door.tx, b.door.ty, INFRA.works.laneFrom) > INFRA.works.laneFrom - 1 && I.pathToRoad(b.door, INFRA.works.laneMaxTiles));
const pw = I.publicWorks();
check('a house cut off from the roads: the village lays a lane to it', !cut || (pw?.k === 'lane' && sim.growth.roadDistance(w.buildings[pw.building].door.tx, w.buildings[pw.building].door.ty, 2) <= 1), JSON.stringify(pw));
// A busy street, and the village big enough (or knowing masonry): cobbles.
sim.civic.V.status = 'large_village'; // (a large village paves its streets)
let busy = null;
for (let y = 0; y < w.H && !busy; y++) for (let x = 0; x < w.W && !busy; x++) if (w.tileAt(x, y) === T.ROAD && w.tileAt(x + 1, y) === T.ROAD && w.tileAt(x + 2, y) === T.ROAD) busy = { tx: x, ty: y };
I.S.fund = 1000;
const paved0 = I.S.paved.length;
let pv = null;
for (let i = 0; i < 20 && pv?.k !== 'pave'; i++) {
  I.S.fund = 1000;
  for (let k = 0; k < 3; k++) I.S.traffic[`${busy.tx + k},${busy.ty}`] = 99;
  pv = I.publicWorks();
}
check('the busiest street: the village cobbles it', pv?.k === 'pave' && I.S.paved.length > paved0 && w.tileAt(busy.tx, busy.ty) === T.PLAZA, JSON.stringify(pv));
check('…and it is news', sim.state.chronicle.some((c) => c.key === 'chronicle.village_paved'));

// 7. Traffic is counted as people walk.
const end = sim.time.total + 2 * 1440;
while (sim.time.total < end) sim.update(2000);
check("villagers' steps on the roads are counted", Object.keys(I.S.traffic).length > 0);

// 8. Save and load: cobbles, bridges, lamps and the fund are put back into the world.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const w2 = sim2.world;
check('after loading: the cobbles', w2.tileAt(road.tx, road.ty) === T.PLAZA && w2.tileAt(busy.tx, busy.ty) === T.PLAZA);
check('after loading: the bridge (walkable)', w2.tileAt(wet.tx, wet.ty) === T.BRIDGE && !w2.isBlocked(wet.tx, wet.ty));
check('after loading: the lamp', w2.decor.some((d) => d.light && d.tx === ls.tx && d.ty === ls.ty) && w2.isBlocked(ls.tx, ls.ty));
check('after loading: the fund and what reaches a spot', sim2.infra.S.fund === I.S.fund && JSON.stringify(sim2.infra.coverage(hall.tx, hall.ty)) === JSON.stringify(I.coverage(hall.tx, hall.ty)));

// 9. A few weeks of it.
let crashed = null;
try {
  const e2 = sim.time.total + 21 * 1440;
  while (sim.time.total < e2) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll infrastructure checks passed');
process.exit(failures ? 1 : 0);
