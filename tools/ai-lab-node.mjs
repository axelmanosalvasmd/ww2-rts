import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createAIcase, validateLabOptions } from './ai-lab-runner.mjs';
export async function runAiLab(rawOptions = {}) {
  const options = validateLabOptions(rawOptions), root = resolve(rawOptions.root ?? resolve(import.meta.dirname, '..'));
  const load = name => import(pathToFileURL(resolve(root, `shared/${name}.js`)).href);
  const [sim, ai, perception, hands, view] = await Promise.all(['sim', 'ai', 'ai-perception', 'ai-hands', 'ai-view'].map(load));
  const lab = createAIcase({ sim, ai, perception, hands, view }, options, rawOptions.scene ?? null);
  const report = lab.advance(Math.round(options.seconds / sim.TICK));
  const files = ['sim', 'ai', 'ai-commander', 'ai-perception', 'ai-hands', 'ai-view'];
  report.sources = Object.fromEntries(await Promise.all(files.map(async name => {
    const path = `shared/${name}.js`; return [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')];
  })));
  return report;
}
