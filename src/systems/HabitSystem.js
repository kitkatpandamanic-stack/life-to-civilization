/**
 * HabitSystem — every villager's personal routine.
 *
 * Habits emerge from who the villager is: personality traits, profession,
 * age, family, wealth and where they live. A sociable, well-off young woodcutter
 * ends up at the tavern most evenings; a careful father of two goes straight
 * home; the old scholar reads in the hall; whoever lives near the river fishes.
 *
 *   npc.habits = {
 *     chronotype: 'early' | 'normal' | 'late',
 *     sociability: 0…1,
 *     hobby: 'fishing' | 'walking' | 'reading' | 'gardening' | 'cards' | 'gossip' | 'whittling' | 'playing',
 *     spot: { tx, ty } — their favourite place for it,
 *     tavernNight, marketDay, familyDay: weekday (0–6) or null,
 *     lunchOut: 0…1 — how much they like eating lunch at the tavern,
 *   }
 *   npc.plan = { kind, until, ... } — what they decided to do with their free time
 *   npc.visits = { buildingId: count } — favourite shops emerge from habit
 *
 * Habits are re-evaluated each season, so they change when life does
 * (a new job, a new family, more money).
 */
import { BALANCE } from '../config/balance.js';
import { AREAS } from '../data/villageLayout.js';
import { hashStr, rand } from '../core/rng.js';

const HOBBIES = ['fishing', 'walking', 'reading', 'gardening', 'cards', 'gossip', 'whittling', 'playing', 'hunting'];
const PLAN_MINUTES = {
  build: [90, 180],
  hobby: [70, 150],
  tavern: [60, 130],
  home: [90, 240],
  friends: [45, 100],
  family: [60, 120],
  plaza: [30, 70],
  market: [40, 80],
};
export const REST_DAY = 6; // Sunday

export class HabitSystem {
  constructor(sim) {
    this.sim = sim;
    this.waterSpots = null;
    for (const npc of sim.state.npcs) if (!npc.habits) this.derive(npc, true);
    sim.bus.on('time:season', () => {
      for (const npc of sim.state.npcs) this.derive(npc);
    });
    sim.bus.on('time:day', () => {
      if (sim.time.weekday === 0) this.weeklyDecay();
    });
  }

  // ------------------------------------------------------------------ places

  /** Walkable tiles on the bank of the river or the lake (computed once). */
  getWaterSpots() {
    if (this.waterSpots) return this.waterSpots;
    const w = this.sim.world;
    const out = [];
    for (let y = 2; y < w.H - 2; y += 1) {
      for (let x = 2; x < w.W - 2; x += 1) {
        if (w.staticBlocked[w.idx(x, y)] || w.isWater(x, y)) continue;
        if (w.isWater(x + 1, y) || w.isWater(x - 1, y) || w.isWater(x, y + 1) || w.isWater(x, y - 1)) out.push({ tx: x, ty: y });
      }
    }
    this.waterSpots = out;
    return out;
  }

  homeTile(npc) {
    const b = npc.homeId && this.sim.world.buildings[npc.homeId];
    return b ? { tx: b.door.tx, ty: b.door.ty } : { tx: AREAS.plaza.x1 + 3, ty: AREAS.plaza.y1 + 3 };
  }

