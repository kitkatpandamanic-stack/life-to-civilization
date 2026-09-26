/**
 * EconomySystem — money and goods flowing between the player, NPCs and businesses.
 *
 * Every business — the founding ones and any a villager opens later — is an
 * instance of a business type (data/businessTypes.js) stored in state.businesses:
 *   { id, type, building, owner, money, stock, markup, wageLevel, reputation, closed, today, history… }
 *
 * Prices come from supply and demand: each shop has a "target" stock for every
 * item. Low stock → higher prices, surplus → lower prices; the owner's own
 * markup (competition!) sits on top. Nothing is scripted:
 *
 *   farm workers work → farm produces wheat (season, weather, events)
 *   → shops and bakeries buy wheat wholesale → bake bread
 *   → villagers buy bread with their wages (from whichever shop they prefer)
 *   → shops pay producers → producers pay wages
 *
 * A bad harvest therefore really does raise bread prices a few days later.
 */
import { bestQuality } from './slots.js';
import { Q, STANDARD } from '../data/quality.js';
import { BALANCE } from '../config/balance.js';
import { ITEMS } from '../data/items.js';
import { FOUNDING_BUSINESSES } from '../data/businesses.js';
import { BUSINESS_TYPES } from '../data/businessTypes.js';
import { traitValue } from '../data/traits.js';
import { Mod, skill } from './Modifiers.js';

const E = BALANCE.economy;
export const FOOD = ['bread', 'potato', 'apple', 'carrot', 'cabbage', 'cheese', 'fish', 'meat'];

export class EconomySystem {
  constructor(sim) {
    this.sim = sim;
    this.lastShortageDay = -10;
    this.defCache = new Map();
    this.byBuilding = null;
    sim.bus.on('time:day', () => this.dailyTick());
    // Deliveries happen in daylight: a morning round and an afternoon top-up (so the roads are busy by day).
    sim.bus.on('time:hour', (h) => {
      if (h === 8 || h === 14) for (const id of this.active()) this.restock(id);
      if (h === 11) for (const id of this.active()) if (this.def(id).kind === 'depot') this.depotBuy(id);
    });
    sim.bus.on('business:opened', () => this.invalidate());
    sim.bus.on('business:closed', () => this.invalidate());
  }

  invalidate() {
    this.defCache.clear();
    this.byBuilding = null;
  }

  // ---------- Businesses ----------

  biz(id) {
    return this.sim.state.businesses[id];
  }
  /** Every business ever (closed ones too). */
  ids() {
    return Object.keys(this.sim.state.businesses);
  }
  /** Businesses that are trading. */
  active() {
    return this.ids().filter((id) => !this.sim.state.businesses[id].closed);
  }
  /** The business's full definition: its type template plus where it is. */
  def(id) {
    let d = this.defCache.get(id);
    if (d) return d;
    const b = this.biz(id);
    if (!b) return null;
    const type = b.type || FOUNDING_BUSINESSES[id]?.type;
    d = { ...BUSINESS_TYPES[type], id, type, building: b.building };
    this.defCache.set(id, d);
    return d;
  }
  /** Owners change hands (inheritance, sales), so the owner lives in the state. */
  ownerId(id) {
    return this.biz(id)?.owner ?? null;
  }
  owner(id) {
    return this.sim.npcs.byId(this.ownerId(id));
  }
  /** Line of trade — businesses in the same sector compete for the same customers. */
  sector(id) {
    return this.def(id)?.sector || this.sim.businesses?.get(id)?.type || id;
  }
  buildingOf(id) {
    const b = this.biz(id);
    return b ? this.sim.world.buildings[b.building] : null;
  }
  /** Which (trading) business operates in this building. */
  businessAtBuilding(buildingId) {
    if (!this.byBuilding) {
      this.byBuilding = new Map();
      for (const id of this.active()) this.byBuilding.set(this.biz(id).building, id);
    }
    return this.byBuilding.get(buildingId) || null;
  }
  ofType(type) {
    return this.active().filter((id) => this.def(id).type === type);
  }
  ofSector(sector) {
    return this.active().filter((id) => this.def(id).sector === sector);
  }
  /** Shops that sell this item. */
  sellersOf(item) {
    return this.active().filter((id) => this.def(id).kind === 'shop' && this.def(id).sells?.includes(item));
  }

