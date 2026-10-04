// Light and heavy armor: the light tank of each faction (M5A1 Stuart, Panzer II Ausf. F, T-70), the Tiger I and the
// Soviet ZSU-37 self-propelled flak gun, built to read as real, weathered vehicles under the model textures.
//
// Each vehicle is two vertex-colored geometries: the hull (with its running gear, tracks and markings) and the
// turret, whose origin is the turret ring, the point v.turret turns around. They are drawn in metres from the real
// vehicles and scaled by S per vehicle, which keeps them near the footprint of the box models they replace.
// client/unit-models.js puts each geometry into one part painted white and bakes it like its other tanks, so a
// vehicle stays two draw calls. Axes as in the other unit models: +x forward, +y up, +z the vehicle's right side,
// the ground at y = 0.
// What each part is made of rides in its vertices (client/models/geom.js MATS): tires are rubber, tracks track steel,
// gun tubes and iron fittings gunmetal, cast mantlets cast armor, tool handles wood, tarpaulins canvas. The paint is
// a muted real color and the texture does the weathering; markings are plain.
// The owner's color is a small cue only: a tactical number on the turret (or casemate) sides and a recognition panel
// on a roof (the Tiger carries it as its number). Stars and crosses keep their own colors.
import * as THREE from 'three';
import { tagTrack } from './track-data.js';
import { merge, mirrorZ, loft, lathe, chamferBox, star, balkenkreuz, place, ao, xf, tag, tagWheel, scaleWheelPivots, matId, UNSET } from './geom.js';

const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYLS = new Map();
const cylGeo = (n) => CYLS.get(n) || CYLS.set(n, new THREE.CylinderGeometry(1, 1, 1, n)).get(n);
// The game's sun is warm (0xffd6a8) and the neutral tone map takes most of the smallest channel out of dark colors,
// so a neutral dark steel or a grey-green paint renders brown or yellow. These albedos are biased cool so they
// render as the color named: dark steel, rubber, off-white, wood, brass.
const RUBBER = 0x2b3238, LINK = 0x3d444c, LINK_LIT = 0x5a626b, LINK_DARK = 0x30363d, IRON = 0x434c55, WHITE = 0xd3e3ec, BLACK = 0x17191c;
const GUN = 0x59636c, LENS = 0xd5dde0, WOOD = 0x756d64, BRASS = 0xa99e77, INSIDE = 0x353c44, RED = 0xae555a, CANVAS = 0x6d6c58;
// the factions' vehicle colors (main.js) as the paint that renders like them: US olive drab a little browner and
// greyer, Soviet 4BO green olive, German panzer grey neutral and a little warm
const REPAINT = new Map([[0x59623d, 0x58634f], [0x4e5a38, 0x515f43], [0x50565a, 0x62615b]]);
// what a part is made of where its color says it (iron fittings, handles, tires, links): the kit and flat() use it
// unless a part names its material
const MAT_OF = new Map([[IRON, 'gunmetal'], [BLACK, 'gunmetal'], [BRASS, 'gunmetal'], [WOOD, 'wood'], [RUBBER, 'rubber'], [CANVAS, 'canvas'],
  [LINK, 'track-steel'], [LINK_LIT, 'track-steel'], [LINK_DARK, 'track-steel']]);
const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
const dim = (c, k) => col(c).clone().multiplyScalar(k);
const mix = (a, b, t) => col(a).clone().lerp(col(b), t);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- building blocks

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
      const [nx, ny, nz] = newell(pts); // to wind the outline toward dir
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
// a plan outline pushed out from its middle by a factor, and the outline part way between two others
const grow = (pts, k) => pts.map(([x, z]) => [x * k, z * k]);
const between = (a, b, t) => a.map(([x, z], i) => [x + (b[i][0] - x) * t, z + (b[i][1] - z) * t]);

// Rings around the z axis from a profile of bands [[r0, z0], [r1, z1], color, colorB, colorEnd, mat]: each band is seg
// quads, smooth around the axis and hard between bands; a band ending at r = 0 is a fan. With colorB the band
// alternates the two colors quad by quad (the spokes and holes of a spoked wheel), each quad with its own vertices.
// colorEnd is the color the first one fades to at the band's far end (a highlight on a wheel's rim). mat names what
// the band is made of (a rubber tire); left out, the model's paint.
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

// A road wheel, axle along z, outer face toward +z: a rubber tire, a dished steel disc and a hub cap. spokes > 0 makes
// the disc that many spokes with dark holes between (seg is then twice the spoke count). rubber = false makes the
// rim bare steel (idlers). The back is left open: it faces the hull.
function roadWheel(R, w, paint, { seg = 24, rim = 0.78, hub = 0.3, spokes = 0, tire = RUBBER, rubber = true } = {}) {
  const h = w / 2, Rr = R * rim, Rh = R * hub, tm = rubber ? 'rubber' : null;
  seg = Math.max(seg, 20);
  const disc = bands([
    [[R, -h], [R, h * 0.15], tire, null, null, tm], [[R, h * 0.15], [R * 0.96, h * 0.58], tire, null, null, tm],
    [[R * 0.96, h * 0.58], [Rr, h * 0.88], tire, null, null, tm],
    [[Rr, h * 0.88], [Rr * 0.92, h * 0.94], dim(paint, 1.16)],
    [[Rr * 0.92, h * 0.94], [Rh * 1.38, h * 0.44], dim(paint, 1.04), spokes ? dim(paint, 0.2) : null, paint],
    [[Rh * 1.38, h * 0.44], [Rh, h * 0.68], dim(paint, 0.86)],
    [[Rh, h * 0.68], [Rh * 0.85, h * 1.12], paint], [[Rh * 0.85, h * 1.12], [0, h * 1.12], dim(paint, 0.85)],
  ], spokes ? Math.max(seg, spokes * 4) : seg);
  const bolts = flat('gunmetal');
  for (let k = 0; k < 6; k++) {
    const a = k * TAU / 6, cx = Rh * 1.1 * Math.cos(a), cy = Rh * 1.1 * Math.sin(a), r = R * 0.032;
    bolts.poly(Array.from({ length: 6 }, (_, j) => { const b = j * TAU / 6; return [cx + r * Math.cos(b), cy + r * Math.sin(b), h * 0.68]; }), [0, 0, 1], IRON, 'gunmetal');
  }
  return tagWheel(merge([disc, bolts.geometry()]), R);
}
// A drive sprocket, axle along z, outer face toward +z: a toothed plate with worn-steel tooth edges and a hub.
// Each tooth is three points (a pointed tooth), or four (flat-topped) with flat = true.
function sprocketWheel(R, w, teeth, paint, { flat: flatTop = false } = {}) {
  const F = flat(), h = w / 2, step = TAU / teeth, rr = R * 0.8, ring = [], face = col(paint), edge = col(LINK_LIT);
  const tooth = flatTop ? [[-0.3, rr], [-0.12, R], [0.12, R], [0.3, rr]] : [[-0.32, rr], [0, R], [0.32, rr]];
  for (let k = 0; k < teeth; k++) for (const [t, r] of tooth) { const a = (k + t) * step; ring.push([r * Math.cos(a), r * Math.sin(a)]); }
  const per = tooth.length;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    F.poly([[0, 0, h], [p[0], p[1], h], [q[0], q[1], h]], [0, 0, 1], face);
    if (i % per === per - 1) return; // the root arc between two teeth faces the hub
    F.poly([[p[0], p[1], -h], [q[0], q[1], -h], [q[0], q[1], h], [p[0], p[1], h]], [q[1] - p[1], p[0] - q[0], 0], edge, 'track-steel');
  });
  const hub = dim(paint, 0.7);
  return tagWheel(merge([F.geometry(), bands([[[R * 0.42, h], [R * 0.3, h * 1.9], hub], [[R * 0.3, h * 1.9], [0, h * 1.9], hub]], 8)]), R);
}
// a spoked steel idler (no tire)
const idler = (R, w, spokes, paint) => roadWheel(R, w, paint, { spokes, rim: 0.84, hub: 0.26, tire: dim(paint, 0.85), rubber: false });
// a small return roller, axle along z, rubber rim
const roller = (r, w, paint) => tagWheel(bands([[[r, -w / 2], [r, w / 2], RUBBER, null, null, 'rubber'], [[r, w / 2], [0, w * 0.62], paint]], 6), r);

