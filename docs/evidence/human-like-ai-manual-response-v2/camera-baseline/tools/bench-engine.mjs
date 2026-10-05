// Reproducible, bounded engine workloads. Run with node tools/bench-engine.mjs --ticks 160.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import WebSocket from 'ws';
import * as sim from '../shared/sim.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTickMeter } from '../tickmeter.js';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
for (const arg of args) if (arg.startsWith('--') && !['--ticks', '--out', '--case', '--profile', '--ai'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
const ticks = Number(value('--ticks', '160'));
if (!Number.isSafeInteger(ticks) || ticks < 120 || ticks > 1000) throw new Error('--ticks must be an integer from 120 to 1000');
const output = value('--out', '/tmp/ww2-engine-bench.json');
const aiFile = value('--ai', null);
const aiURL = aiFile ? pathToFileURL(resolve(aiFile)) : new URL('../shared/ai.js', import.meta.url);
const aiModule = await import(aiURL.href);
const { observe, think, thinkEvery } = aiModule;
const profileComponents = args.includes('--profile');
const directCases = ['quiet', 'crossing', 'bombardment', 'projectile', 'navigation', 'collapse', 'ai', 'horde'];
const serverCases = ['serverRealtime', 'serverAccelerated'];
const availableCases = [...directCases, ...serverCases];
const selectedCases = [...new Set(value('--case', profileComponents ? 'navigation,projectile,collapse,ai,horde' : availableCases.join(','))
  .split(',').map(name => name.trim()))];
if (!selectedCases.length || selectedCases.some(name => !availableCases.includes(name))) throw new Error(`--case must select from ${availableCases.join(',')}`);
if (profileComponents && selectedCases.some(name => serverCases.includes(name))) throw new Error('--profile supports direct simulation cases only');
if (aiFile && selectedCases.some(name => serverCases.includes(name))) throw new Error('--ai supports direct simulation cases only; use --case ai or --case ai,horde');
const seed = 0x3c1055;
const digest = data => createHash('sha256').update(data).digest('hex');
const now = () => performance.now();
const round = number => Math.round(number * 1000) / 1000;
const stats = values => {
  const sorted = values.toSorted((a, b) => a - b);
  const pct = p => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return { count: values.length, p50: round(pct(.5)), p95: round(pct(.95)), p99: round(pct(.99)), max: round(sorted.at(-1)), mean: round(values.reduce((a, b) => a + b, 0) / values.length) };
};
const seeded = initial => {
  let state = initial;
  return () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
async function fixedRandom(fn) {
  const original = Math.random;
  Math.random = seeded(seed);
  try { return await fn(); } finally { Math.random = original; }
}
async function optionalModule(path) {
  try { return await import(path); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return null; throw error; }
}
const map = async name => JSON.parse(await readFile(new URL(`../maps/${name}.json`, import.meta.url), 'utf8'));
const stateHash = g => digest(JSON.stringify({ tick: g.tick, winner: g.winner, units: [...g.units.values()].map(u => [u.id, u.type, u.owner, round(u.x), round(u.z), round(u.hp)]) }));
const payloadSample = entries => entries.length ? [entries[0], entries[Math.floor(entries.length / 2)], entries.at(-1)] : [];
const sizeOf = collection => Array.isArray(collection) ? collection.length : collection instanceof Map || collection instanceof Set ? collection.size : null;
const stateCounts = g => {
  const movingWrecks = g.wrecks?.filter(wreck => wreck.motion && !wreck.motion.settled).length ?? 0;
  const settledWrecks = g.wrecks?.length === undefined ? null : g.wrecks.length - movingWrecks;
  const rubbleCells = g.chars?.filter(ch => ch === 'R').length ?? 0;
  const falling = sizeOf(g.fallingSections);
  return { flights: sizeOf(g.flights), falling, movingWrecks,
    activeDebrisBodies: falling === null ? null : falling + movingWrecks,
    settled: settledWrecks === null ? null : settledWrecks + rubbleCells,
    currentSalvos: g.salvos?.length ?? 0, currentStrikes: g.strikes?.length ?? 0, settledWrecks, rubbleCells };
};
const peakCounts = (peak, current) => Object.fromEntries(Object.keys(current).map(key =>
  [key, current[key] === null ? peak?.[key] ?? null : Math.max(peak?.[key] ?? current[key], current[key])]));

const CPU_FUNCTIONS = ['findPath', 'navigationLeg', 'stepFlights', 'damageWorldSection', 'supportedSections',
  'mutateWorldCell', 'debrisEnvironment', 'stepWorldDebris', 'stepDebris', 'settleDebris', 'settleSection',
  'settleWreck', 'hordeQueue', 'submitHordeMovement', 'flushHordeMovement', 'think', 'command', 'step'];
function summarizeCpuProfile(profile, wallMS) {
  const intervalUS = 250, nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const counts = Object.fromEntries(CPU_FUNCTIONS.map(name => [name, { selfSamples: 0, inclusiveSamples: 0 }]));
  for (const id of profile.samples ?? []) {
    const ownName = nodes.get(id)?.callFrame.functionName;
    if (Object.hasOwn(counts, ownName)) counts[ownName].selfSamples++;
    let cursor = id;
    const seen = new Set();
    while (cursor !== undefined) {
      const name = nodes.get(cursor)?.callFrame.functionName;
      if (Object.hasOwn(counts, name) && !seen.has(name)) { counts[name].inclusiveSamples++; seen.add(name); }
      cursor = parents.get(cursor);
    }
  }
  return { method: 'V8 inspector CPU samples', intervalUS, wallMS: round(wallMS), totalSamples: profile.samples?.length ?? 0,
    estimatedSampledCPUms: round((profile.samples?.length ?? 0) * intervalUS / 1000),
    functions: Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, { ...count,
      estimatedSelfCPUms: count.selfSamples ? round(count.selfSamples * intervalUS / 1000) : null,
      estimatedInclusiveCPUms: count.inclusiveSamples ? round(count.inclusiveSamples * intervalUS / 1000) : null }])),
    interpretation: 'Estimated CPU milliseconds equal sample count times 250 microseconds, not precise durations. Samples include profiler overhead. Inclusive estimates overlap, and zero samples mean the cost was below this run\'s resolution.' };
}
async function withCpuProfile(run) {
  const session = new Session(); session.connect();
  const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  let started = false;
  try {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 250 });
    await post('Profiler.start'); started = true;
    const begin = now(), result = await run();
    const wallMS = now() - begin, { profile } = await post('Profiler.stop'); started = false;
    if (result.supported !== false) result.cpuProfile = summarizeCpuProfile(profile, wallMS);
    return result;
  } finally {
    if (started) await post('Profiler.stop');
    session.disconnect();
  }
}

