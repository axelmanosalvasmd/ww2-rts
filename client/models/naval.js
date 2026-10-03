// Historical naval silhouettes with curved hull stations, recessed decks and separate traversing guns.
// +x is forward, +y is up and +z is starboard. Gun origins and effect tips match the renderer contract.
import * as THREE from 'three';
import * as G from './geom.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const cache = new Map();
const roundedBox = (w, h, d, c) => G.chamferBox(w, h, d, Math.min(c, w * 0.45, h * 0.45, d * 0.45));
const STEEL = 0x4e595b, DARK = 0x263136, GLASS = 0x263f49;
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
    finish(waterline) {
      const geo = G.merge(list);
      if (waterline === undefined) return geo;
      const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color, M = geo.attributes.matId;
      for (let i = 0; i < P.count; i++) {
        if (G.baseMat(M.getX(i)) !== G.matId('armor-paint')) continue;
        const y = P.getY(i), side = 1 - Math.abs(N.getY(i));
        const wet = Math.exp(-(((y - waterline) / 0.42) ** 2)) * 0.095;
        const low = Math.max(0, Math.min(1, (waterline - y) / 1.2)) * 0.07;
        const seams = (Math.sin(P.getX(i) * 0.82) * 0.5 + 0.5) ** 12 * 0.025;
        const shade = 1 - side * (wet + low + seams);
        C.setXYZ(i, C.getX(i) * shade, C.getY(i) * shade, C.getZ(i) * shade);
      }
      return geo;
    },
  };
}

// Shape-preserving cubic interpolation avoids broad straight wedges and keeps the original footprint.
function stations(knots, steps = 5) {
  const out = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1], previous = knots[Math.max(0, i - 1)], next = knots[Math.min(knots.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t, x = a[0] + (b[0] - a[0]) * t;
      const row = [x];
      for (let j = 1; j < a.length; j++) {
        const delta = b[j] - a[j], before = a[j] - previous[j], after = next[j] - b[j];
        const m0 = before * delta <= 0 ? 0 : Math.sign(delta) * Math.min(Math.abs(before), Math.abs(delta));
        const m1 = after * delta <= 0 ? 0 : Math.sign(delta) * Math.min(Math.abs(after), Math.abs(delta));
        row.push((2 * t3 - 3 * t2 + 1) * a[j] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[j] + (t3 - t2) * m1);
      }
      out.push(row);
    }
  }
  out.push(knots.at(-1));
  return out;
}
function hull(p, rows, color, deckColor, camber = 0.08, round = false) {
  const sections = rows.map(([x, w, d, k]) => {
    const top = [[w, d], [w * 0.7, d + camber * 0.65], [w * 0.35, d + camber * 0.92], [0, d + camber], [-w * 0.35, d + camber * 0.92], [-w * 0.7, d + camber * 0.65], [-w, d]];
    const side = round
      ? [[-w * 0.995, d - 0.45], [-w * 0.96, k + (d - k) * 0.42], [-w * 0.86, k + (d - k) * 0.24], [-w * 0.68, k + (d - k) * 0.10], [-w * 0.38, k + (d - k) * 0.025], [0, k]]
      : [[-w * 0.93, d - (d - k) * 0.56], [-w * 0.78, k + (d - k) * 0.23], [-w * 0.48, k + (d - k) * 0.10], [0, k]];
    const mirror = side.slice(0, -1).reverse().map(([z, y]) => [-z, y]);
    return { x, pts: [...top, ...side, ...mirror] };
  });
  p.add(G.loft(sections, { normals: round ? 65 : 34 }), color);
  const deck = rows.map(([x, w, d]) => ({ x, pts: [[w * 0.985, d + 0.018], [w * 0.7, d + camber * 0.65 + 0.02], [w * 0.35, d + camber * 0.92 + 0.02], [0, d + camber + 0.02], [-w * 0.35, d + camber * 0.92 + 0.02], [-w * 0.7, d + camber * 0.65 + 0.02], [-w * 0.985, d + 0.018], [-w * 0.985, d - 0.06], [w * 0.985, d - 0.06]] }));
  p.add(G.loft(deck, { normals: 30 }), deckColor);
}
function curvedLine(p, path, r, color = STEEL) {
  p.add(G.tube(path, r, { segments: Math.max(4, Math.ceil((path.length - 1) * 0.60)), radial: 8, crease: 65 }), color, 0, 0, 0, 'gunmetal');
}
function perimeterRails(p, rows, height, radius, spacing = 3) {
  for (const side of [-1, 1]) {
    const path = rows.map(([x, w, d]) => [x, d + height, side * w * 0.95]);
    curvedLine(p, path, radius, 0x98a09f);
    curvedLine(p, rows.map(([x, w, d]) => [x, d + height * 0.48, side * w * 0.95]), radius * 0.72, 0x7c8989);
    for (let i = 0; i < rows.length; i += spacing) {
      const [x, w, d] = rows[i];
      p.rod(0x7b8888, radius * 1.05, [x, d, side * w * 0.95], [x, d + height, side * w * 0.95]);
    }
  }
}
function bollard(p, x, y, z, s = 1) {
  p.add(roundedBox(0.66 * s, 0.075 * s, 0.32 * s, 0.025 * s), STEEL, x, y, z);
  for (const dx of [-0.2, 0.2]) {
    p.add(G.lathe([[0, 0], [0.07 * s, 0], [0.07 * s, 0.23 * s], [0.10 * s, 0.23 * s], [0.10 * s, 0.27 * s], [0, 0.27 * s]], 12), STEEL, x + dx * s, y, z, 'gunmetal');
  }
}
function hatch(p, x, y, z, w, d, color = 0x75827e) {
  p.add(roundedBox(w, 0.12, d, 0.035), STEEL, x, y, z);
  p.add(roundedBox(w * 0.90, 0.085, d * 0.86, 0.035), color, x, y + 0.065, z);
  p.rod(STEEL, 0.025, [x - 0.15, y + 0.15, z], [x + 0.15, y + 0.15, z]);
}

