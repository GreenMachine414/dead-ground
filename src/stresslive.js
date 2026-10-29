// Live 4-player co-op stress test (npm run stress:live): four copies of the game on one PC, one
// hosting and three joining by IP, each played by a bot. The host walks the team through what a
// real 4-player game runs into and checks each step; every copy reports its frame rate, network
// rate and errors. Electron is launched with --stress=host or --stress=guest1..3.
const PORT = 27031;
const GUEST_CHARS = { guest1: 'doc', guest2: 'sparks', guest3: 'volt' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, step = 100) => {
  for (const end = performance.now() + ms; performance.now() < end; await wait(step)) if (fn()) return true;
  return !!fn();
};

// frame times (ms) while `on` is set
function frameMeter() {
  const m = { times: [], on: false, last: 0 };
  const loop = (t) => {
    if (m.on && m.last) m.times.push(t - m.last);
    m.last = t;
    if (!m.stopped) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  m.start = () => {
    m.on = true;
    m.t0 = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      m.loadMs = Math.round(performance.now() - m.t0);
      m.times.length = 0;
    }));
  };
  m.stats = () => {
    const a = [...m.times].sort((x, y) => x - y);
    if (!a.length) return {};
    const avg = a.reduce((x, y) => x + y, 0) / a.length;
    return { loadMs: m.loadMs, avgFps: Math.round(1000 / avg), p95FrameMs: +a[Math.floor(a.length * 0.95)].toFixed(1), worstFrameMs: +a[a.length - 1].toFixed(1), frames: a.length };
  };
  return m;
}

// a teammate bot: revives anyone down nearby, otherwise fights the nearest zombie
function teamBot(me, P, Z, t) {
  const down = P.find((q) => q.id !== me.id && q.s === 1);
  if (down) {
    const dx = down.x - me.x, dz = down.z - me.z, d = Math.hypot(dx, dz);
    return { mx: d > 1.2 ? dx / d : 0, mz: d > 1.2 ? dz / d : 0, ax: down.x, az: down.z, fire: false, sprint: d > 6, use: d < 1.8, acts: {} };
  }
  let best = null, bd = Infinity;
  for (const z of Z) {
    const d = Math.hypot(z[0] - me.x, z[1] - me.z);
    if (d < bd) [best, bd] = [z, d];
  }
  const acts = {};
  if (Math.random() < 0.004) acts.ability = true;
  if (Math.random() < 0.002) acts.grenade = true;
  return {
    mx: Math.cos(t * 0.6 + me.id) * 0.6, mz: Math.sin(t * 0.6 + me.id) * 0.6,
    ax: best ? best[0] : me.x + 3, az: best ? best[1] : me.z, fire: !!best && bd < 22, sprint: false, use: false, acts,
  };
}

export async function runStress(app, role) {
  app.smoke = true; // never saves the profile or sends bug reports
  const report = { role, ok: true, errors: [], checks: {} };
  const check = (k, v) => {
    report.checks[k] = !!v;
    if (!v) report.ok = false;
  };
  const origErr = console.error;
  console.error = (...a) => {
    report.errors.push(a.map((x) => (x && x.stack) || String(x)).join(' '));
    origErr(...a);
  };
  app.reportError = (e) => report.errors.push(String((e && (e.stack || e.message)) || e));
  const timeout = setTimeout(() => {
    report.ok = false;
    report.errors.push('stress timed out');
    window.native.smokeDone(report);
  }, 240000);
  const meter = frameMeter();
  try {
    if (role === 'host') await host(app, report, check, meter);
    else await guest(app, role, report, check, meter);
  } catch (e) {
    report.ok = false;
    report.errors.push('STRESS EXCEPTION: ' + (e.stack || e));
  }
  meter.stopped = true;
  Object.assign(report, meter.stats());
  if (report.errors.length) report.ok = false;
  clearTimeout(timeout);
  window.native.smokeDone(report);
}