  nearestWater(from, maxDist = 45) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const s of this.getWaterSpots()) {
      const d = (s.tx - from.tx) ** 2 + (s.ty - from.ty) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { spot: best, dist: Math.sqrt(bestD) } : null;
  }

  // ------------------------------------------------------------------ deriving habits

  derive(npc, initial = false) {
    const seed = this.sim.state.seed;
    const r = (k) => hashStr(`${npc.id}:${k}`, seed);
    const has = (tr) => npc.traits.includes(tr);
    const old = npc.habits;
    const h = { ...(old || {}) };
    const adult = npc.age >= 18;
    const child = npc.age < 16;
    const household = this.sim.npcs.residentsOf(npc.homeId || '');
    const youngKids = household.some((o) => o !== npc && o.age < 12) && adult;

    // Early birds and night owls.
    if (npc.age >= 60 || has('hard_worker')) h.chronotype = 'early';
    else if (has('lazy') || (npc.age < 28 && has('risk_taker'))) h.chronotype = 'late';
    else h.chronotype = r('chrono') < 0.2 ? 'early' : r('chrono') > 0.78 ? 'late' : 'normal';

    let soc = 0.45 + (r('soc') - 0.5) * 0.3;
    if (has('friendly')) soc += 0.3;
    if (has('aggressive')) soc -= 0.2;
    if (has('scholar')) soc -= 0.1;
    if (has('natural_leader')) soc += 0.1;
    if (has('careful')) soc -= 0.05;
    h.sociability = Math.max(0.05, Math.min(1, Math.round(soc * 100) / 100));

    // Hobby: weights from personality, work, age and where they live.
    const water = this.nearestWater(this.homeTile(npc));
    const nearWater = water && water.dist < 22 ? 1 : 0;
    const w = {};
    if (child) {
      w.playing = 3;
      w.fishing = npc.age >= 8 ? 0.5 + nearWater : 0;
    } else {
      w.fishing = 0.8 + nearWater * 1.5 + (has('careful') ? 0.5 : 0) + (npc.age >= 55 ? 0.6 : 0);
      w.walking = 0.7 + (has('scholar') ? 0.5 : 0) + (1 - h.sociability);
      w.reading = (has('scholar') ? 3 : 0) + (npc.age >= 60 ? 1 : 0) + 0.15;
      w.gardening = npc.homeId ? 0.5 + (['farmer', 'farmhand'].includes(npc.occupation) ? 1 : 0) + (npc.age >= 55 ? 1 : 0) : 0;
      w.cards = adult ? (has('friendly') ? 0.8 : 0) + (has('risk_taker') ? 2 : 0) + h.sociability + (npc.money > 40 ? 0.4 : -0.6) : 0;
      w.gossip = h.sociability * 2 + (has('friendly') ? 0.8 : 0);
      w.whittling = (has('hard_worker') ? 0.5 : 0) + (['woodcutter', 'lumber_foreman'].includes(npc.occupation) ? 1.5 : 0) + (has('careful') ? 0.3 : 0);
      w.hunting = adult ? (has('risk_taker') ? 1.2 : 0) + (has('aggressive') ? 0.6 : 0) + (['woodcutter', 'lumber_foreman'].includes(npc.occupation) ? 0.5 : 0) : 0;
    }
    const prevHobby = old?.hobby;
    // Stick with an existing hobby unless something else is clearly more attractive.
    if (prevHobby && w[prevHobby] > 0) w[prevHobby] *= 1.8;
    h.hobby = this.pickDeterministic(w, r(`hobby${this.sim.time.year}`));
    h.spot = this.spotFor(npc, h.hobby, water);

    // Weekly routine.
    h.tavernNight = adult && h.sociability > 0.45 ? Math.floor(r('tavern') * 7) : null;
    h.marketDay = adult ? (r('market') < 0.6 ? 5 : Math.floor(r('market2') * 7)) : null;
    const relativesElsewhere = this.sim.family ? this.sim.family.relatives(npc).some((o) => o.homeId && o.homeId !== npc.homeId) : false;
    h.familyDay = relativesElsewhere ? REST_DAY : null;
    h.lunchOut = Math.max(0, Math.min(1, h.sociability * 0.7 + (npc.money > 60 ? 0.3 : 0) - (youngKids ? 0.2 : 0)));
    h.youngKids = youngKids;
    npc.habits = h;
    npc.visits ??= {};
    if (!initial && prevHobby && prevHobby !== h.hobby) {
      this.sim.memory.remember(npc, 'took_up_hobby', { params: { hobby: h.hobby } });
    }
    return h;
  }

  pickDeterministic(weights, r) {
    const entries = Object.entries(weights).filter(([, v]) => v > 0);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let x = r * total;
    for (const [k, v] of entries) {
      x -= v;
      if (x < 0) return k;
    }
    return entries[0]?.[0] || 'walking';
  }

  /** Their personal favourite place for a hobby. */
  spotFor(npc, hobby, water = null) {
    const home = this.homeTile(npc);
    const P = AREAS.plaza;
    const r = hashStr(`${npc.id}:spot`, this.sim.state.seed);
    switch (hobby) {
      case 'fishing': {
        const wtr = water || this.nearestWater(home, 60);
        if (!wtr) return { tx: P.x1 + 2, ty: P.y2 };
        // Not everybody at the same tile: pick among the few nearest bank tiles.
        const spots = this.getWaterSpots()
          .map((s) => ({ s, d: (s.tx - wtr.spot.tx) ** 2 + (s.ty - wtr.spot.ty) ** 2 }))
          .filter((e) => e.d < 64)
          .map((e) => e.s);
        return spots[Math.floor(r * spots.length)] || wtr.spot;
      }
      case 'hunting':
      case 'walking': {
        const tree = this.sim.resources.findNearest('tree', home.tx, home.ty, 30);
        return tree ? { tx: tree.tx, ty: tree.ty + 1 } : { tx: home.tx + 6, ty: home.ty + 4 };
      }
      case 'gossip':
      case 'playing':
        return { tx: P.x1 + Math.floor(r * (P.x2 - P.x1)), ty: P.y1 + Math.floor(((r * 7) % 1) * (P.y2 - P.y1)) };
      case 'gardening':
      case 'whittling':
        return { tx: home.tx + (r < 0.5 ? -2 : 2), ty: home.ty + 1 };
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ daily life

  wakeHour(npc, occ) {
    let h = occ.wake;
    const c = npc.habits?.chronotype;
    if (c === 'early') h -= 0.5;
    const free = this.isRestDay(npc, occ) || !occ.workplace;
    if (c === 'late' && free) h += 1;
    return h;
  }

  sleepHour(npc, occ) {
    const c = npc.habits?.chronotype;
    const h = occ.sleep + (c === 'early' ? -1 : c === 'late' ? 1 : 0);
    return Math.min(24, h);
  }

  isRestDay(npc, occ) {
    return occ.restDay !== undefined && this.sim.time.weekday === occ.restDay;
  }

  /**
   * What to do with free time right now. The plan sticks for a while
   * (an evening at the tavern, an afternoon of fishing) instead of changing every few minutes.
   */
  currentPlan(npc) {
    const now = this.sim.time.total;
    if (npc.plan && now < npc.plan.until) return npc.plan;
    npc.plan = this.newPlan(npc);
    return npc.plan;
  }

  newPlan(npc) {
    const sim = this.sim;
    const h = npc.habits || this.derive(npc);
    const now = sim.time.total;
    const wd = sim.time.weekday;
    const hour = sim.time.hourFloat;
    const adult = npc.age >= 18;
    const lonely = (npc.social ?? 60) < 35;
    // Looking for a partner (GoalSystem): out and about more, where people meet.
    const looking = npc.goal?.type === 'family' && !npc.kin?.spouse;
    const socialMult = (lonely ? 2 : 1) * (looking ? 1.6 : 1);
    const E = BALANCE.economy;
    const canTavern = adult && npc.money >= E.npcDrinkPrice * 2 && sim.economy.ofType('tavern').some((id) => sim.economy.isOpen(id)) && hour >= 17;
    const friend = sim.social.bestFriend(npc);
    const friendAway = friend && friend.homeId && friend.homeId !== npc.homeId && sim.social.npcRel(npc, friend) >= 25;
    const relatives = sim.family.relatives(npc).filter((o) => o.homeId && o.homeId !== npc.homeId);
    const w = {
      hobby: npc.energy > 35 ? 2 : 0.5,
      tavern: canTavern ? (h.sociability * 2 + (h.hobby === 'cards' ? 1.5 : 0) - (h.youngKids ? 1.2 : 0)) * socialMult * (wd === h.tavernNight ? 4 : 1) * (sim.npcs.isSaving(npc) ? 0.3 : 1) : 0,
      home: 0.8 + (1 - h.sociability) * 2 + (h.youngKids ? 1.5 : 0) + (npc.kin?.spouse ? 0.6 : 0) + (npc.energy < 45 ? 2 : 0),
      friends: friendAway ? h.sociability * 1.5 * socialMult : 0,
      family: relatives.length ? (wd === h.familyDay ? 4 : 0.4) * socialMult : 0,
      plaza: (0.5 + h.sociability) * socialMult,
      market: wd === h.marketDay && hour < 18 ? 3 : 0,
    };
    if (!npc.homeId) w.home = 0;
    if (npc.age < 16) {
      w.tavern = 0;
      w.market = 0;
    }
    // Building your own house (or helping family and friends raise theirs).
    const own = sim.growth?.projectOf(npc);
    const helping = !own && npc.age >= 16 ? sim.growth?.helpable(npc) : null;
    const site = own || helping;
    const labourer = npc.dayLabour?.day === sim.time.day && site?.id === npc.dayLabour.site;
    if (site && sim.construction.maxLabor(site) > site.labor + 0.5 && npc.energy > 35 && !sim.weather.isBad()) w.build = own ? 4 : labourer ? 12 : 1.2;
    const kind = rand.weighted(Object.entries(w));
    const [a, b] = PLAN_MINUTES[kind];
    const plan = { kind, until: now + rand.int(a, b) };
    if (kind === 'build') plan.site = site.id;
    if (kind === 'friends') plan.who = friend.id;
    if (kind === 'family') plan.who = rand.pick(relatives).id;
    if (kind === 'hobby') plan.hobby = h.hobby;
    return plan;
  }

  /** A villager went into a shop or the tavern: favourite places emerge from habit. */
  visited(npc, buildingId) {
    npc.visits ??= {};
    npc.visits[buildingId] = Math.min(99, (npc.visits[buildingId] || 0) + 1);
  }

  /** Where do they usually go? (For dialogue and the Inspect panel.) */
  favouritePlace(npc) {
    let best = null;
    let n = 2;
    for (const [id, c] of Object.entries(npc.visits || {})) {
      // The grocery run is a chore, not a favourite place.
      if (c > n && id !== npc.homeId && id !== 'store') {
        n = c;
        best = id;
      }
    }
    return best;
  }

  /** Favourite places slowly fade so habits can change. */
  weeklyDecay() {
    for (const npc of this.sim.state.npcs) {
      for (const id of Object.keys(npc.visits || {})) {
        npc.visits[id] = Math.floor(npc.visits[id] * 0.8);
        if (!npc.visits[id]) delete npc.visits[id];
      }
    }
  }
}

export { HOBBIES };
