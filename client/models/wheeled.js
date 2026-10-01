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
  // The game's warm sun (and the Neutral tone mapper, which subtracts the darkest channel) crush the blue out of any dark
  // olive and leave it mustard, and Panzer grey goes navy in the shade. So the paints are lifted and pulled toward grey,
  // with the blue kept up: lit by the sun the US paint reads olive drab (about 83,78,34), the Soviet one a cooler green
  // (76,84,42) and the German one a warm grey (62,52,44); in shade they stay dark green and dark grey.
  const base = col([0x7c8872, 0x686c74, 0x78887a][fac] ?? look.vehicle);
  const sand = col(0xa09462);
  return {
    base, mid: shade(base, 0.84), dark: shade(base, 0.66), deep: shade(base, 0.42), light: shade(base, 1.16), pale: shade(base, 1.4),
    owner: col(look.color), rubber: col(0x2b2b2a), tread: col(0x383631), steel: col(0x3c3b37), gun: col(0x2d2d2b), glass: col(0x55676f),
    tan: col(0x8f7d55), wood: col(0x74522f), lamp: col(0xeee6c4), lens: col(0xb8b29a), black: col(0x1c1b18), red: col(0xc23a2a), chalk: col(0xece6d6),
    rust: col(0x6a4a34), white: col(0xffffff), silver: col(0x9aa0a2), sand, camo: base.clone().lerp(sand, 0.5),
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
// a flat ring facing +z at depth z, between radii r0 and r1 (the face of a wheel disc, a dark recess)
function annulus(r0, r1, z, seg) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
    pos.push(r1 * c, r1 * s, z, r0 * c, r0 * s, z); nor.push(0, 0, 1, 0, 0, 1);
  }
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; idx.push(2 * i, 2 * j, 2 * j + 1, 2 * i, 2 * j + 1, 2 * i + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
// Wheels: a dark knobbly tire (every other angular step sits lower, so the silhouette has lugs) around a painted disc
// with a domed cap, axle along z, outer face at +z. side -1 mirrors it. The inner sidewall is left open (it faces the hull).
function tireGeo(R, w, seg) {
  return once(`tire|${R}|${w}|${seg}`, () => {
    const h = w / 2, g = G.lathe([[R * 0.6, h * 0.96], [R * 0.9, h], [R, h * 0.72], [R, -h * 0.72], [R * 0.9, -h * 0.9]], seg, { axis: 'z' });
    const P = g.attributes.position, step = TAU / seg;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), r = Math.hypot(x, y);
      if (r < R * 0.8) continue;
      if (Math.round((Math.atan2(y, x) + Math.PI / 2) / step) & 1) P.setXY(i, x * 0.93, y * 0.93);
    }
    return G.crease(g, 50);
  });
}
const discGeo = (R, w, seg) => once(`disc|${R}|${w}|${seg}`, () => annulus(R * 0.26, R * 0.64, (w / 2) * 0.8, seg));
const capGeo = (R, w, seg) => once(`cap|${R}|${w}|${seg}`, () => { const h = w / 2; return G.lathe([[R * 0.27, h * 0.8], [R * 0.2, h], [R * 0.12, h * 1.1], [0, h * 1.14]], seg, { axis: 'z' }); });
function wheel(p, P, R, w, x, y, z, side = 1, { seg = 12, hub = P.mid, cap = P.light, tire = P.rubber, ry = 0 } = {}) {
  const m = G.xf(x, y, z, 0, ry, 0, 1, 1, side);
  p.mat(tireGeo(R, w, seg), tire, m);
  p.mat(discGeo(R, w, 12), hub, m);
  p.mat(capGeo(R, w, 12), cap, m);
}
// a flat road wheel for the half-track runs: a painted disc with a hub boss and a rim band, axle along z; recess
// paints a dark ring in the face (the lightening holes of a spoked wheel)
function roadWheel(p, R, w, x, y, z, side, paint, recess = null) {
  const m = G.xf(x, y, z, 0, 0, 0, 1, 1, side);
  p.mat(once(`road|${R}|${w}`, () => G.lathe([[0, w * 0.5], [R * 0.22, w * 0.5], [R * 0.3, w * 0.3], [R, w * 0.3], [R, 0]], 8, { axis: 'z' })), paint, m);
  if (recess) p.mat(once(`recess|${R}|${w}`, () => annulus(R * 0.4, R * 0.76, w * 0.306, 8)), recess, m);
}
// a toothed drive sprocket: a gear outline with `teeth` teeth, axle along z
function gearWheel(p, R, w, x, y, z, side, paint, teeth = 6) {
  const m = G.xf(x, y, z, 0, 0, 0, 1, 1, side);
  p.mat(once(`gear|${R}|${w}|${teeth}`, () => {
    const pts = [];
    for (let k = 0; k < teeth; k++) for (const [f, r] of [[-0.3, 0.8], [0, 1], [0.3, 0.8]]) { const a = (k + f) * (TAU / teeth); pts.push([R * r * Math.cos(a), R * r * Math.sin(a)]); }
    return G.extrudeProfile(pts, w * 0.55, 0, { segments: 1, crease: 30 });
  }), paint, m.clone().multiply(G.xf(0, 0, w * 0.1)));
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

// a hull cross-section from three corners (half width, height): bottom, widest side and top shoulder, mirrored in z.
// An optional fourth corner u between the side and the shoulder rounds the roof edge.
const ringOf = (b, m, t, u) => (u
  ? [b, m, u, t, [-t[0], t[1]], [-u[0], u[1]], [-m[0], m[1]], [-b[0], b[1]]]
  : [[b[0], b[1]], [m[0], m[1]], [t[0], t[1]], [-t[0], t[1]], [-m[0], m[1]], [-b[0], b[1]]]);
const hullOf = (stations, normals = 38) => G.loft(stations.map(([x, b, m, t, u]) => ({ x, pts: ringOf(b, m, t, u) })), { normals });

// Painted-miniature finish on a merged geometry: top faces a little lighter (dry brush), darker toward the floor and
// on downward faces (shadow in the crevices, kept soft so the shaded sides stay the paint's own hue).
function finish(geo, { floor = 0, height = 1.1, dark = 0.8, under = 0.12, top = 0.18 } = {}) {
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

// a headlamp pointing along +x: a dark housing with a small inset lens
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
function lamp(p, P, x, y, z, r = 0.065, len = 0.1) {
  p.add(CYL6, P.dark, x, y, z, 0, 0, Math.PI / 2, r, len, r);
  p.add(CYL6, P.lens, x + len / 2, y, z, 0, 0, Math.PI / 2, r * 0.62, 0.025, r * 0.62);
}
// three steel bars in front of a lamp
function guard(p, P, x, y, z, h = 0.16) { for (const dz of [-0.07, 0, 0.07]) p.box(P.steel, 0.02, h, 0.02, x, y, z + dz); }
// A mudguard that follows a wheel: n short boxes along an arc of radius R + gap around the wheel center (x, yc), from
// a0 to a1 degrees (0 is straight up, forward is positive), `width` across at z.
function fender(p, color, x, yc, z, R, width, a0, a1, n, { gap = 0.07, th = 0.04 } = {}) {
  const Rg = R + gap, d = ((a1 - a0) / n) * (Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const a = (a0 * Math.PI) / 180 + d * (i + 0.5);
    p.box(color, 2 * Rg * Math.tan(d / 2) + 0.05, th, width, x + Rg * Math.sin(a), yc + Rg * Math.cos(a), z, 0, 0, -a);
  }
}
// the owner's color as a flat ring along the edge of a roof or a tub: a deliberate unit marking, seen from above
const ownerRing = (p, color, outline, y, k = 0.9) => p.mat(rim(outline, outline.map(([x, z]) => [x * k, z * k]), y), color);
// A flat patch (camouflage) on a side wall: a polygon of [x, y] points, on the wall that is at half width zRef at
// height yRef and leans in by k per unit of height; ry follows a wall that narrows along x. s picks the side.
function patch(p, color, pts, yRef, zRef, k, s, ry = 0) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y - yRef))));
  p.mat(geo, color, G.xf(0, yRef, s * (zRef + 0.007), -s * Math.atan(k), s * ry, 0, 1, 1, s));
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
    wheel(h, P, 0.44, 0.34, x, 0.44, s * 1.02, s, { seg: 16 });
    h.add(G.chamferBox(0.95, 0.05, 0.24, 0.02), P.base, x, 0.95, s * 1.06);
  }
  // driver's vision slits, the bumper, headlamps set into the nose behind brush guards, tow shackles
  for (const s of [1, -1]) {
    h.box(P.black, 0.04, 0.07, 0.3, 1.74, 1.13, s * 0.36, 0, 0, -0.62);
    lamp(h, P, 2.2, 0.93, s * 0.52); guard(h, P, 2.29, 0.93, s * 0.52);
    h.box(P.steel, 0.08, 0.12, 0.1, 2.2, 0.66, s * 0.38);
  }
  h.box(P.steel, 0.1, 0.12, 1.5, 2.17, 0.8, 0);
  slopeMark(h, P, fac, 0.3, 1.78, 1.153, -0.545); // the star on the glacis
  // rear deck: a grille, stowage and the aerial
  for (const x of [-0.85, -1.35]) { h.box(P.deep, 0.42, 0.03, 0.9, x, 1.415, 0); for (let i = 0; i < 4; i++) h.box(P.dark, 0.03, 0.02, 0.9, x - 0.15 + i * 0.1, 1.43, 0); }
  h.add(CYL8, P.tan, -1.88, 1.52, 0, Math.PI / 2, 0, 0, 0.13, 1.1, 0.13); h.box(P.wood, 0.4, 0.22, 0.4, -1.5, 1.5, 0.45); h.box(P.rust, 0.3, 0.24, 0.3, -1.55, 1.52, -0.45);
  h.mat(G.tube([[-1.9, 1.4, 0.72], [-1.9, 2.5, 0.72]], 0.012, { radial: 5 }), P.steel);
  // side stowage: shovel, pick handle, a box and a fuel can
  for (const s of [1, -1]) {
    h.box(P.wood, 0.9, 0.05, 0.05, -0.6, 1.0, s * 1.0); h.box(P.steel, 0.22, 0.05, 0.14, 0.0, 1.0, s * 1.0); h.box(P.dark, 0.3, 0.3, 0.14, -1.0, 1.2, s * 1.0);
    h.box(P.light, 0.55, 0.45, 0.03, -0.2, 1.05, s * 0.99);
  }

  // turret: a low octagon in plan with near-vertical sides, an open roof with a ring mount on four posts and a .50 on
  // it, a 37 mm gun in a round mantlet sleeve
  const TH = 0.5, bot = [[0.82, 0.36], [0.58, 0.74], [-0.5, 0.74], [-0.78, 0.44], [-0.78, -0.44], [-0.5, -0.74], [0.58, -0.74], [0.82, -0.36]];
  const top = bot.map(([x, z]) => [x * 0.88 + 0.02, z * 0.86]);
  t.mat(frustum(bot, top, 0, TH, { hole: circ(0.36, 12, -0.02, 0) }), P.base);
  ownerRing(t, P.owner, top, TH + 0.004);
  t.disc(P.deep, 0.35, -0.02, 0.28, 0);
  t.mat(G.lathe([[0.38, 0], [0.44, 0], [0.44, 0.14], [0.38, 0.14], [0.38, 0]], 12), P.light, G.xf(-0.02, TH + 0.1, 0));
  for (const [px, pz] of [[0.28, 0.28], [0.28, -0.28], [-0.32, 0.28], [-0.32, -0.28]]) t.box(P.steel, 0.05, 0.12, 0.05, px, TH + 0.04, pz);
  t.box(P.gun, 0.38, 0.09, 0.09, -0.22, 0.9, 0); t.rod(P.gun, 0.022, 0.55, 0.14, 0.9, 0, 0, 0, 0.04); t.box(P.base, 0.2, 0.18, 0.14, -0.34, 0.8, 0.28);
  t.box(P.gun, 0.06, 0.3, 0.06, -0.22, 0.76, 0);
  t.rod(P.mid, 0.11, 0.38, 0.93, 0.3, 0); // the mantlet sleeve
  t.mat(G.barrel(1.55, 0.06, { segments: 8 }), P.mid, G.xf(0.95, 0.3, 0));
  t.box(P.gun, 0.4, 0.05, 0.05, 1.2, 0.3, 0.17); // coax
  t.add(G.chamferBox(0.34, 0.26, 0.5, 0.04), P.mid, -0.9, 0.34, 0); // turret bustle stowage
  for (const s of [1, -1]) sideMark(t, P, fac, 0.3, 0.06, 0.26, 0.74 - 0.208 * 0.26, s, 0.208); // the star on the turret flanks

  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.6 }),
    turretAt: [0.05, 1.4, 0], tip: [2.5, 0.3, 0],
  };
}

