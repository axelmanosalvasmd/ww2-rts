// Web worker: plays N AI free-for-all matches (one AI per spawn) on a map and reports how often each spawn wins.
import { CELL } from '/shared/sim.js';
import { playMatch } from '/shared/ai-schedule.js';

onmessage = ({ data: { map, n } }) => {
  const k = map.spawns.length, wins = Array(k).fill(0);
  let timeouts = 0, secs = 0, second = 0;
  for (let i = 0; i < n; i++) {
    // The server's AI schedule, so the editor's verdict reflects the AI players meet.
    const g = playMatch({ map, names: Array.from({ length: k }, (_, i) => 'ai' + i), maxTicks: 20 * 60 * 30 });
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