// A deckhouse outline with a rounded forward face. Vertical extrusion preserves the curved window band.
function houseShape(length, beam, rounding, steps = 12) {
  const back = -length / 2, front = length / 2, center = front - rounding, half = beam / 2;
  const loop = [[back, -half], [center, -half]];
  for (let i = 1; i <= steps; i++) {
    const a = -Math.PI / 2 + Math.PI * i / steps;
    loop.push([center + rounding * Math.cos(a), half * Math.sin(a)]);
  }
  loop.push([back, half]);
  return loop;
}
function deckhouse(p, x, floor, length, height, beam, color, rounding = beam * 0.45, windows = true) {
  const outline = houseShape(length, beam, rounding);
  p.add(G.extrudeProfile(outline, height, 0.025, { crease: 48, segments: 1 }).rotateX(-Math.PI / 2), color, x, floor + height / 2, 0);
  p.add(G.extrudeProfile(houseShape(length + 0.18, beam + 0.18, rounding + 0.06), 0.12, 0.015, { crease: 48, segments: 1 }).rotateX(-Math.PI / 2), color, x, floor + height + 0.045, 0);
  if (!windows) return;
  const center = x + length / 2 - rounding, half = beam / 2, wy = floor + height * 0.72, wh = height * 0.26;
  // Separate recessed panes follow the forward radius instead of a painted flat box face.
  for (let i = 0; i < 8; i++) {
    const a0 = -Math.PI / 2 + Math.PI * (i + 0.11) / 8, a1 = -Math.PI / 2 + Math.PI * (i + 0.89) / 8;
    const vertices = [[center + (rounding + 0.012) * Math.cos(a0), wy - wh / 2, -(half + 0.012) * Math.sin(a0)], [center + (rounding + 0.012) * Math.cos(a1), wy - wh / 2, -(half + 0.012) * Math.sin(a1)], [center + (rounding + 0.012) * Math.cos(a1), wy + wh / 2, -(half + 0.012) * Math.sin(a1)], [center + (rounding + 0.012) * Math.cos(a0), wy + wh / 2, -(half + 0.012) * Math.sin(a0)]];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3)); geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
    p.add(geo, GLASS, 0, 0, 0, 'plain');
  }
  for (const side of [-1, 1]) for (const t of [0.25, 0.65]) p.box(GLASS, (length - rounding) * 0.23, wh, 0.02, x - length / 2 + (length - rounding) * t, wy, side * (half + 0.015), 'plain');
}
function gunTub(p, x, y, z, r, color, twin = true) {
  p.add(G.lathe([[r * 0.82, 0], [r, 0.05], [r, 0.62 * r], [r * 0.94, 0.72 * r], [r * 0.87, 0.72 * r], [r * 0.88, 0.10], [r * 0.82, 0]], 24, { crease: 45 }), color, x, y, z);
  p.add(G.lathe([[0, 0], [r * 0.88, 0], [r * 0.88, 0.05], [0, 0.05]], 20), DARK, x, y + 0.08, z, 'gunmetal');
  p.rod(STEEL, r * 0.08, [x, y + 0.10, z], [x, y + r, z]);
  p.add(roundedBox(r * 0.50, r * 0.23, r * 0.45, r * 0.04), DARK, x + r * 0.05, y + r, z, 'gunmetal');
  for (const offset of twin ? [-0.10, 0.10] : [0]) p.add(G.barrel(r * 1.65, r * 0.040, { segments: 10 }), DARK, x + r * 0.1, y + r * 1.05, z + offset * r, 'gunmetal');
}
function lifeRing(p, x, y, z, radius) {
  p.add(new THREE.TorusGeometry(radius, radius * 0.24, 8, 20), 0xb7a887, x, y, z, 'canvas');
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) p.add(roundedBox(radius * 0.28, radius * 0.40, radius * 0.48, radius * 0.03), 0xe3dfc9, x + radius * Math.sin(angle), y + radius * Math.cos(angle), z, 'canvas', 0, 0, -angle);
}
function vent(p, x, y, z, r, h, color) {
  p.add(G.lathe([[0, 0], [r, 0], [r, h * 0.70], [r * 1.25, h * 0.78], [r * 1.38, h * 0.91], [r * 1.20, h], [0, h]], 16), color, x, y, z);
  p.add(new THREE.CircleGeometry(r * 0.72, 16), DARK, x + r * 1.1, y + h * 0.87, z, 'plain', 0, Math.PI / 2);
}
function ladder(p, x, y, z, h, w = 0.45) {
  for (const side of [-1, 1]) p.rod(STEEL, 0.035, [x, y, z + side * w / 2], [x, y + h, z + side * w / 2]);
  for (let dy = 0.15; dy < h; dy += 0.24) p.rod(STEEL, 0.030, [x, y + dy, z - w / 2], [x, y + dy, z + w / 2]);
}

