// Networking used by both host and joining players.
//
// Friends normally join with a short game code: the host registers the code on the
// public PeerJS signaling server and everyone connects to the host peer-to-peer over
// WebRTC (works on the same Wi-Fi and across the internet, no port forwarding).
// As a fallback for play without internet, the host also runs the WebSocket relay in
// the Electron main process (electron/relay.js) so LAN players can join by IP.
//
// Whatever the transport, the app sees the same messages:
//   host receives {t:'join', id, d} / {t:'leave', id} / {t:'c', from, d}
//   client receives {t:'h', d} / {t:'hostgone'}
import { Peer } from 'peerjs';

export const DEFAULT_PORT = 27015;
export const PROTOCOL = 2;
const PREFIX = 'deadground-v2-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
const CODE_LEN = 6;
const FIRST_PEER_ID = 100; // relay clients get 1, 2, ...; code clients start here
// Snapshots are only useful when fresh. If a connection can't keep up, its send queue
// would otherwise grow without limit (PeerJS allows 8 MB) and everything the player
// sees and hears would arrive seconds late. Above this many queued bytes we skip
// snapshots for that player until the queue drains.
const MAX_QUEUED = 16 * 1024;
const MAX_HELD_EVENTS = 400;

// bytes waiting to go out on a PeerJS connection (browser buffer + PeerJS's own queue)
function queued(conn) {
  return (conn.dataChannel ? conn.dataChannel.bufferedAmount : 0) + (conn.bufferSize || 0);
}

export function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function friendly(err) {
  switch (err && err.type) {
    case 'peer-unavailable':
      return 'No game found with that code. Check it and make sure the host is still in the lobby';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking server. Check your internet connection';
    case 'browser-incompatible':
      return 'Peer-to-peer networking is not available';
    default:
      return String((err && err.message) || err || 'Connection failed');
  }
}

export class Net {
  constructor() {
    this.ws = null; // relay socket (LAN / direct IP)
    this.peer = null; // PeerJS peer (game code)
    this.conn = null; // client: data connection to the host
    this.links = new Map(); // host: client id -> data connection
    this.nextPeerId = FIRST_PEER_ID;
    this.id = null;
    this.isHost = false;
    this.code = null;
    this.handler = null;
    this.onClose = null;
  }

  emit(msg) {
    if (this.handler) this.handler(msg);
  }

  // ---------------------------------------------------------------- host
  // Starts both transports. Succeeds if at least one of them works.
  async host(port, name) {
    this.isHost = true;
    let lan = null, codeErr = null;
    try {
      const res = await window.native.hostServer(port);
      if (res && res.ok) {
        await this.connect(`ws://127.0.0.1:${port}`, { t: 'hello', role: 'host', d: { name } });
        lan = port;
      }
    } catch {
      lan = null;
    }
    try {
      this.code = await this.openHostPeer();
    } catch (e) {
      codeErr = e.message;
    }
    if (!this.code && !lan) throw new Error(codeErr || 'Could not start hosting');
    return { code: this.code, codeErr, port: lan };
  }

