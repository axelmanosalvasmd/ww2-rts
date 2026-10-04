import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, step, command, findPath, CELL, UNITS, blockOf } from './shared/sim.js';
import { updateGrid } from './shared/grid.js';

const map = JSON.parse(readFileSync(new URL('./maps/hot-gates.json', import.meta.url), 'utf8'));
const cell = (g, u) => Math.floor(u.z / CELL) * g.w + Math.floor(u.x / CELL);
// Build fixtures through the existing recruitment command, independent of optional sandbox tools.
function fixtureVehicle(g, type, x, z) {
  g.players[0].mp = 50000;
  assert.equal(command(g, 0, { t: 'buy', unit: 'tank' }), undefined);
  const u = [...g.units.values()].at(-1);
  Object.assign(u, { type, hp: UNITS[type].hpPer, x, z, path: [], autoRetreat: false });
  updateGrid(g, u);
  return u;
}

// Scatter must stay on the road's connected ground, including the south edge beside the cliff.
for (const roll of [0.25, 0.75, 0, 0.5, 0.125, 0.375, 0.625, 0.875]) {
  const g = createGame(map, ['defender'], false, undefined, undefined, { mode: 'horde', weather: false });
  for (const u of [...g.units.values()]) if (u.type !== 'bunker') g.units.delete(u.id);
  Object.assign(g.mode, { active: true, wave: 5, profile: 'mixed', budget: 0, reserve: ['tank', 'tank', 'tank'] });
  g.tick = 9;
  const random = Math.random;
  try { Math.random = () => roll; step(g); } finally { Math.random = random; }
  const tanks = [...g.units.values()].filter(u => u.type === 'tank');
  assert.equal(tanks.length, 3, 'one tank arrives at each gate');
  for (const u of tanks) {
    assert.equal(g.flags[cell(g, u)] & blockOf(UNITS.tank), 0, 'Horde tanks spawn on drivable terrain');
    assert.ok(findPath(g, u, g.units.get(g.mode.bunker)).length, `scatter ${roll}: tank at ${u.x},${u.z} can leave its gate`);
  }
}

// Friends cannot shove a vehicle onto rubble or tank traps. Infantry can still use that cover.
for (const obstacle of ['R', 'Y', 'Q']) {
  const rows = Array.from({ length: 40 }, () => Array(40).fill('.'));
  rows[10][10] = obstacle;
  const fixture = { w: 40, h: 40, rows: rows.map(r => r.join('')), spawns: [{ x: 2, y: 2 }, { x: 36, y: 36 }], points: [] };
  const g = createGame(fixture, ['a', 'b'], false, undefined, undefined, { weather: false });
  g.units.clear();
  for (const x of [19.9, 18.1]) {
    fixtureVehicle(g, 'tank', x, 21);
  }
  for (let i = 0; i < 20; i++) step(g);
  for (const u of g.units.values()) assert.equal(g.flags[cell(g, u)] & blockOf(UNITS[u.type]), 0, `${obstacle}: crowd pushes keep tanks on drivable ground`);
}

// Drive spaced convoys through the actual mountain road, including both cliff bends.
for (const type of ['tank', 'churchill']) for (const [sx, sy, tx, ty] of [[30, 46, 106, 45], [106, 45, 30, 46]]) {
  const g = createGame(map, ['defender'], false, undefined, undefined, { mode: 'horde', weather: false });
  g.mode.timeLeft = 1e9;
  for (const u of g.units.values()) if (u.type !== 'bunker') g.units.delete(u.id);
  const convoy = [], arrived = new Set();
  for (let i = 0; i < 4; i++) {
    const u = fixtureVehicle(g, type, (sx + 0.5) * CELL + i * 6 * Math.sign(sx - tx), (sy + 0.5) * CELL);
    convoy.push(u);
    u.holdPos = true; u.autoRetreat = false;
    for (const [j, [x, y]] of [[sx, 64], [tx, 64], [tx, ty]].entries()) {
      assert.equal(command(g, 0, { t: 'move', orders: [[u.id, (x + 0.5) * CELL, (y + 0.5) * CELL]], queue: j > 0 }), undefined);
    }
  }
  for (let i = 0; i < 7200 && arrived.size < convoy.length; i++) {
    step(g);
    for (const u of convoy) {
      if (arrived.has(u.id)) continue;
      assert.equal(g.flags[cell(g, u)] & blockOf(UNITS[u.type]), 0, 'convoy stays off vehicle obstacles');
      // Clear the exit after arrival so parked tanks do not block the next vehicle's destination.
      if (!u.worldGoal && !u.orders.length && Math.hypot(u.x - (tx + 0.5) * CELL, u.z - (ty + 0.5) * CELL) < 1) {
        arrived.add(u.id); g.units.delete(u.id);
      }
    }
  }
  assert.equal(arrived.size, convoy.length, `convoy ${sx},${sy}: ${type} clears both cliff corners`);
}

console.log('Hot Gates spawn, vehicle separation and mountain-road convoy checks passed');
