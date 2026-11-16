// Construction du monde : géométrie des rues, matériaux, obstacles, voies, arrêts, itinéraires
import {
  DEG, clamp, wrapAngle, cross, rng, makeBand, inBand, pointInPoly, polyBBox, flat,
  Polyline, offsetPts, bezierPts, obbCircle, obbOverlap, segIntersect,
} from './geom.js';

export const MAT = { ROAD: 0, WALK: 1, BUILDING: 2, GRASS: 3, ISLAND: 4, APRON: 5, WATER: 6 };
export const SOLID = (m) => m === MAT.BUILDING || m === MAT.WATER;
export const WHEEL_OK = (m) => m === MAT.ROAD || m === MAT.APRON;

const CAR_COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2980b9', '#16a085', '#f1c40f', '#8e44ad', '#d35400', '#1b1b1b', '#bdc3c7', '#556b2f', '#a93226', '#34495e'];

class SpatialGrid {
  constructor(w, h, cs) {
    this.cs = cs;
    this.nx = Math.ceil(w / cs) + 2;
    this.ny = Math.ceil(h / cs) + 2;
    this.cells = new Array(this.nx * this.ny);
  }
  idx(x, y) {
    const cx = Math.floor(x / this.cs) + 1, cy = Math.floor(y / this.cs) + 1;
    if (cx < 0 || cy < 0 || cx >= this.nx || cy >= this.ny) return -1;
    return cy * this.nx + cx;
  }
  forRange(minx, miny, maxx, maxy, fn) {
    const x0 = clamp(Math.floor(minx / this.cs) + 1, 0, this.nx - 1), x1 = clamp(Math.floor(maxx / this.cs) + 1, 0, this.nx - 1);
    const y0 = clamp(Math.floor(miny / this.cs) + 1, 0, this.ny - 1), y1 = clamp(Math.floor(maxy / this.cs) + 1, 0, this.ny - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(y * this.nx + x);
  }
}

export class World {
  constructor(city) {
    this.city = city;
    this.W = city.size[0];
    this.H = city.size[1];
    this.rand = rng(city.seed);
    this.nodes = new Map();
    this.edges = [];
    this.buildGraph();
    this.computeJunctions();
    this.buildShapes();
    this.buildLanes();
    this.buildStops();
    this.buildSignals();
    this.buildObstacles();
    this.buildMarkings();
    this.lines = city.lines.map((l) => this.buildLine(l));
  }

  // ---------------------------------------------------------------- graphe
  buildGraph() {
    for (const [id, def] of Object.entries(this.city.nodes)) {
      const d = Array.isArray(def) ? { p: def } : def;
      this.nodes.set(id, { id, x: d.p[0], y: d.p[1], ring: d.ring || null, signal: !!d.signal, zebra: !!d.zebra, cr: d.cr, br: d.br, inc: [] });
    }
    for (const st of this.city.streets) {
      let start = null, pts = [];
      for (const it of st.path) {
        if (typeof it === 'string') {
          const n = this.nodes.get(it);
          if (!n) throw new Error('Nœud inconnu ' + it);
          if (start) {
            pts.push({ x: n.x, y: n.y });
            this.addEdge(start, n, pts, st);
          }
          start = n;
          pts = [{ x: n.x, y: n.y }];
        } else pts.push({ x: it[0], y: it[1] });
      }
    }
  }
  addEdge(a, b, pts, st) {
    const e = {
      id: this.edges.length, a: a.id, b: b.id, na: a, nb: b, pts,
      name: st.name, w: st.w, sw: st.sw, hw: st.w / 2, hb: st.w / 2 + st.sw,
      oneway: !!st.oneway, park: st.park || '', speed: st.speed || 50, style: st.style || 'asphalt',
      trees: !!st.trees, lamps: st.lamps !== false && st.sw >= 1.8, center: !!st.center && !st.oneway, gate: !!st.gate,
    };
    e.line = new Polyline(pts);
    e.rline = new Polyline([...pts].reverse());
    e.len = e.line.len;
    this.edges.push(e);
    const p0 = pts[0], p1 = pts[1], q0 = pts[pts.length - 1], q1 = pts[pts.length - 2];
    const la = Math.hypot(p1.x - p0.x, p1.y - p0.y), lb = Math.hypot(q1.x - q0.x, q1.y - q0.y);
    a.inc.push({ e, atStart: true, ux: (p1.x - p0.x) / la, uy: (p1.y - p0.y) / la, seg: la, hw: e.hw, hb: e.hb });
    b.inc.push({ e, atStart: false, ux: (q1.x - q0.x) / lb, uy: (q1.y - q0.y) / lb, seg: lb, hw: e.hw, hb: e.hb });
  }
  edgeBetween(a, b) {
    for (const e of this.edges) {
      if (e.a === a && e.b === b) return { e, dir: 1 };
      if (e.a === b && e.b === a) return { e, dir: -1 };
    }
    throw new Error(`Pas de rue entre ${a} et ${b}`);
  }

