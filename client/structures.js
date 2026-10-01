// Miniature-model pieces for the map and the base buildings, in the painted sand-table style.
// Map pieces (houses, a church, barns, bocage banks, capped walls, sandbags, trenches, rubble, wire, tank traps,
// bridges) are rebuilt from the grid as one InstancedMesh per kind of piece, so the whole village costs a couple dozen
// draw calls. Every piece stands on the cells it represents; gameplay cells are never changed here.
// Base buildings (HQ, barracks, motor pool, depot, command bunker) are one merged, vertex-colored mesh per type and team.
import * as THREE from 'three';
import { CELL } from '/shared/sim.js';
import { surface, fogShader, fogged, loadTexture } from './surfaces.js';
import { gfx } from './gfx.js';

// stable pseudo-random per cell (same formula as main.js and ground.js), so a rebuild never reshuffles the village
const rnd = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const yawOf = (dx, dz) => Math.atan2(dx, dz); // the yaw that points a piece's local +z along (dx, dz)

// ---------- geometry helpers ----------
const E = new THREE.Euler(0, 0, 0, 'YXZ'), Q = new THREE.Quaternion(), P3 = new THREE.Vector3(), S3 = new THREE.Vector3();
// scale, then tilt (rz, rx) in the piece's own frame, then yaw, then move
function compose(out, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
  return out.compose(P3.set(x, y, z), Q, S3.set(sx, sy, sz));
}
// a part of a merged geometry; color is a hex (sRGB) or a linear [r, g, b]
const part = (geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) =>
  ({ geo, color, m: compose(new THREE.Matrix4(), x, y, z, sx, sy, sz, ry, rx, rz) });
// one non-indexed geometry (position, normal, uv, color) from many parts
function merge(parts) {
  const geos = parts.map(({ geo, color, m }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const n = g.attributes.position.count, c = Array.isArray(color) ? color : lin(color ?? 0xffffff), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  });
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const arr = new Float32Array(geos.reduce((s, g) => s + g.attributes[name].count * size, 0));
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array.subarray(0, g.attributes[name].count * size), o); o += g.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  geos.forEach(g => g.dispose());
  return out;
}
const flat = (geo) => { const g = geo.toNonIndexed(); g.computeVertexNormals(); return g; };
// a unit box with only some faces, in BoxGeometry order: +x, -x, +y, -y, +z, -z
function boxFaces(keep) {
  const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = b.attributes[name], k = a.itemSize, kept = [];
    keep.forEach((on, f) => { if (on) kept.push(a.array.slice(f * 6 * k, (f + 1) * 6 * k)); });
    const arr = new Float32Array(kept.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of kept) { arr.set(p, o); o += p.length; }
    g.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  return g;
}
// flat-shaded quads; each face says which way is out, so the winding comes out right
function solid(faces) {
  const pos = [], nor = [], uv = [], col = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const { pts, out, uvs, c: shade = 1 } of faces) {
    a.fromArray(pts[0]); b.fromArray(pts[1]); c.fromArray(pts[2]);
    n.subVectors(b, a).cross(c.sub(a)).normalize();
    let order = [0, 1, 2, 3];
    if (n.dot(P3.fromArray(out)) < 0) { order = [0, 3, 2, 1]; n.negate(); }
    for (const i of [order[0], order[1], order[2], order[0], order[2], order[3]]) {
      pos.push(...pts[i]); nor.push(n.x, n.y, n.z); uv.push(...uvs[i]); col.push(shade, shade, shade);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
// a thin bar from a to b (no end caps), for wire strands
function bar(parts, a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  parts.push({ geo: BAR, color: 0xffffff, m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(len, t, t)) });
}

// ---------- unit pieces (scaled per instance) ----------
const BOX = new THREE.BoxGeometry(1, 1, 1);
const QUAD = new THREE.PlaneGeometry(1, 1);
const BAR = boxFaces([0, 0, 1, 1, 1, 1]);
const FRONT = boxFaces([1, 1, 1, 0, 1, 0]); // no back, no bottom: sills stuck on a wall
// a rounded bank or spoil heap: eight-sided frustum, base radius 0.5 on y = 0, top at y = 1
const MOUND = merge([
  part(new THREE.CylinderGeometry(0.3, 0.5, 1, 8, 1, true), 0xffffff, 0, 0.5, 0),
  part(new THREE.CircleGeometry(0.3, 8).rotateX(-Math.PI / 2), 0xffffff, 0, 1, 0), // the top; the bottom is never seen
]);
// a lumpy shrub
const SHRUB = (() => {
  const g = new THREE.SphereGeometry(1, 7, 4), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    P3.fromBufferAttribute(p, i);
    const k = 1 + 0.14 * Math.sin(P3.x * 4.1 + P3.y * 2.3) * Math.cos(P3.z * 3.7 - P3.y * 1.9);
    p.setXYZ(i, P3.x * k, P3.y * k, P3.z * k);
  }
  g.computeVertexNormals();
  return g;
})();
const CHUNK = new THREE.IcosahedronGeometry(0.5, 0); // flat-shaded broken block
// gable end: triangle 1 wide, 0.4 high, pushed 1 along z (the ridge runs along z)
const GABLE = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 0.4)]), { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
// tiled roof over a unit gable: two slabs from the eaves (x = +-0.5, y = 0) to the ridge (y = 0.4), plus ridge tiles.
// uv.x runs along the ridge (-0.5..0.5), uv.y up the slope (0..1); the roof shader turns both into metres.
const ROOF_T = 0.028;
const ROOF = (() => {
  const T = ROOF_T, f = [], slope = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]], edge = [[-0.5, 0], [0.5, 0], [0.5, 0.02], [-0.5, 0.02]];
  for (const s of [-1, 1]) {
    const e = (z) => [s * 0.5, 0, z], et = (z) => [s * 0.5, T, z], r = (z) => [0, 0.4, z], rt = (z) => [0, 0.4 + T, z];
    f.push({ pts: [et(-0.5), et(0.5), rt(0.5), rt(-0.5)], out: [s * 0.4, 0.5, 0], uvs: slope });
    f.push({ pts: [e(-0.5), e(0.5), r(0.5), r(-0.5)], out: [-s * 0.4, -0.5, 0], uvs: slope, c: 0.55 });
    f.push({ pts: [e(-0.5), e(0.5), et(0.5), et(-0.5)], out: [s, 0, 0], uvs: edge, c: 0.75 });
    for (const z of [-0.5, 0.5]) f.push({ pts: [e(z), et(z), rt(z), r(z)], out: [0, 0, z], uvs: [[0, 0], [0, 0.02], [0, 1], [0, 1]], c: 0.75 });
  }
  const a = 0.03, yb = 0.4 + T - 0.012, yt = 0.4 + T + 0.022, cap = 0.68, u = [[0, 1], [0.5, 1], [0.5, 1], [0, 1]];
  f.push({ pts: [[-a, yt, -0.5], [a, yt, -0.5], [a, yt, 0.5], [-a, yt, 0.5]], out: [0, 1, 0], uvs: u, c: cap });
  for (const s of [-1, 1]) f.push({ pts: [[s * a, yb, -0.5], [s * a, yb, 0.5], [s * a, yt, 0.5], [s * a, yt, -0.5]], out: [s, 0, 0], uvs: u, c: cap });
  for (const z of [-0.5, 0.5]) f.push({ pts: [[-a, yb, z], [a, yb, z], [a, yt, z], [-a, yt, z]], out: [0, 0, z], uvs: u, c: cap });
  return solid(f);
})();
// square pyramid, base 1 x 1 on y = 0, apex at y = 1 (spires, hipped roofs)
const PYRAMID = flat(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
// window on a wall facing +z: frame, dark glass, glazing bars, a sill, and (with shutters) a shutter either side.
// The instance color is the house's trim color, so frames and shutters share one paint.
function windowGeo(shutters) {
  const parts = [
    part(QUAD, 0xf4eee2, 0, 0, 0.015, 0.74, 1.04, 1), part(QUAD, 0x1a2026, 0, 0.02, 0.03, 0.56, 0.86, 1),
    part(QUAD, 0xf4eee2, 0, 0.02, 0.045, 0.05, 0.86, 1), part(QUAD, 0xf4eee2, 0, 0.12, 0.045, 0.56, 0.05, 1),
    part(FRONT, 0xe0dacb, 0, -0.55, 0.05, 0.86, 0.07, 0.1),
  ];
  if (shutters) for (const s of [-1, 1]) parts.push(part(QUAD, 0xf4eee2, s * 0.57, 0, 0.04, 0.36, 1.04, 1));
  return merge(parts);
}
const WINDOW = windowGeo(true), PANE = windowGeo(false);
// sandbag: a box with rounded ends and edges (32 triangles), about 1 x 1 x 1, scaled per bag
const BAG = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 2, 2), p = g.attributes.position, n = g.attributes.normal, r = 0.25, a = 0.5 - r;
  const q = new THREE.Vector3(), d = new THREE.Vector3(), cl = (v) => Math.max(-a, Math.min(a, v));
  for (let i = 0; i < p.count; i++) {
    P3.fromBufferAttribute(p, i);
    q.set(cl(P3.x), cl(P3.y), cl(P3.z));
    d.subVectors(P3, q).normalize();
    p.setXYZ(i, q.x + d.x * r, q.y + d.y * r, q.z + d.z * r);
    n.setXYZ(i, d.x, d.y, d.z);
  }
  return g.scale(1, 1.17, 1.17); // with one segment along the bag, its sides come out at 0.43: back to 0.5
})();
// broken wall: a jagged slab 1 long (x), up to 1 high, 1 thick (z)
const BROKEN = (() => {
  const top = [0.55, 0.9, 1.0, 0.62, 0.8, 0.42, 0.52, 0.25], pts = [new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0)];
  for (let i = top.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(-0.5 + i / (top.length - 1), top[i]));
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
})();
// Czech hedgehog: three crossed beams tipped onto three of their ends
const HEDGEHOG = (() => {
  const L = 1.8, t = 0.17, g = merge([[L, t, t], [t, L, t], [t, t, L]].map(([x, y, z]) => part(BOX, 0xffffff, 0, 0, 0, x, y, z)));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)));
  g.computeBoundingBox();
  return g.translate(0, -g.boundingBox.min.y - 0.06, 0);
})();
// barbed wire between two posts: x runs 0..1 (scaled to the span), a concertina coil and a sagging strand on top
const WIRE = (() => {
  const parts = [], V = (x, y, z = 0) => new THREE.Vector3(x, y, z), LOOPS = 5, SEG = 6, R = 0.4, N = LOOPS * SEG;
  const coil = (i) => { const t = i / N, a = t * LOOPS * Math.PI * 2; return V(t, R + 0.02 + R * Math.cos(a), R * Math.sin(a)); };
  for (let i = 0; i < N; i++) bar(parts, coil(i), coil(i + 1), 0.035);
  const sag = (a) => V(a, 0.98 - 0.4 * a * (1 - a));
  for (let i = 0; i < 4; i++) bar(parts, sag(i / 4), sag((i + 1) / 4), 0.04);
  return merge(parts);
})();
// bridge railing, 2 long along x: three posts and two rails
const RAIL = merge([
  ...[-0.95, 0, 0.95].map(x => part(BOX, 0xffffff, x, 0.45, 0, 0.12, 0.9, 0.12)),
  part(BOX, 0xffffff, 0, 0.84, 0, 2.0, 0.08, 0.1), part(BOX, 0xffffff, 0, 0.45, 0, 2.0, 0.07, 0.08),
]);
// duckboard, 1 long along x, top at y = 0
const DUCK = merge([
  part(BAR, 0xffffff, 0, -0.07, 0.19, 1, 0.06, 0.06), part(BAR, 0xffffff, 0, -0.07, -0.19, 1, 0.06, 0.06),
  ...[-0.37, -0.12, 0.12, 0.37].map(x => part(boxFaces([1, 1, 1, 0, 1, 1]), 0xffffff, x, -0.02, 0, 0.14, 0.04, 0.55)),
]);

