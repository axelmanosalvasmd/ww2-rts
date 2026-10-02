// Scenery props: trees, bushes, meadow grass, rocks, fences, haystacks and supply heaps, placed from the map file
// (candidates) and filtered by the live grid (visible). Each kind is one or two InstancedMeshes for the whole map.
// Trees, bushes and grass come from client/foliage.js at real size; the rest are textured with client/surfaces.js.
import * as THREE from 'three';
import { gfx } from './gfx.js';
import { CELL, CFG, levelOf } from '../shared/sim.js';
import { treeGeometry, leafGeometry, leafMaterial, barkMaterial } from './foliage.js';
import { surface } from './surfaces.js';
import { fieldCells } from './ground.js';

const KINDS = ['deciduous', 'poplar', 'pine', 'bush', 'grass', 'crop', 'rocks', 'fence', 'haystack', 'supplies'];
const TALL = new Set(['deciduous', 'poplar', 'pine', 'fence', 'haystack']);
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Integer-only placement seeds keep the same scene across browsers and late joins.
function hash(x, y, salt = 0) {
  let n = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ salt, 0xc2b2ae35);
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15; n = Math.imul(n, 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}
const fraction = (x, y, salt) => hash(x, y, salt) / 4294967296;
const level = (heights, x, y) => levelOf(heights?.[y]?.[x] ?? '0');

export function pathSegments(map) {
  const points = map.points ?? [], segments = [], links = new Set();
  const add = (a, b) => segments.push({ ax: (a.x + 0.5) * CELL, az: (a.y + 0.5) * CELL, bx: (b.x + 0.5) * CELL, bz: (b.y + 0.5) * CELL });
  for (const sp of map.spawns ?? []) {
    const nearest = points.map((p, i) => ({ i, d: (sp.x - p.x) ** 2 + (sp.y - p.y) ** 2 }))
      .sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 2);
    for (const { i } of nearest) add(sp, points[i]);
  }
  points.forEach((p, i) => {
    const nearest = points.map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
      .filter(q => q.j !== i).sort((a, b) => a.d - b.d || a.j - b.j).slice(0, 2);
    for (const { j } of nearest) {
      const key = `${Math.min(i, j)},${Math.max(i, j)}`;
      if (!links.has(key)) { links.add(key); add(p, points[j]); }
    }
  });
  return segments;
}

function distanceToSegment(x, z, { ax, az, bx, bz }) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

// This filter uses only live state. Removing an obstacle restores the cached props.
export function visible(c, grid, { heights, nodes = [], low = false } = {}) {
  if (c.wood) return grid[c.cy]?.[c.cx] === 'O' && !(low && (c.seed & 1)); // a wood's tree stands while its cell is wood
  if (low && (c.seed & 1) && c.kind !== 'crop') return false; // a crop field stays whole
  if (c.cx < 2 || c.cy < 2 || c.cx >= grid[0].length - 2 || c.cy >= grid.length - 2) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (grid[c.cy + dy]?.[c.cx + dx] !== '.') return false;
  }
  const lv = level(heights, c.cx, c.cy);
  if (STEPS.some(([dx, dy]) => level(heights, c.cx + dx, c.cy + dy) !== lv)) return false;
  if (nodes.some(([x, z]) => (c.x - x) ** 2 + (c.z - z) ** 2 < 16)) return false;
  if (c.anchor) {
    const [x, y] = c.anchor;
    if (grid[y]?.[x] !== (c.kind === 'fence' ? 'H' : 'B')) return false;
  }
  return true;
}

// Species follows current elevation, without changing a candidate's position or seed.
export function kindFor(c, heights) {
  return c.kind === 'deciduous' && level(heights, c.cx, c.cy) > 0 && (c.seed >>> 3) % 3 === 0 ? 'pine' : c.kind;
}

