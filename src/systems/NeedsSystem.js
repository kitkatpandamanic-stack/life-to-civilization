/**
 * NeedsSystem — the player's hunger (satiety), energy, health and comfort.
 *
 * Designed to create choices, not punishment:
 *   • low satiety or energy → you work slower
 *   • starving → health slowly drops
 *   • energy hits zero → you pass out for a few hours
 *   • health hits zero → the village healer patches you up (for a fee)
 */
import { BALANCE } from '../config/balance.js';
import { Mod } from './Modifiers.js';

const N = BALANCE.needs;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class NeedsSystem {
  constructor(sim) {
    this.sim = sim;
    this.warned = { hunger: false, energy: false, starving: false };
    this.emergency = false;
    sim.bus.on('time:minute', () => this.onMinute());
  }

  get p() {
    return this.sim.state.player;
  }

  onMinute() {
    const p = this.p;
    if (p.away) return; // on the road: fed from the expedition's supplies
    const perMin = 1 / 60;
    const season = this.sim.time.season;
    const weather = this.sim.weather.mods();
    if (p.sleeping) {
      const comfortMult = 0.75 + p.comfort / 200;
      p.energy += N.sleepEnergyPerHour * comfortMult * perMin;
      p.hunger -= N.hungerDrainSleepingPerHour * perMin;
    } else {
      const seasonMult = season === 'winter' ? N.winterHungerMult : 1;
      p.hunger -= N.hungerDrainPerHour * seasonMult * this.sim.events.modifier('hunger') * perMin;
      const hungerMult = p.hunger < N.lowThreshold ? 1.5 : 1;
      p.energy -= N.energyDrainPerHour * Mod.energyDrainMult(p) * hungerMult * weather.energy * perMin;
    }

    if (p.hunger <= 0) p.health -= N.starvingHealthLossPerHour * perMin;
    else if (p.energy <= 5 && !p.sleeping) p.health -= N.exhaustedHealthLossPerHour * perMin;
    else if (p.hunger > 50 && p.energy > 30) p.health += N.healthRegenPerHour * perMin;

    p.hunger = clamp(p.hunger, 0, 100);
    p.energy = clamp(p.energy, 0, 100);
    p.health = clamp(p.health, 0, 100);

    this.checkWarnings();

    if (this.emergency || this.sim.time.isSkipping()) return;
    if (p.health <= 0) {
      this.emergency = true;
      this.sim.bus.emit('player:collapse');
    } else if (p.energy <= 0 && !p.sleeping) {
      this.emergency = true;
      this.sim.bus.emit('player:passout');
    }
  }

  checkWarnings() {
    const p = this.p;
    const w = this.warned;
    if (p.hunger < N.lowThreshold && !w.hunger) {
      w.hunger = true;
      this.sim.toast('toast.hungry', {}, 'warn');
    } else if (p.hunger > N.lowThreshold + 10) w.hunger = false;
    if (p.hunger <= 0 && !w.starving) {
      w.starving = true;
      this.sim.toast('toast.starving', {}, 'danger');
    } else if (p.hunger > 5) w.starving = false;
    if (p.energy < N.lowThreshold - 5 && !w.energy && !p.sleeping) {
      w.energy = true;
      this.sim.toast('toast.tired', {}, 'warn');
    } else if (p.energy > N.lowThreshold + 10) w.energy = false;
  }

  /** 1.0 normally; lower when hungry or tired. Slows down physical actions. */
  productivity() {
    const p = this.p;
    let m = 1;
    if (p.hunger < N.lowThreshold) m *= N.lowProductivity;
    if (p.energy < N.lowThreshold) m *= N.lowProductivity;
    return m;
  }

  applyFood(food) {
    const p = this.p;
    if (food.hunger) p.hunger = clamp(p.hunger + food.hunger, 0, 100);
    if (food.energy) p.energy = clamp(p.energy + food.energy, 0, 100);
    if (food.health) p.health = clamp(p.health + food.health, 0, 100);
    this.sim.bus.emit('player:changed');
  }

  spendEnergy(amount) {
    this.p.energy = clamp(this.p.energy - amount, 0, 100);
  }

  /** Called when an emergency (pass out / collapse) has been handled by the scene. */
  resolveEmergency() {
    this.emergency = false;
  }
}
