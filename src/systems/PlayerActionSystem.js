/**
 * PlayerActionSystem — physical actions on world objects:
 * chopping trees, mining rocks, foraging berries and harvesting crops.
 *
 * check()    → can the player do it right now? (tool, energy, skill, capacity...)
 * duration() → how long it takes in real time (skills, attributes, tool, needs, weather)
 * complete() → apply the result (items, XP, tool wear, energy)
 */
import { BALANCE } from '../config/balance.js';
import { ITEMS } from '../data/items.js';
import { Mod, skill } from './Modifiers.js';
import { rand } from '../core/rng.js';

const A = BALANCE.actions;
const KIND_BY_OBJECT = { tree: 'chop', rock: 'mine', bush: 'forage', crop: 'harvest' };
const TOOL_BY_ACTION = { chop: 'axe', mine: 'pickaxe' };

export class PlayerActionSystem {
  constructor(sim) {
    this.sim = sim;
  }

  get p() {
    return this.sim.state.player;
  }

  actionFor(obj) {
    // A growing plant in a farmer's field you've been asked to water.
    if (obj?.kind === 'crop' && obj.stage < 3 && this.sim.contracts?.waterAt(obj)) return 'water';
    return KIND_BY_OBJECT[obj?.kind];
  }

  /** Returns { ok, reason, params }. */
  check(obj) {
    const kind = this.actionFor(obj);
    if (kind === 'water') {
      const can = this.sim.inventory.bestTool('watering_can');
      if (!can) return { ok: false, reason: 'need_watering_can' };
      if ((can.water || 0) <= 0) return { ok: false, reason: 'can_empty' };
      if (this.p.energy < A.water.energy) return { ok: false, reason: 'too_tired' };
      return { ok: true };
    }
    if (!kind || !this.sim.resources.isHarvestable(obj)) return { ok: false, reason: 'nothing_here' };
    const p = this.p;
    const toolKind = TOOL_BY_ACTION[kind];
    if (toolKind && !this.sim.inventory.bestTool(toolKind)) return { ok: false, reason: `need_${toolKind}` };
    if (kind === 'mine' && obj.variant === 'iron' && !this.sim.progression.hasUnlock('advanced_gathering')) {
      return { ok: false, reason: 'locked', params: { level: this.sim.progression.unlockLevel('advanced_gathering') } };
    }
    if (kind === 'mine' && obj.variant !== 'stone') {
      const need = BALANCE.resources.oreSkillRequired[obj.variant] || 0;
      if (skill(p, 'mining') < need) return { ok: false, reason: 'need_skill', params: { skill: 'mining', level: need } };
    }
    if (kind === 'harvest') {
      const job = this.sim.jobs.active;
      // Your harvest job at the farm — or a farmer's harvest you've taken on (ContractSystem).
      if (job?.type === 'harvest') {
        if (job.harvested >= job.qty) return { ok: false, reason: 'harvested_enough' };
      } else if (!this.sim.contracts.harvestAt(obj)) return { ok: false, reason: 'crops_not_yours' };
    }
    if (p.energy < A[kind].energy) return { ok: false, reason: 'too_tired' };
    const item = kind === 'chop' ? 'wood' : kind === 'forage' ? 'berries' : kind === 'harvest' ? 'wheat' : 'stone';
    if (!this.sim.inventory.canAdd(item, 1)) return { ok: false, reason: 'too_heavy' };
    return { ok: true };
  }

  /** Real-time duration in ms. */
  duration(obj) {
    const kind = this.actionFor(obj);
    const toolKind = TOOL_BY_ACTION[kind];
    const tool = toolKind ? this.sim.inventory.bestTool(toolKind) : null;
    const toolEff = tool ? ITEMS[tool.id].tool.efficiency : 1;
    const speed = Mod.actionSpeed(this.p, kind) * toolEff * this.sim.needs.productivity() * this.sim.weather.mods().action;
    return Math.round(A[kind].ms / Math.max(0.2, speed));
  }

