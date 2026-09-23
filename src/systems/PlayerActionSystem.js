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
    return KIND_BY_OBJECT[obj?.kind];
  }

  /** Returns { ok, reason, params }. */
  check(obj) {
    const kind = this.actionFor(obj);
    if (!kind || !this.sim.resources.isHarvestable(obj)) return { ok: false, reason: 'nothing_here' };
    const p = this.p;
    const toolKind = TOOL_BY_ACTION[kind];
    if (toolKind && !this.sim.inventory.bestTool(toolKind)) return { ok: false, reason: `need_${toolKind}` };
    if (kind === 'mine' && obj.variant !== 'stone') {
      const need = BALANCE.resources.oreSkillRequired[obj.variant] || 0;
      if (skill(p, 'mining') < need) return { ok: false, reason: 'need_skill', params: { skill: 'mining', level: need } };
    }
    if (kind === 'harvest') {
      const job = this.sim.jobs.active;
      if (!job || job.type !== 'harvest') return { ok: false, reason: 'crops_not_yours' };
      if (job.harvested >= job.qty) return { ok: false, reason: 'harvested_enough' };
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
  eatAtTavern() {
    const price = this.sim.economy.playerBuyPrice('tavern', 'stew');
    const b = this.sim.economy.biz('tavern');
    if ((b.stock.stew || 0) <= 0) return this.fail('out_of_stock');
    if (this.p.money < price) return this.fail('no_money');
    this.p.money -= price;
    b.money += price;
    b.stock.stew--;
    this.sim.needs.applyFood(ITEMS.stew.food);
    this.sim.toast('toast.ate_meal', { money: price }, 'info');
    this.sim.bus.emit('economy:changed');
    return true;
  }

  /** Pay for a bed at the tavern. Returns true if paid. */
  payTavernBed() {
    const price = BALANCE.tavernBedPrice;
    if (this.p.money < price) return this.fail('no_money');
    this.p.money -= price;
    this.sim.economy.biz('tavern').money += price;
    return true;
  }

  fail(reason) {
    this.sim.toast(`reason.${reason}`, {}, 'warn');
    return false;
  }
}