  computeJunctions() {
    for (const n of this.nodes.values()) {
      for (const i of n.inc) i.ang = Math.atan2(i.uy, i.ux);
      n.inc.sort((p, q) => p.ang - q.ang);
      const deg = n.inc.length;
      for (const i of n.inc) {
        let jr = 0;
        if (n.ring) jr = n.ring.ro + 2.5;
        else if (deg >= 2) {
          let clear = 0, bend = false;
          for (const j of n.inc) {
            if (j === i) continue;
            const s = Math.abs(cross(i.ux, i.uy, j.ux, j.uy));
            const c = Math.abs(i.ux * j.ux + i.uy * j.uy);
            const opposite = i.ux * j.ux + i.uy * j.uy < -0.85;
            if (opposite) continue;
            bend = true;
            if (s < 0.15) continue;
            clear = Math.max(clear, (j.hw + i.hw * c) / s);
          }
          if (deg === 2 && !bend) jr = 0;
          else if (deg === 2) jr = clear * 0.5 + 0.5;
          else jr = clear + 1.0 + (n.zebra ? 3.8 : 0);
        }
        i.jr = Math.min(jr, i.e.len * 0.42);
        if (i.atStart) i.e.jrA = i.jr; else i.e.jrB = i.jr;
        i.zebraAt = n.zebra && deg >= 3 ? i.jr - 4.4 : null;
      }
    }
  }

  // ---------------------------------------------------------------- formes et matériaux
  buildShapes() {
    const S = (this.shapes = {
      rband: [], wband: [], rdisc: [], wdisc: [], island: [], rfil: [], wfil: [],
      rpoly: [], bpoly: [], water: [], wpoly: [], gpoly: [], curbArcs: [], ringCurbs: [], bays: [],
    });
    for (const e of this.edges) {
      const p = e.pts, n = p.length;
      for (let i = 0; i < n - 1; i++) {
        const capA = i > 0, capB = i < n - 2;
        const rb = makeBand(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, e.hw, capA, capB);
        rb.e = e;
        S.rband.push(rb);
        if (e.sw > 0) {
          const wb = makeBand(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, e.hb, capA, capB);
          wb.e = e;
          S.wband.push(wb);
        }
      }
    }
    for (const n of this.nodes.values()) {
      if (n.ring) {
        const R = n.ring;
        S.rdisc.push({ x: n.x, y: n.y, r: R.ro, r2: R.ro * R.ro });
        S.wdisc.push({ x: n.x, y: n.y, r: R.ro + R.sw, r2: (R.ro + R.sw) ** 2 });
        S.island.push({ x: n.x, y: n.y, ri: R.ri, ra: R.ra, ri2: R.ri * R.ri, ra2: R.ra * R.ra, r: R.ra });
        S.ringCurbs.push({ x: n.x, y: n.y, r: R.ro });
        for (const i of n.inc) {
          for (const side of [1, -1]) {
            const nx = -i.uy * side, ny = i.ux * side;
            const f = this.lineCircleFillet(n, i, nx, ny, i.hw, R.ro, n.cr ?? 7);
            if (f) { S.rfil.push(f); S.curbArcs.push(f.arc); }
            const g = this.lineCircleFillet(n, i, nx, ny, i.hb, R.ro + R.sw, n.br ?? 3);
            if (g) S.wfil.push(g);
          }
        }
        continue;
      }
      const deg = n.inc.length;
      if (deg === 0) continue;
      const minHw = Math.min(...n.inc.map((i) => i.hw));
      const minHb = Math.min(...n.inc.map((i) => i.hb));
      S.rdisc.push({ x: n.x, y: n.y, r: minHw, r2: minHw * minHw });
      if (minHb > minHw) S.wdisc.push({ x: n.x, y: n.y, r: minHb, r2: minHb * minHb });
      if (deg < 2) continue;
      for (let k = 0; k < deg; k++) {
        const i = n.inc[k], j = n.inc[(k + 1) % deg];
        let gap = j.ang - i.ang;
        if (deg === 2 && k === 1) gap += Math.PI * 2;
        if (gap <= 0) gap += Math.PI * 2;
        if (gap < 12 * DEG || gap > 170 * DEG) continue;
        const cr = n.cr ?? clamp(0.85 * Math.min(i.e.w, j.e.w), 3.5, 8);
        const br = n.br ?? 2.5;
        const maxI = Math.min(i.seg, i.e.len * 0.45), maxJ = Math.min(j.seg, j.e.len * 0.45);
        const f = this.lineLineFillet(n, i, i.hw, j, j.hw, cr, maxI, maxJ);
        if (f) { S.rfil.push(f); S.curbArcs.push(f.arc); }
        const g = this.lineLineFillet(n, i, i.hb, j, j.hb, br, maxI, maxJ);
        if (g) S.wfil.push(g);
      }
    }
    // zones
    for (const a of this.city.areas) {
      const p = flat(a.poly);
      const o = { p, bb: polyBBox(p), style: a.style || a.type };
      if (a.type === 'water') S.water.push(o);
      else if (a.type === 'walk') S.wpoly.push(o);
      else if (a.type === 'grass') S.gpoly.push(o);
      else if (a.type === 'road') S.rpoly.push(o);
    }
    for (const b of this.city.buildings) {
      const p = flat(b.poly);
      S.bpoly.push({ p, bb: polyBBox(p), style: b.style, label: b.label });
    }
    // porte de ville : deux tours et une voûte au-dessus de la chaussée
    this.gates = [];
    for (const e of this.edges) {
      if (!e.gate) continue;
      const q = e.line.at(e.len / 2);
      const nx = -q.uy, ny = q.ux;
      for (const side of [-1, 1]) {
        const cx = q.x + nx * side * (e.hw + 3.2), cy = q.y + ny * side * (e.hw + 3.2);
        const pts = [[-3, -3], [3, -3], [3, 3], [-3, 3]].map(([a, b]) => [cx + q.ux * a + nx * b, cy + q.uy * a + ny * b]);
        const p = flat(pts);
        S.bpoly.push({ p, bb: polyBBox(p), style: 'tower' });
      }
      this.gates.push({ x: q.x, y: q.y, ux: q.ux, uy: q.uy, hw: e.hw });
    }
    this.buildShapeGrid();
  }

