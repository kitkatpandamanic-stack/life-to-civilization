/**
 * ColonySystem — a settlement of your own, founded on open land well away from the village.
 *
 *   11.1 the founding — you place a founding stone (build mode) where the land is open and explored,
 *        with the headman's charter; when it stands, the settlement is founded: a cart track to the
 *        nearest road, a name (yours to change), an empty purse.
 *   11.2 settlers — villagers who wanted to leave, the homeless, friends, and some of the newcomers to the
 *        valley; each household builds a home there (the settlement's purse helps). Its store must see
 *        them through the winter (food, firewood) — hungry too long and a household gives up.
 *   11.3 the plan — a street, or homes round a green: where the homes, the well and the market go.
 *   11.4 running it — taxes into its purse, landmarks built from it, and it grows: camp → hamlet → village.
 *
 *   state.colony = { tx, ty, nameIdx, name, founded, stage, settlers: [id], stock: {item: n}, treasury,
 *                    tax, layout, plan: [{ kind, tx, ty, site?, done? }], hungry, log: [] } | null
 * Everyone in it is a villager like any other (the village's systems run their lives); this adds the place.
 * No dice: who comes and who gives up is worked out from how things stand (and a fixed hash).
 */
import { hashStr } from '../core/rng.js';
import { COLONY, LANDMARKS, LAYOUTS, COLONY_NAMES } from '../data/colony.js';
import { ITEMS } from '../data/items.js';
import { AREAS } from '../data/villageLayout.js';
import { VILLAGE_BUILDINGS } from '../data/villageBuildings.js';

const PLAZA_C = { tx: Math.round((AREAS.plaza.x1 + AREAS.plaza.x2) / 2), ty: Math.round((AREAS.plaza.y1 + AREAS.plaza.y2) / 2) };

