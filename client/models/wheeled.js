// Wheeled and half-tracked vehicles: the M8 Greyhound, Sd.Kfz. 222 and BA-64 armored cars, the M16 quad .50
// half-track, the Panzerwerfer 42 on the Maultier and the Katyusha on a Studebaker truck.
//
// Each model is two vertex-colored geometries, the hull and the part that traverses (turret or launcher), so a unit
// stays two draw calls with the shared PAINT material (client/unit-models.js hands them to it). Colors are baked in,
// darker toward the ground and lighter on top faces, like a painted miniature. Axes: +x forward, +y up, ground at
// y = 0, z is the vehicle's right. Sizes are in game metres, about 0.8 of the real vehicles.
//
// Only 'three' and the geometry kit are imported, so the browser and the Node tests load it the same way.
import * as THREE from 'three';
import * as G from './geom.js';

// which units this module builds: every armored car, the US half-track flak, the German and Soviet rocket trucks
export const isWheeled = (type, fac) => !!BUILD[type]?.[fac];

const col = (hex) => new THREE.Color(hex);
const shade = (c, k) => c.clone().multiplyScalar(k);
const TAU = Math.PI * 2;

// the faction's vehicle paint, its shades, and the fixed colors every model uses
function paints(look, fac) {
  // Panzer grey is the darkest faction paint and goes almost black under the warm sun, so it is lifted a little
  const base = shade(col(look.vehicle), fac === 1 ? 1.28 : 1);
  return {
    base, mid: shade(base, 0.82), dark: shade(base, 0.62), deep: shade(base, 0.4), light: shade(base, 1.2), pale: shade(base, 1.45),
    owner: col(look.color), rubber: col(0x33312c), tread: col(0x383631), steel: col(0x3c3b37), gun: col(0x2d2d2b), glass: col(0x55676f),
    tan: col(0x8f7d55), wood: col(0x74522f), lamp: col(0xeee6c4), black: col(0x1c1b18), red: col(0xc23a2a), chalk: col(0xece6d6),
    rust: col(0x6a4a34), white: col(0xffffff), silver: col(0x9aa0a2), sand: col(0xa09462),
  };
}

// ---------------------------------------------------------------- building blocks

const memo = new Map();
const once = (key, make) => memo.get(key) ?? memo.set(key, make()).get(key);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const I = new THREE.Matrix4();

// A list of colored, placed shapes that merge() turns into one geometry.
function parts() {
  const list = [];
  const api = {
    list,
    // any shape at a position, an XYZ Euler turn and a scale
    add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) { list.push({ geo, color, matrix: G.xf(x, y, z, rx, ry, rz, sx, sy, sz) }); return api; },
    // a box w (x) by h (y) by d (z) centered at x, y, z
    box(color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { list.push({ geo: BOX, color, matrix: G.xf(x, y, z, rx, ry, rz, w, h, d) }); return api; },
    // an 8-sided rod of radius r along x (turned by rz about z, so it can slope up), centered at x, y, z
    rod(color, r, len, x, y, z, rx = 0, ry = 0, rz = 0) { list.push({ geo: CYL8, color, matrix: G.xf(x, y, z, rx, ry, rz + Math.PI / 2, r, len, r) }); return api; },
    // a flat disc lying down
    disc(color, r, x, y, z, thick = 0.02) { list.push({ geo: CYL8, color, matrix: G.xf(x, y, z, 0, 0, 0, r, thick, r) }); return api; },
    mat(geo, color, matrix = I) { list.push({ geo, color, matrix }); return api; },
  };
  return api;
}
const merge = (list) => {
  if (globalThis.__tris) {
    const by = new Map();
    for (const it of list) { const t = (it.geo.index ? it.geo.index.count : it.geo.attributes.position.count) / 3, e = by.get(it.geo) ?? { t, n: 0 }; e.n++; by.set(it.geo, e); }
    console.log([...by.values()].sort((a, b) => b.t * b.n - a.t * a.n).slice(0, 10).map((e) => `${e.t}x${e.n}`).join(' '));
  }
  return G.merge(list);
};

// Wheels: a dark tire with shoulders around a painted hub, axle along z, outer face at +z. side -1 mirrors it.
function tireGeo(R, w, seg) {
  return once(`tire|${R}|${w}|${seg}`, () => {
    const h = w / 2;
    return G.lathe([[R * 0.58, h * 0.92], [R * 0.9, h], [R, h * 0.74], [R, -h * 0.74], [R * 0.9, -h], [R * 0.58, -h * 0.92], [R * 0.58, h * 0.92]], seg, { axis: 'z' });
  });
}
function hubGeo(R, w, seg) {
  return once(`hub|${R}|${w}|${seg}`, () => {
    const h = w / 2;
    return G.lathe([[0, h * 1.02], [R * 0.17, h * 1.02], [R * 0.21, h * 0.8], [R * 0.62, h * 0.8]], seg, { axis: 'z' });
  });
}
function wheel(p, P, R, w, x, y, z, side = 1, { seg = 12, hub = P.mid, tire = P.rubber } = {}) {
  const m = G.xf(x, y, z, 0, 0, 0, 1, 1, side);
  p.mat(tireGeo(R, w, seg), tire, m);
  p.mat(hubGeo(R, w, seg), hub, m);
}
// a flat road wheel for the half-track runs: a painted disc with a hub boss and a rim band, axle along z
function roadWheel(p, R, w, x, y, z, side, paint) {
  p.mat(once(`road|${R}|${w}`, () => G.lathe([[0, w * 0.5], [R * 0.22, w * 0.5], [R * 0.3, w * 0.3], [R, w * 0.3], [R, 0]], 8, { axis: 'z' })), paint, G.xf(x, y, z, 0, 0, 0, 1, 1, side));
}

