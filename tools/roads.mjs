// Stamps roads (D) and muddy ford approaches (M) onto finished maps: node tools/roads.mjs default river-towns
// Every spawn gets a road to its nearest point, every point to its nearest other point (ties within 10% all count,
// so a symmetric map stays symmetric). Only open ground and craters are paved; a road stops at a river bank.
// Run it again after regenerating a map with genmap: it is not part of the generators.
import { readFileSync, writeFileSync } from 'node:fs';

for (const name of process.argv.slice(2)) {
  const file = new URL(`../maps/${name}.json`, import.meta.url), m = JSON.parse(readFileSync(file, 'utf8'));
  const g = m.rows.map(r => [...r]), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pave = (x, y) => { if ('.+'.includes(g[y]?.[x] ?? '')) g[y][x] = 'D'; };
  const road = (a, b) => {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)), steep = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
      pave(x, y); pave(x + (steep ? 1 : 0), y + (steep ? 0 : 1)); // two cells wide
    }
  };
  const nearest = (from, others) => { const min = Math.min(...others.map(o => d(from, o))); return others.filter(o => d(from, o) <= min * 1.1); };
  for (const s of m.spawns) for (const p of nearest(s, m.points)) road(s, p);
  for (const p of m.points) for (const q of nearest(p, m.points.filter(o => o !== p))) road(p, q);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (g[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] === 'F')) g[y][x] = 'M';
  }
  m.rows = g.map(r => r.join(''));
  writeFileSync(file, JSON.stringify(m, null, 1));
  const count = (ch) => m.rows.join('').split(ch).length - 1;
  console.log(`${name}: ${count('D')} road cells, ${count('M')} mud cells`);
}
