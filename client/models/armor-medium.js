// Medium tanks as painted miniatures: the M4 Sherman (USA), the Panzer IV Ausf. H (Germany) and the T-34/76 of 1943
// (USSR), plus the two conversions on those chassis, the T34 Calliope rocket Sherman and the Wirbelwind flak Panzer IV.
//
// Each model is two vertex-colored geometries: the hull with its running gear, and the turret. client/unit-models.js
// bakes each into one mesh of its shared PAINT material, like the other tanks, so a medium tank stays two draw calls.
// The turret geometry sits around its turret ring: v.turret is placed on the ring and turns there, and v.fxTip is
// the muzzle in turret space. Sizes run about 0.9 of the real tanks. The lower hull and running gear are darker
// (geom.ao), faces turned up a little lighter, like a dry-brushed miniature; the owner's color is a turret band.
// Axes as in the other unit models: +x forward, +y up, +z the tank's right side.
import * as THREE from 'three';
import * as G from './geom.js';

const TAU = Math.PI * 2;
const RUBBER = 0x2b2a27, STEEL = 0x45443e, DARK = 0x1f1e1b, WOOD = 0x7a5a38, RUST = 0x5e4430, WHITE = 0xe4dfcf;
// track links, alternately lighter, and their edges dry-brushed like worn steel
const TRACK = [0x4e4a44, 0x45413c], TRACK_EDGE = [0x6e685e, 0x635d54];
const tone = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const smooth = (t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- small builders

// Indexed triangles with a normal and a color per vertex. tri() turns each triangle to face along its vertex
// normals, so callers only list corners; degenerate triangles are skipped.
function mesh() {
  const pos = [], nor = [], col = [], idx = [], c = new THREE.Color();
  const m = {
    v(x, y, z, nx, ny, nz, color) { pos.push(x, y, z); nor.push(nx, ny, nz); c.set(color); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; },
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
      g.setIndex(idx);
      return g;
    },
  };
  return m;
}

