// Reproducible faction FFA matches or rotated difficulty duels, using the server's AI schedule.
import { readFile } from 'node:fs/promises';
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const script = fileURLToPath(import.meta.url);
const usage = 'Usage: node tools/ai-balance.mjs [--root DIR] [--map NAME] [--mode conquest|classic] [--matches N] [--seed S] [--workers N] [--seats easy,normal|hard,normal|normal,alt:normal] [--ai FILE] [--alt FILE] [--checkpoint FILE] [--resume FILE] [--rotate] [--army standard|large|massive|endless] [--factions 3|4]';
const factions = ['USA', 'Germany', 'USSR', 'UK'];

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
  const current = await import(pathToFileURL(options.ai ?? resolve(options.root, 'shared/ai.js')).href);
  const alternate = options.alt ? await import(pathToFileURL(resolve(options.alt)).href) : null;
  const map = JSON.parse(await readFile(resolve(options.root, `maps/${options.map}.json`), 'utf8'));
  // without --seats: one Normal AI per spawn the mode can use, every one for itself, factions cycling
  const ffa = sim.spawnsFor(map, options.mode).map(() => 'normal');
  // Classic Sudden Death begins at 25 minutes. A twenty-minute runner cap cannot measure its normal ending.
  const maxSeconds = options.mode === 'classic' ? 2400 : options.seats ? 1800 : 1200;
  const maxTicks = Math.round(maxSeconds / sim.TICK), originalRandom = Math.random;
  try {
    for (const index of indices) {
      // Each match has its own stream, so worker count and completion order do not affect results.
      const seed = options.seats ? (options.seed * 100003 + index * 7919) >>> 0 : (options.seed + index) >>> 0;
      Math.random = seededRandom(seed);
      const seats = options.seats ?? ffa;
      const order = options.rotate && index % 2 ? [1, 0] : seats.map((_, i) => i);
      const pair = [index % 3, Math.floor(index / 3) % 3];
      // --factions 4 brings in the UK: each match fields a different run of the four, so each sits out one match in four
      const factionIds = options.rotate ? order.map(i => pair[i]) : order.map((_, i) => options.factions === 4 ? (i + index) % 4 : i % 3);
      const brains = order.map(i => ({ level: seats[i].replace(/^alt:/, ''), mod: seats[i].startsWith('alt:') ? alternate : current }));
      const g = sim.createGame(map, order.map(i => 'AI ' + seats[i]), true, order.map((_, i) => i), factionIds, { mode: options.mode, army: options.army });
      const spawns = g.players.map(p => map.spawns.findIndex(s => (s.x + 0.5) * sim.CELL === p.spawn.x && (s.y + 0.5) * sim.CELL === p.spawn.z));
      const initialCache = sim.snapshotCache(g);
      const views = brains.map((b, slot) => b.mod.observe?.(g, slot, initialCache));
      for (let tick = 0; tick < maxTicks && g.winner === null; tick++) {
        sim.step(g);
        // All commanders consume the latest view on the same two-tick delivery beat as humans.
        if (g.tick % 2 === 0 || g.winner !== null) {
          const cache = sim.snapshotCache?.(g);
          brains.forEach((b, slot) => { views[slot] = b.mod.observe?.(g, slot, cache); });
        }
        brains.forEach((b, slot) => { if (b.mod.humanCommander || (g.tick + slot * 13) % (b.mod.thinkEvery?.(b.level) ?? 40) === 0) b.mod.think(g, slot, { level: b.level, view: views[slot] }); });
        // The all-AI server has no WebSocket recipients, but clears these transient lists on its snapshot beat.
        if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
      }
      const winnerSlot = g.players.findIndex(p => p.team === g.winner);
      const vp = g.players.map(p => p.vp);
      const runnerUpVp = winnerSlot >= 0 ? Math.max(...vp.filter((_, slot) => slot !== winnerSlot)) : null;
      const result = {
        match: index + 1, seed, ticks: g.tick, seconds: round(g.tick * sim.TICK),
        winner: g.winner, winnerSeat: winnerSlot >= 0 ? order[winnerSlot] : null, winnerFaction: winnerSlot >= 0 ? factions[g.players[winnerSlot].faction] : null,
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
  const options = { root: resolve(dirname(script), '..'), map: 'default', mode: 'conquest', matches: null, seed: 1, workers: Math.min(2, availableParallelism()), seats: null, ai: null, alt: null, checkpoint: null, resume: null, rotate: false };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--rotate') { options.rotate = true; continue; }
    if (!['--root', '--map', '--mode', '--matches', '--seed', '--workers', '--seats', '--alt', '--ai', '--checkpoint', '--resume', '--army', '--factions'].includes(key) || i + 1 >= process.argv.length) throw new Error(usage);
    options[key.slice(2)] = process.argv[++i];
  }
  options.root = resolve(options.root);
  for (const name of ['ai', 'alt', 'checkpoint', 'resume']) if (options[name]) options[name] = resolve(options[name]);
  options.checkpoint ??= options.resume;
  if (options.checkpoint && options.checkpoint !== options.resume && existsSync(options.checkpoint)) throw new Error('Checkpoint already exists; use --resume to keep its completed matches');
  if (options.seats) {
    options.seats = options.seats.split(',');
    if (options.seats.length !== 2 || options.seats.some(s => !/^(alt:)?(easy|normal|hard)$/.test(s))) throw new Error('--seats requires two valid difficulties');
    if (options.seats.some(s => s.startsWith('alt:')) && !options.alt) throw new Error('alternate seat needs --alt');
  }
  if (options.rotate && !options.seats) throw new Error('--rotate requires --seats');
  if (!['conquest', 'classic'].includes(options.mode)) throw new Error('--mode must be conquest or classic');
  options.army ??= 'standard';
  options.factions = Number(options.factions ?? 3);
  if (![3, 4].includes(options.factions)) throw new Error('--factions must be 3 or 4');
  if (!['standard', 'large', 'massive', 'endless'].includes(options.army)) throw new Error('--army must be standard, large, massive or endless');
  options.matches = Number(options.matches ?? (options.mode === 'classic' ? 30 : 60));
  options.seed = Number(options.seed);
  options.workers = Number(options.workers);
  for (const name of ['matches', 'workers']) if (!Number.isSafeInteger(options[name]) || options[name] < 1) throw new Error(`--${name} must be a positive integer`);
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('--seed must be a uint32 integer');
  options.workers = Math.min(options.workers, options.matches);
  const configuration = Object.fromEntries(['root', 'map', 'mode', 'matches', 'seed', 'seats', 'ai', 'alt', 'rotate', 'army', 'factions'].map(key => [key, options[key]]));
  const sourceSHA256 = {};
  async function fingerprint(file) {
    if (Object.hasOwn(sourceSHA256, file)) return;
    const source = await readFile(file, 'utf8');
    sourceSHA256[file] = createHash('sha256').update(source).digest('hex');
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) return;
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) await fingerprint(resolve(dirname(file), match[1]));
    }
  }
  for (const file of [script, resolve(options.root, 'shared/sim.js'), options.ai ?? resolve(options.root, 'shared/ai.js'),
    ...(options.alt ? [options.alt] : []), resolve(options.root, `maps/${options.map}.json`)]) await fingerprint(file);
  const provenance = Object.fromEntries(Object.entries(sourceSHA256).sort(([a], [b]) => a.localeCompare(b)));
  const started = performance.now(), results = [], workers = [];
  if (options.resume) {
    const saved = JSON.parse(await readFile(options.resume, 'utf8'));
    if (saved.version !== 1 || JSON.stringify(saved.configuration) !== JSON.stringify(configuration)) throw new Error('Resume configuration does not match this run');
    if (JSON.stringify(saved.sourceSHA256) !== JSON.stringify(provenance)) throw new Error('Resume source hashes do not match this run');
    if (!Array.isArray(saved.results)) throw new Error('Resume checkpoint has no results array');
    const seen = new Set();
    for (const result of saved.results) {
      const index = result.match - 1;
      const expectedSeed = options.seats ? (options.seed * 100003 + index * 7919) >>> 0 : (options.seed + index) >>> 0;
      if (!Number.isSafeInteger(index) || index < 0 || index >= options.matches || seen.has(index) || result.seed !== expectedSeed
        || !Array.isArray(result.spawns) || !Array.isArray(result.vp) || !Number.isFinite(result.ticks)) throw new Error('Resume checkpoint has invalid or duplicate match results');
      seen.add(index); results.push(result);
    }
    process.stderr.write(`Resuming ${results.length}/${options.matches} completed matches\n`);
  }
  function checkpoint() {
    if (!options.checkpoint) return;
    const temporary = `${options.checkpoint}.${process.pid}.tmp`;
    const fd = openSync(temporary, 'w');
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, configuration, sourceSHA256: provenance,
        results: [...results].sort((a, b) => a.match - b.match) }, null, 2) + '\n');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temporary, options.checkpoint);
    const directory = openSync(dirname(options.checkpoint), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  checkpoint();
  const completed = new Set(results.map(result => result.match - 1));
  const pending = Array.from({ length: options.matches }, (_, index) => index).filter(index => !completed.has(index));
  try {
    await Promise.all(Array.from({ length: options.workers }, (_, worker) => new Promise((resolveWorker, rejectWorker) => {
      const indices = pending.filter(index => index % options.workers === worker);
      if (!indices.length) { resolveWorker(); return; }
      const thread = new Worker(script, { workerData: { options, indices } });
      workers.push(thread);
      thread.on('message', result => {
        results.push(result);
        try { checkpoint(); } catch (error) { rejectWorker(error); return; }
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
  const byFaction = Object.fromEntries(factions.slice(0, options.factions).map(faction => [faction, wins.filter(r => r.winnerFaction === faction).length]));
  const bySpawn = map.spawns.map((spawn, index) => ({ spawn: index, x: spawn.x, y: spawn.y, wins: wins.filter(r => r.winnerSpawn === index).length }));
  const ratios = results.map(r => r.runnerUpVpRatio).filter(r => r !== null);
  const result = {
    sourceSHA256: provenance, ai: options.ai, checkpoint: options.checkpoint, resumedMatches: completed.size,
    root: options.root, mode: options.mode, map: options.map, players: results[0].spawns.length, seats: options.seats, rotate: options.rotate, alt: options.alt, winsBySeat: options.seats?.map((_, i) => wins.filter(r => r.winnerSeat === i).length) ?? null, army: options.army, seed: options.seed,
    matches: options.matches, workers: options.workers, maxSeconds: options.mode === 'classic' ? 2400 : options.seats ? 1800 : 1200,
    winsByFaction: byFaction, winsBySpawn: bySpawn,
    ended: ended.length, draws: ended.length - wins.length, timeouts: options.matches - ended.length,
    medianSeconds: median(results.map(r => r.seconds)), medianEndedSeconds: median(ended.map(r => r.seconds)),
    runnerUpVpOverWinnerVp: options.mode === 'conquest' ? { mean: ratios.length ? round(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null, median: median(ratios), matches: ratios.length } : null,
    elapsedSeconds: round((performance.now() - started) / 1000), results,
  };
  console.log(`${result.mode}: ${result.matches} matches, seed ${result.seed}, ${result.ended} ended, ${result.draws} draws, ${result.timeouts} timeouts`);
  if (result.winsBySeat) console.log(`  seat wins: ${options.seats.map((s, i) => `${s} ${result.winsBySeat[i]}`).join(', ')}`);
  console.log(`  faction wins: ${factions.slice(0, options.factions).map(faction => `${faction} ${byFaction[faction]}`).join(', ')}`);
  console.log(`  spawn wins: ${bySpawn.map(spawn => `${spawn.spawn} (${spawn.x},${spawn.y}) ${spawn.wins}`).join(', ')}`);
  console.log(`  median length including ${result.maxSeconds}s timeouts: ${result.medianSeconds}s (${result.medianEndedSeconds ?? 'none'}s among ended matches)`);
  if (result.runnerUpVpOverWinnerVp) console.log(`  runner-up VP / winner VP: mean ${result.runnerUpVpOverWinnerVp.mean}, median ${result.runnerUpVpOverWinnerVp.median}`);
  console.log('RESULT ' + JSON.stringify(result));
}
