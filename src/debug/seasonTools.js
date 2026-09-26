/**
 * Seasons debug (dev.ss.* in the console, and F9 buttons): jump to a season, snow, the flood, firewood.
 */
import { BALANCE } from '../config/balance.js';

export function seasonTools(dev) {
  const sim = () => dev.sim;
  const tools = {
    /** Jump to the first morning of a season (the clock moves on; the weather follows). */
    go: (season = 'winter') => {
      const S = sim();
      const TB = BALANCE.time;
      const i = TB.seasons.indexOf(season);
      if (i < 0) return 'spring | summer | autumn | winter';
      const perYear = TB.daysPerSeason * TB.seasons.length;
      let day = Math.floor(S.time.day / perYear) * perYear + i * TB.daysPerSeason;
      if (day <= S.time.day) day += perYear;
      S.state.time.totalMinutes = day * 1440 + 8 * 60;
      S.bus.emit('time:day', S.time.day);
      S.bus.emit('time:season', S.time.season);
      S.weather.change();
      return tools.status();
    },
    snow: (depth = 0.8) => {
      sim().seasons.S.snow = depth;
      sim().seasons.S.cleared = 0;
      return tools.status();
    },
    clear: () => (sim().seasons.clear(1), tools.status()),
    flood: (days = 4) => (sim().seasons.flood(days), tools.status()),
    recede: () => (sim().seasons.recede(), tools.status()),
    /** Firewood into your home storage. */
    wood: (n = 20) => (sim().home.store('wood', n, { force: true }), tools.status()),
    heat: () => {
      sim().seasons.S.warmDay = -99;
      sim().seasons.heatHome();
      return tools.status();
    },
    status: () => JSON.stringify({ day: sim().time.day, ...sim().seasons.summary(), floodPlan: sim().seasons.floodPlan(), wood: sim().home.storageCount('wood'), cold: sim().home.cold() }),
  };
  return tools;
}