export function candidates(map) {
  const { w, h, rows } = map, paths = pathSegments(map), list = [], occupied = new Set();
  const zones = [
    ...(map.spawns ?? []).map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, r: CFG.reinforceRadius + 4 })),
    ...(map.points ?? []).map(p => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL, r: CFG.pointRadius + 4 })),
  ];
  const clear = (x, y) => {
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rows[y + dy]?.[x + dx] !== '.') return false;
    return true;
  };
  const corridor = (x, z, margin = 0) => paths.some(p => distanceToSegment(x, z, p) < 3 + margin);
  const add = (kind, cx, cy, angle, anchor, scale = 1) => {
    const key = cy * w + cx;
    if (occupied.has(key) || !clear(cx, cy)) return false;
    const seed = hash(cx, cy, 71), jitter = kind === 'fence' || kind === 'poplar' ? 0 : 0.36;
    const x = (cx + 0.5) * CELL + (fraction(cx, cy, 81) - 0.5) * jitter;
    const z = (cy + 0.5) * CELL + (fraction(cx, cy, 82) - 0.5) * jitter;
    // Leave room for the canopy and fence ends as well as their centres.
    const margin = TALL.has(kind) ? 1.4 : 0.7;
    if (zones.some(p => Math.hypot(x - p.x, z - p.z) < p.r + margin)) return false;
    if (TALL.has(kind) && corridor(x, z, margin)) return false;
    list.push({ kind, cx, cy, x, z, seed, angle: angle ?? fraction(cx, cy, 83) * Math.PI * 2, scale, ...(anchor ? { anchor } : {}) });
    occupied.add(key);
    return true;
  };

  // Summed hedge counts make the 17 by 17 country-density query cheap on large maps.
  const stride = w + 1, hedge = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y + 1) * stride + x + 1;
    hedge[i] = (rows[y][x] === 'H' ? 1 : 0) + hedge[i - 1] + hedge[i - stride] - hedge[i - stride - 1];
  }
  const country = (x, y) => {
    const x0 = Math.max(0, x - 8), x1 = Math.min(w, x + 9), y0 = Math.max(0, y - 8), y1 = Math.min(h, y + 9);
    const n = hedge[y1 * stride + x1] - hedge[y0 * stride + x1] - hedge[y1 * stride + x0] + hedge[y0 * stride + x0];
    return Math.min(1, n / 45);
  };
  const besideHedge = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2 && rows[y + dy]?.[x + dx] === 'H') return true;
    }
    return false;
  };

  // Fence sections follow selected straight hedge runs, two cells to one side.
  for (const [dx, dy] of [[1, 0], [0, 1]]) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[y][x] !== 'H' || rows[y - dy]?.[x - dx] === 'H') continue;
    let length = 0;
    while (rows[y + dy * length]?.[x + dx * length] === 'H') length++;
    if (length < 3 || fraction(x, y, 90 + dy) > 0.38) continue;
    const side = fraction(x, y, 92 + dy) < 0.5 ? -1 : 1;
    for (let start = 0; start < length;) {
      const run = Math.min(length - start, 3 + hash(x + start * dx, y + start * dy, 94) % 6);
      const runList = [];
      for (let k = 0; k < run; k++) {
        const ax = x + dx * (start + k), ay = y + dy * (start + k);
        const cx = ax - dy * side * 2, cy = ay + dx * side * 2;
        if (add('fence', cx, cy, dy ? Math.PI / 2 : 0, [ax, ay])) runList.push(list[list.length - 1]);
      }
      // Short fragments beside clearings or structures would look like stray posts.
      let fragment = [];
      const trim = () => {
        if (fragment.length < 3) for (const c of fragment) { occupied.delete(c.cy * w + c.cx); list.splice(list.indexOf(c), 1); }
        fragment = [];
      };
      for (const c of runList) {
        const prev = fragment[fragment.length - 1];
        if (prev && Math.abs(c.cx - prev.cx) + Math.abs(c.cy - prev.cy) !== 1) trim();
        fragment.push(c);
      }
      trim();
      start += run + 2 + hash(x + start, y, 96) % 4;
    }
  }

  // One merged three-piece crate/barrel cluster beside selected house groups.
  const seen = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[y][x] !== 'B' || seen.has(y * w + x)) continue;
    const q = [[x, y]], house = []; seen.add(y * w + x);
    while (q.length) {
      const p = q.pop(); house.push(p);
      for (const [dx, dy] of STEPS) {
        const nx = p[0] + dx, ny = p[1] + dy, key = ny * w + nx;
        if (rows[ny]?.[nx] === 'B' && !seen.has(key)) { seen.add(key); q.push([nx, ny]); }
      }
    }
    if (fraction(x, y, 100) > 0.55) continue;
    const spots = [];
    for (const [ax, ay] of house) for (const [dx, dy] of STEPS) spots.push({ cx: ax + dx * 2, cy: ay + dy * 2, anchor: [ax, ay] });
    spots.sort((a, b) => hash(a.cx, a.cy, 101) - hash(b.cx, b.cy, 101));
    for (const p of spots) if (add('supplies', p.cx, p.cy, undefined, p.anchor)) break;
  }

  // Poplars occur in short orderly rows along field boundaries.
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    if (country(x, y) < 0.15 || fraction(x, y, 105) > 0.0012) continue;
    const vertical = hash(x, y, 106) & 1, n = 3 + hash(x, y, 107) % 3;
    for (let k = 0; k < n; k++) add('poplar', x + (vertical ? 0 : k * 2), y + (vertical ? k * 2 : 0), 0, null, 0.92 + fraction(x, y, 108) * 0.12);
  }

  // standing wheat on about half of the ploughed fields (client/ground.js), a patch per cell in the furrows' direction
  const fields = fieldCells(map);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const f = fields[y * w + x];
    if (f && fraction(Math.floor(x / 10), Math.floor(y / 8), 130) < 0.5) add('crop', x, y, f === 2 ? Math.PI / 2 : 0, null, 0.92 + fraction(x, y, 131) * 0.16);
  }

  let hay = 0;
  const hayCap = Math.min(16, Math.max(3, Math.round(w * h / 2200)));
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (!clear(x, y) || occupied.has(y * w + x)) continue;
    const d = country(x, y), nearPath = corridor((x + 0.5) * CELL, (y + 0.5) * CELL, 0.7);
    if (fraction(x, y, 111) < 0.013 + d * 0.065 &&
        add(fraction(x, y, 112) < 0.23 ? 'pine' : 'deciduous', x, y, undefined, null, 0.86 + fraction(x, y, 113) * 0.25)) continue;
    const bushChance = (0.031 + d * 0.06) * (besideHedge(x, y) ? 2 : 1) * (nearPath ? 0.4 : 1);
    if (fraction(x, y, 118) < bushChance && add('bush', x, y, undefined, null, 0.8 + fraction(x, y, 114) * 0.3)) continue;
    if (fraction(x, y, 115) < 0.004 * (nearPath ? 0.3 : 1) &&
        add('rocks', x, y, undefined, null, 0.8 + fraction(x, y, 116) * 0.3)) continue;
    if (hay < hayCap && d > 0.22 && fraction(x, y, 117) < 0.0012 && add('haystack', x, y)) hay++;
  }
  // meadow grass on the open cells left over, thicker in hedged country, kept off the paths
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (occupied.has(y * w + x) || fraction(x, y, 120) > 0.1 + 0.16 * country(x, y)) continue;
    if (!corridor((x + 0.5) * CELL, (y + 0.5) * CELL, 0.4)) add('grass', x, y, undefined, null, 0.8 + fraction(x, y, 121) * 0.5);
  }
  const trees = list.filter(c => ['deciduous', 'pine', 'poplar'].includes(c.kind)).sort((a, b) => a.seed - b.seed);
  const capped = new Set(trees.slice(1200));
  // woods ('O' cells): a tree on about one cell in three, smaller than a field tree so the canopy stays readable.
  // They are the wood itself, so they skip the clearings and paths the scattered trees keep to. Capped separately.
  const wood = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[y][x] !== 'O' || fraction(x, y, 140) > 0.3) continue;
    wood.push({ kind: fraction(x, y, 141) < 0.3 ? 'pine' : 'deciduous', cx: x, cy: y, x: (x + 0.5) * CELL + (fraction(x, y, 142) - 0.5) * 1.2, z: (y + 0.5) * CELL + (fraction(x, y, 143) - 0.5) * 1.2,
      seed: hash(x, y, 144), angle: fraction(x, y, 145) * Math.PI * 2, scale: 0.55 + fraction(x, y, 146) * 0.3, wood: true });
  }
  wood.sort((a, b) => a.seed - b.seed);
  return [...list.filter(c => !capped.has(c)), ...wood.slice(0, 1500)];
}

