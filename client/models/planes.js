// The twelve aircraft of the sand table, four roles for each faction: a fighter, a ground-attack plane, a twin-engine
// bomber and a transport. plane(fac, role, own) builds one as a single vertex-coloured geometry plus what
// client/aircraft.js needs to fly it: the propellers, the outline for the ground shadow and a few sizes.
//
// How a plane is built: fuselages and nacelles are lofted from cross-sections (superellipses, so a body can be round,
// oval or slab-sided), wings and tails are swept airfoil sections with taper, dihedral or a gull bend and rounded or
// square tips, and the paint is worked out per vertex while the mesh is built. A paint edge that must be crisp (a
// canopy frame, a nose band, an invasion stripe, the owner's wing tips) gets a doubled row of vertices exactly on the
// edge, one row painted for each side. The markings are flat decals cut finer where they bend and laid onto the
// surface they sit on. A darker belly and lighter leading edges give the painted-miniature look.
// Axes: +x forward, +y up, +z toward the right wing. Fighters and attackers are about 80% of the real size, bombers
// a little less and transports about two thirds, so a transport is not a house.
// Only 'three' and geom.js are imported, so the browser and the Node tests load this file the same way.
import * as THREE from 'three';
import { xf, crease, merge, mirrorZ, spinner, bomb, tube, lathe, star, balkenkreuz, place, ao } from './geom.js';

const PI = Math.PI, TAU = PI * 2;
const WHITE = 0xece6d6, BLACK = 0x1f1e1b, BLUE = 0x2a4a8f, RED = 0xc23a2a, YELLOW = 0xd6a62a, DARK = 0x2a2824;
const GLASS = 0x34495a, SKY = 0xa9c2d2, STEEL = 0x55544e, EXHAUST = 0x3d3029;
const C = (h) => new THREE.Color(h);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const BOX = new THREE.BoxGeometry(1, 1, 1);
const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);

// ---------------------------------------------------------------- curves and noise

// value noise in 0..1, smooth, about one feature per unit
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// piecewise linear through (xs, ys), flat past the ends
function lin(xs, ys) {
  return (x) => {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
  };
}
// smooth curve through (xs, ys) that never overshoots (monotone cubic), flat past the ends
function pchip(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  if (n < 3) return lin(xs, ys);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// half thickness of a NACA 4-digit section at chord fraction x, for thickness ratio 1
const naca = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);

// indexed geometry from flat arrays, normals by crease angle
function sheet(pos, col, idx, angle) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return crease(g, angle);
}

// ---------------------------------------------------------------- bodies

// A fuselage, nacelle, canopy or pod lofted along +x. keys: [x, w, h, y, p] cross-sections (w wide in z, h tall, centred
// at height y; p the superellipse power: 2 round, 3 or more slab-sided), joined by a smooth curve. A section of size
// 0 closes the end to a point; other ends get a flat cap. seg: points around. cuts: x positions where the paint
// changes sharply (a doubled ring); angles: the same around the body (ring angle t, 0 at +z, PI/2 on top). arc: build
// only the part of the ring between two angles (a canopy). range: build only that x span. z: sideways offset, and
// mirror adds the copy on the other side. ridges and folds: corrugation, the radius waved by folds bumps around.
// paint(p, n, {tag, t, x}) gives each vertex its colour.
function hull(keys, o) {
  const { seg = 16, sub = 1, cuts = [], angles = [], tag = 'fus', crease: ang = 40, ridges = 0, folds = 0, z: z0 = 0, arc = null, caps = [true, true], capColor = [null, null], range = null, mirror = false, paint } = o;
  const ks = [...keys].sort((a, b) => a[0] - b[0]), X = ks.map((k) => k[0]);
  const W = pchip(X, ks.map((k) => k[1])), H = pchip(X, ks.map((k) => k[2])), Y = pchip(X, ks.map((k) => k[3] ?? 0)), Pw = lin(X, ks.map((k) => k[4] ?? 2));
  const at = (x) => ({ w: Math.max(0, W(x)), h: Math.max(0, H(x)), y: Y(x), p: Pw(x) });
  const pt = (x, t) => {
    const s = at(x), e = 2 / s.p, c = Math.cos(t), sn = Math.sin(t), r = 1 + ridges * Math.cos(folds * t);
    return new THREE.Vector3(x, s.y + (s.h / 2) * r * Math.sign(sn) * Math.abs(sn) ** e, z0 + (s.w / 2) * r * Math.sign(c) * Math.abs(c) ** e);
  };
  const nrm = (x, t) => { const s = at(x); return new THREE.Vector3(0, Math.sin(t) / Math.max(s.h, 1e-3), Math.cos(t) / Math.max(s.w, 1e-3)).normalize(); };
  const [x0, x1] = range ?? [X[0], X[X.length - 1]];
  let xs = [];
  for (let i = 0; i < X.length - 1; i++) for (let s = 0; s < sub; s++) xs.push(X[i] + ((X[i + 1] - X[i]) * s) / sub);
  xs.push(X[X.length - 1]);
  xs = xs.filter((x) => x > x0 + 0.02 && x < x1 - 0.02 && !cuts.some((c) => Math.abs(x - c) < 0.03)).map((x) => ({ x, q: 0 }));
  xs.push({ x: x0, q: 0 }, { x: x1, q: 0 });
  for (const c of cuts) if (c > x0 + 0.01 && c < x1 - 0.01) xs.push({ x: c, q: -1 }, { x: c, q: 1 });
  xs.sort((a, b) => a.x - b.x || a.q - b.q);
  const closed = !arc, [a0, a1] = arc ?? [0, TAU], wrap = (t) => (closed ? ((t % TAU) + TAU) % TAU : t);
  let ts = [];
  for (let j = 0; j < (closed ? seg : seg + 1); j++) ts.push(a0 + ((a1 - a0) * j) / seg);
  ts = ts.filter((t) => !angles.some((c) => Math.abs(wrap(c) - t) < 0.03 || Math.abs(wrap(c) - t - TAU) < 0.03)).map((t) => ({ t, q: 0 }));
  for (const c of angles) { const t = wrap(c); if (closed || (t > a0 && t < a1)) ts.push({ t, q: -1 }, { t, q: 1 }); }
  ts.sort((a, b) => a.t - b.t || a.q - b.q);
  const pos = [], col = [], idx = [], n = ts.length;
  for (const a of xs) for (const b of ts) {
    const p = pt(a.x, b.t), px = a.x + a.q * 0.002, pa = b.t + b.q * 0.004;
    pos.push(p.x, p.y, p.z);
    const c = paint(pt(px, pa), nrm(px, pa), { tag, t: pa, x: px });
    col.push(c.r, c.g, c.b);
  }
  const jn = closed ? n : n - 1;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j < jn; j++) {
    const j1 = (j + 1) % n, a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j1, d = i * n + j1;
    idx.push(a, b, c, a, c, d);
  }
  if (closed) for (const [end, dir] of [[0, -1], [xs.length - 1, 1]]) {
    const x = xs[end].x, s = at(x), k = dir < 0 ? 0 : 1;
    if (!caps[k] || s.w < 1e-3 || s.h < 1e-3) continue;
    const cc = capColor[k] != null ? C(capColor[k]) : paint(new THREE.Vector3(x, s.y, z0), new THREE.Vector3(dir, 0, 0), { tag, x, t: PI / 2 });
    const mid = pos.length / 3;
    pos.push(x, s.y, z0); col.push(cc.r, cc.g, cc.b);
    for (const b of ts) { const p = pt(x, b.t); pos.push(p.x, p.y, p.z); col.push(cc.r, cc.g, cc.b); }
    for (let j = 0; j < n; j++) { const j1 = (j + 1) % n; if (dir > 0) idx.push(mid, mid + 1 + j1, mid + 1 + j); else idx.push(mid, mid + 1 + j, mid + 1 + j1); }
  }
  let geo = sheet(pos, col, idx, ang);
  // the top-view outline for the ground shadow
  const xo = xs.filter((a) => a.q <= 0).map((a) => a.x), outline = [...xo.map((x) => [x, z0 + at(x).w / 2]), ...xo.reverse().map((x) => [x, z0 - at(x).w / 2])];
  const outlines = [outline];
  if (mirror) { geo = mirrorZ(geo); outlines.push(outline.map(([x, z]) => [x, -z])); }
  const side = (x, y) => { const s = at(x), u = Math.abs(y - s.y) / Math.max(1e-6, s.h / 2); return u >= 1 ? 0 : (s.w / 2) * (1 - u ** s.p) ** (1 / s.p); };
  return { geo, at, side, top: (x) => { const s = at(x); return s.y + s.h / 2; }, bottom: (x) => { const s = at(x); return s.y - s.h / 2; }, outlines };
}

