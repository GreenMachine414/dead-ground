// Keyboard + mouse state. sample() builds the per-frame input object for the sim.
import { resolveBinds, normCode } from './keybinds.js';

// bound actions that fire once per key press (the sim's `acts`)
const PRESS_ACTS = { reload: 'reload', swap: 'swap', ability: 'ability', grenade: 'grenade', melee: 'melee', use: 'usePress' };

export class Input {
  // binds: action id -> key code (see keybinds.js); defaults when omitted
  constructor(target, binds = resolveBinds()) {
    this.target = target;
    this.binds = binds;
    // key code -> press action, built once so a key event is a single lookup
    this.actByCode = {};
    for (const id in PRESS_ACTS) this.actByCode[binds[id]] = PRESS_ACTS[id];
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, left: false };
    this.acts = {};
    this.enabled = true;
    this.handlers = {};
    this.onWheel = null;
    this.onKey = null; // (event, normalized code) -> true if handled (keydown and keyup)
    const on = (type, fn, el = window) => {
      el.addEventListener(type, fn);
      this.handlers[type] = [el, fn];
    };
    on('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const code = normCode(e.code);
      if (code === 'Tab' || code === binds.score) e.preventDefault();
      if (this.onKey && this.onKey(e, code)) return;
      if (!this.enabled) return;
      const act = this.actByCode[code];
      // swaps are counted so a quick double-tap is not merged into one
      if (act && !e.repeat) this.acts[act] = act === 'swap' ? (this.acts.swap | 0) + 1 : true;
      this.keys.add(code);
    });
    on('keyup', (e) => {
      const code = normCode(e.code);
      this.keys.delete(code);
      if (this.onKey) this.onKey(e, code);
    });
    on('blur', () => {
      this.keys.clear();
      this.mouse.left = false;
    });
    on('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    on('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.acts.ability = true;
    });
    on('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
    });
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => this.onWheel && this.onWheel(Math.sign(e.deltaY)));
  }

  dispose() {
    for (const [type, [el, fn]] of Object.entries(this.handlers)) el.removeEventListener(type, fn);
  }

  // aim: world point under the cursor. Arrow keys always move too.
  sample(aim) {
    const k = this.keys, b = this.binds;
    const mx = (k.has(b.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(b.left) || k.has('ArrowLeft') ? 1 : 0);
    const mz = (k.has(b.down) || k.has('ArrowDown') ? 1 : 0) - (k.has(b.up) || k.has('ArrowUp') ? 1 : 0);
    const acts = this.acts;
    this.acts = {};
    if (!this.enabled) return { mx: 0, mz: 0, ax: aim ? aim.x : 0, az: aim ? aim.z : 0, fire: false, sprint: false, use: false, acts: {} };
    return {
      mx,
      mz,
      ax: aim ? aim.x : 0,
      az: aim ? aim.z : 0,
      fire: this.mouse.left,
      sprint: k.has(b.sprint),
      use: k.has(b.use),
      acts,
    };
  }
}
