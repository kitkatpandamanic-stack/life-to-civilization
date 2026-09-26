/**
 * FestivalSystem — the valley's festivals: a day each season when the village gathers on the square.
 *
 *   spring fair · midsummer · harvest festival · midwinter
 *
 * It's physical: during the festival's hours most villagers who aren't working or asleep spend
 * their free time on the square (HabitSystem gives them the 'festival' plan) — you can see the
 * crowd, and people standing near each other talk, so friendships grow. You can join in: being
 * on the square while it's on is noticed (a little reputation, and the people there warm to you);
 * giving to the festival (at the notice board) goes to the village fund and is remembered.
 * Afterwards everyone who went is in a better mood.
 *
 *   state.festivals = { current: null | { id, day, until, attended, donated, crowd: [ids] }, history: [] }
 */
import { AREAS } from '../data/villageLayout.js';
import { hashStr } from '../core/rng.js';
import { BALANCE } from '../config/balance.js';

export const FESTIVALS = {
  spring_fair: { season: 'spring', day: 8, hours: [15, 21], mood: 6, icon: '🌸' },
  midsummer: { season: 'summer', day: 7, hours: [17, 23], mood: 6, icon: '☀️' },
  harvest: { season: 'autumn', day: 10, hours: [14, 21], mood: 8, icon: '🌾' },
  midwinter: { season: 'winter', day: 6, hours: [16, 22], mood: 8, icon: '🕯️' },
};
export const FESTIVAL = {
  goChance: 0.75, // villagers free that evening who go
  attendRep: 1, // you were there
  attendRel: 2, // …the people there warm to you
  donateStep: 50, // a gift
  repPerGift: 1,
  maxGiftRep: 4,
  plazaReach: 12, // tiles from the square's centre that count as "there"
};