// A wing, tailplane or fin: airfoil sections from the root out to the tip. keys: [z, le, te, y, t] (z along the span,
// x of the leading and trailing edge, height of the chord line, thickness over chord), straight between keys (smooth:
// a curve instead). round: how far in from the tip the planform rounds off (a number, or [root, tip] to round both
// ends). nk: points along each surface; n: sections between root and tip; cuts: z positions of sharp paint edges.
// m: a matrix that moves the finished piece (a fin stands it up); mirror adds the left side. The leading edge is
// painted a little lighter (edge). paint(p, n, {tag, upper, z, s, xs}) colours each vertex.
function wing(keys, o) {
  const { nk = 6, n = 6, round = 0.3, cuts = [], tag = 'wing', m = null, camber = 0.025, lower = 0.8, ridges = 0, edge = 1.12, crease: ang = 35, smooth = false, mirror = true, paint } = o;
  const [r0, r1] = Array.isArray(round) ? round : [0, Math.max(0.05, round)];
  const Z = keys.map((k) => k[0]), F = smooth ? pchip : lin;
  const LE = F(Z, keys.map((k) => k[1])), TE = F(Z, keys.map((k) => k[2])), Yc = lin(Z, keys.map((k) => k[3] ?? 0)), T = lin(Z, keys.map((k) => k[4] ?? 0.12));
  const za = Z[0], zb = Z[Z.length - 1];
  const plan = (z) => {
    let le = LE(z), te = TE(z), f = 1;
    if (r1 > 0 && z > zb - r1) { const u = Math.min(1, (z - zb + r1) / r1); f = Math.sqrt(Math.max(0, 1 - u * u)); }
    if (r0 > 0 && z < za + r0) { const u = Math.min(1, (za + r0 - z) / r0); f = Math.min(f, Math.sqrt(Math.max(0, 1 - u * u))); }
    if (f < 1) { const mid = te + (le - te) * 0.55; le = mid + (le - mid) * f; te = mid + (te - mid) * f; }
    return { le, te, y: Yc(z), t: T(z) };
  };
  const b0 = za + r0, b1 = zb - r1;
  let zs = [];
  for (let k = 0; k <= n; k++) zs.push(b0 + ((b1 - b0) * k) / n);
  for (const z of Z) if (z > b0 && z < b1) zs.push(z);
  for (let k = 1; k <= 4; k++) { if (r1 > 0) zs.push(b1 + r1 * Math.sin((PI / 2) * (k / 4))); if (r0 > 0) zs.push(b0 - r0 * Math.sin((PI / 2) * (k / 4))); }
  zs.sort((a, b) => a - b);
  zs = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.02);
  let st = zs.filter((z) => !cuts.some((c) => Math.abs(z - c) < 0.03)).map((z) => ({ z, q: 0 }));
  for (const c of cuts) if (c > za && c < zb) st.push({ z: c, q: -1 }, { z: c, q: 1 });
  st.sort((a, b) => a.z - b.z || a.q - b.q);
  const ring = [];
  for (let k = nk; k >= 0; k--) ring.push([k, 1]);
  for (let k = 1; k <= nk; k++) ring.push([k, -1]);
  const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
  const point = (pl, k, side, z, rid) => {
    const xs = (1 - Math.cos((PI * k) / nk)) / 2, c = pl.le - pl.te, yt = naca(xs) * pl.t * rid;
    return new THREE.Vector3(pl.le - xs * c, pl.y + c * camber * 4 * xs * (1 - xs) + side * c * yt * (side > 0 ? 1 : lower), z);
  };
  const pos = [], col = [], idx = [], rn = ring.length, lead = [], trail = [];
  st.forEach((s, i) => {
    const pl = plan(s.z), pp = plan(s.z + s.q * 0.002), rid = 1 + ridges * (i % 2 ? 1 : -1);
    for (const [k, side] of ring) {
      const v = point(pl, k, side, s.z, rid), probe = point(pp, k, side, s.z + s.q * 0.002, rid), nn = new THREE.Vector3(k === 0 ? 1 : 0, k === 0 ? 0 : side, 0);
      if (m) { v.applyMatrix4(m); probe.applyMatrix4(m); nn.applyMatrix3(nm).normalize(); }
      pos.push(v.x, v.y, v.z);
      const c = paint(probe, nn, { tag, upper: side > 0, z: s.z + s.q * 0.002, s: (s.z - za) / (zb - za), xs: (1 - Math.cos((PI * k) / nk)) / 2, row: i });
      if (k <= 1) c.multiplyScalar(edge);
      col.push(c.r, c.g, c.b);
      if (k === 0 && s.q <= 0) lead.push([v.x, v.z]);
      if (k === nk && side > 0 && s.q <= 0) trail.push([v.x, v.z]);
    }
  });
  for (let i = 0; i + 1 < st.length; i++) for (let j = 0; j < rn; j++) {
    const j1 = (j + 1) % rn, a = i * rn + j, b = (i + 1) * rn + j, c = (i + 1) * rn + j1, d = i * rn + j1;
    idx.push(a, b, c, a, c, d);
  }
  let geo = sheet(pos, col, idx, ang);
  const outline = [...lead, ...trail.reverse()], outlines = [outline];
  if (mirror) { geo = mirrorZ(geo); outlines.push(outline.map(([x, z]) => [x, -z])); }
  // the height of the upper (side 1) or lower (side -1) surface at (x, z), in the wing's own frame
  const surf = (x, z, side = 1) => {
    const pl = plan(Math.abs(z)), c = Math.max(1e-6, pl.le - pl.te), xs = clamp01((pl.le - x) / c);
    return pl.y + c * camber * 4 * xs * (1 - xs) + side * c * naca(xs) * pl.t * (side > 0 ? 1 : lower);
  };
  return { geo, outlines, plan, surf, m, mirrored: mirror };
}

// ---------------------------------------------------------------- markings

