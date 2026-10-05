// Horde balance runs: AI defenders against the waves. node tools/horde.mjs [map] [defenders] [runs] [army]
// Prints the wave each run ended on, its length and the slowest sim tick.
import { readFileSync } from 'node:fs';
import { createGame, step, snapshotCache } from '../shared/sim.js';
import * as ai from '../shared/ai.js';

const [map = 'hill-112', defenders = '2', runs = '5', army = 'standard'] = process.argv.slice(2);
const m = JSON.parse(readFileSync(new URL(`../maps/${map}.json`, import.meta.url), 'utf8'));
const waves = []; let stalled = 0;
for (let r = 0; r < +runs; r++) {
  const g = createGame(m, Array.from({ length: +defenders }, (_, i) => 'AI ' + (i + 1)), true, undefined, undefined, { mode: 'horde', army });
  const initialCache = snapshotCache(g);
  const views = g.players.map((_, slot) => { if (ai.humanCommander && ai.startCommander && slot !== g.mode.slot) { ai.startCommander(g, slot, { w: g.w, h: g.h, spawn: g.players[slot].spawn, level: 'normal', seed: g.matchSeed ?? g.seed }); return null; } return ai.observe(g, slot, initialCache); });
  let worst = 0, peak = 0;
  while (g.winner === null && g.tick < 20 * 60 * 90) {
    const t = performance.now();
    step(g);
    if (g.tick % 2 === 0 || g.winner !== null) {
      const cache = snapshotCache(g);
      g.players.forEach((_, slot) => { views[slot] = ai.observe(g, slot, cache); });
    }
    g.players.forEach((_, i) => {
      if ((!ai.humanCommander || views[i]) && (ai.humanCommander || (g.tick + i * 13) % ai.thinkEvery('normal') === 0)) ai.think(g, i, { view: views[i] });
    });
    if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
    worst = Math.max(worst, performance.now() - t); peak = Math.max(peak, g.units.size);
  }
  waves.push(g.mode.wave); if (g.winner === null) stalled++;
  if (process.argv[6]) console.log(`run ${r + 1}: wave ${g.mode.wave}, ${(g.tick / 1200).toFixed(1)} min, peak ${peak} units, worst tick ${worst.toFixed(0)} ms${g.winner === null ? ' (cut off at 90 min)' : ''}`);
}
console.log(`${map}, ${defenders} defender(s), ${army}: waves ${waves.join(' ')} (median ${waves.sort((a, b) => a - b)[waves.length >> 1]})${stalled ? `, ${stalled} cut off at 90 min` : ""}`);
