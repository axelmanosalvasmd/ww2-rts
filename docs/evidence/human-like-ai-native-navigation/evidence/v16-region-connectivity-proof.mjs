import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { navigationLeg } from '/tmp/human-ai-perf-v16-frozen/shared/navigation.js';

const sourcePaths = [
  '/tmp/human-ai-perf-v16-frozen/shared/navigation.js',
  '/tmp/human-ai-perf-v16-frozen/shared/sim.js',
];
const resultPath = '/tmp/v16-region-connectivity-proof.json';
const manifestPath = '/tmp/v16-region-connectivity-proof.sources.json';
const sha256 = content => createHash('sha256').update(content).digest('hex');
const scriptPath = new URL(import.meta.url).pathname;
const sources = sourcePaths.map(path => {
  const content = fs.readFileSync(path);
  return { path, bytes: content.length, sha256: sha256(content) };
});
const script = fs.readFileSync(scriptPath);
fs.writeFileSync(manifestPath, JSON.stringify({
  sources,
  script: { path: scriptPath, bytes: script.length, sha256: sha256(script) },
  execution: { command: 'taskset -c 1 nice -n 19 node /tmp/v16-region-connectivity-proof.mjs', cpu: 1, nice: 19 },
}, null, 2) + '\n');

const src = fs.readFileSync(sourcePaths[1], 'utf8');
const regionSource = src.slice(src.indexOf('const pathRegions ='), src.indexOf('// Cells touching a wall'));
const regionsFor = new Function('MOVE', 'LAND', 'buffersFor', regionSource + '\nreturn regionsFor;')(
  1, 1024, N => ({ freeQueue: new Int32Array(N) }),
);

// Reconstruct the original stdin proof's enumeration and eligibility criteria.
let comparisons = 0, connected = 0;
for (const [w, h] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
  const n = w * h;
  for (let mask = 0; mask < 2 ** n; mask++) for (let code = -2; code < 3 ** n; code++) {
    let k = code;
    const height = code === -2 ? null : code === -1 ? new Int8Array(n) : Int8Array.from({ length: n }, () => {
      const v = k % 3; k = Math.floor(k / 3); return v;
    });
    for (const bounded of [false, true]) {
      const g = { w, h, flags: Uint16Array.from({ length: n }, (_, c) => (mask >> c) & 1), height, worldKnown: bounded };
      const labels = regionsFor(g, 1);
      for (let start = 0; start < n; start++) for (let goal = 0; goal < n; goal++) {
        const leg = navigationLeg(g, start, goal, 1, { chunkSize: 2, maxLegCells: 1 });
        comparisons++;
        if (!leg.connected || g.flags[start] & 1 || leg.goal === start) continue;
        connected++;
        if (labels[leg.goal] < 0 || labels[start] !== labels[leg.goal]) {
          const failure = { w, h, mask, height: [...(height ?? [])], bounded, start, goal, legGoal: leg.goal, labels: [...labels] };
          fs.writeFileSync(resultPath, JSON.stringify({ comparisons, connected, mismatches: 1, failure }, null, 2) + '\n');
          console.log('FAIL', JSON.stringify(failure));
          process.exit(1);
        }
      }
    }
  }
}

const g = { w: 2, h: 2, flags: new Uint16Array(4), height: Int8Array.from([0, -1, -1, 1]) };
const directedExample = {
  heights: [...g.height],
  forward: navigationLeg(g, 0, 3, 1).connected,
  reverse: navigationLeg(g, 3, 0, 1).connected,
  fullLabels: [...regionsFor(g, 1)],
};
const stale = { w: 3, h: 1, flags: Uint16Array.from([0, 0, 1]), height: null };
const oldLabels = regionsFor(stale, 1);
navigationLeg(stale, 0, 1, 1);
stale.flags = Uint16Array.from([0, 0, 0]);
const staleExample = {
  legConnected: navigationLeg(stale, 0, 2, 1).connected,
  cachedLabels: [...regionsFor(stale, 1)],
  oldLabels: [...oldLabels],
};
const result = { comparisons, connected, mismatches: 0, directedExample, staleExample };
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
