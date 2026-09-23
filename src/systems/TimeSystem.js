/**
 * TimeSystem — the game clock and calendar.
 *
 * Time is stored as a single number: minutes since the game began
 * (state.time.totalMinutes). Days, hours, seasons and years are derived from it.
 *
 * Emits on the simulation bus:
 *   time:minute  — every game minute (needs, NPC decisions)
 *   time:hour    — every full hour (payload: hour 0–23)
 *   time:day     — at midnight (payload: new day index)
 *   time:season  — when a new season begins (payload: season id)
 *
 * Fast-forward (sleeping, working a shift) advances many minutes quickly
 * while still running every system minute by minute.
 */
import { BALANCE } from '../config/balance.js';

const TB = BALANCE.time;

export class TimeSystem {
  constructor(sim) {
    this.sim = sim;
    this.acc = 0;
    this.skip = null;
  }

  get total() {
    return this.sim.state.time.totalMinutes;
  }
  get day() {
    return Math.floor(this.total / 1440);
  }
  get minuteOfDay() {
    return this.total % 1440;
  }
  get hour() {
    return Math.floor(this.minuteOfDay / 60);
  }
  get minute() {
    return this.minuteOfDay % 60;
  }
  get hourFloat() {
    return this.minuteOfDay / 60;
  }
  get seasonIndex() {
    return Math.floor(this.day / TB.daysPerSeason) % TB.seasons.length;
  }
  get season() {
    return TB.seasons[this.seasonIndex];
  }
  get dayOfSeason() {
    return (this.day % TB.daysPerSeason) + 1;
  }
  get year() {
    return Math.floor(this.day / (TB.daysPerSeason * TB.seasons.length)) + 1;
  }
  get weekday() {
    return this.day % TB.daysPerWeek;
  }

  isSkipping() {
    return !!this.skip;
  }

  /** Minutes from now until the given hour (today, or tomorrow if already past). */
  minutesUntilHour(h) {
    const target = h * 60;
    const now = this.minuteOfDay;
    return target > now ? target - now : 1440 - now + target;
  }

  /** Advance `minutes` of game time over `realMs` of real time, then call onDone. */
  fastForward(minutes, realMs, onDone) {
    this.skip = { remaining: Math.max(1, Math.round(minutes)), perMs: minutes / Math.max(1, realMs), onDone };
  }

  update(deltaMs) {
    let minutes;
    if (this.skip) {
      minutes = Math.min(this.skip.remaining, Math.max(1, Math.round(this.skip.perMs * deltaMs)));
      this.skip.remaining -= minutes;
    } else {
      this.acc += deltaMs;
      minutes = Math.floor(this.acc / TB.realMsPerGameMinute);
      this.acc -= minutes * TB.realMsPerGameMinute;
    }
    minutes = Math.min(minutes, TB.maxMinutesPerFrame);
    for (let i = 0; i < minutes; i++) this.advanceMinute();

    if (this.skip && this.skip.remaining <= 0) {
      const done = this.skip.onDone;
      this.skip = null;
      this.acc = 0;
      done?.();
    }
  }

  advanceMinute() {
    const bus = this.sim.bus;
    const prevDay = this.day;
    const prevSeason = this.seasonIndex;
    this.sim.state.time.totalMinutes++;
    bus.emit('time:minute', this.total);
    if (this.minute === 0) bus.emit('time:hour', this.hour);
    if (this.day !== prevDay) {
      bus.emit('time:day', this.day);
      if (this.seasonIndex !== prevSeason) bus.emit('time:season', this.season);
    }
  }

  clockString() {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }

  /** How dark it is: 0 = full day, 1 = deepest night. Used by lighting and NPC behaviour. */
  darkness() {
    const h = this.hourFloat;
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 21) return (h - 17.5) / 3.5;
    if (h >= 21 || h < 4.5) return 1;
    return 1 - (h - 4.5) / 2.5; // dawn 4:30–7:00
  }
}