export class FestivalSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.festivals ??= { current: null, history: [] };
    sim.bus.on('time:hour', () => this.hourly());
    sim.bus.on('time:minute', (m) => m % 10 === 0 && this.S.current && this.watch());
  }

  get S() {
    return this.sim.state.festivals;
  }

  /** Today's festival, if there is one. */
  today() {
    const T = this.sim.time;
    return Object.entries(FESTIVALS).find(([, f]) => f.season === T.season && f.day === T.dayOfSeason)?.[0] || null;
  }
  /** On right now (the festival's hours)? */
  active() {
    const c = this.S.current;
    return !!c && c.day === this.sim.time.day && this.sim.time.total < c.until;
  }
  /** The next festival: which, and in how many days. */
  next() {
    const T = this.sim.time;
    const seasons = ['spring', 'summer', 'autumn', 'winter'];
    const perSeason = BALANCE.time.daysPerSeason;
    let best = null;
    for (const [id, f] of Object.entries(FESTIVALS)) {
      let d = (seasons.indexOf(f.season) - seasons.indexOf(T.season)) * perSeason + (f.day - T.dayOfSeason);
      // (Today's, once it's over, is next year's.)
      if (d < 0 || (d === 0 && !this.active() && (T.hourFloat >= f.hours[1] || (this.S.history[0]?.id === id && this.S.history[0]?.day === T.day)))) d += 4 * perSeason;
      if (!best || d < best.days) best = { id, days: d };
    }
    return best;
  }

  centre() {
    const P = AREAS.plaza;
    return { tx: Math.round((P.x1 + P.x2) / 2), ty: Math.round((P.y1 + P.y2) / 2) };
  }

  hourly() {
    const sim = this.sim;
    const h = Math.floor(sim.time.hourFloat);
    const id = this.today();
    if (id && !this.S.current && h >= FESTIVALS[id].hours[0] && h < FESTIVALS[id].hours[1]) this.begin(id);
    const c = this.S.current;
    if (c && (sim.time.total >= c.until || c.day !== sim.time.day)) this.finish();
  }

  begin(id) {
    const sim = this.sim;
    const f = FESTIVALS[id];
    const until = sim.time.total - (sim.time.hourFloat % 24) * 60 + f.hours[1] * 60;
    this.S.current = { id, day: sim.time.day, until: Math.round(until), attended: false, donated: 0, crowd: [] };
    // Everyone's plans for the evening change: to the square!
    for (const n of sim.state.npcs) if (n.plan) n.plan.until = 0;
    sim.chronicle('chronicle.festival', { festival: id });
    sim.toast('toast.festival_on', { festival: id, hour: f.hours[1] }, 'event');
    sim.bus.emit('festival:started', id);
  }

  /** A villager's evening plan during a festival (HabitSystem): most go to the square. */
  pull(npc) {
    if (!this.active() || npc.age < 4 || npc.task?.type === 'sleep') return null;
    if (hashStr(`${npc.id}_${this.sim.time.day}`, this.sim.state.seed | 0) > FESTIVAL.goChance) return null;
    return { kind: 'festival', until: this.S.current.until, why: 'festival' };
  }

  /** Every ten minutes: who's on the square (you among them?). */
  watch() {
    if (!this.active()) return;
    const sim = this.sim;
    const c = this.S.current;
    const ctr = this.centre();
    const near = (x, y) => Math.abs(Math.floor(x / 32) - ctr.tx) + Math.abs(Math.floor(y / 32) - ctr.ty) <= FESTIVAL.plazaReach;
    const p = sim.state.player;
    if (near(p.x, p.y) && !c.attended) {
      c.attended = true;
      sim.toast('toast.festival_joined', { festival: c.id }, 'good');
    }
    for (const n of sim.state.npcs) if (!n.inside && near(n.x, n.y) && n.task?.plan === 'festival' && !c.crowd.includes(n.id)) c.crowd.push(n.id);
  }

  /** Give to the festival: the village fund has it, and people remember. */
  canDonate(amount = FESTIVAL.donateStep) {
    if (!this.active()) return { ok: false, reason: 'no_festival' };
    if (this.sim.state.player.money < amount) return { ok: false, reason: 'no_money', params: { money: amount } };
    return { ok: true };
  }
  donate(amount = FESTIVAL.donateStep) {
    const chk = this.canDonate(amount);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const p = sim.state.player;
    p.money -= amount;
    p.donated = (p.donated || 0) + amount;
    sim.state.village.treasury = (sim.state.village.treasury || 0) + amount;
    const c = this.S.current;
    const before = Math.min(FESTIVAL.maxGiftRep, Math.floor(c.donated / FESTIVAL.donateStep) * FESTIVAL.repPerGift);
    c.donated += amount;
    const after = Math.min(FESTIVAL.maxGiftRep, Math.floor(c.donated / FESTIVAL.donateStep) * FESTIVAL.repPerGift);
    if (after > before) sim.progression.addReputation(after - before);
    sim.toast('toast.festival_gift', { money: amount, festival: c.id }, 'good');
    return { ok: true };
  }

  finish() {
    const sim = this.sim;
    const c = this.S.current;
    if (!c) return;
    const f = FESTIVALS[c.id];
    for (const id of c.crowd) {
      const n = sim.npcs.byId(id);
      if (!n) continue;
      n.mood = Math.min(100, (n.mood ?? 60) + f.mood);
      if (c.attended) sim.social.addRel(n, FESTIVAL.attendRel);
    }
    if (c.attended) sim.progression.addReputation(FESTIVAL.attendRep);
    if (c.donated > 0) sim.chronicle('chronicle.festival_donated', { festival: c.id, money: c.donated });
    this.S.history.unshift({ id: c.id, day: c.day, crowd: c.crowd.length, attended: c.attended, donated: c.donated });
    this.S.history.length = Math.min(this.S.history.length, 12);
    sim.toast('toast.festival_over', { festival: c.id, n: c.crowd.length }, 'info');
    this.S.current = null;
    sim.bus.emit('festival:ended', c.id);
  }
}
