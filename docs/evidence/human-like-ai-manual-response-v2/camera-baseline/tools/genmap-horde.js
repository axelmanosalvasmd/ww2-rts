// Generates the Horde map set: node tools/genmap-horde.js [name to print]
// Built for Horde: one HQ to hold (spawn 0, the only `defend` spawn) and the Horde's gates at the other spawns.
// Cliffs (2+ levels) never break, houses (B) do, so a wall of cliff with a house in it is a wall with a breach to come.
// ponytail: the canvas is a third copy of the one in genmap-pack.js and genmap-xl.js (those scripts write their maps on
// import, so it can't be shared from there); move it to one module if a fourth generator shows up.
import { writeFileSync } from 'node:fs';
import { validateMap, levelChar, TERRAIN, MOVE } from '../shared/sim.js';

function canvas(W, H, seed) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const hgt = Array.from({ length: H }, () => Array(W).fill(0));
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  let soft = false;
  const m = {
    W, H, g, hgt,
    rnd: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    set(x, y, ch) { x = Math.round(x); y = Math.round(y); if (inb(x, y) && (!soft || g[y][x] === '.')) g[y][x] = ch; },
    // whatever fn draws only lands on open ground
    soft(fn) { soft = true; fn(); soft = false; },
    at: (x, y) => (inb(x, y) ? g[y][x] : null),
    rect(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.set(x, y, ch); },
    line(x0, y0, x1, y1, ch, width = 1) {
      const d = Math.hypot(x1 - x0, y1 - y0) || 1, n = Math.ceil(d * 2), ox = -(y1 - y0) / d, oy = (x1 - x0) / d;
      for (let i = 0; i <= n; i++) for (let k = 0; k < width; k++) m.set(x0 + (x1 - x0) * i / n + ox * k, y0 + (y1 - y0) * i / n + oy * k, ch);
    },
    disc(cx, cy, r, ch) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r) m.set(x, y, ch); },
    road(x0, y0, x1, y1) { m.soft(() => m.line(x0, y0, x1, y1, 'D', 2)); },
    // a house, only where the whole footprint is open and level ground
    house(cx, cy, w, h) {
      const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2), cells = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]);
      if (cells.every(([x, y]) => m.at(x, y) === '.' && hgt[y][x] === hgt[y0][x0])) m.rect(x0, y0, x0 + w - 1, y0 + h - 1, 'B');
    },
    woods(cx, cy, r, fill = 0.7) { m.soft(() => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r && m.rnd() < fill) m.set(x, y, 'H'); }); },
    sow(n, x0, y0, x1, y1, ch) { m.soft(() => { for (let i = 0; i < n; i++) m.set(x0 + m.rnd() * (x1 - x0), y0 + m.rnd() * (y1 - y0), ch); }); },
    heights(fn) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y][x] = fn(x, y); },
  };
  return m;
}
const polar = (cx, cy, deg, r) => [Math.round(cx + r * Math.cos(deg * Math.PI / 180)), Math.round(cy + r * Math.sin(deg * Math.PI / 180))];

