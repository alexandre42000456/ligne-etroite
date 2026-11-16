// Modèles de bus et physique : bicyclette cinématique (+ remorque pour l'articulé),
// moteur à puissance limitée, boîte automatique, freinage, collisions.
import { DEG, clamp, wrapAngle, obbCircle, obbOverlap } from './geom.js';
import { MAT } from './world.js';

export const BUS_TYPES = {
  '12': {
    id: '12', label: '12 m', name: 'Citadin standard', len: 12.0, width: 2.55, fo: 2.75, wb: 5.9,
    maxSteer: 49 * DEG, mass: 11500, cap: 95, power: 220e3, aCap: 1.5,
    doorDist: [1.05, 5.6, 9.55], axlesDesc: '2 essieux',
  },
  '15': {
    id: '15', label: '15 m', name: 'Trois essieux', len: 14.9, width: 2.55, fo: 2.75, wb: 6.85, tag: 0.7,
    maxSteer: 48 * DEG, mass: 14000, cap: 120, power: 260e3, aCap: 1.4,
    doorDist: [1.05, 6.4, 12.0], axlesDesc: '3 essieux (essieu suiveur non directeur)',
  },
  '18': {
    id: '18', label: '18 m', name: 'Articulé', len: 18.13, width: 2.55, fo: 2.8, wb: 5.85,
    artic: { c: 1.75, l2: 4.24, ro2: 3.49, maxAng: 52 * DEG },
    maxSteer: 46 * DEG, mass: 17000, cap: 145, power: 290e3, aCap: 1.3,
    doorDist: [1.05, 6.2, 12.7, 16.2], axlesDesc: '3 essieux, articulation à 52°',
  },
};

// caractéristiques dérivées (porte-à-faux, rayon de braquage…)
for (const T of Object.values(BUS_TYPES)) {
  T.ro = T.artic ? T.artic.ro2 : T.len - T.fo - T.wb;
  const R = T.wb / Math.tan(T.maxSteer);
  T.turnCircle = 2 * Math.hypot(T.wb + T.fo, R + T.width / 2);
  T.innerR = R - T.width / 2;
  T.doors = T.doorDist; // alias
}

const GEAR_K = [0, 118, 68, 47.5, 34.5, 26.4, 21.1]; // tr/min par km/h
const SAMPLE_STEP = 0.3;

export class Bus {
  constructor(T, pose) {
    this.T = T;
    this.x = pose.x; this.y = pose.y; this.th = pose.th;
    this.th2 = pose.th;
    this.v = 0; this.steer = 0; this.acc = 0; this.latAcc = 0;
    this.gear = 'D'; this.g = 1; this.rpm = 650; this.shiftT = 0;
    this.doors = 0; this.doorOpen = false;
    this.pax = 0;
    this.blink = 0; this.blinkT = 0;
    this.braking = 0; this.throttle = 0;
    this.odo = 0;
    this.buildLocal();
    this.updateGeo();
    this.wheelState = this.geo.wheels.map(() => true);
  }

