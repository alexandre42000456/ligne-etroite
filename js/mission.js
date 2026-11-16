// Service de la ligne : arrêts, passagers, horaire, accostage, pénalités et score
import { clamp, wrapAngle, segIntersect, DEG } from './geom.js';

const PED_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1', '#34495e', '#d35400', '#27ae60', '#c0392b', '#7f8c8d'];

export class Mission {
  constructor(world, line, T, opts = {}) {
    this.world = world;
    this.line = line;
    this.T = T;
    this.free = !!opts.free;
    this.time = 0;
    this.stopIdx = 0;
    this.s = 0;
    this.onboard = [];
    this.peds = [];
    this.msgs = [];
    this.finished = false;
    const N = line.stops.length;
    this.waiting = line.stops.map((_, k) => (k === N - 1 ? 0 : k === 0 ? 6 + rnd(6) : 1 + rnd(6)));
    this.requested = false;
    this.bellRung = false;
    this.served = line.stops.map(() => false);
    this.arrivals = line.stops.map(() => null);
    this.exchange = null;
    // horaire
    const v = (line.def.kmh || 18) / 3.6;
    this.schedule = [];
    let t = 20;
    line.stops.forEach((st, k) => {
      if (k > 0) t += (st.s - line.stops[k - 1].s) / v + (k > 1 ? 18 : 0);
      this.schedule.push(Math.round(t));
    });
    this.sc = {
      collisions: 0, scrapes: 0, curbs: 0, red: 0, speeding: 0, missed: 0, doorsOut: 0, early: 0, noBlink: 0,
      punct: [], dock: [], comfort: 100, left: 0,
    };
    this.hitCool = 0; this.curbCool = 0; this.offT = 0;
    this.doorsWasOpen = false;
    this.doorPenalized = false;
    this.lastFront = null;
    this.speedLimit = line.stops[0].st.e.speed;
    this.street = line.stops[0].st.e.name;
    this.departed = false;
    this.spawnPeds(0);
    this.spawnPeds(1);
  }

  say(text, kind = 'info', dur = 2.6) {
    this.msgs.push({ text, kind, t: dur });
  }

  stopAt(k) { return this.line.stops[k]; }

  spawnPeds(k) {
    const S = this.stopAt(k);
    if (!S || this.peds.some((p) => p.stop === k)) return;
    const st = S.st;
    for (let i = 0; i < this.waiting[k]; i++) {
      const along = -2 - Math.random() * 9;
      const lat = st.curb + 0.9 + Math.random() * Math.max(0.3, (st.bay ? 2.5 : st.e.sw) - 1.3);
      const p = st.at(along, lat);
      this.peds.push({ stop: k, x: p.x, y: p.y, tx: p.x, ty: p.y, state: 'wait', c: PED_COLORS[(Math.random() * PED_COLORS.length) | 0], ph: Math.random() * 6 });
    }
  }

  // qualité d'accostage au prochain arrêt
  docking(bus) {
    const S = this.stopAt(this.stopIdx);
    if (!S) return null;
    const st = S.st;
    const doors = bus.geo.doors;
    let maxGap = -Infinity, minGap = Infinity, sum = 0;
    let along0 = 0;
    doors.forEach((d, i) => {
      const dx = d.x - st.F.x, dy = d.y - st.F.y;
      const lat = dx * st.nx + dy * st.ny;
      const along = dx * st.ux + dy * st.uy;
      if (i === 0) along0 = along;
      const gap = st.curb - lat;
      maxGap = Math.max(maxGap, gap); minGap = Math.min(minGap, gap); sum += gap;
    });
    const stTh = Math.atan2(st.uy, st.ux);
    let ang = 0;
    for (const P of bus.geo.poses) ang = Math.max(ang, Math.abs(wrapAngle(P.th - stTh)));
    const avg = sum / doors.length;
    const valid = Math.abs(along0) <= 3.2 && ang <= 12 * DEG && maxGap <= 1.25 && minGap >= -0.35;
    const quality = clamp(100 - Math.max(0, avg - 0.3) * 75 - Math.max(0, Math.abs(along0) - 0.8) * 9 - (ang / DEG) * 1.5, 0, 100);
    return { valid, along: along0, avgGap: avg, maxGap, minGap, ang, quality, near: Math.abs(along0) < 25 };
  }

