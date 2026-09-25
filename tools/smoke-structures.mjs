// Headless test for buildings as structures: every building has a level, quality and
// modules; upgrades are real construction sites that change what the building does
// (room, staff, output, stock, seats) and its footprint; villagers improve their own
// homes and premises; your home's tier follows its level; and it all survives save / load.
// Usage: node tools/smoke-structures.mjs
import { Simulation } from '../src/core/Simulation.js';
import { HOME_CAPACITY } from '../src/data/housing.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};
/** Finish a works site at once: everything delivered, every hour put in. */
function finish(sim, c) {
  c.delivered = { ...c.required };
  c.labor = c.laborNeeded;
  sim.construction.tryComplete(c);
}

const sim = Simulation.newGame('T', 4242);
const S = sim.structures;
const P = sim.property;
const p = sim.state.player;

// 1. Every building is a structure, as it was.
const missing = sim.world.buildingList.filter((b) => b.type !== 'well' && !S.rec(b.id));
check('every building has a level, quality and modules', !missing.length, missing.map((b) => b.id).join(','));
const capsSame = P.homes().every((id) => P.capacity(id) === (HOME_CAPACITY[P.type(id)] ?? 0));
check('…and holds as many people as before', capsSame);
const neutral = sim.economy.active().every((id) => {
  const bld = sim.economy.biz(id).building;
  return S.staffBonus(bld) === 0 && S.stockMult(bld) === 1 && Math.abs(S.outputMult(bld) - 1) < 0.06;
});
check('the founding businesses work as they always did', neutral);
check('levels, quality and condition are separate', S.level('house_2') === 3 && S.quality('house_2') > 0 && P.rec('house_2').condition === 100, JSON.stringify(S.view('house_2')).slice(0, 160));

// 2. You buy an empty house and build it up.
const id = 'house_4';
for (const n of sim.npcs.residentsOf(id).slice()) n.homeId = null;
sim.npcs.invalidateHouseholds();
P.rec(id).forSale = true;
p.money = 20000;
check('you can buy the empty house', P.playerBuy(id).ok && P.rec(id).owner === 'player');
sim.progression.addXp(5000); // construction unlocked
p.skills.construction.level = 9;
const cap0 = P.capacity(id);
const val0 = P.value(id);
const w0 = sim.world.buildings[id].w;
const opts = S.options(id, 'player');
check('there are things you could do to it', opts.length > 4 && opts.some((o) => o.job.type === 'level'), opts.map((o) => `${S.jobKey(o.job)}:${o.check.ok ? 'ok' : o.check.reason}`).join(' '));
const money0 = p.money;
const up = S.start(id, { type: 'level', to: 4 }, 'player');
check('building it up to a large house starts a real site over it (and costs money)', up.ok && up.site.kind === 'works' && p.money < money0 && S.works(id), up.reason);
check('…which needs materials and hours of work', Object.keys(up.site.required).length >= 4 && up.site.laborNeeded > 600);
check('…one thing at a time', !S.check(id, { type: 'module', m: 'bedroom' }, 'player').ok);
finish(sim, up.site);
const b = sim.world.buildings[id];
check('when it is done the house is bigger: more room, two floors, a wider footprint', S.level(id) === 4 && P.capacity(id) > cap0 && S.fx(id).floors === 2 && b.w === w0 + 1, `cap ${cap0}→${P.capacity(id)}, w ${w0}→${b.w}`);
check('…it looks different', !!b.look && b.look.floors === 2);
check('…and it is worth more', P.value(id) > val0, `${val0} → ${P.value(id)}`);
check('…the door is still under the house and free', !sim.world.isBlocked(b.door.tx, b.door.ty) && b.door.tx >= b.tx && b.door.tx < b.tx + b.w);

