// Wheeled and half-tracked vehicles: the M8 Greyhound, Sd.Kfz. 222 and BA-64 armored cars, the M16 quad .50
// half-track, the Panzerwerfer 42 on the Maultier and the Katyusha on a Studebaker truck.
//
// Each model is two vertex-colored geometries, the hull and the part that traverses (turret or launcher), so a unit
// stays two draw calls with the shared PAINT material (client/unit-models.js bakes them). Every shape says what it is
// made of (painted armor, cast armor, gunmetal, rubber, track steel, wood, canvas, or plain for glass, lenses and
// markings) and client/model-textures.js lays the wear and dirt on top; the vertex colors carry the paint and a soft
// contact shadow only. Axes: +x forward, +y up, ground at y = 0, z is the vehicle's right. Sizes are in game metres,
// about 0.85 of the real vehicles.
//
// Only 'three' and the geometry kit are imported, so the browser and the Node tests load it the same way.
import * as THREE from 'three';
import * as G from './geom.js';

// which units this module builds: every armored car, the US half-track flak, the German and Soviet rocket trucks
export const isWheeled = (type, fac) => !!BUILD[type]?.[fac];

const TAU = Math.PI * 2;
// a color, optionally with the material it stands for (parts() files the shape under it)
const col = (hex, made) => { const c = new THREE.Color(hex); if (made) c.made = made; return c; };
// a shade of a paint: k times as bright, its blue scaled by kb so shadowed olive stays olive and not teal
const shade = (c, k, kb = 1) => { const s = c.clone().multiplyScalar(k); s.b *= kb; if (c.made) s.made = c.made; return s; };

// The factory paints, picked against the game's warm sun and blue shade: US olive drab, German panzer grey (the
// armored cars) and dunkelgelb (the late rocket half-track, with olive and red-brown patches), Soviet 4BO green.
// The textures fade and mottle them further, so they are a little richer here than they end up on screen.
const SCHEME = { od: 0x575f3e, grey: 0x4f5356, green: 0x505e3a, gelb: 0x857c5c };
function paints(look, scheme) {
  const base = col(SCHEME[scheme] ?? look.vehicle), kb = scheme === 'grey' ? 1 : 0.95; // grey keeps its blue in shadow
  return {
    base, mid: shade(base, 0.84, kb), dark: shade(base, 0.66, kb * kb), deep: shade(base, 0.42, kb * kb), light: shade(base, 1.12),
    owner: col(look.color, 'plain'),
    rubber: col(0x34332f, 'rubber'), tread: col(0x3a3833, 'track-steel'), steel: col(0x45443f, 'gunmetal'), gun: col(0x2f2f2c, 'gunmetal'),
    glass: col(0x2e383c, 'plain'), lens: col(0x7c7a6e, 'plain'), black: col(0x1c1b18, 'plain'), hole: col(0x22211e, 'plain'),
    canvas: col(0x5c5a44, 'canvas'), wood: col(0x6b5a42, 'wood'), leather: col(0x47392b, 'leather'), white: col(0xffffff),
    red: col(0xa83c2c), chalk: col(0xdcd7c6), olive: col(0x5f6544), brown: col(0x67503f),
  };
}

// ---------------------------------------------------------------- building blocks

const memo = new Map();
const once = (key, make) => memo.get(key) ?? memo.set(key, make()).get(key);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const PLANE = new THREE.PlaneGeometry(1, 1);
const I = new THREE.Matrix4();