// The track around a set of wheels, lying in xy (axles along z) between z - width/2 and z + width/2: link plates
// along the belt that wraps the circles [[x, y, r], ...] (their convex hull, half a link thick further out), every
// other link a shade darker. Each link shows its tread (or, under the bottom run, its inner face) and its outer
// edge. The tread plates have thin gaps; the edge is a trapezoid whose inner side runs the full pitch, so the side
// of the track reads as one continuous dark band, lit along the tread edge.
function trackBelt(circles, z, width, { thick = 0.12, pitch = 0.17, color = LINK, edge = LINK_LIT, back = LINK_DARK } = {}) {
  const pts = [];
  for (const [x, y, r] of circles) for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU; pts.push([x + (r + thick / 2) * Math.cos(a), y + (r + thick / 2) * Math.sin(a)]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const loop = lo.slice(0, -1).concat(hi.slice(0, -1)), len = [0]; // counter-clockwise seen from +z
  for (let i = 1; i <= loop.length; i++) { const a = loop[i - 1], b = loop[i % loop.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[loop.length], n = Math.round(total / Math.min(pitch, 0.15)), step = total / n;
  const at = (s) => {
    let a = 0, b = loop.length;
    while (b - a > 1) { const m = (a + b) >> 1; if (len[m] <= s) a = m; else b = m; }
    const p = loop[a], q = loop[(a + 1) % loop.length], t = (s - len[a]) / Math.max(1e-9, len[a + 1] - len[a]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const F = flat('track-steel'), extra = flat('track-steel'), z0 = z - width / 2, z1 = z + width / 2, h = thick / 2, lit = col(color), dark = dim(color, 0.84), rim = col(edge), rim2 = dim(edge, 0.84), deep = col(back);
  for (let k = 0; k < n; k++) {
    const A = at(k * step + step * 0.03), B = at((k + 1) * step - step * 0.03), A0 = at(k * step), B0 = at((k + 1) * step), l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const nx = (B[1] - A[1]) / l, ny = (A[0] - B[0]) / l; // outward
    const Ao = [A[0] + nx * h, A[1] + ny * h], Bo = [B[0] + nx * h, B[1] + ny * h], Ai = [A0[0] - nx * h, A0[1] - ny * h], Bi = [B0[0] - nx * h, B0[1] - ny * h];
    // the tread, except under the bottom run where nothing sees it; there the inner face (seen between the wheels)
    if (ny > -0.85) F.poly([[Ao[0], Ao[1], z0], [Bo[0], Bo[1], z0], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [nx, ny, 0], k % 2 ? lit : dark);
    else F.poly([[Ai[0], Ai[1], z0], [Bi[0], Bi[1], z0], [Bi[0], Bi[1], z1], [Ai[0], Ai[1], z1]], [-nx, -ny, 0], k % 2 ? dark : dim(color, 0.7));
    if (ny <= -0.85) extra.poly([[Ao[0], Ao[1], z0], [Bo[0], Bo[1], z0], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [nx, ny, 0], k % 2 ? lit : dark);
    {
      const detail = ny > -0.85 ? F : extra;
      const u0 = 0.32, u1 = 0.56, rise = 0.027, inset = width * 0.08;
      const a = [Ao[0] + (Bo[0] - Ao[0]) * u0, Ao[1] + (Bo[1] - Ao[1]) * u0], b = [Ao[0] + (Bo[0] - Ao[0]) * u1, Ao[1] + (Bo[1] - Ao[1]) * u1];
      const c = [a[0] + nx * rise, a[1] + ny * rise], d = [b[0] + nx * rise, b[1] + ny * rise];
      detail.poly([[c[0], c[1], z0 + inset], [d[0], d[1], z0 + inset], [d[0], d[1], z1 - inset], [c[0], c[1], z1 - inset]], [nx, ny, 0], rim);
      detail.poly([[a[0], a[1], z0 + inset], [c[0], c[1], z0 + inset], [c[0], c[1], z1 - inset], [a[0], a[1], z1 - inset]], [-ny, nx, 0], rim2);
      detail.poly([[b[0], b[1], z0 + inset], [d[0], d[1], z0 + inset], [d[0], d[1], z1 - inset], [b[0], b[1], z1 - inset]], [ny, -nx, 0], rim2);
    }
    const r = k % 2 ? rim : rim2;
    F.poly([[Ai[0], Ai[1], z1], [Bi[0], Bi[1], z1], [Bo[0], Bo[1], z1], [Ao[0], Ao[1], z1]], [0, 0, 1], [deep, deep, r, r]);
  }
  const original = F.geometry();
  return tagTrack(merge([original, extra.geometry()]), loop, z, original);
}

// a gun tube along +x from x = 0: breech sleeve, taper, a muzzle lip (longer and fatter for flash hiders); the bore
// is a dark dot. Bare gunmetal.
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
// a headlight on the hull: housing along x and its lens
function headlight(K, F, x, y, z, r = 0.075, color = IRON, n = 8) {
  K.cyl(color, r, 0.14, x, y, z, 0, 0, -Math.PI / 2, n);
  lens(F, x + 0.071, y, z, r * 0.8);
}
// A row of rivet heads along a line: n small squares from a to b (3D points) on a plane facing dir
function rivets(F, a, b, n, dir, color, s = 0.02) {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(ux, uy, uz) || 1;
  // a side vector across the line, in the plane facing dir
  const side = [uy * dir[2] - uz * dir[1], uz * dir[0] - ux * dir[2], ux * dir[1] - uy * dir[0]], sl = Math.hypot(...side) || 1;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), c = [a[0] + ux * t, a[1] + uy * t, a[2] + uz * t];
    const e = [(ux / l) * s, (uy / l) * s, (uz / l) * s], g = [(side[0] / sl) * s, (side[1] / sl) * s, (side[2] / sl) * s];
    F.poly([[c[0] - e[0] - g[0], c[1] - e[1] - g[1], c[2] - e[2] - g[2]], [c[0] + e[0] - g[0], c[1] + e[1] - g[1], c[2] + e[2] - g[2]],
      [c[0] + e[0] + g[0], c[1] + e[1] + g[1], c[2] + e[2] + g[2]], [c[0] - e[0] + g[0], c[1] - e[1] + g[1], c[2] - e[2] + g[2]]], dir, color);
  }
}
// A tactical number facing +z, h tall, centered on the origin, in seven-segment strokes of one color (edge: a darker
// outline under it). Flat paint, no texture.
const W7 = 0.58, T7 = 0.21;
const SEG7 = { a: [0, 1 - T7, W7, 1], b: [W7 - T7, 0.5, W7, 1], c: [W7 - T7, 0, W7, 0.5], d: [0, 0, W7, T7], e: [0, 0, T7, 0.5], f: [0, 0.5, T7, 1], g: [0, 0.5 - T7 / 2, W7, 0.5 + T7 / 2] };
const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function number(text, h, color, edge = null) {
  const F = flat('plain'), w = W7 * h, gap = 0.24 * h, total = text.length * w + (text.length - 1) * gap;
  [...text].forEach((ch, i) => {
    const x0 = -total / 2 + i * (w + gap);
    for (const s of DIGITS[+ch]) {
      const [a, b, c, d] = SEG7[s], X0 = x0 + a * h, X1 = x0 + c * h, Y0 = (b - 0.5) * h, Y1 = (d - 0.5) * h;
      if (edge != null) { const e = 0.05 * h; F.poly([[X0 - e, Y0 - e, 0.003], [X1 + e, Y0 - e, 0.003], [X1 + e, Y1 + e, 0.003], [X0 - e, Y1 + e, 0.003]], [0, 0, 1], edge); }
      F.poly([[X0, Y0, 0.006], [X1, Y0, 0.006], [X1, Y1, 0.006], [X0, Y1, 0.006]], [0, 0, 1], color);
    }
  });
  return F.geometry();
}
// an owner-color recognition panel lying on a roof at height y: x0..x1 along the vehicle, z0..z1 across, a dark border
function roofPanel(F, x0, x1, z0, z1, y, color) {
  const e = 0.025;
  F.poly([[x0 - e, y, z0 - e], [x1 + e, y, z0 - e], [x1 + e, y, z1 + e], [x0 - e, y, z1 + e]], [0, 1, 0], BLACK, 'plain');
  F.poly([[x0, y + 0.004, z0], [x1, y + 0.004, z0], [x1, y + 0.004, z1], [x0, y + 0.004, z1]], [0, 1, 0], color, 'plain');
}
// loft sections: a box [z, y] ring, one with its top edges chamfered by c, and one from half a profile: [z, y] points
// from the bottom up the right side to the top, mirrored for the left
const box4 = (x, y0, y1, z) => ({ x, pts: [[z, y0], [z, y1], [-z, y1], [-z, y0]] });
const deck = (x, y0, y1, z, c = 0.05) => ({ x, pts: [[z, y0], [z, y1 - c], [z - c, y1], [c - z, y1], [-z, y1 - c], [-z, y0]] });
const sec = (x, half) => ({ x, pts: [...half, ...half.slice().reverse().map(([z, y]) => [-z, y])] });
const FLAT = { normals: 'flat' };
// the cast turret mantlet: a rounded bulge along +x, sections [x, width, height], centered at height y
const mantlet = (y, list, seg = 12) => loft(list.map(([x, w, h, p = 4]) => ({ x, w, h, y, p })), { segments: seg, normals: 40 });

// ---------------------------------------------------------------- M5A1 Stuart

// Tall hull whose sponsons overhang the tracks, a short glacis with two hatches over the rounded transmission
// cover, two vertical-volute bogies a side, a raised sprocket in front and a big idler trailing on the ground.
// Riveted sponsons, a stowage box on the tail. Welded octagonal turret with walls leaning in, the rounded cast M23
// mount with the 37 mm in its recoil sleeve, a .30 cal on the commander's hatch. White stars; the owner's number on
// the turret sides and a narrow panel on the roof.
function stuart(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), GF = flat(), HF = flat(), TF = flat();
  // running gear, right side (mirrored to the left)
  const tz = 0.995, t = 0.12, R = 0.255, wy = t + R, wheels = [1.55, 0.87, 0.1, -0.58];
  const sp = [2.12, 0.68, 0.29], id = [-1.72, 0.47, 0.36], rollers = [[0.95, 0.83], [0.04, 0.83], [-0.8, 0.83]];
  const road = roadWheel(R, 0.18, paint, { seg: 10, rim: 0.78 }), rol = roller(0.08, 0.12, paint);
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
  G.add(trackBelt([[sp[0], sp[1], 0.25], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.08])], tz, 0.3, { thick: t, pitch: 0.2 }));
  G.box(paint, 0.5, 0.025, 0.32, 2.3, 1.0, tz, 0, 0, -0.3); // front mudguard
  G.box(paint, 4.5, 0.05, 0.05, -0.04, 1.045, 1.12); // the sponson's bottom lip
  // the sponson side: rows of rivet heads along the top and bottom edges and the plate seams
  rivets(GF, [-2.1, 1.56, 1.123], [2.0, 1.56, 1.123], 13, [0, 0, 1], dim(paint, 1.25), 0.02);
  GF.poly([[-2.0, 1.3, 1.123], [2.0, 1.3, 1.123], [2.0, 1.313, 1.123], [-2.0, 1.313, 1.123]], [0, 0, 1], dim(paint, 0.55));
  for (const x of [0.92, -0.62]) {
    GF.poly([[x, 1.07, 1.123], [x + 0.022, 1.07, 1.123], [x + 0.022, 1.5, 1.123], [x, 1.5, 1.123]], [0, 0, 1], dim(paint, 0.5));
    rivets(GF, [x - 0.05, 1.14, 1.123], [x - 0.05, 1.5, 1.123], 3, [0, 0, 1], dim(paint, 1.25), 0.018);
  }
  rivets(GF, [-2.02, 1.09, 1.123], [2.08, 1.09, 1.123], 10, [0, 0, 1], dim(paint, 1.22), 0.02);
  G.add(GF.geometry());
  H.add(mirrorZ(G.geometry()));

  // lower hull between the tracks ending in the rounded transmission cover; the upper hull over the tracks
  H.add(loft([box4(-2.22, 0.56, 1.2, 0.8), box4(-2.02, 0.4, 1.2, 0.8), box4(1.95, 0.4, 1.27, 0.8), box4(2.18, 0.5, 1.27, 0.8), box4(2.32, 0.66, 1.24, 0.8), box4(2.39, 0.86, 1.14, 0.8)], FLAT), paint);
  H.add(loft([deck(-2.3, 1.04, 1.32, 1.08, 0.03), deck(-1.95, 1.04, 1.64, 1.12), deck(1.56, 1.04, 1.64, 1.12), deck(2.22, 1.04, 1.28, 1.12, 0.02)], FLAT), paint);
  // glacis: two hatches with periscopes, the bow gun, a star; headlights with brush guards; tow shackles
  const ga = -Math.atan2(0.36, 0.66), gn = [0.479, 0.878, 0], on = (u, z, lift) => [1.56 + 0.66 * u + gn[0] * lift, 1.64 - 0.36 * u + gn[1] * lift, z];
  for (const z of [0.42, -0.42]) H.box(dim(paint, 1.05), 0.36, 0.05, 0.44, ...on(0.28, z, 0.02), 0, 0, ga).box(IRON, 0.08, 0.07, 0.16, ...on(0.06, z, 0.05), 0, 0, ga);
  H.cyl(dim(paint, 0.8), 0.08, 0.1, ...on(0.72, 0.45, 0.03), 0, 0, ga, 8).cyl(IRON, 0.026, 0.4, ...on(0.72, 0.45, 0.1), 0, 0, -Math.PI / 2, 6);
  H.add(star(1, { color: WHITE }), 0xffffff, place(on(0.72, -0.45, 0.004), gn, [-0.66, 0.36, 0], 0.2), 'plain');
  for (const z of [0.93, -0.93]) {
    headlight(H, HF, 2.3, 1.18, z, 0.075, IRON, 6);
    H.box(IRON, 0.03, 0.03, 0.26, 2.44, 1.3, z);
  }
  for (const z of [0.42, -0.42]) H.box(IRON, 0.08, 0.14, 0.06, 2.42, 0.8, z);
  // engine deck: grille doors, hatches, tools, the stowage box on the sloped tail with its lid line and two straps,
  // a rolled tarpaulin on the left sponson
  grille(HF, -1.92, -1.3, -0.74, 0.74, 1.645, 7, dim(paint, 0.8));
  H.box(dim(paint, 0.96), 0.5, 0.05, 0.6, -0.98, 1.66, 0.4).box(dim(paint, 0.96), 0.5, 0.05, 0.6, -0.98, 1.66, -0.4);
  H.box(dim(paint, 0.88), 0.12, 0.34, 0.22, -2.67, 1.45, 0.78).box(dim(paint, 0.88), 0.12, 0.34, 0.22, -2.67, 1.45, -0.78);
  H.box(paint, 0.3, 0.6, 1.9, -2.43, 1.33, 0).box(dim(paint, 1.06), 0.32, 0.03, 1.92, -2.43, 1.64, 0).box(IRON, 0.04, 0.06, 0.12, -2.6, 1.5, 0.5).box(IRON, 0.04, 0.06, 0.12, -2.6, 1.5, -0.5);
  HF.poly([[-2.582, 1.47, -0.94], [-2.582, 1.47, 0.94], [-2.582, 1.49, 0.94], [-2.582, 1.49, -0.94]], [-1, 0, 0], dim(paint, 0.45));
  for (const z of [0.5, -0.5]) {
    HF.poly([[-2.583, 1.05, z - 0.035], [-2.583, 1.05, z + 0.035], [-2.583, 1.655, z + 0.035], [-2.583, 1.655, z - 0.035]], [-1, 0, 0], IRON);
    HF.poly([[-2.6, 1.657, z - 0.035], [-2.26, 1.657, z - 0.035], [-2.26, 1.657, z + 0.035], [-2.6, 1.657, z + 0.035]], [0, 1, 0], IRON);
  }
  H.box(WOOD, 0.9, 0.04, 0.05, -1.0, 1.665, -0.98).box(IRON, 0.22, 0.03, 0.16, -0.48, 1.665, -0.98).box(WOOD, 0.7, 0.04, 0.05, -1.6, 1.665, 0.98).box(IRON, 0.12, 0.05, 0.2, -1.2, 1.67, 0.98);
  H.cyl(CANVAS, 0.1, 1.0, 0.45, 1.75, -0.98, 0, 0, Math.PI / 2, 10);
  H.add(HF.geometry());

  // turret: the ring at x = 0.2; eight welded walls leaning in, the rounded cast M23 mount in front
  const TH = 0.76;
  const base = [[0.8, 0.46], [0.5, 0.8], [-0.58, 0.8], [-0.92, 0.54], [-0.92, -0.54], [-0.58, -0.8], [0.5, -0.8], [0.8, -0.46]];
  const top = [[0.54, 0.34], [0.32, 0.64], [-0.52, 0.64], [-0.78, 0.46], [-0.78, -0.46], [-0.52, -0.64], [0.32, -0.64], [0.54, -0.34]];
  T.add(vloft([{ y: 0, pts: base }, { y: TH, pts: top }], FLAT), paint);
  const wallZ = (y) => 0.8 - 0.16 * (y / TH), wn = Math.hypot(0.16, TH), lean = [0, 0.16 / wn, TH / wn];
  // the cast mount, the recoil sleeve and the 37 mm; coaxial MG (left) and sight (right)
  T.add(mantlet(0.38, [[0.52, 0.96, 0.52], [0.8, 0.92, 0.48], [1.0, 0.78, 0.4, 3.5], [1.12, 0.5, 0.27, 3]], 14), paint, undefined, 'cast-armor');
  T.cyl(dim(paint, 0.9), 0.085, 0.3, 1.26, 0.38, 0, 0, 0, -Math.PI / 2, 8, 'cast-armor');
  T.add(gunTube(1.85, 0.058, GUN), 0xffffff, xf(1.06, 0.38, 0)).cyl(IRON, 0.024, 0.14, 1.14, 0.38, -0.29, 0, 0, -Math.PI / 2, 6).box(BLACK, 0.02, 0.06, 0.08, 1.1, 0.49, 0.27);
  // roof: the commander's cupola with the .30 cal on its ring (right), the loader's hatch (left), periscopes; a narrow
  // owner panel across the rear
  T.add(lathe([[0.22, 0], [0.22, 0.07], [0.17, 0.1], [0, 0.1]], 10), dim(paint, 1.02), xf(0.0, TH, 0.26));
  for (let i = 0; i < 2; i++) { const a = 0.4 + i * 2.8; T.box(BLACK, 0.03, 0.025, 0.05, 0 + 0.215 * Math.cos(a), TH + 0.045, 0.26 + 0.215 * Math.sin(a), 0, -a, 0); }
  T.box(dim(paint, 1.04), 0.4, 0.04, 0.34, 0.0, TH + 0.01, -0.28).box(IRON, 0.12, 0.08, 0.1, 0.38, TH + 0.04, 0.3).box(IRON, 0.12, 0.08, 0.1, 0.38, TH + 0.04, -0.3);
  T.cyl(IRON, 0.03, 0.16, 0.0, TH + 0.17, 0.26, 0, 0, 0, 6).box(IRON, 0.3, 0.07, 0.07, 0.08, TH + 0.27, 0.26).cyl(IRON, 0.017, 0.46, 0.4, TH + 0.27, 0.26, 0, 0, -Math.PI / 2, 6);
  T.box(dim(paint, 0.85), 0.1, 0.09, 0.07, 0.04, TH + 0.2, 0.36);
  roofPanel(TF, -0.62, -0.5, -0.4, 0.4, TH + 0.002, dim(f.color, 0.86));
  // the star and the number on the walls
  for (const s of [1, -1]) {
    T.add(star(1, { color: WHITE }), 0xffffff, place([0.2, 0.38, s * (wallZ(0.38) + 0.004)], [0, lean[1], s * lean[2]], [0, lean[2], -s * lean[1]], 0.27), 'plain');
    T.add(number('12', 0.28, f.color), 0xffffff, place([-0.36, 0.38, s * (wallZ(0.38) + 0.004)], [0, lean[1], s * lean[2]], [0, lean[2], -s * lean[1]], 1), 'plain');
  }
  T.box(IRON, 0.13, 0.025, 0.03, 0, TH + 0.115, 0.26).box(IRON, 0.13, 0.025, 0.03, 0, TH + 0.04, -0.28);
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.2, 1.64, 0], tip: [1.06 + 1.85, 0.38, 0], s: 1 };
}

