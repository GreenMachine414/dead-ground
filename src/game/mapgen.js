// Builds a deterministic world (collision grid + render description + named spots)
// from a map definition's build() function.
import { mulberry32 } from './rng.js';

export function createWorld(mapDef) {
  const [W, H] = mapDef.size;
  const world = {
    id: mapDef.id,
    W,
    H,
    grid: new Uint8Array(W * H),
    reserved: new Uint8Array(W * H),
    solids: [],
    decor: [],
    lights: [],
    doors: [],
    spots: { playerSpawn: [], box: [], perk: [], forge: null, zspawn: [], named: {}, loot: [] },
    theme: mapDef.theme,
  };
  const rng = mulberry32(mapDef.id * 7919 + 13);
  const ctx = makeCtx(world, rng);

  // hard map boundary
  for (let x = 0; x < W; x++) {
    world.grid[x] = 1;
    world.grid[(H - 1) * W + x] = 1;
  }
  for (let z = 0; z < H; z++) {
    world.grid[z * W] = 1;
    world.grid[z * W + W - 1] = 1;
  }

  mapDef.build(ctx);
  finalizeSpots(world, rng);
  return world;
}

function makeCtx(world, rng) {
  const { W, H, grid, reserved } = world;
  const inb = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
  const mark = (x, z, w, d, v) => {
    for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) if (inb(i, j)) grid[j * W + i] = v;
  };
  const ctx = {
    rng,
    W,
    H,
    theme: world.theme,
    solid(x, z, w, d, o = {}) {
      const low = !!o.low;
      mark(x, z, w, d, low ? 3 : 1);
      world.solids.push({ x, z, w, d, h: o.h ?? (low ? 1 : 3), kind: o.kind || 'box', color: o.color, low, ...o.extra });
    },
    block(x, z, w, d, o = {}) {
      ctx.solid(x, z, w, d, { kind: 'building', h: o.h ?? rng.range(2.2, 3.4), color: o.color, extra: { roof: o.roof } });
      ctx.reserve(x - 1, z - 1, w + 2, d + 2);
    },
    // Roofless building whose walls have gaps (doorways) per side, offsets along the side.
    building(x, z, w, d, o = {}) {
      const h = Math.min(o.h ?? 2.4, 2.8);
      const color = o.color;
      const gaps = o.gaps || {};
      const kind = o.kind || 'wall';
      const runs = (side, len, emit) => {
        let start = -1;
        for (let k = 0; k <= len; k++) {
          const inGap = k < len && (gaps[side] || []).some(([off, l]) => k >= off && k < off + l);
          const here = k < len && !inGap;
          if (here && start < 0) start = k;
          if (!here && start >= 0) {
            emit(start, k - start);
            start = -1;
          }
        }
      };
      runs('n', w, (s, l) => ctx.solid(x + s, z, l, 1, { h, color, kind }));
      runs('s', w, (s, l) => ctx.solid(x + s, z + d - 1, l, 1, { h, color, kind }));
      runs('w', d - 2, (s, l) => ctx.solid(x, z + 1 + s, 1, l, { h, color, kind }));
      runs('e', d - 2, (s, l) => ctx.solid(x + w - 1, z + 1 + s, 1, l, { h, color, kind }));
      world.decor.push({ kind: 'floor', x: x + 0.5, z: z + 0.5, w: w - 1, d: d - 1, color: o.floor });
      ctx.reserve(x - 1, z - 1, w + 2, d + 2);
    },
    // Axis-aligned straight wall line between two cells (inclusive)
    wall(x1, z1, x2, z2, o = {}) {
      const x = Math.min(x1, x2), z = Math.min(z1, z2);
      ctx.solid(x, z, Math.abs(x2 - x1) + 1, Math.abs(z2 - z1) + 1, { h: Math.min(o.h ?? 2.6, 2.8), color: o.color, kind: o.kind || 'wall', low: o.low });
      ctx.reserve(x - 1, z - 1, Math.abs(x2 - x1) + 3, Math.abs(z2 - z1) + 3);
    },
    fence(x1, z1, x2, z2, o = {}) {
      ctx.wall(x1, z1, x2, z2, { h: 1.1, kind: o.kind || 'fence', low: true, color: o.color });
    },
    tree(x, z, s = 1, variant) {
      if (!inb(x, z) || grid[z * W + x] !== 0) return false;
      ctx.solid(x, z, 1, 1, { kind: 'tree', h: 4, extra: { s, variant } });
      return true;
    },
    rock(x, z, w = 2, d = 2) {
      ctx.solid(x, z, w, d, { kind: 'rock', h: 1.4 });
    },
    car(x, z, horizontal = true, color) {
      const w = horizontal ? 4 : 2, d = horizontal ? 2 : 4;
      ctx.solid(x, z, w, d, { kind: 'car', h: 1.4, color: color ?? rng.pick([0x8a2020, 0x2a4a8a, 0x4a4a4a, 0xa0a0a0, 0x2a6a3a, 0xc0a040]), extra: { horizontal } });
    },
    crate(x, z) {
      ctx.solid(x, z, 1, 1, { kind: 'crate', h: 1, low: true });
    },
    barrel(x, z) {
      ctx.solid(x, z, 1, 1, { kind: 'barrel', h: 1.1, low: true });
    },
    water(x, z, w, d) {
      ctx.solid(x, z, w, d, { kind: 'water', h: 0.05, low: true });
      ctx.reserve(x - 1, z - 1, w + 2, d + 2);
    },
    decor(kind, x, z, o = {}) {
      world.decor.push({ kind, x, z, ...o });
    },
    light(x, z, color = 0xffd8a0, intensity = 30, distance = 14, y = 4) {
      world.lights.push({ x, z, color, intensity, distance, y });
    },
    reserve(x, z, w, d) {
      for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) if (inb(i, j)) reserved[j * W + i] = 1;
    },
    clear(x, z, w, d) {
      mark(x, z, w, d, 0);
    },
    free(x, z, w = 1, d = 1) {
      for (let j = z; j < z + d; j++) {
        for (let i = x; i < x + w; i++) {
          if (!inb(i, j) || grid[j * W + i] !== 0 || reserved[j * W + i]) return false;
        }
      }
      return true;
    },
    door(x, z, w, d, cost, label = 'Clear Debris') {
      mark(x, z, w, d, 2);
      world.doors.push({ id: world.doors.length, x, z, w, d, cost, label, open: false });
    },
    spot(type, x, z, extra) {
      const s = { x, z, ...extra };
      if (type === 'forge') world.spots.forge = s;
      else if (world.spots[type]) world.spots[type].push(s);
      else (world.spots.named[type] = world.spots.named[type] || []).push(s);
      ctx.reserve(Math.floor(x) - 1, Math.floor(z) - 1, 3, 3);
      return s;
    },
    // Searchable loot container. Props (rack/locker/crate/chest) occupy cell (x,z) and are
    // searched from the neighbouring cell on side `face`; body/toolbox lie on the ground.
    loot(kind, x, z, face = 's') {
      const off = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[face];
      const ground = kind === 'body' || kind === 'toolbox';
      if (!ground) mark(x, z, 1, 1, 3);
      const sx = ground ? x + 0.5 : x + 0.5 + off[0], sz = ground ? z + 0.5 : z + 0.5 + off[1];
      world.spots.loot.push({ kind, x: sx, z: sz, px: x, pz: z, face });
      ctx.reserve(x - 1, z - 1, 3, 3);
    },
    // a car whose trunk can be searched (trunk on the west / north end)
    lootCar(x, z, horizontal = true, color) {
      ctx.car(x, z, horizontal, color);
      if (horizontal) world.spots.loot.push({ kind: 'car', x: x - 0.5, z: z + 1, px: x, pz: z, face: 'w', car: true });
      else world.spots.loot.push({ kind: 'car', x: x + 1, z: z - 0.5, px: x, pz: z, face: 'n', car: true });
    },
    // organic elliptical pond (blocks movement, not bullets)
    pond(cx, cz, rx, rz) {
      for (let j = Math.floor(cz - rz); j <= Math.ceil(cz + rz); j++) {
        for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
          const dx = (i + 0.5 - cx) / rx, dz = (j + 0.5 - cz) / rz;
          if (dx * dx + dz * dz <= 1 && inb(i, j)) grid[j * W + i] = 3;
        }
      }
      world.decor.push({ kind: 'pond', x: cx, z: cz, rx, rz });
      ctx.reserve(Math.floor(cx - rx) - 1, Math.floor(cz - rz) - 1, Math.ceil(rx * 2) + 3, Math.ceil(rz * 2) + 3);
    },
    // winding path through points [[x,z],...]
    path(points, width = 2.4, style = 'dirt') {
      world.decor.push({ kind: 'trail', points, width, style });
    },
    bush(x, z) {
      if (!ctx.free(x, z)) return false;
      ctx.solid(x, z, 1, 1, { kind: 'bush', h: 0.8, low: true });
      return true;
    },
    flowers(x, z, r = 2) {
      world.decor.push({ kind: 'flowers', x, z, r });
    },
    campfire(x, z) {
      ctx.solid(x, z, 1, 1, { kind: 'campfire', h: 0.5, low: true });
      world.lights.push({ x: x + 0.5, z: z + 0.5, color: 0xffa040, intensity: 1, distance: 7, flicker: true });
      ctx.reserve(x - 1, z - 1, 3, 3);
    },
    lamp(x, z, color = 0xffd890) {
      ctx.solid(x, z, 1, 1, { kind: 'lamp', h: 2.5, low: true });
      world.lights.push({ x: x + 0.5, z: z + 0.5, color, intensity: 1, distance: 6 });
    },
    grave(x, z) {
      ctx.solid(x, z, 1, 1, { kind: 'grave', h: 0.8, low: true });
    },
    // Place `n` things at random free cells inside an area, using placer(x,z) -> bool
    scatter(n, placer, area = [1, 1, W - 2, H - 2], tries = n * 20) {
      let placed = 0;
      for (let t = 0; t < tries && placed < n; t++) {
        const x = Math.floor(area[0] + rng() * area[2]);
        const z = Math.floor(area[1] + rng() * area[3]);
        if (!ctx.free(x, z)) continue;
        if (placer(x, z) !== false) placed++;
      }
      return placed;
    },
    // Dense tree belt around the map edge
    forestBorder(thickness = 4, density = 0.55, fn) {
      const place = fn || ((x, z) => ctx.tree(x, z, 0.8 + rng() * 0.6));
      for (let z = 1; z < H - 1; z++) {
        for (let x = 1; x < W - 1; x++) {
          const edge = Math.min(x, z, W - 1 - x, H - 1 - z);
          if (edge > thickness) continue;
          const p = edge <= 1 ? 1 : density;
          if (rng() < p && ctx.free(x, z)) place(x, z);
        }
      }
    },
  };
  return ctx;
}

