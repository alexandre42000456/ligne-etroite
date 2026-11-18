// Trafic : voitures qui suivent les voies, respectent les feux et laissent passer le bus
import { rng, obbContains, clamp } from './geom.js';

const COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2980b9', '#16a085', '#e67e22', '#8e44ad', '#f4d03f', '#1b1b1b', '#bdc3c7', '#27ae60', '#922b21'];

export class Traffic {
  constructor(world, seed = 7) {
    this.world = world;
    this.cars = [];
    this.R = rng(seed);
    this.max = 12;
    this.nextId = 1;
    this.spawnT = 0;
    // pas de voitures qui naissent dans les ruelles à double sens trop étroites pour croiser le bus
    this.lanes = world.lanes.filter((l) => l.line.len > 12 && (l.e.oneway || l.e.w >= 5.5));
  }

  reset() {
    for (const c of this.cars) c.obb.removed = true;
    this.cars.length = 0;
  }

  pickNext(lane) {
    const opts = lane.conns.filter((c) => c.turn !== 'U' && c.to.line.len > 6);
    if (!opts.length) return null;
    let tot = 0;
    const w = opts.map((c) => { const k = c.turn === 'S' || c.turn === 'O' ? 2 : 1; tot += k; return k; });
    let r = this.R() * tot;
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[opts.length - 1];
  }

