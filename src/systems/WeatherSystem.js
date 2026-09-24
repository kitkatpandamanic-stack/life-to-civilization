/**
 * WeatherSystem — picks weather from seasonal probabilities.
 * Weather affects movement, work speed, energy, crop growth and NPC behaviour.
 */
import { rand } from '../core/rng.js';

/** Probability tables per season. */
export const WEATHER_TABLE = {
  spring: { sunny: 0.42, cloudy: 0.25, rain: 0.26, fog: 0.07 },
  summer: { sunny: 0.6, cloudy: 0.18, rain: 0.13, storm: 0.09 },
  autumn: { sunny: 0.28, cloudy: 0.3, rain: 0.3, fog: 0.12 },
  winter: { snow: 0.42, cloudy: 0.33, sunny: 0.18, fog: 0.07 },
};

export const WEATHER_ICONS = { sunny: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️', fog: '🌫️' };

/** Gameplay effect of each weather type. */
const WEATHER_MODS = {
  sunny: { move: 1, action: 1, energy: 1, cropGrowth: 1 },
  cloudy: { move: 1, action: 1, energy: 1, cropGrowth: 1 },
  fog: { move: 0.97, action: 1, energy: 1, cropGrowth: 1 },
  rain: { move: 0.95, action: 0.92, energy: 1.1, cropGrowth: 1.2 },
  storm: { move: 0.85, action: 0.8, energy: 1.25, cropGrowth: 1.1 },
  snow: { move: 0.88, action: 0.9, energy: 1.15, cropGrowth: 0 },
};

export class WeatherSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:minute', () => this.tick());
    sim.bus.on('time:season', () => this.change());
  }

  get type() {
    return this.sim.state.weather.type;
  }

  mods() {
    return WEATHER_MODS[this.type] || WEATHER_MODS.sunny;
  }

  /** Bad weather keeps villagers indoors during their free time. */
  isBad() {
    return this.type === 'rain' || this.type === 'storm' || this.type === 'snow';
  }

  tick() {
    if (this.sim.time.total >= this.sim.state.weather.untilMinute) this.change();
  }

  change(forced) {
    const season = this.sim.time.season;
    let type = forced || this.sim.events?.forcedWeather() || weightedPick(WEATHER_TABLE[season]);
    if (season === 'winter' && type === 'rain') type = 'snow';
    if (season !== 'winter' && type === 'snow') type = 'rain';
    const w = this.sim.state.weather;
    const changed = w.type !== type;
    w.type = type;
    w.untilMinute = this.sim.time.total + rand.int(3, 9) * 60;
    if (changed) this.sim.bus.emit('weather:changed', type);
  }
}

function weightedPick(table) {
  const entries = Object.entries(table);
  let r = rand.float() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[0][0];
}
