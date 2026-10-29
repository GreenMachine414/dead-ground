// Advertisement video, only runs when Electron is launched with --trailer (npm run trailer).
// Plays scripted scenes with bot players, adds captions, and records the window plus the
// game's own audio (not the speakers) to release/Dead Ground Trailer.mp4.
import { hasLOS, clearPath, circleBlocked } from './game/physics.js';
import { CHARACTERS } from './data/characters.js';
import { playFinale } from './finale.js';
import { hex } from './render/sprites.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FADE = 250; // ms, matches the .tr-fade transition
const STEP = 1 / 60;
// wave: the endless round each scene plays (the game's own spawns); near: zombies 4-14
// units before the scene starts, fast-forwarded behind the fade so it opens mid-fight.
// showcase: each survivor fires their ability in turn; extract: the helicopter finale.
// forge: a gun finishing in the Weapon Forge, collected mid-fight once it's ready.
// calm: during the fast-forward, only zombies closer than this get shot (default 7).
const SCENES = [
  { map: 1, chars: ['brick'], guns: [['shotgun', 0, 1]], zoom: 1.1, wave: 13, near: 7, secs: 6, cap: 'The dead are rising.', title: true },
  { map: 2, chars: ['sparks', 'brick', 'doc', 'volt'], guns: [['ar', 0, 1]], zoom: 0.85, wave: 8, near: 12, calm: 2.5, secs: 5, cap: 'Play solo or with up to 3 friends' },
  { map: 3, chars: ['rook'], guns: [['tesla', 2, 4]], forge: ['minigun', 2, 4], zoom: 1.4, wave: 14, near: 9, secs: 6.5, cap: 'Forge your guns all the way to XX' },
  { map: 4, chars: ['volt', 'sparks'], guns: [['lmg', 0, 2]], zoom: 1, wave: 10, near: 6, boss: true, secs: 5.5, cap: 'Take down monstrous bosses' },
  { map: 5, chars: ['volt', 'rook', 'sparks', 'brick'], guns: [['ar', 1, 2]], zoom: 0.8, wave: 11, near: 12, calm: 2.5, secs: 6.5, cap: 'Every survivor has a special ability', showcase: true },
  { map: 1, chars: ['rook', 'doc', 'mags', 'brick'], guns: [['lmg', 0, 2]], zoom: 0.75, wave: 4, near: 4, cap: 'Make it to the extraction', extract: true },
];
const TEAM_GUNS = [['smg', 0, 1], ['shotgun', 0, 0], ['ar', 0, 1]];
const END_SECS = 4.5;
const JINGLES = new Set(['wave', 'waveEnd', 'levelup', 'done', 'perk', 'power', 'pickup', 'item', 'rare', 'buy', 'box', 'boxmove', 'open', 'forge', 'forgestart']);

const CSS = `
#trailer { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
#trailer .tr-sky { position: absolute; inset: 0; width: 100%; height: 100%; }
#trailer .tr-fade { position: absolute; inset: 0; background: #0b0806; opacity: 1; transition: opacity ${FADE}ms ease; }
#trailer .tr-dim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, rgba(20, 12, 8, 0.2), rgba(12, 8, 5, 0.78)); opacity: 0; transition: opacity 0.6s ease; }
#trailer .tr-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  opacity: 0; transform: scale(0.94); transition: opacity 0.5s ease, transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1); }
#trailer .tr-card.show, #trailer .tr-cap.show, #trailer .tr-dim.show, #trailer .tr-chip.show { opacity: 1; transform: none; }
#trailer .title { font-size: 150px; }
#trailer .tr-tag { font-family: var(--display); font-weight: 600; font-size: 34px; color: var(--parch); text-shadow: 0 3px 0 var(--edge), 0 0 24px rgba(0, 0, 0, 0.7); }
#trailer .tr-facts { font-family: var(--display); font-weight: 600; font-size: 26px; color: var(--gold); padding: 10px 26px; border-radius: 40px;
  background: rgba(36, 23, 15, 0.8); border: 3px solid var(--edge); }
#trailer .tr-cap { position: absolute; left: 0; right: 0; bottom: 9%; text-align: center; font-family: var(--display); font-weight: 700; font-size: 60px;
  color: var(--cream); opacity: 0; transform: translateY(24px); transition: opacity 0.45s ease, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  text-shadow: 3px 0 0 var(--edge), -3px 0 0 var(--edge), 0 3px 0 var(--edge), 0 -3px 0 var(--edge), 0 7px 0 var(--edge), 0 10px 26px rgba(0, 0, 0, 0.6); }
#trailer .tr-chips { position: absolute; left: 56px; top: 56px; display: flex; flex-direction: column; gap: 12px; }
#trailer .tr-chip { display: flex; align-items: center; gap: 14px; padding: 10px 24px 10px 14px; border-radius: 40px; background: rgba(36, 23, 15, 0.85);
  border: 3px solid var(--edge); font-family: var(--display); font-weight: 600; font-size: 30px; color: var(--cream);
  opacity: 0; transform: translateX(-30px); transition: opacity 0.35s ease, transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
#trailer .tr-chip i { width: 26px; height: 26px; border-radius: 50%; border: 3px solid var(--edge); }
#trailer .tr-chip b { color: var(--gold); font-weight: 700; }
`;

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (t) => t * t * (3 - 2 * t);

