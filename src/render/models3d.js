// Building blocks for the 3D renderer (High graphics): shared unit shapes, the cartoon materials
// (3-step toon ramp, dark outlines, see-through cut-away), a builder that bakes the static world
// into a few merged meshes per map chunk, and instanced "parts" for everything that moves.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const OUTLINE = 0x1d1512;
const OUTLINE_W = 0.04; // world units
const CHUNK = 16; // static world is merged per CHUNK x CHUNK cells so off-screen parts are culled

// ------------------------------------------------------------------ shapes
// Unit shapes, centred on the origin (dome: base at the origin), position + normal only and
// non-indexed so any of them merge together.
function prep(g, flat) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (flat) n.computeVertexNormals();
  return n;
}
function prism() {
  // roof: ridge along x, 1 wide (z), 1 tall, from y -0.5 to 0.5
  const s = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0, 0.5)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(Math.PI / 2);
  return g;
}
export const GEO = {
  box: prep(new THREE.BoxGeometry(1, 1, 1)),
  rbox: prep(new RoundedBoxGeometry(1, 1, 1, 2, 0.14)),
  sphere: prep(new THREE.SphereGeometry(0.5, 16, 12)),
  cyl: prep(new THREE.CylinderGeometry(0.5, 0.5, 1, 14)),
  cone: prep(new THREE.ConeGeometry(0.5, 1, 12)),
  dome: prep(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
  ico: prep(new THREE.IcosahedronGeometry(0.5, 1), true),
  oct: prep(new THREE.OctahedronGeometry(0.5, 0), true),
  torus: prep(new THREE.TorusGeometry(0.5, 0.06, 8, 32)),
  prism: prep(prism(), true),
  frustum: prep(new THREE.CylinderGeometry(0.3, 0.5, 1, 12)),
};

// ------------------------------------------------------------------ materials
let ramp;
function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([90, 165, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

// Cut-away: fragments of the static world that sit between the camera and the local player
// (south of them and above the floor) are dithered out in a screen circle around the player, so
// walls, roofs and trees never hide them. uCut = (px x, px y, radius px), uCutZ = player z.
export const CUT = { uCut: { value: new THREE.Vector3(-1e5, -1e5, 1) }, uCutZ: { value: 1e5 } };
const CUT_FRAG = `
  if (vCutW.z > uCutZ && vCutW.y > 0.3) {
    float d = length(gl_FragCoord.xy - uCut.xy) / uCut.z;
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (d < 1.0 && smoothstep(0.6, 1.0, d) < n) discard;
  }`;
function cutaway(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uCut = CUT.uCut;
    sh.uniforms.uCutZ = CUT.uCutZ;
    sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\nvCutW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uCut;\nuniform float uCutZ;\nvarying vec3 vCutW;\n' + sh.fragmentShader.replace('void main() {', 'void main() {' + CUT_FRAG);
  };
  mat.customProgramCacheKey = () => 'cut' + (prev ? 'o' : '');
  return mat;
}

// Outline: back faces pushed out along the world-space normal (works for merged geometry and,
// via the instance matrix, for instanced parts at any scale).
function outlineMat() {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
      vec4 wp = vec4(transformed, 1.0);
      vec3 wn = normal;
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        wn = mat3(instanceMatrix) * wn;
      #endif
      wp = modelMatrix * wp;
      wp.xyz += normalize(wn) * ${OUTLINE_W.toFixed(3)};
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
}

export function makeMaterials() {
  const toon = cutaway(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }));
  const gloss = cutaway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 }));
  const glow = cutaway(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const line = cutaway(outlineMat());
  return {
    toon, gloss, glow, line,
    // instanced parts: lit cartoon, unlit glow (HDR colours bloom), additive light shafts
    pToon: new THREE.MeshToonMaterial({ gradientMap: toonRamp() }),
    pGloss: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }),
    pGlow: new THREE.MeshBasicMaterial({ toneMapped: false }),
    pAdd: new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    pLine: outlineMat(),
  };
}

