// Weapon definitions. `map` is the campaign map that introduces the weapon:
// a weapon can only appear on that map or later ones (and in Endless once unlocked).
// type: hitscan | pellets | projectile | flame | chain
export const WEAPONS = {
  pistol: {
    name: 'M9 Pistol', map: 1, type: 'hitscan', damage: 45, rate: 5, auto: false,
    mag: 12, reserve: 96, reload: 1.2, spread: 0.02, range: 30, pierce: 1,
    ammoCost: 250, color: 0xffe08a, sound: 'pistol', len: 0.45, gunColor: 0x2a2a2a, boxWeight: 0,
  },
  revolver: {
    name: 'Python .357', map: 1, type: 'hitscan', damage: 160, rate: 2.2, auto: false,
    mag: 6, reserve: 54, reload: 2.0, spread: 0.01, range: 36, pierce: 3,
    ammoCost: 500, color: 0xffd060, sound: 'revolver', len: 0.55, gunColor: 0x8a8a90, boxWeight: 8,
  },
  shotgun: {
    name: 'Pump Shotgun', map: 1, type: 'pellets', damage: 38, pellets: 8, rate: 1.3, auto: false,
    mag: 6, reserve: 48, reload: 2.4, spread: 0.2, range: 13, pierce: 1,
    ammoCost: 600, color: 0xffb050, sound: 'shotgun', len: 0.85, gunColor: 0x5a3a22, boxWeight: 10,
  },
  smg: {
    name: 'Viper SMG', map: 1, type: 'hitscan', damage: 32, rate: 12, auto: true,
    mag: 32, reserve: 224, reload: 1.7, spread: 0.06, range: 26, pierce: 1,
    ammoCost: 700, color: 0xfff0a0, sound: 'smg', len: 0.6, gunColor: 0x1e1e24, boxWeight: 10,
  },
  ar: {
    name: 'Raider AR', map: 2, type: 'hitscan', damage: 52, rate: 9, auto: true,
    mag: 30, reserve: 240, reload: 2.0, spread: 0.035, range: 38, pierce: 2,
    ammoCost: 900, color: 0xffe070, sound: 'rifle', len: 0.95, gunColor: 0x3a4030, boxWeight: 10,
  },
  gl: {
    name: 'Thumper GL', map: 2, type: 'projectile', damage: 260, splash: 3.6, rate: 1.4, auto: false,
    mag: 4, reserve: 28, reload: 2.6, spread: 0.01, range: 22, projSpeed: 22, proj: 'grenade', lob: true,
    ammoCost: 1000, color: 0xff9040, sound: 'thump', len: 0.8, gunColor: 0x4a5a3a, boxWeight: 8,
  },
  sniper: {
    name: 'Longshot .50', map: 3, type: 'hitscan', damage: 650, rate: 1.1, auto: false,
    mag: 5, reserve: 40, reload: 2.8, spread: 0.0, range: 70, pierce: 8,
    ammoCost: 1000, color: 0xffffff, sound: 'sniper', len: 1.25, gunColor: 0x252a20, boxWeight: 7,
  },
  flamethrower: {
    name: 'Inferno', map: 3, type: 'flame', damage: 22, burn: 30, rate: 20, auto: true,
    mag: 120, reserve: 480, reload: 3.0, spread: 0.35, range: 7.5,
    ammoCost: 1100, color: 0xff7020, sound: 'flame', len: 0.9, gunColor: 0x8a2a1a, boxWeight: 7,
  },
  lmg: {
    name: 'Hailstorm LMG', map: 4, type: 'hitscan', damage: 62, rate: 11, auto: true,
    mag: 100, reserve: 400, reload: 4.2, spread: 0.07, range: 40, pierce: 2, moveMult: 0.85,
    ammoCost: 1300, color: 0xffd080, sound: 'rifle', len: 1.15, gunColor: 0x2e3328, boxWeight: 7,
  },
  raygun: {
    name: 'Plasma Ray', map: 4, type: 'projectile', damage: 420, pierce: 3, rate: 3.2, auto: false,
    mag: 20, reserve: 160, reload: 2.2, spread: 0.01, range: 40, projSpeed: 40, proj: 'ray',
    ammoCost: 1500, color: 0x40ff60, sound: 'ray', len: 0.6, gunColor: 0xc0c8d0, boxWeight: 4,
  },
  tesla: {
    name: 'Storm Caller', map: 5, type: 'chain', damage: 900, chain: 7, rate: 1.6, auto: false,
    mag: 12, reserve: 72, reload: 2.8, spread: 0, range: 18,
    ammoCost: 1800, color: 0x80c8ff, sound: 'zap', len: 0.9, gunColor: 0x4a5a7a, boxWeight: 3,
  },
  minigun: {
    name: 'Ripper Minigun', map: 5, type: 'hitscan', damage: 58, rate: 24, auto: true,
    mag: 200, reserve: 600, reload: 5.0, spread: 0.09, range: 34, pierce: 2, moveMult: 0.7,
    ammoCost: 1800, color: 0xffc060, sound: 'smg', len: 1.2, gunColor: 0x3a3a3a, boxWeight: 4,
  },
  crossbow: {
    name: 'Bolt Caster', map: 2, type: 'projectile', damage: 380, splash: 2.6, rate: 1.5, auto: false,
    mag: 3, reserve: 30, reload: 2.2, spread: 0, range: 34, projSpeed: 30, proj: 'bolt',
    ammoCost: 900, color: 0xff4040, sound: 'thump', len: 0.85, gunColor: 0x5a4030, boxWeight: 6,
  },
};

