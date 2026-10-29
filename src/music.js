// Procedural score (no audio files). Each song has a key, scale, tempo, chord progression and a
// seeded melody, plus a style: its own instruments and feel.
//   menu    the main theme (menus and lobby only): pads, plucked arpeggio, flute
//   1 farm  Harvest Farm: banjo rolls, whistle, boom-chick bass, shaker
//   2 city  Dead End Downtown: swung electric piano, muted trumpet, walking bass, brushes
//   3 fort  Fort Ironside: string ostinato, horn, military snare, timpani
//   4 ice   Whiteout Station: glass bells, wind, a lone high voice, half-time pulse
//   5 lab   Ground Zero: drone, filtered synth pulse, metal clanks, four-on-the-floor
//   boss    the battle music every boss fight shares: driving strings, taiko, brass stabs,
//           choir and an alarm line, in a dark phrygian key
// Map songs have two levels: 0 explore (melodic layers only), 1 combat (+ bass and drums).
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
const SONGS = {
  menu: { root: 53, scale: 'major', bpm: 76, prog: [0, 5, 3, 4], seed: 11, style: 'menu', wet: 0.32 },
  1: { root: 48, scale: 'major', bpm: 98, prog: [0, 4, 5, 3], seed: 7, style: 'farm', wet: 0.22 },
  2: { root: 45, scale: 'minor', bpm: 84, prog: [0, 5, 2, 6], seed: 21, style: 'city', wet: 0.38 },
  3: { root: 50, scale: 'dorian', bpm: 104, prog: [0, 6, 3, 0], seed: 33, style: 'fort', wet: 0.28 },
  4: { root: 52, scale: 'minor', bpm: 70, prog: [0, 3, 5, 4], seed: 44, style: 'ice', wet: 0.55 },
  5: { root: 50, scale: 'harmonic', bpm: 112, prog: [0, 5, 3, 4], seed: 57, style: 'lab', wet: 0.3 },
  boss: { root: 40, scale: 'phrygian', bpm: 146, prog: [0, 1, 0, 6], seed: 99, style: 'boss', wet: 0.24 },
};
const RHYTHMS = [
  [0, 4, 6, 8, 12],
  [0, 3, 6, 8, 10, 12],
  [0, 6, 8, 14],
  [0, 2, 4, 8, 12, 14],
  [0, 8, 10, 12],
  [2, 4, 8, 11, 12],
];
// battle ostinato: semitones over the bar's root, one per 16th (12 = octave, 6 = the tritone)
const OSTINATO = [0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 12, 0, 0, 7, 6, 0];

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
    const battle = this.def.style === 'boss';
    // buses: dry + a reverb shared by every song (built once per audio context)
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + (battle ? 0.4 : 2));
    this.out.connect(audio.musicBus);
    if (!audio.reverbIR) audio.reverbIR = this.impulse(2.4);
    const rev = ctx.createConvolver();
    rev.buffer = audio.reverbIR;
    const wet = ctx.createGain();
    wet.gain.value = this.def.wet;
    this.out.connect(rev).connect(wet).connect(audio.musicBus);
    this.nodes = [rev, wet];
    const bus = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out);
      return g;
    };
    // the battle music is all in from the first bar; map songs bring bass and drums in for combat
    this.bus = { pad: bus(0.9), arp: bus(0.7), mel: bus(0.85), bass: bus(battle ? 0.9 : 0), drum: bus(battle ? 0.9 : 0), boss: bus(battle ? 1 : 0) };
    this.melodies = [this.makePhrase(0), this.makePhrase(1)];
    this.step = 0;
    this.next = ctx.currentTime + 0.15;
    this.drumsOn = this.bassOn = battle;
    if (battle) this.sting(ctx.currentTime + 0.05);
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
    setTimeout(() => {
      this.out.disconnect();
      for (const n of this.nodes) n.disconnect();
    }, 1500);
  }

  setIntensity(level) {
    level = Math.min(1, level); // map songs: explore or combat (bosses switch to the battle music)
    if (level === this.intensity || this.def.style === 'boss') return;
    this.intensity = level;
    const t = this.ctx.currentTime;
    const target = { bass: level >= 1 ? 0.9 : 0, drum: level >= 1 ? 0.8 : 0, arp: level >= 1 ? 0.55 : 0.7 };
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
    const s = step % 16, bar = Math.floor(step / 16);
    // muted layers (drums and bass while exploring) aren't built at all
    this.drumsOn = this.bus.drum.gain.value > 0.001;
    this.bassOn = this.bus.bass.gain.value > 0.001;
    STYLES[this.def.style].call(this, s, bar, t, sd, this.chordDegrees(bar), this.intensity);
  }

  // the melody notes starting on this step: fn(t, freq, seconds). Phrase A A B A over 16 bars;
  // while exploring (or when sparse) it rests every other phrase
  melody(s, bar, t, sd, sparse, fn) {
    const phraseNo = Math.floor(bar / 4);
    if (sparse && phraseNo % 2) return;
    const phrase = this.melodies[phraseNo % 4 === 2 ? 1 : 0];
    for (const [b, ns, d, len] of phrase) if (b === bar % 4 && ns === s) fn(t, mtof(this.deg(d)), len * sd);
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

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // a held note: attack, hold, release
  hold(g, t, a, peak, dur, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }

  vibrato(o, t, dur, rate, depth, delay = 0.3) {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = rate;
    const lg = this.ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(depth, t + delay);
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.2);
  }

  pad(t, f, dur, bright) {
    const ctx = this.ctx;
    const lp = this.filter('lowpass', bright ? 1600 : 900);
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
    const lp = this.filter('lowpass', 3200);
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, vol, 0.45);
    lp.connect(g).connect(this.bus.arp);
    this.osc('triangle', f, t, t + 0.5, lp);
    this.osc('sine', f * 2, t, t + 0.3, lp);
  }

  // bright, quick-decaying twang
  banjo(t, f, vol) {
    const bp = this.filter('bandpass', 2400, 0.8);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, vol, 0.2);
    bp.connect(g).connect(this.bus.arp);
    this.osc('sawtooth', f, t, t + 0.25, bp);
    this.osc('triangle', f * 2, t, t + 0.15, bp);
  }

  flute(t, f, dur, vol, rate = 5.2) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.07, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
    g.connect(this.bus.mel);
    const o = this.osc('sine', f, t, t + dur + 0.2, g);
    this.vibrato(o, t, dur, rate, f * 0.006, 0.35);
    const h = this.ctx.createGain();
    h.gain.value = 0.18;
    h.connect(g);
    this.osc('triangle', f * 2, t, t + dur + 0.2, h);
  }

  // electric piano: a sine with a bell partial, decaying, with a slow tremolo
  epiano(t, f, dur, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, Math.min(1.6, dur));
    const trem = ctx.createGain();
    trem.gain.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.2;
    lfo.connect(depth).connect(trem.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
    g.connect(trem).connect(this.bus.pad);
    this.osc('sine', f, t, t + dur + 0.1, g);
    const b = ctx.createGain();
    b.gain.setValueAtTime(0.25, t);
    b.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    b.connect(g);
    this.osc('sine', f * 4, t, t + 0.45, b);
  }

  // muted trumpet: a nasal square through a narrow band
  trumpet(t, f, dur, vol) {
    const bp = this.filter('bandpass', 1300, 1.6);
    const g = this.ctx.createGain();
    this.hold(g, t, 0.04, vol, dur, 0.08);
    bp.connect(g).connect(this.bus.mel);
    const o = this.osc('square', f, t, t + dur + 0.05, bp);
    this.vibrato(o, t, dur, 5, f * 0.008, 0.25);
  }

  // short bowed strings (ostinatos)
  strings(t, f, dur, vol, bright = 900) {
    const lp = this.filter('lowpass', bright);
    const g = this.ctx.createGain();
    this.hold(g, t, 0.01, vol, dur, dur * 0.4);
    lp.connect(g).connect(this.bus.arp);
    this.osc('sawtooth', f, t, t + dur + 0.05, lp, -6);
    this.osc('sawtooth', f, t, t + dur + 0.05, lp, 6);
  }

  // horn: soft brass that opens up as it sounds
  horn(t, f, dur, vol, dest = this.bus.mel) {
    const lp = this.filter('lowpass', 500);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.12);
    lp.frequency.linearRampToValueAtTime(900, t + dur);
    const g = this.ctx.createGain();
    this.hold(g, t, 0.05, vol, dur, 0.12);
    lp.connect(g).connect(dest);
    this.osc('sawtooth', f, t, t + dur + 0.05, lp, -6);
    this.osc('sawtooth', f, t, t + dur + 0.05, lp, 6);
  }

  // glass bell: inharmonic partials with a long decay
  bell(t, f, vol) {
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, vol, 2.4);
    g.connect(this.bus.arp);
    this.osc('sine', f, t, t + 2.5, g);
    const p = this.ctx.createGain();
    p.gain.setValueAtTime(0.35, t);
    p.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    p.connect(g);
    this.osc('sine', f * 2.76, t, t + 1, p);
  }

  // detuned synth through a resonant filter that sweeps with the bar
  synth(t, f, vol, cutoff) {
    const lp = this.filter('lowpass', cutoff, 7);
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, vol, 0.14);
    lp.connect(g).connect(this.bus.arp);
    this.osc('sawtooth', f, t, t + 0.2, lp, -8);
    this.osc('sawtooth', f, t, t + 0.2, lp, 8);
  }

  // choir "aah": stacked saws through two vowel formants
  choir(t, f, dur, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.hold(g, t, 0.35, vol, dur, 0.4);
    g.connect(this.bus.boss);
    for (const [fr, q] of [[720, 6], [1150, 8]]) {
      const bp = this.filter('bandpass', fr, q);
      bp.connect(g);
      for (const det of [-9, 0, 9]) this.osc('sawtooth', f, t, t + dur + 0.05, bp, det);
    }
  }

  bass(t, f, dur, vol = 0.16, type = 'triangle') {
    if (!this.bassOn) return;
    const lp = this.filter('lowpass', 500);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    lp.connect(g).connect(this.bus.bass);
    this.osc(type, f, t, t + dur + 0.1, lp);
    this.osc('sine', f / 2, t, t + dur + 0.1, lp);
  }

  kick(t, dest = this.bus.drum, vol = 0.5) {
    if (dest === this.bus.drum && !this.drumsOn) return;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, vol, 0.22);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  noise(t, dur, type, freq, vol, dest, q = 1) {
    if (dest === this.bus.drum && !this.drumsOn) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.audio.noise;
    src.loop = dur > 1.5;
    const f = this.filter(type, freq, q);
    const g = this.ctx.createGain();
    this.env(g, t, Math.min(0.3, dur * 0.3) * (dur > 1.5 ? 1 : 0.01), vol, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  snare(t, vol = 0.22) {
    if (!this.drumsOn) return;
    this.noise(t, 0.16, 'bandpass', 1800, vol, this.bus.drum);
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, vol * 0.55, 0.08);
    g.connect(this.bus.drum);
    this.osc('triangle', 190, t, t + 0.12, g);
  }

  hat(t, vol) {
    this.noise(t, 0.04, 'highpass', 7500, vol, this.bus.drum);
  }

  tom(t, f, dest = this.bus.drum, vol = 0.25) {
    if (dest === this.bus.drum && !this.drumsOn) return;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, vol, 0.22);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  }

  // big low drum with a slap on top
  taiko(t, vol = 0.6) {
    this.tom(t, 85, this.bus.drum, vol);
    this.noise(t, 0.08, 'lowpass', 900, vol * 0.4, this.bus.drum);
  }

  crash(t, dur = 1.3, vol = 0.1) {
    this.noise(t, dur, 'highpass', 4500, vol, this.bus.drum);
  }

  // metal hit: a ringing noise band and a short square
  clank(t, vol) {
    if (!this.drumsOn) return;
    this.noise(t, 0.18, 'bandpass', 2900, vol, this.bus.drum, 14);
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, vol * 0.3, 0.06);
    g.connect(this.bus.drum);
    this.osc('square', 1730, t, t + 0.08, g);
  }

  // the moment a boss arrives: a low boom, a dissonant brass cluster and a crash
  sting(t) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, 0.7, 1.6);
    o.connect(g).connect(this.bus.drum);
    o.start(t);
    o.stop(t + 1.7);
    const r = this.def.root;
    for (const n of [r, r + 1, r + 6, r + 12]) this.horn(t, mtof(n), 1.6, 0.05, this.bus.boss);
    this.crash(t, 2, 0.16);
  }
}