  lineLineFillet(n, i, h1, j, h2, r, max1, max2) {
    const u1x = i.ux, u1y = i.uy, u2x = j.ux, u2y = j.uy;
    const n1x = -u1y, n1y = u1x, n2x = u2y, n2y = -u2x;
    const den = cross(u1x, u1y, u2x, u2y);
    if (Math.abs(den) < 0.05) return null;
    const solve = (k1, k2) => {
      const dx = k2 * n2x - k1 * n1x, dy = k2 * n2y - k1 * n1y;
      return { s: cross(dx, dy, u2x, u2y) / den, t: cross(dx, dy, u1x, u1y) / den };
    };
    let rr = r;
    for (let it = 0; it < 10 && rr >= 0.25; it++, rr *= 0.75) {
      const o = solve(h1 + rr, h2 + rr);
      if (!(o.s > 0 && o.t > 0 && o.s <= max1 && o.t <= max2)) continue;
      const O = { x: n.x + o.s * u1x + (h1 + rr) * n1x, y: n.y + o.s * u1y + (h1 + rr) * n1y };
      const T1 = { x: n.x + o.s * u1x + h1 * n1x, y: n.y + o.s * u1y + h1 * n1y };
      const T2 = { x: n.x + o.t * u2x + h2 * n2x, y: n.y + o.t * u2y + h2 * n2y };
      const c = solve(h1, h2);
      const C = { x: n.x + c.s * u1x + h1 * n1x, y: n.y + c.s * u1y + h1 * n1y };
      return this.makeFillet([C, T1, T2], [{ x: O.x, y: O.y, r: rr }], O, rr, T1, T2);
    }
    return null;
  }
  lineCircleFillet(n, i, nx, ny, h, Ro, r) {
    if (Ro <= h + 0.2) return null;
    const a = Math.sqrt((Ro + r) ** 2 - (h + r) ** 2);
    const O = { x: n.x + a * i.ux + (h + r) * nx, y: n.y + a * i.uy + (h + r) * ny };
    const T1 = { x: n.x + a * i.ux + h * nx, y: n.y + a * i.uy + h * ny };
    const k = Ro / (Ro + r);
    const T2 = { x: n.x + (O.x - n.x) * k, y: n.y + (O.y - n.y) * k };
    const sp = Math.sqrt(Ro * Ro - h * h);
    const P = { x: n.x + sp * i.ux + h * nx, y: n.y + sp * i.uy + h * ny };
    return this.makeFillet([P, T1, O, T2], [{ x: O.x, y: O.y, r }, { x: n.x, y: n.y, r: Ro }], O, r, T1, T2);
  }
  makeFillet(poly, discs, O, r, T1, T2) {
    const p = flat(poly);
    const a1 = Math.atan2(T1.y - O.y, T1.x - O.x), a2 = Math.atan2(T2.y - O.y, T2.x - O.x);
    return {
      p, bb: polyBBox(p), discs: discs.map((d) => ({ x: d.x, y: d.y, r: d.r, r2: d.r * d.r })),
      arc: { x: O.x, y: O.y, r, a1, a2, ccw: wrapAngle(a2 - a1) < 0 },
    };
  }

