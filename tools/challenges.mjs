// Vérifie que chaque défi est faisable (planificateur A*, marge 0 puis 15 cm).
// Pour les manœuvres en marche arrière, on planifie la sortie en marche avant depuis la place :
// la cinématique étant réversible, le trajet inverse existe en marche arrière.
// Usage : node tools/challenges.mjs [id]
import { World } from '../js/world.js';
import { CITY } from '../js/city.js';
import { TRAINING } from '../js/training.js';
import { CHALLENGES } from '../js/challenges.js';
import { VEHICLES, Bus, makeCollider } from '../js/bus.js';
import { Polyline } from '../js/geom.js';
import { challengePath, startPose, poseFromRear, smoothPts } from '../js/challenge.js';
import { checkPath, inflate } from './plan.mjs';

const worlds = { city: new World(CITY), training: new World(TRAINING) };
const only = process.argv[2];
let bad = 0;
for (const def of CHALLENGES) {
  if (only && def.id !== only) continue;
  const world = worlds[def.world];
  world.setLevelObstacles(def.obstacles || []);
  const T = VEHICLES[def.vehicle];
  const collide = makeCollider(world, null);
  let path, pose;
  if (def.target) {
    pose = poseFromRear(T, def.target.x, def.target.y, def.target.th);
    path = new Polyline(smoothPts(def.validate));
  } else {
    path = challengePath(world, def).path;
    pose = startPose(world, def, T);
    // l'arrivée est franchie quand l'avant passe la ligne : inutile d'aller jusqu'au mur du fond
    const end = path.len - (def.finishBack ?? 8) - (T.wb + T.fo) + 3;
    path = new Polyline(path.slice(0, end, 1));
  }
  const sp = startPose(world, def, T);
  const b0 = new Bus(T, sp);
  const startHit = collide(b0);
  const tag = (r) => (r.fails.length ? 'IMPOSSIBLE' : r.curbs ? `trottoir ${r.curbs}` : 'ok');
  const t0 = Date.now();
  const r0 = checkPath(world, path, pose, T, 0);
  const r1 = r0.fails.length ? r0 : checkPath(world, path, { ...pose, x: pose.x, y: pose.y }, T, 0.15);
  if (r0.fails.length || startHit) bad++;
  const len = challengePath(world, def).path?.len ?? path.len;
  console.log(`${def.badge.padEnd(4)} ${def.name.padEnd(28)} ${T.label.padEnd(7)} exact ${tag(r0).padEnd(12)} marge ${tag(r1).padEnd(12)} départ ${startHit ? 'COLLISION ' + startHit.kind : 'libre'} · ${len.toFixed(0)} m · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const f of r0.fails) console.log('     bloqué (exact)', f);
  if (!r0.fails.length) for (const f of r1.fails) console.log('     bloqué (marge)', f);
  world.setLevelObstacles([]);
}
process.exit(bad ? 1 : 0);
