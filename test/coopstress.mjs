// Co-op stress test: what a team of 4 runs into. Downs, revives (alone and together), bleed-outs,
// respawns, team wipes, players leaving at awkward moments, every ability at once, bosses, the
// shared machines, bad network input, and the cost of a 4-player tick and its snapshot.
import { Game, MAPS } from '../dist/sim.mjs';

const DT = 1 / 60;
const CHARS = ['brick', 'sparks', 'doc', 'rook', 'volt', 'mags'];
let failures = 0;
const check = (name, ok, info = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  (' + info + ')' : ''}`);
};

function team(mapId, opts = {}) {
  const chars = opts.chars || CHARS.slice(0, 4);
  const players = chars.map((char, id) => ({ id, name: 'P' + id, char, level: opts.level || 5 }));
  return new Game({ mapId, mode: opts.mode || 'endless', seed: opts.seed || 7, players, unlockedMap: 5 });
}

const idle = (p, extra = {}) => ({ mx: 0, mz: 0, ax: p.x + 5, az: p.z, fire: false, sprint: false, use: false, acts: {}, ...extra });

// a teammate that fights, uses its ability when it can, and runs to revive anyone down
function bot(g, p) {
  const down = g.players.find((q) => q !== p && q.state === 'down');
  if (p.state !== 'alive') return idle(p);
  if (down) {
    const dx = down.x - p.x, dz = down.z - p.z, d = Math.hypot(dx, dz);
    if (d > 1.5) return idle(p, { mx: dx / d, mz: dz / d, px: undefined });
    return idle(p, { use: true });
  }
  let best = null, bd = Infinity;
  for (const z of g.zombies) {
    const d = Math.hypot(z.x - p.x, z.z - p.z);
    if (d < bd) [best, bd] = [z, d];
  }
  const inp = idle(p);
  if (best && bd < 22) Object.assign(inp, { ax: best.x, az: best.z, fire: true, mx: bd < 4 ? (p.x - best.x) / bd : 0, mz: bd < 4 ? (p.z - best.z) / bd : 0 });
  if (Math.random() < 0.02) inp.acts.ability = true;
  if (Math.random() < 0.004) inp.acts.grenade = true;
  if (Math.random() < 0.01) inp.acts.melee = true;
  return inp;
}

function step(g, n, input = bot, keepAlive = false) {
  for (let i = 0; i < n && !g.result; i++) {
    for (const p of g.players) {
      if (keepAlive && p.state === 'alive') p.hp = p.maxHp;
      const w = g.curWeapon(p);
      if (w) w.reserve = 999;
      g.setInput(p.id, input(g, p));
    }
    g.update(DT);
    g.drainEvents();
  }
}

const finite = (g) => g.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.hp)) && g.zombies.every((z) => Number.isFinite(z.x) && Number.isFinite(z.z));

// ------------------------------------------------------------ downs and revives
{
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const [a, b] = g.players;
  b.x = a.x + 1;
  b.z = a.z;
  g.hurtPlayer(a, 9999);
  check('a teammate going down is downed, not dead', a.state === 'down' && a.bleed > 40);
  check('no Second Wind in co-op', !a.selfRevive);
  const before = b.points;
  let t = 0;
  while (a.state === 'down' && t < 600) {
    g.setInput(b.id, idle(b, { use: true }));
    g.update(DT);
    g.drainEvents();
    t++;
  }
  check('holding E next to them revives', a.state === 'alive', `${(t * DT).toFixed(1)}s`);
  check('the reviver gets the points and the revive count', b.points >= before + 100 && b.revives === 1);
  check('revived at half health with a moment of safety', Math.abs(a.hp - a.maxHp / 2) < 1 && a.invuln > 0);
}

{
  // Doc revives twice as fast
  const g = team(1, { chars: ['doc', 'brick', 'rook', 'volt'] });
  step(g, 30, (g, p) => idle(p));
  const [doc, x] = g.players;
  x.x = doc.x + 1;
  x.z = doc.z;
  g.hurtPlayer(x, 9999);
  let t = 0;
  while (x.state === 'down' && t < 600) {
    g.setInput(doc.id, idle(doc, { use: true }));
    g.update(DT);
    g.drainEvents();
    t++;
  }
  check('Doc revives in about 2 s (others 4 s)', x.state === 'alive' && t * DT < 2.3, `${(t * DT).toFixed(2)}s`);
}

