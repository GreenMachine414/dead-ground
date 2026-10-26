// Hand-drawn style 2D sprites: everything is soft, rounded and outlined.
// All draw functions take a canvas context and a unit size `u` (pixels per world unit).
import { WEAPONS, RARITY } from '../data/weapons.js';
import { ZOMBIES } from '../data/zombies.js';
import { CHARACTERS } from '../data/characters.js';

// ------------------------------------------------------------------ colour helpers
export function hex(c) {
  if (typeof c === 'string') return c;
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}
const rgbCache = new Map();
function rgb(c) {
  if (typeof c === 'string' && rgbCache.has(c)) return rgbCache.get(c);
  let out;
  if (typeof c === 'string' && c.startsWith('rgb')) {
    out = c.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number);
  } else {
    let h = hex(c).slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  if (typeof c === 'string') rgbCache.set(c, out);
  return out;
}
export function shade(c, amt) {
  // amt < 0 darkens, > 0 lightens
  const [r, g, b] = rgb(c);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function rgba(c, a) {
  const [r, g, b] = rgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

// ------------------------------------------------------------------ shape helpers
export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function fillStroke(ctx, fill, stroke, lw) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
export function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}
export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
}
export function shadow(ctx, x, y, rx, ry, a = 0.22) {
  ellipse(ctx, x, y, rx, ry);
  ctx.fillStyle = `rgba(20,25,30,${a})`;
  ctx.fill();
}
// wobbly organic circle
export function blob(ctx, x, y, r, seed = 1, wob = 0.12, n = 9) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + Math.sin(seed * 12.9 + i * 2.3) * wob;
    const px = x + Math.cos(a) * r * k, py = y + Math.sin(a) * r * k;
    if (i === 0) ctx.moveTo(px, py);
    else {
      const pa = ((i - 0.5) / n) * Math.PI * 2;
      const pk = 1 + Math.sin(seed * 12.9 + (i - 0.5) * 2.3) * wob;
      ctx.quadraticCurveTo(x + Math.cos(pa) * r * pk * 1.06, y + Math.sin(pa) * r * pk * 1.06, px, py);
    }
  }
  ctx.closePath();
}
function hash(a, b = 0) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
const OUT = 'rgba(40,30,30,0.85)';

// ------------------------------------------------------------------ guns
const gunCache = new Map();
// Side-view gun sprite pointing right. Returns {canvas, gx, gy} where (gx,gy) is the grip.
export function gunSprite(wid, forged, scale) {
  const key = wid + (forged ? 'X' : '') + '@' + Math.round(scale);
  if (gunCache.has(key)) return gunCache.get(key);
  const w = WEAPONS[wid] || WEAPONS.pistol;
  const L = w.len * scale * 1.35;
  const cw = Math.ceil(L + scale * 0.5), ch = Math.ceil(scale * 0.7);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const body = forged ? '#9b59d0' : hex(w.gunColor);
  const metal = forged ? '#d6b0ff' : '#3a3d44';
  const t = Math.max(2, scale * 0.13);
  const y0 = ch * 0.38;
  const lw = Math.max(1.5, scale * 0.045);
  // stock
  if (['shotgun', 'sniper', 'ar', 'lmg', 'crossbow'].includes(wid)) {
    rr(g, scale * 0.04, y0, L * 0.3, t * 1.3, t * 0.5);
    fillStroke(g, '#8a5a34', OUT, lw);
  }
  // barrel
  rr(g, L * 0.25, y0 + t * 0.15, L * 0.75, t * 0.75, t * 0.35);
  fillStroke(g, metal, OUT, lw);
  // body
  rr(g, L * 0.2, y0 - t * 0.2, L * 0.5, t * 1.35, t * 0.5);
  fillStroke(g, body, OUT, lw);
  // grip
  rr(g, L * 0.26, y0 + t * 0.8, t * 0.9, t * 1.6, t * 0.4);
  fillStroke(g, shade(body, -0.3), OUT, lw);
  // magazine
  if (!['shotgun', 'flamethrower', 'revolver', 'crossbow', 'tesla', 'raygun'].includes(wid)) {
    rr(g, L * 0.42, y0 + t * 0.9, t * 0.8, t * 1.3, t * 0.3);
    fillStroke(g, shade(metal, 0.15), OUT, lw);
  }
  if (wid === 'sniper') {
    rr(g, L * 0.36, y0 - t * 1.1, L * 0.3, t * 0.7, t * 0.35);
    fillStroke(g, '#2a2a30', OUT, lw);
  }
  if (wid === 'flamethrower') {
    circle(g, L * 0.35, y0 - t * 0.3, t * 0.9);
    fillStroke(g, '#c0392b', OUT, lw);
  }
  if (wid === 'raygun' || wid === 'tesla') {
    circle(g, L * 0.72, y0 + t * 0.4, t * 0.7);
    fillStroke(g, hex(w.color), OUT, lw);
  }
  if (wid === 'minigun') {
    for (let i = 0; i < 3; i++) {
      rr(g, L * 0.5, y0 - t * 0.2 + i * t * 0.45, L * 0.5, t * 0.35, t * 0.15);
      fillStroke(g, '#4a4d55', OUT, lw * 0.7);
    }
  }
  if (wid === 'gl') {
    circle(g, L * 0.5, y0 + t * 0.4, t * 0.9);
    fillStroke(g, '#5a6a3a', OUT, lw);
  }
  if (wid === 'crossbow') {
    g.strokeStyle = '#5a3a20';
    g.lineWidth = t * 0.5;
    g.beginPath();
    g.moveTo(L * 0.85, y0 - t * 1.6);
    g.quadraticCurveTo(L * 0.7, y0 + t * 0.4, L * 0.85, y0 + t * 2.2);
    g.stroke();
  }
  const out = { canvas: c, gx: L * 0.3, gy: y0 + t * 0.9, len: L };
  gunCache.set(key, out);
  return out;
}

