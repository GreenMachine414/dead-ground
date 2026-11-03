// 3D survivors and zombies, shared by the game, the menu backdrop and the character portraits.
// Everything on the head is fitted to the head's actual shape: hats and hair are shells that
// start above the eyes and fully enclose the head above that line (so the head can't show
// through), and eyes, cheeks and mouths sit on the head's surface rather than inside it.
import { col, shadeCol } from './models3d.js';
import { FORGE_PAINT } from './sprites.js';
import { WEAPONS } from '../data/weapons.js';

export const MODEL = 1.12; // characters a little chunkier than their 2D footprint, as in the concept art
export const GUN_Y = 0.86; // gun and tracer height
const HALF_PI = Math.PI / 2;
const HEAD_Y = 1.38; // head centre above the feet
const HV = 0.95; // head height / width

// depth of the head's front surface at (dx, dy) from its centre, head radius hr
function surf(hr, dx, dy) {
  const k = 1 - (dx / hr) * (dx / hr) - (dy / (HV * hr)) * (dy / (HV * hr));
  return k > 0 ? hr * Math.sqrt(k) : 0;
}

// A head shell (hat or hair) as a dome from `base` (above the head centre) with radius R and
// height H, all in head radii. Containment needs R >= the head's width at the base and the dome
// to stay outside the head above it; the shapes below were checked against that.
function shell(P, mat, c, hy, hr, R, H, base, zoff = 0) {
  P.put('dome', mat, c, 0, hy + base * hr, zoff * hr, 2 * R * hr, 2 * H * hr, 2 * R * hr, 0, 0, 0, true);
}

