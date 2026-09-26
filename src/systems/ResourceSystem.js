/**
 * ResourceSystem — trees, rocks, berry bushes and crops in the world.
 *
 * Objects live in state.objects and change state when used:
 *   tree:  grown → stump → (regrows after some days) → grown
 *   rock:  full → rubble → (deposit replenishes) → full
 *   bush:  full → empty → (berries regrow, not in winter) → full
 *   crop:  stage 0 (soil) → 1 (sprout) → 2 (growing) → 3 (ripe) → harvested → 0
 *
 * Both the player and NPC workers use the same functions, so villagers
 * cutting trees really do thin out the forest near the lumberyard.
 */
import { BALANCE } from '../config/balance.js';
import { rand } from '../core/rng.js';

const R = BALANCE.resources;

export class ResourceSystem {
  constructor(sim) {
    this.sim = sim;
    sim.bus.on('time:day', () => this.dailyTick());
    sim.bus.on('time:season', (s) => this.onSeason(s));
  }

  get objects() {
    return this.sim.state.objects;
  }

  get(id) {
    return this.objects[id];
  }

  isHarvestable(obj) {
    if (!obj) return false;
    switch (obj.kind) {
      case 'tree':
        return obj.state === 'grown' || obj.state === 'young';
      case 'rock':
        return obj.state === 'full';
      case 'bush':
        return obj.state === 'full';
      case 'crop':
        return obj.stage >= 3;
      default:
        return false;
    }
  }

  changed(obj) {
    this.sim.world.updateObjectBlocking(obj);
    this.sim.bus.emit('object:changed', obj);
  }

  fellTree(id) {
    const obj = this.get(id);
    if (!this.isHarvestable(obj) || obj.kind !== 'tree') return 0;
    const young = obj.state === 'young';
    // Trees felled on your own land are cleared for good (so you can build there).
    // Elsewhere a stump remains — and the forest may (or may not) grow back (see NatureSystem).
    obj.state = this.sim.land?.ownsTile(obj.tx, obj.ty) ? 'cleared' : 'stump';
    obj.felledDay = this.sim.time.day;
    delete obj.sproutDay;
    delete obj.triedSprout;
    delete obj.reservedBy;
    this.changed(obj);
    this.sim.bus.emit('nature:felled', obj);
    return young ? rand.int(1, 2) : rand.int(R.treeWood[0], R.treeWood[1]);
  }

  /** Returns { item, qty }. */
  mineRock(id) {
    const obj = this.get(id);
    if (!this.isHarvestable(obj) || obj.kind !== 'rock') return { item: null, qty: 0 };
    obj.state = this.sim.land?.ownsTile(obj.tx, obj.ty) ? 'cleared' : 'rubble';
    obj.regrowDay = this.sim.time.day + rand.int(R.rockRegrowDays[0], R.rockRegrowDays[1]);
    delete obj.reservedBy;
    let out;
    if (obj.variant === 'iron') out = { item: 'iron_ore', qty: rand.int(R.oreAmount[0], R.oreAmount[1]) };
    else if (obj.variant === 'coal') out = { item: 'coal', qty: rand.int(R.oreAmount[0], R.oreAmount[1]) };
    else if (obj.variant === 'clay') out = { item: 'clay', qty: rand.int(3, 5) }; // a clay pit by the river (IndustrySystem)
    else out = { item: 'stone', qty: rand.int(R.rockStone[0], R.rockStone[1]) };
    // Deposits are finite: take what's left, and a worked-out outcrop stays worked out.
    if (this.sim.nature && obj.state === 'rubble') {
      this.sim.nature.normalize(obj);
      out.qty = Math.max(1, Math.min(out.qty, obj.reserve));
      this.sim.nature.extracted(obj, out.qty);
    }
    this.changed(obj);
    return out;
  }

  forageBush(id) {
    const obj = this.get(id);
    if (!this.isHarvestable(obj) || obj.kind !== 'bush') return 0;
    const qty = obj.amount || 3;
    obj.state = 'empty';
    obj.amount = 0;
    obj.regrowDay = this.sim.time.day + R.bushRegrowDays;
    this.changed(obj);
    return qty;
  }

  harvestCrop(id) {
    const obj = this.get(id);
    if (!this.isHarvestable(obj) || obj.kind !== 'crop') return 0;
    obj.stage = 0;
    this.changed(obj);
    return R.cropYield;
  }

  /** Nearest harvestable object of a kind within a tile radius. */
  findNearest(kind, tx, ty, radius, filter = null) {
    let best = null;
    let bestD = Infinity;
    for (const id in this.objects) {
      const o = this.objects[id];
      if (o.kind !== kind || !this.isHarvestable(o)) continue;
      const d = Math.abs(o.tx - tx) + Math.abs(o.ty - ty);
      if (d > radius || d >= bestD) continue;
      if (filter && !filter(o)) continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  countRipeCrops() {
    let n = 0;
    for (const id in this.objects) {
      const o = this.objects[id];
      if (o.kind === 'crop' && o.stage >= 3) n++;
    }
    return n;
  }

  dailyTick() {
    const day = this.sim.time.day;
    const season = this.sim.time.season;
    const growth = this.sim.weather.mods().cropGrowth;
    const drought = this.sim.events.modifier('farm_output') < 1;
    const p = this.sim.state.player;
    const ptile = this.sim.world.toTile(p.x, p.y);

    for (const id in this.objects) {
      const o = this.objects[id];
      let changed = false;
      // (Trees regrow through NatureSystem: stump → sapling → young → grown.)
      if (o.kind === 'rock' && o.state === 'rubble' && day >= o.regrowDay && (o.reserve === undefined || o.reserve > 0)) {
        if (ptile.tx !== o.tx || ptile.ty !== o.ty) {
          o.state = 'full';
          changed = true;
        }
      } else if (o.kind === 'bush' && o.state === 'empty' && day >= o.regrowDay && season !== 'winter') {
        o.state = 'full';
        o.amount = Math.round(rand.int(R.bushBerries[0], R.bushBerries[1]) * this.sim.events.modifier('berries'));
        changed = true;
      } else if (o.kind === 'crop' && season !== 'winter' && o.stage < 3) {
        const chance = growth <= 0 ? 0 : drought ? 0.5 : Math.min(1, 0.85 * growth);
        // Watered yesterday (a farmer's watering, done for them): it grows for certain.
        const watered = o.wateredDay !== undefined && o.wateredDay >= day - 1 && growth > 0;
        if (rand.chance(chance) || watered) {
          o.stage++;
          changed = true;
        }
      }
      if (changed) this.changed(o);
    }
  }

  onSeason(season) {
    for (const id in this.objects) {
      const o = this.objects[id];
      if (season === 'winter' && o.kind === 'crop' && o.stage !== 0) {
        o.stage = 0;
        this.changed(o);
      } else if (season === 'winter' && o.kind === 'bush' && o.state === 'full') {
        o.state = 'empty';
        o.amount = 0;
        o.regrowDay = 0;
        this.changed(o);
      }
    }
  }
}
