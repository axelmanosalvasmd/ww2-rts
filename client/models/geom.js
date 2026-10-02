// Geometry kit for detailed procedural miniatures: soft-edged plates and crates, lofted hulls and fuselages,
// lathed barrels, helmets, wheels and engines, side profiles, tracks, tubes, markings and a cheap contact shadow.
//
// Every function is pure: it builds a new BufferGeometry (or a Matrix4) and leaves its inputs alone.
// Shapes carry position and normal. The painted ones (wheel, roadWheels, sprocket, track, engine, the markings,
// merge and ao) also carry a linear 'color' attribute. mergeParts in client/unit-models.js multiplies a part's
// paint with that attribute, so a painted shape goes into part() with white (0xffffff) to keep its own colors,
// or with a paint to tint it. Plain shapes take their paint from part() like the built-in boxes.
// What a part is made of (painted armor, rubber, wood...) rides along the same way in a 'matId' attribute: see
// MATS below. wheel() and track() tag their rubber and track links themselves.
// Axes follow the unit models: +x forward, +y up. Only 'three' is imported, so the browser and the Node tests
// load this file the same way.
import * as THREE from 'three';

// ---------------------------------------------------------------- materials

// What a part is made of, for the model textures (client/model-textures.js): one layer of the texture array each,
// in this order. 'plain' takes no texture (faces, glass); a part with no material takes the model's default
// (painted armor on vehicles and guns, wool on soldiers, aircraft paint on planes).
// The per-vertex 'matId' attribute holds the index here, PLAIN or UNSET. merge() items take `mat` (a name) for
// the vertices their shape left UNSET, so a wheel keeps its rubber tire whatever its disc is made of; tag() sets
// every vertex. mergeParts in client/unit-models.js works the same way with part(..., mat).
export const MATS = ['armor-paint', 'cast-armor', 'gunmetal', 'track-steel', 'rubber', 'wood', 'canvas', 'wool', 'leather', 'aluminum', 'aircraft-paint', 'mud'];
export const PLAIN = -1, UNSET = -2;
// the id of a material name (null or undefined: UNSET); unknown names throw, so a typo shows up at once
export function matId(name) {
  if (name == null) return UNSET;
  if (name === 'plain') return PLAIN;
  const i = MATS.indexOf(name);
  if (i < 0) throw new Error(`unknown model material "${name}" (plain or one of ${MATS.join(', ')})`);
  return i;
}
// A copy of geo made entirely of material `mat` (a MATS name or 'plain').
export function tag(geo, mat) {
  const g = geo.clone();
  g.setAttribute('matId', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(matId(mat)), 1));
  return g;
}
// a vertex's material id with any baked grime (the fraction mergeParts adds) dropped
export const baseMat = (v) => Math.floor(v + 0.25);

const TAU = Math.PI * 2;
const v3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const v2 = (p) => (p.isVector2 ? p.clone() : new THREE.Vector2(p[0], p[1]));
const tint = (c) => (c && c.isColor ? c.clone() : new THREE.Color(c ?? 0xffffff));
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
// signed area of a 2D loop given as [a, b] pairs; positive when counter-clockwise
function area2(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
// points of a circle (or a regular polygon), counter-clockwise from angle a0
const circle = (r, n = 32, a0 = 0) => Array.from({ length: n }, (_, k) => [r * Math.cos(a0 + (k / n) * TAU), r * Math.sin(a0 + (k / n) * TAU)]);

// Matrix from a position, an XYZ Euler rotation in radians and a scale (one number scales evenly).
export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

// Indexed triangle builder: v() adds a vertex (optional normal, color and material id), tri() and quad() take
// corners in counter-clockwise order seen from outside.
function builder() {
  const pos = [], nor = [], col = [], mat = [], idx = [];
  return {
    v(x, y, z, n, c, m) { pos.push(x, y, z); if (n) nor.push(n.x, n.y, n.z); if (c) col.push(c.r, c.g, c.b); if (m !== undefined) mat.push(m); return pos.length / 3 - 1; },
    tri(a, b, c) { idx.push(a, b, c); },
    quad(a, b, c, d) { idx.push(a, b, c, a, c, d); },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (nor.length === pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      if (col.length === pos.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (mat.length * 3 === pos.length) g.setAttribute('matId', new THREE.Float32BufferAttribute(mat, 1));
      g.setIndex(idx);
      return g;
    },
  };
}

// Rebuild normals with a crease angle: faces that meet at less than `angle` degrees shade smoothly, sharper
// edges stay hard. Vertices at the same spot are welded first, so lathe seams and extrude walls shade as one
// surface. Degenerate triangles (lathe tips) are dropped. Keeps vertex colors and material ids, drops uv.
// 1 gives flat faces, 180 smooths everything.
export function crease(geo, angle = 40) {
  const P = geo.attributes.position, C = geo.attributes.color, M = geo.attributes.matId, I = geo.index, q = 1e5;
  const ids = new Map(), pid = new Int32Array(P.count), wp = [];
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = ids.get(k);
    if (id === undefined) { id = wp.length; ids.set(k, id); wp.push(new THREE.Vector3(x, y, z)); }
    pid[i] = id;
  }
  const n = I ? I.count : P.count, faces = [], around = wp.map(() => []);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const corner = (a, b, c) => { e1.subVectors(b, a).normalize(); e2.subVectors(c, a).normalize(); return Math.acos(Math.min(1, Math.max(-1, e1.dot(e2)))); };
  for (let i = 0; i + 2 < n; i += 3) {
    const s = I ? [I.getX(i), I.getX(i + 1), I.getX(i + 2)] : [i, i + 1, i + 2], p = s.map((k) => pid[k]);
    if (p[0] === p[1] || p[1] === p[2] || p[0] === p[2]) continue;
    const [a, b, c] = p.map((k) => wp[k]), nrm = new THREE.Vector3().subVectors(b, a).cross(e2.subVectors(c, a));
    const len = nrm.length();
    if (len < 1e-15) continue;
    const f = faces.length;
    faces.push({ s, p, n: nrm.divideScalar(len), w: [corner(a, b, c), corner(b, c, a), corner(c, a, b)] });
    for (let k = 0; k < 3; k++) around[p[k]].push(f, k);
  }
  const cos = Math.cos((angle * Math.PI) / 180) - 1e-6, out = builder(), seen = new Map(), sum = new THREE.Vector3(), col = new THREE.Color();
  const idx = [];
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      sum.set(0, 0, 0);
      const list = around[f.p[k]];
      for (let j = 0; j < list.length; j += 2) { const g = faces[list[j]]; if (g.n.dot(f.n) >= cos) sum.addScaledVector(g.n, g.w[list[j + 1]]); }
      if (sum.lengthSq() < 1e-24) sum.copy(f.n); else sum.normalize();
      if (C) col.setRGB(C.getX(f.s[k]), C.getY(f.s[k]), C.getZ(f.s[k]));
      const m = M ? M.getX(f.s[k]) : undefined;
      const key = `${f.p[k]}|${Math.round(sum.x * 1e3)},${Math.round(sum.y * 1e3)},${Math.round(sum.z * 1e3)}` + (C ? `|${Math.round(col.r * 1e3)},${Math.round(col.g * 1e3)},${Math.round(col.b * 1e3)}` : '') + (M ? `|${m}` : '');
      let v = seen.get(key);
      if (v === undefined) { const w = wp[f.p[k]]; v = out.v(w.x, w.y, w.z, sum, C ? col : null, m); seen.set(key, v); }
      idx.push(v);
    }
  }
  for (let i = 0; i < idx.length; i += 3) out.tri(idx[i], idx[i + 1], idx[i + 2]);
  return out.geometry();
}