  isOpen(id) {
    const b = this.biz(id);
    if (!b || b.closed) return false;
    const d = this.def(id);
    if (!d?.openHours) return true;
    const h = this.sim.time.hourFloat;
    return h >= d.openHours[0] && h < d.openHours[1];
  }

  target(id, item) {
    // Bigger premises hold more (a storeroom, a barn, a warehouse's upper floor — StructureSystem).
    const room = this.sim.structures?.stockMult(this.biz(id)?.building) ?? 1;
    return (this.def(id)?.targets?.[item] ?? 10) * room;
  }
  stock(id, item) {
    return this.biz(id)?.stock[item] || 0;
  }

  /** Supply/demand multiplier on the base price. */
  priceFactor(id, item) {
    const f = Math.pow((this.target(id, item) + 8) / (this.stock(id, item) + 8), E.priceElasticity);
    return Math.max(E.minPriceFactor, Math.min(E.maxPriceFactor, f));
  }

  /** Price per unit: base × supply/demand × the owner's markup (competition pushes it down). */
  unitPrice(id, item) {
    const b = this.biz(id);
    const made = this.def(id)?.recipes?.[item] ? 1 + ((b?.quality ?? 1) - 1) * 0.08 : 1; // finer goods fetch a little more
    return (ITEMS[item]?.basePrice || 0) * this.priceFactor(id, item) * (b?.markup ?? 1) * made;
  }

  /** Book money in or out for a business (its daily ledger). */
  ledger(id, kind, amount) {
    const b = this.biz(id);
    if (!b || !amount) return;
    b.today ??= { rev: 0, exp: 0 };
    b.today[kind] += amount;
  }

  /** Discount (or markup, if negative) the owner gives the player based on your relationship. */
  relationshipDiscount(id) {
    const owner = this.owner(id);
    if (!owner) return 0;
    const tier = this.sim.social.tier(owner);
    if (tier === 'trusted') return E.trustedDiscount;
    if (tier === 'friend') return E.friendDiscount;
    // Someone who distrusts you charges you more.
    if (tier === 'wary') return -E.wariMarkup;
    if (tier === 'hostile') return -E.hostileMarkup;
    return 0;
  }

  playerBuyPrice(id, item) {
    const owner = this.owner(id);
    let p = this.unitPrice(id, item) * (1 + E.shopMargin);
    p *= 1 + (owner ? traitValue(owner.traits, 'priceMarkup', 0) : 0);
    p *= 1 - Mod.tradeBonus(this.sim.state.player) - Mod.buyBonus(this.sim.state.player) - this.relationshipDiscount(id);
    return Math.max(1, Math.round(p));
  }

  /** Does this shop buy the item? (During a trade fair, every shop takes the goods the merchant wants.) */
  buysItem(id, item) {
    if (this.def(id)?.buys?.includes(item) || this.def(id)?.buysFromYou?.includes(item)) return true;
    return this.def(id)?.kind === 'shop' && this.sim.events.itemPrice(item) > 1;
  }

  /** What the shop pays you for one unit (of quality q — finer goods fetch more). */
  playerSellPrice(id, item, q = STANDARD) {
    if (!this.buysItem(id, item)) return 0;
    const pl = this.sim.state.player;
    const p = (ITEMS[item]?.basePrice || 0) * this.priceFactor(id, item) * (1 - E.sellDiscount) * (1 + Mod.tradeBonus(pl) + Mod.sellBonus(pl, item)) * this.sim.events.itemPrice(item) * Q(q).price;
    return Math.max(1, Math.round(p));
  }

