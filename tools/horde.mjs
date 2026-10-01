// Horde balance runs: AI defenders against the waves. node tools/horde.mjs [map] [defenders] [runs] [army]
// Prints the wave each run ended on, its length and the slowest sim tick.
import { readFileSync } from 'node:fs';
import { createGame, step } from '../shared/sim.js';
import { think } from '../shared/ai.js';

const [map = 'hill-112', defenders = '2', runs = '5', army = 'standard'] = process.argv.slice(2);
const m = JSON.parse(readFileSync(new URL(`../maps/${map}.json`, import.meta.url), 'utf8'));
const waves = []; let stalled = 0;
for (let r = 0; r < +runs; r++) {
  const g = createGame(m, Array.from({ length: +defenders }, (_, i) => 'AI ' + (i + 1)), true, undefined, undefined, { mode: 'horde', army });
  let worst = 0, peak = 0;
  while (g.winner === null && g.tick < 20 * 60 * 90) {
    const t = performance.now();
    step(g);
    g.players.forEach((p, i) => (g.tick + i * 13) % 40 === 0 && think(g, i));
    worst = Math.max(worst, performance.now() - t); peak = Math.max(peak, g.units.size);
  }
  waves.push(g.mode.wave); if (g.winner === null) stalled++;
  if (process.argv[6]) console.log(`run ${r + 1}: wave ${g.mode.wave}, ${(g.tick / 1200).toFixed(1)} min, peak ${peak} units, worst tick ${worst.toFixed(0)} ms${g.winner === null ? ' (cut off at 90 min)' : ''}`);
}
console.log(`${map}, ${defenders} defender(s), ${army}: waves ${waves.join(' ')} (median ${waves.sort((a, b) => a - b)[waves.length >> 1]})${stalled ? `, ${stalled} cut off at 90 min` : ""}`);