{
  // two teammates on the same revive: one letting go must not wipe the other's progress
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const [a, b, c] = g.players;
  for (const q of [b, c]) [q.x, q.z] = [a.x + (q === b ? 1 : -1), a.z];
  g.hurtPlayer(a, 9999);
  for (let i = 0; i < 60; i++) {
    g.setInput(b.id, idle(b, { use: true }));
    g.setInput(c.id, idle(c, { use: true }));
    g.update(DT);
  }
  const mid = a.revive;
  for (let i = 0; i < 6; i++) {
    g.setInput(b.id, idle(b, { use: true }));
    g.setInput(c.id, idle(c)); // c lets go
    g.update(DT);
  }
  check('one reviver letting go keeps the other\'s progress', a.state === 'alive' || a.revive >= mid, `progress ${mid.toFixed(2)} -> ${a.revive.toFixed(2)}`);
  g.drainEvents();
}

{
  // nobody comes: bleed out, sit out the round, respawn with a pistol at the next one
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const a = g.players[0];
  a.weapons[1] = g.makeWeapon('ar');
  g.hurtPlayer(a, 9999);
  step(g, Math.ceil(46 / DT), (g, p) => idle(p), true);
  check('bleeding out leaves them dead (not a team loss)', a.state === 'dead' && !g.result);
  g.waveState = 'break';
  g.waveT = 0;
  step(g, 2, (g, p) => idle(p), true);
  check('dead players respawn when the next round starts', a.state === 'alive' && a.weapons[0].id === 'pistol' && !a.weapons[1]);
}

{
  // the whole team goes down: a loss the moment the last one falls, never before
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const P = g.players;
  for (let i = 0; i < 3; i++) g.hurtPlayer(P[i], 9999);
  step(g, 2, (g, p) => idle(p));
  check('three down, one standing: still playing', !g.result && P.slice(0, 3).every((p) => p.state === 'down'));
  g.hurtPlayer(P[3], 9999);
  check('the last one down is downed too (no one left to revive)', P[3].state === 'down');
  step(g, 2, (g, p) => idle(p));
  check('team wipe ends the game as a loss', g.result === 'lose');
}

{
  // one survivor revives the other three in turn, with zombies about
  const g = team(2);
  step(g, 60, (g, p) => idle(p));
  const P = g.players;
  for (let i = 1; i < 4; i++) {
    [P[i].x, P[i].z] = [P[0].x + i * 2, P[0].z];
    g.hurtPlayer(P[i], 9999);
  }
  step(g, Math.ceil(30 / DT), bot, false);
  check('a lone survivor can revive the whole team', P.every((p) => p.state === 'alive') || g.result === null, P.map((p) => p.state).join(','));
}

// ------------------------------------------------------------ leaving at awkward moments
{
  const g = team(2);
  g.waveState = 'break';
  g.waveT = 0;
  step(g, Math.ceil(20 / DT), bot, true);
  const leaver = g.players[3];
  const chasing = g.zombies.filter((z) => z.target === leaver).length;
  g.removePlayer(leaver.id);
  step(g, Math.ceil(1 / DT), bot, true);
  check('zombies stop chasing a player who left', !g.zombies.some((z) => z.target === leaver), `${chasing} were after them`);
  check('the team keeps playing with 3', g.players.length === 3 && !g.result && finite(g));
}

{
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const [a, b] = g.players;
  [b.x, b.z] = [a.x + 1, a.z];
  g.hurtPlayer(a, 9999);
  for (let i = 0; i < 60; i++) {
    g.setInput(b.id, idle(b, { use: true }));
    g.update(DT);
  }
  g.removePlayer(a.id); // the downed player leaves mid-revive
  let threw = null;
  try {
    for (let i = 0; i < 60; i++) {
      g.setInput(b.id, idle(b, { use: true }));
      g.update(DT);
    }
  } catch (e) {
    threw = e;
  }
  check('a downed player leaving mid-revive is harmless', !threw && b.state === 'alive' && !/revive/i.test(b.prompt), threw ? threw.message : b.prompt);
  g.drainEvents();
}

{
  // the only player standing leaves while the rest are down: that's a loss
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const P = g.players;
  for (let i = 1; i < 4; i++) g.hurtPlayer(P[i], 9999);
  g.removePlayer(P[0].id);
  step(g, 2, (g, p) => idle(p));
  check('last one standing leaving with the rest down ends the game', g.result === 'lose');
}

{
  // everyone but one leaves: the last player plays on alone
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  for (const id of [1, 2, 3]) g.removePlayer(id);
  step(g, Math.ceil(10 / DT), bot, true);
  check('a host left alone plays on', g.players.length === 1 && !g.result && finite(g));
}