// A solid between two plan outlines ([[x, z], ...], the same count, in the same order) at heights y0 and y1: walls
// that lean in or out and flat caps. `hole` is an outline cut through the top cap. `inside` turns the walls to
// face inward (the inner wall of an open tub). Normals are creased at `angle` degrees.
function frustum(bottom, top, y0, y1, { caps = true, hole = null, inside = false, angle = 40 } = {}) {
  const n = bottom.length, pos = [], idx = [];
  for (const [x, z] of bottom) pos.push(x, y0, z);
  for (const [x, z] of top) pos.push(x, y1, z);
  let area = 0;
  for (let i = 0; i < n; i++) { const [x0, z0] = bottom[i], [x1, z1] = bottom[(i + 1) % n]; area += x0 * z1 - x1 * z0; }
  const out = (area > 0) !== inside; // winding of walls that face away from the middle
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, b0 = i, b1 = j, t0 = n + i, t1 = n + j;
    if (out) idx.push(b0, t1, b1, b0, t0, t1); else idx.push(b0, b1, t1, b0, t1, t0);
  }
  if (caps) {
    const v2 = ([x, z]) => new THREE.Vector2(x, z), contour = top.map(v2), holes = hole ? [hole.map(v2)] : [];
    const base = pos.length / 3, all = [...top, ...(hole ?? [])];
    for (const [x, z] of all) pos.push(x, y1, z);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const ux = all[b][0] - all[a][0], uz = all[b][1] - all[a][1], vx = all[c][0] - all[a][0], vz = all[c][1] - all[a][1];
      if (uz * vx - ux * vz >= 0) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
    if (!inside && !hole) { // the bottom cap, for solids
      const base2 = pos.length / 3;
      for (const [x, z] of bottom) pos.push(x, y0, z);
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(bottom.map(v2), [])) {
        const ux = bottom[b][0] - bottom[a][0], uz = bottom[b][1] - bottom[a][1], vx = bottom[c][0] - bottom[a][0], vz = bottom[c][1] - bottom[a][1];
        if (uz * vx - ux * vz <= 0) idx.push(base2 + a, base2 + b, base2 + c); else idx.push(base2 + a, base2 + c, base2 + b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return G.crease(g, angle);
}
// a flat ring between an outer and an inner outline at height y, facing up (the rim of an open tub)
function rim(outer, inner, y, angle = 40) {
  const v2 = ([x, z]) => new THREE.Vector2(x, z), pos = [], idx = [], all = [...outer, ...inner];
  for (const [x, z] of all) pos.push(x, y, z);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer.map(v2), [inner.map(v2)])) {
    const ux = all[b][0] - all[a][0], uz = all[b][1] - all[a][1], vx = all[c][0] - all[a][0], vz = all[c][1] - all[a][1];
    if (uz * vx - ux * vz >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return G.crease(g, angle);
}
const circ = (r, n = 12, cx = 0, cz = 0) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos((k / n) * TAU), cz + r * Math.sin((k / n) * TAU)]);
// an open-topped box of plates (a cab, a bed, a fighting compartment): outer walls, inner walls and a rim, from x0 to
// x1 and half width z, between y0 and y1. lean widens the top.
function tub(p, outer, inner, edge, x0, x1, z, y0, y1, th = 0.07, lean = 0) {
  const rect = (a, b, c) => [[b, c], [a, c], [a, -c], [b, -c]];
  const ob = rect(x0, x1, z), ot = rect(x0, x1, z + lean), ib = rect(x0 + th, x1 - th, z - th), it = rect(x0 + th, x1 - th, z + lean - th);
  p.mat(frustum(ob, ot, y0, y1, { caps: false }), outer);
  p.mat(frustum(ib, it, y0 + 0.02, y1, { caps: false, inside: true }), inner);
  p.mat(rim(ot, it, y1), edge);
}

// a hull cross-section from three corners (half width, height): bottom, widest side and top shoulder, mirrored in z
const ringOf = (b, m, t) => [[b[0], b[1]], [m[0], m[1]], [t[0], t[1]], [-t[0], t[1]], [-m[0], m[1]], [-b[0], b[1]]];
const hullOf = (stations, normals = 38) => G.loft(stations.map(([x, b, m, t]) => ({ x, pts: ringOf(b, m, t) })), { normals });

// Painted-miniature finish on a merged geometry: top faces a little lighter (dry brush), darker toward the floor and
// on downward faces (shadow in the crevices).
function finish(geo, { floor = 0, height = 1.1, dark = 0.72, under = 0.22, top = 0.18 } = {}) {
  const g = G.ao(geo, { floor, height, dark, under }), N = g.attributes.normal, C = g.attributes.color;
  for (let i = 0; i < C.count; i++) {
    const k = 1 + top * Math.max(0, N.getY(i));
    C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k);
  }
  g.computeBoundingSphere();
  return g;
}
const place = (at, normal, up = [0, 1, 0], s = 1) => G.place(at, normal, up, s);
// markings: the faction's insignia, flat on a surface (white paint so the marking's own colors show as built)
const insignia = (P, fac, size) => (fac === 1 ? G.balkenkreuz(size) : G.star(size, fac === 2 ? { color: P.red, border: P.chalk, edge: 0.12 } : { color: P.chalk }));
// the marking on the side of a hull, at x, y on the surface half width z (the surface leans out by lean going up)
function sideMark(p, P, fac, size, x, y, z, s, lean = 0.1) {
  const nz = 1 / Math.hypot(1, lean), ny = lean * nz;
  p.mat(insignia(P, fac, size), P.white, place([x, y + 0.012 * ny, s * (z + 0.012 * nz)], [0, ny, s * nz], [0, 1, 0]));
}
// a marking on a surface sloping up toward the back (a glacis, a hood): at x, y with the slope dy/dx
function slopeMark(p, P, fac, size, x, y, slope) {
  const L = Math.hypot(1, slope), nx = -slope / L, ny = 1 / L;
  p.mat(insignia(P, fac, size), P.white, place([x + 0.012 * nx, y + 0.012 * ny, 0], [nx, ny, 0], [-1, -slope, 0]));
}

// ---------------------------------------------------------------- M8 Greyhound

