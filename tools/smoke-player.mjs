// Headless test for player depth: quality, the forge and toolmaking, cooking, perks,
// contracts from real needs, ambitions, and save / load of all of it.
// Usage: node tools/smoke-player.mjs
import { Simulation } from '../src/core/Simulation.js';
import { PERKS, perkChoices } from '../src/data/perks.js';
import { ITEMS } from '../src/data/items.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(2000);
};

const sim = Simulation.newGame('T', 501);
const run = runOn(sim);
const p = sim.state.player;
const inv = sim.inventory;
p.level = 10;
p.energy = 100;
p.money = 2000;

// 1. Quality comes from skill.
const tally = (skillLevel, n = 60) => {
  p.skills.carpentry.level = skillLevel;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) out[sim.crafting.rollQuality('chair')]++;
  return out;
};
const novice = tally(0);
const master = tally(10);
check('a novice makes crude and standard work', novice[0] + novice[1] > 50 && novice[3] === 0, novice.join('/'));
check('a master makes fine work and masterworks', master[2] + master[3] > 40 && master[3] > 0, master.join('/'));
p.skills.carpentry.level = 4;
check('no masterworks before mastery (without the perk)', tally(4, 200)[3] === 0);

// 2. Crafting takes materials, energy — and the result has a quality.
sim.crafting.openStation('workbench');
inv.add('planks', 20, { force: true });
inv.add('saw', 1, { force: true });
const e0 = p.energy;
const q = sim.crafting.complete('chair');
const chair = inv.slots.find((s) => s.id === 'chair');
check('crafting a chair works and uses energy', q !== false && !!chair && p.energy < e0, `q=${q}`);
check('the chair carries its quality', (chair.q ?? 1) === q);

// 3. Quality changes value, tools and meals.
const store = sim.economy.ofType('general_store')[0];
const std = sim.economy.playerSellPrice(store, 'chair', 1);
const fine = sim.economy.playerSellPrice(store, 'chair', 2);
check('fine goods sell for more', fine > std, `${std} → ${fine}`);
inv.add('iron_axe', 1, { force: true, q: 3 });
inv.add('axe', 1, { force: true, q: 0 });
const best = inv.bestTool('axe');
check('a masterwork tool works faster and lasts longer', best.q === 3 && inv.toolEfficiency(best) > ITEMS.iron_axe.tool.efficiency && inv.maxDurability(best) > ITEMS.iron_axe.tool.durability);
inv.add('pie', 1, { force: true, q: 3 });
p.hunger = 20;
const idx = inv.slots.findIndex((s) => s.id === 'pie' && s.q === 3);
inv.eatSlot(idx);
check('a masterwork pie fills you more', p.hunger > 20 + ITEMS.pie.food.hunger, p.hunger.toFixed(1));

// 4. Home storage keeps quality.
inv.remove('planks', inv.count('planks') - 4);
p.homeId = p.homeId || 'shack';
const ci = inv.slots.findIndex((s) => s.id === 'chair');
const cq = inv.slots[ci].q;
sim.home.deposit(ci, 1);
const si = sim.home.storage.findIndex((s) => s.id === 'chair');
check('storage keeps the quality', si >= 0 && sim.home.storage[si].q === cq);
sim.home.withdraw(si, 1);
check('…and so does taking it back', inv.slots.some((s) => s.id === 'chair' && s.q === cq));

// 5. The forge: rent it from the smith, smelt ingots, forge tools.
const smithy = sim.economy.ofType('smithy')[0];
const till = sim.economy.biz(smithy).money;
check('renting the forge pays the smith', sim.crafting.rentForge(smithy) && sim.economy.biz(smithy).money > till);
sim.crafting.openStation('forge');
sim.home.store('iron_ore', 10, { force: true });
check('at the forge, the chest at home is out of reach', !sim.crafting.check('iron_ingot').ok);
for (const s of inv.slots.filter((x) => ['axe', 'iron_axe', 'chair'].includes(x.id))) inv.slots.splice(inv.slots.indexOf(s), 1);
inv.add('iron_ore', 6, { force: true });
inv.add('coal', 3, { force: true });
p.skills.smithing.level = 2;
p.energy = 100;
sim.crafting.complete('iron_ingot');
sim.crafting.complete('iron_ingot');
check('iron ore and coal become ingots', inv.count('iron_ingot') >= 2);
inv.add('hammer', 1, { force: true });
const qp = sim.crafting.complete('pickaxe');
check('ingots become a pickaxe', qp !== false && inv.count('pickaxe') >= 1);

