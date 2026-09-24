/**
 * InteriorView — the inside of the player's home.
 *
 * The room is built in the same Phaser scene, just outside the east edge of the
 * world map, so everything (player controller, physics, UI, simulation) keeps
 * working unchanged. Entering the house = fade + teleport + camera bounds.
 * The room layout and furniture come from data/homes.js and change with upgrades.
 */
import { BALANCE } from '../config/balance.js';
import { HOME_TIERS } from '../data/homes.js';
import { drawRoom, FURNITURE_SIZE } from '../render/ExtraArt.js';

const TS = BALANCE.tileSize;
const INTERACTIVE = new Set(['bed', 'chest', 'table', 'workbench', 'stove', 'shelf', 'fireplace']);

export class InteriorView {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    // Far enough east of the map that the camera never shows the world behind the room.
    this.origin = { x: sim.world.W * TS + 2400, y: 400 };
    this.solids = scene.physics.add.staticGroup();
    scene.physics.add.collider(scene.player.sprite, this.solids);
    this.sprites = [];
    this.interactables = [];
    this.tier = null;
  }

  /** Rebuild the room for a home tier (only when it changed). */
  build(tierId) {
    if (this.tier === tierId) return;
    this.tier = tierId;
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.solids.clear(true, true);
    this.interactables = [];

    const scene = this.scene;
    const def = HOME_TIERS[tierId];
    const [w, h] = def.room;
    const room = drawRoom(w, h, TS);
    const key = `room_${tierId}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, room.canvas);
    const { x: ox, y: oy } = this.origin;
    this.sprites.push(scene.add.image(ox, oy, key).setOrigin(0).setDepth(oy - 100));

    const W = room.canvas.width;
    const H = room.canvas.height;
    const fx = ox + room.side;
    const fy = oy + room.wallTop;
    const solid = (x, y, sw, sh) => {
      const z = scene.add.zone(x + sw / 2, y + sh / 2, sw, sh);
      scene.physics.add.existing(z, true);
      this.solids.add(z);
    };
    solid(ox, oy, W, room.wallTop + 6); // back wall
    solid(ox, oy, room.side, H); // left
    solid(ox + W - room.side, oy, room.side, H); // right
    solid(ox, oy + H - 12, W, 12); // front wall (the door is an interaction, not a gap)

    def.furniture.forEach((f, i) => {
      const [tw, th] = FURNITURE_SIZE[f.type];
      const x = fx + f.x * TS + tw / 2;
      const y = fy + f.y * TS + TS;
      const img = scene.add.image(x, y, `furn_${f.type}`).setOrigin(0.5, 1).setDepth(f.type === 'rug' ? oy - 50 : y);
      this.sprites.push(img);
      if (f.type !== 'rug') solid(x - tw / 2 + 3, y - 14, tw - 6, 12);
      if (INTERACTIVE.has(f.type)) this.interactables.push({ kind: 'furniture', type: f.type, id: `furn_${i}`, x, y: y + 6, labelY: th + 8 });
    });

    const doorX = ox + room.doorX + TS / 2;
    const doorY = oy + H - 20;
    this.sprites.push(scene.add.image(doorX, doorY + 6, 'furn_door_mat').setDepth(oy - 60));
    this.interactables.push({ kind: 'furniture', type: 'door', id: 'door', x: doorX, y: doorY, labelY: 30 });
    this.spawn = { x: doorX, y: doorY - 18 };
    this.bounds = { x: ox, y: oy, w: W, h: H };
  }
}