function m8(P, fac) {
  const h = parts(), t = parts();
  // hull: a slab-sided body, the glacis and the lower front plate sloped, sides leaning in a little toward the deck
  h.mat(hullOf([
    [-2.12, [0.5, 0.64], [0.96, 0.78], [0.9, 1.38]],
    [-1.95, [0.46, 0.45], [0.98, 0.74], [0.92, 1.4]],
    [1.2, [0.46, 0.45], [0.98, 0.74], [0.92, 1.4]],
    [1.62, [0.42, 0.5], [0.96, 0.76], [0.86, 1.24]],
    [1.95, [0.38, 0.64], [0.9, 0.84], [0.72, 1.06]],
    [2.15, [0.34, 0.74], [0.76, 0.9], [0.62, 1.0]],
  ]), P.base);
  // six wheels, the rear two close together
  for (const x of [1.5, -0.17, -1.38]) for (const s of [1, -1]) {
    wheel(h, P, 0.44, 0.34, x, 0.44, s * 1.02, s, { seg: 12 });
    h.add(G.chamferBox(0.95, 0.05, 0.24, 0.02), P.base, x, 0.95, s * 1.06);
  }
  // driver's vision slits, the bumper, headlights, tow shackles
  for (const s of [1, -1]) {
    h.box(P.black, 0.04, 0.07, 0.3, 1.74, 1.13, s * 0.36, 0, 0, -0.62);
    h.rod(P.lamp, 0.085, 0.12, 1.96, 1.06, s * 0.74, 0, 0, 0);
    h.box(P.steel, 0.08, 0.12, 0.1, 2.2, 0.66, s * 0.38);
  }
  h.box(P.steel, 0.1, 0.12, 1.5, 2.17, 0.8, 0);
  slopeMark(h, P, fac, 0.3, 1.58, 1.15, -0.55);
  // rear deck: a grille, stowage and the aerial
  for (const x of [-0.85, -1.35]) { h.box(P.deep, 0.42, 0.03, 0.9, x, 1.415, 0); for (let i = 0; i < 4; i++) h.box(P.dark, 0.03, 0.02, 0.9, x - 0.15 + i * 0.1, 1.43, 0); }
  h.add(CYL8, P.tan, -1.88, 1.52, 0, Math.PI / 2, 0, 0, 0.13, 1.1, 0.13); h.box(P.wood, 0.4, 0.22, 0.4, -1.5, 1.5, 0.45); h.box(P.rust, 0.3, 0.24, 0.3, -1.55, 1.52, -0.45);
  h.mat(G.tube([[-1.9, 1.4, 0.72], [-1.9, 2.5, 0.72]], 0.012, { radial: 5 }), P.steel);
  // side stowage: shovel, pick handle, jerrycans
  for (const s of [1, -1]) {
    h.box(P.wood, 0.9, 0.04, 0.04, -0.6, 1.0, s * 1.0); h.box(P.steel, 0.2, 0.04, 0.12, 0.0, 1.0, s * 1.0); h.box(P.dark, 0.3, 0.3, 0.14, -1.0, 1.2, s * 1.0);
    h.box(P.light, 0.55, 0.45, 0.03, -0.2, 1.05, s * 0.99);
    sideMark(h, P, fac, 0.26, 0.55, 1.12, 0.95, s, 0.05);
  }

  // turret: an octagon in plan with sloping sides, an open roof with a ring mount and a .50 on it, a 37 mm gun
  const bot = [[0.82, 0.36], [0.58, 0.74], [-0.5, 0.74], [-0.78, 0.44], [-0.78, -0.44], [-0.5, -0.74], [0.58, -0.74], [0.82, -0.36]];
  const top = bot.map(([x, z]) => [x * 0.76 + 0.02, z * 0.68]);
  t.mat(frustum(bot, top, 0, 0.62, { hole: circ(0.36, 12, -0.02, 0) }), P.base);
  t.disc(P.deep, 0.35, -0.02, 0.3, 0);
  t.mat(G.lathe([[0.38, 0], [0.44, 0], [0.44, 0.15], [0.38, 0.15], [0.38, 0]], 12), P.light, G.xf(-0.02, 0.62, 0));
  t.box(P.gun, 0.38, 0.09, 0.09, -0.22, 0.94, 0); t.rod(P.gun, 0.022, 0.55, 0.14, 0.94, 0, 0, 0, 0.04); t.box(P.base, 0.2, 0.18, 0.14, -0.34, 0.82, 0.28);
  t.box(P.gun, 0.06, 0.3, 0.06, -0.22, 0.8, 0);
  t.add(G.chamferBox(0.3, 0.44, 0.6, 0.04), P.light, 0.88, 0.32, 0);
  t.mat(G.barrel(1.6, 0.052, { segments: 8 }), P.gun, G.xf(1.0, 0.32, 0));
  t.box(P.gun, 0.4, 0.05, 0.05, 1.2, 0.32, 0.16); // coax
  t.mat(insignia(P, fac, 0.2), P.white, place([-0.36, 0.625, 0.0], [0, 1, 0], [1, 0, 0]));
  t.box(P.owner, 0.22, 0.02, 0.5, -0.56, 0.625, 0);
  t.add(G.chamferBox(0.34, 0.26, 0.5, 0.04), P.mid, -0.9, 0.36, 0); // turret bustle stowage

  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.6, dark: 0.74 }),
    turretAt: [0.05, 1.4, 0], tip: [2.6, 0.32, 0],
  };
}

// ---------------------------------------------------------------- Sd.Kfz. 222

// a wire grenade screen: a frame with a lattice, lying in the xy plane from (-hl, 0) to (hl, height)
function screen(p, color, hl, height, x, y, z, tilt) {
  const w = 0.025, sub = parts();
  sub.box(color, 2 * hl, w, w, 0, 0, 0); sub.box(color, 2 * hl, w, w, 0, height, 0);
  sub.box(color, w, height, w, -hl, height / 2, 0); sub.box(color, w, height, w, hl, height / 2, 0);
  for (let i = 1; i < 6; i++) sub.box(color, 0.014, height, 0.014, -hl + (2 * hl * i) / 6, height / 2, 0);
  for (let i = 1; i < 3; i++) sub.box(color, 2 * hl, 0.014, 0.014, 0, (height * i) / 3, 0);
  const m = G.xf(x, y, z, tilt, 0, 0);
  for (const it of sub.list) p.mat(it.geo, it.color, m.clone().multiply(it.matrix));
}

