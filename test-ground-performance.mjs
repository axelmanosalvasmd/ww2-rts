import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep the raster buffers real. Canvas path drawing is unchanged by this patch and is outside
// these checks; image loading fails explicitly so both golden and current paints use flat tiles.
function canvasAdapter() {
  const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  class Canvas {
    width = 0; height = 0;
    getContext() { return this.context ??= new Context(this); }
  }
  class Context {
    constructor(canvas) { this.canvas = canvas; }
    pixels() {
      const { width, height } = this.canvas;
      if (this.buffer?.width !== width || this.buffer?.height !== height) this.buffer = image(width, height);
      return this.buffer;
    }
    createImageData(w, h) { return image(w, h); }
    putImageData(source, x, y) {
      this.puts = (this.puts ?? 0) + 1;
      const target = this.pixels();
      for (let row = 0; row < source.height; row++) target.data.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((y + row) * target.width + x) * 4);
    }
    getImageData(x, y, w, h) {
      const source = this.pixels(), target = image(w, h);
      for (let row = 0; row < h; row++) target.data.set(source.data.subarray(((y + row) * source.width + x) * 4, ((y + row) * source.width + x + w) * 4), row * w * 4);
      return target;
    }
    save() {} restore() {} beginPath() {} rect() {} clip() {} arc() {} ellipse() {} fill() {} stroke() {}
    fillRect() {} moveTo() {} lineTo() {} closePath() {} clearRect() {} drawImage() {}
    createRadialGradient() { return { addColorStop() {} }; }
  }
  class Image {
    set src(_) { queueMicrotask(() => this.onerror?.()); }
  }
  return { document: { createElement: () => new Canvas() }, Image, window: {} };
}

const HASHES = {
  "clean": "4996c6d036e9c19e34e744b4721250f0113029c00f00625f28c5351a50658b96",
  "isolated-and-edges": "572f259a7c026e4bc0b994148f847da90f8b8bb5752c81bf391f7c30cb58580b",
  "mixed-wide-patch": "bea6d4cd13f4bab718f34c40f9fa53066ba1fc75bbabff69490ea65b7af32dfe",
  "horizontal-and-vertical-runs": "8251f522ff9a4a3bbfdfd9c9f9d98019185dc64d3b3bf3e812dfec5848cb6021",
  "clear-scar-and-burn": "1642970ff2059d84343bfc227272d6e3b8ee0751c5c8b0bca07667b0dce34c52",
  "restore-scar-and-burn": "b0fe1c12952256e7b3d7f6f7f29213c6f7522955676eb0b26d2b8ce1614820b4"
};
const hash = pixels => createHash('sha256').update(pixels).digest('hex');