// Pack-a-Punch style upgrade ("Weapon Forge")
export const FORGE = { cost: 5000, damageMult: 2.2, magMult: 1.5, reserveMult: 1.5 };
// Second forge level ("XX"): unlocked by getting `kills` kills with a forged gun; stacks on FORGE.
export const FORGE2 = { cost: 10000, kills: 100, damageMult: 1.6, magMult: 1.25, reserveMult: 1.25 };

export function weaponsForMap(mapId) {
  return Object.keys(WEAPONS).filter((k) => WEAPONS[k].map <= mapId);
}

// Loot rarity. Rolled when a weapon comes out of a container or the Mystery Box.
export const RARITY = [
  { name: 'Common', color: '#d9d4c7', dmg: 1, mag: 1, reload: 1, weight: 50 },
  { name: 'Uncommon', color: '#6fd36a', dmg: 1.12, mag: 1.1, reload: 0.95, weight: 28 },
  { name: 'Rare', color: '#4fa8ff', dmg: 1.26, mag: 1.2, reload: 0.9, weight: 14 },
  { name: 'Epic', color: '#bb6cff', dmg: 1.42, mag: 1.3, reload: 0.85, weight: 6 },
  { name: 'Legendary', color: '#ffa53a', dmg: 1.65, mag: 1.5, reload: 0.75, weight: 2 },
];

// luck > 0 shifts the odds toward higher rarities
export function rollRarity(rng, luck = 0, min = 0) {
  const items = RARITY.map((r, i) => i).filter((i) => i >= min);
  return rng.weighted(items, (i) => RARITY[i].weight * (1 + luck * i * i * 0.35));
}

export function weaponStats(id, forged, rarity = 0) {
  const w = WEAPONS[id];
  if (!forged && !rarity) return w;
  const r = RARITY[rarity] || RARITY[0];
  // forged is the forge level: 0, 1 (X) or 2 (XX)
  const k = (key) => (forged ? FORGE[key] : 1) * (forged >= 2 ? FORGE2[key] : 1);
  return {
    ...w,
    name: w.name + (forged >= 2 ? ' XX' : forged ? ' X' : ''),
    damage: w.damage * k('damageMult') * r.dmg,
    mag: Math.round(w.mag * k('magMult') * r.mag),
    reserve: Math.round(w.reserve * k('reserveMult') * r.mag),
    reload: w.reload * r.reload,
    ammoCost: w.ammoCost * (forged ? 2 : 1),
  };
}
