/**
 * AudioEngine — every sound in the game, made on the spot with the Web Audio API (no sound files).
 *
 *   master ─┬─ music     (Music.js: the tunes)
 *           ├─ sfx       (footsteps, tools, coins, the interface)
 *           └─ ambience  (rain, wind, birds, crickets, the festival crowd) → a muffle filter for indoors
 *
 * Browsers only let a page make sound after the player has clicked or pressed a key, so the audio
 * context is started on the first gesture (unlock()). Until then every call is quietly ignored.
 * Volumes live in the browser settings (ui/settings.js), not in save games.
 */
import { getSetting, onSettingChange } from '../ui/settings.js';

onSettingChange((k) => {
  if (k.startsWith('vol') || k === 'mute') applyVolumes();
});

let ctx = null;
let master, sfxBus, musicBus, ambBus, ambFilter;
let noiseBuf = null;
const listeners = new Set();

/** The audio context, once the player has interacted with the page (null before). */
export function audioCtx() {
  return ctx;
}

export function buses() {
  return { master, sfx: sfxBus, music: musicBus, amb: ambBus };
}

/** Call from any click / key press: starts sound (browsers need a gesture first). */
export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
    return;
  }
  master = ctx.createGain();
  // A gentle limiter so many sounds at once never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  ambBus = ctx.createGain();
  ambFilter = ctx.createBiquadFilter();
  ambFilter.type = 'lowpass';
  ambFilter.frequency.value = 18000;
  sfxBus.connect(master);
  musicBus.connect(master);
  ambBus.connect(ambFilter).connect(master);
  noiseBuf = makeNoise(2);
  applyVolumes();
  for (const fn of listeners) fn(ctx);
}

/** Run fn once audio is available (now, if it already is). */
export function onAudioReady(fn) {
  if (ctx) fn(ctx);
  else listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Settings → bus volumes (0..1 each; the sliders are squared so the low end is usable). */
export function applyVolumes() {
  if (!ctx) return;
  const v = (k, d) => {
    const x = getSetting(k);
    return Math.pow(typeof x === 'number' ? x : d, 1.6);
  };
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(getSetting('mute') ? 0 : v('volMaster', 0.8), t, 0.05);
  sfxBus.gain.setTargetAtTime(v('volSfx', 0.8), t, 0.05);
  musicBus.gain.setTargetAtTime(v('volMusic', 0.6) * 0.8, t, 0.05);
  ambBus.gain.setTargetAtTime(v('volAmbience', 0.7), t, 0.05);
}

/** Indoors the rain and birds sound far away. */
export function muffle(on) {
  if (!ctx) return;
  ambFilter.frequency.setTargetAtTime(on ? 700 : 18000, ctx.currentTime, 0.25);
}

function makeNoise(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------------------------------------------------------------- building blocks

/** An envelope on a gain node: quick attack, then decay to silence. */
function env(g, t, { a = 0.005, peak = 0.5, d = 0.2, hold = 0 } = {}) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold) g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  return t + a + hold + d;
}

/** Stereo placement (-1 left … 1 right), when the browser can. */
function panner(pan, dest) {
  if (!pan || !ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}

/** One oscillator note. freq may be [from, to] for a slide. */
export function tone(dest, t, { type = 'sine', freq = 440, a, peak = 0.3, d = 0.3, hold, detune = 0, pan = 0 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  const [f0, f1] = Array.isArray(freq) ? freq : [freq, freq];
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + (a || 0.005) + (hold || 0) + d);
  o.detune.value = detune;
  o.connect(g).connect(panner(pan, dest));
  const end = env(g, t, { a, peak, d, hold });
  o.start(t);
  o.stop(end + 0.05);
  return end;
}

/** A burst of filtered noise (steps, chops, splashes, rain drops). */
export function noise(dest, t, { type = 'lowpass', freq = 1000, q = 1, a, peak = 0.3, d = 0.1, hold, sweep = null, pan = 0, rate = 1 } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + (a || 0.005) + (hold || 0) + d);
  f.Q.value = q;
  const g = ctx.createGain();
  s.connect(f).connect(g).connect(panner(pan, dest));
  const end = env(g, t, { a, peak, d, hold });
  s.start(t, Math.random() * 1.5);
  s.stop(end + 0.05);
  return end;
}

