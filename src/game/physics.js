// Grid based collision helpers. Grid cell values:
//   0 = free, 1 = solid (blocks movement + bullets), 2 = closed door (blocks both),
//   3 = low obstacle (blocks movement only: fences, water, sandbags)
// `sgrid` is an optional Int32Array of player-built structure ids (non-zero = blocked).

export function cellBlocked(world, sgrid, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= world.W || cz >= world.H) return true;
  const i = cz * world.W + cx;
  return world.grid[i] !== 0 || (sgrid !== null && sgrid !== undefined && sgrid[i] !== 0);
}

export function bulletBlocked(world, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= world.W || cz >= world.H) return true;
  const v = world.grid[cz * world.W + cx];
  return v === 1 || v === 2;
}

export function circleBlocked(world, sgrid, x, z, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r);
  const r2 = r * r;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!cellBlocked(world, sgrid, cx, cz)) continue;
      const nx = x < cx ? cx : x > cx + 1 ? cx + 1 : x;
      const nz = z < cz ? cz : z > cz + 1 ? cz + 1 : z;
      const dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
}

// Moves an entity {x,z} by (dx,dz) with axis-separated sliding. Returns fraction of
// the intended distance actually travelled (0..1).
export function moveCircle(world, sgrid, ent, dx, dz, r) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 1;
  const steps = Math.max(1, Math.ceil(len / 0.2));
  const sx = dx / steps, sz = dz / steps;
  const ox = ent.x, oz = ent.z;
  for (let s = 0; s < steps; s++) {
    if (sx !== 0 && !circleBlocked(world, sgrid, ent.x + sx, ent.z, r)) ent.x += sx;
    if (sz !== 0 && !circleBlocked(world, sgrid, ent.x, ent.z + sz, r)) ent.z += sz;
  }
  return Math.hypot(ent.x - ox, ent.z - oz) / len;
}

// Distance along the ray until a bullet-blocking cell is hit (DDA traversal).
export function rayGrid(world, x, z, dx, dz, maxDist) {
  let cx = Math.floor(x), cz = Math.floor(z);
  if (bulletBlocked(world, cx, cz)) return 0;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx) * tDeltaX : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - z : z - cz) * tDeltaZ : Infinity;
  let t = 0;
  while (t < maxDist) {
    if (tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      cz += stepZ;
    }
    if (t >= maxDist) return maxDist;
    if (bulletBlocked(world, cx, cz)) return t;
  }
  return maxDist;
}

export function hasLOS(world, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  return rayGrid(world, x1, z1, dx / d, dz / d, d) >= d - 0.01;
}

// True if a circle of radius r can slide straight from (x1,z1) to (x2,z2).
export function clearPath(world, sgrid, x1, z1, x2, z2, r) {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.ceil(d / 0.35);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (circleBlocked(world, sgrid, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, r)) return false;
  }
  return true;
}

// Ray vs circle: returns distance along ray or -1.
export function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t < 0 ? -1 : t;
}

// Cells occupied by a player-built wall centred at (cx,cz).
export function wallCells(cx, cz, horizontal, length) {
  const cells = [];
  const half = Math.floor(length / 2);
  const bx = Math.floor(cx), bz = Math.floor(cz);
  for (let k = -half; k <= half; k++) {
    cells.push(horizontal ? [bx + k, bz] : [bx, bz + k]);
  }
  return cells;
}