function sdkfz222(P, fac) {
  const h = parts(), t = parts();
  // a tall faceted body: slab sides leaning in toward the deck, a pointed nose with a sloped glacis, tires set
  // into the sides
  h.mat(hullOf([
    [-2.0, [0.5, 0.6], [0.86, 0.84], [0.62, 1.42]],
    [-1.55, [0.54, 0.44], [0.9, 0.86], [0.7, 1.5]],
    [0.55, [0.54, 0.44], [0.9, 0.86], [0.7, 1.5]],
    [1.2, [0.5, 0.46], [0.84, 0.88], [0.62, 1.3]],
    [1.75, [0.42, 0.58], [0.66, 0.9], [0.46, 1.1]],
    [2.08, [0.34, 0.7], [0.46, 0.92], [0.34, 1.0]],
  ], 34), P.base);
  for (const x of [1.4, -1.1]) for (const s of [1, -1]) {
    wheel(h, P, 0.4, 0.3, x, 0.4, s * 0.8, s, { seg: 12 });
    h.add(G.chamferBox(0.95, 0.05, 0.2, 0.02), P.base, x, 0.9, s * 0.98); // mudguard strip over the tire
  }
  // headlights, the bumper bar, marker posts on the front fenders
  for (const s of [1, -1]) {
    h.add(G.chamferBox(0.5, 0.2, 0.3, 0.04), P.base, 1.62, 0.96, s * 0.88);
    h.rod(P.lamp, 0.085, 0.1, 1.92, 1.08, s * 0.58, 0, 0, 0);
    h.mat(G.tube([[1.82, 1.04, s * 0.98], [1.82, 1.56, s * 0.98]], 0.015, { radial: 5 }), P.steel);
    h.add(new THREE.SphereGeometry(0.05, 6, 4), P.steel, 1.82, 1.58, s * 0.98);
    // doors, tool boxes, jerrycans, a pioneer tool and the insignia
    h.box(P.light, 0.7, 0.5, 0.03, 0.05, 1.0, s * 0.88, -s * 0.29, 0, 0); h.box(P.dark, 0.4, 0.26, 0.12, -1.3, 1.2, s * 0.8); h.box(P.rust, 0.16, 0.36, 0.2, -1.62, 0.98, s * 0.96);
    h.box(P.wood, 0.7, 0.035, 0.035, 0.5, 1.22, s * 0.84); h.box(P.steel, 0.16, 0.03, 0.1, 0.9, 1.22, s * 0.84);
    h.box(P.black, 0.04, 0.06, 0.28, 1.45, 1.18, s * 0.3, 0, 0, -0.55);
    sideMark(h, P, fac, 0.24, -0.5, 1.16, 0.8, s, 0.3);
  }
  h.box(P.steel, 0.07, 0.07, 1.4, 2.12, 0.66, 0);
  for (const x of [-1.3, -1.7]) h.box(P.deep, 0.34, 0.025, 0.8, x, 1.435, 0);
  slopeMark(h, P, fac, 0.3, 1.5, 1.2, -0.28);

  // fighting compartment: an open octagonal tub with a gun inside and a mesh screen folded out over it
  const bot = [[0.72, 0.3], [0.5, 0.62], [-0.5, 0.62], [-0.72, 0.3], [-0.72, -0.3], [-0.5, -0.62], [0.5, -0.62], [0.72, -0.3]];
  const top = bot.map(([x, z]) => [x * 0.92, z * 0.9]);
  const inB = bot.map(([x, z]) => [x * 0.84, z * 0.84]), inT = top.map(([x, z]) => [x * 0.92, z * 0.92]);
  t.mat(frustum(bot, top, 0, 0.3, { caps: false }), P.base);
  t.mat(frustum(inB, inT, 0.02, 0.3, { caps: false, inside: true }), P.dark);
  t.mat(rim(top, inT, 0.3), P.light);
  t.disc(P.deep, 0.55, 0, 0.04, 0);
  t.add(G.chamferBox(0.5, 0.24, 0.3, 0.03), P.steel, 0.2, 0.24, 0); t.mat(G.barrel(1.5, 0.03, { brake: true, segments: 8 }), P.gun, G.xf(0.4, 0.3, 0));
  t.box(P.deep, 0.3, 0.2, 0.26, -0.34, 0.14, 0.24); t.box(P.tan, 0.2, 0.1, 0.3, -0.38, 0.1, -0.24);
  for (const s of [1, -1]) screen(t, P.steel, 0.58, 0.34, 0, 0.3, s * 0.5, s * 0.2);
  { const m = G.xf(-0.58, 0.3, 0, 0, Math.PI / 2, 0); const sub = parts(); screen(sub, P.steel, 0.5, 0.34, 0, 0, 0, 0.2); for (const it of sub.list) t.mat(it.geo, it.color, m.clone().multiply(it.matrix)); }
  t.box(P.owner, 0.2, 0.02, 0.26, -0.5, 0.305, 0);

  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.5, dark: 0.78 }),
    turretAt: [-0.1, 1.5, 0], tip: [1.9, 0.3, 0],
  };
}

// ---------------------------------------------------------------- BA-64

