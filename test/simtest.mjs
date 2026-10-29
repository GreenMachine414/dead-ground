// Headless simulation test: bots play every map (story + endless) and we check
// that nothing throws, the story can be completed, and snapshots serialize.
import { Game, MAPS } from '../dist/sim.mjs';

const DT = 1 / 60;
let failures = 0;

function bot(game, p, god) {
  const snapZ = game.zombies;
  let best = null, bd = Infinity;
  for (const z of snapZ) {
    const d = Math.hypot(z.x - p.x, z.z - p.z);
    if (d < bd) { bd = d; best = z; }
  }
  const input = { mx: 0, mz: 0, ax: p.x + 1, az: p.z, fire: false, use: false, acts: {} };
  if (best && bd < 25) {
    input.ax = best.x; input.az = best.z; input.fire = true;
  }
  if (god) {
    p.invuln = 99;
    const w = game.curWeapon(p);
    w.reserve = 999;
    // walk / teleport toward objective markers
    const o = game.objectiveView();
    let goal = null;
    if (o.zone) goal = { x: o.zone[0], z: o.zone[1] };
    else if (o.mk.length) goal = { x: o.mk[0][0], z: o.mk[0][1] };
    if (goal) {
      const d = Math.hypot(goal.x - p.x, goal.z - p.z);
      if (d > 1.0 && o.mk[0]?.[2] !== 2) { p.x = goal.x; p.z = goal.z; }
      input.use = true;
    }
  }
  if (Math.random() < 0.01) input.acts.ability = true;
  if (Math.random() < 0.005) input.acts.grenade = true;
  if (Math.random() < 0.01) input.acts.melee = true;
  if (Math.random() < 0.02) input.acts.usePress = true;
  if (Math.random() < 0.003) input.acts.swap = true;
  game.setInput(p.id, input);
}

function run(name, opts, seconds, god, expectWin) {
  const chars = ['brick', 'sparks', 'doc', 'rook', 'volt', 'mags'];
  const players = [];
  for (let i = 0; i < opts.players; i++) players.push({ id: i, name: 'Bot' + i, char: chars[(i + opts.charOffset) % chars.length], level: opts.level || 3 });
  const t0 = Date.now();
  let game;
  try {
    game = new Game({ mapId: opts.mapId, mode: opts.mode, seed: opts.seed || 1234, players, unlockedMap: 5 });
    if (god) for (const p of game.players) { p.weapons[0] = game.makeWeapon('minigun', true); p.points = 1e6; }
    let maxBytes = 0, maxZ = 0, steps = Math.round(seconds / DT);
    for (let i = 0; i < steps && !game.result; i++) {
      for (const p of game.players) bot(game, p, god);
      game.update(DT);
      game.drainEvents();
      maxZ = Math.max(maxZ, game.zombies.length);
      if (i % 120 === 0) maxBytes = Math.max(maxBytes, JSON.stringify(game.snapshot()).length);
    }
    const ok = expectWin ? game.result === 'win' : true;
    if (!ok) failures++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${name.padEnd(34)} result=${String(game.result).padEnd(5)} wave=${String(game.wave).padStart(2)} step=${game.stepIdx} kills=${String(game.totalKills).padStart(4)} maxZ=${maxZ} snap=${(maxBytes / 1024).toFixed(1)}KB simT=${game.time.toFixed(0)}s real=${Date.now() - t0}ms`,
    );
  } catch (err) {
    failures++;
    console.log(`FAIL ${name} threw:`, err.stack);
  }
}

for (const m of MAPS) {
  run(`map${m.id} story god solo`, { mapId: m.id, mode: 'story', players: 1, charOffset: m.id }, 1800, true, true);
  run(`map${m.id} story god 4p`, { mapId: m.id, mode: 'story', players: 4, charOffset: m.id }, 1800, true, true);
  run(`map${m.id} story normal 2p lvl5`, { mapId: m.id, mode: 'story', players: 2, charOffset: m.id, level: 5 }, 240, false, false);
  run(`map${m.id} endless god 3p`, { mapId: m.id, mode: 'endless', players: 3, charOffset: m.id }, 900, true, false);
}
// Solo "Second Wind": first down self-revives after 3s, second down ends the game.
{
  const g = new Game({ mapId: 1, mode: 'story', seed: 9, players: [{ id: 0, char: 'doc', level: 1 }] });
  const p = g.players[0];
  g.hurtPlayer(p, 999);
  const downed = p.state === 'down' && !g.result;
  for (let i = 0; i < 60 * 3.5; i++) g.update(DT);
  const back = p.state === 'alive' && !g.result;
  p.invuln = 0;
  g.hurtPlayer(p, 999);
  g.update(DT);
  const ok = downed && back && g.result === 'lose';
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} solo second wind (downed=${downed} back=${back} result=${g.result})`);
}
// Loot containers: every map has plenty, they're reachable (doors opened), searching drops loot.
for (const m of MAPS) {
  const g = new Game({ mapId: m.id, mode: 'story', seed: 3, players: [{ id: 0, char: 'brick', level: 1 }] });
  for (const d of g.world.doors) if (d.cost < 99999) g.openDoor(d.id);
  const sp = g.world.spots.playerSpawn[0];
  g.field.compute([sp], g.sgrid);
  const unreachable = g.containers.filter((c) => !Number.isFinite(g.field.distAt(c.x, c.z)));
  const p = g.players[0];
  let weapons = 0, rar = [0, 0, 0, 0, 0];
  const opened = new Set();
  for (const c of g.containers) {
    p.x = c.x; p.z = c.z;
    for (let i = 0; i < 400 && !opened.has(c.id); i++) { // a neighbouring container may get searched first
      p.invuln = 99;
      g.setInput(0, { mx: 0, mz: 0, ax: c.x + 1, az: c.z, use: true, acts: {} });
      g.update(DT);
      for (const e of g.drainEvents()) if (e.k === 'loot') opened.add(e.c);
    }
  }
  for (const k of g.pickups) if (k.kind === 'weapon') { weapons++; rar[k.rarity]++; }
  const searched = opened.size;
  const ok = g.containers.length >= 15 && unreachable.length === 0 && searched === g.containers.length && weapons > 3;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} map${m.id} loot: containers=${g.containers.length} searched=${searched} unreachable=${unreachable.map((c) => c.kind + '@' + c.x + ',' + c.z).join(' ') || 0} weapons=${weapons} rarity=${rar.join('/')}`);
}

// XP levels no longer grant picks; picking from a (machine) choice applies the upgrade
{
  const g = new Game({ mapId: 1, mode: 'story', seed: 4, players: [{ id: 0, char: 'rook', level: 1 }] });
  const p = g.players[0];
  g.gainXp(p, 1000);
  const ranks = p.rank, pending = p.choices.length;
  const hp0 = p.maxHp;
  p.choices.push(['vigor', 'power', 'haste']);
  g.setInput(0, { mx: 0, mz: 0, ax: 0, az: 0, acts: { pick: 1 } });
  g.update(DT);
  const ok = ranks > 3 && pending === 0 && p.boons.vigor === 1 && p.maxHp === hp0 + 20 && p.choices.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} xp/level-up (rank=${ranks} pending=${pending} maxHp ${hp0}->${p.maxHp})`);
}
console.log(failures ? `${failures} FAILURES` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