  /** Whether the shop still wants more of this item (stock limit) and can afford it. */
  sellBlockReason(id, item) {
    if (!this.buysItem(id, item)) return 'not_buying';
    if (this.biz(id)?.closed) return 'closed';
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
    this.ledger(id, 'rev', spent);
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
      // You sell your best pieces first (they fetch the most).
      const q = bestQuality(this.sim.inventory.slots, item) ?? STANDARD;
      const price = this.playerSellPrice(id, item, q);
      this.sim.inventory.remove(item, 1, { prefer: 'high' });
      p.money += price;
      this.biz(id).money -= price;
      this.biz(id).stock[item] = this.stock(id, item) + 1;
      sold++;
      earned += price;
    }
    if (earned > 0) this.sim.state.stats.moneyEarned += earned;
    this.ledger(id, 'exp', earned);
    this.sim.bus.emit('economy:changed');
    return { sold, earned, reason };
  }

  // ---------- Tool repair (smithy) ----------

  repairCost(slot) {
    const tool = ITEMS[slot.id]?.tool;
    if (!tool) return 0;
    const missing = this.sim.inventory.maxDurability(slot) - slot.dur;
    if (missing <= 0) return 0;
    return Math.max(1, Math.round(missing * E.repairCostPerPoint * (1 - Mod.repairDiscount(this.sim.state.player))));
  }

  repair(slot, bizId = 'smithy') {
    const cost = this.repairCost(slot);
    const p = this.sim.state.player;
    if (cost <= 0 || p.money < cost) return false;
    p.money -= cost;
    this.biz(bizId).money += cost;
    this.ledger(bizId, 'rev', cost);
    slot.dur = this.sim.inventory.maxDurability(slot);
    this.sim.progression.addSkillXp('smithing', 5);
    this.sim.inventory.changed();
    return true;
  }

  // ---------- NPC transactions ----------

  /** An NPC buys up to qty of the first available item in the list. Returns units bought. */
  npcBuy(npc, id, items, qty) {
    const b = this.biz(id);
    if (!b || b.closed) return 0;
    let bought = 0;
    let spent = 0;
    for (const item of items) {
      while (bought < qty && (b.stock[item] || 0) > 0) {
        const price = Math.max(1, Math.round(this.unitPrice(id, item)));
        if (npc.money < price) {
          this.ledger(id, 'rev', spent);
          return bought;
        }
        npc.money -= price;
        b.money += price;
        b.stock[item]--;
        bought++;
        spent += price;
      }
    }
    this.ledger(id, 'rev', spent);
    if (bought) {
      b.customers = (b.customers || 0) + 1;
      b.reputation = Math.min(100, (b.reputation ?? 50) + 0.2); // a satisfied customer
    }
    return bought;
  }

  /**
   * Where does this villager shop for these items? Competition happens here:
   * price, whether they have it, the shop's reputation, how far it is, habit
   * (a favourite shop), and how they feel about the owner (friends buy from friends,
   * nobody buys from their enemy).
   */
  chooseShop(npc, items, { openNow = true, type = null } = {}) {
    let best = null;
    let bestScore = -Infinity;
    const home = npc.homeId && this.sim.world.buildings[npc.homeId];
    for (const id of this.active()) {
      const d = this.def(id);
      if (d.kind !== 'shop' || !items.some((i) => d.sells?.includes(i)) || (type && d.type !== type)) continue;
      if (openNow && !this.isOpen(id)) continue;
      const have = items.filter((i) => d.sells.includes(i) && this.stock(id, i) > 0);
      if (!have.length) continue;
      const avgFactor = have.reduce((s, i) => s + this.priceFactor(id, i) * (this.biz(id).markup ?? 1), 0) / have.length;
      // The hard-up watch every coin; the well-off pay for better goods.
      const poor = npc.money < 30;
      const rich = npc.money > 200;
      const priceW = poor ? 9 : rich ? 4 : 6;
      const qualityW = rich ? 2.5 : poor ? 0.4 : 1.2;
      let score = 10 - avgFactor * priceW + have.length * 0.6 + (this.biz(id).reputation ?? 50) / 25 + ((this.biz(id).quality ?? 1) - 1) * qualityW;
      // A fine shop with a window display draws people in (StructureSystem) — the well-off most of all.
      score += (this.sim.structures?.appeal(this.biz(id).building) || 0) * (rich ? 1.2 : poor ? 0.4 : 0.8);
      const bld = this.sim.world.buildings[this.biz(id).building];
      if (home && bld) score -= Math.hypot(home.door.tx - bld.door.tx, home.door.ty - bld.door.ty) / 12;
      score += Math.min(3, (npc.visits?.[this.biz(id).building] || 0) * 0.3);
      const owner = this.owner(id);
      if (owner) {
        if (owner === npc || npc.family.includes(owner.id)) score += 4;
        const bond = this.sim.social.bond(npc, owner);
        if (bond) score += bond.f / 30 - bond.c / 20;
      }
      if (npc.employer === id) score += 2;
      // Heard it's cheap there.
      score += (this.sim.rumors?.bias(npc, 'cheap', id) || 0) * 2;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  // ---------- Daily economy ----------

  dailyTick() {
    const S = this.sim.state;
    const season = this.sim.time.season;
    const npcs = S.npcs;
    const active = this.active();

    // 1. Farm output depends on workers who actually worked, the season, weather and events.
    // Each worker counts by their productivity (skill, energy, health, mood).
    for (const id of active) {
      if (this.def(id).output !== 'farm') continue;
      const farmWorkers = npcs.filter((n) => (n.employer === id || n.owns === id) && n.workedToday).reduce((s, n) => s + this.sim.npcs.productivity(n), 0);
      const wheat = Math.round(farmWorkers * E.farmOutputPerWorker * (E.seasonFarmMult[season] ?? 1) * this.sim.events.modifier('farm_output'));
      const b = this.biz(id);
      b.stock.wheat = (b.stock.wheat || 0) + wheat;
      // Hay is cut with the harvest (winter fodder for everyone's animals).
      if (season === 'summer' || season === 'autumn') b.stock.hay = Math.min(this.target(id, 'hay') * 2, (b.stock.hay || 0) + Math.round(wheat * 0.6));
    }

    // 3. Workshops make things from their recipes (the owner plus the staff who came in).
    for (const id of active) this.produce(id);
    for (const id of active) this.updateQuality(id);

    // 4. Winter heating: every household buys firewood.
    if (season === 'winter') {
      const homes = new Map();
      for (const n of npcs) if (n.age >= 16 && n.homeId && !homes.has(n.homeId)) homes.set(n.homeId, n);
      const perHome = Math.round(E.winterWoodPerHousehold * this.sim.events.modifier('wood_demand'));
      const cold = [];
      for (const [home, buyer] of homes) {
        const shop = this.cheapestWith('wood');
        let got = shop ? this.npcBuy(buyer, shop, ['wood'], perHome) : 0;
        // Short of money: someone else in the house chips in…
        const family = npcs.filter((n) => n.homeId === home && n.age >= 16 && n !== buyer);
        for (const n of family) if (shop && got < perHome) got += this.npcBuy(n, shop, ['wood'], perHome - got);
        // …or anyone able goes out for dead wood. Only a house with nobody who can is cold (SeasonSystem:
        // unhappy, and they'll ask you for wood).
        const able = [buyer, ...family].some((n) => n.age < 66 && (n.health ?? 100) >= 40);
        if (got < perHome && !able) cold.push(home);
      }
      this.sim.seasons?.setCold(cold);
    }

    // 5. Tools wear out: producers with working crews replace them at a smithy.
    for (const id of active) {
      const def = this.def(id);
      if (def.kind !== 'producer' || !def.toolUsed) continue;
      const crew = npcs.filter((n) => (n.employer === id || n.owns === id) && n.workedToday).length;
      const b = this.biz(id);
      b.toolWear = (b.toolWear || 0) + crew * E.toolWearPerWorkerDay;
      const smith = this.cheapestWith(def.toolUsed);
      if (b.toolWear >= 1 && smith) {
        const price = Math.max(1, Math.round(this.unitPrice(smith, def.toolUsed)));
        if (b.money >= price) {
          b.money -= price;
          this.biz(smith).money += price;
          this.biz(smith).stock[def.toolUsed]--;
          this.ledger(id, 'exp', price);
          this.ledger(smith, 'rev', price);
          b.toolWear -= 1;
        }
      }
    }

    // 6. Surplus the warehouse didn't take is sold cheaply to passing traders — the village's exports.
    this.exportSurplus();

    // 7. Owners pay themselves a basic wage, plus a share of profit when business is good.
    for (const id of active) {
      const owner = this.owner(id);
      if (!owner) continue;
      const b = this.biz(id);
      const surplus = b.money - E.ownerDrawAbove;
      const draw = surplus > 0 ? Math.max(E.ownerDrawPerDay, Math.round(surplus * E.ownerDrawShare)) : b.money >= E.ownerWageAbove ? E.ownerDrawPerDay : 0;
      b.money -= draw;
      owner.money += draw;
    }

    // 8. Trade with the outside world slowly pulls shop stock toward normal.
    this.outsideTrade(E.outsideTradeDrift);

    // 9. Shortages become village news.
    const breadShops = this.sellersOf('bread');
    if (breadShops.length && breadShops.every((id) => this.stock(id, 'bread') === 0) && this.sim.time.day - this.lastShortageDay > 3) {
      this.lastShortageDay = this.sim.time.day;
      this.sim.chronicle('chronicle.shortage', { item: 'bread' });
    }
    this.sim.bus.emit('economy:changed');
  }

  /** Shop with the cheapest stock of an item (for bulk purchases). */
  cheapestWith(item) {
    let best = null;
    let bestP = Infinity;
    for (const id of this.active()) {
      const d = this.def(id);
      if (d.kind !== 'shop' || this.stock(id, item) <= 0) continue;
      if (!d.sells?.includes(item) && !d.buys?.includes(item)) continue;
      const p = this.unitPrice(id, item);
      if (p < bestP) {
        bestP = p;
        best = id;
      }
    }
    return best;
  }

  /** Items a business uses up in its recipes. */
  inputsOf(id) {
    const out = new Set();
    for (const r of Object.values(this.def(id).recipes || {})) for (const alt of r.alts) for (const i of Object.keys(alt.in)) out.add(i);
    return out;
  }

  /**
   * A shop tops up what it buys: recipe inputs, and goods producers deliver.
   * Suppliers: producers (farm, lumberyard, quarry) at wholesale prices, and other
   * shops that sell something we cook with (a tavern buying bread from a bakery) at their price.
   */
  restock(id) {
    const def = this.def(id);
    if (def.kind !== 'shop' && !(def.kind === 'producer' && def.buys)) return; // shops, and processors like the mill
    const b = this.biz(id);
    const inputs = this.inputsOf(id);
    for (const item of def.buys || []) {
      const coming = this.sim.logistics?.incoming(id, item) || 0;
      const want = Math.max(0, Math.round(this.target(id, item) * 1.2) - (b.stock[item] || 0) - coming);
      if (want <= 0) continue;
      const suppliers = [];
      for (const s of this.active()) {
        if (s === id) continue;
        const sd = this.def(s);
        let avail = 0;
        let price = 0;
        if (sd.kind === 'producer') {
          if (sd.buys?.includes(item)) continue; // the mill doesn't sell on its wheat
          avail = this.stock(s, item);
          price = ((ITEMS[item]?.basePrice || 0) * this.priceFactor(id, item)) * 0.75;
        } else if (sd.kind === 'depot') {
          // A warehouse sells on what it bought from producers, with a small margin.
          avail = this.stock(s, item);
          price = ((ITEMS[item]?.basePrice || 0) * this.priceFactor(id, item)) * 0.82;
        } else if (inputs.has(item) && sd.sells?.includes(item)) {
          avail = Math.max(0, this.stock(s, item) - Math.round(this.target(s, item) * 0.5));
          price = this.unitPrice(s, item);
        } else if (sd.sells?.includes(item) && sd.recipes?.[item]) {
          // A workshop's surplus goods (a carpenter's chairs) are sold on to the general store.
          avail = Math.max(0, this.stock(s, item) - this.target(s, item));
          price = this.unitPrice(s, item) * 0.8;
        }
        if (avail > 0) suppliers.push({ s, avail, price: Math.max(1, Math.round(price)) });
      }
      suppliers.sort((a, c) => a.price - c.price);
      let need = want;
      for (const sup of suppliers) {
        if (need <= 0) break;
        const qty = Math.min(need, sup.avail, Math.floor(b.money / sup.price));
        if (qty <= 0) continue;
        const from = this.biz(sup.s);
        from.stock[item] -= qty;
        b.money -= qty * sup.price;
        from.money += qty * sup.price;
        this.ledger(id, 'exp', qty * sup.price);
        this.ledger(sup.s, 'rev', qty * sup.price);
        // The goods travel by road (see LogisticsSystem) — or arrive at once if there's no transport model.
        if (this.sim.logistics) this.sim.logistics.ship(sup.s, id, item, qty);
        else b.stock[item] = (b.stock[item] || 0) + qty;
        need -= qty;
      }
    }
  }

  /** Make goods from recipes: the owner's own daily output plus each worker who came in. */
  produce(id) {
    const def = this.def(id);
    if (!def.recipes) return;
    const b = this.biz(id);
    const staff = this.sim.state.npcs.filter((n) => n.employer === id && n.workedToday);
    const staffPower = staff.reduce((s, n) => s + this.sim.npcs.productivity(n), 0);
    const owner = this.owner(id);
    // A business without its owner limps along (yours runs well when you or a manager mind it).
    const ownerHere = b.owner === 'player' ? this.sim.holdings.presence(id) : owner && owner.owns === id && owner.age >= 16 ? 1 : 0.6;
    b.progress ??= {};
    b.madeToday = 0;
    for (const [item, r] of Object.entries(def.recipes)) {
      const limit = Math.round(this.target(id, item) * (r.cap ?? 1.5));
      // Crop rotation, better tools, the mill — and the premises themselves (a master workshop, a granary).
      const know = (this.sim.tech?.outputMod(b.type) ?? 1) * (this.sim.structures?.outputMult(b.building) ?? 1);
      let capacity = ((r.perDay || 0) * ownerHere + (r.perWorker || 0) * staffPower) * know + (b.progress[item] || 0);
      let made = 0;
      let blocked = null;
      while (capacity >= (r.alts[0].cost || 1) && (b.stock[item] || 0) < limit) {
        const alt = r.alts.find((a) => capacity >= (a.cost || 1) && Object.entries(a.in).every(([i, q]) => (b.stock[i] || 0) >= q));
        if (!alt) {
          // Out of what it's made from: production stops until a supplier delivers.
          blocked = Object.keys(r.alts[0].in).find((i) => (b.stock[i] || 0) < r.alts[0].in[i]);
          break;
        }
        for (const [i, q] of Object.entries(alt.in)) b.stock[i] -= q;
        b.stock[item] = (b.stock[item] || 0) + alt.out;
        made += alt.out;
        capacity -= alt.cost || 1;
      }
      this.noteShortage(id, item, blocked && made === 0 && (b.stock[item] || 0) < this.target(id, item) * 0.5 ? blocked : null);
      // Leftover capacity carries over (so fractional daily output adds up) — but only a little.
      b.progress[item] = Math.min(1, Math.max(0, capacity - Math.floor(capacity)));
      b.madeToday += made;
    }
  }

  /**
   * A business that can't make what it sells because an input ran out: it's noted,
   * owners go looking for other suppliers (restock), and after a couple of days the
   * village hears about it (and contracts appear on the board — see ContractSystem).
   */
  noteShortage(id, product, input) {
    const b = this.biz(id);
    b.short ??= {};
    if (!input) {
      delete b.short[product];
      return;
    }
    const s = (b.short[product] ??= { input, days: 0 });
    s.input = input;
    s.days++;
    if (s.days === 2) {
      // News once in a while, not every time the baker runs low.
      const day = this.sim.time.day;
      if (day - (b.shortNewsDay ?? -99) >= 14) {
        b.shortNewsDay = day;
        this.sim.chronicle('chronicle.business_short', { building: b.building, item: input, item2: product });
      }
      if (b.owner === 'player') this.sim.toast('toast.your_business_short', { building: b.building, item: input }, 'warn');
    }
  }

  /**
   * How good a business's goods are (0 crude … 3 masterwork, fractional): the skill of
   * whoever makes them, better tools, and — for your own business — your hand in it.
   */
  updateQuality(id) {
    const def = this.def(id);
    if (!def.recipes || def.kind !== 'shop') return;
    const b = this.biz(id);
    const makers = this.sim.state.npcs.filter((n) => (n.employer === id || n.owns === id) && n.workedToday);
    const avg = makers.length ? makers.reduce((s, n) => s + (n.level || 1), 0) / makers.length : 1;
    let q = 0.55 + avg * 0.11 + ((this.sim.tech?.mod('gather_output') ?? 1) > 1 ? 0.1 : 0);
    if (b.owner === 'player' && b.workedDay === this.sim.time.day) {
      const skill = { bakery: 'cooking', tavern: 'cooking', smithy: 'smithing', carpentry: 'carpentry' }[b.type];
      if (skill) q += (this.sim.state.player.skills[skill]?.level || 0) * 0.08;
    }
    // Quality changes slowly: it's how the place is known.
    b.quality = Math.round(Math.max(0, Math.min(3, (b.quality ?? 1) * 0.8 + q * 0.2)) * 100) / 100;
    b.reputation = Math.max(0, Math.min(100, (b.reputation ?? 50) + (b.quality - 1) * 0.15));
  }

  /** A warehouse takes producers' surplus off their hands (shipped over by road). */
  depotBuy(id) {
    const def = this.def(id);
    const d = this.biz(id);
    for (const s of this.active()) {
      if (this.def(s).kind !== 'producer') continue;
      const p = this.biz(s);
      for (const item of Object.keys(this.def(s).targets || {})) {
        if (!def.targets[item]) continue;
        const room = Math.round(def.targets[item] * 1.5) - (d.stock[item] || 0) - (this.sim.logistics?.incoming(id, item) || 0);
        const surplus = (p.stock[item] || 0) - Math.round(this.target(s, item) * 0.5);
        const price = Math.max(1, Math.round((ITEMS[item]?.basePrice || 1) * E.depotBuyFactor));
        const qty = Math.min(room, surplus, Math.floor(d.money / price));
        if (qty <= 0) continue;
        p.stock[item] -= qty;
        d.money -= qty * price;
        p.money += qty * price;
        this.ledger(id, 'exp', qty * price);
        this.ledger(s, 'rev', qty * price);
        if (this.sim.logistics) this.sim.logistics.ship(s, id, item, qty);
        else d.stock[item] = (d.stock[item] || 0) + qty;
      }
    }
  }

  /** Producers (and warehouses, at a better price) sell stock above target to outside traders. */
  exportSurplus() {
    const S = this.sim.state;
    S.exportsWeek ??= 0;
    for (const id of this.active()) {
      const def = this.def(id);
      if (def.kind !== 'producer' && def.kind !== 'depot') continue;
      const b = this.biz(id);
      const depot = def.kind === 'depot';
      for (const item of Object.keys(def.targets)) {
        const keep = Math.round(def.targets[item] * (depot ? 1 : 0.5));
        const surplus = Math.min(E.exportPerDay * (depot ? 2 : 1), (b.stock[item] || 0) - keep);
        if (surplus <= 0) continue;
        b.stock[item] -= surplus;
        // Traders pay less the more you dump on them in one day.
        const glut = Math.max(0.45, 1 - surplus * 0.015);
        // Known settlements short of it pay more (see SettlementSystem) — and the goods go there.
        const earned = Math.round(surplus * ITEMS[item].basePrice * (depot ? E.depotExportFactor : E.exportPriceFactor) * glut * this.sim.events.modifier('export_price') * this.sim.events.itemPrice(item) * (this.sim.exploration?.tradeFactor() ?? 1) * (this.sim.settlements?.exportFactor(item) ?? 1) * (this.sim.tech?.mod('export_price') ?? 1));
        this.sim.settlements?.absorbExport(item, surplus);
        b.money += earned;
        this.ledger(id, 'rev', earned);
        if (!depot) S.exportsWeek += surplus;
      }
    }
  }

  /** Is there demand for more of this item from this producer? Workers idle when the yard is overflowing. */
  wantsMore(id, item) {
    // A collapsed mine stays shut until it's made safe.
    if (this.def(id)?.type === 'quarry' && this.sim.events.modifier('halt_quarry') === 0) return false;
    return this.stock(id, item) < this.target(id, item) * E.producerStockLimit;
  }

  /** Imports goods that are short and exports surpluses, with money changing hands. */
  outsideTrade(drift) {
    for (const id of this.active()) {
      const def = this.def(id);
      if (def.kind !== 'shop') continue;
      const b = this.biz(id);
      const inputs = this.inputsOf(id);
      for (const item of [...Object.keys(def.targets), ...(def.buysFromYou || [])]) {
        // What only you bring in (eggs, milk, wool) is never imported — its surplus just goes to traders.
        if (def.buysFromYou?.includes(item) && (b.stock[item] || 0) <= this.target(id, item) * 0.5) continue;
        // Things a workshop makes itself aren't imported (a bakery bakes its own bread)…
        if (def.recipes?.[item] && !def.recipes[item].import) continue;
        const cur = b.stock[item] || 0;
        const target = def.targets[item] ?? this.target(id, item) * 0.5;
        const delta = Math.round((target - cur) * drift);
        const base = ITEMS[item].basePrice;
        if (delta > 0) {
          // …and raw inputs come from local producers first; import only what they can't supply.
          if (inputs.has(item) && this.active().some((s) => this.def(s).kind === 'producer' && this.stock(s, item) > 0)) continue;
          // Cheaper from a known settlement that makes it (and it comes out of their stores).
          const cost = Math.max(1, Math.round(base * 0.9 * (this.sim.settlements?.importFactor(item) ?? 1)));
          const n = Math.min(delta, Math.floor(b.money / Math.max(1, cost)));
          if (n > 0) this.sim.settlements?.drawImport(item, n);
          b.stock[item] = cur + n;
          b.money -= n * cost;
          this.ledger(id, 'exp', n * cost);
        } else if (delta < 0) {
          b.stock[item] = cur + delta;
          const earned = Math.round(-delta * base * 0.6);
          b.money += earned;
          this.ledger(id, 'rev', earned);
        }
      }
    }
  }

  caravan() {
    this.outsideTrade(E.caravanDrift);
  }

  /** Items whose price at the main store is unusually high or low — used in NPC small talk. */
  priceNews() {
    const out = { expensive: [], cheap: [] };
    const shop = this.biz('store') && !this.biz('store').closed ? 'store' : this.ofSector('grocery')[0];
    if (!shop) return out;
    for (const item of [...new Set([...this.def(shop).sells, ...this.def(shop).buys])]) {
      const f = this.priceFactor(shop, item);
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
