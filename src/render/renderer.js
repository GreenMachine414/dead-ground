// 2D canvas renderer with a soft, hand-drawn top-down RPG look.
// World units map to screen pixels; things with height are drawn shifted upward (3/4 view).
import { WEAPONS, RARITY } from '../data/weapons.js';
import { ZOMBIES, PERKS, POWERUPS } from '../data/zombies.js';
import { CONTAINERS } from '../data/loot.js';
import { BOONS } from '../data/boons.js';
import { ZTYPES, WIDS } from '../game/sim.js';
import { paintGround, PX } from './groundpaint.js';
import * as S from './sprites.js';

const BASE_U = 42; // css pixels per world unit at zoom 1
const K = 0.55; // height -> screen offset factor
const MAX_PARTICLES = 1800;
const OUT = 'rgba(40,30,30,0.85)';

export class Renderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.zoom = 1;
    this.shake = 0;
    this.shakeEnabled = true;
    this.cam = { x: 0, z: 0 };
    this.time = 0;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.light.width = Math.ceil(this.canvas.width / 2);
    this.light.height = Math.ceil(this.canvas.height / 2);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.canvas.remove();
  }

  get u() {
    return BASE_U * this.zoom * this.dpr;
  }
  sx(x) {
    return (x - this.cam.x) * this.u + this.canvas.width / 2;
  }
  sy(z) {
    return (z - this.cam.z) * this.u + this.canvas.height / 2;
  }

  // ---------------------------------------------------------------- world
  loadWorld(world, map) {
    this.world = world;
    this.map = map;
    this.theme = world.theme;
    this.ground = paintGround(world, this.theme);
    this.gctx = this.ground.getContext('2d');
    this.rows = Array.from({ length: world.H + 1 }, () => []);
    for (const s of world.solids) {
      if (s.kind === 'water') continue;
      s.seed = s.x * 7.13 + s.z * 3.71;
      this.rows[Math.min(world.H, Math.floor(s.z + s.d - 0.01))].push(s);
    }
    // static decorations & interactables
    this.statics = [];
    const sp = world.spots;
    for (const s of sp.perk) this.statics.push({ k: 'perk', x: s.x, z: s.z - 0.7, perk: s.perk });
    for (const s of sp.ammo) this.statics.push({ k: 'ammo', x: s.x, z: s.z - 0.7 });
    if (sp.forge) this.statics.push({ k: 'forge', x: sp.forge.x, z: sp.forge.z - 0.8 });
    const stationNames = new Set();
    for (const st of map.story.steps) if (st.type === 'activate') st.spots.forEach((n) => stationNames.add(n));
    for (const n of stationNames) {
      const s = sp.named[n] && sp.named[n][0];
      if (s) this.statics.push({ k: 'station', x: s.x, z: s.z - 0.8, name: n });
    }
    for (const d of world.decor) {
      if (d.kind === 'sign') this.statics.push({ k: 'sign', x: d.x, z: d.z, text: d.text });
      if (d.kind === 'scarecrow') this.statics.push({ k: 'scarecrow', x: d.x, z: d.z });
      if (d.kind === 'reeds') this.statics.push({ k: 'reeds', x: d.x, z: d.z });
      if (d.kind === 'canopy') this.statics.push({ k: 'canopy', x: d.x, z: d.z, w: d.w, d: d.d });
    }
    this.doors = world.doors;
    this.lights = world.lights.map((l) => ({ ...l, color: S.hex(l.color) }));
    this.players = new Map();
    this.zombies = new Map();
    this.dying = [];
    this.pickups = new Map();
    this.particles = [];
    this.tracers = [];
    this.bolts = [];
    this.rings = [];
    this.texts = [];
    this.flashes = [];
    this.camInit = false;
    this.ambientT = 0;
  }

  // css-pixel mouse -> world point
  groundPoint(mx, my) {
    const u = this.u;
    return {
      x: this.cam.x + (mx * this.dpr - this.canvas.width / 2) / u,
      z: this.cam.z + (my * this.dpr - this.canvas.height / 2) / u + 0.7,
    };
  }

  project(x, y, z) {
    return { x: this.sx(x) / this.dpr, y: (this.sy(z) - y * K * this.u) / this.dpr, vis: true };
  }

  // ---------------------------------------------------------------- effects api
  emit(x, z, h, vx, vz, vh, col, life, size, o = {}) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, z, h, vx, vz, vh, col, life, max: life, size, g: o.g ?? 0, drag: o.drag ?? 0, grow: o.grow ?? 0, glow: o.glow, shape: o.shape });
  }

  burst(x, z, h, n, cols, speed, life, size, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      const col = Array.isArray(cols) ? cols[Math.floor(Math.random() * cols.length)] : cols;
      this.emit(x + (Math.random() - 0.5) * (o.spread || 0), z + (Math.random() - 0.5) * (o.spread || 0), h, Math.cos(a) * s, Math.sin(a) * s, (o.up ?? 0.6) * speed * Math.random(), col, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), o);
    }
  }

  text(x, z, h, text, col, size = 0.5, life = 0.9) {
    this.texts.push({ x: x + (Math.random() - 0.5) * 0.4, z, h, text, col, size, life, max: life });
    if (this.texts.length > 80) this.texts.shift();
  }

  splat(x, z, r, col, a = 0.5) {
    const g = this.gctx;
    g.fillStyle = S.rgba(col, a);
    S.blob(g, x * PX, z * PX, r * PX, x * 3 + z, 0.3, 8);
    g.fill();
    for (let i = 0; i < 4; i++) {
      S.circle(g, (x + (Math.random() - 0.5) * r * 2.4) * PX, (z + (Math.random() - 0.5) * r * 2.4) * PX, r * PX * 0.18);
      g.fill();
    }
  }

  // ---------------------------------------------------------------- frame
  update(snap, events, dt, view) {
    this.time += dt;
    this.snap = snap;
    const k = view.smooth ? 1 - Math.exp(-dt * 14) : 1;
    this.syncPlayers(snap, dt, k, view);
    this.syncZombies(snap, dt, k);
    this.syncPickups(snap);
    for (const e of events) this.handleEvent(e, view);
    // camera
    const me = this.players.get(view.localId);
    if (me) {
      if (!this.camInit) {
        this.camInit = true;
        this.cam.x = me.x;
        this.cam.z = me.z;
      }
      const f = 1 - Math.exp(-dt * 8);
      this.cam.x += (me.x - this.cam.x) * f;
      this.cam.z += (me.z - 0.5 - this.cam.z) * f;
    }
    this.me = me;
    const camSave = { ...this.cam };
    if (this.shake > 0 && this.shakeEnabled) {
      this.cam.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.cam.z += (Math.random() - 0.5) * this.shake * 0.5;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.stepEffects(dt);
    this.ambient(dt);
    this.draw(snap, view);
    this.cam = camSave;
  }

  syncPlayers(snap, dt, k, view) {
    const seen = new Set();
    for (const p of snap.P) {
      seen.add(p.id);
      let o = this.players.get(p.id);
      if (!o) {
        o = { x: p.x, z: p.z, a: p.a, walk: 0 };
        this.players.set(p.id, o);
      }
      const local = p.id === view.localId && view.localPos;
      const tx = local ? view.localPos.x : p.x, tz = local ? view.localPos.z : p.z;
      const kk = local ? 1 : k;
      const ox = o.x, oz = o.z;
      o.x += (tx - o.x) * kk;
      o.z += (tz - o.z) * kk;
      o.a = local ? view.localAng : p.a;
      o.walk += Math.hypot(o.x - ox, o.z - oz) * 3.2;
      o.moving = local ? view.localMoving : p.mv;
      o.p = p;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
  }

  syncZombies(snap, dt, k) {
    const seen = new Set();
    for (const z of snap.Z) {
      const [id, ti, x, zz, a, hp, st, riseT, flags] = z;
      seen.add(id);
      let o = this.zombies.get(id);
      if (!o) {
        const type = ZTYPES[ti];
        o = { x, z: zz, a, walk: Math.random() * 6, type, def: ZOMBIES[type], look: S.zombieLook(type), seed: Math.random() * 9 };
        this.zombies.set(id, o);
      }
      if (Math.hypot(x - o.x, zz - o.z) > 4) {
        o.x = x;
        o.z = zz;
      }
      const ox = o.x, oz = o.z;
      o.x += (x - o.x) * k;
      o.z += (zz - o.z) * k;
      o.a = a;
      o.walk += Math.hypot(o.x - ox, o.z - oz) * 3;
      o.moving = Math.hypot(o.x - ox, o.z - oz) > 0.001;
      o.hp = hp;
      o.st = st;
      o.riseT = riseT;
      o.flags = flags;
      if (st === 0 && Math.random() < dt * 14) this.burst(o.x, o.z, 0.1, 2, ['#6a4a2a', '#4a3420', '#8a6a44'], 2.2, 0.6, 0.12, { g: 9, up: 1.2, spread: o.def.radius * 1.6 });
      if (flags & 1 && Math.random() < dt * 22) this.emit(o.x + (Math.random() - 0.5) * 0.5, o.z, 0.6 + Math.random(), 0, 0, 1.6, Math.random() < 0.5 ? '#ff8a2a' : '#ffd04a', 0.5, 0.18, { grow: -0.6, glow: true });
      if (o.type === 'burner' && Math.random() < dt * 18) this.emit(o.x, o.z, 1.2, (Math.random() - 0.5), (Math.random() - 0.5), 1.4, '#ff7a2a', 0.5, 0.16, { glow: true });
      if (flags & 8 && Math.random() < dt * 25) this.emit(o.x + (Math.random() - 0.5), o.z, 1 + Math.random() * 2, 0, 0, 1.5, '#ff3020', 0.6, 0.2, { glow: true });
    }
    for (const [id, o] of this.zombies) {
      if (!seen.has(id)) {
        this.zombies.delete(id);
        o.deathT = 0;
        this.dying.push(o);
      }
    }
  }

  syncPickups(snap) {
    const seen = new Set();
    for (const it of snap.I) {
      seen.add(it[0]);
      if (!this.pickups.has(it[0])) this.pickups.set(it[0], { born: this.time });
    }
    for (const id of [...this.pickups.keys()]) if (!seen.has(id)) this.pickups.delete(id);
  }

  stepEffects(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vh -= p.g * dt;
      if (p.drag) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vz *= f;
        p.vh *= f;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.h += p.vh * dt;
      if (p.h < 0) {
        p.h = 0;
        p.vh = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const list of [this.tracers, this.bolts, this.rings, this.texts, this.flashes]) for (const t of list) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.bolts = this.bolts.filter((t) => t.life > 0);
    this.rings = this.rings.filter((t) => t.life > 0);
    this.texts = this.texts.filter((t) => t.life > 0);
    this.flashes = this.flashes.filter((t) => t.life > 0);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      this.dying[i].deathT += dt;
      if (this.dying[i].deathT > 2.2) this.dying.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- drawing
  draw(snap, view) {
    const c = this.ctx, u = this.u, cw = this.canvas.width, ch = this.canvas.height;
    const th = this.theme;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = S.shade(th.ground, -0.35);
    c.fillRect(0, 0, cw, ch);
    // ground texture
    const wx0 = this.cam.x - cw / 2 / u, wz0 = this.cam.z - ch / 2 / u, ww = cw / u, wh = ch / u;
    const sx0 = Math.max(0, wx0), sz0 = Math.max(0, wz0);
    const sx1 = Math.min(this.world.W, wx0 + ww), sz1 = Math.min(this.world.H, wz0 + wh);
    if (sx1 > sx0 && sz1 > sz0) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this.ground, sx0 * PX, sz0 * PX, (sx1 - sx0) * PX, (sz1 - sz0) * PX, this.sx(sx0), this.sy(sz0), (sx1 - sx0) * u, (sz1 - sz0) * u);
    }
    this.drawGroundLayer(snap, view);
    // depth sorted objects
    const list = [];
    const zMin = Math.floor(wz0) - 1, zMax = Math.ceil(wz0 + wh) + 6;
    const xMin = wx0 - 3, xMax = wx0 + ww + 3;
    // solids are bucketed by their bottom row, so scan every row below the view too:
    // a long vertical wall whose bottom end is off screen still has to be drawn
    for (let z = Math.max(0, zMin); z <= this.world.H; z++) {
      for (const s of this.rows[z]) if (s.z <= zMax && s.x + s.w >= xMin && s.x <= xMax) list.push([s.z + s.d, 0, s]);
    }
    const inView = (x, z) => x > xMin && x < xMax && z > zMin && z < zMax;
    for (const s of this.statics) if (inView(s.x, s.z)) list.push([s.z + 0.5, 1, s]);
    const loot = this.world.spots.loot;
    for (let i = 0; i < loot.length; i++) if (inView(loot[i].x, loot[i].z)) list.push([loot[i].pz + 0.95, 2, i]);
    for (const d of this.doors) if (!d.open && !snap.D.includes(d.id) && d.x + d.w > xMin && d.x < xMax && d.z + d.d > zMin && d.z < zMax) list.push([d.z + d.d, 9, d]);
    for (const o of this.players.values()) list.push([o.z, 3, o]);
    for (const o of this.zombies.values()) if (inView(o.x, o.z)) list.push([o.z, 4, o]);
    for (const o of this.dying) if (inView(o.x, o.z)) list.push([o.z - 0.3, 5, o]);
    for (const it of snap.I) if (inView(it[2], it[3])) list.push([it[3], 6, it]);
    for (const s of snap.S) {
      if (s.k === 'wall') for (const cell of s.c) list.push([cell[1] + 1, 7, { ...s, c: [cell] }]);
      else list.push([s.z + 0.5, 7, s]);
    }
    const bs = this.world.spots.box[snap.B[0]];
    if (bs) list.push([bs.z - 0.1, 8, bs]);
    list.sort((a, b) => a[0] - b[0]);
    for (const [, t, o] of list) {
      switch (t) {
        case 0:
          this.drawSolid(o);
          break;
        case 1:
          this.drawStatic(o, snap);
          break;
        case 2:
          this.drawContainer(o, snap);
          break;
        case 3:
          this.drawPlayer(o, view);
          break;
        case 4:
          this.drawZombie(o);
          break;
        case 5:
          this.drawDying(o);
          break;
        case 6:
          this.drawPickup(o);
          break;
        case 7:
          this.drawStruct(o);
          break;
        case 8:
          this.drawBox(o, snap);
          break;
        case 9:
          this.drawDoor(o);
          break;
      }
    }
    this.drawProjectiles(snap);
    this.drawEffects();
    this.drawLighting(snap, view);
    this.drawOverlayUI(snap, view);
  }

  // occlusion fade: is the local player hidden behind this footprint?
  fade(x, z, w, d, hUnits) {
    const me = this.me;
    if (!me) return 1;
    if (me.z >= z + d - 0.2) return 1;
    if (me.x < x - 0.6 || me.x > x + w + 0.6) return 1;
    if (me.z < z - hUnits * K - 0.4) return 1;
    return 0.42;
  }

  drawGroundLayer(snap, view) {
    const c = this.ctx, u = this.u;
    // hazards
    for (const [, kind, x, z, r, t] of snap.H) {
      const X = this.sx(x), Y = this.sy(z), R = r * u;
      const fade = Math.min(1, t * 2);
      if (kind === 'ring') {
        S.circle(c, X, Y, R);
        c.strokeStyle = `rgba(255,70,50,${0.85 * fade})`;
        c.lineWidth = u * 0.25;
        c.stroke();
        continue;
      }
      const col = { acid: '#7ee04a', fire: '#ff7a2a', heal: '#5ef0a0', napalm: '#ff6a2a' }[kind] || '#ffffff';
      if (kind === 'heal') {
        S.circle(c, X, Y, R);
        c.fillStyle = S.rgba(col, 0.15 * fade);
        c.fill();
        c.setLineDash([u * 0.4, u * 0.25]);
        c.lineDashOffset = -this.time * u;
        c.strokeStyle = S.rgba(col, 0.8 * fade);
        c.lineWidth = u * 0.1;
        c.stroke();
        c.setLineDash([]);
        if (Math.random() < 0.3) this.emit(x + (Math.random() - 0.5) * r * 1.6, z + (Math.random() - 0.5) * r * 1.6, 0, 0, 0, 1.2, '#7fffb0', 0.8, 0.1, { glow: true });
      } else {
        S.blob(c, X, Y, R, x + z, 0.15, 8);
        c.fillStyle = S.rgba(col, (0.35 + Math.sin(this.time * 6 + x) * 0.08) * fade);
        c.fill();
        if ((kind === 'fire' || kind === 'napalm') && Math.random() < 0.6) this.emit(x + (Math.random() - 0.5) * r * 1.4, z + (Math.random() - 0.5) * r, 0, 0, 0, 1.8, Math.random() < 0.5 ? '#ff7a2a' : '#ffc84a', 0.45, 0.16, { grow: -0.6, glow: true });
        if (kind === 'acid' && Math.random() < 0.15) this.emit(x + (Math.random() - 0.5) * r, z + (Math.random() - 0.5) * r, 0, 0, 0, 0.6, '#a8ff6a', 0.6, 0.08);
      }
    }
    // objective zone
    const o = snap.O;
    if (o.zone) {
      const X = this.sx(o.zone[0]), Y = this.sy(o.zone[1]), R = o.zone[2] * u;
      S.circle(c, X, Y, R);
      c.fillStyle = 'rgba(90,190,255,0.12)';
      c.fill();
      c.setLineDash([u * 0.6, u * 0.3]);
      c.lineDashOffset = this.time * u * 0.8;
      c.strokeStyle = 'rgba(120,210,255,0.9)';
      c.lineWidth = u * 0.12;
      c.stroke();
      c.setLineDash([]);
    }
    // objective markers on the ground
    for (const m of o.mk) {
      if (m[2] === 2) continue;
      const X = this.sx(m[0]), Y = this.sy(m[1]);
      const pulse = 1 + Math.sin(this.time * 4) * 0.1;
      S.ellipse(c, X, Y, u * 0.9 * pulse, u * 0.45 * pulse);
      c.strokeStyle = 'rgba(255,214,90,0.85)';
      c.lineWidth = u * 0.08;
      c.stroke();
      if (m[2] === 1 && m[3] > 0) {
        c.beginPath();
        c.ellipse(X, Y, u * 1.15, u * 0.6, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, m[3]));
        c.strokeStyle = '#6fe08a';
        c.lineWidth = u * 0.14;
        c.stroke();
      }
    }
    // player selection rings
    for (const p of this.players.values()) {
      if (p.p.s === 2) continue;
      S.ellipse(c, this.sx(p.x), this.sy(p.z), u * 0.5, u * 0.22);
      c.strokeStyle = p.p.s === 1 ? 'rgba(255,80,60,0.9)' : p.p.id === view.localId ? 'rgba(120,255,150,0.75)' : 'rgba(110,180,255,0.75)';
      c.lineWidth = u * 0.07;
      c.stroke();
    }
  }

  drawSolid(s) {
    const c = this.ctx, u = this.u, th = this.theme;
    const X = this.sx(s.x), Y = this.sy(s.z), Wp = s.w * u, Dp = s.d * u, Hp = s.h * K * u;
    const t = this.time;
    switch (s.kind) {
      case 'tree': {
        const a = this.fade(s.x - 0.8, s.z - 0.8, 2.6, 1.8, 3.4);
        S.drawTree(c, X + u / 2, Y + u * 0.8, u, s.s || 1, s.variant || th.tree, s.seed, a);
        return;
      }
      case 'bush':
        S.drawBush(c, X + u / 2, Y + u * 0.85, u, s.seed, th.tree === 'pine');
        return;
      case 'rock':
        S.drawRock(c, X + Wp / 2, Y + Dp * 0.95, Wp, Dp, u, s.seed, th.tree === 'pine' ? '#9eaab8' : th.tree === 'dead' ? '#b89a70' : '#a19c94');
        return;
      case 'wall':
      case 'concrete':
      case 'lab': {
        const col = s.color || (s.kind === 'concrete' ? '#b9b2a2' : s.kind === 'lab' ? '#7c8190' : th.wall);
        c.save();
        c.globalAlpha = this.fade(s.x, s.z, s.w, s.d, s.h);
        S.drawBlock(c, X, Y, Wp, Dp, Hp, S.shade(col, 0.14), S.shade(col, -0.18), u, 0.16);
        // stone / brick hint on the front face
        c.strokeStyle = 'rgba(0,0,0,0.12)';
        c.lineWidth = Math.max(1, u * 0.03);
        c.beginPath();
        c.moveTo(X + u * 0.15, Y + Dp - Hp * 0.45);
        c.lineTo(X + Wp - u * 0.15, Y + Dp - Hp * 0.45);
        c.stroke();
        c.restore();
        return;
      }
      case 'building':
        return this.drawCottage(s, X, Y, Wp, Dp, Hp);
      case 'car':
      case 'tractor':
      case 'apc':
      case 'snowcat':
      case 'wreck':
        return this.drawVehicle(s, X, Y, Wp, Dp);
      case 'crate':
        S.drawBlock(c, X + u * 0.05, Y + u * 0.05, Wp - u * 0.1, Dp - u * 0.1, Hp, '#c48a4e', '#9a6434', u, 0.12);
        c.strokeStyle = 'rgba(80,45,20,0.6)';
        c.lineWidth = u * 0.05;
        c.beginPath();
        c.moveTo(X + u * 0.2, Y - Hp + u * 0.2);
        c.lineTo(X + Wp - u * 0.2, Y - Hp + Dp - u * 0.2);
        c.moveTo(X + Wp - u * 0.2, Y - Hp + u * 0.2);
        c.lineTo(X + u * 0.2, Y - Hp + Dp - u * 0.2);
        c.stroke();
        return;
      case 'barrel':
      case 'tank': {
        const col = s.kind === 'barrel' ? ['#b0473a', '#3f6fa0', '#5f8a3a'][Math.floor(s.seed) % 3] : '#9aa3ad';
        const cx = X + Wp / 2, r = Wp * 0.42;
        S.shadow(c, cx, Y + Dp * 0.9, r * 1.05, r * 0.4);
        S.rr(c, cx - r, Y + Dp * 0.5 - Hp, r * 2, Hp + r * 0.6, r * 0.6);
        S.fillStroke(c, S.shade(col, -0.15), OUT, u * 0.045);
        S.ellipse(c, cx, Y + Dp * 0.5 - Hp, r, r * 0.55);
        S.fillStroke(c, S.shade(col, 0.15), OUT, u * 0.045);
        return;
      }
      case 'hay':
        S.drawBlock(c, X, Y, Wp, Dp, Hp, '#e8c766', '#c9a548', u, 0.3);
        c.strokeStyle = 'rgba(150,110,40,0.5)';
        c.lineWidth = u * 0.03;
        for (let i = 1; i < 4; i++) {
          c.beginPath();
          c.moveTo(X + (Wp * i) / 4, Y - Hp + u * 0.1);
          c.lineTo(X + (Wp * i) / 4, Y + Dp - u * 0.1);
          c.stroke();
        }
        return;
      case 'fence':
      case 'rail':
        return this.drawFence(s, X, Y, Wp, Dp);
      case 'sandbag': {
        const horiz = s.w >= s.d, n = Math.max(s.w, s.d) * 2;
        for (let i = 0; i < n; i++) {
          const bx = horiz ? X + (i + 0.5) * u * 0.5 : X + Wp / 2, by = horiz ? Y + Dp / 2 : Y + (i + 0.5) * u * 0.5;
          S.ellipse(c, bx, by - u * 0.25, u * 0.34, u * 0.24);
          S.fillStroke(c, i % 2 ? '#c8ac7a' : '#b89c6a', OUT, u * 0.04);
        }
        return;
      }
      case 'table':
      case 'bench':
      case 'log':
        S.drawBlock(c, X + u * 0.05, Y + u * 0.1, Wp - u * 0.1, Dp - u * 0.2, Hp, s.kind === 'log' ? '#8a5a34' : '#b07a48', s.kind === 'log' ? '#6a4024' : '#8a5a34', u, s.kind === 'log' ? 0.4 : 0.12);
        return;
      case 'bed':
        S.drawBlock(c, X + u * 0.05, Y + u * 0.05, Wp - u * 0.1, Dp - u * 0.1, Hp, '#e8e4dc', '#8a6a4a', u, 0.15);
        S.rr(c, X + u * 0.2, Y - Hp + u * 0.15, Wp - u * 0.4, u * 0.35, u * 0.12);
        S.fillStroke(c, '#ffffff', OUT, u * 0.03);
        return;
      case 'silo': {
        const cx = X + Wp / 2, r = Wp / 2;
        c.save();
        c.globalAlpha = this.fade(s.x, s.z, s.w, s.d, s.h);
        S.rr(c, cx - r, Y + Dp / 2 - Hp, r * 2, Hp + r * 0.5, r * 0.5);
        S.fillStroke(c, '#c4c8cc', OUT, u * 0.05);
        S.circle(c, cx, Y + Dp / 2 - Hp, r);
        S.fillStroke(c, '#d8dce0', OUT, u * 0.05);
        S.circle(c, cx, Y + Dp / 2 - Hp, r * 0.35);
        c.fillStyle = '#a8adb2';
        c.fill();
        c.restore();
        return;
      }
      case 'windmill': {
        const cx = X + Wp / 2, top = Y + Dp / 2 - Hp;
        c.save();
        c.globalAlpha = this.fade(s.x, s.z, s.w, s.d, s.h + 1.5);
        c.beginPath();
        c.moveTo(cx - Wp * 0.45, Y + Dp);
        c.lineTo(cx - Wp * 0.18, top);
        c.lineTo(cx + Wp * 0.18, top);
        c.lineTo(cx + Wp * 0.45, Y + Dp);
        c.closePath();
        S.fillStroke(c, '#b89a7a', OUT, u * 0.05);
        c.translate(cx, top);
        c.rotate(t * 0.8);
        for (let i = 0; i < 4; i++) {
          c.rotate(Math.PI / 2);
          S.rr(c, -u * 0.18, -u * 2.2, u * 0.36, u * 2, u * 0.12);
          S.fillStroke(c, '#efe6d2', OUT, u * 0.04);
        }
        S.circle(c, 0, 0, u * 0.2);
        S.fillStroke(c, '#7a5a3a', OUT, u * 0.04);
        c.restore();
        return;
      }
      case 'well':
      case 'fountain': {
        const cx = X + Wp / 2, cy = Y + Dp / 2, r = Wp / 2;
        S.shadow(c, cx, cy + r * 0.3, r, r * 0.45);
        S.ellipse(c, cx, cy - u * 0.2, r, r * 0.7);
        S.fillStroke(c, '#a8a49c', OUT, u * 0.05);
        S.ellipse(c, cx, cy - u * 0.25, r * 0.75, r * 0.5);
        c.fillStyle = '#5aa9d6';
        c.fill();
        if (s.kind === 'fountain') {
          for (let i = 0; i < 3; i++) {
            const rr2 = ((t * 0.6 + i / 3) % 1) * r * 0.7;
            S.ellipse(c, cx, cy - u * 0.25, rr2, rr2 * 0.66);
            c.strokeStyle = `rgba(255,255,255,${0.5 - rr2 / r})`;
            c.lineWidth = u * 0.04;
            c.stroke();
          }
          if (Math.random() < 0.5) this.emit(s.x + s.w / 2, s.z + s.d / 2, 1.4, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 2.5, '#bfe6ff', 0.6, 0.08, { g: 8 });
        }
        return;
      }
      case 'tent': {
        const ridge = Y - Hp;
        c.beginPath();
        c.moveTo(X, Y + Dp);
        c.quadraticCurveTo(X + Wp * 0.1, Y + Dp * 0.2, X + Wp * 0.5, ridge);
        c.quadraticCurveTo(X + Wp * 0.9, Y + Dp * 0.2, X + Wp, Y + Dp);
        c.closePath();
        S.fillStroke(c, '#8f9a64', OUT, u * 0.05);
        c.beginPath();
        c.moveTo(X + Wp * 0.38, Y + Dp);
        c.lineTo(X + Wp * 0.5, Y + Dp * 0.35);
        c.lineTo(X + Wp * 0.62, Y + Dp);
        c.closePath();
        c.fillStyle = '#3e4430';
        c.fill();
        return;
      }
      case 'container':
        S.drawBlock(c, X, Y, Wp, Dp, Hp, S.shade(s.color || '#a8503a', 0.12), S.shade(s.color || '#a8503a', -0.15), u, 0.1);
        c.strokeStyle = 'rgba(0,0,0,0.18)';
        c.lineWidth = u * 0.04;
        for (let x = X + u * 0.4; x < X + Wp - u * 0.2; x += u * 0.5) {
          c.beginPath();
          c.moveTo(x, Y - Hp + u * 0.1);
          c.lineTo(x, Y - Hp + Dp - u * 0.1);
          c.stroke();
        }
        return;
      case 'console':
      case 'generator':
      case 'transformer':
      case 'pump': {
        const col = { console: '#454a58', generator: '#d6a93a', transformer: '#8a949c', pump: '#d24a3a' }[s.kind];
        S.drawBlock(c, X + u * 0.05, Y + u * 0.05, Wp - u * 0.1, Dp - u * 0.1, Hp, S.shade(col, 0.12), S.shade(col, -0.2), u, 0.15);
        if (s.kind === 'console') {
          S.rr(c, X + u * 0.2, Y - Hp + u * 0.18, Wp - u * 0.4, Dp - u * 0.36, u * 0.08);
          c.fillStyle = `rgba(90,220,255,${0.7 + Math.sin(t * 3 + s.seed) * 0.15})`;
          c.fill();
        } else if (s.kind === 'transformer') {
          c.fillStyle = '#f2c230';
          c.font = `bold ${u * 0.6}px Fredoka, Segoe UI`;
          c.textAlign = 'center';
          c.fillText('⚡', X + Wp / 2, Y - Hp + Dp * 0.7);
        }
        return;
      }
      case 'tower':
        c.save();
        c.globalAlpha = this.fade(s.x, s.z, s.w, s.d, s.h);
        S.drawBlock(c, X, Y, Wp, Dp, Hp, '#9a8a6a', '#6a5a44', u, 0.12);
        S.rr(c, X - u * 0.3, Y - Hp - u * 0.2, Wp + u * 0.6, Dp + u * 0.2, u * 0.25);
        S.fillStroke(c, '#7a6248', OUT, u * 0.05);
        c.restore();
        return;
      case 'reactor': {
        const cx = X + Wp / 2, cy = Y + Dp / 2;
        S.circle(c, cx, cy - u * 0.4, Wp * 0.5);
        S.fillStroke(c, '#5a6070', OUT, u * 0.06);
        const g = c.createRadialGradient(cx, cy - u * 0.4, 0, cx, cy - u * 0.4, Wp * 0.38);
        g.addColorStop(0, '#d8ffe6');
        g.addColorStop(0.5, `rgba(90,255,150,${0.8 + Math.sin(t * 4) * 0.2})`);
        g.addColorStop(1, 'rgba(40,160,90,0.4)');
        S.circle(c, cx, cy - u * 0.4, Wp * 0.36);
        c.fillStyle = g;
        c.fill();
        return;
      }
      case 'campfire': {
        const cx = X + u / 2, cy = Y + u * 0.7;
        c.strokeStyle = '#6a4024';
        c.lineWidth = u * 0.14;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx - u * 0.4, cy);
        c.lineTo(cx + u * 0.4, cy - u * 0.15);
        c.moveTo(cx - u * 0.4, cy - u * 0.15);
        c.lineTo(cx + u * 0.4, cy);
        c.stroke();
        for (let i = 0; i < 3; i++) {
          const fh = u * (0.55 + Math.sin(t * 9 + i * 2) * 0.12) * (1 - i * 0.25);
          c.beginPath();
          c.moveTo(cx - u * 0.22 * (1 - i * 0.3), cy - u * 0.05);
          c.quadraticCurveTo(cx - u * 0.2, cy - fh * 0.6, cx + Math.sin(t * 7 + i) * u * 0.05, cy - fh);
          c.quadraticCurveTo(cx + u * 0.2, cy - fh * 0.6, cx + u * 0.22 * (1 - i * 0.3), cy - u * 0.05);
          c.closePath();
          c.fillStyle = ['#ff7a2a', '#ffb43a', '#fff0a0'][i];
          c.fill();
        }
        if (Math.random() < 0.25) this.emit(s.x + 0.5, s.z + 0.5, 0.8, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 1.5, '#ffb04a', 1.2, 0.06, { glow: true });
        return;
      }
      case 'lamp': {
        const cx = X + u / 2, by = Y + u * 0.7;
        c.strokeStyle = '#3a3a40';
        c.lineWidth = u * 0.1;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx, by);
        c.lineTo(cx, by - Hp - u * 0.4);
        c.stroke();
        S.circle(c, cx, by - Hp - u * 0.5, u * 0.2);
        S.fillStroke(c, '#ffe9a8', OUT, u * 0.04);
        return;
      }
      case 'grave': {
        const cx = X + u / 2, by = Y + u * 0.8;
        S.shadow(c, cx, by, u * 0.35, u * 0.12);
        c.beginPath();
        c.moveTo(cx - u * 0.3, by);
        c.lineTo(cx - u * 0.3, by - u * 0.5);
        c.arc(cx, by - u * 0.5, u * 0.3, Math.PI, 0);
        c.lineTo(cx + u * 0.3, by);
        c.closePath();
        S.fillStroke(c, '#9a9ea6', OUT, u * 0.045);
        c.strokeStyle = 'rgba(60,60,70,0.6)';
        c.lineWidth = u * 0.05;
        c.beginPath();
        c.moveTo(cx, by - u * 0.65);
        c.lineTo(cx, by - u * 0.3);
        c.moveTo(cx - u * 0.12, by - u * 0.52);
        c.lineTo(cx + u * 0.12, by - u * 0.52);
        c.stroke();
        return;
      }
      default:
        S.drawBlock(c, X, Y, Wp, Dp, Hp, '#a8a8a8', '#808080', u, 0.15);
    }
  }

  drawCottage(s, X, Y, Wp, Dp, Hp) {
    const c = this.ctx, u = this.u, th = this.theme;
    const wall = s.color || th.wall;
    const roof = s.roof || th.roof;
    c.save();
    c.globalAlpha = this.fade(s.x, s.z, s.w, s.d, s.h);
    // front wall
    S.rr(c, X + u * 0.1, Y + Dp - Hp - u * 0.4, Wp - u * 0.2, Hp + u * 0.4, u * 0.15);
    S.fillStroke(c, S.shade(wall, -0.05), OUT, u * 0.05);
    const n = Math.max(1, Math.floor(s.w / 2.2));
    const lit = th.dark > 0.2;
    for (let i = 0; i < n; i++) {
      const wx = X + ((i + 0.5) / n) * Wp - u * 0.3;
      if (n > 2 && i === Math.floor(n / 2)) {
        S.rr(c, wx, Y + Dp - Hp * 0.75, u * 0.6, Hp * 0.75, u * 0.15);
        S.fillStroke(c, '#7a4e30', OUT, u * 0.04);
        continue;
      }
      S.rr(c, wx, Y + Dp - Hp * 0.8, u * 0.6, Hp * 0.42, u * 0.12);
      S.fillStroke(c, lit && (s.seed * 13 + i) % 3 < 1.4 ? '#ffd88a' : '#4a5a78', OUT, u * 0.04);
    }
    // roof
    S.rr(c, X - u * 0.15, Y - Hp - u * 0.15, Wp + u * 0.3, Dp + u * 0.25, u * 0.35);
    S.fillStroke(c, roof, OUT, u * 0.06);
    c.save();
    S.rr(c, X - u * 0.15, Y - Hp - u * 0.15, Wp + u * 0.3, Dp + u * 0.25, u * 0.35);
    c.clip();
    c.strokeStyle = S.shade(roof, -0.18);
    c.lineWidth = u * 0.05;
    for (let y = Y - Hp + u * 0.3; y < Y - Hp + Dp; y += u * 0.45) {
      for (let x = X - u * 0.15; x < X + Wp + u * 0.2; x += u * 0.5) {
        c.beginPath();
        c.arc(x + ((y / (u * 0.45)) % 2 ? u * 0.25 : 0), y, u * 0.25, 0, Math.PI);
        c.stroke();
      }
    }
    c.restore();
    c.strokeStyle = S.shade(roof, 0.2);
    c.lineWidth = u * 0.12;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(X + u * 0.3, Y - Hp + Dp * 0.45);
    c.lineTo(X + Wp - u * 0.3, Y - Hp + Dp * 0.45);
    c.stroke();
    c.restore();
  }

  drawVehicle(s, X, Y, Wp, Dp) {
    const c = this.ctx, u = this.u;
    const col = s.color ? S.hex(s.color) : { tractor: '#3f8a3a', apc: '#6a7a4a', snowcat: '#e0742a', wreck: '#8a8a8a' }[s.kind] || '#8a8a8a';
    const horiz = s.horizontal ?? s.w >= s.d;
    S.shadow(c, X + Wp / 2, Y + Dp * 0.85, Wp * 0.52, Dp * 0.35, 0.28);
    // wheels
    c.fillStyle = '#26262a';
    for (const [fx, fz] of horiz ? [[0.2, 0.05], [0.8, 0.05], [0.2, 0.95], [0.8, 0.95]] : [[0.05, 0.2], [0.95, 0.2], [0.05, 0.8], [0.95, 0.8]]) {
      S.rr(c, X + Wp * fx - u * 0.22, Y + Dp * fz - u * 0.22 - u * 0.2, u * 0.44, u * 0.44, u * 0.15);
      c.fill();
    }
    S.rr(c, X + u * 0.05, Y - u * 0.35, Wp - u * 0.1, Dp, u * 0.45);
    S.fillStroke(c, S.shade(col, -0.15), OUT, u * 0.05);
    S.rr(c, X + u * 0.05, Y - u * 0.45, Wp - u * 0.1, Dp - u * 0.2, u * 0.45);
    S.fillStroke(c, col, OUT, u * 0.05);
    // windshield / cabin
    c.fillStyle = s.kind === 'wreck' ? '#4a4a4a' : 'rgba(150,200,230,0.9)';
    if (horiz) S.rr(c, X + Wp * 0.35, Y - u * 0.3, Wp * 0.3, Dp - u * 0.5, u * 0.18);
    else S.rr(c, X + u * 0.25, Y + Dp * 0.3 - u * 0.4, Wp - u * 0.5, Dp * 0.3, u * 0.18);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    if (horiz) S.rr(c, X + Wp * 0.37, Y - u * 0.25, Wp * 0.08, Dp - u * 0.6, u * 0.05);
    else S.rr(c, X + u * 0.3, Y + Dp * 0.3 - u * 0.35, Wp * 0.15, Dp * 0.25, u * 0.05);
    c.fill();
  }

  drawFence(s, X, Y, Wp, Dp) {
    const c = this.ctx, u = this.u;
    const col = s.kind === 'rail' ? '#7a7f88' : '#9a6a3e';
    const horiz = s.w >= s.d;
    const L = horiz ? s.w : s.d;
    const railH = u * 0.35;
    c.lineCap = 'round';
    for (const off of [0.25, 0.55]) {
      c.strokeStyle = OUT;
      c.lineWidth = u * 0.13;
      c.beginPath();
      if (horiz) {
        c.moveTo(X + u * 0.2, Y + Dp / 2 - off * u - railH * 0.2);
        c.lineTo(X + Wp - u * 0.2, Y + Dp / 2 - off * u - railH * 0.2);
      } else {
        c.moveTo(X + Wp / 2, Y + u * 0.2 - off * u);
        c.lineTo(X + Wp / 2, Y + Dp - u * 0.2 - off * u);
      }
      c.stroke();
      c.strokeStyle = S.shade(col, 0.1);
      c.lineWidth = u * 0.08;
      c.stroke();
    }
    for (let i = 0; i <= L; i += 1.5) {
      const px = horiz ? X + Math.min(i, L - 0.3) * u + u * 0.15 : X + Wp / 2 - u * 0.08;
      const py = horiz ? Y + Dp / 2 : Y + Math.min(i, L - 0.3) * u + u * 0.15;
      S.rr(c, px, py - u * 0.75, u * 0.16, u * 0.8, u * 0.06);
      S.fillStroke(c, col, OUT, u * 0.035);
    }
  }

  drawStatic(o, snap) {
    const c = this.ctx, u = this.u, t = this.time;
    const X = this.sx(o.x), Y = this.sy(o.z);
    switch (o.k) {
      case 'perk': {
        const pk = PERKS[o.perk];
        const col = S.hex(pk.color);
        S.shadow(c, X, Y + u * 0.3, u * 0.6, u * 0.2);
        S.rr(c, X - u * 0.5, Y - u * 1.4, u * 1.0, u * 1.75, u * 0.25);
        S.fillStroke(c, col, OUT, u * 0.06);
        S.rr(c, X - u * 0.36, Y - u * 1.22, u * 0.72, u * 0.7, u * 0.15);
        c.fillStyle = S.shade(col, 0.55 + Math.sin(t * 3) * 0.1);
        c.fill();
        c.fillStyle = S.shade(col, -0.5);
        c.font = `bold ${u * 0.48}px Fredoka, Segoe UI`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(pk.name[0], X, Y - u * 0.86);
        S.rr(c, X - u * 0.2, Y - u * 0.3, u * 0.4, u * 0.18, u * 0.06);
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fill();
        this.glowAt(o.x, o.z, 2.5, col, 0.25);
        this.label(o.x, o.z, 2.8, `${pk.name} · ${pk.cost}`, col, 4);
        return;
      }
      case 'ammo':
        S.drawBlock(c, X - u * 0.6, Y - u * 0.2, u * 1.2, u * 0.7, u * 0.4, '#6a8a44', '#4a6a30', u, 0.15);
        for (let i = 0; i < 4; i++) {
          S.rr(c, X - u * 0.4 + i * u * 0.24, Y - u * 0.85, u * 0.12, u * 0.32, u * 0.06);
          S.fillStroke(c, '#e8c050', OUT, u * 0.03);
        }
        this.label(o.x, o.z, 1.8, 'Ammo Cache', '#d6f08a', 4);
        return;
      case 'forge': {
        S.shadow(c, X, Y + u * 0.3, u * 0.9, u * 0.25);
        S.drawBlock(c, X - u * 0.8, Y - u * 0.3, u * 1.6, u * 0.8, u * 0.55, '#4a4a56', '#30303a', u, 0.2);
        S.rr(c, X - u * 0.55, Y - u * 0.8, u * 1.1, u * 0.45, u * 0.2);
        c.fillStyle = `rgba(255,${120 + Math.sin(t * 5) * 30},40,1)`;
        c.fill();
        this.glowAt(o.x, o.z, 3, '#ff8a3a', 0.35);
        if (Math.random() < 0.2) this.emit(o.x + (Math.random() - 0.5), o.z, 0.8, 0, 0, 1.5, '#ffb050', 0.8, 0.06, { glow: true });
        this.label(o.x, o.z, 2.2, 'Weapon Forge · 5000', '#ffaa60', 4);
        return;
      }
      case 'station': {
        const active = snap.O.mk.some((m) => m[2] === 1 && Math.abs(m[0] - o.x) < 0.2 && Math.abs(m[1] - (o.z + 0.8)) < 0.2);
        S.drawBlock(c, X - u * 0.45, Y - u * 0.15, u * 0.9, u * 0.6, u * 0.6, '#5a6070', '#3e4250', u, 0.15);
        S.rr(c, X - u * 0.32, Y - u * 0.68, u * 0.64, u * 0.38, u * 0.08);
        c.fillStyle = active ? `rgba(110,255,150,${0.7 + Math.sin(t * 6) * 0.3})` : 'rgba(80,110,130,0.9)';
        c.fill();
        return;
      }
      case 'sign':
        c.strokeStyle = '#5a3a20';
        c.lineWidth = u * 0.1;
        c.beginPath();
        c.moveTo(X, Y);
        c.lineTo(X, Y - u * 1.2);
        c.stroke();
        c.font = `bold ${u * 0.42}px Fredoka, Segoe UI`;
        {
          const w = c.measureText(o.text).width + u * 0.5;
          S.rr(c, X - w / 2, Y - u * 1.9, w, u * 0.75, u * 0.2);
          S.fillStroke(c, '#c49a64', OUT, u * 0.05);
        }
        c.fillStyle = '#3a2410';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(o.text, X, Y - u * 1.52);
        return;
      case 'scarecrow':
        c.strokeStyle = '#6a4a2a';
        c.lineWidth = u * 0.1;
        c.beginPath();
        c.moveTo(X, Y);
        c.lineTo(X, Y - u * 1.6);
        c.moveTo(X - u * 0.6, Y - u * 1.1);
        c.lineTo(X + u * 0.6, Y - u * 1.1);
        c.stroke();
        S.circle(c, X, Y - u * 1.7, u * 0.25);
        S.fillStroke(c, '#e8d8a0', OUT, u * 0.04);
        S.ellipse(c, X, Y - u * 1.88, u * 0.4, u * 0.1);
        S.fillStroke(c, '#c9a050', OUT, u * 0.04);
        return;
      case 'reeds':
        c.strokeStyle = '#5a8a3a';
        c.lineWidth = u * 0.05;
        c.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.moveTo(X + (i - 1.5) * u * 0.1, Y);
          c.quadraticCurveTo(X + (i - 1.5) * u * 0.15, Y - u * 0.4, X + (i - 1.5) * u * 0.2 + Math.sin(t * 2 + i) * u * 0.05, Y - u * 0.7);
          c.stroke();
        }
        return;
      case 'canopy': {
        const W = o.w * u, D = o.d * u;
        c.save();
        c.globalAlpha = this.fade(o.x, o.z, o.w, o.d, 3);
        S.rr(c, X, Y - u * 1.8, W, D, u * 0.3);
        S.fillStroke(c, '#e8e4dc', OUT, u * 0.06);
        c.fillStyle = '#c0392b';
        S.rr(c, X, Y - u * 1.8 + D - u * 0.35, W, u * 0.35, u * 0.15);
        c.fill();
        c.restore();
        return;
      }
    }
  }

  drawContainer(i, snap) {
    const c = this.ctx, u = this.u, t = this.time;
    const sp = this.world.spots.loot[i];
    const st = snap.C[i] || [1, 0];
    const full = st[0] === 1;
    const X = this.sx(sp.px), Y = this.sy(sp.pz);
    const cx = X + u / 2;
    let topY = Y;
    switch (sp.kind) {
      case 'rack':
        S.shadow(c, cx, Y + u * 0.85, u * 0.6, u * 0.15);
        S.rr(c, X + u * 0.02, Y - u * 0.7, u * 0.96, u * 1.45, u * 0.12);
        S.fillStroke(c, '#8a5a34', OUT, u * 0.05);
        // pegs + guns hanging on the rack
        for (let k = 0; k < 2; k++) {
          const gy = Y - u * 0.35 + k * u * 0.55;
          c.fillStyle = '#5a3a20';
          c.fillRect(X + u * 0.1, gy + u * 0.12, u * 0.8, u * 0.06);
          if (full) {
            const gs = S.gunSprite(k ? 'shotgun' : 'ar', false, u * 0.75);
            c.drawImage(gs.canvas, X + u * 0.5 - gs.len / 2, gy - gs.canvas.height / 2);
          }
        }
        topY = Y - u * 0.8;
        break;
      case 'locker':
        S.shadow(c, cx, Y + u * 0.85, u * 0.5, u * 0.15);
        S.rr(c, X + u * 0.1, Y - u * 0.9, u * 0.8, u * 1.7, u * 0.15);
        S.fillStroke(c, '#6f8aa6', OUT, u * 0.05);
        if (!full) {
          S.rr(c, X + u * 0.18, Y - u * 0.82, u * 0.64, u * 1.5, u * 0.1);
          c.fillStyle = '#2a3038';
          c.fill();
        } else {
          c.strokeStyle = 'rgba(0,0,0,0.3)';
          c.lineWidth = u * 0.04;
          for (let k = 0; k < 3; k++) {
            c.beginPath();
            c.moveTo(X + u * 0.3, Y - u * 0.7 + k * u * 0.1);
            c.lineTo(X + u * 0.7, Y - u * 0.7 + k * u * 0.1);
            c.stroke();
          }
        }
        topY = Y - u * 1.0;
        break;
      case 'crate':
      case 'chest': {
        const chest = sp.kind === 'chest';
        const top = chest ? '#b9783e' : '#c48a4e', front = chest ? '#8a5428' : '#9a6434';
        S.drawBlock(c, X + u * 0.08, Y + u * 0.15, u * 0.84, u * 0.7, u * 0.45, full ? top : S.shade(top, -0.25), front, u, chest ? 0.25 : 0.12);
        if (chest) {
          c.fillStyle = '#e8c050';
          c.fillRect(X + u * 0.45, Y - u * 0.3, u * 0.1, u * 1.1);
          if (full) this.glowAt(sp.px + 0.5, sp.pz + 0.5, 1.6, '#ffcf5a', 0.3);
        }
        if (!full) {
          S.rr(c, X + u * 0.18, Y - u * 0.22, u * 0.64, u * 0.5, u * 0.08);
          c.fillStyle = '#3a2412';
          c.fill();
        }
        topY = Y - u * 0.4;
        break;
      }
      case 'body': {
        const bx = this.sx(sp.x), by = this.sy(sp.z);
        S.ellipse(c, bx, by, u * 0.6, u * 0.28);
        c.fillStyle = 'rgba(110,20,20,0.35)';
        c.fill();
        S.rr(c, bx - u * 0.45, by - u * 0.18, u * 0.8, u * 0.36, u * 0.16);
        S.fillStroke(c, full ? '#6a7a5a' : '#5a5a5a', OUT, u * 0.04);
        S.circle(c, bx + u * 0.42, by - u * 0.02, u * 0.18);
        S.fillStroke(c, '#d0a888', OUT, u * 0.04);
        if (full) {
          S.rr(c, bx - u * 0.6, by - u * 0.05, u * 0.3, u * 0.25, u * 0.06);
          S.fillStroke(c, '#7a5a32', OUT, u * 0.03);
        }
        topY = by - u * 0.4;
        break;
      }
      case 'toolbox': {
        const bx = this.sx(sp.x), by = this.sy(sp.z);
        S.drawBlock(c, bx - u * 0.32, by - u * 0.1, u * 0.64, u * 0.3, u * 0.22, full ? '#d84a3a' : '#7a3a32', '#a8342a', u, 0.08);
        c.strokeStyle = '#3a3a3a';
        c.lineWidth = u * 0.05;
        c.beginPath();
        c.arc(bx, by - u * 0.32, u * 0.12, Math.PI, 0);
        c.stroke();
        topY = by - u * 0.4;
        break;
      }
      case 'car':
        topY = this.sy(sp.z) - u * 0.6;
        break;
    }
    const lx = sp.kind === 'body' || sp.kind === 'toolbox' || sp.kind === 'car' ? this.sx(sp.x) : cx;
    if (full) S.drawSparkle(c, lx + u * 0.25, topY - u * 0.25 + Math.sin(t * 3 + i) * u * 0.08, u, t + i, sp.kind === 'chest' ? '#ffd860' : '#fff6c8');
    if (st[1] > 0) {
      c.beginPath();
      c.arc(lx, topY - u * 0.5, u * 0.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st[1]);
      c.strokeStyle = '#ffe080';
      c.lineWidth = u * 0.1;
      c.lineCap = 'round';
      c.stroke();
    }
    if (full) this.label(sp.x, sp.z, sp.kind === 'car' ? 1.6 : 2.4, CONTAINERS[sp.kind].name, '#fff2c8', 2.6, undefined, true);
  }

  drawDoor(d) {
    const c = this.ctx, u = this.u;
    const X = this.sx(d.x), Y = this.sy(d.z), W = d.w * u, D = d.d * u;
    const sealed = d.cost >= 99999;
    if (sealed) {
      S.drawBlock(c, X, Y, W, D, u * 1.3, '#7a828c', '#5a6068', u, 0.1);
      c.strokeStyle = 'rgba(30,30,40,0.6)';
      c.lineWidth = u * 0.06;
      for (let x = X + u * 0.25; x < X + W; x += u * 0.4) {
        c.beginPath();
        c.moveTo(x, Y - u * 1.2);
        c.lineTo(x, Y + D - u * 0.1);
        c.stroke();
      }
    } else {
      for (let k = 0; k < 6; k++) {
        const px = X + W / 2 + Math.sin(d.id * 3 + k * 1.7) * W * 0.3, py = Y + D / 2 - k * u * 0.15;
        c.save();
        c.translate(px, py);
        c.rotate(Math.sin(k * 2.1 + d.id) * 0.6);
        S.rr(c, -u * 0.7, -u * 0.12, u * 1.4, u * 0.24, u * 0.08);
        S.fillStroke(c, k % 2 ? '#9a6a3e' : '#7a5230', OUT, u * 0.04);
        c.restore();
      }
    }
    this.label(d.x + d.w / 2, d.z + d.d / 2, 2.2, sealed ? d.label : `${d.label} · ${d.cost}`, sealed ? '#c8d4e0' : '#ffd890', 4);
  }

  drawBox(bs, snap) {
    const c = this.ctx, u = this.u, t = this.time;
    const [, state, wid, , , rarity] = snap.B;
    const X = this.sx(bs.x), Y = this.sy(bs.z - 0.5);
    const lift = state === 'moving' ? Math.min(3, (t % 4) * 1.5) * u : 0;
    this.glowAt(bs.x, bs.z - 0.5, 2.6, '#6fb8ff', 0.3);
    c.save();
    if (state === 'moving') c.globalAlpha = 0.6;
    S.shadow(c, X, Y + u * 0.35, u * 1.0, u * 0.25);
    S.drawBlock(c, X - u * 0.9, Y - u * 0.2 - lift, u * 1.8, u * 0.7, u * 0.55, '#a8743e', '#7a4e28', u, 0.22);
    c.fillStyle = '#f0c95a';
    for (const dx of [-0.55, 0.45]) c.fillRect(X + dx * u, Y - u * 0.75 - lift, u * 0.1, u * 1.2);
    c.fillStyle = `rgba(150,210,255,${0.7 + Math.sin(t * 4) * 0.3})`;
    c.font = `bold ${u * 0.5}px Fredoka, Segoe UI`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', X, Y - u * 0.45 - lift);
    c.restore();
    let show = '';
    if (state === 'spin') show = WIDS[Math.floor(t * 9) % WIDS.length];
    else if (state === 'offer') show = wid;
    if (show) {
      const gs = S.gunSprite(show, false, u * 1.3);
      const gy = Y - u * 1.6 + Math.sin(t * 3) * u * 0.1;
      if (state === 'offer') this.glowAt(bs.x, bs.z - 1.6, 1.4, S.rarityColor(rarity), 0.6);
      c.drawImage(gs.canvas, X - gs.len / 2, gy - gs.canvas.height / 2);
      if (state === 'offer') this.label(bs.x, bs.z - 0.5, 3.2, `${RARITY[rarity].name} ${WEAPONS[wid].name}`, S.rarityColor(rarity), 6);
    } else if (state === 'idle') {
      this.label(bs.x, bs.z - 0.5, 1.9, 'Mystery Box · 950', '#a8d4ff', 4);
    }
  }

  drawPlayer(o, view) {
    const p = o.p;
    if (p.s === 2) return;
    const look = S.playerLook(p.c);
    const w = p.w[p.cw] || p.w[0];
    const flicker = p.iv && p.s === 0 && Math.floor(this.time * 12) % 2 === 0;
    S.drawPerson(this.ctx, this.sx(o.x), this.sy(o.z), this.u, {
      ...look, aim: o.a, walk: o.walk, moving: o.moving && p.s === 0, time: this.time, gun: p.s === 0 && w ? w[0] : null, forged: w && w[1],
      down: p.s === 1, alpha: flicker ? 0.45 : 1,
    });
    if (p.id !== view.localId) {
      const tag = p.s === 1 ? `${p.n} — DOWN ${Math.ceil(p.bl)}s` : p.n;
      this.label(o.x, o.z, 2.9, tag, p.s === 1 ? '#ff8070' : '#a8d4ff', 999, p.hp / p.mh);
    }
  }

  drawZombie(o) {
    const c = this.ctx, u = this.u;
    const X = this.sx(o.x), Y = this.sy(o.z);
    const def = o.def;
    const look = o.look;
    const sc = def.scale;
    const rising = o.st === 0;
    let yOff = 0;
    if (rising) {
      const riseDur = def.boss || def.miniboss ? 2.4 : 1.4;
      const f = Math.max(0, Math.min(1, o.riseT / riseDur));
      yOff = f * u * 1.5 * sc;
      // dirt mound
      S.blob(c, X, Y, u * 0.55 * sc, o.seed, 0.25, 8);
      c.fillStyle = '#5a3e24';
      c.fill();
      c.save();
      c.beginPath();
      c.rect(X - u * 3 * sc, Y - u * 4 * sc, u * 6 * sc, u * 4 * sc + u * 0.05);
      c.clip();
    }
    const stun = o.st === 6;
    S.drawPerson(c, X + (stun ? Math.sin(this.time * 40) * u * 0.04 : 0), Y + yOff, u, {
      ...look, aim: o.a, walk: o.walk, moving: o.moving, time: this.time, seed: o.seed,
      attack: o.st === 2 || o.st === 3, hurt: o.flags & 2, alpha: o.type === 'phantom' ? 0.55 : 1,
    });
    S.drawZombieExtras(c, o.type, X, Y + yOff, u * sc, this.time, o.a);
    if (rising) {
      c.restore();
      S.ellipse(c, X, Y, u * 0.5 * sc, u * 0.18 * sc);
      c.fillStyle = '#6a4a2c';
      c.fill();
    }
    if (o.st === 3 && (def.boss || def.miniboss)) {
      S.circle(c, X, Y - u * 2.1 * sc, u * 0.22);
      c.fillStyle = `rgba(255,60,40,${0.6 + Math.sin(this.time * 20) * 0.4})`;
      c.fill();
    }
    if (stun) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        S.drawSparkle(c, X + Math.cos(a) * u * 0.35, Y - u * 1.6 * sc + Math.sin(a) * u * 0.12, u * 0.8, this.time, '#9fe0ff');
      }
    }
    // HP bar for regular zombies once damaged
    if (!rising && o.hp < 1 && !def.boss) {
      const bw = u * (def.miniboss ? 1.6 : 0.8), bh = u * 0.12;
      const by = Y - u * 1.65 * sc - u * 0.1;
      S.rr(c, X - bw / 2, by, bw, bh, bh / 2);
      c.fillStyle = 'rgba(20,10,10,0.7)';
      c.fill();
      S.rr(c, X - bw / 2, by, bw * Math.max(0, o.hp), bh, bh / 2);
      c.fillStyle = def.miniboss ? '#ff7a4a' : '#e2574c';
      c.fill();
    }
  }

  drawDying(o) {
    const c = this.ctx;
    const a = Math.max(0, 1 - Math.max(0, o.deathT - 1.2));
    S.drawPerson(c, this.sx(o.x), this.sy(o.z), this.u, { ...o.look, aim: o.a, walk: 0, moving: false, time: 0, down: true, alpha: a * (o.type === 'phantom' ? 0.5 : 1) });
  }

  drawPickup(it) {
    const c = this.ctx, u = this.u, t = this.time;
    const [id, kind, x, z, sub, rarity] = it;
    const meta = this.pickups.get(id) || { born: 0 };
    const age = t - meta.born;
    const X = this.sx(x), Y = this.sy(z);
    const bob = Math.sin(t * 3 + id) * u * 0.08;
    const pop = age < 0.35 ? Math.sin((age / 0.35) * Math.PI) * u * 0.8 : 0;
    if (kind === 'weapon') {
      const col = S.rarityColor(rarity);
      S.ellipse(c, X, Y, u * 0.65, u * 0.26);
      c.fillStyle = S.rgba(col, 0.35);
      c.fill();
      c.strokeStyle = col;
      c.lineWidth = u * 0.05;
      c.stroke();
      if (rarity >= 2) {
        const g = c.createLinearGradient(0, Y, 0, Y - u * 3);
        g.addColorStop(0, S.rgba(col, 0.4));
        g.addColorStop(1, S.rgba(col, 0));
        c.fillStyle = g;
        c.fillRect(X - u * 0.25, Y - u * 3, u * 0.5, u * 3);
      }
      const gs = S.gunSprite(sub, false, u * 1.4);
      c.save();
      c.translate(X, Y - u * 0.6 + bob - pop);
      c.rotate(Math.sin(t * 1.5 + id) * 0.15);
      c.drawImage(gs.canvas, -gs.len / 2, -gs.canvas.height / 2);
      c.restore();
      this.label(x, z, 1.9, `${RARITY[rarity].name} ${WEAPONS[sub].name}`, col, 3.2, undefined, true);
      return;
    }
    if (kind === 'power') {
      const col = S.hex(POWERUPS[sub].color);
      this.glowAt(x, z, 1.4, col, 0.5);
      S.circle(c, X, Y - u * 0.7 + bob, u * 0.38);
      S.fillStroke(c, col, OUT, u * 0.05);
      c.fillStyle = '#1a1a1a';
      c.font = `bold ${u * 0.38}px Fredoka, Segoe UI`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText({ maxammo: 'A', instakill: '☠', double: '×2', nuke: '✸' }[sub] || '?', X, Y - u * 0.7 + bob);
      return;
    }
    if (kind === 'item') {
      const col = { radio_part: '#ffd04a', keycard: '#5ac8ff', charge: '#ff7a4a', sample: '#7affd8', vial: '#7aff7a' }[sub] || '#ffffff';
      const g = c.createLinearGradient(0, Y, 0, Y - u * 5);
      g.addColorStop(0, S.rgba(col, 0.45));
      g.addColorStop(1, S.rgba(col, 0));
      c.fillStyle = g;
      c.fillRect(X - u * 0.3, Y - u * 5, u * 0.6, u * 5);
      S.drawSparkle(c, X, Y - u * 0.7 + bob, u * 2.6, t, col);
      return;
    }
    // small supplies
    const y = Y - u * 0.35 + bob - pop;
    S.shadow(c, X, Y, u * 0.3, u * 0.1);
    if (kind === 'ammo') {
      S.rr(c, X - u * 0.28, y - u * 0.18, u * 0.56, u * 0.36, u * 0.08);
      S.fillStroke(c, '#6a8a44', OUT, u * 0.04);
      c.fillStyle = '#f2d050';
      for (let i = 0; i < 3; i++) c.fillRect(X - u * 0.16 + i * u * 0.12, y - u * 0.3, u * 0.07, u * 0.16);
    } else if (kind === 'cash') {
      for (let i = 0; i < 3; i++) {
        S.ellipse(c, X, y - i * u * 0.08, u * 0.22, u * 0.1);
        S.fillStroke(c, '#f2c94a', OUT, u * 0.03);
      }
    } else if (kind === 'grenade') {
      S.circle(c, X, y, u * 0.18);
      S.fillStroke(c, '#5a7a3a', OUT, u * 0.04);
    } else if (kind === 'health') {
      S.rr(c, X - u * 0.24, y - u * 0.2, u * 0.48, u * 0.4, u * 0.08);
      S.fillStroke(c, '#f4f4f0', OUT, u * 0.04);
      c.fillStyle = '#e2453a';
      c.fillRect(X - u * 0.05, y - u * 0.14, u * 0.1, u * 0.28);
      c.fillRect(X - u * 0.14, y - u * 0.05, u * 0.28, u * 0.1);
    }
  }

  drawStruct(s) {
    const c = this.ctx, u = this.u;
    if (s.k === 'wall') {
      const steel = s.l >= 5;
      for (const [cx, cz] of s.c) {
        const X = this.sx(cx), Y = this.sy(cz);
        S.drawBlock(c, X + u * 0.04, Y + u * 0.1, u * 0.92, u * 0.8, u * 0.75, steel ? '#a8b0b8' : '#c49a64', steel ? '#7a8288' : '#946a3e', u, 0.15);
        if (!steel) {
          c.strokeStyle = 'rgba(80,50,25,0.5)';
          c.lineWidth = u * 0.04;
          c.beginPath();
          c.moveTo(X + u * 0.1, Y + u * 0.6);
          c.lineTo(X + u * 0.9, Y + u * 0.6);
          c.stroke();
        }
        if (s.sp) {
          c.fillStyle = '#d8d8dc';
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.moveTo(X + u * (0.2 + i * 0.3), Y + u * 0.95);
            c.lineTo(X + u * (0.28 + i * 0.3), Y + u * 1.25);
            c.lineTo(X + u * (0.36 + i * 0.3), Y + u * 0.95);
            c.fill();
          }
        }
        if (s.hp < 0.5) {
          c.strokeStyle = 'rgba(40,20,10,0.7)';
          c.lineWidth = u * 0.04;
          c.beginPath();
          c.moveTo(X + u * 0.3, Y - u * 0.6);
          c.lineTo(X + u * 0.5, Y - u * 0.3);
          c.lineTo(X + u * 0.4, Y);
          c.stroke();
        }
      }
    } else {
      const X = this.sx(s.x), Y = this.sy(s.z);
      if (s.lf < 0.15 && Math.floor(this.time * 8) % 2) return;
      S.shadow(c, X, Y + u * 0.2, u * 0.45, u * 0.15);
      c.strokeStyle = '#3a3a40';
      c.lineWidth = u * 0.08;
      c.lineCap = 'round';
      for (const dx of [-0.3, 0, 0.3]) {
        c.beginPath();
        c.moveTo(X, Y - u * 0.5);
        c.lineTo(X + dx * u, Y + u * 0.2);
        c.stroke();
      }
      c.save();
      c.translate(X, Y - u * 0.6);
      c.rotate(s.a);
      S.rr(c, -u * 0.3, -u * 0.25, u * 0.6, u * 0.5, u * 0.15);
      S.fillStroke(c, s.l >= 5 ? '#d0583a' : '#4a7ec8', OUT, u * 0.05);
      S.rr(c, u * 0.2, -u * 0.08, u * 0.5, u * 0.16, u * 0.06);
      S.fillStroke(c, '#2e3036', OUT, u * 0.03);
      c.restore();
      S.circle(c, X, Y - u * 0.6, u * 0.07);
      c.fillStyle = '#ff4a3a';
      c.fill();
    }
  }

  drawProjectiles(snap) {
    const c = this.ctx, u = this.u;
    for (const [, kind, x, y, z, forged] of snap.R) {
      const X = this.sx(x), Y = this.sy(z) - y * K * u;
      const spec = {
        frag: ['#4a5a3a', 0.15], grenade: ['#5a6a3a', 0.18], ray: [forged ? '#ff6aff' : '#6aff8a', 0.2], bolt: ['#ff5a4a', 0.14],
        spit: ['#8aff4a', 0.24], rock: ['#8a7058', 0.45], rocket: ['#d8d8d8', 0.18],
      }[kind] || ['#ffffff', 0.15];
      S.shadow(this.ctx, X, this.sy(z), u * spec[1], u * spec[1] * 0.4, 0.2);
      if (kind === 'ray' || kind === 'spit' || kind === 'bolt') {
        S.circle(c, X, Y, u * spec[1] * 2);
        c.fillStyle = S.rgba(spec[0], 0.3);
        c.fill();
        this.emit(x, z, y, 0, 0, 0, spec[0], 0.25, spec[1] * 0.8, { glow: true });
      } else if (kind === 'rocket' || kind === 'grenade') {
        this.emit(x, z, y, 0, 0, 0.3, '#b8b8b8', 0.5, 0.18, { grow: 1.5 });
      }
      S.circle(c, X, Y, u * spec[1]);
      S.fillStroke(c, spec[0], OUT, u * 0.03);
    }
  }

  drawEffects() {
    const c = this.ctx, u = this.u;
    // tracers
    c.lineCap = 'round';
    for (const t of this.tracers) {
      const f = t.life / t.max;
      c.strokeStyle = S.rgba(t.col, f);
      c.lineWidth = u * 0.06 * (0.5 + f);
      c.beginPath();
      c.moveTo(this.sx(t.x1), this.sy(t.z1) - u * 0.65);
      c.lineTo(this.sx(t.x2), this.sy(t.z2) - u * 0.65);
      c.stroke();
    }
    // lightning
    for (const b of this.bolts) {
      const f = b.life / b.max;
      for (const [col, w] of [['rgba(120,190,255,' + f + ')', 0.16], ['rgba(255,255,255,' + f + ')', 0.06]]) {
        c.strokeStyle = col;
        c.lineWidth = u * w;
        c.beginPath();
        b.pts.forEach(([x, z], i) => (i ? c.lineTo(this.sx(x), this.sy(z) - u * 0.8) : c.moveTo(this.sx(x), this.sy(z) - u * 0.8)));
        c.stroke();
      }
    }
    // rings
    for (const r of this.rings) {
      const f = r.life / r.max;
      const rad = (r.r1 + (r.r0 - r.r1) * f) * u;
      S.ellipse(c, this.sx(r.x), this.sy(r.z), rad, rad * (r.flat ? 0.5 : 1));
      c.strokeStyle = S.rgba(r.col, f);
      c.lineWidth = u * (r.w || 0.12);
      c.stroke();
    }
    // particles
    for (const p of this.particles) {
      const f = p.life / p.max;
      const X = this.sx(p.x), Y = this.sy(p.z) - p.h * K * u;
      const size = p.size * u * (1 + p.grow * (1 - f));
      if (size <= 0.3) continue;
      if (p.shape === 'leaf') {
        c.save();
        c.translate(X, Y);
        c.rotate(p.h * 2 + p.x);
        S.ellipse(c, 0, 0, size, size * 0.5);
        c.fillStyle = S.rgba(p.col, Math.min(1, f * 2));
        c.fill();
        c.restore();
        continue;
      }
      if (p.shape === 'streak') {
        c.strokeStyle = S.rgba(p.col, 0.5);
        c.lineWidth = Math.max(1, u * 0.03);
        c.beginPath();
        c.moveTo(X, Y);
        c.lineTo(X - u * 0.1, Y - u * 0.5);
        c.stroke();
        continue;
      }
      if (p.glow) c.globalCompositeOperation = 'lighter';
      S.circle(c, X, Y, size);
      c.fillStyle = S.rgba(p.col, Math.min(1, f * 1.6));
      c.fill();
      if (p.glow) c.globalCompositeOperation = 'source-over';
    }
  }

  glowAt(x, z, r, col, a) {
    this.flashes.push({ x, z, r, col, a, life: 0.0001, max: 0.0001, static: true });
  }

  drawLighting(snap, view) {
    const th = this.theme;
    const c = this.ctx, u = this.u;
    const lights = [];
    for (const p of this.players.values()) if (p.p.s !== 2) lights.push([p.x, p.z, p.p.id === view.localId ? 7.5 : 5, '#ffe8c0', 0.25]);
    for (const l of this.lights) lights.push([l.x, l.z, l.distance * (l.flicker ? 0.9 + Math.sin(this.time * 9 + l.x) * 0.08 : 1), l.color, 0.4]);
    for (const f of this.flashes) lights.push([f.x, f.z, f.r * (f.static ? 1 : f.life / f.max + 0.3), f.col, f.a * (f.static ? 1 : f.life / f.max)]);
    for (const [, kind, x, z, r] of snap.H) if (kind === 'fire' || kind === 'napalm' || kind === 'heal') lights.push([x, z, r * 2.5, kind === 'heal' ? '#7fffb0' : '#ff8a3a', 0.35]);
    for (const o of this.zombies.values()) if (o.type === 'burner' || o.flags & 1) lights.push([o.x, o.z, 3, '#ff8a3a', 0.3]);
    const vis = lights.filter(([x, z, r]) => Math.abs(x - this.cam.x) < this.canvas.width / u / 2 + r && Math.abs(z - this.cam.z) < this.canvas.height / u / 2 + r);
    if (th.dark > 0) {
      const L = this.lctx, lw = this.light.width, lh = this.light.height;
      L.globalCompositeOperation = 'source-over';
      L.clearRect(0, 0, lw, lh);
      L.globalAlpha = th.dark;
      L.fillStyle = th.tint;
      L.fillRect(0, 0, lw, lh);
      L.globalAlpha = 1;
      L.globalCompositeOperation = 'destination-out';
      for (const [x, z, r] of vis) {
        const X = this.sx(x) / 2, Y = (this.sy(z) - u * 0.5) / 2, R = (r * u) / 2;
        const g = L.createRadialGradient(X, Y, 0, X, Y, R);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.5, 'rgba(0,0,0,0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        L.fillStyle = g;
        L.fillRect(X - R, Y - R, R * 2, R * 2);
      }
      c.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    }
    // warm additive glow
    c.globalCompositeOperation = 'lighter';
    for (const [x, z, r, col, a] of vis) {
      if (a <= 0.26 && col === '#ffe8c0') continue;
      const X = this.sx(x), Y = this.sy(z) - u * 0.5, R = r * u * 0.6;
      const g = c.createRadialGradient(X, Y, 0, X, Y, R);
      g.addColorStop(0, S.rgba(col, a * (th.dark > 0 ? 0.55 : 0.3)));
      g.addColorStop(1, S.rgba(col, 0));
      c.fillStyle = g;
      c.fillRect(X - R, Y - R, R * 2, R * 2);
    }
    c.globalCompositeOperation = 'source-over';
    this.flashes = this.flashes.filter((f) => !f.static);
    // soft vignette
    const cw = this.canvas.width, ch = this.canvas.height;
    const g = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,8,20,0.45)');
    c.fillStyle = g;
    c.fillRect(0, 0, cw, ch);
  }

  // label above a world point, only when the local player is within `near` units
  // `excl` labels compete: only the one closest to the player is shown
  label(x, z, h, text, col, near, hpFrac, excl) {
    if (!this.me) return;
    const d = Math.hypot(this.me.x - x, this.me.z - z);
    if (near < 900 && d > near) return;
    if (excl) {
      if (!this.exclLabel || d < this.exclLabel.d) this.exclLabel = { d, l: [x, z, h, text, col, hpFrac] };
      return;
    }
    (this.labelQueue || (this.labelQueue = [])).push([x, z, h, text, col, hpFrac]);
  }

  drawOverlayUI(snap, view) {
    const c = this.ctx, u = this.u;
    // labels
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const fs = Math.max(11 * this.dpr, u * 0.36);
    c.font = `700 ${fs}px Nunito, Segoe UI, sans-serif`;
    const labels = this.labelQueue || [];
    if (this.exclLabel) labels.push(this.exclLabel.l);
    this.exclLabel = null;
    for (const [x, z, h, text, col, hpFrac] of labels) {
      const X = this.sx(x), Y = this.sy(z) - h * u * K * 1.25;
      const w = c.measureText(text).width + fs;
      S.rr(c, X - w / 2, Y - fs * 0.8, w, fs * 1.6, fs * 0.8);
      c.fillStyle = 'rgba(28,22,30,0.72)';
      c.fill();
      c.fillStyle = col;
      c.fillText(text, X, Y + fs * 0.05);
      if (hpFrac !== undefined) {
        S.rr(c, X - w / 2 + fs * 0.4, Y + fs * 0.55, (w - fs * 0.8) * Math.max(0, hpFrac), fs * 0.18, fs * 0.09);
        c.fillStyle = '#6fd36a';
        c.fill();
      }
    }
    this.labelQueue = [];
    // floating texts (damage numbers etc.)
    for (const t of this.texts) {
      const f = t.life / t.max;
      const rise = (1 - f) * 1.2;
      const X = this.sx(t.x), Y = this.sy(t.z) - (t.h + rise) * u * K * 1.4;
      const pop = f > 0.85 ? 1 + (f - 0.85) * 3 : 1;
      c.font = `800 ${t.size * u * pop}px Fredoka, Segoe UI, sans-serif`;
      c.globalAlpha = Math.min(1, f * 2.5);
      c.lineWidth = Math.max(2, u * 0.08);
      c.strokeStyle = 'rgba(30,20,25,0.9)';
      c.strokeText(t.text, X, Y);
      c.fillStyle = t.col;
      c.fillText(t.text, X, Y);
      c.globalAlpha = 1;
    }
    // bouncing arrows above objective markers + off-screen pointers
    const me = this.me;
    const cw = this.canvas.width, ch = this.canvas.height;
    const marks = snap.O.mk.map((m) => [m[0], m[1], m[2]]);
    if (snap.O.zone) marks.push([snap.O.zone[0], snap.O.zone[1], 3]);
    for (const [x, z, type] of marks) {
      const X = this.sx(x), Y = this.sy(z);
      const col = type === 2 ? '#ff5a4a' : type === 3 ? '#6ac8ff' : '#ffd65a';
      const onScreen = X > u && X < cw - u && Y > u * 2 && Y < ch - u;
      if (onScreen) {
        if (type !== 2) {
          const by = Y - u * 2.4 + Math.sin(this.time * 5) * u * 0.18;
          c.beginPath();
          c.moveTo(X - u * 0.3, by - u * 0.3);
          c.lineTo(X + u * 0.3, by - u * 0.3);
          c.lineTo(X, by + u * 0.1);
          c.closePath();
          S.fillStroke(c, col, OUT, u * 0.05);
        }
      } else if (me) {
        const a = Math.atan2(Y - ch / 2, X - cw / 2);
        const m = u * 1.2;
        // keep arrows clear of the bottom HUD panels
        const ex = Math.max(m, Math.min(cw - m, cw / 2 + Math.cos(a) * cw)), ey = Math.max(m, Math.min(ch - 150 * this.dpr, ch / 2 + Math.sin(a) * ch));
        c.save();
        c.translate(ex, ey);
        c.rotate(a);
        c.beginPath();
        c.moveTo(u * 0.5, 0);
        c.lineTo(-u * 0.3, -u * 0.35);
        c.lineTo(-u * 0.15, 0);
        c.lineTo(-u * 0.3, u * 0.35);
        c.closePath();
        S.fillStroke(c, col, OUT, u * 0.05);
        c.restore();
        const d = Math.round(Math.hypot(x - me.x, z - me.z));
        c.font = `700 ${fs * 0.9}px Fredoka, Segoe UI`;
        c.fillStyle = col;
        c.fillText(d + 'm', ex - Math.cos(a) * u * 0.9, ey - Math.sin(a) * u * 0.9);
      }
    }
  }

  // ---------------------------------------------------------------- events
  handleEvent(e, view) {
    const camD = (x, z) => Math.hypot(x - this.cam.x, z - this.cam.z);
    switch (e.k) {
      case 'fire': {
        const w = WEAPONS[WIDS[e.w]];
        const mx = e.x + Math.cos(e.a) * w.len * 0.7, mz = e.z + Math.sin(e.a) * w.len * 0.7;
        if (w.type === 'flame') {
          for (let i = 0; i < 4; i++) {
            const a = e.a + (Math.random() - 0.5) * 0.6, s = 8 + Math.random() * 5;
            this.emit(mx, mz, 0.9, Math.cos(a) * s, Math.sin(a) * s, 0.3, Math.random() < 0.4 ? '#ffe070' : e.f ? '#c46aff' : '#ff7a2a', 0.5, 0.2, { grow: 2.2, drag: 2.2, glow: true });
          }
        } else {
          this.emit(mx, mz, 0.95, 0, 0, 0, e.f ? '#e0a0ff' : '#fff0b0', 0.06, 0.35, { glow: true });
          if (w.type !== 'chain') this.emit(e.x, e.z, 0.9, -Math.sin(e.a) * 2, Math.cos(e.a) * 2, 2, '#e0b040', 0.7, 0.06, { g: 12 });
        }
        this.flashes.push({ x: mx, z: mz, r: 3, col: e.f ? '#c080ff' : w.type === 'flame' ? '#ff8a3a' : '#ffd890', a: 0.6, life: 0.06, max: 0.06 });
        break;
      }
      case 't': {
        const col = e.w < 0 ? '#9fdcff' : e.f ? '#d080ff' : S.hex(WEAPONS[WIDS[e.w]].color);
        this.tracers.push({ x1: e.x, z1: e.z, x2: e.x2, z2: e.z2, col, life: 0.08, max: 0.08 });
        break;
      }
      case 'h':
        this.burst(e.x, e.z, 0.8, 5, ['#a01818', '#7a1010', '#c02a2a'], 3, 0.45, 0.08, { g: 12, up: 0.8 });
        if (Math.random() < 0.25) this.splat(e.x + (Math.random() - 0.5), e.z + (Math.random() - 0.5), 0.18 + Math.random() * 0.2, '#7a1414', 0.35);
        break;
      case 'dmg':
        this.text(e.x, e.z, 1.6, String(e.d), e.c ? '#ffd23a' : '#ffffff', e.c ? 0.6 : 0.42, 0.8);
        break;
      case 'die':
        this.burst(e.x, e.z, 0.8, 12, ['#a01818', '#6a0e0e'], 4, 0.6, 0.1, { g: 12, up: 1 });
        this.splat(e.x, e.z, 0.4 + Math.random() * 0.3, '#6a1010', 0.45);
        break;
      case 'boom': {
        this.rings.push({ x: e.x, z: e.z, r0: 0.3, r1: e.r * 1.1, col: '#ffb050', life: 0.35, max: 0.35, w: 0.2, flat: true });
        this.burst(e.x, e.z, 0.4, 30, ['#ffb030', '#ff6a1a', '#ffe070'], 7 * (e.r / 3), 0.55, 0.28, { up: 0.6, drag: 3, grow: 1, glow: true });
        this.burst(e.x, e.z, 0.4, 18, ['#505050', '#3a3a3a', '#6a6a6a'], 3 * (e.r / 3), 1.4, 0.4, { up: 0.6, drag: 1, grow: 2 });
        this.flashes.push({ x: e.x, z: e.z, r: e.r * 3, col: '#ffa040', a: 0.9, life: 0.35, max: 0.35 });
        this.splat(e.x, e.z, e.r * 0.45, '#1e1a16', 0.35);
        this.shake = Math.min(1.4, this.shake + Math.max(0, 1 - camD(e.x, e.z) / 30) * (e.r / 4));
        break;
      }
      case 'spawn':
        this.burst(e.x, e.z, 0.1, e.big ? 50 : 18, ['#6a4a2a', '#4a3420', '#8a6a44'], e.big ? 6 : 3, 0.9, e.big ? 0.22 : 0.13, { g: 10, up: 1.2, spread: e.big ? 2 : 0.6 });
        this.splat(e.x, e.z, e.big ? 1.6 : 0.65, '#3a2814', 0.4);
        if (e.big) this.shake = Math.min(1.5, this.shake + 0.8);
        break;
      case 'zap': {
        for (let i = 0; i + 3 < e.pts.length; i += 2) {
          const pts = [];
          const x1 = e.pts[i], z1 = e.pts[i + 1], x2 = e.pts[i + 2], z2 = e.pts[i + 3];
          const n = Math.max(3, Math.floor(Math.hypot(x2 - x1, z2 - z1) / 0.7));
          for (let k = 0; k <= n; k++) {
            const t = k / n, j = k === 0 || k === n ? 0 : 0.4;
            pts.push([x1 + (x2 - x1) * t + (Math.random() - 0.5) * j, z1 + (z2 - z1) * t + (Math.random() - 0.5) * j]);
          }
          this.bolts.push({ pts, life: 0.22, max: 0.22 });
          this.burst(x2, z2, 1, 5, '#b0e4ff', 4, 0.3, 0.08, { glow: true });
          this.flashes.push({ x: x2, z: z2, r: 2.5, col: '#8fd0ff', a: 0.7, life: 0.2, max: 0.2 });
        }
        break;
      }
      case 'heal':
        this.rings.push({ x: e.x, z: e.z, r0: 0.4, r1: e.r, col: '#6ff0a0', life: 0.6, max: 0.6, flat: true });
        this.burst(e.x, e.z, 0.3, 30, ['#7fffb0', '#c8ffe0'], 3, 1, 0.12, { up: 1.5, drag: 2, glow: true });
        break;
      case 'strike':
        this.rings.push({ x: e.x, z: e.z, r0: e.r, r1: e.r, col: '#ff4a3a', life: 1.6, max: 1.6, flat: true, w: 0.08 });
        for (let i = 0; i < 25; i++) this.emit(e.x + (Math.random() - 0.5), e.z + (Math.random() - 0.5), 0.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 2 + Math.random() * 2, '#ff5a4a', 1.5, 0.25, { grow: 2, drag: 0.5 });
        break;
      case 'slam':
        this.rings.push({ x: e.x, z: e.z, r0: 0.4, r1: e.r, col: '#e0c890', life: 0.5, max: 0.5, flat: true, w: 0.25 });
        this.burst(e.x, e.z, 0.2, 30, ['#a08a64', '#7a6a4a'], 6, 0.8, 0.22, { up: 0.5, drag: 2, grow: 1.4, spread: 1 });
        this.shake = Math.min(1.5, this.shake + Math.max(0, 1 - camD(e.x, e.z) / 25) * 0.9);
        break;
      case 'tele':
        this.rings.push({ x: e.x, z: e.z, r0: 3, r1: 0.5, col: '#ff4a3a', life: 0.7, max: 0.7, flat: true });
        break;
      case 'blink':
        this.burst(e.x, e.z, 1, e.big ? 36 : 16, ['#b07aff', '#6a2ad0'], 3, 0.6, 0.14, { glow: true });
        this.burst(e.x2, e.z2, 1, e.big ? 36 : 16, ['#b07aff', '#6a2ad0'], 3, 0.6, 0.14, { glow: true });
        break;
      case 'melee':
        for (let i = 0; i < 10; i++) {
          const a = e.a - 0.9 + (i / 9) * 1.8;
          this.emit(e.x + Math.cos(a) * 1.3, e.z + Math.sin(a) * 1.3, 0.8, 0, 0, 0, '#ffffff', 0.15, 0.1);
        }
        break;
      case 'hitwall':
        this.burst(e.x, e.z, 0.6, 5, ['#a87a4a', '#7a5230'], 3, 0.5, 0.08, { g: 10 });
        break;
      case 'sbreak':
        this.burst(e.x, e.z, 0.6, 30, ['#a87a4a', '#7a5230', '#6a6a6a'], 5, 0.8, 0.14, { g: 10, up: 1, spread: 2 });
        break;
      case 'door':
        this.burst(e.x, e.z, 0.6, 40, ['#a89a8a', '#7a6a5a'], 4, 1.1, 0.3, { up: 1, drag: 1.5, grow: 1.5, spread: 2 });
        break;
      case 'loot': {
        const col = e.r >= 0 ? S.rarityColor(e.r) : '#fff2c0';
        this.burst(e.x, e.z, 0.8, e.r >= 3 ? 40 : 18, [col, '#ffffff'], e.r >= 3 ? 5 : 3, 0.8, 0.1, { up: 1.4, g: 4, glow: true });
        if (e.r >= 0) this.text(e.x, e.z, 2.2, RARITY[e.r].name + '!', col, e.r >= 3 ? 0.6 : 0.45, 1.4);
        break;
      }
      case 'float':
        this.text(e.x, e.z, 1.4, e.s, '#c8ffb0', 0.42, 1.3);
        break;
      case 'levelup':
        this.rings.push({ x: e.x, z: e.z, r0: 0.4, r1: 2.5, col: '#ffd65a', life: 0.8, max: 0.8, flat: true, w: 0.18 });
        this.burst(e.x, e.z, 0.5, 40, ['#ffd65a', '#fff2b0', '#ffb030'], 4, 1.2, 0.12, { up: 1.6, drag: 1, glow: true });
        this.text(e.x, e.z, 2.8, 'LEVEL ' + e.r + '!', '#ffd65a', 0.7, 1.8);
        break;
      case 'boon':
        this.text(e.x, e.z, 2.5, BOONS[e.b].icon + ' ' + BOONS[e.b].name, BOONS[e.b].color, 0.5, 1.6);
        break;
      case 'nuke':
        this.shake = 1.5;
        break;
      case 'shake':
        this.shake = Math.min(1.5, this.shake + e.i);
        break;
    }
  }

  ambient(dt) {
    const kind = this.theme.particles;
    const cw = this.canvas.width / this.u, ch = this.canvas.height / this.u;
    const rate = { rain: 180, snow: 70, embers: 22, dust: 14, leaves: 6 }[kind] || 0;
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n--;
      const x = this.cam.x + (Math.random() - 0.5) * cw * 1.1, z = this.cam.z + (Math.random() - 0.5) * ch * 1.2;
      if (kind === 'rain') this.emit(x, z, 6, 0.6, 0.3, -24, '#b8c8e8', 0.3, 0.05, { shape: 'streak' });
      else if (kind === 'snow') this.emit(x, z, 5 + Math.random() * 3, 0.5 + Math.random() * 0.6, 0.2, -1.2, '#ffffff', 4, 0.07);
      else if (kind === 'embers') this.emit(x, z, 0.2, (Math.random() - 0.5) * 0.5, -0.2, 0.7 + Math.random(), Math.random() < 0.5 ? '#ff7a3a' : '#ffb04a', 3.5, 0.05, { glow: true });
      else if (kind === 'dust') this.emit(x, z, 0.3 + Math.random(), 2.2 + Math.random(), 0.2, 0, '#f4e2bc', 3, 0.04);
      else if (kind === 'leaves') this.emit(x, z, 4 + Math.random() * 2, 0.8 + Math.random() * 0.5, 0.3, -0.9, ['#e8a040', '#d0602a', '#a8c050'][Math.floor(Math.random() * 3)], 6, 0.1, { shape: 'leaf' });
    }
  }
}
