// One running match. Roles:
//   solo   - local sim, no network
//   host   - local sim, broadcasts snapshots to clients, applies their inputs
//   client - renders host snapshots, predicts its own movement locally
import { Game, createWorld, getMap, stepMovement, playerSpeed, WIDS, mergeActs, swapTarget } from './game/sim.js';
import { WEAPONS } from './data/weapons.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { resolveBinds } from './keybinds.js';

const STEP = 1 / 60;
const SNAP_INTERVAL = 50; // ms
const INPUT_INTERVAL = 33; // ms
const DIGITS = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 };

export class Session {
  constructor(app, opts) {
    this.app = app;
    this.role = opts.role;
    this.net = opts.net;
    this.localId = opts.localId;
    this.map = getMap(opts.mapId);
    this.opts = opts;
    this.paused = false;
    this.ended = false;
    this.acc = 0;
    this.netEvents = [];
    this.lastSnapSend = 0;
    this.lastInputSend = 0;
    this.pendingActs = {};
    this.clientEvents = [];
    this.snap = null;
    this.groanT = 2;
    this.localFireCd = 0; // client: predicted gunfire, so our own shots sound instantly
    this.localFireT = -1;
    this.stats = { maxWave: 0 };
  }

  start() {
    const container = document.getElementById('game');
    container.innerHTML = '';
    container.style.display = 'block';
    if (this.role === 'client') {
      this.world = createWorld(this.map);
      this.sgrid = new Int32Array(this.world.W * this.world.H);
      this.pred = null;
    } else {
      this.game = new Game({
        mapId: this.opts.mapId, mode: this.opts.mode, seed: this.opts.seed, players: this.opts.players, unlockedMap: this.opts.unlockedMap,
      });
      this.world = this.game.world;
      this.snap = this.game.snapshot();
    }
    this.renderer = new Renderer(container);
    this.renderer.shakeEnabled = this.app.profile.settings.shake;
    this.renderer.setGraphics(this.app.profile.settings.graphics);
    this.renderer.loadWorld(this.world, this.map);
    const hudRoot = document.getElementById('hud');
    hudRoot.style.display = 'block';
    this.hud = new Hud(hudRoot);
    this.hud.setWorld(this.world, this.map);
    this.hud.onPick = (i) => this.pick(i);
    this.binds = resolveBinds(this.app.profile.settings.keys);
    this.hud.setKeys(this.binds);
    this.input = new Input(window, this.binds);
    this.input.onWheel = (s) => (this.renderer.zoom = Math.max(0.65, Math.min(1.5, this.renderer.zoom + s * 0.08)));
    this.input.onKey = (e, code) => this.onKey(e, code);
    this.last = performance.now();
    this.running = true;
    this.app.audio.startMusic(this.map.id);
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(t);
      } catch (err) {
        console.error(err);
        this.app.reportError(err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    if (this.input) this.input.dispose();
    if (this.renderer) this.renderer.dispose();
    this.app.audio.stopMusic();
    document.getElementById('hud').style.display = 'none';
    document.getElementById('hud').innerHTML = '';
    document.getElementById('game').style.display = 'none';
  }

  // code: e.code with left/right modifiers merged (see keybinds.js). Called on keydown and keyup.
  onKey(e, code) {
    const down = e.type === 'keydown';
    if (code === 'Escape' && down && !e.repeat) {
      // Esc closes the big map first, then works as pause
      if (this.hud.showMap) this.hud.showMap = false;
      else this.app.togglePause();
      return true;
    }
    if (code === this.binds.score) {
      this.hud.showScore = down;
      return true;
    }
    if (code === this.binds.map) {
      if (down && !e.repeat) this.hud.showMap = !this.hud.showMap;
      return true;
    }
    const digit = DIGITS[code];
    if (digit && down && !e.repeat) {
      const me = this.snap && this.snap.P.find((p) => p.id === this.localId);
      if (me && me.chs) {
        this.pick(digit);
        return true;
      }
      // the sim picks the slot against its own current weapon; checking the (older) snapshot here dropped presses
      if (digit <= 2 && this.input.enabled) {
        this.input.acts.slot = digit;
        delete this.input.acts.swap;
      }
      return true;
    }
    return false;
  }

  // choose level-up card 1..3
  pick(i) {
    if (this.role === 'client') this.pendingActs.pick = i;
    else {
      const p = this.game.players.find((q) => q.id === this.localId);
      if (p) this.game.pickBoon(p, i - 1);
    }
    this.app.audio.play('perk');
  }

  setPaused(p) {
    // only solo games actually freeze the simulation
    this.paused = p && this.role === 'solo';
    this.input.enabled = !p;
  }

  // ---------------------------------------------------------------- network
  onNet(msg) {
    if (this.role === 'host' && msg.t === 'c' && msg.d && msg.d.t === 'in') {
      this.game.setInput(msg.from, msg.d);
    } else if (this.role === 'client' && msg.t === 'h' && msg.d && msg.d.t === 'snap') {
      const s = msg.d.s;
      this.prevSnap = this.snap;
      this.snapAt = performance.now();
      this.snap = s;
      if (s.E) this.clientEvents.push(...s.E);
      // structures + doors for local collision prediction
      this.sgrid.fill(0);
      for (const st of s.S) for (const [x, z] of st.c) this.sgrid[z * this.world.W + x] = st.id;
      for (const id of s.D) {
        const d = this.world.doors[id];
        if (d && !d.open) {
          d.open = true;
          for (let z = d.z; z < d.z + d.d; z++) for (let x = d.x; x < d.x + d.w; x++) this.world.grid[z * this.world.W + x] = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------- frame
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const r = this.renderer;
    const aim = r.groundPoint(this.input.mouse.x, this.input.mouse.y);
    let snap, events, view;
    if (this.role !== 'client') {
      const inp = this.input.sample(aim);
      this.game.setInput(this.localId, inp);
      // solo: the world pauses while you pick a level-up card
      const lp = this.role === 'solo' && this.game.players.find((q) => q.id === this.localId);
      const choosing = lp && lp.choices.length > 0 && lp.state !== 'dead';
      let n = 0;
      if (!this.paused && !choosing) {
        this.acc += dt;
        while (this.acc >= STEP && n < 4) {
          // the state just before the last step is where this frame's interpolation starts
          if (n > 0 && this.acc < STEP * 2) this.snap = this.game.snapshot();
          this.game.update(STEP);
          this.acc -= STEP;
          n++;
        }
        if (n === 4) this.acc = 0;
      }
      // the world is drawn between the last two sim steps (acc / STEP of the way), so motion is
      // smooth at any refresh rate; a snapshot is only built when the sim actually stepped
      if (n > 0) {
        this.prevSnap = this.snap;
        this.snap = this.game.snapshot();
      } else if (this.paused || choosing) {
        this.prevSnap = null;
        this.snap = this.game.snapshot();
      }
      snap = this.snap;
      events = this.game.drainEvents();
      if (this.role === 'host') {
        this.netEvents.push(...events);
        if (now - this.lastSnapSend >= SNAP_INTERVAL) {
          this.lastSnapSend = now;
          this.net.toClients({ t: 'snap', s: { ...snap, E: this.netEvents } });
          this.netEvents = [];
        }
      }
      view = { localId: this.localId, smooth: false, prev: this.prevSnap, alpha: this.acc / STEP };
    } else {
      snap = this.snap;
      if (!snap) return;
      events = this.clientEvents;
      this.clientEvents = [];
      const inp = this.input.sample(aim);
      mergeActs(this.pendingActs, inp.acts);
      const me = snap.P.find((p) => p.id === this.localId);
      if (me) {
        // show a weapon swap right away; the host's snapshot takes over once it agrees (or after 0.6 s)
        if (inp.acts.swap || inp.acts.slot) {
          const cw = swapTarget(this.cwPred ? this.cwPred.cw : me.cw, inp.acts);
          if (me.w[cw]) {
            this.cwPred = { cw, until: now + 600 };
            this.localFireCd = Math.max(this.localFireCd, 0.35);
          }
        }
        if (this.cwPred) {
          // a snapshot is reused until the next one arrives, so keep the host's own value to compare against
          if (me.hcw === undefined) me.hcw = me.cw;
          if (me.hcw === this.cwPred.cw || now > this.cwPred.until) this.cwPred = null;
          else me.cw = this.cwPred.cw;
        }
        if (!this.pred || this.pred.tp !== me.tp || Math.hypot(this.pred.x - me.x, this.pred.z - me.z) > 6) {
          this.pred = { x: me.x, z: me.z, tp: me.tp, perks: {}, char: me.c, moving: false };
        }
        this.pred.perks = Object.fromEntries(me.pk.map((k) => [k, true]));
        if (me.s === 0) {
          const w = me.w[me.cw] || me.w[0];
          this.predictFire(inp, me, w, dt, now);
          stepMovement(this.world, this.sgrid, this.pred, inp, dt, playerSpeed(this.pred, w ? w[0] : 'pistol'));
        } else {
          this.pred.x = me.x;
          this.pred.z = me.z;
          this.pred.moving = false;
        }
        if (now - this.lastInputSend >= INPUT_INTERVAL) {
          this.lastInputSend = now;
          const sent = this.net.toHost({
            t: 'in', mx: inp.mx, mz: inp.mz, ax: inp.ax, az: inp.az, fire: inp.fire, use: inp.use,
            acts: this.pendingActs, px: this.pred.x, pz: this.pred.z, tp: this.pred.tp, moving: this.pred.moving,
          });
          if (sent) this.pendingActs = {};
        }
        view = {
          localId: this.localId, smooth: true, localPos: this.pred, localMoving: this.pred.moving,
          localAng: aim ? Math.atan2(aim.z - this.pred.z, aim.x - this.pred.x) : me.a,
        };
      } else {
        view = { localId: this.localId, smooth: true };
      }
      // projectiles and hazards glide between the host's snapshots instead of jumping 20x a second
      view.prev = this.prevSnap;
      view.alpha = (now - this.snapAt) / SNAP_INTERVAL;
    }
    this.snap = snap;
    const me = snap.P.find((p) => p.id === this.localId);
    const pos = view.localPos || me;
    if (pos) {
      this.app.audio.listener.x = pos.x;
      this.app.audio.listener.z = pos.z;
    }
    r.update(snap, events, dt, view);
    this.hud.handleEvents(events, this.localId);
    this.hud.update(snap, me ? (view.localPos ? { ...me, x: view.localPos.x, z: view.localPos.z } : me) : null, dt, this.input.mouse);
    this.playSounds(events, snap, dt);
    this.app.audio.setIntensity(snap.BS.some((b) => b[3]) ? 2 : snap.BS.length || (snap.ws === 1 && snap.Z.length > 4) ? 1 : 0);
    this.stats.maxWave = Math.max(this.stats.maxWave, snap.wave);
    if (snap.res && !this.ended) {
      this.ended = true;
      setTimeout(() => this.app.onGameEnd(this, snap), 3000);
    }
  }

  // Joined players hear their own shots immediately instead of a network round trip
  // later. Mirrors the host's fire-rate rule; the host's echo of the shot is muted.
  predictFire(inp, me, w, dt, now) {
    this.localFireCd -= dt;
    if (!inp.fire || !w || w[2] <= 0 || me.rl >= 0 || this.localFireCd > 0) return;
    const def = WEAPONS[w[0]];
    let rate = def.rate;
    if (me.pk.includes('rapid')) rate *= 1.33;
    if (me.bo && me.bo.trigger) rate *= 1 + 0.08 * me.bo.trigger;
    this.localFireCd = 1 / rate;
    this.localFireT = now;
    this.app.audio.play(def.sound, this.pred.x, this.pred.z, 0.8);
  }

  playSounds(events, snap, dt) {
    const a = this.app.audio;
    for (const e of events) {
      switch (e.k) {
        case 'fire': {
          // already played locally (see predictFire), unless we haven't predicted a shot lately
          if (this.role === 'client' && e.p === this.localId && performance.now() - this.localFireT < 600) break;
          const w = WEAPONS[WIDS[e.w]];
          a.play(w.sound, e.x, e.z, e.p === this.localId ? 0.8 : 0.5);
          break;
        }
        case 'boom':
          a.play('boom', e.x, e.z);
          break;
        case 'spawn':
          a.play(e.big ? 'roar' : 'spawn', e.x, e.z, e.big ? 1 : 0.5);
          break;
        case 'die':
          a.play('die', e.x, e.z, 0.6);
          break;
        case 'h':
          a.play('hit', e.x, e.z, 0.4);
          break;
        case 'zap':
          a.play('zap', e.pts[0], e.pts[1]);
          break;
        case 'heal':
          a.play('heal', e.x, e.z);
          break;
        case 'strike':
          a.play('strike', e.x, e.z);
          break;
        case 'slam':
          a.play('slam', e.x, e.z);
          break;
        case 'blink':
          a.play('blink', e.x, e.z);
          break;
        case 'melee':
          a.play('melee', e.x, e.z);
          break;
        case 'hitwall':
          a.play('hit', e.x, e.z, 0.6);
          break;
        case 'door':
          a.play('door', e.x, e.z);
          break;
        case 'power':
          a.play('power');
          break;
        case 'nuke':
          a.play('boom');
          break;
        case 'wave':
          a.play('wave');
          break;
        case 'waveEnd':
          a.play('waveEnd');
          break;
        case 'levelup':
          if (e.p === this.localId) a.play('levelup');
          break;
        case 'loot':
          a.play(e.r >= 3 ? 'rare' : 'open', e.x, e.z);
          break;
        case 'stepdone':
          a.play('done');
          break;
        case 'soul':
          a.play('pickup', e.x2, e.z2, 0.5);
          break;
        case 'hurt':
          if (e.p === this.localId) a.play('hurt');
          break;
        case 'sfx':
          if (e.s === 'nope' || e.s === 'empty') {
            if (e.p === this.localId) a.play(e.s);
          } else if (e.s === 'box' || e.s === 'boxmove' || e.s === 'perk') a.play(e.s, e.x || undefined, e.z || undefined);
          else a.play(e.s, e.x, e.z, e.p === this.localId ? 1 : 0.7);
          break;
      }
    }
    this.groanT -= dt;
    if (this.groanT <= 0 && snap.Z.length) {
      this.groanT = 1 + Math.random() * 2.5;
      const z = snap.Z[Math.floor(Math.random() * snap.Z.length)];
      a.play('groan', z[2], z[3], 0.8);
    }
  }
}
