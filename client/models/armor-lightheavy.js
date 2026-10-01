// Light and heavy armor: the light tank of each faction (M5A1 Stuart, Panzer II Ausf. F, T-70), the Tiger I and the
// Soviet ZSU-37 self-propelled flak gun, built as painted miniatures with client/models/geom.js.
//
// Each vehicle is two vertex-colored geometries: the hull (with its running gear, tracks and markings) and the
// turret, whose origin is the turret ring, the point v.turret turns around. They are drawn in metres from the real
// vehicles and scaled by S per vehicle, which keeps them near the footprint of the box models they replace.
// client/unit-models.js puts each geometry into one part painted white and bakes it like its other tanks, so a
// vehicle stays two draw calls. Axes as in the other unit models: +x forward, +y up, +z the vehicle's right side,
// the ground at y = 0. The owner's color is a recognition stripe around the turret (on the ZSU-37 around its open
// casemate); the Tiger carries it as its tactical number.
import * as THREE from 'three';
import { merge, mirrorZ, loft, lathe, barrel, chamferBox, star, balkenkreuz, place, ao, xf } from './geom.js';

const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLS = new Map();
const cylGeo = (n) => CYLS.get(n) || CYLS.set(n, new THREE.CylinderGeometry(1, 1, 1, n)).get(n);
// The game's sun is warm (0xffd6a8) and the neutral tone map takes most of the smallest channel out of dark colors,
// so a neutral dark steel or a grey-green paint renders brown or yellow. These albedos are biased cool so they
// render as the color named: dark steel, rubber, off-white, wood, brass.
const RUBBER = 0x434c56, LINK = 0x49525d, LINK_LIT = 0x5e6974, LINK_DARK = 0x404853, IRON = 0x4d5761, WHITE = 0xd3e3ec, BLACK = 0x1c1e22;
const LENS = 0xd5dde0, WOOD = 0x766e66, BRASS = 0xa99e77, INSIDE = 0x3d454f, RED = 0xae555a;
// the factions' vehicle colors (main.js) as the paint that renders like them: US olive drab a little browner and
// greyer, Soviet green cooler, German grey neutral instead of brown
const REPAINT = new Map([[0x59623d, 0x646d5e], [0x4e5a38, 0x5a6f64], [0x50565a, 0x515a64]]);
const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
const dim = (c, k) => col(c).clone().multiplyScalar(k);
const mix = (a, b, t) => col(a).clone().lerp(col(b), t);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- building blocks

