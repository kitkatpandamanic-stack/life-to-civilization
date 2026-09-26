// Headless test for inventions and patents (InventionSystem):
//   start   — needs your skill, the valley's know-how, and the materials (used up)
//   work    — two-hour sittings; better skill = faster; now and then a setback
//   patent  — the valley gets the benefit (TechSystem.mod); businesses using it pay you royalties weekly
//             (booked as royalties); other towns buy licences; three years and it's done
//   race    — a rival may be at it too, and can beat you to it (the patent — and the royalties — are theirs)
//   and     — heirs inherit patents; saving; old saves; no dice
// Usage: node tools/smoke-inventions.mjs
import { Simulation } from '../src/core/Simulation.js';
import { INVENTIONS, INVENT } from '../src/data/inventions.js';
import { rand } from '../src/core/rng.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 8123);
const I = sim.inventions;
const p = sim.state.player;
p.money = 5000;
const id = 'preserving_jars'; // (no technology needed)
check('Too unskilled to try', I.canStart(id).reason === 'need_skill_level');
p.skills.cooking.level = 6;
check('No glass, no start', I.canStart(id).reason === 'need_items');
sim.home.store('glass', 5, { force: true });
const r0 = rand.getState();
const st = I.start(id);
check('Started: the materials are used up', st.ok && sim.home.storageCount('glass') === 2, JSON.stringify(st));
check('One idea on the bench at a time', I.canStart('seed_drill').reason === 'project_underway');
// Sittings until it's done (the rival kept from finishing: this test is about your work).
const bar0 = sim.tech.mod('sickness');
let sittings = 0;
let setbacks = 0;
let out = null;
while (I.S.project && sittings < 40) {
  p.energy = 100;
  if (I.S.project.rival) I.S.project.rival.done = 0;
  out = I.work();
  sittings++;
  if (out.setback) setbacks++;
}
check('Sittings at the bench get it done', !!out?.finished && sittings >= 3, `${sittings} sittings, ${setbacks} setback(s)`);
check('…and the patent is yours', I.S.patents[id]?.owner === 'player');
check('The whole valley gets the good of it', sim.tech.mod('sickness') < bar0, `${bar0} → ${sim.tech.mod('sickness')}`);
check('Nothing about it rolls the dice', rand.getState() === r0);

// Royalties: every bakery, tavern and store that isn't yours pays each week.
const payers = I.payers(id);
check('Businesses that use it owe royalties', payers.length > 0, `${payers.length}`);
for (const b of payers) sim.economy.biz(b).money = Math.max(sim.economy.biz(b).money || 0, 100);
const m0 = p.money;
const royal0 = sim.ledger.summary(Infinity).in.royalties || 0;
I.royalties();
const got = p.money - m0;
check('Weekly royalties paid to you', got >= INVENTIONS[id].royalty, `+${got}`);
check('…booked as royalties in your affairs', (sim.ledger.summary(Infinity).in.royalties || 0) - royal0 === got);
// A licence for a town you trade with.
const town = sim.settlements.known()[0] || Object.keys(sim.state.region.list)[0];
sim.state.region.list[town].contact = true;
const lic = I.licenceSold(id, town);
check('A town buys a licence (once)', lic.ok && I.canLicence(id, town).reason === 'licence_sold', JSON.stringify(lic));
// The patent runs out.
I.S.patents[id].until = sim.time.day - 1;
const m1 = p.money;
I.royalties();
check('After three years the royalties stop', p.money === m1);

// A race lost: a rival finishes first.
p.skills.construction.level = 5;
for (const tech of INVENTIONS.kiln_flue.needs) sim.state.tech.known[tech] = 0;
sim.home.store('bricks', 10, { force: true });
sim.home.store('stone', 10, { force: true });
const smith = sim.state.npcs.find((n) => n.age >= 20);
smith.occupation = INVENTIONS.kiln_flue.rivals[0];
I.start('kiln_flue');
if (!I.S.project.rival) I.S.project.rival = { npc: smith.id, done: 0 };
I.S.project.rival.done = I.need('kiln_flue') * INVENT.rivalSlower - 1;
const npc = sim.npcs.byId(I.S.project.rival.npc);
I.daily();
check('A rival can beat you to it: the patent is theirs', I.S.patents.kiln_flue?.owner === npc.id && !I.S.project, I.S.patents.kiln_flue?.owner);

// Saved, and passed on.
const copy = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('Patents are saved', Object.keys(copy.inventions.S.patents).length === 2 && copy.tech.mod('sickness') < 1);
const old = JSON.parse(JSON.stringify(sim.state));
delete old.inventions;
check('An old save (from before) loads', Object.keys(new Simulation(old).inventions.S.patents).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll invention checks passed');
process.exit(failures ? 1 : 0);
