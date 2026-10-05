// Headless JavaScript raster benchmark. Flat texture fallback and no-op Canvas paths exclude
// browser drawing, GPU uploads and mipmap work. Run separately for each revision and compare medians.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const root = resolve(arg('--root') ?? fileURLToPath(new URL('../', import.meta.url)));
const blank = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
let puts = 0, checksum = 0;
const context = new Proxy({
  createImageData: blank,
  getImageData: (_x, _y, width, height) => blank(width, height),
  putImageData(image) { puts++; checksum = (checksum + image.data[0] + image.data.at(-1)) >>> 0; },
  createRadialGradient: () => ({ addColorStop() {} })
}, { get: (object, key) => object[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
globalThis.Image = class {}; // Intentionally keep createGround's flat texture fallback.
globalThis.window = {};
const { createGround } = await import(pathToFileURL(resolve(root, 'client/ground.js')).href);
const map = arg('--map') ? JSON.parse(readFileSync(resolve(arg('--map')), 'utf8')) : {
  w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), heights: Array(80).fill('0'.repeat(80)), spawns: [], points: []
};
map.heights ??= Array(map.h).fill('0'.repeat(map.w));
const grid = map.rows.map(row => [...row]), pending = new Map(); let nextId = 0;
const frames = { request(fn) { const id = ++nextId; pending.set(id, fn); return id; }, cancel(id) { pending.delete(id); } };
const deferred = process.argv.includes('--deferred');
const ground = createGround(map, null, deferred ? { frames, budgetMs: 6, tilesPerFrame: 2 } : {});
const centerX = Math.floor(map.w / 2), centerY = Math.floor(map.h / 2);
function run(name) {
  const firstPuts = puts, started = performance.now(); ground.paint(grid);
  const handlerMs = performance.now() - started, frameMs = []; let paintedTiles = 0;
  const stats = { ...window.__ground.stats };
  while (pending.size) {
    const [id, fn] = pending.entries().next().value; pending.delete(id);
    const before = puts, start = performance.now(); fn(); frameMs.push(performance.now() - start); paintedTiles += puts - before;
  }
  console.log(JSON.stringify({ case: name, handlerMs, totalMs: handlerMs + frameMs.reduce((a, b) => a + b, 0), frames: frameMs.length,
    maxFrameMs: frameMs.length ? Math.max(...frameMs) : 0, paintedTiles: frameMs.length ? paintedTiles : stats.tiles, puts: puts - firstPuts,
    pixelsPerCell: ground.px, checksum, stats }));
}
run('initial');
for (const size of [1, 3, 5, 9]) {
  const half = Math.floor(size / 2);
  for (let y = centerY - half; y <= centerY + half; y++) for (let x = centerX - half; x <= centerX + half; x++) {
    if (y < 0 || x < 0 || y >= map.h || x >= map.w) continue;
    grid[y][x] = '+'; map.heights[y] = map.heights[y].slice(0, x) + 'a' + map.heights[y].slice(x + 1);
  }
  run(`crater${size}x${size}`); run(`unchanged${size}x${size}`);
}
ground.dispose?.();