function landing(f) {
  const p = parts(), color = f.vehicle, inner = 0x7a8272;
  const rows = stations([[-5.03, 0.95, 0.36, -0.10], [-4.75, 1.32, 0.34, -0.22], [-4.0, 1.48, 0.33, -0.28], [-2.5, 1.50, 0.34, -0.29], [1.8, 1.50, 0.36, -0.22], [4.4, 1.48, 0.39, -0.04], [5.05, 1.40, 0.43, 0.10]], 5);
  hull(p, rows, color, 0x535c50, 0.018, false);
  // The Higgins side walls flare out above the chine; the visible inner wall surrounds an open cargo well.
  for (const side of [-1, 1]) {
    const sides = rows.map(([x, w, floor]) => {
      const top = 1.51 + Math.max(0, x - 2.5) * 0.062;
      return { x, pts: [[side * w, floor - 0.12], [side * w, top], [side * (w - 0.10), top], [side * (w - 0.17), floor + 0.07]] };
    });
    p.add(G.loft(sides, { normals: 45 }), color);
    curvedLine(p, rows.map(([x, w]) => [x, 1.54 + Math.max(0, x - 2.5) * 0.062, side * (w - 0.04)]), 0.055, inner);
    curvedLine(p, rows.map(([x, w, floor]) => [x, floor + 0.16, side * (w - 0.02)]), 0.036, 0x424b41);
    for (let x = -2.6; x <= 4.45; x += 0.62) {
      p.add(G.extrudeProfile([[0, 0], [0.10, 0], [0.16, 1.07], [0.06, 1.09]], 0.06).rotateY(side * Math.PI / 2), inner, x, 0.43, side * 1.33);
    }
    p.box(0x746d55, 6.3, 0.10, 0.28, 0.55, 0.77, side * 1.10, 'wood');
    for (const x of [-2, 0.5, 3]) p.rod(STEEL, 0.035, [x, 0.43, side * 1.05], [x, 0.74, side * 1.10]);
    // Ramp hoist cable passes through the forward cheek pulley and back to its winch.
    curvedLine(p, [[-2.95, 1.44, side * 1.30], [3.8, 1.68, side * 1.36], [4.80, 1.86, side * 1.35], [5.05, 1.68, side * 1.22]], 0.016, 0xa5a48f);
    p.add(G.wheel(0.10, 0.07, { tire: 0, bolts: 0, color: STEEL, segments: 16 }), STEEL, 4.82, 1.74, side * 1.37);
    bollard(p, -4.25, 1.59, side * 1.19, 0.48);
  }
  for (let x = -2.6; x < 4.75; x += 0.49) p.box(0x737866, 0.035, 0.025, 2.50, x, 0.40 + Math.max(0, x) * 0.007, 0);
  // A stern engine deck closes only the aft compartment, leaving the transport well open.
  p.add(roundedBox(2.15, 0.12, 2.59, 0.06), color, -3.80, 1.42, 0);
  p.add(roundedBox(1.45, 0.22, 0.64, 0.06), inner, -3.76, 1.60, 0);
  for (let x = -4.30; x < -3.2; x += 0.14) p.box(DARK, 0.055, 0.020, 0.45, x, 1.718, 0, 'gunmetal');
  p.add(roundedBox(0.82, 0.44, 0.76, 0.08), color, -2.9, 1.66, 0.55);
  p.box(GLASS, 0.025, 0.20, 0.53, -2.48, 1.96, 0.55, 'plain');
  p.rod(STEEL, 0.025, [-2.49, 1.88, 0.25], [-2.49, 2.12, 0.25]);
  p.rod(STEEL, 0.025, [-2.49, 1.88, 0.85], [-2.49, 2.12, 0.85]);
  p.add(new THREE.TorusGeometry(0.19, 0.025, 6, 16), DARK, -3.17, 1.98, 0.55, 'gunmetal', 0, Math.PI / 2);
  p.add(roundedBox(0.35, 0.13, 0.42, 0.05), 0x655c48, -3.76, 1.92, 0.55, 'canvas');
  for (const side of [-1, 1]) {
    const z = side * 0.8;
    p.add(G.lathe([[0.27, 0], [0.36, 0.02], [0.36, 0.41], [0.32, 0.47], [0.28, 0.47], [0.28, 0.04], [0.27, 0]], 24), color, -4.30, 1.48, z);
    p.rod(DARK, 0.055, [-4.30, 1.55, z], [-4.30, 2.18, z]);
    p.add(roundedBox(0.38, 0.16, 0.18, 0.02), DARK, -4.55, 2.20, z, 'gunmetal');
    p.add(G.barrel(1.2, 0.045, { segments: 12 }), DARK, -4.9, 2.2, z, 'gunmetal');
    p.box(0x625d45, 0.27, 0.18, 0.17, -4.5, 2.06, z + side * 0.19, 'gunmetal');
  }
  // The steel bow ramp has a sloped face, hinge shaft, stout framing and recessed panels.
  p.add(G.extrudeProfile([[4.94, 0.40], [5.14, 0.39], [5.20, 1.94], [5.05, 1.97]], 2.79, 0.035), color);
  for (let z = -1.15; z <= 1.16; z += 0.46) p.rod(inner, 0.035, [5.19, 0.52, z], [5.20, 1.87, z]);
  for (const y of [0.66, 1.15, 1.72]) p.rod(inner, 0.028, [5.205, y, -1.29], [5.205, y, 1.29]);
  p.rod(STEEL, 0.067, [5.02, 0.43, -1.44], [5.02, 0.43, 1.44]);
  p.box(f.color, 0.54, 0.31, 0.025, -3.01, 1.68, -1.497, 'plain');
  return { hull: p.finish(0.13) };
}

