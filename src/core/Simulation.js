/**
 * Simulation — owns the central game state and every game system.
 *
 *   Simulation
 *    ├── world        (terrain, buildings, pathfinding grid)
 *    ├── time         TimeSystem
 *    ├── weather      WeatherSystem
 *    ├── events       EventSystem
 *    ├── inventory    InventorySystem
 *    ├── progression  ProgressionSystem
 *    ├── needs        NeedsSystem
 *    ├── economy      EconomySystem
 *    ├── resources    ResourceSystem
 *    ├── social       SocialSystem
 *    ├── jobs         JobSystem
 *    ├── npcs         NPCSystem
 *    └── actions      PlayerActionSystem
 *
 * Nothing in here knows about Phaser. The scene renders the simulation and
 * forwards player input to it — so the simulation could run headless, be
 * tested, or be rendered differently in the future.
 */
import { EventBus } from './EventBus.js';
import { createNewState } from './GameState.js';
import { generateWorld } from '../world/WorldGenerator.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { WeatherSystem } from '../systems/WeatherSystem.js';
import { EventSystem } from '../systems/EventSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { ProgressionSystem } from '../systems/ProgressionSystem.js';
import { NeedsSystem } from '../systems/NeedsSystem.js';
import { EconomySystem } from '../systems/EconomySystem.js';
import { ResourceSystem } from '../systems/ResourceSystem.js';
import { SocialSystem } from '../systems/SocialSystem.js';
import { JobSystem } from '../systems/JobSystem.js';
import { NPCSystem } from '../systems/NPCSystem.js';
import { PlayerActionSystem } from '../systems/PlayerActionSystem.js';

const MAX_CHRONICLE = 200;

export class Simulation {
  constructor(state, world = null) {
    this.state = state;
    this.world = world || generateWorld(state.seed);
    for (const id in state.objects) delete state.objects[id].reservedBy;
    this.world.rebuildDynamicBlocking(state.objects);
    this.bus = new EventBus();

    this.time = new TimeSystem(this);
    this.events = new EventSystem(this);
    this.weather = new WeatherSystem(this);
    this.inventory = new InventorySystem(this);
    this.progression = new ProgressionSystem(this);
    this.needs = new NeedsSystem(this);
    this.economy = new EconomySystem(this);
    this.resources = new ResourceSystem(this);
    this.social = new SocialSystem(this);
    this.jobs = new JobSystem(this);
    this.npcs = new NPCSystem(this);
    this.actions = new PlayerActionSystem(this);

    this.jobs.ensureOpenings();
    this.bus.on('time:day', () => this.onNewDay());
  }

  static newGame(playerName, seed = Math.floor(Math.random() * 1e9)) {
    const world = generateWorld(seed);
    const state = createNewState({ playerName, seed, world });
    const sim = new Simulation(state, world);
    sim.chronicle('chronicle.player_arrived', { name: playerName });
    return sim;
  }

  get player() {
    return this.state.player;
  }

  /** Called every frame by the game scene (unless the game is paused). */
  update(deltaMs) {
    this.time.update(deltaMs);
    this.npcs.update(deltaMs);
  }

  /** Rent for the shack is collected once a week. */
  onNewDay() {
    const p = this.state.player;
    if (this.time.day >= p.rent.nextDueDay) {
      p.rent.nextDueDay += 7;
      const due = p.rent.amount + p.rent.debt;
      if (p.money >= due) {
        p.money -= due;
        p.rent.debt = 0;
        this.toast('toast.rent_paid', { money: due }, 'info');
      } else {
        const paid = Math.max(0, Math.floor(p.money));
        p.money -= paid;
        p.rent.debt = due - paid;
        this.progression.addReputation(-3);
        this.toast('toast.rent_late', { money: p.rent.debt }, 'danger');
      }
      this.bus.emit('player:changed');
    }
  }

  toast(key, params = {}, type = 'info') {
    this.bus.emit('toast', { key, params, type });
  }

  /** Record a story entry in the village chronicle. Params are ids, resolved to names at display time. */
  chronicle(key, params = {}) {
    const entry = { day: this.time.day, key, params };
    this.state.chronicle.push(entry);
    if (this.state.chronicle.length > MAX_CHRONICLE) this.state.chronicle.shift();
    this.bus.emit('chronicle', entry);
  }

  destroy() {
    this.bus.clear();
  }
}
