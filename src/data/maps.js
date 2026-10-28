// Campaign maps. Each map: layout builder, 2D theme, zombie pool (zombies are equally tough on every map),
// bosses, and a short story made of objective steps.
//
// Story step types:
//   collect  { item, label, count, spots: <named spot list> }  walk over items to pick up
//   activate { spots: [...names], hold, label }                hold E at every station
//   survive  { time }                                          survive with extra pressure
//   defend   { spot, radius, time }                            keep a player inside the zone
//   boss     { zombie, spot, count?, drop? }                   kill it (drop => then pick up item)
//   extract  { spot, radius }                                  every living player in the zone
// Any step can have `openDoors: [doorIds]` (opened when the step starts).
//
// Theme (2D renderer): ground/ground2/path colours, `dark` = how night-like the map is (0-1: lit
// windows, stronger light glow), tree style, ambient particles.

export const MAPS = [
  // ------------------------------------------------------------------ 1
  {
    id: 1,
    key: 'farm',
    name: 'Harvest Farm',
    subtitle: 'Day 1 — The outbreak reaches the countryside',
    size: [96, 96],
    theme: {
      ground: '#7fb35a', ground2: '#93c266', path: '#c9a66b', water: '#5aa9d6', wall: '#c99b6d', roof: '#b5523b',
      dark: 0.0, tree: 'oak', particles: 'leaves', floor: '#a0764c',
    },
    zombies: [
      { type: 'walker', weight: 10, minWave: 1 },
      { type: 'runner', weight: 3, minWave: 2 },
    ],
    miniboss: null,
    boss: 'harvester',
    newWeapons: ['revolver', 'shotgun', 'smg'],
    story: {
      intro:
        'The outbreak reached the farm overnight. The old ham radio in the farmhouse can reach the National Guard — but scavengers stripped it for parts. Find the parts, call for help, and survive until the chopper arrives.',
      steps: [
        { type: 'collect', item: 'radio_part', label: 'Radio Part', count: 3, spots: 'part', text: 'Find the 3 missing radio parts scattered around the farm.' },
        { type: 'collect', item: 'fuel', label: 'Fuel Can', count: 2, spots: 'part', round: 3, text: "The radio's generator is dry. Fuel cans turn up by round 3 — find 2." },
        { type: 'activate', spots: ['radio'], hold: 6, label: 'Repair the radio', text: 'Repair the ham radio inside the farmhouse.' },
        { type: 'survive', time: 60, horde: true, text: 'The Guard is triangulating your signal. Survive the horde!' },
        { type: 'boss', zombie: 'harvester', spot: 'barn', nextRound: true, text: 'Something massive is tearing out of the barn. Kill The Harvester!' },
        { type: 'activate', spots: ['helipad'], hold: 5, label: 'Light the flares', text: 'Mark the landing zone: light the flares at the helipad.' },
        { type: 'defend', spot: 'helipad', radius: 6, time: 40, text: 'Hold the landing zone while the chopper circles in.' },
        { type: 'extract', spot: 'helipad', radius: 4, text: 'The chopper is landing in the east meadow. Get to the helipad!' },
      ],
      outro: 'The chopper lifts off as the horde swarms the helipad. The pilot says downtown is the next safe zone...',
    },
    build(c) {
      const { rng } = c;
      // trails first (decor only)
      c.path([[48, 95], [48, 78], [46, 66], [47, 56]], 3);
      c.path([[44, 56], [34, 54], [24, 44], [19, 30], [19, 25]], 2.6);
      c.path([[52, 55], [62, 55], [70, 52], [78, 50]], 2.6);
      c.path([[44, 60], [32, 62], [20, 66]], 2.2);
      c.path([[50, 68], [56, 78], [60, 84]], 2.2);
      c.path([[62, 34], [64, 40], [62, 46]], 2);

      // farmhouse (open interior so you can see in)
      c.building(38, 38, 16, 12, { gaps: { s: [[7, 3]], n: [[3, 2]], e: [[5, 2]] }, color: '#d8b48a', floor: '#a0764c' });
      c.spot('radio', 42, 42);
      c.solid(47, 43, 3, 1, { kind: 'table', h: 0.9, low: true });
      c.decor('rug', 45, 45, { w: 4, d: 3, color: '#b5523b' });
      c.loot('locker', 52, 39, 's');
      c.loot('crate', 39, 48, 'e');
      c.lamp(43, 51);
      c.lamp(49, 51);
      c.flowers(41, 53, 1.6);
      c.flowers(52, 53, 1.6);
      c.lootCar(57, 52, true, '#c0392b');

      // barn
      c.building(8, 8, 22, 17, { gaps: { s: [[8, 5]], e: [[6, 2]] }, color: '#a8443a', floor: '#8a6a44', h: 2.8 });
      c.spot('barn', 19, 16);
      c.loot('rack', 11, 9, 's');
      c.loot('crate', 27, 10, 's');
      c.solid(10, 20, 2, 1, { kind: 'hay', h: 1, low: true });
      c.solid(10, 22, 2, 1, { kind: 'hay', h: 1, low: true });
      c.solid(24, 21, 2, 2, { kind: 'hay', h: 1, low: true });
      c.spot('part', 26, 14);
      c.solid(33, 9, 3, 3, { kind: 'silo', h: 4 });
      c.solid(33, 14, 3, 3, { kind: 'silo', h: 4 });
      c.reserve(32, 8, 6, 10);
      c.solid(34, 22, 3, 2, { kind: 'tractor', h: 1.4 });

      // crop field with fence + scarecrow
      c.decor('crops', 59, 9, { w: 30, d: 23 });
      c.fence(57, 7, 90, 7);
      c.fence(57, 33, 60, 33);
      c.fence(65, 33, 90, 33);
      c.fence(57, 8, 57, 18);
      c.fence(57, 23, 57, 32);
      c.fence(90, 8, 90, 32);
      c.reserve(57, 7, 34, 27);
      c.decor('scarecrow', 74, 20);
      c.spot('part', 86, 11);
      c.loot('crate', 60, 30, 'e');
      c.loot('body', 82, 28);

      // meadow + helipad + windmill
      c.decor('helipad', 78, 50, {});
      c.spot('helipad', 78, 50);
      c.reserve(72, 44, 13, 13);
      c.flowers(70, 60, 2.5);
      c.flowers(88, 44, 2);
      c.solid(62, 45, 3, 3, { kind: 'windmill', h: 5 });
      c.reserve(61, 44, 5, 5);
      c.solid(33, 51, 2, 2, { kind: 'well', h: 1.2, low: true });

      // pond with dock and reeds
      c.pond(75, 72, 9, 6);
      c.decor('dock', 64, 70, { w: 4, d: 2 });
      c.loot('body', 64, 65);
      c.spot('part', 87, 80);
      c.rock(85, 66, 2, 1);
      for (let k = 0; k < 10; k++) c.decor('reeds', 66 + rng() * 18, 66 + rng() * 13);

      // tool shed behind debris (rare chest inside)
      c.building(6, 56, 13, 11, { gaps: { e: [[4, 2]] }, color: '#9a8a6a', floor: '#6a5238' });
      c.door(18, 61, 1, 2, 750, 'Clear Debris');
      c.spot('part', 9, 59);
      c.loot('chest', 8, 64, 'e');
      c.loot('toolbox', 14, 64);

      // orchard
      for (let x = 26; x <= 42; x += 4) for (let z = 68; z <= 88; z += 4) c.tree(x, z, 0.8, 'fruit');
      c.spot('part', 33, 78);
      c.loot('crate', 24, 84, 'e');

      // camp south-east
      c.campfire(60, 86);
      c.solid(57, 86, 2, 1, { kind: 'log', h: 0.5, low: true });
      c.solid(62, 88, 2, 1, { kind: 'log', h: 0.5, low: true });
      c.solid(55, 82, 4, 3, { kind: 'tent', h: 1.8 });
      c.loot('body', 64, 84);
      c.spot('part', 66, 90);

      // little graveyard
      for (const [x, z] of [[8, 80], [11, 80], [14, 80], [8, 84], [11, 84], [14, 84], [17, 82]]) c.grave(x, z);
      c.fence(6, 78, 19, 78);
      c.loot('crate', 18, 87, 'w');
      c.loot('body', 22, 40);
      c.loot('body', 70, 46);
      c.loot('toolbox', 37, 24);
      c.loot('crate', 87, 36, 'w');
      c.loot('body', 10, 46);

      for (const [x, z] of [[48, 58], [46, 59], [50, 59], [48, 61], [44, 58]]) c.spot('playerSpawn', x, z);
      c.spot('perk', 34, 35, { perk: 'tough' });
      c.spot('perk', 66, 57, { perk: 'quick' });
      c.spot('perk', 24, 34, { perk: 'swift' });
      c.spot('perk', 88, 60, { perk: 'rapid' });
      c.spot('box', 44, 64);
      c.spot('box', 22, 50);
      c.spot('box', 70, 40);
      c.spot('boonshop', 52, 84);
      c.forestBorder(4, 0.55);
      c.scatter(60, (x, z) => c.tree(x, z, 0.8 + rng() * 0.6));
      c.scatter(40, (x, z) => c.bush(x, z));
      c.scatter(8, (x, z) => c.rock(x, z, 1 + rng.int(0, 1), 1));
      for (let k = 0; k < 18; k++) c.flowers(6 + rng() * 84, 6 + rng() * 84, 1 + rng() * 1.5);
    },
  },

  // ------------------------------------------------------------------ 2
  {
    id: 2,
    key: 'city',
    name: 'Dead End Downtown',
    subtitle: 'Day 3 — The chopper goes down over the city',
    size: [110, 110],
    theme: {
      ground: '#6f7468', ground2: '#7b8074', path: '#4a4d52', water: '#4a86b0', wall: '#8b8f99', roof: '#5b6170',
      dark: 0.42, tree: 'oak', particles: 'rain', floor: '#5e5a56',
    },
    zombies: [
      { type: 'walker', weight: 10, minWave: 1 },
      { type: 'runner', weight: 3, minWave: 2 },
      { type: 'crawler', weight: 3, minWave: 2 },
      { type: 'bloater', weight: 2, minWave: 3 },
    ],
    miniboss: 'brute',
    boss: 'abomination',
    newWeapons: ['ar', 'gl', 'crossbow'],
    story: {
      intro:
        'Your chopper went down over downtown. The pilot survived and says there is a sealed bunker under the subway — but the city grid is dead and the maintenance keycard was on a worker who... turned.',
      steps: [
        { type: 'boss', zombie: 'brute', spot: 'brute', nextRound: true, drop: { item: 'keycard', label: 'Keycard' }, text: 'A Brute is wearing the maintenance keycard. Hunt it down in the plaza.' },
        { type: 'activate', spots: ['subA', 'subB'], hold: 5, timeLimit: 40, label: 'Restore power', text: 'Restore power at both substations within 40 seconds of each other.' },
        { type: 'souls', spot: 'subway', radius: 7, count: 15, text: "The gate's bio-lock needs feeding. Kill 15 zombies near the subway entrance." },
        { type: 'defend', spot: 'subway', radius: 6, time: 45, horde: true, text: 'Hold the subway entrance while the security gate opens.' },
        { type: 'boss', zombie: 'abomination', spot: 'plaza', round: 6, text: 'The Abomination crawls out of the sewers. Kill it!' },
        { type: 'activate', spots: ['subway'], hold: 8, label: 'Override the gate', text: 'The gate jammed halfway. Override the controls at the subway entrance.' },
        { type: 'survive', time: 45, horde: true, text: 'The override alarm is drawing in every zombie downtown. Survive!' },
        { type: 'boss', zombie: 'brute', count: 2, spot: 'plaza', nextRound: true, text: 'Two more Brutes followed the alarm into the plaza. Put them down!' },
        { type: 'extract', spot: 'bunker', radius: 4, openDoors: [0], text: 'The gate is open. Get inside the subway bunker!' },
      ],
      outro: "The bunker's radio picks up a military frequency: Fort Ironside is still holding... barely.",
    },
    build(c) {
      const { rng } = c;
      const xs = [4, 34, 64, 94], ws = [22, 22, 22, 12];
      for (const rx of [26, 56, 86]) c.decor('road', rx, 1, { w: 8, d: 108 });
      for (const rz of [26, 56, 86]) c.decor('road', 1, rz, { w: 108, d: 8, horizontal: true });
      const palette = ['#c98f6a', '#8fa3b8', '#b8a07a', '#9b7f9e', '#7f9e8a', '#c4b49a'];
      const roofs = ['#6b4a3a', '#4a5568', '#7a5a3a', '#5a4a6a', '#3e5a4a', '#6a6a5a'];
      for (let bi = 0; bi < 4; bi++) {
        for (let bj = 0; bj < 4; bj++) {
          const x = xs[bi], z = xs[bj], w = ws[bi], d = ws[bj];
          const key = bi + ',' + bj;
          c.decor('sidewalk', x - 1, z - 1, { w: w + 2, d: d + 2 });
          const k = (bi * 4 + bj) % palette.length;
          const blk = (bx, bz, bw, bd) => c.block(bx, bz, bw, bd, { color: palette[(k + bx) % palette.length], roof: roofs[(k + bz) % roofs.length] });
          if (key === '1,1') {
            // plaza with fountain, benches and flower beds
            c.decor('tiles', x, z, { w, d });
            c.solid(43, 43, 4, 4, { kind: 'fountain', h: 1.2 });
            c.spot('plaza', 45, 51);
            c.spot('brute', 40, 39);
            c.reserve(x, z, w, d);
            for (const [tx, tz] of [[36, 36], [54, 36], [36, 54], [54, 54]]) c.tree(tx, tz, 1.0);
            c.flowers(40, 45, 1.5);
            c.flowers(50, 45, 1.5);
            for (const [bx, bz] of [[39, 49], [50, 40]]) c.solid(bx, bz, 2, 1, { kind: 'bench', h: 0.6, low: true });
            c.loot('body', 47, 38);
            c.lamp(35, 45);
            c.lamp(55, 45);
          } else if (key === '0,0') {
            // police station: weapon racks + lockers
            c.building(x + 1, z + 1, 20, 16, { gaps: { s: [[8, 3]], e: [[5, 3]] }, color: '#5a6f94', floor: '#4d5260' });
            c.decor('sign', x + 10, z + 18.5, { text: 'POLICE' });
            c.loot('rack', x + 3, z + 2, 's');
            c.loot('rack', x + 6, z + 2, 's');
            c.loot('locker', x + 17, z + 2, 's');
            c.loot('locker', x + 18, z + 2, 's');
            c.solid(x + 4, z + 9, 4, 2, { kind: 'table', h: 0.9, low: true });
            c.spot('box', x + 14, z + 11);
            c.lootCar(x + 2, z + 19, true, '#2c3e70');
          } else if (key === '3,0') {
            c.fence(x, z, x + 11, z);
            c.fence(x, z + 21, x + 11, z + 21);
            c.fence(x, z + 1, x, z + 8);
            c.fence(x, z + 13, x, z + 20);
            c.solid(x + 3, z + 4, 2, 2, { kind: 'transformer', h: 2 });
            c.solid(x + 7, z + 4, 2, 2, { kind: 'transformer', h: 2 });
            c.solid(x + 3, z + 15, 2, 2, { kind: 'transformer', h: 2 });
            c.spot('subA', x + 6, z + 10);
            c.loot('toolbox', x + 9, z + 16);
            c.reserve(x, z, w, d);
          } else if (key === '0,3') {
            c.fence(x, z, x + 21, z);
            c.fence(x, z + 11, x + 8, z + 11);
            c.fence(x + 13, z + 11, x + 21, z + 11);
            c.solid(x + 3, z + 3, 2, 2, { kind: 'transformer', h: 2 });
            c.solid(x + 16, z + 3, 2, 2, { kind: 'transformer', h: 2 });
            c.solid(x + 16, z + 7, 2, 2, { kind: 'transformer', h: 2 });
            c.spot('subB', x + 10, z + 5);
            c.loot('toolbox', x + 6, z + 8);
            c.reserve(x, z, w, d);
          } else if (key === '1,3') {
            c.decor('tiles', x, z, { w, d: 4 });
            c.building(x + 2, z + 4, 18, 8, { gaps: { n: [[7, 4]] }, color: '#7a7a80', floor: '#3a3a40' });
            c.door(x + 9, z + 4, 4, 1, 99999, 'Security Gate (sealed)');
            c.decor('sign', x + 11, z + 2.5, { text: 'SUBWAY' });
            c.spot('subway', x + 11, z + 1);
            c.spot('bunker', x + 11, z + 8);
            c.loot('locker', x + 20, z + 2, 'w');
            c.reserve(x, z, w, d);
            c.block(x, z + 14, w, d - 14, { color: '#9b8a7a', roof: '#5a4a3a' });
          } else if (key === '2,2') {
            c.decor('lot', x, z, { w, d });
            for (let n = 0; n < 6; n++) c.scatter(1, (cx, cz) => (c.free(cx - 1, cz, 5, 2) ? c.lootCar(cx, cz, true) : false), [x + 2, z + 1, w - 6, d - 3]);
            c.reserve(x, z, w, d);
          } else if (key === '2,0') {
            c.decor('canopy', x + 4, z + 6, { w: 14, d: 8 });
            for (const px of [x + 6, x + 10, x + 14]) c.solid(px, z + 9, 1, 2, { kind: 'pump', h: 1.4 });
            c.block(x + 4, z + 16, 12, 5, { color: '#e0ddd0', roof: '#c0392b' });
            c.loot('crate', x + 17, z + 15, 'w');
            c.loot('crate', x + 2, z + 14, 'e');
            c.spot('perk', x + 18, z + 3, { perk: 'quick' });
            c.reserve(x, z, w, d);
          } else if (key === '0,2') {
            // park with pond
            c.decor('grass', x, z, { w, d });
            c.pond(x + 11, z + 13, 4.5, 3);
            for (let n = 0; n < 9; n++) c.scatter(1, (tx, tz) => c.tree(tx, tz, 1), [x + 1, z + 1, w - 2, d - 2]);
            for (let n = 0; n < 8; n++) c.scatter(1, (tx, tz) => c.bush(tx, tz), [x + 1, z + 1, w - 2, d - 2]);
            c.flowers(x + 5, z + 5, 2);
            c.flowers(x + 17, z + 19, 2);
            c.spot('perk', x + 11, z + 5, { perk: 'swift' });
            c.loot('body', x + 18, z + 8);
            c.campfire(x + 4, z + 18);
            c.reserve(x, z, w, d);
          } else if (w < 15 || d < 15) {
            blk(x, z, w, Math.floor(d / 2) - 1);
            blk(x, z + Math.floor(d / 2) + 2, w, d - Math.floor(d / 2) - 2);
            c.loot('crate', x + 1, z + Math.floor(d / 2), 'e');
          } else if (rng() < 0.5) {
            blk(x, z, 10, 10);
            blk(x + 13, z, w - 13, 10);
            blk(x, z + 13, w, d - 13);
            c.loot('crate', x + 11, z + 4, 's');
          } else {
            blk(x, z, 10, d);
            blk(x + 13, z, w - 13, 9);
            blk(x + 13, z + 12, w - 13, d - 12);
            c.loot('body', x + 11, z + 10);
          }
        }
      }
      // streets: abandoned cars with trunks, bodies, lamps
      c.scatter(10, (x, z) => (c.free(x - 1, z, 5, 2) ? c.lootCar(x, z, true) : false), [27, 2, 6, 104]);
      c.scatter(6, (x, z) => (c.free(x, z - 1, 2, 5) ? c.lootCar(x, z, false) : false), [2, 27, 104, 6]);
      c.scatter(6, (x, z) => c.loot('body', x, z), [2, 57, 104, 6]);
      for (const p of [26, 56, 86]) for (const q of [14, 44, 74, 100]) {
        if (c.free(p, q)) c.lamp(p, q);
        if (c.free(q, p)) c.lamp(q, p);
      }
      for (const [x, z] of [[30, 30], [29, 31], [31, 31], [30, 32], [32, 29]]) c.spot('playerSpawn', x, z);
      c.spot('perk', 60, 28, { perk: 'tough' });
      c.spot('perk', 90, 60, { perk: 'rapid' });
      c.spot('box', 60, 62);
      c.spot('box', 90, 40);
      c.spot('boonshop', 60, 100);
      c.scatter(24, (x, z) => (rng() < 0.5 ? c.barrel(x, z) : c.crate(x, z)));
    },
  },

  // ------------------------------------------------------------------ 3
  {
    id: 3,
    key: 'fort',
    name: 'Fort Ironside',
    subtitle: 'Day 6 — The last military holdout has fallen',
    size: [120, 120],
    theme: {
      ground: '#d8b97a', ground2: '#e3c68a', path: '#b89660', water: '#4f9ac4', wall: '#a8a08a', roof: '#6b7a4a',
      dark: 0.0, tree: 'dead', particles: 'dust', floor: '#8a7a5a',
    },
    zombies: [
      { type: 'walker', weight: 9, minWave: 1 },
      { type: 'runner', weight: 3, minWave: 1 },
      { type: 'armored', weight: 3, minWave: 2 },
      { type: 'spitter', weight: 3, minWave: 2 },
      { type: 'bloater', weight: 1, minWave: 4 },
    ],
    miniboss: 'juggernaut',
    boss: 'general',
    newWeapons: ['sniper', 'flamethrower'],
    story: {
      intro:
        'Fort Ironside fell days ago. Its bridge is the only way across the river — and the horde follows you everywhere. Rig the bridge, cross, and blow it behind you.',
      steps: [
        { type: 'collect', item: 'charge', label: 'Demolition Charge', count: 4, spots: 'charge', text: 'Recover 4 demolition charges from around the base.' },
        { type: 'activate', spots: ['pylonN', 'pylonS'], hold: 5, timeLimit: 40, label: 'Plant charges', text: 'Plant the charges on both bridge pylons within 40 seconds of each other.' },
        { type: 'boss', zombie: 'juggernaut', spot: 'hangar', nextRound: true, text: 'A Juggernaut in a blast suit is coming out of the hangar!' },
        { type: 'activate', spots: ['hangar'], hold: 6, label: 'Pull the detonator codes', text: 'The detonator is locked. Pull the codes from the hangar terminal.' },
        { type: 'survive', time: 60, horde: true, text: 'The detonator is arming. Survive the horde for 60 seconds!' },
        { type: 'souls', spot: 'yard', radius: 8, count: 20, text: "The General's guard is massing in the yard. Kill 20 zombies there." },
        { type: 'boss', zombie: 'general', spot: 'yard', text: 'The base commander has turned. Destroy the Iron General!' },
        { type: 'defend', spot: 'apc', radius: 5, time: 30, horde: true, text: "The APC won't start. Hold it while the driver hotwires it!" },
        { type: 'extract', spot: 'apc', radius: 4, text: 'Cross the bridge and get to the APC!' },
      ],
      outro: 'The bridge erupts behind your APC. In the commander\'s logbook: "Whiteout Station — cure research — priority one."',
    },
    build(c) {
      const { rng } = c;
      c.water(96, 1, 8, 54);
      c.water(96, 64, 8, 55);
      c.decor('bridge', 95, 55, { w: 10, d: 9 });
      c.fence(95, 54, 104, 54, { kind: 'rail' });
      c.fence(95, 64, 104, 64, { kind: 'rail' });
      c.spot('pylonN', 93, 53);
      c.spot('pylonS', 93, 66);
      c.spot('apc', 112, 59);
      c.solid(110, 52, 3, 5, { kind: 'apc', h: 2 });
      c.path([[44, 118], [44, 62], [60, 59], [94, 59]], 4, 'gravel');
      c.path([[44, 2], [44, 56]], 4, 'gravel');
      c.path([[2, 58], [40, 58]], 3.5, 'gravel');
      // perimeter wall with gates
      c.wall(8, 8, 40, 8, { kind: 'concrete' });
      c.wall(48, 8, 88, 8, { kind: 'concrete' });
      c.wall(8, 110, 42, 110, { kind: 'concrete' });
      c.wall(50, 110, 88, 110, { kind: 'concrete' });
      c.wall(8, 9, 8, 54, { kind: 'concrete' });
      c.wall(8, 62, 8, 109, { kind: 'concrete' });
      c.wall(88, 9, 88, 55, { kind: 'concrete' });
      c.wall(88, 64, 88, 109, { kind: 'concrete' });
      for (const [x, z] of [[9, 9], [85, 9], [9, 107], [85, 107]]) c.solid(x, z, 2, 2, { kind: 'tower', h: 4 });
      // barracks with lockers
      for (const [bz, gaps] of [[14, { e: [[3, 2]], s: [[8, 2]] }], [28, { e: [[3, 2]], n: [[8, 2]] }], [42, { e: [[3, 2]] }]]) {
        c.building(14, bz, 18, 10, { gaps, color: '#9a9a72', floor: '#7a6e52' });
        for (let k = 0; k < 4; k++) c.solid(16 + k * 3, bz + 6, 2, 2, { kind: 'bed', h: 0.6, low: true });
        c.loot('locker', 16, bz + 1, 's');
        c.loot('locker', 17, bz + 1, 's');
      }
      c.spot('charge', 28, 46);
      c.spot('perk', 22, 19, { perk: 'tough' });
      // hangar
      c.building(48, 14, 32, 22, { gaps: { s: [[10, 12]], w: [[8, 3]] }, color: '#7f8a72', floor: '#5a5a54' });
      c.spot('hangar', 64, 24);
      c.spot('charge', 76, 17);
      c.solid(54, 18, 6, 3, { kind: 'crate', h: 1.6, low: true });
      c.loot('rack', 50, 15, 's');
      c.loot('rack', 52, 15, 's');
      c.loot('crate', 76, 32, 'n');
      // command center + armory chest behind debris
      c.building(48, 82, 22, 14, { gaps: { n: [[9, 3]] }, color: '#8a8a80', floor: '#4a4a4a' });
      c.door(57, 82, 3, 1, 1250, 'Clear Debris');
      c.spot('charge', 52, 90);
      c.solid(62, 88, 4, 2, { kind: 'console', h: 1 });
      c.spot('forge', 66, 92);
      c.spot('boonshop', 40, 74);
      c.loot('chest', 50, 94, 'n');
      c.loot('rack', 67, 83, 's');
      // tent camp with campfires
      for (const [x, z] of [[16, 72], [24, 72], [32, 72], [16, 82], [24, 82], [32, 82], [16, 94], [24, 94]]) c.solid(x, z, 4, 3, { kind: 'tent', h: 1.8 });
      c.reserve(14, 70, 24, 30);
      c.campfire(21, 78);
      c.campfire(29, 89);
      c.loot('body', 33, 78);
      c.loot('crate', 20, 98, 'e');
      c.spot('charge', 35, 96);
      // container yard
      for (const [x, z] of [[72, 44], [72, 48], [80, 44], [76, 70], [76, 74], [68, 66]]) c.solid(x, z, 6, 2, { kind: 'container', h: 2.2, color: ['#a8503a', '#3a6aa8', '#4a8a4a'][(x + z) % 3] });
      c.loot('crate', 79, 49, 'w');
      c.loot('crate', 74, 68, 'n');
      c.spot('charge', 82, 77);
      c.spot('charge', 70, 52);
      c.spot('yard', 64, 60);
      c.lootCar(56, 48, true, '#5a6a3a');
      c.lootCar(30, 104, true, '#5a6a3a');
      for (const [x1, z1, x2, z2] of [[38, 50, 41, 50], [47, 50, 50, 50], [38, 66, 41, 66], [47, 66, 50, 66], [84, 51, 84, 54], [84, 65, 84, 68]]) c.fence(x1, z1, x2, z2, { kind: 'sandbag' });
      c.decor('helipad', 30, 59, {});
      for (const [x, z] of [[44, 58], [42, 60], [46, 60], [44, 63], [40, 58]]) c.spot('playerSpawn', x, z);
      c.spot('perk', 34, 54, { perk: 'quick' });
      c.spot('perk', 84, 30, { perk: 'swift' });
      c.spot('perk', 60, 104, { perk: 'rapid' });
      c.spot('box', 24, 64);
      c.spot('box', 70, 30);
      c.spot('box', 38, 104);
      for (const [x, z] of [[11, 30], [11, 60], [86, 40], [60, 108], [36, 38]]) c.lamp(x, z, 0xfff0c0);
      c.scatter(5, (x, z) => c.loot('body', x, z), [2, 2, 116, 116]);
      c.scatter(22, (x, z) => c.rock(x, z, 1 + rng.int(0, 2), 1 + rng.int(0, 1)));
      c.scatter(30, (x, z) => c.tree(x, z, 0.8));
      c.scatter(20, (x, z) => c.bush(x, z));
      c.scatter(24, (x, z) => (rng() < 0.5 ? c.barrel(x, z) : c.crate(x, z)), [10, 10, 76, 98]);
    },
  },

  // ------------------------------------------------------------------ 4
  {
    id: 4,
    key: 'snow',
    name: 'Whiteout Station',
    subtitle: 'Day 9 — A cure, buried in the ice',
    size: [120, 120],
    theme: {
      ground: '#e6eef5', ground2: '#d7e3ee', path: '#b9c8d6', water: '#9cc8e6', wall: '#8a9aaa', roof: '#4a6a8a',
      dark: 0.12, tree: 'pine', particles: 'snow', floor: '#7a828c',
    },
    zombies: [
      { type: 'walker', weight: 8, minWave: 1 },
      { type: 'runner', weight: 3, minWave: 1 },
      { type: 'leaper', weight: 3, minWave: 2 },
      { type: 'screamer', weight: 2, minWave: 3 },
      { type: 'armored', weight: 2, minWave: 3 },
      { type: 'crawler', weight: 2, minWave: 2 },
    ],
    miniboss: 'brute',
    boss: 'hivequeen',
    newWeapons: ['lmg', 'raygun'],
    story: {
      intro:
        'Whiteout Station was researching the infection before it went silent. Restore power, recover the tissue samples and run the analysis — if a cure exists, it starts here.',
      steps: [
        { type: 'activate', spots: ['generator'], hold: 6, label: 'Restart generator', text: 'Restart the station generator.' },
        { type: 'activate', spots: ['dorm'], hold: 5, label: 'Search the dorms', text: "Search the dorms for the lead scientist's lab notes." },
        { type: 'collect', item: 'sample', label: 'Tissue Sample', count: 3, spots: 'sample', round: 3, text: 'The ice thaws by round 3. Recover 3 frozen tissue samples from the wilderness.' },
        { type: 'souls', spot: 'centrifuge', radius: 7, count: 20, text: 'The centrifuge runs on infected tissue. Kill 20 zombies near the lab.' },
        { type: 'defend', spot: 'centrifuge', radius: 6, time: 45, horde: true, text: 'The analysis is running. Defend the lab!' },
        { type: 'boss', zombie: 'brute', count: 2, spot: 'dorm', nextRound: true, text: 'Twin Brutes are breaking into the station!' },
        { type: 'activate', spots: ['hive'], hold: 5, label: 'Plant the sonic lure', text: 'Draw it out: plant the sonic lure at the hive under the ice.' },
        { type: 'boss', zombie: 'hivequeen', spot: 'hive', text: 'The analysis woke something under the ice. Kill the Hive Queen!' },
        { type: 'extract', spot: 'snowcat', radius: 4, text: 'Get to the snowcat in the garage!' },
      ],
      outro: 'The analysis points to the source: Prometheus Labs. Patient Zero is still down there.',
    },
    build(c) {
      const { rng } = c;
      c.decor('ice', 82, 70, { w: 26, d: 20 });
      c.reserve(82, 70, 26, 20);
      c.spot('hive', 95, 80);
      c.path([[60, 62], [60, 98]], 3, 'snow');
      c.path([[38, 59], [14, 59], [12, 40], [22, 24]], 2.4, 'snow');
      c.path([[84, 59], [100, 40], [98, 22]], 2.4, 'snow');
      c.path([[64, 84], [80, 92], [102, 94]], 2.4, 'snow');
      // compound fence
      c.fence(36, 36, 56, 36);
      c.fence(62, 36, 84, 36);
      c.fence(36, 37, 36, 56);
      c.fence(36, 62, 36, 84);
      c.fence(36, 84, 56, 84);
      c.fence(62, 84, 84, 84);
      c.fence(84, 37, 84, 56);
      c.fence(84, 62, 84, 83);
      c.building(40, 40, 12, 9, { gaps: { s: [[4, 3]] }, color: '#a8805a', floor: '#5a5a60' });
      c.spot('generator', 45, 43);
      c.solid(42, 42, 2, 2, { kind: 'generator', h: 1.4 });
      c.loot('toolbox', 49, 42);
      c.building(58, 40, 20, 14, { gaps: { s: [[8, 3]], w: [[5, 2]] }, color: '#8aa0bc', floor: '#6a7282' });
      c.spot('centrifuge', 68, 45);
      c.solid(62, 42, 4, 1, { kind: 'console', h: 1 });
      c.solid(72, 42, 4, 1, { kind: 'console', h: 1 });
      c.loot('locker', 76, 41, 'w');
      c.loot('locker', 76, 44, 'w');
      c.building(40, 62, 16, 12, { gaps: { n: [[6, 3]], e: [[4, 2]] }, color: '#b07a6a', floor: '#6a5a4a' });
      c.spot('dorm', 47, 68);
      for (let k = 0; k < 3; k++) c.solid(42 + k * 4, 70, 2, 2, { kind: 'bed', h: 0.6, low: true });
      c.loot('locker', 42, 63, 's');
      c.spot('perk', 52, 65, { perk: 'tough' });
      c.solid(70, 66, 3, 3, { kind: 'tower', h: 5 });
      c.solid(62, 74, 3, 3, { kind: 'tank', h: 2.5 });
      c.solid(66, 74, 3, 3, { kind: 'tank', h: 2.5 });
      c.loot('rack', 74, 78, 'w');
      c.campfire(48, 58);
      c.lamp(56, 37);
      c.lamp(62, 37);
      c.lamp(56, 83);
      // garage
      c.building(52, 98, 16, 12, { gaps: { n: [[6, 4]] }, color: '#7a8a9a', floor: '#45454c' });
      c.solid(56, 103, 3, 4, { kind: 'snowcat', h: 1.8 });
      c.spot('snowcat', 62, 104);
      c.loot('toolbox', 65, 100);
      // wilderness sample sites
      c.solid(18, 16, 8, 2, { kind: 'wreck', h: 1.4 });
      c.solid(22, 20, 2, 5, { kind: 'wreck', h: 1.2 });
      c.spot('sample', 20, 23);
      c.loot('body', 26, 18);
      c.loot('chest', 17, 19, 'e');
      c.building(92, 12, 12, 10, { gaps: { w: [[4, 2]] }, color: '#8a5a3a', floor: '#5a4a3a' });
      c.spot('sample', 98, 17);
      c.loot('locker', 102, 13, 'w');
      c.campfire(88, 18);
      c.spot('sample', 104, 94);
      c.loot('body', 101, 97);
      c.spot('sample', 14, 96);
      c.rock(10, 50, 3, 3);
      c.rock(14, 54, 2, 3);
      c.spot('sample', 13, 59);
      c.building(10, 86, 10, 8, { gaps: { e: [[3, 2]] }, color: '#7a5a42', floor: '#4a3a2a' });
      c.door(19, 89, 1, 2, 1000, 'Clear Debris');
      c.spot('sample', 14, 90);
      c.loot('rack', 11, 87, 's');
      c.pond(30, 40, 5, 3.5);
      for (const [x, z] of [[60, 58], [58, 60], [62, 60], [60, 62], [56, 58]]) c.spot('playerSpawn', x, z);
      c.spot('perk', 80, 40, { perk: 'quick' });
      c.spot('perk', 30, 30, { perk: 'swift' });
      c.spot('perk', 92, 104, { perk: 'rapid' });
      c.spot('box', 76, 64);
      c.spot('box', 26, 70);
      c.spot('box', 96, 32);
      c.spot('forge', 72, 58);
      c.spot('boonshop', 48, 50);
      c.forestBorder(5, 0.6);
      c.scatter(5, (x, z) => c.loot('crate', x, z, 's'), [8, 8, 104, 104]);
      c.scatter(120, (x, z) => c.tree(x, z, 0.8 + rng() * 0.6));
      c.scatter(30, (x, z) => c.bush(x, z));
      c.scatter(16, (x, z) => c.rock(x, z, 1 + rng.int(0, 2), 1 + rng.int(0, 1)));
    },
  },

  // ------------------------------------------------------------------ 5
  {
    id: 5,
    key: 'lab',
    name: 'Ground Zero',
    subtitle: 'Day 12 — Prometheus Labs',
    size: [128, 128],
    theme: {
      ground: '#5c5866', ground2: '#66626f', path: '#47434f', water: '#5a3a7a', wall: '#7a7f8c', roof: '#3a3f4c',
      dark: 0.55, tree: 'none', particles: 'embers', floor: '#4a4652',
    },
    zombies: [
      { type: 'walker', weight: 7, minWave: 1 },
      { type: 'runner', weight: 3, minWave: 1 },
      { type: 'phantom', weight: 3, minWave: 2 },
      { type: 'burner', weight: 3, minWave: 2 },
      { type: 'spitter', weight: 2, minWave: 2 },
      { type: 'armored', weight: 2, minWave: 3 },
      { type: 'leaper', weight: 1, minWave: 4 },
      { type: 'bloater', weight: 1, minWave: 4 },
    ],
    miniboss: 'juggernaut',
    boss: 'patientzero',
    newWeapons: ['tesla', 'minigun'],
    story: {
      intro:
        'Prometheus Labs: where it started. Shut down the reactors keeping the containment breach alive, synthesize the antidote — and put Patient Zero down for good.',
      steps: [
        { type: 'activate', spots: ['reactorA', 'reactorB', 'reactorC'], hold: 5, timeLimit: 60, label: 'Shut down reactor', text: 'Shut down all 3 reactor cores within 60 seconds.' },
        { type: 'collect', item: 'vial', label: 'Antidote Vial', count: 3, spots: 'vial', round: 4, text: 'The vault unseals on round 4. Collect 3 antidote vials from the research wings.' },
        { type: 'souls', spot: 'lab', radius: 7, count: 25, text: 'The synthesizer needs live tissue. Kill 25 zombies near the central lab.' },
        { type: 'defend', spot: 'lab', radius: 6, time: 60, horde: true, text: 'Synthesize the cure. Defend the central lab!' },
        { type: 'activate', spots: ['east', 'lab'], hold: 5, timeLimit: 45, label: 'Upload the cure', text: 'Upload the cure formula at the east servers and the central lab within 45 seconds.' },
        { type: 'boss', zombie: 'juggernaut', spot: 'east', nextRound: true, text: 'Facility security has turned. Destroy the Juggernaut!' },
        { type: 'survive', time: 60, horde: true, text: 'LOCKDOWN. Survive until the elevator power comes back!' },
        { type: 'boss', zombie: 'patientzero', spot: 'lab', text: 'PATIENT ZERO HAS AWAKENED. END THIS.' },
        { type: 'extract', spot: 'elevator', radius: 4, openDoors: [0], text: 'The elevator is open. Get out!' },
      ],
      outro: 'The elevator rises into daylight. The cure is in your hands. For the first time in twelve days — you are winning.',
    },
    build(c) {
      const { rng } = c;
      const lines = [44, 84];
      for (const L of lines) {
        for (const [a, b] of [[1, 44], [44, 84], [84, 126]]) {
          const mid = Math.floor((a + b) / 2);
          c.wall(L, a, L, mid - 3, { kind: 'lab' });
          c.wall(L, mid + 3, L, b, { kind: 'lab' });
          c.wall(a, L, mid - 3, L, { kind: 'lab' });
          c.wall(mid + 3, L, b, L, { kind: 'lab' });
        }
      }
      // floor zones
      for (const [x, z, col] of [[2, 2, '#4f5a66'], [86, 2, '#4f5a66'], [86, 86, '#4f5a66'], [46, 46, '#5a4a5a'], [46, 86, '#4a5550']]) c.decor('tiles', x, z, { w: 36, d: 36, color: col });
      c.building(56, 4, 16, 10, { gaps: { s: [[6, 4]] }, kind: 'lab', color: '#4a4f5c', floor: '#202028' });
      c.door(62, 13, 4, 1, 99999, 'Elevator (locked)');
      c.spot('elevator', 64, 8);
      c.door(44, 20, 1, 5, 1000, 'Clear Debris');
      c.door(20, 84, 5, 1, 1250, 'Clear Debris');
      for (const [name, x, z] of [['reactorA', 22, 22], ['reactorB', 104, 22], ['reactorC', 104, 104]]) {
        c.solid(x - 2, z - 2, 4, 4, { kind: 'reactor', h: 2.5 });
        c.spot(name, x, z + 4);
        c.light(x, z, 0x50ff90, 1, 9);
      }
      c.solid(58, 58, 3, 2, { kind: 'console', h: 1 });
      c.solid(67, 58, 3, 2, { kind: 'console', h: 1 });
      c.solid(62, 68, 4, 2, { kind: 'tank', h: 2 });
      c.spot('lab', 64, 63);
      c.light(64, 64, 0xff5050, 1, 10);
      c.spot('vial', 18, 64);
      c.spot('vial', 110, 64);
      c.spot('vial', 18, 110);
      c.spot('vial', 64, 22);
      c.spot('east', 104, 64);
      for (const [x, z] of [[8, 56], [12, 70], [112, 56], [116, 72], [10, 104], [100, 112]]) c.solid(x, z, 2, 6, { kind: 'console', h: 1.2 });
      // security room (west wing) with weapon racks; chest behind debris in south-west
      c.loot('rack', 4, 50, 'e');
      c.loot('rack', 4, 53, 'e');
      c.loot('locker', 40, 48, 'w');
      c.loot('chest', 6, 120, 'n');
      c.loot('rack', 122, 76, 'w');
      c.loot('locker', 90, 46, 'e');
      c.loot('locker', 90, 49, 'e');
      c.loot('locker', 48, 120, 'n');
      c.loot('locker', 80, 120, 'n');
      c.scatter(7, (x, z) => c.loot('body', x, z), [4, 4, 120, 120]);
      c.scatter(6, (x, z) => c.loot('toolbox', x, z), [4, 4, 120, 120]);
      c.scatter(5, (x, z) => c.loot('crate', x, z, 's'), [4, 4, 120, 120]);
      c.scatter(22, (x, z) => (c.free(x, z, 2, 2) ? c.solid(x, z, 2, 2, { kind: 'tank', h: 2 }) : false));
      c.scatter(26, (x, z) => (rng() < 0.5 ? c.barrel(x, z) : c.crate(x, z)));
      for (let k = 0; k < 22; k++) c.decor('crack', 6 + rng() * 116, 6 + rng() * 116, { r: 1 + rng() * 2, rot: rng() * 6.28 });
      for (const [x, z] of [[64, 104], [22, 104], [104, 64], [22, 64], [64, 30], [30, 30], [98, 98]]) c.light(x, z, 0xff7050, 1, 9);
      for (const [x, z] of [[64, 110], [62, 112], [66, 112], [64, 114], [60, 110]]) c.spot('playerSpawn', x, z);
      c.spot('perk', 52, 120, { perk: 'tough' });
      c.spot('perk', 30, 40, { perk: 'quick' });
      c.spot('perk', 98, 40, { perk: 'swift' });
      c.spot('perk', 98, 90, { perk: 'rapid' });
      c.spot('box', 76, 100);
      c.spot('box', 30, 90);
      c.spot('box', 90, 30);
      c.spot('forge', 74, 116);
      c.spot('boonshop', 54, 100);
    },
  },
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id);
}
