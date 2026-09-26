/**
 * StandingOrders — work you set up once and your workers keep doing, day after day
 * (mixed into WorkerSystem, like WorkforceManager):
 *
 *   move    — carry so much of something a day from one place to another
 *             ("60 wood a day from my lumberyard to my warehouse")
 *   keep    — keep at least so much of something at a place ("50 planks in my storage"):
 *             fetched from your storage or businesses, bought, or gathered — whatever you allowed
 *   supply  — keep a building site supplied with everything it still needs
 *
 *   state.workforce.orders = [{ id, kind, item, from, to, qty, workers: [ids] (empty: anyone),
 *                               prio: high|medium|low, paused, day, moved, total, made, why }]
 *
 * Places: 'store' (your storage — the warehouse, shed or home), 'biz:<id>' (a business of yours),
 * 'site:<id>' (a building site). Sources can also be 'buy' (the cheapest seller, within the day's
 * spending limit), 'gather' (trees, rocks, bushes) or 'auto' (storage → your businesses → buy → gather).
 *
 * It's all physical: a worker walks to the source (a free loading point), loads what the order
 * still needs (as much as their barrow holds), carries it over and unloads — and it counts only
 * once it's there. Nothing's reserved in a way that could outlive the worker: what's still needed
 * is worked out from the world each time (target level, what's been moved today, what's in arms).
 */
import { ITEMS } from '../data/items.js';
import { GATHERABLE } from './ContractSystem.js';

export const ORDER_KINDS = ['move', 'keep', 'supply'];
export const ORDER_SOURCES = ['store', 'buy', 'gather', 'auto'];
export const ORDER_PRIO = { high: 300, medium: 80, low: 0 };
export const ORDER_TUNING = { maxOrders: 12, maxQty: 2000, step: 10 };

