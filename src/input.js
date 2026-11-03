// Keyboard + mouse state. sample() builds the per-frame input object for the sim.
import { resolveBinds, normCode, MOUSE_BUTTONS } from './keybinds.js';

// what the key handlers (and Session.onKey) see for a side-button press, made once
const MOUSE_EVENT = { down: { type: 'keydown', repeat: false }, up: { type: 'keyup', repeat: false } };

// bound actions that fire once per key press (the sim's `acts`)
const PRESS_ACTS = { reload: 'reload', swap: 'swap', ability: 'ability', grenade: 'grenade', melee: 'melee', use: 'usePress' };

export class Input {
  // binds: action id -> key code (see keybinds.js); defaults when omitted
  constructor(target, binds = resolveBinds()) {
    this.target = target;
    this.setBinds(binds);
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, left: false };
    this.acts = {};
    this.enabled = true;
    this.handlers = {};
    this.onWheel = null; // Ctrl + wheel (zoom)
    this.wheelT = 0;
    this.onKey = null; // (event, normalized code) -> true if handled (keydown and keyup)
    const on = (type, fn, el = window, opts) => {
      el.addEventListener(type, fn, opts);
      this.handlers[type] = [el, fn];
    };
    on('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const code = normCode(e.code);
      if (code === 'Tab' || code === this.binds.score) e.preventDefault();
      this.press(e, code);
    });
    on('keyup', (e) => this.release(e, normCode(e.code)));
    on('blur', () => {
      this.keys.clear();
      this.mouse.left = false;
    });
    on('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    on('mousedown', (e) => {
      // side buttons act like keys: whatever they're bound to (nothing by default)
      const side = MOUSE_BUTTONS[e.button];
      if (side) {
        e.preventDefault();
        return this.press(MOUSE_EVENT.down, side);
      }
      if (!this.enabled) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.acts.ability = true;
      // middle click swaps weapons too: many laptop keyboards can't register the swap key
      // while some movement-key pairs are held (key ghosting)
      if (e.button === 1) {
        e.preventDefault();
        this.acts.swap = (this.acts.swap | 0) + 1;
      }
    });
    on('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button >= 1) e.preventDefault(); // no autoscroll or back/forward navigation
      const side = MOUSE_BUTTONS[e.button];
      if (side) this.release(MOUSE_EVENT.up, side);
    });
    on('contextmenu', (e) => e.preventDefault());
    // the wheel swaps weapons (it can't be blocked by key ghosting the way Q can on laptop
    // keyboards); Ctrl + wheel zooms instead of zooming the page
    on('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (this.onWheel) this.onWheel(Math.sign(e.deltaY));
        return;
      }
      if (!this.enabled || !e.deltaY) return;
      const now = performance.now();
      if (now - this.wheelT < 150) return; // one swap per notch, even from touchpads
      this.wheelT = now;
      this.acts.swap = (this.acts.swap | 0) + 1;
    }, window, { passive: false });
  }

  // (re)bind; key code -> press action is built here so a key event is a single lookup
  setBinds(binds) {
    this.binds = binds;
    this.actByCode = {};
    for (const id in PRESS_ACTS) this.actByCode[binds[id]] = PRESS_ACTS[id];
    if (this.keys) this.keys.clear(); // nothing stays held under its old binding
  }

  // a bound key or side button went down / up (e: the event, or a stand-in for side buttons)
  press(e, code) {
    if (this.onKey && this.onKey(e, code)) return;
    if (!this.enabled) return;
    const act = this.actByCode[code];
    // swaps are counted so a quick double-tap is not merged into one
    if (act && !e.repeat) this.acts[act] = act === 'swap' ? (this.acts.swap | 0) + 1 : true;
    this.keys.add(code);
  }

  release(e, code) {
    this.keys.delete(code);
    if (this.onKey) this.onKey(e, code);
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
    if (!this.enabled) return { mx: 0, mz: 0, ax: aim ? aim.x : 0, az: aim ? aim.z : 0, fire: false, use: false, acts: {} };
    return {
      mx,
      mz,
      ax: aim ? aim.x : 0,
      az: aim ? aim.z : 0,
      fire: this.mouse.left,
      use: k.has(b.use),
      acts,
    };
  }
}
