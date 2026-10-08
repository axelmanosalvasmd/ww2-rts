// Painted ground. Each cell picks a main and a secondary ground material (grass with dirt patches, mud by the water,
// a road, a field). Every pixel blends the materials of the four nearest cells with a little noise warp, so ordinary
// materials meet in a soft edge. Shell holes, rubble and burnt ground are not the cell's material: a scar is laid
// over the grass or dirt, strongest at the impact and ragged at the rim, so a bombed block is one torn patch.
// Contour lines, shell holes and trench cuts are drawn on top.
// When cells change mid-match only the 4x4-cell tiles around them are repainted and sent to the GPU.
import * as THREE from 'three';
import { levelOf, CELL, startState } from '../shared/sim.js';
import { gfx } from './gfx.js';

// material ids; FIELD_V is the ploughed field turned 90 degrees
const GRASS = 0, DIRT = 1, MUD = 2, FIELD = 3, ROAD = 4, WATER = 5, RUBBLE = 6, SHELL = 7, EARTH = 8, FIELD_V = 9, NMAT = 10;
// texture, metres per repeat, color multiplier (sRGB), saturation, contrast, flat color (texture average) used until the textures load
const LOOK = [
  { tex: 'grass', m: 9, mul: [1.02, 1.06, 1.35], sat: 0.78, con: 0.9, avg: [107, 103, 44] },
  { tex: 'dirt', m: 8, mul: [0.95, 1, 1.04], sat: 0.5, avg: [160, 117, 72] },
  { tex: 'mud', m: 7, mul: [1, 1, 1], sat: 0.72, avg: [87, 64, 43] },
  { tex: 'field', m: 10, mul: [0.95, 0.95, 1], sat: 0.5, con: 0.55, avg: [103, 70, 44] },
  { tex: 'road', m: 8, mul: [0.9, 0.9, 0.88], sat: 0.62, avg: [162, 136, 109] },
  { tex: 'water', m: 12, mul: [0.95, 1, 1.08], sat: 1, avg: [57, 83, 82] },
  { tex: 'rubble', m: 6, mul: [0.92, 0.92, 0.92], sat: 0.7, avg: [135, 105, 86] },
  { tex: 'shelled', m: 7, mul: [1, 1, 1], sat: 0.72, avg: [81, 63, 53] },
  { tex: 'earth', m: 5, mul: [1.1, 1.1, 1.1], sat: 0.75, avg: [69, 49, 34] },
];
// World Conquest region looks (BIOMES order, shared/world-layers.js): a ground tint (multiplier, blended over about
// a dozen cells across a border), the soil that shows through the grass, how much open ground is ploughed, and the
// scenery mix client/props.js reads (tree, pine, bush, rock, grass and haystack weights; orchards; reeds; dry grass).
export const BIOME_LOOKS = [
  { name: 'farmland', tint: [1.02, 1.03, 0.9], soil: DIRT, bare: 0.08, fields: 0.5, trees: 0.7, pine: 0.12, bush: 1.2, rocks: 0.5, grass: 1, hay: 1 },
  { name: 'pine', tint: [0.78, 0.9, 0.86], soil: MUD, bare: 0.12, fields: 0.03, trees: 3, pine: 0.92, bush: 0.7, rocks: 1.5, grass: 0.6, hay: 0 },
  { name: 'marsh', tint: [0.84, 0.94, 0.82], soil: MUD, bare: 0.22, fields: 0.02, trees: 0.45, pine: 0, bush: 1.6, rocks: 0.1, grass: 2.6, hay: 0, reeds: true },
  { name: 'highland', tint: [1.04, 0.96, 0.84], soil: DIRT, bare: 0.24, fields: 0.05, trees: 0.5, pine: 0.75, bush: 0.6, rocks: 9, grass: 0.9, hay: 0 },
  { name: 'orchard', tint: [0.96, 1.08, 0.86], soil: DIRT, bare: 0, fields: 0.18, trees: 0.8, pine: 0.05, bush: 1, rocks: 0.3, grass: 1.4, hay: 0.4, orchard: true },
  { name: 'steppe', tint: [1.26, 1.1, 0.7], soil: DIRT, bare: 0.2, fields: 0.28, trees: 0.15, pine: 0.2, bush: 0.45, rocks: 0.8, grass: 2, hay: 0.6, dry: true },
];
const TILE = 4; // cells per repaint tile
const WARP = 0.32; // how far (in cells) the blend edges wander
const FOAM = [184, 178, 146];

// stable pseudo-random per cell (same formula as main.js)
const rnd = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };

