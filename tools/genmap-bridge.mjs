// The Great Bridge: node tools/genmap-bridge.mjs
// A scripted Assault map (map triggers). The attackers come from the west, the defenders hold a town on the east bank
// of a wide river. A great stone bridge (a 'stone bridge' in map.buildings: shells barely scratch it) carries the
// main road straight into town. At 5:00 the defenders' engineers start wiring it, at 7:00 it is blown (with anyone
// on it), and from then on the attack has to go round: a ford far to the north or a plank rail bridge far to the
// south, both covered from woods on the east bank. The town square (a supply depot) can only be taken by a side that
// holds the bridge's east end, so a bridgehead won before the bang is worth a lot.
import { writeFileSync } from 'node:fs';
import { validateMap, findPath, TERRAIN, levelOf, CELL } from '../shared/sim.js';

const W = 120, H = 100;
const g = Array.from({ length: H }, () => Array(W).fill('.'));
const hgt = Array.from({ length: H }, () => Array(W).fill(0));
let seed = 1945;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const set = (x, y, ch) => { x = Math.round(x); y = Math.round(y); if (inb(x, y)) g[y][x] = ch; };
const at = (x, y) => (inb(x, y) ? g[y][x] : null);
const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch); };
const line = (x0, y0, x1, y1, ch, keep = '') => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) || 1; for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); if (!keep.includes(at(x, y))) set(x, y, ch); } };

// ---------- the river: 15 cells wide, gently winding ----------
const mid = (y) => 60 + 3 * Math.sin(y / 14);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - mid(y)) <= 7) g[y][x] = 'W';

// ---------- ground: the east bank rises to the town (1) and the defenders' ridge (2); two hills in the west ----------
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (x > mid(y) + 12) hgt[y][x] = 1;
  if (x >= 102) hgt[y][x] = 2;
  for (const [cx, cy] of [[24, 24], [24, 76]]) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < 4) hgt[y][x] = 2; else if (d < 8) hgt[y][x] = Math.max(hgt[y][x], 1);
  }
}

// ---------- crossings ----------
// the great bridge: six cells wide on the main road (rows 46-51)
const deck = [];
for (let y = 46; y <= 51; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'W') { set(x, y, '='); deck.push([x, y]); }
const bx0 = Math.min(...deck.map(([x]) => x)), bx1 = Math.max(...deck.map(([x]) => x));
// the ford far to the north (rows 10-13) and the plank rail bridge far to the south (rows 87-88)
for (let y = 10; y <= 13; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'W') set(x, y, 'F');
for (let y = 87; y <= 88; y++) for (let x = 0; x < W; x++) if (at(x, y) === 'W') set(x, y, '=');

// ---------- roads ----------
for (const y of [48, 49]) line(0, y, W - 1, y, 'D', 'W=');
line(10, 11, W - 12, 11, 'D', 'WF='); line(10, 88, W - 12, 88, 'D', 'W=');   // to the ford, to the rail bridge
line(10, 11, 10, 88, 'D'); line(W - 12, 11, W - 12, 88, 'D');              // the two lateral roads

// ---------- the west bank: a bridgehead village, hedged fields, woods ----------
for (const [x0, y0, x1, y1] of [[36, 40, 40, 44], [43, 41, 46, 44], [36, 53, 39, 57], [42, 53, 46, 56], [48, 39, 50, 43], [48, 54, 50, 58]]) rect(x0, y0, x1, y1, 'B');
for (let k = 0; k < 9; k++) {
  const x = 14 + Math.floor(rnd() * 26), y = 4 + Math.floor(rnd() * 92);
  if (Math.abs(y - 48) < 10) continue;
  if (rnd() < 0.5) line(x, y, x + 8 + Math.floor(rnd() * 6), y, 'H', 'DBW'); else line(x, y, x, y + 6 + Math.floor(rnd() * 5), 'H', 'DBW');
}
for (const [cx, cy, r] of [[40, 26, 5], [40, 72, 5], [16, 50, 4]]) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) < r && rnd() < 0.7 && at(x, y) === '.') set(x, y, 'O');

