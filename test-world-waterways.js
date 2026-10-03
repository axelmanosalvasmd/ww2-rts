import assert from 'node:assert/strict';
import { assertWorldReachable } from './test-world-connectivity-helper.js';
import { relief, waterways } from './shared/world-landforms.js';
import { generateWorldMap } from './shared/world-conquest.js';
function terrain(seed, w = 512) {
  const h = 512,
    levels = relief(w, h, seed);
  const ground = Array.from({ length: h }, () => Array(w).fill('.'));
  const heights = Array.from({ length: h }, (_, y) => Array.from(levels.subarray(y * w, (y + 1) * w), String));
  return { ground, heights, features: waterways(w, h, seed, ground, heights) };
}
const counts = new Set();
for (let seed = 0; seed < 24; seed++) {
  const { ground, features } = terrain(seed);
  assert.ok(Array.isArray(features.rivers), 'waterways must describe their actual river network');
  const mains = features.rivers.filter((r) => r.kind === 'main');
  counts.add(mains.length);
  for (const r of mains) {
    assert.equal(r.path[0].y, 0, 'main river enters from boundary');
    assert.equal(r.path.at(-1).y, 511, 'main river drains to boundary');
    for (const p of r.path) assert.ok('WF='.includes(ground[p.y][p.x]), 'centerline is actual water or crossing');
    const crossings = features.crossings.filter(c => c.river === r.id);
    assert.equal(crossings.filter(c => c.type === 'F').length, 2, 'each main has two permanent fords');
    assert.equal(crossings.filter(c => c.type === '=').length, 2, 'each main has two bridges');
    assert.equal(new Set(crossings.map(c => c.y)).size, 4, 'crossings are distinct locations');
    for (const c of crossings) {
      assert.equal(c.x, r.path[c.y].x, 'crossing lies on its named river');
      for (let y = c.y-3; y <= c.y+3; y++) {
        const p = r.path[y];
        for (let x = p.x-p.radius; x <= p.x+p.radius; x++)
          assert.equal(ground[y][x], c.type, 'crossing has continuous width across its river');
      }
    }
  }
}
assert.deepEqual([...counts].sort(), [1, 2, 3], 'seeds must produce one, two and three main rivers');
console.log('PASS: variable main rivers, real raster paths and per-river crossings');
const branchCounts = new Set();
for (let seed = 0; seed < 24; seed++) {
  const { ground, heights, features } = terrain(seed);
  const branches = features.rivers.filter((r) => r.kind === 'tributary');
  branchCounts.add(branches.length);
  for (const r of branches) {
    const parent = features.rivers.find((p) => p.id === r.parent);
    assert.equal(parent?.kind, 'main', 'tributaries must drain into an actual main river');
    const end = r.path.at(-1),
      join = parent.path.find((p) => p.y === end.y);
    assert.deepEqual({ x: end.x, y: end.y }, { x: join.x, y: join.y }, 'no gap at confluence');
    assert.ok(
      r.path.some((p) => ground[p.y][p.x] === 'F'),
      'small streams must be fordable, not bridge-only barriers',
    );
    for (let i = 0; i < r.path.length; i++) {
      const p = r.path[i];
      assert.ok('WF='.includes(ground[p.y][p.x]), 'stream is continuous in the raster');
      if (i) {
        const previous = r.path[i - 1];
        assert.ok(Math.abs(p.x - previous.x) <= 1 && p.y - previous.y === 1, 'no disconnected stream steps');
        assert.ok(+heights[p.y][p.x] <= +heights[previous.y][previous.x], 'stream cannot climb downstream');
      }
    }
    assert.ok(join.radius > parent.path[0].radius, 'main river must widen after tributaries join');
  }
}
assert.ok(branchCounts.has(0) && [...branchCounts].some((n) => n > 0), 'some seeds have tributaries, others are open');
console.log('PASS: seed-dependent connected, non-uphill, fordable tributaries and wider downstream rivers');
for (const size of ['huge', 'massive'])
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    const map = generateWorldMap({ size, seed, players: 6 });
    assertWorldReachable(map);
    assert.ok(map.world.waterways?.rivers, 'authoritative diagnostics must expose the generated network');
    for (const r of map.world.waterways.rivers)
      for (const p of r.path) {
        assert.ok('WF='.includes(map.rows[p.y][p.x]), 'settlements and roads must not sever a channel');
        assert.equal(map.heights[p.y][p.x], '0', 'engine water surface stays at supported level zero');
      }
  }
console.log('PASS: roads and settlements preserve river and tributary centerlines on both map sizes');
