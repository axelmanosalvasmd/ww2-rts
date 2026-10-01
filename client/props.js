import * as THREE from 'three';
import { gfx } from './gfx.js';
import { CELL, CFG, levelOf } from '../shared/sim.js';

const KINDS = ['deciduous', 'poplar', 'pine', 'bush', 'rocks', 'fence', 'haystack', 'supplies'];
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
  if (low && (c.seed & 1)) return false;
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
  const trees = list.filter(c => ['deciduous', 'pine', 'poplar'].includes(c.kind)).sort((a, b) => a.seed - b.seed);
  const capped = new Set(trees.slice(1200));
  return list.filter(c => !capped.has(c));
}

// Merge painted parts ourselves; only the core three.js module is served.
function geometry(kind) {
  const positions = [], colours = [], colour = new THREE.Color();
  const part = (geo, paint, scale, position, rotation = 0) => {
    geo.scale(...scale); if (rotation) geo.rotateZ(rotation); geo.translate(...position);
    const flat = geo.index ? geo.toNonIndexed() : geo;
    colour.set(paint);
    const p = flat.attributes.position;
    for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); colours.push(colour.r, colour.g, colour.b); }
    if (flat !== geo) flat.dispose(); geo.dispose();
  };
  const box = (paint, scale, position, rotation) => part(new THREE.BoxGeometry(1, 1, 1), paint, scale, position, rotation);
  const blob = (paint, scale, position, detail = 0) => part(new THREE.IcosahedronGeometry(1, detail), paint, scale, position);
  const cylinder = (paint, top, bottom, height, position, sides = 6) => part(new THREE.CylinderGeometry(top, bottom, height, sides), paint, [1, 1, 1], position);
  const trunk = (height) => cylinder(0x705033, 0.13, 0.22, height, [0, height / 2, 0]);
  if (kind === 'deciduous') {
    trunk(2.8);
    blob(0x5e7837, [1.35, 1.35, 1.25], [0, 2.9, 0], 1);
    blob(0x6f873f, [0.98, 0.96, 1.02], [-0.65, 2.55, 0.2]);
    blob(0x4f6a32, [0.96, 1.02, 0.92], [0.6, 2.6, -0.25]);
  } else if (kind === 'poplar') {
    trunk(3.5);
    blob(0x66833e, [0.79, 2.05, 0.78], [0, 3.7, 0], 1);
    blob(0x7c9147, [0.65, 1.55, 0.65], [0.1, 4.05, 0.04]);
  } else if (kind === 'pine') {
    trunk(2.6);
    for (const [r, ht, y, paint] of [[1.4, 2.25, 2.15, 0x395d48], [1.13, 2.1, 3.15, 0x446950], [0.8, 1.85, 4.15, 0x52775a]]) {
      part(new THREE.ConeGeometry(r, ht, 7), paint, [1, 1, 1], [0, y, 0]);
    }
  } else if (kind === 'bush') {
    blob(0x647944, [0.6, 0.55, 0.57], [0, 0.48, 0]);
    blob(0x74864a, [0.46, 0.38, 0.46], [-0.46, 0.32, 0.1]);
    blob(0x52673b, [0.46, 0.43, 0.45], [0.42, 0.35, -0.1]);
  } else if (kind === 'rocks') {
    blob(0x979081, [0.52, 0.38, 0.43], [-0.25, 0.26, 0]);
    blob(0xb0a795, [0.37, 0.29, 0.35], [0.3, 0.2, 0.15]);
    blob(0x827e70, [0.24, 0.2, 0.29], [0.07, 0.12, -0.42]);
  } else if (kind === 'fence') {
    for (const x of [-0.92, 0.92]) box(0x8b7049, [0.12, 1.02, 0.14], [x, 0.43, 0]);
    for (const y of [0.32, 0.74]) box(0xa18a5c, [2, 0.12, 0.11], [0, y, 0]);
  } else if (kind === 'haystack') {
    cylinder(0xb69a57, 0.72, 0.96, 0.9, [0, 0.42, 0], 9);
    part(new THREE.ConeGeometry(0.99, 1.35, 9), 0xc6ad66, [1, 1, 1], [0, 1.02, 0]);
    box(0x816c3e, [0.1, 1.9, 0.1], [0, 0.87, 0]);
  } else if (kind === 'supplies') {
    box(0x967347, [0.7, 0.7, 0.66], [-0.43, 0.32, -0.23]);
    box(0xb0935e, [0.72, 0.075, 0.68], [-0.43, 0.65, -0.23]);
    for (const x of [-0.68, -0.18]) box(0x6b573b, [0.06, 0.66, 0.69], [x, 0.33, -0.23]);
    box(0x7e6846, [0.5, 0.48, 0.5], [-0.2, 0.23, 0.43]);
    cylinder(0x68714a, 0.31, 0.31, 0.8, [0.48, 0.38, 0.08], 9);
    for (const y of [0.17, 0.61]) cylinder(0x444d36, 0.326, 0.326, 0.065, [0.48, y, 0.08], 9);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  merged.computeVertexNormals(); merged.computeBoundingSphere();
  return merged;
}

export function createProps({ map, grid, hAt, parent }) {
  const cached = candidates(map), group = new THREE.Group(), meshes = new Map();
  group.name = 'painted-props'; parent.add(group);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  for (const kind of KINDS) {
    // Deciduous trees can become pines when live elevation favours that species.
    const capacity = cached.filter(c => c.kind === kind || (kind === 'pine' && c.kind === 'deciduous')).length;
    if (!capacity) continue;
    const mesh = new THREE.InstancedMesh(geometry(kind), material, capacity);
    mesh.name = kind; mesh.count = 0; mesh.receiveShadow = true;
    // A mesh spans the whole map; disabling culling avoids stale instance bounds.
    mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh); meshes.set(kind, mesh);
  }
  let nodes = [], disposed = false;
  const matrix = new THREE.Matrix4(), colour = new THREE.Color(), scale = new THREE.Vector3();
  function refresh() {
    if (disposed) return;
    for (const mesh of meshes.values()) { mesh.count = 0; mesh.castShadow = !gfx.low; }
    for (const c of cached) {
      if (!visible(c, grid, { heights: map.heights, nodes, low: gfx.low })) continue;
      const kind = kindFor(c, map.heights), mesh = meshes.get(kind), i = mesh.count++;
      matrix.makeRotationY(c.angle).scale(scale.setScalar(c.scale));
      matrix.setPosition(c.x, hAt(c.x, c.z) - 0.035, c.z); mesh.setMatrixAt(i, matrix);
      const tint = 0.9 + ((c.seed >>> 8) % 101) / 500;
      colour.setRGB(tint, tint, tint);
      if (kind === 'deciduous' && (c.seed >>> 16) % 9 === 0) colour.setRGB(tint * 1.5, tint * 1.12, tint * 0.58);
      else colour.setRGB(tint * (0.97 + ((c.seed >>> 18) % 7) / 100), tint, tint * 0.97);
      mesh.setColorAt(i, colour);
    }
    for (const mesh of meshes.values()) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }
  const unsubscribe = gfx.onChange(refresh);
  refresh();
  return {
    group, refresh,
    setNodes(next) { if (disposed) return; nodes = next ?? []; refresh(); },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); group.removeFromParent();
      for (const mesh of meshes.values()) { mesh.dispose(); mesh.geometry.dispose(); }
      material.dispose(); group.clear(); meshes.clear();
    },
  };
}