// Join geometries ({geo, matrix or m, color, mat} or bare geometries) into one indexed geometry: transforms baked
// in, normals through the normal matrix, winding flipped for mirrored transforms. With `colored`, each vertex gets
// the item color (default white) times the geometry's own color, and a material id: the geometry's own, or the
// item's `mat` where it has none (UNSET without either).
function combine(items, colored) {
  const parts = items.map((it) => (it.isBufferGeometry ? { geo: it } : it)).map((p) => {
    if (p.geo.attributes.normal) return p;
    const geo = p.geo.clone(); geo.computeVertexNormals();
    return { ...p, geo };
  });
  let nv = 0, ni = 0;
  for (const { geo } of parts) { const c = geo.attributes.position.count; nv += c; ni += geo.index ? geo.index.count : c; }
  const tagged = colored || parts.some((p) => p.mat != null || p.geo.attributes.matId);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = colored ? new Float32Array(nv * 3) : null, mat = tagged ? new Float32Array(nv) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), nm = new THREE.Matrix3(), t = new THREE.Vector3(), c = new THREE.Color(), one = new THREE.Matrix4();
  let vo = 0, io = 0;
  for (const p of parts) {
    const m = p.matrix ?? p.m ?? one, P = p.geo.attributes.position, N = p.geo.attributes.normal, C = p.geo.attributes.color, I = p.geo.index, base = tint(p.color);
    const M = p.geo.attributes.matId, fill = matId(p.mat);
    nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      t.fromBufferAttribute(P, i).applyMatrix4(m).toArray(pos, (vo + i) * 3);
      t.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
      if (col) { c.copy(base); if (C) { c.r *= C.getX(i); c.g *= C.getY(i); c.b *= C.getZ(i); } c.toArray(col, (vo + i) * 3); }
      if (mat) { const own = M ? M.getX(i) : UNSET; mat[vo + i] = baseMat(own) === UNSET ? fill : own; }
    }
    const flip = m.determinant() < 0, n = I ? I.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, d = I ? I.getX(i + 2) : i + 2;
      idx[io++] = vo + a; idx[io++] = vo + (flip ? d : b); idx[io++] = vo + (flip ? b : d);
    }
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (mat) g.setAttribute('matId', new THREE.BufferAttribute(mat, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// Many parts as one vertex-colored geometry: [{geo, color, matrix, mat}] like mergeParts(parts, true) takes, where
// color is a number, string or THREE.Color (default white) and multiplies the geometry's own colors, and mat (a MATS
// name or 'plain') is what the part is made of where its shape does not say. `m` works for `matrix`, and a bare
// geometry counts as an untransformed white part.
export function merge(list) { return combine(list, true); }

// A geometry plus its mirror image across z = 0: build one side at z >= 0 and get both. Colors are kept.
export function mirrorZ(geo) {
  return combine([{ geo }, { geo, matrix: new THREE.Matrix4().makeScale(1, 1, -1) }], !!geo.attributes.color);
}

// ---------------------------------------------------------------- boxes

// Box with rounded edges and corners of radius `bevel` (armor plates, crates, hull blocks). `segments` is the
// number of steps around each rounded edge (rounded up to even). Smooth normals, uv kept.
export function bevelBox(w = 1, h = 1, d = 1, bevel = 0.05, segments = 2) {
  const half = [w / 2, h / 2, d / 2], r = Math.max(0, Math.min(bevel, ...half));
  if (r <= 0) return new THREE.BoxGeometry(w, h, d);
  // a unit box whose middle segment is the flat face and whose outer segments bend around the edge
  const s = Math.max(1, Math.ceil(segments / 2)), n = 2 * s + 1, hs = 0.5 / n, span = s / n;
  const box = new THREE.BoxGeometry(1, 1, 1, n, n, n), P = box.attributes.position, N = box.attributes.normal;
  const u = [0, 0, 0], sg = [0, 0, 0], nn = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    const v = [P.getX(i), P.getY(i), P.getZ(i)];
    for (let k = 0; k < 3; k++) { sg[k] = v[k] < 0 ? -1 : 1; u[k] = Math.min(1, Math.max(0, (Math.abs(v[k]) - hs) / span)); }
    nn.set(sg[0] * Math.tan((u[0] * Math.PI) / 4), sg[1] * Math.tan((u[1] * Math.PI) / 4), sg[2] * Math.tan((u[2] * Math.PI) / 4)).normalize();
    P.setXYZ(i, sg[0] * (half[0] - r) + nn.x * r, sg[1] * (half[1] - r) + nn.y * r, sg[2] * (half[2] - r) + nn.z * r);
    N.setXYZ(i, nn.x, nn.y, nn.z);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(box.index);
  for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, box.attributes[k]);
  return g;
}

// Box with every edge and corner cut flat at 45 degrees, `c` deep: the cheap soft edge (link plates, ammo boxes,
// jerrycans). Flat normals.
export function chamferBox(w = 1, h = 1, d = 1, c = 0.05) {
  const H = [w / 2, h / 2, d / 2], k = Math.max(0, Math.min(c, ...H));
  if (k <= 0) return new THREE.BoxGeometry(w, h, d);
  // the point a corner (signs s) leaves on the face of axis a
  const cut = (s, a) => new THREE.Vector3(...H.map((hv, i) => s[i] * (i === a ? hv : hv - k)));
  const b = builder(), signs = [-1, 1];
  // a flat convex face: corners sorted counter-clockwise around its outward normal, then a fan
  const face = (pts, dir) => {
    const nrm = new THREE.Vector3(...dir).normalize(), mid = pts.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const ax = Math.abs(nrm.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), u = ax.cross(nrm).normalize(), v = new THREE.Vector3().crossVectors(nrm, u);
    const at = (p) => { const r = p.clone().sub(mid); return Math.atan2(r.dot(v), r.dot(u)); };
    const ids = [...pts].sort((p, q) => at(p) - at(q)).map((p) => b.v(p.x, p.y, p.z, nrm));
    for (let i = 1; i + 1 < ids.length; i++) b.tri(ids[0], ids[i], ids[i + 1]);
  };
  for (let a = 0; a < 3; a++) {
    const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
    for (const sa of signs) {
      const s = [0, 0, 0]; s[a] = sa;
      face(signs.flatMap((s1) => signs.map((s2) => { s[a1] = s1; s[a2] = s2; return cut(s, a); })), [a === 0 ? sa : 0, a === 1 ? sa : 0, a === 2 ? sa : 0]);
      for (const sb of signs) { // the edge between faces a and a1, running along a2
        const e = [0, 0, 0]; e[a] = sa; e[a1] = sb;
        face(signs.flatMap((s2) => { e[a2] = s2; return [cut(e, a), cut(e, a1)]; }), e.map((x, i) => (i === a2 ? 0 : x)));
      }
    }
  }
  for (const sx of signs) for (const sy of signs) for (const sz of signs) { const s = [sx, sy, sz]; face([cut(s, 0), cut(s, 1), cut(s, 2)], s); }
  return b.geometry();
}

// ---------------------------------------------------------------- lofted hulls

// even-spaced resample of a closed 2D loop, starting at its first point
function resample(pts, count) {
  const len = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const out = [], total = len[pts.length];
  for (let k = 0, i = 0; k < count; k++) {
    const s = (k / count) * total;
    while (len[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length], t = (s - len[i]) / Math.max(1e-12, len[i + 1] - len[i]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
// one loft ring as 3D points at its x: a superellipse {w, h, p} or a polygon {pts: [[z, y], ...]}, both moved by
// the ring's {y, z} center and turned counter-clockwise in (z, y)
function ring(s, count) {
  let pts;
  if (s.pts) {
    pts = s.pts.map(([z, y]) => [z, y]);
    if (area2(pts) < 0) pts = [pts[0], ...pts.slice(1).reverse()];
    if (pts.length !== count) pts = resample(pts, count);
  } else {
    const e = 2 / (s.p ?? 2), hw = (s.w ?? 0) / 2, hh = (s.h ?? s.w ?? 0) / 2;
    pts = Array.from({ length: count }, (_, j) => {
      const t = (j / count) * TAU, c = Math.cos(t), sn = Math.sin(t);
      return [hw * Math.sign(c) * Math.abs(c) ** e, hh * Math.sign(sn) * Math.abs(sn) ** e];
    });
  }
  return pts.map(([z, y]) => new THREE.Vector3(s.x, (s.y ?? 0) + y, (s.z ?? 0) + z));
}

// A closed hull or fuselage along +x from cross-section rings. Each section is {x, w, h, y, z, p} (a superellipse
// w wide in z and h tall in y around (y, z); p = 2 is an ellipse, 4 a rounded box, 1 a diamond) or
// {x, pts: [[z, y], ...], y, z} (a polygon). Ellipse rings start at +z and turn toward +y, so polygons should start
// on the +z side too; polygon rings all need the same point count, the ellipses use it. A ring of size 0 makes a
// pointed tip. The ends get flat caps (caps: false leaves them open). normals: a crease angle in degrees, 'flat'
// or 'smooth'.
export function loft(sections, { segments = 16, normals = 40, caps = true } = {}) {
  const secs = [...sections];
  if (secs.length > 1 && secs[secs.length - 1].x < secs[0].x) secs.reverse();
  const poly = secs.find((s) => s.pts), count = poly ? poly.pts.length : segments, rings = secs.map((s) => ring(s, count));
  const tip = (r) => r.every((p) => p.distanceToSquared(r[0]) < 1e-18);
  const b = builder();
  rings.forEach((r) => r.forEach((p) => b.v(p.x, p.y, p.z)));
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < count; j++) { const j1 = (j + 1) % count; b.quad(i * count + j, (i + 1) * count + j, (i + 1) * count + j1, i * count + j1); }
  }
  const angle = normals === 'flat' ? 1 : normals === 'smooth' ? 180 : normals, parts = [crease(b.geometry(), angle)];
  if (caps) {
    const cap = builder();
    for (const [r, dir] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
      if (tip(r)) continue;
      const n = new THREE.Vector3(dir, 0, 0), ids = r.map((p) => cap.v(p.x, p.y, p.z, n));
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(r.map((p) => new THREE.Vector2(p.z, p.y)), [])) {
        const fx = new THREE.Vector3().subVectors(r[j], r[i]).cross(new THREE.Vector3().subVectors(r[k], r[i])).x;
        if (fx * dir >= 0) cap.tri(ids[i], ids[j], ids[k]); else cap.tri(ids[i], ids[k], ids[j]);
      }
    }
    parts.push(cap.geometry());
  }
  return combine(parts, false);
}

// ---------------------------------------------------------------- lathed parts

// A solid of revolution from a profile of [radius, height] points, turned `segments` times around the axis
// ('y' by default, 'x' or 'z' to lie along those). Points on the axis (radius 0) close the ends; a profile whose
// last point equals its first makes a ring (tires, cowls). The profile may run either way: it is turned so faces
// point outward. Faces meeting at more than `crease` degrees stay hard.
export function lathe(profile, segments = 16, { axis = 'y', crease: angle = 50, phiStart = 0, phiLength = TAU } = {}) {
  let pts = profile.map(([r, y]) => [Math.max(0, r), y]);
  if (area2([...pts, [0, pts[pts.length - 1][1]], [0, pts[0][1]]]) < 0) pts = pts.reverse();
  const raw = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength);
  raw.deleteAttribute('uv');
  const g = crease(raw, angle);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

// A gun barrel along +x from the breech (x = 0) to the muzzle (x = length): a breech collar, a taper, a hollow
// muzzle and an optional muzzle brake (true or a number of chambers).
export function barrel(length = 1, radius = 0.05, { brake = false, taper = 0.12, bore = 0.55, segments = 12 } = {}) {
  const L = length, r0 = radius, rt = radius * (1 - taper), rb = rt * bore, deep = Math.min(L * 0.25, rt * 4);
  const p = [[0, 0], [r0 * 1.12, 0], [r0 * 1.12, r0 * 0.6], [r0, r0 * 0.9]];
  if (brake) {
    const n = brake === true ? 2 : Math.max(1, Math.round(brake)), bl = Math.min(L * 0.3, rt * (2 + 1.5 * n)), br = rt * 1.75, y0 = L - bl;
    p.push([rt, y0 - rt * 0.4], [br, y0]);
    for (let k = 1; k < n; k++) { const y = y0 + (bl * k) / n; p.push([br, y - bl * 0.07], [rt * 1.15, y - bl * 0.05], [rt * 1.15, y + bl * 0.05], [br, y + bl * 0.07]); }
    p.push([br, L]);
  } else p.push([rt, L - rt * 0.8], [rt * 1.14, L - rt * 0.7], [rt * 1.14, L]);
  p.push([rb, L], [rb, L - deep], [0, L - deep]);
  return lathe(p, segments, { axis: 'x' });
}

// quarter-ellipse dome from its rim (radius r at height y0) to its top (y0 + top), walking upward
const dome = (r, y0, top, from = Math.PI / 2, steps = 6) => Array.from({ length: steps + 1 }, (_, k) => { const t = from * (1 - k / steps); return [r * Math.sin(t), y0 + top * Math.cos(t)]; });

// A helmet sitting on y = 0, about `size` in radius: 'm1' (US, round with a small brim), 'stahlhelm' (German,
// flared skirt and a stepped dome, longer front to back), 'ssh40' (Soviet, tall dome with a slight flare) or
// 'brodie' (British Mk II: a shallow bowl on a wide, flat brim).
export function helmet(kind = 'm1', size = 0.27, segments = 16) {
  const R = size;
  if (kind === 'brodie') return lathe([[0, 0.02], [1.42, -0.04], [1.44, 0], [1.38, 0.03], [0.95, 0.08], ...dome(0.95, 0.1, 0.62, 1.4)].map(([r, y]) => [r * R, y * R]), segments);
  if (kind === 'stahlhelm') {
    const raw = new THREE.LatheGeometry([[0, 0.1], [1.12, -0.1], [1.14, -0.05], [1.0, 0.12], [0.93, 0.22], ...dome(0.95, 0.28, 0.72, 1.35)]
      .map(([r, y]) => new THREE.Vector2(r * R, y * R)), segments);
    raw.deleteAttribute('uv');
    // the visor at the front sits higher than the skirt over the ears and neck
    const P = raw.attributes.position;
    for (let i = 0; i < P.count; i++) if (P.getY(i) < 0) { const f = Math.max(0, P.getX(i) / (1.14 * R)); P.setY(i, P.getY(i) + 0.14 * R * f * f); }
    raw.scale(1.08, 1, 0.97);
    return crease(raw, 50);
  }
  const prof = kind === 'ssh40'
    ? [[0, 0], [1.06, -0.04], [1.07, 0], [1.0, 0.08], ...dome(1.0, 0.06, 0.95, 1.5)]
    : [[0, -0.02], [1.13, -0.06], [1.15, -0.02], [1.0, 0.06], ...dome(1.0, 0.05, 0.88, 1.45)];
  return lathe(prof.map(([r, y]) => [r * R, y * R]), segments);
}

// An aircraft bomb along +x: tail at x = 0, nose at x = length, with `fins` tail fins.
export function bomb(length = 1, radius = 0.12, { fins = 4, segments = 12 } = {}) {
  const L = length, r = radius, nose = Array.from({ length: 5 }, (_, k) => { const t = (k + 1) / 5; return [r * Math.sqrt(1 - t * t), 0.62 * L + 0.38 * L * t]; });
  const body = lathe([[0, 0], [r * 0.4, 0], [r, 0.32 * L], [r, 0.62 * L], ...nose], segments, { axis: 'x' });
  const fin = new THREE.BoxGeometry(0.3 * L, r * 0.06, r * 1.05), parts = [body];
  for (let k = 0; k < fins; k++) {
    const a = Math.PI / 4 + (k / fins) * TAU;
    parts.push({ geo: fin, matrix: new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0.15 * L, 0, r * 0.72)) });
  }
  return combine(parts, false);
}

