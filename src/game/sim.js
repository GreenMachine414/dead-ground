// Authoritative game simulation. Runs on the host (or in solo play) and produces
// snapshots that the renderer / remote clients consume. No DOM or three.js here.
import { WEAPONS, weaponStats, weaponsForMap, FORGE, FORGE2, FORGE_DMG, FORGE_BOSS, RARITY, rollRarity } from '../data/weapons.js';
import { ZOMBIES, POWERUPS, PERKS } from '../data/zombies.js';
import { CHARACTERS } from '../data/characters.js';
import { MAPS, getMap } from '../data/maps.js';
import { BOONS, BOON_IDS, xpForLevel } from '../data/boons.js';
import { CONTAINERS, RESTOCK_CHANCE } from '../data/loot.js';
import { createWorld } from './mapgen.js';
import { FlowField } from './flowfield.js';
import { mulberry32 } from './rng.js';
import { moveCircle, circleBlocked, rayGrid, hasLOS, rayCircle, wallCells, clearPath } from './physics.js';

export { MAPS, getMap, createWorld };
export const ZTYPES = Object.keys(ZOMBIES);
export const WIDS = Object.keys(WEAPONS);
export const PLAYER_R = 0.4;
export const BASE_SPEED = 5.4;
// regular zombies never outrun a walking player, however late the round (screamer buffs aside)
const ZOMBIE_SPEED_CAP = BASE_SPEED * 0.9;
// weapon stats with a player's reserve-ammo bonus: stats object -> (multiplier -> stats)
const WSTAT_CACHE = new WeakMap();
const STATE_CODE = { alive: 0, down: 1, dead: 2 };
const BLEED_TIME = 45; // seconds a downed player can wait for a revive
// upgrade machine: price of the nth purchase (per player) is SHOP_COST + n * SHOP_STEP
const SHOP_COST = 1500, SHOP_STEP = 1000;
const NO_ARMOR = new Set(['explosive', 'gunblast', 'ability', 'chain']);
// damage kinds that count as kills with the gun in hand (for the second forge level)
const GUN_KILLS = new Set(['bullet', 'fire', 'burn', 'chain', 'gunblast']);
// ability stats scaled by the Overcharge upgrade
const OVERCHARGE_STATS = ['wallHp', 'spikes', 'damage', 'hp', 'duration', 'heal', 'zoneHeal', 'zoneDamage', 'restock', 'life'];
const ZSTATE = { rise: 0, move: 1, attack: 2, windup: 3, charge: 4, leap: 5, stun: 6, drain: 2 };
const BOX_COST = 950;
const MAX_GRENADES = 4;
const BOSS_CD = {
  charge: 7, slam: 4, throw: 5, volley: 5.5, summon: 15, teleport: 7, shockwave: 9, leap: 6,
  sweep: 3.5, hook: 7, bile: 8, devour: 14, barrage: 9, rally: 12, eggs: 11, mirror: 13, drain: 10,
};
const BOSS_WINDUP = { slam: 0.8, charge: 0.9, summon: 1.0, sweep: 0.75, hook: 0.55, bile: 0.7, devour: 1.0, barrage: 0.9, rally: 0.6, eggs: 0.8, mirror: 0.5, drain: 0.4 };

const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// Shared with clients for local movement prediction.
export function playerSpeed(p, weaponId) {
  const w = WEAPONS[weaponId];
  let s = BASE_SPEED * (w && w.moveMult ? w.moveMult : 1);
  if (p.perks && p.perks.swift) s *= 1.15;
  if (p.char === 'volt') s *= 1.08;
  if (p.boons && p.boons.haste) s *= 1 + 0.06 * p.boons.haste;
  return s;
}

export function stepMovement(world, sgrid, p, input, dt, speed) {
  let mx = input.mx || 0, mz = input.mz || 0;
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  let sp = speed;
  const wantsSprint = input.sprint && l > 0.1 && p.stamina > 0.05;
  if (wantsSprint) {
    sp *= 1.45;
    p.stamina = Math.max(0, p.stamina - dt * (p.perks && p.perks.swift ? 0.16 : 0.25));
  } else {
    p.stamina = Math.min(1, p.stamina + dt * 0.2);
  }
  p.sprinting = wantsSprint;
  moveCircle(world, sgrid, p, mx * sp * dt, mz * sp * dt, PLAYER_R);
  p.moving = l > 0.1;
}

export class Game {
  constructor({ mapId, mode = 'story', seed = 1, players, unlockedMap = mapId }) {
    this.map = getMap(mapId);
    this.mode = mode;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.world = createWorld(this.map);
    const { W, H } = this.world;
    this.sgrid = new Int32Array(W * H);
    this.field = new FlowField(this.world);
    this.fieldT = 0;
    this.time = 0;
    this.nextId = 1;
    this.players = [];
    this.zombies = [];
    this.projs = [];
    this.structs = [];
    this.pickups = [];
    this.hazards = [];
    this.strikes = [];
    this.events = [];
    this.diff = this.map.difficulty;
    this.weaponPool = weaponsForMap(mode === 'endless' ? Math.max(unlockedMap, mapId) : mapId).filter((w) => w !== 'pistol');
    this.wave = 0;
    this.waveState = 'break';
    this.waveT = 8;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.spawnInterval = 2;
    this.maxAlive = 24;
    this.powerupsThisWave = 0;
    this.instakill = 0;
    this.double = 0;
    this.result = null;
    this.stepsDone = 0;
    this.totalKills = 0;
    this.box = { spot: 0, state: 'idle', t: 0, user: -1, wid: '', rarity: 0, uses: 0, movesAt: 4 + Math.floor(this.rng() * 5) };
    if (this.world.spots.box.length) this.box.spot = Math.floor(this.rng() * this.world.spots.box.length);
    players.forEach((pp, i) => this.addPlayer(pp, i));
    this.containers = this.world.spots.loot.map((s, i) => ({ id: i, x: s.x, z: s.z, kind: s.kind, full: true, prog: 0 }));
    this.story = mode === 'story' ? this.map.story : null;
    this.stepIdx = -1;
    this.step = null;
    this.ss = null;
    if (this.story) this.startStep(0);
    this.emit({ k: 'msg', s: mode === 'story' ? this.map.name : this.map.name + ' — Endless', sub: mode === 'story' ? this.story.steps[0].text : 'Survive as long as you can.' });
  }

  get n() {
    return Math.max(1, this.players.length);
  }

  emit(e) {
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------ players
  addPlayer(pp, i = this.players.length) {
    const sp = this.world.spots.playerSpawn[i % this.world.spots.playerSpawn.length];
    const level = Math.max(1, Math.min(5, pp.level || 1));
    const ch = CHARACTERS[pp.char] || CHARACTERS.brick;
    const st = ch.stats(level);
    const p = {
      id: pp.id,
      name: pp.name || 'Player',
      char: CHARACTERS[pp.char] ? pp.char : 'brick',
      lvl: level,
      x: sp.x,
      z: sp.z,
      ang: -Math.PI / 2,
      r: PLAYER_R,
      baseMaxHp: pp.char === 'brick' ? 125 : 100,
      hp: 0,
      maxHp: 0,
      state: 'alive',
      bleed: 0,
      revive: 0,
      weapons: [this.makeWeapon('pistol'), null],
      cur: 0,
      reloadT: 0,
      fireCd: 0,
      meleeCd: 0,
      abilityCd: 0,
      shield: 0,
      shopBuys: 0,
      charges: st.charges || 1,
      maxCharges: st.charges || 1,
      grenades: 2,
      perks: {},
      points: 500,
      earned: 0,
      kills: 0,
      downs: 0,
      revives: 0,
      stamina: 1,
      sprinting: false,
      moving: false,
      lastHurt: -10,
      invuln: 0,
      tp: 1,
      prompt: '',
      promptProg: -1,
      input: { mx: 0, mz: 0, ax: sp.x, az: sp.z - 5, fire: false, sprint: false, use: false },
      acts: {},
      interact: null,
      emptyT: 0,
      xp: 0,
      rank: 1,
      boons: {},
      choices: [],
    };
    p.maxHp = p.baseMaxHp;
    p.hp = p.maxHp;
    this.players.push(p);
    return p;
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i >= 0) {
      const p = this.players[i];
      this.players.splice(i, 1);
      for (const s of [...this.structs]) if (s.owner === id) this.destroyStruct(s, false);
      this.emit({ k: 'msg', s: p.name + ' left the game' });
    }
  }

  makeWeapon(id, forged = 0, rarity = 0) {
    forged = +forged || 0; // forge level 0 / 1 / 2 (booleans accepted); indexes the forge tables
    const st = weaponStats(id, forged, rarity);
    return { id, forged, rarity, mag: st.mag, reserve: st.reserve, forging: 0 };
  }

  // weapon stats for a specific player (rarity + forge + level-up bonuses)
  // (called every frame, so reserve-boosted variants are cached per stats object and multiplier)
  wstat(p, w) {
    const st = weaponStats(w.id, w.forged, w.rarity || 0);
    const mult = (1 + 0.25 * (p.boons.bandolier || 0)) * (p.char === 'mags' ? 1.25 : 1);
    if (mult === 1) return st;
    let byMult = WSTAT_CACHE.get(st);
    if (!byMult) WSTAT_CACHE.set(st, (byMult = new Map()));
    let out = byMult.get(mult);
    if (!out) byMult.set(mult, (out = { ...st, reserve: Math.round(st.reserve * mult) }));
    return out;
  }

  maxGrenades(p) {
    return MAX_GRENADES + (p.boons.grenadier || 0);
  }

  setInput(pid, input) {
    const p = this.players.find((q) => q.id === pid);
    if (!p) return;
    const acts = input.acts || {};
    for (const k in acts) if (acts[k]) p.acts[k] = acts[k];
    p.input = input;
  }

  // ------------------------------------------------------------ XP / level ups
  gainXp(p, amount) {
    if (!p) return;
    p.xp += amount;
    while (p.xp >= xpForLevel(p.rank)) {
      p.xp -= xpForLevel(p.rank);
      p.rank++;
      this.emit({ k: 'levelup', p: p.id, r: p.rank, x: p.x, z: p.z });
    }
  }

  rollChoices(p) {
    const avail = BOON_IDS.filter((id) => (p.boons[id] || 0) < BOONS[id].max);
    this.rng.shuffle(avail);
    return avail.slice(0, 3);
  }

  pickBoon(p, index) {
    const set = p.choices[0];
    if (!set) return;
    const id = set[index];
    if (!id) return;
    p.choices.shift();
    p.boons[id] = (p.boons[id] || 0) + 1;
    if (id === 'vigor') {
      p.baseMaxHp += 20;
      p.maxHp += 20;
      p.hp += 20;
    }
    if (id === 'grenadier') p.grenades++;
    this.emit({ k: 'boon', p: p.id, b: id, x: p.x, z: p.z });
  }

  // ------------------------------------------------------------ main loop
  update(dt) {
    if (this.result) return;
    this.time += dt;
    if (this.instakill > 0) this.instakill -= dt;
    if (this.double > 0) this.double -= dt;
    for (const p of this.players) this.updatePlayer(p, dt);
    this.fieldT -= dt;
    if (this.fieldT <= 0) {
      this.fieldT = 0.25;
      const src = this.players.filter((p) => p.state === 'alive');
      if (src.length) this.field.compute(src, this.sgrid);
    }
    this.updateWaves(dt);
    this.updateZombies(dt);
    this.updateProjectiles(dt);
    this.updateStructs(dt);
    this.updateHazards(dt);
    this.updateStrikes(dt);
    this.updatePickups(dt);
    this.updateBox(dt);
    if (this.story) this.updateStory(dt);
    if (this.players.length && !this.players.some((p) => p.state === 'alive' || p.selfRevive)) {
      this.result = 'lose';
      this.emit({ k: 'end', r: 'lose' });
    }
  }

  // ------------------------------------------------------------ player update
  updatePlayer(p, dt) {
    const input = p.input;
    const acts = p.acts;
    p.acts = {};
    if (acts.pick) this.pickBoon(p, acts.pick - 1);
    if (p.state === 'dead') return;
    if (p.state === 'down') {
      p.bleed -= dt;
      if (p.selfRevive) {
        if (p.bleed <= 0) {
          p.selfRevive = false;
          this.revivePlayer(p, null);
          p.invuln = 3;
          this.explode(p.x, p.z, 4, 400, { pid: p.id });
        }
        return;
      }
      if (p.bleed <= 0) {
        p.state = 'dead';
        this.emit({ k: 'msg', s: p.name + ' bled out', sub: 'They will respawn next round' });
      }
      return;
    }
    if (input.px !== undefined) {
      // after a server-side move (respawn, hook) ignore positions predicted before the client saw it
      if (Number.isFinite(input.px) && Number.isFinite(input.pz) && (input.tp === undefined || input.tp === p.tp)) {
        p.x = Math.max(1, Math.min(this.world.W - 1, input.px));
        p.z = Math.max(1, Math.min(this.world.H - 1, input.pz));
      }
      p.moving = !!input.moving;
      p.sprinting = !!input.sprinting;
      if (input.stamina !== undefined) p.stamina = input.stamina;
    } else {
      stepMovement(this.world, this.sgrid, p, input, dt, playerSpeed(p, this.curWeapon(p).id));
    }
    if (Number.isFinite(input.ax) && Number.isFinite(input.az)) p.ang = Math.atan2(input.az - p.z, input.ax - p.x);

    p.fireCd -= dt;
    p.meleeCd -= dt;
    p.emptyT -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    this.updateAbilityCooldown(p, dt);
    const mend = p.boons.mend || 0;
    if (this.time - p.lastHurt > 3.5 - mend * 1.2 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 30 * (1 + 0.5 * mend) * dt);
    const shieldMax = 25 * (p.boons.aegis || 0);
    if (p.shield < shieldMax && this.time - p.lastHurt > 5) p.shield = Math.min(shieldMax, p.shield + 20 * dt);
    for (const w of p.weapons) if (w && w.forging > 0) {
      w.forging -= dt;
      if (w.forging <= 0) {
        w.forging = 0;
        w.forged = (w.forged || 0) + 1;
        w.fkills = 0;
        const st = this.wstat(p, w);
        w.mag = st.mag;
        w.reserve = st.reserve;
        this.emit({ k: 'sfx', s: 'forge', x: p.x, z: p.z });
      }
    }

    const w = this.curWeapon(p);
    const ws = this.wstat(p, w);
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const need = ws.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
    }
    if (acts.swap && p.weapons[1]) {
      p.cur = 1 - p.cur;
      p.reloadT = 0;
      p.fireCd = 0.35;
      this.emit({ k: 'sfx', s: 'swap', x: p.x, z: p.z, p: p.id });
    }
    if (acts.reload) this.startReload(p);
    if (acts.melee) this.doMelee(p);
    if (acts.grenade) this.throwGrenade(p);
    if (acts.ability) this.useAbility(p);