// a list of colored parts merged into one geometry at the end
function kit() {
  const items = [];
  const k = {
    add(geo, color = 0xffffff, m = new THREE.Matrix4()) { items.push({ geo, color, matrix: m }); return k; },
    box(color, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { return k.add(BOX, color, xf(x, y, z, rx, ry, rz, w, h, d)); },
    // a cylinder r round and len long, standing along y unless turned
    cyl(color, r, len, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, n = 8) { return k.add(cylGeo(n), color, xf(x, y, z, rx, ry, rz, r, len, r)); },
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

// flat colored polygons (decals, grilles, track links): poly() takes a convex outline in order and the way it faces.
// color is one color, or a list with one per point (a gradient across the polygon).
function flat() {
  const pos = [], nor = [], cols = [], idx = [];
  const f = {
    poly(pts, dir, color) {
      const each = Array.isArray(color) ? color.map(col) : null, c = each ? null : col(color), o = pos.length / 3, l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const [nx, ny, nz] = newell(pts); // to wind the outline toward dir
      pts.forEach((p, i) => { const k = each ? each[i] : c; pos.push(p[0], p[1], p[2]); nor.push(dir[0] / l, dir[1] / l, dir[2] / l); cols.push(k.r, k.g, k.b); });
      const flip = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0;
      for (let i = 1; i + 1 < pts.length; i++) if (flip) idx.push(o, o + i + 1, o + i); else idx.push(o, o + i, o + i + 1);
      return f;
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
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
// a plan outline pushed out from its middle by a factor, and the outline part way between two others
const grow = (pts, k) => pts.map(([x, z]) => [x * k, z * k]);
const between = (a, b, t) => a.map(([x, z], i) => [x + (b[i][0] - x) * t, z + (b[i][1] - z) * t]);

// Rings around the z axis from a profile of bands [[r0, z0], [r1, z1], color, colorB]: each band is seg quads,
// smooth around the axis and hard between bands; a band ending at r = 0 is a fan. With colorB the band alternates
// the two colors quad by quad (the spokes and holes of a spoked wheel), each quad with its own vertices. A fifth
// entry is the color the first one fades to at the band's far end (a highlight on a wheel's rim).
function bands(list, seg) {
  const pos = [], nor = [], cols = [], idx = [];
  const vert = (r, z, a, nr, nz, c) => { pos.push(r * Math.cos(a), r * Math.sin(a), z); nor.push(nr * Math.cos(a), nr * Math.sin(a), nz); cols.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  for (const [[r0, z0], [r1, z1], ca, cb, ce] of list) {
    const dr = r1 - r0, dz = z1 - z0, l = Math.hypot(dr, dz), nr = dz / l, nz = -dr / l, A = col(ca), B = cb == null ? null : col(cb), E = ce == null ? A : col(ce);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, hole = B && i % 2, c = hole ? B : A, e = hole ? B : E;
      if (r1 < 1e-6) { idx.push(vert(r0, z0, a0, nr, nz, c), vert(r0, z0, a1, nr, nz, c), vert(0, z1, (a0 + a1) / 2, nr, nz, e)); continue; }
      const p = vert(r0, z0, a0, nr, nz, c), q = vert(r0, z0, a1, nr, nz, c), s = vert(r1, z1, a1, nr, nz, e), t = vert(r1, z1, a0, nr, nz, e);
      idx.push(p, q, s, p, s, t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  return g;
}

// A road wheel, axle along z, outer face toward +z: a rubber tire, a dished steel disc lit toward its rim and a hub
// cap. spokes > 0 makes the disc that many spokes with dark holes between (seg is then twice the spoke count). The
// back is left open: it faces the hull.
function roadWheel(R, w, paint, { seg = 10, rim = 0.78, hub = 0.3, spokes = 0, tire = RUBBER } = {}) {
  const h = w / 2, Rr = R * rim, Rh = R * hub;
  return bands([
    [[R, -h], [R, h * 0.4], tire], [[R, h * 0.4], [Rr, h], tire],
    [[Rr, h], [Rh, h * 0.6], dim(paint, 1.22), spokes ? dim(paint, 0.2) : null, paint], [[Rh, h * 0.6], [0, h * 1.1], dim(paint, 0.85)],
  ], spokes ? spokes * 2 : seg);
}

// A drive sprocket, axle along z, outer face toward +z: a toothed plate with worn-steel tooth edges and a hub.
// Each tooth is three points (a pointed tooth), or four (flat-topped) with flat = true.
function sprocketWheel(R, w, teeth, paint, { flat: flatTop = false } = {}) {
  const F = flat(), h = w / 2, step = TAU / teeth, rr = R * 0.8, ring = [], face = col(paint), edge = col(LINK_LIT);
  const tooth = flatTop ? [[-0.3, rr], [-0.12, R], [0.12, R], [0.3, rr]] : [[-0.32, rr], [0, R], [0.32, rr]];
  for (let k = 0; k < teeth; k++) for (const [t, r] of tooth) { const a = (k + t) * step; ring.push([r * Math.cos(a), r * Math.sin(a)]); }
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    F.poly([[0, 0, h], [p[0], p[1], h], [q[0], q[1], h]], [0, 0, 1], face);
    F.poly([[p[0], p[1], -h], [q[0], q[1], -h], [q[0], q[1], h], [p[0], p[1], h]], [q[1] - p[1], p[0] - q[0], 0], edge);
  });
  const hub = dim(paint, 0.7);
  return merge([F.geometry(), bands([[[R * 0.42, h], [R * 0.3, h * 1.9], hub], [[R * 0.3, h * 1.9], [0, h * 1.9], hub]], 8)]);
}
// a spoked steel idler (no tire)
const idler = (R, w, spokes, paint) => roadWheel(R, w, paint, { spokes, rim: 0.84, hub: 0.26, tire: dim(paint, 0.85) });
// a small return roller, axle along z, rubber rim
const roller = (r, w, paint) => bands([[[r, -w / 2], [r, w / 2], RUBBER], [[r, w / 2], [0, w * 0.62], paint]], 6);

// The track around a set of wheels, lying in xy (axles along z) between z - width/2 and z + width/2: link plates
// along the belt that wraps the circles [[x, y, r], ...] (their convex hull, half a link thick further out), every
// other link a shade darker. Each link shows its tread (or, under the bottom run, its inner face) and its outer
// edge. The tread plates have thin gaps; the edge is a trapezoid whose inner side runs the full pitch, so the side
// of the track reads as one continuous dark band, lit along the tread edge.
function trackBelt(circles, z, width, { thick = 0.11, pitch = 0.17, color = LINK, edge = LINK_LIT, back = LINK_DARK } = {}) {
  const pts = [];
  for (const [x, y, r] of circles) for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU; pts.push([x + (r + thick / 2) * Math.cos(a), y + (r + thick / 2) * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const loop = lo.slice(0, -1).concat(hi.slice(0, -1)), len = [0]; // counter-clockwise seen from +z
  for (let i = 1; i <= loop.length; i++) { const a = loop[i - 1], b = loop[i % loop.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[loop.length], n = Math.round(total / pitch), step = total / n;
  const at = (s) => {
    let a = 0, b = loop.length;
    while (b - a > 1) { const m = (a + b) >> 1; if (len[m] <= s) a = m; else b = m; }
    const p = loop[a], q = loop[(a + 1) % loop.length], t = (s - len[a]) / Math.max(1e-9, len[a + 1] - len[a]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const F = flat(), z0 = z - width / 2, z1 = z + width / 2, h = thick / 2, lit = col(color), dark = dim(color, 0.88), rim = col(edge), rim2 = dim(edge, 0.88), deep = col(back);
  for (let k = 0; k < n; k++) {
    const A = at(k * step + step * 0.02), B = at((k + 1) * step - step * 0.02), A0 = at(k * step), B0 = at((k + 1) * step), l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = (B[1] - A[1]) / l, ny = (A[0] - B[0]) / l; // outward
    const Ao = [A[0] + nx * h, A[1] + ny * h], Bo = [B[0] + nx * h, B[1] + ny * h], Ai = [A0[0] - nx * h, A0[1] - ny * h], Bi = [B0[0] - nx * h, B0[1] - ny * h];
    // the tread, except under the bottom run where nothing sees it; there the inner face (seen between the wheels)
    if (ny > -0.85) F.poly([[Ao[0], Ao[1], z0], [Bo[0], Bo[1], z0], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [nx, ny, 0], k % 2 ? lit : dark);
    else F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bi[0], Bi[1], z1], [Ai[0], Ai[1], z1]], [-nx, -ny, 0], k % 2 ? dark : dim(color, 0.76));
    const r = k % 2 ? rim : rim2;
    F.poly([[Ai[0], Ai[1], z1], [Bi[0], Bi[1], z1], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [0, 0, 1], [deep, deep, r, r]);
  }
  return F.geometry();
}

// a gun tube along +x from x = 0: breech sleeve, taper, a muzzle lip (longer and fatter for flash hiders); the bore
// is a dark dot
function gunTube(L, r, paint, { lip = 0.05, lipR = 1.18, seg = 8 } = {}) {
  const g = lathe([[r * 1.35, 0], [r * 1.35, 0.14], [r, 0.2], [r * 0.86, L - lip - 0.01], [r * lipR, L - lip], [r * lipR, L], [0, L]], seg, { axis: 'x' });
  return paintBy(g, (p) => (Math.hypot(p.y, p.z) < 1e-4 ? col(BLACK) : col(paint)));
}

// louvres on a deck at height y: a dark recess and n bars across x
function grille(F, x0, x1, z0, z1, y, n, bar, gap = INSIDE) {
  F.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], gap);
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
  F.poly(pts, [1, 0, 0], LENS);
}
// a headlight on the hull: housing along x and its lens
function headlight(K, F, x, y, z, r = 0.075, color = IRON, n = 8) {
  K.cyl(color, r, 0.14, x, y, z, 0, 0, -Math.PI / 2, n);
  lens(F, x + 0.071, y, z, r * 0.8);
}
// A lit rim round a roof: quads w wide inside the outline [[x, z], ...] at height y (or y(p) per point), a lighter
// paint along the top edge where a dry brush catches it. tone(p) colors each corner when given.
function roofRim(F, outline, y, w, color, tone = null) {
  const n = outline.length, Y = typeof y === 'function' ? y : () => y;
  const cx = outline.reduce((s, p) => s + p[0], 0) / n, cz = outline.reduce((s, p) => s + p[1], 0) / n;
  const inset = outline.map(([x, z]) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x - ((x - cx) / d) * w, z - ((z - cz) / d) * w]; });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = outline[i], b = outline[j], pts = [[a[0], Y(a), a[1]], [b[0], Y(b), b[1]], [inset[j][0], Y(b), inset[j][1]], [inset[i][0], Y(a), inset[i][1]]];
    F.poly(pts, [0, 1, 0], tone ? pts.map((p) => tone(p)) : color);
  }
}
// tactical number facing +z, h tall, centered on the origin: colored strokes edged in black, with a white rim
// outside that
const GLYPHS = { 1: [[0.22, 0, 0.4, 1], [0.04, 0.72, 0.22, 0.88]], 3: [[0, 0.86, 0.58, 1], [0.14, 0.43, 0.58, 0.57], [0, 0, 0.58, 0.14], [0.44, 0, 0.58, 1]] };
function number(text, h, color) {
  const F = flat(), w = 0.58 * h, gap = 0.2 * h, total = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, i) => {
    const x0 = -total / 2 + i * (w + gap);
    for (const [a, b, c, d] of GLYPHS[ch]) {
      const X0 = x0 + a * h, X1 = x0 + c * h, Y0 = (b - 0.5) * h, Y1 = (d - 0.5) * h;
      for (const [e, z, tone] of [[0.12 * h, 0.003, WHITE], [0.05 * h, 0.006, BLACK], [0, 0.009, color]]) {
        F.poly([[X0 - e, Y0 - e, z], [X1 + e, Y0 - e, z], [X1 + e, Y1 + e, z], [X0 - e, Y1 + e, z]], [0, 0, 1], tone);
      }
    }
  });
  return F.geometry();
}
// loft sections: a box [z, y] ring, and one with its top edges chamfered by c
const box4 = (x, y0, y1, z) => ({ x, pts: [[z, y0], [z, y1], [-z, y1], [-z, y0]] });
const deck = (x, y0, y1, z, c = 0.05) => ({ x, pts: [[z, y0], [z, y1 - c], [z - c, y1], [c - z, y1], [-z, y1 - c], [-z, y0]] });
// an owner-color band around a turret: its loft section (a [z, y] ring) between x0 and x1, pushed out a little
const band = (pts, x0, x1, cy, k = 1.02) => {
  const out = pts.map(([z, y]) => [z * k, cy + (y - cy) * k]);
  return loft([{ x: x0, pts: out }, { x: x1, pts: out }], { caps: false, normals: 'flat' });
};
const FLAT = { normals: 'flat' };

// ---------------------------------------------------------------- M5A1 Stuart

// Tall hull whose sponsons overhang the tracks, a short glacis with two hatches over the rounded transmission
// cover, two vertical-volute bogies a side, a raised sprocket in front and a big spoked idler trailing on the
// ground. Riveted sponsons, a stowage box on the tail. Tall turret with a bustle, the rounded cast M23 mount with
// the 37 mm in its recoil sleeve, a .30 cal on a short pintle at the rear right of the roof. White stars.
function stuart(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), GF = flat(), HF = flat(), TF = flat();
  // running gear, right side (mirrored to the left)
  const tz = 0.995, t = 0.11, R = 0.255, wy = t + R, wheels = [1.55, 0.87, 0.1, -0.58];
  const sp = [2.12, 0.68, 0.29], id = [-1.72, 0.47, 0.36], rollers = [[0.95, 0.83], [0.04, 0.83], [-0.8, 0.83]];
  const road = roadWheel(R, 0.18, paint, { seg: 10, spokes: 5, rim: 0.8 }), rol = roller(0.08, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  G.add(idler(id[2], 0.16, 6, paint), 0xffffff, xf(id[0], id[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.02));
  for (const xb of [1.21, -0.24]) {
    // a bogie: the tall bracket under the sponson, its volute spring, two arms down to the wheel hubs
    G.box(paint, 0.3, 0.5, 0.16, xb, 0.74, tz - 0.07).box(dim(paint, 0.9), 0.22, 0.12, 0.2, xb, 0.46, tz + 0.02);
    G.cyl(dim(paint, 0.7), 0.075, 0.24, xb, 0.64, tz + 0.06, 0, 0, 0, 6);
    for (const s of [1, -1]) G.box(paint, 0.42, 0.08, 0.06, xb + s * 0.17, (0.46 + wy) / 2, tz + 0.12, 0, 0, -s * Math.atan2(0.46 - wy, 0.34));
  }
  // the idler's trailing arm and its bracket
  G.box(paint, 0.54, 0.09, 0.06, -1.48, 0.56, tz + 0.12, 0, 0, Math.atan2(0.18, 0.48)).box(paint, 0.2, 0.32, 0.14, -1.24, 0.74, tz - 0.06);
  G.add(trackBelt([[sp[0], sp[1], 0.25], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.08])], tz, 0.3, { thick: t, pitch: 0.18 }));
  G.box(paint, 0.5, 0.025, 0.32, 2.3, 1.0, tz, 0, 0, -0.3); // front mudguard
  G.box(paint, 4.5, 0.05, 0.05, -0.04, 1.045, 1.12); // the sponson's bottom lip
  // the sponson side: a row of rivet heads under the top edge and two plate seams
  for (let i = 0; i < 9; i++) { const x = -1.78 + i * 0.4; GF.poly([[x, 1.53, 1.123], [x + 0.04, 1.53, 1.123], [x + 0.04, 1.57, 1.123], [x, 1.57, 1.123]], [0, 0, 1], dim(paint, 1.3)); }
  for (const x of [0.92, -0.62]) GF.poly([[x, 1.07, 1.123], [x + 0.022, 1.07, 1.123], [x + 0.022, 1.5, 1.123], [x, 1.5, 1.123]], [0, 0, 1], dim(paint, 0.55));
  G.add(GF.geometry());
  H.add(mirrorZ(G.geometry()));

  // lower hull between the tracks ending in the rounded transmission cover; the upper hull over the tracks
  H.add(loft([box4(-2.22, 0.56, 1.2, 0.8), box4(-2.02, 0.4, 1.2, 0.8), box4(1.95, 0.4, 1.27, 0.8), box4(2.18, 0.5, 1.27, 0.8), box4(2.32, 0.66, 1.24, 0.8), box4(2.39, 0.86, 1.14, 0.8)], FLAT), paint);
  H.add(loft([deck(-2.3, 1.04, 1.32, 1.08, 0.03), deck(-1.95, 1.04, 1.64, 1.12), deck(1.56, 1.04, 1.64, 1.12), deck(2.22, 1.04, 1.28, 1.12, 0.02)], FLAT), paint);
  // glacis: two hatches with periscopes, the bow gun, a star; headlights with brush guards; tow shackles
  const ga = -Math.atan2(0.36, 0.66), gn = [0.479, 0.878, 0], on = (u, z, lift) => [1.56 + 0.66 * u + gn[0] * lift, 1.64 - 0.36 * u + gn[1] * lift, z];
  for (const z of [0.42, -0.42]) H.box(dim(paint, 1.08), 0.36, 0.05, 0.44, ...on(0.28, z, 0.02), 0, 0, ga).box(IRON, 0.08, 0.07, 0.16, ...on(0.06, z, 0.05), 0, 0, ga);
  H.cyl(dim(paint, 0.8), 0.08, 0.1, ...on(0.72, 0.45, 0.03), 0, 0, ga, 6).cyl(IRON, 0.022, 0.4, ...on(0.72, 0.45, 0.1), 0, 0, -Math.PI / 2, 6);
  H.add(star(1, { color: WHITE }), 0xffffff, place(on(0.72, -0.45, 0.004), gn, [-0.66, 0.36, 0], 0.2));
  for (const z of [0.93, -0.93]) {
    headlight(H, HF, 2.3, 1.18, z, 0.075, IRON, 6);
    H.box(IRON, 0.03, 0.03, 0.26, 2.44, 1.3, z).box(IRON, 0.03, 0.2, 0.03, 2.44, 1.2, z + 0.12).box(IRON, 0.03, 0.2, 0.03, 2.44, 1.2, z - 0.12);
  }
  for (const z of [0.42, -0.42]) H.box(IRON, 0.08, 0.14, 0.06, 2.42, 0.8, z);
  // engine deck: grille doors, tools, the stowage box on the sloped tail with its lid line and two straps
  grille(HF, -1.92, -1.3, -0.74, 0.74, 1.645, 7, dim(paint, 0.8));
  H.box(dim(paint, 0.96), 0.5, 0.05, 0.6, -0.98, 1.66, 0.4).box(dim(paint, 0.96), 0.5, 0.05, 0.6, -0.98, 1.66, -0.4);
  H.box(paint, 0.3, 0.6, 1.9, -2.43, 1.33, 0).box(dim(paint, 1.08), 0.32, 0.03, 1.92, -2.43, 1.64, 0).box(IRON, 0.04, 0.06, 0.12, -2.6, 1.5, 0.5).box(IRON, 0.04, 0.06, 0.12, -2.6, 1.5, -0.5);
  HF.poly([[-2.582, 1.47, -0.94], [-2.582, 1.47, 0.94], [-2.582, 1.49, 0.94], [-2.582, 1.49, -0.94]], [-1, 0, 0], dim(paint, 0.45));
  for (const z of [0.5, -0.5]) {
    HF.poly([[-2.583, 1.05, z - 0.035], [-2.583, 1.05, z + 0.035], [-2.583, 1.655, z + 0.035], [-2.583, 1.655, z - 0.035]], [-1, 0, 0], IRON);
    HF.poly([[-2.6, 1.657, z - 0.035], [-2.26, 1.657, z - 0.035], [-2.26, 1.657, z + 0.035], [-2.6, 1.657, z + 0.035]], [0, 1, 0], IRON);
  }
  H.box(WOOD, 0.9, 0.04, 0.05, -1.0, 1.665, -0.98).box(IRON, 0.22, 0.03, 0.16, -0.48, 1.665, -0.98).box(WOOD, 0.7, 0.04, 0.05, -1.6, 1.665, 0.98).box(IRON, 0.12, 0.05, 0.2, -1.2, 1.67, 0.98);
  H.add(HF.geometry());

  // turret: the ring at x = 0.2; near-vertical walls, a bustle over the deck, the rounded cast M23 mount in front
  const ts = (x, zb, zt, y0 = 0, h = 0.72) => ({ x, pts: [[zb, y0], [zb - 0.02, y0 + (h - y0) * 0.6], [zt, h], [-zt, h], [0.02 - zb, y0 + (h - y0) * 0.6], [-zb, y0]] });
  const secs = [ts(-0.86, 0.56, 0.48, 0.12, 0.68), ts(-0.74, 0.68, 0.6), ts(0.5, 0.7, 0.62), ts(0.72, 0.66, 0.56, 0, 0.7), ts(0.93, 0.48, 0.38, 0.04, 0.56)];
  T.add(loft(secs, FLAT), paint);
  // the owner's band: level, just under the roof edge, all the way round (over the sloped front above the mount)
  const lo = 0.575, hi = 0.665, zAt = (s, y) => { const p = s.pts; for (let i = 0; i < 2; i++) if (y >= p[i][1] && y <= p[i + 1][1]) return p[i][0] + ((p[i + 1][0] - p[i][0]) * (y - p[i][1])) / (p[i + 1][1] - p[i][1]); return p[2][0]; };
  const cut = (y) => [0.72 + (0.21 * (0.7 - y)) / 0.14, 0.56 - (0.18 * (0.7 - y)) / 0.14]; // where the top edge of the front facet is at height y
  for (const s of [1, -1]) {
    const side = [];
    for (let i = 0; i < 3; i++) { const a = secs[i], b = secs[i + 1]; side.push([[a.x, lo, zAt(a, lo)], [b.x, lo, zAt(b, lo)], [b.x, hi, zAt(b, hi)], [a.x, hi, zAt(a, hi)]]); }
    const a = secs[3], cl = cut(lo), ch = cut(hi);
    side.push([[a.x, lo, zAt(a, lo)], [cl[0], lo, cl[1]], [ch[0], hi, ch[1]], [a.x, hi, zAt(a, hi)]]);
    for (const q of side) {
      const pts = q.map(([x, y, z]) => [x, y, s * (z + 0.012)]), n = newell(pts);
      TF.poly(pts, n[2] * s > 0 ? n : n.map((v) => -v), f.color);
    }
  }
  const r0 = secs[0], cl = cut(lo), ch = cut(hi), fn = [0.555, 0.832, 0], up = (p) => [p[0] + fn[0] * 0.01, p[1] + fn[1] * 0.01, p[2]];
  TF.poly([[r0.x - 0.01, lo, zAt(r0, lo) + 0.012], [r0.x - 0.01, hi, zAt(r0, hi) + 0.012], [r0.x - 0.01, hi, -zAt(r0, hi) - 0.012], [r0.x - 0.01, lo, -zAt(r0, lo) - 0.012]], [-1, 0, 0], f.color);
  TF.poly([up([ch[0], hi, ch[1] + 0.012]), up([ch[0], hi, -ch[1] - 0.012]), up([cl[0], lo, -cl[1] - 0.012]), up([cl[0], lo, cl[1] + 0.012])], fn, f.color);
  // a light rim round the roof
  const roofH = new Map(secs.map((s) => [s.x, s.pts[2][1] + 0.004]));
  roofRim(TF, [...secs.map((s) => [s.x, s.pts[2][0]]), ...secs.slice().reverse().map((s) => [s.x, -s.pts[2][0]])], (p) => roofH.get(p[0]) ?? 0.72, 0.05, dim(paint, 1.18));
  // the M23 casting, rounded at the front, the recoil sleeve and the 37 mm; coaxial MG (left) and sight (right)
  T.add(loft([{ x: 0.9, w: 0.86, h: 0.44, y: 0.36, p: 4 }, { x: 1.0, w: 0.84, h: 0.42, y: 0.36, p: 4 }, { x: 1.07, w: 0.74, h: 0.36, y: 0.36, p: 3.5 }, { x: 1.11, w: 0.54, h: 0.24, y: 0.36, p: 3 }], { segments: 12, normals: 40 }), paint);
  T.cyl(dim(paint, 0.92), 0.07, 0.3, 1.26, 0.36, 0, 0, 0, -Math.PI / 2, 8);
  T.add(gunTube(1.45, 0.045, dim(paint, 0.85)), 0xffffff, xf(1.04, 0.36, 0)).cyl(IRON, 0.02, 0.12, 1.1, 0.36, -0.25, 0, 0, -Math.PI / 2, 6).box(BLACK, 0.02, 0.05, 0.06, 1.075, 0.45, 0.24);
  // roof: split hatch, periscopes; the .30 cal on a short pintle at the rear right with its ammunition box
  T.add(lathe([[0.25, 0], [0.25, 0.05], [0.19, 0.08], [0, 0.08]], 10), dim(paint, 1.05), xf(-0.4, 0.72, 0.18));
  T.box(dim(paint, 1.05), 0.4, 0.04, 0.36, -0.36, 0.73, -0.26).box(IRON, 0.12, 0.08, 0.1, 0.42, 0.76, 0.3).box(IRON, 0.12, 0.08, 0.1, 0.42, 0.76, -0.3);
  T.cyl(IRON, 0.025, 0.14, -0.7, 0.79, 0.46, 0, 0, 0, 6).box(IRON, 0.26, 0.08, 0.08, -0.66, 0.89, 0.46).cyl(IRON, 0.017, 0.5, -0.32, 0.9, 0.46, 0, 0, -Math.PI / 2, 6).box(dim(paint, 0.85), 0.1, 0.09, 0.07, -0.66, 0.87, 0.37);
  // pistol ports on the walls behind the stars
  for (const s of [1, -1]) {
    T.add(star(1, { color: WHITE }), 0xffffff, place([0.05, 0.38, s * 0.69], [0, 0.046, s], [0, 1, 0], 0.26));
    for (const [r, k, lift] of [[0.075, 0.55, 0.004], [0.058, 1.12, 0.008]]) {
      const pts = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; pts.push([-0.52 + r * Math.cos(a), 0.36 + r * Math.sin(a), s * (0.667 + lift)]); }
      TF.poly(pts, [0, 0.046, s], dim(paint, k));
    }
  }
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.2, 1.64, 0], tip: [1.04 + 1.45, 0.36, 0], s: 1 };
}

// ---------------------------------------------------------------- Panzer II Ausf. F

// Flat-sided superstructure on a narrow hull, fenders the full length with stowage boxes and tools, five big road
// wheels, four return rollers, a raised sprocket and a spoked idler. Six-sided turret set a little left with the
// 2 cm gun and the MG side by side in a box mount and a big round cupola. Balkenkreuz on the turret and the front.
function panzer2(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat();
  const tz = 0.99, t = 0.11, R = 0.31, wy = t + R, wheels = [1.32, 0.66, 0, -0.66, -1.32];
  const sp = [2.03, 0.72, 0.3], id = [-2.05, 0.66, 0.28], rollers = [[0.98, 0.91], [0.33, 0.91], [-0.33, 0.91], [-0.98, 0.91]];
  const road = roadWheel(R, 0.18, paint, { seg: 10, rim: 0.8, hub: 0.3 }), rol = roller(0.09, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  G.add(idler(id[2], 0.15, 6, paint), 0xffffff, xf(id[0], id[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.03));
  G.add(trackBelt([[sp[0], sp[1], 0.26], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.09])], tz, 0.3, { thick: t, pitch: 0.17 }));
  // fenders: flat over the track, both ends bent down
  G.box(paint, 4.36, 0.03, 0.34, -0.06, 1.14, tz).box(paint, 0.33, 0.03, 0.34, 2.27, 1.075, tz, 0, 0, -0.4).box(paint, 0.22, 0.03, 0.34, -2.34, 1.095, tz, 0, 0, 0.44);
  H.add(mirrorZ(G.geometry()));

  // lower hull with the sloped transmission cover and the nose plate, the superstructure on top
  H.add(loft([box4(-2.38, 0.56, 1.14, 0.82), box4(-2.2, 0.42, 1.14, 0.82), box4(1.74, 0.42, 1.32, 0.82), box4(2.3, 0.44, 1.1, 0.82), box4(2.42, 0.62, 1.04, 0.82)], FLAT), paint);
  H.add(loft([deck(-2.38, 1.14, 1.58, 0.86, 0.04), deck(-2.26, 1.14, 1.66, 0.88, 0.04), deck(1.74, 1.14, 1.66, 0.88, 0.04)], FLAT), paint);
  // front plate: driver's visor (left) and the dummy one; cover hatches and the cross; headlight, tow hooks
  H.box(IRON, 0.06, 0.1, 0.34, 1.76, 1.48, -0.42).box(BLACK, 0.02, 0.03, 0.22, 1.792, 1.48, -0.42).box(dim(paint, 0.8), 0.05, 0.08, 0.22, 1.76, 1.48, 0.42);
  const ca = -Math.atan2(0.22, 0.56), cn = [0.366, 0.931, 0];
  for (const z of [0.42, -0.42]) H.box(dim(paint, 1.05), 0.36, 0.03, 0.34, 2.02 + cn[0] * 0.015, 1.21 + cn[1] * 0.015, z, 0, 0, ca);
  H.add(balkenkreuz(1), 0xffffff, place([2.02 + cn[0] * 0.02, 1.21 + cn[1] * 0.02, 0], cn, [-0.931, 0.366, 0], 0.13));
  headlight(H, HF, 2.0, 1.25, -0.98);
  H.box(IRON, 0.04, 0.08, 0.04, 2.0, 1.18, -0.98);
  for (const z of [0.45, -0.45]) H.box(IRON, 0.08, 0.14, 0.06, 2.45, 0.76, z);
  // fenders: stowage boxes, the jack, shovel and crowbar
  H.box(paint, 0.55, 0.24, 0.28, 1.35, 1.28, -1.0).box(paint, 0.4, 0.2, 0.28, 1.5, 1.26, 1.0).box(paint, 0.62, 0.2, 0.28, -1.75, 1.26, 1.0).box(paint, 0.45, 0.22, 0.28, -1.85, 1.27, -1.0);
  H.box(WOOD, 1.1, 0.04, 0.05, 0.25, 1.18, 1.02).box(IRON, 0.22, 0.03, 0.16, 0.9, 1.18, 1.02).box(WOOD, 0.9, 0.05, 0.05, 0.15, 1.18, -1.02).cyl(IRON, 0.06, 0.4, -0.65, 1.22, -1.0, 0, 0, Math.PI / 2, 6);
  // engine deck: three grilles across the back, the access hatch, the muffler and smoke candle rack on the tail
  for (const [z0, z1] of [[0.3, 0.8], [-0.25, 0.25], [-0.8, -0.3]]) grille(HF, -1.98, -1.38, z0, z1, 1.664, 5, dim(paint, 0.8));
  H.box(dim(paint, 1.04), 0.5, 0.04, 1.2, -1.02, 1.68, 0);
  H.cyl(IRON, 0.1, 0.55, -2.48, 0.94, -0.35, Math.PI / 2, 0, 0, 8).box(dim(paint, 0.85), 0.14, 0.16, 0.42, -2.44, 1.4, 0.5);
  H.add(balkenkreuz(1), 0xffffff, place([-2.385, 1.34, -0.4], [-1, 0, 0], [0, 1, 0], 0.13));
  H.add(HF.geometry());

  // turret: ring at x = 0.12, z = -0.1; angled front and rear plates, sides leaning in, the box mount, the cupola
  const TH = 0.65, base = [[0.86, 0.38], [0.48, 0.72], [-0.6, 0.72], [-0.86, 0.47], [-0.86, -0.47], [-0.6, -0.72], [0.48, -0.72], [0.86, -0.38]];
  const top = [[0.64, 0.31], [0.4, 0.62], [-0.54, 0.62], [-0.75, 0.4], [-0.75, -0.4], [-0.54, -0.62], [0.4, -0.62], [0.64, -0.31]];
  const wallZ = (y) => 0.72 + (0.62 - 0.72) * (y / TH), wn = Math.hypot(0.1, TH), lean = [0, 0.1 / wn, TH / wn]; // the side walls
  T.add(vloft([{ y: 0, pts: base }, { y: TH, pts: top }], FLAT), paint);
  T.add(vloft([{ y: 0.52, pts: grow(between(base, top, 0.52 / TH), 1.02) }, { y: 0.6, pts: grow(between(base, top, 0.6 / TH), 1.02) }], { caps: false, normals: 'flat' }), f.color);
  roofRim(TF, top, TH + 0.004, 0.05, dim(paint, 1.18));
  // the box mount, lighter so the twin guns stand out from the front: two pale sleeves with dark bores
  T.add(chamferBox(0.26, 0.38, 0.72, 0.04), dim(paint, 1.12), xf(0.86, 0.29, 0.04));
  T.cyl(dim(paint, 1.3), 0.095, 0.2, 1.06, 0.3, 0.2, 0, 0, -Math.PI / 2, 8).cyl(dim(paint, 1.3), 0.07, 0.14, 1.04, 0.3, -0.04, 0, 0, -Math.PI / 2, 8);
  T.add(gunTube(1.05, 0.04, IRON, { lip: 0.14, lipR: 1.45 }), 0xffffff, xf(1.14, 0.3, 0.2));
  const bore = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; bore.push([1.112, 0.3 + 0.034 * Math.sin(a), -0.04 + 0.034 * Math.cos(a)]); }
  TF.poly(bore, [1, 0, 0], BLACK);
  T.box(BLACK, 0.02, 0.04, 0.12, 1.0, 0.41, -0.22);
  const cup = paintBy(lathe([[0.32, 0], [0.32, 0.08], [0.29, 0.09], [0.29, 0.14], [0.32, 0.15], [0.25, 0.21], [0, 0.22]], 12), (p) => (Math.abs(Math.hypot(p.x, p.z) - 0.29) < 0.005 ? col(BLACK) : col(paint)));
  T.add(cup, 0xffffff, xf(-0.24, TH, 0)).box(dim(paint, 1.1), 0.3, 0.04, 0.34, 0.38, TH + 0.01, -0.24);
  for (const s of [1, -1]) {
    T.add(balkenkreuz(1), 0xffffff, place([-0.06, 0.28, s * (wallZ(0.28) + 0.004)], [0, lean[1], s * lean[2]], [0, 1, 0], 0.15));
    T.box(IRON, 0.12, 0.06, 0.02, 0.4, 0.36, s * (wallZ(0.36) - 0.01), 0, s * 0.6, 0);
  }
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.12, 1.66, -0.1], tip: [1.14 + 1.05, 0.3, 0.2], s: 1 };
}