// 3. Modules: a bedroom (inside), a garden (on the ground beside it).
const c1 = S.start(id, { type: 'module', m: 'bedroom' }, 'player');
finish(sim, c1.site);
check('a bedroom makes room for two more', P.capacity(id) === cap0 + 2 + 2, String(P.capacity(id)));
const wBefore = b.w;
const g = S.start(id, { type: 'module', m: 'garden' }, 'player');
if (g.ok) {
  const blockedDuring = sim.construction.extraTiles(g.site).every(([x, y]) => sim.world.isBlocked(x, y));
  check('a garden takes the ground beside the house while it is made', blockedDuring);
  finish(sim, g.site);
  check('…and the house grows onto it', b.w === wBefore + 2 && S.rec(id).annex.some((a) => a.m === 'garden'), `w ${wBefore}→${b.w}`);
} else check('a garden can be laid out beside it', false, g.reason);
check('no ground is left blocked for the half-finished work', sim.construction.sites().every((c) => c.target !== id));

// 4. Renovation.
S.rec(id).q = 40;
S.changed(id);
P.rec(id).condition = 55;
const q0 = S.quality(id);
const rn = S.start(id, { type: 'renovate' }, 'player');
finish(sim, rn.site);
check('a renovation raises the quality and puts it back in good repair', S.quality(id) > q0 && P.rec(id).condition === 100, `${q0} → ${S.quality(id)}`);
check('…and it is all in the building\'s history', S.rec(id).hist.filter((h) => h.k === 'works_done').length >= 4 && S.rec(id).ups >= 3 && S.rec(id).ren === 1);

// 5. Your home's tier follows its level.
const home = 'house_6';
for (const n of sim.npcs.residentsOf(home).slice()) n.homeId = null;
sim.npcs.invalidateHouseholds();
P.transfer(home, 'player', 'bought', 0);
p.homeId = home;
S.syncHome();
check('living in a medium house of your own, you get the house tier', sim.home.tierId === 'house', sim.home.tierId);
const comfort0 = sim.home.comfort();
finish(sim, S.start(home, { type: 'level', to: 4 }, 'player').site);
check('…build it up and you live in a large house (more comfort)', sim.home.tierId === 'large_house' && p.homeTier === 'large_house' && sim.home.comfort() > comfort0, `${sim.home.tierId} ${comfort0}→${sim.home.comfort()}`);
finish(sim, S.start(home, { type: 'module', m: 'cellar' }, 'player').site);
check('…a cellar adds to your chest', sim.home.storageCapacity() >= 260 + 120);

// 6. Premises: a bigger workshop makes room for more hands; a school classroom for more pupils.
const smith = sim.npcs.list.find((n) => n.owns === 'smithy');
const biz = sim.economy.biz('smithy');
biz.money = 5000;
const staff0 = sim.npcs.maxStaff('smithy');
const out0 = S.outputMult('smithy');
const w = S.start('smithy', { type: 'level', to: 3 }, smith.id);
check('a villager with a busy smithy can build it up (paid from the till)', w.ok && biz.money < 5000, w.reason);
finish(sim, w.site);
check('…more output', S.outputMult('smithy') > out0, `${out0.toFixed(2)} → ${S.outputMult('smithy').toFixed(2)}`);
finish(sim, S.start('smithy', { type: 'module', m: 'extra_bench' }, smith.id).site);
check('…another bench: room for one more worker', sim.npcs.maxStaff('smithy') === staff0 + 1, `${staff0} → ${sim.npcs.maxStaff('smithy')}`);
sim.state.village.treasury = 5000;
const sch = sim.growth.start('village', 'school', 'public', { tx: 44, ty: 40 });
sch.delivered = { ...sch.required };
sch.labor = sch.laborNeeded;
sim.construction.tryComplete(sch);
const s = sim.schools.rec(sch.id);
const seats0 = sim.schools.seats(s);
finish(sim, S.start(sch.id, { type: 'level', to: 2 }, 'village').site);
finish(sim, S.start(sch.id, { type: 'module', m: 'classroom' }, 'village').site);
check('a school built up a level, with another classroom, seats more pupils', sim.schools.seats(s) === seats0 + 6 + 8, `${seats0} → ${sim.schools.seats(s)}`);

