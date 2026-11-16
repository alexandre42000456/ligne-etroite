// Commandes : volant tactile (rotation cumulée multi-tours), pédales analogiques, boutons, clavier
import { clamp, DEG, wrapAngle } from './geom.js';

export class Controls {
  constructor(settings, cb) {
    this.settings = settings;
    this.cb = cb;
    this.wheel = 0; // angle du volant (degrés)
    this.throttle = 0;
    this.brake = 0;
    this.held = false;
    this.keys = new Set();
    this.kThr = 0; this.kBrk = 0;
    this.steerId = null;
    this.pedalIds = new Map();
    this.$ = (id) => document.getElementById(id);
    this.wheelEl = this.$('wheel');
    this.gaugeEl = this.$('wheel-gauge-fill');
    this.bindWheel();
    this.bindPedal('gas', (v) => (this.throttle = v));
    this.bindPedal('brake', (v) => (this.brake = v));
    this.bindButtons();
    this.bindKeys();
  }

  get maxWheel() { return this.settings.wheelTurns * 360; }

  bindWheel() {
    const zone = this.$('wheel-zone');
    let lastA = 0, center = null, near = false;
    const ang = (e) => Math.atan2(e.clientY - center.y, e.clientX - center.x);
    zone.addEventListener('pointerdown', (e) => {
      if (this.steerId !== null) return;
      e.preventDefault();
      const r = this.wheelEl.getBoundingClientRect();
      center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.steerId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* capture facultative */ }
      lastA = ang(e);
      near = Math.hypot(e.clientX - center.x, e.clientY - center.y) < r.width * 0.12;
      this.held = true;
      zone.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      e.preventDefault();
      const d = Math.hypot(e.clientX - center.x, e.clientY - center.y);
      const a = ang(e);
      const minR = this.wheelEl.getBoundingClientRect().width * 0.12;
      if (d < minR) { near = true; return; }
      if (near) { near = false; lastA = a; return; }
      const delta = wrapAngle(a - lastA) / DEG;
      lastA = a;
      this.wheel = clamp(this.wheel + delta * this.settings.wheelGain, -this.maxWheel, this.maxWheel);
    });
    const up = (e) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null;
      this.held = false;
      zone.classList.remove('active');
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);
  }

  bindPedal(id, set) {
    const el = this.$(id);
    const fill = el.querySelector('.fill');
    const upd = (e) => {
      const r = el.getBoundingClientRect();
      const v = 0.1 + 0.9 * clamp((r.bottom - e.clientY) / r.height, 0, 1);
      set(v);
      fill.style.transform = `scaleY(${v})`;
      el.classList.add('down');
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* capture facultative */ }
      this.pedalIds.set(e.pointerId, id);
      upd(e);
      this.cb.onPedal && this.cb.onPedal(id);
    });
    el.addEventListener('pointermove', (e) => { if (this.pedalIds.get(e.pointerId) === id) { e.preventDefault(); upd(e); } });
    const up = (e) => {
      if (this.pedalIds.get(e.pointerId) !== id) return;
      this.pedalIds.delete(e.pointerId);
      set(0);
      fill.style.transform = 'scaleY(0)';
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  bindButtons() {
    const tap = (id, fn) => {
      const el = this.$(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
    };
    for (const g of ['D', 'N', 'R']) tap('gear-' + g, () => this.cb.gear(g));
    tap('btn-doors', () => this.cb.doors());
    tap('blink-l', () => this.cb.blink(-1));
    tap('blink-r', () => this.cb.blink(1));
    tap('btn-pause', () => this.cb.pause());
    tap('zoom-in', () => this.cb.zoom(1.15));
    tap('zoom-out', () => this.cb.zoom(1 / 1.15));
    tap('btn-cam', () => this.cb.camera());
    const horn = this.$('btn-horn');
    horn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { horn.setPointerCapture(e.pointerId); } catch (_) { /* capture facultative */ } this.cb.horn(true); });
    const hu = () => this.cb.horn(false);
    horn.addEventListener('pointerup', hu);
    horn.addEventListener('pointercancel', hu);
    // pincement pour zoomer sur la vue
    const cv = this.$('cv');
    const pts = new Map();
    let d0 = 0;
    cv.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); } });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (d0 > 0) this.cb.zoom(d / d0);
        d0 = d;
      }
    });
    const pu = (e) => { pts.delete(e.pointerId); d0 = 0; };
    cv.addEventListener('pointerup', pu);
    cv.addEventListener('pointercancel', pu);
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'o') this.cb.doors();
      if (k === 'q') this.cb.blink(-1);
      if (k === 'e') this.cb.blink(1);
      if (k === 'f') this.cb.gear('D');
      if (k === 'n') this.cb.gear('N');
      if (k === 'r') this.cb.gear('R');
      if (k === 'h') this.cb.horn(true);
      if (k === 'escape' || k === 'p') this.cb.pause();
      if (k === '+' || k === '=') this.cb.zoom(1.15);
      if (k === '-') this.cb.zoom(1 / 1.15);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'h') this.cb.horn(false);
    });
  }

  // appelé à chaque image
  update(dt, bus) {
    const K = this.keys;
    const left = K.has('arrowleft') || K.has('a'), right = K.has('arrowright') || K.has('d');
    if (left || right) {
      this.wheel = clamp(this.wheel + (right ? 1 : -1) * 420 * dt, -this.maxWheel, this.maxWheel);
    }
    const up = K.has('arrowup') || K.has('w'), down = K.has('arrowdown') || K.has('s') || K.has(' ');
    this.kThr = clamp(this.kThr + (up ? 1.6 : -4) * dt, 0, 1);
    this.kBrk = clamp(this.kBrk + (down ? (K.has(' ') ? 8 : 1.8) : -5) * dt, 0, 1);
    // retour du volant lorsqu'il est lâché (proportionnel à la vitesse)
    if (!this.held && !left && !right && this.settings.autoCenter) {
      const rate = Math.abs(bus.v) * 32;
      const s = Math.sign(this.wheel);
      this.wheel -= s * Math.min(Math.abs(this.wheel), rate * dt);
    }
    // affichage
    this.wheelEl.style.transform = `rotate(${this.wheel}deg)`;
    const f = this.wheel / this.maxWheel;
    this.gaugeEl.style.transform = `scaleX(${f.toFixed(3)})`;
  }

  input(bus) {
    const T = bus.T;
    const ratio = this.maxWheel / (T.maxSteer / DEG);
    return {
      steer: (this.wheel / ratio) * DEG,
      throttle: Math.max(this.throttle, this.kThr),
      brake: Math.max(this.brake, this.kBrk),
    };
  }

  reset() {
    this.wheel = 0; this.throttle = 0; this.brake = 0; this.kThr = 0; this.kBrk = 0;
  }
}