// ---------------------------------------------------------------- T-70

// Small welded hull with a sloped glacis and lower plate meeting at the nose, fenders the full length (fuel drum
// and box on the left), five spoked rubber-tired road wheels and a matching raised idler, three return rollers, the
// sprocket up front, one headlight on the left. Tall faceted turret set well to the left, cast mantlet, 45 mm gun.
// Red star edged in white.
function t70(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat();
  const tz = 1.03, t = 0.11, R = 0.27, wy = t + R, wheels = [1.3, 0.65, 0, -0.65, -1.3];
  const sp = [1.99, 0.65, 0.3], id = [-1.85, 0.6, 0.27], rollers = [[0.96, 0.82], [0.07, 0.82], [-0.86, 0.82]];
  // the wheel discs a shade lighter than the hull so the spokes read against the dark track
  const road = roadWheel(R, 0.18, dim(paint, 1.12), { seg: 12, spokes: 6, rim: 0.76 }), rol = roller(0.075, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(road, 0xffffff, xf(id[0], id[1], tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.03));
  G.add(trackBelt([[sp[0], sp[1], 0.24], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.075])], tz, 0.27, { thick: t, pitch: 0.17 }));
  G.box(paint, 4.1, 0.03, 0.38, -0.05, 1.02, tz).box(paint, 0.34, 0.03, 0.38, 2.15, 0.96, tz, 0, 0, -0.4).box(paint, 0.16, 0.03, 0.38, -2.15, 0.99, tz, 0, 0, 0.4);
  H.add(mirrorZ(G.geometry()));

  // hull: the long upper glacis and the lower plate meeting at the narrow nose, the sloped plate at the back; the
  // top edges chamfered so they catch the light
  H.add(loft([deck(-2.12, 0.62, 1.28, 0.8), deck(-1.92, 0.4, 1.5, 0.8), deck(1.2, 0.4, 1.5, 0.8), deck(1.95, 0.42, 1.134, 0.8), deck(2.06, 0.68, 1.08, 0.8), deck(2.16, 0.92, 1.0, 0.8, 0.03)], FLAT), paint);
  const ga = -Math.atan2(0.42, 0.86), gn = [0.439, 0.899, 0], on = (u, z, lift) => [1.2 + 0.86 * u + gn[0] * lift, 1.5 - 0.42 * u + gn[1] * lift, z];
  // glacis: the driver's hatch with its periscope, a bar; the one headlight on the left in hull paint, a guard bar
  // over it
  H.box(dim(paint, 1.08), 0.46, 0.05, 0.6, ...on(0.36, 0, 0.025), 0, 0, ga).box(dim(paint, 0.85), 0.06, 0.06, 0.6, ...on(0.12, 0, 0.04), 0, 0, ga);
  H.box(IRON, 0.08, 0.06, 0.14, ...on(0.2, 0.14, 0.07), 0, 0, ga).box(IRON, 0.05, 0.04, 0.3, ...on(0.86, 0, 0.04), 0, 0, ga);
  headlight(H, HF, 1.76, 1.33, -0.6, 0.07, paint, 6);
  H.box(paint, 0.05, 0.1, 0.05, 1.74, 1.26, -0.6).box(paint, 0.03, 0.03, 0.2, 1.85, 1.41, -0.6);
  for (const z of [0.4, -0.4]) H.box(IRON, 0.07, 0.14, 0.05, 2.07, 0.7, z);
  // left fender: the stowage box and the fuel drum; right fender: shovel and crowbar
  H.box(paint, 0.65, 0.3, 0.32, -0.25, 1.185, -1.0).box(dim(paint, 1.14), 0.67, 0.03, 0.34, -0.25, 1.34, -1.0);
  H.cyl(dim(paint, 0.82), 0.16, 0.86, -1.2, 1.195, -1.0, 0, 0, Math.PI / 2, 10);
  for (const x of [-0.95, -1.45]) H.box(IRON, 0.03, 0.34, 0.34, x, 1.195, -1.0);
  H.box(WOOD, 0.95, 0.04, 0.05, 0.3, 1.05, 1.02).box(IRON, 0.2, 0.03, 0.14, 0.88, 1.05, 1.02).box(IRON, 1.1, 0.035, 0.04, -0.6, 1.05, 0.94);
  // engine deck: two radiator grilles, the access hatch
  grille(HF, -1.8, -1.18, 0.26, 0.74, 1.504, 6, dim(paint, 0.82));
  grille(HF, -1.8, -1.18, -0.46, 0.1, 1.504, 6, dim(paint, 0.82));
  H.box(dim(paint, 1.06), 0.4, 0.04, 0.45, -0.86, 1.52, 0.42);
  H.add(HF.geometry());

  // turret: ring at x = 0.33, z = -0.24; welded octagonal walls leaning in (the front most), the cast mantlet,
  // hatch and periscope
  const TH = 0.74, base = [[0.8, 0.4], [0.52, 0.64], [-0.5, 0.64], [-0.8, 0.42], [-0.8, -0.42], [-0.5, -0.64], [0.52, -0.64], [0.8, -0.4]];
  const top = [[0.5, 0.3], [0.34, 0.53], [-0.42, 0.53], [-0.66, 0.34], [-0.66, -0.34], [-0.42, -0.53], [0.34, -0.53], [0.5, -0.3]];
  const wallZ = (y) => 0.64 - 0.11 * (y / TH), wn = Math.hypot(0.11, TH), lean = [0, 0.11 / wn, TH / wn];
  T.add(vloft([{ y: 0, pts: base }, { y: TH, pts: top }], FLAT), paint);
  T.add(vloft([{ y: 0.58, pts: grow(between(base, top, 0.58 / TH), 1.02) }, { y: 0.67, pts: grow(between(base, top, 0.67 / TH), 1.02) }], { caps: false, normals: 'flat' }), f.color);
  roofRim(TF, top, TH + 0.004, 0.05, dim(paint, 1.18));
  T.cyl(dim(paint, 0.95), 0.19, 0.56, 0.72, 0.32, 0, Math.PI / 2, 0, 0, 10);
  T.add(chamferBox(0.18, 0.36, 0.48, 0.05), dim(paint, 1.06), xf(0.86, 0.32, 0));
  T.add(gunTube(1.1, 0.05, dim(paint, 0.85)), 0xffffff, xf(0.94, 0.32, 0)).box(BLACK, 0.02, 0.04, 0.04, 0.955, 0.38, 0.15);
  T.add(lathe([[0.24, 0], [0.24, 0.04], [0.18, 0.07], [0, 0.07]], 10), dim(paint, 1.08), xf(-0.14, TH, -0.08)).box(IRON, 0.12, 0.09, 0.1, 0.2, TH + 0.04, 0.24);
  for (const s of [1, -1]) T.add(star(1, { color: RED, border: WHITE, edge: 0.12 }), 0xffffff, place([0.0, 0.32, s * (wallZ(0.32) + 0.005)], [0, lean[1], s * lean[2]], [0, lean[2], -s * lean[1]], 0.2));
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.33, 1.5, -0.24], tip: [0.94 + 1.1, 0.32, 0], s: 1 };
}

