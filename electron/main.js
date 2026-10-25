const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const relay = require('./relay');

const isSmoke = process.argv.includes('--smoke');
const isDev = process.argv.includes('--dev');
let win;

function profilePath() {
  return path.join(app.getPath('userData'), 'profile.json');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
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

ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', () => {
  win.setFullScreen(!win.isFullScreen());
});
ipcMain.handle('app:args', () => ({ smoke: isSmoke, dev: isDev }));

// Smoke test: the renderer reports when it wants screenshots taken.
ipcMain.handle('smoke:shot', async (_e, name) => {
  const img = await win.webContents.capturePage();
  const dir = app.isPackaged ? path.join(app.getPath('temp'), 'dead-ground-shots') : path.join(__dirname, '..', 'test', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  return true;
});
ipcMain.handle('smoke:done', (_e, report) => {
  console.log('SMOKE REPORT', JSON.stringify(report));
  setTimeout(() => app.exit(report && report.ok ? 0 : 1), 100);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  relay.stop();
  app.quit();
});