// ---------- materials ----------
// roof tiles keep their real size on any roof: uv times the instance's ridge length and slope length, in 1.6 m tiles
function roofShader(shader) {
  fogShader(shader);
  shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
	#if defined( USE_MAP ) && defined( USE_INSTANCING )
		vMapUv = uv * vec2( length( instanceMatrix[ 2 ].xyz ), length( vec2( 0.5 * length( instanceMatrix[ 0 ].xyz ), 0.4 * length( instanceMatrix[ 1 ].xyz ) ) ) ) / 1.6;
	#endif`);
}
let mats = null;
function materials() {
  if (mats) return mats;
  const roof = new THREE.MeshLambertMaterial({ color: 0x8a4a32, vertexColors: true });
  roof.onBeforeCompile = roofShader;
  loadTexture('roof', (tex) => { roof.map = tex; roof.color.setRGB(0.95, 0.95, 0.95); roof.needsUpdate = true; });
  mats = {
    roof,
    paint: fogged(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    glass: fogged(new THREE.MeshLambertMaterial({ vertexColors: true })),
    slate: fogged(new THREE.MeshLambertMaterial({ color: 0x5a5e66 })),
    wire: fogged(new THREE.MeshLambertMaterial({ color: 0x3b3631 })),
  };
  return mats;
}
// shadow: casts shadows (default yes); lowShadow false: not on Low; pick: houseAt() can click it
const KINDS = {
  wall: { geo: BOX, mat: () => surface('plaster'), pick: true },
  stone: { geo: BOX, mat: () => surface('stone'), pick: true },
  wood: { geo: BOX, mat: () => surface('wood'), pick: true },
  dark: { geo: BOX, mat: () => surface('darkwood') },
  gable: { geo: GABLE, mat: () => surface('plaster'), pick: true },
  gableWood: { geo: GABLE, mat: () => surface('wood'), pick: true },
  roof: { geo: ROOF, mat: () => materials().roof, pick: true },
  spire: { geo: PYRAMID, mat: () => materials().slate, pick: true },
  window: { geo: WINDOW, mat: () => materials().glass, shadow: false, pick: true },
  pane: { geo: PANE, mat: () => materials().glass, shadow: false, pick: true },
  paint: { geo: BOX, mat: () => materials().paint, shadow: false, pick: true },
  broken: { geo: BROKEN, mat: () => surface('plaster') },
  brokenStone: { geo: BROKEN, mat: () => surface('stone') },
  earth: { geo: MOUND, mat: () => surface('earth') },
  shrub: { geo: SHRUB, mat: () => surface('hedge') },
  bag: { geo: BAG, mat: () => surface('sandbag'), lowShadow: false },
  chunk: { geo: CHUNK, mat: () => surface('rubble'), lowShadow: false },
  hedgehog: { geo: HEDGEHOG, mat: () => surface('steel') },
  wire: { geo: WIRE, mat: () => materials().wire, shadow: false },
  rail: { geo: RAIL, mat: () => surface('darkwood'), lowShadow: false },
  duck: { geo: DUCK, mat: () => surface('wood'), shadow: false },
};

// ---------- instance batches ----------
const batch = new Map(), TMP = new THREE.Matrix4();
// one piece: world position, size (x across, y up, z along the yaw), yaw, linear color (number = grey), tilts
function put(kind, x, y, z, sx, sy, sz, ry = 0, color = 1, rx = 0, rz = 0) {
  let b = batch.get(kind);
  if (!b) batch.set(kind, (b = { m: [], c: [] }));
  const e = compose(TMP, x, y, z, sx, sy, sz, ry, rx, rz).elements;
  for (let i = 0; i < 16; i++) b.m.push(e[i]);
  if (typeof color === 'number') b.c.push(color, color, color); else b.c.push(color[0], color[1], color[2]);
}
function flush(group, low) {
  for (const [kind, b] of batch) {
    const def = KINDS[kind], n = b.c.length / 3, im = new THREE.InstancedMesh(def.geo, def.mat(), n);
    im.instanceMatrix.array.set(b.m);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.c), 3);
    im.castShadow = def.shadow !== false && !(low && def.lowShadow === false);
    im.receiveShadow = true;
    if (!def.pick) im.raycast = () => {};
    im.name = kind;
    group.add(im);
  }
  batch.clear();
}
function clearGroup(group) {
  for (const o of [...group.children]) { group.remove(o); o.dispose?.(); } // instance buffers only; geometry and materials are shared
}

