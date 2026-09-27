/**
 * CommunitySystem — the village's life together, out in the world:
 *
 *   Weddings   the day after a wedding, a feast on the square in the evening: family and friends come,
 *              the couple and everyone there are happier and closer; be there and they remember it.
 *   Funerals   the morning after someone dies, family and friends gather by the hall; grief shared is
 *              lighter (a little comfort, and the mourners draw closer).
 *   Name days  every villager has one: good friends come round in the evening, and a gift from you that
 *              day counts double (SocialSystem.gift).
 *   Market day once a week traders come to the square: villagers crowd in, your stall sells more
 *              (StallSystem), and the traders sell rare goods and pay well for crafts (MarketPanel).
 *   The poor   out of work and nearly out of money: the village pays for an afternoon's public work
 *              (mending the lanes, sweeping the square); the generous give to the poorest; a village
 *              landlord won't turn a family with children out while poor relief lasts.
 *   Youths     13–17, with a parent who works at a business: after lessons they lend a hand there —
 *              a little pocket money, a little help for the business, a trade learnt (and at 16 they
 *              know it: employers take them on more readily, and they're less likely to leave).
 *
 * All of it is physical: people are pulled to the place (HabitSystem asks pull()), you see them there.
 * No dice: who goes follows hashStr of the person and the day.
 *
 *   state.community = { events: [{ id, kind, day, from, to, at, host, guests, done }], nextId, marketBuys: {…},
 *                       charityDay, lastCharityNews, publicWork: { paid, days } }
 */
import { AREAS } from '../data/villageLayout.js';
import { ITEMS } from '../data/items.js';
import { hashStr } from '../core/rng.js';

export const COMMUNITY = {
  wedding: { from: 16, to: 21, go: 0.85, friendF: 30, mood: 6, coupleMood: 12, rel: 4, youRep: 1, youRel: 4 },
  funeral: { from: 10, to: 12, go: 0.8, friendF: 40, comfort: 4, rel: 2 },
  nameDay: { from: 18, to: 21, friendF: 45, mood: 5, giftMult: 2 },
  market: { weekday: 4, from: 9, to: 16, go: 0.45, stallMult: 1.8, sellMult: 1.2, buyMult: 1.3 },
  // What the traders bring (and how many a week), and what they'll buy.
  marketSells: { glass: 6, iron_ingot: 4, gemstone: 2, apple_sapling: 6, sapling: 10, cheese: 8, pumpkin_seeds: 10, honey: 6, fishing_rod: 1, bow: 1 },
  marketBuys: ['stool', 'chair', 'table', 'cabinet', 'planks', 'bricks', 'wool', 'hide', 'honey', 'apple', 'resin', 'egg', 'milk'],
  // Public work: an afternoon gathering deadwood and stone and mending the lanes. What they gather is sold to the
  // traders (yield — so it always pays that much); the village tops it up to the wage when it can.
  // Summer: on a hot afternoon some go down to the lake to swim (and cool off). Winter: the lake freezes over.
  swim: { from: 13, to: 18, hot: 22, go: 0.25, ages: [8, 45], mood: 3 },
  // Ordering from the traders: they bring it next market day (a quarter down now, the rest when you collect).
  traderOrder: { markup: 1.35, deposit: 0.25, maxOpen: 3, maxQty: 20, items: ['iron_ingot', 'glass', 'gemstone', 'bricks', 'planks', 'iron_axe', 'iron_pickaxe', 'saw', 'hammer', 'wool', 'hide', 'cheese', 'apple_sapling', 'pumpkin_seeds', 'cabbage_seeds'] },
  poor: { below: 40, from: 13, to: 17, wage: 9, yield: 6, perPop: 8, max: 8 },
  charity: { richAbove: 260, gift: 15, poorBelow: 15, newsEvery: 28 },
  youth: { from: 13, to: 17, weekdays: [0, 1, 2, 3, 4], hours: [14, 17], helpPower: 0.3, pocket: 2, learn: 0.6, knowsAfter: 15 },
};

const key = (n, day, what) => `${what}:${n.id}:${day}`;

