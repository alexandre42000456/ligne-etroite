// Ligne Étroite — boucle de jeu et orchestration
import { CITY } from './city.js';
import { World } from './world.js';
import { MapRenderer } from './mapRenderer.js';
import { Renderer } from './render.js';
import { Bus, BUS_TYPES, makeCollider } from './bus.js';
import { Traffic } from './traffic.js';
import { Mission } from './mission.js';
import { Controls } from './controls.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { clamp } from './geom.js';

const DT = 1 / 120;
const DEFAULTS = {
  wheelTurns: 1.25, wheelGain: 1, autoCenter: true, northUp: false, autoZoom: true,
  guide: true, predict: true, traffic: true, zoom: 8.5, volume: 0.8,
};

function loadJSON(k, d) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' ? { ...d, ...v } : { ...d }; }
  catch (e) { return { ...d }; }
}
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }

class Game {
  constructor() {
    this.settings = loadJSON('le.settings', DEFAULTS);
    this.world = new World(CITY);
    this.mapR = new MapRenderer(this.world);
    this.R = new Renderer(document.getElementById('cv'), this.world, this.mapR);
    const mmScale = 1.5;
    this.mm = { img: this.mapR.minimap(mmScale), scale: mmScale };
    this.sound = new Sound();
    this.sound.setVolume(this.settings.volume);
    this.traffic = new Traffic(this.world);
    this.collide = makeCollider(this.world, () => (this.settings.traffic ? this.traffic.cars : null));
    this.material = (x, y) => this.world.material(x, y);
    this.state = 'menu';
    this.inGame = false;
    this.clock = 0;
    this.acc = 0;
    this.menuS = 0;
    this.ui = new UI(this);
    this.controls = new Controls(this.settings, {
      gear: (g) => this.gear(g),
      doors: () => this.doors(),
      blink: (d) => { if (!this.bus) return; this.bus.blink = this.bus.blink === d ? 0 : d; this.bus.blinkT = 0; this.blinkArmed = false; },
      horn: (on) => this.sound.horn(on && this.state === 'play'),
      pause: () => this.pause(),
      zoom: (k) => { this.settings.zoom = clamp(this.settings.zoom * k, 3.5, 16); this.saveSettings(); },
      camera: () => { this.settings.northUp = !this.settings.northUp; this.saveSettings(); },
    });
    // bus factice pour l'écran titre
    this.menuLine = this.world.lines[1];
    window.addEventListener('resize', () => this.R.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.R.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.state === 'play') this.pause(); this.sound.suspend(); }
      else this.sound.resume();
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    this.last = performance.now();
    this.warm = 6;
    const loop = (t) => { requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }

  // avance la simulation de n images (tests)
  tick(n = 60, dtMs = 1000 / 60) {
    for (let i = 0; i < n; i++) this.frame(this.last + dtMs);
  }

  saveSettings() { saveJSON('le.settings', this.settings); this.sound.setVolume(this.settings.volume); }
  best() { return loadJSON('le.best', {}); }

