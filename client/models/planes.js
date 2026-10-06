// The sixteen aircraft, four roles for each faction: a fighter, a ground-attack plane, a twin-engine bomber and a
// transport. plane(fac, role, own) builds one as a single vertex-coloured geometry plus what client/aircraft.js needs
// to fly it: the propellers, the outline for the ground shadow and a few sizes.
//
// How a plane is built: fuselages and nacelles are lofted from cross-sections (superellipses, so a body can be round,
// oval or slab-sided), wings and tails are swept airfoil sections with taper, dihedral or a gull bend and rounded or
// square tips, and the paint is worked out per vertex while the mesh is built. A paint edge that must be crisp (a
// canopy frame, a nose band, an invasion stripe, the owner's band) gets a doubled row of vertices exactly on the
// edge, one row painted for each side. Camouflage, panel lines and the hinge lines of ailerons, flaps, elevators and
// rudders are finer than the vertices, so they are drawn per pixel: a vertex carries a second colour (as a ratio to
// its own) and a pattern code in the `camo` attribute, the chord position and hinge line in `hinge`, and
// paintMaterial() adds the patterns to the material's shader. The markings are flat decals cut finer where they bend
// and laid onto the surface they sit on. Every vertex also says what it is made of (the 'matId' attribute, see
// client/models/geom.js MATS): aircraft paint or aluminium by default, glass and markings plain, exhausts and guns
// gunmetal, tyres rubber, so the model textures add the wear and the weathering. The colours are the real paints,
// a little lighter than chips of them so they read under the game's sun.
// Axes: +x forward, +y up, +z toward the right wing. Fighters and attackers are about 80% of the real size, bombers
// a little less and transports about two thirds, so a transport is not a house.
// Only 'three' and geom.js are imported, so the browser and the Node tests load this file the same way.
import * as THREE from 'three';
import { xf, crease, merge, spinner, bomb, tube, lathe, star, balkenkreuz, roundel, place, ao, matId, PLAIN, UNSET } from './geom.js';

const PI = Math.PI, TAU = PI * 2;
const WHITE = 0xd9d5c9, BLACK = 0x1f1e1b, BLUE = 0x27396a, RED = 0xa8342a, YELLOW = 0xc99a2e, DARK = 0x2a2824;
const GLASS = 0x2b3336, SKY = 0x9eaab0, STEEL = 0x55544e, EXHAUST = 0x2b2825;
const C = (h) => new THREE.Color(h);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PORT = new THREE.PlaneGeometry(1, 1);
const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
const NOCAMO = [1, 1, 1, 0], NOHINGE = [0, 0, 0];

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

// Indexed geometry from flat arrays, normals by crease angle. Per vertex, ex may carry cam (4 numbers for the camo
// attribute; none: plain paint), mat (the material id; none: UNSET, the material's default) and hinge (3 numbers;
// none: no hinge line). geom.js crease() only carries colours, so it is handed each vertex's number as its colour
// and the real colour and the rest are looked up again afterwards.
function sheet(pos, col, idx, angle, ex = {}) {
  const { cam = null, mat = null, hinge = null } = ex;
  const n = pos.length / 3, id = new Float32Array(n * 3), g = new THREE.BufferGeometry();
  for (let i = 0; i < n; i++) id[i * 3] = i;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(id, 3));
  g.setIndex(idx);
  const out = crease(g, angle), V = out.attributes.color, m = V.count, c = new Float32Array(m * 3), q = new Float32Array(m * 4), mt = new Float32Array(m), hg = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    const s = Math.round(V.getX(i));
    c[i * 3] = col[s * 3]; c[i * 3 + 1] = col[s * 3 + 1]; c[i * 3 + 2] = col[s * 3 + 2];
    for (let k = 0; k < 4; k++) q[i * 4 + k] = cam ? cam[s * 4 + k] : NOCAMO[k];
    mt[i] = typeof mat === 'number' ? mat : mat ? mat[s] : UNSET;
    for (let k = 0; k < 3; k++) hg[i * 3 + k] = hinge ? hinge[s * 3 + k] : 0;
  }
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.setAttribute('camo', new THREE.BufferAttribute(q, 4));
  out.setAttribute('matId', new THREE.BufferAttribute(mt, 1));
  out.setAttribute('hinge', new THREE.BufferAttribute(hg, 3));
  return out;
}
// geom.js merge() (which keeps matId and fills in each item's mat), keeping the camo and hinge attributes too (parts
// without them get plain paint and no hinge line)
function join(items) {
  const g = merge(items), N = g.attributes.position.count, q = new Float32Array(N * 4), h = new Float32Array(N * 3);
  let o = 0;
  for (const it of items) {
    const geo = it.isBufferGeometry ? it : it.geo, n = geo.attributes.position.count, a = geo.attributes.camo, b = geo.attributes.hinge;
    for (let i = 0; i < n; i++, o++) {
      if (a) { q[o * 4] = a.getX(i); q[o * 4 + 1] = a.getY(i); q[o * 4 + 2] = a.getZ(i); q[o * 4 + 3] = a.getW(i); } else q.set(NOCAMO, o * 4);
      if (b) { h[o * 3] = b.getX(i); h[o * 3 + 1] = b.getY(i); h[o * 3 + 2] = b.getZ(i); }
    }
  }
  g.setAttribute('camo', new THREE.BufferAttribute(q, 4));
  g.setAttribute('hinge', new THREE.BufferAttribute(h, 3));
  return g;
}
const twin = (geo) => join([{ geo }, { geo, m: MIRROR }]);
const camoOf = (c) => c.camo ?? NOCAMO;
const matOf = (c) => (c.mat ? matId(c.mat) : UNSET);

// ---------------------------------------------------------------- bodies

// A fuselage, nacelle, canopy or pod lofted along +x. keys: [x, w, h, y, p] cross-sections (w wide in z, h tall, centred
// at height y; p the superellipse power: 2 round, 3 or more slab-sided), joined by a smooth curve. A section of size
// 0 closes the end to a point; other ends get a flat cap. seg: points around. cuts: x positions where the paint
// changes sharply (a doubled ring); angles: the same around the body (ring angle t, 0 at +z, PI/2 on top). arc: build
// only the part of the ring between two angles (a canopy). range: build only that x span. z: sideways offset, and
// mirror adds the copy on the other side. ridges and folds: corrugation, the radius waved by folds bumps around.
// twist turns the rings by that many radians per unit of x (a spiral on a spinner). paint(p, n, {tag, t, x}) gives
// each vertex its colour.
function hull(keys, o) {
  const { seg = 16, cuts = [], angles = [], tag = 'fus', crease: ang = 40, ridges = 0, folds = 0, twist = 0, z: z0 = 0, arc = null, caps = [true, true], capColor = [null, null], range = null, mirror = false, paint } = o;
  const sub = o.sub ?? (tag === 'fus' || tag === 'canopy' || tag === 'nac' ? 3 : 2);
  const ks = [...keys].sort((a, b) => a[0] - b[0]), X = ks.map((k) => k[0]);
  const W = pchip(X, ks.map((k) => k[1])), H = pchip(X, ks.map((k) => k[2])), Y = pchip(X, ks.map((k) => k[3] ?? 0)), Pw = lin(X, ks.map((k) => k[4] ?? 2));
  const at = (x) => ({ w: Math.max(0, W(x)), h: Math.max(0, H(x)), y: Y(x), p: Pw(x) });
  const pt = (x, t) => {
    const s = at(x), e = 2 / s.p, c = Math.cos(t + twist * x), sn = Math.sin(t + twist * x), r = 1 + ridges * Math.cos(folds * t);
    return new THREE.Vector3(x, s.y + (s.h / 2) * r * Math.sign(sn) * Math.abs(sn) ** e, z0 + (s.w / 2) * r * Math.sign(c) * Math.abs(c) ** e);
  };
  const nrm = (x, t) => { const s = at(x), a = t + twist * x; return new THREE.Vector3(0, Math.sin(a) / Math.max(s.h, 1e-3), Math.cos(a) / Math.max(s.w, 1e-3)).normalize(); };
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
  const pos = [], col = [], cam = [], mat = [], idx = [], n = ts.length;
  for (const a of xs) for (const b of ts) {
    const p = pt(a.x, b.t), px = a.x + a.q * 0.002, pa = b.t + b.q * 0.004;
    pos.push(p.x, p.y, p.z);
    const c = paint(pt(px, pa), nrm(px, pa), { tag, t: pa, x: px });
    col.push(c.r, c.g, c.b); cam.push(...camoOf(c)); mat.push(matOf(c));
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
    const mid = pos.length / 3, cq = camoOf(cc), cm = matOf(cc);
    pos.push(x, s.y, z0); col.push(cc.r, cc.g, cc.b); cam.push(...cq); mat.push(cm);
    for (const b of ts) { const p = pt(x, b.t); pos.push(p.x, p.y, p.z); col.push(cc.r, cc.g, cc.b); cam.push(...cq); mat.push(cm); }
    for (let j = 0; j < n; j++) { const j1 = (j + 1) % n; if (dir > 0) idx.push(mid, mid + 1 + j1, mid + 1 + j); else idx.push(mid, mid + 1 + j, mid + 1 + j1); }
  }
  let geo = sheet(pos, col, idx, ang, { cam, mat });
  // the top-view outline for the ground shadow
  const xo = xs.filter((a) => a.q <= 0).map((a) => a.x), outline = [...xo.map((x) => [x, z0 + at(x).w / 2]), ...xo.reverse().map((x) => [x, z0 - at(x).w / 2])];
  const outlines = [outline];
  if (mirror) { geo = twin(geo); outlines.push(outline.map(([x, z]) => [x, -z])); }
  const side = (x, y) => { const s = at(x), u = Math.abs(y - s.y) / Math.max(1e-6, s.h / 2); return u >= 1 ? 0 : (s.w / 2) * (1 - u ** s.p) ** (1 / s.p); };
  return { geo, at, side, top: (x) => { const s = at(x); return s.y + s.h / 2; }, bottom: (x) => { const s = at(x); return s.y - s.h / 2; }, outlines };
}

// A wing, tailplane or fin: airfoil sections from the root out to the tip. keys: [z, le, te, y, t] (z along the span,
// x of the leading and trailing edge, height of the chord line, thickness over chord), straight between keys (smooth:
// a curve instead). round: how far in from the tip the planform rounds off (a number, or [root, tip] to round both
// ends). nk: points along each surface; n: sections between root and tip; cuts: z positions of sharp paint edges.
// m: a matrix that moves the finished piece (a fin stands it up); mirror adds the left side. pivot: the chord fraction
// a rounded end closes toward (1 keeps the leading edge straight, for a D-shaped fin). hinge: [chord fraction, z]
// draws the hinge line of the control surfaces at that fraction of the chord and, when z is set, the break between
// flap and aileron at that span (the shader draws both, see CAMO_MAIN). The leading edge can be painted a little
// lighter (edge, worn paint). paint(p, n, {tag, upper, z, s, xs}) colours each vertex.
function wing(keys, o) {
  const { nk = 9, n = 8, round = 0.3, cuts = [], tag = 'wing', m = null, camber = 0.025, lower = 0.8, ridges = 0, edge = 1.03, crease: ang = 35, smooth = false, mirror = true, pivot = 0.55, hinge = null, paint } = o;
  const [r0, r1] = Array.isArray(round) ? round : [0, Math.max(0.05, round)];
  const Z = keys.map((k) => k[0]), F = smooth ? pchip : lin;
  const LE = F(Z, keys.map((k) => k[1])), TE = F(Z, keys.map((k) => k[2])), Yc = lin(Z, keys.map((k) => k[3] ?? 0)), T = lin(Z, keys.map((k) => k[4] ?? 0.12));
  const za = Z[0], zb = Z[Z.length - 1];
  const plan = (z) => {
    let le = LE(z), te = TE(z), f = 1;
    if (r1 > 0 && z > zb - r1) { const u = Math.min(1, (z - zb + r1) / r1); f = Math.sqrt(Math.max(0, 1 - u * u)); }
    if (r0 > 0 && z < za + r0) { const u = Math.min(1, (za + r0 - z) / r0); f = Math.min(f, Math.sqrt(Math.max(0, 1 - u * u))); }
    if (f < 1) { const mid = te + (le - te) * pivot; le = mid + (le - mid) * f; te = mid + (te - mid) * f; }
    return { le, te, y: Yc(z), t: T(z) };
  };
  const b0 = za + r0, b1 = zb - r1;
  let zs = [];
  for (let k = 0; k <= n; k++) zs.push(b0 + ((b1 - b0) * k) / n);
  for (const z of Z) if (z > b0 && z < b1) zs.push(z);
  for (let k = 1; k <= 7; k++) { if (r1 > 0) zs.push(b1 + r1 * Math.sin((PI / 2) * (k / 7))); if (r0 > 0) zs.push(b0 - r0 * Math.sin((PI / 2) * (k / 7))); }
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
  const pos = [], col = [], cam = [], mat = [], hin = [], idx = [], rn = ring.length, lead = [], trail = [];
  st.forEach((s, i) => {
    const pl = plan(s.z), pp = plan(s.z + s.q * 0.002), rid = 1 + ridges * (i % 2 ? 1 : -1);
    for (const [k, side] of ring) {
      const v = point(pl, k, side, s.z, rid), probe = point(pp, k, side, s.z + s.q * 0.002, rid), nn = new THREE.Vector3(k === 0 ? 1 : 0, k === 0 ? 0 : side, 0);
      if (m) { v.applyMatrix4(m); probe.applyMatrix4(m); nn.applyMatrix3(nm).normalize(); }
      pos.push(v.x, v.y, v.z);
      const xs = (1 - Math.cos((PI * k) / nk)) / 2, c = paint(probe, nn, { tag, upper: side > 0, z: s.z + s.q * 0.002, s: (s.z - za) / (zb - za), xs, row: i });
      if (k <= 1) c.multiplyScalar(edge);
      col.push(c.r, c.g, c.b); cam.push(...camoOf(c)); mat.push(matOf(c));
      hin.push(...(hinge ? [xs, hinge[0], hinge[1] ?? 0] : NOHINGE));
      if (k === 0 && s.q <= 0) lead.push([v.x, v.z]);
      if (k === nk && side > 0 && s.q <= 0) trail.push([v.x, v.z]);
    }
  });
  for (let i = 0; i + 1 < st.length; i++) for (let j = 0; j < rn; j++) {
    const j1 = (j + 1) % rn, a = i * rn + j, b = (i + 1) * rn + j, c = (i + 1) * rn + j1, d = i * rn + j1;
    idx.push(a, b, c, a, c, d);
  }
  let geo = sheet(pos, col, idx, ang, { cam, mat, hinge: hin });
  const outline = [...lead, ...trail.reverse()], outlines = [outline];
  if (mirror) { geo = twin(geo); outlines.push(outline.map(([x, z]) => [x, -z])); }
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

// The RAF fin flash: dull red, a narrow white stripe and dull blue (11, 2 and 11 parts), 2 * size square. dir 1 puts
// the red toward +x.
function finFlash(size, dir = 1) {
  const S = size, x = (f) => dir * (S - 2 * S * f), rect = (a, b) => [[a, -S], [b, -S], [b, S], [a, S]];
  return flat([[RAF_RED, 0, 11 / 24], [WHITE, 11 / 24, 13 / 24], [RAF_BLUE, 13 / 24, 1]].map(([color, a, b]) => ({ color, outline: rect(x(a), x(b)) })));
}

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
  return sheet(pos, col, idx, 70, { mat: PLAIN });
}

