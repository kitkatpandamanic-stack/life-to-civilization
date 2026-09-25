// Headless test for what land becomes (building spec, Phases 8–9): each plot has a profile (its
// buildings, people, work, trade, resources, roads, a well) and a type that comes out of what's
// really there; buildings shape the land around them (land-use pressure) and new buildings prefer
// spots that suit them; land has a value that moves week by week with what surrounds it; its
// development level comes from real conditions; the land remembers; and it survives save / load.
// Usage: node tools/smoke-landuse.mjs
import { Simulation } from '../src/core/Simulation.js';
import { LAND_VALUE, DEV_LEVELS } from '../src/data/territory.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 4242);
const T = sim.territory;
const G = sim.growth;
T.weekly();

// 1. Profiles and types, from what's there.
const hall = T.profile('lot_hall');
check('a plot has a profile: buildings, people, work, trade, resources, roads, access', hall && Array.isArray(hall.buildings) && 'population' in hall && 'jobs' in hall && 'activity' in hall && hall.resources && 'roads' in hall && hall.infra);
check("the hall's lot is the village's grounds", hall.type === 'government');
check("the store's lot is commercial", T.profile('lot_store').type === 'commercial');
const types = new Set(T.all().map((q) => T.profile(q.id).type));
check('woods, fields, stony ground and empty land are told apart', ['forest', 'undeveloped'].every((k) => types.has(k)) && (types.has('agricultural') || types.has('mining')), [...types].join(' '));

// 2. A type emerges: build homes on empty land and it becomes residential.
const empty = T.all().find((q) => q.kind === 'land' && T.profile(q.id).type === 'undeveloped' && T.owner(q.id) !== 'player' && T.info(q.id).buildable > 40 && T.info(q.id).plazaDist < 40);
check('found some undeveloped land near the village', !!empty, empty?.id);
const house = (tile, type = 'small_house') => {
  const c = G.start('village', type, 'rental', tile);
  if (!c) return null;
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
  return c.id;
};
const spot = { tx: Math.round(empty.cx), ty: Math.round(empty.cy) };
const built = [house(spot), house(spot), house(spot)].filter(Boolean);
const where = new Set(built.map((id) => T.idAt(sim.world.buildings[id].door.tx, sim.world.buildings[id].door.ty - 1)));
T.weekly();
const nowRes = [...where].map((id) => T.profile(id)?.type);
check('houses built on it: it becomes residential', nowRes.includes('residential'), `${[...where].join(',')} → ${nowRes.join(',')}`);
const moved = [...where].find((id) => T.rec(id)?.events?.some((e) => e.k === 'type'));
check('…and the land remembers the change', !!moved || [...where].some((id) => T.rec(id)?.type === 'residential'));

// 3. Land-use pressure: work with no homes near calls for housing; workshops want distance from houses.
const smithy = sim.world.buildings.smithy || sim.world.buildingList.find((b) => G.kindOf(b) === 'industry');
const byWork = T.pressure(smithy.door.tx, smithy.door.ty);
check('buildings shape the land around them (pressure is measured)', typeof byWork.housing === 'number' && typeof byWork.homesClose === 'number');
const homeSpot = sim.world.buildings.house_1.door;
check('a workshop suits a spot away from houses better than one among them', T.suitability('industry', 100, 20) > T.suitability('industry', homeSpot.tx, homeSpot.ty), `${T.suitability('industry', 100, 20).toFixed(2)} vs ${T.suitability('industry', homeSpot.tx, homeSpot.ty).toFixed(2)}`);
check('a shop suits a spot among homes with none nearby better than the wilds', T.suitability('shop', spot.tx, spot.ty) > T.suitability('shop', 105, 12), `${T.suitability('shop', spot.tx, spot.ty).toFixed(2)} vs ${T.suitability('shop', 105, 12).toFixed(2)}`);
check("village buildings know what they'll be", G.kindOfType({ visual: 'small_house' }) === 'home' && G.kindOfType({ visual: 'school' }) === 'school');

// 4. Land value: made of real things, moving a step at a time.
const v = T.valueTarget('village_south');
check('land value has reasons (road, people, work, shops, demand…)', ['road', 'jobs', 'population', 'services', 'demand', 'environment', 'development'].every((k) => k in v.parts), JSON.stringify(v.parts));
check('it has a worth that moves (recorded week by week)', T.rec('village_south').lv > 0 && T.rec('village_south').lvh.length >= 2);
const before = T.rec('village_south').lv;
const price0 = T.price('village_south');
// The village grows up around it: people, houses and a shop.
const vs = T.parcel('village_south');
for (let i = 0; i < 4; i++) house({ tx: Math.round(vs.cx) + 12, ty: Math.round(vs.cy) });
for (let i = 0; i < 6; i++) G.arrive();
T.rev++;
const target = T.valueTarget('village_south').mult;
T.weekly();
const after = T.rec('village_south').lv;
check('the village grows up around a plot: its worth rises', target > before && after > before, `${before} → ${after} (target ${target.toFixed(3)})`);
check('…a step at a time', after - before <= LAND_VALUE.maxStep + 1e-9);
check('…and its price follows', T.price('village_south') > price0, `${price0} → ${T.price('village_south')}`);
check('land values reach building prices (the land under a house)', sim.realty.priceParts('house_1').parts.some((p) => p.k === 'land' && p.v > 0));

// 5. Development: from real conditions, not a number to push.
const d0 = T.development(empty.id, null);
check('development has its reasons', ['buildings', 'population', 'jobs', 'roads', 'infrastructure', 'services', 'activity'].every((k) => k in d0.parts));
const wild = T.all().find((q) => q.kind === 'land' && !T.buildingsOn(q.id).length && T.profile(q.id).type === 'forest');
check('untouched woods are undeveloped', T.development(wild.id).level === 'undeveloped');
check('the centre of the village is developed', DEV_LEVELS.indexOf(T.development('lot_hall').level) >= 1, T.development('lot_hall').level);
// Holding on: one quiet week doesn't knock a place back a level.
const r = T.rec('lot_hall');
r.dev = 'highly_developed';
const held = T.development('lot_hall', 'highly_developed');
check("a place doesn't lose its standing over one quiet week", held.score >= 3 * 0.8 ? held.level === 'highly_developed' : held.level !== 'highly_developed');

// 6. Save and load: worth, its record, development, the land's story.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const T2 = sim2.territory;
check('after loading: land worth and its record', T2.rec('village_south').lv === T.rec('village_south').lv && T2.rec('village_south').lvh.length === T.rec('village_south').lvh.length);
check('after loading: the same price', T2.price('village_south') === T.price('village_south'));
check('after loading: development and history', T2.rec('lot_hall').dev === T.rec('lot_hall').dev && JSON.stringify(T2.rec(moved || 'lot_hall')?.events || []) === JSON.stringify(T.rec(moved || 'lot_hall')?.events || []));

// 7. A few weeks of it.
let crashed = null;
try {
  const end = sim.time.total + 21 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll land-use checks passed');
process.exit(failures ? 1 : 0);
