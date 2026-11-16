// Test de bout en bout du service : le bus suit la trajectoire planifiée, accoste chaque arrêt,
// ouvre/ferme les portes et termine la ligne. Usage : node tools/e2e.mjs [ligne] [bus]
import { World } from '../js/world.js';
import { CITY } from '../js/city.js';
import { Bus, BUS_TYPES, makeCollider } from '../js/bus.js';
import { Mission } from '../js/mission.js';
import { checkLine } from './plan.mjs';

const world = new World(CITY);
const collide = makeCollider(world, null);
const mat = (x, y) => world.material(x, y);
const [lid = '2', bid] = process.argv.slice(2);
const line = world.lines.find((l) => l.id === lid);
const T = BUS_TYPES[bid || line.def.bus];
const plan = checkLine(world, line, T);
if (plan.fails.length) { console.log('plan impossible'); process.exit(1); }
const bus = new Bus(T, world.dockPose(line.stops[0].st, T));
const m = new Mission(world, line, T);
const dt = 1 / 120;
const ev0 = { hit: null, curb: 0 };
let t = 0;
const run = (sec, fn) => { for (let i = 0; i < sec * 120; i++) { fn && fn(); const ev = bus.step(dt, { steer: bus.steer, throttle: 0, brake: 1 }, collide, mat); m.update(dt, bus, ev, world, t); t += dt; } };
const log = [];
m.say = ((orig) => function (txt, kind, d) { log.push(`[${t.toFixed(0)}s] ${txt}`); return orig.call(this, txt, kind, d); })(m.say);

// attendre l'heure de départ, embarquer
run(2);
bus.doorOpen = true; run(14);
bus.doorOpen = false; run(3);
run(Math.max(0, m.schedule[0] - m.time));
bus.blink = -1;
// suivre la trajectoire planifiée ; à chaque arrêt, se positionner à quai
let ti = 0;
for (let k = 1; k < line.stops.length && !m.finished; k++) {
  const S = line.stops[k];
  // avance jusqu'à ~25 m de l'arrêt en rejouant la trace (≈ 18 km/h)
  while (ti < plan.trace.length - 1 && plan.trace[ti].s < S.s - T.wb - 25) {
    const n = plan.trace[ti++];
    const old = { x: bus.x, y: bus.y };
    bus.x = n.x; bus.y = n.y; bus.th = n.th; bus.th2 = n.th2; bus.v = 5; bus.updateGeo();
    const stepT = Math.hypot(n.x - old.x, n.y - old.y) / 5;
    m.update(Math.max(stepT, 1e-3), bus, ev0, world, t); t += stepT;
    if (bus.blink && bus.kmh > 7) bus.blink = 0;
  }
  // accostage parfait
  const p = world.dockPose(S.st, T);
  bus.x = p.x; bus.y = p.y; bus.th = p.th; bus.th2 = p.th; bus.v = 0; bus.updateGeo();
  m.update(1, bus, ev0, world, t); t += 1;
  const need = m.waiting[k] > 0 || m.onboard.some((d) => d === k) || k === line.stops.length - 1;
  if (need) {
    bus.doorOpen = true; run(16);
    bus.doorOpen = false; run(3);
  }
  bus.blink = -1;
  // repartir : se recaler sur la trace après l'arrêt
  while (ti < plan.trace.length - 1 && plan.trace[ti].s < S.s + 2) ti++;
}
const r = m.results();
console.log(log.join('\n'));
console.log(`\nLigne ${line.id} (${T.label}) terminée : ${m.finished} · voyageurs à bord ${m.onboard.length} · score ${r.total} ★${r.stars}`, r);
console.log('pénalités', { ...m.sc, punct: m.sc.punct.map((v) => Math.round(v)), dock: m.sc.dock.map((v) => Math.round(v)) });
