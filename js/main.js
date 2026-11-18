// Ligne Étroite — boucle de jeu et orchestration
import { CITY } from './city.js';
import { TRAINING } from './training.js';
import { World } from './world.js';
import { MapRenderer } from './mapRenderer.js';
import { Renderer } from './render.js';
import { Bus, BUS_TYPES, makeContacts, makeCollider } from './bus.js';
import { Traffic } from './traffic.js';
import { Mission } from './mission.js';
import { Challenge, startPose } from './challenge.js';
import { VEHICLES } from './bus.js';
import { Controls, defaultKeys } from './controls.js';
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
    // touches : valeurs par défaut complétées par celles enregistrées
    const dk = defaultKeys(), saved = this.settings.keys || {};
    for (const a of Object.keys(dk)) if (Array.isArray(saved[a])) dk[a] = [saved[a][0] ?? '', saved[a][1] ?? ''];
    this.settings.keys = dk;
    this.worlds = { city: new World(CITY) };
    this.views = {};
    this.sound = new Sound();
    this.sound.setVolume(this.settings.volume);
    this.useWorld('city');
    this.R = new Renderer(document.getElementById('cv'), this.world, this.mapR);
    this.state = 'menu';
    this.inGame = false;
    this.mode = null;
    this.clock = 0;
    this.acc = 0;
    this.menuS = 0;
    this.controls = new Controls(this.settings, {
      gear: (g) => this.gear(g),
      doors: () => this.doors(),
      blink: (d) => { if (!this.bus) return; this.bus.blink = this.bus.blink === d ? 0 : d; this.bus.blinkT = 0; this.blinkArmed = false; },
      horn: (on) => this.sound.horn(on && this.state === 'play'),
      pause: () => (this.state === 'pause' ? this.resume() : this.pause()),
      zoom: (k) => { this.settings.zoom = clamp(this.settings.zoom * k, 3.5, 16); this.saveSettings(); },
      camera: () => { this.settings.northUp = !this.settings.northUp; this.saveSettings(); },
      vehicle: () => this.openVehicles(),
    });
    this.ui = new UI(this);
    this.menuLine = this.worlds.city.lines[1];
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

  // ville ou centre de formation : rendu, mini-carte et trafic propres à chaque monde
  useWorld(key) {
    if (!this.worlds[key]) this.worlds[key] = new World(key === 'training' ? TRAINING : CITY);
    const w = this.worlds[key];
    let v = this.views[key];
    if (!v) {
      const mapR = new MapRenderer(w);
      v = this.views[key] = { mapR, mm: { img: mapR.minimap(1.5), scale: 1.5 }, traffic: new Traffic(w) };
    }
    if (this.traffic && this.traffic !== v.traffic) this.traffic.reset();
    this.worldKey = key; this.world = w; this.mapR = v.mapR; this.mm = v.mm; this.traffic = v.traffic;
    if (this.R) this.R.setWorld(w, v.mapR);
    this.collide = makeContacts(w, () => (this.trafficOn() ? this.traffic.cars : null));
    this.material = (x, y) => w.material(x, y);
  }
  trafficOn() { return this.settings.traffic && (this.mode !== 'challenge' || (this.chal && this.chal.traffic)); }

  // préparation commune à toutes les parties
  begin(T, pose, mission) {
    this.T = T;
    this.world.resetDynamic();
    this.bus = new Bus(T, pose);
    this.mission = mission;
    this.traffic.reset();
    this.controls.reset();
    this.clock = 0; this.acc = 0;
    this.R.particles.length = 0;
    this.R.snap(this.bus, this.settings);
    this.R.updateCamera(this.bus, 0.016, this.settings);
    if (this.trafficOn()) for (let i = 0; i < 9; i++) this.traffic.spawn(this.bus, this.R.viewCircle());
    this.state = 'play';
    this.inGame = true;
    this.resultsAt = null;
    this.warm = 4;
    this.ui.show('play');
    this.sound.unlock();
    this.sound.setVehicle(T);
    this.sound.psst(0.3, 0.8);
  }

  startLine(line, T) {
    this.mode = 'line'; this.line = line; this.chal = null;
    this.useWorld('city');
    this.world.setLevelObstacles([]);
    this.begin(T, this.world.dockPose(line.stops[0].st, T), new Mission(this.world, line, T));
    this.mission.say('Ouvrez les portes pour faire monter les voyageurs', 'info', 4);
  }
  startFree(T = BUS_TYPES['12']) {
    this.mode = 'free'; this.chal = null;
    this.useWorld('city');
    this.world.setLevelObstacles([]);
    this.line = this.world.lines[1];
    this.begin(T, this.world.dockPose(this.line.stops[0].st, T), new Mission(this.world, this.line, T, { free: true }));
    this.mission.say(T.kind === 'semi' ? 'Conduite libre : bonne chance dans les ruelles !' : 'Conduite libre : explorez la ville', 'info', 3);
  }
  respawnFree() { this.startFree(this.T); }
  startChallenge(def) {
    this.mode = 'challenge'; this.chal = def; this.line = null;
    this.useWorld(def.world);
    this.world.setLevelObstacles(def.obstacles || []);
    const T = VEHICLES[def.vehicle];
    this.begin(T, startPose(this.world, def, T), new Challenge(this.world, def, T));
    this.mission.say(def.target ? 'Garez-vous dans le cadre jaune' : 'Suivez le tracé jusqu’au damier', 'info', 3.5);
  }
  restart() {
    if (this.mode === 'challenge') this.startChallenge(this.chal);
    else if (this.mode === 'free') this.startFree(this.T);
    else this.startLine(this.line, this.T);
  }

  openVehicles() {
    if (this.mode !== 'free' || !this.bus) return;
    if (this.state === 'play') this.pause();
    this.ui.go('vehicle');
  }
  // remplace le véhicule sur place (l'avant reste au même endroit)
  swapVehicle(T) {
    const b = this.bus;
    if (b.kmh > 1) { this.sound.error(); this.resume(); this.mission.say('Arrêtez-vous pour changer de véhicule', 'warn'); return; }
    const f = b.front, ux = Math.cos(b.th), uy = Math.sin(b.th);
    const d = T.wb + T.fo;
    const pose = { x: f.x - ux * d, y: f.y - uy * d, th: b.th, th2: b.th };
    const nb = new Bus(T, pose);
    const strict = makeCollider(this.world, () => (this.trafficOn() ? this.traffic.cars : null));
    if (strict(nb)) {
      this.sound.error();
      this.resume();
      this.mission.say('Pas assez de place ici pour ce véhicule', 'warn', 3);
      return;
    }
    nb.gear = b.gear;
    this.bus = nb; this.T = T; this.mission.T = T;
    this.controls.reset();
    this.sound.setVehicle(T);
    this.resume();
    this.mission.say(`${T.name} ${T.label}`, 'good', 2);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.sound.horn(false);
    this.ui.show('pause');
  }
  resume() { this.state = 'play'; this.last = performance.now(); this.ui.show('play'); }
  toMenu() {
    this.state = 'menu'; this.inGame = false; this.bus = null; this.mission = null;
    this.sound.horn(false);
    this.traffic.reset();
    this.useWorld('city');
  }
  quit() {
    this.toMenu();
    this.ui.show('title');
  }

  gear(g) {
    if (!this.bus || this.state !== 'play') return;
    if (this.bus.doorOpen) { this.sound.error(); return; }
    if (!this.bus.setGear(g)) { this.sound.error(); this.mission.say('Arrêtez-vous pour changer de sens', 'warn'); }
    else this.sound.ui();
  }
  doors() {
    const b = this.bus;
    if (!b || this.state !== 'play' || b.T.kind !== 'bus') return;
    if (!b.doorOpen && b.kmh > 0.5) { this.sound.error(); this.mission.say('Arrêtez-vous avant d’ouvrir les portes', 'warn'); return; }
    b.doorOpen = !b.doorOpen;
    this.sound.door(b.doorOpen);
  }

  finish() {
    const m = this.mission;
    const res = m.results();
    const best = this.best();
    if (this.mode === 'line') {
      const key = this.line.def.id + ':' + this.T.id;
      if (best[key] == null || res.total > best[key]) { res.best = best[key] != null; best[key] = res.total; saveJSON('le.best', best); }
    } else if (this.mode === 'challenge' && !res.failed) {
      const key = 'D:' + this.chal.id, b = best[key];
      if (!b || res.total > b.total || (res.total === b.total && res.time < b.time)) {
        res.best = !!b; best[key] = { total: res.total, stars: res.stars, time: Math.round(res.time) }; saveJSON('le.best', best);
      }
    }
    this.ui.results(res, m, this.T);
    this.state = 'results';
    this.ui.show('results');
    this.sound.chime();
  }

  // effets des chocs : sons, secousses, particules
  effects(ev, bus) {
    for (const im of ev.impacts) {
      if (im.type === 'scrape') { if (Math.random() < 0.5) this.R.emit('spark', im.x, im.y, 0, 0, 2); continue; }
      if (im.type === 'mirror') { this.sound.knock('shelter'); this.R.emit('shard', im.x, im.y, 0, 0, 8); continue; }
      if (im.type === 'knock') {
        this.sound.knock(im.kind);
        if (im.kind === 'shelter') this.R.emit('shard', im.x, im.y, 0, 0, 25);
        else if (im.kind !== 'cone') this.R.emit('dust', im.x, im.y, 0, 0, 4);
        this.R.cam.shake = Math.max(this.R.cam.shake, im.kind === 'cone' ? 0.05 : 0.3);
        continue;
      }
      if ((im.type === 'hit' || im.type === 'crash') && im.speed > 0.25) {
        this.sound.crash(clamp(im.speed / 6, 0.25, 1));
        this.R.cam.shake = Math.max(this.R.cam.shake, clamp(im.speed / 5, 0.2, 1));
        this.R.emit('dust', im.x, im.y, 0, 0, 3 + Math.round(im.speed));
        if (im.type === 'crash') this.R.emit('shard', im.x, im.y, 0, 0, 10);
      }
    }
    for (const p of ev.pushes) {
      if (p.speed < 0.3) continue;
      this.sound.crash(clamp(p.speed / 6, 0.25, 1));
      this.R.cam.shake = Math.max(this.R.cam.shake, clamp(p.speed / 6, 0.2, 0.8));
      this.R.emit('shard', p.px, p.py, 0, 0, 8);
    }
    if (ev.curb) { this.sound.curb(); this.R.cam.shake = Math.max(this.R.cam.shake, 0.15); }
  }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const S = this.settings;

    if (this.state === 'play') {
      const bus = this.bus, m = this.mission, W = this.world;
      this.clock += dt;
      this.controls.update(dt, bus);
      const inp = this.controls.input(bus);
      this.acc += dt;
      const ev = { hit: null, hitSpeed: 0, curb: 0, impacts: [], knocks: [], pushes: [], scrape: 0 };
      let n = 0;
      while (this.acc >= DT && n < 14) {
        const e = bus.step(DT, inp, this.collide, this.material);
        for (const k of e.knocks) W.knock(k.obj, k.vx, k.vy);
        for (const p of e.pushes) W.push(p.obj, p.jx, p.jy, p.px, p.py, p.mass);
        W.stepDynamic(DT);
        if (e.hit && (!ev.hit || e.hitSpeed > ev.hitSpeed)) { ev.hit = e.hit; ev.hitSpeed = e.hitSpeed; }
        ev.curb += e.curb;
        ev.impacts.push(...e.impacts); ev.knocks.push(...e.knocks); ev.pushes.push(...e.pushes);
        ev.scrape = Math.max(ev.scrape, e.scrape);
        this.acc -= DT; n++;
      }
      if (n >= 14) this.acc = 0;
      for (const b of W.dirty) this.mapR.invalidate(b);
      W.dirty.length = 0;
      this.effects(ev, bus);
      if (this.trafficOn()) this.traffic.update(dt, bus, this.clock, this.R.viewCircle());
      m.update(dt, bus, ev, W, this.clock);
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
      this.R.stepParticles(dt);
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
    const color = this.mode === 'challenge' && this.chal ? this.chal.color : this.line ? this.line.def.color : '#e53935';
    this.R.draw({
      bus: busForDraw, traffic: this.traffic, mission: this.bus ? this.mission : null, settings: S,
      sigTime: this.clock + (this.state === 'menu' ? now / 1000 : 0), lineColor: color,
      lineId: this.bus && this.mode === 'line' ? this.line.def.id : '', loading: this.warm > 0, hideBus: !this.bus,
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
