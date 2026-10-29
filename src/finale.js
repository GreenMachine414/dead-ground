// End-of-story cutscene, played after the team extracts from Ground Zero (map 5). A side-on
// getaway drawn with the game's own character art: out of the lab elevator and into a truck, a
// running fight with the horde (each survivor's ability gets a moment), the bridge blown behind
// them, a sunrise, then a thank-you card. Everything is vector-drawn into a canvas at the
// screen's real resolution (scenery is cached per chunk), so it stays sharp in HD.
// Esc / Enter / Space / click skips.
import { drawPerson, playerLook, zombieLook, drawTree, drawBush, rr, ellipse, circle, shade, hex, SIGNATURE_GUNS as GUNS } from './render/sprites.js';
import { mulberry32 as srng } from './game/rng.js';
import { WEAPONS } from './data/weapons.js';
import { Rock } from './rock.js';

const VW = 1920, VH = 1080; // virtual canvas, scaled to fit the real one
const PX = 108; // pixels per metre
const GY0 = 700, GY1 = 930; // road: far and near edge
const BAR = 62; // letterbox bars
const EDGE = '#2a1d16';
const gy = (d) => GY0 + d * (GY1 - GY0); // ground line for a depth (0 = far side of the road, 1 = near)
const ds = (d) => 0.86 + d * 0.24; // nearer things are a little bigger
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => (t = clamp01(t)) * t * (3 - 2 * t);
const lerp = (a, b, k) => a + (b - a) * k;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixRgb = (a, b, k) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;

// ---------------------------------------------------------------- timeline (scene seconds)
// The truck's run is analytic up to the cut, so the bridge can be placed where it'll be at a set time.
const T_GO = 3.9, ACC = 4.2, V = 13, T_V = V / ACC, X0 = 6;
const truckAt = (T) => {
  if (T < T_GO) return X0;
  const t = T - T_GO;
  return t < T_V ? X0 + 0.5 * ACC * t * t : X0 + 0.5 * ACC * T_V * T_V + V * (t - T_V);
};
const speedAt = (T) => (T < T_GO ? 0 : Math.min(V, ACC * (T - T_GO)));
const XB = truckAt(18.4), BL = 46, C0 = XB + 7, C1 = XB + 19; // the bridge, and the span that blows
const T_LOOK = 19.6, T_BLAST = 20.4, T_CUT = 22, T_CARD = 24.6, T_END = 33.2;
const ABILITY_AT = [8, 10.4, 17.1, 19]; // one per survivor (Rook's airstrike has its own slot)
const BED_H = 1.05; // truck bed floor height (m)
const RATE = { shotgun: 1.6, smg: 6.5, ar: 5, lmg: 6, raygun: 3 };
const CHASERS = [['runner', 55], ['leaper', 12], ['armored', 10], ['screamer', 8], ['phantom', 8], ['burner', 7]];
const HP = { armored: 7, juggernaut: 1e9, screamer: 4, runner: 4, leaper: 4, phantom: 4, burner: 4, walker: 4 };

const SKY = {
  dawn: ['#2a2140', '#6a3f5e', '#e58a5c'].map(rgbOf),
  day: ['#8fb7d9', '#f3c58f', '#ffe3a3'].map(rgbOf),
};
const CAR_COLS = ['#b5523b', '#4a6a8a', '#c9a24a', '#6f7d3c', '#8a8f99', '#5a3a5a'];
const WALLS = ['#7a7f8c', '#8b8f99', '#6f7468', '#a8a08a', '#5e5a56', '#7a6a62'];

const region = (x) => (x < 22 ? 'lab' : x < XB - 4 ? 'city' : x < XB + BL + 2 ? 'bridge' : 'country');

let current = null; // the cutscene on screen, if any
export const finalePlaying = () => !!current;
// ends the cutscene at once (a game is starting under it)
export function stopFinale() {
  if (current) current.finish();
}

export function playFinale(app, chars, opts = {}) {
  return new Promise((resolve) => new Finale(app, chars, opts, resolve).start());
}

class Finale {
  constructor(app, chars, opts, done) {
    this.A = app.audio;
    this.opts = opts;
    this.done = done;
    this.T = 0; // scene time (slows down for the bridge)
    this.realT = 0;
    this.cam = 4.2;
    this.shake = 0;
    this.flash = 0;
    this.truck = { x: X0, v: 0, wheel: 0 };
    this.zombies = [];
    this.parts = [];
    this.free = []; // recycled particle objects
    this.decals = [];
    this.tracers = [];
    this.bolts = [];
    this.texts = [];
    this.shells = [];
    this.slabs = [];
    this.wall = null;
    this.turret = null;
    this.ring = null;
    this.blasted = false;
    this.cut = false;
    this.doors = 0;
    this.spawnT = 0;
    this.cache = new Map();
    this.draws = [];
    this.bounce = 0;
    this.firsts = {};
    const ids = (chars && chars.length ? chars : ['brick']).slice(0, 4);
    const n = ids.length;
    this.team = ids.map((char, i) => {
      const gun = GUNS[char] || 'ar';
      return {
        char, gun, i,
        slot: n > 1 ? 0.55 + (i * 2.8) / (n - 1) : 1.6,
        state: 'wait', x: -2 + (i - (n - 1) / 2) * 0.35, d: 0.2, h: 0, aim: 0, walk: Math.random() * 6,
        cd: rand(0, 0.3), tgt: null, pickT: 0, swing: 0, boost: 0,
        o: { ...playerLook(char), gun, forged: i === 0 ? 2 : 1, aim: 0, walk: 0, moving: false, time: 0 },
      };
    });
    // wrecked cars along both kerbs, some still burning
    this.wrecks = [];
    for (let x = 16, r = srng(5); x < XB - 6; x += 10 + r() * 7) {
      this.wrecks.push({ x, d: r() < 0.5 ? 0.03 : 0.97, col: CAR_COLS[(r() * CAR_COLS.length) | 0], burn: r() < 0.45, flip: r() < 0.5, rot: 0, h: 0, emit: 0 });
    }
    this.events = this.makeEvents(ids);
    this.ev = 0;
  }

  makeEvents(ids) {
    const E = [
      [0.5, () => this.ding()],
      [0.65, () => (this.doorsOpen = true)],
      ...this.team.map((s, i) => [1.25 + i * 0.28, () => (s.state = 'run')]),
      [2.3, () => this.burst()],
      [3.7, () => this.sfx('rev')],
      [5.4, () => this.leaper()],
      [14, () => this.pack(8)],
      [19.2, () => this.bridgeHorde()],
      [11.8, () => this.juggernaut()],
      [15, () => this.airstrike()],
      [T_BLAST, () => this.blowBridge()],
      [T_BLAST + 0.55, () => this.rock && this.rock.set('drive')], // back in as the slow motion ends
      [T_CUT - 0.3, () => (this.dip = 1)],
      [T_CUT, () => this.sunrise()],
      [T_CARD, () => this.card.classList.add('show')],
      [T_END - 1.2, () => this.fadeOut()],
      [T_END, () => this.finish()],
    ];
    let k = 0;
    for (const s of this.team) {
      if (s.char === 'rook') continue;
      const at = ABILITY_AT[k++];
      if (s.char !== 'sparks' && s.char !== 'mags') E.push([at - 1.3, () => this.pack(6)]);
      E.push([at, () => this.ability(s)]);
    }
    return E.sort((a, b) => a[0] - b[0]);
  }

  // ---------------------------------------------------------------- lifecycle
  async start() {
    current = this;
    const root = (this.root = document.createElement('div'));
    root.id = 'finale';
    root.innerHTML = `<canvas></canvas><div class="fin-where">Prometheus Labs · Surface · Dawn</div>
      <div class="fin-card"><div class="fin-thanks">Thank you for playing</div><h1 class="title">Dead <span>Ground</span></h1>
      <div class="fin-more">More is coming soon...</div><div class="fin-sub">New maps, survivors and stories are on the way.</div></div>
      <div class="fin-skip">Esc · Skip</div><div class="fin-fade"></div>`;
    document.body.appendChild(root);
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    [this.where, this.card, this.skipHint, this.fade] = ['.fin-where', '.fin-card', '.fin-skip', '.fin-fade'].map((s) => root.querySelector(s));
    this.onKey = (e) => {
      if (e.code === 'F11') return; // fullscreen still works
      if (['Escape', 'Enter', 'Space'].includes(e.code)) this.skip();
      e.stopPropagation();
      e.preventDefault();
    };
    this.onClick = () => this.skip();
    window.addEventListener('keydown', this.onKey, true);
    root.addEventListener('pointerdown', this.onClick);
    try {
      await document.fonts.load('700 30px Fredoka'); // canvas text uses the game's font
    } catch {}
    try {
      if (this.opts.ready) await this.opts.ready();
    } catch (err) {
      console.error('finale:', err);
      return this.finish();
    }
    const A = this.A;
    if (A.ctx) {
      A.resume();
      A.stopMusic();
      this.rock = new Rock(A);
      this.rock.set('intro');
      this.engine = engineSound(A);
    }
    requestAnimationFrame(() => {
      this.fade.style.opacity = 0;
      this.where.classList.add('show');
    });
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  skip() {
    if (this.realT < 0.8 || this.ending) return;
    this.fadeOut();
    setTimeout(() => this.finish(), 650);
  }

  fadeOut() {
    if (this.ending) return;
    this.ending = true;
    this.fade.style.opacity = 1;
    if (this.engine) this.engine.stop();
    if (this.rock) this.rock.stop();
  }

  async finish() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    if (this.engine) this.engine.stop();
    if (this.rock) this.rock.stop(0.4);
    try {
      if (this.opts.ended) await this.opts.ended();
    } catch (err) {
      console.error('finale:', err);
    }
    this.root.remove();
    this.cache.clear();
    if (current === this) current = null;
    this.done();
  }

