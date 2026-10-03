// Naval miniatures use shaped hulls and separate mounts while keeping one draw per moving part.
// Coordinates match the unit renderer: +x forward, +y up, +z starboard.
import * as THREE from 'three';
import * as G from './geom.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const cache = new Map();
function parts() {
  const list = [];
  return {
    add(geo, color, x = 0, y = 0, z = 0, mat = 'armor-paint', rx = 0, ry = 0, rz = 0) {
      list.push({ geo, color, mat, matrix: G.xf(x, y, z, rx, ry, rz) });
    },
    box(color, w, h, d, x, y, z, mat = 'armor-paint') {
      list.push({ geo: BOX, color, mat, matrix: G.xf(x, y, z, 0, 0, 0, w, h, d) });
    },
    rod(color, r, a, b, mat = 'gunmetal') {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), dir = end.clone().sub(start);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      list.push({ geo: CYL, color, mat, matrix: new THREE.Matrix4().compose(start.add(end).multiplyScalar(0.5), q, new THREE.Vector3(r, dir.length(), r)) });
    },
    finish() { return G.merge(list); },
  };
}

// A chine above a narrower keel gives the hull a clean sheer and a pointed stem.
function shell(p, stations, keel, deck, color, deckColor) {
  p.add(G.loft(stations.map(([x, half, rise = 0]) => ({ x, pts: [[half, deck + rise], [-half, deck + rise], [-half * 0.78, keel + 0.25], [0, keel], [half * 0.78, keel + 0.25]] })), { normals: 28 }), color);
  p.add(G.loft(stations.map(([x, half, rise = 0]) => ({ x, pts: [[half * 0.99, deck + rise + 0.035], [-half * 0.99, deck + rise + 0.035], [-half * 0.99, deck + rise - 0.025], [half * 0.99, deck + rise - 0.025]] })), { normals: 'flat' }), deckColor);
}
function bollard(p, x, y, z, s = 1) {
  p.box(0x484f50, 0.65 * s, 0.08 * s, 0.3 * s, x, y, z);
  for (const dx of [-0.2, 0.2]) p.rod(0x646a68, 0.07 * s, [x + dx * s, y, z], [x + dx * s, y + 0.25 * s, z]);
}
function rail(p, stations, deck, height, radius) {
  for (const side of [-1, 1]) {
    const path = stations.map(([x, half, rise = 0]) => [x, deck + rise + height, side * half * 0.94]);
    for (let i = 1; i < path.length; i++) p.rod(0x8b9290, radius, path[i - 1], path[i]);
    for (const [x, y, z] of path) p.rod(0x707775, radius, [x, y - height, z], [x, y, z]);
  }
}
function cabin(p, color, x, y, w, h, d) {
  p.add(G.chamferBox(w, h, d, Math.min(0.18, h * 0.1)), color, x, y, 0);
  p.box(0x929994, w + 0.18, 0.12, d + 0.15, x, y + h / 2, 0);
  for (const side of [-1, 1]) for (const dx of [-0.28, 0.28]) {
    p.box(0x25363c, w * 0.34, h * 0.28, 0.025, x + dx * w, y + h * 0.18, side * (d / 2 + 0.012), 'plain');
  }
  for (const z of [-0.28, 0.28]) p.box(0x25363c, 0.025, h * 0.28, d * 0.36, x + w / 2 + 0.012, y + h * 0.18, z * d, 'plain');
}

