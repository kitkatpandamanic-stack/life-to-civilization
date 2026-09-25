/**
 * HousingSystem — how villagers choose where to live (building spec, Phase 6).
 *
 * A household looking at a home weighs, each by how much *they* care:
 *   afford   the rent against what they earn (or buying, against their savings)
 *   space    room for everyone (crowding hurts; a spare room is nice)
 *   commute  the walk to work, for everyone who works
 *   school   the walk to school, for children of school age
 *   quality  the house itself: its build and its repair
 *   centre   near the plaza and the bustle — or out where it's quiet (some like one, some the other)
 *   area     the street: the state of the houses around, shops and a well near, no smithy next door
 *   safety   a watch in the village; no ruins and empty shells nearby
 *   road     a road at the door
 *   kin      family close by
 *   own      a home of their own rather than a landlord's
 * How much each matters comes from the person (their traits, family, age, goal) with a personal
 * lean of its own — so no two households choose alike, and not everyone takes the cheapest.
 *
 * Every household thinks it over now and then (about once a month); if somewhere free is clearly
 * better — by more than the bother of moving and their attachment to where they are — they move,
 * and remember why. Their contentment with their home, and what they'd want, is kept for the UI:
 *   npc.housing = { sat: 0–100, wants: [keys], day }
 *   npc.homeSince = the day they moved in
 *
 * PropertySystem.options() ranks homes with this; LettingSystem asks it how a house of yours
 * compares; GoalSystem's settlers pick from its ranking.
 */
import { HOUSING_CHOICE as HC, HOUSING } from '../data/housing.js';
import { AREAS } from '../data/villageLayout.js';
import { hashStr } from '../core/rng.js';
import { BALANCE } from '../config/balance.js';

const DAYS_PER_YEAR = BALANCE.time.daysPerSeason * BALANCE.time.seasons.length;

const PARTS = ['afford', 'space', 'commute', 'school', 'quality', 'centre', 'area', 'safety', 'road', 'kin', 'own'];
/** Why they moved: the part that improved most. (centre → 'centre' or 'quiet', by what they like.) */
const WHY = { afford: 'cheaper', space: 'roomier', commute: 'near_work', school: 'near_school', quality: 'better_house', area: 'nicer_area', safety: 'safer', road: 'road', kin: 'near_family', own: 'own_home' };

export class HousingSystem {
  constructor(sim) {
    this.sim = sim;
    this.factCache = new Map();
    // Those who were living in the valley before: they've been in their homes for years.
    for (const n of sim.state.npcs) if (n.homeId) n.homeSince ??= -Math.round(hashStr(`${n.id}:home`) * DAYS_PER_YEAR * 6);
    sim.bus.on('time:day', () => sim.time.weekday === 1 && this.weekly());
  }

  get P() {
    return this.sim.property;
  }

  // ------------------------------------------------------------------ the home

  /** What a home is like (cached for the day): room, build, repair, where it is, its street, its safety. */
  facts(id) {
    const day = this.sim.time.day;
    const hit = this.factCache.get(id);
    if (hit && hit.day === day) return hit.f;
    const sim = this.sim;
    const P = this.P;
    const b = sim.world.buildings[id];
    if (!b) return null;
    const r = P.rec(id);
    const door = b.door;
    const near = (o, rad) => Math.abs(o.door.tx - door.tx) + Math.abs(o.door.ty - door.ty) <= rad;
    // The street: the repair of the houses around, shops and a well nearby, noisy trades next door.
    let conds = 0;
    let homes = 0;
    let services = 0;
    let industry = 0;
    let ruins = 0;
    for (const o of sim.world.buildingList) {
      if (o.id === id) continue;
      const or = P.rec(o.id);
      if (near(o, HC.neighbourhoodRadius)) {
        if (P.isHome(o.id) && or) {
          conds += or.condition;
          homes++;
        }
        if (or?.ruined || or?.abandoned) ruins++;
      }
      const type = P.type(o.id);
      if (HC.services.includes(type) && near(o, HC.servicesRadius)) services++;
      if (HC.industry.includes(type) && near(o, HC.industryRadius)) industry++;
    }
    for (const d of sim.world.decor) if (d.type === 'well' && Math.abs(d.tx - door.tx) + Math.abs(d.ty - door.ty) <= HC.servicesRadius) services++;
    const area = clamp((homes ? (conds / homes - 70) / 60 : 0) + Math.min(0.5, services * 0.15) - Math.min(0.8, industry * 0.3), -1, 1);
    const safety = clamp((sim.civic?.has('watch') ? 0.4 : 0) - Math.min(0.9, ruins * 0.3), -1, 1);
    const Pz = AREAS.plaza;
    const f = {
      cap: P.capacity(id),
      quality: sim.structures?.rec(id) ? sim.structures.quality(id) : 50,
      condition: r?.condition ?? 100,
      plazaDist: Math.abs(door.tx - (Pz.x1 + Pz.x2) / 2) + Math.abs(door.ty - (Pz.y1 + Pz.y2) / 2),
      road: P.nearRoad(b),
      door,
      area,
      services,
      safety,
    };
    this.factCache.set(id, { day, f });
    return f;
  }