  frame(now) {
    if (this.closed) return;
    const rdt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.realT += rdt;
    if (this.realT > 1.2) this.skipHint.classList.add('show');
    if (this.realT > 4.2) this.where.classList.remove('show');
    // slow motion as the bridge goes
    const sb = this.T - T_BLAST;
    const scale = sb < 0 ? 1 : sb < 0.45 ? 0.28 : Math.min(1, 0.28 + (sb - 0.45) * 3);
    this.update(rdt * scale, rdt);
    if (this.closed) return; // the last event just ended it (and removed the canvas)
    this.draw();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- update
  update(dt, rdt) {
    this.T += dt;
    const T = this.T, tr = this.truck;
    while (this.ev < this.events.length && this.events[this.ev][0] <= T) this.events[this.ev++][1]();
    if (!this.cut) {
      tr.x = truckAt(T);
      tr.v = speedAt(T);
      // static on the yard, then riding along; at the bridge it holds back to watch it go
      const ride = tr.x + 1.2;
      const cam = lerp(4.2, ride, smooth((T - T_GO) / 2.2));
      this.cam = lerp(cam, XB + 17.5, smooth((T - T_LOOK) / 0.9));
    } else {
      tr.v += (9 - tr.v) * (1 - Math.exp(-dt * 0.8));
      tr.x += tr.v * dt;
    }
    tr.wheel += (tr.v / 0.55) * dt;
    if (tr.v > 2 && Math.random() < 0.5) {
      // dust off the back wheels
      this.part({ kind: 's', x: tr.x + 0.6, d: 0.44, h: 0.15, vx: -rand(1, 3), vh: rand(0.2, 0.8), life: rand(0.5, 0.9), size: 0.25, grow: 0.8, col: this.cut ? '#c9bd92' : '#7a7088' });
    }
    this.doors = this.doorsOpen ? Math.min(1, this.doors + dt * 1.6) : 0;
    this.shake *= Math.exp(-rdt * 7);
    this.flash *= Math.exp(-rdt * 5);
    if (this.dip) this.dip = Math.max(0, this.dip - rdt * 1.6);
    if (this.engine) {
      const away = this.cut ? clamp01((this.cam + 16 - tr.x) / 14) : 1;
      this.engine.set((0.05 + 0.2 * (tr.v / V)) * away, 0.2 + 0.8 * (tr.v / V));
    }
    if (!this.cut && T > T_GO && T < T_BLAST) this.keepChase(dt);
    this.updateTeam(dt);
    this.updateZombies(dt);
    this.updateFx(dt);
  }

  // keeps a pack running up behind the truck
  keepChase(dt) {
    if ((this.spawnT -= dt) > 0) return;
    this.spawnT = 0.14;
    const left = this.cam - VW / 2 / PX;
    let running = 0;
    for (const z of this.zombies) if (z.state === 'run' && z.x > left) running++;
    if (running < 16) this.spawn(this.chaserType(), left - rand(0.5, 2.5), rand(0.08, 0.95), { boost: rand(1.2, 3.4) });
  }

  // a pack sprinting in from off screen to catch the truck
  pack(n) {
    const left = this.cam - VW / 2 / PX;
    for (let i = 0; i < n; i++) this.spawn(this.chaserType(), left - rand(0.3, 3), rand(0.08, 0.95), { boost: rand(3, 4.5) });
  }

  chaserType() {
    let r = Math.random() * 100;
    for (const [t, w] of CHASERS) if ((r -= w) < 0) return t;
    return 'runner';
  }

  spawn(type, x, d, o = {}) {
    const look = zombieLook(type);
    const z = {
      type, x, d, h: 0, vh: 0, vx: o.vx !== undefined ? o.vx : this.truck.v + (o.boost || 1), boost: o.boost || 1, hp: HP[type] || 3,
      state: 'run', rot: 0, vrot: 0, hurt: 0, t: 0, seed: Math.random() * 9, grab: false, fixed: o.fixed,
      u: PX * ds(d) * 1.12,
      o: { ...look, aim: 0, walk: Math.random() * 6, moving: true, time: 0, attack: false, hurt: false, down: false },
    };
    this.zombies.push(z);
    return z;
  }

  updateTeam(dt) {
    const T = this.T, tr = this.truck;
    for (const s of this.team) {
      s.swing = Math.max(0, s.swing - dt);
      s.o.time = T;
      if (s.state === 'wait') continue;
      if (s.state === 'run') {
        // out of the elevator and over to the tailgate
        const tx = tr.x - 0.4, td = 0.42;
        const dx = tx - s.x, dist = Math.hypot(dx, (td - s.d) * 3);
        const step = Math.min(dist, 6.2 * dt);
        s.x += (dx / (dist || 1)) * step;
        s.d += ((td - s.d) / (dist || 1)) * step;
        s.walk += dt * 13;
        s.aim = 0;
        if (dist < 0.15) [s.state, s.jt, s.jx] = ['jump', 0, s.x];
      } else if (s.state === 'jump') {
        s.jt += dt / 0.38;
        const k = Math.min(1, s.jt);
        s.x = lerp(s.jx, tr.x + s.slot, k);
        s.h = BED_H * k + Math.sin(k * Math.PI) * 0.7;
        if (k >= 1) s.state = 'bed';
      } else {
        s.x = tr.x + s.slot;
        s.h = BED_H;
        if (this.cut) {
          s.aim += wrap(-0.15 - s.aim) * Math.min(1, dt * 4); // looking down the road ahead
        } else this.shoot(s, dt);
      }
      s.o.aim = s.aim;
      s.o.walk = s.walk;
      s.o.moving = s.state === 'run';
    }
  }

  // aim at the nearest zombie behind the truck, fire when on target
  shoot(s, dt) {
    const tr = this.truck, left = this.cam - VW / 2 / PX + 0.4;
    if ((s.pickT -= dt) <= 0 || (s.tgt && !this.alive(s.tgt))) {
      s.pickT = rand(0.2, 0.4);
      let best = null, bs = Infinity;
      for (const z of this.zombies) {
        if (!this.alive(z) || z.x < left || z.x > tr.x + 1.5) continue;
        const sc = tr.x - z.x + (z === s.tgt ? -1.5 : 0) + Math.abs(z.d - 0.42) * 2 + (z.type === 'juggernaut' ? -3 : 0);
        if (sc < bs) [best, bs] = [z, sc];
      }
      s.tgt = best;
    }
    const z = s.tgt;
    const mx = s.x, mh = s.h + 0.95;
    const want = z ? Math.atan2(-(z.h + 0.75 - mh) * PX + (gy(z.d) - gy(0.42)), (z.x - mx) * PX) : Math.PI - 0.1;
    const err = wrap(want - s.aim);
    s.aim += err * Math.min(1, dt * 12);
    if ((s.cd -= dt) > 0 || !z || Math.abs(err) > 0.3) return;
    s.cd = (1 / RATE[s.gun]) * rand(0.85, 1.25) / (s.boost > this.T ? 1.8 : 1);
    const col = hex(WEAPONS[s.gun].color);
    const pellets = s.gun === 'shotgun' ? 4 : 1;
    for (let k = 0; k < pellets; k++) {
      this.tracers.push({ x1: mx + Math.cos(s.aim) * 0.6, h1: mh, d1: 0.42, x2: z.x + rand(-0.3, 0.3), h2: z.h + rand(0.5, 1.1), d2: z.d, life: 0.07, col, w: s.gun === 'raygun' ? 7 : 3 });
    }
    this.burstAt(mx + Math.cos(s.aim) * 0.75, 0.42, mh + 0.05, 2, ['#fff2b0', '#ffd36a'], 3, 0.08, 0.12, 'g', 0, tr.v);
    this.A.play(WEAPONS[s.gun].sound, undefined, undefined, 0.3);
    this.hit(z, s.gun === 'shotgun' ? 3 : s.gun === 'raygun' ? 2 : 1.2);
  }

  alive(z) {
    return z.state === 'run' || z.state === 'bed' || z.state === 'blocked';
  }

  hit(z, dmg) {
    z.hp -= dmg;
    z.hurt = 0.09;
    this.burstAt(z.x, z.d, z.h + 0.8, 3, ['#8a2a2a', '#a33a2e'], 3, 0.4, 0.09, 'b', 0, z.vx * 0.8);
    if (z.hp <= 0) this.kill(z, 1);
  }

  kill(z, power, vx, quiet) {
    z.state = 'fly';
    z.vx = vx !== undefined ? vx : z.vx * 0.55;
    z.vh = rand(2, 3.4) * power;
    z.vrot = -rand(3, 6) * Math.sign(power);
    if (!quiet && this.texts.length < 10) this.texts.push({ x: z.x, d: z.d, h: z.h + 1.7, vh: 1.6, life: 0.75, txt: String(Math.round(rand(150, 420) * Math.abs(power))) });
    this.burstAt(z.x, z.d, z.h + 0.8, 7, ['#8a2a2a', '#a33a2e', '#6e2222'], 5, 0.6, 0.12, 'b', 0, z.vx * 0.5);
    if (Math.random() < 0.35) this.A.play('die', undefined, undefined, 0.45);
  }

  updateZombies(dt) {
    const tr = this.truck, T = this.T;
    const left = this.cam - VW / 2 / PX;
    for (const z of this.zombies) {
      z.t += dt;
      z.hurt -= dt;
      const o = z.o;
      o.time = T;
      o.hurt = z.hurt > 0;
      if (z.state === 'run') {
        if (z.fixed) z.vx = z.fixed;
        else if (tr.v < 0.5) z.vx = 5.4 * z.boost * 0.5 + 3.2; // on foot across the yard
        else z.vx += (tr.v + z.boost - z.vx) * (1 - Math.exp(-dt * 2));
        let nx = z.x + z.vx * dt;
        if (this.wall && z.x < this.wall.x && nx > this.wall.x - 0.4) [nx, z.state, z.vx] = [this.wall.x - 0.4, 'blocked', 0];
        // grabbing at the tailgate (or running alongside, further from the truck's lane)
        const lim = tr.x - 0.45 + Math.abs(z.d - 0.42) * 3.5;
        z.grab = nx > lim;
        if (z.grab) nx = lim;
        z.x = nx;
        o.walk += dt * (4 + Math.abs(z.vx) * 0.55);
        if (z.leaps && z.x > tr.x - 4.5) {
          [z.state, z.lt, z.lx, z.leaps] = ['leap', 0, z.x, false];
          this.A.play('roar', undefined, undefined, 0.5);
        }
        o.aim = z.grab ? 0.1 : 0;
        o.attack = z.grab;
        if (this.blasted && z.x > C0 - 0.2 && z.x < C1) [z.state, z.vh, z.vrot] = ['fall', 1, rand(-3, 3)];
      } else if (z.state === 'blocked') {
        o.moving = false;
        o.attack = true;
        o.walk += dt * 3;
      } else if (z.state === 'leap') {
        z.lt += dt / 0.6;
        const k = Math.min(1, z.lt);
        z.x = lerp(z.lx, tr.x + 0.8, k);
        z.h = BED_H * k + Math.sin(k * Math.PI) * 2.2;
        z.d = lerp(0.62, 0.43, k);
        if (k >= 1) [z.state, z.t] = ['bed', 0];
      } else if (z.state === 'bed') {
        z.x = tr.x + 0.8;
        z.h = BED_H;
        o.moving = false;
        o.attack = true;
        o.aim = 0;
        if (z.t > 0.35) {
          // the nearest survivor knocks it straight back off the truck
          const s = this.team.find((q) => q.state === 'bed') || this.team[0];
          s.swing = 0.25;
          this.A.play('melee', undefined, undefined, 0.6);
          this.A.play('hit', undefined, undefined, 0.6);
          this.kill(z, 1.9, tr.v - 9);
          z.vrot = -10;
        }
      } else if (z.state === 'fly') {
        z.x += z.vx * dt;
        z.h += z.vh * dt;
        z.vh -= 20 * dt;
        z.rot += z.vrot * dt;
        if (z.h <= 0 && z.vh < 0) {
          if (this.blasted && z.x > C0 && z.x < C1) z.state = 'fall';
          else {
            [z.h, z.state, z.rot] = [0, 'dead', 0];
            z.vx *= 0.35;
            o.down = true;
            o.moving = false;
            this.splat(z.x, z.d, rand(0.4, 0.7));
            this.burstAt(z.x, z.d, 0.1, 3, ['#7a7088', '#8a8098'], 2, 0.5, 0.16, 's');
          }
        }
      } else if (z.state === 'dead') {
        z.vx *= Math.exp(-dt * 6);
        z.x += z.vx * dt;
      } else if (z.state === 'fall') {
        z.h += z.vh * dt;
        z.vh -= 20 * dt;
        z.rot += z.vrot * dt;
        if (z.h < -2.2) {
          z.gone = true;
          this.burstAt(z.x, z.d, -2, 10, ['#cfe8f6', '#9fd3f0', '#ffffff'], 5, 0.7, 0.13, 'f', 14);
          if (Math.random() < 0.5) this.sfx('splash');
        }
      }
      if (z.x < left - 4 && z.state !== 'fall') z.gone = true;
    }
    if (this.zombies.some((z) => z.gone)) this.zombies = this.zombies.filter((z) => !z.gone);
    if (this.wall && this.wall.x < left - 4) this.wall = null;
  }

  // ---------------------------------------------------------------- scripted moments
  ding() {
    const A = this.A;
    if (!A.ctx) return;
    const t = A.ctx.currentTime + 0.01;
    A.tone(A.sfxBus, t, { type: 'sine', freq: 1318, dur: 0.7, peak: 0.12 });
    A.tone(A.sfxBus, t + 0.2, { type: 'sine', freq: 1046, dur: 0.9, peak: 0.12 });
    setTimeout(() => A.play('door', undefined, undefined, 0.8), 150);
  }

  // the horde floods out of the elevator behind them, and more come round the lab
  burst() {
    this.A.play('roar', undefined, undefined, 0.8);
    if (this.rock) this.rock.set('drive');
    for (let i = 0; i < 6; i++) {
      const z = this.spawn(pick(['runner', 'runner', 'walker', 'armored']), -2 + rand(-0.6, 0.6), rand(0.16, 0.3), { boost: rand(0.6, 1.4) });
      z.x -= i * 0.5;
    }
    for (let i = 0; i < 5; i++) this.spawn('runner', this.cam - 11.5 - i * 0.9, rand(0.3, 0.95), { boost: rand(0.7, 1.4) });
  }

  // a leaper sprints up and jumps into the truck bed
  leaper() {
    const z = this.spawn('leaper', this.cam - VW / 2 / PX - 1, 0.62, { boost: 6 });
    z.leaps = true;
  }

  juggernaut() {
    const left = this.cam - VW / 2 / PX;
    const z = this.spawn('juggernaut', left - 2, 0.74, { vx: V + 3.6 });
    z.fixed = V + 3.6;
    z.u *= 1.15;
    this.jugg = z;
    // a burnt-out car in its path, still burning: it's going to plough straight into it
    this.wrecks.push({ x: z.x + (V + 3.6) * 1.6 + 1.3, d: 0.74, col: '#5a4a44', burn: true, flip: false, rot: 0, h: 0, emit: 0, jugg: true });
    this.A.play('roar', undefined, undefined, 1);
    this.shake += 6;
  }

  updateJugg() {
    const z = this.jugg, car = z && this.wrecks.find((w) => w.jugg && !w.fly);
    if (!car || z.state !== 'run' || z.x < car.x - 1.3) return;
    this.explode(car.x, car.d, 0.6, 3.2, 1.6);
    Object.assign(car, { fly: true, vx: 2, vh: 9, vrot: 2.6 });
    this.kill(z, 2.4, V * 0.25);
    z.vh = 9;
    z.vrot = -3;
    this.jugg = null;
  }

  // Rook's (or the convoy's) airstrike walks right through the pack
  airstrike() {
    const tr = this.truck, rook = this.team.find((s) => s.char === 'rook');
    if (rook) rook.swing = 0.4;
    this.A.play('strike', undefined, undefined, 0.9);
    [[0.9, 3.4, 0.28], [1.05, 6.2, 0.72], [1.2, 8.6, 0.48], [1.35, 5, 0.9]].forEach(([at, back, d]) => this.shells.push({ t: this.T, at: this.T + at, back, d }));
  }

  updateShells() {
    for (const s of this.shells) {
      if (this.T < s.at) continue;
      s.done = true;
      this.explode(this.truck.x - s.back, s.d, 0.2, 2.9, 1.2);
    }
    if (this.shells.some((s) => s.done)) this.shells = this.shells.filter((s) => !s.done);
  }

  ability(s) {
    const tr = this.truck;
    s.swing = 0.35;
    if (s.char === 'brick') {
      // a barricade across the road; the pack behind slams into it
      this.wall = { x: tr.x - 3.4, t: 0 };
      for (const d of [0.15, 0.5, 0.85]) this.burstAt(this.wall.x, d, 0.2, 6, ['#b9a37a', '#8a7a62'], 3, 0.6, 0.2, 's');
      this.A.play('build', undefined, undefined, 0.9);
      this.A.play('slam', undefined, undefined, 0.5);
      this.shake += 4;
    } else if (s.char === 'volt') {
      // chain lightning hopping down the pack
      const hits = this.zombies.filter((z) => this.alive(z) && z.type !== 'juggernaut').sort((a, b) => b.x - a.x).slice(0, 7);
      const pts = [{ x: s.x - 0.5, h: s.h + 1, d: 0.42 }, ...hits.map((z) => ({ x: z.x, h: z.h + 0.9, d: z.d }))];
      this.bolts.push({ pts, life: 0.4 });
      hits.forEach((z, i) => this.kill(z, 1.3, undefined, i > 2));
      this.A.play('zap', undefined, undefined, 1);
      setTimeout(() => this.A.play('zap', undefined, undefined, 0.7), 90);
      this.flash += 0.18;
    } else if (s.char === 'sparks') {
      this.turret = { t: 0, cd: 0, aim: Math.PI };
      this.A.play('build', undefined, undefined, 0.8);
    } else if (s.char === 'doc') {
      // a healing pulse that bowls over everything near the truck
      this.ring = { r: 0, hit: new Set() };
      this.A.play('heal', undefined, undefined, 1);
      for (const q of this.team) this.texts.push({ x: q.x, d: 0.42, h: q.h + 1.9, vh: 1, life: 1, txt: '+HP', col: '#7dff9a' });
    } else if (s.char === 'mags') {
      // supply bags all round: everyone fires twice as fast for a few seconds
      for (const q of this.team) {
        q.boost = this.T + 3.5;
        this.texts.push({ x: q.x, d: 0.42, h: q.h + 1.9, vh: 1, life: 1, txt: '+AMMO', col: '#ffd36a' });
      }
      this.A.play('pickup', undefined, undefined, 1);
    }
  }

  updateAbilities(dt) {
    const tr = this.truck;
    const tu = this.turret;
    if (tu) {
      tu.t += dt;
      if (tu.t > 3.8 || this.cut) this.turret = null;
      else if (tu.t > 0.3 && (tu.cd -= dt) <= 0) {
        const z = this.zombies.filter((q) => this.alive(q)).sort((a, b) => b.x - a.x)[0];
        if (z) {
          tu.cd = 0.085;
          const ox = tr.x + 4.6, oh = 2.95;
          tu.aim = Math.atan2(-(z.h + 0.8 - oh) * PX + (gy(z.d) - gy(0.42)), (z.x - ox) * PX);
          this.tracers.push({ x1: ox + Math.cos(tu.aim) * 0.5, h1: oh, d1: 0.42, x2: z.x, h2: z.h + rand(0.5, 1.1), d2: z.d, life: 0.06, col: '#ffe08a', w: 3 });
          this.A.play('turret', undefined, undefined, 0.45);
          this.hit(z, 1);
        }
      }
    }
    const ring = this.ring;
    if (ring) {
      ring.r += dt * 14;
      for (const z of this.zombies) {
        if (!this.alive(z) || ring.hit.has(z) || Math.abs(z.x - (tr.x + 2)) > ring.r) continue;
        ring.hit.add(z);
        this.kill(z, 1.5, z.vx * 0.3 - 4, true);
      }
      if (ring.r > 11) this.ring = null;
    }
    if (this.jugg) this.updateJugg();
    if (this.shells.length) this.updateShells();
  }

  bridgeHorde() {
    const left = this.cam - VW / 2 / PX, lead = T_BLAST - this.T;
    for (let i = 0; i < 14; i++) {
      const x = left - rand(0.5, 6), z = this.spawn(this.chaserType(), x, rand(0.08, 0.95));
      z.fixed = (rand(C0 + 0.5, C1 - 0.5) - x) / lead;
    }
  }

  blowBridge() {
    [[C0 + 1, 0.3], [C0 + 4.5, 0.75], [C0 + 8, 0.45], [C1 - 1, 0.6]].forEach(([x, d], i) => setTimeout(() => !this.closed && this.explode(x, d, 0.3, 3.4, 1.5), i * 70));
    this.blasted = true;
    this.flash += 0.3;
    if (this.rock) this.rock.set('hit');
    this.shake += 18;
    const w = (C1 - C0) / 4;
    for (let i = 0; i < 4; i++) this.slabs.push({ x: C0 + i * w, w, h: 0, vh: rand(1, 4), rot: 0, vrot: rand(-1.2, 1.2) });
    for (const z of this.zombies) {
      if (z.x > C0 - 1 && z.x < C1 + 1 && z.state !== 'fall') this.kill(z, 1.6, rand(-3, 3), true);
    }
    this.A.play('door', undefined, undefined, 1);
  }

  // cut to the countryside: the truck drives into the sunrise
  sunrise() {
    this.cut = true;
    this.zombies = [];
    this.parts.length = 0;
    this.decals.length = 0;
    this.tracers.length = 0;
    this.bolts.length = 0;
    this.texts.length = 0;
    this.wall = this.turret = this.ring = null;
    this.cam = this.truck.x + 15.5;
    this.birds = Array.from({ length: 6 }, (_, i) => ({ x: -80 - i * 70 - rand(0, 60), y: rand(300, 420) + (i % 2) * 30, v: rand(70, 95), f: rand(0, 6) }));
    if (this.rock) this.rock.set('anthem');
  }

  // ---------------------------------------------------------------- effects
  part(o) {
    if (this.parts.length >= 900) return;
    const p = this.free.pop() || {};
    p.kind = 'f';
    p.vx = p.vh = p.rot = p.vrot = 0;
    p.g = 0;
    p.drag = 1.5;
    p.grow = 0;
    Object.assign(p, o);
    p.max = p.life;
    this.parts.push(p);
  }

  // n particles of a kind: f flat, g glow, s smoke, b blood, r debris
  burstAt(x, d, h, n, cols, speed, life, size, kind = 'f', up = 0, vx0 = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * rand(0.3, 1);
      this.part({
        kind, x, d: d + rand(-0.03, 0.03), h, vx: Math.cos(a) * v + vx0, vh: Math.sin(a) * v + up * rand(0.5, 1),
        life: life * rand(0.6, 1.2), size: size * rand(0.7, 1.3), col: pick(cols), g: kind === 'b' || kind === 'r' ? 14 : kind === 'f' && up ? 16 : 0,
        grow: kind === 's' ? 0.9 : 0, rot: Math.random() * 6, vrot: rand(-8, 8),
      });
    }
  }

