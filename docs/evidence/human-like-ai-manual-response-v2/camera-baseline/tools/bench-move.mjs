// Repeated 60-unit move commands. The script's map stays fixed when --root changes the simulation revision.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const fixtureRoot = resolve(import.meta.dirname, '..');
const options = { root: fixtureRoot, bunkers: false };
const usage = 'Usage: node tools/bench-move.mjs [--root DIR] [--bunkers]';
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--bunkers') options.bunkers = true;
  else if (key === '--root' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options.root = resolve(process.argv[++i]);
  else throw new Error(usage);
}

const fixtureMap = resolve(fixtureRoot, 'maps/six-fronts.json');
const map = JSON.parse(await readFile(fixtureMap, 'utf8'));
const sim = await import(pathToFileURL(resolve(options.root, 'shared/sim.js')).href);
const { rebuildGrid } = await import(pathToFileURL(resolve(options.root, 'shared/grid.js')).href);
const seed = 0x3c1055, trials = 32, warmup = 4;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let randomState = seed;
const originalRandom = Math.random;
Math.random = () => {
  let t = randomState += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

try {
  const g = sim.createGame(map, ['A', 'B'], false, [0, 1], [0, 1], { mode: 'conquest', army: 'massive' });
  const template = [...g.units.values()].find(u => u.type === 'rifle' && u.owner === 0);
  const open = [];
  for (let y = 10; y < 35; y++) for (let x = 10; x < 35; x++) {
    if (!(g.flags[y * g.w + x] & (sim.MOVE | sim.VBLOCK))) open.push({ x: (x + 0.5) * sim.CELL, z: (y + 0.5) * sim.CELL });
  }
  if (!template || open.length < 60) throw new Error('Fixture must provide a starting rifle and 60 open cells.');
  g.units = new Map(Array.from({ length: 60 }, (_, i) => {
    const u = structuredClone(template), type = i % 2 ? 'tank' : 'rifle';
    Object.assign(u, { id: i + 1, owner: 0, type, hp: sim.UNITS[type].models * sim.UNITS[type].hpPer,
      ...open[i], path: [], orders: [], targetId: 0, attackId: 0 });
    return [u.id, u];
  }));
  if (options.bunkers) for (let i = 0; i < 6; i++) {
    const u = structuredClone(template);
    Object.assign(u, { id: 61 + i, owner: 1, type: 'bunker', hp: sim.UNITS.bunker.hpPer,
      x: 151 + i * 8, z: 151 + i % 2 * 12, path: [], orders: [], targetId: 0, attackId: 0 });
    g.units.set(u.id, u);
  }
  g.nextId = g.units.size + 1;
  rebuildGrid(g);
  const ids = [...g.units.values()].filter(u => u.owner === 0).map(u => u.id);
  const commands = [
    { t: 'move', face: 0, orders: ids.map((id, i) => [id, 235 + i % 10 * 3, 215 + Math.floor(i / 10) * 3]) },
    { t: 'move', face: 0, orders: ids.map((id, i) => [id, 210 + i % 10 * 3, 240 + Math.floor(i / 10) * 3]) },
  ];
  const inputHash = hash({ map, units: [...g.units.values()].map(({ id, type, owner, x, z, hp }) => ({ id, type, owner, x, z, hp })), commands });
  const packets = [];
  for (let trial = 0; trial < trials; trial++) {
    const before = { ...g.pathStats }, start = process.hrtime.bigint();
    const result = sim.command(g, 0, commands[trial % commands.length]);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    packets.push({ trial, ms, result: result ?? 'accepted',
      routeHash: hash([...g.units.values()].map(u => [u.id, u.path])),
      calls: (g.pathStats?.calls ?? 0) - (before.calls ?? 0),
      expansions: (g.pathStats?.expansions ?? 0) - (before.expansions ?? 0),
      waypoints: [...g.units.values()].reduce((total, u) => total + u.path.length, 0) });
  }
  const warm = packets.slice(warmup).map(p => p.ms).toSorted((a, b) => a - b);
  const percentile = p => warm[Math.ceil(warm.length * p) - 1];
  const milliseconds = { p50: percentile(0.5), p95: percentile(0.95), max: warm.at(-1), mean: warm.reduce((a, b) => a + b, 0) / warm.length };
  const result = { root: options.root, fixtureMap, map: 'six-fronts', seed, units: g.units.size,
    rifles: 30, tanks: 30, bunkers: options.bunkers ? 6 : 0, trials, warmupExcluded: warmup,
    inputHash, milliseconds, packets, paths: g.pathStats };
  console.log(`60-unit move, ${result.bunkers} bunkers: warm p50/p95 ${milliseconds.p50.toFixed(3)}/${milliseconds.p95.toFixed(3)} ms, mean ${milliseconds.mean.toFixed(3)} ms`);
  console.log('RESULT ' + JSON.stringify(result));
} finally {
  Math.random = originalRandom;
}