// A list of colored, placed shapes that G.merge() turns into one geometry. A shape is made of `made` when given,
// else of what its color stands for, else of the model's default (painted armor).
function parts() {
  const list = [];
  const push = (geo, color, matrix, made) => { list.push({ geo, color, matrix, mat: made ?? color?.made }); return api; };
  const api = {
    list,
    // any shape at a position, an XYZ Euler turn and a scale
    add: (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => push(geo, color, G.xf(x, y, z, rx, ry, rz, sx, sy, sz)),
    // a box w (x) by h (y) by d (z) centered at x, y, z
    box: (color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => push(BOX, color, G.xf(x, y, z, rx, ry, rz, w, h, d)),
    // a rod of radius r along x (rz slopes it up toward +x, ry swings it), centered at x, y, z; 8 or 6 sided
    rod: (color, r, len, x, y, z, rx = 0, ry = 0, rz = 0, n = 8) => push(n === 6 ? CYL6 : CYL8, color, G.xf(x, y, z, rx, ry, rz + Math.PI / 2, r, len, r)),
    mat: (geo, color, matrix = I, made) => push(geo, color, matrix, made),
    // another list's shapes, moved by a matrix
    put: (sub, matrix) => { for (const it of sub.list) list.push({ ...it, matrix: matrix.clone().multiply(it.matrix) }); return api; },
  };
  return api;
}

// A solid of revolution from a profile of [radius, height] points, axis along z (or x), without G.lathe's
// reorientation: a profile that climbs an outer wall faces out, one that runs inward over a face faces +z.
function turn(profile, seg, axis = 'z', angle = 50) {
  const raw = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  raw.deleteAttribute('uv');
  const g = G.crease(raw, angle);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(-Math.PI / 2);
  return g;
}
// A flat wheel face toward +z from rings of [radius, depth], rim inward. Every other sector of ring band `gaps` is
// near black: the openings between the spokes of a spoked wheel.
function wheelFace(rings, seg, gaps = -1) {
  const pos = [], colr = [];
  const pt = (r, z, a) => [r * Math.cos(a), r * Math.sin(a), z];
  for (let k = 0; k + 1 < rings.length; k++) {
    const [r0, z0] = rings[k], [r1, z1] = rings[k + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, c = k === gaps && i & 1 ? 0.22 : 1;
      const A = pt(r0, z0, a0), B = pt(r0, z0, a1), C = pt(r1, z1, a1), D = pt(r1, z1, a0);
      const tris = r1 > 1e-6 ? [A, B, C, A, C, D] : [A, B, C];
      for (const v of tris) { pos.push(...v); colr.push(c, c, c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(Array.from({ length: pos.length / 3 }, (_, i) => i));
  return G.crease(g, 40);
}

// Wheels: a rubber tire with rounded shoulders, a steel disc set into it (a dark outer ring, then the paint and a
// raised hub), and a dark cover closing the back. Axle along z, outer face at +z; side -1 mirrors it.
const tireGeo = (R, w, seg) => once(`tire|${R}|${w}|${seg}`, () => { const h = w / 2; return turn([[R * 0.64, -h * 0.9], [R, -h * 0.62], [R, h * 0.62], [R * 0.64, h * 0.92]], seg, 'z', 80); });
const rimGeo = (R, w, seg) => once(`rim|${R}|${w}|${seg}`, () => { const h = w / 2; return turn([[R * 0.645, h * 0.8], [R * 0.5, h * 0.78]], seg); });
const hubGeo = (R, w, seg) => once(`hub|${R}|${w}|${seg}`, () => { const h = w / 2; return turn([[R * 0.5, h * 0.78], [R * 0.24, h * 0.84], [R * 0.15, h * 0.98], [0, h * 1.0]], seg); });
const backGeo = (R, w, seg) => once(`back|${R}|${w}|${seg}`, () => new THREE.CircleGeometry(R * 0.66, seg).rotateY(Math.PI).translate(0, 0, -w * 0.44));
function wheel(p, P, R, w, x, y, z, side = 1, { seg = 20, hub = P.mid, ry = 0 } = {}) {
  const m = G.xf(x, y, z, 0, ry, 0, 1, 1, side), hs = seg >= 18 ? 10 : 8;
  p.mat(tireGeo(R, w, seg), P.rubber, m);
  p.mat(rimGeo(R, w, hs), P.deep, m);
  p.mat(hubGeo(R, w, hs), hub, m);
  p.mat(backGeo(R, w, hs), P.deep, m);
}
// a road wheel of a half-track run: a flat steel disc with a hub boss, axle along z, its face at +z (the belt hides
// the rim). spokes: that many spokes with dark openings between them
function roadWheel(p, R, w, x, y, z, side, paint, spokes = 0) {
  const seg = spokes ? spokes * 2 : 12, d = w * 0.3, b = w * 0.5;
  const geo = once(`road|${R}|${w}|${spokes}`, () => wheelFace(spokes
    ? [[R, d], [R * 0.78, d], [R * 0.36, d], [R * 0.2, b], [0, b]]
    : [[R, d], [R * 0.36, d], [R * 0.2, b], [0, b]], seg, spokes ? 1 : -1));
  p.mat(geo, paint, G.xf(x, y, z, 0, 0, 0, 1, 1, side));
}
// a toothed drive sprocket: a gear outline with `teeth` teeth, axle along z
function gearWheel(p, R, w, x, y, z, side, paint, teeth = 7) {
  const m = G.xf(x, y, z, 0, 0, 0, 1, 1, side);
  p.mat(once(`gear|${R}|${w}|${teeth}`, () => {
    const pts = [];
    for (let k = 0; k < teeth; k++) for (const [f, r] of [[-0.3, 0.84], [0, 1], [0.3, 0.84]]) { const a = (k + f) * (TAU / teeth); pts.push([R * r * Math.cos(a), R * r * Math.sin(a)]); }
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
// an outline scaled about the origin
const grow = (pts, kx, kz = kx) => pts.map(([x, z]) => [x * kx, z * kz]);
// an open-topped box of plates (a cab, a bed, a fighting compartment): outer walls, inner walls and a rim, from x0 to
// x1 and half width z, between y0 and y1. lean widens the top.
function tub(p, outer, inner, edge, x0, x1, z, y0, y1, th = 0.06, lean = 0) {
  const rect = (a, b, c) => [[b, c], [a, c], [a, -c], [b, -c]];
  const ob = rect(x0, x1, z), ot = rect(x0, x1, z + lean), ib = rect(x0 + th, x1 - th, z - th), it = rect(x0 + th, x1 - th, z + lean - th);
  p.mat(frustum(ob, ot, y0, y1, { caps: false }), outer);
  p.mat(frustum(ib, it, y0 + 0.02, y1, { caps: false, inside: true }), inner);
  p.mat(rim(ot, it, y1), edge);
}

// a hull cross-section from three corners (half width, height): bottom, widest side and top shoulder, mirrored in z.
// An optional fourth corner u between the side and the shoulder breaks the side into two plates.
const ringOf = (b, m, t, u) => (u
  ? [b, m, u, t, [-t[0], t[1]], [-u[0], u[1]], [-m[0], m[1]], [-b[0], b[1]]]
  : [[b[0], b[1]], [m[0], m[1]], [t[0], t[1]], [-t[0], t[1]], [-m[0], m[1]], [-b[0], b[1]]]);
const hullOf = (stations, normals = 34) => G.loft(stations.map(([x, b, m, t, u]) => ({ x, pts: ringOf(b, m, t, u) })), { normals });

// A soft contact shadow in the vertex colors: darker toward the ground and on faces that look down. floor is the
// ground in the geometry's own space (a turret sits turretAt[1] above it).
function finish(geo, floor = 0) {
  const g = G.ao(geo, { floor, height: 1.0, dark: 0.8, under: 0.15 });
  g.computeBoundingSphere();
  return g;
}
const place = (at, normal, up = [0, 1, 0], s = 1) => G.place(at, normal, up, s);
// the faction's insignia, flat on a surface; the decal carries its own colors
const insignia = (P, fac, size) => (fac === 1 ? G.balkenkreuz(size) : G.star(size, fac === 2 ? { color: P.red, border: P.chalk, edge: 0.1 } : { color: P.chalk }));
// the marking on the side of a hull, at x, y on the surface half width z (the surface leans in by lean going up)
function sideMark(p, P, fac, size, x, y, z, s, lean = 0.1) {
  const nz = 1 / Math.hypot(1, lean), ny = lean * nz;
  p.mat(insignia(P, fac, size), P.white, place([x, y + 0.012 * ny, s * (z + 0.012 * nz)], [0, ny, s * nz], [0, 1, 0]), 'plain');
}
// a marking on a surface sloping toward the front (a glacis, a hood): at x, y with the slope dy/dx
function slopeMark(p, P, fac, size, x, y, slope) {
  const L = Math.hypot(1, slope), nx = -slope / L, ny = 1 / L;
  p.mat(insignia(P, fac, size), P.white, place([x + 0.012 * nx, y + 0.012 * ny, 0], [nx, ny, 0], [-1, -slope, 0]), 'plain');
}
// a flat marking or plate lying on a roof at height y
function roofMark(p, P, fac, size, x, y, z = 0) { p.mat(insignia(P, fac, size), P.white, place([x, y + 0.008, z], [0, 1, 0], [1, 0, 0]), 'plain'); }

const CIRC6 = new THREE.CircleGeometry(1, 6), CIRC8 = new THREE.CircleGeometry(1, 8);
// a headlamp pointing along +x: a dark housing with a pale lens
function lamp(p, P, x, y, z, r = 0.065, len = 0.1) {
  p.add(CYL8, P.dark, x, y, z, 0, 0, Math.PI / 2, r, len, r);
  p.add(CIRC8, P.lens, x + len / 2 + 0.002, y, z, 0, Math.PI / 2, 0, r * 0.7);
}
// three steel bars in front of a lamp
function guard(p, P, x, y, z, h = 0.16) { for (const dz of [-0.06, 0, 0.06]) p.box(P.steel, 0.02, h, 0.02, x, y, z + dz); }
// A mudguard that follows a wheel: n flat plates along an arc of radius R + gap around the wheel center (x, yc), from
// a0 to a1 degrees (0 is straight up, forward is positive), `width` across at z.
function fender(p, color, x, yc, z, R, width, a0, a1, n, { gap = 0.07, th = 0.035 } = {}) {
  const Rg = R + gap, d = ((a1 - a0) / n) * (Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const a = (a0 * Math.PI) / 180 + d * (i + 0.5);
    p.box(color, 2 * Rg * Math.tan(d / 2) + 0.03, th, width, x + Rg * Math.sin(a), yc + Rg * Math.cos(a), z, 0, 0, -a);
  }
}
// A flat patch (camouflage) on a side wall: a polygon of [x, y] points, on the wall that is at half width zRef at
// height yRef and leans in by k per unit of height; ry follows a wall that narrows along x. s picks the side.
function patch(p, color, pts, yRef, zRef, k, s, ry = 0) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y - yRef))));
  p.mat(geo, color, G.xf(0, yRef, s * (zRef + 0.006), -s * Math.atan(k), s * ry, 0, 1, 1, s));
}
// a soft irregular blotch for camouflage: an outline of n points around (cx, cy), radii rx, ry, shaped by a seed
const blob = (cx, cy, rx, ry, seed, n = 9) => Array.from({ length: n }, (_, k) => {
  const a = (k / n) * TAU, j = 0.7 + 0.5 * (((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
  return [cx + rx * j * Math.cos(a), cy + ry * j * Math.sin(a)];
});
// a flat patch lying on a roof at height y: a polygon of [x, z] points
function roofPatch(p, color, pts, y) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
  p.mat(geo, color, G.xf(0, y + 0.006, 0, -Math.PI / 2, 0, 0));
}
// an aerial: a thin steel whip from a base point
const aerial = (p, P, x, y, z, len = 1.0, lean = 0.06) => p.mat(G.tube([[x, y, z], [x - lean, y + len, z]], 0.011, { radial: 4 }), P.steel);
// a shovel or a pick on a flat side: a wooden handle along x and a steel head at the front, flat against the wall
function tool(p, P, x, y, z, len, s, lean = 0, head = 'shovel') {
  const rx = -s * Math.atan(lean);
  p.box(P.wood, len, 0.035, 0.035, x, y, s * z, rx);
  if (head === 'shovel') p.box(P.steel, 0.2, 0.13, 0.02, x + len / 2 + 0.09, y, s * (z + 0.004), rx);
  else p.box(P.steel, 0.05, 0.3, 0.035, x + len / 2 - 0.04, y, s * z, rx);
}

// ---------------------------------------------------------------- M8 Greyhound

function m8(P, fac) {
  const h = parts(), t = parts();
  // a double-wedge hull: lower plates sloping in to the belly, sponsons over the wheels, upper plates leaning in to
  // the deck, a long glacis and a short nose
  h.mat(hullOf([
    [-2.12, [0.5, 0.62], [0.74, 0.97], [0.86, 1.48], [0.98, 1.01]],
    [-2.02, [0.52, 0.42], [0.76, 0.97], [0.94, 1.55], [1.04, 1.01]],
    [1.2, [0.52, 0.42], [0.76, 0.97], [0.94, 1.55], [1.04, 1.01]],
    [2.0, [0.44, 0.56], [0.7, 0.95], [0.84, 1.1], [0.98, 1.0]],
    [2.16, [0.38, 0.74], [0.62, 0.95], [0.74, 1.02], [0.86, 0.99]],
  ]), P.base);
  // six wheels in three axles, the flat fender shelves over them, a stowage box on each rear shelf
  for (const x of [1.5, 0.0, -1.36]) for (const s of [1, -1]) wheel(h, P, 0.47, 0.34, x, 0.47, s * 0.98, s);
  for (const s of [1, -1]) {
    h.box(P.base, 1.0, 0.035, 0.16, 1.55, 0.995, s * 1.1); h.box(P.base, 0.32, 0.03, 0.16, 2.17, 0.9, s * 1.1, 0, 0, -0.62);
    h.box(P.base, 2.25, 0.035, 0.16, -0.68, 0.995, s * 1.1); h.box(P.base, 0.035, 0.26, 0.16, -1.8, 0.87, s * 1.1);
    h.box(P.mid, 0.62, 0.24, 0.15, -0.95, 1.13, s * 1.1); h.box(P.dark, 0.6, 0.02, 0.152, -0.95, 1.21, s * 1.1);
    // the upper side: a shovel and a pick handle, a seam, the driver's side vision block
    tool(h, P, -0.05, 1.33, 0.99, 0.75, s, 0.11); tool(h, P, -0.15, 1.17, 1.01, 0.8, s, 0.11, 'pick');
    h.box(P.dark, 0.025, 0.5, 0.012, 0.75, 1.27, s * 1.005, -s * 0.11);
    h.box(P.black, 0.16, 0.035, 0.02, 1.0, 1.42, s * 0.975, -s * 0.11);
    // the glacis: two driver's hatches with vision slits, headlamps behind guards, the tow shackles
    h.box(P.mid, 0.46, 0.03, 0.4, 1.56, 1.37, s * 0.37, 0, 0, -0.51); h.box(P.black, 0.03, 0.025, 0.24, 1.42, 1.455, s * 0.37, 0, 0, -0.51);
    lamp(h, P, 2.05, 1.09, s * 0.7); guard(h, P, 2.14, 1.09, s * 0.7);
    h.box(P.steel, 0.08, 0.1, 0.05, 2.19, 0.74, s * 0.42);
  }
  // rear deck: two engine grilles, a canvas bedroll and ration boxes along the back, the aerial
  for (const z of [0.42, -0.42]) {
    h.box(P.deep, 0.62, 0.02, 0.62, -1.15, 1.555, z);
    for (let i = 0; i < 5; i++) h.box(P.mid, 0.6, 0.02, 0.03, -1.15, 1.565, z - 0.24 + i * 0.12);
  }
  h.add(CYL8, P.canvas, -1.92, 1.63, 0, Math.PI / 2, 0, 0, 0.12, 1.5, 0.08);
  for (const z of [-0.42, 0.42]) h.box(P.leather, 0.25, 0.17, 0.035, -1.92, 1.63, z); // the bedroll's straps
  h.box(P.mid, 0.3, 0.2, 0.32, -1.62, 1.65, 0.55); h.box(P.canvas, 0.3, 0.16, 0.3, -1.62, 1.63, -0.55);
  aerial(h, P, -1.95, 1.55, -0.86, 1.1);
  slopeMark(h, P, fac, 0.13, 1.89, 1.55 - 0.69 * 0.5625, -0.5625);

  // turret: open-topped, a flat front and a rounded back, walls leaning in a little, the .50 ring mount raised over
  // it on brackets (its top is the owner's color), the 37 mm in a cast mantlet, a bustle bag on the back
  const TH = 0.62, bot = [[0.84, 0.36], [0.62, 0.7], [-0.2, 0.72], [-0.5, 0.62], [-0.72, 0.4], [-0.8, 0.14], [-0.8, -0.14], [-0.72, -0.4], [-0.5, -0.62], [-0.2, -0.72], [0.62, -0.7], [0.84, -0.36]];
  const top = grow(bot, 0.92, 0.9);
  t.mat(frustum(bot, top, 0, TH, { hole: circ(0.44, 12, -0.04, 0) }), P.base);
  t.mat(new THREE.CircleGeometry(0.44, 12).rotateX(-Math.PI / 2), P.deep, G.xf(-0.04, TH - 0.2, 0));
  const RY = TH + 0.1;
  t.mat(turn([[0.54, 0], [0.54, 0.09]], 14, 'y'), P.mid, G.xf(-0.04, RY, 0));
  t.mat(turn([[0.48, 0.09], [0.48, 0]], 14, 'y'), P.dark, G.xf(-0.04, RY, 0));
  t.mat(turn([[0.54, 0.09], [0.48, 0.09]], 14, 'y'), P.owner, G.xf(-0.04, RY, 0));
  for (const [px, pz] of [[0.33, 0.38], [0.33, -0.38], [-0.42, 0.38], [-0.42, -0.38]]) t.box(P.steel, 0.05, 0.12, 0.05, px, TH + 0.05, pz);
  // the .50 on its cradle at the rear left of the ring, its ammo can beside it
  t.box(P.steel, 0.06, 0.16, 0.06, -0.5, RY + 0.17, -0.22); t.box(P.gun, 0.34, 0.1, 0.09, -0.46, RY + 0.27, -0.22);
  t.rod(P.gun, 0.018, 0.85, -0.02, RY + 0.27, -0.22, 0, 0, 0, 6); t.rod(P.gun, 0.03, 0.22, -0.18, RY + 0.27, -0.22, 0, 0, 0, 6);
  t.box(P.mid, 0.14, 0.14, 0.08, -0.5, RY + 0.25, -0.33);
  // the gun: a cast mantlet, the 37 mm barrel and its coaxial MG
  t.add(G.chamferBox(0.16, 0.32, 0.5, 0.05), P.base, 0.86, 0.3, 0.02).list.at(-1).mat = 'cast-armor';
  t.rod(P.base, 0.075, 0.24, 1.02, 0.3, 0.02);
  t.mat(G.barrel(1.5, 0.045, { segments: 8 }), P.base, G.xf(1.05, 0.3, 0.02));
  t.rod(P.gun, 0.02, 0.2, 1.0, 0.3, -0.16, 0, 0, 0, 6);
  t.add(G.chamferBox(0.3, 0.26, 0.62, 0.06), P.canvas, -0.92, 0.36, 0); // the bustle bag
  for (const s of [1, -1]) sideMark(t, P, fac, 0.2, 0.1, 0.32, 0.72 - (0.072 / TH) * 0.32, s, 0.072 / TH);

  return { hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -1.55), turretAt: [0.05, 1.55, 0], tip: [2.55, 0.3, 0.02] };
}

// ---------------------------------------------------------------- Sd.Kfz. 222

// A wire grenade screen in the xy plane from (-hl, 0) to (hl, height): a steel frame, a dark backing and a light
// lattice on both faces, placed by `matrix`.
function screen(p, P, hl, height, matrix) {
  const w = 0.02, nv = 9, nh = 2, sub = parts();
  sub.box(P.steel, 2 * hl, w, w, 0, height, 0); sub.box(P.steel, w, height, w, -hl, height / 2, 0); sub.box(P.steel, w, height, w, hl, height / 2, 0);
  for (const sd of [1, -1]) {
    const ry = sd < 0 ? Math.PI : 0;
    sub.mat(PLANE, P.dark, G.xf(0, height / 2, 0, 0, ry, 0, 2 * hl, height, 1));
    for (let i = 1; i < nv; i++) sub.mat(PLANE, P.light, G.xf(-hl + (2 * hl * i) / nv, height / 2, sd * 0.005, 0, ry, 0, 0.014, height, 1));
    for (let i = 1; i <= nh; i++) sub.mat(PLANE, P.light, G.xf(0, (height * i) / (nh + 1), sd * 0.005, 0, ry, 0, 2 * hl, 0.014, 1));
  }
  p.put(sub, matrix);
}

function sdkfz222(P, fac) {
  const h = parts(), t = parts();
  // a faceted body: lower plates flaring out to a waist over the wheels, upper plates leaning in to a narrow deck, a
  // long glacis to a narrow nose and a sloped tail
  h.mat(hullOf([
    [-1.9, [0.48, 0.58], [0.54, 0.76], [0.5, 1.28], [0.76, 0.98]],
    [-1.62, [0.52, 0.42], [0.6, 0.7], [0.6, 1.42], [0.86, 0.98]],
    [0.6, [0.52, 0.42], [0.6, 0.7], [0.6, 1.42], [0.86, 0.98]],
    [1.2, [0.5, 0.44], [0.58, 0.7], [0.54, 1.27], [0.84, 0.96]],
    [1.82, [0.42, 0.55], [0.5, 0.74], [0.4, 1.07], [0.66, 0.92]],
    [2.1, [0.34, 0.66], [0.4, 0.78], [0.3, 0.98], [0.48, 0.88]],
  ]), P.base);
  // four big wheels on a long wheelbase, each under a four-plate fender
  for (const x of [1.32, -1.25]) for (const s of [1, -1]) {
    wheel(h, P, 0.47, 0.32, x, 0.47, s * 0.8, s);
    fender(h, P.base, x, 0.47, s * 0.84, 0.47, 0.34, -70, 65, 4, { gap: 0.06 });
  }
  for (const s of [1, -1]) {
    // headlamps and marker posts on the front fenders, a door with its hinges, stowage, tools, the cross
    lamp(h, P, 1.86, 0.98, s * 0.66); h.box(P.steel, 0.1, 0.1, 0.08, 1.8, 0.92, s * 0.66);
    h.mat(G.tube([[1.7, 1.0, s * 0.98], [1.7, 1.34, s * 0.98]], 0.014, { radial: 4 }), P.steel); h.add(CYL6, P.steel, 1.7, 1.36, s * 0.98, 0, 0, 0, 0.04, 0.06, 0.04);
    h.box(P.mid, 0.56, 0.36, 0.03, 0.0, 0.84, s * 0.74, s * 0.79, 0, 0); h.box(P.steel, 0.05, 0.03, 0.03, 0.22, 0.86, s * 0.77, s * 0.79, 0, 0);
    h.box(P.mid, 0.46, 0.26, 0.2, -0.5, 1.06, s * 0.92); h.box(P.dark, 0.46, 0.02, 0.202, -0.5, 1.15, s * 0.92); // stowage bin
    h.box(P.base, 0.14, 0.32, 0.22, -1.72, 1.0, s * 0.84); h.box(P.base, 0.14, 0.32, 0.22, -1.88, 1.0, s * 0.84); // jerrycans
    tool(h, P, 0.55, 1.12, 0.79, 0.6, s, 0.55);
    h.box(P.black, 0.18, 0.03, 0.02, 1.0, 1.22, s * 0.62, -s * 0.5, 0, 0); // the side visor
    sideMark(h, P, fac, 0.17, -0.55, 1.22, 0.86 - 0.24 * 0.545, s, 0.545);
  }
  // the bumper on two brackets, a hatch and the visor on the glacis, the engine grilles behind the turret, the exhaust
  h.box(P.mid, 0.06, 0.07, 1.0, 2.15, 0.64, 0); for (const s of [1, -1]) h.box(P.steel, 0.16, 0.05, 0.05, 2.06, 0.64, s * 0.3);
  h.box(P.mid, 0.36, 0.025, 0.42, 1.5, 1.19, 0, 0, 0, -0.27); h.box(P.black, 0.03, 0.03, 0.34, 1.24, 1.3, 0, 0, 0, -0.27);
  for (const x of [-1.15, -1.55]) { h.box(P.deep, 0.3, 0.02, 0.62, x, 1.415, 0); for (let i = 0; i < 3; i++) h.box(P.mid, 0.3, 0.02, 0.03, x, 1.425, -0.2 + i * 0.2); }
  h.add(CYL8, P.steel, -1.96, 0.78, -0.3, Math.PI / 2, 0, 0, 0.07, 0.42, 0.07);
  slopeMark(h, P, fac, 0.17, 1.92, 1.04, -0.27);

  // the fighting compartment: an open ten-sided turret with sloped walls (its rim is the owner's color), the 20 mm and
  // its MG behind a small shield, and the folding wire screens tilted out over it
  const n = 10, bot = Array.from({ length: n }, (_, k) => { const a = ((k + 0.5) / n) * TAU; return [0.7 * Math.cos(a), 0.6 * Math.sin(a)]; });
  const TH = 0.34, top = grow(bot, 0.86), inB = grow(bot, 0.92), inT = grow(top, 0.93);
  t.mat(frustum(bot, top, 0, TH, { caps: false }), P.base);
  t.mat(frustum(inB, inT, 0.02, TH, { caps: false, inside: true }), P.dark);
  t.mat(rim(top, inT, TH), P.owner);
  t.mat(new THREE.CircleGeometry(0.6, 10).rotateX(-Math.PI / 2), P.deep, G.xf(0, 0.03, 0, 0, 0, 0, 1, 1, 0.86));
  t.box(P.steel, 0.12, 0.26, 0.12, 0.1, 0.14, 0); t.add(G.chamferBox(0.42, 0.16, 0.22, 0.03), P.steel, 0.2, 0.3, 0);
  t.mat(G.barrel(1.3, 0.028, { brake: true, segments: 8 }), P.gun, G.xf(0.32, 0.31, 0.03));
  t.rod(P.gun, 0.018, 0.5, 0.55, 0.31, -0.1, 0, 0, 0, 6);
  t.box(P.base, 0.035, 0.24, 0.36, 0.54, 0.36, 0, 0, 0, 0.12); t.box(P.steel, 0.12, 0.05, 0.04, 0.38, 0.44, 0.16); // shield and sight
  t.box(P.mid, 0.24, 0.16, 0.2, -0.36, 0.1, 0.24); t.box(P.canvas, 0.2, 0.08, 0.2, -0.4, 0.07, -0.24);
  for (const s of [1, -1]) screen(t, P, 0.5, 0.32, G.xf(-0.02, TH, s * 0.51, s * 0.17, 0, 0));
  for (const s of [1, -1]) screen(t, P, 0.42, 0.32, G.xf(s * 0.6, TH, 0, 0, Math.PI / 2, 0).multiply(G.xf(0, 0, 0, s * 0.17, 0, 0)));

  return { hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -1.42), turretAt: [-0.12, 1.42, 0], tip: [1.62, 0.31, 0.03] };
}

// ---------------------------------------------------------------- BA-64

function ba64(P, fac) {
  const h = parts(), t = parts();
  // narrow and tall: slab sides leaning in to a wide flat roof, a steep front plate and a short sloped nose
  h.mat(hullOf([
    [-1.78, [0.42, 0.56], [0.58, 0.82], [0.48, 1.42], [0.64, 0.92]],
    [-1.52, [0.46, 0.4], [0.62, 0.78], [0.56, 1.5], [0.7, 0.92]],
    [0.15, [0.46, 0.4], [0.62, 0.78], [0.56, 1.5], [0.7, 0.92]],
    [0.62, [0.46, 0.4], [0.62, 0.78], [0.54, 1.18], [0.68, 0.92]],
    [1.32, [0.44, 0.44], [0.58, 0.8], [0.46, 1.0], [0.62, 0.9]],
    [1.75, [0.38, 0.56], [0.5, 0.8], [0.4, 0.92], [0.52, 0.88]],
  ]), P.base);
  for (const x of [1.15, -1.0]) for (const s of [1, -1]) {
    wheel(h, P, 0.42, 0.28, x, 0.42, s * 0.72, s);
    fender(h, P.base, x, 0.42, s * 0.76, 0.42, 0.32, -70, 65, 4, { gap: 0.05 });
  }
  for (const s of [1, -1]) {
    lamp(h, P, 1.62, 0.96, s * 0.46, 0.06); h.box(P.steel, 0.08, 0.06, 0.06, 1.8, 0.62, s * 0.3);
    // the door, a shovel, a seam, the vision slit, the star high on the rear side
    h.box(P.mid, 0.5, 0.5, 0.025, -0.2, 1.17, s * 0.665, -s * 0.24, 0, 0); h.box(P.steel, 0.06, 0.03, 0.03, 0.0, 1.2, s * 0.67, -s * 0.24, 0, 0);
    tool(h, P, -0.15, 1.02, 0.69, 0.55, s, 0.24);
    h.box(P.black, 0.14, 0.03, 0.02, 0.48, 1.12, s * 0.63, -s * 0.5, 0, 0);
    sideMark(h, P, fac, 0.15, -1.15, 1.24, 0.7 - 0.32 * 0.24, s, 0.24);
  }
  // the armored radiator grille with its louvres, the driver's hatch with a visor on the front plate
  h.box(P.deep, 0.04, 0.22, 0.6, 1.77, 0.74, 0);
  for (let i = 0; i < 5; i++) h.box(P.mid, 0.03, 0.025, 0.56, 1.79, 0.66 + i * 0.04, 0);
  h.box(P.mid, 0.38, 0.025, 0.44, 0.42, 1.36, 0, 0, 0, -0.6); h.box(P.black, 0.03, 0.03, 0.3, 0.32, 1.43, 0, 0, 0, -0.6);
  // the spare wheel on the tail and the aerial
  wheel(h, P, 0.36, 0.2, -1.92, 0.98, -0.2, 1, { seg: 16, ry: -Math.PI / 2 });
  aerial(h, P, -1.4, 1.5, 0.48, 0.9);

  // a tall faceted turret, a truncated eight-sided pyramid (its top edge is the owner's color), a round hatch, the
  // DT in a ball mount with its jacket
  const TH = 0.46, bot = [[0.5, 0.22], [0.32, 0.46], [-0.36, 0.46], [-0.52, 0.22], [-0.52, -0.22], [-0.36, -0.46], [0.32, -0.46], [0.5, -0.22]];
  const top = grow(bot, 0.66);
  t.mat(frustum(bot, top, 0, TH), P.base);
  t.mat(rim(top, grow(top, 0.86), TH + 0.004), P.owner);
  t.mat(turn([[0.17, 0], [0.17, 0.03], [0, 0.04]], 10, 'y'), P.mid, G.xf(-0.06, TH, 0));
  for (const s of [1, -1]) t.box(P.black, 0.12, 0.025, 0.02, -0.02, 0.28, s * 0.4, -s * 0.36, 0, 0);
  t.add(new THREE.SphereGeometry(0.075, 8, 5), P.base, 0.43, 0.24, 0).list.at(-1).mat = 'cast-armor';
  t.rod(P.gun, 0.032, 0.42, 0.68, 0.24, 0, 0, 0, 0, 6);
  t.mat(G.barrel(0.88, 0.016, { segments: 6 }), P.gun, G.xf(0.46, 0.24, 0));

  return { hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -1.5), turretAt: [-0.72, 1.5, 0], tip: [1.34, 0.24, 0] };
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

// One track run of a half-track at z = s * z: a steel belt around the sprocket (the first wheel, at the front), the
// idler (the last) and the road wheels, which show through it. wheels: [x, y, R]. The belt rests on y = 0 when
// y = R + pad. spokes: spoked road wheels with that many spokes.
function trackRun(p, P, s, z, w, wheels, paint, { pad = 0.065, spokes = 0, belt = P.tread } = {}) {
  const key = `run|${w}|${pad}|${wheels.join()}`;
  const geo = once(key, () => G.extrudeProfile(hull2(wheels.map(([x, y, R]) => [x, y, R + pad])), w, 0.03, { holes: [hull2(wheels.map(([x, y, R]) => [x, y, R]))], segments: 1, crease: 30 }));
  p.mat(geo, belt, G.xf(0, 0, s * z));
  const last = wheels.length - 1;
  wheels.forEach(([x, y, R], i) => {
    if (i === 0) gearWheel(p, R * 0.96, w, x, y, s * z, s, paint);
    else roadWheel(p, R * 0.96, w * 0.72, x, y, s * z, s, paint, i === last ? 0 : spokes);
  });
}

// ---------------------------------------------------------------- M16 half-track

function m16(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 4.3, 0.16, 1.16, -0.05, 0.66, 0); // the chassis rails
  // the hood: flat top, upright sides, from the radiator armor back to the cowl
  h.mat(hullOf([[2.24, [0.5, 0.66], [0.52, 1.24], [0.44, 1.34]], [1.05, [0.52, 0.66], [0.54, 1.27], [0.46, 1.38]]]), P.base);
  // the upright radiator armor with its louvres, the bumper with its shackles
  h.box(P.mid, 0.05, 0.6, 0.96, 2.26, 0.98, 0);
  for (let i = 0; i < 6; i++) h.box(P.dark, 0.04, 0.035, 0.86, 2.29, 0.76 + i * 0.085, 0);
  h.box(P.base, 0.12, 0.16, 1.86, 2.36, 0.68, 0);
  // the cab: low door tops, the windshield frame and its folded armor cover, the seats
  tub(h, P.base, P.deep, P.mid, -0.05, 1.05, 0.96, 0.84, 1.42, 0.06);
  h.box(P.deep, 1.0, 0.04, 1.8, 0.5, 0.92, 0);
  h.box(P.canvas, 0.34, 0.1, 1.5, 0.15, 1.08, 0); h.box(P.canvas, 0.08, 0.36, 1.5, -0.02, 1.26, 0);
  for (const s of [1, -1]) { h.box(P.glass, 0.025, 0.26, 0.78, 1.04, 1.56, s * 0.46, 0, 0, 0.12); h.box(P.steel, 0.05, 0.32, 0.05, 1.04, 1.58, s * 0.9, 0, 0, 0.12); }
  h.box(P.steel, 0.05, 0.32, 0.05, 1.04, 1.58, 0, 0, 0, 0.12); h.box(P.steel, 0.05, 0.04, 1.84, 1.02, 1.73, 0);
  h.box(P.base, 0.3, 0.03, 1.86, 1.18, 1.76, 0, 0, 0, 0.1);
  // the troop body: tall walls with the fold-down upper halves marked by a hinge line, the floor
  tub(h, P.base, P.deep, P.mid, -2.45, -0.05, 0.98, 0.84, 1.66, 0.06);
  h.box(P.deep, 2.3, 0.04, 1.84, -1.25, 0.94, 0);
  // running gear: the front axle, the half-track runs (sprocket, two bogies of two road wheels, the idler)
  for (const s of [1, -1]) wheel(h, P, 0.44, 0.3, 1.62, 0.44, s * 0.88, s, { seg: 16 });
  for (const s of [1, -1]) trackRun(h, P, s, 0.78, 0.34, [[0.62, 0.5, 0.26], [-0.05, 0.285, 0.2], [-0.5, 0.285, 0.2], [-1.2, 0.285, 0.2], [-1.65, 0.285, 0.2], [-2.2, 0.48, 0.24]], P.mid, { pad: 0.085, belt: P.rubber });
  for (const s of [1, -1]) {
    // curved front fenders, the running board, the headlamps behind guards
    fender(h, P.base, 1.62, 0.44, s * 0.88, 0.44, 0.38, -62, 76, 5, { gap: 0.08 });
    h.box(P.base, 0.62, 0.035, 0.36, 0.86, 0.86, s * 0.88);
    lamp(h, P, 2.04, 1.04, s * 0.72); guard(h, P, 2.13, 1.04, s * 0.72);
    h.box(P.steel, 0.08, 0.1, 0.05, 2.45, 0.78, s * 0.5);
    // body sides: the rolled lip along the top, the hinge line, three hinges, a mine rack, pioneer tools, the star
    h.box(P.mid, 2.4, 0.05, 0.05, -1.25, 1.64, s * 0.99);
    h.box(P.dark, 2.36, 0.02, 0.012, -1.25, 1.3, s * 0.985);
    for (const x of [-0.5, -1.25, -2.0]) h.box(P.steel, 0.08, 0.05, 0.02, x, 1.3, s * 0.99);
    h.box(P.mid, 0.74, 0.2, 0.1, -1.9, 1.04, s * 1.03); h.box(P.dark, 0.7, 0.02, 0.102, -1.9, 1.13, s * 1.03);
    tool(h, P, -0.55, 1.0, 0.99, 0.8, s);
    sideMark(h, P, fac, 0.2, -1.1, 1.08, 0.98, s, 0);
    // the door on the cab side
    h.box(P.dark, 0.012, 0.5, 0.012, 0.15, 1.12, s * 0.965); h.box(P.steel, 0.07, 0.025, 0.02, 0.24, 1.3, s * 0.97);
  }
  roofMark(h, P, fac, 0.24, 1.65, 1.38);
  // the tail: jerrycans on the rear plate, a canvas roll, the aerial
  for (const s of [1, -1]) h.box(P.base, 0.12, 0.34, 0.24, -2.51, 1.18, s * 0.5);
  h.add(CYL8, P.canvas, -2.3, 1.7, 0, Math.PI / 2, 0, 0, 0.1, 1.2, 0.07);
  aerial(h, P, -2.36, 1.66, 0.88, 1.0);

  // the M45 quad .50 mount: a pedestal and a carriage, two pairs of guns raised forward with their jackets and flash
  // hiders, big ammo chests outboard, the gunner between two armor wings and a front shield (their tops in the owner's
  // color)
  const el = 0.45, c = Math.cos(el), sn = Math.sin(el), L = 1.35, y0 = 0.98, x0 = 0.28;
  t.add(CYL8, P.steel, 0, 0.12, 0, 0, 0, 0, 0.3, 0.24, 0.3);
  t.box(P.steel, 0.3, 0.62, 0.46, 0, 0.5, 0); t.box(P.base, 0.36, 0.12, 1.36, 0.08, y0 - 0.16, 0);
  t.box(P.canvas, 0.22, 0.06, 0.26, -0.32, y0 - 0.1, 0); t.box(P.steel, 0.04, 0.3, 0.04, -0.3, y0 - 0.28, 0);
  for (const s of [1, -1]) {
    for (const [z, dy] of [[0.36, 0.08], [0.52, -0.08]]) {
      const gx = x0 - sn * dy, gy = y0 + c * dy;
      t.box(P.gun, 0.5, 0.13, 0.09, gx - c * 0.1, gy - sn * 0.1, s * z, 0, 0, el);
      t.rod(P.steel, 0.036, 0.5, gx + c * 0.38, gy + sn * 0.38, s * z, 0, 0, el, 6);
      t.rod(P.gun, 0.019, L, gx + c * (L / 2 + 0.15), gy + sn * (L / 2 + 0.15), s * z, 0, 0, el, 6);
      t.rod(P.gun, 0.03, 0.1, gx + c * (L + 0.1), gy + sn * (L + 0.1), s * z, 0, 0, el, 6);
    }
    t.box(P.base, 0.54, 0.42, 0.22, 0.0, y0 + 0.02, s * 0.73, 0, 0, el); t.box(P.dark, 0.54, 0.02, 0.222, -0.035, y0 + 0.2, s * 0.73, 0, 0, el);
    t.box(P.base, 0.5, 0.86, 0.035, 0.06, y0 + 0.08, s * 0.24); t.box(P.owner, 0.5, 0.03, 0.04, 0.06, y0 + 0.52, s * 0.24);
  }
  t.box(P.base, 0.035, 0.42, 0.44, 0.36, y0 + 0.2, 0, 0, 0, 0.15); t.box(P.owner, 0.04, 0.03, 0.44, 0.33, y0 + 0.42, 0);
  return {
    hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -0.94),
    turretAt: [-1.3, 0.94, 0], tip: [x0 + c * (L + 0.15), y0 + sn * (L + 0.15), 0],
  };
}

// ---------------------------------------------------------------- Panzerwerfer 42 on the Maultier

// ten rocket tubes in two rows of five along +x, open at the front (a dark bore in each), centered on the origin
function tubeBundle(p, P, len, r, gap, paints) {
  const tube = once(`wtube|${len}|${r}`, () => turn([[r, -len / 2], [r, len / 2], [r * 0.74, len / 2]], 8, 'x'));
  const bore = once(`wbore|${r}`, () => new THREE.CircleGeometry(r * 0.74, 8).rotateY(Math.PI / 2));
  for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) {
    const y = (j - 0.5) * gap, z = (i - 2) * gap;
    p.mat(tube, paints[(i + 3 * j) % paints.length], G.xf(0, y, z));
    p.mat(bore, P.hole, G.xf(len / 2 - 0.05, y, z));
  }
}

function panzerwerfer(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 4.6, 0.14, 1.1, -0.05, 0.64, 0); // chassis
  // the armored body over the engine and the cab: an upright grille plate, a short hood rising to the cab, the cab's
  // sloped front plate, a flat roof, sides leaning in a little
  h.mat(hullOf([
    [2.44, [0.5, 0.7], [0.54, 1.18], [0.38, 1.42], [0.5, 1.32]],
    [1.78, [0.56, 0.68], [0.64, 1.2], [0.48, 1.58], [0.62, 1.42]],
    [1.6, [0.8, 0.86], [0.9, 1.24], [0.72, 1.6], [0.86, 1.5]],
    [1.32, [0.8, 0.86], [0.9, 1.24], [0.72, 2.02], [0.86, 1.5]],
    [0.18, [0.8, 0.86], [0.9, 1.24], [0.72, 2.02], [0.86, 1.5]],
  ]), P.base);
  // the louvred grille, the bumper, the front fenders and headlamps, the vision slits
  h.box(P.deep, 0.03, 0.46, 0.72, 2.455, 0.98, 0);
  for (let i = 0; i < 6; i++) h.box(P.mid, 0.03, 0.03, 0.66, 2.47, 0.79 + i * 0.075, 0);
  h.box(P.mid, 0.08, 0.12, 1.5, 2.5, 0.68, 0);
  for (const s of [1, -1]) {
    wheel(h, P, 0.4, 0.28, 1.98, 0.4, s * 0.84, s, { seg: 16 });
    fender(h, P.base, 1.98, 0.4, s * 0.86, 0.4, 0.36, -82, 80, 5, { gap: 0.08 });
    lamp(h, P, 2.3, 1.02, s * 0.72);
    h.box(P.black, 0.03, 0.035, 0.24, 1.48, 1.78, s * 0.34, 0, 0, 0.98);
    h.box(P.black, 0.24, 0.035, 0.02, 0.8, 1.76, s * 0.84, -s * 0.23, 0, 0);
    h.box(P.dark, 0.012, 0.66, 0.012, 0.4, 1.5, s * 0.885, -s * 0.15, 0, 0); h.box(P.dark, 0.012, 0.66, 0.012, 1.2, 1.5, s * 0.885, -s * 0.15, 0, 0); // the door
    sideMark(h, P, fac, 0.2, 0.75, 1.62, 0.86 - 0.12 * 0.23, s, 0.23);
  }
  // the armored rear body (closed, the launcher rides on its roof): upright sides with a bevel to the flat deck, a roof
  // hatch, the rear door, a stowage box on each side
  h.mat(hullOf([[-2.48, [0.98, 0.88], [0.98, 1.36], [0.88, 1.48]], [0.18, [0.98, 0.88], [0.98, 1.36], [0.88, 1.48]]]), P.base);
  h.box(P.mid, 0.5, 0.03, 0.56, -0.3, 1.49, 0); h.box(P.steel, 0.06, 0.04, 0.12, -0.08, 1.5, 0.18);
  h.box(P.dark, 0.012, 0.42, 0.62, -2.485, 1.1, 0); h.box(P.steel, 0.02, 0.04, 0.14, -2.49, 1.12, 0.2);
  for (const s of [1, -1]) {
    h.box(P.dark, 2.6, 0.012, 0.012, -1.15, 1.17, s * 0.985);
    h.box(P.mid, 0.5, 0.26, 0.12, -0.35, 1.2, s * 1.04); h.box(P.dark, 0.5, 0.02, 0.122, -0.35, 1.3, s * 1.04);
    // the runs: a toothed sprocket, four big spoked road wheels, the idler
    trackRun(h, P, s, 0.72, 0.3, [[0.95, 0.52, 0.24], [0.36, 0.33, 0.26], [-0.32, 0.33, 0.26], [-1.0, 0.33, 0.26], [-1.68, 0.33, 0.26], [-2.22, 0.5, 0.22]], P.mid, { spokes: 5 });
  }
  // the camouflage: olive and red-brown blotches over the dunkelgelb, on the sides, the roof and the hood
  for (const s of [1, -1]) {
    patch(h, P.olive, blob(0.42, 1.74, 0.22, 0.17, 1), 1.5, 0.86, 0.23, s);
    patch(h, P.brown, blob(1.02, 1.7, 0.2, 0.14, 2), 1.5, 0.86, 0.23, s);
    patch(h, P.brown, blob(-2.1, 1.12, 0.3, 0.16, 3), 1.2, 0.98, 0, s);
    patch(h, P.olive, blob(-1.38, 1.08, 0.28, 0.15, 4), 1.2, 0.98, 0, s);
    patch(h, P.brown, blob(-0.6, 1.14, 0.26, 0.15, 5), 1.2, 0.98, 0, s);
  }
  roofPatch(h, P.olive, blob(0.6, -0.34, 0.3, 0.22, 6), 2.02);
  roofPatch(h, P.brown, blob(1.0, 0.36, 0.24, 0.2, 7), 2.02);
  roofPatch(h, P.olive, blob(-0.75, -0.45, 0.28, 0.2, 8), 1.48); roofPatch(h, P.brown, blob(-2.1, 0.45, 0.26, 0.2, 9), 1.48);
  aerial(h, P, 0.3, 2.02, 0.66, 0.9);

  // the launcher on a turntable on the roof: a swing frame of two side brackets on a trunnion, the ten tubes in their
  // frame bands (the middle band is the owner's color), raised a little
  const el = 0.32, c = Math.cos(el), sn = Math.sin(el), len = 1.6, hinge = [0.05, 0.5];
  t.add(CYL8, P.mid, 0, 0.05, 0, 0, 0, 0, 0.56, 0.1, 0.56); t.add(CYL8, P.steel, 0, 0.17, 0, 0, 0, 0, 0.3, 0.14, 0.3);
  for (const s of [1, -1]) t.mat(G.extrudeProfile([[-0.36, 0.12], [0.36, 0.12], [0.12, hinge[1] + 0.06], [-0.04, hinge[1] + 0.06]], 0.05), P.base, G.xf(0, 0, s * 0.62));
  t.rod(P.steel, 0.05, 1.3, hinge[0], hinge[1], 0, 0, Math.PI / 2, 0);
  const b = parts();
  tubeBundle(b, P, len, 0.1, 0.22, [P.base, P.mid, P.base, P.olive, P.mid, P.base, P.base]);
  for (const x of [-len / 2 + 0.14, len / 2 - 0.16]) b.box(P.dark, 0.07, 0.48, 1.16, x, 0, 0);
  b.box(P.owner, 0.045, 0.47, 1.15, 0, 0, 0); b.box(P.dark, 0.04, 0.46, 1.12, -len / 2 + 0.01, 0, 0);
  b.box(P.steel, 0.5, 0.06, 0.3, -0.05, -0.27, 0);
  t.put(b, G.xf(hinge[0], hinge[1] + 0.24, 0, 0, 0, el));
  return {
    hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -1.48),
    turretAt: [-1.3, 1.48, 0], tip: [hinge[0] + (c * len) / 2 - sn * 0.24, hinge[1] + 0.24 * c + (sn * len) / 2, 0],
  };
}