// Rocks, fences, haystacks and supply heaps: parts merged by hand (only the core three.js module is served). Parts keep
// their own normals, smooth on round shapes and flat on boxes; a part's paint multiplies the kind's texture.
function merged(parts) {
  const position = [], normal = [], color = [];
  for (const { geo, paint } of parts) {
    const flat = geo.index ? geo.toNonIndexed() : geo, p = flat.attributes.position, n = flat.attributes.normal;
    const c = Array.isArray(paint) ? paint : [paint, paint, paint];
    for (let i = 0; i < p.count; i++) {
      position.push(p.getX(i), p.getY(i), p.getZ(i)); normal.push(n.getX(i), n.getY(i), n.getZ(i)); color.push(c[0], c[1], c[2]);
    }
    if (flat !== geo) flat.dispose();
    geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.computeBoundingSphere();
  return g;
}
// scale, tilt (x then z), turn, then move
const placed = (geo, [sx, sy, sz], [x, y, z], ry = 0, rx = 0, rz = 0) => geo.scale(sx, sy, sz).rotateX(rx).rotateZ(rz).rotateY(ry).translate(x, y, z);

// a weathered boulder: a lumpy, faceted icosahedron with its foot in the ground
function boulder(seed, [sx, sy, sz], position, ry) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.2 * Math.sin(v.x * 3.1 + v.z * 1.7 + seed) * Math.cos(v.y * 2.3 - v.z * 2.9) + 0.1 * Math.sin(v.x * 6.7 - v.y * 5.3 + seed * 2);
    v.multiplyScalar(k);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.2; // a flatter underside, half buried
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); // non-indexed: each facet keeps its own flat normal
  return placed(g, [sx, sy, sz], position, ry);
}

