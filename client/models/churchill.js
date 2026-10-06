// The Churchill Mk VII infantry tank of the UK faction, built to read as a real, weathered vehicle under the model
// textures, like the tanks of client/models/armor-lightheavy.js (whose building blocks are copied here).
//
// Long slab hull whose tracks run right round it: up over the big squared front horns, along the hull top and down
// to the raised sprocket at the back. Between the runs, the panniers: flat bolted side plates over eleven small
// bogies a side, with the mud chutes along their bottom edge and the round escape door. Vertical nose plate with
// the driver's round visor and the Besa ball, louvred air intakes standing out over the top runs, the engine deck
// with its grilles, exhausts and silencers at the back. The round-sided composite turret (cast front and sides,
// welded roof) with the rounded mantlet and the 75 mm, the commander's cupola, the bomb thrower and a stowage bin.
// SCC 15 olive drab; white Allied stars in circles, the WD census number in white, the arm-of-service square on
// the nose. The owner's color is the squadron sign on the turret sides and a small panel on the bin.
//
// Two vertex-colored geometries: the hull (with the running gear, tracks and markings) and the turret, whose
// origin is the turret ring. Drawn in metres from the real vehicle (7.4 m long, 3.25 m wide, 2.75 m tall) and
// scaled by S into the Tiger's size class. Axes: +x forward, +y up, +z the vehicle's right side, the ground at y = 0.
import * as THREE from 'three';
import { tagTrack } from './track-data.js';
import { merge, mirrorZ, loft, lathe, chamferBox, star, place, ao, xf, tag, tagWheel, scaleWheelPivots, matId, UNSET } from './geom.js';

const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLS = new Map();
const cylGeo = (n) => CYLS.get(n) || CYLS.set(n, new THREE.CylinderGeometry(1, 1, 1, n)).get(n);
// albedos biased cool so they render as the color named under the warm sun (see armor-lightheavy.js)
const RUBBER = 0x2b3238, LINK = 0x3d444c, LINK_LIT = 0x5a626b, LINK_DARK = 0x30363d, IRON = 0x434c55, WHITE = 0xd3e3ec, BLACK = 0x17191c;
const GUN = 0x59636c, LENS = 0xd5dde0, WOOD = 0x756d64, INSIDE = 0x353c44, RED = 0xae555a, CANVAS = 0x6d6c58;
// the UK vehicle color (main.js, SCC 15 olive drab) as the paint that renders like it: a dark olive, a little cooler
const REPAINT = new Map([[0x565640, 0x55594a]]);
const MAT_OF = new Map([[IRON, 'gunmetal'], [BLACK, 'gunmetal'], [WOOD, 'wood'], [RUBBER, 'rubber'], [CANVAS, 'canvas'],
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

// flat colored polygons: poly() takes a convex outline in order, the way it faces, the color (one, or one per
// point) and optionally what it is made of
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

// rings around the z axis from bands [[r0, z0], [r1, z1], color, colorB, colorEnd, mat] (see armor-lightheavy.js)
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

// a road wheel, axle along z, outer face toward +z: rubber tire, dished disc, hub cap
function roadWheel(R, w, paint, { seg = 28, rim = 0.78, hub = 0.3, spokes = 0, tire = RUBBER, rubber = true } = {}) {
  const h = w / 2, Rr = R * rim, Rh = R * hub, tm = rubber ? 'rubber' : null;
  return tagWheel(bands([
    [[R, -h], [R, h * 0.4], tire, null, null, tm], [[R, h * 0.4], [Rr, h], tire, null, null, tm],
    [[Rr, h], [Rr * 0.91, h * 1.06], dim(paint, 1.12)],
    [[Rr * 0.91, h * 1.06], [Rh * 1.3, h * 0.6], paint, spokes ? dim(paint, 0.2) : null, dim(paint, 0.75)],
    [[Rh * 1.3, h * 0.6], [Rh, h * 1.3], dim(paint, 0.8)],
    [[Rh, h * 1.3], [Rh * 0.82, h * 1.5], dim(paint, 1.05)], [[Rh * 0.82, h * 1.5], [0, h * 1.5], dim(paint, 0.9)],
  ], spokes ? Math.max(seg, spokes * 4) : seg), R);
}

// a drive sprocket, axle along z, outer face toward +z: a toothed plate with worn tooth edges and a hub
function sprocketWheel(R, w, teeth, paint) {
  const F = flat(), h = w / 2, step = TAU / teeth, rr = R * 0.8, ring = [], face = col(paint), edge = col(LINK_LIT);
  const tooth = [[-0.32, rr], [0, R], [0.32, rr]];
  for (let k = 0; k < teeth; k++) for (const [t, r] of tooth) { const a = (k + t) * step; ring.push([r * Math.cos(a), r * Math.sin(a)]); }
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    F.poly([[0, 0, h], [p[0], p[1], h], [q[0], q[1], h]], [0, 0, 1], face);
    if (i % 3 === 2) return;
    F.poly([[p[0], p[1], -h], [q[0], q[1], -h], [q[0], q[1], h], [p[0], p[1], h]], [q[1] - p[1], p[0] - q[0], 0], edge, 'track-steel');
  });
  const hub = dim(paint, 0.7);
  return tagWheel(merge([F.geometry(), bands([[[R * 0.42, h], [R * 0.3, h * 1.9], hub], [[R * 0.3, h * 1.9], [0, h * 1.9], hub]], 8)]), R);
}

