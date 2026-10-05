// Generates the map pack: node tools/genmap-pack.js
// Assault maps put the defenders on `defend` spawns, and their capture points on the defenders' side or in the
// middle: attackers start with base income only and earn more by taking ground. Two-sided conquest maps are drawn with sym = true,
// which mirrors every cell through the map center, so both sides get exactly the same ground.
import { writeFileSync } from 'node:fs';
import { validateMap, levelChar } from '../shared/sim.js';

function canvas(W, H, sym = false, seed = 1) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const hgt = Array.from({ length: H }, () => Array(W).fill(0));
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const m = {
    W, H, g, hgt,
    rnd: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    set(x, y, ch) { x = Math.round(x); y = Math.round(y); if (!inb(x, y)) return; g[y][x] = ch; if (sym) g[H - 1 - y][W - 1 - x] = ch; },
    lv(x, y, l) { x = Math.round(x); y = Math.round(y); if (!inb(x, y)) return; hgt[y][x] = l; if (sym) hgt[H - 1 - y][W - 1 - x] = l; },
    at: (x, y) => (inb(x, y) ? g[y][x] : null),
    rect(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.set(x, y, ch); },
    box(cx, cy, w, h, ch) { m.rect(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(cx - w / 2) + w - 1, Math.round(cy - h / 2) + h - 1, ch); },
    line(x0, y0, x1, y1, ch, width = 1) {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) || 1, d = Math.hypot(x1 - x0, y1 - y0) || 1, ox = -(y1 - y0) / d, oy = (x1 - x0) / d;
      for (let i = 0; i <= n; i++) for (let k = 0; k < width; k++) {
        const s = k - (width - 1) / 2;
        m.set(x0 + (x1 - x0) * i / n + ox * s, y0 + (y1 - y0) * i / n + oy * s, ch);
      }
    },
    disc(cx, cy, r, ch) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r) m.set(x, y, ch); },
    // a patch of woods: hedge cells (block sight, walkable), thinned so squads can move through
    woods(cx, cy, r, fill = 0.7) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r && m.at(x, y) === '.' && m.rnd() < fill) m.set(x, y, 'H'); },
    heights(fn) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y][x] = fn(x, y); },
  };
  return m;
}
const polar = (C, deg, r) => [C + r * Math.cos(deg * Math.PI / 180), C + r * Math.sin(deg * Math.PI / 180)];
const round = (p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) });

function save(file, name, m, spawns, points, extra = {}) {
  spawns = spawns.map(round); points = points.map(round);
  // spawns and points sit in a small clearing
  for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const ch = m.at(p.x + x, p.y + y);
    if (ch && ch !== '.' && ch !== 'W' && ch !== '=' && ch !== 'F') m.g[p.y + y][p.x + x] = '.';
  }
  const map = { name, w: m.W, h: m.H, rows: m.g.map(r => r.join('')), heights: m.hgt.map(r => r.map(levelChar).join('')), spawns, points, ...extra };
  const err = validateMap(map);
  if (err) throw new Error(`${file}: ${err}`);
  writeFileSync(new URL(`../maps/${file}.json`, import.meta.url), JSON.stringify(map, null, 1));
  console.log('wrote', file);
}

// ---------- assault ----------