// A bot that plays like a person: it turns its aim toward a target instead of snapping, takes a
// moment before firing at a new one, only shoots what it can see, in bursts with a little sway,
// prefers targets in front of it, and steers smoothly around an area (or toward a goal) while
// backing off from anything too close.
class Survivor {
  constructor(g, p, leader) {
    this.g = g;
    this.p = p;
    this.leader = leader; // teammates roam around the camera player
    this.goal = null; // somewhere to head for instead of roaming (the helicopter)
    this.aim = p.ang;
    this.mx = 0;
    this.mz = 0;
    this.tgt = null;
    this.pickT = 0;
    this.react = 0;
    this.burst = rand(0.6, 1.3);
    this.rest = 0;
    this.wp = null;
    this.wpT = 0;
    this.seed = Math.random() * 100;
    this.check = { x: p.x, z: p.z, t: 0.5 };
    this.side = Math.random() < 0.5 ? 1 : -1; // which way we turn around walls
    this.stuck = 0; // times we were caught on something (logged per scene)
    this.unstick = 0;
    this.streak = 0; // stuck checks in a row
    this.hold = 0; // standing our ground after getting boxed in
    this.t = 0;
  }

  pickTarget() {
    const p = this.p;
    let best = null, bs = Infinity;
    for (const z of this.g.zombies) {
      const d = Math.hypot(z.x - p.x, z.z - p.z);
      if (d > 15 || z.state === 'rise' || !hasLOS(this.g.world, p.x, p.z, z.x, z.z)) continue; // only what we can see
      // nearer is better, and so is what's already in front of us
      const s = d + Math.abs(wrap(Math.atan2(z.z - p.z, z.x - p.x) - this.aim)) * 2.5 - (z === this.tgt ? 2 : 0);
      if (s < bs) [best, bs] = [z, s];
    }
    if (best !== this.tgt) this.react = rand(0.15, 0.35);
    this.tgt = best;
  }

