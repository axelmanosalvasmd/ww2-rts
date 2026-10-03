// Miniature-model pieces for the map and the base buildings, in the painted sand-table style.
// Map pieces (timber sheds, brick and plaster houses, stone buildings, a church, barns, bocage banks, capped walls, sandbags, trenches, rubble, wire, tank traps,
// bridges) are rebuilt from the grid as one InstancedMesh per kind of piece, so the whole village costs a couple dozen
// draw calls. Every piece stands on the cells it represents; gameplay cells are never changed here.
// Base buildings (HQ, barracks, motor pool, depot, command bunker) are one merged, vertex-colored mesh per type and team.
import * as THREE from 'three';
import { CELL, houseKinds } from '../shared/sim.js';
import { surface, fogShader, fogged, loadTexture } from './surfaces.js';
import { leafGeometry, leafMaterial } from './foliage.js';
import { gfx } from './gfx.js';
import { TRENCH_DEPTH } from './relief.js';

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
  const geos = parts.map(({ geo, color, m, tex }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const n = g.attributes.position.count, c = Array.isArray(color) ? color : lin(color ?? 0xffffff), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // a base building part's surface id (see MODEL_MAT) rides in uv.x; other merged pieces keep their uv
    if (tex !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).map((_, i) => (i & 1 ? 0 : tex)), 2));
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
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
// a lumpy shrub: the shaded heart of a hedgerow stretch, mostly hidden by its leaf cards
const SHRUB = (() => {
  const g = new THREE.SphereGeometry(1, 6, 3), p = g.attributes.position;
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
// window on a wall facing +z: a shadowed reveal, a frame standing 5 cm proud of the wall, glass that catches a little
// sky at the top, glazing bars, a stone sill and (with shutters) a plank shutter folded back either side.
// The instance color is the house's trim color, so frames and shutters share one paint.
function windowGeo(shutters) {
  const parts = [
    part(QUAD, 0x24211e, 0, -0.01, 0.006, 0.84, 1.12, 1),
    part(FRONT, 0xf4eee2, 0, 0, 0.025, 0.74, 1.04, 0.05),
    part(QUAD, 0x161b20, 0, 0.0, 0.052, 0.58, 0.88, 1), part(QUAD, 0x3a444d, 0, 0.3, 0.053, 0.58, 0.28, 1),
    part(QUAD, 0xf4eee2, 0, 0.0, 0.055, 0.045, 0.88, 1), part(QUAD, 0xf4eee2, 0, 0.12, 0.055, 0.58, 0.045, 1),
    part(FRONT, 0xd8d0c0, 0, -0.56, 0.06, 0.9, 0.07, 0.13),
  ];
  if (shutters) for (const s of [-1, 1]) {
    parts.push(part(FRONT, 0xe8e0d0, s * 0.58, 0, 0.018, 0.36, 1.04, 0.035));
    for (const y of [-0.3, 0.3]) parts.push(part(QUAD, 0xb8b0a2, s * 0.58, y, 0.037, 0.32, 0.06, 1));
  }
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
  brick: { geo: BOX, mat: () => surface('brick'), pick: true },
  dark: { geo: BOX, mat: () => surface('darkwood') },
  gable: { geo: GABLE, mat: () => surface('plaster'), pick: true },
  gableWood: { geo: GABLE, mat: () => surface('wood'), pick: true },
  gableStone: { geo: GABLE, mat: () => surface('stone'), pick: true },
  gableBrick: { geo: GABLE, mat: () => surface('brick'), pick: true },
  roof: { geo: ROOF, mat: () => materials().roof, pick: true },
  spire: { geo: PYRAMID, mat: () => materials().slate, pick: true },
  window: { geo: WINDOW, mat: () => materials().glass, shadow: false, pick: true },
  pane: { geo: PANE, mat: () => materials().glass, shadow: false, pick: true },
  paint: { geo: BOX, mat: () => materials().paint, shadow: false, pick: true },
  broken: { geo: BROKEN, mat: () => surface('plaster') },
  brokenStone: { geo: BROKEN, mat: () => surface('stone') },
  brokenBrick: { geo: BROKEN, mat: () => surface('brick') },
  brokenWood: { geo: BROKEN, mat: () => surface('wood') },
  earth: { geo: MOUND, mat: () => surface('earth') },
  shrub: { geo: SHRUB, mat: () => surface('hedge') }, // the dense, shaded heart of a hedgerow shrub
  leaves: { geo: leafGeometry('hedge'), mat: leafMaterial }, // its ragged outside: leaf cards (client/foliage.js)
  bag: { geo: BAG, mat: () => surface('burlap'), lowShadow: false },
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
const STONE = [[1, 0.97, 0.9], [0.9, 0.88, 0.84], [1.06, 1, 0.88], [0.95, 0.9, 0.82]]; // stone buildings
const BRICK = [[1, 1, 1], [0.86, 0.8, 0.78], [1.1, 1, 0.86], [0.8, 0.72, 0.7], [1.05, 0.9, 0.84]];
const SLATE = [[0.6, 0.92, 1.6], [0.52, 0.8, 1.4], [0.66, 0.95, 1.5]]; // pulls the clay tile texture to blue-grey
const SHINGLE = [[0.6, 0.8, 1.15], [0.5, 0.68, 1.0], [0.68, 0.86, 1.2]]; // weathered grey shingles
const SHED = [[1.5, 1.32, 1.12], [1.25, 1.25, 1.25], [1.6, 1.0, 0.8], [1.3, 1.1, 0.85]]; // sun-bleached, greyed and red-ochre boards
const DRESSED = [0.78, 0.74, 0.64]; // smooth-cut stone: lintels and string courses
const BRICK_DUST = [1.12, 0.66, 0.52];
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
  // what each block is in the game (0 timber shed, 1 brick house, 2 stone building): the look follows it
  const types = houseKinds(Array.from(C.foot, f => (f ? 'B' : '.')), w, C.buildings);
  for (const r of rects) r.type = types[r.y0 * w + r.x0];
  if (rects.length >= 4) {
    // churches: the biggest long stone block, one more per 25 houses, at least 40 cells apart
    const want = 1 + Math.floor(rects.length / 25), churches = [];
    const cand = rects.filter(r => { const [s, l] = dims(r); return r.type === 2 && s >= 3 && s <= 4 && l > s; })
      .sort((a, b) => area(b) - area(a) || rnd(a.x0, a.y0, 7) - rnd(b.x0, b.y0, 7));
    for (const r of cand) {
      if (churches.length >= want) break;
      if (churches.every(c => Math.hypot(c.x0 - r.x0, c.y0 - r.y0) >= 40)) { r.kind = 'church'; churches.push(r); }
    }
  }
  // about half of the big timber blocks are barns, the rest big sheds
  for (const r of rects) if (r.type === 0 && dims(r)[0] >= 3 && rnd(r.x0, r.y0, 8) < 0.5) r.kind = 'barn';
  // a map's landmarks (CFG.houses 3 and 4): a church wears the church look, a factory a multi-storey block, both stone
  for (const r of rects) if (r.type > 2) { r.kind = r.type === 3 ? 'church' : 'block'; r.type = 2; }
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
      piece(C, alongX ? { x0: r.x0 + o, x1: r.x0 + o + k, y0: r.y0, y1: r.y1, kind: r.kind, type: r.type } : { x0: r.x0, x1: r.x1, y0: r.y0 + o, y1: r.y0 + o + k, kind: r.kind, type: r.type });
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
  const kind = r.kind ?? 'house', t = (k) => rnd(r.x0, r.y0, k), type = r.type ?? 1;
  const church = kind === 'church', barn = kind === 'barn', block = kind === 'block';
  // the game's three types read at a glance: timber (sheds and barns), brick or limewashed render under clay tiles
  // (houses), bare stone under slate (stone buildings, the church among them)
  const wood = type === 0, stone = type === 2, shed = wood && !barn, brick = type === 1 && !block && t(25) < 0.5;
  const storeys = church || wood ? 1 : block ? 2 + Math.floor(t(9) * 2) : stone || t(1) < 0.55 ? 2 : 1;
  return {
    kind, church, barn, block, storeys, t, wood, shed, stone, brick,
    H: church ? 6.2 : barn ? 4.4 + 0.6 * t(2) : shed ? 2.5 + 0.5 * t(2) : block ? storeys * 3.1 + 0.5 : storeys === 2 ? (stone ? 6.1 : 5.6) + 0.9 * t(2) : 3.6 + 0.8 * t(2),
    k: church ? 1.25 : barn ? 1.3 : shed ? 0.7 + 0.25 * t(10) : 0.85 + 0.3 * t(10), // roof pitch: ridge height = 0.4 * span * k
    tint: barn ? pick(BARN, t(4)) : shed ? pick(SHED, t(4)) : church ? [1.04, 1, 0.92] : stone ? pick(STONE, t(4)) : brick ? pick(BRICK, t(4)) : pick(PLASTER, t(4)),
    roof: wood ? pick(SHINGLE, t(5)) : stone ? pick(SLATE, t(5)) : pick(ROOFS, t(5)),
    trim: pick(TRIM, t(6)),
    shutters: type === 1 && !block && t(18) < (brick ? 0.5 : 0.7),
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
  for (const [x, y] of cells) C.tint.set(y * C.w + x, { color: sp.brick ? BRICK_DUST : sp.tint, wall: sp.tint, wood: sp.wood, stone: sp.stone, brick: sp.brick });
  const standing = cells.filter(([x, y]) => C.at(x, y) === 'B');
  if (!standing.length) return; // all rubble: rubble() draws it
  if (standing.length < cells.length) ruin(C, r, sp, standing);
  else house(C, r, sp);
}

const wallKind = (sp) => (sp.wood ? 'wood' : sp.stone ? 'stone' : sp.brick ? 'brick' : 'wall');
const jagKind = (sp) => (sp.wood ? 'brokenWood' : sp.stone ? 'brokenStone' : sp.brick ? 'brokenBrick' : 'broken');

// stone quoins up a rendered house's outside corners, blocks alternately long and short on each face; corners
// that meet a neighbour (terraces) get none
function quoins(C, r, F, H) {
  const { S, L, base, P } = F;
  for (const [ss, sa] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const [wx, wz] = F.at(ss * S / 2, sa * L / 2), gx = Math.round(wx / CELL), gz = Math.round(wz / CELL);
    let party = false;
    for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const x = gx + ox, y = gz + oz;
      if (!(x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) && C.isHouse(x, y)) party = true;
    }
    if (party) continue;
    for (let k = 0, y = base + 0.55; y < base + H - 0.3; k++, y += 0.44) {
      const ws = k & 1 ? 0.62 : 0.36, wa = k & 1 ? 0.36 : 0.62;
      P('stone', ss * (S / 2 - ws / 2 + 0.035), y + 0.2, sa * (L / 2 - wa / 2 + 0.035), ws, 0.4, wa, 1.12 + 0.12 * rnd(gx * 3 + k, gz, 160));
    }
  }
}

function house(C, r, sp) {
  const F = frame(C, r), { L, S, base, P } = F, { H, k, tint, t } = sp, oh = 0.35, ph = sp.shed ? 0.2 : 0.55;
  P(wallKind(sp), 0, base - 1 + (H + 1) / 2, 0, S, H + 1, L, tint);
  if (!sp.stone && !sp.wood) quoins(C, r, F, H);
  P('stone', 0, base - 1.55 + (ph + 1.55) / 2, 0, S + 0.14, ph + 1.55, L + 0.14, 0.85); // plinth, up to base + ph
  // a stone building's string courses: a dressed band between each pair of storeys
  if (sp.stone && !sp.church) for (let i = 1; i < sp.storeys; i++) P('paint', 0, sp.block ? base + 0.05 + i * 3.1 : base + H / 2 + 0.15, 0, S + 0.12, 0.2, L + 0.12, DRESSED);
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
    P(sp.wood ? 'gableWood' : sp.stone ? 'gableStone' : sp.brick ? 'gableBrick' : 'gable', 0, base + H, 0, S, S * k, L, tint);
    const W = S + 2 * oh;
    P('roof', 0, base + H - 0.8 * k * oh, 0, W, W * k, L + 2 * oh, sp.roof);
    if (!sp.church && !sp.wood && t(13) < 0.8) {
      const a = (t(14) < 0.5 ? -1 : 1) * Math.max(0, L / 2 - 0.9), s = (t(15) < 0.5 ? -1 : 1) * 0.22 * S;
      const top = base + H + 0.4 * k * (S - 2 * Math.abs(s)) + 1.0 + 0.3 * t(16), bot = base + H - 0.3;
      P(sp.brick ? 'brick' : 'stone', s, (top + bot) / 2, a, 0.6, top - bot, 0.75, sp.brick ? mul(tint, 0.9) : 0.8);
      P('stone', s, top + 0.06, a, 0.78, 0.12, 0.92, 0.5);
      for (const d of t(16) < 0.5 ? [0] : [-0.18, 0.18]) P('paint', s, top + 0.27, a + d, 0.16, 0.3, 0.16, lin(0x7a4a36)); // clay pots
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
  if (sp.shed) return shed(C, F, sp, list);
  // windows on every open bay and storey, a door on a long side
  const longs = list.filter(b => b.long), door = !sp.block && longs.length ? longs[Math.floor(t(17) * longs.length)] : null;
  for (const b of list) for (let i = 0; i < sp.storeys; i++) {
    if (b === door && i === 0) continue;
    if (rnd(b.x * 3 + b.dx, b.y * 3 + b.dy, 30 + i) < 0.15) continue; // a few blank bays
    const y = sp.block ? base + 1.6 + i * 3.1 : i === 0 ? base + 1.6 : base + H - 1.45;
    windowAt(sp.shutters ? 'window' : 'pane', b, y, sp.trim);
    // bare masonry gets a dressed stone lintel over each window
    if (sp.stone || sp.brick) put('paint', b.px + b.dx * 0.02, y + 0.63, b.pz + b.dy * 0.02, 1.02, 0.2, 0.12, yawOf(b.dx, b.dy), DRESSED);
  }
  if (door) {
    const yd = yawOf(door.dx, door.dy), g = Math.max(base, C.hAt(door.px + door.dx * 0.4, door.pz + door.dy * 0.4));
    put('paint', door.px, g + 1.05, door.pz, 1.0, 2.0, 0.08, yd, mul(sp.trim, 0.75));
    put('paint', door.px + door.dx * 0.045, g + 1.05, door.pz + door.dy * 0.045, 0.05, 1.96, 0.02, yd, mul(sp.trim, 0.45)); // the leaves' meeting line
    for (const s of [-1, 1]) put('stone', door.px - door.dy * s * 0.58, g + 1.05, door.pz + door.dx * s * 0.58, 0.16, 2.1, 0.16, yd, 1.05);
    put('stone', door.px, g + 2.16, door.pz, 1.32, 0.18, 0.18, yd, 1.05);
    put('stone', door.px + door.dx * 0.3, g + 0.06, door.pz + door.dy * 0.3, 1.4, 0.3, 0.6, yd, 0.9);
  }
}

// a timber shed's trim: tarred corner posts and wall plates, a ledged and braced plank door, the odd small window
function shed(C, F, sp, list) {
  const { L, S, base, P } = F, { H, t } = sp, pale = [1.25, 1.15, 1];
  for (const s of [-1, 1]) {
    for (const a of [-1, 1]) P('dark', s * (S / 2 - 0.04), base + H / 2, a * (L / 2 - 0.04), 0.2, H, 0.2, 0.8);
    P('dark', s * (S / 2 + 0.01), base + H - 0.11, 0, 0.14, 0.22, L + 0.1, 0.8);
  }
  const door = list[Math.floor(t(17) * list.length)];
  for (const b of list) if (b !== door && b.long && rnd(b.x * 3 + b.dx, b.y * 3 + b.dy, 30) < 0.4) windowAt('pane', b, base + H - 1.0, lin(0x5a4a3a), 0.8, 0.6);
  if (!door) return;
  const yd = yawOf(door.dx, door.dy), g = Math.max(base, C.hAt(door.px + door.dx * 0.4, door.pz + door.dy * 0.4)), dh = Math.min(1.9, H - 0.45);
  const x = door.px + door.dx * 0.03, z = door.pz + door.dy * 0.03, bx = door.px + door.dx * 0.07, bz = door.pz + door.dy * 0.07;
  put('dark', x, g + 0.05 + dh / 2, z, 0.95, dh, 0.08, yd, 0.7);
  for (const y of [0.3, dh - 0.25]) put('wood', bx, g + 0.05 + y, bz, 0.95, 0.12, 0.06, yd, pale);
  put('wood', bx, g + 0.05 + dh / 2, bz, Math.hypot(0.85, dh - 0.55), 0.11, 0.05, yd, pale, 0, Math.atan2(dh - 0.55, 0.85));
}

// a house with fallen cells: standing cells keep jagged stubs and dropped slabs, not a shorter copy of the building
function ruin(C, r, sp, standing) {
  const keep = new Set(standing.map(([x, y]) => y * C.w + x));
  const jag = jagKind(sp), tint = sp.tint;
  for (const [x, y] of standing) {
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = C.hAt(cx, cz);
    const piles = 2 + (rnd(x, y, 40) < 0.45 ? 1 : 0);
    for (let k = 0; k < piles; k++) {
      const ang = rnd(x, y, 41 + k) * 6.2832;
      const rad = CELL * (0.08 + 0.48 * rnd(x, y, 46 + k));
      const len = 0.55 + 1.15 * rnd(x, y, 52 + k);
      const ht = 0.35 + Math.min(2.4, sp.H) * (0.12 + 0.38 * rnd(x, y, 58 + k));
      const yaw = ang + (rnd(x, y, 64 + k) - 0.5) * 0.8;
      put(jag, cx + Math.cos(ang) * rad, g - 0.12, cz + Math.sin(ang) * rad, len, ht, 0.26 + 0.12 * rnd(x, y, 70 + k), yaw, tint, (rnd(x, y, 74 + k) - 0.5) * 0.35, (rnd(x, y, 78 + k) - 0.5) * 0.25);
    }
    if (rnd(x, y, 82) < 0.7) {
      const ang = rnd(x, y, 83) * 6.2832;
      const rad = CELL * (0.1 + 0.4 * rnd(x, y, 84));
      const s = 0.35 + 0.55 * rnd(x, y, 85);
      put('chunk', cx + Math.cos(ang) * rad, g + s * 0.15, cz + Math.sin(ang) * rad, s * 1.3, s * 0.55, s, rnd(x, y, 86) * 6.28, tint, (rnd(x, y, 87) - 0.5) * 0.5, (rnd(x, y, 88) - 0.5) * 0.4);
    }
    DIR4.forEach(([dx, dy], i) => {
      const nx = x + dx, ny = y + dy;
      if (keep.has(ny * C.w + nx)) return;
      if (rnd(x, y, 90 + i) < 0.42) return;
      const slide = (rnd(x, y, 96 + i) - 0.5) * CELL * 0.55;
      const out = CELL * (0.28 + 0.28 * rnd(x, y, 102 + i));
      const len = 0.45 + 0.95 * rnd(x, y, 108 + i);
      const ht = 0.4 + 1.5 * rnd(x, y, 114 + i);
      const yaw = yawOf(dx, dy) + (rnd(x, y, 120 + i) - 0.5) * 0.9;
      put(jag, cx + dx * out - dy * slide, g - 0.1, cz + dy * out + dx * slide, len, ht, 0.28, yaw, tint, (rnd(x, y, 126 + i) - 0.5) * 0.2, 0);
    });
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
      if (rnd(x, y, k + 3) < 0.22) continue;
      const ang = rnd(x, y, k + 5) * 6.2832, rad = CELL * 0.62 * rnd(x, y, k + 7);
      const s = 0.4 + 0.7 * rnd(x, y, k), c = rnd(x, y, k + 17);
      const tint = house && c < 0.5 ? (house.wood ? mul(house.color, 0.6) : house.color) : c < 0.78 ? [0.95, 0.93, 0.9] : [1.12, 0.66, 0.52];
      put('chunk', cx + Math.cos(ang) * rad, g + s * 0.12, cz + Math.sin(ang) * rad,
        s * (1 + 0.4 * rnd(x, y, k + 21)), s * (0.45 + 0.3 * rnd(x, y, k + 25)), s * (0.9 + 0.4 * rnd(x, y, k + 29)),
        rnd(x, y, k + 33) * 6.28, tint, (rnd(x, y, k + 37) - 0.5) * 0.6, (rnd(x, y, k + 41) - 0.5) * 0.6);
    }
    // a slab thrown clear of the cell, so the pile is not a square of chunks
    if (!low && rnd(x, y, 48) < 0.75) {
      const ang = rnd(x, y, 49) * 6.2832, rad = CELL * (0.48 + 0.32 * rnd(x, y, 50));
      const len = 0.7 + 1.1 * rnd(x, y, 51), ht = 0.25 + 0.55 * rnd(x, y, 52);
      const jag = house ? (house.wood ? 'brokenWood' : house.stone ? 'brokenStone' : house.brick ? 'brokenBrick' : 'broken') : 'broken';
      const tint = house ? (house.wood ? mul(house.color, 0.7) : house.color) : [0.95, 0.93, 0.9];
      put(jag, cx + Math.cos(ang) * rad, g - 0.05, cz + Math.sin(ang) * rad, len, ht, 0.22, ang + (rnd(x, y, 53) - 0.5) * 0.8, tint, (rnd(x, y, 54) - 0.5) * 0.5, (rnd(x, y, 55) - 0.5) * 0.3);
    }
    // short stubs on the outside edges, often skipped, yawed and slid so they do not draw the cell square
    DIR4.forEach(([dx, dy], i) => {
      const nb = at(x + dx, y + dy);
      if (nb === 'R' || nb === 'B' || nb === 'K' || rnd(x, y, 50 + i) > (house ? 0.34 : 0.18)) return;
      const slide = (rnd(x, y, 62 + i) - 0.5) * CELL * 0.7;
      const out = CELL * (0.35 + 0.28 * rnd(x, y, 66 + i));
      const len = 0.55 + 0.9 * rnd(x, y, 54 + i), ht = house ? 0.45 + 0.9 * rnd(x, y, 58 + i) : 0.3 + 0.45 * rnd(x, y, 58 + i);
      const stone = !house || house.stone;
      put(stone ? 'brokenStone' : house.wood ? 'brokenWood' : house.brick ? 'brokenBrick' : 'broken',
        cx + dx * out - dy * slide, g - 0.08, cz + dy * out + dx * slide, len, ht, 0.28,
        yawOf(dx, dy) + (rnd(x, y, 70 + i) - 0.5) * 0.8, stone ? 0.95 : house.wall, (rnd(x, y, 74 + i) - 0.5) * 0.25, 0);
    });
  }
}

// ---------- hedgerows: bocage earth banks topped with shrubs (still tall enough to block sight) ----------
function hedges(C) {
  const { w, h, at, hAt, low } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'H') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), r1 = rnd(x, y, 80), hb = 0.85 + 0.25 * r1;
    // a shot-up hedge loses its shrubs first, then the bank slumps
    const hurt = C.stage(x, y), bank = hb * [1, 0.85, 0.6][hurt];
    put('earth', cx, g - 0.1, cz, 2.4, bank, 2.4, r1 * 6.28, [0.78, 0.9, 0.6]);
    const ex = at(x - 1, y) === 'H' || at(x + 1, y) === 'H', ez = at(x, y - 1) === 'H' || at(x, y + 1) === 'H';
    const alongX = ex !== ez ? ex : rnd(x, y, 81) < 0.5, top = g - 0.1 + bank, n = hurt === 2 ? 0 : hurt === 1 || low ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const o = n === 1 ? 0 : (i ? 0.5 : -0.5) + (rnd(x, y, 82 + i) - 0.5) * 0.3, side = (rnd(x, y, 84 + i) - 0.5) * 0.2;
      const rr = (low ? 1.0 : 0.8) + 0.2 * rnd(x, y, 86 + i), wide = low ? 1.15 : 1, v = rnd(x, y, 88 + i);
      const sx = alongX ? cx + o : cx + side, sy = top + rr * 0.3, sz = alongX ? cz + side : cz + o;
      const tint = [0.88 + 0.2 * v, 0.95 + 0.15 * rnd(x, y, 90 + i), 0.85 + 0.15 * v];
      // the leaf cards run along the hedge (their local x), so neighbouring stretches close into one wall
      const yaw = (alongX ? 0 : Math.PI / 2) + (v < 0.5 ? Math.PI : 0) + (v - 0.5) * 0.3;
      put('shrub', sx, sy - rr * 0.1, sz, rr * wide * 0.82, rr * 0.75, rr * wide * 0.82, v * 6.28, mul(tint, 0.75));
      put('leaves', sx, sy, sz, rr * (0.9 + 0.3 * v), rr * (0.85 + 0.35 * rnd(x, y, 92 + i)), rr * wide, yaw, mul(tint, 0.95));
    }
  }
}

