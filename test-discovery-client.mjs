// A Huge World Conquest map (512 x 512 cells) in the browser: discovery must not redo whole-map work per snapshot.
// Before, a newly seen river cell re-blurred the whole 2048 x 2048 water mask four times (about a second per frame),
// and every snapshot rebuilt the authored map layers for the placement check of planned works.
// Plain asserts: `node test.js` runs this file as one child (test.js childFiles), so no check filter applies inside.
import assert from 'node:assert/strict';
import { createWater } from './client/water.js';
import { placementState } from './client/availability.js';
import { createMinimapTerrain } from './client/minimap-terrain.js';
import { createRelief } from './client/relief.js';
import { CELL, CFG } from './shared/sim.js';

const W = 512, H = 512, SUB = 4, FULL = W * SUB * H * SUB;
// two rivers (one leaving the map), a ford and a bridge; only the northern half is known at first
function world() {
  const rows = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) =>
    Math.abs(x - 140 - Math.round(20 * Math.sin(y / 30))) <= 2 || (y >= 300 && Math.abs(y - 330) <= 1 && x >= 300) ? 'W' : '.'));
  for (let x = 137; x <= 143; x++) rows[200][x] = '=';
  rows[100][140] = 'F';
  return rows;
}
const known = rows => rows.map((row, y) => y < 256 ? [...row] : row.map(() => '.'));
const fresh = grid => createWater(grid, { w: W, h: H, rows: grid.map(r => r.join('')) }, () => 0);
const same = (a, b, label) => {
  const ma = a.mask.image.data, mb = b.mask.image.data;
  let diff = 0; for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) diff++;
  assert.equal(diff, 0, `${label}: mask matches a full rebuild`);
  // the water is drawn in chunks; geometry joins them in chunk order, so a full rebuild must give the same arrays
  for (const key of ['position', 'flow']) assert.deepEqual(a.geometry.attributes[key].array, b.geometry.attributes[key].array, `${label}: ${key}`);
  assert.deepEqual(a.geometry.index.array, b.geometry.index.array, `${label}: triangles`);
};

// Discovered water redraws its mask only around the new cells, exactly as a full rebuild.
{
  const truth = world(), grid = known(truth), water = fresh(grid);
  water.mask.onUpdate?.(); // the first full upload has happened
  const reveal = cells => { for (const c of cells) grid[Math.floor(c / W)][c % W] = truth[Math.floor(c / W)][c % W]; };
  // two scouts far apart each uncover a few river cells, one where a river leaves the map edge
  const steps = [
    ['scouts', [...Array(6).keys()].flatMap(i => [(256 + i) * W + 140 + Math.round(20 * Math.sin((256 + i) / 30)), 330 * W + W - 1 - i])],
    ['bridge built', [210 * W + 150]],
    ['ford dried', [100 * W + 140]],
  ];
  for (const [label, cells] of steps) {
    if (label === 'scouts') reveal(cells);
    else if (label === 'bridge built') { const x = 140 + Math.round(20 * Math.sin(210 / 30)); cells[0] = 210 * W + x; grid[210][x] = '='; }
    else grid[100][140] = '.';
    water.changed(cells.map(c => [c, grid[Math.floor(c / W)][c % W]])); water.tick(0);
    assert.ok(water.stats.maskTexels > 0 && water.stats.maskTexels < FULL / 50, `${label}: ${water.stats.maskTexels} of ${FULL} mask texels blurred`);
    const uploaded = water.mask.updateRanges.reduce((n, r) => n + r.count, 0) / 4;
    assert.ok(uploaded > 0 && uploaded < FULL / 50, `${label}: ${uploaded} texels uploaded`);
    water.mask.clearUpdateRanges(); water.mask.onUpdate?.();
    const full = fresh(grid.map(r => [...r]));
    same(water, full, label);
    full.dispose();
  }
  water.dispose();
}

// Water ignores updates that do not change wet, ford or bridge cells.
{
  const grid = world(), water = fresh(grid);
  water.mask.onUpdate?.();
  water.changed([[140 * W + 140 + Math.round(20 * Math.sin(140 / 30)), 'W']]); water.tick(0);
  assert.equal(water.stats.maskTexels, 0);
  assert.equal(water.mask.updateRanges.length, 0);
  water.dispose();
}

// Placement state uses the live terrain layers without rebuilding the authored map.
{
  let reads = 0;
  const rows = ['....', '.WW.', '....', '....'], grid = rows.map(r => [...r]);
  const map = { w: 4, h: 4, rows, heights: rows.map(() => '0000'), world: true, get layers() { reads++; return undefined; } };
  const view = placementState({ units: [], cells: [], mode: { kind: 'world' }, world: { regions: [] } }, map, grid, [0],
    { groundGrid: grid.map(r => r.map(ch => ch === 'W' ? 'W' : '.')), objectGrid: grid.map(r => r.map(() => '.')) });
  assert.equal(reads, 0, 'must not read the authored layers');
  assert.equal(view.game.ground[5], 'W');
}