  explode(x, d, h, r, power) {
    this.burstAt(x, d, h + 0.6, 1, ['#ffb24a'], 0, 0.2, r * 0.35, 'g');
    this.burstAt(x, d, h + 0.7, 9, ['#ffd36a', '#ff9a3a', '#ff6a2a', '#fff0a0'], 3.2 * power, 0.5, 1.15, 'F', 2);
    this.burstAt(x, d, h + 0.5, 8, ['#ffd36a', '#ff9a3a'], 7 * power, 0.35, 0.35, 'f');
    this.burstAt(x, d, h + 1.1, 9, ['#5a5060', '#6a6070', '#4a4250'], 2.2, 1.6, 0.8, 's', 2.5);
    this.burstAt(x, d, h + 0.4, 9, ['#3a3236', '#5a4a3a', '#7a7f8c'], 9 * power, 1.1, 0.16, 'r', 6);
    this.part({ kind: 'w', x, d, h: 0.05, life: 0.4, size: r });
    this.shake += 10 * power;
    this.flash += 0.05 * power;
    this.splat(x, d, r * 0.45, '#2a2224');
    this.A.play('boom', undefined, undefined, 0.9);
    this.A.play('slam', undefined, undefined, 0.45);
    for (const z of this.zombies) {
      const dd = Math.hypot(z.x - x, (z.d - d) * 5);
      if (dd > r || z.state === 'fall' || z.state === 'leap' || z.type === 'juggernaut') continue;
      if (z.state !== 'fly' && z.state !== 'dead') this.kill(z, 1, 0, true);
      z.state = 'fly';
      z.o.down = false;
      z.vx = Math.sign(z.x - x || 1) * rand(3, 8) + (this.blasted ? 0 : this.truck.v * 0.35);
      z.vh = rand(6, 11) * (1 - (dd / r) * 0.4);
      z.vrot = rand(-12, 12);
    }
  }

