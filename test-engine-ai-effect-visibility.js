// Current canonical effect visibility is borrowed for one projection, with private fallback caches.
import assert from 'node:assert/strict';
import { createGame, teamFog, snapshotFor, snapshotCache, CELL, TERRAIN } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 5, y: 5 }, { x: 75, y: 75 }], points: [] };
function fixture(options = {}) {
  const prior = Math.random;
  Math.random = () => .5;
  try { return createGame(map, ['A', 'B'], false, [0, 1], [0, 1], { weather: false, supply: false, ...options }); }
  finally { Math.random = prior; }
}
const localShot = (x, z, tag = 0) => ({ k: 'contact', kind: 'rifle', local: true, tag, x, z, y: 1, time: .1,
  f: 99999, fo: 1, hit: false, kill: false });
const center = (game, cell) => ({ x: (cell % game.w + .5) * CELL, z: (Math.floor(cell / game.w) + .5) * CELL });
function canonicalEffects(game) {
  const clone = structuredClone(game);
  return snapshotFor(clone, 0, clone.shots, [], snapshotCache(clone));
}

// The canonical cache predates movement inside the same vision pass. A newly
// initialized private mask would include different effects than the human snapshot.
const game = fixture();
game.visionTick = 0;
snapshotFor(game, 0, [], [], snapshotCache(game));
const canonical = teamFog(game, 0), mask = canonical.vis.slice();
for (const unit of game.units.values()) if (unit.owner === 0) unit.x += 20;
game.tick = 2;
const independent = teamFog({ ...game, fog: new Map(), fogSources: new Map(), fogTerrain: undefined }, 0);
const lost = mask.findIndex((value, cell) => value && !independent.vis[cell]);
const gained = mask.findIndex((value, cell) => !value && independent.vis[cell]);
assert.ok(lost >= 0 && gained >= 0, 'cache histories expose both visibility directions');
for (const [id, cell] of [[1, lost], [2, gained], [3, game.w * game.h - 1]]) {
  const at = center(game, cell);
  game.flights.set(id, { id, kind: 'small', effect: 'rifle', sequence: id, ...at, y: 1,
    vx: 0, vy: 0, vz: 0, gravity: 0, stamp: 0, launched: 0, expires: 5, owner: 1, shooter: 99999 });
  game.shots.push(localShot(at.x, at.z, id));
}
game.shots.push(localShot(-4, -4, 4));
const expected = canonicalEffects(game), before = structuredClone(game), memory = {};
const projected = viewFor(game, 0, memory);
assert.deepEqual(projected.snapshot.flights, expected.flights, 'AI flight rows match canonical human filtering');
assert.deepEqual(projected.snapshot.shots, expected.shots, 'AI local shot rows match canonical human filtering');
assert.deepEqual(expected.flights.map(row => row.flight), [1], 'newly visible and hidden flights remain excluded');
assert.deepEqual(expected.shots.map(row => row.tag), [1], 'newly visible, hidden and off-map shots remain excluded');
assert.deepEqual(game, before, 'borrowing leaves the full authoritative game graph unchanged');
assert.equal(memory.fog.has(0), false, 'the borrowed entry never persists in AI memory');
assert.equal(memory.fogTerrain, undefined, 'canonical terrain caches are never adopted');
assert.equal(projected.snapshot.flights[0].f, undefined, 'hidden shooter IDs remain private');
assert.equal(projected.snapshot.shots[0].f, undefined);
assert.equal(projected.snapshot.shots[0].fo, undefined, 'hidden shooter ownership remains private');
projected.snapshot.flights[0].x = -100;
assert.deepEqual(game, before, 'delivered effect rows are detached from the authoritative game');

// Nonlocal events retain their separate public and ownership visibility rules.
const nonlocal = structuredClone(game), hiddenAt = center(nonlocal, nonlocal.w * nonlocal.h - 1);
nonlocal.shots = [
  { k: 'fx', tag: 5, ...hiddenAt, pub: true },
  { k: 'fx', tag: 6, ...hiddenAt, fo: 0 },
  { k: 'fx', tag: 7, ...hiddenAt, fo: 1 },
];
const nonlocalBefore = structuredClone(nonlocal);
const nonlocalView = viewFor(nonlocal, 0, {});
assert.deepEqual(nonlocalView.snapshot.shots, canonicalEffects(nonlocal).shots);
assert.deepEqual(nonlocalView.snapshot.shots.map(row => row.tag), [5, 6]);
assert.deepEqual(nonlocal, nonlocalBefore);

