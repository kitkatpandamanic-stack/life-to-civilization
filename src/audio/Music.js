/**
 * Music — tunes composed while you play, never the same twice.
 *
 * A mood (from the season, the hour, a festival…) picks a key, a mode, a speed, a chord progression
 * and the instruments. A song is 16 bars: a short motif, repeated and varied, over a pad and a bass,
 * ending on the home chord. Then a quiet gap (the valley's own sounds carry on) before the next one —
 * except at a festival, where the band keeps playing.
 *
 * Notes are scheduled a little ahead with the audio clock, so the timing stays steady even when
 * the game is busy.
 */
import { audioCtx, buses, tone } from './AudioEngine.js';

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/**
 * root: MIDI note of the key's tonic (for the melody's octave) · prog: chord roots as scale degrees
 * (0 = I) · steps: grid steps in a bar (8 = 4/4 in eighths, 6 = 6/8 jig) · density: how busy the tune is
 */
export const MOODS = {
  title: { mode: 'ionian', root: 62, bpm: 70, steps: 8, prog: [0, 5, 3, 4], lead: 'pluck', pad: 'warm', density: 0.45, gap: [6, 12] },
  spring: { mode: 'ionian', root: 67, bpm: 86, steps: 8, prog: [0, 3, 5, 4], lead: 'pluck', pad: 'warm', density: 0.55, gap: [18, 40] },
  summer: { mode: 'lydian', root: 65, bpm: 94, steps: 8, prog: [0, 1, 0, 4], lead: 'flute', pad: 'warm', density: 0.6, gap: [18, 40] },
  autumn: { mode: 'dorian', root: 64, bpm: 76, steps: 6, prog: [0, 3, 0, 6], lead: 'pluck', pad: 'reed', density: 0.5, gap: [20, 45] },
  winter: { mode: 'aeolian', root: 64, bpm: 60, steps: 8, prog: [0, 5, 2, 6], lead: 'bell', pad: 'cold', density: 0.32, gap: [25, 50] },
  night: { mode: 'aeolian', root: 62, bpm: 54, steps: 8, prog: [0, 5, 3, 0], lead: 'flute', pad: 'cold', density: 0.28, gap: [30, 60] },
  rain: { mode: 'dorian', root: 62, bpm: 64, steps: 8, prog: [0, 3, 6, 0], lead: 'pluck', pad: 'cold', density: 0.3, gap: [25, 50] },
  festival: { mode: 'mixolydian', root: 62, bpm: 138, steps: 6, prog: [0, 6, 0, 4], lead: 'fiddle', pad: 'reed', density: 0.85, drum: true, gap: [2, 4] },
};

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Music {
  constructor() {
    this.mood = null;
    this.want = null;
    this.playing = false;
    this.song = null;
    this.nextSongAt = 0;
    this.timer = null;
  }

  /** Start the band (once audio is unlocked). */
  start() {
    const ctx = audioCtx();
    if (!ctx || this.timer) return;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(buses().music);
    this.nextSongAt = ctx.currentTime + 1.5;
    this.timer = setInterval(() => this.tick(), 90);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const ctx = audioCtx();
    if (this.out && ctx) {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      const o = this.out;
      setTimeout(() => o.disconnect(), 2500);
    }
    this.out = null;
    this.song = null;
  }

  /** Ask for a mood. A big change (a festival starts or ends) fades the current song out now. */
  setMood(name) {
    if (!MOODS[name] || name === this.want) return;
    const urgent = name === 'festival' || this.want === 'festival' || this.want === 'title' || name === 'title';
    this.want = name;
    const ctx = audioCtx();
    if (!ctx || !this.out) return;
    if (urgent && this.song) {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      this.song = null;
      this.nextSongAt = ctx.currentTime + 2.2;
      setTimeout(() => this.out && this.out.gain.setTargetAtTime(1, audioCtx().currentTime, 0.05), 2000);
    } else if (!this.song) this.nextSongAt = Math.min(this.nextSongAt, ctx.currentTime + (urgent ? 1 : 6));
  }

  tick() {
    const ctx = audioCtx();
    if (!ctx || ctx.state !== 'running' || !this.want) return;
    const ahead = ctx.currentTime + 0.35;
    if (!this.song) {
      if (ctx.currentTime < this.nextSongAt) return;
      this.song = this.compose(MOODS[this.want], Math.max(ctx.currentTime + 0.1, this.nextSongAt));
      this.mood = this.want;
    }
    const s = this.song;
    while (s.nextStepAt < ahead) {
      this.playStep(s, s.step, s.nextStepAt);
      s.step++;
      s.nextStepAt += s.stepDur;
      if (s.step >= s.bars * s.m.steps) {
        const [a, b] = s.m.gap;
        this.nextSongAt = s.nextStepAt + 2.5 + rnd(a, b);
        this.song = null;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- composing

  compose(m, at) {
    const scale = MODES[m.mode];
    const song = { m, scale, step: 0, nextStepAt: at, stepDur: 60 / m.bpm / 2, bars: 16, root: m.root + pick([0, 0, -2, 2, 5]) };
    // A 2-bar motif: scale positions (0 = tonic) with lengths in steps.
    song.motif = this.motif(m, scale);
    song.answer = this.motif(m, scale);
    song.melodyOct = 0;
    return song;
  }

  motif(m, scale) {
    const notes = [];
    const n = m.steps * 2;
    let pos = pick([0, 2, 4]);
    for (let st = 0; st < n; ) {
      const strong = st % (m.steps / 2) === 0;
      if (Math.random() < m.density * (strong ? 1.4 : 0.75)) {
        const len = pick(m.density > 0.7 ? [1, 1, 2] : [1, 2, 2, 3, 4]);
        notes.push({ st, pos, len });
        pos += pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]);
        pos = Math.max(-3, Math.min(9, pos));
        st += len;
      } else st += 1;
    }
    return notes;
  }

  /** Scale position → MIDI (positions past 6 go up an octave). */
  noteAt(song, pos, octave = 0) {
    const sc = song.scale;
    const o = Math.floor(pos / sc.length);
    const i = ((pos % sc.length) + sc.length) % sc.length;
    return song.root + sc[i] + 12 * (o + octave);
  }

  playStep(song, step, t) {
    const m = song.m;
    const bar = Math.floor(step / m.steps);
    const st = step % m.steps;
    const chordDeg = bar === song.bars - 1 ? 0 : m.prog[bar % m.prog.length];
    const out = this.out;
    if (!out) return;

    // The chord: a soft pad at the start of each bar.
    if (st === 0) {
      const barDur = song.stepDur * m.steps;
      for (const k of [0, 2, 4]) this.pad(out, t, midiHz(this.noteAt(song, chordDeg + k, -1)), barDur, m.pad, bar === song.bars - 1);
      this.bass(out, t, midiHz(this.noteAt(song, chordDeg, -2)), song.stepDur * (m.steps / 2));
    } else if (st === m.steps / 2 && Math.random() < 0.6) {
      this.bass(out, t, midiHz(this.noteAt(song, chordDeg + pick([4, 0, 2]), -2)), song.stepDur * (m.steps / 2));
    }

    // The tune: motif, motif varied, answer, motif, then home.
    const sect = Math.floor(bar / 2) % 4;
    const src = sect === 2 ? song.answer : song.motif;
    const within = step % (m.steps * 2);
    const shift = sect === 1 ? 2 : 0;
    const lastBars = bar >= song.bars - 2;
    for (const n of src) {
      if (n.st !== within) continue;
      let pos = n.pos + shift;
      if (lastBars && n === src[src.length - 1]) pos = 7; // resolve on the tonic, an octave up
      this.lead(out, t, midiHz(this.noteAt(song, pos)), n.len * song.stepDur, m.lead);
    }
    if (bar === song.bars - 1 && st === 0) this.lead(out, t, midiHz(this.noteAt(song, 7)), song.stepDur * m.steps, m.lead);

    // A dance beat at festivals: a drum on the pulse, a tambourine between.
    if (m.drum) {
      const pulse = m.steps === 6 ? st % 3 === 0 : st % 2 === 0;
      if (pulse) tone(out, t, { type: 'sine', freq: [120, 50], peak: st === 0 ? 0.22 : 0.14, d: 0.16 });
      else this.shake(out, t);
    }
  }

  // ---------------------------------------------------------------- instruments

  pad(out, t, f, dur, kind, last) {
    const ctx = audioCtx();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'cold' ? 900 : kind === 'reed' ? 1500 : 1200;
    g.connect(lp).connect(out);
    const peak = kind === 'reed' ? 0.02 : 0.028;
    const rel = last ? dur * 2.5 : dur * 1.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.8, dur * 0.35));
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, rel / 4);
    for (const [type, det] of kind === 'reed' ? [['sawtooth', -6], ['triangle', 5]] : [['triangle', -5], ['sine', 6]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur * 0.7 + rel + 0.5);
    }
  }

  bass(out, t, f, dur) {
    tone(out, t, { type: 'triangle', freq: f, a: 0.01, peak: 0.1, d: Math.max(0.3, dur * 0.9) });
  }

  lead(out, t, f, dur, kind) {
    const ctx = audioCtx();
    if (kind === 'pluck') {
      tone(out, t, { type: 'triangle', freq: f, a: 0.004, peak: 0.07, d: Math.max(0.35, dur * 1.4) });
      tone(out, t, { type: 'sine', freq: f * 2, a: 0.004, peak: 0.025, d: 0.25 });
      return;
    }
    if (kind === 'bell') {
      tone(out, t, { type: 'sine', freq: f * 2, a: 0.003, peak: 0.05, d: 1.4 });
      tone(out, t, { type: 'sine', freq: f * 2 * 2.76, a: 0.003, peak: 0.012, d: 0.6 });
      return;
    }
    // flute / fiddle: a held note with a little vibrato
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'fiddle' ? 2600 : 2000;
    o.type = kind === 'fiddle' ? 'sawtooth' : 'sine';
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    const vd = ctx.createGain();
    vib.frequency.value = 5.2;
    vd.gain.value = f * 0.006;
    vib.connect(vd).connect(o.frequency);
    o.connect(lp).connect(g).connect(out);
    const peak = kind === 'fiddle' ? 0.035 : 0.06;
    const a = kind === 'fiddle' ? 0.03 : 0.07;
    const hold = Math.max(0.02, dur - a - 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak * 0.85, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + 0.25);
    o.start(t);
    vib.start(t);
    o.stop(t + a + hold + 0.3);
    vib.stop(t + a + hold + 0.3);
  }

  shake(out, t) {
    const ctx = audioCtx();
    const len = 0.06;
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(hp).connect(g).connect(out);
    src.start(t);
  }
}

/** One band for the whole page (the title screen and the game share it). */
export const music = new Music();
