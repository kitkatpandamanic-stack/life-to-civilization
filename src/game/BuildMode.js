/**
 * BuildMode — placing blueprints in the world with the mouse.
 *
 * A ghost of the building follows the cursor, snapped to tiles, tinted green
 * where it can be built and red where it can't (with the reason shown).
 * Click to place the construction site; right-click or Esc to cancel.
 * Road mode lays road tiles one by one (you must be nearby and have stone).
 */
import { BALANCE } from '../config/balance.js';
import { BUILDABLES } from '../data/buildables.js';
import { ensureBuildingTexture } from '../render/TextureFactory.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;

export class BuildMode {
  constructor(scene) {
    this.scene = scene;
    this.sim = scene.sim;
    this.active = null; // building type, 'road', or null
    this.g = scene.add.graphics().setDepth(DEPTH.PROMPT - 2);
    this.ghost = null;
    this.hint = scene.add
      .text(0, 0, '', { fontFamily: 'Nunito, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#fff6e0', backgroundColor: 'rgba(24,16,10,0.85)', padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.PROMPT)
      .setVisible(false);
    this.tile = null;
    scene.input.on('pointerdown', (ptr) => this.onPointer(ptr));
    scene.input.mouse?.disableContextMenu();
  }

  start(type) {
    this.cancel();
    this.active = type;
    if (type !== 'road') {
      const def = BUILDABLES[type];
      const preview = { id: `ghost_${type}`, type, variant: 0, tx: 0, ty: 0, w: def.w, h: def.h, player: true };
      const decor = BUILDING_TYPES[type]?.decorTexture;
      const key = decor || ensureBuildingTexture(this.scene, preview);
      this.ghost = this.scene.add.image(0, 0, key).setOrigin(decor ? 0.5 : 0, 1).setAlpha(0.55).setDepth(DEPTH.PROMPT - 3);
    }
    this.scene.ui.showBuildHint(type);
  }

  cancel() {
    this.active = null;
    this.ghost?.destroy();
    this.ghost = null;
    this.g.clear();
    this.hint.setVisible(false);
    this.scene.ui.hideBuildHint();
  }

  /** Top-left tile of the footprint under the cursor. */
  footprintAt(ptr) {
    const wx = ptr.worldX;
    const wy = ptr.worldY;
    if (this.active === 'road') return { tx: Math.floor(wx / TS), ty: Math.floor(wy / TS), w: 1, h: 1 };
    const def = BUILDABLES[this.active];
    return { tx: Math.floor(wx / TS) - Math.floor(def.w / 2), ty: Math.floor(wy / TS) - (def.h - 1), w: def.w, h: def.h };
  }

  check(f) {
    return this.active === 'road' ? this.sim.construction.canRoad(f.tx, f.ty) : this.sim.construction.canPlace(this.active, f.tx, f.ty);
  }

  update() {
    if (!this.active) return;
    const ptr = this.scene.input.activePointer;
    ptr.updateWorldPoint(this.scene.cameras.main);
    const f = this.footprintAt(ptr);
    this.tile = f;
    const res = this.check(f);
    const color = res.ok ? 0x6fe07a : 0xff6060;
    const g = this.g;
    g.clear();
    g.fillStyle(color, 0.28).fillRect(f.tx * TS, f.ty * TS, f.w * TS, f.h * TS);
    g.lineStyle(2, color, 0.95).strokeRect(f.tx * TS, f.ty * TS, f.w * TS, f.h * TS);
    if (this.active !== 'road') {
      // Door marker
      const dx = (f.tx + Math.floor(f.w / 2)) * TS;
      g.fillStyle(0xffe08a, 0.8).fillRect(dx + 8, (f.ty + f.h) * TS + 2, TS - 16, 6);
      if (this.ghost) {
        const decor = BUILDING_TYPES[this.active]?.decorTexture;
        this.ghost.setPosition(decor ? f.tx * TS + TS / 2 : f.tx * TS, (f.ty + f.h) * TS).setTint(res.ok ? 0xffffff : 0xff8080);
      }
    }
    const reason = res.ok ? this.scene.ui.tr('ui.build_click') : this.scene.ui.tr(`reason.${res.reason}`, res.params || {});
    this.hint.setText(reason).setPosition((f.tx + f.w / 2) * TS, f.ty * TS - (this.active === 'road' ? 4 : f.h * TS * 0.6 + 20)).setVisible(true);
    this.hint.setColor(res.ok ? '#c8ffcc' : '#ffc0b0');
  }

  onPointer(ptr) {
    if (!this.active || this.scene.ui.isPaused()) return;
    if (ptr.rightButtonDown()) {
      this.cancel();
      return;
    }
    const f = this.footprintAt(ptr);
    if (this.active === 'road') {
      if (this.sim.construction.buildRoad(f.tx, f.ty)) this.scene.player.faceTowards(f.tx * TS, f.ty * TS);
      return; // stay in road mode to lay the next tile
    }
    const c = this.sim.construction.place(this.active, f.tx, f.ty);
    if (c) this.cancel();
  }
}
