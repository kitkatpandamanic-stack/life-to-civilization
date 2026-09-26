/**
 * SoundDirector — listens to the game and the world, and makes them heard.
 *
 *   you        footsteps by surface (grass, road, cobbles, snow, floorboards), wheels when you push a barrow,
 *              your tools (axe, pick, hoe, hammer, rod, bow), coins in and out, things into your pockets
 *   villagers  chopping, mining, hammering and the smithy's anvil nearby — louder the closer you stand,
 *              and from the side they're on
 *   the valley rain, wind and thunder; birds by day, crickets and owls at night; the crowd at a festival;
 *              the rooster in the morning, the bell at noon; fires crackling
 *   music      the mood follows the season, the hour, the weather and the festivals (audio/Music.js)
 *
 * Nothing here changes the simulation. It only reads it.
 */
import { play, NoiseBed, audioCtx, onAudioReady, muffle } from '../audio/AudioEngine.js';
import { music } from '../audio/Music.js';
import { BALANCE } from '../config/balance.js';
import { T } from '../world/WorldGenerator.js';

const TS = BALANCE.tileSize;
const HEAR = 13 * TS; // how far a villager's work carries
/** Villagers' work (NPCViews) → the sound it makes. */
const WORK_SOUND = { chop: 'chop', mine: 'mine', build: 'hammer', spot: 'anvil', load: 'load' };
const TOAST_SOUND = { good: 'good', danger: 'danger', warn: 'warn' };
/** Big moments get a little fanfare. */
const CELEBRATE = new Set(['toast.building_done', 'toast.upgrade_done', 'toast.works_done', 'toast.contract_done_xp', 'toast.path_milestone', 'toast.guide_step']);