// ---------------------------------------------------------------- Sd.Kfz. 222

const PLANE = new THREE.PlaneGeometry(1, 1);
// a wire grenade screen: a thin frame around a dark backing panel with a fine light lattice on both faces, lying in
// the xy plane from (-hl, 0) to (hl, height)
function screen(p, P, hl, height, x, y, z, tilt) {
  const w = 0.022, nv = 12, nh = 4, sub = parts();
  sub.box(P.steel, 2 * hl, w, w, 0, 0, 0); sub.box(P.steel, 2 * hl, w, w, 0, height, 0);
  sub.box(P.steel, w, height, w, -hl, height / 2, 0); sub.box(P.steel, w, height, w, hl, height / 2, 0);
  sub.box(P.deep, 2 * hl, height, 0.008, 0, height / 2, 0);
  for (const sd of [1, -1]) {
    for (let i = 1; i < nv; i++) sub.mat(PLANE, P.light, G.xf(-hl + (2 * hl * i) / nv, height / 2, sd * 0.006, 0, sd < 0 ? Math.PI : 0, 0, 0.012, height, 1));
    for (let i = 1; i < nh; i++) sub.mat(PLANE, P.light, G.xf(0, (height * i) / nh, sd * 0.006, 0, sd < 0 ? Math.PI : 0, 0, 2 * hl, 0.012, 1));
  }
  const m = G.xf(x, y, z, tilt, 0, 0);
  for (const it of sub.list) p.mat(it.geo, it.color, m.clone().multiply(it.matrix));
}