function patrol(f, fac) {
  const p = parts(), grey = [0x697c78, 0x77838b, 0x5e7468, 0x748484][fac], deck = 0x59665c;
  const rows = stations([[-11, 2.02, 1.24, -0.18], [-10.4, 2.20, 1.28, -0.28], [-8, 2.53, 1.31, -0.42], [-4, 2.68, 1.34, -0.46], [0, 2.70, 1.37, -0.45], [3.8, 2.46, 1.50, -0.35], [6.5, 1.99, 1.67, -0.15], [8.5, 1.34, 1.84, 0.20], [10.0, 0.62, 1.98, 0.54], [10.9, 0.20, 2.04, 0.99], [11.4, 0.009, 2.07, 1.59]], 5);
  hull(p, rows, grey, deck, 0.11, false);
  for (const side of [-1, 1]) {
    curvedLine(p, rows.map(([x, w, d]) => [x, d - 0.09, side * w]), 0.045, 0x9aa39a);
    curvedLine(p, rows.map(([x, w, d, k]) => [x, k + (d - k) * 0.22, side * w * 0.78]), 0.022, 0x485751);
  }
  // A tapered deckhouse, a glazed rounded forward face and an open fighting bridge behind it.
  deckhouse(p, 1.65, 1.55, 3.9, 1.10, 2.48, grey, 0.85);
  p.add(G.extrudeProfile([[-1.10, 1.46], [0.55, 1.46], [0.33, 2.32], [-0.82, 2.32]], 2.33, 0.09), grey);
  p.box(deck, 1.16, 0.08, 2.02, -0.27, 2.40, 0);
  for (const side of [-1, 1]) p.add(G.extrudeProfile([[-0.92, 2.37], [0.48, 2.37], [0.35, 3.07], [-0.90, 3.03]], 0.10, 0.025), grey, 0, 0, side * 1.12);
  p.box(grey, 0.12, 0.66, 2.31, 0.47, 2.74, 0);
  p.box(GLASS, 0.02, 0.25, 0.94, 0.54, 2.91, -0.58, 'plain');
  p.box(GLASS, 0.02, 0.25, 0.94, 0.54, 2.91, 0.58, 'plain');
  p.box(STEEL, 0.34, 0.12, 0.78, 0.23, 2.63, 0);
  p.add(new THREE.TorusGeometry(0.17, 0.025, 6, 16), DARK, 0.05, 2.80, 0, 'gunmetal', 0, Math.PI / 2);
  for (const side of [-1, 1]) p.add(roundedBox(0.45, 0.14, 0.41, 0.05), 0x7d735c, -0.80, 2.70, side * 0.67, 'canvas');
  // The aft engine deck is stepped down from the bridge, with three raised ventilated hatches.
  p.add(roundedBox(4.2, 0.38, 2.15, 0.13), grey, -3.00, 1.65, 0);
  for (const x of [-4.42, -3.05, -1.68]) {
    hatch(p, x, 1.90, 0, 1.0, 1.63, grey);
    for (let z = -0.63; z < 0.68; z += 0.18) p.box(DARK, 0.73, 0.022, 0.064, x, 2.028, z, 'gunmetal');
  }
  gunTub(p, 2.75, 2.62, -0.81, 0.60, grey);
  gunTub(p, -7.80, 1.42, 0.96, 0.66, grey);
  // Four cylindrical torpedo tubes on visible cradles, with breech caps and retaining bands.
  for (const side of [-1, 1]) for (const [x, length, z] of [[0.7, 5.15, 1.91], [-7.1, 4.8, 1.93]]) {
    p.add(G.lathe([[0, 0], [0.24, 0], [0.29, 0.12], [0.29, length - 0.24], [0.27, length - 0.07], [0.22, length], [0.16, length], [0.16, length - 0.18], [0, length - 0.18]], 24, { axis: 'x', crease: 45 }), 0x83908a, x, 1.84, side * z, 'gunmetal');
    for (const dx of [0.48, length - 0.82]) {
      p.add(roundedBox(0.46, 0.41, 0.84, 0.07), grey, x + dx, 1.54, side * z);
      p.add(G.lathe([[0.29, 0], [0.32, 0], [0.32, 0.12], [0.29, 0.12], [0.29, 0]], 20, { axis: 'x' }), STEEL, x + dx - 0.06, 1.84, side * z, 'gunmetal');
    }
    p.box(STEEL, 0.33, 0.12, 0.12, x + 0.27, 2.18, side * z, 'gunmetal');
  }
  for (const side of [-1, 1]) {
    bollard(p, -10.0, 1.42, side * 1.63, 0.85);
    bollard(p, 7.4, 1.87, side * 1.07, 0.78);
    lifeRing(p, 1.2, 2.06, side * 1.28, 0.29);
    vent(p, -4.8, 1.43, side * 1.15, 0.16, 0.68, grey);
    p.rod(STEEL, 0.035, [-10.9, 1.47, side * 1.80], [-10.9, 2.1, side * 1.80]);
  }
  hatch(p, 6.55, 1.85, 0, 1.38, 1.05, grey);
  hatch(p, -9.63, 1.38, -0.30, 1.24, 1.02, grey);
  perimeterRails(p, rows.slice(22), 0.47, 0.025, 5);
  p.rod(STEEL, 0.065, [-0.80, 2.30, 0], [-0.80, 6.0, 0]);
  p.rod(STEEL, 0.038, [-0.80, 5.12, -0.92], [-0.80, 5.12, 0.92]);
  for (const side of [-1, 1]) p.rod(STEEL, 0.020, [-0.80, 5.54, 0], [-4.50, 1.92, side * 0.91]);
  p.box(f.color, 0.82, 0.48, 0.022, -1.19, 5.33, 0, 'plain');
  // The movable aft gun retains its exact original pivot and muzzle, with a rounded shield and cradle.
  const t = parts();
  t.add(G.lathe([[0, 0], [0.65, 0], [0.70, 0.10], [0.65, 0.17], [0.23, 0.22], [0.23, 0.68], [0, 0.68]], 24), grey);
  t.add(roundedBox(0.68, 0.31, 0.48, 0.065), DARK, 0.29, 0.78, 0, 'gunmetal');
  t.add(G.extrudeProfile([[0.42, 0.23], [0.61, 0.25], [0.82, 1.18], [0.66, 1.20]], 1.29, 0.055), grey);
  t.add(G.barrel(1.9, 0.085, { segments: 16 }), DARK, 0.7, 0.9, 0, 'gunmetal');
  t.box(0x746f5f, 0.33, 0.30, 0.22, -0.32, 0.43, -0.38, 'canvas');
  return { hull: p.finish(0.34), turret: t.finish(), mounts: [[-6, 1.6, 0]], tip: [2.6, 0.9, 0] };
}

