const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const relay = require('./relay');

const isPerf = process.argv.includes('--perf');
const isFinale = process.argv.includes('--finale'); // records the end-of-story cutscene
// crash-report test: --crashtest (sends nothing) or --crashtest=live (really sends two test reports)
const crashArg = process.argv.find((a) => /^--crashtest(=|$)/.test(a));
const crashTest = crashArg ? crashArg.split('=')[1] || 'stub' : null;
const isTrailer = process.argv.includes('--trailer') || isFinale;
// live co-op stress test: --stress=host or --stress=guest1..3 (see src/stresslive.js)
const stressRole = (process.argv.find((a) => a.startsWith('--stress=')) || '').slice(9) || null;
const isSmoke = process.argv.includes('--smoke') || isPerf || isTrailer || !!stressRole || !!crashTest; // perf, the trailer and stress run like a smoke test
const isDev = process.argv.includes('--dev');
// the benchmark measures real frame cost, so it runs without the vsync frame cap
if (isPerf) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}
// test runs and the trailer need real frames even when other windows cover theirs (Windows
// otherwise stops painting an occluded window)
if (isSmoke) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
let win;

// A crash is written down here and reported by the game once it has restarted
function crashPath() {
  return path.join(app.getPath('userData'), 'pending-crash.json');
}
function saveCrash(info) {
  try {
    fs.writeFileSync(crashPath(), JSON.stringify({ ...info, at: Date.now() }));
  } catch {}
}
let lastRestart = 0;
// errors in this (main) process: written down for the report instead of a native error box
process.on('uncaughtException', (e) => {
  console.error(e);
  saveCrash({ kind: 'A background error happened', reason: String(e && e.message), detail: String(e && e.stack) });
});

function profilePath() {
  return path.join(app.getPath('userData'), 'profile.json');
}

// Fullscreen is the default: start windowed only if the player turned it off (in a save from
// since it became the default, settings version 2 - see App.init)
function savedFullscreen() {
  try {
    const s = JSON.parse(fs.readFileSync(profilePath(), 'utf8')).settings || {};
    return s.gfxV !== 2 || s.fullscreen !== false;
  } catch {
    return true;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: isTrailer ? 1920 : stressRole ? 1024 : 1600,
    height: isTrailer ? 1080 : stressRole ? 600 : 900,
    // the four stress-test copies tile the screen
    ...(stressRole ? { x: (['host', 'guest1', 'guest2', 'guest3'].indexOf(stressRole) % 2) * 900, y: Math.floor(['host', 'guest1', 'guest2', 'guest3'].indexOf(stressRole) / 2) * 460 } : {}),
    // the trailer is recorded at exactly 1080p; no frame, so the page fits a 1080p screen
    useContentSize: isTrailer,
    frame: !isTrailer,
    fullscreen: !isSmoke && savedFullscreen(),
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0b0c0e',
    title: 'Dead Ground',
    autoHideMenuBar: true,
    show: !isSmoke,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  // the page crashed: note it and bring the game back (unless it keeps crashing straight away)
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    saveCrash({ kind: 'The game crashed', reason: d.reason, exitCode: d.exitCode });
    if (Date.now() - lastRestart > 15000) {
      lastRestart = Date.now();
      win.reload();
    }
  });
  // smoke tests need real frames (hidden windows are throttled) but shouldn't steal focus
  if (isSmoke) win.showInactive();
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('console-message', (e) => {
    if (isSmoke || isDev) console.log('[renderer]', e.message);
  });
}

ipcMain.handle('profile:load', () => {
  try {
    return JSON.parse(fs.readFileSync(profilePath(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('profile:save', (_e, data) => {
  fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
  fs.writeFileSync(profilePath(), JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('net:host', async (_e, port) => relay.start(port));
ipcMain.handle('net:stop', () => relay.stop());

ipcMain.handle('net:ips', () => {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
});

ipcMain.handle('clip:write', (_e, text) => clipboard.writeText(String(text)));
ipcMain.handle('app:quit', () => app.quit());
// on = true/false sets it, undefined toggles; returns the new state
ipcMain.handle('app:fullscreen', (_e, on) => {
  const next = on === undefined ? !win.isFullScreen() : !!on;
  win.setFullScreen(next);
  return next;
});
ipcMain.handle('app:args', () => ({ smoke: isSmoke && !isPerf && !isTrailer && !stressRole && !crashTest, perf: isPerf, trailer: isTrailer, finale: isFinale, stress: stressRole, crashtest: crashTest, vector: process.argv.includes('--vector'), dev: isDev }));

// Smoke test: the renderer reports when it wants screenshots taken.
ipcMain.handle('smoke:shot', async (_e, name) => {
  const img = await win.webContents.capturePage();
  const dir = app.isPackaged ? path.join(app.getPath('temp'), 'dead-ground-shots') : path.join(__dirname, '..', 'test', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  return true;
});
// Trailer: tab capture of the game page (page content only, no window frame or picker)
ipcMain.handle('trailer:source', () => win.webContents.getMediaSourceId(win.webContents));
// the recorded video, saved next to the release builds
ipcMain.handle('trailer:save', (_e, data, ext, name) => {
  const dir = app.isPackaged ? app.getPath('videos') : path.join(__dirname, '..', 'release');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, (name === 'finale' ? 'Dead Ground Finale.' : 'Dead Ground Trailer.') + (ext === 'mp4' ? 'mp4' : 'webm'));
  fs.writeFileSync(file, Buffer.from(data));
  return file;
});
ipcMain.handle('crash:take', () => {
  try {
    const info = JSON.parse(fs.readFileSync(crashPath(), 'utf8'));
    fs.unlinkSync(crashPath());
    return info;
  } catch {
    return null;
  }
});
// crash test only: crash the page for real
ipcMain.handle('crash:test', () => {
  if (crashTest) setTimeout(() => win.webContents.forcefullyCrashRenderer(), 100);
});
ipcMain.handle('smoke:done', (_e, report) => {
  console.log('SMOKE REPORT', JSON.stringify(report));
  setTimeout(() => app.exit(report && report.ok ? 0 : 1), 100);
});

app.whenReady().then(() => {
  if (isPerf) console.log('GPU', JSON.stringify(app.getGPUFeatureStatus()));
  createWindow();
});
app.on('window-all-closed', () => {
  relay.stop();
  app.quit();
});
