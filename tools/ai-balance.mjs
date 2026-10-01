// Reproducible three-faction FFA matches, using the server's AI schedule.
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const script = fileURLToPath(import.meta.url);
const usage = 'Usage: node tools/ai-balance.mjs [--root DIR] [--map NAME] [--mode conquest|classic] [--matches N] [--seed S] [--workers N]';
const factions = ['USA', 'Germany', 'USSR'];

function seededRandom(initial) {
  let value = initial >>> 0;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const round = value => Math.round(value * 1000) / 1000;
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

async function runMatches(options, indices) {
  const sim = await import(pathToFileURL(resolve(options.root, 'shared/sim.js')).href);
  const { think, observe } = await import(pathToFileURL(resolve(options.root, 'shared/ai.js')).href);
  const map = JSON.parse(await readFile(resolve(options.root, `maps/${options.map}.json`), 'utf8'));
  // one AI per spawn the mode can use, every one for itself, factions cycling
  const seats = sim.spawnsFor(map, options.mode).map((_, i) => i);
  const maxTicks = Math.round(20 * 60 / sim.TICK), originalRandom = Math.random;
  try {
    for (const index of indices) {
      // Each match has its own stream, so worker count and completion order do not affect results.
      const seed = (options.seed + index) >>> 0;
      Math.random = seededRandom(seed);
      const g = sim.createGame(map, seats.map(i => factions[i % 3]), true, seats, seats.map(i => i % 3), { mode: options.mode, army: 'standard' });
      const spawns = g.players.map(p => map.spawns.findIndex(s => (s.x + 0.5) * sim.CELL === p.spawn.x && (s.y + 0.5) * sim.CELL === p.spawn.z));
      const initialCache = observe ? sim.snapshotCache?.(g) : undefined;
      const views = observe ? g.players.map((_, slot) => observe(g, slot, initialCache)) : null;
      for (let tick = 0; tick < maxTicks && g.winner === null; tick++) {
        sim.step(g);
        // New AIs consume the latest view on the same two-tick delivery beat as humans.
        if (observe && (g.tick % 2 === 0 || g.winner !== null)) {
          const cache = sim.snapshotCache?.(g);
          g.players.forEach((_, slot) => { views[slot] = observe(g, slot, cache); });
        }
        g.players.forEach((p, slot) => { if ((g.tick + slot * 13) % 40 === 0) think(g, slot, views ? { view: views[slot] } : undefined); });
        // The all-AI server has no WebSocket recipients, but clears these transient lists on its snapshot beat.
        if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
      }
      const winnerSlot = g.players.findIndex(p => p.team === g.winner);
      const vp = g.players.map(p => p.vp);
      const runnerUpVp = winnerSlot >= 0 ? Math.max(...vp.filter((_, slot) => slot !== winnerSlot)) : null;
      const result = {
        match: index + 1, seed, ticks: g.tick, seconds: round(g.tick * sim.TICK),
        winner: g.winner, winnerFaction: winnerSlot >= 0 ? factions[g.players[winnerSlot].faction] : null,
        winnerSpawn: winnerSlot >= 0 ? spawns[winnerSlot] : null, spawns,
        endReason: g.endReason ?? null, vp: vp.map(round),
        runnerUpVpRatio: options.mode === 'conquest' && winnerSlot >= 0 && vp[winnerSlot] > 0 ? runnerUpVp / vp[winnerSlot] : null,
      };
      parentPort.postMessage(result);
    }
  } finally {
    Math.random = originalRandom;
  }
}

if (!isMainThread) {
  await runMatches(workerData.options, workerData.indices);
} else {
  const options = { root: resolve(dirname(script), '..'), map: 'default', mode: 'conquest', matches: null, seed: 1, workers: Math.min(3, availableParallelism()) };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!['--root', '--map', '--mode', '--matches', '--seed', '--workers'].includes(key) || i + 1 >= process.argv.length) throw new Error(usage);
    options[key.slice(2)] = process.argv[++i];
  }
  options.root = resolve(options.root);
  if (!['conquest', 'classic'].includes(options.mode)) throw new Error('--mode must be conquest or classic');
  options.matches = Number(options.matches ?? (options.mode === 'classic' ? 30 : 60));
  options.seed = Number(options.seed);
  options.workers = Number(options.workers);
  for (const name of ['matches', 'workers']) if (!Number.isSafeInteger(options[name]) || options[name] < 1) throw new Error(`--${name} must be a positive integer`);
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('--seed must be a uint32 integer');
  options.workers = Math.min(options.workers, options.matches);
  const started = performance.now(), results = [], workers = [];
  try {
    await Promise.all(Array.from({ length: options.workers }, (_, worker) => new Promise((resolveWorker, rejectWorker) => {
      const indices = Array.from({ length: options.matches }, (_, index) => index).filter(index => index % options.workers === worker);
      const thread = new Worker(script, { workerData: { options, indices } });
      workers.push(thread);
      thread.on('message', result => {
        results.push(result);
        if (results.length % 5 === 0 || results.length === options.matches) process.stderr.write(`${options.mode}: ${results.length}/${options.matches} matches complete\n`);
      });
      thread.on('error', rejectWorker);
      thread.on('exit', code => code === 0 ? resolveWorker() : rejectWorker(new Error(`Worker exited with code ${code}`)));
    })));
  } catch (error) {
    await Promise.all(workers.map(worker => worker.terminate()));
    throw error;
  }
  results.sort((a, b) => a.match - b.match);
  const map = JSON.parse(await readFile(resolve(options.root, `maps/${options.map}.json`), 'utf8'));
  const ended = results.filter(r => r.winner !== null), wins = ended.filter(r => r.winner >= 0);
  const byFaction = Object.fromEntries(factions.map(faction => [faction, wins.filter(r => r.winnerFaction === faction).length]));
  const bySpawn = map.spawns.map((spawn, index) => ({ spawn: index, x: spawn.x, y: spawn.y, wins: wins.filter(r => r.winnerSpawn === index).length }));
  const ratios = results.map(r => r.runnerUpVpRatio).filter(r => r !== null);
  const result = {
    root: options.root, mode: options.mode, map: options.map, players: results[0].spawns.length, army: 'standard', seed: options.seed,
    matches: options.matches, workers: options.workers, maxSeconds: 1200,
    winsByFaction: byFaction, winsBySpawn: bySpawn,
    ended: ended.length, draws: ended.length - wins.length, timeouts: options.matches - ended.length,
    medianSeconds: median(results.map(r => r.seconds)), medianEndedSeconds: median(ended.map(r => r.seconds)),
    runnerUpVpOverWinnerVp: options.mode === 'conquest' ? { mean: ratios.length ? round(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null, median: median(ratios), matches: ratios.length } : null,
    elapsedSeconds: round((performance.now() - started) / 1000), results,
  };
  console.log(`${result.mode}: ${result.matches} matches, seed ${result.seed}, ${result.ended} ended, ${result.draws} draws, ${result.timeouts} timeouts`);
  console.log(`  faction wins: ${factions.map(faction => `${faction} ${byFaction[faction]}`).join(', ')}`);
  console.log(`  spawn wins: ${bySpawn.map(spawn => `${spawn.spawn} (${spawn.x},${spawn.y}) ${spawn.wins}`).join(', ')}`);
  console.log(`  median length including ${result.maxSeconds}s timeouts: ${result.medianSeconds}s (${result.medianEndedSeconds ?? 'none'}s among ended matches)`);
  if (result.runnerUpVpOverWinnerVp) console.log(`  runner-up VP / winner VP: mean ${result.runnerUpVpOverWinnerVp.mean}, median ${result.runnerUpVpOverWinnerVp.median}`);
  console.log('RESULT ' + JSON.stringify(result));
}
