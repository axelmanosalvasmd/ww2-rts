// Bounded diagnostics over real WebSocket clients. Fixtures never add production server routes.
import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { generateWorldMap } from '../shared/world-conquest.js';
import { UNITS, TICK, snapshotCache, popCap } from '../shared/sim.js';
import { observe, think, thinkEvery } from '../shared/ai.js';
import { createTickMeter } from '../tickmeter.js';

const args = process.argv.slice(2), preview = args.includes('--preview');
const argument = (key, fallback) => args.find(a => a.startsWith(`${key}=`))?.split('=').slice(1).join('=') ?? fallback;
const bounded = (key, fallback, low, high) => Math.min(high, Math.max(low, Number(argument(key, fallback)) || fallback));
const mobile = bounded('--mobile', 64, 16, 96), samples = bounded('--ticks', 80, 20, 2000);
const pacingTicks = args.includes('--no-pacing') ? 0 : bounded('--pacing-ticks', 600, 0, 3600);
Object.assign(process.env, { PORT: preview ? argument('--port', '3843') : '0', HOST: '127.0.0.1', EDIT_PASSWORD: 'benchmark', PUBLIC_URL: 'http://127.0.0.1' });
const server = await import('../server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], delay = () => new Promise(resolve => setTimeout(resolve, 2));
let pingId = 0, liveLoop;
const stat = a => {
  if (!a.length) return { count: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...a].sort((x, y) => x - y);
  return { count: a.length, p50: sorted[Math.ceil(a.length * .5) - 1], p95: sorted[Math.ceil(a.length * .95) - 1], max: sorted.at(-1) };
};
async function until(fn, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const value = fn(); if (value) return value; await delay(); }
  throw new Error(label);
}
async function connect(code, seat) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${code}`, { perMessageDeflate: false });
  const c = { ws, units: new Map(), payloads: [], starts: [], pongs: new Set(), denies: [], snapshots: 0, bytes: 0 };
  clients.push(c);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 'start') { c.starts.push({ message: m, bytes: raw.length }); c.units.clear(); }
    if (m.t === 's') {
      if (m.all) c.units.clear();
      for (const id of m.gone ?? []) c.units.delete(id);
      for (const row of m.units) c.units.set(row[0], row);
      c.latest = m; c.snapshots++; c.bytes += raw.length; c.payloads.push(raw.length);
    }
    if (m.t === 'pong') c.pongs.add(m.c);
    if (m.t === 'deny') c.denies.push(m);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  c.send = m => ws.send(JSON.stringify(m));
  c.barrier = async () => { const id = ++pingId; c.send({ t: 'ping', c: id }); await until(() => c.pongs.delete(id), 'missing ping barrier'); };
  c.send({ t: 'hello', name: `Benchmark ${seat + 1}`, token: `${code}-${seat}` });
  await until(() => c.lobby, 'missing lobby');
  return c;
}
async function tick(room, count = 1, measured) {
  for (let i = 0; i < count; i++) {
    const started = performance.now();
    const snapshotSamples = measured ? room.tickMeter.phases.snapshot.next : null;
    server.tickRooms();
    if (measured) {
      measured.elapsed.push(performance.now() - started);
      for (const [phase, ring] of Object.entries(room.tickMeter.phases)) {
        if (phase.startsWith('snapshot') && room.tickMeter.phases.snapshot.next === snapshotSamples) continue;
        measured.phases[phase].push(ring.values[(ring.next + ring.values.length - 1) % ring.values.length]);
      }
    }
    // Flush JSON and socket callbacks instead of retaining an unbounded output queue.
    await new Promise(resolve => setImmediate(resolve));
  }
  await delay();
}
async function setup(size) {
  const code = `bench${size}`, seats = [];
  for (let i = 0; i < 6; i++) seats.push(await connect(code, i));
  const host = seats[0];
  host.send({ t: 'mode', v: 'world' }); host.send({ t: 'worldSize', v: size }); host.send({ t: 'army', v: 'massive' });
  for (let i = 0; i < 6; i++) host.send({ t: 'team', slot: i, v: Math.floor(i / 2) });
  await host.barrier();
  const started = performance.now(); host.send({ t: 'start' });
  await until(() => seats.every(c => c.starts.length), 'missing start');
  const startMS = performance.now() - started, room = server.rooms.get(code), g = room.game;
  await tick(room, 4);
  // Artificial funds, completed construction, accelerated train progress and deployment spread.
  // Every building and mobile unit is still purchased by its real owning socket.
  for (let slot = 0; slot < 6; slot++) {
    Object.assign(g.players[slot], { mp: 100000, fuel: 100000, mun: 100000 });
    const engineer = [...seats[slot].units.values()].find(u => u[2] === slot && u[1] === 'engineer');
    assert.ok(engineer, 'starting Engineer received over the wire');
    const own = g.world.regions.find(r => r.home === slot);
    for (const [kind, x, z] of [['barracks', own.x + 6, own.z - 8], ['motorpool', own.x - 8, own.z + 6]]) {
      const before = g.players[slot].mp;
      seats[slot].send({ t: 'build', ids: [engineer[0]], kind, x, z }); await seats[slot].barrier();
      await tick(room, 2);
      const building = [...g.units.values()].find(u => u.owner === slot && u.type === kind);
      assert.ok(building, `paid ${kind} fixture exists for seat ${slot}: ${JSON.stringify(seats[slot].denies)}`);
      assert.ok(g.players[slot].mp < before - 100, 'construction charged funds');
      building.built = 1;
    }
  }
  const roster = ['rifle', 'mg', 'mortar', 'tank'];
  for (let n = 2; n < mobile; n++) {
    for (let slot = 0; slot < 6; slot++) {
      const type = roster[(n - 2) % roster.length], maker = [...g.units.values()].find(u => u.owner === slot && UNITS[u.type].makes?.includes(type));
      seats[slot].send({ t: 'buy', unit: type, from: maker.id });
    }
    await Promise.all(seats.map(c => c.barrier()));
    for (const u of g.units.values()) if (u.owner >= 0 && u.queue?.length) u.prog = UNITS[u.queue[0]].train;
    await tick(room);
  }
  for (let slot = 0; slot < 6; slot++) {
    const army = [...g.units.values()].filter(u => u.owner === slot && !UNITS[u.type].structure);
    assert.equal(army.length, mobile, 'paid mobile army reached requested size');
    const home = g.world.regions.find(r => r.home === slot);
    army.forEach((u, i) => Object.assign(u, { x: home.x + ((i % 8) - 3.5) * 8, z: home.z + (Math.floor(i / 8) - 3.5) * 8,
      path: [], build: 0, autoRetreat: false }));
    // Retain plausible funds after the accelerated fixture production phase.
    Object.assign(g.players[slot], { mp: 2000, fuel: 500, mun: 300 });
  }
  await tick(room, 8);
  return { code, room, g, seats, startMS };
}
async function measure(size) {
  const { code, room, g, seats, startMS } = await setup(size);
  const generation = [];
  for (let n = 0; n < 3; n++) { const begin = performance.now(); generateWorldMap({ size, seed: g.world.seed, players: 6, teams: g.players.map(p => p.team) }); generation.push(performance.now() - begin); }
  const orders = [], moves = [];
  for (let round = 0; round < 3; round++) for (let slot = 0; slot < 6; slot++) {
    const c = seats[slot], rows = [...c.units.values()].filter(u => u[2] === slot && !UNITS[u[1]].structure);
    const x = slot % 2 ? 80 : g.w * 2 - 80, z = round % 2 ? 80 : g.h * 2 - 80;
    const distance = Math.max(...rows.map(u => Math.hypot(u[3] - x, u[4] - z)));
    const begin = performance.now(); c.send({ t: 'move', orders: rows.map(u => [u[0], x, z]) }); await c.barrier();
    moves.push(performance.now() - begin); orders.push(distance);
  }
  await tick(room, 80);
  room.tickMeter = createTickMeter({ size: samples, snapshotSize: samples, now: Date.now() });
  const measured = { elapsed: [], phases: Object.fromEntries(Object.keys(room.tickMeter.phases).map(p => [p, []])) };
  seats.forEach(c => { c.payloads = []; c.snapshots = 0; c.bytes = 0; });
  const begin = performance.now(); await tick(room, samples, measured); const wallMS = performance.now() - begin;
  const memory = process.memoryUsage(), payloads = seats.flatMap(c => c.payloads);
  const measuredUnits = g.units.size, measuredLocalMobile = [...g.units.values()].filter(u => u.owner === -1 && !UNITS[u.type].structure).length;
  const aiObservation = [], aiPlanning = [], aiCommands = [];
  for (let n = 0; n < 5; n++) for (let slot = 0; slot < 6; slot++) {
    let start = performance.now(); const view = observe(g, slot, snapshotCache(g)); aiObservation.push(performance.now() - start);
    start = performance.now(); let count = 0;
    think(g, slot, { view, memory: {}, level: 'normal', submit: cmd => { seats[slot].send(cmd); count++; } });
    aiPlanning.push(performance.now() - start); aiCommands.push(count); await seats[slot].barrier();
  }
  const result = { size, seed: g.world.seed, seats: 6, teams: [0, 0, 1, 1, 2, 2], armySetting: 'massive', mobilePerSeat: mobile,
    units: measuredUnits, localMobile: measuredLocalMobile,
    capPerSeat: popCap(g, 0), startMS, generationMS: stat(generation), startBytes: stat(seats.map(c => c.starts[0].bytes)),
    measuredTicks: samples, simulationSeconds: samples * TICK, measurementWallMS: wallMS, tickCallMS: stat(measured.elapsed),
    phasesMS: Object.fromEntries(Object.entries(measured.phases).map(([p, a]) => [p, stat(a)])),
    longMoveBarrierMS: stat(moves), longMoveDistanceMetres: stat(orders), aiObserveMS: stat(aiObservation), aiPlanMS: stat(aiPlanning),
    aiCommandsPerPlan: stat(aiCommands), snapshotBytes: stat(payloads), receivedSnapshots: payloads.length,
    totalSnapshotBytes: seats.reduce((a, c) => a + c.bytes, 0), snapEvery: room.snapEvery, memoryBytes: memory,
    denies: seats.map(c => c.denies) };
  if (pacingTicks && size === 'huge') {
    // A controlled expansion fight tests the AI loop, not natural growth or full-match duration.
    const home = g.world.regions.find(r => r.home === 0), target = g.world.regions.filter(r => r.team === -1).sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
    const army = [...g.units.values()].filter(u => u.owner === 0 && !UNITS[u.type].structure);
    army.forEach((u, i) => Object.assign(u, { x: target.x - 30 + (i % 8) * 3, z: target.z - 28 + Math.floor(i / 8) * 3,
      path: [], orders: [], targetId: 0, attackId: 0, build: 0, worldGoal: null, autoRetreat: false }));
    const before = seats[0].latest.world.owned, memory = {}; let commandCount = 0, firstCaptureTick = null;
    const startTick = g.tick, paceBegin = performance.now();
    for (let n = 0; n < pacingTicks && g.winner === null; n++) {
      await tick(room);
      if (n % thinkEvery('normal') === 0) {
        think(g, 0, { view: observe(g, 0, snapshotCache(g)), memory, level: 'normal', submit: cmd => { seats[0].send(cmd); commandCount++; } });
        await seats[0].barrier();
      }
      if (firstCaptureTick === null && seats[0].latest.world.owned > before) firstCaptureTick = g.tick - startTick;
    }
    result.expansionProbe = { target: target.id, initialOwned: before, finalOwned: seats[0].latest.world.owned,
      firstGainSeconds: firstCaptureTick === null ? null : firstCaptureTick * TICK, simulatedSeconds: (g.tick - startTick) * TICK,
      wallMS: performance.now() - paceBegin, commands: commandCount, winner: g.winner,
      participantMobileRemaining: [...g.units.values()].filter(u => u.owner === 0 && !UNITS[u.type].structure).length };
  }
  server.rooms.delete(code);
  for (const c of seats) c.ws.terminate();
  console.log(`${size}: tick p95 ${result.tickCallMS.p95.toFixed(2)} ms, max ${result.tickCallMS.max.toFixed(2)} ms, ${result.units} units`);
  return result;
}
async function cleanup() {
  clearInterval(liveLoop); server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
try {
  if (preview) {
    for (const size of ['huge', 'massive']) await setup(size);
    liveLoop = setInterval(server.tickRooms, TICK * 1000);
    console.log(`PREVIEW_READY http://127.0.0.1:${server.server.address().port}/play#benchhuge and /play#benchmassive; set ww2-token:ROOM to ROOM-0 for seat 0`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else {
    const sourceSHA256 = Object.fromEntries(await Promise.all(['shared/sim.js', 'shared/ai.js', 'server.js'].map(async path =>
      [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])));
    const report = { at: new Date().toISOString(), sourceSHA256, runtime: process.version, platform: process.platform, arch: process.arch,
      hardware: { model: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryBytes: os.totalmem() }, presets: [] };
    for (const size of ['huge', 'massive']) report.presets.push(await measure(size));
    report.cleanup = { rooms: 0, listenerClosed: true, socketsTerminated: true };
    await cleanup();
    const output = argument('--out', '/tmp/ww2-world-conquest-bench.json'); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`REPORT ${output}`);
  }
} finally { if (server.server.listening) await cleanup(); }