// ---------- noise: one periodic 512x512 fBm table, plus an equalized copy for patch thresholds ----------
const NS = 512, NM = 511;
let NA = null, NP = null; // NA in [-1, 1], NP uniform in [0, 1]
function buildNoise() {
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  NA = new Float32Array(NS * NS);
  let amp = 1;
  for (let o = 0; o < 6; o++, amp *= 0.55) {
    const g = 4 << o, step = NS / g, lat = new Float32Array(g * g);
    for (let i = 0; i < lat.length; i++) lat[i] = rand() * 2 - 1;
    for (let y = 0; y < NS; y++) {
      const fy = y / step, yi = Math.floor(fy), ty = fy - yi, sy = ty * ty * (3 - 2 * ty), r0 = yi * g, r1 = ((yi + 1) % g) * g;
      for (let x = 0; x < NS; x++) {
        const fx = x / step, xi = Math.floor(fx), tx = fx - xi, sx = tx * tx * (3 - 2 * tx), x1 = (xi + 1) % g;
        const top = lat[r0 + xi] + (lat[r0 + x1] - lat[r0 + xi]) * sx, bot = lat[r1 + xi] + (lat[r1 + x1] - lat[r1 + xi]) * sx;
        NA[y * NS + x] += amp * (top + (bot - top) * sy);
      }
    }
  }
  let mx = 0;
  for (let i = 0; i < NA.length; i++) mx = Math.max(mx, Math.abs(NA[i]));
  for (let i = 0; i < NA.length; i++) NA[i] /= mx;
  // histogram equalization, so "noise below amt" covers about amt of the ground
  const BINS = 2048, hist = new Float32Array(BINS);
  for (let i = 0; i < NA.length; i++) hist[Math.min(BINS - 1, ((NA[i] + 1) / 2 * BINS) | 0)]++;
  for (let i = 1; i < BINS; i++) hist[i] += hist[i - 1];
  NP = new Float32Array(NS * NS);
  for (let i = 0; i < NA.length; i++) NP[i] = hist[Math.min(BINS - 1, ((NA[i] + 1) / 2 * BINS) | 0)] / NA.length;
}
const nA = (x, y) => NA[((y | 0) & NM) << 9 | ((x | 0) & NM)];
const bilerpN = (x, y) => {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const a = nA(x0, y0), b = nA(x0 + 1, y0), c = nA(x0, y0 + 1), d = nA(x0 + 1, y0 + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
};

// ---------- textures: load once at import, cut into world-sized tiles for the current pixels-per-cell ----------
const images = {};
let ready = false, tilesP = 0, tiles = null;
const loading = Promise.all(LOOK.map(L => new Promise((res) => {
  const img = new Image();
  img.onload = () => { images[L.tex] = img; res(); };
  img.onerror = () => res(); // a missing texture falls back to its flat color
  img.src = `/client/textures/${L.tex}.jpg`;
}))).then(() => {
  ready = true;
  if (cur?.attrs) { tilesP = 0; fullPaint(cur); }
});

function buildTiles(P) {
  tiles = [];
  const big = document.createElement('canvas'), bc = big.getContext('2d');
  const out = document.createElement('canvas'), oc = out.getContext('2d', { willReadFrequently: true });
  LOOK.forEach((L, m) => {
    const T = 2 ** Math.round(Math.log2(Math.max(8, L.m / CELL * P))), img = images[L.tex]; // a power of two, for cheap wrapping
    const t = { T, data: null, ox: Math.floor(rnd(m, 3) * T), oy: Math.floor(rnd(m, 5) * T) };
    if (img) {
      // tile 3x3 at full size, shrink that, keep the middle: the shrink filter then wraps across the seams
      const S = img.width;
      big.width = big.height = S * 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) bc.drawImage(img, i * S, j * S);
      out.width = out.height = T * 3;
      oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
      oc.drawImage(big, 0, 0, T * 3, T * 3);
      const d = oc.getImageData(T, T, T, T).data, [mr, mg, mb] = L.mul, st = L.sat, con = L.con ?? 1, avg = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) avg[k] += d[i + k] * 4 / d.length;
      for (let i = 0; i < d.length; i += 4) {
        const r = (avg[0] + (d[i] - avg[0]) * con) * mr, g = (avg[1] + (d[i + 1] - avg[1]) * con) * mg, b = (avg[2] + (d[i + 2] - avg[2]) * con) * mb;
        const y = 0.3 * r + 0.59 * g + 0.11 * b;
        d[i] = y + (r - y) * st; d[i + 1] = y + (g - y) * st; d[i + 2] = y + (b - y) * st;
      }
      t.data = d;
    }
    tiles.push(t);
  });
  tiles.push({ ...tiles[FIELD], ox: tiles[FIELD].oy, oy: tiles[FIELD].ox }); // FIELD_V samples the field tile transposed
  tilesP = P;
}
// What client/apron.js needs to continue this ground past the map edge with the same look: the tinted tiles the map is
// painted from (null until the textures have loaded; `ready` flips when they have), the metres each tile covers, and the
// noise tables the blend uses. The apron is built per match and asks again after `loading` resolves.
export function groundLook() {
  if (!NA) buildNoise();
  return { ready, tiles, meters: LOOK.map(L => L.m), flat, noise: { NA, NP, size: NS }, loading };
}
const flat = LOOK.map(L => {
  const [r, g, b] = L.avg.map((v, k) => v * L.mul[k]), y = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map(v => y + (v - y) * L.sat);
});
flat.push(flat[FIELD]);

// ---------- per-cell ground materials ----------
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// ploughed fields: some 10x8 blocks of open ground (from the map file, so they never move) get a crop field
// fieldCells: per cell 0 (no field), 1 (a field) or 2 (a field ploughed at right angles); client/props.js grows crops on some
export function fieldCells(map) { return fieldsOf(map).map(v => (v === FIELD ? 1 : v === FIELD_V ? 2 : 0)); }
function fieldsOf(map) {
  const { w, h, rows } = map, f = new Uint8Array(w * h), BW = 10, BH = 8;
  const keep = [...(map.spawns || []).filter(Boolean).map(p => ({ ...p, r: 9 })), ...(map.points || []).map(p => ({ ...p, r: 5 }))]; // clear of HQ rings and points
  for (let by = 0; by * BH < h; by++) for (let bx = 0; bx * BW < w; bx++) {
    const look = BIOME_LOOKS[map.biome?.[Math.min(h - 1, by * BH + 4) * w + Math.min(w - 1, bx * BW + 5)]];
    if (rnd(bx, by, 7) > (look?.fields ?? 0.24)) continue;
    const x0 = bx * BW + 1, y0 = by * BH + 1, x1 = Math.min(w - 1, bx * BW + BW - 1), y1 = Math.min(h - 1, by * BH + BH - 1);
    if (x1 - x0 < 4 || y1 - y0 < 3) continue;
    if (keep.some(p => p.x > x0 - p.r && p.x < x1 + p.r - 1 && p.y > y0 - p.r && p.y < y1 + p.r - 1)) continue;
    let ok = true;
    for (let y = y0; y < y1 && ok; y++) for (let x = x0; x < x1; x++) if (rows[y][x] !== '.') { ok = false; break; }
    if (!ok) continue;
    const dir = rnd(bx, by, 8) < 0.5 ? FIELD : FIELD_V;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f[y * w + x] = dir;
  }
  return f;
}

