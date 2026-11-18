// Véhicules et physique : bicyclette cinématique (+ remorque pour l'articulé et la semi-remorque),
// moteur à puissance limitée, boîte automatique, freinage, contacts réalistes et dégâts.
import { DEG, clamp, wrapAngle, obbCircle, obbOverlap } from './geom.js';
import { MAT } from './world.js';

export const VEHICLES = {
  '12': {
    id: '12', kind: 'bus', label: '12 m', name: 'Citadin standard', len: 12.0, width: 2.55, fo: 2.75, wb: 5.9,
    maxSteer: 49 * DEG, mass: 11500, cap: 95, power: 220e3, aCap: 1.5, vmax: 70,
    doorDist: [1.05, 5.6, 9.55], axlesDesc: '2 essieux',
  },
  '15': {
    id: '15', kind: 'bus', label: '15 m', name: 'Trois essieux', len: 14.9, width: 2.55, fo: 2.75, wb: 6.85, tag: 0.7,
    maxSteer: 48 * DEG, mass: 14000, cap: 120, power: 260e3, aCap: 1.4, vmax: 70,
    doorDist: [1.05, 6.4, 12.0], axlesDesc: '3 essieux (essieu suiveur non directeur)',
  },
  '18': {
    id: '18', kind: 'bus', label: '18 m', name: 'Articulé', len: 18.13, width: 2.55, fo: 2.8, wb: 5.85,
    artic: { c: 1.75, l2: 4.24, ro2: 3.49, maxAng: 52 * DEG, rear1: 1.25, kf: -0.5, bellows: true },
    maxSteer: 46 * DEG, mass: 17000, cap: 145, power: 290e3, aCap: 1.3, vmax: 70,
    doorDist: [1.05, 6.2, 12.7, 16.2], axlesDesc: '3 essieux, articulation à 52°',
  },
  semi: {
    id: 'semi', kind: 'semi', label: '16,5 m', name: 'Semi-remorque', len: 16.6, width: 2.55, fo: 1.45, wb: 3.7,
    artic: { c: -0.45, l2: 7.75, ro2: 4.15, maxAng: 82 * DEG, rear1: 0.85, kf: 1.7, axles: [-1.31, 0, 1.31] },
    maxSteer: 45 * DEG, mass: 15500, cap: 0, power: 330e3, aCap: 1.0, vmax: 85, color: '#1d5fa6',
    doorDist: [1.0], axlesDesc: 'tracteur 4×2, remorque 13,6 m à 3 essieux',
  },
  semi13: {
    id: 'semi13', kind: 'semi', label: '13 m', name: 'Semi urbaine', len: 13.35, width: 2.55, fo: 1.45, wb: 3.7,
    artic: { c: -0.45, l2: 5.9, ro2: 2.75, maxAng: 82 * DEG, rear1: 0.85, kf: 1.5, axles: [-0.65, 0.65] },
    maxSteer: 45 * DEG, mass: 12500, cap: 0, power: 300e3, aCap: 1.1, vmax: 85, color: '#b23a2f',
    doorDist: [1.0], axlesDesc: 'tracteur 4×2, remorque 10,2 m à 2 essieux',
  },
};
export const BUS_TYPES = Object.fromEntries(Object.entries(VEHICLES).filter(([, T]) => T.kind === 'bus'));

// caractéristiques dérivées (porte-à-faux, rayon de braquage…)
for (const T of Object.values(VEHICLES)) {
  T.ro = T.artic ? T.artic.ro2 : T.len - T.fo - T.wb;
  const R = T.wb / Math.tan(T.maxSteer);
  T.turnCircle = 2 * Math.hypot(T.wb + T.fo, R + T.width / 2);
  T.innerR = R - T.width / 2;
  T.doors = T.doorDist; // alias
  // longueur derrière l'essieu de référence (pour placer le véhicule sur un tracé)
  T.behind = T.artic ? T.artic.c + T.artic.l2 + T.artic.ro2 : T.ro;
}

// comportement des obstacles au choc
const OBST = {
  cone: { mode: 'light', mass: 4 },
  lamp: { mode: 'break', brk: 3.0, mass: 180 },
  stoppole: { mode: 'break', brk: 1.3, mass: 30 },
  signal: { mode: 'break', brk: 3.4, mass: 220 },
  shelter: { mode: 'break', brk: 2.0, mass: 300 },
  car: { mode: 'move', mass: 1300 },
  traffic: { mode: 'move', mass: 1300 },
};
const TALL = new Set(['lamp', 'tree', 'signal', 'stoppole', 'shelter', 'parkedbus', 'trailer']);

const GEAR_K = [0, 118, 68, 47.5, 34.5, 26.4, 21.1]; // tr/min par km/h
const SAMPLE_STEP = 0.3;
const INSET = 0.13; // au-delà : choc franc ; en deçà : frottement

