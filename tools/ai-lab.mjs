import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AI_LAB_SCENARIOS, validateLabOptions } from './ai-lab-runner.mjs';
import { runAiLab } from './ai-lab-node.mjs';
import { serveAiLab } from './ai-lab-server.mjs';
import { readFile } from 'node:fs/promises';
import { aiLabHTML } from './ai-lab-report.mjs';
const usage = 'node tools/ai-lab.mjs --list | --scenario contact-threat|armor-pressure|unseen-heavy-hit|guard|hold|automatic-retreat [--level easy|normal|hard] [--seed INTEGER] [--seconds 1..60] [--out DIRECTORY] [--root SOURCE_DIRECTORY]';
async function main() {
  const options = {}, args = process.argv.slice(2);
  if (args.includes('--serve')) {
    const config = { root: resolve(import.meta.dirname, '..'), host: '127.0.0.1', port: 3048 };
    for (let i = 0; i < args.length; i++) { if (args[i] === '--serve') continue; const name = args[i].slice(2); if (!['root', 'host', 'port'].includes(name) || !args[i + 1]) throw Error('Use --serve [--root DIR] [--host IP] [--port NUMBER]'); config[name] = name === 'port' ? Number(args[++i]) : args[++i]; }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw Error('CLI port must be 1..65535');
    await serveAiLab(config); return;
  }
  if (args.length === 1 && args[0] === '--list') { console.log(AI_LAB_SCENARIOS.map(row => `${row.id}: ${row.description}`).join('\n')); return; }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], name = flag.slice(2);
    if (!['scenario', 'level', 'seed', 'seconds', 'out', 'root', 'scene'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(usage);
    options[name] = ['seed', 'seconds'].includes(name) ? Number(args[++i]) : args[++i];
  }
  if (options.scene) options.scene = JSON.parse(await readFile(resolve(options.scene), 'utf8'));
  const config = validateLabOptions(options), started = performance.now();
  const report = await runAiLab(config), out = resolve(options.out ?? '/tmp/ww2-ai-lab');
  await mkdir(out, { recursive: true });
  for (const [name, contents] of [['report.json', JSON.stringify(report, null, 2)], ['report.html', aiLabHTML(report)]]) {
    const target = resolve(out, name), temporary = `${target}.${process.pid}.tmp`;
    try { await writeFile(temporary, contents, { flag: 'wx' }); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
  }
  console.log(`${config.scenario}: ${report.inputs.length} real inputs, ${report.commands.length} native commands, ${report.events.length} public events. ${(performance.now() - started).toFixed(1)}ms`);
  console.log(`Report: ${resolve(out, 'report.html')}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
