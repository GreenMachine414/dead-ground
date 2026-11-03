// 3D character portraits (lobby and upgrade cards) and a model line-up used to inspect the rig.
// Rendered once with the shared WebGL context into a small studio scene, then kept as images,
// so the menus pay nothing per frame.
import * as THREE from 'three';
import { getGL } from './renderer3d.js';
import { makeMaterials, Parts } from './models3d.js';
import { drawPerson, drawExtras, drawGun, gunLength } from './rig3d.js';
import { WEAPONS } from '../data/weapons.js';
import { playerLook, zombieLook, SIGNATURE_GUNS } from './sprites.js';
import { CHARACTER_IDS } from '../data/characters.js';
import { ZOMBIES } from '../data/zombies.js';

const PORTRAIT_W = 192, PORTRAIT_H = 288; // the 2D portraits' size (64 x 96 at 3x)

let studio;
function getStudio() {
  if (studio) return studio;
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const parts = new Parts(group, makeMaterials());
  scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x5a4a3a, 1.35));
  const key = new THREE.DirectionalLight(0xfff1da, 2.3);
  key.position.set(-3, 5, 6);
  const rim = new THREE.DirectionalLight(0x9db4ff, 1.1);
  rim.position.set(4, 3, -4);
  scene.add(key, rim);
  return (studio = { scene, parts, camera: new THREE.PerspectiveCamera(28, 1, 0.1, 100) });
}

// Render one w x h picture of whatever `pose(parts)` puts in the studio, seen from `eye` toward
// `at`, and return it as a canvas. Drawn straight to the shared canvas and copied off at once.
function shoot(w, h, eye, at, pose) {
  const gl = getGL(), st = getStudio();
  pose(st.parts);
  st.parts.flush();
  const size = gl.getSize(new THREE.Vector2()), pr = gl.getPixelRatio();
  gl.setPixelRatio(1);
  gl.setSize(w, h, false);
  gl.setRenderTarget(null);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  st.camera.aspect = w / h;
  st.camera.position.set(...eye);
  st.camera.lookAt(...at);
  st.camera.updateProjectionMatrix();
  gl.render(st.scene, st.camera);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(gl.domElement, 0, 0);
  gl.setPixelRatio(pr);
  gl.setSize(size.x, size.y, false);
  return out;
}

const PORTRAIT_YAW = 0.3; // turned a little to their left, so the face reads in 3D

// { charId: data URL } for every survivor (standing, no gun, like the 2D portraits), in the 3D style
export function portraits3D() {
  const out = {};
  for (const id of CHARACTER_IDS) {
    const pic = shoot(PORTRAIT_W, PORTRAIT_H, [0, 1.6, 5.5], [0, 1.02, 0], (P) =>
      drawPerson(P, 0, 0, 0, Math.PI / 2 - PORTRAIT_YAW, playerLook(id), 0, false, {}),
    );
    // soft ground shadow under the figure, as on the 2D portraits
    const c = document.createElement('canvas');
    c.width = PORTRAIT_W;
    c.height = PORTRAIT_H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.ellipse(PORTRAIT_W / 2, PORTRAIT_H * 0.885, PORTRAIT_W * 0.32, PORTRAIT_H * 0.045, 0, 0, Math.PI * 2);
    g.fill();
    g.drawImage(pic, 0, 0);
    out[id] = c.toDataURL();
  }
  return out;
}

// Every survivor and zombie type, from the game's camera angle and from the front, for checking
// that no part of the rig cuts through another
export function lineupCells() {
  const cells = [];
  for (const id of CHARACTER_IDS) cells.push({ name: id, look: playerLook(id), gun: SIGNATURE_GUNS[id] || 'pistol' });
  cells.push({ name: 'downed', look: playerLook(CHARACTER_IDS[0]), down: true });
  for (const type of Object.keys(ZOMBIES)) {
    const d = ZOMBIES[type];
    if (d.egg) continue;
    cells.push({ name: type, look: zombieLook(type), extra: d.look || type, scale: d.scale });
  }
  return cells;
}

// one page of the line-up: each model from the game's 55-degree angle (top) and the front (bottom)
export function modelLineup(cells, W, H) {
  const cw = Math.floor(W / cells.length), ch = Math.floor(H / 2);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d');
  g.fillStyle = '#6f8a60';
  g.fillRect(0, 0, W, H);
  g.font = 'bold 16px Segoe UI';
  g.fillStyle = '#fff';
  cells.forEach((c, i) => {
    const s = c.scale || 1;
    const pose = (P) => {
      drawPerson(P, 1.3, 0, 0, Math.PI / 2 - 0.45, c.look, 0, false, { gun: c.gun, down: c.down });
      if (c.extra) drawExtras(P, 1.3, c.extra, false);
    };
    const d = 6.4 * s, ty = 0.95 * s;
    g.drawImage(shoot(cw, ch, [0, ty + Math.sin(0.96) * d, Math.cos(0.96) * d], [0, ty, 0], pose), i * cw, 0);
    g.drawImage(shoot(cw, ch, [0, ty + 0.15 * s, d], [0, ty, 0], pose), i * cw, ch);
    g.fillText(c.name, i * cw + 6, 18);
  });
  return out;
}

// every gun from the side (plus the AR forged X and XX), for checking the 3D gun models
export function gunLineup(W, H) {
  const guns = Object.keys(WEAPONS).map((wid) => [wid, 0]).concat([['ar', 1], ['ar', 2]]);
  const cols = 5, rows = Math.ceil(guns.length / cols), cw = Math.floor(W / cols), ch = Math.floor(H / rows);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d');
  g.fillStyle = '#6f8a60';
  g.fillRect(0, 0, W, H);
  g.font = 'bold 16px Segoe UI';
  g.fillStyle = '#fff';
  guns.forEach(([wid, lvl], i) => {
    const L = gunLength(wid);
    const pic = shoot(cw, ch, [-(L * 2.4 + 0.6), 0.35, 0], [0, -0.04, 0], (P) => {
      P.root(0, 0, 0, 0);
      drawGun(P, 1, wid, lvl, 0, -0.2 * L);
    });
    g.drawImage(pic, (i % cols) * cw, Math.floor(i / cols) * ch);
    g.fillText(WEAPONS[wid].name + (lvl ? (lvl > 1 ? ' XX' : ' X') : ''), (i % cols) * cw + 8, Math.floor(i / cols) * ch + 20);
  });
  return out;
}
