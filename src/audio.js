import { Music } from './music.js';
// Procedural sound effects + ambient music using WebAudio (no audio files).
export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.4 };
    this.listener = { x: 0, z: 0 };
    this.lastPlay = new Map();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    const comp = this.ctx.createDynamicsCompressor();
    this.sfxBus.disconnect();
    this.sfxBus.connect(comp);
    comp.connect(this.master);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfxBus.gain.value = this.vol.sfx;
    this.musicBus.gain.value = this.vol.music * 0.5;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ------------------------------------------------------------ primitives
  env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  noiseHit(out, t, { dur = 0.2, peak = 0.5, type = 'bandpass', freq = 1200, q = 1, freqEnd, attack = 0.002 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + attack + 0.05);
  }

  tone(out, t, { type = 'sine', freq = 440, freqEnd, dur = 0.2, peak = 0.3, attack = 0.005, detune = 0 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    o.detune.value = detune;
    const g = this.ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------ public
  play(name, x, z, vol = 1) {
    if (!this.ctx) return;
    // distance attenuation
    let gain = vol;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.listener.x, z - this.listener.z);
      gain *= Math.max(0, 1 - d / 40);
      if (gain < 0.02) return;
    }
    // throttle identical sounds
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) || 0;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);
    const out = this.ctx.createGain();
    out.gain.value = gain;
    out.connect(this.sfxBus);
    const t = now + 0.005;
    const fn = SOUNDS[name];
    if (fn) fn(this, out, t);
    setTimeout(() => out.disconnect(), 4000);
  }

  // ------------------------------------------------------------ music
  startMusic(song = 'menu') {
    if (!this.ctx) return;
    if (this.music && this.music.song === song) return;
    this.stopMusic();
    this.music = new Music(this, song);
  }

  stopMusic() {
    if (this.music) this.music.stop();
    this.music = null;
  }

  // 0 explore, 1 combat, 2 a boss is on the map. Every boss fight switches to the same battle
  // music, which stays a few seconds after the last boss falls, then the map's song comes back.
  setIntensity(level) {
    const m = this.music;
    if (!m) return;
    const now = this.ctx.currentTime;
    if (level >= 2) this.battleUntil = now + 6;
    const battle = level >= 2 || (m.song === 'boss' && now < this.battleUntil);
    if (battle && m.song !== 'boss') {
      this.areaSong = m.song;
      this.startMusic('boss');
    } else if (!battle && m.song === 'boss') {
      this.startMusic(this.areaSong || 'menu');
    }
    this.music.setIntensity(level);
  }
}

