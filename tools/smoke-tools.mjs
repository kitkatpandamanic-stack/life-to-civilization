// Headless test for the tool logic behind the hotbar: your tools in order, taking one
// in hand (it's the one used for its kind of work), and the events the screen uses to
// show "+3 Wood" / "−2 Stone" — and that the tool in hand survives save / load.
// Usage: node tools/smoke-tools.mjs
import { Simulation } from '../src/core/Simulation.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const sim = Simulation.newGame('T', 1717);
const inv = sim.inventory;
inv.add('axe', 1);
inv.add('pickaxe', 1);
inv.add('hoe', 1);
const kinds = inv.tools().map((s) => s.id);
check('your tools come in hotbar order (axes, pickaxe, hammer, …, hoe)', kinds.indexOf('axe') < kinds.indexOf('pickaxe') && kinds.indexOf('pickaxe') < kinds.indexOf('hoe'), kinds.join(','));
check('the better axe is used when nothing is in hand', inv.bestTool('axe').id === 'axe');
const worn = inv.slots.find((s) => s.id === 'worn_axe');
check('you can take a tool in hand', inv.hold(worn) && inv.held() === worn);
check('…and it is the one used for its kind of work', inv.bestTool('axe') === worn);
check('…other kinds still use their own tool', inv.bestTool('pickaxe').id === 'pickaxe');
inv.hold(inv.slots.find((s) => s.id === 'hoe'));
check('only one tool is in hand at a time', inv.slots.filter((s) => s.held).length === 1 && inv.held().id === 'hoe');

const deltas = [];
sim.bus.on('inventory:delta', (d) => deltas.push(d));
inv.add('wood', 3);
inv.remove('wood', 2);
check('pockets report what came and went (for the floating numbers)', deltas.some((d) => d.id === 'wood' && d.qty === 3) && deltas.some((d) => d.id === 'wood' && d.qty === -2), JSON.stringify(deltas));

const sim2 = new Simulation(JSON.parse(JSON.stringify(sim.state)));
check('the tool in your hand is still there after loading', sim2.inventory.held()?.id === 'hoe');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll tool checks passed.');
process.exit(failures ? 1 : 0);
