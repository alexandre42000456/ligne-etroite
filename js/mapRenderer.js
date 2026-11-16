// Rendu statique de la ville en tuiles (chunks) mises en cache
import { hash2, rng, TAU } from './geom.js';

const PX = 20; // pixels par mètre dans les tuiles
const CS = 32; // taille d'une tuile (m)
const MARGIN = 4;

const COL = {
  walk: '#cfc8bc', walkOld: '#c9bfae', plaza: '#d8cdb8', curb: '#eeeae2', curbOld: '#d9d2c4',
  asphalt: '#4a4d52', cobble: '#6d655c', grass: '#7aa55a', grassDark: '#6b9450', water: '#3f7fa8',
  apron: '#8c8378', island: '#6f9d4f', line: 'rgba(245,245,240,0.92)', yellow: '#f2c200',
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// --------------------------------------------------------------- textures
function noiseTile(size, base, amp, seed, dots = 0) {
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);
  const R = rng(seed);
  for (let i = 0; i < size * size * 0.35; i++) {
    const a = (R() - 0.5) * amp;
    x.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    x.fillRect((R() * size) | 0, (R() * size) | 0, 1 + ((R() * 2) | 0), 1);
  }
  for (let i = 0; i < dots; i++) {
    x.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.08})`;
    x.beginPath();
    x.arc(R() * size, R() * size, 1 + R() * 3, 0, TAU);
    x.fill();
  }
  return c;
}
function cobbleTile(base, seed) {
  const s = 48; // 2,4 m
  const c = makeCanvas(s, s);
  const x = c.getContext('2d');
  x.fillStyle = '#3d3934';
  x.fillRect(0, 0, s, s);
  const R = rng(seed);
  const st = 4; // ~0,2 m
  for (let j = 0; j < s / st; j++) {
    const off = (j % 2) * (st / 2);
    for (let i = -1; i < s / st + 1; i++) {
      const l = 0.82 + R() * 0.3;
      const col = shade(base, (R() - 0.5) * 0.22);
      x.fillStyle = col;
      x.beginPath();
      x.roundRect(i * st + off + 0.4, j * st + 0.4, st * l - 0.8, st - 0.8, 1.2);
      x.fill();
    }
  }
  return c;
}
function slabTile(base, line, cell, seed) {
  const s = cell * 4;
  const c = makeCanvas(s, s);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, s, s);
  const R = rng(seed);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    x.fillStyle = shade(base, (R() - 0.5) * 0.06);
    x.fillRect(i * cell, j * cell, cell, cell);
  }
  x.strokeStyle = line;
  x.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(i * cell + 0.5, 0); x.lineTo(i * cell + 0.5, s); x.stroke();
    x.beginPath(); x.moveTo(0, i * cell + 0.5); x.lineTo(s, i * cell + 0.5); x.stroke();
  }
  return c;
}
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const ROOF_WARM = ['#b0603c', '#a4573a', '#bb6c46', '#9b5236', '#b8744f', '#8f5a44'];
const ROOF_COOL = ['#6b7078', '#7b8189', '#5f646b', '#8a8f96', '#74695f', '#a4573a', '#6e5d52'];

export class MapRenderer {
  constructor(world) {
    this.world = world;
    this.PX = PX; this.CS = CS;
    this.cache = new Map();
    this.pool = [];
    this.maxChunks = 72;
    this.tiles = {
      asphalt: noiseTile(64, COL.asphalt, 0.09, 11, 6),
      cobble: cobbleTile('#7a7166', 12),
      walk: slabTile(COL.walk, 'rgba(0,0,0,0.10)', 12, 13),
      walkOld: slabTile(COL.walkOld, 'rgba(0,0,0,0.12)', 8, 14),
      plaza: slabTile(COL.plaza, 'rgba(90,70,40,0.16)', 20, 15),
      grass: noiseTile(64, COL.grass, 0.12, 16, 18),
      apron: cobbleTile('#958a7c', 17),
    };
    const sz = (CS + MARGIN * 2) * PX;
    this.tmp = makeCanvas(sz, sz);
    this.frame = 0;
  }

  key(ix, iy) { return ix * 1000 + iy; }

  get(ix, iy) {
    const c = this.cache.get(this.key(ix, iy));
    if (c) c.used = this.frame;
    return c ? c.cv : null;
  }

  // génère au plus `budget` ms de tuiles, les plus proches d'abord
  ensure(list, budget = 6) {
    this.frame++;
    const t0 = performance.now();
    let made = 0;
    for (const [ix, iy] of list) {
      const k = this.key(ix, iy);
      const c = this.cache.get(k);
      if (c) { c.used = this.frame; continue; }
      if (made > 0 && performance.now() - t0 > budget) break;
      this.cache.set(k, { cv: this.render(ix, iy), used: this.frame });
      made++;
    }
    if (this.cache.size > this.maxChunks) {
      const arr = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
      while (this.cache.size > this.maxChunks) {
        const [k, v] = arr.shift();
        if (v.used === this.frame) break;
        this.cache.delete(k);
        this.pool.push(v.cv);
      }
    }
    return made;
  }

  pat(ctx, name) {
    const p = ctx.createPattern(this.tiles[name], 'repeat');
    p.setTransform(new DOMMatrix([1 / PX, 0, 0, 1 / PX, 0, 0]));
    return p;
  }

  render(ix, iy) {
    const W = this.world, S = W.shapes;
    const cv = this.pool.pop() || makeCanvas(CS * PX, CS * PX);
    const x = cv.getContext('2d');
    const x0 = ix * CS, y0 = iy * CS;
    const bb = { minx: x0 - MARGIN, miny: y0 - MARGIN, maxx: x0 + CS + MARGIN, maxy: y0 + CS + MARGIN };
    const inBB = (minx, miny, maxx, maxy) => maxx >= bb.minx && minx <= bb.maxx && maxy >= bb.miny && miny <= bb.maxy;
    const bandIn = (b) => inBB(b.minx, b.miny, b.maxx, b.maxy);
    const discIn = (d, r = d.r) => inBB(d.x - r, d.y - r, d.x + r, d.y + r);
    const polyIn = (p) => inBB(p.bb.minx, p.bb.miny, p.bb.maxx, p.bb.maxy);

    x.setTransform(PX, 0, 0, PX, -x0 * PX, -y0 * PX);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.lineCap = 'butt';
    x.lineJoin = 'round';
    x.fillStyle = this.pat(x, 'walk');
    x.fillRect(x0, y0, CS, CS);

    // --- herbe, trottoirs, places
    for (const p of S.gpoly) if (polyIn(p)) { x.fillStyle = this.pat(x, 'grass'); fillPoly(x, p.p); }
    const walkPat = this.pat(x, 'walk'), oldPat = this.pat(x, 'walkOld');
    for (const b of S.wband) if (bandIn(b)) { x.strokeStyle = b.e.style === 'cobble' ? oldPat : walkPat; strokeBand(x, b, b.r); }
    for (const d of S.wdisc) if (discIn(d)) { x.fillStyle = walkPat; circle(x, d.x, d.y, d.r); x.fill(); }
    for (const f of S.wfil) if (polyIn(f)) { x.fillStyle = walkPat; fillFillet(x, f); }
    for (const p of S.wpoly) if (polyIn(p)) { x.fillStyle = this.pat(x, p.style === 'plaza' ? 'plaza' : 'walk'); fillPoly(x, p.p); }
    for (const p of S.water) if (polyIn(p)) this.drawWater(x, p);

    // --- bordures
    for (const b of S.rband) if (bandIn(b)) { x.strokeStyle = b.e.style === 'cobble' ? COL.curbOld : COL.curb; strokeBand(x, b, b.r + 0.18); }
    for (const d of S.rdisc) if (discIn(d, d.r + 0.2)) { x.fillStyle = COL.curb; circle(x, d.x, d.y, d.r + 0.18); x.fill(); }
    for (const P of S.bays) {
      x.strokeStyle = COL.curb; x.lineWidth = 0.36;
      x.beginPath(); x.moveTo(P[0].x, P[0].y); for (const q of P) x.lineTo(q.x, q.y); x.stroke();
    }

    // --- chaussée
    const asph = this.pat(x, 'asphalt'), cob = this.pat(x, 'cobble');
    for (const b of S.rband) if (bandIn(b) && b.e.style === 'cobble') { x.strokeStyle = cob; strokeBand(x, b, b.r); }
    for (const b of S.rband) if (bandIn(b) && b.e.style !== 'cobble') { x.strokeStyle = asph; strokeBand(x, b, b.r); }
    for (const d of S.rdisc) if (discIn(d)) { x.fillStyle = this.nodeStyleAt(d) === 'cobble' ? cob : asph; circle(x, d.x, d.y, d.r); x.fill(); }
    for (const f of S.rfil) if (polyIn(f)) { x.fillStyle = this.nodeStyleAt({ x: f.arc.x, y: f.arc.y }, 14) === 'cobble' ? cob : asph; fillFillet(x, f); }
    for (const p of S.rpoly) if (polyIn(p)) { x.fillStyle = asph; fillPoly(x, p.p); }
    // arcs de bordure des congés
    x.strokeStyle = COL.curb; x.lineWidth = 0.2;
    for (const a of S.curbArcs) if (discIn(a, a.r + 0.5)) {
      x.beginPath(); x.arc(a.x, a.y, a.r - 0.1, a.a1, a.a2, a.ccw); x.stroke();
    }
    // îlots de giratoire
    for (const d of S.island) if (discIn(d, d.ra + 1)) {
      x.fillStyle = this.pat(x, 'apron'); circle(x, d.x, d.y, d.ra); x.fill();
      x.strokeStyle = '#d9d3c7'; x.lineWidth = 0.3; circle(x, d.x, d.y, d.ra - 0.15); x.stroke();
      x.fillStyle = COL.curb; circle(x, d.x, d.y, d.ri + 0.25); x.fill();
      x.fillStyle = this.pat(x, 'grass'); circle(x, d.x, d.y, d.ri); x.fill();
      x.fillStyle = 'rgba(214,92,120,0.55)';
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; circle(x, d.x + Math.cos(a) * (d.ri - 1.6), d.y + Math.sin(a) * (d.ri - 1.6), 0.55); x.fill(); }
    }

    this.drawMarkings(x, inBB);
    this.drawGroundObjects(x, inBB);
    this.drawBuildings(x, x0, y0, bb, inBB);
    this.drawCanopies(x, inBB);
    return cv;
  }

  nodeStyleAt(p, rad = 1) {
    // style de chaussée d'un carrefour : pavés si toutes les rues sont pavées
    let best = null, bd = Infinity;
    for (const n of this.world.nodes.values()) {
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    if (!best || bd > (rad + 25) ** 2) return 'asphalt';
    return best.inc.every((i) => i.e.style === 'cobble') ? 'cobble' : 'asphalt';
  }

  drawWater(x, p) {
    const g = x.createLinearGradient(0, p.bb.miny, 0, p.bb.maxy);
    g.addColorStop(0, '#2f6a8f'); g.addColorStop(1, '#3d86b0');
    x.fillStyle = g; fillPoly(x, p.p);
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 0.25;
    const R = rng(91);
    for (let i = 0; i < 260; i++) {
      const wx = R() * this.world.W, wy = p.bb.miny + 2 + R() * (p.bb.maxy - p.bb.miny - 2);
      x.beginPath(); x.moveTo(wx, wy); x.quadraticCurveTo(wx + 1.5, wy - 0.4, wx + 3, wy); x.stroke();
    }
    // parapet
    x.fillStyle = '#b9b0a2';
    x.fillRect(p.bb.minx, p.bb.miny - 0.6, p.bb.maxx - p.bb.minx, 0.6);
  }

  drawMarkings(x, inBB) {
    const M = this.world.markings;
    x.strokeStyle = COL.line; x.lineCap = 'butt';
    x.lineWidth = 0.14; x.setLineDash([3, 3.5]);
    for (const d of M.dashes) { if (ptsIn(d.pts, inBB)) strokePts(x, d.pts); }
    x.lineWidth = 0.1; x.setLineDash([0.9, 0.6]);
    x.strokeStyle = 'rgba(240,240,235,0.7)';
    for (const d of M.parking) { if (ptsIn(d.pts, inBB)) strokePts(x, d.pts); }
    x.setLineDash([]);
    // passages piétons
    x.fillStyle = 'rgba(245,245,240,0.9)';
    for (const z of M.zebras) {
      if (!inBB(z.x - 8, z.y - 8, z.x + 8, z.y + 8)) continue;
      const nx = -z.uy, ny = z.ux;
      for (let o = -z.hw + 0.45; o < z.hw - 0.3; o += 1.0) {
        const cx = z.x + nx * o, cy = z.y + ny * o;
        x.save(); x.translate(cx, cy); x.rotate(Math.atan2(z.uy, z.ux));
        x.fillRect(-z.len / 2, -0.25, z.len, 0.5);
        x.restore();
      }
    }
    x.strokeStyle = COL.line; x.lineWidth = 0.32;
    for (const s of M.stoplines) { if (inBB(Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by))) { x.beginPath(); x.moveTo(s.ax, s.ay); x.lineTo(s.bx, s.by); x.stroke(); } }
    x.setLineDash([0.55, 0.4]); x.lineWidth = 0.28;
    for (const s of M.giveway) { if (inBB(Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by))) { x.beginPath(); x.moveTo(s.ax, s.ay); x.lineTo(s.bx, s.by); x.stroke(); } }
    x.setLineDash([]);
    // arrêts de bus : zigzag jaune + « BUS »
    for (const st of M.stopzones) {
      if (!inBB(st.pole.x - 30, st.pole.y - 30, st.pole.x + 30, st.pole.y + 30)) continue;
      x.strokeStyle = COL.yellow; x.lineWidth = 0.14;
      x.beginPath();
      let k = 0;
      for (let a = -21; a <= 3.01; a += 1.0, k++) {
        const lat = st.curb - (k % 2 ? 0.75 : 0.18);
        const p = st.at(a, lat);
        if (k === 0) x.moveTo(p.x, p.y); else x.lineTo(p.x, p.y);
      }
      x.stroke();
      const c = st.at(-9, st.curb - 1.6);
      x.save(); x.translate(c.x, c.y); x.rotate(Math.atan2(st.uy, st.ux) + Math.PI / 2);
      x.fillStyle = COL.yellow; x.font = 'bold 1.3px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('BUS', 0, 0);
      x.restore();
    }
  }

  drawGroundObjects(x, inBB) {
    const W = this.world;
    // voitures stationnées
    for (const c of W.parked) {
      if (!inBB(c.bb.minx, c.bb.miny, c.bb.maxx, c.bb.maxy)) continue;
      drawCar(x, c.cx, c.cy, Math.atan2(c.uy, c.ux), c.hl * 2, c.hw * 2, c.color, false);
    }
    // abris
    for (const b of W.boxes) {
      if (b.kind !== 'shelter' || !inBB(b.bb.minx, b.bb.miny, b.bb.maxx, b.bb.maxy)) continue;
      x.save(); x.translate(b.cx, b.cy); x.rotate(Math.atan2(b.uy, b.ux));
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-b.hl + 0.3, -b.hw + 0.4, b.hl * 2, b.hw * 2);
      x.fillStyle = '#9fb7c4'; x.fillRect(-b.hl, -b.hw, b.hl * 2, b.hw * 2);
      x.strokeStyle = '#3c4a52'; x.lineWidth = 0.12; x.strokeRect(-b.hl, -b.hw, b.hl * 2, b.hw * 2);
      x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(-b.hl + 0.2, -b.hw + 0.15, b.hl * 2 - 0.4, 0.25);
      x.restore();
    }
    for (const o of W.circles) {
      if (!inBB(o.x - 3, o.y - 3, o.x + 3, o.y + 3)) continue;
      switch (o.kind) {
        case 'bollard':
          x.fillStyle = '#2b2b2b'; circle(x, o.x, o.y, o.r); x.fill();
          x.fillStyle = '#8a8a8a'; circle(x, o.x - 0.03, o.y - 0.03, o.r * 0.45); x.fill();
          break;
        case 'lamp':
          x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(o.x + 0.2, o.y + 0.2, 0.25, 0.25);
          x.strokeStyle = '#2e3236'; x.lineWidth = 0.1;
          x.beginPath(); x.moveTo(o.x, o.y); x.lineTo(o.x + o.ax * 1.3, o.y + o.ay * 1.3); x.stroke();
          x.fillStyle = '#3a3f44'; circle(x, o.x, o.y, o.r); x.fill();
          x.fillStyle = '#e9e4c8'; circle(x, o.x + o.ax * 1.35, o.y + o.ay * 1.35, 0.2); x.fill();
          break;
        case 'stoppole':
          x.fillStyle = '#303030'; circle(x, o.x, o.y, 0.1); x.fill();
          x.fillStyle = '#ffcc00'; x.fillRect(o.x - 0.28, o.y - 0.28, 0.56, 0.56);
          x.fillStyle = '#123f8a'; x.fillRect(o.x - 0.2, o.y - 0.2, 0.4, 0.4);
          break;
        case 'signal':
          x.fillStyle = '#2a2a2a'; circle(x, o.x, o.y, 0.14); x.fill();
          break;
        case 'tree':
          x.fillStyle = '#5b4632'; circle(x, o.x, o.y, o.r); x.fill();
          x.strokeStyle = '#8a7a64'; x.lineWidth = 0.12; circle(x, o.x, o.y, o.r + 0.5); x.stroke();
          break;
        case 'fountain':
          x.fillStyle = '#bdb4a6'; circle(x, o.x, o.y, o.r + 0.35); x.fill();
          x.fillStyle = '#5aa0c8'; circle(x, o.x, o.y, o.r); x.fill();
          x.fillStyle = '#d7d0c4'; circle(x, o.x, o.y, 0.45); x.fill();
          x.fillStyle = 'rgba(255,255,255,0.6)'; circle(x, o.x, o.y, 0.22); x.fill();
          break;
        case 'statue':
          x.fillStyle = '#a49a8c'; x.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
          x.fillStyle = '#556052'; circle(x, o.x, o.y, o.r * 0.55); x.fill();
          break;
      }
    }
  }

  drawBuildings(x, x0, y0, bb, inBB) {
    const W = this.world, S = W.shapes;
    const t = this.tmp, b = t.getContext('2d');
    const ox = x0 - MARGIN, oy = y0 - MARGIN, sz = CS + MARGIN * 2;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, t.width, t.height);
    b.setTransform(PX, 0, 0, PX, -ox * PX, -oy * PX);
    // toits en patchwork (parcelles déterministes, rangées décalées)
    const G = 11;
    for (let gy = Math.floor(oy / G) - 1; gy <= Math.floor((oy + sz) / G); gy++) {
      const rowOff = hash2(0, gy, 77) * G;
      for (let gx = Math.floor((ox - rowOff) / G) - 1; gx <= Math.floor((ox + sz - rowOff) / G); gx++) {
        const X = gx * G + rowOff, Y = gy * G;
        const h = hash2(gx, gy, 3);
        const old = X > 400 && Y < 290;
        const pal = old ? ROOF_WARM : hash2(gx, gy, 9) < 0.35 ? ROOF_WARM : ROOF_COOL;
        const rects = [];
        const a = 0.3 + hash2(gx, gy, 5) * 0.4, c = 0.3 + hash2(gx, gy, 6) * 0.4;
        if (h < 0.14 && !old) rects.push([X, Y, G, G, 'court']);
        else if (h < 0.5) rects.push([X, Y, G * a, G], [X + G * a, Y, G * (1 - a), G]);
        else if (h < 0.82) rects.push([X, Y, G, G * c], [X, Y + G * c, G, G * (1 - c)]);
        else rects.push([X, Y, G / 3, G], [X + G / 3, Y, G / 3, G], [X + (2 * G) / 3, Y, G / 3, G]);
        rects.forEach((r, k) => {
          const col = pal[(hash2(gx, gy, 20 + k) * pal.length) | 0];
          roof(b, r[0], r[1], r[2], r[3], col, hash2(gx, gy, 40 + k), r[4]);
        });
      }
    }
    // découpe de tout ce qui n'est pas bâti
    b.globalCompositeOperation = 'destination-out';
    b.fillStyle = '#000'; b.strokeStyle = '#000';
    b.lineCap = 'butt'; b.lineJoin = 'round';
    for (const s of S.wband) if (bandIn2(s, inBB)) strokeBand(b, s, s.r);
    for (const s of S.rband) if (bandIn2(s, inBB)) strokeBand(b, s, s.r + 0.2);
    for (const d of S.wdisc) if (inBB(d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r)) { circle(b, d.x, d.y, d.r); b.fill(); }
    for (const d of S.rdisc) if (inBB(d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r)) { circle(b, d.x, d.y, d.r + 0.2); b.fill(); }
    for (const f of S.wfil) if (inBB(f.bb.minx, f.bb.miny, f.bb.maxx, f.bb.maxy)) fillFillet(b, f);
    for (const f of S.rfil) if (inBB(f.bb.minx, f.bb.miny, f.bb.maxx, f.bb.maxy)) fillFillet(b, f);
    for (const k of ['wpoly', 'gpoly', 'water', 'rpoly']) for (const p of S[k]) if (inBB(p.bb.minx, p.bb.miny, p.bb.maxx, p.bb.maxy)) fillPoly(b, p.p);
    b.globalCompositeOperation = 'source-over';
    for (const p of S.bpoly) if (inBB(p.bb.minx, p.bb.miny, p.bb.maxx, p.bb.maxy)) specialBuilding(b, p);
    // ombre portée (soleil au nord-ouest)
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.shadowColor = 'rgba(20,18,30,0.42)';
    x.shadowOffsetX = 0.9 * PX; x.shadowOffsetY = 1.25 * PX; x.shadowBlur = 0.5 * PX;
    x.drawImage(t, -MARGIN * PX, -MARGIN * PX);
    x.restore();
  }

  drawCanopies(x, inBB) {
    const T = this.world.trees;
    x.fillStyle = 'rgba(15,30,10,0.28)';
    for (const t of T) if (inBB(t.x - 6, t.y - 6, t.x + 6, t.y + 6)) { circle(x, t.x + 1.0, t.y + 1.3, t.r); x.fill(); }
    for (const t of T) {
      if (!inBB(t.x - 6, t.y - 6, t.x + 6, t.y + 6)) continue;
      const R = rng(((t.x * 7) | 0) * 131 + ((t.y * 7) | 0));
      const g = x.createRadialGradient(t.x - t.r * 0.35, t.y - t.r * 0.35, t.r * 0.1, t.x, t.y, t.r);
      g.addColorStop(0, '#7fb257'); g.addColorStop(0.7, '#4f8a3a'); g.addColorStop(1, '#3d7030');
      x.fillStyle = g;
      x.beginPath();
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU, rr = t.r * (0.82 + R() * 0.22);
        const px = t.x + Math.cos(a) * rr * 0.55, py = t.y + Math.sin(a) * rr * 0.55;
        x.moveTo(px + rr * 0.5, py);
        x.arc(px, py, rr * 0.5, 0, TAU);
      }
      x.moveTo(t.x + t.r * 0.6, t.y); x.arc(t.x, t.y, t.r * 0.6, 0, TAU);
      x.fill();
    }
  }

  // mini-carte (vue d'ensemble), 1 image pour toute la ville
  minimap(scale = 1.5) {
    const W = this.world, S = W.shapes;
    const c = makeCanvas(Math.ceil(W.W * scale), Math.ceil(W.H * scale));
    const x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.fillStyle = '#2b2f36'; x.fillRect(0, 0, W.W, W.H);
    x.lineCap = 'butt'; x.lineJoin = 'round';
    for (const p of S.gpoly) { x.fillStyle = '#38513a'; fillPoly(x, p.p); }
    for (const p of S.water) { x.fillStyle = '#284a63'; fillPoly(x, p.p); }
    for (const p of S.wpoly) { x.fillStyle = '#4a4f57'; fillPoly(x, p.p); }
    x.strokeStyle = '#4a4f57';
    for (const s of S.wband) strokeBand(x, s, s.r);
    x.strokeStyle = '#9aa1ab';
    for (const s of S.rband) strokeBand(x, s, Math.max(s.r, 2.2));
    x.fillStyle = '#9aa1ab';
    for (const d of S.rdisc) { circle(x, d.x, d.y, d.r); x.fill(); }
    for (const d of S.island) { x.fillStyle = '#38513a'; circle(x, d.x, d.y, d.ra); x.fill(); }
    return c;
  }
}

// ----------------------------------------------------------------- utilitaires de dessin
function ptsIn(pts, inBB) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
  return inBB(minx, miny, maxx, maxy);
}
function bandIn2(b, inBB) { return inBB(b.minx, b.miny, b.maxx, b.maxy); }
export function circle(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, TAU); }
export function fillPoly(x, p) {
  x.beginPath(); x.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]);
  x.closePath(); x.fill();
}
function strokePts(x, pts) {
  x.beginPath(); x.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i].x, pts[i].y);
  x.stroke();
}
function strokeBand(x, b, r) {
  x.lineWidth = r * 2;
  x.lineCap = 'butt';
  x.beginPath(); x.moveTo(b.ax, b.ay); x.lineTo(b.bx, b.by); x.stroke();
  const fs = x.fillStyle;
  x.fillStyle = x.strokeStyle;
  if (b.capA) { circle(x, b.ax, b.ay, r); x.fill(); }
  if (b.capB) { circle(x, b.bx, b.by, r); x.fill(); }
  x.fillStyle = fs;
}
function fillFillet(x, f) {
  x.save();
  x.beginPath(); x.moveTo(f.p[0], f.p[1]);
  for (let i = 2; i < f.p.length; i += 2) x.lineTo(f.p[i], f.p[i + 1]);
  x.closePath(); x.clip();
  x.beginPath(); x.moveTo(f.p[0], f.p[1]);
  for (let i = 2; i < f.p.length; i += 2) x.lineTo(f.p[i], f.p[i + 1]);
  x.closePath();
  for (const d of f.discs) { x.moveTo(d.x + d.r, d.y); x.arc(d.x, d.y, d.r, 0, TAU); }
  x.fill('evenodd');
  x.restore();
}
function roof(b, x, y, w, h, col, r, kind) {
  if (kind === 'court') {
    // immeuble à cour intérieure (toit plat en zinc)
    b.fillStyle = '#80868e'; b.fillRect(x, y, w, h);
    b.fillStyle = 'rgba(255,255,255,0.08)'; b.fillRect(x, y, w, h / 2);
    b.fillStyle = '#9a9d8f'; b.fillRect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4);
    b.strokeStyle = 'rgba(0,0,0,0.35)'; b.lineWidth = 0.18;
    b.strokeRect(x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4); b.strokeRect(x, y, w, h);
    return;
  }
  const horiz = w >= h;
  b.fillStyle = col;
  b.fillRect(x, y, w, h);
  // deux pans : celui tourné vers le nord-ouest plus clair
  b.fillStyle = 'rgba(255,255,255,0.10)';
  if (horiz) b.fillRect(x, y, w, h / 2); else b.fillRect(x, y, w / 2, h);
  b.strokeStyle = 'rgba(255,255,255,0.18)'; b.lineWidth = 0.12;
  b.beginPath();
  if (horiz) { b.moveTo(x + 0.5, y + h / 2); b.lineTo(x + w - 0.5, y + h / 2); }
  else { b.moveTo(x + w / 2, y + 0.5); b.lineTo(x + w / 2, y + h - 0.5); }
  b.stroke();
  b.strokeStyle = 'rgba(0,0,0,0.30)'; b.lineWidth = 0.18;
  b.strokeRect(x, y, w, h);
  // cheminée / lucarne
  if (r < 0.3) {
    b.fillStyle = 'rgba(60,45,40,0.9)';
    b.fillRect(x + w * (0.2 + r * 0.6), y + h * (0.25 + r * 0.4), 0.7, 0.7);
  } else if (r > 0.8) {
    b.fillStyle = 'rgba(150,190,210,0.55)';
    b.fillRect(x + w * 0.3, y + h * 0.6, 1.0, 0.8);
  }
}
function specialBuilding(b, p) {
  const bb = p.bb;
  const w = bb.maxx - bb.minx, h = bb.maxy - bb.miny;
  b.save();
  b.beginPath(); b.moveTo(p.p[0], p.p[1]);
  for (let i = 2; i < p.p.length; i += 2) b.lineTo(p.p[i], p.p[i + 1]);
  b.closePath();
  if (p.style === 'station') {
    b.fillStyle = '#8b8f96'; b.fill(); b.clip();
    b.fillStyle = 'rgba(170,205,225,0.55)';
    for (let k = 0; k < 5; k++) b.fillRect(bb.minx + 6, bb.miny + 4 + k * 7.5, w - 12, 3.2);
    b.strokeStyle = 'rgba(0,0,0,0.3)'; b.lineWidth = 0.3;
    for (let xx = bb.minx + 6; xx < bb.maxx - 6; xx += 4) { b.beginPath(); b.moveTo(xx, bb.miny + 3); b.lineTo(xx, bb.maxy - 3); b.stroke(); }
  } else if (p.style === 'hospital') {
    b.fillStyle = '#d6d9dc'; b.fill(); b.clip();
    b.fillStyle = '#c3c7cb';
    b.fillRect(bb.minx + 10, bb.miny + 8, 26, 18); b.fillRect(bb.maxx - 40, bb.maxy - 24, 30, 16);
    const cx = bb.minx + w * 0.62, cy = bb.miny + h * 0.38;
    b.strokeStyle = '#f1f1f1'; b.lineWidth = 0.8; circle(b, cx, cy, 8); b.stroke();
    b.fillStyle = '#e53935'; b.fillRect(cx - 1.4, cy - 5, 2.8, 10); b.fillRect(cx - 5, cy - 1.4, 10, 2.8);
  } else if (p.style === 'tower') {
    b.fillStyle = '#9a8f80'; b.fill(); b.clip();
    const cx = (bb.minx + bb.maxx) / 2, cy = (bb.miny + bb.maxy) / 2;
    b.fillStyle = '#4f5660'; circle(b, cx, cy, Math.min(w, h) * 0.42); b.fill();
    b.strokeStyle = 'rgba(255,255,255,0.22)'; b.lineWidth = 0.15;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; b.beginPath(); b.moveTo(cx, cy); b.lineTo(cx + Math.cos(a) * w * 0.42, cy + Math.sin(a) * h * 0.42); b.stroke(); }
    b.fillStyle = '#c9a54a'; circle(b, cx, cy, 0.35); b.fill();
  } else if (p.style === 'church') {
    b.fillStyle = '#5f6670'; b.fill(); b.clip();
    b.fillStyle = 'rgba(255,255,255,0.12)'; b.fillRect(bb.minx, bb.miny, w, h / 2);
    b.strokeStyle = 'rgba(255,255,255,0.25)'; b.lineWidth = 0.3;
    b.beginPath(); b.moveTo(bb.minx + 1, bb.miny + h / 2); b.lineTo(bb.maxx - 1, bb.miny + h / 2); b.stroke();
    b.fillStyle = '#4c525b'; b.fillRect(bb.minx + 1, bb.miny + h / 2 - 5, 9, 10);
    b.fillStyle = '#d8c58a'; b.fillRect(bb.minx + 4.8, bb.miny + h / 2 - 2.5, 1.2, 5); b.fillRect(bb.minx + 3.4, bb.miny + h / 2 - 0.9, 4, 1.2);
  } else {
    b.fillStyle = '#b9bcc0'; b.fill(); b.clip();
    b.fillStyle = '#9fa4aa';
    for (let k = 0; k < 6; k++) b.fillRect(bb.minx + 4 + k * 10, bb.miny + 5, 3, 2);
  }
  b.restore();
  b.strokeStyle = 'rgba(0,0,0,0.35)'; b.lineWidth = 0.3;
  b.beginPath(); b.moveTo(p.p[0], p.p[1]);
  for (let i = 2; i < p.p.length; i += 2) b.lineTo(p.p[i], p.p[i + 1]);
  b.closePath(); b.stroke();
  if (p.label) {
    b.save();
    b.translate((bb.minx + bb.maxx) / 2, (bb.miny + bb.maxy) / 2 + (p.style === 'hospital' ? 22 : 0));
    b.fillStyle = 'rgba(255,255,255,0.75)';
    b.font = 'bold 5px sans-serif'; b.textAlign = 'center'; b.textBaseline = 'middle';
    b.fillText(p.label, 0, p.style === 'hospital' ? -6 : 0);
    b.restore();
  }
}

// voiture vue de dessus (aussi utilisée pour le trafic)
export function drawCar(x, cx, cy, ang, L, Wd, color, lights, brake = false, blink = 0) {
  x.save();
  x.translate(cx, cy); x.rotate(ang);
  x.fillStyle = 'rgba(0,0,0,0.3)';
  x.beginPath(); x.roundRect(-L / 2 + 0.2, -Wd / 2 + 0.3, L, Wd, 0.6); x.fill();
  x.fillStyle = color;
  x.beginPath(); x.roundRect(-L / 2, -Wd / 2, L, Wd, 0.55); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.06; x.stroke();
  // vitres
  x.fillStyle = 'rgba(25,35,45,0.85)';
  x.beginPath(); x.roundRect(L * 0.08, -Wd / 2 + 0.18, L * 0.18, Wd - 0.36, 0.2); x.fill();
  x.beginPath(); x.roundRect(-L * 0.36, -Wd / 2 + 0.2, L * 0.12, Wd - 0.4, 0.2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.12)';
  x.fillRect(-L * 0.22, -Wd / 2 + 0.25, L * 0.28, Wd - 0.5);
  if (lights) {
    x.fillStyle = '#fff6cf';
    x.fillRect(L / 2 - 0.12, -Wd / 2 + 0.15, 0.1, 0.35); x.fillRect(L / 2 - 0.12, Wd / 2 - 0.5, 0.1, 0.35);
    x.fillStyle = brake ? '#ff2a1a' : '#8a1a12';
    x.fillRect(-L / 2 + 0.02, -Wd / 2 + 0.15, 0.12, 0.38); x.fillRect(-L / 2 + 0.02, Wd / 2 - 0.53, 0.12, 0.38);
    if (blink) {
      x.fillStyle = '#ffae00';
      const yy = blink < 0 ? -Wd / 2 - 0.05 : Wd / 2 - 0.25;
      x.fillRect(L / 2 - 0.4, yy, 0.35, 0.3); x.fillRect(-L / 2 + 0.05, yy, 0.35, 0.3);
    }
  }
  x.restore();
}
