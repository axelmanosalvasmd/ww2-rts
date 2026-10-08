// The local aim is immediate. Translation, hits, health and respawn are authoritative; the client predicts its own
// movement with the server's numbers (shared/sim.js OPERATIVE) and eases into the server's answer.
import { OPERATIVE as O } from '../shared/sim.js';

export const cameraYaw = yaw => -yaw - Math.PI / 2;
export function lookDelta(yaw, pitch, dx, dy, scale = 1) {
  const k = 0.0025 * scale;
  return { yaw: ((yaw + dx * k + Math.PI * 3) % (Math.PI * 2)) - Math.PI, pitch: Math.max(-1.45, Math.min(1.45, pitch - dy * k)) };
}
// extra: sprint, crouch, ads, weapon and the jump/reload/nade press counts
export function inputFor(keys, yaw, pitch, fire, seq, extra = {}) {
  return { t: 'fps', seq, forward: +keys.has('KeyW') - +keys.has('KeyS'), strafe: +keys.has('KeyD') - +keys.has('KeyA'), yaw, pitch, fire, ...extra };
}
// One step of the server's movement (stepOperative) for prediction. Walls are the server's business: it pulls back.
export function predictStep(p, input, dt) {
  const grounded = p.jy <= 0 && p.vy <= 0;
  if (input.jump && grounded) { p.vy = O.jump; p.crouch = false; }
  else p.crouch = !!input.crouch && (grounded || p.crouch);
  if (p.jy > 0 || p.vy > 0) { p.vy -= O.gravity * dt; p.jy = Math.max(0, p.jy + p.vy * dt); if (!p.jy) { p.vy = 0; p.landed = true; } }
  const f = input.forward, s = input.strafe, sprint = input.sprint && f > 0 && !input.ads && !p.crouch;
  const cap = sprint ? O.sprint : p.crouch ? O.crouch : input.ads ? O.ads : O.walk;
  const len = Math.max(1, Math.hypot(f, s)), c = Math.cos(input.yaw), n = Math.sin(input.yaw);
  const tx = (c * f - n * s) / len * cap, tz = (n * f + c * s) / len * cap;
  const step = (grounded ? O.accel : O.airAccel) * dt, ddx = tx - p.vx, ddz = tz - p.vz, dl = Math.hypot(ddx, ddz);
  if (dl <= step) { p.vx = tx; p.vz = tz; } else { p.vx += ddx / dl * step; p.vz += ddz / dl * step; }
  p.x += p.vx * dt; p.z += p.vz * dt;
  p.sprint = sprint;
  return p;
}