function addFormation(g, owner, count, x, z, type = 'rifle') {
  const template = [...g.units.values()].find(u => u.owner === owner && u.type === 'rifle');
  assert.ok(template, 'starting rifle required');
  const ids = [];
  for (let i = 0; i < count; i++) {
    const u = structuredClone(template);
    Object.assign(u, { id: g.nextId++, owner, type, x: x + i % 6 * 2.5, z: z + Math.floor(i / 6) * 2.5,
      hp: sim.UNITS[type].models * sim.UNITS[type].hpPer, path: [], orders: [], targetId: 0, attackId: 0,
      fireAt: -1, build: 0, autoRetreat: false });
    g.units.set(u.id, u); ids.push(u.id);
  }
  return ids;
}

async function simulationCase(name) {
  return fixedRandom(async () => {
    if (name === 'collapse' && typeof sim.damageWorldSection !== 'function') return {
      name, supported: false, reason: 'This revision does not export damageWorldSection', fixture: { map: 'test-arena', seed } };
    const mapName = name === 'crossing' || name === 'bombardment' || name === 'horde' ? 'the-great-bridge'
      : name === 'ai' ? 'six-fronts' : ['projectile', 'navigation', 'collapse'].includes(name) ? 'test-arena' : 'king-of-the-hill';
    const m = await map(mapName), ai = name === 'ai', horde = name === 'horde';
    const names = Array.from({ length: ai ? 6 : horde ? 4 : 2 }, (_, i) => `Bench ${i + 1}`);
    const navigationHelper = name === 'navigation' ? await optionalModule('../shared/navigation.js') : null;
    const projectileHelper = name === 'projectile' ? await optionalModule('../shared/projectiles.js') : null;
    const collapseRows = 24, collapseLength = 8, collapseX = 10, collapseY = 10;
    if (name === 'collapse') {
      m.rows = m.rows.map((row, y) => y >= collapseY && y < collapseY + collapseRows
        ? row.slice(0, collapseX) + 'B'.repeat(collapseLength) + row.slice(collapseX + collapseLength) : row);
      m.structures = Array.from({ length: collapseRows }, (_, row) => ({ id: `bench${row}`, kind: 'house',
        sections: Array.from({ length: collapseLength }, (_, index) => ({ id: `s${index}`,
          c: (collapseY + row) * m.w + collapseX + index, hp: 100, material: 'stone',
          anchor: index === 0, supports: index ? [`s${index - 1}`] : [] })) }));
      assert.equal(sim.validateMap(m), null, 'authored collapse map must validate');
    }
    const g = sim.createGame(m, names, false, names.map((_, i) => horde ? 0 : i), names.map((_, i) => i % sim.FACTION_COUNT),
      { mode: horde ? 'horde' : 'conquest', army: 'massive', weather: false, supply: false });
    const fixture = { map: mapName, players: names.length, seed,
      options: { mode: horde ? 'horde' : 'conquest', army: 'massive', weather: false, supply: false }, commands: [] };
    let crossingIds = [];
    let navigationIds = [];
    let gunA = [], gunB = [];
    if (name === 'crossing') {
      crossingIds = addFormation(g, 0, 24, 91, 96);
      const orders = crossingIds.map((id, i) => [id, 145 + i % 6 * 2, 96 + Math.floor(i / 6) * 2]);
      assert.equal(sim.command(g, 0, { t: 'move', orders }), undefined);
      fixture.commands.push({ t: 'move', units: crossingIds.length, destination: [145, 96] });
    }
    if (name === 'bombardment') {
      addFormation(g, 0, 12, 83, 92); addFormation(g, 1, 12, 139, 92);
      g.players[0].mp = 10000;
      assert.equal(sim.command(g, 0, { t: 'support', kind: 'artillery', x: 120, z: 96, dir: 0 }), undefined);
      fixture.commands.push({ t: 'support', kind: 'artillery', at: [120, 96] });
    }
    if (name === 'projectile') {
      gunA = addFormation(g, 0, 8, 73, 81, 'tank');
      gunB = addFormation(g, 1, 8, 96, 81, 'tank');
      fixture.guns = { type: 'tank', perSide: 8, initialSeparationMetres: 23 };
    }
    if (name === 'navigation') {
      navigationIds = addFormation(g, 0, 24, 40, 50);
      fixture.commands.push({ t: 'move', units: navigationIds.length, cadenceTicks: 8,
        destinations: [[120, 100], [35, 95]] });
    }
    if (name === 'collapse') fixture.collapse = { independentChains: collapseRows, sectionsPerChain: collapseLength,
      firstDamageTick: 10, damagePerTick: 1, direction: [1, 0] };
    if (horde) {
      const boss = g.mode.slot, template = [...g.units.values()].find(u => u.type === 'rifle');
      assert.ok(template && g.mode.kind === 'horde');
      const open = [];
      for (let y = 20; y < 80; y += 2) for (let x = 10; x < 49; x += 2) {
        const c = y * g.w + x;
        if (g.chars[c] === '.' && !(g.flags[c] & (sim.MOVE | sim.VBLOCK))) open.push({ x: (x + .5) * sim.CELL, z: (y + .5) * sim.CELL });
      }
      assert.ok(open.length >= 238, 'Horde field fixture needs 238 open cells');
      for (const at of open.slice(0, 238)) {
        const u = structuredClone(template);
        Object.assign(u, { id: g.nextId++, owner: boss, type: 'rifle', hp: sim.UNITS.rifle.models * sim.UNITS.rifle.hpPer,
          ...at, path: [], orders: [], targetId: 0, attackId: 0, autoRetreat: false });
        g.units.set(u.id, u);
      }
      Object.assign(g.mode, { wave: 9, timeLeft: 0 });
      fixture.horde = { defenders: 4, stagedRifles: 238, requestedWave: 10, army: 'massive',
        fieldCap: sim.CFG.horde.fieldMax, reserveCap: sim.CFG.horde.fieldMax,
        staging: '238 cloned boss rifles on open west-bank cells before normal wave purchasing and gates run' };
    }
    const initialUnits = g.units.size;
    const samples = { tick: [], step: [], ai: [], snapshot: [], navigationCommand: [], navigationLegStandalone: [],
      flightAtPositionOnly: [], supportUpdate: [] }, payloads = [];
    let shotEvents = 0, changedCells = 0, aiThinkCalls = 0;
    let peakStateCounts = stateCounts(g);
    let navigationCalls = 0, failedSections = 0, lastCollapseTick = null, settledAfterTick = null;
    let peakHordeField = 0, peakHordeReserve = 0, hordeTicksAtCap = 0;
    const navigationPathBefore = name === 'navigation' ? { ...(g.pathStats ?? {}) } : null;
    const views = [];
    let startupAI = 0;
    if ((ai || horde) && aiModule.humanCommander) {
      const started = now(), slots = horde ? [g.mode.slot] : names.map((_, i) => i);
      if (ai && aiModule.startCommander) {
        for (const i of slots) aiModule.startCommander(g, i, { w: g.w, h: g.h, spawn: g.players[i].spawn, level: 'normal', seed: g.matchSeed ?? g.seed });
      } else {
        const cache = sim.snapshotCache(g);
        for (const i of slots) views[i] = observe(g, i, cache);
      }
      startupAI = now() - started;
    }
    for (let n = 0; n < ticks && g.winner === null; n++) {
      if (name === 'navigation' && n % 8 === 0) {
        const [x, z] = n % 16 === 0 ? [120, 100] : [35, 95];
        const before = now(), result = sim.command(g, 0, { t: 'move', orders: navigationIds.map((id, i) => [id, x + i % 6 * 2, z + Math.floor(i / 6) * 2]) });
        samples.navigationCommand.push(now() - before);
        assert.equal(result, undefined); navigationCalls++;
        if (navigationHelper?.navigationLeg) {
          const u = g.units.get(navigationIds[0]), from = Math.floor(u.z / sim.CELL) * g.w + Math.floor(u.x / sim.CELL);
          const to = Math.floor(z / sim.CELL) * g.w + Math.floor(x / sim.CELL), helperStart = now();
          const leg = navigationHelper.navigationLeg(g, from, to, sim.MOVE | sim.WIRE);
          samples.navigationLegStandalone.push(now() - helperStart);
          assert.ok(Number.isInteger(leg.goal));
        }
      }
      if (name === 'collapse' && n >= 10 && n < 10 + collapseRows) {
        const row = n - 10, c = (collapseY + row) * g.w + collapseX, before = now();
        const hit = sim.damageWorldSection(g, c, 1000, { contactId: `bench-collapse-${row}`, direction: { x: 1, z: 0 } });
        samples.supportUpdate.push(now() - before);
        assert.equal(hit, 100); lastCollapseTick = g.tick;
      }
      const start = now(); sim.step(g); const afterStep = now();
      if (projectileHelper?.flightAt && g.flights?.size) {
        const flight = g.flights.values().next().value, helperStart = now();
        const position = projectileHelper.flightAt(flight, g.tick * sim.TICK);
        samples.flightAtPositionOnly.push(now() - helperStart);
        assert.ok(Number.isFinite(position.x));
      }
      if (name === 'projectile' && g.tick === 1) {
        assert.equal(sim.command(g, 0, { t: 'attack', ids: gunA, target: gunB[0] }), undefined);
        assert.equal(sim.command(g, 1, { t: 'attack', ids: gunB, target: gunA[0] }), undefined);
        fixture.commands.push({ t: 'attack', gunsPerSide: 8 });
      }
      let afterAi = afterStep;
      if (ai || horde) {
        const slots = horde ? [g.mode.slot] : names.map((_, i) => i);
        if (g.tick % 2 === 0) {
          const cache = sim.snapshotCache(g);
          for (const i of slots) views[i] = observe(g, i, cache);
        }
        for (const i of slots) if (views[i] && (aiModule.humanCommander || (g.tick + i * 13) % (thinkEvery?.('normal') ?? 40) === 0)) {
          think(g, i, { view: views[i], level: 'normal' }); aiThinkCalls++;
        }
        afterAi = now();
      }
      let afterSnapshot = afterAi;
      if (g.tick % 2 === 0) {
        const shots = g.shots, cells = g.newCells; g.shots = []; g.newCells = [];
        shotEvents += shots.length; changedCells += cells.length;
        const cache = sim.snapshotCache(g);
        for (let i = 0; i < names.length; i++) {
          const text = JSON.stringify(sim.snapshotFor(g, i, shots, cells, cache));
          payloads.push({ tick: g.tick, seat: i, bytes: Buffer.byteLength(text), sha256: digest(text) });
        }
        afterSnapshot = now();
      }
      // The first ten ticks warm the runtime and are omitted from latency distributions.
      if (n >= 10) {
        samples.tick.push(afterSnapshot - start); samples.step.push(afterStep - start);
        if (ai || horde) samples.ai.push(afterAi - afterStep);
        if (g.tick % 2 === 0) samples.snapshot.push(afterSnapshot - afterAi);
      }
      peakStateCounts = peakCounts(peakStateCounts, stateCounts(g));
      if (horde) {
        const field = [...g.units.values()].filter(u => u.owner === g.mode.slot && !u.air && u.hp > 0).length;
        peakHordeField = Math.max(peakHordeField, field); peakHordeReserve = Math.max(peakHordeReserve, g.mode.reserve.length);
        if (field === sim.CFG.horde.fieldMax) hordeTicksAtCap++;
        assert.ok(field <= sim.CFG.horde.fieldMax && g.mode.reserve.length <= sim.CFG.horde.fieldMax, 'Horde field and reserve must stay bounded');
      }
      if (name === 'collapse' && lastCollapseTick !== null && n >= 10 + collapseRows && settledAfterTick === null && !g.fallingSections.length) settledAfterTick = g.tick;
    }
    if (name === 'collapse') {
      failedSections = m.structures.flatMap(input => g.structures.get(`map:${input.id}`).sections).filter(section => section.state === 'failed').length;
      assert.equal(failedSections, collapseRows * collapseLength, 'dependent sections must fail');
      assert.ok((peakStateCounts.falling ?? 0) > 0 && settledAfterTick !== null, 'collapse must fall and settle');
    }
    if (horde) assert.equal(peakHordeField, sim.CFG.horde.fieldMax, 'Horde fixture must exercise the field cap');
    const navigationPathDeltas = navigationPathBefore ? Object.fromEntries(Object.keys(g.pathStats ?? {}).map(key =>
      [key, (g.pathStats[key] ?? 0) - (navigationPathBefore[key] ?? 0)])) : undefined;
    return { name, kind: 'direct simulation', fixture, ticks: g.tick, warmupTicksExcluded: 10,
      startupMilliseconds: { ai: startupAI, countedSeparatelyFromLatencyDistribution: true, excludedFromWarmLatencyDistribution: true },
      initialUnits, finalUnits: g.units.size, finalStateSHA256: stateHash(g), stateHashComparableAcrossRuns: true,
      milliseconds: Object.fromEntries(Object.entries(samples).filter(([key, values]) => values.length && !['navigationLegStandalone', 'flightAtPositionOnly'].includes(key))
        .map(([key, values]) => [key, stats(values)])),
      microseconds: Object.fromEntries(['navigationLegStandalone', 'flightAtPositionOnly'].filter(key => samples[key].length)
        .map(key => [key, stats(samples[key].map(value => value * 1000))])),
      snapshotBytes: stats(payloads.map(p => p.bytes)), payloadSample: payloadSample(payloads),
      events: { shotEvents, changedCells, aiThinkCalls },
      crossing: name === 'crossing' ? { ordered: crossingIds.length, onBridgeOrEast: crossingIds.filter(id => g.units.get(id)?.x >= 106).length,
        reachedEastBank: crossingIds.filter(id => g.units.get(id)?.x > 134).length } : undefined,
      navigation: name === 'navigation' ? { commands: navigationCalls, pathDeltas: navigationPathDeltas } : undefined,
      measurementScope: name === 'navigation' ? {
        navigationCommand: 'sim.command move for 24 units, including validation and path search',
        navigationLegStandalone: navigationHelper?.navigationLeg ? 'one cached navigation leg, excluding the full path search' : 'unavailable in this revision',
      } : name === 'projectile' ? {
        step: 'full simulation step, including flight advancement, contact and other game work',
        flightAtPositionOnly: projectileHelper?.flightAt ? 'one flight position calculation, excluding contact and damage' : 'unavailable in this revision',
      } : name === 'collapse' ? {
        supportUpdate: 'damageWorldSection call, including support traversal, section failure and cell changes',
      } : undefined,
      collapse: name === 'collapse' ? { damagedAnchors: samples.supportUpdate.length, failedSections,
        settleAfterLastDamageSeconds: round((settledAfterTick - lastCollapseTick) * sim.TICK) } : undefined,
      horde: horde ? { wave: g.mode.wave, peakField: peakHordeField, peakReserve: peakHordeReserve,
        ticksAtFieldCap: hordeTicksAtCap, finalField: [...g.units.values()].filter(u => u.owner === g.mode.slot && !u.air && u.hp > 0).length,
        finalReserve: g.mode.reserve.length, remainingBudget: round(g.mode.budget) } : undefined,
      stateCounts: stateCounts(g), peakStateCounts, memoryBytes: process.memoryUsage(), paths: g.pathStats ?? null };
  });
}

