// The map's 3D pieces (client/structures.js) are kept in chunks: a change rebuilds only the chunks that read it, and
// after every change the pieces equal a fresh build of the final map, kind by kind and instance by instance, picking
// included. The changes cover long bomb scars, ruined and new houses across chunk borders, a church moving, walls,
// trenches, wire, a stone bridge growing, a ramp at its end, water beside raised ground, landmarks and damage stages.
// Plain asserts: `node test.js` runs this file as one child (test.js childFiles), so no check filter applies inside.
import assert from 'node:assert/strict';
import * as THREE from 'three';

// the textures the pieces' materials paint need a canvas; nothing here reads the pixels
const anything = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anything), apply: () => anything, set: () => true });
const context = () => new Proxy({ getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
  { get: (t, k) => (k in t ? t[k] : anything), set: () => true });
class Canvas { constructor() { this.width = 0; this.height = 0; } getContext() { return (this.pen ||= context()); } }
class Img { addEventListener() {} removeEventListener() {} set src(_) { queueMicrotask(() => this.onerror?.()); } }
globalThis.document = { createElement: () => new Canvas(), createElementNS: () => new Img() };
globalThis.Image = Img; globalThis.window = globalThis;

const { CELL } = await import('./shared/sim.js');
const { createRelief } = await import('./client/relief.js');
const { createStructures } = await import('./client/structures.js');

// A map of terraces, a plateau with cliffs and a river (the relief chunk tests' terrain), dressed by dress(fill).
// Maps over 65536 cells answer hAt from the logical surface (a short ground reach), smaller ones from the drawn detail.
// raised: [x0, y0, x1, y1] boxes of cells lifted to level 3.
// low: false draws a small map's detail (cliff rocks, scar lips), which hAt then reads.
function scene(W, H, dress, raised = [], low = true) {
  const level = (x, y) => raised.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) ? 3 : x >= 40 && x < 90 && y >= 30 && y < 50 ? 5 : Math.floor((x + y) / 9) % 3;
  const grid = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => x === 110 || x === 111 ? 'W' : '.'));
  const heights = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => String(level(x, y))).join(''));
  const fill = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch; };
  const buildings = [], mineGrid = Array.from({ length: H }, () => Array(W).fill(0)), state = new Uint8Array(W * H);
  dress({ fill, buildings, mineGrid });
  const orig = grid.map(r => [...r]); // the map file: walls drawn here are stone, walls built later sandbags
  const map = { w: W, h: H, rows: grid.map(r => r.join('')), heights };
  const relief = createRelief(map, grid, { low });
  const setup = { grid, orig: (x, y) => orig[y]?.[x], hAt: (x, z) => relief.hAt(x, z), cells: state, buildings, mineGrid, groundReach: relief.groundReach };
  const group = new THREE.Group(), live = createStructures({ group, ...setup });
  live.rebuild();
  const chunkCount = Math.ceil(W / live.area) * Math.ceil(H / live.area);
  // writes [x, y, char, level, inOrig] changes; returns the changed cells
  function apply(changes) {
    for (const [x, y, ch, lv, inOrig] of changes) {
      if (ch) grid[y][x] = ch;
      if (inOrig) orig[y][x] = ch;
      if (lv !== undefined) map.heights[y] = map.heights[y].slice(0, x) + String(lv) + map.heights[y].slice(x + 1);
    }
    map.rows = grid.map(r => r.join(''));
    return changes.map(([x, y]) => y * W + x);
  }
  function same(label, { maxChunks, picks = [] } = {}) {
    const fresh = new THREE.Group(), whole = createStructures({ group: fresh, ...setup });
    whole.rebuild();
    const a = kinds(group), b = kinds(fresh);
    assert.deepEqual([...a.keys()], [...b.keys()], `${label}: the same kinds in the same draw order`);
    for (const [kind, im] of b) {
      const mine = a.get(kind);
      assert.equal(mine.count, im.count, `${label}: ${kind} count`);
      assert.deepEqual(mine.instanceMatrix.array.subarray(0, im.count * 16), im.instanceMatrix.array.subarray(0, im.count * 16), `${label}: ${kind} placement`);
      assert.deepEqual(mine.instanceColor.array.subarray(0, im.count * 3), im.instanceColor.array.subarray(0, im.count * 3), `${label}: ${kind} colour`);
      assert.equal(mine.castShadow, im.castShadow, `${label}: ${kind} shadow`);
      // every piece lies inside the bounds the frustum and picking use
      const sphere = mine.boundingSphere, m = new THREE.Matrix4(), p = new THREE.Vector3();
      for (let i = 0; i < mine.count; i++) { mine.getMatrixAt(i, m); assert.ok(sphere.containsPoint(p.setFromMatrixPosition(m)), `${label}: ${kind} piece ${i} outside its bounds`); }
    }
    // clicking a house hits the same roof or wall on both
    group.updateMatrixWorld(true); fresh.updateMatrixWorld(true);
    for (const [x, y] of picks) {
      const ray = new THREE.Raycaster(new THREE.Vector3((x + 0.5) * CELL, 80, (y + 0.5) * CELL), down);
      const hit = ray.intersectObjects(group.children)[0], ref = ray.intersectObjects(fresh.children)[0];
      assert.ok(ref, `${label}: a house stands at ${x},${y}`);
      assert.equal(hit?.object.name, ref.object.name, `${label}: picked kind at ${x},${y}`);
      assert.equal(hit?.distance, ref.distance, `${label}: picked point at ${x},${y}`);
    }
    if (maxChunks) assert.ok(live.stats.lastChunks <= maxChunks, `${label}: rebuilt ${live.stats.lastChunks} of ${chunkCount} chunks`);
    whole.clear();
  }
  // the pieces standing over cells x0..x1, y0..y1
  function piecesOver(x0, y0, x1, y1) {
    const out = [];
    for (const im of group.children) for (let i = 0; i < im.count; i++) {
      const a = im.instanceMatrix.array, x = a[i * 16 + 12] / CELL, z = a[i * 16 + 14] / CELL;
      if (x >= x0 && x < x1 + 1 && z >= y0 && z < y1 + 1) out.push(im.name + Array.from(a.subarray(i * 16, i * 16 + 16)) + Array.from(im.instanceColor.array.subarray(i * 3, i * 3 + 3)));
    }
    return out.sort().join(';');
  }
  // options.moves: [x0, y0, x1, y1] cells, in another chunk than the change, whose pieces it must change
  function change(label, changes, options = {}) {
    const before = options.moves && piecesOver(...options.moves);
    const cells = apply(changes);
    live.update(cells, relief.update(cells));
    same(label, options);
    if (options.moves) assert.notEqual(piecesOver(...options.moves), before, `${label}: the pieces it reaches changed`);
  }
  return { group, live, relief, state, buildings, change, same, W };
}
const kinds = (g) => new Map(g.children.map(im => [im.name, im]));
const down = new THREE.Vector3(0, -1, 0);

