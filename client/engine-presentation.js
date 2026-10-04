// Presentation reads delivered state only. It never queries a unit or terrain outside that view.
import { isGroundVehicle, movementProfile, bodyRadius } from '../shared/vehicle-motion.js';
import { CELL } from '../shared/sim.js';
import { Vector3, Euler, Quaternion } from 'three';
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const contactPoint = new Vector3();
const contactRotation = new Euler(0, 0, 0, 'ZXY'), contactQuaternion = new Quaternion();
const supportCorners = Array.from({ length: 4 }, () => new Vector3()), supportNormal = new Vector3();
const supportLines = [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [4, 1], [1, 4]];

// A height difference between two planes reaches its maximum at a terrain vertex or a footprint boundary.
// Relief independently subdivides each axis into one, two or four parts. Include all resulting diagonals,
// plus the road's center-fan diagonals, where they intersect the footprint edges.
function terrainSupport(v, body, footprint, groundAt, c, s) {
  const { minX, maxX, minZ, maxZ, y } = footprint;
  const suspension = v.visualBody?.parent === body ? v.visualBody : null;
  const coords = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  for (let i = 0; i < 4; i++) {
    contactPoint.set(coords[i][0], y, coords[i][1]);
    if (suspension) contactPoint.applyQuaternion(suspension.quaternion).add(suspension.position);
    contactPoint.applyQuaternion(contactQuaternion);
    supportCorners[i].set(v.x + c * contactPoint.x - s * contactPoint.z, v.root.position.y + contactPoint.y,
      v.z + s * contactPoint.x + c * contactPoint.z);
  }
  supportNormal.set(0, 1, 0);
  if (suspension) supportNormal.applyQuaternion(suspension.quaternion);
  supportNormal.applyQuaternion(contactQuaternion);
  const nx = c * supportNormal.x - s * supportNormal.z, ny = supportNormal.y, nz = s * supportNormal.x + c * supportNormal.z;
  if (ny < 0.1) return NaN;
  // Raised vertices in the contact band shift sideways when tilted. Cover their projection onto the bottom plane.
  if (footprint.band) {
    const origin = supportCorners[0], ox = origin.x, oy = origin.y, oz = origin.z;
    const ax = supportCorners[1].x - ox, az = supportCorners[1].z - oz;
    const bx = supportCorners[3].x - ox, bz = supportCorners[3].z - oz, determinant = ax * bz - az * bx;
    const du = footprint.band * (nx * bz - nz * bx) / determinant;
    const dw = footprint.band * (ax * nz - az * nx) / determinant;
    const u0 = Math.min(0, du), u1 = 1 + Math.max(0, du), w0 = Math.min(0, dw), w1 = 1 + Math.max(0, dw);
    const uv = [[u0, w0], [u1, w0], [u1, w1], [u0, w1]];
    for (let i = 0; i < 4; i++) {
      const x = ox + ax * uv[i][0] + bx * uv[i][1], z = oz + az * uv[i][0] + bz * uv[i][1];
      supportCorners[i].set(x, oy - (nx * (x - ox) + nz * (z - oz)) / ny, z);
    }
  }
  const origin = supportCorners[0], a = supportCorners[1], b = supportCorners[3];
  const ax = a.x - origin.x, az = a.z - origin.z, bx = b.x - origin.x, bz = b.z - origin.z;
  const determinant = ax * bz - az * bx;
  if (Math.abs(determinant) < 1e-6) return NaN;
  let support = -Infinity;
  const sample = (x, z) => {
    const plane = origin.y - (nx * (x - origin.x) + nz * (z - origin.z)) / ny;
    support = Math.max(support, groundAt(x, z) - plane);
  };
  for (const corner of supportCorners) sample(corner.x, corner.z);
  const spacing = CELL / 4;
  const x0 = Math.ceil(Math.min(...supportCorners.map(p => p.x)) / spacing), x1 = Math.floor(Math.max(...supportCorners.map(p => p.x)) / spacing);
  const z0 = Math.ceil(Math.min(...supportCorners.map(p => p.z)) / spacing), z1 = Math.floor(Math.max(...supportCorners.map(p => p.z)) / spacing);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const x = ix * spacing, z = iz * spacing, dx = x - origin.x, dz = z - origin.z;
    const u = (dx * bz - dz * bx) / determinant, w = (ax * dz - az * dx) / determinant;
    if (u >= 0 && u <= 1 && w >= 0 && w <= 1) sample(x, z);
  }
  for (let i = 0; i < 4; i++) {
    const from = supportCorners[i], to = supportCorners[(i + 1) % 4];
    for (const [lx, lz] of supportLines) {
      const start = lx * from.x + lz * from.z;
      const end = lx * to.x + lz * to.z;
      if (Math.abs(end - start) < 1e-8) continue;
      for (let k = Math.ceil(Math.min(start, end) / spacing); k <= Math.floor(Math.max(start, end) / spacing); k++) {
        const t = (k * spacing - start) / (end - start);
        sample(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
      }
    }
  }
  return support;
}

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
  const pose = v.terrainPose ??= { pitch: 0, roll: 0, suspended: true, x: v.x, z: v.z };
  if (!detailed || !v.root.visible) { pose.suspended = true; return; }
  const profile = movementProfile(v.type, def), long = clamp(bodyRadius(def), 0.5, 8), wide = clamp((def.radius ?? 1) * 0.48, 0.3, 5);
  const footprint = v.groundContact ?? { minX: -long, maxX: long, minZ: -wide, maxZ: wide, y: 0 };
  const { minX, maxX, minZ, maxZ, y } = footprint;
  const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  const c = Math.cos(v.rot ?? 0), s = Math.sin(v.rot ?? 0), x = v.x, z = v.z;
  const height = (px, pz) => groundAt(x + c * px - s * pz, z + s * px + c * pz);
  const front = height(maxX, midZ), rear = height(minX, midZ);
  const right = height(midX, maxZ), left = height(midX, minZ);
  if (![front, rear, right, left].every(Number.isFinite)) { pose.suspended = true; return; }
  // ZXY keeps the hull's horizontal heading while its up axis matches a compound slope.
  // Legal one-level ramps rise 2.5 m per 2 m cell. Bound cliff samples without flattening those ramps.
  const limit = Math.PI / 3;
  const pitch = clamp(Math.atan2(front - rear, maxX - minX), -limit, limit);
  const roll = clamp(-Math.atan((right - left) / (maxZ - minZ) * Math.cos(pitch)), -limit, limit);
  const returned = pose.suspended || Math.hypot(x - pose.x, z - pose.z) > 8;
  const elapsed = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
  const blend = returned ? 1 : 1 - Math.exp(-elapsed * (profile.tracked ? 12 : 16));
  const nextPitch = pose.pitch + (pitch - pose.pitch) * blend;
  const nextRoll = pose.roll + (roll - pose.roll) * blend;
  contactQuaternion.setFromEuler(contactRotation.set(nextRoll, 0, nextPitch, 'ZXY'));
  // A rigid hull bridges dips. Lift it above the highest support, including its small suspension response.
  const support = terrainSupport(v, body, footprint, groundAt, c, s);
  if (!Number.isFinite(support)) { pose.suspended = true; return; }
  pose.pitch = nextPitch; pose.roll = nextRoll;
  body.rotation.set(pose.roll, 0, pose.pitch, 'ZXY');
  body.position.y = returned || support > body.position.y ? support : body.position.y + (support - body.position.y) * blend;
  pose.suspended = false; pose.x = x; pose.z = z;
}
