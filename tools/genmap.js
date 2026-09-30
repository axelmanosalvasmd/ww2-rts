// Generates maps/default.json: a 3-way rotationally symmetric map.
// ponytail: stopgap until the in-game editor (slice 5) exists.
import { writeFileSync } from 'node:fs';
const W = 80, H = 80, C = 40;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const hgt = Array.from({ length: H }, () => Array(W).fill(0));
// hill: level 1 out to r1 cells, level 2 inside r2
const hill = (cx, cy, r1, r2) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r1) hgt[y][x] = Math.max(hgt[y][x], d <= r2 ? 2 : 1); } };
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
  arc(16.5, m - 7, m + 7, 'T'); // trench in front of the village, facing the center
  box(...polar(a + 60, 7), 3, 3, 'B');
  arc(11, a - 15, a + 15, '#');
  hill(...polar(a, 14), 4, 2); // each player's overwatch hill between HQ and the center
  arc(5, a + 45, a + 75, 'T'); // trenches ringing the center point
  for (const [da, r] of craters) set(...polar(a + da, r), '+');
  const [sx, sy] = polar(a, 33); spawns.push({ x: Math.round(sx), y: Math.round(sy) });
}
// the top spawn lands exactly on the grid, the diagonal ones round outward: pull it back one cell so
// every spawn is the same walk from its villages (measured with findPath; 2m was enough to bias AI matches 22-4-4)
spawns[0].y -= 1;
for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(p.x + x, p.y + y, '.');
writeFileSync(new URL('../maps/default.json', import.meta.url), JSON.stringify({ name: 'Three Crossroads', w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.join('')), spawns, points }, null, 1));

// River Towns: the same map with three rivers along the sector boundaries (through the villages).
// Each river gets a bridge through its village (the capture point sits on it) and a ford further out.
// Rasterized by distance from each river's center line, so width is the same at any angle
// (sampling along the line made the diagonal rivers and bridges fatter and biased the AI matches).
for (let k = 0; k < 3; k++) {
  const m = (-90 + 120 * k + 180) * Math.PI / 180, ux = Math.cos(m), uy = Math.sin(m);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - C, along = dx * ux + dy * uy, side = Math.abs(-dx * uy + dy * ux);
    if (along < 8 || side > 1.3) continue;
    g[y][x] = along >= 18 && along <= 22 ? '=' : along >= 31 && along <= 33 ? 'F' : 'W';
  }
}
writeFileSync(new URL('../maps/river-towns.json', import.meta.url), JSON.stringify({ name: 'River Towns', w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.join('')), spawns, points }, null, 1));
console.log(g.map(r => r.join('')).join('\n'));

// Six Fronts: 150x150 for up to 6 players (3v3, 2v2v2, FFA). Spawns go in order around the ring,
// which is what the game uses to put teammates side by side. Center 2x VP, a village between each
// pair of neighbouring spawns.
{
  const W = 150, H = 150, C = 75;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const hgt = Array.from({ length: H }, () => Array(W).fill(0));
  const set = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = ch; };
  const polar = (deg, r) => [C + r * Math.cos(deg * Math.PI / 180), C + r * Math.sin(deg * Math.PI / 180)];
  const box = (cx, cy, w, h, ch) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(cx - w / 2 + x, cy - h / 2 + y, ch); };
  const arc = (r, a0, a1, ch) => { for (let a = a0; a <= a1; a += 0.3) set(...polar(a, r), ch); };
  const hill = (cx, cy, r1, r2) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r1) hgt[y][x] = Math.max(hgt[y][x], d <= r2 ? 2 : 1); } };
  const spawns = [], points = [{ x: C, y: C, vp: 2, mp: 0 }];
  for (let k = 0; k < 6; k++) {
    const a = -90 + 60 * k, m = a + 30;
    // village between this spawn and the next
    const [vx, vy] = polar(m, 44); points.push({ x: Math.round(vx), y: Math.round(vy), vp: 1, mp: 1.5 });
    box(...polar(m - 9, 46), 4, 3, 'B'); box(...polar(m + 9, 46), 3, 4, 'B'); box(...polar(m, 51), 4, 4, 'B');
    arc(38, m - 8, m + 8, '#'); arc(39.5, m - 5, m + 5, 'T');
    // hedgerows in front of the HQ with a road gap, an overwatch hill toward the center, trenches around it
    arc(52, a - 18, a - 5, 'H'); arc(52, a + 5, a + 18, 'H');
    hill(...polar(a, 40), 5, 2.5);
    box(...polar(a, 26), 3, 3, 'B'); arc(12, m - 12, m + 12, 'T');
    for (const [da, r] of craters) set(...polar(a + da / 2, 20 + r), '+');
    const [sx, sy] = polar(a, 64); spawns.push({ x: Math.round(sx), y: Math.round(sy) });
  }
  for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(p.x + x, p.y + y, '.');
  writeFileSync(new URL('../maps/six-fronts.json', import.meta.url), JSON.stringify({ name: 'Six Fronts', w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.join('')), spawns, points }, null, 1));
}
