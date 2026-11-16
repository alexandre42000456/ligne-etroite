// Menus, réglages, HUD et mini-carte
import { BUS_TYPES, Bus } from './bus.js';
import { hexA } from './render.js';
import { clamp } from './geom.js';
import { FEASIBILITY } from './feasibility.js';

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
      case 'free': g.startFree(); break;
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
    const ids = ['title', 'lines', 'bus', 'pause', 'results', 'settings', 'help'];
    for (const id of ids) this.$('scr-' + id).classList.toggle('hidden', id !== name);
    const play = name === 'play' || name === 'pause' || name === 'results' || ((name === 'settings' || name === 'help') && this.g.inGame);
    this.$('hud').classList.toggle('hidden', !play);
    this.$('controls').classList.toggle('hidden', name !== 'play');
    this.cur = name;
  }

  hideLoading() { this.$('loading').classList.add('hidden'); }

  buildLines() {
    const g = this.g, list = this.$('line-list');
    list.innerHTML = '';
    const best = g.best();
    for (const L of g.world.lines) {
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

  buildBuses(L) {
    const g = this.g, list = this.$('bus-list');
    this.$('bus-title').textContent = `Ligne ${L.def.id} — choisissez votre bus`;
    list.innerHTML = '';
    const best = g.best();
    for (const T of Object.values(BUS_TYPES)) {
      const card = document.createElement('button');
      const feas = FEASIBILITY[L.def.id + ':' + T.id] ?? 2;
      card.className = 'card bus' + (T.id === L.def.bus ? ' reco' : '') + (feas === 0 ? ' locked' : '');
      const b = best[L.def.id + ':' + T.id];
      const tag = feas === 0 ? '<span class="tag no">GABARIT INTERDIT</span>' : T.id === L.def.bus ? '<span class="tag">CONSEILLÉ</span>' : feas === 1 ? '<span class="tag warn">AU CENTIMÈTRE</span>' : '';
      card.innerHTML = `
        ${tag}
        <h3>${T.label} — ${T.name}</h3>
        <canvas width="500" height="128"></canvas>
        <div class="specs">
          <span>Longueur</span><span>${fmt(T.len)} m · ${T.axlesDesc}</span>
          <span>Empattement</span><span>${fmt(T.wb)} m</span>
          <span>Porte-à-faux</span><span>avant ${fmt(T.fo)} m · arrière ${fmt(T.tag ? T.ro - T.tag : T.ro)} m</span>
          <span>Braquage</span><span>Ø ${fmt(T.turnCircle)} m entre murs</span>
          <span>Capacité</span><span>${T.cap} voyageurs</span>
        </div>
        <div class="best">${feas === 0 ? 'Ce bus ne peut pas franchir les ruelles de cette ligne.' : b != null ? `Meilleur score : <b>${b}</b>` : ''}</div>`;
      card.addEventListener('click', () => {
        if (feas === 0) { g.sound.error(); return; }
        g.sound.ui(); g.startLine(L, T);
      });
      list.appendChild(card);
      this.drawBusPreview(card.querySelector('canvas'), T, L.def.color);
    }
  }

  drawBusPreview(cv, T, color) {
    const x = cv.getContext('2d');
    const bus = new Bus(T, { x: 0, y: 0, th: 0 });
    const sc = 24;
    x.setTransform(sc, 0, 0, sc, cv.width / 2 - ((T.wb + T.fo - (T.len - T.fo - T.wb)) / 2) * sc, cv.height / 2);
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
    const { bus, mission: m, settings, controls } = S;
    const L = m.line;
    this.set('lb-num', 'text', m.free ? '–' : L.def.id);
    this.set('lb-num', 'style.background', m.free ? '#546e7a' : L.def.color);
    this.set('lb-dest', 'text', m.free ? 'Conduite libre' : L.def.to);
    // carte arrêt
    this.set('stop-card', 'hidden', m.free);
    if (!m.free) {
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
    this.set('gear-ind', 'text', bus.gear);
    this.set('gear-ind', 'class', bus.gear);
    for (const gname of ['D', 'N', 'R']) this.set('gear-' + gname, 'class', bus.gear === gname ? 'on' : '');
    this.set('btn-doors', 'class', bus.doorOpen ? 'open' : '');
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
    if (!m.free) {
      x.strokeStyle = hexA(m.line.color, 0.9);
      x.lineWidth = 4; x.lineJoin = 'round'; x.lineCap = 'round';
      const P = m.line.path;
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
    // bus
    x.save();
    x.translate(c.x, c.y); x.rotate(bus.th);
    x.fillStyle = '#ff9800';
    x.beginPath(); x.moveTo(10, 0); x.lineTo(-7, -6); x.lineTo(-4, 0); x.lineTo(-7, 6); x.closePath(); x.fill();
    x.restore();
  }

  results(res, m, T) {
    this.$('res-title').textContent = m.free ? 'Fin de la conduite libre' : `Ligne ${m.line.def.id} — ${m.line.def.name}`;
    this.$('res-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < res.stars ? '' : 'off'}">★</span>`).join('');
    this.$('res-total').innerHTML = `<b>${res.total}</b> / 100 · bus ${T.label} · ${mmss(res.time)}${res.best ? ' · <span style="color:var(--accent)">nouveau record !</span>' : ''}`;
    const bars = [['Sécurité', res.safety], ['Service', res.service], ['Ponctualité', res.punct], ['Confort', res.comfort]];
    this.$('res-bars').innerHTML = bars.map(([n, v]) => `<div class="rb"><b>${v}</b><small>${n}</small><i><em style="width:${v}%;background:${v > 70 ? '#3ddc84' : v > 40 ? '#ffb300' : '#ff4d4f'}"></em></i></div>`).join('');
    const sc = m.sc;
    const avgP = sc.punct.length ? sc.punct.reduce((a, b) => a + b, 0) / sc.punct.length : 0;
    const det = [
      ['Collisions', sc.collisions], ['Accrochages', sc.scrapes], ['Roues sur trottoir', sc.curbs], ['Feux rouges', sc.red],
      ['Excès de vitesse', `${Math.round(sc.speeding)} s`], ['Arrêts manqués', sc.missed], ['Portes hors arrêt', sc.doorsOut],
      ['Clignotant oublié', sc.noBlink || 0], ['Écart horaire moyen', `${avgP >= 0 ? '+' : '−'}${mmss(Math.abs(avgP))}`],
      ['Accostage moyen', sc.dock.length ? Math.round(sc.dock.reduce((a, b) => a + b, 0) / sc.dock.length) + ' %' : '—'],
    ];
    this.$('res-details').innerHTML = det.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  }
}

function fmt(v) { return v.toFixed(2).replace(/0$/, '').replace('.', ','); }
export function mmss(t) {
  t = Math.max(0, Math.round(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