// ---------- houses ----------
const PLASTER = [[1, 0.95, 0.85], [1.06, 0.9, 0.66], [1, 0.86, 0.8], [0.95, 0.95, 0.95], [1.02, 0.92, 0.74], [0.9, 0.9, 0.86]];
const ROOFS = [[1, 1, 1], [0.86, 0.72, 0.62], [1.08, 0.86, 0.72], [0.62, 0.64, 0.7], [0.95, 0.8, 0.66]];
const TRIM = [0x7d8f6a, 0x6a7d8f, 0x7a3a30, 0x6b4e32, 0x4f7a78, 0xd8cfb0].map(lin);
const BARN = [[1.15, 0.62, 0.48], [0.78, 0.76, 0.74], [0.95, 0.8, 0.62]];
const DARK = lin(0x1e1c1a);

// greedy rectangles in scan order: run right, then down while the whole row fits
function rectangles(x0, y0, x1, y1, ok) {
  const w = x1 - x0, used = new Uint8Array(w * (y1 - y0)), out = [], free = (x, y) => ok(x, y) && !used[(y - y0) * w + x - x0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!free(x, y)) continue;
    let xe = x + 1;
    while (xe < x1 && free(xe, y)) xe++;
    let ye = y + 1;
    const rowFree = (yy) => { for (let xx = x; xx < xe; xx++) if (!free(xx, yy)) return false; return true; };
    while (ye < y1 && rowFree(ye)) ye++;
    for (let yy = y; yy < ye; yy++) for (let xx = x; xx < xe; xx++) used[(yy - y0) * w + xx - x0] = 1;
    out.push({ x0: x, y0: y, x1: xe, y1: ye });
  }
  return out;
}

function houses(C) {
  const { w, h, at, orig } = C;
  const isFoot = (x, y) => orig[y]?.[x] === 'B' || at(x, y) === 'B';
  C.foot = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isFoot(x, y)) C.foot[y * w + x] = 1;
  // a house cell, standing or fallen: walls facing it are party walls, without windows
  C.isHouse = (x, y) => x >= 0 && y >= 0 && x < w && y < h && C.foot[y * w + x] === 1 && (at(x, y) === 'B' || at(x, y) === 'R');
  // rectangles over the map's footprint, so a house keeps its shape (and its look) while it is shot to pieces
  const rects = rectangles(0, 0, w, h, isFoot);
  const dims = (r) => { const a = r.x1 - r.x0, b = r.y1 - r.y0; return [Math.min(a, b), Math.max(a, b)]; };
  const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  if (rects.length >= 4) {
    // churches: the biggest long block, one more per 25 houses, at least 40 cells apart
    const want = 1 + Math.floor(rects.length / 25), churches = [];
    const cand = rects.filter(r => { const [s, l] = dims(r); return s >= 3 && s <= 4 && l > s; })
      .sort((a, b) => area(b) - area(a) || rnd(a.x0, a.y0, 7) - rnd(b.x0, b.y0, 7));
    for (const r of cand) {
      if (churches.length >= want) break;
      if (churches.every(c => Math.hypot(c.x0 - r.x0, c.y0 - r.y0) >= 40)) { r.kind = 'church'; churches.push(r); }
    }
    let barns = Math.max(1, Math.floor(rects.length / 8));
    for (const r of rects) {
      const [s] = dims(r);
      if (barns > 0 && !r.kind && area(r) >= 9 && s >= 3 && s <= 4 && rnd(r.x0, r.y0, 8) < 0.3) { r.kind = 'barn'; barns--; }
    }
  }
  for (const r of rects) {
    const [s, l] = dims(r), alongX = r.x1 - r.x0 >= r.y1 - r.y0;
    if (s >= 5) r.kind = 'block';
    const block = r.kind === 'block', parts = [];
    // long rows become terraces of 2-3 cell houses (city blocks: 3-5 cells), each with its own height and paint
    if (r.kind === 'church' || r.kind === 'barn' || l < 4 || (block && l < 6) || (!block && l === 4 && rnd(r.x0, r.y0, 11) < 0.4)) parts.push(l);
    else for (let left = l, i = 0; left > 0; i++) {
      const q = rnd(r.x0 + i, r.y0, 12);
      const k = block ? (left <= 5 ? left : left === 6 ? 3 : left === 7 ? 3 + (q < 0.5 ? 1 : 0) : 3 + Math.floor(q * 3))
        : (left <= 3 ? left : left === 4 ? 2 : 2 + (q < 0.5 ? 1 : 0));
      parts.push(k); left -= k;
    }
    let o = 0;
    for (const k of parts) {
      piece(C, alongX ? { x0: r.x0 + o, x1: r.x0 + o + k, y0: r.y0, y1: r.y1, kind: r.kind } : { x0: r.x0, x1: r.x1, y0: r.y0 + o, y1: r.y0 + o + k, kind: r.kind });
      o += k;
    }
  }
}

// the rectangle's frame: s runs across the ridge, a along it; at(s, a) gives world x, z
function frame(C, r) {
  const nx = r.x1 - r.x0, ny = r.y1 - r.y0, alongX = nx > ny || (nx === ny && rnd(r.x0, r.y0, 3) < 0.5);
  const L = (alongX ? nx : ny) * CELL, S = (alongX ? ny : nx) * CELL, cx = (r.x0 + r.x1) / 2 * CELL, cz = (r.y0 + r.y1) / 2 * CELL;
  let base = Infinity; // the lowest ground under it, so nothing floats on a slope
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) base = Math.min(base, C.hAt(x * CELL, y * CELL));
  const at = (s, a) => (alongX ? [cx + a, cz - s] : [cx + s, cz + a]);
  const yaw = alongX ? Math.PI / 2 : 0;
  // put a piece in this frame: sx across, sz along
  const P = (kind, s, y, a, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) => { const [x, z] = at(s, a); put(kind, x, y, z, sx, sy, sz, yaw + ry, color, rx, rz); };
  return { L, S, base, yaw, alongX, at, P, cx, cz };
}

// one house's look, from its own cell, shared by the standing house and its ruins
function spec(r) {
  const kind = r.kind ?? 'house', t = (k) => rnd(r.x0, r.y0, k);
  const church = kind === 'church', barn = kind === 'barn', block = kind === 'block';
  const storeys = church || barn ? 1 : block ? 2 + Math.floor(t(9) * 2) : t(1) < 0.55 ? 2 : 1;
  return {
    kind, church, barn, block, storeys, t,
    H: church ? 6.2 : barn ? 4.4 + 0.6 * t(2) : block ? storeys * 3.1 + 0.5 : storeys === 2 ? 5.6 + 0.9 * t(2) : 3.6 + 0.8 * t(2),
    k: church ? 1.25 : barn ? 1.3 : 0.85 + 0.3 * t(10), // roof pitch: ridge height = 0.4 * span * k
    tint: barn ? pick(BARN, t(4)) : church ? [1.04, 1, 0.92] : pick(PLASTER, t(4)),
    roof: church ? [0.6, 0.62, 0.68] : barn ? [0.62, 0.56, 0.5] : pick(ROOFS, t(5)),
    trim: pick(TRIM, t(6)),
    shutters: !block && !church && !barn && t(18) < 0.7,
  };
}