// Pegasus Bridge: defenders hold a town across a river. One stone bridge in the middle, a ford far out on the
// west flank. Blowing the bridge (200 structure hp) cuts the fast route for both sides.
{
  const m = canvas(90, 100, false, 44);
  m.rect(0, 40, 89, 43, 'W');
  m.rect(43, 40, 46, 43, '=');
  m.rect(5, 40, 9, 43, 'F');
  // the town
  for (const [x, y] of [[20, 14], [32, 14], [58, 14], [70, 14], [20, 26], [32, 28], [58, 28], [70, 26]]) m.box(x, y, 6, 4, 'B');
  m.box(45, 13, 6, 5, 'B'); // church
  // bridgehead: trench and sandbags covering the bridge, hedges along the north bank
  m.line(33, 34, 41, 34, 'T'); m.line(49, 34, 57, 34, 'T');
  m.line(38, 37, 42, 37, '#'); m.line(48, 37, 52, 37, '#');
  m.line(4, 36, 28, 36, 'H'); m.line(62, 36, 86, 36, 'H');
  // south bank: fields, farms, woods, shelled ground
  m.line(0, 56, 34, 56, 'H'); m.line(56, 56, 89, 56, 'H');
  m.box(20, 70, 6, 4, 'B'); m.box(70, 70, 6, 4, 'B');
  m.woods(45, 62, 5); m.woods(12, 82, 4); m.woods(78, 82, 4);
  for (let i = 0; i < 40; i++) m.set(m.rnd() * 90, 46 + m.rnd() * 40, '+');
  save('pegasus-bridge', 'Pegasus Bridge', m,
    [{ x: 28, y: 5 }, { x: 62, y: 5 }, { x: 28, y: 94 }, { x: 62, y: 94 }],
    [{ x: 45, y: 22, vp: 2, mp: 1.5 }, { x: 45, y: 41, mp: 1 }, { x: 14, y: 30, mp: 1 }, { x: 76, y: 30, mp: 1 }, { x: 45, y: 52, mp: 1 }, { x: 20, y: 63, mp: 0.5 }, { x: 70, y: 63, mp: 0.5 }],
    { defend: [0, 1] });
}

// Bocage: small fields boxed in by hedgerows, one gap per side. Short sight lines, grenades and MGs.
// The defenders hold a farm at the north end. Tanks can crush hedges to make their own gaps.
{
  const m = canvas(96, 96, false, 1944);
  const xs = [0, 16, 32, 48, 64, 80, 95], ys = [18, 34, 50, 66, 80];
  for (const y of ys) for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], gap = m.rnd() < 0.5 ? a + 2 : b - 5;
    for (let x = a; x <= b; x++) if (x < gap || x > gap + 2) m.set(x, y, 'H');
  }
  for (const x of xs.slice(1, -1)) for (let i = 0; i < ys.length - 1; i++) {
    const a = ys[i], b = ys[i + 1], gap = m.rnd() < 0.5 ? a + 2 : b - 5;
    for (let y = a; y <= b; y++) if (y < gap || y > gap + 2) m.set(x, y, 'H');
  }
  m.box(48, 10, 8, 5, 'B'); m.box(40, 12, 3, 3, 'B'); m.box(56, 12, 3, 3, 'B');
  // hamlets and sunken-lane walls here and there
  for (const [x, y] of [[24, 42], [72, 42], [40, 58], [56, 74], [24, 74], [72, 58]]) m.box(x + 4, y - 3, 4, 3, 'B');
  for (let i = 0; i < 12; i++) { const x = 4 + m.rnd() * 88, y = 22 + m.rnd() * 54; m.line(x, y, x + 4, y, '#'); }
  for (let i = 0; i < 30; i++) m.set(m.rnd() * 96, 20 + m.rnd() * 60, '+');
  save('bocage', 'Bocage', m,
    [{ x: 36, y: 5 }, { x: 60, y: 5 }, { x: 36, y: 90 }, { x: 60, y: 90 }],
    [{ x: 48, y: 26, vp: 2, mp: 1.5 }, { x: 24, y: 42 }, { x: 72, y: 42 }, { x: 48, y: 58 }, { x: 48, y: 72 }, { x: 24, y: 72, mp: 1.5 }, { x: 72, y: 72, mp: 1.5 }],
    { defend: [0, 1] });
}