// The convex outline (counter-clockwise, in xy) around circles [[x, y, r], ...], each grown by d
function circleHull(circles, d = 0, n = 40) {
  const pts = [];
  for (const [x, y, r] of circles) for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts.push([x + (r + d) * Math.cos(a), y + (r + d) * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// the part of a convex 2D outline where fn(point) >= 0, cut where it crosses zero
function clip(pts, fn) {
  const out = [], v = pts.map(fn);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length, a = pts[i], b = pts[j];
    if (v[i] >= 0) out.push(a);
    if ((v[i] >= 0) !== (v[j] >= 0)) { const k = v[i] / (v[i] - v[j]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}

// The track around a set of wheels, in xy between z - width/2 and z + width/2: link plates along the belt round
// the circles, every other link a shade darker, the tread (or under the bottom run its inner face) and the edge
function trackBelt(circles, z, width, { thick = 0.12, pitch = 0.17, color = LINK, edge = LINK_LIT, back = LINK_DARK } = {}) {
  const loop = circleHull(circles, thick / 2), len = [0];
  for (let i = 1; i <= loop.length; i++) { const a = loop[i - 1], b = loop[i % loop.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[loop.length], n = Math.round(total / pitch), step = total / n;
  const at = (s) => {
    let a = 0, b = loop.length;
    while (b - a > 1) { const m = (a + b) >> 1; if (len[m] <= s) a = m; else b = m; }
    const p = loop[a], q = loop[(a + 1) % loop.length], t = (s - len[a]) / Math.max(1e-9, len[a + 1] - len[a]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const F = flat('track-steel'), extra = flat('track-steel'), z0 = z - width / 2, z1 = z + width / 2, h = thick / 2, lit = col(color), dark = dim(color, 0.84), rim = col(edge), rim2 = dim(edge, 0.84), deep = col(back);
  for (let k = 0; k < n; k++) {
    const A = at(k * step + step * 0.03), B = at((k + 1) * step - step * 0.03), A0 = at(k * step), B0 = at((k + 1) * step), l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = (B[1] - A[1]) / l, ny = (A[0] - B[0]) / l;
    const Ao = [A[0] + nx * h, A[1] + ny * h], Bo = [B[0] + nx * h, B[1] + ny * h], Ai = [A0[0] - nx * h, A0[1] - ny * h], Bi = [B0[0] - nx * h, B0[1] - ny * h];
    F.poly([[Ao[0], Ao[1], z0], [Bo[0], Bo[1], z0], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [nx, ny, 0], k % 2 ? lit : dark);
    F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bi[0], Bi[1], z1], [Ai[0], Ai[1], z1]], [-nx, -ny, 0], deep);
    // A solid transverse cleat has a worn crown and four vertical edges.
    // Cleats on the exposed run leave the original ground contact unchanged.
    {
      const detail = ny > -0.85 ? F : extra;
      const rise = 0.038, za = z0 + 0.025, zb = z1 - 0.025;
      const point = (t, r, zz) => [Ao[0] + (Bo[0] - Ao[0]) * t + nx * r, Ao[1] + (Bo[1] - Ao[1]) * t + ny * r, zz];
      const a = point(0.34, 0, za), b = point(0.66, 0, za), c = point(0.66, 0, zb), d = point(0.34, 0, zb);
      const ca = point(0.34, rise, za), cb = point(0.66, rise, za), cc = point(0.66, rise, zb), cd = point(0.34, rise, zb);
      const tx = (cb[0] - ca[0]) / l, ty = (cb[1] - ca[1]) / l;
      detail.poly([ca, cb, cc, cd], [nx, ny, 0], rim);
      detail.poly([a, ca, cd, d], [-tx, -ty, 0], dark);
      detail.poly([b, cb, cc, c], [tx, ty, 0], dark);
      detail.poly([a, b, cb, ca], [0, 0, -1], rim2);
      detail.poly([d, c, cc, cd], [0, 0, 1], rim2);
    }
    F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bo[0], Bo[1], z0], [Ao[0], Ao[1], z0]], [0, 0, -1], deep);
    const r = k % 2 ? rim : rim2;
    F.poly([[Ai[0], Ai[1], z1], [Bi[0], Bi[1], z1], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [0, 0, 1], [deep, deep, r, r]);
  }
  const original = F.geometry();
  return tagTrack(merge([original, extra.geometry()]), loop, z, original);
}

// a gun tube along +x from x = 0: breech sleeve, taper, a muzzle lip; the bore a dark dot. Bare gunmetal.
function gunTube(L, r, paint, { lip = 0.05, lipR = 1.18, seg = 8 } = {}) {
  const g = lathe([[r * 1.35, 0], [r * 1.35, 0.14], [r, 0.2], [r * 0.86, L - lip - 0.01], [r * lipR, L - lip], [r * lipR, L], [0, L]], seg, { axis: 'x' });
  return tag(paintBy(g, (p) => (Math.hypot(p.y, p.z) < 1e-4 ? col(BLACK) : col(paint))), 'gunmetal');
}
// louvres on a deck at height y: a dark recess and n bars across x
function grille(F, x0, x1, z0, z1, y, n, bar, gap = INSIDE) {
  F.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], gap, 'gunmetal');
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + (i + 0.2) * step, b = a + step * 0.55;
    F.poly([[a, y + 0.006, z0 + 0.03], [b, y + 0.006, z0 + 0.03], [b, y + 0.006, z1 - 0.03], [a, y + 0.006, z1 - 0.03]], [0, 1, 0], bar);
  }
}
// a round lens facing +x at (x, y, z)
function lens(F, x, y, z, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; pts.push([x, y + r * Math.sin(a), z + r * Math.cos(a)]); }
  F.poly(pts, [1, 0, 0], LENS, 'plain');
}
// a row of n bolt heads from a to b (3D points) on a plane facing dir
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
// Stencilled text facing +z, h tall, centered on the origin, in seven-segment strokes: digits and the T of the WD
// census number (edge: a darker outline under it). Flat paint, no texture.
const W7 = 0.58, T7 = 0.21;
const SEG7 = { a: [0, 1 - T7, W7, 1], b: [W7 - T7, 0.5, W7, 1], c: [W7 - T7, 0, W7, 0.5], d: [0, 0, W7, T7], e: [0, 0, T7, 0.5], f: [0, 0.5, T7, 1], g: [0, 0.5 - T7 / 2, W7, 0.5 + T7 / 2], t: [(W7 - T7) / 2, 0, (W7 + T7) / 2, 1] };
const GLYPHS = { T: 'at', 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function stencil(text, h, color, edge = null) {
  const F = flat('plain'), w = W7 * h, gap = 0.24 * h, total = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, i) => {
    const x0 = -total / 2 + i * (w + gap);
    for (const s of GLYPHS[ch]) {
      const [a, b, c, d] = SEG7[s], X0 = x0 + a * h, X1 = x0 + c * h, Y0 = (b - 0.5) * h, Y1 = (d - 0.5) * h;
      if (edge != null) { const e = 0.05 * h; F.poly([[X0 - e, Y0 - e, 0.003], [X1 + e, Y0 - e, 0.003], [X1 + e, Y1 + e, 0.003], [X0 - e, Y1 + e, 0.003]], [0, 0, 1], edge); }
      F.poly([[X0, Y0, 0.006], [X1, Y0, 0.006], [X1, Y1, 0.006], [X0, Y1, 0.006]], [0, 0, 1], color);
    }
  });
  return F.geometry();
}
// a sign facing +z, s across: an outline square of bars b thick (the squadron sign) or a filled one, on a dark edge
function squareSign(s, color, { b = 0.2, fill = false, edge = BLACK } = {}) {
  const F = flat('plain'), h = s / 2, e = s * 0.08, t = s * b;
  const rect = (x0, y0, x1, y1, z, c) => F.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], c);
  if (fill) { rect(-h - e, -h - e, h + e, h + e, 0.003, edge); rect(-h, -h, h, h, 0.006, color); return F.geometry(); }
  for (const [x0, y0, x1, y1] of [[-h, h - t, h, h], [-h, -h, h, -h + t], [-h, -h + t, -h + t, h - t], [h - t, -h + t, h, h - t]]) {
    rect(x0 - e, y0 - e, x1 + e, y1 + e, 0.003, edge); rect(x0, y0, x1, y1, 0.006, color);
  }
  return F.geometry();
}
// loft section: a box [z, y] ring with its top edges chamfered by c
const deck = (x, y0, y1, z, c = 0.05) => ({ x, pts: [[z, y0], [z, y1 - c], [z - c, y1], [c - z, y1], [-z, y1 - c], [-z, y0]] });
const FLAT = { normals: 'flat' };
// a rounded cast bulge along +x, sections [x, width, height, p], centered at height y
const mantlet = (y, list, seg = 12) => loft(list.map(([x, w, h, p = 4]) => ({ x, w, h, y, p })), { segments: seg, normals: 40 });