function shipBoat(p, x, y, z, color) {
  const rows = stations([[-3.65, 0.10, 0.24, 0.10], [-3.1, 0.60, 0.32, -0.13], [-2.0, 0.84, 0.36, -0.43], [0, 0.89, 0.36, -0.55], [2.0, 0.77, 0.40, -0.31], [3.1, 0.37, 0.46, 0.04], [3.6, 0.012, 0.53, 0.39]], 3);
  const b = parts();
  hull(b, rows, color, 0x545b52, 0.035, true);
  for (const side of [-1, 1]) curvedLine(b, rows.map(([dx, w, d]) => [dx, d + 0.13, side * w]), 0.065, color);
  for (const dx of [-2.1, -0.3, 1.3]) b.box(0x8b8065, 0.42, 0.08, 1.43, dx, 0.42, 0, 'wood');
  p.add(b.finish(), 0xffffff, x, y, z);
}
function destroyer(f, fac) {
  const p = parts(), grey = [0x6d8089, 0x788992, 0x637d73, 0x748a90][fac], light = 0x98a8ad, deck = 0x5e6e70;
  const rows = stations([[-53, 2.44, 3.65, -0.25], [-52, 3.40, 3.62, -0.70], [-48, 4.34, 3.55, -1.12], [-40, 5.04, 3.50, -1.35], [-28, 5.46, 3.50, -1.44], [-10, 5.50, 3.50, -1.42], [9, 5.48, 3.51, -1.34], [14, 5.42, 3.76, -1.28], [28, 5.05, 3.84, -1.06], [36, 4.42, 4.02, -0.55], [42, 3.34, 4.37, 0.05], [46.5, 1.86, 4.73, 0.84], [49, 0.60, 5.05, 1.72], [50, 0.014, 5.22, 2.63]], 4);
  hull(p, rows, grey, deck, 0.18, true);
  for (const side of [-1, 1]) {
    curvedLine(p, rows.map(([x, w, d]) => [x, d - 0.12, side * w]), 0.07, 0xa4b1b5);
  }
  // Layered forward superstructure and the raised second gun platform form the destroyer's main silhouette.
  deckhouse(p, 15.0, 3.80, 19.4, 3.32, 7.35, grey, 2.55, false);
  deckhouse(p, 17.3, 7.18, 11.0, 1.38, 6.75, light, 2.35, false);
  deckhouse(p, 18.3, 8.63, 8.7, 2.04, 5.8, light, 2.12);
  deckhouse(p, 16.3, 10.83, 6.3, 0.38, 5.7, light, 2.00, false);
  // Bridge wings have a real open floor and a thin windbreak around the outer edge.
  for (const side of [-1, 1]) {
    p.add(roundedBox(6.1, 0.18, 1.63, 0.12), light, 17.0, 8.53, side * 3.93);
    p.box(light, 6.0, 0.91, 0.12, 17.0, 9.06, side * 4.67);
    p.box(light, 0.12, 0.91, 1.52, 20.0, 9.06, side * 3.96);
    p.rod(STEEL, 0.085, [17, 8.7, side * 4], [17, 9.42, side * 4]);
    p.add(G.barrel(0.82, 0.12, { segments: 12 }), DARK, 17, 9.50, side * 4, 'gunmetal');
    ladder(p, 7.0, 3.82, side * 3.79, 3.3, 0.60);
    lifeRing(p, 14.0, 6.15, side * 3.72, 0.42);
    for (const x of [11.0, 13.1, 15.2, 17.3, 19.4]) {
      p.add(new THREE.CircleGeometry(0.18, 16), DARK, x, 5.84, side * 3.70, 'plain', 0, side === 1 ? 0 : Math.PI);
      p.add(new THREE.TorusGeometry(0.19, 0.027, 6, 16), light, x, 5.84, side * 3.72, 'gunmetal');
    }
  }
  p.add(G.lathe([[1.05, 0], [1.36, 0], [1.36, 0.78], [1.27, 0.88], [1.14, 0.88], [1.14, 0.12], [1.05, 0]], 28), light, 18, 11.12, 0);
  p.add(G.lathe([[0, 0], [0.71, 0], [0.75, 0.38], [0.65, 0.61], [0.38, 0.83], [0, 0.88]], 24), STEEL, 18, 12.0, 0);
  p.add(G.barrel(1.7, 0.16, { segments: 16 }), DARK, 18.2, 12.34, 0, 'gunmetal');
  // A stepped forecastle gun platform aligns with the existing superfiring pivot.
  deckhouse(p, 25, 3.90, 6.2, 1.21, 5.4, grey, 1.3, false);
  deckhouse(p, -32, 3.62, 15.0, 0.35, 6.3, grey, 1.4, false);
  deckhouse(p, -25.7, 3.98, 7.7, 1.45, 4.7, grey, 1.35, false);
  // Two oval, raked funnels with a recessed exhaust throat, cap rim and horizontal reinforcing bands.
  for (const x of [2.8, -10.3]) {
    const funnel = G.lathe([[0, 0], [1.52, 0], [1.69, 0.45], [1.65, 5.75], [1.72, 5.88], [1.75, 6.36], [1.52, 6.50], [1.36, 6.40], [1.32, 6.09], [1.31, 5.73], [0, 5.73]], 24, { crease: 50 }).scale(1.3, 1, 1);
    p.add(funnel, grey, x, 4.12, 0, 'armor-paint', 0, 0, 0.085);
    const cap = G.lathe([[1.72, 0], [1.77, 0.06], [1.77, 0.44], [1.52, 0.58], [1.35, 0.51], [1.33, 0.21], [1.34, 0], [1.72, 0]], 24).scale(1.3, 1, 1);
    p.add(cap, DARK, x - 0.51, 9.94, 0, 'gunmetal', 0, 0, 0.085);
    for (const h of [1.2, 3.50, 5.20]) p.add(G.lathe([[1.64, 0], [1.68, 0], [1.68, 0.095], [1.64, 0.095], [1.64, 0]], 20).scale(1.3, 1, 1), light, x - h * 0.085, 4.12 + h, 0);
    p.add(G.lathe([[1.64, 0], [1.665, 0], [1.665, 0.46], [1.64, 0.46], [1.64, 0]], 20).scale(1.3, 1, 1), f.color, x - 0.33, 8.03, 0, 'plain');
    ladder(p, x - 2.16, 4.4, 0, 4.9, 0.53);
  }
  // Amidships quintuple torpedo racks and surrounding open anti-aircraft platforms.
  for (const x of [-3.7, -19.0]) {
    p.add(G.lathe([[0, 0], [1.10, 0], [1.10, 0.47], [0, 0.47]], 24), grey, x, 3.8, 0);
    p.add(roundedBox(5.2, 0.32, 4.6, 0.1), grey, x, 4.41, 0);
    for (const z of [-1.56, -0.78, 0, 0.78, 1.56]) {
      p.add(G.lathe([[0, 0], [0.28, 0], [0.36, 0.15], [0.36, 5.25], [0.29, 5.5], [0.21, 5.5], [0.21, 5.2], [0, 5.2]], 12, { axis: 'x' }), STEEL, x - 2.8, 4.99, z, 'gunmetal');
      for (const dx of [-1.65, 1.35]) p.box(grey, 0.20, 0.23, 0.80, x + dx, 4.76, z);
    }
  }
  for (const side of [-1, 1]) {
    // The lifeboat sits in its cradle under two hooked davits, rather than on a solid hull-side block.
    shipBoat(p, -11.7, 5.1, side * 3.55, 0xb3b8a8);
    for (const x of [-14.5, -8.9]) {
      curvedLine(p, [[x, 3.85, side * 4.33], [x, 6.31, side * 4.33], [x, 7.03, side * 3.9], [x, 7.19, side * 3.28]], 0.095, light);
      p.rod(STEEL, 0.030, [x, 7.06, side * 3.39], [x, 5.35, side * 3.39]);
    }
    gunTub(p, 1.3, 4.04, side * 3.46, 0.91, grey);
    gunTub(p, -26, 5.55, side * 1.53, 0.86, grey);
    bollard(p, 36.4, 4.25, side * 3.1, 1.25);
    bollard(p, -48.7, 3.70, side * 2.82, 1.35);
    p.add(G.extrudeProfile([[43.0, 2.77], [43.65, 2.54], [44.04, 3.26], [43.7, 3.95], [43.46, 3.33], [42.91, 3.16]], 0.09), STEEL, 0, 0, side * 3.07, 'gunmetal');
    // The hull's paired hawse recesses are large enough to read at gameplay zoom.
    p.add(new THREE.CircleGeometry(0.33, 20), DARK, 41.6, 3.42, side * 3.5, 'plain', 0, side === 1 ? 0 : Math.PI);
    for (const x of [-41, -34, -27, -20, -13, -6, 1, 8]) p.add(new THREE.CircleGeometry(0.14, 12), DARK, x, 2.9, side * (x < -30 ? 5.1 : 5.49), 'plain', 0, side === 1 ? 0 : Math.PI);
  }
  // Foredeck anchor handling gear, open aft fittings and depth-charge rails.
  p.add(G.lathe([[0, 0], [0.50, 0], [0.59, 0.20], [0.59, 0.42], [0.42, 0.53], [0, 0.53]], 24), STEEL, 39, 4.31, 0);
  for (const side of [-1, 1]) {
    curvedLine(p, [[39, 4.49, side * 0.7], [41, 4.43, side * 1.55], [42.8, 4.49, side * 2.4]], 0.075, DARK);
    p.box(STEEL, 4.40, 0.16, 0.12, -49.9, 4.02, side * 1.39);
    p.box(STEEL, 4.40, 0.16, 0.12, -49.9, 4.02, side * 2.13);
    for (const x of [-48.2, -49.2, -50.2, -51.2]) p.add(G.lathe([[0, 0], [0.33, 0], [0.33, 0.83], [0, 0.83]], 16, { axis: 'z' }), 0x53665f, x, 4.30, side * 1.76 - 0.41, 'gunmetal');
    hatch(p, -30.2, 5.58, side * 1.22, 1.46, 1.12, light);
    vent(p, 5.7, 3.91, side * 2.20, 0.34, 1.5, grey);
    vent(p, -16.3, 3.91, side * 2.55, 0.30, 1.3, grey);
  }
  perimeterRails(p, rows, 0.88, 0.038, 4);
  // A braced mast and open radar lattice are structural silhouettes at the same height as before.
  p.rod(STEEL, 0.18, [10.0, 6.92, 0], [10.0, 25.7, 0]);
  for (const side of [-1, 1]) p.rod(STEEL, 0.11, [7.2, 7.10, side * 2.6], [10.0, 19.4, 0]);
  p.rod(STEEL, 0.075, [10.0, 20.9, -3], [10.0, 20.9, 3]);
  p.rod(STEEL, 0.060, [10.0, 17.2, -2.2], [10.0, 17.2, 2.2]);
  for (const y of [23.2, 24.9]) p.rod(light, 0.065, [10.1, y, -1.95], [10.1, y, 1.95]);
  for (let z = -1.95; z <= 1.96; z += 0.49) p.rod(light, 0.045, [10.1, 23.2, z], [10.1, 24.9, z]);
  for (let z = -1.95; z < 1.9; z += 0.49) p.rod(STEEL, 0.025, [10.1, 23.2, z], [10.1, 24.9, z + 0.49]);
  p.rod(STEEL, 0.075, [-28.5, 5.5, 0], [-28.5, 14.6, 0]);
  p.rod(STEEL, 0.045, [-28.5, 12.2, -1.8], [-28.5, 12.2, 1.8]);
  for (const side of [-1, 1]) p.rod(STEEL, 0.020, [10, 21, 0], [-27, 5.95, side * 2]);
  p.box(f.color, 1.50, 0.90, 0.035, 9.18, 22.0, 0, 'plain');
  // Rounded sloping gunhouses replace the rectangular turret blocks without moving the gun trunnions.
  const t = parts();
  t.add(G.lathe([[0, 0], [1.75, 0], [1.85, 0.12], [1.85, 0.27], [1.72, 0.33], [0, 0.33]], 32), grey);
  const rings = [
    { x: -2.25, pts: [[1.53, 0.45], [1.74, 0.82], [1.73, 1.97], [1.43, 2.25], [-1.43, 2.25], [-1.73, 1.97], [-1.74, 0.82], [-1.53, 0.45]] },
    { x: -1.65, pts: [[1.82, 0.37], [1.98, 0.70], [1.84, 2.11], [1.50, 2.44], [-1.50, 2.44], [-1.84, 2.11], [-1.98, 0.70], [-1.82, 0.37]] },
    { x: 0.7, pts: [[1.83, 0.37], [1.98, 0.70], [1.80, 2.12], [1.47, 2.44], [-1.47, 2.44], [-1.80, 2.12], [-1.98, 0.70], [-1.83, 0.37]] },
    { x: 1.70, pts: [[1.66, 0.47], [1.79, 0.76], [1.58, 1.98], [1.22, 2.25], [-1.22, 2.25], [-1.58, 1.98], [-1.79, 0.76], [-1.66, 0.47]] },
    { x: 2.1, pts: [[1.18, 0.64], [1.41, 0.87], [1.16, 1.83], [0.83, 2.05], [-0.83, 2.05], [-1.16, 1.83], [-1.41, 0.87], [-1.18, 0.64]] },
  ];
  t.add(G.loft(rings, { normals: 36 }), light);
  t.add(G.lathe([[0, 0], [0.44, 0], [0.48, 0.14], [0.35, 0.41], [0, 0.41]], 24, { axis: 'x' }), grey, 1.65, 1.6, 0);
  t.add(G.barrel(6, 0.18, { segments: 20 }), 0x45575f, 1.5, 1.6, 0, 'gunmetal');
  t.add(roundedBox(0.76, 0.085, 0.76, 0.06), grey, -0.6, 2.46, 0);
  for (const side of [-1, 1]) t.add(roundedBox(0.86, 0.31, 0.035, 0.012), STEEL, -0.9, 1.55, side * 1.89, 'gunmetal');
  return { hull: p.finish(0.64), turret: t.finish(), mounts: [[33, 4, 0], [25, 5.2, 0], [-36, 4, 0], [-44, 4, 0]], tip: [7.5, 1.6, 0] };
}

export function navalModel(type, fac, look) {
  const key = `${type}|${fac}|${look.vehicle}|${look.color}`;
  if (!cache.has(key)) cache.set(key, type === 'lcvp' ? landing(look) : type === 'gunboat' ? patrol(look, fac) : destroyer(look, fac));
  return cache.get(key);
}