// Seawall: the attackers land on a long open beach two levels below the sea front; a cliff runs the whole way
// along, with two ramps up. The defenders' town sits right behind the cliff, so they hold the ramp tops.
{
  const m = canvas(80, 90, false, 606);
  const ramp = (x) => (x >= 16 && x <= 22) || (x >= 57 && x <= 63);
  m.heights((x, y) => (y <= 42 ? 1 : ramp(x) && y === 43 ? 0 : ramp(x) && y === 44 ? -1 : -2));
  m.rect(0, 87, 79, 89, 'W');
  for (let i = 0; i < 18; i++) m.set(m.rnd() * 80, 50 + m.rnd() * 34, '#'); // hedgehogs: the beach is mostly open
  for (let i = 0; i < 20; i++) m.set(m.rnd() * 80, 47 + m.rnd() * 39, '+');
  for (let x = 3; x <= 76; x++) if (x % 11 > 1) m.set(x, 39, 'T');
  m.line(12, 41, 15, 41, '#'); m.line(23, 41, 26, 41, '#'); m.line(53, 41, 56, 41, '#'); m.line(64, 41, 67, 41, '#');
  for (const [x, y] of [[16, 12], [30, 10], [50, 10], [64, 12], [34, 19], [46, 19]]) m.box(x, y, 5, 4, 'B');
  m.woods(6, 28, 3); m.woods(74, 28, 3);
  save('seawall', 'Seawall', m,
    [{ x: 28, y: 4 }, { x: 52, y: 4 }, { x: 25, y: 80 }, { x: 55, y: 80 }],
    [{ x: 40, y: 14, vp: 2, mp: 1.5 }, { x: 19, y: 36, mp: 1 }, { x: 60, y: 36, mp: 1 }, { x: 40, y: 64, mp: 1 }, { x: 12, y: 70, mp: 1 }, { x: 68, y: 70, mp: 1 }],
    { defend: [0, 1] });
}

// Monte Cassino: a monastery on the summit. Three tiers (0, 2, 4) with cliffs between them and one ramp per
// cliff, on opposite sides, so the climb zigzags: up the west ramp, across the middle terrace, up the east ramp.
{
  const m = canvas(90, 110, false, 1944);
  m.heights((x, y) => {
    if (x >= 68 && x <= 74 && y >= 29 && y <= 32) return 3;
    if (x >= 14 && x <= 20 && y >= 59 && y <= 62) return 1;
    return y <= 30 ? 4 : y <= 60 ? 2 : 0;
  });
  // the monastery: walls with gates, a long hall, two wings, a courtyard
  m.line(30, 6, 60, 6, '#'); m.line(30, 26, 42, 26, '#'); m.line(48, 26, 60, 26, '#');
  m.line(30, 6, 30, 13, '#'); m.line(30, 18, 30, 26, '#'); m.line(60, 6, 60, 13, '#'); m.line(60, 18, 60, 26, '#');
  m.box(45, 10, 20, 4, 'B'); m.box(35, 20, 4, 6, 'B'); m.box(55, 20, 4, 6, 'B');
  // middle terrace: a hamlet, olive terraces (hedges), ruins
  for (const [x, y] of [[26, 42], [34, 40], [30, 50]]) m.box(x, y, 4, 3, 'B');
  for (let y = 36; y <= 56; y += 5) { m.line(44, y, 58, y, 'H'); }
  for (let i = 0; i < 25; i++) m.set(m.rnd() * 90, 33 + m.rnd() * 26, i % 3 ? '+' : 'R');
  // the town at the foot, half ruined
  for (let bx = 20; bx <= 70; bx += 10) for (let by = 70; by <= 92; by += 9) m.box(bx, by, 5, 4, m.rnd() < 0.3 ? 'R' : 'B');
  for (let i = 0; i < 30; i++) m.set(m.rnd() * 90, 64 + m.rnd() * 36, '+');
  save('monte-cassino', 'Monte Cassino', m,
    [{ x: 18, y: 10 }, { x: 72, y: 10 }, { x: 30, y: 104 }, { x: 60, y: 104 }],
    [{ x: 45, y: 18, vp: 2, mp: 1.5 }, { x: 30, y: 46 }, { x: 70, y: 46 }, { x: 45, y: 66 }],
    { defend: [0, 1] });
}

