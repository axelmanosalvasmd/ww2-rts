// Fortress buildings (docs/superpowers/plans/2026-10-08-fortress-buildings.md).
// Pillbox: a T2 concrete MG blockhouse. It shoots once finished, shrugs off small arms from the front and is weak behind.
import assert from 'node:assert/strict';
import { createGame, command, step, TICK, UNITS, CELL, FORTS, inPit } from './shared/sim.js';
const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 12, y: 40 }, { x: 68, y: 40 }], points: [], defend: [0] };
const run = (g, s) => { for (let i = 0; i < Math.ceil(s / TICK); i++) step(g); };
const units = (g, slot, type) => [...g.units.values()].filter(u => u.owner === slot && u.type === type);

function setup() {
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false, tech: true }), p = g.players[0];
  p.mp = 10000;
  const builder = units(g, 0, 'rifle')[0];
  assert.equal(command(g, 0, { t: 'build', kind: 'pillbox', ids: [builder.id], x: 50, z: 80 }), 'tier', 'a pillbox needs Company HQ');
  p.tier = 2;
  assert.equal(command(g, 0, { t: 'build', kind: 'pillbox', ids: [builder.id], x: 50, z: 80 }), undefined);
  const box = units(g, 0, 'pillbox')[0];
  assert.ok(box && box.built < 1, 'a construction site goes up');
  assert.ok(Math.abs(box.rot) < 0.2, 'the slit faces out from home, toward the enemy side');
  // clear the field: only the pillbox and the squads placed below take part
  for (const u of [...g.units.values()]) if (u.id !== box.id && !UNITS[u.type].building) g.units.delete(u.id);
  return { g, box };
}
const enemyRifle = (g, x, z) => {
  const r = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false }); // borrow a fresh squad shape
  const u = [...r.units.values()].find(v => v.owner === 1 && v.type === 'rifle');
  u.id = g.nextId = (g.nextId ?? 1e5) + 1; Object.assign(u, { x, z, path: [], orders: [] });
  g.units.set(u.id, u); return u;
};

{
  const { g, box } = setup();
  run(g, 3);
  const r = enemyRifle(g, box.x + 22, box.z);
  const hp = r.hp; run(g, 4);
  assert.equal(r.hp, hp, 'an unfinished pillbox does not shoot');
  box.built = 1; box.hp = UNITS.pillbox.hpPer;
  run(g, 6);
  assert.ok(r.hp < hp, 'a finished pillbox shoots the squad in front of it');
}
// rifle fire: barely a scratch from the front, twice that from behind
function rifleDamage(dx) {
  const { g, box } = setup();
  box.built = 1; box.hp = UNITS.pillbox.hpPer; box.holdFire = true;
  const r = enemyRifle(g, box.x + dx, box.z + 12); // off to the side, clear of the base buildings
  run(g, 1); g.players[1].visible.add(box.id); // the injected squad has not had a vision pass yet
  assert.equal(command(g, 1, { t: 'attack', ids: [r.id], target: box.id }), undefined);
  const hp = box.hp; run(g, 20);
  return hp - box.hp;
}
const front = rifleDamage(10), rear = rifleDamage(-10);
assert.ok(front > 0, 'rifle fire still chips it');
assert.ok(front < UNITS.pillbox.hpPer * 0.05, `twenty seconds of rifle fire from the front is a scratch (${front})`);
assert.ok(rear > front * 1.5, `the rear is weaker (front ${front}, rear ${rear})`);
console.log(`pillbox checks passed (rifle 20 s: front ${front.toFixed(1)}, rear ${rear.toFixed(1)})`);