  // ------------------------------------------------------------------ the household

  /** Who moves together: a couple and the children living with them. */
  household(npc) {
    return this.sim.letting.household(npc);
  }

  /** What they can pay a week (both earners of a couple). */
  budget(npc) {
    return this.P.householdBudget(npc);
  }

  /**
   * What matters to this person, and how much: from their traits, their family, their age and
   * their goal — plus a lean of their own (the same every time: it's who they are).
   */
  prefs(npc, members = this.household(npc)) {
    const T = (k) => npc.traits.includes(k);
    const j = (k, span) => (hashStr(`${npc.id}:${k}`) - 0.5) * span;
    const kids = members.filter((m) => m.age < 16).length;
    const pupils = members.filter((m) => m.age >= 6 && m.age < 17).length;
    const w = {
      afford: 1 + (T('careful') ? 0.5 : 0) + (T('greedy') ? 0.4 : 0) - (T('generous') ? 0.2 : 0) + j('afford', 0.6),
      space: 0.6 + kids * 0.3 + (members.length > 2 ? 0.3 : 0) + j('space', 0.4),
      commute: 0.8 + (T('hard_worker') ? 0.3 : 0) + (T('lazy') ? 0.4 : 0) + j('commute', 0.5),
      school: pupils ? 0.8 + (T('scholar') ? 0.4 : 0) + j('school', 0.3) : 0,
      quality: 0.5 + (T('ambitious') ? 0.4 : 0) + (T('entrepreneur') ? 0.2 : 0) + j('quality', 0.5),
      // Signed: the sociable like the bustle of the centre; others would rather it was quiet.
      centre: (T('friendly') ? 0.5 : 0) + (T('natural_leader') ? 0.2 : 0) - (T('aggressive') ? 0.3 : 0) - (T('careful') ? 0.2 : 0) + j('centre', 0.8),
      area: 0.5 + (kids ? 0.2 : 0) + j('area', 0.3),
      safety: 0.4 + (kids ? 0.3 : 0) + (T('careful') ? 0.3 : 0),
      road: 0.3,
      kin: 0.3 + (T('loyal') ? 0.4 : 0) + (npc.age >= 60 ? 0.4 : 0) + j('kin', 0.3),
      own: npc.goal?.type === 'buy_house' ? 1.5 : 0.5 + (T('careful') ? 0.2 : 0) + (T('ambitious') ? 0.2 : 0),
    };
    for (const k of PARTS) if (k !== 'centre') w[k] = Math.max(0, w[k]);
    return w;
  }