export class Bus {
  constructor(T, pose) {
    this.T = T;
    this.x = pose.x; this.y = pose.y; this.th = pose.th;
    this.th2 = pose.th2 ?? pose.th;
    this.v = 0; this.steer = 0; this.acc = 0; this.latAcc = 0;
    this.gear = 'D'; this.g = 1; this.rpm = 650; this.shiftT = 0;
    this.doors = 0; this.doorOpen = false;
    this.pax = 0;
    this.blink = 0; this.blinkT = 0;
    this.braking = 0; this.throttle = 0;
    this.odo = 0;
    // dégâts
    this.damage = 0;
    this.marks = [];
    this.mirrorOk = [true, true];
    this.crack = 0;
    this.scrape = 0;
    this.buildLocal();
    this.updateGeo();
    this.wheelState = this.geo.wheels.map(() => true);
  }

  buildLocal() {
    const T = this.T, hw = T.width / 2;
    const secs = [];
    if (T.artic) {
      const A = T.artic;
      secs.push({ x0: -A.rear1, x1: T.wb + T.fo, hw });
      secs.push({ x0: -A.ro2, x1: A.l2 + A.kf, hw });
    } else secs.push({ x0: -T.ro, x1: T.wb + T.fo, hw });
    for (const s of secs) {
      const out = [], inn = [];
      const nL = Math.ceil((s.x1 - s.x0) / SAMPLE_STEP), nW = Math.ceil((2 * hw) / SAMPLE_STEP);
      const push = (x, y) => {
        out.push(x, y);
        inn.push(clamp(x, s.x0 + INSET, s.x1 - INSET), clamp(y, -hw + INSET, hw - INSET));
      };
      for (let i = 0; i <= nL; i++) {
        const x = s.x0 + ((s.x1 - s.x0) * i) / nL;
        push(x, -hw); push(x, hw);
      }
      for (let j = 1; j < nW; j++) {
        const y = -hw + (2 * hw * j) / nW;
        push(s.x0, y); push(s.x1, y);
      }
      s.local = new Float64Array(out);
      s.inner = new Float64Array(inn);
    }
    this.secs = secs;
    // roues : x local, section, bord extérieur du pneu
    const W = [];
    W.push({ sec: 0, x: T.wb, steer: true, edge: 1.15 });
    if (T.tag) {
      W.push({ sec: 0, x: T.tag, edge: 1.21, twin: true });
      W.push({ sec: 0, x: -T.tag, edge: 1.15 });
    } else W.push({ sec: 0, x: 0, edge: 1.21, twin: true });
    if (T.artic) {
      for (const ax of T.artic.axles || [0]) W.push({ sec: 1, x: ax, edge: T.kind === 'semi' ? 1.23 : 1.21, twin: T.kind !== 'semi' });
    }
    this.wheelDefs = [];
    for (const w of W) for (const side of [-1, 1]) this.wheelDefs.push({ ...w, side });
    // portes (côté droit) — bus seulement
    this.doorDefs = T.kind !== 'bus' ? [] : T.doorDist.map((d) => {
      if (!T.artic) return { sec: 0, x: T.wb + T.fo - d };
      const front = T.wb + T.fo;
      const toJoint = front + T.artic.c;
      return d < toJoint ? { sec: 0, x: front - d } : { sec: 1, x: T.artic.l2 - (d - toJoint) };
    });
    this.nSamples = secs.reduce((n, s) => n + s.local.length / 2, 0);
    this.samples = new Float64Array(this.nSamples * 2);
    this.inner = new Float64Array(this.nSamples * 2);
    this.sampleSec = new Uint8Array(this.nSamples);
    let k = 0;
    secs.forEach((s, i) => { for (let j = 0; j < s.local.length / 2; j++) this.sampleSec[k++] = i; });
  }

  // pose de chaque section : point de référence (essieu arrière) et cap
  secPose(i, x = this.x, y = this.y, th = this.th, th2 = this.th2) {
    if (i === 0) return { x, y, th };
    const A = this.T.artic;
    const jx = x - Math.cos(th) * A.c, jy = y - Math.sin(th) * A.c;
    return { x: jx - Math.cos(th2) * A.l2, y: jy - Math.sin(th2) * A.l2, th: th2, jx, jy };
  }