function nearestFree(world, x, z) {
  const { W, H, grid } = world;
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let r = 0; r < 12; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 1 || nz < 1 || nx >= W - 1 || nz >= H - 1) continue;
        if (grid[nz * W + nx] === 0) return r === 0 ? { x, z } : { x: nx + 0.5, z: nz + 0.5 };
      }
    }
  }
  return { x, z };
}

function finalizeSpots(world, rng) {
  const fix = (s) => {
    if (!s) return;
    const p = nearestFree(world, s.x, s.z);
    s.x = p.x;
    s.z = p.z;
  };
  const { spots } = world;
  [spots.playerSpawn, spots.box, spots.perk, spots.loot].forEach((list) => list.forEach(fix));
  fix(spots.forge);
  Object.values(spots.named).forEach((list) => list.forEach(fix));

  // Zombie spawn points: evenly spread free cells (they claw out of the ground anywhere)
  const { W, H, grid } = world;
  const step = 6;
  for (let z = 3; z < H - 3; z += step) {
    for (let x = 3; x < W - 3; x += step) {
      const px = x + Math.floor(rng() * step), pz = z + Math.floor(rng() * step);
      if (px >= W - 2 || pz >= H - 2) continue;
      if (grid[pz * W + px] !== 0) continue;
      // keep away from walls a bit
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (grid[(pz + j) * W + px + i] !== 0) ok = false;
      if (ok) spots.zspawn.push({ x: px + 0.5, z: pz + 0.5 });
    }
  }
}

// Random free cells for weapon pickups etc (per-game seed)
export function randomFreeCells(world, rng, n, avoid = [], minDist = 6) {
  const out = [];
  const { W, H, grid } = world;
  for (let t = 0; t < n * 80 && out.length < n; t++) {
    const x = 2 + Math.floor(rng() * (W - 4)), z = 2 + Math.floor(rng() * (H - 4));
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (grid[(z + j) * W + x + i] !== 0) ok = false;
    if (!ok) continue;
    const p = { x: x + 0.5, z: z + 0.5 };
    if (avoid.concat(out).some((a) => Math.hypot(a.x - p.x, a.z - p.z) < minDist)) continue;
    out.push(p);
  }
  return out;
}