// flat decal layers facing +z at z = lift, each {outline, holes, color}
function flat(layers, lift = 0) {
  const pos = [], col = [];
  for (const { outline, holes = [], color } of layers) {
    const c = C(color), cont = outline.map(([x, y]) => new THREE.Vector2(x, y)), hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))), all = [...cont, ...hs.flat()];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(cont, hs)) {
      const A = all[i], B = all[j], D = all[k], z = (B.x - A.x) * (D.y - A.y) - (B.y - A.y) * (D.x - A.x);
      for (const P of z >= 0 ? [A, B, D] : [A, D, B]) { pos.push(P.x, P.y, lift); col.push(c.r, c.g, c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// The US star and bar, R the radius of the blue disc: white star, white bars R long and R/2 tall with a blue edge.
function usInsignia(R) {
  const s = star(R / 1.06, { color: WHITE, disc: BLUE, lift: 0 });
  const ring = Array.from({ length: 32 }, (_, k) => { const a = PI / 2 + (k / 32) * TAU; return [R * Math.cos(a), R * Math.sin(a)]; });
  // x of the disc's right edge at height y, on the same 32-sided outline star() draws
  const edgeX = (y) => {
    for (let k = 0; k < 32; k++) {
      const a = ring[k], b = ring[(k + 1) % 32];
      if (a[0] > 0 && b[0] > 0 && (a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    }
    return R;
  };
  const arc = (y0, y1) => [[edgeX(y0), y0], ...ring.filter(([x, y]) => x > 0 && y > y0 + 1e-6 && y < y1 - 1e-6).sort((p, q) => p[1] - q[1]), [edgeX(y1), y1]];
  const h = R / 4, e = R / 8, L = 2 * R, layers = [];
  for (const sx of [1, -1]) {
    const S = (pts) => pts.map(([x, y]) => [sx * x, y]);
    layers.push(
      { color: WHITE, outline: S([[L, -h], [L, h], ...arc(-h, h).reverse()]) },
      { color: BLUE, outline: S([...arc(h, h + e), [L + e, h + e], [L, h]]) },
      { color: BLUE, outline: S([...arc(-h - e, -h), [L, -h], [L + e, -h - e]]) },
      { color: BLUE, outline: S([[L, -h], [L + e, -h - e], [L + e, h + e], [L, h]]) },
    );
  }
  return merge([{ geo: s.index ? s.toNonIndexed() : s }, { geo: withNormal(flat(layers)) }]);
}
const withNormal = (g) => { g.computeVertexNormals(); return g; };

// A marking laid on a curved surface: frame places the flat decal, its triangles are split until no edge is longer
// than max (an edge is split the same way in both triangles that share it, so nothing cracks), then fit(v) moves
// every corner onto the surface.
function stick(mark, frame, fit, max) {
  const g = mark.index ? mark.toNonIndexed() : mark, P = g.attributes.position, K = g.attributes.color;
  let tris = [];
  for (let i = 0; i < P.count; i += 3) tris.push({ v: [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(P, i + k).applyMatrix4(frame)), c: [K.getX(i), K.getY(i), K.getZ(i)] });
  const mid = (p, q) => p.clone().add(q).multiplyScalar(0.5);
  for (let pass = 0; pass < 8; pass++) {
    let split = false;
    const out = [], T = (c, p, q, r) => out.push({ v: [p, q, r], c });
    for (const t of tris) {
      const [a, b, c] = t.v, L = [a.distanceTo(b) > max, b.distanceTo(c) > max, c.distanceTo(a) > max], k = L.filter(Boolean).length;
      if (!k) { out.push(t); continue; }
      split = true;
      if (k === 3) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); T(t.c, a, ab, ca); T(t.c, ab, b, bc); T(t.c, ca, bc, c); T(t.c, ab, bc, ca); }
      else if (k === 1) {
        if (L[0]) { const q = mid(a, b); T(t.c, a, q, c); T(t.c, q, b, c); }
        else if (L[1]) { const q = mid(b, c); T(t.c, a, b, q); T(t.c, a, q, c); }
        else { const q = mid(c, a); T(t.c, a, b, q); T(t.c, q, b, c); }
      } else {
        const [p, q, r] = !L[2] ? [a, b, c] : !L[0] ? [b, c, a] : [c, a, b], pq = mid(p, q), qr = mid(q, r);
        T(t.c, pq, q, qr); T(t.c, p, pq, qr); T(t.c, p, qr, r);
      }
    }
    tris = out;
    if (!split) break;
  }
  const pos = [], col = [], idx = [];
  for (const t of tris) for (const v of t.v) { const w = v.clone(); fit(w); idx.push(pos.length / 3); pos.push(w.x, w.y, w.z); col.push(...t.c); }
  return sheet(pos, col, idx, 70);
}

// ---------------------------------------------------------------- paint

// The game's sun is warm and its tone mapping pulls the grey out of dark colours, so the paints lean a little cool and
// grey to read as the real colours under them.
const METAL = 0xb4bec6, OD = 0x535b48, NEUTRAL = 0x8c9294;
const RLM70 = 0x2c3430, RLM71 = 0x4b5846, RLM65 = 0x9db6c8, RLM74 = 0x5c656c, RLM75 = 0x858e96, RLM76 = 0xb2c3cf;
const VVS_GREEN = 0x55664a, VVS_BLACK = 0x2e3434, VVS_BLUE = 0x9ab4c6;

// camouflage patterns: the upper colour at a point. The paint is per vertex, so the patches are a couple of metres
// across: anything finer would be lost between the vertices.
const solid = (h) => () => C(h);
const splinter = (a, b, s = 1.5) => (p) => {
  const q = p.z + 0.8 * p.y, k = Math.floor((0.82 * p.x + 0.57 * q) / s) + Math.floor((-0.5 * p.x + 0.87 * q) / (1.3 * s));
  return C(k & 1 ? a : b);
};
const waves = (a, b, s = 1) => (p) => {
  const q = p.z + 0.8 * p.y, w = Math.sin(((0.75 * p.x - 0.66 * q) * 1.15) / s + 2.6 * noise((0.33 * p.x) / s + 3.1, (0.33 * q) / s));
  return C(w > 0 ? b : a);
};
const mottle = (base, spot, s = 1) => (p) => C(noise((p.x * 1.7) / s + 1.3, ((p.z + 0.8 * p.y) * 1.7) / s) > 0.55 ? spot : base);

// A paint scheme: top(p, n, info) the upper colour, under the underside colour (null: none). Bodies switch to the
// underside below `line` (the sine of the ring angle), wings and tailplanes on their lower surface, other parts when
// they face down. A light wash of noise keeps big panels from looking flat.
function livery(top, under = null, line = -0.3) {
  const U = under == null ? null : C(under);
  return (p, n, i) => {
    let low = false;
    if (U && i.tag !== 'fin' && i.tag !== 'canopy') {
      if (i.tag === 'leg') low = false;
      else if (i.upper !== undefined) low = !i.upper;
      else if (i.t !== undefined) low = Math.sin(i.t) < line;
      else low = n.y < -0.3;
    }
    const c = low ? U.clone() : top(p, n, i);
    return c.multiplyScalar(0.94 + 0.12 * noise(p.x * 2.1 + 7, (p.z + 0.8 * p.y) * 2.1));
  };
}
// canopy glass: blue-grey, catching the sky on top, so the frames show against it
const glass = (n) => C(GLASS).lerp(C(SKY), 0.15 + 0.6 * Math.max(0, n.y) ** 2);

// ---------------------------------------------------------------- the kit

function kit(own) {
  const parts = [], polys = [], props = [];
  const K = {
    own: C(own), paint: null, parts, polys, props,
    add(geo, m = null, color = 0xffffff) { parts.push({ geo, color, m }); },
    hull(keys, o = {}) { const h = hull(keys, { paint: K.paint, ...o }); K.add(h.geo); if (o.shadow !== false) polys.push(...h.outlines); return h; },
    wing(keys, o = {}) { const w = wing(keys, { paint: K.paint, ...o }); K.add(w.geo); if (o.shadow !== false) polys.push(...w.outlines); return w; },
    // a fin standing on (y, z): keys as for a wing with z the height above y
    fin(keys, o = {}) {
      const m = new THREE.Matrix4().makeTranslation(0, o.y ?? 0, o.z ?? 0).multiply(new THREE.Matrix4().makeRotationX(-PI / 2));
      const w = wing(keys, { paint: K.paint, tag: 'fin', mirror: false, ...o, m });
      K.add(w.geo);
      return w;
    },
    // a canopy on a body: rel [x, w, height over the body's top]; frames: x of the cross frames; bars: ring angles of
    // the long frames (a number, or {a, x0, x1} for part of the length). The frames take the body paint unless frame.
    canopy(body, rel, o = {}) {
      const { p = 2.4, sink = 0.2, frames = [], bars = [], fw = 0.045, bw = 0.07, seg = 12, frame = null, arc = [-0.4, PI + 0.4] } = o;
      const keys = rel.map(([x, w, ha]) => { const s = body.at(x); return [x, w, 2 * (ha + sink), s.y + s.h / 2 - sink, p]; });
      const B = bars.map((b) => (typeof b === 'number' ? { a: b, x0: -1e9, x1: 1e9 } : b));
      const paint = (q, n, i) => {
        const on = frames.some((x) => Math.abs(q.x - x) < fw / 2) || B.some((b) => Math.abs(i.t - b.a) < bw / 2 && q.x > b.x0 && q.x < b.x1);
        return on ? (frame != null ? C(frame) : K.paint(q, new THREE.Vector3(0, 1, 0), { tag: 'canopy' })) : glass(n);
      };
      return K.hull(keys, { seg, arc, paint, tag: 'canopy', shadow: false, crease: 55, cuts: frames.flatMap((x) => [x - fw / 2, x + fw / 2]), angles: B.flatMap((b) => [b.a - bw / 2, b.a + bw / 2]) });
    },
    // any shape painted by the plane's paint at each vertex (after m)
    painted(geo, m, tag = 'part', paint = K.paint, mirror = false) {
      const g = geo.clone();
      if (m) g.applyMatrix4(m);
      const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3), p = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); paint(p, n, { tag }).toArray(col, i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      K.add(g);
      if (mirror) K.add(g, MIRROR);
    },
    box(x, y, z, sx, sy, sz, color, ry = 0, rz = 0, rx = 0) { K.add(BOX, xf(x, y, z, rx, ry, rz, sx, sy, sz), color); },
    rod(a, b, r, color, radial = 6) { K.add(tube([a, b], r, { radial }), null, color); },
    spin(x, len, r, color, y = 0, z = 0) { K.add(spinner(len, r, 14), new THREE.Matrix4().makeTranslation(x, y, z), color); },
    prop(x, y, z, r, n) { props.push({ x, y, z, r, n }); },
    // a radial engine: cowling (painted, or a ring colour) from x to x + len, a dark face and cylinder heads
    radial({ x, y = 0, z = 0, r, len, ring = null, cyl = 9, cowl = true, mirror = false }) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      if (cowl) {
        const g = lathe([[0.95 * r, 0], [r, 0.18 * len], [r, 0.72 * len], [0.96 * r, 0.92 * len], [0.89 * r, len], [0.82 * r, 0.97 * len], [0.8 * r, 0.8 * len]], 18, { axis: 'x' });
        K.painted(g, m, 'cowl', ring != null ? () => C(ring) : K.paint, mirror);
      }
      const face = lathe([[0, 0.86 * len + 0.16 * r], [0.22 * r, 0.86 * len + 0.12 * r], [0.3 * r, 0.86 * len], [0.83 * r, 0.8 * len]], 14, { axis: 'x' });
      const ms = mirror ? [m, MIRROR.clone().multiply(m)] : [m];
      for (const mm of ms) {
        K.add(face, mm, DARK);
        for (let k = 0; k < cyl; k++) K.add(BOX, mm.clone().multiply(xf(0.84 * len, 0, 0, (k / cyl) * TAU)).multiply(xf(0, 0.57 * r, 0, 0, 0, 0, 0.12 * r, 0.34 * r, 0.17 * r)), 0x5d5b53);
        K.add(spinner(0.16 * r + 0.06, 0.17 * r, 10), mm.clone().multiply(new THREE.Matrix4().makeTranslation(0.86 * len + 0.1 * r, 0, 0)), STEEL);
      }
    },
    // exhaust stubs along a body side, both sides
    stubs(body, x0, x1, y, count, size = 0.09) {
      for (const s of [1, -1]) for (let k = 0; k < count; k++) {
        const x = x0 + ((x1 - x0) * k) / Math.max(1, count - 1);
        K.box(x, y, s * (body.side(x, y) + size * 0.3), size * 1.5, size, size * 1.1, EXHAUST, 0, -0.35);
      }
    },
    // a national marking: kind 'us', 'cross' or 'star'; on a wing {wing, x, z}, on a body's sides {hull, x, y} or on a
    // fin's sides {fin, x, h}; sides picks 1 and/or -1
    mark(kind, size, o) {
      const g = kind === 'us' ? usInsignia(size) : kind === 'cross' ? balkenkreuz(size, { lift: 0 }) : star(size, { color: RED, border: WHITE, edge: 0.12, lift: 0 });
      if (o.wing) {
        const W = o.wing, at = [o.x, W.surf(o.x, o.z), o.z];
        K.add(stick(g, place(at, [0, 1, 0], [1, 0, 0]), (v) => { v.y = W.surf(v.x, v.z) + 0.02; }, 0.7));
      } else if (o.hull) {
        for (const s of o.sides ?? [1, -1]) {
          const B = o.hull, at = [o.x, o.y, s * B.side(o.x, o.y)];
          K.add(stick(g, place(at, [0, 0, s], [0, 1, 0]), (v) => { v.z = s * (B.side(v.x, v.y) + 0.02); }, 0.24));
        }
      } else if (o.fin) {
        for (const s of o.sides ?? [1, -1]) {
          const F = o.fin, at = [o.x, F.surf(o.x, o.h, s), o.h];
          const geo = stick(g, place(at, [0, s, 0], [0, 0, 1]), (v) => { v.y = F.surf(v.x, v.z, s) + s * 0.015; }, 0.45);
          K.add(geo, F.m);
          if (F.mirrored) K.add(geo, MIRROR.clone().multiply(F.m));
        }
      }
    },
    // small dark windows on a body's sides: x positions, at height y, w by h
    windows(body, xs, y, w, h, color = GLASS) {
      const g = flat([{ outline: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], color }]);
      for (const s of [1, -1]) for (const x of xs) K.add(stick(g, place([x, y, s * body.side(x, y)], [0, 0, s], [0, 1, 0]), (v) => { v.z = s * (body.side(v.x, v.y) + 0.015); }, 0.2));
    },
    wheel(x, y, z, r, w, mirror = true, seg = 12) {
      const g = lathe([[0, -0.36 * w], [0.45 * r, -0.42 * w], [0.62 * r, -0.5 * w], [0.88 * r, -0.5 * w], [r, -0.22 * w], [r, 0.22 * w], [0.88 * r, 0.5 * w], [0.62 * r, 0.5 * w], [0.45 * r, 0.42 * w], [0, 0.36 * w]], seg, { axis: 'z' });
      K.add(g, new THREE.Matrix4().makeTranslation(x, y, z), 0x2e2d29);
      if (mirror) K.add(g, new THREE.Matrix4().makeTranslation(x, y, -z), 0x2e2d29);
    },
  };
  return K;
}