  updateGeo() {
    const g = (this.geo ||= { obbs: [], wheels: [], mirrors: [], doors: [], poses: [] });
    g.obbs.length = 0; g.poses.length = 0;
    let k = 0;
    for (let i = 0; i < this.secs.length; i++) {
      const s = this.secs[i], P = this.secPose(i);
      g.poses.push(P);
      const ux = Math.cos(P.th), uy = Math.sin(P.th);
      const mid = (s.x0 + s.x1) / 2;
      const o = { cx: P.x + ux * mid, cy: P.y + uy * mid, ux, uy, hl: (s.x1 - s.x0) / 2, hw: s.hw, sec: i };
      const ex = Math.abs(ux) * o.hl + Math.abs(uy) * o.hw, ey = Math.abs(uy) * o.hl + Math.abs(ux) * o.hw;
      o.minx = o.cx - ex; o.maxx = o.cx + ex; o.miny = o.cy - ey; o.maxy = o.cy + ey;
      g.obbs.push(o);
      const L = s.local, I = s.inner;
      for (let j = 0; j < L.length; j += 2) {
        this.samples[k] = P.x + ux * L[j] - uy * L[j + 1];
        this.inner[k] = P.x + ux * I[j] - uy * I[j + 1];
        k++;
        this.samples[k] = P.y + uy * L[j] + ux * L[j + 1];
        this.inner[k] = P.y + uy * I[j] + ux * I[j + 1];
        k++;
      }
    }
    g.joint = this.T.artic && this.T.artic.bellows ? { x: g.poses[1].jx, y: g.poses[1].jy, r: 1.15 } : null;
    // rétroviseurs (à 2 m de haut : touchent murs, poteaux, arbres)
    const P0 = g.poses[0], ux = Math.cos(P0.th), uy = Math.sin(P0.th);
    const semi = this.T.kind === 'semi';
    const mx = this.T.wb + this.T.fo - (semi ? 0.55 : 0.3), my = this.T.width / 2 + (semi ? 0.38 : 0.3);
    g.mirrors = [
      { x: P0.x + ux * mx + uy * my, y: P0.y + uy * mx - ux * my, side: -1, i: 0 },
      { x: P0.x + ux * mx - uy * my, y: P0.y + uy * mx + ux * my, side: 1, i: 1 },
    ].filter((m) => this.mirrorOk[m.i]);
    g.wheels.length = 0;
    for (const w of this.wheelDefs) {
      const P = g.poses[w.sec];
      const cx = Math.cos(P.th), cy = Math.sin(P.th);
      const ly = w.side * w.edge;
      g.wheels.push({ x: P.x + cx * w.x - cy * ly, y: P.y + cy * w.x + cx * ly, ax: cx * 0.28, ay: cy * 0.28, def: w });
    }
    g.doors = this.doorDefs.map((d) => {
      const P = g.poses[d.sec];
      const cx = Math.cos(P.th), cy = Math.sin(P.th);
      const ly = this.T.width / 2;
      return { x: P.x + cx * d.x - cy * ly, y: P.y + cy * d.x + cx * ly, th: P.th };
    });
  }

  get front() {
    const g = this.geo.poses[0];
    const d = this.T.wb + this.T.fo;
    return { x: g.x + Math.cos(this.th) * d, y: g.y + Math.sin(this.th) * d };
  }
  get rear() {
    const n = this.secs.length - 1, P = this.geo.poses[n], x0 = this.secs[n].x0;
    return { x: P.x + Math.cos(P.th) * x0, y: P.y + Math.sin(P.th) * x0, th: P.th };
  }
  get center() {
    const o = this.geo.obbs[0];
    return { x: o.cx, y: o.cy };
  }
  get kmh() { return Math.abs(this.v) * 3.6; }

  setGear(gr) {
    if (gr === this.gear) return true;
    if (gr !== 'N' && this.gear !== 'N' && Math.abs(this.v) > 0.15) return false;
    if (gr !== 'N' && Math.abs(this.v) > 0.15 && Math.sign(this.v) !== (gr === 'R' ? -1 : 1)) return false;
    this.gear = gr;
    this.g = 1;
    return true;
  }

  // vitesse d'un point (monde) appartenant à la section `sec`, par différence entre deux poses
  pointVel(px, py, sec, old, dt) {
    const P = this.geo.poses[sec];
    const c = Math.cos(P.th), s = Math.sin(P.th);
    const lx = (px - P.x) * c + (py - P.y) * s, ly = -(px - P.x) * s + (py - P.y) * c;
    const Q = this.secPose(sec, old.x, old.y, old.th, old.th2);
    const c2 = Math.cos(Q.th), s2 = Math.sin(Q.th);
    const ox = Q.x + c2 * lx - s2 * ly, oy = Q.y + s2 * lx + c2 * ly;
    return { x: (px - ox) / dt, y: (py - oy) / dt, lx, ly };
  }

  addMark(sec, lx, ly, kind, size) {
    if (this.marks.length > 60) this.marks.shift();
    const last = this.marks[this.marks.length - 1];
    if (kind === 'scratch' && last && last.kind === 'scratch' && last.sec === sec && Math.abs(last.ly - ly) < 0.3 && Math.abs(last.lx - lx) < 1.5) {
      last.x0 = Math.min(last.x0, lx); last.x1 = Math.max(last.x1, lx);
      return;
    }
    this.marks.push({ sec, lx, ly, x0: lx, x1: lx, kind, size });
  }