// ---------------------------------------------------------------- Katyusha on a Studebaker

// an M-13 rocket along +x, tail at x = 0, nose at x = len: a grey body, an ogive head and two crossed dark fins
function rocket(r = 0.1, len = 1.7) {
  return once(`m13|${r}|${len}`, () => {
    const body = turn([[r * 0.7, 0], [r, len * 0.08], [r, len * 0.74], [r * 0.82, len * 0.86], [0, len]], 8, 'x');
    const fins = [0, Math.PI / 2].flatMap((rot) => [0, Math.PI].map((a) => ({ geo: PLANE, color: 0x2a2a28, mat: 'gunmetal', matrix: G.xf(0.02, 0, 0, rot, a, 0, 0.36, r * 3.2, 1) })));
    return G.merge([{ geo: body, color: 0x6f726b, mat: 'armor-paint' }, ...fins]);
  });
}

function katyusha(P, fac) {
  const h = parts(), t = parts();
  h.box(P.deep, 5.1, 0.16, 0.9, -0.1, 0.8, 0); // the frame rails
  // the long hood with rounded shoulders, the cab with its rounded roof, the windshield and side windows
  h.mat(hullOf([
    [2.62, [0.48, 0.8], [0.52, 1.3], [0.36, 1.5], [0.48, 1.44]],
    [2.3, [0.5, 0.78], [0.56, 1.32], [0.4, 1.56], [0.53, 1.5]],
    [1.25, [0.52, 0.78], [0.58, 1.34], [0.42, 1.6], [0.55, 1.54]],
  ]), P.base);
  h.mat(hullOf([
    [1.25, [0.84, 0.84], [0.86, 1.34], [0.66, 1.66], [0.83, 1.6]],
    [1.05, [0.84, 0.84], [0.86, 1.34], [0.66, 2.1], [0.84, 1.98]],
    [-0.15, [0.84, 0.84], [0.86, 1.34], [0.66, 2.12], [0.84, 2.0]],
  ]), P.base);
  for (const s of [1, -1]) {
    h.box(P.glass, 0.025, 0.36, 0.58, 1.14, 1.85, s * 0.35, 0, 0, 1.15 - Math.PI / 2);
    h.box(P.glass, 0.5, 0.3, 0.02, 0.5, 1.8, s * 0.845);
    h.box(P.dark, 0.012, 0.86, 0.012, -0.05, 1.4, s * 0.86); h.box(P.steel, 0.08, 0.025, 0.025, 0.85, 1.5, s * 0.865); // the door line and handle
    h.box(P.base, 1.1, 0.04, 0.3, 0.55, 0.86, s * 0.94); // the running board
    sideMark(h, P, fac, 0.15, 0.45, 1.2, 0.86, s, 0);
    // big rounded front fenders, flat fenders over the rear axles, the headlamps
    fender(h, P.base, 1.6, 0.48, s * 0.84, 0.48, 0.44, -66, 72, 5, { gap: 0.07 });
    h.box(P.base, 2.1, 0.04, 0.36, -1.5, 1.04, s * 0.86); h.box(P.base, 0.04, 0.3, 0.36, -2.56, 0.9, s * 0.86);
    lamp(h, P, 2.32, 1.18, s * 0.74, 0.07);
    for (let i = 0; i < 4; i++) h.box(P.dark, 0.2, 0.02, 0.012, 2.0, 1.2 + i * 0.05, s * 0.55); // hood side louvres
  }
  // the grille of upright bars, the bumper, the spare wheel behind the cab, a fuel tank, the aerial
  h.box(P.deep, 0.03, 0.54, 0.7, 2.63, 1.08, 0);
  for (let i = 0; i < 7; i++) h.box(P.mid, 0.03, 0.5, 0.035, 2.645, 1.08, (i - 3) * 0.1);
  h.box(P.dark, 0.1, 0.14, 1.66, 2.69, 0.8, 0);
  wheel(h, P, 0.42, 0.24, -0.34, 1.48, -0.5, 1, { seg: 16, ry: -Math.PI / 2 });
  h.add(CYL8, P.mid, -0.5, 0.95, 0.66, Math.PI / 2, 0, 0, 0.18, 0.32, 0.18);
  aerial(h, P, 0.1, 2.1, 0.8, 0.9);
  // the deck and its low sides
  h.box(P.deep, 2.55, 0.08, 1.8, -1.45, 1.0, 0);
  for (const s of [1, -1]) h.box(P.base, 2.55, 0.18, 0.05, -1.45, 1.12, s * 0.9);
  h.box(P.base, 0.05, 0.18, 1.8, -2.72, 1.12, 0);
  for (const x of [1.6, -0.95, -2.05]) for (const s of [1, -1]) wheel(h, P, 0.48, 0.32, x, 0.48, s * 0.86, s, { seg: 16 });
  for (const s of [1, -1]) h.box(P.steel, 0.1, 0.46, 0.1, -2.7, 0.84, s * 0.7); // the jacks

  // the launcher: a turntable, an A-frame of tubes up to the rails, eight perforated rails raised toward the front with
  // a rocket on each, fins out past the back; the rear cross-tie is the owner's color
  const el = 0.28, c = Math.cos(el), sn = Math.sin(el), RL = 4.0, H = [-1.35, 0.72];
  t.add(CYL8, P.steel, 0, 0.06, 0, 0, 0, 0, 0.45, 0.12, 0.45);
  const pt = (u, dy = 0, z = 0) => [H[0] + u * RL * c - dy * sn, H[1] + u * RL * sn + dy * c, z]; // a point along the rails, dy above the web
  for (const s of [1, -1]) {
    t.box(P.dark, 0.12, 0.6, 0.12, H[0], 0.36, s * 0.5);
    t.mat(G.tube([[0.25, 0.1, s * 0.5], pt(0.55, -0.14, s * 0.5)], 0.07, { radial: 6 }), P.base);
    t.mat(G.tube([[-0.5, 0.1, s * 0.5], pt(0.3, -0.14, s * 0.5)], 0.05, { radial: 6 }), P.base);
    t.mat(G.tube([[-0.5, 0.1, s * 0.5], pt(0.55, -0.14, s * 0.5)], 0.035, { radial: 5 }), P.base); // the diagonal
  }
  for (const u of [0.3, 0.55, 0.85]) t.mat(G.tube([pt(u, -0.14, -0.94), pt(u, -0.14, 0.94)], 0.035, { radial: 5 }), P.dark);
  const rails = parts();
  for (let i = 0; i < 8; i++) {
    const z = (i - 3.5) * 0.23;
    rails.box(P.base, RL, 0.26, 0.05, RL / 2, 0, z);
    rails.mat(rocket(), P.white, G.xf(-0.3, 0.13 + 0.1, z));
  }
  for (const s of [1, -1]) for (let k = 0; k < 9; k++) rails.mat(CIRC6, P.hole, G.xf(0.35 + k * 0.4, -0.01, s * (3.5 * 0.23 + 0.024), 0, s < 0 ? Math.PI : 0, 0, 0.06));
  rails.box(P.owner, 0.12, 0.06, 1.86, 0.15, -0.14, 0);
  t.put(rails, G.xf(H[0], H[1], 0, 0, 0, el));
  return {
    hull: finish(G.merge(h.list)), turret: finish(G.merge(t.list), -1.04),
    turretAt: [-1.3, 1.04, 0], tip: [H[0] + c * RL, H[1] + sn * RL, 0],
  };
}

