/**
 * FarmingSystem — fields on your own land.
 *
 *   till soil (hoe) → plant seeds → water (watering can, or rain) → wait → harvest
 *
 * Each tile is tracked in state.fields["tx,ty"]:
 *   { crop, growth, watered, dead }
 * Crops grow once per day: fully when watered (or it rained), slowly when dry,
 * faster on land near water. Out of season they wither; winter kills everything.
 */
import { CROPS, FARMING } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { T } from '../world/WorldGenerator.js';
import { Mod, skill } from './Modifiers.js';
import { rand } from '../core/rng.js';

const TILLABLE = new Set([T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST, T.DIRT, T.SAND]);

export class FarmingSystem {
  constructor(sim) {
    this.sim = sim;
    for (const f of Object.values(sim.state.fields)) delete f.reservedBy; // runtime-only
    sim.bus.on('time:day', () => this.dailyGrowth());
    sim.bus.on('time:hour', () => {
      if (sim.weather.type === 'rain' || sim.weather.type === 'storm') this.rainWaters();
    });
  }

  get fields() {
    return this.sim.state.fields;
  }
  key(tx, ty) {
    return `${tx},${ty}`;
  }
  field(tx, ty) {
    return this.fields[this.key(tx, ty)] || null;
  }

  /** Growth stage 0–3 (3 = ripe) of a planted tile. */
  stage(f) {
    if (!f?.crop) return -1;
    const days = CROPS[f.crop].days;
    if (f.growth >= days) return 3;
    return Math.min(2, Math.floor((f.growth / days) * 3));
  }

  isRipe(f) {
    return !!f?.crop && !f.dead && f.growth >= CROPS[f.crop].days;
  }

  // ------------------------------------------------------------------ what can be done on a tile

  /** The one sensible action for this tile right now: till / plant / water / harvest / clear. */
  actionFor(tx, ty) {
    const f = this.field(tx, ty);
    if (!f) return 'till';
    if (f.dead) return 'clear';
    if (!f.crop) return 'plant';
    if (this.isRipe(f)) return 'harvest';
    return 'water';
  }

  check(action, tx, ty, seedItem = null) {
    const sim = this.sim;
    const p = sim.state.player;
    const world = sim.world;
    if (!sim.progression.hasUnlock('farming')) return { ok: false, reason: 'locked', params: { level: sim.progression.unlockLevel('farming') } };
    if (!sim.land.ownsTile(tx, ty)) return { ok: false, reason: 'not_your_land' };
    if (p.energy < (FARMING.energy[action] || 0) + 1) return { ok: false, reason: 'too_tired' };
    const f = this.field(tx, ty);
    switch (action) {
      case 'till':
        if (f) return { ok: false, reason: 'already_tilled' };
        if (!TILLABLE.has(world.tileAt(tx, ty)) || world.isBlocked(tx, ty) || world.isRoad(tx, ty)) return { ok: false, reason: 'bad_ground' };
        if (!sim.inventory.bestTool('hoe')) return { ok: false, reason: 'need_hoe' };
        return { ok: true };
      case 'plant': {
        if (!f || f.crop) return { ok: false, reason: 'nothing_here' };
        const seed = seedItem || this.seedsCarried()[0];
        if (!seed) return { ok: false, reason: 'no_seeds' };
        const crop = ITEMS[seed].seed;
        if (!CROPS[crop].seasons.includes(sim.time.season)) return { ok: false, reason: 'wrong_season_crop', params: { item: seed } };
        return { ok: true };
      }
      case 'water': {
        if (!f?.crop || f.dead) return { ok: false, reason: 'nothing_here' };
        if (f.watered) return { ok: false, reason: 'already_watered' };
        const can = sim.inventory.bestTool('watering_can');
        if (!can) return { ok: false, reason: 'need_watering_can' };
        if ((can.water || 0) <= 0) return { ok: false, reason: 'can_empty' };
        return { ok: true };
      }
      case 'harvest':
        return this.isRipe(f) ? { ok: true } : { ok: false, reason: 'not_ripe' };
      case 'clear':
        return f?.dead ? { ok: true } : { ok: false, reason: 'nothing_here' };
    }
    return { ok: false, reason: 'nothing_here' };
  }

  seedsCarried() {
    return [...new Set(this.sim.inventory.slots.filter((s) => ITEMS[s.id].seed).map((s) => s.id))];
  }

  duration(action) {
    const p = this.sim.state.player;
    let speed = Mod.farmSpeed(p) * this.sim.needs.productivity();
    if (action === 'till') {
      const hoe = this.sim.inventory.bestTool('hoe');
      if (hoe) speed *= this.sim.inventory.toolEfficiency(hoe);
    }
    return Math.round(FARMING.actionMs[action] / Math.max(0.3, speed));
  }