export async function runGroundPerformanceTests({ modulePath = new URL('./client/ground.js', import.meta.url), generate = false, capture = null } = {}) {
  const saved = Object.fromEntries(['document', 'Image', 'window'].map(k => [k, { had: Object.hasOwn(globalThis, k), value: globalThis[k] }]));
  Object.assign(globalThis, canvasAdapter());
  try {
    const { createGround } = await import(modulePath.href ?? modulePath);
    const w = 20, h = 16, grid = Array.from({ length: h }, () => Array(w).fill('.'));
    const map = { w, h, rows: grid.map(r => r.join('')), heights: grid.map(() => '0'.repeat(w)), spawns: [{ x: 10, y: 8 }], points: [] };
    const state = new Uint8Array(w * h), ground = createGround(map);
    await ground.loading;
    const actual = {}, frames = {};
    const check = name => {
      ground.paint(grid, state);
      const pixels = ground.ctx.getImageData(0, 0, w * ground.px, h * ground.px).data;
      actual[name] = hash(pixels); frames[name] = pixels.slice();
      if (!generate) assert.equal(actual[name], HASHES[name], `${name}: preserve all legacy terrain raster pixels`);
      ground.paint(grid, state);
      assert.deepEqual(ground.ctx.getImageData(0, 0, w * ground.px, h * ground.px).data, pixels, `${name}: repaint unchanged terrain identically`);
    };
    check('clean');
    grid[0][0] = '+'; grid[h - 1][w - 1] = 'R'; grid[7][7] = '+'; state[11 * w + 4] = 4;
    check('isolated-and-edges');
    for (let y = 5; y <= 9; y++) for (let x = 8; x <= 12; x++) grid[y][x] = x < 10 ? 'R' : '+';
    check('mixed-wide-patch');
    for (let x = 1; x <= 18; x++) grid[2][x] = '+';
    for (let y = 3; y <= 13; y++) grid[y][16] = 'R';
    check('horizontal-and-vertical-runs');
    for (let y = 5; y <= 9; y++) for (let x = 8; x <= 12; x++) grid[y][x] = '.';
    state[11 * w + 4] = 0;
    check('clear-scar-and-burn');
    state[11 * w + 4] = 4;
    grid[8][10] = 'R';
    check('restore-scar-and-burn');

    // Force a fresh backing canvas through the same interface, then paint the final fixture in full.
    createGround({ ...map, w: w + 1, rows: grid.map(r => r.join('') + '.') });
    const fresh = createGround(map);
    await fresh.loading; fresh.paint(grid, state);
    const full = fresh.ctx.getImageData(0, 0, w * fresh.px, h * fresh.px).data;
    assert.deepEqual(full, frames['restore-scar-and-burn'], 'incremental painting matches a fresh full paint');
    if (!generate) {
      const pending = new Map(); let nextFrame = 0;
      const frames = { request(fn) { const id = ++nextFrame; pending.set(id, fn); return id; }, cancel(id) { pending.delete(id); } };
      const pump = () => { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(); };
      const options = { frames, budgetMs: 1000000, tilesPerFrame: 2 };
      const copies = [];
      const renderer = { copyTextureToTexture(source, texture, _, at) { copies.push({ data: source.image.data.slice(), width: source.image.width, height: source.image.height, x: at.x, y: at.y }); } };
      const queuedGrid = map.rows.map(row => [...row]), queuedState = new Uint8Array(w * h);
      createGround({ ...map, w: w + 1, rows: grid.map(r => r.join('') + '.') });
      const queued = createGround(map, renderer, options);
      await queued.loading; queued.paint(queuedGrid, queuedState); queued.tex.onUpdate();
      const original = queued.ctx.getImageData(0, 0, w * queued.px, h * queued.px).data;
      const beforePuts = queued.ctx.puts;
      for (let y = 4; y <= 10; y++) for (let x = 5; x <= 13; x++) queuedGrid[y][x] = '+';
      queued.paint(queuedGrid, queuedState);
      assert.equal(queued.ctx.puts, beforePuts, 'a queued incremental paint returns before painting texture pixels');
      assert.equal(pending.size, 1, 'one requested frame covers the pending dirty tiles');
      pump();
      assert.ok(queued.ctx.puts - beforePuts <= 2, 'the frame paints at most the requested two tiles');
      assert.ok(copies.length === 1, 'a frame uploads its painted texture subregions in one batch');
      assert.ok(copies.every(c => c.data.length > 0 && c.x >= 0 && c.y >= 0), 'queued GPU updates contain the painted RGBA subregion');
      assert.deepEqual(copies[0].data, queued.ctx.getImageData(copies[0].x, queued.canvas.height - copies[0].y - copies[0].height, copies[0].width, copies[0].height).data, 'the GPU batch contains exactly the painted canvas rectangle');
      // A newer snapshot changes the same scar, another tile, a height and a burn before older tiles finish.
      queuedGrid[7][8] = 'R'; queuedGrid[12][17] = 'R'; queuedState[11 * w + 3] = 4;
      map.heights[7] = map.heights[7].slice(0, 8) + 'a' + map.heights[7].slice(9);
      queued.paint(queuedGrid, queuedState);
      queued.paint(queuedGrid, queuedState);
      assert.equal(pending.size, 1, 'new and clean snapshots keep one coalesced frame request');
      let pumped = 1;
      while (pending.size) { assert.ok(pumped++ < 100, 'pending work finishes within the finite tile set'); const start = queued.ctx.puts, uploaded = copies.length; pump(); assert.ok(queued.ctx.puts - start <= 2, 'every frame respects its tile count'); assert.equal(copies.length - uploaded, 1, 'each queued frame makes one GPU upload'); }
      const incremental = queued.ctx.getImageData(0, 0, w * queued.px, h * queued.px).data;
      assert.notDeepEqual(incremental, original, 'the queued damage appears');
      createGround({ ...map, w: w + 1, rows: grid.map(r => r.join('') + '.') });
      const reference = createGround(map); await reference.loading; reference.paint(queuedGrid, queuedState);
      assert.deepEqual(incremental, reference.ctx.getImageData(0, 0, w * reference.px, h * reference.px).data, 'coalesced queued painting matches a full paint of the latest state');

      const cancelGround = createGround(map, null, options);
      queuedGrid[3][4] = 'R'; cancelGround.paint(queuedGrid, queuedState);
      assert.equal(pending.size, 1);
      cancelGround.dispose();
      assert.equal(pending.size, 0, 'disposing a ground handle cancels its frame');
      const recreated = createGround(map, null, options); recreated.paint(queuedGrid, queuedState);
      const restored = recreated.ctx.getImageData(0, 0, w * recreated.px, h * recreated.px).data;
      createGround({ ...map, w: w + 1, rows: grid.map(r => r.join('') + '.') });
      const restoredReference = createGround(map); restoredReference.paint(queuedGrid, queuedState);
      assert.deepEqual(restored, restoredReference.ctx.getImageData(0, 0, w * restoredReference.px, h * restoredReference.px).data, 'same-size recreation repaints work canceled by disposal');
      const owner = createGround(map, null, options);
      queuedGrid[3][5] = '+'; owner.paint(queuedGrid, queuedState);
      restoredReference.dispose();
      assert.equal(pending.size, 1, 'disposing an old handle cannot cancel a newer owner');
      createGround({ ...map, w: w + 1, rows: grid.map(r => r.join('') + '.') });
      assert.equal(pending.size, 0, 'replacing the backing canvas cancels old work');

      const latest = createGround(map); latest.paint(queuedGrid, queuedState);
      const latestPixels = latest.ctx.getImageData(0, 0, w * latest.px, h * latest.px).data;
      const waitingImages = [];
      globalThis.Image = class { set src(_) { waitingImages.push(this); } };
      const pendingModule = new URL(modulePath.href ?? modulePath); pendingModule.searchParams.set('texture-ready-check', '1');
      const { createGround: delayedGround } = await import(pendingModule.href);
      const delayed = delayedGround(map, null, options); delayed.paint(map.rows.map(r => [...r]));
      delayed.paint(queuedGrid, queuedState);
      assert.equal(pending.size, 1, 'incremental work can be queued while textures are loading');
      for (const image of waitingImages) image.onerror();
      const putsAtReady = delayed.ctx.puts;
      await delayed.loading;
      assert.equal(delayed.ctx.puts, putsAtReady, 'texture readiness does not repaint the whole ground in one frame');
      assert.equal(pending.size, 1, 'it joins the queued work instead');
      for (let n = 0; pending.size; n++) { assert.ok(n < 100, 'the texture repaint finishes'); const start = delayed.ctx.puts; pump(); assert.ok(delayed.ctx.puts - start <= 2, 'within each frame\'s tile count'); }
      assert.deepEqual(delayed.ctx.getImageData(0, 0, w * delayed.px, h * delayed.px).data, latestPixels, 'the queued texture repaint ends at the latest state, as a full paint');
    }
    if (capture) {
      await writeFile(capture, full);
      await writeFile(capture + '.json', JSON.stringify({ width: w * fresh.px, height: h * fresh.px, format: 'RGBA', overlayDrawing: false }));
    }
    return actual;
  } finally {
    for (const [key, old] of Object.entries(saved)) { if (old.had) globalThis[key] = old.value; else delete globalThis[key]; }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const modulePath = arg('--ground-root') ? pathToFileURL(resolve(arg('--ground-root'), 'client/ground.js')) : new URL('./client/ground.js', import.meta.url);
  const result = await runGroundPerformanceTests({ modulePath, generate: process.argv.includes('--generate'), capture: arg('--capture-rgba') });
  console.log(process.argv.includes('--generate') ? JSON.stringify(result, null, 2) : 'Ground performance pixel checks passed');
}