// ---------- walls: '#' from the map is a capped stone wall, '#' built in play is a sandbag wall ----------
const WT = 0.55, WH = 1.0, SINK = 0.3;
function placePiece(...piece) { put(...piece); } // the module's put, for stoneWall, which wraps it under the same name
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
  // a shot-up wall stands lower, and loses its capstones when it is nearly gone
  const hurt = C.stage(x, y), k = [1, 0.74, 0.48][hurt], whole = placePiece;
  const put = hurt ? (kind, px, py, pz, sx, sy, sz, ...rest) => { if (sy !== 0.13) whole(kind, px, y0 + (py - y0) * k, pz, sx, sy * k, sz, ...rest); else if (hurt < 2) whole(kind, px, y0 + (py - y0) * k, pz, sx, sy, sz, ...rest); } : whole;
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
    for (let c = 0; c < 3 - C.stage(x, y); c++) { // a shot-up sandbag wall has lost its top courses
      const at = c === 1 ? (owns ? [0.5, 1] : [0.5]) : [0.25, 0.75], rows = c === 0 ? [-0.2, 0.2] : [0];
      for (const f of at) for (const off of rows) bags(x, y, k++, cx + ux * f * L - uz * off, g + 0.14 + c * 0.25, cz + uz * f * L + ux * off, yaw, len);
    }
  }
  // the middle of the cell, under the second course
  const [dx, dy] = dirs[0];
  if (C.stage(x, y) < 2) bags(x, y, k++, cx, g + 0.39, cz, yawOf(dx, dy) + Math.PI / 2);
}

