// Timing report for the human-like commander (shared/ai-human.js): reaction to damage alerts on and off screen,
// physical APM, peak APM and time to the first order, per difficulty, from seeded all-AI free-for-all matches.
// node tools/ai-human-report.mjs [--levels easy,normal,hard] [--conquest 20] [--classic 10] [--world 10]
//   [--minutes 10] [--seed 1] [--workers 6] [--json FILE]
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '..');
const TPS = 20;
// The original acceptance bands (docs/human-like-ai.md). Reaction medians are in seconds.
export const TARGETS = {
  easy: { screen: [0.9, 1.4], alert: [3, 6], apm: [20, 35], peak: 60, first: [4, 8] },
  normal: { screen: [0.5, 0.8], alert: [1.5, 3], apm: [40, 70], peak: 120, first: [3, 6] },
  hard: { screen: [0.3, 0.45], alert: [0.8, 1.6], apm: [80, 120], peak: 200, first: [2, 4] },
};

async function play({ mode, level, seed, minutes }) {
  const { playMatch } = await import('../shared/ai-schedule.js');
  const { generateWorldMap } = await import('../shared/world-conquest.js');
  const map = mode === 'world' ? generateWorldMap({ size: 'huge', seed, players: 3, teams: [0, 1, 2] })
    : JSON.parse(readFileSync(resolve(root, 'maps/default.json'), 'utf8'));
  const record = [0, 1, 2].map(() => ({ alerts: [], inputs: [], commands: new Map(), first: null }));
  const seats = [0, 1, 2].map(slot => ({ slot, level, options: {
    onAlert: a => record[slot].alerts.push(a),
    onInput: input => {
      const seat = record[slot];
      seat.inputs.push(input.tick);
      if (!input.cmd) return;
      seat.commands.set(input.tick, (seat.commands.get(input.tick) ?? 0) + 1);
      if (input.accepted && seat.first === null) seat.first = input.tick / TPS;
    },
  } }));
  const g = playMatch({ map, names: ['AI 1', 'AI 2', 'AI 3'], teams: [0, 1, 2], factions: [0, 1, 2], options: { mode, worldSize: 'huge' }, seats, seed, maxTicks: minutes * 60 * TPS });
  const span = g.tick;
  return record.map(seat => {
    const windows = [];
    for (let t = 60 * TPS; t <= span; t += 60 * TPS) windows.push(seat.inputs.filter(x => x > t - 60 * TPS && x <= t).length);
    let peak = 0;
    for (let i = 0, j = 0; j < seat.inputs.length; j++) { while (seat.inputs[j] - seat.inputs[i] >= 10 * TPS) i++; peak = Math.max(peak, j - i + 1); }
    // An alert not answered within 30 s, or before the match stops, is censored at that time.
    const events = seat.alerts.map(a => {
      const limit = Math.min(a.tick + 30 * TPS, span);
      return { screen: a.onScreen, observed: a.answered !== null && a.answered <= limit, t: ((a.answered !== null && a.answered <= limit ? a.answered : limit) - a.tick) / TPS };
    });
    return { mode, seed, seconds: span / TPS, apm: windows.length ? windows.reduce((a, b) => a + b, 0) / windows.length : null,
      peak: peak * 6, first: seat.first, maxCommandsPerTick: Math.max(0, ...seat.commands.values()), events };
  });
}

// Kaplan-Meier median: censored alerts count as "not yet answered" up to their censoring time.
function kmMedian(events) {
  const sorted = [...events].sort((a, b) => a.t - b.t || b.observed - a.observed);
  let survive = 1, atRisk = sorted.length;
  for (const e of sorted) {
    if (e.observed) { survive *= (atRisk - 1) / atRisk; if (survive <= 0.5) return e.t; }
    atRisk--;
  }
  return null;
}
const median = values => {
  const v = values.filter(x => x !== null).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};
const round = x => x === null ? null : Math.round(x * 1000) / 1000;

