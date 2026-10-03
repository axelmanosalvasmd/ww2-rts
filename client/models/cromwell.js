// The Cromwell Mk IV cruiser tank, the UK's medium tank, built to read as a real, weathered vehicle under the model
// textures like the tanks in client/models/armor-lightheavy.js (whose small builders are copied here).
//
// Two vertex-colored geometries: the hull (running gear, tracks and markings included) and the turret, whose origin
// is the turret ring. Drawn in metres from the real tank (6.35 m long over the track guards, 2.9 m wide, 2.5 m tall)
// and scaled by S to the footprint of the other factions' medium tanks. client/unit-models.js puts each geometry
// into one part painted white, so the tank stays two draw calls. Axes as in the other unit models: +x forward, +y up,
// +z the vehicle's right side, the ground at y = 0.
// What each part is made of rides in its vertices (client/models/geom.js MATS): tires are rubber, tracks track steel,
// iron fittings gunmetal, tool handles wood, tarpaulins canvas. The paint is SCC 15 olive drab; the texture does
// the weathering and the markings are plain.
// Markings: the Allied white star in a circle on the engine deck and the turret sides, the WD number (T-number) on
// the hull sides, the red and green arm-of-service square on the nose and the tail. The owner's color is a small
// cue only: the squadron sign (a square, B squadron) on the turret sides and a recognition panel on the turret bin.
import * as THREE from 'three';
import { merge, mirrorZ, loft, lathe, chamferBox, star, place, ao, xf, tag, matId, UNSET } from './geom.js';

const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLS = new Map();
const cylGeo = (n) => CYLS.get(n) || CYLS.set(n, new THREE.CylinderGeometry(1, 1, 1, n)).get(n);
// Albedos biased cool so they render as the color named under the warm sun (see armor-lightheavy.js).
const RUBBER = 0x2b3238, LINK = 0x3d444c, LINK_LIT = 0x5a626b, LINK_DARK = 0x30363d, IRON = 0x434c55, WHITE = 0xd3e3ec, BLACK = 0x17191c;
const LENS = 0xd5dde0, WOOD = 0x756d64, INSIDE = 0x353c44, CANVAS = 0x6d6c58, RED = 0xa2464c, GREEN = 0x3f6650, SOOT = 0x3a3836;
// the UK vehicle color (main.js, SCC 15 olive drab) as the paint that renders like it: a touch cooler and greener
const REPAINT = new Map([[0x565640, 0x555a49]]);
const MAT_OF = new Map([[IRON, 'gunmetal'], [BLACK, 'gunmetal'], [SOOT, 'gunmetal'], [WOOD, 'wood'], [RUBBER, 'rubber'], [CANVAS, 'canvas'],
  [LINK, 'track-steel'], [LINK_LIT, 'track-steel'], [LINK_DARK, 'track-steel']]);
const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
const dim = (c, k) => col(c).clone().multiplyScalar(k);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- building blocks (from armor-lightheavy.js)

// a list of colored parts merged into one geometry at the end; the last argument of each part names its material
function kit() {
  const items = [];
  const k = {
    add(geo, color = 0xffffff, m = new THREE.Matrix4(), mat) { items.push({ geo, color, matrix: m, mat: mat ?? MAT_OF.get(color) }); return k; },
    box(color, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat) { return k.add(BOX, color, xf(x, y, z, rx, ry, rz, w, h, d), mat); },
    // a cylinder r round and len long, standing along y unless turned
    cyl(color, r, len, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, n = 8, mat) { return k.add(cylGeo(n), color, xf(x, y, z, rx, ry, rz, r, len, r), mat); },
    geometry() { return merge(items); },
  };
  return k;
}

// Newell's normal of a polygon outline (not unit length)
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

// flat colored polygons (decals, grilles, track links): poly() takes a convex outline in order, the way it faces,
// the color (one color, or a list with one per point) and optionally what it is made of
function flat(defaultMat) {
  const pos = [], nor = [], cols = [], ids = [], idx = [];
  const f = {
    poly(pts, dir, color, mat) {
      const each = Array.isArray(color) ? color.map(col) : null, c = each ? null : col(color), o = pos.length / 3, l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const id = matId(mat ?? (each ? undefined : MAT_OF.get(color)) ?? defaultMat);
      const [nx, ny, nz] = newell(pts);
      pts.forEach((p, i) => { const k = each ? each[i] : c; pos.push(p[0], p[1], p[2]); nor.push(dir[0] / l, dir[1] / l, dir[2] / l); cols.push(k.r, k.g, k.b); ids.push(id); });
      const flip = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0;
      for (let i = 1; i + 1 < pts.length; i++) if (flip) idx.push(o, o + i + 1, o + i); else idx.push(o, o + i, o + i + 1);
      return f;
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      if (ids.some((v) => v !== UNSET)) g.setAttribute('matId', new THREE.Float32BufferAttribute(ids, 1));
      g.setIndex(idx);
      return g;
    },
  };
  return f;
}