// exterior wall bays of a rectangle: one per cell edge that faces open ground
function bays(C, r, F) {
  const out = [];
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) for (const [dx, dy] of DIR4) {
    const nx = x + dx, ny = y + dy;
    if ((nx >= r.x0 && nx < r.x1 && ny >= r.y0 && ny < r.y1) || C.isHouse(nx, ny)) continue;
    out.push({ x, y, dx, dy, long: F.alongX ? dy !== 0 : dx !== 0, px: (x + 0.5 + dx * 0.5) * CELL, pz: (y + 0.5 + dy * 0.5) * CELL });
  }
  return out;
}
const windowAt = (kind, b, y, color, sx = 1, sy = 1) => put(kind, b.px, y, b.pz, sx, sy, 1, yawOf(b.dx, b.dy), color);

// church tower inside one end of the nave, rising through the roof, with belfry openings and a slate spire
function tower(F, sp, end) {
  const { L, S, base, P } = F, T = Math.min(S - 0.8, 3.4), aT = end * (L / 2 - T / 2 - 0.1), top = base + sp.H + 0.4 * S * sp.k + 3.2;
  P('stone', 0, (base - 1 + top) / 2, aT, T, top - base + 1, T, 1.02);
  P('stone', 0, top + 0.15, aT, T + 0.3, 0.3, T + 0.3, 1.12);
  P('spire', 0, top + 0.3, aT, T - 0.2, 5.2, T - 0.2, 1);
  for (const s of [-1, 1]) {
    P('paint', s * (T / 2 + 0.02), top - 1.3, aT, 0.08, 1.4, 0.8, DARK);
    P('paint', 0, top - 1.3, aT + s * (T / 2 + 0.02), 0.8, 1.4, 0.08, DARK);
  }
  return { aT, T };
}

function piece(C, r) {
  const cells = [];
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) cells.push([x, y]);
  const sp = spec(r);
  for (const [x, y] of cells) C.tint.set(y * C.w + x, { color: sp.tint, wood: sp.barn });
  const standing = cells.filter(([x, y]) => C.at(x, y) === 'B');
  if (!standing.length) return; // all rubble: rubble() draws it
  if (standing.length < cells.length) ruin(C, r, sp, standing);
  else house(C, r, sp);
}

function house(C, r, sp) {
  const F = frame(C, r), { L, S, base, P } = F, { H, k, tint, t } = sp, oh = 0.35;
  P(sp.barn ? 'wood' : 'wall', 0, base - 1 + (H + 1) / 2, 0, S, H + 1, L, tint);
  P('stone', 0, base - 0.5, 0, S + 0.14, 2.1, L + 0.14, 0.85); // plinth, up to base + 0.55
  if (sp.block) {
    // flat roof: cornice, tar, a stone parapet and a couple of chimney stacks
    P('stone', 0, base + H - 0.25, 0, S + 0.24, 0.22, L + 0.24, 1.05);
    P('paint', 0, base + H + 0.03, 0, S - 0.5, 0.06, L - 0.5, lin(0x4a4640));
    for (const s of [-1, 1]) {
      P('stone', s * (S / 2 - 0.15), base + H + 0.25, 0, 0.3, 0.6, L, 0.95);
      P('stone', 0, base + H + 0.25, s * (L / 2 - 0.15), S - 0.6, 0.6, 0.3, 0.95);
    }
    for (let i = 0; i < 2; i++) {
      const s = (t(20 + i) - 0.5) * (S - 2), a = (t(22 + i) - 0.5) * (L - 2);
      P('stone', s, base + H + 0.6, a, 0.7, 1.2, 1.1, 0.8);
      P('stone', s, base + H + 1.26, a, 0.85, 0.12, 1.25, 0.55);
    }
  } else {
    // pitched roof: gable ends in the wall paint, a tiled roof with eaves overhanging by oh
    P(sp.barn ? 'gableWood' : 'gable', 0, base + H, 0, S, S * k, L, tint);
    const W = S + 2 * oh;
    P('roof', 0, base + H - 0.8 * k * oh, 0, W, W * k, L + 2 * oh, sp.roof);
    if (!sp.church && !sp.barn && t(13) < 0.8) {
      const a = (t(14) < 0.5 ? -1 : 1) * Math.max(0, L / 2 - 0.9), s = (t(15) < 0.5 ? -1 : 1) * 0.22 * S;
      const top = base + H + 0.4 * k * (S - 2 * Math.abs(s)) + 1.0 + 0.3 * t(16), bot = base + H - 0.3;
      P('stone', s, (top + bot) / 2, a, 0.6, top - bot, 0.75, 0.8);
      P('stone', s, top + 0.06, a, 0.78, 0.12, 0.92, 0.5);
    }
  }
  const list = bays(C, r, F);
  if (sp.church) {
    const end = t(19) < 0.5 ? -1 : 1, { aT, T } = tower(F, sp, end);
    for (const b of list) {
      const a = F.alongX ? b.px - F.cx : b.pz - F.cz;
      if (b.long && Math.abs(a - aT) > T / 2 + 0.4) windowAt('pane', b, base + 3.4, lin(0x8a9098), 0.8, 2.0);
    }
    const g = Math.max(base, C.hAt(...F.at(0, end * (L / 2 + 0.5))));
    P('paint', 0, g + 1.45, end * (L / 2 + 0.02), 1.5, 2.8, 0.1, lin(0x4a3220));
    P('stone', 0, g + 0.06, end * (L / 2 + 0.4), 2.2, 0.3, 0.8, 0.9);
    P('paint', 0, base + H + 1.0, -end * (L / 2 + 0.03), 1.0, 1.0, 0.08, lin(0x3a4250), 0, 0, Math.PI / 4); // rose window
    return;
  }
  if (sp.barn) {
    // big double door with white cross braces on one gable end, a hayloft door above it
    const end = t(19) < 0.5 ? -1 : 1, aE = end * (L / 2 + 0.02), dw = Math.min(2.8, S - 1.2), dh = Math.min(3.2, H - 0.6);
    const g = Math.max(base, C.hAt(...F.at(0, end * (L / 2 + 0.5))));
    P('paint', 0, g + dh / 2 + 0.05, aE, dw, dh, 0.1, lin(0x4a3626));
    for (const s of [-1, 1]) P('paint', 0, g + dh / 2 + 0.05, aE + end * 0.04, Math.hypot(dw, dh) - 0.25, 0.14, 0.08, lin(0xd8cfb0), 0, 0, s * Math.atan2(dh, dw));
    P('paint', 0, g + dh + 0.14, aE + end * 0.04, dw + 0.2, 0.16, 0.08, lin(0xd8cfb0));
    P('paint', 0, base + H + 0.75, aE, 1.1, 1.0, 0.1, lin(0x3a2a1c));
    return;
  }
  // windows on every open bay and storey, a door on a long side
  const longs = list.filter(b => b.long), door = !sp.block && longs.length ? longs[Math.floor(t(17) * longs.length)] : null;
  for (const b of list) for (let i = 0; i < sp.storeys; i++) {
    if (b === door && i === 0) continue;
    if (rnd(b.x * 3 + b.dx, b.y * 3 + b.dy, 30 + i) < 0.15) continue; // a few blank bays
    const y = sp.block ? base + 1.6 + i * 3.1 : i === 0 ? base + 1.6 : base + H - 1.45;
    windowAt(sp.shutters ? 'window' : 'pane', b, y, sp.trim);
  }
  if (door) {
    const yd = yawOf(door.dx, door.dy), g = Math.max(base, C.hAt(door.px + door.dx * 0.4, door.pz + door.dy * 0.4));
    put('paint', door.px, g + 1.05, door.pz, 1.0, 2.0, 0.1, yd, mul(sp.trim, 0.75));
    put('stone', door.px, g + 2.16, door.pz, 1.3, 0.16, 0.16, yd, 1.05);
    put('stone', door.px + door.dx * 0.3, g + 0.06, door.pz + door.dy * 0.3, 1.4, 0.3, 0.6, yd, 0.9);
  }
}

