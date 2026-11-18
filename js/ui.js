// Menus, réglages (dont le clavier), HUD et mini-carte
import { BUS_TYPES, VEHICLES, Bus } from './bus.js';
import { hexA } from './render.js';
import { clamp } from './geom.js';
import { FEASIBILITY } from './feasibility.js';
import { CHALLENGES } from './challenges.js';
import { KEY_ACTIONS, defaultKeys, keyLabel, rememberLabel } from './controls.js';

const SETTINGS = [
  { key: 'wheelTurns', label: 'Rotation du volant', help: 'De la position droite jusqu’en butée', opts: [[0.75, '±270°'], [1.25, '±450°'], [1.5, '±540°'], [2, '±720°']] },
  { key: 'wheelGain', label: 'Sensibilité du volant', help: 'Rapport entre le geste du doigt et le volant', opts: [[0.75, 'Fine'], [1, 'Normale'], [1.5, 'Rapide']] },
  { key: 'autoCenter', label: 'Retour du volant', help: 'Revient au centre en roulant quand on le lâche', opts: [[true, 'Oui'], [false, 'Non']] },
  { key: 'northUp', label: 'Caméra', opts: [[false, 'Suit le bus'], [true, 'Nord en haut']] },
  { key: 'autoZoom', label: 'Zoom selon la vitesse', opts: [[true, 'Oui'], [false, 'Non']] },
  { key: 'guide', label: 'Tracé de l’itinéraire', opts: [[true, 'Oui'], [false, 'Non']] },
  { key: 'predict', label: 'Aide trajectoire', help: 'Balayage des coins et de la roue arrière', opts: [[true, 'Oui'], [false, 'Non']] },
  { key: 'traffic', label: 'Circulation', opts: [[true, 'Oui'], [false, 'Non']] },
  { key: 'volume', label: 'Volume', range: [0, 1, 0.05] },
];

const ARROWS = {
  S: 'M20 34 L20 8 M12 16 L20 8 L28 16',
  R: 'M13 34 L13 21 Q13 14 20 14 L31 14 M25 8 L31 14 L25 20',
  L: 'M27 34 L27 21 Q27 14 20 14 L9 14 M15 8 L9 14 L15 20',
  U: 'M26 34 L26 16 Q26 8 19 8 Q12 8 12 16 L12 24 M7 19 L12 24 L17 19',
  O: 'M20 35 L20 27 M14.5 21.5 A7 7 0 1 1 25 25 M25 25 L32 18 M27 17 L32 18 L31 23',
};
const SCREENS = ['title', 'lines', 'bus', 'challenges', 'pause', 'results', 'settings', 'help'];

