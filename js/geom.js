// Géométrie 2D de base (repère écran : x vers la droite, y vers le bas, mètres)
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const cross = (ax, ay, bx, by) => ax * by - ay * bx;
export const hypot = Math.hypot;

// Générateur pseudo-aléatoire déterministe
export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function distSegSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

// Bande autour d'un segment, extrémités arrondies (cap) ou franches
export function makeBand(ax, ay, bx, by, r, capA, capB) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  return {
    ax, ay, bx, by, ux: dx / len, uy: dy / len, len, r, r2: r * r, capA, capB,
    minx: Math.min(ax, bx) - r, maxx: Math.max(ax, bx) + r,
    miny: Math.min(ay, by) - r, maxy: Math.max(ay, by) + r,
  };
}
export function inBand(px, py, s) {
  const rx = px - s.ax, ry = py - s.ay;
  const t = rx * s.ux + ry * s.uy;
  if (t >= 0 && t <= s.len) {
    const n = ry * s.ux - rx * s.uy;
    return n * n < s.r2;
  }
  if (t < 0) return s.capA && rx * rx + ry * ry < s.r2;
  const ex = px - s.bx, ey = py - s.by;
  return s.capB && ex * ex + ey * ey < s.r2;
}

export function pointInPoly(px, py, p) {
  // p : tableau plat [x0,y0,x1,y1,...]
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function polyBBox(p) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minx) minx = p[i];
    if (p[i] > maxx) maxx = p[i];
    if (p[i + 1] < miny) miny = p[i + 1];
    if (p[i + 1] > maxy) maxy = p[i + 1];
  }
  return { minx, miny, maxx, maxy };
}
export const flat = (pts) => pts.flatMap((p) => (Array.isArray(p) ? p : [p.x, p.y]));

// Boîtes orientées : {cx, cy, ux, uy, hl, hw}
export function obbCorners(o) {
  const ax = o.ux * o.hl, ay = o.uy * o.hl;
  const bx = -o.uy * o.hw, by = o.ux * o.hw;
  return [
    o.cx + ax + bx, o.cy + ay + by,
    o.cx + ax - bx, o.cy + ay - by,
    o.cx - ax - bx, o.cy - ay - by,
    o.cx - ax + bx, o.cy - ay + by,
  ];
}
function projRadius(o, ax, ay) {
  return Math.abs(o.ux * ax + o.uy * ay) * o.hl + Math.abs(-o.uy * ax + o.ux * ay) * o.hw;
}
export function obbOverlap(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const axes = [a.ux, a.uy, -a.uy, a.ux, b.ux, b.uy, -b.uy, b.ux];
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i], ay = axes[i + 1];
    const d = Math.abs(dx * ax + dy * ay);
    if (d > projRadius(a, ax, ay) + projRadius(b, ax, ay)) return false;
  }
  return true;
}
export function obbCircle(o, cx, cy, r) {
  const dx = cx - o.cx, dy = cy - o.cy;
  const lx = dx * o.ux + dy * o.uy;
  const ly = -dx * o.uy + dy * o.ux;
  const qx = lx - clamp(lx, -o.hl, o.hl);
  const qy = ly - clamp(ly, -o.hw, o.hw);
  return qx * qx + qy * qy < r * r;
}
export function obbContains(o, px, py, margin = 0) {
  const dx = px - o.cx, dy = py - o.cy;
  const lx = dx * o.ux + dy * o.uy;
  const ly = -dx * o.uy + dy * o.ux;
  return Math.abs(lx) < o.hl + margin && Math.abs(ly) < o.hw + margin;
}

// Polyligne avec abscisse curviligne
export class Polyline {
  constructor(pts) {
    this.pts = pts;
    const n = pts.length;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    this.len = this.cum[n - 1] || 0;
  }
  seg(s) {
    const c = this.cum;
    let lo = 0, hi = c.length - 1;
    if (s <= 0) return 0;
    if (s >= this.len) return Math.max(0, c.length - 2);
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m] <= s) lo = m; else hi = m;
    }
    return lo;
  }
  at(s) {
    const p = this.pts;
    if (p.length === 1) return { x: p[0].x, y: p[0].y, ux: 1, uy: 0 };
    const i = this.seg(s);
    const a = p[i], b = p[i + 1];
    const l = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t = clamp((s - this.cum[i]) / l, s < 0 ? -1e9 : 0, s > this.len ? 1e9 : 1);
    const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ux, uy };
  }
  // tangente lissée (moyenne sur une fenêtre)
  dirAt(s, w = 1.5) {
    const a = this.at(s - w), b = this.at(s + w);
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { ux: dx / l, uy: dy / l };
  }
  // projection d'un point ; recherche limitée autour de s0 si fourni
  project(px, py, s0 = null, win = 40) {
    const p = this.pts;
    let i0 = 0, i1 = p.length - 1;
    if (s0 !== null) {
      i0 = this.seg(s0 - win);
      i1 = Math.min(p.length - 1, this.seg(s0 + win) + 1);
    }
    let best = Infinity, bs = 0, bx = 0, by = 0, bi = 0;
    for (let i = i0; i < i1; i++) {
      const a = p[i], b = p[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
      t = clamp(t, 0, 1);
      const qx = a.x + dx * t, qy = a.y + dy * t;
      const d = (qx - px) ** 2 + (qy - py) ** 2;
      if (d < best) {
        best = d; bi = i;
        bs = this.cum[i] + t * Math.sqrt(l2);
        bx = qx; by = qy;
      }
    }
    const a = p[bi], b = p[Math.min(bi + 1, p.length - 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
    // latéral positif = à droite du sens de parcours
    const lat = (px - bx) * -uy + (py - by) * ux;
    return { s: bs, dist: Math.sqrt(best), lat, x: bx, y: by, ux, uy };
  }
  slice(s0, s1, step = 1) {
    const out = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) {
      const q = this.at(s0 + ((s1 - s0) * i) / n);
      out.push({ x: q.x, y: q.y });
    }
    return out;
  }
}

// Décalage latéral d'une polyligne (positif = à droite du sens de parcours)
export function offsetPts(pts, o) {
  const n = pts.length;
  if (n < 2 || o === 0) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  for (let i = 0; i < n; i++) {
    let nx = 0, ny = 0;
    if (i > 0) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l; ny += dx / l;
    }
    if (i < n - 1) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l; ny += dx / l;
    }
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    // correction d'onglet
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const ll = Math.hypot(dx, dy) || 1;
      const c = nx * (-dy / ll) + ny * (dx / ll);
      k = 1 / Math.max(0.5, c);
    }
    out.push({ x: pts[i].x + nx * o * k, y: pts[i].y + ny * o * k });
  }
  return out;
}

export function bezierPts(p0, c1, c2, p3, step = 1) {
  const approx = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p3.x - c2.x, p3.y - c2.y);
  const n = Math.max(2, Math.ceil(approx / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y });
  }
  return out;
}

export function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = cross(rx, ry, sx, sy);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(cx - ax, cy - ay, sx, sy) / den;
  const u = cross(cx - ax, cy - ay, rx, ry) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