  // inp : {steer (rad roue), throttle 0..1, brake 0..1}
  // collide(bus) : soit un obstacle (mode strict, planificateur), soit une liste de contacts détaillés
  step(dt, inp, collide, material) {
    const T = this.T;
    const ev = { hit: null, hitSpeed: 0, curb: 0, artic: false, impacts: [], knocks: [], pushes: [], scrape: 0 };
    // direction assistée : vitesse de braquage limitée
    const target = clamp(inp.steer, -T.maxSteer, T.maxSteer);
    const rate = 62 * DEG;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    // portes : 1,6 s pour ouvrir/fermer, frein d'arrêt tant qu'elles ne sont pas fermées
    const dTarget = this.doorOpen ? 1 : 0;
    if (this.doors !== dTarget) {
      this.doors = clamp(this.doors + Math.sign(dTarget - this.doors) * dt / 1.6, 0, 1);
      if (Math.abs(this.doors - dTarget) < 1e-3) this.doors = dTarget;
    }
    const stopBrake = this.doors > 0 || this.doorOpen;

    let thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (stopBrake) { thr = 0; brk = Math.max(brk, 0.55); }
    if (this.damage >= 100) thr = 0;
    this.throttle = thr; this.braking = brk;
    const m = T.mass + this.pax * 70;
    const dirG = this.gear === 'R' ? -1 : this.gear === 'D' ? 1 : 0;
    const speed = Math.abs(this.v);
    const kmh = speed * 3.6;

    // boîte de vitesses (sonorité et coupures de couple)
    if (this.shiftT > 0) this.shiftT -= dt;
    if (dirG === 1) {
      const raw = kmh * GEAR_K[this.g];
      if (this.shiftT <= 0 && this.g < 6 && raw > 1500 + 420 * thr) { this.g++; this.shiftT = 0.45; }
      else if (this.shiftT <= 0 && this.g > 1 && raw < 800) { this.g--; this.shiftT = 0.2; }
      const r2 = kmh * GEAR_K[this.g];
      this.rpm = this.g === 1 ? Math.max(r2, 650 + thr * 900) : Math.max(r2, 650);
    } else if (dirG === -1) this.rpm = Math.max(kmh * 120, 650 + thr * 650);
    else this.rpm = 650 + thr * 1500;
    this.rpm = Math.min(this.rpm, 2300);

    let F = 0;
    if (dirG !== 0) {
      const Fmax = Math.min(T.aCap * T.mass * 1.05, T.power / Math.max(speed, 2));
      let Fd = Math.pow(thr, 1.5) * Fmax;
      if (this.shiftT > 0) Fd *= 0.3;
      if (thr < 0.05) Fd += m * 0.3 * clamp(1 - speed / 1.4, 0, 1); // rampement du convertisseur
      const vmax = dirG > 0 ? T.vmax / 3.6 : 9 / 3.6;
      if (Math.sign(this.v) === dirG && speed > vmax * 0.92) Fd *= clamp((vmax - speed) / (vmax * 0.08), 0, 1);
      F = dirG * Fd;
    }
    const Fres = 0.009 * m * 9.81 + 0.5 * 1.2 * 0.65 * 7.6 * this.v * this.v;
    const Fcoast = dirG !== 0 && thr < 0.02 && speed > 2 ? m * 0.1 : 0;
    const Fbrake = Math.pow(brk, 1.25) * m * 6.3;
    const resist = Fres + Fcoast + Fbrake;
    const v0 = this.v;
    if (Math.abs(this.v) < 1e-4) {
      if (Math.abs(F) > resist) this.v = (Math.sign(F) * (Math.abs(F) - resist) / m) * dt;
      else this.v = 0;
    } else {
      const s = Math.sign(this.v);
      const nv = this.v + ((F - s * resist) / m) * dt;
      this.v = Math.sign(nv) !== s ? 0 : nv;
    }

    // cinématique
    const L = T.wb;
    const om = (this.v * Math.tan(this.steer)) / L;
    const old = { x: this.x, y: this.y, th: this.th, th2: this.th2 };
    const thm = this.th + om * dt * 0.5;
    this.x += this.v * Math.cos(thm) * dt;
    this.y += this.v * Math.sin(thm) * dt;
    this.th += om * dt;
    if (T.artic) {
      const A = T.artic;
      const d = wrapAngle(thm - this.th2);
      const om2 = (this.v * Math.sin(d) - A.c * om * Math.cos(d)) / A.l2;
      this.th2 += om2 * dt;
      if (Math.abs(wrapAngle(this.th - this.th2)) > A.maxAng) ev.artic = true;
    }
    this.latAcc = this.v * om;
    let moved = false;
    if (this.v !== 0 || old.th !== this.th) {
      this.updateGeo();
      if (ev.artic) {
        ev.hit = { kind: 'artic' };
        this.restore(old); this.v = 0;
      } else {
        const res = collide(this);
        if (Array.isArray(res)) moved = this.resolve(res, old, dt, m, ev);
        else if (res) {
          ev.hit = res; ev.hitSpeed = Math.abs(v0);
          this.restore(old); this.v = 0; this.latAcc = 0;
        } else moved = true;
      }
      if (moved) {
        this.odo += Math.abs(this.v) * dt;
        // roues sur le trottoir ?
        const ws = this.geo.wheels;
        for (let i = 0; i < ws.length; i++) {
          const w = ws[i];
          const m1 = material(w.x + w.ax, w.y + w.ay), m2 = material(w.x - w.ax, w.y - w.ay);
          const ok = (m1 === MAT.ROAD || m1 === MAT.APRON) && (m2 === MAT.ROAD || m2 === MAT.APRON);
          if (!ok && this.wheelState[i]) ev.curb++;
          this.wheelState[i] = ok;
        }
      }
    } else this.scrape = Math.max(0, this.scrape - dt * 4);
    this.acc = (this.v - v0) / dt;
    // clignotants
    if (this.blink) this.blinkT += dt; else this.blinkT = 0;
    return ev;
  }