// Stalingrad Factory: the defenders hold a walled factory in the middle of a ruined city; the attackers
// come from three sides through the blocks. Almost everything is a building to garrison or knock down.
{
  const m = canvas(100, 100, false, 1942);
  const fx0 = 32, fy0 = 36, fx1 = 67, fy1 = 63;
  for (let bx = 3; bx < 97; bx += 17) for (let by = 3; by < 97; by += 17) {
    if (bx + 14 > fx0 - 3 && bx < fx1 + 3 && by + 14 > fy0 - 3 && by < fy1 + 3) continue;
    // each block: four houses (some already rubble), a courtyard in the middle
    for (const [qx, qy] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
      const r = m.rnd();
      if (r < 0.15) continue;
      m.rect(bx + qx, by + qy, bx + qx + 5, by + qy + 5, r < 0.4 ? 'R' : 'B');
    }
  }
  // the factory: wall with a gate on each side, two big halls, sheds, a yard
  for (let x = fx0; x <= fx1; x++) if (Math.abs(x - 49.5) > 2.5) { m.set(x, fy0, '#'); m.set(x, fy1, '#'); }
  for (let y = fy0; y <= fy1; y++) if (Math.abs(y - 49.5) > 2.5) { m.set(fx0, y, '#'); m.set(fx1, y, '#'); }
  m.rect(35, 39, 46, 45, 'B'); m.rect(53, 39, 64, 45, 'B');
  m.rect(35, 56, 39, 60, 'B'); m.rect(60, 56, 64, 60, 'B');
  for (let i = 0; i < 15; i++) m.set(fx0 + 2 + m.rnd() * 32, fy0 + 11 + m.rnd() * 14, i % 2 ? 'R' : '+');
  // the factory spawn is Assault-only (the defender holds it); every other mode uses the four edges, N E S W
  save('stalingrad-factory', 'Stalingrad Factory', m,
    [{ x: 50, y: 58, assault: true }, { x: 50, y: 1 }, { x: 98, y: 50 }, { x: 50, y: 98 }, { x: 1, y: 50 }],
    [{ x: 50, y: 50, vp: 2, mp: 1.5 }, { x: 30, y: 30 }, { x: 69, y: 30 }, { x: 30, y: 69 }, { x: 69, y: 69 }],
    { defend: [0] });
}