  complete(obj) {
    const c = this.check(obj);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const kind = this.actionFor(obj);
    const res = this.sim.resources;
    const inv = this.sim.inventory;
    if (kind === 'water') {
      // The farmer's plant, watered from your can (it counts towards the job).
      const can = inv.bestTool('watering_can');
      can.water--;
      inv.changed();
      this.sim.needs.spendEnergy(A.water.energy);
      this.sim.progression.addXp(A.water.xp);
      this.sim.progression.addSkillXp(A.water.skill, A.water.skillXp);
      this.sim.bus.emit('player:action', { kind: 'water_crop', obj });
      this.sim.bus.emit('player:changed');
      return true;
    }
    let item;
    let qty;
    switch (kind) {
      case 'chop':
        item = 'wood';
        qty = res.fellTree(obj.id) + Mod.extraYield(this.p, 'chop');
        this.sim.state.stats.treesChopped++;
        break;
      case 'mine': {
        const r = res.mineRock(obj.id);
        item = r.item;
        qty = r.qty + Mod.extraYield(this.p, 'mine');
        this.sim.state.stats.rocksMined++;
        // A geologist's eye: sometimes you spot a new seam nearby.
        if (rand.chance(Mod.perk(this.p, 'vein_find'))) this.sim.nature.discoverVein(rand.pick(['iron', 'coal', 'stone']), { tx: obj.tx, ty: obj.ty });
        break;
      }
      case 'forage':
        item = 'berries';
        qty = res.forageBush(obj.id) + Mod.extraYield(this.p, 'forage');
        break;
      case 'harvest':
        item = 'wheat';
        qty = res.harvestCrop(obj.id) + Mod.extraYield(this.p, 'harvest');
        this.sim.state.stats.cropsHarvested++;
        break;
    }
    const added = inv.add(item, qty);
    if (TOOL_BY_ACTION[kind]) inv.useTool(TOOL_BY_ACTION[kind]);
    this.sim.needs.spendEnergy(A[kind].energy);
    this.sim.progression.addXp(A[kind].xp);
    this.sim.progression.addSkillXp(A[kind].skill, A[kind].skillXp);
    this.sim.toast('toast.gained', { qty: added, item }, 'gain');
    if (added < qty) this.sim.toast('toast.left_behind', { qty: qty - added, item }, 'warn');
    this.sim.bus.emit('player:action', { kind, obj, item, qty: added });
    this.sim.bus.emit('player:changed');
    return true;
  }

  // ---------- Fishing and hunting ----------

  checkFish() {
    if (!this.sim.inventory.bestTool('fishing_rod')) return { ok: false, reason: 'need_fishing_rod' };
    if (this.p.energy < A.fish.energy) return { ok: false, reason: 'too_tired' };
    if (!this.sim.inventory.canAdd('fish', 1)) return { ok: false, reason: 'too_heavy' };
    return { ok: true };
  }

  fishDuration() {
    const speed = (1 + skill(this.p, 'fishing') * 0.06) * (1 + Mod.perk(this.p, 'fish_speed')) * this.sim.needs.productivity() * this.sim.weather.mods().action;
    return Math.round(A.fish.ms / Math.max(0.2, speed));
  }

  /** Cast a line: whether anything bites depends on how many fish are left in this water. */
  fish(tx, ty) {
    const c = this.checkFish();
    if (!c.ok) return this.fail(c.reason);
    const inv = this.sim.inventory;
    const caught = this.sim.nature.catchFish(tx, ty, skill(this.p, 'fishing') * 0.03);
    inv.useTool('fishing_rod');
    this.sim.needs.spendEnergy(A.fish.energy);
    this.sim.progression.addSkillXp('fishing', caught ? A.fish.skillXp : Math.round(A.fish.skillXp / 3));
    if (caught) {
      // A good cast sometimes brings in two (Net Caster).
      inv.add('fish', 1 + (rand.chance(Mod.perk(this.p, 'fish_extra')) ? 1 : 0));
      this.sim.progression.addXp(A.fish.xp);
      this.sim.toast('toast.gained', { qty: 1, item: 'fish' }, 'gain');
    } else this.sim.toast(this.sim.nature.fishChance(this.sim.nature.waterBody(tx, ty)) < 0.3 ? 'toast.fish_scarce' : 'toast.no_bite', {}, 'info');
    this.sim.bus.emit('player:action', { kind: 'fish', item: 'fish', qty: caught });
    this.sim.bus.emit('player:changed');
    return !!caught;
  }

