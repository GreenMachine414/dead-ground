// Procedural melodic adventure score. Each song has a key, scale, tempo and chord
// progression; a seeded melody is generated per song. Layers fade in with intensity:
//   0 explore: soft pads, plucked arpeggios, flute melody with breathing room
//   1 combat:  + bass line and drums, busier arpeggio, melody every phrase
//   2 boss:    + driving four-on-the-floor kick, toms and brassy stabs
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
};
const SONGS = {
  menu: { root: 53, scale: 'major', bpm: 76, prog: [0, 5, 3, 4], seed: 11 },
  1: { root: 48, scale: 'major', bpm: 92, prog: [0, 4, 5, 3], seed: 7 },
  2: { root: 45, scale: 'minor', bpm: 96, prog: [0, 5, 2, 6], seed: 21 },
  3: { root: 50, scale: 'mixo', bpm: 102, prog: [0, 6, 3, 0], seed: 33 },
  4: { root: 52, scale: 'minor', bpm: 84, prog: [0, 3, 5, 4], seed: 44 },
  5: { root: 50, scale: 'harmonic', bpm: 108, prog: [0, 5, 3, 4], seed: 57 },
};
const RHYTHMS = [
  [0, 4, 6, 8, 12],
  [0, 3, 6, 8, 10, 12],
  [0, 6, 8, 14],
  [0, 2, 4, 8, 12, 14],
  [0, 8, 10, 12],
  [2, 4, 8, 11, 12],
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Music {
  constructor(audio, song) {
    this.audio = audio;
    this.ctx = audio.ctx;
    this.song = song;
    this.def = SONGS[song] || SONGS.menu;
    this.sc = SCALES[this.def.scale];
    this.intensity = 0;
    const ctx = this.ctx;
    // buses: dry + small generated reverb for warmth
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
    this.out.connect(audio.musicBus);
    const rev = ctx.createConvolver();
    rev.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.out.connect(rev).connect(wet).connect(audio.musicBus);
    const bus = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out);
      return g;
    };
    this.bus = { pad: bus(0.9), arp: bus(0.7), mel: bus(0.85), bass: bus(0), drum: bus(0), boss: bus(0) };
    this.melodies = [this.makePhrase(0), this.makePhrase(1)];
    this.step = 0;
    this.next = ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.tick(), 25);
  }

  impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  stop() {
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 1.2);
    setTimeout(() => this.out.disconnect(), 1500);
  }

  setIntensity(level) {
    if (level === this.intensity) return;
    this.intensity = level;
    const t = this.ctx.currentTime;
    const target = { bass: level >= 1 ? 0.9 : 0, drum: level >= 1 ? 0.8 : 0, boss: level >= 2 ? 0.7 : 0, arp: level >= 1 ? 0.55 : 0.7 };
    for (const [k, v] of Object.entries(target)) {
      const g = this.bus[k].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v, t + (v > g.value ? 2.5 : 4));
    }
  }

  // scale degree (can be negative / above 7) -> midi note
  deg(i) {
    const o = Math.floor(i / 7);
    return this.def.root + this.sc[((i % 7) + 7) % 7] + 12 * o;
  }

  chordDegrees(bar) {
    const d = this.def.prog[bar % this.def.prog.length];
    return [d, d + 2, d + 4];
  }

  // 4-bar seeded melody: list of [bar, step, degree, lengthSteps]
  makePhrase(variant) {
    const r = rng(this.def.seed * 31 + variant * 7);
    const notes = [];
    let cur = 9 + Math.floor(r() * 3);
    for (let bar = 0; bar < 4; bar++) {
      const rhythm = RHYTHMS[Math.floor(r() * RHYTHMS.length)];
      const chord = this.chordDegrees(bar).map((d) => d + 7);
      rhythm.forEach((s, i) => {
        const strong = s % 8 === 0;
        if (strong) {
          // land on the nearest chord tone
          let best = chord[0];
          for (const c of [...chord, ...chord.map((x) => x + 7)]) if (Math.abs(c - cur) < Math.abs(best - cur)) best = c;
          cur = best;
        } else {
          cur += [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
        }
        cur = Math.max(6, Math.min(16, cur));
        const nextS = i + 1 < rhythm.length ? rhythm[i + 1] : 16;
        notes.push([bar, s, cur, Math.max(1, nextS - s)]);
      });
    }
    // end the phrase on the tonic
    notes[notes.length - 1][2] = 7;
    return notes;
  }

  tick() {
    const ctx = this.ctx;
    const stepDur = 60 / this.def.bpm / 4;
    while (this.next < ctx.currentTime + 0.15) {
      this.schedule(this.step, this.next, stepDur);
      this.next += stepDur;
      this.step++;
    }
  }

  schedule(step, t, sd) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const chord = this.chordDegrees(bar);
    const I = this.intensity;
    // pads: new chord every bar
    if (s === 0) {
      for (const d of chord) this.pad(t, mtof(this.deg(d)), sd * 16, I >= 2);
      this.pad(t, mtof(this.deg(chord[0]) - 12), sd * 16, false);
    }
    // plucked arpeggio
    const arpEvery = I >= 1 ? 1 : 2;
    if (s % arpEvery === 0) {
      const pattern = [0, 1, 2, 3, 2, 1];
      const idx = pattern[(s / arpEvery) % pattern.length];
      const midi = idx === 3 ? this.deg(chord[0] + 7) : this.deg(chord[idx]);
      this.pluck(t, mtof(midi + 12), I >= 1 ? 0.07 : 0.09);
    }
    // melody: phrase A A B A over 16 bars; explore mode rests every other phrase
    const phraseNo = Math.floor(bar / 4);
    const playMel = I >= 1 || phraseNo % 2 === 0;
    if (playMel) {
      const phrase = this.melodies[phraseNo % 4 === 2 ? 1 : 0];
      for (const [b, ns, d, len] of phrase) {
        if (b === bar % 4 && ns === s) {
          const f = mtof(this.deg(d));
          this.flute(t, f, len * sd * 0.95, I >= 1 ? 0.11 : 0.09);
          if (I >= 2) this.brass(t, f / 2, len * sd * 0.8);
        }
      }
    }
    // bass (bus muted while exploring)
    const root = mtof(this.deg(chord[0]) - 12);
    const bassSteps = I >= 2 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 6, 8, 14];
    if (bassSteps.includes(s)) this.bass(t, s === 14 ? root * 1.5 : root, sd * 1.8);
    // drums
    if (s === 0 || s === 8 || (I >= 2 && s % 4 === 0) || (s === 10 && bar % 2)) this.kick(t, this.bus.drum);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.08);
    if (bar % 4 === 3 && s >= 12) this.tom(t, 220 - (s - 12) * 30);
  }

  // ---------------------------------------------------------------- instruments
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  osc(type, f, t, end, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  pad(t, f, dur, bright) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = bright ? 1600 : 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.6);
    g.gain.setValueAtTime(0.035, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    lp.connect(g).connect(this.bus.pad);
    this.osc('triangle', f, t, t + dur + 0.5, lp, -5);
    this.osc(bright ? 'sawtooth' : 'sine', f, t, t + dur + 0.5, lp, 6);
  }

  pluck(t, f, vol) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, 0.45);
    lp.connect(g).connect(this.bus.arp);
    this.osc('triangle', f, t, t + 0.5, lp);
    this.osc('sine', f * 2, t, t + 0.3, lp);
  }

  flute(t, f, dur, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.07, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
    g.connect(this.bus.mel);
    const o = this.osc('sine', f, t, t + dur + 0.2, g);
    // gentle vibrato that eases in
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35);
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.2);
    const h = ctx.createGain();
    h.gain.value = 0.18;
    h.connect(g);
    this.osc('triangle', f * 2, t, t + dur + 0.2, h);
  }

  brass(t, f, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1800, t + 0.08);
    lp.frequency.linearRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.03, 0.05, dur + 0.1);
    lp.connect(g).connect(this.bus.boss);
    this.osc('sawtooth', f, t, t + dur + 0.2, lp, -7);
    this.osc('sawtooth', f, t, t + dur + 0.2, lp, 7);
  }

  bass(t, f, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.16, dur);
    lp.connect(g).connect(this.bus.bass);
    this.osc('triangle', f, t, t + dur + 0.1, lp);
    this.osc('sine', f / 2, t, t + dur + 0.1, lp);
  }

  kick(t, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.5, 0.22);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  noise(t, dur, type, freq, vol, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  snare(t) {
    this.noise(t, 0.16, 'bandpass', 1800, 0.22, this.bus.drum);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, 0.12, 0.08);
    g.connect(this.bus.drum);
    this.osc('triangle', 190, t, t + 0.12, g);
  }

  hat(t, vol) {
    this.noise(t, 0.04, 'highpass', 7500, vol, this.bus.drum);
  }

  tom(t, f) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.25, 0.22);
    o.connect(g).connect(this.bus.boss);
    o.start(t);
    o.stop(t + 0.3);
  }
}
