/**
 * EconomySystem — money and goods flowing between the player, NPCs and businesses.
 *
 * Prices come from supply and demand: each shop has a "target" stock for every
 * item. Low stock → higher prices, surplus → lower prices. Nothing is scripted:
 *
 *   farm workers work → farm produces wheat (season, weather, events)
 *   → farm sells wheat to the store → the store bakes bread
 *   → villagers buy bread with their wages → the store pays producers → producers pay wages
 *
 * A bad harvest therefore really does raise bread prices a few days later.
 */
import { BALANCE } from '../config/balance.js';
import { ITEMS } from '../data/items.js';
import { BUSINESSES } from '../data/businesses.js';
import { traitValue } from '../data/traits.js';
import { Mod, skill } from './Modifiers.js';

const E = BALANCE.economy;

export class EconomySystem {
  constructor(sim) {
    this.sim = sim;
    this.lastShortageDay = -10;
    sim.bus.on('time:day', () => this.dailyTick());
  }

  biz(id) {
    return this.sim.state.businesses[id];
  }
  def(id) {
    return BUSINESSES[id];
  }
  owner(id) {
    return this.sim.npcs.byId(BUSINESSES[id]?.owner);
  }
  /** Which business (if any) operates in this building. */
  businessAtBuilding(buildingId) {
    return Object.keys(BUSINESSES).find((id) => BUSINESSES[id].building === buildingId) || null;
  }

  isOpen(id) {
    const d = this.def(id);
    if (!d?.openHours) return true;
    const h = this.sim.time.hourFloat;
    return h >= d.openHours[0] && h < d.openHours[1];
  }

  target(id, item) {
    return this.def(id)?.targets?.[item] ?? 10;
  }
  stock(id, item) {
    return this.biz(id)?.stock[item] || 0;
  }

  /** Supply/demand multiplier on the base price. */
  priceFactor(id, item) {
    const f = Math.pow((this.target(id, item) + 8) / (this.stock(id, item) + 8), E.priceElasticity);
    return Math.max(E.minPriceFactor, Math.min(E.maxPriceFactor, f));
  }

  unitPrice(id, item) {
    return (ITEMS[item]?.basePrice || 0) * this.priceFactor(id, item);
  }

  /** Discount the owner gives the player based on your relationship. */
  relationshipDiscount(id) {
    const owner = this.owner(id);
    if (!owner) return 0;
    const tier = this.sim.social.tier(owner);
    if (tier === 'trusted') return E.trustedDiscount;
    if (tier === 'friend') return E.friendDiscount;
    return 0;
  }

  playerBuyPrice(id, item) {
    const owner = this.owner(id);
    let p = this.unitPrice(id, item) * (1 + E.shopMargin);
    p *= 1 + (owner ? traitValue(owner.traits, 'priceMarkup', 0) : 0);
    p *= 1 - Mod.tradeBonus(this.sim.state.player) - this.relationshipDiscount(id);
    return Math.max(1, Math.round(p));
  }

  playerSellPrice(id, item) {
    if (!this.def(id)?.buys?.includes(item)) return 0;
    const p = this.unitPrice(id, item) * (1 - E.sellDiscount) * (1 + Mod.tradeBonus(this.sim.state.player));
    return Math.max(1, Math.round(p));
  }

  /** Whether the shop still wants more of this item (stock limit) and can afford it. */
  sellBlockReason(id, item) {
    if (!this.def(id)?.buys?.includes(item)) return 'not_buying';
    if (this.stock(id, item) >= this.target(id, item) * E.maxStockMultiplier) return 'shop_full';
    if (this.biz(id).money < this.playerSellPrice(id, item)) return 'shop_broke';
    return null;
  }

  /** Buy qty units one by one (the price rises as stock drops). */
  buy(id, item, qty = 1) {
    const p = this.sim.state.player;
    const inv = this.sim.inventory;
    let bought = 0;
    let spent = 0;
    let reason = null;
    for (let i = 0; i < qty; i++) {
      if (this.stock(id, item) <= 0) {
        reason = 'out_of_stock';
        break;
      }
      const price = this.playerBuyPrice(id, item);
      if (p.money < price) {
        reason = 'no_money';
        break;
      }
      if (!inv.canAdd(item, 1)) {
        reason = 'too_heavy';
        break;
      }
      p.money -= price;
      this.biz(id).money += price;
      this.biz(id).stock[item]--;
      inv.add(item, 1);
      bought++;
      spent += price;
    }
    this.sim.bus.emit('economy:changed');
    return { bought, spent, reason };
  }

  sell(id, item, qty = 1) {
    const p = this.sim.state.player;
    let sold = 0;
    let earned = 0;
    let reason = null;
    for (let i = 0; i < qty; i++) {
      if (this.sim.inventory.count(item) <= 0) break;
      reason = this.sellBlockReason(id, item);
      if (reason) break;
      const price = this.playerSellPrice(id, item);
      this.sim.inventory.remove(item, 1);
      p.money += price;
      this.biz(id).money -= price;
      this.biz(id).stock[item] = this.stock(id, item) + 1;
      sold++;
      earned += price;
    }
    if (earned > 0) this.sim.state.stats.moneyEarned += earned;
    this.sim.bus.emit('economy:changed');
    return { sold, earned, reason };
  }