// a house with fallen cells: what stands is a roofless, burnt-out shell with jagged wall tops
function ruin(C, r, sp, standing) {
  const keep = new Set(standing.map(([x, y]) => y * C.w + x));
  for (const q of rectangles(r.x0, r.y0, r.x1, r.y1, (x, y) => keep.has(y * C.w + x))) {
    const F = frame(C, q), { L, S, base, P } = F, t = (k) => rnd(q.x0, q.y0, 40 + k);
    const Hs = Math.max(2.6, sp.H * (0.6 + 0.25 * t(1)));
    P(sp.barn ? 'wood' : 'wall', 0, base - 1 + (Hs + 1) / 2, 0, S, Hs + 1, L, sp.tint);
    P('stone', 0, base - 0.5, 0, S + 0.14, 2.1, L + 0.14, 0.85);
    P('paint', 0, base + Hs + 0.03, 0, S - 0.3, 0.06, L - 0.3, lin(0x3a342e));
    const jag = sp.barn ? 'brokenStone' : 'broken', tint = sp.barn ? 0.8 : sp.tint;
    for (const s of [-1, 1]) {
      P(jag, s * (S / 2 - 0.15), base + Hs - 0.05, 0, L, 0.7 + 0.7 * t(2 + s), 0.3, tint, Math.PI / 2 + (t(4 + s) < 0.5 ? Math.PI : 0));
      P(jag, 0, base + Hs - 0.05, s * (L / 2 - 0.15), S, 0.6 + 0.7 * t(6 + s), 0.3, tint, t(8 + s) < 0.5 ? Math.PI : 0);
    }
    for (let i = 0; i < 2; i++) P('dark', 0, base + Hs + 0.05, (t(10 + i) - 0.5) * (L - 0.6), S * 0.96, 0.2, 0.2, 0.45, 0, 0, (t(12 + i) - 0.5) * 0.4);
    for (const b of bays(C, q, F)) {
      windowAt('pane', b, base + 1.6, lin(0x5a544c));
      if (Hs > 4.6 && sp.storeys > 1) windowAt('pane', b, base + Hs - 1.6, lin(0x5a544c));
    }
  }
  if (sp.church) {
    // the tower stays up while its own cells do
    const F = frame(C, r), end = sp.t(19) < 0.5 ? -1 : 1, T = Math.min(F.S - 0.8, 3.4), aT = end * (F.L / 2 - T / 2 - 0.1);
    const [tx, tz] = F.at(0, aT), x0 = Math.floor((tx - T / 2) / CELL), x1 = Math.floor((tx + T / 2 - 0.01) / CELL);
    const y0 = Math.floor((tz - T / 2) / CELL), y1 = Math.floor((tz + T / 2 - 0.01) / CELL);
    let up = true;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (C.at(x, y) !== 'B') up = false;
    if (up) tower(F, sp, end);
  }
}

// ---------- rubble ----------
function rubble(C) {
  const { w, h, at, hAt, low } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'R') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), house = C.tint.get(y * w + x);
    const n = (low ? 2 : 3) + (house && !low ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const s = 0.45 + 0.6 * rnd(x, y, k), c = rnd(x, y, k + 17);
      const tint = house && c < 0.5 ? (house.wood ? mul(house.color, 0.6) : house.color) : c < 0.78 ? [0.95, 0.93, 0.9] : [1.12, 0.66, 0.52];
      put('chunk', cx + (rnd(x, y, k + 9) - 0.5) * 1.3, g + s * 0.12, cz + (rnd(x, y, k + 13) - 0.5) * 1.3,
        s * (1 + 0.4 * rnd(x, y, k + 21)), s * (0.45 + 0.3 * rnd(x, y, k + 25)), s * (0.9 + 0.4 * rnd(x, y, k + 29)),
        rnd(x, y, k + 33) * 6.28, tint, (rnd(x, y, k + 37) - 0.5) * 0.6, (rnd(x, y, k + 41) - 0.5) * 0.6);
    }
    // broken wall stubs on the outside edges of what stood here (low enough to see units over)
    DIR4.forEach(([dx, dy], i) => {
      const nb = at(x + dx, y + dy);
      if (nb === 'R' || nb === 'B' || nb === 'K' || rnd(x, y, 50 + i) > (house ? 0.6 : 0.35)) return;
      const len = 0.9 + 1.1 * rnd(x, y, 54 + i), ht = house ? 0.6 + 0.7 * rnd(x, y, 58 + i) : 0.4 + 0.5 * rnd(x, y, 58 + i);
      const along = (rnd(x, y, 62 + i) - 0.5) * (CELL - len), stone = !house || house.wood;
      put(stone ? 'brokenStone' : 'broken', cx + dx * 0.82 - dy * along, g - 0.2, cz + dy * 0.82 + dx * along, len, ht + 0.2, 0.3,
        yawOf(dx, dy) + (rnd(x, y, 66 + i) < 0.5 ? Math.PI : 0), stone ? 0.95 : house.color);
    });
    if (house && !low && rnd(x, y, 70) < 0.45) put('dark', cx + rnd(x, y, 71) - 0.5, g + 0.35, cz + rnd(x, y, 72) - 0.5, 2.2, 0.16, 0.16, rnd(x, y, 73) * 6.28, 0.45, 0, 0.3);
  }
}

// ---------- hedgerows: bocage earth banks topped with shrubs (still tall enough to block sight) ----------
function hedges(C) {
  const { w, h, at, hAt, low } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'H') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), r1 = rnd(x, y, 80), hb = 0.85 + 0.25 * r1;
    put('earth', cx, g - 0.1, cz, 2.4, hb, 2.4, r1 * 6.28, [0.78, 0.9, 0.6]);
    const ex = at(x - 1, y) === 'H' || at(x + 1, y) === 'H', ez = at(x, y - 1) === 'H' || at(x, y + 1) === 'H';
    const alongX = ex !== ez ? ex : rnd(x, y, 81) < 0.5, top = g - 0.1 + hb, n = low ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const o = n === 1 ? 0 : (i ? 0.5 : -0.5) + (rnd(x, y, 82 + i) - 0.5) * 0.3, side = (rnd(x, y, 84 + i) - 0.5) * 0.2;
      const rr = (low ? 1.0 : 0.8) + 0.2 * rnd(x, y, 86 + i), wide = low ? 1.15 : 1, v = rnd(x, y, 88 + i);
      put('shrub', alongX ? cx + o : cx + side, top + rr * 0.3, alongX ? cz + side : cz + o, rr * wide, rr * 0.85, rr * wide, v * 6.28,
        [0.88 + 0.2 * v, 0.95 + 0.15 * rnd(x, y, 90 + i), 0.85 + 0.15 * v]);
    }
  }
}