// owner colour, wing tips and fin top: a paint wrapper used by every plane
function owned(K, base, tip, finTop) {
  return (p, n, i) => {
    if (i.tag === 'wing' && Math.abs(p.z) > tip) return K.own.clone();
    if (i.tag === 'fin' && i.z > finTop) return K.own.clone();
    return base(p, n, i);
  };
}

// ---------------------------------------------------------------- USA

// P-51D Mustang: bare metal, olive anti-glare panel, bubble canopy, belly scoop, four-blade prop.
function p51(K) {
  const base = livery(solid(METAL)), od = C(0x4b5334);
  K.paint = owned(K, (p, n, i) => (i.tag === 'fus' && p.x > 1.35 && p.x < 3.45 && Math.sin(i.t) > 0.7 ? od.clone() : base(p, n, i)), 4.15, 0.9);
  const fus = K.hull([[-3.95, 0.04, 0.12, 0.42], [-3.6, 0.2, 0.46, 0.38], [-3.0, 0.36, 0.7, 0.31], [-2.0, 0.56, 0.95, 0.22], [-1.0, 0.74, 1.12, 0.16], [-0.1, 0.86, 1.22, 0.12], [0.7, 0.92, 1.24, 0.1], [1.5, 0.92, 1.2, 0.08], [2.4, 0.86, 1.06, 0.06], [3.1, 0.78, 0.88, 0.04], [3.5, 0.7, 0.72, 0.04]], { seg: 18, cuts: [1.35, 3.45], angles: [0.775, PI - 0.775] });
  K.canopy(fus, [[1.45, 0.06, 0.0], [1.33, 0.44, 0.2], [1.1, 0.56, 0.36], [0.7, 0.6, 0.44], [0.25, 0.56, 0.42], [-0.15, 0.42, 0.28], [-0.5, 0.18, 0.08], [-0.65, 0.04, 0.0]], { p: 2, frames: [1.08], bars: [{ a: 0.95, x0: 1.08, x1: 2 }, { a: PI - 0.95, x0: 1.08, x1: 2 }], seg: 14 });
  const w = K.wing([[0, 1.15, -1.15, -0.3, 0.15], [4.6, 0.55, -0.5, 0.1, 0.11]], { n: 7, round: 0.18, cuts: [4.15] });
  K.wing([[0, -2.95, -3.92, 0.24, 0.1], [2.0, -3.35, -3.85, 0.24, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.35 });
  K.fin([[0, -2.3, -3.98, 0, 0.1], [0.2, -2.95, -3.98, 0, 0.1], [0.5, -3.15, -3.97, 0, 0.1], [1.2, -3.45, -3.92, 0, 0.09]], { y: 0.42, nk: 4, n: 4, round: 0.3, cuts: [0.9], smooth: true });
  K.hull([[-2.25, 0.16, 0.1, -0.22], [-1.7, 0.44, 0.36, -0.38], [-0.8, 0.54, 0.46, -0.54], [0.15, 0.5, 0.42, -0.52], [0.42, 0.44, 0.36, -0.5]], { seg: 12, tag: 'pod', capColor: [null, DARK] });
  K.hull([[2.55, 0.1, 0.06, -0.3], [2.9, 0.3, 0.26, -0.38], [3.3, 0.3, 0.26, -0.36]], { seg: 10, tag: 'pod', capColor: [null, DARK], shadow: false });
  K.stubs(fus, 2.1, 3.05, 0.2, 6);
  K.spin(3.48, 0.62, 0.35, K.own, 0.04);
  K.prop(3.62, 0.04, 0, 1.35, 4);
  K.mark('us', 0.42, { wing: w, x: 0.15, z: -2.9 });
  K.mark('us', 0.3, { hull: fus, x: -1.75, y: 0.15 });
  return { span: 9.2, len: 8.0, tail: -3.95, nose: 4.1 };
}

// P-47D Thunderbolt: a barrel of a fuselage behind a big round cowl, razorback canopy, elliptical wing, bombs and
// rockets, olive drab over grey. The cowl lip is the owner's colour.
function p47(K) {
  const base = livery(solid(OD), NEUTRAL, -0.35);
  K.paint = owned(K, (p, n, i) => ((i.tag === 'fus' || i.tag === 'cowl') && p.x > 4.2 ? K.own.clone() : base(p, n, i)), 5.05, 0.95);
  const fus = K.hull([[-4.72, 0.04, 0.12, 0.5], [-4.3, 0.24, 0.56, 0.45], [-3.4, 0.5, 0.98, 0.33], [-2.2, 0.82, 1.4, 0.17], [-1.0, 1.08, 1.7, 0.04], [0.2, 1.26, 1.86, -0.04], [1.4, 1.34, 1.8, -0.05], [2.6, 1.4, 1.62, -0.01], [3.5, 1.44, 1.48, 0.02], [4.0, 1.44, 1.42, 0.02], [4.38, 1.4, 1.36, 0.02]], { seg: 20, cuts: [4.2], angles: [-0.358, PI + 0.358], caps: [true, false] });
  K.add(lathe([[0.7, 0], [0.66, -0.03], [0.64, -0.2]], 20, { axis: 'x' }), new THREE.Matrix4().makeTranslation(4.38, 0.02, 0), K.own);
  K.radial({ x: 3.9, r: 0.86, len: 0.42, cowl: false, cyl: 9 });
  // the razorback spine from the canopy down to the fin
  K.hull([[-3.6, 0.1, 0.5, 0.56], [-2.4, 0.26, 0.6, 0.72], [-1.0, 0.36, 0.6, 0.86], [0.1, 0.42, 0.56, 0.98], [0.45, 0.42, 0.5, 1.02]], { seg: 10, tag: 'fus', shadow: false, caps: [false, true] });
  K.canopy(fus, [[1.8, 0.3, 0.02], [1.62, 0.64, 0.3], [1.3, 0.72, 0.42], [0.8, 0.72, 0.44], [0.45, 0.62, 0.42], [0.3, 0.44, 0.38]], { p: 2.6, frames: [1.42, 0.98, 0.5], bars: [PI / 2], seg: 12 });
  const w = K.wing([[0, 1.25, -1.35, -0.5, 0.15], [5.6, 0.85, -0.4, -0.1, 0.1]], { n: 7, round: 1.7, cuts: [5.05] });
  K.wing([[0, -3.45, -4.6, 0.33, 0.1], [2.3, -3.85, -4.45, 0.33, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 1.0 });
  K.fin([[0, -2.9, -4.72, 0, 0.1], [0.3, -3.45, -4.74, 0, 0.1], [1.25, -3.95, -4.7, 0, 0.09]], { y: 0.6, nk: 4, n: 4, round: 0.7, cuts: [0.95], smooth: true });
  for (const s of [1, -1]) {
    const bz = 2.2 * s, by = w.surf(0, 2.2, -1) - 0.36;
    K.add(bomb(1.5, 0.26, { segments: 10 }), xf(-0.85, by - 0.06, bz), 0x6a7058);
    K.box(-0.1, by + 0.24, bz, 0.5, 0.18, 0.06, DARK);
    // an M10 cluster: three rocket tubes in a bundle under the outer wing
    const rz = 3.55, ry = w.surf(0.3, rz, -1) - 0.3;
    K.box(0.15, ry + 0.2, s * rz, 0.6, 0.16, 0.05, DARK);
    for (const [dy, dz] of [[0.09, 0], [-0.08, 0.11], [-0.08, -0.11]]) {
      K.add(tube([[-0.55, ry + dy, s * rz + dz], [1.75, ry + dy, s * rz + dz]], 0.095, { radial: 7, caps: true }), null, 0x7a7f6a);
      K.add(lathe([[0.075, 0], [0, 0.01]], 7, { axis: 'x' }), xf(1.755, ry + dy, s * rz + dz), DARK);
    }
  }
  K.prop(4.5, 0.02, 0, 1.62, 4);
  K.mark('us', 0.5, { wing: w, x: 0.1, z: -3.6 });
  K.mark('us', 0.38, { hull: fus, x: -2.0, y: 0.18 });
  return { span: 11.2, len: 9.5, tail: -4.72, nose: 4.6 };
}

// B-25J Mitchell: slab-sided fuselage, framed glass nose, stepped cockpit, top turret, gull wing with long nacelles,
// twin fins on the tailplane tips, tail gunner's glazing.
function b25(K) {
  const base = livery(solid(OD), NEUTRAL, -0.35), od = C(OD);
  const frameX = [6.05, 6.35, 6.62], bars = [0.5, PI / 2, PI - 0.5];
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && p.x > 5.75 && Math.sin(i.t) > -0.35) return frameX.some((x) => Math.abs(p.x - x) < 0.03) || bars.some((a) => Math.abs(i.t - a) < 0.04) ? od.clone() : glass(n);
    if (i.tag === 'fus' && p.x < -5.9 && Math.sin(i.t) > -0.35) return Math.abs(p.x + 6.15) < 0.03 ? od.clone() : glass(n);
    if (i.tag === 'fin' && i.z > 1.15) return K.own.clone();
    return base(p, n, i);
  }, 8.05, 9);
  const keys = [[-6.45, 0.26, 0.36, 0.45, 2], [-6.0, 0.56, 0.78, 0.42, 2.2], [-5.0, 0.84, 1.08, 0.34, 2.6], [-3.0, 1.14, 1.44, 0.18, 2.8], [-0.5, 1.3, 1.66, 0.08, 3], [2.0, 1.34, 1.7, 0.06, 3], [3.6, 1.34, 1.68, 0.04, 3], [4.7, 1.3, 1.58, 0.0, 2.8], [5.6, 1.18, 1.34, -0.06, 2.4], [6.3, 0.9, 0.98, -0.1, 2.2], [6.75, 0.52, 0.56, -0.12, 2], [6.95, 0.04, 0.04, -0.12, 2]];
  const under = [PI + 0.358, TAU - 0.358];
  const fus = K.hull(keys, { seg: 20, range: [-6.45, 5.75], cuts: [-6.13, -6.17, -5.9], angles: under, capColor: [GLASS, null] });
  K.hull(keys, { seg: 20, range: [5.75, 6.95], cuts: frameX.flatMap((x) => [x - 0.03, x + 0.03]), angles: [...under, ...bars.flatMap((a) => [a - 0.04, a + 0.04])], shadow: false });
  K.canopy(fus, [[5.15, 0.6, 0.02], [4.9, 1.0, 0.26], [4.45, 1.1, 0.38], [3.8, 1.08, 0.38], [3.4, 0.9, 0.28], [3.1, 0.4, 0.04]], { p: 3, frames: [4.62, 4.2, 3.75], bars: [PI / 2], seg: 12, sink: 0.25 });
  // top turret
  const ty = fus.top(2.5) - 0.05;
  K.add(lathe([[0.5, 0], [0.5, 0.06], [0.46, 0.18], [0.34, 0.34], [0.18, 0.44], [0, 0.48]], 14), new THREE.Matrix4().makeTranslation(2.5, ty, 0), GLASS);
  K.add(lathe([[0.53, -0.1], [0.53, 0.07]], 14), new THREE.Matrix4().makeTranslation(2.5, ty, 0), OD);
  for (const s of [1, -1]) K.rod([2.6, ty + 0.25, s * 0.12], [3.5, ty + 0.27, s * 0.12], 0.035, DARK);
  const w = K.wing([[0, 2.85, -0.85, -0.1, 0.17], [2.95, 2.55, -0.75, 0.32, 0.16], [8.6, 1.3, 0.0, 0.26, 0.1]], { n: 8, round: 0.5, cuts: [8.05] });
  K.hull([[-2.6, 0.04, 0.06, 0.26], [-1.9, 0.42, 0.52, 0.22], [-0.6, 0.86, 1.08, 0.2], [1.2, 1.12, 1.36, 0.24], [3.0, 1.24, 1.4, 0.27], [4.4, 1.26, 1.3, 0.28]], { seg: 16, z: 2.95, mirror: true, tag: 'nac', angles: under });
  K.radial({ x: 4.35, y: 0.28, z: 2.95, r: 0.65, len: 0.72, mirror: true });
  K.wing([[0, -5.05, -6.3, 0.62, 0.1], [2.85, -5.25, -6.25, 0.72, 0.1]], { tag: 'tail', nk: 4, n: 3, round: 0.12 });
  K.fin([[-0.75, -5.0, -6.38, 0, 0.1], [1.45, -5.15, -6.35, 0, 0.1]], { y: 0.72, z: 2.88, mirror: true, nk: 4, n: 3, round: [0.22, 0.3], cuts: [1.15] });
  for (const s of [1, -1]) { K.rod([6.4, -0.32, s * 0.12], [7.25, -0.32, s * 0.12], 0.035, DARK); K.rod([-6.2, 0.45, s * 0.08], [-6.9, 0.42, s * 0.08], 0.035, DARK); }
  for (const z of [2.95, -2.95]) K.prop(5.2, 0.28, z, 1.55, 3);
  K.mark('us', 0.5, { hull: fus, x: -3.4, y: 0.22 });
  K.mark('us', 0.6, { wing: w, x: 0.75, z: -6.0 });
  return { span: 17.2, len: 13.4, tail: -6.45, nose: 6.95 };
}

