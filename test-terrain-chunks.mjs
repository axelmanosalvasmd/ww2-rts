// Relief and water are drawn in chunks (client/chunk-jobs.js). A change redraws only the chunks that read it, a deferred
// redraw shows a few chunks per frame without opening a seam or showing an outdated build, the logical ground (hAt,
// picking) follows at once, and the result is the same as a fresh build of the final terrain.
// Plain asserts: `node test.js` runs this file as one child (test.js childFiles), so no check filter applies inside.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CELL } from './shared/sim.js';
import { createChunkJobs } from './client/chunk-jobs.js';
import { createRelief } from './client/relief.js';
import { createWater } from './client/water.js';

// The scheduler: budget, coalescing, seam holding, outdated builds, the wait limit and cancel.
{
  let t = 0;
  const built = [], shown = [], dropped = [];
  const jobs = createChunkJobs({ cols: 4, rows: 1, now: () => t, maxWaitMs: 100,
    build: i => { t += 5; built.push(i); return { i, n: built.length }; }, // every build overruns a 4 ms budget
    publish: (i, result) => shown.push([i, result.n]), discard: result => dropped.push(result.i) });

  // a build over budget still runs, one per call; a chunk with no waiting neighbour shows at once
  jobs.mark(0); jobs.mark(0); jobs.mark(2);
  assert.equal(jobs.run(4), 1);
  assert.deepEqual(built, [0], 'one build per call when one build overruns the budget, the double mark built once');
  assert.deepEqual(shown, [[0, 1]]);
  assert.ok(jobs.pending(2) && !jobs.pending(0));
  jobs.run(4);
  assert.deepEqual(shown.at(-1), [2, 2]);

  // neighbours show together: chunk 1 waits for chunk 2
  built.length = shown.length = 0;
  jobs.mark(1); jobs.mark(2);
  assert.equal(jobs.run(4), 0, 'built chunk 1 waits while its neighbour is still to build');
  assert.ok(jobs.pending(1));
  assert.equal(jobs.run(4), 2, 'both sides of the shared edge show in the same frame');
  assert.deepEqual(shown.map(([i]) => i).sort(), [1, 2]);

  // a chunk marked again after its build drops that build; only the newer one is shown
  built.length = shown.length = dropped.length = 0;
  jobs.mark(2); jobs.mark(3);
  jobs.run(4); // builds 2, held by 3
  jobs.mark(2); // the terrain under 2 changed again
  assert.deepEqual(dropped, [2], 'the outdated build is discarded');
  while (jobs.waiting) jobs.run(4);
  assert.deepEqual(built, [2, 3, 2]);
  const two = shown.filter(([i]) => i === 2);
  assert.deepEqual(two, [[2, 3]], 'chunk 2 shows only its newest build');

  // a held chunk is shown anyway after maxWaitMs, so changes nearby cannot hold it for ever
  shown.length = 0;
  jobs.mark(0); jobs.mark(1);
  jobs.run(4); // builds 0, held by 1
  t += 200; jobs.mark(2);
  jobs.run(4); // builds 1, held by 2, but 0 and 1 have waited too long
  assert.deepEqual(shown.map(([i]) => i).sort(), [0, 1]);
  assert.ok(jobs.pending(2));

  // cancel drops queued and built work; nothing is built or shown after it
  built.length = shown.length = dropped.length = 0;
  jobs.run(4);
  jobs.mark(0); jobs.mark(1);
  jobs.run(4); // builds 0, held by 1
  jobs.cancel();
  assert.deepEqual(dropped, [0]);
  jobs.mark(3);
  assert.equal(jobs.run(4), 0); assert.equal(jobs.flush(), 0);
  assert.equal(jobs.waiting, 0);
  assert.deepEqual(built, [2, 0]);
  assert.deepEqual(shown, [[2, 1]]);
}

// The wait limit counts from a chunk's build, not from its mark: a long queue does not use it up, and built neighbours
// held together are shown together (a crack would open between them otherwise).
{
  let t = 0;
  const shown = [];
  const jobs = createChunkJobs({ cols: 4, rows: 1, now: () => t, maxWaitMs: 100,
    build: i => { t += 5; return i; }, publish: i => shown.push(i) });
  jobs.mark(0); jobs.mark(1);
  t += 1000; // queued behind a long backlog
  jobs.run(4); // builds 0, its neighbour 1 is still to build
  assert.deepEqual(shown, [], 'time spent queued does not count against the wait');
  t += 85; jobs.mark(2);
  jobs.run(4); // builds 1, held by 2 together with 0
  assert.deepEqual(shown, []);
  t += 10; jobs.mark(3);
  jobs.run(4); // builds 2; 0 has now waited too long, so 0, 1 and 2 show in one frame
  assert.deepEqual(shown.sort(), [0, 1, 2], 'a held group is shown whole');
  assert.ok(jobs.pending(3));
}

