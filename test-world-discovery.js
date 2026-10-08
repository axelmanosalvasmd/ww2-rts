import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Candidate generation has no canvas dependency. Its ground module imports image loading in browsers.
const originalImage = globalThis.Image;
globalThis.Image = class { set src(value) { this.onerror?.(); } };
const { candidates, candidateBatches } = await import('./client/props.js');
if (originalImage === undefined) delete globalThis.Image;
else globalThis.Image = originalImage;
assert.equal(typeof candidateBatches, 'function', 'discovery scenery must support bounded preparation across frames');
const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), world: {}, discovered: new Uint8Array(64 * 64) };
for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) map.discovered[y * map.w + x] = 1;
map.rows[20] = '.'.repeat(12) + 'H'.repeat(25) + '.'.repeat(27);
map.rows[30] = '.'.repeat(20) + 'OOOBB' + '.'.repeat(39);
const expected = candidates(map), work = candidateBatches(map);
let batch = work.next(), steps = 1;
assert.equal(batch.done, false, 'preparing scenery yields before completing the continent');
while (!batch.done) { batch = work.next(); steps++; }
assert.ok(steps >= map.h, 'preparation yields between rows rather than doing a full map scan in one batch');
assert.deepEqual(batch.value, expected, 'finishing preparation preserves deterministic placements and caps');
assert.ok(batch.value.length > 0, 'the fixture exercises actual scenery');
assert.ok(batch.value.every(c => map.discovered[c.cy * map.w + c.cx]), 'undiscovered scenery stays private');
console.log('PASS: bounded discovery scenery preparation and deterministic results');

// Exercise the real attribute builder without invoking canvas painting or GPU uploads.
const groundSource = readFileSync(new URL('./client/ground.js', import.meta.url), 'utf8')
  .replace("from 'three'", `from '${import.meta.resolve('three')}'`)
  .replace("from '../shared/sim.js'", `from '${new URL('./shared/sim.js', import.meta.url)}'`)
  .replace("from './gfx.js'", `from '${new URL('./client/gfx.js', import.meta.url)}'`);
globalThis.Image = class { set src(value) { this.onerror?.(); } };
const ground = await import('data:text/javascript;base64,' + Buffer.from(groundSource + '\nexport { cellAttrs, buildNoise };').toString('base64'));
if (originalImage === undefined) delete globalThis.Image;
else globalThis.Image = originalImage;
ground.buildNoise();
const w = 128, rows = Array(w).fill('.'.repeat(w)), state = new Uint8Array(w * w);
let reads = 0;
const grid = rows.map(row => new Proxy([...row], { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key]; } }));
const data = { w, h: w, map: { rows }, fields: new Uint8Array(w * w), state };
data.attrs = ground.cellAttrs(data, grid);
const oldPrim = data.attrs.prim, c = 64 * w + 64;
grid[64][64] = 'R';
const affected = new Set();
for (let y = 57; y <= 71; y++) for (let x = 57; x <= 71; x++) affected.add(y * w + x);
reads = 0;
const partial = ground.cellAttrs(data, grid, affected);
assert.ok(reads < 5000, `a single terrain change must not rescan the continent (${reads} grid reads)`);
assert.equal(partial.prim, oldPrim, 'small updates retain the existing material buffers');
assert.equal(partial.scar[c], 2, 'discovered rubble gets its scar');
const full = ground.cellAttrs({ ...data, attrs: null }, grid);
assert.deepEqual(partial, full, 'local material, scar proximity and depth updates match a full rebuild');
grid[64][64] = '.';
const cleared = ground.cellAttrs(data, grid, affected);
assert.equal(cleared.scar[c], 0, 'removing rubble clears the old scar');
assert.deepEqual(cleared, ground.cellAttrs({ ...data, attrs: null }, grid), 'scar removal restores neighboring material data');
data.map.heights = Array(w).fill('0'.repeat(w));
data.groundGrid = rows.map(row => [...row]); data.objectGrid = rows.map(row => [...row]);
for (let step = 0; step < 30; step++) {
  const x = 60 + step % 7, y = 60 + Math.floor(step / 7), i = y * w + x;
  const ch = ['R', '+', 'T', 'W', 'F', '=', 'B', 'D', 'N', '.'][step % 10];
  grid[y][x] = ch; rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  data.map.heights[y] = data.map.heights[y].slice(0, x) + (step % 4) + data.map.heights[y].slice(x + 1);
  state[i] = step % 8; data.groundGrid[y][x] = 'D';
  const nearby = new Set();
  for (let ny = y - 7; ny <= y + 7; ny++) for (let nx = x - 7; nx <= x + 7; nx++) nearby.add(ny * w + nx);
  data.attrs = ground.cellAttrs(data, grid, nearby);
  assert.deepEqual(data.attrs, ground.cellAttrs({ ...data, attrs: null }, grid),
    `local height, damage, trench, water and layered mine attributes match full rebuilds after change ${step}`);
}
console.log('PASS: local discovery ground attributes match full terrain rebuilds');