// A propeller spinner along +x: base at x = 0, a pointed tip at x = length.
export function spinner(length = 0.4, radius = 0.15, segments = 14) {
  const tip = Array.from({ length: 6 }, (_, k) => { const t = (k + 1) / 6; return [radius * (1 - t * t), 0.12 * length + 0.88 * length * t]; });
  return lathe([[0, 0], [radius, 0], [radius, 0.12 * length], ...tip], segments, { axis: 'x', crease: 60 });
}

// A radial engine in its cowling along +x, the open front at x = length: a cowl ring in `color`, a dark recessed
// face with a crankcase dome and `cylinders` finned cylinder heads.
export function engine(length = 0.5, radius = 0.4, { cylinders = 9, color = 0xffffff, face = 0x2a2926, heads = 0x5a5850, segments = 20 } = {}) {
  const L = length, R = radius, ri = 0.8 * R;
  const cowl = lathe([[0.95 * R, 0], [R, 0.15 * L], [R, 0.85 * L], [0.97 * R, 0.97 * L], [0.9 * R, L], [ri * 1.02, 0.99 * L], [ri, 0.92 * L], [ri, 0], [0.95 * R, 0]], segments, { axis: 'x' });
  const front = lathe([[0, 0.1 * L], [ri * 0.98, 0.1 * L], [ri * 0.98, 0.6 * L], [0.3 * R, 0.64 * L], ...dome(0.3 * R, 0.64 * L, 0.18 * L, Math.PI / 2, 4)], segments, { axis: 'x' });
  // one finned cylinder along +y, then turned out radially
  const fin = [], h = 0.4 * R, rc = 0.085 * R;
  for (let k = 0; k <= 3; k++) { const y = 0.32 * R + (h * k) / 3; fin.push([rc, y - h * 0.06], [rc * 1.4, y - h * 0.04], [rc * 1.4, y + h * 0.04], [rc, y + h * 0.06]); }
  const head = lathe([[0, 0.3 * R], ...fin, [0, 0.32 * R + h + 0.06 * h]], 6, { crease: 70 }), parts = [{ geo: cowl, color }, { geo: front, color: face, mat: 'gunmetal' }];
  for (let k = 0; k < cylinders; k++) parts.push({ geo: head, color: heads, mat: 'gunmetal', matrix: new THREE.Matrix4().makeTranslation(0.62 * L, 0, 0).multiply(new THREE.Matrix4().makeRotationX((k / cylinders) * TAU)) });
  return combine(parts, true);
}