function save(file, name, m, spawns, points) {
  // spawns and points sit in a small clearing
  for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const ch = m.at(p.x + x, p.y + y);
    if (ch && !'.WF=D'.includes(ch)) m.g[p.y + y][p.x + x] = '.';
  }
  // what can walk to the HQ with every house still standing; cliffs and houses block
  const key = (x, y) => y * m.W + x, seen = new Set([key(spawns[0].x, spawns[0].y)]), todo = [[spawns[0].x, spawns[0].y]];
  for (const [x, y] of todo) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy, ch = m.at(nx, ny);
    if (!ch || seen.has(key(nx, ny)) || TERRAIN[ch] & MOVE || Math.abs(m.hgt[ny][nx] - m.hgt[y][x]) > 1) continue;
    seen.add(key(nx, ny)); todo.push([nx, ny]);
  }
  // a wave has to be able to walk in from every gate
  for (const p of [...spawns, ...points]) if (!seen.has(key(p.x, p.y))) throw new Error(`${file}: ${p.x},${p.y} is cut off from the HQ`);
  // nothing but bare rock where nobody can walk: cover on a cliff top draws squads up onto it, and they never come down
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (!seen.has(key(x, y)) && !(TERRAIN[m.g[y][x]] & MOVE)) m.g[y][x] = '.';
  const map = { name, w: m.W, h: m.H, rows: m.g.map(r => r.join('')), heights: m.hgt.map(r => r.map(levelChar).join('')), spawns, points, defend: [0] };
  const err = validateMap(map);
  if (err) throw new Error(`${file}: ${err}`);
  writeFileSync(new URL(`../maps/${file}.json`, import.meta.url), JSON.stringify(map, null, 1));
  console.log('wrote', file, `${m.W}x${m.H}`);
  if (process.argv[2] === file) console.log(map.rows.map((r, y) => [...r].map((ch, x) => (ch === '.' ? ' 1234'[m.hgt[y][x]] ?? (m.hgt[y][x] < 0 ? ',' : ' ') : ch)).join('')).join('\n'));
}

// Helm's Deep: a valley that narrows to the north, shut by the Deeping Wall (a rampart two levels up, cliff on both
// faces) from the Hornburg on its rock in the west to the eastern mountain. Two ways in. The causeway climbs to the
// Hornburg's gate, and the culvert, where the stream runs under the wall, is plugged by a blockhouse: knock it down
// and the wall is breached. Behind the wall stairs lead up onto it and a postern into the keep, so a breach turns the
// whole line. Helm's Dike (a trench and a step down) is the forward line; the Horde comes up the valley from the south.
{
  const W = 110, H = 130, m = canvas(W, H, 3019), KX = 36, KY = 54, KR = 13;
  const keep = (x, y) => Math.hypot(x - KX, y - KY) <= KR, lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  const west = (y) => (y > 57 ? lerp(20, 6, (y - 57) / 43) : lerp(20, 40, (57 - y) / 47)) + 2 * Math.sin(y / 7);
  const east = (y) => (y > 57 ? lerp(90, 103, (y - 57) / 43) : lerp(90, 70, (57 - y) / 47)) + 2 * Math.sin(y / 5 + 1);
  const culvert = (x) => x >= 68 && x <= 71;
  m.heights((x, y) => {
    if (keep(x, y)) return 2;
    if (y < 6 || x < west(y) || x > east(y)) return 4;                           // the mountains
    if (y >= 56 && y <= 58 && x > KX) return culvert(x) ? 0 : 2;                 // the Deeping Wall
    if (x >= 34 && x <= 38 && y > KY && y <= 72) return 1;                       // the causeway
    if (Math.hypot(x - 46.5, y - 43.5) <= 2.5) return 1;                         // postern stair, keep to the Deep
    if (y === 55 && ((x >= 58 && x <= 60) || (x >= 82 && x <= 84))) return 1;    // stairs up the back of the wall
    return y >= 96 ? -1 : 0;                                                     // below the Dike the valley drops
  });
  m.road(55, 124, 55, 84); m.road(55, 84, 37, 74); m.road(36, 74, 36, 60);
  // the Deeping Stream: out of the caves, under the wall, down the valley
  m.line(57, 12, 69, 54, 'F'); m.line(70, 60, 74, 90, 'F'); m.line(74, 90, 82, 129, 'F');
  m.rect(68, 56, 71, 58, 'B');
  for (let x = 49; x < W; x++) if (m.hgt[58][x] === 2 && x % 3) m.set(x, 58, '#'); // battlements
  // the Hornburg: a ring wall open at the gate (south), the postern and the Deeping Wall; the tower, two gatehouses
  for (let a = 0; a < 360; a++) if (Math.abs(a - 90) > 22 && Math.abs(a - 315) > 12 && a > 28) m.set(...polar(KX, KY, a, 12.4), '#');
  m.rect(27, 46, 30, 49, 'B'); m.rect(31, 63, 32, 65, 'B'); m.rect(40, 63, 41, 65, 'B');
  m.rect(32, 68, 33, 71, 'Y'); m.rect(39, 68, 40, 71, 'Y'); // the causeway's flanks are barred to vehicles
  // the Deep: stables and stores, a second line behind the culvert
  m.house(50, 40, 5, 3); m.house(72, 36, 4, 3); m.house(50, 26, 4, 4); m.house(77, 48, 5, 3);
  m.line(62, 50, 76, 50, 'T');
  // Helm's Dike, wire below it, burnt farms and shelled ground down the valley
  m.soft(() => { for (let x = 0; x < W; x++) { if (m.hgt[93][x] === 0 && x % 9 > 1) m.set(x, 93, 'T'); if (m.hgt[99][x] === -1 && x % 7 < 4) m.set(x, 99, 'X'); } });
  m.house(26, 106, 5, 4); m.house(86, 104, 5, 4); m.house(64, 112, 4, 3);
  m.woods(14, 112, 5); m.woods(97, 110, 5); m.woods(28, 84, 3); m.woods(85, 78, 4);
  m.sow(70, 8, 62, 102, 126, '+'); m.sow(14, 10, 62, 100, 120, 'R');
  save('helms-deep', "Helm's Deep", m,
    // the keep spawn is for the defenders only (Horde, Assault); the gates across the valley mouth
    [{ x: KX, y: KY, assault: true }, { x: 28, y: 122 }, { x: 55, y: 124 }, { x: 82, y: 122 }],
    [{ x: 30, y: 58, vp: 2, mp: 1.5 }, { x: 62, y: 57, mp: 1 }, { x: 56, y: 18, mp: 1.5 }, { x: 55, y: 90, mp: 1 }, { x: 76, y: 42, mp: 0.5 }]);
}

