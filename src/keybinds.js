// Rebindable controls. Keys are KeyboardEvent.code values; profile.settings.keys stores only the
// player's overrides, so new actions pick up their defaults automatically.
export const BINDS = [
  { id: 'up', label: 'Move up', def: 'KeyW' },
  { id: 'down', label: 'Move down', def: 'KeyS' },
  { id: 'left', label: 'Move left', def: 'KeyA' },
  { id: 'right', label: 'Move right', def: 'KeyD' },
  { id: 'reload', label: 'Reload', def: 'KeyR' },
  { id: 'swap', label: 'Swap weapon (also mouse wheel, middle / side buttons)', def: 'KeyQ' },
  { id: 'ability', label: 'Ability (also right click)', def: 'KeyF' },
  { id: 'grenade', label: 'Throw grenade', def: 'KeyG' },
  { id: 'melee', label: 'Knife', def: 'KeyV' },
  { id: 'use', label: 'Interact / buy (hold to search)', def: 'KeyE' },
  { id: 'score', label: 'Scoreboard (hold)', def: 'Tab' },
  { id: 'map', label: 'Map', def: 'KeyM' },
];

// keys the game always owns: pause, fullscreen, level-up picks and weapon slots
export const RESERVED = new Set(['Escape', 'F11', 'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3']);

// left and right modifier keys act the same
const SAME = { ShiftRight: 'ShiftLeft', ControlRight: 'ControlLeft', AltRight: 'AltLeft', MetaRight: 'MetaLeft' };
export const normCode = (code) => SAME[code] || code;

// action id -> key code, defaults merged with the player's overrides
export function resolveBinds(overrides) {
  const out = {};
  for (const b of BINDS) out[b.id] = (overrides && overrides[b.id]) || b.def;
  return out;
}

const NAMES = {
  ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', MetaLeft: 'Win', Space: 'Space', Tab: 'Tab',
  CapsLock: 'Caps', Enter: 'Enter', Backspace: 'Backspace', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
// short label for a key code: KeyW -> W, Digit4 -> 4, Numpad5 -> Num 5, ShiftLeft -> Shift
export function keyName(code) {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
