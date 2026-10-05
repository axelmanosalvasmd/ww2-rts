import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as sim from '/tmp/human-ai-v15-full-source/shared/sim.js';
import { viewFor } from '/tmp/human-ai-v15-full-source/shared/ai-view.js';
import { privateTickZeroObservation } from './adapter.mjs';
function serialize(value) {
  const seen = new Map(), nodes = [];
  const visit = item => {
    if (item === undefined) return { $undefined: true };
    if (typeof item === 'number' && !Number.isFinite(item)) return { $number: String(item) };
    if (typeof item === 'bigint') return { $bigint: String(item) };
    if (typeof item === 'function') return { $function: Function.prototype.toString.call(item) };
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return { $ref: seen.get(item) };
    const index = nodes.length; seen.set(item, index);
    const node = { type: item.constructor?.name ?? 'Object', properties: [] }; nodes.push(node);
    if (item instanceof Map) node.entries = [...item].map(([key, entry]) => [visit(key), visit(entry)]);
    if (item instanceof Set) node.entries = [...item].map(visit);
    if (item instanceof Date) node.value = item.toISOString();
    if (item instanceof ArrayBuffer) node.bytesBase64 = Buffer.from(item).toString('base64');
    if (ArrayBuffer.isView(item)) { node.buffer = visit(item.buffer); node.byteOffset = item.byteOffset; node.byteLength = item.byteLength; }
    if (Array.isArray(item)) node.values = Array.from({ length: item.length }, (_, index) => index in item ? visit(item[index]) : { $hole: true });
    for (const key of Object.keys(item)) {
      if ((Array.isArray(item) || ArrayBuffer.isView(item)) && /^(0|[1-9]\d*)$/.test(key)) continue;
      node.properties.push([key, visit(item[key])]);
    }
    return { $ref: index };
  };
  const root = visit(value); return JSON.stringify({ root, nodes });
}
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shaGame = value => createHash('sha256').update(serialize(value)).digest('hex');

const map = JSON.parse(await readFile('/tmp/human-ai-v15-full-source/maps/default.json'));
const oldRandom = Math.random; let calls = 0; Math.random = () => { calls++; return .5; };
try {
  const game = () => sim.createGame(map, ['A', 'B', 'C'], true, [0, 1, 2], [0, 1, 2], { mode: 'world', worldSeed: 1, army: 'standard' });
  const g = game(), cache = sim.snapshotCache(g);
  const fingerprints = object => Object.fromEntries(Object.keys(object).map(key => [key, shaGame(object[key])]));
  const beforeWholeGame = shaGame(g);
  const before = fingerprints(g), beforeWorld = fingerprints(g.world), beforeMemory = structuredClone(g.world.memory), beforeCalls = calls;
  viewFor(g, 0, {}, cache);
  const after = fingerprints(g), afterWorld = fingerprints(g.world), afterMemory = structuredClone(g.world.memory);
  const changedGameFields = Object.keys(before).filter(key => before[key] !== after[key]);
  const changedWorldFields = Object.keys(beforeWorld).filter(key => beforeWorld[key] !== afterWorld[key]);
  assert.deepEqual(changedWorldFields, ['memory']); assert.equal(calls, beforeCalls);
  g.world.memory.clear(); for (const [team, row] of beforeMemory) g.world.memory.set(team, row);
  assert.equal(shaGame(g), beforeWholeGame, 'Restoring just world.memory reproduces the complete pre-projection game graph');
  const memorySummary = memory => [...memory].map(([team, row]) => ({ team, key: row.key, version: row.version, cells: row.cells?.size, regions: row.regions?.size, wrecks: row.wrecks?.size, runs: row.runs?.size ?? null }));
  const separate = game(), separateCache = sim.snapshotCache(separate), privateBefore = shaGame(separate), privateCalls = calls;
  privateTickZeroObservation(separate, 0, separateCache);
  assert.equal(shaGame(separate), privateBefore); assert.equal(calls, privateCalls);
  await writeFile('/tmp/human-ai-oracle-tick0-proposal/world-cache-witness.json', JSON.stringify({ status: 'PASS', changedGameFields, changedWorldFields,
    beforeMemory: memorySummary(beforeMemory), afterMemory: memorySummary(afterMemory), fullBeforeAfterFingerprints: { before, after, beforeWorld, afterWorld },
    directProjectionConsumesRandom: false, detachedWorldMemoryProjectionChangesGame: false, detachedWorldMemoryProjectionConsumesRandom: false,
    source: { viewFor: 'shared/ai-view.js:125', worldTerrainMemory: 'shared/sim.js:1085', worldSnapshot: 'shared/sim.js:1110' } }, null, 2) + '\n');
  console.log('PASS exact World cache witness: only g.world.memory changed under direct initial viewFor; detached memory projection preserves full game and RNG');
} finally { Math.random = oldRandom; }