// The Hot Gates: Thermopylae. A coast road between the sea and a cliff-sided mountain that squeezes it to 28 m at the
// Middle Gate, where a wall, a trench and tank traps wait. West of it marsh and hot springs slow the approach. The
// goat path runs through the mountain (one gate of the Horde is on it) and comes down behind the wall.
{
  const W = 135, H = 80, m = canvas(W, H, 480);
  const edge = (x) => 50 - 30 * Math.exp(-(((x - 78) / 14) ** 2)) + 1.5 * Math.sin(x / 6);
  const gully = (x) => (x >= 28 && x <= 32) || (x >= 104 && x <= 108);
  m.heights((x, y) => {
    if (y >= 62 && y <= 66 && x >= 28 && x <= 108) return 2;      // the goat path
    if (gully(x) && y >= 47 && y < 62) return y <= 49 ? 1 : 2;    // and the gullies down from both ends
    return y >= edge(x) ? 4 : 0;
  });
  for (let x = 0; x < W; x++) for (let y = 0; y < 4 + 1.5 * Math.sin(x / 9); y++) m.set(x, y, 'W');
  m.road(5, 28, 60, 14); m.road(60, 14, 78, 12); m.road(78, 12, 100, 16); m.road(100, 16, 114, 24);
  // the springs the place is named for, in a pool along the foot of the cliff at the Middle Gate. Water keeps a
  // squad's width between the road and the rock: squads that hug a cliff corner can end up stood inside it, and
  // on rock nobody can reach the wave never ends
  for (let x = 68; x <= 88; x++) for (let y = 0; y < H - 2; y++) if (m.hgt[y][x] === 0 && (m.hgt[y + 1][x] === 4 || m.hgt[y + 2][x] === 4)) m.set(x, y, 'W');
  // the Middle Gate: wire, tank traps, then the wall and a trench behind it; the road runs through the gap
  const put = (x, y, ch) => { if (m.hgt[y][x] === 0 && m.at(x, y) !== 'W') m.set(x, y, ch); };
  for (let y = 5; y <= 22; y++) {
    if (y % 4 < 3) put(72, y, 'X');
    if (Math.abs(y - 12) > 2) put(76, y, 'Y');
    if (Math.abs(y - 12) > 1) put(80, y, '#');
    if (Math.abs(y - 12) > 2) put(83, y, 'T');
  }
  // the western approach: marsh by the shore, hot springs, scrub under the cliffs
  m.soft(() => { for (let i = 0; i < 9; i++) m.disc(8 + m.rnd() * 54, 7 + m.rnd() * 9, 2 + m.rnd() * 2, 'M'); m.disc(40, 34, 2, 'F'); m.disc(58, 25, 1.5, 'F'); m.disc(22, 40, 2, 'F'); });
  m.woods(16, 43, 4); m.woods(44, 40, 4); m.woods(96, 40, 4); m.woods(126, 44, 5);
  m.sow(50, 4, 8, 76, 46, '+'); m.sow(20, 30, 62, 106, 66, 'R');
  // behind the gate: the village round the HQ, a trench facing the foot of the goat path
  for (const [x, y, w, h] of [[104, 20, 5, 4], [122, 18, 5, 4], [124, 32, 5, 4], [108, 34, 4, 3], [116, 38, 5, 3], [129, 25, 4, 4]]) m.house(x, y, w, h);
  m.line(99, 42, 113, 42, 'T');
  save('hot-gates', 'The Hot Gates', m,
    [{ x: 114, y: 26 }, { x: 5, y: 22 }, { x: 5, y: 36 }, { x: 50, y: 64 }],
    [{ x: 86, y: 12, vp: 2, mp: 1.5 }, { x: 118, y: 30, mp: 1 }, { x: 106, y: 45, mp: 1 }, { x: 48, y: 22, mp: 0.5 }]);
}