  update(dt, bus, ev, world, sigTime) {
    this.time += dt;
    if (this.hitCool > 0) this.hitCool -= dt;
    if (this.curbCool > 0) this.curbCool -= dt;
    for (const m of this.msgs) m.t -= dt;
    this.msgs = this.msgs.filter((m) => m.t > 0);
    const L = this.line, path = L.path;

    // progression le long de l'itinéraire (avant du bus)
    const f = bus.front;
    const pr = this.time <= dt ? path.project(f.x, f.y, 0, 120) : path.project(f.x, f.y, this.s, 30);
    if (pr.dist < 9) { this.s = pr.s; this.offT = 0; this.off = false; }
    else { this.offT += dt; this.off = this.offT > 1.2; }
    if (this.off && this.offT > 1.2 && this.offT - dt <= 1.2) this.say('Hors itinéraire ! Revenez sur le tracé', 'warn', 3);

    // rue et limitation
    const e = world.streetAt(f.x, f.y);
    if (e) { this.speedLimit = e.speed; this.street = e.name; }
    if (bus.kmh > this.speedLimit + 4) {
      this.sc.speeding += dt;
      if (!this.speedWarn) { this.say(`Excès de vitesse : ${this.speedLimit} km/h`, 'warn'); this.speedWarn = true; }
    } else this.speedWarn = false;

    // incidents
    if (ev.hit && ev.hit.kind !== 'artic') {
      if (this.hitCool <= 0 && ev.hitSpeed > 0.25) {
        const hard = ev.hitSpeed > 2.8;
        if (hard) this.sc.collisions++; else this.sc.scrapes++;
        this.sc.comfort -= hard ? 12 : 4;
        const what = { wall: 'un mur', mirror: 'le rétroviseur', car: 'une voiture garée', traffic: 'une voiture', tree: 'un arbre', lamp: 'un lampadaire', bollard: 'un potelet', stoppole: 'un poteau d’arrêt', signal: 'un feu', shelter: 'un abribus', fountain: 'la fontaine', statue: 'la statue' }[ev.hit.kind] || 'un obstacle';
        this.say(`${hard ? 'Collision' : 'Accrochage'} : ${what} !`, 'bad', 2.8);
        this.hitCool = 1.0;
        this.lastHit = { x: ev.hit.x, y: ev.hit.y, t: 0.6 };
      }
    } else if (ev.hit && ev.hit.kind === 'artic' && this.hitCool <= 0) {
      this.say('Angle d’articulation maximal', 'warn');
      this.hitCool = 1.5;
    }
    if (ev.curb > 0 && this.curbCool <= 0) {
      this.sc.curbs++;
      this.sc.comfort -= 1.5 + Math.min(6, bus.kmh * 0.25);
      this.say('Roue sur le trottoir', 'warn', 1.8);
      this.curbCool = 1.0;
    }
    // confort : accélérations
    const ex = Math.max(0, Math.abs(bus.acc) - 1.7) + Math.max(0, Math.abs(bus.latAcc) - 1.9);
    if (ex > 0 && !ev.hit) this.sc.comfort -= ex * dt * (2 + this.onboard.length * 0.08);
    this.sc.comfort = Math.max(0, this.sc.comfort);
    this.discomfort = ex;

    // feux rouges
    if (this.lastFront) {
      for (const sig of world.signals) {
        const Ln = sig.line;
        if (Math.abs(Ln.ax - f.x) > 20 || Math.abs(Ln.ay - f.y) > 20) continue;
        if (!segIntersect(this.lastFront.x, this.lastFront.y, f.x, f.y, Ln.ax, Ln.ay, Ln.bx, Ln.by)) continue;
        const mv = (f.x - this.lastFront.x) * sig.ux + (f.y - this.lastFront.y) * sig.uy;
        if (mv > 0 && world.signalState(sig, sigTime) === 'R') {
          this.sc.red++;
          this.say('Feu rouge grillé !', 'bad', 3);
        }
      }
    }
    this.lastFront = { x: f.x, y: f.y };

    if (this.free) return;
    // clignotant gauche en quittant l'arrêt
    if (this.blinkCheck) {
      if (bus.blink === -1) this.blinkCheck.blinked = true;
      if (bus.kmh > 6) {
        if (!this.blinkCheck.blinked) { this.sc.noBlink++; this.say('Clignotant oublié en quittant l’arrêt', 'warn', 2.4); }
        this.blinkCheck = null;
      }
    }
    this.updateService(dt, bus);
    this.updatePeds(dt, bus);
  }

