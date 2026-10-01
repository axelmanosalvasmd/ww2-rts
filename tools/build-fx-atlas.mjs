// Builds the combat effect textures from the generated source images (DESIGN.md, Look and feel: Combat effects).
// usage: node tools/build-fx-atlas.mjs [rawDir]
// Needs ImageMagick (convert, identify) on the PATH. The sources are gpt-image-2 pictures with real alpha (smoke,
// fire and explosion sprite sheets, dirt plumes, dust kicks, debris, muzzle flashes and a crater), kept outside the
// repo in ~/.local/share/ww2-rts/fx-raw/<date>/. Output:
//   client/textures/fx-atlas.webp  8 x 8 cells of 256 px, cell f at column f % 8, row floor(f / 8) from the top.
//     Lit cells (smoke, dust, dirt, debris): R and B = the sprite's surface normal x and y (0.5 = flat, y up),
//     G = brightness detail (0.5 = the sprite's average), A = density.
//     Emissive cells (fire, fireballs, muzzle flashes, glow, tracer, spark, ember): RGB = color (sRGB), A = alpha.
//     client/fx.js loads it with premultiplyAlpha, so color is never read from fully clear pixels.
//   client/textures/fx-crater.webp  a shell crater seen from above (sRGB color, alpha = how much shows).
// Cell numbers must match CELL in client/fx.js.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = process.argv[2] ?? join(homedir(), '.local/share/ww2-rts/fx-raw/2026-10-01');
const OUT = join(ROOT, 'client/textures');
const N = 8, C = 256, W = N * C;

// ---------- images: straight RGBA as floats 0..1 ----------
function load(name) {
  const file = join(RAW, `${name}.png`);
  const [w, h] = execFileSync('identify', ['-format', '%w %h', file]).toString().split(' ').map(Number);
  const raw = execFileSync('convert', [file, '-alpha', 'on', '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 28 });
  const p = new Float32Array(w * h * 4);
  for (let i = 0; i < p.length; i++) p[i] = raw[i] / 255;
  return { w, h, p };
}
function save(file, w, h, p, opts) {
  const b = Buffer.alloc(w * h * 4);
  for (let i = 0; i < b.length; i++) b[i] = Math.round(Math.max(0, Math.min(1, p[i])) * 255);
  execFileSync('convert', ['-size', `${w}x${h}`, '-depth', '8', 'rgba:-', ...opts, file], { input: b, maxBuffer: 1 << 28 });
}
const crop = (im, x0, y0, w, h) => {
  const p = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) p.set(im.p.subarray(((y0 + y) * im.w + x0) * 4, ((y0 + y) * im.w + x0 + w) * 4), y * w * 4);
  return { w, h, p };
};
const grid = (im, cols, rows) => {
  const out = [], cw = Math.floor(im.w / cols), ch = Math.floor(im.h / rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(crop(im, c * cw, r * ch, cw, ch));
  return out;
};
// alpha bounding box
function bbox(im, thr = 0.04) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.p[(y * im.w + x) * 4 + 3] > thr) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// the red fringe the generator leaves around fire: pure red, half clear pixels
function defringe(im) {
  for (let i = 0; i < im.p.length; i += 4) {
    const r = im.p[i], g = im.p[i + 1], b = im.p[i + 2];
    if (r > 0.3 && g < 0.32 * r && b < 0.32 * r) im.p[i + 3] *= Math.max(0, Math.min(1, (g / r - 0.1) / 0.22));
  }
  return im;
}
// premultiplied bilinear sample
function sample(im, x, y, out) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const xx = x0 + dx, yy = y0 + dy;
    if (xx < 0 || yy < 0 || xx >= im.w || yy >= im.h || wt === 0) continue;
    const o = (yy * im.w + xx) * 4, a = im.p[o + 3] * wt;
    out[0] += im.p[o] * a; out[1] += im.p[o + 1] * a; out[2] += im.p[o + 2] * a; out[3] += a;
  }
}
// draw source box bb into a C x C cell (premultiplied), scale = cell px per source px, (ox, oy) = where bb's corner lands
function place(im, bb, scale, ox, oy) {
  const cell = new Float32Array(C * C * 4), k = Math.min(4, Math.max(1, Math.ceil(1 / scale))), s = [0, 0, 0, 0];
  for (let v = 0; v < C; v++) for (let u = 0; u < C; u++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      sample(im, bb.x + (u + (i + 0.5) / k - ox) / scale, bb.y + (v + (j + 0.5) / k - oy) / scale, s);
      r += s[0]; g += s[1]; b += s[2]; a += s[3];
    }
    const o = (v * C + u) * 4, kk = k * k;
    cell[o] = r / kk; cell[o + 1] = g / kk; cell[o + 2] = b / kk; cell[o + 3] = a / kk;
  }
  // a clear border so mipmaps don't bleed between cells
  for (let v = 0; v < C; v++) for (let u = 0; u < C; u++) {
    const e = Math.min(u, v, C - 1 - u, C - 1 - v), f = Math.min(1, Math.max(0, (e - 2) / 4));
    if (f < 1) for (let c = 0; c < 4; c++) cell[(v * C + u) * 4 + c] *= f;
  }
  return cell;
}
const M = 10; // margin in cell pixels
const fitCenter = (im, bb, scale = Math.min((C - 2 * M) / bb.w, (C - 2 * M) / bb.h)) => place(im, bb, scale, (C - bb.w * scale) / 2, (C - bb.h * scale) / 2);
const fitBottom = (im, bb, scale = Math.min((C - 2 * M) / bb.w, (C - 2 * M) / bb.h)) => place(im, bb, scale, (C - bb.w * scale) / 2, C - M - bb.h * scale);
const fitLeft = (im, bb) => { const scale = Math.min((C - 2 * M) / bb.w, (C - 2 * M) / bb.h); return place(im, bb, scale, M, (C - bb.h * scale) / 2); };