// ---------------------------------------------------------------- extruded profiles

// A flat side profile ([[x, y], ...], any winding) pushed out `depth` along z and centered on z = 0, the front and
// back edges rounded by `bevel` while the outline stays exactly on the points (tank hull sides, gun shields,
// tails, fins). holes: inner outlines cut through.
export function extrudeProfile(points, depth = 0.1, bevel = 0, { holes = [], segments = 3, crease: angle = 35 } = {}) {
  const b = Math.max(0, Math.min(bevel, depth / 2)), shape = new THREE.Shape(points.map(v2));
  shape.holes = holes.map((h) => new THREE.Path(h.map(v2)));
  const inner = depth - 2 * b;
  const g = new THREE.ExtrudeGeometry(shape, b > 0
    ? { depth: inner, curveSegments: 1, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: segments }
    : { depth, curveSegments: 1, bevelEnabled: false });
  g.translate(0, 0, -inner / 2);
  g.deleteAttribute('uv');
  return crease(g, angle);
}

// ---------------------------------------------------------------- wheels and tracks

// closed rounded rectangle in (a, b), counter-clockwise, first point repeated at the end: lathed into rings
function roundLoop(a0, a1, b0, b1, rc, steps = 3) {
  const pts = [];
  for (const [ca, cb, t0] of [[a1 - rc, b0 + rc, -Math.PI / 2], [a1 - rc, b1 - rc, 0], [a0 + rc, b1 - rc, Math.PI / 2], [a0 + rc, b0 + rc, Math.PI]]) {
    for (let k = 0; k <= steps; k++) { const t = t0 + (k / steps) * (Math.PI / 2); pts.push([ca + rc * Math.cos(t), cb + rc * Math.sin(t)]); }
  }
  pts.push(pts[0]);
  return pts;
}

