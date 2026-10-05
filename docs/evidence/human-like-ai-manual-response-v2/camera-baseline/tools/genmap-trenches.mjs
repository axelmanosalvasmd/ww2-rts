// No Man's Land: node tools/genmap-trenches.mjs
// A Western Front showcase for the trench rules. Each side holds a reserve line and a zigzag front line joined by
// communication trenches (fast and hidden to move along), behind belts of wire with gaps in them. Between the fronts
// lies a cratered strip with wrecks, mud and an abandoned trench by the center point. The map's trenches face the enemy (trenchFacing), so flanking a line pays.
// Mirrored through the center, so both sides get the same ground.
import { writeFileSync } from 'node:fs';
import { validateMap } from '../shared/sim.js';

const W = 120, H = 90;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
let seed = 1918;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (!inb(x, y)) return; g[y][x] = ch; g[H - 1 - y][W - 1 - x] = ch; };
const at = (x, y) => (inb(x, y) ? g[y][x] : null);
const line = (x0, y0, x1, y1, ch) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) || 1; for (let i = 0; i <= n; i++) set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ch); };
const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch); };
// a zigzag trench across the map at row y: teeth `tooth` cells long, `amp` deep, with gaps where `skip` says
const zigzag = (y, amp, tooth, skip = () => false) => {
  for (let x = 2, k = 0; x < W - 2; x += tooth, k++) if (!skip(x)) line(x, y + (k % 2 ? amp : 0), x + tooth, y + (k % 2 ? 0 : amp), 'T');
};

// ---------- the north side (mirrored to the south) ----------
// the rear: a ruined village around each spawn's road in, and a field hospital's worth of open ground
for (const cx of [32, 88]) {
  rect(cx - 9, 10, cx - 6, 13, 'B'); rect(cx + 5, 9, cx + 8, 12, 'B'); rect(cx - 2, 14, cx + 1, 15, 'R');
  line(cx, 0, cx, 18, 'D');
}
line(0, 17, W - 1, 17, 'D'); // the lateral road behind the reserve line
// the reserve line: a straight trench with sandbagged posts
line(4, 22, W - 5, 22, 'T');
for (const x of [14, 40, 60, 80, 106]) rect(x - 1, 21, x + 1, 21, '#');
// communication trenches, crooked, from the reserve line up to the front
for (const x of [18, 44, 76, 102]) { line(x, 22, x + 3, 26, 'T'); line(x + 3, 26, x, 30, 'T'); line(x, 30, x + 2, 32, 'T'); }
// the front line: a zigzag, broken in two places for sorties
zigzag(32, 2, 4, x => (x >= 28 && x < 32) || (x >= 90 && x < 94));
// MG posts on the front line: sandbag horseshoes just ahead of it
for (const x of [24, 60, 96]) { rect(x - 1, 35, x + 1, 35, '#'); set(x - 2, 34, '#'); set(x + 2, 34, '#'); }
// two belts of wire, staggered so the gaps don't line up
for (let x = 2; x < W - 2; x++) {
  if (x % 18 > 3) set(x, 37, 'X');
  if ((x + 9) % 18 > 3) set(x, 39, 'X');
}

// ---------- no man's land (rows 40 to 44; the mirror fills 45 to 49) ----------
for (let y = 40; y < 45; y++) for (let x = 0; x < W; x++) {
  const r = rnd();
  if (r < 0.32) set(x, y, '+'); else if (r < 0.4) set(x, y, 'M');
}
// shattered woods on the flanks
for (const [cx, cy] of [[8, 42], [112, 41]]) for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 4; x <= cx + 4; x++) if (Math.hypot(x - cx, y - cy) < 3.5 && rnd() < 0.5) set(x, y, 'O');
// wrecked tanks from an earlier attack
for (const [x, y] of [[36, 41], [70, 43], [52, 40]]) set(x, y, 'Q');
// the abandoned trench in the middle, running diagonally past the center point (the mirror finishes it). Each half
// faces the far side, so it shelters whoever holds it from the front but not from fire along it.
line(44, 41, 57, 43, 'T');

const spawns = [{ x: 32, y: 4 }, { x: 88, y: 4 }, { x: 87, y: 85 }, { x: 31, y: 85 }];
const points = [
  { x: 60, y: 45, vp: 2, mp: 0 }, // the abandoned trench
  { x: 14, y: 43 }, { x: 105, y: 46 }, // the shattered woods
  { x: 60, y: 27 }, { x: 59, y: 62 }, // each side's own line, behind its wire
];
// spawns and points sit in a small clearing
for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (inb(p.x + x, p.y + y) && !'.D'.includes(g[p.y + y][p.x + x])) g[p.y + y][p.x + x] = '.';
const map = { name: "No Man's Land", w: W, h: H, rows: g.map(r => r.join('')), heights: g.map(() => '0'.repeat(W)), spawns, points, trenchFacing: true };
const err = validateMap(map);
if (err) throw new Error(err);
writeFileSync(new URL('../maps/no-mans-land.json', import.meta.url), JSON.stringify(map, null, 1));
console.log('wrote no-mans-land');
