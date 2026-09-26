/**
 * HomeSystem — the player's home: its tier, storage chest and comfort.
 *
 * Storage is a second inventory that lives in your home (state.player.storage).
 * It has no carrying limit, only the chest capacity of your home tier.
 * Furniture kept at home (stools, chairs, tables) makes it more comfortable,
 * which means better sleep.
 */
import { ITEMS } from '../data/items.js';
import { HOME_TIERS, HOME_ORDER, FURNITURE_COMFORT_CAP, WINTER_COLD } from '../data/homes.js';
import { Q } from '../data/quality.js';
import { addTo, removeFrom } from './slots.js';
import { Mod } from './Modifiers.js';

export class HomeSystem {
  constructor(sim) {
    this.sim = sim;
  }

  get p() {
    return this.sim.state.player;
  }
  get tierId() {
    // A house of yours: its level decides the tier (StructureSystem); a rented room keeps what it was.
    return this.sim.structures?.homeTier() || this.p.homeTier || 'shack';
  }

  /** Your home's structure effects (modules, quality) — or nothing, for the shack you rent. */
  homeFx() {
    const id = this.p.homeId;
    return (id && this.sim.structures?.fx(id)) || null;
  }
  get tier() {
    return HOME_TIERS[this.tierId];
  }
  get storage() {
    return this.p.storage;
  }

  nextTier() {
    const i = HOME_ORDER.indexOf(this.tierId);
    return i >= 0 && i < HOME_ORDER.length - 1 ? HOME_ORDER[i + 1] : null;
  }

  storageCapacity() {
    // Storage sheds you build add capacity (see ConstructionSystem).
    return this.tier.storage + (this.sim.construction?.extraStorage() || 0) + (this.homeFx()?.storage || 0);
  }

  storageWeight() {
    let w = 0;
    for (const s of this.storage) w += (ITEMS[s.id]?.weight || 0) * s.qty;
    return Math.round(w * 10) / 10;
  }

  storageCount(id) {
    let n = 0;
    for (const s of this.storage) if (s.id === id) n += s.qty;
    return n;
  }

  /** Comfort: home tier + furniture kept at home (capped). */
  comfort() {
    let bonus = 0;
    for (const s of this.storage) bonus += (ITEMS[s.id]?.comfort || 0) * Q(s.q).comfort * s.qty; // finer furniture, more comfort
    // A kitchen, a parlour, a garden (modules) — and how well the house was built.
    const fx = this.homeFx();
    const built = fx ? fx.comfort + Math.round((this.sim.structures.quality(this.p.homeId) - 50) / 10) : 0;
    return this.tier.comfort + Math.min(FURNITURE_COMFORT_CAP, bonus) + built - this.cold();
  }

  /** Add to storage (respects capacity unless force). Returns amount stored. */
  store(id, qty, { force = false, q } = {}) {
    const def = ITEMS[id];
    if (!def || qty <= 0) return 0;
    const free = this.storageCapacity() - this.storageWeight();
    const fits = def.weight > 0 ? Math.floor(free / def.weight + 1e-6) : qty;
    const n = force ? qty : Math.max(0, Math.min(qty, fits));
    if (n <= 0) return 0;
    addTo(this.storage, id, n, q);
    this.changed();
    return n;
  }

  /** Take up to qty out of the chest (the worst first). Qualities taken: this.lastTaken. */
  take(id, qty, { prefer = 'low' } = {}) {
    const taken = removeFrom(this.storage, id, qty, prefer);
    this.lastTaken = taken;
    if (taken.length) this.changed();
    return taken.length;
  }

  /** Inventory → chest. Tools move with their durability. */
  deposit(slotIndex, qty) {
    const inv = this.sim.inventory;
    const slot = inv.slots[slotIndex];
    if (!slot || ITEMS[slot.id].questItem) return 0;
    if (ITEMS[slot.id].tool) {
      const def = ITEMS[slot.id];
      if (this.storageWeight() + def.weight > this.storageCapacity()) return 0;
      inv.removeSlot(slotIndex);
      this.storage.push({ ...slot });
      this.changed();
      return 1;
    }
    const n = this.store(slot.id, Math.min(qty, slot.qty), { q: slot.q });
    slot.qty -= n;
    if (slot.qty <= 0) inv.slots.splice(slotIndex, 1);
    inv.changed();
    return n;
  }

