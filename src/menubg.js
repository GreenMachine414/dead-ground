// Animated scene behind the menus: a slow pan over Harvest Farm with a few
// zombies shambling about.
import { Renderer } from './render/renderer.js';
import { Renderer3D } from './render/renderer3d.js';
import { createWorld, getMap, ZTYPES } from './game/sim.js';

// the 3D backdrop is a slow pan behind the menus: 30 fps looks the same and halves its GPU work
const FRAME_3D = 1 / 32;

export class MenuBackdrop {
  // quality: the renderer's quality mode for the graphics tier (see gfx.js)
  constructor(el, use3d, getBloom, quality) {
    this.el = el;
    this.use3d = use3d;
    this.getBloom = getBloom;
    this.quality = quality;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.el.style.display = 'block';
    if (!this.renderer) {
      const map = getMap(1);
      this.world = this.world || createWorld(map);
      this.renderer = null;
      if (this.use3d) {
        try {
          this.renderer = new Renderer3D(this.el);
        } catch (err) {
          console.error(err);
          this.el.innerHTML = '';
        }
      }
      if (!this.renderer) this.renderer = new Renderer(this.el);
      this.renderer.setGraphics(this.quality);
      if (this.renderer.setBloom && this.getBloom) this.renderer.setBloom(this.getBloom());
      this.renderer.zoom = 1.15;
      this.renderer.loadWorld(this.world, map);
      if (!this.zeds) {
        this.zeds = [];
        for (let i = 0; i < 7; i++) {
          this.zeds.push({ id: i + 1, x: 40 + Math.random() * 20, z: 52 + Math.random() * 14, a: Math.random() * 6, t: Math.random() * 10 });
        }
      }
    }
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = (t - this.last) / 1000;
      if (this.renderer.is3D && dt < FRAME_3D) return;
      this.frame(Math.min(0.05, dt));
      this.last = t;
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.el.style.display = 'none';
  }

  // Graphics changed: swap the renderer in place (same map, pan and zombies), no restart
  setMode(use3d, quality) {
    this.quality = quality;
    // Low <-> High: same 2D renderer, just its quality
    if (use3d === this.use3d && this.renderer) return this.renderer.setGraphics(quality);
    const was = this.running;
    this.stop();
    if (this.renderer) this.renderer.dispose();
    this.renderer = null;
    this.el.innerHTML = '';
    this.use3d = use3d;
    if (was) this.start();
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
