/**
 * RumorSystem — what people say, true or not.
 *
 * Rumors start from real things (a new seam found in the mountains, a
 * business hiring, a shop selling cheap, a couple seen walking together,
 * people moving away) and travel from person to person when villagers chat.
 * Each retelling may bend the story a little — iron becomes gold, "hiring"
 * outlives the vacancy, one family leaving becomes "everyone's leaving".
 *
 * Rumors matter: people act on them (job seekers try the place they heard
 * was hiring, shoppers try the shop they heard was cheap), and you hear them
 * when you ask villagers for news.
 *
 *   state.rumors = { list: [{ id, kind, params, truth, born, from?, hops }], nextId, heardByPlayer: [ids] }
 *   npc.rumors = [ids]  (what this villager has heard)
 */
import { rand } from '../core/rng.js';

const MAX_PER_NPC = 6;
const MAX_AGE = 35; // days before a rumor is forgotten
const DISTORT = 0.12; // chance a retelling changes the story
/** Rumors about you: how much hearing one changes what someone thinks of you. */
export const YOU_RUMORS = { you_built: 0.4, you_helped: 1, you_fired: -1, you_business: 0.2, you_ambition: 0.5, you_path: 0.4, you_generous: 1 };

export class RumorSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.rumors ??= { list: [], nextId: 1, heardByPlayer: [] };
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('chronicle', (e) => this.fromChronicle(e));
  }

  get R() {
    return this.sim.state.rumors;
  }

  get(id) {
    return this.R.list.find((r) => r.id === id) || null;
  }

  /** Start a rumor, told first to someone who was there (or anyone). */
  seed(kind, params, { truth = true, teller = null, from = null } = {}) {
    const r = { id: this.R.nextId++, kind, params, truth, born: this.sim.time.day, hops: 0, from };
    this.R.list.push(r);
    const first = teller || rand.pick(this.sim.state.npcs.filter((n) => n.age >= 14));
    if (first) this.learn(first, r.id);
    return r;
  }

  learn(npc, id) {
    npc.rumors ??= [];
    if (npc.rumors.includes(id)) return false;
    npc.rumors.push(id);
    if (npc.rumors.length > MAX_PER_NPC) npc.rumors.shift();
    // What they hear about you changes what they think of you (a little).
    const r = this.get(id);
    const feel = r && YOU_RUMORS[r.kind];
    if (feel && this.sim.social) this.sim.social.addRel(npc, feel);
    return true;
  }

  /** The rumors this villager knows, as objects. */
  known(npc) {
    return (npc.rumors || []).map((id) => this.get(id)).filter(Boolean);
  }

  /** Two villagers chat: each may pass on something they heard — perhaps a little changed. */
  exchange(a, b) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const pool = this.known(from).filter((r) => !(to.rumors || []).includes(r.id));
      if (!pool.length || !rand.chance(0.35)) continue;
      const r = rand.pick(pool);
      if (rand.chance(DISTORT * (this.sim.tech?.mod('rumor_distort') ?? 1))) {
        const twisted = this.distort(r);
        if (twisted) {
          this.learn(to, twisted.id);
          continue;
        }
      }
      this.learn(to, r.id);
    }
  }

  /** The story grows in the telling. */
  distort(r) {
    const p = { ...r.params };
    switch (r.kind) {
      case 'deposit':
        if (p.item === 'gold') return null;
        p.item = rand.chance(0.5) ? 'gold' : p.item;
        p.rich = true;
        break;
      case 'leaving':
        p.everyone = true;
        break;
      case 'cheap':
        p.very = true;
        break;
      case 'romance':
        p.engaged = true;
        break;
      default:
        return null;
    }
    const t = { id: this.R.nextId++, kind: r.kind, params: p, truth: false, born: this.sim.time.day, hops: r.hops + 1, from: r.id };
    this.R.list.push(t);
    return t;
  }

  /** Is this still true today? (A job filled, a shop no longer cheapest, a seam dug out.) */
  stillTrue(r) {
    if (!r.truth) return false;
    const sim = this.sim;
    const E = sim.economy;
    switch (r.kind) {
      case 'hiring':
        return sim.npcs.vacancies().some(([id]) => id === r.params.biz);
      case 'cheap': {
        const b = E.biz(r.params.biz);
        return !!b && !b.closed;
      }
      case 'deposit':
        return Object.values(sim.state.objects).some((o) => o.id === r.params.obj && o.state !== 'depleted');
      default:
        return true;
    }
  }

  /** Rumors from things that happen. */
  fromChronicle(e) {
    const p = e.params || {};
    switch (e.key) {
      case 'chronicle.npc_courting':
        if (rand.chance(0.7)) this.seed('romance', { npc: p.npc, npc2: p.npc2 });
        break;
      case 'chronicle.npc_left_village':
        this.seed('leaving', { npc: p.npc });
        break;
      case 'chronicle.business_opened_npc':
        this.seed('new_business', { npc: p.npc, building: p.building });
        break;
      case 'chronicle.business_failed':
        this.seed('closing', { building: p.building });
        break;
      // What you do gets talked about (YOU_RUMORS: and people think better or worse of you for it).
      case 'chronicle.player_built':
      case 'chronicle.player_upgraded':
        this.seed('you_built', { building_type: p.building_type });
        break;
      case 'chronicle.player_helped':
        this.seed('you_helped', { npc: p.npc });
        break;
      case 'chronicle.player_fired':
        if (p.unfair !== false) this.seed('you_fired', { npc: p.npc });
        break;
      case 'chronicle.player_bought_business':
      case 'chronicle.player_opened_business':
        this.seed('you_business', { building: p.building, biz_type: p.biz_type });
        break;
      case 'chronicle.player_ambition':
        this.seed('you_ambition', { ambition: p.ambition });
        break;
      case 'chronicle.path_milestone':
        this.seed('you_path', { path: p.path, milestone: p.milestone });
        break;
      case 'chronicle.festival_donated':
        this.seed('you_generous', { festival: p.festival, money: p.money });
        break;
      case 'chronicle.business_copied':
        this.seed('copied', { npc: p.npc, biz_type: p.biz_type });
        break;
      default:
    }
  }

  onDay() {
    const sim = this.sim;
    const day = sim.time.day;
    // Some things people talk about every week.
    if (sim.time.weekday === 3) {
      const v = sim.npcs.vacancies();
      if (v.length) {
        const [biz, def] = rand.pick(v);
        const staff = sim.npcs.staffOf(biz)[0] || sim.economy.owner(biz);
        this.seed('hiring', { biz, building: def.building }, { teller: staff });
      }
      // The cheapest shop in a line of trade gets a name for it.
      const sectors = new Set(sim.economy.active().map((id) => sim.economy.def(id).sector));
      for (const s of sectors) {
        const shops = sim.economy.ofSector(s).filter((id) => sim.economy.def(id).kind === 'shop');
        if (shops.length < 2) continue;
        const cheapest = shops.sort((a, b) => (sim.economy.biz(a).markup ?? 1) - (sim.economy.biz(b).markup ?? 1))[0];
        const item = sim.economy.def(cheapest).sells?.[0];
        if (item && !this.R.list.some((r) => r.kind === 'cheap' && r.params.biz === cheapest && day - r.born < 20)) this.seed('cheap', { biz: cheapest, building: sim.economy.biz(cheapest).building, item }, { teller: sim.economy.owner(cheapest) });
      }
      // Now and then, something false comes from nowhere.
      if (rand.chance(0.15)) this.seed('deposit', { item: 'gold', region: rand.pick(['north_mountains', 'east_mountains']) }, { truth: false });
    }
    // Old stories are forgotten.
    const alive = new Set();
    this.R.list = this.R.list.filter((r) => {
      const keep = day - r.born <= MAX_AGE || this.R.heardByPlayer.includes(r.id);
      if (keep) alive.add(r.id);
      return keep;
    });
    for (const n of sim.state.npcs) if (n.rumors) n.rumors = n.rumors.filter((id) => alive.has(id) && day - (this.get(id)?.born ?? 0) <= MAX_AGE);
  }

  /** The player heard this rumor (from a villager). */
  heard(r) {
    if (!this.R.heardByPlayer.includes(r.id)) {
      this.R.heardByPlayer.push(r.id);
      if (this.R.heardByPlayer.length > 40) this.R.heardByPlayer.shift();
    }
  }

  /** A villager's pick of which shop / employer, nudged by what they've heard. */
  bias(npc, kind, bizId) {
    return this.known(npc).some((r) => r.kind === kind && r.params.biz === bizId) ? 1 : 0;
  }
}