function ba64(P, fac) {
  const h = parts(), t = parts();
  // tall and narrow: slab sides leaning in toward a flat roof, a stepped front
  h.mat(hullOf([
    [-1.75, [0.42, 0.55], [0.62, 0.8], [0.42, 1.44]],
    [-1.35, [0.46, 0.4], [0.68, 0.78], [0.48, 1.56]],
    [0.2, [0.46, 0.4], [0.68, 0.78], [0.48, 1.56]],
    [0.65, [0.46, 0.4], [0.68, 0.78], [0.52, 1.24]],
    [1.1, [0.46, 0.42], [0.64, 0.8], [0.5, 1.1]],
    [1.55, [0.4, 0.56], [0.58, 0.82], [0.44, 0.98]],
    [1.75, [0.36, 0.66], [0.48, 0.8], [0.38, 0.9]],
  ], 30), P.base);
  for (const x of [1.15, -1.0]) for (const s of [1, -1]) wheel(h, P, 0.4, 0.3, x, 0.4, s * 0.72, s, { seg: 12 });
  // angular fender boxes over the wheels
  for (const s of [1, -1]) {
    h.add(G.chamferBox(0.9, 0.16, 0.4, 0.04), P.base, 1.15, 0.94, s * 0.74, s * 0.2);
    h.add(G.chamferBox(0.85, 0.16, 0.4, 0.04), P.base, -1.0, 0.94, s * 0.74, s * 0.2);
    h.rod(P.lamp, 0.07, 0.1, 1.64, 0.96, s * 0.4, 0, 0, 0);
    h.box(P.wood, 0.7, 0.035, 0.035, 0.2, 1.0, s * 0.72); h.box(P.steel, 0.14, 0.03, 0.1, 0.55, 1.0, s * 0.72);
    h.box(P.light, 0.5, 0.56, 0.03, 0.0, 1.15, s * 0.66, -s * 0.22, 0, 0);
    sideMark(h, P, fac, 0.26, -0.7, 1.22, 0.6, s, 0.22);
  }
  h.box(P.deep, 0.05, 0.22, 0.7, 1.77, 0.7, 0); // radiator louvers
  h.box(P.black, 0.04, 0.08, 0.34, 0.5, 1.2, 0, 0, 0, -0.5);
  slopeMark(h, P, fac, 0.2, 1.05, 1.1, -0.15);
  // the spare wheel on the rear plate and the aerial
  h.mat(tireGeo(0.34, 0.2, 12), P.rubber, G.xf(-1.86, 1.1, 0.0, 0, -Math.PI / 2, 0));
  h.mat(hubGeo(0.34, 0.2, 12), P.mid, G.xf(-1.86, 1.1, 0.0, 0, -Math.PI / 2, 0));
  h.mat(G.tube([[-1.5, 1.3, 0.5], [-1.5, 2.2, 0.5]], 0.012, { radial: 5 }), P.steel);

  // a small faceted turret set back from the middle, a DT in a ball mount, a hatch ring in the roof
  const bot = [[0.58, 0.26], [0.4, 0.56], [-0.4, 0.56], [-0.58, 0.26], [-0.58, -0.26], [-0.4, -0.56], [0.4, -0.56], [0.58, -0.26]];
  const top = bot.map(([x, z]) => [x * 0.66, z * 0.66]);
  t.mat(frustum(bot, top, 0, 0.58, {}), P.base);
  t.mat(G.lathe([[0.2, 0], [0.24, 0], [0.24, 0.06], [0.2, 0.06], [0.2, 0]], 10), P.light, G.xf(-0.04, 0.58, 0));
  t.add(G.chamferBox(0.2, 0.22, 0.28, 0.03), P.light, 0.55, 0.32, 0);
  t.mat(G.barrel(0.9, 0.028, { segments: 8 }), P.gun, G.xf(0.64, 0.32, 0));
  t.box(P.black, 0.06, 0.1, 0.04, 0.34, 0.46, 0.3);
  t.box(P.owner, 0.2, 0.02, 0.32, -0.24, 0.585, 0);
  t.mat(insignia(P, fac, 0.16), P.white, place([0.08, 0.585, 0], [0, 1, 0], [1, 0, 0]));

  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.56, dark: 0.74 }),
    turretAt: [-0.45, 1.56, 0], tip: [1.55, 0.32, 0],
  };
}

// ---------------------------------------------------------------- half-tracks

// the convex outline of circles ([cx, cy, r]) as [x, y] points, counter-clockwise
function hull2(circles, n = 8) {
  const pts = [];
  for (const [cx, cy, r] of circles) for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-12) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 1e-12) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return [...lo, ...up];
}

// One track run of a half-track at z = s * z: a belt around the sprocket (the first wheel, at the front), the idler
// (the last) and the road wheels, with those wheels showing through it. wheels: [x, y, R]. The belt rests on y = 0.
function trackRun(p, P, s, z, w, wheels, hub) {
  const pad = 0.065, key = `run|${w}|${wheels.join()}`;
  const belt = once(key, () => G.extrudeProfile(hull2(wheels.map(([x, y, R]) => [x, y, R + pad])), w, 0.03, { holes: [hull2(wheels.map(([x, y, R]) => [x, y, R]))], segments: 1, crease: 30 }));
  p.mat(belt, P.tread, G.xf(0, 0, s * z));
  wheels.forEach(([x, y, R], i) => roadWheel(p, R * 0.96, w * 0.62, x, y, s * z, s, i === 0 ? P.light : hub));
  // bogie arms between pairs of road wheels
  const lo = wheels.filter((_, i) => i > 0 && i < wheels.length - 1);
  for (let i = 0; i + 1 < lo.length; i += 2) p.box(P.steel, Math.abs(lo[i][0] - lo[i + 1][0]), 0.05, 0.05, (lo[i][0] + lo[i + 1][0]) / 2, lo[i][1] + 0.05, s * (z - w * 0.32));
}

// ---------------------------------------------------------------- M16 half-track

