import assert from 'node:assert/strict';
import * as t from './shared/world-territories.js';
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
console.log('PASS: discovered territory borders and membership');