  spawn(bus, view) {
    for (let tries = 0; tries < 12; tries++) {
      const lane = this.lanes[(this.R() * this.lanes.length) | 0];
      const s = 4 + this.R() * (lane.line.len - 8);
      const p = lane.line.at(s);
      const d = Math.hypot(p.x - bus.x, p.y - bus.y);
      if (d < 75 || d > 210) continue;
      if (view && Math.hypot(p.x - view.x, p.y - view.y) < view.r) continue;
      if (this.cars.some((c) => Math.hypot(c.obb.cx - p.x, c.obb.cy - p.y) < 12)) continue;
      const L = 4.0 + this.R() * 0.8;
      const car = {
        id: this.nextId++, lane, seg: lane.line, onConn: null, s, v: 5 + this.R() * 4,
        L, W: 1.78, color: COLORS[(this.R() * COLORS.length) | 0], factor: 0.85 + this.R() * 0.25,
        next: this.pickNext(lane), wait: 0, ignoreCars: 0, ghost: false, fade: 1, braking: false, blink: 0,
        obb: { cx: p.x, cy: p.y, ux: p.ux, uy: p.uy, hl: L / 2, hw: 0.89, inGrid: false, kind: 'traffic' },
      };
      car.obb.car = car;
      this.place(car);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  place(c) {
    const q = c.seg.at(c.s);
    const d = c.seg.dirAt(c.s, 1.2);
    c.obb.cx = q.x; c.obb.cy = q.y; c.obb.ux = d.ux; c.obb.uy = d.uy;
  }

  // distance libre devant la voiture (bus, autres voitures, feu rouge)
  probe(c, bus, t, maxD) {
    const step = 1.5;
    let seg = c.seg, s = c.s + c.L / 2, onConn = c.onConn, next = c.next, lane = c.lane;
    let dist = 0;
    const busObbs = bus ? bus.geo.obbs : [];
    const joint = bus && bus.geo.joint;
    let blockedBy = null;
    while (dist < maxD) {
      if (s > seg.len) {
        // passage au segment suivant
        if (!onConn) {
          // fin de voie : feu ?
          if (lane.signal) {
            const st = this.world.signalState(lane.signal, t);
            const stopD = dist - 1.0;
            if (st === 'R' || (st === 'Y' && stopD > (c.v * c.v) / 6)) return { d: Math.max(0, stopD), by: 'light' };
          }
          if (!next) return { d: dist, by: 'end' };
          // priorité : carrefour occupé par une trajectoire en conflit
          if (c.ignoreCars <= 0 && next.conflicts && next.conflicts.size) {
            for (const o of this.cars) {
              if (o === c || o.ghost) continue;
              if ((o.onConn && next.conflicts.has(o.onConn)) || (o.resv && next.conflicts.has(o.resv))) return { d: Math.max(0, dist - 0.8), by: 'yield', car: o };
            }
          }
          s -= seg.len; seg = next.line; onConn = next;
        } else {
          s -= seg.len; lane = onConn.to; seg = lane.line; onConn = null; next = null;
          if (!seg) break;
        }
        continue;
      }
      const p = seg.at(s);
      for (const o of busObbs) {
        if (obbContains(o, p.x, p.y, 1.45)) return { d: dist, by: 'bus' };
      }
      if (joint && (p.x - joint.x) ** 2 + (p.y - joint.y) ** 2 < (joint.r + 1.3) ** 2) return { d: dist, by: 'bus' };
      if (c.ignoreCars <= 0) {
        for (const o of this.cars) {
          if (o === c || o.ghost) continue;
          if (Math.abs(o.obb.cx - p.x) > 6 || Math.abs(o.obb.cy - p.y) > 6) continue;
          if (obbContains(o.obb, p.x, p.y, 1.1)) { blockedBy = o; return { d: dist, by: 'car', car: o }; }
        }
      }
      s += step; dist += step;
    }
    return { d: maxD, by: null };
  }

  update(dt, bus, t, view) {
    this.spawnT -= dt;
    if (this.lanes.length && this.spawnT <= 0 && this.cars.length < this.max) {
      this.spawn(bus, view);
      this.spawnT = 0.6;
    }
    for (const c of this.cars) {
      if (c.ghost) { c.fade -= dt / 2.5; continue; }
      // voiture percutée : elle subit la physique (monde) et reste immobilisée, feux de détresse
      if (c.obb.dyn) { c.crashed = true; c.v = 0; c.braking = true; c.blink = 2; c.crashT = (c.crashT || 0) + dt; continue; }
      if (c.ignoreCars > 0) c.ignoreCars -= dt;
      const lim = (c.onConn ? (c.onConn.turn === 'S' ? c.lane.speed : c.onConn.turn === 'O' ? 22 : 15) : c.lane.speed) / 3.6;
      let vT = lim * c.factor;
      // ralentir avant un virage
      if (!c.onConn && c.next && c.next.turn !== 'S') {
        const rem = c.seg.len - c.s;
        const vt = (c.next.turn === 'O' ? 22 : 15) / 3.6;
        vT = Math.min(vT, Math.sqrt(vt * vt + 2 * 1.8 * Math.max(0, rem - 2)));
      }
      const look = 6 + c.v * 1.4 + (c.v * c.v) / 5;
      const pr = this.probe(c, bus, t, look);
      c.blockedBy = pr.by === 'car' || pr.by === 'yield' ? pr.car : null;
      // réservation du carrefour quand on s'apprête à s'y engager
      if (!c.onConn) {
        const rem = c.seg.len - c.s;
        const engaging = c.next && rem < 3 + c.v * 1.3 && pr.by !== 'light' && pr.by !== 'yield';
        c.resv = engaging ? c.next : null;
      } else c.resv = null;
      // face à face avec le bus dans une rue trop étroite : la voiture finit par faire demi-tour
      c.busWait = pr.by === 'bus' && c.v < 0.3 ? (c.busWait || 0) + dt : 0;
      if (c.busWait > 7) { c.ghost = true; c.fade = 1; continue; }
      if (pr.by && pr.by !== 'end') {
        const gap = pr.by === 'light' ? 0.5 : 2.2;
        vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 3.2 * (pr.d - gap))));
        if (pr.d < gap + 0.3) vT = 0;
      }
      const a = vT > c.v ? 1.7 : -Math.min(7, Math.max(2.5, (c.v - vT) * 3));
      c.braking = a < -1;
      c.v = clamp(c.v + a * dt, 0, Math.max(vT, 0) + (a > 0 ? 0 : 99));
      if (vT <= 0.01 && c.v < 0.3) c.v = 0;
      c.wait = c.v < 0.2 ? c.wait + dt : 0;
      c.blink = !c.onConn && c.next && (c.next.turn === 'L' || c.next.turn === 'R') && c.seg.len - c.s < 30 ? (c.next.turn === 'L' ? -1 : 1) : c.onConn && (c.onConn.turn === 'L' || c.onConn.turn === 'R') ? (c.onConn.turn === 'L' ? -1 : 1) : 0;
      c.s += c.v * dt;
      while (c.s > c.seg.len) {
        c.s -= c.seg.len;
        if (!c.onConn) {
          if (!c.next) { c.ghost = true; c.fade = 0; break; }
          c.onConn = c.next; c.seg = c.next.line;
        } else {
          c.lane = c.onConn.to; c.seg = c.lane.line; c.onConn = null;
          c.next = this.pickNext(c.lane);
        }
      }
      if (!c.ghost) this.place(c);
    }
    // interblocages : l'un des deux passe
    for (const c of this.cars) {
      const o = c.blockedBy;
      if (o && o.blockedBy === c && c.id < o.id && c.wait > 1.5) c.ignoreCars = 2.5;
    }
    // retrait
    this.cars = this.cars.filter((c) => {
      if (c.ghost && c.fade <= 0) { c.obb.removed = true; return false; }
      const d = Math.hypot(c.obb.cx - bus.x, c.obb.cy - bus.y);
      const visible = view && Math.hypot(c.obb.cx - view.x, c.obb.cy - view.y) < view.r;
      const gone = d > 260 || (c.wait > 25 && !visible) || (c.crashed && c.crashT > 30 && !visible);
      if (gone) c.obb.removed = true;
      return !gone;
    });
  }
}