export class SoundDirector {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.stepDist = 0;
    this.wheelDist = 0;
    this.lastMoney = sim.state.player.money;
    this.amb = 0;
    this.moodT = 0;
    this.last = {};
    this.beds = null;
    this.unready = onAudioReady(() => this.ready());
    const bus = sim.bus;
    this.unsubs = [
      bus.on('toast', ({ key, type }) => this.toast(key, type)),
      bus.on('player:levelup', () => play('levelup')),
      bus.on('player:skillup', () => this.once('skillup', 400) && play('skillup')),
      bus.on('inventory:delta', ({ qty }) => qty > 0 && this.once('pickup', 90) && play('pickup')),
      bus.on('player:action', (a) => this.action(a)),
      bus.on('nature:felled', (obj) => this.at('treefall', obj.tx * TS + 16, obj.ty * TS + 16, 1.4)),
      bus.on('festival:started', () => play('cheer', { vol: 1.2 })),
      bus.on('construction:stage', (c) => c && this.at('hammer', (c.tx + c.w / 2) * TS, (c.ty + c.h) * TS, 1.2)), // (a site going up nearby)
      bus.on('time:hour', (h) => this.hour(h)),
      bus.on('player:crafted', () => play('pickup')),
    ];
  }

  ready() {
    music.start();
    this.mood(true);
  }

  /** At most once every ms (so a burst of events is one sound). */
  once(key, ms) {
    const now = performance.now();
    if (now - (this.last[key] || 0) < ms) return false;
    this.last[key] = now;
    return true;
  }

  toast(key, type) {
    if (key === 'toast.good_morning') return play('rooster', { amb: true, pan: -0.4 });
    if (key === 'toast.festival_on') return;
    if (CELEBRATE.has(key)) return play('celebrate');
    const s = TOAST_SOUND[type];
    if (s && this.once(`toast_${s}`, 600)) play(s, { vol: type === 'warn' ? 0.7 : 1 });
  }

  action(a) {
    if (a.kind === 'fish') play(a.qty ? 'splash' : 'reel');
    else if (a.kind === 'hunt') play('bow');
    else if (a.kind === 'eat') play('eat');
  }

  hour(h) {
    if (this.scene.inside || this.sim.state.player.away) return;
    if (h === 12) play('bell', { amb: true, vol: 0.5, pan: 0.2 }); // the noon bell
    if (h === 6 && this.sim.time.season !== 'winter') play('rooster', { amb: true, pan: 0.5, vol: 0.8 });
  }

  /** A sound from a place in the world: quieter with distance, panned to its side. */
  at(name, x, y, vol = 1) {
    if (this.scene.inside) return;
    const p = this.scene.player;
    if (!p) return;
    const dx = x - p.x;
    const d = Math.hypot(dx, y - p.y);
    if (d > HEAR) return;
    const k = 1 - d / HEAR;
    play(name, { vol: vol * k * k * 0.8, pan: Math.max(-0.8, Math.min(0.8, dx / (8 * TS))) });
  }

  /** A villager's work ticked (NPCViews calls this with its particles). */
  work(kind, npc) {
    const s = WORK_SOUND[kind];
    if (s) this.at(s, npc.x, npc.y, 0.7);
  }

  /** Your own tool, once per swing (PlayerController calls this). */
  tool(kind) {
    play(kind === 'till' ? 'dig' : kind, { vol: 0.9 });
  }

  update(delta) {
    if (!audioCtx()) return;
    const sim = this.sim;
    const pc = this.scene.player;
    const p = sim.state.player;

    // Coins: your money went up or down.
    const m = p.money;
    if (m !== this.lastMoney) {
      const diff = m - this.lastMoney;
      this.lastMoney = m;
      if (Math.abs(diff) >= 1 && this.once(diff > 0 ? 'coin' : 'pay', 160)) play(diff > 0 ? 'coin' : 'pay');
    }

    // Footsteps and wheels.
    const body = pc?.sprite?.body;
    const speed = body && !pc.hidden ? Math.hypot(body.velocity.x, body.velocity.y) : 0;
    if (speed > 5) {
      const d = (speed * delta) / 1000;
      this.stepDist += d;
      if (this.stepDist > 30) {
        this.stepDist = 0;
        play(this.surface(), { vol: 0.8, pan: (Math.random() - 0.5) * 0.2 });
      }
      if (p.eq) {
        this.wheelDist += d;
        if (this.wheelDist > 46) {
          this.wheelDist = 0;
          play('wheel', { vol: 0.8 });
        }
      }
    } else this.stepDist = 22; // the first step comes quickly
    // Long work (a building site, a shift at your workshop): the hammer keeps going.
    if (pc?.working && this.once('working', 460)) play(this.scene.inside ? 'craft' : 'hammer', { vol: 0.8 });

    this.amb -= delta;
    if (this.amb <= 0) {
      this.amb = 250;
      this.ambience();
    }
    this.moodT -= delta;
    if (this.moodT <= 0) {
      this.moodT = 1000;
      this.mood();
    }
  }

  surface() {
    if (this.scene.inside) return 'step_wood';
    const pc = this.scene.player;
    const w = this.sim.world;
    const { tx, ty } = w.toTile(pc.x, pc.y);
    const tile = w.tileAt(tx, ty);
    if (tile === T.PLAZA || tile === T.BRIDGE) return tile === T.BRIDGE ? 'step_wood' : 'step_stone';
    if (w.isRoad(tx, ty)) return 'step_road';
    if (this.sim.time.season === 'winter' || this.sim.weather.type === 'snow') return 'step_snow';
    return 'step_grass';
  }

  // ---------------------------------------------------------------- the valley's sounds

  ambience() {
    const sim = this.sim;
    if (!this.beds) {
      this.beds = {
        rain: new NoiseBed({ type: 'lowpass', freq: 2600, q: 0.3 }),
        drops: new NoiseBed({ type: 'highpass', freq: 5000, q: 0.5 }),
        wind: new NoiseBed({ type: 'bandpass', freq: 500, q: 0.8, lfo: 0.13, lfoDepth: 280 }),
        crowd: new NoiseBed({ type: 'bandpass', freq: 650, q: 1.2, lfo: 0.4, lfoDepth: 150 }),
        fire: new NoiseBed({ type: 'bandpass', freq: 1200, q: 0.6 }),
      };
    }
    const B = this.beds;
    const inside = !!this.scene.inside;
    muffle(inside);
    const away = sim.state.player.away || this.scene.player?.hidden;
    const w = sim.weather.type;
    const h = sim.time.hourFloat;
    const season = sim.time.season;
    const day = h >= 5.5 && h < 20;
    const night = h >= 21 || h < 4.5;

    B.rain.set(away ? 0 : w === 'storm' ? 0.34 : w === 'rain' ? 0.2 : 0);
    B.drops.set(away ? 0 : w === 'storm' ? 0.06 : w === 'rain' ? 0.035 : 0);
    B.wind.set(away ? 0 : w === 'storm' ? 0.3 : w === 'snow' ? 0.14 : w === 'fog' || w === 'cloudy' ? 0.04 : season === 'winter' ? 0.05 : 0.015);

    // The festival: a crowd on the square, louder as you get closer.
    const F = sim.festivals;
    let crowd = 0;
    if (F?.active() && !away) {
      const c = F.centre();
      const pc = this.scene.player;
      const d = Math.hypot(c.tx * TS - pc.x, c.ty * TS - pc.y);
      crowd = Math.max(0, 1 - d / (22 * TS));
      if (crowd > 0.1 && Math.random() < crowd * 0.5) play('voice', { amb: true, vol: crowd * 2, pan: (Math.random() - 0.5) * 1.4, high: Math.random() < 0.5 });
      if (crowd > 0.3 && Math.random() < 0.012) play('cheer', { amb: true, vol: crowd });
    }
    B.crowd.set(crowd * 0.07);

    // Fires crackle.
    let fire = 0;
    for (const f of sim.state.fires || []) {
      const b = sim.world.buildings[f.building];
      if (!b) continue;
      const pc = this.scene.player;
      const d = Math.hypot((b.tx + b.w / 2) * TS - pc.x, (b.ty + b.h / 2) * TS - pc.y);
      fire = Math.max(fire, (1 - d / (16 * TS)) * Math.min(1, f.intensity / 60));
    }
    B.fire.set(Math.max(0, fire) * 0.12);
    if (fire > 0.2 && Math.random() < 0.3) play('fire', { amb: true, vol: fire });

    if (away || inside) return;
    const fine = w === 'sunny' || w === 'cloudy' || w === 'fog';
    // Birds by day (many in spring, a few in autumn, none in winter).
    const birds = { spring: 0.09, summer: 0.07, autumn: 0.025, winter: 0.004 }[season] || 0;
    if (day && fine && Math.random() < birds * (h < 9 ? 1.8 : 1)) play('bird', { amb: true, pan: (Math.random() - 0.5) * 1.6, vol: 0.6 + Math.random() * 0.6 });
    // Crickets and owls at night.
    if (night && fine && (season === 'summer' || season === 'autumn' || season === 'spring') && Math.random() < (season === 'summer' ? 0.35 : 0.15)) play('cricket', { amb: true, pan: (Math.random() - 0.5) * 1.6, vol: 0.5 + Math.random() * 0.5 });
    if (night && fine && Math.random() < 0.004) play('owl', { amb: true, pan: (Math.random() - 0.5) * 1.6, vol: 0.6 });
  }

  /** Thunder a moment after the lightning (Atmosphere calls this). */
  thunder() {
    play('thunder', { amb: true, delay: 0.3 + Math.random() * 1.4, vol: this.scene.inside ? 0.5 : 1 });
  }

  /** What the band should be playing now. */
  mood(force) {
    const sim = this.sim;
    const h = sim.time.hourFloat;
    const w = sim.weather.type;
    let m = sim.time.season;
    if (sim.festivals?.active()) m = 'festival';
    else if (h >= 21 || h < 5) m = 'night';
    else if (w === 'rain' || w === 'storm') m = 'rain';
    if (force || m !== music.want) music.setMood(m);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
    this.unready?.();
    for (const b of Object.values(this.beds || {})) b.stop();
    this.beds = null;
    muffle(false);
  }
}
