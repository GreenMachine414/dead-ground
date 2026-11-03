// The static 3D world: every map solid, machine and decoration as cartoon shapes in the 2D art's
// colours, baked into a StaticBuilder (see models3d.js). Things that move (windmill sails, fires,
// reactor cores) are returned as `anim` entries and drawn as parts each frame.
import * as THREE from 'three';
import { GEO, col, shadeCol } from './models3d.js';
import { PERKS } from '../data/zombies.js';

const fract = (v) => v - Math.floor(v);
const hash = (a, b = 0) => fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const HALF_PI = Math.PI / 2;

export function buildWorld(B, world, th, statics, parent) {
  const C = (c) => (c && c.isColor ? c : col(c));
  const T = (g, c, x, y, z, sx, sy, sz, ry = 0, line = false, rx = 0, rz = 0) => B.add(GEO[g], 'toon', C(c), x, y, z, sx, sy, sz, ry, line, rx, rz);
  const G = (g, c, x, y, z, sx, sy, sz, ry = 0, line = false, rx = 0, rz = 0) => B.add(GEO[g], 'gloss', C(c), x, y, z, sx, sy, sz, ry, line, rx, rz);
  const L = (g, c, k, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) => B.add(GEO[g], 'glow', col(c, k), x, y, z, sx, sy, sz, ry, false, rx, rz);
  const lit = th.dark > 0.2;
  const anim = [];

  // ---------------------------------------------------------------- trees and plants
  function tree(x, z, sc, style, seed) {
    const r = 0.95 * sc;
    if (style === 'pine') {
      T('cyl', '#6b4a32', x, 0.4, z, 0.24, 0.8, 0.24, 0, true);
      for (let i = 0; i < 3; i++) {
        const ty = 0.7 + i * r * 0.62, tw = r * (1.05 - i * 0.25) * 2;
        T('cone', i % 2 ? '#3f7a5a' : '#356b4e', x, ty + r * 0.45, z, tw, r * 1.05, tw, seed + i, true);
        T('cone', '#f4f8fc', x, ty + r * 0.78, z, tw * 0.45, r * 0.4, tw * 0.45, seed + i);
      }
    } else if (style === 'dead') {
      T('cone', '#6b5038', x, r * 0.75, z, 0.32, r * 1.5, 0.32, 0, true);
      for (const [a, l, hgt] of [[-0.9, 0.7, 0.9], [0.7, 0.6, 1.05], [-0.4, 0.5, 1.25]]) {
        const ry = seed + a * 2;
        T('cyl', '#6b5038', x + Math.cos(ry) * r * l * 0.3, r * hgt, z + Math.sin(ry) * r * l * 0.3, 0.09, r * l, 0.09, 0, true, Math.sin(ry) * 0.9, -Math.cos(ry) * 0.9);
      }
    } else {
      T('cyl', '#7a5236', x, 0.45, z, 0.28, 0.9, 0.28, 0, true);
      const base = style === 'fruit' ? ['#5a9a3a', '#6aaa44', '#4c8a32'] : ['#4f9a44', '#5fae4e', '#43873a'];
      const puffs = [[-0.42, 0.12, 0.62], [0.42, 0.1, 0.6], [0, -0.28, 0.72], [0, 0.18, 0.64]];
      for (let i = 0; i < puffs.length; i++) {
        const [dx, dy, rs] = puffs[i];
        T('ico', base[i % 3], x + dx * r, 0.95 + r * 0.75 - dy * r * 0.9, z + dy * r * 0.45, r * rs * 2, r * rs * 1.8, r * rs * 2, seed + i, true);
      }
      if (style === 'fruit') for (let i = 0; i < 5; i++) T('sphere', '#e04a3a', x + (hash(seed, i) - 0.5) * r * 1.4, 1.1 + r * 0.7 + hash(i, seed) * r * 0.6, z + r * 0.55, 0.14, 0.14, 0.14);
    }
  }

  function bush(x, z, seed, snow) {
    const cols = snow ? ['#5f8f78', '#6aa088', '#58856e'] : ['#4f9a44', '#62b04f', '#46883c'];
    for (let i = 0; i < 3; i++) T('ico', cols[i], x + (i - 1) * 0.26, 0.32 + (i === 1 ? 0.1 : 0), z + (i === 1 ? -0.05 : 0.05), 0.68, 0.6, 0.66, seed + i, true);
    if (snow) T('sphere', '#f4f8fc', x, 0.66, z, 0.55, 0.14, 0.4);
  }

  // ---------------------------------------------------------------- vehicles
  function vehicle(s) {
    const kind = s.kind;
    const paint = s.color ?? { tractor: '#3f8a3a', apc: '#6a7a4a', snowcat: '#e0742a', wreck: '#8a8a8a' }[kind] ?? '#8a8a8a';
    const horiz = s.horizontal ?? s.w >= s.d;
    const cx = s.x + s.w / 2, cz = s.z + s.d / 2;
    const Lg = (horiz ? s.w : s.d) - 0.15, Wd = (horiz ? s.d : s.w) - 0.3;
    const ry = horiz ? 0 : HALF_PI;
    // local (along, across) -> world
    const at = (dx, dz) => (horiz ? [cx + dx, cz + dz] : [cx + dz, cz - dx]);
    const P = (f, c, dx, y, dz, sx, sy, sz, line = true, rx = 0, rz = 0, g = 'rbox') => {
      const [x, z] = at(dx, dz);
      f(g, c, x, y, z, sx, sy, sz, ry, line, rx, rz);
    };
    const wreck = kind === 'wreck';
    const tireC = '#26262a', glass = wreck ? '#3a3a3e' : '#8fc4e0';
    if (kind === 'snowcat') {
      for (const s2 of [-1, 1]) P(T, '#2a2a30', 0, 0.32, s2 * Wd * 0.45, Lg * 0.95, 0.55, 0.42);
      P(G, paint, 0, 0.85, 0, Lg * 0.9, 0.55, Wd * 0.85);
      P(G, paint, -Lg * 0.1, 1.35, 0, Lg * 0.5, 0.55, Wd * 0.8);
      P(G, glass, -Lg * 0.1, 1.38, 0, Lg * 0.46, 0.42, Wd * 0.84, false);
      return;
    }
    if (kind === 'tractor') {
      for (const s2 of [-1, 1]) {
        P(T, tireC, -Lg * 0.28, 0.55, s2 * Wd * 0.5, 1.1, 0.34, 1.1, true, HALF_PI, 0, 'cyl');
        P(T, tireC, Lg * 0.3, 0.34, s2 * Wd * 0.45, 0.68, 0.28, 0.68, true, HALF_PI, 0, 'cyl');
      }
      P(G, paint, Lg * 0.1, 0.75, 0, Lg * 0.75, 0.55, Wd * 0.6);
      P(G, paint, -Lg * 0.2, 1.45, 0, Lg * 0.36, 0.95, Wd * 0.75);
      P(G, glass, -Lg * 0.2, 1.55, 0, Lg * 0.38, 0.6, Wd * 0.77, false);
      P(T, '#3a3a3e', Lg * 0.3, 1.4, Wd * 0.18, 0.12, 0.7, 0.12, true, 0, 0, 'cyl');
      return;
    }
    for (const [fx, fz] of [[0.32, 0.5], [-0.32, 0.5], [0.32, -0.5], [-0.32, -0.5]]) P(T, tireC, Lg * fx, 0.36, Wd * fz, 0.72, 0.28, 0.72, true, HALF_PI, 0, 'cyl');
    if (kind === 'apc') {
      P(G, paint, 0, 0.8, 0, Lg, 0.9, Wd);
      P(G, shadeCol(paint, -0.15), Lg * 0.05, 1.42, 0, Lg * 0.34, 0.36, Wd * 0.5);
      P(T, '#3a3f34', Lg * 0.32, 1.45, 0, 0.12, Lg * 0.4, 0.12, true, 0, HALF_PI, 'cyl');
      return;
    }
    P(G, paint, 0, 0.66, 0, Lg, 0.62, Wd, true, 0, wreck ? 0.03 : 0);
    P(G, paint, -Lg * 0.06, 1.16, 0, Lg * 0.52, 0.48, Wd * 0.92);
    P(G, glass, -Lg * 0.06, 1.18, 0, Lg * 0.48, 0.38, Wd * 0.96, false);
    if (wreck) {
      P(T, '#6a4a3a', Lg * 0.2, 0.98, Wd * 0.1, Lg * 0.3, 0.03, Wd * 0.5, false);
      return;
    }
    for (const sd of [-1, 1]) {
      const [hx, hz] = at(Lg / 2 + 0.01, sd * Wd * 0.32), [bx, bz] = at(-Lg / 2 - 0.01, sd * Wd * 0.32);
      L('box', '#fff2cc', 2.2, hx, 0.72, hz, 0.05, 0.14, 0.26, ry);
      L('box', '#ff3a2a', 1.8, bx, 0.72, bz, 0.05, 0.14, 0.26, ry);
    }
  }

  // ---------------------------------------------------------------- solids
  for (const s of world.solids) {
    const cx = s.x + s.w / 2, cz = s.z + s.d / 2, h = s.h, seed = s.seed || 1;
    switch (s.kind) {
      case 'tree':
        tree(s.x + 0.5, s.z + 0.5, s.s || 1, s.variant || th.tree, seed);
        break;
      case 'bush':
        bush(s.x + 0.5, s.z + 0.5, seed, th.tree === 'pine');
        break;
      case 'rock': {
        const c = th.tree === 'pine' ? '#9eaab8' : th.tree === 'dead' ? '#b89a70' : '#a19c94';
        T('ico', c, cx, h * 0.34, cz, s.w * 0.95, h * 0.78, s.d * 0.9, seed, true);
        T('ico', shadeCol(c, 0.14), cx - s.w * 0.15, h * 0.62, cz - 0.1, s.w * 0.45, h * 0.4, s.d * 0.45, seed * 2, true);
        break;
      }
      case 'wall':
      case 'concrete':
      case 'lab': {
        const c = s.color || (s.kind === 'concrete' ? '#b9b2a2' : s.kind === 'lab' ? '#7c8190' : th.wall);
        T('box', c, cx, h / 2, cz, s.w, h, s.d);
        T('box', shadeCol(c, -0.2), cx, h + 0.05, cz, s.w + 0.08, 0.1, s.d + 0.08);
        T('box', shadeCol(c, -0.12), cx, h * 0.45, s.z + s.d + 0.006, Math.max(0.1, s.w - 0.12), 0.07, 0.02);
        break;
      }
      case 'building': {
        const wall = s.color || th.wall, roof = s.roof || th.roof;
        T('box', wall, cx, h / 2, cz, s.w, h, s.d);
        const ridgeX = s.w >= s.d, span = ridgeX ? s.d : s.w, rh = Math.min(1.8, span * 0.42);
        T('prism', roof, cx, h + rh / 2, cz, (ridgeX ? s.w : s.d) + 0.5, rh, span + 0.5, ridgeX ? 0 : HALF_PI, true);
        T('box', shadeCol(roof, -0.25), cx, h + 0.04, cz, s.w + 0.5, 0.08, s.d + 0.5);
        // ridge cap and shingle rows down both slopes
        const len = (ridgeX ? s.w : s.d) + 0.5, half = (span + 0.5) / 2, a = Math.atan2(rh, half);
        const dark = shadeCol(roof, -0.22), na = Math.cos(a) * 0.03, nb = Math.sin(a) * 0.03;
        T('box', dark, cx, h + rh, cz, ridgeX ? len : 0.16, 0.12, ridgeX ? 0.16 : len, 0);
        for (const f of [0.22, 0.45, 0.68]) {
          const y = h + rh * f + na, off = half * (1 - f) + nb;
          if (ridgeX) for (const sd of [-1, 1]) T('box', dark, cx, y, cz + sd * off, len - 0.1, 0.04, 0.08, 0, false, sd * a);
          else for (const sd of [-1, 1]) T('box', dark, cx + sd * off, y, cz, 0.08, 0.04, len - 0.1, 0, false, 0, -sd * a);
        }
        const n = Math.max(1, Math.floor(s.w / 2.2)), fz = s.z + s.d;
        for (let i = 0; i < n; i++) {
          const wx = s.x + ((i + 0.5) / n) * s.w;
          if (n > 2 && i === Math.floor(n / 2)) {
            T('rbox', '#7a4e30', wx, h * 0.36, fz + 0.03, 0.7, h * 0.72, 0.1);
            continue;
          }
          T('box', '#3a2e2a', wx, h * 0.6, fz + 0.02, 0.74, 0.64, 0.05);
          if (lit && (seed * 13 + i) % 3 < 1.4) L('box', '#ffd88a', 2.4, wx, h * 0.6, fz + 0.05, 0.58, 0.5, 0.03);
          else G('box', '#4a6a90', wx, h * 0.6, fz + 0.05, 0.58, 0.5, 0.03, 0, false);
        }
        break;
      }
      case 'car':
      case 'tractor':
      case 'apc':
      case 'snowcat':
      case 'wreck':
        vehicle(s);
        break;
      case 'crate': {
        T('rbox', '#c48a4e', cx, h / 2, cz, s.w - 0.1, h, s.d - 0.1, 0, true);
        const dg = Math.hypot(s.w - 0.3, h - 0.3), a = Math.atan2(h - 0.3, s.w - 0.3);
        for (const sg of [-1, 1]) T('box', '#8a5a30', cx, h / 2, s.z + s.d - 0.04, dg, 0.08, 0.03, 0, false, 0, sg * a);
        break;
      }
      case 'barrel':
      case 'tank': {
        const barrel = s.kind === 'barrel';
        const c = barrel ? ['#b0473a', '#3f6fa0', '#5f8a3a'][Math.floor(seed) % 3] : '#9aa3ad';
        const r = barrel ? s.w * 0.42 : Math.min(s.w, s.d) * 0.46;
        const hh = barrel ? h * 0.9 : h;
        G('cyl', c, cx, hh / 2, cz, r * 2, hh, r * 2, 0, true);
        for (const f of [0.3, 0.72]) T('cyl', shadeCol(c, -0.25), cx, hh * f, cz, r * 2 + 0.03, 0.05, r * 2 + 0.03);
        if (!barrel) G('dome', shadeCol(c, 0.12), cx, hh, cz, r * 2, r * 0.8, r * 2, 0, true);
        break;
      }
      case 'hay':
        T('rbox', '#e8c766', cx, h / 2, cz, s.w - 0.05, h, s.d - 0.05, 0, true);
        for (const f of [0.3, 0.7]) T('box', '#c9a548', s.w >= s.d ? s.x + s.w * f : cx, h / 2, s.w >= s.d ? cz : s.z + s.d * f, s.w >= s.d ? 0.06 : s.w + 0.02, h + 0.02, s.w >= s.d ? s.d + 0.02 : 0.06);
        break;
      case 'fence':
      case 'rail': {
        const c = s.kind === 'rail' ? '#7a7f88' : '#9a6a3e';
        const horiz = s.w >= s.d, len = horiz ? s.w : s.d;
        for (let i = 0; i <= len; i += 1.5) {
          const t = Math.min(i, len - 0.3) + 0.15;
          T('box', c, horiz ? s.x + t : cx, 0.45, horiz ? cz : s.z + t, 0.14, 0.9, 0.14, 0, true);
        }
        for (const y of [0.36, 0.7]) T('box', shadeCol(c, 0.1), cx, y, cz, horiz ? len - 0.2 : 0.08, 0.1, horiz ? 0.08 : len - 0.2, 0, true);
        break;
      }
      case 'sandbag': {
        const horiz = s.w >= s.d, n = Math.max(s.w, s.d) * 2;
        for (let layer = 0; layer < 2; layer++) {
          for (let i = 0; i < n - layer; i++) {
            const t = (i + 0.5 + layer * 0.5) * 0.5;
            T('sphere', (i + layer) % 2 ? '#c8ac7a' : '#b89c6a', horiz ? s.x + t : cx, 0.2 + layer * 0.34, horiz ? cz : s.z + t, horiz ? 0.56 : 0.7, 0.36, horiz ? 0.7 : 0.56, 0, true);
          }
        }
        break;
      }
      case 'table':
      case 'bench': {
        const c = '#b07a48', top = s.kind === 'table' ? Math.max(0.75, h) : 0.48;
        T('rbox', c, cx, top, cz, s.w - 0.1, 0.12, s.d - 0.2, 0, true);
        for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) T('box', '#8a5a34', cx + fx * (s.w / 2 - 0.2), top / 2, cz + fz * (s.d / 2 - 0.2), 0.1, top, 0.1);
        break;
      }
      case 'log': {
        const horiz = s.w >= s.d, len = Math.max(s.w, s.d) - 0.1;
        T('cyl', '#8a5a34', cx, 0.34, cz, 0.68, len, 0.68, 0, true, horiz ? 0 : HALF_PI, horiz ? HALF_PI : 0);
        break;
      }
      case 'bed':
        T('rbox', '#8a6a4a', cx, 0.2, cz, s.w - 0.1, 0.4, s.d - 0.1, 0, true);
        T('rbox', '#e8e4dc', cx, 0.47, cz, s.w - 0.22, 0.16, s.d - 0.22);
        T('rbox', '#ffffff', cx, 0.6, s.z + 0.4, s.w - 0.5, 0.14, 0.4);
        break;
      case 'silo':
        T('cyl', '#c4c8cc', cx, h / 2, cz, s.w, h, s.d, 0, true);
        T('dome', '#d8dce0', cx, h, cz, s.w, s.w * 0.7, s.d, 0, true);
        for (const f of [0.3, 0.65]) T('cyl', '#a8adb2', cx, h * f, cz, s.w + 0.04, 0.08, s.d + 0.04);
        break;
      case 'windmill':
        T('frustum', '#b89a7a', cx, h / 2, cz, s.w * 0.9, h, s.d * 0.9, 0, true);
        T('cone', '#8a6a4a', cx, h + 0.4, cz, s.w * 0.7, 0.8, s.d * 0.7, 0, true);
        anim.push({ k: 'windmill', x: cx, y: h - 0.2, z: s.z + s.d * 0.5 + s.d * 0.35 });
        break;
      case 'well':
      case 'fountain':
        T('cyl', '#a8a49c', cx, 0.3, cz, s.w, 0.6, s.d, 0, true);
        G('cyl', '#5aa9d6', cx, 0.56, cz, s.w * 0.78, 0.05, s.d * 0.78);
        if (s.kind === 'fountain') {
          T('cyl', '#b8b4ac', cx, 0.9, cz, 0.3, 1.2, 0.3, 0, true);
          T('cyl', '#a8a49c', cx, 1.4, cz, s.w * 0.4, 0.12, s.d * 0.4, 0, true);
          anim.push({ k: 'fountain', x: cx, z: cz });
        } else {
          for (const sg of [-1, 1]) T('box', '#6a4a2a', cx + sg * s.w * 0.42, 0.95, cz, 0.12, 1.3, 0.12);
          T('prism', '#8a5a3a', cx, 1.75, cz, s.w + 0.2, 0.5, s.d * 0.7, 0, true);
        }
        break;
      case 'tent': {
        const horiz = s.w >= s.d;
        T('prism', '#8f9a64', cx, h / 2, cz, horiz ? s.w : s.d, h, horiz ? s.d : s.w, horiz ? 0 : HALF_PI, true);
        T('box', '#3e4430', horiz ? cx : cx, h * 0.3, horiz ? s.z + s.d - 0.02 : s.z + s.d - 0.02, 0.6, h * 0.6, 0.04);
        break;
      }
      case 'container': {
        const c = s.color || '#a8503a';
        T('box', c, cx, h / 2, cz, s.w, h, s.d);
        for (let x = s.x + 0.4; x < s.x + s.w - 0.2; x += 0.5) T('box', shadeCol(c, -0.18), x, h / 2, s.z + s.d + 0.01, 0.06, h - 0.2, 0.03);
        T('box', shadeCol(c, -0.22), cx, h + 0.03, cz, s.w + 0.04, 0.06, s.d + 0.04);
        break;
      }
      case 'console':
      case 'generator':
      case 'transformer':
      case 'pump': {
        const c = { console: '#454a58', generator: '#d6a93a', transformer: '#8a949c', pump: '#d24a3a' }[s.kind];
        T('rbox', c, cx, h / 2, cz, s.w - 0.1, h, s.d - 0.1, 0, true);
        if (s.kind === 'console') L('box', '#5adcff', 1.8, cx, h + 0.02, cz, s.w - 0.4, 0.03, s.d - 0.36, 0, -0.25);
        else if (s.kind === 'transformer') L('box', '#f2c230', 1.6, cx, h * 0.55, s.z + s.d - 0.04, 0.35, 0.35, 0.03, 0, 0, 0.78);
        else if (s.kind === 'generator') T('box', '#3a3a3e', cx, h * 0.5, s.z + s.d - 0.04, s.w * 0.6, h * 0.5, 0.04);
        else T('cyl', '#3a3a3e', cx + s.w * 0.25, h + 0.2, cz, 0.1, 0.4, 0.1);
        break;
      }
      case 'tower':
        T('box', '#9a8a6a', cx, h / 2, cz, s.w, h, s.d);
        T('rbox', '#7a6248', cx, h + 0.15, cz, s.w + 0.6, 0.3, s.d + 0.6, 0, true);
        break;
      case 'reactor':
        T('cyl', '#5a6070', cx, 0.4, cz, s.w, 0.8, s.d, 0, true);
        T('torus', '#3a3f4a', cx, 0.82, cz, s.w * 0.9, s.d * 0.9, 1.5, 0, false, HALF_PI);
        anim.push({ k: 'reactor', x: cx, z: cz, r: s.w * 0.36 });
        break;
      case 'campfire': {
        const x = s.x + 0.5, z = s.z + 0.5;
        for (const sg of [-1, 1]) T('cyl', '#6a4024', x, 0.1, z, 0.14, 0.85, 0.14, 0, true, HALF_PI, sg * 0.7);
        for (let i = 0; i < 6; i++) T('ico', '#8a8a86', x + Math.cos(i) * 0.42, 0.08, z + Math.sin(i) * 0.42, 0.2, 0.16, 0.2, i);
        anim.push({ k: 'campfire', x, z });
        break;
      }
      case 'lamp': {
        const x = s.x + 0.5, z = s.z + 0.5;
        T('cyl', '#3a3a40', x, (h + 0.4) / 2, z, 0.12, h + 0.4, 0.12);
        T('cyl', '#3a3a40', x, h + 0.45, z, 0.34, 0.12, 0.34);
        L('sphere', '#ffe9a8', 3, x, h + 0.3, z, 0.34, 0.3, 0.34);
        break;
      }
      case 'grave': {
        const x = s.x + 0.5, z = s.z + 0.55;
        T('rbox', '#9a9ea6', x, 0.36, z, 0.6, 0.72, 0.18, 0, true);
        T('box', '#5a5e66', x, 0.45, z + 0.1, 0.06, 0.32, 0.02);
        T('box', '#5a5e66', x, 0.52, z + 0.1, 0.22, 0.06, 0.02);
        break;
      }
      case 'water':
        break; // drawn as a water surface by the renderer
      default:
        T('rbox', '#a8a8a8', cx, h / 2, cz, s.w, h, s.d, 0, true);
    }
  }

  // ---------------------------------------------------------------- machines and decorations
  for (const o of statics) {
    switch (o.k) {
      case 'perk': {
        const c = PERKS[o.perk].color, z = o.z + 0.1;
        T('rbox', c, o.x, 0.85, z, 1.0, 1.7, 0.62, 0, true);
        L('box', shadeCol(c, 0.55), 1.6, o.x, 1.2, z + 0.32, 0.72, 0.6, 0.03);
        T('box', '#2a2226', o.x, 0.42, z + 0.32, 0.4, 0.16, 0.03);
        L('box', shadeCol(c, 0.3), 2, o.x, 1.72, z, 1.04, 0.06, 0.66);
        break;
      }
      case 'forge': {
        const z = o.z + 0.05;
        T('rbox', '#4a4a56', o.x, 0.3, z, 1.6, 0.6, 0.8, 0, true);
        L('box', '#ff8a3a', 2.4, o.x, 0.61, z, 1.1, 0.04, 0.45);
        T('cyl', '#30303a', o.x + 0.6, 0.9, z - 0.2, 0.22, 0.8, 0.22, 0, true);
        break;
      }
      case 'shop': {
        const z = o.z + 0.1;
        T('rbox', '#7a52b8', o.x, 0.65, z, 1.5, 1.3, 0.6, 0, true);
        T('box', '#1c1430', o.x, 0.95, z + 0.31, 1.2, 0.56, 0.03);
        break;
      }
      case 'station':
        T('rbox', '#5a6070', o.x, 0.3, o.z + 0.1, 0.9, 0.6, 0.6, 0, true);
        break;
      case 'sign': {
        T('cyl', '#5a3a20', o.x, 0.8, o.z, 0.1, 1.6, 0.1);
        signBoard(parent, o);
        break;
      }
      case 'scarecrow':
        T('cyl', '#6a4a2a', o.x, 0.8, o.z, 0.1, 1.6, 0.1);
        T('box', '#6a4a2a', o.x, 1.18, o.z, 1.2, 0.09, 0.09);
        T('rbox', '#8a5a3a', o.x, 1.05, o.z, 0.55, 0.6, 0.3, 0, true);
        T('sphere', '#e8d8a0', o.x, 1.62, o.z, 0.46, 0.46, 0.46, 0, true);
        T('cyl', '#c9a050', o.x, 1.84, o.z, 0.85, 0.05, 0.85, 0, true);
        T('dome', '#d8b55a', o.x, 1.84, o.z, 0.45, 0.32, 0.45, 0, true);
        break;
      case 'reeds':
        for (let i = 0; i < 4; i++) T('cone', '#5a8a3a', o.x + (i - 1.5) * 0.12, 0.38, o.z + (i % 2) * 0.1, 0.07, 0.76, 0.07, 0, false, 0, (i - 1.5) * 0.12);
        break;
      case 'canopy':
        for (const [fx, fz] of [[0.15, 0.15], [o.w - 0.15, 0.15], [0.15, o.d - 0.15], [o.w - 0.15, o.d - 0.15]]) T('cyl', '#8a8a90', o.x + fx, 1.05, o.z + fz, 0.1, 2.1, 0.1);
        T('rbox', '#e8e4dc', o.x + o.w / 2, 2.15, o.z + o.d / 2, o.w, 0.14, o.d, 0, true);
        T('box', '#c0392b', o.x + o.w / 2, 2.1, o.z + o.d - 0.1, o.w + 0.02, 0.2, 0.22);
        break;
    }
  }
  return anim;
}

// signs get their text as a small texture
function signBoard(parent, o) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = 'bold 44px Fredoka, Segoe UI';
  const tw = Math.ceil(g.measureText(o.text).width) + 40;
  c.width = tw;
  c.height = 72;
  g.fillStyle = '#c49a64';
  g.fillRect(0, 0, tw, 72);
  g.strokeStyle = 'rgba(40,30,30,0.85)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, tw - 6, 66);
  g.font = 'bold 44px Fredoka, Segoe UI';
  g.fillStyle = '#3a2410';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(o.text, tw / 2, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = (tw / 72) * 0.7;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, 0.1), new THREE.MeshToonMaterial({ map: tex }));
  m.position.set(o.x, 1.75, o.z);
  m.castShadow = true;
  parent.add(m);
}
