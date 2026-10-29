// In-match level-up choices. Each level you pick 1 of 3; picks stack up to `max`.
export const BOONS = {
  vigor: { name: 'Vigor', desc: '+20 max health', icon: '♥', color: '#e2574c', max: 5 },
  power: { name: 'Firepower', desc: '+10% weapon damage', icon: '✸', color: '#f0a83a', max: 5 },
  haste: { name: 'Fleet Foot', desc: '+6% move speed', icon: '»', color: '#6fd36a', max: 3 },
  hands: { name: 'Nimble Hands', desc: '+12% reload speed', icon: '↻', color: '#5ab8e8', max: 4 },
  trigger: { name: 'Hair Trigger', desc: '+8% fire rate', icon: '⁂', color: '#f2d24b', max: 4 },
  focus: { name: 'Focus', desc: '-8% ability cooldown', icon: '◎', color: '#b07cf0', max: 4 },
  bandolier: { name: 'Bandolier', desc: '+25% max reserve ammo', icon: '▤', color: '#c9a27a', max: 3 },
  vamp: { name: 'Bloodthirst', desc: 'Heal 3 HP per kill', icon: '❦', color: '#c0392b', max: 3 },
  greed: { name: 'Scavenger', desc: '+15% points earned', icon: '$', color: '#e8c547', max: 3 },
  crit: { name: 'Deadeye', desc: '+8% chance to deal double damage', icon: '✦', color: '#ff7a59', max: 4 },
  grenadier: { name: 'Grenadier', desc: '+1 grenade now, +25% grenade damage', icon: '●', color: '#8fbf5a', max: 3 },
  mend: { name: 'Second Breath', desc: 'Health regenerates sooner and faster', icon: '✚', color: '#7be0a8', max: 2 },
  aegis: { name: 'Aegis', desc: '+25 shield that recharges after 5s without damage', icon: '⛨', color: '#7ab8ff', max: 3 },
  laststand: { name: 'Last Stand', desc: 'Get back up on your own the next time you go down', icon: '✝', color: '#ffd65a', max: 1 },
  overcharge: { name: 'Overcharge', desc: '+15% ability damage, healing and duration', icon: 'ϟ', color: '#c58cff', max: 4 },
  thorns: { name: 'Thorns', desc: 'Zombies that hit you take heavy damage', icon: '✶', color: '#9acd5a', max: 3 },
};
export const BOON_IDS = Object.keys(BOONS);

export function xpForLevel(rank) {
  return 70 + rank * 50;
}
