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
 *    ├── logistics    LogisticsSystem (shipments travel the roads: porters, carts, carters' firms)
 *    ├── economy      EconomySystem
 *    ├── resources    ResourceSystem
 *    ├── social       SocialSystem (friendship, trust, respect, conflict)
 *    ├── memory       MemorySystem (what villagers remember; word of mouth)
 *    ├── jobs         JobSystem
 *    ├── npcs         NPCSystem
 *    ├── family       FamilySystem (kinship, courtship, marriage, births, aging, death, inheritance)
 *    ├── property     PropertySystem (ownership, values, rent, the housing market, decay)
 *    ├── enterprise   EnterpriseSystem (villager businesses: prices, wages, staff, startups, closures)
 *    ├── growth       GrowthSystem (villagers build, newcomers arrive, people leave, districts form)
 *    ├── disasters    DisasterSystem (floods, storms, fires and the repairs afterwards)
 *    ├── rumors       RumorSystem (what people say — true, bent, or out of date)
 *    ├── habits       HabitSystem (personal routines, hobbies, favourite places)
 *    ├── dialogue     DialogueSystem (what villagers talk about, from their real lives)
 *    ├── lineage      LineageSystem (your marriage, children, old age and heirs)
 *    ├── history      HistorySystem (the village's firsts and milestones, kept for good)
 *    ├── exploration  ExplorationSystem (regions beyond the valley, expeditions, fog of war)
 *    ├── tech         TechSystem (know-how, school, library, mentors, knowledge across generations)
 *    ├── contracts    ContractSystem (supply, craft, build and haul contracts from real needs)
 *    ├── ambitions    AmbitionSystem (long-term goals you choose)
 *    ├── holdings     HoldingsSystem (village businesses you own, stakes and loans)
 *    ├── finance      FinanceSystem (village taxes; borrowing from the village fund)
 *    ├── goals        GoalSystem (what each villager is after, and why — and what it makes them do)
 *    ├── settlements  SettlementSystem (other places beyond the valley, caravans, your trade journeys, roads)
 *    ├── legacy       LegacySystem (your family's deeds and renown, passed down the generations)
 *    ├── civic        CivicSystem (headman and council, elections, policies, institutions, the valley's status)
 *    ├── actions      PlayerActionSystem
 *    ├── home         HomeSystem (tier, storage chest, comfort)
 *    ├── crafting     CraftingSystem (recipes at stations)
 *    ├── land         LandSystem (plots, prices, ownership)
 *    ├── nature       NatureSystem (forests grow and thin, finite ore, fish and game populations)
 *    ├── construction ConstructionSystem (sites, buildings, roads, home upgrades)
 *    ├── farming      FarmingSystem (till, plant, water, grow, harvest)
 *    ├── workers      WorkerSystem (your employees: hiring, pay, assignments)
 *    └── businesses   BusinessSystem (your workshop: production, customers, books)
 *
 * Nothing in here knows about Phaser. The scene renders the simulation and
 * forwards player input to it — so the simulation could run headless, be
 * tested, or be rendered differently in the future.
 */
import { EventBus } from './EventBus.js';
import { createNewState, normalizeState } from './GameState.js';
import { HomeSystem } from '../systems/HomeSystem.js';
import { CraftingSystem } from '../systems/CraftingSystem.js';
import { LandSystem } from '../systems/LandSystem.js';
import { ConstructionSystem } from '../systems/ConstructionSystem.js';
import { FarmingSystem } from '../systems/FarmingSystem.js';
import { WorkerSystem } from '../systems/WorkerSystem.js';
import { BusinessSystem } from '../systems/BusinessSystem.js';
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
import { MemorySystem } from '../systems/MemorySystem.js';
import { FamilySystem } from '../systems/FamilySystem.js';
import { HabitSystem } from '../systems/HabitSystem.js';
import { DialogueSystem } from '../systems/DialogueSystem.js';
import { PropertySystem } from '../systems/PropertySystem.js';
import { EnterpriseSystem } from '../systems/EnterpriseSystem.js';
import { NatureSystem } from '../systems/NatureSystem.js';
import { GrowthSystem } from '../systems/GrowthSystem.js';
import { LogisticsSystem } from '../systems/LogisticsSystem.js';
import { DisasterSystem } from '../systems/DisasterSystem.js';
import { RumorSystem } from '../systems/RumorSystem.js';
import { LineageSystem } from '../systems/LineageSystem.js';
import { HistorySystem } from '../systems/HistorySystem.js';
import { ExplorationSystem } from '../systems/ExplorationSystem.js';
import { TechSystem } from '../systems/TechSystem.js';
import { ContractSystem } from '../systems/ContractSystem.js';
import { AmbitionSystem } from '../systems/AmbitionSystem.js';
import { HoldingsSystem } from '../systems/HoldingsSystem.js';
import { FinanceSystem } from '../systems/FinanceSystem.js';
import { GoalSystem } from '../systems/GoalSystem.js';
import { SettlementSystem } from '../systems/SettlementSystem.js';
import { LegacySystem } from '../systems/LegacySystem.js';
import { CivicSystem } from '../systems/CivicSystem.js';
import { rand } from './rng.js';

const MAX_CHRONICLE = 200;

export class Simulation {
  constructor(state, world = null) {
    this.state = normalizeState(state);
    // Simulation randomness is seeded and saved, so a save replays the same way.
    rand.setState(state.rngState ?? Math.imul(state.seed | 0, 2654435761));
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
    this.logistics = new LogisticsSystem(this);
    this.resources = new ResourceSystem(this);
    this.social = new SocialSystem(this);
    this.memory = new MemorySystem(this);
    this.jobs = new JobSystem(this);
    this.npcs = new NPCSystem(this);
    this.family = new FamilySystem(this);
    this.actions = new PlayerActionSystem(this);
    this.home = new HomeSystem(this);
    this.crafting = new CraftingSystem(this);
    this.land = new LandSystem(this);
    this.construction = new ConstructionSystem(this);
    this.nature = new NatureSystem(this);
    this.farming = new FarmingSystem(this);
    this.workers = new WorkerSystem(this);
    this.businesses = new BusinessSystem(this);
    this.property = new PropertySystem(this);
    this.enterprise = new EnterpriseSystem(this);
    this.growth = new GrowthSystem(this);
    this.disasters = new DisasterSystem(this);
    this.rumors = new RumorSystem(this);
    this.habits = new HabitSystem(this);
    this.dialogue = new DialogueSystem(this);
    this.lineage = new LineageSystem(this);
    this.history = new HistorySystem(this);
    this.exploration = new ExplorationSystem(this);
    this.tech = new TechSystem(this);
    this.contracts = new ContractSystem(this);
    this.ambitions = new AmbitionSystem(this);
    this.holdings = new HoldingsSystem(this);
    this.finance = new FinanceSystem(this);
    this.goals = new GoalSystem(this);
    this.settlements = new SettlementSystem(this);
    this.legacy = new LegacySystem(this);
    this.civic = new CivicSystem(this); // last: it weighs up everyone and everything
    this.jobs.ensureOpenings();
    this.bus.on('time:day', () => this.onNewDay());
  }

  static newGame(playerName, seed = Math.floor(Math.random() * 1e9), { gender = 'm' } = {}) {
    const world = generateWorld(seed);
    const state = createNewState({ playerName, seed, world });
    state.player.gender = gender;
    if (gender === 'f') state.player.look = { ...state.player.look, hairStyle: 'long', dress: true };
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
    this.state.chronicleSeq = (this.state.chronicleSeq || 0) + 1;
    const entry = { day: this.time.day, key, params, n: this.state.chronicleSeq };
    this.state.chronicle.push(entry);
    if (this.state.chronicle.length > MAX_CHRONICLE) this.state.chronicle.shift();
    this.bus.emit('chronicle', entry);
  }

  destroy() {
    this.bus.clear();
  }
}