  /**
   * How good this home would be for this household: { score, parts, ok, why }.
   *   current — it's where they live now (what they pay now; attachment counts)
   *   buy     — they'd be buying it (no rent; the price out of their savings)
   */
  evaluate(npc, id, { members = this.household(npc), budget = this.budget(npc), buy = false, current = false } = {}) {
    const sim = this.sim;
    const P = this.P;
    const f = this.facts(id);
    if (!f) return { score: -99, parts: {}, ok: false, why: 'gone' };
    const w = this.prefs(npc, members);
    const parts = {};
    let ok = true;
    let why = null;
    // Cost: the rent against what they earn (their own home: nothing to pay).
    const owner = P.rec(id)?.owner;
    const mine = owner && members.some((m) => m.id === owner);
    let rent = 0;
    if (current) rent = mine || !P.landlord(npc) ? 0 : (P.lease(id)?.rent ?? P.weeklyRent(id));
    else if (!buy) rent = P.weeklyRent(id);
    if (!current && !buy && rent > budget * 1.15) {
      ok = false;
      why = 'too_dear';
    }
    parts.afford = w.afford * clamp(1 - rent / Math.max(1, budget), -1.5, 1);
    if (buy) parts.afford -= w.afford * Math.min(1, P.value(id) / Math.max(1, npc.money)) * 0.4;
    // Room.
    const size = members.length;
    const cap = id === 'hall' ? 0 : f.cap;
    if (cap < size) {
      parts.space = -w.space * (size - cap) * 0.8;
      if (!current) {
        ok = false;
        why ??= 'too_small';
      }
    } else parts.space = w.space * Math.min(1, (cap - size) / 2) * 0.5;
    if (current && npc.lodger) parts.space -= w.space * 0.6; // a room in someone else's house
    // The walk to work (everyone who works) and to school (children of school age).
    const walk = (to) => Math.abs(to.door.tx - f.door.tx) + Math.abs(to.door.ty - f.door.ty);
    const works = members.map((m) => sim.npcs.workBuilding(m)).filter(Boolean);
    parts.commute = works.length ? -w.commute * Math.min(2, works.reduce((s, b) => s + walk(b), 0) / works.length / HC.commuteScale) : 0;
    const schools = w.school ? (sim.schools?.list() || []).map((s) => sim.world.buildings[s.id]).filter(Boolean) : [];
    parts.school = schools.length ? -w.school * Math.min(2, Math.min(...schools.map(walk)) / HC.commuteScale) : 0;
    // The house, the street, safety, the road.
    parts.quality = w.quality * (((f.quality - 50) / 50) * 0.6 + ((f.condition - 70) / 30) * 0.4);
    parts.centre = w.centre * (1 - Math.min(2, f.plazaDist / 30));
    parts.area = w.area * f.area;
    parts.safety = w.safety * f.safety;
    parts.road = w.road * (f.road ? 0.5 : -0.3);
    // Family nearby (not counting those who'd move with them).
    const kinHomes = sim.family
      .relatives(npc)
      .filter((r) => r?.homeId && !members.includes(r) && sim.world.buildings[r.homeId])
      .map((r) => sim.world.buildings[r.homeId]);
    parts.kin = kinHomes.length ? w.kin * (0.5 - Math.min(1.5, Math.min(...kinHomes.map(walk)) / HC.commuteScale)) : 0;
    // A home of their own.
    parts.own = buy || (current && mine) ? w.own * HC.buyBonus : 0;
    let score = PARTS.reduce((s, k) => s + (parts[k] || 0), 0);
    if (current) {
      // Attachment to the home they know (and the bother of moving).
      const years = (sim.time.day - (npc.homeSince ?? 0)) / DAYS_PER_YEAR;
      score += Math.min(HC.stayMax, years * HC.stayPerYear);
      if (id === 'hall') score -= 2; // sleeping in the village hall is no home
    }
    return { score, parts, ok, why, rent };
  }

  /** How a home compares with where they live now: { gain, why, cand, cur }. */
  compare(npc, id, { buy = false } = {}) {
    const members = this.household(npc);
    const budget = this.budget(npc);
    const cur = npc.homeId ? this.evaluate(npc, npc.homeId, { members, budget, current: true }) : { score: -3, parts: {} };
    const cand = this.evaluate(npc, id, { members, budget, buy });
    return { gain: cand.score - cur.score, why: this.reason(npc, cand, cur), cand, cur };
  }

