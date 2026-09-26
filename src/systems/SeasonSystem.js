/**
 * SeasonSystem — the year you can feel: each season changes how the valley works.
 *
 *   winter  your fire burns firewood from your home storage every evening (a fireplace 2, a stove 1);
 *           your horses (a pack horse, the horses of a cart or wagon) can't graze: each eats a day's fodder
 *           from your storage (wheat, flour, cabbages, potatoes, apples) — without it they weaken;
 *           with none, the fire's out and the nights are cold. Villagers buy firewood too — a household
 *           that can't find any is cold, unhappy, and asks around for wood.
 *           Snow lies deeper each snowy hour: wheels bog down and walking off the roads is slow. The roads
 *           are cleared bit by bit (the village's public works, and anyone who takes a snow-clearing job).
 *   spring  the thaw: snow melts into mud for a few days (wheels off the road are slow). Most years
 *           the river rises once — the clay pits on the banks go under for a few days, then come back
 *           full of fresh clay.
 *   summer  long dry days: the best time to haul and to build.
 *   autumn  the harvest rush: farms pay more and take on more hands (JOBS[].rush); stock up on wood.
 *
 * No dice: when the river rises is worked out from the world's seed and the year, so this system never
 * changes what else happens in a game (the same save plays the same way).
 */
import { hashStr } from '../core/rng.js';
import { BALANCE } from '../config/balance.js';
import { EQUIPMENT } from '../data/transport.js';

export const SEASONS = {
  // winter: firewood
  burn: { fireplace: 2, stove: 1 }, // wood a winter evening, from your home storage
  heatHour: 16, // the fire's lit (and fed) at this hour; last night's fire keeps you warm until then
  coldMood: 3, // a villager in a cold home: mood lost each winter day
  fodder: ['wheat', 'flour', 'cabbage', 'potato', 'apple'], // what your horses eat in winter (1 a day each), cheapest first
  hungryWear: 8, // a horse with nothing to eat: condition lost a day (a weak animal is a slow one)
  // snow
  snowPerHour: 0.035, // depth added each hour it snows (0..1)
  meltWinter: 0.004, // melting per dry winter hour (sunny: ×3)
  meltThaw: 0.03, // per hour once winter's over
  clearPerDay: 0.2, // the village clears this share of its roads each day (public works)
  clearPerJob: 0.35, // a snow-clearing job done
  walkOffroad: 0.22, // walking through deep snow: at most this much slower
  walkRoad: 0.12, // on an uncleared road
  wheelsOffroad: 0.45, // wheels in deep snow off the road
  wheelsRoad: 0.35, // wheels on an uncleared road
  // spring: the thaw and the river
  mudDays: 4, // mud after the snow's gone
  mudWheels: 0.8, // wheels off the road in the thaw mud
  floodChance: 0.65, // most springs the river rises
  floodDays: [3, 5],
  floodTint: 0x86a8d6,
  // autumn: stock up
  woodWarnDays: 5, // the last days of autumn: "get your firewood in"
};