// ---------- trenches: timber revetments, posts, duckboards, spoil parapets; MG nests get an inner ring of bags ----------
function trenches(C) {
  const { w, h, at, hAt, low } = C;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'T') continue;
    // g is the carved floor (client/relief.js), top the ground at the lip; the revetments line the walls between them
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), top = g + TRENCH_DEPTH, wall = (g + top) / 2, conn = DIR4.map(([dx, dy]) => at(x + dx, y + dy) === 'T');
    DIR4.forEach(([dx, dy], i) => {
      const yaw = yawOf(dx, dy);
      if (conn[i]) {
        // the channel runs on: line both sides to the cell edge, boards along the floor
        for (const s of [-1, 1]) put('wood', cx + dx * 0.75 - dy * s * 0.5, wall, cz + dy * 0.75 + dx * s * 0.5, 0.08, TRENCH_DEPTH + 0.2, 0.5, yaw, 0.9);
        if (!low) put('duck', cx + dx * 0.5, g + 0.19, cz + dy * 0.5, 1, 1, 1, yaw + Math.PI / 2);
      } else {
        put('wood', cx + dx * 0.5, wall, cz + dy * 0.5, 1.08, TRENCH_DEPTH + 0.2, 0.08, yaw, 0.9);
        if (at(x + dx, y + dy) !== '#') put('earth', cx + dx * 0.88, top - 0.1, cz + dy * 0.88, 2.1, 0.5, 0.7, yaw, [0.95, 0.88, 0.78]);
      }
    });
    for (const [sx, sz] of DIAG) put('dark', cx + sx * 0.5, wall + 0.1, cz + sz * 0.5, 0.12, TRENCH_DEPTH + 0.4, 0.12, 0, 0.8);
    if (conn.some(Boolean)) continue;
    if (!low) put('duck', cx, g + 0.19, cz, 0.8, 1, 1, rnd(x, y, 120) < 0.5 ? 0 : Math.PI / 2);
    // a lone pit with sandbags around it is an MG nest: low ring of bags round its front and sides, ammo boxes behind
    let fx = 0, fz = 0, n = 0;
    for (const [dx, dy] of [...DIR4, ...DIAG]) if (at(x + dx, y + dy) === '#') { fx += dx; fz += dy; n++; }
    if (n < 3) continue;
    const a0 = fx || fz ? Math.atan2(fz, fx) : 0;
    for (let c = 0; c < 2; c++) for (let i = -3; i <= 3 - c; i++) {
      const a = a0 + i * 0.5 + c * 0.25;
      bags(x, y, 200 + c * 10 + i, cx + Math.cos(a) * 0.82, top + 0.1 + c * 0.25, cz + Math.sin(a) * 0.82, -a + Math.PI / 2, 0.5);
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

// ---------- Field Hospital: a white ridge tent with a red cross on a board over the ridge ----------
function hospitals(C) {
  const { w, h, at, hAt } = C, canvas = [1.25, 1.22, 1.12], red = [0.9, 0.12, 0.1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== 'A') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz);
    put('wall', cx, g + 0.45, cz, 1.9, 0.9, 1.9, 0, canvas);
    put('gable', cx, g + 0.9, cz, 1.9, 2.5, 1.9, 0, canvas);
    put('dark', cx, g + 1.5, cz, 0.08, 3, 0.08);
    put('paint', cx, g + 2.6, cz, 0.9, 0.9, 0.06, 0, [1.3, 1.3, 1.25]);
    for (const s of [-1, 1]) { put('paint', cx, g + 2.6, cz + s * 0.04, 0.62, 0.18, 0.02, 0, red); put('paint', cx, g + 2.6, cz + s * 0.04, 0.18, 0.62, 0.02, 0, red); }
  }
}