// ---------------------------------------------------------------- Tiger I

// Big slab-sided hull whose superstructure covers the tracks, the near-flat glacis and the vertical nose plate hung
// with spare links, eight stations of interleaved road wheels, the big toothed sprocket, exhaust stacks at the
// back. Horseshoe turret with the broad mantlet, the long 88 with its double-baffle muzzle brake, the cupola at the
// left rear, the stowage bin at the back and spare links on the sides. Dunkelgelb with broad soft patches of green
// and red-brown; the number in the owner's color.
const DUNKELGELB = 0x989b85, GREEN = 0x627368, BROWN = 0x766661;
// The camouflage: two smooth fields over the whole vehicle (in hull space), each a sum of three plane waves about
// 1.5 m long, so the patches come out 0.5 to 0.9 m across with soft edges. Each covers about a fifth of the paint.
const wave = (p, list) => list.reduce((s, [a, b, c, ph]) => s + Math.sin(a * p[0] + b * p[1] + c * p[2] + ph), 0);
const GREEN_WAVES = [[3.1, 1.2, 2.3, 0.4], [-1.9, 2.6, 3.4, 2.1], [2.4, -2.9, -1.6, 4.3]];
const BROWN_WAVES = [[-2.7, 1.9, 2.6, 1.3], [3.3, 2.2, -1.8, 5.2], [1.6, -3.1, 3.0, 0.7]];
const camoField = (p) => [smooth((wave(p, GREEN_WAVES) - 1.0) / 0.6 + 0.5), smooth((wave(p, BROWN_WAVES) - 0.97) / 0.6 + 0.5)];
const camo = (p) => { const [g, b] = camoField(p); return mix(mix(DUNKELGELB, GREEN, g), BROWN, b); };
// The patches over a flat face: a grid of nu by nv cells, at(s, t) the point at (s, t) in 0..1 across the face, n
// its normal. Each cell is colored per corner from the field (p moved by `to` into hull space); cells the paint
// misses are left out, as are those skip(p) drops at any corner (under a grille, inside the turret).
function camoGrid(F, at, nu, nv, n, { to = [0, 0, 0], skip = null, tone = 1 } = {}) {
  const P = (p) => [p[0] + to[0], p[1] + to[1], p[2] + to[2]];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const q = [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)];
    if (q.every((p) => Math.max(...camoField(P(p))) < 0.02) || (skip && q.some(skip))) continue;
    F.poly(q, n, q.map((p) => dim(camo(P(p)), tone)));
  }
}
function tiger(f) {
  const paint = DUNKELGELB, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat(), GF = flat();
  const tz = 1.42, t = 0.14, R = 0.42, wy = t + R, stations = Array.from({ length: 8 }, (_, k) => 1.82 - k * 0.52);
  const sp = [2.65, 0.74, 0.5], id = [-2.71, 0.62, 0.34];
  // interleaved road wheels: the outer row on the even stations, the inner row half hidden behind it
  const outer = roadWheel(R, 0.14, paint, { seg: 14, rim: 0.84, hub: 0.3 }), inner = roadWheel(R, 0.14, dim(paint, 0.78), { seg: 12, rim: 0.84, hub: 0.3 });
  stations.forEach((x, k) => G.add(k % 2 ? inner : outer, 0xffffff, xf(x, wy, k % 2 ? tz - 0.12 : tz + 0.08)));
  G.add(sprocketWheel(sp[2], 0.24, 18, paint), 0xffffff, xf(sp[0], sp[1], tz + 0.04));
  G.add(idler(id[2], 0.18, 8, paint), 0xffffff, xf(id[0], id[1], tz + 0.04));
  G.add(trackBelt([[sp[0], sp[1], 0.44], ...stations.map((x) => [x, wy, R]), [id[0], id[1], id[2]]], tz, 0.72, { thick: t, pitch: 0.22 }));
  G.box(paint, 0.85, 0.03, 0.74, 2.72, 1.36, tz, 0, 0, -0.26).box(paint, 0.32, 0.03, 0.74, -3.05, 1.08, tz, 0, 0, 0.3); // mudguards
  G.box(paint, 5.36, 0.05, 0.06, -0.33, 1.13, 1.73); // fender lip
  // the patches on the hull side (the same mirrored) and the cross
  camoGrid(GF, (s, v) => [-2.96 + 5.26 * s, 1.13 + 0.74 * v, 1.726], 15, 2, [0, 0, 1]);
  G.add(GF.geometry()).add(balkenkreuz(1), 0xffffff, place([-0.7, 1.53, 1.732], [0, 0, 1], [0, 1, 0], 0.24));
  // tow cables along the upper hull side, held by clamps
  for (const [x0, x1, y] of [[0.2, 1.95, 1.76], [-2.75, -1.15, 1.7]]) {
    G.box(IRON, x1 - x0, 0.04, 0.04, (x0 + x1) / 2, y, 1.74).box(IRON, 0.1, 0.1, 0.03, x0 - 0.04, y, 1.735).box(IRON, 0.1, 0.1, 0.03, x1 + 0.04, y, 1.735);
    for (const x of [x0 + 0.4, x1 - 0.4]) G.box(dim(paint, 0.8), 0.05, 0.08, 0.05, x, y, 1.745);
  }
  H.add(mirrorZ(G.geometry()));

  // lower hull with the glacis and the vertical nose plate, the superstructure over the tracks
  H.add(loft([box4(-3.02, 0.6, 1.12, 0.95), box4(-2.82, 0.45, 1.12, 0.95), box4(2.85, 0.45, 1.42, 0.95), box4(3.14, 0.95, 1.4, 0.95)], FLAT), paint);
  H.add(loft([deck(-3.06, 1.12, 1.84, 1.7, 0.04), deck(-2.96, 1.12, 1.91, 1.72, 0.04), deck(2.3, 1.12, 1.91, 1.72, 0.04)], FLAT), paint);
  // front plate: the driver's visor block (left) with its slit, the machine gun ball (right) in a dark ring
  H.box(dim(paint, 1.12), 0.08, 0.18, 0.44, 2.33, 1.71, -0.55).box(BLACK, 0.02, 0.035, 0.28, 2.372, 1.72, -0.55);
  const ballRing = [];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; ballRing.push([2.311, 1.66 + 0.21 * Math.sin(a), 0.55 + 0.21 * Math.cos(a)]); }
  HF.poly(ballRing, [1, 0, 0], dim(paint, 0.5));
  H.add(lathe([[0.17, 0], [0.15, 0.07], [0.08, 0.11], [0, 0.11]], 10, { axis: 'x' }), dim(paint, 1.12), xf(2.3, 1.66, 0.55)).cyl(IRON, 0.024, 0.3, 2.52, 1.66, 0.55, 0, 0, -Math.PI / 2, 6);
  // spare links hung across the nose plate: dark track plates with gaps between and a guide horn each
  H.box(LINK_DARK, 0.03, 0.36, 1.72, 3.155, 1.17, 0);
  for (let i = 0; i < 8; i++) {
    const z = (i - 3.5) * 0.21;
    H.box(i % 2 ? LINK : dim(LINK, 0.88), 0.05, 0.32, 0.19, 3.17, 1.17, z).box(LINK_LIT, 0.04, 0.1, 0.05, 3.21, 1.17, z);
  }
  for (const z of [0.68, -0.68]) H.box(IRON, 0.12, 0.08, 0.06, 3.0, 0.72, z);
  // roof: hatches, the engine deck grilles and fan covers, exhaust stacks with guards
  for (const z of [0.62, -0.62]) H.box(dim(paint, 1.1), 0.5, 0.04, 0.45, 1.85, 1.93, z).box(IRON, 0.1, 0.07, 0.14, 2.12, 1.95, z);
  for (const [z0, z1] of [[0.95, 1.55], [-1.55, -0.95]]) grille(HF, -2.8, -1.8, z0, z1, 1.914, 7, dim(paint, 0.8));
  for (const z of [0.42, -0.42]) H.add(lathe([[0.3, 0], [0.3, 0.03], [0, 0.05]], 10), dim(paint, 1.0), xf(-2.45, 1.91, z));
  for (const z of [0.45, -0.45]) H.cyl(IRON, 0.08, 0.6, -3.14, 1.66, z, 0, 0, 0, 8).box(dim(paint, 0.85), 0.05, 0.5, 0.3, -3.22, 1.64, z);
  // the patches on the deck (not under the turret or the grilles), the front plate, the glacis and the back
  const underGrille = (p) => p[0] < -1.76 && p[0] > -2.84 && Math.abs(p[2]) > 0.91 && Math.abs(p[2]) < 1.59;
  camoGrid(HF, (s, v) => [-2.96 + 5.22 * s, 1.916, -1.68 + 3.36 * v], 14, 9, [0, 1, 0], { skip: (p) => underGrille(p) || Math.hypot(p[0] + 0.1, p[2]) < 1.1 });
  camoGrid(HF, (s, v) => [2.306, 1.4 + 0.47 * v, -0.95 + 1.9 * s], 5, 1, [1, 0, 0]);
  for (const k of [1, -1]) camoGrid(HF, (s, v) => [2.306, 1.13 + 0.74 * v, k * (0.95 + 0.73 * s)], 2, 2, [1, 0, 0]);
  camoGrid(HF, (s, v) => [2.3 + 0.55 * s, 1.397 + 0.029 * s, -0.95 + 1.9 * v], 2, 5, [-0.053, 0.999, 0]);
  camoGrid(HF, (s, v) => [-3.066, 1.13 + 0.66 * v, -1.66 + 3.32 * s], 9, 2, [-1, 0, 0]);
  H.add(HF.geometry());

  // turret: the ring at x = -0.1; horseshoe walls (straight cheeks to the front plate), flat roof
  const outline = [[1.4, 1.12]];
  for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI; outline.push([0.1 + 1.7 * Math.cos(a), 1.25 * Math.sin(a)]); }
  outline.push([1.4, -1.12]);
  // the walls cut into rings and the cheeks split, so the patches run across them
  const walls = [];
  outline.forEach((p, i) => {
    walls.push(p);
    const q = outline[i + 1];
    if (q && (i === 0 || i === 11)) for (const k of [1 / 3, 2 / 3]) walls.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
  });
  const ringAt = [-0.1, 1.91, 0], RH = 0.85;
  T.add(paintBy(vloft([0, 0.25, 0.5, 0.75, 1].map((k) => ({ y: RH * k, pts: walls })), { normals: 30 }), (p) => camo([p.x + ringAt[0], p.y + ringAt[1], p.z])));
  // a dark line where the walls meet the deck; the roof patches inside a light rim, so the turret stands off the
  // hull
  const about = (k, pts = walls) => pts.map(([x, z]) => [0.1 + (x - 0.1) * k, z * k]);
  T.add(vloft([{ y: 0, pts: about(1.006, outline) }, { y: 0.07, pts: about(1.006, outline) }], { caps: false, normals: 30 }), dim(paint, 0.42));
  const rings = [1, 0.94, 0.7, 0.46, 0.22].map((k) => about(k)), Y = RH + 0.004, P3 = ([x, z]) => [x, Y, z];
  const hullP = (p) => [p[0] + ringAt[0], p[1] + ringAt[1], p[2]];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < walls.length; i++) {
      const j = (i + 1) % walls.length, q = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]].map(P3);
      if (r === 0) TF.poly(q, [0, 1, 0], q.map((p) => dim(camo(hullP(p)), 1.2)));
      else if (!q.every((p) => Math.max(...camoField(hullP(p))) < 0.02)) TF.poly(q, [0, 1, 0], q.map((p) => camo(hullP(p))));
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < walls.length; i++) {
    const q = [last[i], last[(i + 1) % walls.length], [0.1, 0]].map(P3);
    if (!q.every((p) => Math.max(...camoField(hullP(p))) < 0.02)) TF.poly(q, [0, 1, 0], q.map((p) => camo(hullP(p))));
  }
  // the broad mantlet and gun collar, patched like the walls; the stowage bin on the back
  const patched = (geo, x, y, z, k = 1) => paintBy(geo, (p) => dim(camo([p.x + x + ringAt[0], p.y + y + ringAt[1], p.z + z]), k));
  T.add(patched(chamferBox(0.32, 0.75, 1.85, 0.08), 1.56, 0.42, 0, 0.97), 0xffffff, xf(1.56, 0.42, 0)).cyl(dim(paint, 0.95), 0.17, 0.3, 1.86, 0.42, 0, 0, 0, -Math.PI / 2, 10);
  T.box(BLACK, 0.02, 0.06, 0.06, 1.725, 0.58, -0.38).box(BLACK, 0.02, 0.06, 0.06, 1.725, 0.58, -0.52).box(BLACK, 0.02, 0.05, 0.05, 1.725, 0.42, 0.45);
  // The 88: a long tube tapering to the muzzle and the double-baffle brake twice its width and 0.45 m long, two
  // baffles with a dark slot between them, the dark bore.
  const gL = 3.4, gr = 0.135, gm = gr * 0.85, br = 0.23, b0 = gL - 0.45, bore = 0.07, waist = gm * 1.2;
  const prof = [[0, 0], [gr * 1.12, 0], [gr * 1.12, 0.08], [gr, 0.12], [gm, b0 - 0.03], [br, b0 + 0.01], [br, b0 + 0.17], [waist, b0 + 0.18],
    [waist, b0 + 0.27], [br, b0 + 0.28], [br, gL - 0.02], [br * 0.9, gL], [bore, gL], [bore, gL - 0.12], [0, gL - 0.12]];
  const slot = (p) => { const r = Math.hypot(p.y, p.z); return (r < waist + 1e-3 && p.x > b0 + 0.175 && p.x < b0 + 0.275) || (r < bore + 1e-3 && p.x > gL - 0.13); };
  T.add(paintBy(lathe(prof, 10, { axis: 'x' }), (p) => (slot(p) ? col(BLACK) : dim(paint, 0.9))), 0xffffff, xf(1.9, 0.42, 0));
  T.add(patched(chamferBox(0.5, 0.42, 1.2, 0.04), -1.66, 0.44, 0, 0.95), 0xffffff, xf(-1.66, 0.44, 0));
  // roof: cupola at the left rear with its vision slits, loader's hatch, ventilator
  const cup = paintBy(lathe([[0.36, 0], [0.36, 0.09], [0.33, 0.1], [0.33, 0.17], [0.36, 0.18], [0.3, 0.25], [0, 0.26]], 12), (p) => (Math.abs(Math.hypot(p.x, p.z) - 0.33) < 0.005 ? col(BLACK) : col(paint)));
  T.add(cup, 0xffffff, xf(-0.75, RH, -0.75)).box(dim(paint, 1.1), 0.55, 0.04, 0.5, -0.3, 0.87, 0.55).cyl(IRON, 0.08, 0.08, 0.7, 0.89, 0.35, 0, 0, 0, 8);
  // sides: the number in the owner's color on the cheeks, spare track links on the curve
  for (const s of [1, -1]) {
    T.add(number('131', 0.42, f.color), 0xffffff, place([0.68, 0.46, s * 1.2], [0.0995, 0, s * 0.995], [0, 1, 0], 1));
    [-0.2, -0.44, -0.68].forEach((x, k) => {
      const z = 1.25 * Math.sqrt(1 - ((x - 0.1) / 1.7) ** 2), nx = (x - 0.1) / 1.7 ** 2, nz = z / 1.25 ** 2, l = Math.hypot(nx, nz);
      const ry = Math.atan2(nx / l, (s * nz) / l);
      T.box(k % 2 ? LINK : dim(LINK, 0.88), 0.2, 0.56, 0.05, x + (nx / l) * 0.03, 0.44, s * (z + (nz / l) * 0.03), 0, ry, 0);
      T.box(LINK_LIT, 0.05, 0.12, 0.04, x + (nx / l) * 0.07, 0.44, s * (z + (nz / l) * 0.07), 0, ry, 0);
    });
  }
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [-0.1, 1.91, 0], tip: [1.9 + gL, 0.42, 0], s: 0.94, height: 1.3 };
}