// Kasserine Pass: XL, for 3v3. A cliff-sided mountain wall across the whole map with one winding pass through it,
// the only way from the attackers' valley (south) to the defenders' (north). Cliffs can't be blown, so the route
// never closes. Each mouth of the pass has two overwatch ledges (level 2, cliffs on the pass side) reached by a
// ramp from that side's valley: defenders hold the north ledges, attackers the south ones.
{
  const W = 160, H = 200, m = canvas(W, H, false, 1943);
  const y0 = 88, y1 = 114, px = (y) => 80 + 6 * Math.sin((y - y0) / 8), half = 9;
  const ledge = (x, y) => { const d = Math.abs(x - px(y)); return d > half && d <= half + 8; };
  m.heights((x, y) => {
    const wall = y >= y0 + Math.round(1.5 * Math.sin(x / 6)) * (Math.abs(x - 80) > 25 ? 1 : 0) && y <= y1 - Math.round(1.5 * Math.sin(x / 5 + 1)) * (Math.abs(x - 80) > 25 ? 1 : 0);
    if (Math.abs(x - px(y)) <= half && y >= y0 - 2 && y <= y1 + 2) return 0; // the pass
    if (ledge(x, y) && y >= y0 && y <= y0 + 4) return 2; // north ledges
    if (ledge(x, y) && y >= y0 - 2 && y < y0) return 1;  // their ramps
    if (ledge(x, y) && y >= y1 - 4 && y <= y1) return 2; // south ledges
    if (ledge(x, y) && y > y1 && y <= y1 + 2) return 1;
    return wall ? 4 : 0;
  });
  // scrub on the mountains (out of reach, just looks)
  for (let i = 0; i < 40; i++) { const x = m.rnd() * W, y = y0 + 3 + m.rnd() * (y1 - y0 - 6); if (Math.abs(x - px(y)) > half + 10) m.woods(x, y, 2 + m.rnd() * 3, 0.5); }
  // the pass: rubble, roadblocks, an anti-tank ditch half-way, shell holes
  for (let y = y0; y <= y1; y++) for (let x = Math.round(px(y) - half); x <= px(y) + half; x++) if (m.rnd() < 0.06) m.set(x, y, m.rnd() < 0.5 ? '+' : 'R');
  for (let x = Math.round(px(101) - half); x <= px(101) + half; x++) if (Math.abs(x - px(101)) > 2) m.set(x, 101, 'T');
  m.line(px(93) - 6, 93, px(93) - 2, 93, '#'); m.line(px(109) + 2, 109, px(109) + 6, 109, '#');
  // north: the defenders' town, farms, a trench arc covering the mouth of the pass
  for (const [x, y, w, h] of [[66, 26, 6, 5], [94, 26, 6, 5], [72, 38, 5, 4], [88, 38, 5, 4], [80, 20, 8, 4], [30, 40, 5, 4], [130, 40, 5, 4], [50, 60, 5, 4], [110, 60, 5, 4]]) m.box(x, y, w, h, 'B');
  for (let a = 200; a <= 340; a += 1) { if (a % 25 < 4) continue; const [x, y] = polar(80, a, 22); m.set(x, y + 96, 'T'); }
  m.line(56, 64, 70, 70, 'H'); m.line(90, 70, 104, 64, 'H'); m.line(10, 52, 40, 52, 'H'); m.line(120, 52, 150, 52, 'H');
  m.woods(20, 70, 6); m.woods(140, 70, 6); m.woods(40, 20, 4); m.woods(120, 20, 4);
  // south: the attackers' staging ground, villages, woods, shelled fields
  for (const [x, y, w, h] of [[40, 150, 5, 4], [48, 156, 4, 4], [120, 150, 5, 4], [112, 156, 4, 4], [80, 170, 6, 4]]) m.box(x, y, w, h, 'B');
  m.line(20, 140, 55, 136, 'H'); m.line(105, 136, 140, 140, 'H'); m.line(60, 130, 100, 130, '#');
  m.woods(15, 125, 6); m.woods(145, 125, 6); m.woods(80, 145, 5);
  for (let i = 0; i < 60; i++) m.set(m.rnd() * W, 118 + m.rnd() * 70, '+');
  for (let i = 0; i < 30; i++) m.set(m.rnd() * W, 10 + m.rnd() * 75, '+');
  save('kasserine-pass', 'Kasserine Pass', m,
    [{ x: 40, y: 10 }, { x: 80, y: 8 }, { x: 120, y: 10 }, { x: 40, y: 190 }, { x: 80, y: 192 }, { x: 120, y: 190 }],
    [{ x: 80, y: 32, vp: 2, mp: 1.5 }, { x: 40, y: 44, mp: 1.5 }, { x: 120, y: 44, mp: 1.5 }, { x: 80, y: 82, mp: 1 },
      { x: 80, y: 101, mp: 1.5 }, { x: 79, y: 120, mp: 1 }, { x: 40, y: 160, mp: 0.5 }, { x: 120, y: 160, mp: 0.5 }],
    { defend: [0, 1, 2] });
}

// ---------- conquest, two sides (point-symmetric) ----------