export class SeasonSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.seasons ??= { snow: 0, cleared: 0, warmDay: -99, burned: 0, mudUntil: -1, flood: null, floodYear: -1, cold: [], stats: {} };
    this.S = sim.state.seasons;
    this.S.cold ??= [];
    this.S.stats ??= {};
    sim.bus.on('time:hour', (h) => this.hourly(h));
    sim.bus.on('time:day', () => this.daily());
    sim.bus.on('time:season', (s) => this.onSeason(s));
    sim.bus.on('job:completed', (e) => {
      if (e?.jobId === 'snow_clearing') this.clear(SEASONS.clearPerJob);
    });
  }

  // ---------------------------------------------------------------- winter: firewood

  /** Your fire: what it burns (0 = no fire at home). */
  burnRate() {
    const furn = this.sim.home?.tier?.furniture?.map((f) => f.type) || [];
    if (furn.includes('fireplace')) return SEASONS.burn.fireplace;
    if (furn.includes('stove')) return SEASONS.burn.stove;
    return 0;
  }

  /** Is your fire lit (fed tonight, or still warm from last night)? */
  heated() {
    const T = this.sim.time;
    return this.S.warmDay === T.day || (this.S.warmDay === T.day - 1 && T.hourFloat < SEASONS.heatHour);
  }

  /** Evening: feed the fire from your home storage. */
  heatHome() {
    const sim = this.sim;
    const need = this.burnRate();
    if (!need || sim.time.season !== 'winter' || this.S.warmDay === sim.time.day) return;
    if (sim.home.storageCount('wood') >= need) {
      sim.home.take('wood', need);
      this.S.warmDay = sim.time.day;
      this.S.burned += need;
      sim.home.changed?.();
      if (!this.S.toldBurn) {
        this.S.toldBurn = true;
        sim.toast('toast.fire_lit', { n: need, left: sim.home.storageCount('wood') }, 'info');
      }
    } else sim.toast('toast.no_firewood', { n: need }, 'warn');
  }

  /** Nights of firewood you have in store. */
  woodNights() {
    const need = this.burnRate();
    return need ? Math.floor(this.sim.home.storageCount('wood') / need) : Infinity;
  }

  /** Villagers: households that couldn't get firewood today (EconomySystem tells us). */
  setCold(homeIds) {
    this.S.cold = homeIds;
    for (const n of this.sim.state.npcs) if (n.homeId && homeIds.includes(n.homeId)) n.mood = Math.max(0, (n.mood ?? 60) - SEASONS.coldMood);
  }

  isCold(npc) {
    return this.sim.time.season === 'winter' && !!npc.homeId && this.S.cold.includes(npc.homeId);
  }

  // ---------------------------------------------------------------- snow

  /** Snow on the ground (0..1). */
  snow() {
    return this.S.snow;
  }

  clear(share) {
    this.S.cleared = Math.min(1, this.S.cleared + share);
  }

  /** Walking: how much the snow slows you (1 = not at all). */
  walkMult(onRoad) {
    const s = this.S.snow;
    if (s <= 0) return 1;
    return onRoad ? 1 - SEASONS.walkRoad * s * (1 - this.S.cleared) : 1 - SEASONS.walkOffroad * s;
  }

  /** Wheels (barrows, carts, wagons): snow, and the thaw mud in spring. */
  wheelMult(onRoad) {
    const s = this.S.snow;
    let m = 1;
    if (s > 0) m *= onRoad ? 1 - SEASONS.wheelsRoad * s * (1 - this.S.cleared) : 1 - SEASONS.wheelsOffroad * s;
    if (!onRoad && this.thaw()) m *= SEASONS.mudWheels;
    return m;
  }

  /** The spring thaw: mud for a few days after the snow's gone. */
  thaw() {
    return this.sim.time.day <= this.S.mudUntil;
  }

  // ---------------------------------------------------------------- spring: the river rises

  /** This year's flood (worked out from the seed and the year): { day of spring } or null. */
  floodPlan(year = this.sim.time.year) {
    const seed = this.sim.state.seed | 0;
    if (hashStr(`flood_${year}`, seed) >= SEASONS.floodChance) return null;
    const [a, b] = SEASONS.floodDays;
    return { day: 2 + Math.floor(hashStr(`flood_day_${year}`, seed) * 7), days: a + Math.floor(hashStr(`flood_len_${year}`, seed) * (b - a + 1)) };
  }

  flooding() {
    return !!this.S.flood && this.sim.time.day < this.S.flood.until;
  }

  /** Is this clay pit under water? */
  underWater(obj) {
    return !!obj?.floodedUntil && obj.floodedUntil > this.sim.time.day;
  }

  flood(days) {
    const sim = this.sim;
    const until = sim.time.day + days;
    const pits = sim.industry?.clayPits() || [];
    for (const o of pits) {
      o.floodedUntil = until;
      delete o.reservedBy;
      sim.bus.emit('object:changed', o);
    }
    this.S.flood = { day: sim.time.day, until, pits: pits.length };
    this.S.floodYear = sim.time.year;
    this.S.stats.floods = (this.S.stats.floods || 0) + 1;
    sim.toast('toast.river_up', { days }, 'warn');
    sim.chronicle('chronicle.river_up', {});
    sim.bus.emit('seasons:flood', this.S.flood);
  }

  /** The water's gone down: every pit is full of fresh clay. */
  recede() {
    const sim = this.sim;
    let n = 0;
    for (const o of sim.industry?.clayPits() || []) {
      if (!o.floodedUntil) continue;
      delete o.floodedUntil;
      if (o.state !== 'full') o.state = 'full';
      if (o.reserve !== undefined) o.reserve = Math.max(o.reserve, 6);
      n++;
      sim.bus.emit('object:changed', o);
    }
    this.S.flood = null;
    if (n) sim.toast('toast.river_down', { n }, 'good');
  }

  // ---------------------------------------------------------------- the clock

  hourly(h) {
    const sim = this.sim;
    const S = this.S;
    const w = sim.weather.type;
    const season = sim.time.season;
    // Snow falls, lies and melts.
    if (w === 'snow') {
      S.snow = Math.min(1, S.snow + SEASONS.snowPerHour);
      S.cleared *= 0.9; // fresh snow on the roads
    } else if (S.snow > 0) {
      const melt = season === 'winter' ? SEASONS.meltWinter * (w === 'sunny' ? 3 : 1) : SEASONS.meltThaw;
      S.snow = Math.max(0, S.snow - melt);
      if (S.snow === 0 && season !== 'winter') {
        S.mudUntil = sim.time.day + SEASONS.mudDays;
        S.cleared = 0;
      }
    }
    if (h === SEASONS.heatHour) this.heatHome();
    // Spring: the river rises (on the planned day, or earlier with heavy rain after it's due).
    if (season === 'spring' && !S.flood && S.floodYear !== sim.time.year && h >= 6 && h <= 18) {
      const plan = this.floodPlan();
      if (plan && sim.time.dayOfSeason >= plan.day) this.flood(plan.days);
    }
  }

  // ---------------------------------------------------------------- winter: the horses

  /** Your animals (pack horses, the horses of carts and wagons). */
  animals() {
    const E = this.sim.equipment;
    return E ? E.mine().filter((e) => EQUIPMENT[e.type]?.kind === 'animal') : [];
  }

  /** Fodder in your storage (days' worth, for all your animals). */
  fodderDays() {
    const n = this.animals().length;
    if (!n) return Infinity;
    const have = SEASONS.fodder.reduce((s, i) => s + this.sim.home.storageCount(i), 0);
    return Math.floor(have / n);
  }

  /** A winter morning: each animal eats a day's fodder from your storage — or goes hungry and weakens. */
  feedAnimals() {
    const sim = this.sim;
    let hungry = 0;
    for (const a of this.animals()) {
      const item = SEASONS.fodder.find((i) => sim.home.storageCount(i) > 0);
      if (item) {
        sim.home.take(item, 1);
        this.S.fed = (this.S.fed || 0) + 1;
      } else {
        a.condition = Math.max(5, a.condition - SEASONS.hungryWear);
        hungry++;
      }
    }
    if (hungry) {
      sim.toast('toast.animals_hungry', { n: hungry }, 'warn');
      sim.bus.emit('equipment:changed');
    }
    return hungry;
  }

  daily() {
    const S = this.S;
    const sim = this.sim;
    if (sim.time.season === 'winter') this.feedAnimals();
    if (S.flood && sim.time.day >= S.flood.until) this.recede();
    if (S.snow > 0) this.clear(SEASONS.clearPerDay); // the village's own people clear the roads
    if (sim.time.season !== 'winter' && S.cold.length) S.cold = [];
  }

  onSeason(season) {
    const sim = this.sim;
    if (season === 'winter') {
      this.S.toldBurn = false;
      const need = this.burnRate();
      if (need) sim.toast('toast.winter_fire', { n: need, nights: this.woodNights() }, this.woodNights() < 7 ? 'warn' : 'info');
    }
    if (season === 'autumn') sim.toast('toast.harvest_rush', {}, 'info');
    if (season === 'spring' && this.S.snow > 0) this.S.mudUntil = sim.time.day + SEASONS.mudDays;
  }

  // ---------------------------------------------------------------- advice

  /** For the guide's "what next?" list: [{ id, prio, icon, params, go }]. */
  advice(AP) {
    const sim = this.sim;
    const T = sim.time;
    const out = [];
    const add = (id, prio, icon, params = {}, go = null) => out.push({ id, prio, icon, params, go });
    const need = this.burnRate();
    const perSeason = BALANCE.time.daysPerSeason;
    const lateAutumn = T.season === 'autumn' && T.dayOfSeason > perSeason - SEASONS.woodWarnDays;
    if (need && (lateAutumn || T.season === 'winter')) {
      const nights = this.woodNights();
      const left = T.season === 'winter' ? perSeason - T.dayOfSeason + 1 : perSeason;
      if (nights < Math.min(left, 7)) add('firewood', T.season === 'winter' && nights < 1 ? AP.danger - 10 : AP.materials + 2, '🔥', { n: need * Math.min(left, 7), have: sim.home.storageCount('wood') });
    }
    // Your horses: fodder for the winter.
    const herd = this.animals().length;
    if (herd && (lateAutumn || T.season === 'winter')) {
      const left = T.season === 'winter' ? perSeason - T.dayOfSeason + 1 : perSeason;
      const days = this.fodderDays();
      if (days < Math.min(left, 7)) add('fodder', T.season === 'winter' && days < 1 ? AP.danger - 12 : AP.materials + 1, '🐴', { n: herd * Math.min(left, 7), have: days * herd });
    }
    if (this.S.snow > 0.4 && this.S.cleared < 0.6) add('snow_roads', AP.opportunity + 2, '❄️', {}, 'jobboard');
    if (T.season === 'autumn' && sim.jobs?.rushOn?.()) add('harvest_rush', AP.opportunity + 3, '🌾', {}, 'jobboard');
    if (this.flooding()) add('river_up', AP.opportunity - 3, '🌊', { day: this.S.flood.until });
    return out;
  }

  /** For the HUD / journal: this season in a few words. */
  summary() {
    return { season: this.sim.time.season, snow: Math.round(this.S.snow * 100), cleared: Math.round(this.S.cleared * 100), heated: this.heated(), woodNights: this.woodNights(), flooding: this.flooding(), thaw: this.thaw(), cold: this.S.cold.length };
  }
}