// ---------- walls: '#' from the map is a capped stone wall, '#' built in play is a sandbag wall ----------
const WT = 0.55, WH = 1.0, SINK = 0.3;
function walls(C) {
  const { w, h, at, orig } = C, isWall = (x, y) => at(x, y) === '#';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isWall(x, y)) continue;
    const conn = DIR4.filter(([dx, dy]) => isWall(x + dx, y + dy));
    const diag = DIAG.filter(([dx, dy]) => isWall(x + dx, y + dy) && !isWall(x + dx, y) && !isWall(x, y + dy));
    (orig[y]?.[x] === '#' ? stoneWall : bagWall)(C, x, y, conn, diag);
  }
}
function stoneWall(C, x, y, conn, diag) {
  const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = C.hAt(cx, cz), tint = 0.85 + 0.25 * rnd(x, y, 100), y0 = g - SINK, cap = tint * 1.18;
  // a run of wall centered (ox, oz) from the cell center, length along the yaw; diagonals sit a hair lower
  const run = (ox, oz, len, yaw, drop = 0) => {
    put('stone', cx + ox, y0 + WH / 2 - drop, cz + oz, WT, WH, len, yaw, tint);
    put('stone', cx + ox, y0 + WH + 0.065 - drop, cz + oz, WT + 0.16, 0.13, len + 0.02, yaw, cap);
  };
  if (conn.length === 2 && conn[0][0] === -conn[1][0] && conn[0][1] === -conn[1][1] && !diag.length) { run(0, 0, CELL, yawOf(...conn[0])); return; }
  if (!conn.length && !diag.length) { run(0, 0, 1.6, rnd(x, y, 101) < 0.5 ? Math.PI / 2 : 0); return; }
  for (const [dx, dy] of conn) run(dx * (0.5 + WT / 4), dy * (0.5 + WT / 4), 1 - WT / 2, yawOf(dx, dy));
  for (const [dx, dy] of diag) run(dx * 0.5, dy * 0.5, Math.SQRT2, yawOf(dx, dy), 0.015);
  if (conn.length === 1 && !diag.length) {
    // the end of a wall: a stone pier
    put('stone', cx, y0 + (WH + 0.15) / 2, cz, 0.75, WH + 0.15, 0.75, 0, tint);
    put('stone', cx, y0 + WH + 0.215, cz, 0.9, 0.13, 0.9, 0, cap);
  } else {
    put('stone', cx, y0 + WH / 2, cz, WT, WH, WT, 0, tint);
    put('stone', cx, y0 + WH + 0.07, cz, WT + 0.16, 0.13, WT + 0.16, 0, cap);
  }
}
const BAG_TINTS = [[1, 1, 1], [0.92, 0.9, 0.84], [1.05, 1.02, 0.92], [0.92, 0.96, 0.82]];
function bags(x, y, k, px, py, pz, yaw, len = 0.56) {
  const j = rnd(x * 7 + k, y * 5 + k, 110);
  put('bag', px + (j - 0.5) * 0.05, py, pz + (rnd(x, y, 111 + k) - 0.5) * 0.05, len * (0.95 + 0.1 * j), 0.28, 0.44, yaw + (j - 0.5) * 0.2, pick(BAG_TINTS, rnd(x, y, 112 + k)));
}
function bagWall(C, x, y, conn, diag) {
  const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = C.hAt(cx, cz) - 0.04;
  let dirs = [...conn, ...diag];
  if (!dirs.length) dirs = rnd(x, y, 113) < 0.5 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
  let k = 0;
  for (const [dx, dy] of dirs) {
    // three courses along the half run to the cell edge: two rows deep at the bottom, one above
    const L = Math.hypot(dx, dy), ux = dx / L, uz = dy / L, yaw = yawOf(ux, uz) + Math.PI / 2, len = 0.56 * L;
    const owns = dx > 0 || (dx === 0 && dy > 0); // the bag on the shared edge belongs to one of the two cells
    for (let c = 0; c < 3; c++) {
      const at = c === 1 ? (owns ? [0.5, 1] : [0.5]) : [0.25, 0.75], rows = c === 0 ? [-0.2, 0.2] : [0];
      for (const f of at) for (const off of rows) bags(x, y, k++, cx + ux * f * L - uz * off, g + 0.14 + c * 0.25, cz + uz * f * L + ux * off, yaw, len);
    }
  }
  // the middle of the cell, under the second course
  const [dx, dy] = dirs[0];
  bags(x, y, k++, cx, g + 0.39, cz, yawOf(dx, dy) + Math.PI / 2);
}

// ---------- trenches: timber revetments, posts, duckboards, spoil parapets; MG nests get an inner ring of bags ----------
function trenches(C) {
  const { w, h, at, hAt, low } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'T') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), conn = DIR4.map(([dx, dy]) => at(x + dx, y + dy) === 'T');
    DIR4.forEach(([dx, dy], i) => {
      const yaw = yawOf(dx, dy);
      if (conn[i]) {
        // the channel runs on: line both sides to the cell edge, boards along the floor
        for (const s of [-1, 1]) put('wood', cx + dx * 0.75 - dy * s * 0.5, g - 0.05, cz + dy * 0.75 + dx * s * 0.5, 0.08, 0.5, 0.5, yaw, 0.9);
        if (!low) put('duck', cx + dx * 0.5, g + 0.19, cz + dy * 0.5, 1, 1, 1, yaw + Math.PI / 2);
      } else {
        put('wood', cx + dx * 0.5, g - 0.05, cz + dy * 0.5, 1.08, 0.5, 0.08, yaw, 0.9);
        if (at(x + dx, y + dy) !== '#') put('earth', cx + dx * 0.88, g - 0.1, cz + dy * 0.88, 2.1, 0.5, 0.7, yaw, [0.95, 0.88, 0.78]);
      }
    });
    for (const [sx, sz] of DIAG) put('dark', cx + sx * 0.5, g - 0.05, cz + sz * 0.5, 0.12, 0.6, 0.12, 0, 0.8);
    if (conn.some(Boolean)) continue;
    if (!low) put('duck', cx, g + 0.19, cz, 0.8, 1, 1, rnd(x, y, 120) < 0.5 ? 0 : Math.PI / 2);
    // a lone pit with sandbags around it is an MG nest: low ring of bags round its front and sides, ammo boxes behind
    let fx = 0, fz = 0, n = 0;
    for (const [dx, dy] of [...DIR4, ...DIAG]) if (at(x + dx, y + dy) === '#') { fx += dx; fz += dy; n++; }
    if (n < 3) continue;
    const a0 = fx || fz ? Math.atan2(fz, fx) : 0;
    for (let c = 0; c < 2; c++) for (let i = -3; i <= 3 - c; i++) {
      const a = a0 + i * 0.5 + c * 0.25;
      bags(x, y, 200 + c * 10 + i, cx + Math.cos(a) * 0.82, g + 0.1 + c * 0.25, cz + Math.sin(a) * 0.82, -a + Math.PI / 2, 0.5);
    }
    for (const s of [-1, 1]) {
      const bx = cx - Math.cos(a0) * 0.45 - Math.sin(a0) * s * 0.3, bz = cz - Math.sin(a0) * 0.45 + Math.cos(a0) * s * 0.3;
      put('wood', bx, g + 0.15, bz, 0.32, 0.3, 0.5, -a0, [0.7, 0.75, 0.6]);
    }
  }
}

// ---------- barbed wire: posts and sagging strands from post to post ----------
function wire(C) {
  const { w, h, at, hAt } = C, isWire = (x, y) => at(x, y) === 'X';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isWire(x, y)) continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), tilt = (k) => (rnd(x, y, k) - 0.5) * 0.14;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      if (!isWire(x + dx, y + dy) || (dx && dy && (isWire(x + dx, y) || isWire(x, y + dy)))) continue;
      put('wire', cx, g, cz, CELL * Math.hypot(dx, dy), 1, 1, Math.atan2(-dy, dx));
    }
    if ([...DIR4, ...DIAG].some(([dx, dy]) => isWire(x + dx, y + dy))) put('dark', cx, g + 0.45, cz, 0.1, 1.15, 0.1, rnd(x, y, 130) * 3, 0.9, tilt(131), tilt(132));
    else {
      // a lone stretch: a short span between two posts
      const a = rnd(x, y, 133) * Math.PI, ux = Math.cos(a), uz = Math.sin(a);
      put('wire', cx - ux * 0.9, g, cz - uz * 0.9, 1.8, 1, 1, Math.atan2(-uz, ux));
      for (const s of [-1, 1]) put('dark', cx + s * ux * 0.9, g + 0.45, cz + s * uz * 0.9, 0.1, 1.15, 0.1, a, 0.9, tilt(134 + s), tilt(136 + s));
    }
  }
}

// ---------- tank traps: two steel hedgehogs per cell ----------
function traps(C) {
  const { w, h, at, hAt } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'Y') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, flip = rnd(x, y, 140) < 0.5 ? 1 : -1;
    for (const s of [-1, 1]) {
      const px = cx + s * 0.45, pz = cz + s * 0.45 * flip, sc = 0.95 + 0.15 * rnd(x, y, 141 + s), r = rnd(x, y, 143 + s);
      put('hedgehog', px, C.hAt(px, pz), pz, sc, sc, sc, r * 6.28, mul([1.1, 0.86, 0.72], 0.85 + 0.25 * r));
    }
  }
}

