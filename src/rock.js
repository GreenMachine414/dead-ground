// Procedural heavy rock for the finale cutscene: distorted power-chord guitar (open and palm
// muted), bass, a driving kit and a lead line, all synthesized (no audio files). The cutscene
// switches sections on its timeline; each switch starts a fresh bar.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 152, STEP = 60 / BPM / 4; // 16th notes

// per section: chord roots (one per bar, midi) and 16-step patterns.
// gtr: c open power chord, m palm-muted chug; drums: x hit
const SECTIONS = {
  intro: { roots: [40], gtr: 'm-m-m-m-m-m-mmmm', kick: 'x---x---x---x---', snare: '----------------', hat: '--x---x---x---x-' },
  drive: { roots: [40, 40, 36, 38], gtr: 'c--mm-mmc--mm-m-', kick: 'x--x--x-x--x--x-', snare: '----x-------x---', hat: 'x-x-x-x-x-x-x-x-', bass: 2, crash: 4 },
  anthem: { roots: [43, 38, 40, 36], gtr: 'c-------c---c-c-', kick: 'x-----x-x-x-----', snare: '--------x-------', hat: 'x---x---x---x---', bass: 4, crash: 4, lead: true },
  rest: null,
};
// the anthem's lead: [step, semitones above the bar's root, length in steps]
const LEAD = [[0, 24, 4], [4, 26, 2], [6, 31, 6], [12, 29, 4]];

let curve = null; // distortion curve, built once
function driveCurve() {
  if (curve) return curve;
  curve = new Float32Array(2048);
  const k = 60;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class Rock {
  constructor(audio) {
    const ctx = (this.ctx = audio.ctx);
    this.noise = audio.noise;
    // the cutscene's own mix: it plays whatever the music slider says (even off), straight into
    // the master volume, as loud against the effects as in the recorded finale, through a
    // limiter so it never clips
    const level = 0.72 * Math.max(1, audio.vol.sfx / 0.6);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.linearRampToValueAtTime(level, ctx.currentTime + 1.5);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 4;
    lim.ratio.value = 20;
    lim.attack.value = 0.003;
    lim.release.value = 0.15;
    this.out.connect(lim).connect(audio.master);
    // guitar: notes -> drive -> tone shaping; palm mutes get a darker filter
    const amp = (lp) => {
      const inp = ctx.createGain();
      const sh = ctx.createWaveShaper();
      sh.curve = driveCurve();
      sh.oversample = '2x';
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 90;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.value = 0.16;
      inp.connect(sh).connect(hp).connect(f).connect(g).connect(this.out);
      return inp;
    };
    this.gtr = amp(3600);
    this.mute = amp(1100);
    this.lead = amp(5000);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.75;
    this.drums.connect(this.out);
    this.sec = null;
    this.g = null;
    this.timer = setInterval(() => this.tick(), 40);
  }

  // each section's notes go through their own gates, so notes already scheduled ahead for the
  // old section are cut when a new one starts
  gates(t) {
    const old = this.g;
    if (old) {
      for (const n of Object.values(old)) n.gain.setTargetAtTime(0, t, 0.01);
      setTimeout(() => Object.values(old).forEach((n) => n.disconnect()), 1500);
    }
    const gate = (dest) => {
      const n = this.ctx.createGain();
      n.connect(dest);
      return n;
    };
    this.g = { gtr: gate(this.gtr), mute: gate(this.mute), lead: gate(this.lead), drums: gate(this.drums), out: gate(this.out) };
  }

  set(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.03;
    this.gates(t);
    if (name === 'hit') {
      // a huge open chord and crash, then let it ring
      this.chord(t, 40, 2.6, false, 1.2);
      this.kick(t);
      this.crash(t, 2.2);
      name = 'rest';
    }
    this.sec = SECTIONS[name];
    this.step = 0;
    this.next = t;
  }

  tick() {
    const ctx = this.ctx;
    if (!this.sec) return;
    if (this.next < ctx.currentTime) {
      const missed = Math.ceil((ctx.currentTime - this.next) / STEP);
      this.next += missed * STEP;
      this.step += missed;
    }
    while (this.next < ctx.currentTime + 0.3) {
      this.play(this.sec, this.step, this.next);
      this.next += STEP;
      this.step++;
    }
  }

  play(s, step, t) {
    const i = step % 16, bar = Math.floor(step / 16);
    const root = s.roots[bar % s.roots.length];
    const g = s.gtr[i];
    if (g === 'c') this.chord(t, root, STEP * (s.lead ? 7 : 2.6), false, 1);
    else if (g === 'm') this.chord(t, root, STEP * 0.9, true, 0.9);
    if (s.kick[i] === 'x') this.kick(t);
    if (s.snare[i] === 'x') this.snare(t);
    if (s.hat[i] === 'x') this.hat(t, i % 4 === 0 ? 0.3 : 0.18);
    if (s.crash && i === 0 && bar % s.crash === 0) this.crash(t, 1.6);
    if (s.bass && i % s.bass === 0) this.bass(t, root - 12, STEP * s.bass * 0.9);
    if (s.lead) for (const [at, iv, len] of LEAD) if (at === i) this.leadNote(t, root + iv, STEP * len);
  }

  env(g, t, peak, dur, release = 0.08) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.setValueAtTime(peak, t + Math.max(0.01, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
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

  // power chord: root, fifth and octave, double-tracked (detuned) for width
  chord(t, root, dur, muted, vol) {
    const g = this.ctx.createGain();
    this.env(g, t, 0.5 * vol, dur, muted ? 0.05 : 0.25);
    g.connect(muted ? this.g.mute : this.g.gtr);
    for (const [iv, det] of [[0, -7], [0, 7], [7, 0], [12, 4]]) this.osc('sawtooth', mtof(root + iv), t, t + dur + 0.05, g, det);
  }

  leadNote(t, note, dur) {
    const g = this.ctx.createGain();
    this.env(g, t, 0.32, dur, 0.15);
    g.connect(this.g.lead);
    const o = this.osc('square', mtof(note), t, t + dur + 0.05, g);
    // a little vibrato once the note has settled
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(14, t + Math.min(dur, 0.3));
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  bass(t, note, dur) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    const g = this.ctx.createGain();
    this.env(g, t, 0.55, dur, 0.04);
    f.connect(g).connect(this.g.out);
    this.osc('sawtooth', mtof(note), t, t + dur + 0.02, f);
    this.osc('sine', mtof(note - 12), t, t + dur + 0.02, g);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.g.drums);
    o.start(t);
    o.stop(t + 0.32);
    this.noiseHit(t, 0.02, 'highpass', 3000, 0.25);
  }

  snare(t) {
    this.noiseHit(t, 0.2, 'bandpass', 1900, 0.85, 0.7);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.g.drums);
    o.start(t);
    o.stop(t + 0.14);
  }

  hat(t, vol) {
    this.noiseHit(t, 0.045, 'highpass', 7500, vol);
  }

  crash(t, dur) {
    this.noiseHit(t, dur, 'highpass', 4200, 0.4);
  }

  noiseHit(t, dur, type, freq, peak, q = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.g.drums);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  stop(fade = 1.2) {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const g = this.out.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => this.out.disconnect(), fade * 1000 + 3000);
  }
}
