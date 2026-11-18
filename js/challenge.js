// Déroulement d'un défi : chronomètre, progression, cible de stationnement, score
import { Polyline, clamp, wrapAngle, DEG } from './geom.js';
import { newScore, trackIncidents, safetyScore } from './incidents.js';

// courbe lissée passant par les points (Catmull-Rom)
export function smoothPts(pts, step = 1) {
  const P = pts.map(([x, y]) => ({ x, y }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...P[P.length - 1] });
  return out;
}

// pose du véhicule dont l'arrière (dernière caisse) est au point visé, en ligne droite
export function poseFromRear(T, x, y, th) {
  const ux = Math.cos(th), uy = Math.sin(th);
  if (!T.artic) return { x: x + ux * T.ro, y: y + uy * T.ro, th, th2: th };
  const A = T.artic;
  const back = A.ro2 + A.l2 + A.c; // de l'arrière à l'essieu de référence du tracteur
  return { x: x + ux * back, y: y + uy * back, th, th2: th };
}

export function challengePath(world, def) {
  if (def.path && def.path.nodes) {
    const L = world.buildLine({ id: def.id, nodes: def.path.nodes, stops: [] });
    return { path: L.path, maneuvers: L.maneuvers };
  }
  if (def.path) return { path: new Polyline(smoothPts(def.path.pts)), maneuvers: [] };
  return { path: def.guide ? new Polyline(smoothPts(def.guide)) : null, maneuvers: [] };
}

export function startPose(world, def, T) {
  if (def.start) return { ...def.start, th2: def.start.th };
  const { path } = challengePath(world, def);
  const s = T.behind + 1.5;
  const q = path.at(s), d = path.dirAt(s, 1.5);
  const th = Math.atan2(d.uy, d.ux);
  return { x: q.x, y: q.y, th, th2: th };
}

export class Challenge {
  constructor(world, def, T) {
    this.kind = 'challenge';
    this.def = def;
    this.T = T;
    this.free = false;
    const { path, maneuvers } = challengePath(world, def);
    const color = def.color || '#ffb300';
    this.line = { id: def.badge, color, path, maneuvers, stops: [], def: { id: def.badge, color, to: def.name, name: def.name } };
    this.pathLevel = !!def.path;
    this.finishS = path && this.pathLevel ? path.len - (def.finishBack ?? 8) : Infinity;
    this.par = def.par ?? Math.round(this.pathLevel ? path.len / 2.4 + 12 : 75);
    this.target = def.target || null;
    this.time = 0;
    this.started = false;
    this.s = 0;
    this.msgs = [];
    this.sc = newScore();
    this.onboard = []; this.waiting = []; this.peds = [];
    this.speedLimit = 30;
    this.street = def.name;
    this.hold = 0;
    this.finished = false;
  }

  say(text, kind = 'info', dur = 2.6) { this.msgs.push({ text, kind, t: dur }); }
  stopAt() { return null; }
  nextManeuver() {
    for (const m of this.line.maneuvers) if (m.s + m.len * 0.6 > this.s) return { ...m, dist: m.s - this.s };
    return null;
  }

  // écart à la place visée (repère de la cible)
  targetError(bus) {
    const tg = this.target;
    const r = bus.rear;
    const ux = Math.cos(tg.th), uy = Math.sin(tg.th);
    const dx = r.x - tg.x, dy = r.y - tg.y;
    const along = dx * ux + dy * uy, lat = -dx * uy + dy * ux;
    const ang = Math.abs(wrapAngle(r.th - tg.th)) / DEG;
    const art = bus.T.artic ? Math.abs(wrapAngle(bus.th - bus.th2)) / DEG : 0;
    const t = tg.tol;
    const ok = Math.abs(lat) <= t.lat && Math.abs(along) <= t.along && ang <= t.ang && art <= 6;
    return { along, lat, ang, art, ok, dist: Math.hypot(dx, dy) };
  }

  update(dt, bus, ev, world, sigTime) {
    for (const m of this.msgs) m.t -= dt;
    this.msgs = this.msgs.filter((m) => m.t > 0);
    if (this.finished) return;
    if (!this.started && bus.kmh > 0.3) { this.started = true; this.say('C’est parti !', 'good', 1.4); }
    if (this.started) this.time += dt;
    trackIncidents(this, dt, bus, ev, world, sigTime);
    if (!this.def.traffic) this.speedLimit = Math.max(this.speedLimit, 20);
    const P = this.line.path;
    if (P) {
      const f = bus.front;
      const pr = P.project(f.x, f.y, this.s, this.time < 0.1 ? 200 : 30);
      if (pr.dist < 10) { this.s = Math.max(this.s, pr.s); this.offT = 0; }
      else if (this.pathLevel) {
        this.offT = (this.offT || 0) + dt;
        if (this.offT > 1.2 && this.offT - dt <= 1.2) this.say('Hors parcours ! Revenez sur le tracé', 'warn', 3);
      }
    }
    if (this.wrecked) { this.finish(true); return; }
    if (this.pathLevel && this.s >= this.finishS) this.finish(false);
    if (this.target) {
      const e = (this.err = this.targetError(bus));
      if (e.ok && Math.abs(bus.v) < 0.05) {
        this.hold += dt;
        if (this.hold >= 1.0) { this.say('Stationnement validé !', 'good', 2.5); this.finish(false); }
      } else this.hold = 0;
    }
  }

  finish(failed) {
    if (this.finished) return;
    this.finished = true;
    this.failed = failed;
    this.finishTime = this.time;
  }

  results() {
    const sc = this.sc;
    const safety = Math.round(safetyScore(sc));
    const time = this.finishTime ?? this.time;
    const timeScore = Math.round(time <= this.par ? 100 : clamp(100 - (time - this.par) * 1.5, 0, 100));
    let precision = Math.round(clamp(sc.comfort, 0, 100));
    if (this.target && this.err) precision = Math.round(clamp(100 - Math.abs(this.err.lat) * 120 - Math.abs(this.err.along) * 40 - this.err.ang * 6, 0, 100));
    const total = this.failed ? 0 : Math.round(safety * 0.6 + timeScore * 0.25 + precision * 0.15);
    const stars = this.failed ? 0 : total >= 90 && time <= this.par ? 3 : total >= 70 ? 2 : total >= 40 ? 1 : 0;
    return { kind: 'challenge', safety, time, timeScore, precision, total, stars, par: this.par, failed: this.failed, damage: Math.round(sc.damage) };
  }
}
