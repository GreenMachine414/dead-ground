// Dijkstra flow field toward all living players. Zombies descend the distance field.
// Player-built structures are passable at a high cost so zombies path *to* them
// (and smash through) only when there is no better route.
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
// the same directions as flat arrays for the hot loop in compute()
const DX = Int8Array.from(DIRS, (d) => d[0]);
const DZ = Int8Array.from(DIRS, (d) => d[1]);
const DC = Float64Array.from(DIRS, (d) => d[2]);
const STRUCT_COST = 8;
// 1-cell gaps (a wall corner next to a prop) only fit small zombies: big ones would wedge there
// for good, so the field only routes through them when there is no reasonable way round
const NARROW_COST = 12;

export class FlowField {
  constructor(world) {
    this.world = world;
    const n = world.W * world.H;
    this.dist = new Float32Array(n).fill(Infinity); // the finished field zombies follow
    this.next = new Float32Array(n).fill(Infinity); // the one being built (see begin / run)
    this.heapIdx = new Int32Array(n * 4);
    this.heapVal = new Float32Array(n * 4);
    this.size = 0;
    this.busy = false;
    this.ready = false; // a field has been finished at least once
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

  // returns the cell with the smallest distance; its distance is left in this.topVal
  pop() {
    const hi = this.heapIdx, hv = this.heapVal;
    const top = hi[0];
    this.topVal = hv[0];
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

  // the whole field at once
  compute(sources, sgrid) {
    this.begin(sources, sgrid);
    this.run(Infinity);
  }

  // Start building a new field. run() advances it a slice at a time, so a rebuild is spread over
  // a few game ticks instead of stalling one; zombies keep following the last finished field.
  begin(sources, sgrid) {
    const { W, H } = this.world;
    const next = this.next;
    next.fill(Infinity);
    this.size = 0;
    this.sgrid = sgrid;
    for (const s of sources) {
      const cx = Math.floor(s.x), cz = Math.floor(s.z);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
      const i = cz * W + cx;
      next[i] = 0;
      this.push(i, 0);
    }
    this.busy = true;
  }

  // expand up to `budget` cells; true once the new field is finished and in use
  run(budget) {
    if (!this.busy) return true;
    const { W, H, grid } = this.world;
    const dist = this.next, sgrid = this.sgrid;
    const cap = this.heapIdx.length - 8;
    while (this.size > 0 && budget-- > 0) {
      const i = this.pop();
      const d = dist[i];
      // a cell is queued again each time its distance improves; skip the outdated copies
      if (this.topVal > d) continue;
      const cx = i % W, cz = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (grid[ni] !== 0) continue;
        if (k >= 4 && (grid[cz * W + nx] !== 0 || grid[nz * W + cx] !== 0)) continue;
        const narrow = (grid[ni - 1] !== 0 && grid[ni + 1] !== 0) || (grid[ni - W] !== 0 && grid[ni + W] !== 0);
        const nd = d + DC[k] + (sgrid[ni] !== 0 ? STRUCT_COST : 0) + (narrow ? NARROW_COST : 0);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          if (this.size < cap) this.push(ni, nd);
        }
      }
    }
    if (this.size > 0) return false;
    [this.dist, this.next] = [this.next, this.dist];
    this.busy = false;
    this.ready = true;
    return true;
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