function sdkfz222(P, fac) {
  const h = parts(), t = parts();
  // a tall faceted body: slab sides leaning in toward the deck, a pointed nose with a sloped glacis
  h.mat(hullOf([
    [-1.8, [0.5, 0.6], [0.86, 0.84], [0.62, 1.42]],
    [-1.45, [0.54, 0.44], [0.9, 0.86], [0.7, 1.5]],
    [0.55, [0.54, 0.44], [0.9, 0.86], [0.7, 1.5]],
    [1.2, [0.5, 0.46], [0.84, 0.88], [0.62, 1.3]],
    [1.75, [0.42, 0.58], [0.66, 0.9], [0.46, 1.1]],
    [2.08, [0.34, 0.7], [0.46, 0.92], [0.34, 1.0]],
  ], 34), P.base);
  // four big wheels, the long wheelbase of the real car, each under an angular two-plate arch
  for (const x of [1.45, -1.5]) for (const s of [1, -1]) {
    wheel(h, P, 0.47, 0.32, x, 0.47, s * 0.78, s, { seg: 16 });
    fender(h, P.base, x, 0.47, s * 0.78, 0.47, 0.38, -42, 42, 2);
  }
  // headlamps and marker posts on the front fenders, the bumper bar
  for (const s of [1, -1]) {
    lamp(h, P, 1.8, 0.97, s * 0.7);
    h.mat(G.tube([[1.7, 1.0, s * 0.86], [1.7, 1.36, s * 0.86]], 0.015, { radial: 5 }), P.steel);
    h.add(new THREE.SphereGeometry(0.05, 6, 4), P.steel, 1.7, 1.38, s * 0.86);
    // doors, tool boxes, jerrycans, a pioneer tool and the insignia
    h.box(P.light, 0.7, 0.5, 0.03, 0.05, 1.0, s * 0.88, -s * 0.29, 0, 0); h.box(P.dark, 0.4, 0.26, 0.12, -1.3, 1.2, s * 0.8); h.box(P.rust, 0.16, 0.36, 0.2, -1.55, 0.98, s * 0.96);
    h.box(P.steel, 0.04, 0.08, 0.03, 0.34, 1.02, s * 0.91, -s * 0.29, 0, 0); h.box(P.steel, 0.04, 0.08, 0.03, -0.24, 1.02, s * 0.91, -s * 0.29, 0, 0); // door hinges
    h.box(P.wood, 0.7, 0.035, 0.035, 0.5, 1.22, s * 0.84); h.box(P.steel, 0.16, 0.03, 0.1, 0.9, 1.22, s * 0.84);
    h.box(P.black, 0.04, 0.06, 0.28, 1.45, 1.18, s * 0.3, 0, 0, -0.55);
    sideMark(h, P, fac, 0.24, -0.5, 1.16, 0.8, s, 0.3);
  }
  h.box(P.steel, 0.07, 0.07, 1.4, 2.12, 0.66, 0);
  for (const x of [-1.2, -1.6]) h.box(P.deep, 0.34, 0.025, 0.8, x, 1.435, 0);
  slopeMark(h, P, fac, 0.26, 1.92, 1.048, -0.303); // the cross on the glacis, clear of the vision slits

  // fighting compartment: an open octagonal tub with a gun inside and a mesh screen folded out over it; its rim is the
  // owner's color
  const bot = [[0.72, 0.3], [0.5, 0.62], [-0.5, 0.62], [-0.72, 0.3], [-0.72, -0.3], [-0.5, -0.62], [0.5, -0.62], [0.72, -0.3]];
  const top = bot.map(([x, z]) => [x * 0.92, z * 0.9]);
  const inB = bot.map(([x, z]) => [x * 0.84, z * 0.84]), inT = top.map(([x, z]) => [x * 0.92, z * 0.92]);
  t.mat(frustum(bot, top, 0, 0.3, { caps: false }), P.base);
  t.mat(frustum(inB, inT, 0.02, 0.3, { caps: false, inside: true }), P.dark);
  t.mat(rim(top, inT, 0.3), P.owner);
  t.disc(P.deep, 0.55, 0, 0.04, 0);
  t.add(G.chamferBox(0.5, 0.24, 0.3, 0.03), P.steel, 0.2, 0.24, 0); t.mat(G.barrel(1.5, 0.03, { brake: true, segments: 8 }), P.gun, G.xf(0.4, 0.3, 0));
  t.box(P.deep, 0.3, 0.2, 0.26, -0.34, 0.14, 0.24); t.box(P.tan, 0.2, 0.1, 0.3, -0.38, 0.1, -0.24);
  for (const s of [1, -1]) screen(t, P, 0.58, 0.34, 0, 0.3, s * 0.5, s * 0.05);
  { const m = G.xf(-0.58, 0.3, 0, 0, Math.PI / 2, 0); const sub = parts(); screen(sub, P, 0.5, 0.34, 0, 0, 0, 0.05); for (const it of sub.list) t.mat(it.geo, it.color, m.clone().multiply(it.matrix)); }

  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.5 }),
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
  for (const x of [1.15, -1.0]) for (const s of [1, -1]) {
    wheel(h, P, 0.4, 0.3, x, 0.4, s * 0.72, s, { seg: 16 });
    fender(h, P.base, x, 0.4, s * 0.74, 0.4, 0.3, -38, 62, 4); // angular mudguards that follow the wheel
  }
  for (const s of [1, -1]) {
    lamp(h, P, 1.6, 0.96, s * 0.42, 0.06);
    h.box(P.wood, 0.7, 0.04, 0.04, 0.2, 1.0, s * 0.72); h.box(P.steel, 0.14, 0.04, 0.1, 0.55, 1.0, s * 0.72);
    h.box(P.light, 0.5, 0.56, 0.03, 0.0, 1.15, s * 0.66, -s * 0.22, 0, 0);
    sideMark(h, P, fac, 0.26, -0.7, 1.22, 0.6, s, 0.22); // one star on each upper rear side
  }
  // the armored radiator grille: a dark panel with louver slats
  h.box(P.deep, 0.05, 0.22, 0.66, 1.77, 0.76, 0);
  for (let i = 0; i < 5; i++) h.box(P.light, 0.02, 0.025, 0.58, 1.795, 0.68 + i * 0.04, 0);
  h.box(P.black, 0.04, 0.08, 0.34, 0.5, 1.2, 0, 0, 0, -0.5);
  // the spare wheel on the rear plate and the aerial
  wheel(h, P, 0.34, 0.2, -1.86, 1.1, 0, 1, { seg: 12, ry: -Math.PI / 2 });
  h.mat(G.tube([[-1.5, 1.3, 0.5], [-1.5, 2.2, 0.5]], 0.012, { radial: 5 }), P.steel);

  // a squat octagonal turret over the rear of the hull, a DT in a ball mount, a hatch ring in the roof
  const TH = 0.42, bot = [[0.56, 0.24], [0.38, 0.5], [-0.38, 0.5], [-0.56, 0.24], [-0.56, -0.24], [-0.38, -0.5], [0.38, -0.5], [0.56, -0.24]];
  const top = bot.map(([x, z]) => [x * 0.8, z * 0.8]);
  t.mat(frustum(bot, top, 0, TH, {}), P.base);
  ownerRing(t, P.owner, top, TH + 0.004, 0.9);
  t.mat(G.lathe([[0.18, 0], [0.22, 0], [0.22, 0.06], [0.18, 0.06], [0.18, 0]], 10), P.mid, G.xf(-0.06, TH, 0));
  t.add(G.chamferBox(0.16, 0.2, 0.28, 0.03), P.mid, 0.46, 0.26, 0);
  t.add(new THREE.SphereGeometry(0.075, 6, 4), P.mid, 0.54, 0.26, 0);
  t.mat(G.barrel(0.55, 0.04, { segments: 8 }), P.gun, G.xf(0.52, 0.26, 0));

  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.5 }),
    turretAt: [-0.7, 1.56, 0], tip: [1.07, 0.26, 0],
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
// (the last, raised so the top run is level) and the road wheels, with those wheels showing through it. wheels:
// [x, y, R]. The belt rests on y = 0 when y = R + pad. gear: a toothed sprocket; recess: a dark ring on the road wheels.
function trackRun(p, P, s, z, w, wheels, hub, { pad = 0.065, gear = false, recess = null } = {}) {
  const key = `run|${w}|${pad}|${wheels.join()}`;
  const belt = once(key, () => G.extrudeProfile(hull2(wheels.map(([x, y, R]) => [x, y, R + pad])), w, 0.03, { holes: [hull2(wheels.map(([x, y, R]) => [x, y, R]))], segments: 1, crease: 30 }));
  p.mat(belt, P.tread, G.xf(0, 0, s * z));
  const last = wheels.length - 1;
  wheels.forEach(([x, y, R], i) => {
    if (i === 0 && gear) gearWheel(p, R * 0.96, w, x, y, s * z, s, P.light);
    else if (i === 0) roadWheel(p, R * 0.96, w * 0.7, x, y, s * z, s, P.light);
    else if (i === last) roadWheel(p, R * 0.96, w * 0.74, x, y, s * z, s, hub);
    else roadWheel(p, R * 0.96, w * 0.62, x, y, s * z, s, hub, recess);
  });
  // bogie arms between pairs of road wheels
  const lo = wheels.filter((_, i) => i > 0 && i < last);
  for (let i = 0; i + 1 < lo.length; i += 2) p.box(P.steel, Math.abs(lo[i][0] - lo[i + 1][0]), 0.05, 0.05, (lo[i][0] + lo[i + 1][0]) / 2, lo[i][1] + 0.05, s * (z - w * 0.32));
}