    this.updateInteract(p, acts.usePress, input.use, dt);

    const cw = this.curWeapon(p);
    if (input.fire && p.fireCd <= 0 && p.reloadT <= 0 && !cw.forging) {
      if (cw.mag > 0) {
        this.fireWeapon(p, cw);
      } else if (cw.reserve > 0) {
        this.startReload(p);
      } else if (p.emptyT <= 0) {
        p.emptyT = 0.4;
        this.emit({ k: 'sfx', s: 'empty', x: p.x, z: p.z, p: p.id });
      }
    }
  }

  curWeapon(p) {
    return p.weapons[p.cur] || p.weapons[0];
  }

  startReload(p) {
    const w = this.curWeapon(p);
    const ws = this.wstat(p, w);
    if (p.reloadT > 0 || w.mag >= ws.mag || w.reserve <= 0 || w.forging) return;
    let t = ws.reload;
    if (p.perks.quick) t *= 0.5;
    if (p.char === 'sparks') t *= 0.85;
    if (p.boons.hands) t /= 1 + 0.12 * p.boons.hands;
    p.reloadT = t;
    p.reloadMax = t;
    this.emit({ k: 'sfx', s: 'reload', x: p.x, z: p.z, p: p.id });
  }

  // ------------------------------------------------------------ weapons
  damageMult(p) {
    return (p.char === 'rook' ? 1.1 : 1) * (1 + 0.1 * (p.boons.power || 0));
  }

  fireWeapon(p, w) {
    const ws = this.wstat(p, w);
    let rate = ws.rate;
    if (p.perks.rapid) rate *= 1.33;
    if (p.boons.trigger) rate *= 1 + 0.08 * p.boons.trigger;
    p.fireCd = 1 / rate;
    w.mag -= 1;
    const dmg = ws.damage * this.damageMult(p);
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    const ox = p.x + ca * 0.6, oz = p.z + sa * 0.6;
    const wi = WIDS.indexOf(w.id);
    this.emit({ k: 'fire', p: p.id, w: wi, x: ox, z: oz, a: p.ang, f: w.forged || 0 });
    if (ws.type === 'hitscan' || ws.type === 'pellets') {
      const count = ws.pellets || 1;
      const spreadMult = p.moving ? 1.3 : 1;
      for (let i = 0; i < count; i++) {
        const a = p.ang + (this.rng() - 0.5) * 2 * ws.spread * spreadMult;
        const dx = Math.cos(a), dz = Math.sin(a);
        const end = this.hitscan(p.id, ox, oz, dx, dz, ws.range, dmg, ws.pierce || 1, 'bullet');
        this.emit({ k: 't', x: ox, z: oz, x2: ox + dx * end, z2: oz + dz * end, w: wi, f: w.forged || 0 });
      }
    } else if (ws.type === 'projectile' && ws.lob) {
      // arc the shell onto the cursor (clamped to range); it bursts where it lands
      const tx = p.input.ax, tz = p.input.az;
      let dx = tx - ox, dz = tz - oz;
      const d = Math.hypot(dx, dz) || 1, dd = Math.max(2, Math.min(ws.range, d));
      dx = (dx / d) * dd;
      dz = (dz / d) * dd;
      const T = 0.35 + dd * 0.025, g = 24;
      this.projs.push({
        id: this.nextId++, kind: ws.proj, owner: 'p', pid: p.id, x: ox, y: 1.1, z: oz,
        vx: dx / T, vz: dz / T, vy: (0.5 * g * T * T - 1.1) / T, g, land: true,
        dmg, splash: ws.splash, life: T + 0.3, r: 0.25, forged: w.forged,
      });
    } else if (ws.type === 'projectile') {
      const a = p.ang + (this.rng() - 0.5) * 2 * ws.spread;
      this.projs.push({
        id: this.nextId++, kind: ws.proj, owner: 'p', pid: p.id, x: ox, y: 1.1, z: oz,
        vx: Math.cos(a) * ws.projSpeed, vy: 0, vz: Math.sin(a) * ws.projSpeed, g: 0,
        dmg, splash: ws.splash, life: ws.range / ws.projSpeed, r: 0.25, forged: w.forged, pierce: ws.pierce || 1,
      });
    } else if (ws.type === 'flame') {
      const range = ws.range;
      for (const z of this.zombies) {
        if (z.state === 'rise' && z.t > 0.8) continue;
        const d = Math.hypot(z.x - p.x, z.z - p.z);
        if (d > range + z.r) continue;
        const za = Math.atan2(z.z - p.z, z.x - p.x);
        if (Math.abs(angDiff(za, p.ang)) > ws.spread + 0.15) continue;
        if (!hasLOS(this.world, p.x, p.z, z.x, z.z)) continue;
        this.damageZombie(z, dmg, p.id, 'fire');
        z.burn = 3;
        z.burnDps = ws.burn * FORGE_DMG[w.forged];
        z.burnBy = p.id;
      }
    } else if (ws.type === 'chain') {
      this.chainLightning(p.id, ox, oz, p.ang, dmg, ws.chain, 0.5, ws.range, 'chain', w.forged);
    }
  }

  // Returns distance travelled by the bullet (for tracer length).
  hitscan(pid, ox, oz, dx, dz, range, dmg, pierce, kind) {
    const wallT = rayGrid(this.world, ox, oz, dx, dz, range);
    const hits = [];
    for (const z of this.zombies) {
      if (z.state === 'rise' && z.t > 0.9) continue;
      const t = rayCircle(ox, oz, dx, dz, z.x, z.z, z.r + 0.08);
      if (t >= 0 && t <= wallT) hits.push([t, z]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    let end = wallT;
    let d = dmg;
    for (let i = 0; i < hits.length && i < pierce; i++) {
      const [t, z] = hits[i];
      this.damageZombie(z, d, pid, kind);
      this.emit({ k: 'h', x: ox + dx * t, z: oz + dz * t });
      d *= 0.8;
      end = t;
    }
    if (hits.length < pierce) end = wallT;
    return end;
  }

  chainLightning(pid, ox, oz, ang, dmg, chains, stun, range, kind = 'ability', forged = 0) {
    let best = null, bestD = Infinity;
    for (const z of this.zombies) {
      if (z.state === 'rise' && z.t > 0.8) continue;
      const d = Math.hypot(z.x - ox, z.z - oz);
      if (d > range) continue;
      const za = Math.atan2(z.z - oz, z.x - ox);
      if (Math.abs(angDiff(za, ang)) > 0.7) continue;
      const score = d + Math.abs(angDiff(za, ang)) * 6;
      if (score < bestD && hasLOS(this.world, ox, oz, z.x, z.z)) {
        bestD = score;
        best = z;
      }
    }
    const pts = [ox, oz];
    if (!best) {
      pts.push(ox + Math.cos(ang) * 6, oz + Math.sin(ang) * 6);
      this.emit({ k: 'zap', pts, f: forged });
      return;
    }
    const hit = new Set();
    let cur = best;
    let d = dmg;
    for (let i = 0; i < chains && cur; i++) {
      hit.add(cur.id);
      pts.push(cur.x, cur.z);
      cur.stun = Math.max(cur.stun || 0, stun);
      const cx = cur.x, cz = cur.z;
      this.damageZombie(cur, d, pid, kind);
      d *= 0.85;
      let next = null, nd = 8 * 8;
      for (const z of this.zombies) {
        if (hit.has(z.id) || (z.state === 'rise' && z.t > 0.8)) continue;
        const dd = dist2(z.x, z.z, cx, cz);
        if (dd < nd && hasLOS(this.world, cx, cz, z.x, z.z)) {
          nd = dd;
          next = z;
        }
      }
      cur = next;
    }
    this.emit({ k: 'zap', pts, f: forged });
  }

  explode(x, z, radius, dmg, src) {
    // src: {pid} for player explosions, {enemy:true} for zombie explosions
    this.emit({ k: 'boom', x, z, r: radius });
    if (src.enemy) {
      for (const p of this.players) {
        if (p.state !== 'alive') continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < radius + p.r) this.hurtPlayer(p, dmg * (1 - (0.5 * d) / (radius + p.r)));
      }
      for (const s of [...this.structs]) {
        if (Math.hypot(s.x - x, s.z - z) < radius + 1) this.damageStruct(s, dmg * 2);
      }
    } else {
      for (const zb of [...this.zombies]) {
        const d = Math.hypot(zb.x - x, zb.z - z);
        if (d < radius + zb.r) this.damageZombie(zb, dmg * (1 - (0.5 * d) / (radius + zb.r)), src.pid, src.kind || 'explosive');
      }
    }
  }

  damageZombie(z, amount, pid, kind) {
    if (z.dead) return;
    let dmg = amount;
    const p = pid != null ? this.players.find((q) => q.id === pid) : null;
    let crit = false;
    if (p && p.boons.crit && (kind === 'bullet' || kind === 'melee') && this.rng() < 0.08 * p.boons.crit) {
      dmg *= 2;
      crit = true;
    }
    if (z.def.armor && !NO_ARMOR.has(kind)) dmg *= 1 - z.def.armor;
    if (z.rally > 0) dmg *= 0.6;
    if ((z.boss || z.mini) && p && GUN_KILLS.has(kind)) dmg *= FORGE_BOSS[this.curWeapon(p).forged];
    if (this.instakill > 0 && !z.boss && !z.mini) dmg = Math.max(dmg, z.hp + 1);
    z.hp -= dmg;
    z.hurtT = 0.12;
    if (kind !== 'fire' && kind !== 'burn' && kind !== 'spikes' && kind !== 'zone') this.emit({ k: 'dmg', x: z.x, z: z.z, d: Math.round(dmg), c: crit ? 1 : 0 });
    if (p && (kind === 'bullet' || kind === 'melee')) this.givePoints(p, 10);
    if (z.hp <= 0) this.killZombie(z, p, kind);
  }

  givePoints(p, n) {
    let amt = this.double > 0 ? n * 2 : n;
    if (p.boons.greed) amt = Math.round(amt * (1 + 0.15 * p.boons.greed));
    p.points += amt;
    p.earned += amt;
    this.emit({ k: 'pts', p: p.id, n: amt });
  }

  killZombie(z, p, kind) {
    if (z.dead) return;
    z.dead = true;
    this.zombies.splice(this.zombies.indexOf(z), 1);
    this.totalKills++;
    if (p) {
      p.kills++;
      const cw = this.curWeapon(p);
      if (cw.forged === 1 && !cw.forging && GUN_KILLS.has(kind)) cw.fkills = (cw.fkills || 0) + 1;
      this.givePoints(p, kind === 'melee' ? 130 : z.def.points);
      if (p.boons.vamp && p.state === 'alive') p.hp = Math.min(p.maxHp, p.hp + 3 * p.boons.vamp);
    }
    this.emit({ k: 'die', id: z.id, x: z.x, z: z.z, ty: ZTYPES.indexOf(z.type), a: z.ang });
    if (kind === 'devour') return;
    // XP: killer gets full, teammates a share (bosses: everyone gets full)
    const xp = Math.round(z.def.points / 5);
    for (const q of this.players) {
      if (q === p || z.boss || z.mini) this.gainXp(q, xp);
      else this.gainXp(q, Math.round(xp * 0.25));
    }
    if (z.def.explode) this.explode(z.x, z.z, z.def.explode.radius, z.def.explode.damage * this.diff.damage, { enemy: true });
    if (z.boss || z.mini) {
      this.lastBossPos = { x: z.x, z: z.z };
      for (const q of this.players) if (q !== p) this.givePoints(q, z.boss ? 1000 : 400);
      this.spawnPowerup(z.x + 1, z.z, 'maxammo');
      this.emit({ k: 'msg', s: z.def.name + ' defeated!' });
    } else if (this.powerupsThisWave < 4 && this.rng() < 0.03) {
      this.powerupsThisWave++;
      const kinds = Object.keys(POWERUPS);
      this.spawnPowerup(z.x, z.z, kinds[Math.floor(this.rng() * kinds.length)]);
    }
  }

  // ------------------------------------------------------------ melee & grenades
  doMelee(p) {
    if (p.meleeCd > 0) return;
    p.meleeCd = 0.55;
    this.emit({ k: 'melee', p: p.id, x: p.x, z: p.z, a: p.ang });
    let hits = 0;
    const sorted = this.zombies
      .map((z) => [Math.hypot(z.x - p.x, z.z - p.z), z])
      .filter(([d, z]) => d < 1.9 + z.r && Math.abs(angDiff(Math.atan2(z.z - p.z, z.x - p.x), p.ang)) < 1.0)
      .sort((a, b) => a[0] - b[0]);
    for (const [, z] of sorted) {
      if (hits >= 2) break;
      hits++;
      const zx = z.x, zz = z.z;
      this.damageZombie(z, 150 * this.damageMult(p) * (1 + 0.05 * (this.wave - 1)), p.id, 'melee');
      this.emit({ k: 'h', x: zx, z: zz });
    }
  }

  throwGrenade(p) {
    if (p.grenades <= 0) return;
    p.grenades--;
    const tx = p.input.ax, tz = p.input.az;
    let dx = tx - p.x, dz = tz - p.z;
    let d = Math.hypot(dx, dz) || 1;
    const dd = Math.max(3, Math.min(15, d));
    dx = (dx / d) * dd;
    dz = (dz / d) * dd;
    const T = 0.55 + dd * 0.035, g = 22;
    this.projs.push({
      id: this.nextId++, kind: 'frag', owner: 'p', pid: p.id, x: p.x, y: 1.2, z: p.z,
      vx: dx / T, vz: dz / T, vy: (0.5 * g * T * T - 1.2) / T, g,
      dmg: (200 + 50 * this.wave) * (1 + 0.25 * (p.boons.grenadier || 0)), splash: 4, life: 1.7, fuse: true, r: 0.2,
    });
    this.emit({ k: 'sfx', s: 'throw', x: p.x, z: p.z });
  }

  // ------------------------------------------------------------ abilities
  updateAbilityCooldown(p, dt) {
    if (p.abilityCd > 0) {
      p.abilityCd -= dt;
      if (p.abilityCd <= 0) {
        p.abilityCd = 0;
        if (p.char === 'brick' && p.charges < p.maxCharges) {
          p.charges++;
          if (p.charges < p.maxCharges) p.abilityCd = p.abilityMax;
        }
      }
    }
  }

  useAbility(p) {
    const ch = CHARACTERS[p.char];
    const st = { ...ch.stats(p.lvl) };
    if (p.boons.focus) st.cooldown *= 1 - 0.08 * p.boons.focus;
    if (p.boons.overcharge) for (const k of OVERCHARGE_STATS) if (st[k]) st[k] *= 1 + 0.15 * p.boons.overcharge;
    const scale = 1 + 0.1 * Math.max(0, this.wave - 1);
    const ax = p.input.ax, az = p.input.az;
    if (p.char === 'brick') {
      if (p.charges <= 0) return this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
      if (this.placeWall(p, st)) {
        p.charges--;
        if (p.abilityCd <= 0) {
          p.abilityCd = st.cooldown;
          p.abilityMax = st.cooldown;
        }
      }
      return;
    }
    if (p.abilityCd > 0) return this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
    let ok = true;
    if (p.char === 'sparks') ok = this.placeTurret(p, st, scale);
    else if (p.char === 'doc') this.healField(p, st);
    else if (p.char === 'mags') this.supplyDrop(p, st, ax, az);
    else if (p.char === 'rook') this.airstrike(p, st, scale, ax, az);
    else if (p.char === 'volt') {
      this.chainLightning(p.id, p.x, p.z, p.ang, st.damage * scale, st.chains, st.stun, 16);
      if (st.double) this.chainLightning(p.id, p.x, p.z, p.ang + 0.35, st.damage * scale, st.chains, st.stun, 16);
      this.emit({ k: 'sfx', s: 'zap', x: p.x, z: p.z });
    }
    if (ok) {
      p.abilityCd = st.cooldown;
      p.abilityMax = st.cooldown;
    }
  }

  cellFreeForStruct(cx, cz) {
    const { W, H, grid } = this.world;
    if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= H - 1) return false;
    const i = cz * W + cx;
    if (grid[i] !== 0 || this.sgrid[i] !== 0) return false;
    const x = cx + 0.5, z = cz + 0.5;
    for (const p of this.players) if (p.state !== 'dead' && Math.abs(p.x - x) < 0.5 + p.r && Math.abs(p.z - z) < 0.5 + p.r) return false;
    for (const zb of this.zombies) if (Math.abs(zb.x - x) < 0.5 + zb.r && Math.abs(zb.z - z) < 0.5 + zb.r) return false;
    return true;
  }

  placeWall(p, st) {
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    const cx = p.x + ca * 2.2, cz = p.z + sa * 2.2;
    const horizontal = Math.abs(sa) > Math.abs(ca);
    const cells = wallCells(cx, cz, horizontal, st.length).filter(([x, z]) => this.cellFreeForStruct(x, z));
    if (cells.length < 2) {
      this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
      return false;
    }
    // never let a wall seal anyone into a pocket: each player must keep at least half
    // of the area they could walk to before the wall went up
    const extra = new Set(cells.map(([x, z]) => z * this.world.W + x));
    for (const q of this.players) {
      if (q.state === 'dead') continue;
      const before = this.reachableCells(q.x, q.z);
      if (this.reachableCells(q.x, q.z, extra) < (before - cells.length) * 0.5) {
        this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
        this.emit({ k: 'note', p: p.id, s: q === p ? 'That would box you in' : 'That would box in ' + q.name });
        return false;
      }
    }
    const s = {
      id: this.nextId++, kind: 'wall', owner: p.id, cells, x: cx, z: cz, horizontal,
      hp: st.wallHp, maxHp: st.wallHp, spikes: st.spikes, lvl: p.lvl, life: Infinity,
    };
    this.addStruct(s);
    // over the limit: the oldest wall crumbles
    const mine = this.structs.filter((w) => w.kind === 'wall' && w.owner === p.id);
    for (let i = 0; i < mine.length - st.maxWalls; i++) this.destroyStruct(mine[i]);
    this.emit({ k: 'sfx', s: 'build', x: cx, z: cz });
    return true;
  }

  // Number of walkable cells reachable from (x,z), treating `extra` cell indices as blocked.
  reachableCells(x, z, extra) {
    const { W, H, grid } = this.world;
    const seen = new Uint8Array(W * H);
    const start = Math.floor(z) * W + Math.floor(x);
    const stack = [start];
    seen[start] = 1;
    let n = 0;
    while (stack.length) {
      const i = stack.pop();
      n++;
      const cx = i % W, cz = (i - cx) / W;
      for (const j of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, cz > 0 ? i - W : -1, cz < H - 1 ? i + W : -1]) {
        if (j < 0 || seen[j] || grid[j] !== 0 || this.sgrid[j] !== 0 || (extra && extra.has(j))) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return n;
  }

  placeTurret(p, st, scale) {
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    let cell = null;
    for (const d of [1.4, 1.0, 2.0, 0.6]) {
      const cx = Math.floor(p.x + ca * d), cz = Math.floor(p.z + sa * d);
      if (this.cellFreeForStruct(cx, cz)) {
        cell = [cx, cz];
        break;
      }
    }
    if (!cell) {
      this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
      return false;
    }
    const mine = this.structs.filter((s) => s.kind === 'turret' && s.owner === p.id);
    if (mine.length >= st.maxTurrets) this.destroyStruct(mine[0], false);
    const s = {
      id: this.nextId++, kind: 'turret', owner: p.id, cells: [cell], x: cell[0] + 0.5, z: cell[1] + 0.5,
      hp: st.hp, maxHp: st.hp, life: st.duration, maxLife: st.duration, cd: 0.5, ang: p.ang,
      dmg: st.damage * scale, rate: st.rate, range: st.range, explosive: st.explosive, lvl: p.lvl,
    };
    this.addStruct(s);
    this.emit({ k: 'sfx', s: 'build', x: s.x, z: s.z });
    return true;
  }

  healField(p, st) {
    for (const q of this.players) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > st.radius) continue;
      if (q.state === 'alive') {
        q.hp = Math.min(q.maxHp, q.hp + st.heal);
        if (st.invuln) q.invuln = st.invuln;
      } else if (q.state === 'down' && st.revive) {
        this.revivePlayer(q, p);
      }
    }
    this.hazards.push({ id: this.nextId++, kind: 'heal', x: p.x, z: p.z, r: 4, t: st.zone, heal: st.zoneHeal, dmg: st.zoneDamage, pid: p.id });
    this.emit({ k: 'heal', x: p.x, z: p.z, r: st.radius });
  }

  // Mags: toss a supply bag toward the cursor (a second one lands at her feet at level 4+)
  supplyDrop(p, st, ax, az) {
    let dx = ax - p.x, dz = az - p.z;
    const d = Math.hypot(dx, dz) || 1, dd = Math.min(7, d);
    let x = p.x + (dx / d) * dd, z = p.z + (dz / d) * dd;
    if (circleBlocked(this.world, this.sgrid, x, z, 0.4) || !hasLOS(this.world, p.x, p.z, x, z)) {
      x = p.x;
      z = p.z;
    }
    const spots = st.bags > 1 ? [[x, z], [p.x, p.z]] : [[x, z]];
    for (const [bx, bz] of spots) {
      this.pickups.push({
        id: this.nextId++, kind: 'supply', x: bx, z: bz, t: st.life, took: [],
        restock: Math.min(1, st.restock), grenades: st.grenades, mags: st.mags,
      });
      this.emit({ k: 'heal', x: bx, z: bz, r: 1.6, c: '#ffd65a' });
    }
    this.emit({ k: 'sfx', s: 'throw', x: p.x, z: p.z });
  }

  // each living player can take from a supply bag once; it's gone when all have
  grabSupply(k) {
    for (const p of this.players) {
      if (p.state !== 'alive' || k.took.includes(p.id) || dist2(p.x, p.z, k.x, k.z) > 1.3 * 1.3) continue;
      k.took.push(p.id);
      this.restock(p, k.restock, k.mags);
      if (k.grenades) p.grenades = Math.min(this.maxGrenades(p), p.grenades + k.grenades);
      this.emit({ k: 'sfx', s: 'pickup', x: k.x, z: k.z });
      this.emit({ k: 'float', x: k.x, z: k.z, s: '+Ammo', p: p.id });
    }
    if (this.players.every((p) => p.state !== 'alive' || k.took.includes(p.id))) this.pickups.splice(this.pickups.indexOf(k), 1);
  }

  // add `frac` of each weapon's max reserve (and optionally top up magazines)
  restock(q, frac, mags) {
    for (const w of q.weapons) {
      if (!w) continue;
      const ws = this.wstat(q, w);
      w.reserve = Math.min(ws.reserve, w.reserve + Math.ceil(ws.reserve * frac));
      if (mags) w.mag = ws.mag;
    }
  }

  airstrike(p, st, scale, ax, az) {
    let dx = ax - p.x, dz = az - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const dd = Math.min(28, d);
    const tx = p.x + (dx / d) * dd, tz = p.z + (dz / d) * dd;
    this.emit({ k: 'strike', x: tx, z: tz, r: st.spread + st.radius });
    for (let i = 0; i < st.shells; i++) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * st.spread;
      this.strikes.push({ t: 1.0 + i * 0.16, x: tx + Math.cos(a) * r, z: tz + Math.sin(a) * r, dmg: st.damage * scale, r: st.radius, pid: p.id, napalm: st.napalm });
    }
  }

  // ------------------------------------------------------------ structures
  addStruct(s) {
    this.structs.push(s);
    for (const [x, z] of s.cells) this.sgrid[z * this.world.W + x] = s.id;
    this.fieldT = 0;
  }

  destroyStruct(s, effect = true) {
    const i = this.structs.indexOf(s);
    if (i < 0) return;
    this.structs.splice(i, 1);
    for (const [x, z] of s.cells) this.sgrid[z * this.world.W + x] = 0;
    if (effect) this.emit({ k: 'sbreak', x: s.x, z: s.z, kind: s.kind });
    this.fieldT = 0;
  }

  damageStruct(s, dmg) {
    s.hp -= dmg;
    if (s.hp <= 0) this.destroyStruct(s);
  }

  updateStructs(dt) {
    for (const s of [...this.structs]) {
      if (s.kind !== 'turret') continue;
      s.life -= dt;
      if (s.life <= 0) {
        this.destroyStruct(s);
        continue;
      }
      s.cd -= dt;
      if (s.cd > 0) continue;
      let best = null, bd = s.range * s.range;
      for (const z of this.zombies) {
        if (z.state === 'rise' && z.t > 0.8) continue;
        const d = dist2(z.x, z.z, s.x, s.z);
        if (d < bd && hasLOS(this.world, s.x, s.z, z.x, z.z)) {
          bd = d;
          best = z;
        }
      }
      if (!best) {
        s.cd = 0.2;
        continue;
      }
      s.cd = 1 / s.rate;
      s.ang = Math.atan2(best.z - s.z, best.x - s.x);
      const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
      const ox = s.x + ca * 0.5, oz = s.z + sa * 0.5;
      const end = this.hitscan(s.owner, ox, oz, ca, sa, s.range, s.dmg, 1, 'turret');
      this.emit({ k: 't', x: ox, z: oz, x2: ox + ca * end, z2: oz + sa * end, w: -1 });
      this.emit({ k: 'sfx', s: 'turret', x: s.x, z: s.z });
      if (s.explosive) this.explode(ox + ca * end, oz + sa * end, 1.3, s.dmg * 0.4, { pid: s.owner });
    }
  }

  // ------------------------------------------------------------ interaction
  updateInteract(p, pressed, held, dt) {
    const target = this.findInteract(p);
    p.interact = target;
    p.prompt = target ? target.text : '';
    p.promptProg = -1;
    if (!target) return;
    if (target.hold) {
      if (held) {
        target.progress(dt);
        p.promptProg = target.prog();
      } else if (target.release) {
        target.release();
      }
      if (p.promptProg < 0 && target.prog) p.promptProg = target.prog();
    } else if (pressed && target.act) {
      if (target.cost && p.points < target.cost) {
        this.emit({ k: 'sfx', s: 'nope', p: p.id, x: p.x, z: p.z });
        this.emit({ k: 'note', p: p.id, s: 'Not enough points' });
        return;
      }
      if (target.cost) {
        p.points -= target.cost;
        this.emit({ k: 'sfx', s: 'buy', x: p.x, z: p.z });
      }
      target.act();
    }
  }

  findInteract(p) {
    const near = (x, z, r) => dist2(p.x, p.z, x, z) < r * r;
    // revive
    for (const q of this.players) {
      if (q !== p && q.state === 'down' && near(q.x, q.z, 2)) {
        const speed = p.char === 'doc' ? 2 : 4;
        return {
          hold: true,
          text: 'Hold [E] to revive ' + q.name,
          progress: (dt) => {
            q.revive += dt / speed;
            q.reviver = p.id;
            if (q.revive >= 1) this.revivePlayer(q, p);
          },
          release: () => {
            if (q.reviver === p.id) q.revive = 0;
          },
          prog: () => q.revive,
        };
      }
    }
    // story stations
    if (this.step && this.step.type === 'activate') {
      for (const st of this.ss.stations) {
        if (!st.done && near(st.x, st.z, 2.4)) {
          return {
            hold: true,
            text: 'Hold [E] — ' + this.step.label,
            progress: (dt) => {
              st.prog += dt / this.step.hold;
              if (Math.floor(st.prog * 10) !== Math.floor((st.prog - dt / this.step.hold) * 10)) this.emit({ k: 'sfx', s: 'work', x: st.x, z: st.z });
            },
            prog: () => st.prog,
          };
        }
      }
    }
    const cw = this.curWeapon(p);
    // mystery box
    const bs = this.world.spots.box[this.box.spot];
    if (bs && near(bs.x, bs.z, 2.3)) {
      if (this.box.state === 'idle') {
        return { cost: BOX_COST, text: '[E] Mystery Box — ' + BOX_COST, act: () => this.openBox(p) };
      }
      if (this.box.state === 'offer' && this.box.user === p.id) {
        return { text: '[E] Take ' + RARITY[this.box.rarity].name + ' ' + WEAPONS[this.box.wid].name, act: () => {
          this.giveWeapon(p, this.box.wid, this.box.rarity);
          this.box.state = 'idle';
          this.box.wid = '';
        } };
      }
    }
    // weapons dropped from containers
    let bestPick = null, bpd = 1.7 * 1.7;
    for (const k of this.pickups) {
      if (k.kind !== 'weapon') continue;
      const d = dist2(p.x, p.z, k.x, k.z);
      if (d < bpd) {
        bpd = d;
        bestPick = k;
      }
    }
    // loot containers (whichever of container / dropped weapon is closer gets the prompt)
    let bc = null, bcd = 1.9 * 1.9;
    for (const c of this.containers) {
      if (!c.full) continue;
      const d = dist2(p.x, p.z, c.x, c.z);
      if (d < bcd) {
        bcd = d;
        bc = c;
      }
    }
    if (bestPick && !(bc && bcd < bpd)) {
      const same = p.weapons.find((w) => w && w.id === bestPick.wid);
      const label = RARITY[bestPick.rarity].name + ' ' + WEAPONS[bestPick.wid].name;
      const verb = same ? (bestPick.rarity > (same.rarity || 0) ? '[E] Upgrade to ' : '[E] Take ammo from ') : p.weapons[1] ? '[E] Swap for ' : '[E] Take ';
      return {
        text: verb + label,
        act: () => {
          this.giveWeapon(p, bestPick.wid, bestPick.rarity);
          this.pickups.splice(this.pickups.indexOf(bestPick), 1);
        },
      };
    }
    if (bc) {
      const def = CONTAINERS[bc.kind];
      return {
        hold: true,
        text: 'Hold [E] Search ' + def.name,
        progress: (dt) => {
          bc.prog += dt / def.time;
          bc.searcher = p.id;
          if (bc.prog >= 1) this.openContainer(bc, p);
        },
        release: () => {
          if (bc.searcher === p.id) bc.prog = 0;
        },
        prog: () => bc.prog,
      };
    }
    // forge
    const fs = this.world.spots.forge;
    if (fs && near(fs.x, fs.z, 2.3)) {
      if (cw.forging) return { text: 'Forging...' };
      if (cw.forged >= 2) return { text: 'Weapon fully forged' };
      if (cw.forged && (cw.fkills || 0) < FORGE2.kills) return { text: `Forge XX unlocks after ${FORGE2.kills} kills with this gun (${cw.fkills || 0}/${FORGE2.kills})` };
      const cost = cw.forged ? FORGE2.cost : FORGE.cost;
      return {
        cost,
        text: `[E] Weapon Forge: upgrade ${WEAPONS[cw.id].name} to ${cw.forged ? 'XX' : 'X'} — ${cost}`,
        act: () => {
          cw.forging = 2.5;
          p.reloadT = 0;
          this.emit({ k: 'sfx', s: 'forgestart', x: fs.x, z: fs.z });
        },
      };
    }
    // upgrade machine: buy a pick of 3 random level-up upgrades
    const shop = this.world.spots.boonshop;
    if (shop && near(shop.x, shop.z, 2.1)) {
      if (p.choices.length) return { text: 'Pick your upgrade first (1 / 2 / 3)' };
      const cost = SHOP_COST + SHOP_STEP * p.shopBuys;
      return {
        cost,
        text: '[E] Upgrade Machine: choose 1 of 3 upgrades — ' + cost,
        act: () => {
          const set = this.rollChoices(p);
          if (!set.length) return;
          p.shopBuys++;
          p.choices.push(set);
          this.emit({ k: 'sfx', s: 'perk', x: shop.x, z: shop.z });
        },
      };
    }
    // perks
    for (const s of this.world.spots.perk) {
      if (near(s.x, s.z, 2.1)) {
        const pk = PERKS[s.perk];
        if (p.perks[s.perk]) return { text: pk.name + ' (owned)' };
        return {
          cost: pk.cost,
          text: '[E] ' + pk.name + ': ' + pk.desc + ' — ' + pk.cost,
          act: () => {
            p.perks[s.perk] = true;
            if (s.perk === 'tough') {
              p.maxHp = p.baseMaxHp * 2;
              p.hp = p.maxHp;
            }
            this.emit({ k: 'sfx', s: 'perk', x: s.x, z: s.z });
          },
        };
      }
    }
    // tear down a player-built wall (so nobody can ever stay walled in)
    let bw = null, bwd = 1.5 * 1.5;
    for (const s of this.structs) {
      if (s.kind !== 'wall') continue;
      for (const [x, z] of s.cells) {
        const d = dist2(p.x, p.z, x + 0.5, z + 0.5);
        if (d < bwd) {
          bwd = d;
          bw = s;
        }
      }
    }
    if (bw) {
      const wall = bw;
      return {
        hold: true,
        text: 'Hold [E] Dismantle wall',
        progress: (dt) => {
          wall.prog = (wall.prog || 0) + dt / 1.5;
          wall.taker = p.id;
          if (wall.prog >= 1) this.destroyStruct(wall);
        },
        release: () => {
          if (wall.taker === p.id) wall.prog = 0;
        },
        prog: () => wall.prog || 0,
      };
    }
    // doors
    for (const d of this.world.doors) {
      if (d.open) continue;
      const nx = Math.max(d.x, Math.min(d.x + d.w, p.x)), nz = Math.max(d.z, Math.min(d.z + d.d, p.z));
      if (dist2(p.x, p.z, nx, nz) < 1.6 * 1.6) {
        if (d.cost >= 99999) return { text: d.label };
        return { cost: d.cost, text: '[E] ' + d.label + ' — ' + d.cost, act: () => this.openDoor(d.id) };
      }
    }
    return null;
  }

  openDoor(id) {
    const d = this.world.doors[id];
    if (!d || d.open) return;
    d.open = true;
    for (let z = d.z; z < d.z + d.d; z++) for (let x = d.x; x < d.x + d.w; x++) this.world.grid[z * this.world.W + x] = 0;
    this.emit({ k: 'door', id, x: d.x + d.w / 2, z: d.z + d.d / 2 });
    this.fieldT = 0;
  }

  giveWeapon(p, wid, rarity = 0) {
    const slot = p.weapons.findIndex((w) => w && w.id === wid);
    if (slot >= 0) {
      const w = p.weapons[slot];
      if (rarity > (w.rarity || 0)) {
        p.weapons[slot] = this.makeWeapon(wid, w.forged, rarity);
      } else {
        const st = this.wstat(p, w);
        w.mag = st.mag;
        w.reserve = st.reserve;
      }
      p.cur = slot;
    } else if (!p.weapons[1]) {
      p.weapons[1] = this.makeWeapon(wid, false, rarity);
      p.cur = 1;
    } else {
      p.weapons[p.cur] = this.makeWeapon(wid, false, rarity);
    }
    const nw = p.weapons[p.cur];
    const st = this.wstat(p, nw);
    nw.reserve = Math.min(st.reserve, Math.max(nw.reserve, st.reserve));
    p.reloadT = 0;
    p.fireCd = 0.3;
    this.emit({ k: 'sfx', s: 'pickup', x: p.x, z: p.z });
  }

  revivePlayer(q, by) {
    q.state = 'alive';
    q.hp = q.maxHp * 0.5;
    q.revive = 0;
    q.invuln = 2;
    q.lastHurt = this.time;
    if (by) by.revives++;
    if (by) this.givePoints(by, 100);
    this.emit({ k: 'msg', s: q.name + ' was revived' + (by ? ' by ' + by.name : '') });
  }

  hurtPlayer(p, dmg) {
    if (p.state !== 'alive' || p.invuln > 0) return;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
    }
    p.hp -= dmg;
    p.lastHurt = this.time;
    this.emit({ k: 'hurt', p: p.id, x: p.x, z: p.z });
    if (p.hp <= 0) {
      p.hp = 0;
      p.downs++;
      p.perks = {};
      p.maxHp = p.baseMaxHp;
      p.reloadT = 0;
      const others = this.players.some((q) => q !== p && q.state === 'alive');
      if (p.boons.laststand) {
        // consumed: the upgrade can be picked again later
        delete p.boons.laststand;
        p.selfRevive = true;
        p.state = 'down';
        p.bleed = 3;
        this.emit({ k: 'msg', s: 'LAST STAND', sub: p.name + ' is getting back up!' });
      } else if (this.players.length > 1 && others) {
        p.state = 'down';
        p.bleed = BLEED_TIME;
        p.revive = 0;
        this.emit({ k: 'msg', s: p.name + ' is down!', sub: 'Hold E near them to revive' });
      } else if (this.players.length === 1 && !p.secondWindUsed) {
        // solo players get one automatic self-revive per game
        p.secondWindUsed = true;
        p.selfRevive = true;
        p.state = 'down';
        p.bleed = 3;
        this.emit({ k: 'msg', s: 'SECOND WIND', sub: 'Getting back up... this only happens once!' });
      } else {
        p.state = this.players.length > 1 ? 'down' : 'dead';
        p.bleed = BLEED_TIME;
      }
      this.emit({ k: 'sfx', s: 'down', x: p.x, z: p.z });
    }
  }

  // ------------------------------------------------------------ box / pickups
  openBox(p) {
    this.box.state = 'spin';
    this.box.t = 3;
    this.box.user = p.id;
    this.box.uses++;
    this.emit({ k: 'sfx', s: 'box', x: p.x, z: p.z });
  }

  updateBox(dt) {
    const b = this.box;
    if (b.state === 'idle') return;
    b.t -= dt;
    if (b.t > 0) return;
    if (b.state === 'spin') {
      if (b.uses >= b.movesAt && this.world.spots.box.length > 1) {
        b.state = 'moving';
        b.t = 4;
        const u = this.players.find((q) => q.id === b.user);
        if (u) u.points += BOX_COST;
        this.emit({ k: 'msg', s: 'The Mystery Box is moving...' });
        this.emit({ k: 'sfx', s: 'boxmove', x: 0, z: 0 });
        return;
      }
      const u = this.players.find((q) => q.id === b.user);
      const pool = this.weaponPool.filter((w) => !(u && u.weapons.some((x) => x && x.id === w)));
      const pick = this.rng.weighted(pool.length ? pool : this.weaponPool, (w) => WEAPONS[w].boxWeight || 1);
      b.wid = pick;
      b.rarity = rollRarity(this.rng, 1 + this.wave * 0.06, 1);
      b.state = 'offer';
      b.t = 10;
    } else if (b.state === 'offer') {
      b.state = 'idle';
      b.wid = '';
    } else if (b.state === 'moving') {
      let next = b.spot;
      while (next === b.spot) next = Math.floor(this.rng() * this.world.spots.box.length);
      b.spot = next;
      b.state = 'idle';
      b.uses = 0;
      b.movesAt = 4 + Math.floor(this.rng() * 5);
    }
  }

  openContainer(c, p) {
    c.full = false;
    c.prog = 0;
    const def = CONTAINERS[c.kind];
    const kinds = Object.keys(def.loot);
    const roll = this.rng.weighted(kinds, (k) => def.loot[k]);
    // loot pops out toward the player
    const a = Math.atan2(p.z - c.z, p.x - c.x);
    let x = (c.x + p.x) / 2, z = (c.z + p.z) / 2;
    // pick a free spot that isn't on top of another container's search point
    for (const off of [0, 1.2, -1.2, 2.4, -2.4, Math.PI]) {
      const tx = c.x + Math.cos(a + off) * 1.1, tz = c.z + Math.sin(a + off) * 1.1;
      if (circleBlocked(this.world, this.sgrid, tx, tz, 0.3)) continue;
      if (this.containers.some((o) => o !== c && dist2(o.x, o.z, tx, tz) < 1.5 * 1.5)) continue;
      x = tx;
      z = tz;
      break;
    }
    const base = { id: this.nextId++, x, z, fx: c.x, fz: c.z };
    let rarity = -1;
    if (roll === 'weapon') {
      const wid = this.rng.weighted(this.weaponPool, (w) => (WEAPONS[w].map === this.map.id ? 3 : 1));
      rarity = rollRarity(this.rng, def.luck + this.wave * 0.06, def.minRarity || 0);
      this.pickups.push({ ...base, kind: 'weapon', wid, rarity, t: 150 });
    } else if (roll === 'cash') {
      this.pickups.push({ ...base, kind: 'cash', amount: 100 + Math.floor(this.rng() * 5) * 50, t: 60 });
    } else {
      this.pickups.push({ ...base, kind: roll, t: 60 });
    }
    this.emit({ k: 'loot', x: c.x, z: c.z, r: rarity, c: c.id });
  }

  spawnPowerup(x, z, pw) {
    this.pickups.push({ id: this.nextId++, kind: 'power', pw, x, z, t: 25 });
  }

  updatePickups(dt) {
    for (const k of [...this.pickups]) {
      if (k.t !== undefined) {
        k.t -= dt;
        if (k.t <= 0) {
          this.pickups.splice(this.pickups.indexOf(k), 1);
          continue;
        }
      }
      if (k.kind === 'weapon') continue;
      if (k.kind === 'supply') {
        this.grabSupply(k);
        continue;
      }
      const p = this.players.find((q) => q.state === 'alive' && dist2(q.x, q.z, k.x, k.z) < 1.3 * 1.3);
      if (!p) continue;
      this.pickups.splice(this.pickups.indexOf(k), 1);
      if (k.kind === 'power') this.applyPowerup(k.pw, p);
      else if (k.kind === 'item') this.collectItem(k, p);
      else this.collectSupply(k, p);
    }
  }

  collectSupply(k, p) {
    let text = '';
    if (k.kind === 'ammo') {
      for (const w of p.weapons) {
        if (!w) continue;
        const st = this.wstat(p, w);
        w.reserve = Math.min(st.reserve, w.reserve + Math.ceil(st.reserve * 0.5));
      }
      text = '+Ammo';
    } else if (k.kind === 'cash') {
      this.givePoints(p, k.amount);
      text = '+' + k.amount + ' points';
    } else if (k.kind === 'grenade') {
      p.grenades = Math.min(this.maxGrenades(p), p.grenades + 1);
      text = '+1 Grenade';
    } else if (k.kind === 'health') {
      p.hp = Math.min(p.maxHp, p.hp + 50);
      text = '+50 Health';
    }
    this.emit({ k: 'sfx', s: 'pickup', x: k.x, z: k.z });
    this.emit({ k: 'float', x: k.x, z: k.z, s: text, p: p.id });
  }

  applyPowerup(pw, p) {
    this.emit({ k: 'power', pw, s: POWERUPS[pw].name });
    if (pw === 'maxammo') {
      for (const q of this.players) {
        for (const w of q.weapons) if (w) w.reserve = this.wstat(q, w).reserve;
        q.grenades = Math.max(q.grenades, this.maxGrenades(q));
      }
    } else if (pw === 'instakill') this.instakill = 20;
    else if (pw === 'double') this.double = 20;
    else if (pw === 'nuke') {
      for (const z of [...this.zombies]) {
        if (z.boss || z.mini) continue;
        this.killZombie(z, null, 'nuke');
      }
      for (const q of this.players) this.givePoints(q, 400);
      this.emit({ k: 'nuke' });
    }
  }

  // ------------------------------------------------------------ waves
  updateWaves(dt) {
    if (this.waveState === 'break') {
      this.waveT -= dt;
      if (this.waveT <= 0) this.startWave();
      return;
    }
    const pressure = this.step && ['survive', 'defend', 'boss'].includes(this.step.type);
    if (this.toSpawn > 0) {
      this.spawnT -= dt * (pressure ? 1.35 : 1);
      const regular = this.zombies.filter((z) => !z.boss && !z.mini).length;
      if (this.spawnT <= 0 && regular < this.maxAlive) {
        this.spawnT = this.spawnInterval * (0.7 + this.rng() * 0.6);
        if (this.spawnRegular()) this.toSpawn--;
      }
    } else if (!this.zombies.some((z) => !z.boss && !z.mini)) {
      this.waveState = 'break';
      this.waveT = pressure ? 4 : 10;
      this.emit({ k: 'waveEnd', w: this.wave });
    }
  }

  startWave() {
    this.wave++;
    const n = this.n;
    this.waveState = 'active';
    this.toSpawn = Math.round((5 + this.wave * 3) * (1 + 0.6 * (n - 1)) * this.diff.density) + Math.max(0, this.wave - 11) * 2;
    // spawns trickle in across the round, and at most ~45% of it is alive at once,
    // so a single Kaboom can't wipe most of a late wave
    this.spawnInterval = Math.max(0.75, 2.2 - this.wave * 0.08) / this.diff.spawnRate / (1 + 0.35 * (n - 1));
    this.maxAlive = Math.min(64, 20 + this.wave + 6 * (n - 1), Math.max(8, Math.ceil(this.toSpawn * 0.45)));
    this.spawnT = 1;
    this.powerupsThisWave = 0;
    for (const c of this.containers) if (!c.full && this.rng() < RESTOCK_CHANCE) c.full = true;
    for (const p of this.players) {
      p.grenades = Math.min(this.maxGrenades(p), p.grenades + 2);
      if (p.state === 'dead') {
        const sp = this.world.spots.playerSpawn[0];
        p.state = 'alive';
        p.x = sp.x;
        p.z = sp.z;
        p.tp++;
        p.hp = p.maxHp = p.baseMaxHp;
        p.weapons = [this.makeWeapon('pistol'), null];
        p.cur = 0;
        p.invuln = 3;
        this.emit({ k: 'msg', s: p.name + ' has respawned' });
      }
    }
    if (this.mode === 'endless') {
      if (this.wave % 5 === 0) this.spawnBossNear(this.map.boss);
      else if (this.wave % 3 === 0 && this.wave >= 6) this.spawnBossNear(this.map.miniboss || 'brute');
    }
    this.emit({ k: 'wave', w: this.wave });
  }

  pickSpawnPoint(minD = 9, maxD = 42) {
    const alive = this.players.filter((p) => p.state === 'alive');
    if (!alive.length) return null;
    const cands = [];
    for (const s of this.world.spots.zspawn) {
      const fd = this.field.distAt(s.x, s.z);
      if (!(fd >= minD && fd <= maxD)) continue;
      if (alive.some((p) => dist2(p.x, p.z, s.x, s.z) < 7.5 * 7.5)) continue;
      if (this.sgrid[Math.floor(s.z) * this.world.W + Math.floor(s.x)]) continue;
      cands.push(s);
    }
    if (cands.length) return cands[Math.floor(this.rng() * cands.length)];
    let best = null, bd = Infinity;
    for (const s of this.world.spots.zspawn) {
      const fd = this.field.distAt(s.x, s.z);
      if (fd >= 6 && fd < bd) {
        bd = fd;
        best = s;
      }
    }
    return best;
  }

  spawnRegular() {
    const sp = this.pickSpawnPoint();
    if (!sp) return false;
    const pool = this.map.zombies.filter((e) => e.minWave <= this.wave);
    const e = this.rng.weighted(pool, (x) => x.weight + (x.type !== 'walker' ? Math.min(4, this.wave * 0.25) : 0));
    this.spawnZombie(e.type, sp.x + (this.rng() - 0.5) * 0.6, sp.z + (this.rng() - 0.5) * 0.6);
    return true;
  }

  spawnBossNear(type) {
    const sp = this.pickSpawnPoint(14, 60) || this.world.spots.zspawn[0];
    return this.spawnZombie(type, sp.x, sp.z);
  }

  spawnZombie(type, x, z, rise = true) {
    const def = ZOMBIES[type];
    const n = this.n;
    let hp;
    if (def.fixedHp) {
      hp = def.hp * (1 + 0.75 * (n - 1));
      if (this.mode === 'endless') hp *= 0.6 + 0.08 * this.wave;
    } else if (def.egg || def.clone) {
      hp = def.hp * (1 + 0.5 * (n - 1)) * (1 + 0.05 * this.wave);
    } else {
      hp = def.hp * (1 + 0.16 * (this.wave - 1)) * this.diff.hp * (1 + 0.35 * (n - 1));
    }
    const speed = def.fixedHp
      ? def.speed * this.diff.speed
      : Math.min(ZOMBIE_SPEED_CAP, def.speed * this.diff.speed * (0.9 + this.rng() * 0.2) * (1 + Math.min(0.45, 0.025 * (this.wave - 1))));
    const zb = {
      id: this.nextId++, type, def, x, z, r: def.radius, cr: Math.min(def.radius, 0.45), ang: this.rng() * Math.PI * 2,
      hp, maxHp: hp, speed, damage: def.damage * this.diff.damage,
      state: rise ? 'rise' : 'move', t: rise ? (def.boss || def.miniboss ? 2.4 : 1.4) : 0,
      atkCd: 0.5, cds: {}, boss: !!def.boss, mini: !!def.miniboss,
      burn: 0, stun: 0, buff: 0, losT: 0, los: false, target: null, targetT: 0, specialCd: 1 + this.rng() * 2,
      trailT: 0, hurtT: 0,
    };
    if (zb.boss || zb.mini) for (const a of def.abilities) zb.cds[a] = 2 + this.rng() * 3;
    if (def.egg) zb.hatchT = def.egg.hatch;
    if (def.clone) zb.life = def.clone.life;
    this.zombies.push(zb);
    if (rise) this.emit({ k: 'spawn', x, z, big: zb.boss || zb.mini ? 1 : 0 });
    if (zb.boss || zb.mini) this.emit({ k: 'boss', s: def.name, b: zb.boss ? 1 : 0 });
    return zb;
  }

  // ------------------------------------------------------------ zombies
  updateZombies(dt) {
    const zs = this.zombies;
    const alive = this.players.filter((p) => p.state === 'alive');
    // screamer buffs
    for (const z of zs) {
      if (z.buff > 0) z.buff -= dt;
      if (z.rally > 0) z.rally -= dt;
    }
    for (const z of zs) {
      if (z.def.scream && z.state !== 'rise') {
        const r2 = z.def.scream.radius * z.def.scream.radius;
        for (const o of zs) if (o !== z && dist2(o.x, o.z, z.x, z.z) < r2) o.buff = Math.max(o.buff, 0.4);
      }
    }
    for (const z of [...zs]) {
      if (z.dead) continue;
      if (z.hurtT > 0) z.hurtT -= dt;
      if (z.burn > 0) {
        z.burn -= dt;
        this.damageZombie(z, z.burnDps * dt, z.burnBy, 'burn');
        if (z.dead) continue;
      }
      if (z.state === 'rise') {
        z.t -= dt;
        if (z.t <= 0) z.state = 'move';
        continue;
      }
      if (z.stun > 0) {
        z.stun -= dt;
        continue;
      }
      if (z.def.egg) {
        z.hatchT -= dt;
        if (z.hatchT <= 0) this.hatchEgg(z);
        continue;
      }
      if (z.def.clone) {
        z.life -= dt;
        if (z.life <= 0) {
          this.emit({ k: 'blink', x: z.x, z: z.z, x2: z.x, z2: z.z });
          this.removeZombie(z);
          continue;
        }
      }
      // target selection
      z.targetT -= dt;
      if (z.targetT <= 0 || !z.target || z.target.state !== 'alive') {
        z.targetT = 0.5;
        let best = null, bd = Infinity;
        for (const p of alive) {
          const d = dist2(p.x, p.z, z.x, z.z);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        z.target = best;
      }
      const tgt = z.target;
      if (!tgt) {
        z.state = 'move';
        continue;
      }
      const dx = tgt.x - z.x, dz = tgt.z - z.z;
      const dist = Math.hypot(dx, dz);
      z.losT -= dt;
      if (z.losT <= 0) {
        z.losT = 0.25 + this.rng() * 0.1;
        z.los = dist < 30 && hasLOS(this.world, z.x, z.z, tgt.x, tgt.z);
        z.walk = z.los && dist < 9 && clearPath(this.world, this.sgrid, z.x, z.z, tgt.x, tgt.z, z.cr);
      }
      z.cdTick = dt;
      if ((z.boss || z.mini) && this.bossThink(z, tgt, dist, dt)) continue;
      if (this.specialThink(z, tgt, dist, dt)) continue;

      // melee attack: regular zombies start the swing a little early and lunge
      // through it, so players can't dodge every hit just by walking
      const reach = z.r + tgt.r + 0.45;
      const big = z.boss || z.mini;
      z.atkCd -= dt;
      if (z.state === 'attack') {
        z.t -= dt;
        if (!big && dist > reach * 0.6) moveCircle(this.world, this.sgrid, z, (dx / dist) * z.speed * 1.4 * dt, (dz / dist) * z.speed * 1.4 * dt, z.cr);
        if (z.t <= 0) {
          z.state = 'move';
          if (dist < reach + (big ? 0.5 : 0.8)) {
            this.hurtPlayer(tgt, z.damage);
            if (tgt.boons.thorns) this.damageZombie(z, 60 * tgt.boons.thorns * (1 + 0.15 * (this.wave - 1)), tgt.id, 'spikes');
          }
          z.atkCd = z.def.attackRate;
        }
        continue;
      }
      if (dist < reach + (big ? 0 : 0.4) && z.atkCd <= 0) {
        z.state = 'attack';
        z.t = big ? 0.35 : 0.3;
        z.ang = Math.atan2(dz, dx);
        continue;
      }
      if (dist < reach - 0.15) {
        z.ang = Math.atan2(dz, dx);
        continue;
      }
      // movement
      let mx, mz;
      if (z.walk && dist < 9) {
        mx = dx / dist;
        mz = dz / dist;
      } else {
        const f = this.field.dirAt(z.x, z.z);
        if (f) {
          mx = f.x;
          mz = f.z;
        } else {
          mx = dx / (dist || 1);
          mz = dz / (dist || 1);
        }
      }
      let sp = z.speed * (z.buff > 0 ? 1.45 : 1);
      if (z.def.spit && z.los && dist < z.def.spit.range * 0.75) sp = 0;
      // turn smoothly
      const want = Math.atan2(mz, mx);
      z.ang += angDiff(want, z.ang) * Math.min(1, dt * 10);
      if (sp > 0) {
        const frac = moveCircle(this.world, this.sgrid, z, mx * sp * dt, mz * sp * dt, z.cr);
        if (frac < 0.35) this.attackStructAhead(z, mx, mz, dt);
      }
      if (z.def.burner) {
        z.trailT -= dt;
        if (z.trailT <= 0) {
          z.trailT = 0.5;
          this.hazards.push({ id: this.nextId++, kind: 'fire', x: z.x, z: z.z, r: 1.1, t: 3, dps: 14 * this.diff.damage });
        }
      }
    }
    // separation
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.state === 'rise') continue;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.state === 'rise') continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        const wa = a.def.egg ? 0 : a.boss || a.mini ? 0.1 : 1, wb = b.def.egg ? 0 : b.boss || b.mini ? 0.1 : 1;
        if (!circleBlocked(this.world, this.sgrid, a.x - nx * push * wa, a.z - nz * push * wa, a.cr)) {
          a.x -= nx * push * wa;
          a.z -= nz * push * wa;
        }
        if (!circleBlocked(this.world, this.sgrid, b.x + nx * push * wb, b.z + nz * push * wb, b.cr)) {
          b.x += nx * push * wb;
          b.z += nz * push * wb;
        }
      }
    }
  }

  attackStructAhead(z, mx, mz, dt) {
    const W = this.world.W;
    let sid = 0;
    for (const d of [z.r + 0.4, z.r + 0.8]) {
      const cx = Math.floor(z.x + mx * d), cz = Math.floor(z.z + mz * d);
      if (cx < 0 || cz < 0 || cx >= W || cz >= this.world.H) continue;
      sid = this.sgrid[cz * W + cx];
      if (sid) break;
    }
    if (!sid) return;
    const s = this.structs.find((q) => q.id === sid);
    if (!s) return;
    z.atkCd -= dt;
    if (z.atkCd <= 0) {
      z.atkCd = z.def.attackRate;
      this.emit({ k: 'hitwall', x: z.x + mx * 0.8, z: z.z + mz * 0.8 });
      this.damageStruct(s, z.damage * (z.boss || z.mini ? 4 : 1.5));
      if (s.spikes) this.damageZombie(z, s.spikes * (1 + 0.15 * (this.wave - 1)), s.owner, 'spikes');
    }
  }

  // Regular zombie special abilities. Returns true if it consumed the update.
  specialThink(z, tgt, dist, dt) {
    const def = z.def;
    z.specialCd -= dt;
    if (z.state === 'leap') {
      z.t -= dt;
      moveCircle(this.world, this.sgrid, z, z.lvx * dt, z.lvz * dt, z.cr);
      if (dist < z.r + tgt.r + 0.5 && !z.leapHit) {
        z.leapHit = true;
        this.hurtPlayer(tgt, z.damage);
      }
      if (z.t <= 0) z.state = 'move';
      return true;
    }
    if (z.state === 'windup') {
      z.t -= dt;
      if (z.t <= 0) {
        z.state = 'move';
        if (z.pending === 'spit') {
          const a = Math.atan2(tgt.z - z.z, tgt.x - z.x);
          this.projs.push({ id: this.nextId++, kind: 'spit', owner: 'z', x: z.x, y: 1.2, z: z.z, vx: Math.cos(a) * 12, vy: 0, vz: Math.sin(a) * 12, g: 0, dmg: def.spit.damage * this.diff.damage, life: 1.4, r: 0.3 });
          this.emit({ k: 'sfx', s: 'spit', x: z.x, z: z.z });
        } else if (z.pending === 'leap') {
          const a = Math.atan2(tgt.z - z.z, tgt.x - z.x);
          const d = Math.min(def.leap.max + 1, dist + 1);
          z.state = 'leap';
          z.t = 0.5;
          z.leapHit = false;
          z.lvx = (Math.cos(a) * d) / 0.5;
          z.lvz = (Math.sin(a) * d) / 0.5;
        }
      }
      return true;
    }
    if (z.specialCd > 0) return false;
    if (def.spit && z.los && dist < def.spit.range && dist > 2.5) {
      z.specialCd = def.spit.cooldown;
      z.state = 'windup';
      z.pending = 'spit';
      z.t = 0.45;
      z.ang = Math.atan2(tgt.z - z.z, tgt.x - z.x);
      return true;
    }
    if (def.leap && z.los && dist > def.leap.min && dist < def.leap.max) {
      z.specialCd = def.leap.cooldown;
      z.state = 'windup';
      z.pending = 'leap';
      z.t = 0.4;
      z.ang = Math.atan2(tgt.z - z.z, tgt.x - z.x);
      return true;
    }
    if (def.phase && dist > 5 && dist < 26) {
      z.specialCd = def.phase.cooldown + this.rng() * 2;
      const a = this.rng() * Math.PI * 2;
      const r = 2.5 + this.rng() * 2;
      const nx = tgt.x + Math.cos(a) * r, nz = tgt.z + Math.sin(a) * r;
      if (!circleBlocked(this.world, this.sgrid, nx, nz, z.cr) && hasLOS(this.world, tgt.x, tgt.z, nx, nz)) {
        this.emit({ k: 'blink', x: z.x, z: z.z, x2: nx, z2: nz });
        z.x = nx;
        z.z = nz;
        z.atkCd = 0.6;
        return true;
      }
    }
    return false;
  }

  bossThink(z, tgt, dist, dt) {
    const def = z.def;
    const enraged = def.enrage && z.hp < z.maxHp * def.enrage;
    if (enraged && !z.enraged) {
      z.enraged = true;
      z.speed *= 1.35;
      this.emit({ k: 'msg', s: def.name + ' is ENRAGED!' });
      this.hazards.push({ id: this.nextId++, kind: 'ring', x: z.x, z: z.z, r: 0.5, maxR: 15, speed: 9, t: 2, dmg: 30 * this.diff.damage, hit: new Set() });
      if (def.summon) this.summonAround(z, def.summon);
    }
    const cdMult = enraged ? 0.6 : 1;
    for (const a in z.cds) z.cds[a] -= dt;
    if (z.state === 'charge') {
      z.t -= dt;
      const frac = moveCircle(this.world, this.sgrid, z, z.cvx * dt, z.cvz * dt, z.cr);
      for (const p of this.players) {
        if (p.state === 'alive' && !z.hitSet.has(p.id) && Math.hypot(p.x - z.x, p.z - z.z) < z.r + p.r + 0.4) {
          z.hitSet.add(p.id);
          this.hurtPlayer(p, z.damage * 1.1);
        }
      }
      if (frac < 0.3) {
        // smash any structure in the way
        const W = this.world.W;
        const cx = Math.floor(z.x + Math.sign(z.cvx) * (z.r + 0.5)), cz = Math.floor(z.z + Math.sign(z.cvz) * (z.r + 0.5));
        const sid = this.sgrid[cz * W + cx];
        const s = sid && this.structs.find((q) => q.id === sid);
        if (s) this.damageStruct(s, 400);
        z.t = 0;
        this.emit({ k: 'shake', i: 0.4 });
      }
      if (z.t <= 0) z.state = 'move';
      return true;
    }
    if (z.state === 'drain') {
      z.t -= dt;
      z.tickT -= dt;
      const v = z.drainTgt;
      if (!v || v.state !== 'alive' || dist2(v.x, v.z, z.x, z.z) > 13 * 13 || !hasLOS(this.world, z.x, z.z, v.x, v.z)) {
        z.state = 'move';
        return true;
      }
      z.ang = Math.atan2(v.z - z.z, v.x - z.x);
      if (z.tickT <= 0) {
        z.tickT = 0.25;
        this.hurtPlayer(v, 7 * this.diff.damage);
        z.hp = Math.min(z.maxHp, z.hp + z.maxHp * 0.004);
        this.emit({ k: 'beam', x: z.x, z: z.z, x2: v.x, z2: v.z });
      }
      if (z.t <= 0) z.state = 'move';
      return true;
    }
    if (z.state === 'windup') {
      z.t -= dt;
      if (z.t > 0) return true;
      z.state = 'move';
      const ab = z.pending;
      if (ab === 'charge') {
        const a = Math.atan2(tgt.z - z.z, tgt.x - z.x);
        z.ang = a;
        z.state = 'charge';
        z.t = 1.1;
        z.cvx = Math.cos(a) * 14;
        z.cvz = Math.sin(a) * 14;
        z.hitSet = new Set();
      } else if (ab === 'slam') {
        const r = 2 + z.def.scale * 1.0;
        this.emit({ k: 'slam', x: z.x, z: z.z, r });
        for (const p of this.players) if (p.state === 'alive' && Math.hypot(p.x - z.x, p.z - z.z) < r + p.r) this.hurtPlayer(p, z.damage);
        for (const s of [...this.structs]) if (Math.hypot(s.x - z.x, s.z - z.z) < r + 1) this.damageStruct(s, 300);
      } else if (ab === 'throw') {
        const T = 1.1, g = 20;
        const tx = tgt.x + (this.rng() - 0.5) * 2, tz = tgt.z + (this.rng() - 0.5) * 2;
        this.projs.push({ id: this.nextId++, kind: 'rock', owner: 'z', x: z.x, y: 3, z: z.z, vx: (tx - z.x) / T, vz: (tz - z.z) / T, vy: (0.5 * g * T * T - 3) / T, g, dmg: 40 * this.diff.damage, splash: 2.6, life: T + 0.5, r: 0.5, land: true });
      } else if (ab === 'volley') {
        const base = Math.atan2(tgt.z - z.z, tgt.x - z.x);
        const count = z.type === 'hivequeen' ? 9 : 6;
        const kind = z.type === 'hivequeen' || z.type === 'patientzero' ? 'spit' : 'rocket';
        for (let i = 0; i < count; i++) {
          const a = base + (i - (count - 1) / 2) * 0.16;
          const sp = kind === 'rocket' ? 13 : 12;
          this.projs.push({ id: this.nextId++, kind, owner: 'z', x: z.x, y: 1.6, z: z.z, vx: Math.cos(a) * sp, vy: 0, vz: Math.sin(a) * sp, g: 0, dmg: (kind === 'rocket' ? 22 : 16) * this.diff.damage, splash: kind === 'rocket' ? 2 : 0, life: 2.2, r: 0.35 });
        }
        this.emit({ k: 'sfx', s: kind === 'rocket' ? 'rocket' : 'spit', x: z.x, z: z.z });
      } else if (ab === 'summon') {
        this.summonAround(z, def.summon);
      } else if (ab === 'sweep') {
        // wide scythe arc in the direction locked in at the start of the windup
        const r = 5.2, half = 1.15;
        const inArc = (x, zz, rr) => Math.hypot(x - z.x, zz - z.z) < r + rr && Math.abs(angDiff(Math.atan2(zz - z.z, x - z.x), z.ang)) < half;
        this.emit({ k: 'sweep', x: z.x, z: z.z, a: z.ang, r, h: half });
        for (const p of this.players) if (p.state === 'alive' && inArc(p.x, p.z, p.r)) this.hurtPlayer(p, z.damage * 1.2);
        for (const s of [...this.structs]) if (inArc(s.x, s.z, 0.5)) this.damageStruct(s, 250);
      } else if (ab === 'hook') {
        const a = Math.atan2(tgt.z - z.z, tgt.x - z.x);
        z.ang = a;
        this.projs.push({
          id: this.nextId++, kind: 'hook', owner: 'z', zid: z.id, x: z.x + Math.cos(a) * z.r, y: 1.4, z: z.z + Math.sin(a) * z.r,
          vx: Math.cos(a) * 24, vy: 0, vz: Math.sin(a) * 24, g: 0, dmg: 12 * this.diff.damage, life: 0.8, r: 0.45,
        });
        this.emit({ k: 'sfx', s: 'throw', x: z.x, z: z.z });
      } else if (ab === 'bile') {
        // a trail of acid pools spewed along the locked-in direction, stopped by walls
        const a = z.ang, W = this.world.W;
        let n = 0;
        for (let i = 0; i < 6; i++) {
          const d = z.r + 1 + i * 1.7;
          const bx = z.x + Math.cos(a) * d, bz = z.z + Math.sin(a) * d;
          const cx = Math.floor(bx), cz = Math.floor(bz);
          if (cx < 0 || cz < 0 || cx >= W || cz >= this.world.H) break;
          const v = this.world.grid[cz * W + cx];
          if (v === 1 || v === 2) break;
          this.hazards.push({ id: this.nextId++, kind: 'acid', x: bx, z: bz, r: 1.5, t: 5 + i * 0.15, dps: 18 * this.diff.damage });
          n++;
        }
        this.emit({ k: 'bile', x: z.x, z: z.z, a, d: z.r + 1 + n * 1.7 });
        this.emit({ k: 'sfx', s: 'spit', x: z.x, z: z.z });
      } else if (ab === 'devour') {
        const prey = this.minionsNear(z, 8).sort((p, q) => dist2(p.x, p.z, z.x, z.z) - dist2(q.x, q.z, z.x, z.z)).slice(0, 5);
        for (const o of prey) {
          this.emit({ k: 'devour', x: o.x, z: o.z, x2: z.x, z2: z.z });
          this.killZombie(o, null, 'devour');
          z.hp = Math.min(z.maxHp, z.hp + z.maxHp * 0.04);
        }
        if (prey.length) this.emit({ k: 'msg', s: def.name + ' devours its minions!', sub: 'Thin out the horde so it cannot heal' });
      } else if (ab === 'barrage') {
        // artillery shells walk in on every player in range; red rings mark the impact zones
        for (const p of this.players) {
          if (p.state !== 'alive' || dist2(p.x, p.z, z.x, z.z) > 32 * 32) continue;
          this.emit({ k: 'strike', x: p.x, z: p.z, r: 4 });
          for (let i = 0; i < 4; i++) {
            const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * 3;
            this.strikes.push({ t: 1.3 + i * 0.22, x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, dmg: 32 * this.diff.damage, r: 2.2, enemy: true });
          }
        }
        this.emit({ k: 'sfx', s: 'strike', x: z.x, z: z.z });
      } else if (ab === 'rally') {
        for (const o of this.minionsNear(z, 12)) {
          o.rally = 6;
          o.buff = Math.max(o.buff, 6);
        }
        this.emit({ k: 'rally', x: z.x, z: z.z, r: 12 });
      } else if (ab === 'eggs') {
        const count = 3 + (this.n > 2 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          for (let tries = 0; tries < 6; tries++) {
            const a = this.rng() * Math.PI * 2, r = z.r + 1.5 + this.rng() * 3;
            const ex = z.x + Math.cos(a) * r, ez = z.z + Math.sin(a) * r;
            if (!circleBlocked(this.world, this.sgrid, ex, ez, 0.6)) {
              this.spawnZombie('egg', ex, ez, false);
              break;
            }
          }
        }
        this.emit({ k: 'eggs', x: z.x, z: z.z });
        this.emit({ k: 'sfx', s: 'spit', x: z.x, z: z.z });
      } else if (ab === 'mirror') {
        // blink next to the target and leave decoys that look exactly like the real thing
        const spots = [];
        for (let tries = 0; tries < 24 && spots.length < 3; tries++) {
          const a = this.rng() * Math.PI * 2, r = 5 + this.rng() * 3;
          const nx = tgt.x + Math.cos(a) * r, nz = tgt.z + Math.sin(a) * r;
          if (!circleBlocked(this.world, this.sgrid, nx, nz, z.cr) && spots.every((q) => dist2(q.x, q.z, nx, nz) > 9)) spots.push({ x: nx, z: nz });
        }
        if (spots.length) {
          const me = spots[Math.floor(this.rng() * spots.length)];
          this.emit({ k: 'blink', x: z.x, z: z.z, x2: me.x, z2: me.z, big: 1 });
          z.x = me.x;
          z.z = me.z;
          for (const q of spots) {
            if (q === me) continue;
            const c = this.spawnZombie('pzclone', q.x, q.z, false);
            c.ang = Math.atan2(tgt.z - q.z, tgt.x - q.x);
            this.emit({ k: 'blink', x: q.x, z: q.z, x2: q.x, z2: q.z, big: 1 });
          }
        }
      } else if (ab === 'drain') {
        z.state = 'drain';
        z.t = 2.6;
        z.tickT = 0;
        z.drainTgt = tgt;
      } else if (ab === 'teleport') {
        for (let tries = 0; tries < 12; tries++) {
          const a = this.rng() * Math.PI * 2, r = 4 + this.rng() * 4;
          const nx = tgt.x + Math.cos(a) * r, nz = tgt.z + Math.sin(a) * r;
          if (!circleBlocked(this.world, this.sgrid, nx, nz, z.cr)) {
            this.emit({ k: 'blink', x: z.x, z: z.z, x2: nx, z2: nz, big: 1 });
            z.x = nx;
            z.z = nz;
            break;
          }
        }
      } else if (ab === 'shockwave') {
        this.hazards.push({ id: this.nextId++, kind: 'ring', x: z.x, z: z.z, r: 0.5, maxR: 15, speed: 9, t: 2, dmg: 30 * this.diff.damage, hit: new Set() });
        this.emit({ k: 'shake', i: 0.5 });
      } else if (ab === 'leap') {
        const a = Math.atan2(tgt.z - z.z, tgt.x - z.x);
        z.state = 'leap';
        z.t = 0.6;
        z.leapHit = false;
        z.lvx = (Math.cos(a) * Math.min(14, dist)) / 0.6;
        z.lvz = (Math.sin(a) * Math.min(14, dist)) / 0.6;
      }
      return true;
    }
    if (z.state === 'leap') {
      z.t -= dt;
      moveCircle(this.world, this.sgrid, z, z.lvx * dt, z.lvz * dt, z.cr);
      if (z.t <= 0) {
        z.state = 'move';
        this.emit({ k: 'slam', x: z.x, z: z.z, r: 3.5 });
        for (const p of this.players) if (p.state === 'alive' && Math.hypot(p.x - z.x, p.z - z.z) < 3.5 + p.r) this.hurtPlayer(p, z.damage * 0.8);
      }
      return true;
    }
    if (z.state === 'attack') return false;
    // choose an ability
    const ok = (a) => {
      switch (a) {
        case 'charge': return dist > 5 && dist < 22 && z.los;
        case 'slam': return dist < 2 + def.scale;
        case 'throw': return dist > 6 && dist < 26 && z.los;
        case 'volley': return dist < 20 && z.los;
        case 'summon': return this.zombies.length < this.maxAlive + 12;
        case 'teleport': return dist > 9;
        case 'shockwave': return dist < 14;
        case 'leap': return dist > 5 && dist < 14 && z.los;
        case 'sweep': return dist < 5.5;
        case 'hook': return dist > 6 && dist < 17 && z.los;
        case 'bile': return dist < 11 && z.los;
        case 'devour': return z.hp < z.maxHp * 0.85 && this.minionsNear(z, 8).length >= 2;
        case 'barrage': return dist < 30;
        case 'rally': return this.minionsNear(z, 12).length >= 3;
        case 'eggs': return this.zombies.reduce((n, o) => n + (o.def.egg ? 1 : 0), 0) < 6;
        case 'mirror': return dist < 22 && !this.zombies.some((o) => o.def.clone);
        case 'drain': return dist < 10 && z.los;
      }
      return false;
    };
    for (const a of def.abilities) {
      if (z.cds[a] > 0 || !ok(a)) continue;
      z.cds[a] = BOSS_CD[a] * cdMult * (0.8 + this.rng() * 0.4);
      z.state = 'windup';
      z.pending = a;
      z.t = BOSS_WINDUP[a] ?? 0.6;
      if (enraged) z.t *= 0.7;
      z.ang = Math.atan2(tgt.z - z.z, tgt.x - z.x);
      this.emit({ k: 'tele', id: z.id, a, x: z.x, z: z.z, ang: z.ang, t: z.t });
      if (a === 'summon' || a === 'rally') this.emit({ k: 'sfx', s: 'roar', x: z.x, z: z.z });
      return true;
    }
    return false;
  }

  summonAround(z, sm) {
    const count = sm.count + Math.floor(this.n / 2);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sx = z.x + Math.cos(a) * (z.r + 2), sz = z.z + Math.sin(a) * (z.r + 2);
      if (!circleBlocked(this.world, this.sgrid, sx, sz, 0.45)) this.spawnZombie(sm.type, sx, sz);
    }
  }

  // regular zombies (not bosses or eggs) within r of z
  minionsNear(z, r) {
    const out = [];
    for (const o of this.zombies) {
      if (o === z || o.boss || o.mini || o.def.egg || o.state === 'rise') continue;
      if (dist2(o.x, o.z, z.x, z.z) < r * r) out.push(o);
    }
    return out;
  }

  // removes a zombie without a kill (no points, XP or drops)
  removeZombie(z) {
    z.dead = true;
    this.zombies.splice(this.zombies.indexOf(z), 1);
  }

  hatchEgg(egg) {
    const h = egg.def.egg;
    this.removeZombie(egg);
    this.emit({ k: 'hatch', x: egg.x, z: egg.z });
    for (let i = 0; i < h.count; i++) {
      const a = (i / h.count) * Math.PI * 2 + this.rng();
      let sx = egg.x + Math.cos(a) * 0.6, sz = egg.z + Math.sin(a) * 0.6;
      if (circleBlocked(this.world, this.sgrid, sx, sz, 0.4)) {
        sx = egg.x;
        sz = egg.z;
      }
      this.spawnZombie(h.type, sx, sz, false);
    }
  }

  // Harvester's hook: yank the player to just in front of the boss
  hookPull(pr, p) {
    const z = this.zombies.find((q) => q.id === pr.zid);
    if (!z || p.state !== 'alive') return;
    const dx = p.x - z.x, dz = p.z - z.z;
    const d = Math.hypot(dx, dz) || 1;
    const fromX = p.x, fromZ = p.z;
    // slide toward the boss and stop at the first spot that would be blocked
    let tx = p.x, tz = p.z;
    const stop = z.r + p.r + 0.6;
    for (let k = d; k >= stop; k -= 0.25) {
      const nx = z.x + (dx / d) * k, nz = z.z + (dz / d) * k;
      if (circleBlocked(this.world, this.sgrid, nx, nz, p.r)) break;
      tx = nx;
      tz = nz;
    }
    p.x = tx;
    p.z = tz;
    p.tp++;
    z.atkCd = Math.min(z.atkCd, 0.25);
    this.emit({ k: 'yank', x: fromX, z: fromZ, x2: tx, z2: tz, zx: z.x, zz: z.z });
  }

  // ------------------------------------------------------------ projectiles / hazards
  updateProjectiles(dt) {
    for (const pr of [...this.projs]) {
      pr.life -= dt;
      pr.vy -= pr.g * dt;
      const nx = pr.x + pr.vx * dt, nz = pr.z + pr.vz * dt;
      pr.y += pr.vy * dt;
      const cx = Math.floor(nx), cz = Math.floor(nz);
      const v = cx < 0 || cz < 0 || cx >= this.world.W || cz >= this.world.H ? 1 : this.world.grid[cz * this.world.W + cx];
      const hitWall = (v === 1 || v === 2) && pr.y < 3.5;
      let done = false;
      if (pr.kind === 'frag') {
        if (hitWall) {
          pr.vx *= -0.3;
          pr.vz *= -0.3;
        } else {
          pr.x = nx;
          pr.z = nz;
        }
        if (pr.y <= 0.15) {
          pr.y = 0.15;
          pr.vy = Math.abs(pr.vy) * 0.3;
          pr.vx *= 0.6;
          pr.vz *= 0.6;
        }
        if (pr.life <= 0) {
          this.explode(pr.x, pr.z, pr.splash, pr.dmg, { pid: pr.pid });
          done = true;
        }
      } else {
        if (hitWall || pr.life <= 0 || (pr.land && pr.y <= 0)) {
          if (pr.splash) this.explode(hitWall ? pr.x : nx, hitWall ? pr.z : nz, pr.splash, pr.dmg, pr.owner === 'z' ? { enemy: true } : { pid: pr.pid, kind: 'gunblast' });
          else if (pr.kind === 'spit') this.acidPuddle(pr.x, pr.z);
          done = true;
        } else {
          pr.x = nx;
          pr.z = nz;
          if (pr.owner === 'p' && !(pr.land && pr.y > 1)) {
            for (const z of this.zombies) {
              if (z.id === pr.lastHit || (z.state === 'rise' && z.t > 0.8)) continue;
              if (dist2(z.x, z.z, pr.x, pr.z) < (z.r + pr.r) * (z.r + pr.r)) {
                if (pr.splash) {
                  this.explode(pr.x, pr.z, pr.splash, pr.dmg, { pid: pr.pid, kind: 'gunblast' });
                  done = true;
                } else {
                  this.damageZombie(z, pr.dmg, pr.pid, 'bullet');
                  if (pr.kind === 'ray') this.emit({ k: 'rayhit', x: pr.x, z: pr.z, f: pr.forged || 0 });
                  pr.lastHit = z.id;
                  pr.dmg *= 0.85;
                  done = --pr.pierce <= 0;
                }
                break;
              }
            }
          } else if (!pr.land) {
            for (const p of this.players) {
              if (p.state !== 'alive') continue;
              if (dist2(p.x, p.z, pr.x, pr.z) < (p.r + pr.r) * (p.r + pr.r)) {
                if (pr.splash) this.explode(pr.x, pr.z, pr.splash, pr.dmg, { enemy: true });
                else {
                  this.hurtPlayer(p, pr.dmg);
                  if (pr.kind === 'spit') this.acidPuddle(pr.x, pr.z);
                  if (pr.kind === 'hook') this.hookPull(pr, p);
                }
                done = true;
                break;
              }
            }
            if (!done) {
              const sid = this.sgrid[cz * this.world.W + cx];
              const s = sid && this.structs.find((q) => q.id === sid);
              if (s) {
                this.damageStruct(s, pr.dmg * 2);
                done = true;
              }
            }
          }
        }
      }
      if (done) this.projs.splice(this.projs.indexOf(pr), 1);
    }
  }

  acidPuddle(x, z) {
    this.hazards.push({ id: this.nextId++, kind: 'acid', x, z, r: 1.3, t: 3, dps: 12 * this.diff.damage });
  }

  updateHazards(dt) {
    for (const h of [...this.hazards]) {
      h.t -= dt;
      if (h.t <= 0) {
        this.hazards.splice(this.hazards.indexOf(h), 1);
        continue;
      }
      if (h.kind === 'acid' || h.kind === 'fire') {
        for (const p of this.players) if (p.state === 'alive' && dist2(p.x, p.z, h.x, h.z) < h.r * h.r) {
          if (p.invuln <= 0) {
            p.hp -= h.dps * dt;
            p.lastHurt = this.time;
            if (p.hp <= 0) this.hurtPlayer(p, 1);
          }
        }
      } else if (h.kind === 'heal') {
        for (const p of this.players) if (p.state === 'alive' && dist2(p.x, p.z, h.x, h.z) < h.r * h.r) p.hp = Math.min(p.maxHp, p.hp + h.heal * dt);
        if (h.dmg) for (const z of [...this.zombies]) if (dist2(z.x, z.z, h.x, h.z) < h.r * h.r) this.damageZombie(z, h.dmg * dt, h.pid, 'zone');
      } else if (h.kind === 'napalm') {
        for (const z of [...this.zombies]) if (dist2(z.x, z.z, h.x, h.z) < h.r * h.r) this.damageZombie(z, h.dps * dt, h.pid, 'zone');
      } else if (h.kind === 'ring') {
        h.r += h.speed * dt;
        if (h.r > h.maxR) h.t = 0;
        for (const p of this.players) {
          if (p.state !== 'alive' || h.hit.has(p.id)) continue;
          const d = Math.hypot(p.x - h.x, p.z - h.z);
          if (Math.abs(d - h.r) < 0.6) {
            h.hit.add(p.id);
            this.hurtPlayer(p, h.dmg);
          }
        }
      }
    }
  }

  updateStrikes(dt) {
    for (const s of [...this.strikes]) {
      s.t -= dt;
      if (s.t > 0) continue;
      this.strikes.splice(this.strikes.indexOf(s), 1);
      this.explode(s.x, s.z, s.r, s.dmg, s.enemy ? { enemy: true } : { pid: s.pid });
      if (s.napalm) this.hazards.push({ id: this.nextId++, kind: 'napalm', x: s.x, z: s.z, r: 2, t: 4, dps: s.dmg * 0.15, pid: s.pid });
    }
  }

  // ------------------------------------------------------------ story
  startStep(i) {
    const step = this.story.steps[i];
    this.stepIdx = i;
    this.step = step;
    const ss = (this.ss = { t: 0 });
    const named = this.world.spots.named;
    const at = (name) => (named[name] && named[name][0]) || this.world.spots.playerSpawn[0];
    for (const d of step.openDoors || []) this.openDoor(d);
    if (step.type === 'collect') {
      const cands = this.rng.shuffle([...(named[step.spots] || [])]);
      ss.got = 0;
      ss.need = Math.min(step.count, cands.length);
      for (let k = 0; k < ss.need; k++) {
        this.pickups.push({ id: this.nextId++, kind: 'item', item: step.item, label: step.label, x: cands[k].x, z: cands[k].z });
      }
    } else if (step.type === 'activate') {
      ss.stations = step.spots.map((n) => ({ name: n, x: at(n).x, z: at(n).z, prog: 0, done: false }));
    } else if (step.type === 'survive') {
      ss.left = step.time;
    } else if (step.type === 'defend') {
      ss.left = step.time;
      ss.zone = { ...at(step.spot), r: step.radius };
      ss.inside = false;
    } else if (step.type === 'boss') {
      const sp = at(step.spot);
      ss.ids = [];
      for (let k = 0; k < (step.count || 1); k++) {
        const z = this.spawnZombie(step.zombie, sp.x + k * 3, sp.z);
        ss.ids.push(z.id);
      }
    } else if (step.type === 'extract') {
      ss.zone = { ...at(step.spot), r: step.radius };
      ss.hold = 0;
    }
    this.emit({ k: 'obj', s: step.text, i });
  }

  completeStep() {
    this.stepsDone++;
    for (const p of this.players) this.givePoints(p, 250);
    this.emit({ k: 'stepdone', i: this.stepIdx });
    if (this.stepIdx + 1 >= this.story.steps.length) {
      this.result = 'win';
      this.emit({ k: 'end', r: 'win' });
      return;
    }
    // every finished task pushes the next round, so the story can't be cheesed by
    // keeping one zombie alive in round 1
    this.startWave();
    this.startStep(this.stepIdx + 1);
  }

  collectItem(k, p) {
    this.emit({ k: 'sfx', s: 'item', x: k.x, z: k.z });
    this.emit({ k: 'note', p: -1, s: p.name + ' found a ' + k.label });
    if (this.step && this.step.type === 'collect') this.ss.got++;
    if (this.step && this.step.type === 'boss' && this.ss.dropped) this.ss.pickedDrop = true;
  }

  updateStory(dt) {
    const step = this.step, ss = this.ss;
    if (!step) return;
    ss.t += dt;
    switch (step.type) {
      case 'collect':
        if (ss.got >= ss.need) this.completeStep();
        break;
      case 'activate':
        for (const st of ss.stations) {
          if (!st.done && st.prog >= 1) {
            st.done = true;
            this.emit({ k: 'sfx', s: 'done', x: st.x, z: st.z });
            this.emit({ k: 'note', p: -1, s: step.label + ' — complete' });
          }
        }
        if (ss.stations.every((s) => s.done)) this.completeStep();
        break;
      case 'survive':
        ss.left -= dt;
        if (ss.left <= 0) this.completeStep();
        break;
      case 'defend':
        ss.inside = this.players.some((p) => p.state === 'alive' && dist2(p.x, p.z, ss.zone.x, ss.zone.z) < ss.zone.r * ss.zone.r);
        if (ss.inside) ss.left -= dt;
        if (ss.left <= 0) this.completeStep();
        break;
      case 'boss': {
        const alive = this.zombies.some((z) => ss.ids.includes(z.id));
        if (alive) break;
        if (step.drop) {
          if (!ss.dropped) {
            ss.dropped = true;
            const pos = this.lastBossPos || this.world.spots.playerSpawn[0];
            this.pickups.push({ id: this.nextId++, kind: 'item', item: step.drop.item, label: step.drop.label, x: pos.x, z: pos.z });
            this.emit({ k: 'obj', s: 'Grab the ' + step.drop.label + '!', i: this.stepIdx });
          }
          if (ss.pickedDrop) this.completeStep();
        } else {
          this.completeStep();
        }
        break;
      }
      case 'extract': {
        const alive = this.players.filter((p) => p.state === 'alive');
        const inZone = alive.length > 0 && alive.every((p) => dist2(p.x, p.z, ss.zone.x, ss.zone.z) < ss.zone.r * ss.zone.r);
        ss.hold = inZone ? ss.hold + dt : 0;
        if (ss.hold >= 3) this.completeStep();
        break;
      }
    }
  }

  objectiveView() {
    if (!this.story) {
      return { text: 'Endless Survival — hold out as long as you can.', prog: '', mk: [], zone: null, i: 0, n: 0 };
    }
    const step = this.step, ss = this.ss;
    const o = { text: step.text, prog: '', mk: [], zone: null, i: this.stepIdx, n: this.story.steps.length };
    if (step.type === 'collect') {
      o.prog = ss.got + ' / ' + ss.need;
      for (const k of this.pickups) if (k.kind === 'item') o.mk.push([k.x, k.z, 0]);
    } else if (step.type === 'activate') {
      o.prog = ss.stations.filter((s) => s.done).length + ' / ' + ss.stations.length;
      for (const s of ss.stations) if (!s.done) o.mk.push([s.x, s.z, 1, Math.round(s.prog * 100) / 100]);
    } else if (step.type === 'survive') {
      o.prog = Math.ceil(ss.left) + 's';
    } else if (step.type === 'defend') {
      o.prog = Math.ceil(ss.left) + 's' + (ss.inside ? '' : ' — get in the zone!');
      o.zone = [ss.zone.x, ss.zone.z, ss.zone.r];
    } else if (step.type === 'boss') {
      for (const z of this.zombies) if (ss.ids.includes(z.id)) o.mk.push([z.x, z.z, 2]);
      if (ss.dropped) for (const k of this.pickups) if (k.kind === 'item') o.mk.push([k.x, k.z, 0]);
    } else if (step.type === 'extract') {
      o.zone = [ss.zone.x, ss.zone.z, ss.zone.r];
      o.prog = ss.hold > 0 ? 'Extracting... ' + Math.ceil(3 - ss.hold) : 'All survivors must be in the zone';
    }
    return o;
  }

  // ------------------------------------------------------------ snapshot
  snapshot() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const bossList = [];
    for (const z of this.zombies) if ((z.boss || z.mini) && z.state !== 'rise') bossList.push([z.id, z.def.name, r2(z.hp / z.maxHp), z.boss ? 1 : 0]);
    return {
      t: r2(this.time),
      wave: this.wave,
      ws: this.waveState === 'break' ? 0 : 1,
      wt: Math.ceil(this.waveT),
      left: this.toSpawn + this.zombies.filter((z) => !z.boss && !z.mini).length,
      P: this.players.map((p) => ({
        id: p.id, n: p.name, c: p.char, l: p.lvl, x: r2(p.x), z: r2(p.z), a: r2(p.ang), hp: Math.ceil(p.hp), mh: p.maxHp,
        s: STATE_CODE[p.state], w: p.weapons.map((w) => (w ? [w.id, w.forged || 0, w.mag, w.reserve, w.forging > 0 ? 1 : 0, w.rarity || 0, this.wstat(p, w).mag, w.fkills || 0] : null)), cw: p.cur,
        xp: p.xp, xpn: xpForLevel(p.rank), rk: p.rank, chs: p.choices[0] || null, nch: p.choices.length, bo: p.boons,
        pts: p.points, k: p.kills, cd: r2(p.abilityCd), cdm: p.abilityMax || 1, ch: p.charges, chm: p.maxCharges, g: p.grenades,
        pk: Object.keys(p.perks), rl: p.reloadT > 0 ? r2(1 - p.reloadT / p.reloadMax) : -1, pr: p.prompt, pp: r2(p.promptProg),
        bl: r2(p.bleed), rv: r2(p.revive), st: r2(p.stamina), iv: p.invuln > 0 ? 1 : 0, mv: p.moving ? 1 : 0, sp: p.sprinting ? 1 : 0,
        tp: p.tp, er: p.earned, dn: p.downs, rvs: p.revives, sh: Math.ceil(p.shield),
      })),
      Z: this.zombies.map((z) => [
        z.id, ZTYPES.indexOf(z.type), r2(z.x), r2(z.z), r2(z.ang), r2(z.hp / z.maxHp),
        ZSTATE[z.stun > 0 ? 'stun' : z.state] ?? 1, r2(z.state === 'rise' ? z.t : 0), (z.burn > 0 ? 1 : 0) | (z.hurtT > 0 ? 2 : 0) | (z.buff > 0 ? 4 : 0) | (z.enraged ? 8 : 0) | (z.rally > 0 ? 16 : 0),
      ]),
      R: this.projs.map((p) => [p.id, p.kind, r2(p.x), r2(p.y), r2(p.z), p.kind === 'hook' ? p.zid : p.forged || 0]),
      S: this.structs.map((s) => ({
        id: s.id, k: s.kind, o: s.owner, x: r2(s.x), z: r2(s.z), c: s.cells, hp: r2(s.hp / s.maxHp), a: r2(s.ang || 0),
        l: s.lvl, sp: s.spikes ? 1 : 0, lf: s.kind === 'turret' ? r2(s.life / s.maxLife) : 1,
      })),
      I: this.pickups.map((k) => [k.id, k.kind, r2(k.x), r2(k.z), k.wid || k.pw || k.item || '', k.rarity || 0]),
      C: this.containers.map((c) => [c.full ? 1 : 0, r2(c.prog)]),
      D: this.world.doors.filter((d) => d.open).map((d) => d.id),
      B: [this.box.spot, this.box.state, this.box.wid, r2(this.box.t), this.box.user, this.box.rarity],
      H: this.hazards.map((h) => [h.id, h.kind, r2(h.x), r2(h.z), r2(h.r), r2(h.t)]),
      O: this.objectiveView(),
      PW: [r2(Math.max(0, this.instakill)), r2(Math.max(0, this.double))],
      BS: bossList,
      res: this.result,
      kills: this.totalKills,
      steps: this.stepsDone,
    };
  }
}