// Bastogne: the town in the middle of the map and the Horde on five roads at once. A ring of foxholes and sandbags
// round the town, a village with a capture point out on each road (inside the AI defenders' 70 m), roadblocks that
// send vehicles into the fields, woods and low rises between the roads.
{
  const W = 120, C = 60, m = canvas(W, W, 1944), roads = [-90, -18, 54, 126, 198];
  const rises = roads.map(a => polar(C, C, a + 36, 30));
  m.heights((x, y) => (rises.some(([rx, ry]) => Math.hypot(x - rx, y - ry) <= 8) ? 1 : 0));
  for (const a of roads) m.road(...polar(C, C, a, 55), C, C);
  for (let gx = -12; gx <= 12; gx += 6) for (let gy = -12; gy <= 12; gy += 6) if (Math.hypot(gx, gy) >= 8) m.house(C + gx, C + gy, 4, 3); // the square stays open
  m.soft(() => { for (let a = 0; a < 360; a++) { if (a % 30 < 25) m.set(...polar(C, C, a, 20), 'T'); if (a % 20 < 8) m.set(...polar(C, C, a, 23), '#'); } });
  const points = [{ x: C, y: C + 3, vp: 2, mp: 1.5 }];
  for (const a of roads) {
    for (let t = a - 4; t <= a + 4; t++) m.set(...polar(C, C, t, 27), 'Y');
    m.house(...polar(C, C, a - 9, 36), 4, 3); m.house(...polar(C, C, a + 9, 36), 4, 3); m.house(...polar(C, C, a + 7, 42), 4, 3);
    const [x, y] = polar(C, C, a, 35); points.push({ x, y, mp: 1 });
    m.woods(...polar(C, C, a + 36, 44), 9, 0.6); m.woods(...polar(C, C, a + 18, 52), 5, 0.6); m.woods(...polar(C, C, a + 54, 52), 5, 0.6);
  }
  m.sow(80, 4, 4, W - 5, W - 5, '+');
  save('bastogne', 'Bastogne', m,
    [{ x: C, y: C - 2, assault: true }, ...roads.map(a => { const [x, y] = polar(C, C, a, 55); return { x, y }; })], points);
}