function geometry(kind) {
  const parts = [], add = (geo, paint) => parts.push({ geo, paint });
  const box = (paint, scale, position, ry, rx, rz) => add(placed(new THREE.BoxGeometry(1, 1, 1), scale, position, ry, rx, rz), paint);
  const post = (paint, r0, r1, h, position, sides = 6, rx = 0, rz = 0) =>
    add(placed(new THREE.CylinderGeometry(r0, r1, h, sides), [1, 1, 1], position, 0, rx, rz), paint);
  if (kind === 'rocks') {
    // three field stones, the biggest about 0.9 m across
    add(boulder(1.3, [0.48, 0.3, 0.4], [-0.22, 0.1, 0], 0.4), [0.8, 0.78, 0.74]);
    add(boulder(4.1, [0.3, 0.22, 0.27], [0.36, 0.06, 0.2], 1.9), [0.9, 0.87, 0.82]);
    add(boulder(2.7, [0.18, 0.13, 0.2], [0.08, 0.03, -0.42], 0.8), [0.72, 0.7, 0.68]);
  } else if (kind === 'fence') {
    // weathered post-and-rail: split posts and two sagging rails nailed on one side
    for (const [x, rz] of [[-0.92, 0.04], [0.92, -0.03]]) post([0.62, 0.6, 0.56], 0.055, 0.07, 1.25, [x, 0.5, 0], 5, 0.03, rz);
    box([0.7, 0.68, 0.64], [2.02, 0.09, 0.05], [0, 0.88, 0.075], 0, 0, 0.02);
    box([0.66, 0.64, 0.6], [2.02, 0.09, 0.05], [0, 0.46, 0.075], 0, 0, -0.025);
  } else if (kind === 'haystack') {
    // a domed stack about 2.1 m tall and 2 m across, settling a little to one side
    const profile = [[0.95, -0.05], [1.02, 0.45], [0.96, 1.0], [0.72, 1.55], [0.36, 1.95], [0.06, 2.12], [0, 2.14]].map(([r, y]) => new THREE.Vector2(r, y));
    add(placed(new THREE.LatheGeometry(profile, 14), [1, 1, 0.94], [0, 0, 0], 0, 0.02, 0.05), [1, 1, 1]);
  } else if (kind === 'supplies') {
    // a stack of wooden crates (about 0.9 m long), a jerrican and a 200-litre drum
    const crate = [0.86, 0.8, 0.7], lid = [0.95, 0.9, 0.8], drum = [0.42, 0.46, 0.34];
    box(crate, [0.9, 0.5, 0.55], [-0.4, 0.25, -0.25], 0.08);
    box(lid, [0.94, 0.05, 0.58], [-0.4, 0.52, -0.25], 0.08);
    box(crate, [0.9, 0.5, 0.55], [-0.36, 0.25, 0.36], -0.05);
    box([0.8, 0.75, 0.66], [0.84, 0.46, 0.52], [-0.38, 0.77, 0.04], 0.3);
    box([0.5, 0.52, 0.4], [0.17, 0.46, 0.34], [0.2, 0.23, 0.62], 0.4);
    post(drum, 0.29, 0.29, 0.88, [0.5, 0.44, -0.05], 12);
    for (const y of [0.3, 0.6]) post([0.34, 0.37, 0.28], 0.3, 0.3, 0.04, [0.5, y, -0.05], 12);
  }
  return merged(parts);
}

const geometries = new Map();
// the meshes for a kind: [geometry, material, role]; trees draw bark and leaves as two meshes over the same matrices
function meshesFor(kind) {
  if (kind === 'deciduous' || kind === 'pine' || kind === 'poplar') {
    const t = treeGeometry(kind === 'deciduous' ? 'broadleaf' : kind);
    return [[t.bark, barkMaterial(), 'bark'], [t.leaves, leafMaterial(), 'leaves']];
  }
  if (kind === 'bush' || kind === 'grass' || kind === 'crop') return [[leafGeometry(kind), leafMaterial(), 'leaves']];
  const geo = geometries.get(kind) ?? geometries.set(kind, geometry(kind)).get(kind);
  return [[geo, surface({ rocks: 'stone', fence: 'wood', haystack: 'straw', supplies: 'wood' }[kind], true), 'solid']];
}