  restore(o) {
    this.x = o.x; this.y = o.y; this.th = o.th; this.th2 = o.th2;
    this.updateGeo();
  }

  // réponse aux contacts : frottement, choc franc, mobilier renversé, voiture poussée
  resolve(cs, old, dt, m, ev) {
    if (!cs.length) { this.scrape = Math.max(0, this.scrape - dt * 4); return true; }
    let revert = false, hard = 0, scrape = 0, scrapeN = 0, hardC = null;
    const energy = (mass, v) => (0.5 * mass * v * v) / 2500; // % de dégâts par énergie dissipée
    for (const c of cs) {
      const vp = this.pointVel(c.x, c.y, c.sec, old, dt);
      const vn = vp.x * c.nx + vp.y * c.ny; // < 0 : le point s'enfonce dans l'obstacle
      const sp = Math.hypot(vp.x, vp.y);
      const app = Math.max(0, -vn);
      const info = OBST[c.kind] || { mode: 'rigid' };
      if (c.part === 'mirror') {
        if (sp > 0.4) {
          this.mirrorOk[c.mirror] = false;
          this.damage += 3;
          ev.impacts.push({ type: 'mirror', kind: c.kind, speed: sp, x: c.x, y: c.y });
        } else revert = true;
        continue;
      }
      if (info.mode === 'light') {
        ev.knocks.push({ obj: c.obj, vx: vp.x * 1.5, vy: vp.y * 1.5 });
        ev.impacts.push({ type: 'knock', kind: c.kind, speed: sp, x: c.x, y: c.y });
        continue;
      }
      if (info.mode === 'break' && (app > info.brk || sp > info.brk * 1.3)) {
        ev.knocks.push({ obj: c.obj, vx: vp.x, vy: vp.y });
        ev.impacts.push({ type: 'knock', kind: c.kind, speed: sp, x: c.x, y: c.y });
        // l'objet absorbe une partie de l'énergie
        this.v *= 1 - clamp(info.mass / m, 0, 0.5) * 3;
        this.damage += 0.5 + energy(info.mass, sp) * 3;
        this.addMark(c.sec, c.lx ?? vp.lx, vp.ly, 'dent', 0.5);
        continue;
      }
      if (info.mode === 'move' && !c.obj.blocked) {
        // choc avec un véhicule léger : impulsion partagée selon les masses
        const ov = c.obj;
        const rvx = vp.x - (ov.vx || 0), rvy = vp.y - (ov.vy || 0);
        const rn = -(rvx * c.nx + rvy * c.ny);
        if (rn > 0) {
          const e = 0.15, mc = info.mass;
          const J = ((1 + e) * rn) / (1 / m + 1 / mc);
          ev.pushes.push({ obj: ov, jx: -c.nx * J, jy: -c.ny * J, px: c.x, py: c.y, mass: mc, speed: rn, kind: c.kind });
          const dvb = J / m;
          const u = this.geo.poses[c.sec];
          this.v += dvb * (c.nx * Math.cos(u.th) + c.ny * Math.sin(u.th));
          this.damage += energy((m * mc) / (m + mc), rn);
          this.addMark(c.sec, vp.lx, vp.ly, 'dent', 0.4 + rn * 0.1);
        }
        revert = true;
        continue;
      }
      // obstacle fixe : frottement si le contact est léger et rasant, sinon choc
      if (c.depth < INSET && app < 0.45 * sp + 0.1 && app < 1.1) {
        scrape = Math.max(scrape, sp);
        scrapeN = Math.max(scrapeN, app);
        this.addMark(c.sec, vp.lx, vp.ly, 'scratch', 0.1);
        ev.impacts.push({ type: 'scrape', kind: c.kind, speed: sp, x: c.x, y: c.y });
      } else {
        revert = true;
        const imp = Math.max(app, c.depth >= INSET ? Math.min(sp, Math.abs(this.v)) : 0);
        if (imp >= hard) { hard = imp; hardC = c; }
      }
    }
    if (revert) {
      this.restore(old);
      if (hardC) {
        const v = Math.abs(this.v);
        // petit rebond pour les chocs francs
        this.v = v > 1.5 ? -Math.sign(this.v) * Math.min(0.6, v * 0.08) : 0;
        this.latAcc = 0;
        this.damage += hard > 0.25 ? 0.5 + energy(m, hard) : 0;
        if (hard > 0.25) {
          const vp = this.pointVel(hardC.x, hardC.y, hardC.sec, old, dt);
          this.addMark(hardC.sec, vp.lx, vp.ly, 'dent', 0.35 + hard * 0.12);
          if (hard > 3.5 && hardC.sec === 0 && vp.lx > this.T.wb) this.crack = Math.min(1, this.crack + hard / 10);
          ev.impacts.push({ type: hard > 2.8 ? 'crash' : 'hit', kind: hardC.kind, speed: hard, x: hardC.x, y: hardC.y });
          ev.hit = { kind: hardC.kind, x: hardC.x, y: hardC.y, obj: hardC.obj };
          ev.hitSpeed = hard;
        }
      } else if (Math.abs(this.v) < 0.3) this.v = 0;
    }
    if (scrape > 0) {
      // frottement de la carrosserie : ralentit et abîme
      const dec = (0.8 + 6 * scrapeN) * dt;
      this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), dec);
      this.damage += (0.6 + scrape * 0.5) * dt;
      this.scrape = Math.min(1, 0.3 + scrape / 4);
      ev.scrape = this.scrape;
    } else this.scrape = Math.max(0, this.scrape - dt * 4);
    this.damage = Math.min(100, this.damage);
    return !revert;
  }

  // trajectoire prévue à braquage constant : coins avant, coins arrière, roue arrière
  predict(dist, dir) {
    const T = this.T, hw = T.width / 2;
    let x = this.x, y = this.y, th = this.th, th2 = this.th2;
    const st = 0.35 * dir, n = Math.ceil(dist / 0.35);
    const tan = Math.tan(this.steer);
    const tr = [[], [], [], [], []];
    const last = this.secs.length - 1;
    const x0 = this.secs[last].x0, xf = T.wb + T.fo;
    const ax0 = T.artic && T.artic.axles ? Math.min(...T.artic.axles) : 0;
    for (let i = 0; i <= n; i++) {
      const c = Math.cos(th), s = Math.sin(th);
      tr[0].push(x + c * xf + s * hw, y + s * xf - c * hw);
      tr[1].push(x + c * xf - s * hw, y + s * xf + c * hw);
      const P = last ? this.secPose(1, x, y, th, th2) : { x, y, th };
      const c2 = Math.cos(P.th), s2 = Math.sin(P.th);
      tr[2].push(P.x + c2 * x0 + s2 * hw, P.y + s2 * x0 - c2 * hw);
      tr[3].push(P.x + c2 * x0 - s2 * hw, P.y + s2 * x0 + c2 * hw);
      // roue arrière intérieure (dernier essieu)
      const side = this.steer >= 0 ? 1 : -1;
      tr[4].push(P.x + c2 * ax0 - s2 * 1.21 * side, P.y + s2 * ax0 + c2 * 1.21 * side);
      const om = (st * tan) / T.wb;
      const thm = th + om / 2;
      x += st * Math.cos(thm); y += st * Math.sin(thm);
      if (T.artic) {
        const A = T.artic, d = wrapAngle(thm - th2);
        th2 += (st * Math.sin(d) - A.c * om * Math.cos(d)) / A.l2;
      }
      th += om;
    }
    return tr;
  }

  // roues avant pour l'affichage (épure d'Ackermann)
  frontWheelAngles() {
    const d = this.steer;
    if (Math.abs(d) < 1e-4) return [0, 0];
    const R = this.T.wb / Math.tan(Math.abs(d));
    const t = 1.03;
    const inner = Math.atan(this.T.wb / (R - t)), outer = Math.atan(this.T.wb / (R + t));
    const s = Math.sign(d);
    return s > 0 ? [s * outer, s * inner] : [s * inner, s * outer];
  }
}