  startLine(line, T, free = false) {
    this.line = line; this.T = T; this.free = free;
    const st = line.stops[0].st;
    this.bus = new Bus(T, this.world.dockPose(st, T));
    this.mission = new Mission(this.world, line, T, { free });
    this.traffic.reset();
    this.controls.reset();
    this.clock = 0; this.acc = 0;
    this.R.snap(this.bus, this.settings);
    this.R.updateCamera(this.bus, 0.016, this.settings);
    if (this.settings.traffic) for (let i = 0; i < 9; i++) this.traffic.spawn(this.bus, this.R.viewCircle());
    this.state = 'play';
    this.inGame = true;
    this.resultsAt = null;
    this.warm = 4;
    this.ui.show('play');
    this.sound.unlock();
    this.sound.psst(0.3, 0.8);
    if (!free) this.mission.say('Ouvrez les portes pour faire monter les voyageurs', 'info', 4);
    else this.mission.say('Conduite libre : explorez la ville', 'info', 3);
  }
  startFree() { this.startLine(this.world.lines[1], BUS_TYPES['12'], true); }
  restart() { this.startLine(this.line, this.T, this.free); }
  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.sound.horn(false);
    this.ui.show('pause');
  }
  resume() { this.state = 'play'; this.last = performance.now(); this.ui.show('play'); }
  toMenu() {
    this.state = 'menu'; this.inGame = false; this.bus = null;
    this.sound.horn(false);
    this.traffic.reset();
  }
  quit() {
    this.toMenu();
    this.ui.show('title');
  }

  gear(g) {
    if (!this.bus || this.state !== 'play') return;
    if (this.bus.doorOpen) { this.sound.error(); return; }
    if (!this.bus.setGear(g)) { this.sound.error(); this.mission.say('Arrêtez le bus pour changer de sens', 'warn'); }
    else this.sound.ui();
  }
  doors() {
    const b = this.bus;
    if (!b || this.state !== 'play') return;
    if (!b.doorOpen && b.kmh > 0.5) { this.sound.error(); this.mission.say('Arrêtez-vous avant d’ouvrir les portes', 'warn'); return; }
    b.doorOpen = !b.doorOpen;
    this.sound.door(b.doorOpen);
  }

  finish() {
    const m = this.mission;
    const res = m.results();
    const key = this.line.def.id + ':' + this.T.id;
    const best = this.best();
    if (!this.free && (best[key] == null || res.total > best[key])) { res.best = best[key] != null; best[key] = res.total; saveJSON('le.best', best); }
    this.ui.results(res, m, this.T);
    this.state = 'results';
    this.ui.show('results');
    this.sound.chime();
  }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const S = this.settings;

    if (this.state === 'play') {
      const bus = this.bus, m = this.mission;
      this.clock += dt;
      this.controls.update(dt, bus);
      const inp = this.controls.input(bus);
      this.acc += dt;
      const ev = { hit: null, hitSpeed: 0, curb: 0 };
      let n = 0;
      while (this.acc >= DT && n < 14) {
        const e = bus.step(DT, inp, this.collide, this.material);
        if (e.hit && !ev.hit) { ev.hit = e.hit; ev.hitSpeed = e.hitSpeed; }
        else if (e.hit && e.hitSpeed > ev.hitSpeed) ev.hitSpeed = e.hitSpeed;
        ev.curb += e.curb;
        this.acc -= DT; n++;
      }
      if (n >= 14) this.acc = 0;
      if (ev.hit && ev.hit.kind !== 'artic' && ev.hitSpeed > 0.25) {
        this.sound.crash(clamp(ev.hitSpeed / 6, 0.25, 1));
        this.R.cam.shake = clamp(ev.hitSpeed / 5, 0.2, 1);
        if (ev.hit.kind === 'traffic') ev.hit.obj.ghost = true;
      }
      if (ev.curb) { this.sound.curb(); this.R.cam.shake = Math.max(this.R.cam.shake, 0.15); }
      if (S.traffic) this.traffic.update(dt, bus, this.clock, this.R.viewCircle());
      m.update(dt, bus, ev, this.world, this.clock);
      if (m.bell) { this.sound.bell(); m.bell = false; }
      // annulation automatique du clignotant après un virage
      if (bus.blink) {
        const w = this.controls.wheel, mx = this.controls.maxWheel;
        if (Math.sign(w) === bus.blink && Math.abs(w) > mx * 0.35) this.blinkArmed = true;
        if (this.blinkArmed && Math.abs(w) < mx * 0.08) { bus.blink = 0; this.blinkArmed = false; }
      }
      if (m.finished && this.resultsAt === null) this.resultsAt = this.clock + 2.2;
      if (this.resultsAt !== null && this.clock > this.resultsAt) this.finish();
      this.sound.update(dt, bus, true);
      this.R.updateCamera(bus, dt, S);
    } else if (this.state === 'menu') {
      // caméra qui survole la ligne 1
      const P = this.menuLine.path;
      this.menuS = (this.menuS + dt * 7) % P.len;
      const q = P.at(this.menuS), d = P.dirAt(this.menuS, 12);
      const cam = this.R.cam;
      cam.x = q.x; cam.y = q.y;
      const ta = Math.atan2(d.uy, d.ux);
      cam.ang += Math.atan2(Math.sin(ta - cam.ang), Math.cos(ta - cam.ang)) * (1 - Math.exp(-0.8 * dt));
      cam.zoom = 4.2;
      this.R.anchor = { x: this.R.w / 2, y: this.R.h / 2 };
    } else if (this.bus) {
      this.sound.update(dt, this.bus, false);
    }

    const busForDraw = this.bus || this.ghostBus();
    this.R.draw({
      bus: busForDraw, traffic: this.traffic, mission: this.bus ? this.mission : null, settings: S,
      sigTime: this.clock + (this.state === 'menu' ? now / 1000 : 0), lineColor: this.line ? this.line.def.color : '#e53935',
      lineId: this.bus && !this.free ? this.line.def.id : '', loading: this.warm > 0, hideBus: !this.bus,
    });
    if (this.warm > 0) { this.warm--; if (this.warm === 0) this.ui.hideLoading(); }
    if (this.bus && (this.state === 'play' || this.state === 'pause')) {
      this.ui.hud({ bus: this.bus, mission: this.mission, settings: S, controls: this.controls });
      if ((this.frameN = (this.frameN || 0) + 1) % 2 === 0) this.ui.minimap({ bus: this.bus, mission: this.mission, mm: this.mm, cam: this.R.cam });
    }
  }

  // bus hors champ pour l'écran titre (le rendu exige un bus)
  ghostBus() {
    if (!this._ghost) this._ghost = new Bus(BUS_TYPES['12'], { x: -500, y: -500, th: 0 });
    return this._ghost;
  }
}

window.addEventListener('load', () => {
  try {
    window.game = new Game();
  } catch (e) {
    console.error(e);
    document.getElementById('loading').innerHTML = `<p style="color:#ff8a80;padding:20px">Erreur au démarrage : ${e.message}</p>`;
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