// ---------- bridges: plank deck, edge beams, railings and stone cutwaters on the water sides ----------
function bridges(C) {
  const { w, h, at, hAt } = C;
  // stone bridges (map.buildings): the whole span the entry sits on gets a stone deck
  const stone = new Set(), q = (C.buildings ?? []).filter(b => b.kind === 'stone bridge' && at(b.x, b.y) === '=').map(b => [b.x, b.y]);
  for (const [x, y] of q) stone.add(y * w + x);
  for (const [x, y] of q) for (const [dx, dy] of DIR4) {
    const k = (y + dy) * w + x + dx;
    if (!stone.has(k) && at(x + dx, y + dy) === '=') { stone.add(k); q.push([x + dx, y + dy]); }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== '=') continue;
    const cx = (x + 0.5) * CELL, cz = (y + 0.5) * CELL, g = hAt(cx, cz), top = g + 0.22;
    put(stone.has(y * w + x) ? 'stone' : 'wood', cx, top - 0.15, cz, CELL, 0.3, CELL, 0, 1);
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
  const { group, grid, orig, hAt, cells, buildings } = state, h = grid.length, w = grid[0]?.length ?? 0;
  clearGroup(group);
  // stage: 0 whole, 1 damaged, 2 nearly gone (bits 3-4 of the cell state the server sends)
  const C = { grid, orig, hAt, w, h, buildings, low: gfx.low, at: (x, y) => grid[y]?.[x], tint: new Map(), stage: (x, y) => (cells ? cells[y * w + x] >> 3 & 3 : 0) };
  houses(C); rubble(C); hedges(C); walls(C); trenches(C); wire(C); traps(C); mines(C); hospitals(C); bridges(C);
  flush(group, C.low);
}
// group: emptied and refilled; grid: current rows (arrays of chars); orig: the map file's rows; hAt(x, z): ground height;
// cells: the per-cell state bytes, if any; buildings: the map's named buildings (map.buildings)
export function buildStructures(group, grid, orig, hAt, cells, buildings) {
  if (state && state.group !== group) clearGroup(state.group);
  state = { group, grid, orig, hAt, cells, buildings };
  rebuild();
}
gfx.onChange(() => { if (state?.group.parent) rebuild(); });