export const StandingOrders = {
  /** Your standing orders (a method, not a getter: mixins copy getters as values). */
  orderList() {
    const S = this.state;
    S.orders ??= [];
    S.nextOrder ??= 1;
    return S.orders;
  },

  orderById(id) {
    return this.orderList().find((o) => o.id === Number(id)) || null;
  },

  // ------------------------------------------------------------------ places

  /** A place's building (for walking to it): your storage, a business of yours, a site. */
  placeBuilding(place) {
    const sim = this.sim;
    if (place === 'store') return this.baseBuilding();
    if (String(place).startsWith('biz:')) return sim.world.buildings[sim.economy.biz(place.slice(4))?.building] || null;
    return null;
  },
  placeSite(place) {
    return String(place).startsWith('site:') ? this.sim.construction.byId(place.slice(5)) : null;
  },
  /** Is it (still) a place of yours? */
  placeOk(place) {
    const sim = this.sim;
    if (place === 'store') return true;
    if (String(place).startsWith('biz:')) return !!sim.holdings?.isMine(place.slice(4)) && !!sim.economy.biz(place.slice(4));
    const s = this.placeSite(place);
    return !!s && s.status === 'site' && (sim.construction.isPlayers(s) || s.supplier === 'player' || s.contractor === 'player');
  },
  /** How much of an item is at a place. */
  levelAt(place, item) {
    const sim = this.sim;
    if (place === 'store') return this.storeCount(item);
    if (String(place).startsWith('biz:')) return Math.floor(sim.economy.stock(place.slice(4), item) || 0);
    const s = this.placeSite(place);
    return s ? s.delivered[item] || 0 : 0;
  },

  // ------------------------------------------------------------------ making them

  canOrder(o) {
    const sim = this.sim;
    if (!ORDER_KINDS.includes(o.kind)) return { ok: false, reason: 'order_bad' };
    if (this.orderList().length >= ORDER_TUNING.maxOrders) return { ok: false, reason: 'order_too_many', params: { n: ORDER_TUNING.maxOrders } };
    if (!this.placeOk(o.to)) return { ok: false, reason: 'order_no_target' };
    if (o.kind === 'supply') {
      if (!this.placeSite(o.to)) return { ok: false, reason: 'order_no_target' };
      return { ok: true };
    }
    if (!ITEMS[o.item]) return { ok: false, reason: 'order_no_item' };
    if (!(o.qty > 0)) return { ok: false, reason: 'order_no_qty' };
    if (o.from === o.to) return { ok: false, reason: 'order_same_place' };
    if (o.from !== 'buy' && o.from !== 'gather' && o.from !== 'auto' && !this.placeOk(o.from)) return { ok: false, reason: 'order_no_source' };
    if (o.from === 'gather' && !GATHERABLE[o.item] && o.item !== 'clay') return { ok: false, reason: 'order_cant_gather', params: { item: o.item } };
    if (String(o.to).startsWith('site:')) return { ok: false, reason: 'order_use_supply' };
    return { ok: true };
  },

  /** A new standing order. Returns { ok, id }. */
  addOrder(spec) {
    const o = {
      kind: spec.kind,
      item: spec.kind === 'supply' ? null : spec.item,
      from: spec.from || 'auto',
      to: spec.to || 'store',
      qty: Math.max(0, Math.min(ORDER_TUNING.maxQty, Math.round(spec.qty || 0))),
      workers: [...(spec.workers || [])],
      prio: spec.prio || 'medium',
    };
    const chk = this.canOrder(o);
    if (!chk.ok) return chk;
    o.id = this.state.nextOrder++;
    Object.assign(o, { paused: false, day: this.sim.time.day, moved: 0, total: 0, made: this.sim.time.day, why: null });
    this.orderList().push(o);
    this.sim.bus.emit('workers:changed');
    // Anyone waiting for something to do takes it up now.
    for (const c of this.list()) if (c.state === 'waiting' || c.state === 'need_materials') this.equipmentChanged(c.npcId);
    return { ok: true, id: o.id };
  },

  setOrder(id, patch) {
    const o = this.orderById(id);
    if (!o) return false;
    for (const k of ['qty', 'prio', 'paused', 'workers', 'from']) if (patch[k] !== undefined) o[k] = patch[k];
    o.qty = Math.max(0, Math.min(ORDER_TUNING.maxQty, Math.round(o.qty || 0)));
    this.sim.bus.emit('workers:changed');
    return true;
  },

  /** Cancel it: anyone fetching for it stops (what's already in their arms is brought to your storage). */
  removeOrder(id) {
    const o = this.orderById(id);
    if (!o) return false;
    this.state.orders = this.orderList().filter((x) => x !== o);
    for (const c of this.list()) {
      if (c.task?.order !== o.id) continue;
      const npc = this.npcs().byId(c.npcId);
      if (npc) this.interrupt(npc, c);
    }
    this.sim.bus.emit('workers:changed');
    return true;
  },

  // ------------------------------------------------------------------ what's still wanted

  /** A new day: yesterday's count starts again. */
  orderDay(o) {
    if (o.day !== this.sim.time.day) {
      o.day = this.sim.time.day;
      o.moved = 0;
    }
    return o;
  },
  /** On their way to it right now (in your workers' arms and barrows). */
  inflight(o, item = null) {
    let n = 0;
    for (const c of this.list()) {
      const npc = this.npcs().byId(c.npcId);
      const load = npc?.carry;
      if (load?.order !== o.id) continue;
      n += item ? (load.items?.[item] ?? (load.item === item ? load.qty : 0)) : load.qty;
    }
    return n;
  },
  /** How much more the order wants now (for 'supply', item by item). */
  orderNeed(o, item = o.item) {
    this.orderDay(o);
    if (o.kind === 'move') return Math.max(0, o.qty - o.moved - this.inflight(o));
    if (o.kind === 'keep') return Math.max(0, o.qty - this.levelAt(o.to, item) - this.inflight(o));
    const s = this.placeSite(o.to);
    if (!s) return 0;
    return Math.max(0, (this.sim.construction.missing(s)[item] || 0) - this.inflight(o, item));
  },
  /** What a supply order's site is still waiting for. */
  orderItems(o) {
    if (o.kind !== 'supply') return [o.item];
    const s = this.placeSite(o.to);
    return s ? Object.keys(this.sim.construction.missing(s)) : [];
  },

  /**
   * Where to fetch it from right now: { kind: 'place'|'buy'|'gather', place?, building?, seller?, obj? } —
   * or null (nowhere has it; the order waits and says why).
   */
  orderSource(o, item, npc, pos) {
    const sim = this.sim;
    const from = o.kind === 'supply' ? (o.from === 'store' || o.from === 'buy' ? o.from : 'auto') : o.from;
    const tryPlace = (place) => {
      if (place === o.to || !this.placeOk(place) || this.levelAt(place, item) < 1) return null;
      const b = this.placeBuilding(place);
      return b ? { kind: 'place', place, building: b.id, door: b.door } : null;
    };
    const tryBuy = () => {
      if (this.buyBudgetLeft() <= 0) return null;
      const s = this.seller(item, String(o.to).startsWith('biz:') ? o.to.slice(4) : null);
      return s ? { kind: 'buy', seller: s.id, building: sim.economy.biz(s.id).building, door: s.door } : null;
    };
    const tryGather = () => {
      // (Clay is dug at the river pits — IndustrySystem.)
      const k = item === 'clay' ? 'rock' : GATHERABLE[item];
      const obj = k && this.findResource(k, npc, pos, item === 'clay' ? (x) => x.variant === 'clay' : null);
      return obj ? { kind: 'gather', obj } : null;
    };
    if (from === 'buy') return tryBuy();
    if (from === 'gather') return tryGather();
    if (from !== 'auto') return tryPlace(from);
    // Anywhere of yours that has it, then the shops, then the woods.
    const places = ['store', ...(sim.holdings?.mine() || []).map((id) => `biz:${id}`)];
    for (const p of places) {
      const s = tryPlace(p);
      if (s) return s;
    }
    return tryBuy() || tryGather();
  },

  /** The tasks your standing orders offer this worker (WorkerSystem.candidates). */
  orderTasks(npc, c, pos, add) {
    for (const o of this.orderList()) {
      if (o.paused) continue;
      if (!this.placeOk(o.to)) {
        o.why = 'no_target';
        continue;
      }
      if (o.workers.length && !o.workers.includes(npc.id)) continue;
      let any = false;
      for (const item of this.orderItems(o)) {
        if (this.orderNeed(o, item) <= 0) continue;
        any = true;
        const src = this.orderSource(o, item, npc, pos);
        if (!src) {
          o.why = o.from === 'buy' && this.buyBudgetLeft() <= 0 ? 'no_money' : 'no_source';
          continue;
        }
        o.why = null;
        const base = { order: o.id, item, cat: 'hauling', managed: o.workers.length > 0, urgent: ORDER_PRIO[o.prio] ?? 80, cap: o.workers.length || 2 };
        const key = o.kind === 'supply' ? `ord:${o.id}:${item}` : `ord:${o.id}`;
        if (src.kind === 'gather') {
          const g = src.obj.kind === 'tree' ? 'gather_wood' : src.obj.kind === 'bush' ? 'gather_berries' : 'gather_stone';
          add({ ...base, key: `gather:${src.obj.id}`, kind: g, target: src.obj.id, tx: src.obj.tx, ty: src.obj.ty, cap: 1 });
        } else add({ ...base, key, kind: 'ofetch', target: src.building, from: src.kind === 'buy' ? 'buy' : src.place, seller: src.seller, tx: src.door.tx, ty: src.door.ty });
      }
      if (!any && o.why !== 'no_target') o.why = null;
    }
  },

  /** At the source: load what the order still wants (as much as they can carry), and off with it. */
  orderFetch(npc, c, t) {
    const sim = this.sim;
    const o = this.orderById(t.order);
    if (!o) return this.next(npc);
    const want = Math.min(this.carryCap(npc), this.orderNeed(o, t.item));
    let got = 0;
    if (want > 0) {
      if (t.from === 'buy') {
        const price = this.unitPrice(t.seller, t.item);
        got = Math.min(want, Math.floor(sim.economy.stock(t.seller, t.item)), Math.floor(this.buyBudgetLeft() / price));
        if (got > 0) this.buyFor(npc, t.seller, t.item, got, price);
      } else if (t.from === 'store') got = this.storeTake(t.item, want);
      else if (String(t.from).startsWith('biz:')) {
        const B = sim.economy.biz(t.from.slice(4));
        got = Math.min(want, Math.floor(B?.stock[t.item] || 0));
        if (got > 0) B.stock[t.item] -= got;
      }
    }
    if (got <= 0) {
      this.block(c, t, 60);
      return this.next(npc);
    }
    npc.carry = { item: t.item, qty: got, items: { [t.item]: got }, to: `ord:${o.id}`, order: o.id };
    return this.loaded(npc, c);
  },

  /** Where an order's load goes: the site, a business of yours, your storage. */
  orderDeliver(npc, c) {
    const o = this.orderById(npc.carry.order);
    if (!o || !this.placeOk(o.to)) {
      // The order's gone (or the place isn't yours any more): to your storage with it.
      npc.carry.to = null;
      delete npc.carry.order;
      return false;
    }
    const site = this.placeSite(o.to);
    if (site) return this.carryTo(npc, c, site.id), true;
    return this.carryToBuilding(npc, c, this.placeBuilding(o.to)), true;
  },

  /** Arrived: put it where the order wanted it — counted now, and not before. */
  orderUnload(npc, c, load) {
    const sim = this.sim;
    const o = this.orderById(load.order);
    npc.carry = null;
    if (!o || !this.placeOk(o.to)) {
      npc.carry = { item: load.item, qty: load.qty, items: { ...(load.items || { [load.item]: load.qty }) } }; // (to your storage)
      return;
    }
    let put = 0;
    const items = load.items || { [load.item]: load.qty };
    const rest = {};
    const site = this.placeSite(o.to);
    for (const [item, q] of Object.entries(items)) {
      let n = q;
      if (site) n = Math.min(q, sim.construction.missing(site)[item] || 0);
      if (n > 0) {
        if (site) sim.construction.receive(site, item, n);
        else if (o.to === 'store') sim.home.store(item, n, { force: true });
        else {
          const B = sim.economy.biz(o.to.slice(4));
          B.stock[item] = (B.stock[item] || 0) + n;
        }
        put += n;
      }
      if (q - n > 0) rest[item] = q - n;
    }
    this.orderDay(o);
    o.moved += put;
    o.total = (o.total || 0) + put;
    o.lastDay = sim.time.day;
    if (Object.keys(rest).length) npc.carry = { item: Object.keys(rest)[0], qty: Object.values(rest).reduce((a, b) => a + b, 0), items: rest };
    if (c.task?.order === o.id) this.completed(npc, c);
  },

  /** For the orders list: how it's going today, in words and numbers. */
  orderStatus(o) {
    this.orderDay(o);
    const items = this.orderItems(o);
    const need = items.reduce((s, i) => s + this.orderNeed(o, i), 0);
    const busy = this.list().filter((c) => c.task?.order === o.id || this.npcs().byId(c.npcId)?.carry?.order === o.id).map((c) => c.npcId);
    let state = 'working';
    if (o.paused) state = 'paused';
    else if (!this.placeOk(o.to)) state = 'no_target';
    else if (need <= 0 && !busy.length) state = 'done_today';
    else if (!busy.length && o.why) state = o.why;
    else if (!busy.length) state = 'waiting';
    const level = o.kind === 'keep' ? this.levelAt(o.to, o.item) : null;
    const site = this.placeSite(o.to);
    return { state, need, busy, level, left: site ? Object.values(this.sim.construction.missing(site)).reduce((a, b) => a + b, 0) : null };
  },
};