function m16(P, fac) {
  const h = parts(), t = parts();
  // chassis, hood, and the two tubs: the cab and the troop compartment
  h.box(P.deep, 4.5, 0.14, 1.3, -0.1, 0.62, 0);
  h.mat(hullOf([
    [2.3, [0.5, 0.64], [0.62, 0.9], [0.5, 1.12]],
    [1.9, [0.6, 0.62], [0.74, 0.9], [0.6, 1.2]],
    [1.0, [0.65, 0.6], [0.82, 0.95], [0.66, 1.24]],
  ], 36), P.base);
  tub(h, P.base, P.deep, P.light, -0.05, 1.05, 0.88, 0.5, 1.28, 0.07);
  tub(h, P.base, P.deep, P.light, -2.42, -0.05, 0.92, 0.5, 1.54, 0.07);
  h.box(P.deep, 2.2, 0.05, 1.7, -1.2, 0.74, 0); h.box(P.deep, 1.0, 0.05, 1.7, 0.5, 0.74, 0);
  h.box(P.dark, 0.34, 0.26, 0.7, 0.2, 0.9, 0); h.box(P.tan, 0.3, 0.07, 0.7, 0.2, 1.05, 0); // bench seat
  h.mat(G.lathe([[0.14, 0], [0.17, 0], [0.17, 0.03], [0.14, 0.03], [0.14, 0]], 8), P.steel, G.xf(0.82, 1.1, 0.3, 0, 0, -0.7));
  h.box(P.base, 0.4, 0.07, 1.78, 1.0, 1.28, 0); // cowl
  for (const s of [1, -1]) h.box(P.glass, 0.03, 0.24, 0.7, 1.08, 1.45, s * 0.43, 0, 0, 0.2);
  h.box(P.steel, 0.05, 0.05, 1.82, 1.08, 1.6, 0, 0, 0, 0.2); h.box(P.steel, 0.05, 0.26, 0.05, 1.08, 1.45, 0, 0, 0, 0.2);
  // wheels: the front pair on an axle, the half-track runs behind
  for (const s of [1, -1]) wheel(h, P, 0.46, 0.3, 1.55, 0.46, s * 0.9, s, { seg: 12 });
  for (const s of [1, -1]) trackRun(h, P, s, 0.78, 0.34, [[0.62, 0.52, 0.27], [0.05, 0.2, 0.15], [-0.55, 0.2, 0.15], [-1.15, 0.2, 0.15], [-1.75, 0.2, 0.15], [-2.15, 0.32, 0.25]], P.mid);
  // fenders, grille, bumper, lamps, a jerrycan, the insignia
  for (const s of [1, -1]) {
    h.add(G.chamferBox(1.2, 0.07, 0.4, 0.025), P.base, 1.6, 1.04, s * 0.98);
    h.box(P.base, 0.34, 0.06, 0.4, 2.3, 0.92, s * 0.98, 0, 0, -0.6);
    h.rod(P.lamp, 0.07, 0.1, 2.15, 1.0, s * 0.72, 0, 0, 0);
    h.box(P.dark, 0.5, 0.3, 0.05, 0.2, 1.1, s * 0.93); h.box(P.wood, 0.9, 0.035, 0.035, -1.2, 1.2, s * 0.96);
    sideMark(h, P, fac, 0.32, -1.2, 1.0, 0.92, s, 0);
  }
  h.box(P.deep, 0.05, 0.4, 0.78, 2.3, 0.88, 0);
  for (let i = 0; i < 4; i++) h.box(P.steel, 0.03, 0.025, 0.7, 2.31, 0.74 + i * 0.1, 0);
  h.box(P.steel, 0.16, 0.16, 1.8, 2.36, 0.66, 0);
  p_markHood(h, P, fac);
  h.box(P.tan, 0.4, 0.14, 0.34, -2.1, 1.6, 0.45); h.box(P.rust, 0.34, 0.22, 0.2, -2.2, 1.6, -0.45);
  h.mat(G.tube([[-2.3, 1.52, 0.86], [-2.3, 2.5, 0.86]], 0.012, { radial: 5 }), P.steel);

  // the quad .50 mount: a pedestal, a gun cradle between two ammo racks, two pairs of barrels raised forward
  const el = 0.62, c = Math.cos(el), sn = Math.sin(el), L = 1.15, y0 = 1.12;
  t.add(CYL8, P.steel, 0, 0.3, 0, 0, 0, 0, 0.3, 0.6, 0.3);
  t.add(G.chamferBox(0.8, 0.55, 0.7, 0.05), P.base, 0.05, 0.86, 0);
  t.add(G.chamferBox(0.1, 0.8, 1.1, 0.03), P.light, -0.4, 1.06, 0);
  for (const s of [1, -1]) {
    t.box(P.dark, 0.44, 0.32, 0.32, -0.05, 0.52, s * 0.62); t.box(P.dark, 0.44, 0.32, 0.32, -0.05, 0.86, s * 0.62); t.box(P.tan, 0.38, 0.3, 0.3, -0.05, 1.2, s * 0.62);
    for (const [z, dy] of [[0.2, 0.07], [0.42, -0.07]]) {
      t.rod(P.gun, 0.034, L, 0.45 + (c * L) / 2, y0 + dy * c + (sn * L) / 2, s * z, 0, 0, el);
      t.add(CYL8, P.steel, 0.45 + c * (L + 0.04), y0 + dy * c + sn * (L + 0.04), s * z, 0, 0, el - Math.PI / 2, 0.055, 0.1, 0.055);
    }
  }
  t.box(P.steel, 0.3, 0.2, 0.7, 0.38, y0, 0);
  t.box(P.owner, 0.2, 0.02, 0.5, -0.15, 1.14, 0);
  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.7, dark: 0.74 }),
    turretAt: [-1.25, 0.74, 0], tip: [0.45 + c * (L + 0.12), y0 + sn * (L + 0.12), 0],
  };
}
// the star on the folded armor over the hood
function p_markHood(h, P, fac) { slopeMark(h, P, fac, 0.3, 1.55, 1.2, -0.12); }

// ---------------------------------------------------------------- Panzerwerfer 42 on the Maultier

// ten rocket tubes in two rows of five along +x, open at the front; the bundle is centered on the origin
function tubeBundle(p, P, len, r, gap, rows = 2, cols = 5) {
  const tube = once(`wtube|${len}|${r}`, () => G.lathe([[r, 0], [r, len], [r * 0.78, len], [r * 0.78, len - 0.14], [0, len - 0.14]], 8, { axis: 'x' }));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) p.mat(tube, j ? P.base : P.light, G.xf(0, (j - (rows - 1) / 2) * gap, (i - (cols - 1) / 2) * gap));
  for (const x of [len * 0.15, len * 0.5, len * 0.85]) p.box(P.steel, 0.07, rows * gap + 0.04, cols * gap + 0.04, x, 0, 0);
}