  // ---------- Tool repair (smithy) ----------

  repairCost(slot) {
    const tool = ITEMS[slot.id]?.tool;
    if (!tool) return 0;
    const missing = tool.durability - slot.dur;
    if (missing <= 0) return 0;
    return Math.max(1, Math.round(missing * E.repairCostPerPoint * (1 - Mod.repairDiscount(this.sim.state.player))));
  }

  repair(slot) {
    const cost = this.repairCost(slot);
    const p = this.sim.state.player;
    if (cost <= 0 || p.money < cost) return false;
    p.money -= cost;
    this.biz('smithy').money += cost;
    slot.dur = ITEMS[slot.id].tool.durability;
    this.sim.progression.addSkillXp('smithing', 5);
    this.sim.inventory.changed();
    return true;
  }

  // ---------- NPC transactions ----------

  /** An NPC buys up to qty of the first available item in the list. Returns units bought. */
  npcBuy(npc, id, items, qty) {
    const b = this.biz(id);
    let bought = 0;
    for (const item of items) {
      while (bought < qty && (b.stock[item] || 0) > 0) {
        const price = Math.max(1, Math.round(this.unitPrice(id, item)));
        if (npc.money < price) return bought;
        npc.money -= price;
        b.money += price;
        b.stock[item]--;
        bought++;
      }
    }
    return bought;
  }

  // ---------- Daily economy ----------

  dailyTick() {
    const S = this.sim.state;
    const B = S.businesses;
    const season = this.sim.time.season;
    const npcs = S.npcs;

    // 1. Farm output depends on workers who actually worked, the season, weather and events.
    const farmWorkers = npcs.filter((n) => (n.employer === 'farm' || n.owns === 'farm') && n.workedToday).length;
    const wheat = Math.round(farmWorkers * E.farmOutputPerWorker * (E.seasonFarmMult[season] ?? 1) * this.sim.events.modifier('farm_output'));
    B.farm.stock.wheat = (B.farm.stock.wheat || 0) + wheat;

    // 2. Producers sell to shops (wholesale).
    this.wholesale('farm', 'store', 'wheat');
    this.wholesale('farm', 'tavern', 'wheat');
    this.wholesale('lumberyard', 'store', 'wood');
    this.wholesale('quarry', 'store', 'stone');
    this.wholesale('quarry', 'smithy', 'iron_ore');
    this.wholesale('quarry', 'smithy', 'coal');

    // 3. Shops turn raw goods into products.
    const st = B.store.stock;
    const bread = Math.max(0, Math.min(E.breadPerDay, st.wheat || 0, Math.round(this.target('store', 'bread') * 1.5) - (st.bread || 0)));
    st.wheat -= bread;
    st.bread = (st.bread || 0) + bread;

    // The tavern buys bread from the store for its stew (money flows tavern → store → farm).
    const tv = B.tavern.stock;
    const stewWanted = Math.max(0, Math.min(E.stewPerDay, this.target('tavern', 'stew') * 2 - (tv.stew || 0)));
    const breadNeeded = Math.ceil(stewWanted / 3);
    let breadBought = 0;
    while (breadBought < breadNeeded && (st.bread || 0) > 0) {
      const price = Math.max(1, Math.round(this.unitPrice('store', 'bread')));
      if (B.tavern.money < price) break;
      B.tavern.money -= price;
      B.store.money += price;
      st.bread--;
      breadBought++;
    }
    const stew = Math.min(stewWanted, breadBought * 3 + (tv.wheat || 0) * 2);
    tv.wheat = Math.max(0, (tv.wheat || 0) - Math.max(0, Math.ceil((stew - breadBought * 3) / 2)));
    tv.stew = (tv.stew || 0) + stew;
    const pies = Math.max(0, Math.min(6, Math.floor((tv.berries || 0) / 3), this.target('tavern', 'pie') * 2 - (tv.pie || 0)));
    tv.berries -= pies * 3;
    tv.pie = (tv.pie || 0) + pies;

    const sm = B.smithy.stock;
    for (const tool of ['axe', 'pickaxe']) {
      if ((sm[tool] || 0) < this.target('smithy', tool) && (sm.iron_ore || 0) >= 2 && (sm.coal || 0) >= 1) {
        sm.iron_ore -= 2;
        sm.coal -= 1;
        sm[tool] = (sm[tool] || 0) + 1;
      }
    }

    // 4. Winter heating: every household buys firewood.
    if (season === 'winter') {
      const homes = new Map();
      for (const n of npcs) if (n.age >= 16 && !homes.has(n.homeId)) homes.set(n.homeId, n);
      const perHome = Math.round(E.winterWoodPerHousehold * this.sim.events.modifier('wood_demand'));
      for (const buyer of homes.values()) this.npcBuy(buyer, 'store', ['wood'], perHome);
    }

    // 5. Tools wear out: producers with working crews replace them at the smithy.
    for (const [id, def] of Object.entries(BUSINESSES)) {
      if (def.kind !== 'producer' || !def.toolUsed) continue;
      const crew = npcs.filter((n) => (n.employer === id || n.owns === id) && n.workedToday).length;
      const b = this.biz(id);
      b.toolWear = (b.toolWear || 0) + crew * E.toolWearPerWorkerDay;
      if (b.toolWear >= 1 && (sm[def.toolUsed] || 0) > 0) {
        const price = Math.max(1, Math.round(this.unitPrice('smithy', def.toolUsed)));
        if (b.money >= price) {
          b.money -= price;
          B.smithy.money += price;
          sm[def.toolUsed]--;
          b.toolWear -= 1;
        }
      }
    }

    // 6. Producers sell surplus to travelling traders (cheaply) — the village's exports.
    this.exportSurplus();

    // 7. Owners pay themselves a basic wage, plus a share of profit when business is good.
    for (const [id, def] of Object.entries(BUSINESSES)) {
      const owner = this.sim.npcs.byId(def.owner);
      if (!owner) continue;
      const surplus = B[id].money - E.ownerDrawAbove;
      const draw = surplus > 0 ? Math.max(E.ownerDrawPerDay, Math.round(surplus * E.ownerDrawShare)) : B[id].money >= E.ownerWageAbove ? E.ownerDrawPerDay : 0;
      B[id].money -= draw;
      owner.money += draw;
    }

    // 8. Trade with the outside world slowly pulls shop stock toward normal.
    this.outsideTrade(E.outsideTradeDrift);

    // 9. Shortages become village news.
    if ((st.bread || 0) === 0 && this.sim.time.day - this.lastShortageDay > 3) {
      this.lastShortageDay = this.sim.time.day;
      this.sim.chronicle('chronicle.shortage', { item: 'bread' });
    }
    this.sim.bus.emit('economy:changed');
  }

