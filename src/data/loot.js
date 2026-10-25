// Searchable containers placed around each map. Guns come from these rather than
// lying on the ground. Each entry: search time, luck (shifts rarity), loot weights.
export const CONTAINERS = {
  rack: { name: 'Weapon Rack', time: 1.4, luck: 0.8, loot: { weapon: 85, ammo: 15 }, minRarity: 0 },
  locker: { name: 'Locker', time: 1.1, luck: 0.4, loot: { weapon: 45, ammo: 30, grenade: 15, health: 10 } },
  crate: { name: 'Supply Crate', time: 1.0, luck: 0.2, loot: { weapon: 35, ammo: 35, cash: 20, grenade: 10 } },
  car: { name: 'Car Trunk', time: 1.3, luck: 0.3, loot: { weapon: 40, ammo: 25, cash: 25, health: 10 } },
  body: { name: 'Fallen Survivor', time: 1.2, luck: 0.3, loot: { weapon: 35, ammo: 30, cash: 20, health: 15 } },
  toolbox: { name: 'Toolbox', time: 0.8, luck: 0.1, loot: { ammo: 40, grenade: 30, cash: 30 } },
  chest: { name: 'Military Chest', time: 2.0, luck: 2.5, loot: { weapon: 100 }, minRarity: 2 },
};

// chance an emptied container is restocked at the start of each round
export const RESTOCK_CHANCE = 0.3;
