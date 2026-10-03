// World metres and simulation seconds. These helpers have no renderer or game-state dependency.
export const PROJECTILE_PROFILES = Object.freeze({
  small: Object.freeze({ speed: 230, gravity: 0, maxContacts: 2, near: 3.5 }),
  sniper: Object.freeze({ speed: 420, gravity: 0, maxContacts: 2, near: 3.5 }),
  gun: Object.freeze({ speed: 150, gravity: 9.81, maxContacts: 2, near: 3.5 }),
  flame: Object.freeze({ speed: 40, gravity: 0, maxContacts: 1, near: 1.5 }),
  grenade: Object.freeze({ gravity: 25, maxContacts: 1, near: 0 }),
  artillery: Object.freeze({ gravity: 25, maxContacts: 1, near: 0 }),
});
export const CONTACT_MATERIALS = Object.freeze({
  soil: Object.freeze({ name: 'soil', hardness: 0.15, absorption: 0.9, rebound: 0.1 }),
  timber: Object.freeze({ name: 'timber', hardness: 0.3, absorption: 0.8, rebound: 0.2 }),
  stone: Object.freeze({ name: 'stone', hardness: 0.85, absorption: 0.6, rebound: 0.4 }),
  steel: Object.freeze({ name: 'steel', hardness: 1, absorption: 0.55, rebound: 0.45 }),
});
export function projectileProfile(type, weapon) {
  if (weapon.flame) return PROJECTILE_PROFILES.flame;
  if (type === 'sniper') return PROJECTILE_PROFILES.sniper;
  if (weapon.veh >= 20 || weapon.shellTerrain) return PROJECTILE_PROFILES.gun;
  return PROJECTILE_PROFILES.small;
}
export function flightAt(p, time) {
  const t = Math.max(0, time - p.stamp);
  return { x: p.x + p.vx * t, y: p.y + p.vy * t - 0.5 * p.gravity * t * t, z: p.z + p.vz * t };
}
export function velocityAt(p, time) {
  return { x: p.vx, y: p.vy - p.gravity * Math.max(0, time - p.stamp), z: p.vz };
}
export function launchSolution(from, at, speed, gravity = 0, duration) {
  const dx = at.x - from.x, dz = at.z - from.z, d = Math.hypot(dx, dz, at.y - from.y);
  const T = duration ?? Math.max(0.025, d / speed);
  return { x: from.x, y: from.y, z: from.z, vx: dx / T, vy: (at.y - from.y + 0.5 * gravity * T * T) / T, vz: dz / T, gravity, duration: T };
}
// Return the earliest interval inside a box, including a contact normal at its entry face.
export function sweepBox(a, b, box) {
  let lo = 0, hi = 1, normal = { x: 0, y: 1, z: 0 };
  for (const axis of ['x', 'y', 'z']) {
    const d = b[axis] - a[axis], min = box[axis][0], max = box[axis][1];
    if (Math.abs(d) < 1e-12) { if (a[axis] < min || a[axis] > max) return null; continue; }
    let enter = (min - a[axis]) / d, exit = (max - a[axis]) / d;
    const side = d > 0 ? -1 : 1;
    if (enter > exit) [enter, exit] = [exit, enter];
    if (enter > lo) { lo = enter; normal = { x: 0, y: 0, z: 0, [axis]: side }; }
    hi = Math.min(hi, exit);
    if (lo > hi) return null;
  }
  return hi < 0 || lo > 1 ? null : { fraction: Math.max(0, lo), normal };
}
// A moving circle uses relative translation, so crossing a shot between ticks cannot tunnel through it.
export function sweepBody(a, b, before, after, radius, bottom, top) {
  const dx = b.x - a.x - (after.x - before.x), dz = b.z - a.z - (after.z - before.z);
  const ox = a.x - before.x, oz = a.z - before.z, A = dx * dx + dz * dz, B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - radius * radius;
  let lo = 0, hi = 1;
  if (A < 1e-12) { if (C > 0) return null; }
  else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    lo = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A)); hi = Math.min(1, (-B + Math.sqrt(disc)) / (2 * A));
  }
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-12) { if (a.y < bottom || a.y > top) return null; }
  else { const t0 = (bottom - a.y) / dy, t1 = (top - a.y) / dy; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
  if (lo > hi) return null;
  const nx = ox + dx * lo, nz = oz + dz * lo, length = Math.hypot(nx, nz) || 1;
  return { fraction: lo, normal: { x: nx / length, y: 0, z: nz / length } };
}
export function segmentDistance(a, b, at) {
  const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
  const t = d2 ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.z - a.z) * dz) / d2)) : 0;
  return Math.hypot(at.x - a.x - dx * t, at.z - a.z - dz * t);
}
// Visit crossed grid cells exactly. Thin cell surfaces are checked even for rounds traveling several cells per tick.
export function crossedCells(a, b, cell, w, h) {
  const dx = b.x - a.x, dz = b.z - a.z, sx = Math.sign(dx), sz = Math.sign(dz), result = [];
  let x = Math.floor(a.x / cell), z = Math.floor(a.z / cell), enter = 0;
  const txStep = dx ? cell / Math.abs(dx) : Infinity, tzStep = dz ? cell / Math.abs(dz) : Infinity;
  let tx = dx ? ((sx > 0 ? (x + 1) * cell : x * cell) - a.x) / dx : Infinity;
  let tz = dz ? ((sz > 0 ? (z + 1) * cell : z * cell) - a.z) / dz : Infinity;
  for (let n = 0; n < w + h + 4 && enter <= 1; n++) {
    if (x >= 0 && z >= 0 && x < w && z < h) result.push(z * w + x);
    if (Math.min(tx, tz) > 1) break;
    if (Math.abs(tx - tz) < 1e-10) {
      // A corner touch belongs to both adjoining surfaces.
      if (x + sx >= 0 && x + sx < w && z >= 0 && z < h) result.push(z * w + x + sx);
      if (z + sz >= 0 && z + sz < h && x >= 0 && x < w) result.push((z + sz) * w + x);
      enter = tx; x += sx; z += sz; tx += txStep; tz += tzStep;
    } else if (tx < tz) { enter = tx; x += sx; tx += txStep; }
    else { enter = tz; z += sz; tz += tzStep; }
  }
  return result;
}
export function contactResponse(p, velocity, normal, material) {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z), dot = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
  const shallow = speed > 1 && dot < 0 && -dot / speed < 0.28;
  if (p.explosive || !shallow || material.hardness < 0.7 || p.sequence >= p.maxContacts || p.energy < 0.3) return null;
  const retain = Math.max(0.15, Math.min(0.7, 1 - material.absorption)), k = Math.sqrt(retain), rebound = Math.max(0.1, Math.min(1, material.rebound));
  const vx = (velocity.x - (1 + rebound) * dot * normal.x) * k, vy = (velocity.y - (1 + rebound) * dot * normal.y) * k, vz = (velocity.z - (1 + rebound) * dot * normal.z) * k;
  return { energy: p.energy * (vx * vx + vy * vy + vz * vz) / (speed * speed), vx, vy, vz };
}
// Naval hulls retain their long footprint. Rotation is divided into bounded short sweeps.
export function sweepHull(a, b, before, after, radius, length, bottom, top) {
  let turn = (after.rot ?? 0) - (before.rot ?? after.rot ?? 0);
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const pieces = Math.max(1, Math.min(12, Math.ceil(Math.abs(turn) / 0.12)));
  for (let i = 0; i < pieces; i++) {
    const lo = i / pieces, hi = (i + 1) / pieces, angle = (before.rot ?? after.rot ?? 0) + turn * (lo + hi) / 2;
    const cx = Math.cos(angle), cz = Math.sin(angle), rotate = (at, center) => ({ x: (at.x - center.x) * cx + (at.z - center.z) * cz, y: at.y, z: -(at.x - center.x) * cz + (at.z - center.z) * cx });
    const aa = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo, z: a.z + (b.z - a.z) * lo }, bb = { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi, z: a.z + (b.z - a.z) * hi };
    const c0 = { x: before.x + (after.x - before.x) * lo, z: before.z + (after.z - before.z) * lo }, c1 = { x: before.x + (after.x - before.x) * hi, z: before.z + (after.z - before.z) * hi };
    const q0 = rotate(aa, c0), q1 = rotate(bb, c1), box = sweepBox(q0, q1, { x: [-length, length], y: [bottom, top], z: [-radius, radius] });
    let best = box;
    for (const side of [-length, length]) { const hit = sweepBody(q0, q1, { x: side, z: 0 }, { x: side, z: 0 }, radius, bottom, top); if (hit && (!best || hit.fraction < best.fraction)) best = hit; }
    if (best) { const n = best.normal; return { fraction: lo + (hi - lo) * best.fraction, normal: { x: n.x * cx - n.z * cz, y: n.y, z: n.x * cz + n.z * cx } }; }
  }
  return null;
}
