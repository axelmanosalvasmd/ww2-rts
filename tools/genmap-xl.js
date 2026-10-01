// Generates the XL assault maps: node tools/genmap-xl.js
// Bigger takes on Pegasus Bridge, Hill 112 and Seawall for up to 6 players (3 defenders vs 3 attackers in Assault).
// Spawns are listed around the map (defenders left to right, then attackers right to left), so in Conquest teammates
// get neighbouring spawns. The extra room adds routes, not just ground: two bridges, three ramps.
import { writeFileSync } from 'node:fs';
import { validateMap, levelChar } from '../shared/sim.js';

function canvas(W, H, seed) {
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const hgt = Array.from({ length: H }, () => Array(W).fill(0));
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const m = {
    W, H, g, hgt,
    rnd: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    set(x, y, ch) { x = Math.round(x); y = Math.round(y); if (inb(x, y)) g[y][x] = ch; },
    at: (x, y) => (inb(x, y) ? g[y][x] : null),
    rect(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.set(x, y, ch); },
    box(cx, cy, w, h, ch) { m.rect(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(cx - w / 2) + w - 1, Math.round(cy - h / 2) + h - 1, ch); },
    line(x0, y0, x1, y1, ch) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) || 1; for (let i = 0; i <= n; i++) m.set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, ch); },
    woods(cx, cy, r, fill = 0.7) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r && m.at(x, y) === '.' && m.rnd() < fill) m.set(x, y, 'H'); },
    heights(fn) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hgt[y][x] = fn(x, y); },
  };
  return m;
}

function save(file, name, m, spawns, points, extra = {}) {
  // spawns and points sit in a small clearing
  for (const p of [...spawns, ...points]) for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const ch = m.at(p.x + x, p.y + y);
    if (ch && ch !== '.' && ch !== 'W' && ch !== '=' && ch !== 'F') m.g[p.y + y][p.x + x] = '.';
  }
  const map = { name, w: m.W, h: m.H, rows: m.g.map(r => r.join('')), heights: m.hgt.map(r => r.map(levelChar).join('')), spawns, points, defend: [0, 1, 2], ...extra };
  const err = validateMap(map);
  if (err) throw new Error(`${file}: ${err}`);
  writeFileSync(new URL(`../maps/${file}.json`, import.meta.url), JSON.stringify(map, null, 1));
  console.log('wrote', file, `${m.W}x${m.H}`);
}

// Pegasus Bridge XL: the town is twice as wide, the river has two stone bridges (each can be blown) and a ford at
// each flank plus a center ford, so attackers can split the defence instead of queueing on one bridge.
{
  const m = canvas(140, 150, 4400);
  m.rect(0, 62, 139, 66, 'W');
  m.rect(44, 62, 48, 66, '='); m.rect(92, 62, 96, 66, '=');
  m.rect(4, 62, 10, 66, 'F'); m.rect(129, 62, 135, 66, 'F'); m.rect(67, 62, 73, 66, 'F'); // flank fords and a center ford
  // the town: two blocks either side of the church square, farms out on the flanks
  for (const [x, y] of [[22, 18], [36, 18], [104, 18], [118, 18], [22, 32], [36, 34], [104, 34], [118, 32], [56, 40], [84, 40]]) m.box(x, y, 6, 4, 'B');
  m.box(70, 17, 7, 6, 'B'); // church
  m.box(12, 48, 6, 4, 'B'); m.box(128, 48, 6, 4, 'B');
  // bridgeheads: trenches and sandbags covering both bridges, hedges along the north bank
  for (const bx of [46, 94]) { m.line(bx - 11, 55, bx - 6, 55, 'T'); m.line(bx + 6, 55, bx + 11, 55, 'T'); }
  m.line(14, 58, 30, 58, 'H'); m.line(62, 58, 78, 58, 'H'); m.line(110, 58, 126, 58, 'H');
  // south bank: hedged fields, farms, woods and shelled ground to cross
  m.line(0, 82, 36, 82, 'H'); m.line(56, 82, 84, 82, 'H'); m.line(104, 82, 139, 82, 'H');
  m.box(24, 104, 6, 4, 'B'); m.box(70, 96, 6, 4, 'B'); m.box(116, 104, 6, 4, 'B');
  m.woods(70, 76, 6); m.woods(14, 122, 5); m.woods(126, 122, 5); m.woods(46, 116, 4); m.woods(94, 116, 4);
  for (let i = 0; i < 90; i++) m.set(m.rnd() * 140, 70 + m.rnd() * 62, '+');
  save('pegasus-bridge-xl', 'Pegasus Bridge XL', m,
    [{ x: 34, y: 6 }, { x: 70, y: 6 }, { x: 106, y: 6 }, { x: 110, y: 143 }, { x: 70, y: 143 }, { x: 30, y: 143 }],
    [{ x: 70, y: 28, vp: 2, mp: 1.5 }, { x: 46, y: 64, mp: 1 }, { x: 94, y: 64, mp: 1 }, { x: 20, y: 42, mp: 1 }, { x: 120, y: 42, mp: 1 },
      { x: 70, y: 70, mp: 1 }, { x: 30, y: 92, mp: 0.5 }, { x: 110, y: 92, mp: 0.5 }],
    { assaultTime: 1200 }); // 20 min: at 15 the attackers mostly ran out of time on the way
}