// S.state: per cell, what the server says besides the type (wear in quarters, burnt, damage stage); a map cell the
// server has not mentioned is in its starting state
function cellAttrs(S, grid) {
  const { w, h, map, fields } = S, rows = map.rows, n = w * h;
  const prim = new Uint8Array(n), sec = new Uint8Array(n), amt = new Float32Array(n), lev = new Float32Array(n), ov = new Uint8Array(n), key = new Uint8Array(n);
  const scar = new Uint8Array(n); // 0 none, 1 shell or burnt, 2 rubble. The base material stays ordinary ground.
  const char = new Uint8Array(n); // burnt ground: the blast mark goes black
  const tint = biomeTint(S), tr = new Float32Array(n), tg = new Float32Array(n), tb = new Float32Array(n);
  const at = (x, y) => grid[y]?.[x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, object = grid[y][x], ch = object === 'N' ? S.objectGrid?.[y]?.[x] && S.objectGrid[y][x] !== '.' ? S.objectGrid[y][x] : S.groundGrid?.[y]?.[x] ?? '.' : object, L = levelOf(map.heights?.[y]?.[x] ?? '0');
    const st = S.state ? S.state[i] : startState(ch, i), worn = st & 3;
    lev[i] = L;
    let p = GRASS, s = DIRT, a = 0;
    if (ch === '.') {
      let wet = false, town = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = at(x + dx, y + dy);
        if (c === 'W' || c === 'F' || c === '=') wet = true;
        if (rows[y + dy]?.[x + dx] === 'B') town = true;
      }
      const look = BIOME_LOOKS[S.map.biome?.[i]];
      if (fields[i]) { p = fields[i]; s = GRASS; a = 0.3; }
      else if (wet) { s = MUD; a = 0.55; }
      else if (town) { p = ROAD; s = GRASS; a = 0.3; }
      else if (L < 0) { s = MUD; a = Math.min(0.6, 0.25 + 0.12 * -L); }
      else { a = 0.1 + 0.3 * (nA(x * 3 + 41, y * 3 + 77) * 0.5 + 0.5); if (look) { s = look.soil; a += look.bare; } }
      // tracks cut the ground up step by step until it is mud; a burn is a scar, not a new square of earth
      if (worn) { s = MUD; a = Math.max(a, 0.24 * worn); }
      // shelling that has not sunk the cell churns it: torn-up earth from the first hit, a blast mark when it is pounded
      const shelled = st >> 5 & 3;
      if (shelled && !fields[i]) { s = SHELL; a = Math.max(a, 0.22 + 0.16 * shelled); }
      else if (shelled) a = Math.max(a, 0.3 + 0.15 * shelled);
      if (shelled === 3) scar[i] = 1;
      if (st & 4) { scar[i] = 1; char[i] = 1; }
    }
    else if (ch === 'B' || ch === 'K') { p = DIRT; s = ROAD; a = 0.3; }
    else if (ch === 'R') { p = DIRT; s = GRASS; a = 0.35; scar[i] = 2; }
    else if (ch === '+') { p = GRASS; s = worn ? MUD : DIRT; a = 0.16 + 0.12 * worn; ov[i] = 1; scar[i] = 1; } // the bowl is drawn on top; the scar is the blast mark
    else if (ch === 'T') {
      p = EARTH; s = MUD; a = 0.3; ov[i] = 16;
      DIRS.forEach(([dx, dy], k) => { if (at(x + dx, y + dy) === 'T') ov[i] |= 1 << k; });
    }
    else if (ch === 'W' || ch === '=') p = WATER;
    else if (ch === 'F') { p = WATER; s = ROAD; a = 0.6 - 0.13 * worn; } // the shallows show their gravel
    else if (ch === 'H') { s = MUD; a = 0.35; }
    else if (ch === 'X') { s = MUD; a = 0.45; }
    else if (ch === 'Y' || ch === 'Q') a = 0.4;
    else if (ch === '#') a = 0.5;
    else if (ch === 'D') { p = ROAD; s = worn ? SHELL : DIRT; a = 0.12 + 0.2 * worn; } // a shelled road breaks up
    else if (ch === 'M') { p = MUD; a = 0.42 - 0.12 * worn; } // shallow mud still shows the dirt
    else if (ch === 'N') a = 0.3;
    else if (ch === 'O') { s = MUD; a = 0.5; } // forest floor: leaf litter and bare earth under the trees
    else if (ch === 'A') { p = DIRT; a = 0.2; }
    if (!a) s = p;
    prim[i] = p; sec[i] = s; amt[i] = a; key[i] = p | s << 4;
    // the region's tint is for growing ground: none on water, a little on roads and yards
    const k = p === WATER ? 0 : p === ROAD || p === DIRT || p === EARTH ? 0.4 : 1;
    tr[i] = 1 + (tint.r[i] - 1) * k; tg[i] = 1 + (tint.g[i] - 1) * k; tb[i] = 1 + (tint.b[i] - 1) * k;
  }
  // pixels this far from a scar run the blast-mark pass; everyone else stays on the fast material blend.
  // The mark itself can reach almost two cells past a scar, so the pass covers three.
  const near = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!scar[y * w + x]) continue;
    for (let dy = -3; dy <= 3; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        near[ny * w + nx] = 1;
      }
    }
  }
  // How many cells of scar sit between this cell and open ground. A lone hit is 1. The middle of a wide blast is more.
  const depth = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!scar[y * w + x]) continue;
    let best = 8;
    for (let dy = -6; dy <= 6; dy++) {
      const ny = y + dy;
      for (let dx = -6; dx <= 6; dx++) {
        const nx = x + dx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && scar[ny * w + nx]) continue;
        const d = Math.hypot(dx, dy);
        if (d < best) best = d;
      }
    }
    depth[y * w + x] = best;
  }
  return { prim, sec, amt, lev, ov, key, scar, near, depth, char, tr, tg, tb };
}

