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

// Hill 112: an assault map. The defenders dig in on a plateau (level 4); the attackers start at the foot
// and climb terraces. On the upper slope the flanks are a two-level escarpment (a cliff), so the climb
// funnels through a central ramp, with narrow goat paths at both map edges.
{
  const W = 80, H = 110;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = ch; };
  const box = (cx, cy, w, h, ch) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(cx - w / 2 + x, cy - h / 2 + y, ch); };
  const line = (x0, y0, x1, y1, ch) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2); for (let i = 0; i <= n; i++) set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ch); };
  // terrace edges wander a little so the hill doesn't look ruled
  const edge = (y0, x, k) => y0 + 2.5 * Math.sin(x / 7 + k) + 1.5 * Math.sin(x / 3.1 + 2 * k);
  const hgt = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    const L = y < edge(30, x, 0) ? 4 : y < edge(45, x, 1) ? 3 : y < edge(60, x, 2) ? 2 : y < edge(75, x, 3) ? 1 : 0;
    const flank = x >= 6 && x <= 73 && (x < 31 || x > 48);
    return L === 3 && flank ? 2 : L; // escarpment: the level-3 band only exists on the ramp and the goat paths
  }));
  let seed = 112; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // the slope has been shelled for days
  for (let i = 0; i < 70; i++) set(4 + rnd() * 72, 28 + rnd() * 60, '+');
  // defenders: a farm and a stone wall along the crest, trenches overlooking the ramp
  box(16, 16, 5, 4, 'B'); box(64, 16, 5, 4, 'B'); box(40, 4, 6, 4, 'B');
  line(8, 26, 30, 27, '#'); line(50, 27, 72, 26, '#');
  line(31, 29, 38, 29, 'T'); line(42, 29, 49, 29, 'T');
  // middle terrace: a hamlet astride the ramp, hedges along the terrace edges
  box(33, 50, 4, 3, 'B'); box(47, 50, 4, 3, 'B'); box(40, 56, 3, 3, 'B');
  line(4, 58, 22, 57, 'H'); line(58, 57, 76, 58, 'H');
  line(10, 44, 26, 44, 'H'); line(54, 44, 70, 44, 'H');
  // lower slope: orchards (hedges) and farms to advance through
  box(18, 80, 5, 4, 'B'); box(62, 80, 5, 4, 'B');
  for (const x of [8, 26, 54, 72]) line(x, 66, x, 74, 'H');
  line(30, 88, 50, 88, '#');
  const spawns = [{ x: 28, y: 9 }, { x: 52, y: 9 }, { x: 20, y: 102 }, { x: 60, y: 102 }];
  const points = [{ x: 40, y: 14, vp: 2, mp: 1.5 }, { x: 40, y: 50, vp: 1, mp: 1.5 }, { x: 16, y: 72, vp: 1, mp: 1.5 }, { x: 64, y: 72, vp: 1, mp: 1.5 }];
  for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(p.x + x, p.y + y, '.');
  writeFileSync(new URL('../maps/hill-112.json', import.meta.url), JSON.stringify({ name: 'Hill 112', w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.join('')), spawns, points, defend: [0, 1] }, null, 1));
  console.log(hgt.map(r => r.join('')).join('\n'));
}
