import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, step, supplyRateAt, CFG } from './shared/sim.js';
import { generateWorldMap } from './shared/world-conquest.js';

const fresh = (logistics = false) => createGame(generateWorldMap({ seed: 42, players: 2 }), ['one', 'two'], false, [0, 1], [0, 1], { mode: 'world', logistics, weather: 'clear' });
const quiet = g => { for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false, holdPos: true }); };

test('simultaneous loss of the last World regions ends in a draw', () => {
  const g = fresh(), homes = [0, 1].map(team => g.world.regions.find(r => r.team === team));
  const attackers = [0, 1].map(owner => [...g.units.values()].find(u => u.owner === owner && u.type === 'rifle'));
  quiet(g);
  for (const u of g.units.values()) if (u.owner >= 0 && !attackers.includes(u)) {
    if (u.cells) u.hp = 0;
    else Object.assign(u, { x: homes[u.owner].x + 24, z: homes[u.owner].z + 24 });
  }
  step(g);
  assert.equal(g.winner, null, 'a match with surviving regions keeps running');
  for (let owner = 0; owner < 2; owner++) Object.assign(attackers[owner], { x: homes[1 - owner].x, z: homes[1 - owner].z, path: [], orders: [], worldGoal: null, retreating: false });
  for (let n = 0; n < Math.ceil(CFG.captureTime * 20) + 2; n++) step(g);
  assert.ok(g.players.every(p => p.out));
  assert.deepEqual(homes.map(r => r.team), [-1, -1]);
  assert.equal([...g.units.values()].filter(u => u.owner >= 0).length, 0);
  assert.equal(g.winner, -1);
  assert.equal(g.endReason, 'draw');
  for (let n = 0; n < 200; n++) step(g);
  assert.equal(g.winner, -1, 'the draw stays terminal');
});

test('an uncontested enemy blocks a World supply source and friendly troops reopen it', () => {
  const g = fresh(true), home = g.world.regions.find(r => r.team === 0);
  quiet(g);
  const friendly = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  for (const u of [...g.units.values()]) if (u.owner === 0 && !u.cells) g.units.delete(u.id);
  const enemy = [...g.units.values()].find(u => u.owner === 1 && u.type === 'rifle');
  Object.assign(enemy, { x: home.x + 20, z: home.z, path: [], orders: [], worldGoal: null });
  for (let n = 0; n < 40; n++) step(g);
  assert.equal(home.team, 0, 'the source HQ retains regional ownership');
  assert.equal(supplyRateAt(g, 0, home), 0, 'enemy control cuts the source itself');
  g.units.set(friendly.id, friendly);
  Object.assign(friendly, { x: home.x - 20, z: home.z, path: [], orders: [], worldGoal: null });
  for (let n = 0; n < 40; n++) step(g);
  assert.equal(supplyRateAt(g, 0, home), 1, 'friendly armed presence reopens the owned source');
});