// ----------------------------------------------------------------- contacts
let qstamp = 1;
const solid = (m) => m === MAT.BUILDING || m === MAT.WATER;

// normale d'un mur au point (x, y) : vers l'espace libre
function wallNormal(world, x, y, fx, fy) {
  let nx = 0, ny = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    if (!solid(world.material(x + c * 0.45, y + s * 0.45))) { nx += c; ny += s; }
  }
  const l = Math.hypot(nx, ny);
  if (l < 1e-6) { const d = Math.hypot(fx - x, fy - y) || 1; return { x: (fx - x) / d, y: (fy - y) / d }; }
  return { x: nx / l, y: ny / l };
}

function circleContact(o, cx, cy, r) {
  const dx = cx - o.cx, dy = cy - o.cy;
  const lx = dx * o.ux + dy * o.uy, ly = -dx * o.uy + dy * o.ux;
  const qx = clamp(lx, -o.hl, o.hl), qy = clamp(ly, -o.hw, o.hw);
  const ex = lx - qx, ey = ly - qy, d = Math.hypot(ex, ey);
  if (d >= r) return null;
  const px = o.cx + qx * o.ux - qy * o.uy, py = o.cy + qx * o.uy + qy * o.ux;
  let nx, ny, depth;
  if (d > 1e-6) {
    // normale : du centre de l'obstacle vers le véhicule
    nx = -(ex * o.ux - ey * o.uy) / d; ny = -(ex * o.uy + ey * o.ux) / d;
    depth = r - d;
  } else {
    const px2 = o.hl - Math.abs(lx), py2 = o.hw - Math.abs(ly);
    if (px2 < py2) { nx = Math.sign(lx) * o.ux; ny = Math.sign(lx) * o.uy; depth = r + px2; }
    else { nx = -Math.sign(ly) * o.uy; ny = Math.sign(ly) * o.ux; depth = r + py2; }
    nx = -nx; ny = -ny;
  }
  return { x: px, y: py, nx, ny, depth };
}

