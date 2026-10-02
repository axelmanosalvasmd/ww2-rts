// Medium tanks as realistic wartime vehicles: the M4 Sherman (USA), the Panzer IV Ausf. H (Germany) and the T-34/76 of
// 1943 (USSR), plus the two conversions on those chassis, the T34 Calliope rocket Sherman and the Wirbelwind flak
// Panzer IV, and the tank destroyers: the M10 Wolverine, the StuG III Ausf. G and the SU-85.
//
// Each model is two vertex-colored geometries: the hull with its running gear, and the turret. client/unit-models.js
// bakes each into one mesh of its shared PAINT material, like the other tanks, so a medium tank stays two draw calls.
// The turret geometry sits around its turret ring: v.turret is placed on the ring and turns there, and v.fxTip is
// the muzzle in turret space. Sizes run about 0.9 of the real tanks. Every part says what it is made of (cast
// armor, gunmetal, rubber, track steel, wood, canvas) for the model textures (client/model-textures.js); the paint
// is muted and the wear comes from the textures. The lower hull and running gear are a little darker (geom.ao). The
// owner's color is small: a tactical number plate on each side of the turret and a stripe across its roof.
// Axes as in the other unit models: +x forward, +y up, +z the tank's right side.
import * as THREE from 'three';
import * as G from './geom.js';

const TAU = Math.PI * 2;
const RUBBER = 0x2b2a27, STEEL = 0x45443e, DARK = 0x1f1e1b, WOOD = 0x382e22, RUST = 0x4a3a2e, WHITE = 0xe4dfcf, BARREL = 0x2f3031, CANVAS = 0x4f4a38;
// track links in dark, cool worn steel (the track steel texture warms it), alternately a touch darker, each with a
// slightly lighter grouser stripe; the link edges are lit at the start of each link and dark at its end. The track
// stays darker than the hull deck. Spare links on the hulls use the same steel.
const TRACK = [0x222221, 0x1c1c1b], GROUSER = 0x2e2f2e, EDGE = [0x363735, 0x1c1c1b], LINK = 0x242423;
const tone = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- small builders

// Indexed triangles with a normal and a color per vertex. tri() turns each triangle to face along its vertex
// normals, so callers only list corners; degenerate triangles are skipped.
// use(name) sets what the vertices added after it are made of (a MATS name or 'plain'; none: the part's own).
function mesh() {
  const pos = [], nor = [], col = [], idx = [], mid = [], c = new THREE.Color();
  let cur = G.UNSET;
  const m = {
    use(name) { cur = G.matId(name); return m; },
    v(x, y, z, nx, ny, nz, color) { pos.push(x, y, z); nor.push(nx, ny, nz); c.set(color); col.push(c.r, c.g, c.b); mid.push(cur); return pos.length / 3 - 1; },
    tri(a, b, d) {
      const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
      const vx = pos[3 * d] - pos[3 * a], vy = pos[3 * d + 1] - pos[3 * a + 1], vz = pos[3 * d + 2] - pos[3 * a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * fx + fy * fy + fz * fz < 1e-14) return;
      const s = fx * (nor[3 * a] + nor[3 * b] + nor[3 * d]) + fy * (nor[3 * a + 1] + nor[3 * b + 1] + nor[3 * d + 1]) + fz * (nor[3 * a + 2] + nor[3 * b + 2] + nor[3 * d + 2]);
      if (s < 0) idx.push(a, d, b); else idx.push(a, b, d);
    },
    quad(a, b, d, e) { m.tri(a, b, d); m.tri(a, d, e); },
    // a flat face through corners [[x, y, z], ...] (a convex fan), turned toward `out`
    face(pts, out, color) {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
      const l = Math.hypot(nx, ny, nz) || 1, s = nx * out[0] + ny * out[1] + nz * out[2] < 0 ? -1 / l : 1 / l;
      const ids = pts.map((p) => m.v(p[0], p[1], p[2], nx * s, ny * s, nz * s, color));
      for (let i = 1; i + 1 < ids.length; i++) m.tri(ids[0], ids[i], ids[i + 1]);
    },
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('matId', new THREE.Float32BufferAttribute(mid, 1));
      g.setIndex(idx);
      return g;
    },
  };
  return m;
}

// A solid of revolution around +z, S segments around: the profile [[r, z], ...] walks with the solid on its left
// (out from the axis at the back, along the rim, in over the front face), so a wheel's face looks toward +z.
// color: one color, one per band, or (band, segment) => color for painted patterns (vision blocks, perforations).
// flat: faceted sides (the Wirbelwind's eight-sided tub) instead of round shading. mats: what each band is made of
// (a MATS name per band; null leaves it to the part).
function spin(profile, color, S = 10, { flat = false, a0 = 0, mats = null } = {}) {
  const m = mesh();
  for (let b = 0; b + 1 < profile.length; b++) {
    m.use(mats ? mats[Math.min(b, mats.length - 1)] : null);
    const [r0, z0] = profile[b], [r1, z1] = profile[b + 1];
    let nr = z1 - z0, nz = r0 - r1;
    const l = Math.hypot(nr, nz) || 1; nr /= l; nz /= l;
    for (let s = 0; s < S; s++) {
      const c = typeof color === 'function' ? color(b, s) : Array.isArray(color) ? color[Math.min(b, color.length - 1)] : color;
      const a = a0 + (s / S) * TAU, e = a0 + ((s + 1) / S) * TAU, mid = (a + e) / 2;
      const at = (r, z, t) => { const n = flat ? mid : t; return m.v(r * Math.cos(t), r * Math.sin(t), z, nr * Math.cos(n), nr * Math.sin(n), nz, c); };
      m.quad(at(r0, z0, a), at(r1, z1, a), at(r1, z1, e), at(r0, z0, e));
    }
  }
  return m.geo();
}
const alongX = (g) => g.rotateY(Math.PI / 2); // a spin() part turned to point along +x (barrels)
const upright = (g) => g.rotateX(-Math.PI / 2); // a spin() part turned to stand on y (hatches, cupolas)

// plain boxes, 12 triangles each, shared by size
const boxes = new Map();
function BOX(w, h, d) {
  const k = `${w}|${h}|${d}`;
  let g = boxes.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); g.deleteAttribute('uv'); boxes.set(k, g); }
  return g;
}
// mat: what the part is made of (a MATS name; left out, the hull's painted armor, or near-black paint as gunmetal)
const box = (w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, mat) => ({ geo: BOX(w, h, d), color, matrix: G.xf(x, y, z, rx, ry, rz), mat });
const at = (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat) => ({ geo, color, matrix: G.xf(x, y, z, rx, ry, rz), mat });
// a steady pseudo-random number in [0, 1) from three coordinates, for plate-to-plate tone and tilt
const CAST = 0.86; // the cast armor texture is lighter than the painted plate: the paint on cast parts goes a little darker
const rnd = (a, b = 0, c = 0) => { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); };
// the paint a touch lighter or darker per plate (by +/- k), so welded plates and hatches do not read as one tone
const jit = (color, a, b = 0, k = 0.07) => tone(color, 1 + (rnd(a, b, 3.7) - 0.5) * 2 * k);
// a thin bar l long, h tall and d deep at (x, y, z), turned rz about z, built only with the faces that show from
// +z: its front and its top and bottom (6 triangles, half a box)
function strut(l, h, d, color, x, y, z, rz) {
  const m = mesh(), c = Math.cos(rz), s = Math.sin(rz), p = (u, v, w) => [x + u * c - v * s, y + u * s + v * c, z + w];
  const A = p(-l / 2, -h / 2, d / 2), B = p(l / 2, -h / 2, d / 2), C = p(l / 2, h / 2, d / 2), D = p(-l / 2, h / 2, d / 2);
  m.face([A, B, C, D], [0, 0, 1], color);
  m.face([D, C, p(l / 2, h / 2, -d / 2), p(-l / 2, h / 2, -d / 2)], [-s, c, 0], tone(color, 1.1));
  m.face([A, B, p(l / 2, -h / 2, -d / 2), p(-l / 2, -h / 2, -d / 2)], [s, -c, 0], color);
  return { geo: m.geo() };
}

// A road wheel or idler with its face toward +z: the tread and a thin chamfer in rubber (`rubber` deep; 0 makes an
// all-steel wheel), the flat face `face` times the paint and a raised hub cap in the paint. holes lays that many
// small dark openings round the face, on a ring `ring` of the radius out, each `hole` of the radius across.
function wheel(R, w, paint, { rubber = 0.05, holes = 0, S = 8, hub = 0.32, ring = 0.62, hole = 0.11, sides = 6, a0 = 0, face = 1.1 } = {}) {
  const steel = rubber <= 0, rub = steel ? Math.min(0.04, R * 0.15) : rubber, cap = Math.min(0.06, R * 0.24);
  const prof = [[R, -w / 2], [R, w * 0.3], [R - rub, w / 2], [R * hub, w / 2], [0, w / 2 + cap]];
  const g = spin(prof, steel ? [tone(paint, 0.8), tone(paint, 1.22), tone(paint, face), paint] : [RUBBER, RUBBER, tone(paint, face), paint], S, { mats: steel ? null : ['rubber', 'rubber', null, null] });
  if (!holes) return g;
  const m = mesh(), dark = tone(paint, 0.28), z = w / 2 + 0.006;
  for (let k = 0; k < holes; k++) {
    const a = a0 + (k / holes) * TAU, cx = R * ring * Math.cos(a), cy = R * ring * Math.sin(a);
    m.face(Array.from({ length: sides }, (_, j) => { const b = (j / sides) * TAU; return [cx + R * hole * Math.cos(b), cy + R * hole * Math.sin(b), z]; }), [0, 0, 1], dark);
  }
  return G.merge([{ geo: g }, { geo: m.geo() }]);
}
// a small return roller facing +z: rubber tread, a flat painted face
const roller = (r, w, paint) => spin([[r, -w / 2], [r, w / 2], [0, w / 2 + 0.02]], [RUBBER, paint], 6, { mats: ['rubber', null] });

// A drive sprocket facing +z: a toothed plate (teeth points) and a hub cap.
function sprocket(R, teeth, w, paint) {
  const m = mesh(), n = teeth * 2, rim = [], hub = tone(paint, 0.7), lit = tone(paint, 1.12);
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU, r = k % 2 ? R * 0.82 : R; rim.push([r * Math.cos(a), r * Math.sin(a)]); }
  const mid = m.v(0, 0, w / 2, 0, 0, 1, paint), ring = rim.map(([x, y]) => m.v(x, y, w / 2, 0, 0, 1, paint));
  for (let k = 0; k < n; k++) m.tri(mid, ring[k], ring[(k + 1) % n]);
  for (let k = 0; k < n; k++) {
    const [x0, y0] = rim[k], [x1, y1] = rim[(k + 1) % n];
    m.face([[x0, y0, -w / 2], [x1, y1, -w / 2], [x1, y1, w / 2], [x0, y0, w / 2]], [(x0 + x1) / 2, (y0 + y1) / 2, 0], lit);
  }
  return G.merge([{ geo: m.geo() }, { geo: spin([[R * 0.36, w / 2], [R * 0.3, w / 2 + 0.07], [0, w / 2 + 0.08]], hub, 8) }]);
}

// The track belt's inner line around its wheels. circles [{x, y, r, top}] go round the loop counter-clockwise seen
// from +z: the bottom run rear to front, the front wheel, the top run front to rear, the rear wheel. Wheels the belt
// cannot touch drop out. Straight runs between two `top` wheels (a top run resting on road wheels) sag by `sag`.
function beltLine(circles, sag = 0) {
  let cs = circles.slice();
  const normal = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, s = (a.r - b.r) / L, c = Math.sqrt(Math.max(0, 1 - s * s));
    return [c * uy + s * ux, -c * ux + s * uy]; // outward: to the right of the run
  };
  const turn = (i, ns) => {
    const a = ns[(i + cs.length - 1) % cs.length], b = ns[i];
    let d = Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]);
    while (d <= -Math.PI / 2) d += TAU;
    while (d > 1.5 * Math.PI) d -= TAU;
    return d;
  };
  let ns;
  for (;;) {
    ns = cs.map((c, i) => normal(c, cs[(i + 1) % cs.length]));
    const drop = cs.findIndex((_, i) => turn(i, ns) < -1e-6);
    if (drop < 0) break;
    cs.splice(drop, 1);
  }
  const pts = [];
  cs.forEach((c, i) => {
    const prev = ns[(i + cs.length - 1) % cs.length], a0 = Math.atan2(prev[1], prev[0]), d = turn(i, ns), steps = Math.max(1, Math.ceil(d / 0.25));
    for (let k = 0; k <= steps; k++) { const a = a0 + (d * k) / steps; pts.push([c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a)]); }
    const n = cs[(i + 1) % cs.length], o = ns[i];
    if (sag && c.top && n.top) {
      const p = [c.x + c.r * o[0], c.y + c.r * o[1]], q = [n.x + n.r * o[0], n.y + n.r * o[1]];
      for (let k = 1; k < 6; k++) { const t = k / 6; pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag * Math.sin(Math.PI * t)]); }
    }
  });
  return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-4; });
}