// The biome tint per cell, a 13-cell box blur of the known cells' looks, so a border is a broad blend. Kept on S and
// redone only around cells whose biome arrived since the last paint (map.biomeCells, filled by client/main.js).
const ONE = { r: null, g: null, b: null };
function biomeTint(S) {
  const { w, h, map } = S, n = w * h;
  if (!map.biome) { if (!ONE.r || ONE.r.length !== n) { ONE.r = new Float32Array(n).fill(1); ONE.g = ONE.r; ONE.b = ONE.r; } return ONE; }
  let T = S.tint;
  const fresh = !T || T.map !== map;
  if (fresh) T = S.tint = { map, r: new Float32Array(n).fill(1), g: new Float32Array(n).fill(1), b: new Float32Array(n).fill(1) };
  const todo = map.biomeCells ?? [];
  if (!fresh && !todo.length) return T;
  const R = 6;
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
  if (!fresh) {
    x0 = w; y0 = h; x1 = 0; y1 = 0;
    for (const c of todo) { const x = c % w, y = (c / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 = Math.max(0, x0 - R); y0 = Math.max(0, y0 - R); x1 = Math.min(w - 1, x1 + R); y1 = Math.min(h - 1, y1 + R);
  }
  map.biomeCells = [];
  // summed-area tables over the box plus its blur margin
  const ax = Math.max(0, x0 - R), ay = Math.max(0, y0 - R), bx = Math.min(w - 1, x1 + R), by = Math.min(h - 1, y1 + R);
  const W = bx - ax + 2, H = by - ay + 2, sw = new Float32Array(W * H), sr = new Float32Array(W * H), sg = new Float32Array(W * H), sb = new Float32Array(W * H);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    const look = BIOME_LOOKS[map.biome[y * w + x]], i = (y - ay + 1) * W + x - ax + 1, up = i - W;
    sw[i] = (look ? 1 : 0) + sw[i - 1] + sw[up] - sw[up - 1];
    sr[i] = (look ? look.tint[0] : 0) + sr[i - 1] + sr[up] - sr[up - 1];
    sg[i] = (look ? look.tint[1] : 0) + sg[i - 1] + sg[up] - sg[up - 1];
    sb[i] = (look ? look.tint[2] : 0) + sb[i - 1] + sb[up] - sb[up - 1];
  }
  const box = (t, qx0, qy0, qx1, qy1) => t[qy1 * W + qx1] - t[qy0 * W + qx1] - t[qy1 * W + qx0] + t[qy0 * W + qx0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const qx0 = Math.max(ax, x - R) - ax, qy0 = Math.max(ay, y - R) - ay, qx1 = Math.min(bx, x + R) - ax + 1, qy1 = Math.min(by, y + R) - ay + 1;
    const k = box(sw, qx0, qy0, qx1, qy1), c = y * w + x;
    if (k < 0.5) { T.r[c] = T.g[c] = T.b[c] = 1; continue; }
    T.r[c] = box(sr, qx0, qy0, qx1, qy1) / k; T.g[c] = box(sg, qx0, qy0, qx1, qy1) / k; T.b[c] = box(sb, qx0, qy0, qx1, qy1) / k;
  }
  return T;
}

// Smooth noise at cell scale. The ground fBm is far too low-frequency to tear a scar's edge.
function createCellNoise() {
  const lattice = [];
  const sample = (x, y, k) => {
    const layer = lattice[k] ??= [], row = layer[y] ??= [];
    return row[x] ??= rnd(x, y, k);
  };
  return (u, v, k) => {
    const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = sample(x0, y0, k), b = sample(x0 + 1, y0, k), c = sample(x0, y0 + 1, k), d = sample(x0 + 1, y0 + 1, k);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

// Scar neighborhoods depend on cells, not texture pixels. Build each sparse neighborhood once per
// paint, then share it between the shape and distance passes. The ordering matches the original rows.
function createScarSampler(scar, depth, w, h, noise) {
  const neighborhoods = [];
  function nearby(u, v) {
    const x0 = u | 0, y0 = v | 0, row = neighborhoods[y0] ??= [];
    let result = row[x0];
    if (result) return result;
    const scars = [], clean = [];
    let material = -1;
    for (let y = y0 - 3; y <= y0 + 3; y++) {
      let left = null, middle = null, right = null;
      for (let x = x0 - 3; x <= x0 + 3; x++) {
        const cell = y * w + x, kind = x >= 0 && y >= 0 && x < w && y < h ? scar[cell] : 0;
        if (kind) {
          scars.push(x + 0.5, y + 0.5, kind, depth[cell]);
          material = material === -1 ? kind : material === kind ? kind : 0;
        }
        else if (x < x0) left = x + 0.5;
        else if (x === x0) middle = x + 0.5;
        else if (right === null) right = x + 0.5;
      }
      // Only the nearest clean center on each side can win on this row. Keep both sides of
      // the middle too: bitwise truncation makes the first cell cover negative warped samples.
      for (const x of [left, middle, right]) if (x !== null) clean.push(x, y + 0.5);
    }
    result = { scars, clean, material, shapes: new Map() };
    row[x0] = result;
    return result;
  }
  return (u, v) => scarWeights(nearby, noise, u, v);
}

// Distance from (u, v) to the nearest scar and clean centers. Compare squared clean distances,
// then take one square root; only nearby scar centers need individual distances for their weight.
function scarField(nearby, u, v) {
  let shell = 0, rubble = 0, scarSquared = 81, cleanSquared = 81;
  const { scars, clean, material } = nearby(u, v);
  for (let i = 0; i < clean.length; i += 2) {
    const dx = u - clean[i], dy = v - clean[i + 1], d = dx * dx + dy * dy;
    if (d < cleanSquared) cleanSquared = d;
  }
  for (let i = 0; i < scars.length; i += 4) {
    const dx = u - scars[i], dy = v - scars[i + 1], squared = dx * dx + dy * dy;
    if (squared < scarSquared) scarSquared = squared;
    if (material || squared >= 2.4 ** 2) continue;
    const inf = (1 - Math.hypot(dx, dy) / 2.4) ** 2;
    if (scars[i + 2] === 1) shell += inf; else rubble += inf;
  }
  // A single scar material normalizes to exactly one regardless of the individual weights.
  if (material > 0 && scarSquared < 2.4 ** 2) {
    shell = material === 1 ? 1 : 0; rubble = material === 2 ? 1 : 0;
  }
  return { shell, rubble, dScar: Math.sqrt(scarSquared), dClean: Math.sqrt(cleanSquared) };
}

// How destroyed the point (u, v) is, in cell coordinates. 0 is untouched ground, 1 is the middle of a blast.
// A lone hit stays a blob inside its cell, so the corners still show grass. A wide blast is one torn patch:
// the sample point is shoved by almost a cell before the edge is measured, and that edge is only solid once
// it is a full cell inside the scar. A thin stick (a bombing run, a strafe) is not that patch and not a row of
// disks: the sample slides along the run and the width pinches, so grass shows between some of the hits.
// The low-frequency ground noise cannot do this. It is too smooth to tear a block.
// The radius test changes only which scar centers participate. Adjacent pixels usually share
// that set, so cache its mass and axis instead of recomputing covariance for every pixel.
function scarShape({ scars, shapes }, u, v) {
  let low = 0, high = 0, nearestSquared = Infinity;
  for (let i = 0; i < scars.length; i += 4) {
    const dx = u - scars[i], dy = v - scars[i + 1], squared = dx * dx + dy * dy, bit = i / 4;
    if (squared < nearestSquared) nearestSquared = squared;
    if (squared <= 3.2 ** 2) { if (bit < 32) low |= 1 << bit; else high |= 1 << (bit - 32); }
  }
  const key = (high >>> 0) * 4294967296 + (low >>> 0);
  let shape = shapes.get(key);
  if (!shape) {
    let mass = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < scars.length; i += 4) {
      const bit = i / 4;
      if (!(bit < 32 ? low & (1 << bit) : high & (1 << (bit - 32)))) continue;
      const cx = scars[i], cy = scars[i + 1];
      n++; sx += cx; sy += cy; sxx += cx * cx; syy += cy * cy; sxy += cx * cy;
      if (scars[i + 3] > mass) mass = scars[i + 3];
    }
    // A stick is long and only a few cells across. A square block, including the tested three-by-three, is not.
    let run = null;
    if (n >= 5) {
      const mx = sx / n, my = sy / n;
      const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
      const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
      const disc = Math.max(0, tr * tr * 0.25 - det);
      const major = tr * 0.5 + Math.sqrt(disc), minor = Math.max(0, tr * 0.5 - Math.sqrt(disc));
      // A plane stick is a few cells wide, not one. A square block still fails the long-axis test.
      if (major > 2.2 && minor < 1.65 && minor < major / 2.4) {
        const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
        run = { ax: Math.cos(ang), ay: Math.sin(ang) };
      }
    }
    // A single cell and a three-by-three stay gentle, or the tested corners fill in. A real shelled block does not.
    const big = !run && mass >= 3;
    const mid = !run && !big && mass >= 1.8;
    shape = { n, run, big, mid };
    shapes.set(key, shape);
  }
  return { shape, nearestSquared };
}

function scarWeights(nearby, noise, u, v) {
  const { shape, nearestSquared } = scarShape(nearby(u, v), u, v), { n, run, big, mid } = shape;
  // Outside the maximum displaced reach, the blend is exactly zero. Avoid noise and distance
  // sampling there; the conservative bound includes both octaves and the wide-patch ripple.
  const reach = run ? Math.hypot(0.34, 0.42) : Math.SQRT2 * ((big ? 0.78 : mid ? 0.16 : 0.04) * 1.7 + (big ? 0.62 : 0));
  if (!n || nearestSquared > (2.4 + reach + 1e-9) ** 2) return { cover: 0, shell: 0, rubble: 0 };
  let nu, nv, amp, biteAmp;
  if (run) {
    const s = u * run.ax + v * run.ay, t = -u * run.ay + v * run.ax;
    const alongN = noise(s * 0.18 + 2, t * 0.18 + 1, 31) * 2 - 1;
    const acrossN = noise(s * 0.31 + 5, 8.2, 32) * 2 - 1;
    nu = u + run.ax * alongN * 0.34 + (-run.ay) * acrossN * 0.42;
    nv = v + run.ay * alongN * 0.34 + run.ax * acrossN * 0.42;
    amp = 0.42; biteAmp = 0.22;
  } else {
    const warp = big ? 0.78 : mid ? 0.16 : 0.04;
    amp = big ? 1.35 : mid ? 0.34 : 0.14;
    biteAmp = big ? 0.62 : mid ? 0.1 : 0.05;
    // Two octaves, so a side that is flat in the slow wave still gets torn by the faster one.
    const slow = (pu, pv, k) => noise(pu * 0.26 + k, pv * 0.24 + k * 1.3, k) * 2 - 1;
    const fast = (pu, pv, k) => noise(pu * 0.62 + k * 2, pv * 0.57 + 3, k) * 2 - 1;
    // A product of sines, so every side of a wide blast is bitten even where the noise happens to be flat.
    // The two frequencies are not the cell spacing, so the notches do not line up with the map grid.
    const rip = big ? 0.62 : 0;
    nu = u + slow(u + 2.2, v + 5.1, 4) * warp + fast(u, v, 6) * warp * 0.7
      + Math.sin(v * 2.6 + u * 0.7) * Math.sin(u * 1.15 + v * 0.45 + 1.7) * rip;
    nv = v + slow(u + 8.4, v + 1.3, 5) * warp + fast(u + 4, v, 7) * warp * 0.7
      + Math.sin(u * 2.35 + v * 0.55) * Math.sin(v * 1.25 + u * 0.4 + 0.6) * rip;
  }
  const field = scarField(nearby, nu, nv);
  const wave = noise(u * 0.45 + 1.7, v * 0.45 + 4.2, 11) * 2 - 1;
  const bite = noise(u * 1.7 + 3.0, v * 1.4 + 6.0, 8) * 2 - 1;
  const inset = field.dClean - field.dScar;
  const shifted = inset - 0.08 + amp * wave + biteAmp * bite;
  let cover = shifted <= 0 ? 0 : shifted >= 0.65 ? 1 : shifted / 0.65;
  cover = cover * cover * (3 - 2 * cover);
  if (!run && !big && field.dScar < (mid ? 0.28 : 0.34)) cover = 1;
  if ((big && inset > 2.05) || (run && inset > 1.45)) {
    const fleck = noise(u * 3.1 + 4, v * 3.1 + 2, 19);
    cover = Math.max(cover, fleck > 0.93 ? 0.5 : 1);
  }
  if (cover > 1) cover = 1;
  const tot = field.shell + field.rubble;
  return tot && cover > 0 ? { cover, shell: field.shell / tot, rubble: field.rubble / tot } : { cover: 0, shell: 0, rubble: 0 };
}

// ---------- the per-pixel blend ----------
// per-material tile lookups for the raster loop (flat 1x1 tiles until the textures load)
const tData = [], tMask = new Int32Array(NMAT), tShift = new Int32Array(NMAT), tOx = new Int32Array(NMAT), tOy = new Int32Array(NMAT), tSwap = new Uint8Array(NMAT);
function useTiles(textured) {
  for (let m = 0; m < NMAT; m++) {
    const t = textured && tiles[m];
    if (t && t.data) { tData[m] = t.data; tMask[m] = t.T - 1; tShift[m] = Math.log2(t.T); tOx[m] = t.ox; tOy[m] = t.oy; }
    else { tData[m] = new Uint8ClampedArray([...flat[m], 255]); tMask[m] = tShift[m] = tOx[m] = tOy[m] = 0; }
    tSwap[m] = m === FIELD_V ? 1 : 0;
  }
}
// index into a material's tile for canvas pixel (i, j); world-aligned, so tiles line up across cells
const tq = (m, i, j) => (tSwap[m]
  ? ((((i + tOy[m]) & tMask[m]) << tShift[m]) | ((j + tOx[m]) & tMask[m]))
  : ((((j + tOy[m]) & tMask[m]) << tShift[m]) | ((i + tOx[m]) & tMask[m]))) << 2;

const wt = new Float32Array(NMAT);
function raster(S, X0, Y0, W, H, img) {
  const { P, w, h } = S, { prim, sec, amt, key, near, char, tr, tg, tb } = S.attrs, d = img.data, tinted = !!S.map.biome;
  useTiles(ready && tiles);
  // everything that depends only on the column, worked out once
  const cU = new Float32Array(W), cWx = new Int32Array(W), cWy = new Int32Array(W), cP0 = new Int32Array(W), cP1 = new Int32Array(W), cPt = new Float32Array(W);
  const cB = new Int32Array(W);
  for (let c = 0; c < W; c++) {
    const u = (X0 + c + 0.5) / P, px = u * 6 + 57;
    cU[c] = u; cWx[c] = ((u * 16 + 1101) | 0) & NM; cWy[c] = ((u * 16 + 311) | 0) & NM;
    cP0[c] = Math.floor(px) & NM; cP1[c] = (Math.floor(px) + 1) & NM; cPt[c] = px - Math.floor(px);
    cB[c] = ((u * 2.3 + 900) | 0) & NM;
  }
  let o = 0;
  for (let j = Y0; j < Y0 + H; j++) {
    const v = (j + 0.5) / P, py = v * 6 + 213;
    const rWx = (((v * 16 + 37) | 0) & NM) << 9, rWy = (((v * 16 + 1211) | 0) & NM) << 9, rB = (((v * 2.3 + 431) | 0) & NM) << 9;
    const rP0 = (Math.floor(py) & NM) << 9, rP1 = ((Math.floor(py) + 1) & NM) << 9, rPt = py - Math.floor(py);
    for (let c = 0; c < W; c++, o += 4) {
      const i = X0 + c, u = cU[c];
      // the four nearest cell centers, looked up at a warped position
      const fx = u + NA[rWx | cWx[c]] * WARP - 0.5, fy = v + NA[rWy | cWy[c]] * WARP - 0.5;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      if (x0 < 0) x0 = 0; else if (x0 > w - 1) x0 = w - 1;
      if (x1 < 0) x1 = 0; else if (x1 > w - 1) x1 = w - 1;
      if (y0 < 0) y0 = 0; else if (y0 > h - 1) y0 = h - 1;
      if (y1 < 0) y1 = 0; else if (y1 > h - 1) y1 = h - 1;
      const c00 = y0 * w + x0, c01 = y0 * w + x1, c10 = y1 * w + x0, c11 = y1 * w + x1;
      // patch noise (equalized, bilinear)
      const pa = NP[rP0 | cP0[c]], pb = NP[rP0 | cP1[c]], pc = NP[rP1 | cP0[c]], pd = NP[rP1 | cP1[c]], ptx = cPt[c];
      const pn = (pa + (pb - pa) * ptx) * (1 - rPt) + (pc + (pd - pc) * ptx) * rPt;
      let r = 0, g = 0, bl = 0, wWater = 0;
      const k00 = key[c00];
      if (k00 === key[c01] && k00 === key[c10] && k00 === key[c11]) {
        // all four cells use the same pair of materials: blend just the pair
        const p = prim[c00], q = sec[c00];
        const am = (amt[c00] * (1 - tx) + amt[c01] * tx) * (1 - ty) + (amt[c10] * (1 - tx) + amt[c11] * tx) * ty;
        let s = 0;
        if (am > 0) { s = (am - pn) * 5.5 + 0.5; s = s < 0 ? 0 : s > 1 ? 1 : s * s * (3 - 2 * s); }
        if (s < 1) { const dd = tData[p], k = tq(p, i, j), f = 1 - s; r = f * dd[k]; g = f * dd[k + 1]; bl = f * dd[k + 2]; if (p === WATER) wWater = f; }
        if (s > 0) { const dd = tData[q], k = tq(q, i, j); r += s * dd[k]; g += s * dd[k + 1]; bl += s * dd[k + 2]; if (q === WATER) wWater += s; }
      } else {
        let a = (1 - tx) * (1 - ty), b = tx * (1 - ty), cc = (1 - tx) * ty, e = tx * ty;
        a *= a; b *= b; cc *= cc; e *= e; // retain cell centers, with wider blends between different materials
        const sum = a + b + cc + e;
        for (let k = 0; k < 4; k++) {
          const ci = k === 0 ? c00 : k === 1 ? c01 : k === 2 ? c10 : c11, wc = (k === 0 ? a : k === 1 ? b : k === 2 ? cc : e) / sum;
          const am = amt[ci];
          if (am > 0) {
            let s = (am - pn) * 5.5 + 0.5;
            s = s < 0 ? 0 : s > 1 ? 1 : s * s * (3 - 2 * s);
            wt[sec[ci]] += wc * s; wt[prim[ci]] += wc * (1 - s);
          } else wt[prim[ci]] += wc;
        }
        wWater = wt[WATER];
        for (let m = 0; m < NMAT; m++) {
          const wm = wt[m];
          if (wm === 0) continue;
          wt[m] = 0;
          if (wm < 0.004) continue;
          const dd = tData[m], k = tq(m, i, j);
          r += wm * dd[k]; g += wm * dd[k + 1]; bl += wm * dd[k + 2];
        }
      }
      // the region's tint, blended like the materials (World Conquest only: other maps keep their exact pixels)
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      if (tinted) {
        r *= tr[c00] * w00 + tr[c01] * w01 + tr[c10] * w10 + tr[c11] * w11;
        g *= tg[c00] * w00 + tg[c01] * w01 + tg[c10] * w10 + tg[c11] * w11;
        bl *= tb[c00] * w00 + tb[c01] * w01 + tb[c10] * w10 + tb[c11] * w11;
      }
      // the blast mark sits on the ordinary ground. Only pixels near a scar pay for it.
      const gx = u <= 0 ? 0 : u >= w ? w - 1 : u | 0, gy = v <= 0 ? 0 : v >= h ? h - 1 : v | 0;
      if (near[gy * w + gx]) {
        const sc = S.sampleScar(u, v);
        if (sc.cover > 0.015) {
          const cover = sc.cover, sd = tData[SHELL], sk = tq(SHELL, i, j), rd = tData[RUBBLE], rk = tq(RUBBLE, i, j);
          // churned earth, not tar: the middle of a crater field stays brown. Burnt ground (fire, a wreck) is charred.
          const burn = char[c00] * w00 + char[c01] * w01 + char[c10] * w10 + char[c11] * w11;
          const shade = (0.7 + 0.3 * (1 - cover * cover)) * (1 - 0.5 * burn);
          const sr = sc.shell * sd[sk] * shade + sc.rubble * rd[rk];
          const sg = sc.shell * sd[sk + 1] * shade + sc.rubble * rd[rk + 1];
          const sb = sc.shell * sd[sk + 2] * shade * 1.06 + sc.rubble * rd[rk + 2];
          const ink = cover * (0.35 + 0.65 * cover);
          const keep = 1 - ink;
          r = r * keep + sr * ink; g = g * keep + sg * ink; bl = bl * keep + sb * ink;
        }
      }
      // broad light and dark sweeps, so the repeat of the textures doesn't show
      const br = 1 + 0.14 * NA[rB | cB[c]];
      r *= br; g *= br; bl *= br;
      // a pale line where water meets land
      if (wWater > 0.06 && wWater < 0.94) {
        let kk = 1 - Math.abs(wWater - 0.5) * 2.2;
        if (kk > 0) { kk *= kk * 0.45; r += (FOAM[0] - r) * kk; g += (FOAM[1] - g) * kk; bl += (FOAM[2] - bl) * kk; }
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
    }
  }
}

// ---------- drawn on top: shell holes, trench cuts, contour lines ----------
function overlays(S, c, cx0, cy0, cx1, cy1) {
  const { w, h, P } = S, { ov, lev } = S.attrs;
  cx0 = Math.max(0, cx0); cy0 = Math.max(0, cy0); cx1 = Math.min(w - 1, cx1); cy1 = Math.min(h - 1, cy1);
  const holes = [], cuts = [];
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
    const f = ov[y * w + x];
    if (f === 1) holes.push([x, y]); else if (f & 16) cuts.push([x, y, f]);
  }
  const holeAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && ov[y * w + x] === 1;
  for (const [x, y] of holes) shellHole(c, P, x, y, holeAt);
  if (cuts.length) {
    c.beginPath();
    for (const [x, y, f] of cuts) {
      const cx = (x + 0.5) * P, cy = (y + 0.5) * P;
      c.moveTo(cx, cy);
      if (!(f & 15)) c.lineTo(cx + 0.01, cy); // a lone foxhole
      DIRS.forEach(([dx, dy], k) => { if (f & (1 << k)) { c.moveTo(cx, cy); c.lineTo(cx + dx * P * 0.5, cy + dy * P * 0.5); } });
    }
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = 'rgba(58, 44, 28, 0.85)'; c.lineWidth = P * 0.8; c.stroke();
    c.strokeStyle = '#2b2218'; c.lineWidth = P * 0.5; c.stroke();
    c.strokeStyle = 'rgba(128, 102, 66, 0.5)'; c.lineWidth = Math.max(1, P * 0.07); c.stroke(); // duckboards
  }
  // Keep contour ink near true cliffs. Ordinary ramps use their geometry and slope shading.
  const lv = (x, y) => lev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  c.beginPath();
  let any = false;
  for (let y = Math.max(-1, cy0 - 1); y <= cy1; y++) for (let x = Math.max(-1, cx0 - 1); x <= cx1; x++) {
    const a = lv(x, y), b = lv(x + 1, y), cc = lv(x + 1, y + 1), d = lv(x, y + 1);
    const lo = Math.min(a, b, cc, d), hi = Math.max(a, b, cc, d);
    if (lo === hi) continue;
    if (Math.max(Math.abs(a - b), Math.abs(b - cc), Math.abs(cc - d), Math.abs(d - a)) < 2) continue;
    const ox = (x + 0.5) * P, oy = (y + 0.5) * P;
    for (let t = lo + 0.5; t < hi; t++) {
      // crossing points on the top, right, bottom and left edges of the square
      const pts = [];
      if ((a > t) !== (b > t)) pts.push([(t - a) / (b - a), 0]);
      if ((b > t) !== (cc > t)) pts.push([1, (t - b) / (cc - b)]);
      if ((d > t) !== (cc > t)) pts.push([(t - d) / (cc - d), 1]);
      if ((a > t) !== (d > t)) pts.push([0, (t - a) / (d - a)]);
      const seg = (p, q) => { c.moveTo(ox + p[0] * P, oy + p[1] * P); c.lineTo(ox + q[0] * P, oy + q[1] * P); any = true; };
      if (pts.length === 2) seg(pts[0], pts[1]);
      else if (pts.length === 4) {
        // saddle: the middle decides which corners join up
        const mid = (a + b + cc + d) / 4 > t, aUp = a > t;
        if (mid === aUp) { seg(pts[0], pts[1]); seg(pts[2], pts[3]); } else { seg(pts[0], pts[3]); seg(pts[1], pts[2]); }
      }
    }
  }
  if (any) {
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = 'rgba(48, 40, 22, 0.55)'; c.lineWidth = Math.max(1.2, P * 0.12); c.stroke();
  }
}

// A small bowl inside the cell, lit from the upper right. The blast's outline is the scar, so the bowl stays
// well clear of the cell corners, and a hole that already has a neighbour is often skipped so a crater field
// is not a grid of identical circles.
function shellHole(c, P, x, y, holeAt) {
  const beside = holeAt(x + 1, y) || holeAt(x - 1, y) || holeAt(x, y + 1) || holeAt(x, y - 1);
  if (beside && rnd(x, y, 21) < 0.82) return;
  const rad = (0.08 + 0.14 * rnd(x, y, 24)) * P;
  const cx = (x + 0.5 + (rnd(x, y, 22) - 0.5) * 0.36) * P, cy = (y + 0.5 + (rnd(x, y, 23) - 0.5) * 0.36) * P;
  const g = c.createRadialGradient(cx + rad * 0.2, cy - rad * 0.2, rad * 0.04, cx, cy, rad);
  g.addColorStop(0, '#1a140e'); g.addColorStop(0.7, '#3a2e22'); g.addColorStop(1, 'rgba(70, 54, 36, 0)');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
}

// ---------- painting and upload ----------
let cur = null;
const imgCache = new Map();
function imageData(c, W, H) {
  const k = W + 'x' + H;
  if (!imgCache.has(k)) { if (imgCache.size > 8) imgCache.clear(); imgCache.set(k, c.createImageData(W, H)); }
  return imgCache.get(k);
}

function fullPaint(S) {
  cancelPaint(S);
  const t0 = performance.now(), { ctx, canvas, P } = S;
  if (ready && tilesP !== P) buildTiles(P);
  const t1 = performance.now(), band = TILE * P;
  let put = 0;
  for (let y = 0; y < canvas.height; y += band) {
    const H = Math.min(band, canvas.height - y), img = imageData(ctx, canvas.width, H);
    raster(S, 0, y, canvas.width, H, img);
    const tp = performance.now();
    ctx.putImageData(img, 0, y);
    put += performance.now() - tp;
  }
  const t2 = performance.now();
  overlays(S, ctx, 0, 0, S.w - 1, S.h - 1);
  S.tex.needsUpdate = true;
  S.painted = ready ? 'textured' : 'flat';
  const t3 = performance.now();
  S.stats = { kind: 'full', ms: Math.round(t3 - t0), tiles: Math.round(t1 - t0), raster: Math.round(t2 - t1 - put), put: Math.round(put), overlays: Math.round(t3 - t2), px: canvas.width + 'x' + canvas.height };
}

function tilePaint(S, dirty, upload = true) {
  const t0 = performance.now(), { ctx, canvas, P, w, h } = S, tw = Math.ceil(w / TILE);
  let rx0 = Infinity, ry0 = Infinity, rx1 = 0, ry1 = 0;
  for (const k of dirty) {
    const tx = k % tw, ty = Math.floor(k / tw), X = tx * TILE * P, Y = ty * TILE * P;
    const W = Math.min(TILE * P, canvas.width - X), H = Math.min(TILE * P, canvas.height - Y), img = imageData(ctx, W, H);
    raster(S, X, Y, W, H, img);
    ctx.putImageData(img, X, Y);
    ctx.save(); ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip();
    overlays(S, ctx, tx * TILE - 2, ty * TILE - 2, tx * TILE + TILE + 1, ty * TILE + TILE + 1);
    ctx.restore();
    rx0 = Math.min(rx0, X); ry0 = Math.min(ry0, Y); rx1 = Math.max(rx1, X + W); ry1 = Math.max(ry1, Y + H);
  }
  const rectangle = { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
  if (upload) uploadPaint(S, rectangle);
  S.stats = { kind: 'tiles', tiles: dirty.size ?? dirty.length, ms: Math.round(performance.now() - t0) };
  return rectangle;
}

// One upload per paint batch also generates the destination mipmaps just once.
function uploadPaint(S, { x0, y0, x1, y1 }) {
  // Row 0 of the canvas is the top of the flipped texture.
  if (S.renderer && S.uploaded) {
    const W = x1 - x0, H = y1 - y0, px = S.ctx.getImageData(x0, y0, W, H);
    const src = new THREE.DataTexture(px.data, W, H);
    S.renderer.copyTextureToTexture(src, S.tex, null, new THREE.Vector2(x0, S.canvas.height - y0 - H));
  } else S.tex.needsUpdate = true;
}

// Incremental painting can use a frame adapter. New snapshots merge their dirty tiles into the
// pending work; each frame reads the latest immutable cell attributes, so old work cannot overwrite it.
function cancelPaint(S) {
  if (!S.pending) return;
  S.frames.cancel(S.pending.id);
  S.pending = null;
}
function queuePaint(S, dirty) {
  if (S.pending) { for (const tile of dirty) S.pending.dirty.add(tile); return; }
  const job = { dirty: new Set(dirty), id: null };
  S.pending = job;
  const frame = () => {
    if (S.pending !== job) return;
    const start = performance.now();
    let painted = 0, rectangle = null;
    while (job.dirty.size) {
      const tile = job.dirty.values().next().value;
      job.dirty.delete(tile);
      const next = tilePaint(S, [tile], false);
      if (!rectangle) rectangle = next;
      else { rectangle.x0 = Math.min(rectangle.x0, next.x0); rectangle.y0 = Math.min(rectangle.y0, next.y0); rectangle.x1 = Math.max(rectangle.x1, next.x1); rectangle.y1 = Math.max(rectangle.y1, next.y1); }
      if (++painted >= S.tilesPerFrame || performance.now() - start >= S.budgetMs) break;
    }
    uploadPaint(S, rectangle);
    S.stats = { kind: 'tiles', tiles: painted, ms: Math.round(performance.now() - start), pending: job.dirty.size };
    if (job.dirty.size) job.id = S.frames.request(frame);
    else S.pending = null;
  };
  job.id = S.frames.request(frame);
}

// Repaint whatever changed since the last call (everything the first time).
function paint(S, grid) {
  const prev = S.attrs;
  if (S.map.world) S.fields = fieldsOf(S.map); // fields follow the biomes discovered so far
  S.attrs = cellAttrs(S, grid);
  S.sampleScar = createScarSampler(S.attrs.scar, S.attrs.depth, S.w, S.h, S.scarNoise ??= createCellNoise());
  S.version = (S.version ?? 0) + 1;
  const want = ready ? 'textured' : 'flat';
  if (!prev || S.painted !== want) return fullPaint(S);
  const { w, h } = S, n = w * h, tw = Math.ceil(w / TILE), dirty = new Set(), R = 3;
  const A = S.attrs;
  for (let i = 0; i < n; i++) {
    if (A.prim[i] === prev.prim[i] && A.sec[i] === prev.sec[i] && A.amt[i] === prev.amt[i] && A.lev[i] === prev.lev[i] && A.ov[i] === prev.ov[i] && A.scar[i] === prev.scar[i] && A.near[i] === prev.near[i]
      && A.char[i] === prev.char[i] && A.tr[i] === prev.tr[i] && A.tg[i] === prev.tg[i] && A.tb[i] === prev.tb[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (let ty = Math.max(0, y - R) / TILE | 0; ty <= (Math.min(h - 1, y + R) / TILE | 0); ty++)
      for (let tx = Math.max(0, x - R) / TILE | 0; tx <= (Math.min(w - 1, x + R) / TILE | 0); tx++) dirty.add(ty * tw + tx);
  }
  if (!dirty.size) { S.stats = { kind: 'clean', tiles: 0 }; return; }
  if (dirty.size > tw * Math.ceil(h / TILE) * 0.5) {
    if (!S.frames) return fullPaint(S);
    for (let tile = 0; tile < tw * Math.ceil(h / TILE); tile++) dirty.add(tile);
  }
  if (S.frames) { queuePaint(S, dirty); S.stats = { kind: 'queued', tiles: dirty.size, pending: S.pending.dirty.size }; }
  else tilePaint(S, dirty);
}

// The ground for a map. Reuses the canvas and GPU texture when the size matches (the editor rebuilds on every edit),
// so a rebuild repaints only the cells that differ.
// frames: optional { request(callback), cancel(id) }. Without it, paint completes synchronously.
// With it, the first paint and texture reloads stay synchronous; later changed tiles are coalesced
// and painted within budgetMs (8 by default), at most tilesPerFrame (4) per requested frame.
export function createGround(map, renderer, { frames = null, budgetMs = 8, tilesPerFrame = 4 } = {}) {
  if (!NA) buildNoise();
  const P = Math.max(map.world ? 2 : 8, Math.min(24, Math.floor((gfx.low ? 1280 : 2048) / Math.max(map.w, map.h))));
  if (!cur || cur.w !== map.w || cur.h !== map.h || cur.P !== P) {
    if (cur) { cancelPaint(cur); cur.tex.dispose(); cur.material.dispose(); }
    const canvas = document.createElement('canvas');
    canvas.width = map.w * P; canvas.height = map.h * P;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    cur = { w: map.w, h: map.h, P, canvas, ctx, tex, material: new THREE.MeshLambertMaterial({ map: tex }), attrs: null, painted: null, uploaded: false };
    // the first frame uploads the whole canvas; after that, changed tiles go up on their own
    const made = cur;
    tex.onUpdate = () => { made.uploaded = true; };
  }
  const S = cur, owner = Symbol();
  S.owner = owner;
  if (S.pending && (S.map !== map || S.frames !== frames)) { cancelPaint(S); S.attrs = null; }
  S.frames = frames;
  S.budgetMs = Math.max(1, Number.isFinite(budgetMs) ? budgetMs : 8);
  S.tilesPerFrame = Math.max(1, Math.floor(Number.isFinite(tilesPerFrame) ? tilesPerFrame : 4));
  S.map = map; S.renderer = renderer; S.fields = fieldsOf(map);
  S.repaint = () => fullPaint(S);
  if (typeof window !== 'undefined') window.__ground = S; // debug handle, like window.__game
  return { canvas: S.canvas, ctx: S.ctx, tex: S.tex, px: P, material: S.material, paint: (grid, state, groundGrid, objectGrid) => { S.state = state; S.groundGrid = groundGrid; S.objectGrid = objectGrid; paint(S, grid); },
    isRoad: (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h && S.attrs?.prim[y * S.w + x] === ROAD, loading,
    cells: () => S.attrs, version: () => S.version ?? 0, dispose: () => { if (S.owner === owner) { cancelPaint(S); S.attrs = null; } } };
}