// A survivor or zombie: rounded body parts in the 2D sprite's colours, facing aim angle `a`.
// opt: gun, forged, down, fall (0..1 of falling over), hurt, attack, y (sink), seed
export function drawPerson(P, t, x, z, a, L, walk, moving, opt) {
  const sc = (L.scale || 1) * MODEL;
  const yaw = HALF_PI - a;
  const step = moving ? Math.sin(walk) : 0;
  const bob = moving ? Math.abs(Math.cos(walk)) * 0.05 : Math.sin(t * 2) * 0.012;
  const seed = opt.seed || 0;
  const zombie = !!L.zombie;
  const sway = zombie ? Math.sin(walk * 0.5 + seed) * 0.08 : 0;
  if (opt.down) P.root(x, 0.22 * sc + (opt.y || 0), z, yaw, sc, HALF_PI * (opt.fall ?? 1));
  else P.root(x, opt.y || 0, z, yaw, sc, 0, sway);
  const k = opt.hurt ? 0.5 : 0;
  const skin = k ? shadeCol(L.skin, k) : col(L.skin), shirt = k ? shadeCol(L.shirt, k) : col(L.shirt);
  const pants = col(L.pants), legs = shadeCol(L.pants, -0.3);
  if (L.crawler) {
    const hz = 0.56, hr = 0.31;
    P.put('rbox', 'toon', shirt, 0, 0.3, 0, 0.62, 0.38, 0.86, 0.1, 0, 0, true);
    P.put('sphere', 'toon', skin, 0, 0.42, hz, hr * 2, hr * 2 * HV, hr * 2, 0, 0, 0, true);
    for (const s of [-1, 1]) {
      P.put('sphere', 'glow', col(L.eyes, 2.6), s * 0.11, 0.47, hz + surf(hr, 0.11, 0.05) - 0.01, 0.1, 0.12, 0.07);
      P.put('rbox', 'toon', skin, s * 0.3, 0.16, 0.66 + step * s * 0.1, 0.15, 0.15, 0.6, 0, 0, 0, true);
    }
    return;
  }
  for (const s of [-1, 1]) {
    const sw = s * step * 0.55;
    P.put('rbox', 'toon', legs, s * 0.14, 0.46 - 0.23 * Math.cos(sw), -0.23 * Math.sin(sw), 0.22, 0.46, 0.26, sw, 0, 0, true);
  }
  const bw = L.belly ? 0.84 : 0.6;
  P.put('rbox', 'toon', pants, 0, 0.56 + bob, 0, bw, 0.22, 0.42, 0, 0, 0, true);
  P.put('rbox', 'toon', shirt, 0, 0.85 + bob, 0, bw, 0.44, 0.44, 0, 0, 0, true);
  if (L.belly) P.put('sphere', 'toon', shadeCol(L.skin, 0.1), 0, 0.74 + bob, 0.2, 0.66, 0.52, 0.36, 0, 0, 0, true);
  if (zombie) P.put('sphere', 'toon', shadeCol(L.shirt, -0.3), -0.12, 0.8 + bob, 0.225, 0.12, 0.12, 0.04);
  if (L.armor) {
    P.put('rbox', 'toon', col('#6e767e'), 0, 0.88 + bob, 0.24, 0.68, 0.38, 0.1, 0, 0, 0, true);
    for (const s of [-1, 1]) P.put('sphere', 'toon', col('#5f676f'), s * 0.34, 1.06 + bob, 0, 0.26, 0.2, 0.3, 0, 0, 0, true);
  }
  // head and face
  const hr = L.bigHead ? 0.42 : 0.34;
  const hy = HEAD_Y + bob + (L.bigHead ? 0.06 : 0) + (zombie ? Math.sin(t * 3 + seed) * 0.02 : 0);
  P.put('sphere', 'toon', skin, 0, hy, 0, hr * 2, hr * 2 * HV, hr * 2, 0, 0, 0, true);
  const ex = hr * 0.36, ey = hr * 0.09, ez = surf(hr, ex, ey);
  for (const s of [-1, 1]) {
    if (zombie) P.put('sphere', 'glow', col(L.eyes, 2.6), s * ex, hy + ey, ez - 0.01, 0.11, 0.13, 0.08);
    else {
      P.put('sphere', 'toon', col('#ffffff'), s * ex, hy + ey, ez - 0.02, 0.13, 0.16, 0.08);
      P.put('sphere', 'glow', col('#2a2230'), s * ex, hy + ey - 0.01, ez + 0.012, 0.07, 0.09, 0.05);
    }
  }
  if (zombie) {
    const my = -hr * 0.38;
    P.put('box', 'glow', col('#3a1010'), 0, hy + my, surf(hr, 0, my) - 0.005, L.scream ? 0.16 : 0.14, L.scream ? 0.13 : 0.05, 0.04);
  } else {
    const cx = hr * 0.58, cy = -hr * 0.24, cz = surf(hr, cx, cy);
    for (const s of [-1, 1]) P.put('sphere', 'glow', col('#e88a80'), s * cx, hy + cy, cz - 0.012, 0.1, 0.06, 0.04);
  }
  if (L.hair) shell(P, 'toon', col(L.hair), hy, hr, 1.1, 0.92, 0.12, -0.05);
  if (L.hat) hat(P, L.hat, hy, hr);
  // arms
  if (zombie) {
    const reach = opt.attack ? 0.78 : 0.6;
    for (const s of [-1, 1]) {
      const wob = Math.sin(t * 6 + s) * 0.12;
      P.put('rbox', 'toon', skin, s * 0.27, 0.95 + bob + wob * 0.2, reach * 0.5 + 0.06, 0.16, 0.16, reach, -0.08 + wob * 0.3, 0, 0, true);
    }
  } else if (opt.gun) {
    for (const s of [-1, 1]) P.put('rbox', 'toon', skin, s * 0.19, 0.92 + bob, 0.24, 0.15, 0.15, 0.46, 0.15, -s * 0.42, 0, true);
    drawGun(P, t, opt.gun, opt.forged, GUN_Y + bob, 0.46);
  } else {
    for (const s of [-1, 1]) P.put('rbox', 'toon', skin, s * 0.38, 0.85 + bob, 0, 0.15, 0.48, 0.15, step * s * 0.4, 0, s * 0.12, true);
  }
}