function panzerwerfer(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 4.8, 0.14, 1.3, 0.0, 0.64, 0);
  // armored cab with its sloped front, the short hood
  h.mat(hullOf([
    [-0.2, [0.84, 0.64], [0.92, 1.2], [0.8, 2.14]],
    [1.0, [0.84, 0.64], [0.92, 1.2], [0.8, 2.14]],
    [1.28, [0.8, 0.64], [0.9, 1.15], [0.74, 1.64]],
    [1.5, [0.72, 0.64], [0.84, 1.05], [0.66, 1.52]],
    [2.2, [0.66, 0.7], [0.8, 1.0], [0.6, 1.46]],
    [2.42, [0.6, 0.78], [0.74, 1.0], [0.54, 1.36]],
  ], 36), P.base);
  for (const s of [1, -1]) {
    h.box(P.black, 0.03, 0.07, 0.3, 1.14, 1.88, s * 0.36, 0, 0, 0.45);
    h.box(P.black, 0.05, 0.06, 0.36, 0.5, 1.8, s * 0.86);
    sideMark(h, P, fac, 0.28, 0.3, 1.3, 0.9, s, 0.03);
  }
  h.box(P.deep, 0.05, 0.5, 0.62, 2.43, 1.0, 0);
  for (let i = 0; i < 5; i++) h.box(P.steel, 0.03, 0.03, 0.56, 2.45, 0.82 + i * 0.1, 0);
  h.box(P.steel, 0.16, 0.16, 1.7, 2.48, 0.68, 0);
  tub(h, P.base, P.deep, P.light, -2.45, -0.2, 0.92, 0.9, 1.42, 0.06);
  // sand camouflage bands over the grey: on the cab sides and roof, the bed sides and the hood
  for (const s of [1, -1]) {
    for (const [x, y, len, tilt] of [[0.1, 1.5, 0.8, 0.5], [0.6, 1.85, 0.7, -0.45], [0.35, 1.1, 0.7, 0.2]]) h.box(P.sand, len, 0.17, 0.014, x, y, s * (0.92 - 0.128 * (y - 1.2) / 0.94 + 0.007), 0, 0, tilt);
    h.box(P.sand, 0.8, 0.16, 0.014, -1.0, 1.2, s * 0.935, 0, 0, 0.25); h.box(P.sand, 0.6, 0.15, 0.014, -2.0, 1.28, s * 0.935, 0, 0, -0.3);
    h.box(P.sand, 0.5, 0.012, 0.3, 0.3, 2.145, s * 0.32); h.box(P.sand, 0.3, 0.012, 0.5, 1.9, 1.47, s * 0.0);
  }
  h.box(P.deep, 2.3, 0.06, 1.8, -1.3, 1.0, 0);
  for (const s of [1, -1]) { h.box(P.rust, 0.6, 0.3, 0.3, -0.45, 1.2, s * 0.62); h.box(P.dark, 0.5, 0.2, 0.3, -2.0, 1.15, s * 0.55); }
  h.mat(G.tube([[0.9, 2.14, 0.7], [0.9, 2.9, 0.78]], 0.012, { radial: 5 }), P.steel);
  // wheels and runs: five big road wheels in each
  for (const s of [1, -1]) {
    wheel(h, P, 0.46, 0.3, 1.7, 0.46, s * 0.9, s, { seg: 12 });
    h.add(G.chamferBox(1.3, 0.07, 0.4, 0.025), P.base, 1.7, 1.06, s * 1.0);
    h.box(P.base, 0.34, 0.06, 0.4, 2.4, 0.94, s * 1.0, 0, 0, -0.6);
    h.rod(P.lamp, 0.07, 0.1, 2.3, 1.0, s * 0.74, 0, 0, 0);
    trackRun(h, P, s, 0.78, 0.34, [[0.45, 0.52, 0.3], [-0.2, 0.3, 0.26], [-0.82, 0.3, 0.26], [-1.44, 0.3, 0.26], [-2.06, 0.3, 0.26]], P.light);
  }

  // the launcher on a turntable at the back of the bed: ten tubes in two rows of five, raised toward the front
  const el = 0.7, c = Math.cos(el), sn = Math.sin(el), len = 1.9, hinge = [-0.4, 0.66], start = 0.5;
  t.add(CYL8, P.steel, 0, 0.06, 0, 0, 0, 0, 0.5, 0.12, 0.5);
  t.add(G.chamferBox(0.5, 0.4, 0.56, 0.04), P.dark, 0, 0.32, 0);
  for (const s of [1, -1]) t.mat(G.tube([[-0.1, 0.4, s * 0.4], [hinge[0] + 0.9 * c, hinge[1] + 0.9 * sn - 0.2, s * 0.52]], 0.05, { radial: 6 }), P.steel);
  const bundle = parts();
  tubeBundle(bundle, P, len, 0.14, 0.3);
  for (const it of bundle.list) t.mat(it.geo, it.color, G.xf(hinge[0], hinge[1], 0, 0, 0, el).multiply(G.xf(start, 0, 0)).multiply(it.matrix));
  t.box(P.owner, 0.5, 0.02, 0.4, 0, 0.125, 0);
  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.9, dark: 0.74 }),
    turretAt: [-1.1, 1.03, 0], tip: [hinge[0] + c * (start + len), hinge[1] + sn * (start + len), 0],
  };
}

// ---------------------------------------------------------------- Katyusha on a Studebaker

