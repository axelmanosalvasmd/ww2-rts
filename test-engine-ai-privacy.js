// An AI omits the browser fog mask but still learns destruction only through the same seat view.
import assert from 'node:assert/strict';
import { createGame, damageWorldSection, snapshotFor, teamSees, CELL, TERRAIN } from './shared/sim.js';
import { viewFor } from './shared/ai-view.js';

const map = { name: 'Observation pair', w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 10, y: 10 }, { x: 70, y: 70 }], points: [{ x: 40, y: 40 }] };
const ordinary = createGame(map, ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear' });
const hidden = structuredClone(ordinary), enemy = [...hidden.units.values()].find(u => u.owner === 1 && u.type === 'hq');
assert.ok(enemy?.cells?.length);
const c = enemy.cells[0], at = { x: (c % hidden.w + 0.5) * CELL, z: (Math.floor(c / hidden.w) + 0.5) * CELL };
assert.equal(teamSees(hidden, 0, at), false);
damageWorldSection(hidden, c, Infinity, { direction: { x: 1, z: 0 } });
hidden.smokes.push({ id: 1234, x: at.x, z: at.z, r: 2, t: 8 });
hidden.fires.set(c, { t: 8 });
hidden.wrecks.push({ id: 5678, type: 'tank', owner: 1, x: at.x, z: at.z, rot: 0, c: -1 });

const clear = viewFor(ordinary, 0, {}), altered = viewFor(hidden, 0, {});
assert.deepEqual(altered.chars, clear.chars, 'hidden breach leaves AI terrain unchanged');
assert.deepEqual(altered.flags, clear.flags);
assert.deepEqual(altered.smokes, clear.smokes, 'hidden smoke does not enter AI observations');
assert.deepEqual(altered.ghosts, clear.ghosts);
const projected = { ...hidden, omitFogMask: true };
const owner = snapshotFor(projected, 0, []);
assert.equal(owner.fog, undefined, 'AI has no browser mask to decode');
assert.equal(owner.cells.some(row => row[0] === c), false, 'omitting the mask does not disclose a hidden cell');
assert.equal(owner.falling.length, 0, 'hidden collapse has no AI presentation record');
assert.equal(owner.fires.includes(c), false);
assert.equal(owner.smokes.some(row => row[3] === 1234), false);
assert.equal(owner.wrecks.some(row => row[0] === 5678), false);
const mineMap = structuredClone(map);
const mineCell = 12 * mineMap.w + 16;
const put = (row, x, ch) => row.slice(0, x) + ch + row.slice(x + 1);
mineMap.rows[12] = put(mineMap.rows[12], 16, 'N');
mineMap.worldVersion = 2;
mineMap.layers = { ground: Array(mineMap.h).fill('.'.repeat(mineMap.w)),
  objects: Array(mineMap.h).fill('.'.repeat(mineMap.w)), mines: Array(mineMap.h).fill('.'.repeat(mineMap.w)) };
mineMap.layers.objects[12] = put(mineMap.layers.objects[12], 16, 'R');
mineMap.layers.mines[12] = put(mineMap.layers.mines[12], 16, 'N');
const mined = createGame(mineMap, ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear' });
const memory = {};
const unknown = viewFor(mined, 0, memory);
assert.equal(unknown.chars[mineCell], 'R', 'authoring source cannot tell an AI about a hidden mine');
assert.equal(unknown.flags[mineCell], TERRAIN.R);
assert.equal(unknown.mines.length, 0);
mined.mineSeen.set(mineCell, 1 << 0);
mined.cellLog.push([mineCell, 'N']);
mined.terrainVersion++;
const discovered = viewFor(mined, 0, memory);
assert.equal(discovered.chars[mineCell], 'N');
assert.equal(discovered.flags[mineCell], TERRAIN.R, 'a mine does not erase the underlying rubble pathing');
assert.equal(discovered.mines.length, 0, 'an authored or enemy mine is not friendly');
assert.deepEqual(discovered.foundMines.map(row => [row.x, row.z]), [[(16.5) * CELL, (12.5) * CELL]]);
console.log('AI observed-terrain and effect privacy checks passed');