// Hats: shells sized so they enclose the head (and any hair shell) above their base line
function hat(P, h, hy, hr) {
  switch (h) {
    case 'hardhat':
      shell(P, 'toon', col('#e8b82c'), hy, hr, 1.18, 1.0, 0.2);
      P.put('cyl', 'toon', col('#d49c1c'), 0, hy + 0.2 * hr, 0.06 * hr, 2.6 * hr, 0.04, 2.7 * hr, 0, 0, 0, true);
      break;
    case 'goggles': {
      shell(P, 'toon', col('#6b4a2a'), hy, hr, 1.16, 0.9, 0.2);
      const lx = 0.36 * hr, lz = Math.sqrt(Math.max(0, (1.115 * hr) ** 2 - lx * lx));
      for (const s of [-1, 1]) P.put('sphere', 'gloss', col('#7fd6ff'), s * lx, hy + 0.45 * hr, lz - 0.01, 0.17, 0.17, 0.1, 0, 0, 0, true);
      break;
    }
    case 'cap': {
      shell(P, 'toon', col('#f4f4f0'), hy, hr, 1.16, 0.95, 0.2);
      P.put('box', 'toon', col('#f4f4f0'), 0, hy + 0.2 * hr + 0.02, 1.06 * hr + 0.25 * hr, 1.25 * hr, 0.035, 0.55 * hr, 0, 0, 0, true);
      const cz = 1.078 * hr + 0.005;
      P.put('box', 'glow', col('#d63a3a', 1.2), 0, hy + 0.55 * hr, cz, 0.05, 0.15, 0.02);
      P.put('box', 'glow', col('#d63a3a', 1.2), 0, hy + 0.55 * hr, cz, 0.15, 0.05, 0.02);
      break;
    }
    case 'beanie':
      shell(P, 'toon', col('#3f6a5a'), hy, hr, 1.16, 1.05, 0.15);
      P.put('cyl', 'toon', col('#2f5246'), 0, hy + 0.21 * hr, 0, 2.42 * hr, 0.1, 2.42 * hr, 0, 0, 0, true);
      P.put('sphere', 'toon', col('#e8d8b0'), 0, hy + 1.2 * hr + 0.05, 0, 0.15, 0.15, 0.15, 0, 0, 0, true);
      break;
    case 'helmet':
    case 'zhelmet': {
      const c = h === 'helmet' ? ['#5f7040', '#4f6034'] : ['#6a747e', '#5a646e'];
      shell(P, 'toon', col(c[0]), hy, hr, 1.22, 1.0, 0.18);
      P.put('cyl', 'toon', col(c[1]), 0, hy + 0.18 * hr, 0, 2.5 * hr, 0.05, 2.5 * hr);
      break;
    }
    case 'hair':
      shell(P, 'toon', col('#ece6ff'), hy, hr, 1.12, 0.95, 0.1, -0.05);
      P.put('sphere', 'toon', col('#ece6ff'), 0.65 * hr, hy + 0.55 * hr, -0.62 * hr, 0.22, 0.22, 0.22, 0, 0, 0, true);
      break;
    case 'straw':
      P.put('cyl', 'toon', col('#e3c46a'), 0, hy + 0.3 * hr, 0, 3.6 * hr, 0.05, 3.6 * hr, 0, 0, 0, true);
      shell(P, 'toon', col('#d8b55a'), hy, hr, 1.06, 0.82, 0.3);
      break;
    case 'officer':
      P.put('cyl', 'toon', col('#4a5a32'), 0, hy + 0.64 * hr, 0, 2.06 * hr, 0.78 * hr, 2.06 * hr, 0, 0, 0, true);
      P.put('cyl', 'toon', col('#3e4a2a'), 0, hy + 1.03 * hr, 0.06 * hr, 2.4 * hr, 0.06, 2.5 * hr, 0, 0, 0, true);
      P.put('sphere', 'glow', col('#f2c230', 1.6), 0, hy + 0.6 * hr, 1.03 * hr + 0.01, 0.1, 0.1, 0.05);
      break;
    case 'crown': {
      const sy = hy + 0.76 * hr + 0.12;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        P.put('cone', 'glow', col('#7fd0ff', 1.6), Math.sin(ang) * hr * 0.6, sy, Math.cos(ang) * hr * 0.6, 0.12, 0.34, 0.12);
      }
      P.put('cyl', 'glow', col('#5ab0e0', 1.3), 0, hy + 0.8 * hr, 0, hr * 1.4, 0.08, hr * 1.4);
      break;
    }
  }
}

