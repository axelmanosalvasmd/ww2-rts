// Transport: carriers with several seats, tank riders who jump down under fire, troop trucks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, command, step, snapshotFor, UNITS, CFG, CARGO_FLAG, CARGO_SHIFT } from './shared/sim.js';
import { fixtureCommand, clearFixtureUnits } from './test-fixtures.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 12, y: 40 }, { x: 68, y: 40 }], points: [] };
function scene(units) {
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false });
  clearFixtureUnits(g);
  return [g, units.map(([owner, type, x, z]) => {
    g.players[owner].mp = 1e6;
    assert.equal(fixtureCommand(g, owner, { t: 'buy', unit: type }), undefined, `place ${type}`);
    return Object.assign([...g.units.values()].at(-1), { x, z, path: [], orders: [], targetId: 0, holdFire: true });
  })];
}
const run = (g, n) => { for (let i = 0; i < n; i++) step(g); };
const row = (g, u) => snapshotFor(g, u.owner, []).units.find(r => r[0] === u.id);

test('a light tank carries two squads as riders and a Tiger three', () => {
  assert.deepEqual(['tank', 'medium', 'tiger', 'churchill', 'halftrack', 'lorry'].map(t => UNITS[t].carries), [2, 2, 3, 3, 1, 3]);
  const [g, [tank, a, b, c]] = scene([[0, 'tank', 40, 40], [0, 'rifle', 44, 40], [0, 'rifle', 40, 44], [0, 'mg', 36, 40]]);
  assert.equal(command(g, 0, { t: 'board', ids: [a.id, b.id, c.id], target: tank.id }), undefined);
  assert.equal([a, b, c].filter(u => u.board === tank.id).length, 2, 'only two squads walk to a light tank');
  run(g, 100);
  assert.deepEqual(tank.cargo.sort(), [a.id, b.id].sort(), 'the two nearest squads ride');
  assert.equal(row(g, tank)[12] & CARGO_FLAG, CARGO_FLAG);
  assert.equal(row(g, tank)[12] >> CARGO_SHIFT & 3, 2, 'the snapshot tells how many ride');
  assert.equal(command(g, 0, { t: 'board', ids: [c.id], target: tank.id }), 'max');
  command(g, 0, { t: 'move', orders: [[tank.id, 60, 40]] });
  run(g, 40);
  assert.ok(a.x > 41 && a.x === tank.x, 'riders go where the tank goes');
  assert.equal(command(g, 0, { t: 'unload', ids: [tank.id] }), undefined);
  assert.ok(!a.riding && !b.riding && !tank.cargo.length, 'unload puts every rider down');
});

test('riders jump down, shaken, when the tank comes under fire', () => {
  const [g, [tank, a, foe]] = scene([[0, 'tank', 40, 40], [0, 'rifle', 42, 40], [1, 'rifle', 60, 40]]);
  command(g, 0, { t: 'board', ids: [a.id], target: tank.id });
  run(g, 60);
  assert.equal(a.riding, tank.id);
  foe.holdFire = false;
  command(g, 1, { t: 'attack', ids: [foe.id], target: tank.id });
  for (let i = 0; i < 400 && a.riding; i++) step(g);
  assert.ok(!a.riding, 'the rider got down once shots hit the tank');
  assert.ok(a.supp >= CFG.riderShock - 20, 'and is pinned for a moment');
});

test('mount up: squads spread over the selected carriers', () => {
  const [g, [t1, t2, ...squads]] = scene([[0, 'lorry', 40, 40], [0, 'tank', 40, 50], ...[36, 38, 42, 44, 46].map(x => [0, 'rifle', x, 45])]);
  assert.equal(command(g, 0, { t: 'board', ids: [t1.id, t2.id, ...squads.map(u => u.id)] }), undefined);
  run(g, 120);
  assert.equal(t1.cargo.length, 3, 'the truck fills its three seats');
  assert.equal(t2.cargo.length, 2, 'the tank its two');
});