// ---------------------------------------------------------------- the sounds

const vary = (x, by = 0.08) => x * (1 + (Math.random() * 2 - 1) * by);

/**
 * Every short sound, by name. Each takes (bus, time, options {vol, pan}).
 * Kept small and soft: the valley should sound busy, never harsh.
 */
const SFX = {
  // The interface
  click: (b, t, o) => tone(b, t, { type: 'sine', freq: [vary(980, 0.03), 760], peak: 0.09 * o.vol, d: 0.05 }),
  open: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: 520, peak: 0.07 * o.vol, d: 0.08 });
    tone(b, t + 0.05, { type: 'triangle', freq: 780, peak: 0.06 * o.vol, d: 0.1 });
  },
  close: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: 700, peak: 0.06 * o.vol, d: 0.07 });
    tone(b, t + 0.045, { type: 'triangle', freq: 470, peak: 0.05 * o.vol, d: 0.09 });
  },
  good: (b, t, o) => [0, 4, 7].forEach((s, i) => tone(b, t + i * 0.07, { type: 'triangle', freq: 523 * 2 ** (s / 12), peak: 0.08 * o.vol, d: 0.35 })),
  warn: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: 440, peak: 0.08 * o.vol, d: 0.12 });
    tone(b, t + 0.1, { type: 'triangle', freq: 370, peak: 0.08 * o.vol, d: 0.18 });
  },
  danger: (b, t, o) => {
    for (let i = 0; i < 2; i++) tone(b, t + i * 0.18, { type: 'square', freq: 220, peak: 0.05 * o.vol, d: 0.14, hold: 0.04 });
  },
  levelup: (b, t, o) => {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(b, t + i * 0.09, { type: 'triangle', freq: 392 * 2 ** (s / 12), peak: 0.11 * o.vol, d: 0.5 }));
    for (let i = 0; i < 6; i++) tone(b, t + 0.45 + i * 0.05, { type: 'sine', freq: vary(2400, 0.2), peak: 0.03 * o.vol, d: 0.2 });
  },
  skillup: (b, t, o) => [0, 7, 12].forEach((s, i) => tone(b, t + i * 0.08, { type: 'sine', freq: 660 * 2 ** (s / 12), peak: 0.07 * o.vol, d: 0.4 })),
  celebrate: (b, t, o) => {
    [0, 4, 7, 12].forEach((s, i) => tone(b, t + i * 0.11, { type: 'triangle', freq: 523 * 2 ** (s / 12), peak: 0.1 * o.vol, d: 0.6 }));
    [0, 4, 7].forEach((s) => tone(b, t + 0.5, { type: 'sine', freq: 262 * 2 ** (s / 12), peak: 0.06 * o.vol, d: 1.2 }));
  },

  // Money and things
  coin: (b, t, o) => {
    tone(b, t, { type: 'sine', freq: vary(1568, 0.02), peak: 0.07 * o.vol, d: 0.18 });
    tone(b, t + 0.06, { type: 'sine', freq: vary(2093, 0.02), peak: 0.07 * o.vol, d: 0.3 });
  },
  pay: (b, t, o) => {
    tone(b, t, { type: 'sine', freq: 1318, peak: 0.05 * o.vol, d: 0.12 });
    tone(b, t + 0.07, { type: 'sine', freq: 988, peak: 0.05 * o.vol, d: 0.2 });
  },
  pickup: (b, t, o) => tone(b, t, { type: 'triangle', freq: [vary(420), vary(860)], peak: 0.07 * o.vol, d: 0.09 }),
  drop: (b, t, o) => tone(b, t, { type: 'triangle', freq: [520, 260], peak: 0.06 * o.vol, d: 0.1 }),
  eat: (b, t, o) => {
    for (let i = 0; i < 3; i++) noise(b, t + i * 0.11, { type: 'bandpass', freq: vary(2200, 0.3), q: 2, peak: 0.1 * o.vol, d: 0.05 });
  },

  // Footsteps (surface), wheels
  step_grass: (b, t, o) => noise(b, t, { type: 'lowpass', freq: vary(900, 0.2), peak: 0.07 * o.vol, d: 0.06, pan: o.pan }),
  step_road: (b, t, o) => noise(b, t, { type: 'bandpass', freq: vary(1500, 0.2), q: 1.2, peak: 0.07 * o.vol, d: 0.045, pan: o.pan }),
  step_stone: (b, t, o) => {
    noise(b, t, { type: 'highpass', freq: vary(2500, 0.2), peak: 0.05 * o.vol, d: 0.03, pan: o.pan });
    tone(b, t, { type: 'sine', freq: vary(180, 0.1), peak: 0.05 * o.vol, d: 0.04, pan: o.pan });
  },
  step_snow: (b, t, o) => noise(b, t, { type: 'bandpass', freq: vary(3200, 0.2), q: 0.7, a: 0.02, peak: 0.08 * o.vol, d: 0.09, pan: o.pan }),
  step_wood: (b, t, o) => tone(b, t, { type: 'triangle', freq: [vary(200, 0.1), 120], peak: 0.09 * o.vol, d: 0.07, pan: o.pan }),
  wheel: (b, t, o) => {
    noise(b, t, { type: 'lowpass', freq: 320, peak: 0.08 * o.vol, d: 0.12, pan: o.pan });
    tone(b, t + 0.03, { type: 'sine', freq: vary(95, 0.1), peak: 0.05 * o.vol, d: 0.08, pan: o.pan });
    if (Math.random() < 0.25) tone(b, t + 0.05, { type: 'sawtooth', freq: [vary(900, 0.1), 700], peak: 0.012 * o.vol, d: 0.15, pan: o.pan }); // a creak
  },

  // Tools
  chop: (b, t, o) => {
    noise(b, t, { type: 'bandpass', freq: vary(900, 0.15), q: 1.5, peak: 0.22 * o.vol, d: 0.08, pan: o.pan });
    tone(b, t, { type: 'sine', freq: [vary(170, 0.1), 90], peak: 0.2 * o.vol, d: 0.1, pan: o.pan });
  },
  mine: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: vary(1760, 0.08), peak: 0.1 * o.vol, d: 0.18, pan: o.pan });
    tone(b, t, { type: 'sine', freq: vary(2640, 0.08), peak: 0.05 * o.vol, d: 0.12, pan: o.pan });
    noise(b, t, { type: 'highpass', freq: 3000, peak: 0.08 * o.vol, d: 0.04, pan: o.pan });
  },
  hammer: (b, t, o) => {
    tone(b, t, { type: 'square', freq: vary(330, 0.1), peak: 0.05 * o.vol, d: 0.05, pan: o.pan });
    noise(b, t, { type: 'bandpass', freq: vary(2000, 0.2), q: 2, peak: 0.12 * o.vol, d: 0.05, pan: o.pan });
    tone(b, t, { type: 'sine', freq: [140, 80], peak: 0.1 * o.vol, d: 0.08, pan: o.pan });
  },
  anvil: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: vary(1250, 0.03), peak: 0.1 * o.vol, d: 0.6, pan: o.pan });
    tone(b, t, { type: 'sine', freq: vary(3100, 0.03), peak: 0.05 * o.vol, d: 0.4, pan: o.pan });
  },
  dig: (b, t, o) => noise(b, t, { type: 'lowpass', freq: vary(420, 0.2), sweep: 200, a: 0.02, peak: 0.2 * o.vol, d: 0.16, pan: o.pan }),
  water: (b, t, o) => {
    noise(b, t, { type: 'bandpass', freq: 2400, sweep: 700, q: 1.5, a: 0.03, peak: 0.12 * o.vol, d: 0.35, pan: o.pan });
    for (let i = 0; i < 3; i++) tone(b, t + 0.05 + i * 0.07, { type: 'sine', freq: [vary(700, 0.3), vary(1300, 0.2)], peak: 0.03 * o.vol, d: 0.05, pan: o.pan });
  },
  splash: (b, t, o) => noise(b, t, { type: 'lowpass', freq: 1800, sweep: 300, a: 0.01, peak: 0.25 * o.vol, d: 0.5, pan: o.pan }),
  reel: (b, t, o) => {
    for (let i = 0; i < 5; i++) noise(b, t + i * 0.04, { type: 'highpass', freq: 4000, peak: 0.03 * o.vol, d: 0.02 });
  },
  bow: (b, t, o) => {
    tone(b, t, { type: 'triangle', freq: [260, 140], peak: 0.12 * o.vol, d: 0.2 });
    noise(b, t + 0.02, { type: 'highpass', freq: 2500, sweep: 6000, peak: 0.05 * o.vol, d: 0.2 });
  },
  saw: (b, t, o) => noise(b, t, { type: 'bandpass', freq: vary(1800, 0.1), sweep: 1300, q: 3, a: 0.05, peak: 0.08 * o.vol, d: 0.2, pan: o.pan }),
  load: (b, t, o) => {
    noise(b, t, { type: 'lowpass', freq: 600, peak: 0.1 * o.vol, d: 0.08, pan: o.pan });
    tone(b, t, { type: 'sine', freq: [vary(130, 0.1), 80], peak: 0.08 * o.vol, d: 0.07, pan: o.pan });
  },
  craft: (b, t, o) => (Math.random() < 0.5 ? SFX.hammer(b, t, { ...o, vol: o.vol * 0.7 }) : SFX.saw(b, t, o)),
  treefall: (b, t, o) => {
    noise(b, t, { type: 'bandpass', freq: 1400, sweep: 300, q: 2, a: 0.3, peak: 0.08 * o.vol, d: 0.5, pan: o.pan }); // creak
    noise(b, t + 0.7, { type: 'lowpass', freq: 500, sweep: 80, peak: 0.35 * o.vol, d: 0.6, pan: o.pan }); // crash
  },
  fire: (b, t, o) => {
    for (let i = 0; i < 6; i++) noise(b, t + Math.random() * 0.5, { type: 'highpass', freq: vary(3000, 0.4), peak: 0.05 * o.vol, d: 0.02, pan: o.pan });
  },
  door: (b, t, o) => {
    tone(b, t, { type: 'sine', freq: [110, 70], peak: 0.2 * o.vol, d: 0.12 });
    noise(b, t, { type: 'lowpass', freq: 400, peak: 0.1 * o.vol, d: 0.1 });
  },

  // The world
  thunder: (b, t, o) => {
    noise(b, t, { type: 'lowpass', freq: 900, sweep: 60, a: 0.02, peak: 0.5 * o.vol, d: 2.8, rate: 0.5 });
    noise(b, t + 0.3, { type: 'lowpass', freq: 200, a: 0.3, peak: 0.35 * o.vol, d: 2.5, rate: 0.3 });
  },
  bell: (b, t, o) => {
    for (const [m, p] of [[1, 0.14], [2.76, 0.06], [5.4, 0.03], [0.5, 0.05]]) tone(b, t, { type: 'sine', freq: 392 * m, peak: p * o.vol, d: 3.2, pan: o.pan });
  },
  rooster: (b, t, o) => {
    const f = 700;
    tone(b, t, { type: 'sawtooth', freq: [f, f * 1.25], peak: 0.02 * o.vol, d: 0.15, pan: o.pan });
    tone(b, t + 0.18, { type: 'sawtooth', freq: [f * 1.3, f * 1.5], peak: 0.025 * o.vol, d: 0.3, hold: 0.1, pan: o.pan });
    tone(b, t + 0.6, { type: 'sawtooth', freq: [f * 1.4, f * 0.9], peak: 0.02 * o.vol, d: 0.4, pan: o.pan });
  },
  bird: (b, t, o) => {
    const f = vary(3200, 0.25);
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) tone(b, t + i * vary(0.11, 0.3), { type: 'sine', freq: [f * vary(1, 0.1), f * vary(1.3, 0.15)], peak: 0.035 * o.vol, d: 0.07, pan: o.pan });
  },
  cricket: (b, t, o) => {
    for (let i = 0; i < 3; i++) tone(b, t + i * 0.05, { type: 'sine', freq: vary(4400, 0.03), peak: 0.018 * o.vol, d: 0.03, pan: o.pan });
  },
  owl: (b, t, o) => {
    tone(b, t, { type: 'sine', freq: [420, 380], a: 0.05, peak: 0.05 * o.vol, d: 0.3, pan: o.pan });
    tone(b, t + 0.45, { type: 'sine', freq: [430, 370], a: 0.05, peak: 0.05 * o.vol, d: 0.5, pan: o.pan });
  },
  // The railway (TrainViews)
  whistle: (b, t, o) => {
    for (const [f, dt] of [[880, 0], [1108, 0]]) tone(b, t + dt, { type: 'square', freq: f, a: 0.04, peak: 0.02 * o.vol, d: 0.3, hold: 0.5, pan: o.pan });
    noise(b, t, { type: 'bandpass', freq: 2500, q: 3, a: 0.04, peak: 0.03 * o.vol, d: 0.3, hold: 0.5, pan: o.pan });
  },
  chuff: (b, t, o) => noise(b, t, { type: 'lowpass', freq: vary(700, 0.1), a: 0.01, peak: 0.12 * o.vol, d: 0.18, pan: o.pan }),
  // Farm animals (LivestockViews)
  cluck: (b, t, o) => {
    for (let i = 0; i < 3; i++) tone(b, t + i * 0.09, { type: 'square', freq: [vary(700, 0.1), vary(520, 0.1)], peak: 0.018 * o.vol, d: 0.06, pan: o.pan });
  },
  moo: (b, t, o) => {
    tone(b, t, { type: 'sawtooth', freq: [vary(150, 0.05), 110], a: 0.15, peak: 0.035 * o.vol, d: 0.6, hold: 0.3, pan: o.pan });
    tone(b, t, { type: 'sine', freq: [vary(300, 0.05), 220], a: 0.15, peak: 0.02 * o.vol, d: 0.6, hold: 0.3, pan: o.pan });
  },
  baa: (b, t, o) => {
    const f = vary(420, 0.08);
    for (let i = 0; i < 4; i++) tone(b, t + i * 0.07, { type: 'sawtooth', freq: f * (1 - i * 0.03), peak: 0.018 * o.vol, d: 0.08, pan: o.pan });
  },
  cheer: (b, t, o) => {
    for (let i = 0; i < 8; i++) noise(b, t + Math.random() * 0.4, { type: 'bandpass', freq: vary(900, 0.4), q: 6, a: 0.05, peak: 0.05 * o.vol, d: 0.4, pan: (Math.random() - 0.5) });
  },
  voice: (b, t, o) => {
    // A snatch of distant talk: a formant-filtered buzz that rises and falls.
    const f0 = vary(o.high ? 210 : 130, 0.15);
    tone(b, t, { type: 'sawtooth', freq: [f0, f0 * vary(1.2, 0.2)], a: 0.04, peak: 0.012 * o.vol, d: 0.18, pan: o.pan });
  },
};