// Gun Pit: an MG team standing in the pit reaches a squad 42 m away, past its usual 36 m; on open ground it does not
function pitShot(usePit) {
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false }), p = g.players[0];
  p.mp = 10000;
  const [digger, spotter] = units(g, 0, 'rifle'), mg = units(g, 0, 'mg')[0];
  assert.equal(command(g, 0, { t: 'dig', kind: 'nest', ids: [digger.id], x: 50, z: 60, dir: Math.PI }), undefined);
  run(g, 40);
  assert.equal(g.pits?.size, 1, 'the finished Gun Pit marks its pit cell');
  const c = [...g.pits][0], pit = { x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL };
  for (const u of [...g.units.values()]) if (![mg.id, spotter.id].includes(u.id) && !UNITS[u.type].building) g.units.delete(u.id);
  const at = usePit ? pit : { x: pit.x + 16, z: pit.z };
  Object.assign(mg, { x: at.x, z: at.z, path: [], orders: [] });
  const r = enemyRifle(g, at.x, at.z + 42); // dir PI: the pit faces +z
  Object.assign(spotter, { x: r.x + 6, z: r.z - 24, path: [], orders: [], holdFire: true }); // sees the target, never shoots
  assert.equal(inPit(g, mg), usePit);
  const hp = r.hp; run(g, 10);
  return hp - r.hp;
}
assert.ok(pitShot(true) > 0, 'from the pit the MG reaches 42 m');
assert.equal(pitShot(false), 0, 'on open ground 42 m is out of its 36 m range');
assert.equal(FORTS.nest.name, 'Gun Pit');
console.log('gun pit checks passed');

// Scout Tower: tier 1, unarmed, sees 60 m; an enemy squad 55 m out is spotted only once the tower is finished
{
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false, tech: true }), p = g.players[0];
  p.mp = 10000;
  const builder = units(g, 0, 'rifle')[0];
  assert.equal(command(g, 0, { t: 'build', kind: 'tower', ids: [builder.id], x: 50, z: 80 }), undefined, 'a tower needs no tier');
  const tower = units(g, 0, 'tower')[0];
  assert.deepEqual([tower.cells.length, UNITS.tower.w], [1, null], 'one cell, no weapon');
  for (const u of [...g.units.values()]) if (u.id !== tower.id && !UNITS[u.type].building) g.units.delete(u.id);
  const r = enemyRifle(g, tower.x + 55, tower.z);
  run(g, 1);
  assert.ok(!g.players[0].visible.has(r.id), 'nothing sees 55 m out yet');
  tower.built = 1; tower.hp = UNITS.tower.hpPer;
  run(g, 1);
  assert.ok(g.players[0].visible.has(r.id), 'the finished tower spots it');
  console.log('scout tower checks passed');
}

// Concrete Wall and Gate (tier 2): a drawn wall line goes up cell by cell as one-cell wall buildings that block the
// ground; a gate stands open, shuts while an enemy is near and opens again when it has gone
{
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'conquest', weather: false, tech: true }), p = g.players[0];
  p.mp = 10000;
  const crew = units(g, 0, 'rifle').map(u => u.id);
  const line = { t: 'entrench', ids: crew, pattern: 'line', fort: 'wall', x: 56, z: 66, x2: 56, z2: 94 };
  assert.equal(command(g, 0, line), 'tier', 'concrete needs Company HQ');
  p.tier = 2;
  assert.equal(command(g, 0, line), undefined);
  run(g, 90);
  const walls = units(g, 0, 'wall');
  assert.ok(walls.length >= 10, `the wall line stands (${walls.length} cells)`);
  assert.ok(walls.every(w => w.built === 1 && g.chars[w.cells[0]] === 'K'), 'every wall cell is a finished building cell');
  const mp = p.mp;
  assert.equal(command(g, 0, { t: 'dig', kind: 'gate', ids: [crew[0]], x: 44, z: 80 }), undefined);
  assert.ok(p.mp < mp, 'the gate is paid');
  run(g, 45);
  const gates = units(g, 0, 'gate');
  assert.equal(gates.length, 3, 'a gate is three cells');
  assert.ok(gates.every(v => v.open && g.chars[v.cells[0]] !== 'K'), 'with no enemy about the gate stands open');
  for (const u of [...g.units.values()]) if (!UNITS[u.type].building) g.units.delete(u.id);
  const near = enemyRifle(g, gates[1].x + 10, gates[1].z);
  run(g, 2);
  assert.ok(gates.every(v => !v.open && g.chars[v.cells[0]] === 'K'), 'an enemy 10 m off shuts it');
  g.units.delete(near.id);
  run(g, 2);
  assert.ok(gates.every(v => v.open), 'it opens again once the enemy has gone');
  console.log(`concrete wall and gate checks passed (${walls.length} wall cells)`);
}

