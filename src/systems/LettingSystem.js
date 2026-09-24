/**
 * LettingSystem — finding tenants for the houses you own.
 *
 *   state.letting = { listings: { buildingId: { since, advertisedUntil } }, ads: [{ building, settlement, day, arrive }] }
 *   npc.viewing = { building, day }   (coming to look at one of your houses this evening)
 *
 * Put up a "to let" sign and the house is on the market — and not just for the
 * homeless. Villagers who could do better look at it too: lodgers in someone's
 * spare room, families crammed into too small a house, grown children still at
 * their parents', tenants paying more elsewhere, people with a long walk to work.
 * Each morning someone may ask to see it: they walk over in the evening, look it
 * over and decide — on the rent against what they earn, the size, its condition,
 * the walk to work, and what they think of you as a landlord. If they say no,
 * they tell you why (too dear, too small, happy where they are, don't trust you).
 *
 * An advertisement in the village (a small fee) reaches people who aren't even
 * looking. An advertisement in another settlement you trade with brings a family
 * from there, days later, straight to your door — if the rent suits them and the
 * valley appeals. And you can simply ask someone, in conversation.
 */
import { rand } from '../core/rng.js';

export const LETTING = {
  viewChance: 0.35, // each morning, chance someone asks to see a listed house…
  viewChanceAdvertised: 0.7, // …more when it's advertised
  adCost: 8, // a week's notice on the board and the crier's rounds
  adDays: 7,
  awayAdBase: 12, // an advertisement in another settlement…
  awayAdPerDay: 6, // …plus this per day of travel (the carter takes it)
  viewHours: [16, 20], // viewings happen in the evening, after work
  decideHour: 20,
  acceptScore: 1.4, // how good a deal it must look to take it
  askBonus: 0.4, // asked in person, people are a little more willing
};
const L = LETTING;

