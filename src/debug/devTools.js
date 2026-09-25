/**
 * Development helpers (loaded only by `npm run dev`, never in production builds).
 * Useful from the browser console for testing and balancing:
 *
 *   dev.newGame('Sasha', 'en')   start a new game immediately
 *   dev.sim                      the running Simulation
 *   dev.pump(60)                 advance the game loop N frames (works even in a hidden tab)
 *   dev.hold('d', 30)            hold a key for N frames
 *   dev.press('e')               tap a key
 *   dev.teleport(tx, ty)         move the player to a tile
 *   dev.skip(minutes)            fast-forward the clock
 *
 * F9 opens the debug panel (stats, performance, world controls) — see DebugPanel.js.
 */
import { setLanguage } from '../i18n/i18n.js';
import { Simulation } from '../core/Simulation.js';
import { installDebugPanel } from './DebugPanel.js';
import { eduTools } from './eduTools.js';
import { buildTools } from './buildTools.js';
import { contractTools } from './contractTools.js';
import { transportTools } from './transportTools.js';

const KEYS = {
  w: ['w', 'KeyW', 87], a: ['a', 'KeyA', 65], s: ['s', 'KeyS', 83], d: ['d', 'KeyD', 68],
  e: ['e', 'KeyE', 69], f: ['f', 'KeyF', 70], i: ['i', 'KeyI', 73], c: ['c', 'KeyC', 67], j: ['j', 'KeyJ', 74], m: ['m', 'KeyM', 77], q: ['q', 'KeyQ', 81], k: ['k', 'KeyK', 75], b: ['b', 'KeyB', 66],
  esc: ['Escape', 'Escape', 27], 1: ['1', 'Digit1', 49], 2: ['2', 'Digit2', 50], 3: ['3', 'Digit3', 51], 4: ['4', 'Digit4', 52], 5: ['5', 'Digit5', 53],
};

// (Before the game has booted — or while it's being torn down — there's no scene manager yet.)
const scene = () => window.game?.scene?.getScene?.('Game') ?? null;

const dev = {
  get sim() {
    return scene()?.sim;
  },
  get scene() {
    return scene();
  },
  pump(frames = 1, dt = 16.67) {
    const loop = window.game.loop;
    let t = loop.lastTime || performance.now();
    for (let i = 0; i < frames; i++) {
      t += dt;
      loop.step(t);
    }
    return loop.frame;
  },
  key(k, type) {
    const [key, code, keyCode] = KEYS[k];
    window.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true }));
  },
  hold(k, frames = 30) {
    dev.key(k, 'keydown');
    dev.pump(frames);
    dev.key(k, 'keyup');
    dev.pump(2);
    const s = scene();
    return s ? [Math.round(s.player.x), Math.round(s.player.y)] : null;
  },
  press(k) {
    dev.key(k, 'keydown');
    dev.key(k, 'keyup');
    dev.pump(3);
  },
  newGame(name = 'Sasha', lang = 'en') {
    setLanguage(lang);
    const boot = window.game.scene.getScene('Boot');
    boot.title?.destroy();
    boot.scene.start('Game', { sim: Simulation.newGame(name) });
    dev.pump(5);
    return dev.sim;
  },
  teleport(tx, ty) {
    const s = scene();
    const c = s.sim.world.tileCenter(tx, ty);
    s.player.teleport(c.x, c.y);
    dev.pump(2);
  },
  give(item, qty = 1) {
    dev.sim.inventory.add(item, qty, { force: true });
    dev.pump(1);
  },
  money(amount = 100) {
    dev.sim.state.player.money += amount;
  },
  levelTo(level) {
    const sim = dev.sim;
    while (sim.state.player.level < level) sim.progression.addXp(sim.progression.xpForNext() - sim.state.player.xp + 1);
    dev.pump(1);
    return sim.state.player.level;
  },

  /** Fast-forward using the real game mechanism (NPCs keep living their lives). */
  skip(minutes) {
    const sim = dev.sim;
    sim.time.fastForward(minutes, 1000, () => {});
    for (let i = 0; i < 2000 && sim.time.isSkipping(); i++) dev.pump(1, 50);
    dev.pump(2);
    return sim.time.clockString();
  },
};

dev.edu = eduTools(dev);
dev.bt = buildTools(dev);
dev.ct = contractTools(dev);
dev.tr = transportTools(dev);
window.dev = dev;
installDebugPanel(dev);