// ---------- encoders: premultiplied cell -> straight output cell ----------
function blur(src, r) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < C; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * C + Math.max(0, Math.min(C - 1, x))]; for (let x = 0; x < C; x++) { b[y * C + x] = s / (2 * r + 1); s += a[y * C + Math.min(C - 1, x + r + 1)] - a[y * C + Math.max(0, x - r)]; } }
    for (let x = 0; x < C; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.max(0, Math.min(C - 1, y)) * C + x]; for (let y = 0; y < C; y++) { a[y * C + x] = s / (2 * r + 1); s += b[Math.min(C - 1, y + r + 1) * C + x] - b[Math.max(0, y - r) * C + x]; } }
  }
  return a;
}
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// kind 'smoke': density softened toward the edges, detail = local contrast only (the picture's own light is removed,
// the game lights it); 'solid': density = alpha, detail = brightness against the sprite's average
function lit(cell, kind, bump = 10) {
  const n = C * C, A = new Float32Array(n), L = new Float32Array(n);
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) { const a = cell[i * 4 + 3]; A[i] = a; L[i] = a > 1e-4 ? lum(cell[i * 4] / a, cell[i * 4 + 1] / a, cell[i * 4 + 2] / a) : 0; if (a > 0.5) { sum += L[i]; cnt++; } }
  const mean = cnt ? sum / cnt : 0.5, Ab = blur(A, 9), Lb = blur(L.map((v, i) => v * A[i]), 14), Abl = blur(A, 14);
  const D = new Float32Array(n), G = new Float32Array(n), H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lb = Abl[i] > 1e-3 ? Lb[i] / Abl[i] : mean;
    if (kind === 'smoke') {
      D[i] = A[i] * (0.35 + 0.65 * Math.min(1, Ab[i] * 1.15));
      G[i] = 0.5 + (L[i] - lb) * 1.6;
    } else {
      D[i] = A[i];
      G[i] = 0.5 * L[i] / Math.max(0.05, mean);
    }
    H[i] = D[i] + (L[i] - lb) * 0.5 * A[i];
  }
  const Hb = blur(H, kind === 'smoke' ? 4 : 2), out = new Float32Array(n * 4);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const i = y * C + x, gx = (Hb[y * C + Math.min(C - 1, x + 1)] - Hb[y * C + Math.max(0, x - 1)]) / 2, gy = (Hb[Math.min(C - 1, y + 1) * C + x] - Hb[Math.max(0, y - 1) * C + x]) / 2;
    // image y runs down, the sprite's y up: a slope down the image is a normal pointing up
    let nx = -gx * bump, ny = gy * bump; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
    out[i * 4] = nx * 0.5 + 0.5; out[i * 4 + 1] = Math.max(0.05, Math.min(0.95, G[i])); out[i * 4 + 2] = ny * 0.5 + 0.5; out[i * 4 + 3] = D[i];
  }
  return out;
}
function emissive(cell) {
  const out = new Float32Array(C * C * 4);
  for (let i = 0; i < C * C; i++) {
    const a = cell[i * 4 + 3];
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a > 1e-4 ? cell[i * 4 + c] / a : 0;
    out[i * 4 + 3] = a;
  }
  return out;
}
// procedural emissive cells, white: f(u, v) -> alpha with u, v in -1..1 (v up)
function shape(f) {
  const out = new Float32Array(C * C * 4);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const u = (x + 0.5) / C * 2 - 1, v = 1 - (y + 0.5) / C * 2, a = Math.max(0, Math.min(1, f(u, v))), o = (y * C + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = 1; out[o + 3] = a;
  }
  return out;
}
// procedural lit cell: a soft round puff
function puff() {
  const cell = new Float32Array(C * C * 4);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1, r = Math.hypot(u, v), a = Math.max(0, 1 - r / 0.9) ** 1.6, o = (y * C + x) * 4;
    cell[o] = cell[o + 1] = cell[o + 2] = 0.6 * a; cell[o + 3] = a;
  }
  return lit(cell, 'smoke');
}

// ---------- the atlas ----------
const atlas = new Float32Array(W * W * 4);
const put = (f, cell) => { const cx = (f % N) * C, cy = Math.floor(f / N) * C; for (let y = 0; y < C; y++) atlas.set(cell.subarray(y * C * 4, (y + 1) * C * 4), ((cy + y) * W + cx) * 4); };