// World Conquest: regions far from every home start with a Pillbox (the farthest also a Scout Tower and walls), guards
// see out of them, and taking the region hands its fortifications to the captor
{
  const { generateWorldMap } = await import('./shared/world-conquest.js');
  const { CFG } = await import('./shared/sim.js');
  const m = generateWorldMap({ size: 'huge', seed: 7, players: 2, teams: [0, 1] });
  const g = createGame(m, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'world', weather: 'clear' });
  const homes = g.players.map(p => p.spawn), far = (r) => Math.min(...homes.map(h => Math.hypot(h.x - r.x, h.z - r.z)));
  const regionOf = (b) => g.world.regions.find(r => Math.hypot(r.x - b.x, r.z - b.z) < 40);
  const boxes = [...g.units.values()].filter(u => u.type === 'pillbox');
  assert.ok(boxes.length > 0 && boxes.every(b => b.owner === -1 && b.built === 1), 'guard regions start with finished pillboxes');
  const guards = g.world.regions.filter(r => r.team < 0), cut = guards.map(far).sort((a, b) => b - a)[Math.ceil(guards.length * 0.4) - 1];
  assert.ok(boxes.length <= Math.ceil(guards.length * 0.4) && boxes.every(b => far(regionOf(b)) >= cut - 1), 'only the farthest 40% of guard regions are fortified');
  assert.ok([...g.units.values()].some(u => u.type === 'tower' && u.owner === -1) && [...g.units.values()].some(u => u.type === 'wall' && u.owner === -1), 'the farthest add towers and walls');
  // take one: wreck its base, stand a squad on the point
  const box = boxes[0], r = regionOf(box);
  for (const u of [...g.units.values()]) if (u.owner === -1 && !['pillbox', 'tower', 'wall', 'gate'].includes(u.type) && Math.hypot(u.x - r.x, u.z - r.z) < 60) g.units.delete(u.id);
  const squad = [...g.units.values()].find(u => u.owner === 0 && UNITS[u.type].infantry);
  Object.assign(squad, { x: r.x, z: r.z, path: [], orders: [], worldGoal: null });
  box.holdFire = true;
  run(g, CFG.captureTime + 2);
  assert.equal(r.team, g.players[0].team, 'the region is taken');
  assert.equal(box.owner, 0, 'its pillbox now belongs to the captor');
  console.log(`world fortification checks passed (${boxes.length} fortified regions)`);
}

// AI: with MP to spare at Company HQ it fortifies its HQ toward the enemy: a Scout Tower, a Pillbox, then a concrete
// wall with a gate in it
{
  const { readFileSync } = await import('node:fs');
  const { think } = await import('./shared/ai.js');
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b'], false, undefined, undefined, { mode: 'conquest', tech: true, weather: false });
  const random = Math.random; let seed = 20261008; Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const have = () => Object.fromEntries(['tower', 'pillbox', 'wall', 'gate'].map(t => [t, units(g, 0, t).filter(u => u.built >= 1).length]));
  for (let i = 0; i < 20 * 330 && g.winner === null; i++) {
    if (g.tick === 20 * 140) g.players[0].tier = 2;
    if (g.tick > 20 * 140) g.players[0].mp = Math.max(g.players[0].mp, 1500);
    if (g.tick % 40 === 0) think(g, 0);
    if (g.tick % 40 === 13) think(g, 1);
    step(g);
  }
  Math.random = random;
  const h = have();
  assert.ok(h.tower >= 1 && h.pillbox >= 1 && h.wall >= 6 && h.gate >= 1, `the AI fortifies its HQ (${JSON.stringify(h)})`);
  console.log(`AI fortification checks passed ${JSON.stringify(h)}`);
}