// Twin Valleys: a cliff-sided ridge splits the map; two saddle passes cross it and lead up onto the ridge top,
// which overlooks both valleys. Each side's HQ sits at the far end of its own valley.
{
  const m = canvas(100, 80, true, 7);
  m.heights((x, y) => {
    const pass = (y >= 17 && y <= 23) || (y >= 56 && y <= 62);
    if (pass) return x === 42 || x === 57 ? 1 : x >= 43 && x <= 56 ? 2 : 0;
    return x >= 44 && x <= 55 ? 3 : 0;
  });
  for (let i = 0; i < 12; i++) m.set(45 + m.rnd() * 10, m.rnd() * 40, i % 2 ? 'H' : '+');
  m.box(20, 36, 5, 4, 'B'); m.box(27, 43, 4, 4, 'B'); m.box(14, 44, 4, 3, 'B');
  m.line(4, 28, 36, 28, 'H'); m.line(6, 54, 38, 54, 'H');
  m.woods(32, 10, 5); m.woods(8, 64, 4);
  m.line(30, 18, 30, 24, 'T');
  for (let i = 0; i < 16; i++) m.set(m.rnd() * 40, m.rnd() * 80, '+');
  save('twin-valleys', 'Twin Valleys', m,
    [{ x: 20, y: 6 }, { x: 79, y: 6 }, { x: 79, y: 73 }, { x: 20, y: 73 }],
    [{ x: 50, y: 40, vp: 2, mp: 0 }, { x: 50, y: 20 }, { x: 49, y: 59 }, { x: 20, y: 40, mp: 1.5 }, { x: 79, y: 39, mp: 1.5 }]);
}

// Ardennes Crossing: a winding river across the whole map, three bridges and two fords, woods on both banks.
// A capture point on every crossing; bridges can be blown to change the map mid-match.
{
  const m = canvas(100, 100, true, 1944);
  const yc = (x) => 49.5 + 6 * Math.sin((x - 49.5) / 12);
  for (let x = 0; x < 100; x++) for (let y = Math.round(yc(x) - 2); y <= Math.round(yc(x) + 1); y++) m.set(x, y, 'W');
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    if (m.g[y][x] !== 'W') continue;
    if ((x >= 18 && x <= 21) || (x >= 48 && x <= 51)) m.set(x, y, '=');
    else if (x >= 33 && x <= 36) m.set(x, y, 'F');
  }
  for (let i = 0; i < 9; i++) {
    const x = 5 + m.rnd() * 90, y = 12 + m.rnd() * 26;
    if (Math.abs(y - yc(x)) > 8) m.woods(x, y, 3 + m.rnd() * 3, 0.6);
  }
  m.box(12, 16, 4, 4, 'B'); m.box(40, 22, 5, 4, 'B'); m.box(64, 14, 4, 5, 'B');
  for (let i = 0; i < 20; i++) m.set(m.rnd() * 100, m.rnd() * 40, '+');
  const cross = (x) => ({ x, y: Math.round(yc(x) - 0.5) });
  save('ardennes-crossing', 'Ardennes Crossing', m,
    [{ x: 20, y: 6 }, { x: 79, y: 6 }, { x: 79, y: 93 }, { x: 20, y: 93 }],
    [{ ...cross(50), vp: 2, mp: 0 }, cross(20), cross(79), cross(35), cross(64)]);
}

// Crossroads Village: a small, quick 1v1. A village square worth double VP where the roads meet,
// hedged fields and a farm on each side.
{
  const m = canvas(64, 64, true, 3);
  for (const [x, y, w, h] of [[24, 24, 5, 4], [40, 24, 4, 5], [23, 34, 4, 4], [32, 22, 3, 3]]) m.box(x, y, w, h, 'B');
  m.line(4, 20, 18, 20, 'H'); m.line(20, 4, 20, 14, 'H'); m.line(10, 30, 10, 46, 'H');
  m.box(14, 40, 5, 3, 'B'); m.line(8, 50, 18, 50, '#');
  m.line(26, 44, 36, 44, 'T');
  for (let i = 0; i < 10; i++) m.set(m.rnd() * 64, m.rnd() * 32, '+');
  save('crossroads-village', 'Crossroads Village', m,
    [{ x: 6, y: 57 }, { x: 57, y: 6 }],
    [{ x: 32, y: 32, vp: 2, mp: 1 }, { x: 16, y: 34, mp: 1.5 }, { x: 47, y: 29, mp: 1.5 }]);
}

