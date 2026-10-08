// HQ tiers and the Armory (shared/tech.js): gating, research, pausing, damage.
import assert from 'node:assert/strict';
import { createGame, command, step, snapshotFor, TICK, UNITS } from './shared/sim.js';
import { TECH, techMul } from './shared/tech.js';
const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 12, y: 40 }, { x: 68, y: 40 }], points: [], defend: [0] };
const game = (mode = 'conquest', tech = true) => createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode, defenderTeam: 1, weather: false, tech });
const own = (g, type) => [...g.units.values()].find(u => u.owner === 0 && u.type === type);
const run = (g, s) => { for (let i = 0; i < Math.ceil(s / TICK); i++) step(g); };

{
  const g = game(), p = g.players[0];
  p.mp = 10000;
  assert.equal(p.tier, 1);
  assert.equal(command(g, 0, { t: 'buy', unit: 'mortar' }), 'tier', 'mortar needs Company HQ');
  assert.equal(command(g, 0, { t: 'build', kind: 'motorpool', ids: [own(g, 'rifle').id], x: 200, z: 200 }), 'tier');
  assert.equal(command(g, 0, { t: 'tech', kind: 'inf' }), 'needs', 'no Armory at T1');
  assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), undefined);
  assert.equal(p.mp, 10000 - TECH.tiers[2].mp);
  assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), 'max', 'one tier-up at a time');
  assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined, 'the HQ keeps recruiting while it upgrades');
  // losing the HQ pauses the upgrade
  const hq = own(g, 'hq');
  hq.built = 0.5; run(g, 5); assert.equal(snapshotFor(g, 0, []).tech.lab[0][1], 0, 'paused without an HQ');
  hq.built = 1; run(g, TECH.tiers[2].time + 1);
  assert.equal(p.tier, 2);
  assert.equal(command(g, 0, { t: 'buy', unit: 'mortar' }), undefined);
  assert.equal(command(g, 0, { t: 'buy', unit: 'tank' }), 'needs', 'T2 still needs a Motor Pool for tanks');
  assert.equal(command(g, 0, { t: 'tech', kind: 'inf' }), 'needs', 'Armory lines need an Armory');
  const armory = [...g.units.values()].find(u => u.owner === 0 && u.type === 'barracks'); armory.type = 'armory'; // stand-in Armory
  assert.equal(command(g, 0, { t: 'tech', kind: 'inf' }), undefined);
  assert.equal(command(g, 0, { t: 'tech', kind: 'guns' }), 'queueFull', 'one research per Armory');
  run(g, TECH.levels[0].time + 1);
  assert.deepEqual(p.armory, { inf: 1, guns: 0, armor: 0 });
  assert.equal(command(g, 0, { t: 'tech', kind: 'inf' }), undefined, 'level 2 at T2');
  run(g, TECH.levels[1].time + 1);
  assert.equal(command(g, 0, { t: 'tech', kind: 'inf' }), 'tier', 'level 3 needs Battalion HQ');
}
// damage: +10% per weapons level for the attacker, 0.9x per armor level for a vehicle target
{
  const a = { armory: { inf: 2, guns: 1, armor: 0 } }, d = { armory: { inf: 0, guns: 0, armor: 2 } };
  assert.ok(Math.abs(techMul(a, UNITS.rifle, d, UNITS.rifle) - 1.2) < 1e-9);
  assert.ok(Math.abs(techMul(a, UNITS.tank, d, UNITS.tank) - 1.1 * 0.81) < 1e-9);
  assert.equal(techMul(undefined, UNITS.rifle, undefined, UNITS.tank), 1);
}
// Horde defenders start at Company HQ; matches without tech have no tiers
{
  assert.equal(createGame(map, ['a'], false, [0], [0], { mode: 'horde', weather: false, tech: true }).players[0].tier, 2);
  const g = game('conquest', false); g.players[0].mp = 10000;
  assert.equal(g.players[0].tier, undefined);
  assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), 'blocked');
  assert.equal(command(g, 0, { t: 'buy', unit: 'mortar' }), undefined);
}
// Classic charges Munitions too
{
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic', weather: false, tech: true }), p = g.players[0];
  p.mp = 10000; p.mun = 0;
  assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), 'mun');
  p.mun = 100; assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), undefined);
  assert.equal(p.mun, 100 - TECH.tiers[2].mun);
}
console.log('HQ tiers and Armory passed');
