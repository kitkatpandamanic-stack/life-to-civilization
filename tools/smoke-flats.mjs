// Headless test for blocks of flats (building spec, Phase 14): several households under one roof,
// each in a flat of its own with its own tenancy (rent, arrears, notice); flats let for less than a
// house; a full block takes nobody more; your block let flat by flat (the sign stays up while a flat is
// free); the shop on the ground floor; built up to more flats; a large house turned into flats; and all
// of it surviving save / load.
// Usage: node tools/smoke-flats.mjs
import { Simulation } from '../src/core/Simulation.js';
import { FLATS, RENTAL, HOUSING } from '../src/data/housing.js';

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
const F = sim.flats;
const P = sim.property;
const G = sim.growth;
const S = sim.structures;
const look = sim.state.npcs[0].look;
/** A household of newcomers (a couple, or one) with some money, living nowhere yet. */
const household = (n = 2, money = 200) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(sim.npcs.spawn({ age: 28 + i, occupation: 'farmhand', look, money }));
  if (n > 1) {
    out[0].family.push(out[1].id);
    out[1].family.push(out[0].id);
  }
  return out;
};

// 1. The village puts up a block of flats.
sim.state.village.treasury += 3000;
const site = G.start('village', 'apartment_house', 'rental', { tx: 84, ty: 44 });
finish(site);
const B = site.id;
check('a block of flats stands: several flats under one roof', F.isBlock(B) && F.units(B) >= 3 && P.isHome(B), `${F.units(B)} flats, ${P.capacity(B)} people, ${F.flatCap(B)} a flat`);
check('…it is to let, with flats free', P.housingState(B) === 'for_rent' && P.isVacant(B) && F.free(B) === F.units(B), P.housingState(B));
const small = G.start('village', 'small_house', 'rental', { tx: 84, ty: 30 });
finish(small);
check('a flat lets for less than a house', P.weeklyRent(B) < P.weeklyRent(small.id), `flat ${P.weeklyRent(B)} vs house ${P.weeklyRent(small.id)}`);

// 2. Households move in: a flat each, each with its own tenancy.
const hhs = [];
for (let i = 0; i < F.units(B); i++) {
  const hh = household(i === 0 ? 1 : 2);
  P.moveIn(hh, B, 'moved');
  hhs.push(hh);
}
const flats = hhs.map((hh) => hh[0].flat);
check('each household in a flat of its own', new Set(flats).size === hhs.length && hhs.every((hh) => hh.every((x) => x.homeId === B && x.flat === hh[0].flat)), flats.join(','));
check('…each with its own tenancy (the village lets them)', F.leases(B).length === hhs.length && F.leases(B).every((x) => x.lease.rent === P.weeklyRent(B)));
check('a full block takes nobody more', !P.isVacant(B) && !P.options(1, 1000, 0, household(1)[0]).some((o) => o.id === B));

// 3. Rent day: flat by flat.
const tre0 = sim.state.village.treasury;
P.collectRent();
const paid = sim.state.village.treasury - tre0;
check('rent day: every flat pays its own rent', F.leases(B).every((x) => x.lease.paid === x.lease.rent) && paid >= P.weeklyRent(B) * hhs.length, `${paid} paid`);
// A flat that can't pay falls behind — and in the end is put out; the others stay.
for (const x of hhs[1]) x.money = 0;
for (let i = 0; i < HOUSING.villageEvictWeeks; i++) P.collectRent();
check('a flat that can\'t pay is put out — the others stay', !hhs[1].some((x) => x.homeId === B && x.flat === flats[1]) && hhs[0][0].homeId === B && hhs[2][0].homeId === B && F.free(B) >= 1, `free ${F.free(B)}`);
check('…and its tenancy is in the block\'s past', (P.rec(B).tenancies || []).some((x) => x.how === 'evicted' && x.flat === flats[1]));