// The DC-3 airframe, shared by the C-47 and the Li-2: round fuselage, cockpit and cabin windows, swept outer wing,
// radial engines, tall fin with a dorsal fillet. o: paint (a function), stripes (invasion stripes), marks(fus, wing, fin).
function dc3(K, o) {
  K.paint = owned(K, o.paint, 9.2, 1.45);
  const ws = [0.3, 0.72], cockpit = [Math.asin(ws[0]), Math.asin(ws[1]), PI - Math.asin(ws[1]), PI - Math.asin(ws[0])];
  const paint = K.paint;
  K.paint = (p, n, i) => {
    if (i.tag === 'fus' && p.x > 5.5 && p.x < 6.15 && Math.sin(i.t) > ws[0] && Math.sin(i.t) < ws[1]) return Math.abs(p.x - 5.85) < 0.025 ? paint(p, n, { ...i, t: PI / 2 }) : C(GLASS).lerp(C(SKY), 0.42);
    return paint(p, n, i);
  };
  const cuts = [5.5, 5.825, 5.875, 6.15, ...(o.stripes ? [-4.1, -3.68, -3.26, -2.84, -2.42, -2.0] : [])];
  const fus = K.hull([[-6.6, 0.1, 0.18, 0.78], [-6.1, 0.36, 0.52, 0.7], [-5.0, 0.76, 0.98, 0.5], [-3.4, 1.22, 1.42, 0.3], [-1.6, 1.52, 1.64, 0.16], [0.5, 1.6, 1.7, 0.1], [3.5, 1.6, 1.7, 0.1], [4.9, 1.52, 1.6, 0.06], [5.7, 1.28, 1.34, 0.0], [6.25, 0.9, 0.92, -0.08], [6.55, 0.42, 0.42, -0.12], [6.68, 0.04, 0.04, -0.14]], { seg: 22, cuts, angles: [...cockpit, PI + 0.305, TAU - 0.305] });
  K.windows(fus, [3.6, 2.8, 2.0, 1.2, 0.4, -0.4, -1.2], 0.4, 0.26, 0.26);
  const wcuts = [9.2, ...(o.stripes ? [3.4, 3.82, 4.24, 4.66, 5.08, 5.5] : [])];
  const w = K.wing([[0, 2.15, -1.05, -0.62, 0.17], [2.5, 2.15, -1.05, -0.62, 0.17], [9.8, 0.4, -0.85, 0.12, 0.1]], { n: 9, round: 0.6, cuts: wcuts });
  K.hull([[-1.0, 0.04, 0.04, -0.58], [-0.6, 0.34, 0.4, -0.56], [0.3, 0.8, 0.96, -0.5], [1.4, 1.1, 1.3, -0.46], [2.7, 1.26, 1.38, -0.42], [3.6, 1.36, 1.38, -0.4]], { seg: 16, z: 2.5, mirror: true, tag: 'nac', angles: [PI + 0.305, TAU - 0.305] });
  K.radial({ x: 3.55, y: -0.4, z: 2.5, r: 0.69, len: 0.72, mirror: true, ring: o.ring ?? null });
  K.wing([[0, -4.8, -6.35, 0.62, 0.1], [3.1, -5.35, -6.2, 0.62, 0.09]], { tag: 'tail', nk: 4, n: 4, round: 0.9 });
  const fin = K.fin([[0, -3.3, -6.62, 0, 0.1], [0.25, -4.6, -6.64, 0, 0.1], [0.6, -5.2, -6.62, 0, 0.1], [1.75, -5.95, -6.5, 0, 0.09]], { y: 0.95, nk: 4, n: 5, round: 0.45, cuts: [1.45], smooth: true });
  for (const z of [2.5, -2.5]) K.prop(4.4, -0.4, z, 1.25, 3);
  o.marks(fus, w, fin);
  return { span: 19.6, len: 13.3, tail: -6.6, nose: 6.68 };
}

// C-47 Skytrain: olive drab over grey, invasion stripes on the outer wings and round the rear fuselage.
function c47(K) {
  const base = livery(solid(OD), NEUTRAL, -0.3), band = (k) => C(k % 2 ? BLACK : WHITE);
  return dc3(K, {
    stripes: true,
    paint: (p, n, i) => {
      if (i.tag === 'wing' && Math.abs(p.z) > 3.4 && Math.abs(p.z) < 5.5) return band(Math.floor((Math.abs(p.z) - 3.4) / 0.42));
      if (i.tag === 'fus' && p.x > -4.1 && p.x < -2.0) return band(Math.floor((p.x + 4.1) / 0.42));
      return base(p, n, i);
    },
    marks(fus, w) {
      K.mark('us', 0.46, { hull: fus, x: -3.05, y: 0.32 });
      K.mark('us', 0.62, { wing: w, x: 0.05, z: -7.4 });
    },
  });
}

// ---------------------------------------------------------------- Germany

