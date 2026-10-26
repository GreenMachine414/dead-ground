// Tiny WebSocket relay that runs on the host's machine.
// The first socket that says {t:'hello', role:'host'} becomes the host; all other
// sockets are clients. Client messages are forwarded to the host tagged with the
// client's id, and host messages are forwarded to one client or broadcast.
const { WebSocketServer } = require('ws');

let wss = null;
let host = null;
let nextId = 1;
const clients = new Map();

// Game snapshots are skipped for a client whose socket is backed up, so a slow
// connection gets the latest state instead of a growing queue of stale ones.
const MAX_QUEUED = 64 * 1024;

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function start(port) {
  return new Promise((resolve) => {
    stop();
    host = null;
    nextId = 1;
    clients.clear();
    try {
      wss = new WebSocketServer({ port, perMessageDeflate: false });
    } catch (err) {
      resolve({ ok: false, error: String(err.message || err) });
      return;
    }
    wss.on('listening', () => resolve({ ok: true, port }));
    wss.on('error', (err) => resolve({ ok: false, error: String(err.message || err) }));
    wss.on('connection', (ws) => {
      ws.role = null;
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!ws.role) {
          if (msg.t !== 'hello') return;
          if (msg.role === 'host' && !host) {
            ws.role = 'host';
            host = ws;
            send(ws, { t: 'welcome', id: 0 });
          } else {
            ws.role = 'client';
            ws.id = nextId++;
            clients.set(ws.id, ws);
            send(ws, { t: 'welcome', id: ws.id });
            send(host, { t: 'join', id: ws.id, d: msg.d || {} });
          }
          return;
        }
        if (ws.role === 'host') {
          // {t:'h', to:<id|null>, d}
          const out = JSON.stringify({ t: 'h', d: msg.d });
          const snap = msg.d && msg.d.t === 'snap';
          for (const c of msg.to == null ? clients.values() : [clients.get(msg.to)]) {
            if (snap && c && c.bufferedAmount > MAX_QUEUED) continue;
            send(c, out);
          }
        } else {
          send(host, { t: 'c', from: ws.id, d: msg.d });
        }
      });
      ws.on('close', () => {
        if (ws.role === 'host') {
          host = null;
          for (const c of clients.values()) send(c, { t: 'hostgone' });
        } else if (ws.role === 'client') {
          clients.delete(ws.id);
          send(host, { t: 'leave', id: ws.id });
        }
      });
    });
  });
}

function stop() {
  if (wss) {
    for (const c of wss.clients) c.terminate();
    wss.close();
    wss = null;
  }
  host = null;
  clients.clear();
  return true;
}

module.exports = { start, stop };
