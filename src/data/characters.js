// Playable characters. Each has one ability with 5 upgrade levels (bought with
// Salvage between games) and a small passive bonus.
export const MAX_LEVEL = 5;
export const UPGRADE_COST = [0, 300, 600, 1000, 1600]; // cost to go from level n to n+1 (index n)

export const CHARACTERS = {
  brick: {
    name: 'Brick', role: 'Engineer', color: 0xd08a30, skin: 0xc89070, hat: 'hardhat',
    ability: 'Barricade',
    desc: 'Builds wooden walls that block zombies. Zombies must smash through them.',
    passive: '+25 max health',
    levels: [
      'Wall (500 HP), 2 charges, 3 walls max',
      'Wall HP 800, 3 charges, 4 walls max',
      'Spiked walls damage attackers',
      'Wall HP 1300, 4 charges, faster recharge',
      'Reinforced steel walls: 2000 HP, longer, heavy spikes, 5 walls max',
    ],
    stats(lvl) {
      return {
        wallHp: [500, 800, 950, 1300, 2000][lvl - 1],
        charges: [2, 3, 3, 4, 4][lvl - 1],
        cooldown: [14, 12, 11, 9, 8][lvl - 1],
        spikes: [0, 0, 25, 40, 70][lvl - 1],
        length: lvl >= 5 ? 5 : 3,
        maxWalls: [3, 4, 4, 4, 5][lvl - 1],
      };
    },
  },
  sparks: {
    name: 'Sparks', role: 'Mechanic', color: 0x3070c0, skin: 0xe0b090, hat: 'goggles',
    ability: 'Sentry Turret',
    desc: 'Deploys an automated sentry turret that shoots nearby zombies.',
    passive: 'Reloads 15% faster',
    levels: [
      '1 turret, 18s',
      'Turret damage +25%, 20s',
      '2 turrets at once',
      'Faster fire, 25s, tougher turret',
      'Explosive rounds, 28s',
    ],
    stats(lvl) {
      return {
        damage: [24, 30, 32, 36, 40][lvl - 1],
        rate: [2.5, 2.5, 2.5, 3.2, 3.2][lvl - 1],
        duration: [18, 20, 22, 25, 28][lvl - 1],
        maxTurrets: [1, 1, 2, 2, 2][lvl - 1],
        hp: [250, 300, 320, 400, 450][lvl - 1],
        cooldown: [26, 25, 24, 22, 21][lvl - 1],
        explosive: lvl >= 5,
        range: 13,
      };
    },
  },
  doc: {
    name: 'Doc', role: 'Medic', color: 0xe8e8e8, skin: 0x9a6a4a, hat: 'cap',
    ability: 'Healing Field',
    desc: 'Heals nearby allies instantly and drops a healing zone.',
    passive: 'Revives teammates twice as fast',
    levels: [
      'Heal 40, radius 5',
      'Heal 55, zone lasts longer',
      'Revives downed allies in range',
      'Heal 70, radius 6.5, zone damages zombies',
      'Heal 85 + 1.5s invulnerability for allies',
    ],
    stats(lvl) {
      return {
        heal: [40, 55, 60, 70, 85][lvl - 1],
        radius: [5, 5.5, 6, 6.5, 7][lvl - 1],
        zone: [5, 6, 6, 7, 8][lvl - 1],
        zoneHeal: [6, 8, 8, 10, 12][lvl - 1],
        zoneDamage: [0, 0, 0, 18, 25][lvl - 1],
        revive: lvl >= 3,
        invuln: lvl >= 5 ? 1.5 : 0,
        cooldown: [28, 27, 26, 24, 23][lvl - 1],
      };
    },
  },
  rook: {
    name: 'Rook', role: 'Soldier', color: 0x5a6a3a, skin: 0xd0a080, hat: 'helmet',
    ability: 'Airstrike',
    desc: 'Calls in a mortar barrage on the target location.',
    passive: '+10% weapon damage',
    levels: [
      '4 shells',
      'Shell damage +20%',
      '5 shells, bigger blast',
      'Faster cooldown, 6 shells',
      'Carpet bombing: 8 shells, napalm',
    ],
    stats(lvl) {
      return {
        shells: [4, 4, 5, 6, 8][lvl - 1],
        damage: [180, 215, 225, 240, 260][lvl - 1],
        radius: [3, 3, 3.3, 3.3, 3.5][lvl - 1],
        spread: [3, 3, 3.3, 3.6, 4.2][lvl - 1],
        cooldown: [36, 35, 34, 30, 29][lvl - 1],
        napalm: lvl >= 5,
      };
    },
  },
  volt: {
    name: 'Volt', role: 'Scientist', color: 0x7040b0, skin: 0xf0c8a8, hat: 'hair',
    ability: 'Chain Lightning',
    desc: 'Unleashes lightning that arcs between zombies and stuns them.',
    passive: 'Moves 8% faster',
    levels: [
      'Chains to 4 zombies',
      'Damage +20%',
      'Chains to 6, longer stun',
      'Faster cooldown, chains to 7',
      'Overcharge: chains to 8, double arcs',
    ],
    stats(lvl) {
      return {
        damage: [150, 180, 190, 200, 210][lvl - 1],
        chains: [4, 4, 6, 7, 8][lvl - 1],
        stun: [0.8, 0.9, 1.3, 1.3, 1.5][lvl - 1],
        cooldown: [16, 15.5, 15, 13, 12.5][lvl - 1],
        double: lvl >= 5,
      };
    },
  },
  mags: {
    name: 'Mags', role: 'Quartermaster', color: 0xb8862e, skin: 0xa87050, hat: 'beanie',
    ability: 'Supply Drop',
    desc: 'Drops supply bags around himself. Anyone short on ammo can grab one.',
    passive: '+25% max reserve ammo',
    levels: [
      'Two supply bags, each restocks 50% reserve ammo',
      '75% restock, bag lasts 25s',
      'Bag also gives +1 grenade',
      'Full restock, drops a third bag, faster cooldown',
      'Bags also refill magazines',
    ],
    stats(lvl) {
      return {
        restock: [0.5, 0.75, 0.75, 1, 1][lvl - 1],
        bags: lvl >= 4 ? 3 : 2,
        life: [20, 25, 25, 30, 35][lvl - 1],
        grenades: lvl >= 3 ? 1 : 0,
        mags: lvl >= 5,
        cooldown: [30, 28, 27, 24, 22][lvl - 1],
      };
    },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
