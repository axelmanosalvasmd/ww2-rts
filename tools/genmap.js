// Generates maps/default.json: a 3-way rotationally symmetric map.
// ponytail: stopgap until the in-game editor (slice 5) exists.
import { writeFileSync } from 'node:fs';
const W = 80, H = 80, C = 40;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const set = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = ch; };
const polar = (deg, r) => [C + r * Math.cos(deg * Math.PI / 180), C + r * Math.sin(deg * Math.PI / 180)];
const box = (cx, cy, w, h, ch) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(cx - w / 2 + x, cy - h / 2 + y, ch); };
const arc = (r, a0, a1, ch) => { for (let a = a0; a <= a1; a += 0.5) set(...polar(a, r), ch); };
const ray = (a, r0, r1, ch) => { for (let r = r0; r <= r1; r += 0.4) set(...polar(a, r), ch); };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const craters = Array.from({ length: 14 }, () => [rnd() * 120, 8 + rnd() * 26]);
// center: 2x VP but no manpower, open on all sides. Villages: 1 VP + manpower.
const spawns = [], points = [{ x: C, y: C, vp: 2, mp: 0 }];
for (let k = 0; k < 3; k++) {
  const a = -90 + 120 * k;
  // hedgerow belt in front of each spawn, road gap in the middle
  arc(22, a - 28, a - 8, 'H'); arc(22, a + 8, a + 28, 'H');
  ray(a + 60, 26, 36, 'H');
  // village around the point opposite this spawn (equidistant from the other two)
  const m = a + 180;
  const [px, py] = polar(m, 20); points.push({ x: Math.round(px), y: Math.round(py), vp: 1, mp: 1.5 });
  box(...polar(m - 14, 22), 4, 3, 'B'); box(...polar(m + 14, 22), 3, 4, 'B'); box(...polar(m, 27), 4, 4, 'B');
  arc(15, m - 10, m + 10, '#');
  box(...polar(a + 60, 7), 3, 3, 'B');
  arc(11, a - 15, a + 15, '#');
  for (const [da, r] of craters) set(...polar(a + da, r), '+');
  const [sx, sy] = polar(a, 33); spawns.push({ x: Math.round(sx), y: Math.round(sy) });
}
// the top spawn lands exactly on the grid, the diagonal ones round outward: pull it back one cell so
// every spawn is the same walk from its villages (measured with findPath; 2m was enough to bias AI matches 22-4-4)
spawns[0].y -= 1;
for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(p.x + x, p.y + y, '.');
writeFileSync(new URL('../maps/default.json', import.meta.url), JSON.stringify({ name: 'Three Crossroads', w: W, h: H, rows: g.map(r => r.join('')), spawns, points }, null, 1));
console.log(g.map(r => r.join('')).join('\n'));