  // somewhere nearby we can walk to in a straight line (never the far side of a wall)
  newWaypoint() {
    if (this.goal) return (this.wp = this.goal);
    const c = this.leader || this.p, p = this.p, g = this.g;
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, d = rand(1.5, this.leader ? 3.5 : 6);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (clearPath(g.world, g.sgrid, p.x, p.z, x, z, p.r + 0.1)) return (this.wp = { x, z });
    }
    this.wp = null;
  }

  // the direction itself if it's clear, else the nearest clear one (turning the same way as last
  // time, so we slide around a corner instead of jittering against it)
  steer(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return [dx, dz];
    const p = this.p, g = this.g, a = Math.atan2(dz, dx);
    const free = (t) => !circleBlocked(g.world, g.sgrid, p.x + Math.cos(t) * 0.8, p.z + Math.sin(t) * 0.8, p.r);
    if (free(a)) return [dx, dz];
    for (const turn of [0.6, 1.2, 1.8, 2.5]) {
      for (const side of [this.side, -this.side]) {
        if (free(a + turn * side)) {
          this.side = side;
          return [Math.cos(a + turn * side) * len, Math.sin(a + turn * side) * len];
        }
      }
    }
    return [0, 0];
  }

  input(dt) {
    const p = this.p, g = this.g;
    this.t += dt;
    if ((this.pickT -= dt) <= 0 || (this.tgt && !g.zombies.includes(this.tgt))) {
      this.pickT = rand(0.35, 0.75);
      this.pickTarget();
    }
    // lost sight of it behind a wall: look for something else soon
    if (this.tgt && !hasLOS(g.world, p.x, p.z, this.tgt.x, this.tgt.z)) [this.tgt, this.pickT] = [null, rand(0.1, 0.25)];
    const z = this.tgt;
    this.react -= dt;

    // aim: ease toward the target with a capped turn speed, plus a small hand sway
    const dist = z ? Math.hypot(z.x - p.x, z.z - p.z) : 4;
    const sway = Math.sin(this.t * 1.7 + this.seed) * 0.05 + Math.sin(this.t * 4.1 + this.seed * 2) * 0.025;
    const want = z ? Math.atan2(z.z - p.z, z.x - p.x) : Math.atan2(this.mz, this.mx) || this.aim;
    const err = wrap(want + sway - this.aim);
    this.aim += Math.max(-7 * dt, Math.min(7 * dt, err * ease(z ? 9 : 4, dt)));

    // trigger: only once on target, in bursts
    let fire = false;
    if (z && this.react <= 0 && Math.abs(err) < 0.14 + 1 / Math.max(2, dist)) {
      if (this.rest > 0) this.rest -= dt;
      else if ((this.burst -= dt) <= 0) [this.burst, this.rest] = [rand(0.6, 1.4), rand(0.12, 0.35)];
      else fire = true;
    }

    // movement: roam between waypoints, back away from close zombies, keep spacing from teammates
    if ((this.wpT -= dt) <= 0 || !this.wp || Math.hypot(this.wp.x - p.x, this.wp.z - p.z) < 0.7) {
      this.wpT = rand(2, 4.5);
      this.newWaypoint();
    }
    let dx = 0, dz = 0;
    this.hold -= dt;
    if (this.wp && this.hold <= 0) {
      const d = Math.hypot(this.wp.x - p.x, this.wp.z - p.z) || 1;
      dx = ((this.wp.x - p.x) / d) * Math.min(1, d / 1.5);
      dz = ((this.wp.z - p.z) / d) * Math.min(1, d / 1.5);
    }
    this.unstick -= dt;
    // heading for the chopper or just unstuck: commit to the path instead of backing off
    const shy = this.goal ? 0.5 : this.unstick > 0 ? 0.4 : 1.8;
    let near = 0, closest = Infinity;
    for (const q of g.zombies) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 5 && d > 0.01) {
        const w = ((5 - d) / 5) * shy;
        dx += ((p.x - q.x) / d) * w;
        dz += ((p.z - q.z) / d) * w;
      }
      if (d < 6) near++;
      if (d < closest && q.state !== 'rise') closest = d;
    }
    for (const q of g.players) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (q !== p && q.state === 'alive' && d < 1.4 && d > 0.01) {
        dx += ((p.x - q.x) / d) * 0.8;
        dz += ((p.z - q.z) / d) * 0.8;
      }
    }
    const len = Math.hypot(dx, dz);
    const speed = fire ? 0.75 : 1; // people slow down a little while shooting
    if (len > 1) [dx, dz] = [dx / len, dz / len];
    [dx, dz] = this.steer(dx, dz);
    const k = ease(4, dt);
    this.mx += (dx * speed - this.mx) * k;
    this.mz += (dz * speed - this.mz) * k;
    [this.mx, this.mz] = this.steer(this.mx, this.mz); // the eased direction can't lean into a wall either
    // still stuck: go somewhere else, turning the other way; caught twice running (boxed in by
    // a barricade or a crowd), plant our feet and keep shooting for a moment, like holding cover
    if ((this.check.t -= dt) <= 0) {
      if (Math.hypot(p.x - this.check.x, p.z - this.check.z) < 0.25 && Math.hypot(dx, dz) > 0.3) {
        this.newWaypoint();
        this.side = -this.side;
        this.stuck++;
        this.unstick = 0.7;
        if (++this.streak >= 2) [this.hold, this.streak] = [rand(1, 2), 0];
      } else this.streak = 0;
      this.check = { x: p.x, z: p.z, t: 0.5 };
    }

    const acts = {};
    if (abilityReady(p) && near >= 4 && Math.random() < dt * 0.8) acts.ability = true;
    else if (closest < 1.3 && Math.random() < dt * 4) acts.melee = true; // one got too close: knife it
    else if (p.grenades > 0 && near >= 6 && Math.random() < dt * 0.06) acts.grenade = true;
    return { mx: this.mx, mz: this.mz, ax: p.x + Math.cos(this.aim) * dist, az: p.z + Math.sin(this.aim) * dist, fire, sprint: false, use: false, acts };
  }
}