// boss and special-zombie extras, in the frame drawPerson() just set
export function drawExtras(P, t, type, attack) {
  switch (type) {
    case 'harvester': {
      // scythe held upright in the right hand, blade at the top drooping outward
      // (the shaft passes through the right hand at the end of the reaching arm)
      const z = attack ? 0.78 : 0.6, tilt = 0.12 + Math.sin(t * 2) * 0.06;
      P.put('cyl', 'toon', col('#6b4a2a'), 0.27, 1.0, z, 0.09, 1.7, 0.09, tilt, 0, 0, true);
      P.put('rbox', 'gloss', col('#cfd4d8'), 0.27 + 0.48, 1.82, z + 0.1 + tilt * 0.8, 1.0, 0.06, 0.26, 0, 0, -0.3, true);
      break;
    }
    case 'spitter':
      for (const [dx, dz] of [[-0.12, 0], [0.12, 0.05], [0.02, -0.1]]) {
        const r = Math.hypot(dx, dz);
        P.put('sphere', 'glow', col('#9dff4a', 1.8), dx, HEAD_Y + HV * 0.34 * Math.sqrt(1 - (r / 0.34) ** 2), dz, 0.13, 0.13, 0.13);
      }
      break;
    case 'hivequeen':
      for (let i = 0; i < 4; i++) P.put('sphere', 'add', col('#78d2ff', 0.7), -0.39 + i * 0.26, 0.66, 0.35, 0.26, 0.26, 0.26);
      break;
    case 'patientzero':
      // tendrils out of the upper back, leaning away from the head
      for (let i = 0; i < 4; i++) P.put('cyl', 'glow', col('#ff2828', 1.8), -0.2 + i * 0.13, 1.15, -0.36, 0.04, 0.6, 0.04, -0.5 + Math.sin(t * 5 + i) * 0.2, 0, (i - 1.5) * 0.25);
      break;
    case 'abomination':
      for (const s of [-1, 1]) P.put('rbox', 'toon', col('#b08070'), s * 0.42, 0.7 + Math.sin(t * 4 + s) * 0.06, 0.32, 0.2, 0.2, 0.7, 0.2, s * 0.5, 0, true);
      break;
    case 'general':
      // medals on the armour plate
      for (let i = 0; i < 3; i++) P.put('sphere', 'glow', col('#f2c230', 1.6), 0.1 + i * 0.08, 0.8, 0.3, 0.06, 0.06, 0.03);
      break;
  }
}

// ------------------------------------------------------------------ guns
// Each gun follows its 2D sprite: the same parts at the same places along its length (stock,
// barrel, receiver, grip, magazine and the gun's own extras) in the same colours, plus 3D detail:
// a round barrel and muzzle, sights, trigger guard, and per-gun parts (pump, drum, coils...).
const STOCK = new Set(['shotgun', 'sniper', 'ar', 'lmg', 'crossbow']);
const NO_MAG = new Set(['shotgun', 'flamethrower', 'revolver', 'crossbow', 'tesla', 'raygun']);
const WOOD = '#8a5a34', STEEL = '#3a3d44', BLACK = '#1e2024';
const T = 0.1; // the sprite's thickness unit, in world units

// gun length in world units (grip 30% of the way from the butt, as on the sprite)
export function gunLength(wid) {
  return (WEAPONS[wid] || WEAPONS.pistol).len * 1.3;
}