// Gun icon for the HUD as a data URL
const iconCache = new Map();
export function gunIconURL(wid, forged) {
  const key = wid + (forged ? 'X' : '');
  if (iconCache.has(key)) return iconCache.get(key);
  const s = gunSprite(wid, forged, 46);
  const url = s.canvas.toDataURL();
  iconCache.set(key, url);
  return url;
}

// ------------------------------------------------------------------ characters
function facingOf(a) {
  const s = Math.sin(a), c = Math.cos(a);
  if (s > 0.5) return 'down';
  if (s < -0.55) return 'up';
  return c >= 0 ? 'right' : 'left';
}

function drawGun(ctx, x, y, u, a, wid, forged) {
  const s = gunSprite(wid, forged, u);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  if (Math.cos(a) < 0) ctx.scale(1, -1);
  ctx.drawImage(s.canvas, -s.gx + u * 0.1, -s.gy + u * 0.05);
  // hands
  circle(ctx, u * 0.12, 0, u * 0.09);
  ctx.restore();
  return s;
}

function drawHat(ctx, hat, hx, hy, u, facing) {
  const lw = u * 0.045;
  switch (hat) {
    case 'hardhat':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.08, u * 0.32, u * 0.24, 0, Math.PI, 0);
      fillStroke(ctx, '#f2c230', OUT, lw);
      ellipse(ctx, hx, hy - u * 0.06, u * 0.38, u * 0.07);
      fillStroke(ctx, '#e0a820', OUT, lw);
      break;
    case 'goggles':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.1, u * 0.31, u * 0.2, 0, Math.PI, 0);
      fillStroke(ctx, '#6b4a2a', OUT, lw);
      if (facing !== 'up') {
        for (const dx of [-0.11, 0.11]) {
          circle(ctx, hx + dx * u + (facing === 'right' ? u * 0.06 : facing === 'left' ? -u * 0.06 : 0), hy - u * 0.14, u * 0.08);
          fillStroke(ctx, '#7fd6ff', OUT, lw);
        }
      }
      break;
    case 'cap':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.1, u * 0.31, u * 0.21, 0, Math.PI, 0);
      fillStroke(ctx, '#f4f4f0', OUT, lw);
      ctx.fillStyle = '#d63a3a';
      ctx.fillRect(hx - u * 0.03, hy - u * 0.26, u * 0.06, u * 0.14);
      ctx.fillRect(hx - u * 0.07, hy - u * 0.22, u * 0.14, u * 0.06);
      break;
    case 'beanie':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.1, u * 0.32, u * 0.24, 0, Math.PI, 0);
      fillStroke(ctx, '#3f6a5a', OUT, lw);
      rr(ctx, hx - u * 0.33, hy - u * 0.14, u * 0.66, u * 0.1, u * 0.04);
      fillStroke(ctx, '#2f5246', OUT, lw);
      circle(ctx, hx, hy - u * 0.36, u * 0.07);
      fillStroke(ctx, '#e8d8b0', OUT, lw);
      break;
    case 'helmet':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.06, u * 0.34, u * 0.26, 0, Math.PI, 0);
      fillStroke(ctx, '#5f7040', OUT, lw);
      break;
    case 'hair':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.1, u * 0.33, u * 0.22, 0, Math.PI * 0.95, Math.PI * 2.05);
      fillStroke(ctx, '#ece6ff', OUT, lw);
      circle(ctx, hx + (facing === 'left' ? u * 0.2 : -u * 0.2), hy - u * 0.2, u * 0.12);
      fillStroke(ctx, '#ece6ff', OUT, lw);
      break;
    case 'straw':
      ellipse(ctx, hx, hy - u * 0.14, u * 0.5, u * 0.12);
      fillStroke(ctx, '#e3c46a', OUT, lw);
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.18, u * 0.24, u * 0.18, 0, Math.PI, 0);
      fillStroke(ctx, '#d8b55a', OUT, lw);
      break;
    case 'zhelmet':
      ctx.beginPath();
      ctx.ellipse(hx, hy - u * 0.05, u * 0.34, u * 0.27, 0, Math.PI, 0);
      fillStroke(ctx, '#6a747e', OUT, lw);
      break;
    case 'officer':
      ellipse(ctx, hx, hy - u * 0.2, u * 0.34, u * 0.12);
      fillStroke(ctx, '#3e4a2a', OUT, lw);
      rr(ctx, hx - u * 0.22, hy - u * 0.42, u * 0.44, u * 0.22, u * 0.06);
      fillStroke(ctx, '#4a5a32', OUT, lw);
      ctx.fillStyle = '#f2c230';
      circle(ctx, hx, hy - u * 0.3, u * 0.05);
      ctx.fill();
      break;
    case 'crown':
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(hx + i * u * 0.11 - u * 0.05, hy - u * 0.18);
        ctx.lineTo(hx + i * u * 0.11, hy - u * 0.5 + Math.abs(i) * u * 0.06);
        ctx.lineTo(hx + i * u * 0.11 + u * 0.05, hy - u * 0.18);
        ctx.closePath();
        fillStroke(ctx, '#7fd0ff', OUT, lw * 0.8);
      }
      break;
  }
}

