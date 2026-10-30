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
import { runSmoke, runCrashTest } from './smoke.js';
import { BINDS, RESERVED, MOUSE_BUTTONS, resolveBinds, keyName, normCode } from './keybinds.js';
import { GFX, GFX_VERSION, renderQuality } from './gfx.js';
import { runPerf } from './perf.js';
import { runTrailer, recordFinale } from './trailer.js';
import { runStress } from './stresslive.js';
import { playFinale, finalePlaying, stopFinale } from './finale.js';
import { portraitURL } from './render/sprites.js';
import { MenuBackdrop } from './menubg.js';
import { BUG_MAX, BUG_KEEP, AUTO_MAX, checkReport, newReportId, sendReport, errorReportText } from './bugreport.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

class App {
  constructor() {
    this.audio = new Audio();
    this.net = null;
    this.session = null;
    this.lobby = null;
    this.errors = [];
    this.loggedErrors = new Map(); // first line of an error -> the report it was logged as (this session)
  }

  async init() {
    this.profile = await loadProfile();
    // Graphics: Low (best performance) or High (full detail). Saves from before these two tiers
    // (Auto / High / Low) are moved over once - Auto becomes High - and the game became
    // fullscreen by default then.
    const st = this.profile.settings;
    if (this.profile.isNew) st.gfxV = GFX_VERSION;
    if (st.gfxV !== GFX_VERSION) {
      st.graphics = st.graphics === 'low' ? 'low' : 'high';
      st.fullscreen = true;
      st.gfxV = GFX_VERSION;
      this.save();
    }
    delete this.profile.isNew;
    if (!GFX.includes(st.graphics)) st.graphics = 'high';
    this.audio.setVolumes(this.profile.settings);
    document.addEventListener('pointerdown', () => {
      this.audio.init();
      this.audio.resume();
      if (!this.session && !finalePlaying()) this.audio.startMusic('menu');
    });
    measureRefresh();
    this.backdrop = new MenuBackdrop(document.getElementById('menu-bg'), renderQuality(st.graphics));
    this.backdrop.start();
    document.addEventListener('keydown', (e) => {
      if (e.code === 'F11') {
        e.preventDefault();
        this.setFullscreen();
      }
    });
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go)));
    $$('#mode-tabs button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    $('#lobby-start').addEventListener('click', () => (this.lobby && this.lobby.kind === 'client' ? this.toggleReady() : this.lobbyStart()));
    $('#watch-finale').addEventListener('click', () => this.watchFinale());
    $('#join-go').addEventListener('click', () => this.joinGame());
    $('#join-ip-go').addEventListener('click', () => this.joinGame(true));
    $('#join-code').addEventListener('input', (e) => (e.target.value = normalizeCode(e.target.value)));
    $('#join-code').addEventListener('keydown', (e) => e.key === 'Enter' && this.joinGame());
    $('#pause-resume').addEventListener('click', () => this.togglePause(false));
    $('#pause-settings').addEventListener('click', () => this.openGameSettings());
    $('#pause-quit').addEventListener('click', () => this.quitToMenu());
    $('#pause-master').addEventListener('input', (e) => this.setSetting('master', +e.target.value));
    $('#intro-go').addEventListener('click', () => this.closeIntro());
    $('#error-close').addEventListener('click', () => $('#overlay-error').classList.remove('show'));
    $('#error-copy').addEventListener('click', () => {
      const text = $('#error-text').textContent;
      (window.native ? window.native.copyText(text) : navigator.clipboard.writeText(text)).then(() => this.toast('Error copied'));
    });
    this.bindSettings();
    this.bindBugs();
    this.show('main');
    const args = window.native ? await window.native.args() : {};
    if (args.smoke) runSmoke(this);
    if (args.perf) runPerf(this, { vector: args.vector });
    if (args.crashtest) runCrashTest(this, args.crashtest === 'live');
    if (args.stress) runStress(this, args.stress);
    else if (args.finale) recordFinale(this);
    else if (args.trailer) runTrailer(this);
    const crash = window.native && (await window.native.takeCrash());
    if (crash) this.reportError(`${crash.kind} (${crash.reason}${crash.exitCode !== undefined ? ', exit code ' + crash.exitCode : ''}) and restarted.${crash.detail ? '\n' + crash.detail : ''}`, 'Crash');
    this.retryPending();
  }

  // ---------------------------------------------------------------- navigation
  show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    this.screen = name;
    if (this.keyListen) this.keyListen();
    if (!this.session && !finalePlaying()) {
      this.audio.startMusic('menu');
      if (this.backdrop) this.backdrop.start();
    }
    if (name === 'main') this.renderMain();
    if (name === 'chars') this.renderUpgrades();
    if (name === 'settings') this.renderSettings();
    if (name === 'howto') this.renderHowto();
    if (name === 'bugs') this.renderBugs();
  }

  hideScreens() {
    $$('.screen').forEach((s) => s.classList.remove('active'));
  }

  go(where) {
    // Back from the settings opened in a game returns to the pause menu
    if (where === 'main' && this.inGameSettings) return this.closeGameSettings();
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

  reportError(err, kind = 'Error') {
    const msg = (err && (err.stack || err.message)) || String(err);
    this.errors.push(msg);
    if (this.errors.length > 3) return;
    $('#error-text').textContent = msg;
    const note = $('#error-logged');
    note.textContent = 'Logging this error…';
    $('#overlay-error').classList.add('show');
    this.logError(msg, kind)
      .then((res) => {
        note.textContent =
          res.status === 'pending'
            ? "This error was automatically logged and will be sent for investigation as soon as you're back online."
            : 'This error was automatically logged and is being investigated.';
        if (res.id) note.textContent += ` (report #${res.id})`;
      })
      .catch(() => (note.textContent = ''));
  }

  // where the player was when something went wrong, for the error report
  errorWhere() {
    const s = this.session;
    if (!s) return `${this.screen} screen`;
    const snap = s.snap;
    return `in game: ${s.map.name}, ${s.opts.mode}, ${s.role}, ${snap ? snap.P.length : '?'} players, round ${snap ? snap.wave : '?'}`;
  }

  // Saves an error as a bug report ("My reports" lists it) and sends it. Repeats of the same error
  // are logged once, and at most AUTO_MAX per session; one that can't be sent waits for next launch.
  async logError(msg, kind) {
    const sig = String(msg).split('\n')[0].slice(0, 200);
    if (this.loggedErrors.has(sig)) return { status: 'logged', id: this.loggedErrors.get(sig) };
    if (this.loggedErrors.size >= AUTO_MAX) return { status: 'logged' };
    const r = { id: newReportId(), text: errorReportText(kind, msg, this.errorWhere()), edits: 0, auto: true, pending: true, sent: Date.now() };
    this.loggedErrors.set(sig, r.id);
    this.profile.bugReports = [r, ...this.profile.bugReports].slice(0, BUG_KEEP);
    this.save();
    try {
      await this.deliver(r);
      r.pending = false;
      this.save();
      return { status: 'sent', id: r.id };
    } catch (e) {
      console.warn('error report not sent yet', e);
      return { status: 'pending', id: r.id };
    } finally {
      if (this.screen === 'bugs') this.renderBugs();
    }
  }

  // send a report: tests can swap the sender (sendStub); smoke runs never email otherwise
  async deliver(r) {
    this.sending = this.sending || new Set(); // reports on their way right now (never sent twice)
    this.sending.add(r.id);
    try {
      if (this.sendStub) return await this.sendStub(r, this.profile.name);
      if (this.smoke) return;
      return await sendReport(r, this.profile.name);
    } finally {
      this.sending.delete(r.id);
    }
  }

  // error reports that couldn't be sent last time (offline) go out now; one already on its way
  // (a crash being reported as the game starts) is left to finish
  async retryPending() {
    const waiting = this.profile.bugReports.filter((r) => r.auto && r.pending && !(this.sending && this.sending.has(r.id)));
    for (const r of waiting) {
      try {
        await this.deliver(r);
        r.pending = false;
      } catch {
        return; // still offline: try again next launch
      }
    }
    if (waiting.length) this.save();
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
    $('#set-defaults').addEventListener('click', () => this.resetSettings());
  }

  // Every setting on the Settings screen back to its default, applied at once (progress, the
  // player's name and the remembered co-op address and port are kept)
  resetSettings() {
    const s = this.profile.settings, def = defaultProfile().settings;
    this.profile.settings = { ...def, lastJoin: s.lastJoin, port: s.port, gfxV: GFX_VERSION };
    this.audio.setVolumes(this.profile.settings);
    this.setSetting('graphics', def.graphics);
    this.setFullscreen(def.fullscreen);
    if (this.session) {
      this.session.setBinds(def.keys);
      this.session.renderer.shakeEnabled = def.shake;
    }
    this.renderSettings();
    this.save();
    this.toast('Settings reset to defaults');
  }

  // The Settings screen over a paused game (solo or co-op). The game stays paused (solo) or keeps
  // running without this player's input (co-op) until they leave the pause menu.
  openGameSettings() {
    if (!this.session) return;
    this.inGameSettings = true;
    this.screenBefore = this.screen;
    $('#overlay-pause').classList.remove('show');
    document.body.classList.add('ingame-settings');
    this.show('settings');
  }

  // back to the pause menu (or, when the game is ending, just close)
  closeGameSettings(ending) {
    this.inGameSettings = false;
    if (this.keyListen) this.keyListen();
    document.body.classList.remove('ingame-settings');
    this.hideScreens();
    this.screen = this.screenBefore;
    if (ending) return;
    $('#pause-master').value = this.profile.settings.master;
    $('#overlay-pause').classList.add('show');
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

  // wait for the next key press (or mouse side button) and bind it to the button's action
  listenKey(btn) {
    if (this.keyListen) this.keyListen();
    btn.classList.add('listening');
    btn.textContent = 'Press a key or side button…';
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
    const onMouse = (e) => {
      const code = MOUSE_BUTTONS[e.button];
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
      this.rebind(id, code);
    };
    const stop = () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('mousedown', onMouse, true);
      this.keyListen = null;
      this.renderKeys();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('mousedown', onMouse, true);
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

  // ---------------------------------------------------------------- bug reports
  bindBugs() {
    const box = $('#bug-text');
    box.maxLength = BUG_MAX;
    box.addEventListener('input', () => this.bugCount());
    $('#bug-send').addEventListener('click', () => this.sendBug());
    $('#bug-cancel').addEventListener('click', () => this.editBug(null));
    $('#bug-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-edit]');
      if (btn) this.editBug(btn.dataset.edit);
    });
    this.editBug(null);
  }

  renderBugs() {
    this.bugStatus('');
    const list = this.profile.bugReports;
    $('#bug-list').innerHTML = list.length
      ? list
          .map((r) => {
            const when = new Date(r.sent).toLocaleDateString();
            const snip = r.text.length > 140 ? r.text.slice(0, 140) + '…' : r.text;
            return `<div class="bug-item${r.id === this.bugEditing ? ' editing' : ''}"><div class="bug-meta">#${r.id} · ${when}${r.auto ? ' · automatic error report' : ''}${r.pending ? ' · waiting to send' : ''}${r.edits ? ` · edited ${r.edits}×` : ''}</div><button data-edit="${r.id}">Edit</button><div class="bug-snip">${esc(snip)}</div></div>`;
          })
          .join('')
      : '<p class="hint">Reports you send show up here so you can edit them later.</p>';
  }

  // id: a saved report to edit, or null for a new report
  editBug(id) {
    const r = id && this.profile.bugReports.find((q) => q.id === id);
    this.bugEditing = r ? r.id : null;
    $('#bug-text').value = r ? r.text : '';
    $('#bug-head').textContent = r ? `Editing report #${r.id}` : 'Report a bug or share feedback';
    $('#bug-send').textContent = r ? 'Save changes' : 'Submit';
    $('#bug-cancel').style.display = r ? '' : 'none';
    this.bugCount();
    if (this.screen === 'bugs') {
      this.renderBugs();
      $('#bug-text').focus();
    }
  }

  bugCount() {
    const n = $('#bug-text').value.length;
    const el = $('#bug-count');
    el.textContent = `${n} / ${BUG_MAX}`;
    el.classList.toggle('near', n > BUG_MAX * 0.9);
  }

  bugStatus(text, ok = false) {
    const el = $('#bug-status');
    el.textContent = text;
    el.className = 'hint ' + (ok ? 'ok' : 'err');
  }

  async sendBug() {
    if (this.bugBusy) return;
    const text = $('#bug-text').value.trim();
    const reports = this.profile.bugReports;
    const old = this.bugEditing && reports.find((r) => r.id === this.bugEditing);
    if (old && old.text === text) return this.bugStatus('Nothing has changed yet.');
    const err = checkReport(text, reports);
    if (err) return this.bugStatus(err);
    const r = old ? { ...old, text, edits: old.edits + 1 } : { id: newReportId(), text, edits: 0 };
    this.bugBusy = true;
    $('#bug-send').disabled = true;
    this.bugStatus('Sending…', true);
    try {
      await this.deliver(r);
    } catch (e) {
      console.warn('bug report failed', e);
      return this.bugStatus("Couldn't send the report. Check your internet connection and try again.");
    } finally {
      this.bugBusy = false;
      $('#bug-send').disabled = false;
    }
    r.sent = Date.now();
    r.pending = false;
    this.profile.bugReports = [r, ...reports.filter((q) => q.id !== r.id)].slice(0, BUG_KEEP);
    this.save();
    this.editBug(null);
    this.bugStatus(old ? 'Changes sent. Thanks!' : 'Sent. Thanks!', true);
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
    if (k === 'keys' && this.session) this.session.setBinds(v);
    // graphics apply at once: the running game (if any) and the menu backdrop
    if (k === 'graphics') {
      if (this.session) this.session.renderer.setGraphics(renderQuality(v));
      if (this.backdrop) this.backdrop.setQuality(renderQuality(v));
    }
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
        <img class="portrait" src="${portraitURL(id)}" alt="${c.name}">
        <h3>${c.name}</h3><div class="role">${c.role}</div>
        <div class="ab">${c.ability} — Level ${lvl}/${MAX_LEVEL}</div>
        <div class="desc">${c.desc}</div>
        <div class="passive">Passive: ${c.passive}</div>
        <ol>${c.levels.map((l, i) => `<li class="${i < lvl ? 'have' : i === lvl ? 'next' : ''}">${l}</li>`).join('')}</ol>
        <button class="${cost !== null && p.salvage >= cost ? 'big' : ''}" data-up="${id}" ${cost === null || p.salvage < cost ? 'disabled' : ''}>
          ${cost === null ? 'MAX LEVEL' : `Upgrade — ⚙ ${cost}`}</button>
      </div>`;
    }).join('');
    $$('[data-up]').forEach((b) => b.addEventListener('click', () => this.buyUpgrade(b.dataset.up) && this.renderUpgrades()));
  }

  // spend salvage on a character level; in a lobby the new level goes to everyone with the pick
  buyUpgrade(id) {
    const p = this.profile;
    const cost = upgradeCost(p.levels[id]);
    if (cost === null || p.salvage < cost) return false;
    p.salvage -= cost;
    p.levels[id]++;
    this.save();
    this.audio.play('perk');
    if (this.lobby && !this.session && p.char === id) this.selectChar(id);
    return true;
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
    if (this.net) this.net.close();
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
    if (this.net) this.net.close();
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
    if (this.session) this.endSession(); // never leave a game running in the background
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
    if (!this.lobby || this.lobby.kind === 'client' || this.lobby.mode === mode) return;
    this.lobby.mode = mode;
    this.clearReady();
    this.broadcastLobby();
    this.renderLobby();
  }

  selectMap(id) {
    if (!this.lobby || this.lobby.kind === 'client') return;
    if (id > this.lobby.unlocked) return this.toast('Beat the previous map to unlock this one.');
    if (id === this.lobby.mapId) return;
    this.lobby.mapId = id;
    this.clearReady();
    this.broadcastLobby();
    this.renderLobby();
  }

  selectChar(id) {
    const p = this.profile;
    p.char = id;
    this.save();
    const level = p.levels[id];
    if (this.lobby.kind === 'client') {
      this.net.toHost({ t: 'char', char: id, level }); // the host un-readies us: a new pick needs a new ready
    } else {
      const me = this.lobby.players.find((q) => q.id === 0);
      me.char = id;
      me.level = level;
      me.name = p.name;
      this.broadcastLobby();
    }
    this.renderLobby();
  }

  // guests only: tell the host we're ready (or not)
  toggleReady() {
    const me = this.lobby.players.find((q) => q.id === this.myLobbyId);
    if (me) this.net.toHost({ t: 'ready', on: !me.ready });
  }

  // host: the guests still to ready up (the host readies by pressing Start)
  get notReady() {
    // only a hosted co-op lobby waits; the host is always player 0
    return this.lobby && this.lobby.kind === 'host' ? this.lobby.players.filter((q) => q.id !== 0 && !q.ready) : [];
  }

  // host: a change everyone should see before starting (map, mode, back from a game) clears ready
  clearReady() {
    if (this.lobby) for (const q of this.lobby.players) q.ready = false;
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
    // the finale cutscene can be rewatched once Ground Zero's story is beaten
    $('#watch-finale').hidden = !this.profile.completed.includes(5);
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
        <img class="portrait" src="${portraitURL(id)}" alt="${c.name}">
        <div class="cname">${c.name}</div><div class="crole">${c.role}</div>
        <div class="cab">${c.ability}</div><div class="clvl">Level ${this.profile.levels[id]}/${MAX_LEVEL}</div>
      </button>`;
    }).join('');
    $$('[data-char]').forEach((b) => b.addEventListener('click', () => this.selectChar(b.dataset.char)));
    // upgrade the picked survivor without leaving the lobby
    const c = CHARACTERS[myChar], lvl = this.profile.levels[myChar], cost = upgradeCost(lvl);
    const can = cost !== null && this.profile.salvage >= cost;
    $('#lobby-upgrade').innerHTML = `<div class="lobup-info"><b>${c.name}</b> · ${c.ability} Level ${lvl}/${MAX_LEVEL}
        <div class="lobup-next">${cost === null ? 'Fully upgraded' : 'Next: ' + c.levels[lvl]}</div></div>
      <div class="lobup-buy"><span>⚙ ${this.profile.salvage}</span>
        <button id="lobby-up" class="${can ? 'big' : ''}" ${can ? '' : 'disabled'}>${cost === null ? 'MAX LEVEL' : `Upgrade — ⚙ ${cost}`}</button></div>`;
    $('#lobby-up').addEventListener('click', () => {
      this.buyUpgrade(myChar);
      this.renderLobby();
    });
    // players
    const solo = L.kind === 'solo';
    $('#lobby-players').innerHTML = L.players.map((p) => `<div class="lp ${p.ready ? 'ready' : ''}"><div><b>${esc(p.name)}</b>${p.host ? '<span class="host-tag">HOST</span>' : ''}
        ${solo || p.host ? '' : `<span class="ready-tag">${p.ready ? '✔ READY' : 'NOT READY'}</span>`}
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
    const meReady = !!(me && me.ready), waiting = L.kind === 'host' ? this.notReady.length : 0;
    start.textContent = isClient ? (meReady ? 'Not Ready' : 'Ready Up') : waiting ? `Waiting for ${waiting} to ready up` : 'Start';
    start.disabled = waiting > 0;
    start.classList.toggle('is-ready', meReady);
    $('#lobby-hint').textContent = isClient
      ? meReady ? 'Ready! Waiting for the host to start the game...' : 'Pick your survivor, then Ready Up.'
      : L.kind === 'host'
        ? `${L.players.length}/4 survivors. More players = more zombies, tougher zombies.${L.players.length > 1 ? ' Everyone has to ready up before you can start.' : ''}`
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
      if (d.v !== PROTOCOL) {
        this.net.toClients({ t: 'kick', reason: 'Different game version: everyone needs the same version of Dead Ground' }, msg.id);
        return;
      }
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
          if (p.char !== d.char) p.ready = false;
          p.char = d.char;
          p.level = Math.max(1, Math.min(5, d.level | 0 || 1));
          this.broadcastLobby();
          this.renderLobby();
        }
      } else if (d.t === 'ready' && L && !this.session) {
        const p = L.players.find((q) => q.id === msg.from);
        if (p) {
          p.ready = !!d.on;
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
    if (!this.lobby) return; // left already; anything still in flight is stale
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
    if (this.notReady.length) return this.toast('Waiting for ' + this.notReady.map((q) => q.name).join(', ') + ' to ready up.');
    const seed = (Math.random() * 1e9) | 0;
    const players = L.players.map((p) => ({ id: p.id, name: p.name, char: p.char, level: p.level }));
    const opts = { mapId: L.mapId, mode: L.mode, seed, players, unlockedMap: L.unlocked };
    if (L.kind === 'host') this.net.toClients({ t: 'start', ...opts });
    this.startSession({ role: L.kind === 'host' ? 'host' : 'solo', net: this.net, localId: 0, ...opts });
  }

  // ---------------------------------------------------------------- session
  startSession(opts) {
    stopFinale();
    this.audio.init();
    this.hideScreens();
    this.backdrop.stop();
    this.session = new Session(this, opts);
    this.session.start();
    this.showIntro(opts);
  }

  endSession() {
    if (this.inGameSettings) this.closeGameSettings(true);
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
    if (this.inGameSettings) return this.closeGameSettings(); // Esc in the settings: back to the pause menu
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
      this.clearReady();
      this.broadcastLobby();
      this.net.toClients({ t: 'toLobby' });
      this.show('lobby');
      this.renderLobby();
    } else if (role === 'client') {
      this.leaveLobby();
    } else {
      this.show('main');
    }
  }

  // replay the end-of-story cutscene from the lobby, with the survivors picked there (yours first)
  get finalePlaying() {
    return finalePlaying();
  }

  async watchFinale() {
    if (finalePlaying() || !this.profile.completed.includes(5)) return;
    const team = this.lobby ? this.lobby.players : [], id = this.myLobbyId;
    // a guest watching isn't ready: the host can't start a game they can't see
    const me = team.find((q) => q.id === id);
    if (this.lobby && this.lobby.kind === 'client' && me && me.ready) this.net.toHost({ t: 'ready', on: false });
    this.backdrop.stop();
    await playFinale(this, [...team.filter((q) => q.id === id), ...team.filter((q) => q.id !== id)].map((q) => q.char));
    if (!this.session) {
      this.audio.startMusic('menu');
      this.backdrop.start();
    }
  }

  // ---------------------------------------------------------------- end of game
  async onGameEnd(session, snap) {
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
    if (win && mode === 'story' && m.id === 5 && !this.smoke) {
      // the getaway cutscene, with this team's survivors (yours first)
      const screen = this.screen;
      await playFinale(this, [me, ...snap.P.filter((q) => q !== me)].filter(Boolean).map((q) => q.c));
      if (this.session) return; // the host started the next game meanwhile
      // the host sent everyone to the lobby meanwhile: show it again now, so its music and
      // backdrop (held back during the cutscene) come back
      if (this.screen !== screen) return this.show(this.screen);
    }
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
      const guests = this.lobby && this.lobby.players.length > 1;
      if (!guests) buttons.push([win ? 'Play Again' : 'Retry', () => {
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
      this.clearReady(); // everyone readies up again for the next game
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