export function createProps({ map, grid, hAt, parent }) {
  const cached = candidates(map), group = new THREE.Group(), meshes = new Map();
  group.name = 'scenery-props'; parent.add(group);
  for (const kind of KINDS) {
    // Deciduous trees can become pines when live elevation favours that species.
    const capacity = cached.filter(c => c.kind === kind || (kind === 'pine' && c.kind === 'deciduous')).length;
    if (!capacity) continue;
    const list = meshesFor(kind).map(([geo, material, role]) => {
      const mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.name = role === 'bark' ? `${kind}-bark` : kind; mesh.userData.role = role;
      mesh.count = 0; mesh.receiveShadow = true;
      // A mesh spans the whole map; disabling culling avoids stale instance bounds.
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return mesh;
    });
    meshes.set(kind, list);
  }
  let nodes = [], disposed = false;
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), turn = new THREE.Quaternion(), at = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  // where one prop stands, as drawn: c.at is its kind (null: not shown), c.m its matrix, c.col and c.bark its tints
  function place(c) {
    c.at = null;
    if (c.kind === 'grass' && gfx.low) return;
    if (!visible(c, grid, { heights: map.heights, nodes, low: gfx.low })) return;
    const kind = kindFor(c, map.heights), crop = kind === 'crop';
    // each tree or bush its own height, girth and heading; leafy kinds also their own shade of green
    const f = (k) => ((c.seed >>> k) & 255) / 255, leafy = kind !== 'rocks' && kind !== 'fence' && kind !== 'haystack' && kind !== 'supplies';
    const girth = leafy && !crop ? 0.9 + 0.2 * f(4) : 1, tall = leafy ? 0.88 + 0.24 * f(12) : 1;
    scale.set(c.scale * girth, c.scale * tall, c.scale * girth);
    turn.setFromAxisAngle(UP, c.angle);
    c.m = matrix.compose(at.set(c.x, hAt(c.x, c.z) - 0.035, c.z), turn, scale).toArray(c.m);
    const tint = 0.88 + ((c.seed >>> 8) % 101) / 600, colour = c.col ??= new THREE.Color();
    if (!leafy) colour.setRGB(tint, tint, tint);
    else if (crop) colour.setRGB(tint * 1.3, tint * 1.06, tint * 0.56); // ripe wheat
    else if (kind === 'deciduous' && (c.seed >>> 16) % 9 === 0) colour.setRGB(tint * 1.08, tint * 1.0, tint * 0.72); // a tree turning
    else colour.setRGB(tint * (0.94 + f(18) * 0.1), tint * (0.97 + f(20) * 0.05), tint * (0.86 + f(22) * 0.12));
    (c.bark ??= new THREE.Color()).setRGB(tint, tint, tint);
    c.at = kind;
  }
  // box [x0, z0, x1, z1] (world units): only the props near those cells are placed again (a prop looks up to two
  // cells away, its anchor included); the rest keep where they stood. Left out: all of them.
  const PAD = 3 * CELL;
  function refresh(box) {
    if (disposed) return;
    for (const [kind, list] of meshes) for (const mesh of list) {
      mesh.count = 0;
      // grass and crops are too low to shade anything; Low drops tree and bush shadows too
      mesh.castShadow = kind !== 'grass' && kind !== 'crop' && !gfx.low;
    }
    for (const c of cached) {
      if (!box || c.at === undefined || (c.x > box[0] - PAD && c.x < box[2] + PAD && c.z > box[1] - PAD && c.z < box[3] + PAD)) place(c);
      if (!c.at) continue;
      const list = meshes.get(c.at), i = list[0].count;
      for (const mesh of list) {
        mesh.instanceMatrix.array.set(c.m, i * 16);
        mesh.setColorAt(i, mesh.userData.role === 'bark' ? c.bark : c.col);
        mesh.count = i + 1;
      }
    }
    for (const list of meshes.values()) for (const mesh of list) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }
  const unsubscribe = gfx.onChange(() => refresh());
  refresh();
  return {
    group, refresh,
    setNodes(next) { if (disposed) return; nodes = next ?? []; refresh(); },
    dispose() {
      if (disposed) return;
      // geometries and materials are shared between matches (client/foliage.js, client/surfaces.js)
      disposed = true; unsubscribe(); group.removeFromParent();
      for (const list of meshes.values()) for (const mesh of list) mesh.dispose();
      group.clear(); meshes.clear();
    },
  };
}
