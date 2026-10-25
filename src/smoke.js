// Automated smoke test, only runs when Electron is launched with --smoke.
// Plays every map briefly with a bot, takes screenshots, and exercises networking.
import { Game } from './game/sim.js';
import { MAPS } from './data/maps.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function botInput(game, pid, t) {
  const p = game.players.find((q) => q.id === pid);
  let best = null, bd = Infinity;
  for (const z of game.zombies) {
    const d = Math.hypot(z.x - p.x, z.z - p.z);
    if (d < bd) {
      bd = d;
      best = z;
    }
  }
  const acts = {};
  if (Math.random() < 0.004) acts.ability = true;
  if (Math.random() < 0.003) acts.grenade = true;
  return {
    mx: Math.cos(t * 0.7) * 0.6, mz: Math.sin(t * 0.7) * 0.6,
    ax: best ? best.x : p.x + 3, az: best ? best.z : p.z, fire: !!best && bd < 22, sprint: false, use: false, acts,
  };
}

export async function runSmoke(app) {
  app.smoke = true;
  const report = { ok: true, errors: [], fps: {}, checks: {} };
  const origErr = console.error;
  console.error = (...a) => {
    report.errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
    origErr(...a);
  };
  app.reportError = (e) => report.errors.push(String((e && (e.stack || e.message)) || e));
  const shot = (n) => window.native.smokeShot(n);
  const check = (name, cond) => {
    report.checks[name] = !!cond;
    if (!cond) report.ok = false;
  };
  try {
    app.profile.unlocked = 5;
    await wait(600);
    await shot('00-main');
    app.go('solo');
    await wait(300);
    await shot('01-lobby');
    app.show('chars');
    await wait(200);
    await shot('02-upgrades');

    const chars = ['brick', 'sparks', 'doc', 'rook', 'volt'];
    for (const m of MAPS) {
      app.openLobby('solo');
      app.lobby.unlocked = 5;
      app.lobby.mapId = m.id;
      app.lobby.players[0].char = chars[m.id - 1];
      app.lobby.players[0].level = 3;
      app.lobbyStart();
      await wait(400);
      if (m.id === 1) await shot('03-intro');
      app.closeIntro();
      const s = app.session;
      const g = s.game;
      g.waveT = 0.3;
      const p = g.players[0];
      p.weapons[1] = g.makeWeapon(m.newWeapons[0], false, m.id - 1);
      p.cur = 1;
      p.points = 20000;
      let frames = 0;
      let autoPick = true;
      const t0 = performance.now();
      s.input.sample = () => {
        frames++;
        p.hp = p.maxHp;
        if (autoPick && p.choices.length) g.pickBoon(p, 0);
        return botInput(g, 0, (performance.now() - t0) / 1000);
      };
      await wait(7000);
      report.fps[m.id] = Math.round((frames / (performance.now() - t0)) * 1000);
      await shot(`map${m.id}`);
      check(`map${m.id}-zombies-spawned`, g.totalKills + g.zombies.length > 0);
      if (m.id === 1) {
        // level-up cards
        autoPick = false;
        g.gainXp(p, 400);
        await wait(500);
        await shot('map1-levelup');
        check('levelup-pauses-solo', p.choices.length > 0);
        autoPick = true;
        await wait(300);
        // walk up to a container and search it
        const cont = g.containers.find((c) => c.kind === 'rack') || g.containers[0];
        p.x = cont.x;
        p.z = cont.z + 0.3;
        s.input.sample = () => ({ mx: 0, mz: 0, ax: cont.x, az: cont.z - 2, fire: false, sprint: false, use: true, acts: {} });
        await wait(700);
        await shot('map1-search');
        await wait(1200);
        for (const [wid, r, dx] of [['smg', 4, 1.6], ['shotgun', 3, -1.6], ['revolver', 2, 0]]) {
          g.pickups.push({ id: g.nextId++, kind: 'weapon', wid, rarity: r, x: p.x + dx, z: p.z + 1.8, t: 100 });
        }
        await wait(600);
        await shot('map1-loot');
        check('container-searched', !cont.full);
        s.input.sample = () => botInput(g, 0, performance.now() / 1000);
        // spawn the boss right next to us for a screenshot, then force a win to see the end screen
        const b = g.spawnZombie('harvester', p.x + 6, p.z - 4, false);
        await wait(1500);
        await shot('map1-boss');
        g.result = 'win';
        g.emit({ k: 'end', r: 'win' });
        await wait(3600);
        await shot('04-end');
        check('end-screen', app.screen === 'end');
        check('unlock-saved', app.profile.completed.includes(1));
        void b;
      } else {
        app.endSession();
      }
    }

    // ---------------- host networking over a real socket
    app.profile.settings.port = 27016;
    await app.hostLobby();
    check('host-started', app.lobby && app.lobby.kind === 'host');
    const msgs = [];
    const ws = new WebSocket('ws://127.0.0.1:27016');
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ t: 'hello', role: 'client', d: { name: 'NetBot', char: 'doc', level: 2 } }));
    await wait(400);
    check('client-welcomed', msgs.some((m) => m.t === 'welcome'));
    check('lobby-broadcast', msgs.some((m) => m.t === 'h' && m.d.t === 'lobby' && m.d.players.length === 2));
    ws.send(JSON.stringify({ d: { t: 'char', char: 'volt', level: 3 } }));
    await wait(300);
    check('char-change', app.lobby.players[1] && app.lobby.players[1].char === 'volt');
    await shot('05-host-lobby');
    app.lobby.mapId = 2;
    app.lobbyStart();
    app.closeIntro();
    await wait(600);
    const g = app.session.game;
    const remote = g.players.find((q) => q.id === 1);
    check('remote-player-in-game', !!remote);
    const startX = remote.x, startZ = remote.z;
    let k = 0;
    const iv = setInterval(() => {
      k++;
      ws.send(JSON.stringify({ d: { t: 'in', mx: 1, mz: 0, ax: startX + 10, az: startZ, fire: true, sprint: false, use: false, acts: k === 5 ? { ability: true } : {}, px: startX + Math.min(4, k * 0.1), pz: startZ, moving: true, stamina: 1 } }));
    }, 33);
    g.waveT = 0.2;
    app.session.input.sample = () => botInput(g, 0, performance.now() / 1000);
    await wait(4000);
    clearInterval(iv);
    const snaps = msgs.filter((m) => m.t === 'h' && m.d.t === 'snap');
    check('snapshots-received', snaps.length > 40);
    check('remote-moved', Math.abs(remote.x - (startX + 4)) < 0.2);
    check('snapshot-has-2-players', snaps.length && snaps[snaps.length - 1].d.s.P.length === 2);
    report.checks.snapBytes = snaps.length ? JSON.stringify(snaps[snaps.length - 1]).length : 0;
    await shot('06-host-game');
    app.quitToMenu();
    await wait(300);
    check('client-told-to-lobby', msgs.some((m) => m.t === 'h' && m.d.t === 'toLobby'));
    ws.close();
    await wait(200);
    check('leave-handled', app.lobby.players.length === 1);
    app.leaveLobby();

    // ---------------- client session against an in-page fake host
    const players = [
      { id: 0, name: 'HostBot', char: 'sparks', level: 3 },
      { id: 7, name: 'Me', char: 'rook', level: 2 },
    ];
    const hostGame = new Game({ mapId: 4, mode: 'story', seed: 77, players });
    hostGame.waveT = 0.2;
    const fakeNet = { toHost: (d) => hostGame.setInput(7, d), toClients() {}, close() {} };
    app.startSession({ role: 'client', net: fakeNet, localId: 7, mapId: 4, mode: 'story', players });
    app.closeIntro();
    const cs = app.session;
    let t = 0;
    const tick = setInterval(() => {
      for (let i = 0; i < 3; i++) {
        for (const hp of hostGame.players) hp.hp = hp.maxHp;
        hostGame.setInput(0, botInput(hostGame, 0, t));
        hostGame.update(1 / 60);
        t += 1 / 60;
      }
      const s = hostGame.snapshot();
      s.E = hostGame.drainEvents();
      cs.onNet({ t: 'h', d: { t: 'snap', s } });
    }, 50);
    const me0 = hostGame.players[1];
    const sx = me0.x;
    cs.input.sample = (aim) => ({ mx: -1, mz: 0, ax: aim ? aim.x : 0, az: aim ? aim.z : 0, fire: true, sprint: false, use: false, acts: {} });
    await wait(5000);
    clearInterval(tick);
    await shot('07-client-view');
    check('client-predicted-move', cs.pred && Math.abs(cs.pred.x - sx) > 2);
    check('host-sees-client-move', Math.abs(me0.x - sx) > 2);
    app.endSession();
    app.show('main');
  } catch (e) {
    report.ok = false;
    report.errors.push('SMOKE EXCEPTION: ' + (e.stack || e));
  }
  if (report.errors.length) report.ok = false;
  window.native.smokeDone(report);
}
