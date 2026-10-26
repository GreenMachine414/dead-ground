// Persistent player profile (progress, upgrades, settings) stored in the app's userData folder.
import { CHARACTER_IDS, MAX_LEVEL, UPGRADE_COST } from './data/characters.js';

export function defaultProfile() {
  const levels = {};
  for (const id of CHARACTER_IDS) levels[id] = 1;
  return {
    version: 1,
    name: 'Survivor',
    salvage: 0,
    unlocked: 1,
    completed: [],
    levels,
    char: 'brick',
    best: {},
    stats: { kills: 0, games: 0, wins: 0 },
    settings: { master: 0.8, sfx: 0.9, music: 0.35, shake: true, graphics: 'auto', fullscreen: false, lastJoin: '127.0.0.1', port: 27015 },
  };
}

export async function loadProfile() {
  let data = null;
  try {
    data = window.native ? await window.native.loadProfile() : JSON.parse(localStorage.getItem('profile') || 'null');
  } catch {}
  const def = defaultProfile();
  if (!data) return def;
  return {
    ...def,
    ...data,
    levels: { ...def.levels, ...(data.levels || {}) },
    settings: { ...def.settings, ...(data.settings || {}) },
    stats: { ...def.stats, ...(data.stats || {}) },
  };
}

export async function saveProfile(p) {
  try {
    if (window.native) await window.native.saveProfile(p);
    else localStorage.setItem('profile', JSON.stringify(p));
  } catch (e) {
    console.error('save failed', e);
  }
}

export function upgradeCost(level) {
  return level >= MAX_LEVEL ? null : UPGRADE_COST[level];
}
