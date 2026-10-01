// Headless AI-vs-AI matches (3-player free-for-all, adaptive AIs) for balance and unit behavior numbers.
// node tools/balance.mjs [--root DIR] [--mode conquest|classic] [--map default] [--n 60] [--seed 1] [--workers 8] [--json FILE]
// --root points at another checkout (for example a copy of the last release) to measure before and after with
// the same seeds. Each match seeds Math.random, so a run is repeatable on the same code.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const here = fileURLToPath(import.meta.url);

function seededRandom(initial) {
  let value = initial;
  return () => {
    let t = value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function playMatches({ root, mode, map: mapName, seeds }) {
  const sim = await import(pathToFileURL(resolve(root, 'shared/sim.js')).href);
  const { think, observe } = await import(pathToFileURL(resolve(root, 'shared/ai.js')).href);
  const { UNITS, CELL, COVER, TRENCH } = sim;
  // Use the current graded cover rule, including woods, house corners and wrecks.
  const sheltered = (g, t, f) => {
    const c = Math.floor(t.z / CELL) * g.w + Math.floor(t.x / CELL);
    return !!(g.flags[c] & (COVER | TRENCH)) || sim.coverBehind(g, t, f) > 0.4;
  };
  const map = JSON.parse(readFileSync(resolve(root, 'maps', mapName + '.json'), 'utf8'));
  const capTicks = (mode === 'classic' ? 60 : 40) * 60 * 20;
  for (const seed of seeds) {
    const savedRandom = Math.random;
    Math.random = seededRandom(seed);
    try {
      const names = ['AI 1', 'AI 2', 'AI 3'];
      const g = sim.createGame(map, names, true, [0, 1, 2], [0, 1, 2], { mode });
      const initialCache = observe ? sim.snapshotCache?.(g) : undefined;
      const views = observe ? g.players.map((_, slot) => observe(g, slot, initialCache)) : null;
      const vehicle = t => t && !UNITS[t.type].infantry && !UNITS[t.type].structure && !t.air;
      // Behavior counters, read from the shots each tick reports (the same feed the clients get).
      const m = { vehHits: 0, rearHits: 0, frontHits: 0, infHits: 0, infHitsCovered: 0, infHitsSheltered: 0, atShots: 0, atOnVehicles: 0,
        mgShots: 0, mgOnInfantry: 0, sniperShots: 0, sniperOnCrews: 0, infantrySamples: 0, coveredSamples: 0, idleSamples: 0, crowded: 0, kills: 0 };
      let leader = -1, leadChanges = 0;
      while (g.winner === null && g.tick < capTicks) {
        sim.step(g);
        if (observe && (g.tick % 2 === 0 || g.winner !== null)) {
          const cache = sim.snapshotCache?.(g);
          g.players.forEach((_, slot) => { views[slot] = observe(g, slot, cache); });
        }
        g.players.forEach((p, i) => { if ((g.tick + i * 13) % 40 === 0) think(g, i, views ? { view: views[i] } : undefined); });
        for (const s of g.shots) {
          if (s.kill) m.kills++;
          if (!s.f || !s.t || s.k === 'hurt' || s.k === 'aa') continue;
          const f = g.units.get(s.f), t = g.units.get(s.t);
          if (!f || !t) continue;
          if (f.type === 'at') { m.atShots++; if (vehicle(t)) m.atOnVehicles++; }
          if (f.type === 'mg') { m.mgShots++; if (UNITS[t.type].infantry) m.mgOnInfantry++; }
          if (f.type === 'sniper') { m.sniperShots++; if (['mg', 'at', 'mortar'].includes(t.type)) m.sniperOnCrews++; }
          if (!s.hit) continue;
          if (vehicle(t)) {
            const c = Math.cos(Math.atan2(f.z - t.z, f.x - t.x) - t.rot);
            m.vehHits++; if (c < -0.5) m.rearHits++; else if (c > 0.5) m.frontHits++;
          } else if (UNITS[t.type].infantry && !(t.garrison >= 0)) {
            const c = Math.floor(t.z / CELL) * g.w + Math.floor(t.x / CELL);
            m.infHits++; if (g.flags[c] & (COVER | TRENCH)) m.infHitsCovered++; if (sheltered(g, t, f)) m.infHitsSheltered++;
          }
        }
        g.shots = []; g.newCells = [];
        if (g.tick % 100 === 0) {
          const inf = [...g.units.values()].filter(u => UNITS[u.type].infantry && !(u.garrison >= 0) && !u.riding && u.hp > 0);
          for (const u of inf) {
            m.infantrySamples++;
            if (g.flags[Math.floor(u.z / CELL) * g.w + Math.floor(u.x / CELL)] & (COVER | TRENCH)) m.coveredSamples++;
            if (u.path?.length) continue;
            m.idleSamples++;
            if (inf.some(v => v !== u && v.owner === u.owner && Math.hypot(v.x - u.x, v.z - u.z) < 3)) m.crowded++;
          }
        }
        // A lead change: someone else is ahead of everyone by 20 VP or more (so near-ties don't count).
        if (mode === 'conquest' && g.tick % 20 === 0) {
          const vp = g.players.map(p => p.vp), top = Math.max(...vp), lead = vp.indexOf(top);
          if (lead !== leader && vp.every((v, i) => i === lead || top - v >= 20)) { if (leader >= 0) leadChanges++; leader = lead; }
        }
      }
      const vp = g.players.map(p => p.vp).sort((a, b) => b - a);
      parentPort.postMessage({
        seed, ticks: g.tick, winner: g.winner, reason: g.endReason ?? null,
        winnerFaction: g.winner >= 0 ? g.players.find(p => p.team === g.winner)?.faction : null,
        suddenDeath: !!g.mode?.suddenDeath, closeness: vp[0] > 0 ? vp[1] / vp[0] : 0, leadChanges, m,
      });
    } finally { Math.random = savedRandom; }
  }
}

if (!isMainThread) {
  await playMatches(workerData);
} else {
  const options = { root: resolve(dirname(here), '..'), mode: 'conquest', map: 'default', n: 60, seed: 1, workers: Math.max(1, Math.min(2, availableParallelism() - 2)), json: null };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!['--root', '--mode', '--map', '--n', '--seed', '--workers', '--json'].includes(key) || i + 1 >= process.argv.length) {
      throw new Error('Usage: node tools/balance.mjs [--root DIR] [--mode conquest|classic] [--map NAME] [--n N] [--seed S] [--workers W] [--json FILE]');
    }
    options[key.slice(2)] = process.argv[++i];
  }
  options.root = resolve(options.root);
  for (const k of ['n', 'seed', 'workers']) options[k] = Number(options[k]);
  if (!['conquest', 'classic'].includes(options.mode)) throw new Error('--mode must be conquest or classic');
  for (const k of ['n', 'workers']) if (!Number.isSafeInteger(options[k]) || options[k] < 1) throw new Error(`--${k} must be a positive integer`);
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) throw new Error('--seed must be a nonnegative integer');
  const seeds = Array.from({ length: options.n }, (_, i) => options.seed * 100003 + i);
  const shares = Array.from({ length: Math.min(options.workers, seeds.length) }, (_, w) => seeds.filter((_, i) => i % options.workers === w));
  const started = Date.now(), results = [];
  await Promise.all(shares.map(share => new Promise((done, fail) => {
    const worker = new Worker(here, { workerData: { root: options.root, mode: options.mode, map: options.map, seeds: share } });
    worker.on('message', r => { results.push(r); process.stderr.write(`\r${results.length}/${seeds.length} matches`); });
    worker.on('error', fail);
    worker.on('exit', code => (code ? fail(new Error('worker exit ' + code)) : done()));
  })));
  process.stderr.write('\n');
  results.sort((a, b) => a.seed - b.seed);
  const mins = r => r.ticks / 20 / 60, mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const median = xs => { const s = xs.toSorted((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0; };
  const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 0), round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  const factions = [0, 1, 2].map(f => results.filter(r => r.winnerFaction === f).length);
  const sum = k => results.reduce((a, r) => a + r.m[k], 0);
  const summary = {
    root: options.root, mode: options.mode, map: options.map, matches: results.length, wallSeconds: Math.round((Date.now() - started) / 1000),
    factionWins: { USA: factions[0], GER: factions[1], USSR: factions[2], none: results.filter(r => r.winnerFaction === null).length },
    lengthMeanMin: round(mean(results.map(mins))), lengthMedianMin: round(median(results.map(mins))),
    ...(options.mode === 'conquest' ? {
      closeness: round(mean(results.map(r => r.closeness))), leadChanges: round(mean(results.map(r => r.leadChanges))),
      undecided: results.filter(r => r.winner === null).length,
    } : {
      decided: results.filter(r => r.winner !== null).length, beforeSuddenDeath: results.filter(r => r.winner !== null && !r.suddenDeath).length,
      draws: results.filter(r => r.winner === -1).length,
    }),
    behavior: {
      rearHitsPct: pct(sum('rearHits'), sum('vehHits')), frontHitsPct: pct(sum('frontHits'), sum('vehHits')), vehicleHits: sum('vehHits'),
      infantryHitsInCoverPct: pct(sum('infHitsCovered'), sum('infHits')), infantryHitsShelteredPct: pct(sum('infHitsSheltered'), sum('infHits')), infantryHits: sum('infHits'),
      infantryTimeInCoverPct: pct(sum('coveredSamples'), sum('infantrySamples')), infantryTimeSamples: sum('infantrySamples'),
      atShotsOnVehiclesPct: pct(sum('atOnVehicles'), sum('atShots')), mgShotsOnInfantryPct: pct(sum('mgOnInfantry'), sum('mgShots')),
      sniperShotsOnCrewsPct: pct(sum('sniperOnCrews'), sum('sniperShots')), idleSquadsCrowdedPct: pct(sum('crowded'), sum('idleSamples')),
      killsPerMatch: round(sum('kills') / (results.length || 1), 1),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (options.json) writeFileSync(options.json, JSON.stringify({ summary, results }, null, 2));
}