  updateService(dt, bus) {
    const k = this.stopIdx;
    const S = this.stopAt(k);
    if (!S) return;
    const N = this.line.stops.length;
    const doorS = this.s - this.T.doorDist[0];
    this.distToStop = S.s - doorS;
    // sonnette de demande d'arrêt
    const needAlight = this.onboard.filter((d) => d === k).length;
    if (needAlight > 0 && !this.requested && k > 0 && (this.distToStop < 260 || this.departed)) {
      this.requested = true;
      this.bell = true;
      this.say('Arrêt demandé', 'stop', 2);
    }
    const dock = (this.dock = this.docking(bus));
    const doorsOpen = bus.doors >= 0.999;

    // ouverture des portes
    if (bus.doorOpen && !this.doorsWasOpen) {
      this.doorsWasOpen = true;
      if (!(dock && dock.valid && bus.kmh < 0.5)) {
        if (!this.doorPenalized) { this.sc.doorsOut++; this.doorPenalized = true; }
        if (dock && dock.near && dock.maxGap > 1.25) this.say('Trop loin du trottoir pour ouvrir', 'warn', 3);
        else if (dock && dock.near && Math.abs(dock.along) > 3.2) this.say('Porte avant pas au niveau du poteau', 'warn', 3);
        else if (dock && dock.near) this.say('Bus de travers : accostez parallèlement', 'warn', 3);
        else this.say('Portes ouvertes hors arrêt !', 'bad', 3);
      }
    }
    if (!bus.doorOpen && this.doorsWasOpen) {
      this.doorsWasOpen = false;
      this.doorPenalized = false;
      if (this.exchange) {
        const ex = this.exchange;
        if (ex.done) {
          this.served[k] = true;
          this.finishStop(k, bus);
        } else {
          this.say('Des passagers n’ont pas fini de monter !', 'warn', 2.5);
          this.exchange = null;
        }
      }
    }

    if (doorsOpen && dock && dock.valid && !this.exchange && !this.served[k]) {
      this.startExchange(k, bus, dock);
    }
    if (this.exchange) this.runExchange(dt, bus);

    // départ du terminus
    if (k === 0 && this.served[0] && !this.departed && bus.kmh > 2) this.depart(0);

    // arrêt dépassé
    if (!this.served[k] && this.distToStop < -14 && !bus.doorOpen) {
      const need = this.waiting[k] > 0 || needAlight > 0;
      if (need) {
        this.sc.missed++;
        this.sc.left += this.waiting[k];
        this.say(`Arrêt « ${S.st.name} » manqué !`, 'bad', 3);
        // les passagers qui voulaient descendre descendent au suivant
        this.onboard = this.onboard.map((d) => (d === k ? Math.min(k + 1, N - 1) : d));
      } else {
        this.arrivals[k] = this.time;
        this.say(`« ${S.st.name} » : personne, arrêt sauté`, 'info', 2);
      }
      this.peds = this.peds.filter((p) => p.stop !== k || p.state === 'leave');
      this.served[k] = true;
      this.advance(k);
    }
  }

  startExchange(k, bus, dock) {
    const S = this.stopAt(k);
    if (this.arrivals[k] === null) {
      this.arrivals[k] = this.time;
      if (k > 0) this.sc.punct.push(this.arrivals[k] - this.schedule[k]);
      this.sc.dock.push(dock.quality);
      const q = dock.quality > 85 ? 'Accostage parfait' : dock.quality > 60 ? 'Bon accostage' : 'Accostage approximatif';
      this.say(`${q} — ${S.st.name}`, dock.quality > 60 ? 'good' : 'info', 2.2);
    }
    const alight = this.onboard.filter((d) => d === k).length + (k === this.line.stops.length - 1 ? this.onboard.length : 0);
    this.exchange = { k, alight: Math.min(alight, this.onboard.length), board: this.waiting[k], t: 0.4, done: false, slow: dock.avgGap > 0.65 };
  }

