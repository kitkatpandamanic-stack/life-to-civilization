/**
 * DevelopmentSystem — villagers develop the valley themselves (the player needn't build every part of it).
 *
 * Nothing here is scripted growth. Once a week, villagers with money put by look at the land:
 *   • a family renting (or living with parents) buys a lot ahead — the ground for its own home —
 *     and builds on it when it has saved enough (GrowthSystem builds on a builder's own land first);
 *   • someone well-off buys a plot where land is getting dearer (a road coming, a neighbourhood
 *     growing) and, once it's worth a good deal more, puts it up for sale (you can buy it; so can others);
 *   • a villager with capital and drive becomes a developer: builds a row of houses to let, one after
 *     another near the first, each paid for as it goes up — with people in them, a neighbourhood;
 * and where the next building goes follows the people: homes are drawn to neighbourhoods, a new
 * shopfront to a neighbourhood with no shop, a builder to their own land (GrowthSystem). The village,
 * for its part, lays lanes, paves the busy streets and lights them (InfrastructureSystem).
 *
 * Redevelopment (Phase 13): a ruin left standing is pulled down — by its owner, to build again, or by the
 * village, which takes the ground back; a house to let that has stood empty for weeks on a busy street is
 * turned into a shop by its owner (and someone opens a business in it).
 *
 *   NPC buys land → builds a house → another opens a shop nearby → more people come →
 *   the road is paved → more houses → a neighbourhood forms
 *
 *   npc.landPlan = { k: 'home' | 'hold' | 'develop', plot?, day, paid?, site?, n?, built?: [], anchor? }
 *   state.development = { log: [{ day, k, npc, plot, n }] }
 */
import { NPC_DEV as D } from '../data/development.js';
import { GROWTH as G } from '../data/villageBuildings.js';
import { AREAS } from '../data/villageLayout.js';
import { hashStr } from '../core/rng.js';

const PLAZA_C = { tx: Math.round((AREAS.plaza.x1 + AREAS.plaza.x2) / 2), ty: Math.round((AREAS.plaza.y1 + AREAS.plaza.y2) / 2) };

