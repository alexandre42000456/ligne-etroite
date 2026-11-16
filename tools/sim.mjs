// Vérifie que chaque ligne est faisable avec chaque bus : pilote automatique (poursuite pure)
// sur la physique réelle du jeu, sans trafic. Usage : node tools/sim.mjs [ligne] [bus]
import { World, MAT } from '../js/world.js';
import { CITY } from '../js/city.js';
import { Bus, BUS_TYPES, makeCollider } from '../js/bus.js';
import { clamp, wrapAngle, Polyline } from '../js/geom.js';

const world = new World(CITY);
const collide = makeCollider(world, null);
const mat = (x, y) => world.material(x, y);
const onlyLine = process.argv[2], onlyBus = process.argv[3];
const VERBOSE = process.argv.includes('-v');

// trajectoire de conduite : tracé de ligne décalé vers l'extérieur avant chaque virage serré
function drivePath(line, T, swing) {
  const P = line.path;
  const out = [];
  const curv = (s) => {
    const a = P.dirAt(s - 4, 2), b = P.dirAt(s + 4, 2);
    return wrapAngle(Math.atan2(b.uy, b.ux) - Math.atan2(a.uy, a.ux)) / 8;
  };
  for (let s = 0; s <= P.len; s += 1) {
    // décalage : on regarde le virage à venir (≈ porte-à-faux + empattement)
    let km = 0;
    for (let d = -2; d <= T.wb + T.fo + 6; d += 2) {
      const k = curv(s + d);
      if (Math.abs(k) > Math.abs(km)) km = k;
    }
    const off = Math.abs(km) > 0.04 ? -Math.sign(km) * Math.min(1, Math.abs(km) * 6) : 0;
    const q = P.at(s);
    out.push({ x: q.x - q.uy * off * swing, y: q.y + q.ux * off * swing });
  }
  return new Polyline(out);
}

function run(line, T, swing, maxT = 600) {
  const st = line.stops[0].st;
  const bus = new Bus(T, world.dockPose(st, T));
  const path = drivePath(line, T, swing);
  let s = path.project(bus.x, bus.y).s, t = 0;
  const hits = [], curbs = [];
  let lastHit = -10;
  const dt = 1 / 120;
  let stuck = 0;
  while (t < maxT) {
    t += dt;
    const f = bus.front;
    const pr = path.project(bus.x, bus.y, s, 20);
    s = pr.s;
    if (s > path.len - 3) break;
    // poursuite pure sur l'essieu de référence
    const v = Math.abs(bus.v);
    const Ld = clamp(T.wb * 0.9 + v * 0.6, 4.5, 11);
    const g = path.at(Math.min(path.len, s + Ld));
    const ang = wrapAngle(Math.atan2(g.y - bus.y, g.x - bus.x) - bus.th);
    const steer = Math.atan2(2 * T.wb * Math.sin(ang), Ld);
    // vitesse visée selon la courbure à venir
    let vT = 30 / 3.6;
    for (let d = 0; d < 40; d += 3) {
      const a = path.dirAt(s + d - 3, 2), b = path.dirAt(s + d + 3, 2);
      const k = Math.abs(wrapAngle(Math.atan2(b.uy, b.ux) - Math.atan2(a.uy, a.ux))) / 6;
      const vk = k > 0.01 ? Math.sqrt(1.6 / k) : 99;
      vT = Math.min(vT, Math.sqrt(vk * vk + 2 * 1.2 * d));
    }
    vT = Math.max(vT, 2.2);
    const thr = bus.v < vT ? clamp((vT - bus.v) * 0.8, 0, 1) : 0;
    const brk = bus.v > vT + 0.5 ? clamp((bus.v - vT) * 0.5, 0, 1) : 0;
    const ev = bus.step(dt, { steer, throttle: thr, brake: brk }, collide, mat);
    if (ev.hit) {
      if (t - lastHit > 1) hits.push({ t: t.toFixed(1), s: s.toFixed(0), kind: ev.hit.kind, x: (ev.hit.x ?? bus.x).toFixed(1), y: (ev.hit.y ?? bus.y).toFixed(1) });
      lastHit = t;
      stuck += dt;
      if (stuck > 2) break;
      // contournement : on recule un peu
      for (let k = 0; k < 120; k++) bus.step(dt, { steer: 0, throttle: 0, brake: 1 }, collide, mat);
      continue;
    } else stuck = 0;
    if (ev.curb) {
      const w = bus.geo.wheels.find((w, i) => !bus.wheelState[i]);
      curbs.push({ s: s.toFixed(0), x: (w ? w.x : bus.x).toFixed(1), y: (w ? w.y : bus.y).toFixed(1), wheel: w ? (w.def.steer ? 'AV' : w.def.sec ? 'remorque' : 'AR') + (w.def.side > 0 ? 'd' : 'g') : '' });
    }
  }
  return { done: s > path.len - 3, t: t.toFixed(0), hits, curbs, len: path.len.toFixed(0) };
}

for (const line of world.lines) {
  if (onlyLine && line.id !== onlyLine) continue;
  for (const T of Object.values(BUS_TYPES)) {
    if (onlyBus && T.id !== onlyBus) continue;
    let best = null;
    for (const swing of [0, 0.8, 1.5, 2.2]) {
      const r = run(line, T, swing);
      r.swing = swing;
      if (!best || (r.done && !best.done) || (r.done === best.done && r.hits.length * 10 + r.curbs.length < best.hits.length * 10 + best.curbs.length)) best = r;
      if (r.done && !r.hits.length && !r.curbs.length) break;
    }
    const flag = best.done && !best.hits.length ? (best.curbs.length ? 'OK (trottoir)' : 'OK') : 'ÉCHEC';
    console.log(`Ligne ${line.id.padEnd(2)} bus ${T.id} : ${flag.padEnd(13)} décalage ${best.swing} · ${best.t}s · collisions ${best.hits.length} · trottoirs ${best.curbs.length}${line.def.bus === T.id ? '   ← conseillé' : ''}`);
    if (VERBOSE || line.def.bus === T.id) {
      for (const h of best.hits) console.log('    collision', h);
      for (const c of best.curbs.slice(0, 12)) console.log('    trottoir ', c);
    }
  }
}