function drawEyes(ctx, hx, hy, u, facing, color, glow) {
  if (facing === 'up') return;
  const pts = facing === 'down' ? [-0.1, 0.1] : facing === 'right' ? [0.08, 0.2] : [-0.2, -0.08];
  for (const dx of pts) {
    ellipse(ctx, hx + dx * u, hy + u * 0.02, u * 0.045, u * 0.065);
    ctx.fillStyle = color;
    ctx.fill();
    if (glow) {
      ellipse(ctx, hx + dx * u, hy + u * 0.02, u * 0.09, u * 0.09);
      ctx.fillStyle = rgba(glow, 0.35);
      ctx.fill();
    }
  }
}

// opts: {skin, shirt, pants, hat, scale, aim, walk, moving, gun, forged, zombie, type, alpha, hurt, down, emote}
export function drawPerson(ctx, x, y, u0, o) {
  const sc = o.scale || 1;
  const u = u0 * sc;
  const lw = Math.max(1.2, u * 0.045);
  const facing = facingOf(o.aim);
  const step = o.moving ? Math.sin(o.walk) : 0;
  const bob = o.moving ? Math.abs(Math.cos(o.walk)) * u * 0.05 : Math.sin(o.time * 2) * u * 0.012;
  const sway = o.zombie ? Math.sin(o.walk * 0.5 + (o.seed || 0)) * 0.06 : 0;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  shadow(ctx, x, y, u * 0.42, u * 0.16);
  if (o.down) {
    // lying on the ground
    ctx.translate(x, y - u * 0.25);
    ctx.rotate(Math.PI / 2 - 0.2);
    ctx.translate(-x, -y);
  } else {
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.translate(-x, -y);
  }
  const by = y - bob;
  // feet
  if (!o.crawler) {
    for (const s of [-1, 1]) {
      const fx = x + s * u * 0.14 + (facing === 'left' || facing === 'right' ? step * s * u * 0.12 : 0);
      const fy = y - u * 0.04 - (facing === 'up' || facing === 'down' ? Math.max(0, step * s) * u * 0.08 : 0);
      ellipse(ctx, fx, fy, u * 0.11, u * 0.07);
      fillStroke(ctx, shade(o.pants, -0.35), OUT, lw);
    }
  }
  const shoulderY = by - u * 0.72;
  const gunBehind = facing === 'up';
  if (o.gun && gunBehind) drawGun(ctx, x, shoulderY + u * 0.08, u, o.aim, o.gun, o.forged);
  // zombie arms reaching forward (behind body when facing up)
  const armA = o.aim;
  const drawArms = () => {
    for (const s of [-1, 1]) {
      const sx = x + s * u * 0.24, sy = shoulderY + u * 0.06;
      const reach = u * (o.attack ? 0.62 : 0.48);
      const wob = Math.sin(o.time * 6 + s) * 0.12;
      const ex = sx + Math.cos(armA + wob) * reach, ey = sy + Math.sin(armA + wob) * reach * 0.8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = OUT;
      ctx.lineWidth = u * 0.17 + lw * 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.strokeStyle = o.skin;
      ctx.lineWidth = u * 0.17;
      ctx.stroke();
    }
  };
  if (o.zombie && facing === 'up') drawArms();
  // body
  if (o.crawler) {
    ellipse(ctx, x, by - u * 0.25, u * 0.42, u * 0.24);
    fillStroke(ctx, o.shirt, OUT, lw);
  } else {
    const bw = u * (o.belly ? 0.78 : 0.56), bh = u * 0.56;
    rr(ctx, x - bw / 2, by - u * 0.84, bw, bh * 0.6, u * 0.2);
    fillStroke(ctx, o.pants, OUT, lw);
    rr(ctx, x - bw / 2, by - u * 0.88, bw, bh * 0.75, u * 0.22);
    fillStroke(ctx, o.shirt, OUT, lw);
    if (o.belly) {
      ellipse(ctx, x, by - u * 0.6, u * 0.42, u * 0.32);
      fillStroke(ctx, shade(o.skin, 0.1), OUT, lw);
    }
    if (o.zombie) {
      // torn shirt hem + stains
      ctx.fillStyle = shade(o.shirt, -0.25);
      circle(ctx, x - u * 0.1, by - u * 0.6, u * 0.06);
      ctx.fill();
      circle(ctx, x + u * 0.14, by - u * 0.72, u * 0.04);
      ctx.fill();
    }
    if (o.armor) {
      rr(ctx, x - u * 0.33, by - u * 0.92, u * 0.66, u * 0.36, u * 0.12);
      fillStroke(ctx, '#7a838c', OUT, lw);
    }
  }
  // head
  const hx = x + (facing === 'right' ? u * 0.03 : facing === 'left' ? -u * 0.03 : 0);
  const hy = (o.crawler ? by - u * 0.42 : by - u * 1.14) + (o.zombie ? Math.sin(o.time * 3 + (o.seed || 0)) * u * 0.02 : 0);
  const hr = u * (o.bigHead ? 0.38 : 0.3);
  circle(ctx, hx, hy, hr);
  fillStroke(ctx, o.skin, OUT, lw);
  // cheeks / blush for survivors, rot spots for zombies
  if (!o.zombie && facing !== 'up') {
    ctx.fillStyle = 'rgba(255,120,110,0.25)';
    const cx = facing === 'right' ? 0.16 : facing === 'left' ? -0.16 : 0.17;
    circle(ctx, hx + cx * u, hy + u * 0.1, u * 0.06);
    ctx.fill();
    if (facing === 'down') {
      circle(ctx, hx - cx * u, hy + u * 0.1, u * 0.06);
      ctx.fill();
    }
  }
  if (o.zombie) {
    ctx.fillStyle = shade(o.skin, -0.2);
    circle(ctx, hx - u * 0.12, hy - u * 0.12, u * 0.06);
    ctx.fill();
  }
  if (o.hair && facing === 'up') {
    ctx.beginPath();
    ctx.arc(hx, hy, hr * 0.92, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fillStyle = o.hair;
    ctx.fill();
  }
  drawEyes(ctx, hx, hy, u, facing, o.eyes || '#2a2230', o.eyeGlow);
  if (o.zombie && facing !== 'up') {
    // mouth
    const mx = facing === 'down' ? hx : hx + (facing === 'right' ? u * 0.14 : -u * 0.14);
    ellipse(ctx, mx, hy + u * 0.15, u * (o.scream ? 0.09 : 0.07), u * (o.scream ? 0.08 : 0.035));
    ctx.fillStyle = '#3a1010';
    ctx.fill();
  }
  if (o.hat) drawHat(ctx, o.hat, hx, hy, u, facing);
  if (o.zombie && facing !== 'up') drawArms();
  if (o.gun && !gunBehind) {
    ctx.fillStyle = o.skin;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = lw;
    drawGun(ctx, x, shoulderY + u * 0.08, u, o.aim, o.gun, o.forged);
    ctx.save();
    ctx.translate(x, shoulderY + u * 0.08);
    ctx.rotate(o.aim);
    circle(ctx, u * 0.12, 0, u * 0.09);
    fillStroke(ctx, o.skin, OUT, lw);
    ctx.restore();
  }
  if (o.hurt) {
    ctx.globalCompositeOperation = 'lighter';
    circle(ctx, hx, hy, hr);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

export function playerLook(charId) {
  const c = CHARACTERS[charId] || CHARACTERS.brick;
  const hair = { brick: '#5a3a22', sparks: '#3a2a20', doc: '#1e1a1a', rook: '#3a3020', volt: '#ece6ff', mags: '#c0502a' }[charId];
  return { skin: hex(c.skin), shirt: hex(c.color), pants: '#4a5266', hat: c.hat, hair };
}

const ZLOOK = {
  harvester: { hat: 'straw' },
  general: { hat: 'officer', armor: true },
  juggernaut: { hat: 'zhelmet', armor: true },
  armored: { hat: 'zhelmet', armor: true },
  hivequeen: { hat: 'crown' },
  bloater: { belly: true },
  abomination: { belly: true },
  screamer: { bigHead: true, scream: true },
  crawler: { crawler: true },
};
export function zombieLook(type) {
  // decoys (def.look) borrow another zombie's appearance
  const own = ZOMBIES[type];
  const lt = own.look || type;
  const d = ZOMBIES[lt];
  const eye = d.boss ? '#ff3a2a' : lt === 'spitter' ? '#9dff4a' : lt === 'phantom' ? '#e6a8ff' : '#ffe46a';
  return {
    skin: hex(d.color), shirt: hex(d.shirt), pants: '#3c3a40', zombie: true, scale: own.scale,
    eyes: eye, eyeGlow: eye, ...(ZLOOK[lt] || {}),
  };
}

// Hive Queen egg sac: pulses faster as it gets closer to hatching
export function drawEgg(ctx, x, y, u, t, seed, hurt) {
  const pulse = 1 + Math.sin(t * 6 + seed) * 0.05;
  shadow(ctx, x, y, u * 0.5, u * 0.18, 0.25);
  blob(ctx, x, y - u * 0.45, u * 0.42 * pulse, seed, 0.1, 9);
  fillStroke(ctx, hurt ? '#ffffff' : '#bcdcea', OUT, u * 0.05);
  ctx.strokeStyle = 'rgba(70,120,160,0.6)';
  ctx.lineWidth = u * 0.04;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = seed + i * 2.1;
    ctx.moveTo(x + Math.cos(a) * u * 0.1, y - u * 0.5);
    ctx.quadraticCurveTo(x + Math.cos(a) * u * 0.3, y - u * 0.75, x + Math.cos(a + 0.4) * u * 0.32, y - u * 0.35);
  }
  ctx.stroke();
  circle(ctx, x - u * 0.12, y - u * 0.62, u * 0.08);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
}

// boss extras drawn on top of the base body
export function drawZombieExtras(ctx, type, x, y, u, t, aim) {
  const lw = u * 0.06;
  if (type === 'harvester') {
    // scythe
    ctx.save();
    ctx.translate(x + u * 0.5, y - u * 1.0);
    ctx.rotate(Math.sin(t * 2) * 0.2 + 0.3);
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = u * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, u * 0.7);
    ctx.lineTo(0, -u * 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -u * 0.9);
    ctx.quadraticCurveTo(u * 0.7, -u * 1.0, u * 0.9, -u * 0.4);
    ctx.quadraticCurveTo(u * 0.5, -u * 0.7, 0, -u * 0.7);
    fillStroke(ctx, '#cfd4d8', OUT, lw * 0.5);
    ctx.restore();
  } else if (type === 'spitter') {
    for (const [dx, dy] of [[-0.15, -1.3], [0.12, -1.35], [0.02, -1.45]]) {
      circle(ctx, x + dx * u, y + dy * u, u * 0.07);
      ctx.fillStyle = '#9dff4a';
      ctx.fill();
    }
  } else if (type === 'hivequeen') {
    for (let i = 0; i < 4; i++) {
      circle(ctx, x - u * 0.4 + i * u * 0.27, y - u * 0.35, u * 0.14);
      fillStroke(ctx, 'rgba(120,210,255,0.85)', OUT, lw * 0.4);
    }
  } else if (type === 'patientzero') {
    ctx.strokeStyle = 'rgba(255,40,40,0.8)';
    ctx.lineWidth = u * 0.04;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x - u * 0.2 + i * u * 0.13, y - u * 0.4);
      ctx.lineTo(x - u * 0.15 + i * u * 0.1 + Math.sin(t * 5 + i) * u * 0.05, y - u * 0.85);
      ctx.stroke();
    }
  } else if (type === 'abomination') {
    for (const s of [-1, 1]) {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = u * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + s * u * 0.35, y - u * 0.55);
      ctx.lineTo(x + s * u * 0.75, y - u * 0.3 + Math.sin(t * 4 + s) * u * 0.1);
      ctx.stroke();
      ctx.strokeStyle = '#b08070';
      ctx.lineWidth = u * 0.16;
      ctx.stroke();
    }
  } else if (type === 'general') {
    rr(ctx, x - u * 0.55, y - u * 1.05, u * 0.3, u * 0.22, u * 0.06);
    fillStroke(ctx, '#3a3f44', OUT, lw * 0.5);
    ctx.fillStyle = '#f2c230';
    for (let i = 0; i < 3; i++) {
      circle(ctx, x + u * 0.1 + i * u * 0.08, y - u * 0.75, u * 0.035);
      ctx.fill();
    }
  }
  void aim;
}

