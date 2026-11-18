// Incidents de conduite communs aux lignes, aux défis et à la conduite libre :
// chocs, frottements, mobilier renversé, voitures percutées, trottoirs, feux, vitesse, confort.
import { segIntersect } from './geom.js';

const WHAT = {
  wall: 'un mur', car: 'une voiture garée', traffic: 'une voiture', tree: 'un arbre', lamp: 'un lampadaire',
  bollard: 'un potelet', stoppole: 'un poteau d’arrêt', signal: 'un feu', shelter: 'un abribus', fountain: 'la fontaine',
  statue: 'la statue', cone: 'un plot', parkedbus: 'un bus garé', trailer: 'une remorque',
};
const KNOCK = {
  cone: 'Plot renversé', lamp: 'Lampadaire arraché !', stoppole: 'Poteau d’arrêt renversé !',
  signal: 'Feu tricolore renversé !', shelter: 'Abribus détruit !',
};

export function newScore() {
  return {
    collisions: 0, scrapes: 0, curbs: 0, red: 0, speeding: 0, knocked: 0, cones: 0, mirrors: 0, cars: 0,
    missed: 0, doorsOut: 0, early: 0, noBlink: 0, punct: [], dock: [], comfort: 100, left: 0, damage: 0,
  };
}

export function trackIncidents(m, dt, bus, ev, world, sigTime) {
  const sc = m.sc;
  m.hitCool = Math.max(0, (m.hitCool || 0) - dt);
  m.curbCool = Math.max(0, (m.curbCool || 0) - dt);
  m.scrapeCool = Math.max(0, (m.scrapeCool || 0) - dt);
  m.pushCool = Math.max(0, (m.pushCool || 0) - dt);
  const f = bus.front;
  const pax = m.onboard ? m.onboard.length : 0;

  // rue et limitation de vitesse
  const e = world.streetAt(f.x, f.y);
  if (e) { m.speedLimit = e.speed; m.street = e.name; }
  if (m.speedLimit && bus.kmh > m.speedLimit + 4) {
    sc.speeding += dt;
    if (!m.speedWarn) { m.say(`Excès de vitesse : ${m.speedLimit} km/h`, 'warn'); m.speedWarn = true; }
  } else m.speedWarn = false;

  // frottement continu
  if (ev.scrape > 0) {
    m.scrapeT = (m.scrapeT || 0) + dt;
    sc.comfort -= 2.5 * dt;
    if (m.scrapeT > 0.12 && m.scrapeCool <= 0) {
      const im = ev.impacts.find((i) => i.type === 'scrape');
      sc.scrapes++;
      m.say(`Ça frotte contre ${WHAT[im && im.kind] || 'un obstacle'} !`, 'bad', 2.2);
      m.scrapeCool = 2.0;
    }
  } else m.scrapeT = 0;

  for (const im of ev.impacts || []) {
    if (im.type === 'hit' || im.type === 'crash') {
      if (m.hitCool > 0 || im.speed < 0.25) continue;
      const hard = im.type === 'crash';
      if (hard) sc.collisions++; else sc.scrapes++;
      sc.comfort -= hard ? 10 + im.speed * 2 : 3 + im.speed * 2;
      m.say(`${hard ? 'Collision' : 'Accrochage'} : ${WHAT[im.kind] || 'un obstacle'} (${Math.round(im.speed * 3.6)} km/h)`, 'bad', 2.8);
      m.hitCool = 1.0;
      m.lastHit = { x: im.x, y: im.y, t: 0.6 };
    } else if (im.type === 'knock') {
      if (im.kind === 'cone') sc.cones++; else { sc.knocked++; sc.comfort -= 4; }
      m.say(KNOCK[im.kind] || 'Obstacle renversé', im.kind === 'cone' ? 'warn' : 'bad', 2.6);
      m.lastHit = { x: im.x, y: im.y, t: 0.6 };
    } else if (im.type === 'mirror') {
      sc.mirrors++;
      m.say('Rétroviseur cassé !', 'bad', 2.6);
    }
  }
  for (const p of ev.pushes || []) {
    if (m.pushCool > 0 || p.speed < 0.3) continue;
    sc.cars++; sc.collisions++;
    sc.comfort -= 6 + p.speed * 3;
    m.say(p.kind === 'traffic' ? 'Voiture percutée !' : 'Voiture garée percutée !', 'bad', 2.8);
    m.pushCool = 1.5;
    m.lastHit = { x: p.px, y: p.py, t: 0.6 };
  }
  if (ev.hit && ev.hit.kind === 'artic' && m.hitCool <= 0) {
    m.say('Angle d’articulation maximal', 'warn');
    m.hitCool = 1.5;
  }
  if (ev.curb > 0 && m.curbCool <= 0) {
    sc.curbs++;
    sc.comfort -= 1.5 + Math.min(6, bus.kmh * 0.25);
    m.say('Roue sur le trottoir', 'warn', 1.8);
    m.curbCool = 1.0;
  }
  // confort : accélérations ressenties par les voyageurs debout
  const ex = Math.max(0, Math.abs(bus.acc) - 1.7) + Math.max(0, Math.abs(bus.latAcc) - 1.9);
  if (ex > 0 && !ev.hit) sc.comfort -= ex * dt * (2 + pax * 0.08);
  sc.comfort = Math.max(0, sc.comfort);
  m.discomfort = ex;

  // feux rouges
  if (m.lastFront && world.signals) {
    for (const sig of world.signals) {
      const Ln = sig.line;
      if (Math.abs(Ln.ax - f.x) > 20 || Math.abs(Ln.ay - f.y) > 20) continue;
      if (!segIntersect(m.lastFront.x, m.lastFront.y, f.x, f.y, Ln.ax, Ln.ay, Ln.bx, Ln.by)) continue;
      const mv = (f.x - m.lastFront.x) * sig.ux + (f.y - m.lastFront.y) * sig.uy;
      if (mv > 0 && world.signalState(sig, sigTime) === 'R') { sc.red++; m.say('Feu rouge grillé !', 'bad', 3); }
    }
  }
  m.lastFront = { x: f.x, y: f.y };

  sc.damage = bus.damage;
  if (bus.damage >= 100 && !m.wrecked) {
    m.wrecked = true;
    m.say('Véhicule hors d’usage !', 'bad', 4);
  }
}

// note de sécurité commune
export function safetyScore(sc) {
  const v = 100 - sc.collisions * 12 - sc.scrapes * 5 - sc.curbs * 2 - sc.red * 15 - sc.speeding * 1.2
    - sc.knocked * 8 - sc.cones * 4 - sc.mirrors * 6 - sc.damage * 0.15;
  return Math.max(0, Math.min(100, v));
}