function corners(o) {
  const ax = o.ux * o.hl, ay = o.uy * o.hl, bx = -o.uy * o.hw, by = o.ux * o.hw;
  return [[o.cx + ax + bx, o.cy + ay + by], [o.cx + ax - bx, o.cy + ay - by], [o.cx - ax - bx, o.cy - ay - by], [o.cx - ax + bx, o.cy - ay + by]];
}
function boxContact(a, b) {
  // a : section du véhicule ; b : obstacle. Retourne profondeur et normale (de b vers a)
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  const dx = a.cx - b.cx, dy = a.cy - b.cy;
  let best = Infinity, bn = null;
  const rad = (o, x, y) => Math.abs(o.ux * x + o.uy * y) * o.hl + Math.abs(-o.uy * x + o.ux * y) * o.hw;
  for (const [x, y] of axes) {
    const d = dx * x + dy * y;
    const ov = rad(a, x, y) + rad(b, x, y) - Math.abs(d);
    if (ov <= 0) return null;
    if (ov < best) { best = ov; bn = d >= 0 ? [x, y] : [-x, -y]; }
  }
  // point de contact : coin le plus enfoncé
  let px = (a.cx + b.cx) / 2, py = (a.cy + b.cy) / 2, deep = -Infinity;
  const inside = (o, x, y) => { const ex = x - o.cx, ey = y - o.cy; return Math.abs(ex * o.ux + ey * o.uy) <= o.hl && Math.abs(-ex * o.uy + ey * o.ux) <= o.hw; };
  for (const [x, y] of corners(b)) if (inside(a, x, y)) { const k = (x - a.cx) * -bn[0] + (y - a.cy) * -bn[1]; if (k > deep) { deep = k; px = x; py = y; } }
  if (deep === -Infinity) for (const [x, y] of corners(a)) if (inside(b, x, y)) { const k = (x - b.cx) * bn[0] + (y - b.cy) * bn[1]; if (k > deep) { deep = k; px = x; py = y; } }
  return { x: px, y: py, nx: bn[0], ny: bn[1], depth: best };
}

// contacts détaillés pour le jeu (frottements, chocs, objets mobiles)
export function makeContacts(world, getCars) {
  const fn = function contacts(bus) {
    const out = [];
    const g = bus.geo, S = bus.samples, I = bus.inner;
    // murs
    let walls = 0;
    for (let i = 0; i < bus.nSamples && walls < 4; i++) {
      const x = S[2 * i], y = S[2 * i + 1];
      if (!solid(world.material(x, y))) continue;
      if (out.some((c) => Math.abs(c.x - x) < 1.2 && Math.abs(c.y - y) < 1.2)) continue;
      const sec = bus.sampleSec[i], o = g.obbs[sec];
      const deep = solid(world.material(I[2 * i], I[2 * i + 1]));
      const n = wallNormal(world, x, y, o.cx, o.cy);
      out.push({ kind: 'wall', sec, x, y, nx: n.x, ny: n.y, depth: deep ? INSET + 0.05 : 0.04 });
      walls++;
    }
    for (const mi of g.mirrors) {
      if (solid(world.material(mi.x, mi.y))) out.push({ kind: 'wall', part: 'mirror', mirror: mi.i, sec: 0, x: mi.x, y: mi.y, nx: 0, ny: 0, depth: 0.05 });
    }
    // obstacles
    const stamp = ++qstamp;
    for (const o of g.obbs) {
      world.queryObstacles(o.minx, o.miny, o.maxx, o.maxy, (ob) => {
        if (ob.down || ob._q === stamp) return;
        let c;
        if (ob.r !== undefined) c = circleContact(o, ob.x, ob.y, ob.r);
        else c = boxContact(o, ob);
        if (!c) return;
        ob._q = stamp;
        out.push({ ...c, kind: ob.kind, obj: ob, sec: o.sec });
      });
    }
    if (g.joint) {
      const J = g.joint;
      world.queryObstacles(J.x - J.r, J.y - J.r, J.x + J.r, J.y + J.r, (ob) => {
        if (ob.down || ob.r === undefined || ob._q === stamp) return;
        const d = Math.hypot(ob.x - J.x, ob.y - J.y);
        if (d < ob.r + J.r) { ob._q = stamp; out.push({ kind: ob.kind, obj: ob, sec: 0, x: J.x + ((ob.x - J.x) / d) * J.r, y: J.y + ((ob.y - J.y) / d) * J.r, nx: (J.x - ob.x) / d, ny: (J.y - ob.y) / d, depth: ob.r + J.r - d }); }
      });
    }
    // rétroviseurs contre éléments hauts
    for (const mi of g.mirrors) {
      world.queryObstacles(mi.x - 0.3, mi.y - 0.3, mi.x + 0.3, mi.y + 0.3, (ob) => {
        if (ob.down || !TALL.has(ob.kind)) return;
        const hit = ob.r !== undefined ? (ob.x - mi.x) ** 2 + (ob.y - mi.y) ** 2 < (ob.r + 0.1) ** 2 : obbCircle(ob, mi.x, mi.y, 0.1);
        if (hit) out.push({ kind: ob.kind, part: 'mirror', mirror: mi.i, obj: ob, sec: 0, x: mi.x, y: mi.y, nx: 0, ny: 0, depth: 0.05 });
      });
    }
    const cars = getCars ? getCars() : null;
    if (cars) {
      for (const car of cars) {
        if (car.ghost) continue;
        for (const o of g.obbs) {
          if (Math.abs(car.obb.cx - o.cx) > 16 || Math.abs(car.obb.cy - o.cy) > 16) continue;
          const c = boxContact(o, car.obb);
          if (c) { out.push({ ...c, kind: 'traffic', obj: car.obb, sec: o.sec }); break; }
        }
      }
    }
    return out;
  };
  return fn;
}

