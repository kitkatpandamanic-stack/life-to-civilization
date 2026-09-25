// Headless test for NPC-driven development (building spec, Phase 12): a family that rents buys a
// lot ahead and builds its home on it when it can; the well-off buy land that's getting dearer and
// sell it on (you can buy it); a villager with capital builds a row of houses to let; a new shopfront
// goes to a neighbourhood with no shop; builders build on their own land first; and it all survives
// save / load.
// Usage: node tools/smoke-npcdev.mjs
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
const D = sim.development;
const T2 = sim.territory;
const P = sim.property;
const G = sim.growth;
D.minded = () => true; // (everyone is minded to, this week — the lean is per villager and week)

// 1. A family renting buys a lot ahead, for its own home.
const renter = sim.state.npcs.find((n) => n.age >= 20 && n.age < 60 && P.landlord(n) && !G.projectOf(n));
renter.money = 450;
const before = renter.money;
check('a family that rents, with savings: it buys a lot for a home of its own', D.buyHomeLot(renter) && renter.landPlan?.k === 'home', JSON.stringify(renter.landPlan));
const lot = renter.landPlan.plot;
check('…the lot is theirs, and paid for (to the village)', T2.owner(lot) === renter.id && renter.money < before, `${T2.owner(lot)}, ${before} → ${renter.money}`);
check('…and it is news', sim.state.chronicle.some((c) => c.key === 'chronicle.npc_bought_lot' && c.params.npc === renter.id));
check('the land panel knows their plans', D.plannerOf(lot)?.id === renter.id);

// 2. …and builds on it once there's the money.
renter.money = 5;
D.buildOnLand();
check('not before they can pay for the house', !G.projectOf(renter));
renter.money = 600;
D.buildOnLand();
const site = G.projectOf(renter);
check('with the money: they build — on their own lot', !!site && T2.ownerAt(site.tx + 1, site.ty + 1) === renter.id, site && `${site.id} on ${T2.idAt(site.tx + 1, site.ty + 1)} (${T2.ownerAt(site.tx + 1, site.ty + 1)})`);
finish(site);
check('the house done, the plan is done (and they live there)', !renter.landPlan && renter.homeId === site.id, `${renter.homeId}`);

// 3. Builders build on their own land first (GrowthSystem).
const owner = sim.state.npcs.find((n) => n.age >= 25 && !n.landPlan && !G.projectOf(n) && n !== renter);
owner.money = 600;
const own = G.findLot('small_house', { tx: 84, ty: 44 }, owner.id);
const m = 1;
T2.acquireLot(owner.id, own.tx - m, own.ty - m, own.tx + 3 + m, own.ty + 2 + m, { pay: false, whole: true });
const pick = G.findLot('small_house', { tx: own.tx - 6, ty: own.ty }, owner.id);
check('a builder with land of their own builds there rather than elsewhere nearer', pick && T2.ownerAt(pick.tx + 1, pick.ty + 1) === owner.id, pick && `${pick.tx},${pick.ty}`);

// 4. Land held while it grows dearer, then sold on — you can buy it.
const rich = sim.state.npcs.find((n) => n.age >= 25 && !n.landPlan && !G.projectOf(n) && n !== owner && n !== renter && !P.landlord(n));
rich.money = 3000;
check('the well-off buy land to hold', D.buyToHold(rich) && rich.landPlan?.k === 'hold', JSON.stringify(rich.landPlan));
const held = rich.landPlan.plot;
T2.rec(held).lv = (T2.rec(held).lv || 1) * 1.6;
T2.cache.delete(held);
rich.landPlan.day -= NPC_DEV.holdDays + 1; // (as if bought weeks ago)
D.sellers();
check('once it is worth a good deal more, it goes up for sale', T2.rec(held).forSale && sim.state.chronicle.some((c) => c.key === 'chronicle.npc_land_for_sale'));
sim.state.player.money = 10000;
sim.state.player.level = 20;
const chk = T2.canBuy(held, 'player', { anywhere: true });
check('…and you can buy it', chk.ok, JSON.stringify(chk));
T2.buy(held, 'player', { anywhere: true });
D.tidy();
check('sold: the land is yours, and their plan is over', T2.owner(held) === 'player' && !rich.landPlan);

