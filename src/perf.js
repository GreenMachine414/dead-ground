// Frame-rate benchmark, only runs when Electron is launched with --perf (npm run perf).
// Plays the heaviest maps with a large horde and a minigun and reports frame times.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = [
  { map: 1, name: 'Harvest Farm (forest)', zoom: 1 },
  { map: 1, name: 'Harvest Farm zoomed out', zoom: 0.65 },
  { map: 4, name: 'Whiteout Station (forest)', zoom: 1 },
  { map: 2, name: 'Dead End Downtown', zoom: 1 },
];

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0;
}

export async function runPerf(app, opts = {}) {
  app.smoke = true;
  const report = { ok: true, scenes: [] };
  const seconds = opts.seconds || 8;
  try {
    app.profile.unlocked = 5;
    for (const sc of SCENES) {
      app.openLobby('solo');
      app.lobby.unlocked = 5;
      app.lobby.mapId = sc.map;
      app.lobby.mode = 'endless';
      const l0 = performance.now();
      app.lobbyStart(); // builds the world, paints the ground, starts the session
      const loadMs = Math.round(performance.now() - l0);
      await wait(300);
      app.closeIntro();
      const s = app.session;
      const g = s.game;
      const r = s.renderer;
      if (opts.vector) r.drawSolidCached = r.drawSolid; // compare against uncached prop drawing
      r.adaptQuality = () => {}; // measure at full quality
      r.zoom = sc.zoom;
      g.wave = 10;
      g.waveT = 1e9; // we spawn the horde ourselves
      const p = g.players[0];
      p.weapons[0] = g.makeWeapon('minigun', false, 3);
      const t0 = performance.now();
      s.input.sample = () => {
        p.hp = p.maxHp;
        p.invuln = 99;
        if (p.choices.length) g.pickBoon(p, 0);
        const w = g.curWeapon(p);
        w.reserve = 999;
        const t = (performance.now() - t0) / 1000;
        let best = null, bd = Infinity;
        for (const z of g.zombies) {
          const d = Math.hypot(z.x - p.x, z.z - p.z);
          if (d < bd) [best, bd] = [z, d];
        }
        return {
          mx: Math.cos(t * 0.5), mz: Math.sin(t * 0.5), ax: best ? best.x : p.x + 3, az: best ? best.z : p.z,
          fire: !!best && bd < 18, sprint: false, use: false, acts: {},
        };
      };
      const keepHorde = setInterval(() => {
        while (g.zombies.length < 45) if (!g.spawnRegular()) break;
      }, 250);
      const deltas = [], work = [];
      let last = 0, measuring = false;
      const orig = s.frame.bind(s);
      s.frame = (now) => {
        if (measuring && last) deltas.push(now - last);
        last = now;
        const a = performance.now();
        orig(now);
        if (measuring) work.push(performance.now() - a);
      };
      await wait(1500);
      measuring = true;
      await wait(seconds * 1000);
      measuring = false;
      clearInterval(keepHorde);
      const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
      report.scenes.push({
        scene: sc.name + (opts.vector ? ' [uncached]' : ''),
        loadMs,
        avgFps: Math.round(1000 / avg),
        low1Fps: Math.round(1000 / pct(deltas, 0.99)),
        p90Ms: +pct(deltas, 0.9).toFixed(1),
        over25: +((deltas.filter((d) => d > 25).length / Math.max(1, deltas.length)) * 100).toFixed(1) + '%',
        worstFrameMs: Math.round(Math.max(...deltas)),
        avgCpuMs: +(work.reduce((a, b) => a + b, 0) / Math.max(1, work.length)).toFixed(1),
        p99CpuMs: +pct(work, 0.99).toFixed(1),
        zombies: g.zombies.length,
        quality: r.quality,
        canvas: `${r.canvas.width}x${r.canvas.height}`,
      });
      app.endSession();
      await wait(300);
    }
  } catch (err) {
    report.ok = false;
    report.error = String((err && err.stack) || err);
  }
  window.native.smokeDone(report);
}
