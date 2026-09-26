/**
 * LivestockSystem — farm animals: chickens, sheep and cows of your own.
 *
 *   state.livestock = { animals: [{ id, kind, barn, health, bornDay, owed, shornDay }], produce: { barnId: { item: n } },
 *                       nextId, stats: { eggs, milk, wool, born, died, sold }, fedDay }
 *
 * You buy them at the village farm (paid to the farm). They live at a barn of yours — the barn's room
 * (data/livestock.js FARM.barnSpace × its level) is how many you can keep. Every morning each animal
 * gives what it gives (eggs every day, milk every day, wool once a week) into the barn, where it waits
 * for you (or your workers — LivestockTasks) to collect it and carry it to your storage. The store buys
 * eggs, milk and wool; milk makes cheese and eggs an omelette at the stove.
 *
 * Spring to autumn they graze. In winter they eat fodder from your storage — hay (the farm cuts it in
 * summer and the store sells it), or wheat, flour, cabbages, potatoes, apples. With nothing to eat an
 * animal sickens, gives nothing, and in the end dies. In spring, hens raise chicks (if there's room).
 *
 * The village farm keeps its own small herd (FARM.villageHerd) — only to be seen about the farmhouse.
 * Nothing here rolls the game's dice.
 */
import { LIVESTOCK, FARM } from '../data/livestock.js';
import { BALANCE } from '../config/balance.js';

export class LivestockSystem {
  constructor(sim) {
    this.sim = sim;
    sim.state.livestock ??= { animals: [], produce: {}, nextId: 1, stats: {} };
    const S = this.S;
    S.produce ??= {};
    S.stats ??= {};
    sim.bus.on('time:day', () => this.daily());
  }

  get S() {
    return this.sim.state.livestock;
  }

  // ------------------------------------------------------------------ barns and room

  /** Your finished barns (where animals can live). */
  barns() {
    const sim = this.sim;
    return Object.values(sim.world.buildings)
      .filter((b) => b.type === 'barn' && sim.property.rec(b.id)?.owner === 'player')
      .map((b) => b.id);
  }

  space(barnId) {
    return FARM.barnSpace * Math.max(1, this.sim.structures?.rec(barnId)?.lvl || 1);
  }

  used(barnId) {
    return this.S.animals.filter((a) => a.barn === barnId).reduce((s, a) => s + LIVESTOCK[a.kind].space, 0);
  }

  /** The barn with the most room for one of these (or null). */
  roomFor(kind) {
    let best = null;
    let room = -1;
    for (const b of this.barns()) {
      const r = this.space(b) - this.used(b);
      if (r >= LIVESTOCK[kind].space && r > room) (best = b), (room = r);
    }
    return best;
  }

  mine(barnId = null) {
    return barnId ? this.S.animals.filter((a) => a.barn === barnId) : this.S.animals;
  }

  count(kind = null) {
    return kind ? this.S.animals.filter((a) => a.kind === kind).length : this.S.animals.length;
  }

  // ------------------------------------------------------------------ buying and selling

  /** The village farm (they sell animals and buy them back). */
  farm() {
    return this.sim.economy.ofType('farm')[0] || null;
  }

  price(kind) {
    return LIVESTOCK[kind].price;
  }

  canBuy(kind) {
    if (!LIVESTOCK[kind]) return { ok: false, reason: 'nothing_here' };
    if (!this.farm()) return { ok: false, reason: 'no_farm' };
    if (!this.barns().length) return { ok: false, reason: 'need_barn' };
    if (!this.roomFor(kind)) return { ok: false, reason: 'barn_full' };
    if (this.sim.state.player.money < this.price(kind)) return { ok: false, reason: 'no_money', params: { money: this.price(kind) } };
    return { ok: true };
  }

  buy(kind) {
    const chk = this.canBuy(kind);
    if (!chk.ok) return chk;
    const sim = this.sim;
    const price = this.price(kind);
    sim.state.player.money -= price;
    const farm = sim.economy.biz(this.farm());
    farm.money += price;
    sim.economy.ledger(this.farm(), 'rev', price);
    const a = this.add(kind, this.roomFor(kind));
    sim.toast('toast.animal_bought', { animal: kind, building: a.barn }, 'good');
    sim.bus.emit('livestock:changed');
    sim.bus.emit('player:changed');
    return { ok: true, animal: a };
  }

