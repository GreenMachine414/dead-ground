// Zombie definitions. Regular zombies scale with wave / map / player count.
// Bosses and mini-bosses use fixed health that scales with player count only.
export const ZOMBIES = {
  walker: {
    name: 'Walker', hp: 110, speed: 2.3, damage: 25, attackRate: 1.1, radius: 0.42,
    color: 0x6b8f5e, shirt: 0x5a4a3a, points: 60, scale: 1,
  },
  runner: {
    name: 'Runner', hp: 75, speed: 4.8, damage: 20, attackRate: 0.9, radius: 0.4,
    color: 0x9ab07a, shirt: 0x6a2a2a, points: 70, scale: 0.92,
  },
  crawler: {
    name: 'Crawler', hp: 90, speed: 3.6, damage: 18, attackRate: 0.8, radius: 0.4,
    color: 0x7a8a6a, shirt: 0x3a3a4a, points: 70, scale: 1, crawler: true,
  },
  bloater: {
    name: 'Bloater', hp: 260, speed: 1.9, damage: 15, attackRate: 1.2, radius: 0.7,
    color: 0xa8a848, shirt: 0x6a6a30, points: 90, scale: 1.25, explode: { radius: 3.6, damage: 40 },
  },
  spitter: {
    name: 'Spitter', hp: 140, speed: 2.6, damage: 15, attackRate: 1.0, radius: 0.42,
    color: 0x5ad05a, shirt: 0x2a5a2a, points: 90, scale: 1, spit: { range: 11, cooldown: 2.6, damage: 14 },
  },
  armored: {
    name: 'Armored', hp: 230, speed: 2.1, damage: 30, attackRate: 1.2, radius: 0.48,
    color: 0x6a7a6a, shirt: 0x4a5560, points: 100, scale: 1.08, armor: 0.5,
  },
  screamer: {
    name: 'Screamer', hp: 160, speed: 2.9, damage: 20, attackRate: 1.0, radius: 0.42,
    color: 0xc0b0b0, shirt: 0x8a8a9a, points: 110, scale: 1, scream: { radius: 7, speedMult: 1.45 },
  },
  leaper: {
    name: 'Leaper', hp: 120, speed: 3.3, damage: 22, attackRate: 0.9, radius: 0.4,
    color: 0x8aa0b8, shirt: 0x2a3a4a, points: 100, scale: 0.95, leap: { min: 3, max: 9, cooldown: 3.5 },
  },
  phantom: {
    name: 'Phantom', hp: 170, speed: 3.1, damage: 26, attackRate: 1.0, radius: 0.42,
    color: 0x9a70d0, shirt: 0x3a2050, points: 120, scale: 1, phase: { cooldown: 4 },
  },
  burner: {
    name: 'Burner', hp: 170, speed: 3.6, damage: 22, attackRate: 1.0, radius: 0.44,
    color: 0xd06a30, shirt: 0x5a2010, points: 120, scale: 1, burner: true,
    explode: { radius: 2.8, damage: 30 },
  },

  // ---- mini-bosses ----
  brute: {
    name: 'Brute', hp: 3200, speed: 2.5, damage: 45, attackRate: 1.6, radius: 0.95,
    color: 0x7a6a50, shirt: 0x3a2a1a, points: 500, scale: 1.9, miniboss: true, fixedHp: true,
    abilities: ['charge', 'slam'],
  },
  juggernaut: {
    name: 'Juggernaut', hp: 4800, speed: 2.1, damage: 50, attackRate: 1.6, radius: 1.0,
    color: 0x505860, shirt: 0x2a3038, points: 700, scale: 2.0, miniboss: true, fixedHp: true, armor: 0.3,
    abilities: ['volley', 'slam', 'charge'],
  },

  // ---- bosses ----
  harvester: {
    name: 'The Harvester', hp: 7500, speed: 2.4, damage: 50, attackRate: 1.6, radius: 1.2,
    color: 0x8a7a5a, shirt: 0x4a3018, points: 2000, scale: 2.5, boss: true, fixedHp: true,
    abilities: ['charge', 'slam', 'summon'], summon: { type: 'runner', count: 4 },
  },
  abomination: {
    name: 'The Abomination', hp: 12000, speed: 2.2, damage: 55, attackRate: 1.8, radius: 1.4,
    color: 0xa08070, shirt: 0x6a3030, points: 2500, scale: 2.9, boss: true, fixedHp: true,
    abilities: ['throw', 'slam', 'summon', 'charge'], summon: { type: 'bloater', count: 3 },
  },
  general: {
    name: 'Iron General', hp: 17000, speed: 2.3, damage: 60, attackRate: 1.6, radius: 1.3,
    color: 0x5a6a4a, shirt: 0x3a4a2a, points: 3000, scale: 2.7, boss: true, fixedHp: true, armor: 0.25,
    abilities: ['volley', 'charge', 'slam', 'summon'], summon: { type: 'armored', count: 4 },
  },
  hivequeen: {
    name: 'The Hive Queen', hp: 22000, speed: 2.6, damage: 55, attackRate: 1.4, radius: 1.5,
    color: 0x8ab0c8, shirt: 0x2a4a6a, points: 3500, scale: 3.0, boss: true, fixedHp: true,
    abilities: ['summon', 'volley', 'leap', 'slam'], summon: { type: 'leaper', count: 5 },
  },
  patientzero: {
    name: 'Patient Zero', hp: 32000, speed: 2.9, damage: 65, attackRate: 1.3, radius: 1.3,
    color: 0xc04040, shirt: 0x200808, points: 5000, scale: 2.8, boss: true, fixedHp: true,
    abilities: ['teleport', 'shockwave', 'summon', 'volley', 'slam'], summon: { type: 'phantom', count: 4 },
    enrage: 0.5,
  },
};

export const POWERUPS = {
  maxammo: { name: 'MAX AMMO', color: 0x60ff60 },
  instakill: { name: 'INSTA-KILL', color: 0xff4040 },
  double: { name: 'DOUBLE POINTS', color: 0xffd040 },
  nuke: { name: 'KABOOM', color: 0xff9020 },
};

export const PERKS = {
  tough: { name: 'Tough Brew', cost: 2500, desc: 'Max health 100 → 200', color: 0xd03030 },
  quick: { name: 'Quick Hands', cost: 3000, desc: 'Reload 50% faster', color: 0x30a0d0 },
  swift: { name: 'Swift Step', cost: 2000, desc: 'Move 15% faster, sprint longer', color: 0x40d070 },
  rapid: { name: 'Double Tap', cost: 2000, desc: 'Fire rate +33%', color: 0xe0b030 },
};
