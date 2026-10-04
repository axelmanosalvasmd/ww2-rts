// Web worker: plays N AI free-for-all matches (one AI per spawn) on a map and reports how often each spawn wins.
import { createGame, step, CELL, snapshotCache } from '/shared/sim.js';
import * as ai from '/shared/ai.js';

onmessage = ({ data: { map, n } }) => {
  const k = map.spawns.length, wins = Array(k).fill(0);
  let timeouts = 0, secs = 0, second = 0;
  for (let i = 0; i < n; i++) {
    const g = createGame(map, Array.from({ length: k }, (_, i) => 'ai' + i));
    const initialCache = snapshotCache(g);
    const views = Array.from({ length: k }, (_, slot) => ai.observe(g, slot, initialCache));
    while (g.winner === null && g.tick < 20 * 60 * 30) {
      step(g);
      if (g.tick % 2 === 0 || g.winner !== null) {
        const cache = snapshotCache(g);
        for (let slot = 0; slot < k; slot++) views[slot] = ai.observe(g, slot, cache);
      }
      for (let slot = 0; slot < k; slot++) {
        if (ai.humanCommander || (g.tick + slot * 13) % ai.thinkEvery('normal') === 0) ai.think(g, slot, { view: views[slot] });
      }
      if (g.tick % 2 === 0 || g.winner !== null) { g.shots = []; g.newCells = []; }
    }
    if (g.winner === null) timeouts++;
    else {
      // spawns are shuffled per match: credit the spawn the winner actually had
      const sp = g.players[g.winner].spawn;
      wins[map.spawns.findIndex(q => (q.x + 0.5) * CELL === sp.x && (q.y + 0.5) * CELL === sp.z)]++;
    }
    const vp = g.players.map(p => p.vp).sort((a, b) => b - a);
    secs += g.tick / 20; second += vp[1] / Math.max(1, vp[0]);
    postMessage({ done: i + 1, n, wins, timeouts, avgMin: secs / (i + 1) / 60, second: second / (i + 1) });
  }
};
