import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { jsonPieces, jsonChunks, writeJSON, hashJSON, rawJSONFile, readReport } from './tools/json-stream.mjs';
import { packageReport, aggregate, summarizeSeat } from './tools/ai-humanity.mjs';
import { createBoundedNativeHasher } from './tools/hash-json-native.mjs';

const verifierHasher = createBoundedNativeHasher(hashJSON);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await mkdtemp(join(tmpdir(), 'ww2-humanity-storage-test-'));
const script = fileURLToPath(new URL('./tools/ai-humanity.mjs', import.meta.url));
const execute = args => new Promise((done, fail) => {
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, TMPDIR: directory } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  child.on('error', fail); child.on('close', code => done({ code, stdout, stderr }));
});

try {
  const alias = { nested: ['é', '😀', '\ud800', '\udc00', -0] };
  const functionJSON = Object.assign(() => {}, { toJSON(key) { return `function-${key}`; } });
  const edges = { first: alias, second: alias, null: null, omitted: undefined, nonfinite: [NaN, Infinity, -Infinity],
    holes: [, undefined, () => {}, Symbol()], escaped: '"\\\r\n\t\u0000', boundary: 'a'.repeat(8191) + '😀é' + 'z'.repeat(9000),
    date: new Date(0), functionJSON, boxed: [new Number(NaN), new String('é'), new Boolean(false)],
    custom: { toJSON(key) { return { key, omitted: undefined }; } }, 3: true, 1: false };
  for (const value of [edges, [], {}, null, '😀', -0, NaN, Infinity]) for (const space of [0, 2, 10, '\t']) {
    assert.equal([...jsonPieces(value, space)].join(''), JSON.stringify(value, null, space), 'stream pieces preserve native JSON bytes');
  }
  const calls = [];
  const getters = { get omitted() { calls.push('omitted'); return undefined; }, included: { get toJSON() { calls.push('toJSON'); return () => 3; } } };
  assert.equal([...jsonPieces(getters)].join(''), '{"included":3}'); assert.deepEqual(calls, ['omitted', 'toJSON']);
  const circle = {}; circle.self = circle;
  assert.throws(() => [...jsonPieces(circle)], /circular/); assert.throws(() => [...jsonPieces({ big: 1n })], /BigInt/);

  // Compare effects as well as bytes: unsupported hooks must execute exactly once in native order.
  const effectFixtures = [
    trace => { let sequence = 0; const child = { toJSON(key) { trace.push(['child', key]); return ++sequence; } };
      return { toJSON(key) { trace.push(['root', key]); return { first: child, second: child }; } }; },
    trace => { const value = { first: 1 }; Object.defineProperty(value, 'later', { enumerable: true,
      get() { trace.push('later'); value.first = 9; return 'changed'; } }); return value; },
    trace => ({ child: { get toJSON() { trace.push('toJSON getter'); return key => { trace.push(['converted', key]); return 4; }; } } }),
    trace => new Proxy({ item: 3 }, { get(target, key, receiver) { trace.push(['get', String(key)]); return Reflect.get(target, key, receiver); },
      ownKeys(target) { trace.push('keys'); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) { trace.push(['descriptor', String(key)]); return Reflect.getOwnPropertyDescriptor(target, key); },
      getPrototypeOf(target) { trace.push('prototype'); return Reflect.getPrototypeOf(target); } }),
    trace => ({ get fail() { trace.push('throwing getter'); throw new RangeError('fixture'); } })
  ];
  for (const factory of effectFixtures) {
    const outcomes = [];
    for (const hasher of [hashJSON, verifierHasher]) { const trace = [], value = factory(trace);
      try { outcomes.push({ digest: await hasher(value), trace }); }
      catch (error) { outcomes.push({ error: error.constructor.name, message: error.message, trace }); }
    }
    assert.deepEqual(outcomes[1], outcomes[0], 'fallback preserves getter/proxy/conversion effects and errors');
  }
  for (const value of [edges, [], {}, null, '😀', -0, NaN, Infinity, Object.assign([], { 7: 'sparse' }),
    JSON.parse('{"__proto__":{"safe":true},"constructor":7,"toJSON":5}'),
    { 10: 'ten', 2: 'two', '01': 'leading', alias, same: alias }]) {
    assert.deepEqual(await verifierHasher(value), await hashJSON(value), 'bounded helper preserves original byte count and digest');
  }
  const mutable = { array: [{ value: 1 }] };
  assert.deepEqual(await verifierHasher(mutable), await hashJSON(mutable));
  mutable.array[0].value = '\u0000😀'.repeat(24000); mutable.array.push({ after: true });
  assert.deepEqual(await verifierHasher(mutable), await hashJSON(mutable), 'size caches cannot survive a changed object');
  await assert.rejects(verifierHasher(circle), /circular/); await assert.rejects(verifierHasher({ big: 1n }), /BigInt/);
  await assert.rejects(verifierHasher(undefined), /serializable/);
  const conversion = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  const prototypeTrace = [];
  try { Object.defineProperty(Object.prototype, 'toJSON', { configurable: true,
    value(key) { prototypeTrace.push(key); return this; } });
    const originalDigest = await hashJSON({ child: { x: 1 } }), originalTrace = prototypeTrace.splice(0);
    assert.deepEqual(await verifierHasher({ child: { x: 1 } }), originalDigest);
    assert.deepEqual(prototypeTrace, originalTrace, 'prototype conversion hook retains original calls');
  } finally { if (conversion) Object.defineProperty(Object.prototype, 'toJSON', conversion); else delete Object.prototype.toJSON; }
  const nativeStringify = JSON.stringify; let maximumNativeEncodingBytes = 0;
  const boundedValue = { text: ('\u0000😀\ud800\\\n').repeat(20000), items: Array.from({ length: 2000 }, (_, i) => ({ i, alias })) };
  const expectedBounded = await hashJSON(boundedValue);
  try { JSON.stringify = (...args) => { const encoded = nativeStringify(...args);
    if (typeof encoded === 'string') { const size = Buffer.byteLength(encoded); maximumNativeEncodingBytes = Math.max(maximumNativeEncodingBytes, size);
      assert.ok(size <= 65536, 'native serialization must remain within the proven byte bound'); } return encoded; };
    assert.deepEqual(await verifierHasher(boundedValue), expectedBounded);
  } finally { JSON.stringify = nativeStringify; }
  assert.ok(maximumNativeEncodingBytes > 1000);

  const drained = []; let outstanding = 0, maximumOutstanding = 0, produced = 0, finished = 0, maximumAhead = 0;
  async function* measuredChunks() { for await (const chunk of jsonChunks(edges, { chunkBytes: 128 })) { produced++; maximumAhead = Math.max(maximumAhead, produced - finished); yield chunk; } }
  await pipeline(Readable.from(measuredChunks()), new Writable({ highWaterMark: 32,
    write(chunk, encoding, done) { outstanding++; maximumOutstanding = Math.max(maximumOutstanding, outstanding); drained.push(Buffer.from(chunk)); setTimeout(() => { outstanding--; finished++; done(); }, 1); } }));
  assert.equal(Buffer.concat(drained).toString(), JSON.stringify(edges)); assert.equal(maximumOutstanding, 1, 'slow drain bounds in-flight writes');
  assert.ok(produced > 100 && maximumAhead <= 20 && maximumAhead < produced, 'slow sink prevents whole-report production ahead of drain');
  let writes = 0;
  await assert.rejects(pipeline(Readable.from(jsonChunks(edges, { chunkBytes: 8 })), new Writable({ highWaterMark: 8,
    write(chunk, encoding, done) { writes++; done(Error('injected disk failure')); } })), /injected disk failure/);
  assert.equal(writes, 1, 'failed sink stops producer');

  const existing = join(directory, 'existing.json'); await writeFile(existing, 'previous output');
  await assert.rejects(writeJSON(existing, circle), /circular/); assert.equal(await readFile(existing, 'utf8'), 'previous output');
  await assert.rejects(writeJSON(existing, { fragment: rawJSONFile(join(directory, 'missing-fragment')) }), /ENOENT/);
  assert.equal(await readFile(existing, 'utf8'), 'previous output', 'failed serialization preserves the old output');
  await mkdir(join(directory, 'output-is-directory'));
  await assert.rejects(writeJSON(join(directory, 'output-is-directory'), {}), /regular file/);
  assert.ok((await readdir(directory)).every(name => !name.startsWith('.')), 'failed outputs remove their staging directories');

  const row = { tick: 42, kind: 'select-click', text: '😀 " é', responseEvents: [{ id: 1, tick: 30, responseUnits: [7, 9] }] };
  const repeated = { inputs: Array(4000).fill(row), events: [], commands: [], perceptionMeasurements: {
    frames: Array(4000).fill({ original: { events: [row], newEvents: [] }, observed: { events: [row], newEvents: [] }, links: [] }) } };
  const streamedHash = createHash('sha256'); let bytes = 0, maximumChunk = 0;
  for await (const chunk of jsonChunks(repeated)) { streamedHash.update(chunk); bytes += chunk.length; maximumChunk = Math.max(maximumChunk, chunk.length); }
  assert.equal(streamedHash.digest('hex'), sha(JSON.stringify(repeated))); assert.ok(bytes > 1_000_000); assert.ok(maximumChunk <= 65536);
  assert.equal((await hashJSON(repeated)).sha256, sha(JSON.stringify(repeated)), 'digests include every repeated full callback frame');

  const fixture = { source: 'fixture', results: [{ seats: [{ metrics: { score: null } }], logs: [repeated] }], summary: { alias }, tail: 'UTF8 😀' };
  const input = join(directory, 'full.json'), compactPath = join(directory, 'compact.json'), archive = join(directory, 'raw/full.json.gz');
  const nativeBytes = Buffer.from(JSON.stringify(fixture, null, 2) + '\n'); await writeFile(input, nativeBytes);
  assert.deepEqual(await readReport(input, result => result), JSON.parse(nativeBytes));
  const compact = await packageReport(input, compactPath, archive), compressed = await readFile(archive);
  assert.deepEqual(await readFile(input), nativeBytes, 'packaging preserves source bytes'); assert.deepEqual(gunzipSync(compressed), nativeBytes);
  assert.deepEqual(compressed, gzipSync(nativeBytes, { level: 9 }), 'streamed gzip matches the old native compression');
  const expectedCompact = { ...JSON.parse(nativeBytes), results: [{ seats: fixture.results[0].seats, timelinesSHA256: sha(JSON.stringify([repeated])),
    timelineDigests: [{ slot: 0, sha256: sha(JSON.stringify(repeated)), commands: 0, inputs: 4000, events: 0,
      measurementFrames: 4000, measurementStreamSHA256: sha(JSON.stringify(repeated.perceptionMeasurements)) }] }],
    evidenceArchive: { format: 'gzip', path: 'raw/full.json.gz', sha256: sha(compressed), bytes: compressed.length,
      uncompressedSHA256: sha(nativeBytes), uncompressedBytes: nativeBytes.length,
      method: 'The gzip archive contains the complete source report bytes, including every raw timeline. Compact timeline digests hash JSON.stringify of each original log in array order. No measurements or historical event annotations are changed.' } };
  assert.deepEqual(compact, expectedCompact); assert.deepEqual(JSON.parse(await readFile(compactPath)), expectedCompact);
  let digestCalls = 0;
  const injected = await packageReport(input, compactPath, archive, { hashJSON: async value => { digestCalls++; return verifierHasher(value); } });
  assert.equal(digestCalls, 3, 'explicit injection covers logs array, full log and private stream');
  assert.deepEqual(injected, expectedCompact); assert.deepEqual(gunzipSync(await readFile(archive)), nativeBytes);
  assert.deepEqual(await readFile(archive), compressed, 'digest injection cannot alter raw bytes or gzip');
  const beforeFailureCompact = await readFile(compactPath), beforeFailureArchive = await readFile(archive);
  await assert.rejects(packageReport(input, compactPath, archive, { hashJSON: async () => { throw Error('injected digest failure'); } }), /injected digest failure/);
  assert.deepEqual(await readFile(compactPath), beforeFailureCompact); assert.deepEqual(await readFile(archive), beforeFailureArchive);
  await assert.rejects(packageReport(input, compactPath, archive, { hashJSON: 1 }), /must be a function/);

  const previousCompact = await readFile(compactPath), previousArchive = await readFile(archive), malformed = join(directory, 'malformed.json');
  await writeFile(malformed, '{"results":[{"seats":[{}]}]}'); await assert.rejects(packageReport(malformed, compactPath, archive), /full raw logs/);
  assert.deepEqual(await readFile(compactPath), previousCompact); assert.deepEqual(await readFile(archive), previousArchive);
  await assert.rejects(packageReport(input, input, archive), /different paths/);
  for (const invalid of ['{"results":[],}', '{"results":[{},]}', '{"a":1} trailing', '{"results":[{"bad":]}]}', '[]']) {
    await writeFile(malformed, invalid); await assert.rejects(readReport(malformed, result => result), SyntaxError);
  }
  await writeFile(malformed, '{"__proto__":{"safe":true},"results":[]}');
  assert.deepEqual(await readReport(malformed, result => result), JSON.parse(await readFile(malformed, 'utf8')), 'prototype-named keys stay ordinary JSON data');

  const full = join(directory, 'nine-seat.json');
  const run = await execute(['--mode', 'conquest', '--level', 'all', '--seeds', '1', '--seconds', '20', '--workers', '1', '--logs', '--out', full]);
  assert.equal(run.code, 0, run.stderr);
  const report = JSON.parse(await readFile(full)); assert.equal(report.results.length, 3); assert.equal(report.results.reduce((n, result) => n + result.seats.length, 0), 9);
  assert.deepEqual(report.results.map(result => result.level), ['easy', 'normal', 'hard']); assert.deepEqual(aggregate(report.results), report.summary);
  const rawResults = []; let checkpoint;
  await new Promise((done, fail) => {
    const worker = new Worker(script, { workerData: { options: { seconds: 20, map: 'default', legacy: false, logs: true, screenSpan: 113 },
      tasks: ['easy', 'normal', 'hard'].map(level => ({ mode: 'conquest', level, seed: 1 })) } });
    worker.on('message', result => { if (result.type === 'sourceCheckpoint') checkpoint = result.checkpoint; else rawResults.push(result); });
    worker.on('error', fail); worker.on('exit', code => code ? fail(Error(`Raw worker exited ${code}`)) : done());
  });
  assert.deepEqual(report.results, JSON.parse(JSON.stringify(rawResults)), 'CLI spooling retains the unchanged complete raw Worker API graph');
  assert.deepEqual(Object.keys(report.sourceCheckpoints), [checkpoint.sha256]);
  assert.equal(checkpoint.files['tools/json-stream.mjs'], sha(await readFile(new URL('./tools/json-stream.mjs', import.meta.url))));
  let inputs = 0, commands = 0, events = 0, frames = 0;
  for (const result of report.results) for (const seat of result.seats) {
    const log = result.logs[seat.slot]; assert.deepEqual(summarizeSeat(log, result.seconds, 113), seat.metrics);
    inputs += log.inputs.length; commands += log.commands.length; events += log.events?.length ?? 0; frames += log.perceptionMeasurements.frames.length;
    for (const frame of log.perceptionMeasurements.frames) { assert.ok(frame.original); assert.ok(frame.observed); assert.ok(Array.isArray(frame.original.events)); assert.ok(Array.isArray(frame.observed.events)); }
  }
  assert.ok(inputs > 0 && commands > 0 && events > 0 && frames > 9, 'real smoke includes physical inputs, orders, stimuli and later full callback frames');
  const packaged = join(directory, 'nine-seat-compact.json'), rawArchive = join(directory, 'nine-seat-full.json.gz');
  const packageRun = await execute(['--package', full, '--archive', rawArchive, '--out', packaged]); assert.equal(packageRun.code, 0, packageRun.stderr);
  const packagedReport = JSON.parse(await readFile(packaged)); assert.deepEqual(gunzipSync(await readFile(rawArchive)), await readFile(full));
  assert.deepEqual(packagedReport.summary, report.summary); assert.deepEqual(packagedReport.sourceCheckpoints, report.sourceCheckpoints);
  for (const [index, result] of report.results.entries()) for (const [slot, log] of result.logs.entries()) {
    const proof = packagedReport.results[index].timelineDigests[slot]; assert.equal(proof.sha256, sha(JSON.stringify(log))); assert.equal(proof.measurementFrames, log.perceptionMeasurements.frames.length);
  }
  const parts = [];
  for (const [index, results] of [[report.results[0]], report.results.slice(1)].entries()) {
    const path = join(directory, `part-${index}.json`); parts.push(path);
    await writeFile(path, JSON.stringify({ ...report, configuration: { ...report.configuration, levels: results.map(result => result.level) }, summary: aggregate(results), elapsedSeconds: report.elapsedSeconds / 2, results }));
  }
  const merged = join(directory, 'merged.json');
  const mergeRun = await execute(['--merge', parts.join(','), '--out', merged]); assert.equal(mergeRun.code, 0, mergeRun.stderr);
  const mergedReport = JSON.parse(await readFile(merged)); assert.deepEqual(mergedReport.results, report.results); assert.deepEqual(mergedReport.summary, report.summary);
  const assembled = join(directory, 'assembled.json'), fragments = [];
  for (const [index, result] of report.results.entries()) { const path = join(directory, `fragment-${index}.json`); await writeJSON(path, result); fragments.push(rawJSONFile(path)); }
  await writeJSON(assembled, { ...report, results: fragments }, { space: 2, newline: true }); assert.deepEqual(JSON.parse(await readFile(assembled)), report);
  assert.deepEqual(await verifierHasher({ fragments }), await hashJSON({ fragments }), 'raw fragment sentinel keeps the original path');
  const failure = await execute(['--mode', 'conquest', '--level', 'normal', '--seeds', '1', '--seconds', '1', '--workers', '1', '--logs', '--out', join(directory, 'output-is-directory')]);
  assert.notEqual(failure.code, 0); assert.match(failure.stderr, /regular file/);
  assert.ok((await readdir(directory)).every(name => !name.startsWith('ww2-ai-humanity-') && !name.startsWith('.')), 'successful and failed CLI operations remove their private spools and staging directories');
  console.log(JSON.stringify({ test: 'AI humanity storage', matches: 3, seats: 9, inputs, commands, events, completeMeasurementFrames: frames,
    nativeBytes: true, completeGraphs: true, nativeReducers: true, exactGzip: true, merge: true, errors: true, backpressure: true, cleanup: true }));
} finally { await rm(directory, { recursive: true, force: true }); }