// A road wheel or truck wheel with its axle along z, centered on the origin: a rounded tire (tire: its depth as
// a share of the radius, 0 for none), then either a dished disc with a hub boss or, with spokes > 0, a rim, a hub
// and spokes. bolts sit on both hub faces; tread adds that many blocks around the tire. Vertex colors: `color` for
// the wheel, `tireColor` for the rubber.
export function wheel(radius = 0.5, width = 0.3, { tire = 0.25, hub = 0.22, spokes = 0, bolts = 6, tread = 0, color = 0xffffff, tireColor = 0x2b2a26, segments = 16 } = {}) {
  const R = radius, wd = width / 2, tr = R * tire, ri = R - tr, hb = R * hub, paint = tint(color), parts = [];
  if (tr > 0) {
    parts.push({ geo: lathe(roundLoop(ri * 0.97, R, -wd, wd, Math.min(tr, width) * 0.35, 2), segments), color: tireColor, mat: 'rubber' });
    const block = new THREE.BoxGeometry(((TAU * R) / Math.max(1, tread)) * 0.45, width * 0.8, tr * 0.16);
    for (let k = 0; k < tread; k++) { const a = (k / tread) * TAU; parts.push({ geo: block, color: tireColor, mat: 'rubber', matrix: xf(R * Math.sin(a), 0, R * Math.cos(a), 0, a, 0) }); }
  }
  let face;
  if (spokes > 0) {
    face = 0.75 * wd;
    parts.push({ geo: lathe(roundLoop(ri * 0.86, ri, -wd * 0.5, wd * 0.5, ri * 0.03), segments), color: paint });
    parts.push({ geo: lathe([[0, -face], [hb, -face], [hb, face], [0, face]], 12), color: paint });
    const len = ri * 0.9 - hb * 0.8, spoke = new THREE.BoxGeometry(R * 0.05, R * 0.05, len);
    for (let k = 0; k < spokes; k++) { const a = (k / spokes) * TAU, m = hb * 0.8 + len / 2; parts.push({ geo: spoke, color: paint, matrix: xf(m * Math.sin(a), 0, m * Math.cos(a), 0, a, 0) }); }
  } else {
    face = 0.85 * wd;
    // a pressed steel disc: rim lip, a dish toward the middle and a raised hub boss, the same on both sides
    const top = [[ri, 0], [ri, 0.62 * wd], [0.92 * ri, 0.62 * wd], [0.8 * ri, 0.3 * wd], [hb * 1.25, 0.3 * wd], [hb, 0.55 * wd], [0.75 * hb, face], [0, face]];
    parts.push({ geo: lathe([...top.slice(1).reverse().map(([r, y]) => [r, -y]), ...top], segments), color: paint });
  }
  if (bolts > 0) {
    const bh = wd * 0.12, bolt = new THREE.BoxGeometry(hb * 0.2, bh, hb * 0.2), dark = paint.clone().multiplyScalar(0.72);
    for (const side of [-1, 1]) for (let k = 0; k < bolts; k++) { const a = (k / bolts) * TAU; parts.push({ geo: bolt, color: dark, matrix: xf(0.5 * hb * Math.sin(a), side * (face + bh * 0.4), 0.5 * hb * Math.cos(a), 0, a, 0) }); }
  }
  return combine(parts, true).rotateX(Math.PI / 2);
}