// A map of terraces (one-level steps), a plateau with cliffs across the border of chunks 0 and 1, and a river.
function terrain(w, h) {
  const level = (x, y) => x >= 40 && x < 90 && y >= 30 && y < 50 ? 5 : Math.floor((x + y) / 9) % 3;
  const grid = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => x === 110 || x === 111 ? 'W' : '.'));
  const heights = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => String(level(x, y))).join(''));
  return { map: { w, h, rows: grid.map(r => r.join('')), heights }, grid };
}
// writes [x, y, char, level] changes into the grid and map; returns the changed cells
function apply({ map, grid }, changes) {
  for (const [x, y, ch, lv] of changes) {
    grid[y][x] = ch;
    if (lv !== undefined) map.heights[y] = map.heights[y].slice(0, x) + String(lv) + map.heights[y].slice(x + 1);
  }
  map.rows = grid.map(r => r.join(''));
  return changes.map(([x, y]) => y * map.w + x);
}
const copy = ({ map, grid }) => ({ map: { ...map, rows: [...map.rows], heights: [...map.heights] }, grid: grid.map(r => [...r]) });
function sameGeometry(a, b, label) {
  assert.deepEqual(a.index.array, b.index.array, `${label}: triangles`);
  for (const [name, attribute] of Object.entries(b.attributes)) assert.deepEqual(a.attributes[name].array, attribute.array, `${label}: ${name}`);
}
// the triangles of a geometry over a window of cells, as a plain mesh for three's own raycast
function patch(geometry, x0, z0, x1, z1) {
  const p = geometry.attributes.position.array, index = geometry.index.array, kept = [];
  for (let t = 0; t < index.length; t += 3) {
    const xs = [0, 1, 2].map(k => p[index[t + k] * 3]), zs = [0, 1, 2].map(k => p[index[t + k] * 3 + 2]);
    if (Math.max(...xs) >= x0 * CELL && Math.min(...xs) <= x1 * CELL && Math.max(...zs) >= z0 * CELL && Math.min(...zs) <= z1 * CELL) kept.push(index[t], index[t + 1], index[t + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.attributes.position); g.setIndex(kept); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}
const down = new THREE.Vector3(0, -1, 0);
const top = (mesh, x, z) => new THREE.Raycaster(new THREE.Vector3(x, 50, z), down, 0, 100).intersectObject(mesh, false)[0]?.point.y;

// A change redraws only the chunks within reach of it, and the result equals a fresh build; across chunk borders the
// drawn surface is the same as one mesh over the whole map (no seam, no gap).
{
  const live = terrain(160, 136), relief = createRelief(live.map, live.grid, { low: false });
  assert.equal(relief.mesh.children.length, 9, 'three by three chunks of 64 cells');
  const scene = new THREE.Group(), fog = relief.drape(new THREE.MeshBasicMaterial());
  scene.add(fog);
  const rebuilt = cells => { const before = relief.jobs.built; relief.update(cells); return relief.jobs.built - before; };

  assert.equal(rebuilt(apply(live, [[20, 100, '.', 2]])), 1, 'a change deep inside chunk 3 redraws only chunk 3');
  assert.equal(rebuilt(apply(live, [[63, 63, '+', 1], [64, 64, '+', 0]])), 4, 'a crater on a chunk corner redraws the four chunks around it');
  rebuilt(apply(live, [[112, 10, 'W'], [113, 10, 'W']])); // wider river: the water line can move along the whole body
  relief.mesh.children.forEach((part, i) => assert.equal(fog.children[i].geometry, part.geometry, `the fog drape follows chunk ${i}`));

  const fresh = createRelief(copy(live).map, copy(live).grid, { low: false });
  sameGeometry(relief.geometry, fresh.geometry, 'after local updates');
  assert.equal(relief.stats.cliffEdges, fresh.stats.cliffEdges);

  // One chunk for the whole map is the oracle for the borders. Low quality: high quality spreads its fan triangles by
  // a budget per chunk, and a fan's shifted midpoint on a cliff bevel moves the surface a little. Samples sit off the
  // quarter-cell vertex lines, across the cliff and the crater at x = 64 and z = 64.
  const chunked = createRelief(copy(live).map, copy(live).grid, { low: true });
  const whole = createRelief(copy(live).map, copy(live).grid, { low: true, chunk: 1024 });
  assert.equal(whole.mesh.children.length, 1);
  let samples = 0;
  for (const [x0, z0, x1, z1, us, vs] of [
    [56, 24, 72, 72, Array.from({ length: 97 }, (_, k) => 58.03 + k / 8), [30.53, 40.03, 49.53, 62.03, 63.53, 64.03, 64.53, 66.03]],
    [14, 56, 72, 72, [20.03, 63.53, 64.03, 64.53], Array.from({ length: 97 }, (_, k) => 58.03 + k / 8)],
  ]) {
    const a = patch(chunked.geometry, x0, z0, x1, z1), b = patch(whole.geometry, x0, z0, x1, z1);
    for (const u of us) for (const v of vs) {
      const ya = top(a, u * CELL, v * CELL), yb = top(b, u * CELL, v * CELL);
      assert.equal(ya === undefined, yb === undefined, `surface exists at ${u},${v} in both`);
      if (yb !== undefined) { assert.ok(Math.abs(ya - yb) < 1e-5, `same height at ${u},${v}: ${ya} vs ${yb}`); samples++; }
      assert.ok(Math.abs(chunked.hAt(u * CELL, v * CELL) - whole.hAt(u * CELL, v * CELL)) < 1e-5, `same ground at ${u},${v}`);
    }
  }
  assert.ok(samples > 1000, `${samples} border samples`);
  chunked.dispose();
  relief.dispose(); fresh.dispose(); whole.dispose();
  assert.equal(fog.parent, null, 'disposing the relief takes its drapes out of the scene');
}

// Deferred: the logical ground follows at once, the drawn chunks a budget at a time; rapid updates coalesce, a
// rebuild started before a newer change is not shown, and the end state equals a fresh build.
{
  // more than 65536 cells: no detail triangles, so the logical surface alone answers hAt and picking
  const live = terrain(272, 256);
  const relief = createRelief(live.map, live.grid, { low: true, deferred: true });
  const drawn = relief.mesh.children.map(part => part.geometry);
  const cells = apply(live, [[64, 40, '+', 3], [63, 41, '+', 4], [130, 128, '.', 6]]);
  relief.update(cells);
  assert.ok(relief.pending > 0, 'chunks wait for tick()');
  assert.ok(relief.mesh.children.every((part, i) => part.geometry === drawn[i]), 'nothing is redrawn inside update()');
  const fresh = createRelief(copy(live).map, copy(live).grid, { low: true });
  for (const [x, y] of [[64, 40], [63, 41], [130, 128], [70, 40], [128, 130]]) for (const d of [0.1, 0.5, 0.9]) {
    assert.equal(relief.hAt((x + d) * CELL, (y + d) * CELL), fresh.hAt((x + d) * CELL, (y + d) * CELL), `logical ground at ${x},${y} before any redraw`);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(64.5 * CELL, 60, 40.5 * CELL), down, 0, 200);
  assert.equal(ray.intersectObject(relief.mesh, false)[0].point.y, ray.intersectObject(fresh.mesh, false)[0].point.y, 'picking follows at once');

  // a new change while one is half drawn: both coalesce, the outdated chunk builds are dropped
  relief.tick(0); // exactly one chunk built (at least one per call)
  assert.equal(relief.jobs.built, 1);
  const again = apply(live, [[65, 40, '+', 2]]);
  relief.update(again);
  let frames = 0;
  while (relief.pending && frames < 200) { relief.tick(0); frames++; }
  assert.equal(relief.pending, 0, 'every queued chunk is drawn');
  const final = createRelief(copy(live).map, copy(live).grid, { low: true });
  sameGeometry(relief.geometry, final.geometry, 'deferred after rapid updates');

  // dispose cancels what is queued: nothing is built or shown afterwards
  relief.update(apply(live, [[10, 10, '+', 0]]));
  const built = relief.jobs.built, published = relief.jobs.published;
  relief.dispose();
  assert.equal(relief.tick(4), 0);
  assert.equal(relief.jobs.built, built); assert.equal(relief.jobs.published, published);
  fresh.dispose(); final.dispose();
}

// Small maps (65536 cells or fewer) answer hAt and picking from the drawn cliff rocks and crater rims, so their chunks
// are redrawn inside update() even when deferred: props, decals and overlay rings placed right after an update read the
// same ground the chunks show, and it does not move under them on a later tick.
{
  const live = terrain(128, 128);
  const relief = createRelief(live.map, live.grid, { low: true, deferred: true });
  const changes = [];
  for (let y = 38; y <= 40; y++) for (let x = 60; x <= 69; x++) changes.push([x, y, '+', 0]);
  relief.update(apply(live, changes));
  assert.equal(relief.pending, 0, 'nothing waits on a small map');
  const fresh = createRelief(copy(live).map, copy(live).grid, { low: true });
  let moved = 0;
  for (let v = 33; v <= 46; v += 0.25) for (let u = 55; u <= 75; u += 0.25)
    if (Math.abs(relief.hAt(u * CELL, v * CELL) - fresh.hAt(u * CELL, v * CELL)) > 1e-5) moved++;
  assert.equal(moved, 0, 'the ground right after update() is the drawn ground');
  relief.dispose(); fresh.dispose();
}

// Water: a change redraws the chunks around the body that changed, not other bodies; vertices shared by two chunks
// agree; deferred redraws are bounded per tick and end equal to a fresh build.
{
  const W = 192, H = 128;
  const world = () => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => x === 20 || x === 21 || (x === 170 && y < 60) || (y === 64 && x >= 40 && x < 150) ? 'W' : '.'));
  const make = (grid, options) => createWater(grid, { w: W, h: H, rows: grid.map(r => r.join('')) }, () => 0, options);
  const grid = world(), water = make(grid);
  water.mask.onUpdate?.();
  // the stream at x = 170 lies in chunk 2 only; widening the river at x = 20 must leave its mesh alone
  const far = water.mesh.children.find(part => part.geometry.boundingSphere.center.x > 128 * CELL && part.geometry.boundingSphere.center.z < 64 * CELL);
  const farGeometry = far.geometry;
  grid[30][22] = 'W';
  water.changed([[30 * W + 22, 'W']]); water.tick(0);
  assert.equal(far.geometry, farGeometry, 'a separate body of water keeps its mesh');
  const fresh = make(grid.map(r => [...r]));
  for (const key of ['position', 'normal', 'flow']) assert.deepEqual(water.geometry.attributes[key].array, fresh.geometry.attributes[key].array, `water ${key}`);
  assert.deepEqual(water.geometry.index.array, fresh.geometry.index.array, 'water triangles');
  // every vertex drawn by two chunks has the same height and flow in both (the river at y = 64 crosses chunk borders)
  const seen = new Map();
  let shared = 0;
  for (const part of water.mesh.children) {
    const p = part.geometry.attributes.position.array, f = part.geometry.attributes.flow.array;
    for (let v = 0; v < p.length / 3; v++) {
      const key = `${p[v * 3]},${p[v * 3 + 2]}`, value = [p[v * 3 + 1], f[v * 2], f[v * 2 + 1]], other = seen.get(key);
      if (other) { assert.deepEqual(value, other, `shared water vertex ${key}`); shared++; } else seen.set(key, value);
    }
  }
  assert.ok(shared > 100, `${shared} shared border vertices`);
  water.dispose(); fresh.dispose();

  // deferred: a tick builds about its budget (budget 0: one chunk), and the rest wait
  const late = world(), slow = make(late, { deferred: true, budgetMs: 0 });
  for (let x = 40; x < 150; x++) late[65][x] = 'W';
  slow.changed(Array.from({ length: 110 }, (_, i) => [65 * W + 40 + i, 'W']));
  slow.tick(0);
  assert.equal(slow.jobs.built, 1, 'one chunk per tick at budget 0');
  assert.ok(slow.pending > 0);
  let ticks = 0;
  while (slow.pending && ticks < 100) { slow.tick(0); ticks++; }
  const fresher = make(late.map(r => [...r]));
  assert.deepEqual(slow.geometry.attributes.position.array, fresher.geometry.attributes.position.array, 'deferred water ends equal to a fresh build');
  slow.dispose();
  assert.equal(slow.jobs.waiting ?? 0, 0);
  fresher.dispose();
}
console.log('terrain chunk checks passed');