function katyusha(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 5.0, 0.18, 1.0, -0.1, 0.8, 0);
  // hood and grille, the cab with windshield panes and side windows
  h.mat(hullOf([
    [2.6, [0.52, 0.78], [0.62, 1.05], [0.5, 1.46]],
    [2.25, [0.56, 0.74], [0.74, 1.05], [0.56, 1.58]],
    [1.2, [0.6, 0.72], [0.8, 1.08], [0.6, 1.6]],
  ], 36), P.base);
  h.mat(hullOf([
    [1.2, [0.86, 0.72], [0.9, 1.1], [0.8, 1.7]],
    [0.98, [0.86, 0.72], [0.9, 1.1], [0.8, 2.12]],
    [-0.25, [0.86, 0.72], [0.9, 1.1], [0.8, 2.12]],
  ], 36), P.base);
  for (const s of [1, -1]) {
    h.box(P.glass, 0.03, 0.34, 0.6, 1.09, 1.9, s * 0.4, 0, 0, 0.42);
    h.box(P.glass, 0.55, 0.36, 0.03, 0.45, 1.75, s * 0.855);
    h.box(P.steel, 0.9, 0.05, 0.3, 0.5, 0.82, s * 1.0);
    sideMark(h, P, fac, 0.24, 0.5, 1.2, 0.9, s, 0.05);
    h.rod(P.lamp, 0.075, 0.1, 2.38, 1.14, s * 0.72, 0, 0, 0);
    h.add(G.chamferBox(1.3, 0.07, 0.46, 0.025), P.base, 1.6, 1.1, s * 1.0);
    h.box(P.base, 0.3, 0.06, 0.46, 2.3, 1.0, s * 1.0, 0, 0, -0.55);
    h.add(G.chamferBox(2.3, 0.07, 0.42, 0.025), P.base, -1.5, 1.1, s * 1.0);
  }
  for (let i = 0; i < 6; i++) h.box(P.steel, 0.03, 0.44, 0.04, 2.62, 1.08, (i - 2.5) * 0.15);
  h.box(P.steel, 0.18, 0.18, 1.9, 2.66, 0.8, 0);
  h.mat(spareTire(), P.rubber, G.xf(-0.3, 1.3, 0.76));
  h.mat(G.tube([[0.2, 2.12, 0.84], [0.2, 2.9, 0.92]], 0.012, { radial: 5 }), P.steel);
  // the deck and its sides
  h.box(P.deep, 2.5, 0.08, 1.8, -1.45, 1.0, 0);
  for (const s of [1, -1]) h.box(P.base, 2.5, 0.2, 0.06, -1.45, 1.1, s * 0.9);
  h.box(P.base, 0.06, 0.2, 1.8, -2.7, 1.1, 0);
  // wheels: the front axle and the rear pair
  for (const x of [1.6, -0.95, -2.05]) for (const s of [1, -1]) wheel(h, P, 0.5, 0.34, x, 0.5, s * 0.86, s, { seg: 10 });
  for (const s of [1, -1]) h.box(P.steel, 0.1, 0.5, 0.1, -2.7, 0.82, s * 0.7); // jacks

  // the launcher: a turntable and truss, eight rails raised toward the front, rockets on the back half of the rails
  const el = 0.45, c = Math.cos(el), sn = Math.sin(el), RL = 4.0, H = [-1.6, 0.5];
  t.add(CYL8, P.steel, 0, 0.06, 0, 0, 0, 0, 0.45, 0.12, 0.45);
  for (const s of [1, -1]) {
    t.box(P.dark, 0.1, 0.5, 0.1, H[0], 0.32, s * 0.5);
    t.mat(G.tube([[0.2, 0.1, s * 0.5], [H[0] + 0.55 * RL * c, H[1] + 0.55 * RL * sn - 0.05, s * 0.5]], 0.05, { radial: 6 }), P.base);
    t.mat(G.tube([[-0.5, 0.1, s * 0.5], [H[0] + 0.3 * RL * c, H[1] + 0.3 * RL * sn - 0.05, s * 0.5]], 0.04, { radial: 6 }), P.base);
  }
  const rails = parts();
  for (let i = 0; i < 8; i++) {
    const z = (i - 3.5) * 0.23;
    rails.box(P.light, RL, 0.24, 0.035, RL / 2, 0, z); rails.box(P.base, RL, 0.035, 0.12, RL / 2, 0.13, z); rails.box(P.base, RL, 0.035, 0.12, RL / 2, -0.13, z);
    rails.mat(rocket(), P.white, G.xf(0.1, 0.13 + 0.07, z));
  }
  for (const it of rails.list) t.mat(it.geo, it.color, G.xf(H[0], H[1], 0, 0, 0, el).multiply(it.matrix));
  t.box(P.owner, 0.5, 0.02, 0.4, 0, 0.125, 0);
  return {
    hull: finish(merge(h.list), { height: 1.0 }), turret: finish(merge(t.list), { floor: 0, height: 0.7, dark: 0.74 }),
    turretAt: [-1.3, 1.04, 0], tip: [H[0] + c * RL, H[1] + sn * RL, 0],
  };
}
// a spare tire standing against the cab, axle along z
const spareTire = () => once('spare', () => G.lathe([[0.2, 0.1], [0.38, 0.12], [0.44, 0.08], [0.44, -0.08], [0.38, -0.12], [0.2, -0.1], [0.2, 0.1]], 12, { axis: 'z' }));
// an M-13 rocket along +x, tail at x = 0, nose at x = 1.45, with fins
function rocket() {
  return once('m13', () => {
    const body = G.lathe([[0, 0], [0.04, 0], [0.065, 0.1], [0.065, 1.1], [0.045, 1.36], [0, 1.45]], 6, { axis: 'x' });
    const fin = new THREE.BoxGeometry(0.2, 0.012, 0.15);
    return G.merge([{ geo: body, color: col(0xb4b9bb) }, { geo: fin, color: col(0x2c2c2a), matrix: G.xf(0.08, 0, 0) }, { geo: fin, color: col(0x2c2c2a), matrix: G.xf(0.08, 0, 0, Math.PI / 2, 0, 0) }]);
  });
}

// ---------------------------------------------------------------- the registry

const BUILD = {
  armoredcar: [m8, sdkfz222, ba64],
  flaktrack: [m16, null, null],
  rocket: [null, panzerwerfer, katyusha],
};

const FIT = { 'rocket|2': 0.92 };
const cache = new Map();
// The hull and turret geometries of a wheeled unit: { hull, turret, turretAt, tip } (turretAt is the traverse pivot on
// the hull, tip the muzzle point in the turret's own space). look: { vehicle, color } as hex numbers. Cached, shared.
export function wheeledModel(type, fac, look) {
  const key = `${type}|${fac}|${look.vehicle}|${look.color}`;
  let m = cache.get(key);
  if (!m) {
    m = BUILD[type][fac](paints(look, fac), fac);
    const k = FIT[`${type}|${fac}`]; // the whole model shrunk to keep the footprint near the old one
    if (k) { m.hull.scale(k, k, k); m.turret.scale(k, k, k); m.turretAt = m.turretAt.map((v) => v * k); m.tip = m.tip.map((v) => v * k); m.hull.computeBoundingSphere(); m.turret.computeBoundingSphere(); }
    cache.set(key, m);
  }
  return m;
}