// The track around that line at z: links about `pitch` long and `thick` deep, alternately a touch darker, each
// with a lighter grouser stripe across its leading end. Only the faces that show are built: the outside and the
// outer edge (inner too with both). The outer edge reaches `inset` inside the line, the end connectors that hide
// the bottom of the wheel rims, and runs light to dark along each link so the links read from the side. spuds
// raises a cast block that high on every other link (the T-34's alternating horned links).
function trackBelt(line, z, width, thick, pitch, { both = false, inset = 0.035, spuds = 0 } = {}) {
  const L = line.length, len = [0];
  for (let i = 1; i <= L; i++) { const a = line[i - 1], b = line[i % L]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[L], n = Math.round(total / pitch / 2) * 2, step = total / n;
  // the point s along the line, moved h out along the line's outward normal: [x, y, nx, ny]
  const pt = (s, h) => {
    let i = 0;
    while (i < L - 1 && len[i + 1] < s) i++;
    const a = line[i], b = line[(i + 1) % L], l = Math.max(1e-9, len[i + 1] - len[i]), t = (s - len[i]) / l, nx = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
    return [a[0] + (b[0] - a[0]) * t + nx * h, a[1] + (b[1] - a[1]) * t + ny * h, nx, ny];
  };
  const out = [], inn = [], mid = [];
  for (let k = 0; k < n; k++) out.push(pt(k * step, thick)), inn.push(pt(k * step, -inset)), mid.push(pt((k + 0.3) * step, thick));
  const m = mesh(), zo = z + width / 2, zi = z - width / 2;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, p = out[k], g = mid[k], q = out[k1], a = inn[k], b = inn[k1], c = TRACK[k % 2];
    m.face([[p[0], p[1], zi], [g[0], g[1], zi], [g[0], g[1], zo], [p[0], p[1], zo]], [p[2] + g[2], p[3] + g[3], 0], GROUSER);
    m.face([[g[0], g[1], zi], [q[0], q[1], zi], [q[0], q[1], zo], [g[0], g[1], zo]], [g[2] + q[2], g[3] + q[3], 0], c);
    m.quad(m.v(a[0], a[1], zo, 0, 0, 1, EDGE[0]), m.v(b[0], b[1], zo, 0, 0, 1, EDGE[1]), m.v(q[0], q[1], zo, 0, 0, 1, EDGE[1]), m.v(p[0], p[1], zo, 0, 0, 1, EDGE[0]));
    if (both) m.face([[a[0], a[1], zi], [b[0], b[1], zi], [q[0], q[1], zi], [p[0], p[1], zi]], [0, 0, -1], tone(c, 0.8));
    if (spuds && k % 2) {
      const u = pt((k + 0.2) * step, thick), w = pt((k + 0.8) * step, thick), U = pt((k + 0.2) * step, thick + spuds), W = pt((k + 0.8) * step, thick + spuds);
      const za = z - width * 0.32, zb = z + width * 0.32, dx = w[0] - u[0], dy = w[1] - u[1];
      m.face([[U[0], U[1], za], [W[0], W[1], za], [W[0], W[1], zb], [U[0], U[1], zb]], [u[2] + w[2], u[3] + w[3], 0], GROUSER);
      m.face([[u[0], u[1], za], [U[0], U[1], za], [U[0], U[1], zb], [u[0], u[1], zb]], [-dx, -dy, 0], c);
      m.face([[w[0], w[1], za], [W[0], W[1], za], [W[0], W[1], zb], [w[0], w[1], zb]], [dx, dy, 0], c);
      m.face([[u[0], u[1], zb], [w[0], w[1], zb], [W[0], W[1], zb], [U[0], U[1], zb]], [0, 0, 1], EDGE[0]);
    }
  }
  // without the link-by-link inner edge, close it with one coarse strip (every other link), so the belt does not
  // look hollow where its ends show past the hull from the far side
  if (!both) {
    const dark = tone(TRACK[1], 0.8), ids = [];
    for (let k = 0; k < n; k += 2) { const p = inn[k], q = pt(k * step, thick * 0.9); ids.push([m.v(p[0], p[1], zi, 0, 0, -1, dark), m.v(q[0], q[1], zi, 0, 0, -1, dark)]); }
    for (let i = 0; i < ids.length; i++) { const [a, b] = ids[i], [d, e] = ids[(i + 1) % ids.length]; m.quad(a, d, e, b); }
  }
  return G.tag(m.geo(), 'track-steel'); // the links take the track steel texture (client/model-textures.js)
}

// A turret body lofted upward through horizontal slices: {h, x, l, w, p} superellipses (l long in x, w wide in z,
// centered on x) or {h, pts: [[x, z], ...]} plan polygons, all with their points in the same order.
function tower(slices, opts = {}) {
  const secs = slices.map((s) => (s.pts ? { x: s.h, pts: s.pts.map(([x, z]) => [z, -x]) } : { x: s.h, w: s.w, h: s.l, y: -(s.x ?? 0), z: s.z ?? 0, p: s.p ?? 2.4 }));
  return G.loft(secs, { segments: 18, normals: 32, ...opts }).rotateZ(Math.PI / 2);
}
// the slice of a tower at height h, grown by k (for bands painted around it)
function sliceAt(slices, h, k = 1) {
  let i = 0;
  while (i + 2 < slices.length && slices[i + 1].h < h) i++;
  const a = slices[i], b = slices[i + 1], t = (h - a.h) / (b.h - a.h), mix = (p, q) => p + (q - p) * t;
  if (a.pts) return { h, pts: a.pts.map((p, j) => { const q = b.pts[j]; return [mix(p[0], q[0]) * k, mix(p[1], q[1]) * k]; }) };
  return { h, x: mix(a.x, b.x), l: mix(a.l, b.l) * k, w: mix(a.w, b.w) * k, p: a.p ?? 2.4 };
}
const band = (slices, h0, h1, k = 1.02) => tower([sliceAt(slices, h0, k), sliceAt(slices, h1, k)], { caps: false });
// how far out the right side of a plan-polygon tower is at height h and x (for markings on it)
function sideZ(slices, h, x) {
  const pts = sliceAt(slices, h).pts;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[1] > 0 && b[1] > 0 && a[0] !== b[0] && (a[0] - x) * (b[0] - x) <= 0) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return 0;
}
// A turret plan of n points from the front round by the right: a superellipse reaching `front` ahead of the ring
// and `rear` behind it, hw to either side, squarer at the front (pf) than at the back (pr).
function plan(front, rear, hw, { pf = 3, pr = 2.4, n = 16 } = {}) {
  return Array.from({ length: n }, (_, j) => {
    const t = (j / n) * TAU, c = Math.cos(t), s = Math.sin(t), e = 2 / (c >= 0 ? pf : pr);
    return [(c >= 0 ? front : rear) * Math.sign(c) * Math.abs(c) ** e, hw * Math.sign(s) * Math.abs(s) ** e];
  });
}

// A gun barrel along +x from x = 0: [r, x] stations from the breech to the muzzle, bored at the end.
function gun(stations, color, S = 8) {
  const L = stations[stations.length - 1][1], r = stations[stations.length - 1][0];
  return { geo: G.tag(alongX(spin([[0, 0], ...stations, [r * 0.45, L], [0, L - 0.04]], color, S)), 'gunmetal'), color: 0xffffff };
}

// A row of n spare track links hung on a plate that faces +x at x, centered on (y, z): dark steel plates `pitch`
// apart and h tall, lit along their top edges, each with a raised guide horn in the middle.
function linkRow(n, pitch, x, y, z, h = 0.13) {
  const m = mesh(), w = pitch - 0.025, t = 0.04, xf = x + t, hx = xf + 0.035, top = tone(LINK, 1.6), horn = tone(LINK, 1.3);
  for (let k = 0; k < n; k++) {
    const zc = z + (k - (n - 1) / 2) * pitch, z0 = zc - w / 2, z1 = zc + w / 2, y0 = y - h / 2, y1 = y + h / 2, hz = w * 0.2, hy0 = y - h * 0.32, hy1 = y + h * 0.32;
    m.face([[xf, y0, z0], [xf, y0, z1], [xf, y1, z1], [xf, y1, z0]], [1, 0, 0], LINK);
    m.face([[x, y1, z0], [xf, y1, z0], [xf, y1, z1], [x, y1, z1]], [0, 1, 0], top);
    m.face([[hx, hy0, zc - hz], [hx, hy0, zc + hz], [hx, hy1, zc + hz], [hx, hy1, zc - hz]], [1, 0, 0], horn);
    m.face([[xf, hy1, zc - hz], [hx, hy1, zc - hz], [hx, hy1, zc + hz], [xf, hy1, zc + hz]], [0, 1, 0], top);
  }
  return m.geo();
}
// A slatted grille on a deck at height y: a dark opening x0..x1 by z0..z1 crossed by n slats running in z.
function grille(x0, x1, z0, z1, y, n, base, slat) {
  const m = mesh(), dx = (x1 - x0) / n, sw = dx * 0.55;
  m.face([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], base);
  for (let k = 0; k < n; k++) {
    const xa = x0 + dx * (k + 0.5) - sw / 2, xb = xa + sw, ys = y + 0.012;
    m.face([[xa, ys, z0], [xb, ys, z0], [xb, ys, z1], [xa, ys, z1]], [0, 1, 0], slat);
  }
  return m.geo();
}

// Bake the shading into the colors: darker toward the ground (to `dark` at the floor) and under overhangs (by
// `under`), faces turned up a little lighter by `lift`, sloped edges between top and side lighter still. The model
// textures add the wear on top of this.
// nose: x past which the plates that face forward and down (a nose that sits in its own shadow) are lit up by that factor
function finish(items, { floor = 0, height = 1.1, dark = 0.78, lift = 0.1, under = 0.2, nose = null } = {}) {
  return G.ao(G.merge(items), {
    falloff: (p, n) => (dark + (1 - dark) * smooth((p.y - floor) / height)) * (1 - under * Math.max(0, -n.y)) * (1 + lift * Math.max(0, n.y) + (n.y > 0.3 && n.y < 0.92 ? 0.04 : 0)) * (nose && p.x > nose[0] && p.y < 0.9 && n.y < -0.2 && n.x > 0.2 ? nose[1] : 1),
  });
}
// the German grey needs a lighter floor and stronger top lights to read at game zoom
const GREY = { dark: 0.88, lift: 0.18 };
// the running gear of one side, built at +z and mirrored to the other
const bothSides = (items) => G.mirrorZ(G.merge(items));

// a marking laid on a surface (geom.place), lifted a hair off it
const mark = (geo, x, y, z, normal, scale = 1, up = [0, 1, 0]) => ({ geo, matrix: G.place([x + normal[0] * 0.012, y + normal[1] * 0.012, z + normal[2] * 0.012], normal, up, scale), mat: 'plain' });
// A flat w by h rectangle facing +z, in the owner's color and a dark outline: the stenciled tactical number block
// on a turret side or the stripe across a roof (laid with mark(), up = [1, 0, 0] on a roof so w runs across it).
function plate(w, h, owner, outline = 0.012) {
  const m = mesh().use('plain'), x = w / 2, y = h / 2, o = outline;
  m.face([[-x - o, -y - o, 0], [x + o, -y - o, 0], [x + o, y + o, 0], [-x - o, y + o, 0]], [0, 0, 1], tone(DARK, 1.4));
  m.face([[-x, -y, 0.004], [x, -y, 0.004], [x, y, 0.004], [-x, y, 0.004]], [0, 0, 1], new THREE.Color(owner).multiplyScalar(0.82));
  return m.geo();
}
// the owner's marks on a turret: a number block on each side at (x, y) (zs: how far out the side is there, normal
// leaning n up) and the stripe across the roof at x, y over half-width hz
function ownerMarks(owner, { side: [sx, sy, zs, n = 0.04], roof: [rx, ry, hz], w = 0.3, h = 0.15, stripe = 0.08 }) {
  const out = [], block = plate(w, h, owner), strip = plate(hz * 2, stripe, owner);
  if (zs) for (const s of [-1, 1]) out.push(mark(block, sx, sy, s * zs, [0, n, s]));
  if (hz) out.push(mark(strip, rx, ry, 0, [0, 1, 0], 1, [1, 0, 0]));
  return out;
}

// ---------------------------------------------------------------- M4 Sherman (and the Calliope on it)