// ---------------------------------------------------------------- M16 half-track

function m16(P, fac) {
  const h = parts(), t = parts();
  // chassis, hood, and the two tubs: the cab and the troop compartment (its rim is the owner's color)
  h.box(P.deep, 4.5, 0.14, 1.3, -0.1, 0.62, 0);
  h.mat(hullOf([
    [2.3, [0.5, 0.64], [0.62, 0.9], [0.5, 1.12]],
    [1.9, [0.6, 0.62], [0.74, 0.9], [0.6, 1.2]],
    [1.0, [0.65, 0.6], [0.82, 0.95], [0.66, 1.24]],
  ], 36), P.base);
  tub(h, P.base, P.deep, P.light, -0.05, 1.05, 0.88, 0.5, 1.28, 0.07);
  tub(h, P.base, P.deep, P.owner, -2.42, -0.05, 0.92, 0.5, 1.54, 0.07);
  h.box(P.deep, 2.2, 0.05, 1.7, -1.2, 0.74, 0); h.box(P.deep, 1.0, 0.05, 1.7, 0.5, 0.74, 0);
  h.box(P.dark, 0.34, 0.26, 0.7, 0.2, 0.9, 0); h.box(P.tan, 0.3, 0.07, 0.7, 0.2, 1.05, 0); // bench seat
  h.mat(G.lathe([[0.14, 0], [0.17, 0], [0.17, 0.03], [0.14, 0.03], [0.14, 0]], 8), P.steel, G.xf(0.82, 1.1, 0.3, 0, 0, -0.7));
  h.box(P.base, 0.4, 0.07, 1.78, 1.0, 1.28, 0); // cowl
  // the armored windshield: a full-width frame with posts and a pane in each half
  for (const s of [1, -1]) { h.box(P.glass, 0.03, 0.24, 0.7, 1.08, 1.45, s * 0.43, 0, 0, 0.2); h.box(P.steel, 0.05, 0.26, 0.05, 1.08, 1.45, s * 0.84, 0, 0, 0.2); }
  h.box(P.steel, 0.05, 0.05, 1.82, 1.08, 1.6, 0, 0, 0, 0.2); h.box(P.steel, 0.05, 0.26, 0.05, 1.08, 1.45, 0, 0, 0, 0.2);
  // wheels: the front pair on an axle, the half-track runs behind: a toothed sprocket, two bogies of two road wheels,
  // and a raised idler so the top run is level
  for (const s of [1, -1]) wheel(h, P, 0.46, 0.3, 1.55, 0.46, s * 0.9, s, { seg: 12 });
  for (const s of [1, -1]) trackRun(h, P, s, 0.78, 0.34, [[0.62, 0.52, 0.27], [-0.1, 0.28, 0.19], [-0.5, 0.28, 0.19], [-1.2, 0.28, 0.19], [-1.6, 0.28, 0.19], [-2.15, 0.52, 0.25]], P.mid, { pad: 0.09 });
  // curved fenders, grille, bumper roller, headlamps behind brush guards, a jerrycan, the insignia
  for (const s of [1, -1]) {
    fender(h, P.base, 1.55, 0.46, s * 0.98, 0.46, 0.4, -28, 82, 5);
    lamp(h, P, 2.0, 0.99, s * 0.72); guard(h, P, 2.09, 0.99, s * 0.72);
    h.box(P.dark, 0.5, 0.3, 0.05, 0.2, 1.1, s * 0.93); h.box(P.wood, 0.9, 0.035, 0.035, -1.2, 0.95, s * 0.96); // the pioneer tools ride low, under the star
    sideMark(h, P, fac, 0.32, -1.2, 1.2, 0.92, s, 0);
    h.box(P.steel, 0.1, 0.12, 0.08, 2.4, 0.74, s * 0.55); // tow shackles
  }
  h.box(P.deep, 0.05, 0.4, 0.78, 2.3, 0.88, 0);
  for (let i = 0; i < 4; i++) h.box(P.steel, 0.03, 0.025, 0.7, 2.31, 0.74 + i * 0.1, 0);
  h.add(CYL8, P.steel, 2.38, 0.66, 0, Math.PI / 2, 0, 0, 0.1, 1.8, 0.1); // the front roller
  slopeMark(h, P, fac, 0.3, 1.55, 1.2, -0.12); // the star on the folded armor over the hood
  h.box(P.tan, 0.4, 0.14, 0.34, -2.1, 1.6, 0.45); h.box(P.rust, 0.34, 0.22, 0.2, -2.2, 1.6, -0.45);
  h.mat(G.tube([[-2.3, 1.52, 0.86], [-2.3, 2.5, 0.86]], 0.012, { radial: 5 }), P.steel);

  // the M45 quad .50 mount: two widely separated pairs of slim barrels raised forward, ammo chests outboard, the gunner
  // between them behind two armor shield plates
  const el = 0.6, c = Math.cos(el), sn = Math.sin(el), L = 1.15, y0 = 1.1, x0 = 0.45;
  t.add(CYL8, P.steel, 0, 0.3, 0, 0, 0, 0, 0.3, 0.6, 0.3);
  t.box(P.steel, 0.3, 0.16, 1.3, 0.05, 0.7, 0);
  for (const s of [1, -1]) {
    t.add(G.chamferBox(0.64, 0.36, 0.4, 0.04), P.base, 0.13, y0 - 0.02, s * 0.43); // the receivers
    t.box(P.dark, 0.44, 0.3, 0.24, -0.05, 0.86, s * 0.71); t.box(P.tan, 0.4, 0.07, 0.26, -0.05, 1.04, s * 0.71); // ammo chests
    for (const [z, dy] of [[0.36, 0.07], [0.5, -0.07]]) {
      const ox = -sn * dy, oy = c * dy, gx = x0 + ox, gy = y0 + oy;
      t.rod(P.gun, 0.028, L, gx + (c * L) / 2, gy + (sn * L) / 2, s * z, 0, 0, el);
      t.rod(P.steel, 0.045, 0.46, gx + c * 0.23, gy + sn * 0.23, s * z, 0, 0, el); // the cooling jacket over the rear of the barrel
      t.rod(P.steel, 0.035, 0.1, gx + c * (L + 0.02), gy + sn * (L + 0.02), s * z, 0, 0, el);
    }
    t.box(P.base, 0.04, 0.7, 0.34, 0.3, 0.8, s * 0.22); // shield plate
    t.box(P.owner, 0.05, 0.07, 0.34, 0.3, 1.18, s * 0.22);
  }
  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.7 }),
    turretAt: [-1.25, 0.74, 0], tip: [x0 + c * (L + 0.12), y0 + sn * (L + 0.12), 0],
  };
}