// 6. Perks: a real choice at level 3.
p.skills.woodcutting.level = 3;
const pending = sim.progression.pendingPerks().find((x) => x.skill === 'woodcutting');
check('reaching level 3 offers two perks', pending && pending.options.length === 2);
const chop0 = (await import('../src/systems/Modifiers.js')).Mod.actionSpeed(p, 'chop');
check('choosing one…', sim.progression.choosePerk('lumberjack'));
check('…closes the other for good', !sim.progression.choosePerk('forester'));
const { Mod } = await import('../src/systems/Modifiers.js');
check('the perk really changes the work', Mod.actionSpeed(p, 'chop') > chop0 * 1.2);
check('perks need the skill level', !sim.progression.choosePerk('chef'));
p.skills.trading.level = 3;
const before = sim.economy.playerSellPrice(store, 'wood');
sim.progression.choosePerk('merchant');
check('the Merchant perk raises what shops pay', sim.economy.playerSellPrice(store, 'wood') >= before && Mod.sellBonus(p, 'wood') > 0);
check('every perk has a partner at its tier', Object.values(PERKS).every((d) => perkChoices(d.skill, d.tier).length === 2));

// 7. Contracts from real needs.
for (let d = 0; d < 4; d++) run(1440);
const kinds = new Set(sim.state.contracts.offers.map((o) => o.kind));
check('contracts are posted on the board', sim.state.contracts.offers.length >= 3, [...kinds].join(','));
check('there are several kinds of contract', kinds.size >= 2, [...kinds].join(','));
const offer = sim.state.contracts.offers.find((o) => o.kind === 'supply') || sim.state.contracts.offers.find((o) => o.kind !== 'build' && o.kind !== 'haul');
if (offer) {
  check('you can take one on', sim.contracts.accept(offer.id).ok);
  inv.add(offer.item, offer.qty, { force: true, q: offer.minQ ?? undefined });
  const money = p.money;
  const rep = p.reputation;
  const n = sim.contracts.deliver(offer.id);
  check('delivering fulfils it and pays', n === offer.qty && p.money > money && p.reputation > rep, `+${Math.round(p.money - money)}`);
}
// A haul contract, made to order.
const haul = sim.contracts.make_haul();
if (haul) {
  sim.state.contracts.offers.push(haul);
  sim.contracts.accept(haul.id);
  const fromStock = sim.economy.stock(haul.fromBiz, haul.item);
  sim.contracts.collect(haul.id);
  check('haul: goods are collected from the producer', sim.economy.stock(haul.fromBiz, haul.item) < fromStock && inv.count(haul.item) >= haul.collected);
  sim.contracts.deliver(haul.id);
  check('haul: delivered where they were needed', sim.state.contracts.active.every((c) => c.id !== haul.id));
}
// A contract missed.
const extra = sim.contracts.make_supply() || sim.contracts.make_craft();
if (extra) {
  sim.state.contracts.offers.push(extra);
  sim.contracts.accept(extra.id);
  const rep = p.reputation;
  const failed = sim.state.contracts.failed;
  extra.deadline = sim.time.day - 1;
  sim.contracts.daily();
  check('a missed deadline costs reputation', sim.state.contracts.failed === failed + 1 && p.reputation < rep);
}

// 8. Ambitions.
check('you can track an ambition', sim.ambitions.track('masterworks') && p.ambitions.includes('masterworks'));
sim.state.stats.masterworks = 5;
sim.ambitions.check();
check('achieving it is recorded (and history remembers)', p.achieved.masterworks !== undefined && sim.state.history.entries.some((e) => e.key === 'chronicle.player_ambition'));

// 9. Save / load.
inv.add('cabinet', 1, { force: true, q: 3 });
const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('perks, quality and contracts survive save / load', sim2.state.player.perks.includes('lumberjack') && sim2.inventory.slots.some((s) => s.q === 3) && sim2.state.contracts.done >= 1);
runOn(sim2)(2 * 1440);
check('the world runs on', sim2.time.day > sim.time.day);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
