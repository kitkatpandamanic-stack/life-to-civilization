// Headless test for changing buildings and land (building spec, Phase 13): converting a building to
// another use (building by building — a house to a shop…), pulling one down (it takes work, what's
// salvaged is the owner's, the ground is free to build again), joining two neighbouring buildings
// into one, joining and splitting plots of land; villagers and the village redeveloping (ruins
// cleared, an empty house on a busy street made a shop); and all of it surviving save / load.
// Usage: node tools/smoke-rebuild.mjs
import { Simulation } from '../src/core/Simulation.js';
import { NPC_DEV } from '../src/data/development.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const finish = (c) => {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
};

const sim = Simulation.newGame('T', 4242);
const S = sim.structures;
const P = sim.property;
const G = sim.growth;
const T2 = sim.territory;
const p = sim.state.player;
p.level = 20;
p.money = 20000;
p.skills.construction.level = 9;
const give = (mats) => {
  for (const [item, n] of Object.entries(mats || {})) sim.inventory.add(item, n, { force: true });
};
/** A new village house, made yours (empty). */
const newHouse = (tile, type = 'small_house') => {
  const c = G.start('village', type, 'rental', tile);
  finish(c);
  P.transfer(c.id, 'player', 'bought');
  return c.id;
};

// 1. Converting: a house becomes a shop.
const h1 = newHouse({ tx: 84, ty: 44 });
const opts = S.options(h1, 'player');
check('a house of yours can be turned into a shop or a workshop — not anything at all', opts.some((o) => o.job.type === 'convert' && o.job.to === 'shopfront') && opts.some((o) => o.job.to === 'workshop') && !opts.some((o) => o.job.to === 'warehouse_bld'), opts.filter((o) => o.job.type === 'convert').map((o) => o.job.to).join(','));
const q0 = S.quality(h1);
const job = { type: 'convert', to: 'shopfront' };
give(S.cost(h1, job).materials);
const cv = S.start(h1, job, 'player');
check('the conversion is real work: a site over the house', cv.ok && S.works(h1)?.kind === 'works', JSON.stringify(cv.reason || ''));
finish(cv.site);
check('done: it is a shop now (and no longer a home)', sim.world.buildings[h1].type === 'shopfront' && P.type(h1) === 'shopfront' && !P.isHome(h1) && S.rec(h1).fam === 'shop', `${sim.world.buildings[h1].type} / ${S.rec(h1).fam}`);
check('…its quality came with it', Math.abs(S.quality(h1) - q0) <= 6, `${q0} → ${S.quality(h1)}`);
check('…a business can open in it', sim.holdings.canOpenIn(h1).ok, JSON.stringify(sim.holdings.canOpenIn(h1)));
check('…and its story remembers what it was', S.rec(h1).was?.includes('small_house') && S.rec(h1).conv === 1);

// 2. Not with people living there.
const lived = sim.world.buildingList.find((b) => P.isHome(b.id) && P.occupants(b.id) > 0 && b.id !== p.homeId && b.id !== 'hall' && S.rec(b.id) && !sim.economy.businessAtBuilding(b.id));
P.rec(lived.id).owner = 'player';
const blocked = S.check(lived.id, { type: 'convert', to: 'shopfront' }, 'player');
check('a house with people in it can\'t be converted or pulled down', !blocked.ok && ['people_live_here', 'tenants_first'].includes(blocked.reason) && !S.check(lived.id, { type: 'demolish' }, 'player').ok, blocked.reason);

// 3. Pulling down: salvage, and the ground is free again — yours.
const h2 = newHouse({ tx: 84, ty: 30 });
const b2 = { ...sim.world.buildings[h2] };
const lot2 = T2.lotOf(h2);
const planks0 = sim.inventory.count('planks') + sim.home.storageCount('planks');
const dm = S.start(h2, { type: 'demolish' }, 'player');
check('pulling down takes work too (a site)', dm.ok && !!S.works(h2), JSON.stringify(dm.reason || ''));
finish(dm.site);
check('it is gone from the world', !sim.world.buildings[h2] && !P.rec(h2) && !S.rec(h2) && !sim.world.isBlocked(b2.tx + 1, b2.ty + 1));
check('…what could be salvaged is yours', sim.inventory.count('planks') + sim.home.storageCount('planks') > planks0);
check('…the ground is still yours, with nothing on it', T2.owner(lot2) === 'player' && !T2.buildingsOn(lot2).length);
check('…and you can build on it again', sim.construction.canPlace('small_house', b2.tx, b2.ty).ok, JSON.stringify(sim.construction.canPlace('small_house', b2.tx, b2.ty)));
check('it is in the village chronicle', sim.state.chronicle.some((c) => c.key === 'chronicle.player_demolished'));

