// Focused world-edge checks: node test-world.js. Live shader compilation and camera views are checked in the browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CELL } from './shared/sim.js';
import { createWater } from './client/water.js';
import { fogOverlayShader, fogShader, setFogMap } from './client/surfaces.js';

// Every wet edge continues outwards, while a lake fully inside the map does not gain off-map water.
for (const [label, rows, extents] of [
  ['sea', ['WWWW', 'WWWW', 'WWWW', 'WWWW'], [-900, -900, 908, 908]],
  ['river', ['...W....', '...W....', '...W....', '...W....'], [0, -900, 16, 908]],
  ['corner', ['W...', '....', '....', '....'], [-900, -900, 8, 8]],
  ['lake', ['........', '........', '........', '...WW...', '...WW...', '........', '........', '........'], [0, 0, 16, 16]],
]) {
  const map = { w: rows[0].length, h: rows.length, rows }, grid = rows.map(row => [...row]);
  const water = createWater(grid, map, () => 0), geometry = water.geometry;
  geometry.computeBoundingBox();
  assert.deepEqual([geometry.boundingBox.min.x, geometry.boundingBox.min.z, geometry.boundingBox.max.x, geometry.boundingBox.max.z], extents, label);
  assert.ok([...geometry.attributes.position.array, ...geometry.attributes.normal.array, ...geometry.attributes.flow.array].every(Number.isFinite), `${label}: finite water geometry`);
  // Every non-degenerate added triangle is wound upwards.
  const p = geometry.attributes.position, index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).y >= -1e-6, `${label}: water triangle faces up`);
  }
  water.dispose();
}

// Scouting finds more water: the mask is redone only in boxes around the new water, ford and bridge, and comes out
// exactly as a fresh build of the whole map does (#58: redoing it whole took about 0.9 s on a Huge World map).
{
  const W = 64, rows = Array.from({ length: W }, (_, y) => Array.from({ length: W }, (_, x) => (x === 20 && y < 12 ? 'W' : '.')).join(''));
  const map = { w: W, h: W, rows }, grid = rows.map(row => [...row]);
  const maskOf = water => water.mask.image.data;
  const water = createWater(grid, map, () => 0);
  const found = [];
  for (let y = 12; y < 40; y++) { grid[y][20] = y === 30 ? 'F' : y === 35 ? '=' : 'W'; found.push([y * W + 20, grid[y][20]]); }
  for (let x = 40; x < 64; x++) { grid[48][x] = 'W'; found.push([48 * W + x, 'W']); } // a stream on a tile's edge, reaching the map edge
  water.changed(found); water.tick(0);
  const fresh = createWater(grid, map, () => 0);
  assert.deepEqual(maskOf(water), maskOf(fresh), 'found water updates the mask exactly as a fresh build draws it');
  // 4 texels a cell: the stream's soft bank spills into the texel row just above it
  assert.ok(maskOf(water)[((48 * 4 - 1) * W * 4 + 50 * 4) * 4] > 50, 'the blur reaches past the changed cells');
  water.dispose(); fresh.dispose();
}