// ---------------------------------------------------------------- Panzer II Ausf. F

// Flat-sided superstructure on a narrow hull, fenders the full length with stowage boxes and tools, five big road
// wheels, four return rollers, a raised sprocket and a spoked idler. Wide low octagonal turret set a little left with
// a vertical front plate, the 2 cm gun and the MG side by side in a rounded box mount and a big round cupola.
// Balkenkreuz on the turret and the front.
function panzer2(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat();
  const tz = 0.99, t = 0.12, R = 0.31, wy = t + R, wheels = [1.32, 0.66, 0, -0.66, -1.32];
  const sp = [2.03, 0.72, 0.3], id = [-2.05, 0.66, 0.28], rollers = [[0.98, 0.93], [0.33, 0.93], [-0.33, 0.93], [-0.98, 0.93]];
  const road = roadWheel(R, 0.18, paint, { seg: 12, rim: 0.8, hub: 0.3 }), rol = roller(0.09, 0.12, paint);
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
  H.add(loft([deck(-2.38, 1.14, 1.56, 0.85, 0.04), deck(-2.26, 1.14, 1.62, 0.86, 0.04), deck(1.74, 1.14, 1.62, 0.86, 0.04)], FLAT), paint);
  // front plate: driver's visor (left) and the dummy one; cover hatches and the cross; headlight, tow hooks
  H.box(IRON, 0.06, 0.1, 0.34, 1.76, 1.46, -0.42).box(BLACK, 0.02, 0.03, 0.22, 1.792, 1.46, -0.42).box(dim(paint, 0.8), 0.05, 0.08, 0.22, 1.76, 1.46, 0.42);
  const ca = -Math.atan2(0.22, 0.56), cn = [0.366, 0.931, 0];
  for (const z of [0.42, -0.42]) H.box(dim(paint, 1.05), 0.36, 0.03, 0.34, 2.02 + cn[0] * 0.015, 1.21 + cn[1] * 0.015, z, 0, 0, ca);
  H.add(balkenkreuz(1), 0xffffff, place([2.02 + cn[0] * 0.02, 1.21 + cn[1] * 0.02, 0], cn, [-0.931, 0.366, 0], 0.13), 'plain');
  headlight(H, HF, 2.0, 1.25, -0.98);
  for (const z of [0.45, -0.45]) H.box(IRON, 0.08, 0.14, 0.06, 2.45, 0.76, z);
  // fenders: stowage boxes, the jack, shovel and crowbar, a spare track length across the front
  H.box(paint, 0.55, 0.24, 0.28, 1.35, 1.28, -1.0).box(paint, 0.4, 0.2, 0.28, 1.5, 1.26, 1.0).box(paint, 0.62, 0.2, 0.28, -1.75, 1.26, 1.0).box(paint, 0.45, 0.22, 0.28, -1.85, 1.27, -1.0);
  H.box(WOOD, 1.1, 0.04, 0.05, 0.25, 1.18, 1.02).box(IRON, 0.22, 0.03, 0.16, 0.9, 1.18, 1.02).box(WOOD, 0.9, 0.05, 0.05, 0.15, 1.18, -1.02).cyl(IRON, 0.06, 0.4, -0.65, 1.22, -1.0, 0, 0, Math.PI / 2, 6);
  // engine deck: three grilles across the back, the access hatch, the muffler and smoke candle rack on the tail
  for (const [z0, z1] of [[0.3, 0.8], [-0.25, 0.25], [-0.8, -0.3]]) grille(HF, -1.98, -1.38, z0, z1, 1.564, 5, dim(paint, 0.8));
  H.box(dim(paint, 1.04), 0.5, 0.04, 1.2, -1.02, 1.62, 0);
  H.cyl(IRON, 0.1, 0.55, -2.48, 0.94, -0.35, Math.PI / 2, 0, 0, 8).box(dim(paint, 0.85), 0.14, 0.16, 0.42, -2.44, 1.4, 0.5);
  H.add(balkenkreuz(1), 0xffffff, place([-2.385, 1.34, -0.4], [-1, 0, 0], [0, 1, 0], 0.13), 'plain');
  H.add(HF.geometry());

  // turret: ring at x = 0.12, z = -0.1; a vertical front plate, angled corners and rear, sides leaning in, the box
  // mount, the cupola
  const TH = 0.58;
  const base = [[0.84, 0.4], [0.5, 0.74], [-0.58, 0.74], [-0.86, 0.46], [-0.86, -0.46], [-0.58, -0.74], [0.5, -0.74], [0.84, -0.4]];
  const top = [[0.8, 0.37], [0.44, 0.66], [-0.52, 0.66], [-0.76, 0.4], [-0.76, -0.4], [-0.52, -0.66], [0.44, -0.66], [0.8, -0.37]];
  const wallZ = (y) => 0.74 - 0.08 * (y / TH), wn = Math.hypot(0.08, TH), lean = [0, 0.08 / wn, TH / wn]; // the side walls
  T.add(vloft([{ y: 0, pts: base }, { y: TH, pts: top }], FLAT), paint);
  // the box mount, a rounded block with the two guns side by side in dark sleeves
  T.add(chamferBox(0.26, 0.34, 0.72, 0.05), dim(paint, 1.06), xf(0.92, 0.28, 0.0));
  T.cyl(dim(paint, 1.2), 0.085, 0.2, 1.1, 0.28, 0.2, 0, 0, -Math.PI / 2, 8, 'gunmetal').cyl(dim(paint, 1.2), 0.065, 0.14, 1.08, 0.28, -0.1, 0, 0, -Math.PI / 2, 8, 'gunmetal');
  T.add(gunTube(1.2, 0.05, GUN, { lip: 0.14, lipR: 1.4 }), 0xffffff, xf(1.18, 0.28, 0.2));
  T.cyl(IRON, 0.026, 0.5, 1.33, 0.28, -0.1, 0, 0, -Math.PI / 2, 6);
  T.box(BLACK, 0.02, 0.05, 0.14, 1.06, 0.4, -0.26).box(IRON, 0.04, 0.1, 0.2, 0.84, 0.46, 0.0);
  // the cupola: a big drum with eight vision slits and a hatch; a roof hatch in front; the owner panel
  const cup = paintBy(lathe([[0.37, 0], [0.37, 0.09], [0.33, 0.1], [0.33, 0.15], [0.37, 0.16], [0.28, 0.23], [0, 0.24]], 12), (p) => (Math.abs(Math.hypot(p.x, p.z) - 0.33) < 0.005 ? col(BLACK) : col(paint)));
  T.add(cup, 0xffffff, xf(-0.3, TH, 0));
  for (let i = 0; i < 8; i++) { const a = 0.2 + (i / 8) * TAU; T.box(BLACK, 0.025, 0.03, 0.06, -0.3 + 0.37 * Math.cos(a), TH + 0.1, 0.37 * Math.sin(a), 0, -a, 0); }
  T.box(dim(paint, 1.08), 0.32, 0.04, 0.3, 0.3, TH + 0.01, -0.26).box(IRON, 0.1, 0.06, 0.14, 0.5, TH + 0.03, 0.34);
  roofPanel(TF, 0.58, 0.7, -0.3, 0.3, TH + 0.002, dim(f.color, 0.86));
  for (const s of [1, -1]) {
    const nrm = [0, lean[1], s * lean[2]], up = [0, lean[2], -s * lean[1]];
    T.add(balkenkreuz(1), 0xffffff, place([0.22, 0.28, s * (wallZ(0.28) + 0.004)], nrm, up, 0.15), 'plain');
    T.add(number('21', 0.26, f.color), 0xffffff, place([-0.28, 0.28, s * (wallZ(0.28) + 0.004)], nrm, up, 1), 'plain');
    T.box(IRON, 0.12, 0.06, 0.02, 0.44, 0.38, s * (wallZ(0.38) - 0.005), 0, s * 0.6, 0);
  }
  T.box(IRON, 0.13, 0.025, 0.03, -0.28, TH + 0.235, 0).box(IRON, 0.12, 0.025, 0.03, 0.3, TH + 0.04, -0.26);
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.12, 1.62, -0.1], tip: [1.18 + 1.2, 0.28, 0.2], s: 1 };
}

