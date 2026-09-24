/**
 * BusinessSystem — businesses the player owns (e.g. the carpentry workshop).
 *
 * The chain is physical and visible:
 *   workers haul WOOD from your storage → turn it into PLANKS → build FURNITURE
 *   → villagers with money walk in and buy it → MONEY for you
 *
 * Each business keeps a ledger (revenue, expenses, profit per day) so you can
 * see whether it's worth it. Pricing changes both income per sale and how many
 * customers come. A workshop in the village centre gets more customers.
 */
import { PLAYER_BUSINESS_TYPES, PRICE_LEVELS, BUSINESS_TUNING as BT } from '../data/playerBusinesses.js';
import { BUILDABLES } from '../data/buildables.js';
import { ITEMS } from '../data/items.js';
import { rand } from '../core/rng.js';
import { skill } from './Modifiers.js';

export class BusinessSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('building:added', (id) => this.onBuilt(id));
    sim.bus.on('time:day', () => this.onDay());
    sim.bus.on('time:hour', (h) => {
      if (h === 8) this.pickCustomers();
    });
  }

  get all() {
    return this.sim.state.playerBusinesses;
  }
  list() {
    return Object.values(this.all);
  }
  get(id) {
    return this.all[id] || null;
  }
  type(biz) {
    return PLAYER_BUSINESS_TYPES[biz.type];
  }
  atBuilding(buildingId) {
    return this.list().find((b) => b.buildingId === buildingId) || null;
  }

  /** A finished building with effect.business becomes a business. */
  onBuilt(buildingId) {
    const c = this.sim.construction.byId(buildingId);
    const kind = c && BUILDABLES[c.type]?.effect?.business;
    if (!kind || this.all[buildingId]) return;
    this.all[buildingId] = {
      id: buildingId,
      type: kind,
      buildingId,
      stock: {},
      labor: 0,
      plan: Object.fromEntries(Object.entries(PLAYER_BUSINESS_TYPES[kind].products).map(([k, v]) => [k, { on: true, target: v.target }])),
      priceLevel: 'normal',
      autoBuy: false,
      sellSurplus: true,
      reputation: 40,
      today: { revenue: 0, expenses: 0, sold: {} },
      history: [],
      totalRevenue: 0,
      openedDay: this.sim.time.day,
    };
    this.sim.chronicle('chronicle.business_opened', { building_type: c.type });
    this.sim.toast('toast.business_opened', {}, 'good');
    this.sim.bus.emit('business:changed', buildingId);
  }

  isOpen(biz) {
    const [a, b] = this.type(biz).openHours;
    const h = this.sim.time.hourFloat;
    return h >= a && h < b;
  }

  stock(biz, item) {
    return biz.stock[item] || 0;
  }

  /** Does this business need more of its raw input? */
  needsInput(biz) {
    const t = this.type(biz);
    return this.stock(biz, t.input) < 12;
  }

  receive(biz, item, qty) {
    biz.stock[item] = this.stock(biz, item) + qty;
    this.sim.bus.emit('business:changed', biz.id);
  }

  /** Can someone (a worker, or you) do productive work here right now? */
  hasWork(biz) {
    return !!this.nextProduct(biz);
  }

  /** Which product to make next: planks when short, then whatever furniture is furthest below target. */
  nextProduct(biz) {
    const t = this.type(biz);
    let best = null;
    let bestGap = 0;
    for (const [id, def] of Object.entries(t.products)) {
      const plan = biz.plan[id];
      if (!plan?.on) continue;
      const canMake = Object.entries(def.inputs).every(([i, q]) => this.stock(biz, i) >= q);
      if (!canMake) continue;
      const gap = (plan.target - this.stock(biz, id)) / Math.max(1, plan.target);
      if (gap > bestGap) {
        bestGap = gap;
        best = id;
      }
    }
    // Planks are also needed as an input for furniture.
    const plankUse = Object.values(t.products).some((d) => d.inputs.planks);
    if (!best && plankUse && biz.plan.planks?.on && this.stock(biz, 'wood') >= 2 && this.stock(biz, 'planks') < 12) best = 'planks';
    return best;
  }

  /** Add worker-minutes of labor; finished products appear in the workshop's stock. */
  addLabor(biz, minutes) {
    biz.labor += minutes;
    let made = 0;
    for (let guard = 0; guard < 20; guard++) {
      const pid = this.nextProduct(biz);
      if (!pid) break;
      const def = this.type(biz).products[pid];
      const need = def.labor * 60;
      if (biz.labor < need) break;
      for (const [i, q] of Object.entries(def.inputs)) biz.stock[i] -= q;
      biz.stock[pid] = this.stock(biz, pid) + 1;
      biz.labor -= need;
      made++;
    }
    if (!this.nextProduct(biz)) biz.labor = Math.min(biz.labor, 60); // don't bank infinite labor while idle
    if (made) this.sim.bus.emit('business:produced', biz.id);
    this.sim.bus.emit('business:changed', biz.id);
    return made;
  }

  /** The player works an hour at their own workshop (Carpentry helps). */
  playerWork(biz) {
    const p = this.sim.state.player;
    const minutes = 60 * (1 + skill(p, 'carpentry') * 0.1 + (p.attributes.craftsmanship || 0) * 0.03);
    this.addLabor(biz, minutes);
    this.sim.needs.spendEnergy(7);
    this.sim.progression.addXp(8);
    this.sim.progression.addSkillXp('carpentry', 12);
  }

  /** Deliver wood from the player's pockets to the workshop. */
  deliverFromPockets(biz) {
    const input = this.type(biz).input;
    const n = this.sim.inventory.remove(input, this.sim.inventory.count(input));
    if (n) this.receive(biz, input, n);
    return n;
  }

  /** Take finished products into your pockets (to sell or use yourself). */
  takeProducts(biz) {
    let total = 0;
    for (const id of this.type(biz).sells) {
      const n = Math.min(this.stock(biz, id), this.sim.inventory.maxAddable(id));
      if (n > 0) {
        this.sim.inventory.add(id, n);
        biz.stock[id] -= n;
        total += n;
      }
    }
    this.sim.bus.emit('business:changed', biz.id);
    return total;
  }

  price(biz, item) {
    return Math.max(1, Math.round(ITEMS[item].basePrice * PRICE_LEVELS[biz.priceLevel].price * (0.9 + biz.reputation / 500)));
  }

  // ------------------------------------------------------------------ customers

  /** Each morning, some well-off villagers decide to go furniture shopping. */
  pickCustomers() {
    for (const biz of this.list()) {
      const plot = this.sim.land.plotAt(this.sim.world.buildings[biz.buildingId]?.tx ?? -1, this.sim.world.buildings[biz.buildingId]?.ty ?? -1);
      const village = plot && this.sim.land.hasFeature(plot.id, 'village') ? BT.villageBonus : 1;
      // Villager carpenters compete with you for the same customers.
      const rivals = this.sim.economy.ofType('carpentry').length;
      const chance = (BT.customerChance * PRICE_LEVELS[biz.priceLevel].demand * village * (0.6 + biz.reputation / 100)) / (1 + rivals * 0.6);
      for (const npc of this.sim.state.npcs) {
        if (npc.age < 18 || npc.money < BT.customerMinMoney || npc.employer === 'player' || npc.shopTarget) continue;
        if (rand.chance(chance / 2)) npc.shopTarget = biz.buildingId;
      }
    }
  }

  /** A villager arrived at the workshop to buy something. */
  sellToNpc(npc, buildingId) {
    const biz = this.atBuilding(buildingId);
    npc.shopTarget = null;
    if (!biz || !this.isOpen(biz)) return false;
    const affordable = this.type(biz)
      .sells.filter((id) => id !== 'planks' && this.stock(biz, id) > 0 && npc.money >= this.price(biz, id))
      .sort((a, b) => ITEMS[b].basePrice - ITEMS[a].basePrice);
    const item = affordable[0];
    if (!item) {
      biz.reputation = Math.max(0, biz.reputation - 1); // came for nothing
      return false;
    }
    const price = this.price(biz, item);
    npc.money -= price;
    this.sim.state.player.money += price;
    biz.stock[item]--;
    this.record(biz, 'revenue', price, item);
    biz.reputation = Math.min(100, biz.reputation + 1);
    this.sim.memory.remember(npc, 'bought_from_player', { who: 'player', params: { item } });
    this.sim.progression.addXp(3);
    this.sim.progression.addSkillXp('trading', 4);
    this.sim.toast('toast.customer_bought', { npc: npc.id, gender: npc.gender, item, money: price }, 'gain');
    return true;
  }

  record(biz, kind, amount, item = null) {
    biz.today[kind] += amount;
    if (kind === 'revenue') {
      biz.totalRevenue += amount;
      if (item) biz.today.sold[item] = (biz.today.sold[item] || 0) + 1;
    }
    this.sim.bus.emit('business:changed', biz.id);
  }

  // ------------------------------------------------------------------ daily bookkeeping

  onDay() {
    const sim = this.sim;
    for (const biz of this.list()) {
      const t = this.type(biz);
      // Auto-buy raw material from the supplier (an expense).
      if (biz.autoBuy && this.needsInput(biz)) {
        const sup = sim.economy.biz(t.inputSupplier);
        const qty = Math.min(20, sup.stock[t.input] || 0);
        const unit = Math.max(1, Math.round(sim.economy.unitPrice(t.inputSupplier, t.input)));
        const n = Math.min(qty, Math.floor(sim.state.player.money / unit));
        if (n > 0) {
          sup.stock[t.input] -= n;
          sup.money += n * unit;
          sim.state.player.money -= n * unit;
          this.receive(biz, t.input, n);
          this.record(biz, 'expenses', n * unit);
        }
      }
      // Sell surplus furniture to the general store (wholesale), then to passing traders (cheap).
      if (biz.sellSurplus) {
        let traderSlots = BT.traderPerDay;
        for (const id of t.sells) {
          const surplus = this.stock(biz, id) - (biz.plan[id]?.target ?? 0);
          for (let i = 0; i < surplus; i++) {
            let price;
            if (!sim.economy.sellBlockReason('store', id)) {
              price = Math.max(1, Math.round(sim.economy.unitPrice('store', id) * BT.surplusSellFactor));
              const store = sim.economy.biz('store');
              store.money -= price;
              store.stock[id] = (store.stock[id] || 0) + 1;
            } else if (traderSlots > 0 && id !== 'planks') {
              traderSlots--;
              price = Math.max(1, Math.round(ITEMS[id].basePrice * BT.traderPriceFactor));
            } else break;
            biz.stock[id]--;
            sim.state.player.money += price;
            this.record(biz, 'revenue', price, id);
          }
        }
      }
      // Wages of the workers assigned here count as this business's expense.
      for (const c of sim.workers.list()) if (c.assignment.type === 'workshop' && c.assignment.bizId === biz.id) this.record(biz, 'expenses', c.salary);
      biz.history.push({ day: sim.time.day - 1, revenue: biz.today.revenue, expenses: biz.today.expenses });
      if (biz.history.length > BT.historyDays) biz.history.shift();
      biz.today = { revenue: 0, expenses: 0, sold: {} };
    }
  }
}
