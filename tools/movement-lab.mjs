import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { MOVEMENT_SCENARIOS, MOVEMENT_TYPES } from './movement-lab-scenarios.js';
import { runMovementCase } from './movement-lab-runner.js';

const options = { root: resolve(import.meta.dirname, '..'), types: MOVEMENT_TYPES, scenarios: MOVEMENT_SCENARIOS.map(s => s.id), headings: [0.15], trace: false };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--trace') options.trace = true;
  else if (['--root', '--type', '--scenario', '--out', '--headings'].includes(flag) && process.argv[i + 1]) {
    const value = process.argv[++i];
    if (flag === '--root') options.root = resolve(value);
    if (flag === '--type') options.types = value.split(',');
    if (flag === '--scenario') options.scenarios = value.split(',');
    if (flag === '--out') options.out = resolve(value);
    if (flag === '--headings') { options.headings = value.split(',').map(Number); if (!options.headings.every(Number.isFinite)) throw new Error('Headings must be numbers in radians'); }
  } else throw new Error('Usage: node tools/movement-lab.mjs [--type tank,rifle] [--scenario arrival,bridge] [--headings 0,1.5] [--root DIR] [--trace] [--out /tmp/report.json]');
}
const sim = await import(pathToFileURL(resolve(options.root, 'shared/sim.js'))), motion = await import(pathToFileURL(resolve(options.root, 'shared/vehicle-motion.js')));
const results = [];
for (const type of options.types) for (const scenario of options.scenarios) for (const heading of options.headings) {
  const result = runMovementCase(sim, motion, scenario, { type, heading, trace: options.trace }); results.push(result);
  if (!result.passed) console.log(`FAIL ${type}/${scenario}/${heading}: ${result.failures.join('; ')}`);
}
const report = { root: options.root, cases: results.length, passed: results.filter(r => r.passed).length, results };
if (options.out) await writeFile(options.out, JSON.stringify(report, null, 2));
console.log(`Movement lab: ${report.passed}/${report.cases} passed`);
if (report.passed !== report.cases) process.exitCode = 1;