// HQ ring: real-size rounded sandbags (about 0.8 m long) in three staggered courses, two rows deep at the bottom,
// with exits at the four quarter points (one InstancedMesh)
export function sandbagRing(radius) {
  const list = [], L = 0.8, H = 0.24;
  for (let k = 0; k < 4; k++) {
    const a0 = (k * 9 + 1.56) / 36 * Math.PI * 2, a1 = (k * 9 + 8.44) / 36 * Math.PI * 2, n = Math.round((a1 - a0) * radius / L);
    for (let c = 0; c < 3; c++) for (const off of c < 2 ? [-0.23, 0.23] : [0]) for (let i = 0; i < n - (c & 1); i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + (c & 1) * 0.5) / n, r = radius + off - c * 0.04, j = rnd(i, k * 7 + c * 3 + off, 150);
      list.push([Math.cos(a) * r, H * 0.48 + c * H * 0.9, Math.sin(a) * r, L * (0.94 + 0.1 * j), H, 0.44, -a + Math.PI / 2 + (j - 0.5) * 0.12, pick(BAG_TINTS, j)]);
    }
  }
  const im = new THREE.InstancedMesh(BAG, surface('burlap'), list.length), col = new THREE.Color();
  list.forEach(([x, y, z, sx, sy, sz, ry, c], i) => { im.setMatrixAt(i, compose(TMP, x, y, z, sx, sy, sz, ry)); im.setColorAt(i, col.setRGB(...c)); });
  im.castShadow = im.receiveShadow = true;
  return im;
}

// ---------- the HQ camp: a command tent, crates, a field table and the flagpole ----------
// A sheet of canvas over a grid of points (rows of columns), flat-shaded; each triangle faces away from inside.
function sheet(rows, inside) {
  const pos = [], ab = new THREE.Vector3(), ac = new THREE.Vector3(), mid = new THREE.Vector3();
  const tri = (p, q, r) => {
    ab.subVectors(q, p); ac.subVectors(r, p); mid.copy(p).add(q).add(r).divideScalar(3).sub(inside);
    for (const v of ab.cross(ac).dot(mid) < 0 ? [p, r, q] : [p, q, r]) pos.push(v.x, v.y, v.z);
  };
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < rows[i].length; j++) {
    tri(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1]); tri(rows[i][j], rows[i + 1][j + 1], rows[i + 1][j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// a wall tent about 4.9 m by 6.5 m: 1.7 m side walls, a ridge at 3.2 m, canvas sagging between the poles, a fly
// overhanging the walls, an open door with its flaps tied back at the +z end and a stovepipe through the roof
function wallTent() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z), W = 2.4, Wb = 2.5, Hw = 1.7, Hr = 3.2, Lh = 3.25, e = 0.32;
  const inside = V(0, 1.2, 0), canvas = [], grid = (nu, nv, at) => Array.from({ length: nv + 1 }, (_, i) => Array.from({ length: nu + 1 }, (_, j) => at(j / nu, i / nv)));
  for (const s of [-1, 1]) {
    // roof: eave to ridge, sagging between the three ridge poles
    canvas.push(sheet(grid(8, 3, (u, v) => {
      const sag = 0.1 * Math.sin(Math.PI * v) * Math.abs(Math.sin(2 * Math.PI * u));
      return V(s * (W + e) * (1 - v), Hw - 0.16 + (Hr - Hw + 0.16) * v - sag, (u - 0.5) * (2 * Lh + 0.2));
    }), inside));
    // the fly's hem hanging past the eave, and the side wall staked out a little at its foot
    canvas.push(sheet(grid(8, 1, (u, v) => V(s * (W + e), Hw - 0.16 - 0.2 * v, (u - 0.5) * (2 * Lh + 0.2))), inside));
    canvas.push(sheet(grid(4, 1, (u, v) => V(s * (Wb - (Wb - W) * v + 0.03 * Math.sin(Math.PI * u * 2) ** 2), Hw * v, (u - 0.5) * 2 * Lh)), inside));
  }
  for (const z of [-Lh, Lh]) {
    // gable ends: the wall up to the eaves, then the triangle to the ridge
    canvas.push(sheet([[V(-Wb, 0, z), V(0, 0, z), V(Wb, 0, z)], [V(-W, Hw, z), V(0, Hw, z), V(W, Hw, z)]], inside));
    canvas.push(sheet([[V(-W, Hw, z), V(W, Hw, z)], [V(-0.01, Hr, z), V(0.01, Hr, z)]], inside));
  }
  // door flaps tied back either side of the opening
  for (const s of [-1, 1]) canvas.push(sheet([[V(s * 0.55, 0.02, Lh + 0.02), V(s * 0.95, 0.02, Lh + 0.1)], [V(s * 0.5, 1.95, Lh + 0.02), V(s * 0.75, 1.9, Lh + 0.08)]], V(0, 1, Lh - 1)));
  return { canvas, door: { W, Hw, Hr, Lh, e } };
}

