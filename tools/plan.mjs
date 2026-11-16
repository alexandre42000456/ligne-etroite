// Planificateur A* (cinématique réelle, porte-à-faux, rétroviseurs, remorque) :
// prouve qu'un conducteur peut suivre chaque ligne sans collision.
// Usage : node tools/plan.mjs [ligne] [bus]      (utilisable aussi dans le navigateur)
import { World, MAT } from '../js/world.js';
import { CITY } from '../js/city.js';
import { Bus, BUS_TYPES, makeCollider } from '../js/bus.js';
import { wrapAngle, DEG } from '../js/geom.js';

class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= n.f) break; a[i] = a[p]; i = p; } a[i] = n; }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1, mf = last.f;
        if (l < a.length && a[l].f < mf) { m = l; mf = a[l].f; }
        if (r < a.length && a[r].f < mf) { m = r; }
        if (m < 0) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
  get size() { return this.a.length; }
}

const LEVELS = [-1, -0.7, -0.4, -0.15, 0, 0.15, 0.4, 0.7, 1];

export function plan(world, collide, bus, path, start, sGoal, budget = 90000) {
  const T = bus.T;
  const open = new Heap();
  const best = new Map();
  const key = (x, y, th, th2) => {
    const kx = Math.round(x / 0.45), ky = Math.round(y / 0.45);
    const kt = ((Math.round(th / (4 * DEG)) % 90) + 90) % 90;
    const ka = T.artic ? Math.round(wrapAngle(th - th2) / (7 * DEG)) + 8 : 0;
    return ((kx * 2000 + ky) * 90 + kt) * 17 + ka;
  };
  open.push({ ...start, g: 0, f: 0, parent: null, lvl: 4, curb: 0 });
  let exp = 0;
  while (open.size && exp < budget) {
    const n = open.pop();
    exp++;
    if (n.s >= sGoal) return { node: n, exp };
    for (let l = 0; l < LEVELS.length; l++) {
      const dl = Math.abs(l - n.lvl);
      if (dl > 4) continue;
      let x = n.x, y = n.y, th = n.th, th2 = n.th2;
      const tn = Math.tan(LEVELS[l] * T.maxSteer);
      let ok = true, curb = 0;
      for (let k = 0; k < 4; k++) {
        const st = 0.3;
        const om = (st * tn) / T.wb, thm = th + om / 2;
        x += st * Math.cos(thm); y += st * Math.sin(thm);
        if (T.artic) {
          const A = T.artic, d = wrapAngle(thm - th2);
          th2 += (st * Math.sin(d) - A.c * om * Math.cos(d)) / A.l2;
          if (Math.abs(wrapAngle(th + om - th2)) > A.maxAng) { ok = false; break; }
        }
        th += om;
        if (k === 1 || k === 3) {
          bus.x = x; bus.y = y; bus.th = th; bus.th2 = th2; bus.updateGeo();
          if (collide(bus)) { ok = false; break; }
          for (const w of bus.geo.wheels) { const m = world.material(w.x, w.y); if (m !== MAT.ROAD && m !== MAT.APRON) curb++; }
        }
      }
      if (!ok) continue;
      const pr = path.project(x, y, n.s, 14);
      if (pr.dist > 9) continue;
      const dirn = path.dirAt(pr.s, 2);
      if (Math.abs(wrapAngle(th - Math.atan2(dirn.uy, dirn.ux))) > 100 * DEG) continue;
      const g = n.g + 1.2 + dl * 0.35 + curb * 3 + Math.abs(pr.lat) * 0.04;
      const kk = key(x, y, th, th2);
      const prev = best.get(kk);
      if (prev !== undefined && prev <= g) continue;
      best.set(kk, g);
      open.push({ x, y, th, th2, s: pr.s, g, f: g + (sGoal - pr.s) * 1.25, parent: n, lvl: l, curb: n.curb + curb });
    }
  }
  return { node: null, exp };
}

