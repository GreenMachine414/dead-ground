// Keyboard + mouse state. sample() builds the per-frame input object for the sim.
const ACTION_KEYS = {
  KeyR: 'reload',
  KeyQ: 'swap',
  KeyF: 'ability',
  KeyG: 'grenade',
  KeyV: 'melee',
  KeyE: 'usePress',
};

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, left: false };
    this.acts = {};
    this.enabled = true;
    this.handlers = {};
    this.onWheel = null;
    this.onKey = null;
    const on = (type, fn, el = window) => {
      el.addEventListener(type, fn);
      this.handlers[type] = [el, fn];
    };
    on('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab') e.preventDefault();
      if (this.onKey && this.onKey(e)) return;
      if (!this.enabled) return;
      if (!e.repeat && ACTION_KEYS[e.code]) this.acts[ACTION_KEYS[e.code]] = true;
      this.keys.add(e.code);
    });
    on('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey && e.code === 'Tab') this.onKey(e);
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

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  // aim: world point under the cursor
  sample(aim) {
    const mx = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const mz = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    const acts = this.acts;
    this.acts = {};
    if (!this.enabled) return { mx: 0, mz: 0, ax: aim ? aim.x : 0, az: aim ? aim.z : 0, fire: false, sprint: false, use: false, acts: {} };
    return {
      mx,
      mz,
      ax: aim ? aim.x : 0,
      az: aim ? aim.z : 0,
      fire: this.mouse.left,
      sprint: this.down('ShiftLeft', 'ShiftRight'),
      use: this.down('KeyE'),
      acts,
    };
  }
}