async function host(app, report, check, meter) {
  app.profile.settings.port = PORT;
  // what the host hears from the network, for the report
  report.trace = [];
  const onHostMsg = app.onHostMsg.bind(app);
  app.onHostMsg = (m) => {
    if (m.t === 'join' || m.t === 'leave') report.trace.push(`${m.t} id=${m.id} at ${Math.round(performance.now() / 1000)}s`);
    return onHostMsg(m);
  };
  const state = (label) => report.trace.push(`${label}: screen=${app.screen} session=${!!app.session} players=${app.session ? app.session.game.players.map((q) => q.id).join('/') : '-'} result=${app.session ? app.session.game.result : '-'} at ${Math.round(performance.now() / 1000)}s`);
  await app.hostLobby();
  check('hosting', app.lobby && app.lobby.kind === 'host');
  app.setMode('endless');
  app.selectMap(5); // Ground Zero, the heaviest map
  check('all 3 guests joined', await until(() => app.lobby.players.length === 4, 60000));
  report.joined = app.lobby.players.map((q) => `${q.name}:${q.char}`);
  app.lobbyStart();
  check('start waits while guests are not ready', !app.session);
  check('every guest readied up', await until(() => app.notReady.length === 0, 30000));
  app.lobbyStart();
  check('game started', !!app.session);
  app.closeIntro();
  const s = app.session, g = s.game;
  // round 10 is a boss round: the full team fights Patient Zero and the horde
  g.wave = 9;
  g.waveState = 'break';
  g.waveT = 0;
  s.input.sample = () => {
    const me = g.players.find((q) => q.id === 0);
    if (!me) return { mx: 0, mz: 0, ax: 0, az: 0, fire: false, acts: {} };
    return teamBot({ id: 0, x: me.x, z: me.z }, g.players.map((q) => ({ id: q.id, x: q.x, z: q.z, s: q.state === 'down' ? 1 : 0 })), g.zombies.map((z) => [z.x, z.z]), performance.now() / 1000);
  };
  // nobody goes down by accident (this tests co-op, not the bots' aim), only on purpose
  const downing = new Set();
  const guard = setInterval(() => {
    for (const q of g.players) if (q.state === 'alive' && !downing.has(q.id)) [q.hp, q.invuln] = [q.maxHp, Math.max(q.invuln, 0.3)];
  }, 50);
  meter.start();
  const ticks = [];
  const tick = g.update.bind(g);
  g.update = (dt) => {
    const t = performance.now();
    tick(dt);
    ticks.push(performance.now() - t);
  };
  const sizes = [];
  const send = app.net.toClients.bind(app.net);
  app.net.toClients = (d, ...rest) => {
    if (d.t === 'snap') sizes.push(JSON.stringify(d).length);
    return send(d, ...rest);
  };

  await wait(12000);
  check('4 players in the game', g.players.length === 4);
  check('the boss arrives', await until(() => g.zombies.some((z) => z.boss), 15000));
  // a guest goes down: the bots (guests' own copies) come and revive them
  const g1 = g.players.find((q) => q.name === 'guest1');
  downing.add(g1.id);
  g1.invuln = 0;
  g.hurtPlayer(g1, 9999);
  check('a guest goes down', g1.state === 'down');
  check('teammates revive the downed guest', await until(() => g1.state === 'alive', 25000));
  downing.delete(g1.id);
  report.revivesByTeam = g.players.reduce((a, q) => a + q.revives, 0);
  // the host goes down: a guest revives the host
  const me = g.players.find((q) => q.id === 0);
  downing.add(0);
  me.invuln = 0;
  g.hurtPlayer(me, 9999);
  check('the host goes down', me.state === 'down');
  check('a guest revives the host', await until(() => me.state === 'alive', 25000));
  downing.delete(0);
  // guest3 leaves mid-game (its own copy leaves at this point)
  state('waiting for the leave');
  check('a guest leaving mid-game is dropped', await until(() => g.players.length === 3, 70000));
  state('after waiting');
  await wait(5000);
  check('the game carries on with 3', !g.result && g.players.length === 3);
  meter.on = false;
  clearInterval(guard);
  const pct = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)] || 0;
  report.sim = { avgTickMs: +(ticks.reduce((x, y) => x + y, 0) / ticks.length).toFixed(2), p99TickMs: +pct(ticks, 0.99).toFixed(2), zombies: g.zombies.length, wave: g.wave };
  report.snapshots = { sent: sizes.length, avgKB: +(sizes.reduce((x, y) => x + y, 0) / sizes.length / 1024).toFixed(1), p99KB: +(pct(sizes, 0.99) / 1024).toFixed(1) };
  // End Game for Everyone: back to the lobby, everyone has to ready up again
  state('before End Game');
  app.quitToMenu();
  await wait(2500);
  state('after End Game');
  check('back in the lobby', app.screen === 'lobby' && !app.session);
  check('guests must ready up again', app.lobby.players.length === 3 && app.notReady.length === 2);
  await wait(4000); // let the guests check their side before the host closes
}