export const SFX_NAMES = Object.keys(SFX);

/** Play a named sound now. o: {vol (0..1+), pan (-1..1), delay (s)}. */
export function play(name, o = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const fn = SFX[name];
  if (!fn) return;
  const bus = o.amb ? ambBus : sfxBus;
  try {
    fn(bus, ctx.currentTime + (o.delay || 0) + 0.005, { vol: o.vol ?? 1, pan: o.pan || 0, high: o.high });
  } catch (e) {
    // Never let a sound break the game (but say so while developing).
    if (import.meta.env?.DEV) console.warn('sound', name, e.message);
  }
}

// ---------------------------------------------------------------- beds of sound (loops)

/** A looping noise bed through a filter, faded in and out (rain, wind, the crowd). */
export class NoiseBed {
  constructor({ type = 'lowpass', freq = 1000, q = 0.7, lfo = 0, lfoDepth = 0 } = {}) {
    this.src = ctx.createBufferSource();
    this.src.buffer = noiseBuf;
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = freq;
    this.filter.Q.value = q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.filter).connect(this.gain).connect(ambBus);
    if (lfo) {
      // Gusts: the filter wanders up and down.
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = lfo;
      const depth = ctx.createGain();
      depth.gain.value = lfoDepth;
      this.lfo.connect(depth).connect(this.filter.frequency);
      this.lfo.start();
    }
    this.src.start();
    this.level = 0;
  }

  set(level, secs = 1.5) {
    if (Math.abs(level - this.level) < 0.002) return;
    this.level = level;
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, secs / 3);
  }

  stop() {
    try {
      this.src.stop();
      this.lfo?.stop();
    } catch {
      /* already stopped */
    }
  }
}