  openHostPeer() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, { debug: 0 });
        let opened = false;
        const timer = setTimeout(() => {
          if (opened) return;
          peer.destroy();
          reject(new Error('Could not reach the matchmaking server. Check your internet connection'));
        }, 10000);
        peer.on('open', () => {
          opened = true;
          clearTimeout(timer);
          this.peer = peer;
          resolve(code);
        });
        peer.on('connection', (conn) => this.acceptPeer(conn));
        peer.on('error', (err) => {
          if (opened) return; // e.g. a client that vanished mid-handshake; nothing to do
          clearTimeout(timer);
          peer.destroy();
          if (err.type === 'unavailable-id' && ++tries < 5) attempt();
          else reject(new Error(friendly(err)));
        });
        // keep the code joinable if the signaling socket drops; open games are unaffected
        peer.on('disconnected', () => {
          if (this.peer === peer && !peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 2000);
        });
      };
      attempt();
    });
  }

  acceptPeer(conn) {
    let id = null;
    conn.on('data', (raw) => {
      const msg = parse(raw);
      if (!msg) return;
      if (id === null) {
        if (msg.t !== 'hello') return;
        id = this.nextPeerId++;
        conn.heldEvents = [];
        this.links.set(id, conn);
        conn.send(JSON.stringify({ t: 'welcome', id }));
        this.emit({ t: 'join', id, d: msg.d || {} });
        return;
      }
      this.emit({ t: 'c', from: id, d: msg.d });
    });
    const gone = () => {
      if (id !== null && this.links.get(id) === conn) {
        this.links.delete(id);
        this.emit({ t: 'leave', id });
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  // ---------------------------------------------------------------- client
  joinCode(code, hello) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        this.peer = this.conn = null;
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('Timed out connecting to the host. Make sure they are still in the lobby'), 20000);
      peer.on('error', (err) => {
        if (!settled) fail(friendly(err));
      });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
        this.conn = conn;
        conn.on('open', () => conn.send(JSON.stringify({ t: 'hello', d: hello })));
        conn.on('data', (raw) => {
          const msg = parse(raw);
          if (!msg) return;
          if (msg.t === 'welcome' && !settled) {
            settled = true;
            clearTimeout(timer);
            this.id = msg.id;
            resolve(msg.id);
            return;
          }
          this.emit(msg);
        });
        conn.on('close', () => {
          if (!settled) fail('The host closed the connection');
          else if (this.onClose) this.onClose();
        });
        conn.on('error', (err) => {
          if (!settled) fail(friendly(err));
        });
      });
    });
  }

  // direct connection to the host's relay (same network, no internet needed)
  async join(address, port, hello) {
    this.isHost = false;
    return this.connect(`ws://${address}:${port}`, { t: 'hello', role: 'client', d: hello });
  }

  connect(url, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('Connection timed out'));
        }
      }, 6000);
      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Could not connect to ' + url));
        }
      };
      ws.onclose = () => {
        if (settled && this.onClose && !this.isHost) this.onClose();
      };
      ws.onmessage = (ev) => {
        const msg = parse(ev.data);
        if (!msg) return;
        if (msg.t === 'welcome' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.id = msg.id;
          resolve(msg.id);
          return;
        }
        this.emit(msg);
      };
    });
  }

  // ---------------------------------------------------------------- sending
  // host -> one client (to=id) or everyone (to=null)
  toClients(d, to = null) {
    if (to == null || to >= FIRST_PEER_ID) {
      let out = null;
      for (const [id, c] of this.links) {
        if ((to != null && id !== to) || !c.open) continue;
        if (d.t === 'snap') this.sendSnap(c, d);
        else c.send(out || (out = JSON.stringify({ t: 'h', d })));
      }
    }
    if ((to == null || to < FIRST_PEER_ID) && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ to, d }));
  }

  // Skip snapshots while a player's connection is backed up, holding on to their
  // one-off events (sounds, hits, messages) so they arrive with the next one sent.
  sendSnap(c, d) {
    const events = d.s.E || [];
    if (queued(c) > MAX_QUEUED) {
      c.heldEvents.push(...events);
      if (c.heldEvents.length > MAX_HELD_EVENTS) c.heldEvents.splice(0, c.heldEvents.length - MAX_HELD_EVENTS);
      return;
    }
    const E = c.heldEvents.length ? [...c.heldEvents, ...events] : events;
    c.heldEvents = [];
    c.send(JSON.stringify({ t: 'h', d: { t: 'snap', s: { ...d.s, E } } }));
  }

  // client -> host. Returns false if the message was not sent (connection backed up),
  // so the caller can keep one-off actions for the next send.
  toHost(d) {
    if (this.conn) {
      if (!this.conn.open || (d.t === 'in' && queued(this.conn) > MAX_QUEUED)) return false;
      this.conn.send(JSON.stringify({ d }));
      return true;
    }
    if (!this.ws || this.ws.readyState !== 1 || (d.t === 'in' && this.ws.bufferedAmount > MAX_QUEUED)) return false;
    this.ws.send(JSON.stringify({ d }));
    return true;
  }

  close() {
    this.onClose = null;
    this.handler = null;
    for (const c of this.links.values()) {
      if (c.open) c.send(JSON.stringify({ t: 'hostgone' }));
      // give the goodbye a moment to flush before tearing the channel down
      setTimeout(() => c.close(), 200);
    }
    this.links.clear();
    if (this.conn) this.conn.close();
    this.conn = null;
    const peer = this.peer;
    this.peer = null;
    if (peer) setTimeout(() => peer.destroy(), 300);
    if (this.ws) this.ws.close();
    this.ws = null;
    if (this.isHost && window.native) window.native.stopServer();
    this.isHost = false;
  }
}