  splat(x, d, r, col = '#7a2626') {
    if (this.decals.length > 70) this.decals.shift();
    this.decals.push({ x, d, r, col, rot: Math.random() * 3, seed: (Math.random() * 99) | 0 });
  }

  updateFx(dt) {
    this.updateAbilities(dt);
    for (const p of this.parts) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.h += p.vh * dt;
      p.vh -= p.g * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      if (!p.g) p.vh *= k;
      p.size += p.grow * dt;
      p.rot += p.vrot * dt;
      if (p.h < 0 && p.g && p.kind !== 'f') {
        if (p.kind === 'b' && Math.random() < 0.3) this.splat(p.x, p.d, 0.12);
        p.life = 0;
      }
    }
    if (this.parts.some((p) => p.life <= 0)) {
      const keep = [];
      for (const p of this.parts) (p.life > 0 ? keep : this.free).push(p);
      this.parts = keep;
    }
    for (const t of this.tracers) t.life -= dt;
    for (const b of this.bolts) b.life -= dt;
    for (const t of this.texts) [t.life, t.h] = [t.life - dt, t.h + t.vh * dt];
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.bolts = this.bolts.filter((b) => b.life > 0);
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const s of this.slabs) [s.h, s.vh, s.rot] = [s.h + s.vh * dt, s.vh - 18 * dt, s.rot + s.vrot * dt];
    if (this.slabs.length && this.slabs.every((s) => s.h < -12)) this.slabs = [];
    // burning wrecks keep smoking
    const left = this.cam - 12, right = this.cam + 12;
    for (const w of this.wrecks) {
      if (w.fly) {
        w.x += w.vx * dt;
        w.h += w.vh * dt;
        w.vh -= 20 * dt;
        w.rot += w.vrot * dt;
        if (w.h < 0) Object.assign(w, { fly: false, h: 0, vh: 0, vrot: 0, rot: Math.PI, burn: true });
      }
      if (!w.burn || w.x < left || w.x > right || (w.emit -= dt) > 0) continue;
      w.emit = 0.09;
      this.part({ kind: 'f', x: w.x + rand(-0.8, 0.8), d: w.d, h: 1 + w.h, vx: 0, vh: rand(1.5, 2.6), life: rand(0.35, 0.6), size: rand(0.25, 0.45), col: pick(['#ffd36a', '#ff9a3a', '#ff6a2a']) });
      this.part({ kind: 's', x: w.x + rand(-0.5, 0.5), d: w.d - 0.01, h: 1.5 + w.h, vx: -0.6, vh: rand(1.2, 2), life: rand(1.4, 2.2), size: 0.35, grow: 0.7, col: pick(['#4a4250', '#5a5060']) });
    }
    if (this.birds) for (const b of this.birds) [b.x, b.f] = [b.x + b.v * dt, b.f + dt * 9];
  }

  sfx(kind) {
    const A = this.A;
    if (!A.ctx) return;
    const out = A.ctx.createGain();
    out.connect(A.sfxBus);
    const t = A.ctx.currentTime + 0.01;
    if (kind === 'splash') A.noiseHit(out, t, { dur: 0.5, peak: 0.35, type: 'lowpass', freq: 1400, freqEnd: 200 });
    else if (kind === 'rev') A.tone(out, t, { type: 'sawtooth', freq: 55, freqEnd: 130, dur: 1.2, peak: 0.12 });
    setTimeout(() => out.disconnect(), 3000);
  }

  // ---------------------------------------------------------------- drawing
  // world point -> virtual screen
  sx(x) {
    return (x - this.cam) * PX + VW / 2;
  }
  sy(d, h) {
    return gy(d) - h * PX * ds(d);
  }

  // a cached canvas drawn at the screen's real resolution (w, h in virtual pixels)
  sprite(key, w, h, draw) {
    let s = this.cache.get(key);
    if (!s) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * this.S);
      c.height = Math.ceil(h * this.S);
      const g = c.getContext('2d');
      g.scale(this.S, this.S);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      draw(g);
      s = { c, w, h };
      this.cache.set(key, s);
    }
    return s;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(3840, Math.round(this.canvas.clientWidth * dpr)), h = Math.min(2160, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height && this.S) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.S = Math.min(w / VW, h / VH);
    this.ox = (w - VW * this.S) / 2;
    this.oy = (h - VH * this.S) / 2;
    this.cache.clear();
  }

  draw() {
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return; // not on screen
    this.resize();
    const c = this.ctx, T = this.T;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.S, 0, 0, this.S, this.ox, this.oy);
    c.save();
    c.beginPath();
    c.rect(0, 0, VW, VH);
    c.clip();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const day = this.cut ? lerp(0.62, 1, smooth((T - T_CUT) / 5)) : 0.42 * smooth((T - 15) / 7);
    this.drawSky(c, day);
    this.layer(c, 'far', 0.18, 520, 430, 655, (g, i, reg) => this.farChunk(g, i, reg));
    this.layer(c, 'mid', 0.55, 640, 560, 676, (g, i, reg) => this.midChunk(g, i, reg));
    const shx = (Math.random() - 0.5) * this.shake, shy = (Math.random() - 0.5) * this.shake;
    c.save();
    c.translate(shx, shy);
    this.drawRoad(c);
    this.drawDecals(c);
    this.drawWorld(c);
    this.drawFx(c);
    c.restore();
    // dawn light: cool and dim, warming to the sunrise
    c.fillStyle = `rgba(52,26,78,${0.12 * (1 - day)})`;
    c.fillRect(0, 0, VW, VH);
    if (day > 0.3) {
      c.fillStyle = `rgba(255,190,110,${0.1 * (day - 0.3)})`;
      c.fillRect(0, 0, VW, VH);
    }
    const vig = this.sprite('vig', VW / 4, VH / 4, (g) => {
      const gr = g.createRadialGradient(VW / 8, VH / 8, VH / 14, VW / 8, VH / 8, VW / 6.2);
      gr.addColorStop(0, 'rgba(10,6,4,0)');
      gr.addColorStop(1, 'rgba(10,6,4,0.4)');
      g.fillStyle = gr;
      g.fillRect(0, 0, VW / 4, VH / 4);
    });
    c.drawImage(vig.c, 0, 0, VW, VH);
    if (this.flash > 0.01) {
      c.fillStyle = `rgba(255,248,225,${Math.min(0.85, this.flash)})`;
      c.fillRect(0, 0, VW, VH);
    }
    if (this.dip > 0) {
      c.fillStyle = `rgba(0,0,0,${Math.sin(this.dip * Math.PI)})`;
      c.fillRect(0, 0, VW, VH);
    }
    c.fillStyle = '#000';
    c.fillRect(0, 0, VW, BAR);
    c.fillRect(0, VH - BAR, VW, BAR);
    c.restore();
  }

  drawSky(c, k) {
    const g = c.createLinearGradient(0, BAR, 0, 700);
    SKY.dawn.forEach((col, i) => g.addColorStop(i / 2, mixRgb(col, SKY.day[i], k)));
    c.fillStyle = g;
    c.fillRect(0, 0, VW, 720);
    // the sun comes up over the hills as they get away
    const sunY = lerp(720, 330, k), sunX = 1420;
    const glow = this.sprite('sunglow', 600, 600, (s) => {
      const gr = s.createRadialGradient(300, 300, 40, 300, 300, 300);
      gr.addColorStop(0, 'rgba(255,236,170,0.9)');
      gr.addColorStop(0.25, 'rgba(255,200,120,0.35)');
      gr.addColorStop(1, 'rgba(255,170,90,0)');
      s.fillStyle = gr;
      s.fillRect(0, 0, 600, 600);
    });
    c.globalAlpha = 0.35 + 0.65 * k;
    c.drawImage(glow.c, sunX - 300, sunY - 300, 600, 600);
    c.globalAlpha = 1;
    circle(c, sunX, sunY, 62);
    c.fillStyle = mixRgb([255, 170, 110], [255, 236, 170], k);
    c.fill();
    if (this.birds) {
      c.strokeStyle = 'rgba(42,29,22,0.75)';
      c.lineWidth = 3.5;
      for (const b of this.birds) {
        const f = Math.sin(b.f) * 9;
        c.beginPath();
        c.moveTo(b.x - 14, b.y - f);
        c.quadraticCurveTo(b.x - 6, b.y - 8, b.x, b.y);
        c.quadraticCurveTo(b.x + 6, b.y - 8, b.x + 14, b.y - f);
        c.stroke();
      }
    }
  }

  // parallax scenery in cached chunks (only the visible ones are kept)
  layer(c, name, f, w, h, base, gen) {
    const off = this.cam * PX * f;
    const first = Math.floor((off - VW / 2) / w);
    for (let i = first; i <= first + Math.ceil(VW / w) + 1; i++) {
      const reg = region((i * w + w / 2) / (PX * f));
      const spr = this.sprite(`${name}${i}`, w, h, (g) => gen(g, i, reg));
      c.drawImage(spr.c, Math.floor((i * w - off + VW / 2) * this.S) / this.S, base - h, w + 1.5, h);
    }
    if (this.firsts[name] === first) return;
    this.firsts[name] = first;
    for (const k of this.cache.keys()) {
      if (!k.startsWith(name)) continue;
      const i = +k.slice(name.length);
      if (i < first - 1 || i > first + Math.ceil(VW / w) + 2) this.cache.delete(k);
    }
  }

  farChunk(g, i, reg) {
    const r = srng(i * 31 + 7), w = 520, h = 430;
    if (reg === 'lab' || reg === 'city') {
      // a ruined skyline, a few windows still lit, smoke rising from the city
      for (let x = -20; x < w; x += 30 + r() * 50) {
        const bw = 44 + r() * 70, bh = 110 + r() * (reg === 'lab' ? 160 : 260);
        g.fillStyle = r() < 0.5 ? '#4a3f60' : '#55496c';
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x, h - bh);
        if (r() < 0.45) {
          g.lineTo(x + bw * 0.35, h - bh + 18 + r() * 20);
          g.lineTo(x + bw * 0.6, h - bh - 10);
        }
        g.lineTo(x + bw, h - bh + (r() < 0.4 ? 26 : 0));
        g.lineTo(x + bw, h);
        g.fill();
        for (let k = 0; k < 4; k++) {
          if (r() < 0.5) continue;
          g.fillStyle = 'rgba(255,200,120,0.55)';
          g.fillRect(x + 8 + r() * (bw - 20), h - bh + 20 + r() * (bh - 40), 6, 8);
        }
        if (r() < 0.12) {
          g.fillStyle = 'rgba(106,95,120,0.35)';
          for (let k = 0; k < 7; k++) {
            circle(g, x + bw / 2 + Math.sin(k) * 10 + k * 6, h - bh - k * 34, 16 + k * 6);
            g.fill();
          }
        }
      }
    } else {
      // rolling hills (continuous across chunks), pines on the far ridge
      for (const [col, base, amp, sc] of [['#6a5a7c', 210, 60, 230], ['#7d6c86', 150, 45, 140]]) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(0, h);
        for (let x = 0; x <= w; x += 20) {
          const gx = i * w + x;
          g.lineTo(x, h - base - Math.sin(gx / sc) * amp - Math.sin(gx / 61 + 1.3) * amp * 0.3);
        }
        g.lineTo(w, h);
        g.fill();
      }
      g.fillStyle = '#5a4c6c';
      for (let k = 0; k < 9; k++) {
        const x = r() * w, gx = i * w + x, y = h - 210 - Math.sin(gx / 230) * 60 - Math.sin(gx / 61 + 1.3) * 18 + 6;
        g.beginPath();
        g.moveTo(x - 9, y);
        g.lineTo(x, y - 30 - r() * 14);
        g.lineTo(x + 9, y);
        g.fill();
      }
    }
  }

  midChunk(g, i, reg) {
    const r = srng(i * 17 + 3), w = 640, h = 560;
    g.lineWidth = 4;
    g.strokeStyle = EDGE;
    if (reg === 'lab' && i === 0) {
      // Prometheus Labs: the research block they just escaped from
      const x = 60, bw = 520, bh = 300;
      rr(g, x, h - bh, bw, bh, 14);
      g.fillStyle = '#6a6f7c';
      g.fill();
      g.stroke();
      rr(g, x + 150, h - bh - 110, 220, 130, 60);
      g.fillStyle = '#5a5f6c';
      g.fill();
      g.stroke();
      g.fillStyle = '#3a3f4c';
      g.fillRect(x + 20, h - bh + 26, bw - 40, 54);
      g.font = '700 34px Fredoka';
      g.textAlign = 'center';
      g.fillStyle = '#e6e1d0';
      g.fillText('PROMETHEUS LABS', x + bw / 2, h - bh + 66);
      for (let k = 0; k < 7; k++) {
        rr(g, x + 34 + k * 68, h - bh + 112, 40, 52, 6);
        g.fillStyle = k % 3 === 1 ? '#c94a3a' : '#2b2a3a';
        g.fill();
        g.stroke();
      }
      for (let k = 0; k < 10; k++) {
        g.fillStyle = k % 2 ? '#f2c14e' : '#2a2a2a';
        g.fillRect(x + k * (bw / 10), h - 26, bw / 10, 26);
      }
      return;
    }
    if (reg === 'city' || reg === 'lab') {
      for (let x = 14; x < w - 150; ) {
        const bw = 140 + r() * Math.min(120, w - x - 150), bh = 220 + r() * 250, col = WALLS[(r() * WALLS.length) | 0];
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x, h - bh);
        const broken = r() < 0.5;
        if (broken) {
          g.lineTo(x + bw * 0.25, h - bh + 14);
          g.lineTo(x + bw * 0.4, h - bh - 8);
          g.lineTo(x + bw * 0.62, h - bh + 26);
        }
        g.lineTo(x + bw, h - bh + (broken ? 40 : 0));
        g.lineTo(x + bw, h);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.stroke();
        if (!broken) {
          rr(g, x - 6, h - bh - 14, bw + 12, 22, 6);
          g.fillStyle = shade(col, -0.25);
          g.fill();
          g.stroke();
        }
        for (let wy = h - bh + 54; wy < h - 70; wy += 62) {
          for (let wx = x + 18; wx < x + bw - 34; wx += 48) {
            rr(g, wx, wy, 26, 34, 5);
            const lit = r();
            g.fillStyle = lit < 0.12 ? '#ffcf7a' : '#2b2a3a';
            g.fill();
            g.stroke();
            if (lit > 0.85) {
              // boarded up
              g.strokeStyle = '#8a6a4a';
              g.lineWidth = 6;
              g.beginPath();
              g.moveTo(wx - 4, wy + 6);
              g.lineTo(wx + 30, wy + 26);
              g.stroke();
              g.strokeStyle = EDGE;
              g.lineWidth = 4;
            }
          }
        }
        rr(g, x + bw / 2 - 22, h - 64, 44, 64, 6);
        g.fillStyle = '#3a3036';
        g.fill();
        g.stroke();
        x += bw + 24 + r() * 50;
      }
      // a street lamp and a dead tree out front
      const lx = 40 + r() * (w - 80);
      g.fillStyle = '#5a5f6a';
      g.fillRect(lx - 4, h - 190, 8, 190);
      rr(g, lx - 4, h - 200, 40, 14, 6);
      g.fill();
      g.stroke();
      if (r() < 0.6) drawTree(g, 30 + r() * (w - 60), h, 46, 1.1, 'dead', i);
    } else if (reg === 'country') {
      // fence, oak trees and bushes along the fields
      g.strokeStyle = '#8a6a48';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, h - 40);
      g.lineTo(w, h - 40);
      g.moveTo(0, h - 70);
      g.lineTo(w, h - 70);
      g.stroke();
      for (let x = 20; x < w; x += 80) {
        rr(g, x - 6, h - 92, 12, 92, 4);
        g.fillStyle = '#9a7a54';
        g.fill();
        g.strokeStyle = EDGE;
        g.lineWidth = 3;
        g.stroke();
      }
      for (let k = 0; k < 3; k++) drawTree(g, 70 + k * 200 + r() * 90, h - 6, 62, 1 + r() * 0.35, r() < 0.3 ? 'fruit' : 'oak', i * 7 + k);
      for (let k = 0; k < 2; k++) drawBush(g, 40 + r() * (w - 80), h, 44, i * 3 + k);
    }
  }

  drawRoad(c) {
    const L = this.cam - VW / 2 / PX - 1, R = this.cam + VW / 2 / PX + 1;
    const seg = (x0, x1, fn) => {
      const a = Math.max(L, x0), b = Math.min(R, x1);
      if (a < b) fn(this.sx(a), this.sx(b), a, b);
    };
    const kerbs = (X0, X1, verge, side, lines) => {
      c.fillStyle = verge;
      c.fillRect(X0, 660, X1 - X0, GY0 - 660);
      c.fillStyle = side;
      c.fillRect(X0, GY1 + 10, X1 - X0, VH - GY1);
      c.fillStyle = lines;
      c.fillRect(X0, GY0 - 7, X1 - X0, 7);
      c.fillRect(X0, GY1, X1 - X0, 10);
    };
    const asphalt = (X0, X1, a, b, col) => {
      c.fillStyle = col;
      c.fillRect(X0, GY0, X1 - X0, GY1 - GY0);
      c.fillStyle = 'rgba(232,222,186,0.75)';
      for (let x = Math.floor(a / 5) * 5; x < b; x += 5) c.fillRect(this.sx(x), (GY0 + GY1) / 2 - 4, 2.2 * PX, 8);
    };
    seg(-50, XB, (X0, X1, a, b) => {
      kerbs(X0, X1, '#5c5866', '#5c5866', '#6a6676');
      asphalt(X0, X1, a, b, '#47434f');
      c.fillStyle = '#524e5c';
      for (let x = Math.floor(a / 2) * 2; x < b; x += 2) c.fillRect(this.sx(x), GY1 + 10, 3, VH - GY1);
    });
    seg(XB, XB + BL, (X0, X1, a, b) => {
      // the river under the bridge
      c.fillStyle = '#3f7aa6';
      c.fillRect(X0, 640, X1 - X0, GY0 - 640);
      c.fillRect(X0, GY1, X1 - X0, VH - GY1);
      c.fillStyle = 'rgba(207,232,246,0.5)';
      for (let k = 0; k < 8; k++) c.fillRect(X0 + ((k * 211 + this.T * 30) % Math.max(1, X1 - X0)), 1000 + (k % 4) * 18, 60, 4);
      asphalt(X0, X1, a, b, '#4d4a55');
      c.fillStyle = '#5a5f6a';
      c.fillRect(X0, GY1, X1 - X0, 34);
      c.fillStyle = '#3d4048';
      for (let x = Math.ceil(a / 1.5) * 1.5; x < b; x += 1.5) c.fillRect(this.sx(x), GY1 + 14, 6, 6);
      c.fillStyle = '#7a7f8c';
      for (const px of [XB + 2, XB + BL / 2, XB + BL - 2]) c.fillRect(this.sx(px) - 34, GY1 + 34, 68, VH);
    });
    seg(XB + BL, R + 1, (X0, X1, a, b) => {
      kerbs(X0, X1, '#7fb35a', '#93c266', '#6a9a4a');
      asphalt(X0, X1, a, b, '#5a5560');
    });
    if (this.blasted) {
      // the blown span: a hole down to the water
      seg(C0, C1, (X0, X1) => {
        c.fillStyle = '#2f5f86';
        c.fillRect(X0, GY0 - 2, X1 - X0, GY1 - GY0 + 40);
        c.fillStyle = 'rgba(207,232,246,0.35)';
        c.fillRect(X0, GY1 - 30, X1 - X0, 5);
        c.fillStyle = '#4d4a55';
        for (const [X, s] of [[X0, 1], [X1, -1]]) {
          c.beginPath();
          c.moveTo(X, GY0);
          for (let k = 0; k <= 6; k++) c.lineTo(X + s * (k % 2 ? 26 : 8), GY0 + ((GY1 - GY0) * k) / 6);
          c.lineTo(X, GY1);
          c.fill();
        }
      });
    }
  }

  drawDecals(c) {
    for (const s of this.decals) {
      const X = this.sx(s.x);
      if (X < -100 || X > VW + 100 || (this.blasted && s.x > C0 && s.x < C1)) continue;
      c.fillStyle = s.col;
      c.globalAlpha = 0.55;
      ellipse(c, X, gy(s.d), s.r * PX, s.r * PX * 0.38);
      c.fill();
      ellipse(c, X + s.r * PX * 0.6, gy(s.d) + 4, s.r * PX * 0.3, s.r * PX * 0.14);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  // everything standing on the road, far to near
  drawWorld(c) {
    const L = this.cam - VW / 2 / PX - 5, R = this.cam + VW / 2 / PX + 8;
    const list = this.draws;
    list.length = 0;
    const add = (d, kind, o) => list.push({ d, kind, o });
    if (this.cam < 16) add(0.12, 'lift');
    for (const w of this.wrecks) if (w.x > L && w.x < R) add(w.d, 'car', w);
    for (const z of this.zombies) if (z.x > L && z.x < R && z.state !== 'bed' && z.state !== 'leap') add(z.d, 'z', z);
    for (const s of this.team) if (s.state === 'run' || (s.state === 'wait' && this.doors > 0.5)) add(s.d, 's', s);
    if (this.wall) for (const d of [0.15, 0.5, 0.85]) add(d, 'wall', d);
    if (XB < R && XB + BL > L) {
      add(-0.2, 'truss');
      add(1.2, 'rail');
    }
    add(0.42, 'truck');
    list.sort((a, b) => a.d - b.d);
    for (const it of list) {
      if (it.kind === 'z') this.drawZombie(c, it.o);
      else if (it.kind === 's') this.drawSurvivor(c, it.o);
      else if (it.kind === 'car') this.drawCar(c, it.o);
      else if (it.kind === 'truck') this.drawTruck(c);
      else if (it.kind === 'wall') this.drawWallPiece(c, it.o);
      else if (it.kind === 'lift') this.drawLift(c);
      else if (it.kind === 'truss') this.drawTruss(c);
      else this.drawRail(c);
    }
  }

  drawZombie(c, z) {
    const X = this.sx(z.x), Y = this.sy(z.d, z.h);
    if (z.state === 'fly' || z.state === 'fall') {
      c.save();
      c.translate(X, Y - z.u * 0.6);
      c.rotate(z.rot);
      c.translate(-X, -(Y - z.u * 0.6));
      drawPerson(c, X, Y, z.u, z.o);
      c.restore();
    } else drawPerson(c, X, Y, z.u, z.o);
  }

  drawSurvivor(c, s) {
    const u = PX * ds(s.state === 'bed' || s.state === 'jump' ? 0.42 : s.d) * 1.12;
    const X = this.sx(s.x), Y = this.sy(s.state === 'bed' || s.state === 'jump' ? 0.42 : s.d, s.h) + (s.state === 'bed' ? this.bounce : 0);
    if (s.state === 'wait') c.globalAlpha = clamp01((this.doors - 0.5) * 3);
    drawPerson(c, X, Y, Math.round(u), s.o);
    c.globalAlpha = 1;
    if (s.swing > 0) {
      // a knife / bash swipe
      const k = 1 - s.swing / 0.35, a = s.aim;
      c.strokeStyle = `rgba(255,250,235,${0.85 * (1 - k)})`;
      c.lineWidth = 10;
      c.beginPath();
      c.arc(X, Y - u * 0.75, u * 0.85, a - 0.9 + k * 0.6, a + 0.5 + k * 0.6);
      c.stroke();
    }
  }

  drawLift(c) {
    const X = this.sx(-2), Y = gy(0.12), m = PX * ds(0.12);
    c.lineWidth = 5;
    c.strokeStyle = EDGE;
    rr(c, X - 1.7 * m, Y - 3.7 * m, 3.4 * m, 3.7 * m, 14);
    c.fillStyle = '#7a7f8c';
    c.fill();
    c.stroke();
    // inside: warm light, then the doors sliding apart
    const dw = 1.15 * m, dh = 2.5 * m, open = this.doors;
    c.fillStyle = '#ffe2a8';
    c.fillRect(X - dw, Y - dh, dw * 2, dh);
    c.fillStyle = '#9aa0aa';
    c.fillRect(X - dw, Y - dh, dw * (1 - open), dh);
    c.fillRect(X + dw * open, Y - dh, dw * (1 - open), dh);
    c.strokeRect(X - dw, Y - dh, dw * 2, dh);
    rr(c, X - 0.9 * m, Y - 3.35 * m, 1.8 * m, 0.5 * m, 8);
    c.fillStyle = '#3a3f4c';
    c.fill();
    c.stroke();
    c.font = '700 30px Fredoka';
    c.textAlign = 'center';
    c.fillStyle = '#e6e1d0';
    c.fillText('LIFT 01', X, Y - 3.0 * m);
    for (let k = 0; k < 8; k++) {
      c.fillStyle = k % 2 ? '#f2c14e' : '#2a2a2a';
      c.fillRect(X - 1.7 * m + k * ((3.4 * m) / 8), Y - 0.25 * m, (3.4 * m) / 8, 0.25 * m);
    }
    // red beacon
    const on = Math.sin(this.T * 9) > 0;
    circle(c, X, Y - 3.85 * m, 13);
    c.fillStyle = on ? '#ff4a3a' : '#7a2a2a';
    c.fill();
    c.stroke();
    if (on) {
      c.globalCompositeOperation = 'lighter';
      circle(c, X, Y - 3.85 * m, 50);
      c.fillStyle = 'rgba(255,70,50,0.25)';
      c.fill();
      c.globalCompositeOperation = 'source-over';
    }
  }

  drawCar(c, w) {
    const spr = this.sprite(`car${w.col}${w.burn ? 'b' : ''}`, 420, 200, (g) => {
      // a side-on wreck: rounded body, cabin, dark windows, flat tyres
      g.lineWidth = 5;
      g.strokeStyle = EDGE;
      const col = w.burn ? shade(w.col, -0.45) : w.col;
      rr(g, 20, 70, 380, 80, 30);
      g.fillStyle = col;
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(110, 74);
      g.quadraticCurveTo(130, 18, 190, 16);
      g.lineTo(280, 16);
      g.quadraticCurveTo(320, 20, 340, 74);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = w.burn ? '#2a2228' : '#3a4a5a';
      rr(g, 140, 30, 80, 40, 10);
      g.fill();
      rr(g, 232, 30, 82, 40, 10);
      g.fill();
      for (const x of [100, 320]) {
        circle(g, x, 152, 34);
        g.fillStyle = '#2a2a2e';
        g.fill();
        g.stroke();
        circle(g, x, 152, 13);
        g.fillStyle = '#6a6a70';
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      rr(g, 40, 82, 150, 12, 6);
      g.fill();
    });
    const X = this.sx(w.x), Y = this.sy(w.d, w.h), s = ds(w.d) * 0.95;
    c.save();
    c.translate(X, Y - 90 * s);
    if (w.rot) c.rotate(w.rot);
    if (w.flip) c.scale(-1, 1);
    c.drawImage(spr.c, -210 * s, -100 * s + 6, 420 * s, 200 * s);
    c.restore();
  }

  drawWallPiece(c, d) {
    const X = this.sx(this.wall.x), Y = gy(d), m = PX * ds(d);
    c.lineWidth = 5;
    c.strokeStyle = EDGE;
    for (let k = 0; k < 3; k++) {
      rr(c, X - 0.35 * m, Y - (0.55 + k * 0.5) * m, 0.7 * m, 0.48 * m, 6);
      c.fillStyle = k % 2 ? '#a8865a' : '#b9976a';
      c.fill();
      c.stroke();
    }
    c.fillStyle = '#c9ccd4';
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.moveTo(X - 0.35 * m, Y - (0.4 + k * 0.5) * m);
      c.lineTo(X - 0.75 * m, Y - (0.3 + k * 0.5) * m);
      c.lineTo(X - 0.35 * m, Y - (0.2 + k * 0.5) * m);
      c.fill();
      c.stroke();
    }
  }

  drawTruss(c) {
    const top = GY0 - 3.4 * PX * ds(0), bot = GY0 - 0.25 * PX;
    const ok = (x) => !this.blasted || x < C0 || x > C1;
    c.lineWidth = 16;
    for (const [col, w] of [[EDGE, 16], ['#a8543e', 10]]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      for (let x = XB; x < XB + BL; x += 4) {
        if (!ok(x) || !ok(x + 4)) continue;
        const a = this.sx(x), b = this.sx(x + 4);
        c.moveTo(a, top);
        c.lineTo(b, top);
        c.moveTo(a, bot);
        c.lineTo(b, bot);
        c.moveTo(a, top);
        c.lineTo(a, bot);
        c.moveTo(a, bot);
        c.lineTo(b, top);
      }
      c.stroke();
    }
    if (this.blasted) return;
    // the charges, blinking
    const on = Math.sin(this.T * 10) > 0;
    for (const x of [C0 + 2, (C0 + C1) / 2, C1 - 2]) {
      const X = this.sx(x);
      rr(c, X - 18, bot - 30, 36, 26, 5);
      c.fillStyle = '#6a5a3a';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = EDGE;
      c.stroke();
      circle(c, X, bot - 36, 7);
      c.fillStyle = on ? '#ff4a3a' : '#6a2020';
      c.fill();
    }
  }

  drawRail(c) {
    const y = GY1 + 4, h = 0.8 * PX * ds(1);
    c.strokeStyle = EDGE;
    c.lineWidth = 12;
    const runs = this.blasted ? [[XB, C0], [C1, XB + BL]] : [[XB, XB + BL]];
    for (const [col, w] of [[EDGE, 12], ['#a8543e', 7]]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      for (const [a, b] of runs) {
        c.moveTo(this.sx(a), y - h);
        c.lineTo(this.sx(b), y - h);
        for (let x = a; x <= b; x += 2.5) {
          c.moveTo(this.sx(x), y - h);
          c.lineTo(this.sx(x), y);
        }
      }
      c.stroke();
    }
    for (const s of this.slabs) {
      const X = this.sx(s.x + s.w / 2), Y = (GY0 + GY1) / 2 - s.h * PX;
      c.save();
      c.translate(X, Y);
      c.rotate(s.rot);
      rr(c, (-s.w * PX) / 2, -50, s.w * PX, 100, 10);
      c.fillStyle = '#4d4a55';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = EDGE;
      c.stroke();
      c.restore();
    }
  }

  // the getaway truck: cab and bed behind the survivors, the bed's side panel and wheels in front
  drawTruck(c) {
    const tr = this.truck, X = this.sx(tr.x), m = PX * ds(0.42);
    this.bounce = tr.v > 1 ? Math.sin(this.T * 19) * 2.2 + (Math.sin(this.T * 5.3) > 0.97 ? -5 : 0) : 0;
    const Y = gy(0.42), B = Y + this.bounce;
    c.lineWidth = 5;
    c.strokeStyle = EDGE;
    ellipse(c, X + 3.2 * m, Y + 4, 3.5 * m, 0.32 * m);
    c.fillStyle = 'rgba(20,14,10,0.28)';
    c.fill();
    rr(c, X + 0.1 * m, B - 1.05 * m, 6.1 * m, 0.55 * m, 10);
    c.fillStyle = '#3a3a2a';
    c.fill();
    rr(c, X + 0.05 * m, B - 1.75 * m, 3.9 * m, 0.75 * m, 10);
    c.fillStyle = '#56632c';
    c.fill();
    c.stroke();
    // cab, hood and the driver behind the glass
    rr(c, X + 5.1 * m, B - 1.75 * m, 1.35 * m, 0.95 * m, 18);
    c.fillStyle = '#6f7d3c';
    c.fill();
    c.stroke();
    rr(c, X + 3.95 * m, B - 2.6 * m, 1.6 * m, 1.75 * m, 22);
    c.fill();
    c.stroke();
    circle(c, X + 4.75 * m, B - 1.95 * m, 0.26 * m);
    c.fillStyle = '#c89070';
    c.fill();
    c.beginPath();
    c.arc(X + 4.75 * m, B - 2.0 * m, 0.28 * m, Math.PI, 0);
    c.fillStyle = '#3a4a2a';
    c.fill();
    rr(c, X + 4.15 * m, B - 2.4 * m, 1.2 * m, 0.62 * m, 10);
    c.fillStyle = 'rgba(159,211,240,0.55)';
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    rr(c, X + 4.3 * m, B - 2.3 * m, 0.35 * m, 0.1 * m, 4);
    c.fill();
    c.fillStyle = '#f2e6c4';
    star(c, X + 4.75 * m, B - 1.35 * m, 0.22 * m);
    rr(c, X + 6.3 * m, B - 1.6 * m, 0.22 * m, 0.25 * m, 5);
    c.fillStyle = '#ffe9a8';
    c.fill();
    c.stroke();
    for (const z of this.zombies) if (z.state === 'bed' || z.state === 'leap') this.drawZombie(c, z);
    for (const s of this.team) if (s.state === 'bed' || s.state === 'jump') this.drawSurvivor(c, s);
    // near side of the bed, covering the survivors' legs
    c.lineWidth = 5;
    c.strokeStyle = EDGE;
    rr(c, X, B - 1.6 * m, 3.98 * m, 1.1 * m, 14);
    c.fillStyle = '#6f7d3c';
    c.fill();
    c.stroke();
    c.fillStyle = '#f2e6c4';
    rr(c, X + 0.2 * m, B - 1.36 * m, 3.55 * m, 0.11 * m, 5);
    c.fill();
    c.fillStyle = '#56632c';
    for (let k = 0; k < 6; k++) {
      circle(c, X + (0.35 + k * 0.65) * m, B - 0.68 * m, 4);
      c.fill();
    }
    for (const wx of [1.2, 5.2]) {
      const cx = X + wx * m, cy = Y - 0.55 * m, r = 0.55 * m;
      c.beginPath();
      c.arc(cx, cy + this.bounce * 0.5, r + 10, Math.PI, 0);
      c.fillStyle = '#3a3a2a';
      c.fill();
      circle(c, cx, cy, r);
      c.fillStyle = '#2a2a2e';
      c.fill();
      c.stroke();
      circle(c, cx, cy, r * 0.45);
      c.fillStyle = '#8a8f7a';
      c.fill();
      c.stroke();
      c.strokeStyle = '#5a5f4a';
      c.lineWidth = 4;
      c.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = tr.wheel + (k * Math.PI * 2) / 3;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42);
      }
      c.stroke();
      c.strokeStyle = EDGE;
      c.lineWidth = 5;
    }
    // Sparks' turret on the cab roof
    const tu = this.turret;
    if (tu) {
      const k = smooth(tu.t / 0.3), ox = X + 4.6 * m, oy = B - 2.6 * m;
      c.save();
      c.translate(ox, oy);
      c.scale(k, k);
      rr(c, -26, -34, 52, 34, 8);
      c.fillStyle = '#3070c0';
      c.fill();
      c.stroke();
      c.rotate(tu.aim);
      rr(c, 0, -26, 58, 14, 5);
      c.fillStyle = '#4a4a52';
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  drawFx(c) {
    // tracers
    for (const t of this.tracers) {
      c.strokeStyle = t.col;
      c.lineWidth = t.w;
      c.globalAlpha = Math.min(1, t.life / 0.05);
      c.beginPath();
      c.moveTo(this.sx(t.x1), this.sy(t.d1, t.h1) + (this.bounce || 0));
      c.lineTo(this.sx(t.x2), this.sy(t.d2, t.h2));
      c.stroke();
    }
    c.globalAlpha = 1;
    // chain lightning, re-jittered every frame
    for (const b of this.bolts) {
      for (const [col, w] of [['rgba(120,190,255,0.5)', 16], ['#e8f6ff', 5]]) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        for (let i = 0; i < b.pts.length - 1; i++) {
          const p = b.pts[i], q = b.pts[i + 1];
          const ax = this.sx(p.x), ay = this.sy(p.d, p.h), bx = this.sx(q.x), by = this.sy(q.d, q.h);
          c.moveTo(ax, ay);
          for (let k = 1; k < 6; k++) c.lineTo(lerp(ax, bx, k / 6) + rand(-14, 14), lerp(ay, by, k / 6) + rand(-14, 14));
          c.lineTo(bx, by);
        }
        c.stroke();
      }
    }
    // incoming shells
    for (const s of this.shells) {
      const k = clamp01((this.T - s.t - (s.at - s.t - 0.45)) / 0.45);
      if (k <= 0) continue;
      const x = this.sx(this.truck.x - s.back), y = this.sy(s.d, 0);
      const hx = x + (1 - k) * 700, hy = y - (1 - k) * 900;
      c.strokeStyle = 'rgba(255,240,200,0.8)';
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(hx + 90, hy - 116);
      c.stroke();
    }
    // the Doc's pulse
    if (this.ring) {
      const X = this.sx(this.truck.x + 2), Y = gy(0.42);
      c.strokeStyle = `rgba(125,255,154,${0.8 * (1 - this.ring.r / 11)})`;
      c.lineWidth = 14;
      ellipse(c, X, Y - 40, this.ring.r * PX, this.ring.r * PX * 0.32);
      c.stroke();
    }
    for (const p of this.parts) {
      const X = this.sx(p.x), Y = this.sy(p.d, p.h), r = p.size * PX * 0.5, a = clamp01(p.life / p.max);
      if (X < -200 || X > VW + 200) continue;
      if (p.kind === 'g') {
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = a;
        circle(c, X, Y, r * 2);
        c.fillStyle = p.col;
        c.fill();
        c.globalCompositeOperation = 'source-over';
      } else if (p.kind === 's') {
        c.globalAlpha = a * 0.55;
        circle(c, X, Y, r);
        c.fillStyle = p.col;
        c.fill();
      } else if (p.kind === 'r') {
        c.globalAlpha = 1;
        c.save();
        c.translate(X, Y);
        c.rotate(p.rot);
        c.fillStyle = p.col;
        c.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
        c.restore();
      } else if (p.kind === 'w') {
        const k = 1 - a;
        c.globalAlpha = a;
        c.strokeStyle = '#fff2c8';
        c.lineWidth = 10 * a + 2;
        ellipse(c, X, Y, p.size * PX * k, p.size * PX * k * 0.32);
        c.stroke();
      } else if (p.kind === 'F') {
        c.globalAlpha = 1;
        circle(c, X, Y, r * (0.35 + a * 0.65));
        c.fillStyle = p.col;
        c.fill();
        c.lineWidth = 4;
        c.strokeStyle = EDGE;
        c.stroke();
      } else {
        c.globalAlpha = p.kind === 'b' ? 1 : a;
        circle(c, X, Y, r * (p.kind === 'f' ? 0.4 + a * 0.6 : 1));
        c.fillStyle = p.col;
        c.fill();
      }
    }
    c.globalAlpha = 1;
    // damage numbers, as in the game
    c.font = '700 30px Fredoka';
    c.textAlign = 'center';
    c.lineWidth = 7;
    c.strokeStyle = EDGE;
    for (const t of this.texts) {
      const X = this.sx(t.x), Y = this.sy(t.d, t.h);
      c.globalAlpha = clamp01(t.life * 3);
      c.strokeText(t.txt, X, Y);
      c.fillStyle = t.col || '#fbf1dc';
      c.fillText(t.txt, X, Y);
    }
    c.globalAlpha = 1;
  }
}