// ------------------------------------------------------------------ colours
const colorCache = new Map();
// '#rrggbb' or 0xrrggbb -> THREE.Color (linear), optionally scaled for HDR glow; cached
export function col(c, k = 1) {
  const key = k === 1 ? c : c + '*' + k;
  let v = colorCache.get(key);
  if (!v) {
    v = new THREE.Color(c);
    if (k !== 1) v.multiplyScalar(k);
    colorCache.set(key, v);
  }
  return v;
}
export function shadeCol(c, amt) {
  const key = c + '~' + amt;
  let v = colorCache.get(key);
  if (!v) {
    v = new THREE.Color(c);
    if (amt > 0) v.lerp(new THREE.Color(1, 1, 1), amt);
    else v.multiplyScalar(1 + amt);
    colorCache.set(key, v);
  }
  return v;
}

// ------------------------------------------------------------------ static world
// rotations apply roll, then pitch, then yaw (so a wheel tilted onto its side still turns with the car)
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _n = new THREE.Matrix3(), _v = new THREE.Vector3();
const LAYERS = ['toon', 'gloss', 'glow'];

// Collects transformed copies of the unit shapes and merges them per (chunk, layer) at the end:
// the whole static map becomes a handful of draw calls, and chunks off screen are culled.
export class StaticBuilder {
  constructor(W, H) {
    this.cols = Math.ceil(W / CHUNK);
    this.rows = Math.ceil(H / CHUNK);
    this.items = new Map(); // chunk key -> { toon: [], gloss: [], glow: [], line: [] }
  }

  // shape `geo` at (x, y, z), scaled (sx, sy, sz), rotated (rx, ry, rz); layer toon | gloss | glow
  add(geo, layer, color, x, y, z, sx, sy, sz, ry = 0, outline = false, rx = 0, rz = 0) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / CHUNK))), cz = Math.max(0, Math.min(this.rows - 1, Math.floor(z / CHUNK)));
    const key = cz * this.cols + cx;
    let b = this.items.get(key);
    if (!b) this.items.set(key, (b = { toon: [], gloss: [], glow: [], line: [] }));
    const it = { geo, m, color };
    b[layer].push(it);
    if (outline) b.line.push(it);
  }

  // merged meshes added to `parent`
  build(parent, mats) {
    for (const b of this.items.values()) {
      for (const layer of [...LAYERS, 'line']) {
        const list = b[layer];
        if (!list.length) continue;
        let n = 0;
        for (const it of list) n += it.geo.attributes.position.count;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), colr = layer === 'line' ? null : new Float32Array(n * 3);
        let o = 0;
        for (const it of list) {
          const P = it.geo.attributes.position.array, N = it.geo.attributes.normal.array;
          _n.getNormalMatrix(it.m);
          const c = it.color;
          for (let i = 0; i < P.length; i += 3, o += 3) {
            _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(it.m);
            pos[o] = _v.x;
            pos[o + 1] = _v.y;
            pos[o + 2] = _v.z;
            _v.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_n).normalize();
            nor[o] = _v.x;
            nor[o + 1] = _v.y;
            nor[o + 2] = _v.z;
            if (colr) {
              colr[o] = c.r;
              colr[o + 1] = c.g;
              colr[o + 2] = c.b;
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        if (colr) g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mats[layer]);
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = layer === 'toon' || layer === 'gloss';
        mesh.receiveShadow = layer !== 'glow' && layer !== 'line';
        parent.add(mesh);
      }
    }
    this.items.clear();
  }
}

// ------------------------------------------------------------------ dynamic parts
// One InstancedMesh per (shape, material); every frame the renderer writes the parts it needs
// and flush() uploads them. Capacity doubles when a frame needs more.
class Inst {
  constructor(parent, geo, mat, shadow, line) {
    this.parent = parent;
    this.geo = geo;
    this.mat = mat;
    this.shadow = shadow;
    this.lineMat = line;
    this.n = 0;
    this.ln = 0;
    this.alloc(64);
  }