// A discovered biome that moves crop fields repaints the cells whose field changed, not every cell of the map (on the
// Huge map that whole-map pass took about 70 ms, more than one snapshot in four while scouting).
{
  // canvas raster stubs; textures fail to load, so the ground paints flat
  const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  class Context {
    constructor(canvas) { this.canvas = canvas; }
    createImageData(w, h) { return image(w, h); }
    getImageData(x, y, w, h) { return image(w, h); }
    putImageData() {} save() {} restore() {} beginPath() {} rect() {} clip() {} arc() {} ellipse() {} fill() {} stroke() {}
    fillRect() {} moveTo() {} lineTo() {} closePath() {} clearRect() {} drawImage() {}
    createRadialGradient() { return { addColorStop() {} }; }
  }
  class Canvas { width = 0; height = 0; getContext() { return this.context ??= new Context(this); } }
  class Image { set src(_) { queueMicrotask(() => this.onerror?.()); } }
  Object.assign(globalThis, { document: { createElement: () => new Canvas() }, Image, window: {} });
  const { createGround, fieldCells, BIOME_LOOKS } = await import('./client/ground.js');
  const w = 128, h = 96, grid = Array.from({ length: h }, () => Array(w).fill('.')), state = new Uint8Array(w * h);
  const map = { w, h, rows: grid.map(r => r.join('')), heights: grid.map(() => '0'.repeat(w)), spawns: [], points: [], world: true, biome: new Uint8Array(w * h).fill(255) };
  const ground = createGround(map);
  ground.paint(grid, state, null, null);
  const before = ground.cells(), fieldsBefore = fieldCells(map), cells = [];
  const farmland = BIOME_LOOKS.findIndex(look => look.name === 'farmland');
  for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) { map.biome[y * w + x] = farmland; cells.push(y * w + x); }
  map.biomeCells = [...cells];
  assert.ok(fieldCells(map).some((v, i) => v !== fieldsBefore[i]), 'the farmland moves some crop fields');
  ground.paint(grid, state, null, null, cells);
  const after = ground.cells();
  assert.equal(after.prim, before.prim, 'the cell layers are updated in place, not recomputed for the whole map');
  const kept = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.slice()]));
  ground.dispose();
  const whole = createGround(map);
  whole.paint(grid, state, null, null);
  for (const [k, v] of Object.entries(whole.cells())) assert.deepEqual(kept[k], v, `cell layer ${k} matches a whole repaint`);
  whole.dispose();
}
// The minimap's terrain is repainted only around changed cells (and cells where a railway was found), and its canvas
// then equals a whole repaint, including where a change moved the ground of the cells beside it. Before, every change
// repainted all 262144 pixels with one ground-height lookup each, four times a second while scouting.
{
  const MW = 288, MH = 240, rail = new Set();
  // a canvas that keeps the pixels putImageData writes, dirty rectangle included
  const canvas = () => { const px = new Uint8ClampedArray(MW * MH * 4); return { px, getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img, dx, dy, x = 0, y = 0, w = img.width, h = img.height) => {
      for (let j = y; j < y + h; j++) px.set(img.data.subarray((j * img.width + x) * 4, (j * img.width + x + w) * 4), ((dy + j) * MW + dx + x) * 4);
    } }) }; };
  const level = (x, y) => Math.floor((x + y) / 9) % 3;
  const grid = Array.from({ length: MH }, (_, y) => Array.from({ length: MW }, (_, x) => (x === 110 || x === 111 ? 'W' : '.')));
  const map = { w: MW, h: MH, rows: grid.map(r => r.join('')), heights: Array.from({ length: MH }, (_, y) => Array.from({ length: MW }, (_, x) => String(level(x, y))).join('')) };
  const relief = createRelief(map, grid, { low: true });
  const options = () => ({ w: MW, h: MH, grid, reach: relief.groundReach, onTrack: c => rail.has(c), height: (x, y) => relief.hAt((x + 0.5) * CELL, (y + 0.5) * CELL) / CFG.levelHeight });
  const live = createMinimapTerrain({ ...options(), canvas: canvas() });
  const change = (label, changes, found = []) => {
    const cells = changes.map(([x, y, ch, lv]) => {
      if (ch) grid[y][x] = ch;
      if (lv !== undefined) map.heights[y] = map.heights[y].slice(0, x) + lv + map.heights[y].slice(x + 1);
      return y * MW + x;
    });
    map.rows = grid.map(r => r.join(''));
    for (const c of found) rail.add(c);
    const before = live.canvas.px.slice();
    live.update([...cells, ...relief.update(cells)], found);
    const whole = createMinimapTerrain({ ...options(), canvas: canvas() });
    let diff = 0, beside = 0;
    for (let i = 0; i < whole.canvas.px.length; i++) if (live.canvas.px[i] !== whole.canvas.px[i]) diff++;
    // pixels of cells next to the changed ones that moved: the reach is needed, not decoration
    for (let i = 0; i < before.length; i += 4) if (before[i] !== whole.canvas.px[i] && !cells.includes(i / 4)) beside++;
    assert.equal(diff, 0, `${label}: the minimap equals a whole repaint`);
    assert.ok(live.stats.cells < MW * MH / 20, `${label}: only the cells around the change are painted (${live.stats.cells})`);
    return beside;
  };
  // flooded bank cells lower the ground at the centres of the cells beside them: the reach is needed there
  assert.ok(change('banks flooded', [[109, 120, 'W', '0'], [112, 120, 'W', '0']]) > 0, 'the flood moved the ground beside it');
  change('ground raised and dug, across a 64-cell tile border', [[63, 40, undefined, 4], [64, 40, undefined, 4], [64, 41, '+', '0'], [65, 41, '+', '0']]);
  change('a river cell filled in high', [[110, 100, '.', '3'], [111, 100, '.', '3']]);
  change('houses and a road found', [[200, 200, 'B'], [201, 200, 'B'], [202, 200, 'D']]);
  change('a railway found on cells already known', [], [150 * MW + 30, 150 * MW + 31, 151 * MW + 32]);
}
console.log('discovery client checks passed');
