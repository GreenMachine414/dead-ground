// DOM heads-up display (cozy RPG style).
import { WEAPONS, weaponStats, RARITY, FORGE2 } from './data/weapons.js';
import { CHARACTERS } from './data/characters.js';
import { PERKS, POWERUPS } from './data/zombies.js';
import { BOONS } from './data/boons.js';
import { gunIconURL, hex } from './render/sprites.js';
import { resolveBinds, keyName } from './keybinds.js';

const $ = (root, sel) => root.querySelector(sel);
const BIGMAP_W = 880, BIGMAP_H = 600; // max full-map canvas size (px)

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="obj card"><div class="obj-title"></div><div class="obj-text"></div><div class="obj-prog"></div></div>
      <div class="round"><div class="round-label">ROUND</div><div class="round-num"></div><div class="round-sub"></div></div>
      <div class="minimap-wrap"><canvas class="minimap" width="200" height="200"></canvas></div>
      <div class="bosses"></div>
      <div class="powerups"></div>
      <div class="team"></div>
      <div class="msg"><div class="msg-main"></div><div class="msg-sub"></div></div>
      <div class="notes"></div>
      <div class="levelup"><div class="lu-title">Choose an upgrade: press 1, 2 or 3 <span class="lu-more"></span></div><div class="lu-cards"></div></div>
      <div class="prompt"><div class="prompt-text"></div><div class="prompt-bar"><div></div></div></div>
      <div class="player card">
        <div class="pts-row"><span class="coin">●</span><span class="pts"></span><span class="pts-pop"></span></div>
        <div class="bar hp"><div class="fill"></div><span></span></div>
        <div class="row2">
          <div class="ability"><div class="ab-cd"></div><div class="ab-key">F</div><div class="ab-charges"></div></div>
          <div class="ab-info"><div class="ab-name"></div><div class="ab-state"></div></div>
          <div class="grenades"></div>
        </div>
        <div class="perks"></div>
      </div>
      <div class="xp"><div class="xp-lvl"></div><div class="xp-bar"><div></div></div><div class="xp-boons"></div></div>
      <div class="weapon card"><img class="w-icon" alt=""/><div class="w-rarity"></div><div class="w-name"></div><div class="w-ammo"><span class="mag"></span><span class="res"></span></div><div class="w-alt"></div><div class="bar w-reload"><div class="fill"></div></div></div>
      <div class="vignette"></div>
      <div class="down-overlay"><div class="down-title">YOU ARE DOWN</div><div class="down-sub"></div></div>
      <div class="scoreboard card"></div>
      <div class="bigmap card"><div class="bigmap-head"><span class="bigmap-title"></span><span class="bigmap-hint"></span></div><canvas class="bigmap-cv"></canvas></div>
      <div class="whiteflash"></div>
      <div class="crosshair"></div>
    `;
    const q = (s) => $(root, s);
    this.el = {
      objTitle: q('.obj-title'), objText: q('.obj-text'), objProg: q('.obj-prog'),
      roundNum: q('.round-num'), roundSub: q('.round-sub'), minimap: q('.minimap'),
      bosses: q('.bosses'), powerups: q('.powerups'), team: q('.team'),
      msg: q('.msg'), msgMain: q('.msg-main'), msgSub: q('.msg-sub'), notes: q('.notes'),
      prompt: q('.prompt'), promptText: q('.prompt-text'), promptBar: q('.prompt-bar'), promptFill: q('.prompt-bar div'),
      pts: q('.pts'), ptsPop: q('.pts-pop'), hpFill: q('.hp .fill'), hpText: q('.hp span'),
      abCd: q('.ab-cd'), abCharges: q('.ab-charges'), abName: q('.ab-name'), abState: q('.ab-state'), ability: q('.ability'),
      grenades: q('.grenades'), perks: q('.perks'), wIcon: q('.w-icon'), wRarity: q('.w-rarity'), wName: q('.w-name'),
      mag: q('.mag'), res: q('.res'), wAlt: q('.w-alt'), reload: q('.w-reload'), reloadFill: q('.w-reload .fill'),
      vignette: q('.vignette'), down: q('.down-overlay'), downSub: q('.down-sub'), score: q('.scoreboard'), flash: q('.whiteflash'),
      crosshair: q('.crosshair'), levelup: q('.levelup'), luCards: q('.lu-cards'), luMore: q('.lu-more'),
      xpLvl: q('.xp-lvl'), xpFill: q('.xp-bar div'), xpBoons: q('.xp-boons'), abKey: q('.ab-key'),
      bigmap: q('.bigmap'), bigmapCv: q('.bigmap-cv'), bigmapTitle: q('.bigmap-title'), bigmapHint: q('.bigmap-hint'),
    };
    this.showMap = false;
    this.setKeys(resolveBinds());
    this.msgQueue = [];
    this.msgT = 0;
    this.hurtT = 0;
    this.popT = 0;
    this.popSum = 0;
    this.cache = {};
    this.bars = {}; // smoothed progress bars, see bar()
    this.showScore = false;
    this.onPick = null;
    this.el.luCards.addEventListener('mousedown', (e) => {
      const card = e.target.closest('[data-pick]');
      if (!card) return;
      e.stopPropagation();
      if (this.onPick) this.onPick(+card.dataset.pick);
    });
  }

  setWorld(world, map) {
    this.world = world;
    this.map = map;
    const th = world.theme;
    const c = document.createElement('canvas');
    const S = 4;
    c.width = world.W * S;
    c.height = world.H * S;
    const g = c.getContext('2d');
    g.fillStyle = th.ground;
    g.fillRect(0, 0, c.width, c.height);
    for (const d of world.decor) {
      if (d.kind === 'trail') {
        g.strokeStyle = th.path;
        g.lineWidth = d.width * S;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        d.points.forEach(([x, z], i) => (i ? g.lineTo(x * S, z * S) : g.moveTo(x * S, z * S)));
        g.stroke();
      } else if (d.kind === 'road' || d.kind === 'floor' || d.kind === 'tiles' || d.kind === 'lot') {
        g.fillStyle = d.kind === 'floor' ? th.floor : d.kind === 'road' ? '#55585e' : 'rgba(255,255,255,0.15)';
        g.fillRect(d.x * S, d.z * S, d.w * S, d.d * S);
      } else if (d.kind === 'pond') {
        g.fillStyle = th.water;
        g.beginPath();
        g.ellipse(d.x * S, d.z * S, d.rx * S, d.rz * S, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const s of world.solids) {
      if (s.kind === 'water') g.fillStyle = th.water;
      else if (s.kind === 'tree' || s.kind === 'bush') g.fillStyle = 'rgba(40,90,50,0.55)';
      else if (s.kind === 'building') g.fillStyle = s.roof || th.roof;
      else g.fillStyle = s.low ? 'rgba(60,50,40,0.45)' : 'rgba(50,40,40,0.8)';
      g.fillRect(s.x * S, s.z * S, s.w * S, s.d * S);
    }
    for (const s of world.spots.perk) {
      g.fillStyle = hex(PERKS[s.perk].color);
      g.beginPath();
      g.arc(s.x * S, s.z * S, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.lineWidth = 2;
    g.strokeStyle = '#ffffff';
    const shop = world.spots.boonshop;
    if (shop) {
      // purple diamond
      g.beginPath();
      g.moveTo(shop.x * S, shop.z * S - 8);
      g.lineTo(shop.x * S + 6, shop.z * S);
      g.lineTo(shop.x * S, shop.z * S + 8);
      g.lineTo(shop.x * S - 6, shop.z * S);
      g.closePath();
      g.fillStyle = '#a070f0';
      g.fill();
      g.stroke();
    }
    const forge = world.spots.forge;
    if (forge) {
      // orange square
      g.fillStyle = '#ff8a3a';
      g.fillRect(forge.x * S - 5, forge.z * S - 5, 10, 10);
      g.strokeRect(forge.x * S - 5, forge.z * S - 5, 10, 10);
    }
    this.mapImg = c;
    this.mapS = S;
    // full map: the minimap art scaled to fit, with the fixed machines labelled, rendered once
    const bc = this.el.bigmapCv;
    const fit = Math.min(BIGMAP_W / world.W, BIGMAP_H / world.H);
    bc.width = Math.round(world.W * fit);
    bc.height = Math.round(world.H * fit);
    const big = document.createElement('canvas');
    big.width = bc.width;
    big.height = bc.height;
    const bg = big.getContext('2d');
    bg.drawImage(c, 0, 0, big.width, big.height);
    for (const s of world.spots.perk) this.mapText(bg, PERKS[s.perk].name, s.x * fit, s.z * fit, hex(PERKS[s.perk].color));
    if (shop) this.mapText(bg, 'Upgrade Machine', shop.x * fit, shop.z * fit, '#d2a8ff');
    if (forge) this.mapText(bg, 'Weapon Forge', forge.x * fit, forge.z * fit, '#ffaa60');
    this.bigMapImg = big;
    this.el.bigmapTitle.textContent = map.name;
  }

  // small label just above a point on a map canvas
  mapText(g, text, x, y, col) {
    g.font = '800 12px Nunito, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(28,22,30,0.85)';
    g.strokeText(text, x, y - 7);
    g.fillStyle = col;
    g.fillText(text, x, y - 7);
  }

  // key names for prompts and the HUD (binds: action -> key code)
  setKeys(binds) {
    this.keys = {};
    for (const id in binds) this.keys[id] = keyName(binds[id]);
    this.el.abKey.textContent = this.keys.ability;
    this.el.bigmapHint.textContent = `${this.keys.map} or Esc to close`;
  }

  message(main, sub = '', time = 3.5) {
    this.msgQueue.push({ main, sub, time });
  }

  note(text) {
    const d = document.createElement('div');
    d.className = 'note';
    d.textContent = text;
    this.el.notes.appendChild(d);
    setTimeout(() => d.remove(), 4000);
    while (this.el.notes.children.length > 6) this.el.notes.firstChild.remove();
  }

  // Timed bars (looting, building, reviving, reloading) only change on sim ticks or snapshots, which
  // looks steppy at high refresh rates or over the network. Carry the bar on at its measured rate
  // between updates (at most 0.15 s ahead) and draw it with a transform, which skips layout.
  bar(key, el, v, dt) {
    let b = this.bars[key];
    if (!b) b = this.bars[key] = { v: -1, at: 0, rate: 0, shown: 0, t: 0 };
    b.t += dt;
    if (v !== b.v) {
      const step = v - b.v, gap = b.t - b.at;
      if (b.v < 0 || step < 0 || step > 0.3 || gap > 0.25) {
        // new or restarted bar: jump to it
        b.rate = 0;
        b.shown = v;
      } else b.rate = b.rate ? b.rate * 0.6 + (step / Math.max(gap, 0.004)) * 0.4 : step / Math.max(gap, 0.004);
      b.v = v;
      b.at = b.t;
    }
    b.shown = Math.max(b.shown, Math.min(1, v + b.rate * Math.min(b.t - b.at, 0.15)));
    el.style.transform = `scaleX(${b.shown})`;
  }

    set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  handleEvents(events, localId) {
    for (const e of events) {
      switch (e.k) {
        case 'msg':
          this.message(e.s, e.sub || '');
          break;
        case 'obj':
          this.message('New Objective', e.s, 4);
          break;
        case 'boss':
          this.message(e.s, e.b ? 'Boss incoming!' : 'Mini-boss incoming!', 3.5);
          break;
        case 'power':
          this.message(e.s, '', 2.5);
          break;
        case 'nuke':
          this.el.flash.classList.remove('on');
          void this.el.flash.offsetWidth;
          this.el.flash.classList.add('on');
          break;
        case 'note':
          if (e.p === -1 || e.p === localId) this.note(e.s);
          break;
        case 'wave':
          this.message('Round ' + e.w, '', 3);
          this.el.roundNum.classList.remove('pulse');
          void this.el.roundNum.offsetWidth;
          this.el.roundNum.classList.add('pulse');
          break;
        case 'waveEnd':
          this.note('Round ' + e.w + ' survived');
          break;
        case 'stepdone':
          this.note('Objective complete! +250');
          break;
        case 'hurt':
          if (e.p === localId) this.hurtT = 1;
          break;
        case 'pts':
          if (e.p === localId) {
            this.popSum += e.n;
            this.popT = 1;
          }
          break;
        case 'loot':
          if (e.r >= 3) this.note(RARITY[e.r].name + ' weapon found!');
          break;
      }
    }
  }

  update(snap, me, dt, mouse) {
    const el = this.el;
    el.crosshair.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
    this.msgT -= dt;
    if (this.msgT <= 0 && this.msgQueue.length) {
      const m = this.msgQueue.shift();
      el.msgMain.textContent = m.main;
      el.msgSub.textContent = m.sub;
      this.msgT = this.msgQueue.length > 2 ? 1.5 : m.time;
      el.msg.classList.remove('show');
      void el.msg.offsetWidth;
      el.msg.classList.add('show');
    }
    if (this.msgT <= 0) el.msg.classList.remove('show');

    const o = snap.O;
    this.set('objTitle', el.objTitle, o.n ? `${this.map.name} · Quest ${o.i + 1}/${o.n}` : `${this.map.name} · Endless`);
    this.set('objText', el.objText, o.text);
    this.set('objProg', el.objProg, o.prog);
    this.set('round', el.roundNum, String(snap.wave || '—'));
    this.set('roundSub', el.roundSub, snap.ws === 0 ? (snap.wave === 0 ? 'Starts in ' + snap.wt + 's' : 'Next in ' + snap.wt + 's') : snap.left + ' left');

    const bossHtml = snap.BS.map((b) => `<div class="boss ${b[3] ? 'major' : ''}"><div class="boss-name">${b[1]}</div><div class="boss-bar"><div style="width:${Math.max(0, b[2] * 100)}%"></div></div></div>`).join('');
    this.set('boss', el.bosses, bossHtml, 'innerHTML');
    const pw = [];
    if (snap.PW[0] > 0) pw.push(`<div class="pw" style="color:${hex(POWERUPS.instakill.color)}">☠ Insta-Kill ${Math.ceil(snap.PW[0])}</div>`);
    if (snap.PW[1] > 0) pw.push(`<div class="pw" style="color:${hex(POWERUPS.double.color)}">×2 Double Points ${Math.ceil(snap.PW[1])}</div>`);
    this.set('pw', el.powerups, pw.join(''), 'innerHTML');
    const team = snap.P.filter((p) => !me || p.id !== me.id)
      .map((p) => `<div class="mate ${p.s === 1 ? 'down' : p.s === 2 ? 'dead' : ''}"><span class="nm">${esc(p.n)} <small>Lv ${p.rk}</small></span><span class="ch">${CHARACTERS[p.c].name}</span><div class="mhp"><div style="width:${(p.hp / p.mh) * 100}%"></div></div><span class="mp">${p.pts}</span></div>`)
      .join('');
    this.set('team', el.team, team, 'innerHTML');

    if (!me) return;
    this.set('pts', el.pts, me.pts.toLocaleString());
    if (this.popT > 0) {
      this.popT -= dt;
      this.set('pop', el.ptsPop, '+' + this.popSum);
      el.ptsPop.style.opacity = Math.min(1, this.popT * 2);
      if (this.popT <= 0) this.popSum = 0;
    } else el.ptsPop.style.opacity = 0;
    const hpf = Math.max(0, me.hp / me.mh);
    el.hpFill.style.width = hpf * 100 + '%';
    el.hpFill.classList.toggle('low', hpf < 0.35);
    this.set('hpt', el.hpText, `${Math.max(0, me.hp)} / ${me.mh}${me.sh > 0 ? ' +' + me.sh + ' ⛨' : ''}`);
    const ch = CHARACTERS[me.c];
    this.set('abn', el.abName, `${ch.ability} · Lv ${me.l}`);
    const ready = me.c === 'brick' ? me.ch > 0 : me.cd <= 0;
    el.ability.classList.toggle('ready', ready);
    el.ability.style.setProperty('--ab-color', hex(ch.color));
    el.abCd.style.height = (me.cd > 0 ? me.cd / me.cdm : 0) * 100 + '%';
    this.set('abs', el.abState, ready ? `Ready — ${this.keys.ability} / Right-click` : 'Recharging ' + Math.ceil(me.cd) + 's');
    this.set('abc', el.abCharges, me.c === 'brick' ? `${me.ch}/${me.chm}` : '');
    this.set('gren', el.grenades, '<span class="gico"></span>'.repeat(me.g) || '<span class="none">no grenades</span>', 'innerHTML');
    this.set('perks', el.perks, me.pk.map((k) => `<span class="perk" style="background:${hex(PERKS[k].color)}">${PERKS[k].name}</span>`).join(''), 'innerHTML');
    // weapon
    const w = me.w[me.cw] || me.w[0];
    if (w) {
      const r = RARITY[w[4] || 0];
      const ws = weaponStats(w[0], w[1], w[4] || 0);
      this.set('wicon', el.wIcon, gunIconURL(w[0], w[1]), 'src');
      this.set('wr', el.wRarity, (w[1] ? 'Forged · ' : '') + r.name);
      el.wRarity.style.color = w[1] === 2 ? '#ff8a80' : w[1] ? '#d6a8ff' : r.color;
      this.set('wn', el.wName, ws.name + (w[1] === 1 ? ` · XX ${Math.min(w[6], FORGE2.kills)}/${FORGE2.kills}` : ''));
      this.set('mag', el.mag, String(w[2]));
      this.set('res', el.res, ' / ' + w[3]);
      el.mag.classList.toggle('empty', w[2] === 0);
      el.mag.classList.toggle('low', w[2] > 0 && w[2] <= Math.ceil((w[5] || ws.mag) * 0.25));
    }
    const alt = me.w[1 - me.cw];
    this.set('alt', el.wAlt, alt ? `[${this.keys.swap}] ${RARITY[alt[4] || 0].name} ${WEAPONS[alt[0]].name}` : '');
    el.reload.style.display = me.rl >= 0 ? 'block' : 'none';
    if (me.rl >= 0) this.bar('rl', el.reloadFill, me.rl, dt);
    else this.bars.rl = null;
    // XP
    this.set('xpl', el.xpLvl, 'Lv ' + me.rk);
    el.xpFill.style.width = Math.min(100, (me.xp / me.xpn) * 100) + '%';
    const boonHtml = Object.entries(me.bo || {}).map(([id, n]) => `<span class="boon" style="--c:${BOONS[id].color}" title="${BOONS[id].name}: ${BOONS[id].desc}">${BOONS[id].icon}${n > 1 ? '<b>' + n + '</b>' : ''}</span>`).join('');
    this.set('boons', el.xpBoons, boonHtml, 'innerHTML');
    // level-up cards
    const showLu = !!me.chs && me.s !== 2;
    el.levelup.classList.toggle('show', showLu);
    if (showLu) {
      this.set('lum', el.luMore, me.nch > 1 ? `(+${me.nch - 1} more)` : '');
      // rebuild the cards only when the offer (or a level on it) changes, not every frame
      const have = (id) => (me.bo && me.bo[id]) || 0;
      const key = me.chs.map((id) => id + have(id)).join(',');
      if (key !== this.luKey) {
        this.luKey = key;
        el.luCards.innerHTML = me.chs.map((id, i) => {
          const b = BOONS[id];
          const lvl = b.max > 1 ? ` <span>· level ${have(id) + 1} of ${b.max}</span>` : '';
          return `<div class="lu-card" data-pick="${i + 1}" style="--c:${b.color}"><div class="lu-key">${i + 1}</div><div class="lu-name">${b.icon} ${b.name}${lvl}</div><div class="lu-desc">${b.desc}</div></div>`;
        }).join('');
      }
    }
    // prompt
    const showPrompt = !!me.pr && me.s === 0;
    el.prompt.classList.toggle('show', showPrompt);
    if (showPrompt) {
      // sim prompts say [E]; show the player's interact key instead (only re-done when the text changes)
      if (me.pr !== this.rawPr) {
        this.rawPr = me.pr;
        this.pr = this.keys.use === 'E' ? me.pr : me.pr.replaceAll('[E]', `[${this.keys.use}]`);
      }
      this.set('pr', el.promptText, this.pr);
      el.promptBar.style.display = me.pp >= 0 ? 'block' : 'none';
      if (me.pp >= 0) this.bar('pp', el.promptFill, Math.min(1, me.pp), dt);
      else this.bars.pp = null;
    }
    this.hurtT = Math.max(0, this.hurtT - dt * 2);
    el.vignette.style.opacity = Math.max(this.hurtT * 0.8, hpf < 0.4 ? (0.4 - hpf) * 1.6 : 0);
    el.down.classList.toggle('show', me.s !== 0);
    if (me.s === 1 && snap.P.length === 1) this.set('down', el.downSub, `Second Wind — getting back up in ${Math.ceil(me.bl)}s`);
    else if (me.s === 1) this.set('down', el.downSub, `Bleeding out: ${Math.ceil(me.bl)}s — a teammate can revive you${me.rv > 0 ? ' (' + Math.round(me.rv * 100) + '%)' : ''}`);
    else if (me.s === 2) this.set('down', el.downSub, 'You will respawn at the start of the next round');
    el.down.querySelector('.down-title').textContent = me.s === 2 ? 'YOU DIED' : 'YOU ARE DOWN';
    el.score.classList.toggle('show', this.showScore);
    if (this.showScore) {
      const rows = snap.P.map((p) => `<tr><td>${esc(p.n)}</td><td>${CHARACTERS[p.c].name}</td><td>${p.rk}</td><td>${p.pts}</td><td>${p.k}</td><td>${p.dn}</td><td>${p.rvs}</td></tr>`).join('');
      this.set('sb', el.score, `<table><tr><th>Survivor</th><th>Character</th><th>Level</th><th>Points</th><th>Kills</th><th>Downs</th><th>Revives</th></tr>${rows}</table>`, 'innerHTML');
    }
    // the maps do not need 60 updates a second: minimap every 2nd frame, big map every 3rd while open
    const frame = (this.mmFrame = (this.mmFrame || 0) + 1);
    if (frame % 2 === 0) this.drawMap(el.minimap, snap, me, false);
    if (this.showMap !== this.mapShown) {
      this.mapShown = this.showMap;
      el.bigmap.classList.toggle('show', this.showMap);
      if (this.showMap) this.drawMap(el.bigmapCv, snap, me, true);
    } else if (this.showMap && frame % 3 === 0) this.drawMap(el.bigmapCv, snap, me, true);
  }

  // Minimap (round, 64 units around the player, off-view marks pinned to the edge) or, with
  // `full`, the whole map on the pre-rendered bigMapImg.
  drawMap(cv, snap, me, full) {
    const g = cv.getContext('2d');
    const size = cv.width, sizeH = cv.height;
    let scale, cx, cz;
    g.clearRect(0, 0, size, sizeH);
    g.save();
    if (full) {
      scale = size / this.world.W;
      cx = this.world.W / 2;
      cz = this.world.H / 2;
      g.drawImage(this.bigMapImg, 0, 0);
    } else {
      const view = 64, S = this.mapS;
      scale = size / view;
      cx = me.x;
      cz = me.z;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = '#2a2420';
      g.fillRect(0, 0, size, size);
      g.drawImage(this.mapImg, (cx - view / 2) * S, (cz - view / 2) * S, view * S, view * S, 0, 0, size, size);
    }
    const toMap = (x, z) => [(x - cx) * scale + size / 2, (z - cz) * scale + sizeH / 2];
    const dot = (x, z, r, color, ring) => {
      const [px, pz] = toMap(x, z);
      g.fillStyle = color;
      g.beginPath();
      g.arc(px, pz, r, 0, Math.PI * 2);
      g.fill();
      if (ring) {
        g.strokeStyle = 'rgba(30,20,20,0.8)';
        g.lineWidth = 1.5;
        g.stroke();
      }
    };
    const bs = this.world.spots.box[snap.B[0]];
    if (bs) {
      dot(bs.x, bs.z, 4.5, '#6fb8ff', true);
      if (full) this.mapText(g, 'Mystery Box', ...toMap(bs.x, bs.z), '#a8d4ff');
    }
    this.world.spots.loot.forEach((l, i) => {
      if (snap.C[i] && snap.C[i][0]) dot(l.x, l.z, 2.2, l.kind === 'chest' ? '#ffd65a' : '#f4e2b8');
    });
    for (const it of snap.I) {
      const [, kind, x, z, , rar] = it;
      dot(x, z, kind === 'weapon' ? 3 : 3.5, kind === 'weapon' ? RARITY[rar].color : kind === 'power' ? '#7aff7a' : kind === 'item' || kind === 'supply' ? '#ffd65a' : '#c8ffb0', true);
    }
    for (const z of snap.Z) if (z[6] !== 0) dot(z[2], z[3], 2.4, '#ff4a3a');
    if (snap.O.zone) {
      const [px, pz] = toMap(snap.O.zone[0], snap.O.zone[1]);
      g.strokeStyle = '#6ac8ff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, pz, snap.O.zone[2] * scale, 0, Math.PI * 2);
      g.stroke();
    }
    for (const p of snap.P) if (p.s !== 2) dot(p.x, p.z, 4, p.id === me.id ? '#7aff9a' : p.s === 1 ? '#ff5a4a' : '#6ab4ff', true);
    g.restore();
    const marks = snap.O.mk.slice();
    if (snap.O.zone) marks.push([snap.O.zone[0], snap.O.zone[1], 3]);
    // downed teammates: flashing, and pinned to the edge when off the map view
    for (const p of snap.P) if (p.s === 1 && p.id !== me.id) marks.push([p.x, p.z, 4]);
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const m of marks) {
      let [px, pz] = toMap(m[0], m[1]);
      const dx = px - size / 2, dz = pz - size / 2;
      const d = Math.hypot(dx, dz);
      const maxR = size / 2 - 9;
      const edge = !full && d > maxR;
      if (edge) {
        px = size / 2 + (dx / d) * maxR;
        pz = size / 2 + (dz / d) * maxR;
      }
      g.fillStyle = m[2] === 4 ? (blink ? '#ff2a1a' : '#ffffff') : m[2] === 2 ? '#ff4a3a' : m[2] === 3 ? '#6ac8ff' : '#ffd65a';
      g.strokeStyle = '#2a1e1a';
      g.lineWidth = 2;
      g.beginPath();
      if (edge) {
        const a = Math.atan2(dz, dx);
        g.moveTo(px + Math.cos(a) * 8, pz + Math.sin(a) * 8);
        g.lineTo(px + Math.cos(a + 2.4) * 7, pz + Math.sin(a + 2.4) * 7);
        g.lineTo(px + Math.cos(a - 2.4) * 7, pz + Math.sin(a - 2.4) * 7);
      } else if (m[2] === 4) {
        // pulsing ring with a cross
        g.arc(px, pz, blink ? 10 : 7, 0, Math.PI * 2);
        g.lineWidth = 3;
        g.strokeStyle = '#ff2a1a';
        g.stroke();
        g.beginPath();
        g.rect(px - 1.5, pz - 5, 3, 10);
        g.rect(px - 5, pz - 1.5, 10, 3);
        g.strokeStyle = '#2a1e1a';
        g.lineWidth = 2;
      } else {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 3 : 7;
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          g.lineTo(px + Math.cos(a) * r, pz + Math.sin(a) * r);
        }
      }
      g.closePath();
      g.stroke();
      g.fill();
    }
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
