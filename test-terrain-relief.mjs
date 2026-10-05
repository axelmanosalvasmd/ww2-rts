import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CELL, CFG, levelOf } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';
import { createRelief, TRENCH_DEPTH } from './client/relief.js';
import { WATER_LIFT } from './client/water-levels.js';
const cameraSource = readFileSync(new URL('./client/camera.js', import.meta.url), 'utf8')
  .replace("from 'three'", `from '${import.meta.resolve('three')}'`)
  .replace("from '/shared/sim.js'", `from '${new URL('./shared/sim.js', import.meta.url)}'`);
const { groundAt } = await import('data:text/javascript;base64,' + Buffer.from(cameraSource).toString('base64'));

const L = CFG.levelHeight, EPS = 1e-6;
const close = (actual, expected, label, tolerance = EPS) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual} (tolerance ${tolerance})`);
};
const levelChar = value => value < 0 ? String.fromCharCode(96 - value) : String(value);
const makeMap = (w, h, height, terrain = () => '.') => ({
  w, h,
  rows: Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => terrain(x, z)).join('')),
  heights: Array.from({ length: h }, (_, z) => Array.from({ length: w }, (_, x) => levelChar(height(x, z))).join('')),
});
const at = (relief, x, z) => relief.hAt(x * CELL, z * CELL);
const key = (x, z) => `${x},${z}`;
const nominal = (map, x, z) => levelOf(map.heights[z][x]) * L;

function surfaceNodes(geometry, wanted) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal, nodes = new Map();
  for (let i = 0; i < position.count; i++) {
    if (normal.getY(i) <= 0) continue;
    const k = key(position.getX(i), position.getZ(i));
    if (wanted && !wanted.has(k)) continue;
    if (!nodes.has(k)) nodes.set(k, []);
    nodes.get(k).push({ height: position.getY(i), normal: new THREE.Vector3().fromBufferAttribute(normal, i) });
  }
  return nodes;
}

function normalAt(relief, x, z, label) {
  const hit = firstHit(meshOracle(relief), new THREE.Vector3(x * CELL, 20, z * CELL), new THREE.Vector3(0, -1, 0));
  assert.ok(hit?.normal, `${label}: actual surface must provide a shading normal`);
  return hit.normal.normalize();
}

function checkCenters(map, relief, label) {
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    close(at(relief, x + 0.5, z + 0.5), nominal(map, x, z), `${label}: center ${x},${z}`);
  }
}

function checkBounds(map, relief, min, max, label) {
  for (let z = 0; z < map.h * 8; z++) for (let x = 0; x < map.w * 8; x++) {
    const value = at(relief, (x + 0.37) / 8, (z + 0.61) / 8);
    assert.ok(value >= min - EPS && value <= max + EPS, `${label}: interpolation overshoots at ${x},${z}: ${value}`);
  }
}

function checkMonotonic(relief, from, to, low, high, label) {
  const sign = Math.sign(high - low), steps = 64;
  let previous = low;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, value = at(relief, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    assert.ok(value >= Math.min(low, high) - EPS && value <= Math.max(low, high) + EPS,
      `${label}: leaves endpoint bounds at ${t}: ${value}`);
    assert.ok((value - previous) * sign >= -EPS, `${label}: reverses at ${t}: ${previous} to ${value}`);
    previous = value;
  }
  close(previous, high, `${label}: endpoint`);
}

function dryEdges(map) {
  const edges = [];
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (x + dx < map.w && z + dz < map.h && Math.abs(nominal(map, x, z) - nominal(map, x + dx, z + dz)) < 2 * L) {
        edges.push({ x, z, dx, dz });
      }
    }
  }
  return edges;
}

function checkSeams(relief, edges, label, nodes = surfaceNodes(relief.geometry)) {
  let normalPairs = 0;
  for (const { x, z, dx, dz } of edges) {
    for (const t of [0.173, 0.25, 0.5, 0.731]) {
      const u = x + (dx ? 1 : t), v = z + (dz ? 1 : t);
      close(at(relief, u - dx * 1e-8, v - dz * 1e-8), at(relief, u + dx * 1e-8, v + dz * 1e-8),
        `${label}: closed edge ${x},${z}/${dx},${dz} at ${t}`, 2e-6);
    }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const u = (x + (dx ? 1 : t)) * CELL, v = (z + (dz ? 1 : t)) * CELL;
      const matches = nodes.get(key(u, v)) ?? [];
      // Corners beside cliffs can also contain owners on the other cliff side.
      for (let i = 0; i < matches.length; i++) for (let j = i + 1; j < matches.length; j++) {
        if (Math.abs(matches[i].height - matches[j].height) > EPS) continue;
        assert.ok(matches[i].normal.distanceTo(matches[j].normal) < 2e-6,
          `${label}: shared normals at ${u},${v}: ${matches[i].normal.toArray()} vs ${matches[j].normal.toArray()}`);
        normalPairs++;
      }
    }
  }
  return normalPairs;
}

// A separate Mesh keeps the standard Three.js triangle query. Relief overrides its own raycast.
// Loose cliff rock models (rock paint between 0 and 1) are visual only, so the oracle leaves them out.
function meshOracle(relief, geometry = relief.geometry) {
  const paint = geometry.attributes.reliefPaint, index = geometry.index?.array;
  const loose = t => paint.getX(index[t]) > 0 && paint.getX(index[t]) < 1;
  if (paint && index) {
    const kept = [];
    for (let t = 0; t < index.length; t += 3) if (!loose(t)) kept.push(index[t], index[t + 1], index[t + 2]);
    if (kept.length !== index.length) { geometry = geometry.clone(); geometry.setIndex(kept); }
  }
  const mesh = new THREE.Mesh(geometry, relief.mesh.material);
  mesh.updateMatrixWorld(true);
  assert.equal(mesh.raycast, THREE.Mesh.prototype.raycast);
  assert.notEqual(relief.mesh.raycast, mesh.raycast);
  return mesh;
}

function firstHit(mesh, origin, direction, near = 0, far = 80) {
  return new THREE.Raycaster(origin, direction.clone().normalize(), near, far).intersectObject(mesh, false)[0];
}

function checkSurface(relief, oracle, points, label) {
  for (const [u, v] of points) {
    const x = u * CELL, z = v * CELL;
    const hit = firstHit(oracle, new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
    assert.ok(hit, `${label}: triangle surface exists at ${u},${v}`);
    close(relief.hAt(x, z), hit.point.y, `${label}: actual triangle height ${u},${v}`, 2e-5);
  }
}

function checkPicking(relief, oracle, origin, direction, label, near = 0, far = 80) {
  const expected = firstHit(oracle, origin, direction, near, far);
  const actual = firstHit(relief.mesh, origin, direction, near, far);
  assert.equal(Boolean(actual), Boolean(expected), `${label}: triangle and relief hit existence`);
  if (!expected) return;
  close(actual.distance, expected.distance, `${label}: first hit distance`, 2e-5);
  assert.ok(actual.point.distanceTo(expected.point) < 2e-5,
    `${label}: picked ${actual.point.toArray()}, actual mesh ${expected.point.toArray()}`);
}

function checkQueries(relief, points, label, oracle = meshOracle(relief)) {
  checkSurface(relief, oracle, points, label);
  const pickingPoints = Array.from({ length: Math.min(8, points.length) }, (_, i) => points[Math.floor((i + 0.5) * points.length / Math.min(8, points.length))]);
  for (const [u, v] of pickingPoints) {
    const target = new THREE.Vector3(u * CELL, at(relief, u, v), v * CELL);
    checkPicking(relief, oracle, target.clone().add(new THREE.Vector3(0, 8, 0)), new THREE.Vector3(0, -1, 0), `${label}: vertical ${u},${v}`);
    for (const offset of [new THREE.Vector3(-0.71, 6, 0.43), new THREE.Vector3(0.63, 6, -0.37)]) {
      checkPicking(relief, oracle, target.clone().add(offset), offset.clone().negate(), `${label}: oblique ${u},${v}/${offset.x}`);
    }
  }
}

const interiorPoints = map => {
  const points = [];
  for (let z = 1; z < map.h - 1; z++) for (let x = 1; x < map.w - 1; x++) {
    // These points avoid quarter-cell nodes and both triangle diagonals.
    points.push([x + 0.137, z + 0.291], [x + 0.683, z + 0.817]);
  }
  return points;
};

function checkSameRelief(incremental, fresh, map, label) {
  assert.deepEqual(incremental.geometry.index.array, fresh.geometry.index.array, `${label}: triangle topology`);
  for (const [name, attribute] of Object.entries(fresh.geometry.attributes)) {
    assert.deepEqual(incremental.geometry.attributes[name].array, attribute.array, `${label}: ${name}`);
  }
  for (const [u, v] of interiorPoints(map)) close(at(incremental, u, v), at(fresh, u, v), `${label}: query ${u},${v}`);
  assert.equal(incremental.stats.cliffEdges, fresh.stats.cliffEdges, `${label}: cliff topology`);
}

const start = performance.now();
const failures = [];
for (const low of [true, false]) {
  const quality = low ? 'low' : 'high';
  const failuresBeforeQuality = failures.length;
  const rampLevels = [0, 0, 0, 1, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0];
  const rampMap = makeMap(rampLevels.length, 7, x => rampLevels[x]);
  const ramp = createRelief(rampMap, rampMap.rows, { low });
  try {
    checkCenters(rampMap, ramp, `${quality} ramp`);
    checkBounds(rampMap, ramp, 0, 4 * L, `${quality} ramp`);
    const nodes = surfaceNodes(ramp.geometry);
    for (const [axis, map] of [['x', rampMap], ['z', makeMap(7, rampLevels.length, (_, z) => rampLevels[z])]]) {
      const relief = axis === 'x' ? ramp : createRelief(map, map.rows, { low });
      try {
        for (const [cell, sign] of [[3, 1], [4, 1], [5, 1], [10, -1], [11, -1]]) {
          const u = axis === 'x' ? cell + 0.5 : 3.5, v = axis === 'z' ? cell + 0.5 : 3.5;
          const delta = 0.001, du = axis === 'x' ? delta : 0, dv = axis === 'z' ? delta : 0;
          const left = (at(relief, u, v) - at(relief, u - du, v - dv)) / (delta * CELL);
          const right = (at(relief, u + du, v + dv) - at(relief, u, v)) / (delta * CELL);
          assert.ok(left * sign > 0.7 * L / CELL && right * sign > 0.7 * L / CELL,
            `${quality} ${axis} ramp: no shelf through center ${cell}: derivatives ${left},${right}`);
          const normal = normalAt(relief, u, v, `${quality} ${axis} ramp center ${cell}`);
          close(-(axis === 'x' ? normal.x : normal.z) / normal.y, sign * L / CELL, `${quality} ${axis} ramp: inclined center normal`, 2e-6);
        }
      } finally { if (relief !== ramp) relief.dispose(); }
    }
    for (let x = 0; x < rampMap.w - 1; x++) {
      checkMonotonic(ramp, [x + 0.5, 3.5], [x + 1.5, 3.5], rampLevels[x] * L, rampLevels[x + 1] * L, `${quality} ramp ${x}`);
    }
    for (const u of [7.013, 7.5, 7.991]) for (const v of [2.137, 3.5, 4.817]) close(at(ramp, u, v), 4 * L, `${quality}: flat plateau`);
    const top = normalAt(ramp, 6.5, 3.5, `${quality}: summit center`);
    close(top.x, 0, `${quality}: summit horizontal normal`); close(top.y, 1, `${quality}: summit upright normal`);
    assert.ok(checkSeams(ramp, dryEdges(rampMap), `${quality} ramp`, nodes) > 20, `${quality}: shared normals exercised`);
    checkQueries(ramp, interiorPoints(rampMap), `${quality} ramp`);
    const oracle = meshOracle(ramp);
    checkPicking(ramp, oracle, new THREE.Vector3(-2, 1, -2), new THREE.Vector3(0, -1, 0), `${quality}: outside map miss`);
    checkPicking(ramp, oracle, new THREE.Vector3(9, 11, 7), new THREE.Vector3(0, -1, 0), `${quality}: clipped ray`, 0, 2);
  } finally { ramp.dispose(); }

  const grazingMap = makeMap(32, 3, x => x === 10 ? 1 : 0);
  const grazing = createRelief(grazingMap, grazingMap.rows, { low });
  try {
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(0.01, 17.192, 3);
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(1, -Math.tan(0.95), 0)));
    camera.updateMatrixWorld(true);
    const pixel = { x: 400, y: 32.24449155576905 };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 1 - pixel.y / 400), camera);
    const expected = raycaster.intersectObject(meshOracle(grazing), false)[0];
    assert.ok(expected && expected.point.x > 20.9 && expected.point.x < 21.1 && expected.point.y > 2.49,
      `${quality}: grazing ray touches the visible crest`);
    const actual = groundAt(camera, grazing.hAt, pixel.x, pixel.y, 800, 800, grazingMap.w * CELL, grazingMap.h * CELL, grazing.mesh);
    assert.ok(actual && actual.distanceTo(expected.point) < 2e-5,
      `${quality}: game picking must hit the grazing crest instead of the ground behind it`);
    checkPicking(grazing, meshOracle(grazing), raycaster.ray.origin, raycaster.ray.direction, `${quality}: grazing crest`);
  } finally { grazing.dispose(); }

  const edgeMap = makeMap(32, 20, () => 0), edgeRelief = createRelief(edgeMap, edgeMap.rows, { low });
  try {
    const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 0.1, 500);
    for (const distance of [40, 60]) {
      camera.position.set(32, distance * Math.sin(0.95), 20 + distance * Math.cos(0.95));
      camera.lookAt(32, 0, 20); camera.updateMatrixWorld(true);
      const corners = [[0, 0], [1920, 0], [1920, 1080], [0, 1080]].map(([x, y]) => {
        const point = groundAt(camera, edgeRelief.hAt, x, y, 1920, 1080, 64, 40, edgeRelief.mesh);
        const previous = groundAt(camera, edgeRelief.hAt, x, y, 1920, 1080, 64, 40);
        assert.ok(point && previous && point.distanceTo(previous) < 2e-5,
          `${quality}: viewport corner keeps its plane fallback outside the map at zoom ${distance}`);
        return point;
      });
      assert.equal(corners.length, 4, `${quality}: minimap viewport keeps all four corners`);
    }
  } finally { edgeRelief.dispose(); }

  for (const axis of ['x', 'z']) for (const descending of [false, true]) {
    const map = makeMap(32, 20, (x, z) => ((axis === 'x' ? x < 16 : z < 10) !== descending) ? 4 : 0);
    const relief = createRelief(map, map.rows, { low }), oracle = meshOracle(relief);
    try {
      const origin = new THREE.Vector3(32, 20, 20), direction = new THREE.Vector3(0, -1, 0.7);
      if (axis === 'z') direction.set(0.7, -1, 0);
      checkPicking(relief, oracle, origin, direction, `${quality}: parallel ${axis} cliff ${descending ? 'descending' : 'ascending'}`);
      const vertical = firstHit(relief.mesh, origin, new THREE.Vector3(0, -1, 0));
      const visible = firstHit(oracle, origin, new THREE.Vector3(0, -1, 0));
      close(vertical.point.y, visible.point.y, `${quality}: vertical cliff ray follows the reshaped visible face`);
      const plateau = origin.clone();
      if (axis === 'x') plateau.x += descending ? 1 : -1;
      else plateau.z += descending ? 1 : -1;
      close(firstHit(relief.mesh, plateau, new THREE.Vector3(0, -1, 0)).point.y, 4 * L,
        `${quality}: plateau beside the reshaped cliff retains its height`);
    } finally { relief.dispose(); }
  }

  const shapes = [
    ['isolated hill', makeMap(7, 7, (x, z) => x === 3 && z === 3 ? 1 : 0), 0, L],
    ['isolated hollow', makeMap(7, 7, (x, z) => x === 3 && z === 3 ? -1 : 0), -L, 0],
    ['diagonal hills', makeMap(7, 7, (x, z) => (x === 2 && z === 2) || (x === 3 && z === 3) ? 1 : 0), 0, L],
    ['saddle', makeMap(7, 7, (x, z) => z === 3 && (x === 2 || x === 4) ? 2 : x === 3 && (z === 2 || z === 4) ? 0 : 1), 0, 2 * L],
    ['cliff junction', makeMap(7, 7, (x, z) => z >= 4 ? 1 : x >= 3 ? 2 : 0), 0, 2 * L],
  ];
  for (const [name, map, min, max] of shapes) {
    const relief = createRelief(map, map.rows, { low }), label = `${quality} ${name}`;
    try {
      checkCenters(map, relief, label); checkBounds(map, relief, min, max, label);
      assert.equal(relief.stats.cliffEdges, name === 'cliff junction' ? 4 : 0, `${label}: preserves cliff topology`);
      assert.ok(checkSeams(relief, dryEdges(map), label) > 10, `${label}: shared normals exercised`);
      if (name.startsWith('isolated')) {
        const peak = name === 'isolated hill' ? L : -L;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          checkMonotonic(relief, [3.5, 3.5], [3.5 + dx, 3.5 + dz], peak, 0, `${label}: flank ${dx},${dz}`);
        }
        const normal = normalAt(relief, 3.5, 3.5, label);
        close(normal.y, 1, `${label}: extremum normal`);
      } else if (name === 'diagonal hills') {
        close(at(relief, 3, 3), L / 2, `${label}: connected diagonal corner`);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) close(at(relief, 2.5 + t, 2.5 + t), at(relief, 3.5 - t, 3.5 - t), `${label}: balanced diagonal`);
      } else if (name === 'saddle') {
        assert.ok(at(relief, 3.75, 3.5) > L && at(relief, 3.5, 3.75) < L, `${label}: rises and falls along distinct axes`);
        close(normalAt(relief, 3.5, 3.5, label).y, 1, `${label}: stationary saddle center`);
      } else {
        const junction = at(relief, 3, 4);
        assert.ok(junction > L * 0.5 && junction < L * 1.5, `${label}: reshaped junction retains its intermediate ramp`);
        checkQueries(relief, [[3, 4]], `${label}: visible junction contact`);
        close(at(relief, 2.5, 3.5), 0, `${label}: lower cliff-side cell stays level`);
        close(at(relief, 3.5, 3.5), 2 * L, `${label}: upper cliff-side cell stays level`);
      }
      checkQueries(relief, interiorPoints(map), label);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${label}: ${error.message}`);
    } finally { relief.dispose(); }
  }

  for (const axis of ['x', 'z']) for (const descending of [false, true]) {
    const profile = [0, 1, 2, 2, 4, 4, 4, 4];
    if (descending) profile.reverse();
    const map = axis === 'x' ? makeMap(8, 7, x => profile[x]) : makeMap(7, 8, (_, z) => profile[z]);
    const relief = createRelief(map, map.rows, { low }), label = `${quality} ${axis} ramp beside ${descending ? 'descending' : 'ascending'} cliff`;
    try {
      checkCenters(map, relief, label);
      assert.equal(relief.stats.cliffEdges, 7, `${label}: retains seven authoritative cliff edges`);
      const u = axis === 'x' ? 4 : 3.37, v = axis === 'z' ? 4 : 3.37;
      close(at(relief, u - (axis === 'x' ? 0.5 : 0), v - (axis === 'z' ? 0.5 : 0)), (descending ? 4 : 2) * L, `${label}: left plateau height`);
      close(at(relief, u + (axis === 'x' ? 0.5 : 0), v + (axis === 'z' ? 0.5 : 0)), (descending ? 2 : 4) * L, `${label}: right plateau height`);
      checkSeams(relief, dryEdges(map), label);
      checkQueries(relief, interiorPoints(map), label);
      const oracle = meshOracle(relief), origin = new THREE.Vector3(u * CELL, 3 * L, v * CELL);
      const direction = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      if (descending) direction.negate();
      origin.addScaledVector(direction, -0.7);
      const wall = firstHit(oracle, origin, direction);
      assert.ok(wall && Math.abs(wall.face.normal.y) < 0.9, `${label}: actual steep rock face exists`);
      assert.ok(Math.abs(wall.distance - 0.7) < 1.25, `${label}: reshaped wall stays beside the authored boundary`);
      checkPicking(relief, oracle, origin, direction, `${label}: horizontal wall picking`);
      checkPicking(relief, oracle, origin.clone().add(new THREE.Vector3(0, 0.2, 0)), direction.clone().add(new THREE.Vector3(0, -0.3, 0)), `${label}: oblique wall picking`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${label}: ${error.message}`);
    } finally { relief.dispose(); }
  }

  const updateMap = makeMap(13, 11, x => Math.max(0, Math.min(3, x - 3)));
  const grid = updateMap.rows.map(row => [...row]), incremental = createRelief(updateMap, grid, { low });
  try {
    const before = normalAt(incremental, 4.5, 5.5, `${quality}: initial neighboring tangent`).clone();
    for (const [x, z, value] of [[5, 5, 1], [8, 5, 0], [0, 0, 1]]) {
      updateMap.heights[z] = updateMap.heights[z].slice(0, x) + levelChar(value) + updateMap.heights[z].slice(x + 1);
      incremental.update([z * updateMap.w + x]);
      const fresh = createRelief(updateMap, grid, { low });
      try { checkSameRelief(incremental, fresh, updateMap, `${quality} dry update ${x},${z}`); }
      finally { fresh.dispose(); }
      assert.ok(incremental.stats.cellsUpdated <= 49 && incremental.stats.cellsUpdated < updateMap.w * updateMap.h, `${quality}: dry update rebuilds a bounded neighborhood`);
      if (x === 5) {
        const after = normalAt(incremental, 4.5, 5.5, `${quality}: changed neighboring tangent`);
        assert.ok(before.distanceTo(after) > 0.1, `${quality}: unchanged neighboring center receives its changed tangent`);
        close(at(incremental, 4.5, 5.5), L, `${quality}: neighboring center height stays fixed`);
      }
    }
    checkQueries(incremental, interiorPoints(updateMap), `${quality}: updated surface`);
  } finally { incremental.dispose(); }

  const trenchMap = makeMap(9, 8, () => 1, (x, z) => (z === 3 && x >= 2 && x <= 5) || (x === 4 && z >= 3 && z <= 5) ? 'T' : '.');
  const trench = createRelief(trenchMap, trenchMap.rows, { low });
  try {
    for (const [u, v] of [[2.5, 3.5], [3, 3.5], [4, 3.5], [4.5, 4], [4.5, 5], [4.5, 5.5]]) close(at(trench, u, v), L - TRENCH_DEPTH, `${quality}: connected trench floor ${u},${v}`);
    close(at(trench, 2, 3.5), L, `${quality}: closed trench end keeps its bank`);
    close(at(trench, 3.5, 3), L, `${quality}: outside trench lip remains level`);
    close(at(trench, 1.5, 3.5), L, `${quality}: neighboring dry center remains level`);
    checkQueries(trench, interiorPoints(trenchMap), `${quality}: trench mesh`);
  } finally { trench.dispose(); }

  const wetMap = makeMap(11, 9,
    (x, z) => z >= 3 && z <= 5 && x >= 1 && x <= 9 && x !== 5 ? 0 : 1,
    (x, z) => z >= 3 && z <= 5 && x >= 1 && x <= 9 ? x === 5 ? '=' : x === 3 && z === 4 ? 'F' : 'W' : x === 9 && z === 7 ? 'W' : '.');
  const wetGrid = wetMap.rows.map(row => [...row]), wet = createRelief(wetMap, wetGrid, { low });
  try {
    for (const [x, z] of [[2, 4], [3, 4], [5, 3], [5, 4], [5, 5], [8, 4]]) close(wet.waterAt((x + 0.5) * CELL, (z + 0.5) * CELL), WATER_LIFT, `${quality}: connected water line across bridge ${x},${z}`);
    close(wet.waterAt(9.5 * CELL, 7.5 * CELL), L + WATER_LIFT, `${quality}: separate pond retains its own water line`);
    for (const z of [3.5, 4.5, 5.5]) close(at(wet, 5.5, z), L, `${quality}: bridge deck retains nominal height`);
    assert.ok(at(wet, 2.5, 4.5) < WATER_LIFT - 0.4, `${quality}: river bed remains below water`);
    close(at(wet, 3.5, 4.5), WATER_LIFT - 0.15, `${quality}: ford remains shallow`);
    for (const v of [3.173, 4.5, 5.731]) for (const u of [5, 6]) close(at(wet, u - 1e-8, v), at(wet, u + 1e-8, v), `${quality}: closed bridge-bank seam`, 2e-6);
    checkQueries(wet, interiorPoints(wetMap), `${quality}: water and bridge mesh`);
    wetGrid[4][5] = 'W'; wet.update([4 * wetMap.w + 5]);
    assert.ok(at(wet, 5.5, 4.5) < WATER_LIFT, `${quality}: destroyed bridge reveals the bed`);
    close(wet.waterAt(5.5 * CELL, 4.5 * CELL), WATER_LIFT, `${quality}: bridge destruction preserves connected water line`);
    const fresh = createRelief(wetMap, wetGrid, { low });
    try { checkSameRelief(wet, fresh, wetMap, `${quality}: bridge destruction`); }
    finally { fresh.dispose(); }
  } finally { wet.dispose(); }
  console.log(`${failures.length === failuresBeforeQuality ? 'PASS' : 'CHECKED'} terrain relief ${quality}: ramps, centers, bounds, tops, hills, saddles, cliffs, seams, independent triangle queries, incremental tangents, trenches and water bridges (${failures.length - failuresBeforeQuality} failures)`);
}

// One scan extracts original triangle indices for a few patches, including merged flat runs.
// Repeated full-map standard raycasts would multiply work by every sampled point.
function patchOracles(relief, rectangles) {
  const source = relief.geometry, positions = source.attributes.position.array, indices = source.index.array;
  const selected = rectangles.map(() => []);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const minX = Math.min(positions[a], positions[b], positions[c]), maxX = Math.max(positions[a], positions[b], positions[c]);
    const minZ = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]), maxZ = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]);
    for (let j = 0; j < rectangles.length; j++) {
      const [x0, z0, x1, z1] = rectangles[j];
      if (maxX >= x0 && minX <= x1 && maxZ >= z0 && minZ <= z1) selected[j].push(indices[i], indices[i + 1], indices[i + 2]);
    }
  }
  return selected.map((index, i) => {
    assert.ok(index.length > 0 && index.length < source.index.count / 20, `full world: patch ${i} is bounded and nonempty`);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position); geometry.setAttribute('normal', source.attributes.normal); geometry.setIndex(index);
    geometry.boundingBox = source.boundingBox.clone(); geometry.boundingSphere = source.boundingSphere.clone();
    return meshOracle(relief, geometry);
  });
}

const generatedWorldMap = generateWorldMap({ seed: 20261003, size: 'huge', players: 4 });
assert.equal(generatedWorldMap.w, 512); assert.equal(generatedWorldMap.h, 512);
const originalRows = generatedWorldMap.rows.slice(), originalHeights = generatedWorldMap.heights.slice();
const dry = (x, z) => {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ch = generatedWorldMap.rows[z + dz]?.[x + dx];
    if (!ch || 'WF=TR+'.includes(ch)) return false;
  }
  return true;
};
const sampledEdges = [];
let slope, cliff;
for (let z = 2; z < 510; z++) for (let x = 2; x < 510; x++) {
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    if (!dry(x, z) || !dry(x + dx, z + dz)) continue;
    const difference = Math.abs(nominal(generatedWorldMap, x, z) - nominal(generatedWorldMap, x + dx, z + dz));
    const edge = { x, z, dx, dz };
    if (!slope && difference === L) slope = edge;
    if (!cliff && difference >= 2 * L) cliff = edge;
    if (x % 29 === 7 && z % 29 === 11 && difference < 2 * L) sampledEdges.push(edge);
  }
}
assert.ok(slope && cliff, 'full generated world contains an ordinary dry slope and a genuine dry cliff');
sampledEdges.push(slope);
const world = createRelief(generatedWorldMap, generatedWorldMap.rows, { low: true });
let oracles = [];
try {
  let sampledCenters = 0;
  for (let z = 15; z < 512; z += 31) for (let x = 15; x < 512; x += 31) {
    const height = at(world, x + 0.5, z + 0.5);
    assert.ok(Number.isFinite(height), `full world: finite sampled center ${x},${z}`);
    if (dry(x, z)) { close(height, nominal(generatedWorldMap, x, z), `full world: dry center ${x},${z}`); sampledCenters++; }
  }
  assert.ok(sampledCenters > 100 && sampledEdges.length > 100, 'full world: centers and dry shared edges span the complete map');
  const wanted = new Set();
  for (const { x, z, dx, dz } of sampledEdges) for (const t of [0, 0.25, 0.5, 0.75, 1]) wanted.add(key((x + (dx ? 1 : t)) * CELL, (z + (dz ? 1 : t)) * CELL));
  assert.ok(checkSeams(world, sampledEdges, 'full world', surfaceNodes(world.geometry, wanted)) > 50, 'full world: sampled actual shared normals');
  oracles = patchOracles(world, [slope, cliff].map(({ x, z }) => [(x - 2) * CELL, (z - 2) * CELL, (x + 4) * CELL, (z + 4) * CELL]));
  for (const [i, edge] of [slope, cliff].entries()) {
    const { x, z, dx, dz } = edge;
    const points = [[x + 0.137, z + 0.291], [x + 0.683, z + 0.817], [x + dx + 0.137, z + dz + 0.291], [x + dx + 0.683, z + dz + 0.817]];
    checkQueries(world, points, `full world ${i === 0 ? 'ordinary slope' : 'genuine cliff'} ${x},${z}`, oracles[i]);
    for (const [cx, cz] of [[x, z], [x + dx, z + dz]]) close(at(world, cx + 0.5, cz + 0.5), nominal(generatedWorldMap, cx, cz), `full world: feature center ${cx},${cz}`);
  }
  const { x, z, dx, dz } = cliff;
  const u = x + (dx ? 1 : 0.5), v = z + (dz ? 1 : 0.5);
  const a = at(world, u - dx * 1e-8, v - dz * 1e-8), b = at(world, u + dx * 1e-8, v + dz * 1e-8);
  assert.ok(Math.abs(a - b) >= L, 'full world: genuine cliff retains distinct side heights');
  const direction = new THREE.Vector3(dx, 0, dz).multiplyScalar(a < b ? 1 : -1);
  const origin = new THREE.Vector3(u * CELL, (a + b) / 2, v * CELL).addScaledVector(direction, -0.2);
  const wall = firstHit(oracles[1], origin, direction);
  assert.ok(wall && Math.abs(wall.face.normal.y) < EPS, 'full world: genuine cliff has an actual vertical triangle wall');
  checkPicking(world, oracles[1], origin, direction, 'full world: genuine cliff wall picking');
  assert.deepEqual(generatedWorldMap.rows, originalRows, 'relief tests preserve authoritative generated terrain');
  assert.deepEqual(generatedWorldMap.heights, originalHeights, 'relief tests preserve authoritative generated elevations');
  console.log(`PASS terrain relief full world: seed 20261003, 512x512, ${sampledCenters} dry centers, ${sampledEdges.length} dry edges, independent slope and cliff triangle queries`);
} catch (error) {
  failures.push(error);
  console.error(`FAIL full world: ${error.message}`);
} finally {
  for (const oracle of oracles) oracle.geometry.dispose();
  world.dispose();
}
if (failures.length) throw new AggregateError(failures, `${failures.length} terrain relief checks failed`);
console.log(`PASS terrain relief suite (${((performance.now() - start) / 1000).toFixed(2)}s)`);
