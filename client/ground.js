// Painted ground. Each cell picks a main and a secondary ground material (grass with dirt patches, mud by the water,
// shelled earth, rubble, ...). Every pixel blends the materials of the four nearest cells with a little noise warp,
// so cell edges come out soft instead of square. Contour lines, shell holes and trench cuts are drawn on top.
// When cells change mid-match only the 4x4-cell tiles around them are repainted and sent to the GPU.
import * as THREE from 'three';
import { levelOf, CELL } from '/shared/sim.js';
import { gfx } from './gfx.js';

// material ids; FIELD_V is the ploughed field turned 90 degrees
const GRASS = 0, DIRT = 1, MUD = 2, FIELD = 3, ROAD = 4, WATER = 5, RUBBLE = 6, SHELL = 7, EARTH = 8, FIELD_V = 9, NMAT = 10;
// texture, metres per repeat, color multiplier (sRGB), saturation, contrast, flat color (texture average) used until the textures load
const LOOK = [
  { tex: 'grass', m: 9, mul: [1.06, 1.03, 1.6], sat: 0.6, con: 0.9, avg: [107, 103, 44] },
  { tex: 'dirt', m: 8, mul: [0.94, 0.9, 1.14], sat: 0.58, avg: [160, 117, 72] },
  { tex: 'mud', m: 7, mul: [1, 1, 1], sat: 0.9, avg: [87, 64, 43] },
  { tex: 'field', m: 10, mul: [0.95, 0.95, 1], sat: 0.6, con: 0.55, avg: [103, 70, 44] },
  { tex: 'road', m: 8, mul: [0.9, 0.9, 0.88], sat: 0.8, avg: [162, 136, 109] },
  { tex: 'water', m: 12, mul: [0.95, 1, 1.08], sat: 1, avg: [57, 83, 82] },
  { tex: 'rubble', m: 6, mul: [0.92, 0.92, 0.92], sat: 0.85, avg: [135, 105, 86] },
  { tex: 'shelled', m: 7, mul: [1, 1, 1], sat: 0.9, avg: [81, 63, 53] },
  { tex: 'earth', m: 5, mul: [1.1, 1.1, 1.1], sat: 0.9, avg: [69, 49, 34] },
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
const flat = LOOK.map(L => {
  const [r, g, b] = L.avg.map((v, k) => v * L.mul[k]), y = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map(v => y + (v - y) * L.sat);
});
flat.push(flat[FIELD]);

// ---------- per-cell ground materials ----------
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// ploughed fields: some 10x8 blocks of open ground (from the map file, so they never move) get a crop field
function fieldsOf(map) {
  const { w, h, rows } = map, f = new Uint8Array(w * h), BW = 10, BH = 8;
  const keep = [...(map.spawns || []).map(p => ({ ...p, r: 9 })), ...(map.points || []).map(p => ({ ...p, r: 5 }))]; // clear of HQ rings and points
  for (let by = 0; by * BH < h; by++) for (let bx = 0; bx * BW < w; bx++) {
    if (rnd(bx, by, 7) > 0.24) continue;
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

function cellAttrs(S, grid) {
  const { w, h, map, fields } = S, rows = map.rows, n = w * h;
  const prim = new Uint8Array(n), sec = new Uint8Array(n), amt = new Float32Array(n), lev = new Float32Array(n), ov = new Uint8Array(n), key = new Uint8Array(n);
  const at = (x, y) => grid[y]?.[x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ch = grid[y][x], L = levelOf(map.heights?.[y]?.[x] ?? '0');
    lev[i] = L;
    let p = GRASS, s = DIRT, a = 0;
    if (ch === '.') {
      let wet = false, town = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = at(x + dx, y + dy);
        if (c === 'W' || c === 'F' || c === '=') wet = true;
        if (rows[y + dy]?.[x + dx] === 'B') town = true;
      }
      if (fields[i]) { p = fields[i]; s = GRASS; a = 0.3; }
      else if (wet) { s = MUD; a = 0.55; }
      else if (town) { p = ROAD; s = GRASS; a = 0.3; }
      else if (L < 0) { s = MUD; a = Math.min(0.6, 0.25 + 0.12 * -L); }
      else a = 0.1 + 0.3 * (nA(x * 3 + 41, y * 3 + 77) * 0.5 + 0.5);
    }
    else if (ch === 'B' || ch === 'K') { p = DIRT; s = ROAD; a = 0.3; }
    else if (ch === 'R') { p = RUBBLE; s = DIRT; a = 0.3; }
    else if (ch === '+') { p = SHELL; s = MUD; a = 0.3; ov[i] = 1; }
    else if (ch === 'T') {
      p = EARTH; s = MUD; a = 0.3; ov[i] = 16;
      DIRS.forEach(([dx, dy], k) => { if (at(x + dx, y + dy) === 'T') ov[i] |= 1 << k; });
    }
    else if (ch === 'W' || ch === '=') p = WATER;
    else if (ch === 'F') { p = WATER; s = ROAD; a = 0.45; }
    else if (ch === 'H') { s = MUD; a = 0.35; }
    else if (ch === 'X') { s = MUD; a = 0.45; }
    else if (ch === 'Y') a = 0.4;
    else if (ch === '#') a = 0.5;
    else if (ch === 'D') { p = ROAD; a = 0.12; }
    else if (ch === 'M') { p = MUD; a = 0.25; }
    else if (ch === 'N') a = 0.3;
    if (!a) s = p;
    prim[i] = p; sec[i] = s; amt[i] = a; key[i] = p | s << 4;
  }
  return { prim, sec, amt, lev, ov, key };
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
  const { P, w, h } = S, { prim, sec, amt, key } = S.attrs, d = img.data;
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
  for (const [x, y] of holes) shellHole(c, P, x, y);
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
  // contours: marching squares over the cell-center levels, one line per half level, clamped past the map edge
  const lv = (x, y) => lev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  c.beginPath();
  let any = false;
  for (let y = Math.max(-1, cy0 - 1); y <= cy1; y++) for (let x = Math.max(-1, cx0 - 1); x <= cx1; x++) {
    const a = lv(x, y), b = lv(x + 1, y), cc = lv(x + 1, y + 1), d = lv(x, y + 1);
    const lo = Math.min(a, b, cc, d), hi = Math.max(a, b, cc, d);
    if (lo === hi) continue;
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

// a shell hole lit from the upper right (the sun's side): dark bowl, lit far wall, thrown-out earth around it
function shellHole(c, P, x, y) {
  const r = (0.3 + 0.1 * rnd(x, y, 21)) * P, cx = (x + 0.5 + (rnd(x, y, 22) - 0.5) * 0.3) * P, cy = (y + 0.5 + (rnd(x, y, 23) - 0.5) * 0.3) * P;
  let g = c.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.8);
  g.addColorStop(0, 'rgba(60, 46, 30, 0.65)'); g.addColorStop(1, 'rgba(60, 46, 30, 0)');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r * 1.8, 0, Math.PI * 2); c.fill();
  for (let k = 0; k < 8; k++) {
    const a = rnd(x, y, 30 + k) * Math.PI * 2, dd = r * (1.05 + 0.6 * rnd(x, y, 40 + k)), s = P * (0.025 + 0.03 * rnd(x, y, 50 + k));
    c.fillStyle = k % 3 ? 'rgba(44, 34, 22, 0.8)' : 'rgba(150, 126, 88, 0.7)';
    c.beginPath(); c.arc(cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, s, 0, Math.PI * 2); c.fill();
  }
  g = c.createRadialGradient(cx + r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
  g.addColorStop(0, '#1e1810'); g.addColorStop(0.55, '#33291c'); g.addColorStop(0.85, '#55442e'); g.addColorStop(1, '#6a573b');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(200, 172, 124, 0.55)'; c.lineWidth = r * 0.16;
  c.beginPath(); c.arc(cx, cy, r * 0.84, Math.PI * 0.55, Math.PI * 1.2); c.stroke();
  c.strokeStyle = 'rgba(186, 160, 112, 0.35)'; c.lineWidth = r * 0.12;
  c.beginPath(); c.arc(cx, cy, r * 1.08, Math.PI * 1.55, Math.PI * 2.2); c.stroke();
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

function tilePaint(S, dirty) {
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
  // send just the changed rectangle to the GPU (row 0 of the canvas is the top of the flipped texture)
  if (S.renderer && S.uploaded) {
    const W = rx1 - rx0, H = ry1 - ry0, px = ctx.getImageData(rx0, ry0, W, H);
    const src = new THREE.DataTexture(px.data, W, H);
    S.renderer.copyTextureToTexture(src, S.tex, null, new THREE.Vector2(rx0, canvas.height - ry0 - H));
  } else S.tex.needsUpdate = true;
  S.stats = { kind: 'tiles', tiles: dirty.size, ms: Math.round(performance.now() - t0) };
}

// Repaint whatever changed since the last call (everything the first time).
function paint(S, grid) {
  const prev = S.attrs;
  S.attrs = cellAttrs(S, grid);
  const want = ready ? 'textured' : 'flat';
  if (!prev || S.painted !== want) return fullPaint(S);
  const { w, h } = S, n = w * h, tw = Math.ceil(w / TILE), dirty = new Set(), R = 2;
  const A = S.attrs;
  for (let i = 0; i < n; i++) {
    if (A.prim[i] === prev.prim[i] && A.sec[i] === prev.sec[i] && A.amt[i] === prev.amt[i] && A.lev[i] === prev.lev[i] && A.ov[i] === prev.ov[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (let ty = Math.max(0, y - R) / TILE | 0; ty <= (Math.min(h - 1, y + R) / TILE | 0); ty++)
      for (let tx = Math.max(0, x - R) / TILE | 0; tx <= (Math.min(w - 1, x + R) / TILE | 0); tx++) dirty.add(ty * tw + tx);
  }
  if (!dirty.size) return;
  if (dirty.size > tw * Math.ceil(h / TILE) * 0.5) return fullPaint(S);
  tilePaint(S, dirty);
}

// The ground for a map. Reuses the canvas and GPU texture when the size matches (the editor rebuilds on every edit),
// so a rebuild repaints only the cells that differ.
export function createGround(map, renderer) {
  if (!NA) buildNoise();
  const P = Math.max(8, Math.min(24, Math.floor((gfx.low ? 1280 : 2048) / Math.max(map.w, map.h))));
  if (!cur || cur.w !== map.w || cur.h !== map.h || cur.P !== P) {
    if (cur) { cur.tex.dispose(); cur.material.dispose(); }
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
  const S = cur;
  S.map = map; S.renderer = renderer; S.fields = fieldsOf(map);
  S.repaint = () => fullPaint(S);
  if (typeof window !== 'undefined') window.__ground = S; // debug handle, like window.__game
  return { canvas: S.canvas, ctx: S.ctx, tex: S.tex, px: P, material: S.material, paint: (grid) => paint(S, grid),
    isRoad: (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h && S.attrs?.prim[y * S.w + x] === ROAD, loading };
}