async function serverCase() {
  return fixedRandom(async () => {
  process.env.PORT = '0'; process.env.HOST = '127.0.0.1'; process.env.EDIT_PASSWORD = 'benchmark';
  const service = await import('../server.js');
  if (!service.server.listening) await new Promise(resolve => service.server.once('listening', resolve));
  const clients = [], samples = [], payloads = [];
  const arrivals = [[], []];
  let moveProbe = null;
  let livePeakCounts = null;
  const phases = Object.fromEntries(['tick', 'step', 'think', 'snapshot', 'snapshotBuild', 'snapshotStringify'].map(name => [name, []]));
  const waitFor = async (condition, label) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
    throw new Error(label);
  };
  try {
    const port = service.server.address().port;
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=benchengine`, { perMessageDeflate: true });
      const client = { ws, lobby: null, started: false, pongs: new Set() }; clients.push(client);
      ws.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.t === 'lobby') client.lobby = msg;
        if (msg.t === 'start') client.started = true;
        if (msg.t === 'pong') client.pongs.add(msg.c);
        if (msg.t === 's') {
          const receivedAt = now();
          arrivals[i].push(receivedAt);
          payloads.push({ tick: msg.tick, seat: i, bytes: raw.length, sha256: digest(raw) });
          const game = service.rooms.get('benchengine')?.game;
          if (game) livePeakCounts = peakCounts(livePeakCounts, stateCounts(game));
          if (i === 0 && moveProbe && moveProbe.receivedAt === null) {
            const row = msg.units.find(u => u[0] === moveProbe.id);
            if (row && (row[3] !== moveProbe.x || row[4] !== moveProbe.z)) moveProbe.receivedAt = receivedAt;
          }
        }
      });
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      assert.match(ws.extensions, /permessage-deflate/, 'WebSocket compression must negotiate');
      ws.send(JSON.stringify({ t: 'hello', name: `Bench ${i + 1}`, token: `bench-engine-${i}` }));
      await waitFor(() => client.lobby, 'lobby timeout');
    }
    const host = clients[0], barrier = async id => {
      host.ws.send(JSON.stringify({ t: 'ping', c: id }));
      await waitFor(() => host.pongs.has(id), 'barrier timeout');
    };
    host.ws.send(JSON.stringify({ t: 'map', name: 'king-of-the-hill' }));
    host.ws.send(JSON.stringify({ t: 'mode', v: 'conquest' }));
    await barrier(1);
    host.ws.send(JSON.stringify({ t: 'start' }));
    await waitFor(() => clients.every(c => c.started), 'start timeout');
    const room = service.rooms.get('benchengine');
    assert.equal(room.mapName, 'king-of-the-hill');
    const serverOptions = { mode: room.mode, army: room.army ?? 'standard',
      weather: room.weather ?? 'map', supply: room.game.supply };
    const unitsBeforeStaging = room.game.units.size;
    const spawn = room.game.players[0].spawn;
    addFormation(room.game, 0, 24, spawn.x + 8, spawn.z + 8);
    const realInitialUnits = room.game.units.size;
    const realTicks = 60;
    const realMeter = createTickMeter({ size: realTicks + 4, snapshotSize: realTicks + 4, now: Date.now() });
    realMeter.snapEvery = room.snapEvery;
    room.tickMeter = realMeter;
    const realStartTick = room.game.tick;
    const realStartPayload = payloads.length;
    const realStartArrivals = arrivals.map(a => a.length);
    const realStart = now();
    await waitFor(() => arrivals[0].length > realStartArrivals[0], 'first real-time snapshot timeout');
    const rifle = [...room.game.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
    assert.ok(rifle, 'owned rifle required for move probe');
    moveProbe = { id: rifle.id, x: Math.round(rifle.x * 10) / 10, z: Math.round(rifle.z * 10) / 10,
      sentAt: now(), receivedAt: null };
    host.ws.send(JSON.stringify({ t: 'move', orders: [[rifle.id, rifle.x + 8, rifle.z + 2]] }));
    await waitFor(() => moveProbe.receivedAt !== null, 'move update timeout');
    await waitFor(() => room.game.tick - realStartTick >= realTicks, 'real-time ticks timeout');
    clearInterval(service.loop);
    await barrier(2);
    const realPayloads = payloads.slice(realStartPayload);
    assert.ok(realPayloads.some(p => p.bytes >= 1024), 'snapshot must cross compression threshold');
    const gaps = arrivals.flatMap((list, i) => list.slice(realStartArrivals[i] + 1).map((at, k) => at - list[realStartArrivals[i] + k]));
    const realPhases = Object.fromEntries(Object.entries(realMeter.phases).map(([name, ring]) =>
      [name, stats(Array.from(ring.values.subarray(0, ring.count)))]));
    const realTime = { name: 'serverRealtime', kind: 'production timer and compressed WebSocket clients',
      fixture: { map: room.mapName, players: 2, stagedRifles: 24, targetTicks: realTicks, sockets: 2,
        options: serverOptions, unitsBeforeStaging, compression: clients.map(c => c.ws.extensions), compressionThresholdBytes: 1024 },
      ticks: room.game.tick - realStartTick, warmupTicksExcluded: 0, measurementWallMS: round(now() - realStart),
      initialUnits: realInitialUnits, finalUnits: room.game.units.size,
      meterScope: { startTick: realStartTick, endTick: room.game.tick, tickSamples: realMeter.phases.tick.count,
        startupSamplesIncluded: false, resetAtMeasurementStart: true },
      milliseconds: { ...realPhases, receiveGap: stats(gaps), moveToChangedUnit: stats([moveProbe.receivedAt - moveProbe.sentAt]) },
      snapshotBytes: stats(realPayloads.map(p => p.bytes)), payloadSample: payloadSample(realPayloads), receivedSnapshots: realPayloads.length,
      stateCounts: stateCounts(room.game), peakStateCounts: livePeakCounts,
      memoryBytes: process.memoryUsage(), finalStateSHA256: stateHash(room.game),
      stateHashComparableAcrossRuns: false };
    const acceleratedPayloadStart = payloads.length;
    room.tickMeter = createTickMeter({ size: ticks, snapshotSize: ticks, now: Date.now() });
    const acceleratedStartTick = room.game.tick;
    const acceleratedInitialUnits = room.game.units.size;
    let acceleratedPeakCounts = stateCounts(room.game);
    const wallStart = now();
    for (let n = 0; n < ticks && room.game.winner === null; n++) {
      const start = now(); service.tickRooms();
      if (n >= 10) {
        samples.push(now() - start);
        for (const [name, values] of Object.entries(phases)) {
          if (name.startsWith('snapshot') && room.game.tick % room.snapEvery !== 0) continue;
          const ring = room.tickMeter.phases[name];
          values.push(ring.values[(ring.next + ring.values.length - 1) % ring.values.length]);
        }
      }
      acceleratedPeakCounts = peakCounts(acceleratedPeakCounts, stateCounts(room.game));
      await new Promise(resolve => setImmediate(resolve));
    }
    await barrier(3);
    const acceleratedPayloads = payloads.slice(acceleratedPayloadStart);
    const result = { name: 'serverAccelerated', kind: 'manually stepped WebSocket server',
      fixture: { map: room.mapName, players: 2, stagedRifles: 24, ticksRequested: ticks, sockets: 2,
        options: serverOptions, unitsBeforeStaging },
      ticks: room.game.tick - acceleratedStartTick, warmupTicksExcluded: 10,
      initialUnits: acceleratedInitialUnits, finalUnits: room.game.units.size, finalStateSHA256: stateHash(room.game),
      measurementWallMS: round(now() - wallStart),
      milliseconds: { tickCall: stats(samples), ...Object.fromEntries(Object.entries(phases).map(([name, values]) => [name, stats(values)])) },
      snapshotBytes: stats(acceleratedPayloads.map(p => p.bytes)), payloadSample: payloadSample(acceleratedPayloads),
      receivedSnapshots: acceleratedPayloads.length, snapEvery: room.snapEvery,
      stateCounts: stateCounts(room.game), peakStateCounts: acceleratedPeakCounts,
      memoryBytes: process.memoryUsage(), stateHashComparableAcrossRuns: false };
    return [realTime, result];
  } finally {
    clearInterval(service.loop);
    service.clock.setTimeout = () => null;
    for (const client of clients) client.ws.terminate();
    for (const ws of service.wss.clients) ws.terminate();
    service.rooms.clear();
    await new Promise(resolve => service.wss.close(resolve));
    await new Promise(resolve => service.server.close(resolve));
  }
  });
}

const files = ['tools/bench-engine.mjs', 'server.js', 'tickmeter.js',
  ...(await readdir(new URL('../shared/', import.meta.url))).filter(file => file.endsWith('.js')).map(file => `shared/${file}`),
  'maps/king-of-the-hill.json', 'maps/the-great-bridge.json', 'maps/six-fronts.json', 'maps/test-arena.json'];
const sourceSHA256 = Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(new URL(`../${file}`, import.meta.url)))])));
const report = { at: new Date().toISOString(), sourceSHA256, seed, requestedTicks: ticks, selectedCases,
  aiCommander: { file: aiURL.href, sourceSHA256: digest(await readFile(aiURL)), humanCommander: !!aiModule.humanCommander,
    phaseScope: 'whole AI phase per simulation tick, including delivered-view observation and hands advancement' },
  runtime: process.version, runtimeFlags: process.execArgv, platform: process.platform, arch: process.arch,
  hardware: { model: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryBytes: os.totalmem() },
  ...(profileComponents && { profiling: { intervalUS: 250, wallTimingsIncludeProfilerOverhead: true,
    note: 'CPU estimates are sampled self and inclusive time for named functions; inclusive values overlap.' } }),
  cases: [] };
for (const name of directCases) if (selectedCases.includes(name)) report.cases.push(
  profileComponents && !(name === 'collapse' && typeof sim.damageWorldSection !== 'function')
    ? await withCpuProfile(() => simulationCase(name)) : await simulationCase(name));
if (selectedCases.some(name => serverCases.includes(name))) report.cases.push(...(await serverCase()).filter(item => selectedCases.includes(item.name)));
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const item of report.cases) {
  if (item.supported === false) { console.log(`${item.name}: unsupported (${item.reason})`); continue; }
  const tick = item.milliseconds.tick ?? item.milliseconds.tickCall;
  console.log(`${item.name}: ${item.ticks} ticks, p50/p95/p99 ${tick.p50}/${tick.p95}/${tick.p99} ms`);
}
console.log(`REPORT ${output}`);
