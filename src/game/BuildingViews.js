/**
 * BuildingViews — building sprites, decorations, chimney smoke and night lights.
 * Windows light up at night only when someone is actually inside
 * (or the business is open) — so the village's rhythm is visible.
 *
 * Buildings finished by the player during play are added (and re-drawn when
 * upgraded) through the 'building:added' / 'building:changed' events.
 */
import Phaser from 'phaser';
import { BALANCE } from '../config/balance.js';
import { BUILDING_TYPES } from '../data/buildings.js';
import { BUSINESS_TYPES } from '../data/businessTypes.js';
import { ensureBuildingTexture, BUILDING_META } from '../render/TextureFactory.js';
import { DEPTH } from './depth.js';

const TS = BALANCE.tileSize;

export class BuildingViews {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.byId = new Map(); // building id → { sprites, zone, windows, smoke }
    this.lamps = [];

    for (const b of sim.world.buildingList) this.createBuilding(b);
    for (const d of sim.world.decor) this.createDecor(d);
    this.unsubs = [
      sim.bus.on('building:added', (id) => this.createBuilding(sim.world.buildings[id])),
      sim.bus.on('building:changed', (id) => this.refresh(id)),
      // Buildings age visibly: worn walls darken, abandoned ones get boarded up, ruins lose their roofs.
      sim.bus.on('time:day', () => {
        for (const entry of this.byId.values()) this.applyDecay(entry);
      }),
      // Snow settles on the roofs in winter and melts in spring.
      sim.bus.on('time:season', () => {
        for (const entry of this.byId.values()) this.applySnow(entry);
      }),
    ];
  }

  createBuilding(b) {
    if (!b || this.byId.has(b.id)) return;
    const scene = this.scene;
    // Small "buildings" like a well reuse a decoration texture.
    const decorTex = BUILDING_TYPES[b.type]?.decorTexture;
    if (decorTex) {
      const x = b.tx * TS + TS / 2;
      const bottom = (b.ty + 1) * TS;
      const img = scene.add.image(x, bottom - 2, decorTex).setOrigin(0.5, 1).setDepth(bottom);
      const shade = this.castShadow(x - TS / 2, bottom - 2, TS, 40);
      const zone = scene.add.zone(x, b.ty * TS + TS / 2 + 4, TS - 4, TS - 8);
      scene.physics.add.existing(zone, true);
      scene.solids.add(zone);
      this.byId.set(b.id, { building: b, sprites: [img, shade], zone, windows: [], smoke: [] });
      return;
    }
    const key = ensureBuildingTexture(scene, b);
    const meta = BUILDING_META[key];
    const x = b.tx * TS;
    const bottom = (b.ty + b.h) * TS;
    const img = scene.add.image(x, bottom, key).setOrigin(0, 1).setDepth(bottom);
    const entry = { building: b, sprites: [img, this.castShadow(x, bottom, b.w * TS, meta.height)], zone: null, windows: [], smoke: [] };

    // Collision: the footprint minus a strip at the back, so you can walk "behind" the roof edge.
    const zone = scene.add.zone(x + (b.w * TS) / 2, b.ty * TS + 10 + (b.h * TS - 10) / 2, b.w * TS, b.h * TS - 10);
    scene.physics.add.existing(zone, true);
    scene.solids.add(zone);
    entry.zone = zone;

    const top = bottom - meta.height;
    for (const w of meta.windows) {
      const lit = scene.add.image(x + w.x, top + w.y, 'window_lit').setOrigin(0).setDepth(DEPTH.LIGHTS).setAlpha(0);
      const glow = scene.add
        .image(x + w.x + w.w / 2, top + w.y + w.h / 2 + 8, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffb050)
        .setScale(0.7)
        .setDepth(DEPTH.LIGHTS)
        .setAlpha(0);
      entry.windows.push({ img: lit, glow });
    }
    if (meta.chimney) {
      const emitter = scene.add.particles(x + meta.chimney.x, top + meta.chimney.y, 'smoke', {
        speedY: { min: -24, max: -12 },
        speedX: { min: -3, max: 9 },
        lifespan: 2600,
        scale: { start: 0.45, end: 1.5 },
        alpha: { start: 0.4, end: 0 },
        frequency: 650,
      });
      emitter.setDepth(bottom + 1);
      entry.smoke.push(emitter);
    }
    entry.meta = meta;
    entry.key = key;
    this.byId.set(b.id, entry);
    this.applyDecay(entry);
    this.applySnow(entry);
    this.addSign(entry);
  }

  /**
   * The soft shadow a building casts on the ground: the sun is up to the left (as for the trees), so it falls
   * to the right and a little forward — longer for taller buildings. Drawn just above the ground.
   */
  castShadow(x, bottom, w, height) {
    const dx = Math.round(Math.min(44, 10 + height * 0.22));
    const dy = 7;
    const depthPx = Math.round(Math.min(w * 0.5, 40)); // how deep the footprint reads from the front
    const key = `bshadow_${w}_${dx}_${depthPx}`;
    const pad = 14;
    if (!this.scene.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = w + dx + pad * 2;
      c.height = depthPx + dy + pad * 2;
      const ctx = c.getContext('2d');
      ctx.filter = 'blur(5px)';
      ctx.fillStyle = 'rgba(25,20,10,0.32)';
      ctx.beginPath();
      // the footprint, and the same shape pushed right and forward — the band between them is the shadow
      ctx.moveTo(pad + 4, pad);
      ctx.lineTo(pad + w, pad);
      ctx.lineTo(pad + w + dx, pad + dy);
      ctx.lineTo(pad + w + dx, pad + depthPx + dy);
      ctx.lineTo(pad + dx * 0.4, pad + depthPx + dy);
      ctx.lineTo(pad + 4, pad + depthPx);
      ctx.closePath();
      ctx.fill();
      this.scene.textures.addCanvas(key, c);
    }
    return this.scene.add.image(x - pad, bottom - depthPx - pad, key).setOrigin(0, 0).setDepth(DEPTH.TUFTS + 1);
  }

  /** A shop sign over the door when a villager runs a business from this building. */
  addSign(entry) {
    const b = entry.building;
    // A house of yours with a "to let" sign up (LettingSystem).
    if (this.sim.letting?.listed(b.id)) return this.addLetSign(entry);
    const E = this.sim.economy;
    const bizId = E?.businessAtBuilding(b.id);
    const biz = bizId && E.biz(bizId);
    if (!biz || biz.nameIdx === undefined) return; // founding shops already look the part
    const icon = BUSINESS_TYPES[biz.type]?.icon;
    if (!icon) return;
    const doorX = b.door.tx * TS + TS / 2;
    const bottom = (b.ty + b.h) * TS;
    const x = doorX + 22;
    const y = bottom - 40;
    const g = this.scene.add.graphics().setDepth(bottom + 0.6);
    g.fillStyle(0x3b2a1a, 1).fillRect(x - 1, y - 14, 2, 10); // bracket
    g.fillStyle(0x8a5a2e, 1).fillRoundedRect(x - 12, y - 5, 24, 20, 3);
    g.lineStyle(2, 0x4a3018, 1).strokeRoundedRect(x - 12, y - 5, 24, 20, 3);
    const t = this.scene.add
      .text(x, y + 5, icon, { fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif', fontSize: '13px' })
      .setOrigin(0.5)
      .setDepth(bottom + 0.7);
    entry.sign = [g, t];
  }

  /** A small green "to let" board on a post by the door. */
  addLetSign(entry) {
    const b = entry.building;
    const doorX = b.door.tx * TS + TS / 2;
    const bottom = (b.ty + b.h) * TS;
    const x = doorX + 26;
    const y = bottom - 10;
    const g = this.scene.add.graphics().setDepth(bottom + 0.6);
    g.fillStyle(0x5a3a1e, 1).fillRect(x - 1, y - 6, 3, 18); // post
    g.fillStyle(0x3f7a3a, 1).fillRoundedRect(x - 13, y - 22, 26, 18, 3);
    g.lineStyle(2, 0x244a22, 1).strokeRoundedRect(x - 13, y - 22, 26, 18, 3);
    const t = this.scene.add
      .text(x, y - 13, '🔑', { fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif', fontSize: '12px' })
      .setOrigin(0.5)
      .setDepth(bottom + 0.7);
    entry.sign = [g, t];
  }

  /**
   * Snow on the roof in winter: an overlay made from the building's own picture — white along the top edge
   * of every roof (and chimney cap), thinning downwards, with a ragged lower edge.
   */
  applySnow(entry) {
    const winter = this.sim.time.season === 'winter';
    if (!winter || !entry.key) {
      entry.snow?.destroy();
      entry.snow = null;
      return;
    }
    if (entry.snow) return;
    const key = `${entry.key}_snow`;
    const textures = this.scene.textures;
    if (!textures.exists(key)) {
      const src = textures.get(entry.key).getSourceImage();
      const W = src.width;
      const H = src.height;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      const data = src.getContext('2d').getImageData(0, 0, W, H).data;
      const depth = Math.max(8, Math.min(26, Math.round(H * 0.2)));
      ctx.fillStyle = '#ffffff';
      for (let x = 0; x < W; x++) {
        let y0 = -1;
        for (let y = 0; y < H - 10; y++) {
          if (data[(y * W + x) * 4 + 3] > 200) {
            y0 = y;
            break;
          }
        }
        if (y0 < 0) continue;
        const d = depth * (0.8 + 0.12 * Math.sin(x * 0.19) + 0.08 * Math.sin(x * 0.053 + 1.3)); // a gently wavy lower edge
        const g = ctx.createLinearGradient(0, y0, 0, y0 + d);
        g.addColorStop(0, 'rgba(252,253,255,1)');
        g.addColorStop(0.7, 'rgba(240,246,252,0.95)');
        g.addColorStop(0.85, 'rgba(214,226,238,0.9)');
        g.addColorStop(1, 'rgba(200,214,228,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y0, 1, d);
      }
      // only where the building is
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(src, 0, 0);
      textures.addCanvas(key, c);
    }
    const img = entry.sprites[0];
    entry.snow = this.scene.add.image(img.x, img.y, key).setOrigin(0, 1).setDepth(img.depth + 0.05);
  }

  /** Show the building's condition: darker when worn, boards when abandoned, holes when ruined. */
  applyDecay(entry) {
    const r = this.sim.property?.rec(entry.building.id);
    const img = entry.sprites[0];
    if (!r || !img || !entry.meta) return;
    const c = Math.max(0, Math.min(100, r.condition));
    const state = r.ruined ? 'ruin' : r.abandoned ? 'abandoned' : c < 60 ? 'worn' : 'ok';
    const dmg = r.damage && !r.ruined ? r.damage.kind : '';
    const key = `${state}:${Math.round(c / 10)}:${dmg}`;
    if (entry.decayKey === key) return;
    entry.decayKey = key;
    // Walls fade and darken with neglect.
    const k = c >= 70 ? 1 : 0.62 + (c / 70) * 0.38;
    const ch = (v) => Math.round(v * k);
    img.setTint(Phaser.Display.Color.GetColor(ch(255), ch(250), ch(240)));
    entry.decay?.destroy();
    entry.decay = null;
    const b = entry.building;
    const meta = entry.meta;
    const x = b.tx * TS;
    const bottom = (b.ty + b.h) * TS;
    const top = bottom - meta.height;
    if (state === 'ok' || state === 'worn') {
      if (!dmg) return;
      // Recent damage shows until it's repaired.
      const g = this.scene.add.graphics().setDepth(bottom + 0.5);
      if (dmg === 'flood') {
        g.fillStyle(0x5a4630, 0.55);
        g.fillRect(x + 2, bottom - 22, b.w * TS - 4, 20);
      } else if (dmg === 'fire') {
        g.fillStyle(0x1a1410, 0.6);
        for (let i = 0; i < 4; i++) g.fillEllipse(x + 12 + ((i * 41) % (b.w * TS - 20)), top + 20 + ((i * 17) % 30), 26, 16);
      } else if (dmg === 'storm') {
        g.fillStyle(0x2a2018, 0.8);
        for (let i = 0; i < 2; i++) g.fillRect(x + 14 + i * 40, top + 10 + i * 6, 16, 8);
      }
      entry.decay = g;
      return;
    }
    const g = this.scene.add.graphics().setDepth(bottom + 0.5);
    // Boarded-up windows.
    g.fillStyle(0x6b4a2b, 1);
    for (const w of meta.windows) {
      g.fillRect(x + w.x - 2, top + w.y + w.h * 0.25, w.w + 4, 4);
      g.fillRect(x + w.x - 2, top + w.y + w.h * 0.65, w.w + 4, 4);
    }
    // A plank nailed across the door.
    const doorX = (b.door.tx - b.tx) * TS + TS / 2 + x;
    g.fillStyle(0x5a3d22, 1);
    g.fillRect(doorX - 14, bottom - 26, 28, 5);
    g.fillRect(doorX - 14, bottom - 14, 28, 5);
    // Weeds creeping up the walls.
    g.fillStyle(0x4f7a32, 1);
    for (let i = 0; i < b.w * 2; i++) {
      const wx = x + 4 + ((i * 37) % (b.w * TS - 8));
      const h = 6 + ((i * 13) % 8);
      g.fillTriangle(wx - 3, bottom, wx + 3, bottom, wx, bottom - h);
    }
    if (state === 'ruin') {
      // Holes in the roof and rubble at the foot of the walls.
      g.fillStyle(0x1e1812, 0.85);
      for (let i = 0; i < 3; i++) {
        const hx = x + 10 + ((i * 53) % Math.max(20, b.w * TS - 30));
        const hy = top + 8 + ((i * 17) % 20);
        g.fillEllipse(hx + 8, hy + 6, 18 + i * 4, 10 + i * 2);
      }
      g.fillStyle(0x8a8378, 1);
      for (let i = 0; i < 6; i++) g.fillCircle(x + 6 + ((i * 29) % (b.w * TS - 10)), bottom - 2, 3 + (i % 3));
    }
    entry.decay = g;
  }

  /** Re-draw a building (e.g. after an upgrade changed its look). */
  refresh(id) {
    if (this.highlighted === id) this.highlighted = null; // re-added next frame, on the new sprite
    const entry = this.byId.get(id);
    if (entry) {
      for (const s of entry.sprites) s.destroy();
      for (const w of entry.windows) {
        w.img.destroy();
        w.glow.destroy();
      }
      for (const e of entry.smoke) e.destroy();
      entry.decay?.destroy();
      entry.snow?.destroy();
      for (const s of entry.sign || []) s.destroy();
      if (entry.zone) this.scene.solids.remove(entry.zone, true, true);
      this.byId.delete(id);
    }
    this.createBuilding(this.sim.world.buildings[id]);
  }

  createDecor(d) {
    const scene = this.scene;
    const tex = d.type === 'stall' ? `decor_stall_${d.variant || 0}` : `decor_${d.type}`;
    const x = d.tx * TS + (d.w * TS) / 2;
    const bottom = d.ty * TS + TS;
    const img = scene.add.image(x, bottom - 2, tex).setOrigin(0.5, 1).setDepth(bottom - 2);
    d.sprite = img;
    if (d.block) {
      const zone = scene.add.zone(x, d.ty * TS + TS / 2 + 4, d.w * TS - 4, TS - 8);
      scene.physics.add.existing(zone, true);
      scene.solids.add(zone);
    }
    if (d.light) {
      const glow = scene.add
        .image(x, bottom - 44, 'glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xffc870)
        .setScale(1.3)
        .setDepth(DEPTH.LIGHTS)
        .setAlpha(0);
      this.lamps.push(glow);
    }
  }

  /** The building you're facing gets a soft outline (and loses it when you turn away). */
  highlight(id) {
    if (this.highlighted === id) return;
    const old = this.byId.get(this.highlighted);
    if (old?.glow) {
      old.sprites[0]?.preFX?.remove(old.glow);
      old.glow = null;
    }
    this.highlighted = id;
    const entry = id && this.byId.get(id);
    const img = entry?.sprites[0];
    if (img?.preFX) entry.glow = img.preFX.addGlow(0xffe08a, 2.5, 0, false, 0.1, 6);
  }

  /** Is anyone home / is the business open? Decides whether windows glow. */
  isOccupied(b) {
    if (this.sim.state.npcs.some((n) => n.inside === b.id)) return true;
    const p = this.sim.state.player;
    if (b.id === p.homeId && (p.sleeping || p.indoors)) return true;
    const own = this.sim.businesses.atBuilding(b.id);
    if (own) return this.sim.businesses.isOpen(own);
    const biz = this.sim.economy.businessAtBuilding(b.id);
    return !!biz && this.sim.economy.isOpen(biz) && this.sim.economy.def(biz)?.kind === 'shop';
  }

  update(darkness) {
    const flicker = 0.93 + Math.sin(this.scene.time.now / 180) * 0.04;
    for (const entry of this.byId.values()) {
      const occupied = this.isOccupied(entry.building);
      const lit = darkness > 0.05 && occupied ? darkness : 0;
      for (const w of entry.windows) {
        w.img.setAlpha(lit * 0.95);
        w.glow.setAlpha(lit * 0.5 * flicker);
      }
      // Chimneys smoke when someone is home or the business is running.
      for (const e of entry.smoke) {
        if (occupied && !e.emitting) e.start();
        else if (!occupied && e.emitting) e.stop();
      }
    }
    // In a town the street lamps burn gas: brighter, whiter, further (TownSystem).
    const gas = !!this.sim.town?.gasLamps();
    if (gas !== this.gas) {
      this.gas = gas;
      for (const g of this.lamps) g.setTint(gas ? 0xfff2cc : 0xffc870).setScale(gas ? 1.75 : 1.3);
    }
    for (const g of this.lamps) g.setAlpha(darkness * (gas ? 0.9 : 0.75) * flicker);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }
}