// Bf 109 G: slim nose with a yellow band and chin, black spinner, framed Erla canopy, rounded tips, grey mottle.
function bf109(K) {
  const top = splinter(RLM74, RLM75, 1.2), side = mottle(RLM76, 0x5f6862, 0.8), base = livery((p, n, i) => (i.tag === 'fin' || (i.t !== undefined && Math.sin(i.t) < 0.35) ? side(p) : top(p)), RLM76, -0.25), yellow = C(YELLOW);
  K.paint = owned(K, (p, n, i) => {
    if ((i.tag === 'fus' && (p.x > 2.85 || (p.x > 2.0 && Math.sin(i.t) < -0.45))) || i.tag === 'chin') return yellow.clone();
    return base(p, n, i);
  }, 3.6, 0.72);
  const fus = K.hull([[-3.62, 0.04, 0.1, 0.36], [-3.3, 0.2, 0.42, 0.33], [-2.6, 0.36, 0.66, 0.25], [-1.6, 0.56, 0.9, 0.15], [-0.6, 0.72, 1.04, 0.08], [0.4, 0.82, 1.1, 0.04], [1.3, 0.84, 1.08, 0.0], [2.2, 0.82, 1.0, -0.04], [2.8, 0.76, 0.86, -0.02], [3.2, 0.68, 0.72, 0.0], [3.27, 0.66, 0.68, 0.0]], { seg: 18, sub: 2, cuts: [2.0, 2.85], angles: [0.357, PI - 0.357, PI + 0.467, TAU - 0.467] });
  K.canopy(fus, [[1.45, 0.3, 0.04], [1.3, 0.48, 0.28], [1.0, 0.52, 0.35], [0.5, 0.52, 0.36], [0.25, 0.46, 0.3], [0.05, 0.3, 0.1], [-0.1, 0.06, 0.0]], { p: 3.2, frames: [1.22, 0.85, 0.5, 0.28], bars: [0.95, PI - 0.95], seg: 12 });
  const w = K.wing([[0, 1.3, -0.55, -0.34, 0.15], [4.1, 0.75, -0.2, 0.12, 0.1]], { n: 7, round: 0.75, cuts: [3.6] });
  for (const s of [1, -1]) K.hull([[-0.75, 0.3, 0.06, -0.44, 3], [-0.5, 0.5, 0.16, -0.46, 3], [0.05, 0.5, 0.18, -0.48, 3], [0.25, 0.04, 0.04, -0.5, 3]], { seg: 10, z: 1.4 * s, tag: 'pod', shadow: false });
  K.hull([[1.9, 0.1, 0.06, -0.46], [2.3, 0.36, 0.26, -0.47], [2.9, 0.34, 0.24, -0.42]], { seg: 10, tag: 'chin', capColor: [null, DARK], shadow: false });
  K.hull([[1.7, 0.02, 0.02, 0.0], [1.95, 0.16, 0.16, 0.0], [2.4, 0.18, 0.18, 0.0]], { seg: 8, z: -0.42, tag: 'pod', capColor: [null, DARK], shadow: false });
  K.wing([[0, -2.65, -3.45, 0.42, 0.1], [1.55, -2.95, -3.4, 0.42, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.5 });
  const fin = K.fin([[0, -2.55, -3.62, 0, 0.1], [0.35, -2.85, -3.64, 0, 0.1], [0.95, -3.15, -3.62, 0, 0.09]], { y: 0.45, nk: 4, n: 4, round: 0.4, cuts: [0.72], smooth: true });
  K.stubs(fus, 1.95, 2.8, 0.14, 6);
  K.spin(3.25, 0.55, 0.34, 0x252a24);
  K.prop(3.33, 0, 0, 1.25, 3);
  for (const z of [2.6, -2.6]) K.mark('cross', 0.42, { wing: w, x: 0.4, z });
  K.mark('cross', 0.32, { hull: fus, x: -1.55, y: 0.14 });
  return { span: 8.2, len: 7.45, tail: -3.62, nose: 3.8 };
}

// Ju 87 Stuka: inverted gull wing, spatted wheels, long framed canopy with a rear gun, square tail, big chin
// radiator, a bomb on the centreline (belly: aircraft.js adds no second one), splinter camouflage.
function ju87(K) {
  K.paint = owned(K, livery(splinter(RLM70, RLM71, 1.6), RLM65, -0.25), 5.2, 1.22);
  const fus = K.hull([[-4.45, 0.04, 0.14, 0.42], [-4.0, 0.22, 0.52, 0.38], [-3.0, 0.44, 0.82, 0.28], [-1.8, 0.66, 1.06, 0.18], [-0.6, 0.86, 1.22, 0.1], [0.6, 0.94, 1.3, 0.06], [1.8, 0.94, 1.3, 0.02], [2.9, 0.88, 1.18, 0.0], [3.7, 0.78, 0.98, 0.02], [4.2, 0.66, 0.72, 0.06]], { seg: 18, angles: [PI + 0.253, TAU - 0.253] });
  K.canopy(fus, [[2.05, 0.3, 0.04], [1.9, 0.6, 0.3], [1.6, 0.68, 0.42], [0.6, 0.7, 0.44], [-0.4, 0.66, 0.42], [-0.75, 0.5, 0.32], [-0.95, 0.2, 0.08], [-1.1, 0.04, 0.0]], { p: 2.8, frames: [1.75, 1.2, 0.6, 0.0, -0.55], bars: [0.85, PI - 0.85], seg: 10 });
  const top = fus.top(-0.8);
  K.rod([-0.8, top + 0.25, 0], [-1.6, top + 0.42, 0], 0.035, DARK);
  K.hull([[2.6, 0.2, 0.16, -0.62], [3.0, 0.7, 0.58, -0.64], [3.7, 0.72, 0.6, -0.52], [4.05, 0.64, 0.5, -0.44]], { seg: 12, tag: 'pod', capColor: [null, DARK], shadow: false });
  const w = K.wing([[0, 1.55, -0.65, -0.22, 0.16], [1.95, 1.5, -0.6, -0.62, 0.15], [5.7, 0.95, -0.25, 0.12, 0.1]], { n: 8, round: 0.45, cuts: [5.2] });
  // spatted main gear at the bend: a streamlined leg and a teardrop wheel pant
  K.fin([[0, 1.25, -0.05, 0, 0.36], [0.75, 1.05, 0.15, 0, 0.36]], { y: -1.2, z: 1.95, mirror: true, nk: 4, n: 2, round: 0.05, tag: 'leg' });
  K.hull([[-0.35, 0.04, 0.3, -1.68], [-0.1, 0.32, 0.92, -1.56], [0.35, 0.46, 1.22, -1.46], [0.85, 0.46, 1.16, -1.42], [1.25, 0.34, 0.82, -1.36], [1.5, 0.04, 0.24, -1.24]], { seg: 10, z: 1.95, mirror: true, tag: 'pod' });
  K.wheel(0.55, -1.92, 1.95, 0.3, 0.14, true, 8);
  // dive brakes under the outer wings
  for (const s of [1, -1]) {
    const y = w.surf(1.0, 3.5, -1) - 0.14;
    K.box(1.0, y, s * 3.5, 0.14, 0.03, 1.9, DARK, 0, 0, -s * 0.2);
  }
  K.add(bomb(1.7, 0.24, { segments: 10 }), xf(0.15, -0.95, 0), 0x3b4130);
  for (const x of [0.6, 1.4]) K.rod([x, -0.7, 0], [x, -0.86, 0], 0.04, DARK);
  K.wing([[0, -3.25, -4.35, 0.38, 0.1], [2.1, -3.4, -4.3, 0.38, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.25 });
  for (const s of [1, -1]) K.rod([-3.75, 0.32, s * 1.1], [-3.55, 0.05, s * 0.32], 0.03, DARK);
  K.fin([[0, -2.95, -4.45, 0, 0.1], [0.3, -3.4, -4.47, 0, 0.1], [1.5, -3.75, -4.44, 0, 0.09]], { y: 0.55, nk: 4, n: 4, round: 0.25, cuts: [1.22], smooth: true });
  K.stubs(fus, 2.95, 3.75, 0.16, 5);
  K.spin(4.2, 0.6, 0.33, 0x232622, 0.06);
  K.prop(4.28, 0.06, 0, 1.45, 3);
  for (const z of [3.6, -3.6]) K.mark('cross', 0.46, { wing: w, x: 0.55, z });
  K.mark('cross', 0.38, { hull: fus, x: -2.1, y: 0.18 });
  return { span: 11.4, len: 9.2, tail: -4.45, nose: 4.8, belly: true };
}

// He 111 H: fully glazed round nose with no step, elliptical wing, inline engines with black spinners, ventral
// gondola, dorsal gun position, single rounded fin, splinter camouflage.
function he111(K) {
  const base = livery(splinter(RLM70, RLM71, 2.2), RLM65, -0.3), frameX = [5.2, 5.58, 5.95, 6.25], bars = [0.6, 1.2, PI - 1.2, PI - 0.6, PI + 0.5, TAU - 0.5], dark = C(RLM70);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && p.x > 4.85) return frameX.some((x) => Math.abs(p.x - x) < 0.03) || bars.some((a) => Math.abs(i.t - a) < 0.04) ? dark.clone() : glass(n);
    if (i.tag === 'gondola' && p.x < 1.3) return glass(n);
    return base(p, n, { ...i, tag: i.tag === 'gondola' ? 'pod' : i.tag });
  }, 8.4, 1.55);
  const keys = [[-6.45, 0.04, 0.08, 0.32], [-6.0, 0.26, 0.4, 0.3], [-4.6, 0.62, 0.86, 0.22], [-2.6, 1.0, 1.28, 0.14], [-0.4, 1.3, 1.6, 0.08], [1.8, 1.44, 1.72, 0.04], [3.6, 1.46, 1.72, 0.02], [4.8, 1.4, 1.6, 0.02], [5.6, 1.18, 1.32, 0.02], [6.15, 0.82, 0.9, 0.02], [6.45, 0.4, 0.42, 0.02], [6.58, 0.04, 0.04, 0.02]];
  const fus = K.hull(keys, { seg: 20, range: [-6.45, 4.85], angles: [PI + 0.305, TAU - 0.305] });
  K.hull(keys, { seg: 20, range: [4.85, 6.58], cuts: frameX.flatMap((x) => [x - 0.03, x + 0.03]), angles: bars.flatMap((a) => [a - 0.04, a + 0.04]), shadow: false });
  K.hull([[0.55, 0.06, 0.06, -0.72], [0.9, 0.5, 0.42, -0.8], [1.6, 0.6, 0.52, -0.84], [2.9, 0.5, 0.4, -0.8], [3.2, 0.04, 0.04, -0.78]], { seg: 12, tag: 'gondola', cuts: [1.3], shadow: false });
  K.canopy(fus, [[0.4, 0.2, 0.0], [0.2, 0.5, 0.2], [-0.3, 0.56, 0.3], [-0.75, 0.4, 0.2], [-1.0, 0.06, 0.0]], { p: 2.2, frames: [-0.05, -0.5], seg: 10, sink: 0.15 });
  K.rod([-0.6, fus.top(-0.6) + 0.22, 0], [-1.5, fus.top(-0.6) + 0.36, 0], 0.035, DARK);
  K.rod([6.5, 0.02, 0], [7.0, 0.0, 0], 0.035, DARK);
  K.windows(fus, [1.7, 1.0], 0.3, 0.22, 0.2);
  const w = K.wing([[0, 2.7, -1.35, -0.25, 0.17], [3.0, 2.6, -1.25, 0.0, 0.16], [9.0, 1.65, -0.55, 0.55, 0.1]], { n: 9, round: 1.5, cuts: [8.4] });
  K.hull([[-1.8, 0.04, 0.06, -0.18], [-1.1, 0.46, 0.58, -0.2], [0.4, 0.9, 1.06, -0.22], [2.4, 1.1, 1.26, -0.2], [4.0, 1.16, 1.26, -0.18], [4.85, 1.08, 1.14, -0.16], [5.1, 0.8, 0.82, -0.16]], { seg: 16, z: 3.0, mirror: true, tag: 'nac', angles: [PI + 0.305, TAU - 0.305], capColor: [null, DARK] });
  for (const z of [3.0, -3.0]) { K.spin(5.05, 0.62, 0.37, 0x232622, -0.16, z); K.prop(5.2, -0.16, z, 1.5, 3); }
  K.wing([[0, -4.85, -6.35, 0.3, 0.1], [3.4, -5.35, -6.05, 0.3, 0.09]], { tag: 'tail', nk: 4, n: 4, round: 1.2 });
  K.fin([[0, -4.7, -6.5, 0, 0.1], [0.4, -5.2, -6.52, 0, 0.1], [1.9, -5.75, -6.4, 0, 0.09]], { y: 0.55, nk: 4, n: 5, round: 0.9, cuts: [1.55], smooth: true });
  for (const z of [6.0, -6.0]) K.mark('cross', 0.6, { wing: w, x: 1.25, z });
  K.mark('cross', 0.46, { hull: fus, x: -2.7, y: 0.16 });
  return { span: 18.0, len: 13.0, tail: -6.45, nose: 6.58 };
}