// A gun along +z in the current frame with its grip at (0, y, zg); forged = forge level 0..2
export function drawGun(P, t, wid, forged, y, zg) {
  const W = WEAPONS[wid] || WEAPONS.pistol;
  const paint = FORGE_PAINT[+forged || 0];
  const L = gunLength(wid);
  const zf = (f) => zg + (f - 0.3) * L; // a point f (0 butt .. 1 muzzle) along the gun
  const bodyC = paint ? paint.body : W.gunColor, metalC = paint ? paint.metal : STEEL;
  const body = col(bodyC), metal = col(metalC), grip = shadeCol(bodyC, -0.3), black = col(BLACK);
  const barrelD = wid === 'gl' ? T * 1.4 : wid === 'shotgun' ? T * 0.75 : T * 0.6;
  // receiver, barrel, muzzle
  P.put('rbox', 'toon', body, 0, y, zf(0.45), 0.085, T * 1.35, 0.5 * L, 0, 0, 0, true);
  if (wid !== 'minigun') {
    P.put('cyl', 'gloss', metal, 0, y + 0.005, zf(0.82), barrelD, 0.36 * L, barrelD, HALF_PI, 0, 0, true);
    P.put('cyl', 'toon', black, 0, y + 0.005, zf(1.0), barrelD * 1.3, 0.05, barrelD * 1.3, HALF_PI);
  }
  // grip, trigger guard, sights
  P.put('rbox', 'toon', grip, 0, y - 0.12, zf(0.3), 0.07, 0.17, 0.09, 0.28, 0, 0, true);
  P.put('torus', 'toon', black, 0, y - 0.075, zf(0.37), 0.09, 0.09, 0.09, 0, HALF_PI, 0);
  if (wid !== 'sniper' && wid !== 'minigun') P.put('box', 'toon', black, 0, y + T * 0.72, zf(0.66), 0.02, 0.04, 0.03);
  P.put('box', 'toon', black, 0, y + T * 0.75, zf(0.95), 0.02, 0.05, 0.03);
  if (STOCK.has(wid)) {
    P.put('rbox', 'toon', col(WOOD), 0, y - 0.02, zf(0.18), 0.075, T * 1.3, 0.3 * L, -0.08, 0, 0, true);
    P.put('rbox', 'toon', black, 0, y - 0.03, zf(0.03), 0.08, T * 1.45, 0.03);
  }
  if (!NO_MAG.has(wid)) {
    const big = wid === 'lmg';
    P.put('rbox', 'gloss', shadeCol(metalC, 0.15), 0, y - (big ? 0.11 : 0.13), zf(0.44), big ? 0.12 : 0.06, big ? 0.12 : 0.15, big ? 0.15 : 0.08, -0.15, 0, 0, true);
  }
  const fx = col(paint ? paint.seam : W.color, 2.2);
  switch (wid) {
    case 'pistol':
      P.put('box', 'toon', black, 0, y + T * 0.68, zf(0.45), 0.087, 0.02, 0.45 * L);
      break;
    case 'revolver':
      P.put('cyl', 'gloss', metal, 0, y, zf(0.42), 0.14, 0.11, 0.14, HALF_PI, 0, 0, true);
      P.put('box', 'toon', black, 0, y + T * 0.65, zf(0.22), 0.03, 0.05, 0.05);
      P.put('box', 'toon', black, 0, y + T * 0.45, zf(0.8), 0.03, 0.03, 0.36 * L);
      break;
    case 'shotgun':
      P.put('rbox', 'toon', col(WOOD), 0, y - 0.04, zf(0.68), 0.095, T * 0.85, 0.2 * L, 0, 0, 0, true);
      P.put('cyl', 'gloss', metal, 0, y - 0.05, zf(0.8), 0.05, 0.3 * L, 0.05, HALF_PI);
      break;
    case 'ar':
      P.put('box', 'toon', black, 0, y + T * 0.75, zf(0.47), 0.04, 0.03, 0.3 * L);
      P.put('rbox', 'toon', shadeCol(bodyC, -0.15), 0, y, zf(0.7), 0.09, T * 1.0, 0.22 * L, 0, 0, 0, true);
      break;
    case 'gl':
      P.put('cyl', 'toon', col('#5a6a3a'), 0, y, zf(0.5), 0.22, 0.18 * L, 0.22, HALF_PI, 0, 0, true);
      for (const f of [0.43, 0.57]) P.put('cyl', 'toon', black, 0, y, zf(f), 0.23, 0.02, 0.23, HALF_PI);
      break;
    case 'sniper':
      P.put('cyl', 'toon', col('#2a2a30'), 0, y + 0.11, zf(0.51), 0.08, 0.3 * L, 0.08, HALF_PI, 0, 0, true);
      for (const f of [0.36, 0.66]) P.put('cyl', 'glow', col('#7ab8ff', 1.4), 0, y + 0.11, zf(f), 0.07, 0.01, 0.07, HALF_PI);
      for (const f of [0.43, 0.59]) P.put('box', 'toon', black, 0, y + 0.075, zf(f), 0.03, 0.04, 0.03);
      break;
    case 'flamethrower': {
      P.put('cyl', 'gloss', col('#c0392b'), 0, y + 0.12, zf(0.35), 0.15, 0.35 * L, 0.15, HALF_PI, 0, 0, true);
      for (const f of [0.18, 0.52]) P.put('cyl', 'toon', black, 0, y + 0.12, zf(f), 0.155, 0.02, 0.155, HALF_PI);
      const flick = 0.035 + Math.sin(t * 23) * 0.008;
      P.put('sphere', 'glow', col('#ff8a2a', 2.6), 0, y - 0.04, zf(1.01), flick, flick, flick);
      break;
    }
    case 'raygun':
      P.put('sphere', 'glow', fx, 0, y + 0.02, zf(0.72), 0.14, 0.14, 0.14);
      for (const f of [0.8, 0.88, 0.96]) P.put('torus', 'gloss', metal, 0, y + 0.005, zf(f), 0.16, 0.16, 0.16);
      break;
    case 'tesla':
      for (const f of [0.66, 0.73, 0.8, 0.87]) P.put('torus', 'gloss', col('#c87533'), 0, y + 0.005, zf(f), 0.14, 0.14, 0.14);
      P.put('sphere', 'glow', fx, 0, y + 0.02, zf(0.97), 0.12, 0.12, 0.12);
      break;
    case 'minigun':
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        P.put('cyl', 'gloss', col('#4a4d55'), Math.cos(a) * 0.045, y + Math.sin(a) * 0.045, zf(0.75), 0.035, 0.5 * L, 0.035, HALF_PI);
      }
      for (const f of [0.62, 0.97]) P.put('cyl', 'toon', black, 0, y, zf(f), 0.15, 0.03, 0.15, HALF_PI);
      P.put('box', 'toon', black, 0, y + T * 1.0, zf(0.42), 0.04, 0.06, 0.25 * L);
      break;
    case 'crossbow':
      for (const s of [-1, 1]) P.put('rbox', 'toon', col('#5a3a20'), s * 0.2, y, zf(0.86), 0.4, 0.04, 0.05, 0, -s * 0.35, 0, true);
      for (const s of [-1, 1]) P.put('box', 'toon', black, s * 0.17, y + 0.01, zf(0.74), 0.34, 0.01, 0.01, 0, s * 0.62, 0);
      P.put('cyl', 'toon', col('#c8c0b0'), 0, y + T * 0.7, zf(0.72), 0.025, 0.56 * L, 0.025, HALF_PI);
      P.put('cone', 'glow', col(W.color, 1.6), 0, y + T * 0.7, zf(1.01), 0.05, 0.08, 0.05, HALF_PI);
      break;
    case 'lmg':
      P.put('cyl', 'toon', shadeCol(bodyC, -0.2), 0, y + 0.005, zf(0.7), 0.11, 0.3 * L, 0.11, HALF_PI, 0, 0, true);
      for (const s of [-1, 1]) P.put('cyl', 'toon', black, s * 0.05, y - 0.1, zf(0.88), 0.02, 0.22, 0.02, 0, 0, s * 0.35);
      P.put('box', 'toon', black, 0, y + T * 0.78, zf(0.45), 0.08, 0.03, 0.3 * L);
      break;
  }
  // forged: the glowing seam along receiver and barrel
  if (paint) P.put('box', 'glow', col(paint.seam, 2.2), 0, y + 0.01, zf(0.62), 0.094, 0.02, 0.72 * L);
}