// `count` wheels in a row along x, `spacing` apart and centered on the origin, axles along z (bogies, road wheel
// rows). opts go to wheel().
export function roadWheels(count = 5, radius = 0.35, spacing = 0.8, width = 0.25, opts = {}) {
  const one = wheel(radius, width, opts);
  return combine(Array.from({ length: count }, (_, i) => ({ geo: one, matrix: xf((i - (count - 1) / 2) * spacing) })), true);
}

// A drive sprocket with its axle along z: two toothed plates with lightening holes around a hub. Vertex colors:
// `color` for the plates, a darker shade for the hub.
export function sprocket(radius = 0.4, teeth = 10, width = 0.25, { color = 0xffffff } = {}) {
  const R = radius, rr = R * 0.8, step = TAU / teeth, outline = [], paint = tint(color);
  for (let k = 0; k < teeth; k++) for (const [f, r] of [[-0.32, rr], [-0.14, R], [0.14, R], [0.32, rr]]) { const a = (k + f) * step; outline.push([r * Math.cos(a), r * Math.sin(a)]); }
  const holes = Array.from({ length: 5 }, (_, k) => { const a = (k / 5) * TAU; return circle(R * 0.13, 6).map(([x, y]) => [x + 0.52 * R * Math.cos(a), y + 0.52 * R * Math.sin(a)]); });
  const plate = extrudeProfile(outline, width * 0.28, 0, { holes });
  const hub = lathe([[0, -width / 2], [R * 0.3, -width / 2], [R * 0.3, width / 2], [0, width / 2]], 12, { axis: 'z' });
  return combine([{ geo: plate, color: paint, matrix: xf(0, 0, width * 0.32) }, { geo: plate, color: paint, matrix: xf(0, 0, -width * 0.32) }, { geo: hub, color: paint.clone().multiplyScalar(0.7) }], true);
}

// the belt's center line as a dense loop, counter-clockwise in xy seen from +z: bottom run, front curl, top run
// (sagging by `sag` in the middle), back curl. Returns the points and the running length at each.
function belt(c, r, sag, n = 24) {
  const pts = [];
  for (let k = 0; k < n; k++) pts.push([-c + (2 * c * k) / n, -r]);
  for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + (Math.PI * k) / n; pts.push([c + r * Math.cos(a), r * Math.sin(a)]); }
  for (let k = 0; k < n; k++) { const t = k / n; pts.push([c - 2 * c * t, r - sag * Math.sin(Math.PI * t)]); }
  for (let k = 0; k < n; k++) { const a = Math.PI / 2 + (Math.PI * k) / n; pts.push([-c + r * Math.cos(a), r * Math.sin(a)]); }
  const len = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return { pts, len };
}

