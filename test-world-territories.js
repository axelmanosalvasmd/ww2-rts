import assert from 'node:assert/strict';
import './test-world-discovery.js';
import * as t from './shared/world-territories.js';
import { placementState } from './client/availability.js';
import { placementCheck } from './shared/sim.js';
assert.equal(typeof t.territoryEdges, 'function', 'shared renderer must draw irregular discovered borders');
const runs = [
    [2, 3, 5],
    [3, 3, 5],
  ],
  edges = t.territoryEdges(runs);
assert.ok(edges.length > 0);
assert.ok(!edges.some(([x, y, xx, yy]) => y === 3 && yy === 3 && x >= 3 && xx <= 5), 'no internal horizontal seams');
assert.equal(t.insideKnownRegion({ runs }, { x: 7, z: 5 }), true);
assert.equal(t.insideKnownRegion({ runs }, { x: 11, z: 5 }), false);
const known = t.knownTerritoryRuns([0, 0, 1, 1, 0, 0, 1, 1], [0, 1, 4], 4);
assert.deepEqual(known.get(0), [
  [0, 0, 2],
  [1, 0, 1],
]);
assert.equal(known.has(1), false, 'undiscovered region geometry must not be exposed');

// The preview gets sparse region IDs and explored runs, never the authoritative membership map.
{
  const map = { w: 16, h: 16, rows: Array(16).fill('.'.repeat(16)) };
  const owned = { id: 31, team: 7, runs: [[4, 4, 6], [5, 4, 6]], bounds: [0, 0, 32, 32] };
  const snapshot = { mode: { kind: 'world' }, units: [], world: { regions: [owned] } };
  const view = () => placementState(snapshot, map, map.rows.map(row => [...row]), [7, 7, 9]).game;
  const order = { kind: 'flakpos', x: 10, z: 10, team: 7 };
  assert.equal(placementCheck(view(), order).ok, true, 'teammates can build wholly inside discovered owned runs');
  assert.equal(placementCheck(view(), { ...order, team: 9 }).reason, 'territory', 'enemy ownership remains rejected');
  assert.equal(placementCheck(view(), { ...order, x: 14 }).reason, 'territory', 'unknown cells inside broad bounds remain rejected');
  assert.equal(placementCheck(view(), order, () => false).reason, 'notVisible', 'remembered ownership does not bypass current sight');
  owned.runs[1][2] = 5;
  snapshot.world.regions.push({ id: 42, team: 9, runs: [[5, 5, 6]] });
  assert.equal(placementCheck(view(), order).reason, 'territory', 'a footprint crossing the irregular enemy border remains rejected');
  snapshot.world.regions[1].team = 7;
  assert.equal(placementCheck(view(), order).ok, true, 'a footprint can span adjacent regions owned by the same team');
  snapshot.world.regions = [{ id: 31, team: 7, bounds: [8, 8, 12, 12] }];
  assert.equal(placementCheck(view(), order).ok, true, 'legacy rectangular region snapshots still allow owned construction');
}
console.log('PASS: discovered territory borders and membership');