// vertex colors from fn(position, normal)
function paintBy(geo, fn) {
  const P = geo.attributes.position, N = geo.attributes.normal, out = new Float32Array(P.count * 3), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) col(fn(p.fromBufferAttribute(P, i), n.fromBufferAttribute(N, i))).toArray(out, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

// a loft standing up: rings [{ y, pts: [[x, z], ...] }] from the bottom up, each a plan-view outline
function vloft(rings, opts) {
  return loft(rings.map((r) => ({ x: r.y, pts: r.pts.map(([x, z]) => [z, -x]) })), opts).rotateZ(Math.PI / 2);
}

// Rings around the z axis from a profile of bands [[r0, z0], [r1, z1], color, colorB, colorEnd, mat] (see
// armor-lightheavy.js): smooth around the axis, hard between bands; colorB alternates quad by quad.
function bands(list, seg) {
  const pos = [], nor = [], cols = [], ids = [], idx = [];
  const vert = (r, z, a, nr, nz, c, m) => { pos.push(r * Math.cos(a), r * Math.sin(a), z); nor.push(nr * Math.cos(a), nr * Math.sin(a), nz); cols.push(c.r, c.g, c.b); ids.push(m); return pos.length / 3 - 1; };
  for (const [[r0, z0], [r1, z1], ca, cb, ce, mat] of list) {
    const dr = r1 - r0, dz = z1 - z0, l = Math.hypot(dr, dz), nr = dz / l, nz = -dr / l, A = col(ca), B = cb == null ? null : col(cb), E = ce == null ? A : col(ce), m = matId(mat);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, hole = B && i % 2, c = hole ? B : A, e = hole ? B : E;
      if (r1 < 1e-6) { idx.push(vert(r0, z0, a0, nr, nz, c, m), vert(r0, z0, a1, nr, nz, c, m), vert(0, z1, (a0 + a1) / 2, nr, nz, e, m)); continue; }
      const p = vert(r0, z0, a0, nr, nz, c, m), q = vert(r0, z0, a1, nr, nz, c, m), s = vert(r1, z1, a1, nr, nz, e, m), t = vert(r1, z1, a0, nr, nz, e, m);
      idx.push(p, q, s, p, s, t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('matId', new THREE.Float32BufferAttribute(ids, 1));
  g.setIndex(idx);
  return g;
}

// A Christie road wheel, axle along z, outer face toward +z: a deep rubber tire and the pressed disc rising to the
// hub, lit at the rim and darker toward the middle. rubber = false makes the rim bare steel; spokes > 0 cuts that
// many dark holes round the disc (the idler, so it does not read as a sixth road wheel). The back is open: it faces
// the hull. simple: the inner disc of a pair, which shows only through the gap (one flat face, dark at the rim).
function christieWheel(R, w, paint, { seg = 32, rubber = true, spokes = 0, simple = false } = {}) {
  const h = w / 2, tm = rubber ? 'rubber' : null, tire = rubber ? RUBBER : dim(paint, 0.85), Rr = R * (rubber ? 0.84 : 0.9);
  if (simple) return bands([
    [[R, -h], [R, h * 0.6], tire, null, null, tm],
    [[R, h * 0.6], [Rr, h], tire, null, null, tm],
    [[Rr, h], [0, h * 1.2], dim(paint, 0.5), null, paint],
  ], seg);
  return bands([
    [[R, -h], [R, h * 0.5], tire, null, null, tm], [[R, h * 0.5], [Rr, h], tire, null, null, tm],
    [[Rr, h], [Rr * 0.93, h * 1.12], dim(paint, 1.12)],
    [[Rr * 0.93, h * 1.12], [R * 0.35, h * 0.62], paint, spokes ? dim(paint, 0.22) : null, dim(paint, 0.75)],
    [[R * 0.35, h * 0.62], [R * 0.26, h * 1.35], dim(paint, 0.85)],
    [[R * 0.26, h * 1.35], [R * 0.21, h * 1.55], dim(paint, 1.05)],
    [[R * 0.21, h * 1.55], [0, h * 1.55], dim(paint, 0.9)],
  ], spokes ? Math.max(seg, spokes * 4) : seg);
}

// A drive sprocket, axle along z, outer face toward +z: a toothed plate with worn-steel tooth edges and a hub.
function sprocketWheel(R, w, teeth, paint) {
  const F = flat(), h = w / 2, step = TAU / teeth, rr = R * 0.8, ring = [], face = col(paint), edge = col(LINK_LIT);
  const tooth = [[-0.3, rr], [-0.12, R], [0.12, R], [0.3, rr]];
  for (let k = 0; k < teeth; k++) for (const [t, r] of tooth) { const a = (k + t) * step; ring.push([r * Math.cos(a), r * Math.sin(a)]); }
  const per = tooth.length;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    F.poly([[0, 0, h], [p[0], p[1], h], [q[0], q[1], h]], [0, 0, 1], face);
    if (i % per === per - 1) return; // the root arc between two teeth faces the hub
    F.poly([[p[0], p[1], -h], [q[0], q[1], -h], [q[0], q[1], h], [p[0], p[1], h]], [q[1] - p[1], p[0] - q[0], 0], edge, 'track-steel');
  });
  // six lightening holes in the plate
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.26, cx = R * 0.55 * Math.cos(a), cy = R * 0.55 * Math.sin(a), pts = [];
    for (let j = 0; j < 4; j++) { const b = (j / 4) * TAU + a; pts.push([cx + R * 0.11 * Math.cos(b), cy + R * 0.11 * Math.sin(b), h + 0.004]); }
    F.poly(pts, [0, 0, 1], dim(paint, 0.25));
  }
  const hub = dim(paint, 0.7);
  return merge([F.geometry(), bands([[[R * 0.36, h], [R * 0.3, h * 2.2], hub], [[R * 0.3, h * 2.2], [0, h * 2.3], dim(hub, 0.9)]], 6)]);
}

