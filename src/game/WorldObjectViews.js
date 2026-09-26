/**
 * WorldObjectViews — sprites for trees, rocks, bushes and crops.
 * Listens to 'object:changed' so the world visibly reacts when anything
 * (the player or a villager) chops, mines or harvests.
 */
import { BALANCE } from '../config/balance.js';
import { SEASONS } from '../systems/SeasonSystem.js';

const TS = BALANCE.tileSize;

/** Where the "feet" of each texture are, as a fraction of its height. */
const ORIGIN_Y = {
  tree_oak: 74 / 80,
  tree_pine: 79 / 84,
  stump: 23 / 28,
  rock: 27 / 32,
  rubble: 15 / 20,
  bush: 24 / 28,
  crop: 34 / 40,
};

export class WorldObjectViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.sprites = new Map();
    this.bodies = new Map();
    this.byTile = new Map(); // "tx,ty" → object id (for fast interaction lookup)
    for (const obj of Object.values(sim.state.objects)) this.create(obj);
    this.unsubs = [
      sim.bus.on('object:changed', (obj) => this.refresh(obj)),
      sim.bus.on('time:season', () => this.refreshAll()),
      // Saplings seeded by the forest and newly discovered ore seams appear in the world.
      sim.bus.on('object:added', (obj) => this.create(obj)),
    ];
  }

  textureFor(obj) {
    const s = this.sim.time.season;
    switch (obj.kind) {
      case 'tree':
        // Saplings and young trees are the grown tree, smaller (see scaleFor).
        if (obj.state === 'grown' || obj.state === 'young' || obj.state === 'sapling') return [`tree_${obj.variant}_${s}`, ORIGIN_Y[`tree_${obj.variant}`]];
        return [`stump_${s}`, ORIGIN_Y.stump];
      case 'rock':
        return obj.state === 'full' ? [`rock_${obj.variant}_${s}`, ORIGIN_Y.rock] : [`rubble_${s}`, ORIGIN_Y.rubble];
      case 'bush':
        return [`bush_${obj.state === 'full' ? 'full' : 'empty'}_${s}`, ORIGIN_Y.bush];
      case 'crop':
        return [`crop_${obj.stage}_${s}`, ORIGIN_Y.crop];
      default:
        return ['dot', 0.5];
    }
  }

  isSolid(obj) {
    return (obj.kind === 'tree' && (obj.state === 'grown' || obj.state === 'young')) || (obj.kind === 'rock' && obj.state === 'full');
  }

  /** Growing trees are drawn smaller; felled-out places (cleared ground) are invisible. */
  scaleFor(obj) {
    if (obj.kind === 'tree' && obj.state === 'sapling') return 0.32;
    if (obj.kind === 'tree' && obj.state === 'young') return 0.62;
    return 1;
  }

  styleSprite(spr, obj) {
    spr.setScale(this.scaleFor(obj));
    spr.setVisible(!(obj.kind === 'tree' && obj.state === 'cleared') && !(obj.kind === 'rock' && obj.state === 'cleared'));
    // A worked-out seam: grey, lifeless rubble.
    if (obj.kind === 'rock' && obj.state === 'depleted') spr.setTint(0x8a8680);
    else if (obj.floodedUntil > this.sim.time.day) spr.setTint(SEASONS.floodTint); // under the river in flood
    else spr.clearTint();
  }

  create(obj) {
    const x = obj.tx * TS + TS / 2;
    const y = obj.ty * TS + TS - 3;
    const [tex, oy] = this.textureFor(obj);
    const spr = this.scene.add.image(x, y, tex).setOrigin(0.5, oy).setDepth(y);
    this.styleSprite(spr, obj);
    this.sprites.set(obj.id, spr);
    this.byTile.set(`${obj.tx},${obj.ty}`, obj.id);
    this.updateBody(obj);
  }

  updateBody(obj) {
    const solid = this.isSolid(obj);
    const existing = this.bodies.get(obj.id);
    if (solid && !existing) {
      const x = obj.tx * TS + TS / 2;
      const y = obj.ty * TS + TS - 8;
      const [w, h] = obj.kind === 'tree' ? (obj.state === 'young' ? [10, 8] : [14, 10]) : [24, 14];
      const zone = this.scene.add.zone(x, y, w, h);
      this.scene.physics.add.existing(zone, true);
      this.scene.solids.add(zone);
      this.bodies.set(obj.id, zone);
    } else if (!solid && existing) {
      this.scene.solids.remove(existing, true, true);
      this.bodies.delete(obj.id);
    }
  }

  refresh(obj) {
    const spr = this.sprites.get(obj.id);
    if (!spr) return;
    const [tex, oy] = this.textureFor(obj);
    spr.setTexture(tex).setOrigin(0.5, oy);
    this.styleSprite(spr, obj);
    this.updateBody(obj);
    // A little "pop" so changes are noticeable.
    if (spr.visible) {
      const s = this.scaleFor(obj);
      spr.setScale(s * 1.08);
      this.scene.tweens.add({ targets: spr, scale: s, duration: 180, ease: 'Quad.out' });
    }
  }

  refreshAll() {
    for (const obj of Object.values(this.sim.state.objects)) {
      const spr = this.sprites.get(obj.id);
      if (!spr) continue;
      const [tex, oy] = this.textureFor(obj);
      spr.setTexture(tex).setOrigin(0.5, oy);
      this.styleSprite(spr, obj);
    }
  }

  objectAt(tx, ty) {
    const id = this.byTile.get(`${tx},${ty}`);
    return id ? this.sim.state.objects[id] : null;
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}