// ---------------------------------------------------------------- ZSU-37

// SU-76M-style chassis: a boxy front with a short glacis and the driver's hatch, five road wheels, a spoked idler
// and three return rollers. The open armored casemate at the back, pointed in front and as wide as the tracks,
// holds the 37 mm 61-K in its cradle on a pedestal behind a split shield (each half a front plate and a wing bent
// back), raised for air targets. Red star on the casemate, the owner's stripe along the top of its tall walls.
function zsu37(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat();
  const tz = 1.22, t = 0.11, R = 0.33, wy = t + R, wheels = [1.78, 1.02, 0.27, -0.48, -1.23];
  const sp = [2.41, 0.56, 0.27], id = [-2.24, 0.52, 0.26], rollers = [[1.37, 0.745], [-0.09, 0.745], [-1.51, 0.745]];
  const road = roadWheel(R, 0.19, paint, { seg: 10, rim: 0.8, hub: 0.32 }), rol = roller(0.075, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(roadWheel(id[2], 0.17, dim(paint, 1.08), { seg: 12, spokes: 6, rim: 0.8 }), 0xffffff, xf(id[0], id[1], tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.03));
  G.add(trackBelt([[sp[0], sp[1], 0.24], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.075])], tz, 0.3, { thick: t, pitch: 0.18 }));
  G.box(paint, 4.7, 0.03, 0.44, -0.12, 0.95, 1.16).box(paint, 0.4, 0.03, 0.44, 2.4, 0.9, 1.16, 0, 0, -0.35);
  H.add(mirrorZ(G.geometry()));

  // hull: a tall boxy front with a long glacis over the nose plate; the deck runs back under the casemate. The top
  // edges are chamfered so they catch the light.
  H.add(loft([deck(-2.62, 0.55, 1.5, 0.95), deck(-2.45, 0.42, 1.58, 0.95), deck(1.9, 0.42, 1.58, 0.95), deck(2.45, 0.42, 1.243, 0.95, 0.03), deck(2.52, 0.538, 1.2, 0.95, 0.03), deck(2.64, 0.74, 1.14, 0.95, 0.03)], FLAT), paint);
  const ga = -Math.atan2(0.38, 0.62), gn = [0.523, 0.853, 0], on = (u, z, lift) => [1.9 + 0.62 * u + gn[0] * lift, 1.58 - 0.38 * u + gn[1] * lift, z];
  // glacis: the driver's hatch and periscope (left), the big transmission hatch (right), a headlight; tow hooks
  H.box(dim(paint, 1.08), 0.34, 0.05, 0.42, ...on(0.45, -0.32, 0.025), 0, 0, ga).box(IRON, 0.07, 0.06, 0.14, ...on(0.12, -0.32, 0.06), 0, 0, ga);
  H.box(dim(paint, 1.04), 0.4, 0.04, 0.5, ...on(0.5, 0.3, 0.02), 0, 0, ga).box(IRON, 0.06, 0.03, 0.12, ...on(0.25, 0.3, 0.045), 0, 0, ga);
  headlight(H, HF, 2.3, 1.42, 0.72, 0.08);
  H.box(IRON, 0.05, 0.1, 0.05, 2.28, 1.34, 0.72);
  for (const z of [0.42, -0.42]) H.box(IRON, 0.08, 0.14, 0.06, 2.66, 0.86, z);
  H.box(dim(paint, 1.06), 0.5, 0.04, 0.6, 1.45, 1.6, -0.4).box(dim(paint, 1.06), 0.4, 0.04, 0.4, 1.5, 1.6, 0.45);
  // fenders: a toolbox at the front left, the muffler at the rear left
  H.box(paint, 0.6, 0.24, 0.3, 1.45, 1.08, -1.16).cyl(IRON, 0.12, 0.7, -1.95, 1.08, -1.16, 0, 0, Math.PI / 2, 8).cyl(dim(IRON, 1.3), 0.125, 0.04, -1.75, 1.08, -1.16, 0, 0, Math.PI / 2, 8);
  // rear deck grilles behind the casemate
  grille(HF, -2.42, -1.9, 0.12, 0.85, 1.584, 5, dim(paint, 0.82));
  grille(HF, -2.42, -1.9, -0.85, -0.12, 1.584, 5, dim(paint, 0.82));
  // The open casemate down to the fenders, pointed in front: low plates round the gun, tall sides and back. Each
  // wall shows its outside, its darker inside and a light top edge; the owner's stripe runs at one height along
  // the tall part only.
  const ring = [[0.89, 0.72], [0.4, 1.25], [-1.8, 1.25], [-1.8, -1.25], [0.4, -1.25], [0.89, -0.72]], Y0 = 1.0, FLOOR = 1.585, LOW = 1.84, TALL = 2.38;
  const tops = [[[0, LOW], [1, LOW]], [[0, LOW], [0.35 / 2.2, TALL], [1, TALL]], [[0, TALL], [1, TALL]], [[0, TALL], [1.85 / 2.2, TALL], [1, LOW]], [[0, LOW], [1, LOW]], [[0, LOW], [1, LOW]]];
  const outward = ring.map((a, i) => {
    const b = ring[(i + 1) % 6], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [(b[1] - a[1]) / l, (a[0] - b[0]) / l];
    return n[0] * ((a[0] + b[0]) / 2 + 0.45) + n[1] * ((a[1] + b[1]) / 2) < 0 ? [-n[0], -n[1]] : n;
  });
  const inner = ring.map((v, i) => { const p = outward[(i + 5) % 6], q = outward[i], k = 0.05 / (1 + p[0] * q[0] + p[1] * q[1]); return [v[0] - (p[0] + q[0]) * k, v[1] - (p[1] + q[1]) * k]; });
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  ring.forEach((a, i) => {
    const j = (i + 1) % 6, n = outward[i], N = [n[0], 0, n[1]], top = tops[i].map(([t, h]) => ({ o: lerp(a, ring[j], t), i: lerp(inner[i], inner[j], t), h }));
    HF.poly([[a[0], Y0, a[1]], [ring[j][0], Y0, ring[j][1]], ...top.slice().reverse().map((p) => [p.o[0], p.h, p.o[1]])], N, paint);
    HF.poly([[inner[i][0], FLOOR, inner[i][1]], [inner[j][0], FLOOR, inner[j][1]], ...top.slice().reverse().map((p) => [p.i[0], p.h, p.i[1]])], [-n[0], 0, -n[1]], dim(paint, 0.62));
    for (let k = 0; k + 1 < top.length; k++) {
      const p = top[k], q = top[k + 1], off = (v, h) => [v[0] + n[0] * 0.008, h, v[1] + n[1] * 0.008];
      HF.poly([[p.o[0], p.h, p.o[1]], [q.o[0], q.h, q.o[1]], [q.i[0], q.h, q.i[1]], [p.i[0], p.h, p.i[1]]], [0, 1, 0], dim(paint, 1.25));
      if (p.h === TALL && q.h === TALL) HF.poly([off(p.o, TALL - 0.17), off(q.o, TALL - 0.17), off(q.o, TALL - 0.06), off(p.o, TALL - 0.06)], N, f.color);
    }
  });
  HF.poly(inner.map(([x, z]) => [x, FLOOR, z]), [0, 1, 0], dim(paint, 0.5));
  // ammunition: clip racks against the back wall, ready boxes by the gun
  for (const s of [1, -1]) {
    H.box(dim(paint, 0.72), 0.55, 0.3, 0.34, -1.25, FLOOR + 0.15, s * 0.95).box(dim(paint, 0.85), 0.24, 0.22, 0.3, -0.35, FLOOR + 0.11, s * 1.0);
    for (let k = 0; k < 4; k++) H.box(k % 2 ? BRASS : dim(BRASS, 0.85), 0.08, 0.05, 0.28, -1.42 + k * 0.12, FLOOR + 0.32, s * 0.95);
  }
  for (const s of [1, -1]) H.add(star(1, { color: RED, border: WHITE, edge: 0.12 }), 0xffffff, place([-0.9, 1.82, s * 1.256], [0, 0, s], [0, 1, 0], 0.32));
  // the crew door in the back wall
  H.box(dim(paint, 0.9), 0.03, 0.66, 0.72, -1.815, 1.86, 0.3).box(IRON, 0.03, 0.05, 0.14, -1.835, 1.9, 0.02);
  H.add(HF.geometry());

  // gun mount: the pivot is the pedestal on the casemate floor at x = 0.15; the cradle's side plates carry the
  // trunnion at (0, 0.75), the gun raised by e about it
  const e = 0.33, ce = Math.cos(e), se = Math.sin(e), along = (d, up = 0) => [ce * d - se * up, 0.75 + se * d + ce * up];
  T.cyl(dim(paint, 0.75), 0.24, 0.42, 0, 0.21, 0, 0, 0, 0, 8).box(paint, 0.8, 0.1, 0.8, 0, 0.46, 0);
  for (const z of [0.24, -0.24]) T.box(dim(paint, 1.0), 0.62, 0.52, 0.06, 0, 0.72, z).box(dim(paint, 1.2), 0.62, 0.02, 0.06, 0, 0.99, z);
  T.cyl(IRON, 0.07, 0.56, 0, 0.75, 0, Math.PI / 2, 0, 0, 8);
  T.box(dim(paint, 0.85), 1.3, 0.28, 0.3, ...along(0.05), 0, 0, 0, e).box(dim(paint, 0.8), 0.5, 0.22, 0.24, ...along(-0.7), 0, 0, 0, e);
  T.box(BRASS, 0.32, 0.14, 0.1, ...along(-0.55, 0.19), 0, 0, 0, e).box(dim(BRASS, 0.8), 0.32, 0.04, 0.1, ...along(-0.55, 0.28), 0, 0, 0, e);
  // the barrel and its slotted flash hider: a thin tube 0.42 long ringed by dark slots, open at the front
  const gL = 2.3, hL = 0.42, hr = 0.05 * 1.25;
  T.add(gunTube(gL - hL, 0.05, IRON, { lip: 0.03, lipR: 1.1 }), 0xffffff, xf(...along(0.5), 0, 0, 0, e));
  const slots = [[0, 0.05], [0.05, 0.1], [0.1, 0.17], [0.17, 0.22], [0.22, 0.29], [0.29, 0.34], [0.34, hL]].map(([a, b], k) => [[hr, a], [hr, b], k % 2 ? BLACK : IRON]);
  const hider = bands([...slots, [[hr, hL], [hr * 0.6, hL], IRON], [[hr * 0.6, hL], [hr * 0.6, hL - 0.1], BLACK], [[hr * 0.6, hL - 0.1], [0, hL - 0.1], BLACK]], 6).rotateY(Math.PI / 2);
  T.add(hider, 0xffffff, xf(...along(0.5 + gL - hL), 0, 0, 0, e));
  for (const up of [0.13, -0.11]) T.cyl(dim(paint, 0.8), 0.045, 0.9, ...along(0.85, up), 0, 0, 0, e - Math.PI / 2, 6);
  // The split shield, each half a front plate either side of the gun and a wing bent back from its outer edge, the
  // wing lower so the two read as separate plates; light top edges. A sight, the hand wheels and seats.
  const sh = 0.12, wa = 0.82, wl = 0.46, wx = 0.6 - (wl / 2) * Math.sin(wa), wz = 0.62 + (wl / 2) * Math.cos(wa), lean = 0.42 * Math.sin(sh);
  for (const s of [1, -1]) {
    T.box(paint, 0.05, 1.0, 0.5, 0.6, 0.97, s * 0.37, 0, 0, sh).box(dim(paint, 1.25), 0.06, 0.03, 0.5, 0.6 - 0.47 * Math.sin(sh), 1.47, s * 0.37, 0, 0, sh);
    T.box(dim(paint, 0.94), 0.05, 0.84, wl, wx, 0.9, s * wz, 0, -s * wa, sh).box(dim(paint, 1.2), 0.06, 0.03, wl, wx - lean * Math.cos(wa), 1.317, s * (wz - lean * Math.sin(wa)), 0, -s * wa, sh);
  }
  T.box(IRON, 0.2, 0.08, 0.06, ...along(0.0, 0.18), -0.22, 0, 0, e).cyl(IRON, 0.1, 0.03, -0.15, 0.62, -0.32, Math.PI / 2, 0, 0, 8).cyl(IRON, 0.08, 0.03, -0.25, 0.55, 0.32, Math.PI / 2, 0, 0, 8);
  T.box(dim(paint, 0.7), 0.22, 0.05, 0.2, -0.45, 0.5, 0.45).box(dim(paint, 0.7), 0.22, 0.05, 0.2, -0.45, 0.5, -0.45);
  const tip = along(0.5 + gL);
  return { hull: H, turret: T, ring: [0.15, 1.585, 0], tip: [tip[0], tip[1], 0], s: 0.92 };
}