  alloc(cap) {
    const old = this.mesh, oldLine = this.line;
    this.cap = cap;
    this.mesh = this.make(this.mat, cap, true);
    if (this.lineMat) {
      this.line = this.make(this.lineMat, cap, false);
      if (oldLine) {
        this.line.instanceMatrix.array.set(oldLine.instanceMatrix.array.subarray(0, this.ln * 16));
        this.disposeMesh(oldLine);
      }
    }
    if (old) {
      this.mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.n * 16));
      this.mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, this.n * 3));
      this.disposeMesh(old);
    }
  }

  make(mat, cap, colored) {
    const m = new THREE.InstancedMesh(this.geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colored) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.frustumCulled = false;
    m.castShadow = colored && this.shadow;
    m.receiveShadow = colored && mat.type !== 'MeshBasicMaterial';
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  disposeMesh(m) {
    this.parent.remove(m);
    m.dispose();
  }

  push(mat4, color, outline) {
    if (this.n >= this.cap || (outline && this.ln >= this.cap)) this.alloc(this.cap * 2);
    mat4.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    const c = this.mesh.instanceColor.array, k = this.n * 3;
    c[k] = color.r;
    c[k + 1] = color.g;
    c[k + 2] = color.b;
    this.n++;
    if (outline && this.line) mat4.toArray(this.line.instanceMatrix.array, this.ln++ * 16);
  }

  flush() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.line) this.line.visible = this.ln > 0;
    if (this.n) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, this.n * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, this.n * 3);
      m.instanceColor.needsUpdate = true;
    }
    if (this.line) {
      this.line.count = this.ln;
      if (this.ln) {
        this.line.instanceMatrix.clearUpdateRanges();
        this.line.instanceMatrix.addUpdateRange(0, this.ln * 16);
        this.line.instanceMatrix.needsUpdate = true;
      }
    }
    this.n = 0;
    this.ln = 0;
  }

  dispose() {
    this.disposeMesh(this.mesh);
    if (this.line) this.disposeMesh(this.line);
  }
}

const _R = new THREE.Matrix4(), _L = new THREE.Matrix4(), _W = new THREE.Matrix4();
const _rq = new THREE.Quaternion(), _ry = new THREE.Vector3(0, 1, 0);

// Per-frame part writer. root() sets the frame of the thing being drawn (position, facing,
// scale, optional lying-down tilt); put() adds a shape in that frame.
export class Parts {
  constructor(parent, mats) {
    this.parent = parent;
    this.mats = mats;
    this.inst = new Map();
    // every (shape, material) the renderer uses, made up front so their shaders compile at load
    for (const k of ['rbox', 'sphere', 'cyl', 'cone', 'dome', 'torus', 'box', 'ico', 'oct']) this.get(k, 'toon');
    for (const k of ['rbox', 'sphere', 'cyl', 'box']) this.get(k, 'gloss');
    for (const k of ['sphere', 'cyl', 'cone', 'box', 'oct', 'torus', 'rbox']) this.get(k, 'glow');
    for (const k of ['cyl', 'sphere', 'torus']) this.get(k, 'add');
  }

  get(shape, mat) {
    const key = shape + mat;
    let i = this.inst.get(key);
    if (!i) {
      const m = mat === 'toon' ? this.mats.pToon : mat === 'gloss' ? this.mats.pGloss : mat === 'glow' ? this.mats.pGlow : this.mats.pAdd;
      i = new Inst(this.parent, GEO[shape], m, mat === 'toon' || mat === 'gloss', mat === 'toon' || mat === 'gloss' ? this.mats.pLine : null);
      this.inst.set(key, i);
    }
    return i;
  }

  // frame at (x, y, z) facing yaw (local +z forward), uniform scale s; lie tilts it onto its back
  root(x, y, z, yaw, s = 1, lie = 0, roll = 0) {
    _rq.setFromAxisAngle(_ry, yaw);
    _R.compose(_p.set(x, y, z), _rq, _s.set(s, s, s));
    if (lie || roll) {
      _e.set(-lie, 0, roll);
      _L.makeRotationFromEuler(_e);
      _R.multiply(_L);
    }
    return this;
  }

  // shape in the current root frame
  put(shape, mat, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, outline = false) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _L.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _W.multiplyMatrices(_R, _L);
    this.get(shape, mat).push(_W, color, outline);
  }

  // shape placed directly in world space
  world(shape, mat, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, outline = false) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _W.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.get(shape, mat).push(_W, color, outline);
  }

  // a cylinder from (x1, y1, z1) to (x2, y2, z2), radius r
  segment(mat, color, x1, y1, z1, x2, y2, z2, r) {
    _v.set(x2 - x1, y2 - y1, z2 - z1);
    const len = _v.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(_ry, _v.divideScalar(len));
    _W.compose(_p.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2), _q, _s.set(r * 2, len, r * 2));
    this.get('cyl', mat).push(_W, color, false);
  }

  flush() {
    for (const i of this.inst.values()) i.flush();
  }

  dispose() {
    for (const i of this.inst.values()) i.dispose();
    this.inst.clear();
  }
}
