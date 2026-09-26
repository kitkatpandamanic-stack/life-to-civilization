// Headless test for river trade (FreightSystem caravans by boat, EquipmentSystem boats, the dock):
//   the dock  — must touch the water; boats (bought at a carpentry, with the know-how of boats) are moored there
//   boats     — stay at the dock: not lent to workers, not pushed about on land
//   the trip  — only to the towns on the water; quicker than a cart; down the river and back (drawn on it)
//   the river — no sailing in a flood; a dry summer's low water halves a barge's load; pirates (a guard helps)
//   and       — the dock helps the village's trade; boats saved; old saves load
// Usage: node tools/smoke-river.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';
import { RIVER, CARAVAN } from '../src/data/freight.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 6421);
const F = sim.freight;
const E = sim.equipment;
const p = sim.state.player;
p.money = 8000;
const tr = transportTools({ sim });
const hire = () => {
  const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look: sim.state.npcs[0].look, money: 20 });
  w.met = true;
  sim.workers.hire(w, 16);
  return w;
};

// A dock has to touch the water (your land by the river).
sim.state.tech.known.boats = 0;
p.skills.construction.level = 4;
sim.progression.addXp(20000);
sim.land.buy('riverside', { anywhere: true });
const dry = (() => {
  for (const q of sim.land.owned || []) for (const [x, y] of sim.territory.tiles(q.id || q)) {
    const r = sim.construction.canPlace('dock', x, y);
    if (r.reason === 'need_waterside') return r;
  }
  return null;
})();
check("A dock away from the water isn't allowed", !!dry);
const dockId = tr.build('dock');
check('A dock on the riverbank', !!dockId && F.docks().includes(dockId), dockId);
const m = F.mooring(dockId);
check('…with a mooring on the water', sim.world.isWater(m.tx, m.ty), JSON.stringify(m));
const path = F.riverPath(dockId);
check('…and a way down the river out of the valley', path && path.length > 3, `${path?.length} tiles`);
check("The dock helps the village's trade (goods fetch more away)", sim.tech.mod('export_price') >= RIVER.dockExport - 0.001);

// Boats: from the carpentry, moored at the dock.
const rb = F.orderBoat('rowboat');
const boat = E.byId(rb.id);
check('A rowboat ordered at your dock, moored there', rb.ok && boat.at.tx === m.tx && boat.at.ty === m.ty, JSON.stringify(rb));
const w1 = hire();
const w2 = hire();
check('Boats stay at the dock: not lent, not pushed about', E.canLend(boat.id, w1.id).reason === 'eq_boat' && E.canTake(boat.id).reason === 'eq_boat');
check('A boat can go on a trip', F.caravanEquipment().includes(boat));

// Where it can go.
const S = sim.settlements;
const wet = S.ids().filter((id) => S.def(id).water).sort((a, b) => S.days(b) - S.days(a))[0]; // (the farther town on the water)
const land = S.ids().find((id) => !S.def(id).water);
S.get(wet).contact = true;
S.get(land).contact = true;
sim.home.store('planks', 60, { force: true });
const cargo = { planks: 40 };
check('Not to a town off the water', F.canSend({ to: land, eq: boat.id, driver: w1.id, cargo }).reason === 'not_on_water');
check('Quicker by water than by cart', F.caravanDays(wet, 'rowboat') < F.caravanDays(wet, 'handcart'), `${F.caravanDays(wet, 'rowboat')} vs ${F.caravanDays(wet, 'handcart')} days`);
sim.state.seasons.flood = { until: sim.time.day + 3 };
check('No boat sails while the river is in flood', F.canSend({ to: wet, eq: boat.id, driver: w1.id, cargo }).reason === 'river_flooded');
sim.state.seasons.flood = null;
check('A guard makes pirates less likely', F.risk(wet, boat, w2.id) < F.risk(wet, boat, null) && F.risk(wet, boat, null) === RIVER.pirates);

// Low water in a dry summer: a barge takes half.
p.level = Math.max(p.level, 3);
const bg = F.orderBoat('barge');
const barge = E.byId(bg.id);
const T = sim.state.time;
let lowYear = null;
for (let y = 0; y < 30 && lowYear === null; y++) {
  T.totalMinutes = (y * 56 + 14 + 3) * 1440; // summer of year y+1
  if (F.lowWater()) lowYear = y;
}
check('Some summers the river runs low: a barge takes half', lowYear !== null && F.caravanCap(barge) === Math.floor(E.cap(barge) * RIVER.lowWaterCap) && F.caravanCap(boat) === E.cap(boat), `year ${lowYear}`);
T.totalMinutes = (Math.floor(T.totalMinutes / 1440 / 56) * 56 + 1) * 1440 + 8 * 60; // back to spring

// The trip: out down the river, back up it, the takings.
const m0 = p.money;
const sent = F.send({ to: wet, eq: boat.id, driver: w1.id, guard: w2.id, cargo });
check('The boat sets off with the goods', sent.ok && boat.at.kind === 'away' && sim.home.storageCount('planks') === 20);
const c = sent.caravan;
check('Afloat on the river (drawn down it)', (() => {
  sim.state.time.totalMinutes += 60;
  const pos = F.caravanPosition(c);
  return pos?.boat && sim.world.isWater(Math.floor(pos.x / 32), Math.floor(pos.y / 32));
})());
while (sim.state.freight.caravans.includes(c)) F.tick((sim.state.time.totalMinutes += 60));
check('Home again, moored at the dock', boat.at.kind === 'ground' && sim.world.isWater(boat.at.tx, boat.at.ty) && Math.abs(boat.at.tx - m.tx) + Math.abs(boat.at.ty - m.ty) <= 4);
check('…with the takings', p.money > m0 - 200, `${m0} → ${p.money}${c.robbed ? ' (robbed)' : ''}`);
check('The crew step ashore at the dock', !w1.away && Math.abs(w1.x - sim.world.buildings[dockId].door.tx * 32) < 64);

// Saved.
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Boats are saved (and still moored)', copy.equipment.byId(boat.id)?.type === 'rowboat' && copy.freight.docks().includes(dockId));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll river checks passed');
process.exit(failures ? 1 : 0);