// The Polder: lowland one level down, split by dykes (level 1 with level-0 shoulders). From the fields you
// can't see over a dyke, so the fight is for the dyke crossings. Canals with bridges and fords.
{
  const m = canvas(100, 100, true, 1953);
  const dyke = (v) => (v === 25 || v === 74 || v === 49 || v === 50 ? 1 : v === 24 || v === 26 || v === 73 || v === 75 || v === 48 || v === 51 ? 0 : -1);
  m.heights((x, y) => Math.max(dyke(x), dyke(y)));
  for (const cy of [37, 38]) for (let x = 0; x < 100; x++) m.set(x, cy, 'W');
  for (let x = 0; x < 100; x++) for (const cy of [37, 38]) {
    if (m.hgt[cy][x] >= 0) m.set(x, cy, '='); // the dykes cross the canal on bridges
    else if (x >= 11 && x <= 13) m.set(x, cy, 'F');
    else if (x >= 86 && x <= 88) m.set(x, cy, '=');
  }
  for (const [x, y] of [[12, 16], [36, 12], [14, 32], [38, 44], [62, 16], [88, 30]]) m.box(x, y, 4, 3, 'B');
  m.box(28, 22, 2, 2, 'B'); m.box(71, 28, 2, 2, 'B'); // windmills by the crossings
  for (let i = 0; i < 20; i++) { const x = m.rnd() * 100, y = m.rnd() * 48; if (m.hgt[Math.round(y)]?.[Math.round(x)] === -1) m.set(x, y, 'H'); }
  save('the-polder', 'The Polder', m,
    [{ x: 8, y: 8 }, { x: 91, y: 8 }, { x: 91, y: 91 }, { x: 8, y: 91 }],
    [{ x: 50, y: 50, vp: 2, mp: 0 }, { x: 25, y: 25 }, { x: 74, y: 74 }, { x: 74, y: 25 }, { x: 25, y: 74 }]);
}

// Crater Field: Verdun. Trench lines on both sides, a no man's land of craters and dug-down ground, and a
// flattened village in the middle. Units in trenches are hard to kill: artillery and smoke get you across.
{
  const m = canvas(90, 90, true, 1916);
  for (let x = 3; x <= 86; x++) if (x % 15 > 1) m.set(x, 16 + (Math.floor(x / 5) % 2), 'T');
  for (let x = 8; x <= 82; x++) if (x % 20 < 10) m.set(x, 24, 'T');
  for (let x = 6; x <= 84; x += 7) m.line(x, 28, x + 3, 28, '#'); // sandbag posts
  for (let i = 0; i < 260; i++) m.set(m.rnd() * 90, 30 + m.rnd() * 15, '+');
  for (let i = 0; i < 60; i++) { const x = Math.round(m.rnd() * 89), y = Math.round(32 + m.rnd() * 12); m.lv(x, y, -1); }
  // the village that was
  for (let i = 0; i < 40; i++) m.set(38 + m.rnd() * 14, 38 + m.rnd() * 7, 'R');
  m.box(40, 40, 3, 3, 'B'); m.line(46, 36, 52, 36, '#');
  for (let i = 0; i < 20; i++) m.set(m.rnd() * 90, m.rnd() * 14, '+');
  save('crater-field', 'Crater Field', m,
    [{ x: 25, y: 5 }, { x: 64, y: 5 }, { x: 64, y: 84 }, { x: 25, y: 84 }],
    [{ x: 45, y: 45, vp: 2, mp: 1 }, { x: 18, y: 42, mp: 1.5 }, { x: 71, y: 47, mp: 1.5 }, { x: 45, y: 20 }, { x: 44, y: 69 }]);
}