const campCache = new Map();
// an HQ's dressing as a group of three merged meshes (canvas, timber, poles and rope); tent: false leaves only the
// flagpole (Classic, where the HQ is a building). The flag itself is main.js's.
export function hqCamp(f, tent = true) {
  const key = `${f.vehicle}:${tent}`;
  let geos = campCache.get(key);
  if (!geos) {
    const cloth = [], timber = [], rope = [], tint = lin(f.vehicle).map((v, i) => Math.max(0.55, Math.min(2.2, v / lin(0x59623d)[i])));
    const V = (x, y, z) => new THREE.Vector3(x, y, z), line = (a, b, t = 0.025) => { bar(rope, a, b, t); rope[rope.length - 1].color = [1.5, 1.4, 1.15]; };
    const box = (list, c, sx, sy, sz, x, y, z, ry = 0, rx = 0, rz = 0) => list.push(part(BOX, c, x, y, z, sx, sy, sz, ry, rx, rz));
    const pole = (list, c, r, h, x, y, z, rx = 0, rz = 0) => list.push(cyl(c, r, h, 6, x, y, z, rx, rz));
    // flagpole: a 15 m mast with a brass ball, three guy wires to stakes
    pole(rope, [1.1, 1.05, 1], 0.075, 15.2, 0, 7.6, 0);
    rope.push(part(new THREE.IcosahedronGeometry(0.13, 1), [2.2, 1.7, 0.9], 0, 15.25, 0));
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + 0.4, sx = Math.cos(a) * 4.2, sz = Math.sin(a) * 4.2;
      line(V(0, 9.5, 0), V(sx, 0.05, sz), 0.018); box(timber, [0.8, 0.8, 0.8], 0.06, 0.4, 0.06, sx, 0.12, sz, 0, 0.3);
    }
    if (tent) {
      const ox = -4, oz = -3, { canvas, door: { W, Hw, Hr, Lh, e } } = wallTent();
      for (const g of canvas) cloth.push(part(g, tint, ox, 0, oz));
      // the door opening, dark inside, and the ridge pole ends and spikes over each end
      box(timber, [0.12, 0.11, 0.1], 1.0, 1.92, 0.02, ox, 0.96, oz + Lh + 0.015);
      for (const s of [-1, 1]) {
        pole(rope, 1, 0.05, 0.35, ox, Hr + 0.12, oz + s * (Lh + 0.02));
        pole(rope, 1, 0.045, Hr, ox, Hr / 2, oz + s * (Lh + 0.03));
        // guy lines from the eaves and the pole tops out to stakes
        for (const z of [-Lh, -Lh / 3, Lh / 3, Lh]) {
          const a = V(ox + s * (W + e), Hw - 0.17, oz + z), b = V(ox + s * (W + e + 1.5), 0.05, oz + z * 1.08);
          line(a, b); box(timber, [0.9, 0.85, 0.75], 0.05, 0.32, 0.05, b.x, 0.1, b.z, 0, 0, s * 0.35);
        }
        line(V(ox, Hr + 0.25, oz + s * Lh), V(ox, 0.05, oz + s * (Lh + 2.2)));
        box(timber, [0.9, 0.85, 0.75], 0.05, 0.32, 0.05, ox, 0.1, oz + s * (Lh + 2.2), 0, -s * 0.35);
      }
      // stovepipe through the roof
      pole(rope, [0.45, 0.45, 0.48], 0.07, 1.4, ox - 1.1, Hr - 0.15, oz - 1.2);
      pole(rope, [0.4, 0.4, 0.42], 0.13, 0.08, ox - 1.1, Hr + 0.58, oz - 1.2);
      // crates stacked by the door and by the flag, a drum, jerricans, a field table with a map
      const crate = [0.82, 0.8, 0.66], olive = mul(tint, 0.62);
      for (const [x, z, ry, y] of [[-1.3, 0.9, 0.1, 0], [-1.25, 1.55, -0.05, 0], [-1.3, 1.22, 0.3, 0.5]]) {
        box(timber, crate, 0.92, 0.5, 0.56, x, 0.25 + y, z, ry); box(timber, mul(crate, 1.12), 0.96, 0.04, 0.6, x, 0.52 + y, z, ry);
      }
      for (const [x, z, ry, y] of [[3.1, -4.9, 0.2, 0], [3.3, -4.25, 0.15, 0], [4.05, -4.6, -0.3, 0], [3.25, -4.6, 0.6, 0.5]]) {
        box(timber, olive, 0.95, 0.48, 0.5, x, 0.24 + y, z, ry);
        for (const d of [-0.3, 0.3]) box(timber, mul(olive, 0.7), 0.05, 0.49, 0.52, x + d * Math.cos(ry), 0.24 + y, z - d * Math.sin(ry), ry);
      }
      timber.push(cyl([0.42, 0.46, 0.34], 0.29, 0.88, 12, 4.6, 0.44, -3.7));
      for (let i = 0; i < 3; i++) box(timber, olive, 0.17, 0.46, 0.34, 4.45 + i * 0.2, 0.23, -5.2, 0.1);
      box(timber, [0.75, 0.7, 0.6], 1.6, 0.05, 0.85, -1.6, 0.76, 2.4, 0.2);
      box(timber, [1.25, 1.2, 1.05], 0.7, 0.012, 0.5, -1.6, 0.79, 2.4, 0.35);
      for (const [dx, dz] of [[-0.72, -0.36], [0.72, -0.36], [-0.72, 0.36], [0.72, 0.36]]) {
        const c = Math.cos(0.2), sn = Math.sin(0.2);
        box(timber, [0.6, 0.56, 0.5], 0.05, 0.74, 0.05, -1.6 + dx * c + dz * sn, 0.37, 2.4 - dx * sn + dz * c);
      }
    }
    geos = { cloth: cloth.length ? merge(cloth) : null, timber: merge(timber), rope: merge(rope) };
    campCache.set(key, geos);
  }
  const g = new THREE.Group();
  for (const [name, mat] of [['cloth', () => surface('canvas', true)], ['timber', () => surface('wood', true)], ['rope', () => surface('darkwood', true)]]) {
    if (!geos[name]) continue;
    const m = new THREE.Mesh(geos[name], mat());
    m.castShadow = m.receiveShadow = true; m.name = `hq-${name}`;
    g.add(m);
  }
  return g;
}

// ---------- base buildings (front faces +x) ----------
const CYL = {};
const bx = (c, sx, sy, sz, x, y, z, ry = 0, rx = 0, rz = 0) => part(BOX, c, x, y, z, sx, sy, sz, ry, rx, rz);
const cyl = (c, r, h, seg, x, y, z, rx = 0, rz = 0) => part((CYL[seg] ??= new THREE.CylinderGeometry(1, 1, 1, seg)), c, x, y, z, r, h, r, 0, rx, rz);
const darker = (hex, k) => mul(lin(hex), k);
// half cylinder along x, radius 1, length 1, the round side up (open: shell; closed: end wall)
const half = (open) => new THREE.CylinderGeometry(1, 1, 1, 12, 1, open, -Math.PI / 2, Math.PI).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
const HALF = half(true), HALF_END = half(false);
const TYRE = new THREE.TorusGeometry(0.32, 0.1, 4, 10).rotateX(Math.PI / 2);
const oct = (top, bottom) => flat(new THREE.CylinderGeometry(top, bottom, 1, 8, 1).rotateY(Math.PI / 8));
const BUNKER = { body: oct(2.3, 2.75), slab: oct(2.6, 2.6), turf: oct(1.5, 2.35) };
const SANDBAG = 0x9c8a60;
// surfaces for base building parts, drawn from one packed detail texture (client/textures/detail.jpg)
const CANVAS = 1, TIMBER = 2, CONCRETE = 3, SHEET_X = 4, BURLAP = 5, SHEET_Z = 6;
const tx = (tex, ...parts) => parts.map(p => Object.assign(p, { tex }));
const bagTint = (k) => mul(lin(SANDBAG), 0.9 + 0.2 * rnd(k, 3, 160));
// A framed opening facing +x. The recess stays dark while the timber edges catch the sun.
function framedOpening(P, x, y, z, width, height, trim, yaw = 0, door = false) {
  const add = (c, dx, dy, dz, sx, sy, sz, tex = TIMBER) => {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    P.push(...tx(tex, bx(c, sx, sy, sz, x + dx * co + dz * si, y + dy, z - dx * si + dz * co, yaw)));
  };
  for (const s of [-1, 1]) add(trim, 0.035, 0, s * (width / 2 + 0.04), 0.09, height + 0.16, 0.08);
  add(trim, 0.04, height / 2 + 0.05, 0, 0.12, 0.1, width + 0.18);
  add(darker(trim, 0.8), 0.065, -height / 2 - 0.02, 0, door ? 0.24 : 0.16, 0.07, width + 0.2);
  if (door) {
    for (const dy of [-height * 0.25, height * 0.25]) add(darker(trim, 0.85), 0.06, dy, 0, 0.035, 0.07, width * 0.85);
    add(0x706c5c, 0.09, -0.1, -width * 0.32, 0.055, 0.08, 0.045, 0);
  } else {
    add(trim, 0.05, 0, 0, 0.04, height, 0.045);
    add(0x61727b, 0.012, height * 0.25, 0, 0.025, height * 0.35, width * 0.88, 0);
  }
}
// a ring of rounded bags in arcs [from, to] (radians), two courses with the bottom two rows deep
function bagArcs(P, radius, arcs, len, ht, depth) {
  arcs.forEach(([a0, a1], k) => {
    const n = Math.max(2, Math.round((a1 - a0) * radius / len));
    for (let c = 0; c < 2; c++) for (const off of c ? [0] : [-depth * 0.45, depth * 0.45]) for (let i = 0; i < n - c; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + c * 0.5) / n, r = radius + off;
      P.push(...tx(BURLAP, part(BAG, bagTint(k * 31 + c * 7 + i + off), Math.cos(a) * r, ht / 2 + c * ht * 0.9, Math.sin(a) * r, len, ht, depth, -a + Math.PI / 2)));
    }
  });
}