export class DevelopmentSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.development ??= { log: [] };
    sim.bus.on('time:day', () => sim.time.weekday === D.weekday && this.weekly());
    sim.bus.on('construction:changed', (c) => c.status === 'done' && this.built(c));
  }

  get S() {
    return this.sim.state.development;
  }

  note(k, npc, plot, n) {
    this.S.log.push({ day: this.sim.time.day, k, npc: npc?.id || npc, plot, n });
    if (this.S.log.length > D.keepLog) this.S.log.shift();
  }

  /** A fixed lean per villager and week (not a dice roll: the simulation's random stream is left alone). */
  minded(n, salt = '') {
    return hashStr(`${n.id}:${Math.floor(this.sim.time.day / 7)}:${salt}`, this.sim.state.seed | 0) < D.lean;
  }

  /** Land a villager owns (not the lot a building of theirs stands on). */
  landOf(n) {
    const T2 = this.sim.territory;
    return T2.all().filter((q) => T2.owner(q.id) === n.id && !T2.buildingsOn(q.id).length).map((q) => q.id);
  }

  weekly() {
    const sim = this.sim;
    if (!sim.territory || !sim.growth) return;
    this.tidy();
    this.buildOnLand();
    this.developers();
    this.buyers();
    this.sellers();
    this.redevelop();
  }

  /** Plans that no longer make sense: the land's gone, they've moved away, they've a home of their own now. */
  tidy() {
    const sim = this.sim;
    for (const n of sim.state.npcs) {
      const plan = n.landPlan;
      if (!plan) continue;
      if (plan.plot && sim.territory.owner(plan.plot) !== n.id) delete n.landPlan;
      else if (plan.k === 'home' && !plan.site && sim.property.rec(n.homeId)?.owner === n.id) {
        plan.k = 'hold'; // they've a house of their own after all: the lot is land to sell on
        plan.day = sim.time.day;
      }
    }
  }

  // ------------------------------------------------------------------ buying land

  /** Who wants land, and why: the ground for a home of their own later, or land that's getting dearer. */
  buyers() {
    const sim = this.sim;
    const P = sim.property;
    let bought = 0;
    const npcs = sim.state.npcs.filter((n) => n.age >= 20 && n.age <= 65 && !n.leaving && !n.landPlan && !sim.growth.projectOf(n));
    for (const n of npcs.sort((a, b) => b.money - a.money || (a.id < b.id ? -1 : 1))) {
      if (bought >= D.maxBuysPerWeek) break;
      if (!this.minded(n, 'buy')) continue;
      const renting = !!P.landlord(n) || !n.homeId || n.homeId === 'hall' || (n.kin?.parents || []).some((pid) => sim.npcs.byId(pid)?.homeId === n.homeId);
      if (renting && n.money >= D.homeMoney && this.buyHomeLot(n)) bought++;
      else if (!renting && n.money >= D.holdMoney && !n.traits.some((t) => D.holdTraits.includes(t)) && this.landOf(n).length < D.maxPlotsEach && this.buyToHold(n)) bought++;
    }
    return bought;
  }

  /** The ground for a family's own home, bought ahead: a lot near work (or a neighbourhood), carved out and paid for. */
  buyHomeLot(n) {
    const sim = this.sim;
    const Gs = sim.growth;
    const T2 = sim.territory;
    const work = n.employer ? sim.economy.buildingOf(n.employer)?.door : null;
    const near = work || this.hoodSpot() || PLAZA_C;
    const lot = Gs.findLot('small_house', near, n.id);
    if (!lot) return false;
    const m = G.lotMargin;
    const rect = [lot.tx - m, lot.ty - m, lot.tx + 3 + m, lot.ty + 2 + m];
    const price = T2.lotPrice(n.id, ...rect);
    if (price <= 0 || price > n.money * D.homeShare) return false;
    if (T2.acquireLot(n.id, ...rect, { how: 'bought', whole: true }) < 0) return false;
    const plot = T2.idAt(lot.tx + 1, lot.ty + 1);
    n.landPlan = { k: 'home', plot, day: sim.time.day, paid: price };
    sim.memory?.remember(n, 'bought_land', { params: { plot } });
    sim.chronicle('chronicle.npc_bought_lot', { npc: n.id, gender: n.gender, plot });
    this.note('bought_home', n, plot, price);
    return true;
  }

  /** A neighbourhood's middle (the biggest), where people are drawn to build. */
  hoodSpot() {
    const h = (this.sim.places?.hoods() || []).slice().sort((a, b) => b.homes.length - a.homes.length)[0];
    return h ? { tx: h.tx, ty: h.ty } : null;
  }

  /** Land to hold: a whole plot, near a road and the village, getting dearer — within what they'll spend. */
  buyToHold(n) {
    const sim = this.sim;
    const T2 = sim.territory;
    const budget = Math.max(0, n.money - D.holdKeep) * D.holdShare;
    let best = null;
    for (const q of T2.all()) {
      if (q.kind !== 'land') continue;
      const r = T2.rec(q.id);
      if (!r || r.owner === 'player' || r.owner === n.id) continue;
      if (r.owner && r.owner !== 'village' && !r.forSale) continue;
      const info = T2.info(q.id);
      if (!info || info.buildable < D.plotMinBuildable || info.plazaDist > D.plotMaxPlaza || info.roadDist > D.plotMaxRoad || T2.buildingsOn(q.id).length) continue;
      const chk = T2.canBuy(q.id, n.id);
      if (!chk.ok || chk.price > budget) continue;
      const hist = r.lvh || [];
      const rising = hist.length > 2 ? (hist.at(-1) - hist[0]) / Math.max(1, hist[0]) : 0;
      const cov = sim.infra?.plotCoverage(q.id);
      const score = rising * 6 + (cov?.score || 0) * 2 + (sim.places?.hoodAt(Math.round(q.cx), Math.round(q.cy)) ? 1 : 0) - info.plazaDist / 30 - chk.price / Math.max(1, budget);
      if (!best || score > best.score) best = { id: q.id, score };
    }
    if (!best) return false;
    const res = T2.buy(best.id, n.id);
    if (!res.ok) return false;
    n.landPlan = { k: 'hold', plot: best.id, day: sim.time.day, paid: res.price };
    this.note('bought_hold', n, best.id, res.price);
    return true;
  }

  // ------------------------------------------------------------------ building on it

  /** A family builds its home on the lot it bought, once it has the money. */
  buildOnLand() {
    const sim = this.sim;
    const Gs = sim.growth;
    for (const n of sim.state.npcs) {
      const plan = n.landPlan;
      if (plan?.k !== 'home' || plan.site || Gs.projectOf(n)) continue;
      const funds = n.money + (sim.family.spouse(n)?.money || 0) * 0.5;
      const kids = (n.kin?.children || []).filter((id) => sim.npcs.byId(id)?.homeId === n.homeId).length;
      const type = funds >= Gs.estimate('house') && kids >= 1 ? 'house' : 'small_house';
      if (funds < Gs.estimate(type) * D.homeReserve) continue;
      const q = sim.territory.parcel(plan.plot);
      if (!q) continue;
      const c = Gs.start(n, type, 'home', { tx: Math.round(q.cx), ty: Math.round(q.cy) });
      if (c) {
        plan.site = c.id;
        this.note('building_home', n, plan.plot);
      }
    }
  }

  /** A site finished: the home they bought land for (the plan's done), or the next house of a developer's row. */
  built(c) {
    const sim = this.sim;
    const n = sim.npcs.byId(c.owner);
    const plan = n?.landPlan;
    if (!plan || c.kind !== 'building' || plan.site !== c.id) return;
    if (plan.k === 'home') {
      this.note('home_done', n, plan.plot);
      delete n.landPlan;
    } else if (plan.k === 'develop') {
      plan.built = [...(plan.built || []), c.id];
      plan.site = null;
      plan.anchor ??= { tx: c.tx + Math.floor(c.w / 2), ty: c.ty + c.h };
      if (plan.built.length >= plan.n) this.developed(n);
    }
  }

  developed(n) {
    const sim = this.sim;
    const plan = n.landPlan;
    sim.chronicle('chronicle.npc_development_done', { npc: n.id, gender: n.gender, n: plan.built.length, building: plan.built[0] });
    sim.memory?.remember(n, 'developed_row', { params: { n: plan.built.length } });
    this.note('develop_done', n, null, plan.built.length);
    n.devRest = sim.time.day + D.developerRest; // (a while before they take on another)
    delete n.landPlan;
  }

  /**
   * Developers: a villager with capital and drive, when homes are wanted (and none stand empty), builds a row of houses to
   * let — one at a time near the first, each paid for as it goes up (the rents of the first help).
   */
  developers() {
    const sim = this.sim;
    const Gs = sim.growth;
    const cost = Gs.estimate('small_house');
    let active = 0;
    for (const n of sim.state.npcs) {
      const plan = n.landPlan;
      if (plan?.k !== 'develop') continue;
      active++;
      if (plan.site || Gs.projectOf(n)) continue;
      if (n.money < cost * D.developerNext) {
        // Short of money: wait — or, well short and some built, the row stops where it is.
        if (n.money < cost * D.developerGiveUp && (plan.built || []).length) {
          this.note('develop_stopped', n, null, plan.built.length);
          if (plan.built.length >= 2) this.developed(n);
          else delete n.landPlan;
        }
        continue;
      }
      const c = Gs.start(n, 'small_house', 'rental', plan.anchor || plan.near || PLAZA_C);
      if (c) plan.site = c.id;
    }
    if (active >= D.maxDevelopers) return null;
    // (Homes wanted: the market says so — and there's no home standing empty already. People sleeping in the hall who
    // can't pay the rent don't make a row of houses to let pay.)
    const P = sim.property;
    const wanted = (sim.realty?.idx ?? 1) >= D.developerIdx && !P.homes().some((id) => P.isVacant(id));
    if (!wanted) return null;
    const dev = sim.state.npcs
      .filter((n) => n.age >= 25 && n.age <= 62 && !n.landPlan && !n.leaving && !(n.devRest > sim.time.day) && n.money >= D.developerMoney && !Gs.projectOf(n) && n.traits.some((t) => D.developerTraits.includes(t)))
      .sort((a, b) => b.money - a.money || (a.id < b.id ? -1 : 1))[0];
    if (!dev || !this.minded(dev, 'develop')) return null;
    // Where: a neighbourhood that could take more houses, else where the village is growing.
    const near = this.hoodSpot() || PLAZA_C;
    const c = Gs.start(dev, 'small_house', 'rental', near);
    if (!c) return null;
    dev.landPlan = { k: 'develop', day: sim.time.day, n: D.developerHouses, built: [], site: c.id, near };
    sim.chronicle('chronicle.npc_development', { npc: dev.id, gender: dev.gender, n: D.developerHouses });
    this.note('develop', dev, null, D.developerHouses);
    return dev.id;
  }

  // ------------------------------------------------------------------ selling it on

  /** Land held: put up for sale once it's worth a good deal more than was paid for it. */
  sellers() {
    const sim = this.sim;
    const T2 = sim.territory;
    for (const n of sim.state.npcs) {
      const plan = n.landPlan;
      if (plan?.k !== 'hold') continue;
      const r = T2.rec(plan.plot);
      if (!r || r.forSale || sim.time.day - plan.day < D.holdDays) continue;
      if (T2.price(plan.plot) >= (plan.paid || 1) * D.sellGain || sim.time.day - plan.day >= D.holdMaxDays) {
        T2.setForSale(plan.plot, true, n.id);
        sim.chronicle('chronicle.npc_land_for_sale', { npc: n.id, gender: n.gender, plot: plan.plot });
        this.note('for_sale', n, plan.plot);
      }
    }
  }

  // ------------------------------------------------------------------ redevelopment (Phase 13)

  /** Ruins cleared, empty houses on a busy street made shops (a project or two a week at most). */
  redevelop() {
    const sim = this.sim;
    const P = sim.property;
    const S = sim.structures;
    if (!S) return;
    let ruin = false;
    let shop = false;
    for (const [id, r] of Object.entries(P.all)) {
      const b = sim.world.buildings[id];
      if (!b || S.works(id) || !S.rec(id)) continue;
      // A ruin: the owner pulls it down (to build again), or the village clears it and takes back the ground.
      if (r.ruined) {
        r.ruinWeeks = (r.ruinWeeks || 0) + 1;
        if (ruin || r.ruinWeeks < D.ruinWeeks || r.owner === 'player') continue;
        const owner = sim.npcs.byId(r.owner);
        const job = { type: 'demolish' };
        const cost = S.estimate(S.cost(id, job) || { money: 0 });
        if (owner && owner.money >= cost * 2 && S.start(id, job, owner.id).ok) {
          ruin = true;
          this.note('clear_ruin', owner, null);
          continue;
        }
        if (!owner && r.owner !== 'village') P.transfer(id, 'village', 'reclaimed');
        if (P.rec(id)?.owner !== 'village') continue;
        // The public works fund pays.
        const I = sim.infra;
        const need = Math.ceil(cost * 1.3); // (with a little over, as for any works)
        if (I && I.S.fund >= need) {
          I.S.fund -= need;
          sim.state.village.treasury += need;
        }
        if (S.start(id, job, 'village').ok) {
          ruin = true;
          this.note('clear_ruin', 'village', null);
        }
        continue;
      }
      // An empty house to let on a busy street: its owner makes it a shop.
      if (shop || !P.isHome(id) || r.owner === 'player' || r.owner === 'village' || !P.isVacant(id)) continue;
      if ((r.emptyDays || 0) < D.convertEmptyDays) continue;
      const d = sim.places?.districtAt(b.door.tx, b.door.ty);
      if (!d || !D.convertDistricts.includes(d.type) || !S.conversions(id).includes('shopfront')) continue;
      const owner = sim.npcs.byId(r.owner);
      if (!owner) continue;
      if (S.start(id, { type: 'convert', to: 'shopfront' }, owner.id).ok) {
        shop = true;
        sim.chronicle('chronicle.npc_converted', { npc: owner.id, gender: owner.gender, building: id });
        this.note('convert', owner, null);
      }
    }
  }

  /** The villager with plans for this plot, if any (for the land panel). */
  plannerOf(plotId) {
    return this.sim.state.npcs.find((n) => n.landPlan?.plot === plotId) || null;
  }
}
