// World Conquest rules: victory by land share or by outlasting every rival, and HQ tiers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, step, command, snapshotFor } from './shared/sim.js';
import { generateWorldMap, WORLD_TUNING } from './shared/world-conquest.js';

const fresh = (opts = {}, players = 2, teams = [0, 1]) => createGame(generateWorldMap({ seed: 42, players, teams }), teams.map(t => `p${t}`), false, teams, teams.map((_, i) => i % 3), { mode: 'world', weather: 'clear', ...opts });

test('a team owning the winning share of regions wins', () => {
  const g = fresh(), goal = Math.ceil(g.world.total * WORLD_TUNING.winShare);
  assert.equal(snapshotFor(g, 0, []).world.goal, goal, 'the snapshot carries the land goal');
  const free = g.world.regions.filter(r => r.team === -1);
  for (const r of free.slice(0, goal - 2)) r.team = 0;
  step(g);
  assert.equal(g.winner, null, 'one region short keeps the match running');
  free[goal - 2].team = 0;
  step(g);
  assert.deepEqual([g.winner, g.endReason], [0, 'world']);
});

test('the last nation standing wins without the land goal', () => {
  const g = fresh({}, 3, [0, 1, 2]);
  for (const team of [1, 2]) g.world.regions.find(r => r.team === team).team = -1;
  step(g);
  assert.ok(g.players[1].out && g.players[2].out);
  assert.deepEqual([g.winner, g.endReason], [0, 'nations']);
});

test('a match with one team must own every region', () => {
  const g = fresh({}, 2, [0, 0]);
  assert.equal(snapshotFor(g, 0, []).world.goal, g.world.total);
  const left = g.world.regions.find(r => r.home === undefined);
  for (const r of g.world.regions) r.team = r === left ? -1 : 0;
  step(g);
  assert.equal(g.winner, null, 'no rivals, no land-share win');
});

test('World Conquest has HQ tiers', () => {
  const g = fresh({ tech: true }), p = g.players[0];
  assert.equal(p.tier, 1);
  assert.equal(command(g, 0, { t: 'build', ids: [[...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer').id], kind: 'armory', x: p.spawn.x, z: p.spawn.z }), 'tier', 'the Armory needs Company HQ');
  p.mp = 1000; p.mun = 1000;
  assert.equal(command(g, 0, { t: 'tech', kind: 'tier' }), undefined, 'the HQ researches the next tier');
  assert.equal(snapshotFor(g, 0, []).tech.lab[0][0], 'tier');
});

test('road march: calm units move faster on their own land', () => {
  const g = fresh(), rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  const start = { x: rifle.x, z: rifle.z };
  const leg = (fought) => {
    Object.assign(rifle, { ...start, path: [], orders: [], worldGoal: null });
    assert.equal(command(g, 0, { t: 'move', orders: [[rifle.id, start.x + 20, start.z]] }), undefined);
    let d = 0;
    for (let i = 0; i < 40; i++) { if (fought) rifle.hitAt = g.tick; const x = rifle.x, z = rifle.z; step(g); d += Math.hypot(rifle.x - x, rifle.z - z); }
    return d;
  };
  for (let i = 0; i < 300; i++) step(g); // past the opening calm period
  const marching = leg(false), fighting = leg(true);
  assert.ok(marching > fighting * 1.3, `march ${marching.toFixed(1)} m against ${fighting.toFixed(1)} m under fire`);
});

test('World paratroopers need a finished Airfield nearby', () => {
  const g = fresh(), p = g.players[0], hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  p.mun = 1000;
  assert.equal(command(g, 0, { t: 'support', kind: 'para', x: hq.x + 6, z: hq.z }), 'airfield');
  Object.assign(hq, { type: 'airfield' }); // stands in for a finished Airfield at the same spot
  assert.equal(command(g, 0, { t: 'support', kind: 'para', x: hq.x + 6, z: hq.z }), undefined);
});

test('railways: a train carries units between owned stations and stops where the line is cut', () => {
  const g = fresh(), W = g.world;
  for (const u of [...g.units.values()]) if (u.owner === -1 && !u.cells) g.units.delete(u.id); // no local defenders in the way
  const home = W.stations.find(s => W.regions[s.region].team === 0);
  assert.ok(home, 'every home region has a station');
  const line = W.lines.find(l => l.a === home.region || l.b === home.region), far = W.stations.find(s => s.region === (line.a === home.region ? line.b : line.a));
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  Object.assign(rifle, { x: home.x + 6, z: home.z, path: [] });
  assert.equal(command(g, 0, { t: 'rail', ids: [rifle.id], x: far.x, z: far.z }), 'station', 'no other owned station to go to');
  for (const id of line.regions) W.regions[id].team = 0;
  assert.equal(command(g, 0, { t: 'rail', ids: [rifle.id], x: far.x, z: far.z }), undefined);
  const train = [...g.units.values()].find(u => u.type === 'train');
  assert.ok(train && rifle.riding === train.id, 'the squad boards a train');
  assert.equal(command(g, 0, { t: 'rail', ids: [rifle.id], x: far.x, z: far.z }), 'needs', 'a squad on a train takes no orders');
  for (let i = 0; i < 4000 && g.units.has(train.id); i++) step(g);
  assert.ok(!g.units.has(train.id) && !rifle.riding, 'the train unloads and leaves');
  assert.ok(Math.hypot(rifle.x - far.x, rifle.z - far.z) < 20, 'the squad gets off at the far station');
  // the same trip back, cut when the far region changes hands on the way
  for (let i = 0; i < Math.ceil(20 / 0.05); i++) step(g);
  assert.equal(command(g, 0, { t: 'rail', ids: [rifle.id], x: home.x, z: home.z }), undefined);
  const back = [...g.units.values()].find(u => u.type === 'train');
  for (let i = 0; i < 200; i++) step(g);
  const mid = line.regions.find(id => id !== home.region && id !== far.region) ?? home.region;
  W.regions[mid].team = 1;
  for (let i = 0; i < 4000 && g.units.has(back.id); i++) step(g);
  assert.ok(!g.units.has(back.id) && !rifle.riding, 'the cut train lets everyone off');
  assert.ok(Math.hypot(rifle.x - home.x, rifle.z - home.z) > 20, 'short of its destination');
});