function landing(f) {
  const p = parts(), color = f.vehicle;
  p.box(0x444b44, 10, 0.38, 3, 0, 0.1, 0);
  // The open well, with ribs, side benches and a raised ribbed bow ramp.
  for (const side of [-1, 1]) {
    p.box(color, 10, 1.3, 0.14, 0, 0.9, side * 1.45);
    p.box(0x92917a, 8.6, 0.12, 0.2, -0.5, 1.58, side * 1.44);
    p.box(0x75694e, 5.7, 0.12, 0.42, -0.2, 0.75, side * 1.1, 'wood');
    for (const x of [-3, -1, 1, 3]) p.box(0x525b46, 0.09, 1.15, 0.08, x, 0.93, side * 1.32);
    p.rod(0x474b44, 0.035, [-2, 1.7, side * 1.4], [5, 1.7, side * 1.4]);
  }
  p.box(color, 0.14, 1.3, 3, -5, 0.9, 0);
  p.box(color, 0.2, 1.6, 3, 5.05, 1, 0);
  for (const z of [-1.2, -0.6, 0, 0.6, 1.2]) p.box(0x7c8265, 0.06, 1.45, 0.07, 5.18, 1, z);
  for (const x of [-2, -1, 0, 1, 2, 3]) p.box(0x68705b, 0.09, 0.05, 2.45, x, 0.31, 0);
  p.add(G.chamferBox(1.4, 0.9, 1.3, 0.1), color, -4.1, 1.7, 0.6);
  p.box(0x263435, 0.025, 0.26, 0.7, -3.38, 1.9, 0.6, 'plain');
  p.box(f.color, 0.04, 0.34, 0.58, -4.82, 1.8, 0.6, 'plain');
  for (const z of [-0.8, 0.8]) {
    p.rod(0x2d302b, 0.08, [-4.3, 1.5, z], [-4.3, 2.2, z]);
    p.add(G.barrel(1.2, 0.045, { segments: 8 }), 0x333731, -4.9, 2.2, z, 'gunmetal');
  }
  for (const z of [-1.13, 1.13]) bollard(p, -4.6, 1.62, z, 0.7);
  return { hull: p.finish() };
}
function patrol(f, fac) {
  const p = parts(), grey = [0x697676, 0x747c7d, 0x5c6c60, 0x727b7b][fac];
  const stations = [[-11, 1.95], [-8, 2.5], [0, 2.7], [6, 2.25, 0.08], [9.3, 1.25, 0.25], [11.4, 0.04, 0.45]];
  shell(p, stations, -0.4, 1.4, grey, 0x555f57);
  cabin(p, grey, 1.4, 2.25, 3.8, 1.65, 2.7);
  p.add(G.chamferBox(3.9, 0.55, 2.6, 0.12), grey, -2.6, 1.74, 0);
  // Slatted engine covers and raised hatch coamings remain readable from above.
  for (const x of [-3.8, -3.2, -2.6, -2, -1.4]) p.box(0x2b3938, 0.22, 0.045, 1.85, x, 2.035, 0, 'gunmetal');
  for (const side of [-1, 1]) {
    p.add(G.lathe([[0, 0], [0.28, 0], [0.33, 0.12], [0.33, 5.6], [0.22, 5.9], [0, 6]], 10, { axis: 'x' }), 0x777d73, -0.9, 1.94, side * 2.08, 'gunmetal');
    for (const x of [0, 3.6]) p.box(grey, 0.25, 0.45, 0.72, x, 1.7, side * 2.08);
    bollard(p, -9.8, 1.45, side * 1.6);
    bollard(p, 7, 1.6, side * 1.4);
    p.add(new THREE.TorusGeometry(0.34, 0.09, 5, 12), 0xc7b694, 0, 2.25, side * 1.39, 'canvas');
  }
  rail(p, [stations[2], stations[3], stations[4], stations[5]], 1.4, 0.65, 0.035);
  p.rod(0x535d5c, 0.065, [0.5, 3.1, 0], [0.5, 6.4, 0]);
  p.rod(0x535d5c, 0.045, [0.5, 5.4, -0.85], [0.5, 5.4, 0.85]);
  for (const z of [-0.9, 0.9]) p.rod(0x424d4c, 0.018, [0.5, 6.2, 0], [-3.8, 2.05, z]);
  p.box(f.color, 0.8, 0.46, 0.04, 0.1, 5.6, 0, 'plain');
  const t = parts();
  t.add(G.lathe([[0, 0], [0.7, 0], [0.7, 0.15], [0.28, 0.25], [0.28, 0.75], [0, 0.75]], 12), grey);
  t.add(G.chamferBox(1.2, 0.5, 0.65, 0.06), grey, 0.3, 0.7, 0);
  t.box(grey, 0.12, 0.95, 1.55, 0.65, 0.7, 0);
  t.add(G.barrel(1.9, 0.085, { segments: 10 }), 0x363d3a, 0.7, 0.9, 0, 'gunmetal');
  return { hull: p.finish(), turret: t.finish(), mounts: [[-6, 1.6, 0]], tip: [2.6, 0.9, 0] };
}
function destroyer(f, fac) {
  const p = parts(), grey = [0x6b787e, 0x767e82, 0x65716b, 0x737f82][fac], light = 0x929b99;
  const stations = [[-53, 3.4], [-45, 5], [-25, 5.5], [8, 5.5], [30, 5], [43, 3.2, 0.65], [50, 0.06, 1.15]];
  shell(p, stations, -1.2, 3.8, grey, 0x5b615b);
  p.add(G.chamferBox(20, 4.5, 8, 0.45), grey, 14, 6.2, 0);
  cabin(p, light, 20, 10, 8, 3.5, 7);
  p.box(light, 10, 0.45, 9.4, 19.5, 8.4, 0);
  for (const x of [4, -8]) {
    p.add(G.lathe([[0, 0], [1.8, 0], [1.8, 6.5], [1.95, 6.5], [1.95, 7], [1.5, 7], [1.5, 6.6]], 12), 0x65716f, x, 5, 0);
    p.add(G.lathe([[1.82, 0], [1.82, 0.7]], 12), f.color, x, 10.5, 0, 'plain');
    p.add(new THREE.CircleGeometry(1.5, 12), 0x242c2c, x, 11.6, 0, 'plain', -Math.PI / 2);
  }
  p.add(G.chamferBox(15, 0.25, 7, 0.08), grey, -32, 3.93, 0);
  rail(p, stations, 3.8, 1, 0.075);
  for (const side of [-1, 1]) {
    for (const x of [-47, 35]) bollard(p, x, 4.15, side * 3.1, 1.8);
    for (const x of [-39, -30, -20, -10, 1, 10]) p.add(new THREE.CircleGeometry(0.24, 8), 0x2b3c3e, x, 2.7, side * 5.53, 'plain', 0, side === 1 ? 0 : Math.PI);
    const boat = [[-3.5, 0.02], [-2, 0.8], [2.4, 0.8], [3.4, 0.06]];
    p.add(G.loft(boat.map(([x, z]) => ({ x, pts: [[z, 0.5], [-z, 0.5], [0, -0.4]] }))), 0xb0b09a, -11, 5.2, side * 3.6, 'wood');
    for (const x of [-14, -8]) p.rod(light, 0.11, [x, 4, side * 4.3], [x, 6.4, side * 4.3]);
  }
  for (const x of [-1, -21]) {
    p.box(grey, 4.8, 0.8, 3.5, x, 4.45, 0);
    for (const z of [-1.1, 0, 1.1]) p.rod(0x414e4e, 0.38, [x - 2.3, 5.05, z], [x + 2.3, 5.05, z]);
  }
  p.rod(0x515e5f, 0.2, [15, 8, 0], [15, 26, 0]);
  p.rod(0x515e5f, 0.09, [15, 21, -3], [15, 21, 3]);
  p.rod(0x515e5f, 0.11, [11, 8, -2.8], [15, 19, 0]);
  p.rod(0x515e5f, 0.11, [11, 8, 2.8], [15, 19, 0]);
  p.box(0x4e5959, 0.15, 1.25, 3.6, 15, 24.2, 0, 'gunmetal');
  for (const z of [-1.4, -0.7, 0, 0.7, 1.4]) p.box(light, 0.2, 1.3, 0.07, 15.1, 24.2, z);
  const t = parts();
  t.add(G.lathe([[0, 0], [1.8, 0], [1.8, 0.25], [0, 0.25]], 12), grey);
  t.add(G.chamferBox(5, 2.4, 4, 0.38), light, 0, 1.2, 0);
  t.add(G.barrel(6, 0.18, { segments: 12 }), 0x46504e, 1.5, 1.6, 0, 'gunmetal');
  return { hull: p.finish(), turret: t.finish(), mounts: [[33, 4, 0], [25, 5.2, 0], [-36, 4, 0], [-44, 4, 0]], tip: [7.5, 1.6, 0] };
}

export function navalModel(type, fac, look) {
  const key = `${type}|${fac}|${look.vehicle}|${look.color}`;
  if (!cache.has(key)) cache.set(key, type === 'lcvp' ? landing(look) : type === 'gunboat' ? patrol(look, fac) : destroyer(look, fac));
  return cache.get(key);
}