  checkHunt() {
    if (!this.sim.inventory.bestTool('bow')) return { ok: false, reason: 'need_bow' };
    if (this.p.energy < A.hunt.energy) return { ok: false, reason: 'too_tired' };
    if (!this.sim.inventory.canAdd('meat', 3)) return { ok: false, reason: 'too_heavy' };
    return { ok: true };
  }

  /** Loose an arrow at an animal. Returns true on a hit. */
  hunt(kind) {
    const c = this.checkHunt();
    if (!c.ok) return this.fail(c.reason);
    const inv = this.sim.inventory;
    inv.useTool('bow');
    this.sim.needs.spendEnergy(A.hunt.energy);
    const hit = rand.chance(Math.min(0.95, 0.4 + skill(this.p, 'hunting') * 0.05 + (this.p.attributes.agility || 0) * 0.01 + Mod.perk(this.p, 'hunt_success'))) && this.sim.nature.hunted(kind);
    this.sim.progression.addSkillXp('hunting', hit ? A.hunt.skillXp : Math.round(A.hunt.skillXp / 3));
    if (!hit) {
      this.sim.toast('toast.missed', {}, 'info');
      return false;
    }
    const meat = kind === 'deer' ? 3 : 1;
    inv.add('meat', meat);
    const hides = (kind === 'deer' ? 1 : 0) + Mod.perk(this.p, 'hide_bonus');
    if (hides) inv.add('hide', hides);
    this.sim.progression.addXp(A.hunt.xp * (kind === 'deer' ? 2 : 1));
    this.sim.toast('toast.gained', { qty: meat, item: 'meat' }, 'gain');
    this.sim.bus.emit('player:action', { kind: 'hunt', item: 'meat', qty: meat });
    this.sim.bus.emit('player:changed');
    return true;
  }

  // ---------- Other actions ----------

  canDrinkWell() {
    return this.sim.time.total - this.p.lastWellMinute >= BALANCE.needs.wellCooldownMinutes;
  }

  drinkWell() {
    if (!this.canDrinkWell()) {
      this.sim.toast('toast.well_not_thirsty', {}, 'info');
      return false;
    }
    this.p.lastWellMinute = this.sim.time.total;
    this.p.energy = Math.min(100, this.p.energy + BALANCE.needs.wellEnergy);
    this.sim.toast('toast.well_drink', {}, 'info');
    this.sim.bus.emit('player:changed');
    return true;
  }

  /** Buy a hot meal at the tavern and eat it on the spot. */
  eatAtTavern(bizId = 'tavern') {
    const price = this.sim.economy.playerBuyPrice(bizId, 'stew');
    const b = this.sim.economy.biz(bizId);
    if ((b.stock.stew || 0) <= 0) return this.fail('out_of_stock');
    if (this.p.money < price) return this.fail('no_money');
    this.p.money -= price;
    b.money += price;
    b.stock.stew--;
    this.sim.economy.ledger(bizId, 'rev', price);
    this.sim.needs.applyFood(ITEMS.stew.food);
    this.sim.toast('toast.ate_meal', { money: price }, 'info');
    this.sim.bus.emit('economy:changed');
    return true;
  }

  /** Pay for a bed at the tavern. Returns true if paid. */
  payTavernBed(bizId = 'tavern') {
    const price = BALANCE.tavernBedPrice;
    if (this.p.money < price) return this.fail('no_money');
    this.p.money -= price;
    this.sim.economy.biz(bizId).money += price;
    this.sim.economy.ledger(bizId, 'rev', price);
    return true;
  }

  fail(reason) {
    this.sim.toast(`reason.${reason}`, {}, 'warn');
    return false;
  }
}