// ---------------------------------------------------------------- T-70

// Small welded hull with a sloped glacis and lower plate meeting at the nose, sides leaning in over wide fenders (fuel
// drum and box on the left), five rubber-tired road wheels and a matching raised idler, three return rollers, the
// sprocket up front, one headlight on the left. Tall faceted turret set well to the left, cast mantlet, 45 mm gun.
// Red star, the owner's number on the turret sides and a panel on its roof.
function t70(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat();
  const tz = 1.03, t = 0.12, R = 0.27, wy = t + R, wheels = [1.3, 0.65, 0, -0.65, -1.3];
  const sp = [1.99, 0.65, 0.3], id = [-1.85, 0.6, 0.27], rollers = [[0.96, 0.84], [0.07, 0.84], [-0.86, 0.84]];
  const road = roadWheel(R, 0.18, dim(paint, 1.1), { seg: 12, spokes: 6, rim: 0.76 }), rol = roller(0.075, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(road, 0xffffff, xf(id[0], id[1], tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.03));
  G.add(trackBelt([[sp[0], sp[1], 0.24], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.075])], tz, 0.27, { thick: t, pitch: 0.17 }));
  for (const x of [1.1, 0, -1.1]) G.box(dim(paint, 0.85), 0.06, 0.14, 0.22, x, 0.94, tz + 0.02); // the fender brackets
  G.box(paint, 4.1, 0.03, 0.38, -0.05, 1.02, tz).box(paint, 0.34, 0.03, 0.38, 2.15, 0.96, tz, 0, 0, -0.4).box(paint, 0.16, 0.03, 0.38, -2.15, 0.99, tz, 0, 0, 0.4);
  H.add(mirrorZ(G.geometry()));

  // hull: the long upper glacis and the lower plate meeting at the narrow nose, the sloped plate at the back; the
  // sides lean in from the fender up
  H.add(loft([sec(-2.12, [[0.8, 0.62], [0.8, 0.98], [0.6, 1.28]]), sec(-1.92, [[0.88, 0.4], [0.88, 1.0], [0.7, 1.5]]), sec(1.2, [[0.88, 0.4], [0.88, 1.0], [0.7, 1.5]]),
    sec(1.95, [[0.8, 0.42], [0.8, 0.8], [0.62, 1.134]]), sec(2.06, [[0.78, 0.68], [0.78, 0.86], [0.56, 1.08]]), sec(2.16, [[0.7, 0.92], [0.7, 0.95], [0.46, 1.0]])], FLAT), paint);
  const ga = -Math.atan2(0.42, 0.86), gn = [0.439, 0.899, 0], on = (u, z, lift) => [1.2 + 0.86 * u + gn[0] * lift, 1.5 - 0.42 * u + gn[1] * lift, z];
  // glacis: the driver's hatch with its periscope, a bar; the one headlight on the left in hull paint, a guard bar
  // over it
  H.box(dim(paint, 1.06), 0.46, 0.05, 0.56, ...on(0.36, 0, 0.025), 0, 0, ga).box(dim(paint, 0.85), 0.06, 0.06, 0.56, ...on(0.12, 0, 0.04), 0, 0, ga);
  H.box(IRON, 0.08, 0.06, 0.14, ...on(0.2, 0.14, 0.07), 0, 0, ga).box(IRON, 0.05, 0.04, 0.3, ...on(0.86, 0, 0.04), 0, 0, ga);
  headlight(H, HF, 1.76, 1.33, -0.6, 0.07, paint, 6);
  H.box(paint, 0.05, 0.1, 0.05, 1.74, 1.26, -0.6).box(paint, 0.03, 0.03, 0.2, 1.85, 1.41, -0.6);
  for (const z of [0.4, -0.4]) H.box(IRON, 0.07, 0.14, 0.05, 2.07, 0.7, z);
  // left fender: the stowage box and the fuel drum; right fender: shovel and crowbar
  H.box(paint, 0.65, 0.3, 0.32, -0.25, 1.185, -1.0).box(dim(paint, 1.1), 0.67, 0.03, 0.34, -0.25, 1.34, -1.0);
  H.cyl(dim(paint, 0.82), 0.16, 0.86, -1.2, 1.195, -1.0, 0, 0, Math.PI / 2, 10);
  for (const x of [-0.95, -1.45]) H.box(IRON, 0.03, 0.34, 0.34, x, 1.195, -1.0);
  H.box(WOOD, 0.95, 0.04, 0.05, 0.3, 1.05, 1.02).box(IRON, 0.2, 0.03, 0.14, 0.88, 1.05, 1.02).box(IRON, 1.1, 0.035, 0.04, -0.6, 1.05, 0.94);
  H.cyl(CANVAS, 0.1, 0.9, -1.25, 1.13, 1.0, 0, 0, Math.PI / 2, 10).cyl(IRON, 0.05, 0.34, -2.2, 0.95, -0.55, 0, 0, Math.PI / 2, 8);
  H.box(IRON, 1.5, 0.04, 0.04, 0.55, 1.06, -1.12).box(IRON, 0.06, 0.07, 0.06, -0.2, 1.08, -1.12).box(IRON, 0.06, 0.07, 0.06, 1.3, 1.08, -1.12);
  // engine deck: two radiator grilles, the access hatch
  grille(HF, -1.8, -1.18, 0.26, 0.7, 1.504, 6, dim(paint, 0.82));
  grille(HF, -1.8, -1.18, -0.46, 0.1, 1.504, 6, dim(paint, 0.82));
  H.box(dim(paint, 1.06), 0.4, 0.04, 0.45, -0.86, 1.52, 0.42);
  // weld seams on the sloping upper side plates, broken at the engine compartment joint
  for (const side of [-1, 1]) {
    const sideAt = (x, y) => [x, y, side * (0.88 - (y - 1.0) * 0.36 + 0.006)];
    const normal = [0, 0.339, side * 0.941];
    HF.poly([sideAt(-1.85, 1.06), sideAt(1.18, 1.06), sideAt(1.18, 1.082), sideAt(-1.85, 1.082)], normal, dim(paint, 0.6));
    HF.poly([sideAt(-0.6, 1.06), sideAt(-0.578, 1.06), sideAt(-0.578, 1.43), sideAt(-0.6, 1.43)], normal, dim(paint, 0.65));
  }
  H.add(HF.geometry());

  // turret: ring at x = 0.33, z = -0.24; welded octagonal walls leaning in (the front most), the cast mantlet,
  // hatch and periscope
  const TH = 0.7, base = [[0.8, 0.4], [0.52, 0.64], [-0.5, 0.64], [-0.8, 0.42], [-0.8, -0.42], [-0.5, -0.64], [0.52, -0.64], [0.8, -0.4]];
  const top = [[0.5, 0.3], [0.34, 0.53], [-0.42, 0.53], [-0.66, 0.34], [-0.66, -0.34], [-0.42, -0.53], [0.34, -0.53], [0.5, -0.3]];
  const wallZ = (y) => 0.64 - 0.11 * (y / TH), wn = Math.hypot(0.11, TH), lean = [0, 0.11 / wn, TH / wn];
  T.add(vloft([{ y: 0, pts: base }, { y: TH, pts: top }], FLAT), paint);
  // the cast mantlet bulging out of the front facets, the 45 mm in it
  T.add(mantlet(0.32, [[0.42, 0.8, 0.46], [0.74, 0.74, 0.42], [0.92, 0.58, 0.36, 3.5], [1.0, 0.38, 0.24, 3]], 14), paint, undefined, 'cast-armor');
  T.add(gunTube(1.65, 0.064, GUN, { lip: 0.06, lipR: 1.2 }), 0xffffff, xf(0.98, 0.32, 0)).box(BLACK, 0.02, 0.05, 0.06, 0.95, 0.4, 0.2);
  T.cyl(IRON, 0.024, 0.14, 1.04, 0.32, -0.2, 0, 0, -Math.PI / 2, 6);
  // roof: a round hatch ring, a periscope housing and the owner panel on the rear; the lathe sits left of the middle
  T.add(lathe([[0.24, 0], [0.24, 0.05], [0.19, 0.08], [0, 0.08]], 12), dim(paint, 1.05), xf(-0.14, TH, -0.08)).box(IRON, 0.12, 0.09, 0.1, 0.2, TH + 0.04, 0.24);
  T.box(dim(paint, 1.06), 0.3, 0.035, 0.3, 0.08, TH + 0.01, 0.26);
  roofPanel(TF, -0.56, -0.44, -0.3, 0.26, TH + 0.002, dim(f.color, 0.86));
  for (const s of [1, -1]) {
    const nrm = [0, lean[1], s * lean[2]], up = [0, lean[2], -s * lean[1]];
    T.add(star(1, { color: RED, border: WHITE, edge: 0.12 }), 0xffffff, place([0.14, 0.34, s * (wallZ(0.34) + 0.005)], nrm, up, 0.2), 'plain');
    T.add(number('24', 0.26, f.color), 0xffffff, place([-0.32, 0.34, s * (wallZ(0.34) + 0.005)], nrm, up, 1), 'plain');
  }
  T.box(IRON, 0.15, 0.025, 0.03, -0.14, TH + 0.12, -0.08);
  for (const dx of [-0.06, 0.06]) T.box(IRON, 0.025, 0.035, 0.03, -0.14 + dx, TH + 0.095, -0.08);
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [0.33, 1.5, -0.24], tip: [0.98 + 1.65, 0.32, 0], s: 1 };
}

