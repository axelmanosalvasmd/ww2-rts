// Generates Three Islands: node tools/genmap-islands.mjs
// Three home islands around a small central islet, 512 cells (1 km) across, no bridges: the only way over is by boat.
// Each coast alternates beaches (surf you can land in) with cliffs (two levels up from the water, no landing).
// Two spawns per island, listed around the map, so a 3-player FFA gets an island each and teams share one.
import { writeFileSync } from 'node:fs';
import { validateMap, levelChar } from '../shared/sim.js';

const N = 512, c = N / 2, ring = 0.3 * N, isl = 0.17 * N, mid = 0.06 * N;
const centers = [90, 210, 330].map(a => ({ x: c + Math.cos(a * Math.PI / 180) * ring, y: c + Math.sin(a * Math.PI / 180) * ring }));
const g = Array.from({ length: N }, () => Array(N).fill('W'));
const hgt = Array.from({ length: N }, () => Array(N).fill(0));
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const isles = [...centers.map(p => ({ ...p, r: isl, cliffs: true })), { x: c, y: c, r: mid, cliffs: false }];
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  // distance to the nearest island in island radii, with a wobbly coastline
  let best = Infinity, near = null, ang = 0;
  for (const p of isles) {
    const a = Math.atan2(y - p.y, x - p.x), d = Math.hypot(x - p.x, y - p.y) / (p.r * (1 + 0.08 * Math.sin(5 * a + p.x)));
    if (d < best) { best = d; near = p; ang = a; }
  }
  // beaches on three sectors of each home island, cliffs between them; the islet is all beach
  const beach = !near.cliffs || Math.sin(3 * ang + near.x / 40) > -0.2;
  if (best < 1) { g[y][x] = '.'; hgt[y][x] = beach ? (best < 0.9 ? 1 : 0) : best < 0.55 ? 1 : 2; }
  else if (beach && best < 1 + 6 / near.r) g[y][x] = 'F'; // surf: about 6 cells of shallows off a beach
}
for (const p of centers) for (let i = 0; i < N / 20; i++) {
  const x = Math.round(p.x + (rnd() - 0.5) * isl), y = Math.round(p.y + (rnd() - 0.5) * isl);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 6; dx++) if (g[y + dy]?.[x + dx] === '.') g[y + dy][x + dx] = 'B';
}
const at = (p, a, r) => ({ x: Math.round(p.x + Math.cos(a) * r), y: Math.round(p.y + Math.sin(a) * r) });
const out = (p) => Math.atan2(p.y - c, p.x - c);
const spawns = centers.flatMap(p => [at(p, out(p) - 0.6, isl * 0.6), at(p, out(p) + 0.6, isl * 0.6)]);
const points = [{ x: Math.round(c), y: Math.round(c), vp: 2, mp: 0 }, ...centers.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), mp: 1.5 }))];
for (const p of [...spawns, ...points]) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (g[p.y + y][p.x + x] === 'B') g[p.y + y][p.x + x] = '.';
const map = { name: 'Three Islands', w: N, h: N, naval: true, rows: g.map(r => r.join('')), heights: hgt.map(r => r.map(levelChar).join('')), spawns, points };
const err = validateMap(map);
if (err) throw new Error(err);
writeFileSync(new URL('../maps/three-islands.json', import.meta.url), JSON.stringify(map));
console.log(`three-islands: ${N}x${N} (${N * 2} m), straits about ${Math.round((ring * Math.sqrt(3) - 2 * isl) * 2)} m`);