function shermanHull(paint, { cans = true } = {}) {
  const P = paint, lite = tone(P, 1.1), items = [];
  // upper hull, its sponsons over the inner half of the tracks: 56 degree glacis, flat deck, sloped rear deck
  items.push(at(G.extrudeProfile([[2.6, 1.0], [1.55, 1.66], [-2.25, 1.66], [-2.62, 1.5], [-2.62, 1.0]], 2.4, 0.05, { segments: 1 }), P));
  // lower hull between the tracks with the rounded transmission cover at the nose
  items.push(at(G.extrudeProfile([[2.2, 0.42], [2.52, 0.5], [2.7, 0.68], [2.74, 0.86], [2.64, 1.03], [-2.55, 1.03], [-2.62, 0.74], [-2.42, 0.42]], 1.84, 0.05, { segments: 1 }), P));
  // the cast final drive housings bulging out of the cover to either side, bolting flanges between, tow hooks
  const lump = G.loft([{ x: 2.45, w: 0.58, h: 0.5, p: 2.8 }, { x: 2.7, w: 0.56, h: 0.48, p: 2.8 }, { x: 2.78, w: 0.46, h: 0.38, p: 2.6 }], { segments: 10, normals: 50 });
  for (const z of [-0.64, 0.64]) items.push(at(lump, tone(P, CAST), 0, 0.77, z, 0, 0, 0, 'cast-armor'));
  for (const z of [-0.2, 0.2]) items.push(box(0.05, 0.4, 0.04, lite, 2.74, 0.8, z, 0, 0, -0.2, 'cast-armor'));
  for (const z of [-0.3, 0.3]) items.push(box(0.1, 0.1, 0.06, STEEL, 2.72, 0.5, z * 1.1, 0, 0, 0, 'gunmetal'));
  // glacis: point at t along it, its normal, plate angle
  const gl = (t) => [2.6 - 1.05 * t, 1.0 + 0.66 * t], gn = [0.532, 0.847, 0], ga = -0.56;
  for (const z of [-0.5, 0.5]) {
    const [x, y] = gl(0.82);
    items.push(box(0.5, 0.12, 0.52, lite, x + gn[0] * 0.05, y + gn[1] * 0.05, z, 0, 0, ga)); // driver's hoods
    items.push(box(0.1, 0.06, 0.2, DARK, x + gn[0] * 0.12, y + gn[1] * 0.12, z, 0, 0, ga));
    items.push(box(0.5, 0.04, 0.44, lite, 1.25, 1.68, z)); // hatches on the roof
    items.push(box(0.08, 0.07, 0.14, DARK, 1.48, 1.72, z));
  }
  { // bow machine gun in its ball mount, co-driver's side
    const [x, y] = gl(0.42);
    items.push({ geo: upright(spin([[0.13, 0], [0.12, 0.05], [0.07, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(x, y, 0.5, 0, 0, ga) });
    items.push(box(0.36, 0.035, 0.035, DARK, x + 0.22, y + 0.08, 0.5));
  }
  // headlights with brush guards, front fenders over the sprockets
  for (const z of [-0.95, 0.95]) items.push(box(0.12, 0.12, 0.12, STEEL, 2.6, 1.1, z), box(0.04, 0.16, 0.2, P, 2.68, 1.1, z));
  for (const z of [-1.14, 1.14]) items.push(box(0.46, 0.035, 0.42, lite, 2.46, 1.1, z, 0, 0, -0.1));
  // sand shield rails along the sponsons
  for (const z of [-1.22, 1.22]) items.push(box(4.7, 0.05, 0.05, lite, -0.02, 1.02, z));
  // engine deck: two hinged doors, the wide grille behind them, two fuel caps, the air recognition star
  for (const z of [-0.47, 0.47]) items.push(box(0.52, 0.03, 0.9, lite, -1.15, 1.675, z));
  items.push(box(0.05, 0.035, 1.9, STEEL, -0.88, 1.68, 0));
  items.push({ geo: grille(-2.15, -1.47, -0.78, 0.78, 1.665, 7, tone(P, 0.35), tone(P, 0.8)) });
  for (const z of [-1.0, 1.0]) items.push({ geo: upright(spin([[0.08, 0], [0.08, 0.03], [0, 0.04]], STEEL, 6)), matrix: G.xf(-0.72, 1.66, z) });
  items.push(mark(G.star(1, { color: WHITE, ring: WHITE, segments: 20 }), -1.15, 1.69, 0, [0, 1, 0], 0.3, [1, 0, 0]));
  // the short exhaust deflector tight to the rear plate, air cleaners beside it, jerry cans in a rack on the plate
  items.push(box(0.04, 0.26, 1.9, P, -2.655, 1.36, 0, 0, 0, 0.12));
  for (const z of [-0.78, 0.78]) items.push({ geo: upright(spin([[0.11, -0.2], [0.11, 0.2], [0, 0.2]], P, 6)), matrix: G.xf(-2.72, 1.18, z) });
  if (cans) for (const z of [-0.3, 0, 0.3]) items.push(box(0.1, 0.34, 0.2, jit(tone(P, 0.95), z, 5), -2.76, 1.2, z * 1.1, 0, 0, 0.04));
  // pioneer tools on the upper hull sides: shovel and axe on the right, crowbar and sledge on the left
  items.push(box(1.0, 0.045, 0.04, WOOD, -1.05, 1.3, 1.225, 0, 0, 0, 'wood'), box(0.24, 0.16, 0.03, STEEL, -0.42, 1.3, 1.225, 0, 0, 0, 'gunmetal'));
  items.push(box(0.8, 0.045, 0.04, WOOD, -1.62, 1.45, 1.225, 0, 0, 0, 'wood'), box(0.08, 0.18, 0.03, STEEL, -1.2, 1.45, 1.225, 0, 0, 0, 'gunmetal'));
  items.push(box(1.4, 0.035, 0.035, STEEL, -1.1, 1.42, -1.225, 0, 0, 0, 'gunmetal'), box(0.8, 0.045, 0.04, WOOD, -1.35, 1.27, -1.225, 0, 0, 0, 'wood'), box(0.14, 0.09, 0.07, STEEL, -0.9, 1.27, -1.225, 0, 0, 0, 'gunmetal'));
  // stars on the sponson sides
  const side = G.star(1, { color: WHITE });
  for (const s of [-1, 1]) items.push(mark(side, 0.35, 1.33, s * 1.2, [0, 0, s], 0.24));
  items.push(vvss(P));
  return finish(items, { height: 1.2 });
}
// The Sherman's running gear, both sides: three VVSS bogies (a tall bracket with the return roller on its head, the
// volute spring housing, two arms down to the wheel pair), the raised front sprocket, the rear idler
function vvss(P) {
  const lite = tone(P, 1.1), TZ = 1.14, gear = [], wheels = [], rollers = [];
  const bracket = G.extrudeProfile([[-0.2, 0.38], [0.2, 0.38], [0.12, 0.76], [-0.12, 0.76]], 0.18, 0);
  const rw = wheel(0.25, 0.3, P, { holes: 5, sides: 5, hub: 0.3, ring: 0.6, hole: 0.12, a0: Math.PI / 2 });
  for (const bx of [1.45, 0.13, -1.19]) {
    for (const dx of [0.29, -0.29]) { gear.push(at(rw, 0xffffff, bx + dx, 0.34, TZ)); wheels.push({ x: bx + dx, y: 0.34, r: 0.25 }); }
    gear.push(at(bracket, lite, bx, 0, TZ + 0.03));
    gear.push(box(0.2, 0.16, 0.1, tone(P, 0.85), bx, 0.42, TZ + 0.12)); // the spring housing
    for (const s of [1, -1]) gear.push(strut(0.27, 0.07, 0.05, P, bx + s * 0.195, 0.39, TZ + 0.2, -s * 0.6));
    gear.push(at(roller(0.08, 0.18, STEEL), 0xffffff, bx - 0.04, 0.82, TZ));
    rollers.push({ x: bx - 0.04, y: 0.82, r: 0.08 });
  }
  gear.push(at(sprocket(0.31, 12, 0.32, P), 0xffffff, 2.32, 0.64, TZ));
  gear.push(at(wheel(0.25, 0.3, P, { rubber: 0, holes: 5, sides: 5, hub: 0.3, ring: 0.6, hole: 0.12 }), 0xffffff, -2.3, 0.44, TZ));
  gear.push(box(0.4, 0.1, 0.08, P, -2.08, 0.52, TZ - 0.12, 0, 0, 0.35));
  const line = beltLine([{ x: -2.3, y: 0.44, r: 0.25 }, ...wheels.slice().sort((a, b) => a.x - b.x), { x: 2.32, y: 0.64, r: 0.31 }, ...rollers]);
  gear.push(at(trackBelt(line, 0, 0.42, 0.1, 0.26), 0xffffff, 0, 0, TZ));
  return { geo: bothSides(gear) };
}

// The cast turret: a flat front, a flat roof with rounded edges and a bustle hanging out over the back of the ring.
const SHERMAN_BODY = [
  { h: 0, pts: plan(0.86, 0.62, 0.88) }, { h: 0.18, pts: plan(0.92, 1.2, 0.96) }, { h: 0.5, pts: plan(0.9, 1.32, 0.99) },
  { h: 0.72, pts: plan(0.78, 1.2, 0.9, { pr: 2.2 }) }, { h: 0.84, pts: plan(0.6, 1.0, 0.68) },
];
// the 75 mm gun: where its breech sits, its length
const SHERMAN_GUN = { x: 1.0, y: 0.42, L: 1.5 };
const SHERMAN = { ring: [0.15, 1.66, 0], tip: [SHERMAN_GUN.x + SHERMAN_GUN.L, SHERMAN_GUN.y, 0] };
// a half-round profile in (x, y), round side forward: the rotor and gun shields seen from the side
const dee = (r, n = 6) => Array.from({ length: n + 1 }, (_, k) => { const a = -Math.PI / 2 + (Math.PI * k) / n; return [r * Math.cos(a), r * Math.sin(a)]; });
function shermanTurret(paint, owner, { roofGun = true, stowage = true } = {}) {
  const P = paint, lite = tone(P, 1.08), items = [];
  const cast = (g, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => at(g, tone(c, CAST), x, y, z, rx, ry, rz, 'cast-armor');
  items.push(cast(tower(SHERMAN_BODY), P));
  // the curved rotor shield wrapping the front of the turret, the gun shield on it, the 75 mm gun with its muzzle
  // swell and the coaxial gun
  items.push(cast(G.extrudeProfile(dee(0.31), 1.12, 0, { crease: 40 }), P, 0.74, SHERMAN_GUN.y, 0));
  items.push(cast(G.extrudeProfile(dee(0.23), 0.62, 0, { crease: 40 }), lite, 0.9, SHERMAN_GUN.y, 0));
  const L = SHERMAN_GUN.L;
  items.push(at(gun([[0.13, 0], [0.112, 0.1], [0.094, 0.2], [0.09, L - 0.22], [0.1, L - 0.15], [0.106, L - 0.1], [0.106, L]], P).geo, 0xffffff, SHERMAN_GUN.x, SHERMAN_GUN.y, 0));
  items.push(box(0.16, 0.04, 0.04, DARK, 1.12, 0.35, 0.23));
  // commander's cupola with its vision blocks, loader's hatch, periscopes
  items.push({ geo: upright(spin([[0.25, 0], [0.25, 0.06], [0.23, 0.12], [0.18, 0.15], [0, 0.16]], (b, s) => (b === 1 ? (s % 2 ? DARK : lite) : lite), 8)), matrix: G.xf(-0.15, 0.82, 0.42) });
  if (roofGun) items.push({ geo: upright(spin([[0.2, 0], [0.2, 0.045], [0.16, 0.06], [0.16, 0.03], [0, 0.03]], jit(lite, 1, 2), 10)), matrix: G.xf(-0.32, 0.84, -0.33) });
  else items.push(box(0.4, 0.04, 0.34, jit(lite, 1, 2), -0.32, 0.855, -0.33));
  items.push(box(0.2, 0.05, 0.04, DARK, -0.32, 0.9, -0.17));
  for (const z of [-0.3, 0.3]) items.push(box(0.1, 0.07, 0.13, DARK, 0.43, 0.86, z));
  if (roofGun) {
    // the .50 cal on its cradle post at the back of the roof: receiver, perforated jacket, barrel, ammo can, grips
    const gx = -0.72, gy = 1.14, gz = 0.45;
    items.push(box(0.05, 0.32, 0.05, DARK, gx, 0.98, gz), box(0.24, 0.11, 0.09, DARK, gx + 0.06, gy, gz));
    items.push({ geo: alongX(spin([[0, 0], [0.032, 0], [0.032, 0.34], [0, 0.34]], (b, s) => (b === 1 && s % 2 ? DARK : STEEL), 6)), matrix: G.xf(gx + 0.18, gy + 0.01, gz), mat: 'gunmetal' });
    items.push(box(0.5, 0.024, 0.024, DARK, gx + 0.72, gy + 0.01, gz), box(0.12, 0.1, 0.07, 0x4a4f2c, gx + 0.04, gy - 0.08, gz + 0.09), box(0.03, 0.09, 0.03, DARK, gx - 0.1, gy - 0.05, gz));
    // the aerial on its base
    items.push(box(0.06, 0.05, 0.06, DARK, -0.62, 0.84, -0.56), box(0.018, 0.8, 0.018, 0x3c4028, -0.62, 1.24, -0.56));
  }
  // stowage on the bustle: a rolled tarp and a bedroll on the rack over the turret's rear end
  if (stowage) {
    items.push({ geo: spin([[0, -0.5], [0.11, -0.5], [0.11, 0.5], [0, 0.5]], CANVAS, 8), matrix: G.xf(-1.28, 0.42, 0), mat: 'canvas' });
    items.push(box(0.1, 0.34, 1.0, tone(P, 0.9), -1.34, 0.3, 0), box(0.3, 0.05, 1.0, tone(P, 0.9), -1.3, 0.54, 0));
  }
  // white stars on the turret sides
  const star = G.star(1, { color: WHITE }), zs = sideZ(SHERMAN_BODY, 0.46, -0.3);
  for (const s of [-1, 1]) items.push(mark(star, -0.3, 0.46, s * zs, [0, 0.04, s], 0.15));
  // the owner's number block on each side and the stripe across the roof
  items.push(...ownerMarks(owner, { side: [0.3, 0.3, sideZ(SHERMAN_BODY, 0.3, 0.3), -0.09], roof: [0.2, 0.846, roofGun ? 0.45 : 0] }));
  return items;
}
// The T34 Calliope's launcher over the turret: a block of 4.6 inch tubes, round along their tops and sides and
// open at the front, banded at the ends and the middle, tilted up at the front on posts from the turret sides, and
// the arm that ties it to the gun so the rack elevates with it. The middle band is the owner's color.
function calliopeRack(paint, owner) {
  const P = paint, rows = 4, cols = 11, W = 2.1, pz = W / cols, py = 0.15, r = 0.09, L = 2.1;
  const X0 = 0.2, Y0 = 1.4, tilt = 0.4; // where the middle of the rack's underside sits over the turret, its elevation
  // the bundle's outline in (z, y) with outward normals and a shade per point, light on the tube crests and dark in
  // the valleys between them: up the right column, over the top row, down the left column
  const outline = [], a1 = Math.asin(Math.min(1, py / 2 / r)), top = 0.3, zr = W / 2 - pz / 2, yr = (j) => py * (j + 0.5);
  const arc = (zc, yc, b0, b1, n) => { for (let k = 0; k <= n; k++) { const a = b0 + ((b1 - b0) * k) / n; outline.push([zc + r * Math.cos(a), yc + r * Math.sin(a), Math.cos(a), Math.sin(a), 0.72 + 0.4 * Math.sin((Math.PI * k) / n)]); } };
  for (let j = 0; j < rows - 1; j++) arc(zr, yr(j), j ? -a1 : -Math.PI / 2, a1, j ? 2 : 3);
  arc(zr, yr(rows - 1), -a1, Math.PI - top, 4);
  for (let i = cols - 2; i >= 1; i--) arc(-W / 2 + pz * (i + 0.5), yr(rows - 1), top, Math.PI - top, 2);
  arc(-zr, yr(rows - 1), top, Math.PI + a1, 4);
  for (let j = rows - 2; j >= 0; j--) arc(-zr, yr(j), Math.PI - a1, j ? Math.PI + a1 : 1.5 * Math.PI, j ? 2 : 3);
  const m = mesh().use('gunmetal'), xa = -L / 2, xb = L / 2, N = outline.length, lit = tone(P, 1.12);
  const side = outline.map(([z, y, nz, ny, k]) => { const c = tone(P, k); return [m.v(xa, y, z, 0, ny, nz, c), m.v(xb, y, z, 0, ny, nz, c)]; });
  for (let i = 0; i < N; i++) { const [a, b] = side[i], [d, e] = side[(i + 1) % N]; m.quad(a, b, e, d); }
  // the back closed by a plain plate, the front face in a lighter tone with a round dark mouth for every tube
  const ym = (py * rows) / 2;
  { const c = m.v(xa, ym, 0, -1, 0, 0, tone(P, 0.8)), ring = outline.map(([z, y]) => m.v(xa, y, z, -1, 0, 0, tone(P, 0.8))); for (let i = 0; i < N; i++) m.tri(c, ring[i], ring[(i + 1) % N]); }
  {
    const c = m.v(xb, ym, 0, 1, 0, 0, lit), ring = outline.map(([z, y]) => m.v(xb, y, z, 1, 0, 0, lit));
    for (let i = 0; i < N; i++) m.tri(c, ring[i], ring[(i + 1) % N]);
    const fx = xb + 0.006, h = r * 0.74, mouth = 6;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const zc = -W / 2 + pz * (i + 0.5), yc = yr(j);
      m.face(Array.from({ length: mouth }, (_, k) => { const t = (k / mouth) * TAU + 0.3; return [fx, yc + h * Math.sin(t), zc + h * Math.cos(t)]; }), [1, 0, 0], DARK);
    }
  }
  const rack = [{ geo: m.geo() }];
  // frame bands round both ends and the middle (the middle one in the owner's color), rails under the bundle
  for (const x of [xa + 0.05, xb - 0.05]) rack.push(box(0.08, rows * py + 0.08, W + 0.06, tone(P, 0.85), x, ym, 0));
  rack.push(box(0.08, rows * py + 0.1, W + 0.08, tone(owner, 0.82), 0, ym, 0, 0, 0, 0, 'plain'));
  for (const s of [-1, 1]) rack.push(box(L - 0.2, 0.08, 0.08, P, 0, -0.05, s * 0.98));
  const items = [{ geo: G.merge(rack), matrix: G.xf(X0, Y0, 0, 0, 0, tilt) }];
  // frame: stout posts up from brackets on the turret sides with a diagonal brace, the elevation arm from a clamp
  // on the gun up to the rack's front
  const under = (x) => Y0 + (x - X0) * Math.tan(tilt) - 0.06;
  for (const s of [-1, 1]) {
    for (const x of [-0.5, 0.55]) items.push(box(0.12, under(x) - 0.2, 0.12, P, x, (under(x) + 0.2) / 2, s * 1.0), box(0.18, 0.16, 0.2, P, x, 0.26, s * 0.92));
    items.push(box(1.3, 0.07, 0.07, P, 0.025, 0.86, s * 1.0, 0, 0, 0.7));
  }
  const gx = SHERMAN_GUN.x + 0.7, gy = SHERMAN_GUN.y, fx = X0 + (L / 2) * Math.cos(tilt) - 0.1, fy = Y0 + (L / 2) * Math.sin(tilt) - 0.08;
  items.push(box(0.12, 0.2, 0.2, P, gx, gy, 0), box(Math.hypot(fx - gx, fy - gy), 0.07, 0.07, P, (gx + fx) / 2, (gy + fy) / 2, 0, 0, 0, Math.atan2(fy - gy, fx - gx)));
  return items;
}

// ---------------------------------------------------------------- Panzer IV Ausf. H (and the Wirbelwind on it)

function panzerHull(paint, skirts) {
  const P = paint, lite = tone(P, 1.1), items = [];
  // lower hull between the tracks: sloped lower nose, the nose plate, the shallow glacis, the rear plate
  items.push(at(G.extrudeProfile([[2.3, 0.4], [2.66, 0.62], [2.68, 1.0], [1.85, 1.17], [-2.62, 1.17], [-2.62, 0.7], [-2.4, 0.4]], 1.8, 0.04, { segments: 1 }), P));
  // superstructure over the fenders, then the engine deck a step lower
  items.push(at(G.extrudeProfile([[1.85, 1.1], [1.85, 1.62], [-0.55, 1.62], [-0.62, 1.57], [-2.56, 1.57], [-2.64, 1.48], [-2.64, 1.1]], 2.24, 0.04, { segments: 1 }), P));
  // fenders, the front ones turned down over the sprockets
  for (const s of [-1, 1]) {
    items.push(box(4.6, 0.03, 0.36, lite, -0.2, 1.1, s * 1.12));
    items.push(box(0.6, 0.03, 0.36, lite, 2.35, 1.03, s * 1.12, 0, 0, -0.25));
  }
  // driver's visor and the bow machine gun ball on the front plate
  items.push(box(0.08, 0.14, 0.34, lite, 1.88, 1.42, -0.45), box(0.02, 0.03, 0.22, DARK, 1.93, 1.44, -0.45));
  items.push({ geo: upright(spin([[0.14, 0], [0.13, 0.05], [0.08, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(1.85, 1.38, 0.45, 0, 0, -Math.PI / 2) });
  items.push(box(0.3, 0.035, 0.035, DARK, 2.05, 1.38, 0.45));
  // spare track links: two rows across the nose plate, one under the visor
  items.push({ geo: G.tag(linkRow(9, 0.18, 2.67, 0.72, 0), 'track-steel') }, { geo: G.tag(linkRow(9, 0.18, 2.675, 0.88, 0), 'track-steel') }, { geo: G.tag(linkRow(5, 0.18, 1.85, 1.22, -0.15), 'track-steel') });
  items.push(box(0.4, 0.04, 0.16, P, 2.18, 1.13, -0.6, 0, 0, -0.2), box(0.4, 0.04, 0.16, P, 2.18, 1.13, 0.6, 0, 0, -0.2)); // brake hatches
  // engine deck hatches, the slatted air intakes, the big rusted muffler on the rear plate
  for (const z of [-0.48, 0.48]) items.push(box(0.85, 0.04, 0.62, lite, -1.3, 1.59, z));
  for (const s of [-1, 1]) items.push({ geo: grille(-2.35, -1.78, s * 0.86 - 0.17, s * 0.86 + 0.17, 1.575, 6, tone(P, 0.42), tone(P, 0.78)) });
  items.push({ geo: spin([[0, -0.4], [0.15, -0.4], [0.15, 0.4], [0, 0.4]], RUST, 8), color: 0xffffff, matrix: G.xf(-2.78, 0.95, -0.15), mat: 'track-steel' });
  items.push(box(0.05, 0.3, 0.12, RUST, -2.7, 1.25, -0.15, 0, 0, 0, 'track-steel'));
  // tools and a jack on the fenders, the headlight
  items.push(box(1.2, 0.04, 0.05, WOOD, -0.6, 1.14, 1.12, 0, 0, 0, 'wood'), box(0.2, 0.03, 0.15, STEEL, -1.25, 1.14, 1.12, 0, 0, 0, 'gunmetal'));
  items.push(box(1.4, 0.035, 0.04, STEEL, -0.4, 1.14, -1.08, 0, 0, 0, 'gunmetal'), box(0.25, 0.14, 0.14, P, 0.7, 1.19, -1.1));
  items.push({ geo: alongX(spin([[0.07, -0.08], [0.07, 0.05], [0, 0.06]], STEEL, 8)), color: 0xffffff, matrix: G.xf(1.95, 1.2, -1.02) });
  // running gear: eight small road wheels per side in leaf-sprung pairs, four return rollers, front sprocket,
  // rear idler
  // the road wheels are 0.47 across and nearly touch, as on the real tank
  const TZ = 1.1, gear = [], wheels = [], WY = 0.315, rw = wheel(0.235, 0.26, P, { rubber: 0.05, hub: 0.38, face: 1.05, S: 9 });
  for (const bx of [1.4, 0.47, -0.47, -1.4]) {
    for (const dx of [0.225, -0.225]) { gear.push(at(rw, 0xffffff, bx + dx, WY, TZ)); wheels.push({ x: bx + dx, y: WY, r: 0.235 }); }
    gear.push(box(0.5, 0.16, 0.1, lite, bx, 0.4, TZ - 0.17));
    gear.push(box(0.44, 0.05, 0.08, STEEL, bx + 0.05, 0.54, TZ - 0.17, 0, 0, 0.12));
  }
  const rollers = [1.55, 0.6, -0.35, -1.3].map((x) => ({ x, y: 0.79, r: 0.075 }));
  for (const r of rollers) gear.push(at(roller(0.075, 0.16, P), 0xffffff, r.x, r.y, TZ));
  gear.push(at(sprocket(0.28, 12, 0.3, P), 0xffffff, 2.36, 0.6, TZ));
  gear.push(at(wheel(0.26, 0.26, P, { rubber: 0, holes: 6, S: 10, hub: 0.3, ring: 0.64, hole: 0.15, face: 1.2 }), 0xffffff, -2.42, 0.56, TZ));
  const line = beltLine([{ x: -2.42, y: 0.56, r: 0.26 }, ...wheels.sort((a, b) => a.x - b.x), { x: 2.36, y: 0.6, r: 0.28 }, ...rollers]);
  gear.push(at(trackBelt(line, 0, 0.38, 0.085, 0.28), 0xffffff, 0, 0, TZ));
  if (skirts) {
    // a rolled tarp and a box on the fenders
    items.push({ geo: alongX(spin([[0, -0.45], [0.075, -0.45], [0.075, 0.45], [0, 0.45]], CANVAS, 8)), matrix: G.xf(1.0, 1.18, 1.1), mat: 'canvas' });
    items.push(box(0.5, 0.15, 0.26, jit(P, 2, 8), -1.95, 1.19, 1.1), box(0.4, 0.13, 0.24, jit(P, 3, 8), -1.9, 1.18, -1.1));
    // Schuerzen: five plates a side hung from a rail, from the rear idler to the sprocket, with an angled plate
    // turning in at the front; they hide the upper run and the rollers but not the road wheels. A cross on the
    // middle plate.
    // the plates hang a touch out of true and each takes a slightly different tone
    const n = 5, x0 = -2.3, len = 4.45, w = len / n, z = 1.38, y = 1.1, hh = 0.45, cut = 0.14, e = 0.012;
    for (let k = 0; k < n; k++) {
      const x = x0 + w * k + w / 2, c = jit(P, k, 1, 0.06), lean = (rnd(k, 9) - 0.5) * 0.03;
      if (k === n - 1) gear.push(at(G.extrudeProfile([[-w / 2 + e, -hh], [w / 2 - cut, -hh], [w / 2 - e, -hh + cut], [w / 2 - e, hh], [-w / 2 + e, hh]], 0.025, 0), c, x, y, z, lean));
      else if (k === 0) gear.push(at(G.extrudeProfile([[-w / 2 + cut, -hh], [w / 2 - e, -hh], [w / 2 - e, hh], [-w / 2 + e, hh], [-w / 2 + e, -hh + cut]], 0.025, 0), c, x, y, z, lean));
      else gear.push(box(w - 0.024, hh * 2, 0.025, c, x, y, z, lean));
    }
    gear.push(at(G.extrudeProfile([[-0.15, -hh + cut], [0.15, -hh + cut * 1.6], [0.15, hh - 0.04], [-0.15, hh]], 0.025, 0), jit(P, 7, 1, 0.06), x0 + len + 0.125, y, z - 0.085, 0, 0.6, 0));
    gear.push(box(len, 0.04, 0.05, lite, x0 + len / 2, y + hh - 0.03, z - 0.04));
    for (let k = 0; k < 4; k++) gear.push(box(0.05, 0.04, 0.2, P, x0 + 0.5 + k * 1.15, y + hh - 0.06, z - 0.12));
    gear.push(mark(G.balkenkreuz(1), x0 + w * 2.5, y, z + 0.013, [0, 0, 1], 0.2));
  } else {
    gear.push(mark(G.balkenkreuz(1), -0.9, 1.36, 1.12, [0, 0, 1], 0.17));
    // a rolled tarp across the engine deck behind the turret, the cable along the right fender
    items.push({ geo: spin([[0, -0.55], [0.1, -0.55], [0.1, 0.55], [0, 0.55]], CANVAS, 8), matrix: G.xf(-1.0, 1.67, 0), mat: 'canvas' });
    items.push(box(2.6, 0.03, 0.04, DARK, 0.3, 1.13, 1.2, 0, 0, 0, 'gunmetal'));
  }
  items.push({ geo: bothSides(gear) });
  return finish(items, { height: 1.15, ...GREY });
}
const PANZER_BODY = [
  { h: 0, pts: [[0.94, 0.56], [0.49, 0.84], [-0.98, 0.84], [-1.2, 0.6], [-1.2, -0.6], [-0.98, -0.84], [0.49, -0.84], [0.94, -0.56]] },
  { h: 0.7, pts: [[0.83, 0.45], [0.39, 0.65], [-0.94, 0.65], [-1.09, 0.48], [-1.09, -0.48], [-0.94, -0.65], [0.39, -0.65], [0.83, -0.45]] },
];
const PANZER_GUN = { x: 1.06, y: 0.38, L: 2.7 };
const PANZER = { ring: [0.14, 1.62, -0.05], tip: [PANZER_GUN.x + PANZER_GUN.L, PANZER_GUN.y, 0] };
// a plan outline [[x, z], ...] stood up as a wall from y0 to y1
const wall = (outline, y0, y1) => G.extrudeProfile(outline, y1 - y0, 0, { crease: 30 }).rotateX(Math.PI / 2).translate(0, (y0 + y1) / 2, 0);
// an open plan line [[x, z], ...] made a closed outline t thick, thickened to the line's left (inward for a line
// that runs clockwise round the turret seen from above)
function thicken(line, t) {
  const nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [-dz / l, dx / l]; };
  const off = line.map((p, i) => {
    const n0 = i > 0 ? nrm(line[i - 1], p) : nrm(p, line[i + 1]), n1 = i + 1 < line.length ? nrm(p, line[i + 1]) : n0;
    const mx = n0[0] + n1[0], mz = n0[1] + n1[1], k = t / Math.max(0.3, mx * n0[0] + mz * n0[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
  return [...line, ...off.reverse()];
}
// the turret skirts' plan: round the sides and back, their front corners bent in beside the mantlet
const SKIRT = [[1.0, 0.86], [0.82, 1.04], [-1.24, 1.04], [-1.45, 0.82], [-1.45, -0.82], [-1.24, -1.04], [0.82, -1.04], [1.0, -0.86]];
function panzerTurret(paint, owner) {
  const P = paint, lite = tone(P, 1.08), items = [];
  items.push(at(tower(PANZER_BODY, { normals: 'flat' }), P));
  // turret skirts on brackets, crosses and the owner's number block on the sides
  items.push(at(wall(thicken(SKIRT, 0.025), 0.12, 0.6), tone(P, 0.97)));
  for (const s of [-1, 1]) for (const x of [-0.4, -1.0]) items.push(box(0.05, 0.05, 0.32, P, x, 0.5, s * 0.87));
  const cross = G.balkenkreuz(1);
  for (const s of [-1, 1]) items.push(mark(cross, -0.55, 0.36, s * 1.04, [0, 0, s], 0.16));
  // mantlet and the long 7.5 cm gun with its double-baffle muzzle brake
  items.push(at(G.bevelBox(0.3, 0.44, 0.7, 0.07, 2), tone(lite, CAST), 1.01, PANZER_GUN.y, 0, 0, 0, 0, 'cast-armor'));
  for (const z of [-0.43, 0.43]) items.push(box(0.06, 0.05, 0.1, DARK, 0.875, 0.5, z, 0, 0, 0.14)); // vision ports
  items.push(at(gun([[0.12, 0], [0.08, 0.2], [0.06, 0.5], [0.055, 2.35], [0.105, 2.38], [0.105, 2.5], [0.065, 2.53], [0.065, 2.56], [0.105, 2.59], [0.105, 2.7]], P).geo, 0xffffff, PANZER_GUN.x, PANZER_GUN.y, 0));
  items.push(box(0.14, 0.04, 0.04, DARK, 1.18, 0.44, -0.22));
  // commander's cupola at the back: vision blocks round its wall, the hatch ring on top; roof hatch and a vent
  items.push({ geo: upright(spin([[0.26, 0], [0.29, 0.08], [0.29, 0.15], [0.24, 0.19], [0.19, 0.2], [0.19, 0.24], [0, 0.24]], (b, s) => (b === 1 ? (s % 2 ? DARK : lite) : b === 4 ? P : b === 0 ? P : lite), 8)), matrix: G.xf(-0.82, 0.7, 0) });
  items.push(box(0.36, 0.04, 0.3, jit(lite, 4, 4), 0.25, 0.72, 0.3), box(0.1, 0.05, 0.1, STEEL, 0.35, 0.73, -0.25));
  items.push(...ownerMarks(owner, { side: [0.3, 0.36, 1.04, 0], roof: [-0.28, 0.706, 0.45], w: 0.34 }));
  return items;
}
// The Wirbelwind's open eight-sided turret and its four 2 cm guns, raised for aircraft. Returns the muzzle too.
function wirbelwindTurret(paint, owner) {
  const P = paint, items = [], a0 = Math.PI / 8, inside = 0x8b8266, floor = tone(inside, 0.62);
  // tub walls 1.14 high with flat faces front, back and sides: a short skirt flaring out to r 1.14, then leaning in
  // to 0.96 at the rim; lighter rim (the owner's color on the front and back faces), warm tan inside like the real
  // turret, and a darker floor. The tub sits inside the hull's width.
  const tub = spin([[1.0, 0], [1.14, 0.38], [0.96, 1.14], [0.91, 1.14], [1.0, 0.38], [0.9, 0.12], [0, 0.12]], (b, s) => (b === 2 ? (s === 7 || s === 3 ? owner : tone(P, 1.12)) : [P, P, 0, inside, inside, floor][b]), 8, { flat: true, a0 });
  items.push({ geo: upright(tub) });
  // the flat faces are apothem = r * cos(22.5 degrees) out, the walls lean in 0.18 over 0.76: a cross and, behind it,
  // the owner's number block on each of the two side faces
  const ap = Math.cos(Math.PI / 8), wr = (y) => 1.14 - ((y - 0.38) / 0.76) * 0.18, lean = 0.18 / 0.76 / ap, block = plate(0.26, 0.14, owner);
  for (const s of [-1, 1]) {
    const r = wr(0.6) * ap, n = [0, lean, s];
    items.push(mark(G.balkenkreuz(1), 0.2, 0.6, s * r, n, 0.2), mark(block, -0.27, 0.6, s * r, n, 1));
  }
  // Flakvierling: pedestal, cradle, four barrels in two stacked pairs, each pair in its receiver with its
  // magazines, raised for aircraft. The upper barrels sit a little wider than the lower ones, so all four show
  // from the front. Dark blued barrels against the light interior so the guns read.
  const el = 0.5, px = 0.0, py = 0.82, c = Math.cos(el), s = Math.sin(el), len = 2.1, REC = 0x55565a, MAG = 0x2a2b2d;
  items.push(at(new THREE.CylinderGeometry(0.2, 0.28, 0.6, 8), tone(inside, 0.55), px, 0.42, 0, 0, 0, 0, 'gunmetal'));
  items.push(box(0.6, 0.28, 0.3, REC, px, py, 0, 0, 0, el, 'gunmetal'));
  for (const dz of [-0.5, 0.5]) items.push(box(0.6, 0.12, 0.05, REC, px - 0.05, py + 0.05, dz, 0, 0, el, 'gunmetal')); // cradle sides
  const barrel = gun([[0.06, 0], [0.05, 0.15], [0.048, len - 0.24], [0.055, len - 0.22], [0.08, len]], BARREL, 6).geo;
  for (const sz of [-1, 1]) {
    items.push(box(0.6, 0.38, 0.22, tone(REC, 1.2), px - 0.06 * c, py - 0.06 * s, sz * 0.28, 0, 0, el, 'gunmetal')); // receiver
    for (const [dy, dz] of [[-0.12, 0.22], [0.12, 0.34]]) {
      const bx = px - 0.3 * c - dy * s, by = py - 0.3 * s + dy * c;
      items.push({ geo: barrel, matrix: G.xf(bx, by, sz * dz, 0, 0, el) });
      items.push(box(0.16, 0.2, 0.06, MAG, bx + 0.3 * c - 0.04 * s, by + 0.3 * s + 0.04 * c, sz * 0.43, 0, 0, el, 'gunmetal')); // magazine
    }
  }
  items.push(box(0.24, 0.08, 0.28, tone(inside, 0.5), -0.55, 0.5, 0, 0, 0, 0, 'leather')); // gunner's seat
  const tip = [px - 0.3 * c - 0.12 * s + len * c, py - 0.3 * s + 0.12 * c + len * s, 0.34];
  return { items, tip };
}

// ---------------------------------------------------------------- T-34/76, 1943 hexagonal turret

// hull cross-section at x: sponson sides sloped 40 degrees from `side` at the fender line (sb) in to `deck` at the top
function t34Section(x, top, bot, sb = 0.98, side = 1.33, lw = 0.86) {
  const deck = Math.max(lw, side - Math.max(0, top - sb) * 0.84);
  return { x, pts: [[side, sb], [deck, top], [-deck, top], [-side, sb], [-lw, sb], [-lw, bot], [lw, bot], [lw, sb]] };
}
function t34Hull(paint) {
  const P = paint, lite = tone(P, 1.1), items = [];
  // nose edge, lower glacis, the long 60 degree upper glacis, deck, sloped rear plates
  const sec = [
    { x: 2.7, pts: [[0.86, 0.79], [0.86, 0.8], [-0.86, 0.8], [-0.86, 0.79], [-0.86, 0.78], [-0.86, 0.76], [0.86, 0.76], [0.86, 0.78]] },
    t34Section(2.3, 1.02, 0.4, 0.98, 1.33), t34Section(1.62, 1.4, 0.4), t34Section(-2.25, 1.4, 0.4), t34Section(-2.66, 1.1, 0.62),
  ];
  items.push(at(G.loft(sec, { normals: 30 }), P));
  // fenders: a lip along the sponsons, flat plates past both ends of the hull, the front one with a short lip
  for (const s of [-1, 1]) {
    items.push(box(4.9, 0.04, 0.05, lite, -0.1, 0.97, s * 1.34));
    items.push(box(0.5, 0.03, 0.54, lite, 2.55, 0.975, s * 1.1), box(0.03, 0.09, 0.54, lite, 2.8, 0.94, s * 1.1));
    items.push(box(0.24, 0.03, 0.54, lite, -2.76, 0.975, s * 1.1));
  }
  // glacis: driver's hatch with its vision blocks, the bow machine gun, tow hooks, headlight
  const gl = (t) => [2.7 - 1.08 * t, 0.8 + 0.6 * t], gn = [0.486, 0.874, 0], ga = -0.508;
  { const [x, y] = gl(0.6); items.push(box(0.58, 0.08, 0.5, lite, x + gn[0] * 0.03, y + gn[1] * 0.03, -0.42, 0, 0, ga)); for (const z of [-0.55, -0.29]) items.push(box(0.06, 0.06, 0.1, DARK, x - 0.15 + gn[0] * 0.08, y + 0.08 + gn[1] * 0.08, z, 0, 0, ga)); }
  { const [x, y] = gl(0.42); items.push({ geo: upright(spin([[0.13, 0], [0.12, 0.05], [0.07, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(x, y, 0.45, 0, 0, ga) }, box(0.3, 0.035, 0.035, DARK, x + 0.2, y + 0.07, 0.45)); }
  for (const z of [-0.6, 0.6]) items.push(box(0.12, 0.08, 0.06, STEEL, 2.72, 0.7, z));
  items.push({ geo: alongX(spin([[0.08, -0.06], [0.08, 0.06], [0, 0.07]], STEEL, 8)), color: 0xffffff, matrix: G.xf(2.15, 1.18, -0.75) });
  // engine deck: the louvred grille, the engine hatch, round transmission hatch and exhausts at the back
  items.push({ geo: grille(-1.7, -0.8, -0.55, 0.55, 1.402, 6, tone(P, 0.35), tone(P, 0.85)) });
  items.push(box(0.6, 0.04, 0.7, lite, -0.35, 1.415, 0));
  items.push({ geo: upright(spin([[0.24, 0], [0.24, 0.03], [0.2, 0.05], [0, 0.06]], lite, 10)), color: 0xffffff, matrix: G.xf(-2.45, 1.25, 0, 0, 0, 0.64) });
  for (const z of [-0.55, 0.55]) items.push({ geo: alongX(spin([[0.07, -0.12], [0.07, 0.1], [0.04, 0.1], [0, 0.06]], RUST, 7)), color: 0xffffff, matrix: G.xf(-2.62, 0.82, z, 0, 0, -0.35), mat: 'track-steel' }, box(0.1, 0.22, 0.2, P, -2.6, 0.82, z, 0, 0, -0.35));
  // one long fuel tank on the back of each sloped sponson, held by three flat straps; a toolbox
  const sn = [0, 0.64, 0.768], tank = alongX(spin([[0, -0.5], [0.16, -0.5], [0.16, 0.5], [0, 0.5]], lite, 9)), strap = alongX(spin([[0.168, -0.03], [0.168, 0.03]], STEEL, 9));
  for (const s of [-1, 1]) {
    const ty = 1.19 + sn[1] * 0.17, tz = s * (1.155 + sn[2] * 0.17);
    items.push({ geo: tank, matrix: G.xf(-1.72, ty, tz) });
    for (const dx of [-0.36, 0, 0.36]) items.push({ geo: strap, matrix: G.xf(-1.72 + dx, ty, tz) });
  }
  items.push(box(0.7, 0.2, 0.3, lite, 0.6, 1.1, 1.2));
  // the unditching log chained along the left fender
  items.push({ geo: alongX(spin([[0, -1.1], [0.1, -1.1], [0.1, 1.1], [0, 1.1]], WOOD, 8)), matrix: G.xf(0.3, 1.1, -1.2), mat: 'wood' });
  for (const x of [-0.5, 0.2, 0.9]) items.push(box(0.04, 0.05, 0.25, STEEL, x, 1.1, -1.2, 0, 0, 0, 'gunmetal'));
  items.push(christie(P));
  return finish(items, { height: 1.1, dark: 0.84, under: 0.06, nose: [2.2, 5] });
}
// The T-34's running gear, both sides: five big Christie road wheels with spoked faces, no return rollers, the front
// idler and the rear drive wheel; the wide track with its alternating horned links
function christie(P) {
  const TZ = 1.1, gear = [], bottom = [], top = [], rw = wheel(0.37, 0.34, P, { rubber: 0.08, holes: 6, S: 10, hub: 0.26, ring: 0.6, hole: 0.1 });
  for (const x of [1.74, 0.87, 0, -0.87, -1.74]) {
    gear.push(at(rw, 0xffffff, x, 0.44, TZ));
    bottom.push({ x, y: 0.44, r: 0.37 }); top.unshift({ x, y: 0.44, r: 0.37, top: true });
  }
  top.reverse();
  gear.push(at(wheel(0.3, 0.3, P, { rubber: 0, holes: 6, S: 10, hub: 0.3, ring: 0.62, hole: 0.12 }), 0xffffff, 2.42, 0.5, TZ));
  gear.push(at(wheel(0.32, 0.3, P, { rubber: 0, holes: 6, S: 10, hub: 0.36, ring: 0.66, hole: 0.11 }), 0xffffff, -2.42, 0.56, TZ));
  const line = beltLine([{ x: -2.42, y: 0.56, r: 0.32 }, ...bottom.slice().reverse(), { x: 2.42, y: 0.5, r: 0.3 }, ...top], 0.05);
  gear.push(at(trackBelt(line, 0, 0.52, 0.11, 0.26, { spuds: 0.05 }), 0xffffff, 0, 0, TZ));
  return { geo: bothSides(gear) };
}
const T34_BODY = [
  { h: 0, pts: [[1.05, 0.5], [0.15, 0.95], [-1.25, 0.68], [-1.25, -0.68], [0.15, -0.95], [1.05, -0.5]] },
  { h: 0.64, pts: [[0.72, 0.34], [0.08, 0.76], [-1.12, 0.54], [-1.12, -0.54], [0.08, -0.76], [0.72, -0.34]] },
];
const T34_GUN = { x: 1.3, y: 0.34, L: 1.55 };
const T34 = { ring: [0.55, 1.4, 0], tip: [T34_GUN.x + T34_GUN.L, T34_GUN.y, 0] };
function t34Turret(paint, owner) {
  const P = paint, lite = tone(P, 1.08), items = [];
  items.push(at(tower(T34_BODY, { normals: 'flat' }), tone(P, CAST), 0, 0, 0, 0, 0, 0, 'cast-armor'));
  // the rounded cast mantlet (the "pig snout") tapering into the 76 mm F-34
  const snout = G.loft([{ x: 0, w: 0.56, h: 0.44, p: 3.2 }, { x: 0.18, w: 0.52, h: 0.4, p: 3 }, { x: 0.34, w: 0.36, h: 0.3, p: 2.6 }, { x: 0.46, w: 0.2, h: 0.2, p: 2 }], { segments: 12, normals: 50 });
  items.push(at(snout, tone(lite, CAST), 0.86, T34_GUN.y, 0, 0, 0, 0, 'cast-armor'));
  const L = T34_GUN.L;
  items.push(at(gun([[0.075, 0], [0.062, 0.2], [0.054, L - 0.06], [0.064, L - 0.04], [0.064, L]], P).geo, 0xffffff, T34_GUN.x, T34_GUN.y, 0));
  // the two round roof hatches, periscopes, a vent; red stars on the rear side faces
  for (const z of [-0.3, 0.3]) items.push({ geo: upright(spin([[0.21, 0], [0.21, 0.04], [0.17, 0.07], [0, 0.08]], jit(lite, z, 6), 8)), matrix: G.xf(-0.4, 0.64, z) });
  for (const z of [-0.4, 0.4]) items.push(box(0.12, 0.07, 0.08, DARK, 0.3, 0.66, z));
  items.push(box(0.14, 0.05, 0.14, STEEL, 0.15, 0.665, 0, 0, 0, 0, 'gunmetal'));
  const star = G.star(1, { color: 0xb02a20, border: WHITE, edge: 0.08 }), zs = sideZ(T34_BODY, 0.28, -0.5);
  // the rear side face's outward normal tilts back (its plan runs in toward the rear) and up (the walls lean in)
  for (const s of [-1, 1]) items.push(mark(star, -0.5, 0.28, s * zs, [-0.19, 0.24, s * 0.96], 0.2));
  // the owner's number block on each front side face (those faces turn forward about 27 degrees) and the stripe across the roof
  const zf = sideZ(T34_BODY, 0.3, 0.62);
  items.push(...ownerMarks(owner, { side: [0.62, 0.3, 0, 0], roof: [-0.08, 0.646, 0.42], stripe: 0.07 }));
  const block = plate(0.3, 0.15, owner);
  for (const s of [-1, 1]) items.push(mark(block, 0.62, 0.3, s * zf, [0.41, 0.41, s * 0.82], 1));
  return items;
}

// ---------------------------------------------------------------- tank destroyers: M10, StuG III Ausf. G, SU-85

// An open-topped armored tub on a convex plan ring [[x, z], ...]: walls from y0 up to tops (one height, or one per
// corner), leaning in by `lean` per metre up and `t` thick. Each wall shows its painted outside, its darker inside
// (down to the floor at fy) and a lit top edge; rim(i) may give wall i's top edge another color (the owner's, flat
// paint). The floor closes it.
function openTub(ring, { y0, tops, lean, t, paint, inside, floor, fy = y0, rim = null }) {
  const m = mesh(), n = ring.length, top = (i) => (Array.isArray(tops) ? tops[i] : tops);
  const cx = ring.reduce((s, p) => s + p[0], 0) / n, cz = ring.reduce((s, p) => s + p[1], 0) / n;
  const outward = ring.map((a, i) => {
    const b = ring[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), o = [(b[1] - a[1]) / l, (a[0] - b[0]) / l];
    return o[0] * ((a[0] + b[0]) / 2 - cx) + o[1] * ((a[1] + b[1]) / 2 - cz) < 0 ? [-o[0], -o[1]] : o;
  });
  // corner i pulled in by d, along the bisector of its two walls
  const pull = (i, d) => { const p = outward[(i + n - 1) % n], q = outward[i], k = d / (1 + p[0] * q[0] + p[1] * q[1]); return [ring[i][0] - (p[0] + q[0]) * k, ring[i][1] - (p[1] + q[1]) * k]; };
  const out = (i, h) => pull(i, lean * (h - y0)), inn = (i, h) => pull(i, t + lean * (h - y0)), tilt = Math.atan(lean);
  ring.forEach((a, i) => {
    const j = (i + 1) % n, o = outward[i], N = [o[0] * Math.cos(tilt), Math.sin(tilt), o[1] * Math.cos(tilt)], ti = top(i), tj = top(j);
    const oi = out(i, ti), oj = out(j, tj), ii = inn(i, ti), ij = inn(j, tj), fi = inn(i, fy), fj = inn(j, fy), own = rim?.(i);
    m.use(null).face([[a[0], y0, a[1]], [ring[j][0], y0, ring[j][1]], [oj[0], tj, oj[1]], [oi[0], ti, oi[1]]], N, paint);
    m.face([[fi[0], fy, fi[1]], [fj[0], fy, fj[1]], [ij[0], tj, ij[1]], [ii[0], ti, ii[1]]], [-N[0], -N[1], -N[2]], inside);
    m.use(own ? 'plain' : null).face([[oi[0], ti, oi[1]], [oj[0], tj, oj[1]], [ij[0], tj, ij[1]], [ii[0], ti, ii[1]]], [0, 1, 0], own ?? tone(paint, 1.12));
  });
  m.use(null).face(ring.map((_, i) => inn(i, fy)).map(([x, z]) => [x, fy, z]), [0, 1, 0], floor);
  return m.geo();
}
// a raised bolt head facing +z (laid on a plate with G.place)
const boltHead = (color) => spin([[0.032, 0], [0.032, 0.016], [0.02, 0.026], [0, 0.028]], color, 6);

// M10 Wolverine: the Sherman's lower hull and running gear under a low welded upper hull whose sides slope in at 38
// degrees, studded with the bosses that took bolt-on armor; the open five-sided turret with sloped walls, the wedge
// counterweights hung on its back, the long 3 inch M7 in its wide gun shield and the .50 cal on the rear rim.
function m10Hull(P) {
  const lite = tone(P, 1.1), items = [];
  const sec = (x, top, half) => ({ x, pts: [[1.2, 1.0], [half, top], [-half, top], [-1.2, 1.0]] });
  items.push(at(G.loft([sec(2.62, 1.03, 1.17), sec(1.42, 1.64, 0.8), sec(-2.2, 1.64, 0.8), sec(-2.62, 1.38, 0.86)], { normals: 'flat' }), P));
  // the Sherman's lower hull: the rounded transmission cover, the final drive housings, bolting flanges, tow hooks
  items.push(at(G.extrudeProfile([[2.2, 0.42], [2.52, 0.5], [2.7, 0.68], [2.74, 0.86], [2.64, 1.03], [-2.55, 1.03], [-2.62, 0.74], [-2.42, 0.42]], 1.84, 0.05, { segments: 1 }), P));
  const lump = G.loft([{ x: 2.45, w: 0.58, h: 0.5, p: 2.8 }, { x: 2.7, w: 0.56, h: 0.48, p: 2.8 }, { x: 2.78, w: 0.46, h: 0.38, p: 2.6 }], { segments: 10, normals: 50 });
  for (const z of [-0.64, 0.64]) items.push(at(lump, tone(P, CAST), 0, 0.77, z, 0, 0, 0, 'cast-armor'));
  for (const z of [-0.2, 0.2]) items.push(box(0.05, 0.4, 0.04, lite, 2.74, 0.8, z, 0, 0, -0.2, 'cast-armor'));
  for (const z of [-0.3, 0.3]) items.push(box(0.1, 0.1, 0.06, STEEL, 2.72, 0.5, z * 1.1, 0, 0, 0, 'gunmetal'));
  // glacis: a point t along it on the centre line, its normal and angle; lifting eyes, headlights with brush guards,
  // two rows of armor bosses
  const gl = (t) => [2.62 - 1.2 * t, 1.03 + 0.61 * t], gn = [0.453, 0.891, 0], ga = -0.47, stud = boltHead(lite);
  for (const z of [-0.85, 0.85]) {
    const [x, y] = gl(0.12);
    items.push(box(0.12, 0.12, 0.12, STEEL, x + 0.04, y + 0.06, z), box(0.04, 0.16, 0.2, P, x + 0.12, y + 0.06, z));
  }
  for (const z of [-0.55, 0.55]) { const [x, y] = gl(0.7); items.push(box(0.1, 0.08, 0.04, STEEL, x + gn[0] * 0.05, y + gn[1] * 0.05, z, 0, 0, ga, 'gunmetal')); }
  for (const t of [0.3, 0.55]) for (let k = 0; k < 5; k++) { const [x, y] = gl(t), z = (k - 2) * 0.36; items.push({ geo: stud, matrix: G.place([x, y, z], gn, [-0.891, 0.453, 0]) }); }
  for (const z of [-1.14, 1.14]) items.push(box(0.46, 0.035, 0.42, lite, 2.46, 1.1, z, 0, 0, -0.1));
  for (const z of [-1.22, 1.22]) items.push(box(4.7, 0.05, 0.05, lite, -0.02, 1.02, z));
  // the drivers' hatches on the deck front with their periscopes
  for (const z of [-0.42, 0.42]) items.push(box(0.5, 0.04, 0.42, jit(lite, z, 1), 1.12, 1.66, z), box(0.08, 0.07, 0.14, DARK, 1.36, 1.69, z));
  // the sloped sides: rows of armor bosses (round a white star), a pioneer tool on each
  const zAt = (y) => 1.2 - (y - 1.0) * 0.625;
  for (const s of [-1, 1]) {
    const n = [0, 0.53, s * 0.848], up = [0, 0.848, -s * 0.53];
    for (const y of [1.17, 1.47]) for (let x = -1.95; x < 1.3; x += 0.54) if (Math.abs(x + 0.6) > 0.32) items.push({ geo: stud, matrix: G.place([x, y, s * zAt(y)], n, up) });
    items.push(mark(G.star(1, { color: WHITE }), -0.6, 1.33, s * zAt(1.33), n, 0.22, up));
    const yt = 1.08;
    items.push(box(1.0, 0.045, 0.04, WOOD, -1.1, yt, s * (zAt(yt) + 0.03), 0, 0, 0, 'wood'), box(0.24, 0.16, 0.03, STEEL, -0.48, yt, s * (zAt(yt) + 0.03), 0, 0, 0, 'gunmetal'));
  }
  // engine deck: doors, the grille, fuel caps, a star; the exhaust deflector, air cleaners and cans on the rear plate
  for (const z of [-0.47, 0.47]) items.push(box(0.52, 0.03, 0.86, lite, -1.25, 1.655, z));
  items.push({ geo: grille(-2.12, -1.6, -0.7, 0.7, 1.645, 6, tone(P, 0.35), tone(P, 0.8)) });
  for (const z of [-0.65, 0.65]) items.push({ geo: upright(spin([[0.08, 0], [0.08, 0.03], [0, 0.04]], STEEL, 6)), matrix: G.xf(-0.78, 1.64, z) });
  items.push(box(0.04, 0.24, 1.7, P, -2.655, 1.2, 0, 0, 0, 0.12));
  for (const z of [-0.78, 0.78]) items.push({ geo: upright(spin([[0.11, -0.2], [0.11, 0.2], [0, 0.2]], P, 6)), matrix: G.xf(-2.72, 1.12, z) });
  for (const z of [-0.3, 0, 0.3]) items.push(box(0.1, 0.32, 0.2, jit(tone(P, 0.95), z, 5), -2.74, 1.18, z * 1.1, 0, 0, 0.04));
  items.push(vvss(P));
  return finish(items, { height: 1.2 });
}
const M10_GUN = { x: 1.0, y: 0.36, L: 2.55 };
const M10 = { ring: [-0.1, 1.64, 0], tip: [M10_GUN.x + M10_GUN.L, M10_GUN.y, 0] };
function m10Turret(paint, owner) {
  const P = paint, lite = tone(P, 1.08), items = [], TH = 0.78, LEAN = 0.3;
  // the five walls: the front plate, two cheeks turning back to the sides, the sides, the back (the owner's color on
  // its top edge); the inside a lighter olive, the floor dark
  const ring = [[0.92, 0.52], [0.55, 0.98], [-0.9, 0.98], [-0.9, -0.98], [0.55, -0.98], [0.92, -0.52]];
  items.push({ geo: openTub(ring, { y0: 0, tops: TH, lean: LEAN, t: 0.05, paint: P, inside: new THREE.Color(P).lerp(new THREE.Color(0x9c9a80), 0.3), floor: tone(P, 0.5), fy: 0.06, rim: (i) => (i === 2 ? owner : null) }) });
  // the wedge counterweights on the back
  for (const z of [-0.5, 0.5]) items.push(at(G.extrudeProfile([[0, 0], [0, 0.56], [-0.34, 0.44], [-0.34, 0.14]], 0.72, 0.02, { segments: 1 }), jit(P, z, 3), -0.86, 0.1, z));
  // the wide cast gun shield on the front plate, the collar and the long 3 inch gun
  items.push(at(G.bevelBox(0.18, 0.5, 0.82, 0.05, 2), tone(lite, CAST), 0.86, M10_GUN.y, 0, 0, 0, 0.3, 'cast-armor'));
  items.push({ geo: alongX(spin([[0.13, 0], [0.13, 0.14], [0.1, 0.18], [0, 0.18]], tone(P, CAST), 10)), matrix: G.xf(0.88, M10_GUN.y, 0), mat: 'cast-armor' });
  const L = M10_GUN.L;
  items.push(at(gun([[0.1, 0], [0.084, 0.15], [0.07, 0.45], [0.058, L - 0.08], [0.068, L - 0.06], [0.068, L]], P).geo, 0xffffff, M10_GUN.x, M10_GUN.y, 0));
  items.push(box(0.1, 0.06, 0.1, DARK, 0.84, 0.66, -0.3, 0, 0, 0.3)); // the sight hood
  // inside: the breech and its recoil guard, the gunner's and loader's seats, rounds racked on the side walls, a radio
  items.push(box(0.62, 0.24, 0.26, STEEL, 0.42, M10_GUN.y, 0, 0, 0, 0, 'gunmetal'), box(0.5, 0.04, 0.44, DARK, 0.3, M10_GUN.y - 0.16, 0, 0, 0, 0, 'gunmetal'));
  for (const z of [-0.5, 0.5]) items.push(box(0.22, 0.05, 0.22, 0x3a2b21, -0.1, 0.38, z, 0, 0, 0, 'leather'));
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) items.push(box(0.04, 0.09, 0.09, k % 2 ? 0xa88c46 : 0x8c7438, -0.62 + k * 0.1, 0.42, s * 0.83, 0, 0, 0, 'gunmetal'));
  items.push(box(0.26, 0.24, 0.5, tone(P, 0.8), -0.66, 0.22, 0));
  // the .50 cal on its rear mount, its ammunition can
  const gx = -0.7, gy = TH + 0.24;
  items.push(box(0.05, 0.3, 0.05, DARK, gx, TH + 0.06, 0.55), box(0.24, 0.11, 0.09, DARK, gx + 0.06, gy, 0.55));
  items.push({ geo: alongX(spin([[0, 0], [0.032, 0], [0.032, 0.34], [0, 0.34]], (b, s) => (b === 1 && s % 2 ? DARK : STEEL), 6)), matrix: G.xf(gx + 0.18, gy + 0.01, 0.55), mat: 'gunmetal' });
  items.push(box(0.5, 0.024, 0.024, DARK, gx + 0.72, gy + 0.01, 0.55), box(0.12, 0.1, 0.07, 0x4a4f2c, gx + 0.04, gy - 0.08, 0.64));
  // the owner's number block on each side wall
  const block = plate(0.3, 0.15, owner);
  for (const s of [-1, 1]) items.push(mark(block, -0.32, 0.4, s * (0.98 - LEAN * 0.4), [0, LEAN, s], 1));
  return items;
}

// StuG III Ausf. G: the Panzer III chassis (six road wheels on torsion arms, three return rollers, the front sprocket,
// the rear idler) under a low casemate that sits out over the tracks, its panniers sloping in to the roof; the 7.5 cm
// StuK 40 in the cast Saukopf mantlet, right of the centre line; the commander's cupola at the left rear, the loader's
// MG shield on the right, side skirts. Only the gun traverses, and only a little.
function stugHull(P, owner) {
  const lite = tone(P, 1.1), items = [];
  // lower hull: the sloped lower nose, the nose plate, the short glacis, the rear plate; the engine deck behind
  items.push(at(G.extrudeProfile([[2.2, 0.4], [2.55, 0.62], [2.58, 0.98], [2.1, 1.1], [-2.4, 1.1], [-2.46, 0.7], [-2.28, 0.4]], 1.8, 0.04, { segments: 1 }), P));
  items.push(at(G.extrudeProfile([[-0.7, 1.1], [-0.7, 1.58], [-2.32, 1.58], [-2.42, 1.46], [-2.42, 1.1]], 1.94, 0.04, { segments: 1 }), P));
  // the casemate: a narrow front plate, the panniers angled in at the front, the roof sloping down at front and back
  const cs = (x, top, half, side = 1.3) => ({ x, pts: [[side, 1.1], [side, 1.28], [half, top], [-half, top], [-side, 1.28], [-side, 1.1]] });
  items.push(at(G.loft([cs(2.06, 1.46, 0.86, 1.0), cs(1.78, 1.5, 1.06), cs(1.36, 1.78, 0.85), cs(-0.48, 1.78, 0.85), cs(-0.76, 1.6, 0.98)], { normals: 'flat' }), P));
  // the front: bolted add-on plates on the nose and the casemate front, the driver's visor (left), tow shackles
  const bolt = boltHead(lite);
  items.push(box(0.05, 0.3, 1.5, jit(P, 1, 4), 2.6, 0.82, 0), box(0.05, 0.3, 1.6, jit(P, 2, 4), 2.08, 1.28, 0));
  for (let k = 0; k < 6; k++) items.push({ geo: bolt, matrix: G.place([2.625, 0.92, -0.65 + k * 0.26], [1, 0, 0]) }, { geo: bolt, matrix: G.place([2.105, 1.38, -0.7 + k * 0.28], [1, 0, 0]) });
  items.push(box(0.08, 0.12, 0.3, lite, 2.1, 1.36, -0.5), box(0.02, 0.025, 0.2, DARK, 2.145, 1.37, -0.5));
  for (const z of [-0.7, 0.7]) items.push(box(0.12, 0.1, 0.08, STEEL, 2.58, 0.56, z, 0, 0, 0, 'gunmetal'));
  items.push(box(0.4, 0.04, 0.16, P, 2.3, 1.12, -0.6, 0, 0, -0.22), box(0.4, 0.04, 0.16, P, 2.3, 1.12, 0.6, 0, 0, -0.22)); // brake hatches
  // roof: the commander's cupola (left rear), the loader's hatch and the folding MG shield with its MG 34 (right),
  // the scissors periscope, a vent, the aerial
  items.push({ geo: upright(spin([[0.24, 0], [0.26, 0.07], [0.26, 0.13], [0.22, 0.16], [0.17, 0.17], [0.17, 0.2], [0, 0.2]], (b, s) => (b === 1 ? (s % 2 ? DARK : lite) : b === 4 ? P : lite), 8)), matrix: G.xf(-0.1, 1.78, -0.5) });
  items.push(box(0.4, 0.04, 0.4, jit(lite, 5, 1), 0.05, 1.8, 0.45));
  items.push(box(0.04, 0.36, 0.56, P, 0.36, 1.96, 0.45, 0, 0, -0.08), box(0.04, 0.3, 0.2, P, 0.3, 1.94, 0.79, 0, 0.7, -0.08));
  items.push(box(0.3, 0.07, 0.06, DARK, 0.46, 2.02, 0.4, 0, 0, 0, 'gunmetal'), box(0.5, 0.025, 0.025, DARK, 0.82, 2.03, 0.4, 0, 0, 0, 'gunmetal'), box(0.08, 0.1, 0.08, DARK, 0.36, 1.94, 0.4, 0, 0, 0, 'gunmetal'));
  for (const z of [-0.06, 0.06]) items.push(box(0.04, 0.24, 0.04, DARK, 0.25, 1.9, -0.45 + z, 0, 0, 0, 'gunmetal'));
  items.push({ geo: upright(spin([[0.12, 0], [0.12, 0.04], [0, 0.06]], STEEL, 8)), matrix: G.xf(-0.25, 1.78, 0.2), mat: 'gunmetal' });
  items.push(box(0.05, 0.05, 0.05, DARK, -0.62, 1.66, 0.85), box(0.018, 0.9, 0.018, 0x3c4028, -0.62, 2.1, 0.85));
  // engine deck: two hatches, the slatted intakes, spare road wheels; the muffler and a jerrycan on the back
  for (const z of [-0.45, 0.45]) items.push(box(0.8, 0.04, 0.6, jit(lite, z, 2), -1.2, 1.6, z));
  for (const s of [-1, 1]) items.push({ geo: grille(-2.2, -1.75, s * 0.84 - 0.16, s * 0.84 + 0.16, 1.585, 6, tone(P, 0.42), tone(P, 0.78)) });
  const spare = wheel(0.27, 0.12, P, { rubber: 0.06, hub: 0.34, S: 10 });
  for (const z of [-0.3, 0.3]) items.push(at(spare, 0xffffff, -2.0, 1.64, z, -Math.PI / 2));
  items.push({ geo: spin([[0, -0.4], [0.15, -0.4], [0.15, 0.4], [0, 0.4]], RUST, 8), color: 0xffffff, matrix: G.xf(-2.58, 0.95, 0), mat: 'track-steel' });
  items.push(box(0.12, 0.34, 0.24, jit(P, 9, 2), -2.48, 1.3, 0.7));
  // fenders, tools and a jack on them
  for (const s of [-1, 1]) items.push(box(4.86, 0.03, 0.36, lite, 0.05, 1.1, s * 1.12), box(0.5, 0.03, 0.36, lite, 2.66, 1.03, s * 1.12, 0, 0, -0.25));
  items.push(box(1.1, 0.04, 0.05, WOOD, -1.2, 1.14, -1.12, 0, 0, 0, 'wood'), box(0.22, 0.14, 0.14, P, -0.4, 1.19, -1.12));
  // the owner's number block on each pannier and a stripe across the roof
  const pn = [0, 0.669, 0.743], zAt = (y) => 1.3 - (y - 1.28) * 0.9, block = plate(0.34, 0.16, owner);
  for (const s of [-1, 1]) items.push(mark(block, 0.5, 1.48, s * zAt(1.48), [0, pn[1], s * pn[2]], 1, [0, pn[2], -s * pn[1]]));
  items.push(...ownerMarks(owner, { side: [0, 0, 0], roof: [-0.3, 1.782, 0.55] }));
  // running gear: six road wheels on torsion arms, three return rollers, the front sprocket, the rear idler
  const TZ = 1.1, gear = [], wheels = [], WY = 0.355, rw = wheel(0.27, 0.24, P, { rubber: 0.06, hub: 0.34, face: 1.05, S: 10 });
  for (const x of [1.5, 0.9, 0.3, -0.3, -0.9, -1.5]) {
    gear.push(at(rw, 0xffffff, x, WY, TZ)); wheels.push({ x, y: WY, r: 0.27 });
    gear.push(box(0.36, 0.07, 0.06, lite, x + 0.15, WY + 0.06, TZ - 0.16, 0, 0, 0.35), box(0.12, 0.1, 0.1, STEEL, x + 0.32, 0.62, TZ - 0.2, 0, 0, 0, 'gunmetal'));
  }
  const rollers = [1.22, 0.02, -1.18].map((x) => ({ x, y: 0.84, r: 0.07 }));
  for (const r of rollers) gear.push(at(roller(0.07, 0.14, P), 0xffffff, r.x, r.y, TZ));
  gear.push(at(sprocket(0.29, 12, 0.3, P), 0xffffff, 2.3, 0.62, TZ));
  gear.push(at(wheel(0.27, 0.24, P, { rubber: 0, holes: 6, S: 10, hub: 0.3, ring: 0.64, hole: 0.15, face: 1.2 }), 0xffffff, -2.3, 0.6, TZ));
  const line = beltLine([{ x: -2.3, y: 0.6, r: 0.27 }, ...wheels.sort((a, b) => a.x - b.x), { x: 2.3, y: 0.62, r: 0.29 }, ...rollers]);
  gear.push(at(trackBelt(line, 0, 0.38, 0.085, 0.26), 0xffffff, 0, 0, TZ));
  // Schuerzen hung from a rail, each plate a touch out of true, a cross on the middle one
  const n = 5, x0 = -2.25, len = 4.4, w = len / n, z = 1.38, y = 1.08, hh = 0.42, e = 0.012;
  for (let k = 0; k < n; k++) gear.push(box(w - 2 * e, hh * 2, 0.025, jit(P, k, 6, 0.06), x0 + w * k + w / 2, y, z, (rnd(k, 4) - 0.5) * 0.03));
  gear.push(box(len, 0.04, 0.05, lite, x0 + len / 2, y + hh - 0.03, z - 0.04));
  for (let k = 0; k < 4; k++) gear.push(box(0.05, 0.04, 0.2, P, x0 + 0.5 + k * 1.13, y + hh - 0.06, z - 0.12));
  gear.push(mark(G.balkenkreuz(1), x0 + w * 2.5, y, z + 0.013, [0, 0, 1], 0.2));
  items.push({ geo: bothSides(gear) });
  return finish(items, { height: 1.15, ...GREY });
}
// the gun and its Saukopf mantlet, around the point where it pivots in the front plate
const STUG = { ring: [2.02, 1.36, 0.12], tip: [0.32 + 2.7, 0, 0] };
function stugGun(P) {
  const items = [], saukopf = G.loft([{ x: -0.12, w: 0.5, h: 0.46, p: 3 }, { x: 0.12, w: 0.46, h: 0.42, p: 2.6 }, { x: 0.3, w: 0.3, h: 0.28, p: 2.2 }, { x: 0.42, w: 0.17, h: 0.17, p: 2 }], { segments: 12, normals: 50 });
  items.push(at(saukopf, tone(tone(P, 1.08), CAST), 0, 0, 0, 0, 0, 0, 'cast-armor'));
  items.push(at(gun([[0.12, 0], [0.08, 0.2], [0.06, 0.5], [0.055, 2.35], [0.105, 2.38], [0.105, 2.5], [0.065, 2.53], [0.065, 2.56], [0.105, 2.59], [0.105, 2.7]], P).geo, 0xffffff, 0.32, 0, 0));
  items.push(box(0.12, 0.08, 0.08, DARK, 0.1, 0.22, -0.2, 0, 0, 0, 'gunmetal')); // the sight's opening
  return items;
}

// SU-85: the T-34 hull and running gear with the glacis carried on up as one sloped plate to a fixed casemate, its
// sides leaning in over the sponsons; the 85 mm D-5S in a cast ball mantlet on the plate, the commander's cupola, the
// fuel tanks on the sponsons, the unditching log. Only the gun traverses, and only a little.
function su85Section(x, top, bot = 0.4) {
  const y1 = Math.min(top - 0.001, 1.4), z1 = 1.33 - (y1 - 0.98) * 0.84, z2 = z1 - (top - y1) * 0.36;
  return { x, pts: [[1.33, 0.98], [z1, y1], [z2, top], [-z2, top], [-z1, y1], [-1.33, 0.98], [-0.86, 0.98], [-0.86, bot], [0.86, bot], [0.86, 0.98]] };
}
function su85Hull(P, owner) {
  const lite = tone(P, 1.1), items = [];
  const nose = { x: 2.7, pts: [[0.86, 0.79], [0.86, 0.795], [0.86, 0.8], [-0.86, 0.8], [-0.86, 0.795], [-0.86, 0.79], [-0.86, 0.78], [-0.86, 0.76], [0.86, 0.76], [0.86, 0.78]] };
  items.push(at(G.loft([nose, su85Section(2.3, 1.136), su85Section(1.27, 2.0), su85Section(-0.95, 2.0), su85Section(-1.35, 1.4), su85Section(-2.25, 1.4), su85Section(-2.66, 1.1, 0.62)], { normals: 30 }), P));
  for (const s of [-1, 1]) items.push(box(4.9, 0.04, 0.05, lite, -0.1, 0.97, s * 1.34), box(0.5, 0.03, 0.54, lite, 2.55, 0.975, s * 1.1), box(0.03, 0.09, 0.54, lite, 2.8, 0.94, s * 1.1), box(0.24, 0.03, 0.54, lite, -2.76, 0.975, s * 1.1));
  // the front plate: the driver's hatch with its vision blocks (left), a ring of bolts round the mantlet, tow hooks,
  // the headlight
  const pl = (t) => [2.7 - 1.43 * t, 0.8 + 1.2 * t], pn = [0.643, 0.766, 0], pa = -0.698;
  { const [x, y] = pl(0.33); items.push(box(0.5, 0.08, 0.48, lite, x + pn[0] * 0.03, y + pn[1] * 0.03, -0.48, 0, 0, pa)); for (const z of [-0.6, -0.36]) items.push(box(0.06, 0.06, 0.1, DARK, x - 0.12 + pn[0] * 0.08, y + 0.1 + pn[1] * 0.08, z, 0, 0, pa)); }
  const bolt = boltHead(lite);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU, [x, y] = pl(0.667 + 0.36 * Math.sin(a) / 1.87); items.push({ geo: bolt, matrix: G.place([x, y, 0.47 * Math.cos(a)], pn, [-0.766, 0.643, 0]) }); }
  for (const z of [-0.6, 0.6]) items.push(box(0.12, 0.08, 0.06, STEEL, 2.72, 0.7, z));
  items.push({ geo: alongX(spin([[0.08, -0.06], [0.08, 0.06], [0, 0.07]], STEEL, 8)), color: 0xffffff, matrix: G.xf(2.15, 1.25, -0.82) });
  // roof: the commander's cupola with its vision slits (left), the second hatch, periscopes, the vent dome
  items.push({ geo: upright(spin([[0.25, 0], [0.25, 0.08], [0.22, 0.13], [0.18, 0.15], [0, 0.16]], (b, s) => (b === 1 ? (s % 2 ? DARK : lite) : lite), 8)), matrix: G.xf(-0.2, 2.0, -0.42) });
  items.push({ geo: upright(spin([[0.22, 0], [0.22, 0.04], [0.18, 0.07], [0, 0.08]], jit(lite, 3, 6), 8)), matrix: G.xf(-0.1, 2.0, 0.38) });
  for (const [x, z] of [[0.7, -0.4], [0.7, 0.35], [0.3, 0.1]]) items.push(box(0.12, 0.08, 0.09, DARK, x, 2.03, z));
  items.push({ geo: upright(spin([[0.14, 0], [0.13, 0.05], [0.08, 0.09], [0, 0.1]], tone(P, CAST), 8)), matrix: G.xf(-0.7, 2.0, 0), mat: 'cast-armor' });
  // the casemate sides: a red star and the owner's number block; the stripe across the roof
  const side = (y) => 0.977 - (y - 1.4) * 0.36, sn = [0, 0.339, 0.94], star = G.star(1, { color: 0xb02a20, border: WHITE, edge: 0.08 }), block = plate(0.3, 0.15, owner);
  for (const s of [-1, 1]) {
    const n = [0, sn[1], s * sn[2]], up = [0, sn[2], -s * sn[1]];
    items.push(mark(star, -0.45, 1.7, s * side(1.7), n, 0.2, up), mark(block, 0.45, 1.7, s * side(1.7), n, 1, up));
  }
  items.push(...ownerMarks(owner, { side: [0, 0, 0], roof: [0.35, 2.004, 0.42], stripe: 0.07 }));
  // engine deck behind the casemate: the louvred grille, the round transmission hatch, the exhausts
  items.push({ geo: grille(-2.15, -1.5, -0.55, 0.55, 1.402, 5, tone(P, 0.35), tone(P, 0.85)) });
  items.push({ geo: upright(spin([[0.24, 0], [0.24, 0.03], [0.2, 0.05], [0, 0.06]], lite, 10)), color: 0xffffff, matrix: G.xf(-2.45, 1.25, 0, 0, 0, 0.64) });
  for (const z of [-0.55, 0.55]) items.push({ geo: alongX(spin([[0.07, -0.12], [0.07, 0.1], [0.04, 0.1], [0, 0.06]], RUST, 7)), color: 0xffffff, matrix: G.xf(-2.62, 0.82, z, 0, 0, -0.35), mat: 'track-steel' }, box(0.1, 0.22, 0.2, P, -2.6, 0.82, z, 0, 0, -0.35));
  // a long fuel tank on the back of each sponson, held by three straps; the unditching log on the left; a toolbox
  const tsn = [0, 0.64, 0.768], tank = alongX(spin([[0, -0.45], [0.16, -0.45], [0.16, 0.45], [0, 0.45]], lite, 9)), strap = alongX(spin([[0.168, -0.03], [0.168, 0.03]], STEEL, 9));
  for (const s of [-1, 1]) {
    const ty = 1.19 + tsn[1] * 0.17, tz = s * (1.155 + tsn[2] * 0.17);
    items.push({ geo: tank, matrix: G.xf(-1.85, ty, tz) });
    for (const dx of [-0.32, 0, 0.32]) items.push({ geo: strap, matrix: G.xf(-1.85 + dx, ty, tz) });
  }
  items.push({ geo: alongX(spin([[0, -1.0], [0.1, -1.0], [0.1, 1.0], [0, 1.0]], WOOD, 8)), matrix: G.xf(0.2, 1.08, -1.25), mat: 'wood' });
  for (const x of [-0.5, 0.2, 0.9]) items.push(box(0.04, 0.05, 0.25, STEEL, x, 1.08, -1.25, 0, 0, 0, 'gunmetal'));
  items.push(box(0.6, 0.18, 0.28, lite, 0.7, 1.07, 1.22));
  items.push(christie(P));
  return finish(items, { height: 1.1, dark: 0.84, under: 0.06, nose: [2.2, 5] });
}
const SU85 = { ring: [1.75, 1.6, 0], tip: [0.3 + 2.8, 0, 0] };
function su85Gun(P) {
  const items = [], ball = G.loft([{ x: -0.2, w: 0.72, h: 0.64, p: 2.4 }, { x: 0.06, w: 0.68, h: 0.6, p: 2.4 }, { x: 0.22, w: 0.46, h: 0.42, p: 2.2 }, { x: 0.32, w: 0.2, h: 0.2, p: 2 }], { segments: 12, normals: 50 });
  items.push(at(ball, tone(tone(P, 1.08), CAST), 0, 0, 0, 0, 0, 0, 'cast-armor'));
  const L = 2.8;
  items.push(at(gun([[0.09, 0], [0.075, 0.25], [0.062, 0.6], [0.052, L - 0.05], [0.06, L - 0.03], [0.06, L]], P).geo, 0xffffff, 0.3, 0, 0));
  items.push(box(0.1, 0.08, 0.08, DARK, 0.16, 0.12, -0.22, 0, 0, 0, 'gunmetal')); // the sight's opening
  return items;
}

// ---------------------------------------------------------------- the unit types

const TURRET = { height: 0.4, dark: 0.75 };
// The faction's grey leans warm here: a cool blue-grey turns navy in the shade and loses its value against the ground.
const german = (P) => new THREE.Color(P).lerp(new THREE.Color(0x5b574d), 0.32);
const MODELS = {
  medium: [
    (P, C) => ({ hull: shermanHull(P), turret: finish(shermanTurret(P, C), TURRET), ring: SHERMAN.ring, tip: SHERMAN.tip }),
    (P, C) => ({ hull: panzerHull(german(P), true), turret: finish(panzerTurret(german(P), C), { ...TURRET, ...GREY }), ring: PANZER.ring, tip: PANZER.tip }),
    (P, C) => ({ hull: t34Hull(P), turret: finish(t34Turret(P, C), TURRET), ring: T34.ring, tip: T34.tip }),
  ],
  rocket: [(P, C) => ({ hull: shermanHull(P, { cans: false }), turret: finish([...shermanTurret(P, C, { roofGun: false, stowage: false }), ...calliopeRack(P, C)], TURRET), ring: SHERMAN.ring, tip: SHERMAN.tip })],
  flaktrack: [null, (P, C) => {
    const t = wirbelwindTurret(german(P), C);
    // the open turret sits on the hull's center line, a little behind the Panzer IV's turret
    return { hull: panzerHull(german(P), false), turret: finish(t.items, { height: 0.5, ...GREY }), ring: [0.1, PANZER.ring[1], 0], tip: t.tip };
  }],
  // the StuG and the SU-85 turn only their gun, `limit` radians either way of the hull (v.traverse)
  tankdestroyer: [
    (P, C) => ({ hull: m10Hull(P), turret: finish(m10Turret(P, C), TURRET), ring: M10.ring, tip: M10.tip }),
    (P, C) => ({ hull: stugHull(german(P), C), turret: finish(stugGun(german(P)), { ...TURRET, ...GREY, floor: -0.3 }), ring: STUG.ring, tip: STUG.tip, limit: 0.21 }),
    (P, C) => ({ hull: su85Hull(P, C), turret: finish(su85Gun(P), { ...TURRET, floor: -0.35 }), ring: SU85.ring, tip: SU85.tip, limit: 0.21 }),
  ],
};

// The units this module builds: every medium tank and tank destroyer, the T34 Calliope (rocket, USA) and the
// Wirbelwind (flaktrack, Germany).
export const isArmorMedium = (type, fac) => type === 'medium' || type === 'tankdestroyer' || (type === 'rocket' && fac === 0) || (type === 'flaktrack' && fac === 1);

// Builds unit v's hull (returned, added under root) and its turret (v.turret, on the turret ring) as one part each
// for the caller to bake, and sets v.fxTip (and v.traverse, how far a casemate gun turns). Geometry is made once per look and shared.
const made = new Map();
const piece = (geo) => { const o = new THREE.Object3D(); o.userData.geo = geo; o.userData.paint = 0xffffff; return o; };
export function buildArmorMedium(v, root, type, fac, f) {
  const key = `${type}|${fac}|${f.vehicle}|${f.color}`;
  let m = made.get(key);
  if (!m) { m = (MODELS[type][fac] ?? MODELS[type][0])(f.vehicle, f.color); made.set(key, m); }
  const hull = new THREE.Group();
  hull.add(piece(m.hull));
  v.turret = new THREE.Group();
  v.turret.position.set(...m.ring);
  v.turret.add(piece(m.turret));
  v.fxTip = m.tip.slice();
  if (m.limit) v.traverse = m.limit;
  root.add(hull, v.turret);
  return hull;
}
