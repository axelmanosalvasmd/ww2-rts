// The local aim is immediate. Translation, hits, health and respawn are authoritative.
export const cameraYaw = yaw => -yaw - Math.PI / 2;
export function lookDelta(yaw, pitch, dx, dy) {
  return { yaw: ((yaw + dx * 0.0025 + Math.PI * 3) % (Math.PI * 2)) - Math.PI, pitch: Math.max(-1.45, Math.min(1.45, pitch - dy * 0.0025)) };
}
export function inputFor(keys, yaw, pitch, fire, seq) {
  return { t: 'fps', seq, forward: +keys.has('KeyW') - +keys.has('KeyS'), strafe: +keys.has('KeyD') - +keys.has('KeyA'), yaw, pitch, fire };
}