// ---------- mines: a dark disc half sunk in the turf (the server only tells you about your own side's) ----------
function mines(C) {
  const { w, h, at, hAt } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'N') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL;
    put('dark', cx, hAt(cx, cz) + 0.06, cz, 0.7, 0.14, 0.7, rnd(x, y, 150) * 6.28, 0.7);
  }
}

// ---------- bridges: plank deck, edge beams, railings and stone cutwaters on the water sides ----------
function bridges(C) {
  const { w, h, at, hAt } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== '=') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), top = g + 0.22;
    put('wood', cx, top - 0.15, cz, CELL, 0.3, CELL, 0, 1);
    for (const [dx, dy] of DIR4) {
      const nb = at(x + dx, y + dy);
      if (nb !== 'W' && nb !== 'F') continue;
      const yaw = yawOf(dx, dy);
      put('dark', cx + dx * 0.95, top - 0.1, cz + dy * 0.95, CELL, 0.34, 0.12, yaw, 0.9);
      put('rail', cx + dx * 0.9, top, cz + dy * 0.9, 1, 1, 1, yaw);
      if ((x + y) % 2 === 0) {
        put('stone', cx + dx, (g - 0.6 + top + 0.3) / 2, cz + dy, 1.0, top + 0.3 - (g - 0.6), 1.0, Math.PI / 4, 0.9);
        put('stone', cx + dx, top + 0.36, cz + dy, 1.1, 0.12, 1.1, Math.PI / 4, 1.1);
      }
    }
  }
}

// ---------- the map's pieces ----------
let state = null;
function rebuild() {
  const { group, grid, orig, hAt } = state, h = grid.length, w = grid[0]?.length ?? 0;
  clearGroup(group);
  const C = { grid, orig, hAt, w, h, low: gfx.low, at: (x, y) => grid[y]?.[x], tint: new Map() };
  houses(C); rubble(C); hedges(C); walls(C); trenches(C); wire(C); traps(C); mines(C); bridges(C);
  flush(group, C.low);
}
// group: emptied and refilled; grid: current rows (arrays of chars); orig: the map file's rows; hAt(x, z): ground height
export function buildStructures(group, grid, orig, hAt) {
  if (state && state.group !== group) clearGroup(state.group);
  state = { group, grid, orig, hAt };
  rebuild();
}
gfx.onChange(() => { if (state?.group.parent) rebuild(); });

// HQ ring: rounded sandbags in two courses, with exits at the four quarter points (one InstancedMesh)
export function sandbagRing(radius) {
  const list = [];
  for (let k = 0; k < 4; k++) {
    const a0 = (k * 9 + 1.56) / 36 * Math.PI * 2, a1 = (k * 9 + 8.44) / 36 * Math.PI * 2, n = Math.round((a1 - a0) * radius / 1.35);
    for (let c = 0; c < 2; c++) for (const off of c ? [0] : [-0.32, 0.32]) for (let i = 0; i < n - c; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + c * 0.5) / n, r = radius + off, j = rnd(i, k * 7 + c * 3 + off, 150);
      list.push([Math.cos(a) * r, 0.22 + c * 0.4, Math.sin(a) * r, 1.35 * (0.95 + 0.1 * j), 0.45, 0.66, -a + Math.PI / 2 + (j - 0.5) * 0.1, pick(BAG_TINTS, j)]);
    }
  }
  const im = new THREE.InstancedMesh(BAG, surface('sandbag'), list.length), col = new THREE.Color();
  list.forEach(([x, y, z, sx, sy, sz, ry, c], i) => { im.setMatrixAt(i, compose(TMP, x, y, z, sx, sy, sz, ry)); im.setColorAt(i, col.setRGB(...c)); });
  im.castShadow = im.receiveShadow = true;
  return im;
}

// ---------- base buildings (front faces +x) ----------
const CYL = {};
const bx = (c, sx, sy, sz, x, y, z, ry = 0, rx = 0, rz = 0) => part(BOX, c, x, y, z, sx, sy, sz, ry, rx, rz);
const cyl = (c, r, h, seg, x, y, z, rx = 0, rz = 0) => part((CYL[seg] ??= new THREE.CylinderGeometry(1, 1, 1, seg)), c, x, y, z, r, h, r, 0, rx, rz);
const darker = (hex, k) => mul(lin(hex), k);
// half cylinder along x, radius 1, length 1, the round side up (open: shell; closed: end wall)
const half = (open) => new THREE.CylinderGeometry(1, 1, 1, 12, 1, open, -Math.PI / 2, Math.PI).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
const HALF = half(true), HALF_END = half(false);
const oct = (top, bottom) => flat(new THREE.CylinderGeometry(top, bottom, 1, 8, 1).rotateY(Math.PI / 8));
const BUNKER = { body: oct(2.3, 2.75), slab: oct(2.6, 2.6), turf: oct(1.5, 2.35) };
const SANDBAG = 0x9c8a60;
const bagTint = (k) => mul(lin(SANDBAG), 0.9 + 0.2 * rnd(k, 3, 160));
// a ring of rounded bags in arcs [from, to] (radians), two courses with the bottom two rows deep
function bagArcs(P, radius, arcs, len, ht, depth) {
  arcs.forEach(([a0, a1], k) => {
    const n = Math.max(2, Math.round((a1 - a0) * radius / len));
    for (let c = 0; c < 2; c++) for (const off of c ? [0] : [-depth * 0.45, depth * 0.45]) for (let i = 0; i < n - c; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + c * 0.5) / n, r = radius + off;
      P.push(part(BAG, bagTint(k * 31 + c * 7 + i + off), Math.cos(a) * r, ht / 2 + c * ht * 0.9, Math.sin(a) * r, len, ht, depth, -a + Math.PI / 2));
    }
  });
}

