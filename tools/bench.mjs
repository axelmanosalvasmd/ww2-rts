// Six Massive AI armies, including the server's visibility filtering and serialization.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const options = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), ticks: 6000, scenario: 'all', dump: null, map: null };
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!['--root', '--ticks', '--scenario', '--dump', '--map'].includes(key) || i + 1 >= process.argv.length) {
    throw new Error('Usage: node tools/bench.mjs [--root DIR] [--ticks N] [--scenario classic|conquest|all] [--dump FILE]');
  }
  options[key.slice(2)] = process.argv[++i];
}
options.root = resolve(options.root);
options.ticks = Number(options.ticks);
if (!Number.isSafeInteger(options.ticks) || options.ticks < 1) throw new Error('--ticks must be a positive integer');
if (!['classic', 'conquest', 'all'].includes(options.scenario)) throw new Error('Unknown scenario');

const sim = await import(pathToFileURL(resolve(options.root, 'shared/sim.js')).href);
const ai = await import(pathToFileURL(resolve(options.root, 'shared/ai.js')).href);
const { aiTick } = await import('../shared/ai-schedule.js');
const seed = 0x3c1055;
function seededRandom(initial) {
  let value = initial;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clock = () => process.hrtime.bigint();
const us = (start, end) => Number(end - start) / 1000;
const round = value => Math.round(value * 100) / 100;
function stats(samples) {
  if (!samples.length) return { p50: 0, p95: 0, mean: 0, count: 0 };
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    mean: round(samples.reduce((total, value) => total + value, 0) / samples.length),
    count: samples.length,
  };
}

async function run(scenario) {
  // The hill gives Classic a busy central battle. Six Fronts sustains more Conquest units.
  const mapName = options.map ?? (scenario === 'classic' ? 'king-of-the-hill' : 'six-fronts');
  const map = JSON.parse(await readFile(resolve(options.root, 'maps', mapName + '.json'), 'utf8'));
  const originalRandom = Math.random, random = seededRandom(seed);
  let randomCalls = 0;
  Math.random = () => { randomCalls++; return random(); };
  try {
    const names = Array.from({ length: 6 }, (_, i) => 'AI ' + (i + 1));
    const game = sim.createGame(map, names, true, names.map((_, i) => i), names.map((_, i) => i % 3), { mode: scenario, army: 'massive' });
    const samples = { tick: [], step: [], think: [], snapshotBuild: [], stringify: [], snapshotTotal: [], snapshotTick: [] };
    const bytes = names.map(() => []);
    let peakUnits = game.units.size;
    const seats = names.map((_, slot) => ({ slot, level: 'normal', ai })), views = [], first = sim.snapshotCache(game);
    for (const { slot } of seats) views[slot] = ai.observe(game, slot, first);
    for (let t = 0; t < options.ticks; t++) {
      const start = clock();
      game.players.forEach(p => { p.away = false; });
      const stepStart = clock();
      sim.step(game);
      const stepEnd = clock();
      // The server's AI schedule (shared/ai-schedule.js). Every slot is an AI.
      aiTick(game, seats, views, { sim });
      const thinkEnd = clock();
      let buildUs = 0, stringifyUs = 0;
      const snapshotTick = game.tick % 2 === 0 || game.winner !== null;
      if (snapshotTick) {
        const shots = game.shots, cells = game.newCells;
        game.shots = []; game.newCells = [];
        const online = names.map(() => true), ping = names.map(() => -1);
        const cacheStart = clock();
        const cache = typeof sim.snapshotCache === 'function' ? sim.snapshotCache(game) : undefined;
        buildUs += us(cacheStart, clock());
        for (let i = 0; i < 6; i++) {
          const buildStart = clock();
          const snapshot = { ...sim.snapshotFor(game, i, shots, cells, cache), online, ping };
          const stringifyStart = clock();
          const encoded = JSON.stringify(snapshot);
          const stringifyEnd = clock();
          buildUs += us(buildStart, stringifyStart);
          stringifyUs += us(stringifyStart, stringifyEnd);
          bytes[i].push(Buffer.byteLength(encoded));
        }
      }
      const end = clock(), tickUs = us(start, end);
      samples.tick.push(tickUs);
      samples.step.push(us(stepStart, stepEnd));
      samples.think.push(us(stepEnd, thinkEnd));
      if (snapshotTick) {
        samples.snapshotBuild.push(buildUs);
        samples.stringify.push(stringifyUs);
        samples.snapshotTotal.push(buildUs + stringifyUs);
        samples.snapshotTick.push(tickUs);
      }
      peakUnits = Math.max(peakUnits, game.units.size);
      // The server returns to the lobby when a winner is decided.
      if (game.winner !== null) break;
    }
    const state = {
      tick: game.tick,
      winner: game.winner,
      vp: game.players.map(p => p.vp),
      mp: game.players.map(p => p.mp),
      units: [...game.units.values()].sort((a, b) => a.id - b.id).map(u => ({ id: u.id, type: u.type, owner: u.owner, x: u.x, z: u.z, hp: u.hp })),
    };
    const dump = JSON.stringify(state), hash = createHash('sha256').update(dump).digest('hex');
    let dumpFile = options.dump;
    if (dumpFile && options.scenario === 'all') dumpFile += '.' + scenario + '.json';
    if (dumpFile) await writeFile(dumpFile, dump + '\n');
    const pathStats = game.pathStats ?? game.pathCounters;
    const result = {
      scenario, root: options.root, map: mapName, army: 'massive', players: 6, seed, requestedTicks: options.ticks,
      ticks: game.tick, randomCalls, hash,
      microseconds: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, stats(values)])),
      snapshotBytes: bytes.map((values, slot) => ({ slot, mean: round(values.reduce((a, b) => a + b, 0) / (values.length || 1)), max: values.reduce((a, b) => Math.max(a, b), 0) })),
      units: { final: game.units.size, peak: peakUnits, perPlayer: names.map((_, slot) => [...game.units.values()].filter(u => u.owner === slot).length) },
      paths: pathStats ?? { calls: null, deferred: null, failed: null, dropped: null, available: false },
      dump: dumpFile,
    };
    console.log(`${scenario}: Massive, six AI, ${mapName}, ${game.tick} ticks, ${game.units.size} final units (${peakUnits} peak)`);
    for (const [key, value] of Object.entries(result.microseconds)) console.log(`  ${key}: p50 ${value.p50} us, p95 ${value.p95} us, mean ${value.mean} us (${value.count} samples)`);
    console.log(`  snapshot bytes per player (mean/max): ${result.snapshotBytes.map(p => `${p.slot}: ${p.mean}/${p.max}`).join(', ')}`);
    console.log(`  paths: ${JSON.stringify(result.paths)}, random calls: ${randomCalls}`);
    console.log(`  final-state sha256: ${hash}`);
    console.log('RESULT ' + JSON.stringify(result));
  } finally {
    Math.random = originalRandom;
  }
}

for (const scenario of options.scenario === 'all' ? ['classic', 'conquest'] : [options.scenario]) await run(scenario);
