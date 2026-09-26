// Headless test for the roads to the towns and the railway (SettlementSystem ROAD_LEVELS, data/tech.js):
//   roads    — a track, a road, a good road work as before; beyond that a stone highway (needs the
//              know-how of stone bridges) makes the journey shorter and safer still
//   railway  — needs the know-how of railways (steam first) and a station in the valley (you build it);
//              lay the line and the journey takes the train's time, it's nearly safe, and a goods
//              wagon carries 400; the first train is news
//   and      — your caravans go by rail too; it all survives a save
// Usage: node tools/smoke-rail.mjs
import { Simulation } from '../src/core/Simulation.js';
import { transportTools } from '../src/debug/transportTools.js';
import { ROAD_LEVELS, RAIL, TRADE } from '../src/data/settlements.js';
import { REGIONS } from '../src/data/regions.js';
import { TECHS } from '../src/data/tech.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(4000);
};
const grant = (sim, ...ids) => {
  ids.forEach((id) => (sim.tech.T.known[id] = sim.time.day));
  sim.tech.mods = null;
};
const finishRoad = (sim, id) => {
  const s = sim.settlements.get(id);
  s.roadWork.done = sim.time.day;
  sim.settlements.roadWorks();
};

{
  const sim = Simulation.newGame('T', 9701);
  sim.state.player.money = 100000;
  sim.progression.addXp(20000);
  const S = sim.settlements;
  // The farthest place (the biggest difference a road makes).
  const id = S.ids().sort((a, b) => REGIONS[S.def(b).region].days - REGIONS[S.def(a).region].days)[0];
  const base = REGIONS[S.def(id).region].days;
  S.makeContact(id, 'test');
  const s = S.get(id);
  // Levels 0–2: as they always were.
  const same = [0, 1, 2].every((lvl) => {
    s.road = lvl;
    return S.days(id) === Math.max(1, Math.round(base * (1 - TRADE.roadDaysCut * lvl))) && Math.abs(S.danger(id) - REGIONS[S.def(id).region].danger * (1 - TRADE.roadDangerCut * lvl) * (sim.tech.mod('road_danger') ?? 1) * (sim.events.modifier('road_danger') ?? 1)) < 1e-9;
  });
  check('A track, a road, a good road: the same journeys as before', same);
  s.road = 2;
  const good = { days: S.days(id), danger: S.danger(id) };
  check('Beyond a good road: a stone highway needs the know-how of stone bridges', S.canFundRoad(id).reason === 'needs_tech' && S.canFundRoad(id).params.tech === 'stone_bridges');
  grant(sim, 'stone_bridges');
  const cost3 = S.roadCost(id);
  check('With it, you can pay for one', S.canFundRoad(id).ok, `$${cost3}`);
  S.fundRoad(id);
  check('The work starts', s.roadWork?.level === 3);
  finishRoad(sim, id);
  check('A stone highway: shorter and safer than a good road', s.road === 3 && S.days(id) <= good.days && S.danger(id) < good.danger, `${good.days} → ${S.days(id)} days`);

  // The railway.
  check('A railway needs the know-how of railways', S.canFundRoad(id).reason === 'needs_tech' && S.canFundRoad(id).params.tech === 'railways');
  check('Railways come after the steam engine (and stone bridges)', TECHS.railways.needs.tech.includes('steam_engine') && TECHS.steam_engine.needs.tech.includes('manufacture'));
  grant(sim, 'manufacture', 'steam_engine', 'railways');
  check('…and a station in the valley', S.canFundRoad(id).reason === 'need_station');
  const t0 = { ...sim.tech.T.known };
  delete sim.tech.T.known.railways;
  const where = sim.land.owned[0];
  check('You can\'t build a station without the know-how', !sim.construction.canPlace('rail_station', 0, 0).ok && sim.construction.canPlace('rail_station', 0, 0).reason === 'needs_tech');
  sim.tech.T.known = t0;
  const tr = transportTools({ sim });
  const station = tr.build('rail_station');
  check('You build the station', !!station && S.station()?.type === RAIL.stationType, station || '');
  const cost4 = S.roadCost(id);
  check('Now the railway can be laid (it costs more than a road)', S.canFundRoad(id).ok && cost4 > cost3, `$${cost4}`);
  const toasts = [];
  sim.bus.on('toast', (e) => toasts.push(e.key));
  S.fundRoad(id);
  const weeks = s.roadWork.done - sim.time.day;
  check('Laying it takes longer than a road', weeks >= Math.round(REGIONS[S.def(id).region].days * TRADE.roadWeeksPerDay * 7), `${weeks} days`);
  finishRoad(sim, id);
  check('The first train: news in the chronicle, and you hear of it', s.road === 4 && sim.state.chronicle.some((e) => e.key === 'chronicle.railway_opened') && toasts.includes('toast.railway_opened'));
  check('By rail: the journey is a fraction of the time', S.days(id) <= Math.max(1, Math.round(base * (1 - ROAD_LEVELS[4].cut))), `${base} → ${S.days(id)} days`);
  check('…whatever you\'d have travelled with (the train\'s pace)', S.days(id, 1.6) === S.days(id, 1));
  check('…nearly safe', S.danger(id) < REGIONS[S.def(id).region].danger * 0.1);
  check('…and a goods wagon carries far more than a cart', S.cargoCap(id) >= RAIL.cargo && S.cargoCap(S.ids().find((x) => x !== id)) < RAIL.cargo);
  check('Nothing beyond a railway (yet)', S.canFundRoad(id).reason === 'road_best');
  // Your caravans go by train too.
  check('Your caravans take the train', sim.freight.caravanDays(id, 'handcart') === S.days(id));
  // Saved.
  const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
  check('The railway is saved', copy.settlements.byRail(id) && copy.settlements.station()?.id === S.station().id);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll road and railway checks passed');
process.exit(failures ? 1 : 0);