export class UI {
  constructor(game) {
    this.g = game;
    this.$ = (id) => document.getElementById(id);
    this.cur = 'title';
    this.prev = 'title';
    this.c = {};
    this.mmCtx = this.$('minimap').getContext('2d');
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', (e) => { e.preventDefault(); this.g.sound.ui(); this.go(b.dataset.go); });
    });
    this.$('btn-vehicle').addEventListener('click', (e) => { e.preventDefault(); this.g.openVehicles(); });
    this.$('keys-reset').addEventListener('click', () => {
      this.g.settings.keys = defaultKeys(); this.g.saveSettings(); this.buildKeys(); this.g.sound.ui();
    });
    this.buildSettings();
    if (window.navigator.standalone || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) {
      this.$('install-hint').classList.add('hidden');
    }
  }

  go(where) {
    const g = this.g;
    g.sound.unlock();
    switch (where) {
      case 'lines': if (g.inGame) g.toMenu(); this.buildLines(); this.show('lines'); break;
      case 'challenges': if (g.inGame) g.toMenu(); this.buildChallenges(); this.show('challenges'); break;
      case 'free': if (g.inGame) g.toMenu(); this.buildVehicles('start'); this.show('bus'); break;
      case 'vehicle': this.buildVehicles('switch'); this.show('bus'); break;
      case 'settings': this.prev = this.cur; this.buildSettings(); this.show('settings'); break;
      case 'help': this.prev = this.cur; this.show('help'); break;
      case 'back': this.show(this.prev === 'settings' || this.prev === 'help' ? 'title' : this.prev); break;
      case 'title': this.show('title'); break;
      case 'resume': g.resume(); break;
      case 'restart': g.restart(); break;
      case 'quit': g.quit(); break;
      default: this.show(where);
    }
  }

  show(name) {
    for (const id of SCREENS) this.$('scr-' + id).classList.toggle('hidden', id !== name);
    const play = name === 'play' || name === 'pause' || name === 'results' || ((name === 'settings' || name === 'help' || name === 'bus') && this.g.state === 'pause');
    this.$('hud').classList.toggle('hidden', !play);
    this.$('controls').classList.toggle('hidden', name !== 'play');
    this.$('pause-vehicle').classList.toggle('hidden', !(this.g.mission && this.g.mission.free));
    this.cur = name;
  }

  hideLoading() { this.$('loading').classList.add('hidden'); }

  buildLines() {
    const g = this.g, list = this.$('line-list');
    list.innerHTML = '';
    const best = g.best();
    for (const L of g.worlds.city.lines) {
      const d = L.def;
      const card = document.createElement('button');
      card.className = 'card';
      const km = (L.path.len / 1000).toFixed(2).replace('.', ',');
      const bests = Object.values(BUS_TYPES).map((T) => best[d.id + ':' + T.id]).filter((v) => v != null);
      const top = bests.length ? Math.max(...bests) : null;
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center">
          <div class="lnum" style="background:${d.color}">${d.id}</div>
          <div><div class="lvl">${'★'.repeat(d.level)}<span style="opacity:.25">${'★'.repeat(5 - d.level)}</span></div></div>
        </div>
        <h3>${d.name}</h3>
        <p>${d.desc}</p>
        <div class="meta"><span>${km} km</span><span>${L.stops.length} arrêts</span><span>Bus conseillé : ${d.bus} m</span></div>
        <div class="best">${top != null ? `Meilleur score : <b>${top}</b>` : 'Pas encore jouée'}</div>`;
      card.addEventListener('click', () => { g.sound.ui(); this.buildBuses(L); this.show('bus'); });
      list.appendChild(card);
    }
  }

  vehicleCard(T, color, extraTag = '', extraBest = '') {
    const card = document.createElement('button');
    card.className = 'card bus';
    const semi = T.kind === 'semi';
    card.innerHTML = `
      ${extraTag}
      <h3>${T.label} — ${T.name}</h3>
      <canvas width="500" height="128"></canvas>
      <div class="specs">
        <span>Longueur</span><span>${fmt(T.len)} m · ${T.axlesDesc}</span>
        <span>Empattement</span><span>${fmt(T.wb)} m${semi ? ` · remorque ${fmt(T.artic.l2)} m` : ''}</span>
        <span>Porte-à-faux</span><span>${semi ? `arrière de remorque ${fmt(T.artic.ro2)} m` : `avant ${fmt(T.fo)} m · arrière ${fmt(T.tag ? T.ro - T.tag : T.ro)} m`}</span>
        <span>Braquage</span><span>Ø ${fmt(T.turnCircle)} m entre murs${semi ? ' (tracteur)' : ''}</span>
        <span>${semi ? 'Masse' : 'Capacité'}</span><span>${semi ? `${Math.round(T.mass / 1000)} t à vide` : `${T.cap} voyageurs`}</span>
      </div>
      <div class="best">${extraBest}</div>`;
    this.drawBusPreview(card.querySelector('canvas'), T, color);
    return card;
  }

  buildBuses(L) {
    const g = this.g, list = this.$('bus-list');
    this.$('bus-title').textContent = `Ligne ${L.def.id} — choisissez votre bus`;
    this.$('scr-bus').querySelector('.back').dataset.go = 'lines';
    list.innerHTML = '';
    const best = g.best();
    for (const T of Object.values(BUS_TYPES)) {
      const feas = FEASIBILITY[L.def.id + ':' + T.id] ?? 2;
      const b = best[L.def.id + ':' + T.id];
      const tag = feas === 0 ? '<span class="tag no">GABARIT INTERDIT</span>' : T.id === L.def.bus ? '<span class="tag">CONSEILLÉ</span>' : feas === 1 ? '<span class="tag warn">AU CENTIMÈTRE</span>' : '';
      const card = this.vehicleCard(T, L.def.color, tag, feas === 0 ? 'Ce bus ne peut pas franchir les ruelles de cette ligne.' : b != null ? `Meilleur score : <b>${b}</b>` : '');
      if (T.id === L.def.bus) card.classList.add('reco');
      if (feas === 0) card.classList.add('locked');
      card.addEventListener('click', () => {
        if (feas === 0) { g.sound.error(); return; }
        g.sound.ui(); g.startLine(L, T);
      });
      list.appendChild(card);
    }
  }

  // conduite libre : choix du véhicule (au départ ou en cours de route)
  buildVehicles(mode) {
    const g = this.g, list = this.$('bus-list');
    this.$('bus-title').textContent = mode === 'start' ? 'Conduite libre — choisissez un véhicule' : 'Changer de véhicule';
    this.$('scr-bus').querySelector('.back').dataset.go = mode === 'start' ? 'title' : 'pause';
    list.innerHTML = '';
    for (const T of Object.values(VEHICLES)) {
      const cur = mode === 'switch' && g.bus && g.bus.T === T;
      const card = this.vehicleCard(T, T.color || '#e53935', cur ? '<span class="tag">ACTUEL</span>' : T.kind === 'semi' ? '<span class="tag warn">POIDS LOURD</span>' : '', mode === 'switch' ? 'Le véhicule apparaît à la place du vôtre (arrêtez-vous dans une rue assez large).' : '');
      card.addEventListener('click', () => {
        g.sound.ui();
        if (mode === 'start') g.startFree(T);
        else g.swapVehicle(T);
      });
      list.appendChild(card);
    }
    if (mode === 'switch') {
      const card = document.createElement('button');
      card.className = 'card';
      card.innerHTML = '<h3>Retour au dépôt</h3><p>Repartir de la gare avec le véhicule actuel, sans dégâts.</p>';
      card.addEventListener('click', () => { g.sound.ui(); g.respawnFree(); });
      list.appendChild(card);
    }
  }

  buildChallenges() {
    const g = this.g, list = this.$('chal-list');
    list.innerHTML = '';
    const best = g.best();
    for (const d of CHALLENGES) {
      const T = VEHICLES[d.vehicle];
      const b = best['D:' + d.id];
      const card = document.createElement('button');
      card.className = 'card';
      const stars = b ? b.stars : 0;
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center">
          <div class="lnum" style="background:${d.color}">${d.badge}</div>
          <div><div class="world">${d.world === 'city' ? 'En ville' : 'Centre de formation'}</div><div class="lvl">${'★'.repeat(d.level)}<span style="opacity:.25">${'★'.repeat(5 - d.level)}</span></div></div>
        </div>
        <h3>${d.name}</h3>
        <p>${d.desc}</p>
        <div class="meta"><span>${T.label} ${T.kind === 'semi' ? 'semi' : 'bus'}</span>${d.target ? '<span>stationnement</span>' : '<span>parcours</span>'}${d.traffic ? '<span>circulation</span>' : ''}</div>
        <div class="best">${b ? `<span class="stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('')}</span> <b>${b.total}</b> · ${mmss(b.time)}` : 'Pas encore réussi'}</div>`;
      card.addEventListener('click', () => { g.sound.ui(); g.startChallenge(d); });
      list.appendChild(card);
    }
  }

  drawBusPreview(cv, T, color) {
    const x = cv.getContext('2d');
    const bus = new Bus(T, { x: 0, y: 0, th: 0 });
    const sc = 24;
    const mid = (T.wb + T.fo - T.behind) / 2;
    x.setTransform(sc, 0, 0, sc, cv.width / 2 - mid * sc, cv.height / 2);
    this.g.R.drawBus(x, bus, color, '', 0);
  }

  buildSettings() {
    const g = this.g, box = this.$('settings-list');
    box.innerHTML = '';
    for (const s of SETTINGS) {
      const row = document.createElement('div');
      row.className = 'set';
      row.innerHTML = `<label>${s.label}${s.help ? `<small>${s.help}</small>` : ''}</label>`;
      if (s.range) {
        const r = document.createElement('input');
        r.type = 'range'; r.min = s.range[0]; r.max = s.range[1]; r.step = s.range[2]; r.value = g.settings[s.key];
        r.addEventListener('input', () => { g.settings[s.key] = parseFloat(r.value); g.saveSettings(); });
        row.appendChild(r);
      } else {
        const seg = document.createElement('div');
        seg.className = 'seg';
        for (const [v, lab] of s.opts) {
          const b = document.createElement('button');
          b.textContent = lab;
          if (g.settings[s.key] === v) b.classList.add('on');
          b.addEventListener('click', () => {
            g.settings[s.key] = v; g.saveSettings(); g.sound.ui();
            seg.querySelectorAll('button').forEach((q) => q.classList.remove('on'));
            b.classList.add('on');
          });
          seg.appendChild(b);
        }
        row.appendChild(seg);
      }
      box.appendChild(row);
    }
    this.buildKeys();
  }

  // réaffectation des touches : une case = une touche physique
  buildKeys() {
    const g = this.g, box = this.$('keys-list');
    box.innerHTML = '';
    const keys = g.settings.keys;
    for (const [act, label] of KEY_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'keyrow';
      row.innerHTML = `<span>${label}</span>`;
      for (let slot = 0; slot < 2; slot++) {
        const b = document.createElement('button');
        b.textContent = keyLabel(keys[act][slot]);
        b.addEventListener('click', () => this.captureKey(act, slot, b));
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }

  captureKey(act, slot, btn) {
    const g = this.g;
    if (this.capturing) this.capturing.cancel();
    btn.classList.add('wait');
    btn.textContent = '…';
    g.controls.capture = true;
    const done = () => {
      window.removeEventListener('keydown', onKey, true);
      g.controls.capture = false;
      this.capturing = null;
      this.buildKeys();
    };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      rememberLabel(e);
      const keys = g.settings.keys;
      if (e.code === 'Escape') { done(); return; }
      if (e.code === 'Backspace' || e.code === 'Delete') keys[act][slot] = '';
      else {
        // une touche ne commande qu'une seule action
        for (const a of Object.keys(keys)) keys[a] = keys[a].map((c) => (c === e.code ? '' : c));
        keys[act][slot] = e.code;
      }
      g.settings.keys = { ...keys };
      g.saveSettings();
      g.sound.ui();
      done();
    };
    window.addEventListener('keydown', onKey, true);
    this.capturing = { cancel: done };
  }

  set(id, prop, val) {
    const k = id + '.' + prop;
    if (this.c[k] === val) return;
    this.c[k] = val;
    const el = this.$(id);
    if (prop === 'text') el.textContent = val;
    else if (prop === 'class') el.className = val;
    else if (prop === 'hidden') el.classList.toggle('hidden', val);
    else if (prop.startsWith('style.')) el.style[prop.slice(6)] = val;
    else el.setAttribute(prop, val);
  }

  hud(S) {
    const { bus, mission: m } = S;
    const L = m.line;
    const chal = m.kind === 'challenge';
    const isBus = bus.T.kind === 'bus';
    this.set('lb-num', 'text', m.free ? '–' : L.def.id);
    this.set('lb-num', 'style.background', m.free ? '#546e7a' : L.def.color);
    this.set('lb-dest', 'text', m.free ? 'Conduite libre' : L.def.to);
    this.set('btn-vehicle', 'hidden', !m.free);
    this.set('btn-doors', 'hidden', !isBus);
    this.set('pax', 'hidden', !isBus || m.free || chal);
    // carte arrêt / défi
    this.set('stop-card', 'hidden', m.free);
    if (chal) {
      this.set('sc-label', 'text', `Défi ${m.def.badge}`);
      this.set('sc-name', 'text', m.def.name);
      this.set('sc-delta', 'text', `${mmss(m.time)} / ${mmss(m.par)}`);
      this.set('sc-delta', 'class', m.time <= m.par ? 'ok' : 'late');
      let info;
      if (m.target) {
        const e = m.err;
        info = !e ? '' : e.ok ? (m.hold > 0 ? 'Immobilisez-vous…' : 'Dans la place !') : e.dist > 25 ? `Place à ${Math.round(e.dist)} m` : `Écart ${fmtCm(e.lat)} · ${fmtCm(e.along)} · ${e.ang.toFixed(1).replace('.', ',')}°`;
      } else info = `Parcours ${Math.round(clamp(m.s / m.finishS, 0, 1) * 100)} %`;
      this.set('sc-dist', 'text', info);
      const n = m.sc.collisions + m.sc.scrapes + m.sc.cones + m.sc.knocked + m.sc.mirrors;
      this.set('sc-wait', 'text', n ? `${n} touche${n > 1 ? 's' : ''}` : 'sans faute');
      this.set('sc-req', 'class', '');
    } else if (!m.free) {
      const k = m.stopIdx, Sx = m.stopAt(k);
      if (Sx) {
        const last = k === L.stops.length - 1;
        this.set('sc-label', 'text', k === 0 ? 'Terminus de départ' : last ? 'Terminus' : 'Prochain arrêt');
        this.set('sc-name', 'text', Sx.st.name);
        let delta = 0, dtxt = '';
        if (k === 0) {
          const r = m.schedule[0] - m.time;
          dtxt = r > 0 ? `départ ${mmss(r)}` : `retard ${mmss(-r)}`;
          this.set('sc-delta', 'class', r > 0 ? 'ok' : 'late');
        } else {
          const dep = m.schedule[k - 1] + (k - 1 > 0 ? 18 : 0);
          const p0 = L.stops[k - 1].s, p1 = Sx.s;
          const fr = clamp((m.s - m.T.doorDist[0] - p0) / Math.max(1, p1 - p0), 0, 1);
          delta = m.time - (dep + (m.schedule[k] - dep) * fr);
          dtxt = Math.abs(delta) < 15 ? 'à l’heure' : (delta > 0 ? '+' : '−') + mmss(Math.abs(delta));
          this.set('sc-delta', 'class', Math.abs(delta) < 15 ? 'ok' : delta > 0 ? 'late' : 'early');
        }
        this.set('sc-delta', 'text', dtxt);
        const d = m.distToStop ?? 0;
        this.set('sc-dist', 'text', m.exchange ? (m.exchange.done ? 'Fermez les portes' : 'Échange voyageurs…') : d > 4 ? `${Math.round(d)} m` : d > -4 ? 'à quai' : 'dépassé');
        const w = m.waiting[k];
        this.set('sc-wait', 'text', w > 0 ? `${w} en attente` : 'personne n’attend');
        this.set('sc-req', 'class', m.requested ? 'on' : '');
      }
    }
    // navigation
    const nm = m.free ? null : m.nextManeuver();
    const showNav = nm && nm.dist < 230 && !(m.exchange);
    this.set('nav', 'hidden', !showNav);
    if (showNav) {
      this.set('nav-path', 'd', ARROWS[nm.turn] || ARROWS.S);
      this.set('nav-dist', 'text', nm.dist > 8 ? `${Math.round(nm.dist / 5) * 5} m` : 'Maintenant');
      const t = nm.turn === 'O' ? `Giratoire, ${nm.exit === 1 ? '1re' : nm.exit + 'e'} sortie` : nm.turn === 'L' ? 'À gauche' : nm.turn === 'R' ? 'À droite' : nm.turn === 'U' ? 'Demi-tour' : 'Tout droit';
      this.set('nav-text', 'text', `${t} · ${nm.street}`);
    }
    this.set('street', 'text', m.street || '—');
    // tableau de bord
    const kmh = Math.round(bus.kmh);
    this.set('spd-v', 'text', String(kmh));
    this.set('limit-v', 'text', String(m.speedLimit));
    this.set('limit', 'class', bus.kmh > m.speedLimit + 4 ? 'over' : '');
    this.set('pax-v', 'text', `${m.onboard.length}/${bus.T.cap}`);
    const cf = clamp(m.sc.comfort, 0, 100);
    this.set('comfort-bar', 'style.transform', `scaleX(${(cf / 100).toFixed(2)})`);
    this.set('comfort-bar', 'style.background', m.discomfort > 0.2 ? '#ff4d4f' : cf > 70 ? '#3ddc84' : cf > 40 ? '#ffb300' : '#ff4d4f');
    const dmg = Math.round(bus.damage);
    this.set('dmg-v', 'text', `${dmg} %`);
    this.set('dmg', 'class', dmg >= 60 ? 'high' : dmg >= 25 ? 'mid' : '');
    this.set('gear-ind', 'text', bus.gear);
    this.set('gear-ind', 'class', bus.gear);
    for (const gname of ['D', 'N', 'R']) this.set('gear-' + gname, 'class', bus.gear === gname ? 'on' : '');
    if (isBus) this.set('btn-doors', 'class', bus.doorOpen ? 'open' : '');
    this.set('door-ind', 'hidden', bus.doors <= 0);
    const fl = bus.blink && bus.blinkT % 0.7 < 0.38 ? ' flash' : '';
    this.set('blink-l', 'class', 'blink' + (bus.blink < 0 ? ' on' + fl : ''));
    this.set('blink-r', 'class', 'blink' + (bus.blink > 0 ? ' on' + fl : ''));
    // messages
    const key = m.msgs.map((q) => q.text).join('|');
    if (key !== this.c.msgs) {
      this.c.msgs = key;
      const box = this.$('msgs');
      box.innerHTML = '';
      for (const q of m.msgs.slice(-3)) {
        const d = document.createElement('div');
        d.className = 'msg ' + q.kind;
        d.textContent = q.text;
        box.appendChild(d);
      }
    }
  }

  minimap(S) {
    const { bus, mission: m, mm, cam } = S;
    const cv = this.$('minimap');
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = this.mmCtx;
    const sc = 0.62;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#1d2127'; x.fillRect(0, 0, cv.width, cv.height);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.translate(w / 2, h / 2 + 10);
    x.rotate(-(cam.ang + Math.PI / 2));
    x.scale(sc, sc);
    const c = bus.center;
    x.translate(-c.x, -c.y);
    x.drawImage(mm.img, 0, 0, mm.img.width / mm.scale, mm.img.height / mm.scale);
    const P = m.line.path;
    if (!m.free && P) {
      x.strokeStyle = hexA(m.line.color, 0.9);
      x.lineWidth = 4; x.lineJoin = 'round'; x.lineCap = 'round';
      x.beginPath();
      const pts = P.pts;
      x.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 2) x.lineTo(pts[i].x, pts[i].y);
      x.stroke();
      m.line.stops.forEach((s, k) => {
        x.fillStyle = k < m.stopIdx ? '#78909c' : k === m.stopIdx ? '#ffd600' : '#fff';
        x.beginPath(); x.arc(s.st.pole.x, s.st.pole.y, k === m.stopIdx ? 6 : 4, 0, Math.PI * 2); x.fill();
      });
    }
    if (m.target) {
      x.fillStyle = '#ffd600';
      x.beginPath(); x.arc(m.target.x, m.target.y, 6, 0, Math.PI * 2); x.fill();
    }
    x.save();
    x.translate(c.x, c.y); x.rotate(bus.th);
    x.fillStyle = '#ff9800';
    x.beginPath(); x.moveTo(10, 0); x.lineTo(-7, -6); x.lineTo(-4, 0); x.lineTo(-7, 6); x.closePath(); x.fill();
    x.restore();
  }

  results(res, m, T) {
    const sc = m.sc;
    const bar = ([n, v]) => `<div class="rb"><b>${v}</b><small>${n}</small><i><em style="width:${v}%;background:${v > 70 ? '#3ddc84' : v > 40 ? '#ffb300' : '#ff4d4f'}"></em></i></div>`;
    const common = [
      ['Collisions', sc.collisions], ['Accrochages / frottements', sc.scrapes], ['Roues sur trottoir', sc.curbs],
      ['Mobilier renversé', sc.knocked], ['Voitures percutées', sc.cars], ['Rétroviseurs cassés', sc.mirrors],
      ['Dégâts du véhicule', `${Math.round(sc.damage)} %`],
    ];
    let det;
    if (m.kind === 'challenge') {
      this.$('res-title').textContent = `Défi ${m.def.badge} — ${m.def.name}`;
      this.$('res-total').innerHTML = res.failed
        ? '<b>Échec</b> · véhicule hors d’usage'
        : `<b>${res.total}</b> / 100 · ${T.label} · ${mmss(res.time)} (objectif ${mmss(res.par)})${res.best ? ' · <span style="color:var(--accent)">nouveau record !</span>' : ''}`;
      this.$('res-bars').innerHTML = [['Sécurité', res.safety], ['Temps', res.timeScore], [m.target ? 'Précision' : 'Confort', res.precision], ['État du véhicule', 100 - res.damage]].map(bar).join('');
      det = [...common, ['Plots renversés', sc.cones], ['Feux rouges', sc.red]];
      if (m.target && m.err) det.push(['Écart latéral final', fmtCm(m.err.lat)], ['Angle final', `${m.err.ang.toFixed(1).replace('.', ',')}°`]);
    } else {
      this.$('res-title').textContent = m.free ? 'Fin de la conduite libre' : `Ligne ${m.line.def.id} — ${m.line.def.name}`;
      this.$('res-total').innerHTML = `${m.wrecked ? '<b>Véhicule hors d’usage</b> · ' : ''}<b>${res.total}</b> / 100 · ${T.label} · ${mmss(res.time)}${res.best ? ' · <span style="color:var(--accent)">nouveau record !</span>' : ''}`;
      this.$('res-bars').innerHTML = [['Sécurité', res.safety], ['Service', res.service], ['Ponctualité', res.punct], ['Confort', res.comfort]].map(bar).join('');
      const avgP = sc.punct.length ? sc.punct.reduce((a, b) => a + b, 0) / sc.punct.length : 0;
      det = [...common, ['Feux rouges', sc.red], ['Excès de vitesse', `${Math.round(sc.speeding)} s`], ['Arrêts manqués', sc.missed],
        ['Portes hors arrêt', sc.doorsOut], ['Clignotant oublié', sc.noBlink || 0], ['Écart horaire moyen', `${avgP >= 0 ? '+' : '−'}${mmss(Math.abs(avgP))}`],
        ['Accostage moyen', sc.dock.length ? Math.round(sc.dock.reduce((a, b) => a + b, 0) / sc.dock.length) + ' %' : '—']];
    }
    this.$('res-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < res.stars ? '' : 'off'}">★</span>`).join('');
    this.$('res-details').innerHTML = det.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  }
}

function fmt(v) { return v.toFixed(2).replace(/0$/, '').replace('.', ','); }
function fmtCm(v) { return `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} cm`; }
export function mmss(t) {
  t = Math.max(0, Math.round(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
