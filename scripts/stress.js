// Live co-op stress test: starts four copies of the game (a host and three guests joining by IP)
// and prints each one's report. Exits non-zero if any copy failed.
const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const roles = ['host', 'guest1', 'guest2', 'guest3'];
const reports = {};
const runs = roles.map((role, i) =>
  new Promise((resolve) => {
    setTimeout(() => {
      const child = spawn(electron, ['.', '--stress=' + role], { env, cwd: path.join(__dirname, '..') });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
        const m = out.match(/SMOKE REPORT (\{.*\})/);
        if (m && !reports[role]) reports[role] = JSON.parse(m[1]);
      });
      child.stderr.on('data', () => {});
      child.on('exit', () => resolve());
    }, i * 1500);
  }),
);
Promise.all(runs).then(() => {
  let ok = true;
  for (const role of roles) {
    const r = reports[role];
    if (!r) {
      ok = false;
      console.log(role.padEnd(7), 'NO REPORT');
      continue;
    }
    if (!r.ok) ok = false;
    const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(role.padEnd(7), r.ok ? 'OK  ' : 'FAIL', JSON.stringify({ ...r, checks: undefined, failed: failed.length ? failed : undefined, passed: Object.keys(r.checks).length - failed.length }));
  }
  console.log(ok ? 'LIVE STRESS PASSED' : 'LIVE STRESS FAILED');
  process.exit(ok ? 0 : 1);
});