// The track around a set of wheels, lying in xy (axles along z) between z - width/2 and z + width/2 (see
// armor-lightheavy.js). Here the top run rests on the road wheel tops: between the wheels at xs it sags by `sag`.
function trackBelt(circles, z, width, { thick = 0.12, pitch = 0.17, sag = 0, xs = [], color = LINK, edge = LINK_LIT, back = LINK_DARK } = {}) {
  const pts = [];
  for (const [x, y, r] of circles) for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU; pts.push([x + (r + thick / 2) * Math.cos(a), y + (r + thick / 2) * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const hull = lo.slice(0, -1).concat(hi.slice(0, -1)), loop = [];
  // long straight runs cut into short steps, so the sag can bend the top run
  const yTop = Math.max(...hull.map((p) => p[1])) - 0.08, x0 = Math.min(...xs), x1 = Math.max(...xs), gap = xs.length > 1 ? (x1 - x0) / (xs.length - 1) : 1;
  hull.forEach((a, i) => {
    const b = hull[(i + 1) % hull.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.08));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      loop.push([x, sag && y > yTop && x > x0 && x < x1 ? y - sag * Math.abs(Math.sin((Math.PI * (x - x0)) / gap)) : y]);
    }
  });
  const len = [0];
  for (let i = 1; i <= loop.length; i++) { const a = loop[i - 1], b = loop[i % loop.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[loop.length], n = Math.round(total / pitch), step = total / n;
  const at = (s) => {
    let a = 0, b = loop.length;
    while (b - a > 1) { const m = (a + b) >> 1; if (len[m] <= s) a = m; else b = m; }
    const p = loop[a], q = loop[(a + 1) % loop.length], t = (s - len[a]) / Math.max(1e-9, len[a + 1] - len[a]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const F = flat('track-steel'), z0 = z - width / 2, z1 = z + width / 2, h = thick / 2, lit = col(color), dark = dim(color, 0.84), rim = col(edge), rim2 = dim(edge, 0.84), deep = col(back);
  for (let k = 0; k < n; k++) {
    const A = at(k * step + step * 0.03), B = at((k + 1) * step - step * 0.03), A0 = at(k * step), B0 = at((k + 1) * step), l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = (B[1] - A[1]) / l, ny = (A[0] - B[0]) / l; // outward
    const Ao = [A[0] + nx * h, A[1] + ny * h], Bo = [B[0] + nx * h, B[1] + ny * h], Ai = [A0[0] - nx * h, A0[1] - ny * h], Bi = [B0[0] - nx * h, B0[1] - ny * h];
    F.poly([[Ao[0], Ao[1], z0], [Bo[0], Bo[1], z0], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [nx, ny, 0], k % 2 ? lit : dark);
    F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bi[0], Bi[1], z1], [Ai[0], Ai[1], z1]], [-nx, -ny, 0], deep);
    // A solid transverse cleat has a worn crown and four vertical edges.
    // Cleats on the exposed run leave the original ground contact unchanged.
    if (ny > -0.85) {
      const rise = 0.038, za = z0 + 0.025, zb = z1 - 0.025;
      const point = (t, r, zz) => [Ao[0] + (Bo[0] - Ao[0]) * t + nx * r, Ao[1] + (Bo[1] - Ao[1]) * t + ny * r, zz];
      const a = point(0.34, 0, za), b = point(0.66, 0, za), c = point(0.66, 0, zb), d = point(0.34, 0, zb);
      const ca = point(0.34, rise, za), cb = point(0.66, rise, za), cc = point(0.66, rise, zb), cd = point(0.34, rise, zb);
      const tx = (cb[0] - ca[0]) / l, ty = (cb[1] - ca[1]) / l;
      F.poly([ca, cb, cc, cd], [nx, ny, 0], rim);
      F.poly([a, ca, cd, d], [-tx, -ty, 0], dark);
      F.poly([b, cb, cc, c], [tx, ty, 0], dark);
      F.poly([a, b, cb, ca], [0, 0, -1], rim2);
      F.poly([d, c, cc, cd], [0, 0, 1], rim2);
    }
    F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bo[0], Bo[1], z0], [Ao[0], Ao[1], z0]], [0, 0, -1], deep);
    const r = k % 2 ? rim : rim2;
    F.poly([[Ai[0], Ai[1], z1], [Bi[0], Bi[1], z1], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [0, 0, 1], [deep, deep, r, r]);
  }
  return F.geometry();
}

// a gun tube along +x from x = 0: breech sleeve, taper, a muzzle swell; the bore is a dark dot. Painted, gunmetal.
function gunTube(L, r, paint, { lip = 0.05, lipR = 1.18, seg = 10 } = {}) {
  const g = lathe([[r * 1.35, 0], [r * 1.35, 0.14], [r, 0.2], [r * 0.86, L - lip - 0.06], [r * lipR, L - lip], [r * lipR, L], [0, L]], seg, { axis: 'x' });
  return tag(paintBy(g, (p) => (Math.hypot(p.y, p.z) < 1e-4 ? col(BLACK) : col(paint))), 'gunmetal');
}

