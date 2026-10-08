// Visual followers only. The server's squad center remains the sole gameplay and selection position.
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const seedOf = (id, i) => ((Math.imul((id ?? 0) + 1, 1664525) + Math.imul(i + 1, 1013904223)) >>> 0) / 4294967296;

export function gaitWeights(phase, blend, count, output, offset = 0) {
  const weights = output ?? new Array(Math.max(0, count)).fill(0);
  if (!count || !blend) return weights;
  const frame = ((phase % 1) + 1) % 1 * count, first = Math.floor(frame), fraction = frame - first;
  // Ease each morph into the next pose so arms and boots do not change velocity abruptly at a frame boundary.
  const t = fraction * fraction * (3 - 2 * fraction);
  weights[offset + first] = (1 - t) * blend; weights[offset + (first + 1) % count] += t * blend;
  return weights;
}

export function moveSquad(v, elapsed) {
  const sq = v.squad, root = v.root, dt = Math.min(0.1, Math.max(0, elapsed));
  const x = root.position.x, z = root.position.z, yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
  const hidden = !root.visible || v.garr;
  const jump = sq.lastX === undefined || Math.hypot(x - sq.lastX, z - sq.lastZ) > 8 || hidden || sq.hidden || (sq.trenched && !v.trench);
  const speed = jump || !dt ? 0 : Math.hypot(x - sq.lastX, z - sq.lastZ) / dt;
  sq.lastX = x; sq.lastZ = z; sq.hidden = hidden; sq.trenched = !!v.trench;
  sq.speed = speed;
  for (const man of v.models) {
    const u = man.userData, sx = u.slot[0], sz = u.slot[1], seed = u.motion?.seed ?? seedOf(v.id, u.index);
    const targetX = x + sx * c + sz * s, targetZ = z + sz * c - sx * s;
    const m = u.motion ??= { x: targetX, z: targetZ, yaw, phase: seed, seed, blend: 0, speed: 0 };
    m.startX = m.x; m.startZ = m.z;
    if (jump || !man.visible || v.trench) {
      m.x = targetX; m.z = targetZ; m.yaw = yaw; m.speed = m.blend = 0;
    } else if (dt) {
      // Unequal response times loosen the ranks on a turn. No oscillating slot noise or idle foot shuffling.
      // a man stepping into a fallen man's place (u.refill, client/main.js) walks over to it while the squad stands
      if (u.refill && Math.hypot(targetX - m.x, targetZ - m.z) <= 0.3) u.refill = false;
      if (speed > 0.025 || u.refill) {
        const response = 1 - Math.exp(-dt * (7 + seed * 4));
        const dx = (targetX - m.x) * response, dz = (targetZ - m.z) * response;
        const travel = Math.hypot(dx, dz), limit = dt * (speed + 1.2), step = travel > limit ? limit / travel : 1;
        m.x += dx * step; m.z += dz * step;
        const radius = Math.hypot(m.x - x, m.z - z), extent = Math.hypot(sx, sz) + 0.65;
        if (radius > extent) { m.x = x + (m.x - x) * extent / radius; m.z = z + (m.z - z) * extent / radius; }
      }
    }
  }
  // Keep shoulders apart when followers take different arcs through a corner. Only rendered living men participate.
  if (speed > 0.025 && !jump && !v.trench) for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < v.models.length; i++) {
      if (!v.models[i].visible) continue;
      const a = v.models[i].userData.motion;
      for (let j = 0; j < i; j++) {
        if (!v.models[j].visible) continue;
        const b = v.models[j].userData.motion, dx = a.x - b.x, dz = a.z - b.z, distance = Math.hypot(dx, dz);
        if (distance >= 0.5 || distance < 0.0001) continue;
        const push = (0.5 - distance) / (2 * distance);
        a.x += dx * push; a.z += dz * push; b.x -= dx * push; b.z -= dz * push;
      }
    }
  }
  for (const man of v.models) {
    const u = man.userData, m = u.motion, seed = m.seed;
    if (!jump && man.visible && !v.trench && dt) {
      m.speed = Math.hypot(m.x - m.startX, m.z - m.startZ) / dt;
      const walk = m.speed > 0.045, firing = sq.moveFire && v.tgt && !(v.flags & 1) && Number.isFinite(v.aim);
      const facing = firing ? -v.aim : walk ? Math.atan2(-(m.z - m.startZ), m.x - m.startX) : yaw;
      m.yaw += Math.max(-dt * (3 + seed), Math.min(dt * (3 + seed), angle(facing - m.yaw)));
      const blendGoal = walk ? Math.min(1, m.speed / 0.7) : 0;
      m.blend += (blendGoal - m.blend) * (1 - Math.exp(-dt * 14));
      if (m.blend < 0.002) m.blend = 0;
      // A full cycle travels two steps. Phase follows actual travel, including each man's different turn arc.
      const stride = v.flags & 1 ? 1.24 : v.supp >= 90 && v.cover !== 2 ? 0.48 : v.supp >= 50 ? 0.76 : 1.24;
      m.stride ??= stride;
      m.stride += (stride - m.stride) * (1 - Math.exp(-dt * 8));
      if (walk) m.phase = (m.phase + m.speed * dt / (m.stride * man.scale.x) * (0.96 + seed * 0.08)) % 1;
    }
    const dx = m.x - x, dz = m.z - z;
    m.localX = dx * c - dz * s; m.localZ = dx * s + dz * c;
    m.localYaw = angle(m.yaw - yaw);
  }
}
