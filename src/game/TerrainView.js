/**
 * TerrainView — renders the ground and small grass tufts.
 *
 * The tile map (Phaser tilemap layer) is still built from the world's tiles: it's what the player collides
 * with, and the fallback look. On top of it the ground is painted in the soft, hand-painted style
 * (GroundPainter), in pieces of CHUNK×CHUNK tiles — the ones in view first, the rest a few a frame. When
 * tiles change (a road laid, a square paved, a bridge built) the pieces they're in are repainted; when the
 * season changes, all of them (green spring grass → golden autumn → winter snow).
 *
 * settings.classicGround = true shows the old square tiles instead (Menu → Settings → World look; dev.ground.classic(true)).
 */
import { BALANCE } from '../config/balance.js';
import { BLOCKING_TILES, T } from '../world/WorldGenerator.js';
import { paintTileset } from '../render/TextureFactory.js';
import { paintChunk } from '../render/GroundPainter.js';
import { hash2 } from '../core/rng.js';
import { DEPTH } from './depth.js';
import { getSetting, onSettingChange } from '../ui/settings.js';

const TS = BALANCE.tileSize;
const CHUNK = 16; // tiles per painted piece (512 px)
const PAINT_PER_FRAME = 2;

export class TerrainView {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
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

    // The painted ground, in pieces.
    this.cols = Math.ceil(world.W / CHUNK);
    this.rows = Math.ceil(world.H / CHUNK);
    this.chunks = [];
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const tw = Math.min(CHUNK, world.W - cx * CHUNK);
        const th = Math.min(CHUNK, world.H - cy * CHUNK);
        this.chunks.push({ cx, cy, tw, th, key: `ground_${cx}_${cy}`, img: null, canvas: null, painted: null });
      }
    }
    this.seen = world.tiles.slice(); // what's painted, to spot changed tiles
    this.seenRev = world.rev || 0;

    // Grass tufts for the classic look (the painted ground has its undergrowth painted in — GroundPainter).
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
    this.classic = !!getSetting('classicGround');
    this.applySeason(sim.time.season);
    this.paintVisible(true);
    const off = onSettingChange((k, v) => k === 'classicGround' && this.setClassic(v));
    scene.events.once('shutdown', off);
  }

  /**
   * The ground's season: as the calendar's — except that winter's snow only lies once it has snowed (or from
   * the third day of winter); until then it's late autumn underfoot.
   */
  groundSeason(season) {
    const sim = this.sim;
    if (season === 'winter' && sim.weather?.type !== 'snow' && sim.time.dayOfSeason < 3) return 'autumn';
    return season;
  }

  applySeason(calendar) {
    const season = this.groundSeason(calendar);
    if (season === this.season) return;
    const wasWinter = this.season === 'winter';
    this.season = season;
    if (wasWinter !== (season === 'winter')) this.scene.buildings?.applyAllSnow?.(); // snow on the roofs too
    const tex = this.scene.textures.get('tiles');
    paintTileset(tex.getSourceImage(), season);
    tex.refresh();
    this.styleTufts();
    for (const c of this.chunks) c.painted = null; // repainted for the new season (in view first)
  }

  styleTufts() {
    for (const tuft of this.tufts) tuft.setTexture(`tuft_${this.season}`).setVisible(this.classic);
  }

  /** Show the old square tiles (true) or the painted ground (false). */
  setClassic(on) {
    this.classic = !!on;
    this.layer.setVisible(true);
    for (const c of this.chunks) c.img?.setVisible(!this.classic);
    this.styleTufts();
    if (!this.classic) this.paintVisible(true);
  }

  paint(c) {
    const world = this.sim.world;
    if (!c.canvas) {
      c.canvas = document.createElement('canvas');
      c.canvas.width = c.tw * TS;
      c.canvas.height = c.th * TS;
    }
    paintChunk(c.canvas.getContext('2d'), world, c.cx * CHUNK, c.cy * CHUNK, c.tw, c.th, this.season, this.sim.state.seed || 0);
    const textures = this.scene.textures;
    if (!c.img) {
      if (textures.exists(c.key)) textures.remove(c.key);
      textures.addCanvas(c.key, c.canvas);
      c.img = this.scene.add.image(c.cx * CHUNK * TS, c.cy * CHUNK * TS, c.key).setOrigin(0, 0).setDepth(DEPTH.TERRAIN + 1);
      c.img.setDisplaySize(c.tw * TS + 1, c.th * TS + 1); // a pixel's overlap: no hairline gaps between pieces when zoomed
      c.img.setVisible(!this.classic);
    } else textures.get(c.key).refresh();
    c.painted = this.season;
  }

  /** Mark the pieces holding tiles that changed since they were painted. */
  checkChanges() {
    const world = this.sim.world;
    if ((world.rev || 0) === this.seenRev) return;
    this.seenRev = world.rev || 0;
    const tiles = world.tiles;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === this.seen[i]) continue;
      this.seen[i] = tiles[i];
      const x = i % world.W;
      const y = Math.floor(i / world.W);
      if (this.layer.getTileAt(x, y)?.index !== tiles[i]) this.layer.putTileAt(tiles[i], x, y);
      // (its neighbours' soft edges reach into the next piece too)
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const cx = Math.floor((x + dx) / CHUNK);
        const cy = Math.floor((y + dy) / CHUNK);
        if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) this.chunks[cy * this.cols + cx].painted = null;
      }
    }
  }

  /** Paint what's out of date: the pieces in view at once, the rest a few a frame (none if `now` — just the view). */
  paintVisible(now = false) {
    if (this.classic) return;
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    const inView = (c) => {
      const x = c.cx * CHUNK * TS;
      const y = c.cy * CHUNK * TS;
      return x < v.right + TS * 4 && x + c.tw * TS > v.x - TS * 4 && y < v.bottom + TS * 4 && y + c.th * TS > v.y - TS * 4;
    };
    let budget = now ? 0 : PAINT_PER_FRAME;
    for (const c of this.chunks) {
      if (c.painted === this.season || !inView(c)) continue;
      this.paint(c);
    }
    for (const c of this.chunks) {
      if (budget <= 0) break;
      if (c.painted === this.season) continue;
      this.paint(c);
      budget--;
    }
  }

  update() {
    // the first snow of winter settles
    if (this.season !== 'winter' && this.sim.time.season === 'winter' && this.groundSeason('winter') === 'winter') this.applySeason('winter');
    this.checkChanges();
    this.paintVisible();
  }
}
