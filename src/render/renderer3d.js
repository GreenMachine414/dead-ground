// High graphics: the same game drawn in real-time 3D with three.js. Everything that isn't drawing
// (interpolating snapshots, events, particles, labels, objective pointers) is inherited from the 2D
// Renderer. The world, characters, lights, shadows, rain and glow are rendered in WebGL, under a
// transparent 2D canvas that keeps the 2D renderer's labels, damage numbers and pointers. Ground
// marks (blood, hazards, boss telegraphs, objective zones) are drawn by the 2D code onto a canvas
// that is laid on the 3D ground, so they stay exactly as readable as in 2D.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Renderer, FORGE_FX, PROJ, KNIFE_TIME, KNIFE_ARC } from './renderer.js';
import { makeMaterials, StaticBuilder, Parts, CUT, col, shadeCol } from './models3d.js';
import { buildWorld } from './world3d.js';
import { drawPerson, drawExtras, drawGun, gunLength, MODEL, GUN_Y } from './rig3d.js';
import { PX } from './groundpaint.js';
import * as S from './sprites.js';
import { WEAPONS, RARITY } from '../data/weapons.js';
import { PERKS, POWERUPS } from '../data/zombies.js';
import { CONTAINERS } from '../data/loot.js';
import { WIDS } from '../game/sim.js';

const FOV = 38; // degrees, vertical
const PITCH = (55 * Math.PI) / 180; // camera tilt above the horizon
const H3 = 0.75; // the 2D renderer's height units -> world height (particles, labels, projectiles)
const AIM_Y = 0.9; // the mouse aims at this height, like aiming at a zombie's body
const MUZZLE_Y = GUN_Y * MODEL; // the drawn gun's height (people are scaled by MODEL); tracers start here
const MAX_LIGHTS = 8; // dynamic point lights (muzzle flashes, explosions, lamps, fires)
const GROUND_PX = 14; // ground-mark texels per world unit at full quality
const SUN_DIR = new THREE.Vector3(-0.45, 1, -0.32).normalize();
const SHOP_CARDS = ['#f0a83a', '#6fd36a', '#5ab8e8'];
const HALF_PI = Math.PI / 2;
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