// ---------------------------------------------------------------- the registry

// each unit's builder and its paint scheme
const BUILD = {
  armoredcar: [[m8, 'od'], [sdkfz222, 'grey'], [ba64, 'green']],
  flaktrack: [[m16, 'od'], null, null],
  rocket: [null, [panzerwerfer, 'gelb'], [katyusha, 'green']],
};

const FIT = { 'rocket|2': 0.92 };
const cache = new Map();
// The hull and turret geometries of a wheeled unit: { hull, turret, turretAt, tip } (turretAt is the traverse pivot on
// the hull, tip the muzzle point in the turret's own space). look: { vehicle, color } as hex numbers. Cached, shared.
export function wheeledModel(type, fac, look) {
  const key = `${type}|${fac}|${look.vehicle}|${look.color}`;
  let m = cache.get(key);
  if (!m) {
    const [build, scheme] = BUILD[type][fac];
    m = build(paints(look, scheme), fac);
    const k = FIT[`${type}|${fac}`]; // the whole model shrunk to keep the footprint near the old one
    if (k) { m.hull.scale(k, k, k); m.turret.scale(k, k, k); m.turretAt = m.turretAt.map((v) => v * k); m.tip = m.tip.map((v) => v * k); m.hull.computeBoundingSphere(); m.turret.computeBoundingSphere(); }
    cache.set(key, m);
  }
  return m;
}