const MODELS = {
  // command post: log blockhouse with a hipped roof, sandbagged door, radio mast and a flag
  hq: (f) => {
    const P = [], logs = 0x5e4a32, post = 0x3a2e20, slit = 0x16140f;
    P.push(bx(0x5e5038, 5.9, 0.16, 5.9, 0, 0.08, 0), bx(0x7a6446, 4.4, 2.5, 4.4, 0, 1.41, 0));
    for (const y of [0.55, 1.15, 1.75, 2.35]) P.push(bx(logs, 4.5, 0.13, 4.5, 0, y, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(bx(post, 0.32, 2.75, 0.32, sx * 2.2, 1.5, sz * 2.2));
    P.push(bx(post, 5.4, 0.18, 5.4, 0, 2.72, 0), part(PYRAMID, f.vehicle, 0, 2.8, 0, 5.6, 1.5, 5.6));
    P.push(bx(0x2e2418, 0.1, 1.85, 1.1, 2.22, 1.08, 0), bx(f.color, 0.08, 0.42, 1.7, 2.24, 2.3, 0));
    for (const z of [-1.3, 1.3]) P.push(bx(slit, 0.08, 0.4, 0.8, 2.22, 1.7, z));
    for (const s of [-1, 1]) for (const x of [-1.1, 1.1]) P.push(bx(slit, 0.9, 0.4, 0.08, x, 1.7, s * 2.22));
    for (const s of [-1, 1]) for (let c = 0; c < 2; c++) for (let i = 0; i < 3 - c; i++)
      P.push(part(BAG, bagTint(s * 9 + c * 3 + i), 2.7, 0.18 + c * 0.3, s * (1.0 + 0.31 * c + i * 0.62), 0.6, 0.32, 0.42, Math.PI / 2));
    P.push(cyl(0x2a2a26, 0.06, 4.6, 6, -1.6, 4.9, -1.6));
    for (const y of [5.9, 6.7]) P.push(bx(0x2a2a26, 0.05, 0.05, 1.0, -1.6, y, -1.6));
    P.push(cyl(0x4a3f30, 0.05, 2.6, 6, 1.9, 4.0, -1.9), bx(f.color, 1.3, 0.8, 0.05, 1.25, 4.85, -1.9));
    return P;
  },
  // Nissen hut: corrugated half-cylinder with ribs, timber end walls, door and windows at the front, a stovepipe
  barracks: (f) => {
    const P = [], r = 2.45, rib = darker(f.vehicle, 0.68);
    P.push(bx(0x7e7c74, 5.9, 0.2, 5.9, 0, 0.1, 0), part(HALF, f.vehicle, 0, 0.2, 0, 5.4, r, r));
    for (const x of [-2.0, -0.68, 0.64, 1.96]) P.push(part(HALF, rib, x, 0.2, 0, 0.14, r + 0.05, r + 0.05));
    for (const s of [-1, 1]) P.push(part(HALF_END, 0x7a6446, s * 2.72, 0.2, 0, 0.16, r - 0.02, r - 0.02));
    P.push(bx(0x2e2418, 0.1, 1.9, 1.0, 2.82, 1.15, 0), bx(f.color, 0.08, 0.3, 1.1, 2.83, 2.3, 0));
    for (const z of [-1.3, 1.3]) P.push(bx(0x1e2226, 0.08, 0.55, 0.6, 2.82, 1.45, z), bx(0x1e2226, 0.08, 0.5, 0.55, -2.82, 1.45, z));
    P.push(bx(0x6e6c64, 0.3, 0.12, 1.4, 2.85, 0.26, 0));
    P.push(cyl(0x2a2a26, 0.09, 1.2, 6, -1.4, 2.95, 0.9), bx(0x2a2a26, 0.26, 0.08, 0.26, -1.4, 3.58, 0.9));
    return P;
  },
  // workshop: a lean-to shed with a ribbed roof at the back, an A-frame hoist with an engine on the chain out front,
  // drums, tires and a bench inside
  motorpool: (f) => {
    const P = [], wood = 0x6e5a40, post = 0x4e3e2a, steel = 0x3a3a36, rib = darker(f.vehicle, 0.72), len = 3.75, tilt = Math.atan2(0.7, len);
    P.push(bx(0x75736b, 5.9, 0.12, 5.9, 0, 0.06, 0), bx(wood, 0.25, 2.5, 5.8, -2.8, 1.25, 0));
    for (const s of [-1, 1]) P.push(bx(wood, 3.3, 2.1, 0.2, -1.15, 1.05, s * 2.85), bx(post, 0.3, 3.2, 0.3, 0.5, 1.6, s * 2.65));
    P.push(bx(f.vehicle, len, 0.14, 6.0, -1.125, 2.9, 0, 0, 0, tilt), bx(f.color, 0.1, 0.26, 6.0, 0.78, 3.28, 0));
    for (let i = 0; i < 6; i++) P.push(bx(rib, len, 0.06, 0.1, -1.125, 2.99, -2.5 + i, 0, 0, tilt));
    for (const s of [-1, 1]) P.push(bx(steel, 0.14, 3.1, 0.14, 1.55, 1.55, s * 1.7, 0, 0, -0.2), bx(steel, 0.14, 3.1, 0.14, 2.25, 1.55, s * 1.7, 0, 0, 0.2));
    P.push(bx(steel, 0.22, 0.22, 3.8, 1.9, 3.08, 0), bx(0x24241f, 0.05, 1.3, 0.05, 1.9, 2.32, 0.3), bx(0x45453f, 0.8, 0.6, 0.9, 1.9, 1.4, 0.3), bx(0x2a2a26, 0.3, 0.3, 0.5, 1.9, 1.85, 0.3));
    P.push(bx(0x3a3a34, 1.1, 0.3, 0.7, 1.7, 0.27, -1.6), cyl(0x1c1c1a, 0.42, 0.24, 10, 2.3, 0.24, 2.2));
    for (let i = 0; i < 3; i++) P.push(cyl(0x3a4a30, 0.32, 0.92, 8, -2.25, 0.58, -2.2 + i * 0.68), cyl(0x1c1c1a, 0.42, 0.24, 10, -2.15, 0.25 + i * 0.25, 2.1));
    P.push(bx(wood, 0.7, 0.9, 1.8, -2.3, 0.51, 0.3), bx(steel, 0.25, 0.2, 0.25, -2.1, 1.06, 0.9));
    return P;
  },
  // supply dump: tarp-covered stack, crates, fuel drums (one lying down), jerry cans and a pennant
  depot: (f) => {
    const P = [], crate = 0x6e5836, tarp = 0x8a7d5a;
    P.push(bx(0x5a4a34, 3.8, 0.18, 3.8, 0, 0.09, 0), bx(tarp, 1.9, 1.1, 1.6, -0.75, 0.73, -0.8), part(GABLE, tarp, -0.75, 1.28, -0.8, 1.6, 1.0, 1.9, Math.PI / 2));
    P.push(bx(crate, 0.9, 0.7, 0.9, 0.95, 0.53, -1.05), bx(darker(crate, 0.85), 0.8, 0.6, 0.8, 0.9, 1.18, -1.0, 0.3), bx(crate, 0.6, 0.45, 0.6, 1.45, 0.4, 0.1));
    for (let i = 0; i < 5; i++) P.push(cyl(f.vehicle, 0.29, 0.88, 8, -1.45 + i * 0.62, 0.62, 1.2));
    P.push(cyl(f.vehicle, 0.29, 0.88, 8, 0.85, 0.47, 0.25, Math.PI / 2));
    for (let i = 0; i < 4; i++) P.push(bx(darker(f.vehicle, 0.8), 0.16, 0.46, 0.34, -1.5 + i * 0.2, 0.41, 0.2));
    P.push(cyl(0x4a3f30, 0.04, 3.2, 6, 1.65, 1.78, -1.65), bx(f.color, 0.9, 0.55, 0.04, 1.2, 3.05, -1.65));
    return P;
  },
  // command bunker: octagonal concrete blockhouse under a turf cap, firing slits to the front, steel door behind,
  // antenna and flag, a ring of sandbags with three gaps
  bunker: (f) => {
    const P = [], conc = 0x8f8d84, concD = 0x76746c, alpha = Math.atan2(0.45 * Math.cos(Math.PI / 8), 2.2);
    P.push(part(BUNKER.body, conc, 0, 1.1, 0, 1, 2.2, 1), part(BUNKER.slab, concD, 0, 2.37, 0, 1, 0.35, 1), part(BUNKER.turf, 0x66603f, 0, 2.77, 0, 1, 0.45, 1));
    for (const phi of [0, Math.PI / 4, -Math.PI / 4]) {
      const c = Math.cos(phi), s = Math.sin(phi);
      P.push(part(BOX, 0x14130f, c * 2.27, 1.5, s * 2.27, 0.14, 0.3, 1.25, -phi, 0, alpha), part(BOX, concD, c * 2.3, 1.78, s * 2.3, 0.35, 0.12, 1.45, -phi, 0, alpha));
    }
    P.push(part(BOX, concD, -2.36, 0.95, 0, 0.08, 1.95, 1.3, -Math.PI, 0, alpha), part(BOX, 0x3a3a36, -2.38, 0.95, 0, 0.1, 1.7, 1.0, -Math.PI, 0, alpha));
    P.push(cyl(0x2a2a26, 0.03, 3.2, 5, -1.0, 4.2, 1.1), cyl(0x4a3f30, 0.06, 3.6, 6, -1.8, 4.4, -1.8), bx(f.color, 1.6, 1.0, 0.05, -1.0, 5.6, -1.8));
    const d = Math.PI / 180;
    bagArcs(P, 4.6, [0, 1, 2].map(k => [(k * 120 + 15) * d, (k * 120 + 105) * d]), 0.85, 0.36, 0.5);
    return P;
  },
};
const MODEL_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const modelCache = new Map();
// a base building as a group holding one mesh (scale the group's y to raise a construction site)
export function buildingModel(type, f) {
  const key = `${type}:${f.vehicle}:${f.color}`;
  let geo = modelCache.get(key);
  if (!geo) modelCache.set(key, (geo = merge(MODELS[type](f))));
  const m = new THREE.Mesh(geo, MODEL_MAT), g = new THREE.Group();
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return g;
}