// Ju 52/3m: three radial engines with yellow cowl rings, boxy corrugated fuselage with a row of windows, thick
// corrugated wing with the Junkers flap strip, fixed gear on struts, splinter camouflage.
function ju52(K) {
  const base = livery(splinter(RLM70, RLM71, 2.4), RLM65, -0.45);
  // corrugation: alternate light and dark lines (along the body, and across the span on the wings)
  K.paint = owned(K, (p, n, i) => {
    const c = base(p, n, i);
    if (i.tag === 'fus') return c.multiplyScalar(Math.cos(16 * i.t) > 0 ? 1.14 : 0.85);
    if ((i.tag === 'wing' || i.tag === 'tail' || i.tag === 'fin') && i.row !== undefined) return c.multiplyScalar(i.row % 2 ? 1.14 : 0.85);
    return c;
  }, 9.1, 1.45);
  const fus = K.hull([[-6.3, 0.12, 0.22, 0.62, 2.5], [-5.4, 0.42, 0.66, 0.5, 3], [-3.6, 0.88, 1.18, 0.32, 3.4], [-1.4, 1.22, 1.6, 0.18, 3.6], [1.0, 1.3, 1.72, 0.14, 3.6], [3.6, 1.3, 1.72, 0.14, 3.6], [4.6, 1.24, 1.6, 0.1, 3.4], [5.3, 1.04, 1.18, -0.02, 3], [5.7, 0.9, 0.9, -0.06, 2.4]], { seg: 32, ridges: 0.014, folds: 16, crease: 12 });
  // cockpit glazing: a framed glass band round the nose top
  K.canopy(fus,[[5.35, 0.7, -0.08], [5.15, 0.98, 0.04], [4.85, 1.12, 0.1], [4.5, 1.16, 0.08], [4.35, 1.1, -0.06]], { p: 3, frames: [4.95], bars: [PI / 2, 0.75, PI - 0.75], seg: 12, sink: 0.35 });
  K.windows(fus, [3.4, 2.8, 2.2, 1.6, 1.0, 0.4, -0.2, -0.8], 0.45, 0.3, 0.28);
  K.radial({ x: 5.55, y: -0.06, r: 0.5, len: 0.6, ring: YELLOW });
  const w = K.wing([[0, 2.1, -1.45, -0.72, 0.17], [3.3, 1.64, -1.11, -0.64, 0.15], [9.7, 0.75, -0.45, 0.2, 0.1]], { n: 18, nk: 6, round: 0.3, cuts: [9.1], ridges: 0.08, crease: 15 });
  // the Junkers double wing: a separate flap and aileron strip behind the trailing edge
  const te = (z) => w.plan(z).te, wy = (z) => w.plan(z).y;
  K.wing([[0.9, te(0.9) - 0.1, te(0.9) - 0.6, wy(0.9) - 0.06, 0.08], [9.2, te(9.2) - 0.08, te(9.2) - 0.45, wy(9.2) - 0.04, 0.08]], { tag: 'wing', nk: 3, n: 4, round: 0.1, shadow: false, cuts: [9.1] });
  K.hull([[1.2, 0.04, 0.04, -0.6], [1.8, 0.6, 0.66, -0.62], [3.0, 0.9, 0.92, -0.62], [3.55, 0.94, 0.94, -0.62]], { seg: 14, z: 3.3, mirror: true, tag: 'nac', angles: [PI + 0.466, TAU - 0.466] });
  K.radial({ x: 3.5, y: -0.62, z: 3.3, r: 0.5, len: 0.55, ring: YELLOW, mirror: true });
  // fixed main gear: wheels on a V of struts under the outer engines
  K.wheel(1.9, -1.95, 2.6, 0.42, 0.22);
  for (const s of [1, -1]) {
    const hub = [1.9, -1.95, s * 2.6];
    K.rod(hub, [2.4, w.surf(2.4, 2.9, -1), s * 2.9], 0.05, DARK);
    K.rod(hub, [1.2, w.surf(1.2, 2.9, -1), s * 2.9], 0.05, DARK);
    K.rod(hub, [1.9, fus.bottom(1.9) + 0.1, s * 0.5], 0.045, DARK);
  }
  K.wing([[0, -4.9, -6.2, 0.55, 0.1], [3.0, -5.15, -6.1, 0.55, 0.09]], { tag: 'tail', nk: 4, n: 6, round: 0.2, ridges: 0.08, crease: 15 });
  for (const s of [1, -1]) K.rod([-5.4, 0.5, s * 1.6], [-5.2, 0.05, s * 0.45], 0.03, DARK);
  const fin = K.fin([[0, -4.6, -6.3, 0, 0.1], [0.3, -5.05, -6.32, 0, 0.1], [1.75, -5.55, -6.28, 0, 0.09]], { y: 0.75, nk: 4, n: 5, round: 0.4, cuts: [1.45], ridges: 0.08, crease: 15 });
  K.prop(6.25, -0.06, 0, 1.25, 3);
  for (const z of [3.3, -3.3]) K.prop(4.15, -0.62, z, 1.25, 3);
  for (const z of [6.6, -6.6]) K.mark('cross', 0.6, { wing: w, x: 0.2, z });
  K.mark('cross', 0.46, { hull: fus, x: -1.9, y: 0.2 });
  K.mark('cross', 0.3, { fin, x: -5.7, h: 0.85 });
  return { span: 19.4, len: 12.6, tail: -6.3, nose: 6.3 };
}

// ---------------------------------------------------------------- USSR