// ---------- conquest, up to six (rotational) ----------

// King of the Hill: one big hill in the middle (gentle steps, walkable from every side) with a ruined chapel on
// top worth triple VP. A village between each pair of HQs pays the manpower.
{
  const W = 130, C = 65, m = canvas(W, W, false, 6);
  m.heights((x, y) => { const r = Math.hypot(x - C, y - C); return r < 8 ? 4 : r < 14 ? 3 : r < 20 ? 2 : r < 26 ? 1 : 0; });
  for (let a = 0; a < 360; a += 30) { const [x, y] = polar(C, a, 5); m.set(x, y, a % 60 ? '#' : 'R'); }
  const bits = Array.from({ length: 10 }, () => [m.rnd() * 60, 12 + m.rnd() * 40]);
  const spawns = [], points = [{ x: C, y: C, vp: 3, mp: 0 }];
  for (let k = 0; k < 6; k++) {
    const a = -90 + 60 * k, v = a + 30;
    const [sx, sy] = polar(C, a, 58); spawns.push({ x: sx, y: sy });
    const [vx, vy] = polar(C, v, 42); points.push({ x: vx, y: vy, mp: 1.5 });
    m.box(...polar(C, v - 6, 44), 4, 3, 'B'); m.box(...polar(C, v + 6, 44), 3, 4, 'B'); m.box(...polar(C, v, 48), 4, 4, 'B');
    for (let t = a - 20; t <= a + 20; t += 1) if (Math.abs(t - a) > 5) m.set(...polar(C, t, 32), 'H');
    for (const [da, r] of bits) m.set(...polar(C, a + da, r), r < 26 ? '+' : 'H');
  }
  save('king-of-the-hill', 'King of the Hill', m, spawns, points);
}

// Island Towns: six islands around a central one. Long bridges to the middle, fords between neighbours.
// Tanks are slow in the fords and a blown bridge strands the middle, so it's an infantry map.
{
  const W = 140, C = 70, m = canvas(W, W, false, 12);
  m.rect(0, 0, W - 1, W - 1, 'W');
  m.disc(C, C, 12, '.');
  const spawns = [], points = [{ x: C, y: C, vp: 2, mp: 0 }];
  for (let k = 0; k < 6; k++) {
    const a = -90 + 60 * k, [ix, iy] = polar(C, a, 46);
    m.disc(ix, iy, 13, '.');
  }
  for (let k = 0; k < 6; k++) {
    const a = -90 + 60 * k, [ix, iy] = polar(C, a, 46), [nx, ny] = polar(C, a + 60, 46);
    const onWater = (ch) => (x, y) => { if (m.at(Math.round(x), Math.round(y)) === 'W') m.set(x, y, ch); };
    for (let r = 10; r <= 36; r += 0.3) for (let s = -1.5; s <= 1.5; s += 0.5) { const [x, y] = polar(C, a, r), d = (a + 90) * Math.PI / 180; onWater('=')(x + Math.cos(d) * s, y + Math.sin(d) * s); }
    const n = Math.hypot(nx - ix, ny - iy), ux = (nx - ix) / n, uy = (ny - iy) / n;
    for (let t = 0; t <= n; t += 0.3) for (let s = -1.5; s <= 1.5; s += 0.5) onWater('F')(ix + ux * t - uy * s, iy + uy * t + ux * s);
    const [px, py] = polar(C, a, 40); points.push({ x: px, y: py, mp: 1.5 });
    m.box(...polar(C, a - 12, 44), 4, 3, 'B'); m.box(...polar(C, a + 12, 44), 3, 4, 'B'); m.box(...polar(C, a, 37), 4, 3, 'B');
    const [sx, sy] = polar(C, a, 54); spawns.push({ x: sx, y: sy });
  }
  m.box(C - 5, C - 5, 3, 3, 'B'); m.box(C + 5, C + 5, 3, 3, 'B');
  save('island-towns', 'Island Towns', m, spawns, points);
}