// A tank track lying in the xy plane (axles along z), `length` long overall with end curls of `radius`, made of
// `links` plates (0 picks a count from the thickness), each with an outer grouser and an inner guide horn.
// wheels > 0 adds that many road wheels on the bottom run, a sprocket at the front (+x) and an idler at the
// back, painted `paint`. Vertex colors: `color` for the links.
export function track(length = 4, radius = 0.45, links = 0, { width = 0.5, thickness = 0.08, grousers = true, horns = true, sag = 0, wheels = 0, wheelRadius, color = 0x3d3b35, paint = 0xffffff } = {}) {
  const c = Math.max(0, length / 2 - radius), { pts, len } = belt(c, radius, sag), total = len[pts.length];
  const n = links || Math.max(8, Math.round(total / (thickness * 2.2))), pitch = total / n;
  const plate = new THREE.BoxGeometry(pitch * 0.86, thickness, width), grouser = new THREE.BoxGeometry(pitch * 0.22, thickness * 0.7, width * 0.96);
  const horn = new THREE.BoxGeometry(pitch * 0.3, thickness * 1.1, width * 0.16), parts = [];
  const T = new THREE.Vector3(), In = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  for (let k = 0, i = 0; k < n; k++) {
    const s = (k + 0.5) * pitch;
    while (len[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length], t = (s - len[i]) / Math.max(1e-12, len[i + 1] - len[i]);
    T.set(b[0] - a[0], b[1] - a[1], 0).normalize(); In.set(-T.y, T.x, 0); // in the plate's frame +y points into the loop
    const m = new THREE.Matrix4().makeBasis(T, In, Z).setPosition(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0);
    parts.push({ geo: plate, color, mat: 'track-steel', matrix: m });
    if (grousers) parts.push({ geo: grouser, color, mat: 'track-steel', matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -thickness * 0.85, 0)) });
    if (horns) parts.push({ geo: horn, color, mat: 'track-steel', matrix: m.clone().multiply(new THREE.Matrix4().makeTranslation(0, thickness * 1.05, 0)) });
  }
  if (wheels > 0) {
    const gap = (2 * c) / wheels, rw = Math.min(wheelRadius ?? radius * 0.72, gap * 0.47), floor = -radius + thickness / 2;
    const road = wheel(rw, width * 0.8, { color: paint, tire: 0.18, bolts: 5 }), inner = radius - thickness / 2;
    for (let i = 0; i < wheels; i++) parts.push({ geo: road, matrix: xf(-c + gap * (i + 0.5), floor + rw) });
    parts.push({ geo: sprocket(inner, Math.max(8, Math.round(inner * 24)), width * 0.85, { color: paint }), matrix: xf(c) });
    parts.push({ geo: wheel(inner, width * 0.7, { color: paint, tire: 0.12, bolts: 6 }), matrix: xf(-c) });
  }
  return combine(parts, true);
}

// ---------------------------------------------------------------- tubes

// A round tube along a path (an array of [x, y, z] or Vector3 points, smoothed by a centripetal Catmull-Rom
// curve, or any THREE.Curve): rails, grab handles, exhausts, cables, aerials. radius may be a function of u (0 at
// the start, 1 at the end) for tapers. Open ends get flat caps unless caps is false; closed joins the ends.
export function tube(path, radius = 0.03, { segments, radial = 8, closed = false, caps = true, crease: angle = 60 } = {}) {
  const curve = path.isCurve ? path : path.length === 2 ? new THREE.LineCurve3(v3(path[0]), v3(path[1])) : new THREE.CatmullRomCurve3(path.map(v3), closed, 'centripetal');
  const seg = segments ?? (path.isCurve ? 32 : path.length === 2 ? 1 : (path.length - 1) * 8), rad = typeof radius === 'function' ? radius : () => radius;
  const F = curve.computeFrenetFrames(seg, closed), count = closed ? seg : seg + 1, b = builder(), centers = [], radii = [];
  for (let i = 0; i < count; i++) {
    const u = i / seg, p = curve.getPointAt(u), r = rad(u), N = F.normals[i], B = F.binormals[i];
    centers.push(p); radii.push(r);
    // the ring turns clockwise around the tangent, which with the quads below faces outward
    for (let j = 0; j < radial; j++) { const t = (j / radial) * TAU, cs = Math.cos(t), sn = Math.sin(t); b.v(p.x + r * (cs * N.x - sn * B.x), p.y + r * (cs * N.y - sn * B.y), p.z + r * (cs * N.z - sn * B.z)); }
  }
  for (let i = 0; i < seg; i++) {
    const i1 = (i + 1) % count;
    for (let j = 0; j < radial; j++) { const j1 = (j + 1) % radial; b.quad(i * radial + j, i1 * radial + j, i1 * radial + j1, i * radial + j1); }
  }
  const parts = [crease(b.geometry(), angle)];
  if (caps && !closed) {
    const cap = builder();
    for (const [i, dir] of [[0, -1], [count - 1, 1]]) {
      if (radii[i] < 1e-9) continue;
      const n = F.tangents[i].clone().multiplyScalar(dir), p = centers[i], mid = cap.v(p.x, p.y, p.z, n), ring = [];
      for (let j = 0; j < radial; j++) {
        const t = (j / radial) * TAU, N = F.normals[i], B = F.binormals[i], r = radii[i];
        ring.push(cap.v(p.x + r * (Math.cos(t) * N.x - Math.sin(t) * B.x), p.y + r * (Math.cos(t) * N.y - Math.sin(t) * B.y), p.z + r * (Math.cos(t) * N.z - Math.sin(t) * B.z), n));
      }
      // the ring runs clockwise around the tangent: counter-clockwise seen from behind the start cap
      for (let j = 0; j < radial; j++) { const j1 = (j + 1) % radial; if (dir < 0) cap.tri(mid, ring[j], ring[j1]); else cap.tri(mid, ring[j1], ring[j]); }
    }
    parts.push(cap.geometry());
  }
  return combine(parts, false);
}

// ---------------------------------------------------------------- markings

