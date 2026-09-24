// Headless test for world events and disasters: floods and storms damage buildings,
// fires spread or are fought, owners repair, a trade fair raises prices, sickness spreads.
// Usage: node tools/smoke-events.mjs
import { Simulation } from '../src/core/Simulation.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const runOn = (sim) => (minutes) => {
  const end = sim.time.total + minutes;
  while (sim.time.total < end) sim.update(400);
};

// 1. A flood damages riverside buildings, and their owners repair them.
{
  const sim = Simulation.newGame('T', 101);
  const run = runOn(sim);
  const hit = sim.disasters.nearWater(3).map((b) => b.id);
  sim.events.start('flood');
  const damaged = hit.filter((id) => sim.property.rec(id)?.condition < 100);
  check('a flood damages riverside buildings', damaged.length >= 1, damaged.join(', '));
  run(2 * 1440);
  const repairs = sim.construction.list.filter((c) => c.kind === 'repair');
  check('owners start repairs', repairs.length >= 1, repairs.map((c) => c.target).join(', '));
  run(30 * 1440);
  const done = repairs.filter((c) => c.status === 'done');
  check('repairs get finished (materials bought, work done)', done.length >= 1, `${done.length}/${repairs.length}`);
}

// 2. A fire: villagers come running and put it out.
{
  const sim = Simulation.newGame('T', 102);
  const run = runOn(sim);
  run(9 * 60); // mid-morning, everyone's up
  const f = sim.disasters.ignite('house_3', 30);
  run(30);
  const crew = sim.state.npcs.filter((n) => n.task?.type === 'firefight');
  check('villagers run to fight the fire', crew.length >= 2, `${crew.length} running`);
  run(6 * 60);
  const still = sim.disasters.fireAt('house_3');
  const rec = sim.property.rec('house_3');
  check('the fire is put out or burns down', !still, `condition ${Math.round(rec.condition)}`);
  check('the fire left its mark', rec.condition < 100 || rec.damage?.kind === 'fire');
  check('the fire is in the chronicle', sim.state.chronicle.some((e) => e.key === 'chronicle.fire_started'));
}

// 3. A fire nobody fights burns the building down and people lose their home.
{
  const sim = Simulation.newGame('T', 103);
  const run = runOn(sim);
  run(2 * 60); // 09:00? no — night: everyone asleep indoors, nobody comes
  sim.time.fastForward = sim.time.fastForward; // (no-op; keep deterministic)
  const residents = sim.npcs.residentsOf('house_5').map((n) => n.id);
  // Keep villagers asleep: start it at 1 a.m.
  const f = sim.disasters.ignite('house_5', 90);
  for (const n of sim.state.npcs) n.health = Math.min(n.health, 30); // too weak to fight
  run(8 * 60);
  const rec = sim.property.rec('house_5');
  check('an unfought fire destroys the building', rec.ruined, `condition ${Math.round(rec.condition)}`);
  check('the residents were rehoused', residents.every((id) => sim.npcs.byId(id)?.homeId !== 'house_5'), residents.map((id) => sim.npcs.byId(id)?.homeId).join(','));
}

// 4. A trade fair raises the price of the wanted goods.
{
  const sim = Simulation.newGame('T', 104);
  const e = sim.events.start('trade_fair');
  const item = e.data.item;
  sim.inventory.add(item, 1, { force: true });
  const price = sim.economy.playerSellPrice('store', item);
  check('a trade fair buyer pays well', price > 0 && sim.events.itemPrice(item) > 1, `${item} sells for ${price}`);
}

// 5. Sickness spreads while it lasts.
{
  const sim = Simulation.newGame('T', 105);
  const run = runOn(sim);
  sim.events.start('sickness');
  run(6 * 1440);
  const ill = sim.state.npcs.filter((n) => n.memories.some((m) => m.k === 'was_sick'));
  check('people fall ill during an epidemic', ill.length >= 2, `${ill.length} fell ill`);
}

// 6. Rumors travel, and bend in the telling.
{
  const sim = Simulation.newGame('T', 106);
  const run = runOn(sim);
  const vein = sim.nature.discoverVein('iron');
  const r = sim.state.rumors.list.find((x) => x.kind === 'deposit');
  check('a discovery starts a rumor', !!r && !!vein);
  run(21 * 1440);
  const knowers = sim.state.npcs.filter((n) => (n.rumors || []).some((id) => sim.rumors.get(id)?.kind === 'deposit'));
  check('the rumor spreads through the village', knowers.length >= 3, `${knowers.length} know`);
  let twisted = null;
  for (let i = 0; i < 40 && !twisted; i++) twisted = sim.rumors.distort(r);
  check('retellings can change the story', !!twisted && twisted.truth === false);
  const topic = sim.dialogue.pick(knowers[0] || sim.state.npcs[0], 'news');
  check('villagers pass on news when asked', !!topic.key, topic.key);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
