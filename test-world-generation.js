import assert from 'node:assert/strict';
import { assertWorldReachable } from './test-world-connectivity-helper.js';
import { generateWorldMap } from './shared/world-conquest.js';
const m = generateWorldMap({ seed: 20261003, players: 4 });
assert.ok(
  m.heights.some((row) => row.includes('4')),
  'world must contain substantial ridges, not isolated one-level bumps',
);
console.log('PASS: substantial relief');
assert.ok(
  m.rows.some((row) => row.includes('=')),
  'roads must include destructible bridges',
);
assert.ok(
  m.rows.some((row) => /W{20}/.test(row)),
  'world must contain a lake wider than a river',
);
assert.ok(
  m.spawns.every((p) => Math.hypot(p.x - m.w / 2, p.y - m.h / 2) > m.h * 0.25),
  'four-player homes must not give one player the central hub',
);
console.log('PASS: lakes and bridges');
assert.equal(
  m.world.regionMap?.length,
  m.w * m.h,
  'territory must have authoritative cell membership, not square bounds',
);
assert.ok(
  m.world.regions.some((r) => r.bounds[2] - r.bounds[0] !== 64),
  'territories must follow irregular terrain',
);
for (const size of ['huge', 'massive'])
  for (const seed of [0, 1, 42, 20261003, 4294967295]) {
    const map = generateWorldMap({ size, seed, players: 6 });
    assertWorldReachable(map);
    assert.equal(map.world.total, size === 'huge' ? 64 : 128);
    assert.deepEqual(map, generateWorldMap({ size, seed, players: 6 }), 'same seed must reproduce exactly');
  }
console.log('PASS: both sizes, deterministic generation and tank-clearance connectivity after all bridges destroyed');
