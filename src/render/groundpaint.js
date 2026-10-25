// Pre-renders the static ground of a map into a single texture.
import { shade, rgba, rr, blob, ellipse, circle } from './sprites.js';

export const PX = 32; // texture pixels per world unit

export function paintGround(world, theme) {
  const { W, H } = world;
  const c = document.createElement('canvas');
  c.width = W * PX;
  c.height = H * PX;
  const g = c.getContext('2d');
  let seed = world.id * 977;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const P = (v) => v * PX;

  // base + soft colour variation
  g.fillStyle = theme.ground;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < W * H * 0.05; i++) {
    const x = rnd() * c.width, y = rnd() * c.height, r = P(1 + rnd() * 3.5);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba(rnd() < 0.5 ? theme.ground2 : shade(theme.ground, -0.08), 0.55));
    grd.addColorStop(1, rgba(theme.ground, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grass tufts / speckles
  const tuft = theme.tree === 'pine' ? shade(theme.ground, -0.08) : theme.tree === 'none' ? shade(theme.ground, -0.12) : shade(theme.ground, -0.18);
  g.strokeStyle = tuft;
  g.lineCap = 'round';
  g.lineWidth = 2;
  for (let i = 0; i < W * H * 0.35; i++) {
    const x = rnd() * c.width, y = rnd() * c.height;
    if (theme.tree === 'pine') {
      // soft snow drifts instead of grass
      if (i % 3) continue;
      g.beginPath();
      g.ellipse(x, y, 6 + rnd() * 10, 2 + rnd() * 3, 0, 0, Math.PI * 2);
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(170,190,215,0.25)';
      g.fill();
    } else if (theme.tree === 'oak') {
      g.beginPath();
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x - 4, y - 6, x - 6, y - 9);
      g.moveTo(x, y);
      g.quadraticCurveTo(x, y - 8, x + 1, y - 11);
      g.moveTo(x + 4, y);
      g.quadraticCurveTo(x + 4, y - 6, x + 7, y - 8);
      g.stroke();
    } else {
      circle(g, x, y, 1.5 + rnd() * 2);
      g.fillStyle = rgba(tuft, 0.5);
      g.fill();
    }
  }

  const R = (d, col, rad = 0.4) => {
    rr(g, P(d.x), P(d.z), P(d.w), P(d.d), P(rad));
    g.fillStyle = col;
    g.fill();
  };
  const order = ['grass', 'sidewalk', 'road', 'lot', 'tiles', 'trail', 'path', 'crops', 'ice', 'floor', 'rug', 'helipad', 'flowers', 'crack'];
  const decor = [...world.decor].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const d of decor) {
    switch (d.kind) {
      case 'grass':
        R(d, '#5e9a48', 1.2);
        break;
      case 'sidewalk':
        R(d, '#9a9a96', 0.6);
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        g.lineWidth = 2;
        for (let x = d.x; x < d.x + d.w; x += 2) {
          g.beginPath();
          g.moveTo(P(x), P(d.z));
          g.lineTo(P(x), P(d.z + d.d));
          g.stroke();
        }
        break;
      case 'road': {
        R(d, '#4b4e55', 0);
        g.fillStyle = '#e8d070';
        if (d.horizontal) for (let x = d.x; x < d.x + d.w; x += 4) {
          rr(g, P(x), P(d.z + d.d / 2 - 0.1), P(2), P(0.2), 3);
          g.fill();
        }
        else for (let z = d.z; z < d.z + d.d; z += 4) {
          rr(g, P(d.x + d.w / 2 - 0.1), P(z), P(0.2), P(2), 3);
          g.fill();
        }
        break;
      }
      case 'lot':
        R(d, '#55585e', 0.6);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        for (let x = d.x + 1; x < d.x + d.w; x += 3) {
          g.fillRect(P(x), P(d.z + 1), 3, P(3.5));
          g.fillRect(P(x), P(d.z + d.d - 4.5), 3, P(3.5));
        }
        break;
      case 'tiles': {
        const col = d.color || shade(theme.ground, 0.15);
        R(d, col, 0.8);
        g.strokeStyle = 'rgba(0,0,0,0.1)';
        g.lineWidth = 2;
        for (let x = d.x; x <= d.x + d.w; x += 1.5) {
          g.beginPath();
          g.moveTo(P(x), P(d.z));
          g.lineTo(P(x), P(d.z + d.d));
          g.stroke();
        }
        for (let z = d.z; z <= d.z + d.d; z += 1.5) {
          g.beginPath();
          g.moveTo(P(d.x), P(z));
          g.lineTo(P(d.x + d.w), P(z));
          g.stroke();
        }
        break;
      }
      case 'trail': {
        const style = { dirt: theme.path, gravel: theme.path, snow: theme.path }[d.style] || theme.path;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const line = () => {
          g.beginPath();
          const pts = d.points;
          g.moveTo(P(pts[0][0]), P(pts[0][1]));
          for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2;
            g.quadraticCurveTo(P(pts[i][0]), P(pts[i][1]), P(mx), P(mz));
          }
          const l = pts[pts.length - 1];
          g.lineTo(P(l[0]), P(l[1]));
        };
        line();
        g.strokeStyle = shade(style, -0.12);
        g.lineWidth = P(d.width + 0.35);
        g.stroke();
        line();
        g.strokeStyle = style;
        g.lineWidth = P(d.width);
        g.stroke();
        // pebbles
        for (let i = 0; i < 40 * d.points.length; i++) {
          const k = Math.floor(rnd() * (d.points.length - 1));
          const a = d.points[k], b = d.points[k + 1], t = rnd();
          const x = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * d.width * 0.7;
          const z = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * d.width * 0.7;
          circle(g, P(x), P(z), 1.5 + rnd() * 2.5);
          g.fillStyle = rgba(shade(style, rnd() < 0.5 ? -0.2 : 0.2), 0.6);
          g.fill();
        }
        break;
      }
      case 'path':
        R(d, theme.path, 1);
        break;
      case 'crops': {
        R(d, '#8a6a42', 0.8);
        for (let z = d.z + 0.6; z < d.z + d.d; z += 1.5) {
          rr(g, P(d.x + 0.3), P(z), P(d.w - 0.6), P(0.55), P(0.27));
          g.fillStyle = '#9a7a4e';
          g.fill();
          for (let x = d.x + 0.6; x < d.x + d.w - 0.5; x += 0.8) {
            blob(g, P(x), P(z + 0.1), P(0.32), x * 3 + z, 0.15, 6);
            g.fillStyle = rnd() < 0.15 ? '#e2b93b' : rnd() < 0.5 ? '#6a9a3a' : '#7aac44';
            g.fill();
          }
        }
        break;
      }
      case 'ice':
        ellipse(g, P(d.x + d.w / 2), P(d.z + d.d / 2), P(d.w / 2), P(d.d / 2));
        g.fillStyle = '#bfe0f2';
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 2;
        for (let i = 0; i < 24; i++) {
          const x = d.x + d.w * (0.2 + rnd() * 0.6), z = d.z + d.d * (0.2 + rnd() * 0.6);
          g.beginPath();
          g.moveTo(P(x), P(z));
          g.lineTo(P(x + (rnd() - 0.5) * 3), P(z + (rnd() - 0.5) * 3));
          g.stroke();
        }
        break;
      case 'floor': {
        const col = d.color || theme.floor;
        R(d, col, 0.25);
        g.strokeStyle = shade(col, -0.18);
        g.lineWidth = 2;
        for (let z = d.z + 0.5; z < d.z + d.d; z += 0.5) {
          g.beginPath();
          g.moveTo(P(d.x), P(z));
          g.lineTo(P(d.x + d.w), P(z));
          g.stroke();
        }
        for (let z = d.z; z < d.z + d.d; z += 0.5) {
          const off = (z * 2) % 2 ? 0.7 : 1.9;
          for (let x = d.x + off; x < d.x + d.w; x += 2.4) {
            g.beginPath();
            g.moveTo(P(x), P(z));
            g.lineTo(P(x), P(z + 0.5));
            g.stroke();
          }
        }
        break;
      }
      case 'rug':
        R(d, d.color || '#a04a3a', 0.6);
        rr(g, P(d.x + 0.3), P(d.z + 0.3), P(d.w - 0.6), P(d.d - 0.6), P(0.4));
        g.strokeStyle = 'rgba(255,230,180,0.6)';
        g.lineWidth = 3;
        g.stroke();
        break;
      case 'helipad':
        circle(g, P(d.x), P(d.z), P(4.6));
        g.fillStyle = '#6a6e74';
        g.fill();
        circle(g, P(d.x), P(d.z), P(3.9));
        g.strokeStyle = '#f2f2f2';
        g.lineWidth = P(0.25);
        g.stroke();
        g.fillStyle = '#f2f2f2';
        g.font = `bold ${P(4)}px Segoe UI, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', P(d.x), P(d.z) + P(0.2));
        break;
      case 'flowers':
        for (let i = 0; i < d.r * d.r * 6; i++) {
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * d.r;
          const x = P(d.x + Math.cos(a) * r), y = P(d.z + Math.sin(a) * r);
          const col = ['#ff8fb1', '#ffd45a', '#ffffff', '#b58cff', '#ff6a5a'][Math.floor(rnd() * 5)];
          for (let p = 0; p < 5; p++) {
            circle(g, x + Math.cos(p * 1.26) * 3, y + Math.sin(p * 1.26) * 3, 2.6);
            g.fillStyle = col;
            g.fill();
          }
          circle(g, x, y, 2);
          g.fillStyle = '#ffe9a0';
          g.fill();
        }
        break;
      case 'crack':
        g.save();
        g.translate(P(d.x), P(d.z));
        g.rotate(d.rot);
        g.strokeStyle = '#ff6a3a';
        g.shadowColor = '#ff3a1a';
        g.shadowBlur = 10;
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-P(d.r), 0);
        for (let i = 1; i <= 5; i++) g.lineTo(-P(d.r) + (P(d.r * 2) * i) / 5, (rnd() - 0.5) * P(0.6));
        g.stroke();
        g.restore();
        break;
    }
  }

  // water (rect rivers + organic ponds) with shore + highlights
  const water = theme.water;
  const shoreCol = theme.tree === 'pine' ? '#d6e4ee' : theme.tree === 'dead' ? '#c9ac72' : '#c8b07a';
  for (const s of world.solids) {
    if (s.kind !== 'water') continue;
    rr(g, P(s.x - 0.25), P(s.z - 0.25), P(s.w + 0.5), P(s.d + 0.5), P(0.9));
    g.fillStyle = shoreCol;
    g.fill();
    rr(g, P(s.x), P(s.z), P(s.w), P(s.d), P(0.7));
    g.fillStyle = water;
    g.fill();
    for (let i = 0; i < s.w * s.d * 0.2; i++) {
      const x = P(s.x + rnd() * s.w), y = P(s.z + rnd() * s.d);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 6 + rnd() * 6, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
  }
  for (const d of world.decor) {
    if (d.kind !== 'pond') continue;
    ellipse(g, P(d.x), P(d.z), P(d.rx + 0.45), P(d.rz + 0.45));
    g.fillStyle = shoreCol;
    g.fill();
    ellipse(g, P(d.x), P(d.z), P(d.rx), P(d.rz));
    g.fillStyle = shade(water, -0.1);
    g.fill();
    ellipse(g, P(d.x - d.rx * 0.08), P(d.z - d.rz * 0.1), P(d.rx * 0.85), P(d.rz * 0.8));
    g.fillStyle = water;
    g.fill();
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.7;
      const x = P(d.x + Math.cos(a) * d.rx * r), y = P(d.z + Math.sin(a) * d.rz * r);
      if (theme.tree !== 'pine' && rnd() < 0.5) {
        // lily pad
        g.beginPath();
        g.arc(x, y, P(0.3), 0.4, Math.PI * 2 - 0.2);
        g.lineTo(x, y);
        g.fillStyle = '#5fa04a';
        g.fill();
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
    }
  }
  // bridges and docks over water
  for (const d of world.decor) {
    if (d.kind !== 'bridge' && d.kind !== 'dock') continue;
    rr(g, P(d.x), P(d.z), P(d.w), P(d.d), P(0.3));
    g.fillStyle = '#9a7048';
    g.fill();
    g.strokeStyle = '#6e4c30';
    g.lineWidth = 2;
    const horiz = d.w >= d.d;
    for (let k = 0; k <= (horiz ? d.w : d.d); k += 0.5) {
      g.beginPath();
      if (horiz) {
        g.moveTo(P(d.x + k), P(d.z));
        g.lineTo(P(d.x + k), P(d.z + d.d));
      } else {
        g.moveTo(P(d.x), P(d.z + k));
        g.lineTo(P(d.x + d.w), P(d.z + k));
      }
      g.stroke();
    }
  }
  // soft ambient-occlusion shadows at the base of every solid
  for (const s of world.solids) {
    if (s.kind === 'water' || s.kind === 'tree' || s.low) continue;
    rr(g, P(s.x - 0.15), P(s.z + 0.1), P(s.w + 0.3), P(s.d + 0.3), P(0.4));
    g.fillStyle = 'rgba(20,20,30,0.18)';
    g.fill();
  }
  return c;
}
