// Presentation reads delivered state only. It never queries a unit or terrain outside that view.
import { isGroundVehicle, movementProfile, bodyRadius } from '../shared/vehicle-motion.js';
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));

export function vehicleDamageFrame(v, dt, detailed, emit) {
  const cue = v.damageCue ??= { stage: 0, level: 0, wait: 0 };
  const health = v.hp / v.maxHealth;
  if (!Number.isFinite(health) || health <= 0 || v.killed) {
    cue.stage = cue.level = cue.wait = 0;
    return;
  }
  if (cue.stage === 2 && health > 0.38) cue.stage = health > 0.71 ? 0 : 1;
  if (cue.stage === 1 && health > 0.71) cue.stage = 0;
  if (health <= 0.32) cue.stage = 2;
  else if (health <= 0.65 && cue.stage === 0) cue.stage = 1;
  const step = Math.min(0.1, Math.max(0, dt));
  cue.level += (cue.stage - cue.level) * (1 - Math.exp(-step * (cue.stage > cue.level ? 3 : 1.5)));
  if (cue.level < 0.03 && !cue.stage) cue.level = 0;
  // Never save emission debt while hidden or off screen. Return shows current damage, without old impacts.
  if (!detailed || !v.root.visible || !cue.level) { cue.wait = 0; return; }
  cue.wait -= step;
  if (cue.wait <= 0) {
    emit(v, cue.level);
    cue.wait = cue.level > 1.2 ? 0.28 : 0.55;
  }
}

// At most eight nearby cells per terrain layer contribute to two positional loops. Weather is public.
export function environmentalMix({ grid, groundGrid, objectGrid, cell = 4, known, camera, weather = 'clear', wx = [] }) {
  const result = { water: { gain: 0, pan: 0 }, woodland: { gain: 0, pan: 0 }, wind: { gain: 0.07, pan: 0 }, rain: { gain: 0, pan: 0 } };
  const rain = weather === 'snow' ? 0 : clamp(wx[0] ?? (weather === 'rain' ? 1 : 0));
  result.rain.gain = rain * 0.2;
  result.wind.gain = 0.055 + Math.min(0.04, Math.hypot(wx[2] ?? 0, wx[3] ?? 0) * 0.004);
  if (!grid?.length || !camera) return result;
  const range = 56, radius = Math.ceil(range / cell), cx = Math.floor(camera.x / cell), cz = Math.floor(camera.z / cell);
  const sources = { water: [], woodland: [] };
  for (let z = Math.max(0, cz - radius); z <= Math.min(grid.length - 1, cz + radius); z++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(grid[z].length - 1, cx + radius); x++) {
      const px = (x + 0.5) * cell, pz = (z + 0.5) * cell;
      if (known && !known(px, pz)) continue;
      const ground = groundGrid?.[z]?.[x] ?? grid[z][x], object = objectGrid?.[z]?.[x] ?? grid[z][x];
      const kind = 'WF='.includes(ground) || object === '=' ? 'water' : object === 'O' ? 'woodland' : null;
      if (!kind) continue;
      const dx = px - camera.x, dz = pz - camera.z, d = Math.hypot(dx, dz);
      if (d >= range) continue;
      const weight = (1 - d / range) ** 2;
      const side = dx * Math.cos(camera.yaw ?? 0) - dz * Math.sin(camera.yaw ?? 0);
      const list = sources[kind];
      list.push({ weight, pan: clamp(side / (d + 20), -1, 1) * 0.8 });
      list.sort((a, b) => b.weight - a.weight);
      if (list.length > 8) list.pop();
    }
  }
  const zoom = 1 - 0.35 * clamp(((camera.dist ?? 85) - 25) / 125);
  for (const kind of ['water', 'woodland']) {
    const points = sources[kind], sum = points.reduce((s, p) => s + p.weight, 0);
    result[kind].gain = Math.min(1, sum / 3) * zoom * (kind === 'water' ? 0.14 : 0.095);
    result[kind].pan = sum ? points.reduce((s, p) => s + p.pan * p.weight, 0) / sum : 0;
  }
  return result;
}


// Tilt only the visual chassis. The simulation hull, selection rings and billboard bars stay at their current transforms.
export function vehicleTerrainPose(v, dt, detailed, groundAt, body, def) {
  if (!body || !isGroundVehicle(def)) return;
  const pose = v.terrainPose ??= { pitch: 0, roll: 0, suspended: true };
  if (!detailed || !v.root.visible) { pose.suspended = true; return; }
  const profile = movementProfile(v.type, def), long = clamp(bodyRadius(def), 0.5, 8), wide = clamp((def.radius ?? 1) * 0.48, 0.3, 5);
  const c = Math.cos(v.rot ?? 0), s = Math.sin(v.rot ?? 0), x = v.x, z = v.z;
  const front = groundAt(x + c * long, z + s * long), rear = groundAt(x - c * long, z - s * long);
  const right = groundAt(x - s * wide, z + c * wide), left = groundAt(x + s * wide, z - c * wide);
  if (![front, rear, right, left].every(Number.isFinite)) return;
  const maxPitch = profile.tracked ? 0.16 : 0.2, maxRoll = profile.tracked ? 0.12 : 0.16;
  const pitch = clamp(Math.atan2(front - rear, 2 * long), -maxPitch, maxPitch);
  const roll = clamp(-Math.atan2(right - left, 2 * wide), -maxRoll, maxRoll);
  const blend = pose.suspended ? 1 : 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * (profile.tracked ? 5 : 8));
  pose.pitch += (pitch - pose.pitch) * blend;
  pose.roll += (roll - pose.roll) * blend;
  pose.suspended = false;
  body.rotation.z = pose.pitch;
  body.rotation.x = pose.roll;
}