export class CommunitySystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.community ??= { events: [], nextId: 1, marketBought: {}, charityDay: -1, lastCharityNews: -999, publicWork: { paid: 0, days: 0 } };
    sim.state.community.traderOrders ??= [];
    sim.bus.on('chronicle', (e) => this.onChronicle(e));
    sim.bus.on('time:hour', (h) => this.onHour(h));
    sim.bus.on('time:day', () => this.onDay());
    // Every ten minutes: are you at a feast or a funeral?
    sim.bus.on('time:minute', (m) => {
      if (m % 10 !== 0 || !this.current().length) return;
      const t = sim.world.toTile(sim.state.player.x, sim.state.player.y);
      this.playerAt(t.tx, t.ty);
    });
  }

  get S() {
    return this.sim.state.community;
  }
  get T() {
    return this.sim.time;
  }

  plazaSpot() {
    const P = AREAS.plaza;
    return { tx: Math.round((P.x1 + P.x2) / 2), ty: Math.round((P.y1 + P.y2) / 2) };
  }

  /** In front of the hall (a funeral gathers there). */
  hallSpot() {
    const b = this.sim.world.buildings.hall;
    return b ? { tx: b.door.tx, ty: b.door.ty + 2 } : this.plazaSpot();
  }

  // ------------------------------------------------------------------ weddings and funerals

  onChronicle(e) {
    const k = e.key;
    if (k === 'chronicle.npc_married') this.plan('wedding', e.params.npc, e.params.npc2);
    else if (k === 'chronicle.npc_died') this.plan('funeral', e.params.npc);
  }

  /** The feast (or the funeral) tomorrow. */
  plan(kind, a, b = null) {
    const sim = this.sim;
    const C = COMMUNITY[kind];
    const who = [a, b].filter(Boolean);
    const guests = new Set();
    for (const id of who) {
      const p = sim.family.person(id);
      if (!p) continue;
      for (const r of kind === 'funeral' ? sim.family.relatives(p) : sim.family.relatives(p)) guests.add(r.id);
      for (const [fid, v] of Object.entries(p.relations || {})) if ((v.f ?? 0) >= C.friendF && sim.npcs.byId(fid)) guests.add(fid);
    }
    for (const id of who) guests.delete(id);
    const ev = { id: this.S.nextId++, kind, day: this.T.day + 1, from: C.from, to: C.to, at: kind === 'funeral' ? this.hallSpot() : this.plazaSpot(), host: who, guests: [...guests], came: [], you: false, done: false };
    this.S.events.push(ev);
    if (this.S.events.length > 30) this.S.events.splice(0, this.S.events.length - 30);
    return ev;
  }

  /** Events on right now. */
  current() {
    const h = this.T.hourFloat;
    return this.S.events.filter((e) => !e.done && e.day === this.T.day && h >= e.from && h < e.to);
  }

  eventTime(e) {
    return (this.T.day * 24 + e.to) * 60;
  }

  // ------------------------------------------------------------------ name days

  /** A villager's name day: a day of the year of their own. */
  nameDayOf(n) {
    return Math.floor(hashStr(`nameday:${n.id}`, this.sim.state.seed) * 56);
  }
  isNameDay(n) {
    return !!n && n.age >= 3 && this.nameDayOf(n) === this.T.day % 56;
  }
  nameDaysToday() {
    return this.sim.state.npcs.filter((n) => this.isNameDay(n));
  }

  // ------------------------------------------------------------------ market day

  marketDay() {
    const M = COMMUNITY.market;
    return this.T.weekday === M.weekday;
  }
  marketOpen() {
    const M = COMMUNITY.market;
    const h = this.T.hourFloat;
    return this.marketDay() && h >= M.from && h < M.to;
  }
  /** Days until the next market day (0: today). */
  daysToMarket() {
    return (COMMUNITY.market.weekday - this.T.weekday + 7) % 7;
  }

  /** What the traders have this week (a few of each, by the week). */
  traderStock() {
    const week = Math.floor(this.T.day / 7);
    const bought = this.S.marketBought[week] || {};
    const out = {};
    for (const [item, max] of Object.entries(COMMUNITY.marketSells)) {
      const n = Math.max(1, Math.round(max * (0.5 + hashStr(`mkt:${item}:${week}`, this.sim.state.seed))));
      out[item] = Math.max(0, n - (bought[item] || 0));
    }
    return out;
  }
  traderPrice(item) {
    return Math.max(1, Math.round((ITEMS[item]?.basePrice || 1) * COMMUNITY.market.sellMult));
  }
  traderPays(item) {
    return COMMUNITY.marketBuys.includes(item) ? Math.max(1, Math.round((ITEMS[item]?.basePrice || 1) * COMMUNITY.market.buyMult)) : 0;
  }
  canTrade() {
    if (!this.marketOpen()) return { ok: false, reason: 'market_closed', params: { hour: COMMUNITY.market.from } };
    return { ok: true };
  }
  buyFromTraders(item, qty = 1) {
    const chk = this.canTrade();
    if (!chk.ok) return chk;
    const sim = this.sim;
    const have = this.traderStock()[item] || 0;
    const n = Math.min(qty, have);
    if (n <= 0) return { ok: false, reason: 'traders_sold_out' };
    const price = this.traderPrice(item) * n;
    if (sim.state.player.money < price) return { ok: false, reason: 'no_money' };
    if (!sim.inventory.canAdd(item, n)) return { ok: false, reason: 'too_heavy' };
    sim.state.player.money -= price;
    sim.inventory.add(item, n);
    const week = Math.floor(this.T.day / 7);
    const b = (this.S.marketBought[week] ??= {});
    b[item] = (b[item] || 0) + n;
    this.S.traded = (this.S.traded || 0) + 1;
    for (const w of Object.keys(this.S.marketBought)) if (Number(w) < week - 1) delete this.S.marketBought[w];
    sim.bus.emit('player:changed');
    return { ok: true, n, price };
  }
  sellToTraders(item, qty = 1) {
    const chk = this.canTrade();
    if (!chk.ok) return chk;
    const sim = this.sim;
    const pays = this.traderPays(item);
    if (!pays) return { ok: false, reason: 'traders_dont_buy' };
    const n = Math.min(qty, sim.inventory.count(item));
    if (n <= 0) return { ok: false, reason: 'need_item', params: { item, qty: 1 } };
    sim.inventory.remove(item, n);
    this.S.traded = (this.S.traded || 0) + 1;
    sim.state.player.money += pays * n;
    sim.state.stats.moneyEarned = (sim.state.stats.moneyEarned || 0) + pays * n;
    sim.bus.emit('player:changed');
    return { ok: true, n, money: pays * n };
  }

  // ------------------------------------------------------------------ ordering from the traders

  /** A market day's number (which market day this is, counting from the first). */
  marketNo(day = this.T.day) {
    return Math.floor((day - COMMUNITY.market.weekday + 7) / 7);
  }
  traderOrderPrice(item) {
    return Math.max(1, Math.round((ITEMS[item]?.basePrice || 1) * COMMUNITY.traderOrder.markup));
  }
  canOrderFromTraders(item, qty) {
    const O = COMMUNITY.traderOrder;
    if (!this.marketOpen()) return { ok: false, reason: 'market_closed', params: { hour: COMMUNITY.market.from } };
    if (!O.items.includes(item) || qty < 1 || qty > O.maxQty) return { ok: false, reason: 'nothing_here' };
    if (this.S.traderOrders.filter((o) => !o.collected).length >= O.maxOpen) return { ok: false, reason: 'too_many_trader_orders', params: { n: O.maxOpen } };
    const deposit = Math.ceil(this.traderOrderPrice(item) * qty * O.deposit);
    if (this.sim.state.player.money < deposit) return { ok: false, reason: 'no_money' };
    return { ok: true, deposit };
  }
  /** Ask the traders to bring something next time (a quarter down now). */
  orderFromTraders(item, qty) {
    const chk = this.canOrderFromTraders(item, qty);
    if (!chk.ok) return chk;
    const price = this.traderOrderPrice(item);
    this.sim.state.player.money -= chk.deposit;
    const o = { id: this.S.nextId++, item, qty, price, paid: chk.deposit, due: this.marketNo() + 1, collected: false };
    this.S.traderOrders.push(o);
    this.sim.bus.emit('player:changed');
    return { ok: true, order: o };
  }
  /** What they've brought for you (from the market day it was due). */
  readyOrders() {
    return this.S.traderOrders.filter((o) => !o.collected && this.marketNo() >= o.due);
  }
  canCollect(o) {
    if (!o || o.collected) return { ok: false, reason: 'contract_gone' };
    if (!this.marketOpen() || this.marketNo() < o.due) return { ok: false, reason: 'not_yet_brought' };
    if (this.sim.state.player.money < o.price * o.qty - o.paid) return { ok: false, reason: 'no_money' };
    return { ok: true };
  }
  collectOrder(id) {
    const o = this.S.traderOrders.find((x) => x.id === id);
    const chk = this.canCollect(o);
    if (!chk.ok) return chk;
    const sim = this.sim;
    sim.state.player.money -= o.price * o.qty - o.paid;
    o.paid = o.price * o.qty;
    o.collected = true;
    // What you can carry comes with you; the rest is sent round to your storage.
    const n = Math.min(o.qty, sim.inventory.maxAddable ? sim.inventory.maxAddable(o.item) : o.qty);
    if (n > 0) sim.inventory.add(o.item, n);
    if (o.qty - n > 0) sim.home.store(o.item, o.qty - n, { force: true });
    this.S.traderOrders = this.S.traderOrders.filter((x) => !x.collected || this.marketNo() - x.due < 2);
    sim.bus.emit('player:changed');
    return { ok: true, n: o.qty };
  }

  // ------------------------------------------------------------------ where people go (HabitSystem.newPlan)

  /**
   * A gathering, a day's public work, a youth's afternoon at the family business — or nothing.
   * Returns a plan: { kind: 'gathering' | 'publicwork' | 'help' | 'friends', until, at?, building?, who? }.
   */
  pull(npc) {
    const sim = this.sim;
    if (npc.task?.type === 'sleep') return null;
    const day = this.T.day;
    const h = this.T.hourFloat;
    const seed = sim.state.seed;
    const at = (hh) => (day * 24 + hh) * 60;
    // Your stall's keeper (StallSystem): at the stall till closing.
    const keep = sim.stall?.keeperPlan(npc);
    if (keep) return keep;
    // An afternoon's public work, paid by the village.
    const pw = npc.publicWork;
    const P = COMMUNITY.poor;
    if (pw?.day === day && h >= P.from && h < P.to) return { kind: 'publicwork', until: at(P.to), at: pw.at, why: 'public_work' };
    // A wedding feast, a funeral.
    for (const e of this.current()) {
      if (!e.guests.includes(npc.id) && !e.host.includes(npc.id)) continue;
      if (!e.host.includes(npc.id) && hashStr(key(npc, day, e.kind), seed) > COMMUNITY[e.kind].go) continue;
      return { kind: 'gathering', until: this.eventTime(e), at: e.at, why: e.kind, event: e.id };
    }
    // A youth lends a hand at the family business after lessons.
    const Y = COMMUNITY.youth;
    if (npc.age >= Y.from && npc.age <= Y.to && Y.weekdays.includes(this.T.weekday) && h >= Y.hours[0] && h < Y.hours[1] && !npc.apprentice) {
      const biz = this.familyBusiness(npc);
      const b = biz && sim.economy.biz(biz);
      if (b && sim.world.buildings[b.building] && hashStr(key(npc, day, 'help'), seed) < 0.7) return { kind: 'help', until: at(Y.hours[1]), building: b.building, biz, why: 'help' };
    }
    // Name day: good friends drop round in the evening.
    const N = COMMUNITY.nameDay;
    if (npc.age >= 14 && h >= N.from && h < N.to) {
      for (const host of this.nameDaysToday()) {
        if (host === npc || !host.homeId || host.homeId === npc.homeId) continue;
        const v = npc.relations?.[host.id];
        if (!v || v.f < N.friendF) continue;
        return { kind: 'friends', who: host.id, until: at(N.to), why: 'name_day' };
      }
    }
    // A hot summer afternoon: down to the lake for a swim.
    const SW = COMMUNITY.swim;
    if (this.T.season === 'summer' && h >= SW.from && h < SW.to && npc.age >= SW.ages[0] && npc.age <= SW.ages[1] && !sim.weather.isBad() && (sim.seasons?.temperature() ?? 0) >= SW.hot && hashStr(key(npc, day, 'swim'), seed) < SW.go) {
      const spot = this.swimSpot(npc);
      if (spot) return { kind: 'gathering', until: at(SW.to), at: spot, why: 'swim' };
    }
    // Market day: the square fills up.
    const M = COMMUNITY.market;
    if (this.marketOpen() && npc.age >= 8 && hashStr(key(npc, day, 'market'), seed) < M.go) {
      return { kind: 'gathering', until: Math.min(at(M.to), sim.time.total + 120), at: this.plazaSpot(), why: 'market' };
    }
    return null;
  }

  /** Somewhere on the lake shore to swim from (a few spots, spread by who's going). */
  swimSpot(npc) {
    if (!this.shore) {
      const w = this.sim.world;
      const L = AREAS.lake;
      const out = [];
      if (L) {
        for (let ty = L.cy - L.ry - 2; ty <= L.cy + L.ry + 2; ty++) {
          for (let tx = L.cx - L.rx - 2; tx <= L.cx + L.rx + 2; tx++) {
            if (!w.inBounds(tx, ty) || w.isWater(tx, ty) || w.isBlocked(tx, ty)) continue;
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.isWater(tx + dx, ty + dy))) out.push({ tx, ty });
          }
        }
      }
      this.shore = out;
    }
    if (!this.shore.length) return null;
    return this.shore[Math.floor(hashStr(`shore:${npc.id}`, this.sim.state.seed) * this.shore.length)];
  }

  /** Winter: the lake freezes over (after the first snow, or a few days in). */
  lakeFrozen() {
    const T = this.T;
    return T.season === 'winter' && ((this.sim.seasons?.snow?.() || 0) > 0 || T.dayOfSeason >= 3);
  }

  /** Does this villager's plan keep them out (rain or not, past their usual hour home)? */
  holds(npc) {
    const p = npc.plan;
    if (!p || this.T.total >= p.until) return false;
    return p.kind === 'gathering' || p.kind === 'publicwork' || (p.kind === 'help' && !this.sim.weather.isBad());
  }

  /** Busy today (so no job search): public work, keeping your stall. */
  busyToday(npc) {
    const day = this.T.day;
    return npc.publicWork?.day === day || npc.stallKeeper === day;
  }

  familyBusiness(npc) {
    for (const pid of npc.kin?.parents || []) {
      const p = this.sim.npcs.byId(pid);
      const id = p?.owns || (p?.employer && p.employer !== 'player' ? p.employer : null);
      if (id && this.sim.economy.biz(id) && !this.sim.economy.biz(id).closed) return id;
    }
    return null;
  }

  /** A youth arrived at the family business: counted for the day (EconomySystem.produce, pocket money, the trade). */
  helped(npc, bizId) {
    if (npc.helpedDay === this.T.day) return;
    const sim = this.sim;
    const Y = COMMUNITY.youth;
    npc.helpedDay = this.T.day;
    npc.helpedBiz = bizId;
    const def = sim.economy.def(bizId);
    const occ = def?.workerOccupation || def?.ownerOccupation;
    npc.youthTrade ??= { occ, days: 0 };
    if (npc.youthTrade.occ !== occ) npc.youthTrade = { occ, days: 0 };
    npc.youthTrade.days++;
    for (const f of sim.education?.fieldsOf(occ) || []) sim.education.practise(npc, f, Y.learn);
    const b = sim.economy.biz(bizId);
    if (b && b.money > 60) {
      b.money -= Y.pocket;
      npc.money += Y.pocket;
    }
  }

  /** Youth helpers at this business today (EconomySystem.produce adds them, a little). */
  helpPower(bizId) {
    const day = this.T.day;
    return this.sim.state.npcs.filter((n) => n.helpedDay === day && n.helpedBiz === bizId).length * COMMUNITY.youth.helpPower;
  }

  /** 16: grown up — with the trade they helped at, if they stuck with it. */
  cameOfAge(npc) {
    const t = npc.youthTrade;
    if (t && t.days >= COMMUNITY.youth.knowsAfter && t.occ) {
      npc.prevOccupation = t.occ;
      this.sim.chronicle('chronicle.youth_learnt_trade', { npc: npc.id, gender: npc.gender, occ: t.occ });
    }
  }

  // ------------------------------------------------------------------ the poor

  /** Fit to work, out of work: offered public work rather than handed poor relief (PropertySystem.familySupport). */
  fitToWork(x) {
    return x.occupation === 'unemployed' && x.age >= 16 && x.age < 62 && !x.leaving && !x.away && (x.health ?? 100) >= 40;
  }
  /** Earned yesterday at public work: no handout today (someone not picked still gets poor relief). */
  workInstead(x) {
    const pw = x.publicWork;
    return !!pw && pw.day === this.T.day - 1 && !!pw.worked && this.fitToWork(x);
  }

  /** Noon: the village takes on a few of the poorest for an afternoon's public work. */
  hirePublicWork() {
    const sim = this.sim;
    const P = COMMUNITY.poor;
    const day = this.T.day;
    if (this.T.weekday === 6) return;
    const n = Math.min(P.max, Math.ceil((sim.state.npcs.length + 1) / P.perPop));
    const poor = sim.state.npcs
      .filter((x) => this.fitToWork(x) && x.money < P.below && x.dayLabour?.day !== day)
      .sort((a, b) => a.money - b.money || (a.id < b.id ? -1 : 1))
      .slice(0, n);
    const spots = this.workSpots();
    poor.forEach((x, i) => {
      x.publicWork = { day, at: spots[(i + day) % spots.length], paid: false };
      x.plan = null;
    });
  }

  /** Places that need mending or sweeping: road tiles round the village (the same every day, a few of them). */
  workSpots() {
    if (this.spots) return this.spots;
    const w = this.sim.world;
    const P = this.plazaSpot();
    const out = [];
    for (let r = 4; r < 26 && out.length < 12; r += 3) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        const tx = P.tx + dx;
        const ty = P.ty + dy;
        if (w.inBounds(tx, ty) && w.isRoad(tx, ty) && !w.isBlocked(tx, ty)) out.push({ tx, ty });
      }
    }
    this.spots = out.length ? out : [P];
    return this.spots;
  }

  /** The evening: public work is paid (for those who turned up). */
  payPublicWork() {
    const sim = this.sim;
    const P = COMMUNITY.poor;
    const V = sim.state.village;
    const day = this.T.day;
    for (const x of sim.state.npcs) {
      const pw = x.publicWork;
      if (!pw || pw.day !== day || pw.paid) continue;
      pw.paid = true;
      if (!pw.worked) continue;
      // What they gathered is sold (that much is theirs); the village adds the rest of the wage if it can.
      const top = Math.min(P.wage - P.yield, Math.max(0, V.treasury));
      V.treasury -= top;
      const pay = P.yield + top;
      x.money += pay;
      this.S.publicWork.paid += pay;
      this.S.publicWork.days++;
    }
  }

  /** Weekly: the generous give to the poorest. */
  charity() {
    const sim = this.sim;
    const C = COMMUNITY.charity;
    const givers = sim.state.npcs.filter((n) => n.money > C.richAbove && n.age >= 18 && (n.traits.includes('generous') || n.traits.includes('friendly') || n.traits.includes('loyal')));
    const poor = sim.state.npcs.filter((n) => n.money < C.poorBelow && n.age >= 16 && !n.leaving).sort((a, b) => a.money - b.money || (a.id < b.id ? -1 : 1));
    let given = 0;
    for (const g of givers) {
      const r = poor.shift();
      if (!r) break;
      g.money -= C.gift;
      r.money += C.gift;
      sim.social.addNpcRel(r, g, 6);
      given++;
      if (this.T.day - this.S.lastCharityNews >= C.newsEvery) {
        this.S.lastCharityNews = this.T.day;
        sim.chronicle('chronicle.npc_charity', { npc: g.id, gender: g.gender, npc2: r.id });
      }
    }
    return given;
  }

  /** A village landlord (with poor relief on) doesn't evict a family with children. PropertySystem asks. */
  spareFamily(homeId, landlord) {
    if (landlord !== 'village' || this.sim.state.civic?.policies?.relief === 'low') return false;
    return this.sim.npcs.residentsOf(homeId).some((n) => n.age < 16);
  }

  // ------------------------------------------------------------------ the clock

  onHour(h) {
    if (h === 12) this.hirePublicWork();
    if (h === COMMUNITY.poor.to + 1) this.payPublicWork();
    // Gatherings that are over: everyone who came is glad of it.
    for (const e of this.S.events) if (!e.done && (e.day < this.T.day || (e.day === this.T.day && h >= e.to))) this.finish(e);
    // A name day: the one whose day it is is happy (and you hear about it, if you know them well).
    if (h === 8) {
      for (const n of this.nameDaysToday()) {
        n.mood = Math.min(100, (n.mood ?? 60) + COMMUNITY.nameDay.mood);
        if ((n.rel || 0) >= 30) this.sim.toast('toast.name_day', { npc: n.id }, 'info');
      }
    }
  }

  onDay() {
    if (this.T.weekday === 0) this.charity();
    if (this.marketDay()) this.sim.toast('toast.market_day', {}, 'info');
  }

  /** Every ten minutes the NPCs report in (NPCSystem): who's at the gathering, the public work, the family business. */
  arrived(npc) {
    const p = npc.plan;
    if (!p) return;
    if (p.kind === 'publicwork' && npc.publicWork?.day === this.T.day) npc.publicWork.worked = true;
    if (p.kind === 'help' && p.biz) this.helped(npc, p.biz);
    if (p.kind === 'gathering' && p.event) {
      const e = this.S.events.find((x) => x.id === p.event);
      if (e && !e.came.includes(npc.id)) e.came.push(npc.id);
    }
  }

  /** You on the square / by the hall during a gathering (GameScene checks every few seconds). */
  playerAt(tx, ty) {
    for (const e of this.current()) {
      if (e.you || Math.abs(e.at.tx - tx) + Math.abs(e.at.ty - ty) > 8) continue;
      e.you = true;
      const sim = this.sim;
      this.S.attended = (this.S.attended || 0) + 1;
      if (e.kind === 'wedding') {
        sim.progression.addReputation(COMMUNITY.wedding.youRep);
        for (const id of e.host) {
          const n = sim.npcs.byId(id);
          if (n) sim.social.addRel(n, COMMUNITY.wedding.youRel);
        }
      } else {
        for (const id of e.guests) {
          const n = sim.npcs.byId(id);
          if (n && sim.family.relatives(n).some((r) => e.host.includes(r.id))) sim.social.addRel(n, 2);
        }
      }
      sim.toast(`toast.you_came_${e.kind}`, { npc: e.host[0] }, 'good');
    }
  }

  finish(e) {
    e.done = true;
    const sim = this.sim;
    const came = e.came.map((id) => sim.npcs.byId(id)).filter(Boolean);
    const hosts = e.host.map((id) => sim.npcs.byId(id)).filter(Boolean);
    if (e.kind === 'wedding') {
      const W = COMMUNITY.wedding;
      for (const n of hosts) n.mood = Math.min(100, (n.mood ?? 60) + W.coupleMood);
      for (const g of came) {
        g.mood = Math.min(100, (g.mood ?? 60) + W.mood);
        for (const h of hosts) {
          sim.social.addNpcRel(g, h, W.rel);
          sim.social.addNpcRel(h, g, W.rel);
        }
      }
      if (hosts.length === 2) sim.chronicle('chronicle.wedding_feast', { npc: hosts[0].id, npc2: hosts[1].id, n: came.length + (e.you ? 1 : 0) });
    } else {
      const F = COMMUNITY.funeral;
      for (const g of came) g.mood = Math.min(100, (g.mood ?? 60) + F.comfort);
      for (let i = 0; i < came.length; i++) for (let j = i + 1; j < Math.min(came.length, i + 4); j++) {
        sim.social.addNpcRel(came[i], came[j], F.rel);
        sim.social.addNpcRel(came[j], came[i], F.rel);
      }
      if (came.length) sim.chronicle('chronicle.funeral', { npc: e.host[0], n: came.length + (e.you ? 1 : 0) });
    }
  }

  /** For the paper and the notice board: what's coming up. */
  upcoming() {
    const day = this.T.day;
    return this.S.events.filter((e) => !e.done && e.day >= day).map((e) => ({ kind: e.kind, day: e.day, host: e.host, from: e.from }));
  }
}
