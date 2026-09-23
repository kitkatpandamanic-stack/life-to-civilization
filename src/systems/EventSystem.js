/**
 * EventSystem — random world events that change how other systems behave.
 * Events don't just show a message: they apply modifiers that the economy,
 * weather and needs systems read (e.g. a drought really lowers farm output,
 * which really makes bread more expensive a few days later).
 */
import { BALANCE } from '../config/balance.js';
import { rand } from '../core/rng.js';

export const EVENT_DEFS = {
  good_harvest: { seasons: ['summer', 'autumn'], days: [3, 4], mods: { farm_output: 1.6 } },
  drought: { seasons: ['summer'], days: [3, 5], mods: { farm_output: 0.4 }, weather: 'sunny' },
  heavy_rain: { seasons: ['spring', 'autumn'], days: [1, 2], mods: { farm_output: 1.2 }, weather: 'rain' },
  storm_front: { seasons: ['summer', 'autumn'], days: [1, 1], mods: {}, weather: 'storm' },
  cold_snap: { seasons: ['winter'], days: [2, 4], mods: { wood_demand: 2, hunger: 1.15 }, weather: 'snow' },
  berry_year: { seasons: ['spring', 'summer'], days: [3, 5], mods: { berries: 1.8 } },
};

export class EventSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', (day) => this.onDay(day));
  }

  get active() {
    return this.sim.state.events.active;
  }

  /** Product of the given modifier across all active events (1 = no effect). */
  modifier(key) {
    let m = 1;
    for (const e of this.active) {
      const v = EVENT_DEFS[e.id]?.mods?.[key];
      if (v !== undefined) m *= v;
    }
    return m;
  }

  forcedWeather() {
    for (const e of this.active) if (EVENT_DEFS[e.id]?.weather) return EVENT_DEFS[e.id].weather;
    return null;
  }

  isActive(id) {
    return this.active.some((e) => e.id === id);
  }

  onDay(day) {
    const s = this.sim.state.events;
    // End expired events.
    const ended = s.active.filter((e) => e.untilDay <= day);
    s.active = s.active.filter((e) => e.untilDay > day);
    for (const e of ended) this.sim.bus.emit('event:ended', e.id);

    // Weekly merchant caravan.
    if (day - s.lastCaravanDay >= BALANCE.economy.caravanEveryDays) {
      s.lastCaravanDay = day;
      this.sim.economy.caravan();
      this.sim.chronicle('chronicle.caravan', {});
      this.sim.toast('toast.event.caravan', {}, 'event');
    }

    // Maybe start a new event.
    if (!rand.chance(BALANCE.events.dailyChance)) return;
    const season = this.sim.time.season;
    const options = Object.entries(EVENT_DEFS).filter(([id, d]) => d.seasons.includes(season) && !this.isActive(id));
    if (!options.length) return;
    const [id, def] = rand.pick(options);
    this.start(id, def);
  }

  start(id, def = EVENT_DEFS[id]) {
    this.sim.state.events.active.push({ id, untilDay: this.sim.time.day + rand.int(def.days[0], def.days[1]) });
    if (def.weather) this.sim.weather.change(def.weather);
    this.sim.chronicle(`chronicle.event.${id}`, {});
    this.sim.toast(`toast.event.${id}`, {}, 'event');
    this.sim.bus.emit('event:started', id);
  }
}