// Existing private caches remain intact during borrowing, then refresh privately
// when the canonical key becomes stale, including after terrain edits.
const remembered = {}, initial = fixture();
initial.visionTick = 0;
initial.shots = [localShot(11, 11)];
viewFor(initial, 0, remembered);
const privateEntry = remembered.fog.get(0), privateBefore = structuredClone(privateEntry);
const sourcesBefore = structuredClone(remembered.fogSources), terrainBefore = structuredClone(remembered.fogTerrain);
viewFor(game, 0, remembered);
assert.equal(remembered.fog.get(0), privateEntry);
assert.deepEqual(privateEntry, privateBefore);
assert.deepEqual(remembered.fogSources, sourcesBefore);
assert.deepEqual(remembered.fogTerrain, terrainBefore);
game.visionTick = 1;
game.flags[0] = TERRAIN.B;
game.terrainVersion++;
const edited = structuredClone(game), refreshed = viewFor(game, 0, remembered);
assert.equal(remembered.fog.get(0), privateEntry);
assert.equal(privateEntry.key, 1);
assert.notDeepEqual(privateEntry, privateBefore, 'stale canonical visibility refreshes private state');
assert.deepEqual(game, edited, 'private refresh cannot mutate canonical fog or terrain stamp buffers');
assert.ok(refreshed.snapshot.flights.some(row => row.flight === 2));

// Missing keys use private caches; the initial undefined vision tick matches -1.
const missing = fixture();
missing.shots = initial.shots;
const missingBefore = structuredClone(missing), missingMemory = {};
viewFor(missing, 0, missingMemory);
assert.deepEqual(missing, missingBefore);
assert.equal(missingMemory.fog.get(0).key, -1);
const unset = fixture();
teamFog(unset, 0);
unset.shots = initial.shots;
const unsetBefore = structuredClone(unset), unsetMemory = {};
viewFor(unset, 0, unsetMemory);
assert.deepEqual(unset, unsetBefore);
assert.equal(unsetMemory.fog.has(0), false);

// A matching teamFog key must return before touching any mutable cache fields.
game.visionTick = 0;
const guarded = { key: 0, vis: mask };
for (const field of ['next', 'explored', 'deltas', 'version']) Object.defineProperty(guarded, field, {
  get() { assert.fail(`borrowed ${field} must not be read`); },
  set() { assert.fail(`borrowed ${field} must not be written`); },
});
game.fog.set(0, guarded);
viewFor(game, 0, {});
assert.deepEqual(guarded.vis, mask);

// World snapshots additionally read visibleCells, while all authoritative fog
// buffers, terrain stamps and source-cache objects retain their identities.
const world = fixture({ mode: 'world', worldSize: 'huge', worldSeed: 183 });
const own = [...world.units.values()].find(unit => unit.owner === 0);
world.shots = [localShot(own.x, own.z)];
const worldExpected = snapshotFor(world, 0, world.shots, [], snapshotCache(world));
const worldEntry = teamFog(world, 0);
const worldFogBefore = structuredClone({ entry: worldEntry, sources: world.fogSources, terrain: world.fogTerrain });
const identities = { vis: worldEntry.vis, next: worldEntry.next, explored: worldEntry.explored,
  visibleCells: worldEntry.visibleCells, stamp: world.fogTerrain.stamp };
const worldMemory = {}, worldView = viewFor(world, 0, worldMemory);
assert.deepEqual(worldView.snapshot.shots, worldExpected.shots);
assert.deepEqual(worldView.snapshot.flights, worldExpected.flights);
assert.deepEqual({ entry: world.fog.get(0), sources: world.fogSources, terrain: world.fogTerrain }, worldFogBefore);
for (const field of ['vis', 'next', 'explored', 'visibleCells']) assert.equal(worldEntry[field], identities[field]);
assert.equal(world.fogTerrain.stamp, identities.stamp);
assert.equal(worldMemory.fog.has(0), false);
assert.equal(worldMemory.fogTerrain, undefined);
console.log('AI canonical effects, cache history, private refresh and World fog isolation passed');