const MODELS = {
  // command post: log blockhouse with a hipped roof, sandbagged door, radio mast and a flag
  hq: (f) => {
    const P = [], logs = 0x5e4a32, post = 0x3a2e20, slit = 0x16140f;
    P.push(...tx(TIMBER, bx(0x5e5038, 5.9, 0.16, 5.9, 0, 0.08, 0), bx(0x7a6446, 4.4, 2.5, 4.4, 0, 1.41, 0)));
    for (const y of [0.55, 1.15, 1.75, 2.35]) P.push(...tx(TIMBER, bx(logs, 4.5, 0.13, 4.5, 0, y, 0)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(...tx(TIMBER, bx(post, 0.32, 2.75, 0.32, sx * 2.2, 1.5, sz * 2.2)));
    P.push(...tx(TIMBER, bx(post, 5.4, 0.18, 5.4, 0, 2.72, 0)), ...tx(CANVAS, part(PYRAMID, f.vehicle, 0, 2.8, 0, 5.6, 1.5, 5.6)));
    P.push(...tx(TIMBER, bx(0x2e2418, 0.1, 1.85, 1.1, 2.22, 1.08, 0)), bx(f.color, 0.08, 0.42, 1.7, 2.24, 2.3, 0));
    framedOpening(P, 2.27, 1.08, 0, 1.1, 1.85, 0x8b7956, 0, true);
    P.push(...tx(TIMBER, bx(0x69573c, 0.55, 0.12, 1.42, 2.48, 0.2, 0)));
    for (const z of [-1.3, 1.3]) {
      P.push(bx(slit, 0.08, 0.4, 0.8, 2.22, 1.7, z));
      framedOpening(P, 2.26, 1.7, z, 0.8, 0.4, 0x8b7956);
    }
    for (const s of [-1, 1]) for (const x of [-1.1, 1.1]) {
      P.push(bx(slit, 0.9, 0.4, 0.08, x, 1.7, s * 2.22));
      framedOpening(P, x, 1.7, s * 2.26, 0.9, 0.4, 0x8b7956, -s * Math.PI / 2);
    }
    for (const s of [-1, 1]) for (let c = 0; c < 2; c++) for (let i = 0; i < 3 - c; i++)
      P.push(...tx(BURLAP, part(BAG, bagTint(s * 9 + c * 3 + i), 2.7, 0.18 + c * 0.3, s * (1.0 + 0.31 * c + i * 0.62), 0.6, 0.32, 0.42, Math.PI / 2)));
    P.push(cyl(0x2a2a26, 0.06, 4.6, 6, -1.6, 4.9, -1.6));
    for (const y of [5.9, 6.7]) P.push(bx(0x2a2a26, 0.05, 0.05, 1.0, -1.6, y, -1.6));
    P.push(cyl(0x4a3f30, 0.05, 2.6, 6, 1.9, 4.0, -1.9), bx(f.color, 1.3, 0.8, 0.05, 1.25, 4.85, -1.9));
    return P;
  },
  // Nissen hut: corrugated half-cylinder with ribs, timber end walls, door and windows at the front, a stovepipe
  barracks: (f) => {
    const P = [], r = 2.45, rib = darker(f.vehicle, 0.68);
    P.push(...tx(CONCRETE, bx(0x7e7c74, 5.9, 0.2, 5.9, 0, 0.1, 0)), ...tx(SHEET_X, part(HALF, f.vehicle, 0, 0.2, 0, 5.4, r, r)));
    for (const x of [-2.0, -0.68, 0.64, 1.96]) P.push(...tx(SHEET_X, part(HALF, rib, x, 0.2, 0, 0.14, r + 0.05, r + 0.05)));
    for (const s of [-1, 1]) P.push(...tx(TIMBER, part(HALF_END, 0x7a6446, s * 2.72, 0.2, 0, 0.16, r - 0.02, r - 0.02)));
    P.push(...tx(TIMBER, bx(0x2e2418, 0.1, 1.9, 1.0, 2.82, 1.15, 0)), bx(f.color, 0.08, 0.3, 1.1, 2.83, 2.3, 0));
    framedOpening(P, 2.87, 1.15, 0, 1.0, 1.9, 0x9b8b6d, 0, true);
    for (const z of [-1.3, 1.3]) {
      P.push(bx(0x1e2226, 0.08, 0.55, 0.6, 2.82, 1.45, z), bx(0x1e2226, 0.08, 0.5, 0.55, -2.82, 1.45, z));
      framedOpening(P, 2.87, 1.45, z, 0.6, 0.55, 0x9b8b6d);
      framedOpening(P, -2.87, 1.45, z, 0.55, 0.5, 0x9b8b6d, Math.PI);
    }
    P.push(...tx(CONCRETE, bx(0x6e6c64, 0.3, 0.12, 1.4, 2.85, 0.26, 0)));
    P.push(cyl(0x2a2a26, 0.09, 1.2, 6, -1.4, 2.95, 0.9), bx(0x2a2a26, 0.26, 0.08, 0.26, -1.4, 3.58, 0.9));
    return P;
  },
  // workshop: a lean-to shed with a ribbed roof at the back, an A-frame hoist with an engine on the chain out front,
  // drums, tires and a bench inside
  motorpool: (f) => {
    const P = [], wood = 0x6e5a40, post = 0x4e3e2a, steel = 0x3a3a36, rib = darker(f.vehicle, 0.72), len = 3.75, tilt = Math.atan2(0.7, len);
    P.push(...tx(CONCRETE, bx(0x75736b, 5.9, 0.12, 5.9, 0, 0.06, 0)), ...tx(TIMBER, bx(wood, 0.25, 2.5, 5.8, -2.8, 1.25, 0)));
    for (const s of [-1, 1]) P.push(...tx(TIMBER, bx(wood, 3.3, 2.1, 0.2, -1.15, 1.05, s * 2.85), bx(post, 0.3, 3.2, 0.3, 0.5, 1.6, s * 2.65)));
    P.push(...tx(SHEET_Z, bx(f.vehicle, len, 0.14, 6.0, -1.125, 2.9, 0, 0, 0, tilt)), bx(f.color, 0.1, 0.26, 6.0, 0.78, 3.28, 0));
    for (let i = 0; i < 6; i++) P.push(...tx(SHEET_Z, bx(rib, len, 0.06, 0.1, -1.125, 2.99, -2.5 + i, 0, 0, tilt)));
    for (const s of [-1, 1]) P.push(bx(steel, 0.14, 3.1, 0.14, 1.55, 1.55, s * 1.7, 0, 0, -0.2), bx(steel, 0.14, 3.1, 0.14, 2.25, 1.55, s * 1.7, 0, 0, 0.2));
    P.push(bx(steel, 0.22, 0.22, 3.8, 1.9, 3.08, 0), bx(0x24241f, 0.05, 1.3, 0.05, 1.9, 2.32, 0.3), bx(0x45453f, 0.8, 0.6, 0.9, 1.9, 1.4, 0.3), bx(0x2a2a26, 0.3, 0.3, 0.5, 1.9, 1.85, 0.3));
    // Valve covers and a sump make the suspended engine distinct from the supply crates.
    for (const s of [-1, 1]) P.push(bx(0x787870, 0.66, 0.11, 0.22, 1.9, 1.74, 0.3 + s * 0.24, 0, s * 0.2));
    P.push(bx(0x32322e, 0.6, 0.16, 0.62, 1.9, 1.04, 0.3));
    P.push(bx(0x3a3a34, 1.1, 0.3, 0.7, 1.7, 0.27, -1.6), part(TYRE, 0x1c1c1a, 2.3, 0.24, 2.2));
    for (let i = 0; i < 3; i++) P.push(cyl(0x3a4a30, 0.32, 0.92, 8, -2.25, 0.58, -2.2 + i * 0.68), part(TYRE, 0x1c1c1a, -2.15, 0.25 + i * 0.25, 2.1));
    P.push(...tx(TIMBER, bx(wood, 0.7, 0.9, 1.8, -2.3, 0.51, 0.3)), bx(steel, 0.25, 0.2, 0.25, -2.1, 1.06, 0.9));
    return P;
  },
  // supply dump: tarp-covered stack, crates, fuel drums (one lying down), jerry cans and a pennant
  depot: (f) => {
    const P = [], crate = 0x6e5836, tarp = 0x8a7d5a;
    P.push(...tx(TIMBER, bx(0x5a4a34, 3.8, 0.18, 3.8, 0, 0.09, 0)), ...tx(CANVAS, bx(tarp, 1.9, 1.1, 1.6, -0.75, 0.73, -0.8), part(GABLE, tarp, -0.75, 1.28, -0.8, 1.6, 1.0, 1.9, Math.PI / 2)));
    P.push(...tx(TIMBER, bx(crate, 0.9, 0.7, 0.9, 0.95, 0.53, -1.05), bx(darker(crate, 0.85), 0.8, 0.6, 0.8, 0.9, 1.18, -1.0, 0.3), bx(crate, 0.6, 0.45, 0.6, 1.45, 0.4, 0.1)));
    // Raised packing battens and drum rims still share the building's single mesh.
    for (const [x, y, z, size, height, yaw] of [[0.95, 0.53, -1.05, 0.9, 0.7, 0], [0.9, 1.18, -1.0, 0.8, 0.6, 0.3], [1.45, 0.4, 0.1, 0.6, 0.45, 0]]) {
      for (const s of [-1, 1]) {
        const dz = s * size * 0.34;
        P.push(...tx(TIMBER, bx(0x96805a, size + 0.025, 0.045, 0.065, x + dz * Math.sin(yaw), y + height / 2 + 0.02, z + dz * Math.cos(yaw), yaw)));
        for (const side of [-1, 1]) {
          const dx = side * (size / 2 + 0.018);
          P.push(...tx(TIMBER, bx(0x8a724d, 0.035, height, 0.065, x + dx * Math.cos(yaw) + dz * Math.sin(yaw), y, z - dx * Math.sin(yaw) + dz * Math.cos(yaw), yaw)));
        }
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = -1.45 + i * 0.62;
      P.push(cyl(f.vehicle, 0.29, 0.88, 8, x, 0.62, 1.2));
      for (const y of [0.23, 1.01]) P.push(cyl(darker(f.vehicle, 0.65), 0.306, 0.045, 8, x, y, 1.2));
      P.push(cyl(0x3a3a32, 0.045, 0.026, 5, x + 0.12, 1.073, 1.2));
    }
    for (const x of [-1.15, -0.35]) P.push(...tx(CANVAS, bx(0x625c42, 0.055, 1.12, 1.64, x, 0.74, -0.8)));
    P.push(cyl(f.vehicle, 0.29, 0.88, 8, 0.85, 0.47, 0.25, Math.PI / 2));
    for (let i = 0; i < 4; i++) P.push(bx(darker(f.vehicle, 0.8), 0.16, 0.46, 0.34, -1.5 + i * 0.2, 0.41, 0.2));
    P.push(cyl(0x4a3f30, 0.04, 3.2, 6, 1.65, 1.78, -1.65), bx(f.color, 0.9, 0.55, 0.04, 1.2, 3.05, -1.65));
    return P;
  },
  // command bunker: octagonal concrete blockhouse under a turf cap, firing slits to the front, steel door behind,
  // antenna and flag, a ring of sandbags with three gaps
  bunker: (f) => {
    const P = [], conc = 0x8f8d84, concD = 0x76746c, alpha = Math.atan2(0.45 * Math.cos(Math.PI / 8), 2.2);
    P.push(...tx(CONCRETE, part(BUNKER.body, conc, 0, 1.1, 0, 1, 2.2, 1), part(BUNKER.slab, concD, 0, 2.37, 0, 1, 0.35, 1)), ...tx(BURLAP, part(BUNKER.turf, 0x66603f, 0, 2.77, 0, 1, 0.45, 1)));
    for (const phi of [0, Math.PI / 4, -Math.PI / 4]) {
      const c = Math.cos(phi), s = Math.sin(phi);
      P.push(part(BOX, 0x14130f, c * 2.27, 1.5, s * 2.27, 0.14, 0.3, 1.25, -phi, 0, alpha), ...tx(CONCRETE, part(BOX, concD, c * 2.3, 1.78, s * 2.3, 0.35, 0.12, 1.45, -phi, 0, alpha)));
    }
    P.push(...tx(CONCRETE, part(BOX, concD, -2.36, 0.95, 0, 0.08, 1.95, 1.3, -Math.PI, 0, alpha)), part(BOX, 0x3a3a36, -2.38, 0.95, 0, 0.1, 1.7, 1.0, -Math.PI, 0, alpha));
    P.push(cyl(0x2a2a26, 0.03, 3.2, 5, -1.0, 4.2, 1.1), cyl(0x4a3f30, 0.06, 3.6, 6, -1.8, 4.4, -1.8), bx(f.color, 1.6, 1.0, 0.05, -1.0, 5.6, -1.8));
    const d = Math.PI / 180;
    bagArcs(P, 4.6, [0, 1, 2].map(k => [(k * 120 + 15) * d, (k * 120 + 105) * d]), 0.85, 0.36, 0.5);
    return P;
  },
};
// One material for every base building: vertex colours, and on parts that carry a surface id (uv.x), grain from one
// channel of the packed detail texture, mapped from the model's own axes so it keeps its real size: R canvas,
// G timber, B concrete; corrugated sheet adds 15 cm ridges that fade out before they could shimmer.
const MODEL_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
MODEL_MAT.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vDetail;\nvarying vec3 vObj;')
    .replace('#include <uv_vertex>', `#include <uv_vertex>
	#ifdef USE_MAP
		vec3 dn = abs( normal );
		vMapUv = dn.y > 0.6 ? position.xz : dn.x > dn.z ? position.zy : position.xy;
	#endif
	vDetail = uv.x;
	vObj = position;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vDetail;\nvarying vec3 vObj;')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
	float id = floor( vDetail + 0.5 );
	if ( id > 0.5 ) {
		float perM = id < 1.5 ? 0.42 : id < 2.5 ? 0.8 : id < 3.5 ? 0.45 : id < 4.5 ? 0.5 : id < 5.5 ? 2.0 : 0.5;
		vec3 d = texture2D( map, vMapUv * perM ).rgb;
		float k = id < 1.5 || ( id > 4.5 && id < 5.5 ) ? d.r : id < 2.5 ? d.g : d.b;
		if ( ( id > 3.5 && id < 4.5 ) || id > 5.5 ) {
			float ph = ( id > 5.5 ? vObj.z : vObj.x ) * 41.9;
			k *= 1.0 + 0.3 * sin( ph ) * clamp( 1.0 - fwidth( ph ) / 2.5, 0.0, 1.0 );
		}
		diffuseColor.rgb *= 2.0 * k;
	}
#endif`);
};
loadTexture('detail', (tex) => { tex.colorSpace = THREE.NoColorSpace; MODEL_MAT.map = tex; MODEL_MAT.needsUpdate = true; });
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