// ---------- the east bank: the town, its church and factory, the defenders' works ----------
const church = [92, 38, 95, 45], factory = [80, 54, 88, 60];
rect(...church, 'B'); rect(...factory, 'B');
for (const [x0, y0, x1, y1] of [[80, 39, 83, 44], [86, 40, 89, 44], [98, 39, 100, 44], [91, 53, 94, 57], [97, 53, 100, 58], [84, 63, 87, 66], [92, 32, 96, 35], [80, 33, 84, 36]]) rect(x0, y0, x1, y1, 'B');
// a trench along the bank either side of the bridge, sandbags at the bridge's end, a few staggered tank traps on the road
for (let y = 28; y <= 70; y++) if (y < 44 || y > 53) { const x = Math.round(mid(y) + 11); if (at(x, y) === '.') set(x, y, 'T'); }
for (const y of [44, 53]) rect(bx1 + 3, y, bx1 + 5, y, '#');
for (const [x, y] of [[bx1 + 7, 46], [bx1 + 7, 51], [bx1 + 10, 48]]) set(x, y, 'Y');
// woods on the east bank covering the ford and the rail bridge: the way round has cover, but it is long
for (const [cx, cy, r] of [[80, 18, 6], [80, 82, 6], [92, 22, 4], [92, 78, 4]]) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) < r && rnd() < 0.65 && at(x, y) === '.') set(x, y, 'O');

// ---------- spawns, points, triggers ----------
// attackers west (0, 1), defenders east (2, 3), in order around the map
const spawns = [{ x: 5, y: 30 }, { x: 5, y: 70 }, { x: 102, y: 64 }, { x: 102, y: 34 }];
const points = [
  { x: 42, y: 49, mp: 1 },                                 // 0 the bridgehead village (west)
  { x: bx1 + 6, y: 49, vp: 2, mp: 1 },                     // 1 the bridge's east end
  { x: 90, y: 49, vp: 2, mp: 1.5, kind: 'depot', needs: 1 }, // 2 the town square: only from the bridge's end
  { x: 80, y: 12, mp: 1, kind: 'radio' },                  // 3 the ford's far bank, the old signal post
  { x: 80, y: 87, mp: 1 },                                 // 4 the rail bridge's far bank
];
for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (inb(p.x + x, p.y + y) && !'.DW=F'.includes(g[p.y + y][p.x + x])) g[p.y + y][p.x + x] = '.';
const buildings = [{ x: church[0], y: church[1], kind: 'church' }, { x: factory[0], y: factory[1], kind: 'factory' }, { x: deck[0][0], y: deck[0][1], kind: 'stone bridge' }];
const triggers = [
  { at: 300, say: "Enemy engineers are wiring the great bridge. It goes up at 7:00." },
  { at: 400, say: 'Twenty seconds: get off the great bridge!' },
  { at: 420, blow: [bx0, 46, bx1, 51], say: 'The great bridge is down. The way over now is the ford to the north or the rail bridge to the south.' },
];

// no cliffs: a level-2 cell never touches a level-0 one (1-level steps are slopes)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hgt[y][x] === 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inb(x + dx, y + dy) && hgt[y + dy][x + dx] === 0) hgt[y + dy][x + dx] = 1;

const map = { name: 'The Great Bridge', w: W, h: H, rows: g.map(r => r.join('')), heights: hgt.map(r => r.join('')), spawns, points, defend: [2, 3], assaultTime: 1500, buildings, triggers };
const err = validateMap(map);
if (err) throw new Error(err);
// every spawn reaches every point, with the great bridge standing and without it
for (const blown of [false, true]) {
  const rows = blown ? map.rows.map((r, y) => [...r].map((ch, x) => (y >= 46 && y <= 51 && x >= bx0 && x <= bx1 ? 'W' : ch)).join('')) : map.rows;
  const mg = { w: W, h: H, flags: Uint16Array.from(rows.join(''), ch => TERRAIN[ch]), height: Int8Array.from(map.heights.join(''), levelOf) };
  const world = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
  for (const s of spawns) for (const p of points) if (!findPath(mg, world(s), world(p)).length) throw new Error(`spawn ${s.x},${s.y} can't reach point ${p.x},${p.y}${blown ? ' once the bridge is down' : ''}`);
}
writeFileSync(new URL('../maps/the-great-bridge.json', import.meta.url), JSON.stringify(map, null, 1));
console.log('wrote the-great-bridge', `bridge x ${bx0}-${bx1}`);
