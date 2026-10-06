import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createRelief } from './client/relief.js';
import { CFG, CELL } from './shared/sim.js';

// All four cliff orientations face the low ground, so the road-facing rock cannot be backface-culled.
for (const axis of [0, 1]) for (const sign of [-1, 1]) for (const low of [false, true]) {
  const map = { w: 8, h: 8, rows: Array(8).fill('.'.repeat(8)),
    heights: Array.from({ length: 8 }, (_, z) => Array.from({ length: 8 }, (_, x) => ((axis ? z : x) < 4) === (sign > 0) ? '4' : '0').join('')) };
  const relief = createRelief(map, map.rows, { low }), { position, normal, reliefPaint } = relief.geometry.attributes;
  const rimKey = i => [position.getX(i), position.getY(i), position.getZ(i)].map(v => v.toFixed(5)).join(',');
  const surfaceRim = new Set();
  for (let i = 0; i < position.count; i++) if (reliefPaint.getX(i) === 0) surfaceRim.add(rimKey(i));
  let faces = 0, shiftedRim = 0, stones = 0;
  for (let i = 0; i < position.count; i++) {
    const paint = reliefPaint.getX(i);
    if (paint > 0 && paint < 1) { stones++; continue; } // loose rock models
    if (paint !== 1) continue;
    const outward = axis ? normal.getZ(i) : normal.getX(i);
    assert.ok(outward * sign > 0, `axis ${axis}, sign ${sign}, low ${low}: rock faces low ground`);
    faces++;
    const height = position.getY(i), across = axis ? position.getZ(i) : position.getX(i);
    if (height === 0 || height === 4 * CFG.levelHeight) assert.ok(surfaceRim.has(rimKey(i)), 'every wall rim node is shared with the terrain surface');
    if ((height === 0 || height === 4 * CFG.levelHeight) && Math.abs(across - 4 * CELL) > 0.001) shiftedRim++;
  }
  assert.ok(faces && shiftedRim && stones, 'cliff has ragged rims, rock facets and rock models');
  const again = createRelief(map, map.rows, { low });
  assert.deepEqual(position.array, again.geometry.attributes.position.array, 'rock placement is deterministic');
  again.dispose();
  map.heights = Array(8).fill('0'.repeat(8));
  relief.update(Array.from({ length: 64 }, (_, c) => c));
  assert.equal(relief.stats.cliffEdges, 0, 'flattening the cliff removes its faces');
  assert.ok(relief.geometry.attributes.reliefPaint.array.every((v, i) => i % 4 !== 0 || v === 0), 'flattening removes attached stones too');
  relief.dispose();
}
// Convex and concave bends share their interior rock edges as well as the rim.
for (const low of [false, true]) {
  const w = 12, h = 12;
  const map = { w, h, rows: Array(h).fill('.'.repeat(w)), heights: Array.from({ length: h }, (_, z) =>
    Array.from({ length: w }, (_, x) => x >= 2 && z >= 2 && x <= 9 && z <= 9 && x + z < 15 && (x < 6 || z < 6) ? '4' : '0').join('')) };
  const relief = createRelief(map, map.rows, { low });
  const { position, reliefPaint } = relief.geometry.attributes, indices = relief.geometry.index.array;
  const key = i => [position.getX(i), position.getY(i), position.getZ(i)].map(v => v.toFixed(5)).join(',');
  const edges = new Map(), surface = new Set();
  for (let i = 0; i < position.count; i++) if (reliefPaint.getX(i) === 0) surface.add(key(i));
  for (let i = 0; i < indices.length; i += 3) {
    const ids = Array.from(indices.slice(i, i + 3));
    if (ids.every(v => reliefPaint.getX(v) === 0)) {
      const [a, b, c] = ids;
      const crossY = (position.getZ(b) - position.getZ(a)) * (position.getX(c) - position.getX(a)) -
        (position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a));
      assert.ok(crossY > 0, 'broad bevels do not invert terrain triangles');
    }
    if (!ids.every(v => reliefPaint.getX(v) === 1 && reliefPaint.getY(v) === 4 * CFG.levelHeight && reliefPaint.getZ(v) === 0)) continue;
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3], ya = position.getY(a), yb = position.getY(b);
      if ((ya === 0 || ya === 4 * CFG.levelHeight) && ya === yb) {
        assert.ok(surface.has(key(a)) && surface.has(key(b)), 'beveled cliff rim joins the surface'); continue;
      }
      const edge = [key(a), key(b)].sort().join('|'); edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) assert.equal(count, 2, `cliff bend has a sealed interior edge: ${edge}`);
  relief.dispose();
}
// A junction with three heights must share the same straight corner profile for both overlapping wall spans.
for (const low of [false, true]) {
  const map = { w: 8, h: 8, rows: Array(8).fill('........'),
    heights: Array.from({ length: 8 }, (_, z) => z < 4 ? '44442222' : '44440000') };
  const relief = createRelief(map, map.rows, { low });
  const { position, reliefPaint } = relief.geometry.attributes;
  const corner = [];
  for (let i = 0; i < position.count; i++) {
    if (reliefPaint.getX(i) !== 1 || reliefPaint.getY(i) !== 10 || position.getY(i) !== 5) continue;
    if (Math.hypot(position.getX(i) - 8, position.getZ(i) - 8) < 0.3)
      corner.push([position.getX(i), position.getZ(i)]);
  }
  assert.ok(corner.length >= 2, 'both cliff spans reach the mixed junction');
  for (const point of corner) assert.deepEqual(point, corner[0], 'mixed-height wall spans share their corner');
  relief.dispose();
}

// Decorative rock cannot bury vehicles on the mountain road's valid cell centres.
const hotGates = JSON.parse(readFileSync(new URL('./maps/hot-gates.json', import.meta.url)));
for (const low of [false, true]) {
  const relief = createRelief(hotGates, hotGates.rows, { low }), ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  relief.mesh.updateMatrixWorld(true);
  let checked = 0;
  for (let z = 40; z <= 69; z++) for (let x = 28; x <= 109; x++) {
    if (hotGates.heights[z][x] !== '2' || hotGates.rows[z][x] !== '.') continue;
    const wx = (x + 0.5) * CELL, wz = (z + 0.5) * CELL;
    ray.set(new THREE.Vector3(wx, 30, wz), down);
    const hit = ray.intersectObject(relief.mesh)[0];
    assert.ok(hit && hit.point.y <= 2 * CFG.levelHeight + 0.3, `road cell ${x},${z} is clear of cliff rocks`);
    checked++;
  }
  assert.ok(checked > 400, 'checks the open mountain-road corridor');
  // Rock models stay out of ground contact, so check their vertices directly against the road cell centres.
  const { position, reliefPaint } = relief.geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const paint = reliefPaint.getX(i);
    if (!(paint > 0 && paint < 1)) continue;
    const x = Math.floor(position.getX(i) / CELL), z = Math.floor(position.getZ(i) / CELL);
    if (hotGates.heights[z]?.[x] !== '2' || hotGates.rows[z][x] !== '.') continue;
    const near = Math.hypot(position.getX(i) - (x + 0.5) * CELL, position.getZ(i) - (z + 0.5) * CELL) < 0.4;
    assert.ok(!near || position.getY(i) <= 2 * CFG.levelHeight + 0.3, `rock model clears road cell ${x},${z}`);
  }
  relief.dispose();
}
console.log('Cliff winding, sealed bends, mixed-height joins, road clearance, rock models and updates checked');