const PARTICLE_VS = `
attribute float aSize;
attribute vec4 aCol;
uniform float uScale;
varying vec4 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vCol = aCol;
}`;
const PARTICLE_FS = `
varying vec4 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - d * d));
}`;
const RAIN_VS = `
attribute float aTail;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uSize;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 22.0, uSize.y);
  p.x = uCenter.x + mod(p.x - uCenter.x + uTime * 1.6, uSize.x) - uSize.x * 0.5;
  p.z = uCenter.z + mod(p.z - uCenter.z, uSize.z) - uSize.z * 0.5;
  p += aTail * vec3(0.07, 0.8, 0.035);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FS = `void main() { gl_FragColor = vec4(0.62, 0.72, 0.88, 0.32); }`;
const SNOW_VS = `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uSize;
uniform float uScale;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 1.3, uSize.y);
  p.x = uCenter.x + mod(p.x - uCenter.x + uTime * 0.5 + sin(uTime * 0.9 + position.z) * 0.6, uSize.x) - uSize.x * 0.5;
  p.z = uCenter.z + mod(p.z - uCenter.z, uSize.z) - uSize.z * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = min(6.0, 0.075 * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FS = `void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, 0.85); }`;

// can this machine run the 3D renderer at all? (creates the shared context; answered once)
let glOK;
export function webglOK() {
  if (glOK === undefined) {
    try {
      glOK = getGL().capabilities.isWebGL2;
    } catch (err) {
      console.error(err);
      glOK = false;
    }
  }
  return glOK;
}

// One WebGL context for the whole app (menu backdrop, game, portraits): every shader compiles
// once, and switching between the menu and a game never creates a new context
let sharedGL = null, sharedEnv = null;
export function getGL() {
  if (sharedGL) return sharedGL;
  const gl = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.05;
  const el = gl.domElement;
  el.className = 'game-canvas';
  Object.assign(el.style, { position: 'absolute', left: '0', top: '0' });
  const pm = new THREE.PMREMGenerator(gl);
  sharedEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return (sharedGL = gl);
}

export class Renderer3D extends Renderer {
  constructor(container) {
    super(container);
    this.is3D = true;
    this.muzzleH = MUZZLE_Y / H3;
    const gl = (this.gl = getGL());
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0' });
    this.ctx2d = this.ctx;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
    this.mats = makeMaterials();
    this.dyn = new THREE.Group();
    this.scene.add(this.dyn);
    this.parts = new Parts(this.dyn, this.mats);
    this.tc = new THREE.Color();
    this.pv = new THREE.Vector3();
    this.oq = []; // overlay jobs (icons, bars) queued while syncing, drawn on the 2D canvas
    this.lookCache = new Map();

    // light
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.pool = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      this.pool.push(l);
      this.scene.add(l);
    }
    this.cand = [];
    for (let i = 0; i < 160; i++) this.cand.push({ x: 0, y: 0, z: 0, c: '#ffffff', i: 0, d: 0, s: 0 });
    this.scene.environment = sharedEnv;
    this.scene.environmentIntensity = 0.35;

    this.makeParticles();

    // ground marks layer
    this.gCanvas = document.createElement('canvas');
    // a CPU-backed canvas: uploading it to the GPU each frame is a plain copy, where a
    // GPU canvas would first have to be read back (very slow on integrated graphics)
    this.gCtx = this.gCanvas.getContext('2d', { willReadFrequently: true });
    // Uploaded exactly as the canvas stores it (top row first, premultiplied alpha, plain RGBA8):
    // that is a straight copy, where flipping, alpha or sRGB-format conversion made each frame's
    // upload cost ~15 ms on integrated graphics. The shader decodes sRGB itself and the plane's
    // texture coordinates are flipped instead.
    this.gTex = new THREE.CanvasTexture(this.gCanvas);
    this.gTex.colorSpace = THREE.NoColorSpace;
    this.gTex.generateMipmaps = false;
    this.gTex.minFilter = THREE.LinearFilter;
    this.gTex.flipY = false;
    this.gTex.premultiplyAlpha = true;
    this.plane = new THREE.PlaneGeometry(1, 1).rotateX(-HALF_PI);
    this.gPlane = this.plane.clone();
    const uv = this.gPlane.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const gMat = new THREE.MeshBasicMaterial({ map: this.gTex, transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    gMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        vec3 c = texel.a > 0.0 ? texel.rgb / texel.a : vec3(0.0);
        diffuseColor *= vec4(pow(c, vec3(2.2)), texel.a);`);
    };
    this.gMesh = new THREE.Mesh(this.gPlane, gMat);
    this.gMesh.renderOrder = 1;
    this.gMesh.frustumCulled = false;
    this.scene.add(this.gMesh);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(gl, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 0.95);
    this.bloomLevel = 0.5;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.ready3D = true;
    this.attach();
  }

  // the Bloom slider (0..1, 0.5 = the default look); at 0 the bloom pass is skipped entirely
  setBloom(v) {
    this.bloomLevel = Math.max(0, Math.min(1, v ?? 0.5));
    this.bloom.strength = this.bloomLevel * 1.1;
    this.bloom.enabled = this.quality >= 0.8 && this.bloomLevel > 0.01;
  }

  // the shared canvas moves to whichever renderer is drawing (menu backdrop or game)
  attach() {
    const el = this.gl.domElement;
    if (el.parentNode !== this.container) this.container.insertBefore(el, this.canvas);
    this.resize();
  }

  resize() {
    super.resize();
    if (!this.ready3D) return;
    const gl = this.gl;
    if (gl.domElement.parentNode === this.container) {
      gl.setPixelRatio(this.dpr);
      gl.setSize(this.width, this.height, false);
      gl.domElement.style.width = this.width + 'px';
      gl.domElement.style.height = this.height + 'px';
    }
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.bufH = Math.round(this.height * this.dpr);
    this.uScale.value = this.bufH / Math.tan((FOV * Math.PI) / 360);
    // bloom is a full-screen cost: drop it once the auto-quality has had to lower the resolution
    this.bloom.enabled = this.quality >= 0.8 && this.bloomLevel > 0.01;
  }

  dispose() {
    super.dispose();
    this.clearWorld();
    this.parts.dispose();
    for (const p of this.pts) {
      p.geometry.dispose();
      p.material.dispose();
    }
    this.gTex.dispose();
    this.gMesh.material.dispose();
    this.plane.dispose();
    this.gPlane.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose();
    // the shared context stays (the menu backdrop uses it next); only this renderer's things go
    if (this.gl.domElement.parentNode === this.container) this.gl.domElement.remove();
  }

  // the 2D drawing code reads these; while it paints the ground layer they map the world onto it
  get u() {
    return this.gMode ? this.gU : super.u;
  }
  sx(x) {
    return this.gMode ? (x - this.gx0) * this.gU : super.sx(x);
  }
  sy(z) {
    return this.gMode ? (z - this.gz0) * this.gU : super.sy(z);
  }

  // world point -> overlay canvas pixels (reused array)
  proj(x, y, z) {
    const v = this.pv.set(x, y, z).project(this.camera);
    const o = this.scr || (this.scr = [0, 0]);
    o[0] = (v.x * 0.5 + 0.5) * this.canvas.width;
    o[1] = (0.5 - v.y * 0.5) * this.canvas.height;
    return o;
  }
  toScreen(x, z, h) {
    return this.proj(x, h * H3, z);
  }

  groundPoint(mx, my) {
    if (!this.camReady) return super.groundPoint(mx, my);
    const c = this.camera.position;
    const v = this.pv.set((mx / this.width) * 2 - 1, 1 - (my / this.height) * 2, 0.5).unproject(this.camera).sub(c);
    const t = (AIM_Y - c.y) / v.y;
    return { x: c.x + v.x * t, z: c.z + v.z * t };
  }

  // ---------------------------------------------------------------- world
  loadWorld(world, map) {
    super.loadWorld(world, map);
    this.clearWorld();
    const th = this.theme;
    const g = (this.worldGroup = new THREE.Group());
    this.scene.add(g);
    // painted ground, one textured tile per 2D ground tile
    // (plain RGBA8 textures decoded in the shader upload fast; all of them are uploaded here at
    // load rather than the first time each one comes into view, which would stutter)
    const T = 512 / PX, wet = th.particles === 'rain';
    const aniso = Math.min(8, this.gl.capabilities.getMaxAnisotropy());
    const decode = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 texel = texture2D(map, vMapUv);\ndiffuseColor *= vec4(pow(texel.rgb, vec3(2.2)), 1.0);');
    };
    for (const t of this.tiles) {
      const tex = new THREE.CanvasTexture(t.canvas);
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = aniso;
      const mat = wet ? new THREE.MeshPhongMaterial({ map: tex, shininess: 70, specular: 0x30363e }) : new THREE.MeshLambertMaterial({ map: tex });
      mat.onBeforeCompile = decode;
      this.gl.initTexture(tex);
      const m = new THREE.Mesh(this.plane, mat);
      const w = t.canvas.width / PX, h = t.canvas.height / PX;
      m.scale.set(w, 1, h);
      m.position.set(t.tx * T + w / 2, 0, t.ty * T + h / 2);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      g.add(m);
    }
    const outer = new THREE.Mesh(this.plane, new THREE.MeshLambertMaterial({ color: col(S.shade(th.ground, -0.35)) }));
    outer.scale.set(world.W + 400, 1, world.H + 400);
    outer.position.set(world.W / 2, -0.02, world.H / 2);
    outer.receiveShadow = true;
    g.add(outer);
    // everything solid, merged per chunk
    const B = new StaticBuilder(world.W, world.H);
    this.anim = buildWorld(B, world, th, this.statics, g);
    B.build(g, this.mats);
    // water surfaces catch the lights
    const water = new THREE.MeshPhongMaterial({ color: col(th.water), transparent: true, opacity: 0.55, shininess: 90, specular: 0x666666, depthWrite: false });
    const circle = new THREE.CircleGeometry(1, 40).rotateX(-HALF_PI);
    for (const s of world.solids) {
      if (s.kind !== 'water') continue;
      const m = new THREE.Mesh(this.plane, water);
      m.scale.set(s.w, 1, s.d);
      m.position.set(s.x + s.w / 2, 0.03, s.z + s.d / 2);
      g.add(m);
    }
    for (const d of world.decor) {
      if (d.kind !== 'pond') continue;
      const m = new THREE.Mesh(circle, water);
      m.scale.set(d.rx, 1, d.rz);
      m.position.set(d.x, 0.03, d.z);
      g.add(m);
    }
    // steady glows of the machines, offered to the light pool each frame
    this.machineLights = [];
    for (const o of this.statics) {
      if (o.k === 'perk') this.machineLights.push([o.x, 1.4, o.z + 0.6, S.hex(PERKS[o.perk].color), 3, 4]);
      else if (o.k === 'forge') this.machineLights.push([o.x, 1, o.z + 0.4, '#ff8a3a', 5, 4.5]);
      else if (o.k === 'shop') this.machineLights.push([o.x, 1.6, o.z + 0.6, '#b07cff', 4, 4.5]);
    }
    this.applyTheme(th);
    this.makeWeather(th.particles);
    this.warmUp(world);
  }

  // Compile every shader (and the shadow / bloom passes) while the map loads, instead of
  // stalling the first seconds of play
  warmUp(world) {
    for (const i of this.parts.inst.values()) {
      i.mesh.visible = true;
      if (i.line) i.line.visible = true;
    }
    const sp = world.spots.playerSpawn[0] || { x: world.W / 2, z: world.H / 2 };
    this.cam.x = sp.x;
    this.cam.z = sp.z;
    this.updateCamera();
    this.gl.compile(this.scene, this.camera);
    this.composer.render();
    this.parts.flush();
    this.camReady = false;
  }

  clearWorld() {
    const dispose = (o) => {
      o.traverse((m) => {
        if (m.geometry && m.geometry !== this.plane) m.geometry.dispose();
        if (m.material) {
          if (m.material.map) m.material.map.dispose();
          if (!Object.values(this.mats).includes(m.material)) m.material.dispose();
        }
      });
      this.scene.remove(o);
    };
    if (this.worldGroup) dispose(this.worldGroup);
    if (this.weather) dispose(this.weather);
    this.worldGroup = this.weather = null;
  }

  applyTheme(th) {
    const night = Math.min(1, (th.dark || 0) / 0.55);
    this.night = night;
    const lerp = (a, b, t) => this.tc.set(a).lerp(col(b), t).clone();
    this.hemi.color.copy(lerp('#e4efff', '#5c74a8', night));
    this.hemi.groundColor.copy(shadeCol(th.ground, -0.45));
    this.hemi.intensity = 1.25 - 0.4 * night;
    this.sun.color.copy(lerp('#fff1da', '#9db4ff', night));
    this.sun.intensity = 2.1 - 0.95 * night;
    const fog = lerp(S.shade(th.ground, 0.25), '#121a2a', Math.min(1, night * 1.3));
    this.scene.fog = new THREE.FogExp2(fog, 0.005 + 0.012 * night);
    this.scene.background = fog;
    this.gMesh.material.color.setScalar(1 - 0.25 * night);
  }

  makeWeather(kind) {
    if (kind !== 'rain' && kind !== 'snow') return;
    const size = new THREE.Vector3(80, 13, 64); // below the camera, so no flake passes right in front of it
    const N = kind === 'rain' ? 2600 : 1800;
    const geo = new THREE.BufferGeometry();
    const per = kind === 'rain' ? 2 : 1;
    const pos = new Float32Array(N * per * 3), tail = new Float32Array(N * per);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * size.x, y = Math.random() * size.y, z = Math.random() * size.z;
      for (let k = 0; k < per; k++) {
        pos.set([x, y, z], (i * per + k) * 3);
        tail[i * per + k] = k;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (kind === 'rain') geo.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    this.wU = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: size }, uScale: this.uScale };
    const mat = new THREE.ShaderMaterial({ uniforms: this.wU, vertexShader: kind === 'rain' ? RAIN_VS : SNOW_VS, fragmentShader: kind === 'rain' ? RAIN_FS : SNOW_FS, transparent: true, depthWrite: false });
    const obj = kind === 'rain' ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = 6;
    this.weather = obj;
    this.scene.add(obj);
  }

  makeParticles() {
    this.uScale = { value: 1000 };
    this.pts = [];
    for (const glow of [false, true]) {
      const N = 2000;
      const g = new THREE.BufferGeometry();
      for (const [name, n] of [['position', 3], ['aCol', 4], ['aSize', 1]]) {
        const a = new THREE.BufferAttribute(new Float32Array(N * n), n);
        a.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(name, a);
      }
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({ uniforms: { uScale: this.uScale }, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = 5;
      this.pts.push(p);
      this.scene.add(p);
    }
  }

  // rain and snow fall in 3D; other ambient motes stay particles, plus splashes when it rains
  // the 3D gun's grip sits 0.46 ahead of the body and its barrel ends 70% of its length past that
  muzzleD(wid) {
    return (0.46 + 0.7 * gunLength(wid)) * MODEL;
  }

  ambient(dt) {
    const kind = this.theme.particles;
    if (kind !== 'rain' && kind !== 'snow') return super.ambient(dt);
    if (kind !== 'rain') return;
    let n = 45 * this.quality * dt;
    const hw = this.canvas.width / super.u / 2, hh = this.canvas.height / super.u / 2;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n--;
      this.emit(this.cam.x + (Math.random() - 0.5) * hw * 2, this.cam.z + (Math.random() - 0.5) * hh * 2.4, 0.05, 0, 0, 0.9, '#c8d8f0', 0.22, 0.05, { g: 7 });
    }
  }

  // ---------------------------------------------------------------- frame
  draw(snap, view) {
    if (this.gl.domElement.parentNode !== this.container) this.attach();
    const pf = this.prof, T = pf ? performance.now() : 0;
    this.updateCamera();
    this.oq.length = 0;
    this.drawGround3D(snap, view);
    const T1 = pf ? performance.now() : 0;
    this.drawWorldParts(snap);
    this.drawCharacters(view);
    this.drawPickups3D(snap);
    this.drawStructs3D(snap);
    this.drawProjectiles3D(snap);
    this.drawStreaks();
    this.parts.flush();
    this.updateParticles();
    this.updateLights(snap, view);
    this.updateCut();
    if (this.wU) {
      this.wU.uTime.value = this.time;
      this.wU.uCenter.value.set(this.cam.x, 0, this.cam.z - 4);
    }
    const T2 = pf ? performance.now() : 0;
    this.composer.render();
    const T3 = pf ? performance.now() : 0;
    this.drawOverlay3D(snap, view);
    this.flashes = this.flashes.filter((f) => !f.static);
    if (pf) {
      const T4 = performance.now();
      pf.ground += T1 - T;
      pf.mGround = Math.max(pf.mGround || 0, T1 - T);
      pf.mSync = Math.max(pf.mSync || 0, T2 - T1);
      pf.mGl = Math.max(pf.mGl || 0, T3 - T2);
      if (T3 - T2 > 30) pf.slowGl = (pf.slowGl || 0) + 1;
      pf.sync += T2 - T1;
      pf.gl += T3 - T2;
      pf.overlay += T4 - T3;
      pf.n++;
    }
  }

  updateCamera() {
    const uc = super.u / this.dpr; // css px per world unit at the target, as in 2D
    const D = this.height / 2 / (uc * Math.tan((FOV * Math.PI) / 360));
    const tx = this.cam.x, tz = this.cam.z;
    this.camera.position.set(tx, Math.sin(PITCH) * D, tz + Math.cos(PITCH) * D);
    this.camera.lookAt(tx, 0, tz);
    this.camera.updateMatrixWorld();
    this.camReady = true;
    // visible ground: where the screen corners meet the ground (plus a margin), for culling
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const c = this.camera.position;
    for (const [nx, ny] of CORNERS) {
      const v = this.pv.set(nx, ny, 0.5).unproject(this.camera).sub(c);
      const t = v.y < -1e-3 ? -c.y / v.y : 200;
      const x = c.x + v.x * t, z = c.z + v.z * t;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    this.vb = [x0 - 3, x1 + 3, z0 - 3, z1 + 6];
    // the sun's shadow box follows the view, snapped to its texels so shadows don't shimmer
    const ext = Math.max(x1 - x0, z1 - z0) / 2 + 4, sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - ext) > 1) {
      sc.left = sc.bottom = -ext;
      sc.right = sc.top = ext;
      sc.near = 1;
      sc.far = 160;
      sc.updateProjectionMatrix();
    }
    const tex = (ext * 2) / 2048, gx = Math.round((x0 + x1) / 2 / tex) * tex, gz = Math.round((z0 + z1) / 2 / tex) * tex;
    this.sun.target.position.set(gx, 0, gz);
    this.sun.position.set(gx + SUN_DIR.x * 70, SUN_DIR.y * 70, gz + SUN_DIR.z * 70);
    this.sun.target.updateMatrixWorld();
  }

  inView(x, z) {
    const b = this.vb;
    return x > b[0] && x < b[1] && z > b[2] && z < b[3];
  }

  // ground marks: the 2D ground layer painted onto a canvas covering the visible ground
  drawGround3D(snap, view) {
    // the size only depends on the zoom (bucketed), so the canvas and its texture are only
    // reallocated when the zoom changes a lot, never while walking around
    const [x0, x1, z0, z1] = this.vb;
    const gw = Math.ceil((x1 - x0) / 8) * 8, gh = Math.ceil((z1 - z0) / 8) * 8;
    const px = Math.max(6, Math.min(GROUND_PX * this.quality, 2048 / gw, 2048 / gh));
    const cw = Math.ceil(gw * px), ch = Math.ceil(gh * px);
    if (cw !== this.gCanvas.width || ch !== this.gCanvas.height) {
      this.gCanvas.width = cw;
      this.gCanvas.height = ch;
      this.gTex.dispose();
    }
    this.gU = px;
    this.gx0 = Math.floor(x0 * px) / px;
    this.gz0 = Math.floor(z0 * px) / px;
    const c = this.gCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    this.ctx = c;
    this.gMode = true;
    try {
      this.drawGroundLayer(snap, view);
      this.drawRings();
    } finally {
      this.gMode = false;
      this.ctx = this.ctx2d;
    }
    this.gTex.needsUpdate = true;
    this.gMesh.scale.set(gw, 1, gh);
    this.gMesh.position.set(this.gx0 + gw / 2, 0.02, this.gz0 + gh / 2);
  }

  // machines, loot, doors, the mystery box and animated props
  drawWorldParts(snap) {
    const P = this.parts, t = this.time;
    for (const a of this.anim) {
      if (!this.inView(a.x, a.z)) continue;
      if (a.k === 'windmill') {
        P.root(a.x, a.y, a.z, 0);
        for (let i = 0; i < 4; i++) {
          const ang = t * 0.8 + (i * Math.PI) / 2;
          P.put('rbox', 'toon', col('#efe6d2'), Math.sin(ang) * 1.15, Math.cos(ang) * 1.15, 0, 0.38, 2.1, 0.08, 0, 0, -ang, true);
        }
        P.put('sphere', 'toon', col('#7a5a3a'), 0, 0, 0.05, 0.4, 0.4, 0.3, 0, 0, 0, true);
      } else if (a.k === 'campfire') {
        const cs = ['#ff7a2a', '#ffb43a', '#fff0a0'];
        for (let i = 0; i < 3; i++) {
          const fh = (0.6 + Math.sin(t * 9 + i * 2) * 0.14) * (1 - i * 0.25);
          P.world('cone', 'glow', col(cs[i], 2.6), a.x + Math.sin(t * 7 + i) * 0.03, 0.12 + fh / 2, a.z, 0.5 * (1 - i * 0.28), fh, 0.5 * (1 - i * 0.28));
        }
        if (Math.random() < 0.25) this.emit(a.x, a.z, 0.8, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 1.5, '#ffb04a', 1.2, 0.06, { glow: true });
      } else if (a.k === 'reactor') {
        this.tc.copy(col('#5aff96')).multiplyScalar(1.6 + Math.sin(t * 4) * 0.5);
        P.world('sphere', 'glow', this.tc, a.x, 0.95, a.z, a.r * 2, a.r * 1.6, a.r * 2);
      } else if (a.k === 'fountain' && Math.random() < 0.5) {
        this.emit(a.x, a.z, 1.9, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 2.5, '#bfe6ff', 0.6, 0.08, { g: 8 });
      }
    }
    // machines
    for (const o of this.statics) {
      if (!this.inView(o.x, o.z)) continue;
      switch (o.k) {
        case 'perk': {
          const pk = PERKS[o.perk];
          this.machineLabel(o.x, o.z, 2.8, pk.name, pk.cost, S.hex(pk.color));
          break;
        }
        case 'shop': {
          const lit = Math.floor(t * 2.5) % 3;
          for (let i = 0; i < 3; i++) P.world('box', 'glow', i === lit ? col(SHOP_CARDS[i], 1.8) : col('#3a2a5a'), o.x - 0.36 + i * 0.36, 0.95, o.z + 0.43, 0.3, 0.44, 0.02);
          P.world('oct', 'glow', col('#d2a8ff', 1.7), o.x, 2.05 + Math.sin(t * 2.5) * 0.12, o.z + 0.1, 0.36, 0.56, 0.36, 0, t * 1.5, 0);
          this.machineLabel(o.x, o.z, 4.1, 'Upgrade Machine', null, '#d2a8ff');
          break;
        }
        case 'forge': {
          if (Math.random() < 0.2) this.emit(o.x + (Math.random() - 0.5), o.z + 0.1, 0.8, 0, 0, 1.5, '#ffb050', 0.8, 0.06, { glow: true });
          const job = snap.F;
          if (job) {
            const [wid, lvl, rarity, prog, owner] = job;
            const ready = prog >= 1, fx = FORGE_FX[lvl];
            P.root(o.x, 1.5 + Math.sin(t * 3) * 0.1, o.z, t * 0.9, 1.2);
            drawGun(P, t, wid, lvl, 0, -0.2 * gunLength(wid));
            this.glowAt(o.x, o.z, ready ? 1.6 : 1, fx.aura, ready ? 0.6 : 0.3);
            const name = `${RARITY[rarity].name} ${WEAPONS[wid].name} ${lvl >= 2 ? 'XX' : 'X'}`;
            const mine = this.me && this.me.p.id === owner;
            this.label(o.x, o.z, 3.4, ready ? (mine ? `Ready: ${name}` : name) : `Forging ${Math.round(prog * 100)}%`, ready ? fx.aura : '#ffaa60', 9);
          } else this.machineLabel(o.x, o.z, 2.2, 'Weapon Forge', this.forgeDetailFn, '#ffaa60');
          break;
        }
        case 'station': {
          const active = snap.O.mk.some((m) => m[2] === 1 && Math.abs(m[0] - o.x) < 0.2 && Math.abs(m[1] - (o.z + 0.8)) < 0.2);
          if (active) this.tc.copy(col('#6eff96')).multiplyScalar(1.4 + Math.sin(t * 6) * 0.6);
          P.world('box', 'glow', active ? this.tc : col('#50708a'), o.x, 0.62, o.z + 0.1, 0.64, 0.04, 0.4, -0.3, 0, 0);
          break;
        }
      }
    }
    // searchable loot
    const loot = this.world.spots.loot;
    for (let i = 0; i < loot.length; i++) {
      const sp = loot[i];
      if (!this.inView(sp.x, sp.z)) continue;
      const st = snap.C[i] || [1, 0];
      const full = st[0] === 1;
      const cx = sp.px + 0.5, cz = sp.pz + 0.5;
      let top = 1;
      switch (sp.kind) {
        case 'rack':
          P.world('rbox', 'toon', col('#8a5a34'), cx, 0.75, cz, 0.96, 1.5, 0.3, 0, 0, 0, true);
          if (full) for (const y of [0.6, 1.1]) P.world('box', 'gloss', col('#2a2a2e'), cx, y, cz + 0.2, 0.75, 0.1, 0.08);
          top = 1.6;
          break;
        case 'locker':
          P.world('rbox', 'toon', col('#6f8aa6'), cx, 0.85, cz, 0.8, 1.7, 0.6, 0, 0, 0, true);
          if (!full) P.world('box', 'toon', col('#2a3038'), cx, 0.85, cz + 0.3, 0.62, 1.5, 0.03);
          top = 1.8;
          break;
        case 'crate':
        case 'chest': {
          const chest = sp.kind === 'chest';
          const c = chest ? '#b9783e' : '#c48a4e';
          P.world('rbox', 'toon', full ? col(c) : shadeCol(c, -0.25), cx, 0.3, cz, 0.84, 0.6, 0.7, 0, 0, 0, true);
          if (chest) P.world('box', 'gloss', col('#e8c050'), cx, 0.3, cz, 0.1, 0.62, 0.72);
          if (!full) P.world('box', 'toon', col('#3a2412'), cx, 0.61, cz, 0.62, 0.02, 0.48);
          if (chest && full) this.glowAt(cx, cz, 1.6, '#ffcf5a', 0.3);
          top = 0.7;
          break;
        }
        case 'body':
          P.world('cyl', 'toon', col('#5a1414'), sp.x, 0.012, sp.z, 1.2, 0.01, 0.6);
          P.world('rbox', 'toon', col(full ? '#6a7a5a' : '#5a5a5a'), sp.x - 0.05, 0.16, sp.z, 0.8, 0.3, 0.38, 0, 0, 0, true);
          P.world('sphere', 'toon', col('#d0a888'), sp.x + 0.45, 0.16, sp.z, 0.34, 0.32, 0.34, 0, 0, 0, true);
          if (full) P.world('rbox', 'toon', col('#7a5a32'), sp.x - 0.5, 0.12, sp.z + 0.15, 0.3, 0.22, 0.25, 0, 0, 0, true);
          top = 0.5;
          break;
        case 'toolbox':
          P.world('rbox', 'toon', col(full ? '#d84a3a' : '#7a3a32'), sp.x, 0.15, sp.z, 0.64, 0.3, 0.3, 0, 0, 0, true);
          P.world('torus', 'toon', col('#3a3a3a'), sp.x, 0.32, sp.z, 0.3, 0.3, 0.3);
          top = 0.5;
          break;
        case 'car':
          top = 1.5;
          break;
      }
      const lx = sp.kind === 'body' || sp.kind === 'toolbox' || sp.kind === 'car' ? sp.x : cx, lz = sp.kind === 'body' || sp.kind === 'toolbox' || sp.kind === 'car' ? sp.z : cz;
      if (full && Math.random() < this.dt * 2.5) this.emit(lx + (Math.random() - 0.5) * 0.4, lz, top / H3 + 0.2, 0, 0, 0.4, sp.kind === 'chest' ? '#ffd860' : '#fff6c8', 0.7, 0.08, { shape: 'spark', glow: true });
      if (full) this.label(sp.x, sp.z, sp.kind === 'car' ? 1.6 : 2.4, CONTAINERS[sp.kind].name, '#fff2c8', 2.6, undefined, true);
    }
    // doors and debris
    for (const d of this.doors) {
      if (d.open || snap.D.includes(d.id)) continue;
      const cx = d.x + d.w / 2, cz = d.z + d.d / 2;
      if (!this.inView(cx, cz)) continue;
      const sealed = d.cost >= 99999;
      if (sealed) {
        P.world('rbox', 'gloss', col('#7a828c'), cx, 0.65, cz, d.w, 1.3, d.d, 0, 0, 0, true);
        for (let x = d.x + 0.25; x < d.x + d.w; x += 0.4) P.world('box', 'toon', col('#4a5058'), x, 0.65, d.z + d.d + 0.01, 0.06, 1.2, 0.03);
      } else {
        for (let k = 0; k < 6; k++) {
          const px = cx + Math.sin(d.id * 3 + k * 1.7) * d.w * 0.3, pz = cz + Math.cos(d.id * 2 + k) * d.d * 0.2;
          P.world('rbox', 'toon', col(k % 2 ? '#9a6a3e' : '#7a5230'), px, 0.14 + k * 0.17, pz, 1.4, 0.2, 0.26, 0, Math.sin(k * 2.1 + d.id) * 0.6 + (d.w < d.d ? HALF_PI : 0), Math.sin(k * 3.3) * 0.12, true);
        }
      }
      this.label(cx, cz, 2.2, sealed ? d.label : `${d.label} · ${d.cost}`, sealed ? '#c8d4e0' : '#ffd890', 4);
    }
    // mystery box
    const bs = this.world.spots.box[snap.B[0]];
    if (bs && this.inView(bs.x, bs.z)) {
      const [, state, wid, , , rarity] = snap.B;
      const lift = state === 'moving' ? Math.min(3, (t % 4) * 1.5) : 0;
      const x = bs.x, z = bs.z - 0.35;
      this.glowAt(x, z, 2.6, '#6fb8ff', 0.3);
      P.world('rbox', 'toon', col('#a8743e'), x, 0.3 + lift, z, 1.8, 0.6, 0.75, 0, 0, 0, true);
      for (const dx of [-0.55, 0.5]) P.world('box', 'gloss', col('#f0c95a'), x + dx, 0.3 + lift, z, 0.1, 0.62, 0.77);
      this.tc.copy(col('#96d2ff')).multiplyScalar(1.4 + Math.sin(t * 4) * 0.5);
      P.world('oct', 'glow', this.tc, x, 0.95 + lift + Math.sin(t * 3) * 0.06, z, 0.28, 0.4, 0.28, 0, t * 2, 0);
      let show = '';
      if (state === 'spin') show = WIDS[Math.floor(t * 9) % WIDS.length];
      else if (state === 'offer') show = wid;
      if (show) {
        if (state === 'offer') this.glowAt(x, z, 1.4, S.rarityColor(rarity), 0.6);
        P.root(x, 1.55 + Math.sin(t * 3) * 0.1, z, t * 1.2, 1.2);
        drawGun(P, t, show, 0, 0, -0.2 * gunLength(show));
        if (state === 'offer') this.label(bs.x, bs.z - 0.5, 3.2, `${RARITY[rarity].name} ${WEAPONS[wid].name}`, S.rarityColor(rarity), 6);
      } else if (state === 'idle') this.machineLabel(bs.x, bs.z - 0.5, 1.9, 'Mystery Box', 950, '#a8d4ff');
    }
    if (snap.O.dr) {
      const [x, z] = snap.O.dr;
      const y = 1.6 + Math.sin(t * 3) * 0.12;
      P.root(x, y, z, 0);
      P.put('rbox', 'gloss', col('#d8dde2'), 0, 0, 0, 0.6, 0.24, 0.4, 0, 0, 0, true);
      P.put('box', 'toon', col('#2a2e34'), 0, 0.12, 0, 1.2, 0.05, 0.08);
      for (const dx of [-0.55, 0.55]) P.put('cyl', 'add', col('#c8dceb', 0.5), dx, 0.17, 0, 0.6, 0.01, 0.6);
      P.put('sphere', 'glow', Math.floor(t * 3) % 2 ? col('#5affc8', 2.5) : col('#2a8a6a'), 0, -0.05, 0.21, 0.12, 0.12, 0.06);
    }
  }

  // ---------------------------------------------------------------- characters
  drawCharacters(view) {
    const P = this.parts, t = this.time;
    for (const o of this.players.values()) {
      const p = o.p;
      if (p.s === 2) continue;
      if (p.id !== view.localId) {
        const tag = p.s === 1 ? `${p.n} — DOWN ${Math.ceil(p.bl)}s` : p.n;
        this.label(o.x, o.z, 2.9, tag, p.s === 1 ? '#ff8070' : '#a8d4ff', 999, p.hp / p.mh);
      }
      if (!this.inView(o.x, o.z)) continue;
      let look = this.lookCache.get(p.c);
      if (!look) this.lookCache.set(p.c, (look = S.playerLook(p.c)));
      const w = p.w[p.cw] || p.w[0];
      const knife = p.s === 0 && o.knifeT !== undefined ? (t - o.knifeT) / KNIFE_TIME : 1;
      // hit flash, and the invulnerability flicker (shown as a pale flash, never hidden)
      const hit = t - (o.hurtT ?? -1) < 0.12, hurt = hit || (p.iv && p.s === 0 && Math.floor(t * 12) % 2 === 0);
      drawPerson(this.parts, this.time, o.x, o.z, o.a, look, o.walk, o.moving && p.s === 0, { gun: p.s === 0 && w && knife >= 1 ? w[0] : null, forged: w && w[1], down: p.s === 1, hurt });
      if (knife < 1) {
        const e = 1 - (1 - knife) * (1 - knife);
        const cur = o.knifeA - KNIFE_ARC / 2 + KNIFE_ARC * e;
        P.root(o.x, 0.95, o.z, HALF_PI - cur);
        P.put('box', 'gloss', col('#e4e8ec'), 0, 0, 0.95, 0.04, 0.12, 0.6);
        P.put('box', 'toon', col('#4a3020'), 0, 0, 0.55, 0.07, 0.1, 0.28);
        this.tc.copy(col('#ffffff')).multiplyScalar(0.5 * (1 - knife));
        P.put('box', 'add', this.tc, 0, 0, 0.9, 0.5, 0.02, 0.9);
      }
      if (p.s === 0 && w && w[1]) this.gunDust(o, FORGE_FX[w[1]]);
      if (p.sh > 0) {
        this.tc.copy(col(hit ? '#ff4632' : '#7ab8ff')).multiplyScalar(0.3);
        P.world('sphere', 'add', this.tc, o.x, 0.85, o.z, 1.5, 1.85, 1.5);
      }
    }
    for (const o of this.zombies.values()) {
      if (!this.inView(o.x, o.z)) continue;
      const def = o.def, sc = def.scale;
      if (def.egg) {
        const pulse = 1 + Math.sin(t * 6 + o.seed) * 0.05;
        P.world('sphere', 'toon', col(o.flags & 2 ? '#ffffff' : '#bcdcea'), o.x, 0.46, o.z, 0.84 * pulse, 0.92 * pulse, 0.84 * pulse, 0, o.seed, 0, true);
        P.world('sphere', 'toon', col('#e8f4ff'), o.x - 0.12, 0.66, o.z + 0.22, 0.16, 0.16, 0.12);
        if (o.hp < 1) this.oq.push(['bar', o.x, 1.15, o.z, o.hp, 0.8, '#8ad0ff']);
        continue;
      }
      const rising = o.st === 0;
      let y = 0;
      if (rising) {
        const f = Math.max(0, Math.min(1, o.riseT / (def.boss || def.miniboss ? 2.4 : 1.4)));
        y = -f * 1.7 * sc;
        P.world('sphere', 'toon', col('#5a3e24'), o.x, 0, o.z, 1.2 * sc, 0.32, 1.2 * sc, 0, o.seed, 0, true);
      }
      const stun = o.st === 6;
      const x = o.x + (stun ? Math.sin(t * 40) * 0.04 : 0);
      const attack = o.st === 2 || o.st === 3;
      drawPerson(this.parts, this.time, x, o.z, o.a, o.look, o.walk, o.moving, { y, attack, hurt: o.flags & 2, seed: o.seed });
      drawExtras(this.parts, t, def.look || o.type, attack);
      if (o.st === 3 && (def.boss || def.miniboss)) {
        this.tc.copy(col('#ff3c28')).multiplyScalar(1.8 + Math.sin(t * 20) * 0.8);
        P.world('sphere', 'glow', this.tc, x, 2.2 * sc * MODEL, o.z, 0.34, 0.34, 0.34);
      }
      if (stun && Math.random() < this.dt * 8) {
        const a = t * 5;
        this.emit(x + Math.cos(a) * 0.35, o.z + Math.sin(a) * 0.2, (1.8 * sc) / H3, 0, 0, 0.2, '#9fe0ff', 0.4, 0.07, { shape: 'spark', glow: true });
      }
      if (!rising && o.hp < 1 && !def.boss && !def.clone) this.oq.push(['bar', o.x, 1.85 * sc * MODEL + 0.15, o.z, o.hp, def.miniboss ? 1.6 : 0.8, def.miniboss ? '#ff7a4a' : '#e2574c']);
    }
    for (const o of this.dying) {
      if (!this.inView(o.x, o.z)) continue;
      const fall = Math.min(1, o.deathT / 0.35);
      const sink = Math.max(0, o.deathT - 1.2) * 0.8 * o.def.scale;
      drawPerson(this.parts, this.time, o.x, o.z, o.a, o.look, 0, false, { down: true, fall, y: -sink, seed: o.seed });
    }
  }

  // ---------------------------------------------------------------- pickups, structures, shots
  drawPickups3D(snap) {
    const P = this.parts, t = this.time;
    for (const it of snap.I) {
      const [id, kind, x, z, sub, rarity] = it;
      if (!this.inView(x, z)) continue;
      const meta = this.pickups.get(id) || { born: 0 };
      const age = t - meta.born;
      const bob = Math.sin(t * 3 + id) * 0.08;
      const pop = age < 0.35 ? Math.sin((age / 0.35) * Math.PI) * 0.8 : 0;
      if (kind === 'weapon') {
        const c = S.rarityColor(rarity), W = WEAPONS[sub];
        P.world('torus', 'glow', col(c, 1.6), x, 0.05, z, 1.3, 1.3, 1.3, HALF_PI);
        if (rarity >= 2) P.world('cyl', 'add', col(c, 0.35), x, 1.6, z, 0.5, 3.2, 0.5);
        P.root(x, 0.6 + bob + pop, z, t * 1.2 + id, 1.1, 0, Math.sin(t * 1.5 + id) * 0.15);
        drawGun(P, t, sub, 0, 0, -0.2 * gunLength(sub));
        this.label(x, z, 1.9, `${RARITY[rarity].name} ${W.name}`, c, 3.2, undefined, true);
        continue;
      }
      if (kind === 'power') {
        const c = S.hex(POWERUPS[sub].color);
        this.glowAt(x, z, 1.4, c, 0.5);
        P.world('sphere', 'glow', col(c, 1.5), x, 0.75 + bob, z, 0.62, 0.62, 0.62);
        P.world('torus', 'glow', col(c, 2), x, 0.75 + bob, z, 0.9, 0.9, 0.9, t * 2, t, 0);
        this.oq.push(['letter', x, 0.75 + bob, z, { maxammo: 'A', instakill: '☠', double: '×2', nuke: '✸' }[sub] || '?']);
        continue;
      }
      if (kind === 'item') {
        const c = { radio_part: '#ffd04a', fuel: '#ff5a3a', detonator: '#ff3a3a', cure: '#5affc8', keycard: '#5ac8ff', charge: '#ff7a4a', sample: '#7affd8', vial: '#7aff7a' }[sub] || '#ffffff';
        P.world('cyl', 'add', col(c, 0.45), x, 2.5, z, 0.6, 5, 0.6);
        P.world('oct', 'glow', col(c, 2), x, 0.75 + bob, z, 0.36, 0.5, 0.36, 0, t * 2, 0);
        if (Math.random() < this.dt * 4) this.emit(x + (Math.random() - 0.5) * 0.5, z, 0.6, 0, 0, 1.4, c, 0.8, 0.07, { glow: true, shape: 'spark' });
        continue;
      }
      const y = 0.25 + bob + pop;
      switch (kind) {
        case 'ammo':
          P.world('rbox', 'toon', col('#6a8a44'), x, y, z, 0.56, 0.36, 0.36, 0, id, 0, true);
          for (let i = 0; i < 3; i++) P.world('box', 'gloss', col('#f2d050'), x - 0.12 + i * 0.12, y + 0.24, z, 0.07, 0.16, 0.07, 0, id, 0);
          break;
        case 'cash':
          for (let i = 0; i < 3; i++) P.world('cyl', 'gloss', col('#f2c94a'), x, y - 0.1 + i * 0.08, z, 0.44, 0.06, 0.44, 0, 0, 0, true);
          break;
        case 'grenade':
          P.world('sphere', 'toon', col('#5a7a3a'), x, y, z, 0.36, 0.4, 0.36, 0, 0, 0, true);
          break;
        case 'supply':
          this.glowAt(x, z, 1.6, '#ffd65a', 0.35);
          P.world('rbox', 'toon', col('#7a8a4a'), x, y, z, 0.84, 0.5, 0.5, 0, 0, 0, true);
          P.world('box', 'glow', col('#f2d050', 1.2), x, y, z, 0.14, 0.52, 0.52);
          this.label(x, z, 1.5, 'Supply Bag', '#ffd65a', 6);
          break;
        case 'health':
          P.world('rbox', 'toon', col('#f4f4f0'), x, y, z, 0.48, 0.4, 0.4, 0, 0, 0, true);
          P.world('box', 'glow', col('#e2453a', 1.3), x, y, z + 0.21, 0.1, 0.28, 0.02);
          P.world('box', 'glow', col('#e2453a', 1.3), x, y, z + 0.21, 0.28, 0.1, 0.02);
          break;
      }
    }
  }

  drawStructs3D(snap) {
    const P = this.parts, t = this.time;
    for (const s of snap.S) {
      if (s.k === 'wall') {
        const steel = s.l >= 5;
        const c = steel ? '#a8b0b8' : '#c49a64';
        for (const [cx, cz] of s.c) {
          if (!this.inView(cx, cz)) continue;
          P.world('rbox', steel ? 'gloss' : 'toon', s.hp < 0.5 ? shadeCol(c, -0.3) : col(c), cx + 0.5, 0.4, cz + 0.5, 0.92, 0.8, 0.8, 0, 0, 0, true);
          if (s.sp) for (let i = 0; i < 3; i++) P.world('cone', 'toon', col('#d8d8dc'), cx + 0.2 + i * 0.3, 0.2, cz + 1.05, 0.12, 0.35, 0.12, 0.9, 0, 0, true);
        }
        continue;
      }
      if (!this.inView(s.x, s.z)) continue;
      if (s.lf < 0.15 && Math.floor(t * 8) % 2) continue;
      for (const ang of [0, 2.1, 4.2]) P.segment('glow', col('#3a3a40'), s.x, 0.65, s.z, s.x + Math.cos(ang) * 0.35, 0, s.z + Math.sin(ang) * 0.35, 0.04);
      P.root(s.x, 0.85, s.z, HALF_PI - s.a);
      P.put('rbox', 'toon', col(s.l >= 5 ? '#d0583a' : '#4a7ec8'), 0, 0, 0, 0.5, 0.38, 0.56, 0, 0, 0, true);
      P.put('box', 'gloss', col('#2e3036'), 0.08, 0, 0.5, 0.08, 0.08, 0.6);
      P.put('box', 'gloss', col('#2e3036'), -0.08, 0, 0.5, 0.08, 0.08, 0.6);
      P.put('sphere', 'glow', col('#ff4a3a', 2.2), 0, 0.22, -0.1, 0.1, 0.1, 0.1);
    }
  }

  drawProjectiles3D(snap) {
    const P = this.parts, al = this.alpha;
    for (const pr of snap.R) {
      const kind = pr[1], last = pr[5];
      let x = pr[2], y = pr[3], z = pr[4];
      const q = this.prevR.get(pr[0]);
      if (q) {
        x = q[2] + (x - q[2]) * al;
        y = q[3] + (y - q[3]) * al;
        z = q[4] + (z - q[4]) * al;
      }
      const fx = kind === 'hook' ? null : FORGE_FX[last];
      const spec = PROJ[kind] || PROJ.other;
      const c = fx && kind === 'ray' ? fx.ray : fx && kind === 'bolt' ? fx.tracer : spec[0];
      const r = spec[1], wy = Math.max(0.15, y * H3);
      if (kind === 'hook') {
        const owner = this.zombies.get(last);
        if (owner) P.segment('glow', col('#5a5048'), owner.x, 1.2 * owner.def.scale, owner.z, x, wy, z, 0.04);
      }
      if (kind === 'ray' || kind === 'spit' || kind === 'bolt') {
        P.world('sphere', 'glow', col(c, 2.4), x, wy, z, r * 2, r * 2, r * 2);
        P.world('sphere', 'add', col(c, 0.5), x, wy, z, r * 4.5, r * 4.5, r * 4.5);
        if (Math.random() < this.dt * 50) this.emit(x, z, y, 0, 0, 0, c, 0.25, r * 0.8, { glow: true });
      } else {
        P.world(kind === 'rock' ? 'ico' : 'sphere', kind === 'rocket' || kind === 'hook' ? 'gloss' : 'toon', col(c), x, wy, z, r * 2, r * 2, r * 2, 0, 0, 0, true);
        if ((kind === 'rocket' || kind === 'grenade') && Math.random() < this.dt * 30) {
          const hot = fx && kind === 'grenade';
          this.emit(x, z, y, 0, 0, 0.3, hot ? fx.tracer : '#b8b8b8', 0.6, 0.22, { grow: 1.5, glow: !!hot });
        }
      }
    }
  }

  // bullet tracers and lightning as glowing beams
  drawStreaks() {
    const P = this.parts, tc = this.tc;
    for (const t of this.tracers) {
      if (!this.inView(t.x1, t.z1) && !this.inView(t.x2, t.z2)) continue;
      const f = t.life / t.max;
      tc.copy(col(t.col)).multiplyScalar(2.6 * f);
      P.segment('add', tc, t.x1, MUZZLE_Y, t.z1, t.x2, MUZZLE_Y, t.z2, (t.hot ? 0.05 : 0.032) * (0.5 + f));
      if (t.hot) {
        tc.copy(col(t.hot)).multiplyScalar(3 * f);
        P.segment('add', tc, t.x1, MUZZLE_Y, t.z1, t.x2, MUZZLE_Y, t.z2, 0.016 * (0.5 + f));
      }
    }
    for (const b of this.bolts) {
      const f = b.life / b.max, pts = b.pts;
      for (let i = 1; i < pts.length; i++) {
        tc.copy(col(b.col || '#78beff')).multiplyScalar(2.4 * f);
        P.segment('add', tc, pts[i - 1][0], 1.1, pts[i - 1][1], pts[i][0], 1.1, pts[i][1], 0.07);
        tc.copy(col(b.core || '#ffffff')).multiplyScalar(2.6 * f);
        P.segment('add', tc, pts[i - 1][0], 1.1, pts[i - 1][1], pts[i][0], 1.1, pts[i][1], 0.025);
      }
    }
  }

  // ---------------------------------------------------------------- particles, lights, cut-away
  updateParticles() {
    const [normal, glow] = this.pts;
    const fill = [0, 0];
    const t = this.time;
    for (const p of this.particles) {
      if (p.shape === 'streak' || !this.inView(p.x, p.z)) continue;
      const f = p.life / p.max;
      let size = p.size * (1 + p.grow * (1 - f)), a = Math.min(1, f * 1.6);
      if (p.shape === 'leaf') a = Math.min(1, f * 2);
      else if (p.shape === 'spark') {
        a *= 0.55 + 0.45 * Math.sin(p.life * 40 + p.x * 13);
        size *= 1.3;
      }
      if (size <= 0.005) continue;
      const which = p.glow ? 1 : 0, obj = p.glow ? glow : normal;
      const i = fill[which]++;
      const g = obj.geometry.attributes;
      const c = col(p.col), k = p.glow ? 2.2 : 1;
      g.position.array[i * 3] = p.x;
      g.position.array[i * 3 + 1] = p.h * H3 + 0.02;
      g.position.array[i * 3 + 2] = p.z;
      g.aCol.array[i * 4] = c.r * k;
      g.aCol.array[i * 4 + 1] = c.g * k;
      g.aCol.array[i * 4 + 2] = c.b * k;
      g.aCol.array[i * 4 + 3] = a;
      g.aSize.array[i] = size;
    }
    for (let w = 0; w < 2; w++) {
      const geo = this.pts[w].geometry, n = fill[w];
      geo.setDrawRange(0, n);
      if (!n) continue;
      for (const [name, sz] of [['position', 3], ['aCol', 4], ['aSize', 1]]) {
        const at = geo.attributes[name];
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * sz);
        at.needsUpdate = true;
      }
    }
    void t;
  }

  // The brightest light sources near the view get the dynamic point lights this frame.
  updateLights(snap, view) {
    const cand = this.cand, night = this.night, tx = this.cam.x, tz = this.cam.z;
    let n = 0;
    const add = (x, y, z, c, i, d) => {
      if (n >= cand.length) return;
      const dd = (x - tx) * (x - tx) + (z - tz) * (z - tz);
      if (dd > 1600 + d * d) return;
      const o = cand[n++];
      o.x = x;
      o.y = y;
      o.z = z;
      o.c = c;
      o.i = i;
      o.d = d;
      o.s = (i * d) / (1 + dd / 150);
    };
    const me = this.players.get(view.localId);
    if (me && me.p.s !== 2 && night > 0.3) add(me.x, 2.6, me.z, '#ffe8c0', 4 + 10 * night, 10);
    for (const l of this.lights) add(l.x, l.y || 2.6, l.z, l.color, (6 + 22 * night) * (l.flicker ? 0.85 + Math.sin(this.time * 9 + l.x) * 0.15 : 1), l.distance * 1.4);
    for (const m of this.machineLights) add(m[0], m[1], m[2], m[3], m[4] * (0.6 + night), m[5]);
    for (const f of this.flashes) {
      if (f.static) add(f.x, 1, f.z, f.col, f.a * f.r * 2.2, f.r * 1.6);
      else add(f.x, 1.1, f.z, f.col, (f.a * (f.life / f.max) * f.r * f.r * 3.2) / (1 + night * 0.4), f.r * 2.6);
    }
    for (const h of snap.H) {
      const kind = h[1];
      if (kind !== 'fire' && kind !== 'napalm' && kind !== 'heal') continue;
      const [, , x, z, r] = this.hazardPos(h);
      add(x, 0.8, z, kind === 'heal' ? '#7fffb0' : '#ff8a3a', 9, r * 2.6);
    }
    for (const o of this.zombies.values()) if (o.type === 'burner' || o.flags & 1) add(o.x, 1, o.z, '#ff8a3a', 4, 3.5);
    // pick the strongest MAX_LIGHTS (partial selection, no sort of the whole list)
    for (let k = 0; k < MAX_LIGHTS; k++) {
      let best = -1, bs = 0;
      for (let j = k; j < n; j++) if (cand[j].s > bs) {
        bs = cand[j].s;
        best = j;
      }
      const L = this.pool[k];
      if (best < 0) {
        L.intensity = 0;
        continue;
      }
      const o = cand[best];
      cand[best] = cand[k];
      cand[k] = o;
      L.position.set(o.x, o.y, o.z);
      L.color.copy(col(o.c));
      L.intensity = o.i;
      L.distance = o.d;
    }
  }

  // the local player's screen spot for the see-through cut-away
  updateCut() {
    const me = this.me;
    if (!me || me.p.s === 2) {
      CUT.uCutZ.value = 1e5;
      return;
    }
    const [X, Y] = this.proj(me.x, 1.0, me.z);
    const k = this.bufH / this.canvas.height;
    CUT.uCut.value.set(X * k, this.bufH - Y * k, super.u * 2.3 * k);
    CUT.uCutZ.value = me.z - 0.3;
  }

  // ---------------------------------------------------------------- overlay
  drawOverlay3D(snap, view) {
    const c = this.ctx, u = this.u;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const q of this.oq) {
      const [X, Y] = this.proj(q[1], q[2], q[3]);
      switch (q[0]) {
        case 'bar': {
          const bw = u * q[5], bh = u * 0.12;
          S.rr(c, X - bw / 2, Y, bw, bh, bh / 2);
          c.fillStyle = 'rgba(20,10,10,0.7)';
          c.fill();
          S.rr(c, X - bw / 2, Y, bw * Math.max(0, q[4]), bh, bh / 2);
          c.fillStyle = q[6];
          c.fill();
          break;
        }
        case 'letter':
          c.fillStyle = '#1a1a1a';
          c.font = `bold ${u * 0.38}px Fredoka, Segoe UI`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(q[4], X, Y);
          break;
      }
    }
    this.drawOverlayUI(snap, view);
  }
}