// A solid of revolution around +z, S segments around: the profile [[r, z], ...] walks with the solid on its left
// (out from the axis at the back, along the rim, in over the front face), so a wheel's face looks toward +z.
// color: one color, one per band, or (band, segment) => color for painted patterns (spoke holes, vision blocks).
// flat: faceted sides (the Wirbelwind's nine-sided tub) instead of round shading.
function spin(profile, color, S = 10, { flat = false, a0 = 0 } = {}) {
  const m = mesh();
  for (let b = 0; b + 1 < profile.length; b++) {
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

// plain boxes are 12 triangles; chamfered ones (c > 0) 44, kept for the parts that catch the light
const boxes = new Map();
function BOX(w, h, d, c = 0) {
  const k = `${w}|${h}|${d}|${c}`;
  let g = boxes.get(k);
  if (!g) { g = c > 0 ? G.chamferBox(w, h, d, c) : new THREE.BoxGeometry(w, h, d); g.deleteAttribute?.('uv'); boxes.set(k, g); }
  return g;
}
const box = (w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, c = 0) => ({ geo: BOX(w, h, d, c), color, matrix: G.xf(x, y, z, rx, ry, rz) });
const at = (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => ({ geo, color, matrix: G.xf(x, y, z, rx, ry, rz) });

// A road wheel or idler with its face toward +z: tread and tire chamfer in rubber, the face (dished with `dish`), a
// hub. holes paints that many dark openings into the face (spoked wheels); rubber 0 makes an all-steel wheel.
function wheel(R, w, paint, { rubber = 0.16, holes = 0, S = 10, hub = 0.26, dish = false } = {}) {
  const tire = rubber > 0 ? RUBBER : tone(paint, 0.85), dark = tone(paint, 0.28), rim = tone(paint, 1.25), face = tone(paint, 1.12);
  const prof = [[R, -w / 2], [R, w * 0.3], [R * (1 - Math.max(rubber, 0.1)), w / 2], ...(dish ? [[R * 0.42, w * 0.36]] : []), [R * hub, w * 0.62], [0, w * 0.64]];
  return spin(prof, (b, s) => (b < 2 ? (b === 1 ? (rubber > 0 ? tire : rim) : tire) : b === 2 && holes && s % (S / holes) >= S / holes / 2 ? dark : b === 2 ? face : rim), S);
}
// a small return roller facing +z
const roller = (r, w, paint) => spin([[r, -w / 2], [r, w / 2], [r * 0.45, w / 2 + 0.02], [0, w / 2 + 0.02]], [RUBBER, paint, tone(paint, 0.7)], 7);

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

// The track around that line at z: links about `pitch` long, alternately lighter and darker, with a grouser ridge on
// every other joint. Only the faces that show are built: the outside and the outer edge (inner too with both). The
// outer edge reaches `inset` inside the line, the end connectors that hide the bottom of the wheel rims.
function trackBelt(line, z, width, thick, pitch, { both = false, inset = 0.035 } = {}) {
  const len = [0];
  for (let i = 1; i <= line.length; i++) { const a = line[i - 1], b = line[i % line.length]; len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = len[line.length], n = Math.round(total / pitch / 2) * 2, step = total / n, rings = [];
  for (let k = 0, i = 0; k < n; k++) {
    const s = k * step;
    while (len[i + 1] < s) i++;
    const a = line[i], b = line[(i + 1) % line.length], t = (s - len[i]) / Math.max(1e-9, len[i + 1] - len[i]);
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty), nx = ty / tl, ny = -tx / tl, h = k % 2 ? thick * 0.62 : thick;
    const x = a[0] + tx * t, y = a[1] + ty * t;
    rings.push({ ix: x - nx * inset, iy: y - ny * inset, ox: x + nx * h, oy: y + ny * h, nx, ny });
  }
  const m = mesh(), zo = z + width / 2, zi = z - width / 2;
  for (let k = 0; k < n; k++) {
    const p = rings[k], q = rings[(k + 1) % n], c = TRACK[k % 2], nx = (p.nx + q.nx) / 2, ny = (p.ny + q.ny) / 2;
    m.face([[p.ox, p.oy, zi], [q.ox, q.oy, zi], [q.ox, q.oy, zo], [p.ox, p.oy, zo]], [nx, ny, 0], c);
    m.face([[p.ix, p.iy, zo], [q.ix, q.iy, zo], [q.ox, q.oy, zo], [p.ox, p.oy, zo]], [0, 0, 1], k % 2 ? TRACK_EDGE[1] : TRACK_EDGE[0]);
    if (both) m.face([[p.ix, p.iy, zi], [q.ix, q.iy, zi], [q.ox, q.oy, zi], [p.ox, p.oy, zi]], [0, 0, -1], tone(c, 0.8));
  }
  // without the link-by-link inner edge, close it with one coarse strip along the line's own points, so the belt
  // does not look hollow (and toothed) where its ends show past the hull from the far side
  if (!both) {
    const L = line.length, dark = tone(TRACK[1], 0.8), ids = [];
    for (let i = 0; i < L; i++) {
      const a = line[(i + L - 1) % L], p = line[i], b = line[(i + 1) % L];
      let nx = (p[1] - a[1]) / Math.hypot(p[0] - a[0], p[1] - a[1]) + (b[1] - p[1]) / Math.hypot(b[0] - p[0], b[1] - p[1]);
      let ny = -(p[0] - a[0]) / Math.hypot(p[0] - a[0], p[1] - a[1]) - (b[0] - p[0]) / Math.hypot(b[0] - p[0], b[1] - p[1]);
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      ids.push([m.v(p[0] - nx * inset, p[1] - ny * inset, zi, 0, 0, -1, dark), m.v(p[0] + nx * thick * 0.8, p[1] + ny * thick * 0.8, zi, 0, 0, -1, dark)]);
    }
    for (let i = 0; i < L; i++) { const [a, b] = ids[i], [d, e] = ids[(i + 1) % L]; m.quad(a, d, e, b); }
  }
  return m.geo();
}

// A turret body lofted upward through horizontal slices: {h, x, l, w, p} superellipses (l long in x, w wide in z,
// centered on x) or {h, pts: [[x, z], ...]} plan polygons, all with their points in the same order.
function tower(slices, opts = {}) {
  const secs = slices.map((s) => (s.pts ? { x: s.h, pts: s.pts.map(([x, z]) => [z, -x]) } : { x: s.h, w: s.w, h: s.l, y: -(s.x ?? 0), z: s.z ?? 0, p: s.p ?? 2.4 }));
  return G.loft(secs, { segments: 18, normals: 32, ...opts }).rotateZ(Math.PI / 2);
}
// the slice of a superellipse tower at height h, grown by k (for bands painted around it)
function sliceAt(slices, h, k = 1) {
  let i = 0;
  while (i + 2 < slices.length && slices[i + 1].h < h) i++;
  const a = slices[i], b = slices[i + 1], t = (h - a.h) / (b.h - a.h), mix = (p, q) => p + (q - p) * t;
  if (a.pts) return { h, pts: a.pts.map((p, j) => { const q = b.pts[j]; return [mix(p[0], q[0]) * k, mix(p[1], q[1]) * k]; }) };
  return { h, x: mix(a.x, b.x), l: mix(a.l, b.l) * k, w: mix(a.w, b.w) * k, p: a.p ?? 2.4 };
}
const band = (slices, h0, h1, k = 1.02) => tower([sliceAt(slices, h0, k), sliceAt(slices, h1, k)], { caps: false });

// A gun barrel along +x from x = 0: [r, x] stations from the breech to the muzzle, bored at the end.
function gun(stations, color, S = 8) {
  const L = stations[stations.length - 1][1], r = stations[stations.length - 1][0];
  return { geo: alongX(spin([[0, 0], ...stations, [r * 0.45, L], [0, L - 0.04]], color, S)), color: 0xffffff };
}

// Paint the merged parts like a miniature: darker toward the ground and under overhangs, faces turned up a little
// lighter, sloped edges between top and side lighter still.
function finish(items, { floor = 0, height = 1.1, dark = 0.68 } = {}) {
  return G.ao(G.merge(items), {
    falloff: (p, n) => (dark + (1 - dark) * smooth((p.y - floor) / height)) * (1 - 0.32 * Math.max(0, -n.y)) * (1 + 0.16 * Math.max(0, n.y) + (n.y > 0.3 && n.y < 0.92 ? 0.06 : 0)),
  });
}
// the running gear of one side, built at +z and mirrored to the other
const bothSides = (items) => G.mirrorZ(G.merge(items));

// a marking laid on a surface (geom.place), lifted a hair off it
const mark = (geo, x, y, z, normal, scale = 1, up = [0, 1, 0]) => ({ geo, matrix: G.place([x + normal[0] * 0.012, y + normal[1] * 0.012, z + normal[2] * 0.012], normal, up, scale) });

// ---------------------------------------------------------------- M4 Sherman (and the Calliope on it)

const SHERMAN = { ring: [0.15, 1.66, 0] };
function shermanHull(paint) {
  const P = paint, lite = tone(P, 1.1), items = [];
  // upper hull, its sponsons over the inner half of the tracks: 56 degree glacis, flat deck, sloped rear deck
  items.push(at(G.extrudeProfile([[2.6, 1.0], [1.55, 1.66], [-2.25, 1.66], [-2.62, 1.5], [-2.62, 1.0]], 2.4, 0.05, { segments: 1 }), P));
  // lower hull between the tracks with the rounded transmission cover at the nose
  items.push(at(G.extrudeProfile([[2.2, 0.42], [2.52, 0.5], [2.7, 0.68], [2.74, 0.86], [2.64, 1.03], [-2.55, 1.03], [-2.62, 0.74], [-2.42, 0.42]], 1.84, 0.05, { segments: 1 }), P));
  // bolting flanges on the cover, tow hooks
  for (const z of [-0.45, 0.45]) items.push(box(0.05, 0.42, 0.05, lite, 2.72, 0.78, z, 0, 0, -0.25), box(0.1, 0.1, 0.06, STEEL, 2.6, 0.5, z * 1.5));
  // glacis: point at t along it, its normal, plate angle
  const gl = (t) => [2.6 - 1.05 * t, 1.0 + 0.66 * t], gn = [0.532, 0.847, 0], ga = -0.56;
  for (const z of [-0.5, 0.5]) {
    const [x, y] = gl(0.82);
    items.push(box(0.5, 0.12, 0.52, lite, x + gn[0] * 0.05, y + gn[1] * 0.05, z, 0, 0, ga, 0.03)); // driver's hoods
    items.push(box(0.1, 0.06, 0.2, DARK, x + gn[0] * 0.12, y + gn[1] * 0.12, z, 0, 0, ga));
    items.push(box(0.5, 0.04, 0.44, lite, 1.25, 1.68, z, 0, 0, 0, 0.015)); // hatches on the roof
    items.push(box(0.08, 0.07, 0.14, DARK, 1.48, 1.72, z));
  }
  { // bow machine gun in its ball mount, co-driver's side
    const [x, y] = gl(0.42);
    items.push({ geo: upright(spin([[0.13, 0], [0.12, 0.05], [0.07, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(x, y, 0.5, 0, 0, ga) });
    items.push(box(0.36, 0.035, 0.035, DARK, x + 0.22, y + 0.08, 0.5));
  }
  // headlights with brush guards, front fenders over the sprockets
  for (const z of [-0.95, 0.95]) items.push(box(0.12, 0.12, 0.12, STEEL, 2.6, 1.1, z), box(0.04, 0.16, 0.2, P, 2.68, 1.1, z));
  for (const z of [-1.14, 1.14]) items.push(box(0.5, 0.03, 0.46, lite, 2.5, 1.08, z, 0, 0, -0.18));
  // sand shield rails along the sponsons
  for (const z of [-1.22, 1.22]) items.push(box(4.7, 0.05, 0.05, lite, -0.02, 1.02, z));
  // engine deck: two hatches, the grille, the exhaust deflector and air cleaners at the back
  for (const z of [-0.5, 0.5]) items.push(box(0.95, 0.04, 0.86, lite, -1.25, 1.68, z, 0, 0, 0, 0.015));
  items.push(box(0.36, 0.03, 2.0, DARK, -2.05, 1.67, 0));
  for (let k = 0; k < 4; k++) items.push(box(0.04, 0.03, 2.0, P, -2.2 + k * 0.1, 1.685, 0));
  items.push(box(0.05, 0.42, 2.1, P, -2.72, 1.3, 0, 0, 0, 0.35));
  for (const z of [-0.78, 0.78]) items.push(at(new THREE.CylinderGeometry(0.11, 0.11, 0.4, 8), P, -2.73, 1.2, z));
  // tools on the rear deck edges: shovel, axe, crowbar, sledge
  items.push(box(0.9, 0.04, 0.05, WOOD, -0.85, 1.69, 1.08), box(0.22, 0.03, 0.16, STEEL, -0.28, 1.69, 1.08));
  items.push(box(0.7, 0.04, 0.05, WOOD, -1.65, 1.69, 1.1), box(0.08, 0.04, 0.16, STEEL, -1.28, 1.69, 1.1));
  items.push(box(1.3, 0.035, 0.04, STEEL, -1.1, 1.69, -1.1), box(0.75, 0.04, 0.05, WOOD, -0.6, 1.69, -1.0));
  // stars: on the sponson sides and the air recognition star on the engine deck
  const side = G.star(1, { color: WHITE });
  for (const s of [-1, 1]) items.push(mark(side, 0.35, 1.33, s * 1.2, [0, 0, s], 0.24));
  items.push(mark(G.star(1, { color: WHITE, ring: WHITE, segments: 20 }), -1.25, 1.705, 0, [0, 1, 0], 0.3, [1, 0, 0]));
  // running gear: three VVSS bogies (bracket, volute spring housing, wheel arms, the return roller on top), the
  // raised front sprocket, the rear idler
  const TZ = 1.14, gear = [], wheels = [], rollers = [];
  const bracket = G.extrudeProfile([[-0.2, 0.3], [0.2, 0.3], [0.17, 0.62], [0.08, 0.72], [-0.12, 0.72], [-0.18, 0.6]], 0.16, 0.03, { segments: 1 });
  for (const bx of [1.32, 0, -1.32]) {
    for (const dx of [0.31, -0.31]) { gear.push(at(wheel(0.23, 0.3, P, { holes: 5, S: 10 }), 0xffffff, bx + dx, 0.3, TZ)); wheels.push({ x: bx + dx, y: 0.3, r: 0.23 }); }
    gear.push(at(bracket, lite, bx, 0, TZ + 0.02));
    gear.push(box(0.16, 0.2, 0.12, tone(P, 0.85), bx, 0.38, TZ + 0.1, 0, 0, 0, 0.03)); // the spring housing
    for (const dx of [0.31, -0.31]) gear.push(box(0.34, 0.08, 0.06, P, bx + dx * 0.5, 0.36, TZ + 0.16, 0, 0, dx > 0 ? -0.4 : 0.4));
    gear.push(box(0.08, 0.14, 0.08, P, bx - 0.12, 0.76, TZ));
    gear.push(at(roller(0.085, 0.18, STEEL), 0xffffff, bx - 0.12, 0.83, TZ));
    rollers.push({ x: bx - 0.12, y: 0.83, r: 0.085 });
  }
  gear.push(at(sprocket(0.31, 12, 0.32, P), 0xffffff, 2.32, 0.64, TZ));
  gear.push(at(wheel(0.25, 0.3, P, { rubber: 0, holes: 5, S: 10 }), 0xffffff, -2.42, 0.36, TZ));
  gear.push(box(0.4, 0.1, 0.08, P, -2.2, 0.48, TZ - 0.12, 0, 0, 0.4));
  const line = beltLine([{ x: -2.42, y: 0.36, r: 0.25 }, ...wheels.slice().sort((a, b) => a.x - b.x), { x: 2.32, y: 0.64, r: 0.31 }, ...rollers]);
  gear.push(at(trackBelt(line, 0, 0.42, 0.1, 0.2), 0xffffff, 0, 0, TZ));
  items.push({ geo: bothSides(gear) });
  return finish(items, { height: 1.2 });
}
const SHERMAN_BODY = [
  { h: 0, x: -0.22, l: 2.24, w: 1.62, p: 2.2 }, { h: 0.29, x: -0.24, l: 2.38, w: 1.7, p: 2.2 }, { h: 0.55, x: -0.24, l: 2.24, w: 1.58, p: 2.2 },
  { h: 0.73, x: -0.23, l: 1.84, w: 1.26, p: 2.2 }, { h: 0.82, x: -0.2, l: 1.26, w: 0.82, p: 2.2 },
];
function shermanTurret(paint, owner, { roofGun = true } = {}) {
  const P = paint, lite = tone(P, 1.1), items = [];
  items.push(at(tower(SHERMAN_BODY), P));
  items.push(at(band(SHERMAN_BODY, 0.44, 0.52), owner));
  // the rounded rotor shield, the gun shield on it, the 75 mm gun and its coaxial machine gun
  items.push(box(0.2, 0.48, 1.0, P, 0.98, 0.37, 0, 0, 0, 0, 0.09));
  items.push(box(0.2, 0.42, 0.62, lite, 1.12, 0.39, 0, 0, 0, 0, 0.07));
  items.push(at(gun([[0.09, 0], [0.065, 0.3], [0.056, 1.83], [0.068, 1.86], [0.068, 1.95]], P).geo, 0xffffff, 1.2, 0.4, 0));
  items.push(box(0.12, 0.035, 0.035, DARK, 1.27, 0.32, 0.2));
  // commander's vision cupola with the .50 cal on its pintle (not under a rocket rack), loader's hatch,
  // periscopes, aerial
  items.push({ geo: upright(spin([[0.27, 0], [0.27, 0.06], [0.25, 0.12], [0.2, 0.15], [0, 0.16]], (b) => (b === 1 ? DARK : lite), 10)), color: 0xffffff, matrix: G.xf(-0.5, 0.75, 0.3) });
  if (roofGun) {
    items.push(box(0.04, 0.34, 0.04, DARK, -0.76, 1.03, 0.3), box(0.26, 0.1, 0.09, DARK, -0.64, 1.21, 0.3), box(0.95, 0.035, 0.035, DARK, -0.07, 1.22, 0.3), box(0.12, 0.1, 0.06, 0x4a4f2c, -0.67, 1.15, 0.4));
    items.push(box(0.025, 1.3, 0.025, DARK, -0.95, 1.37, -0.5));
  }
  items.push(box(0.4, 0.04, 0.32, lite, -0.4, 0.81, -0.26, 0, 0, 0, 0.015));
  for (const z of [-0.28, 0.28]) items.push(box(0.1, 0.07, 0.13, DARK, 0.22, 0.81, z));
  // white stars on the turret sides
  const star = G.star(1, { color: WHITE });
  for (const s of [-1, 1]) items.push(mark(star, -0.3, 0.24, s * 0.845, [0, 0.05, s], 0.18));
  return items;
}
// The T34 Calliope's launcher: a block of 4.6 inch tubes over the turret, carried on side arms.
function calliopeRack(paint) {
  const P = paint, rows = 4, cols = 14, W = 2.6, pz = W / cols, py = 0.15, r = 0.085, L = 2.4, y0 = 0, outline = [];
  const X0 = 0.25, Y0 = 1.62, tilt = 0.09; // where the middle of the rack's underside sits over the turret, its elevation
  const arc = (zc, yc, a0, a1, n) => { for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; outline.push([-(zc + r * Math.cos(a)), yc + r * Math.sin(a)]); } };
  // the tube bundle's cross-section, counter-clockwise from the bottom right: the tubes' bumps up the right side,
  // along the top, down the left (as [-z, y] for the extrude). Stacked tubes overlap, so their arcs meet at a1.
  const a1 = Math.asin(Math.min(1, py / 2 / r)), top = 0.3, zr = W / 2 - pz / 2, zl = -zr, yr = (j) => y0 + py * (j + 0.5);
  for (let j = 0; j < rows - 1; j++) arc(zr, yr(j), j ? -a1 : -Math.PI / 2, a1, 2);
  arc(zr, yr(rows - 1), -a1, Math.PI - top, 4);
  for (let i = cols - 2; i >= 1; i--) arc(-W / 2 + pz * (i + 0.5), yr(rows - 1), top, Math.PI - top, 2);
  arc(zl, yr(rows - 1), top, Math.PI + a1, 4);
  for (let j = rows - 2; j >= 0; j--) arc(zl, yr(j), Math.PI - a1, j ? Math.PI + a1 : 1.5 * Math.PI, 2);
  const clean = outline.filter((p, i) => { const q = outline[(i + 1) % outline.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3; });
  const rack = [{ geo: G.extrudeProfile(clean, L, 0, { crease: 50 }).rotateY(Math.PI / 2), color: P }];
  // the tube mouths: dark hexagons on the front face; bands round the bundle, rails under it
  const m = mesh(), fx = L / 2 + 0.006;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const zc = -W / 2 + pz * (i + 0.5), yc = y0 + py * (j + 0.5);
    m.face(Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * TAU; return [fx, yc + r * 0.78 * Math.sin(a), zc + r * 0.78 * Math.cos(a)]; }), [1, 0, 0], DARK);
  }
  rack.push({ geo: m.geo() });
  for (const x of [-0.8, 0.8]) rack.push(box(0.08, 0.66, W + 0.06, tone(P, 0.85), x, 0.3, 0));
  for (const s of [-1, 1]) rack.push(box(L - 0.2, 0.08, 0.08, P, 0, -0.05, s * 0.98));
  const items = [{ geo: G.merge(rack), matrix: G.xf(X0, Y0, 0, 0, 0, tilt) }];
  // frame: posts up from the turret sides with a brace, the arm that ties the rack to the gun
  const under = (x) => Y0 + (x - X0) * Math.tan(tilt) - 0.05;
  for (const s of [-1, 1]) {
    for (const x of [-0.55, 0.6]) items.push(box(0.08, under(x) - 0.2, 0.08, P, x, (under(x) + 0.2) / 2, s * 0.98));
    items.push(box(1.66, 0.06, 0.06, P, 0.025, 0.9, s * 0.98, 0, 0, 0.806));
    for (const x of [-0.55, 0.6]) items.push(box(0.14, 0.14, 0.36, P, x, 0.24, s * 0.82));
  }
  items.push(box(0.07, under(1.5) - 0.38, 0.07, P, 1.5, (under(1.5) + 0.38) / 2, 0), box(0.12, 0.12, 0.12, P, 1.5, 0.4, 0));
  return items;
}

// ---------------------------------------------------------------- Panzer IV Ausf. H (and the Wirbelwind on it)

const PANZER = { ring: [0.3, 1.62, -0.05] };
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
  // driver's visor and the bow machine gun ball on the front plate, spare track links on the nose
  items.push(box(0.08, 0.14, 0.34, lite, 1.88, 1.42, -0.45, 0, 0, 0, 0.02), box(0.02, 0.03, 0.22, DARK, 1.93, 1.44, -0.45));
  items.push({ geo: upright(spin([[0.14, 0], [0.13, 0.05], [0.08, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(1.85, 1.38, 0.45, 0, 0, -Math.PI / 2) });
  items.push(box(0.3, 0.035, 0.035, DARK, 2.05, 1.38, 0.45));
  for (let k = 0; k < 6; k++) items.push(box(0.05, 0.13, 0.27, TRACK[k % 2], 2.7, 0.82, -0.75 + k * 0.3, 0, 0, 0, 0.012));
  items.push(box(0.4, 0.04, 0.16, P, 2.18, 1.13, -0.6, 0, 0, -0.2), box(0.4, 0.04, 0.16, P, 2.18, 1.13, 0.6, 0, 0, -0.2)); // brake hatches
  // engine deck hatches and side air intakes, the big muffler on the rear plate
  for (const z of [-0.48, 0.48]) items.push(box(0.85, 0.04, 0.62, lite, -1.3, 1.59, z, 0, 0, 0, 0.015));
  for (const s of [-1, 1]) items.push(box(0.9, 0.03, 0.3, DARK, -2.0, 1.58, s * 0.85));
  items.push({ geo: spin([[0, -0.4], [0.15, -0.4], [0.15, 0.4], [0, 0.4]], RUST, 8), color: 0xffffff, matrix: G.xf(-2.78, 0.95, -0.15) });
  items.push(box(0.05, 0.3, 0.12, RUST, -2.7, 1.25, -0.15));
  // tools and a jack on the fenders, the headlight
  items.push(box(1.2, 0.04, 0.05, WOOD, -0.6, 1.14, 1.12), box(0.2, 0.03, 0.15, STEEL, -1.25, 1.14, 1.12));
  items.push(box(1.4, 0.035, 0.04, STEEL, -0.4, 1.14, -1.08), box(0.25, 0.14, 0.14, P, 0.7, 1.19, -1.1));
  items.push({ geo: alongX(spin([[0.07, -0.08], [0.07, 0.05], [0, 0.06]], STEEL, 8)), color: 0xffffff, matrix: G.xf(1.95, 1.2, -1.02) });
  // running gear: eight small road wheels per side in leaf-sprung pairs, four return rollers, front sprocket,
  // rear idler
  const TZ = 1.1, gear = [], wheels = [];
  for (const bx of [1.4, 0.47, -0.47, -1.4]) {
    for (const dx of [0.225, -0.225]) { gear.push(at(wheel(0.21, 0.26, P, { S: 9 }), 0xffffff, bx + dx, 0.27, TZ)); wheels.push({ x: bx + dx, y: 0.27, r: 0.21 }); }
    gear.push(box(0.5, 0.16, 0.1, lite, bx, 0.36, TZ - 0.17, 0, 0, 0, 0.02));
    gear.push(box(0.44, 0.05, 0.08, STEEL, bx + 0.05, 0.5, TZ - 0.17, 0, 0, 0.12));
  }
  const rollers = [1.55, 0.6, -0.35, -1.3].map((x) => ({ x, y: 0.79, r: 0.075 }));
  for (const r of rollers) gear.push(at(roller(0.075, 0.16, P), 0xffffff, r.x, r.y, TZ));
  gear.push(at(sprocket(0.28, 12, 0.3, P), 0xffffff, 2.36, 0.6, TZ));
  gear.push(at(wheel(0.26, 0.26, P, { rubber: 0, holes: 6, S: 12, hub: 0.3 }), 0xffffff, -2.42, 0.56, TZ));
  const line = beltLine([{ x: -2.42, y: 0.56, r: 0.26 }, ...wheels.sort((a, b) => a.x - b.x), { x: 2.36, y: 0.6, r: 0.28 }, ...rollers]);
  gear.push(at(trackBelt(line, 0, 0.38, 0.085, 0.19), 0xffffff, 0, 0, TZ));
  if (skirts) {
    // Schuerzen: five plates a side hung from a rail, hiding the upper run and the rollers but not the road
    // wheels; a cross on the middle plate
    const n = 5, x0 = -2.3, len = 4.25, w = len / n, z = 1.45, y = 1.075, hh = 0.525;
    for (let k = 0; k < n; k++) {
      const x = x0 + w * k + w / 2;
      if (k === n - 1) gear.push(at(G.extrudeProfile([[-w / 2 + 0.012, -hh], [w / 2 - 0.16, -hh], [w / 2 - 0.012, -hh + 0.16], [w / 2 - 0.012, hh], [-w / 2 + 0.012, hh]], 0.025, 0), P, x, y, z));
      else gear.push(box(w - 0.024, hh * 2, 0.025, k % 2 ? P : tone(P, 1.05), x, y, z));
    }
    gear.push(box(len, 0.04, 0.05, lite, x0 + len / 2, y + hh - 0.03, z - 0.04));
    for (let k = 0; k < 4; k++) gear.push(box(0.05, 0.04, 0.3, P, x0 + 0.5 + k * 1.1, y + hh - 0.06, z - 0.18));
    gear.push(mark(G.balkenkreuz(1), x0 + w * 2.5, y, z + 0.013, [0, 0, 1], 0.22));
  } else {
    gear.push(mark(G.balkenkreuz(1), -0.9, 1.36, 1.12, [0, 0, 1], 0.17));
  }
  items.push({ geo: bothSides(gear) });
  return finish(items, { height: 1.15 });
}
const PANZER_BODY = [
  { h: 0, pts: [[0.72, 0.52], [0.38, 0.78], [-0.75, 0.78], [-0.92, 0.55], [-0.92, -0.55], [-0.75, -0.78], [0.38, -0.78], [0.72, -0.52]] },
  { h: 0.66, pts: [[0.64, 0.42], [0.3, 0.6], [-0.72, 0.6], [-0.84, 0.44], [-0.84, -0.44], [-0.72, -0.6], [0.3, -0.6], [0.64, -0.42]] },
];
// a plan outline [[x, z], ...] stood up as a wall from y0 to y1
const wall = (outline, y0, y1) => G.extrudeProfile(outline, y1 - y0, 0, { crease: 30 }).rotateX(Math.PI / 2).translate(0, (y0 + y1) / 2, 0);
// the turret skirts' U-shaped plan, t thick, open at the front
function skirtPlan(t) {
  const out = [[0.25, 0.98], [-0.95, 0.98], [-1.12, 0.8], [-1.12, -0.8], [-0.95, -0.98], [0.25, -0.98]];
  const inner = out.slice().reverse().map(([x, z]) => [x === 0.25 ? x : x + (x < -1 ? t : t * 0.4), z - Math.sign(z) * t]);
  return [...out, ...inner];
}
function panzerTurret(paint, owner) {
  const P = paint, lite = tone(P, 1.1), items = [];
  items.push(at(tower(PANZER_BODY, { normals: 'flat' }), P));
  // turret skirts on brackets, the top strip in the owner's color, crosses on the sides
  items.push(at(wall(skirtPlan(0.025), 0.1, 0.58), P), at(wall(skirtPlan(0.035), 0.58, 0.68), owner));
  for (const s of [-1, 1]) items.push(box(0.05, 0.05, 0.24, P, -0.3, 0.5, s * 0.86), box(0.05, 0.05, 0.24, P, -0.8, 0.5, s * 0.86));
  const cross = G.balkenkreuz(1);
  for (const s of [-1, 1]) items.push(mark(cross, -0.42, 0.36, s * 0.995, [0, 0, s], 0.16));
  // mantlet and the long 7.5 cm gun with its double-baffle muzzle brake
  items.push(box(0.26, 0.4, 0.62, lite, 0.78, 0.34, 0, 0, 0, 0, 0.05));
  items.push(at(gun([[0.1, 0], [0.075, 0.4], [0.056, 2.35], [0.105, 2.38], [0.105, 2.5], [0.065, 2.53], [0.065, 2.56], [0.105, 2.59], [0.105, 2.7]], P).geo, 0xffffff, 0.9, 0.34, 0));
  items.push(box(0.12, 0.04, 0.04, DARK, 0.95, 0.4, -0.2));
  // commander's cupola at the back with its vision blocks, hatches and a vent on the roof
  items.push({ geo: upright(spin([[0.27, 0], [0.27, 0.07], [0.26, 0.15], [0.23, 0.18], [0.16, 0.21], [0, 0.22]], (b) => (b === 1 ? DARK : b > 2 ? lite : P), 12)), color: 0xffffff, matrix: G.xf(-0.6, 0.64, 0) });
  items.push(box(0.36, 0.04, 0.3, lite, 0.15, 0.68, 0.28, 0, 0, 0, 0.012), box(0.1, 0.05, 0.1, STEEL, 0.25, 0.69, -0.25));
  return items;
}
// The Wirbelwind's open nine-sided turret and its four 2 cm guns, raised for aircraft. Returns the muzzle too.
function wirbelwindTurret(paint, owner) {
  const P = paint, items = [], a0 = -Math.PI / 9, inside = tone(P, 0.7);
  // tub walls 0.95 high: a short skirt flaring out to r 1.1, then leaning in to 0.9 at the rim; lighter rim,
  // darker inside and floor
  const tub = spin([[0.98, 0], [1.1, 0.32], [0.9, 0.95], [0.86, 0.95], [0.96, 0.32], [0.86, 0.1], [0, 0.1]], [P, P, tone(P, 1.15), inside, inside, tone(P, 0.45)], 9, { flat: true, a0 });
  items.push({ geo: upright(tub), color: 0xffffff });
  items.push({ geo: upright(spin([[0.98, 0.73], [0.947, 0.83]], owner, 9, { flat: true, a0 })), color: 0xffffff });
  // crosses on the two side faces (the faces around 80 and 280 degrees face the sides)
  for (const a of [(80 * Math.PI) / 180, (280 * Math.PI) / 180]) {
    const n = [Math.cos(a), 0.317, -Math.sin(a)], r = 0.965; // the flat face sits r * cos(20 deg) out at that height
    items.push(mark(G.balkenkreuz(1), r * Math.cos(a), 0.55, -r * Math.sin(a), n, 0.19));
  }
  // Flakvierling: pedestal, cradle, four barrels in two stacked pairs with their magazines, raised for aircraft.
  // The upper barrels sit a little wider than the lower ones, so all four show from the front.
  const el = 0.75, px = 0.05, py = 0.62, c = Math.cos(el), s = Math.sin(el), len = 1.85;
  items.push(at(new THREE.CylinderGeometry(0.16, 0.22, 0.5, 8), STEEL, px, 0.35, 0));
  items.push(box(0.55, 0.24, 0.3, STEEL, px, py, 0, 0, 0, el));
  for (const dz of [-0.42, 0.42]) items.push(box(0.5, 0.1, 0.05, STEEL, px - 0.05, py + 0.05, dz, 0, 0, el)); // cradle sides
  const barrel = gun([[0.045, 0], [0.032, 0.25], [0.027, len - 0.2], [0.042, len - 0.17], [0.042, len]], STEEL, 6).geo;
  for (const sz of [-1, 1]) for (const [dy, dz] of [[-0.11, 0.2], [0.11, 0.31]]) {
    const bx = px - 0.3 * c - dy * s, by = py - 0.3 * s + dy * c;
    items.push({ geo: barrel, matrix: G.xf(bx, by, sz * dz, 0, 0, el) });
    items.push(box(0.14, 0.16, 0.05, DARK, bx + 0.3 * c - 0.05 * s, by + 0.3 * s + 0.05 * c, sz * (dz + 0.06), 0, 0, el));
  }
  items.push(box(0.2, 0.06, 0.24, DARK, -0.45, 0.45, 0)); // gunner's seat
  const tip = [px - 0.3 * c - 0.11 * s + len * c, py - 0.3 * s + 0.11 * c + len * s, 0.31];
  return { items, tip };
}

// ---------------------------------------------------------------- T-34/76, 1943 hexagonal turret

const T34 = { ring: [0.75, 1.4, 0] };
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
  // fenders: a lip along the sponsons, mudguards at both ends
  for (const s of [-1, 1]) {
    items.push(box(4.9, 0.04, 0.05, lite, -0.1, 0.97, s * 1.34));
    items.push(box(0.46, 0.035, 0.5, lite, 2.62, 0.92, s * 1.1, 0, 0, -0.2), box(0.3, 0.035, 0.5, lite, -2.78, 0.96, s * 1.1, 0, 0, 0.15));
  }
  // glacis: driver's hatch with its vision blocks, the bow machine gun, tow hooks, headlight
  const gl = (t) => [2.7 - 1.08 * t, 0.8 + 0.6 * t], gn = [0.486, 0.874, 0], ga = -0.508;
  { const [x, y] = gl(0.6); items.push(box(0.58, 0.08, 0.5, lite, x + gn[0] * 0.03, y + gn[1] * 0.03, -0.42, 0, 0, ga, 0.025)); for (const z of [-0.55, -0.29]) items.push(box(0.06, 0.06, 0.1, DARK, x - 0.15 + gn[0] * 0.08, y + 0.08 + gn[1] * 0.08, z, 0, 0, ga)); }
  { const [x, y] = gl(0.42); items.push({ geo: upright(spin([[0.13, 0], [0.12, 0.05], [0.07, 0.1], [0, 0.11]], P, 8)), color: 0xffffff, matrix: G.xf(x, y, 0.45, 0, 0, ga) }, box(0.3, 0.035, 0.035, DARK, x + 0.2, y + 0.07, 0.45)); }
  for (const z of [-0.6, 0.6]) items.push(box(0.12, 0.08, 0.06, STEEL, 2.72, 0.7, z));
  items.push({ geo: alongX(spin([[0.08, -0.06], [0.08, 0.06], [0, 0.07]], STEEL, 8)), color: 0xffffff, matrix: G.xf(2.15, 1.18, -0.75) });
  // engine deck: the louvred grille, the engine hatch, round transmission hatch and exhausts at the back
  items.push(box(0.9, 0.03, 1.1, DARK, -1.25, 1.405, 0));
  for (let k = 0; k < 6; k++) items.push(box(0.06, 0.03, 1.1, P, -1.6 + k * 0.14, 1.42, 0));
  items.push(box(0.6, 0.04, 0.7, lite, -0.35, 1.415, 0, 0, 0, 0, 0.015));
  items.push({ geo: upright(spin([[0.24, 0], [0.24, 0.03], [0.2, 0.05], [0, 0.06]], lite, 10)), color: 0xffffff, matrix: G.xf(-2.45, 1.25, 0, 0, 0, 0.64) });
  for (const z of [-0.55, 0.55]) items.push({ geo: alongX(spin([[0.07, -0.12], [0.07, 0.1], [0.04, 0.1], [0, 0.06]], RUST, 7)), color: 0xffffff, matrix: G.xf(-2.62, 0.82, z, 0, 0, -0.35) }, box(0.1, 0.22, 0.2, P, -2.6, 0.82, z, 0, 0, -0.35));
  // external fuel tanks on the rear of the sloped sponsons, a toolbox and a spare link
  const sn = [0, 0.64, 0.768];
  for (const s of [-1, 1]) {
    for (const x of [-1.2, -1.95]) {
      items.push({ geo: alongX(spin([[0, -0.32], [0.16, -0.32], [0.16, 0.32], [0, 0.32]], lite, 9)), color: 0xffffff, matrix: G.xf(x, 1.19 + sn[1] * 0.17, s * (1.155 + sn[2] * 0.17)) });
      items.push(box(0.04, 0.05, 0.36, STEEL, x - 0.2, 1.36, s * 1.2, s * 0.9, 0, 0), box(0.04, 0.05, 0.36, STEEL, x + 0.2, 1.36, s * 1.2, s * 0.9, 0, 0));
    }
  }
  items.push(box(0.7, 0.2, 0.3, lite, 0.6, 1.1, 1.2, 0, 0, 0, 0.02));
  // running gear: five big Christie road wheels, no return rollers, the front idler and the rear drive wheel
  const TZ = 1.1, gear = [], bottom = [], top = [];
  for (const x of [1.74, 0.87, 0, -0.87, -1.74]) {
    gear.push(at(wheel(0.37, 0.34, P, { holes: 6, S: 12, rubber: 0.14, hub: 0.2 }), 0xffffff, x, 0.44, TZ));
    bottom.push({ x, y: 0.44, r: 0.37 }); top.unshift({ x, y: 0.44, r: 0.37, top: true });
  }
  top.reverse();
  gear.push(at(wheel(0.3, 0.3, P, { rubber: 0.12, holes: 6, S: 12 }), 0xffffff, 2.42, 0.5, TZ));
  gear.push(at(wheel(0.32, 0.3, P, { rubber: 0, holes: 6, S: 12, hub: 0.34 }), 0xffffff, -2.42, 0.56, TZ));
  const line = beltLine([{ x: -2.42, y: 0.56, r: 0.32 }, ...bottom.slice().reverse(), { x: 2.42, y: 0.5, r: 0.3 }, ...top], 0.05);
  gear.push(at(trackBelt(line, 0, 0.46, 0.1, 0.23), 0xffffff, 0, 0, TZ));
  items.push({ geo: bothSides(gear) });
  return finish(items, { height: 1.1 });
}
const T34_BODY = [
  { h: 0, pts: [[0.95, 0.5], [0.1, 0.95], [-1.0, 0.66], [-1.0, -0.66], [0.1, -0.95], [0.95, -0.5]] },
  { h: 0.78, pts: [[0.62, 0.34], [0.05, 0.76], [-0.9, 0.52], [-0.9, -0.52], [0.05, -0.76], [0.62, -0.34]] },
];
function t34Turret(paint, owner) {
  const P = paint, lite = tone(P, 1.1), items = [];
  items.push(at(tower(T34_BODY, { normals: 'flat' }), P));
  items.push(at(band(T34_BODY, 0.5, 0.6, 1.015), owner));
  // cast mantlet, armored sleeve and the 76 mm F-34
  items.push(box(0.3, 0.4, 0.56, lite, 0.85, 0.34, 0, 0, 0, 0, 0.07));
  items.push({ geo: alongX(spin([[0, 0], [0.1, 0], [0.1, 0.3], [0.085, 0.36], [0, 0.36]], P, 9)), color: 0xffffff, matrix: G.xf(0.98, 0.34, 0) });
  items.push(at(gun([[0.075, 0], [0.062, 0.2], [0.054, 1.37], [0.064, 1.39], [0.064, 1.43]], P).geo, 0xffffff, 1.32, 0.34, 0));
  // the two round roof hatches, periscopes, a vent; red stars on the rear side faces
  for (const z of [-0.3, 0.3]) items.push({ geo: upright(spin([[0.21, 0], [0.21, 0.04], [0.17, 0.07], [0, 0.08]], lite, 10)), color: 0xffffff, matrix: G.xf(-0.35, 0.78, z) });
  for (const z of [-0.4, 0.4]) items.push(box(0.12, 0.07, 0.08, DARK, 0.18, 0.8, z));
  items.push(box(0.14, 0.05, 0.14, STEEL, 0.1, 0.8, 0));
  const star = G.star(1, { color: 0xb02a20, border: WHITE, edge: 0.08 });
  for (const s of [-1, 1]) {
    // the rear side face runs from (0.1, 0.95) to (-1, 0.66) at the bottom; its outward normal tilts back and up
    const nx = -0.244, nz = s * 0.97, l = Math.hypot(nx, nz), ny = 0.22;
    items.push(mark(star, -0.44, 0.3, s * 0.746, [nx / l, ny, nz / l], 0.19));
  }
  return items;
}

// ---------------------------------------------------------------- the unit types

const MODELS = {
  medium: [
    (P, C) => ({ hull: shermanHull(P), turret: finish(shermanTurret(P, C), { height: 0.4, dark: 0.75 }), ring: SHERMAN.ring, tip: [3.15, 0.4, 0] }),
    (P, C) => ({ hull: panzerHull(P, true), turret: finish(panzerTurret(P, C), { height: 0.4, dark: 0.75 }), ring: PANZER.ring, tip: [3.6, 0.34, 0] }),
    (P, C) => ({ hull: t34Hull(P), turret: finish(t34Turret(P, C), { height: 0.4, dark: 0.75 }), ring: T34.ring, tip: [2.75, 0.34, 0] }),
  ],
  rocket: [(P, C) => ({ hull: shermanHull(P), turret: finish([...shermanTurret(P, C, { roofGun: false }), ...calliopeRack(P)], { height: 0.4, dark: 0.75 }), ring: SHERMAN.ring, tip: [3.15, 0.4, 0] })],
  flaktrack: [null, (P, C) => {
    const t = wirbelwindTurret(P, C);
    // the open turret sits on the hull's center line, a little behind the Panzer IV's turret
    return { hull: panzerHull(P, false), turret: finish(t.items, { height: 0.5, dark: 0.7 }), ring: [0.1, PANZER.ring[1], 0], tip: t.tip };
  }],
};

// The units this module builds: every medium tank, the T34 Calliope (rocket, USA) and the Wirbelwind (flaktrack,
// Germany).
export const isArmorMedium = (type, fac) => type === 'medium' || (type === 'rocket' && fac === 0) || (type === 'flaktrack' && fac === 1);

// Builds unit v's hull (returned, added under root) and its turret (v.turret, on the turret ring) as one part each
// for the caller to bake, and sets v.fxTip. Geometry is made once per look and shared.
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
  root.add(hull, v.turret);
  return hull;
}
