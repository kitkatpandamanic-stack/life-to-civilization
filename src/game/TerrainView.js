/**
 * TerrainView — renders the tile map and small grass tufts.
 * When the season changes, the tileset canvas is repainted in place
 * (green spring grass → golden autumn → winter snow).
 */
import { BALANCE } from '../config/balance.js';
import { BLOCKING_TILES, T } from '../world/WorldGenerator.js';
import { paintTileset } from '../render/TextureFactory.js';
import { hash2 } from '../core/rng.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;

export class TerrainView {
  constructor(scene, sim) {
    this.scene = scene;
    const world = sim.world;
    const data = [];
    for (let y = 0; y < world.H; y++) {
      const row = [];
      for (let x = 0; x < world.W; x++) row.push(world.tiles[world.idx(x, y)]);
      data.push(row);
    }
    this.map = scene.make.tilemap({ data, tileWidth: TS, tileHeight: TS });
    const tileset = this.map.addTilesetImage('tiles', 'tiles', TS, TS, 0, 0);
    this.layer = this.map.createLayer(0, tileset, 0, 0);
    this.layer.setDepth(DEPTH.TERRAIN);
    this.layer.setCollision(BLOCKING_TILES);

    // Grass tufts: pure decoration, placed deterministically from the seed.
    this.tufts = [];
    const grassy = new Set([T.GRASS, T.GRASS2, T.GRASS3, T.FLOWERS, T.FOREST]);
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        if (!grassy.has(world.tileAt(x, y)) || world.isBlocked(x, y)) continue;
        const h = hash2(x, y, sim.state.seed + 77);
        if (h > 0.14) continue;
        const px = x * TS + 4 + hash2(x, y, 5) * 24;
        const py = y * TS + 8 + hash2(x, y, 9) * 22;
        this.tufts.push(scene.add.image(px, py, 'tuft_spring').setOrigin(0.5, 1).setDepth(DEPTH.TUFTS));
      }
    }
    this.season = null;
    this.applySeason(sim.time.season);
  }

  applySeason(season) {
    if (season === this.season) return;
    this.season = season;
    const tex = this.scene.textures.get('tiles');
    paintTileset(tex.getSourceImage(), season);
    tex.refresh();
    for (const tuft of this.tufts) tuft.setTexture(`tuft_${season}`);
  }
}
