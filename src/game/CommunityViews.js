/**
 * CommunityViews — what the square looks like on the days that matter (view only; the simulation is
 * StallSystem and CommunitySystem):
 *   your stall   the goods you've set out, on the counter; "+$4" rising over it when something sells;
 *   market day   two traders' stalls on the square, with the traders behind them, from opening to closing.
 */
import { ICON_CANVAS } from '../render/TextureFactory.js';
import { ensureCharacter, idleFrame, CHAR_ORIGIN_Y } from './characters.js';
import { randomLook } from '../core/GameState.js';
import { Rng } from '../core/rng.js';
import { BALANCE } from '../config/balance.js';

const TS = BALANCE.tileSize;
// Your stall (the west one on the square): where its counter is.
const COUNTER = { x: 41 * TS + TS, y: 44 * TS - 30 };
const TRADERS = [
  { tx: 45, ty: 42, variant: 1, seed: 11 },
  { tx: 48, ty: 42, variant: 0, seed: 23 },
];

export class CommunityViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.goods = [];
    this.goodsKey = '';
    this.traders = null;
    this.timer = 0;
    this.unsubs = [sim.bus.on('stall:sold', (s) => this.sold(s))];
  }

  iconTexture(item) {
    const key = `icon_${item}`;
    if (!this.scene.textures.exists(key) && ICON_CANVAS[item]) this.scene.textures.addCanvas(key, ICON_CANVAS[item]);
    return this.scene.textures.exists(key) ? key : null;
  }

  update(delta) {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = 500;
    this.updateGoods();
    this.updateTraders();
  }

  /** What's on your stall, laid out on the counter (up to four kinds). */
  updateGoods() {
    const St = this.sim.stall;
    const items = St?.rentedToday() ? Object.keys(St.S.goods).slice(0, 4) : [];
    const k = items.join(',');
    if (k === this.goodsKey) return;
    this.goodsKey = k;
    for (const g of this.goods) g.destroy();
    this.goods = [];
    items.forEach((item, i) => {
      const tex = this.iconTexture(item);
      if (!tex) return;
      const img = this.scene.add.image(COUNTER.x - 24 + i * 16, COUNTER.y, tex).setScale(0.7).setOrigin(0.5, 1).setDepth(COUNTER.y + 40);
      this.goods.push(img);
    });
  }

  /** Something sold: "+$4" rises over the stall. */
  sold({ money }) {
    const scene = this.scene;
    const txt = scene.add
      .text(COUNTER.x, COUNTER.y - 10, `+$${money}`, { fontFamily: 'Nunito, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ffe08a', stroke: '#3a2412', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(COUNTER.y + 60);
    scene.tweens.add({ targets: txt, y: txt.y - 26, alpha: 0, duration: 1600, ease: 'Sine.easeOut', onComplete: () => txt.destroy() });
  }

  /** Market day: the traders' stalls go up on the square (and come down again at closing). */
  updateTraders() {
    const open = !!this.sim.community?.marketOpen();
    if (open && !this.traders) {
      const scene = this.scene;
      this.traders = [];
      for (const t of TRADERS) {
        const x = t.tx * TS + TS;
        const bottom = t.ty * TS + TS;
        const r = new Rng(t.seed);
        const gender = t.seed % 2 ? 'm' : 'f';
        const tex = ensureCharacter(scene, `trader_${t.seed}`, { ...randomLook(r, gender, 40), dress: false });
        const who = scene.add.sprite(x, bottom - 22, tex, idleFrame('down')).setOrigin(0.5, CHAR_ORIGIN_Y).setDepth(bottom - 24);
        const stall = scene.add.image(x, bottom - 2, `decor_stall_${t.variant}`).setOrigin(0.5, 1).setDepth(bottom - 2).setTint(0xf0d8b0);
        this.traders.push(who, stall);
      }
    } else if (!open && this.traders) {
      for (const o of this.traders) o.destroy();
      this.traders = null;
    }
  }

  destroy() {
    for (const u of this.unsubs) u();
    for (const g of this.goods) g.destroy();
    for (const o of this.traders || []) o.destroy();
  }
}

