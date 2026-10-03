// A few moving wrecks and sections become static world objects after bounded contact and damping.
export const DEBRIS_LIMITS = Object.freeze({ active: 96, contacts: 8, lifetime: 2.5, maxStep: 0.05 });
export const SECTION_MASS = Object.freeze({ wood: 350, stone: 1200, concrete: 1600, steel: 1800 });
export function wreckMass(type, def) {
  return ({ tiger: 57000, churchill: 40000, medium: 30000, tankdestroyer: 28000, tank: 14000, armoredcar: 7800, halftrack: 9500, flaktrack: 10000, rocket: 11000 }[type] ?? Math.max(5000, (def.radius ?? 2) ** 2 * 2200));
}
export function debrisBody({ id, kind = 'section', x, y, z, dir = 0, impulse = 1, mass = 1000, material = 'stone', radius = 0.7, time = 0 }) {
  const strength = Math.max(0.25, Math.min(4, impulse)), momentum = strength * (kind === 'wreck' ? 16000 : 800);
  const speed = Math.min(kind === 'wreck' ? 2.4 : 3.2, momentum / Math.max(1, mass));
  return { id, kind, x, y, z, vx: Math.cos(dir) * speed, vy: kind === 'wreck' ? 0.15 : 0.4 + strength * 0.15, vz: Math.sin(dir) * speed,
    dir, material, mass, radius, origin: { x, z }, gravity: 9.81, drag: kind === 'wreck' ? 3.2 : 2.2, stamp: time, born: time, contacts: 0, settled: false, tilt: 0 };
}
function reflect(body, normal, material) {
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  normal = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  const dot = body.vx * normal.x + body.vy * normal.y + body.vz * normal.z;
  if (dot >= 0) return;
  const rebound = Math.max(0, Math.min(0.35, material?.rebound ?? 0.1)), absorb = Math.max(0.2, Math.min(0.9, material?.absorption ?? 0.7));
  const factor = 1 + rebound;
  body.vx = (body.vx - factor * dot * normal.x) * (1 - absorb * 0.45);
  body.vy = (body.vy - factor * dot * normal.y) * (1 - absorb * 0.45);
  body.vz = (body.vz - factor * dot * normal.z) * (1 - absorb * 0.45);
}
export function settleDebris(body, env) {
  if (body.settled) return body;
  body.y = env.ground(body.x, body.z); body.vx = body.vy = body.vz = 0; body.settled = true; body.tilt = body.kind === 'section' ? Math.PI / 2 : 0;
  return body;
}
export function stepDebris(body, dt, env) {
  if (body.settled || !(dt > 0)) return body;
  const pieces = Math.max(1, Math.ceil(dt / DEBRIS_LIMITS.maxStep)), step = dt / pieces;
  for (let i = 0; i < pieces && !body.settled; i++) {
    const a = { x: body.x, y: body.y, z: body.z }, b = { x: a.x + body.vx * step, y: a.y + body.vy * step - body.gravity * step * step / 2, z: a.z + body.vz * step };
    const hit = env.contact?.(a, b, body), fraction = hit?.fraction ?? 1;
    body.x = a.x + (b.x - a.x) * fraction; body.y = a.y + (b.y - a.y) * fraction; body.z = a.z + (b.z - a.z) * fraction;
    body.vy -= body.gravity * step * fraction; body.stamp += step;
    if (hit) {
      body.contacts++; reflect(body, hit.normal, hit.material);
      body.x += hit.normal.x * 0.002; body.y += hit.normal.y * 0.002; body.z += hit.normal.z * 0.002;
    }
    const floor = env.ground(body.x, body.z);
    if (body.y <= floor + 0.015) {
      body.y = floor;
      if (body.vy < -0.4) { body.contacts++; reflect(body, { x: 0, y: 1, z: 0 }, env.material?.(body.x, body.z)); }
      else body.vy = 0;
      body.vx *= Math.exp(-body.drag * 2.5 * step); body.vz *= Math.exp(-body.drag * 2.5 * step);
    } else { body.vx *= Math.exp(-body.drag * step); body.vz *= Math.exp(-body.drag * step); }
    const age = body.stamp - body.born, travel = Math.hypot(body.x - body.origin.x, body.z - body.origin.z), limit = body.kind === 'wreck' ? 2 : 4;
    body.tilt = body.kind === 'section' ? Math.min(Math.PI / 2, age * 2.6) : Math.min(0.025, Math.abs(body.vy) * 0.01);
    if (travel >= limit) { body.x = body.origin.x + (body.x - body.origin.x) * limit / travel; body.z = body.origin.z + (body.z - body.origin.z) * limit / travel; }
    if (travel >= limit || age >= DEBRIS_LIMITS.lifetime || body.contacts >= DEBRIS_LIMITS.contacts || body.y <= floor + 0.01 && Math.hypot(body.vx, body.vy, body.vz) < 0.12) settleDebris(body, env);
  }
  return body;
}
export function debrisRow(body) {
  return { id: body.id, kind: body.kind, x: body.x, y: body.y, z: body.z, dir: body.dir, material: body.material, mass: body.mass,
    v: [body.vx, body.vy, body.vz], gravity: body.gravity, drag: body.drag, time: body.stamp, born: body.born, tilt: body.tilt, settled: body.settled };
}
