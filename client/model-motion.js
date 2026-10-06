import * as THREE from 'three';

const LAND = new Set(['tank', 'medium', 'tiger', 'churchill', 'tankdestroyer', 'armoredcar', 'halftrack', 'flaktrack', 'rocket', 'truck']);
const SEA = new Set(['lcvp', 'gunboat', 'destroyer']);
const clamp = (x, limit) => Math.max(-limit, Math.min(limit, x));
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Hull response is cosmetic. The root still carries the position, heading and ground rings used by the game.
export function moveModel(v, elapsed) {
  const sea = SEA.has(v.type);
  if (!sea && !LAND.has(v.type)) return;
  const root = v.root, dt = Math.min(0.1, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0));
  let m = v.modelMotion;
  if (!m) {
    const body = v.visualBody = new THREE.Group();
    body.name = 'visual hull motion';
    const parent = v.visualChassis ?? root;
    for (const child of [...parent.children]) if (child !== v.base && child !== v.sel) body.add(child);
    parent.add(body);
    m = v.modelMotion = { x: root.position.x, z: root.position.z, yaw: root.rotation.y, speed: 0, travel: 0, time: 0, hidden: !root.visible };
    return;
  }
  const body = v.visualBody, dx = root.position.x - m.x, dz = root.position.z - m.z;
  const distance = Math.hypot(dx, dz), yaw = root.rotation.y;
  const hidden = !root.visible, jump = hidden || m.hidden || distance > 8;
  const yawStep = angle(yaw - m.yaw);
  m.x = root.position.x; m.z = root.position.z; m.yaw = yaw; m.hidden = hidden;
  if (jump) {
    m.speed = 0; m.travel = 0;
    body.position.y = body.rotation.x = body.rotation.z = 0;
    return;
  }
  if (!dt) return;
  // Signed speed allows the same settling motion when reversing. Large snapshot corrections cannot kick the hull.
  const speed = clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dt, 12);
  const acceleration = clamp((speed - m.speed) / dt, 10), turn = clamp(yawStep / dt, 2);
  m.speed = speed; m.travel += Math.min(distance, dt * 12); m.time += dt;
  const response = 1 - Math.exp(-dt * (sea ? 3.5 : 9));
  let pitch, roll, heave = 0;
  if (sea) {
    const large = v.type === 'destroyer', phase = ((v.id ?? 0) * 0.61803398875 % 1) * Math.PI * 2;
    const wave = m.time * (large ? 0.65 : 1.45) + phase;
    pitch = Math.sin(wave) * (large ? 0.0015 : 0.009) + acceleration * 0.0008;
    roll = Math.sin(wave * 0.73 + 1.1) * (large ? 0.0025 : 0.014) - turn * Math.abs(speed) * 0.001;
    heave = Math.sin(wave * 1.07 + 0.4) * (large ? 0.025 : 0.045);
  } else {
    const moving = Math.min(1, Math.abs(speed) / 1.5), wheel = v.type === 'armoredcar' || v.type === 'halftrack' || v.type === 'rocket';
    pitch = acceleration * (wheel ? 0.002 : 0.0012) + Math.sin(m.travel * 5) * moving * 0.002;
    roll = -turn * Math.abs(speed) * (wheel ? 0.0025 : 0.0012);
  }
  body.rotation.z += (clamp(pitch, sea ? 0.014 : 0.022) - body.rotation.z) * response;
  body.rotation.x += (clamp(roll, sea ? 0.02 : 0.024) - body.rotation.x) * response;
  body.position.y += (heave - body.position.y) * response;
  if (!sea && speed === 0) {
    if (Math.abs(body.rotation.x) < 0.00001) body.rotation.x = 0;
    if (Math.abs(body.rotation.z) < 0.00001) body.rotation.z = 0;
  }
}
