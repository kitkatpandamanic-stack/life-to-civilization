// Headless test for your own settlement (ColonySystem):
//   founding  — a founding stone on open, explored land far from the village, with the headman's charter;
//               when it stands: the settlement, a name, a cart track to the road
//   the plan  — a street (or a green): the street laid at once, plots for homes, the well, the market
//   settlers  — invited villagers (and some newcomers) come with their households and build homes there
//   winter    — its store feeds them; empty, they go hungry, and a household gives up
//   running   — taxes into its purse, gifts, landmarks built from it; camp → hamlet → village
//   and       — saving; old saves; no dice
// Usage: node tools/smoke-colony.mjs
import { Simulation } from '../src/core/Simulation.js';
import { COLONY } from '../src/data/colony.js';
import { AREAS } from '../src/data/villageLayout.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(4000);
};

const sim = Simulation.newGame('T', 5151);
const K = sim.colony;
const p = sim.state.player;
p.money = 6000;
sim.progression.addXp(20000);
p.skills.construction.level = 3;
const plaza = { tx: Math.round((AREAS.plaza.x1 + AREAS.plaza.x2) / 2), ty: Math.round((AREAS.plaza.y1 + AREAS.plaza.y2) / 2) };

check('Too close to the village', K.canFound(plaza.tx + 5, plaza.ty).reason === 'too_close_to_village');
// A spot far enough away (open ground, not water, not somebody's).
let spot = null;
for (let r = COLONY.minDistance + 4; r < 60 && !spot; r++) {
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r]]) {
    const x = plaza.tx + dx;
    const y = plaza.ty + dy;
    if (!sim.world.inBounds(x, y + 2) || sim.world.isBlocked(x, y) || sim.world.isWater(x, y) || sim.world.isBlocked(x, y + 1)) continue;
    const owner = sim.territory.ownerAt(x, y);
    if (owner && owner !== 'village') continue;
    spot = { x, y };
    break;
  }
}
check('Unexplored land: not yet', K.canFound(spot.x, spot.y).reason === 'not_explored', JSON.stringify(spot));
sim.exploration.revealAround(spot.x, spot.y);
p.reputation = 0;
if (sim.state.civic) sim.state.civic.headman = null;
check("No standing, no charter", K.canFound(spot.x, spot.y).reason === 'need_charter');
p.reputation = COLONY.charterRep + 5;
check('With the charter: the founding stone may go there', sim.construction.canPlace('founding_stone', spot.x, spot.y).ok, JSON.stringify(sim.construction.canPlace('founding_stone', spot.x, spot.y)));
const stone = sim.construction.place('founding_stone', spot.x, spot.y);
stone.delivered = { ...stone.required };
stone.labor = stone.laborNeeded;
sim.construction.tryComplete(stone);
check('The stone stands: your settlement is founded', K.exists() && sim.state.colony.tx === spot.x);
const roadNear = (() => {
  for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 2; dx++) if (sim.world.isRoad(spot.x + dx, spot.y + dy)) return true;
  return false;
})();
check('…with a cart track to the road', roadNear);
check('Only one settlement', sim.construction.canPlace('founding_stone', spot.x + 3, spot.y + 3).reason === 'colony_exists');

// The plan.
const roads0 = sim.state.land.roads.length;
K.setLayout('street');
check('The plan: a street laid, plots for homes, the well and the market', sim.state.land.roads.length > roads0 && sim.state.colony.plan.filter((q) => q.kind === 'home').length >= 6 && sim.state.colony.plan.some((q) => q.kind === 'well'));

// Settlers.
const r0 = rand.getState();
const friend = sim.state.npcs.find((n) => n.age >= 20 && n.homeId && n.homeId !== 'hall' && n.occupation !== 'unemployed' && sim.state.civic?.headman !== n.id);
friend.rel = 10;
check("Settled villagers won't move for a stranger", K.canRecruit(friend).reason === 'wont_move');
friend.rel = 70;
friend.money = Math.max(friend.money || 0, 400);
K.donate(300);
const res = K.recruit(friend);
check('A friend comes, with their household', res.ok && K.isSettler(friend), JSON.stringify(res));
const site = sim.construction.sites().find((c) => c.owner === friend.id && c.purpose === 'home');
check('…and starts building a home there', !!site || friend.colonyWaiting, site ? `${site.id} at ${site.tx},${site.ty}` : 'waiting for a lot');
const r1 = rand.getState();
K.canFound(spot.x + 1, spot.y);
K.stageNow();
K.onArrived(['nobody']);
check("The settlement's own decisions roll no dice", rand.getState() === r1);
check('…its homes go up in the settlement', !site || Math.hypot(site.tx - spot.x, site.ty - spot.y) <= COLONY.radius + 4);
// Newcomers: some go on to the settlement.
let joined = null;
for (let i = 0; i < 30 && !joined; i++) {
  const w = sim.npcs.spawn({ age: 30, occupation: 'unemployed', look: sim.state.npcs[0].look, money: 100 });
  sim.bus.emit('settlement:arrived', [w.id]);
  if (K.isSettler(w)) joined = w;
}
check('Some newcomers to the valley go on to your settlement', !!joined);

// A few weeks: the homes go up.
runOn(sim)(24 * 1440);
check('Homes built there, and lived in', K.homes().length >= 1, `${K.homes().length} home(s), ${K.settlers().length} settlers`);

// Taxes into the purse; a landmark from it.
const purse0 = sim.state.colony.treasury;
for (const n of K.settlers()) n.money = Math.max(n.money || 0, 50);
K.weekly();
check('Taxes each week into its purse', sim.state.colony.treasury > purse0, `${purse0} → ${sim.state.colony.treasury}`);
K.donate(200);
const w = K.build('well');
check('The well, built from its purse', w.ok, JSON.stringify(w));
for (let d = 0; d < 20 && !K.built('well'); d++) runOn(sim)(1440);
check('…and it stands', K.built('well'));

// Winter: the store — or hunger.
sim.state.time.totalMinutes = (Math.floor(sim.time.total / 1440 / 56) * 56 + 42) * 1440 + 8 * 60; // winter
sim.state.colony.stock = {};
const settlers0 = K.settlers().length;
for (let d = 0; d < COLONY.hungryDaysToLeave; d++) K.daily();
check('An empty store in winter: hunger — and a household gives up', K.settlers().length < settlers0, `${settlers0} → ${K.settlers().length}`);
sim.inventory.add('bread', 20);
sim.inventory.add('wood', 20);
const left = K.leaveSupplies();
check('Supplies left at the stone fill its store', left.ok && K.foodStock() >= 20 && K.daysOfWinter() > 0, `${K.daysOfWinter()} days`);
sim.state.colony.hungry = 0;
K.daily();
check('…and a fed winter day is no hardship', sim.state.colony.hungry === 0);

// Growing up.
check('Its stage follows how it has grown', ['camp', 'hamlet', 'village'].includes(K.stageNow()), K.stageNow());

// Saved.
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('The settlement is saved', copy.colony.exists() && copy.state.colony.plan.length === sim.state.colony.plan.length && copy.colony.settlers().length === K.settlers().length);
const old = JSON.parse(JSON.stringify(sim.state));
delete old.colony;
check('An old save (from before) loads', !new Simulation(old).colony.exists());

console.log(failures ? `\n${failures} check(s) failed` : '\nAll settlement checks passed');
process.exit(failures ? 1 : 0);