// ---------------------------------------------------------------- Tiger I

// Big slab-sided hull whose superstructure covers the tracks, the near-flat glacis and the vertical nose plate hung
// with spare links, eight stations of interleaved road wheels, the big toothed sprocket, exhaust stacks at the
// back. Horseshoe turret with the broad mantlet, the long 88 with its double-baffle muzzle brake, the cupola at the
// left rear, the stowage bin at the back and spare links on the sides. Dunkelgelb with hard-edged patches of olive
// green and red-brown; the number in the owner's color.
const DUNKELGELB = 0xa29b73, GREEN = 0x5b6a4d, BROWN = 0x6f5a49;
// The camouflage: two fields over the whole vehicle (in hull space), each a sum of three plane waves about 1.5 m
// long, so the patches come out 0.5 to 0.9 m across. Each covers about a fifth of the paint. They are laid as flat
// polygons clipped along the field's contour, so the edges are crisp.
const wave = (p, list) => list.reduce((s, [a, b, c, ph]) => s + Math.sin(a * p[0] + b * p[1] + c * p[2] + ph), 0);
const GREEN_WAVES = [[3.1, 1.2, 2.3, 0.4], [-1.9, 2.6, 3.4, 2.1], [2.4, -2.9, -1.6, 4.3]];
const BROWN_WAVES = [[-2.7, 1.9, 2.6, 1.3], [3.3, 2.2, -1.8, 5.2], [1.6, -3.1, 3.0, 0.7]];
const PATCHES = [[(p) => wave(p, GREEN_WAVES) - 1.0, GREEN, 0.004], [(p) => wave(p, BROWN_WAVES) - 0.97, BROWN, 0.007]];
// the part of a convex polygon where v (a value per corner) is >= 0, its edges cut where v crosses zero
function above(pts, v) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length, a = pts[i], b = pts[j];
    if (v[i] >= 0) out.push(a);
    if ((v[i] >= 0) !== (v[j] >= 0)) { const k = v[i] / (v[i] - v[j]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]); }
  }
  return out;
}
// camouflage patches over a flat quad or triangle q (corners in order) facing n; `to` moves a point into hull space
function patches(F, q, n, { to = [0, 0, 0], tone = 1 } = {}) {
  const tris = q.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
  for (const [field, color, lift] of PATCHES) {
    for (const tri of tris) {
      const pts = tri.map((i) => q[i]), v = pts.map((p) => field([p[0] + to[0], p[1] + to[1], p[2] + to[2]]));
      if (v.every((x) => x < 0)) continue;
      const poly = v.every((x) => x >= 0) ? pts : above(pts, v);
      if (poly.length >= 3) F.poly(poly.map((p) => [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift]), n, dim(color, tone));
    }
  }
}
// patches over a grid of nu by nv cells on a flat face: at(s, t) is the point at (s, t) in 0..1 across it
function patchGrid(F, at, nu, nv, n, { skip = null, ...opts } = {}) {
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const q = [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)];
    if (skip && q.some(skip)) continue;
    patches(F, q, n, opts);
  }
}
function tiger(f) {
  const paint = DUNKELGELB, H = kit(), T = kit(), G = kit(), HF = flat(), TF = flat(), GF = flat();
  const tz = 1.42, t = 0.14, R = 0.42, wy = t + R, stations = Array.from({ length: 8 }, (_, k) => 1.82 - k * 0.52);
  const sp = [2.65, 0.74, 0.5], id = [-2.71, 0.62, 0.34];
  // interleaved road wheels: the outer row on the even stations, the inner row half hidden behind it
  const outer = roadWheel(R, 0.14, paint, { seg: 10, rim: 0.76, hub: 0.3, tire: 0x252721 }), inner = roadWheel(R, 0.14, dim(paint, 0.68), { seg: 8, rim: 0.76, hub: 0.3, tire: 0x252721 });
  stations.forEach((x, k) => {
    // Paired overlapping discs occupy two staggered planes around each torsion-bar station.
    G.add(inner, 0xffffff, xf(x, wy, tz - 0.22));
    G.add(k % 2 ? inner : outer, 0xffffff, xf(x, wy, k % 2 ? tz - 0.02 : tz + 0.15));
  });
  G.add(sprocketWheel(sp[2], 0.24, 18, paint), 0xffffff, xf(sp[0], sp[1], tz + 0.04));
  G.add(idler(id[2], 0.18, 8, paint), 0xffffff, xf(id[0], id[1], tz + 0.04));
  G.add(trackBelt([[sp[0], sp[1], 0.44], ...stations.map((x) => [x, wy, R]), [id[0], id[1], id[2]]], tz, 0.72, { thick: t, pitch: 0.24 }));
  G.box(paint, 0.85, 0.03, 0.74, 2.72, 1.36, tz, 0, 0, -0.26).box(paint, 0.32, 0.03, 0.74, -3.05, 1.08, tz, 0, 0, 0.3); // mudguards
  G.box(paint, 5.36, 0.05, 0.06, -0.33, 1.13, 1.73); // fender lip
  // the patches on the hull side (the same mirrored) and the cross
  patchGrid(GF, (s, v) => [-2.96 + 5.26 * s, 1.13 + 0.74 * v, 1.726], 18, 3, [0, 0, 1]);
  rivets(GF, [-2.9, 1.82, 1.727], [2.2, 1.82, 1.727], 20, [0, 0, 1], dim(paint, 0.7), 0.016);
  G.add(GF.geometry()).add(balkenkreuz(1), 0xffffff, place([-0.7, 1.53, 1.732], [0, 0, 1], [0, 1, 0], 0.24), 'plain');
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
  H.add(lathe([[0.17, 0], [0.15, 0.07], [0.08, 0.11], [0, 0.11]], 10, { axis: 'x' }), dim(paint, 1.1), xf(2.3, 1.66, 0.55), 'cast-armor').cyl(IRON, 0.024, 0.3, 2.52, 1.66, 0.55, 0, 0, -Math.PI / 2, 6);
  // the Notek light on the left front, a headlight on the right
  H.box(IRON, 0.18, 0.1, 0.1, 2.45, 1.46, -1.1).box(BLACK, 0.02, 0.025, 0.08, 2.545, 1.46, -1.1).cyl(IRON, 0.055, 0.1, 2.45, 1.36, 1.1, 0, 0, Math.PI / 2, 6);
  // spare links hung across the nose plate: dark track plates with gaps between and a guide horn each
  H.box(LINK_DARK, 0.03, 0.36, 1.72, 3.155, 1.17, 0);
  for (let i = 0; i < 8; i++) {
    const z = (i - 3.5) * 0.21;
    H.box(i % 2 ? LINK : dim(LINK, 0.88), 0.05, 0.32, 0.19, 3.17, 1.17, z, 0, 0, 0, 'track-steel').box(LINK_LIT, 0.04, 0.1, 0.05, 3.21, 1.17, z);
  }
  for (const z of [0.68, -0.68]) H.box(IRON, 0.12, 0.08, 0.06, 3.0, 0.72, z);
  // fenders: tool boxes and the jack block
  H.box(dim(paint, 0.9), 0.5, 0.2, 0.3, 0.9, 1.25, 1.55).box(dim(paint, 0.9), 0.4, 0.16, 0.3, -0.3, 1.23, -1.55).box(WOOD, 0.5, 0.1, 0.12, 1.5, 1.2, -1.55);
  // roof: hatches, the engine deck grilles and fan covers, exhaust stacks with guards
  for (const z of [0.62, -0.62]) H.box(dim(paint, 1.08), 0.5, 0.04, 0.45, 1.85, 1.93, z).box(IRON, 0.1, 0.07, 0.14, 2.12, 1.95, z);
  for (const [z0, z1] of [[0.95, 1.55], [-1.55, -0.95]]) grille(HF, -2.8, -1.8, z0, z1, 1.914, 7, dim(paint, 0.8));
  for (const z of [0.42, -0.42]) H.add(lathe([[0.3, 0], [0.3, 0.03], [0, 0.05]], 10), dim(paint, 1.0), xf(-2.45, 1.91, z));
  for (const z of [0.45, -0.45]) H.cyl(IRON, 0.08, 0.6, -3.14, 1.66, z, 0, 0, 0, 8).box(dim(paint, 0.85), 0.05, 0.5, 0.3, -3.22, 1.64, z);
  // the patches on the deck (not under the turret or the grilles), the front plate, the glacis and the back
  const underGrille = (p) => p[0] < -1.76 && p[0] > -2.84 && Math.abs(p[2]) > 0.91 && Math.abs(p[2]) < 1.59;
  patchGrid(HF, (s, v) => [-2.96 + 5.22 * s, 1.916, -1.68 + 3.36 * v], 13, 8, [0, 1, 0], { skip: (p) => underGrille(p) || Math.hypot(p[0] + 0.1, p[2]) < 1.1 });
  patchGrid(HF, (s, v) => [2.306, 1.4 + 0.47 * v, -0.95 + 1.9 * s], 5, 1, [1, 0, 0]);
  for (const k of [1, -1]) patchGrid(HF, (s, v) => [2.306, 1.13 + 0.74 * v, k * (0.95 + 0.73 * s)], 2, 2, [1, 0, 0]);
  patchGrid(HF, (s, v) => [2.3 + 0.55 * s, 1.397 + 0.029 * s, -0.95 + 1.9 * v], 2, 5, [-0.053, 0.999, 0]);
  patchGrid(HF, (s, v) => [-3.066, 1.13 + 0.66 * v, -1.66 + 3.32 * s], 9, 2, [-1, 0, 0]);
  H.add(HF.geometry());

  // turret: the ring at x = -0.1; horseshoe walls (straight cheeks to the front plate), flat roof
  const outline = [[1.4, 1.12]];
  for (let i = 0; i <= 36; i++) { const a = Math.PI / 2 + (i / 36) * Math.PI; outline.push([0.1 + 1.7 * Math.cos(a), 1.25 * Math.sin(a)]); }
  outline.push([1.4, -1.12]);
  // Keep the cheek edges unsplit so the flat cap has no collinear fan triangles.
  const walls = outline;
  const ringAt = [-0.1, 1.91, 0], RH = 0.85;
  const turretPlan = (k) => walls.map(([x, z]) => [0.1 + (x - 0.1) * k, z * k]);
  T.add(vloft([{ y: 0, pts: turretPlan(0.987) }, { y: 0.06, pts: walls }, { y: RH - 0.03, pts: walls }, { y: RH, pts: turretPlan(0.994) }], { normals: 48 }), paint);
  // the patches on the walls: each wall segment cut into bands, patched like the hull
  const mid = [0.1, 0];
  walls.forEach((a, i) => {
    const b = walls[(i + 1) % walls.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    let nx = dz / l, nz = -dx / l;
    if (nx * ((a[0] + b[0]) / 2 - mid[0]) + nz * ((a[1] + b[1]) / 2 - mid[1]) < 0) { nx = -nx; nz = -nz; }
    patchGrid(TF, (s, v) => [a[0] + dx * s, RH * v, a[1] + dz * s], 1, 3, [nx, 0, nz], { to: ringAt });
  });
  // a dark line where the walls meet the deck; the roof patches
  const about = (k, pts = walls) => pts.map(([x, z]) => [0.1 + (x - 0.1) * k, z * k]);
  T.add(vloft([{ y: 0, pts: about(1.006, outline) }, { y: 0.07, pts: about(1.006, outline) }], { caps: false, normals: 30 }), dim(paint, 0.42));
  const rings = [1, 0.7, 0.46, 0.22].map((k) => about(k)), Y = RH + 0.004, P3 = ([x, z]) => [x, Y, z];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < walls.length; i++) {
      const j = (i + 1) % walls.length;
      patches(TF, [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]].map(P3), [0, 1, 0], { to: ringAt });
    }
  }
  const last = rings[rings.length - 1];
  for (let i = 0; i < walls.length; i++) patches(TF, [last[i], last[(i + 1) % walls.length], [0.1, 0]].map(P3), [0, 1, 0], { to: ringAt });
  // the broad mantlet and gun collar, patched like the walls; the stowage bin on the back
  const patched = (geo, x, y, z, k = 1) => paintBy(geo, (p) => { const c = col(paint); const [g, b] = PATCHES.map(([fn]) => fn([p.x + x + ringAt[0], p.y + y + ringAt[1], p.z + z])); return dim(b > 0 ? BROWN : g > 0 ? GREEN : c, k); });
  T.add(patched(loft([{ x: -0.16, w: 1.7, h: 0.67, p: 4.5 }, { x: -0.1, w: 1.84, h: 0.75, p: 3.8 }, { x: 0.07, w: 1.85, h: 0.74, p: 3.6 }, { x: 0.16, w: 1.72, h: 0.65, p: 3.2 }], { segments: 36, normals: 56 }), 1.56, 0.42, 0, 0.97), 0xffffff, xf(1.56, 0.42, 0), 'cast-armor').cyl(dim(paint, 0.95), 0.17, 0.3, 1.86, 0.42, 0, 0, 0, -Math.PI / 2, 12, 'cast-armor');
  T.box(BLACK, 0.02, 0.06, 0.06, 1.725, 0.58, -0.38).box(BLACK, 0.02, 0.06, 0.06, 1.725, 0.58, -0.52).box(BLACK, 0.02, 0.05, 0.05, 1.725, 0.42, 0.45);
  // The 88: a long tube tapering to the muzzle and the double-baffle brake, two rounded baffles with a dark slot
  // between them and the dark bore.
  const gL = 3.4, gr = 0.125, gm = gr * 0.82, br = 0.175, b0 = gL - 0.42, bore = 0.062, waist = gm * 1.15;
  const prof = [[0, 0], [gr * 1.12, 0], [gr * 1.12, 0.08], [gr, 0.12], [gm, b0 - 0.03], [gm * 1.2, b0], [br * 0.82, b0 + 0.015], [br, b0 + 0.05], [br, b0 + 0.14], [br * 0.88, b0 + 0.175],
    [waist, b0 + 0.185], [waist, b0 + 0.235], [br * 0.88, b0 + 0.245], [br, b0 + 0.28], [br, gL - 0.04], [br * 0.82, gL - 0.005], [bore, gL], [bore, gL - 0.14], [0, gL - 0.14]];
  const slot = (p) => { const r = Math.hypot(p.y, p.z); return (r < waist + 1e-3 && p.x > b0 + 0.18 && p.x < b0 + 0.24) || (r < bore + 1e-3 && p.x > gL - 0.145); };
  T.add(tag(paintBy(lathe(prof, 24, { axis: 'x' }), (p) => (slot(p) ? col(BLACK) : dim(paint, 0.8))), 'gunmetal'), 0xffffff, xf(1.9, 0.42, 0));
  T.add(patched(chamferBox(0.5, 0.42, 1.2, 0.04), -1.66, 0.44, 0, 0.95), 0xffffff, xf(-1.66, 0.44, 0));
  // roof: cupola at the left rear with its vision slits, loader's hatch, ventilator
  const cup = paintBy(lathe([[0.36, 0], [0.36, 0.09], [0.33, 0.1], [0.33, 0.17], [0.36, 0.18], [0.3, 0.25], [0, 0.26]], 12), (p) => (Math.abs(Math.hypot(p.x, p.z) - 0.33) < 0.005 ? col(BLACK) : col(paint)));
  T.add(cup, 0xffffff, xf(-0.75, RH, -0.75)).box(dim(paint, 1.08), 0.55, 0.04, 0.5, -0.3, 0.87, 0.55).cyl(IRON, 0.08, 0.08, 0.7, 0.89, 0.35, 0, 0, 0, 8);
  for (let i = 0; i < 6; i++) { const a = i * 1.0472 + 0.3; T.box(BLACK, 0.025, 0.04, 0.07, -0.75 + 0.355 * Math.cos(a), RH + 0.14, -0.75 + 0.355 * Math.sin(a), 0, -a, 0); }
  // sides: the number in the owner's color on the cheeks, spare track links on the curve
  for (const s of [1, -1]) {
    T.add(number('131', 0.42, f.color, BLACK), 0xffffff, place([0.68, 0.46, s * 1.2], [0.0995, 0, s * 0.995], [0, 1, 0], 1), 'plain');
    [-0.2, -0.44, -0.68].forEach((x, k) => {
      const z = 1.25 * Math.sqrt(1 - ((x - 0.1) / 1.7) ** 2), nx = (x - 0.1) / 1.7 ** 2, nz = z / 1.25 ** 2, l = Math.hypot(nx, nz);
      const ry = Math.atan2(nx / l, (s * nz) / l);
      T.box(k % 2 ? LINK : dim(LINK, 0.88), 0.2, 0.56, 0.05, x + (nx / l) * 0.03, 0.44, s * (z + (nz / l) * 0.03), 0, ry, 0, 'track-steel');
      T.box(LINK_LIT, 0.05, 0.12, 0.04, x + (nx / l) * 0.07, 0.44, s * (z + (nz / l) * 0.07), 0, ry, 0);
    });
  }
  // Hatch latches and bin clasps read separately from the welded roof and storage box.
  T.box(IRON, 0.14, 0.025, 0.03, -0.75, RH + 0.265, -0.75).box(IRON, 0.14, 0.025, 0.03, -0.3, 0.897, 0.55);
  for (const z of [-0.38, 0.38]) T.box(IRON, 0.03, 0.13, 0.08, -1.92, 0.44, z);
  T.add(TF.geometry());
  return { hull: H, turret: T, ring: [-0.1, 1.91, 0], tip: [1.9 + gL, 0.42, 0], s: 0.94, height: 1.3 };
}