  add(kind, barn) {
    const a = { id: this.S.nextId++, kind, barn, health: 100, bornDay: this.sim.time.day, owed: 0 };
    this.S.animals.push(a);
    return a;
  }

  sellPrice(a) {
    return Math.round(LIVESTOCK[a.kind].price * FARM.sellShare * (0.4 + (0.6 * a.health) / 100));
  }

  sell(id) {
    const sim = this.sim;
    const a = this.S.animals.find((x) => x.id === Number(id));
    if (!a) return { ok: false, reason: 'nothing_here' };
    const farm = this.farm();
    const price = this.sellPrice(a);
    this.S.animals.splice(this.S.animals.indexOf(a), 1);
    sim.state.player.money += price;
    if (farm) sim.economy.biz(farm).money -= price;
    this.S.stats.sold = (this.S.stats.sold || 0) + 1;
    sim.toast('toast.animal_sold', { animal: a.kind, money: price }, 'gain');
    sim.bus.emit('livestock:changed');
    sim.bus.emit('player:changed');
    return { ok: true, money: price };
  }

  // ------------------------------------------------------------------ what they give

  waiting(barnId) {
    return this.S.produce[barnId] || {};
  }

  waitingTotal(barnId) {
    return Object.values(this.waiting(barnId)).reduce((a, b) => a + b, 0);
  }

  /** Take up to n from a barn's produce: { item: qty } (what was taken). */
  takeProduce(barnId, n = Infinity) {
    const w = this.waiting(barnId);
    const out = {};
    for (const item of Object.keys(w)) {
      const k = Math.min(w[item], n);
      if (k <= 0) continue;
      out[item] = k;
      w[item] -= k;
      n -= k;
      if (!w[item]) delete w[item];
      if (n <= 0) break;
    }
    return out;
  }

  /** You, at the barn: into your pockets (as much as you can carry), the rest stays. */
  collect(barnId) {
    const sim = this.sim;
    let got = 0;
    for (const [item, n] of Object.entries(this.waiting(barnId))) {
      const added = sim.inventory.add(item, n) || 0;
      if (added > 0) {
        this.S.produce[barnId][item] -= added;
        if (!this.S.produce[barnId][item]) delete this.S.produce[barnId][item];
        got += added;
      }
    }
    if (got) sim.progression.addSkillXp?.('farming', Math.min(20, got));
    sim.toast(got ? 'toast.produce_collected' : 'toast.produce_none', { n: got }, got ? 'gain' : 'info');
    sim.bus.emit('livestock:changed');
    return got;
  }

  // ------------------------------------------------------------------ every morning

  fodderStock() {
    return FARM.fodder.reduce((s, i) => s + this.sim.home.storageCount(i), 0);
  }

  /** Feed needed a winter day, for all of them. */
  feedPerDay() {
    return this.S.animals.reduce((s, a) => s + LIVESTOCK[a.kind].feed, 0);
  }

  eat(a) {
    const home = this.sim.home;
    a.owed = (a.owed || 0) + LIVESTOCK[a.kind].feed;
    while (a.owed >= 1) {
      const item = FARM.fodder.find((i) => home.storageCount(i) > 0);
      if (!item) return false;
      home.take(item, 1);
      a.owed -= 1;
    }
    return true;
  }

