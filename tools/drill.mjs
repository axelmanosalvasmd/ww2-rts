// Runs a drill (drills/*.js) over many seeds and sums up its measure.
// node tools/drill.mjs drills/flank-answer.js [--level easy|normal|hard|all] [--seeds 100] [--param key=value ...] [--json]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDrill, summarize } from '../drills/drill.js';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
if (!file) throw new Error('Usage: node tools/drill.mjs drills/<name>.js [--level easy|normal|hard|all] [--seeds N] [--param key=value]');
const drill = await import(pathToFileURL(resolve(file)).href);
const params = Object.fromEntries(args.flatMap((a, i) => a === '--param' ? [args[i + 1].split('=')] : []).map(([k, v]) => [k, v === undefined ? true : v]));
const levels = option('--level', 'all') === 'all' ? ['easy', 'normal', 'hard'] : [option('--level')];
const seeds = Number(option('--seeds', 100)), started = performance.now(), report = {};
console.log(drill.about);
for (const level of levels) {
  const results = Array.from({ length: seeds }, (_, i) => runDrill(drill, { level, seed: i + 1, params }));
  report[level] = summarize(results);
  console.log(`${level}: ${JSON.stringify(report[level])}`);
}
console.log(`${levels.length * seeds} runs in ${((performance.now() - started) / 1000).toFixed(1)} s`);
if (args.includes('--json')) console.log('RESULT ' + JSON.stringify(report));