// louvres on a deck at height y: a dark recess and n bars across x (or across z with alongZ)
function grille(F, x0, x1, z0, z1, y, n, bar, { alongZ = false, gap = INSIDE } = {}) {
  F.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], gap, 'gunmetal');
  if (alongZ) {
    const step = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      const a = z0 + (i + 0.2) * step, b = a + step * 0.6;
      F.poly([[x0 + 0.03, y + 0.006, a], [x1 - 0.03, y + 0.006, a], [x1 - 0.03, y + 0.006, b], [x0 + 0.03, y + 0.006, b]], [0, 1, 0], bar);
    }
    return;
  }
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + (i + 0.2) * step, b = a + step * 0.6;
    F.poly([[a, y + 0.006, z0 + 0.03], [b, y + 0.006, z0 + 0.03], [b, y + 0.006, z1 - 0.03], [a, y + 0.006, z1 - 0.03]], [0, 1, 0], bar);
  }
}
// a round lens facing +x at (x, y, z)
function lens(F, x, y, z, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; pts.push([x, y + r * Math.sin(a), z + r * Math.cos(a)]); }
  F.poly(pts, [1, 0, 0], LENS, 'plain');
}
// a row of bolt heads along a line: n small squares from a to b (3D points) on a plane facing dir
function rivets(F, a, b, n, dir, color, s = 0.02) {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(ux, uy, uz) || 1;
  const side = [uy * dir[2] - uz * dir[1], uz * dir[0] - ux * dir[2], ux * dir[1] - uy * dir[0]], sl = Math.hypot(...side) || 1;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), c = [a[0] + ux * t, a[1] + uy * t, a[2] + uz * t];
    const e = [(ux / l) * s, (uy / l) * s, (uz / l) * s], g = [(side[0] / sl) * s, (side[1] / sl) * s, (side[2] / sl) * s];
    F.poly([[c[0] - e[0] - g[0], c[1] - e[1] - g[1], c[2] - e[2] - g[2]], [c[0] + e[0] - g[0], c[1] + e[1] - g[1], c[2] + e[2] - g[2]],
      [c[0] + e[0] + g[0], c[1] + e[1] + g[1], c[2] + e[2] + g[2]], [c[0] - e[0] + g[0], c[1] - e[1] + g[1], c[2] - e[2] + g[2]]], dir, color);
  }
}
// bolts round the edge of a rectangle on a face: the face's plane is spanned by unit vectors u and v from its
// middle c, w by h, facing dir; every `pitch` or so
function boltFrame(F, c, u, v, w, h, dir, color, pitch = 0.16, inset = 0.035, ends = true) {
  const p = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b];
  const a = w / 2 - inset, b = h / 2 - inset, nu = Math.max(2, Math.round((2 * a) / pitch) + 1), nv = Math.max(2, Math.round((2 * b) / pitch) + 1);
  rivets(F, p(-a, b), p(a, b), nu, dir, color, 0.016);
  rivets(F, p(-a, -b), p(a, -b), nu, dir, color, 0.016);
  if (ends && nv > 2) { const d = (2 * b) / (nv - 1); rivets(F, p(-a, -b + d), p(-a, b - d), nv - 2, dir, color, 0.016); rivets(F, p(a, -b + d), p(a, b - d), nv - 2, dir, color, 0.016); }
}
// Stenciled characters facing +z, h tall, centered on the origin, in seven-segment strokes (digits and the T of a
// WD number). Flat paint, no texture.
const W7 = 0.58, T7 = 0.2;
const SEG7 = { a: [0, 1 - T7, W7, 1], b: [W7 - T7, 0.5, W7, 1], c: [W7 - T7, 0, W7, 0.5], d: [0, 0, W7, T7], e: [0, 0, T7, 0.5], f: [0, 0.5, T7, 1], g: [0, 0.5 - T7 / 2, W7, 0.5 + T7 / 2], t: [W7 / 2 - T7 / 2, 0, W7 / 2 + T7 / 2, 1] };
const GLYPHS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', T: 'at' };
function stencil(text, h, color) {
  const F = flat('plain'), w = W7 * h, gap = 0.26 * h, total = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, i) => {
    const x0 = -total / 2 + i * (w + gap);
    for (const s of GLYPHS[ch]) {
      const [a, b, c, d] = SEG7[s], X0 = x0 + a * h, X1 = x0 + c * h, Y0 = (b - 0.5) * h, Y1 = (d - 0.5) * h;
      F.poly([[X0, Y0, 0.006], [X1, Y0, 0.006], [X1, Y1, 0.006], [X0, Y1, 0.006]], [0, 0, 1], color);
    }
  });
  return F.geometry();
}
// The arm-of-service square facing +z, s across: red over green, the unit's number in white on it.
function armSign(s, text) {
  const F = flat('plain'), e = s / 2;
  F.poly([[-e, 0, 0.004], [e, 0, 0.004], [e, e, 0.004], [-e, e, 0.004]], [0, 0, 1], RED);
  F.poly([[-e, -e, 0.004], [e, -e, 0.004], [e, 0, 0.004], [-e, 0, 0.004]], [0, 0, 1], GREEN);
  return merge([F.geometry(), stencil(text, s * 0.5, WHITE)]);
}
// The squadron sign facing +z: a hollow square s across in the owner's color, a dark outline, the troop's number in it.
function squadronSign(s, color, text) {
  const F = flat('plain'), e = s / 2, t = s * 0.14, o = 0.012, band = (x0, y0, x1, y1, c, z) => F.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], c);
  band(-e - o, -e - o, e + o, e + o, BLACK, 0.002);
  band(-e, e - t, e, e, color, 0.005); band(-e, -e, e, -e + t, color, 0.005); band(-e, -e + t, -e + t, e - t, color, 0.005); band(e - t, -e + t, e, e - t, color, 0.005);
  band(-e + t, -e + t, e - t, e - t, dim(BLACK, 2.2), 0.004);
  return merge([F.geometry(), stencil(text, s * 0.5, color)]);
}
// an owner-color recognition panel lying on a roof at height y: x0..x1 along the vehicle, z0..z1 across, a dark border
function roofPanel(F, x0, x1, z0, z1, y, color) {
  const e = 0.025;
  F.poly([[x0 - e, y, z0 - e], [x1 + e, y, z0 - e], [x1 + e, y, z1 + e], [x0 - e, y, z1 + e]], [0, 1, 0], BLACK, 'plain');
  F.poly([[x0, y + 0.004, z0], [x1, y + 0.004, z0], [x1, y + 0.004, z1], [x0, y + 0.004, z1]], [0, 1, 0], color, 'plain');
}
// loft sections: a box [z, y] ring, and one with its top edges chamfered by c
const box4 = (x, y0, y1, z) => ({ x, pts: [[z, y0], [z, y1], [-z, y1], [-z, y0]] });
const deck = (x, y0, y1, z, c = 0.03) => ({ x, pts: [[z, y0], [z, y1 - c], [z - c, y1], [c - z, y1], [-z, y1 - c], [-z, y0]] });
const FLAT = { normals: 'flat' };

// ---------------------------------------------------------------- Cromwell Mk IV

// Flat slab-sided box hull: the vertical front plate with the driver's visor door (right) and the hull Besa in its
// ball (left), a short glacis over the nose, a long flat deck with the two front hatches, the engine doors and the
// radiator louvres at the back, the armored rear louvre over the tail and the exhaust deflector on the rear plate.
// Christie suspension: five big paired road wheels with rubber tires a side, no return rollers (the narrow track
// sags onto the wheel tops), the idler in front and the drive sprocket at the back. Full-length track guards with
// stowage bins, tools and mud flaps. The turret: a near-square slab box with bolted appliqué plates on its faces,
// the flat external mantlet with the 75 mm and the coaxial Besa, the all-round vision cupola (right) and the loader's
// split hatch (left), two 4-inch smoke dischargers on the right side, the 2-inch bomb thrower in the roof, the big
// stowage bin across the back and the wireless aerial.
const TZ = 1.25, TT = 0.1, RW = 0.4, WY = TT + RW, WHEELS = [1.9, 0.95, 0, -0.95, -1.9];
const IDLER = [2.66, 0.67, 0.28], SPROCKET = [-2.74, 0.62, 0.34];
const SIDE = 1.03, DECK = 1.52, FENDER = 1.1, FRONT = 2.5;
const RING = [0.62, DECK, 0], TH = 0.84, GUN = { x: 1.08, y: 0.4, L: 2.0 };