// ---------------------------------------------------------------- Panzerwerfer 42 on the Maultier

// ten rocket tubes in two rows of five along +x, open at the front; the bundle is centered on the origin
function tubeBundle(p, P, len, r, gap, rows = 2, cols = 5) {
  const tube = once(`wtube|${len}|${r}`, () => G.lathe([[r, 0], [r, len], [r * 0.78, len], [r * 0.78, len - 0.14], [0, len - 0.14]], 8, { axis: 'x' }));
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) p.mat(tube, j ? P.light : P.base, G.xf(0, (j - (rows - 1) / 2) * gap, (i - (cols - 1) / 2) * gap));
  for (const x of [len * 0.15, len * 0.5, len * 0.85]) p.box(P.dark, 0.07, rows * gap + 0.04, cols * gap + 0.04, x, 0, 0);
}

function panzerwerfer(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 4.8, 0.14, 1.3, 0.0, 0.64, 0);
  // armored cab with its sloped front, and the long hood (a third of the vehicle) behind a vertical louvred grille
  h.mat(hullOf([
    [-0.45, [0.84, 0.64], [0.92, 1.2], [0.8, 1.95]],
    [0.65, [0.84, 0.64], [0.92, 1.2], [0.8, 1.95]],
    [0.8, [0.8, 0.64], [0.9, 1.15], [0.72, 1.6]],
    [0.95, [0.74, 0.64], [0.86, 1.08], [0.64, 1.52]],
    [2.15, [0.66, 0.7], [0.8, 1.0], [0.58, 1.44]],
    [2.42, [0.6, 0.78], [0.74, 1.0], [0.54, 1.34]],
  ], 36), P.base);
  for (const s of [1, -1]) {
    h.box(P.black, 0.03, 0.07, 0.3, 0.72, 1.76, s * 0.36, 0, 0, 0.42);
    h.box(P.black, 0.3, 0.06, 0.03, 0.2, 1.75, s * 0.83);
    sideMark(h, P, fac, 0.28, 0.1, 1.38, 0.891, s, 0.16);
  }
  h.box(P.deep, 0.05, 0.5, 0.62, 2.43, 1.0, 0);
  for (let i = 0; i < 6; i++) h.box(P.steel, 0.03, 0.44, 0.025, 2.455, 1.0, (i - 2.5) * 0.09);
  h.box(P.steel, 0.16, 0.16, 1.7, 2.48, 0.68, 0);
  tub(h, P.base, P.deep, P.owner, -2.45, -0.45, 0.92, 0.9, 1.42, 0.06);
  // broad soft camouflage blotches over the grey (the cab cross stays clear of them)
  for (const s of [1, -1]) {
    patch(h, P.camo, [[-0.4, 1.62], [-0.1, 1.55], [0.2, 1.66], [0.3, 1.85], [-0.05, 1.9], [-0.38, 1.82]], 1.2, 0.92, 0.16, s);
    patch(h, P.camo, [[0.32, 1.4], [0.5, 1.28], [0.63, 1.36], [0.62, 1.62], [0.42, 1.66]], 1.2, 0.92, 0.16, s);
    patch(h, P.camo, [[1.1, 1.12], [1.45, 1.08], [1.85, 1.2], [1.95, 1.36], [1.55, 1.4], [1.15, 1.3]].map(([x, y]) => [x, y]), 1.05, 0.82, 0.5, s, 0.043);
    patch(h, P.camo, [[-2.35, 1.0], [-2.0, 0.95], [-1.75, 1.1], [-1.9, 1.35], [-2.3, 1.38]], 0.9, 0.92, 0, s);
    patch(h, P.camo, [[-1.4, 0.98], [-1.0, 1.05], [-0.8, 1.25], [-0.95, 1.4], [-1.35, 1.32]], 0.9, 0.92, 0, s);
  }
  h.box(P.deep, 2.0, 0.06, 1.8, -1.45, 1.0, 0);
  for (const s of [1, -1]) { h.box(P.rust, 0.6, 0.3, 0.3, -0.85, 1.2, s * 0.62); h.box(P.dark, 0.5, 0.2, 0.3, -2.1, 1.15, s * 0.55); }
  h.mat(G.tube([[0.5, 1.95, 0.7], [0.5, 2.7, 0.78]], 0.012, { radial: 5 }), P.steel);
  // wheels and runs: the front pair, then in each run a toothed sprocket, four big road wheels with dark recesses and a
  // raised rear idler
  for (const s of [1, -1]) {
    wheel(h, P, 0.46, 0.3, 1.7, 0.46, s * 0.9, s, { seg: 12 });
    fender(h, P.base, 1.7, 0.46, s * 1.0, 0.46, 0.4, -28, 82, 4);
    lamp(h, P, 2.0, 0.99, s * 0.74);
    trackRun(h, P, s, 0.78, 0.34, [[0.55, 0.58, 0.3], [-0.05, 0.36, 0.3], [-0.65, 0.36, 0.3], [-1.25, 0.36, 0.3], [-1.85, 0.36, 0.3], [-2.3, 0.6, 0.26]], P.light, { gear: true, recess: P.dark });
  }

  // the launcher on a turntable on the bed: ten tubes in two rows of five, centered on the cradle and raised a little
  const el = 0.3, c = Math.cos(el), sn = Math.sin(el), len = 1.9, hinge = [0, 0.84];
  t.add(CYL8, P.steel, 0, 0.06, 0, 0, 0, 0, 0.5, 0.12, 0.5);
  t.add(G.chamferBox(0.5, 0.5, 0.56, 0.04), P.dark, 0, 0.37, 0);
  for (const s of [1, -1]) for (const dx of [-0.4, 0.4]) t.mat(G.tube([[dx, 0.3, s * 0.4], [dx * 0.3, 0.64, s * 0.5]], 0.04, { radial: 5 }), P.steel);
  const bundle = parts();
  tubeBundle(bundle, P, len, 0.14, 0.3);
  for (const it of bundle.list) t.mat(it.geo, it.color, G.xf(hinge[0], hinge[1], 0, 0, 0, el).multiply(G.xf(-len / 2, 0, 0)).multiply(it.matrix));
  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.9 }),
    turretAt: [-1.35, 1.03, 0], tip: [hinge[0] + (c * len) / 2, hinge[1] + (sn * len) / 2, 0],
  };
}

