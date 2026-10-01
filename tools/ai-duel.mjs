// AI-vs-AI matches for measuring the AI and its difficulty levels, spread over worker threads.
//
//   node tools/ai-duel.mjs --mode conquest|classic --map default --n 60 --seats normal,normal,normal
//   node tools/ai-duel.mjs --mode classic --n 40 --seats hard,normal --rotate
//   node tools/ai-duel.mjs --n 60 --seats alt:normal,alt:normal,alt:normal --alt /tmp/ai-old.js
//
// --seats   one AI per seat, each its own team: a level (easy, normal, hard), "alt:" plays the --alt module instead,
//           and "+key=value" overrides one of the level's settings for that seat (hard+focus=false, normal+every=20)
// --rotate  1v1: swap the two seats every other match and cycle all 9 faction pairs (else factions go by slot)
// --seed    matches are seeded (seed, match number), so two runs play the same openings until the AIs differ
// --json    write one line per match to this file
// The tick loop matches the server: step, then each AI thinks on its own level's beat, staggered by slot.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function seeded(initial) {
  let value = initial >>> 0;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

if (isMainThread) {
  const o = { mode: 'conquest', map: 'default', n: 40, seats: 'normal,normal,normal', alt: '', rotate: false, workers: Math.max(1, Math.min(8, availableParallelism() - 2)), seed: 1, json: '', root: ROOT };
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, '');
    if (!(k in o)) throw new Error('unknown option ' + process.argv[i]);
    if (k === 'rotate') o.rotate = true;
    else o[k] = process.argv[++i];
  }
  o.n = +o.n; o.workers = +o.workers; o.seed = +o.seed;
  const seats = o.seats.split(',');
  if (o.rotate && seats.length !== 2) throw new Error('--rotate is for two seats');
  const map = JSON.parse(await readFile(resolve(o.root, 'maps', o.map + '.json'), 'utf8'));
  const results = [], began = Date.now();
  await Promise.all(Array.from({ length: Math.min(o.workers, o.n) }, (_, w) => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { ...o, map, seats, w } });
    worker.on('message', (r) => {
      results.push(r);
      process.stderr.write(`\r${results.length}/${o.n} matches, ${Math.round((Date.now() - began) / 1000)}s   `);
    });
    worker.on('error', fail);
    worker.on('exit', done);
  })));
  process.stderr.write('\n');
  results.sort((a, b) => a.i - b.i);
  if (o.json) await writeFile(o.json, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  const n = results.length, pct = (x) => Math.round(100 * x / n);
  const median = (xs) => { const s = xs.toSorted((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const wins = seats.map((_, s) => results.filter(r => r.winnerSeat === s).length), draws = results.filter(r => r.winnerSeat < 0).length;
  const factions = [0, 1, 2].map(f => results.filter(r => r.winnerFaction === f).length);
  console.log(`${o.mode} on ${o.map}, ${n} matches, seats ${seats.join(' / ')}${o.alt ? ' (alt = ' + o.alt + ')' : ''}${o.rotate ? ', rotated' : ''}`);
  console.log(`wins by seat: ${seats.map((s, i) => `${s} ${wins[i]} (${pct(wins[i])}%)`).join(', ')}, draws ${draws}, unfinished ${results.filter(r => r.unfinished).length}`);
  console.log(`faction wins USA/GER/USSR: ${factions.join('/')}`);
  console.log(`length: mean ${mean(results.map(r => r.min)).toFixed(1)} min, median ${median(results.map(r => r.min)).toFixed(1)} min`);
  if (o.mode === 'conquest') console.log(`closeness (2nd place VP / winner): ${mean(results.map(r => r.closeness)).toFixed(2)}, lead changes ${mean(results.map(r => r.leadChanges)).toFixed(2)}`);
  if (o.mode === 'classic') console.log(`decided before Sudden Death: ${results.filter(r => !r.suddenDeath && r.winnerSeat >= 0).length}/${n} (${pct(results.filter(r => !r.suddenDeath && r.winnerSeat >= 0).length)}%)`);
  const per = (key) => seats.map((s, i) => `${s} ${mean(results.map(r => r.story[i][key])).toFixed(1)}`).join(', ');
  console.log(`per seat, mean: kills ${per('kills')} | losses ${per('losses')} | supports ${per('supportCalls')}`);
  console.log(`time ${Math.round((Date.now() - began) / 1000)}s`);
} else {
  const { mode, map, seats, alt, rotate, workers, w, n, seed, root } = workerData;
  const sim = await import(pathToFileURL(resolve(root, 'shared/sim.js')).href);
  const ai = await import(pathToFileURL(resolve(root, 'shared/ai.js')).href);
  const old = alt ? await import(pathToFileURL(resolve(alt)).href) : null;
  const cap = 20 * 60 * (mode === 'classic' ? 40 : 30);
  for (let i = w; i < n; i += workers) {
    Math.random = seeded(seed * 100003 + i * 7919);
    const swap = rotate && i % 2 === 1;
    const order = swap ? [1, 0] : seats.map((_, s) => s); // order[slot] = seat
    const factions = rotate ? (() => { const f = [i % 3, Math.floor(i / 3) % 3]; return swap ? [f[1], f[0]] : f; })() : order.map((_, s) => s % 3);
    const brains = order.map(s => {
      // a seat is "level", "alt:level", or either with "+key=value" tweaks that override that level's settings
      const [head, ...mods] = seats[s].split('+'), useAlt = head.startsWith('alt:'), level = head.replace(/^alt:/, ''), mod = useAlt ? old : ai;
      const tweak = Object.fromEntries(mods.map(m => m.split('=')).map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v]));
      const every = tweak.every ?? (mod.thinkEvery ? mod.thinkEvery(level) : 40);
      return { mod, level, every, tweak };
    });
    const names = order.map(s => 'AI ' + seats[s]);
    const g = sim.createGame(map, names, true, names.map((_, s) => s), factions, mode === 'classic' ? { mode: 'classic' } : {});
    while (g.winner === null && g.tick < cap) {
      sim.step(g);
      brains.forEach((b, s) => { if ((g.tick + s * 13) % b.every === 0) b.mod.think(g, s, { level: b.level, tweak: b.tweak }); });
      g.shots = []; g.newCells = [];
    }
    const team = g.winner ?? -1, slot = team >= 0 ? g.players.findIndex(p => p.team === team) : -1;
    // Conquest: who led at each 10s sample (a strict lead only), and how often that changed
    let leadChanges = 0, leader = -1;
    for (const s of g.timeline ?? []) {
      if (!s.vp) continue;
      const top = Math.max(...s.vp), at = s.vp.indexOf(top);
      if (top <= 0 || s.vp.filter(v => v === top).length > 1) continue;
      if (leader >= 0 && at !== leader) leadChanges++;
      leader = at;
    }
    const vp = g.players.map(p => p.vp).sort((a, b) => b - a);
    const story = order.map((_, s) => g.story?.[order.indexOf(s)] ?? {}); // indexed by seat
    parentPort.postMessage({
      i, winnerSeat: slot >= 0 ? order[slot] : -1, winnerFaction: slot >= 0 ? g.players[slot].faction : -1, reason: g.endReason ?? null,
      unfinished: g.winner === null, min: g.tick / 20 / 60, closeness: vp[1] / Math.max(1, vp[0]), leadChanges,
      suddenDeath: !!g.mode?.suddenDeath, factions: order.map((_, s) => g.players[order.indexOf(s)].faction), story,
    });
  }
}
