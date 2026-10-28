// Focused checks for individual mechanics (forge levels, weapons, upgrades, downs).
import { Game } from '../dist/sim.mjs';

const DT = 1 / 60;
let failures = 0;
const check = (name, ok, info = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' (' + info + ')' : ''}`);
};

// a quiet game: no waves, one or two players standing at the spawn
function quiet(mapId, n = 1) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: i, name: 'P' + i, char: ['volt', 'doc'][i], level: 3 });
  const g = new Game({ mapId, mode: 'endless', seed: 5, players, unlockedMap: 5 });
  g.wave = 5;
  g.waveT = 1e9;
  return g;
}
const idle = (p, extra = {}) => ({ mx: 0, mz: 0, ax: p.x + 5, az: p.z, fire: false, sprint: false, use: false, acts: {}, ...extra });
function run(g, seconds, input) {
  const events = [];
  for (let i = 0; i < seconds / DT; i++) {
    for (const p of g.players) g.setInput(p.id, input ? input(p, i) : idle(p));
    g.update(DT);
    events.push(...g.drainEvents());
  }
  return events;
}

// 1) no forge on maps 1-2, upgrade machine everywhere
for (let m = 1; m <= 5; m++) {
  const g = quiet(m);
  check(`map${m} machines`, (m <= 2 ? !g.world.spots.forge : !!g.world.spots.forge) && !!g.world.spots.boonshop);
}

// 2) forge XX needs kills with the forged gun
{
  const g = quiet(3);
  const p = g.players[0];
  const fs = g.world.spots.forge;
  p.x = fs.x;
  p.z = fs.z;
  p.points = 1e6;
  p.weapons[0] = g.makeWeapon('smg', 1);
  const use = (q) => idle(q, { acts: { usePress: true } });
  run(g, 0.1, use);
  check('forge XX locked before kills', p.weapons[0].forged === 1 && /0\/100/.test(p.prompt), p.prompt);
  for (let i = 0; i < 100; i++) {
    const z = g.spawnZombie('walker', p.x + 3, p.z, false);
    g.damageZombie(z, 1e6, p.id, 'bullet');
  }
  const before = p.points;
  const gun = p.weapons[0];
  run(g, 0.05, use);
  check('forge XX costs 10000', before - p.points === 10000, `${before - p.points}`);
  check('gun goes into the forge, loaner pistol in hand', !p.weapons.includes(gun) && p.weapons[0].id === 'pistol' && g.forgeJob.w === gun);
  run(g, 4.5, use);
  check('still forging at 4.5 s', g.forgeJob && g.forgeJob.t > 0 && !p.weapons.includes(gun), p.prompt);
  run(g, 0.6);
  run(g, 0.05, use);
  check('forge XX taken after 5 s', p.weapons.includes(gun) && p.weapons[p.cur] === gun && gun.forged === 2 && !g.forgeJob && g.wstat(p, gun).name.endsWith(' XX'));
}

// 2b) forge damage is a fixed multiplier (X x1.5, XX x2 of the unforged gun, any round), and
// bosses take only half the bonus
{
  const g = quiet(3);
  const p = g.players[0];
  const dmg = (lvl, rarity = 0) => g.wstat(p, g.makeWeapon('ar', lvl, rarity)).damage;
  const x = dmg(1) / dmg(0), xx = dmg(2) / dmg(0), xxLeg = dmg(2, 4) / dmg(0, 4);
  check('forge multipliers fixed', Math.abs(x - 1.5) < 1e-9 && Math.abs(xx - 2) < 1e-9 && Math.abs(xxLeg - 2) < 1e-9, `X ${x.toFixed(2)}, XX ${xx.toFixed(2)}`);
  p.weapons[0] = g.makeWeapon('ar', 2);
  p.cur = 0;
  const hit = (type) => {
    const z = g.spawnZombie(type, p.x + 3, p.z, false);
    z.hp = 1e7;
    g.damageZombie(z, 1000, p.id, 'bullet');
    return 1e7 - z.hp;
  };
  const boss = hit('harvester'), walker = hit('walker');
  check('bosses take half the forge bonus', walker === 1000 && Math.abs(boss - (1000 * (1 + (xx - 1) * 0.5)) / xx) < 1e-6, `boss ${boss.toFixed(1)}`);
}

// 2d) Storm Caller: 350 damage, 3 shots per reload at every forge level and rarity, one every 1.5 s
{
  const g = quiet(5);
  const p = g.players[0];
  const st = (lvl, r) => g.wstat(p, g.makeWeapon('tesla', lvl, r));
  const mags = [st(0, 0), st(1, 4), st(2, 4)].map((s) => s.mag);
  // minimum rarity Epic, so a "common" one comes out Epic (x1.42)
  check('storm caller stats', g.makeWeapon('tesla').rarity === 3 && Math.round(st(0, 0).damage) === 497 && Math.abs(1 / st(0, 0).rate - 1.5) < 1e-9 && mags.every((m) => m === 3), `mags ${mags}`);
}

// 2c) runners stay faster than walkers but never outrun a walking player
{
  const g = quiet(1);
  g.wave = 40;
  const runner = g.spawnZombie('runner', 10, 10, false), walker = g.spawnZombie('walker', 10, 12, false);
  check('runner speed capped', runner.speed > walker.speed && runner.speed <= 5.4 * 0.9 + 1e-9, `runner ${runner.speed.toFixed(2)}, walker ${walker.speed.toFixed(2)}`);
}

// 3) grenade launcher lands near the cursor
{
  const g = quiet(1);
  const p = g.players[0];
  p.weapons[0] = g.makeWeapon('gl');
  const tx = p.x + 9, tz = p.z + 4;
  const ev = run(g, 1.5, (q, i) => idle(q, { ax: tx, az: tz, fire: i < 2 }));
  const boom = ev.find((e) => e.k === 'boom');
  check('launcher lobs to cursor', boom && Math.hypot(boom.x - tx, boom.z - tz) < 1.5, boom ? `landed ${Math.hypot(boom.x - tx, boom.z - tz).toFixed(2)} from cursor` : 'no boom');
}

// 4) plasma ray pierces with its own hit effect and no explosion
{
  const g = quiet(1);
  const p = g.players[0];
  p.weapons[0] = g.makeWeapon('raygun');
  const zs = [3, 4.5, 6].map((d) => g.spawnZombie('armored', p.x + d, p.z, false));
  for (const z of zs) z.speed = 0;
  const ev = run(g, 0.6, (q, i) => idle(q, { ax: q.x + 10, az: q.z, fire: i === 0 }));
  const hits = ev.filter((e) => e.k === 'rayhit').length;
  check('ray pierces 3 with rayhit, no boom', hits === 3 && !ev.some((e) => e.k === 'boom'), `rayhits=${hits}`);
}

// 5) downed teammates get 45 s
{
  const g = quiet(1, 2);
  const [a] = g.players;
  g.hurtPlayer(a, 9999);
  check('bleed time 45s', a.state === 'down' && a.bleed === 45);
}

// 6) upgrade machine sells 3 choices, price rises
{
  const g = quiet(2);
  const p = g.players[0];
  const s = g.world.spots.boonshop;
  p.x = s.x;
  p.z = s.z;
  p.points = 10000;
  run(g, 0.05, (q) => idle(q, { acts: { usePress: true } }));
  check('machine gives 3 choices', p.choices.length === 1 && p.choices[0].length === 3 && p.points === 8500, `points=${p.points}`);
  g.pickBoon(p, 0);
  run(g, 0.05, (q) => idle(q, { acts: { usePress: true } }));
  check('second purchase costs more', p.points === 6000, `points=${p.points}`);
}

// 7) walkers can hit a player who keeps moving past them
{
  const g = quiet(1);
  const p = g.players[0];
  const z = g.spawnZombie('walker', p.x + 1.5, p.z, false);
  let hurt = 0;
  for (let i = 0; i < 10 / DT; i++) {
    // strafe back and forth through the zombie's reach at walking pace
    const dir = Math.sin(i / 40) > 0 ? 1 : -1;
    g.setInput(p.id, idle(p, { mz: dir }));
    p.hp = p.maxHp;
    p.invuln = 0;
    g.update(DT);
    hurt += g.drainEvents().filter((e) => e.k === 'hurt').length;
    if (Math.hypot(z.x - p.x, z.z - p.z) > 3) {
      z.x = p.x + 1.5;
      z.z = p.z;
    }
  }
  check('walker hits a moving player', hurt >= 3, `hits=${hurt}`);
}

// 8) new upgrades
{
  const g = quiet(1, 2);
  const [a, b] = g.players;
  a.boons.aegis = 2;
  run(g, 1);
  a.shield = 50;
  g.hurtPlayer(a, 30);
  check('aegis absorbs damage', a.hp === a.maxHp && a.shield === 20);
  b.boons.laststand = 1;
  g.hurtPlayer(b, 9999);
  run(g, 3.5);
  check('last stand self-revives once', b.state === 'alive' && !b.boons.laststand);
  a.boons.thorns = 1;
  a.shield = 0;
  const z = g.spawnZombie('walker', a.x + 1, a.z, false);
  const hp0 = z.hp;
  run(g, 2);
  check('thorns hurt attackers', z.dead || z.hp < hp0);
  // overcharge scales Volt's chain lightning
  const dmgWith = (n) => {
    const g2 = quiet(1);
    const p = g2.players[0];
    p.boons.overcharge = n;
    const t = g2.spawnZombie('juggernaut', p.x + 4, p.z, false);
    t.speed = 0;
    const before = t.hp;
    run(g2, 0.1, (q, i) => idle(q, { ax: t.x, az: t.z, acts: i === 0 ? { ability: true } : {} }));
    return before - t.hp;
  };
  const d0 = dmgWith(0), d2 = dmgWith(2);
  check('overcharge boosts ability damage', d2 > d0 * 1.25, `${Math.round(d0)} -> ${Math.round(d2)}`);
}

// 9) Mags drops bags around himself; each bag goes to one player who is short on ammo
{
  const g = new Game({ mapId: 1, mode: 'endless', seed: 5, unlockedMap: 5, players: [
    { id: 0, name: 'M', char: 'mags', level: 5 }, { id: 1, name: 'A', char: 'brick', level: 1 }] });
  g.wave = 5;
  g.waveT = 1e9;
  const [m, a] = g.players;
  a.x = m.x + 20; // ally is away when the bags drop
  run(g, 0.05, (q) => idle(q, { acts: q === m ? { ability: true } : {} }));
  const bags = g.pickups.filter((k) => k.kind === 'supply');
  const gaps = bags.map((k) => Math.hypot(k.x - m.x, k.z - m.z));
  check('level 5 drops three bags around Mags', bags.length === 3 && gaps.every((d) => d > 1.3), gaps.map((d) => d.toFixed(2)).join(' '));
  // a full player walks over a bag without using it
  a.x = bags[0].x;
  a.z = bags[0].z;
  run(g, 0.05);
  check('full ammo leaves the bag', g.pickups.includes(bags[0]));
  const w = a.weapons[0];
  const max = g.wstat(a, w).reserve;
  w.reserve = 0;
  w.mag = 0;
  a.grenades = 0;
  run(g, 0.05);
  check('ally restocks and the bag is used up', w.reserve === max && w.mag === g.wstat(a, w).mag && a.grenades === 1 && !g.pickups.includes(bags[0]), `reserve ${w.reserve}/${max}`);
  check('Mags carries +25% reserve', g.wstat(m, m.weapons[0]).reserve === Math.round(g.wstat(a, a.weapons[0]).reserve * 1.25));
}

// 9b) the upgrade machine is well away from the forge
for (let m = 3; m <= 5; m++) {
  const { forge, boonshop } = quiet(m).world.spots;
  check(`map${m} machines apart`, Math.hypot(forge.x - boonshop.x, forge.z - boonshop.z) > 15);
}

// 9c) Brick can wall himself in; zombies outside hit the wall, not him
{
  const g = new Game({ mapId: 1, mode: 'endless', seed: 5, unlockedMap: 5, players: [{ id: 0, name: 'B', char: 'brick', level: 5 }] });
  g.wave = 5;
  g.waveT = 1e9;
  const b = g.players[0];
  b.charges = 9;
  let built = 0;
  for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const n = g.structs.length;
    run(g, DT, (q) => idle(q, { ax: q.x + Math.cos(ang) * 5, az: q.z + Math.sin(ang) * 5, acts: { ability: true } }));
    if (g.structs.length > n) built++;
  }
  check('Brick can box himself in', built === 4, `walls ${built}/4`);
  const wall = g.structs[0];
  const z = g.spawnZombie('walker', wall.x + Math.sign(wall.x - b.x) * 1.2, wall.z, false);
  const hp0 = wall.hp;
  let hurt = 0;
  for (let i = 0; i < 4 / DT; i++) {
    g.setInput(b.id, idle(b));
    b.hp = b.maxHp;
    g.update(DT);
    hurt += g.drainEvents().filter((e) => e.k === 'hurt').length;
    if (!g.structs.includes(wall)) break;
  }
  check('zombie damages the wall instead of the player', hurt === 0 && (wall.hp < hp0 || !g.structs.includes(wall)), `hits=${hurt} wall ${Math.round(wall.hp)}/${hp0} z@${Math.hypot(z.x - b.x, z.z - b.z).toFixed(2)}`);
}

// 10) weapon swaps: number keys pick a slot, and two quick swap presses in one tick cancel out
{
  const g = quiet(1);
  const p = g.players[0];
  p.weapons[1] = g.makeWeapon('smg');
  const tick = (acts) => run(g, DT, (q) => idle(q, { acts }));
  tick({ slot: 2 });
  const a = p.cur;
  tick({ slot: 2 });
  const b = p.cur;
  g.setInput(p.id, idle(p, { acts: { swap: 1 } }));
  g.setInput(p.id, idle(p, { acts: { swap: 1 } }));
  run(g, DT);
  const c = p.cur;
  tick({ swap: 1 });
  check('slot keys and swap presses', a === 1 && b === 1 && c === 1 && p.cur === 0, `${a}${b}${c}${p.cur}`);
}

// 11) Burners set you on fire instead of exploding when they die
{
  const g = quiet(5);
  const p = g.players[0];
  const z = g.spawnZombie('burner', p.x + 1.2, p.z, false);
  z.state = 'move';
  let lit = false;
  for (let i = 0; i < 3 / DT && !lit; i++) {
    run(g, DT);
    lit = p.burnT > 0;
  }
  p.invuln = 0;
  g.removeZombie(z);
  const hp = p.hp;
  run(g, 1);
  check('burner hit sets you on fire', lit && p.hp < hp, `hp ${Math.round(hp)} -> ${Math.round(p.hp)}`);
  const z2 = g.spawnZombie('burner', p.x + 6, p.z, false);
  g.damageZombie(z2, 1e6, p.id, 'bullet');
  check('dead burner does not explode', !g.drainEvents().some((e) => e.k === 'boom'));
}

// 12) +5 max health per level up
{
  const g = quiet(1);
  const p = g.players[0];
  const hp0 = p.maxHp, r0 = p.rank;
  g.gainXp(p, 5000);
  check('level ups add 5 max health each', p.rank > r0 && p.maxHp === hp0 + 5 * (p.rank - r0), `+${p.rank - r0} levels, ${hp0} -> ${p.maxHp}`);
}

// 13) rarity floors: minigun / storm caller Epic+, plasma ray / launcher Rare+
{
  const g = quiet(5);
  const guns = (r) => g.gunsFor(r);
  check('rarity floors', !guns(1).some((w) => ['gl', 'raygun', 'minigun', 'tesla'].includes(w)) && guns(2).includes('gl') && !guns(2).includes('tesla') && guns(3).includes('minigun') && guns(3).includes('tesla'));
}

// 14) story steps run alongside the rounds (map 2: brute at next round, timed substations,
// souls, horde defend, boss gated to round 6)
{
  const g = new Game({ mapId: 2, mode: 'story', seed: 5, unlockedMap: 5, players: [{ id: 0, name: 'P', char: 'volt', level: 3 }] });
  const p = g.players[0];
  check('next-round step waits', g.ss.waiting && g.ss.waitRound === 1 && !g.zombies.some((z) => z.type === 'brute'));
  g.startWave();
  run(g, DT);
  check('next-round step starts with the round', !g.ss.waiting && g.zombies.some((z) => z.type === 'brute'));
  // finishing a step no longer starts a round
  const w = g.wave;
  for (const z of [...g.zombies]) if (z.type === 'brute') g.damageZombie(z, 1e9, p.id, 'bullet');
  run(g, DT);
  const drop = g.pickups.find((k) => k.kind === 'item');
  p.x = drop.x;
  p.z = drop.z;
  run(g, 0.1);
  check('finishing a step does not start a round', g.stepIdx === 1 && g.wave === w, `step ${g.stepIdx}, wave ${w} -> ${g.wave}`);
  // timed sequence: one station done, the other left too long -> both reset
  g.ss.stations[0].prog = 1;
  run(g, DT);
  check('timed sequence starts its clock', g.ss.left > 39);
  g.ss.left = 0.01;
  run(g, 0.05);
  check('timed sequence resets when it runs out', g.ss.stations.every((st) => !st.done && st.prog === 0) && g.ss.left === undefined);
  for (const st of g.ss.stations) st.prog = 1;
  run(g, DT);
  // souls: kills inside the zone count, kills outside don't
  check('souls step started', g.step.type === 'souls');
  const zone = g.ss.zone;
  const far = g.spawnZombie('walker', zone.x + zone.r + 5, zone.z, false);
  g.damageZombie(far, 1e9, p.id, 'bullet');
  for (let i = 0; i < 15; i++) g.damageZombie(g.spawnZombie('walker', zone.x + 1, zone.z, false), 1e9, p.id, 'bullet');
  check('souls count only near the collector', g.ss.got === 15, `got ${g.ss.got}`);
  run(g, DT);
  // horde: zombies keep coming after the round's own quota is used up
  check('horde step active', g.step.horde === true);
  for (const z of [...g.zombies]) g.removeZombie(z);
  g.toSpawn = 0;
  run(g, 5);
  check('horde keeps spawning past the round quota', g.toSpawn === 0 && g.zombies.length > 0, `zombies ${g.zombies.length}`);
  g.ss.left = 0;
  run(g, DT);
  check('round-gated boss waits for round 6', g.ss.waiting && g.ss.waitRound === 6 && !g.zombies.some((z) => z.type === 'abomination'));
  while (g.wave < 6) g.startWave();
  run(g, DT);
  check('round-gated boss arrives on round 6', g.zombies.some((z) => z.type === 'abomination'));
}

// 15) containers can be searched from every open side (walls still block)
{
  let open = 0, bad = [];
  for (let m = 1; m <= 5; m++) {
    const g = quiet(m);
    const p = g.players[0];
    const { W, grid } = g.world;
    for (const c of g.containers) {
      if (!c.box) continue;
      const [x0, z0, x1, z1] = c.box;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      for (const [x, z] of [[mx, z0 - 0.75], [mx, z1 + 0.75], [x0 - 0.75, mz], [x1 + 0.75, mz]]) {
        if (grid[Math.floor(z) * W + Math.floor(x)] !== 0) continue; // a wall or prop is there
        open++;
        p.x = x;
        p.z = z;
        if (g.lootReach(p, c) === Infinity) bad.push(`map${m} ${c.kind}@${x.toFixed(1)},${z.toFixed(1)}`);
      }
    }
  }
  check('containers searchable from every open side', open > 100 && !bad.length, `${open} sides, unreachable: ${bad.slice(0, 5).join(' ')}`);
  // and not through a wall: a player on the far side of a building wall can't reach in
  const g = quiet(1);
  const { W, grid } = g.world;
  let through = 0;
  for (const c of g.containers) {
    if (!c.box) continue;
    const [x0, z0, x1, z1] = c.box;
    for (const [wx, wz, px, pz] of [[x0 - 0.5, z0 + 0.5, x0 - 1.5, z0 + 0.5], [x1 + 0.5, z0 + 0.5, x1 + 1.5, z0 + 0.5], [x0 + 0.5, z0 - 0.5, x0 + 0.5, z0 - 1.5], [x0 + 0.5, z1 + 0.5, x0 + 0.5, z1 + 1.5]]) {
      const v = grid[Math.floor(wz) * W + Math.floor(wx)];
      if (v !== 1 && v !== 2) continue; // only real walls
      g.players[0].x = px;
      g.players[0].z = pz;
      if (g.lootReach(g.players[0], c) !== Infinity) through++;
    }
  }
  check('containers not searchable through walls', through === 0, `through=${through}`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
