// Frozen nominal levels keep a body's water line steady when blasts dig its bed or banks.
import { CFG, levelOf } from '../shared/sim.js';

export const WET = new Set(['W', 'F', '=']);
export const WATER_LIFT = 0.06;

export function createWaterLevels(map) {
  const { w, h } = map, n = w * h, levels = new Int8Array(n);
  for (let c = 0; c < n; c++) levels[c] = levelOf(map.heights?.[Math.floor(c / w)]?.[c % w] ?? '0');

  function read(grid) {
    const wet = new Uint8Array(n), bridges = new Uint8Array(n), comp = new Int32Array(n).fill(-1), compLevel = [];
    for (let c = 0; c < n; c++) {
      const ch = grid[Math.floor(c / w)][c % w];
      wet[c] = WET.has(ch) ? 1 : 0; bridges[c] = ch === '=' ? 1 : 0;
    }
    const queue = new Int32Array(n);
    for (let c = 0; c < n; c++) {
      if (!wet[c] || comp[c] >= 0) continue;
      const id = compLevel.length;
      let head = 0, tail = 1, water = Infinity, any = Infinity;
      queue[0] = c; comp[c] = id;
      while (head < tail) {
        const k = queue[head++], x = k % w, y = Math.floor(k / w);
        any = Math.min(any, levels[k]);
        if (!bridges[k]) water = Math.min(water, levels[k]);
        // Four-neighbour connectivity matches the water mesh, including bridge spans.
        for (let side = 0; side < 4; side++) {
          if ((side === 0 && x === 0) || (side === 1 && x === w - 1) || (side === 2 && y === 0) || (side === 3 && y === h - 1)) continue;
          const next = k + (side === 0 ? -1 : side === 1 ? 1 : side === 2 ? -w : w);
          if (!wet[next] || comp[next] >= 0) continue;
          comp[next] = id; queue[tail++] = next;
        }
      }
      compLevel.push((water === Infinity ? any : water) * CFG.levelHeight);
    }
    // Bank cells use the lowest water line among their eight neighbours.
    const wl = new Float32Array(n).fill(NaN), raised = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      if (wet[c]) {
        wl[c] = compLevel[comp[c]];
        raised[c] = levels[c] * CFG.levelHeight > wl[c] ? 1 : 0;
        continue;
      }
      const x = c % w, y = Math.floor(c / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && wet[k] && !(wl[c] <= compLevel[comp[k]])) wl[c] = compLevel[comp[k]];
      }
    }
    return { wet, bridges, comp, compLevel, wl, raised };
  }
  return { levels, read };
}