  buildShapeGrid() {
    const S = this.shapes;
    const g = (this.sgrid = new SpatialGrid(this.W, this.H, 12));
    const keys = ['island', 'rband', 'rdisc', 'rfil', 'rpoly', 'bpoly', 'water', 'wband', 'wdisc', 'wfil', 'wpoly', 'gpoly'];
    const add = (key, o, minx, miny, maxx, maxy) => {
      g.forRange(minx, miny, maxx, maxy, (ix) => {
        let c = g.cells[ix];
        if (!c) {
          c = g.cells[ix] = {};
          for (const k of keys) c[k] = [];
        }
        c[key].push(o);
      });
    };
    for (const k of ['rband', 'wband']) for (const b of S[k]) add(k, b, b.minx, b.miny, b.maxx, b.maxy);
    for (const k of ['rdisc', 'wdisc']) for (const d of S[k]) add(k, d, d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r);
    for (const d of S.island) add('island', d, d.x - d.ra, d.y - d.ra, d.x + d.ra, d.y + d.ra);
    for (const k of ['rfil', 'wfil', 'rpoly', 'bpoly', 'water', 'wpoly', 'gpoly']) for (const f of S[k]) add(k, f, f.bb.minx, f.bb.miny, f.bb.maxx, f.bb.maxy);
  }
  addRoadPoly(pts) {
    const p = flat(pts);
    const o = { p, bb: polyBBox(p) };
    this.shapes.rpoly.push(o);
    const g = this.sgrid;
    g.forRange(o.bb.minx, o.bb.miny, o.bb.maxx, o.bb.maxy, (ix) => {
      let c = g.cells[ix];
      if (!c) return;
      c.rpoly.push(o);
    });
    return o;
  }

