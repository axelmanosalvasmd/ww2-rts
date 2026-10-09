// World Conquest pacing: seeded all-AI matches on the server's AI schedule, sampled every game minute. Reports how long a
// match runs and how it ends, when sides reach each HQ tier, how land grows, and how much the transport is used.
// node tools/world-pacing.mjs [--matches 6] [--players 2] [--minutes 75] [--size huge] [--level normal] [--seed 1]
//   [--workers 4] [--json FILE]
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const TPS = 20, script = fileURLToPath(import.meta.url);

async function play({ seed, players, minutes, size, level }) {
  const { playMatch } = await import('../shared/ai-schedule.js');
  const { generateWorldMap } = await import('../shared/world-conquest.js');
  const slots = Array.from({ length: players }, (_, i) => i);
  const map = generateWorldMap({ size, seed, players, teams: slots });
  const out = { seed, players, samples: [], tiers: slots.map(() => ({})), trains: 0, firstCapture: null, lorries: 0, riding: 0 };
  const trains = new Set(), lorries = new Set();
  const g = playMatch({ map, names: slots.map(i => `AI ${i + 1}`), teams: slots, factions: slots.map(i => i % 3), shuffle: false, seed,
    seats: slots.map(slot => ({ slot, level })), options: { mode: 'world', worldSize: size, tech: true, logistics: true }, maxTicks: minutes * 60 * TPS,
    onTick: (g) => {
      for (const p of g.players) for (const t of [2, 3]) if (p.tier >= t && out.tiers[p.slot][t] === undefined) out.tiers[p.slot][t] = g.tick / TPS / 60;
      if (g.tick % TPS) return;
      for (const u of g.units.values()) { if (u.type === 'train') trains.add(u.id); if (u.type === 'lorry' && u.owner >= 0) lorries.add(u.id); }
      if (out.firstCapture === null && g.world.regions.some(r => r.home === undefined && r.team >= 0)) out.firstCapture = g.tick / TPS / 60;
      if (g.tick % (60 * TPS)) return;
      const units = [...g.units.values()].filter(u => u.owner >= 0 && u.hp > 0);
      out.riding = Math.max(out.riding, units.filter(u => u.riding && g.units.get(u.riding)?.type !== 'train').length);
      out.samples.push({ minute: g.tick / TPS / 60, owned: slots.map(t => g.world.regions.filter(r => r.team === t).length), army: slots.map(s => units.filter(u => u.owner === s && !u.cells && u.type !== 'hq' && !['barracks', 'motorpool', 'airfield', 'armory', 'depot'].includes(u.type)).length) });
    } });
  Object.assign(out, { minutes: g.tick / TPS / 60, winner: g.winner, reason: g.endReason ?? null, trains: trains.size, lorries: lorries.size, total: g.world.total,
    finalOwned: slots.map(t => g.world.regions.filter(r => r.team === t).length), out: g.players.map(p => !!p.out) });
  return out;
}

if (!isMainThread) {
  for (const job of workerData.jobs) parentPort.postMessage(await play(job));
} else {
  const o = { matches: 6, players: 2, minutes: 75, size: 'huge', level: 'normal', seed: 1, workers: Math.min(4, availableParallelism()), json: null };
  for (let i = 2; i < process.argv.length; i += 2) { const k = process.argv[i].replace(/^--/, ''); o[k] = typeof o[k] === 'number' ? +process.argv[i + 1] : process.argv[i + 1]; }
  const jobs = Array.from({ length: o.matches }, (_, i) => ({ seed: o.seed + i, players: o.players, minutes: o.minutes, size: o.size, level: o.level }));
  const results = [], started = Date.now();
  await Promise.all(Array.from({ length: Math.min(o.workers, jobs.length) }, (_, w) => new Promise((resolve, reject) => {
    const worker = new Worker(script, { workerData: { jobs: jobs.filter((_, i) => i % o.workers === w) } });
    worker.on('message', r => { results.push(r); console.log(`seed ${r.seed}: ${r.minutes.toFixed(1)} min, ${r.winner === null ? 'unfinished' : `team ${r.winner} by ${r.reason}`}, land ${r.finalOwned.join('/')} of ${r.total}, first capture ${r.firstCapture?.toFixed(1)} min, T2 ${r.tiers.map(t => t[2]?.toFixed(1) ?? '-').join('/')}, T3 ${r.tiers.map(t => t[3]?.toFixed(1) ?? '-').join('/')}, trains ${r.trains}, trucks ${r.lorries}, riders ${r.riding}`); });
    worker.on('error', reject); worker.on('exit', resolve);
  })));
  const med = (v) => { const s = v.filter(x => x !== null && x !== undefined).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const finished = results.filter(r => r.winner !== null);
  console.log(`\n${results.length} matches, ${finished.length} finished in ${o.minutes} min; median length of finished ${med(finished.map(r => r.minutes))?.toFixed(1)} min;`
    + ` median first capture ${med(results.map(r => r.firstCapture))?.toFixed(1)} min; median T2 ${med(results.flatMap(r => r.tiers.map(t => t[2])))?.toFixed(1)} min, T3 ${med(results.flatMap(r => r.tiers.map(t => t[3])))?.toFixed(1)} min`
    + ` (${results.flatMap(r => r.tiers).filter(t => t[3] !== undefined).length} of ${results.length * o.players} seats reached T3); ${((Date.now() - started) / 60000).toFixed(1)} min wall`);
  for (const m of [10, 20, 30, 45, 60]) {
    const at = results.map(r => r.samples.find(s => Math.round(s.minute) === m)).filter(Boolean);
    if (at.length) console.log(`minute ${m}: median land per side ${med(at.flatMap(s => s.owned))}, most ${Math.max(...at.flatMap(s => s.owned))}; median army ${med(at.flatMap(s => s.army))}`);
  }
  if (o.json) writeFileSync(o.json, JSON.stringify({ options: o, results }, null, 2));
}