  daily() {
    const sim = this.sim;
    const T = sim.time;
    const winter = T.season === 'winter';
    const day = T.day;
    const barns = new Set(this.barns());
    const stats = this.S.stats;
    let hungry = 0;
    for (const a of this.S.animals.slice()) {
      // The barn's gone (sold, pulled down): they move to another, if there's room — or they're sold.
      if (!barns.has(a.barn)) {
        const other = [...barns].find((b) => this.space(b) - this.used(b) >= LIVESTOCK[a.kind].space);
        if (other) a.barn = other;
        else {
          this.sell(a.id);
          continue;
        }
      }
      const fed = !winter || this.eat(a);
      if (fed) a.health = Math.min(100, a.health + FARM.heal);
      else {
        a.health -= FARM.hungry;
        hungry++;
        if (a.health <= 0) {
          this.S.animals.splice(this.S.animals.indexOf(a), 1);
          stats.died = (stats.died || 0) + 1;
          sim.toast('toast.animal_died', { animal: a.kind }, 'danger');
          continue;
        }
      }
      if (a.health < FARM.producesAbove) continue;
      // What it gives today.
      const g = LIVESTOCK[a.kind].gives;
      if ((day - a.bornDay) % g.every !== 0 || day === a.bornDay) continue;
      let n = g.n;
      if (winter) n = g.winter >= 1 ? n : g.winter <= 0 ? 0 : (day + a.id) % Math.round(1 / g.winter) === 0 ? n : 0;
      if (!n) continue;
      const w = (this.S.produce[a.barn] ??= {});
      if (this.waitingTotal(a.barn) >= FARM.produceCap) continue; // (nobody's collected: it spoils)
      w[g.item] = (w[g.item] || 0) + n;
      if (g.item === 'wool') a.shornDay = day;
      stats[g.item] = (stats[g.item] || 0) + n;
    }
    if (hungry) sim.toast('toast.livestock_hungry', { n: hungry }, 'warn');
    // Spring: the hens raise a clutch.
    if (T.season === 'spring' && day % FARM.hatchEvery === 0) {
      for (const b of barns) {
        if (this.mine(b).filter((a) => a.kind === 'chicken' && a.health >= FARM.producesAbove).length < 2) continue;
        let n = 0;
        while (n < 2 && this.space(b) - this.used(b) >= LIVESTOCK.chicken.space) {
          this.add('chicken', b);
          n++;
        }
        if (n) {
          stats.born = (stats.born || 0) + n;
          sim.toast('toast.chicks', { n, building: b }, 'good');
        }
      }
    }
    sim.bus.emit('livestock:changed');
  }

  // ------------------------------------------------------------------ the village farm's herd

  /** The village farm's animals (only to be seen about the farmhouse): [{ kind, n }] and where. */
  villageHerd() {
    const farm = this.farm();
    const b = farm && this.sim.world.buildings[this.sim.economy.biz(farm)?.building];
    return b ? { building: b.id, herd: FARM.villageHerd } : null;
  }

  // ------------------------------------------------------------------ advice

  advice(AP) {
    const sim = this.sim;
    const T = sim.time;
    const out = [];
    if (!this.S.animals.length) {
      if (this.barns().length && this.farm()) out.push({ id: 'try_livestock', prio: AP.opportunity - 5, icon: '🐔', params: {}, go: null });
      return out;
    }
    const perSeason = BALANCE.time.daysPerSeason;
    const late = T.season === 'autumn' && T.dayOfSeason > perSeason - 5;
    const need = this.feedPerDay();
    if ((late || T.season === 'winter') && need > 0) {
      const days = Math.floor(this.fodderStock() / need);
      if (days < 7) out.push({ id: 'livestock_fodder', prio: T.season === 'winter' && days < 1 ? AP.danger - 11 : AP.materials + 1, icon: '🌾', params: { n: Math.ceil(need * 7), have: this.fodderStock() }, go: null });
    }
    const full = this.barns().find((b) => this.waitingTotal(b) >= FARM.produceCap * 0.8);
    if (full) out.push({ id: 'collect_produce', prio: AP.opportunity + 6, icon: '🥚', params: { building: full }, go: null });
    return out;
  }

  summary() {
    const by = {};
    for (const a of this.S.animals) by[a.kind] = (by[a.kind] || 0) + 1;
    return { animals: this.S.animals.length, by, barns: this.barns().length, waiting: this.barns().reduce((s, b) => s + this.waitingTotal(b), 0), stats: this.S.stats };
  }
}

// ==================================================================== your workers collecting

/** Your workers fetch what's waiting at your barns and take it to your storage (mixed into WorkerSystem). */
export const LivestockTasks = {
  livestockTasks(npc, c, pos, add) {
    const L = this.sim.livestock;
    if (!L) return;
    for (const b of L.barns()) {
      if (L.waitingTotal(b) < FARM.collectAt) continue;
      const bl = this.sim.world.buildings[b];
      if (!bl) continue;
      add({ key: `lcol:${b}`, kind: 'lcollect', cat: 'hauling', target: b, tx: bl.door.tx, ty: bl.door.ty, urgent: 30, cap: 1 });
    }
  },

  /** At the barn: load what's waiting (as much as they can carry), then off to your storage. */
  livestockFetch(npc, c, t) {
    const L = this.sim.livestock;
    const items = L.takeProduce(t.target, this.carryCap(npc));
    const qty = Object.values(items).reduce((a, b) => a + b, 0);
    if (!qty) {
      this.block(c, t, 60);
      return this.next(npc);
    }
    npc.carry = { item: Object.keys(items)[0], qty, items, to: null };
    this.sim.bus.emit('livestock:changed');
    return this.loaded(npc, c);
  },
};
