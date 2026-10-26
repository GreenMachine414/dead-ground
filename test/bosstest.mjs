// Spawns each boss next to a pair of invulnerable players and checks that it uses
// its signature abilities without throwing.
import { Game } from '../dist/sim.mjs';

const DT = 1 / 60;
const BOSSES = [
  [1, 'harvester', ['sweep', 'hook']],
  [2, 'abomination', ['bile', 'devour']],
  [1, 'general', ['barrage', 'rally', 'volley']],
  [4, 'hivequeen', ['eggs']],
  [5, 'patientzero', ['mirror', 'drain']],
];
let failures = 0;

for (const [mapId, type, signature] of BOSSES) {
  const players = [{ id: 0, name: 'A', char: 'brick', level: 3 }, { id: 1, name: 'B', char: 'doc', level: 3 }];
  const game = new Game({ mapId, mode: 'endless', seed: 99, players, unlockedMap: 5 });
  game.waveState = 'break';
  game.waveT = 1e9; // no regular waves; we control the spawns
  const sp = game.world.spots.playerSpawn[0];
  const boss = game.spawnZombie(type, sp.x + 9, sp.z, false);
  const used = {};
  let hatched = 0, yanks = 0;
  try {
    for (let i = 0; i < 90 / DT && !boss.dead; i++) {
      // keep a few minions around so devour / rally have targets
      if (i % 240 === 0) for (let k = 0; k < 4; k++) game.spawnZombie('walker', boss.x + Math.cos(k) * 3, boss.z + Math.sin(k) * 3, false);
      for (const p of game.players) {
        p.invuln = 99;
        p.hp = p.maxHp;
        // shuffle around near the boss at varying ranges
        const want = 3 + 10 * (0.5 + 0.5 * Math.sin(i / 200 + p.id));
        const dx = p.x - boss.x, dz = p.z - boss.z, d = Math.hypot(dx, dz) || 1;
        game.setInput(p.id, { mx: ((want - d) * dx) / d, mz: ((want - d) * dz) / d, ax: boss.x, az: boss.z, fire: false, sprint: false, use: false, acts: {} });
      }
      if (i === 1800) boss.hp = boss.maxHp * 0.4; // let the enrage / heal paths run
      game.update(DT);
      for (const e of game.drainEvents()) {
        if (e.k === 'tele') used[e.a] = (used[e.a] || 0) + 1;
        if (e.k === 'hatch') hatched++;
        if (e.k === 'yank') yanks++;
      }
      JSON.stringify(game.snapshot());
    }
    const missing = signature.filter((a) => !used[a]);
    const ok = missing.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${type.padEnd(12)} used=${JSON.stringify(used)} hatched=${hatched} yanks=${yanks}${missing.length ? ' missing=' + missing : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${type}: ${err.stack}`);
  }
}
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