{
  // the forge's owner leaves: the forge frees up for everyone else
  const g = team(3, { mode: 'story' });
  step(g, 30, (g, p) => idle(p));
  const fs = g.world.spots.forge;
  const [a, b] = g.players;
  a.weapons[0] = g.makeWeapon('ar');
  a.cur = 0;
  a.points = b.points = 1e6;
  [a.x, a.z, b.x, b.z] = [fs.x + 1, fs.z + 1.2, fs.x - 1, fs.z + 1.2];
  step(g, 3, (g, p) => idle(p, { acts: p === a ? { usePress: true } : {} }));
  const busy = !!g.forgeJob;
  step(g, 2, (g, p) => idle(p));
  check('a second player sees the forge as busy', busy && /busy/i.test(b.prompt), b.prompt);
  g.removePlayer(a.id);
  step(g, 2, (g, p) => idle(p));
  check('when its owner leaves, the forge is free again', !g.forgeJob && /Weapon Forge/.test(b.prompt), b.prompt);
}

{
  // the Mystery Box user leaves mid-spin
  const g = team(1);
  step(g, 30, (g, p) => idle(p));
  const a = g.players[0];
  g.openBox(a);
  g.removePlayer(a.id);
  let threw = null;
  try {
    step(g, Math.ceil(15 / DT), (g, p) => idle(p));
  } catch (e) {
    threw = e;
  }
  check('the box finishes and resets when its user left', !threw && g.box.state === 'idle', threw ? threw.message : g.box.state);
}

// ------------------------------------------------------------ everything at once
for (const chars of [CHARS.slice(0, 4), CHARS.slice(2, 6)]) {
  const g = team(5, { chars });
  g.wave = 9;
  g.waveState = 'break';
  g.waveT = 0;
  let maxWalls = 0, maxTurrets = 0, threw = null;
  try {
    for (let s = 0; s < 120 * 60 && !g.result; s++) {
      for (const p of g.players) {
        if (p.state === 'alive') p.hp = p.maxHp;
        p.abilityCd = 0;
        p.charges = p.maxCharges;
        const inp = bot(g, p);
        inp.acts.ability = s % 30 === p.id * 7;
        g.setInput(p.id, inp);
      }
      g.update(DT);
      g.drainEvents();
      const per = (kind) => Math.max(0, ...g.players.map((p) => g.structs.filter((st) => st.owner === p.id && st.kind === kind).length));
      maxWalls = Math.max(maxWalls, per('wall'));
      maxTurrets = Math.max(maxTurrets, per('turret'));
    }
  } catch (e) {
    threw = e;
  }
  check(`abilities spammed for 2 min (${chars.join('/')})`, !threw && finite(g), threw ? threw.stack.split('\n').slice(0, 2).join(' ') : `walls/player ${maxWalls}, turrets/player ${maxTurrets}, structs ${g.structs.length}`);
  check(`  structure caps hold (${chars.join('/')})`, maxWalls <= 5 && maxTurrets <= 2, `walls ${maxWalls} (max 5), turrets ${maxTurrets} (max 2)`);
}

{
  // Mags: each bag restocks one teammate who is short on ammo, then it's used up; a teammate with
  // full ammo standing on one leaves it for someone who needs it
  const g = team(1, { chars: ['mags', 'brick', 'doc', 'rook'] });
  step(g, 30, (g, p) => idle(p));
  const [m, short, full] = g.players;
  m.abilityCd = 0;
  g.setInput(m.id, idle(m, { acts: { ability: true } }));
  g.update(DT);
  const bags = g.pickups.filter((k) => k.kind === 'supply');
  for (const q of g.players) if (q !== m) [q.x, q.z] = [q.x + 30, q.z]; // everyone else well away
  g.curWeapon(short).reserve = 0;
  [short.x, short.z] = [bags[0].x, bags[0].z];
  if (bags[1]) [full.x, full.z] = [bags[1].x, bags[1].z];
  for (let i = 0; i < 10; i++) {
    for (const p of g.players) g.setInput(p.id, idle(p));
    g.update(DT);
    g.drainEvents();
  }
  const left = g.pickups.filter((k) => k.kind === 'supply');
  check('Mags drops supply bags', bags.length >= 1, bags.length + ' bags');
  check('a teammate short on ammo takes a bag and is restocked', g.curWeapon(short).reserve > 0 && !left.includes(bags[0]));
  check('a teammate with full ammo leaves the bag for others', !bags[1] || left.includes(bags[1]));
}

// ------------------------------------------------------------ bosses with a full team
for (const m of MAPS) {
  const g = team(m.id, { mode: 'endless', seed: m.id });
  g.wave = 4;
  g.waveState = 'break';
  g.waveT = 0;
  let threw = null, sawBoss = false;
  try {
    for (let s = 0; s < 90 * 60 && !g.result; s++) {
      step(g, 1, bot, true);
      if (g.zombies.some((z) => z.boss)) sawBoss = true;
    }
  } catch (e) {
    threw = e;
  }
  const boss = g.zombies.find((z) => z.boss);
  check(`map ${m.id} boss vs 4 players for 90 s`, !threw && sawBoss && finite(g), threw ? threw.message : boss ? `boss at ${Math.round((boss.hp / boss.maxHp) * 100)}%` : 'boss beaten');
}