  /** Apply an action (after its animation). */
  perform(action, tx, ty, seedItem = null) {
    const c = this.check(action, tx, ty, seedItem);
    if (!c.ok) {
      this.sim.toast(`reason.${c.reason}`, c.params || {}, 'warn');
      return false;
    }
    const sim = this.sim;
    const k = this.key(tx, ty);
    switch (action) {
      case 'till':
        this.fields[k] = { crop: null, growth: 0, watered: false, dead: false };
        sim.inventory.useTool('hoe');
        break;
      case 'plant': {
        const seed = seedItem || this.seedsCarried()[0];
        // An efficient farmer sometimes saves the seed.
        if (!rand.chance(Mod.perk(sim.state.player, 'seed_save'))) sim.inventory.remove(seed, 1);
        Object.assign(this.fields[k], { crop: ITEMS[seed].seed, growth: 0, dead: false, plantedDay: sim.time.day });
        break;
      }
      case 'water': {
        const can = sim.inventory.bestTool('watering_can');
        can.water--;
        this.fields[k].watered = true;
        sim.inventory.changed();
        break;
      }
      case 'harvest': {
        const f = this.fields[k];
        const crop = CROPS[f.crop];
        const qty = rand.int(crop.yield[0], crop.yield[1]) + Math.floor(skill(sim.state.player, 'farming') / 3);
        const added = sim.inventory.add(crop.item, qty);
        if (added < qty) sim.home.store(crop.item, qty - added, { force: true });
        sim.toast('toast.gained', { qty, item: crop.item }, 'gain');
        Object.assign(f, { crop: null, growth: 0, watered: false });
        sim.state.stats.cropsHarvested++;
        break;
      }
      case 'clear':
        Object.assign(this.fields[k], { crop: null, growth: 0, watered: false, dead: false });
        break;
    }
    sim.needs.spendEnergy(FARMING.energy[action] || 0);
    if (FARMING.xp[action]) sim.progression.addXp(FARMING.xp[action]);
    if (FARMING.skillXp[action]) sim.progression.addSkillXp('farming', FARMING.skillXp[action]);
    sim.bus.emit('field:changed', { tx, ty });
    return true;
  }

  // ------------------------------------------------------------------ water

  /** Is there water to fill a can at (tx, ty)? River, lake or a well. */
  isWaterSource(tx, ty) {
    const world = this.sim.world;
    if (world.isWater(tx, ty)) return true;
    if (this.sim.construction.isWaterSource(tx, ty)) return true;
    return world.decor.some((d) => d.type === 'well' && Math.abs(d.tx - tx) <= 1 && Math.abs(d.ty - ty) <= 1);
  }

  /** How much a watering can holds (the Water Saver perk doubles it). */
  canCapacity(can) {
    return Math.round(ITEMS[can.id].tool.water * (1 + Mod.perk(this.sim.state.player, 'can_capacity')));
  }

  canNeedsRefill() {
    const can = this.sim.inventory.bestTool('watering_can');
    return !!can && can.water < this.canCapacity(can);
  }

  refillCan() {
    const can = this.sim.inventory.bestTool('watering_can');
    if (!can) {
      this.sim.toast('reason.need_watering_can', {}, 'warn');
      return false;
    }
    can.water = this.canCapacity(can);
    this.sim.inventory.changed();
    this.sim.toast('toast.can_filled', {}, 'info');
    return true;
  }

  // ------------------------------------------------------------------ growth

  rainWaters() {
    let any = false;
    for (const f of Object.values(this.fields)) {
      if (f.crop && !f.dead && !f.watered) {
        f.watered = true;
        any = true;
      }
    }
    if (any) this.sim.bus.emit('fields:changed');
  }

  dailyGrowth() {
    const season = this.sim.time.season;
    const drought = this.sim.events.modifier('farm_output') < 1 ? 0.6 : 1;
    for (const [k, f] of Object.entries(this.fields)) {
      if (!f.crop || f.dead) {
        f.watered = false;
        continue;
      }
      const crop = CROPS[f.crop];
      if (!crop.seasons.includes(season)) {
        f.dead = true; // out of season: it withers
      } else if (f.growth < crop.days) {
        const [tx, ty] = k.split(',').map(Number);
        const plot = this.sim.land.plotAt(tx, ty);
        const nearWater = plot && this.sim.land.hasFeature(plot.id, 'water');
        const base = f.watered ? 1 : FARMING.dryGrowth;
        const planner = 1 + Mod.perk(this.sim.state.player, 'crop_growth');
        f.growth = Math.min(crop.days, f.growth + base * (nearWater ? 1 + FARMING.waterBonus : 1) * drought * planner);
      }
      f.watered = false;
    }
    this.sim.bus.emit('fields:changed');
  }
}