// ---------------------------------------------------------------- Churchill Mk VII

function churchill7(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat(), GF = flat();
  const cast = dim(paint, 0.86), bolt = dim(paint, 1.4), seam = dim(paint, 0.55), Y = 1.85; // Y: the hull roof
  // ---- running gear and pannier, right side (mirrored to the left)
  // the track (22 in wide) round the high front idler in the horn, eleven small bogie stations and the raised
  // sprocket at the back; the top run lies along the pannier tops
  const tz = 1.28, TW = 0.56, t = 0.1, R = 0.13, wy = t + R, stations = Array.from({ length: 11 }, (_, k) => 2.3 - k * 0.435);
  const id = [3.32, 1.2, 0.3], sp = [-3.33, 1.1, 0.33];
  G.add(trackBelt([[id[0], id[1], id[2]], ...stations.map((x) => [x, wy, R]), [sp[0], sp[1], sp[2]]], tz, TW, { thick: t, pitch: 0.17 }));
  G.add(roadWheel(id[2] - 0.02, 0.2, dim(paint, 0.9), { seg: 32, rim: 0.84, hub: 0.26, tire: dim(paint, 0.8), rubber: false }), 0xffffff, xf(id[0], id[1], tz + 0.12));
  G.add(sprocketWheel(sp[2], 0.22, 12, paint), 0xffffff, xf(sp[0], sp[1], tz + 0.14));
  // Eleven paired wheels sit below the armored pannier. Their axle bosses and
  // suspension arms remain visible through the mud chutes.
  const outer = roadWheel(R, 0.1, paint, { seg: 16, rim: 0.83, hub: 0.32 });
  const inner = tagWheel(bands([
    [[R, -0.05], [R, 0.05], RUBBER, null, null, 'rubber'],
    [[R, 0.05], [R * 0.82, 0.065], RUBBER, null, null, 'rubber'],
    [[R * 0.82, 0.065], [0, 0.07], dim(paint, 0.7)],
  ], 12), R);
  stations.forEach((x) => {
    G.add(outer, 0xffffff, xf(x, wy, tz + 0.15)).add(inner, 0xffffff, xf(x, wy, tz - 0.15));
    G.cyl(IRON, 0.065, 0.34, x, wy, tz, Math.PI / 2, 0, 0, 8);
    G.add(chamferBox(0.12, 0.27, 0.1, 0.02), dim(paint, 0.7), xf(x + 0.055, wy + 0.15, tz + 0.09, 0, 0, -0.35));
    G.cyl(dim(paint, 0.8), 0.08, 0.07, x + 0.1, 0.46, tz + 0.12, Math.PI / 2, 0, 0, 12);
  });
  // the pannier side plate inside the track loop: an upper plate and, along its bottom, the band with the mud chutes
  const ZP = 1.585, ZI = 1.0, band = [0.3, 0.62];
  const region = clip(clip(circleHull([[id[0], id[1], id[2] - 0.03], ...stations.map((x) => [x, wy, R]), [sp[0], sp[1], sp[2] - 0.03]]), ([x]) => id[0] - 0.34 - x), ([x]) => x - sp[0] - 0.37);
  const upper = clip(region, ([, y]) => y - band[1]), low = clip(clip(region, ([, y]) => y - band[0]), ([, y]) => band[1] - y);
  const chutes = [9, 7, 5, 3, 1].map((k) => [stations[k] - 0.17, stations[k] + 0.17]); // from the back
  const solid = [];
  let from = -9;
  for (const [a, b] of chutes) { solid.push(clip(clip(low, ([x]) => x - from), ([x]) => a - x)); from = b; }
  solid.push(clip(low, ([x]) => x - from));
  for (const piece of [upper, ...solid]) {
    if (piece.length < 3) continue;
    GF.poly(piece.map(([x, y]) => [x, y, ZP]), [0, 0, 1], paint);
    // the plate's edges back to the hull side, so it reads as the face of a deep pannier
    piece.forEach((a, i) => {
      const b = piece[(i + 1) % piece.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > 1e-4) GF.poly([[a[0], a[1], ZI], [b[0], b[1], ZI], [b[0], b[1], ZP], [a[0], a[1], ZP]], [(b[1] - a[1]) / l, (a[0] - b[0]) / l, 0], dim(paint, 0.82));
    });
  }
  // the dark hull side seen through the chutes and under the plate
  GF.poly([[sp[0], 0.12, ZI + 0.02], [id[0], 0.12, ZI + 0.02], [id[0], band[1], ZI + 0.02], [sp[0], band[1], ZI + 0.02]], [0, 0, 1], INSIDE, 'gunmetal');
  // bolted armor: rows of bolt heads along the plate's top and bottom and the vertical seams between the plates
  rivets(GF, [-2.75, 1.3, ZP + 0.002], [2.65, 1.33, ZP + 0.002], 12, [0, 0, 1], bolt, 0.026);
  rivets(GF, [-2.75, 0.68, ZP + 0.002], [2.6, 0.68, ZP + 0.002], 11, [0, 0, 1], bolt, 0.026);
  for (const x of [1.72, -0.98]) {
    GF.poly([[x, 0.62, ZP + 0.002], [x + 0.02, 0.62, ZP + 0.002], [x + 0.02, 1.36, ZP + 0.002], [x, 1.36, ZP + 0.002]], [0, 0, 1], seam);
    rivets(GF, [x - 0.05, 0.75, ZP + 0.002], [x - 0.05, 1.22, ZP + 0.002], 3, [0, 0, 1], bolt, 0.018);
  }
  // the round escape door (Mk VII) with its hinges and handle
  G.add(lathe([[0.3, 0], [0.3, 0.025], [0.27, 0.045], [0, 0.05]], 9, { axis: 'z' }), paint, xf(0.62, 0.98, ZP));
  G.box(IRON, 0.08, 0.06, 0.04, 0.3, 1.14, ZP + 0.03).box(IRON, 0.08, 0.06, 0.04, 0.3, 0.82, ZP + 0.03).box(IRON, 0.16, 0.03, 0.04, 0.82, 0.98, ZP + 0.07);
  // the Allied star in its circle on the pannier
  G.add(star(1, { color: WHITE, ring: WHITE, inner: 0.4, segments: 20 }), 0xffffff, place([-1.65, 0.98, ZP + 0.006], [0, 0, 1], [0, 1, 0], 0.27), 'plain');
  // the air intake standing out over the top run behind the turret: louvres on its outer face and top
  G.box(paint, 1.9, 0.26, 0.54, -1.62, Y - 0.12, 1.24).box(dim(paint, 1.06), 1.96, 0.03, 0.58, -1.62, Y + 0.015, 1.24);
  GF.poly([[-2.55, Y - 0.23, 1.511], [-0.69, Y - 0.23, 1.511], [-0.69, Y - 0.02, 1.511], [-2.55, Y - 0.02, 1.511]], [0, 0, 1], INSIDE, 'gunmetal');
  for (let i = 0; i < 14; i++) { const x = -2.5 + i * 0.13; GF.poly([[x, Y - 0.22, 1.53], [x + 0.08, Y - 0.22, 1.53], [x + 0.08, Y - 0.03, 1.515], [x, Y - 0.03, 1.515]], [0, 0.08, 1], dim(paint, 0.9)); }
  rivets(GF, [-2.55, Y + 0.032, 1.0], [-0.69, Y + 0.032, 1.0], 6, [0, 1, 0], bolt, 0.018);
  // tools on the roof edge: crowbar and pick
  G.box(IRON, 1.1, 0.035, 0.04, 1.7, Y + 0.02, 0.9).box(WOOD, 0.85, 0.045, 0.05, 1.75, Y + 0.025, 0.8).box(IRON, 0.08, 0.05, 0.32, 2.2, Y + 0.025, 0.8);
  G.add(GF.geometry());
  H.add(mirrorZ(G.geometry()));

  // ---- the hull between the tracks: rear plate, belly, the lower nose rising to the vertical front plate
  H.add(loft([deck(-3.3, 0.62, Y - 0.1, ZI, 0.02), deck(-3.2, 0.45, Y, ZI, 0.04), deck(2.65, 0.45, Y, ZI, 0.04), deck(3.3, 1.12, Y, ZI, 0.04)], FLAT), paint);
  // the nose plate: the driver's round visor (right) and the Besa ball (left), the headlamps under their hoods,
  // spare track links across the lower plate, tow hooks
  const NX = 3.3;
  H.add(lathe([[0.17, 0], [0.16, 0.06], [0.1, 0.09], [0, 0.09]], 12, { axis: 'x' }), cast, xf(NX, 1.56, 0.42), 'cast-armor').box(BLACK, 0.02, 0.03, 0.16, NX + 0.09, 1.57, 0.42);
  H.add(lathe([[0.16, 0], [0.14, 0.06], [0.07, 0.1], [0, 0.1]], 12, { axis: 'x' }), cast, xf(NX, 1.54, -0.44), 'cast-armor').cyl(IRON, 0.022, 0.26, NX + 0.18, 1.54, -0.44, 0, 0, -Math.PI / 2, 6);
  for (const z of [0.82, -0.82]) {
    H.cyl(IRON, 0.08, 0.12, NX + 0.06, 1.74, z, 0, 0, -Math.PI / 2, 8).box(dim(paint, 0.95), 0.18, 0.03, 0.22, NX + 0.08, 1.83, z);
    lens(HF, NX + 0.121, 1.74, z, 0.065);
  }
  H.box(LINK_DARK, 0.03, 0.3, 1.6, NX + 0.015, 1.27, 0);
  for (let i = 0; i < 7; i++) {
    const z = (i - 3) * 0.225;
    H.box(i % 2 ? LINK : dim(LINK, 0.86), 0.05, 0.27, 0.21, NX + 0.04, 1.27, z, 0, 0, 0, 'track-steel').box(LINK_LIT, 0.03, 0.06, 0.15, NX + 0.07, 1.27, z);
  }
  for (const z of [0.6, -0.6]) H.box(IRON, 0.16, 0.1, 0.07, 3.0, 0.8, z, 0, 0, 0.8);
  // the arm-of-service square (a red square with its white number) on the nose and the census number
  H.add(squareSign(0.2, RED, { fill: true }), 0xffffff, place([NX + 0.004, 1.76, -0.3], [1, 0, 0], [0, 1, 0], 1), 'plain');
  H.add(stencil('52', 0.09, WHITE), 0xffffff, place([NX + 0.012, 1.76, -0.3], [1, 0, 0], [0, 1, 0], 1), 'plain');
  for (const s of [1, -1]) H.add(stencil('T253117', 0.11, WHITE), 0xffffff, place([1.95, 1.18, s * (ZP + 0.006)], [0, 0, s], [0, 1, 0], 1), 'plain');
  // roof front: the driver's and the hull gunner's hatches with their periscopes; plate seams and bolts
  for (const z of [0.42, -0.44]) {
    H.box(dim(paint, 1.06), 0.48, 0.04, 0.46, 2.85, Y + 0.02, z).box(IRON, 0.06, 0.03, 0.4, 2.62, Y + 0.05, z);
    H.box(IRON, 0.1, 0.08, 0.16, 3.16, Y + 0.05, z).box(BLACK, 0.012, 0.03, 0.12, 3.215, Y + 0.06, z);
  }
  rivets(HF, [2.4, Y + 0.002, -0.95], [2.4, Y + 0.002, 0.95], 6, [0, 1, 0], bolt, 0.018);
  rivets(HF, [3.26, Y + 0.002, -0.95], [3.26, Y + 0.002, 0.95], 6, [0, 1, 0], bolt, 0.018);
  // engine deck: the raised louvred cover over the engine, the radiator grilles either side, hatches, the
  // air-recognition star in its circle, a tarpaulin roll, tools, a jerrycan
  H.box(paint, 1.8, 0.08, 1.2, -1.95, Y + 0.04, 0);
  grille(HF, -2.8, -1.1, -0.56, 0.56, Y + 0.082, 11, dim(paint, 0.82));
  for (const z of [0.78, -0.78]) grille(HF, -3.15, -2.55, z - 0.17, z + 0.17, Y + 0.004, 5, dim(paint, 0.82));
  for (const z of [0.5, -0.5]) H.box(dim(paint, 1.04), 0.5, 0.035, 0.5, -0.7, Y + 0.017, z).box(IRON, 0.04, 0.04, 0.2, -0.9, Y + 0.04, z);
  H.add(star(1, { color: WHITE, ring: WHITE, inner: 0.4, segments: 20 }), 0xffffff, place([1.95, Y + 0.004, 0], [0, 1, 0], [1, 0, 0], 0.38), 'plain');
  H.cyl(CANVAS, 0.13, 1.7, -3.08, Y + 0.13, 0, Math.PI / 2, 0, 0, 8);
  for (const z of [0.55, -0.55]) H.box(IRON, 0.06, 0.03, 0.27, -3.08, Y + 0.26, z);
  H.box(WOOD, 1.0, 0.045, 0.05, -2.0, Y + 0.025, 0.86).box(IRON, 0.25, 0.03, 0.18, -1.4, Y + 0.02, 0.86).box(WOOD, 0.9, 0.04, 0.05, -2.1, Y + 0.025, -0.86).box(IRON, 0.1, 0.05, 0.12, -1.6, Y + 0.03, -0.86);
  H.add(chamferBox(0.16, 0.34, 0.24, 0.02), dim(paint, 0.92), xf(-0.55, Y + 0.17, -0.82));
  // the back: two exhaust pipes out of the deck and down the rear plate to the silencers, tail lights, the
  // towing pintle, a stowage box, the arm-of-service square
  for (const z of [0.55, -0.55]) {
    H.cyl(dim(IRON, 0.85), 0.07, 0.3, -3.2, Y - 0.04, z, 0, 0, 0, 8).cyl(dim(IRON, 0.85), 0.07, 0.2, -3.3, Y + 0.05, z, 0, 0, Math.PI / 2, 8);
    H.cyl(dim(IRON, 0.8), 0.13, 0.62, -3.42, 1.42, z, Math.PI / 2, 0, 0, 8).cyl(BLACK, 0.06, 0.02, -3.42, 1.42, z + Math.sign(z) * 0.31, Math.PI / 2, 0, 0, 8);
    H.box(IRON, 0.05, 0.4, 0.04, -3.39, 1.62, z).box(IRON, 0.06, 0.06, 0.08, -3.33, 1.2, z * 1.55).box(RED, 0.015, 0.04, 0.05, -3.3, 1.2, z * 1.55, 0, 0, 0, 'plain');
  }
  H.box(IRON, 0.2, 0.14, 0.18, -3.38, 0.82, 0).cyl(IRON, 0.05, 0.18, -3.48, 0.82, 0, 0, 0, 0, 6);
  H.add(chamferBox(0.28, 0.32, 0.56, 0.03), dim(paint, 0.9), xf(-3.46, 1.02, 0));
  H.add(squareSign(0.18, RED, { fill: true }), 0xffffff, place([-3.305, 1.72, -0.85], [-1, 0, 0], [0, 1, 0], 1), 'plain');
  H.add(stencil('52', 0.08, WHITE), 0xffffff, place([-3.313, 1.72, -0.85], [-1, 0, 0], [0, 1, 0], 1), 'plain');
  H.add(HF.geometry());

  // ---- turret: ring at x = 0.5; round cast sides bulging out a little above the ring, a flatter cast front,
  // the welded roof
  const TH = 0.72, N = 64, outline = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU, c = Math.cos(a), s = Math.sin(a), e = 2 / 2.9;
    outline.push([(c > 0 ? 0.98 : 1.02) * Math.sign(c) * Math.abs(c) ** e - 0.02, 0.97 * Math.sign(s) * Math.abs(s) ** e]);
  }
  const ring = (k, pts = outline) => pts.map(([x, z]) => [x * k, z * k]);
  T.add(vloft([
    { y: 0, pts: ring(0.91) }, { y: 0.07, pts: ring(0.96) },
    { y: 0.18, pts: ring(0.99) }, { y: 0.32, pts: ring(1) },
    { y: 0.45, pts: ring(0.995) }, { y: 0.56, pts: ring(0.975) },
    { y: 0.65, pts: ring(0.94) }, { y: TH, pts: ring(0.89) },
  ], { normals: 'smooth' }), cast, undefined, 'cast-armor');
  T.add(vloft([{ y: 0, pts: ring(0.955) }, { y: 0.05, pts: ring(0.975) }], { caps: false, normals: 35 }), dim(paint, 0.45));
  // the welded roof plate's seam and bolts
  TF.poly([[-0.75, TH + 0.003, -0.84], [-0.73, TH + 0.003, -0.84], [-0.73, TH + 0.003, 0.84], [-0.75, TH + 0.003, 0.84]], [0, 1, 0], seam);
  rivets(TF, [0.62, TH + 0.003, -0.6], [0.62, TH + 0.003, 0.6], 5, [0, 1, 0], bolt, 0.016);
  // the rounded mantlet, the gun collar and the 75 mm with its muzzle sleeve; the coaxial Besa (left) and the
  // sight (right)
  T.add(mantlet(0.36, [[0.82, 0.82, 0.56, 2.8], [0.9, 0.82, 0.56, 2.8], [0.98, 0.8, 0.54, 2.6], [1.04, 0.76, 0.51, 2.4], [1.1, 0.68, 0.46, 2.2], [1.15, 0.56, 0.38, 2], [1.18, 0.42, 0.32, 2]], 32), cast, undefined, 'cast-armor');
  T.cyl(dim(cast, 0.92), 0.11, 0.2, 1.24, 0.36, 0, 0, 0, -Math.PI / 2, 10, 'cast-armor');
  const gL = 2.35;
  T.add(gunTube(gL, 0.068, GUN, { lip: 0.22, lipR: 1.22, seg: 20 }), 0xffffff, xf(1.25, 0.36, 0));
  T.cyl(IRON, 0.022, 0.16, 1.2, 0.36, -0.25, 0, 0, -Math.PI / 2, 6).box(BLACK, 0.02, 0.05, 0.06, 1.15, 0.48, 0.24);
  // roof: the commander's cupola (right rear) with its episcopes and split hatch, the loader's hatch (left), the
  // gunner's and loader's periscopes, the 2 in bomb thrower, the ventilator and the No. 19 set's aerial
  const cup = paintBy(lathe([[0.3, 0], [0.3, 0.1], [0.27, 0.12], [0.27, 0.17], [0.22, 0.2], [0, 0.2]], 10), (p) => (Math.abs(Math.hypot(p.x, p.z) - 0.27) < 0.005 && p.y > 0.11 ? col(BLACK) : cast));
  T.add(cup, 0xffffff, xf(-0.35, TH - 0.01, 0.42), 'cast-armor');
  for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.5; T.box(BLACK, 0.025, 0.04, 0.08, -0.35 + 0.285 * Math.cos(a), TH + 0.135, 0.42 + 0.285 * Math.sin(a), 0, -a, 0); }
  T.box(IRON, 0.02, 0.02, 0.4, -0.35, TH + 0.2, 0.42);
  T.box(dim(paint, 1.06), 0.5, 0.04, 0.44, -0.3, TH + 0.01, -0.42).box(IRON, 0.05, 0.04, 0.2, -0.05, TH + 0.035, -0.42);
  for (const z of [0.25, -0.25]) T.box(IRON, 0.12, 0.09, 0.1, 0.5, TH + 0.04, z).box(BLACK, 0.012, 0.035, 0.07, 0.561, TH + 0.05, z);
  T.cyl(IRON, 0.045, 0.32, 0.38, TH + 0.12, 0.66, 0, 0, -0.6, 8).cyl(BLACK, 0.03, 0.02, 0.473, TH + 0.25, 0.66, 0, 0, -0.6, 8);
  T.add(lathe([[0.13, 0], [0.13, 0.03], [0.07, 0.07], [0, 0.07]], 10), dim(paint, 0.95), xf(-0.75, TH, -0.05));
  T.cyl(IRON, 0.04, 0.08, -0.6, TH + 0.04, -0.72, 0, 0, 0, 6).cyl(BLACK, 0.007, 1.3, -0.6, TH + 0.72, -0.72, 0, 0, 0, 4);
  // the stowage bin on the back with its lid line and straps; the owner's panel on its lid
  T.add(chamferBox(0.38, 0.42, 1.36, 0.03), dim(paint, 0.94), xf(-1.15, 0.36, 0));
  TF.poly([[-1.341, 0.48, -0.66], [-1.341, 0.48, 0.66], [-1.341, 0.495, 0.66], [-1.341, 0.495, -0.66]], [-1, 0, 0], seam);
  for (const z of [0.42, -0.42]) TF.poly([[-1.342, 0.15, z - 0.03], [-1.342, 0.15, z + 0.03], [-1.342, 0.575, z + 0.03], [-1.342, 0.575, z - 0.03]], [-1, 0, 0], IRON, 'gunmetal');
  const e = 0.02, py = 0.574;
  TF.poly([[-1.3 - e, py, -0.5 - e], [-1.0 + e, py, -0.5 - e], [-1.0 + e, py, 0.5 + e], [-1.3 - e, py, 0.5 + e]], [0, 1, 0], BLACK, 'plain');
  TF.poly([[-1.3, py + 0.004, -0.5], [-1.0, py + 0.004, -0.5], [-1.0, py + 0.004, 0.5], [-1.3, py + 0.004, 0.5]], [0, 1, 0], dim(f.color, 0.86), 'plain');
  // the squadron sign in the owner's color on the turret sides, grab rails, spare links on the cheeks
  // the wall's half width at x (turret space) and its turn about y there, for parts laid on the right side
  const side = (x) => 0.97 * (1 - Math.min(1, Math.abs((x + 0.02) / (x > -0.02 ? 0.98 : 1.02))) ** 2.9) ** (1 / 2.9);
  const turn = (x) => -Math.atan((side(x + 0.01) - side(x - 0.01)) / 0.02);
  for (const s of [1, -1]) {
    const zs = side(-0.3) + 0.004;
    T.add(squareSign(0.26, f.color, { b: 0.22 }), 0xffffff, place([-0.3, 0.4, s * zs], [0, 0, s], [0, 1, 0], 1), 'plain');
    T.box(IRON, 0.7, 0.03, 0.03, -0.2, 0.6, s * (side(-0.2) + 0.03)).box(IRON, 0.03, 0.03, 0.07, 0.14, 0.6, s * side(0.14)).box(IRON, 0.03, 0.03, 0.07, -0.54, 0.6, s * side(-0.54));
    [0.34, 0.56].forEach((x, k) => {
      const z = side(x), ry = s * turn(x);
      T.box(k % 2 ? LINK : dim(LINK, 0.88), 0.2, 0.42, 0.05, x, 0.3, s * (z + 0.03), 0, ry, 0, 'track-steel').box(LINK_LIT, 0.05, 0.1, 0.04, x, 0.3, s * (z + 0.06), 0, ry, 0);
    });
  }
  // Raised grab handles on the cupola and loader's hatch keep their openings visible.
  for (const [z, y] of [[0.42, TH + 0.245], [-0.42, TH + 0.08]]) {
    T.box(IRON, 0.15, 0.025, 0.03, -0.3, y, z);
    for (const dx of [-0.06, 0.06]) T.box(IRON, 0.025, 0.045, 0.03, -0.3 + dx, y - 0.025, z);
  }
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.5, Y, 0], tip: [1.25 + gL, 0.36, 0], s: 0.82, height: 1.4 };
}

// ---------------------------------------------------------------- the unit-model hook

// soft ambient occlusion in the vertex colors, as armor-lightheavy.js does it: darker toward the ground and on faces
// that look down. lift is the height of the geometry's origin above the ground.
const shade = (geo, lift, height) => ao(geo, {
  falloff: (p, n) => (0.84 + 0.16 * smooth((p.y + lift) / height)) * (1 - 0.2 * Math.max(0, -n.y)),
});

const cache = new Map();
// The Churchill as { hull, turret, ring, tip }: the two geometries (painted, scaled), where the turret sits on the
// hull and its muzzle in turret space. Cached per colors, so every Churchill of a player shares the geometry.
export function churchill(f) {
  const key = `${f.vehicle}|${f.color}`;
  let out = cache.get(key);
  if (!out) {
    const m = churchill7(f), s = m.s;
    out = {
      hull: scaleWheelPivots(shade(m.hull.geometry(), 0, m.height).scale(s, s, s), s),
      turret: shade(m.turret.geometry(), m.ring[1], m.height).scale(s, s, s),
      ring: m.ring.map((v) => v * s), tip: m.tip.map((v) => v * s),
    };
    cache.set(key, out);
  }
  return out;
}