// 7. Villagers improve their homes when they need to.
const fam = sim.state.npcs.find((n) => n.homeId && P.rec(n.homeId)?.owner === n.id && S.rec(n.homeId)?.fam === 'house' && !S.works(n.homeId));
fam.money = 3000;
const look = sim.state.npcs[0].look;
for (let i = 0; i < 4; i++) sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, homeId: fam.homeId });
sim.npcs.invalidateHouseholds();
const lvl0 = S.level(fam.homeId);
const mods0 = Object.values(S.rec(fam.homeId).mods).reduce((a, n) => a + n, 0);
S.villagersImprove();
check('a crowded family with savings starts building on (a bedroom, or a level up)', !!S.works(fam.homeId), `${fam.homeId} lvl ${lvl0}, ${P.occupants(fam.homeId)}/${P.capacity(fam.homeId)}`);


// 7b. A house of yours that stands empty: move in — and pay builders to do a job for you.
const moved = sim.construction.canMoveIn(id) && sim.construction.moveIn(id);
check('you can move into a house you bought', moved && p.homeId === id && sim.home.tierId === 'large_house', sim.home.tierId);
const pantry = S.start(id, { type: 'module', m: 'pantry' }, 'player');
const hired = sim.construction.hire(pantry.site, 400, { buyMaterials: true });
check('you can put money down for builders (and for them to buy the materials)', hired.ok && pantry.site.budget === 400 && pantry.site.hired);
for (let i = 0; i < 6; i++) sim.npcs.spawn({ age: 30, occupation: 'unemployed', look, money: 5 });
const pm = p.money;
runOn(sim)(14 * 1440);
check('…and they get it done without you lifting a finger', !S.works(id) && S.rec(id).mods.pantry === 1, `labor ${Math.round(pantry.site.labor)}/${pantry.site.laborNeeded}, mats ${Math.round(sim.construction.materialsFraction(pantry.site) * 100)}%`);
check("…what's left of the money comes back", p.money > pm, `${pm} → ${p.money}`);

// 8. Save / load: the grown buildings, work in progress and its ground.
const inProgress = S.works(fam.homeId);
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
const b2 = sim2.world.buildings[id];
check('grown buildings keep their size and place after loading', b2.w === b.w && b2.tx === b.tx && b2.door.tx === b.door.tx && sim2.structures.level(id) === 4 && sim2.property.capacity(id) === P.capacity(id));
check('…and their look', sim2.world.buildings[id].look?.left?.length + (sim2.world.buildings[id].look?.right?.length || 0) >= 1 || !!sim2.world.buildings[id].look?.right);
check('…the ground under them stays built on', sim2.world.isBlocked(b2.tx, b2.ty) && sim2.world.isBlocked(b2.tx + b2.w - 1, b2.ty + b2.h - 1));
if (inProgress?.fp) check('…and work in progress keeps its ground', sim2.construction.extraTiles(sim2.construction.byId(inProgress.id)).every(([x, y]) => sim2.world.isBlocked(x, y)));
check('your home is still a large house', sim2.home.tierId === 'large_house', sim2.home.tierId);

// 9. A year of the valley with all this going on.
let crashed = null;
const t0 = Date.now();
try {
  runOn(sim2)(56 * 1440);
} catch (e) {
  crashed = e;
}
check('a year passes without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 4).join(' | '));
const improved = Object.values(sim2.state.structures).filter((r) => r.ups > 0).length;
console.log(`   ${((Date.now() - t0) / 1000).toFixed(0)}s · buildings improved so far: ${improved} · works now: ${sim2.construction.sites().filter((c) => c.kind === 'works').length}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll structure checks passed.');
process.exit(failures ? 1 : 0);
