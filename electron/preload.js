const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  loadProfile: () => ipcRenderer.invoke('profile:load'),
  saveProfile: (data) => ipcRenderer.invoke('profile:save', data),
  hostServer: (port) => ipcRenderer.invoke('net:host', port),
  stopServer: () => ipcRenderer.invoke('net:stop'),
  localIPs: () => ipcRenderer.invoke('net:ips'),
  copyText: (text) => ipcRenderer.invoke('clip:write', text),
  quit: () => ipcRenderer.invoke('app:quit'),
  setFullscreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  args: () => ipcRenderer.invoke('app:args'),
  smokeShot: (name) => ipcRenderer.invoke('smoke:shot', name),
  smokeDone: (report) => ipcRenderer.invoke('smoke:done', report),
});