const abilityReady = (p) => (p.char === 'brick' ? p.charges > 0 : p.abilityCd <= 0);

// ---------------------------------------------------------------- helicopter (extraction finale)
// Drawn over the game in the same hand-drawn style: olive body with a dark outline, glass
// cockpit, tail boom, skids and spinning rotors. alt 0 = on the ground, 1 = high up.
const HELI = { body: '#6f7d3c', dark: '#56632c', edge: '#24170f', glass: '#9fd3f0', stripe: '#f2e6c4' };

function drawHeli(c, X, Y, u, ang, rot, alt) {
  const lw = 0.11;
  const shape = (fill) => {
    c.fillStyle = fill;
    c.beginPath();
    c.ellipse(0.3, 0, 2.4, 1.15, 0, 0, Math.PI * 2);
    c.fill();
  };
  // shadow on the ground, drifting off as it climbs
  c.save();
  c.translate(X + u * (0.5 + alt * 2.5), Y + u * (0.7 + alt * 3));
  c.rotate(ang);
  c.scale(u * (1 - alt * 0.25), u * (1 - alt * 0.25));
  c.globalAlpha = 0.25 * (1 - alt * 0.7);
  shape('#1c140e');
  c.fillRect(-5.2, -0.28, 4.2, 0.56);
  c.restore();

  c.save();
  c.translate(X, Y - alt * u * 2.5);
  c.rotate(ang);
  const k = u * (1 + alt * 0.35);
  c.scale(k, k);
  c.lineWidth = lw;
  c.strokeStyle = HELI.edge;
  c.lineJoin = 'round';
  // skids
  c.lineCap = 'round';
  c.lineWidth = 0.18;
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(-1.6, s * 1.3);
    c.lineTo(2.1, s * 1.3);
    c.stroke();
  }
  c.lineWidth = lw;
  // tail boom, stabiliser and tail rotor
  c.fillStyle = HELI.dark;
  c.beginPath();
  c.roundRect(-5.3, -0.28, 4.4, 0.56, 0.2);
  c.fill();
  c.stroke();
  c.beginPath();
  c.roundRect(-4.6, -0.95, 0.42, 1.9, 0.15);
  c.fill();
  c.stroke();
  c.save();
  c.translate(-5.2, 0.45);
  c.rotate(rot * 1.7);
  c.fillStyle = 'rgba(36,23,15,0.75)';
  c.fillRect(-0.7, -0.07, 1.4, 0.14);
  c.restore();
  // body, stripe, engine and glass
  shape(HELI.body);
  c.stroke();
  c.save();
  c.beginPath();
  c.ellipse(0.3, 0, 2.4, 1.15, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = HELI.stripe;
  c.fillRect(-0.55, -1.3, 0.38, 2.6);
  c.restore();
  c.fillStyle = HELI.dark;
  c.beginPath();
  c.roundRect(-0.9, -0.45, 1.3, 0.9, 0.3);
  c.fill();
  c.stroke();
  c.fillStyle = HELI.glass;
  c.beginPath();
  c.ellipse(1.75, 0, 0.85, 0.8, 0, -Math.PI / 2, Math.PI / 2);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.ellipse(2.05, -0.3, 0.28, 0.14, 0.5, 0, Math.PI * 2);
  c.fill();
  // main rotor: a faint disc plus blades with a little motion blur
  c.fillStyle = 'rgba(30,22,15,0.1)';
  c.beginPath();
  c.arc(0, 0, 4.3, 0, Math.PI * 2);
  c.fill();
  for (let b = 0; b < 3; b++) {
    c.save();
    c.rotate(rot - b * 0.12);
    c.fillStyle = `rgba(36,23,15,${0.85 - b * 0.3})`;
    for (const a of [0, Math.PI / 2]) {
      c.save();
      c.rotate(a);
      c.beginPath();
      c.roundRect(-4.3, -0.11, 8.6, 0.22, 0.11);
      c.fill();
      c.restore();
    }
    c.restore();
  }
  c.fillStyle = HELI.edge;
  c.beginPath();
  c.arc(0, 0, 0.28, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// rotor thump: low-passed noise chopped at the blade rate, into the game's effects bus
function rotorSound(A) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = A.noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const chop = ctx.createGain();
  chop.gain.value = 0.55;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 11;
  const depth = ctx.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth).connect(chop.gain);
  const out = ctx.createGain();
  out.gain.value = 0;
  src.connect(lp).connect(chop).connect(out).connect(A.sfxBus);
  src.start();
  lfo.start();
  return {
    set: (v, tc = 0.4) => out.gain.setTargetAtTime(v, ctx.currentTime, tc),
    stop() {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => (src.stop(), lfo.stop()), 2500);
    },
  };
}

