import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { writeJSON, stageGzip, hashJSON } from '/tmp/human-ai-v15-full-source/tools/json-stream.mjs';
import { bootstrapPrivateOracle, privateTickZeroObservation } from './adapter.mjs';
import * as sim from '/tmp/human-ai-v15-full-source/shared/sim.js';
import * as ai from '/tmp/human-ai-v15-full-source/shared/ai.js';
import { viewFor } from '/tmp/human-ai-v15-full-source/shared/ai-view.js';
import { measurementScoringViews } from '/tmp/human-ai-v15-full-source/tools/ai-humanity.mjs';
import { perceive } from '/tmp/human-ai-v15-full-source/shared/ai-perception.js';
import * as oracle from '/tmp/human-ai-v15-full-source/tools/ai-screen-v1-oracle.js';
const map = JSON.parse(await readFile('/tmp/human-ai-v15-full-source/maps/default.json'));
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
    for (const key of Object.keys(item)) node.properties.push([key, visit(item[key])]);
    if (Array.isArray(item)) node.length = item.length;
    return { $ref: index };
  };
  const root = visit(value); return JSON.stringify({ root, nodes });
}
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shaGame = value => createHash('sha256').update(serialize(value)).digest('hex');
function rng(initial) { let value = initial >>> 0; return () => { let t = value += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function witness(mode, level, treatment) {
  const originalRandom = Math.random; Math.random = rng(1);
  try {
    const g = sim.createGame(map, ['AI0', 'AI1', 'AI2'], true, [0, 1, 2], [0, 1, 2], { mode, worldSeed: 1, army: 'standard' });
    const logs = g.players.map(() => ({ inputs: [], commands: [], events: [] })), views = g.players.map(() => null), records = g.players.map(() => []), initialCache = sim.snapshotCache(g);
    const initialGame = shaGame(g);
    const adapters = g.players.map((_, slot) => treatment === 'off' ? null : treatment === 'original' ? { measureRaw: oracle.perceive, onMeasurements: frame => records[slot].push(structuredClone(frame)) } : bootstrapPrivateOracle(privateTickZeroObservation(g, slot, initialCache), slot, frame => {
      records[slot].push(structuredClone(frame));
      if (treatment === 'mutate') { frame.original.events.length = 0; frame.original.newEvents.length = 0; frame.links.push({ runtimeId: 'invented', originalIds: ['invented'] }); }
    }));
    assert.equal(shaGame(g), initialGame, 'Tool-only initial projection and oracle must leave authoritative game data unchanged');
    const startPackets = g.players.map(player => ({ w: g.w, h: g.h, spawn: { ...player.spawn }, level, seed: 1 }));
    const firstActorTicks = g.players.map(() => null);
    for (let slot = 0; slot < g.players.length; slot++) { assert.deepEqual(Object.keys(startPackets[slot]), ['w', 'h', 'spawn', 'level', 'seed']); assert.equal(ai.startCommander(g, slot, startPackets[slot]), true); }
    for (let tick = 0; tick < 300 && g.winner === null; tick++) {
      sim.step(g);
      if (g.tick % 2 === 0 || g.winner !== null) { const cache = sim.snapshotCache(g); for (let slot = 0; slot < g.players.length; slot++) views[slot] = ai.observe(g, slot, cache); }
      for (let slot = 0; slot < g.players.length; slot++) {
        if (!views[slot]) { assert.equal(g.tick, 1); continue; }
        firstActorTicks[slot] ??= g.tick;
        ai.think(g, slot, { level, seed: 1, view: views[slot], inputLog: input => logs[slot].inputs.push(structuredClone(input)),
          ...(adapters[slot] ? { perceptionMeasurements: adapters[slot] } : {}), submit: command => {
            const result = sim.command(g, slot, command);
            logs[slot].commands.push({ tick: g.tick, command: structuredClone(command), accepted: result === undefined, result: result ?? null, resources: structuredClone({ mp: g.players[slot].mp, fuel: g.players[slot].fuel, mun: g.players[slot].mun, sup: g.players[slot].sup }) });
            return result;
          } });
        logs[slot].events = ai.aiDiagnostics(g, slot).events;
      }
      if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
    }
    assert.ok(firstActorTicks.every(tick => tick === 2));
    const native = { logs, game: JSON.parse(serialize(g)), nextRandom: Math.random(), startPackets, firstActorTicks }; 
    if (!['off', 'original'].includes(treatment)) for (const frames of records) { assert.equal(frames[0].tick, 0); assert.ok(frames.every(frame => frame.original.baselineTick === 0)); }
    return { native, records };
  } finally { Math.random = originalRandom; }
}
const comparisons = [];
await mkdir('/tmp/human-ai-oracle-tick0-proposal/raw', { recursive: true });
for (const mode of ['conquest', 'classic', 'world']) for (const level of ['easy', 'normal', 'hard']) {
  const off = witness(mode, level, 'off'), original = witness(mode, level, 'original'), measured = witness(mode, level, 'on'), mutated = witness(mode, level, 'mutate');
  assert.deepEqual(original.native, off.native, `${mode}/${level} original measurement baseline isolation`);
  assert.deepEqual(measured.native, off.native, `${mode}/${level} native actions, resources, final game and RNG`);
  assert.deepEqual(mutated.native, off.native, `${mode}/${level} private callback mutation isolation`);
  for (const frames of measured.records) {
    const views = measurementScoringViews({ commands: [], inputs: [], events: [], perceptionMeasurements: { startedTick: 0, frames } }, 15);
    assert.equal(views.coverage.originalFromMatchStart, true);
    if (views.originalOracle.explicitLinked.requiredScreenPopulation) assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.answered, 0);
  }
  const path = `/tmp/human-ai-oracle-tick0-proposal/raw/${mode}-${level}.json`;
  await writeJSON(path, { mode, level, off, original, measured, mutated });
  const staged = await stageGzip(path, `${path}.gz`);
  let bytes = 0; const roundtrip = createHash('sha256');
  for await (const chunk of createReadStream(staged.staged.path).pipe(createGunzip())) { bytes += chunk.length; roundtrip.update(chunk); }
  assert.equal(bytes, staged.raw.bytes); assert.equal(roundtrip.digest('hex'), staged.raw.sha256);
  await staged.staged.commit(); await staged.staged.cleanup();
  comparisons.push({ mode, level, fullNativeEvidence: `${path}.gz`, rawSHA256: staged.raw.sha256, rawBytes: staged.raw.bytes,
    gzipSHA256: staged.gzip.sha256, gzipBytes: staged.gzip.bytes, exactRawRoundtrip: true,
    inputs: off.native.logs.map(log => log.inputs.length), nativeSHA256: (await hashJSON(off.native)).sha256,
    nativeTimelineAndRNGEqual: true, callbackMutationIsolated: true });
}
const raw = { id: 'initial-raw', tick: 0, observationTick: 0, kind: 'screen-contact', source: 'screen', onScreen: true,
  x: 210, z: 210, targetId: 2, responsePolicy: 'screen-v1', responseRequired: true, responseReason: 'idle-combat-contact', responseUnits: [1] };
const later = { ...raw, id: 'later-runtime', tick: 2, observationTick: 2, observedDanger: { nearbyOwnUnits: [1], idleOwnUnits: [1] } };
for (const key of ['responsePolicy', 'responseRequired', 'responseReason', 'responseUnits']) delete later[key];
const observed = { ...later, responsePolicy: 'screen-observed-v1', responseRequired: true, responseReason: 'idle-combat-contact', responseUnits: [1] };
const command = { t: 'attack', ids: [1], target: 2 };
const log = { events: [later], inputs: [{ tick: 10, queuedTick: 3, inputStartedTick: 4, kind: 'rightclick', ids: [1],
  responseActorIds: [1], responseTarget: { x: 210, z: 210 }, event: { id: later.id }, eventTick: 2, responseEvents: [later], command }],
  commands: [{ tick: 10, command, accepted: true, locations: [{ x: 210, z: 210 }] }],
  perceptionMeasurements: { startedTick: 0, frames: [
    { tick: 0, observationTick: 0, original: { policy: 'screen-v1', baselineTick: 0, events: [raw], newEvents: [raw] }, observed: { events: [], newEvents: [] }, links: [] },
    { tick: 2, observationTick: 2, original: { policy: 'screen-v1', baselineTick: 0, events: [raw], newEvents: [] }, observed: { events: [observed], newEvents: [observed] }, links: [{ runtimeId: later.id, originalIds: [] }] },
  ] } };
const views = measurementScoringViews(log, 15);
assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.requiredEvents, 1);
assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 1);
assert.equal(views.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
assert.equal(views.observed.explicitLinked.requiredScreenPopulation.firstAction.answered, 1);
assert.equal(views.observed.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 1);
const forged = structuredClone(log); forged.perceptionMeasurements.frames[1].links[0].originalIds = [raw.id];
const invalid = measurementScoringViews(forged, 15);
assert.equal(invalid.originalOracle.explicitLinked.requiredScreenPopulation.firstAction.unanswered, 1);
assert.equal(invalid.originalOracle.explicitLinked.requiredScreenPopulation.acceptedCommand.answered, 0);
assert.ok(invalid.audit.unknownOriginalMappings > 0);
await writeFile('/tmp/human-ai-oracle-tick0-proposal/verification.json', JSON.stringify({ status: 'PASS', secondsPerRun: 15, treatments: 4, matches: 36, laterRuntimeArrivalNeverCreditsInitialOriginal: true, inventedMappingRejected: true, comparisons }, null, 2) + '\n');
console.log('PASS private tick0 oracle isolation: 36 actual-engine runs, nine mode/level pairs');