// 4. Joining two neighbouring houses into one.
let a = null;
let b = null;
for (const tile of [{ tx: 70, ty: 30 }, { tx: 90, ty: 50 }, { tx: 30, ty: 30 }, { tx: 75, ty: 60 }]) {
  const x = newHouse(tile);
  // The next one right beside it (a free lot one tile over, if there is one).
  const bx = sim.world.buildings[x];
  for (const dx of [bx.w + 1, bx.w + 2, -(bx.w + 1), -(bx.w + 2)]) {
    if (!G.lotFree(bx.tx + dx, bx.ty, 4, 3, 'village')) continue;
    const c = sim.construction.startProject({ owner: 'village', type: 'small_house', tx: bx.tx + dx, ty: bx.ty, purpose: 'rental' });
    finish(c);
    P.transfer(c.id, 'player', 'bought');
    if (S.mergeable(x, 'player').includes(c.id)) {
      a = x;
      b = c.id;
      break;
    }
  }
  if (a) break;
}
check('two houses of yours side by side: they could be joined', !!a && !!b, `${a} + ${b}`);
const cap0 = P.capacity(a);
const lvl0 = S.level(a);
const box = S.mergeBox(a, b);
const mj = { type: 'merge', with: b };
give(S.cost(a, mj).materials);
const mg = S.start(a, mj, 'player');
check('joining them is one site over both', mg.ok && S.works(a) === S.works(b), JSON.stringify(mg.reason || ''));
finish(mg.site);
const ab = sim.world.buildings[a];
check('done: one building over the ground of both', !sim.world.buildings[b] && ab.w === box.w && ab.h === box.h && ab.tx === box.tx, `${ab.w}×${ab.h} at ${ab.tx},${ab.ty}`);
check('…bigger inside, and a level up', P.capacity(a) > cap0 && S.level(a) === lvl0 + 1, `cap ${cap0} → ${P.capacity(a)}, level ${lvl0} → ${S.level(a)}`);
check('…no impossible overlaps: the ground under it is its own', [...Array(ab.w).keys()].every((dx) => sim.world.isBlocked(ab.tx + dx, ab.ty + 1)));

// 5. Land: join two plots of yours, split one in two.
const plotA = T2.lotOf(a);
const nb = T2.neighbours(plotA).find((id) => T2.parcel(id).kind === 'land');
T2.transfer(nb, 'player', 'bought');
const n0 = T2.parcel(plotA).n + T2.parcel(nb).n;
const jr = T2.join(plotA, nb);
check('two plots of yours side by side join into one', jr.ok && !T2.parcel(nb) && T2.parcel(plotA).n === n0, JSON.stringify(jr));
const big = T2.all().find((q) => q.kind === 'land' && q.n >= 60 && T2.owner(q.id) !== 'player' && !T2.buildingsOn(q.id).length);
const bigN = big.n;
T2.transfer(big.id, 'player', 'bought');
const sp = T2.split(big.id);
check('…and a plot can be split in two', sp.ok && T2.parcel(sp.id) && T2.parcel(big.id).n + T2.parcel(sp.id).n === bigN && T2.owner(sp.id) === 'player', JSON.stringify(sp));

// 6. The village clears a ruin; an owner turns an empty house on a busy street into a shop.
const ruinId = sim.world.buildingList.find((x) => P.isHome(x.id) && P.occupants(x.id) === 0 && P.rec(x.id)?.owner !== 'player' && S.rec(x.id))?.id || newHouse({ tx: 20, ty: 55 });
const rr = P.rec(ruinId);
rr.owner = 'village';
rr.ruined = true;
rr.condition = 0;
rr.ruinWeeks = NPC_DEV.ruinWeeks;
sim.infra.S.fund = 500;
sim.development.redevelop();
const clear = S.works(ruinId);
check('a ruin left standing: the village clears it', clear?.job.type === 'demolish', `${ruinId} ${JSON.stringify(S.check(ruinId, { type: 'demolish' }, 'village'))}`);
if (clear) finish(clear);
check('…and it is gone, the ground back with the village', !sim.world.buildings[ruinId]);
// (a landlord's empty house in the busy part of the village)
const shopDistrict = sim.state.districts.list.find((d) => ['commercial', 'mixed'].includes(d.type));
const npcOwner = sim.state.npcs.find((n) => n.age >= 25);
const empty = sim.construction.startProject({ owner: npcOwner.id, type: 'small_house', tx: Math.round(shopDistrict.tx), ty: Math.round(shopDistrict.ty), purpose: 'rental' });
let emptyId = null;
if (G.lotFree(empty.tx, empty.ty, 4, 3, npcOwner.id) || true) {
  finish(empty);
  emptyId = empty.id;
}
const dist = sim.places.districtAt(sim.world.buildings[emptyId].door.tx, sim.world.buildings[emptyId].door.ty);
P.rec(emptyId).emptyDays = NPC_DEV.convertEmptyDays + 1;
npcOwner.money = 3000;
sim.development.redevelop();
const conv = S.works(emptyId);
check('an empty house to let on a busy street: its owner turns it into a shop', !NPC_DEV.convertDistricts.includes(dist?.type) || conv?.job.to === 'shopfront', `${dist?.type} ${conv?.job?.type}`);

// 7. Save and load: conversions, pull-downs, joins, reshaped land.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const w2 = sim2.world;
check('after loading: the shop is a shop', w2.buildings[h1]?.type === 'shopfront' && sim2.property.type(h1) === 'shopfront');
check('after loading: what was pulled down stays down', !w2.buildings[h2] && !w2.buildings[ruinId]);
check('after loading: the joined house has its footprint (and the other is gone)', w2.buildings[a]?.w === box.w && !w2.buildings[b]);
check('after loading: the land as you reshaped it', !sim2.territory.parcel(nb) && sim2.territory.parcel(sp.id)?.n === T2.parcel(sp.id).n);

// 8. A few weeks of it.
let crashed = null;
try {
  const end = sim.time.total + 21 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll rebuilding checks passed');
process.exit(failures ? 1 : 0);