// gabarit gonflé d'une marge (m) tout autour : laisse du jeu à un conducteur humain
export function inflate(T, m) {
  if (!m) return T;
  const I = { ...T, width: T.width + 2 * m, fo: T.fo + m, len: T.len + 2 * m };
  if (T.artic) I.artic = { ...T.artic, ro2: T.artic.ro2 + m };
  else I.ro = T.ro + m;
  return I;
}

// parcourt tout l'itinéraire par horizons glissants de 50 m
export function checkPath(world, path, pose, T, margin = 0) {
  const collide = makeCollider(world, null);
  const bus = new Bus(inflate(T, margin), pose);
  let state = { x: bus.x, y: bus.y, th: bus.th, th2: bus.th2, s: path.project(bus.x, bus.y).s };
  const end = path.len - 2;
  const fails = [], trace = [];
  let curbs = 0, exps = 0;
  while (state.s < end) {
    const goal = Math.min(end, state.s + 50);
    const r = plan(world, collide, bus, path, state, goal);
    exps += r.exp;
    if (!r.node) {
      fails.push({ s: Math.round(state.s), x: +state.x.toFixed(1), y: +state.y.toFixed(1), exp: r.exp });
      const s2 = state.s + 25, q = path.at(s2), d = path.dirAt(s2, 2), th = Math.atan2(d.uy, d.ux);
      state = { x: q.x, y: q.y, th, th2: th, s: s2 };
      continue;
    }
    const chain = [];
    for (let n = r.node; n; n = n.parent) chain.push(n);
    chain.reverse();
    let next = chain[chain.length - 1];
    for (const n of chain) if (n.s >= state.s + 32) { next = n; break; }
    for (const n of chain) { trace.push(n); if (n === next) break; }
    curbs += next.curb;
    state = { x: next.x, y: next.y, th: next.th, th2: next.th2, s: next.s };
  }
  return { fails, curbs, exps, trace };
}

export function checkLine(world, line, T, margin = 0) {
  const pose = world.dockPose(line.stops[0].st, T);
  if (margin) {
    // recule légèrement du trottoir pour que le gabarit gonflé ne démarre pas en collision
    const nx = -Math.sin(pose.th), ny = Math.cos(pose.th);
    pose.x -= nx * (margin + 0.05); pose.y -= ny * (margin + 0.05);
  }
  return checkPath(world, line.path, pose, T, margin);
}

// ---------------------------------------------------------------- CLI
const isMain = typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const world = new World(CITY);
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const [onlyLine, onlyBus] = args;
  const out = {};
  for (const line of world.lines) {
    if (onlyLine && line.id !== onlyLine) continue;
    for (const T of Object.values(BUS_TYPES)) {
      if (onlyBus && T.id !== onlyBus) continue;
      const t0 = Date.now();
      const r0 = checkLine(world, line, T, 0);
      const r1 = r0.fails.length ? r0 : checkLine(world, line, T, 0.15);
      const tag = (r) => (r.fails.length ? 'IMPOSSIBLE' : r.curbs ? `trottoir ${r.curbs}` : 'ok');
      console.log(`Ligne ${line.id.padEnd(2)} bus ${T.id} : exact ${tag(r0).padEnd(12)} marge 15 cm ${tag(r1).padEnd(12)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${line.def.bus === T.id ? '← conseillé' : ''}`);
      for (const f of r0.fails) console.log('    bloqué (exact)', f);
      if (!r0.fails.length) for (const f of r1.fails) console.log('    bloqué (marge)', f);
      out[line.id + ':' + T.id] = r0.fails.length ? 0 : r1.fails.length ? 1 : 2;
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out));
  if (process.argv.includes('--write') && !onlyLine && !onlyBus) {
    const { writeFileSync } = await import('node:fs');
    const file = new URL('../js/feasibility.js', import.meta.url);
    writeFileSync(file, `// Généré par tools/plan.mjs --write : 0 = gabarit impossible, 1 = passage au centimètre, 2 = faisable\nexport const FEASIBILITY = ${JSON.stringify(out, null, 0)};\n`);
    console.log('Écrit', file.pathname);
  }
}