// ---------------------------------------------------------------- the unit-model hook

// Painted-miniature shading in the vertex colors: darker toward the ground and on faces that look down (a fake
// contact shadow under the hull and in the running gear, kept light so the wheels still read), a little lighter on
// faces that look up (a dry-brushed highlight on decks and roofs) and lighter again on the chamfered top edges,
// whose faces look half up. lift is the height of the geometry's origin above the ground.
const shade = (geo, lift, height) => ao(geo, {
  falloff: (p, n) => {
    const edge = smooth((0.86 - n.y) / 0.1) * smooth((n.y - 0.45) / 0.1);
    return (0.72 + 0.28 * smooth((p.y + lift) / height)) * (1 - 0.28 * Math.max(0, -n.y)) * (1 + 0.16 * Math.max(0, n.y)) * (1 + 0.15 * edge);
  },
});

const cache = new Map();
// The light tanks, the Tiger and the ZSU-37 as { hull, turret, ring, tip }: the two geometries (painted, scaled),
// where the turret sits on the hull and its muzzle in turret space. null for types this module does not build.
// Cached per type, faction and colors, so every tank of a player shares the geometry.
export function lightHeavy(type, fac, f) {
  const make = type === 'tank' ? [stuart, panzer2, t70][fac] : type === 'tiger' ? tiger : type === 'flaktrack' && fac === 2 ? zsu37 : null;
  if (!make) return null;
  const key = `${type}|${fac}|${f.vehicle}|${f.color}`;
  let out = cache.get(key);
  if (!out) {
    const m = make(f), s = m.s, height = m.height ?? 1.15;
    out = {
      hull: shade(m.hull.geometry(), 0, height).scale(s, s, s),
      turret: shade(m.turret.geometry(), m.ring[1], height).scale(s, s, s),
      ring: m.ring.map((v) => v * s), tip: m.tip.map((v) => v * s),
    };
    cache.set(key, out);
  }
  return out;
}