// one function per style: (step in bar, bar, time, step length, chord degrees, intensity)
const STYLES = {
  menu(s, bar, t, sd, chord, I) {
    if (s === 0) {
      for (const d of chord) this.pad(t, mtof(this.deg(d)), sd * 16, false);
      this.pad(t, mtof(this.deg(chord[0]) - 12), sd * 16, false);
    }
    const arpEvery = I >= 1 ? 1 : 2;
    if (s % arpEvery === 0) {
      const idx = [0, 1, 2, 3, 2, 1][(s / arpEvery) % 6];
      const midi = idx === 3 ? this.deg(chord[0] + 7) : this.deg(chord[idx]);
      this.pluck(t, mtof(midi + 12), I >= 1 ? 0.07 : 0.09);
    }
    this.melody(s, bar, t, sd, I < 1, (tt, f, dur) => this.flute(tt, f, dur * 0.95, I >= 1 ? 0.11 : 0.09));
    const root = mtof(this.deg(chord[0]) - 12);
    if ([0, 6, 8, 14].includes(s)) this.bass(t, s === 14 ? root * 1.5 : root, sd * 1.8);
    if (s === 0 || s === 8 || (s === 10 && bar % 2)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.08);
  },

  // sunny countryside: rolling banjo, a whistled tune, boom-chick bass and a shaker
  farm(s, bar, t, sd, chord, I) {
    if (s === 0) for (const d of chord) this.pad(t, mtof(this.deg(d)), sd * 16, false);
    if (s % (I >= 1 ? 1 : 2) === 0) {
      const idx = [0, 1, 2, 1][s % 4];
      this.banjo(t, mtof(this.deg(chord[idx] + 7)), I >= 1 ? 0.07 : 0.08);
    }
    this.melody(s, bar, t, sd, I < 1, (tt, f, dur) => this.flute(tt, f * 2, dur * 0.9, 0.085, 6.5));
    const root = mtof(this.deg(chord[0]) - 12);
    if (s === 0 || s === 8) this.bass(t, s === 8 ? mtof(this.deg(chord[0] + 4) - 12) : root, sd * 3);
    if (s === 0 || s === 8) this.kick(t, this.bus.drum, 0.35);
    if (s === 4 || s === 12) this.snare(t, 0.12);
    if (s % 4 === 2) this.noise(t, 0.06, 'bandpass', 6000, 0.12, this.bus.arp);
  },

  // rainy night city: swung electric piano comping, muted trumpet, walking bass, brushes
  city(s, bar, t, sd, chord, I) {
    const st = t + (s % 4 === 2 ? sd * 0.35 : 0); // swing the off-beat 8ths
    if (s === 0 || s === 6) for (const d of chord) this.epiano(st, mtof(this.deg(d)), sd * (s ? 10 : 6), 0.06);
    if (s === 0) {
      this.epiano(t, mtof(this.deg(chord[0]) - 12), sd * 16, 0.05);
      for (const d of chord) this.pad(t, mtof(this.deg(d) - 12), sd * 16, false);
    }
    this.melody(s, bar, st, sd, I < 1, (tt, f, dur) => this.trumpet(tt, f, dur * 0.85, 0.075));
    if (s % 4 === 0) {
      // walking bass: root, third, fifth, then a half-step into the next bar's root
      const next = this.deg(this.chordDegrees(bar + 1)[0]) - 24;
      const notes = [this.deg(chord[0]) - 24, this.deg(chord[1]) - 24, this.deg(chord[2]) - 24, next - 1];
      this.bass(t, mtof(notes[s / 4]), sd * 3.6, 0.15, 'sine');
    }
    if (s === 4 || s === 12) this.noise(t, 0.28, 'lowpass', 2600, 0.09, this.bus.drum);
    if (s === 0 || s === 10) this.kick(t, this.bus.drum, 0.3);
    if (s % 2 === 0) this.noise(st, 0.12, 'highpass', 6500, s % 4 ? 0.05 : 0.07, this.bus.drum);
  },

  // military base: a string ostinato, horn melody, snare rolls and timpani
  fort(s, bar, t, sd, chord, I) {
    if (s % 2 === 0) {
      const r = this.deg(chord[0]) - 12;
      this.strings(t, mtof(r + [0, 0, 7, 12][(s / 2) % 4]), sd * 1.5, 0.045);
    }
    if (s === 0) this.pad(t, mtof(this.deg(chord[0])), sd * 16, false);
    this.melody(s, bar, t, sd, I < 1, (tt, f, dur) => this.horn(tt, f, dur * 0.9, 0.07));
    if (s === 0 || (s === 8 && bar % 2)) this.tom(t, 110, this.bus.drum, 0.4);
    if (s === 0 || s === 8) this.kick(t, this.bus.drum, 0.4);
    if (s === 4 || s === 12) this.snare(t, 0.24);
    if (bar % 2 === 1 && s >= 13) {
      this.snare(t, 0.1);
      this.snare(t + sd / 2, 0.12);
    }
    if (s % 2 === 1) this.noise(t, 0.03, 'bandpass', 3500, 0.05, this.bus.drum);
    if (s === 0) this.bass(t, mtof(this.deg(chord[0]) - 24), sd * 7, 0.14);
  },

  // frozen and alone: glass bells, wind, a high voice, a slow pulse
  ice(s, bar, t, sd, chord, I) {
    if ([0, 3, 6, 10].includes(s)) {
      const idx = [0, 2, 1, 2][[0, 3, 6, 10].indexOf(s)];
      this.bell(t, mtof(this.deg(chord[idx] + 14)), 0.045);
    }
    if (s === 0) {
      for (const d of chord) this.pad(t, mtof(this.deg(d)), sd * 16, false);
      if (bar % 2 === 0) this.noise(t, sd * 30, 'bandpass', 700, 0.035, this.bus.pad, 0.7);
    }
    this.melody(s, bar, t, sd, true, (tt, f, dur) => this.flute(tt, f * 2, dur, 0.05, 4));
    if (s === 0) this.bass(t, mtof(this.deg(chord[0]) - 24), sd * 14, 0.14, 'sine');
    if (s === 0 || s === 10) this.kick(t, this.bus.drum, 0.3);
    if (s === 8) this.snare(t, 0.1);
    if (s % 4 === 2) this.hat(t, 0.05);
  },

  // the lab: a drone, a filtered synth pulse, metal clanks and a four-on-the-floor kick
  lab(s, bar, t, sd, chord, I) {
    if (s === 0 && bar % 2 === 0) {
      const r = this.deg(chord[0]) - 12;
      for (const n of [r, r + 7]) this.strings(t, mtof(n), sd * 32, 0.065, 520);
    }
    if (s % (I >= 1 ? 1 : 2) === 0) {
      const idx = [0, 1, 2, 1, 2, 0, 1, 2][(s / (I >= 1 ? 1 : 2)) % 8];
      const sweep = 700 + 1500 * (0.5 + 0.5 * Math.sin(((bar % 4) * 16 + s) / 10));
      this.synth(t, mtof(this.deg(chord[idx]) + (s % 4 === 3 ? 12 : 0)), 0.055, sweep);
    }
    this.melody(s, bar, t, sd, I < 1, (tt, f, dur) => this.trumpet(tt, f, dur * 0.8, 0.065));
    if (s % 4 === 0) this.kick(t, this.bus.drum, 0.45);
    if (s === 4 || s === 12) this.clank(t, 0.12);
    if (s === 6 || s === 14) this.clank(t, 0.06);
    if (s % 4 === 2) this.hat(t, 0.1);
    if (s % 2 === 0) this.bass(t, mtof(this.deg(chord[0]) - 24), sd * 1.6, 0.13, 'sawtooth');
  },

  // every boss fight: relentless strings, taiko, brass stabs, a choir and an alarm line
  boss(s, bar, t, sd, chord) {
    const root = this.deg(chord[0]);
    this.strings(t, mtof(root + OSTINATO[s]), sd * 0.8, 0.05, 1700);
    if (s === 0) {
      this.choir(t, mtof(root + 12), sd * 16, 0.03);
      this.choir(t, mtof(root + 15), sd * 16, 0.024);
    }
    if (s === 0 || s === 6 || (s === 10 && bar % 2)) for (const n of [0, 3, 7]) this.horn(t, mtof(root + n), sd * 2, 0.055, this.bus.boss);
    if (bar % 4 === 3) {
      // an alarm: falling half-steps up high
      if (s % 4 === 0) this.trumpet(t, mtof(root + 24 - s / 4), sd * 3.5, 0.045);
    } else this.melody(s, bar, t, sd, false, (tt, f, dur) => this.horn(tt, f, dur * 0.9, 0.045));
    if ([0, 3, 6, 8, 11, 14].includes(s)) this.taiko(t, 0.75);
    if (bar % 4 === 3 && s >= 12) this.tom(t, 180 - (s - 12) * 25, this.bus.drum, 0.35);
    if (s === 4 || s === 12) this.snare(t, 0.3);
    if (s % 2 === 0) this.hat(t, s % 4 ? 0.07 : 0.12);
    if (s === 0 && bar % 2 === 0) this.crash(t);
    if (s % 2 === 0) this.bass(t, mtof(root - 12), sd * 1.7, 0.16, 'sawtooth');
  },
};
