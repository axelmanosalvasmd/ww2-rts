// Run the tutorial before the longer regression suite so a progression failure reports promptly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, step, command, validateMap, snapshotFor, snapshotCache, CELL } from './shared/sim.js';
import * as sim from './shared/sim.js';

// Tutorial: every step can be finished in order (fights won by fiat), each says its lines, and the last one wins.
{
  const map = JSON.parse(readFileSync(new URL('./maps/tutorial.json', import.meta.url), 'utf8'));
  assert.equal(validateMap(map), null, 'the tutorial map is valid');
  const { STEPS } = await import('./shared/tutorial.js');
  const g = createGame(map, ['me'], false, [0], [1], { mode: 'tutorial' }), m = g.mode;
  assert.deepEqual(g.players.map(p => [p.name, p.team, p.faction]), [['me', 0, 1], ['Enemy', 1, 2]], 'the enemy is an extra player in a faction nobody picked');
  let said = 0;
  const mine = () => [...g.units.values()].filter(u => u.owner === 0);
  const enemies = () => m.spawned.map(id => g.units.get(id)).filter(u => u?.hp > 0);
  const go = (x, y) => assert.equal(command(g, 0, { t: 'move', orders: mine().map(u => [u.id, (x + 0.5) * CELL, (y + 0.5) * CELL]) }), undefined, 'tutorial move accepted');
  let crossingRoutes;
  const diagnostic = () => JSON.stringify({
    tick: g.tick, seed: g.seed, points: g.points, pathStats: g.pathStats, crossingRoutes,
    units: [...g.units.values()].map(u => ({ id: u.id, owner: u.owner, type: u.type, hp: u.hp, x: u.x, z: u.z, retreating: u.retreating, garrison: u.garrison, path: u.path })),
    bridge: [...map.rows.join('')].flatMap((ch, c) => ch === '=' ? [{ c, ch: g.chars[c], hp: g.cellHp[c] }] : []),
  });
  const until = (fn, max = 1500) => {
    for (let i = 0; i < max && !fn(); i++) { step(g); said += g.shots.filter(s => s.k === 'say').length; g.shots = []; }
    if (!fn()) assert.fail(`tutorial stuck on step ${m.step}: ${m.goal} ${diagnostic()}`);
  };
  const next = (n) => until(() => m.step === n);
  assert.ok(!g.shots.some(s => s.k === 'say'), 'the opening lines wait past the first snapshot, which shows no alerts');
  assert.equal(snapshotFor(g, 0, [], [], snapshotCache(g)).mode.goal, STEPS[0].goal, 'the snapshot carries the goal');
  go(15, 22); next(1);
  assert.deepEqual(enemies().map(u => [u.type, u.hp]), [['rifle', 60], ['rifle', 60]], 'the orchard sentries are understrength rifle squads');
  assert.ok(enemies().every(u => !u.autoRetreat), 'tutorial enemies never run home');
  for (const u of enemies()) u.hp = 0;
  next(2); go(34, 22); next(3);
  assert.ok(g.players[0].mp >= 250, 'the recruit step pays for the AT gun');
  assert.equal(command(g, 0, { t: 'buy', unit: 'at' }), undefined); next(4);
  const [tank] = enemies();
  assert.ok(tank.type === 'tank' && tank.amove, 'the tank drives at the crossroads');
  tank.hp = 0; next(5);
  assert.ok(enemies().length === 2 && enemies().every(u => sim.inTrench(g, u)), 'the farm squads stand in the trench');
  for (const u of enemies()) u.hp = 0;
  next(6);
  command(g, 0, { t: 'retreat', ids: [mine()[0].id] }); next(7);
  until(() => enemies().length === 2 && enemies().every(u => u.garrison >= 0), 400); // the stone house's garrison walks in
  // Advancing resets mode.spawned for the new step, which has no new defenders. Keep the house occupants.
  const houseDefenders = enemies();
  assert.equal(command(g, 0, { t: 'support', kind: 'artillery', x: 63.5 * CELL, z: 17.5 * CELL }), undefined); next(8);
  for (const u of houseDefenders) u.hp = 0;
  // Combat is resolved by the fixture. A pending random shell must not wreck the crossing under the walkers.
  g.strikes = [];
  go(62, 22);
  crossingRoutes = mine().map(u => ({ id: u.id, type: u.type, path: structuredClone(u.path) }));
  until(() => g.winner !== null, 3000);
  assert.deepEqual([g.winner, g.endReason], [0, 'tutorial'], 'taking the bridgehead wins the tutorial');
  assert.equal(said, STEPS.reduce((a, s) => a + s.say.length, 0), 'every step said all its lines');
}
console.log('tutorial: all nine steps and bridgehead victory checked');