  material(x, y) {
    const ix = this.sgrid.idx(x, y);
    if (ix < 0) return MAT.BUILDING;
    const c = this.sgrid.cells[ix];
    if (!c) return MAT.BUILDING;
    for (const d of c.island) {
      const dx = x - d.x, dy = y - d.y, q = dx * dx + dy * dy;
      if (q < d.ra2) return q < d.ri2 ? MAT.ISLAND : MAT.APRON;
    }
    for (const b of c.rband) if (inBand(x, y, b)) return MAT.ROAD;
    for (const d of c.rdisc) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r2) return MAT.ROAD;
    for (const f of c.rfil) if (inFillet(x, y, f)) return MAT.ROAD;
    for (const p of c.rpoly) if (inPoly(x, y, p)) return MAT.ROAD;
    for (const p of c.bpoly) if (inPoly(x, y, p)) return MAT.BUILDING;
    for (const p of c.water) if (inPoly(x, y, p)) return MAT.WATER;
    for (const b of c.wband) if (inBand(x, y, b)) return MAT.WALK;
    for (const d of c.wdisc) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r2) return MAT.WALK;
    for (const f of c.wfil) if (inFillet(x, y, f)) return MAT.WALK;
    for (const p of c.wpoly) if (inPoly(x, y, p)) return MAT.WALK;
    for (const p of c.gpoly) if (inPoly(x, y, p)) return MAT.GRASS;
    return MAT.BUILDING;
  }

  streetAt(x, y) {
    const ix = this.sgrid.idx(x, y);
    if (ix < 0) return null;
    const c = this.sgrid.cells[ix];
    if (!c) return null;
    for (const b of c.rband) if (inBand(x, y, b)) return b.e;
    return null;
  }

  // ---------------------------------------------------------------- voies de circulation
  laneOffsets(e) {
    let lo = -e.hw + 0.15, hi = e.hw - 0.15;
    if (e.park.includes('L') || e.park === 'B') lo += 2.1;
    if (e.park.includes('R') || e.park === 'B') hi -= 2.1;
    const c = (lo + hi) / 2, q = (hi - lo) / 4;
    if (e.oneway) return [{ dir: 1, off: c }];
    return [{ dir: 1, off: c + q }, { dir: -1, off: -(c - q) }];
  }
  buildLanes() {
    this.lanes = [];
    for (const e of this.edges) {
      e.lanes = {};
      for (const L of this.laneOffsets(e)) {
        const base = L.dir === 1 ? e.pts : [...e.pts].reverse();
        const off = offsetPts(base, L.off);
        const pl = new Polyline(off);
        const j0 = L.dir === 1 ? e.jrA : e.jrB, j1 = L.dir === 1 ? e.jrB : e.jrA;
        const s0 = Math.min(j0, pl.len * 0.45), s1 = Math.max(pl.len - j1, s0 + 1);
        const lane = {
          id: this.lanes.length, e, dir: L.dir, off: L.off,
          from: L.dir === 1 ? e.a : e.b, to: L.dir === 1 ? e.b : e.a,
          line: new Polyline(pl.slice(s0, s1, 2)), speed: e.speed, conns: [],
        };
        e.lanes[L.dir] = lane;
        this.lanes.push(lane);
      }
    }
    for (const n of this.nodes.values()) {
      const ins = this.lanes.filter((l) => l.to === n.id);
      const outs = this.lanes.filter((l) => l.from === n.id);
      const all = [];
      for (const li of ins) {
        for (const lo of outs) {
          if (lo.e === li.e && n.inc.length > 1) continue;
          const c = this.makeConnector(n, li, lo);
          li.conns.push(c);
          all.push(c);
        }
      }
      // trajectoires en conflit dans le carrefour (croisement ou même voie de sortie)
      for (const c of all) c.conflicts = new Set();
      if (n.ring) continue;
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j];
          if (a.from === b.from) continue;
          if (a.to === b.to || polyCross(a.line.pts, b.line.pts)) { a.conflicts.add(b); b.conflicts.add(a); }
        }
      }
    }
  }
  makeConnector(n, li, lo) {
    const p0 = li.line.at(li.line.len), d0 = li.line.dirAt(li.line.len - 1.5, 1.5);
    const p3 = lo.line.at(0), d3 = lo.line.dirAt(1.5, 1.5);
    const turnAng = wrapAngle(Math.atan2(d3.uy, d3.ux) - Math.atan2(d0.uy, d0.ux));
    let pts, turn, exit = 0;
    if (n.ring) {
      const R = n.ring;
      const rl = (R.ra + R.ro) / 2 + 0.4;
      const phIn = Math.atan2(p0.y - n.y, p0.x - n.x);
      const phOut = Math.atan2(p3.y - n.y, p3.x - n.x);
      const eps = 0.42;
      const ta = phIn - eps;
      let tb = phOut + eps;
      let span = ta - tb;
      while (span <= 0.3) span += Math.PI * 2;
      while (span > Math.PI * 2 + 0.3) span -= Math.PI * 2;
      const E = { x: n.x + rl * Math.cos(ta), y: n.y + rl * Math.sin(ta) };
      const X = { x: n.x + rl * Math.cos(ta - span), y: n.y + rl * Math.sin(ta - span) };
      const tE = { x: Math.sin(ta), y: -Math.cos(ta) };
      const tX = { x: Math.sin(ta - span), y: -Math.cos(ta - span) };
      const k1 = Math.hypot(E.x - p0.x, E.y - p0.y) * 0.45;
      pts = bezierPts(p0, { x: p0.x + d0.ux * k1, y: p0.y + d0.uy * k1 }, { x: E.x - tE.x * k1, y: E.y - tE.y * k1 }, E, 1);
      const nA = Math.max(4, Math.ceil((span * rl) / 1.5));
      for (let k = 1; k < nA; k++) {
        const a = ta - (span * k) / nA;
        pts.push({ x: n.x + rl * Math.cos(a), y: n.y + rl * Math.sin(a) });
      }
      const k2 = Math.hypot(X.x - p3.x, X.y - p3.y) * 0.45;
      pts.push(...bezierPts(X, { x: X.x + tX.x * k2, y: X.y + tX.y * k2 }, { x: p3.x - d3.ux * k2, y: p3.y - d3.uy * k2 }, p3, 1));
      // numéro de sortie
      for (const i of n.inc) {
        let a = ta - Math.atan2(i.uy, i.ux);
        while (a < 0) a += Math.PI * 2;
        while (a > Math.PI * 2) a -= Math.PI * 2;
        if (a > 0.05 && a <= span + eps + 0.05) exit++;
      }
      turn = 'O';
    } else {
      const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const k = dist * (Math.abs(turnAng) > 1.2 ? 0.5 : 0.38);
      pts = bezierPts(p0, { x: p0.x + d0.ux * k, y: p0.y + d0.uy * k }, { x: p3.x - d3.ux * k, y: p3.y - d3.uy * k }, p3, 1);
      const a = Math.abs(turnAng);
      turn = a < 28 * DEG ? 'S' : a > 150 * DEG ? 'U' : turnAng > 0 ? 'R' : 'L';
    }
    return { node: n, from: li, to: lo, line: new Polyline(pts), turn, exit };
  }

  // ---------------------------------------------------------------- arrêts
  stopFrame(edgeIds, d) {
    const { e, dir } = this.edgeBetween(edgeIds[0], edgeIds[1]);
    const pl = dir === 1 ? e.line : e.rline;
    const q = pl.at(d);
    return { e, dir, pl, x: q.x, y: q.y, ux: q.ux, uy: q.uy, nx: -q.uy, ny: q.ux };
  }
  buildStops() {
    this.stops = {};
    this.shelters = [];
    for (const [id, s] of Object.entries(this.city.stops)) {
      const F = this.stopFrame(s.edge, s.d);
      const bay = s.bay || 0;
      const curb = F.e.hw + bay;
      const at = (along, lat) => ({ x: F.x + F.ux * along + F.nx * lat, y: F.y + F.uy * along + F.ny * lat });
      const pole = at(0, curb + 0.55);
      const st = { id, name: s.name, F, e: F.e, dir: F.dir, d: s.d, bay, curb, pole, ux: F.ux, uy: F.uy, nx: F.nx, ny: F.ny, at };
      if (bay) {
        const P = [at(-30, F.e.hw - 0.05), at(-22, curb), at(4, curb), at(10, F.e.hw - 0.05)];
        st.bayPoly = P;
        this.shapes.bays.push(P);
        this.addRoadPoly(P);
      }
      const room = F.e.sw - (bay ? 0 : 0);
      if (bay || room >= 2.8) {
        const lat = bay ? curb + 1.7 : F.e.hw + F.e.sw - 0.85;
        const c = at(-3.2, lat);
        st.shelter = { cx: c.x, cy: c.y, ux: F.ux, uy: F.uy, hl: 2.1, hw: 0.65, kind: 'shelter' };
      }
      this.stops[id] = st;
    }
  }

  // ---------------------------------------------------------------- feux
  buildSignals() {
    this.signals = [];
    let k = 0;
    for (const n of this.nodes.values()) {
      if (!n.signal) continue;
      n.sigOffset = (k++ * 11) % 37;
      for (const i of n.inc) {
        const group = Math.abs(i.ux) > Math.abs(i.uy) + 0.01 ? 0 : 1;
        // véhicule arrivant : sens -u ; droite du sens d'arrivée = (u.y, -u.x)
        const rx = i.uy, ry = -i.ux;
        const L = i.jr - 0.4;
        const bx = n.x + i.ux * L, by = n.y + i.uy * L;
        const lane = i.e.lanes[i.atStart ? -1 : 1];
        const leftLat = i.e.oneway ? -i.hw : 0;
        const sig = {
          n, group, inc: i,
          head: { x: bx + rx * (i.hw + 0.55), y: by + ry * (i.hw + 0.55) },
          line: { ax: bx + rx * leftLat, ay: by + ry * leftLat, bx: bx + rx * i.hw, by: by + ry * i.hw },
          ux: -i.ux, uy: -i.uy, lane,
        };
        if (lane) lane.signal = sig;
        this.signals.push(sig);
      }
    }
  }
  signalState(sig, t) {
    const cyc = 40;
    let tt = (t + sig.n.sigOffset) % cyc;
    // groupe 0 : vert 0-16, orange 16-19, rouge ensuite ; groupe 1 : vert 21-36, orange 36-39
    if (sig.group === 0) return tt < 16 ? 'G' : tt < 19 ? 'Y' : 'R';
    return tt >= 21 && tt < 36 ? 'G' : tt >= 36 && tt < 39 ? 'Y' : 'R';
  }

  // ---------------------------------------------------------------- obstacles
  buildObstacles() {
    const R = this.rand;
    this.circles = [];
    this.boxes = [];
    this.trees = [];
    this.parked = [];
    const og = (this.ogrid = new SpatialGrid(this.W, this.H, 8));
    const addC = (x, y, r, kind, extra = {}) => {
      const o = { x, y, r, kind, ...extra };
      this.circles.push(o);
      og.forRange(x - r, y - r, x + r, y + r, (ix) => (og.cells[ix] ||= []).push(o));
      return o;
    };
    const addB = (b) => {
      const ex = Math.abs(b.ux) * b.hl + Math.abs(b.uy) * b.hw, ey = Math.abs(b.uy) * b.hl + Math.abs(b.ux) * b.hw;
      b.bb = { minx: b.cx - ex, miny: b.cy - ey, maxx: b.cx + ex, maxy: b.cy + ey };
      this.boxes.push(b);
      og.forRange(b.bb.minx, b.bb.miny, b.bb.maxx, b.bb.maxy, (ix) => (og.cells[ix] ||= []).push(b));
      return b;
    };
    const near = (x, y, d) => {
      let hit = false;
      og.forRange(x - d, y - d, x + d, y + d, (ix) => {
        const c = og.cells[ix];
        if (!c || hit) return;
        for (const o of c) {
          if (o.r !== undefined) { if ((o.x - x) ** 2 + (o.y - y) ** 2 < (d + o.r) ** 2) { hit = true; return; } }
          else if (obbCircle(o, x, y, d)) { hit = true; return; }
        }
      });
      return hit;
    };
    this.addCircle = addC;
    this.nearObstacle = near;

    // arrêts : poteaux et abris
    for (const st of Object.values(this.stops)) {
      st.poleObj = addC(st.pole.x, st.pole.y, 0.09, 'stoppole');
      if (st.shelter) addB(st.shelter);
    }
    // feux
    for (const s of this.signals) addC(s.head.x, s.head.y, 0.14, 'signal');
    // potelets
    for (const b of this.city.bollards || []) {
      const F = this.edgeBetween(b.edge[0], b.edge[1]);
      const pl = F.dir === 1 ? F.e.line : F.e.rline;
      for (let s = b.from; s <= b.to; s += b.step) {
        const q = pl.at(s);
        const lat = b.side * (F.e.hw + b.lat);
        const px = q.x - q.uy * lat, py = q.y + q.ux * lat;
        // pas de potelets le long d'un quai d'arrêt
        const blocked = Object.values(this.stops).some((st) => {
          if (st.e !== F.e) return false;
          const dx = px - st.F.x, dy = py - st.F.y;
          const along = dx * st.ux + dy * st.uy, side = dx * st.nx + dy * st.ny;
          return side > 0 && along > -25 && along < 7;
        });
        if (!blocked) addC(px, py, 0.11, 'bollard');
      }
    }
    // éléments ponctuels
    for (const p of this.city.props) {
      if (p.type === 'tree') this.trees.push({ x: p.p[0], y: p.p[1], r: 3.2 + R() * 1.5 });
      else addC(p.p[0], p.p[1], p.r, p.type);
    }
    // zones d'exclusion (arrêts) par rue
    const stopZones = (e) => Object.values(this.stops).filter((s) => s.e === e).map((s) => {
      const dA = s.dir === 1 ? s.d : e.len - s.d;
      const side = s.dir === 1 ? 1 : -1; // côté physique dans le repère a→b
      return { dA, side };
    });
    for (const e of this.edges) {
      const zones = stopZones(e);
      const inStop = (sA, side, before, after) => zones.some((z) => z.side === side && (side === 1 ? sA > z.dA - before && sA < z.dA + after : sA < z.dA + before && sA > z.dA - after));
      // stationnement
      for (const side of [-1, 1]) {
        const has = e.park === 'B' || (side === 1 && e.park.includes('R')) || (side === -1 && e.park.includes('L'));
        if (!has) continue;
        let s = e.jrA + 6;
        const end = e.len - e.jrB - 6;
        while (s < end - 4) {
          const L = 3.9 + R() * 0.9;
          if (s + L > end) break;
          const mid = s + L / 2;
          if (inStop(mid, side, 30, 9)) { s += 3; continue; }
          if (R() < 0.84) {
            const q = e.line.at(mid);
            const lat = side * (e.hw - 1.05);
            const cx = q.x - q.uy * lat, cy = q.y + q.ux * lat;
            if (this.material(cx, cy) === MAT.ROAD) {
              const flip = R() < 0.5 ? 1 : -1;
              const car = addB({ cx, cy, ux: q.ux * flip, uy: q.uy * flip, hl: L / 2, hw: 0.88, kind: 'car', color: CAR_COLORS[(R() * CAR_COLORS.length) | 0], style: (R() * 3) | 0 });
              this.parked.push(car);
            }
          }
          s += L + 0.7 + R() * 1.6;
        }
      }
      // arbres d'alignement
      if (e.trees && e.sw >= 2.5) {
        for (const side of [-1, 1]) {
          for (let s = e.jrA + 7 + R() * 3; s < e.len - e.jrB - 7; s += 10 + R() * 2) {
            if (inStop(s, side, 26, 12)) continue;
            const q = e.line.at(s);
            const lat = side * (e.hw + 1.25);
            const x = q.x - q.uy * lat, y = q.y + q.ux * lat;
            if (this.material(x, y) !== MAT.WALK || near(x, y, 1.2)) continue;
            addC(x, y, 0.32, 'tree');
            this.trees.push({ x, y, r: 3 + R() * 1.4 });
          }
        }
      }
      // lampadaires
      if (e.lamps) {
        let side = 1;
        for (let s = e.jrA + 9; s < e.len - e.jrB - 5; s += 24) {
          side = e.oneway ? 1 : -side;
          if (inStop(s, side, 20, 8)) continue;
          const q = e.line.at(s);
          const lat = side * (e.hw + 0.5);
          const x = q.x - q.uy * lat, y = q.y + q.ux * lat;
          if (this.material(x, y) !== MAT.WALK || near(x, y, 1.6)) continue;
          addC(x, y, 0.13, 'lamp', { ax: q.uy * side, ay: -q.ux * side });
        }
      }
    }
  }

  queryObstacles(minx, miny, maxx, maxy, fn) {
    const seen = new Set();
    this.ogrid.forRange(minx, miny, maxx, maxy, (ix) => {
      const c = this.ogrid.cells[ix];
      if (!c) return;
      for (const o of c) if (!seen.has(o)) { seen.add(o); fn(o); }
    });
  }

  // ---------------------------------------------------------------- marquages
  buildMarkings() {
    const M = (this.markings = { dashes: [], zebras: [], stoplines: [], parking: [], stopzones: [], giveway: [] });
    for (const e of this.edges) {
      if (e.center && e.w >= 6) {
        const pl = e.line;
        const s0 = e.jrA + 1, s1 = e.len - e.jrB - 1;
        if (s1 > s0 + 2) M.dashes.push({ pts: pl.slice(s0, s1, 2), width: 0.13 });
      }
      for (const side of [-1, 1]) {
        const has = e.park === 'B' || (side === 1 && e.park.includes('R')) || (side === -1 && e.park.includes('L'));
        if (!has) continue;
        const lat = side * (e.hw - 2.1);
        const s0 = e.jrA + 6, s1 = e.len - e.jrB - 6;
        if (s1 > s0) M.parking.push({ pts: offsetPts(e.line.slice(s0, s1, 2), lat) });
      }
    }
    for (const n of this.nodes.values()) {
      for (const i of n.inc) {
        const rx = -i.uy, ry = i.ux;
        if (i.zebraAt !== null && i.zebraAt > 0.5) {
          M.zebras.push({ x: n.x + i.ux * (i.zebraAt + 1.6), y: n.y + i.uy * (i.zebraAt + 1.6), ux: i.ux, uy: i.uy, hw: i.hw, len: 3 });
        }
        const isRing = !!n.ring;
        if ((n.signal || isRing || n.inc.length >= 3) && i.jr > 1) {
          // ligne d'arrêt ou de cédez-le-passage sur la voie entrante
          const lane = i.e.lanes[i.atStart ? -1 : 1];
          if (!lane) continue;
          const L = i.jr - 0.2;
          const bx = n.x + i.ux * L, by = n.y + i.uy * L;
          const ax = i.uy, ay = -i.ux; // droite du sens d'arrivée
          const leftLat = i.e.oneway ? -i.hw : 0;
          const seg = { ax: bx + ax * leftLat, ay: by + ay * leftLat, bx: bx + ax * i.hw, by: by + ay * i.hw };
          if (n.signal) M.stoplines.push(seg);
          else M.giveway.push(seg);
        }
      }
    }
    for (const st of Object.values(this.stops)) {
      M.stopzones.push(st);
    }
  }

  // ---------------------------------------------------------------- lignes de bus
  buildLine(def) {
    const legs = [];
    for (let k = 0; k < def.nodes.length - 1; k++) {
      const { e, dir } = this.edgeBetween(def.nodes[k], def.nodes[k + 1]);
      const lane = e.lanes[dir];
      if (!lane) throw new Error(`Ligne ${def.id} : sens interdit ${def.nodes[k]}→${def.nodes[k + 1]}`);
      legs.push(lane);
    }
    const pts = [];
    const maneuvers = [];
    const push = (arr) => {
      for (const p of arr) {
        const l = pts[pts.length - 1];
        if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 0.3) pts.push({ x: p.x, y: p.y });
      }
    };
    const lens = () => {
      let s = 0;
      for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return s;
    };
    // première voie : prolongée vers l'arrière jusqu'au début de la rue
    push(legs[0].line.pts);
    for (let k = 1; k < legs.length; k++) {
      const c = legs[k - 1].conns.find((c) => c.to === legs[k]);
      if (!c) throw new Error(`Ligne ${def.id} : pas de connexion`);
      if (c.turn !== 'S' || c.node.inc.length >= 3) maneuvers.push({ s: lens(), turn: c.turn, exit: c.exit, node: c.node.id, street: legs[k].e.name, len: c.line.len });
      push(c.line.pts);
      push(legs[k].line.pts);
    }
    const path = new Polyline(pts);
    const stops = [];
    let sMin = 0;
    def.stops.forEach((sid, k) => {
      const st = this.stops[sid];
      if (!st) throw new Error('Arrêt inconnu ' + sid);
      const target = { x: st.F.x, y: st.F.y };
      let best = null;
      for (let i = path.seg(sMin); i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / (l2 || 1), 0, 1);
        const d = Math.hypot(a.x + dx * t - target.x, a.y + dy * t - target.y);
        if (d < 6 && (!best || d < best.d)) best = { d, s: path.cum[i] + t * Math.sqrt(l2) };
        if (best && path.cum[i] > best.s + 30) break;
      }
      if (!best) throw new Error(`Ligne ${def.id} : arrêt ${sid} hors itinéraire`);
      stops.push({ st, s: best.s, idx: k });
      sMin = best.s + 5;
    });
    return { def, id: def.id, legs, path, maneuvers, stops, color: def.color };
  }

  // position de départ : bus à quai au premier arrêt
  dockPose(st, busType) {
    const T = busType;
    const latC = st.curb - 0.28 - T.width / 2;
    const frontAlong = T.doors[0] + 0.0; // porte avant au droit du poteau
    const fx = st.F.x + st.F.ux * frontAlong + st.F.nx * latC;
    const fy = st.F.y + st.F.uy * frontAlong + st.F.ny * latC;
    const th = Math.atan2(st.F.uy, st.F.ux);
    const back = T.wb + T.fo;
    return { x: fx - st.F.ux * back, y: fy - st.F.uy * back, th };
  }
}

function polyCross(p, q) {
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      if (segIntersect(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y, q[j].x, q[j].y, q[j + 1].x, q[j + 1].y)) return true;
    }
  }
  return false;
}

function inPoly(x, y, o) {
  const b = o.bb;
  if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) return false;
  return pointInPoly(x, y, o.p);
}
function inFillet(x, y, f) {
  const b = f.bb;
  if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) return false;
  if (!pointInPoly(x, y, f.p)) return false;
  for (const d of f.discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r2) return false;
  return true;
}

export { obbOverlap, obbCircle, segIntersect };
