// Headless test for land and territory (building spec, Phase 4): the whole valley is divided
// into plots of land, each with an owner; you buy land standing on it; villagers buy a lot from
// the village before they build; a building's lot goes with it when it's sold; who owns the land
// decides who may build, farm, lay roads and fell trees on it; and it all survives save / load.
// Usage: node tools/smoke-territory.mjs
import { Simulation } from '../src/core/Simulation.js';
import { T } from '../src/world/WorldGenerator.js';
import { PLOTS } from '../src/data/land.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

const sim = Simulation.newGame('T', 4242);
const TR = sim.territory;
const W = sim.world;
const p = sim.state.player;
p.money = 20000;
sim.progression.addXp(8000);
p.skills.construction.level = 6;
const stand = (tx, ty) => {
  const c = W.tileCenter(tx, ty);
  p.x = c.x;
  p.y = c.y;
};

// 1. The land is divided up: every bit of dry ground belongs to some plot.
let dry = 0;
let covered = 0;
for (let y = 0; y < W.H; y++) {
  for (let x = 0; x < W.W; x++) {
    const t = W.tileAt(x, y);
    if (t === T.WATER || t === T.DEEP || W.isRoad(x, y) || t === T.PLAZA || t === T.BRIDGE) continue;
    dry++;
    if (TR.idAt(x, y)) covered++;
  }
}
check('all dry land is in some plot', covered === dry, `${covered}/${dry}`);
const kinds = {};
for (const q of TR.all()) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
check('signposted plots, building lots and open land', kinds.plot === PLOTS.length && kinds.lot > 5 && kinds.land > 30, JSON.stringify(kinds));
check('open land comes in different sizes', (() => {
  const n = TR.all().filter((q) => q.kind === 'land').map((q) => q.n);
  return Math.max(...n) > Math.min(...n) * 3;
})());

// 2. Owners: the signposted plots are the village's, for sale; a building's lot is its owner's.
check('signposted plots belong to the village', PLOTS.every((q) => TR.owner(q.id) === 'village'));
const home = W.buildingList.find((b) => sim.property.rec(b.id)?.owner && sim.property.rec(b.id).owner !== 'village' && sim.property.rec(b.id).owner !== 'player');
check('a villager owns the lot their building stands on', home && TR.owner(TR.lotOf(home.id)) === sim.property.rec(home.id).owner, home?.id);
check('some land belongs to nobody', TR.all().some((q) => TR.owner(q.id) === null));

// 3. You buy land standing on it — not from across the valley.
const wild = TR.all().find((q) => q.kind === 'land' && TR.owner(q.id) === null && TR.info(q.id).buildable > 30 && !TR.buildingsOn(q.id).length && TR.info(q.id).plazaDist < 50);
check('found unclaimed land', !!wild, wild?.id);
stand(10, 10);
check("can't buy land from afar", sim.land.check(wild.id).reason === 'go_to_land');
const [wx, wy] = TR.tiles(wild.id).find(([x, y]) => !W.isBlocked(x, y));
stand(wx, wy);
const price = sim.land.price(wild.id);
const money0 = p.money;
const treasury0 = sim.state.village.treasury;
check('standing on it, you can buy it', sim.land.check(wild.id).ok, `${price}`);
check('bought', sim.land.buy(wild.id));
check('it is yours', TR.owner(wild.id) === 'player' && sim.state.land.owned.includes(wild.id) && sim.land.ownsTile(wx, wy));
check('you paid, the village was paid', p.money === money0 - price && sim.state.village.treasury === treasury0 + price);
check('it is in your holdings', sim.land.holdings().includes(wild.id));
check("its record says how you came by it", TR.rec(wild.id).how === 'bought' && TR.rec(wild.id).hist.length === 1);

// 4. What owning land lets you do: build and lay roads on your own land, not your neighbours'.
const shedAt = TR.tiles(wild.id).find(([x, y]) => sim.construction.canPlace('storage_shed', x, y).ok);
check('you can build on land you bought (not a signposted plot)', !!shedAt);
const villagerLot = TR.lotOf(home.id);
const [vx, vy] = TR.tiles(villagerLot).find(([x, y]) => !W.isBlocked(x, y) && !W.isRoad(x, y)) || [];
check("you can't build on a villager's lot", !sim.construction.canPlace('storage_shed', vx, vy).ok);
stand(vx, vy);
check("you can't lay a road across a villager's lot", sim.construction.canRoad(vx, vy).reason === 'not_your_land', sim.construction.canRoad(vx, vy).reason);
check("a lot with a building on it isn't sold on its own", TR.canBuy(villagerLot, 'player').reason === 'sold_with_building');

// 5. Villagers buy a lot from the village before they build.
const builder = sim.state.npcs.find((n) => n.age >= 20 && n.age < 60 && !sim.growth.projectOf?.(n));
builder.money = 3000;
const bMoney = builder.money;
const tr0 = sim.state.village.treasury;
const site = sim.growth.start(builder, 'small_house', 'home');
check('a villager starts a house', !!site, site?.id);
const lot = site && TR.idAt(site.tx + 1, site.ty + 1);
check('the ground under it is now theirs', site && TR.owner(lot) === builder.id, lot);
check('they paid the village for it', builder.money < bMoney && sim.state.village.treasury > tr0);
check('the lot was carved out and remembered', TR.S.ops.some((o) => o.id === lot));

// 6. When a building is sold, its lot goes with it.
sim.property.transfer(home.id, 'player', 'bought', 100);
check("a building's lot goes to its new owner", TR.owner(TR.lotOf(home.id)) === 'player');
check('…and counts as land of yours, but not as separate holdings', sim.state.land.owned.includes(TR.lotOf(home.id)) && !sim.land.holdings().includes(TR.lotOf(home.id)));

// 7. Villagers leave your land alone: no felling your trees.
const forest = TR.all().find((q) => q.kind === 'land' && TR.owner(q.id) === null && TR.info(q.id).trees >= 8);
if (forest) {
  TR.transfer(forest.id, 'player', 'gift');
  const trees = () => Object.values(sim.state.objects).filter((o) => o.kind === 'tree' && o.state === 'grown' && TR.contains(forest.id, o.tx, o.ty)).length;
  const before = trees();
  runOn(sim)(60 * 24 * 4);
  check('villagers fell no trees on your land', trees() >= before, `${before} → ${trees()}`);
} else check('found wooded land', false);

// 8. Save and load: the same plots, the same owners, the carved lots.
const snap = JSON.parse(JSON.stringify(sim.state));
const sim2 = new Simulation(snap);
const T2 = sim2.territory;
let same = true;
for (let i = 0; i < TR.P.map.length; i++) if (TR.P.list[TR.P.map[i]]?.id !== T2.P.list[T2.P.map[i]]?.id) same = false;
check('after loading: the same map of plots', same);
check('after loading: the same owners', TR.all().every((q) => T2.owner(q.id) === TR.owner(q.id)));
check('after loading: your land is yours', sim2.land.ownsTile(wx, wy) && sim2.state.land.owned.includes(wild.id));
const snap2 = JSON.parse(JSON.stringify(sim2.state));
check('load → save is stable', JSON.stringify(snap2.territory) === JSON.stringify(sim2.state.territory) && T2.all().length === TR.all().length);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll territory checks passed');
process.exit(failures ? 1 : 0);