async function guest(app, role, report, check, meter) {
  const n = +role.slice(5);
  await wait(1500 + n * 700);
  app.show('join');
  document.getElementById('join-name').value = role;
  document.getElementById('join-addr').value = '127.0.0.1';
  document.getElementById('join-port').value = PORT;
  let joined = false;
  for (let i = 0; i < 30 && !joined; i++) {
    await app.joinGame(true);
    joined = !!(app.lobby && app.lobby.kind === 'client');
    if (!joined) await wait(1000);
  }
  check('joined by IP', joined);
  check('got the lobby', await until(() => app.lobby.players.length >= 2, 10000));
  app.selectChar(GUEST_CHARS[role]);
  await wait(1200);
  check('the host sees the pick', await until(() => (app.lobby.players.find((q) => q.id === app.myId) || {}).char === GUEST_CHARS[role], 5000));
  app.toggleReady();
  check('ready', await until(() => (app.lobby.players.find((q) => q.id === app.myId) || {}).ready, 5000));
  check('the game starts', await until(() => !!app.session, 90000));
  const s = app.session;
  let snaps = 0, gapMax = 0, lastSnap = 0;
  const onNet = s.onNet.bind(s);
  s.onNet = (msg) => {
    if (msg.t === 'h' && msg.d && msg.d.t === 'snap') {
      const now = performance.now();
      if (lastSnap && snaps > 20) gapMax = Math.max(gapMax, now - lastSnap);
      lastSnap = now;
      snaps++;
    }
    return onNet(msg);
  };
  s.input.sample = () => {
    const snap = s.snap, pos = s.pred;
    if (!snap || !pos) return { mx: 0, mz: 0, ax: 0, az: 0, fire: false, acts: {} };
    return teamBot({ id: app.myId, x: pos.x, z: pos.z }, snap.P, snap.Z.map((z) => [z[2], z[3]]), performance.now() / 1000);
  };
  meter.start();
  const t0 = performance.now();
  if (role === 'guest3') {
    // this guest leaves partway through, once the downs and revives are done
    await until(() => performance.now() - t0 > 40000, 45000);
    report.snapsPerSec = +(snaps / ((performance.now() - t0) / 1000)).toFixed(1);
    report.maxSnapGapMs = Math.round(gapMax);
    meter.on = false;
    app.quitToMenu();
    await wait(800);
    check('left cleanly', !app.session && !app.lobby);
    return;
  }
  check('told to go back to the lobby', await until(() => app.screen === 'lobby' && !app.session, 120000));
  report.snapsPerSec = +(snaps / ((performance.now() - t0) / 1000)).toFixed(1);
  report.maxSnapGapMs = Math.round(gapMax);
  meter.on = false;
  await wait(1000);
  const me = app.lobby && app.lobby.players.find((q) => q.id === app.myId);
  check('not ready after the game', me && !me.ready);
  check('the lobby shows 3 survivors', app.lobby && app.lobby.players.length === 3);
  await wait(6000); // stay in the lobby until the host has checked it too
}
