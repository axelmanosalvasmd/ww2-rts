import { CHALK, clickRing } from './markers.js';
import { audio } from './audio.js';
import { alerts } from './alerts.js';

const LIFE = 4, FADE = 0.6, PERIOD = 1.2;
const COLOR = '#' + CHALK.toString(16).padStart(6, '0');
const now = () => performance.now() / 1000;
let hooks = null;
const rings = [];

function init(h) {
  reset();
  hooks = h;
}

function send(x, z) {
  if (!hooks || !Number.isFinite(x) || !Number.isFinite(z)) return;
  hooks.send({ t: 'ping', x, z });
}

function receive(m) {
  if (!hooks || !Number.isInteger(m.from) || m.from < 0 || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
  const mesh = clickRing(CHALK), born = now();
  mesh.position.set(m.x, hooks.hAt(m.x, m.z) + 0.2, m.z);
  mesh.scale.setScalar(2);
  hooks.scene.add(mesh);
  rings.push({ x: m.x, z: m.z, born, mesh });
  audio.ui('click');
  alerts.push('ping', m.x, m.z, `Ping from ${hooks.playerName?.(m.from) ?? 'An ally'}`);
}

function remove(a) {
  a.mesh.removeFromParent();
  // clickRing owns its material; its geometry and pencil texture are shared.
  a.mesh.material.dispose();
}

function reset() {
  rings.forEach(remove);
  rings.length = 0;
}

function frame() {
  const t = now();
  for (let i = rings.length - 1; i >= 0; i--) {
    const a = rings[i], age = t - a.born;
    if (age >= LIFE) { remove(a); rings.splice(i, 1); continue; }
    const phase = (age % PERIOD) / PERIOD, fade = Math.min(1, (LIFE - age) / FADE);
    a.mesh.position.y = hooks.hAt(a.x, a.z) + 0.2;
    a.mesh.scale.setScalar(2 + phase * 6);
    a.mesh.material.opacity = fade * (1 - phase) * 0.9;
  }
}

function drawMinimap(c, S) {
  if (!rings.length) return;
  const t = now();
  c.save();
  for (const a of rings) {
    const age = t - a.born;
    if (age >= LIFE) continue;
    const phase = (age % PERIOD) / PERIOD, fade = Math.min(1, (LIFE - age) / FADE);
    c.globalAlpha = fade * (1 - phase);
    c.beginPath();
    const r = (4 + phase * 14) / S;
    // Hold the uneven pencil stroke still while the ring grows.
    for (let i = 0; i <= 40; i++) {
      const angle = i / 40 * (Math.PI * 2 + 0.2), radius = r * (1 + 0.025 * Math.sin(3 * angle + 1.1));
      const x = a.x + Math.cos(angle) * radius, z = a.z + Math.sin(angle) * radius;
      if (i === 0) c.moveTo(x, z); else c.lineTo(x, z);
    }
    c.strokeStyle = '#15160f'; c.lineWidth = 4 / S; c.stroke();
    c.strokeStyle = COLOR; c.lineWidth = 2 / S; c.stroke();
  }
  c.restore();
}

const active = () => rings.some(a => now() - a.born < LIFE);
export const pings = { init, send, receive, reset, frame, drawMinimap, active };