// ---------------------------------------------------------------- paint

// The real paints, as weathered paint looks in daylight: US olive drab over neutral grey, the Luftwaffe's RLM 70/71
// black-green and dark green over RLM 65 light blue (bombers, the Stuka and the Ju 52) or RLM 74/75 greys over RLM 76
// (the Bf 109), the VVS green and black over light blue, and the Mustang's bare aluminium. They sit lighter than paint
// chips so the camouflage reads from the game camera, and the greens are pulled toward grey with their blue kept up:
// the warm sun and the Neutral tone mapper (which subtracts the darkest channel) would turn a dark olive mustard. The
// model textures fade and wear them further.
const METAL = 0xa9b1b8, OD = 0x666d5f, NEUTRAL = 0x8c8f8a;
const RLM70 = 0x414a44, RLM71 = 0x5b6656, RLM65 = 0x9cb0ba, RLM74 = 0x4f5553, RLM75 = 0x6c6e74, RLM76 = 0xaebbc1;
const VVS_GREEN = 0x5f6c5b, VVS_BLACK = 0x3e4641, VVS_BLUE = 0x9bb0bb;
// The RAF: ocean grey and dark green over medium sea grey (the day fighters and the Mosquito), dark earth and dark
// green (the Dakota), Sky for the fighters' spinners and tail bands, and the dull red and blue of the roundels.
const OCEAN = 0x6d7378, RAF_GREEN = 0x535e50, MSG = 0xa2a7a6, RAF_SKY = 0xb4bea0, EARTH = 0x6e6353, RAF_RED = 0x93322b, RAF_BLUE = 0x2e3d63;
// propeller tip colour by faction: yellow (USA), none (Germany: the blades stay black-green), yellow (USSR), yellow (UK)
const BLADE = [0x1f1f1d, 0x2b322c, 0x222220, 0x1f1f1d], PROP_TIPS = [0xc99a2e, 0x2b322c, 0xb8932e, 0xc99a2e];
// D-Day invasion stripes: five bands w wide from a, white, black, white, black, white. Gives the colour at v (or
// null outside them); stripeCuts gives the paint edges.
const stripes = (a, w) => (v) => (v > a && v < a + 5 * w ? C(Math.floor((v - a) / w) % 2 ? 0x262522 : 0xc4bfb0) : null);
const stripeCuts = (a, w) => Array.from({ length: 6 }, (_, k) => a + k * w);

// Camouflage is drawn per pixel by paintMaterial(), so its edges stay crisp however coarse the mesh. A camouflaged
// paint returns its first colour with a .camo code: [the second colour as a ratio to the first (r, g, b), kind * 4 +
// scale, plus 32 for faint panel lines]. Kinds: 1 splinter, 2 waves, 3 mottle, 4 panel lines (bare metal), 5
// splinter on Junkers corrugation. scale (under 3.5) sets the size of the patches.
const camo = (a, b, kind, s) => {
  const A = C(a), B = C(b), code = [B.r / A.r, B.g / A.g, B.b / A.b, kind * 4 + s];
  return () => { const c = A.clone(); c.camo = code; return c; };
};
const solid = (h) => () => C(h);
const splinter = (a, b, s = 1.5) => camo(a, b, 1, s);
const waves = (a, b, s = 1) => camo(a, b, 2, s);
const mottle = (base, spot, s = 1) => camo(base, spot, 3, s);
const panels = (h, s = 1.2) => camo(h, C(h).multiplyScalar(0.84), 4, s);
const corrugated = (a, b, s = 2.4) => camo(a, b, 5, s);
// the same colour with faint panel lines drawn over its camouflage (not on bare metal, which has its own)
const lined = (c) => { const q = camoOf(c); if (q[3] >= 16 && q[3] < 20) return c; c.camo = [q[0], q[1], q[2], q[3] + 32]; return c; };

// A paint scheme: top(p, n, info) the upper colour, under the underside colour (a colour, a paint, or null: none).
// Bodies switch to the underside below `line` (the sine of the ring angle), wings and tailplanes on their lower
// surface, other parts when they face down. Plain colours get a light wash of noise so big panels are not one flat
// colour, and the skin of fuselage, wings and tail gets faint panel lines.
const SKIN = new Set(['fus', 'wing', 'tail', 'fin', 'nac', 'cowl']);
function livery(top, under = null, line = -0.3, wash = 0.06) {
  const U = under == null ? null : typeof under === 'function' ? under : solid(under);
  return (p, n, i) => {
    let low = false;
    if (U && i.tag !== 'fin' && i.tag !== 'canopy') {
      if (i.tag === 'leg') low = false;
      else if (i.upper !== undefined) low = !i.upper;
      else if (i.t !== undefined) low = Math.sin(i.t) < line;
      else low = n.y < -0.3;
    }
    let c = low ? U(p, n, i) : top(p, n, i);
    if (!c.camo && wash) c = c.multiplyScalar(1 - wash / 2 + wash * noise(p.x * 2.1 + 7, (p.z + 0.8 * p.y) * 2.1));
    return SKIN.has(i.tag) ? lined(c) : c;
  };
}
// canopy glass: dark, catching the grey of the sky on its sides and more of it on top, plain (no paint texture)
const glass = (n) => { const c = C(0x18333d).lerp(C(0x607a88), 0.12 + 0.25 * Math.max(0, n.y) ** 2); c.mat = 'plain'; return c; };
// exhaust soot: how much darker a fuselage point is behind exhaust stacks ending at x1 along a row at height y
// (spread: how far it reaches aft; drop: how much the stain sags as it trails back)
const sootAt = (p, { x1, y, spread = 1.4, h = 0.16, drop = 0.06 }) => {
  const d = x1 - p.x;
  if (d < -0.05 || d > spread) return 0;
  const v = Math.abs(p.y - (y - drop * d)) / (h + 0.06 * d);
  return clamp01(1 - v * v) * (1 - d / spread) * (d < 0 ? 0.5 : 1);
};

// The shader side of the paint. CAMO_PARS goes before main(); CAMO_MAIN after the vertex colour is applied: it
// decodes the camo attribute and multiplies in the second colour where the pattern says (edges anti-aliased over
// about a pixel), then darkens the panel lines and hinge lines. The kind is a flat varying, so a triangle between two
// patterns takes one of them whole.
const CAMO_PARS = /* glsl */ `
varying vec3 vCamoC;
flat varying float vCamoK;
varying vec3 vCamoP;
varying vec3 vHinge;
float camoHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec2 camoHash2( vec2 p ) { return fract( sin( vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 ); }
float camoNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	float a = camoHash( i ), b = camoHash( i + vec2( 1.0, 0.0 ) ), c = camoHash( i + vec2( 0.0, 1.0 ) ), d = camoHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// Splinter: jittered, weighted cells, each one colour or the other. The seed offsets and per-cell radius variation
// break the repeated grid into uneven polygons while keeping the characteristic straight, angular boundaries.
// Positive in the first colour.
float camoSplinter( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	float da = 8.0, db = 8.0;
	for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
		vec2 g = vec2( float( x ), float( y ) ), o = 0.08 + 0.84 * camoHash2( i + g ), r = g + o - f;
		float d = dot( r, r ) + 0.32 * ( camoHash( i + g + 71.3 ) - 0.5 );
		if ( camoHash( i + g + 17.3 ) < 0.5 ) da = min( da, d ); else db = min( db, d );
	}
	return db - da;
}
// 1 on thin lines every period along u (hw their half width, w the screen-space change of u), fading out with distance
float camoLine( float u, float period, float hw, float w ) {
	w = max( w * 0.75, 1e-5 );
	float d = abs( fract( u / period + 0.5 ) - 0.5 ) * period;
	return ( 1.0 - smoothstep( hw - w, hw + w, d ) ) * min( 1.0, hw / w );
}`;
const CAMO_MAIN = /* glsl */ `
	{
		float kc = vCamoK, lined = step( 31.5, kc );
		kc -= 32.0 * lined;
		float k = floor( kc * 0.25 + 0.01 ), s = max( kc - 4.0 * k, 0.05 );
		vec3 cp = vCamoP;
		float q = cp.z + 0.8 * cp.y, lz = abs( cp.z ) + 0.5 * cp.y, cu = cp.y + abs( cp.z );
		float wx = fwidth( cp.x ), wl = fwidth( lz ), wu = fwidth( cu ), f = 1.0;
		if ( k > 4.5 || ( k > 0.5 && k < 1.5 ) ) {
			// angular splinter polygons on long, raked cells; jittered seeds keep their sizes and edges varied
			vec2 r = vec2( 0.86 * cp.x + 0.5 * q, - 0.5 * cp.x + 0.86 * q ) / s;
			r *= vec2( 0.48, 0.82 );
			f = camoSplinter( r );
		} else if ( k > 1.5 && k < 2.5 ) {
			f = sin( ( 0.75 * cp.x - 0.66 * q ) * 1.15 / s + 2.6 * camoNoise( vec2( 0.33 * cp.x / s + 3.1, 0.33 * q / s ) ) + 1.2 * camoNoise( vec2( 1.1 * cp.x / s, 1.1 * q / s + 5.0 ) ) );
		} else if ( k > 2.5 && k < 3.5 ) {
			vec2 r = vec2( cp.x, q ) / s;
			f = 0.6 * camoNoise( 1.7 * r + 1.3 ) + 0.28 * camoNoise( 4.3 * r ) + 0.12 * camoNoise( 9.1 * r + 2.0 ) - 0.52;
		}
		float fw = max( fwidth( f ) * 0.75, 1e-5 ), m = smoothstep( - fw, fw, f );
		// the Bf 109's soft-sprayed greys: a wider, softer edge
		if ( k > 2.5 && k < 3.5 ) m = smoothstep( - 0.03 - fw, 0.03 + fw, f );
		if ( k > 3.5 && k < 4.5 ) m = max( camoLine( cp.x, s, 0.014, wx ), camoLine( lz, 1.1, 0.011, wl ) );
		if ( k > 0.5 ) diffuseColor.rgb *= mix( vec3( 1.0 ), vCamoC, m );
		// Junkers corrugation: fine light and dark ridges along the airflow, gone before they would shimmer
		if ( k > 4.5 ) diffuseColor.rgb *= 1.0 + 0.13 * ( 1.0 - smoothstep( 0.015, 0.035, wu ) ) * sin( 6.2832 * cu / 0.16 );
		// faint panel lines on painted skin
		if ( lined > 0.5 ) diffuseColor.rgb *= 1.0 - 0.2 * max( camoLine( cp.x, 1.05, 0.009, wx ), camoLine( lz, 1.25, 0.008, wl ) );
		// weathered skin: each panel a shade lighter or darker than the next (the cells between the panel lines), and
		// faint streaks trailing back with the airflow
		if ( lined > 0.5 || ( k > 3.5 && k < 4.5 ) ) {
			bool bare = k > 3.5 && k < 4.5;
			float tone = camoHash( floor( vec2( cp.x / ( bare ? s : 1.05 ), lz / ( bare ? 1.1 : 1.25 ) ) ) + 3.7 ) - 0.5;
			float streak = 0.7 * camoNoise( vec2( cp.x * 0.45, q * 6.0 ) ) + 0.3 * camoNoise( vec2( cp.x * 1.3 + 5.0, q * 17.0 ) ) - 0.5;
			diffuseColor.rgb *= 1.0 + 0.1 * tone + 0.2 * streak;
		}
		// control-surface hinge lines and the flap and aileron break
		if ( vHinge.y > 0.0 ) {
			float wh = fwidth( vHinge.x ), az = abs( cp.z ), hl = camoLine( vHinge.x - vHinge.y, 8.0, 0.007, wh );
			if ( vHinge.z > 0.0 && vHinge.x > vHinge.y ) hl = max( hl, camoLine( az - vHinge.z, 40.0, 0.012, fwidth( az ) ) );
			diffuseColor.rgb *= 1.0 - 0.4 * hl;
		}
	}`;
// a fill light in the paint's own colour, a little stronger on the side away from the sun, so shaded sides keep
// some of their hue instead of all of the sky light's blue
const FILL = /* glsl */ `
	#ifndef STANDARD
	#if NUM_DIR_LIGHTS > 0
		totalEmissiveRadiance += diffuseColor.rgb * ( 0.035 + 0.08 * ( 1.0 - max( dot( normal, directionalLights[ 0 ].direction ), 0.0 ) ) );
	#else
		totalEmissiveRadiance += diffuseColor.rgb * 0.06;
	#endif
	#endif`;