// collisionneur strict (planificateur et tests) : premier obstacle touché
export function makeCollider(world, getCars) {
  return function collide(bus) {
    const g = bus.geo, S = bus.samples;
    for (let i = 0; i < bus.nSamples; i++) {
      const m = world.material(S[2 * i], S[2 * i + 1]);
      if (m === MAT.BUILDING || m === MAT.WATER) return { kind: 'wall', x: S[2 * i], y: S[2 * i + 1] };
    }
    for (const mi of g.mirrors) {
      const m = world.material(mi.x, mi.y);
      if (m === MAT.BUILDING || m === MAT.WATER) return { kind: 'mirror', x: mi.x, y: mi.y };
    }
    const stamp = ++qstamp;
    let hit = null;
    const test = (o) => (ob) => {
      if (hit || ob.down || ob._q === stamp) return;
      ob._q = stamp;
      if (ob.r !== undefined) {
        if (obbCircle(o, ob.x, ob.y, ob.r)) hit = { kind: ob.kind, x: ob.x, y: ob.y, obj: ob };
      } else if (obbOverlap(o, ob)) hit = { kind: ob.kind, x: ob.cx, y: ob.cy, obj: ob };
    };
    for (const o of g.obbs) {
      world.queryObstacles(o.minx, o.miny, o.maxx, o.maxy, test(o));
      if (hit) return hit;
    }
    if (g.joint) {
      const J = g.joint;
      world.queryObstacles(J.x - J.r, J.y - J.r, J.x + J.r, J.y + J.r, (ob) => {
        if (hit || ob.down) return;
        if (ob.r !== undefined) { if ((ob.x - J.x) ** 2 + (ob.y - J.y) ** 2 < (ob.r + J.r) ** 2) hit = { kind: ob.kind, x: ob.x, y: ob.y, obj: ob }; }
        else if (obbCircle(ob, J.x, J.y, J.r)) hit = { kind: ob.kind, x: ob.cx, y: ob.cy, obj: ob };
      });
      if (hit) return hit;
      if (world.material(J.x, J.y) === MAT.BUILDING) return { kind: 'wall', x: J.x, y: J.y };
    }
    for (const mi of g.mirrors) {
      world.queryObstacles(mi.x - 0.3, mi.y - 0.3, mi.x + 0.3, mi.y + 0.3, (ob) => {
        if (hit || ob.down || !TALL.has(ob.kind)) return;
        const h = ob.r !== undefined ? (ob.x - mi.x) ** 2 + (ob.y - mi.y) ** 2 < (ob.r + 0.1) ** 2 : obbCircle(ob, mi.x, mi.y, 0.1);
        if (h) hit = { kind: 'mirror', x: mi.x, y: mi.y, obj: ob };
      });
      if (hit) return hit;
    }
    const cars = getCars ? getCars() : null;
    if (cars) {
      for (const c of cars) {
        if (c.ghost) continue;
        for (const o of g.obbs) {
          if (Math.abs(c.obb.cx - o.cx) > 16 || Math.abs(c.obb.cy - o.cy) > 16) continue;
          if (obbOverlap(o, c.obb)) return { kind: 'traffic', x: c.obb.cx, y: c.obb.cy, obj: c };
        }
      }
    }
    return null;
  };
}