// Yak-9: green and black camouflage over light blue, red spinner, teardrop canopy, belly radiator, rounded tips.
function yak9(K) {
  K.paint = owned(K, livery(waves(VVS_GREEN, VVS_BLACK, 0.45), VVS_BLUE, -0.2), 3.8, 0.78);
  const fus = K.hull([[-3.72, 0.04, 0.1, 0.38], [-3.35, 0.2, 0.44, 0.34], [-2.6, 0.38, 0.7, 0.26], [-1.6, 0.58, 0.95, 0.16], [-0.5, 0.78, 1.1, 0.1], [0.6, 0.88, 1.16, 0.06], [1.6, 0.88, 1.12, 0.04], [2.5, 0.8, 0.96, 0.02], [3.15, 0.66, 0.68, 0.02]], { seg: 18, sub: 2, angles: [PI + 0.201, TAU - 0.201] });
  K.canopy(fus, [[1.55, 0.2, 0.02], [1.38, 0.46, 0.26], [1.05, 0.54, 0.38], [0.6, 0.56, 0.42], [0.15, 0.5, 0.38], [-0.3, 0.38, 0.26], [-0.9, 0.14, 0.08], [-1.2, 0.03, 0.0]], { p: 2.2, frames: [1.2, 0.35, -0.2], seg: 12 });
  const w = K.wing([[0, 1.3, -0.75, -0.32, 0.15], [4.3, 0.6, -0.3, 0.14, 0.1]], { n: 7, round: 0.65, cuts: [3.8] });
  K.hull([[-1.75, 0.08, 0.04, -0.42], [-1.5, 0.3, 0.16, -0.46], [-0.8, 0.5, 0.36, -0.52], [0.05, 0.46, 0.3, -0.5], [0.3, 0.1, 0.06, -0.48]], { seg: 12, tag: 'pod', capColor: [DARK, null] });
  K.wing([[0, -2.8, -3.6, 0.28, 0.1], [1.65, -3.05, -3.5, 0.28, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.55 });
  const fin = K.fin([[0, -2.6, -3.72, 0, 0.1], [0.3, -2.95, -3.74, 0, 0.1], [1.0, -3.3, -3.7, 0, 0.09]], { y: 0.48, nk: 4, n: 4, round: 0.55, cuts: [0.78], smooth: true });
  K.stubs(fus, 2.0, 2.9, 0.16, 6);
  K.spin(3.12, 0.7, 0.33, 0xb5332a, 0.02);
  K.prop(3.2, 0.02, 0, 1.3, 3);
  for (const z of [2.7, -2.7]) K.mark('star', 0.42, { wing: w, x: 0.45, z });
  K.mark('star', 0.3, { hull: fus, x: -1.75, y: 0.16 });
  K.mark('star', 0.24, { fin, x: -3.25, h: 0.5 });
  return { span: 8.6, len: 7.5, tail: -3.72, nose: 3.82 };
}

// Il-2 Sturmovik: armoured nose, long two-seat canopy with a rear gunner, gear pods under the wing, rockets.
function il2(K) {
  K.paint = owned(K, livery(waves(VVS_GREEN, VVS_BLACK, 0.55), VVS_BLUE, -0.3), 5.3, 0.95);
  const fus = K.hull([[-4.55, 0.04, 0.14, 0.4, 2], [-4.1, 0.22, 0.5, 0.36, 2], [-3.0, 0.46, 0.8, 0.26, 2], [-1.6, 0.7, 1.04, 0.16, 2], [-0.3, 0.92, 1.22, 0.1, 2.2], [0.9, 1.0, 1.3, 0.06, 2.6], [2.0, 1.0, 1.26, 0.02, 2.8], [3.0, 0.92, 1.08, 0.0, 2.8], [3.75, 0.8, 0.88, 0.02, 2.6], [4.2, 0.64, 0.66, 0.04, 2.2]], { seg: 18, angles: [PI + 0.305, TAU - 0.305] });
  K.canopy(fus, [[2.2, 0.3, 0.04], [2.05, 0.62, 0.32], [1.7, 0.7, 0.45], [0.9, 0.7, 0.46], [0.2, 0.66, 0.44], [-0.35, 0.5, 0.34], [-0.6, 0.22, 0.1], [-0.75, 0.04, 0.0]], { p: 2.8, frames: [1.95, 1.5, 1.05, 0.6, 0.15, -0.25], bars: [0.9, PI - 0.9], seg: 12 });
  const top = fus.top(-0.3);
  K.rod([-0.3, top + 0.3, 0], [-1.25, top + 0.44, 0], 0.04, DARK);
  K.rod([-0.9, top - 0.05, 0], [-1.0, top + 0.55, 0], 0.025, DARK);
  const w = K.wing([[0, 1.5, -0.6, -0.36, 0.16], [1.75, 1.5, -0.6, -0.36, 0.16], [5.8, 0.65, -0.45, 0.22, 0.1]], { n: 7, round: 0.6, cuts: [5.3] });
  K.hull([[-0.95, 0.03, 0.03, -0.48], [-0.7, 0.16, 0.16, -0.52], [0.0, 0.4, 0.44, -0.62], [0.9, 0.44, 0.5, -0.66], [1.7, 0.36, 0.4, -0.64], [1.95, 0.04, 0.04, -0.62]], { seg: 12, z: 1.75, mirror: true, tag: 'pod' });
  // RS-82 rockets under the outer wings, red noses
  for (const s of [1, -1]) for (const rz of [2.45, 2.85, 3.25, 3.65]) {
    const ry = w.surf(0.4, rz, -1) - 0.11;
    K.rod([-0.1, ry, s * rz], [1.3, ry, s * rz], 0.085, 0x8a8e86, 6);
    K.add(lathe([[0.085, 0], [0.06, 0.18], [0, 0.34]], 6, { axis: 'x' }), xf(1.3, ry, s * rz), RED);
  }
  K.wing([[0, -3.55, -4.45, 0.3, 0.1], [2.2, -3.85, -4.35, 0.3, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.7 });
  const fin = K.fin([[0, -3.2, -4.55, 0, 0.1], [0.3, -3.6, -4.56, 0, 0.1], [1.2, -4.0, -4.5, 0, 0.09]], { y: 0.5, nk: 4, n: 4, round: 0.55, cuts: [0.95], smooth: true });
  K.stubs(fus, 2.6, 3.55, 0.16, 6);
  K.spin(4.18, 0.72, 0.31, VVS_GREEN, 0.04);
  K.prop(4.26, 0.04, 0, 1.48, 3);
  for (const z of [3.8, -3.8]) K.mark('star', 0.46, { wing: w, x: 0.55, z });
  K.mark('star', 0.34, { hull: fus, x: -2.0, y: 0.18 });
  K.mark('star', 0.3, { fin, x: -4.0, h: 0.5 });
  return { span: 11.6, len: 9.4, tail: -4.55, nose: 4.9 };
}

// Pe-2: slim fuselage, glazed nose, long canopy, nacelles with pointed spinners, twin oval fins on a dihedral tailplane.
function pe2(K) {
  const base = livery(waves(VVS_GREEN, VVS_BLACK, 1.4), VVS_BLUE, -0.25), frameX = [4.65, 4.95, 5.15], bars = [PI / 4, PI / 2, 3 * PI / 4], green = C(VVS_GREEN);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && p.x > 4.35 && Math.sin(i.t) > -0.25) return frameX.some((x) => Math.abs(p.x - x) < 0.025) || bars.some((a) => Math.abs(i.t - a) < 0.04) ? green.clone() : glass(n);
    if (i.tag === 'fin' && i.z > 0.9) return K.own.clone();
    return base(p, n, i);
  }, 6.6, 9);
  const keys = [[-5.25, 0.04, 0.1, 0.34], [-4.6, 0.3, 0.44, 0.3], [-3.2, 0.6, 0.78, 0.2], [-1.2, 0.9, 1.08, 0.1], [1.0, 1.06, 1.22, 0.06], [2.8, 1.08, 1.24, 0.04], [3.9, 1.0, 1.1, 0.0], [4.7, 0.78, 0.82, -0.04], [5.15, 0.44, 0.46, -0.06], [5.35, 0.04, 0.04, -0.06]];
  const under = [PI + 0.253, TAU - 0.253];
  const fus = K.hull(keys, { seg: 18, range: [-5.25, 4.35], angles: under });
  K.hull(keys, { seg: 18, range: [4.35, 5.35], cuts: frameX.flatMap((x) => [x - 0.025, x + 0.025]), angles: [...under, ...bars.flatMap((a) => [a - 0.04, a + 0.04])], shadow: false });
  K.canopy(fus, [[4.0, 0.4, 0.02], [3.8, 0.8, 0.3], [3.4, 0.86, 0.44], [2.4, 0.86, 0.46], [1.6, 0.76, 0.4], [1.2, 0.4, 0.14], [1.0, 0.06, 0.0]], { p: 2.6, frames: [3.55, 3.1, 2.6, 2.1, 1.6], bars: [0.95, PI - 0.95], seg: 12 });
  const w = K.wing([[0, 2.15, -0.9, -0.28, 0.16], [2.4, 2.0, -0.85, -0.12, 0.15], [7.2, 0.95, -0.15, 0.32, 0.1]], { n: 8, round: 0.8, cuts: [6.6] });
  K.hull([[-1.8, 0.04, 0.06, -0.1], [-0.9, 0.52, 0.62, -0.16], [0.6, 0.8, 0.94, -0.2], [2.4, 0.88, 1.0, -0.18], [3.7, 0.8, 0.84, -0.14], [4.1, 0.62, 0.62, -0.12]], { seg: 16, z: 2.4, mirror: true, tag: 'nac', angles: under });
  for (const z of [2.4, -2.4]) { K.spin(4.07, 0.6, 0.3, VVS_GREEN, -0.12, z); K.prop(4.17, -0.12, z, 1.35, 3); }
  K.wing([[0, -3.9, -5.2, 0.32, 0.1], [2.75, -4.0, -5.15, 0.7, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.12 });
  const fin = K.fin([[-0.65, -4.0, -5.25, 0, 0.1], [1.2, -4.0, -5.25, 0, 0.1]], { y: 0.7, z: 2.78, mirror: true, nk: 4, n: 4, round: [0.6, 0.85], cuts: [0.9] });
  for (const z of [4.9, -4.9]) K.mark('star', 0.52, { wing: w, x: 0.7, z });
  K.mark('star', 0.34, { hull: fus, x: -2.3, y: 0.18 });
  K.mark('star', 0.3, { fin, x: -4.62, h: 0.3, sides: [-1] });
  return { span: 14.4, len: 10.6, tail: -5.25, nose: 5.35 };
}

// Li-2: the Soviet DC-3, green over light blue, red stars.
function li2(K) {
  return dc3(K, {
    paint: livery(solid(0x58664c), VVS_BLUE, -0.2),
    marks(fus, w, fin) {
      K.mark('star', 0.48, { hull: fus, x: -3.0, y: 0.32 });
      for (const z of [7.4, -7.4]) K.mark('star', 0.6, { wing: w, x: 0.1, z });
      K.mark('star', 0.4, { fin, x: -5.9, h: 0.75 });
    },
  });
}

// ---------------------------------------------------------------- the module

const BUILD = [
  { fighter: p51, attacker: p47, bomber: b25, transport: c47 },
  { fighter: bf109, attacker: ju87, bomber: he111, transport: ju52 },
  { fighter: yak9, attacker: il2, bomber: pe2, transport: li2 },
];
export const PLANE_NAMES = [
  { fighter: 'P-51D Mustang', attacker: 'P-47D Thunderbolt', bomber: 'B-25J Mitchell', transport: 'C-47 Skytrain' },
  { fighter: 'Bf 109 G', attacker: 'Ju 87 Stuka', bomber: 'He 111 H', transport: 'Ju 52/3m' },
  { fighter: 'Yak-9', attacker: 'Il-2 Sturmovik', bomber: 'Pe-2', transport: 'Li-2' },
];
export const ROLES = ['fighter', 'attacker', 'bomber', 'transport'];

// One plane for a faction (0 USA, 1 Germany, 2 USSR), a role (fighter, attacker, bomber, transport) and the owner's
// colour: { geo, props: [{x, y, z, r, n}], polys: shadow outlines [[x, z], ...], span, len, tail, nose, belly }.
export function plane(fac, role, own = 0xffffff) {
  const set = BUILD[fac] ?? BUILD[0], make = set[role] ?? set.fighter, K = kit(own), spec = make(K);
  const g = merge(K.parts), box = new THREE.Box3().setFromBufferAttribute(g.attributes.position), y0 = box.min.y, H = Math.max(0.5, box.max.y - y0);
  // the painted-miniature shading: darker toward the belly and on faces that look down
  const geo = ao(g, { falloff: (p, n) => (0.74 + 0.26 * sstep(0, 0.6 * H, p.y - y0)) * (1 - 0.16 * Math.max(0, -n.y)) });
  geo.computeBoundingSphere();
  return { geo, props: K.props, polys: K.polys, belly: false, ...spec };
}
