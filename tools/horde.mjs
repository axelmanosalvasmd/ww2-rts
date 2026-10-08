// Horde balance runs: AI defenders against the waves, on the server's AI schedule (the Horde seat plans too).
// node tools/horde.mjs [map] [defenders] [runs] [army] [verbose]. Run r is seeded with r, so results repeat.
// Prints the wave each run ended on, its length and the slowest sim tick.
import { readFileSync } from 'node:fs';
import { playMatch } from '../shared/ai-schedule.js';

const [map = 'hill-112', defenders = '2', runs = '5', army = 'standard'] = process.argv.slice(2);
const m = JSON.parse(readFileSync(new URL(`../maps/${map}.json`, import.meta.url), 'utf8'));
const waves = []; let stalled = 0;
for (let r = 0; r < +runs; r++) {
  let worst = 0, peak = 0, last = performance.now();
  const g = playMatch({ map: m, names: Array.from({ length: +defenders }, (_, i) => 'AI ' + (i + 1)), options: { mode: 'horde', army }, seed: r + 1,
    maxTicks: 20 * 60 * 90, onTick: g => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; peak = Math.max(peak, g.units.size); } });
  waves.push(g.mode.wave); if (g.winner === null) stalled++;
  if (process.argv[6]) console.log(`run ${r + 1}: wave ${g.mode.wave}, ${(g.tick / 1200).toFixed(1)} min, peak ${peak} units, worst tick ${worst.toFixed(0)} ms${g.winner === null ? ' (cut off at 90 min)' : ''}`);
}
console.log(`${map}, ${defenders} defender(s), ${army}: waves ${waves.join(' ')} (median ${waves.sort((a, b) => a - b)[waves.length >> 1]})${stalled ? `, ${stalled} cut off at 90 min` : ""}`);
