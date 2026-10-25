// WebSocket client used by both host and joining players. All traffic goes through
// the relay running in the host's Electron main process (electron/relay.js).
export const DEFAULT_PORT = 27015;
export const PROTOCOL = 1;

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.isHost = false;
    this.handler = null;
    this.onClose = null;
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
        if (settled && this.onClose) this.onClose();
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.id = msg.id;
          resolve(msg.id);
          return;
        }
        if (this.handler) this.handler(msg);
      };
    });
  }

  async host(port, name) {
    const res = await window.native.hostServer(port);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not start server');
    this.isHost = true;
    await this.connect(`ws://127.0.0.1:${port}`, { t: 'hello', role: 'host', d: { name } });
    return port;
  }

  async join(address, port, hello) {
    this.isHost = false;
    return this.connect(`ws://${address}:${port}`, { t: 'hello', role: 'client', d: hello });
  }

  // host -> one client (to=id) or everyone (to=null)
  toClients(d, to = null) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ to, d }));
  }

  // client -> host
  toHost(d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ d }));
  }

  close() {
    this.onClose = null;
    if (this.ws) this.ws.close();
    this.ws = null;
    if (this.isHost && window.native) window.native.stopServer();
    this.isHost = false;
  }
}