// 4. Your own block: let flat by flat.
const mine = G.start('village', 'apartment_house', 'rental', { tx: 30, ty: 30 });
finish(mine);
const M = mine.id;
P.transfer(M, 'player', 'bought');
sim.letting.list(M, true);
const t1 = household(2, 300)[0];
sim.letting.moveIn(t1, M, 'test');
check('you let a flat of your block: a tenancy at your rent', F.leases(M).length === 1 && F.leases(M)[0].lease.rent === P.weeklyRent(M));
check('…the sign stays up while flats are free', sim.letting.listed(M) && F.free(M) === F.units(M) - 1);
const t2 = household(1, 300)[0];
sim.letting.moveIn(t2, M, 'test');
const pm = sim.state.player.money;
P.collectRent();
check('rent day: the flats pay you', sim.state.player.money - pm === F.leases(M).reduce((s, x) => s + x.lease.rent, 0), `${sim.state.player.money - pm}`);
const n1 = t1.flat;
check('notice on one flat: not in the first fortnight', !F.canGiveNotice(M, n1).ok && F.canGiveNotice(M, n1).reason === 'too_soon');
F.lease(M, n1).since -= RENTAL.minStayDays + 1;
check('…afterwards, yes', F.giveNotice(M, n1).ok && F.lease(M, n1).notice);
F.lease(M, n1).notice.until = sim.time.day;
F.onDay();
check('the notice runs out: that household goes, the other stays', t1.homeId !== M && t2.homeId === M && F.leases(M).length === 1);

// 5. A shop on the ground floor pays its own rent.
S.rec(M).mods.shop_floor = 1;
S.changed(M);
const pm2 = sim.state.player.money;
P.collectRent();
check('the shop on the ground floor: a trader pays rent too', sim.state.player.money - pm2 === F.leases(M)[0].lease.rent + FLATS.shopFloorRent, `${sim.state.player.money - pm2}`);

// 6. Built up: more flats.
const u0 = F.units(M);
S.rec(M).lvl = 2;
S.changed(M);
check('a level up: more flats', F.units(M) > u0, `${u0} → ${F.units(M)}`);

// 7. A large house turned into flats.
const big = G.start('village', 'house', 'rental', { tx: 70, ty: 60 });
finish(big);
S.rec(big.id).lvl = 4;
S.changed(big.id);
P.transfer(big.id, 'player', 'bought');
check('a large house can be turned into a block of flats', S.conversions(big.id).includes('apartment_house'), S.conversions(big.id).join(','));
sim.state.player.money = 20000;
sim.state.player.skills.construction.level = 9;
sim.state.player.level = 20;
for (const [item, n] of Object.entries(S.cost(big.id, { type: 'convert', to: 'apartment_house' }).materials)) sim.inventory.add(item, n, { force: true });
const cv = S.start(big.id, { type: 'convert', to: 'apartment_house' }, 'player');
if (cv.ok) finish(cv.site);
check('…done: several households can live in it now', F.isBlock(big.id) && F.units(big.id) >= 3 && P.type(big.id) === 'apartment_house', JSON.stringify(cv.reason || ''));

// 8. You can live in a flat of your own block.
check('you can move into a flat of your block', sim.construction.canMoveIn(M) && sim.construction.moveIn(M) && sim.state.player.homeId === M && P.rec(M).playerFlat !== undefined && !F.leases(M).some((x) => x.n === P.rec(M).playerFlat));

// 9. Save and load.
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('after loading: the flats, who lives in which, their tenancies', JSON.stringify(sim2.flats.leases(B).map((x) => [x.n, x.lease.tenant])) === JSON.stringify(F.leases(B).map((x) => [x.n, x.lease.tenant])) && sim2.npcs.byId(hhs[0][0].id).flat === hhs[0][0].flat);
check('after loading: your flat and the converted block', sim2.property.rec(M).playerFlat === P.rec(M).playerFlat && sim2.flats.isBlock(big.id));

// 10. A few weeks of it.
let crashed = null;
try {
  const end = sim.time.total + 21 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('three weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));
check('…and the block still holds its households, a flat each', sim.npcs.residentsOf(B).every((x) => x.flat !== null && x.flat !== undefined));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll flats checks passed');
process.exit(failures ? 1 : 0);