// ------------------------------------------------------------------ props
export function drawTree(ctx, x, y, u, s, style, seed, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const r = u * 0.95 * s;
  if (style === 'pine') {
    shadow(ctx, x, y, r * 0.9, r * 0.35, 0.25);
    rr(ctx, x - u * 0.1, y - u * 0.5, u * 0.2, u * 0.5, u * 0.08);
    fillStroke(ctx, '#6b4a32', OUT, u * 0.04);
    for (let i = 0; i < 3; i++) {
      const ty = y - u * 0.4 - i * r * 0.55;
      const tw = r * (1.0 - i * 0.24);
      ctx.beginPath();
      ctx.moveTo(x - tw, ty);
      ctx.quadraticCurveTo(x - tw * 0.3, ty - r * 0.45, x, ty - r * 0.9);
      ctx.quadraticCurveTo(x + tw * 0.3, ty - r * 0.45, x + tw, ty);
      ctx.quadraticCurveTo(x, ty + r * 0.18, x - tw, ty);
      fillStroke(ctx, i % 2 ? '#3f7a5a' : '#356b4e', OUT, u * 0.045);
      // snow cap
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.35, ty - r * 0.5);
      ctx.quadraticCurveTo(x, ty - r * 0.95, x + tw * 0.35, ty - r * 0.5);
      ctx.quadraticCurveTo(x, ty - r * 0.42, x - tw * 0.35, ty - r * 0.5);
      ctx.fillStyle = '#f4f8fc';
      ctx.fill();
    }
  } else if (style === 'dead') {
    shadow(ctx, x, y, r * 0.5, r * 0.2, 0.2);
    ctx.strokeStyle = '#6b5038';
    ctx.lineCap = 'round';
    ctx.lineWidth = u * 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + u * 0.1, y - r * 0.8, x - u * 0.05, y - r * 1.4);
    ctx.stroke();
    ctx.lineWidth = u * 0.09;
    for (const [a, l] of [[-0.9, 0.7], [0.7, 0.6], [-0.4, 0.5]]) {
      const sy = y - r * (0.6 + Math.abs(a) * 0.4);
      ctx.beginPath();
      ctx.moveTo(x, sy);
      ctx.quadraticCurveTo(x + Math.sin(a) * r * l * 0.6, sy - r * 0.2, x + Math.sin(a) * r * l, sy - r * 0.45);
      ctx.stroke();
    }
  } else {
    shadow(ctx, x + r * 0.15, y, r * 0.95, r * 0.38, 0.24);
    rr(ctx, x - u * 0.13, y - u * 0.75, u * 0.26, u * 0.75, u * 0.1);
    fillStroke(ctx, '#7a5236', OUT, u * 0.045);
    const base = style === 'fruit' ? ['#5a9a3a', '#6aaa44', '#4c8a32'] : ['#4f9a44', '#5fae4e', '#43873a'];
    const cy = y - u * 0.75 - r * 0.55;
    const puffs = [[-0.42, 0.12, 0.62], [0.42, 0.1, 0.6], [0, -0.28, 0.72], [0, 0.18, 0.64]];
    for (let i = 0; i < puffs.length; i++) {
      const [dx, dy, rs] = puffs[i];
      blob(ctx, x + dx * r, cy + dy * r, r * rs, seed + i, 0.08);
      fillStroke(ctx, base[i % 3], OUT, u * 0.05);
    }
    // soft highlight
    blob(ctx, x - r * 0.15, cy - r * 0.32, r * 0.3, seed + 7, 0.1);
    ctx.fillStyle = 'rgba(255,255,220,0.18)';
    ctx.fill();
    if (style === 'fruit') {
      for (let i = 0; i < 5; i++) {
        circle(ctx, x + (hash(seed, i) - 0.5) * r * 1.3, cy + (hash(i, seed) - 0.5) * r * 0.9, u * 0.07);
        ctx.fillStyle = '#e04a3a';
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawBush(ctx, x, y, u, seed, snow) {
  shadow(ctx, x, y, u * 0.55, u * 0.2, 0.2);
  for (let i = 0; i < 3; i++) {
    blob(ctx, x + (i - 1) * u * 0.25, y - u * 0.3 - (i === 1 ? u * 0.1 : 0), u * 0.33, seed + i, 0.1);
    fillStroke(ctx, snow ? ['#5f8f78', '#6aa088', '#58856e'][i] : ['#4f9a44', '#62b04f', '#46883c'][i], OUT, u * 0.045);
  }
  if (snow) {
    ellipse(ctx, x, y - u * 0.55, u * 0.3, u * 0.08);
    ctx.fillStyle = '#f4f8fc';
    ctx.fill();
  }
}

export function drawRock(ctx, x, y, w, h, u, seed, color) {
  shadow(ctx, x, y, w * 0.55, h * 0.3, 0.22);
  blob(ctx, x, y - h * 0.35, Math.max(w, h) * 0.5, seed, 0.18, 7);
  fillStroke(ctx, color, OUT, u * 0.045);
  blob(ctx, x - w * 0.12, y - h * 0.5, Math.max(w, h) * 0.2, seed + 3, 0.2, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
}

// rounded 3/4 box: top face + front face. (x,y) = top-left of footprint on ground in px.
export function drawBlock(ctx, x, y, w, d, hpx, top, front, u, r = 0.18) {
  const rad = u * r;
  rr(ctx, x, y - hpx + d * 0.0, w, d + hpx, rad);
  fillStroke(ctx, front, OUT, u * 0.05);
  rr(ctx, x, y - hpx, w, d, rad);
  fillStroke(ctx, top, OUT, u * 0.05);
}

export function drawSparkle(ctx, x, y, u, t, color = '#fff6c0') {
  const s = u * (0.12 + Math.sin(t * 4) * 0.03);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.8);
  ctx.fillStyle = color;
  // soft halo drawn as a larger faint star (shadowBlur is very slow on canvas)
  for (const [k, a] of [[1.8, 0.3], [1, 1]]) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = (i % 2 ? s * 0.35 : s) * k;
      const ang = (i / 8) * Math.PI * 2;
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.globalAlpha *= a;
    ctx.fill();
    ctx.globalAlpha /= a;
  }
  ctx.restore();
}

export function rarityColor(r) {
  return (RARITY[r] || RARITY[0]).color;
}
