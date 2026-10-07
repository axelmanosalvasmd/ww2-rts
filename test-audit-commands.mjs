import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, command } from './shared/sim.js';

const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 10, y: 10 }, { x: 70, y: 70 }], points: [] };
test('malformed order rows are refused before simulation side effects', () => {
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic', weather: 'clear', logistics: true });
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  rifle.logistics.forced = true; rifle.supplyHold = true;
  for (const t of ['move', 'amove', 'buy', 'stop']) for (const orders of [[null], [3], [[rifle.id]], [[rifle.id, NaN, 40]], 'bad']) {
    assert.equal(command(g, 0, { t, orders, ids: [rifle.id] }), 'blocked', `${t}: ${JSON.stringify(orders)}`);
    assert.equal(rifle.supplyHold, true, 'rejected orders leave withdrawal state intact');
  }
  assert.equal(command(g, 0, { t: 'move', orders: [[rifle.id, 50, 50]] }), undefined);
  assert.equal(rifle.supplyHold, false, 'a valid movement order still releases the hold');
});