// ---------------------------------------------------------------- Katyusha on a Studebaker

function katyusha(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 5.0, 0.18, 1.0, -0.1, 0.8, 0);
  // hood and grille, the cab with rounded roof edges, windshield panes, side windows and a door line
  h.mat(hullOf([
    [2.6, [0.52, 0.78], [0.62, 1.05], [0.5, 1.46]],
    [2.25, [0.56, 0.74], [0.74, 1.05], [0.56, 1.58]],
    [1.2, [0.6, 0.72], [0.8, 1.08], [0.6, 1.6]],
  ], 36), P.base);
  h.mat(hullOf([
    [1.2, [0.86, 0.72], [0.9, 1.1], [0.72, 1.7], [0.88, 1.58]],
    [0.98, [0.86, 0.72], [0.9, 1.1], [0.72, 2.12], [0.88, 2.0]],
    [-0.25, [0.86, 0.72], [0.9, 1.1], [0.72, 2.12], [0.88, 2.0]],
  ], 36), P.base);
  for (const s of [1, -1]) {
    h.box(P.glass, 0.03, 0.34, 0.6, 1.09, 1.9, s * 0.4, 0, 0, 0.42);
    h.box(P.glass, 0.55, 0.36, 0.03, 0.45, 1.75, s * 0.855);
    h.box(P.deep, 0.02, 0.7, 0.02, -0.1, 1.45, s * 0.9); h.box(P.steel, 0.08, 0.03, 0.03, 0.78, 1.45, s * 0.9); // the door line and its handle
    h.box(P.steel, 0.9, 0.05, 0.3, 0.5, 0.82, s * 1.0);
    sideMark(h, P, fac, 0.24, 0.5, 1.2, 0.9, s, 0.05);
    // rounded fenders that follow the wheels, the headlamps on the hood sides
    fender(h, P.base, 1.6, 0.5, s * 1.0, 0.5, 0.46, -32, 62, 4);
    for (const x of [-0.95, -2.05]) fender(h, P.base, x, 0.5, s * 1.0, 0.5, 0.42, -45, 45, 3);
    lamp(h, P, 2.38, 1.14, s * 0.76, 0.07);
    h.box(P.owner, 1.0, 0.03, 0.08, -2.15, 1.215, s * 0.9); // the owner's color along the rear of the bed sides
  }
  for (let i = 0; i < 6; i++) h.box(P.steel, 0.03, 0.44, 0.04, 2.62, 1.08, (i - 2.5) * 0.15);
  h.box(P.steel, 0.18, 0.18, 1.9, 2.66, 0.8, 0);
  wheel(h, P, 0.42, 0.16, -0.38, 1.46, 0.5, 1, { seg: 12, ry: -Math.PI / 2 }); // the spare, edge-on behind the cab
  h.mat(G.tube([[0.2, 2.12, 0.84], [0.2, 2.9, 0.92]], 0.012, { radial: 5 }), P.steel);
  // the deck and its sides
  h.box(P.deep, 2.5, 0.08, 1.8, -1.45, 1.0, 0);
  for (const s of [1, -1]) h.box(P.base, 2.5, 0.2, 0.06, -1.45, 1.1, s * 0.9);
  h.box(P.base, 0.06, 0.2, 1.8, -2.7, 1.1, 0); h.box(P.owner, 0.08, 0.03, 1.8, -2.7, 1.215, 0);
  // wheels: the front axle and the rear pair
  for (const x of [1.6, -0.95, -2.05]) for (const s of [1, -1]) wheel(h, P, 0.5, 0.34, x, 0.5, s * 0.86, s, { seg: 12 });
  for (const s of [1, -1]) h.box(P.steel, 0.1, 0.5, 0.1, -2.7, 0.82, s * 0.7); // jacks

  // the launcher: a turntable and an A-frame truss with cross-ties, eight open rails raised toward the front with a fat
  // rocket hung under each, tails out past the back
  const el = 0.28, c = Math.cos(el), sn = Math.sin(el), RL = 4.0, H = [-1.6, 0.7];
  t.add(CYL8, P.steel, 0, 0.06, 0, 0, 0, 0, 0.45, 0.12, 0.45);
  const pt = (u, dy = 0, z = 0) => [H[0] + u * RL * c - dy * sn, H[1] + u * RL * sn + dy * c, z]; // a point along the rails, dy below the web
  for (const s of [1, -1]) {
    t.box(P.dark, 0.1, 0.5, 0.1, H[0], 0.32, s * 0.5);
    t.mat(G.tube([[0.2, 0.1, s * 0.5], pt(0.55, 0.1, s * 0.5)], 0.05, { radial: 6 }), P.base);
    t.mat(G.tube([[-0.5, 0.1, s * 0.5], pt(0.3, 0.1, s * 0.5)], 0.04, { radial: 6 }), P.base);
    t.mat(G.tube([[-0.5, 0.1, s * 0.5], pt(0.55, 0.1, s * 0.5)], 0.025, { radial: 5 }), P.base); // diagonal truss
  }
  for (const u of [0.18, 0.5, 0.82]) t.mat(G.tube([pt(u, 0.12, -0.9), pt(u, 0.12, 0.9)], 0.03, { radial: 5 }), P.dark); // cross-ties
  const rails = parts();
  for (let i = 0; i < 8; i++) {
    const z = (i - 3.5) * 0.23;
    rails.box(P.light, RL, 0.18, 0.03, RL / 2, 0, z); rails.box(P.base, RL, 0.03, 0.07, RL / 2, 0.105, z);
    rails.mat(rocket(), P.white, G.xf(-0.15, -0.09 - 0.085, z));
  }
  for (const it of rails.list) t.mat(it.geo, it.color, G.xf(H[0], H[1], 0, 0, 0, el).multiply(it.matrix));
  return {
    hull: finish(G.merge(h.list), { height: 1.0 }), turret: finish(G.merge(t.list), { floor: 0, height: 0.7 }),
    turretAt: [-1.3, 1.04, 0], tip: [H[0] + c * RL, H[1] + sn * RL, 0],
  };
}
// an M-13 rocket along +x, tail at x = 0, nose at x = 1.5: a fat body, an ogive head and dark flat fins
function rocket() {
  return once('m13', () => {
    const body = G.lathe([[0.05, 0], [0.085, 0.14], [0.085, 1.0], [0.065, 1.25], [0, 1.5]], 6, { axis: 'x' });
    // two crossed flat fins, each a plane seen from both sides
    const dark = col(0x2c2c2a), fin = (rot) => [-Math.PI / 2, Math.PI / 2].map((a) => ({ geo: PLANE, color: dark, matrix: G.xf(0.14, 0, 0, rot + a, 0, 0, 0.3, 0.22, 1) }));
    return G.merge([{ geo: body, color: col(0xa4aaa0) }, ...fin(0), ...fin(Math.PI / 2)]);
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