// Flat decal layers facing +z at z = lift: each {outline, holes, color} is triangulated on its own. Layers sit
// side by side (a disc has the star cut out of it) so nothing overlaps and nothing flickers.
function decal(layers, lift) {
  const b = builder(), up = new THREE.Vector3(0, 0, 1);
  for (const { outline, holes = [], color } of layers) {
    const c = tint(color), contour = outline.map(v2), hs = holes.map((h) => h.map(v2));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs), all = [...contour, ...hs.flat()], ids = all.map((p) => b.v(p.x, p.y, lift, up, c));
    for (const [i, j, k] of tris) {
      const z = (all[j].x - all[i].x) * (all[k].y - all[i].y) - (all[j].y - all[i].y) * (all[k].x - all[i].x);
      if (z >= 0) b.tri(ids[i], ids[j], ids[k]); else b.tri(ids[i], ids[k], ids[j]);
    }
  }
  return b.geometry();
}
// a 5-point star, counter-clockwise, top point up
const starPts = (R, inner) => Array.from({ length: 10 }, (_, k) => { const a = Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? R * inner : R; return [r * Math.cos(a), r * Math.sin(a)]; });
// a counter-clockwise outline pushed out by d with mitered corners
function grow(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const n1 = [(p[1] - a[1]) / l1, -(p[0] - a[0]) / l1], n2 = [(b[1] - p[1]) / l2, -(b[0] - p[0]) / l2], k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k]);
  }
  return out;
}

// A 5-point star `size` from the middle to a tip, facing +z, top point up. border: an outline band in that
// color; disc: a round field behind it (US blue); ring: a band around the disc.
export function star(size = 1, { color = 0xece6d6, border = null, disc = null, ring = null, inner = 0.382, edge = 0.1, lift = 0.01, segments = 32 } = {}) {
  let outer = starPts(size, inner), R = size;
  const layers = [{ outline: outer, color }];
  if (border != null) { const o = grow(outer, size * edge); layers.push({ outline: o, holes: [outer], color: border }); outer = o; R = Math.max(...o.map(([x, y]) => Math.hypot(x, y))); }
  if (disc != null) { const d = circle(R * 1.06, segments, Math.PI / 2); layers.push({ outline: d, holes: [outer], color: disc }); outer = d; R *= 1.06; }
  if (ring != null) layers.push({ outline: circle(R * 1.14, segments, Math.PI / 2), holes: [circle(R, segments, Math.PI / 2)], color: ring });
  return decal(layers, lift);
}

// The German cross: a black cross `size` from the middle to an arm end, arms `arm` of that wide on each side,
// with white L-shaped edges along the arms (color null leaves only the white edges, the late-war outline).
export function balkenkreuz(size = 1, { color = 0x1c1b18, border = 0xece6d6, arm = 0.2, edge = 0.12, lift = 0.01 } = {}) {
  const S = size, a = S * arm, e = S * edge, layers = [];
  if (color != null) layers.push({ color, outline: [[a, -S], [a, -a], [S, -a], [S, a], [a, a], [a, S], [-a, S], [-a, a], [-S, a], [-S, -a], [-a, -a], [-a, -S]] });
  if (border != null) {
    const L = [[a, a], [S, a], [S, a + e], [a + e, a + e], [a + e, S], [a, S]];
    for (const [qx, qy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) layers.push({ color: border, outline: L.map(([x, y]) => [qx * x, qy * y]) });
  }
  return decal(layers, lift);
}

// A round roundel `size` in radius: concentric bands from the outside in (the last is the middle disc). widths:
// each band's share of the radius, even by default.
export function roundel(size = 1, colors = [0x2a4a8f, 0xece6d6, 0xc23a2a], { widths, lift = 0.01, segments = 32 } = {}) {
  const w = widths ?? colors.map(() => 1 / colors.length), layers = [];
  let r = size;
  colors.forEach((color, k) => {
    const next = r - size * w[k], last = k === colors.length - 1;
    layers.push({ color, outline: circle(r, segments), holes: last ? [] : [circle(next, segments)] });
    r = next;
  });
  return decal(layers, lift);
}

// Matrix that lays a marking on a surface: its +z onto `normal`, its top toward `up`, centered at `at`, scaled.
// Use it as the matrix of a merge() item or a mesh. When up runs along the normal (a marking on a roof), the
// top points to +x.
export function place(at = [0, 0, 0], normal = [0, 0, 1], up = [0, 1, 0], scale = 1) {
  const z = v3(normal).normalize();
  let u = v3(up);
  if (u.lengthSq() < 1e-12 || Math.abs(u.clone().normalize().dot(z)) > 0.999) u = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const y = u.addScaledVector(z, -u.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x.multiplyScalar(scale), y.multiplyScalar(scale), z.multiplyScalar(scale)).setPosition(v3(at));
}

// ---------------------------------------------------------------- shading

// Fake contact shadow in the vertex colors: a copy of geo whose colors darken toward the floor (to `dark` at the
// floor, full brightness `height` above it) and on faces pointing down (by `under`). floor defaults to the
// lowest point, height to 35% of the shape's height. falloff(p, n) replaces the rule with your own factor.
export function ao(geo, { floor, height, dark = 0.55, under = 0.25, falloff } = {}) {
  const g = geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal, box = new THREE.Box3().setFromBufferAttribute(P);
  const y0 = floor ?? box.min.y, span = height ?? Math.max(1e-6, 0.35 * (box.max.y - box.min.y));
  if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P.count * 3).fill(1), 3));
  const C = g.attributes.color, p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
    const k = falloff ? falloff(p, n) : (dark + (1 - dark) * smooth((p.y - y0) / span)) * (1 - under * Math.max(0, -n.y));
    C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k);
  }
  return g;
}