function cromwellBuild(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, lite = dim(paint, 1.06), H = kit(), T = kit(), G = kit(), GF = flat(), HF = flat(), TF = flat();

  // ---- running gear, right side (mirrored to the left)
  const outer = christieWheel(RW, 0.15, paint), inner = christieWheel(RW, 0.15, dim(paint, 0.7), { seg: 24, simple: true });
  for (const x of WHEELS) {
    G.add(outer, 0xffffff, xf(x, WY, TZ + 0.1)).add(inner, 0xffffff, xf(x, WY, TZ - 0.1));
    G.cyl(IRON, 0.09, 0.29, x, WY, TZ, Math.PI / 2, 0, 0, 20);
    G.add(chamferBox(0.36, 0.11, 0.08, 0.025), dim(paint, 0.7), xf(x - 0.11, WY + 0.1, TZ - 0.17, 0, 0, -0.65));
    G.cyl(dim(paint, 0.8), 0.115, 0.1, x - 0.24, WY + 0.21, TZ - 0.15, Math.PI / 2, 0, 0, 24);
  }
  // the idler in front (bare steel, paired, on its crank) and the sprocket at the back (two toothed rings)
  const idl = christieWheel(IDLER[2], 0.13, dim(paint, 1.05), { rubber: false, spokes: 6 });
  G.add(idl, 0xffffff, xf(IDLER[0], IDLER[1], TZ + 0.1)).add(christieWheel(IDLER[2], 0.13, dim(paint, 0.7), { rubber: false, seg: 24, simple: true }), 0xffffff, xf(IDLER[0], IDLER[1], TZ - 0.1));
  G.box(paint, 0.34, 0.1, 0.08, IDLER[0] - 0.18, IDLER[1] + 0.06, SIDE + 0.06, 0, 0, -0.3);
  G.add(sprocketWheel(SPROCKET[2], 0.08, 9, paint), 0xffffff, xf(SPROCKET[0], SPROCKET[1], TZ + 0.13));
  G.add(bands([[[SPROCKET[2] * 0.9, 0], [0, 0], dim(paint, 0.6)]], 8), 0xffffff, xf(SPROCKET[0], SPROCKET[1], TZ - 0.13)); // the inner ring, seen only through the gap
  G.cyl(dim(paint, 0.8), 0.24, 0.16, SPROCKET[0], SPROCKET[1], SIDE + 0.08, Math.PI / 2, 0, 0, 10); // final drive housing
  G.add(trackBelt([[SPROCKET[0], SPROCKET[1], SPROCKET[2]], ...WHEELS.map((x) => [x, WY, RW]), [IDLER[0], IDLER[1], IDLER[2]]], TZ, 0.38, { thick: TT, pitch: 0.17, sag: 0.035, xs: WHEELS }));
  // the track guard over the track: flat from the tail to the front, bent down over the idler; its outer lip;
  // rubber mud flaps at both ends
  const gw = 0.48, gz = SIDE + gw / 2 - 0.02;
  G.box(paint, 5.62, 0.03, gw, -0.22, FENDER, gz).box(paint, 0.5, 0.03, gw, 2.79, FENDER - 0.08, gz, 0, 0, -0.34);
  G.box(lite, 5.62, 0.06, 0.03, -0.22, FENDER - 0.015, SIDE + gw - 0.02).box(lite, 0.5, 0.06, 0.03, 2.79, FENDER - 0.095, SIDE + gw - 0.02, 0, 0, -0.34);
  G.box(RUBBER, 0.02, 0.3, gw - 0.04, -3.04, FENDER - 0.16, gz, 0, 0, 0, 'rubber').box(RUBBER, 0.02, 0.18, gw - 0.04, 3.02, FENDER - 0.26, gz, 0, 0, -0.12, 'rubber');
  // the hull side above the guard: the engine bulkhead seam and its bolts, the tow cable in its clamps
  GF.poly([[-0.42, FENDER + 0.02, SIDE + 0.003], [-0.4, FENDER + 0.02, SIDE + 0.003], [-0.4, DECK - 0.02, SIDE + 0.003], [-0.42, DECK - 0.02, SIDE + 0.003]], [0, 0, 1], dim(paint, 0.55));
  rivets(GF, [-0.46, FENDER + 0.1, SIDE + 0.003], [-0.46, DECK - 0.1, SIDE + 0.003], 3, [0, 0, 1], dim(paint, 1.22), 0.016);
  G.cyl(IRON, 0.022, 2.6, -1.55, 1.36, SIDE + 0.03, 0, 0, Math.PI / 2, 6);
  for (const x of [-2.0, -1.1]) G.box(dim(paint, 0.85), 0.05, 0.08, 0.05, x, 1.36, SIDE + 0.03);
  G.box(IRON, 0.08, 0.1, 0.04, -2.88, 1.36, SIDE + 0.03).box(IRON, 0.08, 0.1, 0.04, -0.22, 1.36, SIDE + 0.03);
  G.add(GF.geometry());
  H.add(mirrorZ(G.geometry()));

  // ---- the hull: lower hull between the tracks, the box above it, the vertical front plate at x = FRONT, the short
  // glacis to the nose and the lower nose plate back down to the belly; the rear plate
  H.add(loft([box4(-3.0, 0.7, 1.42, SIDE), box4(-2.84, 0.46, DECK, SIDE), deck(FRONT, 0.46, DECK, SIDE), box4(FRONT + 0.001, 0.46, 1.04, SIDE),
    box4(2.76, 0.46, 0.9, SIDE), box4(2.96, 0.74, 0.8, SIDE)], FLAT), paint);
  // the glacis: a row of spare track links hung on it, tow shackles on the nose, the transmission access plate
  const ga = -Math.atan2(0.24, 0.46), gn = [0.463, 0.886, 0], gl = (u, z, lift) => [FRONT + 0.46 * u + gn[0] * lift, 1.04 - 0.24 * u + gn[1] * lift, z];
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * 0.3;
    H.box(i % 2 ? LINK : dim(LINK, 0.88), 0.3, 0.035, 0.27, ...gl(0.5, z, 0.02), 0, 0, ga, 'track-steel');
  }
  for (const z of [0.62, -0.62]) H.box(IRON, 0.1, 0.16, 0.05, 2.94, 0.66, z).cyl(IRON, 0.035, 0.16, 2.97, 0.6, z, Math.PI / 2, 0, 0, 6);
  // the front plate: the driver's visor door on the right with its slit and hinge, the Besa ball on the left,
  // headlights on the corners with their guards, the arm-of-service sign
  H.box(lite, 0.06, 0.22, 0.4, FRONT + 0.03, 1.33, 0.52).box(BLACK, 0.02, 0.035, 0.26, FRONT + 0.065, 1.35, 0.52).box(IRON, 0.05, 0.03, 0.42, FRONT + 0.03, 1.46, 0.52);
  HF.poly([[FRONT + 0.002, 1.18, 0.28], [FRONT + 0.002, 1.18, 0.76], [FRONT + 0.002, 1.48, 0.76], [FRONT + 0.002, 1.48, 0.28]], [1, 0, 0], dim(paint, 0.82));
  const ball = [];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; ball.push([FRONT + 0.003, 1.28 + 0.17 * Math.sin(a), -0.5 + 0.17 * Math.cos(a)]); }
  HF.poly(ball, [1, 0, 0], dim(paint, 0.55));
  H.add(lathe([[0.14, 0], [0.12, 0.07], [0, 0.1]], 8, { axis: 'x' }), lite, xf(FRONT, 1.28, -0.5), 'cast-armor').cyl(IRON, 0.022, 0.32, FRONT + 0.22, 1.28, -0.5, 0, 0, -Math.PI / 2, 6);
  for (const z of [0.88, -0.88]) {
    H.cyl(IRON, 0.08, 0.12, FRONT + 0.07, 1.38, z, 0, 0, -Math.PI / 2, 6);
    lens(HF, FRONT + 0.132, 1.38, z, 0.065);
    H.box(paint, 0.16, 0.025, 0.025, FRONT + 0.1, 1.48, z);
  }
  H.add(armSign(0.18, '52'), 0xffffff, place([FRONT + 0.006, 1.06 - 0.0, 0.62], [1, 0, 0], [0, 1, 0], 1), 'plain');
  H.add(star(1, { color: WHITE }), 0xffffff, place([FRONT + 0.004, 1.15, 0.0], [1, 0, 0], [0, 1, 0], 0.08), 'plain');
  // the deck: the driver's (right) and hull gunner's (left) hatches with their periscopes
  for (const z of [0.52, -0.52]) {
    H.box(dim(paint, 1.08), 0.52, 0.04, 0.46, 2.12, DECK + 0.02, z).box(IRON, 0.04, 0.05, 0.4, 2.36, DECK + 0.03, z);
    H.box(IRON, 0.12, 0.08, 0.14, 2.02, DECK + 0.07, z);
  }
  // the engine deck: the two big engine doors, the fuel fillers, the radiator louvres either
  // side at the back, the air recognition star in its circle
  for (const z of [0.36, -0.36]) {
    H.box(dim(paint, 1.04), 1.1, 0.035, 0.66, -1.0, DECK + 0.017, z);
  }
  HF.poly([[-1.55, DECK + 0.036, -0.012], [-0.45, DECK + 0.036, -0.012], [-0.45, DECK + 0.036, 0.012], [-1.55, DECK + 0.036, 0.012]], [0, 1, 0], dim(paint, 0.5));
  for (const z of [0.88, -0.88]) H.cyl(IRON, 0.07, 0.06, -0.35, DECK + 0.02, z, 0, 0, 0, 6);
  for (const z of [0.6, -0.6]) {
    grille(HF, -2.72, -1.72, z > 0 ? 0.2 : -0.98, z > 0 ? 0.98 : -0.2, DECK + 0.003, 9, dim(paint, 0.82));
    H.box(dim(paint, 1.1), 1.04, 0.03, 0.04, -2.22, DECK + 0.015, z > 0 ? 0.99 : -0.99).box(dim(paint, 1.1), 1.04, 0.03, 0.04, -2.22, DECK + 0.015, z > 0 ? 0.19 : -0.19);
  }
  H.box(dim(paint, 1.06), 1.0, 0.035, 0.36, -2.22, DECK + 0.017, 0).box(IRON, 0.12, 0.04, 0.05, -1.82, DECK + 0.04, 0);
  H.add(star(1, { color: WHITE, ring: WHITE, segments: 16 }), 0xffffff, place([-1.12, DECK + 0.04, 0], [0, 1, 0], [1, 0, 0], 0.36), 'plain');
  // the tail: the armored louvre hood over the rear plate, the exhaust pipes into the box deflector, the tow hooks,
  // a tail light, the arm-of-service sign, two jerrycans in their rack
  H.box(dim(paint, 0.96), 0.3, 0.05, 2.02, -3.1, 1.38, 0, 0, 0, 0.5);
  for (let i = 0; i < 3; i++) H.box(dim(paint, 0.62), 0.03, 0.02, 1.9, -3.04 - i * 0.08, 1.41 - i * 0.045, 0, 0, 0, 0.5);
  for (const z of [0.12, -0.12]) H.box(dim(paint, 0.9), 0.32, 0.06, 0.04, -3.1, 1.38, z * 7.8, 0, 0, 0.5);
  for (const z of [0.42, -0.42]) H.cyl(SOOT, 0.055, 0.34, -3.06, 1.08, z, 0, 0, 0, 6);
  H.box(SOOT, 0.16, 0.14, 1.2, -3.1, 0.86, 0).box(dim(SOOT, 0.6), 0.02, 0.04, 1.1, -3.18, 0.8, 0);
  for (const z of [0.7, -0.7]) H.box(IRON, 0.1, 0.16, 0.05, -3.04, 0.62, z).cyl(IRON, 0.035, 0.16, -3.07, 0.56, z, Math.PI / 2, 0, 0, 6);
  H.box(RED, 0.03, 0.05, 0.08, -3.01, 1.25, 0.86, 0, 0, 0, 'plain');
  H.add(armSign(0.16, '52'), 0xffffff, place([-3.006, 1.25, -0.66], [-1, 0, 0], [0, 1, 0], 1), 'plain');
  for (const z of [0.66, 0.86]) H.box(dim(paint, 0.92), 0.12, 0.3, 0.18, -3.08, 1.02, -z * 1.15 + 0.0);
  // the track guards: stowage bins (two right, one left), the shovel, pick and crowbar on the left, a rolled tarpaulin
  const bin = (x, z, l, h = 0.3) => {
    H.box(paint, l, h, 0.4, x, FENDER + h / 2 + 0.015, z).box(dim(paint, 1.1), l + 0.02, 0.025, 0.42, x, FENDER + h + 0.02, z);
    H.box(IRON, 0.05, 0.08, 0.02, x, FENDER + h - 0.04, z + Math.sign(z) * 0.205);
    HF.poly([[x - l / 2, FENDER + h - 0.07, z + Math.sign(z) * 0.201], [x + l / 2, FENDER + h - 0.07, z + Math.sign(z) * 0.201], [x + l / 2, FENDER + h - 0.06, z + Math.sign(z) * 0.201], [x - l / 2, FENDER + h - 0.06, z + Math.sign(z) * 0.201]], [0, 0, Math.sign(z)], dim(paint, 0.5));
  };
  bin(1.15, 1.26, 0.9); bin(-1.55, 1.26, 0.8); bin(1.2, -1.26, 0.8);
  H.box(WOOD, 1.05, 0.04, 0.05, -0.9, FENDER + 0.04, -1.36).box(IRON, 0.24, 0.03, 0.18, -0.25, FENDER + 0.03, -1.36);
  H.box(WOOD, 0.9, 0.045, 0.045, -1.0, FENDER + 0.04, -1.14).box(IRON, 0.05, 0.05, 0.42, -0.58, FENDER + 0.05, -1.14);
  H.box(IRON, 1.2, 0.035, 0.035, -2.2, FENDER + 0.04, -1.25);
  H.cyl(CANVAS, 0.12, 0.9, 0.0, FENDER + 0.13, 1.26, 0, 0, Math.PI / 2, 8).box(dim(CANVAS, 0.7), 0.04, 0.25, 0.04, -0.25, FENDER + 0.13, 1.26, 0, 0, 0, 'canvas').box(dim(CANVAS, 0.7), 0.04, 0.25, 0.04, 0.25, FENDER + 0.13, 1.26, 0, 0, 0, 'canvas');
  // the WD number on the hull sides, ahead of the bins
  for (const s of [1, -1]) {
    H.add(stencil('T187436', 0.1, WHITE), 0xffffff, place([0.3, 1.36, s * (SIDE + 0.004)], [0, 0, s], [0, 1, 0], 1), 'plain');
  }
  H.add(HF.geometry());

  // ---- the turret: the ring at RING; a near-square slab box with vertical sides and chamfered corners, the roof
  // sloping a little at the front
  const base = [[0.84, 0.78], [0.74, 0.9], [-0.8, 0.9], [-0.9, 0.8], [-0.9, -0.8], [-0.8, -0.9], [0.74, -0.9], [0.84, -0.78]];
  const top = [[0.78, 0.76], [0.68, 0.88], [-0.79, 0.88], [-0.88, 0.79], [-0.88, -0.79], [-0.79, -0.88], [0.68, -0.88], [0.78, -0.76]];
  // Narrow bevels catch the light along the plate edges, while the broad faces stay flat.
  const inset = (pts, cut) => pts.map(([x, z]) => [x - Math.sign(x) * cut, z - Math.sign(z) * cut]);
  const roof = top.map(([x, z]) => [x > 0 ? x - 0.12 : x, z]);
  T.add(vloft([
    { y: 0, pts: inset(base, 0.025) }, { y: 0.025, pts: base },
    { y: TH - 0.075, pts: top }, { y: TH - 0.06, pts: inset(top, 0.012) },
    { y: TH - 0.015, pts: roof }, { y: TH, pts: inset(roof, 0.015) },
  ], FLAT), paint);
  // a dark line round the turret's foot
  T.add(vloft([{ y: 0, pts: base.map(([x, z]) => [x * 1.01, z * 1.01]) }, { y: 0.04, pts: base.map(([x, z]) => [x * 1.01, z * 1.01]) }], { normals: 'flat', caps: false }), dim(paint, 0.4));
  // the bolted appliqué plates: one on each side and two on the front either side of the mantlet, each a raised
  // slab ringed with bolt heads
  const bolt = dim(paint, 1.25);
  for (const s of [1, -1]) {
    T.add(chamferBox(1.36, 0.66, 0.04, 0.012), lite, xf(-0.06, 0.42, s * 0.915));
    boltFrame(TF, [-0.06, 0.42, s * 0.937], [1, 0, 0], [0, 1, 0], 1.36, 0.66, [0, 0, s], bolt, 0.27, 0.035, false);
    T.add(chamferBox(0.04, 0.62, 0.3, 0.012), lite, xf(0.855, 0.4, s * 0.62));
  }
  // the external mantlet: a flat slab with chamfered edges bolted over the gun opening, the gun's collar, the 75 mm
  // with its muzzle swell, the coaxial Besa on the left the sight aperture on the right
  T.add(chamferBox(0.16, 0.52, 0.86, 0.035), dim(paint, 1.04), xf(0.94, GUN.y, 0));
  boltFrame(TF, [1.021, GUN.y, 0], [0, 0, 1], [0, 1, 0], 0.86, 0.52, [1, 0, 0], bolt, 1, 0.035, false);
  T.cyl(paint, 0.12, 0.2, 1.1, GUN.y, 0, 0, 0, -Math.PI / 2, 8);
  T.add(gunTube(GUN.L, 0.06, dim(paint, 0.88), { lip: 0.16, lipR: 1.22, seg: 20 }), 0xffffff, xf(GUN.x + 0.1, GUN.y, 0));
  T.cyl(IRON, 0.035, 0.12, 1.07, GUN.y + 0.02, -0.3, 0, 0, -Math.PI / 2, 6).cyl(IRON, 0.018, 0.34, 1.26, GUN.y + 0.02, -0.3, 0, 0, -Math.PI / 2, 6);
  TF.poly([[1.024, GUN.y + 0.1, 0.24], [1.024, GUN.y + 0.1, 0.32], [1.024, GUN.y + 0.16, 0.32], [1.024, GUN.y + 0.16, 0.24]], [1, 0, 0], BLACK, 'gunmetal');
  // the roof: the vision cupola on the right with its periscopes and hatch, the loader's split hatch on the
  // left, periscopes, the bomb thrower, a vent
  const cx = -0.36, cz = 0.42;
  T.add(lathe([[0.32, 0], [0.32, 0.09], [0.25, 0.17], [0, 0.17]], 10), dim(paint, 1.04), xf(cx, TH, cz));
  // its eight periscope windows, dark quads on the sloped ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2, c = Math.cos(a), s = Math.sin(a), t = [-s, 0, c], at = (r, y, d) => [cx + r * c + t[0] * d, TH + y, cz + r * s + t[2] * d];
    TF.poly([at(0.312, 0.1, -0.04), at(0.312, 0.1, 0.04), at(0.268, 0.15, 0.035), at(0.268, 0.15, -0.035)], [c * 0.75, 0.66, s * 0.75], BLACK, 'gunmetal');
  }
  T.box(dim(paint, 1.1), 0.46, 0.03, 0.44, cx, TH + 0.185, cz);
  T.box(dim(paint, 1.07), 0.24, 0.035, 0.5, -0.36, TH + 0.017, -0.29).box(dim(paint, 1.07), 0.24, 0.035, 0.5, -0.12, TH + 0.017, -0.29);
  T.box(IRON, 0.5, 0.03, 0.03, -0.24, TH + 0.04, -0.555).box(IRON, 0.1, 0.04, 0.03, -0.36, TH + 0.05, -0.15).box(IRON, 0.1, 0.04, 0.03, -0.12, TH + 0.05, -0.15);
  for (const z of [0.36, -0.36]) T.box(IRON, 0.12, 0.08, 0.14, 0.42, TH + 0.03, z).box(BLACK, 0.02, 0.04, 0.1, 0.485, TH + 0.04, z);
  T.cyl(IRON, 0.045, 0.24, 0.3, TH + 0.08, 0.06, 0, 0, -0.6, 6);
  T.cyl(dim(paint, 0.95), 0.1, 0.08, 0.05, TH + 0.02, -0.5, 0, 0, 0, 6);
  // the two 4-inch smoke dischargers on the right side, a pistol port on each side
  for (const dx of [0, 0.15]) {
    T.cyl(IRON, 0.055, 0.36, 0.45 + dx, 0.7, 0.98, 0.7, 0, -0.45, 6);
  }
  T.box(IRON, 0.32, 0.06, 0.08, 0.52, 0.56, 0.95);
  for (const s of [1, -1]) {
    T.cyl(dim(paint, 1.1), 0.075, 0.04, -0.5, 0.36, s * 0.94, Math.PI / 2, 0, 0, 6);
  }
  // the big stowage bin across the back with its lid, the owner's recognition panel tied on the lid
  T.box(paint, 0.42, 0.44, 1.76, -1.12, 0.4, 0).box(dim(paint, 1.1), 0.44, 0.03, 1.78, -1.12, 0.635, 0);
  TF.poly([[-1.331, 0.55, -0.88], [-1.331, 0.55, 0.88], [-1.331, 0.565, 0.88], [-1.331, 0.565, -0.88]], [-1, 0, 0], dim(paint, 0.5));
  for (const s of [1, -1]) T.box(dim(paint, 0.85), 0.36, 0.06, 0.03, -1.05, 0.3, s * 0.89);
  roofPanel(TF, -1.26, -1.0, -0.36, 0.36, 0.652, dim(f.color, 0.86));
  // the wireless aerial on its base at the left rear
  T.box(IRON, 0.08, 0.06, 0.08, -0.7, TH + 0.03, -0.7).box(0x3c4028, 0.018, 1.5, 0.018, -0.7, TH + 0.8, -0.7);
  // the markings: the owner's squadron sign and the star in its circle on the side plates
  for (const s of [1, -1]) {
    T.add(squadronSign(0.22, f.color, '2'), 0xffffff, place([0.32, 0.44, s * 0.94], [0, 0, s], [0, 1, 0], 1), 'plain');
    T.add(star(1, { color: WHITE, ring: WHITE, segments: 16 }), 0xffffff, place([-0.38, 0.44, s * 0.94], [0, 0, s], [0, 1, 0], 0.19), 'plain');
  }
  T.box(IRON, 0.15, 0.025, 0.03, cx, TH + 0.245, cz);
  for (const dx of [-0.06, 0.06]) T.box(IRON, 0.025, 0.04, 0.03, cx + dx, TH + 0.22, cz);
  for (const z of [-0.56, 0.56]) T.box(IRON, 0.03, 0.12, 0.075, -1.345, 0.53, z);
  T.add(TF.geometry());
  return { hull: H, turret: T };
}

// ---------------------------------------------------------------- the unit-model hook

// the same soft ambient occlusion as the light and heavy tanks: darker toward the ground and on faces looking down
const shade = (geo, lift, height) => ao(geo, {
  falloff: (p, n) => (0.84 + 0.16 * smooth((p.y + lift) / height)) * (1 - 0.2 * Math.max(0, -n.y)),
});

// the scale that brings the 6.35 m Cromwell near the footprint of the other factions' medium tanks
const S = 0.9;
const cache = new Map();
// The Cromwell as { hull, turret, ring, tip } (see lightHeavy in armor-lightheavy.js), cached per paint and owner color.
export function cromwell(f) {
  const key = `${f.vehicle}|${f.color}`;
  let out = cache.get(key);
  if (!out) {
    const m = cromwellBuild(f), height = 1.15;
    out = {
      hull: shade(m.hull.geometry(), 0, height).scale(S, S, S),
      turret: shade(m.turret.geometry(), RING[1], height).scale(S, S, S),
      ring: RING.map((v) => v * S), tip: [GUN.x + 0.1 + GUN.L, GUN.y, 0].map((v) => v * S),
    };
    cache.set(key, out);
  }
  return out;
}
