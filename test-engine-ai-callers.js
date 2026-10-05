// Exercise real caller loops with deterministic tick events and the shared alert detector.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deriveAlertEvents } from './shared/alert-events.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 10, y: 10 }, { x: 60, y: 60 }, { x: 10, y: 60 }], points: [] };
const finalTick = 60;
function fixture(humanCommander = true, publicStart = true) {
  const games = [], deliveries = [], calls = [], alerts = [], messages = [], starts = [], memories = new Map();
  const sim = {
    CELL: 2, TICK: .05, COVER: 1, TRENCH: 2, UNITS: { rifle: { infantry: true } }, coverBehind: () => 0,
    snapshotCache: () => ({}),
    createGame(_map, suppliedNames, _shuffle, _teams, _factions, options = {}) {
      const names = options.mode === 'horde' ? [...suppliedNames, 'Director'] : suppliedNames;
      const g = { tick: 0, winner: null, shots: [], newCells: [], mode: { kind: options.mode ?? 'conquest', wave: 1, ...(options.mode === 'horde' ? { slot: suppliedNames.length } : {}) }, matchSeed: 6,
        players: names.map((name, i) => ({ name, team: i, faction: i, vp: 0, spawn: { x: (map.spawns[i].x + .5) * 2, z: (map.spawns[i].y + .5) * 2 } })),
        units: new Map([[1, { id: 1, type: 'rifle', owner: 0, x: 40, z: 40, hp: 100 }],
          [2, { id: 2, type: 'rifle', owner: 1, x: 44, z: 40, hp: 100 }]]), w: 80, h: 80, flags: new Uint8Array(6400) };
      games.push(g); return g;
    },
    step(g) {
      g.tick++; g.players[0].vp++;
      g.shots.push({ k: 'say', text: `tick-${g.tick}`, x: 40, z: 40 },
        { k: 'rifle', f: 1, t: 2, hit: true, kill: true });
      g.newCells.push([g.tick, '.']);
      if (g.tick === finalTick) g.winner = 0;
    },
  };
  const ai = {
    humanCommander, thinkEvery: () => 40,
    observe(g, slot) {
      const snapshot = { tick: g.tick, winner: null, units: [], points: [], queues: [], strikes: [],
        shots: structuredClone(g.shots), out: g.players.map(() => false) };
      const memory = memories.get(slot) ?? {}; memories.set(slot, memory);
      alerts.push(...deriveAlertEvents(snapshot, memory.previous, {
        me: () => slot, friend: owner => owner === slot, unitName: type => type,
        playerName: owner => `Player ${owner}`, home: () => null, pointPos: () => null, onScreen: () => false,
      }, memory).map(alert => ({ slot, text: alert.text })));
      memory.previous = snapshot;
      deliveries.push({ tick: g.tick, slot, shots: snapshot.shots.length, cells: g.newCells.length, texts: snapshot.shots.filter(shot => shot.k === 'say').map(shot => shot.text) });
      return { tick: g.tick };
    },
    think(g, slot, options) { calls.push({ tick: g.tick, slot, deliveredTick: options.view.tick }); },
  };
  if (publicStart) ai.startCommander = (g, slot, setup) => {
    assert.equal(g.tick, 0, 'public setup is delivered at actual tick0');
    assert.equal(deliveries.some(frame => frame.slot === slot), false, 'no actor frame before public setup');
    assert.equal(calls.length, 0, 'setup precedes any physical turn');
    assert.deepEqual(Object.keys(setup).sort(), ['h', 'level', 'seed', 'spawn', 'w']);
    assert.equal(setup.w, g.w); assert.equal(setup.h, g.h);
    assert.deepEqual(setup.spawn, g.players[slot].spawn);
    assert.equal(setup.level, 'normal'); assert.equal(setup.seed, g.matchSeed);
    starts.push({ tick: g.tick, slot, scene: structuredClone(setup) });
  };
  const context = vm.createContext({ ai, sim, createGame: sim.createGame, step: sim.step,
    snapshotCache: sim.snapshotCache, CELL: sim.CELL, Math: Object.create(Math), performance: { now: () => 0 },
    readFileSync: () => JSON.stringify(map), console: { log() {} }, URL, onmessage: null,
    postMessage: value => messages.push(value), parentPort: { postMessage: value => messages.push(value) },
    process: { argv: ['node', 'tools/horde.mjs', 'fixture', '2', '1'] },
    isMainThread: false, workerData: { root: '/fixture', mode: 'conquest', map: 'fixture', seeds: [1] },
    resolve: (...parts) => parts.join('/'), dirname: () => '.', fileURLToPath: () => '.', pathToFileURL: value => ({ href: value }) });
  return { games, deliveries, calls, alerts, messages, starts, context };
}
function source(file) {
  return readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import[^\n]*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL(file, import.meta.url).href));
}
async function execute(file, humanCommander = true, publicStart = true) {
  const f = fixture(humanCommander, publicStart); let code = source(file);
  if (file === './tools/balance.mjs') {
    code = code.replace("const sim = await import(pathToFileURL(resolve(root, 'shared/sim.js')).href);", 'const sim = globalThis.sim;')
      .replace("const { think, observe, startCommander, humanCommander, thinkEvery } = await import(pathToFileURL(resolve(root, 'shared/ai.js')).href);",
        'const { think, observe, startCommander, humanCommander, thinkEvery } = globalThis.ai;');
    assert.ok(!code.includes('await import('), 'balance caller fixture must replace both exact current module imports');
  }
  await vm.runInContext(`(async () => { ${code}\n })()`, f.context, { filename: file });
  if (file === './client/fairness.js') f.context.onmessage({ data: { map, n: 1 } });
  return f;
}
function verify(f, file, humanCommander, publicStart) {
  const seats = f.games[0].players.length;
  assert.equal(f.games.length, 1, `${file}: one fixture match`);
  const initialized = humanCommander && publicStart;
  const director = f.games[0].mode.kind === 'horde' ? f.games[0].mode.slot : null;
  const assignedSeats = Array.from(f.games[0].players, (_, slot) => slot).filter(slot => slot !== director);
  assert.deepEqual(f.starts.map(({ tick, slot }) => ({ tick, slot })), initialized ? assignedSeats.map(slot => ({ tick: 0, slot })) : [],
    `${file}: one public initializer per assigned seat, none for director/legacy/older-module compatibility`);
  for (let slot = 0; slot < seats; slot++) {
    const seatFrames = f.deliveries.filter(frame => frame.slot === slot);
    assert.equal(seatFrames[0].tick, initialized && slot !== director ? 2 : 0,
      `${file}: actor rows first delivered2, original director/legacy paths retain0`);
  }
  const frames = f.deliveries.filter(frame => frame.tick > 0);
  assert.equal(frames.length, seats * finalTick / 2, `${file}: one observation per delivery beat and seat`);
  for (const frame of frames) {
    assert.equal(frame.shots, 4, `${file}: preserves both ticks of shot events without older history`);
    assert.equal(frame.cells, 2, `${file}: clears terrain transients after delivery`);
  }
  for (let slot = 0; slot < seats; slot++) {
    const events = f.alerts.filter(event => event.slot === slot).map(event => event.text);
    const firstAlertTick = initialized && slot !== director ? 3 : 1;
    const expectedAlerts = Array.from({ length: finalTick - firstAlertTick + 1 }, (_, index) => `tick-${index + firstAlertTick}`);
    assert.deepEqual(events, expectedAlerts, `${file}: every post-baseline scripted alert reaches its seat once, in order`);
    assert.equal(new Set(events).size, expectedAlerts.length, `${file}: retained history does not repeat alerts`);
    const firstDelivered = f.deliveries.find(frame => frame.slot === slot && frame.tick === 2);
    assert.deepEqual(firstDelivered.texts, ['tick-1', 'tick-2'], `${file}: odd first-beat alert rows are delivered intact`);
    assert.ok(events.includes(`tick-${firstAlertTick}`) && events.includes('tick-59'), `${file}: odd-beat alerts survive after the actual first-snapshot baseline`);
    if (firstAlertTick === 3) assert.ok(!events.includes('tick-1') && !events.includes('tick-2'),
      `${file}: shared detector initializes from first actual actor frame, never a fictitious actor0 frame`);
  }
  const expectedCalls = Array.from({ length: finalTick }, (_, n) => n + 1)
    .flatMap(tick => f.games[0].players.flatMap((_, slot) => (humanCommander ? !initialized || slot === director || tick >= 2 : (tick + slot * 13) % 40 === 0) ? [{ tick, slot }] : []));
  assert.deepEqual(f.calls.map(({ tick, slot }) => ({ tick, slot })), expectedCalls, `${file}: current hands advance each tick after actor delivery2; legacy cadence stays staggered`);
  for (const call of f.calls) assert.equal(call.deliveredTick, call.tick - call.tick % 2, `${file}: no newer observation between sends`);
  assert.equal(f.games[0].shots.length, 0, `${file}: final delivery clears shots`);
  assert.equal(f.games[0].newCells.length, 0, `${file}: final delivery clears terrain transients`);
  if (file === './tools/balance.mjs') {
    assert.equal(f.messages[0].m.kills, finalTick, 'balance: each actual kill is counted once');
    assert.equal(f.messages[0].m.infHits, finalTick, 'balance: each actual infantry hit is counted once');
  }
}
for (const file of ['./tools/horde.mjs', './client/fairness.js', './tools/balance.mjs']) {
  for (const [humanCommander, publicStart] of [[true, true], [false, true], [true, false]])
    verify(await execute(file, humanCommander, publicStart), file, humanCommander, publicStart);
}
console.log('AI caller public setup0, first actor2, old-module compatibility, delivery, odd-beat alerts, bounded transients and once-only balance counters passed');