// World Conquest: a river running into ground not yet discovered carries on under the fog instead of ending in a beach
// at the edge of what was seen; once the ground past it is discovered as dry land, the shore is drawn there.
{
  const W = 32, rows = Array.from({ length: W }, (_, y) => Array.from({ length: W }, (_, x) => (y === 16 && x < 12 ? 'W' : '.')).join(''));
  const map = { w: W, h: W, rows }, grid = rows.map(row => [...row]), known = new Uint8Array(W * W);
  for (let c = 0; c < W * W; c++) known[c] = c % W < 12 ? 1 : 0; // explored: the first 12 columns
  const coverage = (water, x, y) => water.mask.image.data[(((y * 4 + 2) * W * 4) + x * 4 + 2) * 4];
  const water = createWater(grid, map, () => 0, { unknown: c => !known[c] }), beach = createWater(grid, map, () => 0);
  assert.ok(coverage(water, 12, 16) > 200 && coverage(beach, 12, 16) < 100, `the river runs on into undiscovered ground: ${coverage(water, 12, 16)} against ${coverage(beach, 12, 16)} with a shore`);
  for (let c = 0; c < W * W; c++) known[c] = 1; // the next columns turn out to be dry land
  water.changed([[16 * W + 12, '.']]); water.tick(0);
  assert.ok(coverage(water, 13, 16) < 100, 'discovered dry land gets its shore');
  water.dispose(); beach.dispose();
  // discovered column by column, with more river found on the way and a stretch drying up, the shore under the fog
  // comes out as a fresh build with the same discovery draws it (the open water is redone only around changes)
  const scout = rows.map(row => [...row]), seen = new Uint8Array(W * W), unknown = c => !seen[c];
  for (let c = 0; c < W * W; c++) seen[c] = c % W < 6 ? 1 : 0;
  const stepped = createWater(scout, map, () => 0, { unknown });
  for (let x = 6; x < 20; x++) {
    const found = [];
    for (let y = 0; y < W; y++) {
      seen[y * W + x] = 1;
      if (y === 16 && x >= 14) scout[y][x] = 'W';
      if (x === 18 && y > 16 && y < 22) scout[y][x] = 'W';
      found.push([y * W + x, scout[y][x]]);
    }
    if (x === 15) { scout[16][3] = '.'; found.push([16 * W + 3, '.']); }
    stepped.changed(found); stepped.tick(0);
    const whole = createWater(scout, map, () => 0, { unknown });
    assert.deepEqual(stepped.mask.image.data, whole.mask.image.data, `the shore under the fog after discovering column ${x}`);
    whole.dispose();
  }
  stepped.dispose();
}

// Removing a wet edge cell removes its continuation on the next water tick.
{
  const map = { w: 4, h: 4, rows: ['.W..', '.W..', '....', '....'] }, grid = map.rows.map(row => [...row]);
  const water = createWater(grid, map, () => 0);
  grid[0][1] = grid[1][1] = '.';
  water.changed([[1, '.'], [5, '.']]); water.tick(0);
  // no water is left, so no chunk draws any: nothing reaches past the edge
  const position = water.geometry.attributes.position.array;
  for (let i = 2; i < position.length; i += 3) assert.ok(position[i] >= 0, 'no water past the north edge');
  assert.equal(water.mesh.children.length, 0, 'the dried chunk drops its mesh');
  water.dispose();
}

// The apron and 3D pieces share one live server mask, including after a restart replaces that texture.
{
  const shader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader });
  const first = new THREE.DataTexture(new Uint8Array(4), 1, 1), next = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  setFogMap(first, 80 * CELL, 80 * CELL);
  const overlay = shader(), piece = shader();
  const uniforms = { uMapSize: { value: new THREE.Vector2(160, 160) }, uUnseen: { value: 185 / 255 } };
  fogOverlayShader(overlay, uniforms); fogShader(piece);
  assert.equal(overlay.uniforms.fowMap, piece.uniforms.fowMap);
  assert.equal(overlay.uniforms.fowMap.value, first);
  assert.equal(overlay.uniforms.uUnseen.value, 185 / 255);
  // the mask, eased into unexplored ground past the edge, drifts with the same mist as the pieces (client/surfaces.js)
  assert.ok(overlay.fragmentShader.includes('gl_FragColor.a *= fowMist(mix('));
  assert.equal(overlay.uniforms.fowTime, piece.uniforms.fowTime);
  assert.ok(!overlay.fragmentShader.includes('gl_FragColor.rgb = mix('));
  setFogMap(next, 280, 280);
  assert.equal(overlay.uniforms.fowMap.value, next);
  assert.equal(overlay.uniforms.fowSize.value.x, 280);
  setFogMap(null); first.dispose(); next.dispose();
}

for (const name of ['default', 'island-towns', 'river-towns', 'twin-valleys', 'kasserine-pass']) {
  const map = JSON.parse(readFileSync(new URL(`./maps/${name}.json`, import.meta.url), 'utf8'));
  const water = createWater(map.rows.map(row => [...row]), map, () => 0);
  if (water) {
    assert.ok(Array.from(water.geometry.attributes.position.array).every(Number.isFinite), `${name}: finite map water`);
    water.dispose();
  }
}
console.log('world-edge water and server fog checks passed');