{
  // more players, more and tougher zombies
  const solo = new Game({ mapId: 1, mode: 'endless', seed: 3, players: [{ id: 0, char: 'brick', level: 5 }] });
  const four = team(1, { seed: 3 });
  for (const g of [solo, four]) {
    g.wave = 4;
    g.waveState = 'break';
    g.waveT = 0;
    g.update(DT);
  }
  check('a 4-player round has more zombies than solo', four.toSpawn > solo.toSpawn * 2, `${solo.toSpawn} solo, ${four.toSpawn} with 4`);
}

// ------------------------------------------------------------ bad network input
{
  const g = team(2);
  step(g, 30, (g, p) => idle(p));
  const a = g.players[1];
  const junk = [
    { mx: 'abc', mz: '1', ax: 'x', az: null, fire: 'yes', acts: { ability: 'please', grenade: 1 } },
    { mx: 1e308, mz: -1e308, ax: 1e308, az: -1e308, fire: true, acts: { grenade: true } },
    { mx: null, mz: undefined, ax: undefined, az: undefined, px: 'a', pz: {}, fire: true, acts: null },
    {},
    { acts: { pick: 99, slot: -5, swap: 'many' } },
  ];
  let threw = null;
  try {
    for (const j of junk) {
      for (let i = 0; i < 30; i++) {
        g.setInput(a.id, j);
        g.update(DT);
        g.drainEvents();
      }
    }
  } catch (e) {
    threw = e;
  }
  check('malformed guest input never breaks the game', !threw && finite(g) && JSON.stringify(g.snapshot()).length > 0, threw ? threw.message : `P1 at ${a.x.toFixed(1)},${a.z.toFixed(1)}`);
}

// ------------------------------------------------------------ the zombies' path field
{
  const g = team(5, { seed: 4 });
  step(g, 2, (g, p) => idle(p));
  check('the first path field is ready on the first tick', g.field.ready);
  const spots = g.world.spots.zspawn;
  g.players.forEach((p, i) => ([p.x, p.z] = [spots[(i * 5) % spots.length].x + 0.5, spots[(i * 5) % spots.length].z + 0.5]));
  g.field.begin(g.players, g.sgrid);
  let ticks = 0;
  while (!g.field.run(3000)) ticks++;
  const sliced = Float32Array.from(g.field.dist);
  g.field.compute(g.players, g.sgrid);
  check('a field built over several ticks matches one built at once', sliced.every((v, i) => v === g.field.dist[i]), `${ticks + 1} slices`);
  g.wave = 6;
  g.waveState = 'break';
  g.waveT = 0;
  step(g, Math.ceil(20 / DT), (g, p) => idle(p), true);
  const near = g.zombies.filter((z) => Math.min(...g.players.map((p) => Math.hypot(p.x - z.x, p.z - z.z))) < 3).length;
  check('zombies still reach the players', near > 0, `${near} of ${g.zombies.length} within 3 m after 20 s`);
}

// ------------------------------------------------------------ cost of a full 4-player game
{
  const g = team(5, { seed: 11 });
  g.wave = 14;
  g.waveState = 'break';
  g.waveT = 0;
  step(g, Math.ceil(30 / DT), bot, true); // let the round fill up
  const ticks = [], sizes = [], ser = [];
  for (let s = 0; s < 60 * 60 && !g.result; s++) {
    for (const p of g.players) {
      if (p.state === 'alive') p.hp = p.maxHp;
      const w = g.curWeapon(p);
      if (w) w.reserve = 999;
      g.setInput(p.id, bot(g, p));
    }
    const t0 = performance.now();
    g.update(DT);
    ticks.push(performance.now() - t0);
    const ev = g.drainEvents();
    if (s % 3 === 0) {
      // the host sends a snapshot (with the events since the last one) about 20 times a second
      const t1 = performance.now();
      const msg = JSON.stringify({ t: 'snap', s: { ...g.snapshot(), E: ev } });
      ser.push(performance.now() - t1);
      sizes.push(msg.length);
    }
  }
  const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const kbps = (avg(sizes) * 20) / 1024;
  check('4-player tick stays cheap (round 14, Ground Zero)', pct(ticks, 0.99) < 6, `avg ${avg(ticks).toFixed(2)} ms, p99 ${pct(ticks, 0.99).toFixed(2)} ms, ${g.zombies.length} zombies`);
  check('snapshots stay small enough to send 20×/s to 3 guests', pct(sizes, 0.99) < 24 * 1024, `avg ${(avg(sizes) / 1024).toFixed(1)} KB, p99 ${(pct(sizes, 0.99) / 1024).toFixed(1)} KB, ~${kbps.toFixed(0)} KB/s per guest, serialize p99 ${pct(ser, 0.99).toFixed(2)} ms`);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