  /** The main reason one home beats another, as a key (housing_why.*). */
  reason(npc, cand, cur) {
    let best = null;
    let d = 0;
    for (const k of PARTS) {
      const delta = (cand.parts[k] || 0) - (cur.parts[k] || 0);
      if (delta > d) {
        d = delta;
        best = k;
      }
    }
    if (!best) return 'better_home';
    if (best === 'centre') return this.prefs(npc).centre >= 0 ? 'centre' : 'quiet';
    return WHY[best];
  }

  /** What they'd want of a home, from what's wrong with this one (for the UI). */
  wants(ev) {
    const p = ev.parts;
    const out = [];
    if (p.afford < -0.3) out.push('too_dear');
    if (p.space < 0) out.push('crowded');
    if (p.commute < -0.6) out.push('far_from_work');
    if (p.school < -0.6) out.push('far_from_school');
    if (p.quality < -0.3) out.push('run_down');
    if (p.area < -0.3) out.push('rough_area');
    if (p.safety < -0.2) out.push('unsafe');
    if (p.kin < -0.5) out.push('far_from_family');
    return out;
  }

  /** How content they are with their home: 0–100, and what they'd want. Kept on npc.housing. */
  satisfaction(npc) {
    if (!npc.homeId) return { sat: 0, wants: ['no_home'] };
    const ev = this.evaluate(npc, npc.homeId, { current: true });
    const out = { sat: Math.round(clamp(50 + ev.score * 18, 0, 100)), wants: npc.homeId === 'hall' ? ['no_home'] : this.wants(ev), day: this.sim.time.day };
    npc.housing = out;
    return out;
  }

  // ------------------------------------------------------------------ thinking it over

  /** Is this person the one who decides for their household (the better-off of a couple)? */
  isHead(npc) {
    if (npc.age < 18 || !npc.homeId) return false;
    const sp = this.sim.family.spouse(npc);
    return !(sp && sp.homeId === npc.homeId && sp.age >= 18 && (sp.money > npc.money || (sp.money === npc.money && sp.id < npc.id)));
  }

  /**
   * Once a month or so, each household looks at the homes going free: move if one is clearly
   * better than what they have (owners need a much better reason — they'd be letting or selling).
   */
  weekly({ all = false, only = null } = {}) {
    const sim = this.sim;
    const P = this.P;
    const week = Math.floor(sim.time.day / 7);
    let moves = 0;
    const out = [];
    for (const npc of sim.state.npcs.slice()) {
      if (!this.isHead(npc) || npc.leaving || npc.away || (only && !only.includes(npc.id))) continue;
      if (!all && (Math.floor(hashStr(npc.id) * HC.reviewEveryWeeks) + week) % HC.reviewEveryWeeks !== 0) continue;
      if (sim.economy.businessAtBuilding(npc.homeId)) continue; // the innkeeper lives over the inn
      const members = this.household(npc);
      const sat = this.satisfaction(npc);
      for (const m of members) if (m !== npc && m.age >= 18) m.housing = sat;
      if (moves >= HC.maxMovesPerWeek && !all) continue;
      const budget = this.budget(npc);
      const cur = this.evaluate(npc, npc.homeId, { members, budget, current: true });
      const opt = P.options(members.length, budget * 1.1, npc.money / HOUSING.buyReserve, npc)[0];
      if (!opt) continue;
      const cand = this.evaluate(npc, opt.id, { members, budget, buy: opt.buy });
      const owns = P.rec(npc.homeId)?.owner === npc.id;
      if (cand.score - cur.score < (owns ? HC.ownerMoveGain : HC.moveGain)) continue;
      const why = this.reason(npc, cand, cur);
      const from = npc.homeId;
      P.settle(members, opt, npc, 'moved');
      sim.memory.remember(npc, 'moved_for', { params: { building: opt.id, hwhy: why } });
      sim.chronicle('chronicle.npc_moved_for', { npc: npc.id, gender: npc.gender, building: opt.id, hwhy: why });
      out.push({ npc: npc.id, from, to: opt.id, why, gain: +(cand.score - cur.score).toFixed(2) });
      moves++;
    }
    return out;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