export class LettingSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.letting ??= { listings: {}, ads: [] };
    sim.bus.on('time:hour', (h) => {
      if (h === 9) this.morning();
      if (h === L.decideHour) this.evening();
    });
    sim.bus.on('time:day', () => this.onDay());
  }

  get S() {
    return this.sim.state.letting;
  }
  get P() {
    return this.sim.property;
  }

  // ------------------------------------------------------------------ your houses

  /** A house of yours that could take tenants (vacant, fit to live in, not your own home). */
  lettable(id) {
    const r = this.P.rec(id);
    return !!r && r.owner === 'player' && this.P.isVacant(id);
  }

  listed(id) {
    return !!this.S.listings[id];
  }

  /** Put up (or take down) the "to let" sign. */
  list(id, on = true) {
    if (on && !this.lettable(id)) return { ok: false, reason: 'not_lettable' };
    if (on) this.S.listings[id] ??= { since: this.sim.time.day, advertisedUntil: null };
    else delete this.S.listings[id];
    this.sim.bus.emit('building:changed', id);
    this.sim.bus.emit('property:changed', id);
    return { ok: true };
  }

  advertised(id) {
    return (this.S.listings[id]?.advertisedUntil ?? -1) >= this.sim.time.day;
  }

  /** A week's advertising in the village: people who weren't looking come to see it too. */
  advertise(id) {
    const p = this.sim.state.player;
    if (!this.lettable(id)) return { ok: false, reason: 'not_lettable' };
    if (p.money < L.adCost) return { ok: false, reason: 'no_money', params: { money: L.adCost } };
    p.money -= L.adCost;
    this.list(id, true);
    this.S.listings[id].advertisedUntil = this.sim.time.day + L.adDays;
    this.sim.state.village.treasury += L.adCost; // the crier and the notice board belong to the village
    return { ok: true };
  }

  awayAdCost(settlement) {
    return L.awayAdBase + L.awayAdPerDay * (this.sim.settlements?.days(settlement) || 1);
  }

  /** Advertise in another settlement: a family from there may come to rent it. */
  advertiseAway(id, settlement) {
    const p = this.sim.state.player;
    const S = this.sim.settlements;
    if (!this.lettable(id)) return { ok: false, reason: 'not_lettable' };
    if (!S?.get(settlement)?.contact) return { ok: false, reason: 'no_contact' };
    if (this.S.ads.some((a) => a.building === id)) return { ok: false, reason: 'ad_out' };
    const cost = this.awayAdCost(settlement);
    if (p.money < cost) return { ok: false, reason: 'no_money', params: { money: cost } };
    p.money -= cost;
    this.list(id, true);
    const day = this.sim.time.day;
    this.S.ads.push({ building: id, settlement, day, arrive: day + S.days(settlement) + rand.int(1, 3) });
    return { ok: true, cost };
  }

  // ------------------------------------------------------------------ who might want it

  /** The people who'd move together: a couple and the children living with them. */
  household(npc) {
    const sim = this.sim;
    const spouse = sim.family.spouse(npc);
    const kids = sim.family.children(npc).filter((k) => k.age < 18 && k.homeId === npc.homeId);
    return [npc, spouse && spouse.homeId === npc.homeId ? spouse : null, ...kids].filter(Boolean);
  }

  /** Why this villager might move at all: { n, why }. 0 = happy where they are. */
  need(npc, id) {
    const sim = this.sim;
    const P = this.P;
    if (!npc.homeId || npc.homeId === 'hall') return { n: 3, why: 'no_home' };
    if (npc.lodger) return { n: 2.2, why: 'lodging' };
    const home = npc.homeId;
    if (P.occupants(home) > P.capacity(home)) return { n: 2, why: 'crowded' };
    const withParents = npc.kin?.parents.some((pid) => sim.npcs.byId(pid)?.homeId === home);
    if (withParents && npc.age >= 20 && !npc.kin?.spouse && (npc.employer || npc.owns)) return { n: 1.5, why: 'own_place' };
    // A long walk to work — and this house is near it.
    const work = sim.npcs.workBuilding(npc);
    const b = sim.world.buildings[id];
    const hb = sim.world.buildings[home];
    if (work && b && hb) {
      const now = Math.hypot(hb.door.tx - work.door.tx, hb.door.ty - work.door.ty);
      const then = Math.hypot(b.door.tx - work.door.tx, b.door.ty - work.door.ty);
      if (now > 24 && then < now * 0.5) return { n: 1.3, why: 'near_work' };
    }
    const landlord = P.landlord(npc);
    if (landlord) {
      const cur = P.weeklyRent(home);
      const cond = P.rec(home)?.condition ?? 100;
      if (P.weeklyRent(id) < cur * 0.85 || ((P.rec(id)?.condition ?? 100) > cond + 20)) return { n: 1, why: 'better_deal' };
    }
    if (P.rec(home)?.owner === npc.id) return { n: 0, why: 'owns_home' };
    return { n: this.advertised(id) ? 0.4 : 0, why: 'curious' };
  }

  /** Would this villager (and their household) take this house? { ok, reason, score }. */
  willRent(npc, id, { asked = false } = {}) {
    const sim = this.sim;
    const P = this.P;
    if (npc.age < 18 || npc.leaving || npc.away || npc.homeId === id) return { ok: false, reason: 'not_looking', score: 0 };
    if (npc.homeId && npc.homeId === sim.state.player.homeId) return { ok: false, reason: 'not_looking', score: 0 };
    const hh = this.household(npc);
    if (hh.length > P.capacity(id)) return { ok: false, reason: 'too_small', score: 0 };
    const pb = npc.pb || { t: 0, c: 0 };
    if (pb.c >= 40 || (npc.memories || []).some((m) => m.w === 'player' && ['evicted', 'player_fired_unfair'].includes(m.k))) return { ok: false, reason: 'distrust', score: 0 };
    const need = this.need(npc, id);
    if (need.n <= 0) return { ok: false, reason: need.why === 'owns_home' ? 'owns_home' : 'happy_here', score: 0 };
    const rent = P.weeklyRent(id);
    const spouse = sim.family.spouse(npc);
    const budget = P.rentBudget(npc) + (spouse && hh.includes(spouse) ? P.rentBudget(spouse) * 0.6 : 0);
    if (rent > budget * 1.15) return { ok: false, reason: 'too_dear', score: 0, rent, budget };
    const cond = P.rec(id)?.condition ?? 100;
    let score = need.n * 1.2 + (budget - rent) / Math.max(4, rent) + (cond - 60) / 40 + (npc.rel || 0) / 50 + pb.t / 60 + (asked ? L.askBonus : 0);
    if (P.capacity(id) > hh.length + 1) score += 0.2; // room to grow
    return { ok: score >= L.acceptScore, reason: score >= L.acceptScore ? need.why : 'not_worth_it', score, rent, budget };
  }

  /** Everyone who might take it, best first — and what puts the others off (for the property panel). */
  interest(id) {
    const all = this.sim.state.npcs.map((n) => ({ n, r: this.willRent(n, id) }));
    const yes = all.filter((x) => x.r.ok).sort((a, b) => b.r.score - a.r.score);
    const no = {};
    for (const x of all) if (!x.r.ok && !['not_looking', 'happy_here', 'owns_home'].includes(x.r.reason)) no[x.r.reason] = (no[x.r.reason] || 0) + 1;
    const top = Object.entries(no).sort((a, b) => b[1] - a[1])[0];
    return { yes, main: top ? top[0] : null };
  }

  /** The best house of yours for this villager, if any would suit them. */
  offerFor(npc) {
    let best = null;
    for (const id of Object.keys(this.P.all)) {
      if (!this.lettable(id)) continue;
      const r = this.willRent(npc, id, { asked: true });
      if (!best || r.score > best.r.score || (!best.r.ok && r.ok)) best = { id, r };
    }
    return best;
  }

  // ------------------------------------------------------------------ viewings and moving in

  morning() {
    const day = this.sim.time.day;
    for (const id of Object.keys(this.S.listings)) {
      if (!this.lettable(id)) continue;
      if (this.sim.state.npcs.some((n) => n.viewing?.building === id)) continue;
      if (!rand.chance(this.advertised(id) ? L.viewChanceAdvertised : L.viewChance)) continue;
      const pick = this.interest(id).yes.find((x) => !x.n.viewing);
      if (!pick) continue;
      pick.n.viewing = { building: id, day };
      this.sim.toast('toast.viewing_booked', { npc: pick.n.id, building: id }, 'info');
    }
  }

  /** They've looked it over (NPCSystem, at the door) — or the evening's gone: they decide. */
  decide(npc) {
    const v = npc.viewing;
    if (!v) return false;
    delete npc.viewing;
    if (!this.lettable(v.building)) return false;
    const r = this.willRent(npc, v.building);
    if (r.ok && rand.chance(0.85)) return this.moveIn(npc, v.building, 'viewing');
    this.sim.toast('toast.viewing_declined', { npc: npc.id, gender: npc.gender, building: v.building, letting: r.reason }, 'info');
    return false;
  }

  evening() {
    for (const n of this.sim.state.npcs.slice()) if (n.viewing && n.viewing.day <= this.sim.time.day) this.decide(n);
  }

  /** Ask a villager in person (DialoguePanel). Returns { ok, reason, building }. */
  ask(npc) {
    const best = this.offerFor(npc);
    if (!best) return { ok: false, reason: 'no_house' };
    if (!best.r.ok) return { ok: false, reason: best.r.reason, building: best.id };
    this.moveIn(npc, best.id, 'asked');
    return { ok: true, building: best.id };
  }

  moveIn(npc, id, how) {
    const sim = this.sim;
    const hh = this.household(npc);
    const rent = this.P.weeklyRent(id);
    sim.property.moveIn(hh, id, 'moved');
    for (const n of hh) delete n.viewing;
    delete this.S.listings[id];
    sim.memory.remember(npc, 'rented_from_player', { who: 'player', params: { building: id } });
    sim.chronicle('chronicle.npc_rented_player', { npc: npc.id, gender: npc.gender, building: id, n: hh.length });
    sim.toast('toast.new_tenant', { npc: npc.id, building: id, money: rent, n: hh.length }, 'good');
    sim.bus.emit('building:changed', id);
    return true;
  }

  // ------------------------------------------------------------------ newcomers answering an advertisement

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    // Take signs down from houses that are no longer free (or no longer yours).
    for (const id of Object.keys(this.S.listings)) if (!this.lettable(id)) {
      delete this.S.listings[id];
      sim.bus.emit('building:changed', id);
    }
    for (const ad of this.S.ads.slice()) {
      if (day < ad.arrive) continue;
      this.S.ads.splice(this.S.ads.indexOf(ad), 1);
      if (!this.lettable(ad.building)) continue;
      if (!rand.chance(this.awayChance(ad.building, ad.settlement))) {
        sim.toast('toast.ad_no_takers', { settlement: ad.settlement, building: ad.building }, 'info');
        continue;
      }
      const people = sim.growth.arrive({ homeId: ad.building, from: ad.settlement, size: sim.property.capacity(ad.building) });
      if (!people?.length) continue;
      delete this.S.listings[ad.building];
      sim.memory.remember(people[0], 'rented_from_player', { who: 'player', params: { building: ad.building } });
      sim.chronicle('chronicle.newcomers_rented', { npc: people[0].id, gender: people[0].gender, settlement: ad.settlement, building: ad.building, n: people.length });
      sim.toast('toast.newcomers_rented', { npc: people[0].id, gender: people[0].gender, settlement: ad.settlement, building: ad.building, n: people.length }, 'good');
      sim.bus.emit('building:changed', ad.building);
    }
  }

  /** How likely an advertisement there brings someone: the rent, the house, the valley's name, their town. */
  awayChance(id, settlement) {
    const sim = this.sim;
    const s = sim.settlements.get(settlement);
    const rent = this.P.weeklyRent(id);
    const means = 12 + Math.min(20, s.pop / 25); // what a family there could pay
    let c = 0.35 + (means - rent) / 40 + (this.P.rec(id)?.condition ?? 100) / 400 + (sim.civic?.attractiveness() || 0) * 0.3 + (sim.growth?.attractiveness?.() || 0) * 0.03;
    if (s.fed < 0.6) c += 0.15; // hard times there: people are ready to move
    c += s.road * 0.05;
    return Math.max(0.1, Math.min(0.9, c));
  }
}