// a walkable spot around (x, z) at distance d
function openSpot(g, x, z, d, r = 0.5) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, dd = d * rand(0.8, 1.2);
    const px = x + Math.cos(a) * dd, pz = z + Math.sin(a) * dd;
    if (!circleBlocked(g.world, g.sgrid, px, pz, r) && g.field.distAt(px, pz) < 1e6) return { x: px, z: pz };
  }
  return { x, z };
}

async function startRecorder(audio) {
  const id = await window.native.trailerSource();
  const video = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id, minWidth: 1920, maxWidth: 1920, minHeight: 1080, maxHeight: 1080, maxFrameRate: 60 } },
  });
  // game audio goes only to the recording, so nothing plays through the speakers
  const dest = audio.ctx.createMediaStreamDestination();
  audio.master.disconnect();
  audio.master.connect(dest);
  const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16e6, audioBitsPerSecond: 192e3 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  return {
    rec,
    status: () => `${rec.state} track=${video.getVideoTracks()[0].readyState}${video.getVideoTracks()[0].muted ? ' muted' : ''} chunks=${chunks.length} bytes=${chunks.reduce((a, c) => a + c.size, 0)}`,
    ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
    async finish() {
      const done = new Promise((r) => (rec.onstop = r));
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      return new Blob(chunks, { type: mimeType }).arrayBuffer();
    },
  };
}

// The end-of-story cutscene on its own (npm run finale), saved as release/Dead Ground Finale.mp4.
export async function recordFinale(app) {
  app.smoke = true;
  const report = { ok: true };
  const stuck = setTimeout(() => window.native.smokeDone({ ok: false, error: 'finale recording timed out' }), 90000);
  const A = app.audio;
  A.init();
  A.resume();
  A.setVolumes({ master: 0.9, sfx: 0.6, music: 0.85 });
  document.body.style.cursor = 'none';
  let recorder = null, data = null;
  // output level every half second (rms / peak), to check the mix without listening
  const meter = A.ctx.createAnalyser();
  meter.fftSize = 2048;
  const buf = new Float32Array(meter.fftSize);
  report.levels = [];
  const lv = setInterval(() => {
    meter.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (const v of buf) [sum, peak] = [sum + v * v, Math.max(peak, Math.abs(v))];
    report.levels.push(Math.sqrt(sum / buf.length).toFixed(2) + '/' + peak.toFixed(2));
  }, 500);
  try {
    await playFinale(app, ['rook', 'volt', 'brick', 'sparks'], {
      ready: async () => {
        recorder = await startRecorder(A);
        A.master.connect(meter); // after the recorder rewires the output
        await wait(200);
      },
      ended: async () => {
        await wait(300);
        data = await recorder.finish();
      },
    });
    clearInterval(lv);
    if (!data) throw new Error('the recorder produced nothing');
    report.file = await window.native.trailerSave(data, recorder.ext, 'finale');
    report.mb = +(data.byteLength / 1e6).toFixed(1);
  } catch (err) {
    report.ok = false;
    report.error = String((err && err.stack) || err);
  }
  clearTimeout(stuck);
  window.native.smokeDone(report);
}