// 5. A developer: a row of houses to let.
const dev = sim.state.npcs.find((n) => n.age >= 25 && n.age <= 62 && !n.landPlan && !G.projectOf(n) && n !== owner && n !== renter && n !== rich);
dev.money = 2000;
dev.traits = [...dev.traits.filter((t) => t !== 'generous'), 'ambitious'];
sim.state.realty.idx = 1.3;
for (const id of P.homes().filter((h) => P.isVacant(h))) G.arrive({ homeId: id, size: 1 }); // (every home taken)
sim.npcs.invalidateHouseholds();
for (const n of sim.state.npcs) if (n !== dev && n.money >= NPC_DEV.developerMoney) n.money = 100;
check('homes wanted, a villager with capital and drive: a row of houses to let', D.developers() === dev.id && dev.landPlan?.k === 'develop', JSON.stringify(dev.landPlan));
const houses = [];
for (let i = 0; i < NPC_DEV.developerHouses; i++) {
  const c = G.projectOf(dev);
  if (!c) break;
  houses.push(c.id);
  finish(c);
  dev.money = 2000;
  D.developers();
}
check('…built one after another', houses.length === NPC_DEV.developerHouses, houses.join(','));
const doors = houses.map((id) => sim.world.buildings[id]?.door).filter(Boolean);
const spread = Math.max(...doors.map((a) => Math.max(...doors.map((b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty)))));
check('…close together (a row, not scattered)', spread <= 20, `spread ${spread} tiles`);
check('…all to let', houses.every((id) => P.rec(id)?.owner === dev.id && P.rec(id)?.forRent));
check('…and when it is done, it is news', !dev.landPlan && sim.state.chronicle.some((c) => c.key === 'chronicle.npc_development_done' && c.params.npc === dev.id));
check('…and they rest a while before the next', dev.devRest > sim.time.day && D.developers() !== dev.id);

// 6. Shops follow people: a neighbourhood with no shop draws the next shopfront.
const hood = sim.places.hoods().find((h) => h.homes.length >= NPC_DEV.shopHoodHomes && !(h.stats?.services || []).includes('shop'));
if (hood) {
  const trader = sim.state.npcs.find((n) => n.age >= 25 && !G.projectOf(n) && !n.landPlan && n !== dev);
  trader.money = 3000;
  const shop = G.buildPremises(trader, 'general_store');
  const d = shop && Math.abs(shop.tx - hood.tx) + Math.abs(shop.ty - hood.ty);
  const dPlaza = shop && Math.abs(shop.tx - 46) + Math.abs(shop.ty - 40);
  check('a neighbourhood with no shop: the new shopfront goes up there', !!shop && d < dPlaza, `${d} tiles from it, ${dPlaza} from the plaza`);
} else check('a neighbourhood with no shop: (none here — every neighbourhood has one)', true);

// 7. Save and load.
const plan = sim.state.npcs.find((n) => n.landPlan);
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('after loading: plans and the record of who developed what', sim2.state.development.log.length === sim.state.development.log.length && (!plan || JSON.stringify(sim2.npcs.byId(plan.id).landPlan) === JSON.stringify(plan.landPlan)));

// 8. A season of it, the way it goes by itself.
delete D.minded;
let crashed = null;
try {
  const end = sim.time.total + 28 * 1440;
  while (sim.time.total < end) sim.update(2000);
} catch (e) {
  crashed = e;
}
check('four weeks pass without trouble', !crashed, crashed?.stack?.split('\n').slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll NPC development checks passed');
process.exit(failures ? 1 : 0);