// Make a vertex-coloured material draw the planes' paint: the camouflage, panel and hinge lines
// from the camo and hinge attributes and the fill light. Geometry without them (bombs, the airfield) draws as plain
// vertex colours.
export function paintMaterial(mat) {
  mat.defaultAttributeValues = { ...(mat.defaultAttributeValues ?? {}), camo: [1, 1, 1, 0], hinge: [0, 0, 0] };
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 camo;\nattribute vec3 hinge;\nvarying vec3 vCamoC;\nflat varying float vCamoK;\nvarying vec3 vCamoP;\nvarying vec3 vHinge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCamoC = camo.rgb; vCamoK = camo.w; vCamoP = position; vHinge = hinge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAMO_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CAMO_MAIN}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FILL}`);
  };
  mat.customProgramCacheKey = () => 'plane-paint';
  return mat;
}

// ---------------------------------------------------------------- the kit

function kit(own) {
  const parts = [], polys = [], props = [];
  const K = {
    own: C(own).lerp(C(0x7a7a72), 0.1), paint: null, parts, polys, props,
    // geo after m, its colours times color, made of mat where it does not say (a MATS name, 'plain' or null)
    add(geo, m = null, color = 0xffffff, mat = null) { parts.push({ geo, color, m, mat }); },
    hull(keys, o = {}) { const h = hull(keys, { paint: K.paint, ...o }); K.add(h.geo); if (o.shadow !== false) polys.push(...h.outlines); return h; },
    wing(keys, o = {}) { const w = wing(keys, { paint: K.paint, ...o }); K.add(w.geo); if (o.shadow !== false) polys.push(...w.outlines); return w; },
    // Curved wing-root fairings join the wing to the fuselage with a shallow concave fillet.
    fairing(body, w) {
      const pos = [], col = [], mat = [], cam = [], idx = [], chord = w.plan(0), NX = 14, NZ = 5;
      for (const s of [-1, 1]) {
        const offset = pos.length / 3;
        for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
          const v = i / NX, u = j / NZ, x = chord.te + (chord.le - chord.te) * v;
          const rise = 0.19 * Math.sin(PI * v), y0 = w.surf(x, 0) + rise;
          const z0 = body.side(x, y0), z = z0 + 0.34 * u;
          const y = w.surf(x, z) + rise * (1 - u) ** 2;
          const p = new THREE.Vector3(x, y, s * z), c = K.paint(p, new THREE.Vector3(0, 1, 0), { tag: 'wing', upper: true });
          pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); cam.push(...camoOf(c)); mat.push(matOf(c));
        }
        for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
          const a = offset + i * (NZ + 1) + j, b = a + NZ + 1, c = b + 1, d = a + 1;
          if (s > 0) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
        }
      }
      K.add(sheet(pos, col, idx, 60, { mat, cam }));
    },
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
      const { p = 2.4, sink = 0.2, frames = [], bars = [], fw = 0.055, bw = 0.085, seg = 18, frame = null, arc = [-0.4, PI + 0.4] } = o;
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
      const P = g.attributes.position, N = g.attributes.normal, col = new Float32Array(P.count * 3), cam = new Float32Array(P.count * 4), mt = new Float32Array(P.count), p = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
        const c = paint(p, n, { tag });
        c.toArray(col, i * 3); cam.set(camoOf(c), i * 4); mt[i] = matOf(c);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('camo', new THREE.BufferAttribute(cam, 4));
      g.setAttribute('matId', new THREE.BufferAttribute(mt, 1));
      K.add(g);
      if (mirror) K.add(g, MIRROR);
    },
    box(x, y, z, sx, sy, sz, color, ry = 0, rz = 0, rx = 0, mat = null) { K.add(BOX, xf(x, y, z, rx, ry, rz, sx, sy, sz), color, mat); },
    // a rod from a to b: guns and masts are gunmetal, struts (mat null) take the paint's texture
    rod(a, b, r, color, radial = 6, mat = 'gunmetal') { K.add(tube([a, b], r, { radial }), null, color, mat); },
    // A propeller spinner from x to x + len, radius r, centred at (y, z): pointed, or a dome (round). color: its paint;
    // band: another colour round the back, bandWidth of the length; front: another colour from `split` of the length
    // to the tip, or only between the ring angles stripe [a0, a1], which twist (radians per unit of length) turns
    // into a spiral.
    spinner(x, len, r, o = {}) {
      const { y = 0, z = 0, color = DARK, band = null, bandWidth = 0.25, front = null, split = 0.5, stripe = null, twist = 0, round = false, seg = 12 } = o;
      const keys = [[x, 2 * r, 2 * r, y], [x + 0.12 * len, 2 * r, 2 * r, y]];
      for (const u of [0.35, 0.65, 0.88]) { const f = round ? Math.sqrt(1 - u * u) : 1 - u * u; keys.push([x + len * (0.12 + 0.88 * u), 2 * r * f, 2 * r * f, y]); }
      keys.push([x + len, 0, 0, y]);
      const xb = x + bandWidth * len, xs = x + split * len, cuts = [];
      if (band != null) cuts.push(xb);
      if (front != null && !stripe) cuts.push(xs);
      const paint = (p, n, i) => {
        if (band != null && i.x < xb) return C(band);
        if (front != null && (stripe ? i.t > stripe[0] && i.t < stripe[1] : i.x > xs)) return C(front);
        return C(color);
      };
      K.hull(keys, { seg, z, twist, paint, tag: 'spin', cuts, angles: stripe ?? [], caps: [true, false], crease: 70, shadow: false });
    },
    prop(x, y, z, r, n) { props.push({ x, y, z, r, n }); },
    // a radial engine: cowling from x to x + len (painted; ring: all one colour; lip: only the front lip), a dark
    // face and cylinder heads
    radial({ x, y = 0, z = 0, r, len, ring = null, lip = null, cyl = 9, cowl = true, mirror = false }) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      if (cowl) {
        const back = [[0.95 * r, 0], [r, 0.18 * len], [r, 0.84 * len]], front = [[r, 0.84 * len], [0.96 * r, 0.94 * len], [0.89 * r, len], [0.82 * r, 0.97 * len], [0.8 * r, 0.8 * len]];
        if (lip != null) {
          K.painted(lathe(back, 18, { axis: 'x' }), m, 'cowl', ring != null ? () => C(ring) : K.paint, mirror);
          K.painted(lathe(front, 18, { axis: 'x' }), m, 'cowl', () => C(lip), mirror);
        } else K.painted(lathe([...back, ...front.slice(1)], 18, { axis: 'x' }), m, 'cowl', ring != null ? () => C(ring) : K.paint, mirror);
      }
      const face = lathe([[0, 0.86 * len + 0.16 * r], [0.22 * r, 0.86 * len + 0.12 * r], [0.3 * r, 0.86 * len], [0.83 * r, 0.8 * len]], 14, { axis: 'x' });
      const ms = mirror ? [m, MIRROR.clone().multiply(m)] : [m];
      for (const mm of ms) {
        K.add(face, mm, DARK, 'gunmetal');
        for (let k = 0; k < cyl; k++) K.add(BOX, mm.clone().multiply(xf(0.84 * len, 0, 0, (k / cyl) * TAU)).multiply(xf(0, 0.57 * r, 0, 0, 0, 0, 0.12 * r, 0.34 * r, 0.17 * r)), 0x55534c, 'gunmetal');
        K.add(spinner(0.16 * r + 0.06, 0.17 * r, 10), mm.clone().multiply(new THREE.Matrix4().makeTranslation(0.86 * len + 0.1 * r, 0, 0)), STEEL, 'gunmetal');
      }
    },
    // exhaust stacks along a body side, both sides: short burnt-metal stubs standing only a little proud of the skin,
    // raked back (the soot behind them is in the paint, see sootAt)
    stubs(body, x0, x1, y, count, size = 0.09) {
      for (const s of [1, -1]) for (let k = 0; k < count; k++) {
        const x = x0 + ((x1 - x0) * k) / Math.max(1, count - 1);
        K.box(x, y, s * (body.side(x, y) + size * 0.12), size * 1.25, size * 0.62, size * 0.75, EXHAUST, 0, -0.5, 0, 'gunmetal');
      }
    },
    // a national marking: kind 'us', 'cross', 'star', or the RAF's 'raf' (the type C1 roundel, yellow ringed), 'rafb'
    // (the type B, red and blue) and 'flash' (the fin flash, red forward); on a wing {wing, x, z}, on a body's sides
    // {hull, x, y} or on a fin's sides {fin, x, h}; sides picks 1 and/or -1
    mark(kind, size, o) {
      const make = (s) => kind === 'us' ? usInsignia(size) : kind === 'cross' ? balkenkreuz(size, { lift: 0 })
        : kind === 'raf' ? roundel(size, [YELLOW, RAF_BLUE, WHITE, RAF_RED], { widths: [2 / 18, 8 / 18, 2 / 18, 6 / 18], lift: 0, segments: 20 })
        : kind === 'rafb' ? roundel(size, [RAF_BLUE, RAF_RED], { widths: [0.6, 0.4], lift: 0, segments: 24 })
        : kind === 'flash' ? finFlash(size, -s) // a fin's side s faces its decal's +x aft
        : star(size, { color: RED, border: WHITE, edge: 0.12, lift: 0 });
      const g = make(1);
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
          const geo = stick(make(s), place(at, [0, s, 0], [0, 0, 1]), (v) => { v.y = F.surf(v.x, v.z, s) + s * 0.015; }, 0.45);
          K.add(geo, F.m);
          if (F.mirrored) K.add(geo, MIRROR.clone().multiply(F.m));
        }
      }
    },
    // small dark windows on a body's sides: x positions, at height y, w by h
    windows(body, xs, y, w, h, color = GLASS) {
      const g = flat([{ outline: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], color }]); // plain, as stick() makes every decal
      for (const s of [1, -1]) for (const x of xs) K.add(stick(g, place([x, y, s * body.side(x, y)], [0, 0, s], [0, 1, 0]), (v) => { v.z = s * (body.side(v.x, v.y) + 0.015); }, 0.2));
    },
    wheel(x, y, z, r, w, mirror = true, seg = 12) {
      const g = lathe([[0, -0.36 * w], [0.45 * r, -0.42 * w], [0.62 * r, -0.5 * w], [0.88 * r, -0.5 * w], [r, -0.22 * w], [r, 0.22 * w], [0.88 * r, 0.5 * w], [0.62 * r, 0.5 * w], [0.45 * r, 0.42 * w], [0, 0.36 * w]], seg, { axis: 'z' });
      K.add(g, new THREE.Matrix4().makeTranslation(x, y, z), 0x2e2d29, 'rubber');
      if (mirror) K.add(g, new THREE.Matrix4().makeTranslation(x, y, -z), 0x2e2d29, 'rubber');
    },
  };
  return K;
}

// The owner's colour, kept small as a unit marking: a band round the rear fuselage (band [x0, x1]; the fuselage needs
// cuts there). Each plane adds it to its spinner or cowl lips as well. soot: exhaust stains along the fuselage
// sides (see sootAt), darkening the paint behind the stacks.
function owned(K, base, band = null, soot = []) {
  return (p, n, i) => {
    if (band && i.tag === 'fus' && p.x > band[0] && p.x < band[1]) return K.own.clone();
    const c = base(p, n, i);
    if (soot.length && (i.tag === 'fus' || i.tag === 'nac' || i.tag === 'cowl')) {
      let k = 0;
      for (const st of soot) k = Math.max(k, sootAt({ x: p.x, y: p.y }, st));
      if (k > 0) c.lerp(C(0x1d1b19), 0.72 * k);
    }
    return c;
  };
}

// ---------------------------------------------------------------- USA

// P-51D Mustang: bare aluminium with panel lines, a narrow olive anti-glare panel ahead of the windscreen, a raised
// bubble canopy, a tall fin with a dorsal fillet, square-tipped tailplane, the chin intake and the deep belly scoop,
// six stacks each side, a four-blade prop behind a spinner with an owner-coloured tip.
function p51(K) {
  const metal = livery(panels(METAL, 1.2)), od = C(0x4f5547), up = C(0xa6bcd8), down = C(0x74736d);
  const base = (p, n, i) => { const c = metal(p, n, i); return n.y > 0 ? c.lerp(up, 0.4 * n.y) : c.lerp(down, -0.3 * n.y); };
  K.paint = owned(K, (p, n, i) => (i.tag === 'fus' && p.x > 1.5 && p.x < 3.42 && Math.sin(i.t) > 0.82 ? od.clone() : base(p, n, i)), [-2.75, -2.4], [{ x1: 2.08, y: 0.2, spread: 1.5 }]);
  const fus = K.hull([[-3.95, 0.04, 0.12, 0.44], [-3.6, 0.16, 0.48, 0.4], [-3.0, 0.3, 0.74, 0.33], [-2.0, 0.48, 0.98, 0.23], [-1.0, 0.68, 1.12, 0.16], [-0.1, 0.84, 1.22, 0.12], [0.7, 0.9, 1.24, 0.1], [1.5, 0.9, 1.2, 0.08], [2.4, 0.84, 1.06, 0.06], [3.1, 0.74, 0.84, 0.04], [3.5, 0.6, 0.62, 0.04]], { seg: 18, cuts: [-2.75, -2.4, 1.5, 3.42], angles: [0.961, PI - 0.961] });
  K.canopy(fus, [[1.45, 0.06, 0.0], [1.33, 0.44, 0.22], [1.1, 0.56, 0.4], [0.7, 0.6, 0.5], [0.25, 0.56, 0.48], [-0.15, 0.42, 0.32], [-0.5, 0.18, 0.1], [-0.68, 0.04, 0.0]], { p: 2, frames: [1.08], bars: [0.08, PI - 0.08, { a: 0.95, x0: 1.08, x1: 2 }, { a: PI - 0.95, x0: 1.08, x1: 2 }], frame: METAL, seg: 14 });
  const w = K.wing([[0, 1.15, -1.15, -0.3, 0.15], [4.6, 0.55, -0.5, 0.1, 0.11]], { n: 7, round: 0.18, hinge: [0.76, 2.55] });
  K.fairing(fus, w);
  // Six short muzzle ports sit flush with the leading edge.
  for (const s of [1, -1]) for (const z of [1.65, 1.84, 2.03]) {
    const p = w.plan(z);
    K.rod([p.le - 0.09, p.y, s * z], [p.le + 0.025, p.y, s * z], 0.027, DARK, 5);
  }
  K.wing([[0, -2.95, -3.92, 0.26, 0.1], [2.0, -3.3, -3.82, 0.26, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.08, hinge: [0.6] });
  K.fin([[0, -2.25, -3.98, 0, 0.1], [0.25, -2.9, -3.99, 0, 0.1], [0.7, -3.18, -3.97, 0, 0.1], [1.35, -3.48, -3.9, 0, 0.09]], { y: 0.44, nk: 4, n: 4, round: 0.28, smooth: true, hinge: [0.6] });
  // the dorsal fillet running forward from the fin along the spine
  K.fin([[0, -1.55, -2.4, 0, 0.08], [0.16, -2.3, -2.5, 0, 0.08]], { y: fus.top(-2.0) - 0.06, nk: 3, n: 1, round: 0, crease: 50 });
  // the deep radiator scoop under the belly, its intake under the wing and its body well aft of the trailing edge
  K.hull([[-2.7, 0.06, 0.06, -0.32], [-2.0, 0.42, 0.36, -0.48], [-1.2, 0.54, 0.46, -0.56], [-0.35, 0.5, 0.42, -0.6], [-0.1, 0.42, 0.3, -0.6]], { seg: 12, tag: 'pod', capColor: [null, DARK] });
  // the carburettor intake under the spinner
  K.hull([[2.45, 0.1, 0.06, -0.26], [2.85, 0.3, 0.24, -0.34], [3.35, 0.3, 0.24, -0.32]], { seg: 10, tag: 'pod', capColor: [null, DARK], shadow: false });
  K.stubs(fus, 2.1, 3.05, 0.2, 6);
  K.spinner(3.45, 0.62, 0.28, { y: 0.04, color: METAL, front: K.own, split: 0.62 });
  K.prop(3.6, 0.04, 0, 1.35, 4);
  K.mark('us', 0.42, { wing: w, x: 0.15, z: -2.9 });
  K.mark('us', 0.3, { hull: fus, x: -1.55, y: 0.15 });
  return { span: 9.2, len: 8.0, tail: -3.95, nose: 4.07, metal: true };
}

// P-47D Thunderbolt: a barrel of a fuselage behind a big round cowl with an owner-coloured front ring, a domed
// spinner, razorback canopy, elliptical wing with a bomb on each inner pylon and a triple M10 rocket tube under each
// outer wing, olive drab over neutral grey, soot from the turbo ducts along the belly sides.
function p47(K) {
  const base = livery(solid(OD), NEUTRAL, -0.35);
  K.paint = owned(K, (p, n, i) => ((i.tag === 'fus' || i.tag === 'cowl') && p.x > 4.2 ? K.own.clone() : base(p, n, i)), [-3.0, -2.65], [{ x1: 0.9, y: -0.55, spread: 1.8, h: 0.2, drop: 0 }]);
  const fus = K.hull([[-4.72, 0.04, 0.12, 0.5], [-4.3, 0.24, 0.56, 0.45], [-3.4, 0.5, 0.98, 0.33], [-2.2, 0.82, 1.4, 0.17], [-1.0, 1.08, 1.7, 0.04], [0.2, 1.26, 1.86, -0.04], [1.4, 1.34, 1.8, -0.05], [2.6, 1.4, 1.62, -0.01], [3.5, 1.44, 1.48, 0.02], [4.0, 1.44, 1.42, 0.02], [4.38, 1.4, 1.36, 0.02]], { seg: 16, cuts: [-3.0, -2.65, 4.2], angles: [-0.358, PI + 0.358], caps: [true, false] });
  K.add(lathe([[0.7, 0], [0.66, -0.03], [0.64, -0.2]], 16, { axis: 'x' }), new THREE.Matrix4().makeTranslation(4.38, 0.02, 0), K.own);
  K.radial({ x: 3.9, r: 0.86, len: 0.42, cowl: false, cyl: 0 });
  // the razorback spine from the canopy down to the fin
  K.hull([[-3.6, 0.1, 0.5, 0.56], [-2.4, 0.28, 0.62, 0.76], [-1.0, 0.4, 0.66, 0.95], [-0.1, 0.48, 0.62, 1.1], [0.3, 0.52, 0.56, 1.16]], { seg: 10, shadow: false, caps: [false, true], cuts: [-3.0, -2.65] });
  K.canopy(fus, [[2.25, 0.34, 0.02], [2.02, 0.76, 0.38], [1.6, 0.88, 0.56], [1.0, 0.88, 0.6], [0.5, 0.78, 0.56], [0.2, 0.56, 0.5]], { p: 2.6, frames: [1.85, 1.3, 0.75], bars: [PI / 2], seg: 12 });
  const w = K.wing([[0, 1.25, -1.35, -0.5, 0.15], [5.6, 0.85, -0.4, -0.1, 0.1]], { n: 6, round: 1.7, hinge: [0.76, 3.2] });
  K.fairing(fus, w);
  // The eight gun openings follow the swept leading edge without adding separate meshes.
  for (const s of [1, -1]) for (const z of [2.65, 2.82, 2.99, 3.16]) {
    const p = w.plan(z);
    K.add(PORT, xf(p.le + 0.008, p.y, s * z, 0, PI / 2, 0, 0.065, 0.07, 1), DARK, 'plain');
  }
  K.wing([[0, -3.45, -4.6, 0.33, 0.1], [2.3, -3.85, -4.45, 0.33, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 1.0, hinge: [0.62] });
  K.fin([[0, -2.9, -4.72, 0, 0.1], [0.3, -3.45, -4.74, 0, 0.1], [1.25, -3.95, -4.7, 0, 0.09]], { y: 0.6, nk: 4, n: 4, round: 0.7, smooth: true, hinge: [0.6] });
  const bombGeo = bomb(1.7, 0.3, { segments: 8 }), tubeGeo = tube([[-0.5, 0, 0], [1.4, 0, 0]], 0.085, { radial: 6, caps: false }), mouth = lathe([[0.075, 0], [0, 0.01]], 6, { axis: 'x' });
  for (const s of [1, -1]) {
    // a 500 lb bomb on the inner pylon
    const bz = 2.15 * s, sy = w.surf(0.1, 2.15, -1);
    K.add(bombGeo, xf(-0.8, sy - 0.42, bz), 0x666b5c);
    K.box(0.05, sy - 0.08, bz, 0.7, 0.16, 0.06, OD);
    // an M10 cluster: three rocket tubes in a bundle tucked under the outer wing on a short pylon
    const rz = 3.55, ry = w.surf(0.3, rz, -1) - 0.24;
    K.box(0.35, ry + 0.16, s * rz, 0.9, 0.14, 0.05, OD);
    for (const [dy, dz] of [[0.07, 0], [-0.07, 0.1], [-0.07, -0.1]]) {
      K.add(tubeGeo, xf(0, ry + dy, s * rz + dz), 0x6a6e5e);
      K.add(mouth, xf(1.405, ry + dy, s * rz + dz), DARK, 'plain');
    }
  }
  K.spinner(4.28, 0.46, 0.3, { color: 0x34372f, round: true, seg: 14 });
  K.prop(4.45, 0.02, 0, 1.62, 4);
  K.mark('us', 0.5, { wing: w, x: 0.1, z: -3.6 });
  K.mark('us', 0.38, { hull: fus, x: -1.5, y: 0.18 });
  return { span: 11.2, len: 9.5, tail: -4.72, nose: 4.74 };
}

// B-25J Mitchell: slab-sided fuselage, framed glass nose, stepped cockpit, top turret, a wing with dihedral inboard
// and flat outer panels, nacelles set back so the props sit level with the cockpit, thin endplate fins.
function b25(K) {
  const base = livery(solid(OD), NEUTRAL, -0.35), od = C(OD);
  const frameX = [6.05, 6.35, 6.62], bars = [0.5, PI / 2, PI - 0.5];
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && p.x > 5.75 && Math.sin(i.t) > -0.35) return frameX.some((x) => Math.abs(p.x - x) < 0.05) || bars.some((a) => Math.abs(i.t - a) < 0.07) ? od.clone() : glass(n);
    if (i.tag === 'fus' && p.x < -5.9 && Math.sin(i.t) > -0.35) return Math.abs(p.x + 6.15) < 0.03 ? od.clone() : glass(n);
    return base(p, n, i);
  }, [-4.7, -4.3]);
  const keys = [[-6.45, 0.26, 0.36, 0.45, 2], [-6.0, 0.56, 0.78, 0.42, 2.2], [-5.0, 0.84, 1.08, 0.34, 2.6], [-3.0, 1.14, 1.44, 0.18, 3.2], [-0.5, 1.3, 1.66, 0.08, 3.6], [2.0, 1.34, 1.7, 0.06, 3.6], [3.6, 1.34, 1.68, 0.04, 3.6], [4.7, 1.3, 1.58, 0.0, 3], [5.6, 1.18, 1.34, -0.06, 2.4], [6.3, 0.9, 0.98, -0.1, 2.2], [6.75, 0.52, 0.56, -0.12, 2], [6.95, 0.04, 0.04, -0.12, 2]];
  const under = [PI + 0.358, TAU - 0.358];
  const fus = K.hull(keys, { seg: 20, range: [-6.45, 5.75], cuts: [-6.13, -6.17, -5.9, -4.7, -4.3], angles: under, capColor: [GLASS, null] });
  K.hull(keys, { seg: 20, range: [5.75, 6.95], cuts: frameX.flatMap((x) => [x - 0.05, x + 0.05]), angles: [...under, ...bars.flatMap((a) => [a - 0.07, a + 0.07])], shadow: false });
  K.canopy(fus, [[5.15, 0.6, 0.02], [4.9, 1.0, 0.26], [4.45, 1.1, 0.38], [3.8, 1.08, 0.38], [3.4, 0.9, 0.28], [3.1, 0.4, 0.04]], { p: 3, frames: [4.62, 4.2, 3.75], bars: [PI / 2], seg: 12, sink: 0.25 });
  // top turret
  const ty = fus.top(2.5) - 0.05;
  K.painted(lathe([[0.5, 0], [0.5, 0.06], [0.46, 0.18], [0.34, 0.34], [0.18, 0.44], [0, 0.48]], 14), new THREE.Matrix4().makeTranslation(2.5, ty, 0), 'canopy', (q, n) => glass(n));
  K.add(lathe([[0.53, -0.1], [0.53, 0.07]], 14), new THREE.Matrix4().makeTranslation(2.5, ty, 0), OD);
  for (const s of [1, -1]) K.rod([2.6, ty + 0.25, s * 0.12], [3.5, ty + 0.27, s * 0.12], 0.035, DARK);
  const w = K.wing([[0, 2.85, -0.85, -0.15, 0.17], [2.95, 2.55, -0.75, 0.38, 0.16], [8.6, 1.3, 0.0, 0.38, 0.1]], { n: 7, round: 0.5, hinge: [0.76, 5.5] });
  K.fairing(fus, w);
  K.hull([[-3.5, 0.04, 0.06, 0.36], [-2.8, 0.42, 0.52, 0.32], [-1.5, 0.86, 1.08, 0.3], [0.3, 1.12, 1.36, 0.34], [2.1, 1.24, 1.4, 0.37], [3.5, 1.26, 1.3, 0.38]], { seg: 16, z: 2.95, mirror: true, tag: 'nac', angles: under });
  K.radial({ x: 3.45, y: 0.38, z: 2.95, r: 0.65, len: 0.72, lip: K.own, mirror: true });
  K.wing([[0, -5.05, -6.3, 0.62, 0.1], [2.85, -5.25, -6.25, 0.72, 0.1]], { tag: 'tail', nk: 4, n: 3, round: 0.12, hinge: [0.6] });
  // the endplate fins: tall rounded trapezoids, narrower at the top, reaching well below the tailplane, the rudder
  // hinge a little behind the middle of the chord
  K.fin([[-0.72, -4.9, -6.44, 0, 0.07], [0, -4.88, -6.46, 0, 0.08], [1.55, -5.3, -6.36, 0, 0.07]], { y: 0.72, z: 2.88, mirror: true, nk: 4, n: 4, round: [0.3, 0.4], crease: 40, hinge: [0.56] });
  for (const s of [1, -1]) { K.rod([6.4, -0.32, s * 0.12], [7.25, -0.32, s * 0.12], 0.035, DARK); K.rod([-6.2, 0.45, s * 0.08], [-6.9, 0.42, s * 0.08], 0.035, DARK); }
  for (const z of [2.95, -2.95]) K.prop(4.3, 0.38, z, 1.55, 3);
  K.mark('us', 0.5, { hull: fus, x: -2.95, y: 0.22 });
  K.mark('us', 0.6, { wing: w, x: 0.75, z: -6.0 });
  return { span: 17.2, len: 13.4, tail: -6.45, nose: 6.95 };
}

// The DC-3 airframe, shared by the C-47 and the Li-2: a wide round fuselage with a blunt nose, cockpit and cabin
// windows, swept outer wing, radial engines with owner-coloured cowl lips, a tall broad rounded fin on a long dorsal
// fillet. o: paint (a function), stripes (invasion stripes), band (the owner band), turret (a dorsal turret),
// marks(fus, wing, fin).
function dc3(K, o) {
  K.paint = owned(K, o.paint, o.band ?? null);
  // the cockpit glazing on the nose: a windscreen of four panes sloping down ahead of the cabin roof (frames at the
  // centre and between the front and side panes), and a sliding side window behind each side pane
  const wsX = [5.42, 5.98], sideX = [4.78, 5.36], wsT = Math.asin(0.4), sideT = [Math.asin(0.3), Math.asin(0.64)];
  const ring = (a) => Math.min(Math.abs(a - PI / 2), PI);
  const paint = K.paint;
  K.paint = (p, n, i) => {
    if (i.tag === 'fus') {
      const t = i.t, st = Math.sin(t), body = () => paint(p, n, { ...i, t: PI / 2 });
      if (p.x > wsX[0] && p.x < wsX[1] && st > Math.sin(wsT)) {
        const d = ring(t);
        return d < 0.03 || Math.abs(d - 0.62) < 0.035 || Math.abs(p.x - 5.7) < 0.022 && d > 0.62 ? body() : glass(n);
      }
      if (p.x > sideX[0] && p.x < sideX[1] && st > Math.sin(sideT[0]) && st < Math.sin(sideT[1])) return Math.abs(p.x - 5.07) < 0.022 ? body() : glass(n);
    }
    return paint(p, n, i);
  };
  const under = [PI + 0.305, TAU - 0.305], cuts = [...(o.stripes ? [-4.1, -3.68, -3.26, -2.84, -2.42, -2.0] : []), ...(o.band ?? [])];
  const glazing = [wsT, PI - wsT, PI / 2 - 0.03, PI / 2 + 0.03, ...[0.585, 0.655].flatMap((d) => [PI / 2 - d, PI / 2 + d]), ...sideT, PI - sideT[0], PI - sideT[1]];
  // the nose: the cabin roof breaks at the windscreen, which slopes steeply down to a shorter, rounder nose. The
  // nose is a piece of its own so the glazing's paint edges do not run the whole length of the fuselage.
  const keys = [[-6.6, 0.12, 0.2, 0.86], [-6.1, 0.42, 0.6, 0.78], [-5.0, 0.92, 1.12, 0.58], [-3.4, 1.5, 1.66, 0.34], [-1.6, 1.9, 1.98, 0.16], [0.5, 2.0, 2.06, 0.1], [3.5, 2.0, 2.06, 0.1], [4.9, 1.92, 1.98, 0.08], [5.42, 1.8, 1.86, 0.05], [6.0, 1.46, 1.38, -0.06], [6.4, 1.04, 0.96, -0.12], [6.66, 0.6, 0.56, -0.15], [6.8, 0.2, 0.2, -0.15], [6.84, 0.04, 0.04, -0.15]];
  const fus = K.hull(keys, { seg: 22, range: [-6.6, 4.62], cuts, angles: under, caps: [true, false] });
  K.hull(keys, { seg: 22, range: [4.62, 6.84], cuts: [...wsX, 5.678, 5.722, ...sideX, 5.048, 5.092], angles: [...glazing, ...under], caps: [false, true] });
  K.windows(fus, [3.6, 2.8, 2.0, 1.2, 0.4, -0.4, -1.2], 0.42, 0.28, 0.28);
  const wcuts = o.stripes ? [3.4, 3.82, 4.24, 4.66, 5.08, 5.5] : [];
  const w = K.wing([[0, 2.15, -1.05, -0.62, 0.17], [2.5, 2.15, -1.05, -0.62, 0.17], [9.8, 0.4, -0.85, 0.12, 0.1]], { n: 9, round: 0.6, cuts: wcuts, hinge: [0.74, 5.9] });
  K.fairing(fus, w);
  K.hull([[-1.0, 0.04, 0.04, -0.58], [-0.6, 0.34, 0.4, -0.56], [0.3, 0.8, 0.96, -0.5], [1.4, 1.1, 1.3, -0.46], [2.7, 1.26, 1.38, -0.42], [3.6, 1.36, 1.38, -0.4]], { seg: 16, z: 2.5, mirror: true, tag: 'nac', angles: under });
  K.radial({ x: 3.55, y: -0.4, z: 2.5, r: 0.69, len: 0.72, mirror: true, lip: K.own });
  K.wing([[0, -4.8, -6.35, 0.62, 0.1], [3.1, -5.35, -6.2, 0.62, 0.09]], { tag: 'tail', nk: 4, n: 4, round: 0.9, hinge: [0.6] });
  const fin = K.fin([[0, -2.4, -6.66, 0, 0.05], [0.18, -4.0, -6.68, 0, 0.06], [0.4, -4.75, -6.66, 0, 0.08], [0.9, -5.15, -6.6, 0, 0.1], [1.6, -5.45, -6.5, 0, 0.09], [2.05, -5.6, -6.42, 0, 0.09]], { y: 1.05, nk: 4, n: 5, round: 0.55, smooth: true, hinge: [0.62] });
  if (o.turret) {
    // a dorsal gun turret behind the cockpit (Li-2): a glazed dome on a ring, one gun pointing aft
    const ty = fus.top(1.2) - 0.06;
    K.painted(lathe([[0.42, 0], [0.42, 0.05], [0.38, 0.16], [0.28, 0.28], [0.15, 0.36], [0, 0.38]], 12), new THREE.Matrix4().makeTranslation(1.2, ty, 0), 'canopy', (q, n) => glass(n));
    K.add(lathe([[0.46, -0.08], [0.46, 0.06]], 12), new THREE.Matrix4().makeTranslation(1.2, ty, 0), VVS_GREEN);
    K.rod([1.1, ty + 0.2, 0], [0.2, ty + 0.3, 0], 0.035, DARK);
  }
  for (const z of [2.5, -2.5]) K.prop(4.4, -0.4, z, 1.25, 3);
  o.marks(fus, w, fin);
  return { span: 19.6, len: 13.4, tail: -6.6, nose: 6.82 };
}

// C-47 Skytrain: olive drab over grey, invasion stripes on the outer wings and round the rear fuselage (they take the
// place of the owner band). raf: the RAF's Dakota, dark earth and dark green over medium sea grey, type C1 roundels
// on the fuselage over the stripes, type B on both wings and a fin flash.
function c47(K, raf = false) {
  const base = raf ? livery(waves(EARTH, RAF_GREEN, 1.4), MSG, -0.3) : livery(solid(OD), NEUTRAL, -0.3), band = (k) => C(k % 2 ? 0x262522 : 0xc4bfb0);
  return dc3(K, {
    stripes: true,
    paint: (p, n, i) => {
      if (i.tag === 'wing' && Math.abs(p.z) > 3.4 && Math.abs(p.z) < 5.5) return band(Math.floor((Math.abs(p.z) - 3.4) / 0.42));
      if (i.tag === 'fus' && p.x > -4.1 && p.x < -2.0) return band(Math.floor((p.x + 4.1) / 0.42));
      return base(p, n, i);
    },
    marks(fus, w, fin) {
      if (raf) {
        K.mark('raf', 0.5, { hull: fus, x: -3.05, y: 0.32 });
        for (const z of [7.2, -7.2]) K.mark('rafb', 0.62, { wing: w, x: 0.05, z });
        K.mark('flash', 0.3, { fin, x: -5.38, h: 0.7 });
        return;
      }
      K.mark('us', 0.46, { hull: fus, x: -3.05, y: 0.32 });
      K.mark('us', 0.62, { wing: w, x: 0.05, z: -7.4 });
    },
  });
}

// ---------------------------------------------------------------- Germany

// Bf 109 G: slim oval fuselage, a yellow nose band and chin, a black-green spinner with a white spiral, the narrow
// framed canopy, the tailplane up on the fin with struts, shallow radiator baths under the wings ending at the flaps,
// soft-edged RLM 74/75 greys on top and RLM 76 sides mottled with them.
function bf109(K) {
  const top = mottle(RLM75, RLM74, 0.75), side = mottle(RLM76, 0x7f878c, 0.34), yellow = C(YELLOW);
  const base = livery((p, n, i) => (i.t !== undefined && Math.sin(i.t) < 0.35 ? side(p) : top(p)), RLM76, -0.25);
  K.paint = owned(K, (p, n, i) => {
    if ((i.tag === 'fus' && (p.x > 2.85 || (p.x > 2.0 && Math.sin(i.t) < -0.45))) || i.tag === 'chin') return yellow.clone();
    return base(p, n, i);
  }, [-2.35, -2.0], [{ x1: 1.93, y: 0.14, spread: 1.3, h: 0.13 }]);
  const fus = K.hull([[-3.62, 0.04, 0.1, 0.36, 2], [-3.3, 0.18, 0.42, 0.33, 2.2], [-2.6, 0.32, 0.66, 0.25, 2.4], [-1.6, 0.5, 0.9, 0.15, 2.4], [-0.6, 0.64, 1.04, 0.08, 2.4], [0.4, 0.73, 1.1, 0.04, 2.4], [1.3, 0.75, 1.08, 0.0, 2.4], [2.2, 0.74, 1.0, -0.04, 2.4], [2.8, 0.7, 0.86, -0.02, 2.2], [3.2, 0.64, 0.72, 0.0, 2], [3.27, 0.62, 0.68, 0.0, 2]], { seg: 18, sub: 2, cuts: [-2.35, -2.0, 2.0, 2.85], angles: [0.357, PI - 0.357, PI + 0.467, TAU - 0.467] });
  K.canopy(fus, [[1.45, 0.3, 0.02], [1.32, 0.42, 0.24], [1.08, 0.46, 0.31], [0.55, 0.46, 0.32], [0.2, 0.42, 0.27], [0.0, 0.34, 0.16], [-0.15, 0.08, 0.02]], { p: 5, frames: [1.3, 1.06, 0.62, 0.22, 0.0], bars: [PI / 4, (3 * PI) / 4], fw: 0.05, bw: 0.08, seg: 12 });
  const w = K.wing([[0, 1.3, -0.55, -0.34, 0.15], [4.1, 0.75, -0.2, 0.12, 0.1]], { n: 7, round: 0.75, hinge: [0.74, 2.2] });
  K.fairing(fus, w);
  // the radiator baths under the wings: shallow and slab-sided, their flaps flush with the wing's trailing edge
  for (const s of [1, -1]) {
    const yc = w.surf(0.1, 1.45, -1) - 0.05;
    K.hull([[-0.5, 0.36, 0.06, yc + 0.03, 4], [-0.3, 0.42, 0.13, yc, 4], [0.35, 0.42, 0.13, yc, 4], [0.65, 0.34, 0.04, yc + 0.04, 4]], { seg: 8, z: 1.45 * s, tag: 'pod', shadow: false, capColor: [DARK, DARK] });
  }
  K.hull([[1.9, 0.1, 0.06, -0.46], [2.3, 0.34, 0.24, -0.47], [2.9, 0.32, 0.22, -0.42]], { seg: 10, tag: 'chin', capColor: [null, DARK], shadow: false });
  K.hull([[1.7, 0.02, 0.02, 0.0], [1.95, 0.15, 0.15, 0.0], [2.4, 0.17, 0.17, 0.0]], { seg: 8, z: -0.38, tag: 'pod', capColor: [null, DARK], shadow: false });
  // the tailplane sits up on the fin, braced by a strut each side
  K.wing([[0, -2.65, -3.45, 0.72, 0.1], [1.55, -2.95, -3.4, 0.72, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.5, hinge: [0.62] });
  for (const s of [1, -1]) K.rod([-3.0, 0.69, s * 0.55], [-2.9, 0.36, s * 0.12], 0.02, RLM74, 4, null);
  K.fin([[0, -2.55, -3.62, 0, 0.1], [0.35, -2.85, -3.64, 0, 0.1], [0.95, -3.15, -3.62, 0, 0.09]], { y: 0.45, nk: 4, n: 4, round: 0.4, smooth: true, hinge: [0.62] });
  K.stubs(fus, 1.95, 2.8, 0.14, 6);
  K.spinner(3.25, 0.56, 0.32, { color: RLM70, band: K.own, bandWidth: 0.24, front: WHITE, stripe: [0, 0.6], twist: 3 });
  K.prop(3.42, 0, 0, 1.25, 3);
  for (const z of [2.6, -2.6]) K.mark('cross', 0.42, { wing: w, x: 0.4, z });
  K.mark('cross', 0.32, { hull: fus, x: -1.45, y: 0.14 });
  return { span: 8.2, len: 7.45, tail: -3.62, nose: 3.81 };
}

// Ju 87 Stuka: a deep inverted gull wing, the main legs in big streamlined spats with a siren on each, a long framed
// canopy stepped down to the rear gunner, the tall square fin, big chin radiator, a big bomb on its swing crutch
// (belly: aircraft.js adds no second one), RLM 70/71 splinter, a black-green spinner.
function ju87(K) {
  K.paint = owned(K, livery(splinter(RLM70, RLM71, 0.7), RLM65, -0.25), [-3.0, -2.65], [{ x1: 2.9, y: 0.16, spread: 1.6, h: 0.12 }]);
  const fus = K.hull([[-4.45, 0.04, 0.14, 0.42], [-4.0, 0.22, 0.52, 0.38], [-3.0, 0.44, 0.82, 0.28], [-1.8, 0.66, 1.06, 0.18], [-0.6, 0.86, 1.22, 0.1], [0.6, 0.94, 1.3, 0.06], [1.8, 0.94, 1.3, 0.02], [2.9, 0.88, 1.18, 0.0], [3.7, 0.78, 0.98, 0.02], [4.2, 0.66, 0.72, 0.06]], { seg: 16, cuts: [-3.0, -2.65], angles: [PI + 0.253, TAU - 0.253] });
  K.canopy(fus, [[2.05, 0.3, 0.04], [1.9, 0.6, 0.32], [1.6, 0.66, 0.44], [0.5, 0.68, 0.46], [0.25, 0.62, 0.34], [-0.6, 0.56, 0.32], [-0.95, 0.2, 0.08], [-1.1, 0.04, 0.0]], { p: 2.8, frames: [1.75, 1.35, 0.95, 0.55, 0.3, -0.1, -0.5], bars: [0.85, PI - 0.85], seg: 10 });
  const top = fus.top(-0.8);
  K.rod([-0.8, top + 0.22, 0], [-1.6, top + 0.38, 0], 0.035, DARK);
  K.hull([[2.6, 0.2, 0.16, -0.62], [3.0, 0.7, 0.58, -0.64], [3.7, 0.72, 0.6, -0.52], [4.05, 0.64, 0.5, -0.44]], { seg: 12, tag: 'pod', capColor: [null, DARK], shadow: false });
  const w = K.wing([[0, 1.55, -0.65, -0.38, 0.16], [1.95, 1.5, -0.6, -0.92, 0.15], [5.7, 0.95, -0.25, 0.06, 0.1]], { n: 5, round: 0.45, hinge: [0.78] });
  K.fairing(fus, w);
  // the main gear at the bend: a streamlined leg fairing down into a big teardrop spat over the wheel, the bottom of
  // the tyre showing below it, and the siren on the front of the leg
  K.fin([[0, 0.92, 0.18, 0, 0.24], [0.62, 0.8, 0.3, 0, 0.24]], { y: -1.5, z: 1.95, mirror: true, nk: 4, n: 2, round: 0.05, tag: 'leg' });
  K.hull([[-0.6, 0.04, 0.08, -1.78], [-0.3, 0.2, 0.5, -1.78], [0.2, 0.32, 0.74, -1.77], [0.8, 0.32, 0.72, -1.76], [1.25, 0.22, 0.5, -1.74], [1.5, 0.04, 0.1, -1.7]], { seg: 8, z: 1.95, mirror: true, tag: 'leg' });
  K.wheel(0.5, -2.04, 1.95, 0.28, 0.13, true, 8);
  for (const s of [1, -1]) K.spinner(1.0, 0.26, 0.075, { y: -1.25, z: s * 1.95, color: DARK, seg: 6 });
  // dive brakes under the outer wings
  for (const s of [1, -1]) {
    const y = w.surf(1.0, 3.5, -1) - 0.14;
    K.box(1.0, y, s * 3.5, 0.14, 0.03, 1.9, DARK, 0, 0, -s * 0.2);
  }
  // the big bomb low on its crutch, the arms that swing it clear of the propeller
  K.add(bomb(2.2, 0.32, { segments: 8 }), xf(-0.4, -1.3, 0), 0x4a524a);
  for (const s of [1, -1]) K.rod([1.25, -0.6, s * 0.24], [0.75, -0.99, s * 0.07], 0.035, DARK, 6, null);
  K.rod([0.05, -0.6, 0], [0.25, -0.99, 0], 0.035, DARK, 6, null);
  K.wing([[0, -3.25, -4.35, 0.38, 0.1], [2.1, -3.4, -4.3, 0.38, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.2, hinge: [0.6] });
  for (const s of [1, -1]) K.rod([-3.75, 0.32, s * 1.1], [-3.55, 0.05, s * 0.32], 0.03, RLM70, 4, null);
  // the fin: tall and nearly rectangular, its leading edge only a little raked and the top corners rounded
  K.fin([[0, -2.95, -4.45, 0, 0.1], [0.25, -3.2, -4.47, 0, 0.1], [1.45, -3.42, -4.44, 0, 0.09]], { y: 0.55, nk: 4, n: 3, round: 0.16, hinge: [0.6] });
  K.stubs(fus, 2.95, 3.75, 0.16, 5);
  K.spinner(4.18, 0.6, 0.31, { y: 0.06, color: RLM70, band: K.own, bandWidth: 0.24 });
  K.prop(4.36, 0.06, 0, 1.45, 3);
  for (const z of [3.6, -3.6]) K.mark('cross', 0.46, { wing: w, x: 0.55, z });
  K.mark('cross', 0.38, { hull: fus, x: -2.1, y: 0.18 });
  return { span: 11.4, len: 9.2, tail: -4.45, nose: 4.78, belly: true };
}

// He 111 H: the deep fuselage, its blunt rounded nose glazed back to the wing with no step and framed throughout, a
// glazed bathtub gondola under it with a gun to the rear, an elliptical wing with rounded tips, inline engines with
// spiral spinners, a dorsal gun position, a broad rounded fin, splinter camouflage.
function he111(K) {
  const base = livery(splinter(RLM70, RLM71, 0.7), RLM65, -0.3), frameX = [4.75, 5.2, 5.6, 5.95, 6.25, 6.48], bars = [0.5, PI / 2, PI - 0.5, PI + 0.6, TAU - 0.6], dark = C(RLM70);
  const glazed = (p, i) => p.x > 5.2 || (p.x > 4.3 && Math.sin(i.t) > -0.15);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && glazed(p, i)) return frameX.some((x) => Math.abs(p.x - x) < 0.02) || bars.some((a) => Math.abs(i.t - a) < 0.025) ? dark.clone() : glass(n);
    if (i.tag === 'gondola' && p.x < 1.6) return glass(n);
    return base(p, n, { ...i, tag: i.tag === 'gondola' ? 'pod' : i.tag });
  }, [-4.0, -3.5]);
  const keys = [[-6.45, 0.04, 0.08, 0.32], [-6.0, 0.26, 0.42, 0.3], [-4.6, 0.62, 0.92, 0.22], [-2.6, 1.0, 1.4, 0.12], [-0.4, 1.3, 1.78, 0.04], [1.8, 1.44, 1.92, 0.0], [3.6, 1.46, 1.9, 0.0], [4.8, 1.42, 1.76, 0.02], [5.6, 1.3, 1.5, 0.03], [6.15, 1.12, 1.16, 0.04], [6.45, 0.84, 0.84, 0.04], [6.62, 0.5, 0.5, 0.03], [6.68, 0.04, 0.04, 0.03]];
  const under = [PI + 0.305, TAU - 0.305];
  const fus = K.hull(keys, { seg: 18, range: [-6.45, 3.4], cuts: [-4.0, -3.5], angles: under, caps: [true, false] });
  K.hull(keys, { seg: 18, range: [3.4, 6.68], cuts: [4.3, ...frameX.flatMap((x) => [x - 0.02, x + 0.02])], angles: [...under, PI + 0.15, TAU - 0.15, ...bars.flatMap((a) => [a - 0.025, a + 0.025])], caps: [false, true] });
  K.hull([[0.9, 0.08, 0.1, -0.98], [1.15, 0.5, 0.42, -1.04, 3], [2.0, 0.6, 0.54, -1.08, 3], [3.2, 0.56, 0.5, -1.02, 3], [3.8, 0.08, 0.1, -0.86, 3]], { seg: 12, tag: 'gondola', cuts: [1.6], shadow: false });
  K.rod([1.0, -1.1, 0], [0.35, -1.16, 0], 0.035, DARK);
  K.canopy(fus, [[0.4, 0.2, 0.0], [0.2, 0.5, 0.2], [-0.3, 0.56, 0.3], [-0.75, 0.4, 0.2], [-1.0, 0.06, 0.0]], { p: 2.2, frames: [-0.05, -0.5], seg: 10, sink: 0.15, fw: 0.035 });
  K.rod([-0.6, fus.top(-0.6) + 0.22, 0], [-1.5, fus.top(-0.6) + 0.36, 0], 0.035, DARK);
  K.rod([6.6, 0.02, 0], [7.05, 0.0, 0], 0.035, DARK);
  K.windows(fus, [1.7, 1.0], 0.3, 0.22, 0.2);
  const w = K.wing([[0, 2.7, -1.35, -0.25, 0.17], [3.0, 2.6, -1.3, 0.0, 0.16], [5.5, 2.3, -1.05, 0.28, 0.14], [7.5, 1.95, -0.7, 0.45, 0.12], [9.0, 1.6, -0.2, 0.55, 0.1]], { n: 8, round: 1.6, smooth: true, hinge: [0.76, 5.3] });
  K.fairing(fus, w);
  K.hull([[-1.8, 0.04, 0.06, -0.18], [-1.1, 0.42, 0.5, -0.2], [0.4, 0.82, 0.9, -0.22], [2.4, 1.0, 1.1, -0.2], [4.0, 1.04, 1.1, -0.18], [4.85, 0.98, 1.02, -0.16], [5.1, 0.72, 0.74, -0.16]], { seg: 16, z: 3.0, mirror: true, tag: 'nac', angles: under, capColor: [null, DARK] });
  for (const z of [3.0, -3.0]) {
    K.spinner(5.05, 0.62, 0.35, { y: -0.16, z, color: RLM70, band: K.own, front: WHITE, stripe: [0, 0.6], twist: 3.5 });
    K.prop(5.25, -0.16, z, 1.5, 3);
  }
  K.wing([[0, -4.85, -6.35, 0.3, 0.1], [3.4, -5.35, -6.05, 0.3, 0.09]], { tag: 'tail', nk: 4, n: 4, round: 1.2, hinge: [0.62] });
  K.fin([[0, -4.6, -6.5, 0, 0.1], [0.4, -5.0, -6.52, 0, 0.1], [1.7, -5.4, -6.45, 0, 0.09]], { y: 0.55, nk: 4, n: 5, round: 1.0, smooth: true, hinge: [0.6] });
  for (const z of [6.0, -6.0]) K.mark('cross', 0.6, { wing: w, x: 1.25, z });
  K.mark('cross', 0.46, { hull: fus, x: -2.7, y: 0.16 });
  return { span: 18.0, len: 13.1, tail: -6.45, nose: 6.68 };
}

// Ju 52/3m: three radial engines with owner-coloured cowl lips, a boxy fuselage with a row of windows, a framed
// cockpit standing up behind the nose engine, the thick wing with the Junkers flap strip, fixed gear on struts,
// splinter camouflage on corrugated skin.
function ju52(K) {
  K.paint = owned(K, livery(corrugated(RLM70, RLM71, 0.8), corrugated(RLM65, RLM65, 0.8), -0.45), [-3.6, -3.1]);
  const fus = K.hull([[-6.3, 0.12, 0.22, 0.62, 3], [-5.4, 0.42, 0.66, 0.5, 4], [-3.6, 0.88, 1.18, 0.32, 5], [-1.4, 1.22, 1.6, 0.18, 5.5], [1.0, 1.3, 1.72, 0.14, 6], [3.6, 1.3, 1.72, 0.14, 6], [4.6, 1.24, 1.6, 0.1, 5], [5.3, 1.04, 1.18, -0.02, 3.5], [5.7, 0.9, 0.9, -0.06, 2.4]], { seg: 20, cuts: [-3.6, -3.1], angles: [PI + 0.467, TAU - 0.467] });
  // the cockpit: a framed glass house rising from the nose to a little above the cabin roof
  K.canopy(fus, [[5.42, 0.6, -0.04], [5.25, 0.96, 0.2], [5.0, 1.12, 0.26], [4.65, 1.16, 0.2], [4.3, 1.14, 0.1], [4.0, 1.0, 0.0]], { p: 3.2, frames: [5.12, 4.82, 4.45], bars: [PI / 2, 0.75, PI - 0.75], seg: 12, sink: 0.35, fw: 0.04, bw: 0.06 });
  K.windows(fus, [3.4, 2.8, 2.2, 1.6, 1.0, 0.4, -0.2, -0.8], 0.45, 0.3, 0.28);
  K.radial({ x: 5.55, y: -0.06, r: 0.5, len: 0.6, lip: K.own });
  const w = K.wing([[0, 2.1, -1.45, -0.72, 0.17], [3.3, 1.64, -1.11, -0.64, 0.15], [9.7, 0.75, -0.45, 0.2, 0.1]], { n: 9, nk: 6, round: 0.3 });
  K.fairing(fus, w);
  // the Junkers double wing: a separate flap and aileron strip behind the trailing edge, the break between them
  const te = (z) => w.plan(z).te, wy = (z) => w.plan(z).y;
  K.wing([[0.9, te(0.9) - 0.1, te(0.9) - 0.6, wy(0.9) - 0.06, 0.08], [9.2, te(9.2) - 0.08, te(9.2) - 0.45, wy(9.2) - 0.04, 0.08]], { tag: 'wing', nk: 3, n: 4, round: 0.1, shadow: false, hinge: [0.001, 5.6] });
  K.hull([[1.2, 0.04, 0.04, -0.6], [1.8, 0.6, 0.66, -0.62], [3.0, 0.9, 0.92, -0.62], [3.55, 0.94, 0.94, -0.62]], { seg: 14, z: 3.3, mirror: true, tag: 'nac', angles: [PI + 0.467, TAU - 0.467] });
  K.radial({ x: 3.5, y: -0.62, z: 3.3, r: 0.5, len: 0.55, lip: K.own, mirror: true });
  // fixed main gear: wheels on a V of painted struts under the outer engines
  K.wheel(1.9, -1.95, 2.6, 0.42, 0.22);
  for (const s of [1, -1]) {
    const hub = [1.9, -1.95, s * 2.6];
    K.rod(hub, [2.4, w.surf(2.4, 2.9, -1), s * 2.9], 0.05, RLM70, 6, null);
    K.rod(hub, [1.2, w.surf(1.2, 2.9, -1), s * 2.9], 0.05, RLM70, 6, null);
    K.rod(hub, [1.9, fus.bottom(1.9) + 0.1, s * 0.5], 0.045, RLM70, 6, null);
  }
  K.wing([[0, -4.9, -6.2, 0.55, 0.1], [3.0, -5.15, -6.1, 0.55, 0.09]], { tag: 'tail', nk: 4, n: 4, round: 0.2, hinge: [0.6] });
  for (const s of [1, -1]) K.rod([-5.4, 0.5, s * 1.6], [-5.2, 0.05, s * 0.45], 0.03, RLM70, 4, null);
  const fin = K.fin([[0, -4.6, -6.3, 0, 0.1], [0.3, -5.05, -6.32, 0, 0.1], [1.75, -5.55, -6.28, 0, 0.09]], { y: 0.75, nk: 4, n: 4, round: 0.4, hinge: [0.6] });
  K.prop(6.25, -0.06, 0, 1.25, 3);
  for (const z of [3.3, -3.3]) K.prop(4.15, -0.62, z, 1.25, 3);
  for (const z of [6.6, -6.6]) K.mark('cross', 0.6, { wing: w, x: 0.2, z });
  K.mark('cross', 0.46, { hull: fus, x: -1.9, y: 0.2 });
  K.mark('cross', 0.3, { fin, x: -5.7, h: 0.85 });
  return { span: 19.4, len: 12.6, tail: -6.3, nose: 6.3 };
}

// ---------------------------------------------------------------- USSR

// Yak-9: green and black over light blue, a deep nose that drops to a big spinner, a short low teardrop canopy, the
// radiator bath under the wing centre, rounded tips.
function yak9(K) {
  K.paint = owned(K, livery(waves(VVS_GREEN, VVS_BLACK, 0.45), VVS_BLUE, -0.2), [-2.6, -2.25], [{ x1: 2.8, y: 0.12, spread: 1.3, h: 0.12 }]);
  const fus = K.hull([[-3.72, 0.04, 0.1, 0.38], [-3.35, 0.2, 0.44, 0.34], [-2.6, 0.38, 0.7, 0.26], [-1.6, 0.58, 0.95, 0.16], [-0.5, 0.78, 1.1, 0.1], [0.6, 0.88, 1.16, 0.06], [1.6, 0.86, 1.12, 0.04], [2.4, 0.78, 0.98, -0.02], [3.0, 0.68, 0.8, -0.06], [3.3, 0.62, 0.68, -0.08]], { seg: 18, sub: 2, cuts: [-2.6, -2.25], angles: [PI + 0.201, TAU - 0.201] });
  K.canopy(fus, [[1.3, 0.2, 0.02], [1.15, 0.44, 0.22], [0.85, 0.52, 0.31], [0.4, 0.52, 0.32], [-0.05, 0.44, 0.26], [-0.45, 0.24, 0.1], [-0.7, 0.04, 0.0]], { p: 2.2, frames: [1.12, 0.7, 0.3, -0.2], seg: 12 });
  const w = K.wing([[0, 1.3, -0.75, -0.32, 0.15], [4.3, 0.6, -0.3, 0.14, 0.1]], { n: 7, round: 0.65, hinge: [0.75, 2.4] });
  K.fairing(fus, w);
  K.hull([[-1.05, 0.08, 0.04, -0.46], [-0.8, 0.34, 0.2, -0.5], [-0.15, 0.5, 0.38, -0.58], [0.55, 0.46, 0.32, -0.56], [0.75, 0.38, 0.26, -0.52]], { seg: 12, tag: 'pod', capColor: [null, DARK], shadow: false });
  K.wing([[0, -2.8, -3.6, 0.28, 0.1], [1.65, -3.05, -3.5, 0.28, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.55, hinge: [0.62] });
  const fin = K.fin([[0, -2.6, -3.72, 0, 0.1], [0.3, -2.95, -3.74, 0, 0.1], [1.0, -3.3, -3.7, 0, 0.09]], { y: 0.48, nk: 4, n: 4, round: 0.55, smooth: true, hinge: [0.6] });
  K.stubs(fus, 1.95, 2.8, 0.12, 6);
  K.spinner(3.28, 0.62, 0.31, { y: -0.08, color: 0x8f3a2e, band: K.own, bandWidth: 0.24 });
  K.prop(3.45, -0.08, 0, 1.3, 3);
  for (const z of [2.7, -2.7]) K.mark('star', 0.42, { wing: w, x: 0.45, z });
  K.mark('star', 0.3, { hull: fus, x: -1.6, y: 0.16 });
  K.mark('star', 0.24, { fin, x: -3.25, h: 0.5 });
  return { span: 8.6, len: 7.6, tail: -3.72, nose: 3.9 };
}

// Il-2 Sturmovik: the deep flat-sided armoured nose with an intake on top, the radiator scoop under it and exhaust
// stacks, a long canopy stepped down to the rear gunner, a broad centre section and outer panels whose leading edge
// sweeps back while the trailing edge runs straight, gear pods under the wing and small RS-82 rockets on rails.
function il2(K) {
  K.paint = owned(K, livery(waves(VVS_GREEN, VVS_BLACK, 0.55), VVS_BLUE, -0.3), [-3.0, -2.6], [{ x1: 3.65, y: 0.1, spread: 1.6, h: 0.14 }]);
  const fus = K.hull([[-4.55, 0.04, 0.14, 0.4, 2], [-4.1, 0.22, 0.5, 0.36, 2], [-3.0, 0.46, 0.8, 0.26, 2], [-1.6, 0.7, 1.04, 0.16, 2], [-0.3, 0.92, 1.22, 0.1, 2.2], [0.9, 1.0, 1.32, 0.04, 2.8], [2.0, 1.0, 1.36, 0.0, 4], [3.0, 0.92, 1.24, -0.04, 4.5], [3.75, 0.8, 1.02, -0.04, 4], [4.2, 0.62, 0.68, 0.03, 3]], { seg: 20, cuts: [-3.0, -2.6], angles: [PI + 0.305, TAU - 0.305] });
  K.canopy(fus, [[2.2, 0.3, 0.04], [2.05, 0.62, 0.32], [1.7, 0.7, 0.45], [0.95, 0.7, 0.46], [0.6, 0.62, 0.34], [-0.2, 0.56, 0.3], [-0.5, 0.22, 0.1], [-0.65, 0.04, 0.0]], { p: 2.8, frames: [1.95, 1.5, 1.05, 0.62, 0.15], bars: [0.9, PI - 0.9], seg: 12 });
  const top = fus.top(-0.3);
  K.rod([-0.3, top + 0.24, 0], [-1.25, top + 0.36, 0], 0.04, DARK);
  K.rod([-0.25, top - 0.05, 0], [-0.3, top + 0.28, 0], 0.025, DARK);
  // the carburettor intake on top of the nose, the radiator scoop under it
  K.hull([[2.35, 0.06, 0.04, fus.top(2.35) - 0.02], [2.6, 0.24, 0.18, fus.top(2.6) + 0.04], [3.3, 0.26, 0.2, fus.top(3.3) + 0.05], [3.45, 0.26, 0.2, fus.top(3.45) + 0.05]], { seg: 10, tag: 'pod', capColor: [null, DARK], shadow: false });
  const by = fus.bottom(3.0);
  K.hull([[2.0, 0.1, 0.06, by + 0.06], [2.5, 0.5, 0.26, by - 0.02, 3], [3.25, 0.54, 0.28, by + 0.0, 3], [3.5, 0.52, 0.26, by + 0.04, 3]], { seg: 10, tag: 'pod', capColor: [null, DARK], shadow: false });
  const w = K.wing([[0, 1.6, -0.7, -0.36, 0.16], [1.75, 1.6, -0.7, -0.36, 0.16], [5.8, 0.4, -0.55, 0.2, 0.1]], { n: 7, round: 0.6, hinge: [0.74, 3.6] });
  K.fairing(fus, w);
  K.hull([[-0.95, 0.03, 0.03, -0.48], [-0.7, 0.16, 0.16, -0.52], [0.0, 0.4, 0.44, -0.62], [0.9, 0.44, 0.5, -0.66], [1.7, 0.36, 0.4, -0.64], [1.95, 0.04, 0.04, -0.62]], { seg: 12, z: 1.75, mirror: true, tag: 'pod' });
  // RS-82 rockets on rails under the outer wings: slim, grey, tucked behind the leading edge
  const body = tube([[0, 0, 0], [0.62, 0, 0]], 0.055, { radial: 6, caps: false }), nose = lathe([[0.055, 0], [0.04, 0.1], [0, 0.2]], 6, { axis: 'x' });
  for (const s of [1, -1]) for (const rz of [2.45, 2.85, 3.25, 3.65]) {
    const ry = w.surf(0.4, rz, -1) - 0.13;
    K.add(body, xf(0.0, ry, s * rz), 0x5e6158, 'gunmetal');
    K.add(nose, xf(0.62, ry, s * rz), 0x5e6158, 'gunmetal');
    K.box(0.36, ry + 0.07, s * rz, 0.8, 0.05, 0.03, DARK, 0, 0, 0, 'gunmetal');
  }
  K.wing([[0, -3.55, -4.45, 0.3, 0.1], [2.2, -3.85, -4.35, 0.3, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.7, hinge: [0.62] });
  const fin = K.fin([[0, -3.2, -4.55, 0, 0.1], [0.3, -3.6, -4.56, 0, 0.1], [1.2, -4.0, -4.5, 0, 0.09]], { y: 0.5, nk: 4, n: 4, round: 0.55, smooth: true, hinge: [0.6] });
  K.stubs(fus, 2.55, 3.65, 0.1, 6, 0.11);
  K.spinner(4.18, 0.72, 0.31, { y: 0.03, color: DARK, band: K.own, bandWidth: 0.24 });
  K.prop(4.36, 0.03, 0, 1.48, 3);
  for (const z of [3.9, -3.9]) K.mark('star', 0.46, { wing: w, x: 0.45, z });
  K.mark('star', 0.34, { hull: fus, x: -1.95, y: 0.18 });
  K.mark('star', 0.3, { fin, x: -4.0, h: 0.5 });
  return { span: 11.6, len: 9.45, tail: -4.55, nose: 4.9 };
}

// Pe-2: slim fuselage, a deep glazed nose, long canopy, the ventral gunner's step under the rear fuselage, nacelles
// with pointed spinners, small twin D-shaped fins on a dihedral tailplane.
function pe2(K) {
  const base = livery(waves(VVS_GREEN, VVS_BLACK, 1.1), VVS_BLUE, -0.25), frameX = [4.4, 4.7, 4.98, 5.18], bars = [PI / 4, PI / 2, (3 * PI) / 4], green = C(VVS_GREEN);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus' && p.x > 4.14 && Math.sin(i.t) > -0.55) return frameX.some((x) => Math.abs(p.x - x) < 0.02) || bars.some((a) => Math.abs(i.t - a) < 0.025) ? green.clone() : glass(n);
    return base(p, n, i);
  }, [-3.5, -3.1]);
  const keys = [[-5.25, 0.04, 0.1, 0.34], [-4.6, 0.3, 0.44, 0.3], [-3.2, 0.6, 0.78, 0.2], [-1.2, 0.9, 1.08, 0.1], [1.0, 1.06, 1.22, 0.06], [2.8, 1.08, 1.24, 0.04], [3.9, 1.0, 1.1, 0.0], [4.7, 0.78, 0.82, -0.04], [5.15, 0.44, 0.46, -0.06], [5.35, 0.04, 0.04, -0.06]];
  const under = [PI + 0.253, TAU - 0.253], low = [PI + 0.582, TAU - 0.582];
  const fus = K.hull(keys, { seg: 18, range: [-5.25, 4.1], cuts: [-3.5, -3.1], angles: under, caps: [true, false] });
  K.hull(keys, { seg: 18, range: [4.1, 5.35], cuts: [4.14, ...frameX.flatMap((x) => [x - 0.02, x + 0.02])], angles: [...under, ...low, ...bars.flatMap((a) => [a - 0.025, a + 0.025])], caps: [false, true] });
  K.canopy(fus, [[4.0, 0.4, 0.02], [3.8, 0.8, 0.3], [3.4, 0.86, 0.44], [2.4, 0.86, 0.46], [1.6, 0.76, 0.4], [1.2, 0.4, 0.14], [1.0, 0.06, 0.0]], { p: 2.6, frames: [3.55, 3.1, 2.6, 2.1, 1.6], bars: [0.95, PI - 0.95], seg: 12, fw: 0.035 });
  // the ventral gunner's step: a glazed window facing aft and a gun
  const sy = (x, h) => fus.bottom(x) - h / 2 + 0.07;
  K.hull([[-2.1, 0.5, 0.34, sy(-2.1, 0.34)], [-1.9, 0.56, 0.36, sy(-1.9, 0.36)], [-1.0, 0.52, 0.28, sy(-1.0, 0.28)], [-0.7, 0.06, 0.04, sy(-0.7, 0.04)]], { seg: 10, tag: 'pod', capColor: [GLASS, null], shadow: false });
  K.rod([-2.05, sy(-2.1, 0.34), 0], [-2.7, sy(-2.1, 0.34) - 0.06, 0], 0.03, DARK);
  const w = K.wing([[0, 2.15, -0.9, -0.28, 0.16], [2.4, 2.0, -0.85, -0.12, 0.15], [7.2, 0.95, -0.15, 0.32, 0.1]], { n: 8, round: 0.8, hinge: [0.76, 4.6] });
  K.fairing(fus, w);
  K.hull([[-1.8, 0.04, 0.06, -0.1], [-0.9, 0.52, 0.62, -0.16], [0.6, 0.8, 0.94, -0.2], [2.4, 0.88, 1.0, -0.18], [3.7, 0.8, 0.84, -0.14], [4.1, 0.62, 0.62, -0.12]], { seg: 16, z: 2.4, mirror: true, tag: 'nac', angles: under });
  for (const z of [2.4, -2.4]) {
    K.spinner(4.07, 0.62, 0.29, { y: -0.12, z, color: VVS_GREEN, band: K.own, bandWidth: 0.24 });
    K.prop(4.22, -0.12, z, 1.35, 3);
  }
  K.wing([[0, -3.9, -5.2, 0.32, 0.1], [2.75, -4.0, -5.15, 0.7, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.12, hinge: [0.62] });
  // the fins: small ovals with a straight leading edge, standing a little more above the tailplane than below it
  const fin = K.fin([[-0.5, -4.05, -5.2, 0, 0.09], [0.95, -4.25, -5.15, 0, 0.08]], { y: 0.7, z: 2.78, mirror: true, nk: 4, n: 4, round: [0.45, 0.6], pivot: 1, hinge: [0.6] });
  for (const z of [4.9, -4.9]) K.mark('star', 0.52, { wing: w, x: 0.7, z });
  K.mark('star', 0.34, { hull: fus, x: -2.3, y: 0.18 });
  K.mark('star', 0.26, { fin, x: -4.62, h: 0.25, sides: [-1] });
  return { span: 14.4, len: 10.7, tail: -5.25, nose: 5.35 };
}

// Li-2: the Soviet DC-3, green over light blue, red stars, a dorsal gun turret behind the cockpit.
function li2(K) {
  return dc3(K, {
    paint: livery(solid(VVS_GREEN), VVS_BLUE, -0.2),
    band: [-4.3, -3.8],
    turret: true,
    marks(fus, w, fin) {
      K.mark('star', 0.48, { hull: fus, x: -3.0, y: 0.32 });
      for (const z of [7.4, -7.4]) K.mark('star', 0.6, { wing: w, x: 0.1, z });
      K.mark('star', 0.4, { fin, x: -5.9, h: 0.75 });
    },
  });
}

// ---------------------------------------------------------------- UK

// Spitfire Mk IX: the slim oval fuselage behind the long Merlin nose and its chin intake, the elliptical wing with a
// Hispano cannon in each leading edge and a radiator bath under each wing, the framed windscreen, the blown sliding
// hood and the rear glazing behind it, a pointed Sky spinner and four blades. Ocean grey and dark green over medium
// sea grey, the Sky band ahead of the tail, invasion stripes round the rear fuselage (as on the C-47 they take the
// place of the owner band; the owner's colour is on the spinner tip) and across the inner wings.
function spitfire(K) {
  const base = livery(waves(OCEAN, RAF_GREEN, 0.8), MSG, -0.25), fs = [-2.75, 0.22], ws = [1.0, 0.29], fsp = stripes(...fs), wsp = stripes(...ws);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus') { if (p.x > -3.08 && p.x < -2.82) return C(RAF_SKY); const c = fsp(p.x); if (c) return c; }
    if (i.tag === 'wing') { const c = wsp(Math.abs(p.z)); if (c) return c; }
    return base(p, n, i);
  }, null, [{ x1: 3.08, y: 0.13, spread: 1.4, h: 0.12 }]);
  const fus = K.hull([[-3.78, 0.04, 0.12, 0.38, 2], [-3.4, 0.18, 0.46, 0.33, 2.1], [-2.6, 0.34, 0.72, 0.24, 2.2], [-1.6, 0.5, 0.92, 0.16, 2.2], [-0.6, 0.62, 1.04, 0.11, 2.2], [0.3, 0.68, 1.08, 0.08, 2.2], [1.2, 0.7, 1.04, 0.04, 2.2], [2.2, 0.68, 0.94, 0.01, 2.2], [3.0, 0.62, 0.8, 0.0, 2.1], [3.45, 0.58, 0.62, 0.0, 2]], { seg: 16, cuts: [-3.08, -2.82, ...stripeCuts(...fs)], angles: [PI + 0.253, TAU - 0.253] });
  // the windscreen, the blown hood (one frame at its back) and the fixed rear glazing tapering into the spine
  K.canopy(fus, [[0.95, 0.22, 0.02], [0.8, 0.38, 0.17], [0.58, 0.45, 0.25], [0.2, 0.47, 0.29], [-0.2, 0.45, 0.27], [-0.5, 0.37, 0.19], [-0.85, 0.15, 0.06], [-1.0, 0.04, 0.0]], { p: 2.2, frames: [0.6, 0.5, -0.42], bars: [{ a: 0.9, x0: 0.5, x1: 2 }, { a: PI - 0.9, x0: 0.5, x1: 2 }, { a: PI / 2, x0: 0.6, x1: 2 }], seg: 10 });
  // the elliptical wing: the quarter-chord line straight across, the chord falling off as an ellipse to the tip
  const ell = (z) => 2.03 * Math.sqrt(Math.max(0, 1 - (z / 4.5) ** 2)), wk = (z, y, t) => [z, 1.2 + 0.25 * Math.max(ell(z), 0.8), 1.2 - 0.75 * Math.max(ell(z), 0.8), y, t];
  const w = K.wing([wk(0, -0.32, 0.13), wk(2.6, -0.05, 0.115), wk(3.95, 0.1, 0.1), wk(4.5, 0.15, 0.09)], { nk: 5, n: 3, round: 0.75, pivot: 0.72, smooth: true, cuts: stripeCuts(...ws), hinge: [0.78, 2.4] });
  K.fairing(fus, w);
  // the radiator baths: slab-sided, deeper than the Bf 109's, their open fronts and flaps dark
  for (const s of [1, -1]) {
    const yc = w.surf(0.6, 1.25, -1) - 0.1;
    K.hull([[-0.2, 0.36, 0.08, yc + 0.06, 4], [0.05, 0.42, 0.22, yc, 4], [0.95, 0.42, 0.22, yc, 4], [1.25, 0.38, 0.12, yc + 0.05, 4]], { seg: 10, z: 1.25 * s, tag: 'pod', shadow: false, capColor: [DARK, DARK] });
    // the Hispano cannon in its leading-edge fairing, and the two .303 ports outboard of it
    const pl = w.plan(1.75), y = pl.y - 0.02;
    K.rod([pl.le - 0.15, y, s * 1.75], [pl.le + 0.12, y, s * 1.75], 0.055, OCEAN, 8, null);
    K.rod([pl.le, y, s * 1.75], [pl.le + 0.45, y, s * 1.75], 0.026, DARK);
    for (const z of [2.3, 2.55]) { const q = w.plan(z); K.rod([q.le - 0.04, q.y, s * z], [q.le + 0.03, q.y, s * z], 0.014, DARK, 5); }
  }
  // the long carburettor intake under the nose
  K.hull([[1.55, 0.1, 0.05, -0.42], [1.9, 0.26, 0.2, -0.47], [2.95, 0.26, 0.2, -0.44]], { seg: 10, tag: 'pod', capColor: [null, DARK], shadow: false });
  K.wing([[0, -2.72, -3.55, 0.28, 0.1], [0.7, -2.76, -3.5, 0.28, 0.1], [1.3, -2.95, -3.3, 0.28, 0.09]], { tag: 'tail', nk: 4, n: 2, round: 0.4, pivot: 0.65, smooth: true, hinge: [0.62] });
  const fin = K.fin([[0, -2.7, -3.8, 0, 0.1], [0.35, -2.92, -3.84, 0, 0.1], [0.85, -3.18, -3.8, 0, 0.09], [1.15, -3.36, -3.7, 0, 0.09]], { y: 0.42, nk: 4, n: 4, round: 0.55, smooth: true, hinge: [0.55] });
  K.stubs(fus, 2.15, 3.05, 0.13, 6);
  K.spinner(3.43, 0.64, 0.29, { color: RAF_SKY, front: K.own, split: 0.6 });
  K.prop(3.6, 0, 0, 1.31, 4);
  for (const z of [3.0, -3.0]) K.mark('rafb', 0.5, { wing: w, x: 0.82, z });
  K.mark('raf', 0.32, { hull: fus, x: -1.25, y: 0.14 });
  K.mark('flash', 0.18, { fin, x: -3.21, h: 0.3 });
  return { span: 9.0, len: 7.6, tail: -3.78, nose: 4.07 };
}

// Hawker Typhoon Mk IB: the deep fuselage behind the Napier Sabre with its big chin radiator and two rows of stacks
// each side, the thick wing with dihedral outboard of the gear, four long-barrelled Hispanos in fairings, eight RP-3
// rockets on rails under the outer wings, the bubble canopy, a four-blade prop behind a Sky spinner. Ocean grey and
// dark green over medium sea grey, the Sky band, invasion stripes round the rear fuselage and across the wings.
function typhoon(K) {
  const base = livery(waves(OCEAN, RAF_GREEN, 0.85), MSG, -0.3), fs = [-2.95, 0.24], ws = [1.15, 0.31], fsp = stripes(...fs), wsp = stripes(...ws);
  K.paint = owned(K, (p, n, i) => {
    if (i.tag === 'fus') { if (p.x > -3.32 && p.x < -3.05) return C(RAF_SKY); const c = fsp(p.x); if (c) return c; }
    if (i.tag === 'wing') { const c = wsp(Math.abs(p.z)); if (c) return c; }
    return base(p, n, i);
  }, null, [{ x1: 3.15, y: 0.2, spread: 1.6, h: 0.24 }]);
  const fus = K.hull([[-3.95, 0.04, 0.14, 0.42, 2], [-3.5, 0.22, 0.52, 0.38, 2.1], [-2.6, 0.44, 0.84, 0.28, 2.2], [-1.5, 0.66, 1.08, 0.17, 2.3], [-0.4, 0.82, 1.24, 0.1, 2.4], [0.6, 0.9, 1.3, 0.06, 2.5], [1.6, 0.92, 1.28, 0.05, 2.6], [2.5, 0.9, 1.18, 0.06, 2.6], [3.2, 0.82, 1.0, 0.08, 2.3], [3.6, 0.72, 0.76, 0.1, 2]], { seg: 14, cuts: [-3.32, -3.05, ...stripeCuts(...fs)], angles: [PI + 0.305, TAU - 0.305] });
  K.canopy(fus, [[1.05, 0.22, 0.0], [0.92, 0.46, 0.22], [0.7, 0.56, 0.38], [0.3, 0.6, 0.48], [-0.15, 0.56, 0.45], [-0.55, 0.42, 0.28], [-0.9, 0.14, 0.07], [-1.05, 0.04, 0.0]], { p: 2, frames: [0.86], bars: [{ a: 0.95, x0: 0.86, x1: 2 }, { a: PI - 0.95, x0: 0.86, x1: 2 }, { a: PI / 2, x0: 0.86, x1: 2 }], seg: 10 });
  const w = K.wing([[0, 1.42, -0.75, -0.42, 0.19], [1.6, 1.4, -0.72, -0.42, 0.18], [5.05, 0.78, -0.42, -0.08, 0.12]], { nk: 4, n: 4, round: 0.7, cuts: stripeCuts(...ws), hinge: [0.76, 3.1] });
  K.fairing(fus, w);
  // the chin radiator: a deep scoop under the engine, its mouth dark with a splitter down the middle
  K.hull([[1.5, 0.1, 0.06, -0.46], [2.05, 0.62, 0.5, -0.64, 2.4], [2.9, 0.72, 0.68, -0.7, 2.6], [3.45, 0.74, 0.7, -0.64, 2.6]], { seg: 14, tag: 'pod', capColor: [null, DARK] });
  K.box(3.44, -0.64, 0, 0.03, 0.62, 0.04, DARK, 0, 0, 0, 'gunmetal');
  K.stubs(fus, 2.35, 3.0, 0.22, 3, 0.11);
  K.stubs(fus, 2.35, 3.0, 0.02, 3, 0.11);
  const motor = tube([[0, 0, 0], [1.05, 0, 0]], 0.042, { radial: 5, caps: false }), head = lathe([[0.042, 0], [0.075, 0.05], [0.075, 0.17], [0, 0.31]], 5, { axis: 'x' });
  for (const s of [1, -1]) {
    // two Hispanos each side: a long fairing out of the leading edge and the barrel past it
    for (const z of [2.0, 2.42]) {
      const pl = w.plan(z), y = pl.y - 0.03;
      K.rod([pl.le - 0.2, y, s * z], [pl.le + 0.24, y, s * z], 0.06, OCEAN, 6, null);
      K.rod([pl.le + 0.2, y, s * z], [pl.le + 0.75, y, s * z], 0.03, DARK);
    }
    // four RP-3s on their rails: a slim motor and the fat 60 lb head
    for (const rz of [2.95, 3.32, 3.69, 4.06]) {
      const ry = w.surf(0.2, rz, -1) - 0.15, z = s * rz;
      K.box(0.15, ry + 0.085, z, 1.3, 0.035, 0.03, DARK, 0, 0, 0, 'gunmetal');
      K.add(motor, xf(-0.42, ry, z), 0x5e6158, 'gunmetal');
      K.add(head, xf(0.63, ry, z), 0x4f5248, 'gunmetal');
    }
  }
  K.wing([[0, -3.0, -3.85, 0.32, 0.1], [1.8, -3.25, -3.75, 0.32, 0.09]], { tag: 'tail', nk: 4, n: 2, round: 0.5, hinge: [0.62] });
  const fin = K.fin([[0, -2.85, -3.92, 0, 0.1], [0.35, -3.15, -3.96, 0, 0.1], [1.2, -3.45, -3.88, 0, 0.09]], { y: 0.5, nk: 4, n: 4, round: 0.55, smooth: true, hinge: [0.58] });
  K.spinner(3.58, 0.62, 0.36, { y: 0.1, color: RAF_SKY, front: K.own, split: 0.62 });
  K.prop(3.76, 0.1, 0, 1.68, 4);
  for (const z of [3.45, -3.45]) K.mark('rafb', 0.55, { wing: w, x: 0.26, z });
  K.mark('raf', 0.38, { hull: fus, x: -1.3, y: 0.18 });
  K.mark('flash', 0.2, { fin, x: -3.42, h: 0.36 });
  return { span: 10.1, len: 7.9, tail: -3.95, nose: 4.2 };
}

// de Havilland Mosquito FB VI: the slim wooden fuselage with a solid nose (four Brownings on top, four Hispanos
// under the cockpit floor), the side-by-side cockpit under a framed canopy, the wing with the radiator intakes in the
// leading edge between fuselage and nacelles, the long Merlin nacelles running past the trailing edge, pointed
// spinners, the tall rounded fin, a 500 lb bomb under each outer wing. Ocean grey and dark green over medium sea grey.
function mosquito(K) {
  K.paint = owned(K, livery(waves(OCEAN, RAF_GREEN, 1.2), MSG, -0.3), [-3.4, -3.05]);
  const fus = K.hull([[-5.15, 0.04, 0.1, 0.45], [-4.6, 0.24, 0.4, 0.42], [-3.4, 0.5, 0.66, 0.34], [-1.8, 0.78, 0.98, 0.22], [0.0, 0.98, 1.2, 0.1], [1.6, 1.08, 1.3, 0.04], [2.8, 1.1, 1.28, 0.0], [3.8, 1.02, 1.12, -0.06], [4.5, 0.8, 0.84, -0.12], [4.95, 0.5, 0.5, -0.16], [5.12, 0.04, 0.04, -0.18]], { seg: 20, cuts: [-3.4, -3.05], angles: [PI + 0.305, TAU - 0.305] });
  K.canopy(fus, [[4.05, 0.4, 0.02], [3.85, 0.8, 0.24], [3.55, 0.94, 0.36], [3.1, 0.96, 0.38], [2.7, 0.86, 0.32], [2.45, 0.6, 0.16], [2.3, 0.2, 0.02]], { p: 2.6, frames: [3.85, 3.58, 3.15, 2.7], bars: [PI / 2, 0.75, PI - 0.75], seg: 12, fw: 0.04, bw: 0.06 });
  const w = K.wing([[0, 2.05, -1.0, -0.05, 0.15], [6.85, 0.95, -0.15, 0.35, 0.1]], { n: 8, round: 0.55, hinge: [0.76, 4.4] });
  K.fairing(fus, w);
  const nz = 2.1, nac = K.hull([[-1.95, 0.04, 0.06, -0.08], [-1.3, 0.4, 0.5, -0.1], [0.0, 0.8, 1.0, -0.14], [1.6, 0.92, 1.12, -0.14], [3.0, 0.88, 1.02, -0.1], [3.75, 0.7, 0.74, -0.05], [3.95, 0.62, 0.62, -0.05]], { seg: 16, z: nz, mirror: true, tag: 'nac', angles: [PI + 0.305, TAU - 0.305] });
  for (const s of [1, -1]) {
    // six exhaust stubs on each side of each nacelle
    for (const side of [1, -1]) for (let k = 0; k < 6; k++) {
      const x = 2.45 + k * 0.15;
      K.box(x, 0.1, s * (nz + side * (nac.side(x, 0.1) + 0.01)), 0.11, 0.06, 0.07, EXHAUST, 0, -0.5, 0, 'gunmetal');
    }
    // the radiator intake in the leading edge between the fuselage and the nacelle
    const pl = w.plan(1.1);
    K.box(pl.le - 0.03, pl.y + 0.01, s * 1.1, 0.08, 0.07, 0.95, DARK, -s * 0.16, 0, 0, 'plain');
    // a 500 lb bomb on the outer wing
    const sy = w.surf(0.4, 3.5, -1);
    K.add(bomb(1.5, 0.26, { segments: 8 }), xf(-0.35, sy - 0.36, s * 3.5), 0x5c6054);
    K.box(0.4, sy - 0.06, s * 3.5, 0.6, 0.13, 0.05, OCEAN);
    K.spinner(3.93, 0.7, 0.31, { y: -0.05, z: s * nz, color: OCEAN, band: K.own, bandWidth: 0.24 });
    K.prop(4.1, -0.05, s * nz, 1.45, 3);
  }
  // the guns: four Brownings out of the top of the nose, four Hispano barrels under the cockpit floor
  for (const [y, z] of [[0.02, 0.07], [0.02, -0.07], [-0.06, 0.18], [-0.06, -0.18]]) K.rod([4.85, y, z], [5.3, y, z], 0.018, DARK, 5);
  for (const z of [0.12, -0.12, 0.3, -0.3]) { const y = fus.bottom(3.3) + 0.06; K.rod([2.9, y, z], [3.55, y - 0.02, z], 0.03, DARK); }
  K.wing([[0, -4.0, -5.0, 0.32, 0.1], [2.45, -4.3, -4.95, 0.32, 0.09]], { tag: 'tail', nk: 4, n: 3, round: 0.55, hinge: [0.62] });
  const fin = K.fin([[0, -3.3, -5.15, 0, 0.1], [0.35, -3.95, -5.18, 0, 0.1], [1.0, -4.4, -5.12, 0, 0.09], [1.5, -4.65, -5.0, 0, 0.09]], { y: 0.55, nk: 4, n: 5, round: 0.7, smooth: true, hinge: [0.6] });
  K.mark('raf', 0.36, { hull: fus, x: -2.15, y: 0.26 });
  for (const z of [4.6, -4.6]) K.mark('rafb', 0.6, { wing: w, x: 0.42, z });
  K.mark('flash', 0.24, { fin, x: -4.33, h: 0.45 });
  return { span: 13.7, len: 10.3, tail: -5.15, nose: 5.3 };
}

// ---------------------------------------------------------------- the module

const BUILD = [
  { fighter: p51, attacker: p47, bomber: b25, transport: c47 },
  { fighter: bf109, attacker: ju87, bomber: he111, transport: ju52 },
  { fighter: yak9, attacker: il2, bomber: pe2, transport: li2 },
  { fighter: spitfire, attacker: typhoon, bomber: mosquito, transport: (K) => c47(K, true) },
];
export const PLANE_NAMES = [
  { fighter: 'P-51D Mustang', attacker: 'P-47D Thunderbolt', bomber: 'B-25J Mitchell', transport: 'C-47 Skytrain' },
  { fighter: 'Bf 109 G', attacker: 'Ju 87 Stuka', bomber: 'He 111 H', transport: 'Ju 52/3m' },
  { fighter: 'Yak-9', attacker: 'Il-2 Sturmovik', bomber: 'Pe-2', transport: 'Li-2' },
  { fighter: 'Spitfire Mk IX', attacker: 'Typhoon Mk IB', bomber: 'Mosquito FB VI', transport: 'Dakota III' },
];
export const ROLES = ['fighter', 'attacker', 'bomber', 'transport'];

// One plane for a faction (0 USA, 1 Germany, 2 USSR, 3 UK), a role (fighter, attacker, bomber, transport) and the owner's
// colour: { geo, props: [{x, y, z, r, n}], polys: shadow outlines [[x, z], ...], span, len, tail, nose, belly, blade
// and tip (the propeller blade and tip colours), metal (bare metal: aircraft.js gives it a shinier material) }. geo
// carries the `camo` and `hinge` attributes for paintMaterial() and `matId` for the model textures.
export function plane(fac, role, own = 0xffffff) {
  const set = BUILD[fac] ?? BUILD[0], make = set[role] ?? set.fighter, K = kit(own), spec = make(K);
  const g = join(K.parts), box = new THREE.Box3().setFromBufferAttribute(g.attributes.position), y0 = box.min.y, H = Math.max(0.5, box.max.y - y0);
  // a little ambient occlusion low on the plane (under the wings, round the gear), while the belly itself (facing
  // down) is spared most of it so the underside colour stays light
  const geo = ao(g, { falloff: (p, n) => { const d = Math.max(0, -n.y), h = 0.9 + 0.1 * sstep(0, 0.6 * H, p.y - y0); return (h + (1 - h) * 0.6 * d) * (1 - 0.06 * d); } });
  geo.computeBoundingSphere();
  return { geo, props: K.props, polys: K.polys, belly: false, blade: BLADE[fac] ?? BLADE[0], tip: PROP_TIPS[fac] ?? PROP_TIPS[0], metal: false, ...spec };
}