export async function runTrailer(app) {
  app.smoke = true; // never saves the profile or sends bug reports
  const report = { ok: true };
  const stuck = setTimeout(() => window.native.smokeDone({ ok: false, error: 'trailer timed out', at: report.at }), 150000);
  const A = app.audio;
  A.init();
  A.resume();
  A.setVolumes({ master: 0.9, sfx: 0.55, music: 0.9 }); // music forward, gunfire back
  const startSong = A.startMusic.bind(A);
  // one song plays across every scene at one steady intensity
  A.startMusic = A.stopMusic = A.setIntensity = () => {};
  // the game's musical cues (round chimes, level-up jingles...) would clash with the song
  const play = A.play.bind(A);
  A.play = (name, ...rest) => (JINGLES.has(name) ? undefined : play(name, ...rest));
  document.body.style.cursor = 'none';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'trailer';
  root.innerHTML = `<canvas class="tr-sky"></canvas><div class="tr-chips"></div><div class="tr-dim"></div>
    <div class="tr-card"><h1 class="title">Dead <span>Ground</span></h1><div class="tr-tag"></div><div class="tr-facts"></div></div>
    <div class="tr-cap"></div><div class="tr-fade"></div>`;
  document.body.appendChild(root);
  const [sky, chips, dim, card, cap, fade] = ['.tr-sky', '.tr-chips', '.tr-dim', '.tr-card', '.tr-cap', '.tr-fade'].map((s) => root.querySelector(s));
  const tag = card.querySelector('.tr-tag'), facts = card.querySelector('.tr-facts');
  const showCard = (on, t = '', f = '') => {
    tag.textContent = t;
    facts.textContent = f;
    facts.style.display = f ? '' : 'none';
    card.classList.toggle('show', on);
    dim.classList.toggle('show', on);
  };
  const chip = (charId) => {
    const ch = CHARACTERS[charId];
    const el = document.createElement('div');
    el.className = 'tr-chip';
    el.innerHTML = `<i style="background:${hex(ch.color)}"></i>${ch.name} · <b>${ch.ability}</b>`;
    chips.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  };

  let recorder = null;
  try {
    app.profile.unlocked = 5;
    for (const [i, sc] of SCENES.entries()) {
      report.at = 'scene ' + (i + 1);
      console.log('trailer:', report.at);
      // set the scene up behind the black fade (recording is paused meanwhile)
      app.openLobby('solo');
      app.lobby.unlocked = 5;
      app.lobby.mapId = sc.map;
      app.lobby.mode = 'endless';
      app.lobby.players = sc.chars.map((char, id) => ({ id, name: ['Ash', 'Kit', 'Moss', 'Juno'][id], char, level: 5 }));
      app.lobbyStart();
      app.closeIntro();
      const s = app.session, g = s.game, r = s.renderer;
      document.getElementById('hud').style.display = 'none';
      r.zoom = sc.zoom;
      // the round starts on the next tick, with the game's own spawn points and pacing
      g.wave = sc.wave - 1;
      g.waveState = 'break';
      g.waveT = 0;
      const me = g.players[0];
      sc.guns.forEach((gun, k) => (me.weapons[k] = g.makeWeapon(...gun)));
      me.cur = sc.guns.length - 1;
      for (const q of g.players.slice(1)) {
        q.weapons[1] = g.makeWeapon(...TEAM_GUNS[q.id % 3]);
        q.cur = 1;
      }
      const pad = sc.extract && g.world.spots.named.helipad[0];
      if (pad) {
        // the team holds a spot a short run west of the helipad
        for (const q of g.players) Object.assign(q, openSpot(g, pad.x - 7, pad.z + 1, 2));
        s.localId = -1; // the camera is directed by hand in this scene (see below)
      }
      // forge: fight around the Weapon Forge with the second gun inside it (it never finishes
      // during the fast-forward; the countdown is set just before the scene starts)
      const fs = sc.forge && g.world.spots.forge, stand = fs && openSpot(g, fs.x, fs.z, 1.5);
      if (fs) {
        Object.assign(me, openSpot(g, fs.x, fs.z, 3));
        // a pistol for the fast-forward (the XX Storm Caller would clear the round before it
        // gathers) and a free slot, so the forged gun is added rather than swapped in
        me.weapons = [g.makeWeapon('pistol'), null];
        me.cur = 0;
        g.forgeJob = { pid: me.id, w: g.makeWeapon(...sc.forge), t: 1e9 };
      }
      const brains = g.players.map((q) => new Survivor(g, q, q === me ? fs : me));
      let sceneT = -1;
      const fired = new Set();
      // calm: hold fire (the fast-forward lets the round close in, so the scene opens on the fight)
      const think = (dt, calm = false) => {
        let mine = null;
        for (const [k, q] of g.players.entries()) {
          if (q.state === 'dead') continue; // aboard the helicopter
          q.hp = q.maxHp; // nobody goes down on camera
          if (q.choices.length) g.pickBoon(q, 0);
          const w = g.curWeapon(q);
          if (w) w.reserve = 999;
          const inp = brains[k].input(dt);
          if (calm) [inp.fire, inp.acts] = [false, {}];
          // showcase: each survivor's ability in turn, aimed at whatever they're shooting at
          if (sc.showcase && sceneT >= 0.5 + k * 1.3 && !fired.has(k)) {
            fired.add(k);
            q.abilityCd = 0;
            if (q.char === 'brick') q.charges = Math.max(1, q.charges);
            inp.acts.ability = true;
            chip(q.char);
          } else if (sc.showcase && !fired.has(k)) delete inp.acts.ability; // save it for its turn
          if (q === me) {
            // the forged gun is ready: walk over and take it, like a player would
            if (fs && g.forgeJob && g.forgeJob.t <= 0) {
              if (!brains[k].goal) brains[k].goal = brains[k].wp = stand;
              if (Math.hypot(q.x - fs.x, q.z - fs.z) < 2.1) inp.acts.usePress = true;
            } else if (fs) brains[k].goal = null;
            mine = inp;
          }
          g.setInput(q.id, inp);
        }
        return mine;
      };
      // fast-forward until the round has reached the players (and the boss is close)
      const dists = () => g.zombies.map((z) => Math.hypot(z.x - me.x, z.z - me.z));
      const nearCount = () => dists().filter((d) => d > 4 && d < 14).length;
      const boss = () => g.zombies.find((z) => z.boss);
      for (let n = 0; n < 60 / STEP; n++) {
        // anything that gets close is shot, as a player would; if the round is slow to gather,
        // only what's right on top of them
        think(STEP, Math.min(99, ...dists()) > (n * STEP < 25 ? sc.calm || 7 : 2.5));
        g.update(STEP);
        if (n % 30 === 0 && nearCount() >= sc.near && (!sc.boss || (boss() && Math.hypot(boss().x - me.x, boss().z - me.z) < 10))) break;
      }
      g.drainEvents(); // skip the sounds of the fast-forward
      console.log('trailer: round', g.wave, 'alive', g.zombies.length, 'near', nearCount(), 'after', g.time.toFixed(1) + 's');
      if (sc.boss && boss()) boss().hp = boss().maxHp *= 50; // still standing when the scene cuts
      if (fs) {
        me.weapons[0] = g.makeWeapon(...sc.guns[0]);
        g.forgeJob.t = 2.8; // about 1.8 s left once the fade lifts
      }
      for (const b of brains) b.stuck = 0;
      let last = performance.now();
      s.input.sample = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (sceneT >= 0) sceneT += dt;
        return think(dt);
      };

      // extraction: a hand-held camera between the team and the pad, and the helicopter on top
      let heli = null;
      if (pad) {
        const from = { x: pad.x + 16, z: pad.z - 13 };
        heli = { x: from.x, z: from.z, alt: 1, rot: 0, ang: Math.atan2(pad.z - from.z, pad.x - from.x), from, phase: 'in', t: 0, sound: rotorSound(A) };
        const camAt = () => {
          const team = g.players.filter((q) => q.state === 'alive');
          const cx = team.reduce((a, q) => a + q.x, 0) / (team.length || 1), cz = team.reduce((a, q) => a + q.z, 0) / (team.length || 1);
          // a little west of centre: the helipad sits near the map's east edge
          return team.length ? { x: cx * 0.55 + pad.x * 0.45 - 3.5, z: cz * 0.55 + pad.z * 0.45 } : { x: pad.x - 3.5, z: pad.z };
        };
        r.cam = camAt();
        let lastF = performance.now(), dustT = 0;
        const frame = s.frame.bind(s);
        s.frame = (now) => {
          const dt = Math.min(0.05, (now - lastF) / 1000);
          lastF = now;
          const c = camAt(), f = ease(2.5, dt);
          r.cam.x += (c.x - r.cam.x) * f;
          r.cam.z += (c.z - r.cam.z) * f;
          [A.listener.x, A.listener.z] = [r.cam.x, r.cam.z]; // sounds are heard from the camera
          frame(now);
          if (sceneT < 0) return;
          heli.t += dt;
          heli.rot += dt * 30;
          if (heli.phase === 'in') {
            const k = smooth(Math.min(1, heli.t / 3.6));
            heli.x = heli.from.x + (pad.x - heli.from.x) * k;
            heli.z = heli.from.z + (pad.z - heli.from.z) * k;
            heli.alt = 1 - k;
            heli.sound.set(0.35 + 0.6 * k);
          } else if (heli.phase === 'out') {
            const k = Math.min(1, heli.t / 3);
            heli.alt = smooth(Math.min(1, k * 1.6));
            heli.x = pad.x - 18 * k * k;
            heli.z = pad.z - 11 * k * k;
            heli.ang += wrap(Math.atan2(-11, -18) - heli.ang) * ease(1.5, dt);
            heli.sound.set(0.95 * (1 - k * 0.8));
          }
          // rotor wash kicks up dust near the ground
          if (heli.alt < 0.45 && (dustT -= dt) <= 0) {
            dustT = 0.07;
            r.burst(heli.x, heli.z, 0.1, 5, ['#d8cfa8', '#c9bd92', '#b9c48a'], 4, 0.7, 0.22);
          }
          if (sky.width !== r.canvas.width || sky.height !== r.canvas.height) [sky.width, sky.height] = [r.canvas.width, r.canvas.height];
          const ctx = sky.getContext('2d');
          ctx.clearRect(0, 0, sky.width, sky.height);
          drawHeli(ctx, r.sx(heli.x), r.sy(heli.z), r.u, heli.ang, heli.rot, heli.alt);
        };
      }

      if (i === 0) {
        startSong(5);
        A.music.setIntensity(1);
        await wait(300);
      }
      await wait(700); // sprite caches warm up
      if (!recorder) {
        console.log('trailer: starting capture');
        recorder = await startRecorder(A);
        console.log('trailer: recording', recorder.ext);
      } else recorder.rec.resume();
      console.log('trailer: recorder', recorder.status());
      fade.style.opacity = 0;
      sceneT = 0;
      if (sc.title) {
        showCard(true, 'A co-op zombie survival game');
        await wait(2600);
        showCard(false);
        await wait(400);
      }
      cap.textContent = sc.cap;
      cap.classList.add('show');
      if (heli) {
        // the chopper lands, the team fights its way over and climbs aboard, and it lifts off
        await wait(3700);
        heli.phase = 'landed';
        brains.forEach((b, k) => (b.goal = { x: pad.x - 1.2 + (k % 2) * 2.4, z: pad.z + (k < 2 ? -1.6 : 1.6) }));
        for (let t = 0; t < 7000 && g.players.some((q) => q.state === 'alive'); t += 50) {
          for (const q of g.players) {
            if (q.state === 'alive' && Math.hypot(q.x - pad.x, q.z - pad.z) < 2.2) {
              q.state = 'dead'; // hidden: they're inside
              q.selfRevive = true; // keeps the round from counting as a loss
              play('swap', q.x, q.z, 1.2);
            }
          }
          await wait(50);
        }
        cap.classList.remove('show');
        await wait(500);
        heli.phase = 'out';
        heli.t = 0;
        await wait(1300);
        console.log('trailer: stuck checks', brains.map((b) => b.stuck).join(','));
        break; // the end card plays over the departing chopper
      }
      await wait(sc.secs * 1000 - (sc.title ? 3000 : 0));
      console.log('trailer: stuck checks', brains.map((b) => b.stuck).join(','), fs ? 'forge ' + (g.forgeJob ? 'still in forge' : 'collected, holding ' + g.curWeapon(me).id) : '');
      cap.classList.remove('show');
      fade.style.opacity = 1;
      await wait(FADE + 50);
      recorder.rec.pause();
      chips.innerHTML = '';
      app.endSession();
    }
    showCard(true, 'Grab your friends. Hold the line.', '5 maps  ·  6 survivors  ·  13 weapons  ·  1–4 players');
    await wait(END_SECS * 1000 - 1500);
    A.master.gain.setTargetAtTime(0, A.ctx.currentTime, 0.35);
    fade.style.transition = 'opacity 1.2s ease';
    fade.style.opacity = 1;
    await wait(1500);
    console.log('trailer: recorder', recorder.status());
    const data = await recorder.finish();
    report.file = await window.native.trailerSave(data, recorder.ext);
    report.mb = +(data.byteLength / 1e6).toFixed(1);
  } catch (err) {
    report.ok = false;
    report.error = String((err && err.stack) || err);
  }
  clearTimeout(stuck);
  window.native.smokeDone(report);
}