const SOUNDS = {
  pistol: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.12, peak: 0.6, freq: 1600, q: 0.8 });
    a.tone(o, t, { freq: 160, freqEnd: 60, dur: 0.1, peak: 0.5 });
  },
  revolver: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.25, peak: 0.8, freq: 1000, q: 0.6 });
    a.tone(o, t, { freq: 120, freqEnd: 40, dur: 0.2, peak: 0.7 });
  },
  smg: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.07, peak: 0.45, freq: 2200, q: 0.9 });
    a.tone(o, t, { freq: 180, freqEnd: 80, dur: 0.06, peak: 0.3 });
  },
  rifle: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.1, peak: 0.55, freq: 1800, q: 0.7 });
    a.tone(o, t, { freq: 140, freqEnd: 50, dur: 0.1, peak: 0.45 });
  },
  shotgun: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.35, peak: 0.9, type: 'lowpass', freq: 2500, freqEnd: 300 });
    a.tone(o, t, { freq: 100, freqEnd: 35, dur: 0.25, peak: 0.8 });
    a.noiseHit(o, t + 0.35, { dur: 0.05, peak: 0.2, freq: 3000 });
    a.noiseHit(o, t + 0.45, { dur: 0.05, peak: 0.2, freq: 2500 });
  },
  sniper: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.5, peak: 1, type: 'lowpass', freq: 4000, freqEnd: 200 });
    a.tone(o, t, { freq: 90, freqEnd: 30, dur: 0.4, peak: 0.9 });
  },
  thump: (a, o, t) => {
    a.tone(o, t, { freq: 220, freqEnd: 60, dur: 0.18, peak: 0.6 });
    a.noiseHit(o, t, { dur: 0.1, peak: 0.3, type: 'lowpass', freq: 800 });
  },
  flame: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.12, peak: 0.25, type: 'lowpass', freq: 700, q: 0.5 });
  },
  ray: (a, o, t) => {
    a.tone(o, t, { type: 'square', freq: 1400, freqEnd: 250, dur: 0.18, peak: 0.18 });
    a.tone(o, t, { type: 'sine', freq: 700, freqEnd: 120, dur: 0.2, peak: 0.25 });
  },
  zap: (a, o, t) => {
    for (let i = 0; i < 5; i++) a.tone(o, t + i * 0.03, { type: 'sawtooth', freq: 200 + Math.random() * 1200, dur: 0.05, peak: 0.15 });
    a.noiseHit(o, t, { dur: 0.25, peak: 0.35, freq: 4000, q: 0.5 });
  },
  boom: (a, o, t) => {
    a.noiseHit(o, t, { dur: 1.2, peak: 1, type: 'lowpass', freq: 1200, freqEnd: 60, q: 0.5 });
    a.tone(o, t, { freq: 70, freqEnd: 25, dur: 0.8, peak: 1 });
  },
  reload: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.04, peak: 0.3, freq: 3500, q: 3 });
    a.noiseHit(o, t + 0.25, { dur: 0.05, peak: 0.35, freq: 2500, q: 3 });
  },
  empty: (a, o, t) => a.noiseHit(o, t, { dur: 0.03, peak: 0.3, freq: 4000, q: 4 }),
  swap: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.05, peak: 0.25, freq: 2000, q: 2 });
    a.noiseHit(o, t + 0.12, { dur: 0.04, peak: 0.25, freq: 3000, q: 2 });
  },
  hit: (a, o, t) => a.noiseHit(o, t, { dur: 0.08, peak: 0.35, type: 'lowpass', freq: 500 }),
  die: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 130 + Math.random() * 40, freqEnd: 50, dur: 0.5, peak: 0.18 });
    a.noiseHit(o, t, { dur: 0.15, peak: 0.3, type: 'lowpass', freq: 400 });
  },
  groan: (a, o, t) => {
    const f = 80 + Math.random() * 50;
    a.tone(o, t, { type: 'sawtooth', freq: f, freqEnd: f * 0.7, dur: 0.9, peak: 0.1, attack: 0.15 });
    a.tone(o, t, { type: 'sawtooth', freq: f * 1.5, freqEnd: f, dur: 0.8, peak: 0.05, attack: 0.2 });
  },
  spawn: (a, o, t) => a.noiseHit(o, t, { dur: 0.7, peak: 0.35, type: 'lowpass', freq: 250, attack: 0.1 }),
  hurt: (a, o, t) => {
    a.tone(o, t, { type: 'triangle', freq: 320, freqEnd: 140, dur: 0.2, peak: 0.35 });
    a.noiseHit(o, t, { dur: 0.1, peak: 0.3, type: 'lowpass', freq: 600 });
  },
  buy: (a, o, t) => {
    a.tone(o, t, { type: 'square', freq: 1320, dur: 0.08, peak: 0.12 });
    a.tone(o, t + 0.08, { type: 'square', freq: 1760, dur: 0.2, peak: 0.12 });
  },
  nope: (a, o, t) => a.tone(o, t, { type: 'square', freq: 110, dur: 0.18, peak: 0.15 }),
  pickup: (a, o, t) => {
    [523, 659, 784].forEach((f, i) => a.tone(o, t + i * 0.06, { type: 'triangle', freq: f, dur: 0.12, peak: 0.2 }));
  },
  item: (a, o, t) => {
    [784, 988, 1175, 1568].forEach((f, i) => a.tone(o, t + i * 0.08, { type: 'sine', freq: f, dur: 0.3, peak: 0.25 }));
  },
  perk: (a, o, t) => {
    [392, 494, 587, 784, 587, 784].forEach((f, i) => a.tone(o, t + i * 0.11, { type: 'square', freq: f, dur: 0.12, peak: 0.1 }));
    a.noiseHit(o, t + 0.7, { dur: 0.3, peak: 0.2, type: 'highpass', freq: 3000 });
  },
  box: (a, o, t) => {
    for (let i = 0; i < 18; i++) a.tone(o, t + i * 0.16, { type: 'sine', freq: [523, 587, 659, 784, 880, 1047][Math.floor(Math.random() * 6)], dur: 0.25, peak: 0.12 });
  },
  boxmove: (a, o, t) => {
    for (let i = 0; i < 4; i++) a.tone(o, t + i * 0.2, { type: 'sawtooth', freq: 220 - i * 30, dur: 0.18, peak: 0.12 });
  },
  done: (a, o, t) => {
    [523, 659, 784, 1047].forEach((f) => a.tone(o, t, { type: 'triangle', freq: f, dur: 0.8, peak: 0.12 }));
  },
  wave: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 55, dur: 2.5, peak: 0.25, attack: 0.3 });
    a.tone(o, t, { type: 'sawtooth', freq: 58.3, dur: 2.5, peak: 0.25, attack: 0.3 });
    a.tone(o, t + 0.2, { type: 'sine', freq: 220, dur: 2.5, peak: 0.2 });
    a.tone(o, t + 0.2, { type: 'sine', freq: 262, dur: 2.5, peak: 0.15 });
  },
  waveEnd: (a, o, t) => {
    a.tone(o, t, { type: 'sine', freq: 330, dur: 1.5, peak: 0.15 });
    a.tone(o, t + 0.25, { type: 'sine', freq: 262, dur: 1.5, peak: 0.15 });
    a.tone(o, t + 0.5, { type: 'sine', freq: 220, dur: 2, peak: 0.15 });
  },
  roar: (a, o, t) => {
    a.noiseHit(o, t, { dur: 1.4, peak: 0.8, type: 'bandpass', freq: 400, freqEnd: 150, q: 1.5, attack: 0.1 });
    a.tone(o, t, { type: 'sawtooth', freq: 90, freqEnd: 50, dur: 1.3, peak: 0.4, attack: 0.1 });
  },
  build: (a, o, t) => {
    for (let i = 0; i < 3; i++) a.noiseHit(o, t + i * 0.12, { dur: 0.06, peak: 0.5, type: 'lowpass', freq: 900 });
  },
  turret: (a, o, t) => a.noiseHit(o, t, { dur: 0.05, peak: 0.25, freq: 2500 }),
  heal: (a, o, t) => {
    a.tone(o, t, { type: 'sine', freq: 400, freqEnd: 1200, dur: 0.6, peak: 0.25 });
    a.tone(o, t + 0.1, { type: 'sine', freq: 600, freqEnd: 1600, dur: 0.6, peak: 0.15 });
  },
  strike: (a, o, t) => a.tone(o, t, { type: 'sine', freq: 1800, freqEnd: 400, dur: 1.0, peak: 0.2 }),
  power: (a, o, t) => {
    [659, 880, 1319].forEach((f, i) => a.tone(o, t + i * 0.1, { type: 'square', freq: f, dur: 0.3, peak: 0.12 }));
  },
  throw: (a, o, t) => a.noiseHit(o, t, { dur: 0.25, peak: 0.2, freq: 900, freqEnd: 400 }),
  spit: (a, o, t) => a.noiseHit(o, t, { dur: 0.2, peak: 0.4, type: 'lowpass', freq: 900, freqEnd: 300 }),
  rocket: (a, o, t) => a.noiseHit(o, t, { dur: 0.5, peak: 0.4, type: 'bandpass', freq: 600, freqEnd: 1500 }),
  melee: (a, o, t) => a.noiseHit(o, t, { dur: 0.15, peak: 0.3, freq: 1500, freqEnd: 600, q: 2 }),
  work: (a, o, t) => a.noiseHit(o, t, { dur: 0.04, peak: 0.25, freq: 3000, q: 5 }),
  forgestart: (a, o, t) => {
    for (let i = 0; i < 4; i++) a.tone(o, t + i * 0.45, { type: 'square', freq: 880 + Math.random() * 300, dur: 0.15, peak: 0.12 });
  },
  forge: (a, o, t) => {
    [523, 784, 1047, 1568].forEach((f, i) => a.tone(o, t + i * 0.07, { type: 'sawtooth', freq: f, dur: 0.4, peak: 0.08 }));
  },
  down: (a, o, t) => a.tone(o, t, { type: 'sawtooth', freq: 300, freqEnd: 60, dur: 1.2, peak: 0.25 }),
  slam: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.6, peak: 0.9, type: 'lowpass', freq: 500, freqEnd: 60 });
    a.tone(o, t, { freq: 60, freqEnd: 25, dur: 0.5, peak: 0.8 });
  },
  door: (a, o, t) => a.noiseHit(o, t, { dur: 0.9, peak: 0.6, type: 'lowpass', freq: 700, freqEnd: 100 }),
  blink: (a, o, t) => a.tone(o, t, { type: 'sine', freq: 200, freqEnd: 1600, dur: 0.25, peak: 0.15 }),
  levelup: (a, o, t) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => a.tone(o, t + i * 0.07, { type: 'triangle', freq: f, dur: 0.5, peak: 0.16 }));
  },
  open: (a, o, t) => {
    a.noiseHit(o, t, { dur: 0.12, peak: 0.3, type: 'lowpass', freq: 900 });
    a.tone(o, t + 0.08, { type: 'triangle', freq: 880, dur: 0.18, peak: 0.12 });
  },
  rare: (a, o, t) => {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => a.tone(o, t + i * 0.06, { type: 'sine', freq: f, dur: 0.6, peak: 0.14 }));
  },
};
