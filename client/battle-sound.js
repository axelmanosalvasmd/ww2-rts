// Battle sounds that are not tied to a shot: the listener follows the camera, moving vehicles swell a tank engine
// bed, and digging and building squads are heard now and then. main.js calls battleFrame() once per frame.
// Shots, blasts, planes and wrecks sound from client/fx.js, at the moment their effect shows.
import { UNITS } from '/shared/sim.js';
import { audio } from './audio.js';

const isVeh = (type) => UNITS[type] && !UNITS[type].infantry && !UNITS[type].structure && !UNITS[type].air;
const t = () => performance.now() / 1000;
const foley = new Map(), seen = new Map();

// once per frame: the listener follows the camera; a few times a second, engines, digging and building
let tick = 0;
export function battleFrame(cam, units, me) {
  audio.listener(cam.x, cam.z, cam.dist, cam.yaw);
  const now = t();
  if (now - tick < 0.2) return;
  tick = now;
  const engines = [];
  for (const v of units.values()) {
    const prev = seen.get(v.id), moving = prev && Math.hypot(v.x - prev.x, v.z - prev.z) > 0.25;
    seen.set(v.id, { x: v.x, z: v.z });
    if (isVeh(v.type) && moving) engines.push(v);
    const work = v.flags & 16 ? 'dig' : v.flags & 128 ? 'build' : null;
    if (work && !moving && now > (foley.get(v.id) ?? 0)) {
      foley.set(v.id, now + 1.2 + Math.random() * 0.8);
      audio.play(work, v, { gain: v.owner === me ? 1 : 0.7 });
    }
  }
  audio.bed('tank_engine', engines);
  if (seen.size > units.size + 50) for (const id of seen.keys()) if (!units.has(id)) { seen.delete(id); foley.delete(id); }
}
