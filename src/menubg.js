// Animated scene behind the menus: a slow pan over Harvest Farm with a few
// zombies shambling about.
import { Renderer } from './render/renderer.js';
import { createWorld, getMap, ZTYPES } from './game/sim.js';

export class MenuBackdrop {
  // quality: the renderer's quality mode for the graphics setting (see gfx.js)
  constructor(el, quality) {
    this.el = el;
    this.quality = quality;
    this.running = false;
  }

  // the graphics setting changed: applies to the running backdrop at once
  setQuality(quality) {
    this.quality = quality;
    if (this.renderer) this.renderer.setGraphics(quality);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.el.style.display = 'block';
    if (!this.renderer) {
      const map = getMap(1);
      this.world = createWorld(map);
      this.renderer = new Renderer(this.el);
      this.renderer.setGraphics(this.quality);
      this.renderer.zoom = 1.15;
      this.renderer.loadWorld(this.world, map);
      this.zeds = [];
      for (let i = 0; i < 7; i++) {
        this.zeds.push({ id: i + 1, x: 40 + Math.random() * 20, z: 52 + Math.random() * 14, a: Math.random() * 6, t: Math.random() * 10 });
      }
    }
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(Math.min(0.05, (t - this.last) / 1000));
      this.last = t;
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.el.style.display = 'none';
  }

  frame(dt) {
    const r = this.renderer;
    this.time = (this.time || 0) + dt;
    r.cam.x = 46 + Math.sin(this.time * 0.05) * 14;
    r.cam.z = 52 + Math.cos(this.time * 0.04) * 8;
    for (const z of this.zeds) {
      z.t += dt;
      if (Math.sin(z.t * 0.3 + z.id) > 0.6) z.a += dt * 0.8;
      z.x = Math.max(32, Math.min(64, z.x + Math.cos(z.a) * dt * 0.9));
      z.z = Math.max(50, Math.min(70, z.z + Math.sin(z.a) * dt * 0.9));
      if (z.x <= 32 || z.x >= 64 || z.z <= 50 || z.z >= 70) z.a += Math.PI * 0.7;
    }
    const snap = {
      P: [], I: [], S: [], H: [], R: [], D: [], BS: [], PW: [0, 0],
      Z: this.zeds.map((z) => [z.id, z.id % 3 === 0 ? ZTYPES.indexOf('runner') : 0, z.x, z.z, z.a, 1, 1, 0, 0]),
      C: this.world.spots.loot.map(() => [1, 0]),
      B: [0, 'idle', '', 0, -1, 0],
      O: { mk: [], zone: null },
    };
    r.update(snap, [], dt, { localId: -1, smooth: false });
  }
}
