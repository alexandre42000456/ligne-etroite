// Caméra et rendu dynamique (bus, trafic, piétons, guidage)
import { clamp, wrapAngle, smooth, TAU } from './geom.js';
import { drawCar, circle } from './mapRenderer.js';

export class Renderer {
  constructor(canvas, world, mapR) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.mapR = mapR;
    this.cam = { x: 0, y: 0, ang: -Math.PI / 2, zoom: 7, shake: 0 };
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr; this.w = w; this.h = h;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
  }

  // milieu entre l'avant du bus et l'arrière de la dernière caisse
  busMid(bus) {
    const f = bus.front, g = bus.geo, n = g.poses.length - 1, P = g.poses[n], x0 = bus.secs[n].x0;
    const rx = P.x + Math.cos(P.th) * x0, ry = P.y + Math.sin(P.th) * x0;
    return { x: (f.x + rx) / 2, y: (f.y + ry) / 2 };
  }

  snap(bus, settings) {
    const c = this.busMid(bus);
    this.cam.x = c.x; this.cam.y = c.y;
    this.cam.ang = settings.northUp ? -Math.PI / 2 : bus.th;
  }

  updateCamera(bus, dt, settings) {
    const c = this.busMid(bus);
    const look = clamp(2 + Math.max(0, bus.v) * 0.6, 0, 9);
    const tx = c.x + Math.cos(bus.th) * look, ty = c.y + Math.sin(bus.th) * look;
    this.cam.x = smooth(this.cam.x, tx, 6, dt);
    this.cam.y = smooth(this.cam.y, ty, 6, dt);
    const ta = settings.northUp ? -Math.PI / 2 : bus.th;
    this.cam.ang += wrapAngle(ta - this.cam.ang) * (1 - Math.exp(-3.2 * dt));
    const auto = settings.autoZoom ? 1 - 0.25 * clamp(bus.kmh / 45, 0, 1) : 1;
    this.cam.zoom = smooth(this.cam.zoom, settings.zoom * auto, 3, dt);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 2.5);
    this.anchor = { x: this.w / 2, y: settings.northUp ? this.h * 0.52 : this.h * 0.6 };
  }

  // rayon de la zone visible (m), pour le trafic
  viewCircle() {
    const r = Math.hypot(this.w, this.h) / 2 / this.cam.zoom;
    return { x: this.cam.x, y: this.cam.y, r: r + 6 };
  }

  screenToWorld(sx, sy) {
    const phi = -(this.cam.ang + Math.PI / 2);
    const dx = (sx - this.anchor.x) / this.cam.zoom, dy = (sy - this.anchor.y) / this.cam.zoom;
    const c = Math.cos(-phi), s = Math.sin(-phi);
    return { x: this.cam.x + c * dx - s * dy, y: this.cam.y + s * dx + c * dy };
  }

  draw(S) {
    const { bus, traffic, mission, settings, sigTime } = S;
    const x = this.ctx, cam = this.cam, dpr = this.dpr;
    const mr = this.mapR, CS = mr.CS;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#7b6b60';
    x.fillRect(0, 0, this.cv.width, this.cv.height);

    // tuiles visibles
    const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.w, 0), this.screenToWorld(0, this.h), this.screenToWorld(this.w, this.h)];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of corners) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
    const list = [];
    for (let iy = Math.floor(miny / CS); iy <= Math.floor(maxy / CS); iy++)
      for (let ix = Math.floor(minx / CS); ix <= Math.floor(maxx / CS); ix++) list.push([ix, iy]);
    const cx = cam.x / CS, cy = cam.y / CS;
    list.sort((a, b) => (a[0] + 0.5 - cx) ** 2 + (a[1] + 0.5 - cy) ** 2 - ((b[0] + 0.5 - cx) ** 2 + (b[1] + 0.5 - cy) ** 2));
    mr.ensure(list, S.loading ? 200 : 7);

    const sh = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake * 6 : 0;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.translate(this.anchor.x + sh, this.anchor.y + sh);
    x.rotate(-(cam.ang + Math.PI / 2));
    x.scale(cam.zoom, cam.zoom);
    x.translate(-cam.x, -cam.y);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    for (const [ix, iy] of list) {
      const c = mr.get(ix, iy);
      if (c) x.drawImage(c, ix * CS - 0.02, iy * CS - 0.02, CS + 0.04, CS + 0.04);
    }
    const view = { minx: minx - 5, miny: miny - 5, maxx: maxx + 5, maxy: maxy + 5 };
    const vis = (px, py, r = 3) => px > view.minx - r && px < view.maxx + r && py > view.miny - r && py < view.maxy + r;

    if (mission && !mission.free && settings.guide) this.drawGuide(x, mission, bus);
    if (!S.hideBus && settings.predict && bus.gear !== 'N') this.drawPrediction(x, bus);
    if (mission) for (const p of mission.peds) if (vis(p.x, p.y)) drawPed(x, p);
    for (const c of traffic.cars) {
      if (!vis(c.obb.cx, c.obb.cy, 4)) continue;
      x.globalAlpha = c.ghost ? clamp(c.fade, 0, 1) : 1;
      drawCar(x, c.obb.cx, c.obb.cy, Math.atan2(c.obb.uy, c.obb.ux), c.L, c.W, c.color, true, c.braking, (sigTime * 1.5) % 1 < 0.5 ? c.blink : 0);
    }
    x.globalAlpha = 1;
    if (!S.hideBus) this.drawBus(x, bus, S.lineColor || '#e53935', S.lineId || '', sigTime);
    // voûte des portes de ville (le bus passe dessous)
    for (const gt of this.world.gates) {
      if (!vis(gt.x, gt.y, 10)) continue;
      x.save(); x.translate(gt.x, gt.y); x.rotate(Math.atan2(gt.uy, gt.ux));
      x.globalAlpha = 0.6;
      x.fillStyle = '#8f8576';
      x.fillRect(-2.6, -gt.hw - 0.6, 5.2, gt.hw * 2 + 1.2);
      x.strokeStyle = '#5e564b'; x.lineWidth = 0.12;
      for (let k = -2; k <= 2; k += 0.9) { x.beginPath(); x.moveTo(k, -gt.hw - 0.6); x.lineTo(k, gt.hw + 0.6); x.stroke(); }
      x.globalAlpha = 1;
      x.strokeStyle = '#6d6457'; x.lineWidth = 0.25;
      x.strokeRect(-2.6, -gt.hw - 0.6, 5.2, gt.hw * 2 + 1.2);
      x.restore();
    }
    // feux
    for (const sg of this.world.signals) {
      if (!vis(sg.head.x, sg.head.y)) continue;
      const st = this.world.signalState(sg, sigTime);
      const a = Math.atan2(sg.uy, sg.ux);
      x.save(); x.translate(sg.head.x, sg.head.y); x.rotate(a);
      x.fillStyle = '#1d1d1d';
      x.beginPath(); x.roundRect(-0.25, -0.6, 0.5, 1.2, 0.15); x.fill();
      const col = st === 'G' ? '#2ee86a' : st === 'Y' ? '#ffb300' : '#ff3b30';
      const off = st === 'G' ? 0.35 : st === 'Y' ? 0 : -0.35;
      x.fillStyle = col;
      x.shadowColor = col; x.shadowBlur = 8;
      circle(x, 0, off, 0.18); x.fill();
      x.shadowBlur = 0;
      x.restore();
    }
    if (mission && mission.lastHit && mission.lastHit.t > 0) {
      const h = mission.lastHit;
      h.t -= 1 / 60;
      x.strokeStyle = `rgba(255,60,40,${h.t * 1.5})`;
      x.lineWidth = 0.3;
      circle(x, h.x, h.y, 1.2 + (0.6 - h.t) * 4); x.stroke();
    }
  }

  drawGuide(x, mission, bus) {
    const P = mission.line.path;
    const s0 = Math.max(0, mission.s - 25), s1 = Math.min(P.len, mission.s + 170);
    if (s1 <= s0) return;
    const pts = P.slice(s0, s1, 2);
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = hexA(mission.line.color, 0.28);
    x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) x.lineTo(p.x, p.y);
    x.stroke();
    // chevrons
    x.fillStyle = 'rgba(255,255,255,0.55)';
    const ph = (performance.now() / 1000) * 6 % 9;
    for (let s = Math.ceil((s0 + ph) / 9) * 9 - ph; s < s1; s += 9) {
      const q = P.at(s), d = P.dirAt(s, 1);
      x.save(); x.translate(q.x, q.y); x.rotate(Math.atan2(d.uy, d.ux));
      x.beginPath(); x.moveTo(0.6, 0); x.lineTo(-0.4, -0.55); x.lineTo(-0.15, 0); x.lineTo(-0.4, 0.55); x.closePath(); x.fill();
      x.restore();
    }
    // prochain arrêt : empreinte cible
    const S = mission.stopAt(mission.stopIdx);
    if (S) {
      const st = S.st, T = mission.T;
      const t = performance.now() / 1000;
      const lat = st.curb - 0.28 - T.width / 2;
      const a0 = T.doorDist[0], a1 = T.doorDist[0] - T.len;
      const c0 = st.at(a0, lat - T.width / 2), c1 = st.at(a0, lat + T.width / 2), c2 = st.at(a1, lat + T.width / 2), c3 = st.at(a1, lat - T.width / 2);
      const ok = mission.dock && mission.dock.valid;
      x.fillStyle = ok ? 'rgba(60,220,120,0.22)' : hexA(mission.line.color, 0.14 + 0.06 * Math.sin(t * 4));
      x.strokeStyle = ok ? 'rgba(60,220,120,0.9)' : 'rgba(255,255,255,0.7)';
      x.lineWidth = 0.14; x.setLineDash([0.8, 0.5]);
      x.beginPath(); x.moveTo(c0.x, c0.y); x.lineTo(c1.x, c1.y); x.lineTo(c2.x, c2.y); x.lineTo(c3.x, c3.y); x.closePath();
      x.fill(); x.stroke(); x.setLineDash([]);
      x.strokeStyle = `rgba(255,214,0,${0.5 + 0.4 * Math.sin(t * 5)})`;
      x.lineWidth = 0.18;
      circle(x, st.pole.x, st.pole.y, 1.0 + 0.3 * Math.sin(t * 5)); x.stroke();
    }
  }

  drawPrediction(x, bus) {
    const dir = bus.gear === 'R' ? -1 : 1;
    const tr = bus.predict(16, dir);
    x.lineWidth = 0.12;
    const cols = ['rgba(255,220,60,0.85)', 'rgba(255,220,60,0.85)', 'rgba(80,220,255,0.85)', 'rgba(80,220,255,0.85)', 'rgba(255,120,60,0.9)'];
    tr.forEach((a, k) => {
      if (k === 4 && Math.abs(bus.steer) < 0.05) return;
      x.strokeStyle = cols[k];
      x.setLineDash(k >= 2 ? [0.4, 0.3] : []);
      x.beginPath(); x.moveTo(a[0], a[1]);
      for (let i = 2; i < a.length; i += 2) x.lineTo(a[i], a[i + 1]);
      x.stroke();
    });
    x.setLineDash([]);
  }

  drawBus(x, bus, color, lineId, t) {
    const T = bus.T, g = bus.geo, hw = T.width / 2;
    const n = bus.secs.length;
    // ombre
    for (let i = 0; i < n; i++) {
      const P = g.poses[i], s = bus.secs[i];
      x.save(); x.translate(P.x, P.y); x.rotate(P.th);
      x.fillStyle = 'rgba(0,0,0,0.32)';
      x.beginPath(); x.roundRect(s.x0 + 0.45, -hw + 0.6, s.x1 - s.x0, hw * 2, 0.4); x.fill();
      x.restore();
    }
    // soufflet de l'articulé
    if (T.artic) {
      const P0 = g.poses[0], P1 = g.poses[1];
      const a = bus.secs[0].x0, b = bus.secs[1].x1;
      const pt = (P, lx, ly) => ({ x: P.x + Math.cos(P.th) * lx - Math.sin(P.th) * ly, y: P.y + Math.sin(P.th) * lx + Math.cos(P.th) * ly });
      const q = [pt(P0, a + 0.1, -hw + 0.08), pt(P0, a + 0.1, hw - 0.08), pt(P1, b - 0.1, hw - 0.08), pt(P1, b - 0.1, -hw + 0.08)];
      x.fillStyle = '#2d2f33';
      x.beginPath(); x.moveTo(q[0].x, q[0].y); for (const p of q) x.lineTo(p.x, p.y); x.closePath(); x.fill();
      x.strokeStyle = '#4a4d52'; x.lineWidth = 0.06;
      for (let k = 1; k < 6; k++) {
        const u = k / 6;
        x.beginPath();
        x.moveTo(q[0].x + (q[3].x - q[0].x) * u, q[0].y + (q[3].y - q[0].y) * u);
        x.lineTo(q[1].x + (q[2].x - q[1].x) * u, q[1].y + (q[2].y - q[1].y) * u);
        x.stroke();
      }
      x.fillStyle = '#1a1b1e';
      circle(x, g.joint.x, g.joint.y, 0.5); x.fill();
    }
    const blinkOn = bus.blink && bus.blinkT % 0.7 < 0.38;
    const fw = bus.frontWheelAngles();
    for (let i = 0; i < n; i++) {
      const P = g.poses[i], s = bus.secs[i];
      const L = s.x1 - s.x0;
      x.save(); x.translate(P.x, P.y); x.rotate(P.th);
      const front = i === 0, rear = i === n - 1;
      // carrosserie
      x.fillStyle = color;
      x.beginPath(); x.roundRect(s.x0, -hw, L, hw * 2, [rear ? 0.35 : 0.1, front ? 0.55 : 0.1, front ? 0.55 : 0.1, rear ? 0.35 : 0.1]); x.fill();
      // toit (blanc, bords de caisse à la couleur de la ligne)
      x.fillStyle = '#f2f1ec';
      x.beginPath(); x.roundRect(s.x0 + 0.22, -hw + 0.26, L - (front ? 0.95 : 0.44), hw * 2 - 0.52, 0.3); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.06)';
      x.fillRect(s.x0 + 0.3, 0, L - 1.0, hw - 0.28);
      // bandeau vitré latéral
      x.fillStyle = 'rgba(20,30,40,0.55)';
      x.fillRect(s.x0 + (rear ? 0.9 : 0.3), -hw + 0.06, L - (front ? 1.4 : 0.6) - (rear ? 0.6 : 0), 0.13);
      x.fillRect(s.x0 + (rear ? 0.9 : 0.3), hw - 0.19, L - (front ? 1.4 : 0.6) - (rear ? 0.6 : 0), 0.13);
      // pare-brise et lunette
      if (front) {
        x.fillStyle = '#20303c';
        x.beginPath(); x.roundRect(s.x1 - 0.5, -hw + 0.14, 0.42, hw * 2 - 0.28, 0.25); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.25)';
        x.fillRect(s.x1 - 0.42, -hw + 0.4, 0.08, hw * 2 - 0.8);
        // numéro de ligne
        if (lineId) {
          x.save(); x.translate(s.x1 - 1.6, 0); x.rotate(Math.PI / 2);
          x.fillStyle = color; circle(x, 0, 0, 0.62); x.fill();
          x.fillStyle = '#fff'; x.font = 'bold 0.8px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(lineId, 0, 0.04);
          x.restore();
        }
      }
      if (rear) {
        x.fillStyle = '#2a333b';
        x.fillRect(s.x0 + 0.08, -hw + 0.35, 0.18, hw * 2 - 0.7);
      }
      // équipements de toit : climatisation, trappes
      x.fillStyle = '#d6d7d9';
      const acx = front ? s.x0 + Math.min(2.2, L * 0.25) : s.x0 + L * 0.35;
      x.beginPath(); x.roundRect(acx, -0.75, 2.6, 1.5, 0.25); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 0.05;
      for (let k = 1; k < 6; k++) { x.beginPath(); x.moveTo(acx + k * 0.43, -0.6); x.lineTo(acx + k * 0.43, 0.6); x.stroke(); }
      x.fillStyle = '#c8cacc';
      x.fillRect(s.x1 - (front ? 3.6 : 2.4), -0.45, 0.9, 0.9);
      if (L > 9) x.fillRect(s.x0 + L * 0.62, -0.45, 0.9, 0.9);
      // roues (visibles en transparence)
      x.fillStyle = 'rgba(15,15,15,0.72)';
      for (let k = 0; k < bus.wheelDefs.length; k++) {
        const w = bus.wheelDefs[k];
        if (w.sec !== i) continue;
        const ly = w.side * (hw - 0.27);
        x.save(); x.translate(w.x, ly);
        if (w.steer) x.rotate(fw[w.side < 0 ? 0 : 1]);
        x.fillRect(-0.5, -0.17, 1.0, 0.34);
        x.restore();
      }
      // portes (côté droit)
      if (bus.doors > 0) {
        x.fillStyle = '#39e36f';
        bus.doorDefs.forEach((d) => {
          if (d.sec !== i) return;
          x.fillRect(d.x - 0.6, hw - 0.02, 1.2, 0.1 + 0.18 * bus.doors);
        });
      }
      // feux
      if (front) {
        x.fillStyle = '#fff8dc';
        x.fillRect(s.x1 - 0.12, -hw + 0.12, 0.1, 0.4); x.fillRect(s.x1 - 0.12, hw - 0.52, 0.1, 0.4);
        // rétroviseurs
        x.fillStyle = '#1b1b1b';
        x.fillRect(s.x1 - 0.45, -hw - 0.42, 0.22, 0.32); x.fillRect(s.x1 - 0.45, hw + 0.1, 0.22, 0.32);
        x.fillRect(s.x1 - 0.3, -hw - 0.15, 0.06, 0.2); x.fillRect(s.x1 - 0.3, hw - 0.05, 0.06, 0.2);
      }
      if (rear) {
        const br = bus.braking > 0.05 || (bus.v === 0 && bus.gear !== 'N');
        x.fillStyle = br ? '#ff2a1a' : '#7a1a14';
        x.fillRect(s.x0 + 0.02, -hw + 0.1, 0.12, 0.45); x.fillRect(s.x0 + 0.02, hw - 0.55, 0.12, 0.45);
        if (bus.gear === 'R') { x.fillStyle = '#ffffff'; x.fillRect(s.x0 + 0.02, -hw + 0.6, 0.1, 0.25); x.fillRect(s.x0 + 0.02, hw - 0.85, 0.1, 0.25); }
      }
      if (blinkOn) {
        x.fillStyle = '#ffae00';
        x.shadowColor = '#ffae00'; x.shadowBlur = 10;
        const yy = bus.blink < 0 ? -hw - 0.05 : hw - 0.3;
        if (front) x.fillRect(s.x1 - 0.45, yy, 0.4, 0.35);
        if (rear) x.fillRect(s.x0 + 0.05, yy, 0.4, 0.35);
        x.fillRect(s.x0 + L * 0.5, yy, 0.35, 0.35);
        x.shadowBlur = 0;
      }
      x.restore();
    }
  }
}

function drawPed(x, p) {
  const bob = p.state === 'wait' ? 0 : Math.sin(p.ph) * 0.05;
  x.fillStyle = 'rgba(0,0,0,0.25)';
  circle(x, p.x + 0.12, p.y + 0.15, 0.3); x.fill();
  x.fillStyle = p.c;
  x.beginPath(); x.ellipse(p.x, p.y, 0.27 + bob, 0.2, 0, 0, TAU); x.fill();
  x.fillStyle = '#3b2a20';
  circle(x, p.x, p.y, 0.13); x.fill();
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