// A small map: changes across chunk borders (chunks are 32 cells) beside houses, walls and a bridge.
{
  const { group, live, relief, state, buildings, change, same, W } = scene(160, 136, ({ fill, buildings, mineGrid }) => {
    // house blocks across chunk borders: two long stone blocks (church candidates), a terrace down across a border,
    // small houses; a house and a wall on the last column of a chunk
    fill(28, 10, 35, 12, 'B'); fill(60, 62, 67, 64, 'B'); fill(50, 28, 51, 36, 'B');
    for (const [x, y] of [[20, 40], [40, 40], [70, 20], [90, 70], [30, 100], [130, 100], [36, 16], [63, 70], [29, 50]]) fill(x, y, x + 2, y + 1, 'B');
    fill(10, 80, 40, 80, 'H'); fill(60, 100, 70, 100, '#'); fill(62, 101, 62, 104, '#'); fill(95, 100, 95, 106, '#'); fill(96, 60, 96, 68, 'X'); fill(120, 30, 122, 31, 'Y');
    fill(100, 20, 100, 20, 'A'); fill(76, 90, 84, 90, 'T'); fill(30, 120, 33, 121, 'R');
    fill(110, 60, 111, 60, '='); fill(110, 90, 111, 90, '=');
    for (let x = 30; x < 36; x++) mineGrid[50][x] = 1;
    buildings.push({ x: 110, y: 60, kind: 'stone bridge' }, { x: 30, y: 120, kind: 'spoil' });
  }, [[26, 48, 36, 54], [60, 82, 68, 92]], false);
  const picks = [[29, 11], [64, 63], [50, 33], [31, 50], [91, 71]];
  same('first build', { picks });
  assert.ok(kinds(group).has('roof') && kinds(group).has('stone') && !kinds(group).has('bag'), 'the map has houses and stone walls, no sandbags yet');
  assert.ok(relief.groundReach > 3, 'a small map reads the drawn detail');

  // a bombing run: eight craters in a row beside a stone block, across a chunk border, the ground dug a level down
  change('long scar', Array.from({ length: 8 }, (_, i) => [26 + i, 13, '+', 0]), { picks, maxChunks: 9 });
  change('second scar crossing the first', Array.from({ length: 6 }, (_, i) => [31, 14 + i, '+', 0]), { picks, maxChunks: 9 });
  // ground raised just across a chunk border from a house and from a wall
  change('ground dug beside a house', [[32, 50, undefined, 0], [32, 51, undefined, 0], [32, 52, undefined, 0]], { picks, maxChunks: 9, moves: [29, 50, 31, 51] });
  // a wall stretch built on across a chunk border: the old end joins it
  change('wall joined across the border', [[96, 103, '#'], [97, 103, '#']], { picks, maxChunks: 9, moves: [95, 100, 95, 106] });
  // houses shot to pieces: part of a block across a border, and a whole small house
  change('ruins', [[31, 11, 'R'], [32, 11, 'R'], [32, 12, 'R'], ...[[20, 40], [21, 40], [22, 40], [20, 41], [21, 41], [22, 41]].map(([x, y]) => [x, y, 'R'])]);
  // a sandbag MG nest round a pit, a trench run, wire across a border
  change('works', [[80, 50, 'T'], [79, 49, '#'], [80, 49, '#'], [81, 49, '#'], [79, 50, '#'], [85, 90, 'T'], [86, 90, 'T'], [96, 63, '.'], [97, 64, 'X'], [96, 69, 'X']]);
  // the stone bridge grows a cell (its whole span stays stone) and the bank beside it is raised into a ramp
  change('bridge and ramp', [[110, 61, '='], [111, 61, '='], ...[108, 109, 112, 113].flatMap(x => [58, 59, 60, 61, 62].map(y => [x, y, undefined, 2]))]);
  // water beside raised ground: a river cell filled in high, a bank cell flooded
  change('water beside raised ground', [[112, 70, '.', 3], [109, 70, 'W', 0], [111, 89, '.', 3]]);
  // a long stone block is built near the first: it is bigger, so the church moves to it
  const before = kinds(group).get('spire').instanceMatrix.array.slice(12, 15);
  change('church moves', Array.from({ length: 32 }, (_, i) => [40 + (i % 8), 14 + Math.floor(i / 8), 'B', undefined, true]), { picks: [...picks, [41, 15]] });
  assert.equal(kinds(group).get('spire').count, 1, 'one church stands');
  assert.notDeepEqual(kinds(group).get('spire').instanceMatrix.array.slice(12, 15), before, 'the church moved to the bigger block');
  // two houses joined into one block, then split again
  change('blocks join', [[39, 40, 'B', undefined, true], [39, 41, 'B', undefined, true], [38, 40, 'B', undefined, true], [37, 40, 'B', undefined, true]]);
  change('blocks split', [[38, 40, '.', undefined, true]]);
  // a landmark learnt without a cell change turns a house into a factory; a spoil tip is learnt on rubble
  buildings.push({ x: 70, y: 20, kind: 'factory' }, { x: 31, y: 121, kind: 'spoil' });
  live.update([]); same('landmarks learnt');
  // damage stages: hedges slump, walls drop
  for (const x of [12, 13, 14, 15]) state[80 * W + x] = 2 << 3;
  for (const x of [61, 62]) state[100 * W + x] = 1 << 3;
  live.update([80 * W + 12, 80 * W + 13, 80 * W + 14, 80 * W + 15, 100 * W + 61, 100 * W + 62]); same('damage stages', { maxChunks: 9 });
  // the last tank traps are gone: their kind leaves the scene, no empty mesh stays
  change('a kind disappears', [[120, 30, '.'], [121, 30, '.'], [122, 30, '.'], [120, 31, '.'], [121, 31, '.'], [122, 31, '.']]);
  assert.ok(!kinds(group).has('hedgehog') && [...kinds(group).values()].every(im => im.count > 0), 'no empty meshes stay');
  // many houses at once: meshes grow past their room
  change('a town is built', Array.from({ length: 120 }, (_, i) => [130 + (i % 12), 10 + Math.floor(i / 12) * 2, 'B', undefined, true]));
}

