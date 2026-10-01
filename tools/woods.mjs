// Stamps woods (O) onto finished maps: node tools/woods.mjs default river-towns
// Each spawn gets a wood on both flanks of the way to its nearest point (ties within 10% all count, so a symmetric map
// stays close to symmetric): a ragged disc about 10 cells across, on open ground only, clear of spawns, points, roads
// and houses. Run it again after regenerating a map: it is not part of the generators. Old woods are cleared first.
import { readFileSync, writeFileSync } from 'node:fs';

const R = 5, OFF = 13; // wood radius and how far off the spawn-to-point line its middle sits, in cells
for (const name of process.argv.slice(2)) {
  const file = new URL(`../maps/${name}.json`, import.meta.url), m = JSON.parse(readFileSync(file, 'utf8'));
  const g = m.rows.map(r => [...r].map(ch => (ch === 'O' ? '.' : ch))), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const near = (x, y, chars, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (chars.includes(g[y + dy]?.[x + dx] ?? '')) return true; return false; };
  const nearest = (from, others) => { const min = Math.min(...others.map(o => d(from, o))); return others.filter(o => d(from, o) <= min * 1.1); };
  for (const s of m.spawns) for (const p of nearest(s, m.points)) {
    const l = d(s, p) || 1, nx = -(p.y - s.y) / l, ny = (p.x - s.x) / l;
    for (const side of [-1, 1]) {
      const c = { x: (s.x + p.x) / 2 + nx * OFF * side, y: (s.y + p.y) / 2 + ny * OFF * side };
      for (let y = Math.floor(c.y - R - 1); y <= c.y + R + 1; y++) for (let x = Math.floor(c.x - R - 1); x <= c.x + R + 1; x++) {
        // the edge wobbles with the angle from the wood's middle, the same way for every spawn's woods
        const a = Math.atan2(y - c.y, x - c.x) - Math.atan2(p.y - s.y, p.x - s.x), edge = R * (0.8 + 0.2 * Math.sin(a * 3) * side);
        if (g[y]?.[x] !== '.' || d({ x, y }, c) > edge) continue;
        if (m.spawns.some(q => d(q, { x, y }) < 12) || m.points.some(q => d(q, { x, y }) < 7) || near(x, y, 'DB=WF', 2)) continue;
        g[y][x] = 'O';
      }
    }
  }
  m.rows = g.map(r => r.join(''));
  writeFileSync(file, JSON.stringify(m, null, 1));
  console.log(`${name}: ${m.rows.join('').split('O').length - 1} wood cells`);
}
