import assert from 'node:assert/strict';
import { createGame, command, step, inCover, UNITS, TICK, CELL } from './shared/sim.js';

function marchGroup({ width = 3, together = false, queued = false, attackMove = false, reverse = false, deferRecovery = false } = {}) {
  const w = 64, h = 64;
  const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) =>
    y >= 27 && y <= 35 ? x >= 30 && x < 30 + width ? '=' : 'W' : '.').join(''));
  const g = createGame({ w, h, rows, spawns: [{ x: 8, y: 8 }, { x: 55, y: 55 }], points: [] },
    ['Marchers', 'Observer'], false, [0, 1], [0, 1], { weather: false, supply: false });
  g.seed = 7301;
  const template = structuredClone([...g.units.values()].find(u => u.type === 'rifle'));
  g.units.clear(); g.points = [];
  const marchers = Array.from({ length: 18 }, (_, i) => {
    const type = ['rifle', 'at', 'mg', 'mortar', 'rifle', 'medic'][i % 6], def = UNITS[type];
    const u = { ...structuredClone(template), id: g.nextId++, type, owner: 0,
      x: 57 + (i % 3) * 4, z: reverse ? 47 - Math.floor(i / 3) * 4 : 77 + Math.floor(i / 3) * 4, rot: reverse ? Math.PI / 2 : -Math.PI / 2,
      hp: def.models * def.hpPer, holdFire: true, auto: false, autoRetreat: false,
      path: [], orders: [], worldGoal: null, traffic: null, face: null };
    g.units.set(u.id, u); return u;
  });
  const orders = marchers.map((u, i) => [u.id, 51 + (i % 6) * 4, reverse ? 89 + Math.floor(i / 6) * 4 : 31 + Math.floor(i / 6) * 4]);
  assert.equal(command(g, 0, { t: attackMove ? 'amove' : 'move', orders, together }), undefined);
  if (queued) assert.equal(command(g, 0, { t: 'move', orders: orders.map(([id, x, z]) => [id, x, z - 12]), queue: true }), undefined);
  const destinations = new Map(marchers.map(u => [u.id, { ...(u.worldGoal ?? u.amove), z: (u.worldGoal ?? u.amove).z - (queued ? 12 : 0) }]));
  const arrived = new Set();
  for (let n = 0; n < 120 / TICK; n++) {
    if (deferRecovery && n === 5 / TICK) g.pathBudget = 0;
    if (deferRecovery && n === 15 / TICK) g.pathBudget = 4096;
    const calls = g.pathStats?.calls ?? 0;
    step(g);
    if (g.pathBudget === 0) assert.equal(g.pathStats.calls, calls, 'crowded infantry recovery honors a zero search budget');
    for (const u of marchers) {
      const c = Math.floor(u.z / CELL) * w + Math.floor(u.x / CELL);
      assert.notEqual(g.chars[c], 'W', 'marching never pushes a squad into the river');
      assert.notEqual(u.moveOutcome, 'unreachable', 'crowding does not abandon a reachable order');
      const target = destinations.get(u.id);
      if (Math.hypot(u.x - target.x, u.z - target.z) < (attackMove ? 2.5 : 0.5)
        && !u.path.length && !u.worldGoal && !u.orders.length) {
        arrived.add(u.id); u.holdPos = true; // Keep completed squads from their normal idle spacing moves.
      }
    }
  }
  const stranded = marchers.filter(u => !arrived.has(u.id));
  assert.equal(stranded.length, 0, `all selected infantry and support teams finish across a ${width * CELL} m bridge (${JSON.stringify({ together, queued, attackMove, reverse })}): ${JSON.stringify(stranded.map(u => ({ type: u.type, x: u.x, z: u.z, first: u.path[0], wanted: destinations.get(u.id), outcome: u.moveOutcome, end: u.routeEnd, result: u.moveResult })))}`);
}

for (const width of [1, 2, 3]) {
  marchGroup({ width });
  marchGroup({ width, together: true });
  marchGroup({ width, queued: true });
  marchGroup({ width, attackMove: true });
  marchGroup({ width, reverse: true });
  marchGroup({ width, deferRecovery: true });
}

// Forward-preserving separation must validate its actual displacement against protected cover.
{
  const w = 32, h = 32, rows = Array.from({ length: h }, () => Array(w).fill('.'));
  rows[10][10] = '#'; rows[10][11] = '=';
  const g = createGame({ w, h, rows: rows.map(r => r.join('')), spawns: [{ x: 5, y: 5 }, { x: 26, y: 26 }], points: [] },
    ['Marchers', 'Observer'], false, [0, 1], [0, 1], { weather: false, supply: false });
  const template = structuredClone([...g.units.values()].find(u => u.type === 'rifle'));
  g.units.clear();
  const add = (x, z, tx, tz) => {
    const u = { ...structuredClone(template), id: g.nextId++, x, z, holdPos: false, holdFire: true,
      auto: false, autoRetreat: false, path: [{ x: tx, z: tz }], worldGoal: { x: tx, z: tz }, traffic: null, face: null, orders: [] };
    g.units.set(u.id, u); return u;
  };
  const covered = add(21.81, 20.1894, 40, 2);
  add(23.1, 20.1994, 41.29, 2.01);
  assert.ok(inCover(g, covered));
  step(g);
  assert.ok(inCover(g, covered), 'friendly bridge traffic does not push a squad out of protected cover');
}
console.log('PASS: selected infantry and support groups cross 2, 4 and 6 m bridges, shared pace, queued orders, attack-move and deferred searches');