// Hill 112 XL: the same terraced climb on a wider hill. The upper escarpment (a two-level cliff) is broken by three
// ramps instead of one, plus goat paths at both edges, so three attackers have three ways up.
{
  const W = 120, H = 160, m = canvas(W, H, 1120);
  const edge = (y0, x, k) => y0 + 3.5 * Math.sin(x / 9 + k) + 2 * Math.sin(x / 4.1 + 2 * k);
  const ramp = (x) => x < 8 || x > W - 9 || Math.abs(x - 60) <= 10 || Math.abs(x - 26) <= 7 || Math.abs(x - 94) <= 7;
  m.heights((x, y) => {
    const L = y < edge(44, x, 0) ? 4 : y < edge(66, x, 1) ? 3 : y < edge(88, x, 2) ? 2 : y < edge(110, x, 3) ? 1 : 0;
    return L === 3 && !ramp(x) ? 2 : L; // escarpment: level 3 only exists on the ramps and goat paths
  });
  for (let i = 0; i < 140; i++) m.set(5 + m.rnd() * 110, 40 + m.rnd() * 90, '+'); // the slope has been shelled for days
  // defenders: farms and a stone wall along the crest, trenches overlooking each ramp
  m.box(18, 22, 5, 4, 'B'); m.box(102, 22, 5, 4, 'B'); m.box(60, 6, 7, 4, 'B'); m.box(40, 16, 5, 4, 'B'); m.box(80, 16, 5, 4, 'B');
  m.line(8, 38, 16, 39, '#'); m.line(36, 39, 46, 40, '#'); m.line(74, 40, 84, 39, '#'); m.line(104, 39, 112, 38, '#');
  for (const rx of [26, 60, 94]) { m.line(rx - 10, 42, rx - 6, 42, 'T'); m.line(rx + 6, 42, rx + 10, 42, 'T'); }
  // middle terrace: a hamlet on the central ramp, hedges along the terrace edges
  m.box(52, 74, 4, 3, 'B'); m.box(68, 74, 4, 3, 'B'); m.box(60, 81, 3, 3, 'B'); m.box(26, 78, 4, 3, 'B'); m.box(94, 78, 4, 3, 'B');
  m.line(4, 86, 18, 85, 'H'); m.line(36, 86, 50, 86, 'H'); m.line(70, 86, 84, 86, 'H'); m.line(102, 85, 116, 86, 'H');
  // lower slope: orchards and farms to advance through
  m.box(20, 118, 5, 4, 'B'); m.box(60, 122, 5, 4, 'B'); m.box(100, 118, 5, 4, 'B');
  for (const x of [10, 38, 82, 110]) m.line(x, 96, x, 108, 'H');
  m.line(40, 132, 80, 132, '#');
  save('hill-112-xl', 'Hill 112 XL', m,
    [{ x: 34, y: 10 }, { x: 60, y: 14 }, { x: 86, y: 10 }, { x: 94, y: 150 }, { x: 60, y: 152 }, { x: 26, y: 150 }],
    [{ x: 60, y: 22, vp: 2, mp: 1.5 }, { x: 60, y: 74, vp: 1, mp: 2 }, { x: 26, y: 70, vp: 1, mp: 1.5 }, { x: 94, y: 70, vp: 1, mp: 1.5 },
      { x: 24, y: 104, vp: 1, mp: 2 }, { x: 96, y: 104, vp: 1, mp: 2 }],
    { assaultTime: 960 }); // 16 min: attackers won 45% over 40 AI 3v3s (10% at 15 min, 80% at 20)
}

// Seawall XL: a long beach two levels below the sea front, the cliff the whole way along, now with three ramps.
// The defenders' town sits right behind the cliff and holds the ramp tops.
{
  const m = canvas(130, 140, 6060);
  const ramp = (x) => Math.abs(x - 24) <= 3 || Math.abs(x - 65) <= 3 || Math.abs(x - 106) <= 3;
  m.heights((x, y) => (y <= 64 ? 1 : ramp(x) && y === 65 ? 0 : ramp(x) && y === 66 ? -1 : -2));
  m.rect(0, 136, 129, 139, 'W');
  for (let i = 0; i < 34; i++) m.set(m.rnd() * 130, 74 + m.rnd() * 56, '#'); // hedgehogs: the beach is mostly open
  for (let i = 0; i < 40; i++) m.set(m.rnd() * 130, 70 + m.rnd() * 62, '+');
  for (let x = 3; x <= 126; x++) if (x % 13 > 1) m.set(x, 60, 'T');
  for (const rx of [24, 65, 106]) { m.line(rx - 10, 63, rx - 5, 63, '#'); m.line(rx + 5, 63, rx + 10, 63, '#'); m.line(rx - 6, 57, rx + 6, 57, 'T'); } // ramp tops: a trench across each
  for (const [x, y] of [[20, 18], [42, 14], [65, 22], [88, 14], [110, 18], [32, 32], [54, 34], [76, 34], [98, 32], [65, 6]]) m.box(x, y, 5, 4, 'B');
  m.woods(6, 44, 4); m.woods(124, 44, 4); m.woods(65, 48, 3);
  save('seawall-xl', 'Seawall XL', m,
    // defenders' HQs right behind the town, within reach of the ramp tops (the AI only defends near home)
    [{ x: 30, y: 26 }, { x: 65, y: 28 }, { x: 100, y: 26 }, { x: 104, y: 126 }, { x: 65, y: 128 }, { x: 26, y: 126 }],
    [{ x: 65, y: 26, vp: 2, mp: 1.5 }, { x: 24, y: 56, mp: 1 }, { x: 65, y: 56, mp: 1 }, { x: 106, y: 56, mp: 1 },
      { x: 40, y: 100, mp: 0.5 }, { x: 90, y: 100, mp: 0.5 }]);
}