  buildLocal() {
    const T = this.T, hw = T.width / 2;
    const secs = [];
    if (T.artic) {
      const A = T.artic;
      secs.push({ x0: -(A.c - 0.5), x1: T.wb + T.fo, hw });
      secs.push({ x0: -A.ro2, x1: A.l2 - 0.5, hw });
    } else secs.push({ x0: -T.ro, x1: T.wb + T.fo, hw });
    for (const s of secs) {
      const pts = [];
      const nL = Math.ceil((s.x1 - s.x0) / SAMPLE_STEP), nW = Math.ceil((2 * hw) / SAMPLE_STEP);
      for (let i = 0; i <= nL; i++) {
        const x = s.x0 + ((s.x1 - s.x0) * i) / nL;
        pts.push(x, -hw, x, hw);
      }
      for (let j = 1; j < nW; j++) {
        const y = -hw + (2 * hw * j) / nW;
        pts.push(s.x0, y, s.x1, y);
      }
      s.local = new Float64Array(pts);
    }
    this.secs = secs;
    // roues : x local, section, bord extérieur du pneu
    const W = [];
    W.push({ sec: 0, x: T.wb, steer: true, edge: 1.15 });
    if (T.tag) {
      W.push({ sec: 0, x: T.tag, edge: 1.21, twin: true });
      W.push({ sec: 0, x: -T.tag, edge: 1.15 });
    } else W.push({ sec: 0, x: 0, edge: 1.21, twin: true });
    if (T.artic) W.push({ sec: 1, x: 0, edge: 1.21, twin: true });
    this.wheelDefs = [];
    for (const w of W) for (const side of [-1, 1]) this.wheelDefs.push({ ...w, side });
    // portes (côté droit)
    this.doorDefs = T.doorDist.map((d) => {
      if (!T.artic) return { sec: 0, x: T.wb + T.fo - d };
      const front = T.wb + T.fo;
      const toJoint = front + T.artic.c;
      return d < toJoint ? { sec: 0, x: front - d } : { sec: 1, x: T.artic.l2 - (d - toJoint) };
    });
    this.nSamples = secs.reduce((n, s) => n + s.local.length / 2, 0);
    this.samples = new Float64Array(this.nSamples * 2);
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
      const L = s.local;
      for (let j = 0; j < L.length; j += 2) {
        this.samples[k++] = P.x + ux * L[j] - uy * L[j + 1];
        this.samples[k++] = P.y + uy * L[j] + ux * L[j + 1];
      }
    }
    if (this.T.artic) {
      const P = g.poses[1];
      g.joint = { x: P.jx, y: P.jy, r: 1.15 };
    }
    // rétroviseurs (à 2 m de haut : touchent murs, poteaux, arbres)
    const P0 = g.poses[0], ux = Math.cos(P0.th), uy = Math.sin(P0.th);
    const mx = this.T.wb + this.T.fo - 0.3, my = this.T.width / 2 + 0.3;
    g.mirrors = [
      { x: P0.x + ux * mx + uy * my, y: P0.y + uy * mx - ux * my, side: -1 },
      { x: P0.x + ux * mx - uy * my, y: P0.y + uy * mx + ux * my, side: 1 },
    ];
    g.wheels.length = 0;
    for (const w of this.wheelDefs) {
      const P = g.poses[w.sec];
      const cx = Math.cos(P.th), cy = Math.sin(P.th);
      const ly = w.side * w.edge;
      g.wheels.push({
        x: P.x + cx * w.x - cy * ly, y: P.y + cy * w.x + cx * ly,
        ax: cx * 0.28, ay: cy * 0.28, def: w,
      });
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

  // inp : {steer (rad roue), throttle 0..1, brake 0..1}
  step(dt, inp, collide, material) {
    const T = this.T;
    const ev = { hit: null, curb: 0, artic: false };
    // direction assistée : vitesse de braquage limitée
    const target = clamp(inp.steer, -T.maxSteer, T.maxSteer);
    const rate = 62 * DEG;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    // portes : 2 s pour ouvrir/fermer, frein d'arrêt tant qu'elles ne sont pas fermées
    const dTarget = this.doorOpen ? 1 : 0;
    if (this.doors !== dTarget) {
      this.doors = clamp(this.doors + Math.sign(dTarget - this.doors) * dt / 1.6, 0, 1);
      if (Math.abs(this.doors - dTarget) < 1e-3) this.doors = dTarget;
    }
    const stopBrake = this.doors > 0 || this.doorOpen;

    let thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (stopBrake) { thr = 0; brk = Math.max(brk, 0.55); }
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
      const vmax = dirG > 0 ? 70 / 3.6 : 9 / 3.6;
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
    this.acc = (this.v - v0) / dt;

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
    if (this.v !== 0 || old.th !== this.th) {
      this.updateGeo();
      const hit = ev.artic ? { kind: 'artic' } : collide(this);
      if (hit) {
        ev.hit = hit;
        ev.hitSpeed = Math.abs(v0);
        this.x = old.x; this.y = old.y; this.th = old.th; this.th2 = old.th2;
        this.v = 0; this.acc = 0; this.latAcc = 0;
        this.updateGeo();
      } else {
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
    }
    // clignotants
    if (this.blink) this.blinkT += dt; else this.blinkT = 0;
    return ev;
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
    for (let i = 0; i <= n; i++) {
      const c = Math.cos(th), s = Math.sin(th);
      tr[0].push(x + c * xf + s * hw, y + s * xf - c * hw);
      tr[1].push(x + c * xf - s * hw, y + s * xf + c * hw);
      const P = last ? this.secPose(1, x, y, th, th2) : { x, y, th };
      const c2 = Math.cos(P.th), s2 = Math.sin(P.th);
      tr[2].push(P.x + c2 * x0 + s2 * hw, P.y + s2 * x0 - c2 * hw);
      tr[3].push(P.x + c2 * x0 - s2 * hw, P.y + s2 * x0 + c2 * hw);
      // roue arrière intérieure
      const side = this.steer >= 0 ? 1 : -1;
      tr[4].push(P.x - s2 * 1.21 * side, P.y + c2 * 1.21 * side);
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
    // côté droit = intérieur quand on tourne à droite
    return s > 0 ? [s * outer, s * inner] : [s * inner, s * outer];
  }
}

let qstamp = 1;
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
      if (hit || ob._q === stamp) return;
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
        if (hit) return;
        if (ob.r !== undefined) { if ((ob.x - J.x) ** 2 + (ob.y - J.y) ** 2 < (ob.r + J.r) ** 2) hit = { kind: ob.kind, x: ob.x, y: ob.y, obj: ob }; }
        else if (obbCircle(ob, J.x, J.y, J.r)) hit = { kind: ob.kind, x: ob.cx, y: ob.cy, obj: ob };
      });
      if (hit) return hit;
      if (world.material(J.x, J.y) === MAT.BUILDING) return { kind: 'wall', x: J.x, y: J.y };
    }
    // rétroviseurs contre éléments hauts
    for (const mi of g.mirrors) {
      world.queryObstacles(mi.x - 0.3, mi.y - 0.3, mi.x + 0.3, mi.y + 0.3, (ob) => {
        if (hit || ob.r === undefined) return;
        if (ob.kind !== 'lamp' && ob.kind !== 'tree' && ob.kind !== 'signal' && ob.kind !== 'stoppole') return;
        if ((ob.x - mi.x) ** 2 + (ob.y - mi.y) ** 2 < (ob.r + 0.1) ** 2) hit = { kind: 'mirror', x: mi.x, y: mi.y, obj: ob };
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
