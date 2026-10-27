import { MAPS, getMap } from './data/maps.js';
import { CHARACTERS, CHARACTER_IDS, MAX_LEVEL } from './data/characters.js';
import { WEAPONS } from './data/weapons.js';
import { ZOMBIES } from './data/zombies.js';
import { loadProfile, saveProfile, upgradeCost, defaultProfile } from './profile.js';
import { Audio } from './audio.js';
import { Net, DEFAULT_PORT, PROTOCOL, normalizeCode } from './net.js';
import { Session } from './session.js';
import { measureRefresh } from './render/renderer.js';
import { esc } from './hud.js';
import { runSmoke } from './smoke.js';
import { BINDS, RESERVED, resolveBinds, keyName, normCode } from './keybinds.js';
import { runPerf } from './perf.js';
import { MenuBackdrop } from './menubg.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

class App {
  constructor() {
    this.audio = new Audio();
    this.net = null;
    this.session = null;
    this.lobby = null;
    this.errors = [];
  }

  async init() {
    this.profile = await loadProfile();
    this.audio.setVolumes(this.profile.settings);
    document.addEventListener('pointerdown', () => {
      this.audio.init();
      this.audio.resume();
      if (!this.session) this.audio.startMusic('menu');
    });
    measureRefresh();
    this.backdrop = new MenuBackdrop(document.getElementById('menu-bg'));
    this.backdrop.start();
    document.addEventListener('keydown', (e) => {
      if (e.code === 'F11') {
        e.preventDefault();
        this.setFullscreen();
      }
    });
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go)));
    $$('#mode-tabs button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    $('#lobby-start').addEventListener('click', () => this.lobbyStart());
    $('#join-go').addEventListener('click', () => this.joinGame());
    $('#join-ip-go').addEventListener('click', () => this.joinGame(true));
    $('#join-code').addEventListener('input', (e) => (e.target.value = normalizeCode(e.target.value)));
    $('#join-code').addEventListener('keydown', (e) => e.key === 'Enter' && this.joinGame());
    $('#pause-resume').addEventListener('click', () => this.togglePause(false));
    $('#pause-quit').addEventListener('click', () => this.quitToMenu());
    $('#pause-master').addEventListener('input', (e) => this.setSetting('master', +e.target.value));
    $('#intro-go').addEventListener('click', () => this.closeIntro());
    $('#error-close').addEventListener('click', () => $('#overlay-error').classList.remove('show'));
    this.bindSettings();
    this.show('main');
    const args = window.native ? await window.native.args() : {};
    if (args.smoke) runSmoke(this);
    if (args.perf) runPerf(this, { vector: args.vector });
  }

  // ---------------------------------------------------------------- navigation
  show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    this.screen = name;
    if (this.keyListen) this.keyListen();
    if (!this.session) {
      this.audio.startMusic('menu');
      if (this.backdrop) this.backdrop.start();
    }
    if (name === 'main') this.renderMain();
    if (name === 'chars') this.renderUpgrades();
    if (name === 'settings') this.renderSettings();
    if (name === 'howto') this.renderHowto();
  }

  hideScreens() {
    $$('.screen').forEach((s) => s.classList.remove('active'));
  }

  go(where) {
    this.audio.init();
    this.audio.play('swap');
    switch (where) {
      case 'solo':
        this.openLobby('solo');
        break;
      case 'host':
        this.hostLobby();
        break;
      case 'join':
        $('#join-name').value = this.profile.name;
        $('#join-code').value = '';
        $('#join-addr').value = this.profile.settings.lastJoin || '';
        $('#join-port').value = this.profile.settings.port || DEFAULT_PORT;
        $('#join-status').textContent = '';
        this.show('join');
        $('#join-code').focus();
        break;
      case 'leave-lobby':
        this.leaveLobby();
        break;
      case 'quit':
        window.native ? window.native.quit() : window.close();
        break;
      default:
        this.show(where);
    }
  }

  toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 2500);
  }

  reportError(err) {
    const msg = (err && (err.stack || err.message)) || String(err);
    this.errors.push(msg);
    if (this.errors.length > 3) return;
    $('#error-text').textContent = msg;
    $('#overlay-error').classList.add('show');
  }

  renderMain() {
    const p = this.profile;
    $('#main-name').innerHTML = `Survivor: <b>${esc(p.name)}</b>`;
    $('#main-salvage').innerHTML = `Salvage: <b>${p.salvage}</b>`;
    $('#main-progress').innerHTML = `Maps unlocked: <b>${p.unlocked}/5</b>`;
  }

  async save() {
    if (this.smoke) return; // smoke tests never touch the real save file
    await saveProfile(this.profile);
  }

  // ---------------------------------------------------------------- settings
  bindSettings() {
    $('#set-name').addEventListener('change', (e) => {
      this.profile.name = e.target.value.trim().slice(0, 16) || 'Survivor';
      this.save();
    });
    for (const k of ['master', 'sfx', 'music']) $('#set-' + k).addEventListener('input', (e) => this.setSetting(k, +e.target.value));
    $('#set-shake').addEventListener('change', (e) => this.setSetting('shake', e.target.checked));
    $('#set-graphics').addEventListener('change', (e) => this.setSetting('graphics', e.target.value));
    $('#set-fullscreen').addEventListener('change', (e) => this.setFullscreen(e.target.checked));
    $('#set-keys').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bind]');
      if (btn) this.listenKey(btn);
    });
    $('#set-keys-reset').addEventListener('click', () => {
      this.setSetting('keys', {});
      this.renderKeys();
      this.toast('Controls reset to defaults');
    });
    $('#set-reset').addEventListener('click', () => {
      if (!confirm('Reset all progress, upgrades and salvage? This cannot be undone.')) return;
      const keep = this.profile.settings;
      const name = this.profile.name;
      this.profile = defaultProfile();
      this.profile.settings = keep;
      this.profile.name = name;
      this.save();
      this.toast('Progress reset');
    });
  }

  renderSettings() {
    const s = this.profile.settings;
    $('#set-name').value = this.profile.name;
    $('#set-master').value = s.master;
    $('#set-sfx').value = s.sfx;
    $('#set-music').value = s.music;
    $('#set-shake').checked = s.shake;
    $('#set-fullscreen').checked = s.fullscreen;
    $('#set-graphics').value = s.graphics;
    this.renderKeys();
  }

  // ---------------------------------------------------------------- controls
  renderKeys() {
    const binds = resolveBinds(this.profile.settings.keys);
    $('#set-keys').innerHTML = BINDS.map((b) => `<span>${b.label}</span><button data-bind="${b.id}">${esc(keyName(binds[b.id]))}</button>`).join('');
  }

  // wait for the next key press and bind it to the button's action
  listenKey(btn) {
    if (this.keyListen) this.keyListen();
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
    const id = btn.dataset.bind;
    const onDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = normCode(e.code);
      stop();
      if (code === 'Escape') return;
      if (RESERVED.has(code)) return this.toast(`${keyName(code)} can't be rebound`);
      this.rebind(id, code);
    };
    const stop = () => {
      window.removeEventListener('keydown', onDown, true);
      this.keyListen = null;
      this.renderKeys();
    };
    window.addEventListener('keydown', onDown, true);
    this.keyListen = stop;
  }

  // a key already used by another action swaps the two; only changes from the defaults are saved
  rebind(id, code) {
    const binds = resolveBinds(this.profile.settings.keys);
    const other = BINDS.find((b) => b.id !== id && binds[b.id] === code);
    if (other) binds[other.id] = binds[id];
    binds[id] = code;
    const keys = {};
    for (const b of BINDS) if (binds[b.id] !== b.def) keys[b.id] = binds[b.id];
    this.setSetting('keys', keys);
    this.renderKeys();
    if (other) this.toast(`${other.label} moved to ${keyName(binds[other.id])}`);
  }

  // How to Play shows the player's current keys
  renderHowto() {
    const names = resolveBinds(this.profile.settings.keys);
    for (const td of $$('[data-k]')) {
      td.textContent = td.dataset.k.split(',').map((id) => keyName(names[id])).join(' ') + (td.dataset.kSuffix || '');
    }
  }

  // on: true/false, or undefined to toggle (F11). Remembered for the next launch.
  async setFullscreen(on) {
    if (!window.native) return;
    const state = await window.native.setFullscreen(on);
    this.setSetting('fullscreen', state);
    $('#set-fullscreen').checked = state;
  }

  setSetting(k, v) {
    this.profile.settings[k] = v;
    this.audio.setVolumes(this.profile.settings);
    if (k === 'shake' && this.session) this.session.renderer.shakeEnabled = v;
    if (k === 'graphics' && this.session) this.session.renderer.setGraphics(v);
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.save(), 400);
  }

  // ---------------------------------------------------------------- upgrades
  renderUpgrades() {
    const p = this.profile;
    $('#chars-salvage').textContent = `⚙ ${p.salvage} Salvage`;
    $('#char-upgrades').innerHTML = CHARACTER_IDS.map((id) => {
      const c = CHARACTERS[id];
      const lvl = p.levels[id];
      const cost = upgradeCost(lvl);
      return `<div class="upg panel">
        <div class="avatar" style="background:${hex(c.color)}"></div>
        <h3>${c.name}</h3><div class="role">${c.role}</div>
        <div class="ab">${c.ability} — Level ${lvl}/${MAX_LEVEL}</div>
        <div class="desc">${c.desc}</div>
        <div class="passive">Passive: ${c.passive}</div>
        <ol>${c.levels.map((l, i) => `<li class="${i < lvl ? 'have' : i === lvl ? 'next' : ''}">${l}</li>`).join('')}</ol>
        <button class="${cost !== null && p.salvage >= cost ? 'big' : ''}" data-up="${id}" ${cost === null || p.salvage < cost ? 'disabled' : ''}>
          ${cost === null ? 'MAX LEVEL' : `Upgrade — ⚙ ${cost}`}</button>
      </div>`;
    }).join('');
    $$('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.up;
      const cost = upgradeCost(p.levels[id]);
      if (cost === null || p.salvage < cost) return;
      p.salvage -= cost;
      p.levels[id]++;
      this.save();
      this.audio.play('perk');
      this.renderUpgrades();
    }));
  }

  // ---------------------------------------------------------------- lobby
  openLobby(kind, extra = {}) {
    const p = this.profile;
    const mapId = Math.min(p.unlocked, 5);
    this.lobby = {
      kind, mode: 'story', mapId, unlocked: p.unlocked,
      players: [{ id: 0, name: p.name, char: p.char, level: p.levels[p.char], host: true }],
      ...extra,
    };
    $('#lobby-title').textContent = kind === 'solo' ? 'Play Solo' : kind === 'host' ? 'Host Co-op' : 'Co-op Lobby';
    this.show('lobby');
    this.renderLobby();
  }

  async hostLobby() {
    if (this.hosting) return;
    this.hosting = true;
    const port = this.profile.settings.port || DEFAULT_PORT;
    this.net = new Net();
    this.net.handler = (m) => this.onHostMsg(m);
    this.toast('Starting game...');
    let res;
    try {
      res = await this.net.host(port, this.profile.name);
    } catch (e) {
      this.net = null;
      this.toast('Could not host: ' + e.message);
      return;
    } finally {
      this.hosting = false;
    }
    const ips = window.native ? await window.native.localIPs() : [];
    this.openLobby('host', { code: res.code, codeErr: res.codeErr, port: res.port, ips });
  }

  copyCode() {
    const code = this.lobby && this.lobby.code;
    if (!code) return;
    (window.native ? window.native.copyText(code) : navigator.clipboard.writeText(code)).then(() => this.toast('Code copied: ' + code));
  }

  // byIP: direct connection to the host's LAN relay instead of the game code
  async joinGame(byIP = false) {
    if (this.joining) return;
    const name = $('#join-name').value.trim().slice(0, 16) || 'Survivor';
    const code = normalizeCode($('#join-code').value);
    const addr = $('#join-addr').value.trim();
    const port = +$('#join-port').value || DEFAULT_PORT;
    if (byIP && !addr) return ($('#join-status').textContent = 'Enter the host address.');
    if (!byIP && code.length !== 6) return ($('#join-status').textContent = 'Enter the 6-character game code from the host.');
    this.profile.name = name;
    if (byIP) this.profile.settings.lastJoin = addr;
    this.save();
    $('#join-status').textContent = 'Connecting...';
    this.joining = true;
    this.net = new Net();
    const hello = { name, char: this.profile.char, level: this.profile.levels[this.profile.char], v: PROTOCOL };
    try {
      const myId = byIP ? await this.net.join(addr, port, hello) : await this.net.joinCode(code, hello);
      this.myId = myId;
      this.net.handler = (m) => this.onClientMsg(m);
      this.net.onClose = () => this.onDisconnected('Connection to host lost.');
      this.lobby = { kind: 'client', mode: 'story', mapId: 1, unlocked: 1, players: [] };
      $('#lobby-title').textContent = 'Co-op Lobby';
      this.show('lobby');
      this.renderLobby();
    } catch (e) {
      this.net = null;
      $('#join-status').textContent = byIP ? e.message + '. Check the address/port and that the host is in the lobby.' : e.message + '.';
    } finally {
      this.joining = false;
    }
  }

  leaveLobby() {
    if (this.net) {
      this.net.close();
      this.net = null;
    }
    this.lobby = null;
    this.show('main');
  }

  onDisconnected(reason) {
    if (this.session) this.endSession();
    if (this.net) this.net.close();
    this.net = null;
    this.lobby = null;
    $('#overlay-pause').classList.remove('show');
    $('#overlay-intro').classList.remove('show');
    this.show('main');
    this.toast(reason);
  }

  get myLobbyId() {
    return this.lobby && this.lobby.kind === 'client' ? this.myId : 0;
  }

  setMode(mode) {
    if (!this.lobby || this.lobby.kind === 'client') return;
    this.lobby.mode = mode;
    this.broadcastLobby();
    this.renderLobby();
  }

  selectMap(id) {
    if (!this.lobby || this.lobby.kind === 'client') return;
    if (id > this.lobby.unlocked) return this.toast('Beat the previous map to unlock this one.');
    this.lobby.mapId = id;
    this.broadcastLobby();
    this.renderLobby();
  }

  selectChar(id) {
    const p = this.profile;
    p.char = id;
    this.save();
    const level = p.levels[id];
    if (this.lobby.kind === 'client') {
      this.net.toHost({ t: 'char', char: id, level });
    } else {
      const me = this.lobby.players.find((q) => q.id === 0);
      me.char = id;
      me.level = level;
      me.name = p.name;
      this.broadcastLobby();
    }
    this.renderLobby();
  }

  broadcastLobby() {
    if (this.lobby && this.lobby.kind === 'host' && this.net) {
      const { mode, mapId, unlocked, players } = this.lobby;
      this.net.toClients({ t: 'lobby', mode, mapId, unlocked, players });
    }
  }

  renderLobby() {
    const L = this.lobby;
    if (!L) return;
    const isClient = L.kind === 'client';
    $$('#mode-tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === L.mode);
      b.disabled = isClient;
    });
    // maps
    $('#map-list').innerHTML = MAPS.map((m) => {
      const locked = m.id > L.unlocked;
      const best = this.profile.best[m.id];
      const done = this.profile.completed.includes(m.id);
      return `<button class="map-card ${m.id === L.mapId ? 'selected' : ''} ${locked ? 'locked' : ''}" data-map="${m.id}" ${isClient ? 'disabled' : ''}>
        <span class="mc-name">${m.id}. ${m.name} ${locked ? '🔒' : done ? '✔' : ''}</span>
        <span class="mc-sub">${m.subtitle}</span>
        <span class="mc-tag">${locked ? 'Complete map ' + (m.id - 1) + ' to unlock' : best ? 'Endless best: round ' + best : ''}</span>
      </button>`;
    }).join('');
    $$('[data-map]').forEach((b) => b.addEventListener('click', () => this.selectMap(+b.dataset.map)));
    // map detail
    const m = getMap(L.mapId);
    const zeds = m.zombies.map((z) => ZOMBIES[z.type].name);
    $('#map-detail').innerHTML = `<h4>${m.name}</h4><div class="md-sub">${m.subtitle}</div>
      <div>${L.mode === 'story' ? esc(m.story.intro) : 'Endless Survival: no objectives — just rounds that never stop. A boss arrives every 5 rounds. How long can you last?'}</div>
      <div class="chips">${zeds.map((z) => `<span class="chip zed">${z}</span>`).join('')}
        ${m.miniboss ? `<span class="chip boss">Mini-boss: ${ZOMBIES[m.miniboss].name}</span>` : ''}
        <span class="chip boss">Boss: ${ZOMBIES[m.boss].name}</span></div>
      <div class="chips">${m.newWeapons.map((w) => `<span class="chip gun">New: ${WEAPONS[w].name}</span>`).join('')}</div>`;
    // characters
    const me = L.players.find((p) => p.id === this.myLobbyId);
    const myChar = me ? me.char : this.profile.char;
    $('#char-pick').innerHTML = CHARACTER_IDS.map((id) => {
      const c = CHARACTERS[id];
      return `<button class="char-card ${id === myChar ? 'selected' : ''}" data-char="${id}">
        <div class="avatar" style="background:${hex(c.color)}">${c.name[0]}</div>
        <div class="cname">${c.name}</div><div class="crole">${c.role}</div>
        <div class="cab">${c.ability}</div><div class="clvl">Level ${this.profile.levels[id]}/${MAX_LEVEL}</div>
      </button>`;
    }).join('');
    $$('[data-char]').forEach((b) => b.addEventListener('click', () => this.selectChar(b.dataset.char)));
    // players
    $('#lobby-players').innerHTML = L.players.map((p) => `<div class="lp"><div><b>${esc(p.name)}</b>${p.host ? '<span class="host-tag">HOST</span>' : ''}
        <div class="lp-char">${CHARACTERS[p.char].name} · ${CHARACTERS[p.char].ability} Lv ${p.level}</div></div></div>`).join('');
    const net = $('#lobby-net');
    if (L.kind === 'host') {
      const lan = L.port ? `<div class="lan">Same network, no internet: join by IP <b>${(L.ips || []).join('</b> / <b>') || 'your IP'}</b> port ${L.port}</div>` : '';
      net.innerHTML = L.code
        ? `Game code <span class="code">${L.code}</span><button id="copy-code">Copy</button><div class="lan">Friends click <b>Join Co-op</b> and enter this code</div>${lan}`
        : `<div>Online code unavailable: ${esc(L.codeErr || 'no internet')}</div>${lan}`;
      const cb = $('#copy-code');
      if (cb) cb.addEventListener('click', () => this.copyCode());
    } else net.innerHTML = '';
    const start = $('#lobby-start');
    start.style.display = isClient ? 'none' : '';
    $('#lobby-hint').textContent = isClient
      ? 'Waiting for the host to start the game...'
      : L.kind === 'host'
        ? `${L.players.length}/4 survivors. More players = more zombies, tougher zombies.`
        : '';
  }

  onHostMsg(msg) {
    const L = this.lobby;
    if (msg.t === 'join') {
      if (!L || this.session || L.players.length >= 4) {
        this.net.toClients({ t: 'kick', reason: this.session ? 'Game already in progress' : 'Lobby is full' }, msg.id);
        return;
      }
      const d = msg.d || {};
      L.players.push({ id: msg.id, name: String(d.name || 'Survivor').slice(0, 16), char: CHARACTERS[d.char] ? d.char : 'brick', level: Math.max(1, Math.min(5, d.level | 0 || 1)) });
      this.toast((d.name || 'A survivor') + ' joined');
      this.broadcastLobby();
      this.renderLobby();
    } else if (msg.t === 'leave') {
      if (L) {
        const p = L.players.find((q) => q.id === msg.id);
        L.players = L.players.filter((q) => q.id !== msg.id);
        if (p) this.toast(p.name + ' left');
        this.broadcastLobby();
        if (!this.session) this.renderLobby();
      }
      if (this.session && this.session.game) this.session.game.removePlayer(msg.id);
    } else if (msg.t === 'c') {
      const d = msg.d || {};
      if (d.t === 'char' && L && !this.session) {
        const p = L.players.find((q) => q.id === msg.from);
        if (p && CHARACTERS[d.char]) {
          p.char = d.char;
          p.level = Math.max(1, Math.min(5, d.level | 0 || 1));
          this.broadcastLobby();
          this.renderLobby();
        }
      } else if (this.session) this.session.onNet(msg);
    }
  }

  onClientMsg(msg) {
    if (msg.t === 'hostgone') return this.onDisconnected('The host closed the game.');
    if (msg.t !== 'h') return;
    const d = msg.d;
    if (d.t === 'lobby') {
      Object.assign(this.lobby, { mode: d.mode, mapId: d.mapId, unlocked: d.unlocked, players: d.players });
      if (!this.session && this.screen === 'lobby') this.renderLobby();
    } else if (d.t === 'kick') {
      this.onDisconnected(d.reason || 'Removed from lobby');
    } else if (d.t === 'start') {
      this.startSession({ role: 'client', net: this.net, localId: this.myId, mapId: d.mapId, mode: d.mode, players: d.players });
    } else if (d.t === 'toLobby') {
      if (this.session) this.endSession();
      this.show('lobby');
      this.renderLobby();
    } else if (this.session) this.session.onNet(msg);
  }

  lobbyStart() {
    const L = this.lobby;
    if (!L || L.kind === 'client') return;
    const seed = (Math.random() * 1e9) | 0;
    const players = L.players.map((p) => ({ id: p.id, name: p.name, char: p.char, level: p.level }));
    const opts = { mapId: L.mapId, mode: L.mode, seed, players, unlockedMap: L.unlocked };
    if (L.kind === 'host') this.net.toClients({ t: 'start', ...opts });
    this.startSession({ role: L.kind === 'host' ? 'host' : 'solo', net: this.net, localId: 0, ...opts });
  }

  // ---------------------------------------------------------------- session
  startSession(opts) {
    this.audio.init();
    this.hideScreens();
    this.backdrop.stop();
    this.session = new Session(this, opts);
    this.session.start();
    this.showIntro(opts);
  }

  endSession() {
    if (this.session) this.session.stop();
    this.session = null;
  }

  showIntro(opts) {
    const m = getMap(opts.mapId);
    $('#intro-sub').textContent = opts.mode === 'story' ? `Map ${m.id} of 5 — ${m.subtitle}` : 'Endless Survival';
    $('#intro-title').textContent = m.name;
    $('#intro-text').textContent = opts.mode === 'story' ? m.story.intro : 'No rescue is coming. Survive as many rounds as you can. A boss rises every fifth round.';
    $('#intro-steps').innerHTML = opts.mode === 'story' ? m.story.steps.map((s) => `<li>${esc(s.text)}</li>`).join('') : '';
    $('#intro-extra').textContent = `New weapons: ${m.newWeapons.map((w) => WEAPONS[w].name).join(', ')} · Boss: ${ZOMBIES[m.boss].name}`;
    $('#intro-go').textContent = this.session.role === 'solo' ? 'Begin' : 'Close';
    $('#overlay-intro').classList.add('show');
    this.session.setPaused(true);
    if (this.session.role !== 'solo') this.introT = setTimeout(() => this.closeIntro(), 12000);
  }

  closeIntro() {
    clearTimeout(this.introT);
    $('#overlay-intro').classList.remove('show');
    if (this.session) this.session.setPaused(false);
  }

  togglePause(force) {
    if (!this.session) return;
    if ($('#overlay-intro').classList.contains('show')) return this.closeIntro();
    const ov = $('#overlay-pause');
    const show = force !== undefined ? force : !ov.classList.contains('show');
    ov.classList.toggle('show', show);
    $('#pause-title').textContent = this.session.role === 'solo' ? 'Paused' : 'Menu (game continues)';
    $('#pause-quit').textContent = this.session.role === 'client' ? 'Leave Game' : this.session.role === 'host' ? 'End Game for Everyone' : 'Quit to Menu';
    $('#pause-master').value = this.profile.settings.master;
    this.session.setPaused(show);
  }

  quitToMenu() {
    $('#overlay-pause').classList.remove('show');
    const role = this.session && this.session.role;
    this.endSession();
    if (role === 'host') {
      this.net.toClients({ t: 'toLobby' });
      this.show('lobby');
      this.renderLobby();
    } else if (role === 'client') {
      this.leaveLobby();
    } else {
      this.show('main');
    }
  }

  // ---------------------------------------------------------------- end of game
  onGameEnd(session, snap) {
    if (this.session !== session) return;
    const win = snap.res === 'win';
    const m = session.map;
    const mode = session.opts.mode;
    const me = snap.P.find((p) => p.id === session.localId);
    const p = this.profile;
    // rewards
    const kills = me ? me.k : 0;
    let salvage = kills * 2 + snap.wave * 15 + Math.floor((me ? me.er : 0) / 100);
    if (mode === 'story') salvage += snap.steps * 40 + (win ? 300 * m.id : 0);
    p.salvage += salvage;
    p.stats.kills += kills;
    p.stats.games++;
    let unlockedNew = false;
    if (win && mode === 'story') {
      p.stats.wins++;
      if (!p.completed.includes(m.id)) p.completed.push(m.id);
      if (m.id < 5 && p.unlocked <= m.id) {
        p.unlocked = m.id + 1;
        unlockedNew = true;
      }
    }
    if (mode === 'endless') p.best[m.id] = Math.max(p.best[m.id] || 0, snap.wave);
    this.save();

    $('#overlay-pause').classList.remove('show');
    this.endSession();
    const title = $('#end-title');
    title.className = win ? 'win' : 'lose';
    title.textContent = win ? (m.id === 5 ? 'YOU SURVIVED' : 'ESCAPED!') : mode === 'endless' ? `SURVIVED ${snap.wave} ROUNDS` : 'YOU DIED';
    $('#end-text').textContent = win ? m.story.outro + (m.id === 5 ? ' — Thanks for playing DEAD GROUND.' : '') : mode === 'endless' ? `Best on ${m.name}: round ${p.best[m.id]}` : `The horde overran ${m.name} on round ${snap.wave}.`;
    $('#end-stats').innerHTML = `<table><tr><th>Survivor</th><th>Character</th><th>Kills</th><th>Points earned</th><th>Downs</th><th>Revives</th></tr>
      ${snap.P.map((q) => `<tr><td>${esc(q.n)}</td><td>${CHARACTERS[q.c].name}</td><td>${q.k}</td><td>${q.er}</td><td>${q.dn}</td><td>${q.rvs}</td></tr>`).join('')}</table>`;
    $('#end-reward').innerHTML = `+${salvage} Salvage earned (total ${p.salvage})${unlockedNew ? `<br>🔓 Unlocked: ${getMap(m.id + 1).name}` : ''}`;
    const buttons = [];
    const role = session.role;
    if (role === 'client') {
      buttons.push(['Back to Lobby', () => {
        this.show('lobby');
        this.renderLobby();
      }]);
      buttons.push(['Leave', () => this.leaveLobby()]);
    } else {
      if (win && mode === 'story' && m.id < 5) {
        buttons.push(['Next Map →', () => {
          this.lobby.unlocked = Math.max(this.lobby.unlocked, m.id + 1);
          this.lobby.mapId = m.id + 1;
          this.toLobby();
        }]);
      }
      buttons.push([win ? 'Play Again' : 'Retry', () => {
        this.lobby.unlocked = Math.max(this.lobby.unlocked, p.unlocked);
        this.toLobby();
        this.lobbyStart();
      }]);
      buttons.push(['Lobby', () => this.toLobby()]);
      if (role === 'solo') buttons.push(['Upgrades', () => this.show('chars')]);
      buttons.push(['Main Menu', () => this.leaveLobby()]);
    }
    $('#end-buttons').innerHTML = '';
    buttons.forEach(([label, fn], i) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (i === 0) b.className = 'big';
      b.addEventListener('click', fn);
      $('#end-buttons').appendChild(b);
    });
    this.show('end');
  }

  toLobby() {
    if (this.lobby.kind === 'host') {
      this.lobby.unlocked = Math.max(this.lobby.unlocked, this.profile.unlocked);
      this.net.toClients({ t: 'toLobby' });
      this.broadcastLobby();
    } else this.lobby.unlocked = this.profile.unlocked;
    const me = this.lobby.players.find((q) => q.id === 0);
    if (me) me.level = this.profile.levels[me.char];
    this.show('lobby');
    this.renderLobby();
  }
}

const app = new App();
window.addEventListener('error', (e) => app.reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => app.reportError(e.reason));
app.init();
window.app = app;