// A map over 65536 cells (World Conquest's case): the ground moves only next to a change, so the halo is short, and a
// change still reaches a house standing far into the next chunk and a stone deck across chunks.
{
  const { live, relief, change, same } = scene(288, 240, ({ fill, buildings }) => {
    // a city block 40 cells wide, 36 deep: its houses run from row 4 down to row 39, across the chunk border at 32;
    // one cell in its far corner is rubble
    fill(150, 4, 189, 39, 'B');
    // a long stone block (the church) and two small houses
    fill(200, 100, 207, 102, 'B'); fill(250, 20, 252, 21, 'B'); fill(250, 60, 252, 61, 'B');
    // a long bridge over a wide river, broken at x 140; only the span west of the break is stone
    fill(100, 150, 180, 156, 'W'); fill(100, 153, 139, 153, '='); fill(141, 153, 180, 153, '=');
    buildings.push({ x: 100, y: 153, kind: 'stone bridge' });
  }, [[140, 0, 200, 45]]);
  assert.equal(relief.groundReach, 3);
  const picks = [[251, 21], [251, 61]];
  change('rubble', [[189, 39, 'R'], [201, 101, 'R']]);
  // ground raised under the block's far wall: its houses, anchored in the chunk above, stand lower or higher
  change('ground dug under a deep house', [[152, 40, undefined, 0], [153, 40, undefined, 0], [170, 40, undefined, 0]], { picks, maxChunks: 6, moves: [150, 4, 189, 31] });
  // the block grows a row on its north side: every house in it is laid out again, the far rubble takes its new look
  change('block grows', Array.from({ length: 40 }, (_, i) => [150 + i, 3, 'B', undefined, true]), { picks, moves: [189, 39, 189, 39] });
  // a bigger stone block is built 30 cells away: the church moves there, the first block's ruin loses the church look
  change('church moves far', Array.from({ length: 32 }, (_, i) => [230 + (i % 8), 100 + Math.floor(i / 8), 'B', undefined, true]), { moves: [200, 100, 207, 102] });
  // the break is mended: the stone deck runs on across the chunk border at 160 and on to 180
  change('stone deck spreads', [[140, 153, '=']]);
  assert.ok(live.stats.lastChunks < 30, 'only the chunks of the span and the change');
}
console.log('structure chunk checks passed');
