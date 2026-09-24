/**
 * EventSystem — things that happen to the whole village.
 *
 * Events change the numbers other systems run on (a drought really lowers farm
 * output, which really makes bread dearer a few days later, which really makes
 * people leave), and some physically hit the world through DisasterSystem —
 * floods soak the riverside houses, storms tear off roofs, a trade fair brings
 * a buyer to the plaza. Everything that happened is kept in the village history.
 *
 *   state.events = { active: [{ id, untilDay, data }], lastCaravanDay, history, lastDay: { id: day } }
 */
import { BALANCE } from '../config/balance.js';
import { EVENT_DEFS } from '../data/events.js';
import { rand } from '../core/rng.js';

export { EVENT_DEFS };

export class EventSystem {
  constructor(sim) {
    this.sim = sim;
    const s = sim.state.events;
    s.history ??= [];
    s.lastDay ??= {};
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

  /** Extra price for one item (a trade fair). */
  itemPrice(item) {
    let m = 1;
    for (const e of this.active) if (e.data?.item === item && e.data.boost) m *= e.data.boost;
    return m;
  }

  forcedWeather() {
    for (const e of this.active) if (EVENT_DEFS[e.id]?.weather) return EVENT_DEFS[e.id].weather;
    return null;
  }

  isActive(id) {
    return this.active.some((e) => e.id === id);
  }

  // ------------------------------------------------------------------ conditions

  quarryWorking() {
    return this.sim.state.npcs.some((n) => n.employer === 'quarry' || n.owns === 'quarry');
  }

  roomForMore() {
    return (this.sim.growth?.attractiveness() ?? 0) > -1;
  }

  canHappen(id, def) {
    const day = this.sim.time.day;
    if (def.seasons && !def.seasons.includes(this.sim.time.season)) return false;
    if (this.isActive(id)) return false;
    if (def.cooldown && day - (this.sim.state.events.lastDay[id] ?? -999) < def.cooldown) return false;
    if (def.needs && !this[def.needs]()) return false;
    // Not two weather events at once.
    if (def.weather && this.forcedWeather()) return false;
    return true;
  }

  // ------------------------------------------------------------------ daily

  onDay(day) {
    const s = this.sim.state.events;
    // End expired events (and let them set off what follows — heavy rain can become a flood).
    const ended = s.active.filter((e) => e.untilDay <= day);
    s.active = s.active.filter((e) => e.untilDay > day);
    for (const e of ended) {
      this.sim.bus.emit('event:ended', e.id);
      const follow = EVENT_DEFS[e.id]?.follow;
      if (follow) {
        for (const [next, p] of Object.entries(follow)) if (this.canHappen(next, EVENT_DEFS[next]) && rand.chance(p)) this.start(next);
      }
    }

    // Weekly merchant caravan.
    if (day - s.lastCaravanDay >= BALANCE.economy.caravanEveryDays) {
      s.lastCaravanDay = day;
      this.sim.economy.caravan();
      this.sim.chronicle('chronicle.caravan', {});
      this.sim.toast('toast.event.caravan', {}, 'event');
    }

    // Maybe start a new event.
    if (!rand.chance(BALANCE.events.dailyChance)) return;
    const options = Object.entries(EVENT_DEFS).filter(([id, d]) => this.canHappen(id, d));
    if (!options.length) return;
    const id = rand.weighted(options.map(([k, d]) => [k, d.weight ?? 1]));
    this.start(id);
  }

  start(id, def = EVENT_DEFS[id]) {
    const day = this.sim.time.day;
    const e = { id, untilDay: day + rand.int(def.days[0], def.days[1]), data: {} };
    this.sim.state.events.active.push(e);
    this.sim.state.events.lastDay[id] = day;
    if (def.weather) this.sim.weather.change(def.weather);
    // Physical consequences (damage, a buyer at the plaza, newcomers…) fill in e.data.
    if (def.disaster) this.sim.disasters?.strike(def.disaster, e);
    const params = { ...(e.data.params || {}) };
    this.sim.chronicle(`chronicle.event.${id}`, params);
    this.sim.toast(`toast.event.${id}`, params, 'event');
    const h = this.sim.state.events.history;
    h.push({ id, day, params });
    if (h.length > 300) h.shift();
    // Everyone who lives through a hard time remembers it.
    if (['drought', 'flood', 'blight', 'sickness', 'mine_collapse', 'poor_harvest'].includes(id)) {
      for (const n of this.sim.state.npcs) if (n.age >= 10 && rand.chance(0.5)) this.sim.memory.remember(n, 'lived_through', { params: { event: id } });
    }
    this.sim.bus.emit('event:started', id);
    return e;
  }
}