export class ColonySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.colony ??= null;
    sim.bus.on('construction:changed', () => this.checkStone());
    sim.bus.on('time:day', () => this.daily());
    sim.bus.on('settlement:arrived', (ids) => this.onArrived(ids));
  }

  get C() {
    return this.sim.state.colony;
  }
  exists() {
    return !!this.C;
  }

  // ------------------------------------------------------------------ 11.1 the founding

  /** The headman's charter: yours if you are the headman, are well thought of, or are their friend. */
  charter() {
    const sim = this.sim;
    const head = sim.state.civic?.headman;
    if (head === 'player') return { ok: true };
    if ((sim.state.player.reputation || 0) >= COLONY.charterRep) return { ok: true };
    const h = head && sim.npcs.byId(head);
    if (h && (h.rel || 0) >= COLONY.charterRel) return { ok: true };
    return { ok: false, reason: 'need_charter', params: { n: COLONY.charterRep, npc: h?.id } };
  }

  /** Could a settlement be founded here (for the founding stone's placement)? */
  canFound(tx, ty) {
    const sim = this.sim;
    if (this.C) return { ok: false, reason: 'colony_exists' };
    if (Math.hypot(tx - PLAZA_C.tx, ty - PLAZA_C.ty) < COLONY.minDistance) return { ok: false, reason: 'too_close_to_village', params: { n: COLONY.minDistance } };
    if (!sim.exploration.isSeen(tx, ty)) return { ok: false, reason: 'not_explored' };
    const owner = sim.territory?.ownerAt(tx, ty);
    if (owner && owner !== 'player' && owner !== 'village') return { ok: false, reason: 'land_taken' };
    return this.charter();
  }

  /** The stone stands: the settlement is founded. */
  checkStone() {
    if (this.C) return;
    const stone = this.sim.construction.finished().find((c) => c.type === 'founding_stone');
    if (stone) this.found(stone);
  }

  found(stone) {
    const sim = this.sim;
    sim.state.colony = {
      stone: stone.id,
      tx: stone.tx,
      ty: stone.ty,
      nameIdx: Math.floor(hashStr(`colony:${stone.id}`, sim.state.seed) * COLONY_NAMES),
      name: null,
      founded: sim.time.day,
      stage: 'camp',
      settlers: [],
      stock: {},
      treasury: 0,
      tax: 'normal',
      layout: null,
      plan: [],
      hungry: 0,
      log: [],
    };
    // The charter comes with a cart track to the nearest road.
    this.track(stone.tx, stone.ty + 1);
    this.note('founded', {});
    sim.chronicle('chronicle.colony_founded', { colony: this.nameKey() });
    sim.bus.emit('colony:changed');
  }

  /** The settlement's name, as data for the chronicle (its own name, or one from the list). */
  nameKey() {
    return this.C?.name || `#${this.C?.nameIdx ?? 0}`;
  }

  rename(text) {
    const name = String(text || '').trim().slice(0, 24);
    if (!this.C || !name) return { ok: false, reason: 'bad_name' };
    this.C.name = name;
    this.sim.bus.emit('colony:changed');
    return { ok: true };
  }

  /** A road from a tile to the nearest road (over open ground), laid there and then. Returns tiles laid. */
  track(tx, ty, reach = 120) {
    const world = this.sim.world;
    const key = (x, y) => y * world.W + x;
    const prev = new Map([[key(tx, ty), null]]);
    const q = [{ tx, ty }];
    let end = null;
    while (q.length && !end) {
      const cur = q.shift();
      if (Math.abs(cur.tx - tx) + Math.abs(cur.ty - ty) > reach) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        const k = key(nx, ny);
        if (!world.inBounds(nx, ny) || prev.has(k)) continue;
        prev.set(k, cur);
        if (world.isRoad(nx, ny)) {
          end = cur;
          break;
        }
        if (world.isBlocked(nx, ny) || world.isWater(nx, ny) || this.sim.state.fields[`${nx},${ny}`]) continue;
        q.push({ tx: nx, ty: ny });
      }
    }
    let laid = 0;
    for (let cur = end; cur; cur = prev.get(key(cur.tx, cur.ty))) laid += this.road(cur.tx, cur.ty);
    return laid;
  }

  road(x, y) {
    const world = this.sim.world;
    if (!world.inBounds(x, y) || world.isRoad(x, y) || world.isBlocked(x, y) || world.isWater(x, y)) return 0;
    world.setRoad(x, y);
    this.sim.state.land.roads.push(`${x},${y}`);
    this.sim.bus.emit('road:built', { tx: x, ty: y });
    return 1;
  }

  // ------------------------------------------------------------------ 11.3 the plan

  /** Choose the layout: the street is laid now; the plan marks where homes, the well and the market go. */
  setLayout(id) {
    const C = this.C;
    const L = LAYOUTS[id];
    if (!C || !L) return { ok: false, reason: 'unknown' };
    if (C.layout) return { ok: false, reason: 'plan_made' };
    C.layout = id;
    // The street (straight runs between the corner points).
    for (let i = 0; i + 1 < L.street.length; i++) {
      const [a, b] = [L.street[i], L.street[i + 1]];
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      for (let s = 0; s <= steps; s++) this.road(C.tx + Math.round(a[0] + ((b[0] - a[0]) * s) / steps), C.ty + Math.round(a[1] + ((b[1] - a[1]) * s) / steps));
    }
    C.plan = [...L.homes.map(([dx, dy]) => ({ kind: 'home', tx: C.tx + dx, ty: C.ty + dy })), { kind: 'well', tx: C.tx + L.well[0], ty: C.ty + L.well[1] }, { kind: 'market', tx: C.tx + L.market[0], ty: C.ty + L.market[1] }];
    this.note('planned', { layout: id });
    this.sim.bus.emit('colony:changed');
    return { ok: true };
  }

  // ------------------------------------------------------------------ 11.2 settlers

  /** Is this spot in your settlement? */
  covers(tx, ty) {
    return !!this.C && Math.hypot(tx - this.C.tx, ty - this.C.ty) <= COLONY.radius + 2;
  }

  settlers() {
    return (this.C?.settlers || []).map((id) => this.sim.npcs.byId(id)).filter(Boolean);
  }

  isSettler(npc) {
    return !!this.C && this.C.settlers.includes(npc?.id);
  }

  /** Would this villager come and settle? */
  canRecruit(npc) {
    const sim = this.sim;
    if (!this.C) return { ok: false, reason: 'no_colony' };
    if (!npc || npc.age < 16 || npc.away) return { ok: false, reason: 'not_now' };
    if (this.isSettler(npc)) return { ok: false, reason: 'already_settler' };
    if (sim.state.civic?.headman === npc.id) return { ok: false, reason: 'wont_move' };
    const leaving = npc.goal?.type === 'leave';
    const rootless = !npc.homeId || npc.homeId === 'hall' || npc.occupation === 'unemployed';
    if (!leaving && !rootless && (npc.rel || 0) < COLONY.settlerRel) return { ok: false, reason: 'wont_move', params: { n: COLONY.settlerRel } };
    return { ok: true };
  }

  /** They come, with their household: a home of their own there (the settlement's purse helps). */
  recruit(npc) {
    const chk = this.canRecruit(npc);
    if (!chk.ok) return chk;
    return { ok: true, n: this.settle(npc) };
  }

  settle(npc) {
    const sim = this.sim;
    const household = [npc, sim.family.spouse(npc), ...sim.family.children(npc).filter((k) => k.homeId === npc.homeId && k.age < 20)].filter(Boolean);
    for (const n of household) {
      if (!this.C.settlers.includes(n.id)) this.C.settlers.push(n.id);
      if (n.goal?.type === 'leave') n.goal = null; // (they're staying — out there)
      sim.memory.remember(n, 'became_settler', { who: 'player', params: {} });
    }
    this.startHome(npc);
    this.note('settled', { npc: npc.id, n: household.length });
    sim.bus.emit('colony:changed');
    return household.length;
  }

  /**
   * Where a building goes in the settlement: on the plan's spot (or as near it as the ground allows), with
   * a road within reach — and never outside the settlement. null if there's no room just now.
   */
  lotFor(type, spot, by) {
    const sim = this.sim;
    const G = sim.growth;
    const def = VILLAGE_BUILDINGS[type];
    const C = this.C;
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = spot.tx + dx;
          const ty = spot.ty + dy;
          if (Math.hypot(tx - C.tx, ty - C.ty) > COLONY.radius + 2) continue;
          if (!G.lotFree(tx, ty, def.w, def.h, by)) continue;
          if (G.roadDistance(tx + Math.floor(def.w / 2), ty + def.h) > 8) continue;
          return { tx, ty, score: r };
        }
      }
    }
    const lot = G.findLot(type, spot, by);
    return lot && Math.hypot(lot.tx - C.tx, lot.ty - C.ty) <= COLONY.radius + 4 ? lot : null;
  }

  /** A settler's house, on the next free plot of the plan (or near the stone). */
  startHome(npc) {
    const sim = this.sim;
    const C = this.C;
    const plot = C.plan.find((p) => p.kind === 'home' && !p.site) || { tx: C.tx, ty: C.ty + 3 };
    const lot = this.lotFor(COLONY.houseType, plot, npc.id);
    if (!lot) {
      npc.colonyWaiting = true;
      return null;
    }
    const cost = sim.growth.estimate(COLONY.houseType);
    const help = Math.max(0, Math.min(C.treasury, Math.round(cost * COLONY.houseSubsidy) - Math.max(0, npc.money)));
    npc.money = (npc.money || 0) + help;
    C.treasury -= help;
    const site = sim.growth.start(npc, COLONY.houseType, 'home', { tx: plot.tx, ty: plot.ty }, { lot });
    if (!site) {
      // (no lot to be had just now: the money waits in the purse, and they'll try again next week)
      npc.money -= help;
      C.treasury += help;
      npc.colonyWaiting = true;
      return null;
    }
    delete npc.colonyWaiting;
    if (C.plan.includes(plot)) plot.site = site.id;
    site.colony = true;
    return site;
  }

  /** Newcomers to the valley: some go on to your settlement (more as it grows, fewer if the taxes are high). */
  onArrived(ids) {
    const sim = this.sim;
    if (!this.C || !ids?.length) return;
    const share = COLONY.newcomerShare + (this.C.stage === 'hamlet' ? 0.1 : this.C.stage === 'village' ? 0.2 : 0) + (COLONY.taxPull[this.C.tax] || 0);
    if (hashStr(`newcomers:${ids[0]}`, sim.state.seed) >= share) return;
    const head = ids.map((id) => sim.npcs.byId(id)).find((n) => n && n.age >= 18);
    if (head) {
      this.settle(head);
      sim.toast('toast.colony_newcomers', { npc: head.id, colony: this.nameKey() }, 'good');
    }
  }

  /** The homes in the settlement (built, lived in by settlers). */
  homes() {
    const sim = this.sim;
    const C = this.C;
    if (!C) return [];
    return sim.world.buildingList.filter((b) => sim.property.isHome(b.id) && Math.hypot(b.tx - C.tx, b.ty - C.ty) <= COLONY.radius + 4 && sim.npcs.residentsOf(b.id).some((n) => C.settlers.includes(n.id)));
  }

  // ------------------------------------------------------------------ 11.4 running it

  /** Money into the settlement's purse (yours to give). */
  donate(money) {
    const p = this.sim.state.player;
    if (!this.C || money <= 0 || p.money < money) return { ok: false, reason: 'no_money' };
    this.donated(money);
    this.C.treasury += money;
    return { ok: true };
  }
  /** (LedgerSystem books this as spending on the settlement.) */
  donated(money) {
    this.sim.state.player.money -= money;
  }

  setTax(rate) {
    if (this.C && COLONY.tax[rate] !== undefined) this.C.tax = rate;
  }

  /** Food and firewood from your pockets into the settlement's store (at the founding stone). */
  leaveSupplies() {
    const sim = this.sim;
    if (!this.C) return { ok: false, reason: 'no_colony' };
    let n = 0;
    for (const s of sim.inventory.slots.slice()) {
      const food = ITEMS[s.id]?.category === 'food';
      if (!food && s.id !== 'wood') continue;
      const q = sim.inventory.count(s.id);
      if (!q) continue;
      sim.inventory.remove(s.id, q);
      this.C.stock[s.id] = (this.C.stock[s.id] || 0) + q;
      n += q;
    }
    if (!n) return { ok: false, reason: 'nothing_to_leave' };
    this.note('supplies', { n });
    sim.bus.emit('colony:changed');
    return { ok: true, n };
  }

  foodStock() {
    return Object.entries(this.C?.stock || {}).filter(([id]) => ITEMS[id]?.category === 'food').reduce((s, [, n]) => s + n, 0);
  }

  /** What a winter's day takes from the store: food for everyone, firewood for each home. */
  winterNeed() {
    return { food: this.settlers().length * COLONY.foodPerSettler, wood: this.homes().length * COLONY.woodPerHome };
  }

  /** Days of winter the store would last. */
  daysOfWinter() {
    const need = this.winterNeed();
    const f = need.food ? this.foodStock() / need.food : Infinity;
    const w = need.wood ? (this.C.stock.wood || 0) / need.wood : Infinity;
    return Math.floor(Math.min(f, w));
  }

  take(kind, n) {
    const C = this.C;
    let left = n;
    for (const id of Object.keys(C.stock)) {
      if (left <= 0) break;
      if (kind === 'food' ? ITEMS[id]?.category !== 'food' : id !== 'wood') continue;
      const q = Math.min(left, C.stock[id]);
      C.stock[id] -= q;
      left -= q;
      if (!C.stock[id]) delete C.stock[id];
    }
    return n - left;
  }

  canBuild(key) {
    const C = this.C;
    const L = LANDMARKS[key];
    if (!C || !L) return { ok: false, reason: 'unknown' };
    if (!C.layout) return { ok: false, reason: 'need_plan' };
    const spot = C.plan.find((p) => p.kind === key);
    if (spot?.site) return { ok: false, reason: 'already_building' };
    if (C.treasury < L.cost) return { ok: false, reason: 'colony_purse', params: { money: L.cost } };
    return { ok: true, spot };
  }

  /** A landmark from the purse: the well by the village's builders; the market by a settler, helped. */
  build(key) {
    const chk = this.canBuild(key);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const C = this.C;
    const L = LANDMARKS[key];
    let site = null;
    if (L.purpose === 'shop') {
      const keeper = this.settlers().filter((n) => n.age >= 18 && !n.owns).sort((a, b) => (b.money || 0) - (a.money || 0))[0];
      if (!keeper) return { ok: false, reason: 'no_keeper' };
      keeper.money = (keeper.money || 0) + L.cost;
      const lot = this.lotFor(L.type, chk.spot, keeper.id);
      site = lot ? sim.growth.start(keeper, L.type, 'shop', chk.spot, { bizType: L.bizType, lot }) : null;
      if (!site) keeper.money -= L.cost;
    } else {
      const lot = this.lotFor(L.type, chk.spot, 'village');
      if (lot) {
        site = sim.construction.startProject({ owner: 'village', type: L.type, tx: lot.tx, ty: lot.ty, purpose: 'public', budget: L.cost });
        sim.growth.clearLot(site);
      }
    }
    if (!site) return { ok: false, reason: 'colony_no_room' };
    C.treasury -= L.cost;
    chk.spot.site = site.id;
    site.colony = true;
    this.note('landmark', { landmark: key });
    sim.bus.emit('colony:changed');
    return { ok: true, site: site.id };
  }

  /** Is this landmark standing (finished)? */
  built(key) {
    const spot = this.C?.plan.find((p) => p.kind === key);
    const c = spot?.site && this.sim.construction.byId(spot.site);
    return !!c && c.status !== 'site';
  }

  /** Camp → hamlet → village: by how many live there, how many homes, and what's been built. */
  stageNow() {
    const n = this.settlers().length;
    const homes = this.homes().length;
    let stage = 'camp';
    for (const s of COLONY.stages) if (n >= s.settlers && homes >= s.homes && (s.landmarks || []).every((k) => this.built(k))) stage = s.id;
    return stage;
  }

  daily() {
    const sim = this.sim;
    const C = this.C;
    if (!C) return;
    // Settlers who've died or left are no longer counted.
    C.settlers = C.settlers.filter((id) => sim.npcs.byId(id));
    // Winter: the store feeds them and keeps their fires lit — or it doesn't.
    if (sim.time.season === 'winter' && C.settlers.length) {
      const need = this.winterNeed();
      const food = this.take('food', need.food);
      const wood = this.take('wood', need.wood);
      if (food < need.food || wood < need.wood) {
        C.hungry++;
        if (C.hungry === 1) sim.toast('toast.colony_hungry', { colony: this.nameKey() }, 'danger');
        if (C.hungry >= COLONY.hungryDaysToLeave) this.giveUp();
      } else C.hungry = 0;
    } else C.hungry = 0;
    if (sim.time.weekday === 6) this.weekly();
  }

  /** How living out there feels (NPCSystem mood): a hungry winter is hard; otherwise, pioneers' pride. */
  moodEffect(npc) {
    if (!this.isSettler(npc)) return 0;
    return this.C.hungry > 0 ? -15 : 3;
  }

  /** A hungry household gives up: back to the village (or away down the road). */
  giveUp() {
    const sim = this.sim;
    const C = this.C;
    const last = this.settlers().filter((n) => n.age >= 18).pop();
    if (!last) return;
    const household = [last, sim.family.spouse(last), ...sim.family.children(last)].filter(Boolean);
    C.settlers = C.settlers.filter((id) => !household.some((n) => n.id === id));
    C.hungry = 0;
    this.note('gave_up', { npc: last.id });
    sim.toast('toast.colony_gave_up', { npc: last.id, colony: this.nameKey() }, 'danger');
  }

  weekly() {
    const sim = this.sim;
    const C = this.C;
    // Taxes into the purse.
    const rate = COLONY.tax[C.tax] || 0;
    for (const n of this.settlers()) {
      if (n.age < 18 || (n.money || 0) < rate) continue;
      n.money -= rate;
      C.treasury += rate;
    }
    // Settlers still waiting for a lot try again.
    for (const n of this.settlers()) if (n.colonyWaiting) this.startHome(n);
    // Growing up.
    const stage = this.stageNow();
    if (stage !== C.stage) {
      const order = COLONY.stages.map((s) => s.id);
      const up = order.indexOf(stage) > order.indexOf(C.stage);
      C.stage = stage;
      if (up) {
        sim.chronicle('chronicle.colony_grew', { colony: this.nameKey(), stage });
        sim.toast('toast.colony_grew', { colony: this.nameKey(), stage }, 'good');
      }
    }
  }

  note(key, params) {
    this.C.log.unshift({ day: this.sim.time.day, key, params });
    if (this.C.log.length > 30) this.C.log.pop();
  }
}
