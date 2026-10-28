// Dijkstra flow field toward all living players. Zombies descend the distance field.
// Player-built structures are passable at a high cost so zombies path *to* them
// (and smash through) only when there is no better route.
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
const STRUCT_COST = 8;
// 1-cell gaps (a wall corner next to a prop) only fit small zombies: big ones would wedge there
// for good, so the field only routes through them when there is no reasonable way round
const NARROW_COST = 12;

export class FlowField {
  constructor(world) {
    this.world = world;
    const n = world.W * world.H;
    this.dist = new Float32Array(n).fill(Infinity);
    this.heapIdx = new Int32Array(n * 4);
    this.heapVal = new Float32Array(n * 4);
    this.size = 0;
  }

  push(i, v) {
    let k = this.size++;
    const hi = this.heapIdx, hv = this.heapVal;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hv[p] <= v) break;
      hi[k] = hi[p];
      hv[k] = hv[p];
      k = p;
    }
    hi[k] = i;
    hv[k] = v;
  }

  pop() {
    const hi = this.heapIdx, hv = this.heapVal;
    const top = hi[0];
    const last = --this.size;
    const li = hi[last], lv = hv[last];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= last) break;
      if (c + 1 < last && hv[c + 1] < hv[c]) c++;
      if (hv[c] >= lv) break;
      hi[k] = hi[c];
      hv[k] = hv[c];
      k = c;
    }
    hi[k] = li;
    hv[k] = lv;
    return top;
  }

  compute(sources, sgrid) {
    const { W, H, grid } = this.world;
    const dist = this.dist;
    dist.fill(Infinity);
    this.size = 0;
    for (const s of sources) {
      const cx = Math.floor(s.x), cz = Math.floor(s.z);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
      const i = cz * W + cx;
      dist[i] = 0;
      this.push(i, 0);
    }
    const cap = this.heapIdx.length - 8;
    while (this.size > 0) {
      const i = this.pop();
      const d = dist[i];
      const cx = i % W, cz = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DIRS[k][0], dz = DIRS[k][1];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (grid[ni] !== 0) continue;
        if (k >= 4 && (grid[cz * W + nx] !== 0 || grid[nz * W + cx] !== 0)) continue;
        const narrow = (grid[ni - 1] !== 0 && grid[ni + 1] !== 0) || (grid[ni - W] !== 0 && grid[ni + W] !== 0);
        const nd = d + DIRS[k][2] + (sgrid[ni] !== 0 ? STRUCT_COST : 0) + (narrow ? NARROW_COST : 0);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          if (this.size < cap) this.push(ni, nd);
        }
      }
    }
  }

  distAt(x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.world.W || cz >= this.world.H) return Infinity;
    return this.dist[cz * this.world.W + cx];
  }

  // Unit direction toward lower distance, or null if no information.
  dirAt(x, z) {
    const { W, H, grid } = this.world;
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return null;
    let best = this.dist[cz * W + cx];
    let bx = -1, bz = -1;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DIRS[k][0], nz = cz + DIRS[k][1];
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      if (k >= 4 && (grid[cz * W + nx] !== 0 || grid[nz * W + cx] !== 0)) continue;
      const d = this.dist[nz * W + nx];
      if (d < best) {
        best = d;
        bx = nx;
        bz = nz;
      }
    }
    if (bx < 0) return null;
    const tx = bx + 0.5 - x, tz = bz + 0.5 - z;
    const l = Math.hypot(tx, tz) || 1;
    return { x: tx / l, z: tz / l };
  }
}