  /** Chest → inventory. */
  withdraw(storageIndex, qty) {
    const inv = this.sim.inventory;
    const slot = this.storage[storageIndex];
    if (!slot) return 0;
    if (ITEMS[slot.id].tool) {
      if (!inv.canAdd(slot.id, 1)) return 0;
      this.storage.splice(storageIndex, 1);
      inv.slots.push({ ...slot });
      inv.changed();
      this.changed();
      return 1;
    }
    const n = Math.min(qty, slot.qty, inv.maxAddable(slot.id));
    if (n <= 0) return 0;
    const q = slot.q;
    slot.qty -= n;
    if (slot.qty <= 0) this.storage.splice(storageIndex, 1);
    this.changed();
    inv.add(slot.id, n, { q });
    return n;
  }

  /** Winter without a fire (or with one and no firewood for it): colder nights, worse sleep. */
  cold() {
    if (this.sim.time.season !== 'winter') return 0;
    const furn = this.tier.furniture.map((f) => f.type);
    // A fire needs firewood (SeasonSystem feeds it from your storage each evening): unlit, it's as cold as no fire.
    const lit = this.sim.seasons ? this.sim.seasons.heated() : true;
    const cold = !lit ? WINTER_COLD.none : furn.includes('fireplace') ? 0 : furn.includes('stove') ? WINTER_COLD.stove : WINTER_COLD.none;
    return this.homeFx()?.warm ? Math.round(cold / 2) : cold; // a cellar keeps the worst of the frost out
  }

  /** Reading at your bookshelf: you learn (a few times a day, then it stops sinking in). */
  canRead() {
    const p = this.p;
    if (p.readDay === this.sim.time.day && (p.readsToday || 0) >= 3) return { ok: false, reason: 'read_enough' };
    if (p.energy < 5) return { ok: false, reason: 'too_tired' };
    return { ok: true };
  }

  read() {
    if (!this.canRead().ok) return false;
    const p = this.p;
    if (p.readDay !== this.sim.time.day) p.readsToday = 0;
    p.readDay = this.sim.time.day;
    p.readsToday++;
    this.sim.needs.spendEnergy(3);
    this.sim.progression.addSkillXp('learning', 14);
    this.sim.progression.addXp(4);
    this.sim.tech?.addKnowledge(0.1);
    this.sim.toast('toast.read_books', {}, 'info');
    return true;
  }

  /** Warming up by the fire: a little health and cheer, and it's cosy in winter. */
  warmUp() {
    const p = this.p;
    const winter = this.sim.time.season === 'winter';
    p.health = Math.min(100, p.health + (winter ? 6 : 2));
    p.energy = Math.min(100, p.energy + (winter ? 4 : 1));
    this.sim.toast(winter ? 'toast.warm_winter' : 'toast.warm', {}, 'info');
    this.sim.bus.emit('player:changed');
    return true;
  }

  /** A proper meal at the table: best food from pockets or pantry, with a small bonus. */
  eatAtTable() {
    const p = this.p;
    if (p.hunger >= 97) {
      this.sim.toast('toast.not_hungry', {}, 'info');
      return false;
    }
    let id = this.sim.inventory.bestFoodToEat();
    let fromStorage = false;
    if (!id) {
      id = this.storage.filter((s) => ITEMS[s.id].food).sort((a, b) => ITEMS[b.id].food.hunger - ITEMS[a.id].food.hunger)[0]?.id;
      fromStorage = !!id;
    }
    if (!id) {
      this.sim.toast('toast.no_food', {}, 'warn');
      return false;
    }
    let q;
    if (fromStorage) {
      this.take(id, 1);
      q = this.lastTaken[0];
    } else {
      this.sim.inventory.remove(id, 1);
      q = this.sim.inventory.lastRemoved[0];
    }
    const food = Mod.meal(this.p, ITEMS[id].food, q);
    this.sim.needs.applyFood({ ...food, energy: (food.energy || 0) + 3 });
    this.sim.toast('toast.ate_table', { item: id }, 'info');
    return true;
  }

  changed() {
    this.sim.bus.emit('storage:changed');
  }
}