// 0-3 billowing smoke, 4-7 thin wisps
grid(load('smoke-billow'), 2, 2).forEach((im, i) => put(i, lit(fitCenter(im, bbox(im)), 'smoke')));
grid(load('smoke-wisp'), 2, 2).forEach((im, i) => put(4 + i, lit(fitCenter(im, bbox(im)), 'smoke')));
// 8-23 a flame, 16 frames, standing on the cell's bottom edge (one scale for all, so it doesn't pump)
{
  const frames = grid(defringe(load('fire-flipbook')), 4, 4), boxes = frames.map(im => bbox(im, 0.06));
  const scale = Math.min(...boxes.map(b => (C - 2 * M) / b.h), ...boxes.map(b => (C - 2 * M) / b.w));
  frames.forEach((im, i) => put(8 + i, emissive(fitBottom(im, boxes[i], scale))));
}
// 24-38 a fireball cooling into smoke: frames 1-15 of the sheet (frame 0 is a starburst), centered, one scale
{
  const frames = grid(defringe(load('explosion-flipbook')), 4, 4).slice(1), boxes = frames.map(im => bbox(im, 0.06));
  const scale = Math.min(...boxes.map(b => (C - 2 * M) / Math.max(b.w, b.h)));
  frames.forEach((im, i) => put(24 + i, emissive(fitCenter(im, boxes[i], scale))));
}
// 39 the flash: a tight soft glow, no rays
put(39, shape((u, v) => Math.exp(-(u * u + v * v) * 9) * 1.05));
// 40-43 dirt thrown up by a shell, 44-47 dust kicked up by a bullet, all standing on the bottom edge
grid(load('dirt-plume'), 2, 2).forEach((im, i) => put(40 + i, lit(fitBottom(im, bbox(im)), 'solid', 6)));
grid(load('dust-kick'), 2, 2).forEach((im, i) => put(44 + i, lit(fitBottom(im, bbox(im)), 'solid', 6)));
// 48-55 debris: two soil clods, two bricks, stone, concrete, wood, scorched metal
{
  const parts = grid(load('debris'), 4, 4);
  [0, 5, 1, 6, 2, 8, 9, 12].forEach((k, i) => put(48 + i, lit(fitCenter(parts[k], bbox(parts[k])), 'solid', 4)));
}
// 56-59 muzzle flashes seen from the side, the muzzle on the left
grid(defringe(load('muzzle')), 2, 2).forEach((im, i) => put(56 + i, emissive(fitLeft(im, bbox(im)))));
// 60 tracer: a thin streak brightest at its head (u = 1), 61 spark: a short streak, 62 a soft lit puff, 63 ember
put(60, shape((u, v) => Math.exp(-((v / 0.16) ** 2)) * Math.min(1, (u + 1) / 1.6) ** 1.5 * Math.min(1, (1 - u) / 0.06)));
put(61, shape((u, v) => Math.exp(-((v / 0.3) ** 2)) * Math.max(0, 1 - Math.abs(u)) ** 0.7));
put(62, puff());
put(63, shape((u, v) => Math.exp(-(u * u + v * v) * 5)));

save(join(OUT, 'fx-atlas.webp'), W, W, atlas, ['-define', 'webp:alpha-quality=100', '-define', 'webp:use-sharp-yuv=true', '-define', 'webp:method=6', '-quality', '90']);

// ---------- the crater ----------
{
  const im = load('crater'), S = 512, bb = bbox(im, 0.1), cell = new Float32Array(S * S * 4), s = [0, 0, 0, 0];
  const scale = Math.min(S / bb.w, S / bb.h) * 0.96, ox = (S - bb.w * scale) / 2, oy = (S - bb.h * scale) / 2;
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
    const o = (v * S + u) * 4;
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { sample(im, bb.x + (u + (i + 0.5) / 2 - ox) / scale, bb.y + (v + (j + 0.5) / 2 - oy) / scale, s); r += s[0]; g += s[1]; b += s[2]; a += s[3]; }
    // fade out toward a circle's edge, so no corner of the picture shows
    const d = Math.hypot(u - S / 2, v - S / 2) / (S / 2), edge = Math.max(0, Math.min(1, (1 - d) / 0.18));
    cell[o] = a > 1e-4 ? r / a : 0; cell[o + 1] = a > 1e-4 ? g / a : 0; cell[o + 2] = a > 1e-4 ? b / a : 0; cell[o + 3] = (a / 4) * edge;
    if (cell[o + 3] > 0.9) { sr += cell[o]; sg += cell[o + 1]; sb += cell[o + 2]; sn++; }
  }
  // clear pixels take the soil's average color, so filtering never darkens the rim
  for (let i = 0; i < S * S; i++) if (cell[i * 4 + 3] < 0.02) { cell[i * 4] = sr / sn; cell[i * 4 + 1] = sg / sn; cell[i * 4 + 2] = sb / sn; }
  save(join(OUT, 'fx-crater.webp'), S, S, cell, ['-define', 'webp:alpha-quality=100', '-define', 'webp:exact=true', '-quality', '88']);
}
console.log('wrote client/textures/fx-atlas.webp and fx-crater.webp');