function star(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr2 = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  c.closePath();
  c.fill();
}

// engine: low-passed noise chugging at a rate that rises with speed, plus a low growl
function engineSound(A) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = A.noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const chop = ctx.createGain();
  chop.gain.value = 0.6;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 16;
  const depth = ctx.createGain();
  depth.gain.value = 0.35;
  lfo.connect(depth).connect(chop.gain);
  const growl = ctx.createOscillator();
  growl.type = 'sawtooth';
  growl.frequency.value = 46;
  const glp = ctx.createBiquadFilter();
  glp.type = 'lowpass';
  glp.frequency.value = 170;
  const gg = ctx.createGain();
  gg.gain.value = 0.35;
  const out = ctx.createGain();
  out.gain.value = 0;
  src.connect(lp).connect(chop).connect(out);
  growl.connect(glp).connect(gg).connect(out);
  out.connect(A.sfxBus);
  src.start();
  lfo.start();
  growl.start();
  let stopped = false;
  return {
    set(v, rev) {
      if (stopped) return;
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(v, t, 0.2);
      lfo.frequency.setTargetAtTime(14 + rev * 22, t, 0.3);
      growl.frequency.setTargetAtTime(42 + rev * 40, t, 0.3);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => [src, lfo, growl].forEach((n) => n.stop()), 2000);
    },
  };
}
