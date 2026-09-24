// Multi-year headless run: families, housing, aging, death and inheritance.
// Prints the village's life story and checks the world stays consistent.
// Usage: node tools/smoke-life.mjs [years] [seed]
import { Simulation } from '../src/core/Simulation.js';
import { BALANCE } from '../src/config/balance.js';

const years = Number(process.argv[2] || 3);
const seed = Number(process.argv[3] || 2024);
const sim = Simulation.newGame('Tester', seed);
const T = BALANCE.time;
const days = years * T.daysPerSeason * T.seasons.length;
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const start = Date.now();
const counts = {};
sim.bus.on('chronicle', (e) => {
  counts[e.key] = (counts[e.key] || 0) + 1;
});
let maxHomelessDays = 0;
const homelessSince = {};
sim.bus.on('time:day', () => {
  for (const n of sim.state.npcs) {
    if (!n.homeId && n.age >= 16) {
      homelessSince[n.id] ??= sim.time.day;
      maxHomelessDays = Math.max(maxHomelessDays, sim.time.day - homelessSince[n.id]);
    } else delete homelessSince[n.id];
  }
});
const end = sim.time.total + days * 1440;
while (sim.time.total < end) sim.update(400);
const secs = (Date.now() - start) / 1000;

const S = sim.state;
console.log(`\n${years} years (${days} days) in ${secs.toFixed(1)}s — population ${S.npcs.length}, graveyard ${S.graveyard.length}`);
console.log('Events:', JSON.stringify(counts));
console.log('\nPeople:');
for (const n of S.npcs) {
  const P = sim.property;
  console.log(`  ${n.id.padEnd(8)} ${String(n.age).padStart(3)}y ${n.gender} ${n.occupation.padEnd(15)} $${String(Math.round(n.money)).padStart(5)} home ${String(n.homeId).padEnd(10)} spouse ${n.kin.spouse || '-'} kids ${n.kin.children.length} ${P.landlord(n) ? `rents from ${P.landlord(n)}` : 'no rent'}`);
}
console.log('\nHomes:');
for (const id of sim.property.homes()) {
  const r = sim.property.rec(id);
  console.log(`  ${id.padEnd(10)} owner ${String(r.owner).padEnd(8)} ${sim.property.occupants(id)}/${sim.property.capacity(id)} cond ${Math.round(r.condition)} value $${sim.property.value(id)} rent $${sim.property.weeklyRent(id)}${r.abandoned ? ' ABANDONED' : ''}${r.forSale ? ' for sale' : ''}`);
}
console.log(`Village treasury: $${Math.round(S.village.treasury)}`);
console.log('\nFamily chronicle:');
for (const e of S.chronicle) if (/married|baby|died|retired|moved_out|bought_home|evicted|business_|building_|courting/.test(e.key)) console.log(`  day ${e.day}: ${e.key} ${JSON.stringify(e.params)}`);

// Death and inheritance, forced on a fresh village.
{
  const s2 = Simulation.newGame('Heir', 5);
  const run2 = (m) => {
    const e = s2.time.total + m;
    while (s2.time.total < e) s2.update(400);
  };
  run2(1440);
  const fy = s2.npcs.byId('fyodor');
  const nina = s2.npcs.byId('nina');
  const cash = Math.floor(fy.money);
  const ninaMoney = nina.money;
  s2.family.die(fy, 'age');
  check('smithy passes to the widow', s2.state.businesses.smithy.owner === 'nina' && nina.owns === 'smithy', `owner ${s2.state.businesses.smithy.owner}, nina ${nina.occupation}`);
  check('the widow inherits the savings', nina.money >= ninaMoney + cash - 1);
  check('the family home passes on', s2.property.rec('house_1').owner === 'nina');
  check('the dead are remembered', s2.state.graveyard.some((g) => g.id === 'fyodor') && s2.memory.has(nina, 'family_died'));
  check('Sofia still knows her late father', s2.family.kinship(s2.npcs.byId('sofia'), s2.family.person('fyodor')) === 'parent');
  // An owner with no family: the most experienced worker takes over.
  const stepan = s2.npcs.byId('stepan');
  const workers = s2.state.npcs.filter((n) => n.employer === 'quarry').map((n) => n.id);
  s2.family.die(stepan, 'age');
  const q = s2.state.businesses.quarry;
  check('quarry goes to a worker (or closes if none)', workers.length ? workers.includes(q.owner) : q.closed, `new owner ${q.owner}`);
  // A tenant dies: nothing breaks.
  s2.family.die(s2.npcs.byId('yakov'), 'illness');
  run2(3 * 1440);
  check('the village keeps running after deaths', s2.state.npcs.length >= 13 && !s2.state.npcs.some((n) => ['fyodor', 'stepan', 'yakov'].includes(n.id)));
}

// Consistency
const ids = new Set(S.npcs.map((n) => n.id));
check('no duplicate villager ids', ids.size === S.npcs.length);
check('spouses point at each other', S.npcs.every((n) => !n.kin.spouse || sim.npcs.byId(n.kin.spouse)?.kin.spouse === n.id));
check('business owners are alive', Object.entries(S.businesses).every(([id, b]) => !b.owner || ids.has(b.owner)), JSON.stringify(Object.fromEntries(Object.entries(S.businesses).map(([k, b]) => [k, b.owner]))));
check('owners run what they own', S.npcs.filter((n) => n.owns).every((n) => S.businesses[n.owns].owner === n.id));
check('nobody lives in a building that does not exist', S.npcs.every((n) => !n.homeId || sim.world.buildings[n.homeId]));
check('no one is homeless for months', maxHomelessDays < 60, `longest ${maxHomelessDays} days`);
check('homes are not badly overcrowded', sim.property.homes().every((id) => sim.property.occupants(id) <= sim.property.capacity(id) + 2));
if (years >= 3) check('life goes on (someone married or was born or died)', (counts['chronicle.npc_married'] || 0) + (counts['chronicle.npc_baby'] || 0) + (counts['chronicle.npc_died'] || 0) > 0);
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