function summarize(level, seats) {
  const events = seats.flatMap(s => s.events), screen = events.filter(e => e.screen), alert = events.filter(e => !e.screen);
  const target = TARGETS[level], within = (x, [lo, hi]) => x !== null && x >= lo && x <= hi;
  const row = {
    seats: seats.length,
    screen: { median: round(kmMedian(screen)), events: screen.length, answered: screen.filter(e => e.observed).length, fastest: round(Math.min(...screen.filter(e => e.observed).map(e => e.t))) },
    alert: { median: round(kmMedian(alert)), events: alert.length, answered: alert.filter(e => e.observed).length, fastest: round(Math.min(...alert.filter(e => e.observed).map(e => e.t))) },
    apm: round(median(seats.map(s => s.apm))), peak: Math.max(...seats.map(s => s.peak)), first: round(median(seats.map(s => s.first))),
    maxCommandsPerTick: Math.max(...seats.map(s => s.maxCommandsPerTick)),
  };
  row.pass = { screen: within(row.screen.median, target.screen), alert: within(row.alert.median, target.alert), apm: within(row.apm, target.apm),
    peak: row.peak <= target.peak, first: within(row.first, target.first), floor: Math.min(row.screen.fastest, row.alert.fastest) >= 0.2, oneCommandPerTick: row.maxCommandsPerTick <= 1 };
  return row;
}

if (!isMainThread) {
  for (const job of workerData.jobs) parentPort.postMessage({ job, seats: await play(job) });
} else {
  const options = { levels: 'easy,normal,hard', conquest: 20, classic: 10, world: 10, minutes: 10, seed: 1, workers: Math.min(6, availableParallelism()), json: null };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, '');
    if (!(key in options) || i + 1 >= process.argv.length) throw new Error('Usage: see the header of tools/ai-human-report.mjs');
    options[key] = typeof options[key] === 'number' ? Number(process.argv[i + 1]) : process.argv[i + 1];
  }
  const levels = options.levels.split(','), jobs = [];
  for (const level of levels) for (const mode of ['conquest', 'classic', 'world'])
    for (let n = 0; n < options[mode]; n++) jobs.push({ level, mode, seed: options.seed + n, minutes: options.minutes });
  const started = performance.now(), done = [];
  await Promise.all(Array.from({ length: Math.min(options.workers, jobs.length) }, (_, w) => new Promise((ok, fail) => {
    const worker = new Worker(script, { workerData: { jobs: jobs.filter((_, i) => i % options.workers === w) } });
    worker.on('message', m => { done.push(m); process.stderr.write(`\r${done.length}/${jobs.length} matches`); });
    worker.on('error', fail); worker.on('exit', code => code ? fail(new Error(`worker exit ${code}`)) : ok());
  })));
  process.stderr.write('\n');
  const result = { options, elapsedSeconds: round((performance.now() - started) / 1000), levels: {} };
  for (const level of levels) {
    const seats = done.filter(m => m.job.level === level).flatMap(m => m.seats.map(s => ({ ...s, level })));
    result.levels[level] = summarize(level, seats);
    const r = result.levels[level], t = TARGETS[level], mark = ok => ok ? 'ok ' : 'OUT';
    console.log(`${level}: ${r.seats} seats`);
    console.log(`  ${mark(r.pass.screen)} on-screen reaction median ${r.screen.median}s (target ${t.screen.join('-')}), ${r.screen.answered}/${r.screen.events} answered`);
    console.log(`  ${mark(r.pass.alert)} off-screen alert median ${r.alert.median}s (target ${t.alert.join('-')}), ${r.alert.answered}/${r.alert.events} answered`);
    console.log(`  ${mark(r.pass.apm)} APM median ${r.apm} (target ${t.apm.join('-')})   ${mark(r.pass.peak)} peak ${r.peak} (max ${t.peak})`);
    console.log(`  ${mark(r.pass.first)} first order median ${r.first}s (target ${t.first.join('-')})   ${mark(r.pass.floor)} fastest answer ${Math.min(r.screen.fastest, r.alert.fastest)}s   ${mark(r.pass.oneCommandPerTick)} max commands per tick ${r.maxCommandsPerTick}`);
  }
  if (options.json) writeFileSync(options.json, JSON.stringify({ ...result, matches: done }, null, 1));
  console.log(`elapsed ${result.elapsedSeconds}s`);
}