// ---------------------------------------------------------------- ZSU-37

// SU-76M-style chassis: a boxy front with a short glacis and the driver's hatch, five road wheels, a spoked idler
// and three return rollers. The open armored casemate at the back, pointed in front and as wide as the tracks, with
// walls that lean in and drop toward the front, holds the 37 mm 61-K in its cradle on a pedestal behind a split
// shield (each half a front plate and a wing bent back), raised for air targets. Red star and the owner's number on
// the casemate, the owner's color along the top of its rear wall.
function zsu37(f) {
  const paint = REPAINT.get(f.vehicle) ?? f.vehicle, H = kit(), T = kit(), G = kit(), HF = flat();
  const tz = 1.22, t = 0.12, R = 0.33, wy = t + R, wheels = [1.78, 1.02, 0.27, -0.48, -1.23];
  const sp = [2.41, 0.56, 0.27], id = [-2.24, 0.52, 0.26], rollers = [[1.37, 0.765], [-0.09, 0.765], [-1.51, 0.765]];
  const road = roadWheel(R, 0.19, paint, { seg: 10, rim: 0.8, hub: 0.32 }), rol = roller(0.075, 0.12, paint);
  for (const x of wheels) G.add(road, 0xffffff, xf(x, wy, tz));
  G.add(roadWheel(id[2], 0.17, dim(paint, 1.08), { seg: 12, spokes: 6, rim: 0.8, rubber: false }), 0xffffff, xf(id[0], id[1], tz));
  G.add(sprocketWheel(sp[2], 0.2, 10, paint), 0xffffff, xf(sp[0], sp[1], tz));
  for (const [x, y] of rollers) G.add(rol, 0xffffff, xf(x, y, tz - 0.03));
  G.add(trackBelt([[sp[0], sp[1], 0.24], ...wheels.map((x) => [x, wy, R]), [id[0], id[1], id[2]], ...rollers.map(([x, y]) => [x, y, 0.075])], tz, 0.3, { thick: t, pitch: 0.2 }));
  G.box(paint, 4.7, 0.03, 0.44, -0.12, 0.95, 1.16).box(paint, 0.4, 0.03, 0.44, 2.4, 0.9, 1.16, 0, 0, -0.35);
  H.add(mirrorZ(G.geometry()));

  // hull: a tall boxy front with a long glacis over the nose plate; the deck runs back under the casemate. The top
  // edges are chamfered so they catch the light.
  H.add(loft([deck(-2.62, 0.55, 1.5, 0.95), deck(-2.45, 0.42, 1.58, 0.95), deck(1.9, 0.42, 1.58, 0.95), deck(2.45, 0.42, 1.243, 0.95, 0.03), deck(2.52, 0.538, 1.2, 0.95, 0.03), deck(2.64, 0.74, 1.14, 0.95, 0.03)], FLAT), paint);
  const ga = -Math.atan2(0.38, 0.62), gn = [0.523, 0.853, 0], on = (u, z, lift) => [1.9 + 0.62 * u + gn[0] * lift, 1.58 - 0.38 * u + gn[1] * lift, z];
  // glacis: the driver's hatch and periscope (left), the big transmission hatch (right), a headlight; tow hooks; the
  // owner's panel on the front deck
  H.box(dim(paint, 1.06), 0.34, 0.05, 0.42, ...on(0.45, -0.32, 0.025), 0, 0, ga).box(IRON, 0.07, 0.06, 0.14, ...on(0.12, -0.32, 0.06), 0, 0, ga);
  H.box(dim(paint, 1.04), 0.4, 0.04, 0.5, ...on(0.5, 0.3, 0.02), 0, 0, ga).box(IRON, 0.06, 0.03, 0.12, ...on(0.25, 0.3, 0.045), 0, 0, ga);
  headlight(H, HF, 2.3, 1.42, 0.72, 0.08);
  for (const z of [0.42, -0.42]) H.box(IRON, 0.08, 0.14, 0.06, 2.66, 0.86, z);
  H.box(dim(paint, 1.06), 0.5, 0.04, 0.6, 1.45, 1.6, -0.4).box(dim(paint, 1.06), 0.4, 0.04, 0.4, 1.5, 1.6, 0.45);
  roofPanel(HF, 0.95, 1.15, -0.5, 0.55, 1.585, dim(f.color, 0.86));
  // fenders: a toolbox at the front left, the muffler at the rear left, a rolled tarpaulin on the right
  H.box(paint, 0.6, 0.24, 0.3, 1.45, 1.08, -1.16).cyl(IRON, 0.12, 0.7, -1.95, 1.08, -1.16, 0, 0, Math.PI / 2, 8).cyl(IRON, 0.125, 0.04, -1.75, 1.08, -1.16, 0, 0, Math.PI / 2, 8);
  H.cyl(CANVAS, 0.1, 1.2, 1.2, 1.1, 1.16, 0, 0, Math.PI / 2, 10).box(WOOD, 1.0, 0.04, 0.05, 0.4, 1.0, 1.28);
  // rear deck grilles behind the casemate
  grille(HF, -2.42, -1.9, 0.12, 0.85, 1.584, 5, dim(paint, 0.82));
  grille(HF, -2.42, -1.9, -0.85, -0.12, 1.584, 5, dim(paint, 0.82));
  // The open casemate down to the fenders, pointed in front: a low plate round the gun, taller diagonal and side walls
  // rising toward the back. Each wall shows its outside, leaning in, its darker inside and a top edge.
  const ring = [[0.89, 0.72], [0.4, 1.25], [-1.8, 1.25], [-1.8, -1.25], [0.4, -1.25], [0.89, -0.72]], Y0 = 1.0, FLOOR = 1.585, LEAN = 0.16, WALL = 0.05;
  const hv = [1.8, 2.04, 2.28, 2.28, 2.04, 1.8]; // the wall top at each corner
  const outward = ring.map((a, i) => {
    const b = ring[(i + 1) % 6], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [(b[1] - a[1]) / l, (a[0] - b[0]) / l];
    return n[0] * ((a[0] + b[0]) / 2 + 0.45) + n[1] * ((a[1] + b[1]) / 2) < 0 ? [-n[0], -n[1]] : n;
  });
  // corner i pulled in by d, along the bisector of its two walls
  const pull = (i, d) => { const p = outward[(i + 5) % 6], q = outward[i], k = d / (1 + p[0] * q[0] + p[1] * q[1]); return [ring[i][0] - (p[0] + q[0]) * k, ring[i][1] - (p[1] + q[1]) * k]; };
  const out = (i, h) => pull(i, LEAN * (h - Y0)), inn = (i, h) => pull(i, WALL + LEAN * (h - Y0));
  ring.forEach((a, i) => {
    const j = (i + 1) % 6, n = outward[i], N = [n[0], 0, n[1]], ti = hv[i], tj = hv[j];
    const oi = out(i, ti), oj = out(j, tj), ii = inn(i, ti), ij = inn(j, tj), fi = inn(i, FLOOR), fj = inn(j, FLOOR);
    // outside: from the fender up, tilted back by the lean (its normal tips up)
    const tilt = Math.atan(LEAN), nT = [N[0] * Math.cos(tilt), Math.sin(tilt), N[2] * Math.cos(tilt)];
    HF.poly([[a[0], Y0, a[1]], [ring[j][0], Y0, ring[j][1]], [oj[0], tj, oj[1]], [oi[0], ti, oi[1]]], nT, paint);
    // inside, darker, down to the floor
    HF.poly([[fi[0], FLOOR, fi[1]], [fj[0], FLOOR, fj[1]], [ij[0], tj, ij[1]], [ii[0], ti, ii[1]]], [-nT[0], -nT[1], -nT[2]], dim(paint, 0.9));
    // the top edge; the rear wall's carries the owner's color
    HF.poly([[oi[0], ti, oi[1]], [oj[0], tj, oj[1]], [ij[0], tj, ij[1]], [ii[0], ti, ii[1]]], [0, 1, 0], i === 2 ? f.color : dim(paint, 1.12), i === 2 ? 'plain' : undefined);
  });
  { const a = out(2, 2.28 - 0.04), b = out(3, 2.28 - 0.04), c = out(2, 2.28 - 0.16), d = out(3, 2.28 - 0.16); HF.poly([[a[0] - 0.004, 2.24, a[1]], [b[0] - 0.004, 2.24, b[1]], [d[0] - 0.004, 2.12, d[1]], [c[0] - 0.004, 2.12, c[1]]], [-1, 0, 0], f.color, 'plain'); }
  HF.poly(ring.map((v, i) => inn(i, FLOOR)).map(([x, z]) => [x, FLOOR, z]), [0, 1, 0], dim(paint, 0.78));
  // ammunition: clip racks against the back wall, ready boxes by the gun
  for (const s of [1, -1]) {
    H.box(dim(paint, 0.72), 0.55, 0.3, 0.34, -1.25, FLOOR + 0.15, s * 0.95).box(dim(paint, 0.85), 0.24, 0.22, 0.3, -0.35, FLOOR + 0.11, s * 1.0);
    for (let k = 0; k < 2; k++) H.box(k % 2 ? BRASS : dim(BRASS, 0.85), 0.08, 0.05, 0.28, -1.42 + k * 0.12, FLOOR + 0.32, s * 0.95, 0, 0, 0, 'gunmetal');
  }
  // the star and the number on the casemate sides (the wall leans in: its normal tips up)
  const tl = Math.atan(LEAN);
  for (const s of [1, -1]) {
    const zAt = (y) => 1.25 - LEAN * (y - Y0) + 0.006, nrm = [0, Math.sin(tl), s * Math.cos(tl)], up = [0, Math.cos(tl), -s * Math.sin(tl)];
    H.add(star(1, { color: RED, border: WHITE, edge: 0.12 }), 0xffffff, place([-0.2, 1.74, s * zAt(1.74)], nrm, up, 0.26), 'plain');
    H.add(number('27', 0.3, f.color), 0xffffff, place([-1.05, 1.74, s * zAt(1.74)], nrm, up, 1), 'plain');
  }
  // the crew door in the back wall
  H.box(dim(paint, 0.9), 0.03, 0.66, 0.72, -1.815, 1.86, 0.3).box(IRON, 0.03, 0.05, 0.14, -1.835, 1.9, 0.02);
  H.add(HF.geometry());

  // gun mount: the pivot is the pedestal on the casemate floor at x = 0.15; the cradle's side plates carry the
  // trunnion at (0, 0.75), the gun raised by e about it
  const e = 0.33, ce = Math.cos(e), se = Math.sin(e), along = (d, up = 0) => [ce * d - se * up, 0.75 + se * d + ce * up];
  T.cyl(dim(paint, 0.75), 0.24, 0.42, 0, 0.21, 0, 0, 0, 0, 8).box(paint, 0.8, 0.1, 0.8, 0, 0.46, 0);
  for (const z of [0.24, -0.24]) T.box(dim(paint, 1.0), 0.62, 0.52, 0.06, 0, 0.72, z).box(dim(paint, 1.12), 0.62, 0.02, 0.06, 0, 0.99, z);
  T.cyl(IRON, 0.07, 0.56, 0, 0.75, 0, Math.PI / 2, 0, 0, 8);
  // the cradle with its recoil sleeve and the bulky breech
  T.box(dim(paint, 0.85), 1.3, 0.28, 0.3, ...along(0.05), 0, 0, 0, e, 'gunmetal').box(IRON, 0.62, 0.26, 0.26, ...along(-0.72), 0, 0, 0, e).cyl(IRON, 0.095, 0.7, ...along(0.78), 0, 0, e - Math.PI / 2, 8);
  T.box(BRASS, 0.32, 0.14, 0.1, ...along(-0.55, 0.19), 0, 0, 0, e).box(dim(BRASS, 0.8), 0.32, 0.04, 0.1, ...along(-0.55, 0.28), 0, 0, 0, e);
  // breech block, sliding recoil rail and spent-case tray, visible from above the casemate
  T.box(IRON, 0.32, 0.36, 0.38, ...along(-1.02), 0, 0, 0, e);
  T.box(dim(paint, 1.06), 0.8, 0.06, 0.42, ...along(-0.58, -0.18), 0, 0, 0, e);
  T.box(IRON, 0.48, 0.06, 0.46, ...along(-1.05, -0.3), 0, 0, 0, e);
  // the barrel and its slotted flash hider: a thin tube 0.42 long ringed by dark slots, open at the front
  const gL = 2.3, hL = 0.42, hr = 0.055 * 1.25;
  T.add(gunTube(gL - hL, 0.055, GUN, { lip: 0.03, lipR: 1.1 }), 0xffffff, xf(...along(0.5), 0, 0, 0, e));
  const slots = [[0, 0.05], [0.05, 0.1], [0.1, 0.17], [0.17, 0.22], [0.22, 0.29], [0.29, 0.34], [0.34, hL]].map(([a, b], k) => [[hr, a], [hr, b], k % 2 ? BLACK : IRON, null, null, 'gunmetal']);
  const hider = bands([...slots, [[hr, hL], [hr * 0.6, hL], IRON, null, null, 'gunmetal'], [[hr * 0.6, hL], [hr * 0.6, hL - 0.1], BLACK, null, null, 'gunmetal'], [[hr * 0.6, hL - 0.1], [0, hL - 0.1], BLACK, null, null, 'gunmetal']], 6).rotateY(Math.PI / 2);
  T.add(hider, 0xffffff, xf(...along(0.5 + gL - hL), 0, 0, 0, e));
  for (const up of [0.13, -0.11]) T.cyl(dim(paint, 0.8), 0.045, 0.9, ...along(0.85, up), 0, 0, 0, e - Math.PI / 2, 6);
  // The split shield, each half a front plate either side of the gun and a wing bent back from its outer edge, kept
  // low so the gun and its crew show over it; a sight, the hand wheels and seats.
  const sh = 0.12, wa = 0.82, wl = 0.46, wx = 0.6 - (wl / 2) * Math.sin(wa), wz = 0.72 + (wl / 2) * Math.cos(wa), lean = 0.35 * Math.sin(sh);
  for (const s of [1, -1]) {
    T.box(paint, 0.05, 0.58, 0.6, 0.6, 0.76, s * 0.42, 0, 0, sh).box(dim(paint, 1.12), 0.06, 0.03, 0.6, 0.6 - 0.29 * Math.sin(sh), 1.05, s * 0.42, 0, 0, sh);
    T.box(dim(paint, 0.94), 0.05, 0.48, wl, wx, 0.71, s * wz, 0, -s * wa, sh).box(dim(paint, 1.12), 0.06, 0.03, wl, wx - lean * Math.cos(wa), 0.95, s * (wz - lean * Math.sin(wa)), 0, -s * wa, sh);
  }
  T.box(IRON, 0.2, 0.08, 0.06, ...along(0.0, 0.18), -0.22, 0, 0, e).cyl(IRON, 0.1, 0.03, -0.15, 0.62, -0.32, Math.PI / 2, 0, 0, 8).cyl(IRON, 0.08, 0.03, -0.25, 0.55, 0.32, Math.PI / 2, 0, 0, 8);
  T.box(dim(paint, 0.7), 0.22, 0.05, 0.2, -0.45, 0.5, 0.45).box(dim(paint, 0.7), 0.22, 0.05, 0.2, -0.45, 0.5, -0.45);
  const tip = along(0.5 + gL);
  return { hull: H, turret: T, ring: [0.15, 1.585, 0], tip: [tip[0], tip[1], 0], s: 0.92 };
}

// ---------------------------------------------------------------- the unit-model hook

// Soft ambient occlusion in the vertex colors: a little darker toward the ground and on faces that look down (the
// running gear sits in the hull's shadow), full paint elsewhere. The texture and the sun do the rest, so nothing is
// painted lighter on the edges. lift is the height of the geometry's origin above the ground.
const shade = (geo, lift, height) => ao(geo, {
  falloff: (p, n) => (0.84 + 0.16 * smooth((p.y + lift) / height)) * (1 - 0.2 * Math.max(0, -n.y)),
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
      hull: scaleWheelPivots(shade(m.hull.geometry(), 0, height).scale(s, s, s), s),
      turret: shade(m.turret.geometry(), m.ring[1], height).scale(s, s, s),
      ring: m.ring.map((v) => v * s), tip: m.tip.map((v) => v * s),
    };
    cache.set(key, out);
  }
  return out;
}