  wholesale(fromId, toId, item) {
    const from = this.biz(fromId);
    const to = this.biz(toId);
    const want = Math.max(0, Math.round(this.target(toId, item) * 1.2) - (to.stock[item] || 0));
    let qty = Math.min(want, from.stock[item] || 0);
    if (qty <= 0) return;
    const price = Math.max(1, Math.round(this.unitPrice(toId, item) * 0.75));
    qty = Math.min(qty, Math.floor(to.money / price));
    if (qty <= 0) return;
    from.stock[item] -= qty;
    to.stock[item] = (to.stock[item] || 0) + qty;
    to.money -= qty * price;
    from.money += qty * price;
  }

  /** Producers sell stock above target to outside traders at a low price (limited daily volume). */
  exportSurplus() {
    for (const [id, def] of Object.entries(BUSINESSES)) {
      if (def.kind !== 'producer') continue;
      const b = this.biz(id);
      for (const item of Object.keys(def.targets)) {
        const surplus = Math.min(E.exportPerDay, (b.stock[item] || 0) - Math.round(def.targets[item] * 0.5));
        if (surplus <= 0) continue;
        b.stock[item] -= surplus;
        b.money += Math.round(surplus * ITEMS[item].basePrice * E.exportPriceFactor);
      }
    }
  }

  /** Is there demand for more of this item from this producer? Workers idle when the yard is overflowing. */
  wantsMore(id, item) {
    return this.stock(id, item) < this.target(id, item) * E.producerStockLimit;
  }

  /** Imports goods that are short and exports surpluses, with money changing hands. */
  outsideTrade(drift) {
    for (const [id, def] of Object.entries(BUSINESSES)) {
      if (def.kind !== 'shop') continue;
      const b = this.biz(id);
      for (const item of Object.keys(def.targets)) {
        const cur = b.stock[item] || 0;
        const target = def.targets[item];
        const delta = Math.round((target - cur) * drift);
        const base = ITEMS[item].basePrice;
        if (delta > 0) {
          const cost = Math.round(base * 0.9);
          const n = Math.min(delta, Math.floor(b.money / Math.max(1, cost)));
          b.stock[item] = cur + n;
          b.money -= n * cost;
        } else if (delta < 0) {
          b.stock[item] = cur + delta;
          b.money += Math.round(-delta * base * 0.6);
        }
      }
    }
  }

  caravan() {
    this.outsideTrade(E.caravanDrift);
  }

  /** Items whose price at the store is unusually high or low — used in NPC small talk. */
  priceNews() {
    const out = { expensive: [], cheap: [] };
    for (const item of [...new Set([...this.def('store').sells, ...this.def('store').buys])]) {
      const f = this.priceFactor('store', item);
      if (f > 1.4) out.expensive.push(item);
      else if (f < 0.75) out.cheap.push(item);
    }
    return out;
  }

  /** Player skill that affects this shop (for UI hints). */
  tradingSkill() {
    return skill(this.sim.state.player, 'trading');
  }
}