  runExchange(dt, bus) {
    const ex = this.exchange;
    const k = ex.k;
    const N = this.line.stops.length;
    ex.t -= dt;
    const doors = bus.geo.doors;
    if (ex.t <= 0) {
      if (ex.alight > 0) {
        // descente
        const idx = this.onboard.findIndex((d) => d === k || k === N - 1);
        if (idx >= 0) this.onboard.splice(idx, 1);
        ex.alight--;
        const d = doors[(Math.random() * doors.length) | 0];
        const st = this.stopAt(k).st;
        const tgt = st.at(-4 - Math.random() * 16 + 10 * Math.random(), st.curb + 1 + Math.random() * 3);
        this.peds.push({ stop: -1, x: d.x, y: d.y, tx: tgt.x, ty: tgt.y, state: 'leave', c: PED_COLORS[(Math.random() * PED_COLORS.length) | 0], ph: 0, life: 4 });
        ex.t = ex.slow ? 0.9 : 0.55;
      } else if (ex.board > 0) {
        const p = this.peds.find((q) => q.stop === k && q.state === 'wait');
        if (p) {
          let best = doors[0], bd = Infinity;
          for (const d of doors) { const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2; if (dd < bd) { bd = dd; best = d; } }
          p.state = 'board'; p.tx = best.x; p.ty = best.y;
        }
        ex.board--;
        this.waiting[k]--;
        // destination aléatoire (arrêts suivants)
        const dest = k + 1 + Math.floor(Math.random() * (N - 1 - k));
        this.onboard.push(Math.min(dest, N - 1));
        ex.t = ex.slow ? 1.0 : 0.6;
      } else if (!this.peds.some((q) => q.state === 'board')) {
        ex.done = true;
        if (!ex.announced) {
          ex.announced = true;
          if (k === N - 1) this.finish();
          else this.say('Montée terminée : fermez les portes', 'good', 2.5);
        }
      }
    }
    bus.pax = this.onboard.length;
  }

  finishStop(k, bus) {
    this.exchange = null;
    if (k === 0) {
      // départ mesuré à la mise en mouvement
    } else this.advance(k);
  }

  depart(k) {
    this.departed = true;
    const delta = this.time - this.schedule[0];
    this.sc.punct.push(delta);
    if (delta < -10) { this.sc.early++; this.say('Départ en avance sur l’horaire !', 'warn', 3); }
    else this.say('Bonne route !', 'good', 1.6);
    this.advance(k);
  }

  advance(k) {
    if (k !== this.stopIdx) return;
    if (k === 0 && !this.departed) this.departed = true;
    if (this.served[k] && this.arrivals[k] !== null && k < this.line.stops.length - 1) this.blinkCheck = { k, blinked: false };
    this.stopIdx = k + 1;
    this.requested = false;
    this.spawnPeds(this.stopIdx + 1);
    if (this.stopIdx >= this.line.stops.length) this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.finishTime = this.time;
  }

  updatePeds(dt, bus) {
    for (const p of this.peds) {
      p.ph += dt * 6;
      if (p.state === 'wait') continue;
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      const sp = 1.4 * dt;
      if (d < sp) {
        p.x = p.tx; p.y = p.ty;
        if (p.state === 'board') p.state = 'gone';
        if (p.state === 'leave') p.life -= dt;
      } else { p.x += (dx / d) * sp; p.y += (dy / d) * sp; }
      if (p.state === 'leave') p.life -= dt * 0.3;
    }
    this.peds = this.peds.filter((p) => p.state !== 'gone' && !(p.state === 'leave' && p.life <= 0));
  }

  nextManeuver() {
    for (const m of this.line.maneuvers) {
      if (m.s + m.len * 0.6 > this.s) return { ...m, dist: m.s - this.s };
    }
    return null;
  }

  results() {
    const sc = this.sc;
    const pf = (d) => (d >= -20 && d <= 45 ? 100 : d < -20 ? clamp(100 - (-20 - d) * 1.2, 0, 100) : clamp(100 - (d - 45) * 0.5, 0, 100));
    const punct = sc.punct.length ? sc.punct.reduce((a, d) => a + pf(d), 0) / sc.punct.length : 100;
    const safety = clamp(100 - sc.collisions * 12 - sc.scrapes * 5 - sc.curbs * 2 - sc.red * 15 - sc.speeding * 1.2, 0, 100);
    const dock = sc.dock.length ? sc.dock.reduce((a, b) => a + b, 0) / sc.dock.length : 50;
    const service = clamp(dock - sc.missed * 25 - sc.doorsOut * 8 - sc.early * 10 - sc.noBlink * 3, 0, 100);
    const comfort = clamp(sc.comfort, 0, 100);
    const total = Math.round(safety * 0.35 + service * 0.25 + punct * 0.2 + comfort * 0.2);
    const stars = total >= 85 ? 3 : total >= 65 ? 2 : total >= 40 ? 1 : 0;
    return { punct: Math.round(punct), safety: Math.round(safety), service: Math.round(service), comfort: Math.round(comfort), total, stars, time: this.finishTime ?? this.time };
  }
}

function rnd(n) { return Math.floor(Math.random() * (n + 1)); }
