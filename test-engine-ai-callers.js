// Exercise real caller loops with deterministic tick events and the shared alert detector.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deriveAlertEvents } from './shared/alert-events.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 10, y: 10 }, { x: 60, y: 60 }, { x: 10, y: 60 }], points: [] };
const finalTick = 60;
function fixture(humanCommander = true) {
  const games = [], deliveries = [], calls = [], alerts = [], messages = [], memories = new Map();
  const sim = {
    CELL: 2, TICK: .05, COVER: 1, TRENCH: 2, UNITS: { rifle: { infantry: true } }, coverBehind: () => 0,
    snapshotCache: () => ({}),
    createGame(_map, names) {
      const g = { tick: 0, winner: null, shots: [], newCells: [], mode: { kind: 'horde', wave: 1 },
        players: names.map((name, i) => ({ name, team: i, faction: i, vp: 0, spawn: { x: (map.spawns[i].x + .5) * 2, z: (map.spawns[i].y + .5) * 2 } })),
        units: new Map([[1, { id: 1, type: 'rifle', owner: 0, x: 40, z: 40, hp: 100 }],
          [2, { id: 2, type: 'rifle', owner: 1, x: 44, z: 40, hp: 100 }]]), w: 80, flags: new Uint8Array(6400) };
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
      deliveries.push({ tick: g.tick, slot, shots: snapshot.shots.length, cells: g.newCells.length });
      return { tick: g.tick };
    },
    think(g, slot, options) { calls.push({ tick: g.tick, slot, deliveredTick: options.view.tick }); },
  };
  const context = vm.createContext({ ai, sim, createGame: sim.createGame, step: sim.step,
    snapshotCache: sim.snapshotCache, CELL: sim.CELL, Math: Object.create(Math), performance: { now: () => 0 },
    readFileSync: () => JSON.stringify(map), console: { log() {} }, URL, onmessage: null,
    postMessage: value => messages.push(value), parentPort: { postMessage: value => messages.push(value) },
    process: { argv: ['node', 'tools/horde.mjs', 'fixture', '2', '1'] },
    isMainThread: false, workerData: { root: '/fixture', mode: 'conquest', map: 'fixture', seeds: [1] },
    resolve: (...parts) => parts.join('/'), dirname: () => '.', fileURLToPath: () => '.', pathToFileURL: value => ({ href: value }) });
  return { games, deliveries, calls, alerts, messages, context };
}
function source(file) {
  return readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import[^\n]*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL(file, import.meta.url).href));
}
async function execute(file, humanCommander = true) {
  const f = fixture(humanCommander); let code = source(file);
  if (file === './tools/balance.mjs') {
    code = code.replace("const sim = await import(pathToFileURL(resolve(root, 'shared/sim.js')).href);", 'const sim = globalThis.sim;')
      .replace("const { think, observe, humanCommander, thinkEvery } = await import(pathToFileURL(resolve(root, 'shared/ai.js')).href);",
        'const { think, observe, humanCommander, thinkEvery } = globalThis.ai;');
  }
  await vm.runInContext(`(async () => { ${code}\n })()`, f.context, { filename: file });
  if (file === './client/fairness.js') f.context.onmessage({ data: { map, n: 1 } });
  return f;
}
function verify(f, file, humanCommander) {
  const seats = f.games[0].players.length;
  assert.equal(f.games.length, 1, `${file}: one fixture match`);
  const frames = f.deliveries.filter(frame => frame.tick > 0);
  assert.equal(frames.length, seats * finalTick / 2, `${file}: one observation per delivery beat and seat`);
  for (const frame of frames) {
    assert.equal(frame.shots, 4, `${file}: preserves both ticks of shot events without older history`);
    assert.equal(frame.cells, 2, `${file}: clears terrain transients after delivery`);
  }
  for (let slot = 0; slot < seats; slot++) {
    const events = f.alerts.filter(event => event.slot === slot).map(event => event.text);
    assert.equal(events.length, finalTick, `${file}: every scripted alert reaches its seat once`);
    assert.equal(new Set(events).size, finalTick, `${file}: retained history does not repeat alerts`);
    assert.ok(events.includes('tick-1') && events.includes('tick-59'), `${file}: odd-beat alerts survive`);
  }
  const expectedCalls = Array.from({ length: finalTick }, (_, n) => n + 1)
    .flatMap(tick => f.games[0].players.flatMap((_, slot) => humanCommander || (tick + slot * 13) % 40 === 0 ? [{ tick, slot }] : []));
  assert.deepEqual(f.calls.map(({ tick, slot }) => ({ tick, slot })), expectedCalls, `${file}: current hands advance each tick; legacy cadence stays staggered`);
  for (const call of f.calls) assert.equal(call.deliveredTick, call.tick - call.tick % 2, `${file}: no newer observation between sends`);
  assert.equal(f.games[0].shots.length, 0, `${file}: final delivery clears shots`);
  assert.equal(f.games[0].newCells.length, 0, `${file}: final delivery clears terrain transients`);
  if (file === './tools/balance.mjs') {
    assert.equal(f.messages[0].m.kills, finalTick, 'balance: each actual kill is counted once');
    assert.equal(f.messages[0].m.infHits, finalTick, 'balance: each actual infantry hit is counted once');
  }
}
for (const file of ['./tools/horde.mjs', './client/fairness.js', './tools/balance.mjs']) {
  for (const humanCommander of [true, false]) verify(await execute(file, humanCommander), file, humanCommander);
}
console.log('AI caller delivery, odd-beat alerts, bounded transients and once-only balance counters passed');
